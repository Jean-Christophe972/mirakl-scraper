# Mirakl Scraper — Brand Enrichment Pipeline

Enrichit 110 marques fashion/luxe DTC à partir d'un fichier Excel pour évaluer leur fit avec Mirakl Connect.

## Objectif

Pour chaque marque, produire :
- **Catégorie produit** (ex: prêt-à-porter, accessoires, chaussures...)
- **Produits phares** (3-5 références clés)
- **Présence marketplaces** : Zalando, Amazon, Nordstrom, ASOS, Debenhams, Farfetch, Net-a-Porter...
- **Mirakl Connect Fit Score** (0-100) avec justification

## Structure

```
mirakl-scraper/
├── data/
│   ├── brands_raw.xlsx          # Excel source (110 marques)
│   └── brands_enriched.json     # Output enrichi
├── prompts/
│   └── extraction.md            # Prompts GPT pour l'enrichissement
├── workflows/
│   └── n8n_scraper.json         # Workflow n8n (scraping + enrichissement)
├── scripts/
│   └── scraper.py               # Script Python utilitaire
└── README.md
```

## Pipeline

1. **Input** : `data/brands_raw.xlsx` — liste des marques avec nom + URL
2. **Enrichissement** : via GPT (prompt dans `prompts/extraction.md`) + scraping web
3. **Scoring** : Fit Score Mirakl Connect basé sur critères définis
4. **Output** : `data/brands_enriched.json` — données structurées prêtes à exploiter

## Critères du Fit Score Mirakl Connect

| Critère | Poids |
|---|---|
| Absence sur grandes marketplaces | 30% |
| Potentiel DTC confirmé (site propre actif) | 20% |
| Catégorie stratégique pour Mirakl | 20% |
| Volume produits estimé | 15% |
| Notoriété / traction marque | 15% |

## Usage

```bash
# Installer les dépendances
pip install -r requirements.txt

# Lancer l'enrichissement
python scripts/scraper.py --input data/brands_raw.xlsx --output data/brands_enriched.json
```
