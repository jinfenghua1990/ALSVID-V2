const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

async function run(){
  assert.ok(process.env.TEST_DATABASE_URL,'TEST_DATABASE_URL must be an isolated database');
  const port=Number(process.env.TEST_API_PORT||18089);
  const child=spawn(process.execPath,['index.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,PORT:String(port),OBJECT_STORAGE_ENDPOINT:'https://example.r2.cloudflarestorage.com',OBJECT_STORAGE_BUCKET:'alsvid-smoke',OBJECT_STORAGE_ACCESS_KEY:'test-access',OBJECT_STORAGE_SECRET_KEY:'test-secret'},stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${port}`;
  async function request(path,method='GET',body){const r=await fetch(base+path,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
  try{
    let health;
    for(let i=0;i<60;i++){try{health=await request('/api/health');if(health.status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.equal(health?.status,200);
    assert.equal((await request('/api/products')).data.length,0);
    assert.ok((await request('/api/fields')).data.length>0);
    assert.ok((await request('/api/colors')).data.length>0);
    const product=await request('/api/products','POST',{kind:'vehicle',name:'Smoke vehicle',model:'SMK',productType:'FEB'});
    assert.equal(product.status,201);
    const sku=await request(`/api/products/${product.data.id}/skus`,'POST',[{spec:'450',color:'BLK'}]);
    assert.equal(sku.status,200);assert.equal(sku.data.added[0].sku,'SMK-FEB-450-BLK');
    const part=await request('/api/products','POST',{kind:'part',name:'Smoke part',productType:'BAT',ownership:'UN'});
    assert.equal(part.status,201);
    const partSku=await request(`/api/products/${part.data.id}/skus`,'POST',[{spec:'450',color:'STD'}]);
    assert.equal(partSku.data.added[0].sku,'UN-BAT-450-STD');
    const currentPart=(await request(`/api/products/${part.data.id}`)).data;
    const fit=await request(`/api/products/${part.data.id}`,'PUT',{version:currentPart.version,fitments:[{vehicleModel:'SMK',note:'smoke fit'}]});
    assert.equal(fit.status,200);assert.equal(fit.data.fitments[0].vehicleModel,'SMK');
    const media=await request(`/api/products/${part.data.id}/media/missing`);
    assert.equal(media.status,404);
    const bom=await request(`/api/products/${product.data.id}/bom`,'PUT',{version:'V1',items:[{sku:'UN-BAT-450-STD',qty:1}]});
    assert.equal(bom.status,200);assert.equal(bom.data.items.length,1);
    const vin=await request('/api/vins','POST',{vin:'ABCDEFGH12345678',sku:'SMK-FEB-450-BLK'});
    assert.equal(vin.status,201);
    const installed=await request(`/api/vins/${vin.data.id}/installed`,'PUT',{items:[{sku:'UN-BAT-450-STD',qty:1,serial:'SMOKE-1'}]});
    assert.equal(installed.status,200);
    const repair=await request('/api/repairs','POST',{vin:'ABCDEFGH12345678',fault:'Smoke fault',sku:'UN-BAT-450-STD',qty:1});
    assert.equal(repair.status,201);
    const sub=await request('/api/substitutes','POST',{originalSku:'UN-BAT-450-STD',replacementSku:'UN-BAT-450-STD',reason:'invalid'});
    assert.equal(sub.status,400);
    await request(`/api/products/${part.data.id}/skus`,'POST',[{spec:'500',color:'STD'}]);
    const subCreated=await request('/api/substitutes','POST',{originalSku:'UN-BAT-450-STD',replacementSku:'UN-BAT-500-STD',reason:'verified'});
    assert.equal(subCreated.status,201);assert.equal((await request('/api/substitutes')).data.length,1);
    assert.equal((await request(`/api/vins/${vin.data.id}/trace`)).data.repairs.length,1);
    assert.equal((await request('/api/search?q=Smoke')).data.length,2);
    const summary=await request('/api/summary');assert.equal(summary.data.vehicles,1);assert.equal(summary.data.repairs,1);
    assert.equal((await request('/api/audit')).status,200);
    console.log('PostgreSQL API smoke passed: dictionaries, products, SKUs, BOM versions, fitment, missing media, VIN, installed parts, repair, substitutes, search, summary, audit.');
  }finally{child.kill();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
