from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

PROJECT = Path(__file__).resolve().parents[1]
PLAN_PATH = PROJECT / "configs" / "evaluation_identity_plan_v1.json"
SCHEMA_PATH = PROJECT / "schemas" / "evaluation_identity_plan.schema.json"

PRODUCT_ROUTES = (
    "platform",
    "account",
    "educational",
    "bet_explanation",
    "matchup",
    "full_slate",
    "historical",
    "live_data",
    "general_sports",
)
EXPECTED_REPOSITORIES = {
    "development": (
        "taileredsports/dime-eval-development-cases",
        "taileredsports/dime-eval-development-keys",
    ),
    "critical": (
        "taileredsports/dime-eval-critical-cases",
        "taileredsports/dime-eval-critical-keys",
    ),
    "locked": (
        "taileredsports/dime-eval-locked-cases",
        "taileredsports/dime-eval-locked-keys",
    ),
    "general_regression": (
        "taileredsports/dime-eval-general-regression-cases",
        "taileredsports/dime-eval-general-regression-keys",
    ),
}
FUTURE_IDENTITY_FIELDS = (
    "revision",
    "manifest_sha256",
    "record_checksums_sha256",
    "provenance_sha256",
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validator() -> Draft202012Validator:
    schema = load_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validation_errors(plan: dict) -> list:
    return list(validator().iter_errors(plan))


def assert_invalid(plan: dict) -> None:
    assert validation_errors(plan)


def test_evaluation_identity_plan_is_schema_valid_exact_and_non_authorizing() -> None:
    plan = load_json(PLAN_PATH)
    assert validation_errors(plan) == []
    assert plan["status"] == "INCOMPLETE_NOT_AUTHORIZED"

    for layer_id, (semantic_repo, answer_key_repo) in EXPECTED_REPOSITORIES.items():
        layer = plan["layers"][layer_id]
        assert layer["semantic_identity"]["repo_id"] == semantic_repo
        assert layer["answer_key_identity"]["repo_id"] == answer_key_repo
        assert semantic_repo != answer_key_repo
        for identity_key in ("semantic_identity", "answer_key_identity"):
            assert all(layer[identity_key][field] is None for field in FUTURE_IDENTITY_FIELDS)
        assert layer["required_training_access"] == "prohibited"
        assert layer["effective_access_verified"] is False
        assert layer["status"] == "MISSING"

    assert tuple(plan["layers"]["development"]["route_distribution"]) == PRODUCT_ROUTES
    assert set(plan["layers"]["development"]["route_distribution"].values()) == {30}
    assert tuple(plan["layers"]["locked"]["route_distribution"]) == PRODUCT_ROUTES
    assert set(plan["layers"]["locked"]["route_distribution"].values()) == {20}
    assert plan["layers"]["critical"]["status"] == "MISSING"
    assert plan["legacy_exposed_critical"]["status"] == "EXPOSED_NOT_SELECTION_ELIGIBLE"
    assert not any(plan["authorization_boundary"].values())


def test_identity_controls_and_repository_identities_are_frozen() -> None:
    plan = load_json(PLAN_PATH)

    changed_controls = deepcopy(plan)
    changed_controls["required_identity_controls"] = [
        f"placeholder-control-{index}" for index in range(7)
    ]
    assert_invalid(changed_controls)

    for layer_id in EXPECTED_REPOSITORIES:
        for identity_key in ("semantic_identity", "answer_key_identity"):
            wrong_repo = deepcopy(plan)
            wrong_repo["layers"][layer_id][identity_key]["repo_id"] = "taileredsports/wrong-repo"
            assert_invalid(wrong_repo)

            missing_repo = deepcopy(plan)
            del missing_repo["layers"][layer_id][identity_key]["repo_id"]
            assert_invalid(missing_repo)

            extra_identity_field = deepcopy(plan)
            extra_identity_field["layers"][layer_id][identity_key]["unreviewed"] = True
            assert_invalid(extra_identity_field)

            for field in FUTURE_IDENTITY_FIELDS:
                premature_identity = deepcopy(plan)
                premature_identity["layers"][layer_id][identity_key][field] = "0" * 64
                assert_invalid(premature_identity)


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    [
        ("semantic_cases_exclude_gold_answers", False),
        ("answer_keys_bind_semantic_record_sha256", False),
        ("training_denied_all_evaluation_repositories", True),
        ("runner_denied_answer_keys", True),
        ("scorer_denied_training_data_and_model_execution", True),
        ("locked_maximum_execution_count", 2),
        ("locked_consumption_ledger_required", False),
        ("current_status", "IMPLEMENTED"),
    ],
)
def test_access_separation_is_closed_world_and_truthful(
    field: str,
    invalid_value: object,
) -> None:
    plan = load_json(PLAN_PATH)

    changed = deepcopy(plan)
    changed["access_separation"][field] = invalid_value
    assert_invalid(changed)

    omitted = deepcopy(plan)
    del omitted["access_separation"][field]
    assert_invalid(omitted)

    extra = deepcopy(plan)
    extra["access_separation"]["unreviewed_control"] = False
    assert_invalid(extra)


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    [
        ("required_pairwise_suite_comparisons", 0),
        ("foundation_against_each_suite_comparisons", 0),
        ("checks", []),
        ("restricted_report_sha256", "not-a-sha256"),
        ("public_proof_sha256", "not-a-sha256"),
        ("status", "COMPLETE"),
    ],
)
def test_non_overlap_proof_requirements_are_closed_world(
    field: str,
    invalid_value: object,
) -> None:
    plan = load_json(PLAN_PATH)

    changed = deepcopy(plan)
    changed["non_overlap_proof"][field] = invalid_value
    assert_invalid(changed)

    omitted = deepcopy(plan)
    del omitted["non_overlap_proof"][field]
    assert_invalid(omitted)

    extra = deepcopy(plan)
    extra["non_overlap_proof"]["unreviewed_control"] = False
    assert_invalid(extra)


def test_layer_status_access_and_distribution_mutations_fail_closed() -> None:
    plan = load_json(PLAN_PATH)

    for layer_id in EXPECTED_REPOSITORIES:
        exposed_replacement = deepcopy(plan)
        exposed_replacement["layers"][layer_id]["status"] = "EXPOSED_NOT_SELECTION_ELIGIBLE"
        assert_invalid(exposed_replacement)

        allowed_training = deepcopy(plan)
        allowed_training["layers"][layer_id]["required_training_access"] = "allowed"
        assert_invalid(allowed_training)

        falsely_verified = deepcopy(plan)
        falsely_verified["layers"][layer_id]["effective_access_verified"] = True
        assert_invalid(falsely_verified)

    wrong_development_quota = deepcopy(plan)
    wrong_development_quota["layers"]["development"]["route_distribution"]["platform"] = 29
    assert_invalid(wrong_development_quota)

    wrong_locked_quota = deepcopy(plan)
    wrong_locked_quota["layers"]["locked"]["route_distribution"]["platform"] = 19
    assert_invalid(wrong_locked_quota)

    legacy_mislabeled = deepcopy(plan)
    legacy_mislabeled["legacy_exposed_critical"]["status"] = "MISSING"
    assert_invalid(legacy_mislabeled)


def test_authorization_boundary_requires_every_exact_false_gate() -> None:
    plan = load_json(PLAN_PATH)

    for gate in plan["authorization_boundary"]:
        omitted = deepcopy(plan)
        del omitted["authorization_boundary"][gate]
        assert_invalid(omitted)

        opened = deepcopy(plan)
        opened["authorization_boundary"][gate] = True
        assert_invalid(opened)

    extra = deepcopy(plan)
    extra["authorization_boundary"]["unreviewed_capability"] = False
    assert_invalid(extra)
