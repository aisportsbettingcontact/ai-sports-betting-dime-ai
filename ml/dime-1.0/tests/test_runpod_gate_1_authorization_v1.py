from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

from dime_ai.runpod_gate_1 import (
    CAPSULE_PATH,
    GATE_PATH,
    OWNER_MERGE_SCOPE,
    REQUIRED_BLOCKERS,
    STILL_CLOSED,
    static_audit,
    validate_context_capsule,
    validate_gate,
)

PROJECT = Path(__file__).resolve().parents[1]
EVIDENCE = PROJECT / "evidence" / "execution" / "runpod-gate-1-authorization-v1"
CAPSULE_CHECKSUMS = CAPSULE_PATH.parent / "SHA256SUMS"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_gate_freezes_only_proven_values_and_remains_nonexecuting() -> None:
    gate = load_json(GATE_PATH)

    assert validate_gate(gate) == []
    assert gate["status"] == "BLOCKED_INCOMPLETE_NOT_AUTHORIZED"
    assert gate["runtime_identity"]["container_digest"] is None
    assert gate["candidates"]["base"]["serialization_profile_sha256"] is None
    assert gate["candidates"]["instruct"]["serialization_profile_sha256"] is None
    assert gate["shared_controls"]["retrieval_revision"] is None
    assert gate["shared_controls"]["context_compiler_revision"] is None
    assert gate["budgets"]["maximum_gpu_hours"] is None
    assert gate["budgets"]["maximum_spend_usd"] is None
    assert tuple(gate["required_blockers"]) == REQUIRED_BLOCKERS
    assert not any(gate["effective_authorization"].values())
    assert not any(gate["still_not_authorized"].values())
    assert not any(gate["external_actions_performed"].values())


def test_candidate_and_shared_control_identities_are_exact() -> None:
    gate = load_json(GATE_PATH)

    assert gate["candidates"]["base"] == {
        "repo_id": "meta-llama/Llama-3.1-8B",
        "revision": "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b",
        "tokenizer_revision": "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b",
        "serialization_profile_sha256": None,
    }
    assert gate["candidates"]["instruct"] == {
        "repo_id": "meta-llama/Llama-3.1-8B-Instruct",
        "revision": "0e9e39f249a16976918f6564b8830bc894c89659",
        "tokenizer_revision": "0e9e39f249a16976918f6564b8830bc894c89659",
        "serialization_profile_sha256": None,
    }
    controls = gate["shared_controls"]
    assert controls["prompt_revision"] == "dime-prompt-v1"
    assert controls["tool_revision"] == "tools.v1"
    assert controls["routing_revision"] == "runtime-answer-routing-v1"
    assert controls["decoding_revision"] == "decoding-v1"
    assert controls["random_seed"] == 1729


def test_unproven_identity_or_budget_substitution_fails_closed() -> None:
    gate = load_json(GATE_PATH)
    mutations = (
        ("runtime_identity", "container_digest"),
        ("shared_controls", "retrieval_revision"),
        ("shared_controls", "context_compiler_revision"),
        ("budgets", "maximum_gpu_hours"),
        ("budgets", "maximum_spend_usd"),
    )
    for section, field in mutations:
        changed = deepcopy(gate)
        changed[section][field] = "invented"
        assert validate_gate(changed)

    for candidate in ("base", "instruct"):
        changed = deepcopy(gate)
        changed["candidates"][candidate]["serialization_profile_sha256"] = "a" * 64
        assert validate_gate(changed)


def test_owner_merge_ceiling_is_four_actions_and_cannot_enable_execution() -> None:
    gate = load_json(GATE_PATH)

    assert set(gate["owner_merge_may_authorize"]) == OWNER_MERGE_SCOPE
    assert all(gate["owner_merge_may_authorize"].values())
    assert set(gate["still_not_authorized"]) == STILL_CLOSED

    training = deepcopy(gate)
    training["owner_merge_may_authorize"]["model_training"] = True
    assert validate_gate(training)

    execution = deepcopy(gate)
    execution["effective_authorization"]["model_download"] = True
    assert validate_gate(execution)

    serving = deepcopy(gate)
    serving["still_not_authorized"]["model_serving"] = True
    assert validate_gate(serving)


def test_all_repository_bindings_are_checksum_verified() -> None:
    gate = load_json(GATE_PATH)
    changed = deepcopy(gate)
    changed["shared_controls"]["tool_binding"]["sha256"] = "0" * 64
    issues = validate_gate(changed)
    assert any("checksum mismatch" in issue for issue in issues)


def test_context_capsule_is_complete_compact_and_sanitized() -> None:
    capsule = load_json(CAPSULE_PATH)

    assert validate_context_capsule(capsule) == []
    assert capsule["production_application_sha"] is None
    assert capsule["production_backend_sha"] is None
    assert capsule["snapshot_semantics"] == "IMMUTABLE_POINT_IN_TIME_NOT_LIVE_STATUS"
    assert capsule["classification"] == "SANITIZED_AGGREGATE_ONLY"
    assert capsule["foundation_counts"] == {
        "status": "IN_PROGRESS",
        "verified_authoring_records": 300,
        "verified_trainer_records": 300,
        "verified_train_records": 270,
        "verified_validation_records": 30,
    }
    assert capsule["foundation_deficits"] == {
        "status": "IN_PROGRESS",
        "authoring_records": 2100,
        "trainer_records": 2100,
        "train_records": 1890,
        "validation_records": 210,
    }
    assert capsule["evaluation_key_state"] == "OWNER_MERGE_SCOPE_AUTHORIZED_ZERO_KEYS"
    assert capsule["runpod_gate_state"] == ("GOVERNANCE_MERGED_EFFECTIVE_AUTHORIZATION_FALSE")
    assert capsule["candidate_a_state"] == "NOT_STARTED"
    assert capsule["candidate_b_state"] == "NOT_STARTED"
    assert capsule["candidate_c_state"] == "NOT_STARTED"

    leaked = deepcopy(capsule)
    leaked["api_key"] = "forbidden"
    assert validate_context_capsule(leaked)


def test_static_audit_reports_zero_external_actions() -> None:
    report = static_audit()

    assert report["pass"] is True
    assert report["ready_for_execution"] is False
    assert report["required_blocker_count"] == len(REQUIRED_BLOCKERS)
    for field in (
        "credential_accesses",
        "runpod_calls",
        "model_downloads",
        "tokenizer_downloads",
        "inference_requests",
        "benchmark_executions",
        "training_runs",
        "serving_changes",
        "railway_mutations",
        "deployments",
    ):
        assert report[field] == 0


def test_capsule_and_gate_evidence_are_checksum_pinned() -> None:
    capsule_entries = {}
    for line in CAPSULE_CHECKSUMS.read_text(encoding="utf-8").splitlines():
        capsule_sha256, capsule_name = line.split(maxsplit=1)
        assert capsule_name not in capsule_entries
        capsule_entries[capsule_name] = capsule_sha256
    assert set(capsule_entries) == {"README.md", "capsule.json"}
    for capsule_name, capsule_sha256 in capsule_entries.items():
        assert (
            hashlib.sha256((CAPSULE_PATH.parent / capsule_name).read_bytes()).hexdigest()
            == capsule_sha256
        )

    manifest = load_json(EVIDENCE / "manifest.json")
    assert manifest["contains_credentials"] is False
    assert manifest["contains_private_records_or_cases"] is False
    assert not any(manifest["external_actions"].values())
    for relative_path, expected_sha256 in manifest["artifacts"].items():
        artifact = PROJECT.parents[1] / relative_path
        assert artifact.is_file()
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == expected_sha256

    evidence_line = (EVIDENCE / "SHA256SUMS").read_text(encoding="utf-8").strip()
    expected_sha256, filename = evidence_line.split(maxsplit=1)
    assert filename == "manifest.json"
    assert hashlib.sha256((EVIDENCE / filename).read_bytes()).hexdigest() == expected_sha256
