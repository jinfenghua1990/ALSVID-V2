CREATE OR REPLACE FUNCTION alsvid_v2.uuidv7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  timestamp_hex text;
  random_hex text;
  variant_value integer;
  uuid_hex text;
BEGIN
  timestamp_hex := lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0');
  random_hex := md5(random()::text || clock_timestamp()::text || txid_current()::text || pg_backend_pid()::text);
  variant_value := get_byte(decode(substr(random_hex, 4, 2), 'hex'), 0) & 3;
  uuid_hex := substr(timestamp_hex, 1, 8) || '-' ||
    substr(timestamp_hex, 9, 4) || '-7' ||
    substr(random_hex, 1, 3) || '-' ||
    to_hex(8 + variant_value) || substr(random_hex, 5, 3) || '-' ||
    substr(random_hex, 8, 12);
  RETURN uuid_hex::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION alsvid_v2.assign_entity_uuid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entity_uuid IS NULL THEN
      NEW.entity_uuid := alsvid_v2.uuidv7();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.entity_uuid IS DISTINCT FROM OLD.entity_uuid THEN
    RAISE EXCEPTION 'entity_uuid is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
  link record;
  has_orphans boolean;
  entity_tables text[] := ARRAY[
    'products',
    'skus',
    'product_media',
    'bom_items',
    'vins',
    'repairs',
    'substitutes',
    'audit_log',
    'bom_versions',
    'bom_version_items',
    'vin_installed',
    'catalog_publications',
    'app_users',
    'portal_account_reviews',
    'portal_vehicle_requests',
    'portal_vehicle_access',
    'portal_service_requests',
    'production_orders',
    'warehouses',
    'stock_movements',
    'repair_stock_events',
    'repair_replacements',
    'old_part_recoveries',
    'old_part_recovery_events',
    'old_part_restock_requests',
    'factories',
    'production_deliveries',
    'production_order_events',
    'production_order_materials',
    'production_order_attachments',
    'production_delivery_receipts'
  ];
BEGIN
  FOREACH table_name IN ARRAY entity_tables LOOP
    IF to_regclass(format('alsvid_v2.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required ALSVID V2 table is missing: %', table_name;
    END IF;

    EXECUTE format('ALTER TABLE alsvid_v2.%I ADD COLUMN IF NOT EXISTS entity_uuid uuid', table_name);
    EXECUTE format('ALTER TABLE alsvid_v2.%I ALTER COLUMN entity_uuid SET DEFAULT alsvid_v2.uuidv7()', table_name);
    EXECUTE format('UPDATE alsvid_v2.%I SET entity_uuid = alsvid_v2.uuidv7() WHERE entity_uuid IS NULL', table_name);
    EXECUTE format('ALTER TABLE alsvid_v2.%I ALTER COLUMN entity_uuid SET NOT NULL', table_name);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON alsvid_v2.%I(entity_uuid)',
      table_name || '_entity_uuid_uq',
      table_name
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON alsvid_v2.%I', table_name || '_entity_uuid_trg', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON alsvid_v2.%I FOR EACH ROW EXECUTE FUNCTION alsvid_v2.assign_entity_uuid()',
      table_name || '_entity_uuid_trg',
      table_name
    );
  END LOOP;

  FOR link IN
    SELECT * FROM (VALUES
      ('skus','product_id','product_uuid','products','id',true),
      ('product_media','product_id','product_uuid','products','id',true),
      ('bom_items','vehicle_id','vehicle_uuid','products','id',true),
      ('bom_items','sku_code','sku_uuid','skus','code',true),
      ('vins','sku_code','sku_uuid','skus','code',false),
      ('repairs','vin','vin_uuid','vins','vin',true),
      ('repairs','replacement_sku','replacement_sku_uuid','skus','code',false),
      ('fits','part_product_id','part_product_uuid','products','id',true),
      ('fits','vehicle_product_id','vehicle_product_uuid','products','id',true),
      ('substitutes','original_sku','original_sku_uuid','skus','code',true),
      ('substitutes','replacement_sku','replacement_sku_uuid','skus','code',true),
      ('bom_versions','vehicle_id','vehicle_uuid','products','id',true),
      ('bom_version_items','bom_version_id','bom_version_uuid','bom_versions','id',true),
      ('bom_version_items','parent_item_id','parent_item_uuid','bom_version_items','id',false),
      ('bom_version_items','sku_code','sku_uuid','skus','code',true),
      ('bom_version_items','drawing_media_id','drawing_media_uuid','product_media','id',false),
      ('vin_installed','vin_id','vin_uuid','vins','id',true),
      ('vin_installed','sku_code','sku_uuid','skus','code',true),
      ('catalog_publications','product_id','product_uuid','products','id',true),
      ('app_sessions','user_id','user_uuid','app_users','id',true),
      ('portal_account_reviews','user_id','user_uuid','app_users','id',true),
      ('portal_vehicle_requests','user_id','user_uuid','app_users','id',true),
      ('portal_vehicle_access','request_id','request_uuid','portal_vehicle_requests','id',true),
      ('portal_vehicle_access','user_id','user_uuid','app_users','id',true),
      ('portal_vehicle_access','vin_id','vin_uuid','vins','id',true),
      ('portal_service_requests','user_id','user_uuid','app_users','id',true),
      ('portal_service_requests','vin_id','vin_uuid','vins','id',true),
      ('portal_service_requests','repair_id','repair_uuid','repairs','id',false),
      ('production_orders','sku_code','sku_uuid','skus','code',true),
      ('production_orders','bom_version_id','bom_version_uuid','bom_versions','id',true),
      ('production_orders','factory_id','factory_uuid','factories','id',false),
      ('warehouse_stock','warehouse_id','warehouse_uuid','warehouses','id',true),
      ('warehouse_stock','sku_code','sku_uuid','skus','code',true),
      ('stock_movements','sku_code','sku_uuid','skus','code',true),
      ('stock_movements','from_warehouse','from_warehouse_uuid','warehouses','id',false),
      ('stock_movements','to_warehouse','to_warehouse_uuid','warehouses','id',true),
      ('repair_stock_events','repair_id','repair_uuid','repairs','id',true),
      ('repair_stock_events','warehouse_id','warehouse_uuid','warehouses','id',true),
      ('repair_stock_events','sku_code','sku_uuid','skus','code',true),
      ('repair_replacements','repair_id','repair_uuid','repairs','id',true),
      ('repair_replacements','vin_id','vin_uuid','vins','id',true),
      ('repair_replacements','new_sku','new_sku_uuid','skus','code',true),
      ('old_part_recoveries','replacement_id','replacement_uuid','repair_replacements','id',true),
      ('old_part_recoveries','warehouse_id','warehouse_uuid','warehouses','id',false),
      ('old_part_recovery_events','replacement_id','replacement_uuid','old_part_recoveries','replacement_id',true),
      ('old_part_recovery_events','warehouse_id','warehouse_uuid','warehouses','id',false),
      ('old_part_restock_requests','replacement_id','replacement_uuid','old_part_recoveries','replacement_id',true),
      ('old_part_restock_requests','movement_id','movement_uuid','stock_movements','id',false),
      ('production_deliveries','order_id','order_uuid','production_orders','id',true),
      ('production_deliveries','warehouse_id','warehouse_uuid','warehouses','id',true),
      ('production_order_events','order_id','order_uuid','production_orders','id',true),
      ('production_order_materials','order_id','order_uuid','production_orders','id',true),
      ('production_order_materials','bom_item_id','bom_item_uuid','bom_version_items','id',true),
      ('production_order_materials','sku_code','sku_uuid','skus','code',true),
      ('production_order_attachments','order_id','order_uuid','production_orders','id',true),
      ('production_delivery_receipts','delivery_id','delivery_uuid','production_deliveries','id',true)
    ) AS links(child_table, legacy_column, uuid_column, parent_table, parent_column, required)
  LOOP
    EXECUTE format(
      'ALTER TABLE alsvid_v2.%I ADD COLUMN IF NOT EXISTS %I uuid',
      link.child_table, link.uuid_column
    );
    EXECUTE format(
      'UPDATE alsvid_v2.%I child SET %I = parent.entity_uuid FROM alsvid_v2.%I parent WHERE child.%I = parent.%I AND child.%I IS NULL',
      link.child_table, link.uuid_column, link.parent_table, link.legacy_column, link.parent_column, link.uuid_column
    );
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM alsvid_v2.%I child WHERE child.%I IS NOT NULL AND child.%I IS NULL)',
      link.child_table, link.legacy_column, link.uuid_column
    ) INTO has_orphans;
    IF has_orphans THEN
      RAISE EXCEPTION 'Cannot map existing relationship %.% to UUID v7', link.child_table, link.legacy_column;
    END IF;
    IF link.required THEN
      EXECUTE format(
        'ALTER TABLE alsvid_v2.%I ALTER COLUMN %I SET NOT NULL',
        link.child_table, link.uuid_column
      );
    END IF;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON alsvid_v2.%I(%I)',
      link.child_table || '_' || link.uuid_column || '_idx',
      link.child_table, link.uuid_column
    );
    EXECUTE format(
      'ALTER TABLE alsvid_v2.%I DROP CONSTRAINT IF EXISTS %I',
      link.child_table, link.child_table || '_' || link.uuid_column || '_fkey'
    );
    EXECUTE format(
      'ALTER TABLE alsvid_v2.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES alsvid_v2.%I(entity_uuid)',
      link.child_table, link.child_table || '_' || link.uuid_column || '_fkey',
      link.uuid_column, link.parent_table
    );
  END LOOP;
END;
$$;
