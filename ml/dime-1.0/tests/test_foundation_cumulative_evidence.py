from __future__ import annotations

import hashlib
import os
from copy import deepcopy
from pathlib import Path

import pytest

from dime_ai.foundation_cumulative_evidence import (
    FoundationExecutionEvidenceError,
    _compare_delta_to_prior,
    validate_cumulative_boundary_manifest,
    validate_cumulative_evidence_document,
)
from dime_ai.foundation_execution_evidence import secure_inventory
from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_PATH = ML_ROOT / "configs/foundation_cumulative_boundary_450_v1.json"
EVIDENCE_ROOT = ML_ROOT / "evidence/execution/dime-llm-v1-foundation-003"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _evidence() -> dict:
    value = load_governed_json(EVIDENCE_ROOT / "evidence.json")
    assert isinstance(value, dict)
    return value


def test_incremental_boundary_and_evidence_are_closed_and_checksum_bound() -> None:
    boundary = load_governed_json(BOUNDARY_PATH)
    evidence = _evidence()

    validate_cumulative_boundary_manifest(boundary)
    validate_cumulative_evidence_document(evidence)
    entries = {}
    for row in (EVIDENCE_ROOT / "SHA256SUMS").read_text(encoding="ascii").splitlines():
        digest, relative = row.split("  ", maxsplit=1)
        assert relative not in entries
        entries[relative] = digest
    assert entries == {
        "README.md": _sha256(EVIDENCE_ROOT / "README.md"),
        "evidence.json": _sha256(EVIDENCE_ROOT / "evidence.json"),
    }
    assert evidence["boundary_manifest"]["sha256"] == _sha256(BOUNDARY_PATH)
    assert evidence["admission"]["prior_admitted_records"] == 300
    assert evidence["admission"]["delta_admitted_records"] == 150
    assert evidence["admission"]["cumulative_admitted_records"] == 450
    assert evidence["admission"]["quarantined_admitted_records"] == 0
    assert evidence["semantic_evaluation"]["prior_pair_comparisons_reused"] == 195300
    assert evidence["semantic_evaluation"]["delta_pair_comparisons_new"] == 97650
    assert evidence["semantic_evaluation"]["cumulative_pair_comparisons_reconciled"] == 292950
    assert evidence["foundation_deficits"]["remaining_records"] == 1950
    assert not list(EVIDENCE_ROOT.rglob("*.jsonl"))


@pytest.mark.parametrize(
    ("path", "replacement"),
    [
        (("boundary_manifest", "sha256"), "0" * 64),
        (("lineage", "parent_state_sha256"), "1" * 64),
        (("lineage", "delta_identity_sha256"), "2" * 64),
        (("lineage", "cumulative_state_sha256"), "3" * 64),
        (
            (
                "private_inventory_bindings",
                "delta_artifact",
                "bindings",
                "trainer_manifest_sha256",
            ),
            "4" * 64,
        ),
        (
            ("semantic_evaluation", "bindings", "manifest_sha256"),
            "5" * 64,
        ),
        (
            (
                "admission",
                "delta",
                "bindings",
                "source_packet_content_inventory_sha256",
            ),
            "6" * 64,
        ),
        (
            (
                "private_inventory_bindings",
                "delta_artifact",
                "bindings",
                "source_packet_content_inventory_sha256",
            ),
            "7" * 64,
        ),
        (
            (
                "private_inventory_bindings",
                "prior_artifacts",
                "0",
                "inventory",
                "sha256sums_sha256",
            ),
            "8" * 64,
        ),
        (
            ("semantic_evaluation", "semantic_inventory", "sha256sums_sha256"),
            "9" * 64,
        ),
        (
            (
                "private_inventory_bindings",
                "semantic_r5",
                "sha256sums_sha256",
            ),
            "b" * 64,
        ),
        (
            (
                "private_inventory_bindings",
                "prior_artifacts",
                "0",
                "inventory",
                "payload_byte_count",
            ),
            1,
        ),
        (
            (
                "private_inventory_bindings",
                "quarantines",
                "0",
                "inventory",
                "payload_byte_count",
            ),
            1,
        ),
        (("quarantines", "0", "receipt_sha256"), "a" * 64),
    ],
)
def test_incremental_evidence_rejects_manifest_and_lineage_drift(
    path: tuple[str, ...],
    replacement: str,
) -> None:
    evidence = deepcopy(_evidence())
    target = evidence
    for key in path[:-1]:
        target = target[int(key)] if isinstance(target, list) else target[key]
    target[path[-1]] = replacement

    with pytest.raises(FoundationExecutionEvidenceError, match="drifted"):
        validate_cumulative_evidence_document(evidence)


def test_incremental_evidence_rejects_quarantine_assurance_role_swap() -> None:
    evidence = deepcopy(_evidence())
    evidence["quarantines"][0]["process_assurance"] = "POINT_IN_TIME_ONLY_NO_CONTAINMENT_CLAIM"
    evidence["quarantines"][1]["process_assurance"] = "SELF_AUTHORED_NOT_INDEPENDENT"

    with pytest.raises(FoundationExecutionEvidenceError, match="inventory drifted"):
        validate_cumulative_evidence_document(evidence)


def test_incremental_evidence_rejects_unknown_reported_gate() -> None:
    evidence = deepcopy(_evidence())
    evidence["admission"]["delta"]["reported_gates"]["unexpected_gate"] = 0

    with pytest.raises(FoundationExecutionEvidenceError, match="reported_gates"):
        validate_cumulative_evidence_document(evidence)


@pytest.mark.parametrize("gate", ["training", "publication", "railway_mutation"])
def test_incremental_evidence_rejects_open_or_missing_authority(gate: str) -> None:
    opened = deepcopy(_evidence())
    opened["context_capsule"]["authorization_boundary"][gate] = True
    with pytest.raises(FoundationExecutionEvidenceError, match="authorization_boundary"):
        validate_cumulative_evidence_document(opened)

    omitted = deepcopy(_evidence())
    del omitted["context_capsule"]["authorization_boundary"][gate]
    with pytest.raises(FoundationExecutionEvidenceError, match="authorization_boundary"):
        validate_cumulative_evidence_document(omitted)


def test_incremental_evidence_rejects_sensitive_keys_values_and_record_ids() -> None:
    sensitive_key = deepcopy(_evidence())
    sensitive_key["private_content_counts"]["api_key"] = 0
    with pytest.raises(FoundationExecutionEvidenceError, match="sensitive key"):
        validate_cumulative_evidence_document(sensitive_key)

    sensitive_value = deepcopy(_evidence())
    sensitive_value["semantic_evaluation"]["semantic_manifest_blocker"] = (
        "team@aisportsbettingmodels.com"
    )
    with pytest.raises(FoundationExecutionEvidenceError, match="sensitive value"):
        validate_cumulative_evidence_document(sensitive_value)

    record_id = deepcopy(_evidence())
    record_id["semantic_evaluation"]["semantic_manifest_blocker"] = (
        "prefix private-record-001 suffix"
    )
    with pytest.raises(FoundationExecutionEvidenceError, match="sensitive value"):
        validate_cumulative_evidence_document(
            record_id,
            forbidden_identifiers={"private-record-001"},
        )

    absolute_path = deepcopy(_evidence())
    absolute_path["semantic_evaluation"]["semantic_manifest_blocker"] = (
        "unexpected /private/tmp/private-records path"
    )
    with pytest.raises(FoundationExecutionEvidenceError, match="sensitive value"):
        validate_cumulative_evidence_document(absolute_path)


def test_incremental_evidence_rejects_derived_aggregate_drift() -> None:
    route_drift = deepcopy(_evidence())
    route_drift["foundation_deficits"]["routes"]["platform"]["admitted"]["total"] = 149
    with pytest.raises(FoundationExecutionEvidenceError, match="binding drifted"):
        validate_cumulative_evidence_document(route_drift)

    partition_drift = deepcopy(_evidence())
    partition_drift["semantic_evaluation"]["delta_partition_comparisons"]["development"][
        "pair_comparisons"
    ] = 40499
    with pytest.raises(FoundationExecutionEvidenceError, match="binding drifted"):
        validate_cumulative_evidence_document(partition_drift)


def test_incremental_boundary_rejects_extra_route_and_coverage_dimensions() -> None:
    extra_route = deepcopy(load_governed_json(BOUNDARY_PATH))
    extra_route["delta_artifact"]["route_split_counts"]["account"] = {
        "train": 0,
        "validation": 0,
    }
    with pytest.raises(FoundationExecutionEvidenceError, match="route_split_counts"):
        validate_cumulative_boundary_manifest(extra_route)

    extra_coverage = deepcopy(load_governed_json(BOUNDARY_PATH))
    extra_coverage["delta_artifact"]["coverage_minima"]["unreviewed_dimension"] = 0
    with pytest.raises(FoundationExecutionEvidenceError, match="coverage_minima"):
        validate_cumulative_boundary_manifest(extra_coverage)


def test_delta_to_parent_comparator_counts_only_cross_boundary_pairs() -> None:
    prior = [
        {
            "example_id": "prior-1",
            "messages": [{"role": "user", "content": "alpha beta gamma"}],
        },
        {
            "example_id": "prior-2",
            "messages": [{"role": "user", "content": "delta epsilon zeta"}],
        },
    ]
    delta = [
        {
            "example_id": "delta-1",
            "messages": [{"role": "user", "content": "unique theta lambda"}],
        }
    ]

    result = _compare_delta_to_prior(prior, delta, shingle_size=2, threshold=0.92)

    assert result == {
        "pair_comparisons": 2,
        "exact_duplicates": 0,
        "semantic_duplicates": 0,
    }


def test_secure_inventory_rejects_hardlinks(tmp_path: Path) -> None:
    root = tmp_path / "private"
    root.mkdir(mode=0o700)
    payload = root / "payload.json"
    payload.write_text("{}\n", encoding="utf-8")
    payload.chmod(0o600)
    checksum = _sha256(payload)
    ledger = root / "SHA256SUMS"
    ledger.write_text(f"{checksum}  payload.json\n", encoding="ascii")
    ledger.chmod(0o600)
    os.link(payload, root / "payload-hardlink.json")

    with pytest.raises(FoundationExecutionEvidenceError, match="non-0600 file"):
        secure_inventory(root, "hardlink-test")


def test_removed_process_supervisor_is_not_present() -> None:
    forbidden_names = {
        "foundation_process_group_supervisor.py",
        "foundation_in_process_executor.py",
        "test_foundation_process_group_supervisor.py",
        "test_foundation_in_process_executor.py",
    }

    assert not any(path.name in forbidden_names for path in ML_ROOT.rglob("*"))
