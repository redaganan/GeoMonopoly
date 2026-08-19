import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, useMap, Tooltip } from 'react-leaflet';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
const TEST_USER = import.meta.env.VITE_TEST_USER_ID || '6a8576953d08ecff83214952'; // Runner_Malate from seed

const territoriesInit = [
  { id:'6a8576953d08ecff83214954', name:'Taft Avenue', bbox:[14.568,120.976,14.576,120.988], owner:null },
  { id:'6a8576953d08ecff83214955', name:'Intramuros Plaza Roma', bbox:[14.587,120.971,14.591,120.976], owner:null },
  { id:'6a8576953d08ecff83214956', name:'España Blvd', bbox:[14.596,120.989,14.605,120.998], owner:null }
];

const bboxToPolygon = ([minLat,minLng,maxLat,maxLng])=>[
  [minLat,minLng],[minLat,maxLng],[maxLat,maxLng],[maxLat,minLng]
];

function FlyToBounds({ bounds }){
  const map = useMap();
  useEffect(()=>{ if(bounds) map.fitBounds(bounds, { padding:[40,40] }); },[bounds,map]);
  return null;
}

export default function Dashboard(){
  const [territories,setTerritories] = useState(territoriesInit);
  const [selected,setSelected] = useState(territoriesInit[0].id);
  const [wallet,setWallet] = useState(5000);
  const [kms,setKms] = useState(0);
  const [faction] = useState('Neon Runners');
  const socketRef = useRef(null);

  const [flash,setFlash] = useState({});
  useEffect(()=>{
    const s = io(SOCKET, { transports:['websocket'], autoConnect:true });
    socketRef.current = s;
    s.on('connect', ()=>console.log('socket connected', s.id));
    s.on('wallet', ({ userId, wallet })=>{ if(String(userId)===String(TEST_USER)) setWallet(wallet); });
    s.on('territory:buy', ({ territoryId, owner })=> updateOwnerAndFlash(territoryId, owner));
    s.on('territory:hostile', ({ territoryId, owner })=> updateOwnerAndFlash(territoryId, owner));
    return ()=>{ s.disconnect(); };
  },[]);

  const updateOwner = (tid, owner)=> setTerritories(t=>t.map(x=> x.id===tid ? { ...x, owner } : x));
  const updateOwnerAndFlash = (tid, owner)=>{
    updateOwner(tid, owner);
    setFlash(f=>({...f,[tid]:true}));
    setTimeout(()=>setFlash(f=>{ const n={...f}; delete n[tid]; return n; }),1200);
  };

  const selectedTerr = territories.find(t=>t.id===selected) || territories[0];

  const handleBuy = async ()=>{
    try{
      const res = await fetch(`${API}/buy-territory`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ userId:TEST_USER, territoryId:selectedTerr.id }) });
      const j = await res.json(); if(j.ok) setWallet(j.wallet);
    }catch(e){ console.error(e); }
  };
  const handleHostile = async ()=>{
    try{
      const res = await fetch(`${API}/hostile-takeover`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ challengerId:TEST_USER, territoryId:selectedTerr.id, speed:15 }) });
      const j = await res.json(); if(j.ok) setWallet(j.wallet);
    }catch(e){ console.error(e); }
  };

  const center = [14.587,120.98];
  const bounds = territories.map(t=>bboxToPolygon(t.bbox)).flat();

  return (
    <div className="h-screen w-screen relative">
      <MapContainer center={center} zoom={13} className="app-map">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
          attribution='&copy; CartoDB Dark Matter'
        />
        {territories.map(t=>{
          const poly = bboxToPolygon(t.bbox);
          const owned = !!t.owner;
          const color = owned ? 'var(--neon-red)' : 'var(--neon-green)';
          return (
            <Polygon
              key={t.id}
              pathOptions={{ color, fillColor:color, fillOpacity:0.15, weight:2, className: flash[t.id] ? 'neon-flash' : '' }}
              positions={poly}
              eventHandlers={{ click: ()=>setSelected(t.id) }}
            >
              <Tooltip direction="top" offset={[0,-6]} opacity={0.95}>
                <div className="text-xs">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-[11px] text-gray-200">{t.owner ? (String(t.owner)===String(TEST_USER)?'Owner: You':`Owner: ${String(t.owner).slice(0,6)}...`) : 'Unowned - Neon Grid'}</div>
                </div>
              </Tooltip>
            </Polygon>
          );
        })}
        <FlyToBounds bounds={bounds} />
      </MapContainer>

      {/* HUD */}
      <div className="fixed right-4 top-6 w-72 z-[9999] bg-slate-900/90 backdrop-blur-md border border-cyan-500/30 p-3 rounded">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-gray-300">Profile</div>
            <div className="text-lg font-bold glow">Runner_Malate</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">Faction</div>
            <div className="font-semibold text-neon-blue">{faction}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div>
            <div className="text-xs text-gray-400">Wallet</div>
            <div className="font-bold">₱{wallet}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Kilometers</div>
            <div className="font-bold">{kms} km</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Selected</div>
            <div className="font-bold">{selectedTerr.name}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleBuy} className="flex-1 py-2 rounded bg-[var(--neon-green)] text-black font-semibold">Buy</button>
          <button onClick={handleHostile} className="flex-1 py-2 rounded bg-[var(--neon-red)] text-white font-semibold">Hostile</button>
        </div>
        <div className="mt-3 text-xs text-gray-400">Tip: Click polygon to select territory. Live updates via socket.</div>
      </div>
    </div>
  );
}
