from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


@dataclass(frozen=True)
class TaskContext:
    user_id: str
    task_type: str
    genre: str = ""
    text_type: str = ""
    source_language: str = ""
    target_language: str = ""
    project_id: str = ""
    timestamp: str = field(default_factory=utc_now)
    explicit_overrides: tuple[str, ...] = ()

    @property
    def language_pair(self) -> str:
        if not self.source_language or not self.target_language:
            return ""
        return f"{self.source_language}->{self.target_language}"

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["explicit_overrides"] = list(self.explicit_overrides)
        return value


@dataclass(frozen=True)
class FeedbackEvent:
    user_id: str
    event_type: str
    raw_feedback: str
    task_context: TaskContext
    payload: dict[str, Any] = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: new_id("evt"))
    occurred_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "user_id": self.user_id,
            "event_type": self.event_type,
            "raw_feedback": self.raw_feedback,
            "task_context": self.task_context.to_dict(),
            "payload": self.payload,
            "occurred_at": self.occurred_at,
        }


@dataclass(frozen=True)
class PreferenceEvidence:
    event_id: str
    user_id: str
    dimension: str
    direction: str
    confidence: float
    rationale: str
    scope: dict[str, Any] = field(default_factory=dict)
    evidence_id: str = field(default_factory=lambda: new_id("evi"))

    def __post_init__(self) -> None:
        if self.direction not in {"prefer", "avoid", "neutral"}:
            raise ValueError("direction must be prefer, avoid, or neutral")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")


@dataclass(frozen=True)
class PreferenceClaim:
    user_id: str
    dimension: str
    value: str
    strength: float
    confidence: float
    scope: dict[str, Any]
    source_kind: str
    valid_from: str = field(default_factory=utc_now)
    valid_to: str | None = None
    status: str = "active"
    claim_id: str = field(default_factory=lambda: new_id("claim"))
    revision: int = 1
    supporting_event_ids: tuple[str, ...] = ()
    refuting_event_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not 0.0 <= self.strength <= 1.0:
            raise ValueError("strength must be between 0 and 1")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")


@dataclass(frozen=True)
class PairwiseSample:
    user_id: str
    context: dict[str, str]
    features_a: dict[str, float]
    features_b: dict[str, float]
    chosen: str
    sample_id: str = field(default_factory=lambda: new_id("pair"))
    created_at: str = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        if self.chosen not in {"A", "B"}:
            raise ValueError("chosen must be A or B")


def dataclass_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return asdict(value)
