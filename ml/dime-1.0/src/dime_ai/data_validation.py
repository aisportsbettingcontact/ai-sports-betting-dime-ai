"""Dependency-light validation for Dime JSONL assets."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from functools import cache, lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

SECRET_PATTERN = re.compile(r"\bhf_[A-Za-z0-9]{12,}\b")
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)")
DISALLOWED_KEYS = {
    "email",
    "phone",
    "phone_number",
    "address",
    "street_address",
    "full_name",
    "raw_user_id",
    "password",
    "access_token",
    "api_key",
}
VALID_ROLES = {"system", "user", "assistant", "tool"}
SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schemas"
TOOL_CATALOG_PATH = Path(__file__).resolve().parents[2] / "tools/tools.v1.json"
TIMESTAMP_KEYS = {
    "as_of_utc",
    "available_at",
    "available_at_max",
    "commence_time",
    "created_at",
    "fetched_at",
    "published_at",
    "retrieved_at",
    "settled_at",
    "timestamp",
    "to_utc",
    "from_utc",
    "updated_at",
}


class DataValidationError(ValueError):
    """Raised when a record violates a Dime data contract."""


@cache
def _schema_validator(schema_name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / schema_name).read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _validate_against_schema(record: dict[str, Any], schema_name: str, record_id: str) -> None:
    errors = sorted(
        _schema_validator(schema_name).iter_errors(record),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        error: ValidationError = errors[0]
        path = ".".join(str(item) for item in error.absolute_path) or "$"
        raise DataValidationError(f"{record_id}: schema violation at {path}: {error.message}")


@lru_cache(maxsize=1)
def _tool_validators() -> dict[str, Draft202012Validator]:
    catalog = json.loads(TOOL_CATALOG_PATH.read_text())
    return {
        item["function"]["name"]: Draft202012Validator(item["function"]["parameters"])
        for item in catalog
    }


def _validate_tool_arguments(
    name: str,
    arguments: dict[str, Any],
    record_id: str,
) -> None:
    validator = _tool_validators().get(name)
    if validator is None:
        raise DataValidationError(f"{record_id}: unknown tool {name!r}")
    errors = sorted(validator.iter_errors(arguments), key=lambda error: list(error.path))
    if errors:
        error = errors[0]
        path = ".".join(str(item) for item in error.path) or "$"
        raise DataValidationError(
            f"{record_id}: invalid arguments for {name} at {path}: {error.message}"
        )


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    source = Path(path)
    with source.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise DataValidationError(f"{source}:{line_number}: invalid JSON: {exc}") from exc
            if not isinstance(record, dict):
                raise DataValidationError(f"{source}:{line_number}: each line must be an object")
            records.append(record)
    if not records:
        raise DataValidationError(f"{source}: file has no records")
    return records


def _walk(value: Any, path: str = "$") -> Iterable[tuple[str, Any]]:
    yield path, value
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _walk(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk(item, f"{path}[{index}]")


def _validate_no_sensitive_material(record: dict[str, Any], record_id: str) -> None:
    for path, value in _walk(record):
        key = path.rsplit(".", 1)[-1].lower()
        if key in DISALLOWED_KEYS:
            raise DataValidationError(f"{record_id}: disallowed sensitive field at {path}")
        if isinstance(value, str):
            if SECRET_PATTERN.search(value):
                raise DataValidationError(f"{record_id}: possible Hugging Face token at {path}")
            if EMAIL_PATTERN.search(value) or PHONE_PATTERN.search(value):
                raise DataValidationError(f"{record_id}: possible direct identifier at {path}")


def _validate_timestamp(value: Any, field: str, record_id: str) -> datetime:
    if not isinstance(value, str):
        raise DataValidationError(f"{record_id}: {field} must be an ISO-8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise DataValidationError(f"{record_id}: invalid timestamp in {field}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise DataValidationError(f"{record_id}: {field} must include an explicit UTC offset")
    if parsed.utcoffset().total_seconds() != 0:
        raise DataValidationError(f"{record_id}: {field} must be normalized to UTC")
    return parsed.astimezone(UTC)


def _collect_timestamps(value: Any, record_id: str, path: str = "$") -> list[datetime]:
    timestamps: list[datetime] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child_path = f"{path}.{key}"
            if key.lower() in TIMESTAMP_KEYS and isinstance(item, str):
                timestamps.append(_validate_timestamp(item, child_path, record_id))
            timestamps.extend(_collect_timestamps(item, record_id, child_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            timestamps.extend(_collect_timestamps(item, record_id, f"{path}[{index}]"))
    return timestamps


def _validate_tool_linkage(messages: list[dict[str, Any]], record_id: str) -> list[dict[str, Any]]:
    calls: dict[str, str] = {}
    results: set[str] = set()
    parsed_results: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        for call in message.get("tool_calls", []):
            call_id = call["id"]
            if call_id in calls:
                raise DataValidationError(f"{record_id}: duplicate tool call ID {call_id}")
            name = call["function"]["name"]
            _validate_tool_arguments(name, call["function"]["arguments"], record_id)
            calls[call_id] = name
        if message.get("role") != "tool":
            continue
        call_id = message.get("tool_call_id")
        name = message.get("name")
        if call_id not in calls:
            raise DataValidationError(
                f"{record_id}: tool message {index} references unknown call {call_id!r}"
            )
        if calls[call_id] != name:
            raise DataValidationError(
                f"{record_id}: tool result name {name!r} does not match call {calls[call_id]!r}"
            )
        if call_id in results:
            raise DataValidationError(f"{record_id}: duplicate result for tool call {call_id}")
        results.add(call_id)
        try:
            parsed = json.loads(message["content"])
        except json.JSONDecodeError as exc:
            raise DataValidationError(
                f"{record_id}: tool result {call_id} content must be valid JSON"
            ) from exc
        if not isinstance(parsed, dict):
            raise DataValidationError(f"{record_id}: tool result {call_id} must be an object")
        _validate_against_schema(parsed, "tool_response.schema.json", record_id)
        parsed_results.append(parsed)
    missing = set(calls) - results
    if missing:
        raise DataValidationError(f"{record_id}: tool calls missing results: {sorted(missing)}")
    return parsed_results


def validate_sft_record(record: dict[str, Any], production: bool = False) -> None:
    record_id = record.get("example_id")
    if not isinstance(record_id, str) or not record_id:
        raise DataValidationError("SFT record requires a non-empty example_id")
    _validate_against_schema(record, "sft_record.schema.json", record_id)
    _validate_no_sensitive_material(record, record_id)

    required = {"dataset_version", "task_type", "messages", "metadata", "quality"}
    missing = required - record.keys()
    if missing:
        raise DataValidationError(f"{record_id}: missing fields: {sorted(missing)}")

    messages = record["messages"]
    if not isinstance(messages, list) or len(messages) < 2:
        raise DataValidationError(f"{record_id}: messages must contain at least two items")
    assistant_count = 0
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            raise DataValidationError(f"{record_id}: message {index} must be an object")
        if message.get("role") not in VALID_ROLES:
            raise DataValidationError(f"{record_id}: message {index} has an invalid role")
        if not isinstance(message.get("content"), str):
            raise DataValidationError(f"{record_id}: message {index} content must be a string")
        assistant_count += message.get("role") == "assistant"
    if assistant_count == 0:
        raise DataValidationError(f"{record_id}: at least one assistant message is required")
    tool_results = _validate_tool_linkage(messages, record_id)

    metadata = record["metadata"]
    if not isinstance(metadata, dict):
        raise DataValidationError(f"{record_id}: metadata must be an object")
    for field in ("as_of_utc", "synthetic_or_deidentified", "contains_user_data", "source_ids"):
        if field not in metadata:
            raise DataValidationError(f"{record_id}: metadata.{field} is required")
    as_of = _validate_timestamp(metadata["as_of_utc"], "metadata.as_of_utc", record_id)
    privacy_state = metadata["synthetic_or_deidentified"]
    if privacy_state not in {"synthetic", "deidentified", "none"}:
        raise DataValidationError(f"{record_id}: invalid synthetic_or_deidentified value")
    if not isinstance(metadata["source_ids"], list):
        raise DataValidationError(f"{record_id}: metadata.source_ids must be an array")
    if metadata["contains_user_data"]:
        if privacy_state not in {"synthetic", "deidentified"}:
            raise DataValidationError(f"{record_id}: user data must be synthetic or deidentified")
        if not metadata.get("consent_basis"):
            raise DataValidationError(f"{record_id}: user-data record requires consent_basis")
    derived_timestamps = []
    for result in tool_results:
        derived_timestamps.extend(_collect_timestamps(result, record_id, "$.tool_result"))
    if derived_timestamps and max(derived_timestamps) > as_of:
        raise DataValidationError(f"{record_id}: future-data leakage in tool results")

    quality = record["quality"]
    if not isinstance(quality, dict) or quality.get("review_status") != "approved":
        raise DataValidationError(f"{record_id}: only approved records may enter training")
    if production:
        reviewer_ids = quality.get("reviewer_ids")
        if not reviewer_ids:
            raise DataValidationError(f"{record_id}: production record requires reviewer IDs")
        reviewed_at_utc = quality.get("reviewed_at_utc")
        if not reviewed_at_utc:
            raise DataValidationError(f"{record_id}: production record requires reviewed_at_utc")
        _validate_timestamp(reviewed_at_utc, "quality.reviewed_at_utc", record_id)
        curriculum = record.get("curriculum")
        if not isinstance(curriculum, dict):
            raise DataValidationError(f"{record_id}: production record requires curriculum labels")
        if curriculum.get("risk_tier") == "critical" and len(set(reviewer_ids)) < 2:
            raise DataValidationError(
                f"{record_id}: critical production record requires two reviewers"
            )
        required_lineage = {
            "rights_basis",
            "source_owner",
            "generation_method",
            "direct_identifier_scan_version",
        }
        missing_lineage = sorted(field for field in required_lineage if not metadata.get(field))
        if missing_lineage:
            raise DataValidationError(f"{record_id}: missing production lineage: {missing_lineage}")
        if metadata["contains_user_data"]:
            user_requirements = {
                "deidentification_method",
                "deletion_policy_id",
                "user_partition_hash",
            }
            missing_user_lineage = sorted(
                field for field in user_requirements if not metadata.get(field)
            )
            if missing_user_lineage:
                raise DataValidationError(
                    f"{record_id}: missing user-data lineage: {missing_user_lineage}"
                )


def validate_dataset_manifest(
    manifest: dict[str, Any],
    train_sha256: str,
    validation_sha256: str,
    curriculum_config_sha256: str,
    tool_catalog_sha256: str,
    chat_template_sha256: str,
    train_record_count: int | None = None,
    validation_record_count: int | None = None,
    *,
    require_public_publication: bool = False,
) -> None:
    record_id = str(manifest.get("dataset_version", "dataset-manifest"))
    schema_version = manifest.get("schema_version")
    schema_name = {
        "dime-dataset-manifest-v2": "dataset_manifest.schema.json",
        "dime-dataset-manifest-v3": "dataset_manifest.v3.schema.json",
    }.get(schema_version)
    if schema_name is None:
        raise DataValidationError(f"{record_id}: unsupported dataset manifest schema")
    if require_public_publication and schema_version != "dime-dataset-manifest-v3":
        raise DataValidationError(
            f"{record_id}: public publication requires dime-dataset-manifest-v3"
        )

    _validate_against_schema(manifest, schema_name, record_id)
    _validate_timestamp(manifest["approved_at_utc"], "approved_at_utc", record_id)
    required_true = {
        "approved",
        "rights_reviewed",
        "consent_reviewed",
        "privacy_reviewed",
        "partition_audit_passed",
        "future_data_audit_passed",
        "semantic_dedup_audit_passed",
        "evaluation_contamination_audit_passed",
    }
    incomplete = sorted(field for field in required_true if manifest.get(field) is not True)
    if incomplete:
        raise DataValidationError(f"{record_id}: manifest approvals incomplete: {incomplete}")

    if schema_version == "dime-dataset-manifest-v3":
        if manifest["approval_status"] != "approved":
            raise DataValidationError(f"{record_id}: approval_status must be approved")
        placeholder_reviewers = {"reviewer-a", "reviewer-b", "replace_me", "unknown"}
        if any(str(value).lower() in placeholder_reviewers for value in manifest["reviewer_ids"]):
            raise DataValidationError(f"{record_id}: reviewer_ids contain placeholder values")
        if train_record_count is None or validation_record_count is None:
            raise DataValidationError(f"{record_id}: record counts are required for v3")
        if manifest["train_record_count"] != train_record_count:
            raise DataValidationError(f"{record_id}: train record count mismatch")
        if manifest["validation_record_count"] != validation_record_count:
            raise DataValidationError(f"{record_id}: validation record count mismatch")
        if require_public_publication:
            if manifest["visibility"] != "public":
                raise DataValidationError(f"{record_id}: public data requires public visibility")
            if manifest["publication_classification"] != "approved-public":
                raise DataValidationError(
                    f"{record_id}: public data requires approved-public classification"
                )
            if manifest["contains_user_data"]:
                raise DataValidationError(
                    f"{record_id}: user data is not publishable in this public repository"
                )
            if manifest["contains_provider_derived_data"]:
                raise DataValidationError(
                    f"{record_id}: provider-derived data is not publishable in this repository"
                )

    if manifest["train_sha256"] != train_sha256:
        raise DataValidationError(f"{record_id}: train dataset hash mismatch")
    if manifest["validation_sha256"] != validation_sha256:
        raise DataValidationError(f"{record_id}: validation dataset hash mismatch")
    expected_hashes = {
        "curriculum_config_sha256": curriculum_config_sha256,
        "tool_catalog_sha256": tool_catalog_sha256,
        "chat_template_sha256": chat_template_sha256,
    }
    for field, expected in expected_hashes.items():
        if manifest[field] != expected:
            raise DataValidationError(f"{record_id}: {field} mismatch")


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_public_repository_data(project: str | Path) -> dict[str, int]:
    """Fail closed when public JSONL is not a reviewed synthetic sample or manifest-bound."""

    root = Path(project).resolve()
    data_root = root / "data"
    jsonl_paths = sorted(data_root.rglob("*.jsonl"))
    sample_paths = [path for path in jsonl_paths if path.name.endswith(".sample.jsonl")]
    non_sample_paths = [path for path in jsonl_paths if path not in sample_paths]

    sample_record_count = 0
    for path in sample_paths:
        records = read_jsonl(path)
        sample_record_count += len(records)
        if "sft" in path.parts:
            for record in records:
                metadata = record.get("metadata", {})
                if metadata.get("synthetic_or_deidentified") != "synthetic":
                    raise DataValidationError(f"{path}: public sample must be synthetic")
                if metadata.get("contains_user_data") is not False:
                    raise DataValidationError(f"{path}: public sample cannot contain user data")
        elif "eval" in path.parts:
            for record in records:
                if record.get("provenance", {}).get("synthetic") is not True:
                    raise DataValidationError(f"{path}: public evaluation sample must be synthetic")

    if non_sample_paths:
        expected_train = data_root / "sft/train.APPROVED.jsonl"
        expected_validation = data_root / "sft/validation.APPROVED.jsonl"
        expected_paths = {expected_train, expected_validation}
        if set(non_sample_paths) != expected_paths:
            relative = sorted(str(path.relative_to(root)) for path in non_sample_paths)
            raise DataValidationError(
                "non-sample public JSONL is prohibited outside the approved train/validation "
                f"contract: {relative}"
            )

        manifest_path = root / "configs/dataset_manifest_APPROVED.json"
        if not manifest_path.is_file():
            raise DataValidationError(
                "non-sample public JSONL requires configs/dataset_manifest_APPROVED.json"
            )
        train = read_jsonl(expected_train)
        validation = read_jsonl(expected_validation)
        for record in [*train, *validation]:
            validate_sft_record(record, production=True)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        validate_dataset_manifest(
            manifest,
            sha256_file(expected_train),
            sha256_file(expected_validation),
            sha256_file(root / "configs/curriculum_v1.yaml"),
            sha256_file(root / "tools/tools.v1.json"),
            sha256_file(root / "prompts/llama3_dime_chat_template_v1.jinja"),
            len(train),
            len(validation),
            require_public_publication=True,
        )

    return {
        "jsonl_files": len(jsonl_paths),
        "sample_files": len(sample_paths),
        "sample_records": sample_record_count,
        "non_sample_files": len(non_sample_paths),
    }


def validate_eval_case(record: dict[str, Any], production: bool = False) -> None:
    record_id = record.get("case_id")
    if not isinstance(record_id, str) or not record_id:
        raise DataValidationError("Evaluation record requires a non-empty case_id")
    _validate_against_schema(record, "eval_case.schema.json", record_id)
    _validate_no_sensitive_material(record, record_id)

    required = {
        "dataset_version",
        "split",
        "task_type",
        "severity",
        "as_of_utc",
        "messages",
        "allowed_tools",
        "forbidden_tools",
        "tool_fixtures",
        "gold",
        "scoring",
        "provenance",
    }
    missing = required - record.keys()
    if missing:
        raise DataValidationError(f"{record_id}: missing fields: {sorted(missing)}")
    as_of = _validate_timestamp(record["as_of_utc"], "as_of_utc", record_id)
    available = _validate_timestamp(
        record["provenance"].get("available_at_max"),
        "provenance.available_at_max",
        record_id,
    )
    if available > as_of:
        raise DataValidationError(f"{record_id}: future-data leakage detected")
    for index, fixture in enumerate(record.get("tool_fixtures", [])):
        _validate_tool_arguments(
            fixture["tool"],
            fixture["arguments"],
            f"{record_id}.tool_fixtures[{index}]",
        )
        _validate_against_schema(
            fixture["returns"],
            "tool_response.schema.json",
            f"{record_id}.tool_fixtures[{index}]",
        )
    fixture_timestamps = _collect_timestamps(
        record.get("tool_fixtures", []),
        record_id,
        "$.tool_fixtures",
    )
    if fixture_timestamps and max(fixture_timestamps) > as_of:
        raise DataValidationError(f"{record_id}: future-data leakage in tool fixtures")
    overlap = set(record["allowed_tools"]) & set(record["forbidden_tools"])
    if overlap:
        raise DataValidationError(
            f"{record_id}: tools both allowed and forbidden: {sorted(overlap)}"
        )
    if not isinstance(record["messages"], list) or not record["messages"]:
        raise DataValidationError(f"{record_id}: messages must not be empty")
    gold = record["gold"]
    for field in (
        "required_tool_calls",
        "forbidden_tool_calls",
        "numbers",
        "required_concepts",
        "forbidden_claims",
        "expected_policy_action",
    ):
        if field not in gold:
            raise DataValidationError(f"{record_id}: gold.{field} is required")
    if production:
        if record["split"] == "red_team":
            raise DataValidationError(
                f"{record_id}: red_team is a legacy exposure split; "
                "use split dev/validation/locked/hidden plus suite red_team"
            )
        if record.get("suite") not in {
            "standard",
            "safety",
            "privacy",
            "red_team",
            "operations",
        }:
            raise DataValidationError(f"{record_id}: production evaluation requires suite")
        if not isinstance(record.get("tags"), dict):
            raise DataValidationError(f"{record_id}: production evaluation requires tags")


def validate_unique_ids(records: Iterable[dict[str, Any]], field: str) -> None:
    seen: set[str] = set()
    for record in records:
        value = record.get(field)
        if value in seen:
            raise DataValidationError(f"Duplicate {field}: {value}")
        seen.add(value)


def partition_keys(record: dict[str, Any]) -> set[str]:
    """Return keys that must not cross SFT train/validation boundaries."""

    metadata = record.get("metadata", {})
    keys = set(metadata.get("source_ids", []))
    for field in ("event_partition_key", "user_partition_hash"):
        value = metadata.get(field)
        if value:
            keys.add(str(value))
    return keys
