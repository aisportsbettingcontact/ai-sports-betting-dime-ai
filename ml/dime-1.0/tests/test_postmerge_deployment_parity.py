from __future__ import annotations

import hashlib
import json
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
PARITY_ROOT = (
    ML_ROOT / "evidence" / "infrastructure" / "2026-07-30" / "post-merge-deployment-parity-v1"
)
DECISION_ROOT = ML_ROOT / "evidence" / "decisions" / "active-provider-decision-v1"
MERGE_SHA = "74649deee4ece8e854a83c4e2b896a4e2ccc5a1b"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def assert_checksum_manifest(directory: Path, expected_files: set[str]) -> None:
    manifest: dict[str, str] = {}
    for line in (directory / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative_path = line.split("  ", maxsplit=1)
        manifest[relative_path] = digest
    assert set(manifest) == expected_files
    for relative_path, digest in manifest.items():
        artifact = directory / relative_path
        assert artifact.is_file()
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == digest


def test_post_merge_deployment_parity_is_exact_and_read_only() -> None:
    evidence = load_json(PARITY_ROOT / "observation.json")

    assert evidence["verdict"] == "PASS"
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

    assert all(check["status"] == "ok" for check in evidence["health"])
    assert all(check["databaseCircuit"] == "CLOSED" for check in evidence["health"])
    assert all(check["databaseConsecutiveFailures"] == 0 for check in evidence["health"])

    visible = evidence["userVisibleParity"]
    assert visible["observedGameCards"] == visible["expectedGameCards"] == 16
    assert visible["freshBrowserWarnings"] == 0
    assert visible["freshBrowserErrors"] == 0

    assert evidence["productionMutationsPerformed"] == []
    assert evidence["rollbackAssessment"]["rollbackRequired"] is False
    assert evidence["rollbackAssessment"]["rollbackPerformed"] is False
    assert not any(evidence["authorizations"].values())


def test_pricing_and_feature_state_remain_fail_closed() -> None:
    evidence = load_json(PARITY_ROOT / "observation.json")
    pricing = evidence["pricingAttestation"]

    assert pricing["registryStatus"] == "not_configured"
    assert pricing["requiredRegistryStatus"] == "review_required"
    assert pricing["requiredResultSatisfied"] is False
    assert pricing["gateVerdict"] == "REVISE"
    assert pricing["approvedEntryCount"] == 0
    assert pricing["activeProvider"] == "frozen"
    assert pricing["activeModel"] == "no-provider"
    assert pricing["activeModelRevision"] == "no-provider"
    assert pricing["deploymentTier"] == "disabled"
    assert pricing["currency"] == "USD"
    assert pricing["zeroCostRuntime"] is True
    assert pricing["exactMatchAvailable"] is False

    features = evidence["featureState"]
    for service in ("applicationService", "backendService"):
        assert features[service]["traceEnabled"] is False
        assert features[service]["researchAlphaEnabled"] is False
        assert features[service]["researchAlphaKillSwitch"] is True
    assert features["shadowEnabled"] is False
    assert features["generativeRouteActivation"] is False
    assert features["deterministicAnswerRoutingEnabled"] is True

    owner = evidence["ownerOnlyAttestationContract"]
    assert owner["directAuthenticatedResponseCaptured"] is False
    assert owner["secretSafePayloadEvaluatedAgainstProductionVariables"] is True
    assert owner["verificationStatus"] == "PARTIAL"
    assert owner["evaluationResult"]["readyForIndependentGate"] is False


def test_post_merge_review_remains_null_until_the_named_reviewer_acts() -> None:
    review = load_json(PARITY_ROOT / "observation.json")["postMergeIndependentReview"]
    assert review["requiredReviewer"] == "prez-ai-sports-betting"
    assert review["reviewedCommit"] == MERGE_SHA
    assert review["status"] == "required"
    assert review["submittedReviewer"] is None
    assert review["verdict"] is None
    assert review["absenceOfReviewCountsAsApproval"] is False


def test_active_provider_decision_is_structured_and_non_authorizing() -> None:
    decision = load_json(DECISION_ROOT / "decision.json")

    assert decision["status"] == "evidence_collection_required"
    assert decision["verdict"] == "REVISE"
    assert decision["selection"] is None
    assert decision["decisionAuthority"] is None
    assert all(value is None for value in decision["decisionTuple"].values())

    candidates = {
        candidate["candidateId"]: candidate for candidate in decision["candidateEvidence"]
    }
    assert set(candidates) == {
        "frozen-no-provider",
        "dormant-runpod-dime1",
        "existing-anthropic-integration",
    }
    assert candidates["frozen-no-provider"]["currentlyActive"] is True
    assert candidates["dormant-runpod-dime1"]["currentlyActive"] is False
    assert candidates["existing-anthropic-integration"]["currentlyActive"] is False
    assert all(
        candidate["externalInvocationAuthorized"] is False for candidate in candidates.values()
    )

    assert all(value is None for value in decision["candidateScores"].values())
    assert decision["requiredBenchmark"]["endpointCallsAuthorized"] is False
    assert decision["requiredBenchmark"]["benchmarkRunAuthorized"] is False
    assert decision["pricing"]["currentEntryCount"] == 0
    assert decision["pricing"]["pricingEntryAuthorized"] is False
    assert not any(decision["authorizationBoundary"].values())
    assert decision["productionMutationsPerformed"] == []


def test_new_evidence_packages_are_checksum_pinned() -> None:
    assert_checksum_manifest(PARITY_ROOT, {"README.md", "observation.json"})
    assert_checksum_manifest(DECISION_ROOT, {"README.md", "decision.json"})
