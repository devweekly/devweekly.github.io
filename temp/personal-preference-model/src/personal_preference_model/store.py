from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from .types import (
    FeedbackEvent,
    PairwiseSample,
    PreferenceClaim,
    PreferenceEvidence,
    TaskContext,
    utc_now,
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


class PreferenceStore:
    """SQLite system-of-record for events, evidence, claims and decisions.

    The example is single-process and local-first. For production, replace this
    repository with PostgreSQL and enforce user/tenant isolation in the database.
    """

    def __init__(self, path: str | Path = "preference_model.sqlite3") -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._create_schema()

    def _create_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                raw_feedback TEXT NOT NULL,
                task_context_json TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS evidence (
                evidence_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES events(event_id),
                user_id TEXT NOT NULL,
                dimension TEXT NOT NULL,
                direction TEXT NOT NULL,
                confidence REAL NOT NULL,
                rationale TEXT NOT NULL,
                scope_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS claims (
                claim_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                dimension TEXT NOT NULL,
                value TEXT NOT NULL,
                strength REAL NOT NULL,
                confidence REAL NOT NULL,
                scope_json TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                valid_from TEXT NOT NULL,
                valid_to TEXT,
                status TEXT NOT NULL,
                revision INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                supersedes_id TEXT,
                superseded_by TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_claims_user_status
                ON claims(user_id, status);

            CREATE TABLE IF NOT EXISTS claim_evidence (
                claim_id TEXT NOT NULL REFERENCES claims(claim_id),
                event_id TEXT NOT NULL REFERENCES events(event_id),
                polarity TEXT NOT NULL,
                PRIMARY KEY (claim_id, event_id, polarity)
            );

            CREATE TABLE IF NOT EXISTS pairwise_samples (
                sample_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                context_json TEXT NOT NULL,
                features_a_json TEXT NOT NULL,
                features_b_json TEXT NOT NULL,
                chosen TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS snapshots (
                snapshot_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                task_context_json TEXT NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "PreferenceStore":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def record_event(self, event: FeedbackEvent) -> None:
        self._conn.execute(
            """
            INSERT INTO events(
                event_id, user_id, event_type, occurred_at,
                raw_feedback, task_context_json, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.event_id,
                event.user_id,
                event.event_type,
                event.occurred_at,
                event.raw_feedback,
                _json(event.task_context.to_dict()),
                _json(event.payload),
            ),
        )
        self._conn.commit()

    def record_evidence(self, evidence: PreferenceEvidence) -> None:
        self._conn.execute(
            """
            INSERT INTO evidence(
                evidence_id, event_id, user_id, dimension, direction,
                confidence, rationale, scope_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                evidence.evidence_id,
                evidence.event_id,
                evidence.user_id,
                evidence.dimension,
                evidence.direction,
                evidence.confidence,
                evidence.rationale,
                _json(evidence.scope),
            ),
        )
        self._conn.commit()

    def create_claim(self, claim: PreferenceClaim) -> PreferenceClaim:
        """Create a new revision and retain the previous claim as superseded."""
        scope_json = _json(claim.scope)
        previous = self._conn.execute(
            """
            SELECT claim_id, revision FROM claims
            WHERE user_id = ? AND dimension = ? AND scope_json = ? AND status = 'active'
            ORDER BY revision DESC LIMIT 1
            """,
            (claim.user_id, claim.dimension, scope_json),
        ).fetchone()

        revision = (int(previous["revision"]) + 1) if previous else 1
        supersedes_id = previous["claim_id"] if previous else None

        self._conn.execute(
            """
            INSERT INTO claims(
                claim_id, user_id, dimension, value, strength, confidence,
                scope_json, source_kind, valid_from, valid_to, status,
                revision, created_at, supersedes_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                claim.claim_id,
                claim.user_id,
                claim.dimension,
                claim.value,
                claim.strength,
                claim.confidence,
                scope_json,
                claim.source_kind,
                claim.valid_from,
                claim.valid_to,
                claim.status,
                revision,
                utc_now(),
                supersedes_id,
            ),
        )

        if previous:
            self._conn.execute(
                "UPDATE claims SET status = 'superseded', superseded_by = ? WHERE claim_id = ?",
                (claim.claim_id, supersedes_id),
            )

        for event_id in claim.supporting_event_ids:
            self._conn.execute(
                "INSERT OR IGNORE INTO claim_evidence(claim_id, event_id, polarity) VALUES (?, ?, 'support')",
                (claim.claim_id, event_id),
            )
        for event_id in claim.refuting_event_ids:
            self._conn.execute(
                "INSERT OR IGNORE INTO claim_evidence(claim_id, event_id, polarity) VALUES (?, ?, 'refute')",
                (claim.claim_id, event_id),
            )

        self._conn.commit()
        return PreferenceClaim(
            user_id=claim.user_id,
            dimension=claim.dimension,
            value=claim.value,
            strength=claim.strength,
            confidence=claim.confidence,
            scope=claim.scope,
            source_kind=claim.source_kind,
            valid_from=claim.valid_from,
            valid_to=claim.valid_to,
            status=claim.status,
            claim_id=claim.claim_id,
            revision=revision,
            supporting_event_ids=claim.supporting_event_ids,
            refuting_event_ids=claim.refuting_event_ids,
        )

    def list_active_claims(self, user_id: str) -> list[PreferenceClaim]:
        rows = self._conn.execute(
            """
            SELECT * FROM claims
            WHERE user_id = ? AND status = 'active'
            ORDER BY dimension, revision DESC
            """,
            (user_id,),
        ).fetchall()

        results: list[PreferenceClaim] = []
        for row in rows:
            evidence = self._conn.execute(
                """
                SELECT event_id, polarity FROM claim_evidence
                WHERE claim_id = ?
                """,
                (row["claim_id"],),
            ).fetchall()
            support = tuple(x["event_id"] for x in evidence if x["polarity"] == "support")
            refute = tuple(x["event_id"] for x in evidence if x["polarity"] == "refute")
            results.append(
                PreferenceClaim(
                    user_id=row["user_id"],
                    dimension=row["dimension"],
                    value=row["value"],
                    strength=float(row["strength"]),
                    confidence=float(row["confidence"]),
                    scope=json.loads(row["scope_json"]),
                    source_kind=row["source_kind"],
                    valid_from=row["valid_from"],
                    valid_to=row["valid_to"],
                    status=row["status"],
                    claim_id=row["claim_id"],
                    revision=int(row["revision"]),
                    supporting_event_ids=support,
                    refuting_event_ids=refute,
                )
            )
        return results

    def record_pairwise_sample(self, sample: PairwiseSample) -> None:
        self._conn.execute(
            """
            INSERT INTO pairwise_samples(
                sample_id, user_id, context_json, features_a_json,
                features_b_json, chosen, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sample.sample_id,
                sample.user_id,
                _json(sample.context),
                _json(sample.features_a),
                _json(sample.features_b),
                sample.chosen,
                sample.created_at,
            ),
        )
        self._conn.commit()

    def list_pairwise_samples(self, user_id: str | None = None) -> list[PairwiseSample]:
        if user_id:
            rows = self._conn.execute(
                "SELECT * FROM pairwise_samples WHERE user_id = ? ORDER BY created_at",
                (user_id,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM pairwise_samples ORDER BY created_at"
            ).fetchall()

        return [
            PairwiseSample(
                user_id=row["user_id"],
                context=json.loads(row["context_json"]),
                features_a=json.loads(row["features_a_json"]),
                features_b=json.loads(row["features_b_json"]),
                chosen=row["chosen"],
                sample_id=row["sample_id"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def save_snapshot(self, snapshot: dict[str, Any]) -> None:
        self._conn.execute(
            """
            INSERT INTO snapshots(snapshot_id, user_id, task_context_json, snapshot_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                snapshot["snapshot_id"],
                snapshot["user_id"],
                _json(snapshot["task_context"]),
                _json(snapshot),
                snapshot["created_at"],
            ),
        )
        self._conn.commit()

    def get_event_count(self, user_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS count FROM events WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return int(row["count"])

    def get_evidence_count(self, user_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS count FROM evidence WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return int(row["count"])
