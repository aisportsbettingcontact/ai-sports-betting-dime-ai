from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

import pytest

from dime_ai.foundation_execution_evidence import (
    FoundationExecutionEvidenceError,
    validate_continuation_evidence_document,
)
from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = ML_ROOT / "evidence/execution/dime-llm-v1-foundation-002"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_continuation_evidence_is_sanitized_closed_and_cumulative() -> None:
    evidence = load_governed_json(EVIDENCE_ROOT / "evidence.json")

    validate_continuation_evidence_document(evidence)
    entries = {}
    for row in (EVIDENCE_ROOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative = row.split("  ", maxsplit=1)
        assert relative not in entries
        entries[relative] = digest
    assert set(entries) == {"README.md", "evidence.json"}
    assert all(_sha256(EVIDENCE_ROOT / name) == digest for name, digest in entries.items())
    assert evidence["private_content_counts"] == {
        "foundation_records": 0,
        "semantic_cases": 0,
        "answer_keys": 0,
        "credentials": 0,
    }
    assert evidence["admission"]["admitted_record_count"] == 300
    assert evidence["admission"]["second_live_data_shard"]["record_count"] == 150
    assert set(evidence["combined_gate"]["gates"].values()) == {0}
    assert evidence["combined_gate"]["new_source_coverage"] == {
        "source_packet_count": 5,
        "new_task_type_count": 15,
        "prior_task_type_overlap": 0,
        "public_raw_distribution_authorized": False,
    }
    assert evidence["foundation_deficits"]["remaining_records"] == 2100
    assert evidence["foundation_deficits"]["routes"]["live_data"]["deficit"]["total"] == 0
    assert evidence["semantic_evaluation"]["foundation_to_evaluation_non_overlap"] == {
        "foundation_records": 300,
        "comparisons_completed": 4,
        "pair_comparisons": 195300,
        "disallowed_overlap_count": 0,
        "status": "PASS_ZERO_DISALLOWED_OVERLAP",
    }
    credential = evidence["context_capsule"]["parallel_status"]["credential_execution_closure"]
    assert credential["head_commit"] == "2ca08f7756ecb33485d12bc0464e004f34c0e4c3"
    assert set(credential["triggered_checks"].values()) == {"PASS"}
    assert credential["path_filtered_checks"] == {
        "dime_llm_validation": "NOT_TRIGGERED_PATH_FILTER",
        "livelab": "NOT_TRIGGERED_PATH_FILTER",
    }
    assert credential["independent_approval"] is False
    assert credential["merged"] is False
    assert credential["deployed"] is False
    assert credential["root_trust_provisioned"] is False
    assert credential["effective_authorization"] is False
    assert not list(EVIDENCE_ROOT.rglob("*.jsonl"))


def test_continuation_evidence_rejects_aggregate_drift() -> None:
    evidence = deepcopy(load_governed_json(EVIDENCE_ROOT / "evidence.json"))
    evidence["admission"]["admitted_record_count"] = 299

    with pytest.raises(FoundationExecutionEvidenceError, match="continuation evidence"):
        validate_continuation_evidence_document(evidence)
