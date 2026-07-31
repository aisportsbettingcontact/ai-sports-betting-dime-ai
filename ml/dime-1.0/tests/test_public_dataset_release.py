from __future__ import annotations

import hashlib
from pathlib import Path

from dime_ai.data_validation import read_jsonl
from dime_ai.public_dataset_release import validate_public_dataset_release

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEDGER_PATH = PROJECT_ROOT / "data/PUBLIC_DATASETS.SHA256SUMS"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_public_dataset_release_ledger_is_exact() -> None:
    entries: dict[str, str] = {}
    for row in LEDGER_PATH.read_text(encoding="ascii").splitlines():
        digest, relative = row.split("  ", maxsplit=1)
        assert relative not in entries
        entries[relative] = digest

    expected = {
        "configs/dataset_manifest_APPROVED.json",
        "configs/public_semantic_evaluation_manifest_v1.json",
        "data/PUBLIC_DATASETS.md",
        "datasets/public_semantic_v1/development.jsonl",
        "datasets/public_semantic_v1/general_regression.jsonl",
        "datasets/public_semantic_v1/locked.jsonl",
        "datasets/public_semantic_v1/sealed_critical.jsonl",
        "data/sft/train.APPROVED.jsonl",
        "data/sft/validation.APPROVED.jsonl",
        "schemas/public_semantic_evaluation_manifest.schema.json",
    }
    assert set(entries) == expected
    for relative, digest in entries.items():
        assert _sha256(PROJECT_ROOT / relative) == digest


def test_public_dataset_release_counts_and_unique_identities() -> None:
    train = read_jsonl(PROJECT_ROOT / "data/sft/train.APPROVED.jsonl")
    validation = read_jsonl(PROJECT_ROOT / "data/sft/validation.APPROVED.jsonl")
    foundation_ids = [record["example_id"] for record in [*train, *validation]]
    assert len(train) == 405
    assert len(validation) == 45
    assert len(foundation_ids) == len(set(foundation_ids)) == 450

    cases = []
    for partition in (
        "development",
        "sealed_critical",
        "locked",
        "general_regression",
    ):
        cases.extend(read_jsonl(PROJECT_ROOT / f"datasets/public_semantic_v1/{partition}.jsonl"))
    case_ids = [case["case_id"] for case in cases]
    assert len(case_ids) == len(set(case_ids)) == 651
    assert not any(
        key in case for case in cases for key in ("answer", "answer_key", "expected_answer", "gold")
    )


def test_public_dataset_release_passes_repository_boundary() -> None:
    result = validate_public_dataset_release()
    assert result["status"] == "PASS"
    assert result["foundation_total_records"] == 450
    assert result["semantic_total_records"] == 651
    assert result["locked_evaluation_eligible"] is False
    assert result["model_selection_eligible"] is False
