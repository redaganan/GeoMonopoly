const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// compact Mongoose models (User + Territory) to save files/tokens
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/geomonopoly', { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=>console.log('Mongo connected'))
  .catch(e=>console.error('Mongo err',e));

const UserSchema = new mongoose.Schema({
  name:String,
  wallet:{ type:Number, default:0 },
  unlocked:[{ type:mongoose.Schema.Types.ObjectId, ref:'Territory' }]
},{ timestamps:true });

const TerritorySchema = new mongoose.Schema({
  name:String,
  bbox:{ type:[Number], default:[] }, // [minLat,minLng,maxLat,maxLng]
  basePrice:{ type:Number, default:1000 },
  price:{ type:Number, default:1000 },
  owner:{ type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
  recordHolder:{ type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
  recordSpeed:{ type:Number, default:0 },
  recordTime:{ type:Number, default: Number.MAX_SAFE_INTEGER },
  unlockedUsers:[{ type:mongoose.Schema.Types.ObjectId, ref:'User' }]
},{ timestamps:true });

const User = mongoose.model('User', UserSchema);
const Territory = mongoose.model('Territory', TerritorySchema);

app.set('models', { User, Territory });

// routes
const routes = require('./routes');
app.use('/api', routes);

// http + socket.io
const server = http.createServer(app);
const io = new Server(server, { cors:{ origin: '*' } });
app.set('io', io);

io.on('connection', s=>{
  console.log('socket', s.id, 'connected');
  s.on('join', r=>s.join(r));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, ()=>console.log('Server running on', PORT));
