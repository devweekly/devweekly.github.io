from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .active_learning import ActivePreferenceQuestionSelector
from .interpreter import DemoInterpreter, FeedbackInterpreter, OpenAICompatibleJsonClient
from .learner import PairwisePreferenceModel
from .resolver import PreferenceResolver
from .store import PreferenceStore
from .types import (
    FeedbackEvent,
    PairwiseSample,
    PreferenceClaim,
    TaskContext,
)


def _scope(task_type: str, genre: str, text_type: str) -> dict[str, list[str]]:
    return {
        "task_type": [task_type],
        "genre": [genre],
        "text_type": [text_type],
    }


def build_demo_samples(user_id: str) -> list[PairwiseSample]:
    """Synthetic preference labels used only to demonstrate the training path."""
    samples: list[PairwiseSample] = []
    examples = [
        (
            "psychological_narration",
            {"source_structure": 0.9, "natural_chinese": 0.6, "subtlety": 0.95, "over_polish": 0.1},
            {"source_structure": 0.6, "natural_chinese": 0.9, "subtlety": 0.55, "over_polish": 0.65},
            "A",
        ),
        (
            "psychological_narration",
            {"source_structure": 0.85, "natural_chinese": 0.7, "subtlety": 0.9, "over_polish": 0.15},
            {"source_structure": 0.55, "natural_chinese": 0.9, "subtlety": 0.5, "over_polish": 0.7},
            "A",
        ),
        (
            "psychological_narration",
            {"source_structure": 0.7, "natural_chinese": 0.75, "subtlety": 0.9, "over_polish": 0.2},
            {"source_structure": 0.5, "natural_chinese": 0.95, "subtlety": 0.45, "over_polish": 0.75},
            "A",
        ),
        (
            "dialogue",
            {"source_structure": 0.9, "natural_chinese": 0.55, "subtlety": 0.7, "over_polish": 0.15},
            {"source_structure": 0.65, "natural_chinese": 0.95, "subtlety": 0.7, "over_polish": 0.2},
            "B",
        ),
        (
            "dialogue",
            {"source_structure": 0.85, "natural_chinese": 0.6, "subtlety": 0.7, "over_polish": 0.2},
            {"source_structure": 0.6, "natural_chinese": 0.9, "subtlety": 0.72, "over_polish": 0.25},
            "B",
        ),
    ]
    for text_type, features_a, features_b, chosen in examples:
        samples.append(
            PairwiseSample(
                user_id=user_id,
                context={
                    "task_type": "translation_review",
                    "genre": "literary-fiction",
                    "text_type": text_type,
                    "language_pair": "en->zh-CN",
                },
                features_a=features_a,
                features_b=features_b,
                chosen=chosen,
            )
        )
    return samples


def run_demo(database: str, use_llm: bool = False) -> dict[str, object]:
    store = PreferenceStore(database)
    user_id = "reader-demo"
    psychological_task = TaskContext(
        user_id=user_id,
        task_type="translation_review",
        genre="literary-fiction",
        text_type="psychological_narration",
        source_language="en",
        target_language="zh-CN",
        project_id="novel-001",
    )

    # Stage 1: explicit user rules become scoped Preference Claims.
    explicit_event = FeedbackEvent(
        user_id=user_id,
        event_type="explicit_rule",
        raw_feedback="文学翻译不要擅自解释原文没有表达的心理活动。",
        task_context=psychological_task,
    )
    store.record_event(explicit_event)
    explicit_claim = store.create_claim(
        PreferenceClaim(
            user_id=user_id,
            dimension="translation.explanation",
            value="avoid_unstated_psychological_explanation",
            strength=1.0,
            confidence=1.0,
            scope={"task_type": ["translation_review"], "genre": ["literary-fiction"]},
            source_kind="explicit",
            valid_from=psychological_task.timestamp,
            supporting_event_ids=(explicit_event.event_id,),
        )
    )

    # Stage 2: interpret natural-language feedback into evidence.
    feedback_event = FeedbackEvent(
        user_id=user_id,
        event_type="negative_feedback",
        raw_feedback="这个翻译太聪明了，反而没有原文那种笨拙、迟疑的感觉。",
        task_context=psychological_task,
        payload={"source_segment_id": "segment-003", "candidate_id": "candidate-B"},
    )
    store.record_event(feedback_event)

    if use_llm:
        client = OpenAICompatibleJsonClient()
        interpreter = FeedbackInterpreter(client)
    else:
        interpreter = DemoInterpreter()

    evidence_items = interpreter.extract(feedback_event)
    claims = [explicit_claim]
    for evidence in evidence_items:
        store.record_evidence(evidence)
        claim_value = (
            f"prefer_{evidence.dimension.replace('.', '_')}"
            if evidence.direction == "prefer"
            else f"avoid_{evidence.dimension.replace('.', '_')}"
        )
        new_claim = store.create_claim(
            PreferenceClaim(
                user_id=user_id,
                dimension=evidence.dimension,
                value=claim_value,
                strength=evidence.confidence,
                confidence=evidence.confidence,
                scope=evidence.scope,
                source_kind="inferred",
                valid_from=psychological_task.timestamp,
                supporting_event_ids=(feedback_event.event_id,),
            )
        )
        claims.append(new_claim)

    # Stage 3: train a small pairwise preference model.
    pairwise_samples = build_demo_samples(user_id)
    for sample in pairwise_samples:
        store.record_pairwise_sample(sample)

    model = PairwisePreferenceModel(learning_rate=0.08, epochs=400)
    model.fit_hierarchical(pairwise_samples)

    # Stage 4: resolve which preference claims apply to the current task.
    resolver = PreferenceResolver(
        store=store,
        minimum_claim_confidence=0.55,
        question_selector=ActivePreferenceQuestionSelector(
            uncertainty_band=0.12,
            minimum_task_impact=0.60,
            minimum_user_samples=2,
        ),
    )
    snapshot = resolver.resolve(
        task=psychological_task,
        claims=store.list_active_claims(user_id),
        preference_model=model,
        candidate_features=(
            {"source_structure": 0.9, "natural_chinese": 0.65, "subtlety": 0.95, "over_polish": 0.1},
            {"source_structure": 0.6, "natural_chinese": 0.9, "subtlety": 0.55, "over_polish": 0.65},
        ),
        task_impact=0.9,
        clarification_question="这段独白你更想保留原文的笨拙和迟疑，还是优先改成更自然流畅的中文？",
    )

    result = {
        "database": str(Path(database).resolve()),
        "event_count": store.get_event_count(user_id),
        "evidence_count": store.get_evidence_count(user_id),
        "pairwise_sample_count": len(pairwise_samples),
        "snapshot": snapshot,
        "note": (
            "Demo data is synthetic. Replace DemoInterpreter with a Jev adapter, "
            "collect real pairwise choices, and calibrate confidence on held-out user data."
        ),
    }
    store.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the staged personal preference model demo")
    parser.add_argument(
        "--db",
        default=os.getenv("PREFERENCE_DB", "/tmp/personal-preference-model.sqlite3"),
        help="SQLite database file",
    )
    parser.add_argument(
        "--use-llm",
        action="store_true",
        help="Use the OpenAI-compatible LLM endpoint configured through environment variables",
    )
    args = parser.parse_args()
    print(json.dumps(run_demo(args.db, use_llm=args.use_llm), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
