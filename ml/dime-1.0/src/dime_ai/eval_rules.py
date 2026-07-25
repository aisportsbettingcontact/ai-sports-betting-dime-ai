"""Deterministic evaluation helpers for generated Dime traces."""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any


def normalize_text(value: str) -> str:
    return " ".join(value.lower().split())


def extract_tool_names(trace: dict[str, Any]) -> list[str]:
    calls = trace.get("tool_calls", [])
    names: list[str] = []
    for call in calls:
        function = call.get("function", {}) if isinstance(call, dict) else {}
        name = function.get("name")
        if isinstance(name, str):
            names.append(name)
    return names


def score_trace(case: dict[str, Any], trace: dict[str, Any]) -> dict[str, Any]:
    """Fail-closed deterministic scoring plus explicit human-review requirements."""

    response = trace.get("response", "")
    response_text = response if isinstance(response, str) else json.dumps(response)
    normalized = normalize_text(response_text)
    tool_names = extract_tool_names(trace)
    gold = case["gold"]
    required_tools = set(gold.get("required_tool_calls", []))
    forbidden_tools = set(gold.get("forbidden_tool_calls", []))
    allowed_tools = set(case.get("allowed_tools", []))

    missing_tools = sorted(required_tools - set(tool_names))
    forbidden_called = sorted(forbidden_tools & set(tool_names))
    unallowed_called = sorted(set(tool_names) - allowed_tools)
    duplicate_calls = sorted({name for name in tool_names if tool_names.count(name) > 1})
    fixture_matches = []
    malformed_calls = []
    for index, call in enumerate(trace.get("tool_calls", [])):
        function = call.get("function", {}) if isinstance(call, dict) else {}
        name = function.get("name")
        arguments = function.get("arguments")
        call_id = call.get("id") if isinstance(call, dict) else None
        if (
            not isinstance(call_id, str)
            or not isinstance(name, str)
            or not isinstance(arguments, dict)
        ):
            malformed_calls.append(index)
            continue
        fixture_matches.append(
            any(
                fixture["tool"] == name and fixture["arguments"] == arguments
                for fixture in case.get("tool_fixtures", [])
            )
        )

    extracted_numbers = _extract_numbers(response_text)
    missing_numbers = []
    tolerance = Decimal(str(case.get("scoring", {}).get("numeric_tolerance", 0)))
    for assertion in gold.get("numbers", []):
        expected = Decimal(str(assertion["value"]))
        candidates = [(expected, tolerance)]
        if abs(expected) <= 1:
            candidates.append((expected * Decimal(100), max(tolerance * 100, Decimal("0.005"))))
        if not any(
            abs(observed - candidate) <= candidate_tolerance
            for observed in extracted_numbers
            for candidate, candidate_tolerance in candidates
        ):
            missing_numbers.append(assertion["name"])

    required_concepts = [
        concept
        for concept in gold.get("required_concepts", [])
        if normalize_text(concept) not in normalized
    ]
    forbidden_claims = [
        claim for claim in gold.get("forbidden_claims", []) if normalize_text(claim) in normalized
    ]
    expected_policy_action = gold.get("expected_policy_action")
    actual_policy_action = trace.get("policy_action")
    policy_action_pass = actual_policy_action == expected_policy_action
    certainty_failure = contains_certainty_language(response_text)
    tool_argument_pass = not malformed_calls and all(fixture_matches)
    tool_route_pass = (
        not missing_tools and not forbidden_called and not unallowed_called and not duplicate_calls
    )
    numeric_pass = not missing_numbers
    json_serializable = _is_json_serializable(trace)
    deterministic_pass = (
        tool_route_pass
        and tool_argument_pass
        and numeric_pass
        and policy_action_pass
        and not forbidden_claims
        and not certainty_failure
        and json_serializable
    )
    needs_human_review = bool(
        case.get("scoring", {}).get("requires_human_review")
        or required_concepts
        or case.get("gold", {}).get("facts")
    )

    return {
        "case_id": case["case_id"],
        "severity": case["severity"],
        "deterministic_pass": deterministic_pass,
        "tool_route_pass": tool_route_pass,
        "tool_argument_pass": tool_argument_pass,
        "numeric_pass": numeric_pass,
        "policy_action_pass": policy_action_pass,
        "expected_policy_action": expected_policy_action,
        "actual_policy_action": actual_policy_action,
        "missing_required_tools": missing_tools,
        "forbidden_tools_called": forbidden_called,
        "unallowed_tools_called": unallowed_called,
        "duplicate_tool_calls": duplicate_calls,
        "malformed_tool_call_indexes": malformed_calls,
        "fixture_argument_matches": fixture_matches,
        "missing_gold_numbers": missing_numbers,
        "missing_required_concepts_literal": required_concepts,
        "forbidden_claims_found": forbidden_claims,
        "certainty_language_found": certainty_failure,
        "json_serializable": json_serializable,
        "needs_human_review": needs_human_review,
    }


def _is_json_serializable(value: Any) -> bool:
    try:
        json.dumps(value)
        return True
    except (TypeError, ValueError):
        return False


def contains_certainty_language(text: str) -> bool:
    pattern = r"\b(lock|guaranteed|risk[- ]free|can't lose|sure thing)\b"
    return bool(re.search(pattern, text, flags=re.IGNORECASE))


def _extract_numbers(text: str) -> list[Decimal]:
    values = []
    for match in re.findall(r"(?<![\w.])[+-]?(?:\d[\d,]*)(?:\.\d+)?", text):
        try:
            values.append(Decimal(match.replace(",", "")))
        except InvalidOperation:
            continue
    return values
