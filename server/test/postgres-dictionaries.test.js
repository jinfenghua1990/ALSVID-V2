const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createDictionaryStore } = require('../postgres-dictionaries');

test('dictionary writes persist with an atomic audit trail', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL must point to an isolated empty test database');
  const db = createDictionaryStore(url);
  const pool = new Pool({ connectionString: url, options: '-c search_path=alsvid_v2' });
  try {
    await db.createField({ code: 'test_material', nameZh: '材质', skuGen: true });
    await db.updateField('test_material', { unit: 'kg', code: 'must_not_change' });
    await db.createColor({ code: 'TST', zh: '测试色', sort: 0 });
    await db.updateColor('TST', { zh: '新测试色', code: 'BAD' });
    const fields = await db.listFields();
    const colors = await db.listColors();
    assert.equal(fields[0].code, 'test_material');
    assert.equal(fields[0].unit, 'kg');
    assert.equal(fields[0].skuGen, true);
    assert.equal(colors[0].code, 'TST');
    assert.equal(colors[0].sort, 0);
    assert.equal(colors[0].zh, '新测试色');
    await assert.rejects(db.createColor({ code: 'TST' }));
    const audit = await pool.query("SELECT action, before_json, after_json FROM audit_log WHERE target IN ('fields/test_material','colors/TST') ORDER BY id");
    assert.equal(audit.rowCount, 4);
    assert.equal(audit.rows[3].before_json.zh, '测试色');
    assert.equal(audit.rows[3].after_json.zh, '新测试色');
  } finally {
    await db.close();
    await pool.end();
  }
});
