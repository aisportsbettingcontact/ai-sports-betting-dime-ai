from __future__ import annotations

import hashlib
from pathlib import Path

from dime_ai.foundation_execution_evidence import validate_evidence_document
from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[1]
FOUNDATION_ROOT = ML_ROOT / "evidence/execution/dime-llm-v1-foundation-001"
CAPSULE_ROOT = ML_ROOT / "evidence/execution/dime-llm-v1-context-capsule"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_sums(root: Path) -> None:
    entries = {}
    for line in (root / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative = line.split("  ", maxsplit=1)
        assert relative not in entries
        entries[relative] = digest
    assert set(entries) == {
        path.name for path in root.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    }
    for relative, digest in entries.items():
        assert _sha256(root / relative) == digest


def test_foundation_execution_evidence_is_sanitized_and_checksum_bound() -> None:
    evidence = load_governed_json(FOUNDATION_ROOT / "evidence.json")

    validate_evidence_document(evidence)
    _verify_sums(FOUNDATION_ROOT)
    assert evidence["private_content_counts"] == {
        "answer_keys": 0,
        "credentials": 0,
        "foundation_records": 0,
        "semantic_cases": 0,
    }
    assert evidence["admission"]["pilot"]["decision"] == "NOT_ADMITTED"
    assert evidence["admission"]["first_live_data_shard"]["decision"] == "ADMITTED"
    assert evidence["admission"]["admitted_record_count"] == 150
    assert evidence["foundation_deficits"]["remaining_records"] == 2250
    assert evidence["semantic_evaluation"]["partition_counts"] == {
        "development": 270,
        "sealed_critical": 81,
        "locked": 180,
        "general_regression": 120,
    }
    assert evidence["semantic_evaluation"]["answer_key_case_count"] == 0
    assert evidence["semantic_evaluation"]["answer_key_artifact_count"] == 0
    assert evidence["semantic_evaluation"]["four_way_non_overlap"] == {
        "comparisons_completed": 4,
        "pair_comparisons": 97650,
        "disallowed_overlap_count": 0,
        "status": "PASS_ZERO_DISALLOWED_OVERLAP",
    }
    assert not list(FOUNDATION_ROOT.rglob("*.jsonl"))


def test_context_capsule_is_current_closed_and_bound_to_foundation_evidence() -> None:
    capsule = load_governed_json(CAPSULE_ROOT / "capsule.json")

    _verify_sums(CAPSULE_ROOT)
    assert capsule["production_baseline"]["pull_request"] == 250
    assert capsule["production_baseline"]["merge_commit"] == (
        "7ed09adb4fcdb9e2d9047e73e34f84c80d865b78"
    )
    assert capsule["parallel_tracks"]["track_f"]["pull_request"] == 251
    assert capsule["parallel_tracks"]["track_f"]["state"] == "OPEN_DRAFT"
    assert capsule["parallel_tracks"]["track_f"]["head_commit"] == (
        "9edff5ee4317cdce0b2a79e2fe78d2ff8c7d5916"
    )
    assert capsule["parallel_tracks"]["track_f"]["required_checks"] == "PASS"
    assert capsule["parallel_tracks"]["track_e"]["pull_request"] == 252
    assert capsule["parallel_tracks"]["track_e"]["state"] == "OPEN_DRAFT"
    assert capsule["parallel_tracks"]["track_e"]["head_commit"] == (
        "d420b4526b89ca649537180101be5633389e55f6"
    )
    assert capsule["parallel_tracks"]["track_e"]["required_checks"] == "PASS"
    assert capsule["parallel_tracks"]["track_e"]["answer_keys_present"] is False
    assert capsule["parallel_tracks"]["runpod_gate_1"]["pull_request"] == 253
    assert capsule["parallel_tracks"]["runpod_gate_1"]["head_commit"] == (
        "3e406ac273cafcaf9d85c19b591ca09fb802219e"
    )
    assert capsule["parallel_tracks"]["runpod_gate_1"]["checks"]["remaining_ci"] == "PENDING"
    assert capsule["parallel_tracks"]["runpod_gate_1"]["effective_authorization"] is False
    assert capsule["security_p1"]["status"] == "OPEN_REMEDIATION_REQUIRED"
    assert capsule["credential_execution_p1"]["status"] == "BLOCKED_ROOT_TRUST_UNPROVISIONED"
    assert capsule["credential_execution_p1"]["root_trust_provisioned"] is False
    assert capsule["runpod_gate_1"]["authorization"] == "NONE"
    assert capsule["runpod_gate_1"]["effective_authorization"] is False
    assert capsule["runpod_gate_1"]["gate_1_baseline_inference_authorized"] is False
    assert capsule["foundation"]["public_evidence"]["sha256"] == _sha256(
        FOUNDATION_ROOT / "evidence.json"
    )
    assert capsule["private_content_counts"] == {
        "foundation_records": 0,
        "semantic_cases": 0,
        "answer_keys": 0,
        "credentials": 0,
    }
    assert all(value is False for value in capsule["authorization_boundary"].values())
    assert not list(CAPSULE_ROOT.rglob("*.jsonl"))
