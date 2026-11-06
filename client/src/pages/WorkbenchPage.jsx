import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export function WorkbenchPage({ onOpen }) {
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  useEffect(() => { Promise.all([api.summary(), api.products()]).then(([s, p]) => { setSummary(s); setProducts(p); }); }, []);
  if (!summary) return <div className="hint">加载工作台…</div>;
  const cards = [['vehicles', '整车产品', 'product', summary.vehicles], ['parts', '零配件', 'product', summary.parts], ['vins', 'VIN 车辆档案', 'service', summary.vins], ['repairsOpen', '待处理维修', 'service', summary.repairsOpen], ['fitments', '适配关系', 'service', summary.fitments], ['substitutes', '替代关系', 'service', summary.substitutes]];
  return <div className="dashboard">
    <div className="page-title"><div><h2>经营概览</h2><span className="hint">ALSVID V2.0 内部 Admin · 数据与业务资源总览</span></div><span className="tag on">本机 API 已连接</span></div>
    <div className="metric-grid">{cards.map(([key, label, domain, value]) => <button key={key} className="metric-card" onClick={() => onOpen(domain, key)}><span className="metric-label">{label}</span><strong>{value}</strong><span className="hint">查看明细 →</span></button>)}</div>
    <div className="dashboard-grid">
      <div className="card"><div className="section-title" style={{ marginTop: 0 }}>产品资产</div><table className="table"><thead><tr><th>名称</th><th>类型</th><th>SKU</th><th>状态</th></tr></thead><tbody>{products.slice(0, 6).map(p => <tr key={p.id}><td><span className="link" onClick={() => onOpen('product', p.kind)}>{p.name}</span></td><td>{p.kind === 'vehicle' ? '整车' : '配件'}</td><td>{p.skuCount}</td><td><span className="tag on">{p.status}</span></td></tr>)}</tbody></table></div>
      <div className="card"><div className="section-title" style={{ marginTop: 0 }}>当前边界</div><p className="hint" style={{ lineHeight: 1.8 }}>当前阶段建设内部管理系统：产品、SKU、BOM、适配、VIN、维修与替代关系。商城、客户下单、员工身份体系暂不启用，但数据结构已预留。</p><div className="notice mt16">云端数据库接入后，将由同一组资源 API 切换到 PostgreSQL 仓储。</div></div>
    </div>
  </div>;
}
