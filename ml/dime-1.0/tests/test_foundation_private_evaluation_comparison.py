from __future__ import annotations

import hashlib
import json
import os
import stat
from pathlib import Path

import pytest

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_private_evaluation_comparison import (
    PARTITIONS,
    FoundationEvaluationComparisonError,
    build_comparison_report,
    compare_partitions,
    freeze_comparison_artifact,
    load_accepted_foundation,
    load_semantic_r5,
)


def foundation_record(identifier: str, prompt: str) -> dict:
    return {
        "example_id": identifier,
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": "A bounded synthetic response."},
        ],
    }


def evaluation_case(identifier: str, partition: str, prompt: str) -> dict:
    return {
        "case_id": identifier,
        "layer": partition,
        "input": {
            "messages": [{"role": "user", "content": prompt}],
            "context": {"facts": [{"name": "synthetic", "value": identifier}]},
        },
    }


def comparisons(*, collision: bool = False) -> dict[str, dict]:
    counts = {
        "development": (270, 40500),
        "sealed_critical": (81, 12150),
        "locked": (180, 27000),
        "general_regression": (120, 18000),
    }
    result = {}
    for partition, (cases, pairs) in counts.items():
        collisions = []
        if collision and partition == "locked":
            collisions = [
                {
                    "foundation_example_id": "foundation-001",
                    "evaluation_case_id": "locked-001",
                    "evaluation_partition": "locked",
                    "exact_normalized_prompt": True,
                    "exact_semantic_material": False,
                    "near_semantic": True,
                    "character_jaccard": 0.93,
                    "token_bigram_jaccard": 0.9,
                }
            ]
        result[partition] = {
            "foundation_records": 150,
            "evaluation_cases": cases,
            "pair_comparisons": pairs,
            "collision_count": len(collisions),
            "collisions": collisions,
            "status": "FAIL_COLLISIONS" if collisions else "PASS",
        }
    return result


def bindings() -> tuple[dict[str, str], dict[str, str]]:
    foundation = {
        "execution_id": "foundation-live-data-shard-001-b9ba7788-final",
        "final_report_sha256": "a" * 64,
        "manifest_sha256": "b" * 64,
        "sha256sums_sha256": "c" * 64,
        "trainer_manifest_sha256": "d" * 64,
    }
    semantic = {
        "generation_id": "dime-llm-v1-private-semantic-cases-tool-contract-v2",
        "manifest_sha256": "e" * 64,
        "record_checksums_sha256": "f" * 64,
        "sha256sums_sha256": "1" * 64,
        "source_commit": "2" * 40,
    }
    return foundation, semantic


def private_directory(path: Path) -> Path:
    path.mkdir(mode=0o700)
    os.chmod(path, 0o700)
    return path


def write_private(path: Path, value: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    path.write_bytes(value)
    os.chmod(path, 0o600)


def test_four_required_comparisons_pass_without_overlap() -> None:
    foundation = [
        foundation_record("foundation-001", "Explain a unique synthetic live-data boundary.")
    ]
    cases = {
        partition: [
            evaluation_case(
                f"{partition}-001",
                partition,
                f"Handle a separate fictional {partition} evaluation request.",
            )
        ]
        for partition in PARTITIONS
    }

    results, collisions = compare_partitions(foundation, cases)

    assert list(results) == list(PARTITIONS)
    assert collisions == []
    assert all(result["status"] == "PASS" for result in results.values())
    assert all(result["pair_comparisons"] == 1 for result in results.values())


def test_collision_report_preserves_exact_identifiers_without_prompt_text() -> None:
    prompt = "Explain this exact synthetic market request."
    foundation = [foundation_record("foundation-001", prompt)]
    cases = {
        partition: [
            evaluation_case(
                f"{partition}-001",
                partition,
                prompt if partition == "locked" else f"Distinct {partition} semantic request.",
            )
        ]
        for partition in PARTITIONS
    }

    results, collisions = compare_partitions(foundation, cases)

    assert results["locked"]["status"] == "FAIL_COLLISIONS"
    assert collisions[0]["foundation_example_id"] == "foundation-001"
    assert collisions[0]["evaluation_case_id"] == "locked-001"
    assert collisions[0]["exact_normalized_prompt"] is True
    assert prompt not in json.dumps(collisions)


def test_report_is_non_authorizing_and_does_not_claim_full_foundation_release() -> None:
    foundation_bindings, semantic_bindings = bindings()
    results = comparisons()

    report = build_comparison_report(
        comparison_id="foundation-semantic-r5-live-data-001",
        created_at="2026-07-30T19:00:00Z",
        foundation_bindings=foundation_bindings,
        semantic_bindings=semantic_bindings,
        comparisons=results,
        collisions=[],
    )

    assert report["status"] == "PASS_ZERO_DISALLOWED_OVERLAP"
    assert report["scope"]["comparisons_completed"] == 4
    assert report["scope"]["complete_2400_record_foundation_release_claimed"] is False
    assert report["publication_authorized"] is False
    assert set(report["external_operations"].values()) == {0}
    assert not any(report["authorization"].values())


def test_report_fails_closed_and_retains_exact_collisions() -> None:
    foundation_bindings, semantic_bindings = bindings()
    results = comparisons(collision=True)
    collisions = results["locked"]["collisions"]

    report = build_comparison_report(
        comparison_id="foundation-semantic-r5-live-data-collision-001",
        created_at="2026-07-30T19:00:00Z",
        foundation_bindings=foundation_bindings,
        semantic_bindings=semantic_bindings,
        comparisons=results,
        collisions=collisions,
    )

    assert report["status"] == "FAIL_COLLISIONS"
    assert report["summary"]["disallowed_overlap_count"] == 1
    assert report["comparisons"]["locked"]["collisions"] == collisions


def test_freeze_is_canonical_private_and_immutable(tmp_path: Path) -> None:
    foundation_bindings, semantic_bindings = bindings()
    report = build_comparison_report(
        comparison_id="foundation-semantic-r5-live-data-freeze-001",
        created_at="2026-07-30T19:00:00Z",
        foundation_bindings=foundation_bindings,
        semantic_bindings=semantic_bindings,
        comparisons=comparisons(),
        collisions=[],
    )
    output = tmp_path / "comparison-v1"

    frozen = freeze_comparison_artifact(output, report)

    assert set(frozen) == {
        "comparison_report_sha256",
        "manifest_sha256",
        "sha256sums_sha256",
    }
    assert (output / "comparison-report.json").read_bytes() == canonical_json_bytes(report)
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    assert all(
        stat.S_IMODE(path.stat().st_mode) == 0o600 for path in output.iterdir() if path.is_file()
    )
    with pytest.raises(FoundationEvaluationComparisonError, match="already exists"):
        freeze_comparison_artifact(output, report)


def test_pre_final_foundation_artifact_is_rejected_before_trainer_read(tmp_path: Path) -> None:
    root = private_directory(tmp_path / "pre-final")
    report = {
        "schema_version": "dime-foundation-live-data-final-report-v1",
        "status": "PENDING_INDEPENDENT_CRITIQUE",
        "counts": {},
    }
    write_private(root / "final-report.json", canonical_json_bytes(report))
    digest = hashlib.sha256((root / "final-report.json").read_bytes()).hexdigest()
    write_private(root / "SHA256SUMS", f"{digest}  final-report.json\n".encode())

    with pytest.raises(FoundationEvaluationComparisonError, match="not the exact accepted"):
        load_accepted_foundation(root)


def test_semantic_r5_with_answer_keys_is_rejected(tmp_path: Path) -> None:
    root = private_directory(tmp_path / "evaluation-semantic-v1-b9ba7788-r5")
    manifest = {
        "schema_version": "dime-private-evaluation-semantic-manifest-v1",
        "classification": "PRIVATE_EVALUATION_SEMANTIC_CASES",
        "semantic_only": True,
        "contains_answer_keys": True,
        "publication_authorized": False,
        "record_count": 651,
        "layer_counts": {
            "development": 270,
            "sealed_critical": 81,
            "locked": 180,
            "general_regression": 120,
        },
    }
    write_private(root / "manifest.json", canonical_json_bytes(manifest))
    digest = hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
    write_private(root / "SHA256SUMS", f"{digest}  manifest.json\n".encode())

    with pytest.raises(FoundationEvaluationComparisonError, match="manifest boundary drifted"):
        load_semantic_r5(root)
