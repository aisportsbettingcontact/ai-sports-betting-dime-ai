import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from dime_ai.foundation_control import validate_execution_gates

PROJECT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = PROJECT / "configs/model_execution_gates_v1.json"
SCHEMA_PATH = PROJECT / "schemas/model_execution_gates.schema.json"

CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA)

PathPart = str | int
ObjectPath = tuple[PathPart, ...]

AUTHORIZATION_KEYS = tuple(CONTRACT["authorization_boundary"])
GATE_3_PREREQUISITES = tuple(CONTRACT["runpod_gates"]["gate_3_full_candidate_c"]["prerequisites"])
UNRESOLVED_SHARED_TUPLE_FIELDS = (
    "base_model",
    "base_revision",
    "tokenizer_revision",
    "container_digest",
    "retrieval_revision",
    "evaluation_revisions",
)
SENSITIVE_FALSE_FLAG_PATHS: tuple[ObjectPath, ...] = (
    ("base_vs_instruct", "serialization_profiles_declared"),
    (
        "base_vs_instruct",
        "base_allows_instruction_tool_calibration_or_conversation_regression",
    ),
    ("base_vs_instruct", "execution_authorized"),
    ("candidate_ab", "candidate_a_complete"),
    ("candidate_ab", "candidate_b_complete"),
    ("candidate_ab", "execution_authorized"),
    ("early_stopping_preflight", "best_checkpoint_restoration_verified"),
    ("runpod_gates", "gate_1_baseline_inference", "authorized"),
    ("runpod_gates", "gate_2_smoke_training", "authorized"),
    ("runpod_gates", "gate_2_smoke_training", "serving_authorized"),
    ("runpod_gates", "gate_3_full_candidate_c", "authorized"),
    *(
        ("runpod_gates", "gate_3_full_candidate_c", "prerequisites", key)
        for key in GATE_3_PREREQUISITES
    ),
    ("candidate_c_selection", "selection_authorized"),
    *(("authorization_boundary", key) for key in AUTHORIZATION_KEYS),
)
NESTED_OBJECT_PATHS: tuple[ObjectPath, ...] = (
    (),
    ("base_vs_instruct",),
    ("candidate_ab",),
    ("candidate_ab", "shared_tuple"),
    ("candidate_ab", "candidates", 0),
    ("candidate_ab", "candidates", 1),
    ("early_stopping_preflight",),
    ("runpod_gates",),
    ("runpod_gates", "gate_1_baseline_inference"),
    ("runpod_gates", "gate_2_smoke_training"),
    ("runpod_gates", "gate_3_full_candidate_c"),
    ("runpod_gates", "gate_3_full_candidate_c", "prerequisites"),
    ("candidate_c_selection",),
    ("candidate_c_selection", "thresholds"),
    ("authorization_boundary",),
)
EXACT_LIST_PATHS: tuple[ObjectPath, ...] = (
    ("candidate_ab", "candidates"),
    ("early_stopping_preflight", "calculation_inputs"),
    ("runpod_gates", "gate_1_baseline_inference", "allows"),
    ("runpod_gates", "gate_1_baseline_inference", "prohibits"),
    ("runpod_gates", "gate_1_baseline_inference", "required_outputs"),
    ("candidate_c_selection", "required_analyses"),
)
EXACT_CONTROL_MUTATIONS: tuple[tuple[ObjectPath, Any], ...] = (
    (("candidate_ab", "shared_tuple", "random_seed"), 1730),
    (("early_stopping_preflight", "minimum_validation_events"), 5),
    (("runpod_gates", "gate_2_smoke_training", "records"), 65),
    (("runpod_gates", "gate_2_smoke_training", "maximum_steps"), 11),
    (("runpod_gates", "gate_2_smoke_training", "maximum_gpu_minutes"), 31),
    (("runpod_gates", "gate_2_smoke_training", "rehearsal_records_after_smoke_pass"), 241),
    (
        (
            "candidate_c_selection",
            "thresholds",
            "factual_correctness_delta_over_b_minimum",
        ),
        0.01,
    ),
    (
        (
            "candidate_c_selection",
            "thresholds",
            "critical_hard_gate_failures_maximum",
        ),
        1,
    ),
    (
        (
            "candidate_c_selection",
            "thresholds",
            "protected_route_regressions_maximum",
        ),
        1,
    ),
    (
        (
            "candidate_c_selection",
            "thresholds",
            "general_capability_material_regressions_maximum",
        ),
        1,
    ),
    (
        (
            "candidate_c_selection",
            "thresholds",
            "p95_latency_increase_over_b_maximum",
        ),
        0.16,
    ),
    (
        (
            "candidate_c_selection",
            "thresholds",
            "adapter_size_bytes_maximum",
        ),
        104857601,
    ),
)


def _at(value: Any, path: ObjectPath) -> Any:
    for part in path:
        value = value[part]
    return value


def _parent(value: Any, path: ObjectPath) -> Any:
    return _at(value, path[:-1])


def _schema_errors(value: object) -> list[object]:
    return list(VALIDATOR.iter_errors(value))


def _path_id(path: ObjectPath) -> str:
    return ".".join(str(part) for part in path) or "root"


def _boolean_paths(value: Any, path: ObjectPath = ()) -> tuple[ObjectPath, ...]:
    if isinstance(value, bool):
        return (path,)
    if isinstance(value, dict):
        return tuple(
            nested for key, item in value.items() for nested in _boolean_paths(item, (*path, key))
        )
    if isinstance(value, list):
        return tuple(
            nested
            for index, item in enumerate(value)
            for nested in _boolean_paths(item, (*path, index))
        )
    return ()


BOOLEAN_PATHS = _boolean_paths(CONTRACT)


def test_frozen_execution_contract_matches_closed_world_schema() -> None:
    Draft202012Validator.check_schema(SCHEMA)
    assert _schema_errors(CONTRACT) == []
    assert validate_execution_gates(CONTRACT) == []


@pytest.mark.parametrize("path", BOOLEAN_PATHS, ids=_path_id)
def test_schema_rejects_every_boolean_flip(path: ObjectPath) -> None:
    mutated = deepcopy(CONTRACT)
    parent = _parent(mutated, path)
    parent[path[-1]] = not parent[path[-1]]

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)


@pytest.mark.parametrize("path", SENSITIVE_FALSE_FLAG_PATHS, ids=_path_id)
def test_schema_rejects_every_omitted_sensitive_false_flag(path: ObjectPath) -> None:
    mutated = deepcopy(CONTRACT)
    del _parent(mutated, path)[path[-1]]

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)


@pytest.mark.parametrize("key", AUTHORIZATION_KEYS)
def test_schema_rejects_every_omitted_authorization_boundary_key(key: str) -> None:
    mutated = deepcopy(CONTRACT)
    del mutated["authorization_boundary"][key]

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)


@pytest.mark.parametrize("key", UNRESOLVED_SHARED_TUPLE_FIELDS)
def test_schema_preserves_every_unresolved_shared_tuple_null(key: str) -> None:
    mutated = deepcopy(CONTRACT)
    mutated["candidate_ab"]["shared_tuple"][key] = "prematurely-resolved"

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)


@pytest.mark.parametrize("path", NESTED_OBJECT_PATHS, ids=_path_id)
def test_every_execution_gate_object_is_closed_world(path: ObjectPath) -> None:
    mutated = deepcopy(CONTRACT)
    _at(mutated, path)["unexpected_control"] = False

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)


@pytest.mark.parametrize("path", EXACT_LIST_PATHS, ids=_path_id)
def test_gate_lists_are_exact_and_ordered(path: ObjectPath) -> None:
    mutated = deepcopy(CONTRACT)
    _at(mutated, path).append("unexpected_control")

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)


@pytest.mark.parametrize(
    ("path", "replacement"),
    EXACT_CONTROL_MUTATIONS,
    ids=(_path_id(path) for path, _replacement in EXACT_CONTROL_MUTATIONS),
)
def test_gate_limits_and_selection_thresholds_are_exact(
    path: ObjectPath,
    replacement: Any,
) -> None:
    mutated = deepcopy(CONTRACT)
    _parent(mutated, path)[path[-1]] = replacement

    assert _schema_errors(mutated)
    assert validate_execution_gates(mutated)
