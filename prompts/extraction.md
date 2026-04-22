# Prompt GPT — Brand Enrichment for Mirakl Connect

## Structure Excel source (Sheet: BRANDS)

| Colonne | Statut | Description |
|---|---|---|
| `Brand Name` | ✅ Rempli | Nom de la marque |
| `brandUrl` | ✅ Rempli | Site officiel |
| `country_origin` | ⬜ À enrichir | Pays d'origine |
| `ships_to` | ⬜ À enrichir | Marchés livrés (ex: "US, EU, UK") |
| `price_avg_usd` | ⬜ À enrichir | Prix moyen en USD |
| `brand_tier` | ⬜ À enrichir | luxury / premium / accessible-premium / mid-market |
| `category` | ⬜ À enrichir | Catégorie principale |
| `brand_size` | ⬜ À enrichir | small / mid / large |
| `target_gender` | ⬜ À enrichir | women / men / unisex |
| `Curent_Marketplace` | ⬜ À enrichir | Marketplaces actuelles (liste séparée par virgules) |
| `Aesthetic` | ⬜ À enrichir | Esthétique / style (ex: "minimalist, contemporary") |

## Marketplaces cibles (Sheet: MARKETPLACE)

Bloomingdales, Debenhams, Galerie Lafayette, John Lewis, La Redoute, Nordstrom

---

## Prompt principal (à coller dans n8n — noeud OpenAI)

```
You are a fashion & luxury market analyst. Enrich brand data for a Mirakl Connect prospecting pipeline.

For the brand "{{brand_name}}" (website: {{brand_url}}), return a JSON object with EXACTLY these fields:

{
  "country_origin": "2-letter ISO country code (e.g. US, FR, IT, AU)",
  "ships_to": "comma-separated list of regions/countries (e.g. 'US, EU, UK, AU')",
  "price_avg_usd": integer (estimated average product price in USD),
  "brand_tier": one of: "luxury" | "premium" | "accessible-premium" | "mid-market",
  "category": one of: "Ready-to-wear" | "Accessories" | "Footwear" | "Jewelry" | "Swimwear" | "Activewear" | "Lingerie" | "Outerwear" | "Multi-category",
  "brand_size": one of: "small" | "mid" | "large",
  "target_gender": one of: "women" | "men" | "unisex",
  "current_marketplace": "comma-separated list of marketplaces where this brand is currently sold (from: Bloomingdales, Debenhams, Galerie Lafayette, John Lewis, La Redoute, Nordstrom, Zalando, Amazon, ASOS, Farfetch, Net-a-Porter, Mytheresa, Revolve — or empty string if none)",
  "aesthetic": "2-4 comma-separated style keywords (e.g. 'minimalist, contemporary, sustainable')",
  "key_products": "3-5 flagship products, comma-separated",
  "mirakl_fit_score": integer 0-100 (see scoring below),
  "mirakl_fit_rationale": "2-3 sentences justifying the score",
  "data_confidence": one of: "high" | "medium" | "low"
}

Scoring criteria for mirakl_fit_score:
- +30 pts if NOT on Zalando AND NOT on Amazon
- +20 pts if DTC site is strong and active (quality brand site)
- +20 pts if category is strategic (Ready-to-wear, Accessories, Footwear, Jewelry)
- +15 pts catalog depth: >500 SKUs=15pts, 100-500=10pts, <100=5pts
- +15 pts brand notoriety: well-known=15, growing=10, emerging=5

Return ONLY valid JSON. No markdown. No extra text.
```

---

## Variables à injecter depuis Excel

| Variable n8n | Colonne Excel |
|---|---|
| `{{brand_name}}` | `Brand Name` (col A) |
| `{{brand_url}}` | `brandUrl` (col B) |

## Mapping retour JSON → colonnes Excel

| Champ JSON | Colonne Excel cible |
|---|---|
| `country_origin` | `country_origin` |
| `ships_to` | `ships_to` |
| `price_avg_usd` | `price_avg_usd` |
| `brand_tier` | `brand_tier` |
| `category` | `category` |
| `brand_size` | `brand_size` |
| `target_gender` | `target_gender` |
| `current_marketplace` | `Curent_Marketplace` |
| `aesthetic` | `Aesthetic` |
