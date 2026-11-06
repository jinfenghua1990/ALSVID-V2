const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createServiceStore } = require('../postgres-service');

test('VIN trace, installed components, repairs, and substitutes persist', async () => {
  const url=process.env.TEST_DATABASE_URL;
  assert.ok(url,'TEST_DATABASE_URL must target an isolated database');
  const pool=new Pool({connectionString:url,options:'-c search_path=alsvid_v2'});const service=createServiceStore(url);
  try {
    await pool.query("INSERT INTO colors(code,zh,hex) VALUES('ZZZ','Test','#000000')");
    await pool.query("INSERT INTO products(id,kind,name,product_type,ownership) VALUES('vehicle-1','vehicle','Test vehicle','FEB','A1'),('part-1','part','Test part','BAT','A1')");
    await pool.query("INSERT INTO skus(code,product_id,spec,color_code) VALUES('A1-FEB-450-ZZZ','vehicle-1','450','ZZZ'),('A1-BAT-450-ZZZ','part-1','450','ZZZ')");
    const vin=await service.createVin({vin:'ABCDEFGH12345678',sku:'A1-FEB-450-ZZZ'});
    await service.replaceInstalled(vin.id,[{sku:'A1-BAT-450-ZZZ',qty:1,serial:'SERIAL-1'}]);
    const repair=await service.createRepair({vin:vin.vin,fault:'Test fault',sku:'A1-BAT-450-ZZZ',qty:1});
    const trace=await service.getVinTrace(vin.id);
    assert.equal(trace.installed[0].serial,'SERIAL-1');assert.equal(trace.repairs[0].id,repair.id);
    await assert.rejects(service.replaceInstalled(vin.id,[{sku:'A1-BAT-450-ZZZ',deviationReason:'substitute'}]));
    await service.createSub({originalSku:'A1-BAT-450-ZZZ',replacementSku:'A1-FEB-450-ZZZ',reason:'verified'});
    assert.equal((await service.listSubs()).length,1);
    const audit=await pool.query("SELECT action FROM audit_log WHERE action LIKE 'vin.%' OR action LIKE 'repair.%' OR action LIKE 'substitute.%' ORDER BY id");
    assert.equal(audit.rowCount,4);
  } finally {await service.close();await pool.end();}
});
