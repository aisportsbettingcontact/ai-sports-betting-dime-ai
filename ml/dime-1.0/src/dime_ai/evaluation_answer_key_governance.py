"""Fail-closed controls for private answer keys and isolated evaluation scoring."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parents[1]

GOVERNANCE_PATH = ML_ROOT / "configs" / "evaluation_answer_key_governance_v1.json"
GOVERNANCE_SCHEMA_PATH = ML_ROOT / "schemas" / "evaluation_answer_key_governance.schema.json"
ANSWER_KEY_RECORD_SCHEMA_PATH = ML_ROOT / "schemas" / "evaluation_answer_key_record.schema.json"
BLINDED_OUTPUT_SCHEMA_PATH = ML_ROOT / "schemas" / "evaluation_blinded_output.schema.json"
LOCKED_LEDGER_SCHEMA_PATH = ML_ROOT / "schemas" / "evaluation_locked_consumption_ledger.schema.json"

RESOURCE_UNIVERSE = (
    "private_foundation",
    "evaluation_semantic_cases",
    "evaluation_semantic_manifests",
    "evaluation_answer_keys",
    "evaluation_answer_key_manifests",
    "blinded_model_outputs",
    "evaluation_scores",
    "locked_consumption_ledger",
    "model_endpoint",
)
IDENTITY_KEYS = ("training", "model_runner", "scorer", "locked_controller")
IDENTITY_ACCESS = {
    "training": {
        "identity_id": "dime-foundation-training-v1",
        "responsibility": "foundation_training_only",
        "allowed_read": ("private_foundation",),
        "allowed_write": (),
        "allowed_actions_after_owner_merge": ("use_private_foundation_control_plane",),
        "model_endpoint_access": "denied",
    },
    "model_runner": {
        "identity_id": "dime-evaluation-model-runner-v1",
        "responsibility": "semantic_case_inference_and_blinded_output_only",
        "allowed_read": ("evaluation_semantic_cases", "evaluation_semantic_manifests"),
        "allowed_write": ("blinded_model_outputs",),
        "allowed_actions_after_owner_merge": (
            "read_semantic_cases",
            "write_blinded_outputs",
        ),
        "model_endpoint_access": "separate_benchmark_gate_required",
    },
    "scorer": {
        "identity_id": "dime-evaluation-isolated-scorer-v1",
        "responsibility": "answer_key_and_blinded_output_scoring_only",
        "allowed_read": (
            "evaluation_answer_keys",
            "evaluation_answer_key_manifests",
            "blinded_model_outputs",
        ),
        "allowed_write": ("evaluation_scores",),
        "allowed_actions_after_owner_merge": (
            "read_answer_keys",
            "read_blinded_outputs",
            "write_evaluation_scores",
        ),
        "model_endpoint_access": "denied",
    },
    "locked_controller": {
        "identity_id": "dime-locked-evaluation-controller-v1",
        "responsibility": "single_use_authorization_and_consumption_ledger_only",
        "allowed_read": (
            "evaluation_semantic_manifests",
            "evaluation_answer_key_manifests",
            "locked_consumption_ledger",
        ),
        "allowed_write": ("locked_consumption_ledger",),
        "allowed_actions_after_owner_merge": (
            "enforce_single_use_locked_lease",
            "append_locked_consumption_receipt",
        ),
        "model_endpoint_access": "denied",
    },
}
OWNER_MERGE_SCOPE = {
    "private_answer_key_generation",
    "private_answer_key_publication",
    "training_runner_scorer_separation",
    "locked_consumption_ledger",
}
STILL_NOT_AUTHORIZED = {
    "model_download",
    "runpod_inference",
    "benchmark_execution",
    "model_training",
    "model_serving",
    "railway_mutation",
}
BLINDED_FORBIDDEN_KEYS = {
    "answer",
    "answer_key",
    "candidate_model",
    "candidate_provider",
    "foundation",
    "gold",
    "gold_answer",
    "model_id",
    "model_revision",
    "provider",
    "provider_id",
    "semantic_case",
    "semantic_case_content",
}


def _load_object(path: Path) -> dict[str, Any]:
    value = load_governed_json(path)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return value


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


def load_governance() -> dict[str, Any]:
    """Load the static governance proposal with strict duplicate-key handling."""

    return _load_object(GOVERNANCE_PATH)


def validate_governance(contract: object) -> list[str]:
    """Validate schema, identity isolation, and exact non-authorization semantics."""

    errors = _schema_errors(contract, GOVERNANCE_SCHEMA_PATH)
    if not isinstance(contract, dict):
        return errors

    universe = tuple(contract.get("resource_universe", ()))
    if universe != RESOURCE_UNIVERSE:
        errors.append("The closed resource universe must match the v1 contract exactly.")
    universe_set = set(RESOURCE_UNIVERSE)

    identities = contract.get("identities")
    if not isinstance(identities, dict):
        errors.append("The identities map must be present.")
    else:
        if tuple(identities) != IDENTITY_KEYS:
            errors.append("The four identity roles and their order must be exact.")
        identity_ids: list[object] = []
        for role, expected in IDENTITY_ACCESS.items():
            identity = identities.get(role)
            if not isinstance(identity, dict):
                errors.append(f"{role} identity is missing.")
                continue
            identity_ids.append(identity.get("identity_id"))
            for field in (
                "identity_id",
                "responsibility",
                "model_endpoint_access",
            ):
                if identity.get(field) != expected[field]:
                    errors.append(f"{role}.{field} must match the frozen identity contract.")
            for field in (
                "allowed_read",
                "allowed_write",
                "allowed_actions_after_owner_merge",
            ):
                if tuple(identity.get(field, ())) != expected[field]:
                    errors.append(f"{role}.{field} must match the frozen identity contract.")
            if identity.get("credential_provisioned") is not False:
                errors.append(f"{role} must not claim that a credential is provisioned.")

            for mode in ("read", "write"):
                allowed = identity.get(f"allowed_{mode}")
                denied = identity.get(f"denied_{mode}")
                if not isinstance(allowed, list) or not isinstance(denied, list):
                    errors.append(f"{role} {mode} access lists must be arrays.")
                    continue
                allowed_set = set(allowed)
                denied_set = set(denied)
                if allowed_set & denied_set:
                    errors.append(f"{role} {mode} access lists overlap.")
                if allowed_set | denied_set != universe_set:
                    errors.append(
                        f"{role} {mode} access must classify every resource exactly once."
                    )
                expected_denied = universe_set - set(expected[f"allowed_{mode}"])
                if denied_set != expected_denied:
                    errors.append(f"{role}.denied_{mode} must be the exact complement.")
        if len(identity_ids) != len(set(identity_ids)):
            errors.append("Every evaluation identity must have a unique identity_id.")

    layers = contract.get("semantic_layers")
    if isinstance(layers, dict):
        semantic_repos = {
            value.get("semantic_repo_id") for value in layers.values() if isinstance(value, dict)
        }
        key_repos = {
            value.get("answer_key_repo_id") for value in layers.values() if isinstance(value, dict)
        }
        if semantic_repos & key_repos:
            errors.append("Semantic-case and answer-key repositories must be disjoint.")
        if len(semantic_repos) != 4 or len(key_repos) != 4:
            errors.append("Every evaluation layer must use distinct repository identities.")

    if not _exact_boolean_map(
        contract.get("owner_merge_authorization_scope"),
        expected_keys=OWNER_MERGE_SCOPE,
        expected_value=True,
    ):
        errors.append("Owner-merge authorization must contain exactly the four Track E controls.")
    if not _exact_boolean_map(
        contract.get("still_not_authorized"),
        expected_keys=STILL_NOT_AUTHORIZED,
        expected_value=False,
    ):
        errors.append("All six execution and production gates must remain explicitly false.")

    artifact_contracts = contract.get("artifact_contracts")
    if isinstance(artifact_contracts, dict):
        for label, relative_path in artifact_contracts.items():
            if not isinstance(relative_path, str) or not (REPO_ROOT / relative_path).is_file():
                errors.append(f"{label} does not resolve to a committed contract file.")

    return errors


def validate_answer_key_record(record: object) -> list[str]:
    """Validate one private answer-key record without reading semantic case content."""

    errors = _schema_errors(record, ANSWER_KEY_RECORD_SCHEMA_PATH)
    if not isinstance(record, dict):
        return errors
    provenance = record.get("provenance")
    if isinstance(provenance, dict) and (
        provenance.get("generator_actor_id") == provenance.get("reviewer_actor_id")
    ):
        errors.append("Answer-key generator and independent reviewer must be different actors.")
    privacy = record.get("privacy")
    if isinstance(privacy, dict) and privacy.get("contains_semantic_case_content") is not False:
        errors.append("Answer-key records must not copy semantic case content.")
    return errors


def validate_blinded_output(output: object) -> list[str]:
    """Validate that a runner output contains no candidate or answer-key identity fields."""

    errors = _schema_errors(output, BLINDED_OUTPUT_SCHEMA_PATH)
    forbidden = _field_keys(output) & BLINDED_FORBIDDEN_KEYS
    if forbidden:
        errors.append(
            "Blinded output contains forbidden identity or private-material fields: "
            + ", ".join(sorted(forbidden))
        )
    return errors


def validate_locked_consumption_ledger(ledger: object) -> list[str]:
    """Validate a one-use locked-evaluation ledger and terminal consumption receipt."""

    errors = _schema_errors(ledger, LOCKED_LEDGER_SCHEMA_PATH)
    if not isinstance(ledger, dict):
        return errors
    entries = ledger.get("entries")
    execution_count = ledger.get("execution_count")
    if isinstance(entries, list) and execution_count != len(entries):
        errors.append("Locked ledger execution_count must equal the number of entries.")
    if isinstance(entries, list):
        lease_ids = [entry.get("lease_id") for entry in entries if isinstance(entry, dict)]
        execution_ids = [entry.get("execution_id") for entry in entries if isinstance(entry, dict)]
        if len(lease_ids) != len(set(lease_ids)):
            errors.append("Locked ledger lease_id values must be unique.")
        if len(execution_ids) != len(set(execution_ids)):
            errors.append("Locked ledger execution_id values must be unique.")
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            try:
                authorized = datetime.fromisoformat(
                    str(entry["authorized_at"]).replace("Z", "+00:00")
                )
                consumed = datetime.fromisoformat(str(entry["consumed_at"]).replace("Z", "+00:00"))
                if consumed < authorized:
                    errors.append("Locked consumption cannot precede authorization.")
            except (KeyError, TypeError, ValueError):
                pass
    return errors


def governance_audit() -> dict[str, Any]:
    """Return a sanitized static audit; this function performs no external action."""

    contract = load_governance()
    errors = validate_governance(contract)
    identities = contract.get("identities", {})
    return {
        "schema_version": "dime-evaluation-answer-key-governance-audit-v1",
        "pass": not errors,
        "status": contract.get("status"),
        "authorization_effect": contract.get("authorization_effect"),
        "identity_count": len(identities) if isinstance(identities, dict) else 0,
        "credentials_provisioned": False,
        "answer_keys_generated": 0,
        "answer_keys_published": 0,
        "provider_invocations": 0,
        "model_downloads": 0,
        "benchmark_executions": 0,
        "training_runs": 0,
        "railway_mutations": 0,
        "owner_merge_authorization_scope": contract.get("owner_merge_authorization_scope"),
        "still_not_authorized": contract.get("still_not_authorized"),
        "errors": errors,
    }
