"""Fail-closed validation for the owner-authorized public dataset release."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.data_validation import (
    DataValidationError,
    _validate_no_sensitive_material,
    read_jsonl,
    sha256_file,
    validate_public_repository_data,
)
from dime_ai.governed_json import load_governed_json
from dime_ai.private_evaluation_semantics import validate_semantic_case

ML_ROOT = Path(__file__).resolve().parents[2]
SEMANTIC_ROOT = ML_ROOT / "datasets/public_semantic_v1"
SEMANTIC_MANIFEST = ML_ROOT / "configs/public_semantic_evaluation_manifest_v1.json"
SEMANTIC_SCHEMA = ML_ROOT / "schemas/public_semantic_evaluation_manifest.schema.json"
LEDGER_PATH = ML_ROOT / "data/PUBLIC_DATASETS.SHA256SUMS"
PARTITIONS = {
    "development": 270,
    "sealed_critical": 81,
    "locked": 180,
    "general_regression": 120,
}
LEDGER_FILES = (
    "configs/dataset_manifest_APPROVED.json",
    "configs/public_semantic_evaluation_manifest_v1.json",
    "data/PUBLIC_DATASETS.md",
    "data/sft/train.APPROVED.jsonl",
    "data/sft/validation.APPROVED.jsonl",
    "datasets/public_semantic_v1/development.jsonl",
    "datasets/public_semantic_v1/general_regression.jsonl",
    "datasets/public_semantic_v1/locked.jsonl",
    "datasets/public_semantic_v1/sealed_critical.jsonl",
    "schemas/public_semantic_evaluation_manifest.schema.json",
)
PRIVATE_PATH_MARKERS = (
    "/Users/",
    "/private-output/",
    "/private-recovery/",
    "\\private-output\\",
    "\\private-recovery\\",
)


class PublicDatasetReleaseError(RuntimeError):
    """Raised when any public dataset release invariant fails."""


def _regular_file(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise PublicDatasetReleaseError(f"{label} must be a regular non-symlink file")
    return path


def _validate_manifest(document: Mapping[str, Any]) -> None:
    schema = load_governed_json(SEMANTIC_SCHEMA)
    if not isinstance(schema, dict):
        raise PublicDatasetReleaseError("public semantic schema must be an object")
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(document),
        key=lambda error: tuple(str(part) for part in error.absolute_path),
    )
    if errors:
        raise PublicDatasetReleaseError("public semantic release manifest is invalid")


def _validate_ledger() -> str:
    expected_lines = []
    for relative in LEDGER_FILES:
        path = _regular_file(ML_ROOT / relative, relative)
        expected_lines.append(f"{sha256_file(path)}  {relative}\n")
    expected = "".join(expected_lines)
    ledger = _regular_file(LEDGER_PATH, "public dataset ledger")
    if ledger.read_text(encoding="ascii") != expected:
        raise PublicDatasetReleaseError("public dataset checksum ledger drifted")
    return hashlib.sha256(ledger.read_bytes()).hexdigest()


def validate_public_dataset_release() -> dict[str, Any]:
    """Validate all 450 Foundation records and 651 public semantic cases."""

    repository_report = validate_public_repository_data(ML_ROOT)
    if repository_report["non_sample_files"] != 2:
        raise PublicDatasetReleaseError("public Foundation SFT boundary drifted")

    manifest = load_governed_json(SEMANTIC_MANIFEST)
    if not isinstance(manifest, dict):
        raise PublicDatasetReleaseError("public semantic manifest must be an object")
    _validate_manifest(manifest)
    actual_files = {
        path.name for path in SEMANTIC_ROOT.iterdir() if path.is_file() and not path.is_symlink()
    }
    expected_files = {f"{partition}.jsonl" for partition in PARTITIONS}
    if actual_files != expected_files:
        raise PublicDatasetReleaseError("public semantic file inventory drifted")

    case_ids: set[str] = set()
    for partition, expected_count in PARTITIONS.items():
        path = _regular_file(SEMANTIC_ROOT / f"{partition}.jsonl", partition)
        binding = manifest["partitions"][partition]
        records = read_jsonl(path)
        if (
            binding["path"] != path.relative_to(ML_ROOT).as_posix()
            or binding["record_count"] != expected_count
            or binding["sha256"] != sha256_file(path)
            or len(records) != expected_count
        ):
            raise PublicDatasetReleaseError(
                f"public semantic partition binding drifted: {partition}"
            )
        serialized = path.read_text(encoding="utf-8")
        if any(marker in serialized for marker in PRIVATE_PATH_MARKERS):
            raise PublicDatasetReleaseError("public semantic data contains a private path")
        for record in records:
            case_id = record.get("case_id")
            if not isinstance(case_id, str) or not case_id or case_id in case_ids:
                raise PublicDatasetReleaseError("public semantic case identity drifted")
            case_ids.add(case_id)
            if validate_semantic_case(record):
                raise PublicDatasetReleaseError("public semantic case validation failed")
            try:
                _validate_no_sensitive_material(record, case_id)
            except DataValidationError as exc:
                raise PublicDatasetReleaseError(
                    "public semantic case contains sensitive material"
                ) from exc
            privacy = record.get("privacy", {})
            if privacy != {
                "classification": "PRIVATE_EVALUATION_SEMANTIC_CASES",
                "handling": "local_ignored_private_boundary",
                "contains_gold_answers": False,
                "contains_private_chain_of_thought": False,
                "contains_production_data": False,
                "publication_authorized": False,
            }:
                raise PublicDatasetReleaseError(
                    "public semantic case generation-time provenance drifted"
                )
    if len(case_ids) != manifest["record_count"] or len(case_ids) != 651:
        raise PublicDatasetReleaseError("public semantic record count drifted")
    ledger_sha256 = _validate_ledger()
    return {
        "status": "PASS",
        "foundation_train_records": 405,
        "foundation_validation_records": 45,
        "foundation_total_records": 450,
        "semantic_partition_counts": PARTITIONS,
        "semantic_total_records": 651,
        "answer_key_records": 0,
        "locked_evaluation_eligible": False,
        "model_selection_eligible": False,
        "ledger_sha256": ledger_sha256,
    }
