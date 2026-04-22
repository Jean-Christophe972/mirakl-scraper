/**
 * Import script: GitHub JSON → Supabase brands table
 *
 * Usage:
 *   npm install @supabase/supabase-js
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node import.js
 *
 * Ou intégration dans leur stack (Next.js API route, cron, etc.)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key (write access)
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/REPLACE_WITH_USERNAME/mirakl-scraper/main/data/brands_enriched.json';

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var');
  }

  // 1. Fetch enriched JSON from GitHub
  console.log('Fetching enriched brands from GitHub...');
  const res = await fetch(GITHUB_RAW_URL);
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  const { summary, brands } = await res.json();
  console.log(`Got ${brands.length} brands. Run timestamp: ${summary.generated_at}`);

  // 2. Upsert into Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log('Upserting into Supabase (conflict on brand_name)...');
  const { data, error } = await supabase
    .from('brands')
    .upsert(brands, { onConflict: 'brand_name' })
    .select();

  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }

  console.log(`✅ Successfully upserted ${data.length} brands.`);
  console.log('Distribution:', summary.distribution_tier);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
