from __future__ import annotations

import base64
import hashlib
import json
import shutil
import stat
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from dime_ai.agent_identity_provisioning import (
    AgentIdentityProvisioningError,
    prepare_candidate_registry,
    provisioning_challenge_bytes,
    write_candidate_registry,
    write_provisioning_challenges,
)
from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_dataset import FoundationDatasetError, trusted_reviewer_index

PROJECT = Path(__file__).resolve().parents[1]
SOURCE_REGISTRY = PROJECT / "configs/foundation_reviewer_registry.json"
TARGET_VERSION = "dime-foundation-reviewers-v0.5.2"
PROJECT_INPUTS = (
    "configs/foundation_reviewer_registry.json",
    "configs/platform_contract.json",
    "schemas/foundation_ai_reviewer_provisioning_input.schema.json",
    "schemas/foundation_reviewer_registry.schema.json",
)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _write_artifacts(
    bundle: Path,
    *,
    reviewer_number: int,
) -> tuple[dict[str, str], dict[str, str]]:
    directory = bundle / f"reviewer-{reviewer_number}"
    directory.mkdir()
    paths = {
        "system_instruction_path": f"reviewer-{reviewer_number}/system-instruction.md",
        "tool_contract_path": f"reviewer-{reviewer_number}/tool-contract.json",
        "inference_policy_path": f"reviewer-{reviewer_number}/inference-policy.json",
        "conflict_policy_path": f"reviewer-{reviewer_number}/conflict-policy.json",
        "recusal_policy_path": f"reviewer-{reviewer_number}/recusal-policy.json",
    }
    digests: dict[str, str] = {}
    for field, relative in paths.items():
        value = f"{field} for independent reviewer {reviewer_number}\n".encode()
        (bundle / relative).write_bytes(value)
        digests[field.replace("_path", "_sha256")] = _sha256(value)
    return paths, digests


def _candidate_profile(
    specification: dict[str, Any],
    digests: dict[str, str],
) -> dict[str, Any]:
    key = specification["receipt_verification_key"]
    return {
        "profile_id": specification["profile_id"],
        "status": "provisioned",
        "model_provider": specification["model_provider"],
        "model_id": specification["model_id"],
        "model_revision": specification["model_revision"],
        "runtime_version": specification["runtime_version"],
        "model_lineage_id": specification["model_lineage_id"],
        "policy_lineage_id": specification["policy_lineage_id"],
        "workload_identity_id": specification["workload_identity_id"],
        **digests,
        "revocation_status": "clear",
        "receipt_issuer_key_id": f"key-{key['public_key_sha256']}",
        "receipt_verification_key": key,
    }


def _create_bundle(
    tmp_path: Path,
) -> tuple[Path, dict[str, Any], list[Ed25519PrivateKey]]:
    bundle = tmp_path / "provisioning-bundle"
    bundle.mkdir()
    registry = json.loads(SOURCE_REGISTRY.read_text(encoding="utf-8"))
    private_keys: list[Ed25519PrivateKey] = []
    reviewer_inputs: list[dict[str, Any]] = []

    for index, reviewer in enumerate(registry["reviewers"], start=1):
        paths, digests = _write_artifacts(bundle, reviewer_number=index)
        private_key = Ed25519PrivateKey.generate()
        private_keys.append(private_key)
        public_key = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        public_key_sha256 = _sha256(public_key)
        specification: dict[str, Any] = {
            "reviewer_id": reviewer["reviewer_id"],
            "profile_id": reviewer["agent_profile"]["profile_id"],
            "model_provider": f"provider-{index}",
            "model_id": f"review-model-{index}",
            "model_revision": str(index) * 40,
            "runtime_version": str(index + 2) * 64,
            "model_lineage_id": f"dime-model-lineage-{index}",
            "policy_lineage_id": f"dime-policy-lineage-{index}",
            "workload_identity_id": f"dime-workload-identity-{index}",
            **paths,
            "receipt_verification_key": {
                "algorithm": "ed25519",
                "encoding": "raw-base64",
                "public_key_base64": base64.b64encode(public_key).decode("ascii"),
                "public_key_sha256": public_key_sha256,
                "status": "active",
                "valid_from_utc": "2026-07-28T00:00:00Z",
                "valid_until_or_open_ended": None,
            },
            "possession_proof_signature_base64": base64.b64encode(b"\x00" * 64).decode("ascii"),
        }
        profile = _candidate_profile(specification, digests)
        specification["possession_proof_signature_base64"] = base64.b64encode(
            private_key.sign(
                provisioning_challenge_bytes(
                    reviewer_id=specification["reviewer_id"],
                    source_registry_sha256=_sha256(SOURCE_REGISTRY.read_bytes()),
                    target_registry_version=TARGET_VERSION,
                    profile=profile,
                )
            )
        ).decode("ascii")
        reviewer_inputs.append(specification)

    document = {
        "schema_version": "dime-foundation-ai-reviewer-provisioning-input-v1",
        "source_registry_sha256": _sha256(SOURCE_REGISTRY.read_bytes()),
        "target_registry_version": TARGET_VERSION,
        "reviewers": reviewer_inputs,
    }
    (bundle / "provisioning.json").write_text(
        json.dumps(document, indent=2) + "\n",
        encoding="utf-8",
    )
    return bundle, document, private_keys


def _rewrite_input(bundle: Path, document: dict[str, Any]) -> None:
    (bundle / "provisioning.json").write_text(
        json.dumps(document, indent=2) + "\n",
        encoding="utf-8",
    )


def _shadow_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for relative in PROJECT_INPUTS:
        destination = project / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PROJECT / relative, destination)
    return project


def _resign(
    document: dict[str, Any],
    *,
    reviewer_index: int,
    private_key: Ed25519PrivateKey,
    bundle: Path,
) -> None:
    specification = document["reviewers"][reviewer_index]
    digests = {
        field.replace("_path", "_sha256"): _sha256((bundle / specification[field]).read_bytes())
        for field in (
            "system_instruction_path",
            "tool_contract_path",
            "inference_policy_path",
            "conflict_policy_path",
            "recusal_policy_path",
        )
    }
    specification["possession_proof_signature_base64"] = base64.b64encode(
        private_key.sign(
            provisioning_challenge_bytes(
                reviewer_id=specification["reviewer_id"],
                source_registry_sha256=document["source_registry_sha256"],
                target_registry_version=document["target_registry_version"],
                profile=_candidate_profile(specification, digests),
            )
        )
    ).decode("ascii")


def test_prepares_deterministic_inactive_candidate_without_touching_governed_registry(
    tmp_path: Path,
) -> None:
    bundle, _, _ = _create_bundle(tmp_path)
    source_before = SOURCE_REGISTRY.read_bytes()

    first = prepare_candidate_registry(bundle)
    second = prepare_candidate_registry(bundle)

    assert canonical_json_bytes(first) == canonical_json_bytes(second)
    assert first["registry_version"] == TARGET_VERSION
    assert first["status"] == "proposed"
    assert first["receipt_verifier"]["activation_authorized"] is False
    assert all(reviewer["active"] is False for reviewer in first["reviewers"])
    assert all(
        reviewer["agent_profile"]["status"] == "provisioned" for reviewer in first["reviewers"]
    )
    assert (
        len({reviewer["agent_profile"]["workload_identity_id"] for reviewer in first["reviewers"]})
        == 2
    )
    with pytest.raises(FoundationDatasetError, match="must be independently reviewed and active"):
        trusted_reviewer_index(first, independent_ai_activation_authorized=True)
    assert SOURCE_REGISTRY.read_bytes() == source_before


def test_writes_new_private_candidate_file_with_deterministic_digest(tmp_path: Path) -> None:
    bundle, _, _ = _create_bundle(tmp_path)

    output, digest = write_candidate_registry(bundle)

    assert output.name == "candidate-reviewer-registry.json"
    assert digest == _sha256(output.read_bytes())
    assert stat.S_IMODE(output.stat().st_mode) == 0o600
    with pytest.raises(AgentIdentityProvisioningError, match="already exists"):
        write_candidate_registry(bundle)


def test_emits_exact_signer_challenges_before_signatures_exist(tmp_path: Path) -> None:
    bundle, document, _ = _create_bundle(tmp_path)
    for reviewer in document["reviewers"]:
        reviewer["possession_proof_signature_base64"] = None
    _rewrite_input(bundle, document)

    outputs = write_provisioning_challenges(bundle)

    assert set(outputs) == {reviewer["reviewer_id"] for reviewer in document["reviewers"]}
    for output, digest in outputs.values():
        assert output.name.endswith(".challenge.bin")
        assert digest == _sha256(output.read_bytes())
        assert stat.S_IMODE(output.stat().st_mode) == 0o600
    with pytest.raises(AgentIdentityProvisioningError, match="expected canonical Base64"):
        prepare_candidate_registry(bundle)


def test_rejects_stale_source_registry_digest(tmp_path: Path) -> None:
    bundle, document, _ = _create_bundle(tmp_path)
    document["source_registry_sha256"] = "0" * 64
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match="digest mismatch"):
        prepare_candidate_registry(bundle)


@pytest.mark.parametrize(
    ("field", "mutable_alias"),
    [
        ("model_revision", "review-model-1@2026-07-28"),
        ("runtime_version", "review-runtime-v1.0.0"),
    ],
)
def test_rejects_mutable_model_or_runtime_revision_alias(
    tmp_path: Path,
    field: str,
    mutable_alias: str,
) -> None:
    bundle, document, _ = _create_bundle(tmp_path)
    document["reviewers"][0][field] = mutable_alias
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match="invalid field"):
        prepare_candidate_registry(bundle)


def test_rejects_platform_contract_when_any_authorization_gate_is_open(
    tmp_path: Path,
) -> None:
    bundle, _, _ = _create_bundle(tmp_path)
    project = _shadow_project(tmp_path)
    platform_path = project / "configs/platform_contract.json"
    platform = json.loads(platform_path.read_text(encoding="utf-8"))
    platform["authorization"]["serving"] = True
    platform_path.write_text(json.dumps(platform, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(AgentIdentityProvisioningError, match="gates must remain fully blocked"):
        prepare_candidate_registry(bundle, project_root=project)


def test_rejects_cross_agent_possession_proof(tmp_path: Path) -> None:
    bundle, document, private_keys = _create_bundle(tmp_path)
    _resign(document, reviewer_index=0, private_key=private_keys[1], bundle=bundle)
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match="signature verification failed"):
        prepare_candidate_registry(bundle)


def test_rejects_key_validity_end_before_start(tmp_path: Path) -> None:
    bundle, document, private_keys = _create_bundle(tmp_path)
    key = document["reviewers"][0]["receipt_verification_key"]
    key["valid_from_utc"] = "2030-01-02T00:00:00Z"
    key["valid_until_or_open_ended"] = "2030-01-01T00:00:00Z"
    _resign(document, reviewer_index=0, private_key=private_keys[0], bundle=bundle)
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match="end must be after validity start"):
        prepare_candidate_registry(bundle)


def test_rejects_already_expired_key_validity_window(tmp_path: Path) -> None:
    bundle, document, private_keys = _create_bundle(tmp_path)
    key = document["reviewers"][0]["receipt_verification_key"]
    key["valid_from_utc"] = "2020-01-01T00:00:00Z"
    key["valid_until_or_open_ended"] = "2021-01-01T00:00:00Z"
    _resign(document, reviewer_index=0, private_key=private_keys[0], bundle=bundle)
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match="already expired"):
        prepare_candidate_registry(bundle)


@pytest.mark.parametrize(
    ("field", "message"),
    [
        ("workload_identity_id", "distinct workload_identity_id"),
        ("model_lineage_id", "distinct model_lineage_id"),
        ("policy_lineage_id", "distinct policy_lineage_id"),
    ],
)
def test_rejects_shared_identity_or_lineage(
    tmp_path: Path,
    field: str,
    message: str,
) -> None:
    bundle, document, private_keys = _create_bundle(tmp_path)
    document["reviewers"][1][field] = document["reviewers"][0][field]
    _resign(document, reviewer_index=1, private_key=private_keys[1], bundle=bundle)
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match=message):
        prepare_candidate_registry(bundle)


def test_rejects_same_model_stack_even_with_different_revision(tmp_path: Path) -> None:
    bundle, document, private_keys = _create_bundle(tmp_path)
    document["reviewers"][1]["model_provider"] = document["reviewers"][0]["model_provider"]
    document["reviewers"][1]["model_id"] = document["reviewers"][0]["model_id"]
    _resign(document, reviewer_index=1, private_key=private_keys[1], bundle=bundle)
    _rewrite_input(bundle, document)

    with pytest.raises(AgentIdentityProvisioningError, match="distinct model stacks"):
        prepare_candidate_registry(bundle)


def test_rejects_shared_public_key_and_materially_identical_policy_stack(
    tmp_path: Path,
) -> None:
    bundle, document, private_keys = _create_bundle(tmp_path)
    document["reviewers"][1]["receipt_verification_key"] = json.loads(
        json.dumps(document["reviewers"][0]["receipt_verification_key"])
    )
    _resign(document, reviewer_index=1, private_key=private_keys[0], bundle=bundle)
    _rewrite_input(bundle, document)
    with pytest.raises(AgentIdentityProvisioningError, match="distinct receipt_issuer_key_id"):
        prepare_candidate_registry(bundle)

    second_root = tmp_path / "second"
    second_root.mkdir()
    bundle, document, private_keys = _create_bundle(second_root)
    for field in (
        "system_instruction_path",
        "inference_policy_path",
        "conflict_policy_path",
        "recusal_policy_path",
    ):
        document["reviewers"][1][field] = document["reviewers"][0][field]
    _resign(document, reviewer_index=1, private_key=private_keys[1], bundle=bundle)
    _rewrite_input(bundle, document)
    with pytest.raises(AgentIdentityProvisioningError, match="distinct policy stacks"):
        prepare_candidate_registry(bundle)


def test_rejects_private_key_field_and_symlinked_artifact(tmp_path: Path) -> None:
    bundle, document, _ = _create_bundle(tmp_path)
    document["reviewers"][0]["private_key_base64"] = "prohibited"
    _rewrite_input(bundle, document)
    with pytest.raises(AgentIdentityProvisioningError, match="invalid field"):
        prepare_candidate_registry(bundle)

    del document["reviewers"][0]["private_key_base64"]
    artifact = bundle / document["reviewers"][0]["system_instruction_path"]
    artifact.unlink()
    artifact.symlink_to(bundle / document["reviewers"][1]["system_instruction_path"])
    _rewrite_input(bundle, document)
    with pytest.raises(AgentIdentityProvisioningError, match="could not safely read file"):
        prepare_candidate_registry(bundle)


def test_rejects_private_key_material_hidden_in_public_policy_artifact(
    tmp_path: Path,
) -> None:
    bundle, document, _ = _create_bundle(tmp_path)
    artifact = bundle / document["reviewers"][0]["inference_policy_path"]
    pem_boundary = "-" * 5
    begin_marker = f"{pem_boundary}BEGIN {'PRIVATE KEY'}{pem_boundary}"
    end_marker = f"{pem_boundary}END {'PRIVATE KEY'}{pem_boundary}"
    artifact.write_text(
        f"{begin_marker}\nprohibited\n{end_marker}\n",
        encoding="utf-8",
    )

    with pytest.raises(AgentIdentityProvisioningError, match="private-key material"):
        prepare_candidate_registry(bundle)
