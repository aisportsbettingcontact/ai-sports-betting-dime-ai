from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PROJECT_ROOT.parents[1]
FIXTURE_PATH = PROJECT_ROOT / "data/eval/product_route_observability_v1.benchmark.json"
SCHEMA_PATH = PROJECT_ROOT / "schemas/product_route_observability_benchmark.schema.json"
REPORT_PATH = (
    PROJECT_ROOT / "evidence/benchmarks/product-route-observability-v1/local-baseline.json"
)
CHECKSUM_PATH = PROJECT_ROOT / "evidence/benchmarks/product-route-observability-v1/SHA256SUMS"
CONTROL_SOURCE_PATH = REPOSITORY_ROOT / "server/_core/dimeEngineeringControl.ts"

ROUTES = {
    "platform",
    "matchup",
    "full_slate",
    "educational",
    "bet_explanation",
    "historical",
    "account",
    "live_data",
    "general_sports",
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_frozen_product_route_benchmark_matches_strict_schema() -> None:
    fixture = json.loads(FIXTURE_PATH.read_text())
    schema = json.loads(SCHEMA_PATH.read_text())
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(fixture)


def test_every_product_route_has_independent_synthetic_coverage() -> None:
    fixture = json.loads(FIXTURE_PATH.read_text())
    cases = fixture["cases"]
    counts = Counter(case["expected_route"] for case in cases)

    assert fixture["data_classification"] == "synthetic"
    assert fixture["provenance"]["contains_production_data"] is False
    assert set(counts) == ROUTES
    assert all(counts[route] >= 2 for route in ROUTES)
    assert len({case["case_id"] for case in cases}) == len(cases)
    assert all(case["critical_failure_conditions"] for case in cases)


def test_local_report_is_bound_to_fixture_and_control_source() -> None:
    report = json.loads(REPORT_PATH.read_text())

    assert report["generated_from"]["fixture_sha256"] == _sha256(FIXTURE_PATH)
    assert report["generated_from"]["control_source_sha256"] == _sha256(CONTROL_SOURCE_PATH)
    assert report["aggregate"]["sample_count"] >= 18
    assert set(report["per_route"]) == ROUTES
    assert set(report["confusion_matrix"]) == ROUTES
    assert all(set(row) == ROUTES for row in report["confusion_matrix"].values())
    assert report["authorization"] == {
        "activates_routes": False,
        "authorizes_shadow": False,
        "authorizes_release": False,
    }


def test_checksum_manifest_pins_all_frozen_artifacts() -> None:
    manifest = {}
    for line in CHECKSUM_PATH.read_text().splitlines():
        digest, relative_path = line.split("  ", maxsplit=1)
        manifest[relative_path] = digest

    assert manifest == {
        "../../../data/eval/product_route_observability_v1.benchmark.json": _sha256(FIXTURE_PATH),
        "local-baseline.json": _sha256(REPORT_PATH),
        "../../../schemas/product_route_observability_benchmark.schema.json": _sha256(SCHEMA_PATH),
    }
