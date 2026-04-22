# Mirakl Brand Enrichment — Data Dictionary (v2)

Base de données enrichie pour UC2 (BDR Outreach). **19 colonnes**, une ligne par marque.
Enums alignés sur les dropdowns G Sheet de l'équipe (case et orthographe exactes).
Sources = scraping réel (site + catalogue Shopify) + classification GPT-4o-mini sur contenu scrapé (anti-hallucination, temperature 0).

---

## 📛 IDENTITÉ (2)

### `brand_name` · string
Nom commercial tel qu'il apparaît sur l'Excel d'entrée. **Ex :** `"Ulla Johnson"`

### `brand_url` · string (URL)
URL canonique du site officiel, préfixée `https://`. **Ex :** `"https://ullajohnson.com"`

---

## 📧 CONTACT (2)

### `contact_email` · string | `""`
Premier email de contact trouvé sur la homepage (regex filtré — exclusion sentry / exemple / images). Vide si aucun email exposé publiquement.
**Usage BDR :** fallback si pas de contact wholesale. **Ex :** `"orders@ullajohnson.com"`

### `wholesale_contact_email` · string | `""`
Email B2B extrait de la page `/wholesale`, `/b2b`, `/trade`, `/for-retailers` (7 variantes testées). Priorisation `wholesale@`, `trade@`, `b2b@`, `sales@`, `partner@`.
**Usage BDR :** **canal prioritaire pour le cold outreach Mirakl** — ces emails appartiennent à des décideurs distribution.

---

## 🏷️ PROFIL (5)

### `country_origin` · ISO 2 lettres | `"Unknown"`
Pays d'origine / siège. GPT extrait depuis adresse HQ, TLD (.fr, .it, .co.uk…), "Made in X", "based in X".
**Usage BDR :** matching marketplace géographique (UK → John Lewis/Debenhams ; FR → Galeries Lafayette/La Redoute).

### `brand_tier` · enum
**Valeurs :** `luxury` | `premium` | `accessible-premium` | `mid-market` | `unknown`
**Logique (basée sur prix moyen réel) :**
- `luxury` — avg >$800
- `premium` — $300–$800
- `accessible-premium` — $100–$300
- `mid-market` — <$100

**Usage BDR :** filtre positionnement vs clientèle marketplace (Nordstrom = luxury/premium ; La Redoute = accessible-premium/mid-market).

### `category` · enum (17 valeurs) ⚠️
**Valeurs exactes (dropdown team) :**
`Ready-to-wear` | `Womenswear` | `Menswear` | `Accessories` | `Bags & Handbags` | `Footwear` | `Jewelry` | `Eyewear` | `Headwear` | `Swimwear & Beachwear` | `Activewear` | `Lingerie` | `Outerwear` | `Home & Lifestyle` | `Beauty` | `Multi-category` | `unknown`

**Règles de décision (strictes) :**
- Apparel EXCLUSIVEMENT femme → `Womenswear`
- Apparel EXCLUSIVEMENT homme → `Menswear`
- Apparel unisex / mixte → `Ready-to-wear`
- Non-apparel spécialisé → pick the matching category (Jewelry, Eyewear, Bags & Handbags…)
- `Multi-category` UNIQUEMENT si aucune catégorie >40% ET 3+ catégories co-dominantes

### `brand_size` · enum (5 valeurs)
**Valeurs :** `Indie` | `small` | `mid` | `large` | `Global` | `unknown`
- `Indie` — designer/créateur indé, <50 SKUs, DTC pur, emerging
- `small` — petite marque établie, 50–150 SKUs
- `mid` — marque établie, 150–400 SKUs, distribution claire
- `large` — catalogue large, 400–1000 SKUs, fort réseau retail
- `Global` — marque mondiale, >1000 SKUs OU présence retail massive multi-continents

### `target_gender` · enum
**Valeurs :** `women` | `men` | `unisex` | `unknown`
`unisex` uniquement si positionnement explicite ou collections des deux genres.

---

## 🛒 COMMERCE (5)

### `platform` · string
Plateforme e-commerce détectée par fingerprint HTML.
**Valeurs :** `Shopify` | `Magento` | `WooCommerce` | `BigCommerce` | `Squarespace` | `Salesforce Commerce` | `Centra` | `Custom` | `Unknown`
**Usage BDR :** Shopify = intégration Mirakl simple (API + apps). Custom/Salesforce = intégration plus lourde à pitcher différemment.

### `price_avg_usd` · integer (USD)
Prix moyen catalogue en USD depuis `/products.json` Shopify. Placeholders >$20 000 filtrés. `0` si pas de catalogue accessible.
**Usage BDR :** sanity check du `brand_tier` + estimation panier moyen.

### `ships_international` · boolean
Claim d'expédition internationale détecté sur homepage ("international shipping", "worldwide shipping"…).
⚠️ `false` = pas de claim, pas "ne ship pas" avec certitude.
**Usage BDR :** argument fort pour rejoindre une marketplace multi-pays.

### `brand_story_summary` · string (max 300 chars)
Résumé factuel en 1 phrase extrait de la homepage. `""` si rien d'exploitable.
**Usage BDR :** hook d'intro email ("J'ai remarqué que…").

### `key_aesthetic` · string (2-3 keywords)
Mots-clés d'esthétique/style ancrés dans le copy site.
**Ex :** `"minimalist, contemporary"` / `"romantic, bohemian"` / `"sporty, wellness-inspired"` / `"timeless, artisanal"`
**Usage BDR :** angle de personnalisation + alignement avec la marketplace cible.

---

## 🎯 MATCHING (1)

### `current_marketplace` · string (comma-separated)
Marketplaces où la marque est déjà vendue. **Extraction STRICTE** — uniquement les marketplaces qui APPARAISSENT LITTÉRALEMENT dans le texte scrapé (ex : "stocked at Nordstrom", "featured on Net-a-Porter").

**Valeurs autorisées :** `Bloomingdales` | `Nordstrom` | `Galeries Lafayette` | `La Redoute` | `Debenhams` | `John Lewis` | `Amazon` | `Farfetch` | `ASOS` | `Zalando` | `Net-a-Porter` | `Mytheresa` | `MatchesFashion` | `Ssense`
- `None` — si DTC-only explicite
- `Unknown` — si aucune marketplace détectée (cas par défaut)

**Exemples :** `"Net-a-Porter, Mytheresa"` / `"Unknown"` / `"None"`

**Usage BDR :** whitespace opportunity analysis — marque présente sur Farfetch mais absente de Bloomingdales = opportunité pitch Bloomingdales.

⚠️ **Limite :** extraction conservative. Taux de remplissage attendu ~20-30% (beaucoup de marques ne mentionnent pas leurs retailers sur la homepage). Ton teammate matching engine peut compléter via d'autres sources.

---

## 🛍️ PRODUITS (3)

### `product_types_list` · string (pipe-separated avec counts)
Types de produits du catalogue Shopify, triés par fréquence décroissante, top 15.
**Ex :** `"Dresses (45) | Tops (28) | Knits (19) | Skirts (12) | Bags (5)"`
**Usage BDR :** base factuelle de la catégorisation + preuve qu'on connaît le catalogue.

### `top_product_tags` · string (comma-separated)
Top 10 tags Shopify par fréquence (saison, thème, matière, collection).
**Ex :** `"resort-2024, cotton, hand-embroidered, linen, new-arrivals, silk"`
**Usage BDR :** identifier les "territoires" produits forts pour référencer un angle précis dans le pitch.

### `product_sample` · string (pipe-separated, 8 produits)
8 premiers titres de produits du catalogue Shopify.
**Ex :** `"Lana Ruched Jersey Dress | Kali East West Tote | Priya Makeup Bag…"`
**Usage BDR :** citer un produit phare dans l'email = pitch non-générique.

---

## 🕐 META (1)

### `enriched_at` · string (ISO 8601 datetime)
Date/heure d'enrichissement. Traçabilité + décision de re-scraping (>6 mois = rafraîchir).
**Ex :** `"2026-04-21T12:16:13.961Z"`

---

## ⚠️ Notes importantes pour l'équipe

### Anti-hallucination garantie
GPT ne voit QUE le contenu scrapé réel (homepage text, catalogue Shopify, page wholesale). Si une info n'est pas explicitement dans le contenu → `Unknown` / `""` / `None`. **Jamais d'invention.**

### Champs vides normaux
- Marques non-Shopify → `price_avg_usd = 0`, `product_types_list = ""`, `top_product_tags = ""`, `product_sample = ""`
- Pas de page `/wholesale` publique → `wholesale_contact_email = ""`
- Pas de claim international → `ships_international = false`
- Aucune marketplace mentionnée → `current_marketplace = "Unknown"`

### Priorités BDR pour le matching
1. `brand_tier` + `category` + `country_origin` → fit avec marketplace
2. `current_marketplace` → whitespace opportunity
3. `wholesale_contact_email` (prioritaire) ou `contact_email` (fallback) → canal
4. `brand_story_summary` + `key_aesthetic` + `product_sample` → personnalisation email

### Stack & livrable (Option A)
- **Source of truth :** JSON flat généré par n8n après chaque run
- **Versioning :** auto-commit GitHub (rollback + historique gratuit)
- **Consommation Dust :**
  - Direct GitHub : `https://raw.githubusercontent.com/<OWNER>/mirakl-scraper/main/data/brands_enriched.json`
  - Via webhook n8n : `https://<n8n-instance>/webhook/brands`

### Limites connues
- Sites non-Shopify (~15-20% des 116) : pas d'accès catalogue détaillé
- Sites bloquant les bots (captcha/403) : données dégradées, `platform = Unknown`
- `country_origin` = `Unknown` si pas de marker explicite
- `current_marketplace` conservatif : complément manuel recommandé pour les marques chaudes
