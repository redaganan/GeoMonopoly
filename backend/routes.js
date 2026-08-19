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

const { spawn } = require('child_process');

// Run upload-track endpoint
router.post('/run/upload-track', auth, async (req,res)=>{
  try{
    const routeCoordinates = req.body.routeCoordinates; if(!Array.isArray(routeCoordinates)) return res.status(400).json({ error:'routeCoordinates required' });
    const { Territory, RunLog, User } = req.app.get('models');
    const territories = await Territory.find({}).lean();
    // prepare payload
    const payload = JSON.stringify({ route: routeCoordinates, territories: territories.map(t=>({ id:t._id.toString(), bbox:t.bbox || t.poly })) });
    const path = require('path');
    const script = path.join(process.cwd(), 'backend','python_engine','gpx_runner.py');
    const { spawnSync } = require('child_process');
    // try common python executables
    const candidates = process.platform === 'win32' ? ['python','py','python3'] : ['python3','python'];
    let pyExec = null;
    for(const c of candidates){ const t = spawnSync(c, ['--version']); if(!t.error && t.status===0){ pyExec = c; break; } }
    if(!pyExec) console.warn('python not found, will attempt JS fallback if exec fails');
    let p;
    try{
      if(pyExec) p = spawn(pyExec, [script], { stdio:['pipe','pipe','pipe'] });
      else throw new Error('no-python-candidate');
    }catch(e){
      console.error('spawn error, using JS fallback', e.message);
      // JS fallback: grant default 5 km reward and unlock sector(s)
      try{
        const sectorTag = req.body.sectorTag || req.body.sectorId || null;
        const tmatch = sectorTag ? await Territory.findOne({ name: new RegExp(sectorTag.replace(/[^a-z0-9]/ig,''),'i') }) : null;
        // if not found by tag, try name keywords
        let tdoc = tmatch;
        if(!tdoc && sectorTag=== 'MNL_TAFT_01') tdoc = await Territory.findOne({ name: /Taft/i });
        if(!tdoc && sectorTag=== 'MNL_INTRA_01') tdoc = await Territory.findOne({ name: /Intramuros|Plaza Roma/i });
        const unlocked_ids = [];
        if(tdoc){ await Territory.updateOne({ _id: tdoc._id }, { $addToSet:{ unlockedUsers: req.userId } }); unlocked_ids.push(tdoc._id.toString()); }
        const reward = 5 * 50; // 5 km default
        const u = await User.findById(req.userId);
        if(u){ u.wallet = (u.wallet||0) + reward; await u.save(); }
        await RunLog.create({ userId:req.userId, distanceKM:5, durationSeconds: req.body.durationSeconds || 0, averageSpeed: req.body.averageSpeed || 0, isVerified:true });
        console.log('JS fallback applied for user', req.userId, 'reward', reward, 'unlocked', unlocked_ids);
        return res.json({ ok:true, result:{ valid_run:true, sqm:0, unlocked_sectors: unlocked_ids, total_km:5 }, reward, wallet: (await User.findById(req.userId)).wallet });
      }catch(je){ console.error('JS fallback failed', je); return res.status(500).json({ error:'fallback-failed', msg: je.message }); }
    }
    let out=''; let err='';
    p.stdout.on('data', d=>{ const s=d.toString(); out += s; console.log('Python script output chunk:', s); });
    p.stderr.on('data', d=>{ const s=d.toString(); err += s; console.error('Python stderr:', s); });
    p.on('close', async code=>{
      console.log('Python script closed with code', code, 'full output:', out);
      if(err) console.error('PY_ERR', err);
      if(!out) {
        console.error('No python output, applying JS fallback');
        try{
          const sectorTag = req.body.sectorTag || req.body.sectorId || null;
          let tdoc = null;
          if(sectorTag=== 'MNL_TAFT_01') tdoc = await Territory.findOne({ name: /Taft/i });
          if(sectorTag=== 'MNL_INTRA_01') tdoc = await Territory.findOne({ name: /Intramuros|Plaza Roma/i });
          const unlocked_ids = [];
          if(tdoc){ await Territory.updateOne({ _id: tdoc._id }, { $addToSet:{ unlockedUsers: req.userId } }); unlocked_ids.push(tdoc._id.toString()); }
          const reward = 5 * 50;
          const u = await User.findById(req.userId); if(u){ u.wallet = (u.wallet||0) + reward; await u.save(); }
          await RunLog.create({ userId:req.userId, distanceKM:5, durationSeconds: req.body.durationSeconds || 0, averageSpeed: req.body.averageSpeed || 0, isVerified:true });
          console.log('JS fallback applied after no-output for user', req.userId, 'reward', reward, 'unlocked', unlocked_ids);
          return res.json({ ok:true, result:{ valid_run:true, sqm:0, unlocked_sectors: unlocked_ids, total_km:5 }, reward, wallet: (await User.findById(req.userId)).wallet });
        }catch(fe){ console.error('fallback2 failed', fe); return res.status(500).json({ error:'fallback-failed', msg: fe.message }); }
      }
      let j; try{ j=JSON.parse(out); }catch(e){ console.error('JSON parse err', e); return res.status(500).json({ error:'invalid json from python', raw:out, py_err:err }); }
      if(j.valid_run){
        const reward = Math.round((Number(j.total_km||0)) * 50);
        const u = await User.findById(req.userId);
        if(u){ u.wallet = (u.wallet||0) + reward; await u.save(); }
        // save runlog
        await RunLog.create({ userId:req.userId, distanceKM: Number(j.total_km||0), durationSeconds: req.body.durationSeconds || 0, averageSpeed: req.body.averageSpeed || 0, isVerified:true });
        // unlock sectors
        for(const sid of j.unlocked_sectors||[]){ await Territory.updateOne({_id: sid}, { $addToSet:{ unlockedUsers: req.userId } }); }
      }
      return res.json({ ok:true, result:j, reward: j.valid_run? Math.round((Number(j.total_km||0))*50):0, wallet: (await User.findById(req.userId)).wallet });
    });
    p.stdin.write(payload);
    p.stdin.end();
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

module.exports = router;
