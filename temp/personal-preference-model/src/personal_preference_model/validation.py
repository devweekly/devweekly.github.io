from __future__ import annotations

from dataclasses import dataclass

from .types import PreferenceEvidence


@dataclass(frozen=True)
class EvidencePromotionDecision:
    approved: bool
    reason: str


class EvidencePromotionPolicy:
    """Deterministic gate between LLM-extracted evidence and durable claims."""

    def __init__(
        self,
        minimum_confidence: float = 0.75,
        require_context_scope: bool = True,
    ) -> None:
        if not 0.0 <= minimum_confidence <= 1.0:
            raise ValueError("minimum_confidence must be between 0 and 1")
        self.minimum_confidence = minimum_confidence
        self.require_context_scope = require_context_scope

    def evaluate(self, evidence: PreferenceEvidence) -> EvidencePromotionDecision:
        if evidence.direction == "neutral":
            return EvidencePromotionDecision(False, "NEUTRAL_EVIDENCE")
        if evidence.confidence < self.minimum_confidence:
            return EvidencePromotionDecision(False, "LOW_EXTRACTION_CONFIDENCE")

        if self.require_context_scope:
            allowed_scope_keys = {
                "task_type",
                "task_types",
                "genre",
                "genres",
                "text_type",
                "text_types",
                "project_id",
                "project_ids",
                "language_pair",
                "language_pairs",
            }
            has_scope = any(
                key in allowed_scope_keys and value not in (None, "", [], ())
                for key, value in evidence.scope.items()
            )
            if not has_scope:
                return EvidencePromotionDecision(False, "UNSCOPED_INFERRED_EVIDENCE")

        return EvidencePromotionDecision(True, "VALIDATED")
