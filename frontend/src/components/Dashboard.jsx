import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, useMap, Tooltip, Marker } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

const territoriesInit = [
  { id:'6a8576953d08ecff83214954', name:'Taft Avenue', bbox:[14.568,120.976,14.576,120.988], owner:null },
  { id:'6a8576953d08ecff83214955', name:'Intramuros Plaza Roma', bbox:[14.587,120.971,14.591,120.976], owner:null },
  { id:'6a8576953d08ecff83214956', name:'España Blvd', bbox:[14.596,120.989,14.605,120.998], owner:null }
];
const bboxToPolygon = ([minLat,minLng,maxLat,maxLng])=>[
  [minLat,minLng],[minLat,maxLng],[maxLat,maxLng],[maxLat,minLng]
];
function FlyToBounds({ bounds }){ const map = useMap(); useEffect(()=>{ if(bounds) map.fitBounds(bounds, { padding:[40,40] }); },[bounds,map]); return null; }

export default function Dashboard(){
  const [territories,setTerritories] = useState(territoriesInit);
  const [selected,setSelected] = useState(territoriesInit[0].id);
  const [wallet,setWallet] = useState(0);
  const [kms,setKms] = useState(0);
  const [username,setUsername] = useState('');
  const [faction,setFaction] = useState('');
  const [userId,setUserId] = useState(null);
  const userIdRef = useRef(null);
  const socketRef = useRef(null);

  const [flash,setFlash] = useState({});
  const [unlocked,setUnlocked] = useState([]);
  const [runnerPosition,setRunnerPosition] = useState(null);
  const animRef = useRef(null);
  const [feed,setFeed] = useState([]);
  const [miniOpen,setMiniOpen] = useState(false);

  const haversineM = (a,b)=>{ const R=6371000, toR=d=>d*Math.PI/180; const dLat=toR(b[0]-a[0]), dLon=toR(b[1]-a[1]), la=toR(a[0]), lb=toR(b[0]); const x=Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(x)); };
  const calcSqm = (bbox)=>{ const [minLat,minLng,maxLat,maxLng]=bbox; const h=haversineM([minLat,minLng],[maxLat,minLng]); const w=haversineM([minLat,minLng],[minLat,maxLng]); return Math.round(h*w); };

  useEffect(()=>{
    const token = localStorage.getItem('token');
    if(token){ fetch(`${API}/auth/me`, { headers:{ Authorization:`Bearer ${token}` } }).then(r=>r.json()).then(j=>{ if(j.ok){ setUsername(j.username); setFaction(j.faction); setWallet(j.php_wallet); setKms(j.total_km); setUserId(j.id); userIdRef.current=j.id; } }).catch(()=>{}); }
    const s = io(SOCKET, { transports:['websocket'] }); socketRef.current=s;
    s.on('connect', ()=>setFeed(f=>['socket connected',...f].slice(0,30)));
    s.on('wallet', ({ userId:uid, wallet:wt })=>{ if(String(uid)===String(userIdRef.current)) setWallet(wt); setFeed(f=>[`Wallet ₱${wt}`,...f].slice(0,30)); });
    s.on('territory:buy', p=>{ updateOwnerAndFlash(p.territoryId,p.owner); setFeed(f=>[`${p.owner} bought ${p.territoryId}`,...f].slice(0,30)); });
    s.on('territory:hostile', p=>{ updateOwnerAndFlash(p.territoryId,p.owner); setFeed(f=>[`Hostile ${p.owner} -> ${p.territoryId}`,...f].slice(0,30)); });
    s.on('run:unlocked', p=>{ updateUnlocked(p.ids||[]); setFeed(f=>[`${p.user} unlocked ${(p.ids||[]).join(',')}`,...f].slice(0,30)); });
    return ()=>s.disconnect();
  },[]);

  const updateOwner = (tid, owner)=> setTerritories(t=>t.map(x=> x.id===tid ? { ...x, owner } : x));
  const updateUnlocked = (ids)=>{ if(!Array.isArray(ids)) ids=[]; setUnlocked(prev=>{ const next=Array.from(new Set([...prev,...ids])); setTerritories(t=> t.map(x=> next.includes(x.id)?{...x,unlocked:true}:x)); return next; }); };
  const updateOwnerAndFlash = (tid, owner)=>{ updateOwner(tid, owner); setFlash(f=>({...f,[tid]:true})); setTimeout(()=>setFlash(f=>{ const n={...f}; delete n[tid]; return n; }),1200); };

  const selectedTerr = territories.find(t=>t.id===selected) || territories[0];

  const handleBuy = async ()=>{ try{ const token=localStorage.getItem('token'); const res=await fetch(`${API}/buy-territory`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},body:JSON.stringify({ territoryId:selectedTerr.id })}); const j=await res.json(); if(j.ok){ setWallet(j.wallet); updateOwner(selectedTerr.id,userId); setFeed(f=>[`Bought ${selectedTerr.name}`,...f].slice(0,30)); } }catch(e){console.error(e);} };
  const handleHostile = async ()=>{ try{ const token=localStorage.getItem('token'); const res=await fetch(`${API}/hostile-takeover`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},body:JSON.stringify({ territoryId:selectedTerr.id, speed:15 })}); const j=await res.json(); if(j.ok){ setWallet(j.wallet); updateOwner(selectedTerr.id,userId); setFeed(f=>[`Hostile ${selectedTerr.name}`,...f].slice(0,30)); } }catch(e){console.error(e);} };

  const center=[14.587,120.98]; const bounds = territories.map(t=>bboxToPolygon(t.bbox)).flat();
  const makeTimestamps=(n,interval=20)=>{const now=Math.floor(Date.now()/1000); return Array.from({length:n},(_,i)=> now + i*interval); };

  const animateThenUpload = (points, sectorTag)=>{
    setFeed(f=>[`Run started ${sectorTag}`,...f].slice(0,30));
    return new Promise(resolve=>{
      let i=0; setRunnerPosition([points[0][0],points[0][1]]);
      animRef.current = setInterval(()=>{
        i++; if(i>=points.length){ clearInterval(animRef.current); animRef.current=null; setFeed(f=>[`Run animation ended ${sectorTag}`,...f].slice(0,30)); setFlash(fr=>({...fr,[selectedTerr.id]:true})); setTimeout(()=>setFlash(fr=>{const n={...fr}; delete n[selectedTerr.id]; return n;}),900);
          (async ()=>{ try{ const token=localStorage.getItem('token'); const payload={ routeCoordinates: points, durationSeconds: points.length*20, averageSpeed:8, sectorTag }; const res=await fetch(`${API}/run/upload-track`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},body:JSON.stringify(payload)}); const j=await res.json(); if(j.ok){ const r=j.result||j; updateUnlocked(r.unlocked_sectors||j.unlocked_sectors||[]); if(j.wallet) setWallet(j.wallet); if(r.total_km) setKms(k=>Math.round((k+Number(r.total_km))*100)/100); setFeed(f=>[`Run processed ₱${j.reward||0}`,...f].slice(0,30)); resolve(j); } else { setFeed(f=>['Run failed',...f].slice(0,30)); resolve(j);} }catch(e){ setFeed(f=>['Run error',...f].slice(0,30)); resolve({ok:false}); } })(); return; } setRunnerPosition([points[i][0],points[i][1]]); }, 500);
    });
  };

  const simulateTaftRun = ()=>{ const ts=makeTimestamps(8,20); const pts=[ [14.570,120.982,ts[0]],[14.571,120.983,ts[1]],[14.572,120.984,ts[2]],[14.573,120.985,ts[3]],[14.574,120.986,ts[4]],[14.5745,120.9865,ts[5]],[14.5735,120.9855,ts[6]],[14.5725,120.9845,ts[7]] ]; animateThenUpload(pts,'MNL_TAFT_01'); };
  const simulateIntramurosRun = ()=>{ const ts=makeTimestamps(6,20); const pts=[[14.588,120.973,ts[0]],[14.589,120.974,ts[1]],[14.5895,120.9745,ts[2]],[14.589,120.975,ts[3]],[14.5885,120.9745,ts[4]],[14.588,120.974,ts[5]]]; animateThenUpload(pts,'MNL_INTRA_01'); };

  return (
    <div className="h-screen w-screen relative">
      <MapContainer center={center} zoom={13} className="app-map">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png" attribution='&copy; CartoDB Dark Matter' />
        {territories.map(t=>{ const poly=bboxToPolygon(t.bbox); const owned=!!t.owner; const isUnlocked=!!t.unlocked||unlocked.includes(t.id); const color=owned?'var(--neon-red)':(isUnlocked?'var(--neon-green)':'var(--neon-yellow)'); return (
          <Polygon key={t.id} pathOptions={{ color, fillColor:color, fillOpacity:0.15, weight:2, className: flash[t.id] ? 'neon-flash' : '' }} positions={poly} eventHandlers={{ click: ()=>{ setSelected(t.id); setMiniOpen(true); setFeed(f=>[`Selected ${t.name}`,...f].slice(0,30)); } }} />
        ); })}
        {runnerPosition && (<Marker position={runnerPosition} icon={L.divIcon ? L.divIcon({ className:'runner-marker', html:'<div class="runner-dot"></div>', iconSize:[28,28], iconAnchor:[14,14] }) : undefined} />)}
        <FlyToBounds bounds={bounds} />
      </MapContainer>

      <div className="fixed right-4 top-6 w-72 z-[9999] bg-slate-900/90 backdrop-blur-md border border-cyan-500/30 p-3 rounded hud">
        <div className="flex items-center justify-between mb-2"><div><div className="text-xs text-gray-300">Profile</div><div className="text-lg font-bold glow">{username||'Guest'}</div></div><div className="text-right"><div className="text-xs text-gray-400">Faction</div><div className="font-semibold text-neon-blue">{faction||'—'}</div></div></div>
        <div className="grid grid-cols-3 gap-2 text-center mb-3"><div><div className="text-xs text-gray-400">Wallet</div><div className="font-bold">₱{wallet}</div></div><div><div className="text-xs text-gray-400">Kilometers</div><div className="font-bold">{kms} km</div></div><div><div className="text-xs text-gray-400">Selected</div><div className="font-bold">{selectedTerr.name}</div></div></div>
        <div className="flex gap-2 mb-2"><button onClick={()=>{ localStorage.removeItem('token'); location.reload(); }} className="px-2 py-1 rounded bg-gray-700 text-xs">Sign Out</button><button onClick={simulateTaftRun} className="text-xs px-2 py-1 rounded bg-blue-600/80">Simulate Taft</button><button onClick={simulateIntramurosRun} className="text-xs px-2 py-1 rounded bg-purple-600/80">Simulate Intra</button></div>
      </div>

      <div className={`mini-card ${miniOpen? 'open':''}`}>
        <div className="mini-head flex justify-between items-center"><div><div className="font-bold">{selectedTerr.name}</div><div className="text-xs text-gray-300">Owner: {selectedTerr.owner?selectedTerr.owner:'—'}</div></div><div className="text-right"><div className="text-xs">Sqm</div><div className="font-semibold">{calcSqm(selectedTerr.bbox)}</div></div></div>
        <div className="mt-2 flex gap-2"><button onClick={handleBuy} className={`flex-1 py-2 rounded ${unlocked.includes(selectedTerr.id)?'bg-[var(--neon-green)] text-black':'bg-gray-600 text-gray-300 cursor-not-allowed'}`}>Buy</button><button onClick={handleHostile} className="flex-1 py-2 rounded bg-[var(--neon-red)] text-white">Hostile</button></div>
        <div className="mini-close text-xs text-gray-400 mt-2 text-right"><button onClick={()=>setMiniOpen(false)}>Close</button></div>
      </div>

      <div className="activity-feed fixed right-4 bottom-4 w-80 max-h-60 overflow-hidden z-[9999]">{feed.map((m,i)=>(<div key={i} className="feed-item bg-black/50 border border-cyan-500/10 p-2 text-xs rounded mb-1 backdrop-blur">{m}</div>))}</div>
    </div>
  );
}
