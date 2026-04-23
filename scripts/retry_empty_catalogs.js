/**
 * Retry product scrape for Shopify brands with empty catalogs.
 * Forces --proxy mode via ScraperAPI to bypass Cloudflare/rate-limit blocks.
 *
 * Usage: node scripts/retry_empty_catalogs.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BRANDS_FILE = path.join(ROOT, 'data', 'output', 'brands_enriched.json');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'output', 'products_catalog.json');
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;

if (!SCRAPERAPI_KEY) { console.error('❌ SCRAPERAPI_KEY missing in .env'); process.exit(1); }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function proxyUrl(url) {
  return `http://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}`;
}

async function fetchJsonProxy(url, timeout = 75000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(proxyUrl(url), { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body };
    try { return { ok: true, status: res.status, json: JSON.parse(body) }; }
    catch (e) { return { ok: false, status: res.status, body }; }
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  } finally { clearTimeout(t); }
}

function normalizeProduct(p, brand) {
  const prices = (p.variants || []).map(v => parseFloat(v.price)).filter(x => !isNaN(x) && x > 0 && x < 20000);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  const rawTags = Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? p.tags.split(',') : []);
  const tags = rawTags.map(t => (t || '').toString().trim()).filter(Boolean).slice(0, 20);
  const desc = (p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  const image = p.images?.[0]?.src || p.image?.src || '';
  const brandDomain = brand.brand_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    brand_name: brand.brand_name, brand_tier: brand.brand_tier, brand_category: brand.category,
    brand_country: brand.country_origin, brand_gender: brand.target_gender,
    id: p.id, handle: p.handle, title: (p.title || '').slice(0, 200),
    product_type: p.product_type || '', tags, price_min: priceMin, price_max: priceMax,
    currency: 'USD', available: (p.variants || []).some(v => v.available !== false),
    url: `https://${brandDomain}/products/${p.handle}`, image, description: desc,
    published_at: p.published_at || null, vendor: p.vendor || ''
  };
}

async function scrapeBrand(brand) {
  const domain = brand.brand_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const products = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetchJsonProxy(`https://${domain}/products.json?limit=250&page=${page}`);
    if (!r.ok || !r.json || !Array.isArray(r.json.products)) break;
    const pp = r.json.products;
    if (pp.length === 0) break;
    for (const p of pp) products.push(normalizeProduct(p, brand));
    if (pp.length < 250) break;
  }
  return products;
}

(async () => {
  const brandsData = JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  const brandsWithProducts = new Set(catalog.products.map(p => p.brand_name));
  const targets = brandsData.brands.filter(b => b.platform === 'Shopify' && !brandsWithProducts.has(b.brand_name));

  console.log(`🔁 Retry ${targets.length} empty-catalog Shopify brands via proxy (forced)`);
  console.log(`   Estimated budget: ~${targets.length * 3} ScraperAPI credits\n`);

  const pLimit = require('p-limit');
  const limit = pLimit(3);
  let done = 0, totalNew = 0;
  const t0 = Date.now();
  const results = [];

  await Promise.all(targets.map(b => limit(async () => {
    try {
      const prods = await scrapeBrand(b);
      done++;
      totalNew += prods.length;
      results.push({ brand: b, products: prods });
      console.log(`[${done.toString().padStart(3)}/${targets.length}] ${prods.length.toString().padStart(4)} products — ${b.brand_name}`);
    } catch (e) {
      done++;
      console.log(`[${done.toString().padStart(3)}/${targets.length}]   ✗  — ${b.brand_name}: ${e.message}`);
    }
  })));

  // Merge back into catalog
  let newProducts = 0;
  for (const r of results) {
    if (r.products.length === 0) continue;
    catalog.products.push(...r.products);
    newProducts += r.products.length;
  }

  // Refresh summary
  const brandsStillWithProducts = new Set(catalog.products.map(p => p.brand_name));
  catalog.summary = {
    generated_at: new Date().toISOString(),
    total_brands: catalog.summary.total_brands + 0, // unchanged — we don't add new brands here
    brands_with_products: brandsStillWithProducts.size,
    total_products: catalog.products.length,
    avg_products_per_brand: Math.round(catalog.products.length / brandsStillWithProducts.size)
  };

  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(catalog, null, 2));

  console.log(`\n✅ Done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   Recovered ${newProducts} products from ${results.filter(r => r.products.length > 0).length} brands`);
  console.log(`   Catalog now: ${catalog.summary.total_products} products across ${catalog.summary.brands_with_products} brands`);
})();
