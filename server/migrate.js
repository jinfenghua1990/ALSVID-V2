const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

function migrationFiles(directory) {
  return fs.readdirSync(directory)
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort()
    .map(name => ({ name, version: name.slice(0, 3), file: path.join(directory, name) }));
}

async function migrate() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DIRECT_DATABASE_URL to a direct PostgreSQL connection.');
  if (process.env.ALSVID_CONFIRM_DB_MIGRATIONS !== 'alsvid_v2') {
    throw new Error('Set ALSVID_CONFIRM_DB_MIGRATIONS=alsvid_v2 to run database migrations explicitly.');
  }
  const hostname = new URL(connectionString).hostname;
  if (hostname.includes('-pooler')) throw new Error('Use a direct PostgreSQL connection, not a pooler URL.');

  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  const directory = path.join(__dirname, 'migrations');
  let locked = false;
  try {
    await client.connect();
    const target = await client.query("SELECT to_regclass('alsvid_v2.products') AS products");
    if (!target.rows[0].products) throw new Error('The alsvid_v2.products table does not exist; refusing to initialize an empty database.');
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['alsvid_v2:db:migrations']);
    locked = true;
    await client.query("CREATE TABLE IF NOT EXISTS alsvid_v2.schema_migrations (version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");

    for (const migration of migrationFiles(directory)) {
      const sql = fs.readFileSync(migration.file, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('SELECT checksum FROM alsvid_v2.schema_migrations WHERE version = $1', [migration.version]);
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration ${migration.name} has changed; refusing to continue.`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO alsvid_v2.schema_migrations(version, name, checksum) VALUES($1, $2, $3)', [migration.version, migration.name, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      console.log(`Applied ${migration.name}`);
    }
    console.log('ALSVID V2 database migrations are up to date.');
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['alsvid_v2:db:migrations']).catch(() => {});
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('Database migrations failed; no connection values were logged.');
    if (error.code) console.error(`PostgreSQL error code: ${error.code}`);
    else console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrate };
