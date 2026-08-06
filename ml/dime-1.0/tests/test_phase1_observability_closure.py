from __future__ import annotations

import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

PROJECT = Path(__file__).resolve().parents[1]
REPOSITORY = PROJECT.parents[1]
PRICING_PATH = PROJECT / "configs/dime_observability_pricing_v1.json"
PRICING_SCHEMA_PATH = PROJECT / "schemas/observability_pricing_registry.schema.json"
TRAFFIC_PATH = (
    PROJECT
    / "evidence/benchmarks/product-route-observability-v1"
    / "production-traffic-distribution.json"
)
TRAFFIC_SCHEMA_PATH = PROJECT / "schemas/production_traffic_distribution_evidence.schema.json"
CLOSURE_PATH = PROJECT / "evidence/manifests/phase1-observability-closure-v1/closure.json"
CLOSURE_SCHEMA_PATH = PROJECT / "schemas/phase1_observability_closure.schema.json"
CLOSURE_CHECKSUM_PATH = PROJECT / "evidence/manifests/phase1-observability-closure-v1/SHA256SUMS"
RAILWAY_OBSERVATION_PATH = (
    PROJECT / "evidence/infrastructure/2026-07-29/railway_phase1_readiness_observation.json"
)
RESEARCH_ALPHA_PROPOSAL_PATH = (
    PROJECT
    / "evidence/infrastructure/2026-07-29/research_alpha_kill_switch_hardening_proposal.json"
)
INFRASTRUCTURE_CHECKSUM_PATH = PROJECT / "evidence/infrastructure/2026-07-29/SHA256SUMS"
MIGRATION_VERIFICATION_PATH = (
    PROJECT / "evidence/manifests/phase1-observability-closure-v1/migration-local-verification.json"
)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate(document_path: Path, schema_path: Path) -> None:
    schema = _load(schema_path)
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(
            _load(document_path)
        ),
        key=lambda error: list(error.path),
    )
    assert errors == [], [error.message for error in errors]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_pricing_registry_is_valid_and_truthfully_unapproved() -> None:
    _validate(PRICING_PATH, PRICING_SCHEMA_PATH)
    pricing = _load(PRICING_PATH)
    assert pricing["status"] == "review_required"
    assert pricing["entries"] == []


def test_production_traffic_evidence_is_valid_and_truthfully_unavailable() -> None:
    _validate(TRAFFIC_PATH, TRAFFIC_SCHEMA_PATH)
    traffic = _load(TRAFFIC_PATH)
    assert traffic["status"] == "unavailable"
    assert traffic["productionDerived"] is False
    assert traffic["sampleCount"] == 0
    assert traffic["report"] is None
    assert traffic["containsPromptOrResponseText"] is False


def test_closure_record_is_valid_non_authorizing_and_not_an_independent_verdict() -> None:
    _validate(CLOSURE_PATH, CLOSURE_SCHEMA_PATH)
    closure = _load(CLOSURE_PATH)
    assert closure["status"] == {
        "phase1LocalImplementation": "pass",
        "syntheticValidation": "pass",
        "productionEvidence": "blocked",
        "productionClosure": "blocked",
        "shadow": "not_authorized",
    }
    assert not any(closure["authorizations"].values())
    assert closure["independentGate"]["allowedVerdicts"] == [
        "REJECT",
        "REVISE",
        "SHADOW",
    ]
    assert closure["independentGate"]["verdict"] is None


def test_closure_evidence_hashes_match_the_local_package() -> None:
    closure = _load(CLOSURE_PATH)
    for evidence in closure["evidence"]:
        artifact = REPOSITORY / evidence["artifact"]
        assert artifact.is_file(), evidence["artifact"]
        assert _sha256(artifact) == evidence["sha256"], evidence["artifact"]


def test_railway_observation_is_sanitized_read_only_and_non_authorizing() -> None:
    observation = _load(RAILWAY_OBSERVATION_PATH)
    assert observation["observationMode"] == "read_only_sanitized"
    assert observation["mutationsPerformed"] == []
    assert not any(observation["authorizationEffect"].values())
    assert observation["nonSecretControlState"]["dimeChatTraceV1Enabled"] is False
    assert observation["deployedSourceEvidence"]["phase1ObservabilitySourcePresent"] is False
    serialized = json.dumps(observation).lower()
    for forbidden in [
        "api_key_value",
        "password_value",
        "private_endpoint",
        "raw_prompt",
        "raw_response",
    ]:
        assert forbidden not in serialized


def test_research_alpha_hardening_is_separate_and_non_authorizing() -> None:
    proposal = _load(RESEARCH_ALPHA_PROPOSAL_PATH)
    assert proposal["status"] == "approval_required"
    assert proposal["scope"] == "configuration_only_separate_from_phase1"
    assert proposal["observedState"] == {
        "featureEnabled": False,
        "killSwitchEngaged": False,
        "evidenceArtifact": (
            "ml/dime-1.0/evidence/infrastructure/2026-07-29/"
            "railway_phase1_readiness_observation.json"
        ),
    }
    assert proposal["targetState"] == {
        "featureEnabled": False,
        "killSwitchEngaged": True,
    }
    assert proposal["mutationsPerformed"] == []
    assert proposal["approvals"]["granted"] is False
    assert not any(proposal["authorizationEffect"].values())
    assert not any(proposal["separationRules"].values())


def test_migration_verification_is_local_and_non_authorizing() -> None:
    verification = _load(MIGRATION_VERIFICATION_PATH)
    result_statuses = {result["check"]: result["status"] for result in verification["results"]}
    assert result_statuses == {
        "migration_0122_first_application": "pass",
        "migration_0122_second_application": "pass",
        "historical_null_preservation": "pass",
        "rollback_first_application": "pass",
        "rollback_second_application": "pass",
        "full_historical_migration_chain": "baseline_blocked",
    }
    assert verification["database"]["scope"] == "disposable_local_container"
    assert verification["cleanup"] == {
        "containerRemoved": True,
        "productionResourcesTouched": False,
    }
    assert not any(verification["authorizationEffect"].values())


def test_infrastructure_checksum_manifest_is_complete() -> None:
    package_root = INFRASTRUCTURE_CHECKSUM_PATH.parent
    manifest: dict[str, str] = {}
    for line in INFRASTRUCTURE_CHECKSUM_PATH.read_text(encoding="utf-8").splitlines():
        digest, relative_path = line.split("  ", maxsplit=1)
        manifest[relative_path] = digest

    expected_paths = {
        "README.md",
        "railway_phase1_readiness_observation.json",
        "research_alpha_kill_switch_hardening_proposal.json",
    }
    assert set(manifest) == expected_paths
    for relative_path, digest in manifest.items():
        assert _sha256(package_root / relative_path) == digest


def test_closure_package_checksum_manifest_is_complete() -> None:
    package_root = CLOSURE_PATH.parent
    manifest: dict[str, str] = {}
    for line in CLOSURE_CHECKSUM_PATH.read_text(encoding="utf-8").splitlines():
        digest, relative_path = line.split("  ", maxsplit=1)
        manifest[relative_path] = digest

    expected_paths = {
        "closure.json",
        "README.md",
        "../../../schemas/phase1_observability_closure.schema.json",
        "../../benchmarks/product-route-observability-v1/local-verification.json",
        "../../benchmarks/product-route-observability-v1/production-traffic-distribution.json",
        "../../infrastructure/2026-07-29/railway_phase1_readiness_observation.json",
        "../../infrastructure/2026-07-29/research_alpha_kill_switch_hardening_proposal.json",
        "migration-local-verification.json",
    }
    assert set(manifest) == expected_paths
    for relative_path, digest in manifest.items():
        assert _sha256(package_root / relative_path) == digest
