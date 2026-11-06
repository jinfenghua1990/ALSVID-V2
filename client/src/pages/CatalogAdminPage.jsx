import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const languages = [['zh', '中文'], ['en', 'English'], ['de', 'Deutsch']];
const blank = () => ({ model: '', languages: { zh: { title: '', description: '', specifications: [] } }, mediaIds: [] });
async function request(id, method = 'GET', body, suffix = '') {
  const r = await fetch(`/api/products/${encodeURIComponent(id)}/publication${suffix}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || '发布操作失败');
  return data;
}
export default function CatalogAdminPage({ user }) {
  const [products, setProducts] = useState([]), [selected, setSelected] = useState('');
  const [record, setRecord] = useState(null), [document, setDocument] = useState(blank), [lang, setLang] = useState('zh');
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { api.products().then(setProducts).catch(e => setMessage(e.message)); }, []);
  useEffect(() => {
    let active = true;
    setRecord(null); setDocument(blank()); setDirty(false); setMessage('');
    if (selected) request(selected).then(row => { if (active) { setRecord(row); setDocument(row.draft || blank()); } }).catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [selected]);
  const product = products.find(p => p.id === selected), locale = document.languages[lang];
  const edit = next => { setDocument(next); setDirty(true); setMessage(''); };
  const editLocale = patch => edit({ ...document, languages: { ...document.languages, [lang]: { ...locale, ...patch } } });
  const run = async action => {
    setBusy(true); setMessage('');
    try {
      const next = await request(selected, action === 'save' ? 'PUT' : 'POST', action === 'save' ? { revision: record.revision, document } : { revision: record.revision }, action === 'save' ? '' : `/${action}`);
      setRecord(next); setDocument(next.draft); setDirty(false);
      setMessage(action === 'save' ? '草稿已保存，官网内容未改变。' : action === 'publish' ? '已发布，可打开目录查看。' : '已下架，访客无法再读取该产品与图片。');
    } catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  };
  return <div className="card"><h2>官网产品发布</h2><p className="hint">只公开在这里填写的名称、说明、参数和选中的图片。保存草稿后，点击发布才会更新官网。产品停用后自动隐藏。</p>
    <p><a href="/catalog/zh" target="_blank" rel="noreferrer">打开中文目录 ↗</a> · <a href="/catalog/en" target="_blank" rel="noreferrer">English ↗</a> · <a href="/catalog/de" target="_blank" rel="noreferrer">Deutsch ↗</a></p>
    <label>选择产品 <select value={selected} disabled={busy} onChange={e => { if (!dirty || window.confirm('有未保存内容，确定切换产品？')) setSelected(e.target.value); }}><option value="">请选择产品</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.status}</option>)}</select></label>
    {!products.length && <p className="hint">暂无产品，请先在产品模块创建。</p>}
    {message && <p role="status">{message}</p>}
    {selected && !record && <button className="btn" onClick={() => { setSelected(''); }}>重新选择产品</button>}
    {record && <><p>{record.published ? (record.revision === record.publishedRevision ? '已发布' : '已发布 · 草稿有新版本') : '未发布'}{dirty ? ' · 有未保存修改' : ''}</p>
      <div className="tabs">{languages.map(([code, label]) => <button type="button" className={'tab' + (lang === code ? ' active' : '')} key={code} onClick={() => setLang(code)}>{label}</button>)}</div>
      <fieldset disabled={user.role !== 'admin' || busy} style={{ border: 0, padding: 0 }}>
        <div className="field"><label htmlFor="catalog-model">公开型号</label><input id="catalog-model" maxLength={100} value={document.model} onChange={e => edit({ ...document, model: e.target.value })} /></div>
        <p><label><input type="checkbox" checked={!!locale} onChange={e => { const next = { ...document.languages }; if (e.target.checked) next[lang] = { title: '', description: '', specifications: [] }; else delete next[lang]; edit({ ...document, languages: next }); }} /> 提供该语言内容</label></p>
        {locale && <><div className="field"><label htmlFor="catalog-title">公开名称</label><input id="catalog-title" maxLength={160} value={locale.title} onChange={e => editLocale({ title: e.target.value })} /></div><div className="field"><label htmlFor="catalog-description">产品说明</label><textarea id="catalog-description" rows={6} maxLength={10000} value={locale.description} onChange={e => editLocale({ description: e.target.value })} /></div>
          <h3>公开参数</h3>{locale.specifications.map((spec, i) => <div className="row mb12" key={i}><input aria-label={`参数 ${i + 1} 名称`} placeholder="参数名称" maxLength={80} value={spec.label} onChange={e => editLocale({ specifications: locale.specifications.map((row, n) => n === i ? { ...row, label: e.target.value } : row) })} /><input aria-label={`参数 ${i + 1} 内容`} placeholder="参数内容" maxLength={500} value={spec.value} onChange={e => editLocale({ specifications: locale.specifications.map((row, n) => n === i ? { ...row, value: e.target.value } : row) })} /><button type="button" className="btn" onClick={() => editLocale({ specifications: locale.specifications.filter((_, n) => n !== i) })}>移除</button></div>)}<button type="button" className="btn" disabled={locale.specifications.length >= 30} onClick={() => editLocale({ specifications: [...locale.specifications, { label: '', value: '' }] })}>添加公开参数</button>
        </>}
        <h3>公开图片</h3><p className="hint">仅勾选可对外展示的图片；图纸与其他附件请勿勾选。</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>{(product?.images || []).map(image => <label key={image.id} style={{ width: 140 }}><img src={`/api/products/${encodeURIComponent(selected)}/media/${encodeURIComponent(image.id)}`} alt={image.label || '产品图片'} style={{ width: 120, height: 90, objectFit: 'contain' }} /><br /><input type="checkbox" checked={document.mediaIds.includes(image.id)} onChange={e => edit({ ...document, mediaIds: e.target.checked ? [...document.mediaIds, image.id] : document.mediaIds.filter(id => id !== image.id) })} />{image.label || '公开此图片'}</label>)}</div>
        {!product?.images?.length && <p className="hint">暂无图片，可在产品详情中上传后重新打开本页面。</p>}
        <div className="row" style={{ marginTop: 24 }}><button className="btn" disabled={!dirty} onClick={() => run('save')}>保存草稿</button><button className="btn primary" disabled={dirty || !record.draft || product?.status !== '启用' || record.revision === record.publishedRevision} onClick={() => { if (window.confirm('确认公开当前已保存的名称、说明、参数与选中图片？')) run('publish'); }}>发布到官网</button><button className="btn" disabled={!record.published || dirty} onClick={() => { if (window.confirm('确定从官网下架此产品？')) run('unpublish'); }}>下架</button></div>
      </fieldset>
    </>}
  </div>;
}
