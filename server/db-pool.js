// 统一的连接池工厂。
// 目的：把 search_path 在"连接交出去之前"设置完，避免 SET 与第一条业务查询并发执行
// （旧写法 pool.on('connect', c => c.query(...)) 发起即返回，pg 会警告
//  "Calling client.query() when the client is already executing a query"，pg 9 将直接报错）。
// 说明：云库（Neon 连接池）拒绝连接串级 options=-c search_path=...，所以只能在会话内 SET。
// 探测结论：该连接池对同一物理连接保持会话状态，SET 一次即可长期生效。
const { Pool } = require('pg');

const SCHEMA = 'alsvid_v2';
const prepared = new WeakSet();

function createPool(connectionString, options = {}) {
  const pool = new Pool({ connectionString, ...options });
  const rawConnect = pool.connect.bind(pool);
  const rawQuery = pool.query.bind(pool);

  // 每次交出连接前确保 search_path 已生效（同一物理连接只 SET 一次）
  pool.connect = async function connectWithSchema() {
    const client = await rawConnect();
    if (prepared.has(client)) return client;
    try {
      await client.query('SET search_path TO ' + SCHEMA);
      prepared.add(client);
      return client;
    } catch (error) {
      client.release(error); // 带错误释放：连接不会被放回池中复用
      throw error;
    }
  };

  // 单条查询也必须走上面的 connect()，否则会绕过 search_path
  pool.query = function queryWithSchema(...args) {
    if (typeof args[args.length - 1] === 'function') return rawQuery(...args); // 回调式调用保持原样（当前无使用者）
    return (async () => {
      const client = await pool.connect();
      try {
        return await client.query(...args);
      } finally {
        client.release();
      }
    })();
  };

  return pool;
}

module.exports = { createPool, SCHEMA };
