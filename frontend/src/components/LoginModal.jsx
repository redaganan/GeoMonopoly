import React, { useState, useEffect } from 'react';
const API = 'http://localhost:4000/api';
export default function LoginModal(){
  const [mode,setMode]=useState('login');
  const [f,setF]=useState({email:'',password:'',name:'',faction:'Neon Runners'});
  useEffect(()=>{
    const initGoogle = ()=>{
      try{
        const cid = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
        if(!window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({ client_id: cid, callback: async resp => {
          try{ const r = await fetch(API + '/auth/google', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ credential: resp.credential }) }); const j = await r.json(); if(j.ok){ localStorage.setItem('token', j.token); location.reload(); } else alert(j.error||'google auth failed'); }catch(e){ console.error(e); }
        } });
        window.google.accounts.id.renderButton(document.getElementById('gbtn'), { theme:'outline', size:'large' });
      }catch(e){ console.error('g init',e); }
    };
    // poll until google lib loads (script is async)
    if(window.google?.accounts?.id) initGoogle(); else{
      const h = setInterval(()=>{ if(window.google?.accounts?.id){ initGoogle(); clearInterval(h); } },300);
      return ()=>clearInterval(h);
    }
  },[]);
  const submit=async e=>{ e.preventDefault(); try{ const url= API + (mode==='login'? '/auth/login' : '/auth/signup'); const body = mode==='login' ? { email:f.email, password:f.password } : { name:f.name, email:f.email, password:f.password, faction:f.faction }; const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const j=await r.json(); if(j.ok){ localStorage.setItem('token', j.token); location.reload(); }else alert(j.error||'auth failed'); }catch(e){alert('err') }};
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="w-96 p-5 bg-slate-900/95 border border-cyan-500/30 rounded">
        <div className="flex justify-between items-center mb-3"><div className="text-lg font-bold glow">GeoMonopoly</div>
          <div className="text-xs text-gray-300">{mode==='login'?'Login':'Sign up'}</div></div>
        <form onSubmit={submit} className="space-y-2">
          {mode==='signup' && <input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Name" className="w-full p-2 rounded bg-black/30" />}
          <input value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="Email" className="w-full p-2 rounded bg-black/30" />
          <input value={f.password} onChange={e=>setF({...f,password:e.target.value})} placeholder="Password" type="password" className="w-full p-2 rounded bg-black/30" />
          <div className="flex gap-2"><button className="flex-1 py-2 bg-[var(--neon-green)] text-black rounded" type="submit">{mode==='login'?'Login':'Sign up'}</button>
          <button type="button" onClick={()=>setMode(mode==='login'?'signup':'login')} className="flex-1 py-2 bg-[var(--neon-blue)] text-black rounded">{mode==='login'?'Create account':'Back to login'}</button></div>
        </form>
        <div className="mt-3 text-center text-sm text-gray-300">or</div>
        <div id="gbtn" className="mt-3 flex justify-center"></div>
      </div>
    </div>
  );
}
