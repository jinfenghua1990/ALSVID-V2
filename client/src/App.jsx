import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { ListPage } from './pages/ListPage.jsx';
import CreateProductPage from './pages/CreateProductPage.jsx';
import { EditorPage } from './pages/EditorPage.jsx';
import { WorkbenchPage } from './pages/WorkbenchPage.jsx';
import { ServicePage } from './pages/ServicePage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import ProductionPage from './pages/ProductionPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import FactoriesPage from './pages/FactoriesPage.jsx';
import { StorageBadge } from './cloud.jsx';

const DOMAINS = [
  { key: 'workbench', icon: '🏠', label: '工作台' },
  { key: 'product', icon: '🧩', label: '产品' },
  { key: 'supply', icon: '📦', label: '供应链' },
  { key: 'shop', icon: '🛒', label: '商城' },
  { key: 'service', icon: '🔧', label: '服务' },
  { key: 'finance', icon: '💳', label: '财务' },
  { key: 'settings', icon: '⚙️', label: '设置' },
];

export default function App({ user, onLogout }) {
  const [meta, setMeta] = useState(null);
  const [view, setView] = useState({ type: 'list', kind: 'vehicle' });
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('alsvid-v2-theme') || 'light');
  const [domain, setDomain] = useState('product');
  const [serviceSection, setServiceSection] = useState('vin');
  const navRef = useRef(null);
  const pillRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => { api.meta().then(setMeta); }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const update = () => {
      const active = nav.querySelector('.alsvid-topbar__item.is-active');
      if (!active) return;
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.height = `${active.offsetHeight}px`;
      pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      pill.style.opacity = '1';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [domain, meta]);

  const onSearch = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    if (!v.trim()) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      try { setResults(await api.search(v)); } catch { setResults([]); }
    }, 250);
  };

  const gotoResult = (r) => {
    setResults(null); setQ(''); setDomain('product');
    setView({ type: 'editor', id: r.id, fromKind: r.kind });
  };

  const chooseDomain = (key) => {
    setDomain(key);
    if (key === 'workbench') setView({ type: 'workbench' });
    else if (key === 'service') setView({ type: 'service', section: serviceSection });
    else if (key === 'settings') setView({ type: 'accounts' });
    else if (key === 'supply') setView({ type: 'production' });
    else if (key !== 'product') setView({ type: 'placeholder', domain: key });
    else setView({ type: 'list', kind: view.fromKind || 'vehicle' });
  };

  if (!meta) return <div className="hint" style={{ padding: 24 }}>加载中…</div>;
  const tplName = (code) => (meta.templates.find(t => t.code === code) || {}).name || code;
  const domainLabel = DOMAINS.find(d => d.key === domain)?.label;

  return (
    <div className="app">
      <header className="alsvid-topbar" id="topbar" data-theme={theme}>
        <div className="alsvid-topbar__brand">
          <span className="alsvid-topbar__mark" aria-hidden="true">A</span>
          <span className="alsvid-topbar__copy">ALSVID <small>OPERATIONS</small></span>
        </div>
        <nav className="alsvid-topbar__nav" ref={navRef} aria-label="一级业务导航">
          <span className="alsvid-topbar__pill" ref={pillRef} aria-hidden="true" />
          {DOMAINS.map(d => (
            <button key={d.key} type="button" className={'alsvid-topbar__item' + (domain === d.key ? ' is-active' : '')} onClick={() => chooseDomain(d.key)}>
              <span className="alsvid-topbar__icon" aria-hidden="true">{d.icon}</span><span>{d.label}</span>
            </button>
          ))}
        </nav>
        <div className="alsvid-topbar__tools">
          <div className="alsvid-topbar__search">
            <svg className="alsvid-topbar__searchicon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" /><path d="M10.6 10.6 14 14" /></svg>
            <input type="search" autoComplete="off" placeholder="全局搜索 SKU / 产品 / 颜色 / 字段" aria-label="全局搜索" value={q} onChange={e => onSearch(e.target.value)} />
            {results !== null && q.trim() && <div className="search-results">{results.length ? results.map(r => <div key={r.id} className="sr-item" onClick={() => gotoResult(r)}><span className="tag">{r.kind === 'vehicle' ? '整车' : '配件'}</span><span className="link">{r.name}</span><span className="hint">{r.model ? r.model + ' · ' : ''}{tplName(r.productType)}</span><span className="hint" style={{ marginLeft: 'auto' }}>SKU × {r.skuCount}</span></div>) : <div className="sr-empty">未找到匹配的产品、配件或字段值</div>}</div>}
          </div>
          <StorageBadge />
          <div className="alsvid-topbar__theme" role="group" aria-label="顶栏配色">{['light', 'dark'].map(t => <button key={t} type="button" className={theme === t ? 'is-on' : ''} onClick={() => { setTheme(t); localStorage.setItem('alsvid-v2-theme', t); }}>{t === 'light' ? '浅色' : '深色'}</button>)}</div>
          <button className="alsvid-topbar__tool" title="刷新" type="button" onClick={() => window.location.reload()}><svg viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" /></svg></button>
          <button className="alsvid-topbar__tool" title="全屏" type="button" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg></button>
        </div>
      </header>

      <aside className="side"><div className="side__title">{domainLabel}</div>{domain === 'product' ? <><button className={'side__item' + (view.type === 'list' && view.kind === 'vehicle' ? ' is-active' : '')} onClick={() => setView({ type: 'list', kind: 'vehicle' })}><span className="side__dot" />整车产品</button><button className={'side__item' + (view.type === 'list' && view.kind === 'part' ? ' is-active' : '')} onClick={() => setView({ type: 'list', kind: 'part' })}><span className="side__dot" />零配件</button></> : domain === 'service' ? <>{[['vin','VIN 车辆档案'],['repair','维修工单'],['fit','配件适配'],['substitute','配件替代']].map(([k, label]) => <button key={k} className={'side__item' + (view.type === 'service' && serviceSection === k ? ' is-active' : '')} onClick={() => { setServiceSection(k); setView({ type: 'service', section: k }); }}><span className="side__dot" />{label}</button>)}</> : domain === 'workbench' ? <div className="side__item is-active"><span className="side__dot" />经营概览</div> : <div className="side__item is-active"><span className="side__dot" />{domain === 'supply' ? '生产订单' : domain === 'settings' ? '账号与权限' : '当前阶段预留'}</div>}</aside>

      <main className="work"><div className="view" key={`${view.type}-${view.kind || view.domain || view.id || view.section}`}>
        {domain === 'supply' && <div className="tabs"><button className={'tab'+(view.type==='production'?' active':'')} onClick={()=>setView({type:'production'})}>生产订单</button><button className={'tab'+(view.type==='inventory'?' active':'')} onClick={()=>setView({type:'inventory'})}>仓库与库存</button><button className={'tab'+(view.type==='factories'?' active':'')} onClick={()=>setView({type:'factories'})}>合作工厂</button></div>}
        {view.type === 'list' && <ListPage kind={view.kind} meta={meta} onEdit={(id) => setView({ type: 'editor', id, fromKind: view.kind })} onCreate={(kind) => setView({ type: 'create', kind })} />}
        {view.type === 'create' && <CreateProductPage kind={view.kind} meta={meta} user={user} onBack={()=>setView({type:'list',kind:view.kind})} onCreated={(p)=>setView({type:'editor',id:p.id,fromKind:view.kind})} />}
        {view.type === 'editor' && <EditorPage id={view.id} meta={meta} onBack={() => setView({ type: 'list', kind: view.fromKind || 'vehicle' })} />}
        {view.type === 'workbench' && <WorkbenchPage onOpen={(nextDomain, key) => { setDomain(nextDomain); if (nextDomain === 'product') setView({ type: 'list', kind: key === 'parts' ? 'part' : 'vehicle' }); else if (nextDomain === 'service') { const next = key === 'repairsOpen' ? 'repair' : key === 'fitments' ? 'fit' : key === 'substitutes' ? 'substitute' : 'vin'; setServiceSection(next); setView({ type: 'service', section: next }); } }} />}
        {view.type === 'service' && <ServicePage section={view.section || serviceSection} onSectionChange={(next) => { setServiceSection(next); setView({ type: 'service', section: next }); }} />}
        {view.type === 'accounts' && <AccountPage user={user} onLogout={onLogout} />}
        {view.type === 'production' && <ProductionPage />}
        {view.type === 'inventory' && <InventoryPage />}
        {view.type === 'factories' && <FactoriesPage />}
        {view.type === 'placeholder' && <div className="card placeholder"><div className="placeholder-mark">{DOMAINS.find(d => d.key === view.domain)?.icon}</div><h2>{domainLabel}</h2><p>该业务域已纳入 ALSVID V2.0 一级架构，当前阶段先建设内部产品 Admin。</p><span className="hint">数据模型与权限挂载点已预留，后续按阶段接入。</span></div>}
      </div></main>

    </div>
  );
}
