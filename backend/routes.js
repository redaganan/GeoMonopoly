const express = require('express');
const router = express.Router();

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

router.post('/buy-territory', async (req,res)=>{
  try{
    const { userId, territoryId } = req.body;
    const { User, Territory } = req.app.get('models');
    if(!userId || !territoryId) return res.status(400).json({ error:'missing params' });
    const u = await User.findById(userId);
    const t = await Territory.findById(territoryId).populate('owner');
    if(!u || !t) return res.status(404).json({ error:'user or territory not found' });

    // must be unlocked first
    const unlocked = (t.unlockedUsers||[]).map(x=>String(x));
    if(!unlocked.includes(String(userId))) return res.status(403).json({ error:'territory not unlocked for user' });

    if(t.owner && String(t.owner._id) === String(userId)) return res.json({ ok:true, msg:'you already own this' });

    const price = Number(t.price || t.basePrice || 1000);
    if((u.wallet||0) < price) return res.status(400).json({ error:'insufficient wallet' });

    // transfer
    u.wallet -= price;
    if(t.owner){
      const prev = await User.findById(t.owner._id);
      if(prev){ prev.wallet = (prev.wallet||0) + price; await prev.save(); }
    }
    t.owner = u._id;
    // optional: bump price for market dynamics
    t.price = Math.round(price * 1.10);

    await t.save();
    await u.save();

    req.app.get('io')?.emit('territory:buy', { territoryId, owner:userId });
    return res.json({ ok:true, wallet:u.wallet, territory:t });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

// Hostile takeover: challenger must beat record (speed higher OR time lower).
// If successful, challenger pays 50% of territory.basePrice and becomes owner.
router.post('/hostile-takeover', async (req,res)=>{
  try{
    const { challengerId, territoryId, speed, time } = req.body;
    const { User, Territory } = req.app.get('models');
    if(!challengerId || !territoryId) return res.status(400).json({ error:'missing params' });
    const c = await User.findById(challengerId);
    const t = await Territory.findById(territoryId).populate('owner recordHolder');
    if(!c || !t) return res.status(404).json({ error:'challenger or territory not found' });

    const beats = (speed && Number(speed) > (t.recordSpeed||0)) || (time && Number(time) < (t.recordTime||Number.MAX_SAFE_INTEGER));
    if(!beats) return res.status(400).json({ error:'record not beaten' });

    const cost = Math.round((Number(t.basePrice||t.price||1000)) * 0.5);
    if((c.wallet||0) < cost) return res.status(400).json({ error:'insufficient wallet for takeover' });

    // pay challenger -> previous owner (if any)
    c.wallet -= cost;
    if(t.owner){ const prev = await User.findById(t.owner._id); if(prev){ prev.wallet = (prev.wallet||0) + cost; await prev.save(); } }

    // transfer ownership and update records
    t.owner = c._id;
    t.recordHolder = c._id;
    if(speed) t.recordSpeed = Math.max(t.recordSpeed||0, Number(speed));
    if(time) t.recordTime = Math.min(t.recordTime||Number.MAX_SAFE_INTEGER, Number(time));

    await t.save();
    await c.save();

    req.app.get('io')?.emit('territory:hostile', { territoryId, owner:challengerId, cost });
    return res.json({ ok:true, cost, wallet:c.wallet, territory:t });
  }catch(e){ return res.status(500).json({ error:e.message }); }
});

module.exports = router;
