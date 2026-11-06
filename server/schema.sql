-- ALSVID V2.0 resource model. The local adapter currently persists the same
-- aggregates to data/db.json; this schema is the PostgreSQL migration target.
-- V2 uses its own namespace while 8080 is still live. This avoids collisions
-- with the legacy production tables during the takeover window.
create schema if not exists alsvid_v2;
set search_path to alsvid_v2;
create table if not exists products (
  id text primary key,
  kind text not null check (kind in ('vehicle', 'part')),
  name text not null,
  model text not null default '',
  product_type text not null,
  status text not null default '启用',
  ownership text not null,
  uses jsonb not null default '[]'::jsonb,
  specs jsonb not null default '{}'::jsonb,
  bom_version text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists fields (
  code text primary key,
  name_zh text not null,
  name_en text not null default '',
  name_de text not null default '',
  data_type text not null,
  unit text not null default '',
  level text not null check (level in ('product', 'sku', 'bom')),
  options jsonb not null default '[]'::jsonb,
  templates jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  searchable boolean not null default true,
  sku_gen boolean not null default false,
  shop_visible boolean not null default false,
  enabled boolean not null default true
);
create table if not exists colors (
  code text primary key check (code ~ '^[A-Z0-9]{3}$'),
  zh text not null,
  en text not null default '',
  de text not null default '',
  hex text not null,
  sort integer not null default 50,
  enabled boolean not null default true
);
create table if not exists skus (
  code text primary key,
  product_id text not null references products(id),
  spec text not null,
  color_code text not null references colors(code),
  price numeric,
  note text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists product_media (
  id text primary key,
  product_id text not null references products(id),
  object_key text not null unique,
  content_type text not null,
  label text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists bom_items (
  id bigserial primary key,
  vehicle_id text not null references products(id),
  sku_code text not null references skus(code),
  section text not null,
  drawing_no text not null default '',
  quantity numeric not null default 1,
  unit text not null default '件',
  position text not null default ''
);
create table if not exists vins (
  id text primary key,
  vin text not null unique,
  model text not null default '',
  sku_code text references skus(code),
  order_no text not null default '',
  factory text not null default '',
  batch text not null default '',
  bom_version text not null default '',
  installed jsonb not null default '[]'::jsonb,
  serials jsonb not null default '[]'::jsonb,
  produced_at date,
  status text not null default '在用',
  created_at timestamptz not null default now()
);
create table if not exists repairs (
  id text primary key,
  work_order_no text not null unique,
  vin text not null references vins(vin),
  type text not null,
  fault text not null,
  replacement_sku text references skus(code),
  quantity numeric not null default 0,
  repair_store text not null default '',
  status text not null default '待收货',
  old_part text not null default '',
  created_at date not null default current_date
);
create table if not exists fits (
  part_product_id text not null references products(id),
  vehicle_product_id text not null references products(id),
  note text not null default '',
  primary key (part_product_id, vehicle_product_id)
);
create table if not exists substitutes (
  id text primary key,
  original_sku text not null references skus(code),
  replacement_sku text not null references skus(code),
  reason text not null,
  effective_at date,
  status text not null default '启用',
  note text not null default ''
);
create table if not exists audit_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  target text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
-- Immutable production BOM snapshots are separate from the editable draft.
create table if not exists bom_versions (
  id bigserial primary key,
  vehicle_id text not null references products(id),
  version text not null,
  status text not null default 'draft',
  change_reason text not null default '',
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  unique (vehicle_id, version)
);
create table if not exists bom_version_items (
  id bigserial primary key,
  bom_version_id bigint not null references bom_versions(id),
  parent_item_id bigint references bom_version_items(id),
  sku_code text not null references skus(code),
  section text not null default '',
  drawing_no text not null default '',
  quantity numeric not null check (quantity > 0),
  unit text not null default '件',
  position text not null default ''
);
-- Actual installed components are independent of the standard BOM.
create table if not exists vin_installed (
  id bigserial primary key,
  vin_id text not null references vins(id),
  sku_code text not null references skus(code),
  quantity numeric not null check (quantity > 0),
  serial_no text not null default '',
  batch_no text not null default '',
  deviation_reason text not null default '',
  deviation_approved_by text not null default '',
  installed_at timestamptz,
  check (deviation_reason = '' or deviation_approved_by <> '')
);
create index if not exists vin_installed_serial_idx on vin_installed(serial_no) where serial_no <> '';
create index if not exists vin_installed_batch_idx on vin_installed(batch_no) where batch_no <> '';
create unique index if not exists skus_code_unique on skus(code);
create index if not exists products_kind_status_idx on products(kind, status);
create table if not exists app_users (
  id text primary key,
  username text not null unique,
  password_salt text not null,
  password_hash text not null,
  role text not null check (role in ('admin','viewer')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists app_sessions (
  token_hash text primary key,
  user_id text not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists production_orders (
  id text primary key,
  order_no text not null unique,
  sku_code text not null references skus(code),
  bom_version_id bigint not null references bom_versions(id),
  factory text not null,
  batch text not null,
  planned_quantity integer not null check (planned_quantity > 0),
  status text not null default '计划中' check (status in ('计划中','生产中','已完成','已取消')),
  created_at timestamptz not null default now()
);
create table if not exists warehouses (
  id text primary key,
  name text not null unique,
  kind text not null check (kind in ('国内仓','维修店仓')),
  created_at timestamptz not null default now()
);
create table if not exists warehouse_stock (
  warehouse_id text not null references warehouses(id),
  sku_code text not null references skus(code),
  quantity integer not null default 0 check (quantity >= 0),
  primary key (warehouse_id,sku_code)
);
create table if not exists stock_movements (
  id text primary key,
  kind text not null check (kind in ('入库','调拨')),
  sku_code text not null references skus(code),
  quantity integer not null check (quantity > 0),
  from_warehouse text references warehouses(id),
  to_warehouse text not null references warehouses(id),
  note text not null default '',
  actor text not null,
  created_at timestamptz not null default now()
);
create table if not exists repair_stock_events (
  id text primary key,
  repair_id text not null references repairs(id),
  warehouse_id text not null references warehouses(id),
  sku_code text not null references skus(code),
  kind text not null check (kind in ('领用','退回')),
  quantity integer not null check (quantity > 0),
  actor text not null,
  created_at timestamptz not null default now()
);
create table if not exists repair_replacements (
  id text primary key,
  repair_id text not null unique references repairs(id),
  vin_id text not null references vins(id),
  old_sku text not null,
  old_serial text not null default '',
  old_batch text not null default '',
  new_sku text not null references skus(code),
  new_serial text not null default '',
  new_batch text not null default '',
  quantity integer not null check (quantity > 0),
  actor text not null,
  created_at timestamptz not null default now()
);
create table if not exists old_part_recoveries (
  replacement_id text primary key references repair_replacements(id),
  status text not null default '待回收' check (status in ('待回收','已退回','检测中','返修中','已报废')),
  warehouse_id text references warehouses(id),
  updated_at timestamptz not null default now()
);
create table if not exists old_part_recovery_events (
  id text primary key,
  replacement_id text not null references old_part_recoveries(replacement_id),
  from_status text not null,
  to_status text not null,
  warehouse_id text references warehouses(id),
  note text not null,
  actor text not null,
  created_at timestamptz not null default now()
);
insert into old_part_recoveries(replacement_id) select id from repair_replacements on conflict (replacement_id) do nothing;
create table if not exists old_part_restock_requests (
  replacement_id text primary key references old_part_recoveries(replacement_id),
  request_note text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  movement_id text unique references stock_movements(id)
);
alter table bom_version_items add column if not exists drawing_media_id text references product_media(id);
alter table bom_version_items add column if not exists drawing_x double precision;
alter table bom_version_items add column if not exists drawing_y double precision;
create table if not exists factories (
  id text primary key,
  name text not null unique,
  country text not null default '中国',
  contact text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  status text not null default '启用' check (status in ('启用','停用')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table warehouses drop constraint if exists warehouses_kind_check;
alter table warehouses add constraint warehouses_kind_check check (kind in ('国内仓','维修店仓','海外仓'));
create table if not exists production_deliveries (
  id text primary key,
  order_id text not null references production_orders(id),
  shipment_no text not null unique,
  warehouse_id text not null references warehouses(id),
  planned_quantity integer not null check (planned_quantity > 0),
  received_quantity integer check (received_quantity > 0),
  status text not null default '待发运' check (status in ('待发运','在途','已入库')),
  note text not null default '',
  received_by text,
  shipped_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

alter table production_orders add column if not exists factory_id text references factories(id);
alter table production_orders add column if not exists progress_percent integer not null default 0 check (progress_percent between 0 and 100);
alter table production_orders add column if not exists actual_quantity integer not null default 0 check (actual_quantity >= 0);
alter table production_orders add column if not exists qc_status text not null default '待质检' check (qc_status in ('待质检','合格','不合格'));
alter table production_orders add column if not exists qc_note text not null default '';
create table if not exists production_order_events (
 id text primary key,
 order_id text not null references production_orders(id),
 event_type text not null check (event_type in ('进度更新','质检更新')),
 progress_percent integer,
 actual_quantity integer,
 qc_status text,
 note text not null default '',
 actor text not null,
 created_at timestamptz not null default now()
);

alter table production_deliveries add column if not exists receipt_note text not null default '';

alter table production_orders add column if not exists sourcing_mode text not null default '工厂包工包料' check (sourcing_mode in ('工厂包工包料','客供料加工','混合供料'));
alter table production_orders add column if not exists supplier_cost numeric(14,2) not null default 0 check (supplier_cost >= 0);
alter table production_orders add column if not exists material_cost numeric(14,2) not null default 0 check (material_cost >= 0);
alter table production_orders add column if not exists processing_cost numeric(14,2) not null default 0 check (processing_cost >= 0);
alter table production_orders add column if not exists freight_cost numeric(14,2) not null default 0 check (freight_cost >= 0);
alter table production_orders add column if not exists import_cost numeric(14,2) not null default 0 check (import_cost >= 0);
alter table production_orders add column if not exists cost_currency text not null default 'CNY';

create table if not exists production_order_materials (
 id bigserial primary key,
 order_id text not null references production_orders(id),
 bom_item_id bigint not null references bom_version_items(id),
 sku_code text not null references skus(code),
 section text not null default '',
 quantity numeric not null check (quantity > 0),
 unit text not null default '件',
 supply_party text not null default '工厂' check (supply_party in ('工厂','ALSVID')),
 unique(order_id,bom_item_id)
);

create table if not exists production_order_attachments (
 id text primary key,
 order_id text not null references production_orders(id),
 object_key text not null unique,
 file_name text not null,
 content_type text not null,
 file_size bigint not null check (file_size > 0),
 uploaded_by text not null,
 created_at timestamptz not null default now()
);
