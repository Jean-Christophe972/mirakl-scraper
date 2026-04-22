-- =====================================================
-- Mirakl Brand Enrichment DB — Supabase Schema
-- Aligned 1:1 with n8n enrichment output (19 columns)
-- =====================================================

-- Run this in Supabase SQL Editor to create the table

CREATE TABLE IF NOT EXISTS brands (
  -- === IDENTITÉ (2) ===
  brand_name                TEXT PRIMARY KEY,
  brand_url                 TEXT NOT NULL,

  -- === CONTACT (2) ===
  contact_email             TEXT DEFAULT '',
  wholesale_contact_email   TEXT DEFAULT '',

  -- === PROFIL (5) ===
  country_origin            TEXT DEFAULT 'Unknown',      -- ISO2 or 'Unknown'
  brand_tier                TEXT DEFAULT 'unknown',      -- luxury | premium | accessible-premium | mid-market | unknown
  category                  TEXT DEFAULT 'unknown',      -- 17 enum values (see CHECK below)
  brand_size                TEXT DEFAULT 'unknown',      -- Indie | small | mid | large | Global | unknown
  target_gender             TEXT DEFAULT 'unknown',      -- women | men | unisex | unknown

  -- === COMMERCE (5) ===
  platform                  TEXT DEFAULT 'Unknown',
  price_avg_usd             INTEGER DEFAULT 0,
  ships_international       BOOLEAN DEFAULT FALSE,
  brand_story_summary       TEXT DEFAULT '',
  key_aesthetic             TEXT DEFAULT '',

  -- === MATCHING (1) ===
  current_marketplace       TEXT DEFAULT 'Unknown',      -- comma-separated list, 'None', or 'Unknown'

  -- === PRODUITS (3) ===
  product_types_list        TEXT DEFAULT '',
  top_product_tags          TEXT DEFAULT '',
  product_sample            TEXT DEFAULT '',

  -- === META (1) ===
  enriched_at               TIMESTAMPTZ DEFAULT NOW(),

  -- === Enum CHECK constraints (safety net) ===
  CONSTRAINT brand_tier_valid   CHECK (brand_tier IN ('luxury','premium','accessible-premium','mid-market','unknown')),
  CONSTRAINT brand_size_valid   CHECK (brand_size IN ('Indie','small','mid','large','Global','unknown')),
  CONSTRAINT target_gender_valid CHECK (target_gender IN ('women','men','unisex','unknown')),
  CONSTRAINT category_valid     CHECK (category IN (
    'Ready-to-wear','Womenswear','Menswear',
    'Accessories','Bags & Handbags','Footwear','Jewelry','Eyewear','Headwear',
    'Swimwear & Beachwear','Activewear','Lingerie','Outerwear',
    'Home & Lifestyle','Beauty','Multi-category','unknown'
  ))
);

-- Index for common BDR queries
CREATE INDEX IF NOT EXISTS idx_brands_tier     ON brands(brand_tier);
CREATE INDEX IF NOT EXISTS idx_brands_category ON brands(category);
CREATE INDEX IF NOT EXISTS idx_brands_country  ON brands(country_origin);
CREATE INDEX IF NOT EXISTS idx_brands_platform ON brands(platform);

-- =====================================================
-- UPSERT pattern (for n8n → Supabase)
-- Use this in n8n's Supabase node (Operation: Upsert, Conflict: brand_name)
-- =====================================================

-- Example manual upsert:
-- INSERT INTO brands (brand_name, brand_url, category, brand_tier, ...)
-- VALUES ('Ulla Johnson', 'https://ullajohnson.com', 'Womenswear', 'luxury', ...)
-- ON CONFLICT (brand_name) DO UPDATE SET
--   brand_url = EXCLUDED.brand_url,
--   category = EXCLUDED.category,
--   brand_tier = EXCLUDED.brand_tier,
--   enriched_at = EXCLUDED.enriched_at;

-- =====================================================
-- Row Level Security (optionnel, si accès via frontend public)
-- =====================================================
-- ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Read all brands" ON brands FOR SELECT USING (true);
