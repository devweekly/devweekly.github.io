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


# Shopping-product assessment: source-aware and product-type-aware.
from typing import Literal


EvidenceType = Literal[
    "official_spec", "brand_description", "seller_description",
    "review_observation", "database_fact", "model_inference"
]


class ProductEvidence(BaseModel):
    evidence_type: EvidenceType
    source_name: str
    source_url: str | None = None
    claim: str
    confidence: float = Field(default=0.7, ge=0, le=1)


class ProductFeature(BaseModel):
    concept: str
    intensity: float | None = Field(default=None, ge=0, le=1)
    evidence: ProductEvidence


class ReviewSignal(BaseModel):
    text: str
    sentiment: Literal["like", "dislike", "mixed", "unknown"] = "unknown"
    concepts: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.6, ge=0, le=1)
    source_url: str | None = None


class ProductForAssessment(BaseModel):
    product_id: str | None = None
    name: str
    brand: str | None = None
    product_type: Literal["perfume", "candle"]
    price: float | None = Field(default=None, ge=0)
    currency: str = "CNY"
    features: list[ProductFeature] = Field(default_factory=list)
    reviews: list[ReviewSignal] = Field(default_factory=list)
    # Candle-only: cold throw and hot throw are not perfume longevity.
    cold_throw: float | None = Field(default=None, ge=0, le=5)
    hot_throw: float | None = Field(default=None, ge=0, le=5)
    burn_hours: float | None = Field(default=None, gt=0)


class ProductAssessmentRequest(BaseModel):
    product: ProductForAssessment
    preference: Preference = Field(default_factory=Preference)
    query: str = ""


class ProductAssessment(BaseModel):
    product_id: str | None
    name: str
    product_type: str
    decision: Literal["likely_match", "possible_mismatch", "insufficient_evidence"]
    score: float | None
    evidence_confidence: float
    matched_concepts: list[str]
    conflicts: list[str]
    reasons: list[str]
    missing_information: list[str]
    product_specific_notes: list[str]
    evidence: list[dict[str, Any]]


_EVIDENCE_RELIABILITY = {
    "official_spec": 0.95,
    "brand_description": 0.82,
    "database_fact": 0.85,
    "review_observation": 0.68,
    "seller_description": 0.52,
    "model_inference": 0.28,
}


def assess_product(request: ProductAssessmentRequest) -> ProductAssessment:
    """Assess user-supplied shopping-page data; this function does not scrape a marketplace."""
    product = request.product
    preference = parse_query(request.query, request.preference)
    positive, negative = set(preference.include), set(preference.exclude)
    feature_map: dict[str, list[ProductFeature]] = {}
    review_map: dict[str, list[ReviewSignal]] = {}
    evidence_rows: list[dict[str, Any]] = []

    for feature in product.features:
        feature_map.setdefault(feature.concept, []).append(feature)
        evidence_rows.append({
            "kind": feature.evidence.evidence_type,
            "source": feature.evidence.source_name,
            "source_url": feature.evidence.source_url,
            "claim": feature.evidence.claim,
            "concept": feature.concept,
            "confidence": feature.evidence.confidence,
        })
    for review in product.reviews:
        for concept in review.concepts:
            review_map.setdefault(concept, []).append(review)
        evidence_rows.append({
            "kind": "review_observation",
            "source": "user_supplied_review",
            "source_url": review.source_url,
            "claim": review.text,
            "sentiment": review.sentiment,
            "concepts": review.concepts,
            "confidence": review.confidence,
        })

    matched: list[str] = []
    conflicts: list[str] = []
    reasons: list[str] = []
    match_strength = conflict_strength = evidence_mass = 0.0
    evidence_count = 0

    def add_evidence(strength: float) -> None:
        nonlocal evidence_mass, evidence_count
        evidence_mass += strength
        evidence_count += 1

    for concept in positive:
        features = feature_map.get(concept, [])
        reviews = review_map.get(concept, [])
        if features:
            best = max(features, key=lambda x: x.evidence.confidence * _EVIDENCE_RELIABILITY[x.evidence.evidence_type])
            strength = best.evidence.confidence * _EVIDENCE_RELIABILITY[best.evidence.evidence_type]
            match_strength += strength
            add_evidence(strength)
            matched.append(concept)
            reasons.append(f"{concept} 有商品资料支持（{best.evidence.evidence_type}）")
        likes = [x for x in reviews if x.sentiment == "like"]
        dislikes = [x for x in reviews if x.sentiment == "dislike"]
        if likes:
            strength = max(x.confidence * _EVIDENCE_RELIABILITY["review_observation"] for x in likes)
            match_strength += 0.65 * strength
            add_evidence(strength)
            matched.append(concept)
            reasons.append(f"用户评价中出现正向的 {concept} 体验")
        if dislikes:
            strength = max(x.confidence * _EVIDENCE_RELIABILITY["review_observation"] for x in dislikes)
            conflict_strength += strength
            add_evidence(strength)
            conflicts.append(concept)
            reasons.append(f"部分用户评价对 {concept} 有负面反馈")

    for concept in negative:
        features = feature_map.get(concept, [])
        reviews = review_map.get(concept, [])
        if features:
            best = max(features, key=lambda x: x.evidence.confidence * _EVIDENCE_RELIABILITY[x.evidence.evidence_type])
            strength = best.evidence.confidence * _EVIDENCE_RELIABILITY[best.evidence.evidence_type]
            conflict_strength += strength
            add_evidence(strength)
            conflicts.append(concept)
            reasons.append(f"商品资料显示存在你明确排斥的 {concept}")
        likes = [x for x in reviews if x.sentiment == "like"]
        dislikes = [x for x in reviews if x.sentiment == "dislike"]
        if likes:
            strength = max(x.confidence * _EVIDENCE_RELIABILITY["review_observation"] for x in likes)
            conflict_strength += 0.6 * strength
            add_evidence(strength)
            conflicts.append(concept)
            reasons.append(f"评价中有人明确提到 {concept}，与你的排斥偏好冲突")
        if dislikes:
            strength = max(x.confidence * _EVIDENCE_RELIABILITY["review_observation"] for x in dislikes)
            match_strength += 0.35 * strength
            add_evidence(strength)

    missing: list[str] = []
    if not product.features:
        missing.append("没有可核验的香调/气味特征资料")
    if not product.reviews:
        missing.append("没有可分析的具体用户气味评价")
    if product.product_type == "candle":
        if product.cold_throw is None:
            missing.append("缺少冷香表现")
        if product.hot_throw is None:
            missing.append("缺少点燃后的热香/扩香表现")
        product_notes = [
            "蜡烛按冷香与热香分别判断；香水的皮肤留香结论不能直接迁移到蜡烛。",
            "燃烧表现还受蜡材、烛芯、香精比例、房间面积和通风影响。",
        ]
    else:
        product_notes = [
            "香调表不等于实际配方；Note 或 Accord 不能证明具体原料及其浓度。",
            "皮肤表现、扩散和留香受用量、体温、环境与个体嗅觉影响。",
        ]

    if product.price is not None and preference.max_price is not None and product.price > preference.max_price:
        conflicts.append("budget")
        reasons.append(f"商品价格超过预算（{product.currency} {product.price:g}）")

    if evidence_count:
        evidence_confidence = min(1.0, evidence_mass / evidence_count)
        score = round(max(-1.0, min(1.0, (match_strength - 1.15 * conflict_strength) /
                                      max(1.0, len(positive) + len(negative)))), 3)
    else:
        evidence_confidence, score = 0.0, None

    if not evidence_count or evidence_confidence < 0.30 or (not positive and not negative):
        decision = "insufficient_evidence"
    elif score is not None and score > 0.12 and "budget" not in conflicts:
        decision = "likely_match"
    elif score is not None and score < -0.05:
        decision = "possible_mismatch"
    else:
        decision = "insufficient_evidence"

    if not reasons:
        reasons.append("当前输入没有足够的偏好匹配证据，不能仅凭营销文案判断")
    return ProductAssessment(
        product_id=product.product_id, name=product.name, product_type=product.product_type,
        decision=decision, score=score, evidence_confidence=round(evidence_confidence, 3),
        matched_concepts=sorted(set(matched)), conflicts=sorted(set(conflicts)),
        reasons=reasons, missing_information=missing, product_specific_notes=product_notes,
        evidence=evidence_rows,
    )


@app.post("/assess", response_model=ProductAssessment)
def assess_endpoint(body: ProductAssessmentRequest) -> ProductAssessment:
    return assess_product(body)
