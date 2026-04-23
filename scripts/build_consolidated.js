/**
 * Build a single consolidated output file for GitHub + Supabase.
 *
 * Strategy:
 *   - Merge brands_enriched.json + products_catalog.json into ONE file
 *   - Drop heavy fields (description, image) from products to stay under GitHub's 100MB cap
 *   - Keep everything Supabase needs for BDR matching + email personalization
 *
 * Output: data/output/mirakl_dataset.json   (single source of truth)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRANDS_FILE = path.join(ROOT, 'data', 'output', 'brands_enriched.json');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'output', 'products_catalog.json');
const OUT_FILE = path.join(ROOT, 'data', 'output', 'mirakl_dataset.json');

const brandsData = JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));

// Trim products aggressively to stay under 100MB.
// Brand attributes (tier/category/country/gender) are on brands[] — joined via brand_name.
// URL is reconstructible from brand_url + handle.
const products = catalog.products.map(p => ({
  brand_name: p.brand_name,
  product_id: p.id,
  handle: p.handle,
  title: p.title,
  product_type: p.product_type,
  tags: (p.tags || []).slice(0, 8),
  price_min: p.price_min,
  price_max: p.price_max,
  available: p.available,
  vendor: p.vendor
}));

// Group product counts back onto brands for quick access
const countsByBrand = new Map();
for (const p of products) countsByBrand.set(p.brand_name, (countsByBrand.get(p.brand_name) || 0) + 1);

const enrichedBrands = brandsData.brands.map(b => ({
  ...b,
  product_count: countsByBrand.get(b.brand_name) || 0
}));

const payload = {
  summary: {
    generated_at: new Date().toISOString(),
    total_brands: enrichedBrands.length,
    brands_with_products: enrichedBrands.filter(b => b.product_count > 0).length,
    total_products: products.length,
    avg_products_per_brand: Math.round(products.length / enrichedBrands.filter(b => b.product_count > 0).length),
    schema_note: 'Single consolidated dataset. brands[]: 19 enrichment fields + product_count. products[]: flat array, lightweight (no description/image).'
  },
  brands: enrichedBrands,
  products
};

// Compact JSON (no indentation) — saves ~30% size
const str = JSON.stringify(payload);
fs.writeFileSync(OUT_FILE, str);

const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
console.log(`✅ ${OUT_FILE}`);
console.log(`   ${payload.summary.total_brands} brands | ${payload.summary.total_products} products`);
console.log(`   ${payload.summary.brands_with_products} brands have catalogs (avg ${payload.summary.avg_products_per_brand}/brand)`);
console.log(`   Size: ${sizeMB} MB ${sizeMB > 100 ? '⚠️ EXCEEDS GitHub 100MB' : '✅ fits GitHub'}`);
