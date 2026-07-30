"""Fail-closed Foundation-to-private-evaluation semantic comparison.

This module compares only an immutable, accepted 150-record Foundation trainer
artifact with the four semantic-only partitions in the authoritative private
evaluation r5 artifact. It never reads answer keys and never mutates either
input.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_instrumentation import validate_schema

PARTITIONS = ("development", "sealed_critical", "locked", "general_regression")
PARTITION_COUNTS = {
    "development": 270,
    "sealed_critical": 81,
    "locked": 180,
    "general_regression": 120,
}
FOUNDATION_COUNTS = {
    "accepted_records": 150,
    "trainer_records": 150,
    "train": 135,
    "validation": 15,
    "approved_originals": 50,
    "approved_repairs": 100,
    "resolved_carried_findings": 110,
}
SEMANTIC_R5_BASENAME = "evaluation-semantic-v1-b9ba7788-r5"
SEMANTIC_CLASSIFICATION = "PRIVATE_EVALUATION_SEMANTIC_CASES"
METHOD_REVISION = "dime-foundation-private-evaluation-semantic-comparison-v1"
CHARACTER_SHINGLE_SIZE = 5
CHARACTER_JACCARD_THRESHOLD = 0.92
TOKEN_BIGRAM_JACCARD_THRESHOLD = 0.86
TOKEN_PATTERN = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*", re.UNICODE)
UTC_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class FoundationEvaluationComparisonError(ValueError):
    """Raised before evidence creation when an input or boundary is invalid."""


@dataclass(frozen=True)
class SemanticMaterial:
    identifier: str
    partition: str
    normalized_prompt: str
    normalized_material: str


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise FoundationEvaluationComparisonError(f"hash input is not a regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise FoundationEvaluationComparisonError(f"duplicate governed JSON key: {key}")
        result[key] = value
    return result


def _load_json(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise FoundationEvaluationComparisonError(f"required JSON is not a regular file: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise FoundationEvaluationComparisonError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise FoundationEvaluationComparisonError(f"required JSON object is not an object: {path}")
    return value


def _load_canonical_jsonl(path: Path) -> list[dict[str, Any]]:
    if path.is_symlink() or not path.is_file():
        raise FoundationEvaluationComparisonError(f"required JSONL is not a regular file: {path}")
    records = []
    for line_number, raw in enumerate(path.read_bytes().splitlines(keepends=True), 1):
        if not raw.strip():
            raise FoundationEvaluationComparisonError(f"{path}:{line_number}: blank JSONL line")
        try:
            value = json.loads(raw, object_pairs_hook=_strict_object)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise FoundationEvaluationComparisonError(
                f"{path}:{line_number}: invalid JSONL"
            ) from error
        if not isinstance(value, dict) or raw != canonical_json_bytes(value):
            raise FoundationEvaluationComparisonError(
                f"{path}:{line_number}: record is not canonical JSON"
            )
        records.append(value)
    return records


def _validate_private_root(path: Path, label: str) -> Path:
    absolute = path.absolute()
    if not absolute.exists() or absolute.is_symlink() or not absolute.is_dir():
        raise FoundationEvaluationComparisonError(f"{label} root is not a regular directory")
    resolved = absolute.resolve(strict=True)
    if resolved != absolute:
        raise FoundationEvaluationComparisonError(f"{label} root is not canonical")
    if stat.S_IMODE(resolved.stat().st_mode) & 0o077:
        raise FoundationEvaluationComparisonError(f"{label} root is not private")
    return resolved


def _file_snapshot(root: Path) -> dict[str, str]:
    snapshot = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise FoundationEvaluationComparisonError(f"input contains symlink: {path}")
        if stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise FoundationEvaluationComparisonError(f"input is not private: {path}")
        if path.is_file():
            snapshot[path.relative_to(root).as_posix()] = _sha256_file(path)
    return snapshot


def _verify_sha256sums(root: Path) -> None:
    path = root / "SHA256SUMS"
    if path.is_symlink() or not path.is_file():
        raise FoundationEvaluationComparisonError(f"missing checksum ledger: {path}")
    seen = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\r\n]+)", line)
        if match is None:
            raise FoundationEvaluationComparisonError(f"{path}:{line_number}: invalid checksum row")
        expected, relative = match.groups()
        if relative in seen:
            raise FoundationEvaluationComparisonError(f"duplicate checksum path: {relative}")
        seen.add(relative)
        target = root / relative
        resolved = target.absolute().resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise FoundationEvaluationComparisonError(f"checksum target escapes root: {relative}")
        if _sha256_file(target) != expected:
            raise FoundationEvaluationComparisonError(f"checksum mismatch: {relative}")


def _verify_file_entries(root: Path, entries: Sequence[Mapping[str, Any]]) -> None:
    for entry in entries:
        relative = entry.get("path")
        expected = entry.get("sha256")
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise FoundationEvaluationComparisonError("manifest entry is incomplete")
        target = root / relative
        if not target.absolute().resolve(strict=True).is_relative_to(root):
            raise FoundationEvaluationComparisonError(f"manifest target escapes root: {relative}")
        if _sha256_file(target) != expected:
            raise FoundationEvaluationComparisonError(f"manifest hash mismatch: {relative}")
        if "bytes" in entry and target.stat().st_size != entry["bytes"]:
            raise FoundationEvaluationComparisonError(f"manifest size mismatch: {relative}")


def _require_zero_mapping(value: object, label: str) -> None:
    if not isinstance(value, dict) or any(item != 0 for item in value.values()):
        raise FoundationEvaluationComparisonError(f"{label} must contain only zero values")


def _canonical_utc(value: object, label: str) -> str:
    if not isinstance(value, str) or UTC_PATTERN.fullmatch(value) is None:
        raise FoundationEvaluationComparisonError(f"{label} is not canonical UTC")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as error:
        raise FoundationEvaluationComparisonError(f"{label} is not valid UTC") from error
    if parsed > datetime.now(UTC):
        raise FoundationEvaluationComparisonError(f"{label} is in the future")
    return value


def load_accepted_foundation(
    root: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, str]]:
    """Load only an immutable 150-record accepted/trainer PASS artifact."""

    accepted_root = _validate_private_root(root, "accepted Foundation")
    snapshot = _file_snapshot(accepted_root)
    _verify_sha256sums(accepted_root)
    report = _load_json(accepted_root / "final-report.json")
    if (
        report.get("schema_version") != "dime-foundation-live-data-final-report-v1"
        or report.get("status") != "PASS"
        or report.get("counts") != FOUNDATION_COUNTS
    ):
        raise FoundationEvaluationComparisonError(
            "Foundation input is not the exact accepted 150-record PASS artifact"
        )
    _require_zero_mapping(report.get("gates"), "Foundation final gates")
    if report.get("downstream_authorization") != {
        "publication": False,
        "training": False,
        "deployment": False,
        "route_activation": False,
    }:
        raise FoundationEvaluationComparisonError("Foundation downstream boundary is not closed")
    _require_zero_mapping(report.get("external_operations"), "Foundation external operations")

    manifest = _load_json(accepted_root / "manifest.json")
    manifest_entries = manifest.get("entries")
    if (
        manifest.get("status") != "PASS"
        or manifest.get("execution_id") != report.get("execution_id")
        or not isinstance(manifest_entries, list)
        or not manifest_entries
    ):
        raise FoundationEvaluationComparisonError("Foundation immutable manifest is not PASS-bound")
    _verify_file_entries(accepted_root, manifest_entries)

    trainer_manifest_path = accepted_root / "trainer-manifest.json"
    trainer_manifest = _load_json(trainer_manifest_path)
    if (
        trainer_manifest.get("schema_version") != "dime-foundation-artifact-manifest-v1"
        or trainer_manifest.get("status") != "ACCEPTED_PRIVATE_NOT_RELEASED"
        or trainer_manifest.get("record_count") != 150
        or report.get("artifact_bindings", {}).get("trainer_manifest_sha256")
        != _sha256_file(trainer_manifest_path)
    ):
        raise FoundationEvaluationComparisonError("Foundation trainer manifest is not accepted")
    expected_entries = {
        "trainer/train.jsonl": 135,
        "trainer/validation.jsonl": 15,
    }
    entries = trainer_manifest.get("entries")
    if (
        not isinstance(entries, list)
        or {entry.get("path"): entry.get("records") for entry in entries} != expected_entries
    ):
        raise FoundationEvaluationComparisonError("Foundation trainer split manifest drifted")
    _verify_file_entries(accepted_root, entries)
    trainer_records = []
    for entry in entries:
        records = _load_canonical_jsonl(accepted_root / entry["path"])
        if len(records) != entry["records"]:
            raise FoundationEvaluationComparisonError(
                f"Foundation trainer row count mismatch: {entry['path']}"
            )
        trainer_records.extend(records)
    identifiers = [record.get("example_id") for record in trainer_records]
    if (
        len(trainer_records) != 150
        or any(not isinstance(identifier, str) for identifier in identifiers)
        or len(set(identifiers)) != 150
    ):
        raise FoundationEvaluationComparisonError("Foundation trainer identity inventory drifted")
    if _file_snapshot(accepted_root) != snapshot:
        raise FoundationEvaluationComparisonError("Foundation input changed during comparison load")
    bindings = {
        "execution_id": str(report["execution_id"]),
        "final_report_sha256": _sha256_file(accepted_root / "final-report.json"),
        "manifest_sha256": _sha256_file(accepted_root / "manifest.json"),
        "sha256sums_sha256": _sha256_file(accepted_root / "SHA256SUMS"),
        "trainer_manifest_sha256": _sha256_file(trainer_manifest_path),
    }
    return trainer_records, report, bindings


def load_semantic_r5(
    root: Path,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any], dict[str, str]]:
    """Load the four authoritative semantic-only r5 partitions without answer keys."""

    semantic_root = _validate_private_root(root, "semantic r5")
    if semantic_root.name != SEMANTIC_R5_BASENAME:
        raise FoundationEvaluationComparisonError("semantic input is not authoritative r5")
    snapshot = _file_snapshot(semantic_root)
    _verify_sha256sums(semantic_root)
    manifest = _load_json(semantic_root / "manifest.json")
    if (
        manifest.get("schema_version") != "dime-private-evaluation-semantic-manifest-v1"
        or manifest.get("classification") != SEMANTIC_CLASSIFICATION
        or manifest.get("semantic_only") is not True
        or manifest.get("contains_answer_keys") is not False
        or manifest.get("publication_authorized") is not False
        or manifest.get("record_count") != 651
        or manifest.get("layer_counts") != PARTITION_COUNTS
    ):
        raise FoundationEvaluationComparisonError("semantic r5 manifest boundary drifted")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise FoundationEvaluationComparisonError("semantic r5 file manifest is absent")
    for relative, expected in files.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise FoundationEvaluationComparisonError("semantic r5 file manifest is malformed")
        if _sha256_file(semantic_root / relative) != expected:
            raise FoundationEvaluationComparisonError(f"semantic r5 hash mismatch: {relative}")
    checksum_path = semantic_root / "RECORD_CHECKSUMS.json"
    checksums = _load_json(checksum_path)
    if checksums.get("algorithm") != "sha256" or manifest.get(
        "record_checksums_sha256"
    ) != _sha256_file(checksum_path):
        raise FoundationEvaluationComparisonError("semantic r5 record checksums are not bound")
    expected_record_hashes = checksums.get("records")
    if not isinstance(expected_record_hashes, dict) or len(expected_record_hashes) != 651:
        raise FoundationEvaluationComparisonError("semantic r5 record checksum inventory drifted")
    cases_by_partition = {}
    seen_ids = set()
    for partition in PARTITIONS:
        cases = _load_canonical_jsonl(semantic_root / partition / "cases.jsonl")
        if len(cases) != PARTITION_COUNTS[partition]:
            raise FoundationEvaluationComparisonError(f"{partition}: semantic case count drifted")
        for case in cases:
            case_id = case.get("case_id")
            if (
                not isinstance(case_id, str)
                or case_id in seen_ids
                or case.get("layer") != partition
                or case.get("privacy", {}).get("contains_gold_answers") is not False
                or case.get("privacy", {}).get("classification") != SEMANTIC_CLASSIFICATION
            ):
                raise FoundationEvaluationComparisonError(
                    f"{partition}: semantic case identity or privacy drifted"
                )
            if _sha256_bytes(canonical_json_bytes(case)) != expected_record_hashes.get(case_id):
                raise FoundationEvaluationComparisonError(
                    f"{partition}: semantic record checksum mismatch: {case_id}"
                )
            seen_ids.add(case_id)
        cases_by_partition[partition] = cases
    if len(seen_ids) != 651 or set(expected_record_hashes) != seen_ids:
        raise FoundationEvaluationComparisonError("semantic r5 record inventory is incomplete")
    if _file_snapshot(semantic_root) != snapshot:
        raise FoundationEvaluationComparisonError("semantic r5 changed during comparison load")
    bindings = {
        "generation_id": str(manifest["generation_id"]),
        "manifest_sha256": _sha256_file(semantic_root / "manifest.json"),
        "record_checksums_sha256": _sha256_file(checksum_path),
        "sha256sums_sha256": _sha256_file(semantic_root / "SHA256SUMS"),
        "source_commit": str(manifest["source_commit"]),
    }
    return cases_by_partition, manifest, bindings


def _normal_text(value: str) -> str:
    return " ".join(TOKEN_PATTERN.findall(value.casefold()))


def _canonical_text(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _character_shingles(value: str) -> set[str]:
    compact = value.replace(" ", "_")
    if len(compact) <= CHARACTER_SHINGLE_SIZE:
        return {compact}
    return {
        compact[index : index + CHARACTER_SHINGLE_SIZE]
        for index in range(len(compact) - CHARACTER_SHINGLE_SIZE + 1)
    }


def _token_bigrams(value: str) -> set[tuple[str, str]]:
    tokens = value.split()
    if len(tokens) < 2:
        return {(value, "")}
    return set(zip(tokens, tokens[1:], strict=False))


def _jaccard(left: set[Any], right: set[Any]) -> float:
    union = left | right
    return 1.0 if not union else len(left & right) / len(union)


def _foundation_material(record: Mapping[str, Any]) -> SemanticMaterial:
    messages = record.get("messages")
    if not isinstance(messages, list):
        raise FoundationEvaluationComparisonError("Foundation trainer record has no messages")
    prompts = [
        message.get("content")
        for message in messages
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    if not prompts or any(not isinstance(prompt, str) for prompt in prompts):
        raise FoundationEvaluationComparisonError("Foundation trainer record has no user prompt")
    prompt = "\n".join(prompts)
    identifier = record.get("example_id")
    if not isinstance(identifier, str):
        raise FoundationEvaluationComparisonError("Foundation trainer record has no example_id")
    normalized = _normal_text(prompt)
    return SemanticMaterial(
        identifier=identifier,
        partition="foundation_accepted_trainer",
        normalized_prompt=normalized,
        normalized_material=normalized,
    )


def _evaluation_material(case: Mapping[str, Any], partition: str) -> SemanticMaterial:
    case_id = case.get("case_id")
    input_value = case.get("input")
    if not isinstance(case_id, str) or not isinstance(input_value, dict):
        raise FoundationEvaluationComparisonError(f"{partition}: invalid semantic case")
    messages = input_value.get("messages")
    context = input_value.get("context")
    if not isinstance(messages, list) or not isinstance(context, dict):
        raise FoundationEvaluationComparisonError(f"{partition}: semantic material is incomplete")
    prompts = [
        message.get("content")
        for message in messages
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    if not prompts or any(not isinstance(prompt, str) for prompt in prompts):
        raise FoundationEvaluationComparisonError(f"{partition}: semantic case has no user prompt")
    prompt = "\n".join(prompts)
    return SemanticMaterial(
        identifier=case_id,
        partition=partition,
        normalized_prompt=_normal_text(prompt),
        normalized_material=_normal_text(f"{prompt}\n{_canonical_text(context)}"),
    )


def compare_partitions(
    foundation_records: Sequence[Mapping[str, Any]],
    cases_by_partition: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Run the four exact and near-semantic comparisons and return exact collisions."""

    if set(cases_by_partition) != set(PARTITIONS):
        raise FoundationEvaluationComparisonError("exactly four semantic partitions are required")
    foundation = [_foundation_material(record) for record in foundation_records]
    foundation_features = [
        (
            item,
            _character_shingles(item.normalized_material),
            _token_bigrams(item.normalized_material),
        )
        for item in foundation
    ]
    comparisons = {}
    all_collisions = []
    for partition in PARTITIONS:
        evaluation = [
            _evaluation_material(case, partition) for case in cases_by_partition[partition]
        ]
        partition_collisions = []
        pair_count = 0
        for left, left_chars, left_bigrams in foundation_features:
            for right in evaluation:
                pair_count += 1
                exact_prompt = left.normalized_prompt == right.normalized_prompt
                exact_material = left.normalized_material == right.normalized_material
                right_chars = _character_shingles(right.normalized_material)
                right_bigrams = _token_bigrams(right.normalized_material)
                character_score = _jaccard(left_chars, right_chars)
                bigram_score = _jaccard(left_bigrams, right_bigrams)
                near = (
                    character_score >= CHARACTER_JACCARD_THRESHOLD
                    or bigram_score >= TOKEN_BIGRAM_JACCARD_THRESHOLD
                )
                if exact_prompt or exact_material or near:
                    collision = {
                        "foundation_example_id": left.identifier,
                        "evaluation_case_id": right.identifier,
                        "evaluation_partition": partition,
                        "exact_normalized_prompt": exact_prompt,
                        "exact_semantic_material": exact_material,
                        "near_semantic": near,
                        "character_jaccard": round(character_score, 8),
                        "token_bigram_jaccard": round(bigram_score, 8),
                    }
                    partition_collisions.append(collision)
                    all_collisions.append(collision)
        comparisons[partition] = {
            "foundation_records": len(foundation),
            "evaluation_cases": len(evaluation),
            "pair_comparisons": pair_count,
            "collision_count": len(partition_collisions),
            "collisions": partition_collisions,
            "status": "PASS" if not partition_collisions else "FAIL_COLLISIONS",
        }
    return comparisons, all_collisions


def build_comparison_report(
    *,
    comparison_id: str,
    created_at: str,
    foundation_bindings: Mapping[str, str],
    semantic_bindings: Mapping[str, str],
    comparisons: Mapping[str, Mapping[str, Any]],
    collisions: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Build a bounded, non-authorizing comparison report."""

    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{7,127}", comparison_id):
        raise FoundationEvaluationComparisonError("comparison_id is invalid")
    _canonical_utc(created_at, "comparison created_at")
    if set(comparisons) != set(PARTITIONS):
        raise FoundationEvaluationComparisonError("comparison report requires four partitions")
    collision_count = sum(int(comparisons[name]["collision_count"]) for name in PARTITIONS)
    if collision_count != len(collisions):
        raise FoundationEvaluationComparisonError("collision summary does not reconcile")
    report = {
        "schema_version": "dime-foundation-private-evaluation-comparison-v1",
        "comparison_id": comparison_id,
        "created_at": created_at,
        "status": "PASS_ZERO_DISALLOWED_OVERLAP" if not collisions else "FAIL_COLLISIONS",
        "scope": {
            "foundation_material": "accepted_trainer",
            "foundation_record_count": 150,
            "foundation_route_scope": ["live_data"],
            "complete_2400_record_foundation_release_claimed": False,
            "semantic_revision": SEMANTIC_R5_BASENAME,
            "semantic_case_count": 651,
            "comparisons_required": 4,
            "comparisons_completed": 4,
        },
        "foundation_bindings": dict(foundation_bindings),
        "semantic_r5_bindings": dict(semantic_bindings),
        "method": {
            "revision": METHOD_REVISION,
            "normalization": "unicode_casefold_word_tokens_v1",
            "semantic_material": "foundation_user_prompt_vs_evaluation_user_prompt_plus_context",
            "character_shingle_size": CHARACTER_SHINGLE_SIZE,
            "character_jaccard_threshold": CHARACTER_JACCARD_THRESHOLD,
            "token_bigram_jaccard_threshold": TOKEN_BIGRAM_JACCARD_THRESHOLD,
            "exact_prompt_comparison": True,
            "exact_material_comparison": True,
        },
        "comparisons": {name: dict(comparisons[name]) for name in PARTITIONS},
        "summary": {
            "pair_comparisons": sum(
                int(comparisons[name]["pair_comparisons"]) for name in PARTITIONS
            ),
            "disallowed_overlap_count": collision_count,
            "zero_disallowed_overlap": collision_count == 0,
        },
        "authorization": {
            "publication": False,
            "training": False,
            "provider_execution": False,
            "deployment": False,
            "route_activation": False,
        },
        "publication_authorized": False,
        "external_operations": {
            "credential_reads": 0,
            "network_calls": 0,
            "provider_invocations": 0,
            "model_downloads": 0,
            "railway_mutations": 0,
            "production_data_reads": 0,
            "training_runs": 0,
            "publications": 0,
        },
    }
    validate_schema(
        report,
        "foundation_private_evaluation_comparison.schema.json",
        "Foundation private-evaluation comparison",
    )
    return report


def freeze_comparison_artifact(output_root: Path, report: Mapping[str, Any]) -> dict[str, str]:
    """Write one new immutable private evidence directory without touching inputs."""

    absolute = output_root.absolute()
    if absolute.exists() or absolute.is_symlink():
        raise FoundationEvaluationComparisonError("comparison output already exists")
    os.umask(0o077)
    absolute.mkdir(mode=0o700, parents=False)
    report_path = absolute / "comparison-report.json"
    report_path.write_bytes(canonical_json_bytes(report))
    os.chmod(report_path, 0o600)
    report_sha256 = _sha256_file(report_path)
    manifest = {
        "schema_version": "dime-foundation-private-evaluation-comparison-manifest-v1",
        "status": report["status"],
        "comparison_id": report["comparison_id"],
        "publication_authorized": False,
        "entries": [
            {
                "path": "comparison-report.json",
                "bytes": report_path.stat().st_size,
                "sha256": report_sha256,
            }
        ],
    }
    manifest_path = absolute / "manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest))
    os.chmod(manifest_path, 0o600)
    manifest_sha256 = _sha256_file(manifest_path)
    sums_path = absolute / "SHA256SUMS"
    sums_path.write_text(
        f"{report_sha256}  comparison-report.json\n{manifest_sha256}  manifest.json\n",
        encoding="utf-8",
    )
    os.chmod(sums_path, 0o600)
    for path in absolute.rglob("*"):
        expected = 0o700 if path.is_dir() else 0o600
        if path.is_symlink() or stat.S_IMODE(path.stat().st_mode) != expected:
            raise FoundationEvaluationComparisonError("comparison output mode validation failed")
    return {
        "comparison_report_sha256": report_sha256,
        "manifest_sha256": manifest_sha256,
        "sha256sums_sha256": _sha256_file(sums_path),
    }


def execute_comparison(
    *,
    accepted_root: Path,
    semantic_root: Path,
    output_root: Path,
    comparison_id: str,
    created_at: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Validate, compare, recheck immutable inputs, and freeze bounded evidence."""

    accepted = _validate_private_root(accepted_root, "accepted Foundation")
    semantic = _validate_private_root(semantic_root, "semantic r5")
    output = output_root.absolute()
    if (
        output == accepted
        or output == semantic
        or accepted in output.parents
        or semantic in output.parents
    ):
        raise FoundationEvaluationComparisonError("comparison output cannot be inside an input")
    accepted_before = _file_snapshot(accepted)
    semantic_before = _file_snapshot(semantic)
    foundation_records, _, foundation_bindings = load_accepted_foundation(accepted)
    cases_by_partition, _, semantic_bindings = load_semantic_r5(semantic)
    comparisons, collisions = compare_partitions(foundation_records, cases_by_partition)
    if _file_snapshot(accepted) != accepted_before or _file_snapshot(semantic) != semantic_before:
        raise FoundationEvaluationComparisonError("comparison input changed before evidence freeze")
    report = build_comparison_report(
        comparison_id=comparison_id,
        created_at=created_at,
        foundation_bindings=foundation_bindings,
        semantic_bindings=semantic_bindings,
        comparisons=comparisons,
        collisions=collisions,
    )
    bindings = freeze_comparison_artifact(output, report)
    return report, bindings
