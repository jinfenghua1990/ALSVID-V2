import React, { useEffect, useMemo, useState } from 'react';
import './catalog.css';

const words = {
  zh: { eyebrow: 'ALSVID / ELECTRIC MOBILITY', title: '让每一次出发，都更从容。', intro: '探索已由 ALSVID 发布的产品、服务与车辆支持。', browse: '探索产品', owner: '车主中心', dealer: '经销商中心', empty: '产品目录正在准备中。', error: '暂时无法加载产品目录。' },
  en: { eyebrow: 'ALSVID / ELECTRIC MOBILITY', title: 'Move with confidence.', intro: 'Explore products, service and vehicle support published by ALSVID.', browse: 'Explore products', owner: 'Owner centre', dealer: 'Dealer centre', empty: 'Our product catalogue is being prepared.', error: 'The product catalogue is temporarily unavailable.' },
  de: { eyebrow: 'ALSVID / ELECTRIC MOBILITY', title: 'Mit Vertrauen unterwegs.', intro: 'Entdecken Sie von ALSVID veröffentlichte Produkte und Services.', browse: 'Produkte entdecken', owner: 'Kundenbereich', dealer: 'Händlerbereich', empty: 'Unser Produktkatalog wird vorbereitet.', error: 'Der Produktkatalog ist vorübergehend nicht verfügbar.' },
};
export default function HomePage({ lang = 'en' }) {
  const t = words[lang], [data, setData] = useState(null), [error, setError] = useState(false);
  useEffect(() => { fetch(`/api/catalog/products?lang=${lang}&page=1`).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(setData).catch(() => setError(true)); }, [lang]);
  const products = useMemo(() => data?.items || [], [data]);
  return <div className="catalog-site"><header className="catalog-header"><a className="catalog-brand" href="/">ALSVID<span>Electric mobility</span></a><nav><a href={`/catalog/zh`} aria-current={lang === 'zh' ? 'page' : undefined}>中文</a><a href={`/catalog/en`} aria-current={lang === 'en' ? 'page' : undefined}>EN</a><a href={`/catalog/de`} aria-current={lang === 'de' ? 'page' : undefined}>DE</a></nav></header><main>
    <section className="catalog-intro" style={{ paddingBottom: 72 }}><p className="catalog-eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p style={{ maxWidth: 560, fontSize: 18, lineHeight: 1.8 }}>{t.intro}</p><p style={{ marginTop: 32, display: 'flex', gap: 16, flexWrap: 'wrap' }}><a className="catalog-home-button" href={`/catalog/${lang}`}>{t.browse} →</a><a className="catalog-home-link" href="/my">{t.owner}</a><a className="catalog-home-link" href="/dealer">{t.dealer}</a></p></section>
    <section><div className="catalog-eyebrow">{t.browse}</div>{error ? <p className="catalog-state">{t.error}</p> : !data ? <p className="catalog-state">…</p> : products.length ? <div className="catalog-grid">{products.slice(0, 3).map(product => <a className="catalog-card" key={product.id} href={`/catalog/${lang}/${encodeURIComponent(product.id)}`}><div className="catalog-card-image">{product.images[0] ? <img src={product.images[0].url} alt={product.title} loading="lazy" /> : <div className="catalog-no-image">{product.title}</div>}</div><div className="catalog-card-copy"><p className="catalog-eyebrow">{product.kind}</p><h2>{product.title}</h2></div></a>)}</div> : <p className="catalog-state">{t.empty}</p>}</section>
  </main><footer className="catalog-footer"><span>ALSVID</span><span>Electric mobility</span></footer></div>;
}
