// ALSVID V2.0 - 数据层：JSON 文件存储 + 种子数据
// 说明：第一阶段使用本地 JSON 存储，结构清晰，后续可平滑迁移到正式数据库。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------------- 字典（SKU 四段规则的编码来源） ----------------

// 第一段：归属/车型
const OWNERSHIP = [
  { code: 'A1', label: 'A1 专用', kind: 'model' },
  { code: 'AL', label: 'ALSVID 品牌共用', kind: 'brand' },
  { code: 'UN', label: '通用配件（不限品牌车型）', kind: 'universal' },
];

// 第二段：商品品类编码 + 品类模板
const TEMPLATES = [
  { code: 'FEB', name: '折叠电动自行车', kind: 'vehicle' },
  { code: 'BAT', name: '电池', kind: 'part' },
  { code: 'CHG', name: '充电器', kind: 'part' },
  { code: 'MOT', name: '电机', kind: 'part' },
  { code: 'CTL', name: '控制器', kind: 'part' },
  { code: 'DSP', name: '显示屏', kind: 'part' },
  { code: 'TIR', name: '轮胎/轮组', kind: 'part' },
  { code: 'BRK', name: '制动系统', kind: 'part' },
  { code: 'RCK', name: '货架', kind: 'part' },
  { code: 'FND', name: '挡泥板', kind: 'part' },
  { code: 'HLM', name: '头盔', kind: 'part' },
  { code: 'LCK', name: '车锁', kind: 'part' },
  { code: 'GEN', name: '其他配件', kind: 'part' },
];

// 第三段：动态规格（按品类定义）
const SPEC_OPTIONS = {
  FEB: ['450', '500'],
  BAT: ['450', '500'],
  CHG: ['03A'],
  HLM: ['SML', 'MED', 'LRG'],
};

// 第四段：颜色（初始由颜色字典种子提供）

// BOM 初始标准部位（第 9.3 节）
const BOM_SECTIONS = [
  '车架与折叠', '操控与转向', '电池与电控', '轮组与传动',
  '制动系统', '驱动系统', '外设与附件', '紧固与包装',
];

// ---------------- 全局字段标准库种子 ----------------
// level: product=产品级 / sku=SKU 级 / bom=BOM 项目级
function F(code, zh, en, de, type, opts = {}) {
  return {
    code, nameZh: zh, nameEn: en, nameDe: de, type,
    unit: opts.unit || '',
    options: opts.options || [],
    level: opts.level || 'product',
    templates: opts.templates || [],
    required: !!opts.required,
    searchable: opts.searchable !== false,
    skuGen: !!opts.skuGen,
    shopVisible: !!opts.shopVisible,
    enabled: true,
    version: 1,
  };
}

const SEED_FIELDS = [
  // —— 折叠电动自行车 ——
  F('frame_material', '车架材质', 'Frame Material', 'Rahmenmaterial', 'enum', {
    options: ['铝合金', '铝合金+镁合金', '钛合金'], templates: ['FEB'], required: true }),
  F('folding_structure', '折叠结构', 'Folding Structure', 'Faltmechanismus', 'enum', {
    options: ['中折', '竖折', '横折'], templates: ['FEB'], required: true }),
  F('motor_power', '电机功率', 'Motor Power', 'Motorleistung', 'number', {
    unit: 'W', templates: ['FEB', 'MOT'] }),
  F('wheel_size', '轮径', 'Wheel Size', 'Radgröße', 'enum', {
    options: ['14寸', '16寸', '20寸'], templates: ['FEB', 'TIR'] }),
  F('max_speed', '最高时速', 'Max Speed', 'Höchstgeschwindigkeit', 'number', {
    unit: 'km/h', templates: ['FEB'] }),
  F('range', '续航里程', 'Range', 'Reichweite', 'number', {
    unit: 'km', templates: ['FEB'], shopVisible: true }),
  // —— SKU 级 ——
  F('battery_capacity', '电池容量', 'Battery Capacity', 'Akkukapazität', 'enum', {
    options: ['450', '500'], unit: 'Wh', level: 'sku', templates: ['FEB', 'BAT'],
    skuGen: true, searchable: true, shopVisible: true }),
  F('charger_current', '充电电流', 'Charging Current', 'Ladestrom', 'enum', {
    options: ['03A'], unit: 'A', level: 'sku', templates: ['CHG'], skuGen: true }),
  F('helmet_size', '头盔尺码', 'Helmet Size', 'Helmgröße', 'enum', {
    options: ['SML', 'MED', 'LRG'], level: 'sku', templates: ['HLM'], skuGen: true }),
  F('rated_voltage', '额定电压', 'Rated Voltage', 'Nennspannung', 'number', {
    unit: 'V', level: 'sku', templates: ['BAT', 'CHG', 'MOT', 'CTL'] }),
  // —— 配件通用 ——
  F('net_weight', '净重', 'Net Weight', 'Nettogewicht', 'number', {
    unit: 'kg', templates: ['BAT', 'CHG', 'MOT', 'CTL', 'DSP', 'TIR', 'BRK', 'RCK', 'FND', 'HLM', 'LCK', 'GEN'] }),
  F('gross_weight', '包装毛重', 'Gross Weight', 'Bruttogewicht', 'number', {
    unit: 'kg', level: 'sku', templates: ['BAT', 'CHG', 'MOT', 'CTL', 'DSP', 'TIR', 'BRK', 'RCK', 'FND', 'HLM', 'LCK', 'GEN'] }),
  F('package_size', '包装尺寸', 'Package Size', 'Paketmaß', 'text', {
    level: 'sku', templates: ['BAT', 'CHG', 'MOT', 'CTL', 'DSP', 'TIR', 'BRK', 'RCK', 'FND', 'HLM', 'LCK', 'GEN'] }),
  F('connector_type', '接口类型', 'Connector Type', 'Anschlusstyp', 'text', {
    templates: ['BAT', 'CHG', 'MOT', 'CTL'] }),
  F('certification', '适用认证', 'Certification', 'Zertifizierung', 'text', {
    templates: ['HLM', 'BRK'] }),
];

// ---------------- 颜色字典种子（6.2） ----------------
const SEED_COLORS = [
  { code: 'BLK', zh: '黑色', en: 'Black', de: 'Schwarz', hex: '#1f1f1f', sort: 1, enabled: true },
  { code: 'WHT', zh: '白色', en: 'White', de: 'Weiß', hex: '#f2f2f2', sort: 2, enabled: true },
  { code: 'GRY', zh: '灰色', en: 'Grey', de: 'Grau', hex: '#8a8f98', sort: 3, enabled: true },
  { code: 'STD', zh: '标准色/不分色', en: 'Standard', de: 'Standard', hex: '#c9cdd4', sort: 99, enabled: true },
];

// ---------------- 示例产品（明确标注为示例数据） ----------------
const SEED_PRODUCTS = [
  {
    id: 'p-a1',
    kind: 'vehicle',
    name: 'A1 折叠电动自行车',
    model: 'A1',
    productType: 'FEB',
    status: '启用',
    ownership: 'A1',
    specs: {
      frame_material: '铝合金',
      folding_structure: '中折',
      motor_power: '250',
      wheel_size: '16寸',
      max_speed: '25',
      range: '65',
    },
    skus: [
      { sku: 'A1-FEB-450-BLK', spec: '450', color: 'BLK', price: '', note: '示例数据' },
      { sku: 'A1-FEB-450-WHT', spec: '450', color: 'WHT', price: '', note: '示例数据' },
      { sku: 'A1-FEB-500-BLK', spec: '500', color: 'BLK', price: '', note: '示例数据' },
      { sku: 'A1-FEB-500-WHT', spec: '500', color: 'WHT', price: '', note: '示例数据' },
    ],
    fitments: [],
    bom: {
      version: 'V1.0（示例）',
      items: [
        { id: 'b1', section: '车架与折叠', drawingNo: 'D-001', sku: 'UN-FRM-STD-BLK', qty: 1, unit: '件', position: '车架主体' },
        { id: 'b2', section: '电池与电控', drawingNo: 'D-014', sku: 'A1-BAT-450-STD', qty: 1, unit: '件', position: '座管内' },
        { id: 'b3', section: '外设与附件', drawingNo: 'D-032', sku: 'A1-RCK-STD-BLK', qty: 1, unit: '件', position: '后货架' },
        { id: 'b4', section: '紧固与包装', drawingNo: 'D-040', sku: 'AL-CHG-03A-STD', qty: 1, unit: '件', position: '随车附件' },
      ],
    },
    images: [],
    _seed: true,
  },
  {
    id: 'p-l1',
    kind: 'vehicle',
    name: 'L1 折叠电动自行车',
    model: 'L1',
    productType: 'FEB',
    status: '规划',
    ownership: 'L1',
    specs: { frame_material: '铝合金', folding_structure: '竖折' },
    skus: [],
    fitments: [],
    bom: { version: '', items: [] },
    images: [],
    _seed: true,
  },
  {
    id: 'p-bat',
    kind: 'part',
    name: 'A1 专用 450Wh 电池',
    model: '',
    productType: 'BAT',
    status: '启用',
    ownership: 'A1',
    uses: ['生产使用', '售后维修', '单独销售'],
    specs: {
      battery_capacity: '450',
      rated_voltage: '36',
      net_weight: '2.8',
      connector_type: 'ALSVID 专用接口',
    },
    skus: [{ sku: 'A1-BAT-450-STD', spec: '450', color: 'STD', price: '', note: '示例数据' }],
    fitments: [{ vehicleModel: 'A1', note: 'A1 全系适配（示例）' }],
    images: [],
    _seed: true,
  },
  {
    id: 'p-chg',
    kind: 'part',
    name: '3A 充电器',
    model: '',
    productType: 'CHG',
    status: '启用',
    ownership: 'AL',
    uses: ['生产使用', '单独销售'],
    specs: { charger_current: '03A', rated_voltage: '42', net_weight: '0.4' },
    skus: [{ sku: 'AL-CHG-03A-STD', spec: '03A', color: 'STD', price: '', note: '示例数据' }],
    fitments: [
      { vehicleModel: 'A1', note: '' },
      { vehicleModel: 'L1', note: '' },
    ],
    images: [],
    _seed: true,
  },
  {
    id: 'p-hlm',
    kind: 'part',
    name: 'ALSVID 骑行头盔',
    model: '',
    productType: 'HLM',
    status: '启用',
    ownership: 'UN',
    uses: ['单独销售'],
    specs: { certification: 'EN 1078' },
    skus: [{ sku: 'UN-HLM-MED-BLK', spec: 'MED', color: 'BLK', price: '', note: '示例数据' }],
    fitments: [],
    images: [],
    _seed: true,
  },
  {
    id: 'p-rck',
    kind: 'part',
    name: 'A1 专用货架',
    model: '',
    productType: 'RCK',
    status: '启用',
    ownership: 'A1',
    uses: ['生产使用', '售后维修'],
    specs: { net_weight: '1.6' },
    skus: [{ sku: 'A1-RCK-STD-BLK', spec: 'STD', color: 'BLK', price: '', note: '示例数据' }],
    fitments: [{ vehicleModel: 'A1', note: '' }],
    images: [],
    _seed: true,
  },
];

function seed() {
  return {
    seededAt: new Date().toISOString(),
    fields: SEED_FIELDS,
    colors: SEED_COLORS,
    products: SEED_PRODUCTS,
    vins: [],
    repairs: [],
    substitutes: [],
    auditLog: [],
    counters: { product: 100, bomItem: 100, vin: 100, repair: 100, substitute: 100 },
  };
}

function load() {
  if (process.env.DATABASE_URL) return { fields: SEED_FIELDS, colors: SEED_COLORS, products: [], vins: [], repairs: [], substitutes: [], auditLog: [], counters: {} };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = seed();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.auditLog ||= [];
  db.products ||= [];
  db.vins ||= [];
  db.repairs ||= [];
  db.substitutes ||= [];
  db.counters ||= {};
  db.counters.vin ||= 100;
  db.counters.repair ||= 100;
  db.counters.substitute ||= 100;
  db.products.forEach((p) => { p.version ||= 1; p.skus ||= []; p.fitments ||= []; p.images ||= []; });
  return db;
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

module.exports = { load, save, OWNERSHIP, TEMPLATES, SPEC_OPTIONS, BOM_SECTIONS, SEED_FIELDS, SEED_COLORS };
