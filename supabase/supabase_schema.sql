-- ============================================================
-- Mirakl BDR — Supabase Schema (one-time setup)
-- Run ONCE in Supabase → SQL Editor → New query → Run
-- ============================================================
-- After this, n8n will populate the tables via upserts from
-- the GitHub raw JSON files. No need to re-run this script.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS brands CASCADE;

-- ---------- brands ----------
CREATE TABLE brands (
  brand_name              TEXT PRIMARY KEY,
  brand_url               TEXT,
  contact_email           TEXT,
  wholesale_contact_email TEXT,
  country_origin          TEXT,
  brand_tier              TEXT,         -- luxury | premium | accessible-premium | unknown
  category                TEXT,
  brand_size              TEXT,         -- small | medium | large
  target_gender           TEXT,         -- women | men | unisex | children
  platform                TEXT,         -- Shopify | Magento | Custom | ...
  price_avg_usd           NUMERIC,
  ships_international     BOOLEAN,
  brand_story_summary     TEXT,
  key_aesthetic           TEXT,
  current_marketplace     TEXT,
  product_types_list      TEXT,
  top_product_tags        TEXT,
  product_sample          TEXT,
  enriched_at             TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_brands_tier     ON brands(brand_tier);
CREATE INDEX idx_brands_category ON brands(category);
CREATE INDEX idx_brands_platform ON brands(platform);
CREATE INDEX idx_brands_country  ON brands(country_origin);

-- ---------- products ----------
CREATE TABLE products (
  id            BIGSERIAL PRIMARY KEY,
  brand_name    TEXT NOT NULL REFERENCES brands(brand_name) ON DELETE CASCADE,
  product_id    BIGINT NOT NULL,          -- Shopify internal ID
  handle        TEXT,
  title         TEXT,
  product_type  TEXT,
  tags          TEXT[],
  price_min     NUMERIC,
  price_max     NUMERIC,
  currency      TEXT DEFAULT 'USD',
  available     BOOLEAN,
  url           TEXT,
  vendor        TEXT,
  published_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  -- Composite unique key → enables UPSERT from n8n
  UNIQUE(brand_name, product_id)
);

CREATE INDEX idx_products_brand     ON products(brand_name);
CREATE INDEX idx_products_type      ON products(product_type);
CREATE INDEX idx_products_available ON products(available);
CREATE INDEX idx_products_price     ON products(price_min);

-- ---------- auto-update updated_at ----------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER brands_touch_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER products_touch_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;

-- ✅ Schema ready. n8n can now upsert into brands (match: brand_name)
--    and products (match: brand_name + product_id).
