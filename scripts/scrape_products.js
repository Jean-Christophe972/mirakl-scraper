/**
 * Full Product Catalog Scraper
 * ==========================================================
 * Fetches every product from every Shopify brand in brands_enriched.json
 * and produces a FLAT array of normalized product records (one row per product)
 * for deep product-level matching by the BDR pipeline.
 *
 * Output: data/output/products_catalog.json
 *   {
 *     summary: { total_brands, total_products, ... },
 *     products: [
 *       { brand_name, brand_tier, brand_country, title, product_type, tags,
 *         price_min, price_max, currency, url, image, description, handle }
 *     ]
 *   }
 *
 * Usage:
 *   node scripts/scrape_products.js                 (direct fetch, no proxy)
 *   node scripts/scrape_products.js --proxy         (route via ScraperAPI — slower but unblocks 429)
 *   node scripts/scrape_products.js --auto-proxy    (direct first, proxy fallback on 429)
 *   node scripts/scrape_products.js --concurrency=4
 *   node scripts/scrape_products.js --force         (ignore cache, re-scrape everything)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const ROOT = path.resolve(__dirname, '..');
const BRANDS_FILE = path.join(ROOT, 'data', 'output', 'brands_enriched.json');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'output', 'products_catalog.json');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const USE_PROXY = args.includes('--proxy');
const AUTO_PROXY = args.includes('--auto-proxy');
const CONCURRENCY = parseInt((args.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || '4', 10);
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';

if ((USE_PROXY || AUTO_PROXY) && !SCRAPERAPI_KEY) {
  console.error('⚠️  --proxy requested but SCRAPERAPI_KEY missing. Running direct.');
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function proxyUrl(url) {
  return `http://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}`;
}

async function fetchJson(url, { useProxy = false, timeout = 15000 } = {}) {
  const target = useProxy && SCRAPERAPI_KEY ? proxyUrl(url) : url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), useProxy ? 60000 : timeout);
  try {
    const res = await fetch(target, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body };
    try { return { ok: true, status: res.status, json: JSON.parse(body) }; }
    catch (e) { return { ok: false, status: res.status, body }; }
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  } finally { clearTimeout(t); }
}

function normalizeProduct(p, brand) {
  const prices = (p.variants || [])
    .map(v => parseFloat(v.price))
    .filter(x => !isNaN(x) && x > 0 && x < 20000);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  const rawTags = Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? p.tags.split(',') : []);
  const tags = rawTags.map(t => (t || '').toString().trim()).filter(Boolean).slice(0, 20);
  const desc = (p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  const image = p.images?.[0]?.src || p.image?.src || '';
  const brandDomain = brand.brand_url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return {
    brand_name: brand.brand_name,
    brand_tier: brand.brand_tier,
    brand_category: brand.category,
    brand_country: brand.country_origin,
    brand_gender: brand.target_gender,
    id: p.id,
    handle: p.handle,
    title: (p.title || '').slice(0, 200),
    product_type: p.product_type || '',
    tags,
    price_min: priceMin,
    price_max: priceMax,
    currency: 'USD', // Shopify /products.json default; display currency varies per store
    available: (p.variants || []).some(v => v.available !== false),
    url: `https://${brandDomain}/products/${p.handle}`,
    image,
    description: desc,
    published_at: p.published_at || null,
    vendor: p.vendor || ''
  };
}

async function scrapeBrandCatalog(brand) {
  const domain = brand.brand_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const products = [];
  const MAX_PAGES = 20; // cap at 20 pages × 250 = 5000 products/brand
  let usedProxy = USE_PROXY;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${domain}/products.json?limit=250&page=${page}`;
    let r = await fetchJson(url, { useProxy: usedProxy });

    // Auto-fallback to proxy on block
    if (!r.ok && AUTO_PROXY && !usedProxy && SCRAPERAPI_KEY && (r.status === 429 || r.status === 403 || r.status === 0)) {
      usedProxy = true;
      r = await fetchJson(url, { useProxy: true });
    }

    if (!r.ok || !r.json || !Array.isArray(r.json.products)) break;
    const pageProducts = r.json.products;
    if (pageProducts.length === 0) break;
    for (const p of pageProducts) products.push(normalizeProduct(p, brand));
    if (pageProducts.length < 250) break; // last page
  }

  return products;
}

(async () => {
  if (!fs.existsSync(BRANDS_FILE)) { console.error('❌ brands_enriched.json not found.'); process.exit(1); }
  const brandsData = JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'));
  const brands = brandsData.brands.filter(b => b.platform === 'Shopify');

  console.log(`\n🛍  Product Catalog Scraper`);
  console.log(`   Shopify brands: ${brands.length}`);
  console.log(`   Mode: ${USE_PROXY ? 'proxy' : (AUTO_PROXY ? 'auto-proxy' : 'direct')}  |  Concurrency: ${CONCURRENCY}\n`);

  // Load existing cache
  let cached = {};
  if (fs.existsSync(PRODUCTS_FILE) && !FORCE) {
    try {
      const prev = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
      for (const p of prev.products || []) {
        if (!cached[p.brand_name]) cached[p.brand_name] = [];
        cached[p.brand_name].push(p);
      }
      const cachedCount = Object.keys(cached).length;
      console.log(`   ${cachedCount} brands already cached (${FORCE ? 'will re-scrape' : 'will skip'})\n`);
    } catch (e) {}
  }

  const toScrape = brands.filter(b => FORCE || !cached[b.brand_name] || cached[b.brand_name].length === 0);
  console.log(`   ${toScrape.length} brands to scrape\n`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const t0 = Date.now();
  const results = {};

  // Start with cached
  if (!FORCE) Object.assign(results, cached);

  await Promise.all(toScrape.map(b => limit(async () => {
    try {
      const products = await scrapeBrandCatalog(b);
      results[b.brand_name] = products;
      done++;
      console.log(`[${done.toString().padStart(3)}/${toScrape.length}] ${products.length.toString().padStart(4)} products — ${b.brand_name}`);
    } catch (e) {
      done++;
      console.log(`[${done.toString().padStart(3)}/${toScrape.length}]   ✗  — ${b.brand_name}: ${e.message}`);
      results[b.brand_name] = [];
    }
  })));

  // Flatten
  const flat = [];
  for (const [brand, prods] of Object.entries(results)) flat.push(...prods);

  const summary = {
    generated_at: new Date().toISOString(),
    total_brands: Object.keys(results).length,
    brands_with_products: Object.values(results).filter(a => a.length > 0).length,
    total_products: flat.length,
    avg_products_per_brand: Math.round(flat.length / (Object.values(results).filter(a => a.length > 0).length || 1)),
    top_brands_by_catalog_size: Object.entries(results)
      .map(([k, v]) => [k, v.length])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  };

  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify({ summary, products: flat }, null, 2));

  console.log(`\n✅ Done in ${Math.round((Date.now() - t0)/1000)}s`);
  console.log(`   ${summary.total_products} products across ${summary.brands_with_products} brands`);
  console.log(`   Avg ${summary.avg_products_per_brand} products/brand`);
  console.log(`   File size: ${(fs.statSync(PRODUCTS_FILE).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   → ${PRODUCTS_FILE}`);
  console.log(`\n   Top catalogs:`);
  for (const [b, n] of summary.top_brands_by_catalog_size) console.log(`     ${n.toString().padStart(4)} — ${b}`);
})();
