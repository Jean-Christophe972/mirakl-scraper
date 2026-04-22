/**
 * Split products_catalog.json into per-brand files to stay under GitHub 100MB limit.
 *
 * Output:
 *   data/output/products/<brand-slug>.json    — one file per brand with its full product array
 *   data/output/products_index.json            — lightweight index (no product data)
 *
 * Raw URL pattern for teammates:
 *   https://raw.githubusercontent.com/Jean-Christophe972/mirakl-scraper/main/data/output/products/<slug>.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'output', 'products_catalog.json');
const SPLIT_DIR = path.join(ROOT, 'data', 'output', 'products');
const INDEX_FILE = path.join(ROOT, 'data', 'output', 'products_index.json');
const REPO_RAW_BASE = 'https://raw.githubusercontent.com/Jean-Christophe972/mirakl-scraper/main/data/output/products';

function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unknown';
}

(async () => {
  if (!fs.existsSync(SOURCE)) { console.error('❌ products_catalog.json missing'); process.exit(1); }
  fs.mkdirSync(SPLIT_DIR, { recursive: true });

  // Clean old split files
  for (const f of fs.readdirSync(SPLIT_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(SPLIT_DIR, f));
  }

  const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const byBrand = new Map();
  for (const p of src.products) {
    if (!byBrand.has(p.brand_name)) byBrand.set(p.brand_name, []);
    byBrand.get(p.brand_name).push(p);
  }

  const index = [];
  let totalBytes = 0;
  let slugCount = new Map();

  for (const [brandName, products] of byBrand.entries()) {
    let slug = slugify(brandName);
    // Ensure unique slug
    const base = slug;
    let i = 1;
    while (slugCount.has(slug)) slug = `${base}-${++i}`;
    slugCount.set(slug, true);

    const filePath = path.join(SPLIT_DIR, `${slug}.json`);
    const payload = {
      brand_name: brandName,
      brand_slug: slug,
      product_count: products.length,
      generated_at: src.summary.generated_at,
      products
    };
    const str = JSON.stringify(payload, null, 2);
    fs.writeFileSync(filePath, str);
    totalBytes += str.length;

    // Compute price summary for index
    const prices = products.map(p => p.price_min).filter(x => x != null);
    const minP = prices.length ? Math.min(...prices) : null;
    const maxP = prices.length ? Math.max(...prices) : null;
    const avgP = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

    // product_type counts
    const typeCounts = {};
    for (const p of products) if (p.product_type) typeCounts[p.product_type] = (typeCounts[p.product_type] || 0) + 1;
    const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => ({ type: t, count: c }));

    index.push({
      brand_name: brandName,
      brand_slug: slug,
      product_count: products.length,
      price_min: minP,
      price_max: maxP,
      price_avg: avgP,
      top_product_types: topTypes,
      file_url: `${REPO_RAW_BASE}/${slug}.json`
    });
  }

  // Sort index by product_count desc
  index.sort((a, b) => b.product_count - a.product_count);

  const indexPayload = {
    summary: {
      generated_at: src.summary.generated_at,
      total_brands: index.length,
      total_products: src.summary.total_products,
      avg_products_per_brand: src.summary.avg_products_per_brand,
      note: 'For full product data of a brand, fetch file_url from the corresponding entry in brands[].'
    },
    brands: index
  };

  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexPayload, null, 2));

  const avgBrandSize = Math.round(totalBytes / index.length / 1024);
  console.log(`✅ Split ${src.products.length} products across ${index.length} brands`);
  console.log(`   ${SPLIT_DIR}/  (${index.length} files, avg ${avgBrandSize} KB each)`);
  console.log(`   ${INDEX_FILE}  (lightweight index, ${Math.round(fs.statSync(INDEX_FILE).size / 1024)} KB)`);
  console.log(`\n   Largest files:`);
  const bySize = index.slice().sort((a, b) => b.product_count - a.product_count).slice(0, 5);
  for (const b of bySize) console.log(`     ${b.product_count.toString().padStart(5)} products — ${b.brand_slug}.json`);
})();
