from copy import deepcopy

from dime_ai.program_audit import audit_curriculum, audit_evaluation_program


def record(example_id: str, task_type: str, scenario: str, source: str) -> dict:
    return {
        "example_id": example_id,
        "task_type": task_type,
        "messages": [
            {"role": "user", "content": "Question"},
            {"role": "assistant", "content": "Answer"},
        ],
        "metadata": {
            "sport": None,
            "source_ids": [source],
            "event_partition_key": None,
            "user_partition_hash": None,
        },
        "curriculum": {
            "skill_ids": [task_type],
            "difficulty": "foundation",
            "interaction_mode": "direct_no_tool",
            "scenario_cluster_id": scenario,
            "evidence_status": "not_applicable",
            "policy_action": "allow",
            "risk_tier": "standard",
        },
    }


def config() -> dict:
    return {
        "schema_version": "test-curriculum",
        "dataset": {"splits": {"train": 1, "validation": 1}},
        "task_families": {"conversation": {"train": 1, "validation": 1}},
        "interaction_modes": {"direct_no_tool": 2},
        "cross_cutting_minimums": {
            "multi_turn_records": 0,
            "multi_tool_records": 0,
            "adversarial_or_contradictory_records": 0,
            "sport_neutral_records_when_traffic_unknown": 2,
        },
        "tool_single_call_minimums": {},
        "required_curriculum_labels": [
            "skill_ids",
            "difficulty",
            "interaction_mode",
            "scenario_cluster_id",
            "evidence_status",
            "policy_action",
            "risk_tier",
        ],
    }


def test_curriculum_audit_passes_exact_small_program() -> None:
    report = audit_curriculum(
        [record("train-1", "conversation", "scenario-a", "source-a")],
        [record("val-1", "conversation", "scenario-b", "source-b")],
        config(),
    )
    assert report["pass"] is True
    assert report["records"]["total"] == 2


def test_curriculum_audit_detects_group_leakage_and_missing_labels() -> None:
    train = record("train-1", "conversation", "shared", "shared-source")
    validation = deepcopy(train)
    validation["example_id"] = "val-1"
    del validation["curriculum"]["risk_tier"]
    report = audit_curriculum([train], [validation], config())
    assert report["pass"] is False
    assert report["scenario_leakage"] == ["shared"]
    assert report["partition_leakage"] == ["shared-source"]
    assert report["missing_curriculum_label_count"] == 1


def test_evaluation_program_audit_passes_exact_small_bank() -> None:
    case = {
        "case_id": "eval-1",
        "split": "dev",
        "suite": "standard",
        "tags": {
            "program_family": "market_math",
            "scenario_cluster_id": "scenario-a",
            "turn_depth": 2,
            "tool_statuses": ["ok"],
            "data_quality_conditions": [],
        },
        "gold": {"required_tool_calls": ["calculate_market_math"]},
    }
    eval_config = {
        "schema_version": "test-eval-program",
        "exposure_splits": {"dev": {"standard": 1, "red_team": 0}},
        "standard_task_quotas": {"market_math": {"dev": 1}},
        "red_team_task_quotas": {},
        "full_bank_minimums": {
            "multi_turn": 1,
            "four_or_more_turns": 0,
            "multi_tool": 0,
            "non_ok_tool_status": 0,
            "future_data_traps": 0,
        },
    }
    report = audit_evaluation_program([case], eval_config)
    assert report["pass"] is True
    assert report["exposure_counts"]["dev"]["standard"] == 1


def test_evaluation_program_audit_rejects_legacy_red_team_split() -> None:
    case = {"case_id": "legacy", "split": "red_team"}
    eval_config = {
        "schema_version": "test-eval-program",
        "exposure_splits": {"dev": {"standard": 0, "red_team": 0}},
        "standard_task_quotas": {},
        "red_team_task_quotas": {},
        "full_bank_minimums": {
            "multi_turn": 0,
            "four_or_more_turns": 0,
            "multi_tool": 0,
            "non_ok_tool_status": 0,
            "future_data_traps": 0,
        },
    }
    report = audit_evaluation_program([case], eval_config)
    assert report["pass"] is False
    assert report["legacy_split_case_count"] == 1
