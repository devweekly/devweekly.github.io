from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ActiveQuestion:
    should_ask: bool
    question: str
    reason: str


class ActivePreferenceQuestionSelector:
    """Ask only when uncertainty and task impact justify interrupting the user."""

    def __init__(
        self,
        uncertainty_band: float = 0.12,
        minimum_task_impact: float = 0.60,
        minimum_user_samples: int = 2,
    ) -> None:
        self.uncertainty_band = uncertainty_band
        self.minimum_task_impact = minimum_task_impact
        self.minimum_user_samples = minimum_user_samples

    def select(
        self,
        probability_a: float,
        task_impact: float,
        user_sample_count: int,
        question: str,
    ) -> ActiveQuestion:
        uncertainty = abs(probability_a - 0.5) * 2.0
        if task_impact < self.minimum_task_impact:
            return ActiveQuestion(False, "", "LOW_TASK_IMPACT")
        if user_sample_count < self.minimum_user_samples:
            return ActiveQuestion(True, question, "COLD_START_PREFERENCE")
        if uncertainty <= self.uncertainty_band:
            return ActiveQuestion(True, question, "HIGH_PREFERENCE_UNCERTAINTY")
        return ActiveQuestion(False, "", "PREFERENCE_ESTIMATE_SUFFICIENTLY_SEPARATED")
