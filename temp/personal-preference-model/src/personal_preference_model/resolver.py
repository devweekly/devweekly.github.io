from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .active_learning import ActivePreferenceQuestionSelector
from .learner import PairwisePreferenceModel
from .store import PreferenceStore
from .types import PreferenceClaim, TaskContext, utc_now


_SCOPE_ALIASES = {
    "task_types": "task_type",
    "genres": "genre",
    "text_types": "text_type",
    "language_pairs": "language_pair",
    "project_ids": "project_id",
}


def _scope_matches(scope: dict[str, Any], task: TaskContext) -> bool:
    context = task.to_dict()
    context["language_pair"] = task.language_pair

    for scope_key, expected in scope.items():
        context_key = _SCOPE_ALIASES.get(scope_key, scope_key)
        if context_key not in context:
            return False
        if expected in (None, "", [], ()):
            continue
        actual = context.get(context_key)
        expected_values = expected if isinstance(expected, (list, tuple, set)) else [expected]
        if actual in (None, "") or actual not in expected_values:
            return False
    return True


def _is_time_valid(claim: PreferenceClaim, timestamp: str) -> bool:
    try:
        current = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        start = datetime.fromisoformat(claim.valid_from.replace("Z", "+00:00"))
        if current < start:
            return False
        if claim.valid_to:
            end = datetime.fromisoformat(claim.valid_to.replace("Z", "+00:00"))
            if current >= end:
                return False
        return True
    except (ValueError, TypeError):
        return False


class PreferenceResolver:
    """Deterministic scope/time gate plus optional preference-model estimate."""

    def __init__(
        self,
        store: PreferenceStore,
        minimum_claim_confidence: float = 0.55,
        question_selector: ActivePreferenceQuestionSelector | None = None,
    ) -> None:
        self.store = store
        self.minimum_claim_confidence = minimum_claim_confidence
        self.question_selector = question_selector or ActivePreferenceQuestionSelector()

    def resolve(
        self,
        task: TaskContext,
        claims: list[PreferenceClaim],
        preference_model: PairwisePreferenceModel | None = None,
        candidate_features: tuple[dict[str, float], dict[str, float]] | None = None,
        task_impact: float = 0.0,
        clarification_question: str = "",
    ) -> dict[str, Any]:
        applied: list[dict[str, Any]] = []
        excluded: list[dict[str, Any]] = []
        uncertain: list[dict[str, Any]] = []

        for claim in claims:
            if claim.user_id != task.user_id:
                excluded.append({"claim_id": claim.claim_id, "reason": "USER_MISMATCH"})
                continue
            if claim.status != "active":
                excluded.append({"claim_id": claim.claim_id, "reason": "INACTIVE_CLAIM"})
                continue
            if claim.dimension in task.explicit_overrides:
                excluded.append({"claim_id": claim.claim_id, "reason": "CURRENT_EXPLICIT_OVERRIDE"})
                continue
            if not _is_time_valid(claim, task.timestamp):
                excluded.append({"claim_id": claim.claim_id, "reason": "STALE_OR_NOT_YET_VALID"})
                continue
            if not _scope_matches(claim.scope, task):
                excluded.append({"claim_id": claim.claim_id, "reason": "SCOPE_MISMATCH"})
                continue
            if claim.confidence < self.minimum_claim_confidence:
                uncertain.append(
                    {
                        "claim_id": claim.claim_id,
                        "dimension": claim.dimension,
                        "reason": "LOW_CLAIM_CONFIDENCE",
                        "confidence": claim.confidence,
                    }
                )
                continue

            applied.append(
                {
                    "claim_id": claim.claim_id,
                    "dimension": claim.dimension,
                    "value": claim.value,
                    "strength": claim.strength,
                    "confidence": claim.confidence,
                    "source_kind": claim.source_kind,
                    "supporting_event_ids": list(claim.supporting_event_ids),
                    "refuting_event_ids": list(claim.refuting_event_ids),
                    "reason_codes": ["ACTIVE", "TIME_VALID", "SCOPE_MATCH"],
                }
            )

        preference_estimate = None
        active_question = {"should_ask": False, "question": "", "reason": "NO_PAIRWISE_ESTIMATE"}

        if preference_model and candidate_features:
            features_a, features_b = candidate_features
            preference_estimate = preference_model.predict(
                user_id=task.user_id,
                features_a=features_a,
                features_b=features_b,
                context={
                    "task_type": task.task_type,
                    "genre": task.genre,
                    "text_type": task.text_type,
                    "language_pair": task.language_pair,
                },
            )
            selected = self.question_selector.select(
                probability_a=float(preference_estimate["probability_a_preferred"]),
                task_impact=task_impact,
                user_sample_count=int(preference_estimate["user_sample_count"]),
                question=clarification_question,
            )
            active_question = {
                "should_ask": selected.should_ask,
                "question": selected.question,
                "reason": selected.reason,
            }

        snapshot = {
            "snapshot_id": f"snapshot_{uuid4().hex[:12]}",
            "user_id": task.user_id,
            "created_at": utc_now(),
            "user_model_version": max((claim.revision for claim in claims), default=0),
            "task_context": task.to_dict(),
            "applied": applied,
            "excluded": excluded,
            "uncertain": uncertain,
            "pairwise_estimate": preference_estimate,
            "active_question": active_question,
        }
        self.store.save_snapshot(snapshot)
        return snapshot
