import hashlib
import json
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = ML_ROOT / "evidence" / "infrastructure" / "2026-07-30"
RECOVERY_ROOT = EVIDENCE_ROOT / "production-recovery-0122"
PRICING_ROOT = EVIDENCE_ROOT / "pricing-preflight-v1"

EXPECTED_LIFECYCLE_COLUMNS = {
    "ingestion_normalized_at",
    "ingestion_persisted_at",
    "ingestion_pipeline_revision",
    "ingestion_received_at",
    "ingestion_run_id",
    "provider_observed_at",
    "source_updated_at",
}

EXPECTED_MIGRATION_HASH = "22a8fbeb3349381ff7f76a2a421efea1200917a451ea873bc7cf657e23209a25"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def assert_checksum_manifest(directory: Path, artifact_name: str) -> None:
    artifact = directory / artifact_name
    manifest = (directory / "SHA256SUMS").read_text(encoding="utf-8").strip()
    expected = hashlib.sha256(artifact.read_bytes()).hexdigest()
    assert manifest == f"{expected}  {artifact_name}"


def test_recovery_artifact_closes_only_the_approved_gates() -> None:
    recovery = load_json(RECOVERY_ROOT / "recovery.json")

    assert recovery["verdict"] == "PASS"
    assert recovery["recoveryPoint"]["createdBeforeDatabaseWrite"] is True
    assert recovery["recoveryPoint"]["completionStatus"] == "verified_completed"
    assert recovery["recoveryPoint"]["restoreControlAvailable"] is True

    pre_plan = recovery["preMigrationPlan"]
    assert pre_plan["pending"] == ["0122_dime_evidence_lifecycle_v1"]
    assert pre_plan["databaseWrites"] == 0

    execution = recovery["migrationExecution"]
    assert execution["onlyMigrationApplied"] is True
    assert execution["migrationSha256"] == EXPECTED_MIGRATION_HASH

    schema_diff = recovery["schemaDiff"]
    assert schema_diff["actualColumnCount"] == 7
    assert {column["name"] for column in schema_diff["columns"]} == (EXPECTED_LIFECYCLE_COLUMNS)
    assert all(column["nullable"] is True for column in schema_diff["columns"])
    assert all(column["default"] is None for column in schema_diff["columns"])
    assert schema_diff["existingRows"] == 7770
    assert schema_diff["nonNullValuesAcrossLifecycleColumns"] == 0

    fingerprint = recovery["existingDataFingerprint"]
    assert fingerprint["before"] == fingerprint["after"]
    assert fingerprint["unchanged"] is True

    journal = recovery["journalParity"]
    assert journal["rowsAfter"] - journal["rowsBefore"] == 1
    assert journal["entry"]["sha256"] == EXPECTED_MIGRATION_HASH
    assert journal["identityMatchesReviewedArtifact"] is True

    post_plan = recovery["postMigrationPlan"]
    assert post_plan["pendingCount"] == 0
    assert post_plan["pending"] == []
    assert post_plan["databaseWrites"] == 0

    parity = recovery["applicationParity"]
    assert len(parity["healthChecks"]) == 2
    assert all(check["status"] == "ok" for check in parity["healthChecks"])
    assert all(check["databaseCircuitBreakerState"] == "CLOSED" for check in parity["healthChecks"])
    assert parity["feed"]["projectionCardCount"] == 16
    assert parity["freshBrowserErrors"] == 0
    assert parity["freshUnknownColumnErrors"] == 0

    assert len(recovery["deploymentIdentity"]) == 2
    assert {deployment["commitSha"] for deployment in recovery["deploymentIdentity"]} == {
        "7cfdafb6cd8501389fb9f817f1c976cf1a8dcece"
    }

    assert recovery["finalRuntimeFlags"] == {
        "DIME_CHAT_TRACE_V1_ENABLED": False,
        "DIME_RESEARCH_ALPHA_ENABLED": False,
        "DIME_RESEARCH_ALPHA_KILL_SWITCH": True,
    }

    gates = recovery["gateStatus"]
    assert gates["migration_0122"] == "PASS"
    assert gates["database_recovery_point"] == "PASS"
    assert gates["schema_parity"] == "PASS"
    assert gates["journal_parity"] == "PASS"
    assert gates["application_database_compatibility"] == "PASS"
    assert gates["production_feed_parity"] == "PASS"
    assert gates["disabled_state_deployment"] == "PASS"
    assert all(
        gates[gate] == "NOT_AUTHORIZED"
        for gate in (
            "trace_activation",
            "shadow_observation",
            "route_activation",
            "model_training",
            "research_alpha_activation",
        )
    )
    assert recovery["productionMutationsPerformed"] == [
        "manual_database_backup",
        "apply_0122_dime_evidence_lifecycle_v1",
    ]


def test_pricing_preflight_fails_closed_without_approving_activation() -> None:
    pricing = load_json(PRICING_ROOT / "observation.json")

    assert pricing["verdict"] == "REVISE"
    assert pricing["registry"]["status"] == "review_required"
    assert pricing["registry"]["entryCount"] == 0
    assert pricing["productionConfiguration"]["DIME_PRICING_REGISTRY_PATH"] is None
    assert pricing["runtimeIdentity"]["reviewablePricedRuntimeIdentityAvailable"] is False
    assert pricing["deployedRegistryChecksum"]["verificationStatus"] == "BLOCKED"

    contract = pricing["unknownPricingContract"]
    assert contract["verdict"] == "PASS"
    assert contract["unknownPricingStatus"] == "cost_unavailable"
    assert contract["unknownPricingDollarValue"] is None
    assert contract["zeroDollarFallbackPermitted"] is False

    assert pricing["productionMutationsPerformed"] == []
    assert all(value is False for value in pricing["authorizations"].values())


def test_evidence_artifacts_are_checksum_pinned() -> None:
    assert_checksum_manifest(RECOVERY_ROOT, "recovery.json")
    assert_checksum_manifest(PRICING_ROOT, "observation.json")
