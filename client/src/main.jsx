import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import PortalPage from './pages/PortalPage.jsx';
import './styles.css';

const portalKind = window.location.pathname === '/my' ? 'owner' : window.location.pathname === '/dealer' ? 'dealer' : null;
function AuthGate(){
  const [status,setStatus]=useState(null),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{const r=await fetch('/api/auth/status');if(!r.ok)throw Error('无法连接账号服务');setStatus(await r.json())};
  useEffect(()=>{refresh().catch(e=>setError(e.message))},[]);
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{if(!status.initialized){const r=await fetch('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await r.json();if(!r.ok)throw Error(data.error||'设置失败')}const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await r.json();if(!r.ok)throw Error(data.error||'登录失败');setPassword('');await refresh()}catch(e){setError(e.message);await refresh().catch(()=>{})}finally{setBusy(false)}};
  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});await refresh()};
  if(status?.user&&portalKind&&status.user.role!==portalKind)return <main style={{maxWidth:600,margin:'10vh auto',padding:24}}><h2>当前账号不属于此门户</h2><p>请使用对应的车主或经销商账号登录。</p><a href="/">返回我的工作区</a> <button className="btn" onClick={logout}>退出并切换账号</button></main>;
  if(status?.user)return <>{['owner','dealer'].includes(status.user.role)?<PortalPage user={status.user} onLogout={logout}/>:<App user={status.user} onLogout={logout}/>}<button onClick={logout} style={{position:'fixed',right:12,bottom:12,zIndex:1000}} className="btn">退出登录 · {status.user.username}</button></>;
  if(!status)return <div className="hint" style={{padding:24}}>{error||'正在连接…'}</div>;
  if(portalKind&&!status.initialized)return <main style={{padding:24}}>门户尚未开通，请联系管理员。</main>;
  return <main style={{maxWidth:420,margin:'10vh auto',padding:24}}><form className="card" onSubmit={submit}><h2>{status.initialized?(portalKind==='owner'?'登录车主中心':portalKind==='dealer'?'登录经销商中心':'登录 ALSVID'):'设置管理员账号'}</h2><p className="hint">{status.initialized?(portalKind?'账号由管理员核实身份或合作资格后开通。':'请输入内部账号和密码。'):'首次使用请创建管理员账号，密码为 8–20 个字符。'}</p><div className="field"><label>账号</label><input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required /></div><div className="field"><label>密码</label><input type="password" autoComplete={status.initialized?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={status.initialized?1:8} maxLength={status.initialized?200:20} /></div>{error&&<p className="error-text">{error}</p>}<button className="btn primary" disabled={busy} type="submit">{busy?'处理中…':status.initialized?'登录':'创建并登录'}</button></form></main>;
}
const catalogRoute = window.location.pathname.match(/^\/catalog\/(zh|en|de)(?:\/([^/]+))?\/?$/);
let productId;
try { productId = catalogRoute?.[2] ? decodeURIComponent(catalogRoute[2]) : undefined; } catch (_) { productId = catalogRoute[2]; }
createRoot(document.getElementById('root')).render(catalogRoute ? <CatalogPage lang={catalogRoute[1]} productId={productId} /> : <AuthGate />);
