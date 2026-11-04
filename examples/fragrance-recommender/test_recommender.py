from app import Preference, RecommendationRequest, parse_query, recommend


def test_negative_sweetness_is_extracted():
    pref = parse_query("雨后森林，不要太甜", Preference())
    assert "earthy" in pref.include
    assert "sweet" in pref.exclude


def test_recommendation_prefers_earthy_woody_and_penalizes_sweet():
    results = recommend(RecommendationRequest(query="雨后森林、苔藓、木头，不要太甜"))
    assert results
    assert results[0].perfume_id in {"demo-forest-01", "demo-wood-02"}
    assert all("demo-sweet-04" != item.perfume_id for item in results)


def test_hard_budget_filter():
    results = recommend(
        RecommendationRequest(query="木质", preference=Preference(max_price=500))
    )
    assert all(item.perfume_id != "demo-wood-02" for item in results)


from app import (
    ProductAssessmentRequest, ProductEvidence, ProductFeature, ProductForAssessment,
    ReviewSignal, assess_product,
)


def test_assessment_keeps_claims_and_reviews_as_distinct_evidence():
    result = assess_product(ProductAssessmentRequest(
        query="喜欢木质，不要太甜",
        preference=Preference(include=["woody"], exclude=["sweet"]),
        product=ProductForAssessment(
            name="Test perfume",
            product_type="perfume",
            features=[
                ProductFeature(concept="woody", evidence=ProductEvidence(
                    evidence_type="brand_description", source_name="brand",
                    claim="woody accord", confidence=0.9)),
                ProductFeature(concept="sweet", evidence=ProductEvidence(
                    evidence_type="seller_description", source_name="seller",
                    claim="vanilla sweet", confidence=0.8)),
            ],
            reviews=[ReviewSignal(
                text="木质明显，后调偏甜", sentiment="mixed",
                concepts=["woody", "sweet"], confidence=0.8)],
        ),
    ))
    assert result.decision == "possible_mismatch"
    assert "woody" in result.matched_concepts
    assert "sweet" in result.conflicts
    assert {row["kind"] for row in result.evidence} >= {"brand_description", "seller_description", "review_observation"}


def test_candle_requires_cold_and_hot_throw_separately():
    result = assess_product(ProductAssessmentRequest(
        query="喜欢木质",
        preference=Preference(include=["woody"]),
        product=ProductForAssessment(
            name="Cedar candle", product_type="candle",
            features=[ProductFeature(concept="woody", evidence=ProductEvidence(
                evidence_type="brand_description", source_name="brand",
                claim="cedar", confidence=0.9))],
            cold_throw=3.0,
        ),
    ))
    assert "缺少点燃后的热香/扩香表现" in result.missing_information
    assert any("冷香与热香" in note for note in result.product_specific_notes)


def test_empty_product_evidence_is_insufficient_not_negative():
    result = assess_product(ProductAssessmentRequest(
        query="喜欢茶香",
        preference=Preference(include=["tea"]),
        product=ProductForAssessment(name="Unknown", product_type="perfume"),
    ))
    assert result.decision == "insufficient_evidence"
    assert result.score is None


def test_tea_alias_maps_to_canonical_concept():
    pref = parse_query("白茶香调", Preference())
    assert "tea" in pref.include
