import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest
import yaml

from dime_ai.program_audit import (
    ProgramAuditConfigError,
    audit_curriculum,
    audit_evaluation_program,
    validate_curriculum_config,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CURRICULUM_PATH = PROJECT_ROOT / "configs" / "curriculum_v1.yaml"
TRAIN_SCRIPT = PROJECT_ROOT / "scripts" / "train_qlora.py"
OPERATIONS = [
    "implied_probability",
    "implied_probability",
    "remove_vig",
    "market_hold",
    "expected_value",
    "settled_profit",
    "roi",
    "probability_clv",
]
SAFETY_SUBFAMILIES = [
    "responsible_gaming",
    "privacy",
    "security",
    "eligibility",
    "acute_distress",
    "responsible_gaming",
]
SAFETY_MODES = [
    "successful_tool_assisted",
    "degraded_tool_assisted",
    "direct_no_tool",
    "clarification",
    "abstention",
    "protective_response",
]
SAFETY_TOOLS = {
    "train": [
        "get_game_context",
        "get_current_odds",
        None,
        "get_odds_history",
        "get_market_splits",
        "get_bet_tracker_summary",
    ],
    "validation": [
        "run_simulation",
        "get_current_odds",
        None,
        "get_odds_history",
        "get_market_splits",
        "get_bet_tracker_summary",
    ],
}


def load_training_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "dime_train_qlora_curriculum_test",
        TRAIN_SCRIPT,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TRAINING = load_training_module()


def production_config() -> dict:
    return yaml.safe_load(CURRICULUM_PATH.read_text())


def compact_config() -> dict:
    config = production_config()
    config["dataset"] = {
        "version": "dime-sft-foundation-test",
        "target_records": 28,
        "splits": {"train": 14, "validation": 14},
        "research_alpha_below_records": 27,
    }
    config["task_families"] = {
        "market_math": {"train": 8, "validation": 8},
        "safety_privacy_security": {"train": 6, "validation": 6},
    }
    config["interaction_modes"] = {
        "successful_tool_assisted": {"train": 9, "validation": 9},
        "degraded_tool_assisted": {"train": 1, "validation": 1},
        "direct_no_tool": {"train": 1, "validation": 1},
        "clarification": {"train": 1, "validation": 1},
        "abstention": {"train": 1, "validation": 1},
        "protective_response": {"train": 1, "validation": 1},
    }
    config["cross_cutting_minimums"] = {
        "multi_turn_records": 0,
        "multi_tool_records": 0,
        "adversarial_or_contradictory_records": 0,
        "sport_neutral_records_when_traffic_unknown": 28,
    }
    config["distribution_caps"] = {
        "league_fraction": 1.0,
        "market_type_fraction": 1.0,
        "provider_fraction": 1.0,
    }
    config["metadata_requirements"] = {
        "market_type_required_task_families": ["market_math"],
        "provider_id_required_tools": [
            "get_game_context",
            "get_current_odds",
            "get_odds_history",
            "get_market_splits",
            "get_bet_tracker_summary",
            "run_simulation",
        ],
    }
    config["answer_length_distribution"] = {
        "concise": {"train": 12, "validation": 12, "word_range": [1, 5]},
        "normal": {"train": 1, "validation": 1, "word_range": [6, 10]},
        "detailed": {"train": 1, "validation": 1, "word_range": [11, 20]},
    }
    config["market_math_operation_quotas"] = {
        operation: {
            "train": OPERATIONS.count(operation),
            "validation": OPERATIONS.count(operation),
        }
        for operation in dict.fromkeys(OPERATIONS)
    }
    config["safety_subfamily_minimums"] = {
        "responsible_gaming": {"train": 1, "validation": 1},
        "privacy": {"train": 1, "validation": 1},
        "security": {"train": 1, "validation": 1},
        "eligibility": {"train": 1, "validation": 1},
        "acute_distress": {"train": 1, "validation": 1},
    }
    config["control_pair_minimums"] = {"records": 2, "distinct_pairs": 1}
    config["tool_single_call_minimums"] = {tool: 1 for tool in config["tool_single_call_minimums"]}
    config["stages"] = [
        {"name": "foundation_screen_authored", "target": 1, "gpu_required": False},
        {"name": "overfit_diagnostic", "target": 1, "gpu_required": True},
        {"name": "foundation_tranche", "target": 14, "gpu_required": False},
        {"name": "complete_foundation_sft", "target": 28, "gpu_required": False},
        {"name": "one_epoch_candidate", "target": 14, "gpu_required": True},
    ]
    return config


def words(token: str, count: int) -> str:
    return " ".join([token] * count)


def record(
    example_id: str,
    task_type: str,
    scenario: str,
    source: str,
    *,
    answer: str = "Answer",
    answer_length: str = "concise",
    interaction_mode: str = "direct_no_tool",
) -> dict:
    return {
        "example_id": example_id,
        "task_type": task_type,
        "messages": [
            {"role": "user", "content": "Question"},
            {"role": "assistant", "content": answer},
        ],
        "metadata": {
            "sport": None,
            "league": None,
            "market_type": None,
            "provider_ids": [],
            "source_ids": [source],
            "event_partition_key": None,
            "user_partition_hash": None,
        },
        "curriculum": {
            "skill_ids": [task_type],
            "difficulty": "foundation",
            "interaction_mode": interaction_mode,
            "scenario_cluster_id": scenario,
            "evidence_status": "not_applicable",
            "policy_action": "allow",
            "risk_tier": "standard",
            "answer_length": answer_length,
            "control_pair_id": None,
            "market_math_operation": None,
            "safety_subfamily": None,
        },
    }


def add_tool_call(
    item: dict,
    name: str,
    *,
    status: str = "ok",
    arguments: dict | None = None,
) -> None:
    call_id = "call_1"
    item["messages"] = [
        {"role": "user", "content": item["messages"][0]["content"]},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments or {}},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": json.dumps({"status": status}, sort_keys=True),
        },
        {"role": "assistant", "content": item["messages"][-1]["content"]},
    ]
    if name != "calculate_market_math":
        item["metadata"]["provider_ids"] = ["provider_one"]


def valid_program() -> tuple[list[dict], list[dict], dict]:
    config = compact_config()
    splits: dict[str, list[dict]] = {"train": [], "validation": []}
    for split in splits:
        for index, operation in enumerate(OPERATIONS):
            answer_length = "concise"
            answer = "Answer"
            if index == 0:
                answer_length = "normal"
                answer = words(f"{split}alpha", 6)
            elif index == 1:
                answer_length = "detailed"
                answer = words(f"{split}beta", 11)
            item = record(
                f"{split}_math_{index}",
                "market_math",
                f"{split}_math_scenario_{index}",
                f"{split}_math_source_{index}",
                answer=answer,
                answer_length=answer_length,
                interaction_mode="successful_tool_assisted",
            )
            item["metadata"]["market_type"] = "moneyline"
            item["curriculum"]["market_math_operation"] = operation
            add_tool_call(
                item,
                "calculate_market_math",
                arguments={"operation": operation},
            )
            splits[split].append(item)

        for index, (subfamily, mode) in enumerate(
            zip(SAFETY_SUBFAMILIES, SAFETY_MODES, strict=True)
        ):
            item = record(
                f"{split}_safety_{index}",
                "safety_privacy_security",
                f"{split}_safety_scenario_{index}",
                f"{split}_safety_source_{index}",
                interaction_mode=mode,
            )
            item["curriculum"]["safety_subfamily"] = subfamily
            tool = SAFETY_TOOLS[split][index]
            if tool is not None:
                add_tool_call(
                    item,
                    tool,
                    status="stale" if mode == "degraded_tool_assisted" else "ok",
                )
            splits[split].append(item)

    first, second = splits["train"][:2]
    for item in (first, second):
        item["messages"][0]["content"] = "Equivalent control question"
        item["curriculum"]["scenario_cluster_id"] = "train_control_scenario"
        item["curriculum"]["control_pair_id"] = "control_pair_one"
    first["curriculum"]["evidence_status"] = "complete"
    second["curriculum"]["evidence_status"] = "partial"
    second["curriculum"]["policy_action"] = "partial"
    return splits["train"], splits["validation"], config


def test_production_curriculum_config_is_structurally_valid() -> None:
    validate_curriculum_config(production_config())


def test_approved_curriculum_passes_schema_audit_and_training_status_gate() -> None:
    train, validation, config = valid_program()
    config["status"] = "approved"

    validate_curriculum_config(config)
    report = audit_curriculum(train, validation, config)

    assert report["pass"] is True
    assert report["program_status"] == "approved"
    assert TRAINING.require_approved_curriculum(config) is config


@pytest.mark.parametrize("status", ["draft", "training_authorized", "APPROVED", ""])
def test_invalid_curriculum_statuses_fail_schema_and_training_gate(status: str) -> None:
    config = compact_config()
    config["status"] = status

    with pytest.raises(ProgramAuditConfigError, match="status"):
        validate_curriculum_config(config)
    with pytest.raises(ValueError, match="curriculum status: approved"):
        TRAINING.require_approved_curriculum(config)


@pytest.mark.parametrize("status", ["proposed", "frozen", "retired"])
def test_nonapproved_governed_statuses_remain_ineligible_for_training(
    status: str,
) -> None:
    config = compact_config()
    config["status"] = status

    validate_curriculum_config(config)
    with pytest.raises(ValueError, match="curriculum status: approved"):
        TRAINING.require_approved_curriculum(config)


@pytest.mark.parametrize(
    "section",
    [
        "distribution_caps",
        "distribution_aliases",
        "metadata_requirements",
        "answer_length_distribution",
        "market_math_operation_quotas",
        "safety_subfamily_minimums",
        "control_pair_minimums",
        "control_pair_policy",
        "admission",
    ],
)
def test_curriculum_config_rejects_missing_policy_sections(section: str) -> None:
    config = production_config()
    del config[section]

    with pytest.raises(ProgramAuditConfigError, match=section):
        validate_curriculum_config(config)


def test_curriculum_config_rejects_unknown_sections_and_disabled_admission() -> None:
    config = production_config()
    config["distribution_cap_typo"] = {}
    config["admission"]["schema_valid"] = False

    with pytest.raises(ProgramAuditConfigError) as error:
        validate_curriculum_config(config)

    assert "distribution_cap_typo" in str(error.value)
    assert "admission.schema_valid" in str(error.value)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda config: config["distribution_caps"].__setitem__("league_fraction", 1.01),
            "league_fraction",
        ),
        (
            lambda config: config["dataset"]["splits"].__setitem__("train", 2159),
            "target_records",
        ),
        (
            lambda config: config["interaction_modes"]["clarification"].__setitem__("train", 89),
            "interaction_modes.train total",
        ),
        (
            lambda config: config["market_math_operation_quotas"]["roi"].__setitem__("train", 26),
            "market_math_operation_quotas.train total",
        ),
        (
            lambda config: config["control_pair_minimums"].__setitem__("records", 239),
            "must be even",
        ),
    ],
)
def test_curriculum_config_rejects_invalid_ranges_and_quota_totals(
    mutation,
    message: str,
) -> None:
    config = production_config()
    mutation(config)

    with pytest.raises(ProgramAuditConfigError, match=message):
        validate_curriculum_config(config)


def test_curriculum_audit_passes_a_complete_compact_program() -> None:
    train, validation, config = valid_program()

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is True
    assert report["schema_version"] == "dime-curriculum-audit-v2"
    assert report["config_validation"]["pass"] is True
    assert report["candidate_status"] == "meets_curriculum_contract"
    assert report["records"]["total"] == 28
    assert report["control_pair_counts"]["valid_records"] == 2


def test_curriculum_audit_rejects_noncanonical_and_duplicate_record_ids() -> None:
    train, validation, config = valid_program()
    validation[0]["example_id"] = " Train_Math_0 "

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["record_id_failure_count"] == 1
    assert report["duplicate_record_ids"] == ["train_math_0"]


def test_curriculum_audit_rejects_missing_unknown_and_malformed_labels() -> None:
    train, validation, config = valid_program()
    del train[2]["curriculum"]["risk_tier"]
    train[3]["curriculum"]["interaction_mode_typo"] = "direct_no_tool"
    train[4]["curriculum"]["skill_ids"] = "market_math"

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["missing_curriculum_label_count"] == 1
    assert report["curriculum_structure_failure_count"] >= 3
    failures = report["curriculum_structure_failure_examples"]
    assert any("unknown curriculum fields" in failure for failure in failures)
    assert any("skill_ids" in failure for failure in failures)


def test_curriculum_audit_fails_closed_on_unhashable_malformed_values() -> None:
    train, validation, config = valid_program()
    train[2]["curriculum"]["difficulty"] = []
    train[3]["curriculum"]["interaction_mode"] = {}
    train[4]["curriculum"]["evidence_status"] = []
    train[5]["curriculum"]["policy_action"] = {}
    train[6]["curriculum"]["risk_tier"] = []
    train[7]["curriculum"]["answer_length"] = {}
    train[2]["curriculum"]["market_math_operation"] = []
    train[8]["curriculum"]["safety_subfamily"] = []
    train[9]["task_type"] = []
    validation[2]["messages"].append("not-a-message")

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["curriculum_structure_failure_count"] >= 6
    assert report["market_math_failure_count"] >= 1
    assert report["safety_label_failure_count"] >= 1
    assert any("unknown task families" in issue for issue in report["issues"])


def test_curriculum_audit_enforces_each_interaction_mode_separately() -> None:
    train, validation, config = valid_program()
    clarification = next(
        item for item in train if item["curriculum"]["interaction_mode"] == "clarification"
    )
    clarification["curriculum"]["interaction_mode"] = "abstention"

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["interaction_mode_counts_by_split"]["train"]["abstention"] == 2
    assert any("interaction_mode.train.clarification" in issue for issue in report["issues"])
    assert any("interaction_mode.train.abstention" in issue for issue in report["issues"])


def test_curriculum_audit_enforces_every_named_safety_subfamily() -> None:
    train, validation, config = valid_program()
    privacy = next(item for item in train if item["curriculum"]["safety_subfamily"] == "privacy")
    privacy["curriculum"]["safety_subfamily"] = "responsible_gaming"

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["safety_subfamily_counts"]["train"]["responsible_gaming"] == 3
    assert report["safety_subfamily_counts"]["train"].get("privacy", 0) == 0
    assert any("safety_subfamily.train.privacy" in issue for issue in report["issues"])


def test_curriculum_audit_combines_aliases_and_checks_each_split_cap() -> None:
    train, validation, config = valid_program()
    config["distribution_caps"]["league_fraction"] = 0.5
    for index, item in enumerate(train[:8]):
        item["metadata"]["sport"] = "american_football"
        item["metadata"]["league"] = "nfl" if index % 2 == 0 else "national_football_league"

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["distribution_counts"]["by_split"]["train"]["league"]["nfl"] == 8
    assert any(
        violation.startswith("train.league_fraction:nfl=")
        for violation in report["distribution_violations"]
    )
    assert not any(
        violation.startswith("aggregate.league_fraction:nfl=")
        for violation in report["distribution_violations"]
    )
    assert report["distribution_aliasing_failure_count"] >= 4


def test_curriculum_audit_rejects_inconsistent_sport_league_pairing() -> None:
    train, validation, config = valid_program()
    train[0]["metadata"]["sport"] = "basketball"
    train[0]["metadata"]["league"] = "nfl"

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["sport_league_failure_count"] == 1
    assert "american_football" in report["sport_league_failure_examples"][0]


def test_curriculum_control_pair_requires_equivalent_normalized_input() -> None:
    train, validation, config = valid_program()
    train[1]["messages"][0]["content"] = "Different control question"

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["control_pair_counts"]["valid_records"] == 0
    assert report["control_pair_counts"]["labeled_records"] == 2
    assert any(
        "equivalent normalized model input" in failure
        for failure in report["control_pair_failure_examples"]
    )
    assert any("valid control-pair records are 0" in issue for issue in report["issues"])


def test_curriculum_control_pair_output_check_cannot_be_bypassed_by_other_failures() -> None:
    train, validation, config = valid_program()
    train[1]["messages"][-1]["content"] = "  " + train[0]["messages"][-1]["content"].upper() + "  "

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["control_pair_counts"]["valid_distinct_pairs"] == 0
    assert any(
        "intentionally distinct assistant outputs" in failure
        for failure in report["control_pair_failure_examples"]
    )


def test_curriculum_interaction_status_requires_one_result_per_call() -> None:
    train, validation, config = valid_program()
    train[2]["messages"].pop(2)

    report = audit_curriculum(train, validation, config)

    assert report["pass"] is False
    assert report["interaction_coherence_failure_count"] == 1
    assert "one all-ok result per tool call" in report["interaction_coherence_failure_examples"][0]


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


def test_evaluation_program_audit_rejects_case_id_alias_collisions() -> None:
    cases = [
        {
            "case_id": "eval-one",
            "split": "dev",
            "suite": "standard",
            "tags": {
                "program_family": "market_math",
                "scenario_cluster_id": "scenario-a",
            },
            "gold": {"required_tool_calls": []},
        },
        {
            "case_id": " EVAL-ONE ",
            "split": "dev",
            "suite": "standard",
            "tags": {
                "program_family": "market_math",
                "scenario_cluster_id": "scenario-b",
            },
            "gold": {"required_tool_calls": []},
        },
    ]
    eval_config = {
        "schema_version": "test-eval-program",
        "exposure_splits": {"dev": {"standard": 2, "red_team": 0}},
        "standard_task_quotas": {"market_math": {"dev": 2}},
        "red_team_task_quotas": {},
        "full_bank_minimums": {
            "multi_turn": 0,
            "four_or_more_turns": 0,
            "multi_tool": 0,
            "non_ok_tool_status": 0,
            "future_data_traps": 0,
        },
    }

    report = audit_evaluation_program(cases, eval_config)

    assert report["pass"] is False
    assert report["duplicate_case_ids"] == ["eval-one"]
    assert report["case_id_failure_count"] == 1
