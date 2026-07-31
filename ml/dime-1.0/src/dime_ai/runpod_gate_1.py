"""Fail-closed static validation for the proposed RunPod Gate 1 boundary."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parents[1]

GATE_PATH = ML_ROOT / "configs" / "runpod_gate_1_authorization_v1.json"
GATE_SCHEMA_PATH = ML_ROOT / "schemas" / "runpod_gate_1_authorization.schema.json"
CAPSULE_PATH = ML_ROOT / "evidence" / "execution" / "dime-llm-v1-context-capsule" / "capsule.json"
CAPSULE_SCHEMA_PATH = ML_ROOT / "schemas" / "dime_llm_v1_context_capsule.schema.json"

OWNER_MERGE_SCOPE = {
    "model_download",
    "base_vs_instruct_inference",
    "candidate_a_inference",
    "candidate_b_inference",
}
STILL_CLOSED = {
    "benchmark_scoring",
    "answer_key_access",
    "locked_evaluation_execution",
    "model_selection",
    "smoke_training",
    "full_training",
    "checkpoint_resume",
    "model_serving",
    "provider_activation",
    "railway_mutation",
    "deployment",
}
REQUIRED_BLOCKERS = (
    "container_digest",
    "base.serialization_profile_sha256",
    "instruct.serialization_profile_sha256",
    "retrieval_revision",
    "context_compiler_revision",
    "maximum_gpu_hours",
    "maximum_spend_usd",
    "credential_execution_closure",
    "runpod_permission_attestation",
    "independent_review",
    "owner_merge",
)
CAPSULE_HASH_BINDINGS = {
    "existing_model_execution_gates": "ml/dime-1.0/configs/model_execution_gates_v1.json",
    "base_model_suitability_contract": (
        "ml/dime-1.0/evidence/benchmarks/base-model-suitability-v1/contract.json"
    ),
    "model_artifact_evaluation_contract": (
        "ml/dime-1.0/evidence/benchmarks/model-artifact-evaluation-v1/contract.json"
    ),
    "training_contract": "ml/dime-1.0/configs/dime_training_contract_v1.json",
    "decoding_contract": "ml/dime-1.0/configs/decoding_v1.json",
    "tool_contract": "ml/dime-1.0/tools/tools.v1.json",
    "prompt": "ml/dime-1.0/prompts/dime_system_v1.md",
    "chat_template": "ml/dime-1.0/prompts/llama3_dime_chat_template_v1.jinja",
    "routing_source": "server/_core/dimeAnswerRouting.ts",
    "retrieval_source": "server/_core/dimeChatContext.ts",
}
FORBIDDEN_CAPSULE_KEYS = {
    "access_token",
    "answer_key",
    "api_key",
    "credential_value",
    "password",
    "raw_evaluation_case",
    "raw_foundation_record",
    "secret",
}


def _load_object(path: Path) -> dict[str, Any]:
    value = load_governed_json(path)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return value


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _schema_errors(instance: object, schema_path: Path) -> list[str]:
    schema = _load_object(schema_path)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []
    for error in sorted(
        validator.iter_errors(instance),
        key=lambda item: tuple(str(part) for part in item.absolute_path),
    ):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{schema_path.name}:{location}: {error.message}")
    return errors


def _field_keys(value: object) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, Mapping):
        for key, item in value.items():
            keys.add(str(key).lower())
            keys.update(_field_keys(item))
    elif isinstance(value, list):
        for item in value:
            keys.update(_field_keys(item))
    return keys


def _exact_boolean_map(
    value: object,
    *,
    expected_keys: set[str],
    expected_value: bool,
) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == expected_keys
        and all(item is expected_value for item in value.values())
    )


def _binding_errors(binding: object, label: str) -> list[str]:
    if not isinstance(binding, dict):
        return [f"{label} must be an object."]
    relative_path = binding.get("path")
    expected_sha256 = binding.get("sha256")
    if not isinstance(relative_path, str) or not isinstance(expected_sha256, str):
        return [f"{label} must contain path and sha256."]
    path = REPO_ROOT / relative_path
    if not path.is_file():
        return [f"{label} path is missing: {relative_path}"]
    if _sha256(path) != expected_sha256:
        return [f"{label} checksum mismatch: {relative_path}"]
    return []


def _walk_bindings(value: object, label: str = "contract") -> list[tuple[str, dict[str, Any]]]:
    bindings: list[tuple[str, dict[str, Any]]] = []
    if isinstance(value, dict):
        if isinstance(value.get("path"), str) and isinstance(value.get("sha256"), str):
            bindings.append((label, value))
        for key, item in value.items():
            bindings.extend(_walk_bindings(item, f"{label}.{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            bindings.extend(_walk_bindings(item, f"{label}[{index}]"))
    return bindings


def load_gate() -> dict[str, Any]:
    """Load the strict, non-executing Gate 1 proposal."""

    return _load_object(GATE_PATH)


def load_context_capsule() -> dict[str, Any]:
    """Load the sanitized context capsule without consulting external systems."""

    return _load_object(CAPSULE_PATH)


def validate_gate(contract: object) -> list[str]:
    """Validate exact identities, unresolved blockers, and zero effective authority."""

    errors = _schema_errors(contract, GATE_SCHEMA_PATH)
    if not isinstance(contract, dict):
        return errors

    for label, binding in _walk_bindings(contract):
        errors.extend(_binding_errors(binding, label))

    runtime = contract.get("runtime_identity", {})
    candidates = contract.get("candidates", {})
    controls = contract.get("shared_controls", {})
    budgets = contract.get("budgets", {})
    unresolved = {
        "container_digest": runtime.get("container_digest"),
        "base.serialization_profile_sha256": (
            candidates.get("base", {}).get("serialization_profile_sha256")
        ),
        "instruct.serialization_profile_sha256": (
            candidates.get("instruct", {}).get("serialization_profile_sha256")
        ),
        "retrieval_revision": controls.get("retrieval_revision"),
        "context_compiler_revision": controls.get("context_compiler_revision"),
        "maximum_gpu_hours": budgets.get("maximum_gpu_hours"),
        "maximum_spend_usd": budgets.get("maximum_spend_usd"),
    }
    for field, value in unresolved.items():
        if value is not None:
            errors.append(f"{field} must remain null until independently frozen.")

    if tuple(contract.get("required_blockers", ())) != REQUIRED_BLOCKERS:
        errors.append("The exact unresolved Gate 1 blocker inventory must be preserved.")
    if not _exact_boolean_map(
        contract.get("owner_merge_may_authorize"),
        expected_keys=OWNER_MERGE_SCOPE,
        expected_value=True,
    ):
        errors.append("Owner merge scope must contain exactly four download/inference actions.")
    if not _exact_boolean_map(
        contract.get("effective_authorization"),
        expected_keys=OWNER_MERGE_SCOPE,
        expected_value=False,
    ):
        errors.append("No Gate 1 action may be effective while blockers remain.")
    if not _exact_boolean_map(
        contract.get("still_not_authorized"),
        expected_keys=STILL_CLOSED,
        expected_value=False,
    ):
        errors.append("Training, serving, scoring, and production gates must remain false.")

    external = contract.get("external_actions_performed")
    if (
        not isinstance(external, dict)
        or not external
        or any(
            not isinstance(count, int) or isinstance(count, bool) or count != 0
            for count in external.values()
        )
    ):
        errors.append("Every external-action counter must be exactly zero.")
    security = contract.get("security_preconditions")
    if not isinstance(security, dict) or security.get("credential_accessed") is not False:
        errors.append("Gate preparation must not access a credential.")
    return errors


def validate_context_capsule(capsule: object) -> list[str]:
    """Validate compact, checksum-bound, sanitized cross-workstream state."""

    errors = _schema_errors(capsule, CAPSULE_SCHEMA_PATH)
    if not isinstance(capsule, dict):
        return errors
    hashes = capsule.get("critical_artifact_hashes")
    if isinstance(hashes, dict):
        for label, relative_path in CAPSULE_HASH_BINDINGS.items():
            path = REPO_ROOT / relative_path
            if not path.is_file():
                errors.append(f"Context capsule binding is missing: {relative_path}")
            elif hashes.get(label) != _sha256(path):
                errors.append(f"Context capsule checksum mismatch: {relative_path}")
    forbidden = _field_keys(capsule) & FORBIDDEN_CAPSULE_KEYS
    if forbidden:
        errors.append("Context capsule contains forbidden private or credential fields.")
    if capsule.get("production_application_sha") is not None:
        errors.append("Unverified production application SHA must remain null.")
    if capsule.get("production_backend_sha") is not None:
        errors.append("Unverified production backend SHA must remain null.")
    return errors


def static_audit() -> dict[str, Any]:
    """Return sanitized Gate 1 readiness; this function performs no external action."""

    gate = load_gate()
    capsule = load_context_capsule()
    errors = validate_gate(gate) + validate_context_capsule(capsule)
    return {
        "schema_version": "dime-runpod-gate-1-static-audit-v1",
        "pass": not errors,
        "status": gate.get("status"),
        "authorization_effect": gate.get("authorization_effect"),
        "ready_for_execution": False,
        "required_blocker_count": len(gate.get("required_blockers", [])),
        "owner_merge_may_authorize": gate.get("owner_merge_may_authorize"),
        "effective_authorization": gate.get("effective_authorization"),
        "still_not_authorized": gate.get("still_not_authorized"),
        "credential_accesses": 0,
        "runpod_calls": 0,
        "model_downloads": 0,
        "tokenizer_downloads": 0,
        "inference_requests": 0,
        "benchmark_executions": 0,
        "training_runs": 0,
        "serving_changes": 0,
        "railway_mutations": 0,
        "deployments": 0,
        "errors": errors,
    }
