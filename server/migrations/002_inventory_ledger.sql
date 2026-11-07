CREATE TABLE alsvid_v2.inventory_ledger (
  id uuid PRIMARY KEY DEFAULT alsvid_v2.uuidv7(),
  sku_uuid uuid NOT NULL REFERENCES alsvid_v2.skus(entity_uuid),
  warehouse_uuid uuid NOT NULL REFERENCES alsvid_v2.warehouses(entity_uuid),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  inventory_status text NOT NULL DEFAULT 'available'
    CHECK (inventory_status IN ('available','quality_hold','damaged','in_transit','frozen')),
  posting_type text NOT NULL
    CHECK (posting_type IN ('opening_balance','receipt','transfer_in','transfer_out','repair_issue','repair_return')),
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_uuid uuid,
  note text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, sku_uuid, warehouse_uuid)
);

CREATE INDEX inventory_ledger_balance_idx
  ON alsvid_v2.inventory_ledger(sku_uuid, warehouse_uuid, inventory_status, created_at);

INSERT INTO alsvid_v2.inventory_ledger
  (sku_uuid, warehouse_uuid, quantity_delta, posting_type, source_type, source_id, source_uuid, note, actor, created_at)
SELECT sm.sku_uuid, sm.to_warehouse_uuid, sm.quantity,
       CASE WHEN sm.kind = '入库' THEN 'receipt' ELSE 'transfer_in' END,
       'stock_movement', sm.id, sm.entity_uuid, sm.note, sm.actor, sm.created_at
FROM alsvid_v2.stock_movements sm
ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;

INSERT INTO alsvid_v2.inventory_ledger
  (sku_uuid, warehouse_uuid, quantity_delta, posting_type, source_type, source_id, source_uuid, note, actor, created_at)
SELECT sm.sku_uuid, sm.from_warehouse_uuid, -sm.quantity, 'transfer_out',
       'stock_movement', sm.id, sm.entity_uuid, sm.note, sm.actor, sm.created_at
FROM alsvid_v2.stock_movements sm
WHERE sm.kind = '调拨'
  AND sm.from_warehouse_uuid IS NOT NULL
  AND sm.from_warehouse_uuid <> sm.to_warehouse_uuid
ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;

INSERT INTO alsvid_v2.inventory_ledger
  (sku_uuid, warehouse_uuid, quantity_delta, posting_type, source_type, source_id, source_uuid, note, actor, created_at)
SELECT e.sku_uuid, e.warehouse_uuid,
       CASE WHEN e.kind = '领用' THEN -e.quantity ELSE e.quantity END,
       CASE WHEN e.kind = '领用' THEN 'repair_issue' ELSE 'repair_return' END,
       'repair_stock_event', e.id, e.entity_uuid,
       '维修工单 ' || e.repair_id, e.actor, e.created_at
FROM alsvid_v2.repair_stock_events e
ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;

WITH ledger_totals AS (
  SELECT sku_uuid, warehouse_uuid, inventory_status, sum(quantity_delta)::bigint AS quantity
  FROM alsvid_v2.inventory_ledger
  GROUP BY sku_uuid, warehouse_uuid, inventory_status
),
balance_differences AS (
  SELECT ws.sku_uuid, ws.warehouse_uuid,
         ws.quantity::bigint - COALESCE(lt.quantity, 0) AS difference
  FROM alsvid_v2.warehouse_stock ws
  LEFT JOIN ledger_totals lt
    ON lt.sku_uuid = ws.sku_uuid
   AND lt.warehouse_uuid = ws.warehouse_uuid
   AND lt.inventory_status = 'available'
)
INSERT INTO alsvid_v2.inventory_ledger
  (sku_uuid, warehouse_uuid, quantity_delta, inventory_status, posting_type, source_type, source_id, note)
SELECT bd.sku_uuid, bd.warehouse_uuid, bd.difference::integer, 'available', 'opening_balance',
       'opening_balance', bd.warehouse_uuid::text || ':' || bd.sku_uuid::text,
       'Opening balance reconciled to warehouse_stock during UUID v7 migration'
FROM balance_differences bd
WHERE bd.difference <> 0
ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;

CREATE OR REPLACE VIEW alsvid_v2.inventory_balances AS
SELECT sku_uuid, warehouse_uuid, inventory_status, sum(quantity_delta)::bigint AS quantity
FROM alsvid_v2.inventory_ledger
GROUP BY sku_uuid, warehouse_uuid, inventory_status
HAVING sum(quantity_delta) <> 0;

CREATE OR REPLACE FUNCTION alsvid_v2.append_stock_movement_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO alsvid_v2.inventory_ledger
    (sku_uuid, warehouse_uuid, quantity_delta, posting_type, source_type, source_id, source_uuid, note, actor, created_at)
  VALUES
    (NEW.sku_uuid, NEW.to_warehouse_uuid, NEW.quantity,
     CASE WHEN NEW.kind = '入库' THEN 'receipt' ELSE 'transfer_in' END,
     'stock_movement', NEW.id, NEW.entity_uuid, NEW.note, NEW.actor, NEW.created_at)
  ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;

  IF NEW.kind = '调拨'
     AND NEW.from_warehouse_uuid IS NOT NULL
     AND NEW.from_warehouse_uuid <> NEW.to_warehouse_uuid THEN
    INSERT INTO alsvid_v2.inventory_ledger
      (sku_uuid, warehouse_uuid, quantity_delta, posting_type, source_type, source_id, source_uuid, note, actor, created_at)
    VALUES
      (NEW.sku_uuid, NEW.from_warehouse_uuid, -NEW.quantity, 'transfer_out',
       'stock_movement', NEW.id, NEW.entity_uuid, NEW.note, NEW.actor, NEW.created_at)
    ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alsvid_v2.append_repair_stock_event_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO alsvid_v2.inventory_ledger
    (sku_uuid, warehouse_uuid, quantity_delta, posting_type, source_type, source_id, source_uuid, note, actor, created_at)
  VALUES
    (NEW.sku_uuid, NEW.warehouse_uuid,
     CASE WHEN NEW.kind = '领用' THEN -NEW.quantity ELSE NEW.quantity END,
     CASE WHEN NEW.kind = '领用' THEN 'repair_issue' ELSE 'repair_return' END,
     'repair_stock_event', NEW.id, NEW.entity_uuid,
     '维修工单 ' || NEW.repair_id, NEW.actor, NEW.created_at)
  ON CONFLICT (source_type, source_id, sku_uuid, warehouse_uuid) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_movements_inventory_ledger_trg
AFTER INSERT ON alsvid_v2.stock_movements
FOR EACH ROW EXECUTE FUNCTION alsvid_v2.append_stock_movement_ledger();

CREATE TRIGGER repair_stock_events_inventory_ledger_trg
AFTER INSERT ON alsvid_v2.repair_stock_events
FOR EACH ROW EXECUTE FUNCTION alsvid_v2.append_repair_stock_event_ledger();

CREATE OR REPLACE FUNCTION alsvid_v2.reject_inventory_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% history rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER inventory_ledger_immutable_trg
BEFORE UPDATE OR DELETE ON alsvid_v2.inventory_ledger
FOR EACH ROW EXECUTE FUNCTION alsvid_v2.reject_inventory_history_mutation();

CREATE TRIGGER inventory_ledger_no_truncate_trg
BEFORE TRUNCATE ON alsvid_v2.inventory_ledger
FOR EACH STATEMENT EXECUTE FUNCTION alsvid_v2.reject_inventory_history_mutation();

CREATE TRIGGER stock_movements_immutable_trg
BEFORE UPDATE OR DELETE ON alsvid_v2.stock_movements
FOR EACH ROW EXECUTE FUNCTION alsvid_v2.reject_inventory_history_mutation();

CREATE TRIGGER repair_stock_events_immutable_trg
BEFORE UPDATE OR DELETE ON alsvid_v2.repair_stock_events
FOR EACH ROW EXECUTE FUNCTION alsvid_v2.reject_inventory_history_mutation();
