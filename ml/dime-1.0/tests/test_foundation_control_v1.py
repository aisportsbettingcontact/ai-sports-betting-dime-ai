from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from dime_ai.foundation_control import (
    EVALUATION_CASE_COUNTS,
    EVALUATION_PLAN_PATH,
    EXECUTION_GATES_PATH,
    FOUNDATION_COVERAGE_MINIMUMS,
    FOUNDATION_PLAN_PATH,
    FOUNDATION_RECORD_TEMPLATE_PATH,
    FOUNDATION_SPLIT_TOTALS,
    PRODUCT_ROUTES,
    audit_foundation_control,
    validate_evaluation_plan,
    validate_execution_gates,
    validate_foundation_plan,
    validate_foundation_record,
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_foundation_control_audit_validates_plan_without_claiming_readiness() -> None:
    report = audit_foundation_control()

    assert report == {
        "schema_version": "dime-foundation-control-audit-v1",
        "plan_valid": True,
        "ready": False,
        "status": "INCOMPLETE_NOT_AUTHORIZED",
        "sections": {
            "foundation_plan": {"pass": True, "issue_count": 0},
            "foundation_record_template": {"pass": True, "issue_count": 0},
            "data_factory_governance": {"pass": True, "issue_count": 0},
            "evaluation_plan": {"pass": True, "issue_count": 0},
            "execution_gates": {"pass": True, "issue_count": 0},
        },
        "issues": [],
        "authorization_effect": "none",
    }


def test_foundation_route_and_coverage_contract_is_exact() -> None:
    plan = load_json(FOUNDATION_PLAN_PATH)
    assert validate_foundation_plan(plan) == []
    assert tuple(plan["route_mixture"]) == PRODUCT_ROUTES
    assert {
        split: sum(counts[split] for counts in plan["route_mixture"].values())
        for split in FOUNDATION_SPLIT_TOTALS
    } == FOUNDATION_SPLIT_TOTALS
    assert plan["cross_cutting_minimums"] == FOUNDATION_COVERAGE_MINIMUMS
    assert plan["data_factory"]["maximum_records_per_generation_shard"] == 200
    assert plan["data_factory"]["generator_may_approve_own_record"] is False
    assert not any(plan["authorization_boundary"].values())

    wrong = deepcopy(plan)
    wrong["route_mixture"]["matchup"]["train"] -= 1
    assert validate_foundation_plan(wrong)


def test_foundation_record_requires_independent_critique_and_consistent_coverage() -> None:
    record = load_json(FOUNDATION_RECORD_TEMPLATE_PATH)
    assert validate_foundation_record(record) == []
    assert "chain_of_thought" not in record

    self_reviewed = deepcopy(record)
    self_reviewed["provenance"]["critic"]["actor_id"] = self_reviewed["provenance"]["generator"][
        "actor_id"
    ]
    assert validate_foundation_record(self_reviewed) == [
        "A Foundation record generator cannot be its own critic."
    ]

    inconsistent = deepcopy(record)
    inconsistent["expected_behavior"]["coverage"]["tool_required"] = False
    assert any(
        "must match tool_requirement" in issue for issue in validate_foundation_record(inconsistent)
    )


def test_evaluation_identity_plan_is_exactly_sized_missing_and_access_unverified() -> None:
    plan = load_json(EVALUATION_PLAN_PATH)
    assert validate_evaluation_plan(plan) == []
    assert {
        layer_id: layer["case_count"] for layer_id, layer in plan["layers"].items()
    } == EVALUATION_CASE_COUNTS
    assert set(plan["layers"]["development"]["route_distribution"].values()) == {30}
    assert set(plan["layers"]["locked"]["route_distribution"].values()) == {20}
    assert all(
        layer["required_training_access"] == "prohibited" for layer in plan["layers"].values()
    )
    assert all(layer["effective_access_verified"] is False for layer in plan["layers"].values())
    assert plan["layers"]["critical"]["status"] == "MISSING"
    assert plan["legacy_exposed_critical"]["status"] == "EXPOSED_NOT_SELECTION_ELIGIBLE"
    assert not any(plan["authorization_boundary"].values())

    misstated = deepcopy(plan)
    misstated["layers"]["critical"]["status"] = "EXPOSED_NOT_SELECTION_ELIGIBLE"
    assert validate_evaluation_plan(misstated)


def test_model_execution_contract_freezes_routing_only_ab_and_all_gates_closed() -> None:
    contract = load_json(EXECUTION_GATES_PATH)
    assert validate_execution_gates(contract) == []
    candidates = contract["candidate_ab"]["candidates"]
    assert candidates[0]["artifact"] == candidates[1]["artifact"]
    assert candidates[0]["routing_revision"] is None
    assert candidates[1]["routing_revision"] == "runtime-answer-routing-v1"
    assert contract["early_stopping_preflight"]["minimum_validation_events"] == 6
    assert contract["early_stopping_preflight"]["best_checkpoint_restoration_verified"] is False
    assert not any(contract["authorization_boundary"].values())

    opened = deepcopy(contract)
    opened["runpod_gates"]["gate_1_baseline_inference"]["authorized"] = True
    assert validate_execution_gates(opened)

    drifted = deepcopy(contract)
    drifted["candidate_ab"]["candidates"][1]["artifact"] = "different_model"
    assert validate_execution_gates(drifted)
