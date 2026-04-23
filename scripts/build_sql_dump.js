/**
 * Build a single SQL file for Supabase import.
 *
 * Contains:
 *   - CREATE TABLE brands (with all enrichment fields)
 *   - CREATE TABLE products (FK → brands.brand_name)
 *   - INSERT rows for both
 *
 * Usage:
 *   node scripts/build_sql_dump.js
 *   → data/output/mirakl_dataset.sql
 *
 * Import in Supabase:
 *   SQL Editor → paste → run   (or psql -f mirakl_dataset.sql)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRANDS_FILE = path.join(ROOT, 'data', 'output', 'brands_enriched.json');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'output', 'products_catalog.json');
const OUT_FILE = path.join(ROOT, 'data', 'output', 'mirakl_dataset.sql');

const brandsData = JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));

// ---------- Postgres escaping helpers ----------
function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // string: single-quote escape
  return `'${String(v).replace(/'/g, "''")}'`;
}
function arr(v) {
  if (!Array.isArray(v) || v.length === 0) return 'NULL';
  // Postgres text[] literal: ARRAY['a','b']
  return `ARRAY[${v.map(x => `'${String(x).replace(/'/g, "''")}'`).join(',')}]::text[]`;
}

// ---------- Build SQL ----------
const lines = [];
lines.push('-- ============================================================');
lines.push('-- Mirakl BDR Dataset — Brands + Products');
lines.push(`-- Generated: ${new Date().toISOString()}`);
lines.push(`-- ${brandsData.brands.length} brands | ${catalog.products.length} products`);
lines.push('-- ============================================================');
lines.push('');
lines.push('BEGIN;');
lines.push('');
lines.push('DROP TABLE IF EXISTS products CASCADE;');
lines.push('DROP TABLE IF EXISTS brands CASCADE;');
lines.push('');

// ---------- brands table ----------
lines.push(`CREATE TABLE brands (
  brand_name              TEXT PRIMARY KEY,
  brand_url               TEXT,
  contact_email           TEXT,
  wholesale_contact_email TEXT,
  country_origin          TEXT,
  brand_tier              TEXT,
  category                TEXT,
  brand_size              TEXT,
  target_gender           TEXT,
  platform                TEXT,
  price_avg_usd           NUMERIC,
  ships_international     BOOLEAN,
  brand_story_summary     TEXT,
  key_aesthetic           TEXT,
  current_marketplace     TEXT,
  product_types_list      TEXT,
  top_product_tags        TEXT,
  product_sample          TEXT,
  enriched_at             TIMESTAMPTZ
);`);
lines.push('');
lines.push('CREATE INDEX idx_brands_tier     ON brands(brand_tier);');
lines.push('CREATE INDEX idx_brands_category ON brands(category);');
lines.push('CREATE INDEX idx_brands_platform ON brands(platform);');
lines.push('CREATE INDEX idx_brands_country  ON brands(country_origin);');
lines.push('');

// ---------- products table ----------
lines.push(`CREATE TABLE products (
  id            BIGSERIAL PRIMARY KEY,
  brand_name    TEXT NOT NULL REFERENCES brands(brand_name) ON DELETE CASCADE,
  product_id    BIGINT,
  handle        TEXT,
  title         TEXT,
  product_type  TEXT,
  tags          TEXT[],
  price_min     NUMERIC,
  price_max     NUMERIC,
  currency      TEXT,
  available     BOOLEAN,
  url           TEXT,
  vendor        TEXT,
  published_at  TIMESTAMPTZ
);`);
lines.push('');
lines.push('CREATE INDEX idx_products_brand     ON products(brand_name);');
lines.push('CREATE INDEX idx_products_type      ON products(product_type);');
lines.push('CREATE INDEX idx_products_available ON products(available);');
lines.push('CREATE INDEX idx_products_price     ON products(price_min);');
lines.push('');

// ---------- brands INSERT ----------
lines.push('-- ---------- BRANDS ----------');
const brandCols = [
  'brand_name','brand_url','contact_email','wholesale_contact_email','country_origin',
  'brand_tier','category','brand_size','target_gender','platform','price_avg_usd',
  'ships_international','brand_story_summary','key_aesthetic','current_marketplace',
  'product_types_list','top_product_tags','product_sample','enriched_at'
];
lines.push(`INSERT INTO brands (${brandCols.join(', ')}) VALUES`);
const brandRows = brandsData.brands.map(b => {
  return `(${[
    esc(b.brand_name), esc(b.brand_url), esc(b.contact_email), esc(b.wholesale_contact_email),
    esc(b.country_origin), esc(b.brand_tier), esc(b.category), esc(b.brand_size),
    esc(b.target_gender), esc(b.platform),
    b.price_avg_usd != null ? esc(b.price_avg_usd) : 'NULL',
    b.ships_international === true ? 'TRUE' : (b.ships_international === false ? 'FALSE' : 'NULL'),
    esc(b.brand_story_summary), esc(b.key_aesthetic), esc(b.current_marketplace),
    esc(b.product_types_list), esc(b.top_product_tags), esc(b.product_sample),
    esc(b.enriched_at)
  ].join(', ')})`;
});
lines.push(brandRows.join(',\n') + ';');
lines.push('');

// ---------- products INSERT (chunked) ----------
lines.push('-- ---------- PRODUCTS ----------');
const prodCols = ['brand_name','product_id','handle','title','product_type','tags','price_min','price_max','currency','available','url','vendor','published_at'];
const CHUNK = 500;
const products = catalog.products;
// Only insert products whose brand exists in brands table
const brandSet = new Set(brandsData.brands.map(b => b.brand_name));
const validProducts = products.filter(p => brandSet.has(p.brand_name));
const skipped = products.length - validProducts.length;
if (skipped > 0) lines.push(`-- Skipped ${skipped} orphan products (brand not in brands table)`);

for (let i = 0; i < validProducts.length; i += CHUNK) {
  const chunk = validProducts.slice(i, i + CHUNK);
  lines.push(`INSERT INTO products (${prodCols.join(', ')}) VALUES`);
  const rows = chunk.map(p => `(${[
    esc(p.brand_name),
    p.id != null ? String(p.id) : 'NULL',
    esc(p.handle), esc(p.title), esc(p.product_type),
    arr(p.tags),
    p.price_min != null ? esc(p.price_min) : 'NULL',
    p.price_max != null ? esc(p.price_max) : 'NULL',
    esc(p.currency),
    p.available === true ? 'TRUE' : (p.available === false ? 'FALSE' : 'NULL'),
    esc(p.url), esc(p.vendor), esc(p.published_at)
  ].join(', ')})`);
  lines.push(rows.join(',\n') + ';');
}

lines.push('');
lines.push('COMMIT;');
lines.push('');
lines.push(`-- ✅ Imported ${brandsData.brands.length} brands + ${validProducts.length} products`);

// ---------- Write ----------
const sql = lines.join('\n');
fs.writeFileSync(OUT_FILE, sql);
const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
console.log(`✅ ${OUT_FILE}`);
console.log(`   ${brandsData.brands.length} brands + ${validProducts.length} products`);
console.log(`   Size: ${sizeMB} MB`);
console.log(`\n   Import into Supabase:`);
console.log(`     1. Supabase Dashboard → SQL Editor → New query`);
console.log(`     2. Paste contents of mirakl_dataset.sql → Run`);
console.log(`   Or via psql:  psql <connection-string> -f data/output/mirakl_dataset.sql`);
