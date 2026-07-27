from __future__ import annotations

import importlib
import json
import re
import shutil
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker

PROJECT = Path(__file__).resolve().parents[1]
LOADER_PATH = PROJECT / "src/dime_ai/foundation_contracts.py"


def api():
    assert LOADER_PATH.is_file(), "Step 2 separation-of-duties contract loader is missing"
    return importlib.import_module("dime_ai.foundation_contracts")


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("configs", "schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def mutate_separation(project: Path, mutator) -> None:
    path = project / "configs/foundation_separation_of_duties_v1.yaml"
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    mutator(document)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")


def reviewer_registry_validator() -> Draft202012Validator:
    schema = json.loads(
        (PROJECT / "schemas/foundation_reviewer_registry.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def valid_reviewer() -> dict:
    return {
        "reviewer_id": "dime-reviewer-domain-001",
        "active": True,
        "roles": ["domain"],
        "independence_group_id": "dime-independence-group-domain-001",
        "effective_start": "2026-01-01T00:00:00Z",
        "effective_end_or_open_ended": None,
    }


def test_record_review_and_dataset_approval_require_independent_humans() -> None:
    document = api().load_foundation_contract("separation_of_duties").document
    assert document["record_review"] == {
        "human_review_required": True,
        "automated_agent_may_approve": False,
        "author_may_review_own_record": False,
        "standard_minimum_approvals": 1,
        "elevated_minimum_approvals": 2,
    }
    assert document["independence"]["distinct_reviewer_ids_required"] is True
    assert document["independence"]["distinct_independence_groups_required"] is True
    assert document["independence"]["same_group_aliases_count_once"] is True
    assert document["dataset_approval"] == {
        "minimum_dataset_approvals": 2,
        "required_role": "dataset-approver",
        "distinct_reviewer_ids": True,
        "distinct_independence_groups": True,
        "candidate_author_may_approve": False,
    }


def test_elevated_and_external_audit_mappings_are_exact() -> None:
    document = api().load_foundation_contract("separation_of_duties").document
    assert document["elevated_review"]["required_specialists"] == {
        "market_math": "numeric",
        "bet_tracker_coaching": "coaching",
        "simulation_analysis": "simulation",
        "safety_privacy_security": "safety",
    }
    assert {
        name: value["required_role"] for name, value in document["external_audits"].items()
    } == {
        "semantic_deduplication": "semantic-audit",
        "privacy_and_identifiers": "privacy",
        "rights": "rights",
        "development_evaluation_contamination": "evaluation-audit",
        "locked_evaluation_contamination": "locked-evaluation",
        "numeric_traceability": "numeric",
    }


def test_reviewer_registry_remains_proposed_empty_and_contract_has_no_roster() -> None:
    document = api().load_foundation_contract("separation_of_duties").document
    registry = json.loads(
        (PROJECT / "configs/foundation_reviewer_registry.json").read_text(encoding="utf-8")
    )
    assert document["reviewer_authority"]["registry_path"] == (
        "configs/foundation_reviewer_registry.json"
    )
    assert registry["schema_version"] == "dime-foundation-reviewer-registry-v2"
    assert registry["registry_version"] == "dime-foundation-reviewers-v0.2.0"
    assert registry["status"] == "proposed"
    assert registry["reviewers"] == []
    assert "reviewers" not in document
    serialized = repr(document)
    assert not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", serialized)
    assert document["authorization_effect"]["scope"] == "governance_validation_only"
    assert not any(
        value for key, value in document["authorization_effect"].items() if key != "scope"
    )


def test_reviewer_registry_v2_represents_group_and_open_ended_authority() -> None:
    registry = {
        "schema_version": "dime-foundation-reviewer-registry-v2",
        "registry_version": "dime-foundation-reviewers-v0.2.0",
        "status": "active",
        "reviewers": [valid_reviewer()],
    }
    assert list(reviewer_registry_validator().iter_errors(registry)) == []


@pytest.mark.parametrize(
    "missing",
    [
        "independence_group_id",
        "effective_start",
        "effective_end_or_open_ended",
    ],
)
def test_reviewer_registry_requires_complete_authority_metadata(missing: str) -> None:
    reviewer = valid_reviewer()
    reviewer.pop(missing)
    registry = {
        "schema_version": "dime-foundation-reviewer-registry-v2",
        "registry_version": "dime-foundation-reviewers-v0.2.0",
        "status": "active",
        "reviewers": [reviewer],
    }
    errors = list(reviewer_registry_validator().iter_errors(registry))
    assert errors
    assert any(missing in error.message for error in errors)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("independence_group_id", "dime-independence-group-example"),
        ("effective_start", "2026-01-01T00:00:00+00:00"),
        ("effective_end_or_open_ended", "2026-02-01T00:00:00+00:00"),
    ],
)
def test_reviewer_registry_rejects_placeholder_groups_and_noncanonical_utc(
    field: str,
    value: str,
) -> None:
    reviewer = valid_reviewer()
    reviewer[field] = value
    registry = {
        "schema_version": "dime-foundation-reviewer-registry-v2",
        "registry_version": "dime-foundation-reviewers-v0.2.0",
        "status": "active",
        "reviewers": [reviewer],
    }
    assert list(reviewer_registry_validator().iter_errors(registry))


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            lambda doc: doc["record_review"].__setitem__("author_may_review_own_record", True),
            "author",
        ),
        (
            lambda doc: doc["record_review"].__setitem__("automated_agent_may_approve", True),
            "automated",
        ),
        (
            lambda doc: doc["record_review"].__setitem__("elevated_minimum_approvals", 1),
            "elevated",
        ),
        (
            lambda doc: doc["dataset_approval"].__setitem__("minimum_dataset_approvals", 1),
            "dataset",
        ),
        (
            lambda doc: doc["elevated_review"]["required_specialists"].pop("market_math"),
            "specialist",
        ),
        (
            lambda doc: doc["elevated_review"]["required_specialists"].__setitem__(
                "market_math", "legal_superuser"
            ),
            "role|specialist",
        ),
        (
            lambda doc: doc["independence"].__setitem__("same_group_aliases_count_once", False),
            "group",
        ),
        (
            lambda doc: doc.__setitem__("reviewer_name", "Pat Example"),
            "Additional properties",
        ),
        (
            lambda doc: doc.__setitem__(
                "reviewers",
                [{"reviewer_id": "dime-reviewer-example", "active": True}],
            ),
            "Additional properties",
        ),
    ],
)
def test_separation_mutations_fail_closed(
    project_copy: Path,
    mutation,
    reason: str,
) -> None:
    contract_api = api()
    mutate_separation(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match=reason):
        contract_api.load_foundation_contracts(project_root=project_copy)


def test_effective_authority_contract_is_ready_without_activation() -> None:
    document = api().load_foundation_contract("separation_of_duties").document
    assert document["effective_authority"]["registry_sha256_binding_required"] is True
    assert document["effective_authority"]["authority_period_required"] is True
    assert document["registry_migration"] == {
        "required": False,
        "status": "representation_and_runtime_ready",
        "implemented_fields": (
            "independence_group_id",
            "effective_start",
            "effective_end_or_open_ended",
        ),
    }
