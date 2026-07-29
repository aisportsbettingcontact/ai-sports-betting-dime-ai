import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PROJECT_ROOT.parents[1]
FIXTURE_PATH = PROJECT_ROOT / "data" / "eval" / "runtime_answer_routing_v1.benchmark.json"
SCHEMA_PATH = PROJECT_ROOT / "schemas" / "runtime_answer_routing_benchmark.schema.json"
REPORT_PATH = (
    PROJECT_ROOT / "evidence" / "benchmarks" / "runtime-answer-routing-v1" / "local-baseline.json"
)
CHECKSUM_PATH = REPORT_PATH.with_name("SHA256SUMS")
RUNTIME_PATH = REPOSITORY_ROOT / "server" / "_core" / "dimeAnswerRouting.ts"
EDUCATIONAL_MATH_PATH = REPOSITORY_ROOT / "server" / "_core" / "dimeEducationalMath.ts"


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def test_frozen_benchmark_matches_its_strict_schema() -> None:
    schema = load(SCHEMA_PATH)
    fixture = load(FIXTURE_PATH)
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(
            schema,
            format_checker=FormatChecker(),
        ).iter_errors(fixture),
        key=lambda error: list(error.absolute_path),
    )
    assert errors == []


def test_frozen_benchmark_is_synthetic_unique_and_referentially_closed() -> None:
    fixture = load(FIXTURE_PATH)
    assert fixture["synthetic_data_only"] is True
    assert fixture["runtime_contract_version"] == "runtime-answer-routing-v1"
    assert fixture["frozen_clock"] == {
        "now_utc": "2026-07-28T16:00:00.000Z",
        "platform_time_zone": "America/New_York",
    }

    event_ids = [event["id"] for event in fixture["events"]]
    case_ids = [case["case_id"] for case in fixture["cases"]]
    assert len(event_ids) == len(set(event_ids))
    assert len(case_ids) == len(set(case_ids))
    assert len(case_ids) == 19

    known_event_ids = set(event_ids)
    for case in fixture["cases"]:
        assert set(case["input_event_ids"]) <= known_event_ids
        assert not Path(case["prompt"]).is_absolute()
        assert "@" not in case["prompt"]


def test_local_report_is_bound_to_the_frozen_fixture() -> None:
    report = load(REPORT_PATH)
    fixture_hash = hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    runtime_hash = hashlib.sha256(RUNTIME_PATH.read_bytes()).hexdigest()
    educational_math_hash = hashlib.sha256(EDUCATIONAL_MATH_PATH.read_bytes()).hexdigest()
    assert report["sources"]["fixture_sha256"] == fixture_hash
    assert report["sources"]["runtime_module_sha256"] == runtime_hash
    assert report["sources"]["educational_math_module_sha256"] == educational_math_hash
    assert report["sources"]["fixture_path"] == (
        "ml/dime-1.0/data/eval/runtime_answer_routing_v1.benchmark.json"
    )
    assert report["sources"]["runtime_module_path"] == ("server/_core/dimeAnswerRouting.ts")
    assert report["sources"]["educational_math_module_path"] == (
        "server/_core/dimeEducationalMath.ts"
    )
    assert report["evidence_class"] == "deterministic_local_contract"
    assert report["synthetic_data_only"] is True


def test_evidence_checksum_covers_the_local_report() -> None:
    checksum, filename = CHECKSUM_PATH.read_text().strip().split(maxsplit=1)
    assert filename == "local-baseline.json"
    assert checksum == hashlib.sha256(REPORT_PATH.read_bytes()).hexdigest()


def test_local_contract_baseline_passes_without_authorizing_promotion() -> None:
    report = load(REPORT_PATH)
    assert report["summary"] == {
        "case_count": 19,
        "passing_cases": 19,
        "failing_cases": 0,
        "deterministic_local_baseline_pass": True,
        "production_promotion_authorized": False,
    }
    assert report["failures"] == []
    assert len(report["cases"]) == 19
    assert all(case["pass"] is True for case in report["cases"])

    for value in report["local_metrics"].values():
        assert value == {
            "numerator": 19,
            "denominator": 19,
            "rate": 1,
        }


def test_live_metrics_and_monetary_cost_remain_explicitly_pending() -> None:
    live = load(REPORT_PATH)["post_deploy_live_metrics"]
    assert live["measurement_status"] == "pending"
    assert live["sample_count"] is None
    assert live["answer_grounding_claim_support_rate"] is None
    assert live["answer_completeness_rate"] is None
    assert live["provider_failure_rate"] is None
    assert all(value is None for value in live["retrieval_rows"].values())
    assert all(value is None for value in live["latency_ms"].values())
    assert all(value is None for value in live["tokens"].values())
    assert live["monetary_cost"] == {
        "currency": "USD",
        "total": None,
        "per_request": None,
        "status": "not_computable_without_verified_provider_price_snapshot",
    }


def test_rollback_contract_covers_fail_closed_boundaries() -> None:
    criteria = load(REPORT_PATH)["rollback_criteria"]
    assert {
        "platform_or_educational_route_retrieves_event_rows",
        "nearby_event_is_presented_as_exact",
        "ambiguous_event_is_selected_without_confirmation",
        "missing_event_is_replaced_with_another_event",
        "retrieval_cap_is_exceeded",
        "runtime_kill_switch_does_not_restore_the_bounded_legacy_path",
        "private_or_production_data_appears_in_benchmark_or_evidence",
    } == set(criteria["immediate"])
    assert "owner_approved_live_thresholds_are_absent" in criteria["before_live_promotion"]
