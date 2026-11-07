import React, { useEffect, useState } from 'react';

export async function portalRequest(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json(); if (!r.ok) throw Error(data.error || '操作失败'); return data;
}
export const requestStatus = { pending: '待审核', approved: '已批准', rejected: '未通过', revoked: '已撤销' };
export const serviceStatus = { submitted: '待受理', accepted: '已受理', rejected: '未受理' };
export default function PortalPage({ user, onLogout }) {
  const [vehicles, setVehicles] = useState([]), [requests, setRequests] = useState([]), [loaded, setLoaded] = useState(false);
  const [vin, setVin] = useState(''), [note, setNote] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [oldPassword, setOldPassword] = useState(''), [newPassword, setNewPassword] = useState('');
  const [services, setServices] = useState([]), [service, setService] = useState(() => ({ id: crypto.randomUUID(), vinId: '', description: '' }));
  const reload = async () => { const [v, r, s] = await Promise.all([portalRequest('/api/portal/vehicles'), portalRequest('/api/portal/vehicle-requests'), portalRequest('/api/portal/service-requests')]); setVehicles(v); setRequests(r); setServices(s); setLoaded(true); };
  useEffect(() => { reload().catch(e => setMessage(e.message)); }, []);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await portalRequest('/api/portal/vehicle-requests', 'POST', { vin, note }); setVin(''); setNote(''); await reload(); setMessage('申请已提交，管理员核实并批准后才会显示车辆资料。'); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const password = async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await portalRequest('/api/portal/password', 'POST', { oldPassword, newPassword }); setOldPassword(''); setNewPassword(''); await onLogout(); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const submitService = async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await portalRequest('/api/portal/service-requests', 'POST', service); setService({ id: crypto.randomUUID(), vinId: '', description: '' }); await reload(); setMessage('服务申请已提交，受理后可查看工单进度。'); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 16px 80px' }}>
    <header className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 24 }}><div><h1>ALSVID · {user.role === 'owner' ? '车主中心' : '经销商中心'}</h1><p className="hint">{user.username}</p></div><a href="/catalog/zh">浏览产品目录</a></header>
    {message && <p role="status" className="card" style={{ marginBottom: 16 }}>{message}</p>}
    <section className="card" style={{ marginBottom: 20 }}><h2>{user.role === 'owner' ? '我的车辆' : '获授权的车辆'}</h2><p className="hint">仅显示管理员已批准给此账号的车辆。</p>{!loaded ? <button className="btn" onClick={() => reload().catch(e => setMessage(e.message))}>加载车辆</button> : vehicles.length ? vehicles.map(v => <article className="card" key={v.id} style={{ marginTop: 12 }}><h3>{v.model || '车辆档案'}</h3><p>VIN：{v.vin}</p>{v.producedAt && <p>生产日期：{String(v.producedAt).slice(0, 10)}</p>}</article>) : <p style={{ marginTop: 16 }}>暂无已批准的车辆。</p>}</section>
    <section className="card" style={{ marginBottom: 20 }}><h2>申请车辆授权</h2><p className="hint">请填写 VIN 和购车或合作凭证说明，管理员核实后处理。提交申请不会自动绑定车辆。</p><form onSubmit={submit}><fieldset disabled={busy} style={{ border: 0 }}><div className="field"><label htmlFor="portal-vin">VIN</label><input id="portal-vin" value={vin} onChange={e => setVin(e.target.value)} minLength={11} maxLength={20} required /></div><div className="field"><label htmlFor="portal-note">购车或合作凭证说明</label><textarea id="portal-note" rows={4} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} required /></div><button className="btn primary">提交审核</button></fieldset></form></section>
    <section className="card" style={{ marginBottom: 20 }}><h2>我的申请</h2>{loaded && !requests.length && <p className="hint">尚未提交申请。</p>}{requests.map(r => <article key={r.id} style={{ borderTop: '1px solid #dfe3e8', padding: '16px 0', overflowWrap: 'anywhere' }}><h3>{r.vin} · {requestStatus[r.status]}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{r.note}</p>{r.decisionNote && <p>审核回复：{r.decisionNote}</p>}</article>)}</section>
    <section className="card" style={{ marginBottom: 20 }}><h2>申请售后服务</h2>{vehicles.length ? <form onSubmit={submitService}><fieldset disabled={busy} style={{ border: 0 }}><div className="field"><label htmlFor="service-vehicle">选择已获授权的车辆</label><select id="service-vehicle" required value={service.vinId} onChange={e => setService({ ...service, id: crypto.randomUUID(), vinId: e.target.value })}><option value="">请选择车辆</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.vin} · {v.model}</option>)}</select></div><div className="field"><label htmlFor="service-description">故障或服务需求</label><textarea id="service-description" required rows={4} maxLength={2000} value={service.description} onChange={e => setService({ ...service, id: crypto.randomUUID(), description: e.target.value })} /></div><button className="btn primary">提交服务申请</button></fieldset></form> : <p className="hint">车辆授权批准后可提交服务申请。</p>}<h3 style={{ marginTop: 24 }}>我的服务进度</h3>{!services.length && <p className="hint">暂无服务申请。</p>}{services.map(s => <article key={s.id} style={{ borderTop: '1px solid #dfe3e8', padding: '16px 0', overflowWrap: 'anywhere' }}><h4>{s.vin} · {serviceStatus[s.status]}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{s.description}</p>{s.replyNote && <p>服务回复：{s.replyNote}</p>}{s.workOrderNo && <p>工单 {s.workOrderNo} · {s.repairStatus}</p>}</article>)}</section>
    <section className="card"><h2>修改密码</h2><p className="hint">首次使用管理员提供的密码后，请修改为自己的密码。</p><form onSubmit={password}><fieldset disabled={busy} style={{ border: 0 }}><div className="field"><label htmlFor="portal-old-password">原密码</label><input id="portal-old-password" type="password" autoComplete="current-password" required value={oldPassword} onChange={e => setOldPassword(e.target.value)} /></div><div className="field"><label htmlFor="portal-new-password">新密码</label><input id="portal-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={20} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></div><button className="btn">修改并重新登录</button></fieldset></form></section>
  </main>;
}
