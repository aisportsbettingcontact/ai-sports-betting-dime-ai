from __future__ import annotations

import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parents[1]
GOVERNANCE_ROOT = (
    ML_ROOT / "evidence" / "infrastructure" / "2026-07-30" / "pr244-post-merge-governance-v1"
)
BENCHMARK_ROOT = ML_ROOT / "evidence" / "benchmarks" / "provider-selection-v1"
CONTRACT_PATH = BENCHMARK_ROOT / "contract.json"
SUPPLEMENT_PATH = ML_ROOT / "data" / "eval" / "provider_selection_v1.supplemental.json"
SUPPLEMENT_SCHEMA_PATH = ML_ROOT / "schemas" / "provider_selection_supplemental.schema.json"
MERGE_SHA = "58232f3036aef1a3cfc49284c589fda5c8798d09"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assert_checksum_manifest(directory: Path, expected_files: set[str]) -> None:
    manifest: dict[str, str] = {}
    for line in (directory / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative_path = line.split("  ", maxsplit=1)
        manifest[relative_path] = digest
    assert set(manifest) == expected_files
    for relative_path, digest in manifest.items():
        artifact = directory / relative_path
        assert artifact.is_file()
        assert sha256(artifact) == digest


def count_cases(path: Path) -> int:
    if path.suffix == ".jsonl":
        return len([line for line in path.read_text(encoding="utf-8").splitlines() if line])
    payload = load_json(path)
    return len(payload["cases"])


def test_pr244_production_observation_is_exact_and_non_authorizing() -> None:
    evidence = load_json(GOVERNANCE_ROOT / "observation.json")

    assert evidence["verdict"] == "PASS_WITH_OPEN_GOVERNANCE_EXCEPTION"
    assert evidence["scope"]["observationMode"] == "read_only_sanitized"
    assert evidence["github"]["mergeSha"] == MERGE_SHA
    assert evidence["github"]["headIsAncestorOfMerge"] is True
    assert evidence["github"]["headAndMergeTreeDelta"] is False
    assert evidence["github"]["submittedIndependentReviews"] == 0
    assert evidence["github"]["independentReviewDecision"] is None

    deployment = evidence["deployment"]
    assert deployment["expectedMergeSha"] == MERGE_SHA
    assert deployment["application"]["commitSha"] == MERGE_SHA
    assert deployment["backend"]["commitSha"] == MERGE_SHA
    assert deployment["application"]["status"] == "SUCCESS"
    assert deployment["backend"]["status"] == "SUCCESS"
    assert deployment["allInstancesRunning"] is True

    assert all(item["status"] == "ok" for item in evidence["health"])
    assert all(item["databaseCircuit"] == "CLOSED" for item in evidence["health"])
    assert all(item["databaseConsecutiveFailures"] == 0 for item in evidence["health"])
    assert evidence["userVisibleParity"]["observedGameCards"] == 16
    assert evidence["userVisibleParity"]["freshBrowserErrors"] == 0

    pricing = evidence["pricingAttestation"]
    assert pricing["registryStatus"] == "not_configured"
    assert pricing["approvedEntryCount"] == 0
    assert pricing["activeProvider"] == "frozen"
    assert pricing["activeModel"] == "no-provider"
    assert pricing["gateVerdict"] == "REVISE"

    assert not any(evidence["authorizations"].values())
    assert evidence["productionMutationsPerformed"] == []


def test_pr244_governance_exception_is_open_and_historical_state_is_preserved() -> None:
    exception = load_json(GOVERNANCE_ROOT / "observation.json")["postMergeGovernanceException"]

    assert exception["historicalPullRequestStateRewritten"] is False
    assert exception["requiredReviewer"] == "prez-ai-sports-betting"
    assert exception["reviewedCommit"] == MERGE_SHA
    assert exception["status"] == "required"
    assert exception["submittedReviewer"] is None
    assert exception["verdict"] is None
    assert exception["closedAt"] is None
    assert exception["absenceOfReviewCountsAsApproval"] is False
    assert len(exception["requiredAssertions"]) == 6


def test_supplemental_dataset_is_schema_valid_unique_and_complete() -> None:
    schema = load_json(SUPPLEMENT_SCHEMA_PATH)
    dataset = load_json(SUPPLEMENT_PATH)
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(dataset)

    assert dataset["sourceCommit"] == MERGE_SHA
    cases = dataset["cases"]
    assert len(cases) == 16
    assert len({case["caseId"] for case in cases}) == len(cases)

    contract = load_json(CONTRACT_PATH)
    assert {case["category"] for case in cases} == set(contract["dataset"]["requiredCoverage"])
    assert any(case["identityIsolationRequired"] for case in cases)
    assert any(case["category"] == "doubleheader" for case in cases)
    assert any(case["category"] == "postponed" for case in cases)
    assert any(case["category"] == "rescheduled" for case in cases)
    assert all(case["forbiddenClaims"] for case in cases)


def test_contract_pins_every_dataset_and_control_source() -> None:
    contract = load_json(CONTRACT_PATH)

    assert contract["status"] == "FROZEN_NOT_AUTHORIZED"
    assert contract["sourceCommit"] == MERGE_SHA
    assert contract["dataset"]["totalCaseCount"] == 81

    counted_total = 0
    for source in contract["dataset"]["sources"]:
        path = REPO_ROOT / source["path"]
        assert path.is_file()
        assert sha256(path) == source["sha256"]
        assert count_cases(path) == source["caseCount"]
        counted_total += source["caseCount"]
        if "schemaPath" in source:
            schema_path = REPO_ROOT / source["schemaPath"]
            assert sha256(schema_path) == source["schemaSha256"]
    assert counted_total == contract["dataset"]["totalCaseCount"]

    controls = contract["evaluationControls"]
    for source_key in (
        "retrievalSource",
        "answerRoutingSource",
        "toolHandlerSource",
        "routeSource",
    ):
        source = controls[source_key]
        assert sha256(REPO_ROOT / source["path"]) == source["sha256"]

    assert controls["contextTokenBudget"] == 36000
    assert controls["maximumOutputTokens"] == 2048
    assert controls["temperature"] == 0.2
    assert controls["timeoutMs"] == 120000
    assert controls["retryCount"] == 0
    assert controls["concurrencyLimit"] == 1


def test_candidate_identity_and_promotion_gates_fail_closed() -> None:
    contract = load_json(CONTRACT_PATH)
    candidates = contract["candidates"]

    assert {candidate["provider"] for candidate in candidates} == {
        "anthropic",
        "runpod",
    }
    assert all(candidate["modelRevision"] is None for candidate in candidates)
    assert all(candidate["endpointInvoked"] is False for candidate in candidates)
    assert all(candidate["benchmarkOverrideRequired"] is True for candidate in candidates)

    thresholds = contract["promotionThresholds"]
    for name in (
        "criticalFabricatedDynamicFactCount",
        "crossUserOrIdentityFailureCount",
        "mandatoryToolViolationCount",
        "mandatorySchemaViolationCount",
    ):
        assert thresholds[name]["maximum"] == 0
        assert thresholds[name]["hardGate"] is True
    assert thresholds["criticalCaseFactualCorrectness"]["minimum"] == 1.0
    assert thresholds["mandatoryToolSelectionCorrectness"]["minimum"] == 1.0
    assert thresholds["mandatorySchemaCompliance"]["minimum"] == 1.0
    assert thresholds["criticalRouteRegression"]["maximumRelativeRegression"] == 0.0
    assert thresholds["cost"]["unknownPricingTreatment"] == "cost_unavailable"
    assert thresholds["latency"]["ownerApprovedSloRequiredBeforeSelection"] is True
    assert thresholds["cost"]["ownerApprovedBudgetRequiredBeforeSelection"] is True

    readiness = contract["executionReadiness"]
    assert readiness["verdict"] == "REVISE"
    assert readiness["benchmarkRunAuthorized"] is False
    assert not any(contract["authorizationBoundary"].values())
    assert contract["productionMutationsPerformed"] == []


def test_provider_selection_packages_are_checksum_pinned() -> None:
    assert_checksum_manifest(
        GOVERNANCE_ROOT,
        {"README.md", "observation.json"},
    )
    assert_checksum_manifest(
        BENCHMARK_ROOT,
        {
            "README.md",
            "contract.json",
            "../../../data/eval/product_route_observability_v1.benchmark.json",
            "../../../data/eval/runtime_answer_routing_v1.benchmark.json",
            "../../../data/eval/platform_grounding_v1.sample.jsonl",
            "../../../data/eval/dev.sample.jsonl",
            "../../../data/eval/safety_red_team.sample.jsonl",
            "../../../data/eval/provider_selection_v1.supplemental.json",
            "../../../schemas/provider_selection_supplemental.schema.json",
        },
    )
