"""Fail-closed loading for the proposed Dime tool and market contracts."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from dime_ai.foundation_contracts import (
    GOVERNED_RECOMPUTATION_TOLERANCE,
    GOVERNED_ROI_TOLERANCE,
    FoundationContractError,
    _freeze,
    _parse_strict_json,
    _project_directory,
    _read_file_once,
    _safe_schema_error_message,
    _sha256,
    _strict_json,
    _strict_schema,
    _validate_document,
)
from dime_ai.market_math import (
    american_to_decimal,
    american_to_implied_probability,
    expected_profit_per_unit,
    market_hold,
    probability_clv,
    remove_vig_from_american,
    roi,
    settled_profit,
)

TOOL_NAMES = (
    "get_game_context",
    "get_current_odds",
    "get_odds_history",
    "get_market_splits",
    "calculate_market_math",
    "get_bet_tracker_summary",
    "run_simulation",
)
MARKET_TYPES = ("moneyline", "spread", "total")
MARKET_KEY = {
    "type": "object",
    "additionalProperties": False,
    "required": ["market_type", "period"],
    "properties": {
        "market_type": {"enum": list(MARKET_TYPES)},
        "period": {"const": "full_game"},
    },
}
REQUEST_CATALOG_PATH = "tools/tools.v1.json"
MARKET_CATALOG_PATH = "tools/market_keys.v1.json"
MARKET_SCHEMA_PATH = "schemas/market_keys.schema.json"
REGISTRY_PATH = "tools/tool_response_registry.v1.json"
REGISTRY_SCHEMA_PATH = "schemas/tool_response_registry.schema.json"
ENVELOPE_PATH = "schemas/tool_response.schema.json"
DATA_SCHEMA_PATHS = tuple(
    f"schemas/tool_responses/{tool_name}.data.schema.json" for tool_name in TOOL_NAMES
)
BUNDLE_PATHS = (
    REQUEST_CATALOG_PATH,
    MARKET_CATALOG_PATH,
    MARKET_SCHEMA_PATH,
    REGISTRY_PATH,
    REGISTRY_SCHEMA_PATH,
    ENVELOPE_PATH,
    *DATA_SCHEMA_PATHS,
)
DEFAULT_GAME_FIELDS = (
    "schedule",
    "teams",
    "rosters",
    "injuries",
    "result",
    "live_state",
)
DEFAULT_MARKET_PHASE = "pregame"
DEFAULT_HISTORY_LIMIT = 500
MAX_AMERICAN_ODDS = 100000
SPLIT_TOTAL_TOLERANCE = Decimal("0.000001")
_FORBIDDEN_MODEL_FIELDS = frozenset(
    {
        "tenant_id",
        "user_id",
        "user_scope",
        "subject_id",
        "account_id",
        "provider_id",
        "provider_scope",
        "entitlement_scope",
        "as_of_utc",
        "policy_decision",
        "simulation_model_version",
        "credentials",
        "access_token",
        "api_key",
    }
)
_EXPECTED_REGISTRY_CLASSIFICATIONS = MappingProxyType(
    {
        "get_game_context": (
            "provider_backed",
            "authorized_event_data",
            False,
            ("provider_scoped",),
        ),
        "get_current_odds": (
            "provider_backed",
            "licensed_market_data",
            True,
            ("provider_scoped",),
        ),
        "get_odds_history": (
            "provider_backed",
            "licensed_market_data",
            True,
            ("provider_scoped",),
        ),
        "get_market_splits": (
            "provider_backed",
            "licensed_aggregate_market_data",
            True,
            ("provider_scoped",),
        ),
        "calculate_market_math": (
            "deterministic",
            "no_private_data",
            True,
            ("deterministic",),
        ),
        "get_bet_tracker_summary": (
            "session_bound",
            "minimum_necessary_private_aggregate",
            False,
            ("authorized_private_aggregate",),
        ),
        "run_simulation": (
            "server_selected_deterministic",
            "authorized_derived_event_data",
            False,
            ("provider_scoped",),
        ),
    }
)
_MATH_OUTPUT_KEYS = MappingProxyType(
    {
        "implied_probability": {"implied_probability"},
        "remove_vig": {"raw_probabilities", "hold", "no_vig_probabilities"},
        "market_hold": {"raw_probabilities", "hold"},
        "expected_value": {"decimal_odds", "expected_profit_per_unit", "expected_roi"},
        "settled_profit": {"decimal_odds", "settled_profit"},
        "roi": {"roi"},
        "probability_clv": {
            "entry_no_vig_probability",
            "closing_no_vig_probability",
            "probability_clv",
        },
    }
)


@dataclass(frozen=True)
class LoadedToolContractBundle:
    """Immutable, byte-identified tool-contract state."""

    request_catalog: tuple[Mapping[str, Any], ...]
    market_catalog: Mapping[str, Any]
    registry: Mapping[str, Mapping[str, Any]]
    envelope_schema: Mapping[str, Any]
    data_schemas: Mapping[str, Mapping[str, Any]]
    raw_bytes: Mapping[str, bytes]
    file_sha256: Mapping[str, str]
    manifest_bytes: bytes
    bundle_sha256: str


def _manifest_bytes(file_sha256: Mapping[str, str]) -> bytes:
    if tuple(file_sha256) != BUNDLE_PATHS:
        raise FoundationContractError("tool contract bundle: unexpected governed path inventory")
    document = {
        "schema_version": "dime-tool-contract-bundle-manifest-v1",
        "entries": [{"path": path, "sha256": file_sha256[path]} for path in BUNDLE_PATHS],
    }
    return (
        json.dumps(
            document,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def compute_tool_contract_bundle_sha256(file_sha256: Mapping[str, str]) -> str:
    """Hash the canonical ordered path/hash manifest for the tool contracts."""

    return _sha256(_manifest_bytes(file_sha256))


def _read(root: Path, path: str, *, kind: str) -> bytes:
    return _read_file_once(root, path, logical_name="tool contract", kind=kind)


def _strict_array(value: bytes, *, label: str) -> list[Any]:
    document = _parse_strict_json(value, label=label)
    if not isinstance(document, list):
        raise FoundationContractError(f"{label}: expected one top-level array")
    return document


def _request_market_schema(tool: Mapping[str, Any]) -> Mapping[str, Any] | None:
    function = tool["function"]
    parameters = function["parameters"]
    properties = parameters["properties"]
    if function["name"] == "calculate_market_math":
        branch = next(
            candidate
            for candidate in parameters["oneOf"]
            if candidate["properties"]["operation"].get("const") == "probability_clv"
        )
        return branch["properties"]["inputs"]["properties"]["market_key"]
    return properties.get("market_key")


def _schema_property_names(schema: object) -> set[str]:
    """Collect only executable JSON-Schema property names, at every depth."""

    names: set[str] = set()
    if isinstance(schema, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict):
            names.update(properties)
        for value in schema.values():
            names.update(_schema_property_names(value))
    elif isinstance(schema, list):
        for value in schema:
            names.update(_schema_property_names(value))
    return names


def _load(root: Path) -> LoadedToolContractBundle:
    fixed_paths = (
        REQUEST_CATALOG_PATH,
        MARKET_CATALOG_PATH,
        MARKET_SCHEMA_PATH,
        REGISTRY_PATH,
        REGISTRY_SCHEMA_PATH,
        ENVELOPE_PATH,
        *DATA_SCHEMA_PATHS,
    )
    raw = {path: _read(root, path, kind="file") for path in fixed_paths}

    request_catalog = _strict_array(raw[REQUEST_CATALOG_PATH], label="request catalog")
    market_catalog = _strict_json(raw[MARKET_CATALOG_PATH], label="market catalog")
    market_schema = _strict_schema(raw[MARKET_SCHEMA_PATH], label="market catalog schema")
    registry = _strict_json(raw[REGISTRY_PATH], label="tool response registry")
    registry_schema = _strict_schema(
        raw[REGISTRY_SCHEMA_PATH], label="tool response registry schema"
    )
    envelope_schema = _strict_schema(raw[ENVELOPE_PATH], label="tool response envelope")
    data_schemas = {
        tool_name: _strict_schema(raw[path], label=f"{tool_name} response data schema")
        for tool_name, path in zip(TOOL_NAMES, DATA_SCHEMA_PATHS, strict=True)
    }

    _validate_document(market_catalog, market_schema, label="market catalog")
    _validate_document(registry, registry_schema, label="tool response registry")
    Draft202012Validator.check_schema(envelope_schema)

    if len(request_catalog) != 7 or any(not isinstance(item, dict) for item in request_catalog):
        raise FoundationContractError("request catalog: expected exactly seven tool objects")
    request_names = tuple(item["function"]["name"] for item in request_catalog)
    registry_entries = registry["tools"]
    registry_names = tuple(item["tool_name"] for item in registry_entries)
    if request_names != TOOL_NAMES or registry_names != TOOL_NAMES:
        raise FoundationContractError("tool contract bundle: exact seven-tool parity failed")

    market_types = tuple(item["market_type"] for item in market_catalog["markets"])
    if market_types != MARKET_TYPES:
        raise FoundationContractError("market catalog: canonical market ordering mismatch")
    if market_catalog["identity_fields"] != ["market_type", "period"]:
        raise FoundationContractError("market catalog: stable identity fields mismatch")

    for item in request_catalog:
        function = item["function"]
        if function.get("x-tool-version") != "1.0.0":
            raise FoundationContractError("request catalog: tool version mismatch")
        if function.get("x-request-catalog-version") != "1.0.0":
            raise FoundationContractError("request catalog: catalog version mismatch")
        Draft202012Validator.check_schema(function["parameters"])
        fields = _schema_property_names(function["parameters"])
        if fields & _FORBIDDEN_MODEL_FIELDS:
            raise FoundationContractError(
                "request catalog: server-owned field exposed to the model"
            )
        market_schema_for_tool = _request_market_schema(item)
        if market_schema_for_tool is not None and market_schema_for_tool != MARKET_KEY:
            raise FoundationContractError("request catalog: canonical market-key mismatch")

    expected_top_hashes = {
        "request_catalog_sha256": _sha256(raw[REQUEST_CATALOG_PATH]),
        "market_catalog_sha256": _sha256(raw[MARKET_CATALOG_PATH]),
        "response_envelope_sha256": _sha256(raw[ENVELOPE_PATH]),
    }
    for field, actual in expected_top_hashes.items():
        if registry[field] != actual:
            raise FoundationContractError(f"tool response registry: {field} mismatch")
    if registry["request_catalog_path"] != REQUEST_CATALOG_PATH:
        raise FoundationContractError("tool response registry: request catalog path mismatch")
    if registry["market_catalog_path"] != MARKET_CATALOG_PATH:
        raise FoundationContractError("tool response registry: market catalog path mismatch")
    if registry["response_envelope_path"] != ENVELOPE_PATH:
        raise FoundationContractError("tool response registry: envelope path mismatch")

    registry_by_name: dict[str, Mapping[str, Any]] = {}
    for tool_name, entry, expected_path in zip(
        TOOL_NAMES, registry_entries, DATA_SCHEMA_PATHS, strict=True
    ):
        if entry["data_schema_path"] != expected_path:
            raise FoundationContractError(
                f"tool response registry: {tool_name} data-schema path mismatch"
            )
        if entry["data_schema_sha256"] != _sha256(raw[expected_path]):
            raise FoundationContractError(
                f"tool response registry: {tool_name} data-schema hash mismatch"
            )
        expected_classification = _EXPECTED_REGISTRY_CLASSIFICATIONS[tool_name]
        actual_classification = (
            entry["execution_class"],
            entry["privacy_classification"],
            entry["uses_market_catalog"],
            tuple(entry["permitted_source_scope_types"]),
        )
        if actual_classification != expected_classification:
            raise FoundationContractError(
                f"tool response registry: {tool_name} classification mismatch"
            )
        registry_by_name[tool_name] = entry

    bundle_raw = {path: raw[path] for path in BUNDLE_PATHS}
    file_sha256 = {path: _sha256(value) for path, value in bundle_raw.items()}
    manifest = _manifest_bytes(file_sha256)
    return LoadedToolContractBundle(
        request_catalog=tuple(_freeze(item) for item in request_catalog),
        market_catalog=_freeze(market_catalog),
        registry=MappingProxyType(
            {name: _freeze(entry) for name, entry in registry_by_name.items()}
        ),
        envelope_schema=_freeze(envelope_schema),
        data_schemas=MappingProxyType(
            {name: _freeze(schema) for name, schema in data_schemas.items()}
        ),
        raw_bytes=MappingProxyType(bundle_raw),
        file_sha256=MappingProxyType(file_sha256),
        manifest_bytes=manifest,
        bundle_sha256=_sha256(manifest),
    )


def load_tool_contracts(*, project_root: str | Path | None = None) -> LoadedToolContractBundle:
    """Load and cross-check every governed tool-contract byte exactly once."""

    try:
        return _load(_project_directory(project_root))
    except FoundationContractError:
        raise
    except Exception as exc:
        raise FoundationContractError(
            "tool contract bundle: unexpected validation failure"
        ) from exc


@lru_cache(maxsize=1)
def _default_bundle() -> LoadedToolContractBundle:
    return load_tool_contracts()


def _validation_error(
    validator: Draft202012Validator, instance: Mapping[str, Any], *, label: str
) -> None:
    def leaves(error: ValidationError) -> list[ValidationError]:
        if not error.context:
            return [error]
        return [leaf for child in error.context for leaf in leaves(child)]

    errors = sorted(
        validator.iter_errors(instance),
        key=lambda error: (
            tuple(str(item) for item in error.absolute_schema_path),
            str(error.validator),
        ),
    )
    if errors:
        candidates = [leaf for error in errors for leaf in leaves(error)]
        error = max(
            candidates,
            key=lambda item: len(item.absolute_schema_path),
        )
        raise FoundationContractError(_safe_schema_error_message(error, label=label))


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def validate_market_key(value: object) -> None:
    """Require one canonical governed market key; aliases never enter storage."""

    if not isinstance(value, dict):
        raise FoundationContractError("market key: expected canonical object")
    _validation_error(Draft202012Validator(MARKET_KEY), value, label="market key")


def _utc(value: str, *, label: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except (TypeError, ValueError) as exc:
        raise FoundationContractError(f"{label}: expected canonical UTC timestamp") from exc


def _decimal(value: object, *, label: str) -> Decimal:
    try:
        result = Decimal(value)  # type: ignore[arg-type]
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise FoundationContractError(f"tool response: invalid {label}") from exc
    if not result.is_finite():
        raise FoundationContractError(f"tool response: invalid {label}")
    return result


def _probability(value: object, *, label: str = "probability") -> Decimal:
    result = _decimal(value, label=label)
    if not Decimal("0") <= result <= Decimal("1"):
        raise FoundationContractError(f"tool response: {label} must be between 0 and 1")
    return result


def _american_odds(value: object) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or abs(value) < 100
        or abs(value) > MAX_AMERICAN_ODDS
    ):
        raise FoundationContractError("tool response: invalid American odds")


def validate_tool_arguments(tool_name: str, arguments: Mapping[str, Any]) -> None:
    """Enforce cross-field request semantics not expressible in JSON Schema."""

    tool = next(
        (
            item
            for item in _default_bundle().request_catalog
            if item["function"]["name"] == tool_name
        ),
        None,
    )
    if tool is None:
        raise FoundationContractError("tool request: unknown tool")
    _validation_error(
        Draft202012Validator(_thaw(tool["function"]["parameters"])),
        arguments,
        label=f"{tool_name} request",
    )

    if tool_name == "get_odds_history":
        start, end = arguments.get("from_utc"), arguments.get("to_utc")
        if (
            start is not None
            and end is not None
            and _utc(start, label="history from") > _utc(end, label="history to")
        ):
            raise FoundationContractError("tool request: requested history window is reversed")
    elif tool_name == "get_bet_tracker_summary":
        filters = arguments.get("filters", {})
        start, end = filters.get("from_utc"), filters.get("to_utc")
        if (
            start is not None
            and end is not None
            and _utc(start, label="filter from") > _utc(end, label="filter to")
        ):
            raise FoundationContractError("tool request: bet filter window is reversed")
    elif tool_name == "calculate_market_math":
        operation = arguments["operation"]
        inputs = arguments["inputs"]
        if operation == "roi":
            if len(inputs["profits"]) != len(inputs["stakes"]):
                raise FoundationContractError(
                    "tool request: ROI profits and stakes must have equal lengths"
                )
            total_stake = sum(
                (_decimal(stake, label="ROI stake") for stake in inputs["stakes"]),
                Decimal("0"),
            )
            if total_stake <= 0:
                raise FoundationContractError(
                    "tool request: aggregate ROI requires positive total stake"
                )
        elif operation == "probability_clv":
            entry = inputs["entry_market_odds"]
            closing = inputs["closing_market_odds"]
            if set(entry) != set(closing):
                raise FoundationContractError("tool request: probability-CLV selections must match")
            if inputs["backed_selection"] not in entry:
                raise FoundationContractError(
                    "tool request: backed selection is absent from probability-CLV markets"
                )


def _require_call_match(actual: object, expected: object, *, field: str) -> None:
    if actual != expected:
        raise FoundationContractError(
            f"tool response: {field} does not match originating call arguments"
        )


def _validate_call_binding(
    tool_name: str, data: Mapping[str, Any], arguments: Mapping[str, Any]
) -> None:
    if tool_name == "get_game_context":
        _require_call_match(data["event_ref"], arguments["event_id"], field="event")
        requested = list(arguments.get("fields", DEFAULT_GAME_FIELDS))
        _require_call_match(data["requested_fields"], requested, field="requested fields")
        missing = set(data["missing_fields"])
        if not missing <= set(requested):
            raise FoundationContractError(
                "tool response: missing fields contradict originating call arguments"
            )
        fact_fields = {
            "schedule": "schedule",
            "home_team": "teams",
            "away_team": "teams",
            "roster_count": "rosters",
            "injury_count": "injuries",
            "home_score": "result",
            "away_score": "result",
            "period": "live_state",
            "clock": "live_state",
        }
        returned = {fact_fields[name] for name in data["facts"]}
        if not returned <= set(requested) or returned & missing:
            raise FoundationContractError(
                "tool response: returned fields contradict requested or missing fields"
            )
    elif tool_name == "get_current_odds":
        _require_call_match(data["event_ref"], arguments["event_id"], field="event")
        _require_call_match(data["market_key"], arguments["market_key"], field="market")
        _require_call_match(
            data["market_phase"],
            arguments.get("mode", DEFAULT_MARKET_PHASE),
            field="market phase",
        )
    elif tool_name == "get_odds_history":
        _require_call_match(data["event_ref"], arguments["event_id"], field="event")
        _require_call_match(data["market_key"], arguments["market_key"], field="market")
        _require_call_match(
            data["requested_from_utc"], arguments.get("from_utc"), field="history from"
        )
        _require_call_match(data["requested_to_utc"], arguments.get("to_utc"), field="history to")
        if len(data["snapshots"]) > arguments.get("limit", DEFAULT_HISTORY_LIMIT):
            raise FoundationContractError(
                "tool response: history count exceeds originating call limit"
            )
    elif tool_name == "get_market_splits":
        _require_call_match(data["event_ref"], arguments["event_id"], field="event")
        _require_call_match(data["market_key"], arguments["market_key"], field="market")
    elif tool_name == "calculate_market_math":
        _require_call_match(data["operation"], arguments["operation"], field="operation")
        _require_call_match(
            data["normalized_inputs"], arguments["inputs"], field="normalized inputs"
        )
    elif tool_name == "get_bet_tracker_summary":
        _require_call_match(data["filters"], arguments.get("filters", {}), field="filters")
    elif tool_name == "run_simulation":
        _require_call_match(data["event_ref"], arguments["event_id"], field="event")
        _require_call_match(data["draws"], arguments["draws"], field="draw count")
        _require_call_match(data["seed"], arguments["seed"], field="seed")


def _validate_math_semantics(data: Mapping[str, Any]) -> None:
    operation = data["operation"]
    output = data["output"]
    if operation == "implied_probability":
        _probability(output["implied_probability"], label="implied probability")
    elif operation in {"remove_vig", "market_hold"}:
        for value in output["raw_probabilities"].values():
            _probability(value, label="probability")
        if operation == "remove_vig":
            for value in output["no_vig_probabilities"].values():
                _probability(value, label="no-vig probability")
    elif operation in {"expected_value", "settled_profit"}:
        if _decimal(output["decimal_odds"], label="decimal odds") <= 1:
            raise FoundationContractError(
                "tool response: decimal odds must be strictly greater than 1"
            )
    elif operation == "probability_clv":
        _probability(output["entry_no_vig_probability"], label="entry no-vig probability")
        _probability(output["closing_no_vig_probability"], label="closing no-vig probability")
        clv = _decimal(output["probability_clv"], label="probability CLV")
        if not Decimal("-1") <= clv <= Decimal("1"):
            raise FoundationContractError("tool response: probability CLV must be between -1 and 1")


def _expected_math_output(data: Mapping[str, Any]) -> Mapping[str, Any]:
    operation = data["operation"]
    inputs = data["normalized_inputs"]
    try:
        if operation == "implied_probability":
            return {"implied_probability": american_to_implied_probability(inputs["american_odds"])}
        if operation in {"remove_vig", "market_hold"}:
            odds = inputs["american_odds"]
            raw = {
                selection: american_to_implied_probability(price)
                for selection, price in odds.items()
            }
            expected: dict[str, Any] = {
                "raw_probabilities": raw,
                "hold": market_hold(raw),
            }
            if operation == "remove_vig":
                expected["no_vig_probabilities"] = remove_vig_from_american(odds)
            return expected
        if operation == "expected_value":
            decimal_odds = american_to_decimal(inputs["american_odds"])
            expected_value = expected_profit_per_unit(
                inputs["probability"],
                decimal_odds,
            )
            return {
                "decimal_odds": decimal_odds,
                "expected_profit_per_unit": expected_value,
                "expected_roi": expected_value,
            }
        if operation == "settled_profit":
            decimal_odds = american_to_decimal(inputs["american_odds"])
            return {
                "decimal_odds": decimal_odds,
                "settled_profit": settled_profit(
                    inputs["stake"],
                    decimal_odds,
                    inputs["result"],
                ),
            }
        if operation == "roi":
            return {"roi": roi(inputs["profits"], inputs["stakes"])}
        if operation == "probability_clv":
            entry = remove_vig_from_american(inputs["entry_market_odds"])
            closing = remove_vig_from_american(inputs["closing_market_odds"])
            selection = inputs["backed_selection"]
            return {
                "entry_no_vig_probability": entry[selection],
                "closing_no_vig_probability": closing[selection],
                "probability_clv": probability_clv(
                    inputs["entry_market_odds"],
                    inputs["closing_market_odds"],
                    selection,
                ),
            }
    except (KeyError, TypeError, ValueError) as exc:
        raise FoundationContractError("tool response: market-math recomputation failed") from exc
    raise FoundationContractError("tool response: market-math recomputation failed")


def _require_recomputed_math(actual: object, expected: object) -> None:
    if isinstance(expected, Mapping):
        if not isinstance(actual, Mapping) or set(actual) != set(expected):
            raise FoundationContractError("tool response: market-math recomputation mismatch")
        for key in expected:
            _require_recomputed_math(actual[key], expected[key])
        return
    value = _decimal(actual, label="market-math recomputation output")
    if abs(value - expected) > GOVERNED_RECOMPUTATION_TOLERANCE:
        raise FoundationContractError("tool response: market-math recomputation mismatch")


def _validate_warning_semantics(
    response: Mapping[str, Any],
    *,
    expected_tool_name: str,
) -> None:
    expected_warnings: list[str] = []
    if expected_tool_name == "get_current_odds":
        status = response["status"]
        if status == "not_found":
            expected_warnings = ["current_quote_unavailable"]
        elif status == "stale":
            expected_warnings = ["stale_pregame_quote"]
        elif status == "partial" and any(
            quote["quote_status"] == "stale" for quote in response["data"]["quotes"]
        ):
            expected_warnings = ["stale_pregame_quote"]
    if response["warnings"] != expected_warnings:
        raise FoundationContractError("tool response: warning is inconsistent with tool result")


def validate_tool_response(
    response: Mapping[str, Any],
    *,
    expected_tool_name: str,
    expected_call_id: str,
    expected_arguments: Mapping[str, Any],
) -> None:
    """Validate envelope, exact per-tool data, identity, status, and freshness."""

    bundle = _default_bundle()
    entry = bundle.registry.get(expected_tool_name)
    if entry is None:
        raise FoundationContractError("tool response: unknown expected tool")
    _validation_error(
        Draft202012Validator(_thaw(bundle.envelope_schema)),
        response,
        label="tool response envelope",
    )
    if response["tool_name"] != expected_tool_name:
        raise FoundationContractError("tool response: tool-name linkage mismatch")
    if response["tool_call_id"] != expected_call_id:
        raise FoundationContractError("tool response: tool-call linkage mismatch")
    if response["tool_version"] != entry["tool_version"]:
        raise FoundationContractError("tool response: registered tool version mismatch")
    if response["status"] not in entry["permitted_statuses"]:
        raise FoundationContractError("tool response: status is not permitted for tool")
    scope = response["source_scope"]
    if scope["scope_type"] not in entry["permitted_source_scope_types"]:
        raise FoundationContractError("tool response: source scope is not permitted for tool")
    if scope["scope_type"] == "deterministic" and scope["provider_universe"]:
        raise FoundationContractError(
            "tool response: deterministic source scope requires an empty provider universe"
        )

    data = response["data"]
    encoded_data = json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False).encode(
        "utf-8"
    )
    if len(encoded_data) > entry["maximum_data_bytes"]:
        raise FoundationContractError("tool response: data payload exceeds registered bound")
    _validation_error(
        Draft202012Validator(_thaw(bundle.data_schemas[expected_tool_name])),
        data,
        label=f"{expected_tool_name} response data",
    )
    _validate_warning_semantics(response, expected_tool_name=expected_tool_name)

    status = response["status"]
    as_of = _utc(response["as_of_utc"], label="tool response as_of_utc")
    valid_until_value = response["valid_until_utc"]
    if status in {"ok", "partial", "stale"}:
        if entry["freshness_requirement"] == "as_of_only":
            if valid_until_value is not None:
                raise FoundationContractError(
                    "tool response: as-of-only result cannot have a validity interval"
                )
        else:
            if not isinstance(valid_until_value, str):
                raise FoundationContractError(
                    "tool response: successful data requires a validity interval"
                )
            valid_until = _utc(valid_until_value, label="tool response valid_until_utc")
            if valid_until < as_of:
                raise FoundationContractError("tool response: invalid validity interval")
    elif valid_until_value is not None:
        raise FoundationContractError(
            "tool response: failure result cannot have a validity interval"
        )
    if (
        data
        and entry["source_requirement"] == "required_for_nonempty_data"
        and not response["source_ids"]
    ):
        raise FoundationContractError(
            "tool response: nonempty provider or private data requires source IDs"
        )
    if (
        data
        and scope["scope_type"] in {"provider_scoped", "authorized_private_aggregate"}
        and (not response["source_ids"] or not scope["provider_universe"])
    ):
        raise FoundationContractError(
            "tool response: provider or private scope requires source identity"
        )
    validate_tool_arguments(expected_tool_name, expected_arguments)
    if data:
        _validate_call_binding(expected_tool_name, data, expected_arguments)

    if expected_tool_name == "get_current_odds" and data:
        envelope_sources = set(response["source_ids"])
        for quote in data["quotes"]:
            _american_odds(quote["price_american"])
            if quote["source_id"] not in envelope_sources:
                raise FoundationContractError(
                    "tool response: current-odds quote source is not declared by envelope"
                )
            if _utc(quote["observed_at_utc"], label="current-odds observation") > as_of:
                raise FoundationContractError(
                    "tool response: current-odds observation is after as_of_utc"
                )
        quote_statuses = {quote["quote_status"] for quote in data["quotes"]}
        if status == "stale" and quote_statuses != {"stale"}:
            raise FoundationContractError("tool response: stale odds cannot masquerade as current")
        if status == "ok" and quote_statuses != {"current"}:
            raise FoundationContractError(
                "tool response: complete current odds contain non-current quotes"
            )
        if (
            status == "partial"
            and "stale" in quote_statuses
            and "stale" not in response["quality_flags"]
        ):
            raise FoundationContractError(
                "tool response: partial stale odds require stale disclosure"
            )
        if "suspended" in quote_statuses and (
            status != "partial" or "suspended" not in response["quality_flags"]
        ):
            raise FoundationContractError(
                "tool response: suspended odds require partial suspension disclosure"
            )
    if expected_tool_name == "get_odds_history" and data:
        envelope_sources = set(response["source_ids"])
        observations = [
            _utc(item["observed_at_utc"], label="odds-history observation")
            for item in data["snapshots"]
        ]
        if observations != sorted(observations):
            raise FoundationContractError(
                "tool response: odds-history snapshots must be chronological"
            )
        requested_from = data["requested_from_utc"]
        requested_to = data["requested_to_utc"]
        if (
            requested_from is not None
            and requested_to is not None
            and _utc(requested_from, label="requested history from")
            > _utc(requested_to, label="requested history to")
        ):
            raise FoundationContractError("tool response: requested history window is reversed")
        returned_from = data["returned_from_utc"]
        returned_to = data["returned_to_utc"]
        if observations:
            if returned_from is None or returned_to is None:
                raise FoundationContractError(
                    "tool response: nonempty history requires returned bounds"
                )
            lower = _utc(returned_from, label="returned history from")
            upper = _utc(returned_to, label="returned history to")
            if lower > upper:
                raise FoundationContractError("tool response: returned history window is reversed")
            if lower > as_of or upper > as_of:
                raise FoundationContractError(
                    "tool response: returned history bounds are after as_of_utc"
                )
            if requested_from is not None and lower < _utc(
                requested_from, label="requested history from"
            ):
                raise FoundationContractError(
                    "tool response: returned history begins before requested scope"
                )
            if requested_to is not None and upper > _utc(
                requested_to, label="requested history to"
            ):
                raise FoundationContractError(
                    "tool response: returned history ends after requested scope"
                )
            if observations[0] < lower or observations[-1] > upper:
                raise FoundationContractError(
                    "tool response: history snapshot is outside returned interval"
                )
            if observations[-1] > as_of:
                raise FoundationContractError(
                    "tool response: history observation is after as_of_utc"
                )
        elif returned_from is not None or returned_to is not None:
            raise FoundationContractError(
                "tool response: empty history cannot claim returned bounds"
            )
        for item in data["snapshots"]:
            _american_odds(item["price_american"])
            if item["source_id"] not in envelope_sources:
                raise FoundationContractError(
                    "tool response: history snapshot source is not declared by envelope"
                )
        if data["truncated"] and not data["next_cursor"]:
            raise FoundationContractError(
                "tool response: truncated history requires a continuation cursor"
            )
        if not data["truncated"] and data["next_cursor"] is not None:
            raise FoundationContractError(
                "tool response: complete history cannot claim a continuation cursor"
            )
    if expected_tool_name == "get_market_splits" and data:
        if data["sample_size_known"] != (data["sample_size"] is not None):
            raise FoundationContractError(
                "tool response: split sample-size disclosure is inconsistent"
            )
        if data["sample_size_known"] and data["sample_size"] < 1:
            raise FoundationContractError("tool response: known split sample size must be positive")
        if _utc(data["observed_at_utc"], label="market-splits observation") > as_of:
            raise FoundationContractError(
                "tool response: market-splits observation is after as_of_utc"
            )
        if set(data["provider_universe"]) != set(scope["provider_universe"]):
            raise FoundationContractError(
                "tool response: split provider identities contradict source scope"
            )
        selections = [item["selection"] for item in data["splits"]]
        if len(selections) != len(set(selections)):
            raise FoundationContractError("tool response: market-splits selections must be unique")
        ticket_total = Decimal("0")
        handle_total = Decimal("0")
        for item in data["splits"]:
            ticket = _decimal(item["ticket_pct"], label="split percentage")
            handle = _decimal(item["handle_pct"], label="split percentage")
            if not Decimal("0") <= ticket <= Decimal("100"):
                raise FoundationContractError(
                    "tool response: split percentage must be between 0 and 100"
                )
            if not Decimal("0") <= handle <= Decimal("100"):
                raise FoundationContractError(
                    "tool response: split percentage must be between 0 and 100"
                )
            if "price_american" in item and item["price_american"] is not None:
                _american_odds(item["price_american"])
            ticket_total += ticket
            handle_total += handle
        if data["coverage_type"] == "complete_market":
            if (
                abs(ticket_total - Decimal("100")) > SPLIT_TOTAL_TOLERANCE
                or abs(handle_total - Decimal("100")) > SPLIT_TOTAL_TOLERANCE
            ):
                raise FoundationContractError(
                    "tool response: complete-market split percentages must total 100"
                )
        elif "partial_market_coverage" not in response["quality_flags"]:
            raise FoundationContractError(
                "tool response: incomplete split coverage requires disclosure"
            )
    if expected_tool_name == "calculate_market_math" and data:
        expected_keys = _MATH_OUTPUT_KEYS[data["operation"]]
        if set(data["output"]) != expected_keys:
            raise FoundationContractError("tool response: market-math operation/output mismatch")
        _validate_math_semantics(data)
        _require_recomputed_math(data["output"], _expected_math_output(data))
    if expected_tool_name == "get_bet_tracker_summary" and data:
        start, end = data["coverage"]["from_utc"], data["coverage"]["to_utc"]
        start_time = _utc(start, label="coverage from") if start is not None else None
        end_time = _utc(end, label="coverage to") if end is not None else None
        if start_time is not None and end_time is not None and start_time > end_time:
            raise FoundationContractError("tool response: coverage window is reversed")
        if start_time is not None and start_time > as_of:
            raise FoundationContractError("tool response: coverage begins after as_of_utc")
        if end_time is not None and end_time > as_of:
            raise FoundationContractError("tool response: coverage ends after as_of_utc")
        filters = data["filters"]
        requested_from = filters.get("from_utc")
        requested_to = filters.get("to_utc")
        if requested_from is not None and (
            start_time is None or start_time < _utc(requested_from, label="requested coverage from")
        ):
            raise FoundationContractError(
                "tool response: coverage begins before requested filter scope"
            )
        if requested_to is not None and (
            end_time is None or end_time > _utc(requested_to, label="requested coverage to")
        ):
            raise FoundationContractError(
                "tool response: coverage ends after requested filter scope"
            )
        if data["bet_count"] < 1:
            raise FoundationContractError(
                "tool response: successful Tracker data requires a positive bet count"
            )
        stake = _decimal(data["aggregates"]["stake_units"], label="aggregate stake")
        profit = _decimal(data["aggregates"]["profit_units"], label="aggregate profit")
        roi_value = _decimal(data["aggregates"]["roi"], label="aggregate ROI")
        if stake <= 0:
            raise FoundationContractError(
                "tool response: aggregate ROI requires positive total stake"
            )
        if abs(roi_value - (profit / stake)) > GOVERNED_ROI_TOLERANCE:
            raise FoundationContractError(
                "tool response: aggregate ROI is inconsistent with profit and stake"
            )
        clv = data["aggregates"]["mean_probability_clv"]
        if clv is not None and not Decimal("-1") <= _decimal(
            clv, label="probability CLV"
        ) <= Decimal("1"):
            raise FoundationContractError("tool response: probability CLV must be between -1 and 1")
    if expected_tool_name == "run_simulation" and data:
        distribution = data["distribution"]
        _probability(distribution["home_win_probability"], label="simulation probability")
        p10 = _decimal(distribution["p10"], label="simulation quantile")
        p50 = _decimal(distribution["p50"], label="simulation quantile")
        p90 = _decimal(distribution["p90"], label="simulation quantile")
        if not p10 <= p50 <= p90:
            raise FoundationContractError("tool response: simulation quantiles are reversed")
        if _utc(data["run_at_utc"], label="simulation run time") > as_of:
            raise FoundationContractError("tool response: simulation run time is after as_of_utc")
