const { createPool } = require('./db-pool');
const { currentActor } = require('./audit-context');

const LANGUAGES = ['zh', 'en', 'de'];
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('发布内容格式或长度无效');
  return value.trim();
}
function documentOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('发布内容格式无效');
  const languages = {};
  for (const lang of LANGUAGES) {
    const value = input.languages?.[lang];
    if (value == null) continue;
    if (!Array.isArray(value.specifications) || value.specifications.length > 30) fail('参数最多 30 项');
    languages[lang] = {
      title: text(value.title, 160, true), description: text(value.description, 10000),
      specifications: value.specifications.map(row => ({ label: text(row?.label, 80, true), value: text(row?.value, 500, true) })),
    };
  }
  if (!Object.keys(languages).length) fail('请至少填写一种语言的产品名称');
  if (!Array.isArray(input.mediaIds) || input.mediaIds.length > 12 || input.mediaIds.some(id => typeof id !== 'string' || !id || id.length > 160)) fail('最多选择 12 张产品图片');
  if (new Set(input.mediaIds).size !== input.mediaIds.length) fail('不能重复选择图片');
  return { model: text(input.model, 100), languages, mediaIds: input.mediaIds };
}
function createCatalogStore(connectionString) {
  const pool = createPool(connectionString, { max: 3, connectionTimeoutMillis: 10000 });
  const columns = 'product_id AS "productId",draft,published,revision,published_revision AS "publishedRevision"';
  const empty = id => ({ productId: id, draft: null, published: null, revision: 0, publishedRevision: null });
  async function product(client, id, lock = false) {
    const row = (await client.query('SELECT id,kind,status FROM products WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [id])).rows[0];
    if (!row) fail('产品不存在', 404);
    return row;
  }
  async function validateMedia(client, id, document) {
    const rows = (await client.query("SELECT id FROM product_media WHERE product_id=$1 AND id=ANY($2::text[]) AND content_type IN ('image/jpeg','image/png','image/webp','image/avif')", [id, document.mediaIds])).rows;
    if (rows.length !== document.mediaIds.length) fail('所选图片不存在或不属于该产品');
  }
  async function change(id, input, action) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('请先加载最新发布内容');
    const draft = action === 'save' ? documentOf(input.document) : null;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const p = await product(c, id, true);
      const old = (await c.query(`SELECT ${columns} FROM catalog_publications WHERE product_id=$1 FOR UPDATE`, [id])).rows[0] || empty(id);
      if (old.revision !== input.revision) fail('发布内容已被更新，请重新加载', 409);
      if (action === 'save') {
        await validateMedia(c, id, draft);
        await c.query('INSERT INTO catalog_publications(product_id,draft,revision) VALUES($1,$2,1) ON CONFLICT(product_id) DO UPDATE SET draft=$2,revision=catalog_publications.revision+1', [id, JSON.stringify(draft)]);
      } else if (action === 'publish') {
        if (p.status !== '启用') fail('请先启用产品');
        if (!old.draft) fail('请先保存发布草稿');
        await validateMedia(c, id, documentOf(old.draft));
        await c.query('UPDATE catalog_publications SET published=draft,revision=revision+1,published_revision=revision+1 WHERE product_id=$1', [id]);
      } else {
        if (!old.published) fail('产品尚未发布');
        await c.query('UPDATE catalog_publications SET published=NULL,published_revision=NULL,revision=revision+1 WHERE product_id=$1', [id]);
      }
      const row = (await c.query(`SELECT ${columns} FROM catalog_publications WHERE product_id=$1`, [id])).rows[0];
      await c.query('INSERT INTO audit_log(actor,action,target,before_json,after_json) VALUES($1,$2,$3,$4,$5)', [currentActor(), `catalog.${action}`, `products/${id}/publication`, JSON.stringify(old), JSON.stringify(row)]);
      await c.query('COMMIT');
      return row;
    } catch (error) { await c.query('ROLLBACK').catch(() => {}); throw error; }
    finally { c.release(); }
  }
  const visible = "FROM catalog_publications cp JOIN products p ON p.id=cp.product_id WHERE p.status='启用' AND cp.published IS NOT NULL";
  function publicRow(row, lang) {
    // Never spread a product or stored JSON document into a public response.
    const doc = documentOf(row.published), locale = doc.languages[lang];
    if (!locale) return null;
    return { id: row.id, kind: row.kind, model: doc.model, title: locale.title, description: locale.description, specifications: locale.specifications, languages: Object.keys(doc.languages), images: doc.mediaIds.map(id => ({ id, url: `/api/catalog/products/${encodeURIComponent(row.id)}/images/${encodeURIComponent(id)}` })) };
  }
  return {
    async getDraft(id) { await product(pool, id); return (await pool.query(`SELECT ${columns} FROM catalog_publications WHERE product_id=$1`, [id])).rows[0] || empty(id); },
    save: (id, input) => change(id, input, 'save'),
    publish: (id, input) => change(id, input, 'publish'),
    unpublish: (id, input) => change(id, input, 'unpublish'),
    async list(lang, page) {
      const rows = (await pool.query(`SELECT p.id,p.kind,cp.published ${visible} AND cp.published->'languages' ? $1 ORDER BY p.id LIMIT 25 OFFSET $2`, [lang, (page - 1) * 24])).rows;
      return { items: rows.slice(0, 24).map(row => publicRow(row, lang)), hasMore: rows.length > 24 };
    },
    async get(id, lang) { const row = (await pool.query(`SELECT p.id,p.kind,cp.published ${visible} AND p.id=$1`, [id])).rows[0]; return row ? publicRow(row, lang) : null; },
    async image(id, mediaId) {
      return (await pool.query(`SELECT pm.object_key AS key,pm.content_type AS "contentType" FROM product_media pm JOIN catalog_publications cp ON cp.product_id=pm.product_id JOIN products p ON p.id=cp.product_id WHERE p.id=$1 AND pm.id=$2 AND p.status='启用' AND cp.published->'mediaIds' ? pm.id AND pm.content_type IN ('image/jpeg','image/png','image/webp','image/avif')`, [id, mediaId])).rows[0] || null;
    },
    close: () => pool.end(),
  };
}
function registerCatalogRoutes(app, { catalog, objectStorage }) {
  function route(method, url, handler, isPublic = false) {
    app.route({ method, url, config: { publicCatalog: isPublic }, bodyLimit: 128 * 1024, handler: async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!catalog) return reply.code(503).send({ error: '产品目录暂时不可用' });
      try { return await handler(req, reply); }
      catch (error) { return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : '产品目录操作失败' }); }
    } });
  }
  function language(req) { const lang = req.query.lang || 'en'; if (!LANGUAGES.includes(lang)) fail('不支持的语言'); return lang; }
  route('GET', '/api/catalog/products', req => { const page = Number(req.query.page || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail('页码无效'); return catalog.list(language(req), page); }, true);
  route('GET', '/api/catalog/products/:id', async (req, reply) => { const row = await catalog.get(req.params.id, language(req)); return row || reply.code(404).send({ error: '产品未发布或不存在' }); }, true);
  route('GET', '/api/catalog/products/:id/images/:mediaId', async (req, reply) => {
    const media = await catalog.image(req.params.id, req.params.mediaId);
    if (!media) return reply.code(404).send({ error: '图片未发布或不存在' });
    if (!objectStorage) return reply.code(503).send({ error: '图片服务暂时不可用' });
    try { const obj = await objectStorage.get(media.key); return reply.header('X-Content-Type-Options', 'nosniff').type(media.contentType).send(obj.Body); }
    catch (_) { return reply.code(502).send({ error: '图片暂时不可用' }); }
  }, true);
  route('GET', '/api/products/:id/publication', req => catalog.getDraft(req.params.id));
  for (const [method, suffix, action] of [['PUT', '', 'save'], ['POST', '/publish', 'publish'], ['POST', '/unpublish', 'unpublish']]) {
    route(method, '/api/products/:id/publication' + suffix, (req, reply) => {
      if (req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员可发布产品' });
      return catalog[action](req.params.id, req.body || {});
    });
  }
}
module.exports = { createCatalogStore, registerCatalogRoutes, documentOf };
