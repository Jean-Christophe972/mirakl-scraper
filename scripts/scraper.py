"""
Mirakl Brand Enrichment Script
Fallback Python si n8n n'est pas dispo — appelle GPT-4o pour chaque marque.
"""

import json
import time
import argparse
from pathlib import Path

try:
    import pandas as pd
    from openai import OpenAI
except ImportError:
    print("Install deps: pip install pandas openpyxl openai")
    raise

SYSTEM_PROMPT = "You are a fashion & luxury market analyst specializing in marketplace strategy."

USER_PROMPT_TEMPLATE = """For the brand "{brand_name}" (website: {brand_url}), provide a structured JSON response with:

1. product_category: Main product category (Ready-to-wear / Accessories / Footwear / Jewelry / etc.)
2. key_products: Array of 3-5 flagship products
3. brand_positioning: One sentence
4. marketplace_presence: Object with boolean for: zalando, amazon, nordstrom, asos, debenhams, farfetch, net_a_porter, mytheresa, ssense, revolve, matches_fashion
5. dtc_strength: Score 1-5
6. mirakl_fit_score: Integer 0-100 (see scoring criteria below)
7. mirakl_fit_rationale: 2-3 sentences
8. data_confidence: high / medium / low

Scoring criteria:
- +30 pts if absent from Zalando AND Amazon
- +20 pts if DTC site is strong and active
- +20 pts if category is strategic (ready-to-wear, accessories, footwear, jewelry)
- +15 pts based on estimated catalog depth (>500 SKUs=15, 100-500=10, <100=5)
- +15 pts based on brand notoriety (established=15, growing=10, emerging=5)

Return ONLY valid JSON, no markdown."""


def enrich_brand(client: "OpenAI", brand_name: str, brand_url: str) -> dict:
    prompt = USER_PROMPT_TEMPLATE.format(brand_name=brand_name, brand_url=brand_url or "unknown")
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        temperature=0.2,
        response_format={"type": "json_object"}
    )
    result = json.loads(response.choices[0].message.content)
    result["_source_brand_name"] = brand_name
    result["_source_url"] = brand_url
    return result


def main():
    parser = argparse.ArgumentParser(description="Enrich brands with GPT-4o for Mirakl Connect scoring")
    parser.add_argument("--input", default="data/brands_raw.xlsx", help="Input Excel file")
    parser.add_argument("--output", default="data/brands_enriched.json", help="Output JSON file")
    parser.add_argument("--api-key", help="OpenAI API key (or set OPENAI_API_KEY env var)")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between API calls (seconds)")
    parser.add_argument("--limit", type=int, help="Process only N brands (for testing)")
    args = parser.parse_args()

    import os
    api_key = args.api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("Set OPENAI_API_KEY env var or use --api-key")

    client = OpenAI(api_key=api_key)

    df = pd.read_excel(args.input)
    print(f"Loaded {len(df)} brands from {args.input}")

    # Adapt column names to your Excel structure
    name_col = df.columns[0]   # First column = brand name
    url_col = df.columns[1] if len(df.columns) > 1 else None

    brands = df.head(args.limit) if args.limit else df
    results = []
    errors = []

    for i, (_, row) in enumerate(brands.iterrows()):
        brand_name = str(row[name_col]).strip()
        brand_url = str(row[url_col]).strip() if url_col else ""

        print(f"[{i+1}/{len(brands)}] Enriching: {brand_name}...")
        try:
            data = enrich_brand(client, brand_name, brand_url)
            results.append(data)
            score = data.get("mirakl_fit_score", "?")
            print(f"  -> Fit Score: {score}/100")
        except Exception as e:
            print(f"  -> ERROR: {e}")
            errors.append({"brand": brand_name, "error": str(e)})

        if i < len(brands) - 1:
            time.sleep(args.delay)

    results_sorted = sorted(results, key=lambda x: x.get("mirakl_fit_score", 0), reverse=True)
    scores = [r.get("mirakl_fit_score", 0) for r in results]
    output = {
        "summary": {
            "total_brands": len(results),
            "avg_fit_score": round(sum(scores) / len(scores), 1) if scores else 0,
            "high_fit_count": sum(1 for s in scores if s >= 70),
            "medium_fit_count": sum(1 for s in scores if 40 <= s < 70),
            "low_fit_count": sum(1 for s in scores if s < 40),
            "errors": len(errors)
        },
        "brands": results_sorted,
        "errors": errors
    }

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone! {len(results)} brands enriched -> {args.output}")
    print(f"Avg Fit Score: {output['summary']['avg_fit_score']}/100")
    print(f"High fit (>=70): {output['summary']['high_fit_count']} brands")


if __name__ == "__main__":
    main()
