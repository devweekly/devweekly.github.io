from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).parent
CATALOG_PATH = BASE_DIR / "data" / "perfumes.json"
ONTOLOGY_PATH = BASE_DIR / "data" / "ontology.json"


class Preference(BaseModel):
    include: list[str] = Field(default_factory=list)
    exclude: list[str] = Field(default_factory=list)
    max_price: float | None = None
    concentration: list[str] = Field(default_factory=list)
    occasions: list[str] = Field(default_factory=list)


class RecommendationRequest(BaseModel):
    query: str = ""
    preference: Preference = Field(default_factory=Preference)
    limit: int = Field(default=10, ge=1, le=50)


class Recommendation(BaseModel):
    perfume_id: str
    name: str
    brand: str
    score: float
    matched_concepts: list[str]
    explanation: list[str]
    evidence: list[dict[str, str]]


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


CATALOG = load_json(CATALOG_PATH)
ONTOLOGY = load_json(ONTOLOGY_PATH)
ALIASES: dict[str, list[str]] = ONTOLOGY["aliases"]
CONCEPTS: dict[str, dict[str, Any]] = ONTOLOGY["concepts"]


def parse_query(query: str, explicit: Preference) -> Preference:
    """Small deterministic parser for the demo; replace with a constrained LLM parser
    or a trained intent model when query complexity warrants it.
    """
    include = set(explicit.include)
    exclude = set(explicit.exclude)
    normalized = query.lower()

    for concept, aliases in ALIASES.items():
        if any(alias.lower() in normalized for alias in aliases):
            include.add(concept)

    negative_patterns = {
        "sweet": [r"不要太甜", r"不太甜", r"少甜", r"不喜欢甜", r"不要甜"],
        "gourmand": [r"不要美食调", r"不要奶 gourmand"],
        "powdery": [r"不要粉感", r"不喜欢粉"],
    }
    for concept, patterns in negative_patterns.items():
        if any(re.search(pattern, query, re.IGNORECASE) for pattern in patterns):
            exclude.add(concept)
            include.discard(concept)

    return Preference(
        include=sorted(include),
        exclude=sorted(exclude),
        max_price=explicit.max_price,
        concentration=explicit.concentration,
        occasions=explicit.occasions,
    )


def candidate_matches(perfume: dict[str, Any], preference: Preference) -> bool:
    """Hard constraints only. Exclusions expressed as soft language are scored later."""
    if preference.max_price is not None and perfume.get("price") is not None:
        if perfume["price"] > preference.max_price:
            return False
    if preference.concentration and perfume.get("concentration") not in preference.concentration:
        return False
    if preference.occasions and not set(preference.occasions).intersection(perfume.get("occasions", [])):
        return False
    return True


def score_candidate(perfume: dict[str, Any], preference: Preference) -> tuple[float, list[str], list[str]]:
    accords = set(perfume.get("accords", []))
    descriptors = set(perfume.get("descriptors", []))
    notes = set(perfume.get("notes", []))
    positive = set(preference.include)
    negative = set(preference.exclude)

    matched: list[str] = []
    reasons: list[str] = []
    score = 0.0

    # Explicit user concepts have the highest contribution.
    for concept in positive:
        meta = CONCEPTS.get(concept, {})
        weight = float(meta.get("weight", 1.0))
        targets = set(meta.get("matches", [concept]))
        if targets.intersection(accords):
            score += 3.0 * weight
            matched.append(concept)
            reasons.append(f"公开香调与“{meta.get('label', concept)}”匹配")
        elif targets.intersection(descriptors):
            score += 2.0 * weight
            matched.append(concept)
            reasons.append(f"气味描述与“{meta.get('label', concept)}”相关")
        elif targets.intersection(notes):
            score += 1.5 * weight
            matched.append(concept)
            reasons.append(f"香调笔记中出现“{meta.get('label', concept)}”")

    # Negative concepts are penalties unless the user supplied a hard filter.
    for concept in negative:
        meta = CONCEPTS.get(concept, {})
        targets = set(meta.get("matches", [concept]))
        if targets.intersection(accords):
            score -= 2.5
            reasons.append(f"存在需要降低权重的“{meta.get('label', concept)}”特征")
        elif targets.intersection(descriptors):
            score -= 1.5
            reasons.append(f"描述中出现“{meta.get('label', concept)}”")

    # Small, explicit preference for products with stronger evidence coverage.
    evidence_count = len(perfume.get("evidence", []))
    score += min(evidence_count, 3) * 0.15

    return round(score, 4), sorted(set(matched)), reasons


def recommend(request: RecommendationRequest) -> list[Recommendation]:
    preference = parse_query(request.query, request.preference)
    results: list[Recommendation] = []

    for perfume in CATALOG:
        if not candidate_matches(perfume, preference):
            continue
        score, matched, reasons = score_candidate(perfume, preference)
        if score <= 0:
            continue
        results.append(
            Recommendation(
                perfume_id=perfume["id"],
                name=perfume["name"],
                brand=perfume["brand"],
                score=score,
                matched_concepts=matched,
                explanation=reasons or ["符合部分筛选条件"],
                evidence=perfume.get("evidence", []),
            )
        )

    results.sort(key=lambda item: (-item.score, item.perfume_id))
    return results[: request.limit]


app = FastAPI(title="Fragrance Recommender Demo", version="0.1.0")


@app.post("/recommend", response_model=list[Recommendation])
def recommend_endpoint(body: RecommendationRequest) -> list[Recommendation]:
    return recommend(body)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "catalog_size": str(len(CATALOG))}
