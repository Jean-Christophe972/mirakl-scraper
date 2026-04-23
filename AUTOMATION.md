# Automation — GitHub Actions + n8n + Supabase

End-to-end pipeline so the Mirakl BDR dataset stays fresh without manual work.

```
┌──────────────────┐   push CSV or     ┌──────────────────┐
│ data/input/      │ ───── cron ─────▶ │ GitHub Actions   │
│   batches/*.csv  │                   │ enrich.yml       │
└──────────────────┘                   └────────┬─────────┘
                                                │ commits
                                                ▼
                                       ┌──────────────────┐
                                       │  GitHub repo     │
                                       │  brands + prods  │
                                       └────────┬─────────┘
                                                │ HTTP GET
                                                ▼
                                       ┌──────────────────┐
                                       │  n8n workflow    │
                                       │  (weekly cron)   │
                                       └────────┬─────────┘
                                                │ upsert
                                                ▼
                                       ┌──────────────────┐
                                       │    Supabase      │
                                       │ brands, products │
                                       └──────────────────┘
```

---

## 🚀 Setup — one-time (15 min total)

### 1. Supabase — run the schema (your teammate, 1 min)

1. Open Supabase dashboard → **SQL Editor** → **New query**
2. Paste the content of [`supabase/supabase_schema.sql`](./supabase/supabase_schema.sql)
3. Click **Run**

Done — tables `brands` + `products` exist with indexes and upsert keys.

### 2. GitHub — add secrets (you, 2 min)

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Where to get it |
|---|---|
| `OPENAI_API_KEY` | platform.openai.com → API Keys |
| `SCRAPERAPI_KEY` | dashboard.scraperapi.com (use key #2, fresh credits) |
| `N8N_WEBHOOK_URL` *(optional)* | n8n workflow → add a Webhook trigger, paste production URL |

### 3. n8n — import the workflow (you, 5 min)

1. In n8n: **Workflows** → **Import from File** → pick [`n8n/mirakl_sync_workflow.json`](./n8n/mirakl_sync_workflow.json)
2. Create Supabase credentials: **Credentials** → **New** → **Supabase API**
   - Host: `https://[your-project-ref].supabase.co`
   - Service role key (Supabase → Project Settings → API → `service_role` key)
3. Open both `Supabase — Upsert ...` nodes → select your new credential
4. Click **Execute Workflow** (manual trigger) to test
5. Once it works, activate the schedule trigger (toggle top-right)

---

## 🔄 How to add new brands

1. Drop a CSV in `data/input/batches/` with headers: `brand_name,brand_url,country_origin` (at minimum)
2. Push to GitHub
3. GitHub Action runs automatically → enriches → commits back the JSON
4. At the next cron tick (Monday 8am), n8n picks up the changes and upserts Supabase
5. → You can also trigger n8n manually anytime for instant sync

## 🔁 How the refresh cycle works

- **Monday 6am UTC**: GitHub Action runs (cron) → refreshes product catalogs (prices, new products, discontinued items)
- **Monday 8am UTC**: n8n runs (cron) → syncs GitHub → Supabase
- Only changed rows are touched thanks to `updated_at` triggers + upsert matching

## 💰 Cost per run

| Service | Cost per weekly run |
|---|---|
| GitHub Actions | Free (under 2000 min/month for public repos) |
| OpenAI (new brands only) | ~$0.01 per brand enriched |
| ScraperAPI | ~3 credits per brand (5k/month free tier) |
| n8n | Free tier handles this volume |
| Supabase | Free tier covers 500MB DB |

**Total: ~$0 if you don't add huge batches.**

## 🐛 Troubleshooting

**Supabase upsert fails with "column X not found"**
→ You tweaked the JSON shape. Re-run `supabase_schema.sql` to resync columns.

**n8n workflow times out on products loop**
→ Increase node timeout in workflow settings, or reduce `Split In Batches` size to 1.

**GitHub Action fails with "rate limited"**
→ Your ScraperAPI credits are out. Check dashboard.scraperapi.com.
