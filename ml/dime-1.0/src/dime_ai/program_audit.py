"""Machine-readable coverage audits for Dime training programs."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from dime_ai.data_validation import partition_keys


class ProgramAuditConfigError(ValueError):
    """Raised when a program configuration cannot safely drive an audit."""


_CURRICULUM_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "schemas" / "curriculum_program.schema.json"
)
_RECORD_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_CANONICAL_TOKEN_PATTERN = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
_NON_TOKEN_CHARACTERS = re.compile(r"[^a-z0-9]+")
_CURRICULUM_FIELDS = {
    "answer_length",
    "control_pair_id",
    "difficulty",
    "evidence_status",
    "interaction_mode",
    "market_math_operation",
    "policy_action",
    "risk_tier",
    "safety_subfamily",
    "scenario_cluster_id",
    "skill_ids",
}
_DIFFICULTIES = {"foundation", "intermediate", "hard", "adversarial"}
_EVIDENCE_STATUSES = {
    "blocked",
    "complete",
    "conflicting",
    "error",
    "missing",
    "not_applicable",
    "partial",
    "stale",
    "unauthorized",
}
_POLICY_ACTIONS = {
    "abstain",
    "acute_distress_block",
    "age_block",
    "allow",
    "clarify",
    "jurisdiction_block",
    "not_applicable",
    "partial",
    "privacy_block",
    "protective_block",
    "self_exclusion_block",
}
_RISK_TIERS = {"standard", "high", "critical"}
_STAGE_NAMES = {
    "foundation_screen_authored",
    "overfit_diagnostic",
    "foundation_tranche",
    "complete_foundation_sft",
    "one_epoch_candidate",
}
_DISTRIBUTION_DIMENSIONS = {
    "league_fraction": "league",
    "market_type_fraction": "market_type",
    "provider_fraction": "provider",
}


@lru_cache(maxsize=1)
def _curriculum_validator() -> Draft202012Validator:
    schema = json.loads(_CURRICULUM_SCHEMA_PATH.read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _schema_error_location(error: Any) -> str:
    path = ".".join(str(part) for part in error.absolute_path)
    return path or "<root>"


def _canonical_token(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    return _NON_TOKEN_CHARACTERS.sub("_", normalized).strip("_")


def _canonical_record_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    if not normalized or not _RECORD_ID_PATTERN.fullmatch(normalized):
        return None
    return normalized


def _semantic_curriculum_config_errors(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    splits = config["dataset"]["splits"]
    target_records = config["dataset"]["target_records"]
    if sum(splits.values()) != target_records:
        errors.append(
            "dataset.target_records must equal dataset.splits.train + dataset.splits.validation"
        )
    if config["dataset"]["research_alpha_below_records"] >= target_records:
        errors.append("dataset.research_alpha_below_records must be below target_records")

    for split, expected in splits.items():
        task_total = sum(quotas[split] for quotas in config["task_families"].values())
        if task_total != expected:
            errors.append(
                f"task_families.{split} total is {task_total}; expected dataset split {expected}"
            )
        interaction_total = sum(quotas[split] for quotas in config["interaction_modes"].values())
        if interaction_total != expected:
            errors.append(
                f"interaction_modes.{split} total is {interaction_total}; "
                f"expected dataset split {expected}"
            )
        answer_total = sum(
            quotas[split] for quotas in config["answer_length_distribution"].values()
        )
        if answer_total != expected:
            errors.append(
                f"answer_length_distribution.{split} total is {answer_total}; "
                f"expected dataset split {expected}"
            )

    market_math_quotas = config["task_families"].get("market_math")
    if market_math_quotas is None:
        errors.append("task_families must define market_math")
    else:
        for split in splits:
            operation_total = sum(
                quotas[split] for quotas in config["market_math_operation_quotas"].values()
            )
            if operation_total != market_math_quotas[split]:
                errors.append(
                    f"market_math_operation_quotas.{split} total is {operation_total}; "
                    f"expected task_families.market_math.{split}={market_math_quotas[split]}"
                )

    safety_quotas = config["task_families"].get("safety_privacy_security")
    if safety_quotas is None:
        errors.append("task_families must define safety_privacy_security")
    else:
        for split in splits:
            minimum_total = sum(
                quotas[split] for quotas in config["safety_subfamily_minimums"].values()
            )
            if minimum_total > safety_quotas[split]:
                errors.append(
                    f"safety_subfamily_minimums.{split} total is {minimum_total}; "
                    f"exceeds task_families.safety_privacy_security.{split}="
                    f"{safety_quotas[split]}"
                )

    task_families = set(config["task_families"])
    required_market_types = set(
        config["metadata_requirements"]["market_type_required_task_families"]
    )
    unknown_market_type_tasks = sorted(required_market_types - task_families)
    if unknown_market_type_tasks:
        errors.append(
            "metadata_requirements.market_type_required_task_families contains "
            f"unknown task families: {unknown_market_type_tasks}"
        )

    for name, minimum in config["cross_cutting_minimums"].items():
        if minimum > target_records:
            errors.append(
                f"cross_cutting_minimums.{name}={minimum} exceeds target_records={target_records}"
            )
    for tool, minimum in config["tool_single_call_minimums"].items():
        if minimum > target_records:
            errors.append(
                f"tool_single_call_minimums.{tool}={minimum} exceeds target_records="
                f"{target_records}"
            )
    tool_minimum_total = sum(config["tool_single_call_minimums"].values())
    if tool_minimum_total > target_records:
        errors.append(
            f"tool_single_call_minimums total is {tool_minimum_total}; "
            f"exceeds target_records={target_records}"
        )
    unknown_provider_tools = sorted(
        set(config["metadata_requirements"]["provider_id_required_tools"])
        - set(config["tool_single_call_minimums"])
    )
    if unknown_provider_tools:
        errors.append(
            "metadata_requirements.provider_id_required_tools contains unknown tools: "
            f"{unknown_provider_tools}"
        )

    pair_minimums = config["control_pair_minimums"]
    if pair_minimums["records"] > target_records:
        errors.append("control_pair_minimums.records exceeds dataset.target_records")
    if pair_minimums["records"] % 2:
        errors.append("control_pair_minimums.records must be even")
    if pair_minimums["records"] != pair_minimums["distinct_pairs"] * 2:
        errors.append("control_pair_minimums.records must equal two times distinct_pairs")

    previous_upper = 0
    for label in ("concise", "normal", "detailed"):
        lower, upper = config["answer_length_distribution"][label]["word_range"]
        if lower > upper:
            errors.append(f"answer_length_distribution.{label}.word_range is reversed")
        if lower != previous_upper + 1:
            errors.append(
                "answer_length_distribution word ranges must be contiguous and "
                f"non-overlapping; {label} begins at {lower}, expected {previous_upper + 1}"
            )
        previous_upper = upper

    for cap_name, cap in config["distribution_caps"].items():
        if not math.isfinite(cap):
            errors.append(f"distribution_caps.{cap_name} must be finite")

    aliases = config["distribution_aliases"]
    for dimension in ("sports", "leagues"):
        lookup: dict[str, str] = {}
        for canonical, values in aliases[dimension].items():
            if _canonical_token(canonical) != canonical:
                errors.append(
                    f"distribution_aliases.{dimension} canonical key {canonical!r} is not canonical"
                )
            if canonical not in values:
                errors.append(
                    f"distribution_aliases.{dimension}.{canonical} must include its canonical value"
                )
            for alias in values:
                normalized = _canonical_token(alias)
                previous = lookup.get(normalized)
                if previous is not None and previous != canonical:
                    errors.append(
                        f"distribution_aliases.{dimension} maps {alias!r} to both "
                        f"{previous!r} and {canonical!r}"
                    )
                lookup[normalized] = canonical
    for league, sport in aliases["league_sports"].items():
        if league not in aliases["leagues"]:
            errors.append(f"distribution_aliases.league_sports has unmapped league {league!r}")
        if sport not in aliases["sports"]:
            errors.append(f"distribution_aliases.league_sports maps to unknown sport {sport!r}")
    unmapped_leagues = sorted(set(aliases["leagues"]) - set(aliases["league_sports"]))
    if unmapped_leagues:
        errors.append(
            f"distribution_aliases.league_sports is missing canonical leagues: {unmapped_leagues}"
        )

    stages = config["stages"]
    stage_names = [stage["name"] for stage in stages]
    if len(stage_names) != len(set(stage_names)) or set(stage_names) != _STAGE_NAMES:
        errors.append("stages must contain each governed stage exactly once")
    stages_by_name = {stage["name"]: stage for stage in stages}
    if stages_by_name.get("complete_foundation_sft", {}).get("target") != target_records:
        errors.append("stages.complete_foundation_sft.target must equal dataset.target_records")
    if stages_by_name.get("one_epoch_candidate", {}).get("target") != splits["train"]:
        errors.append("stages.one_epoch_candidate.target must equal dataset.splits.train")
    for stage in stages:
        if stage["target"] > target_records:
            errors.append(f"stages.{stage['name']}.target exceeds dataset.target_records")
    return errors


def validate_curriculum_config(config: object) -> None:
    """Validate the complete curriculum configuration before reading records."""

    if not isinstance(config, dict):
        raise ProgramAuditConfigError("curriculum configuration must be an object")
    schema_errors = sorted(
        _curriculum_validator().iter_errors(config),
        key=lambda error: (
            tuple(str(part) for part in error.absolute_path),
            error.message,
        ),
    )
    if schema_errors:
        formatted = [
            f"{_schema_error_location(error)}: {error.message}" for error in schema_errors[:20]
        ]
        raise ProgramAuditConfigError("invalid curriculum configuration: " + "; ".join(formatted))
    semantic_errors = _semantic_curriculum_config_errors(config)
    if semantic_errors:
        raise ProgramAuditConfigError(
            "invalid curriculum configuration: " + "; ".join(semantic_errors[:20])
        )


def _tool_calls(record: dict[str, Any]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    messages = record.get("messages", [])
    if not isinstance(messages, list):
        return calls
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        tool_calls = message.get("tool_calls", [])
        if isinstance(tool_calls, list):
            calls.extend(call for call in tool_calls if isinstance(call, dict))
    return calls


def _tool_statuses(record: dict[str, Any]) -> list[str]:
    statuses: list[str] = []
    messages = record.get("messages", [])
    if not isinstance(messages, list):
        return statuses
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "tool":
            continue
        try:
            content = json.loads(message.get("content", ""))
        except (json.JSONDecodeError, TypeError):
            continue
        status = content.get("status") if isinstance(content, dict) else None
        if isinstance(status, str):
            statuses.append(status)
    return statuses


def _assistant_word_count(record: dict[str, Any]) -> int:
    messages = record.get("messages", [])
    if not isinstance(messages, list):
        return 0
    return sum(
        len(message.get("content", "").split())
        for message in messages
        if isinstance(message, dict)
        and message.get("role") == "assistant"
        and isinstance(message.get("content"), str)
    )


def _nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _normalize_json_value(value: object) -> object:
    if isinstance(value, dict):
        return {
            str(key): _normalize_json_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, list):
        return [_normalize_json_value(item) for item in value]
    if isinstance(value, str):
        return _normalize_text(value)
    return value


def _normalize_message(message: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {"role": message.get("role")}
    content = message.get("content")
    if isinstance(content, str):
        if message.get("role") == "tool":
            try:
                normalized["content"] = _normalize_json_value(json.loads(content))
            except (json.JSONDecodeError, TypeError):
                normalized["content"] = _normalize_text(content)
        else:
            normalized["content"] = _normalize_text(content)
    if _nonempty_string(message.get("name")):
        normalized["name"] = _canonical_token(str(message["name"]))
    calls = message.get("tool_calls")
    if isinstance(calls, list):
        normalized_calls: list[dict[str, Any]] = []
        for call in calls:
            if not isinstance(call, dict):
                normalized_calls.append({"malformed": _normalize_json_value(call)})
                continue
            function = call.get("function")
            if not isinstance(function, dict):
                normalized_calls.append({"malformed": _normalize_json_value(call)})
                continue
            normalized_calls.append(
                {
                    "name": (
                        _canonical_token(function["name"])
                        if _nonempty_string(function.get("name"))
                        else None
                    ),
                    "arguments": _normalize_json_value(function.get("arguments")),
                }
            )
        normalized["tool_calls"] = normalized_calls
    return normalized


def _normalized_control_input(record: dict[str, Any]) -> str | None:
    messages = record.get("messages")
    if not isinstance(messages, list):
        return None
    assistant_indexes = [
        index
        for index, message in enumerate(messages)
        if isinstance(message, dict) and message.get("role") == "assistant"
    ]
    if not assistant_indexes:
        return None
    final_assistant_index = assistant_indexes[-1]
    prefix_messages = [
        _normalize_message(message)
        for message in messages[:final_assistant_index]
        if isinstance(message, dict)
    ]
    metadata = record.get("metadata")
    context = {
        field: (
            _canonical_token(metadata[field])
            if isinstance(metadata, dict) and _nonempty_string(metadata.get(field))
            else None
        )
        for field in ("sport", "league", "market_type")
    }
    return json.dumps(
        {"context": context, "messages": prefix_messages},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def _normalized_control_output(record: dict[str, Any]) -> str | None:
    messages = record.get("messages")
    if not isinstance(messages, list):
        return None
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "assistant":
            return json.dumps(
                _normalize_message(message),
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            )
    return None


def _digest(value: str | None) -> str | None:
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value is not None else None


def _dimension_alias_lookups(config: dict[str, Any]) -> dict[str, dict[str, str]]:
    lookups: dict[str, dict[str, str]] = {}
    for plural, singular in (("sports", "sport"), ("leagues", "league")):
        lookup: dict[str, str] = {}
        for canonical, aliases in config["distribution_aliases"][plural].items():
            for alias in aliases:
                lookup[_canonical_token(alias)] = canonical
        lookups[singular] = lookup
    return lookups


def _canonical_dimension(
    value: object,
    *,
    aliases: dict[str, str] | None = None,
) -> tuple[str | None, bool]:
    if not _nonempty_string(value):
        return None, False
    raw = str(value)
    normalized = _canonical_token(raw)
    if not normalized or not _CANONICAL_TOKEN_PATTERN.fullmatch(normalized):
        return None, True
    canonical = aliases.get(normalized, normalized) if aliases is not None else normalized
    return canonical, raw != canonical


def audit_curriculum(
    train_records: list[dict[str, Any]],
    validation_records: list[dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Compare two grouped splits with a structurally valid curriculum contract."""

    validate_curriculum_config(config)
    split_records = {"train": train_records, "validation": validation_records}
    task_quotas = config["task_families"]
    expected_splits = config["dataset"]["splits"]
    expected_modes = config["interaction_modes"]
    required_labels = set(config["required_curriculum_labels"])
    metadata_policy = config["metadata_requirements"]
    market_type_required_tasks = set(metadata_policy["market_type_required_task_families"])
    provider_id_required_tools = set(metadata_policy["provider_id_required_tools"])
    control_policy = config["control_pair_policy"]
    control_shared_fields = tuple(control_policy["shared_fields"])
    control_difference_axes = tuple(control_policy["difference_axes"])
    required_control_differences = control_policy["required_difference_count"]
    control_outcome_fields = tuple(control_policy["required_outcome_difference_fields"])
    dimension_aliases = _dimension_alias_lookups(config)

    issues: list[str] = []
    task_counts: dict[str, dict[str, int]] = {}
    interaction_counts: Counter[str] = Counter()
    interaction_counts_by_split: dict[str, Counter[str]] = {
        "train": Counter(),
        "validation": Counter(),
    }
    tool_single_counts: Counter[str] = Counter()
    missing_curriculum_labels: list[str] = []
    curriculum_structure_failures: list[str] = []
    record_id_failures: list[str] = []
    record_id_locations: dict[str, list[str]] = defaultdict(list)
    interaction_coherence_failures: list[str] = []
    answer_length_failures: list[str] = []
    market_math_failures: list[str] = []
    safety_label_failures: list[str] = []
    metadata_coherence_failures: list[str] = []
    distribution_aliasing_failures: list[str] = []
    sport_league_failures: list[str] = []
    dimension_variants: dict[str, dict[str, set[str]]] = {
        dimension: defaultdict(set) for dimension in ("sport", "league", "market_type", "provider")
    }
    sports_by_league: dict[str, set[str]] = defaultdict(set)
    scenario_by_split: dict[str, set[str]] = {"train": set(), "validation": set()}
    partition_by_split: dict[str, set[str]] = {"train": set(), "validation": set()}
    answer_length_counts: dict[str, Counter[str]] = {
        "train": Counter(),
        "validation": Counter(),
    }
    market_math_counts: dict[str, Counter[str]] = {
        "train": Counter(),
        "validation": Counter(),
    }
    safety_counts: dict[str, Counter[str]] = {
        "train": Counter(),
        "validation": Counter(),
    }
    distribution_counts: dict[str, dict[str, Counter[str]]] = {
        scope: {
            "league": Counter(),
            "market_type": Counter(),
            "provider": Counter(),
        }
        for scope in ("aggregate", "train", "validation")
    }
    control_pairs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    multi_turn = 0
    multi_tool = 0
    adversarial_or_contradictory = 0
    sport_neutral = 0

    for split, records in split_records.items():
        if len(records) != expected_splits[split]:
            issues.append(f"{split} has {len(records)} records; expected {expected_splits[split]}")
        counts: Counter[str] = Counter()
        for record in records:
            if not isinstance(record, dict):
                counts["<malformed>"] += 1
                continue
            task_type = record.get("task_type")
            counts[str(task_type) if isinstance(task_type, str) else "<malformed>"] += 1
        task_counts[split] = dict(sorted(counts.items()))
        unknown = sorted(set(counts) - set(task_quotas))
        if unknown:
            issues.append(f"{split} has unknown task families: {unknown}")
        for task, quotas in task_quotas.items():
            actual = counts.get(task, 0)
            expected = quotas[split]
            if actual != expected:
                issues.append(f"{split}.{task} is {actual}; expected {expected}")

        for index, candidate in enumerate(records):
            location = f"{split}[{index}]"
            if not isinstance(candidate, dict):
                record_id_failures.append(f"{location}: record must be an object")
                curriculum_structure_failures.append(f"{location}: record must be an object")
                continue
            record = candidate
            raw_record_id = record.get("example_id")
            canonical_record_id = _canonical_record_id(raw_record_id)
            if canonical_record_id is None:
                record_id = location
                record_id_failures.append(
                    f"{location}: example_id must be a non-empty canonical ASCII identifier"
                )
            else:
                record_id = canonical_record_id
                record_id_locations[canonical_record_id].append(location)
                if raw_record_id != canonical_record_id:
                    record_id_failures.append(
                        f"{location}: example_id {raw_record_id!r} is not canonical; "
                        f"use {canonical_record_id!r}"
                    )

            curriculum = record.get("curriculum")
            if not isinstance(curriculum, dict):
                missing_curriculum_labels.append(record_id)
                curriculum_structure_failures.append(f"{record_id}: curriculum must be an object")
                curriculum = {}
            else:
                missing = required_labels - curriculum.keys()
                if missing:
                    missing_curriculum_labels.append(f"{record_id}:{','.join(sorted(missing))}")
                unknown_curriculum_fields = sorted(set(curriculum) - _CURRICULUM_FIELDS)
                if unknown_curriculum_fields:
                    curriculum_structure_failures.append(
                        f"{record_id}: unknown curriculum fields {unknown_curriculum_fields}"
                    )

            skill_ids = curriculum.get("skill_ids")
            if (
                not isinstance(skill_ids, list)
                or not skill_ids
                or len(skill_ids) != len(set(map(str, skill_ids)))
                or any(
                    not isinstance(value, str)
                    or _canonical_token(value) != value
                    or not _CANONICAL_TOKEN_PATTERN.fullmatch(value)
                    for value in skill_ids
                )
            ):
                curriculum_structure_failures.append(
                    f"{record_id}: skill_ids must be unique canonical identifiers"
                )
            difficulty = curriculum.get("difficulty")
            if not isinstance(difficulty, str) or difficulty not in _DIFFICULTIES:
                curriculum_structure_failures.append(
                    f"{record_id}: invalid difficulty {difficulty!r}"
                )
            mode = curriculum.get("interaction_mode")
            if not isinstance(mode, str) or mode not in expected_modes:
                curriculum_structure_failures.append(
                    f"{record_id}: invalid interaction_mode {mode!r}"
                )
            else:
                interaction_counts[str(mode)] += 1
                interaction_counts_by_split[split][str(mode)] += 1
            scenario = _canonical_record_id(curriculum.get("scenario_cluster_id"))
            if scenario is None:
                curriculum_structure_failures.append(
                    f"{record_id}: scenario_cluster_id must be canonical"
                )
            else:
                if curriculum.get("scenario_cluster_id") != scenario:
                    curriculum_structure_failures.append(
                        f"{record_id}: scenario_cluster_id is not canonical; use {scenario!r}"
                    )
                scenario_by_split[split].add(scenario)
            evidence_status = curriculum.get("evidence_status")
            if not isinstance(evidence_status, str) or evidence_status not in _EVIDENCE_STATUSES:
                curriculum_structure_failures.append(
                    f"{record_id}: invalid evidence_status {evidence_status!r}"
                )
            policy_action = curriculum.get("policy_action")
            if not isinstance(policy_action, str) or policy_action not in _POLICY_ACTIONS:
                curriculum_structure_failures.append(
                    f"{record_id}: invalid policy_action {policy_action!r}"
                )
            risk_tier = curriculum.get("risk_tier")
            if not isinstance(risk_tier, str) or risk_tier not in _RISK_TIERS:
                curriculum_structure_failures.append(
                    f"{record_id}: invalid risk_tier {risk_tier!r}"
                )
            answer_label = curriculum.get("answer_length")
            if (
                not isinstance(answer_label, str)
                or answer_label not in config["answer_length_distribution"]
            ):
                curriculum_structure_failures.append(
                    f"{record_id}: invalid answer_length {answer_label!r}"
                )

            if (
                isinstance(record.get("metadata"), dict)
                and isinstance(record.get("messages"), list)
                and all(isinstance(message, dict) for message in record.get("messages", []))
            ):
                partition_by_split[split].update(partition_keys(record))
            if difficulty == "adversarial" or evidence_status == "conflicting":
                adversarial_or_contradictory += 1

            messages = record.get("messages")
            if not isinstance(messages, list):
                curriculum_structure_failures.append(f"{record_id}: messages must be an array")
                messages = []
            if (
                sum(
                    isinstance(message, dict) and message.get("role") == "user"
                    for message in messages
                )
                >= 2
            ):
                multi_turn += 1
            calls = _tool_calls(record)
            statuses = _tool_statuses(record)
            distinct_tool_names: set[str] = set()
            for call in calls:
                function = call.get("function")
                if not isinstance(function, dict):
                    continue
                name = function.get("name")
                if _nonempty_string(name):
                    distinct_tool_names.add(str(name))
            if len(distinct_tool_names) >= 2:
                multi_tool += 1
            if len(calls) == 1:
                function = calls[0].get("function")
                name = function.get("name") if isinstance(function, dict) else None
                if _nonempty_string(name):
                    tool_single_counts[name] += 1

            if mode == "direct_no_tool" and calls:
                interaction_coherence_failures.append(
                    f"{record_id}: direct_no_tool contains tool calls"
                )
            if mode == "successful_tool_assisted" and (
                not calls
                or len(statuses) != len(calls)
                or any(status != "ok" for status in statuses)
            ):
                interaction_coherence_failures.append(
                    f"{record_id}: successful_tool_assisted requires one all-ok "
                    "result per tool call"
                )
            if mode == "degraded_tool_assisted" and (
                not calls
                or len(statuses) != len(calls)
                or all(status == "ok" for status in statuses)
            ):
                interaction_coherence_failures.append(
                    f"{record_id}: degraded_tool_assisted requires one result per call "
                    "and at least one non-ok result"
                )

            if (
                isinstance(answer_label, str)
                and answer_label in config["answer_length_distribution"]
            ):
                answer_length_counts[split][answer_label] += 1
                bounds = config["answer_length_distribution"][answer_label]["word_range"]
                word_count = _assistant_word_count(record)
                if not bounds[0] <= word_count <= bounds[1]:
                    answer_length_failures.append(
                        f"{record_id}: {word_count} words do not match {answer_label} "
                        f"range {bounds}"
                    )

            operation = curriculum.get("market_math_operation")
            if record.get("task_type") == "market_math":
                if (
                    not isinstance(operation, str)
                    or operation not in config["market_math_operation_quotas"]
                ):
                    market_math_failures.append(
                        f"{record_id}: market_math requires a configured market_math_operation"
                    )
                else:
                    market_math_counts[split][operation] += 1
                    actual_operations: set[object] = set()
                    for call in calls:
                        function = call.get("function")
                        if (
                            not isinstance(function, dict)
                            or function.get("name") != "calculate_market_math"
                        ):
                            continue
                        arguments = function.get("arguments")
                        if isinstance(arguments, dict):
                            called_operation = arguments.get("operation")
                            if isinstance(called_operation, str):
                                actual_operations.add(called_operation)
                    if operation not in actual_operations:
                        market_math_failures.append(
                            f"{record_id}: labeled operation {operation} is not called"
                        )
            elif operation is not None:
                market_math_failures.append(
                    f"{record_id}: market_math_operation is allowed only on market_math"
                )

            safety_subfamily = curriculum.get("safety_subfamily")
            if record.get("task_type") == "safety_privacy_security":
                if (
                    isinstance(safety_subfamily, str)
                    and safety_subfamily in config["safety_subfamily_minimums"]
                ):
                    safety_counts[split][safety_subfamily] += 1
                else:
                    safety_label_failures.append(
                        f"{record_id}: safety_privacy_security requires a configured "
                        "safety_subfamily"
                    )
            elif safety_subfamily is not None and safety_subfamily != "not_applicable":
                safety_label_failures.append(
                    f"{record_id}: safety_subfamily is allowed only on safety_privacy_security"
                )

            task_type = record.get("task_type")
            metadata = record.get("metadata")
            if not isinstance(metadata, dict):
                metadata_coherence_failures.append(f"{record_id}: metadata must be an object")
                metadata = {}
            sport = metadata.get("sport")
            league = metadata.get("league")
            sport_present = _nonempty_string(sport)
            league_present = _nonempty_string(league)
            if sport is None and league is None:
                sport_neutral += 1
            elif sport_present != league_present:
                metadata_coherence_failures.append(
                    f"{record_id}: sport and league must both be canonical strings or both null"
                )
            elif not sport_present or not league_present:
                metadata_coherence_failures.append(
                    f"{record_id}: sport and league cannot be empty or malformed"
                )

            canonical_sport, sport_is_alias = _canonical_dimension(
                sport,
                aliases=dimension_aliases["sport"],
            )
            canonical_league, league_is_alias = _canonical_dimension(
                league,
                aliases=dimension_aliases["league"],
            )
            if sport_present and canonical_sport is None:
                metadata_coherence_failures.append(
                    f"{record_id}: sport is not a canonical identifier"
                )
            if league_present and canonical_league is None:
                metadata_coherence_failures.append(
                    f"{record_id}: league is not a canonical identifier"
                )
            if canonical_sport is not None:
                dimension_variants["sport"][canonical_sport].add(str(sport))
                if sport_is_alias:
                    distribution_aliasing_failures.append(
                        f"{record_id}: sport {sport!r} aliases canonical {canonical_sport!r}"
                    )
            if canonical_league is not None:
                dimension_variants["league"][canonical_league].add(str(league))
                if league_is_alias:
                    distribution_aliasing_failures.append(
                        f"{record_id}: league {league!r} aliases canonical {canonical_league!r}"
                    )
                for scope in (split, "aggregate"):
                    distribution_counts[scope]["league"][canonical_league] += 1
            if canonical_sport is not None and canonical_league is not None:
                sports_by_league[canonical_league].add(canonical_sport)
                expected_sport = config["distribution_aliases"]["league_sports"].get(
                    canonical_league
                )
                if expected_sport is not None and canonical_sport != expected_sport:
                    sport_league_failures.append(
                        f"{record_id}: league {canonical_league!r} belongs to "
                        f"sport {expected_sport!r}, not {canonical_sport!r}"
                    )

            market_type = metadata.get("market_type")
            if (
                isinstance(task_type, str)
                and task_type in market_type_required_tasks
                and not _nonempty_string(market_type)
            ):
                metadata_coherence_failures.append(
                    f"{record_id}: task family {task_type} requires market_type"
                )
            canonical_market_type, market_type_is_alias = _canonical_dimension(market_type)
            if _nonempty_string(market_type) and canonical_market_type is None:
                metadata_coherence_failures.append(
                    f"{record_id}: market_type is not a canonical identifier"
                )
            if canonical_market_type is not None:
                dimension_variants["market_type"][canonical_market_type].add(str(market_type))
                if market_type_is_alias:
                    distribution_aliasing_failures.append(
                        f"{record_id}: market_type {market_type!r} is not canonical; "
                        f"use {canonical_market_type!r}"
                    )
                for scope in (split, "aggregate"):
                    distribution_counts[scope]["market_type"][canonical_market_type] += 1

            provider_ids = metadata.get("provider_ids")
            if not isinstance(provider_ids, list):
                metadata_coherence_failures.append(f"{record_id}: provider_ids must be an array")
                provider_ids = []
            canonical_providers: set[str] = set()
            for provider in provider_ids:
                canonical_provider, provider_is_alias = _canonical_dimension(provider)
                if canonical_provider is None:
                    metadata_coherence_failures.append(
                        f"{record_id}: provider_id {provider!r} is not canonical"
                    )
                    continue
                if canonical_provider in canonical_providers:
                    metadata_coherence_failures.append(
                        f"{record_id}: duplicate or aliased provider_id {canonical_provider!r}"
                    )
                canonical_providers.add(canonical_provider)
                dimension_variants["provider"][canonical_provider].add(str(provider))
                if provider_is_alias:
                    distribution_aliasing_failures.append(
                        f"{record_id}: provider_id {provider!r} is not canonical; "
                        f"use {canonical_provider!r}"
                    )
            for provider in canonical_providers:
                for scope in (split, "aggregate"):
                    distribution_counts[scope]["provider"][provider] += 1
            provider_tools_used = sorted(
                name for name in distinct_tool_names if name in provider_id_required_tools
            )
            if provider_tools_used and not canonical_providers:
                metadata_coherence_failures.append(
                    f"{record_id}: provider-dependent tools {provider_tools_used} "
                    "require provider_ids"
                )

            pair_id = curriculum.get("control_pair_id")
            if pair_id is not None:
                canonical_pair_id = _canonical_record_id(pair_id)
                if canonical_pair_id is None:
                    curriculum_structure_failures.append(
                        f"{record_id}: control_pair_id must be canonical or null"
                    )
                else:
                    if pair_id != canonical_pair_id:
                        curriculum_structure_failures.append(
                            f"{record_id}: control_pair_id is not canonical; "
                            f"use {canonical_pair_id!r}"
                        )
                    control_pairs[canonical_pair_id].append(
                        {
                            "example_id": record_id,
                            "split": split,
                            "task_type": task_type,
                            "scenario_cluster_id": scenario,
                            "policy_action": policy_action,
                            "evidence_status": evidence_status,
                            "risk_tier": risk_tier,
                            "normalized_input": _normalized_control_input(record),
                            "normalized_output": _normalized_control_output(record),
                        }
                    )

    duplicate_record_ids = sorted(
        record_id for record_id, locations in record_id_locations.items() if len(locations) > 1
    )
    if duplicate_record_ids:
        issues.append(f"duplicate canonical example IDs: {duplicate_record_ids[:20]}")
    if record_id_failures:
        issues.append(f"{len(record_id_failures)} records have invalid example IDs")
    if missing_curriculum_labels:
        issues.append(f"{len(missing_curriculum_labels)} records lack required curriculum labels")
    if curriculum_structure_failures:
        issues.append(f"{len(curriculum_structure_failures)} curriculum structure violations")
    if interaction_coherence_failures:
        issues.append(
            f"{len(interaction_coherence_failures)} records have incoherent interaction labels"
        )
    if answer_length_failures:
        issues.append(f"{len(answer_length_failures)} records have incorrect answer-length labels")
    if market_math_failures:
        issues.append(f"{len(market_math_failures)} market-math records are not traceable")
    if safety_label_failures:
        issues.append(
            f"{len(safety_label_failures)} records have incoherent safety_subfamily labels"
        )
    if metadata_coherence_failures:
        issues.append(f"{len(metadata_coherence_failures)} records have incomplete market metadata")
    for dimension, canonical_values in dimension_variants.items():
        for canonical, variants in sorted(canonical_values.items()):
            if len(variants) > 1:
                distribution_aliasing_failures.append(
                    f"{dimension} aliases for {canonical!r}: {sorted(variants)}"
                )
    if distribution_aliasing_failures:
        issues.append(f"{len(distribution_aliasing_failures)} non-canonical distribution labels")
    for league, sports in sorted(sports_by_league.items()):
        if len(sports) > 1:
            sport_league_failures.append(
                f"league {league!r} appears under multiple sports: {sorted(sports)}"
            )
    if sport_league_failures:
        issues.append(f"{len(sport_league_failures)} sport/league coherence violations")

    for mode, quotas in expected_modes.items():
        for split in split_records:
            actual = interaction_counts_by_split[split].get(mode, 0)
            expected = quotas[split]
            if actual != expected:
                issues.append(f"interaction_mode.{split}.{mode} is {actual}; expected {expected}")
    for tool, expected in config["tool_single_call_minimums"].items():
        actual = tool_single_counts.get(tool, 0)
        if actual < expected:
            issues.append(f"single-tool {tool} is {actual}; minimum {expected}")

    for label, details in config["answer_length_distribution"].items():
        for split in split_records:
            actual = answer_length_counts[split][label]
            expected = details[split]
            if actual != expected:
                issues.append(f"answer_length.{split}.{label} is {actual}; expected {expected}")

    for operation, quotas in config["market_math_operation_quotas"].items():
        for split in split_records:
            actual = market_math_counts[split][operation]
            expected = quotas[split]
            if actual != expected:
                issues.append(
                    f"market_math_operation.{split}.{operation} is {actual}; expected {expected}"
                )

    for subfamily, minimums in config["safety_subfamily_minimums"].items():
        for split in split_records:
            actual = safety_counts[split][subfamily]
            expected = minimums[split]
            if actual < expected:
                issues.append(
                    f"safety_subfamily.{split}.{subfamily} is {actual}; minimum {expected}"
                )

    minimums = config["cross_cutting_minimums"]
    observed_minimums = {
        "multi_turn_records": multi_turn,
        "multi_tool_records": multi_tool,
        "adversarial_or_contradictory_records": adversarial_or_contradictory,
        "sport_neutral_records_when_traffic_unknown": sport_neutral,
    }
    for name, actual in observed_minimums.items():
        expected = minimums[name]
        if actual < expected:
            issues.append(f"{name} is {actual}; minimum {expected}")

    total_records = len(train_records) + len(validation_records)
    distribution_violations: list[str] = []
    scope_denominators = {
        "aggregate": total_records,
        "train": len(train_records),
        "validation": len(validation_records),
    }
    for scope, denominator in scope_denominators.items():
        if not denominator:
            continue
        for cap_name, dimension in _DISTRIBUTION_DIMENSIONS.items():
            counts = distribution_counts[scope][dimension]
            cap = config["distribution_caps"][cap_name]
            for value, count in sorted(counts.items()):
                fraction = count / denominator
                if fraction > cap:
                    distribution_violations.append(
                        f"{scope}.{cap_name}:{value}={fraction:.6f}>{cap:.6f}"
                    )
    if distribution_violations:
        issues.append(f"distribution caps exceeded: {distribution_violations[:20]}")

    invalid_control_pairs: list[str] = []
    control_pair_failures: list[str] = []
    control_pair_difference_axes: dict[str, str] = {}
    control_pair_input_digests: dict[str, str] = {}
    valid_control_pair_records = 0
    valid_control_pairs = 0
    for pair_id, members in sorted(control_pairs.items()):
        reasons: list[str] = []
        if len(members) != 2:
            reasons.append(f"requires exactly 2 members, found {len(members)}")
        else:
            mismatched_shared_fields = [
                field
                for field in control_shared_fields
                if members[0].get(field) != members[1].get(field)
            ]
            if mismatched_shared_fields:
                reasons.append("members must share " + ", ".join(sorted(mismatched_shared_fields)))
            if control_policy["require_same_split"] and members[0]["split"] != members[1]["split"]:
                reasons.append("members must remain in the same split")
            difference_axes = [
                field
                for field in control_difference_axes
                if members[0].get(field) != members[1].get(field)
            ]
            if len(difference_axes) != required_control_differences:
                reasons.append(
                    f"requires {required_control_differences} configured difference axis; "
                    f"found {sorted(difference_axes)}"
                )
            else:
                control_pair_difference_axes[pair_id] = ",".join(difference_axes)
            missing_outcome_differences = [
                field
                for field in control_outcome_fields
                if members[0].get(field) == members[1].get(field)
            ]
            if missing_outcome_differences:
                reasons.append(
                    "members must differ on outcome field(s) "
                    + ", ".join(sorted(missing_outcome_differences))
                )
            if (
                control_policy["require_equivalent_normalized_input"]
                and members[0]["normalized_input"] != members[1]["normalized_input"]
            ):
                reasons.append("members must share equivalent normalized model input")
            if members[0]["normalized_input"] is None:
                reasons.append("members require a valid normalized model input")
            if (
                control_policy["require_distinct_normalized_output"]
                and members[0]["normalized_output"] == members[1]["normalized_output"]
            ):
                reasons.append("members must have intentionally distinct assistant outputs")
            if any(member["normalized_output"] is None for member in members):
                reasons.append("members require a valid assistant output")
        if reasons:
            invalid_control_pairs.append(pair_id)
            control_pair_failures.append(f"{pair_id}: {'; '.join(reasons)}")
            control_pair_difference_axes.pop(pair_id, None)
        else:
            valid_control_pairs += 1
            valid_control_pair_records += 2
            input_digest = _digest(members[0]["normalized_input"])
            if input_digest is not None:
                control_pair_input_digests[pair_id] = input_digest

    labeled_control_pair_records = sum(len(members) for members in control_pairs.values())
    control_config = config["control_pair_minimums"]
    if invalid_control_pairs:
        issues.append(f"invalid matched control pairs: {invalid_control_pairs[:20]}")
    if valid_control_pair_records < control_config["records"]:
        issues.append(
            f"valid control-pair records are {valid_control_pair_records}; "
            f"minimum {control_config['records']}"
        )
    if valid_control_pairs < control_config["distinct_pairs"]:
        issues.append(
            f"valid distinct control pairs are {valid_control_pairs}; "
            f"minimum {control_config['distinct_pairs']}"
        )

    scenario_leakage = sorted(scenario_by_split["train"] & scenario_by_split["validation"])
    partition_leakage = sorted(partition_by_split["train"] & partition_by_split["validation"])
    if scenario_leakage:
        issues.append(f"scenario clusters cross splits: {scenario_leakage[:20]}")
    if partition_leakage:
        issues.append(f"event/source/user partitions cross splits: {partition_leakage[:20]}")

    return {
        "schema_version": "dime-curriculum-audit-v2",
        "curriculum_version": config["schema_version"],
        "program_status": config["status"],
        "config_validation": {
            "pass": True,
            "schema": _CURRICULUM_SCHEMA_PATH.name,
        },
        "candidate_status": (
            "meets_curriculum_contract" if not issues else "does_not_meet_curriculum_contract"
        ),
        "pass": not issues,
        "records": {
            "train": len(train_records),
            "validation": len(validation_records),
            "total": len(train_records) + len(validation_records),
        },
        "task_counts": task_counts,
        "interaction_mode_counts": dict(sorted(interaction_counts.items())),
        "interaction_mode_counts_by_split": {
            split: dict(sorted(counts.items()))
            for split, counts in interaction_counts_by_split.items()
        },
        "single_tool_counts": dict(sorted(tool_single_counts.items())),
        "cross_cutting_counts": observed_minimums,
        "answer_length_counts": {
            split: dict(sorted(counts.items())) for split, counts in answer_length_counts.items()
        },
        "market_math_operation_counts": {
            split: dict(sorted(counts.items())) for split, counts in market_math_counts.items()
        },
        "safety_subfamily_counts": {
            split: dict(sorted(counts.items())) for split, counts in safety_counts.items()
        },
        "distribution_counts": {
            **{
                dimension: dict(sorted(distribution_counts["aggregate"][dimension].items()))
                for dimension in ("league", "market_type", "provider")
            },
            "by_split": {
                split: {
                    dimension: dict(sorted(distribution_counts[split][dimension].items()))
                    for dimension in ("league", "market_type", "provider")
                }
                for split in ("train", "validation")
            },
        },
        "distribution_violations": distribution_violations,
        "distribution_aliasing_failure_count": len(distribution_aliasing_failures),
        "distribution_aliasing_failure_examples": distribution_aliasing_failures[:20],
        "sport_league_failure_count": len(sport_league_failures),
        "sport_league_failure_examples": sport_league_failures[:20],
        "control_pair_counts": {
            "labeled_records": labeled_control_pair_records,
            "labeled_distinct_pairs": len(control_pairs),
            "valid_records": valid_control_pair_records,
            "valid_distinct_pairs": valid_control_pairs,
            "invalid_pairs": invalid_control_pairs[:20],
            "difference_axes": dict(sorted(control_pair_difference_axes.items())),
            "normalized_input_sha256": dict(sorted(control_pair_input_digests.items())),
        },
        "control_pair_failure_examples": control_pair_failures[:20],
        "duplicate_record_ids": duplicate_record_ids[:20],
        "record_id_failure_count": len(record_id_failures),
        "record_id_failure_examples": record_id_failures[:20],
        "curriculum_structure_failure_count": len(curriculum_structure_failures),
        "curriculum_structure_failure_examples": curriculum_structure_failures[:20],
        "interaction_coherence_failure_count": len(interaction_coherence_failures),
        "interaction_coherence_failure_examples": interaction_coherence_failures[:20],
        "answer_length_failure_count": len(answer_length_failures),
        "answer_length_failure_examples": answer_length_failures[:20],
        "market_math_failure_count": len(market_math_failures),
        "market_math_failure_examples": market_math_failures[:20],
        "safety_label_failure_count": len(safety_label_failures),
        "safety_label_failure_examples": safety_label_failures[:20],
        "metadata_coherence_failure_count": len(metadata_coherence_failures),
        "metadata_coherence_failure_examples": metadata_coherence_failures[:20],
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
    case_id_failures: list[str] = []
    case_id_locations: dict[str, list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            case_id_failures.append(f"record[{index}]: evaluation case must be an object")
            continue
        raw_case_id = record.get("case_id")
        canonical_case_id = _canonical_record_id(raw_case_id)
        if canonical_case_id is None:
            case_id_failures.append(
                f"record[{index}]: case_id must be a non-empty canonical ASCII identifier"
            )
            continue
        case_id_locations[canonical_case_id].append(index)
        if raw_case_id != canonical_case_id:
            case_id_failures.append(
                f"record[{index}]: case_id {raw_case_id!r} is not canonical; "
                f"use {canonical_case_id!r}"
            )
    duplicate_ids = sorted(
        case_id for case_id, locations in case_id_locations.items() if len(locations) > 1
    )
    if duplicate_ids:
        issues.append(f"duplicate canonical case IDs: {duplicate_ids[:20]}")
    if case_id_failures:
        issues.append(f"{len(case_id_failures)} cases have invalid case IDs")

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

    for index, record in enumerate(records):
        if not isinstance(record, dict):
            missing_governance_labels.append(f"record[{index}]")
            continue
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
        gold = record.get("gold")
        required_tool_calls = gold.get("required_tool_calls", []) if isinstance(gold, dict) else []
        if isinstance(required_tool_calls, list) and len(required_tool_calls) >= 2:
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
        "case_id_failure_count": len(case_id_failures),
        "case_id_failure_examples": case_id_failures[:20],
        "legacy_split_case_count": len(legacy_split_cases),
        "legacy_split_case_examples": legacy_split_cases[:20],
        "missing_governance_label_count": len(missing_governance_labels),
        "missing_governance_label_examples": missing_governance_labels[:20],
        "scenario_leakage": scenario_leakage[:20],
        "issues": issues,
    }
