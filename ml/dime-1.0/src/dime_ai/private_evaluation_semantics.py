"""Deterministic generation and fail-closed validation of private semantic cases."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_contracts import FoundationContractError
from dime_ai.governed_json import GovernedJsonError, load_governed_json, loads_governed_json
from dime_ai.tool_contracts import (
    TOOL_NAMES,
    validate_tool_arguments,
    validate_tool_response,
)

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parents[1]
DEFAULT_CONFIG_PATH = ML_ROOT / "configs" / "private_evaluation_semantic_generation_v1.json"
DEFAULT_SCHEMA_PATH = ML_ROOT / "schemas" / "private_evaluation_semantic_case.schema.json"
GENERATOR_PATH = Path(__file__).resolve()

LAYERS = ("development", "sealed_critical", "locked", "general_regression")
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
GROUP_DIMENSIONS = (
    "scenario_family_id",
    "template_family_id",
    "source_event_id",
    "conversation_family_id",
    "quantitative_scenario_id",
    "entity_set_temporal_bucket",
)
FORBIDDEN_SEMANTIC_KEYS = frozenset(
    {
        "answer",
        "answer_key",
        "answers",
        "expected_answer",
        "expected_final_response",
        "expected_output",
        "gold",
        "gold_answer",
        "reference_answer",
        "reference_response",
        "rubric",
        "scoring",
        "target_output",
    }
)
TOOLS_BY_ROUTE = {
    "platform": (),
    "account": ("get_bet_tracker_summary",),
    "educational": ("calculate_market_math",),
    "bet_explanation": (
        "calculate_market_math",
        "get_current_odds",
        "get_market_splits",
    ),
    "matchup": (
        "get_game_context",
        "get_current_odds",
        "run_simulation",
    ),
    "full_slate": (),
    "historical": ("get_odds_history",),
    "live_data": (
        "get_current_odds",
        "get_game_context",
        "get_market_splits",
    ),
    "general_sports": (),
}
CAPABILITIES_BY_ROUTE = {
    "platform": ("platform_scope", "grounded_explanation"),
    "account": ("authorization_boundary", "missing_state_handling"),
    "educational": ("quantitative_reasoning", "concept_explanation"),
    "bet_explanation": ("market_interpretation", "uncertainty_calibration"),
    "matchup": ("event_resolution", "evidence_synthesis"),
    "full_slate": ("bounded_context", "cross_event_comparison"),
    "historical": ("temporal_reasoning", "historical_grounding"),
    "live_data": ("freshness_validation", "tool_result_validation"),
    "general_sports": ("sports_reasoning", "uncertainty_calibration"),
}
ROUTE_REQUESTS = {
    "platform": (
        "Explain which Dime surface fits this request without inventing unavailable access.",
        "Distinguish the product capability from anything the platform cannot currently do.",
        "Give a concise navigation-oriented explanation using only the supplied contract facts.",
        "Resolve the feature-scope question and preserve the stated access boundary.",
        "Describe the relevant Dime capability while separating analysis from wager execution.",
        "Explain what the user can verify in the named product surface and what remains unknown.",
        "Clarify the difference between Dime Chat and the adjacent platform feature in context.",
        "Answer the platform question without claiming universal sport or market coverage.",
        "Use the static feature evidence to explain the next user action.",
        "State the product boundary and identify which missing fact would require clarification.",
    ),
    "account": (
        "Explain the account state that can be established and ask only for information "
        "still missing.",
        "Handle the access question without inferring subscription, identity, or payment state.",
        "Use the supplied authorization flags to describe the available account action.",
        "Separate authenticated access from owner-only access in a concise response.",
        "Resolve the account request while refusing to expose another user's information.",
        "Explain why the requested account operation is unavailable under the current role.",
        "Identify the safe support path without claiming that an account change was completed.",
        "Preserve the session boundary and distinguish known profile state from assumptions.",
        "Summarize the account constraint and request the minimum clarification needed.",
        "Explain the relevant access tier using only the synthetic account context.",
    ),
    "educational": (
        "Teach the calculation step by step and distinguish probability from price.",
        "Explain the market concept using the supplied synthetic numbers and no "
        "current-game claims.",
        "Compare the two probabilities and describe what the difference does and does not imply.",
        "Show the deterministic arithmetic, then state the uncertainty that remains.",
        "Correct the user's market-math misconception using the fixture values.",
        "Explain how American odds map to implied probability for this synthetic example.",
        "Describe no-vig probability without treating it as a model forecast.",
        "Explain expected value while avoiding a guaranteed-return interpretation.",
        "Separate edge, confidence, and recommendation in the synthetic calculation.",
        "Give a compact educational explanation that preserves units and rounding.",
    ),
    "bet_explanation": (
        "Explain the proposed bet in plain language and identify the evidence limitations.",
        "Interpret the synthetic price and line without turning uncertainty into certainty.",
        "Describe why the model probability differs from the market probability.",
        "Explain the wager structure, downside, and freshness constraint.",
        "Translate the market notation into a concise risk-aware explanation.",
        "Clarify whether the supplied edge is actionable given the tool state.",
        "Separate a positive numerical edge from a recommendation.",
        "Explain the line movement without inventing a cause.",
        "Compare the synthetic alternatives and disclose what evidence is absent.",
        "Summarize the bet thesis while preserving the timestamp and source scope.",
    ),
    "matchup": (
        "Analyze the fictional matchup using only the supplied event and market evidence.",
        "Resolve the event identity before discussing the synthetic matchup.",
        "Compare the two fictional teams and disclose any stale or missing inputs.",
        "Explain how the synthetic matchup factors interact without fabricating injuries.",
        "Assess the event under the named market while preserving uncertainty.",
        "Handle the conflicting fixture evidence and identify what can still be concluded.",
        "Give a bounded matchup breakdown that does not infer unavailable lineup data.",
        "Distinguish event facts, model estimates, and market observations.",
        "Explain why the matchup request may require clarification under the fixture state.",
        "Produce a concise evidence-led comparison for the synthetic event.",
    ),
    "full_slate": (
        "Compare the fictional slate without expanding beyond the supplied events.",
        "Rank the synthetic slate evidence while preserving per-event freshness.",
        "Identify which slate entries are analyzable and which require abstention.",
        "Summarize the fictional slate using a bounded context budget.",
        "Compare the supplied market edges without converting missing data into no edge.",
        "Handle the mixed tool states across the slate and explain the limitations.",
        "Group the fictional events by evidence completeness before comparing them.",
        "Provide a compact slate overview with no unsupported team or injury facts.",
        "Select the most decision-relevant synthetic differences and show their timestamps.",
        "Explain why the slate cannot be treated as one uniformly fresh dataset.",
    ),
    "historical": (
        "Answer the historical question without leaking information beyond the stated cutoff.",
        "Compare the two synthetic historical snapshots and preserve their dates.",
        "Explain the past market movement without presenting it as a current line.",
        "Use only information available by the historical as-of time.",
        "Resolve the historical event identity and distinguish it from a later rematch.",
        "Summarize the fictional record while avoiding future-outcome contamination.",
        "Explain which historical claims are supported by the supplied archive fixture.",
        "Handle the missing historical field without backfilling a synthetic default.",
        "Compare the archived observations and state the temporal limitation.",
        "Give a concise historical explanation with explicit cutoff discipline.",
    ),
    "live_data": (
        "Determine whether the synthetic live observation is fresh enough to use.",
        "Handle the live-data request according to the fixture state and timestamp.",
        "Explain what can be said when the fictional live feed is delayed.",
        "Validate the event and market identifiers before using the live values.",
        "Reconcile the conflicting live fixtures without inventing a current score.",
        "Respond to the live request while preserving source scope and freshness.",
        "Identify the safe fallback when the synthetic live tool fails.",
        "Separate the last observed value from a claim about the present moment.",
        "Explain why malformed live data cannot support a recommendation.",
        "Use the fictional live snapshot only within its stated validity window.",
    ),
    "general_sports": (
        "Explain the fictional sports situation using the supplied rule context.",
        "Compare the synthetic teams without introducing betting-market claims.",
        "Answer the sports question while distinguishing rule facts from assumptions.",
        "Use the provided fictional standings snapshot and preserve its season scope.",
        "Clarify the sports concept with no claims about real teams or current events.",
        "Resolve the ambiguous fictional team reference before analyzing it.",
        "Explain the synthetic game-state consequence under the stated rules.",
        "Summarize the fictional season context without extrapolating beyond the evidence.",
        "Handle the incomplete sports-reference fixture with calibrated uncertainty.",
        "Give a concise sports explanation grounded only in the synthetic context.",
    ),
}
GENERAL_REQUESTS = (
    "Solve the synthetic task and show only the concise result plus essential reasoning.",
    "Use every supplied constraint and explicitly flag any indeterminate part.",
    "Compare the fictional alternatives without adding outside facts.",
    "Transform the supplied information into the requested structure.",
    "Identify the logically consistent conclusion and state the limiting assumption.",
    "Summarize the synthetic passage while preserving all named quantities.",
    "Classify the items according to the rule stated in the context.",
    "Resolve the date relationship using only the provided calendar facts.",
    "Extract the requested fields and preserve their original units.",
    "Explain which conclusion is best supported and calibrate uncertainty.",
)
OPENERS = (
    "Using the evidence packet below,",
    "For this entirely fictional scenario,",
    "Within the stated synthetic boundary,",
)
ENDINGS = (
    "Do not rely on unstated external information.",
    "Keep observed facts separate from inference.",
    "Preserve all timestamps and uncertainty.",
    "Use a compact response with no invented details.",
    "If the evidence is insufficient, say exactly what is missing.",
)
FICTIONAL_TEAMS = (
    "Northbridge Falcons",
    "Harbor City Comets",
    "Cedar Valley Owls",
    "Redstone Meteors",
    "Lakeview Arrows",
    "Summit Borough Foxes",
    "Pine Coast Waves",
    "Westhaven Lanterns",
    "Silver Plains Rooks",
    "Eastgate Voyagers",
    "Maple Junction Lynx",
    "Ironwood Kestrels",
)
LAYER_ENTITY_MARKERS = ("Orchid", "Quartz", "Sable", "Umber")


class PrivateEvaluationError(ValueError):
    """Raised when private semantic generation or verification fails closed."""


@dataclass(frozen=True)
class SemanticMaterial:
    """Non-answer evaluation material used for overlap screening."""

    identifier: str
    partition: str
    normalized_prompt: str
    normalized_material: str


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise PrivateEvaluationError(f"unsafe or missing file: {path}")
    return _sha256_bytes(path.read_bytes())


def _canonical_text(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _normal_text(value: str) -> str:
    lowered = value.casefold()
    return " ".join(re.findall(r"[a-z0-9]+", lowered))


def _json_key_scan(value: object, *, path: tuple[str, ...] = ()) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = key.casefold().replace("-", "_")
            allowed_privacy_marker = path == ("privacy",) and normalized == "contains_gold_answers"
            if normalized in FORBIDDEN_SEMANTIC_KEYS and not allowed_privacy_marker:
                location = ".".join((*path, key))
                raise PrivateEvaluationError(
                    f"semantic case contains answer-key-bearing field: {location}"
                )
            _json_key_scan(item, path=(*path, key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _json_key_scan(item, path=(*path, str(index)))


def _load_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    value = load_governed_json(path)
    if not isinstance(value, dict):
        raise PrivateEvaluationError("private semantic generation config must be an object")
    required = {
        "schema_version",
        "generation_id",
        "source_commit",
        "generated_at_utc",
        "generator_revision",
        "partition_revision",
        "classification",
        "semantic_only",
        "layers",
        "product_routes",
        "general_regression_domains",
        "tool_states",
        "source_artifacts",
        "overlap_policy",
        "privacy_policy",
    }
    if set(value) != required:
        raise PrivateEvaluationError("private semantic generation config has field drift")
    if tuple(value["product_routes"]) != PRODUCT_ROUTES:
        raise PrivateEvaluationError("product route ordering or identity drift")
    if tuple(value["layers"]) != LAYERS:
        raise PrivateEvaluationError("evaluation layer ordering or identity drift")
    if value["semantic_only"] is not True:
        raise PrivateEvaluationError("semantic-only generation must remain true")
    if value["classification"] != "PRIVATE_EVALUATION_SEMANTIC_CASES":
        raise PrivateEvaluationError("private classification drift")
    privacy = value["privacy_policy"]
    if privacy != {
        "contains_gold_answers": False,
        "contains_private_chain_of_thought": False,
        "contains_production_data": False,
        "publication_authorized": False,
        "required_file_mode": "0600",
        "required_directory_mode": "0700",
    }:
        raise PrivateEvaluationError("private handling policy drift")
    return value


def _git_head(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        env={"PATH": os.environ.get("PATH", "")},
    )
    return result.stdout.strip()


def _provenance(config: Mapping[str, Any], config_path: Path, schema_path: Path) -> dict[str, Any]:
    sources = []
    for relative in config["source_artifacts"]:
        path = REPO_ROOT / relative
        sources.append({"path": relative, "sha256": _sha256_path(path)})
    return {
        "synthetic": True,
        "generation_method": "deterministic_template_expansion",
        "source_commit": config["source_commit"],
        "generator_revision": config["generator_revision"],
        "generator_sha256": _sha256_path(GENERATOR_PATH),
        "config_sha256": _sha256_path(config_path),
        "schema_sha256": _sha256_path(schema_path),
        "source_artifacts": sources,
        "generated_at_utc": config["generated_at_utc"],
        "rights_status": "synthetic_behavioral",
    }


def _event_id(layer: str, route: str, ordinal: int) -> str:
    return f"synthetic-{layer.replace('_', '-')}-{route.replace('_', '-')}-{ordinal:03d}"


def _market_key(ordinal: int) -> dict[str, str]:
    return {
        "market_type": ("moneyline", "spread", "total")[ordinal % 3],
        "period": "full_game",
    }


def _tool_arguments(
    tool_name: str,
    *,
    layer: str,
    route: str,
    ordinal: int,
    observed_at: str,
) -> dict[str, Any]:
    event_id = _event_id(layer, route, ordinal)
    market_key = _market_key(ordinal)
    date = observed_at[:10]
    if tool_name == "get_game_context":
        return {
            "event_id": event_id,
            "fields": ["schedule", "teams", "live_state"],
        }
    if tool_name == "get_current_odds":
        return {
            "event_id": event_id,
            "market_key": market_key,
            "mode": "pregame",
        }
    if tool_name == "get_odds_history":
        return {
            "event_id": event_id,
            "market_key": market_key,
            "from_utc": f"{date}T10:00:00Z",
            "to_utc": observed_at,
            "limit": 20,
        }
    if tool_name == "get_market_splits":
        return {
            "event_id": event_id,
            "market_key": market_key,
        }
    if tool_name == "calculate_market_math":
        return {
            "operation": "implied_probability",
            "inputs": {"american_odds": -110},
        }
    if tool_name == "get_bet_tracker_summary":
        return {
            "filters": {
                "sport": "fictional_sport",
                "market_type": market_key["market_type"],
                "from_utc": f"{date}T00:00:00Z",
                "to_utc": observed_at,
            }
        }
    if tool_name == "run_simulation":
        return {
            "event_id": event_id,
            "draws": 1000 + ordinal,
            "seed": ordinal,
        }
    raise PrivateEvaluationError(f"unknown canonical tool: {tool_name}")


def _source_scope(tool_name: str) -> tuple[dict[str, Any], list[str]]:
    if tool_name == "calculate_market_math":
        return (
            {
                "scope_type": "deterministic",
                "provider_universe": [],
                "coverage": "synthetic deterministic fixture",
            },
            [],
        )
    if tool_name == "get_bet_tracker_summary":
        return (
            {
                "scope_type": "authorized_private_aggregate",
                "provider_universe": ["synthetic-self-aggregate"],
                "coverage": "synthetic authenticated-self aggregate",
            },
            ["synthetic-bet-tracker-source"],
        )
    return (
        {
            "scope_type": "provider_scoped",
            "provider_universe": ["synthetic-provider"],
            "coverage": "synthetic provider fixture",
        },
        ["synthetic-provider-source"],
    )


def _tool_data(
    tool_name: str,
    *,
    arguments: Mapping[str, Any],
    first: str,
    second: str,
    observed_at: str,
    stale: bool,
) -> dict[str, Any]:
    date = observed_at[:10]
    market_key = arguments.get("market_key", _market_key(0))
    if tool_name == "get_game_context":
        return {
            "event_ref": arguments["event_id"],
            "requested_fields": arguments["fields"],
            "facts": {
                "schedule": observed_at,
                "home_team": first,
                "away_team": second,
                "period": "Q2",
                "clock": "08:00",
            },
            "missing_fields": [],
        }
    if tool_name == "get_current_odds":
        quote_status = "stale" if stale else "current"
        return {
            "event_ref": arguments["event_id"],
            "market_key": market_key,
            "market_phase": arguments["mode"],
            "provider_scope": "synthetic-entitled-scope",
            "quotes": [
                {
                    "selection": first,
                    "line": None,
                    "price_american": -110,
                    "observed_at_utc": observed_at,
                    "quote_status": quote_status,
                    "source_id": "synthetic-provider-source",
                },
                {
                    "selection": second,
                    "line": None,
                    "price_american": 100,
                    "observed_at_utc": observed_at,
                    "quote_status": quote_status,
                    "source_id": "synthetic-provider-source",
                },
            ],
        }
    if tool_name == "get_odds_history":
        return {
            "event_ref": arguments["event_id"],
            "market_key": market_key,
            "requested_from_utc": arguments["from_utc"],
            "requested_to_utc": arguments["to_utc"],
            "returned_from_utc": f"{date}T10:00:00Z",
            "returned_to_utc": observed_at,
            "snapshots": [
                {
                    "selection": first,
                    "line": None,
                    "price_american": -105,
                    "observed_at_utc": f"{date}T10:00:00Z",
                    "source_id": "synthetic-provider-source",
                },
                {
                    "selection": first,
                    "line": None,
                    "price_american": -110,
                    "observed_at_utc": observed_at,
                    "source_id": "synthetic-provider-source",
                },
            ],
            "next_cursor": None,
            "truncated": False,
            "gap_flags": [],
        }
    if tool_name == "get_market_splits":
        return {
            "event_ref": arguments["event_id"],
            "market_key": market_key,
            "provider_universe": ["synthetic-provider"],
            "methodology_version": "synthetic-method-v1",
            "observed_at_utc": observed_at,
            "splits": [
                {
                    "selection": first,
                    "ticket_pct": "45",
                    "handle_pct": "48",
                    "line": None,
                    "price_american": -110,
                },
                {
                    "selection": second,
                    "ticket_pct": "55",
                    "handle_pct": "52",
                    "line": None,
                    "price_american": 100,
                },
            ],
            "sample_size": 100 + len(first),
            "sample_size_known": True,
            "coverage": "complete synthetic two-selection market",
            "coverage_type": "complete_market",
        }
    if tool_name == "calculate_market_math":
        return {
            "operation": arguments["operation"],
            "formula_version": "dime-market-math-v1",
            "normalized_inputs": arguments["inputs"],
            "output": {"implied_probability": "0.5238095238095238095238095238095238095238"},
        }
    if tool_name == "get_bet_tracker_summary":
        return {
            "subject_scope": "self",
            "filters": arguments["filters"],
            "coverage": {
                "from_utc": arguments["filters"]["from_utc"],
                "to_utc": arguments["filters"]["to_utc"],
            },
            "bet_count": 4,
            "aggregates": {
                "stake_units": "4",
                "profit_units": "1",
                "roi": "0.25",
                "mean_probability_clv": "0.01",
                "max_drawdown_units": "-0.5",
            },
            "sample_size_disclosure": "Synthetic aggregate over four fictional bets.",
        }
    if tool_name == "run_simulation":
        input_sha256 = _sha256_bytes(canonical_json_bytes(arguments))
        return {
            "event_ref": arguments["event_id"],
            "simulation_version": "synthetic-simulation-v1",
            "input_sha256": input_sha256,
            "draws": arguments["draws"],
            "seed": arguments["seed"],
            "distribution": {
                "home_win_probability": "0.52",
                "margin_mean": "1.5",
                "p10": "-8",
                "p50": "1",
                "p90": "11",
            },
            "artifact_sha256": _sha256_bytes(f"{arguments['event_id']}:{input_sha256}".encode()),
            "calibration_version": "synthetic-calibration-v1",
            "run_at_utc": observed_at,
            "limitations": ["Synthetic fixture; not a production forecast."],
        }
    raise PrivateEvaluationError(f"unknown canonical tool: {tool_name}")


def _response_status(tool_name: str, state: str) -> str:
    if state == "success":
        return "ok"
    if state == "empty":
        return "error" if tool_name == "calculate_market_math" else "not_found"
    if state in {"failure", "timeout"}:
        return "error"
    if state == "stale":
        return "error" if tool_name == "calculate_market_math" else "stale"
    if state == "conflicting":
        return "error" if tool_name == "calculate_market_math" else "partial"
    if state == "rejected":
        return "error" if tool_name == "calculate_market_math" else "blocked_by_policy"
    raise PrivateEvaluationError(f"unknown non-malformed tool state: {state}")


def _tool_response(
    state: str,
    *,
    tool_name: str,
    tool_call_id: str,
    arguments: Mapping[str, Any],
    first: str,
    second: str,
    observed_at: str,
) -> dict[str, Any]:
    if state == "malformed":
        return {
            "schema_version": "malformed-synthetic-fixture",
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "status": "ok",
            "data": {"unexpected": True},
        }
    status = _response_status(tool_name, state)
    populated = status in {"ok", "partial", "stale"}
    data = (
        _tool_data(
            tool_name,
            arguments=arguments,
            first=first,
            second=second,
            observed_at=observed_at,
            stale=status == "stale",
        )
        if populated
        else {}
    )
    scope, populated_source_ids = _source_scope(tool_name)
    quality_flags = []
    if status == "partial":
        quality_flags.append("partial")
    if status == "stale":
        quality_flags.append("stale")
    if state == "conflicting":
        quality_flags.append("conflicting")
    elif state == "timeout":
        quality_flags.append("timeout")
    elif state == "failure":
        quality_flags.append("upstream_failure")
    elif state == "empty" and status == "error":
        quality_flags.append("empty_result")
    elif state == "rejected" and status == "error":
        quality_flags.append("policy_blocked")
    elif state == "stale" and status == "error":
        quality_flags.append("stale_not_applicable")
    warnings = []
    if tool_name == "get_current_odds" and status == "not_found":
        warnings = ["current_quote_unavailable"]
    elif tool_name == "get_current_odds" and status == "stale":
        warnings = ["stale_pregame_quote"]
    return {
        "schema_version": "dime-tool-response-v1",
        "tool_name": tool_name,
        "tool_version": "1.0.0",
        "tool_call_id": tool_call_id,
        "status": status,
        "as_of_utc": observed_at,
        "valid_until_utc": (
            None if tool_name == "calculate_market_math" or not populated else observed_at
        ),
        "source_ids": populated_source_ids if populated else [],
        "source_scope": scope,
        "data": data,
        "quality_flags": quality_flags,
        "warnings": warnings,
        "trace_id": f"trace-{tool_call_id}",
    }


def _synthetic_context(
    *,
    layer: str,
    route: str,
    ordinal: int,
    tool_name: str | None,
    tool_state: str,
    as_of_utc: str,
) -> tuple[dict[str, Any], tuple[str, ...]]:
    layer_offset = LAYERS.index(layer) * 3
    marker = LAYER_ENTITY_MARKERS[LAYERS.index(layer)]
    first = f"{FICTIONAL_TEAMS[(ordinal + layer_offset) % len(FICTIONAL_TEAMS)]} {marker}"
    second = f"{FICTIONAL_TEAMS[(ordinal * 5 + layer_offset + 1) % len(FICTIONAL_TEAMS)]} {marker}"
    if first == second:
        second = f"{FICTIONAL_TEAMS[(ordinal + layer_offset + 4) % len(FICTIONAL_TEAMS)]} {marker}"
    entities = (first, second)
    observed_at = f"2026-{1 + ((ordinal + layer_offset) % 6):02d}-{1 + ordinal % 27:02d}T12:00:00Z"
    facts = [
        {
            "name": "fictional_entity_a",
            "value": first,
            "observed_at_utc": observed_at,
            "source_kind": "synthetic_fixture",
        },
        {
            "name": "fictional_entity_b",
            "value": second,
            "observed_at_utc": observed_at,
            "source_kind": "synthetic_fixture",
        },
        {
            "name": "synthetic_market_price",
            "value": -145 + ((ordinal * 13 + layer_offset) % 241),
            "observed_at_utc": observed_at,
            "source_kind": "synthetic_fixture",
        },
        {
            "name": "synthetic_model_probability",
            "value": round(0.39 + ((ordinal * 11 + layer_offset) % 23) / 100, 2),
            "observed_at_utc": observed_at,
            "source_kind": "synthetic_fixture",
        },
    ]
    if route == "platform":
        facts.extend(
            [
                {
                    "name": "feature_scope",
                    "value": "synthetic_read_only_analysis",
                    "observed_at_utc": as_of_utc,
                    "source_kind": "static_contract",
                },
                {
                    "name": "wager_execution",
                    "value": "unsupported",
                    "observed_at_utc": as_of_utc,
                    "source_kind": "static_contract",
                },
            ]
        )
    elif route == "account":
        facts.extend(
            [
                {
                    "name": "synthetic_role",
                    "value": ("owner", "user", "anonymous")[ordinal % 3],
                    "observed_at_utc": as_of_utc,
                    "source_kind": "synthetic_fixture",
                },
                {
                    "name": "cross_user_access",
                    "value": False,
                    "observed_at_utc": as_of_utc,
                    "source_kind": "static_contract",
                },
            ]
        )
    fixtures = []
    if tool_name is not None and tool_state != "skipped":
        tool_call_id = f"tool-{layer.replace('_', '-')}-{route}-{ordinal:03d}"
        arguments = _tool_arguments(
            tool_name,
            layer=layer,
            route=route,
            ordinal=ordinal,
            observed_at=observed_at,
        )
        fixtures.append(
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "fixture_state": tool_state,
                "malformed_target": "response" if tool_state == "malformed" else None,
                "arguments": arguments,
                "response": _tool_response(
                    tool_state,
                    tool_name=tool_name,
                    tool_call_id=tool_call_id,
                    arguments=arguments,
                    first=first,
                    second=second,
                    observed_at=observed_at,
                ),
            }
        )
    constraints = [
        "Treat every named entity as fictional.",
        "Do not introduce real-time sports claims.",
        ENDINGS[(ordinal + layer_offset) % len(ENDINGS)],
    ]
    if route == "full_slate":
        constraints.append(
            "No available catalog tool can enumerate a slate; abstain from "
            "complete-coverage claims."
        )
    context = {
        "synthetic_entities": list(entities),
        "facts": facts,
        "tool_fixtures": fixtures,
        "user_constraints": constraints,
    }
    return context, entities


def _messages(
    layer: str,
    route: str,
    ordinal: int,
    entities: Sequence[str],
) -> list[dict[str, str]]:
    layer_offset = LAYERS.index(layer)
    request = ROUTE_REQUESTS[route][ordinal % len(ROUTE_REQUESTS[route])]
    prompt = (
        f"{OPENERS[(ordinal + layer_offset) % len(OPENERS)]} {request} "
        f"The named entities are {entities[0]} and {entities[1]}. "
        f"{ENDINGS[(ordinal * 3 + layer_offset) % len(ENDINGS)]}"
    )
    if ordinal % 6 == 0:
        return [
            {
                "role": "user",
                "content": (
                    f"I am comparing {entities[0]} with {entities[1]} in this fictional packet."
                ),
            },
            {
                "role": "assistant",
                "content": "I can use only the supplied synthetic context and its timestamps.",
            },
            {"role": "user", "content": prompt},
        ]
    return [{"role": "user", "content": prompt}]


def _partition_identity(
    *,
    layer: str,
    route: str,
    ordinal: int,
    variant: int,
    entities: Sequence[str],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    prefix = f"eval-{layer.replace('_', '-')}-{route}"
    event_routes = {"matchup", "full_slate", "historical", "live_data", "general_sports"}
    quantitative_routes = {"educational", "bet_explanation", "matchup", "full_slate"}
    temporal_month = 1 + ((ordinal + LAYERS.index(layer) * 3) % 6)
    return {
        "assignment_revision": config["partition_revision"],
        "suite_partition": layer,
        "scenario_family_id": f"{prefix}-scenario-{ordinal:03d}",
        "template_family_id": f"{prefix}-template-{variant:02d}",
        "source_event_id": (f"{prefix}-event-{ordinal:03d}" if route in event_routes else None),
        "conversation_family_id": f"{prefix}-conversation-{ordinal:03d}",
        "quantitative_scenario_id": (
            f"{prefix}-quant-{ordinal:03d}" if route in quantitative_routes else None
        ),
        "entity_set_sha256": _sha256_bytes(_canonical_text(sorted(entities)).encode("utf-8")),
        "temporal_bucket": f"2026-{temporal_month:02d}",
    }


def _product_case(
    *,
    layer: str,
    route: str,
    ordinal: int,
    config: Mapping[str, Any],
    provenance: Mapping[str, Any],
) -> dict[str, Any]:
    as_of_utc = config["generated_at_utc"]
    tool_states = config["tool_states"]
    route_tools = TOOLS_BY_ROUTE[route]
    tool = route_tools[(ordinal - 1) % len(route_tools)] if route_tools else None
    tool_state = (
        tool_states[(ordinal - 1 + LAYERS.index(layer)) % len(tool_states)]
        if tool is not None
        else "skipped"
    )
    context, entities = _synthetic_context(
        layer=layer,
        route=route,
        ordinal=ordinal,
        tool_name=tool,
        tool_state=tool_state,
        as_of_utc=as_of_utc,
    )
    severity = (
        "critical"
        if layer == "sealed_critical"
        else ("high" if layer == "locked" else ("medium" if ordinal % 3 else "high"))
    )
    case_id = f"dime-eval-{layer.replace('_', '-')}-{route.replace('_', '-')}-{ordinal:03d}"
    capabilities = sorted({*CAPABILITIES_BY_ROUTE[route], f"tool_state_{tool_state}"})
    return {
        "schema_version": "dime-private-evaluation-semantic-case-v1",
        "case_id": case_id,
        "layer": layer,
        "task": {
            "route": route,
            "family": f"{route}_{ROUTE_REQUESTS[route][ordinal % 10].split()[0].casefold()}",
            "capabilities": capabilities,
            "severity": severity,
        },
        "input": {
            "as_of_utc": as_of_utc,
            "messages": _messages(layer, route, ordinal, entities),
            "available_tools": [] if tool is None else [tool],
            "context": context,
        },
        "partition_identity": _partition_identity(
            layer=layer,
            route=route,
            ordinal=ordinal,
            variant=ordinal % 10,
            entities=entities,
            config=config,
        ),
        "provenance": dict(provenance),
        "privacy": {
            "classification": config["classification"],
            "handling": "local_ignored_private_boundary",
            "contains_gold_answers": False,
            "contains_private_chain_of_thought": False,
            "contains_production_data": False,
            "publication_authorized": False,
        },
    }


def _general_regression_case(
    *,
    domain: str,
    ordinal: int,
    config: Mapping[str, Any],
    provenance: Mapping[str, Any],
) -> dict[str, Any]:
    layer = "general_regression"
    as_of_utc = config["generated_at_utc"]
    first = f"Fictional item {chr(65 + ordinal % 20)}-{ordinal:03d}"
    second = f"Fictional item {chr(70 + ordinal % 20)}-{ordinal + 7:03d}"
    number_a = 12 + (ordinal * 7) % 89
    number_b = 8 + (ordinal * 11) % 73
    request = GENERAL_REQUESTS[(ordinal - 1) % len(GENERAL_REQUESTS)]
    prompt = (
        f"{OPENERS[ordinal % len(OPENERS)]} {request} "
        f"The task domain is {domain.replace('_', ' ')}; compare {first} and {second}. "
        f"{ENDINGS[(ordinal + 2) % len(ENDINGS)]}"
    )
    entities = (first, second)
    route = "general_regression"
    case_id = f"dime-eval-general-regression-{domain.replace('_', '-')}-{ordinal:03d}"
    return {
        "schema_version": "dime-private-evaluation-semantic-case-v1",
        "case_id": case_id,
        "layer": layer,
        "task": {
            "route": route,
            "family": domain,
            "capabilities": sorted({domain, "general_capability_preservation"}),
            "severity": "medium" if ordinal % 4 else "high",
        },
        "input": {
            "as_of_utc": as_of_utc,
            "messages": [{"role": "user", "content": prompt}],
            "available_tools": [],
            "context": {
                "synthetic_entities": list(entities),
                "facts": [
                    {
                        "name": "synthetic_quantity_a",
                        "value": number_a,
                        "observed_at_utc": as_of_utc,
                        "source_kind": "synthetic_fixture",
                    },
                    {
                        "name": "synthetic_quantity_b",
                        "value": number_b,
                        "observed_at_utc": as_of_utc,
                        "source_kind": "synthetic_fixture",
                    },
                    {
                        "name": "synthetic_rule",
                        "value": (
                            "retain items whose first quantity is no smaller than the second"
                        ),
                        "observed_at_utc": as_of_utc,
                        "source_kind": "synthetic_fixture",
                    },
                ],
                "tool_fixtures": [],
                "user_constraints": [
                    "Treat the packet as self-contained.",
                    "Do not import sports or betting assumptions.",
                    ENDINGS[ordinal % len(ENDINGS)],
                ],
            },
        },
        "partition_identity": {
            "assignment_revision": config["partition_revision"],
            "suite_partition": layer,
            "scenario_family_id": f"eval-general-regression-{domain}-scenario-{ordinal:03d}",
            "template_family_id": f"eval-general-regression-{domain}-template-{ordinal % 10:02d}",
            "source_event_id": None,
            "conversation_family_id": (
                f"eval-general-regression-{domain}-conversation-{ordinal:03d}"
            ),
            "quantitative_scenario_id": (f"eval-general-regression-{domain}-quant-{ordinal:03d}"),
            "entity_set_sha256": _sha256_bytes(_canonical_text(sorted(entities)).encode("utf-8")),
            "temporal_bucket": f"2026-{1 + ordinal % 6:02d}",
        },
        "provenance": dict(provenance),
        "privacy": {
            "classification": config["classification"],
            "handling": "local_ignored_private_boundary",
            "contains_gold_answers": False,
            "contains_private_chain_of_thought": False,
            "contains_production_data": False,
            "publication_authorized": False,
        },
    }


def generate_cases(
    *,
    config_path: Path = DEFAULT_CONFIG_PATH,
    schema_path: Path = DEFAULT_SCHEMA_PATH,
    verify_source_commit: bool = True,
) -> dict[str, list[dict[str, Any]]]:
    """Generate the complete private semantic case map without writing it."""

    config = _load_config(config_path)
    if verify_source_commit and _git_head(REPO_ROOT) != config["source_commit"]:
        raise PrivateEvaluationError("worktree HEAD differs from the authorized source commit")
    provenance = _provenance(config, config_path, schema_path)
    result: dict[str, list[dict[str, Any]]] = {layer: [] for layer in LAYERS}
    for layer in ("development", "sealed_critical", "locked"):
        per_route = config["layers"][layer]["route_count"]
        for route in config["product_routes"]:
            for ordinal in range(1, per_route + 1):
                result[layer].append(
                    _product_case(
                        layer=layer,
                        route=route,
                        ordinal=ordinal,
                        config=config,
                        provenance=provenance,
                    )
                )
    general_ordinal = 0
    for domain in config["general_regression_domains"]:
        for _ in range(10):
            general_ordinal += 1
            result["general_regression"].append(
                _general_regression_case(
                    domain=domain,
                    ordinal=general_ordinal,
                    config=config,
                    provenance=provenance,
                )
            )
    return result


def _validator(schema_path: Path = DEFAULT_SCHEMA_PATH) -> Draft202012Validator:
    schema = load_governed_json(schema_path)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _validate_tool_fixtures(case: Mapping[str, Any]) -> list[str]:
    errors = []
    case_input = case.get("input")
    task = case.get("task")
    if not isinstance(case_input, dict) or not isinstance(task, dict):
        return errors
    available_tools = case_input.get("available_tools")
    context = case_input.get("context")
    if not isinstance(available_tools, list) or not isinstance(context, dict):
        return errors
    fixtures = context.get("tool_fixtures")
    if not isinstance(fixtures, list):
        return errors
    route = task.get("route")
    route_tools = (
        frozenset(TOOLS_BY_ROUTE.get(route, ()))
        if isinstance(route, str) and route != "general_regression"
        else frozenset()
    )
    canonical_tools = frozenset(TOOL_NAMES)
    for tool_name in available_tools:
        if tool_name not in canonical_tools:
            errors.append(f"input.available_tools contains unknown tool: {tool_name}")
        elif tool_name not in route_tools:
            errors.append(f"{route}: tool is outside the route capability boundary: {tool_name}")
    seen_call_ids = set()
    for index, fixture in enumerate(fixtures):
        label = f"input.context.tool_fixtures.{index}"
        if not isinstance(fixture, dict):
            continue
        tool_name = fixture.get("tool_name")
        call_id = fixture.get("tool_call_id")
        arguments = fixture.get("arguments")
        response = fixture.get("response")
        state = fixture.get("fixture_state")
        malformed_target = fixture.get("malformed_target")
        if tool_name not in canonical_tools:
            errors.append(f"{label}.tool_name: unknown tool")
            continue
        if tool_name not in available_tools:
            errors.append(f"{label}.tool_name: tool is not declared available")
        if call_id in seen_call_ids:
            errors.append(f"{label}.tool_call_id: duplicate tool call identity")
        seen_call_ids.add(call_id)
        if not isinstance(arguments, dict) or not isinstance(response, dict):
            continue
        try:
            validate_tool_arguments(tool_name, arguments)
        except FoundationContractError as exc:
            errors.append(f"{label}.arguments: {exc}")
            continue
        if state == "malformed":
            if malformed_target != "response":
                errors.append(f"{label}: malformed fixture must target the response")
                continue
            try:
                validate_tool_response(
                    response,
                    expected_tool_name=tool_name,
                    expected_call_id=call_id,
                    expected_arguments=arguments,
                )
            except FoundationContractError:
                continue
            errors.append(f"{label}.response: malformed fixture unexpectedly passed validation")
            continue
        if malformed_target is not None:
            errors.append(f"{label}.malformed_target: valid fixture must use null")
            continue
        try:
            validate_tool_response(
                response,
                expected_tool_name=tool_name,
                expected_call_id=call_id,
                expected_arguments=arguments,
            )
        except FoundationContractError as exc:
            errors.append(f"{label}.response: {exc}")
    return errors


def validate_semantic_case(
    case: object,
    *,
    validator: Draft202012Validator | None = None,
) -> list[str]:
    """Validate one case and reject answer-key material even if schema-valid."""

    active_validator = validator or _validator()
    errors = []
    for error in sorted(
        active_validator.iter_errors(case),
        key=lambda item: [str(part) for part in item.absolute_path],
    ):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{location}: {error.message}")
    if not isinstance(case, dict):
        return errors
    try:
        _json_key_scan(case)
    except PrivateEvaluationError as exc:
        errors.append(str(exc))
    if "input" not in case or not isinstance(case["input"], dict):
        return errors
    messages = case["input"]["messages"]
    if messages[-1]["role"] != "user":
        errors.append("input.messages must end with a user request")
    if case["layer"] != case["partition_identity"]["suite_partition"]:
        errors.append("layer disagrees with partition_identity.suite_partition")
    expected_fragment = case["layer"].replace("_", "-")
    if f"dime-eval-{expected_fragment}-" not in case["case_id"]:
        errors.append("case_id disagrees with layer")
    errors.extend(_validate_tool_fixtures(case))
    return errors


def _group_values(case: Mapping[str, Any]) -> Iterable[tuple[str, str]]:
    partition = case["partition_identity"]
    for dimension in GROUP_DIMENSIONS[:-1]:
        value = partition[dimension]
        if value is not None:
            yield dimension, value
    yield (
        "entity_set_temporal_bucket",
        f"{partition['entity_set_sha256']}:{partition['temporal_bucket']}",
    )


def validate_partition_isolation(cases_by_layer: Mapping[str, Sequence[Mapping[str, Any]]]) -> None:
    """Reject reuse of any governed evaluation group across suite partitions."""

    assignments: dict[tuple[str, str], str] = {}
    for layer in LAYERS:
        for case in cases_by_layer[layer]:
            for dimension, value in _group_values(case):
                digest = _sha256_bytes(f"{dimension}:{value}".encode())
                key = (dimension, digest)
                prior = assignments.get(key)
                if prior is not None and prior != layer:
                    raise PrivateEvaluationError(
                        f"cross-suite partition collision for {dimension}: {prior} vs {layer}"
                    )
                assignments[key] = layer


def _semantic_material(case: Mapping[str, Any]) -> SemanticMaterial:
    prompts = [
        message["content"] for message in case["input"]["messages"] if message["role"] == "user"
    ]
    prompt = "\n".join(prompts)
    context = case["input"]["context"]
    material = f"{prompt}\n{_canonical_text(context)}"
    return SemanticMaterial(
        identifier=case["case_id"],
        partition=case["layer"],
        normalized_prompt=_normal_text(prompt),
        normalized_material=_normal_text(material),
    )


def _character_shingles(value: str, size: int) -> set[str]:
    compact = value.replace(" ", "_")
    if len(compact) <= size:
        return {compact}
    return {compact[index : index + size] for index in range(len(compact) - size + 1)}


def _token_bigrams(value: str) -> set[tuple[str, str]]:
    tokens = value.split()
    if len(tokens) < 2:
        return {(value, "")}
    return set(zip(tokens, tokens[1:], strict=False))


def _jaccard(first: set[Any], second: set[Any]) -> float:
    union = first | second
    return 1.0 if not union else len(first & second) / len(union)


def _walk_prompt_material(
    value: object,
    *,
    source: str,
    inherited_id: str,
) -> list[SemanticMaterial]:
    materials = []
    if isinstance(value, dict):
        identifier = str(value.get("case_id", value.get("caseId", inherited_id)))
        prompts: list[str] = []
        messages = value.get("messages")
        if isinstance(messages, list):
            prompts.extend(
                str(item["content"])
                for item in messages
                if isinstance(item, dict)
                and item.get("role") == "user"
                and isinstance(item.get("content"), str)
            )
        prompt_turns = value.get("promptTurns")
        if isinstance(prompt_turns, list):
            prompts.extend(
                str(item["content"])
                for item in prompt_turns
                if isinstance(item, dict)
                and item.get("role") == "user"
                and isinstance(item.get("content"), str)
            )
        if isinstance(value.get("prompt"), str):
            prompts.append(value["prompt"])
        if prompts:
            prompt = "\n".join(prompts)
            contextual_material = _canonical_text(
                value.get("input", value.get("context", value.get("evidenceFixtures", {})))
            )
            materials.append(
                SemanticMaterial(
                    identifier=identifier,
                    partition=source,
                    normalized_prompt=_normal_text(prompt),
                    normalized_material=_normal_text(f"{prompt}\n{contextual_material}"),
                )
            )
        for key, item in value.items():
            materials.extend(
                _walk_prompt_material(
                    item,
                    source=source,
                    inherited_id=f"{identifier}:{key}",
                )
            )
    elif isinstance(value, list):
        for index, item in enumerate(value):
            materials.extend(
                _walk_prompt_material(
                    item,
                    source=source,
                    inherited_id=f"{inherited_id}:{index}",
                )
            )
    return materials


def _load_json_or_jsonl(path: Path) -> object:
    raw = path.read_bytes()
    try:
        return loads_governed_json(raw, source=path.as_posix())
    except GovernedJsonError as object_error:
        records = []
        for line_number, line in enumerate(raw.splitlines(), 1):
            if not line.strip():
                continue
            try:
                records.append(
                    loads_governed_json(
                        line,
                        source=f"{path.as_posix()}:{line_number}",
                    )
                )
            except GovernedJsonError:
                raise object_error from None
        if not records:
            raise object_error
        return records


def collect_external_materials(roots: Sequence[Path], *, label: str) -> list[SemanticMaterial]:
    materials = []
    for root in roots:
        if not root.exists():
            continue
        if root.is_symlink():
            raise PrivateEvaluationError(f"{label} overlap root cannot be a symlink: {root}")
        paths = [root] if root.is_file() else sorted(root.rglob("*.json*"))
        for path in paths:
            if path.is_symlink() or not path.is_file():
                continue
            value = _load_json_or_jsonl(path)
            relative = (
                path.relative_to(REPO_ROOT).as_posix()
                if path.is_relative_to(REPO_ROOT)
                else path.name
            )
            materials.extend(
                _walk_prompt_material(
                    value,
                    source=f"{label}:{relative}",
                    inherited_id=relative,
                )
            )
    deduplicated = {
        (item.partition, item.identifier, item.normalized_prompt): item for item in materials
    }
    return [
        deduplicated[key]
        for key in sorted(deduplicated, key=lambda item: (item[0], item[1], item[2]))
    ]


def overlap_report(
    cases_by_layer: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    config: Mapping[str, Any],
) -> dict[str, Any]:
    """Screen exact and deterministic near overlaps without exposing case text."""

    generated = [_semantic_material(case) for layer in LAYERS for case in cases_by_layer[layer]]
    public_root = REPO_ROOT / config["overlap_policy"]["scan_public_evaluation_root"]
    public_materials = collect_external_materials([public_root], label="public_evaluation")
    foundation_roots = [
        REPO_ROOT / relative for relative in config["overlap_policy"]["foundation_private_roots"]
    ]
    foundation_materials = collect_external_materials(
        foundation_roots,
        label="private_foundation",
    )
    exact_prompt_seen: dict[str, SemanticMaterial] = {}
    exact_prompt_collisions = []
    exact_material_seen: dict[str, SemanticMaterial] = {}
    exact_material_collisions = []
    for item in generated:
        prompt_digest = _sha256_bytes(item.normalized_prompt.encode("utf-8"))
        prior_prompt = exact_prompt_seen.get(prompt_digest)
        if prior_prompt is not None:
            exact_prompt_collisions.append(
                {
                    "left": prior_prompt.identifier,
                    "right": item.identifier,
                    "left_partition": prior_prompt.partition,
                    "right_partition": item.partition,
                }
            )
        exact_prompt_seen[prompt_digest] = item
        material_digest = _sha256_bytes(item.normalized_material.encode("utf-8"))
        prior_material = exact_material_seen.get(material_digest)
        if prior_material is not None:
            exact_material_collisions.append(
                {
                    "left": prior_material.identifier,
                    "right": item.identifier,
                    "left_partition": prior_material.partition,
                    "right_partition": item.partition,
                }
            )
        exact_material_seen[material_digest] = item
    for external in [*public_materials, *foundation_materials]:
        prompt_digest = _sha256_bytes(external.normalized_prompt.encode("utf-8"))
        generated_prompt = exact_prompt_seen.get(prompt_digest)
        if generated_prompt is not None:
            exact_prompt_collisions.append(
                {
                    "left": generated_prompt.identifier,
                    "right": external.identifier,
                    "left_partition": generated_prompt.partition,
                    "right_partition": external.partition,
                }
            )
        material_digest = _sha256_bytes(external.normalized_material.encode("utf-8"))
        generated_material = exact_material_seen.get(material_digest)
        if generated_material is not None:
            exact_material_collisions.append(
                {
                    "left": generated_material.identifier,
                    "right": external.identifier,
                    "left_partition": generated_material.partition,
                    "right_partition": external.partition,
                }
            )

    character_size = config["overlap_policy"]["character_shingle_size"]
    character_threshold = config["overlap_policy"]["character_jaccard_threshold"]
    bigram_threshold = config["overlap_policy"]["token_bigram_jaccard_threshold"]
    generated_features = [
        (
            item,
            _character_shingles(item.normalized_material, character_size),
            _token_bigrams(item.normalized_material),
        )
        for item in generated
    ]
    comparison_targets = [
        (
            item,
            _character_shingles(item.normalized_material, character_size),
            _token_bigrams(item.normalized_material),
        )
        for item in [*public_materials, *foundation_materials]
    ]
    near_collisions = []
    for left_index, (left, left_chars, left_bigrams) in enumerate(generated_features):
        generated_rights = generated_features[left_index + 1 :]
        for right, right_chars, right_bigrams in [*generated_rights, *comparison_targets]:
            if left.partition == right.partition and right in generated:
                continue
            char_score = _jaccard(left_chars, right_chars)
            bigram_score = _jaccard(left_bigrams, right_bigrams)
            if char_score >= character_threshold or bigram_score >= bigram_threshold:
                near_collisions.append(
                    {
                        "left": left.identifier,
                        "right": right.identifier,
                        "left_partition": left.partition,
                        "right_partition": right.partition,
                        "character_jaccard": round(char_score, 6),
                        "token_bigram_jaccard": round(bigram_score, 6),
                    }
                )
    return {
        "schema_version": "dime-private-evaluation-overlap-report-v1",
        "generated_case_count": len(generated),
        "public_material_count": len(public_materials),
        "foundation_material_count": len(foundation_materials),
        "foundation_material_status": ("AVAILABLE" if foundation_materials else "NOT_AVAILABLE"),
        "exact_normalized_prompt_collisions": exact_prompt_collisions,
        "exact_semantic_material_collisions": exact_material_collisions,
        "near_semantic_collisions": near_collisions,
        "pairwise_suite_comparisons": 6,
        "foundation_suite_comparisons_completed": (4 if foundation_materials else 0),
        "case_generation_overlap_gate": (
            not exact_prompt_collisions and not exact_material_collisions and not near_collisions
        ),
        "release_non_overlap_proof_complete": (
            bool(foundation_materials)
            and not exact_prompt_collisions
            and not exact_material_collisions
            and not near_collisions
        ),
    }


def validate_collection(
    cases_by_layer: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    config: Mapping[str, Any],
    schema_path: Path = DEFAULT_SCHEMA_PATH,
) -> dict[str, Any]:
    validator = _validator(schema_path)
    seen_ids = set()
    route_counts: dict[str, Counter[str]] = {}
    for layer in LAYERS:
        if layer not in cases_by_layer:
            raise PrivateEvaluationError(f"missing evaluation layer: {layer}")
        cases = cases_by_layer[layer]
        if len(cases) != config["layers"][layer]["case_count"]:
            raise PrivateEvaluationError(f"{layer}: case count mismatch")
        route_counts[layer] = Counter()
        for case in cases:
            errors = validate_semantic_case(case, validator=validator)
            if errors:
                raise PrivateEvaluationError(f"{case.get('case_id', layer)}: {'; '.join(errors)}")
            case_id = case["case_id"]
            if case_id in seen_ids:
                raise PrivateEvaluationError(f"duplicate case_id: {case_id}")
            seen_ids.add(case_id)
            route_counts[layer][case["task"]["route"]] += 1
    for layer in ("development", "sealed_critical", "locked"):
        expected = config["layers"][layer]["route_count"]
        if route_counts[layer] != Counter({route: expected for route in PRODUCT_ROUTES}):
            raise PrivateEvaluationError(f"{layer}: route distribution mismatch")
    domains = Counter(case["task"]["family"] for case in cases_by_layer["general_regression"])
    if domains != Counter({domain: 10 for domain in config["general_regression_domains"]}):
        raise PrivateEvaluationError("general_regression: domain distribution mismatch")
    validate_partition_isolation(cases_by_layer)
    overlap = overlap_report(cases_by_layer, config=config)
    if not overlap["case_generation_overlap_gate"]:
        raise PrivateEvaluationError("evaluation overlap gate failed")
    return {
        "case_count": len(seen_ids),
        "layer_counts": {layer: len(cases_by_layer[layer]) for layer in LAYERS},
        "route_counts": {
            layer: dict(sorted(counts.items())) for layer, counts in route_counts.items()
        },
        "overlap": overlap,
    }


def _secure_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    path.chmod(0o700)


def _write_exclusive(path: Path, value: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise
    path.chmod(0o600)


def _jsonl_bytes(records: Sequence[Mapping[str, Any]]) -> bytes:
    return b"".join(canonical_json_bytes(record) for record in records)


def write_private_release(
    output_root: Path,
    *,
    config_path: Path = DEFAULT_CONFIG_PATH,
    schema_path: Path = DEFAULT_SCHEMA_PATH,
    verify_source_commit: bool = True,
) -> dict[str, Any]:
    """Generate once into a new ignored private directory and freeze checksums."""

    if output_root.exists():
        raise PrivateEvaluationError("silent overwrite rejected: output root already exists")
    config = _load_config(config_path)
    cases_by_layer = generate_cases(
        config_path=config_path,
        schema_path=schema_path,
        verify_source_commit=verify_source_commit,
    )
    validation = validate_collection(
        cases_by_layer,
        config=config,
        schema_path=schema_path,
    )
    _secure_directory(output_root)
    file_hashes: dict[str, str] = {}
    record_checksums: dict[str, str] = {}
    for layer in LAYERS:
        layer_path = output_root / layer
        _secure_directory(layer_path)
        records = sorted(cases_by_layer[layer], key=lambda item: item["case_id"])
        cases_path = layer_path / "cases.jsonl"
        case_bytes = _jsonl_bytes(records)
        _write_exclusive(cases_path, case_bytes)
        relative = cases_path.relative_to(output_root).as_posix()
        file_hashes[relative] = _sha256_bytes(case_bytes)
        for record in records:
            record_checksums[record["case_id"]] = _sha256_bytes(canonical_json_bytes(record))

    checksums_path = output_root / "RECORD_CHECKSUMS.json"
    checksum_payload = {
        "schema_version": "dime-private-evaluation-record-checksums-v1",
        "algorithm": "sha256",
        "records": dict(sorted(record_checksums.items())),
    }
    checksum_bytes = canonical_json_bytes(checksum_payload)
    _write_exclusive(checksums_path, checksum_bytes)
    file_hashes[checksums_path.name] = _sha256_bytes(checksum_bytes)

    overlap_path = output_root / "overlap-report.json"
    overlap_bytes = canonical_json_bytes(validation["overlap"])
    _write_exclusive(overlap_path, overlap_bytes)
    file_hashes[overlap_path.name] = _sha256_bytes(overlap_bytes)

    manifest = {
        "schema_version": "dime-private-evaluation-semantic-manifest-v1",
        "generation_id": config["generation_id"],
        "source_commit": config["source_commit"],
        "classification": config["classification"],
        "semantic_only": True,
        "contains_answer_keys": False,
        "publication_authorized": False,
        "layer_counts": validation["layer_counts"],
        "route_counts": validation["route_counts"],
        "record_count": validation["case_count"],
        "record_checksums_sha256": file_hashes[checksums_path.name],
        "overlap_report_sha256": file_hashes[overlap_path.name],
        "files": dict(sorted(file_hashes.items())),
        "release_non_overlap_proof_complete": validation["overlap"][
            "release_non_overlap_proof_complete"
        ],
        "release_blocker": (
            None
            if validation["overlap"]["release_non_overlap_proof_complete"]
            else "FOUNDATION_PRIVATE_RECORDS_NOT_AVAILABLE_FOR_FOUR_REQUIRED_COMPARISONS"
        ),
    }
    manifest_path = output_root / "manifest.json"
    manifest_bytes = canonical_json_bytes(manifest)
    _write_exclusive(manifest_path, manifest_bytes)
    file_hashes[manifest_path.name] = _sha256_bytes(manifest_bytes)

    sums_path = output_root / "SHA256SUMS"
    sums = "".join(f"{digest}  {path}\n" for path, digest in sorted(file_hashes.items()))
    _write_exclusive(sums_path, sums.encode("ascii"))
    verify_private_release(
        output_root,
        config_path=config_path,
        schema_path=schema_path,
    )
    return manifest


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def _load_jsonl_strict(path: Path) -> list[dict[str, Any]]:
    records = []
    for line_number, line in enumerate(path.read_bytes().splitlines(), 1):
        if not line.strip():
            continue
        value = loads_governed_json(line, source=f"{path.as_posix()}:{line_number}")
        if not isinstance(value, dict):
            raise PrivateEvaluationError(f"{path}:{line_number}: record must be an object")
        records.append(value)
    return records


def verify_private_release(
    output_root: Path,
    *,
    config_path: Path = DEFAULT_CONFIG_PATH,
    schema_path: Path = DEFAULT_SCHEMA_PATH,
) -> dict[str, Any]:
    """Verify strict JSON, permissions, semantic-only shape, and all frozen hashes."""

    if output_root.is_symlink() or not output_root.is_dir():
        raise PrivateEvaluationError("private output root is missing or unsafe")
    if _mode(output_root) != 0o700:
        raise PrivateEvaluationError("private output root mode must be 0700")
    manifest = load_governed_json(output_root / "manifest.json")
    if not isinstance(manifest, dict):
        raise PrivateEvaluationError("private manifest must be an object")
    if manifest.get("contains_answer_keys") is not False:
        raise PrivateEvaluationError("private manifest must exclude answer keys")
    if manifest.get("publication_authorized") is not False:
        raise PrivateEvaluationError("private manifest cannot authorize publication")
    config = _load_config(config_path)
    if manifest.get("source_commit") != config["source_commit"]:
        raise PrivateEvaluationError("private manifest source commit drift")
    sums = {}
    for line in (output_root / "SHA256SUMS").read_text(encoding="ascii").splitlines():
        digest, relative = line.split("  ", 1)
        sums[relative] = digest
    if sums != manifest["files"] | {"manifest.json": _sha256_path(output_root / "manifest.json")}:
        raise PrivateEvaluationError("SHA256SUMS inventory differs from manifest files")
    for relative, digest in sums.items():
        path = output_root / relative
        if path.is_symlink() or not path.is_file():
            raise PrivateEvaluationError(f"unsafe or missing release file: {relative}")
        if _mode(path) != 0o600:
            raise PrivateEvaluationError(f"private release file mode must be 0600: {relative}")
        if _sha256_path(path) != digest:
            raise PrivateEvaluationError(f"private release checksum mismatch: {relative}")
    cases_by_layer = {}
    for layer in LAYERS:
        layer_path = output_root / layer
        if _mode(layer_path) != 0o700:
            raise PrivateEvaluationError(f"private layer mode must be 0700: {layer}")
        cases_by_layer[layer] = _load_jsonl_strict(layer_path / "cases.jsonl")
    validator = _validator(schema_path)
    expected_provenance = _provenance(config, config_path, schema_path)
    for layer in LAYERS:
        for case in cases_by_layer[layer]:
            errors = validate_semantic_case(case, validator=validator)
            if errors:
                raise PrivateEvaluationError(f"{case.get('case_id', layer)}: {'; '.join(errors)}")
            if case["provenance"] != expected_provenance:
                raise PrivateEvaluationError(
                    f"{case['case_id']}: generator or source provenance drift"
                )
    validate_partition_isolation(cases_by_layer)
    checksums = load_governed_json(output_root / "RECORD_CHECKSUMS.json")
    observed_checksums = {
        case["case_id"]: _sha256_bytes(canonical_json_bytes(case))
        for layer in LAYERS
        for case in cases_by_layer[layer]
    }
    if checksums.get("records") != dict(sorted(observed_checksums.items())):
        raise PrivateEvaluationError("record checksum manifest mismatch")
    return {
        "record_count": len(observed_checksums),
        "layer_counts": {layer: len(cases_by_layer[layer]) for layer in LAYERS},
        "manifest_sha256": _sha256_path(output_root / "manifest.json"),
        "record_checksums_sha256": _sha256_path(output_root / "RECORD_CHECKSUMS.json"),
        "sha256sums_sha256": _sha256_path(output_root / "SHA256SUMS"),
        "release_non_overlap_proof_complete": manifest["release_non_overlap_proof_complete"],
        "release_blocker": manifest["release_blocker"],
    }
