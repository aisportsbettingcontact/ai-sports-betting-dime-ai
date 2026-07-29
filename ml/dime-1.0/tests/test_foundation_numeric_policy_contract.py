from __future__ import annotations

import importlib
import shutil
from pathlib import Path

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
LOADER_PATH = PROJECT / "src/dime_ai/foundation_contracts.py"


def api():
    assert LOADER_PATH.is_file(), "Step 2 numeric-policy contract loader is missing"
    return importlib.import_module("dime_ai.foundation_contracts")


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("configs", "schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def mutate_numeric(project: Path, mutator) -> None:
    path = project / "configs/foundation_numeric_policy_v1.yaml"
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    mutator(document)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")


def test_numeric_coverage_invariants_and_evidence_classes_are_exact() -> None:
    document = api().load_foundation_contract("numeric_policy").document
    assert document["invariants"] == {
        "bind_all_assistant_numeric_tokens": True,
        "allow_unbound_literals": False,
        "allow_ambiguous_bindings": False,
        "require_reviewed_assertions": True,
        "require_exact_assistant_message_index": True,
        "require_exact_claim_span": True,
    }
    assert set(document["evidence_classes"]) == {
        "tool_result",
        "user_input",
        "policy_constant",
        "deterministic_derivation",
    }
    assert document["evidence_classes"]["tool_result"]["verified_status"] == "ok"
    for name in ("user_input", "policy_constant", "deterministic_derivation"):
        assert document["evidence_classes"][name]["implementation_status"] == "proposed"


def test_numeric_tolerances_and_market_math_rules_are_exact() -> None:
    document = api().load_foundation_contract("numeric_policy").document
    assert document["tolerances"] == {
        "probability": 0.000000001,
        "percentage_points": 0.000001,
        "decimal_odds": 0.000000001,
        "american_odds": 0,
        "units": 0.000001,
        "roi": 0.000000001,
        "count": 0,
    }
    market_math = document["market_math"]
    assert market_math["decimal_precision"] == 80
    assert market_math["recomputation_tolerance"] == 0.000000001
    assert market_math["independent_recomputation_required"] is True
    assert market_math["internal_presentation_rounding_allowed"] is False
    assert market_math["boolean_values_are_numbers"] is False
    assert market_math["operations"] == (
        "implied_probability",
        "remove_vig",
        "market_hold",
        "expected_value",
        "settled_profit",
        "roi",
        "probability_clv",
    )


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            lambda doc: doc["invariants"].__setitem__("bind_all_assistant_numeric_tokens", False),
            "bind",
        ),
        (
            lambda doc: doc["invariants"].__setitem__("allow_unbound_literals", True),
            "unbound",
        ),
        (
            lambda doc: doc["evidence_classes"]["tool_result"].__setitem__(
                "verified_status", "stale"
            ),
            "verified_status",
        ),
        (
            lambda doc: doc["market_math"].__setitem__("independent_recomputation_required", False),
            "recomputation",
        ),
        (
            lambda doc: doc["tolerances"].__setitem__("probability", 0.00000001),
            "tolerance",
        ),
        (
            lambda doc: doc["tolerances"].__setitem__("probability", float("nan")),
            "finite",
        ),
        (
            lambda doc: doc.__setitem__("manual_exception", True),
            "Additional properties",
        ),
        (
            lambda doc: doc["tolerances"].__setitem__("unknown_unit", 0),
            "Additional properties",
        ),
        (
            lambda doc: doc["evidence_classes"].__setitem__(
                "manual", {"implementation_status": "proposed"}
            ),
            "Additional properties",
        ),
        (
            lambda doc: doc["market_math"]["operations"].append("unknown_operation"),
            "operation",
        ),
    ],
)
def test_numeric_policy_mutations_fail_closed(
    project_copy: Path,
    mutation,
    reason: str,
) -> None:
    contract_api = api()
    mutate_numeric(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match=reason):
        contract_api.load_foundation_contracts(project_root=project_copy)


def test_numeric_contract_is_proposed_and_non_authorizing() -> None:
    document = api().load_foundation_contract("numeric_policy").document
    assert document["status"] == "proposed"
    assert document["purpose"] == "governance_and_validation_metadata_only"
    assert document["authorization_effect"]["scope"] == "governance_validation_only"
    assert not any(
        value for key, value in document["authorization_effect"].items() if key != "scope"
    )
    assert document["presentation"]["global_precision_defined"] is False
    assert document["presentation"]["global_rounding_mode_defined"] is False
