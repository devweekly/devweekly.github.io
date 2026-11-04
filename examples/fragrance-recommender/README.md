# Fragrance recommender demo

This is a deliberately small, deterministic reference implementation for the article. The catalog is synthetic demo data, not real product claims or a licensed commercial dataset.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
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


## Shopping-product assessment

The /assess endpoint accepts structured fields copied from a Taobao/Tmall listing, OCR output, or review excerpts. It does not scrape Taobao, access buyer accounts, or bypass platform controls. Keep source URL, source type and confidence attached to each assertion.

Example request:

~~~bash
curl -X POST http://127.0.0.1:8000/assess \
  -H 'content-type: application/json' \
  -d '{
    "query": "喜欢木质，不要太甜",
    "preference": {"include": ["woody"], "exclude": ["sweet"]},
    "product": {
      "name": "某品牌香薰蜡烛",
      "product_type": "candle",
      "features": [{
        "concept": "woody",
        "evidence": {
          "evidence_type": "seller_description",
          "source_name": "Taobao product detail",
          "source_url": "https://item.taobao.com/item.htm?id=...",
          "claim": "商品详情称含雪松木质香调",
          "confidence": 0.55
        }
      }],
      "reviews": [{
        "text": "点燃后木质感明显，甜度不高",
        "sentiment": "like",
        "concepts": ["woody"],
        "confidence": 0.7
      }],
      "cold_throw": 2.5,
      "hot_throw": 3.5
    }
  }'
~~~

The result distinguishes likely_match, possible_mismatch and insufficient_evidence. Missing data is uncertainty, not proof that the product lacks a scent. Perfume skin wear and candle cold throw/hot throw are separate dimensions. Evidence types distinguish official specifications, brand claims, seller claims, review observations, database facts and model inference.

This demo does not implement OCR, marketplace scraping, external catalog lookup, embeddings or learned ranking. For production, use authorized platform/merchant feeds or user-provided page content, retain provenance and collection time, and respect platform terms and privacy requirements. Third-party review text is not automatically licensed for model training or redistribution.
