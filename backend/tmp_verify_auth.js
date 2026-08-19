require('dotenv').config();
const mongoose=require('mongoose');
const jwt=require('jsonwebtoken');
(async()=>{
  await mongoose.connect(process.env.MONGO_URI||'mongodb://127.0.0.1:27017/geomonopoly');
  const S = new mongoose.Schema({}, { strict:false });
  const User = mongoose.model('User', S);
  const u = await User.findOne({ name:'Runner_Malate' }).lean();
  if(!u){ console.log('NO_USER'); process.exit(0); }
  const id = u._id.toString();
  const token = jwt.sign({ id }, process.env.JWT_SECRET||'dev',{expiresIn:'30d'});
  console.log('FOUND_ID:'+id);
  console.log('TOKEN:'+token);
  try{
    const res = await fetch('http://localhost:4000/api/auth/me', { headers:{ Authorization:`Bearer ${token}` } });
    const j = await res.json();
    console.log('AUTH_RESP:'+JSON.stringify(j));
  }catch(e){ console.error('FETCH_ERR', e.message); }
  await mongoose.disconnect();
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });