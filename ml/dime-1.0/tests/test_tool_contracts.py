from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from dime_ai.data_validation import DataValidationError, validate_eval_case
from dime_ai.foundation_contracts import FoundationContractError
from dime_ai.tool_contracts import (
    BUNDLE_PATHS,
    TOOL_NAMES,
    compute_tool_contract_bundle_sha256,
    load_tool_contracts,
    validate_market_key,
    validate_tool_arguments,
)
from dime_ai.tool_contracts import (
    validate_tool_response as _validate_tool_response,
)

PROJECT = Path(__file__).resolve().parents[1]


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def response(
    tool_name: str = "get_current_odds",
    *,
    status: str = "ok",
    data: dict | None = None,
) -> dict:
    if data is None:
        data = {
            "event_ref": "synthetic-event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "market_phase": "pregame",
            "provider_scope": "synthetic_entitled",
            "quotes": [
                {
                    "selection": "home",
                    "line": "-2.5",
                    "price_american": -110,
                    "observed_at_utc": "2026-01-01T00:00:00Z",
                    "quote_status": "current",
                    "source_id": "synthetic-source-1",
                }
            ],
        }
    return {
        "schema_version": "dime-tool-response-v1",
        "tool_name": tool_name,
        "tool_version": "1.0.0",
        "tool_call_id": "call-1",
        "status": status,
        "as_of_utc": "2026-01-01T00:00:00Z",
        "valid_until_utc": (
            None
            if tool_name == "calculate_market_math"
            else "2026-01-01T00:05:00Z"
            if status in {"ok", "partial", "stale"}
            else None
        ),
        "source_ids": ["synthetic-source-1"] if data else [],
        "source_scope": {
            "scope_type": "provider_scoped",
            "provider_universe": ["synthetic-provider"],
            "coverage": "synthetic fixture",
        },
        "data": data,
        "quality_flags": [status] if status in {"partial", "stale"} else [],
        "warnings": [],
        "trace_id": "trace-1",
    }


def _arguments_for_response(value: dict, expected_tool_name: str) -> dict:
    data = value["data"]
    if expected_tool_name == "get_game_context":
        return {
            "event_id": data.get("event_ref", "event-1"),
            "fields": data.get("requested_fields", []),
        }
    if expected_tool_name == "get_current_odds":
        return {
            "event_id": data.get("event_ref", "synthetic-event-1"),
            "market_key": data.get(
                "market_key",
                {"market_type": "spread", "period": "full_game"},
            ),
            "mode": data.get("market_phase", "pregame"),
        }
    if expected_tool_name == "get_odds_history":
        return {
            "event_id": data.get("event_ref", "event-1"),
            "market_key": data.get(
                "market_key",
                {"market_type": "spread", "period": "full_game"},
            ),
            **(
                {"from_utc": data["requested_from_utc"]}
                if data.get("requested_from_utc") is not None
                else {}
            ),
            **(
                {"to_utc": data["requested_to_utc"]}
                if data.get("requested_to_utc") is not None
                else {}
            ),
        }
    if expected_tool_name == "get_market_splits":
        return {
            "event_id": data.get("event_ref", "event-1"),
            "market_key": data.get(
                "market_key",
                {"market_type": "spread", "period": "full_game"},
            ),
        }
    if expected_tool_name == "calculate_market_math":
        return {
            "operation": data.get("operation", "implied_probability"),
            "inputs": data.get("normalized_inputs", {"american_odds": -110}),
        }
    if expected_tool_name == "get_bet_tracker_summary":
        return {"filters": data.get("filters", {})}
    if expected_tool_name == "run_simulation":
        return {
            "event_id": data.get("event_ref", "event-1"),
            "draws": data.get("draws", 1000),
            "seed": data.get("seed", 1),
        }
    raise AssertionError(f"unsupported test tool {expected_tool_name}")


def validate_tool_response(
    value: dict,
    *,
    expected_tool_name: str,
    expected_call_id: str,
    expected_arguments: dict | None = None,
) -> None:
    _validate_tool_response(
        value,
        expected_tool_name=expected_tool_name,
        expected_call_id=expected_call_id,
        expected_arguments=(
            expected_arguments
            if expected_arguments is not None
            else _arguments_for_response(value, expected_tool_name)
        ),
    )


def assert_invalid(value: dict, match: str) -> None:
    with pytest.raises(FoundationContractError, match=match):
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )


def test_tool_contract_bundle_loads_with_exact_seven_tool_parity() -> None:
    bundle = load_tool_contracts()

    assert tuple(bundle.registry) == TOOL_NAMES
    assert tuple(item["function"]["name"] for item in bundle.request_catalog) == TOOL_NAMES
    assert tuple(bundle.file_sha256) == BUNDLE_PATHS
    assert len(bundle.bundle_sha256) == 64
    assert bundle.manifest_bytes.endswith(b"\n")


def test_canonical_market_key_accepts_only_closed_stable_identity() -> None:
    validate_market_key({"market_type": "spread", "period": "full_game"})
    for invalid in (
        "spread",
        {"market_type": "point_spread", "period": "full_game"},
        {"market_type": "player_prop", "period": "full_game"},
        {"market_type": "spread", "period": "first_half"},
        {"market_type": "spread", "period": "full_game", "provider_id": "book"},
        {"market_type": "spread", "period": "full_game", "line": "-2.5"},
        {"market_type": "spread", "period": "full_game", "user_id": "other"},
    ):
        with pytest.raises(FoundationContractError, match="market key"):
            validate_market_key(invalid)


def test_request_catalog_rejects_free_form_market_and_server_owned_fields() -> None:
    bundle = load_tool_contracts()
    validators = {
        item["function"]["name"]: Draft202012Validator(item["function"]["parameters"])
        for item in bundle.request_catalog
    }
    assert list(validators["get_current_odds"].iter_errors({"event_id": "e", "market": "spread"}))
    assert list(
        validators["get_market_splits"].iter_errors(
            {
                "event_id": "e",
                "market_key": {"market_type": "spread", "period": "full_game"},
                "provider_scope": "entitled_default",
            }
        )
    )
    assert list(
        validators["get_bet_tracker_summary"].iter_errors(
            {"user_scope": "self", "as_of_utc": "2026-01-01T00:00:00Z"}
        )
    )
    assert list(
        validators["run_simulation"].iter_errors(
            {
                "event_id": "e",
                "simulation_model_version": "caller-selected",
                "draws": 1000,
                "seed": 1,
            }
        )
    )


def test_complete_current_odds_response_is_accepted() -> None:
    validate_tool_response(
        response(), expected_tool_name="get_current_odds", expected_call_id="call-1"
    )


@pytest.mark.parametrize(
    ("mutation", "match"),
    [
        (lambda value: value.pop("tool_version"), "envelope"),
        (lambda value: value.update(tool_name="get_game_context"), "tool-name"),
        (lambda value: value.update(tool_call_id="wrong"), "tool-call"),
        (lambda value: value.update(tool_version="2.0.0"), "envelope"),
        (lambda value: value.update(extra="no"), "envelope"),
        (lambda value: value.update(as_of_utc="2026-01-01T00:00:00+00:00"), "envelope"),
        (
            lambda value: value.update(valid_until_utc="2025-12-31T23:59:59Z"),
            "validity interval",
        ),
    ],
)
def test_envelope_identity_version_unknown_and_freshness_fail_closed(mutation, match: str) -> None:
    value = response()
    mutation(value)
    assert_invalid(value, match)


def test_cross_tool_payload_and_incomplete_ok_fail_closed() -> None:
    value = response(tool_name="get_game_context")
    with pytest.raises(FoundationContractError, match="get_game_context response data"):
        validate_tool_response(
            value,
            expected_tool_name="get_game_context",
            expected_call_id="call-1",
        )
    value = response(data={})
    value["source_ids"] = []
    assert_invalid(value, "envelope")


def test_partial_stale_and_failure_statuses_are_disclosed_and_data_safe() -> None:
    value = response(status="partial")
    value["quality_flags"] = []
    assert_invalid(value, "envelope")

    value = response(status="stale")
    value["warnings"] = ["stale_pregame_quote"]
    assert_invalid(value, "masquerade as current")

    value = response(status="unauthorized")
    value["data"] = {"protected": "secret"}
    assert_invalid(value, "envelope")

    value = response(status="error", data={})
    value["warnings"] = ["/Users/caller/private/api_key.txt"]
    assert_invalid(value, "warnings")


def test_provider_data_requires_source_and_exact_payload_shape() -> None:
    value = response()
    value["source_ids"] = []
    assert_invalid(value, "requires source IDs")
    value = response()
    value["data"]["provider_payload"] = {"anything": "unsafe"}
    assert_invalid(value, "get_current_odds response data")


def test_history_requires_ordered_bounded_disclosed_pagination() -> None:
    value = response(
        "get_odds_history",
        data={
            "event_ref": "event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "requested_from_utc": None,
            "requested_to_utc": None,
            "returned_from_utc": "2026-01-01T00:00:00Z",
            "returned_to_utc": "2026-01-01T00:01:00Z",
            "snapshots": [
                {
                    "selection": "home",
                    "line": "-2.5",
                    "price_american": -110,
                    "observed_at_utc": "2026-01-01T00:01:00Z",
                    "source_id": "synthetic-source-1",
                },
                {
                    "selection": "home",
                    "line": "-3.0",
                    "price_american": -105,
                    "observed_at_utc": "2026-01-01T00:00:00Z",
                    "source_id": "synthetic-source-1",
                },
            ],
            "next_cursor": None,
            "truncated": False,
            "gap_flags": [],
        },
    )
    value["as_of_utc"] = "2026-01-01T00:01:00Z"
    with pytest.raises(FoundationContractError, match="chronological"):
        validate_tool_response(
            value,
            expected_tool_name="get_odds_history",
            expected_call_id="call-1",
        )
    value["data"]["snapshots"].reverse()
    value["data"]["truncated"] = True
    with pytest.raises(FoundationContractError, match="continuation cursor"):
        validate_tool_response(
            value,
            expected_tool_name="get_odds_history",
            expected_call_id="call-1",
        )


def test_splits_require_methodology_coverage_and_consistent_sample_disclosure() -> None:
    value = response(
        "get_market_splits",
        data={
            "event_ref": "event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "provider_universe": ["synthetic"],
            "methodology_version": "synthetic-v1",
            "observed_at_utc": "2026-01-01T00:00:00Z",
            "splits": [
                {"selection": "a", "ticket_pct": "40", "handle_pct": "60"},
                {"selection": "b", "ticket_pct": "60", "handle_pct": "40"},
            ],
            "sample_size": None,
            "sample_size_known": True,
            "coverage": "synthetic fixture",
            "coverage_type": "complete_market",
        },
    )
    with pytest.raises(FoundationContractError, match="sample-size"):
        validate_tool_response(
            value,
            expected_tool_name="get_market_splits",
            expected_call_id="call-1",
        )
    del value["data"]["methodology_version"]
    with pytest.raises(FoundationContractError, match="response data"):
        validate_tool_response(
            value,
            expected_tool_name="get_market_splits",
            expected_call_id="call-1",
        )


def test_math_requires_decimal_strings_and_operation_specific_output() -> None:
    value = response(
        "calculate_market_math",
        data={
            "operation": "implied_probability",
            "formula_version": "dime-market-math-v1",
            "normalized_inputs": {"american_odds": -110},
            "output": {"implied_probability": 0.5238},
        },
    )
    value["source_ids"] = []
    value["source_scope"] = {
        "scope_type": "deterministic",
        "provider_universe": [],
        "coverage": "deterministic calculation",
    }
    with pytest.raises(FoundationContractError, match="response data"):
        validate_tool_response(
            value,
            expected_tool_name="calculate_market_math",
            expected_call_id="call-1",
        )
    value["data"]["output"] = {"roi": "0.5238"}
    with pytest.raises(FoundationContractError, match="operation/output"):
        validate_tool_response(
            value,
            expected_tool_name="calculate_market_math",
            expected_call_id="call-1",
        )


def test_bet_tracker_rejects_raw_rows_and_cross_user_identity() -> None:
    data = {
        "subject_scope": "self",
        "filters": {"market_type": "spread"},
        "coverage": {"from_utc": None, "to_utc": "2026-01-01T00:00:00Z"},
        "bet_count": 1,
        "aggregates": {
            "stake_units": "1",
            "profit_units": "0",
            "roi": "0",
            "mean_probability_clv": None,
            "max_drawdown_units": None,
        },
        "sample_size_disclosure": "synthetic fixture",
        "raw_bets": [{"account_id": "other"}],
    }
    value = response("get_bet_tracker_summary", data=data)
    value["source_scope"]["scope_type"] = "authorized_private_aggregate"
    with pytest.raises(FoundationContractError, match="response data"):
        validate_tool_response(
            value,
            expected_tool_name="get_bet_tracker_summary",
            expected_call_id="call-1",
        )
    del data["raw_bets"]
    data["subject_scope"] = "other"
    with pytest.raises(FoundationContractError, match="response data"):
        validate_tool_response(
            value,
            expected_tool_name="get_bet_tracker_summary",
            expected_call_id="call-1",
        )


def test_simulation_requires_bounded_complete_immutable_provenance() -> None:
    value = response(
        "run_simulation",
        data={
            "event_ref": "event-1",
            "simulation_version": "approved-v1",
            "input_sha256": "a" * 64,
            "draws": 1000001,
            "seed": 1,
            "distribution": {
                "home_win_probability": "0.5",
                "margin_mean": "0",
                "p10": "-7",
                "p50": "0",
                "p90": "7",
            },
            "artifact_sha256": "b" * 64,
            "calibration_version": "calibration-v1",
            "run_at_utc": "2026-01-01T00:00:00Z",
            "limitations": ["synthetic fixture"],
        },
    )
    with pytest.raises(FoundationContractError, match="response data"):
        validate_tool_response(
            value,
            expected_tool_name="run_simulation",
            expected_call_id="call-1",
        )
    value["data"]["draws"] = 1000
    del value["data"]["artifact_sha256"]
    with pytest.raises(FoundationContractError, match="response data"):
        validate_tool_response(
            value,
            expected_tool_name="run_simulation",
            expected_call_id="call-1",
        )


def test_one_hash_change_alters_aggregate_bundle_identity() -> None:
    bundle = load_tool_contracts()
    changed = dict(bundle.file_sha256)
    changed[BUNDLE_PATHS[-1]] = "0" * 64

    assert compute_tool_contract_bundle_sha256(changed) != bundle.bundle_sha256


def test_registered_hash_path_and_remote_reference_fail_closed(
    project_copy: Path,
) -> None:
    path = project_copy / "schemas/tool_responses/get_game_context.data.schema.json"
    path.write_bytes(path.read_bytes() + b"\n")
    with pytest.raises(FoundationContractError, match="data-schema hash mismatch"):
        load_tool_contracts(project_root=project_copy)

    shutil.rmtree(project_copy)


def test_registry_traversal_path_is_rejected_without_opening_it(project_copy: Path) -> None:
    registry_path = project_copy / "tools/tool_response_registry.v1.json"
    registry = json.loads(registry_path.read_text())
    registry["tools"][0]["data_schema_path"] = "../outside.json"
    registry_path.write_text(json.dumps(registry))

    with pytest.raises(FoundationContractError, match="registry"):
        load_tool_contracts(project_root=project_copy)


def test_symlink_directory_duplicate_nonfinite_and_remote_ref_fail_closed(
    project_copy: Path,
) -> None:
    schema_path = project_copy / "schemas/tool_responses/get_game_context.data.schema.json"
    real_path = schema_path.with_suffix(".real")
    schema_path.rename(real_path)
    schema_path.symlink_to(real_path.name)
    with pytest.raises(FoundationContractError, match="symlink"):
        load_tool_contracts(project_root=project_copy)

    schema_path.unlink()
    real_path.rename(schema_path)
    schema_path.unlink()
    schema_path.mkdir()
    with pytest.raises(FoundationContractError, match="regular file"):
        load_tool_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    ("relative_path", "payload", "match"),
    [
        (
            "tools/market_keys.v1.json",
            b'{"schema_version":"x","schema_version":"y"}',
            "duplicate JSON key",
        ),
        (
            "tools/market_keys.v1.json",
            b'{"value":NaN}',
            "finite",
        ),
        (
            "schemas/tool_responses/get_game_context.data.schema.json",
            b'{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.invalid/schema"}',
            "local fragments",
        ),
    ],
)
def test_strict_json_and_local_schema_boundary(
    project_copy: Path, relative_path: str, payload: bytes, match: str
) -> None:
    (project_copy / relative_path).write_bytes(payload)
    with pytest.raises(FoundationContractError, match=match) as captured:
        load_tool_contracts(project_root=project_copy)
    assert str(project_copy) not in str(captured.value)


def test_registered_fifo_fails_without_blocking(project_copy: Path) -> None:
    fifo = project_copy / "tools/market_keys.v1.json"
    fifo.unlink()
    os.mkfifo(fifo)
    code = (
        "import sys\n"
        "from dime_ai.foundation_contracts import FoundationContractError\n"
        "from dime_ai.tool_contracts import load_tool_contracts\n"
        "try:\n"
        f"    load_tool_contracts(project_root={str(project_copy)!r})\n"
        "except FoundationContractError as exc:\n"
        "    print(f'FoundationContractError: {exc}', file=sys.stderr)\n"
        "    raise SystemExit(7)\n"
    )
    completed = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    assert completed.returncode != 0
    assert "expected a regular file" in completed.stderr
    assert str(project_copy) not in completed.stderr


def _eval_case_with_tool(tool_name: str) -> dict:
    for line in (PROJECT / "data/eval/dev.sample.jsonl").read_text().splitlines():
        case = json.loads(line)
        if any(
            fixture["tool"] == tool_name and fixture["returns"]["data"]
            for fixture in case["tool_fixtures"]
        ):
            case["tool_fixtures"] = [
                fixture
                for fixture in case["tool_fixtures"]
                if fixture["tool"] == tool_name and fixture["returns"]["data"]
            ]
            case["allowed_tools"] = [tool_name]
            case["gold"]["required_tool_calls"] = [tool_name]
            return case
    raise AssertionError(f"missing public fixture for {tool_name}")


@pytest.mark.parametrize(
    ("tool_name", "mutate"),
    [
        (
            "get_game_context",
            lambda fixture: fixture["returns"]["data"].update(event_ref="other-event"),
        ),
        (
            "get_current_odds",
            lambda fixture: fixture["returns"]["data"].update(
                market_key={"market_type": "total", "period": "full_game"}
            ),
        ),
        (
            "get_odds_history",
            lambda fixture: fixture["returns"]["data"].update(
                requested_from_utc="2026-07-25T10:00:00Z"
            ),
        ),
        (
            "get_market_splits",
            lambda fixture: fixture["returns"]["data"].update(event_ref="other-event"),
        ),
        (
            "calculate_market_math",
            lambda fixture: fixture["returns"]["data"]["normalized_inputs"].update(
                american_odds={"a": -120, "b": 100}
            ),
        ),
        (
            "get_bet_tracker_summary",
            lambda fixture: fixture["returns"]["data"].update(filters={}),
        ),
        (
            "run_simulation",
            lambda fixture: fixture["returns"]["data"].update(draws=50001),
        ),
    ],
)
def test_successful_result_must_echo_originating_call(tool_name: str, mutate) -> None:
    case = _eval_case_with_tool(tool_name)
    mutate(case["tool_fixtures"][0])

    with pytest.raises(DataValidationError, match="call arguments"):
        validate_eval_case(case)


@pytest.mark.parametrize(
    "schema_path",
    [
        "schemas/market_keys.schema.json",
        "schemas/tool_response_registry.schema.json",
    ],
)
def test_governing_schema_bytes_change_tool_bundle_hash(
    project_copy: Path, schema_path: str
) -> None:
    original = load_tool_contracts(project_root=project_copy)
    path = project_copy / schema_path
    path.write_bytes(path.read_bytes() + b"\n")
    changed = load_tool_contracts(project_root=project_copy)

    assert changed.bundle_sha256 != original.bundle_sha256


@pytest.mark.parametrize("american_odds", [0, 99, -99])
def test_probability_clv_rejects_invalid_american_odds(american_odds: int) -> None:
    catalog = json.loads(load_tool_contracts().raw_bytes["tools/tools.v1.json"])
    schema = next(
        item["function"]["parameters"]
        for item in catalog
        if item["function"]["name"] == "calculate_market_math"
    )
    arguments = {
        "operation": "probability_clv",
        "inputs": {
            "backed_selection": "a",
            "event_id": "event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "entry_market_odds": {"a": american_odds, "b": -110},
            "closing_market_odds": {"a": -110, "b": american_odds},
        },
    }

    assert list(Draft202012Validator(schema).iter_errors(arguments))


def test_market_splits_requires_selection_keyed_entries() -> None:
    case = _eval_case_with_tool("get_market_splits")
    del case["tool_fixtures"][0]["returns"]["data"]["splits"][0]["selection"]

    with pytest.raises(DataValidationError, match="required"):
        validate_eval_case(case)


@pytest.mark.parametrize(("ticket_pct", "handle_pct"), [("-1", "101"), ("101", "-1")])
def test_market_splits_percentages_are_bounded(ticket_pct: str, handle_pct: str) -> None:
    case = _eval_case_with_tool("get_market_splits")
    data = case["tool_fixtures"][0]["returns"]["data"]
    data["splits"][0]["ticket_pct"] = ticket_pct
    data["splits"][0]["handle_pct"] = handle_pct

    with pytest.raises(DataValidationError, match="ticket_pct|handle_pct"):
        validate_eval_case(case)


@pytest.mark.parametrize(
    ("tool_name", "mutate", "match"),
    [
        (
            "calculate_market_math",
            lambda data: data["output"].update(raw_probabilities={"a": "1.1", "b": "-0.1"}),
            "probability",
        ),
        (
            "get_current_odds",
            lambda data: data["quotes"][0].update(price_american=0),
            "price_american|American odds",
        ),
        (
            "run_simulation",
            lambda data: data["distribution"].update(p10="10", p50="0", p90="-10"),
            "quantile",
        ),
    ],
)
def test_impossible_numeric_response_values_fail(tool_name: str, mutate, match: str) -> None:
    case = _eval_case_with_tool(tool_name)
    mutate(case["tool_fixtures"][0]["returns"]["data"])

    with pytest.raises(DataValidationError, match=match):
        validate_eval_case(case)


def test_tool_incompatible_source_scope_fails() -> None:
    case = _eval_case_with_tool("calculate_market_math")
    scope = case["tool_fixtures"][0]["returns"]["source_scope"]
    scope["scope_type"] = "provider_scoped"
    scope["provider_universe"] = ["synthetic-provider"]

    with pytest.raises(DataValidationError, match="source scope"):
        validate_eval_case(case)


@pytest.mark.parametrize(
    ("tool_name", "mutate", "match"),
    [
        (
            "get_current_odds",
            lambda result: result["data"]["quotes"][0].update(
                observed_at_utc="2026-07-25T11:50:00Z"
            ),
            "observation",
        ),
        (
            "get_odds_history",
            lambda result: result["data"].update(
                requested_from_utc="2026-07-25T11:30:00Z",
                requested_to_utc="2026-07-25T11:00:00Z",
            ),
            "requested history",
        ),
        (
            "get_bet_tracker_summary",
            lambda result: result["data"]["coverage"].update(
                from_utc="2026-07-25T11:30:00Z",
                to_utc="2026-07-25T11:00:00Z",
            ),
            "coverage",
        ),
        (
            "run_simulation",
            lambda result: (
                result.update(
                    as_of_utc="2026-07-25T11:00:00Z",
                    valid_until_utc="2026-07-25T12:00:00Z",
                ),
                result["data"].update(run_at_utc="2026-07-25T11:30:00Z"),
            ),
            "run time",
        ),
    ],
)
def test_temporal_relationships_fail_closed(tool_name: str, mutate, match: str) -> None:
    case = _eval_case_with_tool(tool_name)
    mutate(case["tool_fixtures"][0]["returns"])
    if tool_name == "get_odds_history":
        case["tool_fixtures"][0]["arguments"].update(
            from_utc="2026-07-25T11:30:00Z",
            to_utc="2026-07-25T11:00:00Z",
        )

    with pytest.raises(DataValidationError, match=match):
        validate_eval_case(case)


def test_nested_server_owned_request_field_fails_bundle_loading(
    project_copy: Path,
) -> None:
    catalog_path = project_copy / "tools/tools.v1.json"
    catalog = json.loads(catalog_path.read_text())
    tracker = next(
        item for item in catalog if item["function"]["name"] == "get_bet_tracker_summary"
    )
    tracker["function"]["parameters"]["properties"]["filters"]["properties"]["account_id"] = {
        "type": "string"
    }
    catalog_bytes = json.dumps(catalog, indent=2).encode() + b"\n"
    catalog_path.write_bytes(catalog_bytes)
    registry_path = project_copy / "tools/tool_response_registry.v1.json"
    registry = json.loads(registry_path.read_text())
    registry["request_catalog_sha256"] = hashlib.sha256(catalog_bytes).hexdigest()
    registry_path.write_text(json.dumps(registry))

    with pytest.raises(FoundationContractError, match="server-owned"):
        load_tool_contracts(project_root=project_copy)


def test_nested_server_owned_math_input_fails_bundle_loading(
    project_copy: Path,
) -> None:
    catalog_path = project_copy / "tools/tools.v1.json"
    catalog = json.loads(catalog_path.read_text())
    math = next(item for item in catalog if item["function"]["name"] == "calculate_market_math")
    implied = math["function"]["parameters"]["oneOf"][0]
    implied["properties"]["inputs"]["properties"]["provider_scope"] = {"type": "string"}
    catalog_bytes = json.dumps(catalog, indent=2).encode() + b"\n"
    catalog_path.write_bytes(catalog_bytes)
    registry_path = project_copy / "tools/tool_response_registry.v1.json"
    registry = json.loads(registry_path.read_text())
    registry["request_catalog_sha256"] = hashlib.sha256(catalog_bytes).hexdigest()
    registry_path.write_text(json.dumps(registry))

    with pytest.raises(FoundationContractError, match="server-owned"):
        load_tool_contracts(project_root=project_copy)


def test_registry_classifications_cannot_be_swapped(project_copy: Path) -> None:
    registry_path = project_copy / "tools/tool_response_registry.v1.json"
    registry = json.loads(registry_path.read_text())
    first = registry["tools"][0]
    math = registry["tools"][4]
    first["execution_class"], math["execution_class"] = (
        math["execution_class"],
        first["execution_class"],
    )
    registry_path.write_text(json.dumps(registry))

    with pytest.raises(FoundationContractError, match="classification"):
        load_tool_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    "arguments",
    [
        {
            "operation": "roi",
            "inputs": {"profits": [1, -1], "stakes": [1]},
        },
        {
            "operation": "roi",
            "inputs": {"profits": [0, 0], "stakes": [0, 0]},
        },
        {
            "operation": "probability_clv",
            "inputs": {
                "backed_selection": "a",
                "event_id": "event-1",
                "market_key": {"market_type": "spread", "period": "full_game"},
                "entry_market_odds": {"a": -110, "b": -110},
                "closing_market_odds": {"a": -110, "c": 100},
            },
        },
        {
            "operation": "probability_clv",
            "inputs": {
                "backed_selection": "missing",
                "event_id": "event-1",
                "market_key": {"market_type": "spread", "period": "full_game"},
                "entry_market_odds": {"a": -110, "b": -110},
                "closing_market_odds": {"a": -110, "b": 100},
            },
        },
    ],
)
def test_market_math_request_cross_field_semantics(arguments: dict) -> None:
    with pytest.raises(FoundationContractError, match="ROI|probability-CLV|backed"):
        validate_tool_arguments("calculate_market_math", arguments)


@pytest.mark.parametrize(
    ("operation", "output", "match"),
    [
        (
            "implied_probability",
            {"implied_probability": "1.01"},
            "probability",
        ),
        (
            "expected_value",
            {
                "decimal_odds": "1",
                "expected_profit_per_unit": "0",
                "expected_roi": "0",
            },
            "decimal odds",
        ),
        (
            "probability_clv",
            {
                "entry_no_vig_probability": "0.5",
                "closing_no_vig_probability": "0.5",
                "probability_clv": "-1.01",
            },
            "probability CLV",
        ),
    ],
)
def test_market_math_response_numeric_domains(operation: str, output: dict, match: str) -> None:
    inputs = {
        "implied_probability": {"american_odds": -110},
        "expected_value": {"american_odds": -110, "probability": 0.5},
        "probability_clv": {
            "backed_selection": "a",
            "event_id": "event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "entry_market_odds": {"a": -110, "b": -110},
            "closing_market_odds": {"a": -110, "b": 100},
        },
    }[operation]
    value = response(
        "calculate_market_math",
        data={
            "operation": operation,
            "formula_version": "dime-market-math-v1",
            "normalized_inputs": inputs,
            "output": output,
        },
    )
    value["source_ids"] = []
    value["source_scope"] = {
        "scope_type": "deterministic",
        "provider_universe": [],
        "coverage": "deterministic calculation",
    }
    with pytest.raises(FoundationContractError, match=match):
        validate_tool_response(
            value,
            expected_tool_name="calculate_market_math",
            expected_call_id="call-1",
            expected_arguments={"operation": operation, "inputs": inputs},
        )


MATH_RECOMPUTATION_CASES = (
    (
        "implied_probability",
        {"american_odds": -110},
        {"implied_probability": "0.5238095238"},
        {"implied_probability": "0.5"},
    ),
    (
        "remove_vig",
        {"american_odds": {"a": -110, "b": -110}},
        {
            "raw_probabilities": {"a": "0.5238095238", "b": "0.5238095238"},
            "hold": "0.0476190476",
            "no_vig_probabilities": {"a": "0.5", "b": "0.5"},
        },
        {
            "raw_probabilities": {"a": "0.5", "b": "0.5"},
            "hold": "0",
            "no_vig_probabilities": {"a": "0.5", "b": "0.5"},
        },
    ),
    (
        "market_hold",
        {"american_odds": {"a": -110, "b": -110}},
        {
            "raw_probabilities": {"a": "0.5238095238", "b": "0.5238095238"},
            "hold": "0.0476190476",
        },
        {
            "raw_probabilities": {"a": "0.5", "b": "0.5"},
            "hold": "0",
        },
    ),
    (
        "expected_value",
        {"american_odds": -110, "probability": 0.55},
        {
            "decimal_odds": "1.9090909091",
            "expected_profit_per_unit": "0.05",
            "expected_roi": "0.05",
        },
        {
            "decimal_odds": "2",
            "expected_profit_per_unit": "0.1",
            "expected_roi": "0.1",
        },
    ),
    (
        "settled_profit",
        {"stake": 2, "american_odds": -110, "result": "win"},
        {
            "decimal_odds": "1.9090909091",
            "settled_profit": "1.8181818182",
        },
        {
            "decimal_odds": "2",
            "settled_profit": "2",
        },
    ),
    (
        "roi",
        {"profits": [1, -0.5], "stakes": [1, 1]},
        {"roi": "0.25"},
        {"roi": "0.1"},
    ),
    (
        "probability_clv",
        {
            "backed_selection": "a",
            "event_id": "event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "entry_market_odds": {"a": -110, "b": -110},
            "closing_market_odds": {"a": -130, "b": 110},
        },
        {
            "entry_no_vig_probability": "0.5",
            "closing_no_vig_probability": "0.5427435388",
            "probability_clv": "0.0427435388",
        },
        {
            "entry_no_vig_probability": "0.5",
            "closing_no_vig_probability": "0.5",
            "probability_clv": "0",
        },
    ),
)


def _market_math_response(operation: str, inputs: dict, output: dict) -> dict:
    value = response(
        "calculate_market_math",
        data={
            "operation": operation,
            "formula_version": "dime-market-math-v1",
            "normalized_inputs": inputs,
            "output": output,
        },
    )
    value["source_ids"] = []
    value["source_scope"] = {
        "scope_type": "deterministic",
        "provider_universe": [],
        "coverage": "deterministic calculation",
    }
    return value


@pytest.mark.parametrize(
    ("operation", "inputs", "correct_output", "incorrect_output"),
    MATH_RECOMPUTATION_CASES,
)
def test_market_math_outputs_are_independently_recomputed(
    operation: str,
    inputs: dict,
    correct_output: dict,
    incorrect_output: dict,
) -> None:
    validate_tool_response(
        _market_math_response(operation, inputs, correct_output),
        expected_tool_name="calculate_market_math",
        expected_call_id="call-1",
        expected_arguments={"operation": operation, "inputs": inputs},
    )

    with pytest.raises(FoundationContractError, match="recomputation"):
        validate_tool_response(
            _market_math_response(operation, inputs, incorrect_output),
            expected_tool_name="calculate_market_math",
            expected_call_id="call-1",
            expected_arguments={"operation": operation, "inputs": inputs},
        )


@pytest.mark.parametrize(
    ("operation", "inputs", "_correct_output", "incorrect_output"),
    MATH_RECOMPUTATION_CASES,
)
def test_development_eval_market_math_outputs_are_independently_recomputed(
    operation: str,
    inputs: dict,
    _correct_output: dict,
    incorrect_output: dict,
) -> None:
    case = _eval_case_with_tool("calculate_market_math")
    fixture = case["tool_fixtures"][0]
    fixture["arguments"] = {"operation": operation, "inputs": inputs}
    fixture["returns"]["data"] = {
        "operation": operation,
        "formula_version": "dime-market-math-v1",
        "normalized_inputs": inputs,
        "output": incorrect_output,
    }

    with pytest.raises(DataValidationError, match="recomputation"):
        validate_eval_case(case)


@pytest.mark.parametrize(
    ("mutation", "match"),
    [
        (
            lambda data: data["splits"].append(
                {"selection": "side_a", "ticket_pct": "0", "handle_pct": "0"}
            ),
            "unique",
        ),
        (
            lambda data: data["splits"][0].update(ticket_pct="39"),
            "total 100",
        ),
        (
            lambda data: data.update(coverage_type="partial_market"),
            "incomplete split coverage",
        ),
        (
            lambda data: data["splits"][0].update(price_american=99),
            "price_american|American odds",
        ),
        (
            lambda data: data.update(provider_universe=["different-provider"]),
            "provider identities",
        ),
    ],
)
def test_market_split_semantics_are_fail_closed(mutation, match: str) -> None:
    case = _eval_case_with_tool("get_market_splits")
    fixture = case["tool_fixtures"][0]
    mutation(fixture["returns"]["data"])
    with pytest.raises(DataValidationError, match=match):
        validate_eval_case(case)


def test_game_context_default_and_returned_missing_fields_are_bound() -> None:
    value = response(
        "get_game_context",
        data={
            "event_ref": "event-1",
            "requested_fields": [
                "schedule",
                "teams",
                "rosters",
                "injuries",
                "result",
                "live_state",
            ],
            "facts": {"period": "Q1"},
            "missing_fields": ["live_state"],
        },
    )
    with pytest.raises(FoundationContractError, match="contradict"):
        validate_tool_response(
            value,
            expected_tool_name="get_game_context",
            expected_call_id="call-1",
            expected_arguments={"event_id": "event-1"},
        )


@pytest.mark.parametrize(
    ("quote_status", "status", "quality_flags", "match"),
    [
        ("stale", "partial", ["partial"], "stale disclosure"),
        ("suspended", "partial", ["partial"], "suspension disclosure"),
    ],
)
def test_current_odds_partial_quote_status_requires_disclosure(
    quote_status: str, status: str, quality_flags: list[str], match: str
) -> None:
    value = response(status=status)
    value["data"]["quotes"][0]["quote_status"] = quote_status
    value["quality_flags"] = quality_flags
    if quote_status == "stale":
        value["warnings"] = ["stale_pregame_quote"]
    with pytest.raises(FoundationContractError, match=match):
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )


@pytest.mark.parametrize(
    ("mutation", "match"),
    [
        (
            lambda data: data.update(
                returned_from_utc="2026-01-01T00:02:00Z",
                returned_to_utc="2026-01-01T00:01:00Z",
            ),
            "returned history window",
        ),
        (
            lambda data: data["snapshots"][0].update(observed_at_utc="2025-12-31T23:59:00Z"),
            "outside returned interval",
        ),
        (
            lambda data: (
                data.update(returned_to_utc="2026-01-01T00:03:00Z"),
                data["snapshots"][0].update(observed_at_utc="2026-01-01T00:03:00Z"),
            ),
            "after as_of",
        ),
        (
            lambda data: data.update(snapshots=[]),
            "empty history",
        ),
        (
            lambda data: data.update(next_cursor="false-claim"),
            "complete history",
        ),
    ],
)
def test_history_temporal_bounds_and_cursor_claims_fail_closed(mutation, match: str) -> None:
    value = response(
        "get_odds_history",
        data={
            "event_ref": "event-1",
            "market_key": {"market_type": "spread", "period": "full_game"},
            "requested_from_utc": None,
            "requested_to_utc": None,
            "returned_from_utc": "2026-01-01T00:00:00Z",
            "returned_to_utc": "2026-01-01T00:01:00Z",
            "snapshots": [
                {
                    "selection": "home",
                    "line": "-2.5",
                    "price_american": -110,
                    "observed_at_utc": "2026-01-01T00:01:00Z",
                    "source_id": "synthetic-source-1",
                }
            ],
            "next_cursor": None,
            "truncated": False,
            "gap_flags": [],
        },
    )
    value["as_of_utc"] = "2026-01-01T00:02:00Z"
    mutation(value["data"])
    with pytest.raises(FoundationContractError, match=match):
        validate_tool_response(
            value,
            expected_tool_name="get_odds_history",
            expected_call_id="call-1",
        )


def test_history_count_obeys_originating_limit() -> None:
    case = _eval_case_with_tool("get_odds_history")
    fixture = case["tool_fixtures"][0]
    fixture["arguments"]["limit"] = 1
    fixture["returns"]["data"]["snapshots"].append(dict(fixture["returns"]["data"]["snapshots"][0]))
    with pytest.raises(DataValidationError, match="history count"):
        validate_eval_case(case)


@pytest.mark.parametrize(
    ("tool_name", "mutation", "match"),
    [
        (
            "get_market_splits",
            lambda result: result["data"].update(observed_at_utc="2099-01-01T00:00:00Z"),
            "market-splits observation",
        ),
        (
            "get_bet_tracker_summary",
            lambda result: result["data"]["coverage"].update(to_utc="2099-01-01T00:00:00Z"),
            "coverage ends",
        ),
        (
            "run_simulation",
            lambda result: result["data"]["distribution"].update(home_win_probability="1.01"),
            "simulation probability",
        ),
        (
            "get_bet_tracker_summary",
            lambda result: result["data"]["aggregates"].update(stake_units="0"),
            "positive total stake",
        ),
    ],
)
def test_remaining_numeric_and_temporal_relationships_fail_closed(
    tool_name: str, mutation, match: str
) -> None:
    case = _eval_case_with_tool(tool_name)
    mutation(case["tool_fixtures"][0]["returns"])
    with pytest.raises(DataValidationError, match=match):
        validate_eval_case(case)


def test_history_snapshot_source_must_belong_to_envelope_without_reflection() -> None:
    case = _eval_case_with_tool("get_odds_history")
    result = case["tool_fixtures"][0]["returns"]
    envelope_source = result["source_ids"][0]
    untrusted_source = "UNTRUSTED_HISTORY_SOURCE_MARKER"
    result["data"]["snapshots"][0]["source_id"] = untrusted_source

    with pytest.raises(DataValidationError, match="source") as captured:
        validate_eval_case(case)
    assert envelope_source not in str(captured.value)
    assert untrusted_source not in str(captured.value)


def test_current_quote_requires_deterministic_source_attribution() -> None:
    case = _eval_case_with_tool("get_current_odds")
    quote = case["tool_fixtures"][0]["returns"]["data"]["quotes"][0]
    quote.pop("source_id", None)

    with pytest.raises(DataValidationError, match="source|required"):
        validate_eval_case(case)


def test_current_quote_source_must_belong_to_envelope_without_reflection() -> None:
    case = _eval_case_with_tool("get_current_odds")
    result = case["tool_fixtures"][0]["returns"]
    envelope_source = result["source_ids"][0]
    untrusted_source = "UNTRUSTED_CURRENT_SOURCE_MARKER"
    result["data"]["quotes"][0]["source_id"] = untrusted_source

    with pytest.raises(DataValidationError, match="source") as captured:
        validate_eval_case(case)
    assert envelope_source not in str(captured.value)
    assert untrusted_source not in str(captured.value)


@pytest.mark.parametrize(
    "unsafe_warning",
    [
        "/Users/caller/private/api_key.txt",
        "/workspace/secrets/provider-token.txt",
        r"C:\Users\caller\secret.txt",
        "hf_" + "A" * 32,
        "ghp_" + "B" * 32,
        "Bearer " + "C" * 32,
        "rpa_" + "D" * 32,
        "postgresql://candidate:" + "synthetic-password" + "@db.example.test/sports",
    ],
)
def test_success_warning_vocabulary_rejects_unsafe_text(unsafe_warning: str) -> None:
    value = response()
    value["warnings"] = [unsafe_warning]

    with pytest.raises(FoundationContractError, match="warning"):
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
            expected_arguments={
                "event_id": "synthetic-event-1",
                "market_key": {"market_type": "spread", "period": "full_game"},
            },
        )


@pytest.mark.parametrize(
    "tool_name",
    [
        "get_game_context",
        "get_odds_history",
        "get_market_splits",
        "calculate_market_math",
        "get_bet_tracker_summary",
        "run_simulation",
    ],
)
@pytest.mark.parametrize(
    "warning",
    ["current_quote_unavailable", "stale_pregame_quote"],
)
def test_odds_warnings_are_rejected_for_non_current_odds_tools(
    tool_name: str,
    warning: str,
) -> None:
    case = _eval_case_with_tool(tool_name)
    case["tool_fixtures"][0]["returns"]["warnings"] = [warning]

    with pytest.raises(DataValidationError, match="warning"):
        validate_eval_case(case)


@pytest.mark.parametrize(
    "warning",
    ["current_quote_unavailable", "stale_pregame_quote"],
)
def test_complete_current_odds_rejects_contradictory_warning(warning: str) -> None:
    value = response()
    value["warnings"] = [warning]

    with pytest.raises(FoundationContractError, match="warning"):
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )


@pytest.mark.parametrize(
    ("status", "warnings"),
    [
        ("not_found", []),
        ("not_found", ["stale_pregame_quote"]),
        ("stale", []),
        ("stale", ["current_quote_unavailable"]),
        ("unauthorized", ["current_quote_unavailable"]),
        ("blocked_by_policy", ["current_quote_unavailable"]),
        ("error", ["current_quote_unavailable"]),
    ],
)
def test_current_odds_status_requires_exact_warning_semantics(
    status: str,
    warnings: list[str],
) -> None:
    if status in {"not_found", "unauthorized", "blocked_by_policy", "error"}:
        value = response(status=status, data={})
        value["source_ids"] = []
    else:
        value = response(status=status)
        value["data"]["quotes"][0]["quote_status"] = "stale"
    value["warnings"] = warnings

    with pytest.raises(FoundationContractError, match="warning"):
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )


def test_current_odds_status_accepts_exact_warning_semantics() -> None:
    missing = response(status="not_found", data={})
    missing["source_ids"] = []
    missing["warnings"] = ["current_quote_unavailable"]
    validate_tool_response(
        missing,
        expected_tool_name="get_current_odds",
        expected_call_id="call-1",
    )

    stale = response(status="stale")
    stale["data"]["quotes"][0]["quote_status"] = "stale"
    stale["warnings"] = ["stale_pregame_quote"]
    validate_tool_response(
        stale,
        expected_tool_name="get_current_odds",
        expected_call_id="call-1",
    )

    partial = response(status="partial")
    partial["data"]["quotes"][0]["quote_status"] = "stale"
    partial["quality_flags"] = ["partial", "stale"]
    partial["warnings"] = ["stale_pregame_quote"]
    validate_tool_response(
        partial,
        expected_tool_name="get_current_odds",
        expected_call_id="call-1",
    )


def test_partial_current_odds_warning_tracks_stale_quote_presence() -> None:
    missing = response(status="partial")
    missing["data"]["quotes"][0]["quote_status"] = "stale"
    missing["quality_flags"] = ["partial", "stale"]
    with pytest.raises(FoundationContractError, match="warning"):
        validate_tool_response(
            missing,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )

    contradictory = response(status="partial")
    contradictory["warnings"] = ["stale_pregame_quote"]
    with pytest.raises(FoundationContractError, match="warning"):
        validate_tool_response(
            contradictory,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )


@pytest.mark.parametrize(
    "status",
    [
        "ok",
        "partial",
        "stale",
        "not_found",
        "unauthorized",
        "blocked_by_policy",
        "error",
    ],
)
def test_every_status_rejects_unsafe_warning_text(status: str) -> None:
    if status in {"not_found", "unauthorized", "blocked_by_policy", "error"}:
        value = response(status=status, data={})
        value["source_ids"] = []
    else:
        value = response(status=status)
        if status == "stale":
            value["data"]["quotes"][0]["quote_status"] = "stale"
    value["warnings"] = ["hf_" + "W" * 32]

    with pytest.raises(FoundationContractError, match="warning"):
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
            expected_arguments={
                "event_id": "synthetic-event-1",
                "market_key": {"market_type": "spread", "period": "full_game"},
            },
        )


@pytest.mark.parametrize(
    ("argument_mutation", "marker"),
    [
        (
            lambda marker: {"operation": marker, "inputs": {}},
            "UNTRUSTED_ENUM_VALUE_MARKER",
        ),
        (
            lambda marker: {
                "event_id": marker + "X" * 256,
                "market_key": {"market_type": "spread", "period": "full_game"},
            },
            "UNTRUSTED_OVERLONG_VALUE_MARKER",
        ),
        (
            lambda marker: {
                "event_id": "event-1",
                "market_key": {"market_type": "spread", "period": "full_game"},
                marker: "value",
            },
            "UNTRUSTED_PROPERTY_NAME_MARKER",
        ),
    ],
)
def test_request_schema_errors_do_not_reflect_untrusted_content(
    argument_mutation, marker: str
) -> None:
    tool_name = (
        "calculate_market_math" if marker == "UNTRUSTED_ENUM_VALUE_MARKER" else "get_current_odds"
    )
    with pytest.raises(FoundationContractError) as captured:
        validate_tool_arguments(tool_name, argument_mutation(marker))
    message = str(captured.value)
    assert marker not in message
    assert len(message) <= 2048
    assert tool_name in message
    assert "validation" in message


def test_dynamic_mapping_key_is_not_reflected_by_response_validation() -> None:
    marker = "UNTRUSTED/DYNAMIC/MAPPING/KEY"
    inputs = {"american_odds": {marker: -110, "side_b": -110}}
    value = response(
        "calculate_market_math",
        data={
            "operation": "remove_vig",
            "formula_version": "dime-market-math-v1",
            "normalized_inputs": inputs,
            "output": {
                "raw_probabilities": {"side_a": "0.5", "side_b": "0.5"},
                "hold": "0",
                "no_vig_probabilities": {"side_a": "0.5", "side_b": "0.5"},
            },
        },
    )
    value["source_ids"] = []
    value["source_scope"] = {
        "scope_type": "deterministic",
        "provider_universe": [],
        "coverage": "deterministic calculation",
    }

    with pytest.raises(FoundationContractError) as captured:
        validate_tool_response(
            value,
            expected_tool_name="calculate_market_math",
            expected_call_id="call-1",
            expected_arguments={"operation": "remove_vig", "inputs": inputs},
        )
    message = str(captured.value)
    assert marker not in message
    assert len(message) <= 2048
    assert "calculate_market_math response data" in message
    assert "validation" in message


def test_nested_response_value_is_not_reflected_by_validation() -> None:
    marker = "UNTRUSTED_NESTED_RESPONSE_MARKER"
    value = response()
    value["data"]["quotes"][0]["quote_status"] = marker

    with pytest.raises(FoundationContractError) as captured:
        validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
            expected_arguments={
                "event_id": "synthetic-event-1",
                "market_key": {"market_type": "spread", "period": "full_game"},
            },
        )
    message = str(captured.value)
    assert marker not in message
    assert len(message) <= 2048
    assert "get_current_odds response data" in message
    assert "validation" in message


@pytest.mark.parametrize("escape", ["before", "after"])
def test_history_returned_interval_cannot_escape_requested_scope(escape: str) -> None:
    case = _eval_case_with_tool("get_odds_history")
    fixture = case["tool_fixtures"][0]
    arguments = fixture["arguments"]
    data = fixture["returns"]["data"]
    if escape == "before":
        arguments.update(
            from_utc="2026-07-25T11:50:00Z",
            to_utc="2026-07-25T12:00:00Z",
        )
        data.update(
            requested_from_utc=arguments["from_utc"],
            requested_to_utc=arguments["to_utc"],
            returned_from_utc="2026-07-25T11:40:00Z",
        )
    else:
        arguments.update(
            from_utc="2026-07-25T11:00:00Z",
            to_utc="2026-07-25T11:50:00Z",
        )
        data.update(
            requested_from_utc=arguments["from_utc"],
            requested_to_utc=arguments["to_utc"],
            returned_to_utc="2026-07-25T11:58:00Z",
        )

    with pytest.raises(DataValidationError, match="requested"):
        validate_eval_case(case)


@pytest.mark.parametrize("escape", ["before", "after", "future_open_end"])
def test_tracker_coverage_cannot_escape_requested_filters(escape: str) -> None:
    case = _eval_case_with_tool("get_bet_tracker_summary")
    fixture = case["tool_fixtures"][0]
    filters = fixture["arguments"]["filters"]
    filters.update(
        from_utc="2026-07-25T10:00:00Z",
        to_utc="2026-07-25T11:00:00Z",
    )
    fixture["returns"]["data"]["filters"] = dict(filters)
    coverage = fixture["returns"]["data"]["coverage"]
    if escape == "before":
        coverage.update(
            from_utc="2026-07-25T09:59:00Z",
            to_utc="2026-07-25T11:00:00Z",
        )
    elif escape == "after":
        coverage.update(
            from_utc="2026-07-25T10:00:00Z",
            to_utc="2026-07-25T11:01:00Z",
        )
    else:
        coverage.update(from_utc="2026-07-25T12:01:00Z", to_utc=None)

    with pytest.raises(DataValidationError, match="coverage"):
        validate_eval_case(case)


def test_validate_tool_response_requires_originating_arguments() -> None:
    value = response()
    value["data"]["event_ref"] = "mismatched-event"

    with pytest.raises(TypeError):
        _validate_tool_response(
            value,
            expected_tool_name="get_current_odds",
            expected_call_id="call-1",
        )


def test_tracker_zero_count_cannot_claim_positive_aggregates() -> None:
    case = _eval_case_with_tool("get_bet_tracker_summary")
    case["tool_fixtures"][0]["returns"]["data"]["bet_count"] = 0

    with pytest.raises(DataValidationError, match="bet_count|bet count"):
        validate_eval_case(case)


def test_tracker_roi_must_match_profit_divided_by_stake() -> None:
    case = _eval_case_with_tool("get_bet_tracker_summary")
    case["tool_fixtures"][0]["returns"]["data"]["aggregates"]["roi"] = "0.31"

    with pytest.raises(DataValidationError, match="ROI"):
        validate_eval_case(case)


def test_market_splits_rejects_known_zero_sample() -> None:
    case = _eval_case_with_tool("get_market_splits")
    data = case["tool_fixtures"][0]["returns"]["data"]
    data["sample_size"] = 0
    data["sample_size_known"] = True

    with pytest.raises(DataValidationError, match="sample_size|sample size"):
        validate_eval_case(case)


def test_market_splits_accepts_positive_or_unknown_sample() -> None:
    known = _eval_case_with_tool("get_market_splits")
    known_data = known["tool_fixtures"][0]["returns"]["data"]
    known_data["sample_size"] = 1
    known_data["sample_size_known"] = True
    validate_eval_case(known)

    unknown = _eval_case_with_tool("get_market_splits")
    unknown_data = unknown["tool_fixtures"][0]["returns"]["data"]
    unknown_data["sample_size"] = None
    unknown_data["sample_size_known"] = False
    validate_eval_case(unknown)
