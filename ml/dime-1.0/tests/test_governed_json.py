from __future__ import annotations

import json
from pathlib import Path

import pytest

from dime_ai.governed_json import (
    EXCLUDED_DIRECTORY_NAMES,
    GOVERNED_DIRECTORY_ROOTS,
    GOVERNED_STANDALONE_FILES,
    DuplicateJsonKeyError,
    GovernedJsonError,
    governed_json_paths,
    loads_governed_json,
    scan_governed_json,
)

PROJECT = Path(__file__).resolve().parents[1]

DUPLICATE_GOVERNANCE_KEYS = (
    "independent_review",
    "authorization_effect",
    "model_training",
    "private_dataset_publication",
    "private_hugging_face_publication",
    "private_hugging_face_publication_after_release_gate",
    "rights_status",
    "decision",
    "approved",
)


@pytest.mark.parametrize("duplicate_key", DUPLICATE_GOVERNANCE_KEYS)
def test_strict_loader_rejects_duplicate_governance_keys(duplicate_key: str) -> None:
    payload = f'{{"governed":{{"{duplicate_key}":false,"{duplicate_key}":true}}}}'

    with pytest.raises(DuplicateJsonKeyError, match=duplicate_key):
        loads_governed_json(payload, source="governance-test.json")


def test_strict_loader_rejects_nested_duplicates_and_nonfinite_numbers() -> None:
    with pytest.raises(DuplicateJsonKeyError, match="approved"):
        loads_governed_json(
            '{"outer":[{"review":{"approved":false,"approved":true}}]}',
            source="nested.json",
        )

    for nonfinite in ("NaN", "Infinity", "-Infinity", "1e400"):
        with pytest.raises(GovernedJsonError, match="non-finite"):
            loads_governed_json(f'{{"value":{nonfinite}}}', source="nonfinite.json")


def test_strict_loader_preserves_valid_json_values() -> None:
    document = {
        "authorization_effect": {"model_training": False},
        "decision": "REVISE",
        "approved": False,
    }
    encoded = json.dumps(document, sort_keys=True).encode("utf-8")

    assert loads_governed_json(encoded, source="valid.json") == document


def _write_minimum_governed_tree(root: Path) -> None:
    for relative_root in GOVERNED_DIRECTORY_ROOTS:
        (root / relative_root).mkdir(parents=True, exist_ok=True)
    for relative_path in GOVERNED_STANDALONE_FILES:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"release":"template"}\n', encoding="utf-8")


def test_scanner_inventory_is_deterministic_and_excludes_runtime_outputs(
    tmp_path: Path,
) -> None:
    _write_minimum_governed_tree(tmp_path)
    included = (
        "configs/control.json",
        "schemas/control.schema.json",
        "evidence/decisions/v1/decision.json",
        "evidence/manifests/v1/manifest.json",
        "evidence/releases/v1/release-record.json",
        "tools/catalog.json",
        "data/templates/review_TEMPLATE.json",
    )
    for relative_path in included:
        path = tmp_path / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"governed":true}\n', encoding="utf-8")

    excluded = (
        "data/eval/benchmark.json",
        "configs/records.jsonl",
        "evidence/tool-outputs/generated.json",
        "evidence/runtime/cache.json",
        "artifacts/outputs/generated.json",
        ".pytest_cache/result.json",
    )
    for relative_path in excluded:
        path = tmp_path / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"duplicate":false,"duplicate":true}\n', encoding="utf-8")

    first = tuple(path.relative_to(tmp_path).as_posix() for path in governed_json_paths(tmp_path))
    second = tuple(path.relative_to(tmp_path).as_posix() for path in governed_json_paths(tmp_path))
    assert first == second == tuple(sorted((*included, "docs/RELEASE_ATTESTATION_TEMPLATE.json")))
    assert scan_governed_json(tmp_path).passed is True


def test_scanner_reports_all_duplicate_key_failures_in_relative_path_order(
    tmp_path: Path,
) -> None:
    _write_minimum_governed_tree(tmp_path)
    duplicates = {
        "configs/authorization.json": "authorization_effect",
        "evidence/decisions/v1/decision.json": "decision",
        "schemas/approval.schema.json": "approved",
    }
    for relative_path, duplicate_key in duplicates.items():
        path = tmp_path / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f'{{"{duplicate_key}":false,"{duplicate_key}":true}}\n',
            encoding="utf-8",
        )

    report = scan_governed_json(tmp_path)
    assert report.passed is False
    assert report.paths == tuple(sorted((*duplicates, "docs/RELEASE_ATTESTATION_TEMPLATE.json")))
    assert [issue.path for issue in report.issues] == sorted(duplicates)
    assert all("duplicate JSON key" in issue.error for issue in report.issues)
    assert all(not issue.error.startswith(tmp_path.as_posix()) for issue in report.issues)


def test_scanner_requires_the_complete_governed_scope(tmp_path: Path) -> None:
    (tmp_path / "configs").mkdir()

    with pytest.raises(GovernedJsonError, match="scope is missing or unsafe"):
        governed_json_paths(tmp_path)


def test_current_repository_governed_json_scan_has_no_issues() -> None:
    report = scan_governed_json(PROJECT)
    assert report.passed is True
    assert report.issues == ()
    assert report.paths == tuple(sorted(report.paths))

    required_paths = {
        "configs/platform_contract.json",
        "schemas/foundation_record.schema.json",
        "evidence/decisions/dime-model-artifact-decision-v1/decision.json",
        "evidence/manifests/phase1-observability-closure-v1/closure.json",
        "evidence/benchmarks/model-artifact-evaluation-v1/contract.json",
        "evidence/rehearsals/2026-07-25/training_manifest.json",
        "tools/tools.v1.json",
        "data/templates/foundation_approval_TEMPLATE.json",
        "docs/RELEASE_ATTESTATION_TEMPLATE.json",
    }
    assert required_paths <= set(report.paths)
    assert "data/eval/product_route_observability_v1.benchmark.json" not in report.paths
    assert all(not path.endswith(".jsonl") for path in report.paths)
    assert all(not (set(Path(path).parts[:-1]) & EXCLUDED_DIRECTORY_NAMES) for path in report.paths)
