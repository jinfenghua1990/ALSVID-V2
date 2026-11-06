import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { FieldLibDialog, ColorDictDialog } from '../Dialogs.jsx';

/* 产品列表：高密度表格为主（规范 2.2 / 15.3）
   整车列表字段：产品名称、型号、产品类型、SKU 数量、颜色数量、状态、操作
   零配件列表：增加品类、归属、适配车型；SKU 数量直接列出 */
function SkuCell({ skus }) {
  if (!skus || !skus.length) return <span className="hint">未生成</span>;
  return (
    <React.Fragment>
      <span className="tag sku">{skus[0].sku}</span>
      {skus.length > 1 && <span className="hint"> +{skus.length - 1}</span>}
    </React.Fragment>
  );
}

export function ListPage({ kind, meta, onEdit, onCreate }) {
  const [list, setList] = useState([]);
  const [kw, setKw] = useState('');
  const [showFields, setShowFields] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const isVehicle = kind === 'vehicle';

  const refresh = () => api.products(kind).then(setList);
  useEffect(() => { refresh(); }, [kind]);

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => [p.name, p.model, p.productType, p.ownership,
      ...(p.skus || []).map(s => s.sku)].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }, [list, kw]);

  const tplName = (code) => (meta.templates.find(t => t.code === code) || {}).name || code;
  const statusTag = (s) => {
    if (s === '启用') return <span className="tag on">启用</span>;
    if (s === '停用') return <span className="tag off">停用</span>;
    return <span className="tag plan">{s}</span>;
  };

  return (
    <div>
      <div className="toolbar">
        <input type="text" placeholder={isVehicle ? '搜索名称 / 型号 / SKU…' : '搜索名称 / 品类 / SKU / 适配车型…'}
          value={kw} onChange={e => setKw(e.target.value)} style={{ width: 260 }} />
        <span className="hint">共 {filtered.length} 项</span>
        <div className="spacer" />
        {isVehicle && <button className="btn" onClick={() => setShowColors(true)}>颜色字典</button>}
        <button className="btn" onClick={() => setShowFields(true)}>字段标准库</button>
        <button className="btn accent" onClick={() => onCreate(kind)}>新建{isVehicle ? '整车产品' : '零配件'}</button>
      </div>

      <table className="table">
        <thead><tr>
          <th>{isVehicle ? '产品名称' : '配件名称'}</th>
          {isVehicle && <th>型号</th>}
          <th>{isVehicle ? '产品类型' : '品类'}</th>
          {!isVehicle && <th>归属</th>}
          {!isVehicle && <th>适配车型</th>}
          {!isVehicle && <th>SKU</th>}
          {isVehicle && <th>SKU 数量</th>}
          {isVehicle && <th>颜色数量</th>}
          <th>状态</th>
          <th style={{ width: 130 }}>操作</th>
        </tr></thead>
        <tbody>
          {filtered.map(p => (
            <tr key={p.id}>
              <td><span className="link" onClick={() => onEdit(p.id)}>{p.name}</span></td>
              {isVehicle && <td style={{ fontFamily: 'Consolas, monospace' }}>{p.model}</td>}
              <td>{tplName(p.productType)}<span className="hint">（{p.productType}）</span></td>
              {!isVehicle && <td>{p.ownership}</td>}
              {!isVehicle && <td>{(p.fitments || []).map(f => f.vehicleModel).join('、') || <span className="hint">—</span>}</td>}
              {!isVehicle && <td><SkuCell skus={p.skus} /></td>}
              {isVehicle && <td>{p.skuCount}</td>}
              {isVehicle && <td>{p.colorCount}</td>}
              <td>{statusTag(p.status)}</td>
              <td>
                <button className="btn small" onClick={() => onEdit(p.id)}>编辑</button>
                <button className="btn small" style={{ marginLeft: 6 }} onClick={() => onEdit(p.id)}>查看</button>
              </td>
            </tr>
          ))}
          {!filtered.length && <tr><td colSpan={10} className="hint" style={{ textAlign: 'center', padding: 28 }}>
            暂无数据。SKU 数量不等于颜色数量：一款车型可能有多个电池容量 × 多个颜色组合。
          </td></tr>}
        </tbody>
      </table>

      {showFields && <FieldLibDialog onClose={() => setShowFields(false)} onChanged={refresh} />}
      {showColors && <ColorDictDialog onClose={() => setShowColors(false)} onChanged={refresh} />}
    </div>
  );
}

/* 新建产品：简洁抽屉式表单（规范 15.3）。按产品类型自动匹配模板字段在编辑器内加载。 */
export function CreateDrawer({ kind, meta, onClose, onCreated }) {
  const isVehicle = kind === 'vehicle';
  const tpls = meta.templates.filter(t => t.kind === kind);
  const [form, setForm] = useState({
    name: '', model: '', productType: tpls[0]?.code || '', status: '启用',
    ownership: isVehicle ? '' : 'UN', uses: isVehicle ? [] : ['生产使用'],
  });
  const [err, setErr] = useState('');

  const toggleUse = (u) => setForm(f => ({
    ...f, uses: f.uses.includes(u) ? f.uses.filter(x => x !== u) : [...f.uses, u],
  }));

  const submit = async () => {
    setErr('');
    if (!form.name.trim()) { setErr('名称必填'); return; }
    if (isVehicle && !form.model.trim()) { setErr('整车型号必填（同时作为 SKU 第一段编码）'); return; }
    try {
      const p = await api.createProduct({ ...form, kind });
      onCreated(p);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 560 }}>
        <div className="modal-head"><h3>新建{isVehicle ? '整车产品' : '零配件'}</h3>
          <button className="btn small" onClick={onClose}>关闭</button></div>
        <div className="modal-body">
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field fg-span"><label>名称 <span className="req">*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus /></div>
            {isVehicle && <div className="field"><label>型号（SKU 第一段，如 A1 / L1）<span className="req">*</span></label>
              <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value.toUpperCase() })} /></div>}
            {!isVehicle && <div className="field"><label>归属</label>
              <select value={form.ownership} onChange={e => setForm({ ...form, ownership: e.target.value })}>
                {meta.ownership.map(o => <option key={o.code} value={o.code}>{o.code} - {o.label}</option>)}
              </select></div>}
            <div className="field"><label>{isVehicle ? '产品类型' : '品类'}（决定加载哪套模板字段）</label>
              <select value={form.productType} onChange={e => setForm({ ...form, productType: e.target.value })}>
                {tpls.map(t => <option key={t.code} value={t.code}>{t.name}（{t.code}）</option>)}
              </select></div>
            <div className="field"><label>状态</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option>启用</option><option>停用</option><option>规划</option>
              </select></div>
            {!isVehicle && <div className="field fg-span"><label>用途（可多选，非互斥）</label>
              <div className="checkbox-row">
                {['生产使用', '售后维修', '单独销售'].map(u => (
                  <label key={u}><input type="checkbox" checked={form.uses.includes(u)} onChange={() => toggleUse(u)} />{u}</label>
                ))}
              </div></div>}
          </div>
          {err && <div className="error-text mt8">{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit}>创建并进入编辑器</button>
        </div>
      </div>
    </div>
  );
}
