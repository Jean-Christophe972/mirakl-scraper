/**
 * Build SQL dump aligned with teammate's Supabase schema.
 *
 * Target tables (already exist in their Supabase):
 *   • sellers                      (UUID seller_id)
 *   • seller_products              (UUID seller_id FK)
 *   • marketplaces                 (UUID marketplace_id)
 *   • seller_marketplace_matches   (UUID FKs to both)
 *
 * Non-destructive: uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS to add
 * our enrichment fields that are missing from their schema. Their columns
 * are preserved.
 *
 * Output: data/output/mirakl_dataset_v2.sql
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BRANDS_FILE = path.join(ROOT, 'data', 'output', 'brands_enriched.json');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'output', 'products_catalog.json');
const OUT_FILE = path.join(ROOT, 'data', 'output', 'mirakl_dataset_v2.sql');

const brandsData = JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));

// ---------- Escape helpers ----------
function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function arr(v) {
  if (!Array.isArray(v) || v.length === 0) return 'NULL';
  return `ARRAY[${v.map(x => `'${String(x).replace(/'/g, "''")}'`).join(',')}]::text[]`;
}

// ---------- Known marketplaces ----------
const MARKETPLACES = [
  { name: 'Net-a-Porter',     categories: 'Luxury Womenswear', commission: 0.30, traffic: '12M/mo', countries: 'Global' },
  { name: 'Mr Porter',        categories: 'Luxury Menswear',   commission: 0.30, traffic: '5M/mo',  countries: 'Global' },
  { name: 'Farfetch',         categories: 'Luxury Multi',      commission: 0.30, traffic: '30M/mo', countries: 'Global' },
  { name: 'Mytheresa',        categories: 'Luxury Womenswear', commission: 0.25, traffic: '6M/mo',  countries: 'Global' },
  { name: 'Ssense',           categories: 'Contemporary',      commission: 0.30, traffic: '15M/mo', countries: 'Global' },
  { name: 'Matches Fashion',  categories: 'Luxury Multi',      commission: 0.30, traffic: '4M/mo',  countries: 'Global' },
  { name: 'Bergdorf Goodman', categories: 'Luxury Dept Store', commission: 0.40, traffic: '3M/mo',  countries: 'US' },
  { name: 'Neiman Marcus',    categories: 'Luxury Dept Store', commission: 0.40, traffic: '8M/mo',  countries: 'US' },
  { name: 'Nordstrom',        categories: 'Premium Dept Store',commission: 0.25, traffic: '60M/mo', countries: 'US' },
  { name: 'Bloomingdales',    categories: 'Premium Dept Store',commission: 0.25, traffic: '20M/mo', countries: 'US' },
  { name: 'Saks Fifth Avenue',categories: 'Luxury Dept Store', commission: 0.40, traffic: '15M/mo', countries: 'US' },
  { name: 'Shopbop',          categories: 'Contemporary',      commission: 0.20, traffic: '10M/mo', countries: 'Global' },
  { name: 'Moda Operandi',    categories: 'Luxury Womenswear', commission: 0.35, traffic: '3M/mo',  countries: 'Global' },
  { name: 'Revolve',          categories: 'Contemporary',      commission: 0.25, traffic: '25M/mo', countries: 'Global' },
  { name: '24S',              categories: 'Luxury Multi',      commission: 0.30, traffic: '2M/mo',  countries: 'Europe' }
];

// Build marketplace name → UUID map (tolerant matching)
const marketplaceUUIDs = new Map();
for (const m of MARKETPLACES) marketplaceUUIDs.set(m.name.toLowerCase(), crypto.randomUUID());

function normalizeMarketplaceName(raw) {
  const r = raw.trim().toLowerCase();
  if (!r || r === 'none' || r === 'unknown') return null;
  // fuzzy lookups
  if (r.includes('net-a-porter') || r.includes('net a porter')) return 'net-a-porter';
  if (r.includes('mr porter') || r.includes('mrporter')) return 'mr porter';
  if (r.includes('farfetch')) return 'farfetch';
  if (r.includes('mytheresa')) return 'mytheresa';
  if (r.includes('ssense')) return 'ssense';
  if (r.includes('matches')) return 'matches fashion';
  if (r.includes('bergdorf')) return 'bergdorf goodman';
  if (r.includes('neiman')) return 'neiman marcus';
  if (r.includes('nordstrom')) return 'nordstrom';
  if (r.includes('bloomingdale')) return 'bloomingdales';
  if (r.includes('saks')) return 'saks fifth avenue';
  if (r.includes('shopbop')) return 'shopbop';
  if (r.includes('moda operandi')) return 'moda operandi';
  if (r.includes('revolve')) return 'revolve';
  if (r === '24s' || r.includes('24 s')) return '24s';
  return null;
}

// Build seller_name → UUID map
const sellerUUIDs = new Map();
for (const b of brandsData.brands) sellerUUIDs.set(b.brand_name, crypto.randomUUID());

// Pre-compute product aggregations per brand
const brandAgg = new Map();
for (const p of catalog.products) {
  if (!brandAgg.has(p.brand_name)) brandAgg.set(p.brand_name, { count: 0, prices: [] });
  const a = brandAgg.get(p.brand_name);
  a.count++;
  if (p.price_min != null) a.prices.push(p.price_min);
  if (p.price_max != null) a.prices.push(p.price_max);
}

// ---------- Build SQL ----------
const lines = [];
lines.push('-- =====================================================================');
lines.push('-- Mirakl BDR — Data import aligned with existing Supabase schema');
lines.push(`-- Generated: ${new Date().toISOString()}`);
lines.push(`-- ${brandsData.brands.length} sellers | ${catalog.products.length} products | ${MARKETPLACES.length} marketplaces`);
lines.push('-- =====================================================================');
lines.push('');
lines.push('BEGIN;');
lines.push('');

// ---------- ALTER: add enrichment columns (non-destructive) ----------
lines.push('-- Add enrichment columns (non-destructive, idempotent)');
lines.push(`ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS brand_tier            TEXT,
  ADD COLUMN IF NOT EXISTS country_origin        TEXT,
  ADD COLUMN IF NOT EXISTS target_gender         TEXT,
  ADD COLUMN IF NOT EXISTS brand_size            TEXT,
  ADD COLUMN IF NOT EXISTS brand_story_summary   TEXT,
  ADD COLUMN IF NOT EXISTS key_aesthetic         TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS ships_international   BOOLEAN,
  ADD COLUMN IF NOT EXISTS current_marketplace_raw TEXT,
  ADD COLUMN IF NOT EXISTS product_types_list    TEXT,
  ADD COLUMN IF NOT EXISTS top_product_tags      TEXT,
  ADD COLUMN IF NOT EXISTS product_sample        TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at           TIMESTAMPTZ;`);
lines.push('');
lines.push(`ALTER TABLE seller_products
  ADD COLUMN IF NOT EXISTS product_id_shopify  BIGINT,
  ADD COLUMN IF NOT EXISTS handle              TEXT,
  ADD COLUMN IF NOT EXISTS tags                TEXT[],
  ADD COLUMN IF NOT EXISTS available           BOOLEAN,
  ADD COLUMN IF NOT EXISTS vendor              TEXT,
  ADD COLUMN IF NOT EXISTS url                 TEXT;`);
lines.push('');

// ---------- 1. INSERT marketplaces ----------
lines.push('-- ---------- marketplaces ----------');
lines.push('INSERT INTO marketplaces (marketplace_id, marketplace_name, main_categories, commission_rate, monthly_traffic, countries) VALUES');
const mpRows = MARKETPLACES.map(m => {
  const id = marketplaceUUIDs.get(m.name.toLowerCase());
  return `('${id}', ${esc(m.name)}, ${esc(m.categories)}, ${m.commission}, ${esc(m.traffic)}, ${esc(m.countries)})`;
});
lines.push(mpRows.join(',\n') + '\nON CONFLICT DO NOTHING;');
lines.push('');

// ---------- 2. INSERT sellers ----------
lines.push('-- ---------- sellers ----------');
const sellerCols = [
  'seller_id','seller_name','brand_name','seller_url','categories','nb_products',
  'avg_price','min_price','max_price','current_platforms','contact_email',
  // enriched columns (added via ALTER)
  'brand_tier','country_origin','target_gender','brand_size','brand_story_summary',
  'key_aesthetic','wholesale_contact_email','ships_international','current_marketplace_raw',
  'product_types_list','top_product_tags','product_sample','enriched_at'
];
lines.push(`INSERT INTO sellers (${sellerCols.join(', ')}) VALUES`);

const sellerRows = brandsData.brands.map(b => {
  const id = sellerUUIDs.get(b.brand_name);
  const agg = brandAgg.get(b.brand_name) || { count: 0, prices: [] };
  const minP = agg.prices.length ? Math.min(...agg.prices) : null;
  const maxP = agg.prices.length ? Math.max(...agg.prices) : null;
  const avgP = agg.prices.length ? Math.round(agg.prices.reduce((a,x)=>a+x,0)/agg.prices.length) : (b.price_avg_usd || null);
  return `('${id}', ${esc(b.brand_name)}, ${esc(b.brand_name)}, ${esc(b.brand_url)}, ${esc(b.category)}, ${agg.count || 0}, ${avgP != null ? avgP : 'NULL'}, ${minP != null ? minP : 'NULL'}, ${maxP != null ? maxP : 'NULL'}, ${esc(b.platform)}, ${esc(b.contact_email)}, ${esc(b.brand_tier)}, ${esc(b.country_origin)}, ${esc(b.target_gender)}, ${esc(b.brand_size)}, ${esc(b.brand_story_summary)}, ${esc(b.key_aesthetic)}, ${esc(b.wholesale_contact_email)}, ${b.ships_international === true ? 'TRUE' : (b.ships_international === false ? 'FALSE' : 'NULL')}, ${esc(b.current_marketplace)}, ${esc(b.product_types_list)}, ${esc(b.top_product_tags)}, ${esc(b.product_sample)}, ${esc(b.enriched_at)})`;
});
lines.push(sellerRows.join(',\n') + '\nON CONFLICT (seller_id) DO NOTHING;');
lines.push('');

// ---------- 3. INSERT seller_marketplace_matches ----------
lines.push('-- ---------- seller_marketplace_matches ----------');
const matchRows = [];
for (const b of brandsData.brands) {
  if (!b.current_marketplace || b.current_marketplace === 'Unknown' || b.current_marketplace === 'None') continue;
  const sellerId = sellerUUIDs.get(b.brand_name);
  const parts = b.current_marketplace.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  for (const raw of parts) {
    const key = normalizeMarketplaceName(raw);
    if (!key) continue;
    const mpId = marketplaceUUIDs.get(key);
    if (!mpId) continue;
    if (seen.has(mpId)) continue;
    seen.add(mpId);
    const mpName = MARKETPLACES.find(m => m.name.toLowerCase() === key).name;
    matchRows.push(`('${sellerId}', '${mpId}', ${esc(b.brand_name)}, ${esc(mpName)}, 'detected_via_google_search', 'detected', TRUE, 'scraperapi_google', NOW())`);
  }
}
if (matchRows.length > 0) {
  lines.push(`INSERT INTO seller_marketplace_matches (seller_id, marketplace_id, seller_name, marketplace_name, enriched_source, statut, enriched, enriched_source, enriched_at) VALUES`);
  // fix duplicate column — re-do without dup
}
// Rebuild cleanly with deduplicated columns:
lines.pop(); // drop previous line
const matchCols = ['seller_id','marketplace_id','seller_name','marketplace_name','recommandation','statut','enriched','enriched_source','enriched_at'];
if (matchRows.length > 0) {
  lines.push(`INSERT INTO seller_marketplace_matches (${matchCols.join(', ')}) VALUES`);
  lines.push(matchRows.join(',\n') + ';');
}
lines.push('');

// ---------- 4. INSERT seller_products (chunked) ----------
lines.push('-- ---------- seller_products ----------');
const prodCols = [
  'seller_id','product_name','category','avg_price','min_price','max_price',
  'product_id_shopify','handle','tags','available','vendor','url'
];
const CHUNK = 500;
const valid = catalog.products.filter(p => sellerUUIDs.has(p.brand_name));
const skipped = catalog.products.length - valid.length;
if (skipped > 0) lines.push(`-- Skipped ${skipped} orphan products`);

for (let i = 0; i < valid.length; i += CHUNK) {
  const chunk = valid.slice(i, i + CHUNK);
  lines.push(`INSERT INTO seller_products (${prodCols.join(', ')}) VALUES`);
  const rows = chunk.map(p => {
    const sid = sellerUUIDs.get(p.brand_name);
    const avg = (p.price_min != null && p.price_max != null) ? Math.round((p.price_min + p.price_max) / 2) : (p.price_min || p.price_max || null);
    return `('${sid}', ${esc(p.title)}, ${esc(p.product_type)}, ${avg != null ? avg : 'NULL'}, ${p.price_min != null ? p.price_min : 'NULL'}, ${p.price_max != null ? p.price_max : 'NULL'}, ${p.id != null ? p.id : 'NULL'}, ${esc(p.handle)}, ${arr(p.tags)}, ${p.available === true ? 'TRUE' : (p.available === false ? 'FALSE' : 'NULL')}, ${esc(p.vendor)}, ${esc(p.url)})`;
  });
  lines.push(rows.join(',\n') + ';');
}
lines.push('');
lines.push('COMMIT;');
lines.push('');
lines.push(`-- ✅ Imported: ${brandsData.brands.length} sellers | ${valid.length} products | ${MARKETPLACES.length} marketplaces | ${matchRows.length} matches`);

// ---------- Write ----------
const sql = lines.join('\n');
fs.writeFileSync(OUT_FILE, sql);
const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);

console.log(`✅ ${OUT_FILE}`);
console.log(`   ${brandsData.brands.length} sellers | ${valid.length} products | ${MARKETPLACES.length} marketplaces | ${matchRows.length} matches`);
console.log(`   Size: ${sizeMB} MB`);
console.log(`\n   Import:`);
console.log(`     curl -sL <raw-url>/mirakl_dataset_v2.sql.gz | gunzip | psql "<supabase-conn-string>"`);
