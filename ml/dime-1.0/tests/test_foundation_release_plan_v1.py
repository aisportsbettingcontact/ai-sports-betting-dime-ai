from __future__ import annotations

import json
from copy import deepcopy

from dime_ai.foundation_control import FOUNDATION_PLAN_PATH, validate_foundation_plan


def load_plan() -> dict:
    return json.loads(FOUNDATION_PLAN_PATH.read_text(encoding="utf-8"))


def assert_rejected(plan: dict) -> None:
    assert validate_foundation_plan(plan)


def test_release_plan_is_closed_world_and_valid() -> None:
    plan = load_plan()

    assert validate_foundation_plan(plan) == []
    assert plan["private_release"]["expected_public_evidence"] == [
        "release_identity.json",
        "dataset_manifest.json",
        "checksums.json",
        "dataset_card.md",
        "provenance_report.json",
        "split_report.json",
        "leakage_report.json",
        "coverage_report.json",
        "rights_report.json",
        "foundation_fixture.sample.jsonl",
        "SHA256SUMS",
    ]
    assert not any(plan["authorization_boundary"].values())


def test_every_route_key_and_count_is_exact() -> None:
    plan = load_plan()

    for route, counts in plan["route_mixture"].items():
        omitted = deepcopy(plan)
        del omitted["route_mixture"][route]
        assert_rejected(omitted)

        for field in counts:
            changed = deepcopy(plan)
            changed["route_mixture"][route][field] += 1
            assert_rejected(changed)


def test_compensated_route_drift_is_rejected() -> None:
    plan = load_plan()
    plan["route_mixture"]["platform"]["total"] -= 1
    plan["route_mixture"]["platform"]["train"] -= 1
    plan["route_mixture"]["matchup"]["total"] += 1
    plan["route_mixture"]["matchup"]["train"] += 1

    assert_rejected(plan)


def test_every_cross_cutting_minimum_is_exact() -> None:
    plan = load_plan()

    for field in plan["cross_cutting_minimums"]:
        omitted = deepcopy(plan)
        del omitted["cross_cutting_minimums"][field]
        assert_rejected(omitted)

        changed = deepcopy(plan)
        changed["cross_cutting_minimums"][field] += 1
        assert_rejected(changed)


def test_every_data_factory_field_is_closed_world() -> None:
    plan = load_plan()
    factory = plan["data_factory"]

    for field in factory:
        omitted = deepcopy(plan)
        del omitted["data_factory"][field]
        assert_rejected(omitted)

    mutations = {
        "orchestrator": {"platform": "Codex", "agent": "unreviewed-agent"},
        "maximum_records_per_generation_shard": 201,
        "stages": list(reversed(factory["stages"])),
        "source_packet_classes": list(reversed(factory["source_packet_classes"])),
        "generator_may_approve_own_record": True,
        "failed_record_disposition": list(reversed(factory["failed_record_disposition"])),
        "live_data_policy": "memorize_current_facts",
        "quantitative_source_of_truth": "generated_prose",
        "private_chain_of_thought_allowed": True,
        "risk_review_all": list(reversed(factory["risk_review_all"])),
        "stratified_review_remaining_categories": False,
        "ai_authorship_policy": {
            **factory["ai_authorship_policy"],
            "resolution_status": "RESOLVED",
        },
    }
    for field, value in mutations.items():
        changed = deepcopy(plan)
        changed["data_factory"][field] = value
        assert_rejected(changed)

    for nested_object in ("orchestrator", "ai_authorship_policy"):
        for field in factory[nested_object]:
            omitted = deepcopy(plan)
            del omitted["data_factory"][nested_object][field]
            assert_rejected(omitted)

    extra = deepcopy(plan)
    extra["data_factory"]["unreviewed_stage"] = True
    assert_rejected(extra)


def test_every_expected_public_evidence_omission_is_rejected() -> None:
    plan = load_plan()
    evidence = plan["private_release"]["expected_public_evidence"]

    for name in evidence:
        omitted = deepcopy(plan)
        omitted["private_release"]["expected_public_evidence"].remove(name)
        assert_rejected(omitted)

    extra = deepcopy(plan)
    extra["private_release"]["expected_public_evidence"].append("unreviewed.json")
    assert_rejected(extra)


def test_known_blocker_list_is_exact() -> None:
    plan = load_plan()

    for blocker in plan["known_blockers"]:
        omitted = deepcopy(plan)
        omitted["known_blockers"].remove(blocker)
        assert_rejected(omitted)

    reordered = deepcopy(plan)
    reordered["known_blockers"].reverse()
    assert_rejected(reordered)


def test_every_authorization_key_omission_and_true_value_is_rejected() -> None:
    plan = load_plan()

    for field in plan["authorization_boundary"]:
        omitted = deepcopy(plan)
        del omitted["authorization_boundary"][field]
        assert_rejected(omitted)

        opened = deepcopy(plan)
        opened["authorization_boundary"][field] = True
        assert_rejected(opened)

    extra = deepcopy(plan)
    extra["authorization_boundary"]["unreviewed_action"] = False
    assert_rejected(extra)
