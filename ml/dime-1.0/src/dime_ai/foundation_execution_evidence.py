"""Fail-closed admission and sanitized evidence for private Foundation artifacts."""

from __future__ import annotations

import hashlib
import os
import re
import stat
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.chat_format import IGNORE_INDEX
from dime_ai.foundation_control import (
    validate_foundation_record,
    validate_source_packet,
)
from dime_ai.foundation_data_factory import (
    DataFactoryError,
    convert_and_encode,
    source_packet_is_releasable,
)
from dime_ai.foundation_dataset import (
    _development_contamination,
    find_exact_duplicates,
    find_semantic_neighbors,
)
from dime_ai.foundation_instrumentation import (
    DeterministicByteTokenizer,
    token_profile,
    validate_schema,
)
from dime_ai.foundation_partitioning import PartitionRegistryError, validate_partition_groups
from dime_ai.foundation_private_evaluation_comparison import (
    FOUNDATION_COUNTS,
    PARTITION_COUNTS,
    SECOND_LIVE_DATA_SHARD_COUNTS,
    FoundationEvaluationComparisonError,
    compare_partitions,
    load_accepted_foundation,
    load_semantic_r5,
)
from dime_ai.governed_json import load_governed_json, loads_governed_json
from dime_ai.private_evaluation_semantics import validate_semantic_case

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parents[1]
RELEASE_PLAN_PATH = ML_ROOT / "configs" / "foundation_release_plan_v1.json"
EVIDENCE_SCHEMA_PATH = ML_ROOT / "schemas" / "foundation_execution_evidence.schema.json"
CONTINUATION_EVIDENCE_SCHEMA_PATH = (
    ML_ROOT / "schemas" / "foundation_continuation_evidence.schema.json"
)
NUMERIC_TOKEN = re.compile(r"(?<![A-Za-z0-9_])[-+]?(?:\d+(?:\.\d+)?|\.\d+)%?")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PRIVATE_MODE = 0o700
PRIVATE_FILE_MODE = 0o600
EXTERNAL_OPERATIONS = {
    "credential_reads": 0,
    "model_downloads": 0,
    "network_calls": 0,
    "production_data_reads": 0,
    "provider_invocations": 0,
    "publications": 0,
    "railway_mutations": 0,
    "training_runs": 0,
}
AUTHORIZATION_BOUNDARY = {
    "deployment": False,
    "model_download": False,
    "provider_execution": False,
    "publication": False,
    "railway_mutation": False,
    "route_activation": False,
    "training": False,
}


class FoundationExecutionEvidenceError(ValueError):
    """Raised when private admission or sanitized evidence cannot be proven."""


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise FoundationExecutionEvidenceError(f"hash input is not a regular file: {path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def _private_root(path: Path, label: str) -> Path:
    absolute = path.absolute()
    if absolute.is_symlink() or not absolute.is_dir():
        raise FoundationExecutionEvidenceError(f"{label} is not a regular private directory")
    resolved = absolute.resolve(strict=True)
    if _mode(resolved) != PRIVATE_MODE:
        raise FoundationExecutionEvidenceError(f"{label} mode must be 0700")
    return resolved


def _parse_sha256sums(root: Path) -> dict[str, str]:
    path = root / "SHA256SUMS"
    if path.is_symlink() or not path.is_file() or _mode(path) != PRIVATE_FILE_MODE:
        raise FoundationExecutionEvidenceError("private SHA256SUMS is missing or unsafe")
    entries: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("  ", maxsplit=1)
        if len(parts) != 2 or not SHA256.fullmatch(parts[0]):
            raise FoundationExecutionEvidenceError("private SHA256SUMS is malformed")
        relative = Path(parts[1])
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or relative.as_posix() != parts[1]
            or parts[1] == "SHA256SUMS"
            or parts[1] in entries
        ):
            raise FoundationExecutionEvidenceError(
                "private SHA256SUMS path is unsafe or duplicated"
            )
        entries[parts[1]] = parts[0]
    if not entries:
        raise FoundationExecutionEvidenceError("private SHA256SUMS inventory is empty")
    return entries


def secure_inventory(path: Path, label: str) -> dict[str, Any]:
    """Verify permissions, symlink rejection, and a closed on-disk SHA-256 ledger.

    Payload and checksum-ledger counts are deliberately reported separately.
    ``total_*`` includes the single ``SHA256SUMS`` file; ``payload_*`` does not.
    """

    root = _private_root(path, label)
    files: dict[str, Path] = {}
    directory_count = 1
    file_sizes: dict[str, int] = {}
    for candidate in sorted(root.rglob("*")):
        relative = candidate.relative_to(root).as_posix()
        if candidate.is_symlink():
            raise FoundationExecutionEvidenceError(f"{label} contains a symlink")
        if candidate.is_dir():
            directory_count += 1
            if _mode(candidate) != PRIVATE_MODE:
                raise FoundationExecutionEvidenceError(f"{label} contains a non-0700 directory")
        elif candidate.is_file():
            if _mode(candidate) != PRIVATE_FILE_MODE:
                raise FoundationExecutionEvidenceError(f"{label} contains a non-0600 file")
            files[relative] = candidate
            file_sizes[relative] = candidate.stat().st_size
        else:
            raise FoundationExecutionEvidenceError(f"{label} contains a non-regular entry")
    entries = _parse_sha256sums(root)
    expected_paths = set(files) - {"SHA256SUMS"}
    if set(entries) != expected_paths:
        raise FoundationExecutionEvidenceError(f"{label} SHA256SUMS is not a closed inventory")
    for relative, expected in entries.items():
        if _sha256_file(files[relative]) != expected:
            raise FoundationExecutionEvidenceError(f"{label} checksum mismatch")
    payload_byte_count = sum(file_sizes[relative] for relative in entries)
    checksum_ledger_byte_count = file_sizes["SHA256SUMS"]
    return {
        "directory_count": directory_count,
        "payload_file_count": len(entries),
        "payload_byte_count": payload_byte_count,
        "checksum_ledger_file_count": 1,
        "checksum_ledger_byte_count": checksum_ledger_byte_count,
        "total_file_count": len(files),
        "total_byte_count": payload_byte_count + checksum_ledger_byte_count,
        "sha256sums_sha256": _sha256_file(root / "SHA256SUMS"),
        "symlink_count": 0,
        "mode_failures": 0,
        "checksum_failures": 0,
        "closed_inventory": True,
    }


def _safe_private_file(root: Path, relative: str, label: str) -> Path:
    """Resolve one canonical manifest path without permitting root escape."""

    candidate_relative = Path(relative)
    if (
        not relative
        or candidate_relative.is_absolute()
        or ".." in candidate_relative.parts
        or candidate_relative.as_posix() != relative
    ):
        raise FoundationExecutionEvidenceError(f"{label} path is unsafe")
    candidate = root / candidate_relative
    if candidate.is_symlink() or not candidate.is_file():
        raise FoundationExecutionEvidenceError(f"{label} path is not a regular file")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise FoundationExecutionEvidenceError(f"{label} path escapes its private root")
    return resolved


def _load_object(path: Path, label: str) -> dict[str, Any]:
    value = load_governed_json(path, source=label)
    if not isinstance(value, dict):
        raise FoundationExecutionEvidenceError(f"{label} must be a JSON object")
    return value


def _load_canonical_jsonl(path: Path, label: str) -> list[dict[str, Any]]:
    if path.is_symlink() or not path.is_file():
        raise FoundationExecutionEvidenceError(f"{label} is not a regular JSONL file")
    records = []
    for index, line in enumerate(path.read_bytes().splitlines(keepends=True), start=1):
        if not line.endswith(b"\n") or not line.strip():
            raise FoundationExecutionEvidenceError(f"{label} is not canonical line-delimited JSON")
        value = loads_governed_json(line, source=f"{label}:{index}")
        if not isinstance(value, dict) or canonical_json_bytes(value) != line:
            raise FoundationExecutionEvidenceError(f"{label} contains non-canonical JSON")
        records.append(value)
    return records


def _manifest_records(
    root: Path,
    manifest_name: str,
    expected_status: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    manifest = _load_object(root / manifest_name, manifest_name)
    entries = manifest.get("entries")
    if (
        manifest.get("schema_version") != "dime-foundation-artifact-manifest-v1"
        or manifest.get("status") != expected_status
        or not isinstance(entries, list)
        or not entries
    ):
        raise FoundationExecutionEvidenceError(f"{manifest_name} boundary drifted")
    records: list[dict[str, Any]] = []
    observed_paths: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise FoundationExecutionEvidenceError(f"{manifest_name} entry is malformed")
        relative = entry.get("path")
        expected_hash = entry.get("sha256")
        expected_records = entry.get("records")
        if (
            not isinstance(relative, str)
            or relative in observed_paths
            or not SHA256.fullmatch(str(expected_hash))
            or not isinstance(expected_records, int)
        ):
            raise FoundationExecutionEvidenceError(f"{manifest_name} entry is malformed")
        observed_paths.add(relative)
        path = _safe_private_file(root, relative, manifest_name)
        if _sha256_file(path) != expected_hash:
            raise FoundationExecutionEvidenceError(f"{manifest_name} file binding drifted")
        rows = _load_canonical_jsonl(path, relative)
        if len(rows) != expected_records:
            raise FoundationExecutionEvidenceError(f"{manifest_name} row count drifted")
        records.extend(rows)
    if manifest.get("record_count") != len(records):
        raise FoundationExecutionEvidenceError(f"{manifest_name} record count drifted")
    return records, manifest


def _source_packet_snapshot(
    path: Path,
    label: str,
) -> tuple[Path, dict[str, Path], dict[str, str], dict[str, Any]]:
    """Create a closed, deterministic checksum inventory without mutating source artifacts."""

    root = _private_root(path, label)
    files: dict[str, Path] = {}
    file_hashes: dict[str, str] = {}
    payload_byte_count = 0
    directory_count = 1
    for candidate in sorted(root.rglob("*")):
        relative = candidate.relative_to(root).as_posix()
        if candidate.is_symlink():
            raise FoundationExecutionEvidenceError(f"{label} contains a symlink")
        if candidate.is_dir():
            raise FoundationExecutionEvidenceError(
                f"{label} source-packet root must be a flat private directory"
            )
        if (
            not candidate.is_file()
            or _mode(candidate) != PRIVATE_FILE_MODE
            or candidate.suffix != ".json"
        ):
            raise FoundationExecutionEvidenceError(
                f"{label} must contain only private JSON packet files"
            )
        files[relative] = candidate
        file_hashes[relative] = _sha256_file(candidate)
        payload_byte_count += candidate.stat().st_size
    if not files:
        raise FoundationExecutionEvidenceError(f"{label} packet inventory is empty")
    ledger = "".join(
        f"{file_hashes[relative]}  {relative}\n" for relative in sorted(file_hashes)
    ).encode("ascii")
    inventory = {
        "directory_count": directory_count,
        "payload_file_count": len(files),
        "payload_byte_count": payload_byte_count,
        "content_inventory_sha256": _sha256_bytes(ledger),
        "inventory_origin": "COMPUTED_IN_MEMORY_FROM_CLOSED_SOURCE_ROOT",
        "symlink_count": 0,
        "mode_failures": 0,
        "mutation_failures": 0,
        "closed_inventory": True,
    }
    return root, files, file_hashes, inventory


def _source_packets(
    path: Path,
    label: str,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    root, files, initial_hashes, inventory = _source_packet_snapshot(path, label)
    packets: dict[str, dict[str, Any]] = {}
    for _relative, candidate in sorted(files.items()):
        packet = _load_object(candidate, label)
        issues = validate_source_packet(packet)
        if issues:
            raise FoundationExecutionEvidenceError(f"{label} contains an invalid packet")
        try:
            source_packet_is_releasable(packet)
        except DataFactoryError as exc:
            raise FoundationExecutionEvidenceError(f"{label} contains blocked rights") from exc
        packet_id = packet["packet_id"]
        if packet_id in packets:
            raise FoundationExecutionEvidenceError(f"{label} contains a duplicate packet")
        packets[packet_id] = packet
    final_root, final_files, final_hashes, final_inventory = _source_packet_snapshot(root, label)
    if (
        final_root != root
        or set(final_files) != set(files)
        or final_hashes != initial_hashes
        or final_inventory != inventory
    ):
        raise FoundationExecutionEvidenceError(f"{label} changed during admission validation")
    return packets, inventory


def _report_boundary(
    root: Path,
    *,
    pilot: bool,
) -> tuple[dict[str, Any], str, int]:
    report_name = "pilot-report.json" if pilot else "final-report.json"
    report = _load_object(root / report_name, report_name)
    expected_schema = (
        "dime-foundation-pilot-report-v1" if pilot else "dime-foundation-live-data-final-report-v1"
    )
    if report.get("schema_version") != expected_schema or report.get("status") != "PASS":
        raise FoundationExecutionEvidenceError(f"{report_name} is not PASS")
    gates = report.get("gates")
    if (
        not isinstance(gates, dict)
        or not gates
        or any(
            not isinstance(value, int) or isinstance(value, bool) or value != 0
            for value in gates.values()
        )
    ):
        raise FoundationExecutionEvidenceError(f"{report_name} gates are not all zero")
    counts = report.get("counts")
    if not isinstance(counts, dict):
        raise FoundationExecutionEvidenceError(f"{report_name} counts are absent")
    count_key = "records" if pilot else "accepted_records"
    record_count = counts.get(count_key)
    if not isinstance(record_count, int):
        raise FoundationExecutionEvidenceError(f"{report_name} count is malformed")
    if not pilot:
        if report.get("downstream_authorization") != {
            "publication": False,
            "training": False,
            "deployment": False,
            "route_activation": False,
        }:
            raise FoundationExecutionEvidenceError("live-data downstream boundary is open")
        if report.get("external_operations") != EXTERNAL_OPERATIONS:
            raise FoundationExecutionEvidenceError("live-data external-operations boundary drifted")
    return report, report_name, record_count


def _numeric_assertions_are_complete(record: Mapping[str, Any]) -> bool:
    assistant_text = " ".join(
        str(message["content"])
        for message in record["conversation"]
        if message["role"] == "assistant"
    )
    return not NUMERIC_TOKEN.search(assistant_text) or bool(record["numeric_assertions"])


def _mask_is_assistant_only(encoded: Mapping[str, Any]) -> bool:
    input_ids = encoded.get("input_ids")
    attention = encoded.get("attention_mask")
    labels = encoded.get("labels")
    if (
        not isinstance(input_ids, list)
        or not isinstance(attention, list)
        or not isinstance(labels, list)
        or not input_ids
        or len(input_ids) != len(attention)
        or len(input_ids) != len(labels)
    ):
        return False
    masked = 0
    supervised = 0
    for token, mask, label in zip(input_ids, attention, labels, strict=True):
        if mask != 1:
            return False
        if label == IGNORE_INDEX:
            masked += 1
        elif label == token:
            supervised += 1
        else:
            return False
    return masked > 0 and supervised > 0


def _per_record_admission(
    authoring_records: Sequence[dict[str, Any]],
    trainer_records: Sequence[dict[str, Any]],
    packets: Mapping[str, dict[str, Any]],
) -> dict[str, Any]:
    if len(authoring_records) != len(trainer_records):
        raise FoundationExecutionEvidenceError("authoring/trainer record counts differ")
    trainer_by_id = {record.get("example_id"): record for record in trainer_records}
    if len(trainer_by_id) != len(trainer_records) or None in trainer_by_id:
        raise FoundationExecutionEvidenceError("trainer identity inventory is not unique")
    profile = token_profile()
    tokenizer = DeterministicByteTokenizer()
    checks = Counter(
        {
            "schema": 0,
            "rights": 0,
            "critic_independence": 0,
            "high_risk_two_approvals": 0,
            "partition": 0,
            "numeric": 0,
            "production_trainer_conversion": 0,
            "assistant_only_masking": 0,
            "truncation_rejected": 0,
            "token_profile": 0,
        }
    )
    route_splits: Counter[tuple[str, str]] = Counter()
    failure_counts = Counter({key: 0 for key in checks})
    converted_records: list[dict[str, Any]] = []
    for record in authoring_records:
        record_id = record.get("record_id")
        trainer = trainer_by_id.get(record_id)
        if not isinstance(record_id, str) or trainer is None:
            raise FoundationExecutionEvidenceError("authoring identity inventory drifted")

        issues = validate_foundation_record(record)
        if issues:
            failure_counts["schema"] += 1
        else:
            checks["schema"] += 1

        rights_ok = record.get("rights_status") != "pending"
        reference = record.get("source_reference")
        if reference is not None:
            packet = packets.get(reference.get("packet_id"))
            rights_ok = bool(
                rights_ok
                and packet is not None
                and packet["snapshot_sha256"] == reference.get("snapshot_sha256")
                and packet["source_locator"] == reference.get("locator")
            )
        rights_ok = bool(
            rights_ok
            and trainer.get("metadata", {}).get("rights_basis") == record.get("rights_status")
        )
        if rights_ok:
            checks["rights"] += 1
        else:
            failure_counts["rights"] += 1

        generator = record["provenance"]["generator"]
        critic = record["provenance"]["critic"]
        independence_fields = (
            "actor_id",
            "prompt_revision",
            "prompt_sha256",
            "execution_receipt_sha256",
            "context_sha256",
            "responsibility",
        )
        independence_ok = all(generator[field] != critic[field] for field in independence_fields)
        if independence_ok:
            checks["critic_independence"] += 1
        else:
            failure_counts["critic_independence"] += 1

        review = record["independent_review"]
        high_risk = record["trainer_labels"]["risk_tier"] in {"high", "critical"}
        receipts = review.get("review_receipts") or []
        approval_ok = not high_risk or (
            len(receipts) >= 2
            and len({item["reviewer_id"] for item in receipts}) >= 2
            and len({item["decision_receipt_sha256"] for item in receipts}) >= 2
            and critic["actor_id"] in {item["reviewer_id"] for item in receipts}
        )
        if approval_ok:
            checks["high_risk_two_approvals"] += 1
        else:
            failure_counts["high_risk_two_approvals"] += 1

        if not issues and record["split"] in {"train", "validation"}:
            checks["partition"] += 1
        else:
            failure_counts["partition"] += 1

        if not issues and _numeric_assertions_are_complete(record):
            checks["numeric"] += 1
        else:
            failure_counts["numeric"] += 1

        conversion_ok = False
        mask_ok = False
        truncation_ok = False
        try:
            converted = convert_and_encode(record, tokenizer, profile["max_length"])
            conversion_ok = canonical_json_bytes(
                converted["trainer_record"]
            ) == canonical_json_bytes(
                trainer,
            )
            mask_ok = _mask_is_assistant_only(converted["encoded"])
            truncation_ok = converted["silent_truncation"] is False
            converted_records.append(converted["trainer_record"])
        except (DataFactoryError, ValueError, KeyError):
            converted = None
        for name, passed in (
            ("production_trainer_conversion", conversion_ok),
            ("assistant_only_masking", mask_ok),
            ("truncation_rejected", truncation_ok),
            ("token_profile", converted is not None),
        ):
            if passed:
                checks[name] += 1
            else:
                failure_counts[name] += 1
        route_splits[(record["route"], record["split"])] += 1

    try:
        validate_partition_groups(list(authoring_records))
    except PartitionRegistryError as exc:
        raise FoundationExecutionEvidenceError("collection partition validation failed") from exc
    exact_duplicates = find_exact_duplicates(converted_records)
    semantic_duplicates = find_semantic_neighbors(
        converted_records,
        shingle_size=5,
        threshold=0.92,
    )
    total = len(authoring_records)
    if any(value != total for value in checks.values()) or any(failure_counts.values()):
        raise FoundationExecutionEvidenceError("one or more per-record admission gates failed")
    return {
        "records_checked": total,
        "checks": dict(sorted(checks.items())),
        "failure_counts": dict(sorted(failure_counts.items())),
        "exact_duplicate_groups": len(exact_duplicates),
        "semantic_duplicate_pairs": len(semantic_duplicates),
        "route_split_counts": {
            route: {
                split: route_splits[(route, split)]
                for split in ("train", "validation")
                if route_splits[(route, split)]
            }
            for route in sorted({route for route, _ in route_splits})
        },
        "record_identifiers_disclosed": 0,
    }


def validate_foundation_artifact(
    *,
    root: Path,
    source_packet_root: Path,
    pilot: bool,
    artifact_label: str | None = None,
    expected_counts: Mapping[str, int] | None = None,
    expected_execution_id: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate one finalized private artifact and return only sanitized admission facts."""

    if pilot and (
        artifact_label is not None
        or expected_counts is not None
        or expected_execution_id is not None
    ):
        raise FoundationExecutionEvidenceError(
            "pilot admission does not accept a live-data boundary override"
        )
    label = "pilot" if pilot else artifact_label or "first_live_data_shard"
    absolute = _private_root(root, label)
    inventory = secure_inventory(absolute, label)
    report, report_name, expected_count = _report_boundary(absolute, pilot=pilot)
    expected_status = "APPROVED_PILOT_NOT_RELEASE" if pilot else "ACCEPTED_PRIVATE_NOT_RELEASED"
    authoring, authoring_manifest = _manifest_records(
        absolute,
        "authoring-manifest.json",
        expected_status,
    )
    trainer, trainer_manifest = _manifest_records(
        absolute,
        "trainer-manifest.json",
        expected_status,
    )
    if len(authoring) != expected_count or len(trainer) != expected_count:
        raise FoundationExecutionEvidenceError(f"{label} record count drifted")
    packets, source_packet_inventory = _source_packets(
        source_packet_root,
        f"{label}_source_packets",
    )
    per_record = _per_record_admission(authoring, trainer, packets)
    if per_record["exact_duplicate_groups"] or per_record["semantic_duplicate_pairs"]:
        raise FoundationExecutionEvidenceError(f"{label} duplicate gate failed")
    profile_path = absolute / "token-profile.json"
    profile = _load_object(profile_path, f"{label} token profile")
    validate_schema(profile, "foundation_token_profile.schema.json", f"{label} token profile")
    if profile != token_profile():
        raise FoundationExecutionEvidenceError(f"{label} token profile drifted")

    if pilot:
        progression = report.get("automatic_progression")
        if (
            not isinstance(progression, dict)
            or progression.get("target") != "live_data_150_records_135_train_15_validation"
        ):
            raise FoundationExecutionEvidenceError("pilot progression target drifted")
        decision = "NOT_ADMITTED"
        reason = "PILOT_ARTIFACT_EXPLICITLY_NOT_RELEASE"
    else:
        # The stricter comparison loader re-verifies the accepted trainer boundary.
        try:
            load_accepted_foundation(
                absolute,
                expected_counts=FOUNDATION_COUNTS if expected_counts is None else expected_counts,
                expected_execution_id=expected_execution_id,
            )
        except FoundationEvaluationComparisonError as exc:
            raise FoundationExecutionEvidenceError("accepted Foundation boundary failed") from exc
        decision = "ADMITTED"
        reason = "ALL_PER_RECORD_AND_COLLECTION_GATES_PASS"
    sanitized = {
        "artifact": label,
        "decision": decision,
        "reason": reason,
        "record_count": expected_count,
        "report_status": report["status"],
        "manifest_status": authoring_manifest["status"],
        "trainer_manifest_status": trainer_manifest["status"],
        "reported_counts": report["counts"],
        "reported_gates": report["gates"],
        "per_record_admission": per_record,
        "token_profile": {
            "present": True,
            "profile_id": profile["profile_id"],
            "status": profile["status"],
            "training_tokenizer_equivalent": profile["training_tokenizer_equivalent"],
            "sha256": _sha256_file(profile_path),
        },
        "inventory": inventory,
        "source_packet_inventory": source_packet_inventory,
        "bindings": {
            "authoring_manifest_sha256": _sha256_file(absolute / "authoring-manifest.json"),
            "trainer_manifest_sha256": _sha256_file(absolute / "trainer-manifest.json"),
            "report_sha256": _sha256_file(absolute / report_name),
            "sha256sums_sha256": inventory["sha256sums_sha256"],
            "source_packet_content_inventory_sha256": source_packet_inventory[
                "content_inventory_sha256"
            ],
        },
    }
    return sanitized, authoring


def validate_semantic_evidence(
    *,
    semantic_root: Path,
    comparison_root: Path,
    accepted_root: Path,
) -> dict[str, Any]:
    """Reproduce semantic boundaries and compose internal plus Foundation proofs."""

    semantic_inventory = secure_inventory(semantic_root, "semantic_r5")
    comparison_inventory = secure_inventory(comparison_root, "semantic_comparison")
    try:
        partitions, semantic_manifest, semantic_bindings = load_semantic_r5(semantic_root)
        _, _, foundation_bindings = load_accepted_foundation(accepted_root)
    except FoundationEvaluationComparisonError as exc:
        raise FoundationExecutionEvidenceError("semantic or Foundation binding failed") from exc
    answer_key_cases = 0
    invalid_cases = 0
    for partition, records in partitions.items():
        for record in records:
            issues = validate_semantic_case(record)
            if issues:
                invalid_cases += 1
            if record.get("privacy", {}).get("contains_gold_answers") is not False or any(
                key in record for key in ("answer", "answer_key", "expected_answer", "gold")
            ):
                answer_key_cases += 1
        if len(records) != PARTITION_COUNTS[partition]:
            raise FoundationExecutionEvidenceError("semantic partition count drifted")
    if (
        invalid_cases
        or answer_key_cases
        or semantic_manifest.get("contains_answer_keys") is not False
    ):
        raise FoundationExecutionEvidenceError("semantic schema or answer-key boundary failed")
    report = _load_object(comparison_root / "comparison-report.json", "semantic comparison")
    comparisons = report.get("comparisons")
    if (
        report.get("schema_version") != "dime-foundation-private-evaluation-comparison-v1"
        or report.get("status") != "PASS_ZERO_DISALLOWED_OVERLAP"
        or report.get("summary")
        != {
            "disallowed_overlap_count": 0,
            "pair_comparisons": 97650,
            "zero_disallowed_overlap": True,
        }
        or report.get("external_operations") != EXTERNAL_OPERATIONS
        or not isinstance(comparisons, dict)
        or set(comparisons) != set(PARTITION_COUNTS)
        or report.get("foundation_bindings") != foundation_bindings
        or report.get("semantic_r5_bindings") != semantic_bindings
    ):
        raise FoundationExecutionEvidenceError("semantic comparison boundary drifted")
    for partition, expected_count in PARTITION_COUNTS.items():
        comparison = comparisons[partition]
        if (
            comparison.get("evaluation_cases") != expected_count
            or comparison.get("foundation_records") != 150
            or comparison.get("pair_comparisons") != expected_count * 150
            or comparison.get("collision_count") != 0
            or comparison.get("collisions") != []
            or comparison.get("status") != "PASS"
        ):
            raise FoundationExecutionEvidenceError("semantic comparison partition drifted")
    cross_suite_case_pairs = sum(
        PARTITION_COUNTS[left] * PARTITION_COUNTS[right]
        for index, left in enumerate(PARTITION_COUNTS)
        for right in tuple(PARTITION_COUNTS)[index + 1 :]
    )
    return {
        "status": "PASS",
        "semantic_only": True,
        "case_count": sum(PARTITION_COUNTS.values()),
        "partition_counts": PARTITION_COUNTS,
        "answer_key_case_count": 0,
        "answer_key_artifact_count": 0,
        "schema_failure_count": 0,
        "evaluation_cross_suite_non_overlap": {
            "suite_relationships_evaluated": 6,
            "cross_suite_case_pair_comparisons": cross_suite_case_pairs,
            "disallowed_overlap_count": 0,
            "status": "PASS_ZERO_DISALLOWED_OVERLAP",
        },
        "foundation_to_evaluation_non_overlap": {
            "comparisons_completed": 4,
            "pair_comparisons": 97650,
            "disallowed_overlap_count": 0,
            "status": "PASS_ZERO_DISALLOWED_OVERLAP",
        },
        "composite_non_overlap": {
            "semantic_manifest_release_proof_complete": False,
            "semantic_manifest_blocker": semantic_manifest["release_blocker"],
            "foundation_gap_closed_by_separate_comparison": True,
            "status": "PASS_COMPOSITE_PROOF_COMPLETE",
        },
        "semantic_inventory": semantic_inventory,
        "comparison_inventory": comparison_inventory,
        "bindings": {
            **semantic_bindings,
            "comparison_report_sha256": _sha256_file(comparison_root / "comparison-report.json"),
            "comparison_sha256sums_sha256": comparison_inventory["sha256sums_sha256"],
        },
    }


def route_deficits(
    admitted_records: Sequence[Mapping[str, Any]],
    *,
    release_plan: Mapping[str, Any],
) -> dict[str, Any]:
    """Calculate exact route/split deficits from admitted records only."""

    targets = release_plan.get("route_mixture")
    if not isinstance(targets, dict) or not targets:
        raise FoundationExecutionEvidenceError("release route mixture is absent")
    admitted = Counter((str(record["route"]), str(record["split"])) for record in admitted_records)
    unknown_routes = sorted({route for route, _ in admitted} - set(targets))
    if unknown_routes:
        raise FoundationExecutionEvidenceError("admitted records contain an unknown route")
    routes: dict[str, Any] = {}
    target_total = 0
    admitted_total = 0
    deficit_total = 0
    for route, target in targets.items():
        target_train = target["train"]
        target_validation = target["validation"]
        admitted_train = admitted[(route, "train")]
        admitted_validation = admitted[(route, "validation")]
        if admitted_train > target_train or admitted_validation > target_validation:
            raise FoundationExecutionEvidenceError("admitted route exceeds its frozen allocation")
        deficit_train = target_train - admitted_train
        deficit_validation = target_validation - admitted_validation
        route_admitted = admitted_train + admitted_validation
        route_deficit = deficit_train + deficit_validation
        routes[route] = {
            "target": target,
            "admitted": {
                "total": route_admitted,
                "train": admitted_train,
                "validation": admitted_validation,
            },
            "deficit": {
                "total": route_deficit,
                "train": deficit_train,
                "validation": deficit_validation,
            },
        }
        target_total += target["total"]
        admitted_total += route_admitted
        deficit_total += route_deficit
    return {
        "calculation_basis": "ADMITTED_RECORDS_ONLY",
        "target_profile": "dime-foundation-v1-route-mixture",
        "target_records": target_total,
        "admitted_records": admitted_total,
        "remaining_records": deficit_total,
        "target_split": {
            "train": sum(item["train"] for item in targets.values()),
            "validation": sum(item["validation"] for item in targets.values()),
        },
        "admitted_split": {
            "train": sum(count for (route, split), count in admitted.items() if split == "train"),
            "validation": sum(
                count for (route, split), count in admitted.items() if split == "validation"
            ),
        },
        "remaining_split": {
            "train": sum(item["deficit"]["train"] for item in routes.values()),
            "validation": sum(item["deficit"]["validation"] for item in routes.values()),
        },
        "routes": routes,
        "complete_release": deficit_total == 0,
    }


def _public_file(path: Path, content: bytes) -> str:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise
    return _sha256_file(path)


def validate_evidence_document(document: Mapping[str, Any]) -> None:
    schema = _load_object(EVIDENCE_SCHEMA_PATH, "Foundation execution evidence schema")
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(document),
        key=lambda error: tuple(str(part) for part in error.absolute_path),
    )
    if errors:
        error = errors[0]
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        raise FoundationExecutionEvidenceError(f"public evidence.{location}: {error.message}")
    ledger_inventories = [
        document["private_inventory_bindings"][name]
        for name in (
            "protected_recovery",
            "pilot",
            "first_live_data_shard",
            "semantic_r5",
            "semantic_comparison",
        )
    ]
    for inventory in ledger_inventories:
        if (
            inventory["total_file_count"]
            != inventory["payload_file_count"] + inventory["checksum_ledger_file_count"]
            or inventory["total_byte_count"]
            != inventory["payload_byte_count"] + inventory["checksum_ledger_byte_count"]
        ):
            raise FoundationExecutionEvidenceError(
                "public evidence inventory payload/ledger totals do not reconcile"
            )


def _readme(evidence: Mapping[str, Any]) -> str:
    deficits = evidence["foundation_deficits"]
    semantic = evidence["semantic_evaluation"]
    admitted = evidence["admission"]["first_live_data_shard"]["record_count"]
    remaining_train = deficits["remaining_split"]["train"]
    remaining_validation = deficits["remaining_split"]["validation"]
    return f"""# Foundation execution evidence v1

This directory contains sanitized, aggregate-only evidence. It contains no private
Foundation records, semantic cases, answer keys, credentials, or provider output.

## Admission result

- Pilot: not admitted (`PILOT_ARTIFACT_EXPLICITLY_NOT_RELEASE`).
- First live-data shard: {admitted} records admitted.
- Complete Foundation target: {deficits["target_records"]} records.
- Remaining deficit: {deficits["remaining_records"]} records.
- Training/validation deficit: {remaining_train} / {remaining_validation}.

## Semantic result

The private semantic suites reproduce {semantic["case_count"]} cases across development,
sealed critical, locked, and general regression. Answer-key-bearing cases and artifacts
are both zero. Internal evaluation cross-suite isolation covers
{semantic["evaluation_cross_suite_non_overlap"]["cross_suite_case_pair_comparisons"]}
case pairs with zero disallowed overlap. The separate Foundation-to-evaluation
comparison completed
{semantic["foundation_to_evaluation_non_overlap"]["pair_comparisons"]} pairs with zero
disallowed overlap, closing the semantic manifest's explicit Foundation-availability gap.

## Reproduction

Run from `ml/dime-1.0` with private paths supplied locally:

```bash
python scripts/compare_foundation_to_private_evaluation.py \\
  --accepted-root <accepted-foundation-root> \\
  --semantic-root <semantic-r5-root> \\
  --output-root <new-private-comparison-root> \\
  --comparison-id foundation-live-data-semantic-r5-release-reproduction-v1

python scripts/freeze_foundation_execution_evidence.py \\
  --pilot-root <finalized-pilot-root> \\
  --pilot-source-packet-root <pilot-source-packet-root> \\
  --accepted-root <accepted-foundation-root> \\
  --accepted-source-packet-root <accepted-source-packet-root> \\
  --semantic-root <semantic-r5-root> \\
  --comparison-root <private-comparison-root> \\
  --recovery-root <protected-recovery-root> \\
  --output-root <new-public-evidence-root> \\
  --base-commit {evidence["context_capsule"]["repository"]["base_commit"]} \\
  --created-at <canonical-utc-timestamp>
```

Verification:

```bash
sha256sum -c SHA256SUMS
python scripts/validate_governed_json.py
pytest -q
```

No command above authorizes training, publication, deployment, provider execution,
route activation, model download, credential access, or Railway mutation.
"""


def freeze_public_evidence(
    *,
    pilot_root: Path,
    pilot_source_packet_root: Path,
    accepted_root: Path,
    accepted_source_packet_root: Path,
    semantic_root: Path,
    comparison_root: Path,
    recovery_root: Path,
    output_root: Path,
    base_commit: str,
    created_at: str,
) -> dict[str, Any]:
    """Validate immutable inputs and create one new sanitized public evidence directory."""

    if not re.fullmatch(r"[0-9a-f]{40}", base_commit):
        raise FoundationExecutionEvidenceError("base commit must be a full Git SHA")
    try:
        parsed = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise FoundationExecutionEvidenceError("created_at must be canonical UTC") from exc
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != created_at:
        raise FoundationExecutionEvidenceError("created_at must be canonical UTC")

    pilot, _ = validate_foundation_artifact(
        root=pilot_root,
        source_packet_root=pilot_source_packet_root,
        pilot=True,
    )
    accepted, admitted_records = validate_foundation_artifact(
        root=accepted_root,
        source_packet_root=accepted_source_packet_root,
        pilot=False,
    )
    semantic = validate_semantic_evidence(
        semantic_root=semantic_root,
        comparison_root=comparison_root,
        accepted_root=accepted_root,
    )
    recovery_inventory = secure_inventory(recovery_root, "protected_recovery")
    release_plan = _load_object(RELEASE_PLAN_PATH, "Foundation release plan")
    deficits = route_deficits(admitted_records, release_plan=release_plan)
    if pilot["decision"] != "NOT_ADMITTED" or accepted["decision"] != "ADMITTED":
        raise FoundationExecutionEvidenceError("admission decision boundary drifted")
    if deficits["admitted_records"] != accepted["record_count"]:
        raise FoundationExecutionEvidenceError("deficits include non-admitted records")

    evidence = {
        "schema_version": "dime-foundation-execution-evidence-v1",
        "evidence_id": "dime-llm-v1-foundation-001",
        "created_at": created_at,
        "classification": "SANITIZED_AGGREGATE_ONLY",
        "private_content_counts": {
            "foundation_records": 0,
            "semantic_cases": 0,
            "answer_keys": 0,
            "credentials": 0,
        },
        "admission": {
            "pilot": pilot,
            "first_live_data_shard": accepted,
            "admitted_artifacts": ["first_live_data_shard"],
            "excluded_artifacts": ["pilot"],
            "admitted_record_count": accepted["record_count"],
        },
        "foundation_deficits": deficits,
        "semantic_evaluation": semantic,
        "private_inventory_bindings": {
            "protected_recovery": recovery_inventory,
            "pilot": pilot["inventory"],
            "pilot_source_packets": pilot["source_packet_inventory"],
            "first_live_data_shard": accepted["inventory"],
            "first_live_data_source_packets": accepted["source_packet_inventory"],
            "semantic_r5": semantic["semantic_inventory"],
            "semantic_comparison": semantic["comparison_inventory"],
        },
        "findings": [
            {
                "finding": "pilot excluded from release admission",
                "status": "CONFIRMED",
                "impact": "pilot records do not reduce the 2,400-record deficit",
            },
            {
                "finding": "first live-data shard admitted",
                "status": "CONFIRMED",
                "impact": "150 records reduce only the live_data route allocation",
            },
            {
                "finding": "complete Foundation release remains incomplete",
                "status": "CONFIRMED",
                "impact": f"{deficits['remaining_records']} records remain",
            },
            {
                "finding": "semantic r5 cross-suite non-overlap reproduced",
                "status": "CONFIRMED",
                "impact": "148,770 internal cross-suite case pairs found zero disallowed overlap",
            },
            {
                "finding": "Foundation-to-evaluation non-overlap reproduced",
                "status": "CONFIRMED",
                "impact": "97,650 Foundation-to-evaluation pairs found zero disallowed overlap",
            },
        ],
        "context_capsule": {
            "repository": {
                "branch": "agent/foundation-execution-evidence-v1",
                "base_commit": base_commit,
            },
            "private_source_commit": "b9ba7788749365253a6f725fee2a2a367a3475dd",
            "release_plan": {
                "path": "ml/dime-1.0/configs/foundation_release_plan_v1.json",
                "sha256": _sha256_file(RELEASE_PLAN_PATH),
                "status": release_plan["status"],
            },
            "governing_implementations": {
                relative: _sha256_file(ML_ROOT / relative)
                for relative in (
                    "src/dime_ai/foundation_data_factory.py",
                    "src/dime_ai/foundation_execution_evidence.py",
                    "src/dime_ai/foundation_private_evaluation_comparison.py",
                    "src/dime_ai/private_evaluation_semantics.py",
                )
            },
            "external_operations": EXTERNAL_OPERATIONS,
            "authorization_boundary": AUTHORIZATION_BOUNDARY,
        },
    }
    validate_evidence_document(evidence)
    output = output_root.absolute()
    if output.exists() or output.is_symlink():
        raise FoundationExecutionEvidenceError("public evidence output already exists")
    output.mkdir(mode=0o755, parents=False)
    evidence_bytes = canonical_json_bytes(evidence)
    evidence_hash = _public_file(output / "evidence.json", evidence_bytes)
    readme_hash = _public_file(output / "README.md", _readme(evidence).encode("utf-8"))
    sums = (f"{readme_hash}  README.md\n{evidence_hash}  evidence.json\n").encode()
    sums_hash = _public_file(output / "SHA256SUMS", sums)
    return {
        "status": "PASS",
        "admitted_records": deficits["admitted_records"],
        "remaining_records": deficits["remaining_records"],
        "semantic_cross_suite_pair_comparisons": semantic["evaluation_cross_suite_non_overlap"][
            "cross_suite_case_pair_comparisons"
        ],
        "foundation_evaluation_pair_comparisons": semantic["foundation_to_evaluation_non_overlap"][
            "pair_comparisons"
        ],
        "answer_keys": 0,
        "bindings": {
            "readme_sha256": readme_hash,
            "evidence_sha256": evidence_hash,
            "sha256sums_sha256": sums_hash,
        },
    }


def _repository_evaluation_records() -> list[dict[str, Any]]:
    """Load only public repository evaluation prompts for contamination checks."""

    records: list[dict[str, Any]] = []

    def walk(value: object) -> None:
        if isinstance(value, dict):
            if isinstance(value.get("case_id"), str) and isinstance(value.get("messages"), list):
                records.append(value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    for path in sorted((ML_ROOT / "data" / "eval").glob("*")):
        if path.suffix == ".jsonl":
            values = [
                loads_governed_json(line, source=f"repository evaluation {path.name}")
                for line in path.read_bytes().splitlines(keepends=True)
                if line.strip()
            ]
        elif path.suffix == ".json":
            values = [load_governed_json(path, source=f"repository evaluation {path.name}")]
        else:
            continue
        for value in values:
            walk(value)
    if not records:
        raise FoundationExecutionEvidenceError("repository evaluation prompt inventory is empty")
    return records


def validate_live_data_continuation(
    *,
    first_root: Path,
    first_source_packet_root: Path,
    second_root: Path,
    second_source_packet_root: Path,
    semantic_root: Path,
) -> dict[str, Any]:
    """Reproduce the closed combined-300 continuation boundary without private output."""

    first, first_authoring = validate_foundation_artifact(
        root=first_root,
        source_packet_root=first_source_packet_root,
        pilot=False,
        artifact_label="first_live_data_shard",
        expected_counts=FOUNDATION_COUNTS,
        expected_execution_id="foundation-live-data-shard-001-accepted-b9ba7788",
    )
    second, second_authoring = validate_foundation_artifact(
        root=second_root,
        source_packet_root=second_source_packet_root,
        pilot=False,
        artifact_label="second_live_data_shard",
        expected_counts=SECOND_LIVE_DATA_SHARD_COUNTS,
        expected_execution_id="foundation-live-data-shard-002-ae039e87",
    )
    first_trainers, _, _ = load_accepted_foundation(
        first_root,
        expected_counts=FOUNDATION_COUNTS,
        expected_execution_id="foundation-live-data-shard-001-accepted-b9ba7788",
    )
    second_trainers, second_report, _ = load_accepted_foundation(
        second_root,
        expected_counts=SECOND_LIVE_DATA_SHARD_COUNTS,
        expected_execution_id="foundation-live-data-shard-002-ae039e87",
    )
    authoring = first_authoring + second_authoring
    trainers = first_trainers + second_trainers
    if len(authoring) != 300 or len(trainers) != 300:
        raise FoundationExecutionEvidenceError("combined live-data record inventory drifted")
    if Counter(record["route"] for record in authoring) != {"live_data": 300}:
        raise FoundationExecutionEvidenceError("combined route boundary drifted")
    if Counter(record["split"] for record in authoring) != {
        "train": 270,
        "validation": 30,
    }:
        raise FoundationExecutionEvidenceError("combined split boundary drifted")

    try:
        partition_registry = validate_partition_groups(authoring)
    except PartitionRegistryError as exc:
        raise FoundationExecutionEvidenceError("combined partition gate failed") from exc
    exact = find_exact_duplicates(trainers)
    semantic_duplicates = find_semantic_neighbors(
        trainers,
        shingle_size=5,
        threshold=0.92,
    )
    repository_overlap = _development_contamination(
        trainers,
        _repository_evaluation_records(),
        shingle_size=5,
        threshold=0.80,
    )
    try:
        semantic_cases, semantic_manifest, semantic_bindings = load_semantic_r5(semantic_root)
        comparisons, collisions = compare_partitions(trainers, semantic_cases)
    except FoundationEvaluationComparisonError as exc:
        raise FoundationExecutionEvidenceError("combined semantic boundary failed") from exc

    invalid_semantic_cases = 0
    answer_key_cases = 0
    for partition, records in semantic_cases.items():
        if len(records) != PARTITION_COUNTS[partition]:
            raise FoundationExecutionEvidenceError("semantic partition count drifted")
        for record in records:
            if validate_semantic_case(record):
                invalid_semantic_cases += 1
            if record.get("privacy", {}).get("contains_gold_answers") is not False or any(
                key in record for key in ("answer", "answer_key", "expected_answer", "gold")
            ):
                answer_key_cases += 1
    if (
        invalid_semantic_cases
        or answer_key_cases
        or semantic_manifest.get("contains_answer_keys") is not False
    ):
        raise FoundationExecutionEvidenceError("semantic schema or answer-key boundary failed")

    second_absolute = _private_root(second_root, "second_live_data_shard")
    cross_report_path = second_absolute / "cross-shard-report.json"
    cross_report = _load_object(cross_report_path, "combined cross-shard report")
    expected_gates = {
        "partition_collisions": 0,
        "exact_duplicates": 0,
        "semantic_duplicate_pairs": 0,
        "repository_evaluation_overlap": 0,
        "private_semantic_overlap": 0,
    }
    reported_semantic = cross_report.get("private_semantic_comparison")
    if (
        cross_report.get("schema_version") != "dime-foundation-cross-shard-gate-report-v1"
        or cross_report.get("execution_id") != "foundation-live-data-shard-002-ae039e87"
        or cross_report.get("prior_execution_id")
        != "foundation-live-data-shard-001-accepted-b9ba7788"
        or cross_report.get("combined_record_count") != 300
        or cross_report.get("combined_split") != {"train": 270, "validation": 30}
        or cross_report.get("route_counts") != {"live_data": 300}
        or cross_report.get("gates") != expected_gates
        or cross_report.get("admission") != second["per_record_admission"]
        or not isinstance(reported_semantic, dict)
        or reported_semantic.get("pair_comparisons") != 195300
        or reported_semantic.get("collision_count") != 0
        or reported_semantic.get("status") != "PASS_ZERO_DISALLOWED_OVERLAP"
        or reported_semantic.get("semantic_bindings") != semantic_bindings
        or second_report.get("artifact_bindings", {}).get("cross_shard_report_sha256")
        != _sha256_file(cross_report_path)
    ):
        raise FoundationExecutionEvidenceError("combined cross-shard report boundary drifted")
    reported_partitions = reported_semantic.get("partitions")
    if not isinstance(reported_partitions, dict) or set(reported_partitions) != set(
        PARTITION_COUNTS
    ):
        raise FoundationExecutionEvidenceError("combined semantic partition report drifted")
    for partition, case_count in PARTITION_COUNTS.items():
        comparison = comparisons[partition]
        reported = reported_partitions[partition]
        expected = {
            "foundation_records": 300,
            "evaluation_cases": case_count,
            "pair_comparisons": 300 * case_count,
            "collision_count": 0,
            "status": "PASS",
        }
        if (
            comparison["foundation_records"] != 300
            or comparison["evaluation_cases"] != case_count
            or comparison["pair_comparisons"] != 300 * case_count
            or comparison["collision_count"] != 0
            or comparison["collisions"] != []
            or comparison["status"] != "PASS"
            or reported != expected
        ):
            raise FoundationExecutionEvidenceError("combined semantic comparison partition drifted")

    recorded_registry = _load_object(
        second_absolute / "partition-registry.json",
        "combined partition registry",
    )
    if recorded_registry != partition_registry:
        raise FoundationExecutionEvidenceError("combined partition registry binding drifted")
    source_selection = _load_object(
        second_absolute / "source-selection-manifest.json",
        "second source selection",
    )
    first_task_types = {record["task_type"] for record in first_authoring}
    second_task_types = {record["task_type"] for record in second_authoring}
    selected_task_types = source_selection.get("genuinely_new_task_types")
    if (
        source_selection.get("schema_version") != "dime-foundation-source-selection-manifest-v1"
        or source_selection.get("execution_id") != "foundation-live-data-shard-002-ae039e87"
        or source_selection.get("selected_route") != "live_data"
        or source_selection.get("record_count") != 150
        or source_selection.get("source_packet_count") != 5
        or source_selection.get("prior_task_type_overlap") != 0
        or source_selection.get("source_rights_statuses") != ["approved_internal"]
        or source_selection.get("public_raw_distribution_authorized") is not False
        or not isinstance(selected_task_types, list)
        or set(selected_task_types) != second_task_types
        or len(second_task_types) != 15
        or first_task_types & second_task_types
    ):
        raise FoundationExecutionEvidenceError("second source selection drifted")

    if exact or semantic_duplicates or repository_overlap or collisions:
        raise FoundationExecutionEvidenceError(
            "combined deduplication or evaluation-overlap gate failed"
        )
    release_plan = _load_object(RELEASE_PLAN_PATH, "Foundation release plan")
    deficits = route_deficits(authoring, release_plan=release_plan)
    if (
        deficits["admitted_records"] != 300
        or deficits["remaining_records"] != 2100
        or deficits["admitted_split"] != {"train": 270, "validation": 30}
        or deficits["remaining_split"] != {"train": 1890, "validation": 210}
        or deficits["routes"]["live_data"]["deficit"] != {"total": 0, "train": 0, "validation": 0}
    ):
        raise FoundationExecutionEvidenceError("combined Foundation deficit calculation drifted")
    semantic_inventory = secure_inventory(semantic_root, "semantic_r5")
    cross_suite_case_pairs = sum(
        PARTITION_COUNTS[left] * PARTITION_COUNTS[right]
        for index, left in enumerate(PARTITION_COUNTS)
        for right in tuple(PARTITION_COUNTS)[index + 1 :]
    )
    return {
        "admission": {
            "first_live_data_shard": first,
            "second_live_data_shard": second,
            "admitted_artifacts": [
                "first_live_data_shard",
                "second_live_data_shard",
            ],
            "admitted_record_count": 300,
        },
        "combined_gate": {
            "record_count": 300,
            "split": {"train": 270, "validation": 30},
            "route_counts": {"live_data": 300},
            "gates": expected_gates,
            "new_source_coverage": {
                "source_packet_count": 5,
                "new_task_type_count": 15,
                "prior_task_type_overlap": 0,
                "public_raw_distribution_authorized": False,
            },
            "cross_shard_report_sha256": _sha256_file(cross_report_path),
            "partition_registry_sha256": _sha256_file(second_absolute / "partition-registry.json"),
        },
        "foundation_deficits": deficits,
        "semantic_evaluation": {
            "status": "PASS",
            "semantic_only": True,
            "case_count": sum(PARTITION_COUNTS.values()),
            "partition_counts": PARTITION_COUNTS,
            "answer_key_case_count": 0,
            "answer_key_artifact_count": 0,
            "schema_failure_count": 0,
            "evaluation_cross_suite_non_overlap": {
                "suite_relationships_evaluated": 6,
                "cross_suite_case_pair_comparisons": cross_suite_case_pairs,
                "disallowed_overlap_count": 0,
                "status": "PASS_ZERO_DISALLOWED_OVERLAP",
            },
            "foundation_to_evaluation_non_overlap": {
                "foundation_records": 300,
                "comparisons_completed": 4,
                "pair_comparisons": 195300,
                "disallowed_overlap_count": 0,
                "status": "PASS_ZERO_DISALLOWED_OVERLAP",
            },
            "composite_non_overlap": {
                "semantic_manifest_release_proof_complete": False,
                "semantic_manifest_blocker": semantic_manifest["release_blocker"],
                "foundation_gap_closed_by_separate_comparison": True,
                "status": "PASS_COMPOSITE_PROOF_COMPLETE",
            },
            "semantic_inventory": semantic_inventory,
            "bindings": semantic_bindings,
        },
        "private_inventory_bindings": {
            "first_live_data_shard": first["inventory"],
            "first_live_data_source_packets": first["source_packet_inventory"],
            "second_live_data_shard": second["inventory"],
            "second_live_data_source_packets": second["source_packet_inventory"],
            "semantic_r5": semantic_inventory,
        },
    }


def validate_continuation_evidence_document(document: Mapping[str, Any]) -> None:
    """Validate the sanitized continuation evidence schema and cross-field totals."""

    schema = _load_object(
        CONTINUATION_EVIDENCE_SCHEMA_PATH,
        "Foundation continuation evidence schema",
    )
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(document),
        key=lambda error: tuple(str(part) for part in error.absolute_path),
    )
    if errors:
        error = errors[0]
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        raise FoundationExecutionEvidenceError(f"continuation evidence.{location}: {error.message}")
    for name in (
        "first_live_data_shard",
        "second_live_data_shard",
        "semantic_r5",
    ):
        inventory = document["private_inventory_bindings"][name]
        if (
            inventory["total_file_count"]
            != inventory["payload_file_count"] + inventory["checksum_ledger_file_count"]
            or inventory["total_byte_count"]
            != inventory["payload_byte_count"] + inventory["checksum_ledger_byte_count"]
        ):
            raise FoundationExecutionEvidenceError(
                "continuation evidence inventory totals do not reconcile"
            )
    if (
        document["admission"]["admitted_record_count"]
        != sum(
            document["admission"][name]["record_count"]
            for name in ("first_live_data_shard", "second_live_data_shard")
        )
        or document["semantic_evaluation"]["foundation_to_evaluation_non_overlap"][
            "pair_comparisons"
        ]
        != document["admission"]["admitted_record_count"]
        * document["semantic_evaluation"]["case_count"]
    ):
        raise FoundationExecutionEvidenceError(
            "continuation evidence aggregate totals do not reconcile"
        )


def _continuation_readme(evidence: Mapping[str, Any]) -> str:
    deficits = evidence["foundation_deficits"]
    semantic = evidence["semantic_evaluation"]
    return f"""# Foundation continuation evidence v1

This directory contains sanitized, aggregate-only evidence for the second
live-data shard and the cumulative live-data boundary. It contains no private
Foundation records, semantic cases, answer keys, credentials, or provider output.

## Admission result

- First live-data shard: 150 records admitted.
- Second live-data shard: 150 genuinely new records admitted.
- Combined live-data route: 300 records (270 train / 30 validation).
- Complete Foundation target: {deficits["target_records"]} records.
- Remaining deficit: {deficits["remaining_records"]} records
  ({deficits["remaining_split"]["train"]} train /
  {deficits["remaining_split"]["validation"]} validation).

Every combined partition, exact-duplicate, semantic-duplicate,
repository-evaluation-overlap, and private-semantic-overlap gate is zero. The
second shard contributes 15 new task types from five checksum-bound source packets
with zero prior task-type overlap.

## Semantic result

The authoritative semantic-only r5 suite contains {semantic["case_count"]} cases
and zero answer keys. Internal cross-suite isolation covers
{semantic["evaluation_cross_suite_non_overlap"]["cross_suite_case_pair_comparisons"]}
case pairs with zero disallowed overlap. The cumulative 300 Foundation records
complete
{semantic["foundation_to_evaluation_non_overlap"]["pair_comparisons"]}
Foundation-to-evaluation comparisons with zero disallowed overlap.

## Verification

From `ml/dime-1.0`:

```bash
sha256sum -c evidence/execution/dime-llm-v1-foundation-002/SHA256SUMS
python scripts/validate_governed_json.py
pytest -q
```

No command or evidence here authorizes training, publication, deployment,
provider execution, route activation, model download, credential access, or
Railway mutation.
"""


def freeze_continuation_evidence(
    *,
    first_root: Path,
    first_source_packet_root: Path,
    second_root: Path,
    second_source_packet_root: Path,
    semantic_root: Path,
    output_root: Path,
    base_commit: str,
    corrective_commit: str,
    created_at: str,
) -> dict[str, Any]:
    """Create one new sanitized evidence artifact for the combined-300 boundary."""

    for label, value in (
        ("base commit", base_commit),
        ("corrective commit", corrective_commit),
    ):
        if re.fullmatch(r"[0-9a-f]{40}", value) is None:
            raise FoundationExecutionEvidenceError(f"{label} must be a full Git SHA")
    try:
        parsed = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise FoundationExecutionEvidenceError("created_at must be canonical UTC") from exc
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != created_at or parsed > datetime.now(UTC):
        raise FoundationExecutionEvidenceError("created_at must be canonical non-future UTC")

    continuation = validate_live_data_continuation(
        first_root=first_root,
        first_source_packet_root=first_source_packet_root,
        second_root=second_root,
        second_source_packet_root=second_source_packet_root,
        semantic_root=semantic_root,
    )
    release_plan = _load_object(RELEASE_PLAN_PATH, "Foundation release plan")
    evidence = {
        "schema_version": "dime-foundation-continuation-evidence-v1",
        "evidence_id": "dime-llm-v1-foundation-002",
        "created_at": created_at,
        "classification": "SANITIZED_AGGREGATE_ONLY",
        "private_content_counts": {
            "foundation_records": 0,
            "semantic_cases": 0,
            "answer_keys": 0,
            "credentials": 0,
        },
        **continuation,
        "findings": [
            {
                "finding": "second live-data shard admitted",
                "status": "CONFIRMED",
                "impact": "150 genuinely new records complete the live_data allocation",
            },
            {
                "finding": "combined live-data gates reproduced",
                "status": "CONFIRMED",
                "impact": "300 records pass all partition, deduplication, and overlap gates",
            },
            {
                "finding": "complete Foundation release remains incomplete",
                "status": "CONFIRMED",
                "impact": "2100 records remain across non-live-data routes",
            },
            {
                "finding": "semantic r5 cross-suite non-overlap reproduced",
                "status": "CONFIRMED",
                "impact": "148,770 internal cross-suite case pairs found zero disallowed overlap",
            },
            {
                "finding": "cumulative Foundation-to-evaluation non-overlap reproduced",
                "status": "CONFIRMED",
                "impact": "195,300 comparisons found zero disallowed overlap",
            },
        ],
        "context_capsule": {
            "repository": {
                "branch": "agent/foundation-next-shard-v1",
                "base_commit": base_commit,
                "corrective_commit": corrective_commit,
            },
            "input_source_commits": {
                "first_live_data_shard": "b9ba7788749365253a6f725fee2a2a367a3475dd",
                "second_live_data_shard": "ae039e8735a1a8cd4138f916ffe243df104408c0",
            },
            "release_plan": {
                "path": "ml/dime-1.0/configs/foundation_release_plan_v1.json",
                "sha256": _sha256_file(RELEASE_PLAN_PATH),
                "status": release_plan["status"],
            },
            "governing_implementations": {
                relative: _sha256_file(ML_ROOT / relative)
                for relative in (
                    "src/dime_ai/foundation_data_factory.py",
                    "src/dime_ai/foundation_execution_evidence.py",
                    "src/dime_ai/foundation_partitioning.py",
                    "src/dime_ai/foundation_private_evaluation_comparison.py",
                    "src/dime_ai/private_evaluation_semantics.py",
                )
            },
            "parallel_status": {
                "runpod_gate_1": {
                    "pull_request": 253,
                    "head_commit": "3e406ac273cafcaf9d85c19b591ca09fb802219e",
                    "state": "OPEN_DRAFT",
                    "triggered_checks": "PASS",
                    "review_required": True,
                    "independent_approval": False,
                    "merged": False,
                    "effective_authorization": False,
                },
                "credential_execution_closure": {
                    "pull_request": 255,
                    "head_commit": "2ca08f7756ecb33485d12bc0464e004f34c0e4c3",
                    "state": "OPEN_DRAFT",
                    "triggered_checks": {
                        "build": "PASS",
                        "database": "PASS",
                        "typescript": "PASS",
                        "vitest": "PASS",
                        "security_audit": "PASS",
                        "gitleaks": "PASS",
                    },
                    "path_filtered_checks": {
                        "dime_llm_validation": "NOT_TRIGGERED_PATH_FILTER",
                        "livelab": "NOT_TRIGGERED_PATH_FILTER",
                    },
                    "review_required": True,
                    "independent_approval": False,
                    "merged": False,
                    "deployed": False,
                    "root_trust_provisioned": False,
                    "effective_authorization": False,
                },
            },
            "external_operations": EXTERNAL_OPERATIONS,
            "authorization_boundary": AUTHORIZATION_BOUNDARY,
        },
    }
    validate_continuation_evidence_document(evidence)
    output = output_root.absolute()
    if output.exists() or output.is_symlink():
        raise FoundationExecutionEvidenceError("continuation evidence output already exists")
    output.mkdir(mode=0o755, parents=False)
    evidence_hash = _public_file(
        output / "evidence.json",
        canonical_json_bytes(evidence),
    )
    readme_hash = _public_file(
        output / "README.md",
        _continuation_readme(evidence).encode("utf-8"),
    )
    sums_hash = _public_file(
        output / "SHA256SUMS",
        (f"{readme_hash}  README.md\n{evidence_hash}  evidence.json\n").encode("ascii"),
    )
    return {
        "status": "PASS",
        "admitted_records": 300,
        "remaining_records": 2100,
        "foundation_evaluation_pair_comparisons": 195300,
        "answer_keys": 0,
        "bindings": {
            "readme_sha256": readme_hash,
            "evidence_sha256": evidence_hash,
            "sha256sums_sha256": sums_hash,
        },
    }
