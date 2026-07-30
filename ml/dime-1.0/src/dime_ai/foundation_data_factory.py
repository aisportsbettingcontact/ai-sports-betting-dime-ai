"""Deterministic, fail-closed Foundation authoring conversion."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.chat_format import encode_assistant_only
from dime_ai.data_validation import validate_sft_record
from dime_ai.foundation_control import validate_foundation_record, validate_source_packet
from dime_ai.foundation_partitioning import assigned_split as assigned_partition_split


class DataFactoryError(ValueError):
    """Raised when an authoring record cannot become trainer-ready."""


def _contains_placeholder(value: str) -> bool:
    lowered = value.casefold()
    return "replace" in lowered or "placeholder" in lowered or lowered in {"unknown", "latest"}


def assigned_split(record: dict[str, Any]) -> str:
    return assigned_partition_split(record["partition_identity"])


def _trainer_messages(record: dict[str, Any]) -> list[dict[str, Any]]:
    conversation = deepcopy(record["conversation"])
    if conversation[-1]["role"] != "assistant":
        raise DataFactoryError("authoring conversation must end with an assistant outcome")
    if conversation[-1]["content"] != record["expected_final_response"]:
        raise DataFactoryError("final assistant turn must equal expected_final_response")

    final_assistant = conversation.pop()
    for step in record["expected_tool_trace"]:
        if step["expected_execution_state"] == "skipped":
            continue
        call_id = f"{record['record_id']}-tool-{step['sequence']:02d}"
        conversation.extend(
            [
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": step["tool_name"],
                                "arguments": step["normalized_arguments"],
                            },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "content": json.dumps(
                        step["expected_tool_response"],
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                    "name": step["tool_name"],
                    "tool_call_id": call_id,
                },
            ]
        )
    conversation.append(final_assistant)
    return conversation


def convert_authoring_record(record: dict[str, Any]) -> dict[str, Any]:
    issues = validate_foundation_record(record)
    if issues:
        raise DataFactoryError("; ".join(issues))
    if record["rights_status"] == "pending":
        raise DataFactoryError("pending rights block conversion")
    if assigned_split(record) != record["split"]:
        raise DataFactoryError("split does not match the pre-prose scenario assignment")
    generator = record["provenance"]["generator"]
    critic = record["provenance"]["critic"]
    if generator["actor_id"] == critic["actor_id"]:
        raise DataFactoryError("generator cannot approve or critique its own record")
    identity_values = (
        record["record_id"],
        record["provenance"]["shard_id"],
        generator["actor_id"],
        generator["model_revision"],
        generator["prompt_revision"],
        critic["actor_id"],
        critic["model_revision"],
        critic["prompt_revision"],
        record["tool_schema_revision"] or "",
    )
    if any(_contains_placeholder(value) for value in identity_values):
        raise DataFactoryError("placeholder or movable identity blocks conversion")
    receipt_hashes = (
        generator["prompt_sha256"],
        generator["execution_receipt_sha256"],
        generator["context_sha256"],
        critic["prompt_sha256"],
        critic["execution_receipt_sha256"],
        critic["context_sha256"],
    )
    if any(value == "0" * 64 for value in receipt_hashes):
        raise DataFactoryError("placeholder execution receipt blocks conversion")
    review = record["independent_review"]
    if (
        review["decision"] != "approved"
        or review["unresolved_material_findings"] != 0
        or review["deterministic_validation_passed"] is not True
    ):
        raise DataFactoryError("independent review has not approved the exact record")

    messages = _trainer_messages(record)
    authoring_sha256 = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    source_reference = record["source_reference"]
    source_ids = (
        [record["record_id"]] if source_reference is None else [source_reference["packet_id"]]
    )
    provider_ids: set[str] = set()
    for step in record["expected_tool_trace"]:
        response = step["expected_tool_response"]
        if not isinstance(response, dict):
            continue
        source_ids.extend(response["source_ids"])
        provider_ids.update(response["source_scope"]["provider_universe"])
    source_ids = sorted(set(source_ids))
    source_snapshot = (
        authoring_sha256 if source_reference is None else source_reference["snapshot_sha256"]
    )
    as_of_utc = record["source_timestamp"] or record["provenance"]["created_at"]

    result = {
        "example_id": record["record_id"],
        "dataset_version": "dime-sft-foundation-v1",
        "task_type": record["task_type"],
        "messages": messages,
        "numeric_assertions": deepcopy(record["numeric_assertions"]),
        "curriculum": {
            **deepcopy(record["trainer_labels"]),
            "scenario_cluster_id": record["partition_identity"]["scenario_family_id"],
        },
        "metadata": {
            "sport": None,
            "league": None,
            "provider_ids": sorted(provider_ids),
            "as_of_utc": as_of_utc,
            "available_at_utc": as_of_utc,
            "synthetic_or_deidentified": (
                "synthetic" if record["source_type"] == "synthetic_behavioral" else "none"
            ),
            "contains_user_data": False,
            "consent_basis": None,
            "source_ids": source_ids,
            "event_partition_key": record["partition_identity"]["source_event_id"],
            "source_snapshot_partition_key": source_snapshot,
            "conversation_partition_key": record["partition_identity"]["conversation_family_id"],
            "user_partition_hash": None,
            "rights_basis": record["rights_status"],
            "source_owner": "Dime" if source_reference is None else "source_packet_registry",
            "author_id": generator["actor_id"],
            "deidentification_method": None,
            "generation_method": "teacher-generated",
            "teacher_provenance": {
                "model_id": generator["model_id"],
                "model_revision": generator["model_revision"],
                "prompt_sha256": generator["prompt_sha256"],
                "generated_at_utc": record["provenance"]["created_at"],
                "seed": record["partition_identity"]["split_assignment_seed"],
            },
            "deletion_policy_id": "foundation-private-v1",
            "direct_identifier_scan_version": "dime-sensitive-material-v1",
        },
        "quality": {
            "review_status": "approved",
            "reviewer_ids": [critic["actor_id"]],
            "reviewed_at_utc": review["reviewed_at"],
            "rubric_version": review["rubric_version"],
        },
    }
    validate_sft_record(result, production=True)
    return result


def convert_and_encode(record: dict[str, Any], tokenizer: Any, max_length: int) -> dict[str, Any]:
    trainer_record = convert_authoring_record(record)
    encoded = encode_assistant_only(tokenizer, trainer_record["messages"], max_length)
    return {
        "trainer_record": trainer_record,
        "authoring_sha256": hashlib.sha256(canonical_json_bytes(record)).hexdigest(),
        "trainer_sha256": hashlib.sha256(canonical_json_bytes(trainer_record)).hexdigest(),
        "encoded": encoded,
        "silent_truncation": False,
    }


def source_packet_is_releasable(packet: dict[str, Any]) -> bool:
    """Validate one immutable packet and reject any unresolved rights."""

    issues = validate_source_packet(packet)
    if issues:
        raise DataFactoryError("; ".join(issues))
    if packet["rights_status"] == "pending":
        raise DataFactoryError("pending source-packet rights block release")
    return True
