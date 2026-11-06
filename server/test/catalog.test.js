const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const { Client } = require('pg');
const { createCatalogStore, registerCatalogRoutes, documentOf } = require('../catalog');
const { apiAccessHook } = require('../access-policy');
const { runAsActor } = require('../audit-context');

const document = () => ({ model: 'Public model', languages: { en: { title: 'Public title', description: '<script>literal text</script>', specifications: [{ label: 'Size', value: 'M' }] } }, mediaIds: ['catalog-image'] });
test('publication accepts only explicit public fields', () => {
  const input = { ...document(), cost: 888, objectKey: 'private/key', bom: ['private'], languages: { en: { ...document().languages.en, stock: 100 } } };
  assert.deepEqual(documentOf(input), document());
  assert.throws(() => documentOf({ ...input, languages: {} }));
  assert.throws(() => documentOf({ ...input, mediaIds: ['catalog-image', 'catalog-image'] }));
  assert.throws(() => documentOf({ ...input, model: 'x'.repeat(101) }));
});
test('catalog publication lifecycle, isolation, and HTTP authorization', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Use an isolated local TEST_DATABASE_URL');
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && /^\/alsvid_v2_test_/.test(parsed.pathname), 'Refuse non-test databases');
  const client = new Client({ connectionString: url });
  await client.connect();
  const store = createCatalogStore(url), app = Fastify();
  t.after(async () => { await app.close(); await store.close(); await client.end(); });
  await client.query(readFileSync(path.join(__dirname, '../schema.sql'), 'utf8'));
  await client.query("INSERT INTO products(id,kind,name,product_type,ownership,specs) VALUES('catalog-product','vehicle','Private name','BIKE','A1','{\"cost\":888}'),('other-product','part','Other private name','PART','A1','{}')");
  await client.query("INSERT INTO product_media(id,product_id,object_key,content_type,label) VALUES('catalog-image','catalog-product','private/catalog-image','image/png','internal label'),('hidden-image','catalog-product','private/hidden-image','image/png','internal drawing'),('other-image','other-product','private/other-image','image/png','other product')");
  let reads = 0;
  const auth = { user: async token => ['admin', 'viewer', 'owner', 'dealer'].includes(token) ? { username: token, role: token } : null };
  app.addHook('onRequest', apiAccessHook(auth, req => req.headers['test-session']));
  app.addHook('onRequest', (req, reply, done) => runAsActor(req.user?.username || 'anonymous', done));
  registerCatalogRoutes(app, { catalog: store, objectStorage: { get: async key => { reads++; assert.equal(key, 'private/catalog-image'); return { Body: Buffer.from('test image') }; } } });
  app.get('/api/finance/private', async () => ({ cost: 888 }));
  const request = (method, url, body, role) => app.inject({ method, url, payload: body, headers: role ? { 'test-session': role } : {} });
  const publication = '/api/products/catalog-product/publication', publicProduct = '/api/catalog/products/catalog-product?lang=en';

  assert.equal((await request('GET', publication)).statusCode, 401);
  for (const role of ['owner', 'dealer']) {
    assert.equal((await request('GET', publication, null, role)).statusCode, 403);
    assert.equal((await request('GET', '/api/finance/private', null, role)).statusCode, 403);
  }
  assert.equal((await request('GET', publication, null, 'viewer')).statusCode, 200);
  for (const [method, suffix] of [['PUT', ''], ['POST', '/publish'], ['POST', '/unpublish']]) {
    assert.equal((await request(method, publication + suffix, { revision: 0, document: document() })).statusCode, 401);
    assert.equal((await request(method, publication + suffix, { revision: 0, document: document() }, 'viewer')).statusCode, 403);
  }
  assert.equal((await request('POST', '/api/catalog/products', {})).statusCode, 401);
  assert.equal((await request('GET', '/api/catalog/unknown')).statusCode, 401);
  assert.equal((await request('GET', '/api/finance/private?publicCatalog=true')).statusCode, 401);

  assert.equal((await request('GET', publicProduct)).statusCode, 404);
  assert.deepEqual((await request('GET', '/api/catalog/products?lang=en')).json(), { items: [], hasMore: false });
  assert.equal((await request('PUT', publication, { revision: 0, document: { ...document(), mediaIds: ['other-image'] } }, 'admin')).statusCode, 400);
  let result = await request('PUT', publication, { revision: 0, document: document() }, 'admin');
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().revision, 1);
  assert.equal((await request('GET', publicProduct)).statusCode, 404);
  assert.equal((await request('GET', '/api/catalog/products/catalog-product/images/catalog-image')).statusCode, 404);
  assert.equal(reads, 0);

  result = await request('POST', publication + '/publish', { revision: 1 }, 'admin');
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().publishedRevision, 2);
  const publicData = (await request('GET', publicProduct)).json();
  assert.equal(publicData.title, 'Public title');
  assert.deepEqual(Object.keys(publicData).sort(), ['id', 'kind', 'model', 'title', 'description', 'specifications', 'languages', 'images'].sort());
  assert.equal(JSON.stringify(publicData).includes('private'), false);
  assert.equal(JSON.stringify(publicData).includes('888'), false);
  assert.equal((await request('GET', '/api/catalog/products/catalog-product?lang=de')).statusCode, 404);
  assert.equal((await request('GET', '/api/catalog/products?lang=fr')).statusCode, 400);
  assert.equal((await request('GET', '/api/catalog/products?page=-1')).statusCode, 400);
  assert.equal((await request('HEAD', '/api/catalog/products?lang=en')).statusCode, 200);
  assert.equal((await request('GET', '/api/catalog/products/catalog-product/images/hidden-image')).statusCode, 404);
  result = await request('GET', '/api/catalog/products/catalog-product/images/catalog-image');
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(reads, 1);

  const edited = document(); edited.languages.en.title = 'Next public title';
  assert.equal((await request('PUT', publication, { revision: 2, document: edited }, 'admin')).statusCode, 200);
  assert.equal((await request('GET', publicProduct)).json().title, 'Public title');
  assert.equal((await request('POST', publication + '/publish', { revision: 2 }, 'admin')).statusCode, 409);
  const concurrent = await Promise.all([request('POST', publication + '/publish', { revision: 3 }, 'admin'), request('PUT', publication, { revision: 3, document: edited }, 'admin')]);
  assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 409]);
  const revision = (await store.getDraft('catalog-product')).revision;
  assert.equal((await request('POST', publication + '/unpublish', { revision }, 'admin')).statusCode, 200);
  assert.equal((await request('GET', publicProduct)).statusCode, 404);
  assert.equal((await request('GET', '/api/catalog/products/catalog-product/images/catalog-image')).statusCode, 404);
  assert.equal(reads, 1);
  await client.query("UPDATE products SET status='停用' WHERE id='catalog-product'");
  assert.equal((await request('POST', publication + '/publish', { revision: revision + 1 }, 'admin')).statusCode, 400);
  await client.query("UPDATE products SET status='启用' WHERE id='catalog-product'");
  assert.equal((await request('POST', publication + '/publish', { revision: revision + 1 }, 'admin')).statusCode, 200);
  await client.query("UPDATE products SET status='停用' WHERE id='catalog-product'");
  assert.equal((await request('GET', publicProduct)).statusCode, 404);
  assert.equal((await request('GET', '/api/catalog/products/catalog-product/images/catalog-image')).statusCode, 404);
  const audit = (await client.query("SELECT actor,action FROM audit_log WHERE action LIKE 'catalog.%' ORDER BY id")).rows;
  assert.ok(audit.length >= 6);
  assert.ok(audit.every(row => row.actor === 'admin'));
});
