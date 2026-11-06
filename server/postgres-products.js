const { currentActor } = require('./audit-context');
// PostgreSQL resource operations. No connection is opened until configured.
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

function createProductStore(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000 });
  pool.on('connect', client => client.query('SET search_path TO alsvid_v2'));
  const projection = `id,kind,name,model,product_type AS "productType",status,ownership,uses,specs,version`;
  async function withAudit(action, target, fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { before, after } = await fn(client);
      await client.query('INSERT INTO audit_log(actor,action,target,before_json,after_json) VALUES($1,$2,$3,$4,$5)', [currentActor(),action,target,before == null ? null : JSON.stringify(before),after == null ? null : JSON.stringify(after)]);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function hydrate(client, product) {
    if (!product) return null;
    const skus = await client.query('SELECT code AS sku,spec,color_code AS color,price,note FROM skus WHERE product_id=$1 ORDER BY code', [product.id]);
    const fits = await client.query('SELECT v.model AS "vehicleModel",f.note FROM fits f JOIN products v ON v.id=f.vehicle_product_id WHERE f.part_product_id=$1 ORDER BY v.model', [product.id]);
    const items = await client.query('SELECT id,parent_item_id AS "parentItemId",drawing_media_id AS "drawingMediaId",drawing_x AS "drawingX",drawing_y AS "drawingY",section,drawing_no AS "drawingNo",sku_code AS sku,quantity AS qty,unit,position FROM bom_version_items WHERE bom_version_id=(SELECT id FROM bom_versions WHERE vehicle_id=$1 AND version=$2) ORDER BY id', [product.id,product.bomVersion || '']);
    const media = await client.query('SELECT id,object_key AS key,content_type AS "contentType",label,created_at AS "createdAt" FROM product_media WHERE product_id=$1 ORDER BY created_at DESC', [product.id]);
    return { ...product,skus:skus.rows,fitments:fits.rows,bom:product.kind === 'vehicle' ? {version: product.bomVersion || '',items:items.rows} : undefined,images:media.rows,skuCount:skus.rowCount,colorCount:new Set(skus.rows.map(s => s.color)).size };
  }
  return {
    async list(kind) {
      const client=await pool.connect();
      try { const r=await client.query(`SELECT ${projection},bom_version AS "bomVersion" FROM products WHERE ($1::text IS NULL OR kind=$1) ORDER BY name,id`,[kind || null]); return await Promise.all(r.rows.map(row=>hydrate(client,row))); }
      finally { client.release(); }
    },
    async get(id) { const c=await pool.connect(); try { const r=await c.query(`SELECT ${projection},bom_version AS "bomVersion" FROM products WHERE id=$1`,[id]); return await hydrate(c,r.rows[0]); } finally { c.release(); } },
    async create(input) {
      const id = input.id || `p-${randomUUID()}`;
      if (!['vehicle','part'].includes(input.kind) || !input.name || !input.productType || !input.ownership) throw new Error('产品类型、名称、品类与归属必填');
      return withAudit('product.create',`products/${id}`,async c=>{ const r=await c.query(`INSERT INTO products(id,kind,name,model,product_type,status,ownership,uses,specs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${projection},bom_version AS "bomVersion"`,[id,input.kind,input.name,input.model || '',input.productType,input.status || '启用',input.ownership,JSON.stringify(input.uses || []),JSON.stringify(input.specs || {})]); return {before:null,after:await hydrate(c,r.rows[0])}; });
    },
    async update(id,input) {
      if (!Number.isInteger(input.version)) throw new Error('必须提供产品版本');
      return withAudit('product.update',`products/${id}`,async c=>{
        const old=(await c.query(`SELECT ${projection},bom_version AS "bomVersion" FROM products WHERE id=$1 FOR UPDATE`,[id])).rows[0];
        if (!old) throw new Error('产品不存在');
        if (old.version !== input.version) { const e=new Error('数据已被其他操作更新'); e.code='VERSION_CONFLICT'; throw e; }
        const before=await hydrate(c,old);
        if (before.skus.length && ((input.ownership && input.ownership!==old.ownership) || (input.productType && input.productType!==old.productType))) throw new Error('已存在 SKU 的产品不能修改归属或品类');
        const next={...old,...Object.fromEntries(Object.entries(input).filter(([k])=>['name','model','productType','status','ownership','uses','specs'].includes(k)))};
        const r=await c.query(`UPDATE products SET name=$1,model=$2,product_type=$3,status=$4,ownership=$5,uses=$6,specs=$7,version=version+1,updated_at=now() WHERE id=$8 RETURNING ${projection},bom_version AS "bomVersion"`,[next.name,next.model,next.productType,next.status,next.ownership,JSON.stringify(next.uses),JSON.stringify(next.specs),id]);
        if (Array.isArray(input.fitments)) {
          await c.query('DELETE FROM fits WHERE part_product_id=$1',[id]);
          for (const fit of input.fitments) {
            const fr=await c.query("INSERT INTO fits(part_product_id,vehicle_product_id,note) SELECT $1,id,$3 FROM products WHERE kind='vehicle' AND model=$2 RETURNING vehicle_product_id",[id,fit.vehicleModel,fit.note||'']);
            if (!fr.rowCount) throw new Error(`车型不存在：${fit.vehicleModel}`);
          }
        }
        return {before,after:await hydrate(c,r.rows[0])};
      });
    },
    async addSku(id,entry) {
      return withAudit('sku.create',`products/${id}/skus`,async c=>{
        const p=(await c.query(`SELECT ${projection},bom_version AS "bomVersion" FROM products WHERE id=$1 FOR UPDATE`,[id])).rows[0];
        if (!p) throw new Error('产品不存在');
        if (!/^[A-Z0-9]{1,8}$/.test(entry.spec || '') || !/^[A-Z0-9]{3}$/.test(entry.color || '')) throw new Error('规格或颜色编码无效');
        const code=`${p.ownership}-${p.productType}-${entry.spec}-${entry.color}`;
        const r=await c.query('INSERT INTO skus(code,product_id,spec,color_code,price,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING code AS sku,spec,color_code AS color,price,note',[code,id,entry.spec,entry.color,entry.price === '' || entry.price == null ? null : entry.price,entry.note || '']);
        await c.query('UPDATE products SET version=version+1,updated_at=now() WHERE id=$1',[id]);
        return {before:null,after:r.rows[0]};
      });
    },
    async addSkus(id, entries) {
      return withAudit('sku.create',`products/${id}/skus`,async c=>{
        const p=(await c.query(`SELECT ${projection} FROM products WHERE id=$1 FOR UPDATE`,[id])).rows[0];
        if (!p) throw new Error('产品不存在');
        const added=[],skipped=[];
        for (const entry of entries) {
          if (!/^[A-Z0-9]{1,8}$/.test(entry.spec || '') || !/^[A-Z0-9]{3}$/.test(entry.color || '')) { skipped.push({reason:'规格或颜色编码无效'}); continue; }
          const code=`${p.ownership}-${p.productType}-${entry.spec}-${entry.color}`;
          const r=await c.query('INSERT INTO skus(code,product_id,spec,color_code,price,note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING RETURNING code AS sku,spec,color_code AS color,price,note',[code,id,entry.spec,entry.color,entry.price === '' || entry.price == null ? null : entry.price,entry.note || '']);
          if (r.rowCount) added.push(r.rows[0]);
          else skipped.push({sku:code,reason:'编码已存在'});
        }
        if (added.length) await c.query('UPDATE products SET version=version+1,updated_at=now() WHERE id=$1',[id]);
        return {before:null,after:{added,skipped}};
      });
    },
    async deleteSku(id, sku) {
      return withAudit('sku.delete',`products/${id}/skus/${sku}`,async c=>{
        const r=await c.query('DELETE FROM skus s WHERE s.product_id=$1 AND s.code=$2 AND NOT EXISTS(SELECT 1 FROM bom_items b WHERE b.sku_code=s.code) AND NOT EXISTS(SELECT 1 FROM bom_version_items b WHERE b.sku_code=s.code) AND NOT EXISTS(SELECT 1 FROM vins v WHERE v.sku_code=s.code) AND NOT EXISTS(SELECT 1 FROM repairs x WHERE x.replacement_sku=s.code) AND NOT EXISTS(SELECT 1 FROM substitutes x WHERE x.original_sku=s.code OR x.replacement_sku=s.code) RETURNING code AS sku', [id,sku]);
        if (!r.rowCount) throw new Error('SKU 不存在或已被业务资料引用');
        await c.query('UPDATE products SET version=version+1,updated_at=now() WHERE id=$1',[id]);
        return {before:r.rows[0],after:null};
      });
    },
    async addMedia(id,media) { return withAudit('product.media.add',`products/${id}/media`,async c=>{const exists=await c.query('SELECT id FROM products WHERE id=$1',[id]);if(!exists.rowCount)throw new Error('产品不存在');const r=await c.query('INSERT INTO product_media(id,product_id,object_key,content_type,label) VALUES($1,$2,$3,$4,$5) RETURNING id,object_key AS key,content_type AS "contentType",label,created_at AS "createdAt"',[randomUUID(),id,media.key,media.contentType,media.label||'']);return{after:r.rows[0]};});},
    async listBomVersions(id) {
      const vehicle=await pool.query("SELECT id FROM products WHERE id=$1 AND kind='vehicle'",[id]);
      if(!vehicle.rowCount)return null;
      return (await pool.query('SELECT version,status,change_reason AS "changeReason",effective_at AS "effectiveAt",created_at AS "createdAt" FROM bom_versions WHERE vehicle_id=$1 ORDER BY created_at DESC,id DESC',[id])).rows;
    },
    async getBomVersion(id,version) {
      const c=await pool.connect();
      try {
        const h=(await c.query('SELECT id,version,status,change_reason AS "changeReason",effective_at AS "effectiveAt",created_at AS "createdAt" FROM bom_versions WHERE vehicle_id=$1 AND version=$2',[id,version])).rows[0];
        if(!h)return null;
        const items=(await c.query('SELECT id,parent_item_id AS "parentItemId",drawing_media_id AS "drawingMediaId",drawing_x AS "drawingX",drawing_y AS "drawingY",section,drawing_no AS "drawingNo",sku_code AS sku,quantity AS qty,unit,position FROM bom_version_items WHERE bom_version_id=$1 ORDER BY id',[h.id])).rows;
        return {...h,items};
      } finally { c.release(); }
    },
    async saveBom(id,bom) {
      return withAudit('bom.version.create',`products/${id}/bom`,async c=>{
        const vehicle=(await c.query('SELECT id,kind,bom_version AS version FROM products WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if (!vehicle || vehicle.kind!=='vehicle') throw new Error('整车产品不存在');
        const version=String(bom.version || `V${Date.now()}`);
        const header=await c.query('INSERT INTO bom_versions(vehicle_id,version,status,change_reason,effective_at) VALUES($1,$2,$3,$4,$5) RETURNING id,version,status,change_reason AS "changeReason",effective_at AS "effectiveAt"',[id,version,bom.status||'draft',bom.changeReason||'',bom.effectiveAt||null]);
        const pending=(bom.items||[]).map((item,i)=>({item,key:item.id==null?`__row_${i}`:String(item.id),parent:item.parentItemId==null||item.parentItemId===''?null:String(item.parentItemId)}));
        const keys=new Set(pending.map(x=>x.key));
        if(keys.size!==pending.length||pending.some(x=>x.parent&&!keys.has(x.parent)))throw new Error('BOM 物料层级引用无效');
        const ids=new Map();
        while(pending.length){
          const index=pending.findIndex(x=>!x.parent||ids.has(x.parent));
          if(index<0)throw new Error('BOM 物料层级存在循环');
          const {item,key,parent}=pending.splice(index,1)[0];
          const qty=Number(item.qty??1);if(!Number.isFinite(qty)||qty<=0)throw new Error('BOM 物料用量必须大于零');
          const r=await c.query('INSERT INTO bom_version_items(bom_version_id,sku_code,section,drawing_no,quantity,unit,position,parent_item_id) SELECT $1,s.code,$3,$4,$5,$6,$7,$8 FROM skus s JOIN products p ON p.id=s.product_id WHERE s.code=$2 AND p.kind=\'part\' RETURNING id',[header.rows[0].id,item.sku,item.section||'',item.drawingNo||'',qty,item.unit||'件',item.position||'',parent?ids.get(parent):null]);
          if (!r.rowCount) throw new Error(`零配件 SKU 不存在：${item.sku}`);
          if(item.drawingMediaId){const x=Number(item.drawingX),y=Number(item.drawingY);if(item.drawingX==null||item.drawingY==null||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)throw Error('BOM 图纸标记坐标无效');const image=await c.query('SELECT 1 FROM product_media WHERE id=$1 AND product_id=$2',[item.drawingMediaId,id]);if(!image.rowCount)throw Error('BOM 图纸不属于该整车');await c.query('UPDATE bom_version_items SET drawing_media_id=$1,drawing_x=$2,drawing_y=$3 WHERE id=$4',[item.drawingMediaId,x,y,r.rows[0].id]);}
          ids.set(key,r.rows[0].id);
        }
        await c.query('UPDATE products SET bom_version=$1,version=version+1,updated_at=now() WHERE id=$2',[version,id]);
        const items=await c.query('SELECT id,parent_item_id AS "parentItemId",drawing_media_id AS "drawingMediaId",drawing_x AS "drawingX",drawing_y AS "drawingY",section,drawing_no AS "drawingNo",sku_code AS sku,quantity AS qty,unit,position FROM bom_version_items WHERE bom_version_id=$1 ORDER BY id',[header.rows[0].id]);
        return {before:{version:vehicle.version},after:{...header.rows[0],items:items.rows}};
      });
    },
    async setFitments(partId,fitments) {
      return withAudit('fitments.update',`products/${partId}/fitments`,async c=>{
        const part=(await c.query("SELECT id FROM products WHERE id=$1 AND kind='part' FOR UPDATE",[partId])).rows[0];
        if (!part) throw new Error('零配件不存在');
        const before=(await c.query('SELECT v.model AS "vehicleModel",f.note FROM fits f JOIN products v ON v.id=f.vehicle_product_id WHERE f.part_product_id=$1 ORDER BY v.model',[partId])).rows;
        await c.query('DELETE FROM fits WHERE part_product_id=$1',[partId]);
        for (const f of fitments) {
          const r=await c.query("INSERT INTO fits(part_product_id,vehicle_product_id,note) SELECT $1,id,$3 FROM products WHERE kind='vehicle' AND model=$2 RETURNING vehicle_product_id",[partId,f.vehicleModel,f.note||'']);
          if (!r.rowCount) throw new Error(`车型不存在：${f.vehicleModel}`);
        }
        return {before,after:fitments};
      });
    },
    close:()=>pool.end(),
  };
}
module.exports={createProductStore};
