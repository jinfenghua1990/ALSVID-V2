import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

function AuthGate(){
  const [status,setStatus]=useState(null),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{const r=await fetch('/api/auth/status');if(!r.ok)throw Error('无法连接账号服务');setStatus(await r.json())};
  useEffect(()=>{refresh().catch(e=>setError(e.message))},[]);
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{if(!status.initialized){const r=await fetch('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await r.json();if(!r.ok)throw Error(data.error||'设置失败')}const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await r.json();if(!r.ok)throw Error(data.error||'登录失败');setPassword('');await refresh()}catch(e){setError(e.message);await refresh().catch(()=>{})}finally{setBusy(false)}};
  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});await refresh()};
  if(status?.user)return <><App user={status.user} onLogout={logout}/><button onClick={logout} style={{position:'fixed',right:12,bottom:12,zIndex:1000}} className="btn">退出登录 · {status.user.username}</button></>;
  if(!status)return <div className="hint" style={{padding:24}}>{error||'正在连接…'}</div>;
  return <main style={{maxWidth:420,margin:'10vh auto',padding:24}}><form className="card" onSubmit={submit}><h2>{status.initialized?'登录 ALSVID':'设置管理员账号'}</h2><p className="hint">{status.initialized?'请输入管理员账号和密码。':'首次使用请创建管理员账号，密码为 8–20 个字符。'}</p><div className="field"><label>账号</label><input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required /></div><div className="field"><label>密码</label><input type="password" autoComplete={status.initialized?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={status.initialized?1:8} maxLength={status.initialized?200:20} /></div>{error&&<p className="error-text">{error}</p>}<button className="btn primary" disabled={busy} type="submit">{busy?'处理中…':status.initialized?'登录':'创建并登录'}</button></form></main>;
}
createRoot(document.getElementById('root')).render(<AuthGate />);
