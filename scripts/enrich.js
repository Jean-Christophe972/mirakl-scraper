/**
 * Mirakl Brand Enrichment — Node script
 * ==========================================================
 * Reproduit la logique n8n en local, sans timeout.
 * Input  : CSV avec colonnes `brand_name,brand_url`
 * Output : data/output/brands_enriched.json (19 colonnes par marque)
 *
 * Usage:
 *   npm install
 *   cp .env.example .env   (et colle ta clé OPENAI_API_KEY)
 *   node scripts/enrich.js data/input/mirakl_116.csv
 *   node scripts/enrich.js data/input/prospects_batch2.csv   (incrémental)
 *
 * Flags:
 *   --force           Re-enrichit toutes les marques (ignore le cache)
 *   --concurrency=10  Nombre de marques enrichies en parallèle (défaut 8)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

// -------- CLI --------
const args = process.argv.slice(2);
const inputCsv = args.find(a => !a.startsWith('--')) || 'data/input/mirakl_116.csv';
const FORCE = args.includes('--force');
const CONCURRENCY = parseInt((args.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || '4', 10);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error('❌ Missing OPENAI_API_KEY in .env'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'data', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'brands_enriched.json');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ScraperAPI integration — set SCRAPERAPI_KEY in .env, then pass --proxy flag to route through proxy
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';
const USE_PROXY = args.includes('--proxy') && !!SCRAPERAPI_KEY;
if (args.includes('--proxy') && !SCRAPERAPI_KEY) {
  console.error('⚠️  --proxy flag set but SCRAPERAPI_KEY missing in .env. Running without proxy.');
}
if (USE_PROXY) console.log('🛡️  Proxy mode ON (ScraperAPI) — Cloudflare bypass enabled.');

function wrapProxy(url) {
  if (!USE_PROXY) return url;
  return `http://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}`;
}

// -------- Utils --------
async function fetchOnce(url, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(wrapProxy(url), {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
      redirect: 'follow'
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) { return { ok: false, status: 0, body: '', error: e.message }; }
  finally { clearTimeout(t); }
}

// Retry on 429/5xx with exponential backoff + jitter (6 attempts, up to ~2 min total)
async function fetchText(url, timeout = 12000) {
  // With proxy, ScraperAPI handles retries internally — shorter wait and fewer attempts
  const waits = USE_PROXY ? [1000, 2000, 4000] : [2000, 5000, 10000, 20000, 40000, 60000];
  // Proxy calls take longer (ScraperAPI waits for response) — bump timeout
  if (USE_PROXY) timeout = Math.max(timeout, 60000);
  for (let attempt = 0; attempt < waits.length; attempt++) {
    const r = await fetchOnce(url, timeout);
    if (r.ok) return r;
    if (r.status === 429 || r.status >= 500 || r.status === 0) {
      await new Promise(res => setTimeout(res, waits[attempt] + Math.random() * 1500));
      continue;
    }
    return r; // 403/404 etc. — give up
  }
  return { ok: false, status: 0, body: '' };
}

function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').trim();
  const [headerLine, ...lines] = txt.split(/\r?\n/);
  const headers = headerLine.split(',').map(h => h.trim());
  return lines.filter(Boolean).map(line => {
    // naive CSV (no embedded commas in our brand names — already sanitized)
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => row[h] = (cells[i] || '').trim());
    return row;
  });
}

// -------- Step 1: Parse homepage --------
function parseHomepage(html, brand) {
  const ok = html.length > 500;
  const lc = html.toLowerCase();
  let platform = 'Unknown';
  if (lc.includes('cdn.shopify.com') || lc.includes('shopify.theme') || lc.includes('myshopify.com')) platform = 'Shopify';
  else if (lc.includes('/skin/frontend/') || lc.includes('mage.cookies') || lc.includes('magento')) platform = 'Magento';
  else if (lc.includes('wp-content/plugins/woocommerce') || lc.includes('woocommerce')) platform = 'WooCommerce';
  else if (lc.includes('bigcommerce.com')) platform = 'BigCommerce';
  else if (lc.includes('squarespace.com')) platform = 'Squarespace';
  else if (lc.includes('salesforce') && lc.includes('commerce')) platform = 'Salesforce Commerce';
  else if (lc.includes('centra.com') || lc.includes('.centra.')) platform = 'Centra';
  else if (ok) platform = 'Custom';

  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
  const metaDesc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
  const ogDesc = (html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';

  const currencies = [];
  if (/(?:\$|USD)/.test(html)) currencies.push('USD');
  if (/(?:€|EUR)/.test(html)) currencies.push('EUR');
  if (/(?:£|GBP)/.test(html)) currencies.push('GBP');
  if (/(?:¥|JPY)/.test(html)) currencies.push('JPY');
  if (/\bA\$|AUD/.test(html)) currencies.push('AUD');
  if (/\bCA\$|CAD/.test(html)) currencies.push('CAD');

  let contact_email = '';
  const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  for (const e of emails) {
    const el = e.toLowerCase();
    if (!el.includes('sentry') && !el.includes('example.com') && !el.includes('@2x') && !el.match(/\.(png|jpg|jpeg|gif|svg|webp)$/)) {
      contact_email = e; break;
    }
  }

  const ships_international = /international\s*shipping|worldwide\s*shipping|ships?\s*worldwide|ships\s*internationally/i.test(html);

  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    brand_name: brand.brand_name,
    brand_url: brand.brand_url,
    fetch_ok: ok,
    platform_detected: platform,
    page_title: title.replace(/\s+/g, ' ').trim().slice(0, 200),
    meta_description: (metaDesc || ogDesc).slice(0, 300),
    currencies_on_site: currencies.join(','),
    contact_email,
    ships_international,
    text_excerpt: text.slice(0, 2500)
  };
}

// -------- Step 2: Shopify catalog --------
function parseCatalog(body) {
  let resp = {};
  try { if (body && body.trim().startsWith('{')) resp = JSON.parse(body); } catch (e) {}
  const products = (resp && Array.isArray(resp.products)) ? resp.products : [];
  let prices = [], titles = [];
  const types = new Map(), tagCounts = new Map();

  for (const p of products) {
    titles.push(p.title);
    if (p.product_type) types.set(p.product_type, (types.get(p.product_type) || 0) + 1);
    const tagArr = Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? p.tags.split(',') : []);
    for (const t of tagArr) {
      const tag = (t || '').toString().trim();
      if (tag && tag.length < 40) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    if (p.variants) for (const v of p.variants) {
      const price = parseFloat(v.price);
      if (!isNaN(price) && price > 0 && price < 20000) prices.push(price);
    }
  }

  const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  const typesSorted = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => `${t} (${c})`);
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);

  return {
    catalog_scraped: products.length > 0,
    price_avg_usd_real: avg,
    product_types_list: typesSorted.join(' | '),
    top_product_tags: topTags.join(', '),
    product_sample: titles.slice(0, 8).join(' | ')
  };
}

// -------- Step 3: Wholesale scrape --------
const WHOLESALE_PATHS = ['/wholesale', '/pages/wholesale', '/b2b', '/pages/b2b', '/for-retailers', '/trade', '/wholesale-inquiries'];
async function findWholesaleEmail(brandUrl) {
  for (const p of WHOLESALE_PATHS) {
    const r = await fetchText(`https://${brandUrl}${p}`, 7000);
    if (r.ok && r.body.length > 500) {
      const lc = r.body.toLowerCase();
      if (/wholesale|minimum order|moq|trade account|b2b|retail partner|wholesale inquir/.test(lc)) {
        const emails = (r.body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
          .filter(e => {
            const el = e.toLowerCase();
            return !el.match(/\.(png|jpg|jpeg|gif|svg|webp)$/) && !el.includes('sentry') && !el.includes('example.com') && !el.includes('@2x');
          });
        return emails.find(e => /wholesale|trade|b2b|sales|partner|orders/i.test(e)) || emails[0] || '';
      }
    }
  }
  return '';
}

// -------- Step 4: GPT classify --------
function buildGptPrompt(d) {
  const catalogBlock = d.catalog_scraped
    ? `=== CATALOG (Shopify API, factual) ===\nAverage price USD (placeholders filtered): ${d.price_avg_usd_real}\nProduct types with counts (dominant first): ${d.product_types_list}\nTop product tags: ${d.top_product_tags}\nProduct samples: ${d.product_sample}`
    : `=== CATALOG === Not available.`;

  return `Extract factual brand classification from the REAL scraped content below. DO NOT invent. Respect EXACT enum values.

=== BRAND ===
Name: ${d.brand_name}
URL: https://${d.brand_url}
Page title: ${d.page_title}
Meta description: ${d.meta_description}
Currencies on site: ${d.currencies_on_site}
Ships international claim: ${d.ships_international}

${catalogBlock}

=== HOMEPAGE TEXT EXCERPT ===
${(d.text_excerpt || '').slice(0, 2000)}

=== STRICT RULES ===

1. country_origin — 2-letter ISO code (US, FR, IT, AU, GB, ES, SE, DE, JP, PT, NL, CH, DK, BE, etc.). Infer ONLY from explicit markers (HQ/address, TLD .fr/.it/.es/.co.uk/.com.au/.jp, "Made in X", "based in X"). Else "Unknown".

2. brand_tier (exact values): luxury | premium | accessible-premium | mid-market | unknown.
   Rule by avg price USD: luxury >$800 | premium $300-$800 | accessible-premium $100-$300 | mid-market <$100.
   If no price data, infer from copy tone + product types.

3. category (exact values, SINGLE dominant):
   Womenswear (apparel femme only) | Menswear (apparel homme only) | Ready-to-wear (apparel unisex/mixed)
   Accessories | Bags & Handbags | Footwear | Jewelry | Eyewear | Headwear
   Swimwear & Beachwear | Activewear | Lingerie | Outerwear
   Home & Lifestyle | Beauty | Multi-category | unknown
   Multi-category ONLY if NO single category >40% AND 3+ co-dominant.

4. brand_size (exact): Indie (<50 SKUs, DTC) | small (50-150) | mid (150-400) | large (400-1000) | Global (>1000 or massive retail) | unknown.

5. target_gender: women | men | unisex | unknown. unisex ONLY if explicit.

6. current_marketplace — STRICT. Array of marketplaces LITERALLY mentioned in text (e.g. "stocked at Nordstrom"). Valid values ONLY: Bloomingdales, Nordstrom, Galeries Lafayette, La Redoute, Debenhams, John Lewis, Amazon, Farfetch, ASOS, Zalando, Net-a-Porter, Mytheresa, MatchesFashion, Ssense.
   - If DTC-only explicitly claimed → ["None"]
   - If none mentioned → ["Unknown"]

7. brand_story_summary — ONE factual sentence from homepage. "" if nothing usable.

8. key_aesthetic — 2-3 keywords (e.g. "minimalist, contemporary"). "" if unclear.

=== RETURN JSON ===
{
  "country_origin": "ISO2 or Unknown",
  "brand_tier": "...",
  "category": "...",
  "brand_size": "...",
  "target_gender": "...",
  "current_marketplace": ["..."],
  "brand_story_summary": "",
  "key_aesthetic": ""
}

Return ONLY valid JSON. No markdown.`;
}

async function gptClassify(d) {
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a strict fashion brand data classifier for a BDR prospection DB. Use ONLY the provided scraped content. Respect EXACT enum strings. Never invent. Return valid JSON only.' },
      { role: 'user', content: buildGptPrompt(d) }
    ]
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify(body)
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const json = await res.json();
      const raw = json.choices?.[0]?.message?.content || '{}';
      return JSON.parse(raw);
    } catch (e) {
      if (attempt === 2) { console.error(`  ⚠️  GPT fail for ${d.brand_name}:`, e.message); return {}; }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return {};
}

// -------- Step 5: Consolidate (19 cols) --------
const TIER = ['luxury', 'premium', 'accessible-premium', 'mid-market'];
const CAT = ['Ready-to-wear', 'Womenswear', 'Menswear', 'Accessories', 'Bags & Handbags', 'Footwear', 'Jewelry', 'Eyewear', 'Headwear', 'Swimwear & Beachwear', 'Activewear', 'Lingerie', 'Outerwear', 'Home & Lifestyle', 'Beauty', 'Multi-category'];
const SIZE = ['Indie', 'small', 'mid', 'large', 'Global'];
const GEN = ['women', 'men', 'unisex'];
const MARKETPLACES = ['Bloomingdales', 'Nordstrom', 'Galeries Lafayette', 'La Redoute', 'Debenhams', 'John Lewis', 'Amazon', 'Farfetch', 'ASOS', 'Zalando', 'Net-a-Porter', 'Mytheresa', 'MatchesFashion', 'Ssense'];
const pickEnum = (x, a, f) => a.includes(x) ? x : f;

function consolidate(scraped, g, wholesaleEmail) {
  const rawCountry = (g.country_origin || '').toString().toUpperCase().trim();
  const country_origin = (rawCountry && rawCountry !== 'UNKNOWN' && /^[A-Z]{2}$/.test(rawCountry)) ? rawCountry : 'Unknown';

  let mp = Array.isArray(g.current_marketplace) ? g.current_marketplace : (typeof g.current_marketplace === 'string' ? g.current_marketplace.split(',').map(x => x.trim()) : []);
  mp = mp.map(m => m.toString().trim()).filter(Boolean);
  if (mp.includes('None')) mp = ['None'];
  else {
    const ok = mp.filter(m => MARKETPLACES.includes(m));
    mp = ok.length ? ok : ['Unknown'];
  }

  return {
    brand_name: scraped.brand_name,
    brand_url: `https://${scraped.brand_url}`,
    contact_email: scraped.contact_email || '',
    wholesale_contact_email: wholesaleEmail || '',
    country_origin,
    brand_tier: pickEnum(g.brand_tier, TIER, 'unknown'),
    category: pickEnum(g.category, CAT, 'unknown'),
    brand_size: pickEnum(g.brand_size, SIZE, 'unknown'),
    target_gender: pickEnum(g.target_gender, GEN, 'unknown'),
    platform: scraped.platform_detected,
    price_avg_usd: scraped.price_avg_usd_real || 0,
    ships_international: scraped.ships_international === true,
    brand_story_summary: (g.brand_story_summary || '').toString().slice(0, 300),
    key_aesthetic: (g.key_aesthetic || '').toString().slice(0, 100),
    current_marketplace: mp.join(', '),
    product_types_list: scraped.product_types_list || '',
    top_product_tags: scraped.top_product_tags || '',
    product_sample: scraped.product_sample || '',
    enriched_at: new Date().toISOString()
  };
}

// -------- Pipeline per brand --------
async function enrichBrand(brand) {
  const url = `https://${brand.brand_url}`;
  const home = await fetchText(url, 12000);
  if (!home.ok || home.body.length < 500) {
    return consolidate({ brand_name: brand.brand_name, brand_url: brand.brand_url, platform_detected: 'Unknown', text_excerpt: '', page_title: '', meta_description: '', currencies_on_site: '', contact_email: '', ships_international: false, catalog_scraped: false, price_avg_usd_real: 0 }, {}, '');
  }

  const scraped = parseHomepage(home.body, brand);

  // Shopify catalog (best effort)
  let catalog = { catalog_scraped: false, price_avg_usd_real: 0, product_types_list: '', top_product_tags: '', product_sample: '' };
  if (scraped.platform_detected === 'Shopify') {
    const cat = await fetchText(`https://${brand.brand_url}/products.json?limit=250`, 12000);
    if (cat.ok) catalog = parseCatalog(cat.body);
  }
  Object.assign(scraped, catalog);

  // Wholesale (parallel with GPT would be nice — but cheap enough sequential)
  const [wholesaleEmail, gptResult] = await Promise.all([
    findWholesaleEmail(brand.brand_url).catch(() => ''),
    gptClassify(scraped)
  ]);

  return consolidate(scraped, gptResult, wholesaleEmail);
}

// -------- Main --------
(async () => {
  console.log(`\n🚀 Mirakl Brand Enrichment`);
  console.log(`   Input: ${inputCsv}`);
  console.log(`   Concurrency: ${CONCURRENCY}  |  Force re-enrich: ${FORCE}\n`);

  const inputPath = path.isAbsolute(inputCsv) ? inputCsv : path.join(ROOT, inputCsv);
  if (!fs.existsSync(inputPath)) { console.error(`❌ Input not found: ${inputPath}`); process.exit(1); }
  const brands = readCsv(inputPath);
  console.log(`   ${brands.length} brands in input.`);

  // Load existing output (incremental mode)
  let existing = [];
  if (fs.existsSync(OUTPUT_FILE) && !FORCE) {
    try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')).brands || []; } catch (e) {}
  }
  const existingMap = new Map(existing.map(b => [b.brand_name, b]));
  // Consider a brand "failed" if platform is Unknown (homepage fetch failed) — retry those automatically
  const isFailed = b => b && b.platform === 'Unknown';
  const toEnrich = FORCE
    ? brands
    : brands.filter(b => !existingMap.has(b.brand_name) || isFailed(existingMap.get(b.brand_name)));
  const retryCount = toEnrich.filter(b => isFailed(existingMap.get(b.brand_name))).length;
  console.log(`   ${toEnrich.length} to enrich  (${brands.length - toEnrich.length} already OK, ${retryCount} retry of previous failures)\n`);

  if (toEnrich.length === 0) { console.log('✅ Nothing to do.'); return; }

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const t0 = Date.now();

  // Incremental merged state — saved to disk after EVERY brand so we never lose progress
  const merged = new Map(existingMap);

  function saveProgress() {
    const arr = [...merged.values()];
    const dist = (key) => arr.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
    const payload = {
      summary: {
        generated_at: new Date().toISOString(),
        total: arr.length,
        distribution_tier: dist('brand_tier'),
        distribution_category: dist('category'),
        distribution_platform: dist('platform'),
        distribution_country: dist('country_origin')
      },
      brands: arr
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
  }

  const results = await Promise.all(toEnrich.map(b => limit(async () => {
    let row;
    try {
      row = await enrichBrand(b);
    } catch (e) {
      row = consolidate({ brand_name: b.brand_name, brand_url: b.brand_url, platform_detected: 'Unknown', text_excerpt: '', page_title: '', meta_description: '', currencies_on_site: '', contact_email: '', ships_international: false, catalog_scraped: false, price_avg_usd_real: 0 }, {}, '');
    }
    done++;
    merged.set(row.brand_name, row);
    saveProgress(); // persist after each brand
    console.log(`[${done.toString().padStart(3, ' ')}/${toEnrich.length}] ${row.platform === 'Unknown' ? '✗' : '✓'} ${b.brand_name.padEnd(30)} ${row.brand_tier.padEnd(20)} ${row.category}`);
    return row;
  })));

  const finalArr = [...merged.values()];

  // Summary stats
  const dist = (key) => finalArr.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
  const payload = {
    summary: {
      generated_at: new Date().toISOString(),
      total: finalArr.length,
      enriched_this_run: results.length,
      duration_seconds: Math.round((Date.now() - t0) / 1000),
      distribution_tier: dist('brand_tier'),
      distribution_category: dist('category'),
      distribution_platform: dist('platform'),
      distribution_country: dist('country_origin')
    },
    brands: finalArr
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Done in ${payload.summary.duration_seconds}s`);
  console.log(`   → ${OUTPUT_FILE}`);
  console.log(`   Total brands in DB: ${finalArr.length}`);
  console.log(`   Tier distribution :`, payload.summary.distribution_tier);
  console.log(`   Category top 5    :`, Object.entries(payload.summary.distribution_category).sort((a, b) => b[1] - a[1]).slice(0, 5));
})();
