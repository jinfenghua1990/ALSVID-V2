import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const blankVin = { vin: '', model: '', sku: '', orderNo: '', factory: '', batch: '', bomVersion: '', installed: '', serials: '', producedAt: '', status: '在用' };
const blankRepair = { vin: '', type: '质保维修', fault: '', sku: '', qty: 1, store: '', status: '待收货', oldPart: '' };
const blankSub = { originalSku: '', replacementSku: '', reason: '', effectiveAt: '', status: '启用', note: '' };

export function ServicePage({ section = 'vin', onSectionChange }) {
  const [vins, setVins] = useState([]); const [repairs, setRepairs] = useState([]); const [subs, setSubs] = useState([]); const [products, setProducts] = useState([]);
  const [q, setQ] = useState(''); const [form, setForm] = useState(null); const [err, setErr] = useState('');
  const [vinResults, setVinResults] = useState(null);
  const reload = async () => { const [v, r, s, p] = await Promise.all([api.vins(), api.repairs(), api.substitutes(), api.products()]); setVins(v); setRepairs(r); setSubs(s); setProducts(p); };
  useEffect(() => { reload(); setForm(null); setErr(''); }, [section]);
  useEffect(() => { let active=true; if(section!=='vin'||!q.trim()){setVinResults(null);return ()=>{active=false};} setVinResults([]);const timer=setTimeout(()=>api.vins(q.trim()).then(rows=>{if(active)setVinResults(rows)}).catch(e=>{if(active)setErr(e.message)}),250);return ()=>{active=false;clearTimeout(timer)}; }, [q,section]);
  const parts = products.filter(p => p.kind === 'part'); const vehicles = products.filter(p => p.kind === 'vehicle');
  const skuOptions = parts.flatMap(p => p.skus.map(s => ({ sku: s.sku, name: p.name })));
  const list = section === 'vin' ? vins : section === 'repair' ? repairs : section === 'substitute' ? subs : parts;
  const visible = useMemo(() => { const term = q.trim().toLowerCase(); if (!term) return list; if(section==='vin')return vinResults||[]; return list.filter(x => JSON.stringify(x).toLowerCase().includes(term)); }, [list, q, section, vinResults]);
  const submit = async () => { setErr(''); try { if (section === 'vin') await (form.id ? api.updateVin(form.id, form) : api.createVin(form)); if (section === 'repair') await (form.id ? api.updateRepair(form.id, form) : api.createRepair(form)); if (section === 'substitute') await api.createSubstitute(form); setForm(null); await reload(); } catch (e) { setErr(e.message); } };
  const title = { vin: 'VIN 车辆档案', repair: '维修工单', fit: '配件适配', substitute: '配件替代' }[section];
  return <div className="service-page">
    <div className="page-title"><div><h2>{title}</h2><span className="hint">服务与追溯资源 · 服务端校验后写入</span></div>{section !== 'fit' && <button className="btn accent" onClick={() => setForm(section === 'vin' ? { ...blankVin } : section === 'repair' ? { ...blankRepair } : { ...blankSub })}>新增{section === 'vin' ? '车辆档案' : section === 'repair' ? '维修工单' : '替代关系'}</button>}</div>
    <div className="tabs service-tabs">{[['vin','VIN 车辆档案'],['repair','维修工单'],['fit','配件适配'],['substitute','配件替代']].map(([k, label]) => <button key={k} className={'tab' + (section === k ? ' active' : '')} onClick={() => onSectionChange(k)}>{label}</button>)}</div>
    {form && <FormPanel section={section} form={form} setForm={setForm} products={products} vins={vins} skuOptions={skuOptions} onSubmit={submit} onClose={() => setForm(null)} error={err} />}
    {section === 'vin' && form?.id && <div className="card form-panel"><div className="section-title">关联维修记录</div>{repairs.filter(r => r.vin === form.vin).length ? <ul>{repairs.filter(r => r.vin === form.vin).map(r => <li key={r.id}>{r.no} · {r.fault} · {r.status} · {r.createdAt}</li>)}</ul> : <span className="hint">暂无维修记录</span>}</div>}
    {section === 'vin' && form?.id && <InstalledParts key={form.id} vinId={form.id} skuOptions={skuOptions} />}
    {section === 'vin' && form?.id && <ReplacementHistory key={'history-'+form.id} vinId={form.id} />}
    {section === 'repair' && form?.id && <RepairStock key={form.id} repair={form} />}
    {section === 'repair' && form?.id && form.status==='维修中' && <CompleteRepair key={'complete-'+form.id} repair={form} vin={vins.find(v=>v.vin===form.vin)} onDone={async()=>{setForm(null);await reload()}} />}
    {section === 'repair' && form?.id && ['已完成','已关闭'].includes(form.status) && <OldPartRecovery key={'old-'+form.id} repairId={form.id} />}
    {!form && section !== 'fit' && <div className="toolbar"><input type="text" placeholder={section==='vin'?'搜索 VIN / 配件 SKU / 批次 / 序列号…':'搜索 VIN / 工单 / SKU / 状态…'} value={q} onChange={e => setQ(e.target.value)} style={{ width: 300 }} /><span className="hint">共 {visible.length} 项</span></div>}
    {section === 'vin' && <VinTable rows={visible} onEdit={row => { setErr(''); setForm({ ...row }); }} onUpdate={async (id, status) => { try { await api.updateVin(id, { status }); await reload(); } catch (e) { setErr(e.message); } }} />}
    {section === 'repair' && <RepairTable rows={visible} onEdit={row => { setErr(''); setForm({ ...row }); }} onUpdate={async (id, status) => { try { await api.updateRepair(id, { status }); await reload(); } catch (e) { setErr(e.message); } }} />}
    {!form && err && <p className="error-text">{err}</p>}
    {section === 'substitute' && <SubTable rows={visible} onUpdate={async (id, status) => { await api.updateSubstitute(id, { status }); reload(); }} />}
    {section === 'fit' && <FitManager parts={parts} vehicles={vehicles} onSaved={reload} />}
  </div>;
}

function InstalledParts({vinId,skuOptions}) {
  const [items,setItems]=useState([]),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;api.vinTrace(vinId).then(v=>{if(active){setItems(v.installed||[]);setReady(true);}}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[vinId]);
  const update=(i,key,value)=>setItems(xs=>xs.map((x,j)=>i===j?{...x,[key]:value}:x));
  const save=async()=>{setBusy(true);setMessage('');try{await api.replaceInstalled(vinId,items);const trace=await api.vinTrace(vinId);setItems(trace.installed||[]);setMessage('实际装车明细已保存');}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  return <div className="card form-panel"><div className="section-title">实际装车明细</div><p className="hint">逐项记录实际安装的配件、批次和序列号；如有生产偏差，请记录原因及批准人。</p>{ready&&<><table className="table"><thead><tr><th>配件 SKU</th><th>数量</th><th>批次</th><th>序列号</th><th>偏差原因</th><th>批准人</th><th></th></tr></thead><tbody>{items.map((it,i)=><tr key={i}><td><select value={it.sku||''} onChange={e=>update(i,'sku',e.target.value)}><option value="">选择配件</option>{skuOptions.map(x=><option key={x.sku} value={x.sku}>{x.sku} · {x.name}</option>)}</select></td><td><input type="number" min="0.01" step="any" value={it.qty??1} onChange={e=>update(i,'qty',e.target.value)} style={{width:70}} /></td><td><input value={it.batch||''} onChange={e=>update(i,'batch',e.target.value)} /></td><td><input value={it.serial||''} onChange={e=>update(i,'serial',e.target.value)} /></td><td><input value={it.deviationReason||''} onChange={e=>update(i,'deviationReason',e.target.value)} /></td><td><input value={it.approvedBy||''} onChange={e=>update(i,'approvedBy',e.target.value)} /></td><td><button className="btn small danger" onClick={()=>setItems(xs=>xs.filter((_,j)=>j!==i))}>删除</button></td></tr>)}</tbody></table><div className="row mt16"><button className="btn" onClick={()=>setItems(xs=>[...xs,{sku:'',qty:1,batch:'',serial:'',deviationReason:'',approvedBy:''}])}>添加配件</button><button className="btn primary" disabled={busy} onClick={save}>保存实际装车明细</button></div></>}{message&&<p className="hint">{message}</p>}</div>;
}

function ReplacementHistory({vinId}) {
  const [rows,setRows]=useState([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;api.vinTrace(vinId).then(x=>{if(active)setRows(x.replacements||[])}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[vinId]);
  return <div className="card form-panel"><h3>配件更换履历</h3>{error&&<p className="error-text">{error}</p>}{rows.length?<table className="table"><thead><tr><th>原 SKU</th><th>原序列号 / 批次</th><th>新 SKU</th><th>新序列号 / 批次</th><th>数量</th><th>操作人</th><th>时间</th></tr></thead><tbody>{rows.map(x=><tr key={x.repairId}><td>{x.oldSku}</td><td>{x.oldSerial||'—'} / {x.oldBatch||'—'}</td><td>{x.newSku}</td><td>{x.newSerial||'—'} / {x.newBatch||'—'}</td><td>{x.quantity}</td><td>{x.actor}</td><td>{x.createdAt}</td></tr>)}</tbody></table>:<span className="hint">暂无配件更换记录</span>}</div>;
}

function OldPartRecovery({repairId}) {
  const [record,setRecord]=useState(null),[warehouses,setWarehouses]=useState([]),[status,setStatus]=useState(''),[warehouseId,setWarehouseId]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const reload=async()=>{const [r,w]=await Promise.all([api.oldPart(repairId),api.warehouses()]);setRecord(r);setWarehouses(w)};
  useEffect(()=>{reload().catch(e=>setError(e.message))},[repairId]);
  const choices={'待回收':['已退回'],'已退回':['检测中','返修中','已报废'],'检测中':['返修中','已报废'],'返修中':['检测中','已报废'],'已报废':[]}[record?.status]||[];
  const submit=async e=>{e.preventDefault();setError('');setBusy(true);try{await api.updateOldPart(repairId,{status,warehouseId,note});setStatus('');setWarehouseId('');setNote('');await reload()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="card form-panel"><h3>旧件回收</h3>{record&&<><p>旧 SKU：{record.oldSku} · 序列号：{record.oldSerial||'—'} · 批次：{record.oldBatch||'—'} · 数量：{record.quantity}</p><p>状态：{record.status} · 所在仓：{record.warehouse||'—'}</p><p className="hint">旧件记录不计入可用库存。</p>{!record.restock&&choices.length>0&&<form className="row" onSubmit={submit}><select value={status} required onChange={e=>setStatus(e.target.value)}><option value="">选择下一状态</option>{choices.map(x=><option key={x}>{x}</option>)}</select>{status==='已退回'&&<select required value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">选择退回仓库</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}<input value={note} onChange={e=>setNote(e.target.value)} required placeholder="处理说明"/><button disabled={busy} className="btn primary">记录状态</button></form>}<RestockOldPart repairId={repairId} record={record} onDone={reload} />{record.events?.length>0&&<ul>{record.events.map((x,i)=><li key={i}>{x.fromStatus} → {x.toStatus} · {x.note} · {x.actor} · {x.createdAt}</li>)}</ul>}</>}{error&&<p className="error-text">{error}</p>}</div>;
}

function RestockOldPart({repairId,record,onDone}) {
  const [note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const action=async name=>{setBusy(true);setError('');try{await api.oldPartRestock(repairId,name,{note});setNote('');await onDone()}catch(e){setError(e.message)}finally{setBusy(false)}};
  if(!record.restock&&!['检测中','返修中'].includes(record.status))return null;
  return <div className="card mt16"><h4>翻新件入库</h4>{record.restock?<><p>{record.restock.approvedAt?'已批准入库':'等待管理员批准'} · 申请人：{record.restock.requestedBy} · {record.restock.note}</p>{record.restock.approvedAt?<p>批准人：{record.restock.approvedBy}</p>:<div className="row"><button className="btn primary" disabled={busy} onClick={()=>action('approve')}>批准入库</button><button className="btn" disabled={busy} onClick={()=>action('cancel')}>撤销申请</button></div>}</>:<div className="row"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="翻新与检测说明"/><button className="btn" disabled={busy||!note.trim()} onClick={()=>action('request')}>申请入库</button></div>}{error&&<p className="error-text">{error}</p>}</div>;
}

function CompleteRepair({repair,vin,onDone}) {
  const [items,setItems]=useState([]),[installedId,setInstalledId]=useState(''),[serial,setSerial]=useState(''),[batch,setBatch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;if(vin)api.vinTrace(vin.id).then(t=>{if(active)setItems(t.installed||[])}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[vin?.id]);
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{await api.completeRepair(repair.id,{installedId,serial,batch});await onDone()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="card form-panel"><h3>完成更换</h3><p className="hint">选择实际拆下的配件并填写新件批次、序列号；净领用数量须与工单数量一致。</p><form onSubmit={submit} className="row"><select required value={installedId} onChange={e=>setInstalledId(e.target.value)}><option value="">选择原装配件</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} · 数量 {x.qty} · 序列号 {x.serial||'—'} · 批次 {x.batch||'—'}</option>)}</select><input value={batch} onChange={e=>setBatch(e.target.value)} placeholder="新件批次"/><input value={serial} onChange={e=>setSerial(e.target.value)} placeholder="新件序列号"/><button disabled={busy} className="btn primary">完成并记录更换</button></form>{error&&<p className="error-text">{error}</p>}</div>;
}

function RepairStock({repair}) {
  const [warehouses,setWarehouses]=useState([]),[events,setEvents]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState({id:crypto.randomUUID(),kind:'领用',warehouseId:'',quantity:1});
  const reload=async()=>{const [w,e]=await Promise.all([api.warehouses(),api.repairStock(repair.id)]);setWarehouses(w.filter(x=>x.kind==='维修店仓'));setEvents(e)};
  useEffect(()=>{reload().catch(e=>setError(e.message))},[repair.id]);
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{await api.repairStockMove(repair.id,form);setForm({id:crypto.randomUUID(),kind:'领用',warehouseId:'',quantity:1});await reload()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="card form-panel"><h3>维修工单领退料</h3><p className="hint">工单配件：{repair.sku||'尚未指定'}；领用从维修店仓扣减，退回增加同一仓库存。</p><form className="row mb12" onSubmit={submit}><select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option>领用</option><option>退回</option></select><select required value={form.warehouseId} onChange={e=>setForm({...form,warehouseId:e.target.value})}><option value="">选择维修店仓</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><input type="number" min="1" step="1" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/><button className="btn primary" disabled={busy||!repair.sku}>记录领退料</button></form>{error&&<p className="error-text">{error}</p>}<table className="table"><thead><tr><th>类型</th><th>配件 SKU</th><th>仓库</th><th>数量</th><th>操作人</th><th>时间</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{e.kind}</td><td>{e.sku}</td><td>{e.warehouse}</td><td>{e.quantity}</td><td>{e.actor}</td><td>{e.createdAt}</td></tr>)}</tbody></table></div>;
}

function FormPanel({ section, form, setForm, products, vins, skuOptions, onSubmit, onClose, error }) {
  const [bomVersions,setBomVersions]=useState([]);
  const [orders,setOrders]=useState([]);
  useEffect(()=>{let active=true;if(section==='vin')api.productionOrders().then(o=>{if(active)setOrders(o)}).catch(()=>{});return()=>{active=false}},[section]);
  const selectedVehicle=products.find(p=>p.kind==='vehicle'&&p.skus.some(s=>s.sku===form.sku));
  useEffect(()=>{let active=true;setBomVersions([]);if(section==='vin'&&selectedVehicle)api.bomVersions(selectedVehicle.id).then(v=>{if(active)setBomVersions(v)}).catch(()=>{});return()=>{active=false}},[section,selectedVehicle?.id]);
  const f = (key, label, opts = {}) => <div className="field"><label>{label}{opts.required && <span className="req">*</span>}</label>{opts.select ? <select value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value, ...(section==='vin'&&key==='sku'&&e.target.value!==form.sku?{bomVersion:''}:{}) })}><option value="">— 选择 —</option>{opts.select.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}</select> : <input type={opts.type || 'text'} value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder={opts.placeholder} />}</div>;
  const isVin = section === 'vin'; const isRepair = section === 'repair';
  const sku = skuOptions.map(x => ({ value: x.sku, label: `${x.sku} · ${x.name}` }));
  const vehicleSku = products.filter(p => p.kind === 'vehicle').flatMap(p => p.skus.map(s => ({ value: s.sku, label: `${s.sku} · ${p.name}` })));
  return <div className="card form-panel"><div className="section-title" style={{ marginTop: 0 }}>填写{isVin ? '车辆档案' : isRepair ? '维修工单' : '替代关系'}</div><div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
    {isVin && <>{f('vin','VIN 编码',{required:true,placeholder:'11–20 位 VIN'} )}{f('model','车型')}{f('sku','整车 SKU',{select: vehicleSku})}<div className="field"><label>生产订单</label><select value={form.orderNo||''} onChange={e=>{const o=orders.find(x=>x.orderNo===e.target.value);setForm({...form,orderNo:e.target.value,...(o?{sku:o.sku,bomVersion:o.bomVersion,factory:o.factory,batch:o.batch}:{})})}}><option value="">— 无订单 —</option>{orders.map(o=><option key={o.id} value={o.orderNo}>{o.orderNo} · {o.sku}</option>)}</select></div>{f('factory','生产工厂')}{f('batch','生产批次')}{f('bomVersion','BOM 版本',{select:bomVersions.map(x=>({value:x.version,label:`${x.version} · ${x.status}`}))})}{f('producedAt','生产日期',{type:'date'})}{f('status','状态',{select:['在用','停用','待交付']})}<div className="field fg-span">{f('installed','已装配件（简述）')}{f('serials','序列号记录')}</div></>}
    {isRepair && <>{f('vin','VIN 编码',{required:true,select:vins.map(v=>({value:v.vin,label:`${v.vin} · ${v.model || '未标车型'}`}))})}{f('type','工单类型',{select:['质保维修','付费维修','返厂检测']})}{f('fault','故障描述',{required:true})}{f('sku','更换配件',{select:sku})}{f('qty','数量',{type:'number'})}{f('store','维修店')}{f('status','状态',{select:['待收货','维修中','待配件','已完成','已关闭']})}{f('oldPart','旧件处理')}</>}
    {!isVin && !isRepair && <>{f('originalSku','原 SKU',{required:true,select:sku})}{f('replacementSku','替代 SKU',{required:true,select:sku})}{f('reason','变更原因',{required:true})}{f('effectiveAt','生效日期',{type:'date'})}{f('status','状态',{select:['启用','停用']})}{f('note','备注')}</>}
  </div><div className="row mt16">{error && <span className="error-text grow">{error}</span>}<button className="btn" onClick={onClose}>取消</button><button className="btn primary" onClick={onSubmit}>保存</button></div></div>;
}

function VinTable({ rows, onUpdate, onEdit }) { return <table className="table"><thead><tr><th>VIN</th><th>车型</th><th>整车 SKU</th><th>批次</th><th>生产日期</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(v => <tr key={v.id}><td className="mono">{v.vin}</td><td>{v.model || '—'}</td><td className="mono">{v.sku || '—'}</td><td>{v.batch || '—'}</td><td>{v.producedAt || '—'}</td><td><span className="tag on">{v.status}</span></td><td><button className="btn small" onClick={() => onEdit(v)}>编辑</button> <button className="btn small" onClick={() => onUpdate(v.id, v.status === '在用' ? '停用' : '在用')}>{v.status === '在用' ? '停用' : '启用'}</button></td></tr>)}{!rows.length && <Empty colSpan={7} text="尚无 VIN 档案。先建立车辆档案，再关联维修工单。" />}</tbody></table>; }
function RepairTable({ rows, onUpdate, onEdit }) { return <table className="table"><thead><tr><th>工单号</th><th>VIN</th><th>类型</th><th>故障</th><th>更换 SKU</th><th>维修店</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td className="mono">{r.no}</td><td className="mono">{r.vin}</td><td>{r.type}</td><td>{r.fault}</td><td className="mono">{r.sku || '—'}</td><td>{r.store || '—'}</td><td><span className={'tag ' + (r.status === '已完成' || r.status === '已关闭' ? 'on' : 'plan')}>{r.status}</span></td><td><button className="btn small" onClick={() => onEdit(r)}>编辑</button> {r.status === '维修中' ? <button className="btn small" onClick={() => onEdit(r)}>记录更换</button> : !['已完成','已关闭'].includes(r.status) && <button className="btn small" onClick={() => onUpdate(r.id, '维修中')}>开始维修</button>}</td></tr>)}{!rows.length && <Empty colSpan={8} text="尚无维修工单。" />}</tbody></table>; }
function SubTable({ rows, onUpdate }) { return <table className="table"><thead><tr><th>原 SKU</th><th>替代 SKU</th><th>变更原因</th><th>生效日期</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>{rows.map(s => <tr key={s.id}><td className="mono">{s.originalSku}</td><td className="mono">{s.replacementSku}</td><td>{s.reason}</td><td>{s.effectiveAt}</td><td><span className="tag on">{s.status}</span></td><td>{s.note || '—'}</td><td><button className="btn small" onClick={() => onUpdate(s.id, s.status === '启用' ? '停用' : '启用')}>{s.status === '启用' ? '停用' : '启用'}</button></td></tr>)}{!rows.length && <Empty colSpan={7} text="尚无替代关系。" />}</tbody></table>; }
function Empty({ colSpan, text }) { return <tr><td colSpan={colSpan} className="hint empty-cell">{text}</td></tr>; }

function FitManager({ parts, vehicles, onSaved }) {
  const [partId, setPartId] = useState(parts[0]?.id || ''); const [fits, setFits] = useState([]); const [note, setNote] = useState({}); const [msg, setMsg] = useState('');
  const part = parts.find(p => p.id === partId);
  useEffect(() => { if (parts[0] && !partId) setPartId(parts[0].id); }, [parts]);
  useEffect(() => { setFits(part?.fitments || []); setNote(Object.fromEntries((part?.fitments || []).map(x => [x.vehicleModel, x.note || '']))); }, [partId, part?.version]);
  const has = model => fits.some(x => x.vehicleModel === model);
  const toggle = model => setFits(xs => has(model) ? xs.filter(x => x.vehicleModel !== model) : [...xs, { vehicleModel: model, note: '' }]);
  const save = async () => { if (!part) return; await api.updateProduct(part.id, { fitments: fits.map(x => ({ ...x, note: note[x.vehicleModel] || '' })) }); setMsg('适配关系已保存'); onSaved(); };
  return <div className="card"><div className="row mb12"><div className="field" style={{ width: 360 }}><label>选择零配件</label><select value={partId} onChange={e => setPartId(e.target.value)}>{parts.map(p => <option key={p.id} value={p.id}>{p.name} · {p.productType}</option>)}</select></div><span className="hint grow">适配关系独立于 SKU 编码维护，同一配件可以关联多个车型。</span>{msg && <span className="tag on">{msg}</span>}</div>{part ? <table className="table"><thead><tr><th style={{ width: 60 }}>适配</th><th>车型</th><th>整车产品</th><th>适配说明 / 条件</th></tr></thead><tbody>{vehicles.map(v => <tr key={v.id}><td><input type="checkbox" checked={has(v.model)} onChange={() => toggle(v.model)} /></td><td className="mono">{v.model}</td><td>{v.name}</td><td>{has(v.model) ? <input value={note[v.model] || ''} onChange={e => setNote({ ...note, [v.model]: e.target.value })} placeholder="如适用批次、接口条件" /> : <span className="hint">—</span>}</td></tr>)}</tbody></table> : <div className="hint">尚无零配件可维护适配关系。</div>}<div className="row mt16"><button className="btn primary" onClick={save} disabled={!part}>保存适配关系</button></div></div>;
}
