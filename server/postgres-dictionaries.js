const { currentActor } = require('./audit-context');
// Resource-level PostgreSQL operations; the API is not switched over yet.
const { createPool } = require('./db-pool');
const { SEED_FIELDS, SEED_COLORS } = require('./db');

function createDictionaryStore(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = createPool(connectionString, { max: 3, connectionTimeoutMillis: 10000 });
  const fieldColumns = `code, name_zh AS "nameZh", name_en AS "nameEn", name_de AS "nameDe", data_type AS type, unit, options, level, templates, required, searchable, sku_gen AS "skuGen", shop_visible AS "shopVisible", enabled`;
  const colorColumns = 'code, zh, en, de, hex, sort, enabled';
  async function transaction(action, target, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { before, after } = await work(client);
      await client.query('INSERT INTO audit_log(actor,action,target,before_json,after_json) VALUES ($1,$2,$3,$4,$5)', [currentActor(), action, target, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return {
    async listFactories() {
      return (await pool.query('SELECT id,name,country,contact,email,phone,address,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM factories ORDER BY name')).rows;
    },
    async createFactory(input) {
      const name=String(input.name||'').trim();
      if(!name||name.length>120) throw new Error('工厂名称必填且不能超过 120 个字符');
      const id=require('crypto').randomUUID();
      return transaction('factory.create',`factories/${id}`,async client=>{
        const row=(await client.query('INSERT INTO factories(id,name,country,contact,email,phone,address) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,country,contact,email,phone,address,status',[id,name,String(input.country||'中国').trim(),String(input.contact||'').trim(),String(input.email||'').trim(),String(input.phone||'').trim(),String(input.address||'').trim()])).rows[0];
        return {before:null,after:row};
      });
    },
    async updateFactory(id,input) {
      return transaction('factory.update',`factories/${id}`,async client=>{
        const prior=(await client.query('SELECT id,name,country,contact,email,phone,address,status FROM factories WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!prior) throw new Error('工厂不存在');
        const next={...prior,...Object.fromEntries(Object.entries(input).filter(([key])=>['name','country','contact','email','phone','address','status'].includes(key)))};
        next.name=String(next.name||'').trim();
        if(!next.name||next.name.length>120||!['启用','停用'].includes(next.status)) throw new Error('工厂资料无效');
        const after=(await client.query('UPDATE factories SET name=$1,country=$2,contact=$3,email=$4,phone=$5,address=$6,status=$7,updated_at=now() WHERE id=$8 RETURNING id,name,country,contact,email,phone,address,status',[next.name,next.country,next.contact,next.email,next.phone,next.address,next.status,id])).rows[0];
        return {before:prior,after};
      });
    },
    async seedBaseline() {
      const c=await pool.connect();
      try { await c.query('BEGIN');
        for(const f of SEED_FIELDS) await c.query(`INSERT INTO fields(code,name_zh,name_en,name_de,data_type,unit,options,level,templates,required,searchable,sku_gen,shop_visible,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(code) DO NOTHING`,[f.code,f.nameZh,f.nameEn||'',f.nameDe||'',f.type||'text',f.unit||'',JSON.stringify(f.options||[]),f.level||'product',JSON.stringify(f.templates||[]),!!f.required,f.searchable!==false,!!f.skuGen,!!f.shopVisible,f.enabled!==false]);
        for(const color of SEED_COLORS) await c.query('INSERT INTO colors(code,zh,en,de,hex,sort,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(code) DO NOTHING',[color.code,color.zh,color.en,color.de,color.hex,color.sort,color.enabled!==false]);
        await c.query('COMMIT');
      } catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;} finally{c.release();}
    },
    async listAudit() { return (await pool.query('SELECT id,actor,action,target,before_json AS before,after_json AS after,created_at AS at FROM audit_log ORDER BY id DESC LIMIT 2000')).rows; },
    async listFields() { return (await pool.query(`SELECT ${fieldColumns} FROM fields ORDER BY code`)).rows; },
    async listColors() { return (await pool.query(`SELECT ${colorColumns} FROM colors ORDER BY sort,code`)).rows; },
    async createField(f) {
      return transaction('field.create', `fields/${f.code}`, async client => {
        const values = [f.code,f.nameZh,f.nameEn || '',f.nameDe || '',f.type || 'text',f.unit || '',JSON.stringify(f.options || []),f.level || 'product',JSON.stringify(f.templates || []),!!f.required,f.searchable !== false,!!f.skuGen,!!f.shopVisible,f.enabled !== false];
        const result = await client.query(`INSERT INTO fields(code,name_zh,name_en,name_de,data_type,unit,options,level,templates,required,searchable,sku_gen,shop_visible,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${fieldColumns}`, values);
        return { before: null, after: result.rows[0] };
      });
    },
    async updateField(code, patch) {
      return transaction('field.update', `fields/${code}`, async client => {
        const prior = (await client.query(`SELECT ${fieldColumns} FROM fields WHERE code=$1 FOR UPDATE`, [code])).rows[0];
        if (!prior) throw new Error('字段不存在');
        const next = { ...prior, ...Object.fromEntries(Object.entries(patch).filter(([k]) => ['nameZh','nameEn','nameDe','unit','options','level','templates','required','searchable','skuGen','shopVisible','enabled'].includes(k))) };
        const vals = [next.nameZh,next.nameEn,next.nameDe,next.unit,JSON.stringify(next.options),next.level,JSON.stringify(next.templates),next.required,next.searchable,next.skuGen,next.shopVisible,next.enabled,code];
        const result = await client.query(`UPDATE fields SET name_zh=$1,name_en=$2,name_de=$3,unit=$4,options=$5,level=$6,templates=$7,required=$8,searchable=$9,sku_gen=$10,shop_visible=$11,enabled=$12 WHERE code=$13 RETURNING ${fieldColumns}`, vals);
        return { before: prior, after: result.rows[0] };
      });
    },
    async createColor(c) {
      return transaction('color.create', `colors/${c.code}`, async client => {
        const result = await client.query(`INSERT INTO colors(code,zh,en,de,hex,sort,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${colorColumns}`, [c.code,c.zh || '',c.en || '',c.de || '',c.hex || '#cccccc',c.sort ?? 50,c.enabled !== false]);
        return { before: null, after: result.rows[0] };
      });
    },
    async updateColor(code, patch) {
      return transaction('color.update', `colors/${code}`, async client => {
        const prior = (await client.query(`SELECT ${colorColumns} FROM colors WHERE code=$1 FOR UPDATE`, [code])).rows[0];
        if (!prior) throw new Error('颜色不存在');
        const next = { ...prior, ...Object.fromEntries(Object.entries(patch).filter(([k]) => ['zh','en','de','hex','sort','enabled'].includes(k))) };
        const result = await client.query(`UPDATE colors SET zh=$1,en=$2,de=$3,hex=$4,sort=$5,enabled=$6 WHERE code=$7 RETURNING ${colorColumns}`, [next.zh,next.en,next.de,next.hex,next.sort,next.enabled,code]);
        return { before: prior, after: result.rows[0] };
      });
    },
    close: () => pool.end(),
  };
}

module.exports = { createDictionaryStore };
