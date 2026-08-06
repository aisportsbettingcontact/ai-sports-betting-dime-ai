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

from dime_ai.foundation_contracts import (
    FoundationContractError,
    _safe_schema_error_message,
)
from dime_ai.tool_contracts import (
    load_tool_contracts,
    validate_tool_arguments,
    validate_tool_response,
)

HUGGING_FACE_TOKEN_PATTERN = re.compile(r"\bhf_[A-Za-z0-9]{12,}\b")
GITHUB_TOKEN_PATTERN = re.compile(r"\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b")
AWS_ACCESS_KEY_PATTERN = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")
BEARER_TOKEN_PATTERN = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b", re.IGNORECASE)
OPENAI_API_KEY_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])sk-(?:"
    r"(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}"
    r"|[A-Za-z0-9]{20,}"
    r")(?![A-Za-z0-9_-])"
)
ANTHROPIC_API_KEY_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}"
    r"(?![A-Za-z0-9_-])"
)
GOOGLE_API_KEY_PATTERN = re.compile(r"(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])")
RUNPOD_API_KEY_PATTERN = re.compile(r"(?<![A-Za-z0-9_-])rpa_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])")
RUNPOD_API_KEY_ASSIGNMENT_PATTERN = re.compile(
    r"\bRUNPOD_API_KEY\s*(?:=|:)\s*[\"']?"
    r"(?!your_api_key|replace_me|example|<)[A-Za-z0-9][A-Za-z0-9._-]{19,}",
    re.IGNORECASE,
)
ODDS_API_KEY_ASSIGNMENT_PATTERN = re.compile(
    r"\b(?:THE_ODDS_API_KEY|ODDS_API_KEY)\s*(?:=|:)\s*[\"']?"
    r"(?!your_api_key|replace_me|example|<)[A-Fa-f0-9]{24,64}",
    re.IGNORECASE,
)
STRIPE_SECRET_KEY_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}"
    r"(?![A-Za-z0-9])"
)
PRIVATE_KEY_PEM_PATTERN = re.compile(
    r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"
)
CREDENTIAL_URI_PATTERN = re.compile(
    r"\b[A-Za-z][A-Za-z0-9+.-]*://"
    r"[^/\s:@]+:[^/\s@]+@"
    r"(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)"
    r"(?::\d{1,5})?(?=[/\s?#]|$)"
)
CREDENTIAL_PATTERNS = (
    ("Hugging Face token", HUGGING_FACE_TOKEN_PATTERN),
    ("GitHub token", GITHUB_TOKEN_PATTERN),
    ("AWS access key", AWS_ACCESS_KEY_PATTERN),
    ("bearer token", BEARER_TOKEN_PATTERN),
    ("OpenAI API key", OPENAI_API_KEY_PATTERN),
    ("Anthropic API key", ANTHROPIC_API_KEY_PATTERN),
    ("Google API key", GOOGLE_API_KEY_PATTERN),
    ("RunPod API key", RUNPOD_API_KEY_PATTERN),
    ("RunPod API-key assignment", RUNPOD_API_KEY_ASSIGNMENT_PATTERN),
    ("odds-provider API-key assignment", ODDS_API_KEY_ASSIGNMENT_PATTERN),
    ("Stripe secret or restricted key", STRIPE_SECRET_KEY_PATTERN),
    ("private-key PEM block", PRIVATE_KEY_PEM_PATTERN),
    ("credential-bearing URI", CREDENTIAL_URI_PATTERN),
)
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)")
INTERNATIONAL_PHONE_PATTERN = re.compile(r"(?<!\w)\+\d(?:[\s().-]*\d){7,14}(?!\d)")
IPV4_PATTERN = re.compile(
    r"\b(?:25[0-5]|2[0-4]\d|1?\d?\d)"
    r"(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b"
)
DISALLOWED_KEYS = {
    "account_id",
    "email",
    "date_of_birth",
    "device_id",
    "dob",
    "phone",
    "phone_number",
    "ip_address",
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
        key=lambda error: (
            tuple(str(item) for item in error.absolute_schema_path),
            str(error.validator),
        ),
    )
    if errors:
        raise DataValidationError(
            _safe_schema_error_message(
                errors[0],
                label=f"{schema_name} record",
            )
        )


@lru_cache(maxsize=1)
def _tool_validators() -> dict[str, Draft202012Validator]:
    catalog = json.loads(load_tool_contracts().raw_bytes["tools/tools.v1.json"])
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
        raise DataValidationError(f"{record_id}: unknown tool name")
    errors = sorted(
        validator.iter_errors(arguments),
        key=lambda error: (
            tuple(str(item) for item in error.absolute_schema_path),
            str(error.validator),
        ),
    )
    if errors:
        raise DataValidationError(
            _safe_schema_error_message(
                errors[0],
                label=f"{name} request",
            )
        )
    try:
        validate_tool_arguments(name, arguments)
    except FoundationContractError as exc:
        raise DataValidationError(f"{record_id}: {exc}") from exc


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise DataValidationError(f"{source}: expected a regular non-symlink file")
    try:
        with source.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    record = strict_json_loads(line, f"{source}:{line_number}")
                except (json.JSONDecodeError, DataValidationError) as exc:
                    if isinstance(exc, DataValidationError):
                        raise
                    raise DataValidationError(
                        f"{source}:{line_number}: invalid JSON: {exc}"
                    ) from exc
                if not isinstance(record, dict):
                    raise DataValidationError(
                        f"{source}:{line_number}: each line must be an object"
                    )
                records.append(record)
    except UnicodeDecodeError as exc:
        raise DataValidationError(f"{source}: invalid UTF-8") from exc
    if not records:
        raise DataValidationError(f"{source}: file has no records")
    return records


def strict_json_loads(value: str, label: str = "JSON") -> Any:
    """Parse standards-compliant JSON and reject duplicate object keys."""

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in pairs:
            if key in result:
                raise DataValidationError(f"{label}: duplicate JSON key")
            result[key] = item
        return result

    def reject_constant(constant: str) -> None:
        raise DataValidationError(f"{label}: nonfinite JSON number")

    return json.loads(
        value,
        object_pairs_hook=object_pairs,
        parse_constant=reject_constant,
    )


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
            for credential_name, pattern in CREDENTIAL_PATTERNS:
                if pattern.search(value):
                    raise DataValidationError(
                        f"{record_id}: possible {credential_name} credential at {path}"
                    )
            if any(
                pattern.search(value)
                for pattern in (
                    EMAIL_PATTERN,
                    PHONE_PATTERN,
                    INTERNATIONAL_PHONE_PATTERN,
                    IPV4_PATTERN,
                )
            ):
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


def _validate_tool_linkage(
    messages: list[dict[str, Any]],
    record_id: str,
) -> list[tuple[str, str, dict[str, Any]]]:
    calls: dict[str, tuple[str, dict[str, Any]]] = {}
    results: set[str] = set()
    parsed_results: list[tuple[str, str, dict[str, Any]]] = []
    for index, message in enumerate(messages):
        if message.get("tool_calls") and message.get("role") != "assistant":
            raise DataValidationError(
                f"{record_id}: only assistant messages may contain tool calls"
            )
        for call in message.get("tool_calls", []):
            call_id = call["id"]
            if call_id in calls:
                raise DataValidationError(f"{record_id}: duplicate tool call ID {call_id}")
            name = call["function"]["name"]
            _validate_tool_arguments(name, call["function"]["arguments"], record_id)
            calls[call_id] = (name, call["function"]["arguments"])
        if message.get("role") != "tool":
            continue
        call_id = message.get("tool_call_id")
        name = message.get("name")
        if call_id not in calls:
            raise DataValidationError(
                f"{record_id}: tool message {index} references an unknown call"
            )
        call_name, call_arguments = calls[call_id]
        if call_name != name:
            raise DataValidationError(
                f"{record_id}: tool result name does not match originating call"
            )
        if call_id in results:
            raise DataValidationError(f"{record_id}: duplicate result for tool call {call_id}")
        results.add(call_id)
        try:
            parsed = strict_json_loads(
                message["content"],
                f"{record_id}.tool_result.{call_id}",
            )
        except (json.JSONDecodeError, DataValidationError) as exc:
            if isinstance(exc, DataValidationError):
                raise
            raise DataValidationError(
                f"{record_id}: tool result {call_id} content must be valid JSON"
            ) from exc
        if not isinstance(parsed, dict):
            raise DataValidationError(f"{record_id}: tool result {call_id} must be an object")
        try:
            validate_tool_response(
                parsed,
                expected_tool_name=str(name),
                expected_call_id=str(call_id),
                expected_arguments=call_arguments,
            )
        except FoundationContractError as exc:
            raise DataValidationError(f"{record_id}: {exc}") from exc
        parsed_results.append((call_id, str(name), parsed))
    missing = set(calls) - results
    if missing:
        raise DataValidationError(f"{record_id}: tool calls missing results: {sorted(missing)}")
    return parsed_results


def _validate_message_sequence(
    messages: list[dict[str, Any]],
    record_id: str,
) -> None:
    """Require a causal user/assistant/tool sequence with a final assistant outcome."""

    first_conversation_index = 1 if messages[0].get("role") == "system" else 0
    if messages[first_conversation_index].get("role") != "user":
        raise DataValidationError(f"{record_id}: conversation must begin with a user message")

    state = "expect_user"
    pending_tool_calls: set[str] = set()
    for index, message in enumerate(messages[first_conversation_index:], first_conversation_index):
        role = message.get("role")
        if state == "expect_user":
            if role != "user":
                raise DataValidationError(f"{record_id}: message {index} must be a user message")
            state = "expect_assistant"
            continue

        if state == "expect_assistant":
            if role != "assistant":
                raise DataValidationError(
                    f"{record_id}: message {index} must be an assistant response"
                )
            calls = message.get("tool_calls", [])
            if calls:
                pending_tool_calls = {call["id"] for call in calls}
                state = "expect_tool"
            else:
                if not message.get("content", "").strip():
                    raise DataValidationError(
                        f"{record_id}: assistant outcome at message {index} is empty"
                    )
                state = "expect_user_or_end"
            continue

        if state == "expect_tool":
            if role != "tool":
                raise DataValidationError(
                    f"{record_id}: message {index} must resolve pending tool calls"
                )
            call_id = message.get("tool_call_id")
            if call_id not in pending_tool_calls:
                raise DataValidationError(
                    f"{record_id}: tool result is not pending at message {index}"
                )
            pending_tool_calls.remove(call_id)
            if not pending_tool_calls:
                state = "expect_assistant"
            continue

        if state == "expect_user_or_end":
            if role != "user":
                raise DataValidationError(
                    f"{record_id}: message {index} must begin the next user turn"
                )
            state = "expect_assistant"

    if state != "expect_user_or_end":
        raise DataValidationError(
            f"{record_id}: conversation must end with a non-empty assistant outcome"
        )


def validate_sft_record(
    record: dict[str, Any],
    production: bool = False,
    *,
    require_approved: bool = True,
) -> None:
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
    system_positions: list[int] = []
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            raise DataValidationError(f"{record_id}: message {index} must be an object")
        if message.get("role") not in VALID_ROLES:
            raise DataValidationError(f"{record_id}: message {index} has an invalid role")
        if not isinstance(message.get("content"), str):
            raise DataValidationError(f"{record_id}: message {index} content must be a string")
        if message.get("role") == "system":
            system_positions.append(index)
        assistant_count += message.get("role") == "assistant"
    if assistant_count == 0:
        raise DataValidationError(f"{record_id}: at least one assistant message is required")
    if system_positions and system_positions != [0]:
        raise DataValidationError(
            f"{record_id}: a system message is allowed only once and only as the first message"
        )
    if production and system_positions:
        raise DataValidationError(
            f"{record_id}: production records cannot supply a system message; "
            "the trainer injects the canonical prompt"
        )
    tool_results = _validate_tool_linkage(messages, record_id)
    _validate_message_sequence(messages, record_id)

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
        if privacy_state != "deidentified":
            raise DataValidationError(f"{record_id}: actual user data must be deidentified")
        if not metadata.get("consent_basis"):
            raise DataValidationError(f"{record_id}: user-data record requires consent_basis")
    available_at = metadata.get("available_at_utc")
    if available_at is not None:
        available = _validate_timestamp(available_at, "metadata.available_at_utc", record_id)
        if available > as_of:
            raise DataValidationError(f"{record_id}: source was unavailable at as_of_utc")
    metadata_source_ids = set(metadata["source_ids"])
    derived_timestamps = []
    for call_id, tool_name, result in tool_results:
        result_source_ids = set(result["source_ids"])
        undeclared_source_ids = sorted(result_source_ids - metadata_source_ids)
        if undeclared_source_ids:
            raise DataValidationError(
                f"{record_id}: tool result {call_id} cites undeclared source IDs: "
                f"{undeclared_source_ids}"
            )
        if (
            result["status"] == "ok"
            and tool_name != "calculate_market_math"
            and not result_source_ids
        ):
            raise DataValidationError(
                f"{record_id}: successful {tool_name} result {call_id} "
                "requires source IDs declared in metadata"
            )
        derived_timestamps.extend(_collect_timestamps(result, record_id, "$.tool_result"))
    if derived_timestamps and max(derived_timestamps) > as_of:
        raise DataValidationError(f"{record_id}: future-data leakage in tool results")

    quality = record["quality"]
    if not isinstance(quality, dict):
        raise DataValidationError(f"{record_id}: quality must be an object")
    if (require_approved or production) and quality.get("review_status") != "approved":
        raise DataValidationError(f"{record_id}: only approved records may enter training")
    if production:
        reviewer_ids = quality.get("reviewer_ids")
        if not reviewer_ids:
            raise DataValidationError(f"{record_id}: production record requires reviewer IDs")
        if len(reviewer_ids) != len(set(reviewer_ids)) or any(
            not isinstance(value, str) or not value.strip() for value in reviewer_ids
        ):
            raise DataValidationError(
                f"{record_id}: production reviewer IDs must be unique and non-empty"
            )
        placeholder_reviewers = {"reviewer-a", "reviewer-b", "replace_me", "unknown"}
        if any(value.strip().lower() in placeholder_reviewers for value in reviewer_ids):
            raise DataValidationError(f"{record_id}: production reviewer IDs contain placeholders")
        reviewed_at_utc = quality.get("reviewed_at_utc")
        if not reviewed_at_utc:
            raise DataValidationError(f"{record_id}: production record requires reviewed_at_utc")
        _validate_timestamp(reviewed_at_utc, "quality.reviewed_at_utc", record_id)
        curriculum = record.get("curriculum")
        if not isinstance(curriculum, dict):
            raise DataValidationError(f"{record_id}: production record requires curriculum labels")
        required_labels = {
            "answer_length",
            "difficulty",
            "evidence_status",
            "interaction_mode",
            "policy_action",
            "risk_tier",
            "scenario_cluster_id",
            "skill_ids",
        }
        missing_labels = sorted(required_labels - curriculum.keys())
        if missing_labels:
            raise DataValidationError(
                f"{record_id}: missing production curriculum labels: {missing_labels}"
            )
        elevated_tasks = {
            "market_math",
            "bet_tracker_coaching",
            "simulation_analysis",
            "safety_privacy_security",
        }
        elevated_actions = {
            "privacy_block",
            "age_block",
            "jurisdiction_block",
            "self_exclusion_block",
            "protective_block",
            "acute_distress_block",
        }
        minimum_reviewers = (
            2
            if (
                curriculum.get("risk_tier") in {"high", "critical"}
                or record.get("task_type") in elevated_tasks
                or curriculum.get("policy_action") in elevated_actions
                or metadata["contains_user_data"]
            )
            else 1
        )
        if len(set(reviewer_ids)) < minimum_reviewers:
            raise DataValidationError(
                f"{record_id}: elevated production record requires two reviewers"
            )
        required_lineage = {
            "author_id",
            "available_at_utc",
            "conversation_partition_key",
            "rights_basis",
            "source_owner",
            "source_snapshot_partition_key",
            "generation_method",
            "direct_identifier_scan_version",
        }
        missing_lineage = sorted(field for field in required_lineage if not metadata.get(field))
        if missing_lineage:
            raise DataValidationError(f"{record_id}: missing production lineage: {missing_lineage}")
        if not metadata["source_ids"]:
            raise DataValidationError(f"{record_id}: production record requires source IDs")
        if metadata.get("author_id") in reviewer_ids:
            raise DataValidationError(f"{record_id}: record author cannot approve the record")
        if metadata.get("provider_ids") is None:
            raise DataValidationError(f"{record_id}: production record requires provider_ids")
        if record.get("dataset_version") != "dime-sft-foundation-v1":
            raise DataValidationError(
                f"{record_id}: production record has the wrong dataset_version"
            )
        generation_method = metadata.get("generation_method")
        teacher = metadata.get("teacher_provenance")
        if generation_method == "teacher-generated" and not isinstance(teacher, dict):
            raise DataValidationError(
                f"{record_id}: teacher-generated record requires teacher_provenance"
            )
        if generation_method != "teacher-generated" and teacher is not None:
            raise DataValidationError(
                f"{record_id}: teacher_provenance is allowed only for teacher-generated records"
            )
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


def validate_sft_candidate(record: dict[str, Any]) -> None:
    """Validate a non-trainable candidate without treating its embedded status as approval."""

    validate_sft_record(record, production=False, require_approved=False)


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
    v4_evidence_hashes: dict[str, str] | None = None,
) -> None:
    record_id = str(manifest.get("dataset_version", "dataset-manifest"))
    schema_version = manifest.get("schema_version")
    schema_name = {
        "dime-dataset-manifest-v2": "dataset_manifest.schema.json",
        "dime-dataset-manifest-v3": "dataset_manifest.v3.schema.json",
        "dime-dataset-manifest-v4": "dataset_manifest.v4.schema.json",
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

    if schema_version in {"dime-dataset-manifest-v3", "dime-dataset-manifest-v4"}:
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
        if schema_version == "dime-dataset-manifest-v4":
            if manifest["visibility"] != "private":
                raise DataValidationError(f"{record_id}: foundation v4 must remain private")
            if manifest["publication_classification"] != "private-only":
                raise DataValidationError(
                    f"{record_id}: foundation v4 must use private-only classification"
                )
            if manifest["contains_user_data"] or manifest["contains_provider_derived_data"]:
                raise DataValidationError(
                    f"{record_id}: Foundation v1 excludes user and provider-derived data"
                )
            if v4_evidence_hashes is None:
                raise DataValidationError(
                    f"{record_id}: v4 manifest requires externally verified evidence hashes"
                )
            evidence_fields = {
                "system_prompt_sha256",
                "foundation_build_config_sha256",
                "source_registry_sha256",
                "source_artifacts_sha256",
                "review_ledger_sha256",
                "reviewer_registry_sha256",
                "candidate_audit_sha256",
                "approval_record_sha256",
            }
            missing_evidence = sorted(evidence_fields - v4_evidence_hashes.keys())
            if missing_evidence:
                raise DataValidationError(
                    f"{record_id}: missing v4 evidence hashes: {missing_evidence}"
                )
            for field in sorted(evidence_fields):
                if manifest[field] != v4_evidence_hashes[field]:
                    raise DataValidationError(f"{record_id}: {field} mismatch")

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
    private_boundaries = frozenset({"hidden", "locked", "private", "provider", "raw"})
    jsonl_paths = sorted(
        path
        for path in data_root.rglob("*.jsonl")
        if path.relative_to(data_root).parts[0] not in private_boundaries
    )
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
        try:
            validate_tool_response(
                fixture["returns"],
                expected_tool_name=fixture["tool"],
                expected_call_id=fixture["tool_call_id"],
                expected_arguments=fixture["arguments"],
            )
        except FoundationContractError as exc:
            raise DataValidationError(f"{record_id}.tool_fixtures[{index}]: {exc}") from exc
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
    """Return namespaced groups that must not cross SFT split boundaries."""

    metadata = record.get("metadata", {})
    keys = {f"source:{value}" for value in metadata.get("source_ids", []) if value}
    for message in record.get("messages", []):
        if message.get("role") != "tool":
            continue
        try:
            result = strict_json_loads(
                message.get("content", ""),
                "partition tool result",
            )
        except (json.JSONDecodeError, DataValidationError):
            continue
        if not isinstance(result, dict):
            continue
        result_source_ids = result.get("source_ids", [])
        if not isinstance(result_source_ids, list):
            continue
        keys.update(
            f"source:{value}" for value in result_source_ids if isinstance(value, str) and value
        )
    for field in (
        "event_partition_key",
        "source_snapshot_partition_key",
        "conversation_partition_key",
        "user_partition_hash",
    ):
        value = metadata.get(field)
        if value:
            keys.add(f"{field}:{value}")
    scenario = record.get("curriculum", {}).get("scenario_cluster_id")
    if scenario:
        keys.add(f"scenario_cluster_id:{scenario}")
    return keys
