/**
 * Marketplace Detection (Fix v2)
 * ==========================================================
 * Step 1 — Reset all spurious "None" to "Unknown" in brands_enriched.json
 * Step 2 — For each brand, run ONE Google search via ScraperAPI and detect
 *          which marketplace domains appear in the top results.
 *          Update current_marketplace field.
 *
 * Usage:
 *   node scripts/detect_marketplaces.js              (both steps)
 *   node scripts/detect_marketplaces.js --reset-only (only step 1)
 *   node scripts/detect_marketplaces.js --search-only (only step 2)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'output', 'brands_enriched.json');
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;
const args = process.argv.slice(2);
const RESET_ONLY = args.includes('--reset-only');
const SEARCH_ONLY = args.includes('--search-only');
const CONCURRENCY = parseInt((args.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || '5', 10);

// Marketplace → domain patterns to match in Google result URLs
const MARKETPLACE_DOMAINS = {
  'Bloomingdales': ['bloomingdales.com'],
  'Nordstrom': ['nordstrom.com', 'nordstromrack.com'],
  'Galeries Lafayette': ['galerieslafayette.com'],
  'La Redoute': ['laredoute.com', 'laredoute.fr'],
  'Debenhams': ['debenhams.com'],
  'John Lewis': ['johnlewis.com'],
  'Amazon': ['amazon.com', 'amazon.co.uk', 'amazon.fr', 'amazon.de'],
  'Farfetch': ['farfetch.com'],
  'ASOS': ['asos.com'],
  'Zalando': ['zalando.com', 'zalando.fr', 'zalando.co.uk', 'zalando.de'],
  'Net-a-Porter': ['net-a-porter.com'],
  'Mytheresa': ['mytheresa.com'],
  'MatchesFashion': ['matchesfashion.com'],
  'Ssense': ['ssense.com']
};

function detectMarketplacesFromUrls(urls) {
  const found = new Set();
  for (const url of urls) {
    const u = (url || '').toLowerCase();
    for (const [name, domains] of Object.entries(MARKETPLACE_DOMAINS)) {
      if (domains.some(d => u.includes(d))) found.add(name);
    }
  }
  return [...found];
}

// Google search via ScraperAPI Structured Data endpoint
async function googleSearch(query) {
  const url = `https://api.scraperapi.com/structured/google/search?api_key=${SCRAPERAPI_KEY}&query=${encodeURIComponent(query)}&num=20`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, urls: [], status: res.status };
    const data = await res.json();
    const urls = [];
    const take = (arr) => { if (Array.isArray(arr)) for (const r of arr) if (r.link) urls.push(r.link); };
    take(data.organic_results);
    take(data.shopping_results);
    take(data.top_stories);
    return { ok: true, urls, status: res.status };
  } catch (e) {
    return { ok: false, urls: [], error: e.message };
  } finally { clearTimeout(t); }
}

(async () => {
  if (!fs.existsSync(DATA_FILE)) { console.error('❌ brands_enriched.json not found.'); process.exit(1); }
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const brands = payload.brands;

  // ---------- STEP 1: reset bogus "None" → "Unknown" ----------
  if (!SEARCH_ONLY) {
    let resetCount = 0;
    for (const b of brands) {
      if (b.current_marketplace === 'None') {
        b.current_marketplace = 'Unknown';
        resetCount++;
      }
    }
    console.log(`🧹 Step 1 — reset ${resetCount} bogus "None" → "Unknown"\n`);
  }

  if (RESET_ONLY) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
    console.log(`✅ Saved (reset only). ${DATA_FILE}`);
    return;
  }

  // ---------- STEP 2: Google search for actual marketplaces ----------
  if (!SCRAPERAPI_KEY) { console.error('❌ SCRAPERAPI_KEY missing in .env.'); process.exit(1); }

  console.log(`🔎 Step 2 — Google search via ScraperAPI for ${brands.length} brands (concurrency ${CONCURRENCY})`);
  console.log(`   Budget used: ~${brands.length} credits\n`);

  const limit = pLimit(CONCURRENCY);
  let done = 0, hits = 0;
  const t0 = Date.now();

  await Promise.all(brands.map(b => limit(async () => {
    const query = `"${b.brand_name}" buy (Nordstrom OR Bloomingdales OR Mytheresa OR Farfetch OR "Net-a-Porter" OR Ssense OR MatchesFashion OR "Galeries Lafayette" OR "John Lewis" OR Debenhams OR "La Redoute" OR Zalando OR ASOS)`;
    const r = await googleSearch(query);
    done++;
    if (r.ok) {
      const detected = detectMarketplacesFromUrls(r.urls);
      if (detected.length > 0) {
        b.current_marketplace = detected.join(', ');
        hits++;
        console.log(`[${done.toString().padStart(3)}/${brands.length}] ✓ ${b.brand_name.padEnd(30)} → ${detected.join(', ')}`);
      } else {
        // No marketplace found — leave as "Unknown" (real DTC or just no retailer presence)
        b.current_marketplace = 'Unknown';
        console.log(`[${done.toString().padStart(3)}/${brands.length}] · ${b.brand_name.padEnd(30)} (no marketplace found)`);
      }
    } else {
      console.log(`[${done.toString().padStart(3)}/${brands.length}] ✗ ${b.brand_name.padEnd(30)} search failed (${r.status || r.error})`);
    }
  })));

  // Update timestamp
  payload.summary.generated_at = new Date().toISOString();
  payload.summary.marketplace_detection_run_at = new Date().toISOString();
  payload.summary.marketplace_hits = hits;

  // Refresh marketplace distribution stat
  const mpDist = {};
  for (const b of brands) {
    const key = b.current_marketplace || 'Unknown';
    mpDist[key] = (mpDist[key] || 0) + 1;
  }
  payload.summary.distribution_marketplace = mpDist;

  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));

  console.log(`\n✅ Done in ${Math.round((Date.now() - t0)/1000)}s`);
  console.log(`   ${hits}/${brands.length} brands have at least one detected marketplace`);
  console.log(`   → ${DATA_FILE}`);
})();
