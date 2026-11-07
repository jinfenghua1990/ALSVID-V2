CREATE TABLE alsvid_v2.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT alsvid_v2.uuidv7(),
  sku_uuid uuid NOT NULL REFERENCES alsvid_v2.skus(entity_uuid),
  warehouse_uuid uuid NOT NULL REFERENCES alsvid_v2.warehouses(entity_uuid),
  quantity integer NOT NULL CHECK (quantity > 0),
  source_type text NOT NULL CHECK (source_type IN ('sales_order','production_order','repair','manual')),
  source_id text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','released')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by text,
  released_at timestamptz,
  release_note text NOT NULL DEFAULT '',
  CHECK ((status = 'reserved' AND released_by IS NULL AND released_at IS NULL) OR
         (status = 'released' AND released_by IS NOT NULL AND released_at IS NOT NULL))
);

CREATE UNIQUE INDEX inventory_reservations_active_source_uq
  ON alsvid_v2.inventory_reservations(source_type, source_id, sku_uuid, warehouse_uuid)
  WHERE status = 'reserved';

CREATE INDEX inventory_reservations_stock_idx
  ON alsvid_v2.inventory_reservations(sku_uuid, warehouse_uuid, status);

CREATE OR REPLACE VIEW alsvid_v2.inventory_available_balances AS
WITH reserved AS (
  SELECT sku_uuid, warehouse_uuid, sum(quantity)::bigint AS reserved_quantity
  FROM alsvid_v2.inventory_reservations
  WHERE status = 'reserved'
  GROUP BY sku_uuid, warehouse_uuid
)
SELECT b.sku_uuid,
       b.warehouse_uuid,
       b.quantity AS on_hand_quantity,
       COALESCE(r.reserved_quantity, 0) AS reserved_quantity,
       b.quantity - COALESCE(r.reserved_quantity, 0) AS available_quantity
FROM alsvid_v2.inventory_balances b
LEFT JOIN reserved r USING (sku_uuid, warehouse_uuid)
WHERE b.inventory_status = 'available';

CREATE OR REPLACE FUNCTION alsvid_v2.protect_inventory_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory reservation history is retained';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sku_uuid IS DISTINCT FROM OLD.sku_uuid
     OR NEW.warehouse_uuid IS DISTINCT FROM OLD.warehouse_uuid
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.status <> 'reserved'
     OR NEW.status <> 'released' THEN
    RAISE EXCEPTION 'only an active inventory reservation can be released';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_reservations_immutable_trg
BEFORE UPDATE OR DELETE ON alsvid_v2.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION alsvid_v2.protect_inventory_reservation();
