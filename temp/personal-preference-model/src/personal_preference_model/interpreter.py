from __future__ import annotations

import json
import os
from typing import Any, Protocol
from urllib.request import Request, urlopen

from .types import FeedbackEvent, PreferenceEvidence


class JsonCompletionClient(Protocol):
    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        """Return a parsed JSON object from an LLM."""


class OpenAICompatibleJsonClient:
    """Adapter for an OpenAI-compatible Chat Completions endpoint.

    Set PREFERENCE_LLM_ENDPOINT, PREFERENCE_LLM_MODEL and optionally
    PREFERENCE_LLM_API_KEY. A Jev adapter can implement JsonCompletionClient
    directly if Jev uses a different SDK or invocation contract.
    """

    def __init__(
        self,
        endpoint: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout_seconds: int = 60,
    ) -> None:
        self.endpoint = endpoint or os.getenv("PREFERENCE_LLM_ENDPOINT", "")
        self.model = model or os.getenv("PREFERENCE_LLM_MODEL", "")
        self.api_key = api_key or os.getenv("PREFERENCE_LLM_API_KEY", "")
        self.timeout_seconds = timeout_seconds
        if not self.endpoint or not self.model:
            raise ValueError(
                "Set PREFERENCE_LLM_ENDPOINT and PREFERENCE_LLM_MODEL, "
                "or provide endpoint/model explicitly"
            )

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        body = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        request = Request(
            self.endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            result = json.loads(response.read().decode("utf-8"))

        message = result["choices"][0]["message"]["content"]
        parsed = json.loads(message)
        if not isinstance(parsed, dict):
            raise ValueError("LLM response must be a JSON object")
        return parsed


class FeedbackInterpreter:
    def __init__(self, client: JsonCompletionClient) -> None:
        self.client = client

    def extract(self, event: FeedbackEvent) -> list[PreferenceEvidence]:
        system_prompt = (
            "You extract candidate preference evidence from user feedback. "
            "Do not invent stable preferences from silence or a single ambiguous action. "
            "Return JSON only: {\"evidence\": [{\"dimension\": str, "
            "\"direction\": \"prefer|avoid|neutral\", \"confidence\": number, "
            "\"rationale\": str, \"scope\": object}]}. "
            "Confidence is an extraction confidence, not a calibrated probability. "
            "Prefer narrow scope when evidence is local. Use an empty evidence list "
            "when the feedback does not support a preference inference."
        )
        user_prompt = json.dumps(
            {
                "event_type": event.event_type,
                "raw_feedback": event.raw_feedback,
                "task_context": event.task_context.to_dict(),
                "payload": event.payload,
            },
            ensure_ascii=False,
        )
        response = self.client.complete_json(system_prompt, user_prompt)
        items = response.get("evidence", [])
        if not isinstance(items, list):
            raise ValueError("LLM response field 'evidence' must be an array")

        output: list[PreferenceEvidence] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            direction = item.get("direction")
            confidence = float(item.get("confidence", 0.0))
            if direction not in {"prefer", "avoid", "neutral"}:
                continue
            if not 0.0 <= confidence <= 1.0:
                continue
            dimension = str(item.get("dimension", "")).strip()
            if not dimension:
                continue
            scope = item.get("scope", {})
            if not isinstance(scope, dict):
                scope = {}
            output.append(
                PreferenceEvidence(
                    event_id=event.event_id,
                    user_id=event.user_id,
                    dimension=dimension,
                    direction=direction,
                    confidence=confidence,
                    rationale=str(item.get("rationale", "")),
                    scope=scope,
                )
            )
        return output


class DemoInterpreter:
    """Deterministic offline interpreter for the runnable example and tests."""

    def extract(self, event: FeedbackEvent) -> list[PreferenceEvidence]:
        text = event.raw_feedback.lower()
        scope = {
            "task_type": [event.task_context.task_type],
            "genre": [event.task_context.genre] if event.task_context.genre else [],
            "text_type": [event.task_context.text_type] if event.task_context.text_type else [],
        }
        scope = {key: value for key, value in scope.items() if value}
        output: list[PreferenceEvidence] = []

        if any(token in text for token in ("笨拙", "迟疑", "awkward", "hesitant")):
            output.append(
                PreferenceEvidence(
                    event_id=event.event_id,
                    user_id=event.user_id,
                    dimension="narration.voice",
                    direction="prefer",
                    confidence=0.88,
                    rationale="Feedback values preserving deliberate awkwardness or hesitation.",
                    scope=scope,
                )
            )
            output.append(
                PreferenceEvidence(
                    event_id=event.event_id,
                    user_id=event.user_id,
                    dimension="style.polish",
                    direction="avoid",
                    confidence=0.84,
                    rationale="Feedback rejects excessive stylistic polishing.",
                    scope=scope,
                )
            )

        if any(token in text for token in ("不要解释", "增译", "over-explain", "explain")):
            output.append(
                PreferenceEvidence(
                    event_id=event.event_id,
                    user_id=event.user_id,
                    dimension="translation.explanation",
                    direction="avoid",
                    confidence=0.90,
                    rationale="Feedback rejects unstated explanation or expansion.",
                    scope=scope,
                )
            )
        return output


class CandidateFeatureExtractor:
    def __init__(self, client: JsonCompletionClient) -> None:
        self.client = client

    def extract(
        self,
        source_text: str,
        candidate_text: str,
        task_context: dict[str, Any],
    ) -> dict[str, float]:
        system_prompt = (
            "Evaluate a translation candidate against its source. Return JSON only "
            "with a 'features' object. Each value must be numeric from 0 to 1. "
            "Use these dimensions when relevant: source_structure, natural_chinese, "
            "sentence_rhythm, subtlety, over_polish, explicit_explanation, "
            "character_voice. Scores are approximate model assessments, not ground truth."
        )
        user_prompt = json.dumps(
            {
                "source": source_text,
                "candidate": candidate_text,
                "task_context": task_context,
            },
            ensure_ascii=False,
        )
        response = self.client.complete_json(system_prompt, user_prompt)
        features = response.get("features", {})
        if not isinstance(features, dict):
            raise ValueError("LLM response field 'features' must be an object")
        result: dict[str, float] = {}
        for name, value in features.items():
            number = float(value)
            if not 0.0 <= number <= 1.0:
                raise ValueError(f"Feature {name!r} must be between 0 and 1")
            result[str(name)] = number
        return result
