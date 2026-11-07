const { createPool } = require('./db-pool');
const { currentActor } = require('./audit-context');

function createInventoryReservations(connectionString) {
  const pool = createPool(connectionString, { max: 3, connectionTimeoutMillis: 10000 });

  async function transaction(action, target, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { before, after } = await work(client);
      await client.query(
        'INSERT INTO audit_log(actor,action,target,before_json,after_json) VALUES($1,$2,$3,$4,$5)',
        [currentActor(), action, target, before ? JSON.stringify(before) : null, JSON.stringify(after)]
      );
      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async list(status = '') {
      if (status && !['reserved','released'].includes(status)) throw new Error('预占状态无效');
      return (await pool.query(
        `SELECT r.id, s.code AS sku, w.id AS "warehouseId", w.name AS warehouse,
                r.quantity, r.source_type AS "sourceType", r.source_id AS "sourceId",
                r.status, r.created_by AS "createdBy", r.created_at AS "createdAt",
                r.released_by AS "releasedBy", r.released_at AS "releasedAt",
                r.release_note AS "releaseNote"
         FROM inventory_reservations r
         JOIN skus s ON s.entity_uuid = r.sku_uuid
         JOIN warehouses w ON w.entity_uuid = r.warehouse_uuid
         WHERE $1 = '' OR r.status = $1
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 500`,
        [status]
      )).rows;
    },

    async reserve(input) {
      const sku = String(input.sku || '').trim();
      const warehouseId = String(input.warehouseId || '').trim();
      const sourceType = String(input.sourceType || '');
      const sourceId = String(input.sourceId || '').trim();
      const quantity = Number(input.quantity);
      if (!sku || !warehouseId || !sourceId || sourceId.length > 120 ||
          !['sales_order','production_order','repair','manual'].includes(sourceType) ||
          !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000000) {
        throw new Error('库存预占信息无效');
      }

      return transaction('inventory.reserve', 'inventory_reservations', async client => {
        const item = (await client.query(
          `SELECT s.code, s.entity_uuid AS "skuUuid",
                  w.id AS "warehouseId", w.entity_uuid AS "warehouseUuid"
           FROM skus s
           JOIN products p ON p.id = s.product_id
           JOIN warehouses w ON w.id = $2
           WHERE s.code = $1 AND p.kind = 'part' AND w.status = '启用'`,
          [sku, warehouseId]
        )).rows[0];
        if (!item) throw new Error('配件 SKU 或启用仓库不存在');

        const lockKey = item.skuUuid + ':' + item.warehouseUuid;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

        const prior = (await client.query(
          `SELECT id, quantity, source_type AS "sourceType", source_id AS "sourceId",
                  status, created_at AS "createdAt"
           FROM inventory_reservations
           WHERE sku_uuid = $1 AND warehouse_uuid = $2
             AND source_type = $3 AND source_id = $4 AND status = 'reserved'
           FOR UPDATE`,
          [item.skuUuid, item.warehouseUuid, sourceType, sourceId]
        )).rows[0];
        if (prior) {
          if (Number(prior.quantity) !== quantity) throw new Error('该业务单已有不同数量的活动预占');
          return { before: prior, after: prior };
        }

        const stock = (await client.query(
          'SELECT quantity FROM warehouse_stock WHERE warehouse_id = $1 AND sku_code = $2 FOR UPDATE',
          [item.warehouseId, item.code]
        )).rows[0];
        const warehouseQuantity = Number(stock?.quantity || 0);
        const ledgerQuantity = Number((await client.query(
          `SELECT COALESCE(sum(quantity_delta), 0)::bigint AS quantity
           FROM inventory_ledger
           WHERE sku_uuid = $1 AND warehouse_uuid = $2 AND inventory_status = 'available'`,
          [item.skuUuid, item.warehouseUuid]
        )).rows[0].quantity);
        if (ledgerQuantity !== warehouseQuantity) {
          throw new Error('库存账本与仓库余额不一致，已暂停预占');
        }

        const reservedQuantity = Number((await client.query(
          `SELECT COALESCE(sum(quantity), 0)::bigint AS quantity
           FROM inventory_reservations
           WHERE sku_uuid = $1 AND warehouse_uuid = $2 AND status = 'reserved'`,
          [item.skuUuid, item.warehouseUuid]
        )).rows[0].quantity);
        if (ledgerQuantity - reservedQuantity < quantity) throw new Error('可用库存不足');

        const row = (await client.query(
          `INSERT INTO inventory_reservations
             (sku_uuid, warehouse_uuid, quantity, source_type, source_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, quantity, source_type AS "sourceType", source_id AS "sourceId",
                     status, created_by AS "createdBy", created_at AS "createdAt"`,
          [item.skuUuid, item.warehouseUuid, quantity, sourceType, sourceId, currentActor()]
        )).rows[0];
        return { before: null, after: row };
      });
    },

    async release(id, input = {}) {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error('预占编号无效');
      const note = String(input.note || '').trim();
      if (note.length > 500) throw new Error('释放说明不能超过 500 个字符');
      return transaction('inventory.reservation.release', `inventory_reservations/${id}`, async client => {
        const prior = (await client.query(
          'SELECT id, quantity, status, source_type AS "sourceType", source_id AS "sourceId" FROM inventory_reservations WHERE id = $1 FOR UPDATE',
          [id]
        )).rows[0];
        if (!prior) throw new Error('库存预占不存在');
        if (prior.status === 'released') return { before: prior, after: prior };
        if (prior.status !== 'reserved') throw new Error('只有活动预占可以释放');
        const row = (await client.query(
          `UPDATE inventory_reservations
           SET status = 'released', released_by = $1, released_at = now(), release_note = $2
           WHERE id = $3
           RETURNING id, quantity, source_type AS "sourceType", source_id AS "sourceId",
                     status, released_by AS "releasedBy", released_at AS "releasedAt",
                     release_note AS "releaseNote"`,
          [currentActor(), note, id]
        )).rows[0];
        return { before: prior, after: row };
      });
    },

    close: () => pool.end(),
  };
}

module.exports = { createInventoryReservations };
