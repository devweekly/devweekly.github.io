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
        if not 0.0 <= uncertainty_band <= 1.0:
            raise ValueError("uncertainty_band must be between 0 and 1")
        if not 0.0 <= minimum_task_impact <= 1.0:
            raise ValueError("minimum_task_impact must be between 0 and 1")
        if minimum_user_samples < 0:
            raise ValueError("minimum_user_samples cannot be negative")
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
        if not 0.0 <= probability_a <= 1.0:
            raise ValueError("probability_a must be between 0 and 1")
        if not 0.0 <= task_impact <= 1.0:
            raise ValueError("task_impact must be between 0 and 1")
        if user_sample_count < 0:
            raise ValueError("user_sample_count cannot be negative")

        preference_separation = abs(probability_a - 0.5) * 2.0
        if task_impact < self.minimum_task_impact:
            return ActiveQuestion(False, "", "LOW_TASK_IMPACT")
        if user_sample_count < self.minimum_user_samples:
            return ActiveQuestion(True, question, "COLD_START_PREFERENCE")
        if preference_separation <= self.uncertainty_band:
            return ActiveQuestion(True, question, "HIGH_PREFERENCE_UNCERTAINTY")
        return ActiveQuestion(False, "", "PREFERENCE_ESTIMATE_SUFFICIENTLY_SEPARATED")
