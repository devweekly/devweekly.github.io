from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from personal_preference_model.active_learning import ActivePreferenceQuestionSelector
from personal_preference_model.interpreter import DemoInterpreter
from personal_preference_model.learner import PairwisePreferenceModel
from personal_preference_model.resolver import PreferenceResolver
from personal_preference_model.store import PreferenceStore
from personal_preference_model.validation import EvidencePromotionPolicy
from personal_preference_model.types import (
    FeedbackEvent,
    PairwiseSample,
    PreferenceClaim,
    TaskContext,
)


class PreferencePipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp_dir.name) / "test.sqlite3")
        self.store = PreferenceStore(self.db_path)
        self.task = TaskContext(
            user_id="u1",
            task_type="translation_review",
            genre="literary-fiction",
            text_type="psychological_narration",
            source_language="en",
            target_language="zh-CN",
            project_id="book-1",
        )

    def tearDown(self) -> None:
        self.store.close()
        self.temp_dir.cleanup()

    def test_feedback_interpreter_extracts_local_evidence(self) -> None:
        event = FeedbackEvent(
            user_id="u1",
            event_type="negative_feedback",
            raw_feedback="这句失去了原文笨拙、迟疑的感觉，润色过度。",
            task_context=self.task,
        )
        evidence = DemoInterpreter().extract(event)
        dimensions = {item.dimension for item in evidence}
        self.assertIn("narration.voice", dimensions)
        self.assertIn("style.polish", dimensions)

    def test_evidence_promotion_rejects_weak_or_unscoped_inference(self) -> None:
        event = FeedbackEvent(
            user_id="u1",
            event_type="negative_feedback",
            raw_feedback="The style feels over-polished.",
            task_context=self.task,
        )
        from personal_preference_model.types import PreferenceEvidence

        policy = EvidencePromotionPolicy(minimum_confidence=0.75)
        weak = PreferenceEvidence(
            event_id=event.event_id,
            user_id="u1",
            dimension="style.polish",
            direction="avoid",
            confidence=0.52,
            rationale="Low confidence candidate.",
            scope={"text_type": ["psychological_narration"]},
        )
        unscoped = PreferenceEvidence(
            event_id=event.event_id,
            user_id="u1",
            dimension="style.polish",
            direction="avoid",
            confidence=0.95,
            rationale="No context boundary.",
            scope={},
        )
        self.assertEqual(policy.evaluate(weak).reason, "LOW_EXTRACTION_CONFIDENCE")
        self.assertEqual(policy.evaluate(unscoped).reason, "UNSCOPED_INFERRED_EVIDENCE")

    def test_evidence_promotion_accepts_scoped_strong_evidence(self) -> None:
        from personal_preference_model.types import PreferenceEvidence

        evidence = PreferenceEvidence(
            event_id="event-1",
            user_id="u1",
            dimension="style.polish",
            direction="avoid",
            confidence=0.90,
            rationale="The user rejects over-polishing.",
            scope={"text_type": ["psychological_narration"]},
        )
        decision = EvidencePromotionPolicy().evaluate(evidence)
        self.assertTrue(decision.approved)
        self.assertEqual(decision.reason, "VALIDATED")

    def test_evidence_cannot_reference_another_users_event(self) -> None:
        event = FeedbackEvent(
            user_id="u1",
            event_type="negative_feedback",
            raw_feedback="Over-polished.",
            task_context=self.task,
        )
        self.store.record_event(event)
        from personal_preference_model.types import PreferenceEvidence

        evidence = PreferenceEvidence(
            event_id=event.event_id,
            user_id="u2",
            dimension="style.polish",
            direction="avoid",
            confidence=0.9,
            rationale="Cross-user reference must be rejected.",
            scope={"text_type": ["psychological_narration"]},
        )
        with self.assertRaisesRegex(ValueError, "same source Event user_id"):
            self.store.record_evidence(evidence)

    def test_claim_cannot_reference_another_users_event(self) -> None:
        event = FeedbackEvent(
            user_id="u2",
            event_type="explicit_rule",
            raw_feedback="Prefer restrained prose.",
            task_context=TaskContext(
                user_id="u2",
                task_type="translation_review",
                genre="literary-fiction",
                text_type="psychological_narration",
            ),
        )
        self.store.record_event(event)
        claim = PreferenceClaim(
            user_id="u1",
            dimension="style.polish",
            value="prefer_restrained",
            strength=0.8,
            confidence=0.9,
            scope={"text_type": ["psychological_narration"]},
            source_kind="inferred",
            valid_from=self.task.timestamp,
            supporting_event_ids=(event.event_id,),
        )
        with self.assertRaisesRegex(ValueError, "same user"):
            self.store.create_claim(claim)

    def test_resolver_rejects_claim_from_another_user(self) -> None:
        claim = PreferenceClaim(
            user_id="u2",
            dimension="narration.subtlety",
            value="preserve_implicit_emotion",
            strength=0.8,
            confidence=0.95,
            scope={"text_type": ["psychological_narration"]},
            source_kind="inferred",
            valid_from=self.task.timestamp,
        )
        snapshot = PreferenceResolver(self.store).resolve(self.task, [claim])
        self.assertEqual(snapshot["applied"], [])
        self.assertEqual(snapshot["excluded"][0]["reason"], "USER_MISMATCH")

    def test_scope_mismatch_is_excluded(self) -> None:
        dialogue_claim = PreferenceClaim(
            user_id="u1",
            dimension="dialogue.colloquiality",
            value="prefer_natural_dialogue",
            strength=0.8,
            confidence=0.9,
            scope={"text_type": ["dialogue"]},
            source_kind="inferred",
            valid_from=self.task.timestamp,
        )
        self.store.create_claim(dialogue_claim)
        snapshot = PreferenceResolver(self.store).resolve(
            self.task,
            self.store.list_active_claims("u1"),
        )
        self.assertEqual(snapshot["applied"], [])
        self.assertEqual(snapshot["excluded"][0]["reason"], "SCOPE_MISMATCH")

    def test_matching_claim_is_applied(self) -> None:
        claim = PreferenceClaim(
            user_id="u1",
            dimension="narration.subtlety",
            value="preserve_implicit_emotion",
            strength=0.8,
            confidence=0.9,
            scope={"text_type": ["psychological_narration"]},
            source_kind="inferred",
            valid_from=self.task.timestamp,
        )
        self.store.create_claim(claim)
        snapshot = PreferenceResolver(self.store).resolve(
            self.task,
            self.store.list_active_claims("u1"),
        )
        self.assertEqual(len(snapshot["applied"]), 1)
        self.assertEqual(snapshot["applied"][0]["dimension"], "narration.subtlety")

    def test_current_override_excludes_matching_claim(self) -> None:
        claim = PreferenceClaim(
            user_id="u1",
            dimension="sentence.rhythm",
            value="prefer_short_sentences",
            strength=0.7,
            confidence=0.9,
            scope={"task_type": ["translation_review"]},
            source_kind="inferred",
            valid_from=self.task.timestamp,
        )
        self.store.create_claim(claim)
        override_task = TaskContext(
            user_id="u1",
            task_type="translation_review",
            genre="literary-fiction",
            text_type="psychological_narration",
            source_language="en",
            target_language="zh-CN",
            explicit_overrides=("sentence.rhythm",),
        )
        snapshot = PreferenceResolver(self.store).resolve(
            override_task,
            self.store.list_active_claims("u1"),
        )
        self.assertEqual(snapshot["excluded"][0]["reason"], "CURRENT_EXPLICIT_OVERRIDE")

    def test_store_claim_revision_keeps_old_version(self) -> None:
        first = PreferenceClaim(
            user_id="u1",
            dimension="style.polish",
            value="avoid_polish",
            strength=0.8,
            confidence=0.7,
            scope={"genre": ["literary-fiction"]},
            source_kind="inferred",
            valid_from=self.task.timestamp,
        )
        second = PreferenceClaim(
            user_id="u1",
            dimension="style.polish",
            value="moderate_polish",
            strength=0.5,
            confidence=0.9,
            scope={"genre": ["literary-fiction"]},
            source_kind="explicit",
            valid_from=self.task.timestamp,
        )
        self.store.create_claim(first)
        saved_second = self.store.create_claim(second)
        self.assertEqual(saved_second.revision, 2)
        active = self.store.list_active_claims("u1")
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].value, "moderate_polish")

    def test_pairwise_model_learns_simple_preference(self) -> None:
        samples = [
            PairwiseSample(
                user_id="u1",
                context={"text_type": "psychological_narration"},
                features_a={"subtlety": 0.95, "naturalness": 0.5, "over_polish": 0.1},
                features_b={"subtlety": 0.4, "naturalness": 0.9, "over_polish": 0.8},
                chosen="A",
            )
            for _ in range(12)
        ]
        model = PairwisePreferenceModel(learning_rate=0.1, epochs=300)
        model.fit_hierarchical(samples)
        estimate = model.predict(
            "u1",
            {"subtlety": 0.9, "naturalness": 0.6, "over_polish": 0.1},
            {"subtlety": 0.4, "naturalness": 0.9, "over_polish": 0.8},
            {"text_type": "psychological_narration"},
        )
        self.assertGreater(estimate["probability_a_preferred"], 0.5)

    def test_active_learning_asks_on_cold_start(self) -> None:
        selector = ActivePreferenceQuestionSelector()
        decision = selector.select(
            probability_a=0.51,
            task_impact=0.9,
            user_sample_count=0,
            question="Which translation do you prefer?",
        )
        self.assertTrue(decision.should_ask)
        self.assertEqual(decision.reason, "COLD_START_PREFERENCE")


if __name__ == "__main__":
    unittest.main()
