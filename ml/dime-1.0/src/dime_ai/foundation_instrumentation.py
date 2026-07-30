"""Deterministic local-only context and token instrumentation for Foundation authoring."""

from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from functools import cache
from pathlib import Path
from statistics import fmean
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.canonical_json import canonical_json_bytes

ML_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_ROOT = ML_ROOT / "schemas"
TOKEN_PROFILE_ID = "dime-foundation-local-byte-profile-v1"
CRITIC_PROMPT_REVISION = "foundation-critique-pilot-v1"
TOKEN_PROFILE = {
    "schema_version": "dime-foundation-token-profile-v1",
    "profile_id": TOKEN_PROFILE_ID,
    "status": "FROZEN_LOCAL_VALIDATION_ONLY",
    "encoding": {
        "implementation": "dime_ai.foundation_instrumentation.DeterministicByteTokenizer",
        "revision": "dime-local-utf8-byte-tokenizer-v1",
        "text_encoding": "utf-8",
        "token_unit": "one_token_per_utf8_byte",
        "special_token_ids": {
            "begin_of_text": 1,
            "start_header": 2,
            "end_header": 3,
            "end_of_turn": 4,
        },
    },
    "chat_format": "dime-assistant-only-fallback-v1",
    "max_length": 4096,
    "training_tokenizer_equivalent": False,
    "intended_use": ("deterministic_local_conversion_truncation_and_relative_context_measurement"),
    "prohibited_claims": [
        "production_model_token_count",
        "production_model_cost",
        "training_throughput",
        "serving_latency",
    ],
}


class FoundationInstrumentationError(ValueError):
    """Raised when a local instrumentation artifact is invalid or unsafe to freeze."""


class DeterministicByteTokenizer:
    """Dependency-free tokenizer used only for exact, local relative measurements."""

    bos_token_id = 1
    unk_token_id = 0
    chat_template = None
    _special = {
        "<|begin_of_text|>": 1,
        "<|start_header_id|>": 2,
        "<|end_header_id|>": 3,
        "<|eot_id|>": 4,
    }

    def convert_tokens_to_ids(self, token: str) -> int:
        return self._special.get(token, self.unk_token_id)

    def encode(self, value: str, add_special_tokens: bool = False) -> list[int]:
        del add_special_tokens
        return [256 + item for item in value.encode("utf-8")]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_json(value: object) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def sha256_file(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise FoundationInstrumentationError(f"hash input must be a regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@cache
def _validator(schema_name: str) -> Draft202012Validator:
    path = SCHEMA_ROOT / schema_name
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_schema(value: object, schema_name: str, label: str) -> None:
    errors = sorted(
        _validator(schema_name).iter_errors(value),
        key=lambda error: (
            tuple(str(part) for part in error.absolute_path),
            str(error.validator),
        ),
    )
    if not errors:
        return
    error = errors[0]
    location = ".".join(str(part) for part in error.absolute_path) or "<root>"
    raise FoundationInstrumentationError(f"{label}.{location}: {error.message}")


def token_profile() -> dict[str, Any]:
    profile = json.loads(json.dumps(TOKEN_PROFILE))
    validate_schema(profile, "foundation_token_profile.schema.json", "token profile")
    return profile


def critic_execution_receipt_document(
    *,
    record_id: str,
    draft_sha256: str,
    critic: dict[str, Any],
    context_sha256: str,
    reviewed_at: str,
) -> dict[str, Any]:
    """Return the exact receipt body for one independent critic execution."""

    return {
        "schema_version": "dime-foundation-critic-execution-receipt-v1",
        "record_id": record_id,
        "draft_sha256": draft_sha256,
        "actor_id": critic["actor_id"],
        "model_id": critic["model_id"],
        "model_revision": critic["model_revision"],
        "prompt_revision": critic["prompt_revision"],
        "prompt_sha256": critic["prompt_sha256"],
        "context_sha256": context_sha256,
        "responsibility": critic["responsibility"],
        "reviewed_at": reviewed_at,
    }


def expected_critic_execution_receipt_sha256(
    *,
    record_id: str,
    draft_sha256: str,
    critic: dict[str, Any],
    context_sha256: str,
    reviewed_at: str,
) -> str:
    return sha256_json(
        critic_execution_receipt_document(
            record_id=record_id,
            draft_sha256=draft_sha256,
            critic=critic,
            context_sha256=context_sha256,
            reviewed_at=reviewed_at,
        )
    )


def expected_critic_decision_receipt_sha256(decision: dict[str, Any]) -> str:
    """Hash one exact critic decision while excluding only its self-hash field."""

    material = {key: value for key, value in decision.items() if key != "decision_receipt_sha256"}
    return sha256_json(material)


def build_context_packet(
    *,
    packet_id: str,
    record_id: str,
    route: str,
    role: str,
    created_at: str,
    units: list[dict[str, Any]],
    tokenizer: DeterministicByteTokenizer | None = None,
) -> dict[str, Any]:
    """Build a context packet and exact duplicate-content metrics."""

    active_tokenizer = tokenizer or DeterministicByteTokenizer()
    rendered_units: list[dict[str, Any]] = []
    first_by_content_hash: dict[str, str] = {}
    total_tokens = 0
    relevant_tokens = 0
    redundant_tokens = 0
    for unit in units:
        content = unit["content"]
        content_sha256 = sha256_text(content)
        token_count = len(active_tokenizer.encode(content))
        if token_count <= 0:
            raise FoundationInstrumentationError("context units must contain at least one token")
        duplicate_of = first_by_content_hash.get(content_sha256)
        if duplicate_of is None:
            first_by_content_hash[content_sha256] = unit["unit_id"]
        else:
            redundant_tokens += token_count
        if unit["relevant"]:
            relevant_tokens += token_count
        total_tokens += token_count
        rendered_units.append(
            {
                "unit_id": unit["unit_id"],
                "source_path": unit["source_path"],
                "source_sha256": unit["source_sha256"],
                "content": content,
                "content_sha256": content_sha256,
                "token_count": token_count,
                "relevant": unit["relevant"],
                "duplicate_of": duplicate_of,
            }
        )

    packet = {
        "schema_version": "dime-foundation-context-packet-v1",
        "packet_id": packet_id,
        "record_id": record_id,
        "route": route,
        "role": role,
        "created_at": created_at,
        "token_profile_id": TOKEN_PROFILE_ID,
        "units": rendered_units,
        "metrics": {
            "total_context_tokens": total_tokens,
            "relevant_context_tokens": relevant_tokens,
            "redundant_context_tokens": redundant_tokens,
            "context_relevance": round(relevant_tokens / total_tokens, 8),
            "context_redundancy": round(redundant_tokens / total_tokens, 8),
        },
    }
    validate_schema(packet, "foundation_context_packet.schema.json", "context packet")
    return packet


def route_token_report(
    encoded_records: list[dict[str, Any]],
    context_packets: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate exact local-profile token and context metrics by route."""

    context_by_record: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for packet in context_packets:
        context_by_record[packet["record_id"]].append(packet)

    route_rows: dict[str, list[dict[str, int]]] = defaultdict(list)
    for item in encoded_records:
        encoded = item["encoded"]
        input_tokens = len(encoded["input_ids"])
        supervised_tokens = sum(label != -100 for label in encoded["labels"])
        packets = context_by_record[item["record_id"]]
        context_tokens = sum(packet["metrics"]["total_context_tokens"] for packet in packets)
        relevant_context_tokens = sum(
            packet["metrics"]["relevant_context_tokens"] for packet in packets
        )
        redundant_context_tokens = sum(
            packet["metrics"]["redundant_context_tokens"] for packet in packets
        )
        route_rows[item["route"]].append(
            {
                "input_tokens": input_tokens,
                "supervised_tokens": supervised_tokens,
                "masked_tokens": input_tokens - supervised_tokens,
                "context_tokens": context_tokens,
                "relevant_context_tokens": relevant_context_tokens,
                "redundant_context_tokens": redundant_context_tokens,
            }
        )

    def summarize(
        rows: list[dict[str, int]],
        packets: list[dict[str, Any]],
    ) -> dict[str, Any]:
        context_total = sum(row["context_tokens"] for row in rows)
        relevant_total = sum(row["relevant_context_tokens"] for row in rows)
        within_packet_redundant_total = sum(row["redundant_context_tokens"] for row in rows)
        input_values = [row["input_tokens"] for row in rows]
        efficiency = context_efficiency_report(packets)["totals"]
        return {
            "records": len(rows),
            "input_tokens": sum(input_values),
            "supervised_tokens": sum(row["supervised_tokens"] for row in rows),
            "masked_tokens": sum(row["masked_tokens"] for row in rows),
            "mean_input_tokens": round(fmean(input_values), 8),
            "max_input_tokens": max(input_values),
            "context_tokens": context_total,
            "relevant_context_tokens": relevant_total,
            "redundant_context_tokens": efficiency["repeated_logical_context_tokens"],
            "within_packet_redundant_context_tokens": (within_packet_redundant_total),
            "unique_cached_context_tokens": efficiency["unique_cached_context_tokens"],
            "cross_record_shared_context_tokens": efficiency["cross_record_shared_context_tokens"],
            "context_relevance": round(relevant_total / context_total, 8) if context_total else 0.0,
            "context_redundancy": efficiency["repeated_logical_context_ratio"],
            "within_packet_context_redundancy": efficiency["within_packet_redundancy"],
        }

    routes = {
        route: summarize(
            route_rows[route],
            [packet for packet in context_packets if packet["route"] == route],
        )
        for route in sorted(route_rows)
    }
    all_rows = [row for route in sorted(route_rows) for row in route_rows[route]]
    return {
        "schema_version": "dime-foundation-route-token-report-v1",
        "token_profile_id": TOKEN_PROFILE_ID,
        "training_tokenizer_equivalent": False,
        "routes": routes,
        "totals": summarize(all_rows, context_packets) if all_rows else {},
        "context_efficiency": context_efficiency_report(context_packets),
    }


def context_efficiency_report(context_packets: list[dict[str, Any]]) -> dict[str, Any]:
    """Measure exact context reuse across packets and records without double counting.

    Packet-local ``context_redundancy`` intentionally covers only duplicate units in
    one packet. This report makes repeated content across roles and records explicit,
    and separates the unique cache footprint from repeated logical context.
    """

    if not context_packets:
        raise FoundationInstrumentationError(
            "context efficiency requires at least one context packet"
        )

    def summarize(packets: list[dict[str, Any]]) -> dict[str, Any]:
        by_content: dict[str, dict[str, Any]] = {}
        within_packet_repeated_tokens = 0
        logical_unit_occurrences = 0
        logical_context_tokens = 0
        record_ids: set[str] = set()
        for packet in packets:
            record_id = packet["record_id"]
            record_ids.add(record_id)
            packet_first_hashes: set[str] = set()
            for unit in packet["units"]:
                content_sha256 = unit["content_sha256"]
                token_count = unit["token_count"]
                if sha256_text(unit["content"]) != content_sha256:
                    raise FoundationInstrumentationError(
                        f"{packet['packet_id']}: context unit content hash mismatch"
                    )
                existing = by_content.get(content_sha256)
                if existing is None:
                    existing = {
                        "token_count": token_count,
                        "occurrences": 0,
                        "record_ids": set(),
                    }
                    by_content[content_sha256] = existing
                elif existing["token_count"] != token_count:
                    raise FoundationInstrumentationError(
                        f"{packet['packet_id']}: inconsistent token count for shared content"
                    )
                existing["occurrences"] += 1
                existing["record_ids"].add(record_id)
                logical_unit_occurrences += 1
                logical_context_tokens += token_count
                if content_sha256 in packet_first_hashes:
                    within_packet_repeated_tokens += token_count
                else:
                    packet_first_hashes.add(content_sha256)

        unique_cached_context_tokens = sum(entry["token_count"] for entry in by_content.values())
        repeated_logical_context_tokens = logical_context_tokens - unique_cached_context_tokens
        cross_record_shared_context_tokens = sum(
            entry["token_count"] * (len(entry["record_ids"]) - 1) for entry in by_content.values()
        )
        within_record_repeated_context_tokens = sum(
            entry["token_count"] * (entry["occurrences"] - len(entry["record_ids"]))
            for entry in by_content.values()
        )
        same_record_cross_packet_context_tokens = (
            within_record_repeated_context_tokens - within_packet_repeated_tokens
        )
        if (
            repeated_logical_context_tokens
            != cross_record_shared_context_tokens + within_record_repeated_context_tokens
            or same_record_cross_packet_context_tokens < 0
        ):
            raise FoundationInstrumentationError("context reuse accounting invariant failed")

        def ratio(numerator: int) -> float:
            return round(numerator / logical_context_tokens, 8)

        return {
            "records": len(record_ids),
            "packets": len(packets),
            "logical_unit_occurrences": logical_unit_occurrences,
            "unique_content_units": len(by_content),
            "logical_context_tokens": logical_context_tokens,
            "unique_cached_context_tokens": unique_cached_context_tokens,
            "repeated_logical_context_tokens": repeated_logical_context_tokens,
            "within_packet_repeated_context_tokens": within_packet_repeated_tokens,
            "same_record_cross_packet_context_tokens": (same_record_cross_packet_context_tokens),
            "cross_record_shared_context_tokens": cross_record_shared_context_tokens,
            "unique_cache_ratio": ratio(unique_cached_context_tokens),
            "repeated_logical_context_ratio": ratio(repeated_logical_context_tokens),
            "within_packet_redundancy": ratio(within_packet_repeated_tokens),
            "cross_record_shared_context_redundancy": ratio(cross_record_shared_context_tokens),
        }

    roles = sorted({packet["role"] for packet in context_packets})
    report = {
        "schema_version": "dime-foundation-context-efficiency-report-v1",
        "token_profile_id": TOKEN_PROFILE_ID,
        "measurement_scope": {
            "within_packet": "exact repeated content within one packet",
            "same_record_cross_packet": (
                "exact repeated content across packets for the same record"
            ),
            "cross_record": ("one exact shared-content occurrence for each additional record"),
            "unique_cached": "one token footprint per exact unique content hash",
            "repeated_logical": (
                "all logical context occurrences minus the unique cache footprint"
            ),
        },
        "totals": summarize(context_packets),
        "roles": {
            role: summarize([packet for packet in context_packets if packet["role"] == role])
            for role in roles
        },
    }
    validate_schema(
        report,
        "foundation_context_efficiency_report.schema.json",
        "context efficiency report",
    )
    return report


def write_new_bytes(path: Path, content: bytes, *, mode: int = 0o600) -> None:
    """Create one immutable-by-convention local artifact without overwriting."""

    if path.is_symlink() or path.exists():
        raise FoundationInstrumentationError(f"artifact already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        written = 0
        while written < len(content):
            written += os.write(descriptor, content[written:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_new_json(path: Path, value: object, *, mode: int = 0o600) -> str:
    content = canonical_json_bytes(value)
    write_new_bytes(path, content, mode=mode)
    return sha256_bytes(content)


def file_manifest(root: Path, relative_paths: list[Path]) -> dict[str, Any]:
    entries = []
    for relative_path in sorted(relative_paths, key=lambda item: item.as_posix()):
        path = root / relative_path
        entries.append(
            {
                "path": relative_path.as_posix(),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "entries": entries,
    }
