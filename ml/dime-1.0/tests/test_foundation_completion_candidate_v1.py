from __future__ import annotations

import hashlib
import json
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = ML_ROOT / "evidence/execution/dime-foundation-v1-candidate-2400"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_foundation_completion_candidate_is_checksum_bound_and_sanitized() -> None:
    ledger_rows = (EVIDENCE_ROOT / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    assert len(ledger_rows) == 1
    digest, relative = ledger_rows[0].split("  ", maxsplit=1)
    assert relative == "manifest.json"
    assert _sha256(EVIDENCE_ROOT / relative) == digest
    assert {path.name for path in EVIDENCE_ROOT.iterdir()} == {
        "README.md",
        "SHA256SUMS",
        "manifest.json",
    }
    assert not list(EVIDENCE_ROOT.rglob("*.jsonl"))


def test_foundation_completion_candidate_binds_current_inputs() -> None:
    manifest = json.loads((EVIDENCE_ROOT / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["baseline"] == {
        "manifest_sha256": _sha256(ML_ROOT / "configs/dataset_manifest_APPROVED.json"),
        "records": 450,
        "train_sha256": _sha256(ML_ROOT / "data/sft/train.APPROVED.jsonl"),
        "validation_sha256": _sha256(ML_ROOT / "data/sft/validation.APPROVED.jsonl"),
    }
    assert manifest["completion"] == {
        "generator_sha256": _sha256(ML_ROOT / "scripts/generate_foundation_completion_v1.py"),
        "model_revision": "gpt-5.6-sol-2026-07-31",
        "prompt_sha256": _sha256(ML_ROOT / "prompts/foundation_completion_generator_v1.md"),
        "records": 1950,
    }


def test_foundation_completion_candidate_has_exact_release_shape() -> None:
    manifest = json.loads((EVIDENCE_ROOT / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["status"] == "AWAITING_INDEPENDENT_REVIEW_NOT_TRAINABLE"
    assert manifest["release"] == {
        "coverage_counts_from_completion": {
            "abstention_or_error_correction": 360,
            "adversarial_or_false_premise": 240,
            "missing_or_ambiguous_information": 480,
            "multi_turn": 360,
            "temporal_or_freshness_sensitive": 600,
            "tool_required": 720,
        },
        "exact_duplicate_groups": 0,
        "route_counts": {
            "account": 180,
            "bet_explanation": 300,
            "educational": 300,
            "full_slate": 180,
            "general_sports": 180,
            "historical": 240,
            "live_data": 300,
            "matchup": 420,
            "platform": 300,
        },
        "semantic_neighbor_pairs_at_0_92": 0,
        "total_records": 2400,
        "train_records": 2160,
        "train_sha256": "cf1930814d82a2a5ffe7d21700508a38990c9e91c7a09c8d11393559ed8e9e5c",
        "validation_records": 240,
        "validation_sha256": ("150ae63990bf3d918c1f4b31749672b88c01045b1f31701702bd07b295f44b4f"),
    }
    assert manifest["required_next_gate"].startswith("independent review")
    assert manifest["authorization"]
    assert all(value is False for value in manifest["authorization"].values())
