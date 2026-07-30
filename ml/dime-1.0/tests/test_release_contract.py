import argparse
import hashlib
import importlib.util
import json
import subprocess
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from dime_ai.release_contract import (
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    CANONICAL_GITHUB_REPOSITORY,
    CANONICAL_REPO_ID,
    DEVELOPMENT_EVAL_REPO_ID,
    FOUNDATION_REPO_ID,
    LOCKED_EVAL_REPO_ID,
    OPTIONAL_FILES,
    PROVENANCE_HASH_FIELDS,
    REMOTE_METADATA_FILES,
    REQUIRED_FILES,
    ReleaseContractError,
    bundle_payload_sha256,
    file_sha256,
    validate_attestation,
    validate_checksum_manifest,
    validate_evaluation_report,
    validate_file_inventory,
    validate_parent_identity,
    validate_platform_authorization,
    validate_remote_inventory,
    validate_repo_id,
    validate_training_manifest,
)

PROJECT = Path(__file__).resolve().parents[1]
PLATFORM_CONTRACT_PATH = PROJECT / "configs/platform_contract.json"
PUBLISHER_PATH = PROJECT / "scripts/publish_adapter.py"
COMMIT_A = "a" * 40
COMMIT_B = "b" * 40
COMMIT_C = "c" * 40
SHA_A = "a" * 64

spec = importlib.util.spec_from_file_location("dime_publish_adapter", PUBLISHER_PATH)
assert spec and spec.loader
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def authorized_platform_contract(
    manifest: dict[str, Any] | None = None,
    *,
    expected_parent_commit: str = COMMIT_A,
    adapter_model_sha256: str | None = None,
    adapter_config_sha256: str | None = None,
    training_manifest_sha256: str | None = None,
    evaluation_summary_sha256: str | None = None,
    bundle_payload_sha256: str | None = None,
    locked_suite_manifest_sha256: str = SHA_A,
    locked_suite_expected_cases: int = 1,
    approved_release_revision: str | None = None,
    comparison_control_kind: str = "pinned_base_control",
    comparison_control_repo_id: str = BASE_MODEL_ID,
    comparison_control_revision: str = BASE_MODEL_REVISION,
    comparison_control_artifact_sha256: str = SHA_A,
    comparison_report_sha256: str = SHA_A,
    quality_slice_report_sha256: str = SHA_A,
) -> dict[str, Any]:
    contract = json.loads(PLATFORM_CONTRACT_PATH.read_text(encoding="utf-8"))
    contract["status"] = "release_authorized"
    contract["authorization"]["adapter_publication"] = True
    contract["hugging_face"]["repositories"]["promoted_adapter"]["current_state"] = (
        "release_authorized"
    )
    contract["hugging_face"]["repositories"]["promoted_adapter"]["approved_release_revision"] = (
        approved_release_revision
    )
    if manifest is not None:
        contract["authorization"]["release_candidate"] = {
            "experiment_id": manifest["experiment_id"],
            "source_github_commit": manifest["source"]["github_commit"],
            "training_authorization_github_commit": manifest["training_authorization"][
                "github_commit"
            ],
            "training_platform_contract_sha256": manifest["training_platform_contract_sha256"],
            "adapter_model_sha256": adapter_model_sha256,
            "adapter_config_sha256": adapter_config_sha256,
            "training_manifest_sha256": training_manifest_sha256,
            "evaluation_summary_sha256": evaluation_summary_sha256,
            "bundle_payload_sha256": bundle_payload_sha256,
            "locked_suite_manifest_sha256": locked_suite_manifest_sha256,
            "locked_suite_expected_cases": locked_suite_expected_cases,
            "comparison_control_kind": comparison_control_kind,
            "comparison_control_repo_id": comparison_control_repo_id,
            "comparison_control_revision": comparison_control_revision,
            "comparison_control_artifact_sha256": comparison_control_artifact_sha256,
            "comparison_report_sha256": comparison_report_sha256,
            "quality_slice_report_sha256": quality_slice_report_sha256,
            "expected_parent_commit": expected_parent_commit,
        }
    return contract


def valid_manifest() -> dict[str, Any]:
    return {
        "artifact_kind": "peft_adapter",
        "run_mode": "full",
        "authorization_status": "authorized_for_full_training",
        "release_review_status": "completed_unreviewed",
        "experiment_id": "dime-foundation-v1-0001",
        "parent_model_id": BASE_MODEL_ID,
        "parent_model_revision": BASE_MODEL_REVISION,
        "source": {
            "github_repository": CANONICAL_GITHUB_REPOSITORY,
            "github_commit": COMMIT_A,
        },
        "training_authorization": {
            "github_commit": COMMIT_B,
        },
        "datasets": {
            "foundation_sft": {
                "repo_id": FOUNDATION_REPO_ID,
                "revision": COMMIT_A,
                "dataset_manifest_sha256": SHA_A,
                "checksums_sha256": SHA_A,
            },
            "development_eval": {
                "repo_id": DEVELOPMENT_EVAL_REPO_ID,
                "revision": COMMIT_B,
            },
            "locked_eval": {
                "repo_id": LOCKED_EVAL_REPO_ID,
                "revision_or_opaque_reference": "locked-eval-approval:2026-07-26-a1",
            },
        },
        "training_platform_contract_sha256": SHA_A,
        "training_preflight": {
            "minimum_validation_events": 6,
            "expected_validation_events": 6,
            "evaluation_and_checkpoint_cadence_aligned": True,
            "best_checkpoint_restoration_verification_required": True,
            "eval_steps": 20,
            "save_steps": 20,
        },
        "early_stopping": {
            "best_checkpoint_restoration_verified": True,
            "best_metric": 0.5,
            "checkpoint_payload_sha256": SHA_A,
            "checkpoint_manifest_sha256": SHA_A,
            "checkpoint_adapter_sha256": SHA_A,
            "staged_adapter_sha256": SHA_A,
        },
        **dict.fromkeys(PROVENANCE_HASH_FIELDS, SHA_A),
    }


def valid_evaluation(
    manifest: dict[str, Any],
    candidate_hashes: dict[str, str],
) -> dict[str, Any]:
    return {
        "report_version": "dime-release-evaluation-summary-v1",
        "evaluator_run_id": "locked-evaluator-run-0001",
        "evaluator": {
            "github_repository": CANONICAL_GITHUB_REPOSITORY,
            "github_commit": COMMIT_C,
            "implementation_sha256": SHA_A,
        },
        "locked_suite": {
            **manifest["datasets"]["locked_eval"],
            "manifest_sha256": SHA_A,
            "expected_cases": 1,
        },
        "comparison": {
            "control": {
                "kind": "pinned_base_control",
                "repo_id": BASE_MODEL_ID,
                "revision": BASE_MODEL_REVISION,
                "artifact_sha256": SHA_A,
            },
            "decision": "candidate_better",
            "paired_cases": 1,
            "candidate_wins": 1,
            "ties": 0,
            "control_wins": 0,
            "control_report_sha256": SHA_A,
            "comparison_report_sha256": SHA_A,
        },
        "quality": {
            "metrics": {
                "critical_tool_routing": 1.0,
                "overall_tool_routing": 0.98,
                "tool_argument_accuracy": 0.98,
                "grounded_factual_claim_precision": 0.98,
                "material_claim_evidence_coverage": 0.95,
                "coaching_metric_fidelity": 0.99,
                "appropriate_abstention": 0.98,
                "blinded_human_rubric_mean": 4.0,
            },
            "max_important_slice_regression_percentage_points": 2.0,
            "slice_report_sha256": SHA_A,
        },
        "inputs": {
            "experiment_id": manifest["experiment_id"],
            "candidate": {
                **candidate_hashes,
                "parent_model_id": BASE_MODEL_ID,
                "parent_model_revision": BASE_MODEL_REVISION,
                "source_github_commit": manifest["source"]["github_commit"],
                "training_authorization_github_commit": manifest["training_authorization"][
                    "github_commit"
                ],
                "config_sha256": manifest["config_sha256"],
                "chat_template_sha256": manifest["chat_template_sha256"],
                "tool_catalog_sha256": manifest["tool_catalog_sha256"],
                "decoding_config_sha256": manifest["decoding_config_sha256"],
            },
            "restricted_report_sha256": SHA_A,
            "human_reviews_sha256": SHA_A,
        },
        "summary": {
            "release_gate_pass": True,
            "control_mode": False,
            "expected_cases": 1,
            "cases_scored": 1,
            "deterministic_passes": 1,
            "case_passes": 1,
            "json_serializable_passes": 1,
            "cases_requiring_human_review": 1,
            "human_review_passes": 1,
            "missing_cases": 0,
            "unknown_cases": 0,
            "duplicate_traces": 0,
            "critical_failures": 0,
        },
    }


def valid_attestation(
    manifest: dict[str, Any],
    platform_contract_sha256: str,
    expected_hashes: dict[str, str],
) -> dict[str, Any]:
    return {
        "schema_version": "dime-release-attestation-v1",
        "release_review_status": "approved_for_release_review",
        "private_registry_publication_approved": True,
        "approved_for_serving": True,
        "repo_id": CANONICAL_REPO_ID,
        "repo_type": "model",
        "expected_parent_commit": COMMIT_A,
        "base_model": {
            "repo_id": BASE_MODEL_ID,
            "revision": BASE_MODEL_REVISION,
        },
        "experiment_id": manifest["experiment_id"],
        "evaluator_run_id": "locked-evaluator-run-0001",
        "approver": "release-owner",
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "source": {
            **manifest["source"],
            "training_authorization_github_commit": manifest["training_authorization"][
                "github_commit"
            ],
            "authorization_github_commit": COMMIT_C,
            "platform_contract_sha256": platform_contract_sha256,
        },
        "datasets": manifest["datasets"],
        "provenance_hashes": {field: manifest[field] for field in PROVENANCE_HASH_FIELDS},
        **expected_hashes,
        "approvals": {
            "platform_publication_authorized": True,
            "provenance_reviewed": True,
            "release_contract_reviewed": True,
            "evaluation_complete": True,
            "base_model_license_reviewed": True,
            "adapter_license_reviewed": True,
            "code_license_reviewed": True,
            "dataset_rights_reviewed": True,
            "evaluation_rights_reviewed": True,
            "feed_rights_reviewed": True,
            "privacy_reviewed": True,
            "responsible_gaming_reviewed": True,
            "security_reviewed": True,
            "locked_evaluation_reviewed": True,
            "serving_reviewed": True,
        },
    }


def write_complete_bundle(
    directory: Path,
    platform_contract_path: Path,
) -> set[str]:
    manifest = valid_manifest()
    chat_template = "{{ messages }}\n"
    manifest["chat_template_sha256"] = hashlib.sha256(chat_template.encode("utf-8")).hexdigest()
    text_files = {
        "README.md": ("# Llama Dime release\n\nBuilt with Llama. Outputs are AI-generated.\n"),
        "LICENSE": "Reviewed Llama license fixture.\n",
        "NOTICE": "Llama attribution fixture.\n",
        "adapter_config.json": json.dumps(
            {
                **deepcopy(publisher.APPROVED_LORA_CONFIG_VALUES),
                "base_model_name_or_path": BASE_MODEL_ID,
                "revision": BASE_MODEL_REVISION,
                "target_modules": sorted(publisher.TARGET_MODULES),
            }
        ),
        "training_manifest.json": json.dumps(manifest),
        "chat_template.jinja": chat_template,
        "generation_config.json": "{}\n",
        "tokenizer.json": "{}\n",
        "tokenizer_config.json": "{}\n",
        "special_tokens_map.json": "{}\n",
        "added_tokens.json": "{}\n",
    }
    for name, content in text_files.items():
        (directory / name).write_text(content, encoding="utf-8")
    (directory / "adapter_model.safetensors").write_bytes(b"adapter fixture")

    present = set(REQUIRED_FILES | OPTIONAL_FILES)
    candidate_hashes = {
        "adapter_model_sha256": file_sha256(directory / "adapter_model.safetensors"),
        "adapter_config_sha256": file_sha256(directory / "adapter_config.json"),
        "training_manifest_sha256": file_sha256(directory / "training_manifest.json"),
    }
    evaluation = valid_evaluation(manifest, candidate_hashes)
    (directory / "evaluation_summary.json").write_text(
        json.dumps(evaluation),
        encoding="utf-8",
    )
    contract = authorized_platform_contract(
        manifest,
        adapter_model_sha256=candidate_hashes["adapter_model_sha256"],
        adapter_config_sha256=candidate_hashes["adapter_config_sha256"],
        training_manifest_sha256=candidate_hashes["training_manifest_sha256"],
        evaluation_summary_sha256=file_sha256(directory / "evaluation_summary.json"),
        bundle_payload_sha256=bundle_payload_sha256(directory, present),
    )
    platform_contract_path.write_text(json.dumps(contract), encoding="utf-8")
    expected_hashes = {
        "bundle_payload_sha256": bundle_payload_sha256(directory, present),
        **candidate_hashes,
        "model_card_sha256": file_sha256(directory / "README.md"),
        "evaluation_report_sha256": file_sha256(directory / "evaluation_summary.json"),
    }
    attestation = valid_attestation(
        manifest,
        file_sha256(platform_contract_path),
        expected_hashes,
    )
    (directory / "release_attestation.json").write_text(
        json.dumps(attestation),
        encoding="utf-8",
    )

    checksum_lines = [
        f"{file_sha256(directory / name)}  {name}"
        for name in sorted(present - {"checksums.sha256"})
    ]
    (directory / "checksums.sha256").write_text(
        "\n".join(checksum_lines) + "\n",
        encoding="utf-8",
    )
    return present


def test_promoted_adapter_file_allowlist_is_exact() -> None:
    assert "LICENSE" in REQUIRED_FILES
    assert "LICENSE.llama3.1" not in REQUIRED_FILES
    assert set(OPTIONAL_FILES) == {
        "added_tokens.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
    }
    assert set(REMOTE_METADATA_FILES) == {".gitattributes"}
    for prohibited in ("model.safetensors", "pytorch_model.bin", "optimizer.pt"):
        assert prohibited not in REQUIRED_FILES


def test_only_canonical_model_repository_is_publishable() -> None:
    validate_repo_id(CANONICAL_REPO_ID)
    with pytest.raises(ReleaseContractError, match="canonical repository"):
        validate_repo_id("taileredsports/Llama-3-Dime-Rehearsal")


def test_current_foundation_contract_cannot_publish() -> None:
    current = json.loads(PLATFORM_CONTRACT_PATH.read_text(encoding="utf-8"))
    with pytest.raises(ReleaseContractError, match="does not authorize"):
        validate_platform_authorization(current)
    validate_platform_authorization(authorized_platform_contract())


def test_platform_contract_must_be_tracked_committed_and_unmodified(
    tmp_path: Path,
) -> None:
    repository = tmp_path / "repo"
    project = repository / "ml/dime-1.0"
    contract_path = project / "configs/platform_contract.json"
    contract_path.parent.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.name", "Dime Test"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.email", "test@example.invalid"],
        check=True,
    )
    contract_path.write_text(
        PLATFORM_CONTRACT_PATH.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "commit", "-qm", "foundation baseline"],
        check=True,
    )
    contract_path.write_text(
        json.dumps(authorized_platform_contract()),
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "commit", "-qm", "release authorization"],
        check=True,
    )
    contract, digest, commit = publisher.load_reviewed_platform_contract(project)
    assert contract["status"] == "release_authorized"
    assert digest == file_sha256(contract_path)
    assert len(commit) == 40

    contract_path.write_text("{}\n", encoding="utf-8")
    with pytest.raises(ReleaseContractError, match="differs from HEAD"):
        publisher.load_reviewed_platform_contract(project)


def test_release_authorization_cannot_reset_a_recorded_champion(tmp_path: Path) -> None:
    repository = tmp_path / "repo"
    project = repository / "ml/dime-1.0"
    contract_path = project / "configs/platform_contract.json"
    contract_path.parent.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.name", "Dime Test"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.email", "test@example.invalid"],
        check=True,
    )

    champion_contract = json.loads(PLATFORM_CONTRACT_PATH.read_text(encoding="utf-8"))
    promoted = champion_contract["hugging_face"]["repositories"]["promoted_adapter"]
    promoted["current_state"] = "approved_release"
    promoted["approved_release_revision"] = COMMIT_C
    contract_path.write_text(json.dumps(champion_contract), encoding="utf-8")
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "commit", "-qm", "record champion"],
        check=True,
    )

    reset_authorization = authorized_platform_contract()
    contract_path.write_text(json.dumps(reset_authorization), encoding="utf-8")
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "commit", "-qm", "reset champion"],
        check=True,
    )

    with pytest.raises(ReleaseContractError, match="preserve.*champion"):
        publisher.load_reviewed_platform_contract(project)


def test_release_authorization_is_bound_to_exact_candidate() -> None:
    manifest = valid_manifest()
    contract = authorized_platform_contract(
        manifest,
        adapter_model_sha256=SHA_A,
        adapter_config_sha256=SHA_A,
        training_manifest_sha256=SHA_A,
        evaluation_summary_sha256=SHA_A,
        bundle_payload_sha256=SHA_A,
    )
    kwargs = {
        "manifest": manifest,
        "expected_parent_commit": COMMIT_A,
        "adapter_model_sha256": SHA_A,
        "adapter_config_sha256": SHA_A,
        "training_manifest_sha256": SHA_A,
        "evaluation_summary_sha256": SHA_A,
        "bundle_payload_sha256": SHA_A,
        "locked_suite_manifest_sha256": SHA_A,
        "locked_suite_expected_cases": 1,
        "comparison_control_kind": "pinned_base_control",
        "comparison_control_repo_id": BASE_MODEL_ID,
        "comparison_control_revision": BASE_MODEL_REVISION,
        "comparison_control_artifact_sha256": SHA_A,
        "comparison_report_sha256": SHA_A,
        "quality_slice_report_sha256": SHA_A,
    }
    validate_platform_authorization(contract, **kwargs)
    with pytest.raises(ReleaseContractError, match="exact candidate"):
        validate_platform_authorization(
            contract,
            **(kwargs | {"adapter_model_sha256": "b" * 64}),
        )
    with pytest.raises(ReleaseContractError, match="exact candidate"):
        validate_platform_authorization(
            contract,
            **(kwargs | {"bundle_payload_sha256": "b" * 64}),
        )
    with pytest.raises(ReleaseContractError, match="exact candidate"):
        validate_platform_authorization(
            contract,
            **(kwargs | {"comparison_report_sha256": "b" * 64}),
        )
    wrong_training_authorization = deepcopy(manifest)
    wrong_training_authorization["training_authorization"]["github_commit"] = COMMIT_C
    with pytest.raises(ReleaseContractError, match="exact candidate"):
        validate_platform_authorization(
            contract,
            **(kwargs | {"manifest": wrong_training_authorization}),
        )
    for incompatible_stage in ("full_training", "locked_evaluation", "serving"):
        overlapping = deepcopy(contract)
        overlapping["authorization"][incompatible_stage] = True
        with pytest.raises(ReleaseContractError, match="release-only"):
            validate_platform_authorization(overlapping, **kwargs)


def test_subsequent_release_requires_current_champion_as_parent_and_control() -> None:
    manifest = valid_manifest()
    champion_revision = COMMIT_C
    contract = authorized_platform_contract(
        manifest,
        approved_release_revision=champion_revision,
        comparison_control_kind="promoted_champion_adapter",
        comparison_control_repo_id=CANONICAL_REPO_ID,
        comparison_control_revision=champion_revision,
        expected_parent_commit=champion_revision,
        adapter_model_sha256=SHA_A,
        adapter_config_sha256=SHA_A,
        training_manifest_sha256=SHA_A,
        evaluation_summary_sha256=SHA_A,
        bundle_payload_sha256=SHA_A,
    )
    kwargs = {
        "manifest": manifest,
        "expected_parent_commit": champion_revision,
        "adapter_model_sha256": SHA_A,
        "adapter_config_sha256": SHA_A,
        "training_manifest_sha256": SHA_A,
        "evaluation_summary_sha256": SHA_A,
        "bundle_payload_sha256": SHA_A,
        "locked_suite_manifest_sha256": SHA_A,
        "locked_suite_expected_cases": 1,
        "comparison_control_kind": "promoted_champion_adapter",
        "comparison_control_repo_id": CANONICAL_REPO_ID,
        "comparison_control_revision": champion_revision,
        "comparison_control_artifact_sha256": SHA_A,
        "comparison_report_sha256": SHA_A,
        "quality_slice_report_sha256": SHA_A,
    }
    validate_platform_authorization(contract, **kwargs)

    with pytest.raises(ReleaseContractError, match="current promoted champion"):
        validate_platform_authorization(
            contract,
            **(kwargs | {"expected_parent_commit": COMMIT_A}),
        )
    with pytest.raises(ReleaseContractError, match="required immutable comparison"):
        validate_platform_authorization(
            contract,
            **(
                kwargs
                | {
                    "comparison_control_kind": "pinned_base_control",
                    "comparison_control_repo_id": BASE_MODEL_ID,
                    "comparison_control_revision": BASE_MODEL_REVISION,
                }
            ),
        )


def test_release_parent_and_provenance_are_exact() -> None:
    manifest = valid_manifest()
    adapter_config = {
        "base_model_name_or_path": BASE_MODEL_ID,
        "revision": BASE_MODEL_REVISION,
    }
    validate_parent_identity(adapter_config, manifest)
    validate_training_manifest(manifest)

    wrong_manifest = deepcopy(manifest)
    wrong_manifest["run_mode"] = "rehearsal"
    with pytest.raises(ReleaseContractError, match="run_mode"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["release_review_status"] = "approved_for_release_review"
    with pytest.raises(ReleaseContractError, match="immutable"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["training_authorization"]["github_commit"] = COMMIT_A
    with pytest.raises(ReleaseContractError, match="must be distinct"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["datasets"]["foundation_sft"]["dataset_manifest_sha256"] = "b" * 64
    with pytest.raises(ReleaseContractError, match="dataset-manifest hash"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["datasets"]["foundation_sft"]["revision"] = "main"
    with pytest.raises(ReleaseContractError, match="40-character"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["training_preflight"]["expected_validation_events"] = 5
    with pytest.raises(ReleaseContractError, match="operable early-stopping"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["early_stopping"]["best_checkpoint_restoration_verified"] = False
    with pytest.raises(ReleaseContractError, match="best-checkpoint restoration"):
        validate_training_manifest(wrong_manifest)
    wrong_manifest = deepcopy(manifest)
    wrong_manifest["early_stopping"]["staged_adapter_sha256"] = "b" * 64
    with pytest.raises(ReleaseContractError, match="does not match"):
        validate_training_manifest(wrong_manifest)


def test_complete_root_only_bundle_and_checksums_pass(tmp_path: Path) -> None:
    contract_path = tmp_path / "platform.json"
    contract_path.write_text(json.dumps(authorized_platform_contract()), encoding="utf-8")
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    assert validate_file_inventory(bundle) == present
    validate_checksum_manifest(bundle, present)


def test_unknown_nested_and_symlink_release_files_are_blocked(tmp_path: Path) -> None:
    contract_path = tmp_path / "platform.json"
    contract_path.write_text(json.dumps(authorized_platform_contract()), encoding="utf-8")
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    write_complete_bundle(bundle, contract_path)
    (bundle / "model.safetensors").write_bytes(b"prohibited full-model fixture")
    with pytest.raises(ReleaseContractError, match="Unknown files"):
        validate_file_inventory(bundle)

    (bundle / "model.safetensors").unlink()
    (bundle / "checkpoint-1").mkdir()
    (bundle / "checkpoint-1/optimizer.pt").write_bytes(b"prohibited checkpoint fixture")
    with pytest.raises(ReleaseContractError, match="Nested directories"):
        validate_file_inventory(bundle)

    (bundle / "checkpoint-1/optimizer.pt").unlink()
    (bundle / "checkpoint-1").rmdir()
    (bundle / "NOTICE").unlink()
    (bundle / "NOTICE").symlink_to(bundle / "LICENSE")
    with pytest.raises(ReleaseContractError, match="Symlinks"):
        validate_file_inventory(bundle)


def test_tokenizer_override_is_optional_but_atomic(tmp_path: Path) -> None:
    contract_path = tmp_path / "platform.json"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    write_complete_bundle(bundle, contract_path)
    for name in (
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "added_tokens.json",
    ):
        (bundle / name).unlink()
    validate_file_inventory(bundle)

    (bundle / "tokenizer.json").write_text("{}\n", encoding="utf-8")
    with pytest.raises(ReleaseContractError, match="complete root-level set"):
        validate_file_inventory(bundle)


def test_checksum_tampering_is_blocked(tmp_path: Path) -> None:
    contract_path = tmp_path / "platform.json"
    contract_path.write_text(json.dumps(authorized_platform_contract()), encoding="utf-8")
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    (bundle / "adapter_model.safetensors").write_bytes(b"tampered")
    with pytest.raises(ReleaseContractError, match="hash mismatch"):
        validate_checksum_manifest(bundle, present)


def test_evaluation_and_attestation_fail_closed() -> None:
    manifest = valid_manifest()
    candidate_hashes = {
        "adapter_model_sha256": SHA_A,
        "adapter_config_sha256": SHA_A,
        "training_manifest_sha256": SHA_A,
    }

    def validate_evaluation(current: dict[str, Any]) -> None:
        validate_evaluation_report(
            current,
            manifest,
            candidate_hashes,
            SHA_A,
            1,
            None,
        )

    evaluation = valid_evaluation(manifest, candidate_hashes)
    validate_evaluation(evaluation)
    evaluation["summary"]["critical_failures"] = 1
    with pytest.raises(ReleaseContractError, match="critical_failures"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["results"] = [{"case_id": "secret-case"}]
    with pytest.raises(ReleaseContractError, match="case-level"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["inputs"]["candidate"]["adapter_model_sha256"] = "b" * 64
    with pytest.raises(ReleaseContractError, match="exact candidate"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["inputs"]["candidate"]["training_authorization_github_commit"] = COMMIT_C
    with pytest.raises(ReleaseContractError, match="exact candidate"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["locked_suite"]["manifest_sha256"] = "b" * 64
    with pytest.raises(ReleaseContractError, match="manifest does not match"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["summary"]["expected_cases"] = 2
    evaluation["summary"]["cases_scored"] = 2
    evaluation["summary"]["deterministic_passes"] = 2
    evaluation["summary"]["case_passes"] = 2
    evaluation["summary"]["json_serializable_passes"] = 2
    with pytest.raises(ReleaseContractError, match="exact case coverage"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["evaluator_run_id"] = "hidden prompt and answer prose"
    with pytest.raises(ReleaseContractError, match="schema failed"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["locked_suite"]["revision_or_opaque_reference"] = "hidden prompt and answer prose"
    with pytest.raises(ReleaseContractError, match="schema failed"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["quality"]["metrics"]["overall_tool_routing"] = 0.979
    with pytest.raises(ReleaseContractError, match="schema failed"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["comparison"]["control"]["repo_id"] = CANONICAL_REPO_ID
    with pytest.raises(ReleaseContractError, match="required immutable control"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["comparison"]["candidate_wins"] = 0
    evaluation["comparison"]["control_wins"] = 1
    with pytest.raises(ReleaseContractError, match="inconsistent"):
        validate_evaluation(evaluation)

    evaluation = valid_evaluation(manifest, candidate_hashes)
    evaluation["comparison"]["control"] = {
        "kind": "promoted_champion_adapter",
        "repo_id": CANONICAL_REPO_ID,
        "revision": COMMIT_C,
        "artifact_sha256": SHA_A,
    }
    validate_evaluation_report(
        evaluation,
        manifest,
        candidate_hashes,
        SHA_A,
        1,
        COMMIT_C,
    )
    with pytest.raises(ReleaseContractError, match="required immutable control"):
        validate_evaluation_report(
            valid_evaluation(manifest, candidate_hashes),
            manifest,
            candidate_hashes,
            SHA_A,
            1,
            COMMIT_C,
        )
    with pytest.raises(ReleaseContractError, match="required immutable control"):
        validate_evaluation_report(
            evaluation,
            manifest,
            candidate_hashes,
            SHA_A,
            1,
            None,
        )

    expected_hashes = {
        "bundle_payload_sha256": SHA_A,
        "adapter_model_sha256": SHA_A,
        "adapter_config_sha256": SHA_A,
        "training_manifest_sha256": SHA_A,
        "model_card_sha256": SHA_A,
        "evaluation_report_sha256": SHA_A,
    }
    attestation = valid_attestation(manifest, SHA_A, expected_hashes)
    validate_attestation(
        attestation,
        manifest,
        COMMIT_A,
        SHA_A,
        COMMIT_C,
        expected_hashes,
        "locked-evaluator-run-0001",
    )
    attestation["approved_for_serving"] = False
    with pytest.raises(ReleaseContractError, match="serving"):
        validate_attestation(
            attestation,
            manifest,
            COMMIT_A,
            SHA_A,
            COMMIT_C,
            expected_hashes,
            "locked-evaluator-run-0001",
        )
    attestation = valid_attestation(manifest, SHA_A, expected_hashes)
    attestation["approver"] = "TODO"
    with pytest.raises(ReleaseContractError, match="placeholder"):
        validate_attestation(
            attestation,
            manifest,
            COMMIT_A,
            SHA_A,
            COMMIT_C,
            expected_hashes,
            "locked-evaluator-run-0001",
        )
    attestation = valid_attestation(manifest, SHA_A, expected_hashes)
    attestation["source"]["authorization_github_commit"] = COMMIT_B
    with pytest.raises(ReleaseContractError, match="distinct from training"):
        validate_attestation(
            attestation,
            manifest,
            COMMIT_A,
            SHA_A,
            COMMIT_B,
            expected_hashes,
            "locked-evaluator-run-0001",
        )


@pytest.mark.parametrize(
    "placeholder",
    ["TODO", "todo", "TBD", "REPLACE", "REPLACE_ME", "REPLACE_WITH_RELEASE_SHA"],
)
def test_model_card_placeholder_detection_is_case_insensitive_and_fail_closed(
    placeholder: str,
) -> None:
    assert publisher.PLACEHOLDER_PATTERN.search(placeholder)


def test_remote_inventory_allows_only_release_files_and_hf_metadata() -> None:
    local = set(REQUIRED_FILES)
    stale, expected = validate_remote_inventory(
        local | {".gitattributes", "added_tokens.json"},
        local,
    )
    assert stale == {"added_tokens.json"}
    assert expected == local | {".gitattributes"}
    with pytest.raises(ReleaseContractError, match="prohibited"):
        validate_remote_inventory(local | {"model.safetensors"}, local)


class FakeHfApi:
    def __init__(self, present: set[str], *, private: bool = True) -> None:
        self.uploaded_bundle: Path | None = None
        self.present = present
        self.private = private
        self.upload_calls: list[dict[str, Any]] = []
        self.published = False

    def model_info(self, repo_id: str, revision: str) -> SimpleNamespace:
        assert repo_id == CANONICAL_REPO_ID
        assert revision == "main"
        return SimpleNamespace(private=self.private, sha=COMMIT_A)

    def list_repo_files(
        self,
        repo_id: str,
        repo_type: str,
        revision: str,
    ) -> list[str]:
        assert repo_id == CANONICAL_REPO_ID
        assert repo_type == "model"
        if revision == COMMIT_A:
            return [".gitattributes", "README.md"]
        assert revision == COMMIT_B
        return sorted(self.present | {".gitattributes"})

    def upload_folder(self, **kwargs: Any) -> SimpleNamespace:
        self.upload_calls.append(kwargs)
        self.uploaded_bundle = Path(kwargs["folder_path"])
        self.published = True
        return SimpleNamespace(oid=COMMIT_B)

    def hf_hub_download(self, **kwargs: Any) -> str:
        assert kwargs["revision"] == COMMIT_B
        assert self.published
        assert self.uploaded_bundle is not None
        return str(self.uploaded_bundle / kwargs["filename"])


class MutatingFakeHfApi(FakeHfApi):
    def __init__(self, present: set[str], original_bundle: Path) -> None:
        super().__init__(present)
        self.original_bundle = original_bundle

    def upload_folder(self, **kwargs: Any) -> SimpleNamespace:
        self.original_bundle.joinpath("adapter_model.safetensors").write_bytes(
            b"mutated after snapshot"
        )
        return super().upload_folder(**kwargs)


def publisher_args(
    bundle: Path,
    receipt_path: Path,
) -> argparse.Namespace:
    return argparse.Namespace(
        adapter_dir=bundle,
        repo_id=CANONICAL_REPO_ID,
        confirm_repo=CANONICAL_REPO_ID,
        expected_parent_commit=COMMIT_A,
        evaluation_report=bundle / "evaluation_summary.json",
        release_attestation=bundle / "release_attestation.json",
        receipt=receipt_path,
        private=True,
    )


def test_publisher_uses_parent_guard_and_emits_verified_receipt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract_path = tmp_path / "platform.json"
    contract_path.write_text(json.dumps(authorized_platform_contract()), encoding="utf-8")
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    receipt_path = tmp_path / "receipt.json"
    api = FakeHfApi(present)
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(
        publisher,
        "load_reviewed_platform_contract",
        lambda: (contract, file_sha256(contract_path), COMMIT_C),
    )
    monkeypatch.setattr(
        publisher,
        "validate_adapter_safetensors",
        lambda _path, _config: None,
    )

    receipt = publisher.publish_adapter(
        publisher_args(bundle, receipt_path),
        api,
        api,
    )

    assert receipt["parent_commit"] == COMMIT_A
    assert receipt["published_commit"] == COMMIT_B
    assert receipt["verification"] == {
        "result": "passed",
        "parent_commit_guard": True,
        "exact_inventory": True,
        "pinned_remote_hashes": True,
    }
    assert json.loads(receipt_path.read_text(encoding="utf-8")) == receipt
    assert len(api.upload_calls) == 1
    upload = api.upload_calls[0]
    assert upload["parent_commit"] == COMMIT_A
    assert upload["revision"] == "main"
    assert set(upload["allow_patterns"]) == REQUIRED_FILES | OPTIONAL_FILES
    assert upload["delete_patterns"] is None


def test_publisher_uploads_and_verifies_immutable_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract_path = tmp_path / "platform.json"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    original_hash = file_sha256(bundle / "adapter_model.safetensors")
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(
        publisher,
        "load_reviewed_platform_contract",
        lambda: (contract, file_sha256(contract_path), COMMIT_C),
    )
    monkeypatch.setattr(
        publisher,
        "validate_adapter_safetensors",
        lambda _path, _config: None,
    )
    api = MutatingFakeHfApi(present, bundle)
    receipt = publisher.publish_adapter(
        publisher_args(bundle, tmp_path / "receipt.json"),
        api,
        api,
    )
    assert file_sha256(bundle / "adapter_model.safetensors") != original_hash
    assert receipt["files"]["adapter_model.safetensors"] == original_hash
    assert api.uploaded_bundle is not None
    assert api.uploaded_bundle != bundle


def test_publisher_requires_explicit_private_confirmation_before_api_use(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract_path = tmp_path / "platform.json"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(
        publisher,
        "load_reviewed_platform_contract",
        lambda: (contract, file_sha256(contract_path), COMMIT_C),
    )
    monkeypatch.setattr(
        publisher,
        "validate_adapter_safetensors",
        lambda _path, _config: None,
    )
    api = FakeHfApi(present)
    args = publisher_args(bundle, tmp_path / "receipt.json")
    args.private = False
    with pytest.raises(ReleaseContractError, match="explicit private-repository"):
        publisher.publish_adapter(args, api, api)
    assert api.upload_calls == []


def test_publisher_requires_writable_receipt_before_upload(tmp_path: Path) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    blocked_parent = tmp_path / "not-a-directory"
    blocked_parent.write_text("blocks receipt directory creation\n", encoding="utf-8")
    api = FakeHfApi(set())

    with pytest.raises(ReleaseContractError, match="not durably writable"):
        publisher.publish_adapter(
            publisher_args(bundle, blocked_parent / "receipt.json"),
            api,
            api,
        )
    assert api.upload_calls == []


def test_publisher_rejects_public_destination_before_upload(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract_path = tmp_path / "platform.json"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(
        publisher,
        "load_reviewed_platform_contract",
        lambda: (contract, file_sha256(contract_path), COMMIT_C),
    )
    monkeypatch.setattr(
        publisher,
        "validate_adapter_safetensors",
        lambda _path, _config: None,
    )
    api = FakeHfApi(present, private=False)
    with pytest.raises(ReleaseContractError, match="must already be a private"):
        publisher.publish_adapter(
            publisher_args(bundle, tmp_path / "receipt.json"),
            api,
            api,
        )
    assert api.upload_calls == []


def test_publisher_never_calls_api_while_platform_is_foundation_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract_path = tmp_path / "platform.json"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    present = write_complete_bundle(bundle, contract_path)
    api = FakeHfApi(present)
    args = argparse.Namespace(
        adapter_dir=bundle,
        repo_id=CANONICAL_REPO_ID,
        confirm_repo=CANONICAL_REPO_ID,
        expected_parent_commit=COMMIT_A,
        evaluation_report=bundle / "evaluation_summary.json",
        release_attestation=bundle / "release_attestation.json",
        receipt=tmp_path / "receipt.json",
        private=True,
    )
    current = json.loads(PLATFORM_CONTRACT_PATH.read_text(encoding="utf-8"))
    monkeypatch.setattr(
        publisher,
        "load_reviewed_platform_contract",
        lambda: (current, file_sha256(PLATFORM_CONTRACT_PATH), COMMIT_C),
    )
    monkeypatch.setattr(
        publisher,
        "validate_adapter_safetensors",
        lambda _path, _config: None,
    )
    with pytest.raises(ReleaseContractError, match="does not authorize"):
        publisher.publish_adapter(args, api, api)
    assert api.upload_calls == []


def test_atomic_receipt_writer_never_overwrites_existing_evidence(tmp_path: Path) -> None:
    receipt_path = tmp_path / "receipt.json"
    receipt_path.write_text('{"existing":"evidence"}\n', encoding="utf-8")

    with pytest.raises(ReleaseContractError, match="could not be persisted"):
        publisher.write_receipt_atomic(
            receipt_path,
            {"replacement": "blocked"},
            COMMIT_B,
        )

    assert receipt_path.read_text(encoding="utf-8") == '{"existing":"evidence"}\n'


@pytest.mark.parametrize("name", ["NOTICE", "LICENSE"])
@pytest.mark.parametrize(
    "secret_line",
    [
        'access_token="synthetic-sensitive-value"',
        '{"api_key":"sensitive-value"}',
        "password: 'sensitive-value'",
    ],
)
def test_extensionless_release_files_are_secret_scanned(
    tmp_path: Path,
    name: str,
    secret_line: str,
) -> None:
    path = tmp_path / name
    path.write_text(secret_line + "\n", encoding="utf-8")
    with pytest.raises(ReleaseContractError, match="Possible secret"):
        publisher.scan_artifacts([path])


def test_renamed_non_safetensors_payload_is_rejected(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    adapter.write_bytes(b"not a safetensors checkpoint")
    config = {
        **deepcopy(publisher.APPROVED_LORA_CONFIG_VALUES),
        "base_model_name_or_path": BASE_MODEL_ID,
        "revision": BASE_MODEL_REVISION,
        "r": 16,
        "target_modules": sorted(publisher.TARGET_MODULES),
    }
    with pytest.raises(ReleaseContractError, match="not a valid Dime LoRA"):
        publisher.validate_adapter_safetensors(adapter, config)
