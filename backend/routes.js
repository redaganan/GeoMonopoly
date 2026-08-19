const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Auth middleware + endpoints (compact)
const auth = (req,res,next)=>{
  const h = req.headers.authorization || req.headers.Authorization;
  if(!h) return res.status(401).json({ error:'no token' });
  const parts = h.split(' ');
  if(parts.length!==2 || parts[0] !== 'Bearer') return res.status(401).json({ error:'bad auth header' });
  try{ const p = jwt.verify(parts[1], process.env.JWT_SECRET||'dev'); req.userId = p.id; next(); }catch(e){ return res.status(401).json({ error:'token invalid' }); }
};

// Auth: signup, login, google
router.post('/auth/signup', async (req,res)=>{
  try{
    const { name, email, password, faction } = req.body; if(!email||!password) return res.status(400).json({ error:'email+password required' });
    const { User } = req.app.get('models');
    if(await User.findOne({ email })) return res.status(400).json({ error:'email exists' });
    const u = await User.create({ name, email, password, wallet:500, faction });
    const token = jwt.sign({ id:u._id, email:u.email }, process.env.JWT_SECRET||'dev', { expiresIn:'30d' });
    const out = u.toObject(); delete out.password;
    return res.json({ ok:true, user:out, token });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

router.post('/auth/login', async (req,res)=>{
  try{
    const { email, password } = req.body; if(!email||!password) return res.status(400).json({ error:'missing' });
    const { User } = req.app.get('models');
    const u = await User.findOne({ email }); if(!u) return res.status(404).json({ error:'no user' });
    const ok = await bcrypt.compare(password, u.password||''); if(!ok) return res.status(401).json({ error:'invalid' });
    const token = jwt.sign({ id:u._id, email:u.email }, process.env.JWT_SECRET||'dev', { expiresIn:'30d' });
    const out = u.toObject(); delete out.password;
    return res.json({ ok:true, user:out, token });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

// Google auth: decode credential JWT from frontend, create user if not exists
router.post('/auth/google', async (req,res)=>{
  try{
    const { credential } = req.body; if(!credential) return res.status(400).json({ error:'credential required' });
    const payload = jwt.decode(credential);
    const email = payload?.email; const name = payload?.name; const picture = payload?.picture;
    if(!email) return res.status(400).json({ error:'invalid credential' });
    const { User } = req.app.get('models');
    let u = await User.findOne({ email });
    if(!u){ u = await User.create({ name, email, password:Math.random().toString(36).slice(2), wallet:500 }); }
    const token = jwt.sign({ id:u._id, email:u.email }, process.env.JWT_SECRET||'dev', { expiresIn:'30d' });
    const out = u.toObject(); delete out.password;
    return res.json({ ok:true, user:out, token });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

// /me endpoint
router.get('/auth/me', auth, async (req,res)=>{
  try{
    const { User, RunLog } = req.app.get('models');
    const u = await User.findById(req.userId).lean(); if(!u) return res.status(404).json({ error:'no user' });
    const agg = await RunLog.aggregate([{ $match:{ userId: u._id } },{ $group:{ _id:null, total: { $sum: '$distanceKM' } } }]);
    const total_km = agg[0]?.total || 0;
    return res.json({ ok:true, username: u.name, faction: u.faction || 'Unknown', php_wallet: u.wallet||0, total_km, id: u._id });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

// endpoints: add-cash, buy-territory, hostile-takeover
router.post('/add-cash', async (req,res)=>{
  try{
    const { userId, kilometers } = req.body;
    const { User } = req.app.get('models');
    if(!userId) return res.status(400).json({ error:'userId required' });
    const u = await User.findById(userId);
    if(!u) return res.status(404).json({ error:'user not found' });
    const amount = Math.round((Number(kilometers)||0) * 50); // 1 km = 50 PHP
    u.wallet = (u.wallet||0) + amount;
    await u.save();
    req.app.get('io')?.emit('wallet', { userId, wallet:u.wallet });
    return res.json({ ok:true, amount, wallet:u.wallet });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

router.post('/buy-territory', auth, async (req,res)=>{
  try{
    const { territoryId } = req.body; const userId = req.userId || req.body.userId;
    const { User, Territory, Transaction } = req.app.get('models');
    if(!userId || !territoryId) return res.status(400).json({ error:'missing params' });
    const u = await User.findById(userId);
    const t = await Territory.findById(territoryId).populate('owner');
    if(!u || !t) return res.status(404).json({ error:'user or territory not found' });

    const unlocked = (t.unlockedUsers||[]).map(x=>String(x));
    if(!unlocked.includes(String(userId))) return res.status(403).json({ error:'territory not unlocked for user' });

    if(t.owner && String(t.owner._id) === String(userId)) return res.json({ ok:true, msg:'you already own this' });

    const price = Number(t.price || t.basePrice || 1000);
    if((u.wallet||0) < price) return res.status(400).json({ error:'insufficient wallet' });

    u.wallet -= price;
    let sellerId = null;
    if(t.owner){ const prev = await User.findById(t.owner._id); sellerId = prev?._id; if(prev){ prev.wallet = (prev.wallet||0) + price; await prev.save(); } }
    t.owner = u._id; t.price = Math.round(price * 1.10);

    await t.save(); await u.save();

    try{ await Transaction.create({ buyerId:u._id, sellerId, territoryId:t._id, amountPaidPHP:price, transactionType:'BUY' }); }catch(e){}

    req.app.get('io')?.emit('territory:buy', { territoryId, owner:userId });
    return res.json({ ok:true, wallet:u.wallet, territory:t });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

// Hostile takeover: challenger must beat record (speed higher OR time lower).
// If successful, challenger pays 50% of territory.basePrice and becomes owner.
router.post('/hostile-takeover', auth, async (req,res)=>{
  try{
    const { speed, time } = req.body; const challengerId = req.userId || req.body.challengerId;
    const { User, Territory, Transaction } = req.app.get('models');
    if(!challengerId || !req.body.territoryId) return res.status(400).json({ error:'missing params' });
    const c = await User.findById(challengerId);
    const t = await Territory.findById(req.body.territoryId).populate('owner recordHolder');
    if(!c || !t) return res.status(404).json({ error:'challenger or territory not found' });

    const beats = (speed && Number(speed) > (t.recordSpeed||0)) || (time && Number(time) < (t.recordTime||Number.MAX_SAFE_INTEGER));
    if(!beats) return res.status(400).json({ error:'record not beaten' });

    const cost = Math.round((Number(t.basePrice||t.price||1000)) * 0.5);
    if((c.wallet||0) < cost) return res.status(400).json({ error:'insufficient wallet for takeover' });

    c.wallet -= cost;
    let sellerId = null;
    if(t.owner){ const prev = await User.findById(t.owner._id); sellerId = prev?._id; if(prev){ prev.wallet = (prev.wallet||0) + cost; await prev.save(); } }

    t.owner = c._id; t.recordHolder = c._id; if(speed) t.recordSpeed = Math.max(t.recordSpeed||0, Number(speed)); if(time) t.recordTime = Math.min(t.recordTime||Number.MAX_SAFE_INTEGER, Number(time));

    await t.save(); await c.save();

    try{ await Transaction.create({ buyerId:c._id, sellerId, territoryId:t._id, amountPaidPHP:cost, transactionType:'TAKEOVER' }); }catch(e){}

    req.app.get('io')?.emit('territory:hostile', { territoryId:req.body.territoryId, owner:challengerId, cost });
    return res.json({ ok:true, cost, wallet:c.wallet, territory:t });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

module.exports = router;
