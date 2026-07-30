from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

from dime_ai.evaluation_answer_key_governance import (
    GOVERNANCE_PATH,
    IDENTITY_ACCESS,
    IDENTITY_KEYS,
    OWNER_MERGE_SCOPE,
    RESOURCE_UNIVERSE,
    STILL_NOT_AUTHORIZED,
    governance_audit,
    validate_answer_key_record,
    validate_blinded_output,
    validate_governance,
    validate_locked_consumption_ledger,
)

PROJECT = Path(__file__).resolve().parents[1]
EVIDENCE = PROJECT / "evidence" / "governance" / "evaluation-answer-key-governance-v1"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def answer_key_record() -> dict:
    return {
        "schema_version": "dime-private-evaluation-answer-key-v1",
        "key_id": "dime-key-governed-example-0001",
        "layer": "critical",
        "semantic_case_id": "dime-case-governed-example-0001",
        "semantic_record_sha256": "a" * 64,
        "semantic_revision": "b" * 40,
        "semantic_manifest_sha256": "c" * 64,
        "rubric_revision": "dime-evaluation-rubric-v1.0.0",
        "expected_judgment": {
            "expected_outcome": "abstain",
            "required_tool_state": "required_abstention_on_failure",
            "critical_failure": True,
            "scoring_dimensions": ["correctness", "groundedness", "tool_use"],
            "rationale_tags": ["dynamic_fact_requires_tool", "no_fabrication"],
        },
        "provenance": {
            "generator_actor_id": "answer-key-generator-001",
            "reviewer_actor_id": "answer-key-reviewer-001",
            "authoring_receipt_sha256": "d" * 64,
            "review_receipt_sha256": "e" * 64,
            "created_at": "2026-07-30T00:00:00Z",
        },
        "privacy": {
            "classification": "PRIVATE_EVALUATION_ANSWER_KEY",
            "contains_semantic_case_content": False,
            "publication_scope": "separate_private_answer_key_repository",
            "public_publication_authorized": False,
        },
    }


def blinded_output() -> dict:
    return {
        "schema_version": "dime-private-evaluation-blinded-output-v1",
        "output_id": "dime-output-governed-example-0001",
        "layer": "critical",
        "semantic_record_sha256": "a" * 64,
        "blind_id": "blind-" + "b" * 32,
        "assistant_output": "The required current evidence is unavailable, so I cannot verify it.",
        "tool_trace": [
            {
                "tool_name": "get_game_context",
                "state": "failure",
                "arguments_sha256": "c" * 64,
                "result_sha256": "d" * 64,
            }
        ],
        "output_receipt_sha256": "e" * 64,
        "generated_at": "2026-07-30T00:01:00Z",
        "privacy": {
            "provider_identity_included": False,
            "model_identity_included": False,
            "answer_key_material_included": False,
            "semantic_case_content_included": False,
        },
    }


def locked_ledger(*, consumed: bool) -> dict:
    entries = []
    if consumed:
        entries.append(
            {
                "lease_id": "lease-" + "a" * 32,
                "execution_id": "execution-" + "b" * 32,
                "authorized_at": "2026-07-30T00:00:00Z",
                "consumed_at": "2026-07-30T00:02:00Z",
                "state": "CONSUMED",
                "runner_identity_sha256": "c" * 64,
                "scorer_identity_sha256": "d" * 64,
                "blinded_output_manifest_sha256": "e" * 64,
                "result_manifest_sha256": "f" * 64,
                "consumption_receipt_sha256": "1" * 64,
                "retry_authorized": False,
            }
        )
    return {
        "schema_version": "dime-locked-evaluation-consumption-ledger-v1",
        "ledger_id": "dime-locked-ledger-governed-example-0001",
        "locked_semantic_revision": "a" * 40,
        "locked_semantic_manifest_sha256": "b" * 64,
        "locked_answer_key_revision": "c" * 40,
        "locked_answer_key_manifest_sha256": "d" * 64,
        "maximum_execution_count": 1,
        "execution_count": len(entries),
        "append_only": True,
        "entries": entries,
    }


def test_governance_is_exact_nonexecuting_and_fail_closed() -> None:
    contract = load_json(GOVERNANCE_PATH)

    assert validate_governance(contract) == []
    assert contract["status"] == "PROPOSED_NON_EXECUTING"
    assert contract["authorization_effect"] == ("NONE_UNTIL_OWNER_MERGE_OF_EXACT_REVIEWED_HEAD")
    assert set(contract["owner_merge_authorization_scope"]) == OWNER_MERGE_SCOPE
    assert all(contract["owner_merge_authorization_scope"].values())
    assert set(contract["still_not_authorized"]) == STILL_NOT_AUTHORIZED
    assert not any(contract["still_not_authorized"].values())
    assert contract["locked_control"]["current_authorized_executions"] == 0
    assert contract["locked_control"]["execution_authorized"] is False

    widened = deepcopy(contract)
    widened["still_not_authorized"]["benchmark_execution"] = True
    assert validate_governance(widened)

    added = deepcopy(contract)
    added["owner_merge_authorization_scope"]["runpod_inference"] = True
    assert validate_governance(added)


def test_four_identity_matrices_are_exact_disjoint_and_complete() -> None:
    contract = load_json(GOVERNANCE_PATH)
    identities = contract["identities"]

    assert tuple(identities) == IDENTITY_KEYS
    for role, expected in IDENTITY_ACCESS.items():
        identity = identities[role]
        assert tuple(identity["allowed_read"]) == expected["allowed_read"]
        assert tuple(identity["allowed_write"]) == expected["allowed_write"]
        for mode in ("read", "write"):
            allowed = set(identity[f"allowed_{mode}"])
            denied = set(identity[f"denied_{mode}"])
            assert not allowed & denied
            assert allowed | denied == set(RESOURCE_UNIVERSE)
        assert identity["credential_provisioned"] is False

    assert identities["training"]["allowed_read"] == ["private_foundation"]
    assert identities["model_runner"]["allowed_read"] == [
        "evaluation_semantic_cases",
        "evaluation_semantic_manifests",
    ]
    assert "evaluation_answer_keys" in identities["model_runner"]["denied_read"]
    assert identities["scorer"]["model_endpoint_access"] == "denied"
    assert "private_foundation" in identities["scorer"]["denied_read"]
    assert identities["locked_controller"]["allowed_write"] == ["locked_consumption_ledger"]


def test_access_mutations_and_repository_overlap_fail_closed() -> None:
    contract = load_json(GOVERNANCE_PATH)

    for role in IDENTITY_KEYS:
        widened = deepcopy(contract)
        resource = widened["identities"][role]["denied_read"].pop()
        widened["identities"][role]["allowed_read"].append(resource)
        assert validate_governance(widened)

        incomplete = deepcopy(contract)
        incomplete["identities"][role]["denied_write"].pop()
        assert validate_governance(incomplete)

        provisioned = deepcopy(contract)
        provisioned["identities"][role]["credential_provisioned"] = True
        assert validate_governance(provisioned)

    overlapped = deepcopy(contract)
    overlapped["semantic_layers"]["critical"]["answer_key_repo_id"] = overlapped["semantic_layers"][
        "critical"
    ]["semantic_repo_id"]
    assert validate_governance(overlapped)


def test_private_answer_key_schema_binds_hashes_and_independent_review() -> None:
    record = answer_key_record()
    assert validate_answer_key_record(record) == []

    missing_binding = deepcopy(record)
    del missing_binding["semantic_record_sha256"]
    assert validate_answer_key_record(missing_binding)

    copied_case = deepcopy(record)
    copied_case["privacy"]["contains_semantic_case_content"] = True
    assert validate_answer_key_record(copied_case)

    self_reviewed = deepcopy(record)
    self_reviewed["provenance"]["reviewer_actor_id"] = self_reviewed["provenance"][
        "generator_actor_id"
    ]
    issues = validate_answer_key_record(self_reviewed)
    assert any("different actors" in issue for issue in issues)

    raw_case_content = deepcopy(record)
    raw_case_content["prompt"] = "private semantic case"
    assert validate_answer_key_record(raw_case_content)


def test_blinded_outputs_exclude_candidate_and_answer_key_identity() -> None:
    output = blinded_output()
    assert validate_blinded_output(output) == []

    for forbidden_key in (
        "provider_id",
        "model_revision",
        "answer_key",
        "semantic_case_content",
    ):
        exposed = deepcopy(output)
        exposed[forbidden_key] = "forbidden"
        issues = validate_blinded_output(exposed)
        assert any("forbidden identity or private-material fields" in issue for issue in issues)

    mislabeled = deepcopy(output)
    mislabeled["privacy"]["provider_identity_included"] = True
    assert validate_blinded_output(mislabeled)


def test_locked_ledger_is_single_use_terminal_and_nonretrying() -> None:
    empty = locked_ledger(consumed=False)
    consumed = locked_ledger(consumed=True)

    assert validate_locked_consumption_ledger(empty) == []
    assert validate_locked_consumption_ledger(consumed) == []

    mismatch = deepcopy(consumed)
    mismatch["execution_count"] = 0
    assert any(
        "must equal the number of entries" in issue
        for issue in validate_locked_consumption_ledger(mismatch)
    )

    retry = deepcopy(consumed)
    retry["entries"][0]["retry_authorized"] = True
    assert validate_locked_consumption_ledger(retry)

    reversed_time = deepcopy(consumed)
    reversed_time["entries"][0]["consumed_at"] = "2026-07-29T23:59:00Z"
    assert any(
        "cannot precede authorization" in issue
        for issue in validate_locked_consumption_ledger(reversed_time)
    )

    duplicated = deepcopy(consumed)
    duplicated["entries"].append(deepcopy(duplicated["entries"][0]))
    duplicated["execution_count"] = 2
    assert validate_locked_consumption_ledger(duplicated)


def test_static_audit_performs_zero_external_or_execution_actions() -> None:
    report = governance_audit()

    assert report["pass"] is True
    assert report["credentials_provisioned"] is False
    for field in (
        "answer_keys_generated",
        "answer_keys_published",
        "provider_invocations",
        "model_downloads",
        "benchmark_executions",
        "training_runs",
        "railway_mutations",
    ):
        assert report[field] == 0


def test_governance_evidence_is_checksum_pinned_and_reproducible() -> None:
    manifest = load_json(EVIDENCE / "manifest.json")
    assert manifest["schema_version"] == ("dime-evaluation-answer-key-governance-evidence-v1")
    assert manifest["contains_private_evaluation_material"] is False
    assert manifest["contains_credentials"] is False
    assert not any(manifest["external_actions"].values())

    for relative_path, expected_sha256 in manifest["artifacts"].items():
        artifact = PROJECT.parents[1] / relative_path
        assert artifact.is_file()
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == expected_sha256

    line = (EVIDENCE / "SHA256SUMS").read_text(encoding="utf-8").strip()
    expected_sha256, filename = line.split(maxsplit=1)
    assert filename == "manifest.json"
    assert hashlib.sha256((EVIDENCE / filename).read_bytes()).hexdigest() == expected_sha256
