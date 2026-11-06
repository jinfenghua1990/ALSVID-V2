// Read-only connectivity and schema check. Does not create, change, or delete data.
const { Client } = require('pg');

async function checkPostgres(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL search_path TO alsvid_v2');
    const result = await client.query(`
      SELECT current_database() AS database_name,
             current_schema() AS schema_name,
             to_regclass('products') IS NOT NULL AS products_present,
             to_regclass('vins') IS NOT NULL AS vins_present,
             to_regclass('repairs') IS NOT NULL AS repairs_present
    `);
    await client.query('ROLLBACK');
    return result.rows[0];
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  checkPostgres().then(result => console.log(JSON.stringify({ ok: true, ...result }))).catch(() => {
    console.error('PostgreSQL check failed; check configuration and connectivity.');
    process.exitCode = 1;
  });
}

module.exports = { checkPostgres };
