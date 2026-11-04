# Fragrance recommender demo

This is a deliberately small, deterministic reference implementation for the article. The catalog is synthetic demo data, not real product claims or a licensed commercial dataset.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://127.0.0.1:8000/docs.

## Example request

```bash
curl -X POST http://127.0.0.1:8000/recommend \
  -H 'content-type: application/json' \
  -d '{
    "query": "想找雨后森林、湿润泥土、苔藓和木头，不要太甜",
    "preference": {"max_price": 800},
    "limit": 5
  }'
```

## What this demo implements

- A small Chinese-to-olfactory-concept alias map.
- Explicit positive and negative preference extraction.
- Hard filters for budget, concentration and occasion.
- Explainable weighted scoring over accords, descriptors and notes.
- Evidence references attached to each result.

It intentionally does **not** claim to perform semantic embedding search. For production, implement multiple candidate generators (SQL filters, BM25/full text, vector retrieval), merge by canonical perfume ID, then rerank. Do not infer a perfume's formula from notes or user descriptions.

## Production extensions

1. Replace JSON with PostgreSQL tables and source/provenance records.
2. Add a vector index for multilingual scent descriptions and review text; keep product facts in relational storage.
3. Train or tune a ranker from explicit feedback (save, sample, purchase, dislike) and exposure logs. Treat clicks as weak signals.
4. Add deduplication, versioning, licensing metadata, deletion propagation, rate limiting and evaluation datasets.
