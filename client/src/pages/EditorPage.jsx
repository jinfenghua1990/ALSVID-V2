import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { ColorDictDialog } from '../Dialogs.jsx';
import { CloudImage } from '../cloud.jsx';

const TABS_VEHICLE = ['基本信息', '技术参数', 'SKU 规格', 'BOM', '图片资料'];
const TABS_PART = ['基本信息', '技术参数', 'SKU 规格', '适配关系', '图片资料'];

/* 统一编辑器（规范第 3 章）：整车和零配件共用编辑器框架，
   根据产品类型显示不同 TAB；不显示与当前产品类型无关的字段和 TAB。 */
export function EditorPage({ id, meta, onBack }) {
  const [p, setP] = useState(null);
  const [fields, setFields] = useState([]);
  const [colors, setColors] = useState([]);
  const [tab, setTab] = useState('基本信息');
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState('');
  const isVehicle = p?.kind === 'vehicle';

  const refresh = async () => {
    setP(await api.product(id));
    setFields(await api.fields());
    setColors(await api.colors());
  };
  useEffect(() => { refresh(); }, [id]);

  const notify = (msg, isErr) => {
    setToast({ msg, err: !!isErr });
    setTimeout(() => setToast(null), 2600);
  };

  if (!p) return <div className="hint">加载中…</div>;

  const tabs = isVehicle ? TABS_VEHICLE : TABS_PART;

  return (
    <div>
      {toast && <div className={'toast' + (toast.err ? ' err' : '')}>{toast.msg}</div>}
      <div className="editor-head">
        <button className="btn small" onClick={onBack}>← 返回列表</button>
        <h2>{p.name}</h2>
        <span className="tag sku" style={{ fontFamily: 'Consolas, monospace' }}>{p.ownership}-{p.productType}-…</span>
        <span className="tag">{isVehicle ? '整车产品' : '零配件'}</span>
        <span className="tag">{(meta.templates.find(t => t.code === p.productType) || {}).name}</span>
      </div>
      {err && <div className="error-text mb12">{err}</div>}
      <div className="tabs">
        {tabs.map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div className="editor-tab-content" key={tab}>
      {tab === '基本信息' && <BasicTab p={p} meta={meta} onSaved={() => { refresh(); notify('已保存'); }} notify={notify} />}
      {tab === '技术参数' && <TechTab p={p} fields={fields} onSaved={() => { refresh(); notify('技术参数已保存'); }} notify={notify} />}
      {tab === 'SKU 规格' && <SkuTab p={p} meta={meta} colors={colors} fields={fields}
        onChanged={refresh} notify={notify} />}
      {tab === 'BOM' && isVehicle && <BomTab p={p} meta={meta} onChanged={refresh} notify={notify} />}
      {tab === '适配关系' && !isVehicle && <FitTab p={p} onChanged={refresh} notify={notify} />}
      {tab === '图片资料' && <ImagesTab p={p} onChanged={refresh} notify={notify} />}
      </div>
    </div>
  );
}

/* ---------------- 基本信息 ---------------- */
function BasicTab({ p, meta, onSaved, notify }) {
  const [form, setForm] = useState({ name: p.name, model: p.model, status: p.status, ownership: p.ownership, uses: p.uses || [] });
  const isVehicle = p.kind === 'vehicle';
  const hasSku = p.skus.length > 0;
  const lockCode = hasSku; // 已存在 SKU 的产品：归属/品类不可改（SKU 含义不得改写）

  const save = async () => {
    try { await api.updateProduct(p.id, form); onSaved(); }
    catch (e) { notify(e.message, true); }
  };

  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="field"><label>名称</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        {isVehicle ? (
          <div className="field"><label>型号（SKU 第一段）</label>
            <input value={form.model} disabled={lockCode}
              onChange={e => setForm({ ...form, model: e.target.value.toUpperCase() })} /></div>
        ) : (
          <div className="field"><label>归属（SKU 第一段）</label>
            <select value={form.ownership} disabled={lockCode}
              onChange={e => setForm({ ...form, ownership: e.target.value })}>
              {meta.ownership.map(o => <option key={o.code} value={o.code}>{o.code} - {o.label}</option>)}
            </select></div>
        )}
        <div className="field"><label>{isVehicle ? '产品类型（SKU 第二段品类编码）' : '品类编码'}</label>
          <input value={p.productType} disabled title="品类编码创建后不变更" /></div>
        <div className="field"><label>状态</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option>启用</option><option>停用</option><option>规划</option>
          </select></div>
        {!isVehicle && (
          <div className="field fg-span"><label>用途（可多选，非互斥）</label>
            <div className="checkbox-row">
              {['生产使用', '售后维修', '单独销售'].map(u => (
                <label key={u}><input type="checkbox" checked={form.uses.includes(u)}
                  onChange={() => setForm(f => ({ ...f, uses: f.uses.includes(u) ? f.uses.filter(x => x !== u) : [...f.uses, u] }))} />{u}</label>
              ))}
            </div></div>
        )}
      </div>
      {lockCode && <div className="warn mt8">该产品已生成 SKU，归属/品类编码不可修改，避免改写既有 SKU 的含义。</div>}
      <div className="row mt16"><button className="btn primary" onClick={save}>保存</button></div>
    </div>
  );
}

/* ---------------- 技术参数（模板字段自动加载，产品级） ---------------- */
function TechTab({ p, fields, onSaved, notify }) {
  const [specs, setSpecs] = useState({ ...p.specs });
  const tplFields = useMemo(() => fields.filter(
    f => f.enabled && f.level === 'product' && (f.templates || []).includes(p.productType)), [fields, p.productType]);
  const others = useMemo(() => fields.filter(
    f => f.enabled && f.level === 'product' && !(f.templates || []).includes(p.productType)
      && p.specs[f.code] !== undefined), [fields, p.productType, p.specs]);

  const save = async () => {
    try { await api.updateProduct(p.id, { specs }); onSaved(); }
    catch (e) { notify(e.message, true); }
  };

  const renderField = (f) => (
    <div className="field" key={f.code}>
      <label>{f.nameZh}{f.unit ? `（${f.unit}）` : ''}{f.required && <span className="req">*</span>}</label>
      {f.type === 'enum' ? (
        <select value={specs[f.code] || ''} onChange={e => setSpecs({ ...specs, [f.code]: e.target.value })}>
          <option value="">— 选择 —</option>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={f.type === 'number' ? 'number' : 'text'} value={specs[f.code] || ''}
          onChange={e => setSpecs({ ...specs, [f.code]: e.target.value })} />
      )}
    </div>
  );

  return (
    <div className="card" style={{ maxWidth: 980 }}>
      <div className="hint mb12">以下字段来自「{p.productType}」品类模板（全局字段标准库），同类产品自动加载，无需重复录入。</div>
      {tplFields.length ? (
        <div className="form-grid">{tplFields.map(renderField)}</div>
      ) : <div className="hint">该品类模板暂无产品级字段，可在「字段标准库」中新增并分配给此模板。</div>}
      {!!others.length && (
        <>
          <div className="section-title">本产品单独启用的字段</div>
          <div className="form-grid">{others.map(renderField)}</div>
        </>
      )}
      <div className="row mt16"><button className="btn primary" onClick={save}>保存技术参数</button></div>
    </div>
  );
}

/* ---------------- SKU 规格（四段式：归属-品类-规格-颜色） ---------------- */
function SkuTab({ p, meta, colors, fields, onChanged, notify }) {
  const isVehicle = p.kind === 'vehicle';
  const specOptions = meta.specOptions[p.productType] || ['STD'];
  const enabledColors = colors.filter(c => c.enabled);
  const [sel, setSel] = useState({}); // "spec|color" -> price
  const [showColor, setShowColor] = useState(false);

  const skuFields = useMemo(() => fields.filter(
    f => f.enabled && f.level === 'sku' && (f.templates || []).includes(p.productType) && !f.skuGen), [fields, p.productType]);

  const toggle = (spec, color) => setSel(s => {
    const k = `${spec}|${color}`;
    const n = { ...s };
    if (k in n) delete n[k]; else n[k] = '';
    return n;
  });

  const generate = async () => {
    const items = Object.entries(sel).map(([k, price]) => {
      const [spec, color] = k.split('|');
      return { spec, color, price };
    });
    if (!items.length) { notify('请先在矩阵中勾选要生成的有效组合', true); return; }
    try {
      const r = await api.addSkus(p.id, items);
      setSel({});
      onChanged();
      notify(`已生成 ${r.added.length} 个 SKU${r.skipped.length ? `，跳过 ${r.skipped.length} 个重复编码` : ''}${r.skipped.length ? '：' + r.skipped.map(s => s.sku).join('、') : ''}`, r.skipped.length > 0);
    } catch (e) { notify(e.message, true); }
  };

  const removeSku = async (sku) => {
    if (!window.confirm(`确认删除 SKU「${sku}」？\n若该 SKU 已用于订单、库存、生产或售后，删除会导致追溯断裂。`)) return;
    try { await api.deleteSku(p.id, sku); onChanged(); notify('已删除'); }
    catch (e) { notify(e.message, true); }
  };

  return (
    <div>
      <div className="card mb12">
        <div className="row mb12">
          <div className="section-title grow" style={{ margin: 0 }}>生成新 SKU</div>
          <span className="hint">结构：<b>归属（2位）- 品类（3位）- 动态规格（3位）- 颜色（3位）</b>，如 A1-FEB-450-BLK</span>
          <button className="btn" onClick={() => setShowColor(true)}>新增颜色</button>
        </div>
        <div className="hint mb12">
          当前归属 <b style={{ fontFamily: 'Consolas, monospace' }}>{p.ownership}</b>（{isVehicle ? `车型 ${p.ownership}` : (meta.ownership.find(o => o.code === p.ownership) || {}).label}），
          品类 <b style={{ fontFamily: 'Consolas, monospace' }}>{p.productType}</b>。
          只勾选真实可销售、可库存的有效组合，不做无效笛卡尔积。
        </div>
        <div className="sku-matrix">
          <table className="table matrix-table" style={{ width: 'auto' }}>
            <thead><tr><th>规格 \ 颜色</th>
              {enabledColors.map(c => <th key={c.code}><span className="color-dot" style={{ background: c.hex }} />{c.code}<div className="hint">{c.zh}</div></th>)}
            </tr></thead>
            <tbody>
              {specOptions.map(spec => (
                <tr key={spec}>
                  <td style={{ fontFamily: 'Consolas, monospace', fontWeight: 600 }}>{spec}</td>
                  {enabledColors.map(c => {
                    const k = `${spec}|${c.code}`;
                    const on = k in sel;
                    return (
                      <td key={c.code} onClick={() => toggle(spec, c.code)}
                        style={{ cursor: 'pointer', background: on ? 'var(--accent-soft)' : undefined }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(spec, c.code)} />
                        <div className="sku-preview mt8">{`${p.ownership}-${p.productType}-${spec}-${c.code}`}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <div className="hint mb12">已勾选 {Object.keys(sel).length} 个组合。选中后可为每个 SKU 填写参考价格：</div>
            <div style={{ maxHeight: 180, overflow: 'auto' }}>
              {Object.entries(sel).map(([k, price]) => {
                const [spec, color] = k.split('|');
                return (
                  <div className="row mb12" key={k}>
                    <span className="sku-preview">{`${p.ownership}-${p.productType}-${spec}-${color}`}</span>
                    <input type="text" placeholder="价格（可选）" value={price} style={{ width: 110, height: 26 }}
                      onChange={e => setSel(s => ({ ...s, [k]: e.target.value }))} />
                  </div>
                );
              })}
            </div>
            <button className="btn accent mt8" onClick={generate} disabled={!Object.keys(sel).length}>生成所选 SKU</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>已建立的 SKU（{p.skus.length}）</div>
        {p.skus.length ? (
          <table className="table">
            <thead><tr><th>SKU 编码</th><th>规格</th><th>颜色</th><th>价格</th><th>备注</th><th style={{ width: 90 }}>操作</th></tr></thead>
            <tbody>
              {p.skus.map(s => (
                <tr key={s.sku}>
                  <td style={{ fontFamily: 'Consolas, monospace' }}>{s.sku}</td>
                  <td style={{ fontFamily: 'Consolas, monospace' }}>{s.spec}</td>
                  <td>
                    <span className="color-dot" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: (colors.find(c => c.code === s.color) || {}).hex || '#ccc', border: '1px solid rgba(0,0,0,.15)', marginRight: 6 }} />
                    {s.color}
                  </td>
                  <td>{s.price || '—'}</td>
                  <td className="hint">{s.note}</td>
                  <td><button className="btn small danger" onClick={() => removeSku(s.sku)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="hint">尚未生成 SKU。SKU 一旦用于订单、库存、生产或售后，不得随意改写其含义。</div>}
        {!isVehicle && !!skuFields.length && (
          <div className="hint mt8">SKU 级非生成字段（如 {skuFields.map(f => f.nameZh).join('、')}）将在第二阶段接入逐 SKU 维护。</div>
        )}
      </div>

      {showColor && <ColorDictDialog quickMode onClose={() => setShowColor(false)} onChanged={onChanged} />}
    </div>
  );
}

/* ---------------- BOM（第一阶段：物料行 + 版本；引用零配件库 SKU，不重复建档） ---------------- */
function BomTab({ p, meta, onChanged, notify }) {
  const [parts, setParts] = useState([]);
  const [bom, setBom] = useState({ version: p.bom.version || 'V1.0', items: (p.bom.items || []).map(x => ({ ...x })) });
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [drawingId, setDrawingId] = useState('');
  const [selectedItem, setSelectedItem] = useState('');

  useEffect(() => { api.products('part').then(setParts); }, []);
  useEffect(() => { api.bomVersions(p.id).then(setVersions).catch(e => notify(e.message, true)); }, [p.id]);
  const loadVersion = async (version) => { setSelectedVersion(version); if(!version)return; try { const historical=await api.bomVersion(p.id,version); setBom({version:'',items:historical.items.map(x=>({...x}))}); notify('已载入历史版本，请填写新的版本号后保存'); } catch(e){notify(e.message,true);} };

  const partSkuOptions = useMemo(() => parts.flatMap(x => x.skus.map(s => ({ sku: s.sku, name: x.name }))), [parts]);

  const addItem = () => setBom(b => ({ ...b, items: [...b.items, {
    id: 'b-' + Date.now() + '-' + b.items.length, section: meta.bomSections[0],
    drawingNo: '', sku: '', qty: 1, unit: '件', position: '',
  }] }));
  const upd = (i, k, v) => setBom(b => ({ ...b, items: b.items.map((it, j) => j === i ? { ...it, [k]: v } : it) }));
  const del = (i) => { if(bom.items.some(x=>String(x.parentItemId||'')===String(bom.items[i].id))) { notify('请先删除或调整下级物料',true); return; } setBom(b => ({ ...b, items: b.items.filter((_, j) => j !== i) })); };

  const save = async () => {
    if (!bom.version.trim()) { notify('请填写新的 BOM 版本号', true); return; }
    const missing = bom.items.filter(it => !it.sku || !it.drawingNo);
    if (missing.length) { notify('每个 BOM 项目必须填写图纸编号并引用零配件库 SKU', true); return; }
    try { await api.saveBom(p.id, bom); await onChanged(); setVersions(await api.bomVersions(p.id)); setSelectedVersion(''); notify('BOM 已保存（版本 ' + bom.version + '）'); }
    catch (e) { notify(e.message, true); }
  };

  return (
    <div className="card">
      <div className="row mb12"><label htmlFor="bom-history">历史版本</label><select id="bom-history" value={selectedVersion} onChange={e=>loadVersion(e.target.value)}><option value="">选择历史版本</option>{versions.map(v=><option key={v.version} value={v.version}>{v.version} · {v.status}</option>)}</select><span className="hint">载入后可作为新版本的基础，历史记录不会被覆盖。</span></div>
      <div className="row mb12">
        <div className="field" style={{ width: 220 }}>
          <label>BOM 版本号</label>
          <input value={bom.version} onChange={e => setBom({ ...bom, version: e.target.value })} />
        </div>
        <span className="hint grow" style={{ alignSelf: 'flex-end' }}>
          图纸编号用于定位零件位置，SKU 用于识别实际物料，两者是不同字段。
          新版本不覆盖历史版本。
        </span>
        <button className="btn" onClick={addItem}>添加物料行</button>
        <button className="btn accent" onClick={save}>保存 BOM</button>
      </div>
      {bom.items.length ? (
        <table className="table">
          <thead><tr>
            <th>上级物料</th><th>部位分类</th><th>图纸编号</th><th>物料 SKU（引用零配件库）</th><th>物料名称</th><th>用量</th><th>单位</th><th>安装位置</th><th></th>
          </tr></thead>
          <tbody>
            {bom.items.map((it, i) => {
              const info = partSkuOptions.find(o => o.sku === it.sku);
              return (
                <tr key={it.id || i} id={'bom-row-'+it.id} onClick={()=>{setSelectedItem(String(it.id));if(it.drawingMediaId)setDrawingId(it.drawingMediaId)}} style={String(it.id)===selectedItem?{background:'#e8f1ff'}:undefined}>
                  <td><select value={it.parentItemId||''} onChange={e=>upd(i,'parentItemId',e.target.value||null)} style={{height:28,maxWidth:150}}><option value="">整车顶层</option>{bom.items.filter(x=>String(x.id)!==String(it.id)).map(x=><option key={x.id} value={x.id}>{x.drawingNo||'未填写图号'} · {x.sku||'未选 SKU'}</option>)}</select></td>
                  <td>
                    <select value={it.section} onChange={e => upd(i, 'section', e.target.value)} style={{ height: 28 }}>
                      {meta.bomSections.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><input value={it.drawingNo} placeholder="如 D-001" style={{ width: 90, height: 28 }}
                    onChange={e => upd(i, 'drawingNo', e.target.value.toUpperCase())} /></td>
                  <td>
                    <select value={it.sku} onChange={e => upd(i, 'sku', e.target.value)} style={{ width: 200, height: 28, fontFamily: 'Consolas, monospace' }}>
                      <option value="">— 选择零配件 SKU —</option>
                      {partSkuOptions.map(o => <option key={o.sku} value={o.sku}>{o.sku}</option>)}
                    </select>
                  </td>
                  <td className="hint">{info ? info.name : it.sku ? <span className="error-text">SKU 不存在</span> : '—'}</td>
                  <td><input type="number" min="0.01" step="any" value={it.qty} style={{ width: 60, height: 28 }} onChange={e => upd(i, 'qty', Number(e.target.value))} /></td>
                  <td><input value={it.unit} style={{ width: 60, height: 28 }} onChange={e => upd(i, 'unit', e.target.value)} /></td>
                  <td><input value={it.position} placeholder="如 座管内" style={{ width: 120, height: 28 }} onChange={e => upd(i, 'position', e.target.value)} /></td>
                  <td><button className="btn small danger" onClick={() => del(i)}>删除</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="hint">
          BOM 为空。BOM 直接引用统一零配件库的 SKU，不重复建档；
          需要独立采购、库存、领料、维修或追溯的物料必须先在零配件库建档。
        </div>
      )}
      <div className="card mt16"><h3>图纸位置</h3><p className="hint">在“图片资料”上传整车工程图；选择物料行后点击图纸放置标记。保存为新版本后标记会随版本保留。</p><div className="row"><select value={drawingId} onChange={e=>setDrawingId(e.target.value)}><option value="">选择整车图纸</option>{(p.images||[]).map(x=><option key={x.id} value={x.id}>{x.label||'未命名图纸'}</option>)}</select>{selectedItem&&<button className="btn small" type="button" onClick={()=>setBom(b=>({...b,items:b.items.map(x=>String(x.id)===selectedItem?{...x,drawingMediaId:null,drawingX:null,drawingY:null}:x)}))}>清除所选物料标记</button>}</div>{drawingId&&<div style={{position:'relative',display:'inline-block',maxWidth:'100%',marginTop:12,lineHeight:0}} onClick={e=>{if(!selectedItem){notify('请先选择物料行',true);return}const box=e.currentTarget.getBoundingClientRect();const x=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(e.clientY-box.top)/box.height));setBom(b=>({...b,items:b.items.map(it=>String(it.id)===selectedItem?{...it,drawingMediaId:drawingId,drawingX:x,drawingY:y}:it)}))}}><CloudImage src={`/api/products/${encodeURIComponent(p.id)}/media/${encodeURIComponent(drawingId)}`} alt="整车工程图" height={600} />{bom.items.filter(x=>x.drawingMediaId===drawingId&&x.drawingX!=null&&x.drawingY!=null).map(x=><button type="button" key={x.id} title={x.sku||x.drawingNo} onClick={e=>{e.stopPropagation();setSelectedItem(String(x.id));document.getElementById('bom-row-'+x.id)?.scrollIntoView({block:'center',behavior:'smooth'})}} style={{position:'absolute',left:`${Number(x.drawingX)*100}%`,top:`${Number(x.drawingY)*100}%`,transform:'translate(-50%,-50%)',borderRadius:'50%',border:'2px solid white',background:String(x.id)===selectedItem?'#d63b32':'#2066b2',color:'white',minWidth:28,height:28,lineHeight:'20px',cursor:'pointer'}}>{x.drawingNo||'•'}</button>)}</div>}</div>
    </div>
  );
}

/* ---------------- 适配关系（独立于 SKU 编码维护，规范第 8 章） ---------------- */
function FitTab({ p, onChanged, notify }) {
  const [vehicles, setVehicles] = useState([]);
  const [fits, setFits] = useState((p.fitments || []).map(f => ({ ...f })));

  useEffect(() => { api.products('vehicle').then(setVehicles); }, []);

  const has = (model) => fits.some(f => f.vehicleModel === model);
  const toggle = (model) => setFits(fs => has(model)
    ? fs.filter(f => f.vehicleModel !== model)
    : [...fs, { vehicleModel: model, note: '' }]);
  const updNote = (model, note) => setFits(fs => fs.map(f => f.vehicleModel === model ? { ...f, note } : f));

  const save = async () => {
    try { await api.updateProduct(p.id, { fitments: fits }); onChanged(); notify('适配关系已保存'); }
    catch (e) { notify(e.message, true); }
  };

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="hint mb12">
        适配关系独立于 SKU 第一段维护：搜索 A1 时，除 A1 专用配件外，还应能找到通过适配关系关联 A1 的品牌共用（AL）与通用（UN）配件。
        同一配件适配多车型且实物完全相同时，只建立一个 SKU，不复制。
      </div>
      {vehicles.length ? (
        <table className="table">
          <thead><tr><th style={{ width: 60 }}>适配</th><th>车型</th><th>产品</th><th>适配说明 / 技术条件</th></tr></thead>
          <tbody>
            {vehicles.map(v => (
              <tr key={v.id}>
                <td><input type="checkbox" checked={has(v.model)} onChange={() => toggle(v.model)} /></td>
                <td style={{ fontFamily: 'Consolas, monospace', fontWeight: 600 }}>{v.model}</td>
                <td>{v.name}</td>
                <td>{has(v.model)
                  ? <input value={(fits.find(f => f.vehicleModel === v.model) || {}).note || ''} style={{ height: 28 }}
                    placeholder="如适用批次、接口条件等" onChange={e => updNote(v.model, e.target.value)} />
                  : <span className="hint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="hint">尚无整车产品可关联。</div>}
      <div className="row mt16"><button className="btn primary" onClick={save}>保存适配关系</button></div>
    </div>
  );
}

/* ---------------- 图片资料 ---------------- */
function ImagesTab({ p, onChanged, notify }) {
  const [busy,setBusy]=useState(false);
  const upload=async e=>{const input=e.currentTarget;const file=input.files?.[0];if(!file)return;setBusy(true);try{await api.uploadMedia(p.id,file);await onChanged();notify('图片已上传');}catch(err){notify(err.message,true);}finally{setBusy(false);input.value='';}};
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="row"><div className="hint grow">支持 JPEG、PNG、WebP、AVIF，单张最大 10 MB。</div><label className="btn primary">{busy?'上传中…':'上传图片'}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={upload} disabled={busy} hidden /></label></div>
      <div className="grid mt16">{(p.images||[]).map(image=><div key={image.id||image.key} className="card"><CloudImage src={`/api/products/${encodeURIComponent(p.id)}/media/${encodeURIComponent(image.id)}`} alt={image.label||'产品图片'} height={220} /><div className="mono">{image.label||'产品图片'}</div></div>)}</div>
    </div>
  );
}

export default EditorPage;
