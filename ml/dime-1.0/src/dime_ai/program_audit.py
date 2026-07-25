"""Machine-readable coverage audits for Dime training programs."""

from __future__ import annotations

from collections import Counter
from typing import Any

from dime_ai.data_validation import partition_keys


def _tool_calls(record: dict[str, Any]) -> list[dict[str, Any]]:
    calls = []
    for message in record.get("messages", []):
        if message.get("role") == "assistant":
            calls.extend(message.get("tool_calls", []))
    return calls


def _combined_interaction_mode(value: object) -> str | None:
    if value in {"clarification", "abstention", "protective_response"}:
        return "clarification_abstention_protective"
    return value if isinstance(value, str) else None


def audit_curriculum(
    train_records: list[dict[str, Any]],
    validation_records: list[dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Compare two grouped splits with the frozen curriculum contract."""

    split_records = {
        "train": train_records,
        "validation": validation_records,
    }
    task_quotas = config["task_families"]
    expected_splits = config["dataset"]["splits"]
    expected_modes = config["interaction_modes"]
    required_labels = set(config["required_curriculum_labels"])
    issues: list[str] = []
    task_counts: dict[str, dict[str, int]] = {}
    interaction_counts: Counter[str] = Counter()
    tool_single_counts: Counter[str] = Counter()
    missing_curriculum_labels: list[str] = []
    scenario_by_split: dict[str, set[str]] = {"train": set(), "validation": set()}
    partition_by_split: dict[str, set[str]] = {"train": set(), "validation": set()}
    multi_turn = 0
    multi_tool = 0
    adversarial_or_contradictory = 0
    sport_neutral = 0

    for split, records in split_records.items():
        if len(records) != int(expected_splits[split]):
            issues.append(f"{split} has {len(records)} records; expected {expected_splits[split]}")
        counts = Counter(str(record.get("task_type")) for record in records)
        task_counts[split] = dict(sorted(counts.items()))
        unknown = sorted(set(counts) - set(task_quotas))
        if unknown:
            issues.append(f"{split} has unknown task families: {unknown}")
        for task, quotas in task_quotas.items():
            actual = counts.get(task, 0)
            expected = int(quotas[split])
            if actual != expected:
                issues.append(f"{split}.{task} is {actual}; expected {expected}")

        for record in records:
            record_id = str(record.get("example_id", "unknown"))
            curriculum = record.get("curriculum")
            if not isinstance(curriculum, dict):
                missing_curriculum_labels.append(record_id)
                continue
            missing = required_labels - curriculum.keys()
            if missing:
                missing_curriculum_labels.append(f"{record_id}:{','.join(sorted(missing))}")
            mode = _combined_interaction_mode(curriculum.get("interaction_mode"))
            if mode:
                interaction_counts[mode] += 1
            scenario = curriculum.get("scenario_cluster_id")
            if isinstance(scenario, str) and scenario:
                scenario_by_split[split].add(scenario)
            partition_by_split[split].update(partition_keys(record))
            if (
                curriculum.get("difficulty") == "adversarial"
                or curriculum.get("evidence_status") == "conflicting"
            ):
                adversarial_or_contradictory += 1
            if record.get("metadata", {}).get("sport") is None:
                sport_neutral += 1
            if sum(message.get("role") == "user" for message in record.get("messages", [])) >= 2:
                multi_turn += 1
            calls = _tool_calls(record)
            if len(calls) >= 2:
                multi_tool += 1
            if len(calls) == 1:
                function = calls[0].get("function", {})
                name = function.get("name")
                if isinstance(name, str):
                    tool_single_counts[name] += 1

    if missing_curriculum_labels:
        issues.append(f"{len(missing_curriculum_labels)} records lack required curriculum labels")
    for mode, expected in expected_modes.items():
        actual = interaction_counts.get(mode, 0)
        if actual != int(expected):
            issues.append(f"interaction_mode.{mode} is {actual}; expected {expected}")
    for tool, expected in config["tool_single_call_minimums"].items():
        actual = tool_single_counts.get(tool, 0)
        if actual < int(expected):
            issues.append(f"single-tool {tool} is {actual}; minimum {expected}")

    minimums = config["cross_cutting_minimums"]
    observed_minimums = {
        "multi_turn_records": multi_turn,
        "multi_tool_records": multi_tool,
        "adversarial_or_contradictory_records": adversarial_or_contradictory,
        "sport_neutral_records_when_traffic_unknown": sport_neutral,
    }
    for name, actual in observed_minimums.items():
        expected = int(minimums[name])
        if actual < expected:
            issues.append(f"{name} is {actual}; minimum {expected}")

    scenario_leakage = sorted(scenario_by_split["train"] & scenario_by_split["validation"])
    partition_leakage = sorted(partition_by_split["train"] & partition_by_split["validation"])
    if scenario_leakage:
        issues.append(f"scenario clusters cross splits: {scenario_leakage[:20]}")
    if partition_leakage:
        issues.append(f"event/source/user partitions cross splits: {partition_leakage[:20]}")

    return {
        "schema_version": "dime-curriculum-audit-v1",
        "curriculum_version": config["schema_version"],
        "pass": not issues,
        "records": {
            "train": len(train_records),
            "validation": len(validation_records),
            "total": len(train_records) + len(validation_records),
        },
        "task_counts": task_counts,
        "interaction_mode_counts": dict(sorted(interaction_counts.items())),
        "single_tool_counts": dict(sorted(tool_single_counts.items())),
        "cross_cutting_counts": observed_minimums,
        "missing_curriculum_label_count": len(missing_curriculum_labels),
        "missing_curriculum_label_examples": missing_curriculum_labels[:20],
        "scenario_leakage": scenario_leakage[:20],
        "partition_leakage": partition_leakage[:20],
        "issues": issues,
    }


def audit_evaluation_program(
    records: list[dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Audit a full governed evaluation bank against exposure and suite quotas."""

    issues: list[str] = []
    case_ids = [str(record.get("case_id", "unknown")) for record in records]
    duplicate_ids = sorted({case_id for case_id in case_ids if case_ids.count(case_id) > 1})
    if duplicate_ids:
        issues.append(f"duplicate case IDs: {duplicate_ids[:20]}")

    exposure_counts: dict[str, Counter[str]] = {
        split: Counter() for split in config["exposure_splits"]
    }
    standard_task_counts: dict[str, Counter[str]] = {
        split: Counter() for split in config["exposure_splits"]
    }
    red_team_counts: Counter[str] = Counter()
    scenario_by_split: dict[str, set[str]] = {split: set() for split in config["exposure_splits"]}
    missing_governance_labels = []
    legacy_split_cases = []
    multi_turn = 0
    four_or_more_turns = 0
    multi_tool = 0
    non_ok_tool_status = 0
    future_data_traps = 0

    for record in records:
        case_id = str(record.get("case_id", "unknown"))
        split = record.get("split")
        suite = record.get("suite")
        tags = record.get("tags")
        if split == "red_team":
            legacy_split_cases.append(case_id)
            continue
        if (
            split not in config["exposure_splits"]
            or suite not in {"standard", "safety", "privacy", "red_team", "operations"}
            or not isinstance(tags, dict)
        ):
            missing_governance_labels.append(case_id)
            continue
        purpose_group = "red_team" if suite == "red_team" else "standard"
        exposure_counts[split][purpose_group] += 1
        program_family = tags.get("program_family")
        if not isinstance(program_family, str):
            missing_governance_labels.append(case_id)
            continue
        if purpose_group == "red_team":
            red_team_counts[program_family] += 1
        else:
            standard_task_counts[split][program_family] += 1
        scenario = tags.get("scenario_cluster_id")
        if isinstance(scenario, str):
            scenario_by_split[split].add(scenario)
        turn_depth = tags.get("turn_depth", 0)
        if isinstance(turn_depth, int) and turn_depth >= 2:
            multi_turn += 1
        if isinstance(turn_depth, int) and turn_depth >= 4:
            four_or_more_turns += 1
        if len(record.get("gold", {}).get("required_tool_calls", [])) >= 2:
            multi_tool += 1
        statuses = tags.get("tool_statuses", [])
        if isinstance(statuses, list) and any(status != "ok" for status in statuses):
            non_ok_tool_status += 1
        conditions = tags.get("data_quality_conditions", [])
        if isinstance(conditions, list) and "future_data_trap" in conditions:
            future_data_traps += 1

    if legacy_split_cases:
        issues.append(
            f"{len(legacy_split_cases)} visible legacy red_team split cases require migration"
        )
    if missing_governance_labels:
        issues.append(
            f"{len(missing_governance_labels)} cases lack split/suite/tags governance labels"
        )

    for split, expected_groups in config["exposure_splits"].items():
        for group, expected in expected_groups.items():
            actual = exposure_counts[split][group]
            if actual != int(expected):
                issues.append(f"{split}.{group} is {actual}; expected {expected}")

    for family, split_quotas in config["standard_task_quotas"].items():
        for split, expected in split_quotas.items():
            actual = standard_task_counts[split][family]
            if actual != int(expected):
                issues.append(f"standard.{split}.{family} is {actual}; expected {expected}")
    for family, expected in config["red_team_task_quotas"].items():
        actual = red_team_counts[family]
        if actual != int(expected):
            issues.append(f"red_team.{family} is {actual}; expected {expected}")

    observed_minimums = {
        "multi_turn": multi_turn,
        "four_or_more_turns": four_or_more_turns,
        "multi_tool": multi_tool,
        "non_ok_tool_status": non_ok_tool_status,
        "future_data_traps": future_data_traps,
    }
    for name, expected in config["full_bank_minimums"].items():
        if observed_minimums[name] < int(expected):
            issues.append(f"{name} is {observed_minimums[name]}; minimum {expected}")

    scenario_leakage = []
    splits = list(scenario_by_split)
    for index, left in enumerate(splits):
        for right in splits[index + 1 :]:
            shared = sorted(scenario_by_split[left] & scenario_by_split[right])
            scenario_leakage.extend(f"{left}/{right}:{value}" for value in shared)
    if scenario_leakage:
        issues.append(f"scenario clusters cross exposure splits: {scenario_leakage[:20]}")

    return {
        "schema_version": "dime-evaluation-program-audit-v1",
        "program_version": config["schema_version"],
        "pass": not issues,
        "records": len(records),
        "exposure_counts": {
            split: dict(sorted(counts.items())) for split, counts in exposure_counts.items()
        },
        "standard_task_counts": {
            split: dict(sorted(counts.items())) for split, counts in standard_task_counts.items()
        },
        "red_team_task_counts": dict(sorted(red_team_counts.items())),
        "cross_cutting_counts": observed_minimums,
        "duplicate_case_ids": duplicate_ids,
        "legacy_split_case_count": len(legacy_split_cases),
        "legacy_split_case_examples": legacy_split_cases[:20],
        "missing_governance_label_count": len(missing_governance_labels),
        "missing_governance_label_examples": missing_governance_labels[:20],
        "scenario_leakage": scenario_leakage[:20],
        "issues": issues,
    }
