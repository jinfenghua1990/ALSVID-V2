import React, { useEffect, useState } from 'react';
import './catalog.css';

const copy = {
  zh: { title: '探索 ALSVID', subtitle: '产品目录', all: '全部产品', vehicle: '整车', part: '零配件', empty: '该语言暂无已发布产品。', loading: '正在加载产品…', error: '暂时无法加载产品，请稍后重试。', missing: '该产品尚未发布此语言的内容，或已下架。', retry: '重试', details: '查看详情', back: '返回产品目录', specs: '产品参数', prev: '上一页', next: '下一页', noImage: '暂无产品图片' },
  en: { title: 'Explore ALSVID', subtitle: 'Product catalogue', all: 'All products', vehicle: 'Bikes', part: 'Parts', empty: 'No products have been published in this language yet.', loading: 'Loading products…', error: 'Products could not be loaded. Please try again.', missing: 'This product is unavailable in this language or has been unpublished.', retry: 'Retry', details: 'View details', back: 'Back to catalogue', specs: 'Specifications', prev: 'Previous', next: 'Next', noImage: 'No product image' },
  de: { title: 'ALSVID entdecken', subtitle: 'Produktkatalog', all: 'Alle Produkte', vehicle: 'Fahrräder', part: 'Ersatzteile', empty: 'In dieser Sprache sind noch keine Produkte veröffentlicht.', loading: 'Produkte werden geladen…', error: 'Produkte konnten nicht geladen werden. Bitte versuchen Sie es erneut.', missing: 'Dieses Produkt ist in dieser Sprache nicht verfügbar oder wurde entfernt.', retry: 'Erneut versuchen', details: 'Details ansehen', back: 'Zurück zum Katalog', specs: 'Technische Daten', prev: 'Zurück', next: 'Weiter', noImage: 'Kein Produktbild' },
};
export default function CatalogPage({ lang, productId }) {
  const t = copy[lang], params = new URLSearchParams(window.location.search);
  const parsedPage = Number(params.get('page') || 1), page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 10000 ? parsedPage : 1;
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    const url = productId ? `/api/catalog/products/${encodeURIComponent(productId)}?lang=${lang}` : `/api/catalog/products?lang=${lang}&page=${page}`;
    fetch(url, { signal: controller.signal }).then(async r => { if (!r.ok) throw Error(r.status === 404 ? t.missing : t.error); return r.json(); }).then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [productId, lang, page, attempt]);
  useEffect(() => { document.documentElement.lang = lang; document.title = `${data?.title || t.subtitle} · ALSVID`; }, [lang, data]);
  const home = `/catalog/${lang}`;
  return <div className="catalog-site">
    <header className="catalog-header"><a href={home} className="catalog-brand">ALSVID<span>{t.subtitle}</span></a><nav aria-label="Language">{[['zh', '中文'], ['en', 'EN'], ['de', 'DE']].map(([code, label]) => <a key={code} aria-current={lang === code ? 'page' : undefined} href={`/catalog/${code}${productId && data?.languages?.includes(code) ? '/' + encodeURIComponent(productId) : ''}`}>{label}</a>)}</nav></header>
    <main>
      {error ? <section className="catalog-state" role="alert"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>{t.retry}</button> <a href={home}>{t.back}</a></section> : !data ? <p className="catalog-state" role="status">{t.loading}</p> : productId ? <>
        <a className="catalog-back" href={home}>← {t.back}</a><article className="catalog-product"><div className="catalog-gallery">{data.images.length ? data.images.map((image, i) => <img key={image.id} src={image.url} alt={`${data.title} ${i + 1}`} />) : <div className="catalog-no-image">{t.noImage}</div>}</div><div><p className="catalog-eyebrow">{t[data.kind]} {data.model && ` / ${data.model}`}</p><h1>{data.title}</h1><p className="catalog-description">{data.description}</p>{data.specifications.length > 0 && <><h2>{t.specs}</h2><dl>{data.specifications.map((row, i) => <div key={i}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></>}</div></article>
      </> : <><section className="catalog-intro"><p className="catalog-eyebrow">ALSVID / {t.subtitle}</p><h1>{t.title}</h1><p>{t.all}</p></section>{data.items.length ? <div className="catalog-grid">{data.items.map(product => <a className="catalog-card" key={product.id} href={`${home}/${encodeURIComponent(product.id)}`}><div className="catalog-card-image">{product.images[0] ? <img src={product.images[0].url} alt={product.title} loading="lazy" /> : <div className="catalog-no-image">{t.noImage}</div>}</div><div className="catalog-card-copy"><p className="catalog-eyebrow">{t[product.kind]} {product.model && ` / ${product.model}`}</p><h2>{product.title}</h2><span>{t.details} ↗</span></div></a>)}</div> : <p className="catalog-state">{t.empty}</p>}<nav className="catalog-pagination" aria-label={t.subtitle}>{page > 1 && <a href={`${home}?page=${page - 1}`}>← {t.prev}</a>}{data.hasMore && <a href={`${home}?page=${page + 1}`}>{t.next} →</a>}</nav></>}
    </main><footer className="catalog-footer">ALSVID<span>{t.subtitle}</span></footer>
  </div>;
}
