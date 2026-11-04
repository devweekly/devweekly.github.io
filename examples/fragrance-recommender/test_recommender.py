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
