// ALSVID V2.0 内部管理系统 - 业务 API + 前端静态托管（端口 5010）
const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const store = require('./db');
const { createDictionaryStore } = require('./postgres-dictionaries');
const { createProductStore } = require('./postgres-products');
const { createServiceStore } = require('./postgres-service');
const { createObjectStorage } = require('./object-storage');
const { createAuth } = require('./auth');
const { createInventory } = require('./inventory');
const { createCompleteProductStore } = require('./create-complete');
const { runAsActor, currentActor } = require('./audit-context');
const { mayAccessInternalApi } = require('./access-policy');
const { createNetworkPolicy } = require('./network-policy');

const PORT = Number(process.env.PORT || 8089);
const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });
// Public mode is opt-in and requires exact HTTPS origins.
const networkPolicy=createNetworkPolicy({port:PORT,bindHost:process.env.ALSVID_BIND_HOST||'127.0.0.1',publicOrigins:process.env.ALSVID_PUBLIC_ORIGINS||''});
app.addHook('onRequest', async (req, reply) => {
  if(!networkPolicy.allows(req.headers.host,req.headers.origin,req.method))return reply.code(403).send({error:'请求来源不受信任'});
});
const cookieSecurity=req=>networkPolicy.isPublicHost(req.headers.host)?'; Secure':'';
const postgres = process.env.DATABASE_URL ? createDictionaryStore(process.env.DATABASE_URL) : null;
const auth = process.env.DATABASE_URL ? createAuth(process.env.DATABASE_URL) : null;
const authAttempts = new Map();
function sessionToken(req) { const match=String(req.headers.cookie||'').match(/(?:^|;\s*)alsvid_session=([A-Za-z0-9_-]{43})(?:;|$)/); return match?.[1]||''; }
app.addHook('onRequest',async(req,reply)=>{
  const pathname=req.raw.url.split('?')[0];
  if(!pathname.startsWith('/api/')||pathname==='/api/health'||pathname.startsWith('/api/auth/'))return;
  if(!auth)return reply.code(503).send({error:'账号服务不可用'});
  const user=await auth.user(sessionToken(req));
  if(!user)return reply.code(401).send({error:'请先登录'});
  if(!mayAccessInternalApi(user.role,req.method,pathname))return reply.code(403).send({error:'没有访问权限'});
  req.user=user;
});
app.addHook('onRequest',(req,reply,done)=>runAsActor(req.user?.username||'system',done));
app.get('/api/auth/status',async req=>({initialized:auth?await auth.hasUsers():false,user:auth?await auth.user(sessionToken(req)):null}));
app.post('/api/auth/setup',async(req,reply)=>{if(!auth)return reply.code(503).send({error:'账号服务不可用'});try{await auth.setup(req.body?.username,req.body?.password);return reply.code(201).send({ok:true});}catch(e){const allowed=['管理员已设置','请输入有效邮箱或 3–64 位字母、数字、. _ - 账号','密码须为 8–20 个字符'];return reply.code(400).send({error:allowed.includes(e.message)?e.message:'管理员设置失败'});}});
app.post('/api/auth/login',async(req,reply)=>{if(!auth)return reply.code(503).send({error:'账号服务不可用'});const key=req.ip,now=Date.now();let a=authAttempts.get(key);if(!a||now>a.until)a={count:0,until:now+15*60*1000};if(a.count>=10)return reply.code(429).send({error:'尝试次数过多，请稍后重试'});const result=await auth.login(req.body?.username,req.body?.password);if(!result){a.count++;authAttempts.set(key,a);return reply.code(401).send({error:'账号或密码错误'});}authAttempts.delete(key);reply.header('Set-Cookie',`alsvid_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${cookieSecurity(req)}`);return{user:result.user};});
app.post('/api/auth/logout',async(req,reply)=>{if(auth)await auth.logout(sessionToken(req));reply.header('Set-Cookie',`alsvid_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieSecurity(req)}`);return{ok:true};});
app.get('/api/accounts',async(req,reply)=>req.user.role==='admin'?auth.listUsers():reply.code(403).send({error:'仅管理员可管理账号'}));
app.post('/api/accounts',async(req,reply)=>{try{return reply.code(201).send(await auth.createUser(req.body||{},req.user.username))}catch(e){const allowed=['请输入有效邮箱或 3–64 位字母、数字、. _ - 账号','密码须为 8–20 个字符','角色无效'];return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'账号已存在':allowed.includes(e.message)?e.message:'创建账号失败'});}});
app.patch('/api/accounts/:id',async(req,reply)=>{try{return await auth.updateUser(req.params.id,req.body||{},req.user.username)}catch(e){const allowed=['角色无效','状态无效','账号不存在','至少保留一个启用的管理员'];return reply.code(e.message==='账号不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'更新账号失败'});}});
app.post('/api/account/password',async(req,reply)=>{try{if(typeof req.body?.oldPassword!=='string')return reply.code(400).send({error:'请输入原密码'});await auth.setPassword(req.user.id,req.body?.newPassword,req.user.username,req.body.oldPassword);reply.header('Set-Cookie',`alsvid_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieSecurity(req)}`);return{ok:true};}catch(e){const allowed=['原密码不正确','密码须为 8–20 个字符'];return reply.code(400).send({error:allowed.includes(e.message)?e.message:'修改密码失败'});}});
app.post('/api/accounts/:id/password',async(req,reply)=>{if(req.params.id===req.user.id)return reply.code(400).send({error:'请使用修改自己密码功能'});try{await auth.setPassword(req.params.id,req.body?.newPassword,req.user.username);return{ok:true};}catch(e){const allowed=['账号不存在','密码须为 8–20 个字符'];return reply.code(e.message==='账号不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'重置密码失败'});}});
const pgProducts = process.env.DATABASE_URL ? createProductStore(process.env.DATABASE_URL) : null;
const pgService = process.env.DATABASE_URL ? createServiceStore(process.env.DATABASE_URL) : null;
const inventory = process.env.DATABASE_URL ? createInventory(process.env.DATABASE_URL) : null;
const completeProducts = process.env.DATABASE_URL ? createCompleteProductStore(process.env.DATABASE_URL) : null;
const objectStorage = createObjectStorage();
const db = postgres ? null : store.load();
const persist = () => store.save(db);
function audit(action, target, before, after) {
  db.auditLog ||= [];
  db.auditLog.push({ id: `audit-${Date.now()}-${db.auditLog.length + 1}`, actor: currentActor(), at: new Date().toISOString(), action, target, before: before ?? null, after: after ?? null });
  if (db.auditLog.length > 2000) db.auditLog.splice(0, db.auditLog.length - 2000);
}

app.get('/api/health', async (req,reply) => {
  if(!pgService)return reply.code(503).send({ok:false,service:'alsvid-v2',error:'数据库未配置'});
  try { await pgService.health(); return {ok:true,service:'alsvid-v2',port:PORT,storage:'postgres',objectStorageConfigured:!!objectStorage,timestamp:new Date().toISOString()}; }
  catch (_) { return reply.code(503).send({ok:false,service:'alsvid-v2',error:'数据库连接不可用'}); }
});
app.get('/api/audit', async () => postgres ? postgres.listAudit() : (db.auditLog || []));
app.addContentTypeParser(['image/jpeg','image/png','image/webp','image/avif','application/pdf'], { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 }, (req, body, done) => done(null, body));
app.post('/api/products/:id/media', async (req,reply)=>{
  if(!objectStorage)return reply.code(503).send({error:'对象存储尚未配置'});
  const type=(req.headers['content-type']||'').split(';')[0].trim();
  if(!/^image\/(jpeg|png|webp|avif)$/.test(type)||!Buffer.isBuffer(req.body)||!req.body.length)return reply.code(400).send({error:'请选择有效的图片'});
  const product=pgProducts?await pgProducts.get(req.params.id):db.products.find(p=>p.id===req.params.id);
  if(!product)return reply.code(404).send({error:'产品不存在'});
  const key=`products/${req.params.id}/${require('crypto').randomUUID()}`;
  let label=''; try { label=decodeURIComponent(String(req.headers['x-file-name']||'')).slice(0,200); } catch (_) { return reply.code(400).send({error:'文件名无效'}); }
  let uploaded=false;
  try {
    await objectStorage.put({key,contentType:type,body:req.body});
    uploaded=true;
    const media=pgProducts?await pgProducts.addMedia(req.params.id,{key,contentType:type,label}):{id:key,key,contentType:type,label};
    if(!pgProducts){product.images||=[];product.images.push(media);persist();}
    return reply.code(201).send(media);
  } catch (_) { if(uploaded) await objectStorage.remove(key).catch(()=>{}); return reply.code(502).send({error:'图片保存失败'}); }
});
app.get('/api/products/:id/media/:mediaId', async (req,reply)=>{
  if(!objectStorage)return reply.code(503).send({error:'对象存储尚未配置'});
  const product=pgProducts?await pgProducts.get(req.params.id):db.products.find(p=>p.id===req.params.id);
  const media=product?.images?.find(x=>x.id===req.params.mediaId);
  if(!media)return reply.code(404).send({error:'图片不存在'});
  try{const obj=await objectStorage.get(media.key);return reply.header('Cache-Control','private, max-age=300').type(media.contentType).send(obj.Body);}catch(error){if(error.name==='NoSuchKey'||error.$metadata?.httpStatusCode===404)return reply.code(404).send({error:'图片文件不存在'});return reply.code(502).send({error:'对象存储暂时不可用'});}
});

// ---------- 静态前端 ----------
const DIST = path.join(__dirname, '..', 'client', 'dist');
app.register(fastifyStatic, { root: DIST });

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Not Found' });
    return;
  }
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) reply.type('text/html').send(fs.readFileSync(index));
  else reply.code(503).send('前端尚未构建：请先执行 npm run build（client 目录）');
});

// ---------- 元数据 ----------
app.get('/api/meta', async () => ({
  ownership: store.OWNERSHIP,
  templates: store.TEMPLATES,
  specOptions: store.SPEC_OPTIONS,
  bomSections: store.BOM_SECTIONS,
}));
app.get('/api/dictionaries', async () => ({ ownership: store.OWNERSHIP, templates: store.TEMPLATES, specOptions: store.SPEC_OPTIONS, bomSections: store.BOM_SECTIONS, colors: postgres ? await postgres.listColors() : db.colors }));

// ---------- 字段标准库 ----------
app.get('/api/fields', async () => postgres ? await postgres.listFields() : db.fields);

app.post('/api/fields', async (req, reply) => {
  const f = req.body || {};
  if (!f.code || !f.nameZh) { reply.code(400).send({ error: '字段编码和中文名称必填' }); return; }
  if (postgres) { try { const row = await postgres.createField(f); reply.code(201).send(row); } catch (e) { reply.code(e.code === '23505' ? 409 : 400).send({ error: e.code === '23505' ? '字段编码已存在' : '字段写入失败' }); } return; }
  if (db.fields.some(x => x.code === f.code)) { reply.code(400).send({ error: '字段编码已存在：' + f.code }); return; }
  const field = {
    code: f.code, nameZh: f.nameZh, nameEn: f.nameEn || '', nameDe: f.nameDe || '',
    type: f.type || 'text', unit: f.unit || '', options: f.options || [],
    level: f.level || 'product', templates: f.templates || [],
    required: !!f.required, searchable: f.searchable !== false, skuGen: !!f.skuGen,
    shopVisible: !!f.shopVisible, enabled: true, version: 1,
  };
  db.fields.push(field);
  audit('field.create', `fields/${field.code}`, null, field);
  persist();
  reply.send(field);
});

app.put('/api/fields/:code', async (req, reply) => {
  if (postgres) { try { reply.send(await postgres.updateField(req.params.code, req.body || {})); } catch (e) { reply.code(e.message === '字段不存在' ? 404 : 400).send({ error: e.message === '字段不存在' ? e.message : '字段更新失败' }); } return; }
  const f = db.fields.find(x => x.code === req.params.code);
  if (!f) { reply.code(404).send({ error: '字段不存在' }); return; }
  const b = req.body || {};
  // 字段编码创建后不随意更改：只允许更新元数据
  Object.assign(f, {
    nameZh: b.nameZh ?? f.nameZh, nameEn: b.nameEn ?? f.nameEn, nameDe: b.nameDe ?? f.nameDe,
    unit: b.unit ?? f.unit, options: b.options ?? f.options, level: b.level ?? f.level,
    templates: b.templates ?? f.templates, required: b.required ?? f.required,
    searchable: b.searchable ?? f.searchable, skuGen: b.skuGen ?? f.skuGen,
    shopVisible: b.shopVisible ?? f.shopVisible, enabled: b.enabled ?? f.enabled,
  });
  audit('field.update', `fields/${f.code}`, null, f);
  persist();
  reply.send(f);
});

// ---------- 颜色字典（全局唯一一份，两个入口共用） ----------
app.get('/api/colors', async () => postgres ? await postgres.listColors() : db.colors);

app.post('/api/colors', async (req, reply) => {
  const c = req.body || {};
  const code = (c.code || '').toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) { reply.code(400).send({ error: '颜色代码必须为 3 位大写字母/数字，如 BLK' }); return; }
  if (postgres) { try { reply.code(201).send(await postgres.createColor({ ...c, code })); } catch (e) { reply.code(e.code === '23505' ? 409 : 400).send({ error: e.code === '23505' ? '颜色代码已存在' : '颜色写入失败' }); } return; }
  if (db.colors.some(x => x.code === code)) { reply.code(400).send({ error: '颜色代码已存在：' + code }); return; }
  const color = { code, zh: c.zh || '', en: c.en || '', de: c.de || '', hex: c.hex || '#cccccc', sort: c.sort || 50, enabled: true };
  db.colors.push(color);
  db.colors.sort((a, b) => a.sort - b.sort);
  audit('color.create', `colors/${color.code}`, null, color);
  persist();
  reply.send(color);
});

app.put('/api/colors/:code', async (req, reply) => {
  if (postgres) { try { reply.send(await postgres.updateColor(req.params.code, req.body || {})); } catch (e) { reply.code(e.message === '颜色不存在' ? 404 : 400).send({ error: e.message === '颜色不存在' ? e.message : '颜色更新失败' }); } return; }
  const c = db.colors.find(x => x.code === req.params.code);
  if (!c) { reply.code(404).send({ error: '颜色不存在' }); return; }
  const b = req.body || {};
  // 已被 SKU 使用的颜色代码不能改义，仅允许维护翻译与状态
  Object.assign(c, { zh: b.zh ?? c.zh, en: b.en ?? c.en, de: b.de ?? c.de, hex: b.hex ?? c.hex, sort: b.sort ?? c.sort, enabled: b.enabled ?? c.enabled });
  db.colors.sort((a, b) => a.sort - b.sort);
  audit('color.update', `colors/${c.code}`, null, c);
  persist();
  reply.send(c);
});

// ---------- SKU 编码 ----------
function buildSku(ownership, productType, spec, color) {
  return `${ownership}-${productType}-${spec}-${color}`;
}

app.post('/api/sku/preview', async (req, reply) => {
  const { ownership, productType, spec, color } = req.body || {};
  if (!ownership || !productType || !spec || !color) { reply.code(400).send({ error: '四段信息不完整' }); return; }
  const sku = buildSku(ownership, productType, spec, color);
  if (pgProducts) { const all = await pgProducts.list(); const dupOwner=all.find(p=>p.skus.some(s=>s.sku===sku)); return reply.send({sku,duplicated:!!dupOwner,owner:dupOwner?{id:dupOwner.id,name:dupOwner.name}:null}); }
  const dupOwner = db.products.find(p => p.skus.some(s => s.sku === sku));
  reply.send({ sku, duplicated: !!dupOwner, owner: dupOwner ? { id: dupOwner.id, name: dupOwner.name } : null });
});

app.post('/api/products/:id/skus', async (req, reply) => {
  if (pgProducts) { try { return reply.send(await pgProducts.addSkus(req.params.id, Array.isArray(req.body) ? req.body : [])); } catch (e) { return reply.code(e.message === '产品不存在' ? 404 : 400).send({ error: e.message === '产品不存在' ? e.message : 'SKU 写入失败' }); } }
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) { reply.code(404).send({ error: '产品不存在' }); return; }
  const items = req.body || []; // [{spec,color,price}]
  const added = [], skipped = [];
  for (const it of items) {
    if (!it.spec || !it.color) continue;
    const sku = buildSku(p.ownership, p.productType, it.spec, it.color);
    if (db.products.some(x => x.skus.some(s => s.sku === sku))) { skipped.push({ sku, reason: '编码已存在' }); continue; }
    if (p.skus.some(s => s.sku === sku)) { skipped.push({ sku, reason: '本产品已包含' }); continue; }
    const row = { sku, spec: it.spec, color: it.color, price: it.price || '', note: it.note || '' };
    p.skus.push(row);
    added.push(row);
  }
  if (added.length) audit('sku.create', `products/${p.id}/skus`, null, added);
  persist();
  reply.send({ added, skipped, skus: p.skus });
});

app.delete('/api/products/:id/skus/:sku', async (req, reply) => {
  if (pgProducts) { try { await pgProducts.deleteSku(req.params.id, req.params.sku); return reply.send({ ok: true }); } catch (e) { return reply.code(409).send({ error: e.message }); } }
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) { reply.code(404).send({ error: '产品不存在' }); return; }
  const removed = p.skus.find(s => s.sku === req.params.sku);
  const referenced = db.products.some(x => (x.bom?.items || []).some(it => it.sku === req.params.sku)) || db.vins.some(x => x.sku === req.params.sku) || db.repairs.some(x => x.sku === req.params.sku) || db.substitutes.some(x => x.originalSku === req.params.sku || x.replacementSku === req.params.sku);
  if (referenced) { reply.code(409).send({ error: '该 SKU 已被业务记录引用，不能删除' }); return; }
  const before = p.skus.length;
  p.skus = p.skus.filter(s => s.sku !== req.params.sku);
  if (p.skus.length === before) { reply.code(400).send({ error: 'SKU 不存在' }); return; }
  audit('sku.delete', `products/${p.id}/skus/${req.params.sku}`, removed, null);
  persist();
  reply.send({ ok: true, skus: p.skus });
});

// ---------- 产品 CRUD ----------
const KINDS = ['vehicle', 'part'];

app.get('/api/products', async (req) => {
  if (pgProducts) return pgProducts.list(req.query.kind);
  const kind = req.query.kind;
  let list = db.products;
  if (kind && KINDS.includes(kind)) list = list.filter(p => p.kind === kind);
  return list.map(publicProduct);
});

app.post('/api/products/complete', async (req,reply)=>{
  if(!completeProducts)return reply.code(503).send({error:'数据库不可用'});
  const b=req.body||{},images=Array.isArray(b.images)?b.images:[];
  const tpl=store.TEMPLATES.find(t=>t.code===b.productType&&t.kind===b.kind);
  if(!/^p-[0-9a-f-]{36}$/i.test(b.id||'')||!tpl||!String(b.name||'').trim()||!/^\w{1,8}$/.test(b.ownership||'')||(b.kind==='vehicle'&&!String(b.model||'').trim()))return reply.code(400).send({error:'请填写有效的名称、型号、品类和归属'});
  if(images.length>10||!Array.isArray(b.skus)||!Array.isArray(b.fitments)||!Array.isArray(b.bom?.items))return reply.code(400).send({error:'产品数据格式无效'});
  if(images.length&&!objectStorage)return reply.code(503).send({error:'对象存储未配置'});
  if(await completeProducts.exists(b.id))return reply.code(409).send({error:'此暂存已保存为产品，请返回列表查看'});
  const media=[],uploaded=[];let total=0;
  try{
    for(const img of images){if(!/^[0-9a-f-]{36}$/i.test(img.id||'')||!/^image\/(jpeg|png|webp|avif)$/.test(img.contentType||'')||typeof img.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(img.data))throw Error('图片格式无效');const bytes=Buffer.from(img.data,'base64');total+=bytes.length;if(!bytes.length||bytes.length>10*1024*1024||total>20*1024*1024)throw Error('图片单张不能超过 10 MB，总计不能超过 20 MB');const m={id:img.id,key:`products/${b.id}/${img.id}`,contentType:img.contentType,label:String(img.label||'').slice(0,200)};await objectStorage.put({...m,body:bytes});uploaded.push(m.key);media.push(m);}
    const result=await completeProducts.create(b,media);return reply.code(201).send(result);
  }catch(e){let committed=true;try{committed=await completeProducts.exists(b.id)}catch(_){}if(!committed)await Promise.allSettled(uploaded.map(key=>objectStorage.remove(key)));const known=['图片格式无效','图片单张不能超过 10 MB，总计不能超过 20 MB','SKU 规格或颜色编码无效','整车不支持配件适配','适配整车不存在','请填写 BOM 版本','BOM 物料层级引用无效','BOM 物料层级存在循环','BOM 物料、图纸编号和数量必填','BOM 配件 SKU 不存在','BOM 图纸标记无效'];return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'产品或 SKU 已存在':known.includes(e.message)?e.message:'保存失败，请检查网络和输入后重试'});}
});

app.post('/api/products', async (req, reply) => {
  const b = req.body || {};
  if (!b.kind || !KINDS.includes(b.kind)) { reply.code(400).send({ error: 'kind 必须是 vehicle 或 part' }); return; }
  if (!b.name) { reply.code(400).send({ error: '产品名称必填' }); return; }
  const tpl = store.TEMPLATES.find(t => t.code === b.productType);
  if (!tpl) { reply.code(400).send({ error: '产品类型/品类必选' }); return; }
  if (tpl.kind !== b.kind) { reply.code(400).send({ error: '产品类型与业务类型不匹配' }); return; }
  if (pgProducts) { try { const product = await pgProducts.create({ ...b, ownership: b.ownership || (b.kind === 'vehicle' ? (b.model || '').toUpperCase() : 'UN') }); reply.code(201).send(product); } catch (_) { reply.code(400).send({ error: '产品写入失败，请检查品类、归属和字段' }); } return; }
  const p = {
    id: 'p-' + (++db.counters.product) + '-' + Date.now().toString(36),
    kind: b.kind,
    name: b.name,
    model: b.model || (b.kind === 'vehicle' ? '' : ''),
    productType: b.productType,
    status: b.status || '启用',
    ownership: b.ownership || (b.kind === 'vehicle' ? (b.model || '').toUpperCase() : 'UN'),
    uses: b.uses || (b.kind === 'part' ? ['生产使用'] : []),
    specs: b.specs || {},
    skus: [],
    fitments: [],
    bom: b.kind === 'vehicle' ? { version: '', items: [] } : undefined,
    images: [],
    version: 1,
  };
  db.products.push(p);
  audit('product.create', `products/${p.id}`, null, p);
  persist();
  reply.code(201).send(publicProduct(p));
});

app.get('/api/products/:id', async (req, reply) => {
  if (pgProducts) { const product = await pgProducts.get(req.params.id); if (!product) return reply.code(404).send({ error: '产品不存在' }); return reply.send(product); }
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) { reply.code(404).send({ error: '产品不存在' }); return; }
  reply.send(publicProduct(p));
});

app.route({ method: ['PUT', 'PATCH'], url: '/api/products/:id', handler: async (req, reply) => {
  if (pgProducts) { try { return reply.send(await pgProducts.update(req.params.id, req.body || {})); } catch (e) { return reply.code(e.code === 'VERSION_CONFLICT' ? 409 : e.message === '产品不存在' ? 404 : 400).send({ error: e.message === '产品不存在' || e.code === 'VERSION_CONFLICT' ? e.message : '产品更新失败' }); } }
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) { reply.code(404).send({ error: '产品不存在' }); return; }
  const b = req.body || {};
  if (b.version !== undefined && Number(b.version) !== Number(p.version || 1)) { reply.code(409).send({ error: '数据已被其他操作更新，请刷新后重试', currentVersion: p.version || 1 }); return; }
  const before = JSON.parse(JSON.stringify(p));
  // SKU 一旦建立，编码含义不改写：不允许通过 PUT 修改 ownership/productType 使既有 SKU 失义
  const renameBlocked = (p.skus.length > 0) && (
    (b.ownership && b.ownership !== p.ownership) ||
    (b.productType && b.productType !== p.productType));
  if (renameBlocked) { reply.code(400).send({ error: '已存在 SKU 的产品不能修改归属/品类编码，否则 SKU 含义会失效' }); return; }
  ['name', 'model', 'productType', 'status', 'ownership', 'uses', 'specs', 'fitments', 'images'].forEach(k => {
    if (b[k] !== undefined) p[k] = b[k];
  });
  if (b.bom && p.kind === 'vehicle') p.bom = b.bom;
  p.version = Number(p.version || 1) + 1;
  audit('product.update', `products/${p.id}`, before, p);
  persist();
  reply.send(publicProduct(p));
}});

app.delete('/api/products/:id', async (req, reply) => {
  if (pgProducts) return reply.code(409).send({error:'PostgreSQL 模式下暂不支持物理删除产品，请停用产品以保留业务追溯'});
  const i = db.products.findIndex(x => x.id === req.params.id);
  if (i < 0) { reply.code(404).send({ error: '产品不存在' }); return; }
  const p = db.products[i];
  if (p.skus.some(s => !s.note || !s.note.includes('示例'))) {
    reply.code(400).send({ error: '该产品存在正式 SKU（可能已用于订单/库存），不允许直接删除' }); return;
  }
  db.products.splice(i, 1);
  audit('product.delete', `products/${p.id}`, p, null);
  persist();
  reply.send({ ok: true });
});

function publicProduct(p) {
  const out = { ...p };
  out.skuCount = p.skus.length;
  out.colorCount = new Set(p.skus.map(s => s.color)).size;
  return out;
}

// ---------- BOM（第一阶段简化版：物料行 + 图纸编号，第二阶段做图文联动） ----------
app.get('/api/products/:id/bom/versions', async (req,reply) => {
  if(!pgProducts)return reply.code(503).send({error:'历史版本需要数据库存储'});
  const versions=await pgProducts.listBomVersions(req.params.id);
  return versions===null?reply.code(404).send({error:'整车产品不存在'}):versions;
});
app.get('/api/products/:id/bom/versions/:version', async (req,reply) => {
  if(!pgProducts)return reply.code(503).send({error:'历史版本需要数据库存储'});
  const version=await pgProducts.getBomVersion(req.params.id,req.params.version);
  return version||reply.code(404).send({error:'BOM 版本不存在'});
});
app.put('/api/products/:id/bom', async (req, reply) => {
  if (pgProducts) { try { return reply.send(await pgProducts.saveBom(req.params.id,req.body||{})); } catch(e) { const known=e.message.includes('不存在')||e.message.startsWith('BOM 物料')||e.message.startsWith('BOM 图纸'); return reply.code(known?400:409).send({error:known?e.message:'BOM 版本已存在或保存失败'}); } }
  const p = db.products.find(x => x.id === req.params.id);
  if (!p || p.kind !== 'vehicle') { reply.code(404).send({ error: '整车产品不存在' }); return; }
  const b = req.body || {};
  // 校验：BOM 物料必须引用零配件库中真实存在的 SKU
  const allPartSkus = new Set();
  db.products.filter(x => x.kind === 'part').forEach(x => x.skus.forEach(s => allPartSkus.add(s.sku)));
  const bad = (b.items || []).filter(it => !allPartSkus.has(it.sku));
  if (bad.length) {
    reply.code(400).send({ error: '以下物料 SKU 在零配件库中不存在：' + bad.map(x => x.sku).join(', ') });
    return;
  }
  p.bom = { version: b.version || p.bom.version || 'V1.0', items: b.items || [] };
  audit('bom.update', `products/${p.id}/bom`, null, p.bom);
  persist();
  reply.send(p.bom);
});

// ---------- 服务与追溯资源：VIN / 维修 / 适配 / 替代 ----------
app.get('/api/summary', async () => pgService ? pgService.summary() : ({
  vehicles: db.products.filter(p => p.kind === 'vehicle').length,
  parts: db.products.filter(p => p.kind === 'part').length,
  skus: db.products.reduce((n, p) => n + p.skus.length, 0),
  vins: db.vins.length,
  repairsOpen: db.repairs.filter(r => !['已关闭', '已完成'].includes(r.status)).length,
  repairs: db.repairs.length,
  fitments: db.products.reduce((n, p) => n + (p.fitments || []).length, 0),
  substitutes: db.substitutes.length,
  audits: (db.auditLog || []).length,
}));

app.get('/api/factories',async(req,reply)=>postgres?postgres.listFactories():reply.code(503).send({error:'工厂服务不可用'}));
app.post('/api/factories',async(req,reply)=>{if(!postgres)return reply.code(503).send({error:'工厂服务不可用'});try{return reply.code(201).send(await postgres.createFactory(req.body||{}))}catch(e){return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'工厂名称已存在':e.message==='工厂名称必填且不能超过 120 个字符'?e.message:'创建工厂失败'})}});
app.patch('/api/factories/:id',async(req,reply)=>{if(!postgres)return reply.code(503).send({error:'工厂服务不可用'});try{return await postgres.updateFactory(req.params.id,req.body||{})}catch(e){return reply.code(e.code==='23505'?409:e.message==='工厂不存在'?404:400).send({error:e.code==='23505'?'工厂名称已存在':e.message==='工厂不存在'||e.message==='工厂资料无效'?e.message:'更新工厂失败'})}});
app.get('/api/warehouses',async(req,reply)=>inventory?inventory.listWarehouses():reply.code(503).send({error:'库存服务不可用'}));
app.get('/api/stock',async(req,reply)=>inventory?inventory.listStock():reply.code(503).send({error:'库存服务不可用'}));
app.get('/api/stock/movements',async(req,reply)=>inventory?inventory.listMovements():reply.code(503).send({error:'库存服务不可用'}));
app.patch('/api/warehouses/:id',async(req,reply)=>{if(!inventory)return reply.code(503).send({error:'库存服务不可用'});try{return await inventory.updateWarehouse(req.params.id,req.body||{})}catch(e){const allowed=['仓库资料无效','仓库不存在'];return reply.code(e.code==='23505'?409:e.message==='仓库不存在'?404:400).send({error:e.code==='23505'?'仓库编号或名称已存在':allowed.includes(e.message)?e.message:'更新仓库失败'})}});
app.delete('/api/warehouses/:id',async(req,reply)=>{if(!inventory)return reply.code(503).send({error:'库存服务不可用'});try{return await inventory.deleteWarehouse(req.params.id)}catch(e){return reply.code(e.message==='仓库不存在'?404:400).send({error:e.code==='23503'?'仓库存在库存或关联业务记录，不能删除':['仓库不存在','仓库存在库存或关联业务记录，不能删除'].includes(e.message)?e.message:'删除仓库失败'})}});
app.post('/api/warehouses',async(req,reply)=>{if(!inventory)return reply.code(503).send({error:'库存服务不可用'});try{return reply.code(201).send(await inventory.createWarehouse(req.body||{}))}catch(e){return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'仓库名称已存在':e.message==='仓库名称和类型无效'?e.message:'创建仓库失败'})}});
app.post('/api/stock/movements',async(req,reply)=>{if(!inventory)return reply.code(503).send({error:'库存服务不可用'});try{return reply.code(201).send(await inventory.move(req.body||{}))}catch(e){const allowed=['请填写有效的物料、数量和业务说明','调拨来源和目标仓库无效','操作编号已用于其他库存变动','配件 SKU 不存在','仓库不存在','来源仓库库存不足'];return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'该库存操作正在处理，请重试':allowed.includes(e.message)?e.message:'库存变动失败'})}});
app.get('/api/production-orders/:id/attachments',async(req,reply)=>pgService?pgService.listProductionAttachments(req.params.id):reply.code(503).send({error:'生产服务不可用'}));
app.post('/api/production-orders/:id/attachments',async(req,reply)=>{if(!pgService||!objectStorage)return reply.code(503).send({error:'附件存储不可用'});const type=String(req.headers['content-type']||'').split(';')[0].trim();if(!['image/jpeg','image/png','image/webp','image/avif','application/pdf'].includes(type)||!Buffer.isBuffer(req.body)||!req.body.length||req.body.length>10*1024*1024)return reply.code(400).send({error:'仅支持 10MB 以内的 PDF 或图片附件'});let fileName='';try{fileName=decodeURIComponent(String(req.headers['x-file-name']||'')).slice(0,200)}catch(_){return reply.code(400).send({error:'文件名无效'})}if(!fileName)return reply.code(400).send({error:'文件名必填'});const key=`production-orders/${req.params.id}/${require('crypto').randomUUID()}`;try{await objectStorage.put({key,contentType:type,body:req.body});const row=await pgService.addProductionAttachment(req.params.id,{key,fileName,contentType:type,fileSize:req.body.length});return reply.code(201).send(row)}catch(e){await objectStorage.remove(key).catch(()=>{});return reply.code(e.message==='生产订单不存在'?404:502).send({error:e.message==='生产订单不存在'?e.message:'附件保存失败'})}});
app.get('/api/production-orders/:id/attachments/:attachmentId',async(req,reply)=>{if(!pgService||!objectStorage)return reply.code(503).send({error:'附件存储不可用'});const record=await pgService.getProductionAttachment(req.params.id,req.params.attachmentId);if(!record)return reply.code(404).send({error:'附件不存在'});try{const obj=await objectStorage.get(record.key);return reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(record.fileName)}`).type(record.contentType).send(obj.Body)}catch(_){return reply.code(502).send({error:'附件读取失败'})}});
app.get('/api/production-orders/:id/materials',async(req,reply)=>pgService?pgService.listOrderMaterials(req.params.id):reply.code(503).send({error:'生产服务不可用'}));
app.patch('/api/production-orders/:id/materials/:materialId',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产服务不可用'});try{return await pgService.updateMaterialSupplier(req.params.id,req.params.materialId,req.body?.supplyParty)}catch(e){return reply.code(e.message==='生产物料不存在'?404:400).send({error:['供料方无效','生产物料不存在'].includes(e.message)?e.message:'更新物料供料方失败'})}});
app.patch('/api/production-orders/:id/progress',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产服务不可用'});try{return await pgService.updateProductionProgress(req.params.id,req.body||{})}catch(e){const allowed=['进度须为 0–100 的整数，完成数量不能为负数','生产订单不存在','当前状态不能更新生产进度','实际完成数量不能超过计划数量'];return reply.code(e.message==='生产订单不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'更新生产进度失败'})}});
app.patch('/api/production-orders/:id/quality',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产服务不可用'});try{return await pgService.updateProductionQuality(req.params.id,req.body||{})}catch(e){const allowed=['请选择质检结果并填写质检说明','生产订单不存在','当前状态不能登记质检'];return reply.code(e.message==='生产订单不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'更新质检记录失败'})}});
app.get('/api/production-orders/:id/deliveries',async(req,reply)=>pgService?pgService.listDeliveries(req.params.id):reply.code(503).send({error:'生产服务不可用'}));
app.post('/api/production-orders/:id/deliveries',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产服务不可用'});try{return reply.code(201).send(await pgService.createDelivery(req.params.id,req.body||{}))}catch(e){const allowed=['发运单号、目标仓库和正整数发运数量必填','生产订单不存在','生产订单完成后才能发运','请选择已启用的国内仓或海外仓','发运数量超过生产订单计划数量'];return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'发运单号已存在':allowed.includes(e.message)?e.message:'创建发运记录失败'})}});
app.post('/api/production-deliveries/:id/dispatch',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产服务不可用'});try{return await pgService.dispatchDelivery(req.params.id)}catch(e){const allowed=['发运记录不存在','只有待发运记录可以标记发出'];return reply.code(e.message==='发运记录不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'更新发运状态失败'})}});
app.get('/api/production-deliveries/:id/receipts',async(req,reply)=>pgService?pgService.listDeliveryReceipts(req.params.id):reply.code(503).send({error:'生产服务不可用'}));
app.post('/api/production-deliveries/:id/receive',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产服务不可用'});try{return await pgService.receiveDelivery(req.params.id,req.body||{})}catch(e){const allowed=['签收编号或数量无效','发运记录不存在','只有在途发运记录可以签收','该发运记录已全部签收入库','该发运记录已签收入库','签收数量不能超过本批发运数量','本次签收后仍有未到数量，必须填写差异说明','签收数量超过本批剩余发运数量','签收编号已用于其他记录'];return reply.code(400).send({error:allowed.includes(e.message)?e.message:'签收入库失败'})}});
app.get('/api/finance/production-costs',async(req,reply)=>pgService?pgService.listProductionCosts():reply.code(503).send({error:'生产成本服务不可用'}));
app.get('/api/production-orders',async(req,reply)=>pgService?pgService.listProductionOrders():reply.code(503).send({error:'生产订单需要数据库存储'}));
app.post('/api/production-orders',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产订单需要数据库存储'});try{return reply.code(201).send(await pgService.createProductionOrder(req.body||{}));}catch(e){const allowed=['订单号、整车 SKU、BOM 版本、工厂、批次和正整数计划数量必填','BOM 版本不属于所选整车','请选择已启用的合作工厂','供料方式、成本金额或币种无效'];return reply.code(e.code==='23505'?409:400).send({error:e.code==='23505'?'生产订单号已存在':allowed.includes(e.message)?e.message:'生产订单创建失败'});}});
app.patch('/api/production-orders/:id/status',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'生产订单需要数据库存储'});try{return await pgService.transitionProductionOrder(req.params.id,req.body?.status)}catch(e){const allowed=['生产订单不存在','订单状态流转无效','关联 VIN 数量须等于计划数量才能完成','质检合格后才能完成生产订单','已有 VIN 关联的订单不能取消'];return reply.code(e.message==='生产订单不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'更新订单状态失败'});}});
app.get('/api/vins', async (req) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (pgService) return pgService.listVins(q);
  return db.vins.filter(v => !q || [v.vin, v.model, v.sku, v.batch, v.factory].some(x => String(x || '').toLowerCase().includes(q)));
});
app.get('/api/vins/:id/trace', async (req,reply) => { if (pgService) { const trace=await pgService.getVinTrace(req.params.id); return trace ? reply.send(trace) : reply.code(404).send({error:'VIN 档案不存在'}); } const v=db.vins.find(x=>x.id===req.params.id); return v ? reply.send({...v,repairs:db.repairs.filter(r=>r.vin===v.vin)}) : reply.code(404).send({error:'VIN 档案不存在'}); });
app.put('/api/vins/:id/installed', async (req,reply) => { if (!pgService) return reply.code(501).send({error:'实际装车明细需要数据库存储'}); try { return reply.send(await pgService.replaceInstalled(req.params.id,req.body?.items)); } catch(e) { return reply.code(e.message==='VIN 档案不存在'?404:400).send({error:e.message}); } });
app.post('/api/vins', async (req, reply) => {
  const b = req.body || {};
  if (pgService) { try { return reply.code(201).send(await pgService.createVin(b)); } catch(e) { const allowed=['VIN 格式无效','整车 SKU 不存在','选择 BOM 版本前请先选择整车 SKU','BOM 版本不属于所选整车','生产订单不存在','VIN 的整车 SKU、BOM 版本、工厂和批次须与生产订单一致','仅生产中的订单可以关联新 VIN','订单关联 VIN 数量已达到计划数量','已关联生产订单的 VIN 不能变更订单']; return reply.code(e.code === '23505' ? 409 : 400).send({error:e.code === '23505' ? 'VIN 已存在' : allowed.includes(e.message) ? e.message : 'VIN 档案写入失败'}); } }
  const vin = String(b.vin || '').trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,20}$/.test(vin)) { reply.code(400).send({ error: 'VIN 必须为 11–20 位有效字符' }); return; }
  if (db.vins.some(v => String(v.vin).toUpperCase() === vin)) { reply.code(409).send({ error: 'VIN 已存在' }); return; }
  if (b.sku && !db.products.some(p => p.kind === 'vehicle' && p.skus.some(s => s.sku === b.sku))) { reply.code(400).send({ error: '整车 SKU 不存在' }); return; }
  const v = { id: `vin-${++db.counters.vin}`, vin, model: b.model || '', sku: b.sku || '', orderNo: b.orderNo || '', factory: b.factory || '', batch: b.batch || '', bomVersion: b.bomVersion || '', installed: b.installed || '', serials: b.serials || '', producedAt: b.producedAt || '', status: b.status || '在用', createdAt: new Date().toISOString() };
  db.vins.push(v); audit('vin.create', `vins/${v.id}`, null, v); persist(); reply.code(201).send(v);
});
app.patch('/api/vins/:id', async (req, reply) => {
  if (pgService) { try { return reply.send(await pgService.updateVin(req.params.id,req.body||{})); } catch(e) { const allowed=['VIN 档案不存在','VIN 格式无效','整车 SKU 不存在','选择 BOM 版本前请先选择整车 SKU','BOM 版本不属于所选整车','生产订单不存在','VIN 的整车 SKU、BOM 版本、工厂和批次须与生产订单一致','仅生产中的订单可以关联新 VIN','订单关联 VIN 数量已达到计划数量','已关联生产订单的 VIN 不能变更订单']; return reply.code(e.message === 'VIN 档案不存在' ? 404 : e.code === '23505' ? 409 : 400).send({error:e.code === '23505' ? 'VIN 已存在' : allowed.includes(e.message) ? e.message : 'VIN 档案更新失败'}); } }
  const v = db.vins.find(x => x.id === req.params.id); if (!v) { reply.code(404).send({ error: 'VIN 档案不存在' }); return; }
  const b = req.body || {}; const vin = String(b.vin ?? v.vin).trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,20}$/.test(vin)) { reply.code(400).send({ error: 'VIN 必须为 11–20 位有效字符' }); return; }
  if (db.vins.some(x => x.id !== v.id && String(x.vin).toUpperCase() === vin)) { reply.code(409).send({ error: 'VIN 已存在' }); return; }
  if (vin !== v.vin && db.repairs.some(r => r.vin === v.vin)) { reply.code(409).send({ error: 'VIN 已关联维修工单，不能更改' }); return; }
  if (b.sku && !db.products.some(p => p.kind === 'vehicle' && p.skus.some(s => s.sku === b.sku))) { reply.code(400).send({ error: '整车 SKU 不存在' }); return; }
  const before = { ...v }; for (const k of ['model','sku','orderNo','factory','batch','bomVersion','installed','serials','producedAt','status']) if (b[k] !== undefined) v[k] = b[k]; v.vin = vin; audit('vin.update', `vins/${v.id}`, before, v); persist(); reply.send(v);
});

app.get('/api/repairs', async (req) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (pgService) return pgService.listRepairs(q);
  return db.repairs.filter(r => !q || [r.no, r.vin, r.type, r.fault, r.store, r.status].some(x => String(x || '').toLowerCase().includes(q)));
});
app.post('/api/repairs', async (req, reply) => {
  const b = req.body || {};
  if (pgService) { if (!b.vin || !b.fault) return reply.code(400).send({error:'VIN 和故障描述必填'}); try { return reply.code(201).send(await pgService.createRepair(b)); } catch(e) { return reply.code(e.code === '23503' ? 400 : 400).send({error:e.code === '23503' ? 'VIN 或配件 SKU 不存在' : '维修工单写入失败'}); } }
  if (!b.vin || !b.fault) { reply.code(400).send({ error: 'VIN 和故障描述必填' }); return; }
  if (!db.vins.some(v => v.vin === b.vin)) { reply.code(400).send({ error: 'VIN 不存在，请先建立车辆档案' }); return; }
  if (b.sku && !db.products.some(p => p.kind === 'part' && p.skus.some(s => s.sku === b.sku))) { reply.code(400).send({ error: '维修配件 SKU 不存在' }); return; }
  if (b.qty !== undefined && (!Number.isInteger(Number(b.qty)) || Number(b.qty) < 1)) { reply.code(400).send({ error: '数量必须为正整数' }); return; }
  if (['已完成', '已关闭'].includes(b.status)) { reply.code(400).send({ error: '新工单不能直接设为完成或关闭' }); return; }
  const r = { id: `repair-${++db.counters.repair}`, no: `WO-${String(db.counters.repair).padStart(5, '0')}`, vin: b.vin, type: b.type || '质保维修', fault: b.fault, sku: b.sku || '', qty: Number(b.qty || 0), store: b.store || '', status: b.status || '待收货', oldPart: b.oldPart || '', createdAt: new Date().toISOString().slice(0, 10) };
  db.repairs.push(r); audit('repair.create', `repairs/${r.id}`, null, r); persist(); reply.code(201).send(r);
});
app.post('/api/repairs/:id/complete',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'维修服务不可用'});try{return await pgService.completeRepair(req.params.id,req.body||{})}catch(e){const allowed=['维修工单不存在','只有维修中的工单可以完成更换','工单未指定更换配件','工单数量无效','净领用数量须等于工单数量','VIN 档案不存在','所选原装配件不存在或数量不足','记录序列号时更换数量必须为一','有序列号的原配件只能逐件更换'];return reply.code(e.message==='维修工单不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'完成维修失败'});}});
app.get('/api/repairs/:id/old-part',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'维修服务不可用'});const record=await pgService.getRecovery(req.params.id);return record||reply.code(404).send({error:'旧件回收记录不存在'});});
app.post('/api/repairs/:id/old-part',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'维修服务不可用'});try{return await pgService.transitionRecovery(req.params.id,req.body||{})}catch(e){const allowed=['请填写旧件处理说明','旧件回收记录不存在','旧件状态流转无效','请选择旧件退回仓库','已有入库申请，不能更改旧件状态'];return reply.code(e.message==='旧件回收记录不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'更新旧件状态失败'});}});
app.post('/api/repairs/:id/old-part/restock/:action',async(req,reply)=>{if(!pgService)return reply.code(503).send({error:'维修服务不可用'});try{const actions={request:()=>pgService.requestOldPartRestock(req.params.id,req.body||{}),approve:()=>pgService.approveOldPartRestock(req.params.id),cancel:()=>pgService.cancelOldPartRestock(req.params.id)};if(!Object.hasOwn(actions,req.params.action))return reply.code(404).send({error:'操作不存在'});return await actions[req.params.action]()}catch(e){const allowed=['请填写翻新与检测说明','旧件回收记录不存在','旧件须先退回并经过检测或返修','旧件已有入库申请','旧件尚未申请入库','旧件已经批准入库','旧件状态不允许入库','旧件 SKU 不存在','没有可撤销的入库申请'];return reply.code(e.message==='旧件回收记录不存在'?404:400).send({error:allowed.includes(e.message)?e.message:'旧件入库操作失败'});}});
app.get('/api/repairs/:id/stock',async(req,reply)=>inventory?inventory.listRepairMoves(req.params.id):reply.code(503).send({error:'库存服务不可用'}));
app.post('/api/repairs/:id/stock',async(req,reply)=>{if(!inventory)return reply.code(503).send({error:'库存服务不可用'});try{return reply.code(201).send(await inventory.repairMove(req.params.id,req.body||{}));}catch(e){const allowed=['领用或退回数量无效','维修工单不存在','工单未指定更换配件','操作编号已用于其他领退料','已完成或关闭的工单不能领退料','领用数量超过工单数量','退回数量超过该仓库未退回的领用数量','请选择维修店仓','维修店仓库存不足'];return reply.code(e.message==='维修工单不存在'?404:e.code==='23505'?409:400).send({error:e.code==='23505'?'该操作正在处理，请重试':allowed.includes(e.message)?e.message:'工单领退料失败'});}});
app.patch('/api/repairs/:id', async (req, reply) => {
  if (pgService) { try { return reply.send(await pgService.updateRepair(req.params.id,req.body||{})); } catch(e) { const allowed=['维修工单不存在','已有领退料记录的工单不能更改车辆、配件或数量','请通过完成更换记录工单','已完成或关闭的工单不能重新打开','工单完成后才能关闭','已完成的工单不能更改车辆、配件或数量'];return reply.code(e.message === '维修工单不存在' ? 404 : 400).send({error:allowed.includes(e.message)?e.message:'维修工单更新失败'}); } }
  const r = db.repairs.find(x => x.id === req.params.id); if (!r) { reply.code(404).send({ error: '维修工单不存在' }); return; }
  const b = req.body || {}; const nextVin = b.vin ?? r.vin; const nextSku = b.sku ?? r.sku;
  if (!db.vins.some(v => v.vin === nextVin)) { reply.code(400).send({ error: 'VIN 档案不存在' }); return; }
  if (nextSku && !db.products.some(p => p.kind === 'part' && p.skus.some(s => s.sku === nextSku))) { reply.code(400).send({ error: '维修配件 SKU 不存在' }); return; }
  if (b.qty !== undefined && (!Number.isInteger(Number(b.qty)) || Number(b.qty) < 1)) { reply.code(400).send({ error: '数量必须为正整数' }); return; }
  if (b.fault !== undefined && !String(b.fault).trim()) { reply.code(400).send({ error: '故障描述必填' }); return; }
  if (b.status !== undefined && !['待收货','维修中','待配件','已完成','已关闭'].includes(b.status)) { reply.code(400).send({ error: '工单状态无效' }); return; }
  const before = { ...r }; for (const k of ['vin','type','fault','sku','qty','store','status','oldPart','result','newSerial','oldSerial']) if (b[k] !== undefined) r[k] = k === 'qty' ? Number(b[k]) : b[k]; audit('repair.update', `repairs/${r.id}`, before, r); persist(); reply.send(r);
});

app.get('/api/substitutes', async () => pgService ? pgService.listSubs() : db.substitutes);
app.post('/api/substitutes', async (req, reply) => {
  const b = req.body || {};
  if (pgService) { if (!b.originalSku || !b.replacementSku || !b.reason) return reply.code(400).send({error:'原 SKU、替代 SKU 和变更原因必填'}); try { return reply.code(201).send(await pgService.createSub(b)); } catch(e) { return reply.code(e.code === '23503' ? 400 : 400).send({error:e.code === '23503' ? 'SKU 不存在' : e.message === '替代前后 SKU 不能相同' ? e.message : '替代关系写入失败'}); } }
  if (!b.originalSku || !b.replacementSku || !b.reason) { reply.code(400).send({ error: '原 SKU、替代 SKU 和变更原因必填' }); return; }
  if (b.originalSku === b.replacementSku) { reply.code(400).send({ error: '替代前后 SKU 不能相同' }); return; }
  const all = new Set(db.products.filter(p => p.kind === 'part').flatMap(p => p.skus.map(s => s.sku)));
  if (!all.has(b.originalSku) || !all.has(b.replacementSku)) { reply.code(400).send({ error: '原 SKU 和替代 SKU 都必须来自零配件库' }); return; }
  const s = { id: `sub-${++db.counters.substitute}`, originalSku: b.originalSku, replacementSku: b.replacementSku, reason: b.reason, effectiveAt: b.effectiveAt || new Date().toISOString().slice(0, 10), status: b.status || '启用', note: b.note || '' };
  db.substitutes.push(s); audit('substitute.create', `substitutes/${s.id}`, null, s); persist(); reply.code(201).send(s);
});
app.patch('/api/substitutes/:id', async (req, reply) => {
  if (pgService) { try { return reply.send(await pgService.updateSub(req.params.id,req.body||{})); } catch(e) { return reply.code(e.message === '替代关系不存在' ? 404 : 400).send({error:e.message === '替代关系不存在' ? e.message : '替代关系更新失败'}); } }
  const s = db.substitutes.find(x => x.id === req.params.id); if (!s) { reply.code(404).send({ error: '替代关系不存在' }); return; }
  const before = { ...s }; Object.assign(s, req.body || {}); audit('substitute.update', `substitutes/${s.id}`, before, s); persist(); reply.send(s);
});

// ---------- 统一搜索（第 14 章：基于主档 + SKU + 字段值 + 适配关系） ----------
app.get('/api/search', async (req) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return [];
  const hit = (...vals) => vals.filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  const results = [];
  if (pgProducts) {
    const all=await pgProducts.list(); const fields=await postgres.listFields(); const colors=await postgres.listColors();
    const hit=(...vals)=>vals.filter(Boolean).some(v=>String(v).toLowerCase().includes(q));
    return all.filter(p=>hit(p.name,p.model,p.productType,p.ownership)||Object.entries(p.specs||{}).some(([code,value])=>{const f=fields.find(x=>x.code===code);return hit(value,code,f?.nameZh,f?.nameEn,f?.nameDe);})||p.skus.some(s=>hit(s.sku,s.color))||p.fitments.some(f=>hit(f.vehicleModel,f.note))||colors.some(c=>hit(c.code,c.zh,c.en,c.de)&&p.skus.some(s=>s.color===c.code))).map(p=>({id:p.id,kind:p.kind,name:p.name,model:p.model,productType:p.productType,status:p.status,skuCount:p.skuCount}));
  }
  for (const p of db.products) {
    const fieldHit = Object.entries(p.specs || {}).some(([code, v]) => {
      const f = db.fields.find(x => x.code === code);
      return hit(v, code, f ? f.nameZh : '', f ? f.nameEn : '', f ? f.nameDe : '');
    });
    const skuHit = p.skus.some(s => hit(s.sku, s.color));
    const fitHit = (p.fitments || []).some(f => hit(f.vehicleModel, f.note));
    const colorHit = db.colors.some(c => c.code && hit(c.zh, c.en, c.de, c.code) && p.skus.some(s => s.color === c.code));
    if (hit(p.name, p.model, p.productType, p.ownership) || fieldHit || skuHit || fitHit || colorHit) {
      results.push({ id: p.id, kind: p.kind, name: p.name, model: p.model, productType: p.productType, status: p.status, skuCount: p.skus.length });
    }
  }
  return results;
});

// 崩溃留痕：后台进程被终止或异常退出时，至少能查到原因
const ERR_LOG = path.join(__dirname, '..', 'data', 'server-error.log');
function logFatal(tag, e) {
  try {
    fs.appendFileSync(ERR_LOG, `[${new Date().toISOString()}] ${tag}: ${e && e.stack ? e.stack : e}\n`, 'utf8');
  } catch (_) { /* 日志写入失败不影响主流程 */ }
}
process.on('uncaughtException', (e) => { logFatal('uncaughtException', e); process.exit(1); });
process.on('unhandledRejection', (e) => logFatal('unhandledRejection', e));

app.listen({ port: PORT, host: networkPolicy.bindHost }).then(() => {
  console.log(`ALSVID V2.0 内部管理系统已启动: http://localhost:${PORT}`);
}).catch((e) => {
  logFatal('listenFailed', e);
  console.error(e);
  process.exit(1);
});
