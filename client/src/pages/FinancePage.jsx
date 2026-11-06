import React,{useEffect,useMemo,useState} from 'react';
import {api} from '../api.js';

const money=(value,currency)=>`${currency} ${(Number(value)||0).toFixed(2)}`;

export default function FinancePage(){
  const [rows,setRows]=useState(null),[error,setError]=useState('');
  useEffect(()=>{api.productionCosts().then(setRows).catch(e=>setError(e.message))},[]);
  const totals=useMemo(()=>{
    const map=new Map();
    for(const row of rows||[]){
      const key=row.currency||'CNY';
      if(!map.has(key))map.set(key,{currency:key,order:0,delivery:0});
      const total=map.get(key),cents=Math.round(Number(row.amount||0)*100);
      total[row.source==='订单录入'?'order':'delivery']+=cents;
    }
    return [...map.values()];
  },[rows]);
  return <div className="card"><h2>生产成本台账</h2><p className="hint">订单录入成本与发运批次登记费用分开统计；按币种显示，不含付款、发票或应付状态。</p>
    {error&&<p className="error-text">{error}</p>}
    {totals.length>0&&<div className="metric-grid">{totals.map(t=><div className="metric-card" key={t.currency}><span className="metric-label">{t.currency} · 订单录入成本</span><strong>{money(t.order/100,t.currency)}</strong><span className="hint">批次登记费用：{money(t.delivery/100,t.currency)}</span></div>)}</div>}
    {rows===null?<p className="hint">正在加载成本记录…</p>:rows.length===0?<p className="hint">暂无生产成本记录。创建生产订单并登记费用后，记录会显示在这里。</p>:<table className="table"><thead><tr><th>记录时间</th><th>来源</th><th>订单号</th><th>发运单号</th><th>整车 SKU</th><th>费用科目</th><th>金额</th><th>批次状态</th></tr></thead><tbody>{rows.map(r=><tr key={r.recordId}><td>{new Date(r.recordedAt).toLocaleDateString()}</td><td>{r.source}</td><td>{r.orderNo}</td><td>{r.shipmentNo||'—'}</td><td>{r.sku}</td><td>{r.costType}</td><td>{money(r.amount,r.currency)}</td><td>{r.status||'—'}</td></tr>)}</tbody></table>}
  </div>;
}
