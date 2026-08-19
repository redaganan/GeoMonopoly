// compact seed script for GeoMonopoly (Taglish, siksik)
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/geomonopoly';
(async()=>{
  await mongoose.connect(MONGO);
  const S = mongoose.Schema;
  const User = mongoose.model('User', new S({ name:String, wallet:Number }, { timestamps:true }));
  const Territory = mongoose.model('Territory', new S({ name:String, bbox:[Number], basePrice:Number, price:Number, owner:{ type:S.Types.ObjectId, ref:'User' }, unlockedUsers:[{ type:S.Types.ObjectId, ref:'User' }] }, { timestamps:true }));

  // cleanup same-named seeds
  await User.deleteMany({ name: { $in: ['Runner_Malate','Cyclist_Taft'] } });
  await Territory.deleteMany({ name: { $in: ['Taft Avenue','Intramuros Plaza Roma','España Blvd'] } });

  // create users
  const runner = await User.create({ name:'Runner_Malate', wallet:5000 });
  const cyclist = await User.create({ name:'Cyclist_Taft', wallet:1200 });

  const unlocked = [runner._id, cyclist._id];

  // approximate bboxes: [minLat,minLng,maxLat,maxLng]
  const territories = [
    { name:'Taft Avenue', bbox:[14.568,120.976,14.576,120.988], basePrice:2000, price:2000, unlockedUsers:unlocked },
    { name:'Intramuros Plaza Roma', bbox:[14.587,120.971,14.591,120.976], basePrice:3000, price:3000, unlockedUsers:unlocked },
    { name:'España Blvd', bbox:[14.596,120.989,14.605,120.998], basePrice:2500, price:2500, unlockedUsers:unlocked }
  ];

  const inserted = await Territory.insertMany(territories);

  console.log('Seed done. Users: ', { runner: runner._id.toString(), cyclist: cyclist._id.toString() });
  console.log('Territories created:', inserted.map(t=>({ name:t.name, id:t._id.toString() })));
  await mongoose.disconnect();
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
