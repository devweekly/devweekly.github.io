from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Iterable

from .types import PairwiseSample


def _sigmoid(value: float) -> float:
    value = max(-30.0, min(30.0, value))
    return 1.0 / (1.0 + math.exp(-value))


class PairwisePreferenceModel:
    """Hierarchical pairwise logistic model with a population prior.

    Stage 3 uses Bradley-Terry / logistic pairwise learning. Population weights
    are learned from all supplied samples; user-specific deltas are regularized
    toward that population prior. This is a compact baseline, not a full Bayesian
    posterior. Calibrate probabilities on held-out real-user comparisons before
    using them for high-impact decisions.
    """

    def __init__(
        self,
        learning_rate: float = 0.08,
        epochs: int = 300,
        l2_population: float = 0.002,
        l2_user: float = 0.08,
    ) -> None:
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.l2_population = l2_population
        self.l2_user = l2_user
        self.population_weights: dict[str, float] = defaultdict(float)
        self.user_deltas: dict[str, dict[str, float]] = {}
        self.user_sample_counts: dict[str, int] = defaultdict(int)
        self.is_fitted = False

    @staticmethod
    def _vector(
        features_a: dict[str, float],
        features_b: dict[str, float],
        context: dict[str, str],
    ) -> dict[str, float]:
        keys = set(features_a) | set(features_b)
        delta = {
            key: float(features_a.get(key, 0.0)) - float(features_b.get(key, 0.0))
            for key in keys
        }
        context_parts = [
            f"{name}={value}"
            for name, value in sorted(context.items())
            if value
        ]
        for part in context_parts:
            for key, value in list(delta.items()):
                delta[f"{part}::{key}"] = value
        return delta

    @staticmethod
    def _dot(weights: dict[str, float], vector: dict[str, float]) -> float:
        return sum(weights.get(key, 0.0) * value for key, value in vector.items())

    def fit(self, samples: Iterable[PairwiseSample]) -> "PairwisePreferenceModel":
        samples = list(samples)
        if not samples:
            raise ValueError("At least one pairwise sample is required")

        vectors = [
            (
                self._vector(s.features_a, s.features_b, s.context),
                1.0 if s.chosen == "A" else 0.0,
            )
            for s in samples
        ]

        for _ in range(self.epochs):
            gradients: dict[str, float] = defaultdict(float)
            for vector, target in vectors:
                probability = _sigmoid(self._dot(self.population_weights, vector))
                error = probability - target
                for key, value in vector.items():
                    gradients[key] += error * value

            scale = 1.0 / len(vectors)
            keys = set(self.population_weights) | set(gradients)
            for key in keys:
                gradient = gradients.get(key, 0.0) * scale
                gradient += self.l2_population * self.population_weights.get(key, 0.0)
                self.population_weights[key] -= self.learning_rate * gradient

        self.is_fitted = True
        return self

    def fit_user(
        self,
        user_id: str,
        samples: Iterable[PairwiseSample],
    ) -> "PairwisePreferenceModel":
        if not self.is_fitted:
            raise RuntimeError("Fit the population model before fitting a user")
        samples = [sample for sample in samples if sample.user_id == user_id]
        if not samples:
            self.user_deltas[user_id] = {}
            self.user_sample_counts[user_id] = 0
            return self

        delta: dict[str, float] = defaultdict(float)
        vectors = [
            (
                self._vector(s.features_a, s.features_b, s.context),
                1.0 if s.chosen == "A" else 0.0,
            )
            for s in samples
        ]

        for _ in range(self.epochs):
            gradients: dict[str, float] = defaultdict(float)
            for vector, target in vectors:
                weights = {
                    key: self.population_weights.get(key, 0.0) + delta.get(key, 0.0)
                    for key in set(self.population_weights) | set(delta) | set(vector)
                }
                probability = _sigmoid(self._dot(weights, vector))
                error = probability - target
                for key, value in vector.items():
                    gradients[key] += error * value

            scale = 1.0 / len(vectors)
            keys = set(delta) | set(gradients)
            for key in keys:
                gradient = gradients.get(key, 0.0) * scale
                gradient += self.l2_user * delta.get(key, 0.0)
                delta[key] -= self.learning_rate * gradient

        self.user_deltas[user_id] = dict(delta)
        self.user_sample_counts[user_id] = len(samples)
        return self

    def fit_hierarchical(self, samples: Iterable[PairwiseSample]) -> "PairwisePreferenceModel":
        samples = list(samples)
        self.fit(samples)
        for user_id in sorted({sample.user_id for sample in samples}):
            self.fit_user(user_id, samples)
        return self

    def predict(
        self,
        user_id: str,
        features_a: dict[str, float],
        features_b: dict[str, float],
        context: dict[str, str],
    ) -> dict[str, float | int]:
        if not self.is_fitted:
            raise RuntimeError("Model has not been fitted")
        vector = self._vector(features_a, features_b, context)
        weights = dict(self.population_weights)
        for key, value in self.user_deltas.get(user_id, {}).items():
            weights[key] = weights.get(key, 0.0) + value
        probability_a = _sigmoid(self._dot(weights, vector))
        return {
            "probability_a_preferred": probability_a,
            "probability_b_preferred": 1.0 - probability_a,
            "confidence_proxy": abs(probability_a - 0.5) * 2.0,
            "user_sample_count": self.user_sample_counts.get(user_id, 0),
        }


    def evaluate_pairwise_accuracy(self, samples: Iterable[PairwiseSample]) -> dict[str, float | int]:
        """Evaluate held-out pairwise choice accuracy; do not use training rows."""
        rows = list(samples)
        if not rows:
            return {"count": 0, "accuracy": 0.0}

        correct = 0
        for sample in rows:
            prediction = self.predict(
                user_id=sample.user_id,
                features_a=sample.features_a,
                features_b=sample.features_b,
                context=sample.context,
            )
            predicted = (
                "A"
                if float(prediction["probability_a_preferred"]) >= 0.5
                else "B"
            )
            correct += int(predicted == sample.chosen)
        return {"count": len(rows), "accuracy": correct / len(rows)}

    def to_dict(self) -> dict[str, object]:
        return {
            "format_version": 1,
            "learning_rate": self.learning_rate,
            "epochs": self.epochs,
            "l2_population": self.l2_population,
            "l2_user": self.l2_user,
            "population_weights": dict(self.population_weights),
            "user_deltas": {
                user_id: dict(weights)
                for user_id, weights in self.user_deltas.items()
            },
            "user_sample_counts": dict(self.user_sample_counts),
            "is_fitted": self.is_fitted,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "PairwisePreferenceModel":
        if payload.get("format_version") != 1:
            raise ValueError("Unsupported preference model format_version")

        model = cls(
            learning_rate=float(payload["learning_rate"]),
            epochs=int(payload["epochs"]),
            l2_population=float(payload["l2_population"]),
            l2_user=float(payload["l2_user"]),
        )
        population = payload.get("population_weights", {})
        user_deltas = payload.get("user_deltas", {})
        user_counts = payload.get("user_sample_counts", {})
        if not isinstance(population, dict) or not isinstance(user_deltas, dict):
            raise ValueError("Invalid model weights payload")
        if not isinstance(user_counts, dict):
            raise ValueError("Invalid user sample counts payload")

        model.population_weights = defaultdict(
            float,
            {str(key): float(value) for key, value in population.items()},
        )
        model.user_deltas = {
            str(user_id): {
                str(key): float(value) for key, value in weights.items()
            }
            for user_id, weights in user_deltas.items()
            if isinstance(weights, dict)
        }
        model.user_sample_counts = defaultdict(
            int,
            {str(key): int(value) for key, value in user_counts.items()},
        )
        model.is_fitted = bool(payload.get("is_fitted", False))
        return model

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> "PairwisePreferenceModel":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Serialized preference model must be a JSON object")
        return cls.from_dict(payload)
