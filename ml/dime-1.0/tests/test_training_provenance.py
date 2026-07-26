import importlib.util
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from types import ModuleType

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
TRAIN_SCRIPT = PROJECT / "scripts/train_qlora.py"
FULL_TEMPLATE = PROJECT / "configs/sft_full_TEMPLATE.yaml"
REHEARSAL_CONFIG = PROJECT / "configs/sft_rehearsal.yaml"
DECODING_CONFIG = PROJECT / "configs/decoding_v1.json"
RUN_MANIFEST_SCHEMA = PROJECT / "schemas/run_manifest.schema.json"
FOUNDATION_CHECKSUMS_SCHEMA = PROJECT / "schemas/foundation_checksums.schema.json"
RUNPOD_RUNBOOK = PROJECT / "docs/RUNPOD_WORKSPACE_RUNBOOK.md"

SOURCE_SHA = "a" * 40
FOUNDATION_SHA = "b" * 40
DEVELOPMENT_SHA = "c" * 40
EXPERIMENT_ID = "dime-foundation-v1-20260726-a1"
LOCKED_REFERENCE = "locked-eval-approval:2026-07-26-a1"
DATASET_MANIFEST_HASH = "d" * 64
CHECKSUMS_HASH = "e" * 64
CONFIG_HASH = "f" * 64
RUN_MANIFEST_HASH = "1" * 64


def load_training_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dime_train_qlora_test", TRAIN_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TRAINING = load_training_module()


def approved_full_config() -> dict[str, object]:
    config = yaml.safe_load(FULL_TEMPLATE.read_text(encoding="utf-8"))
    config["run"].update(
        {
            "name": EXPERIMENT_ID,
            "experiment_id": EXPERIMENT_ID,
        }
    )
    datasets = config["provenance"]["datasets"]
    datasets["foundation_sft"]["revision"] = FOUNDATION_SHA
    datasets["development_eval"]["revision"] = DEVELOPMENT_SHA
    datasets["locked_eval"]["revision_or_opaque_reference"] = LOCKED_REFERENCE

    foundation_root = f"/workspace/datasets/foundation-sft/{FOUNDATION_SHA}/foundation-v1"
    config["data"].update(
        {
            "train": f"{foundation_root}/train.jsonl",
            "validation": f"{foundation_root}/validation.jsonl",
            "manifest": f"{foundation_root}/dataset_manifest.json",
            "checksums": f"{foundation_root}/checksums.json",
            "dataset_card": f"{foundation_root}/dataset_card.md",
        }
    )
    run_root = f"/workspace/runs/{EXPERIMENT_ID}"
    config["run"]["manifest"] = f"{run_root}/run_manifest.json"
    config["training"].update(
        {
            "output_dir": f"{run_root}/checkpoints",
            "final_adapter_dir": f"{run_root}/adapters/final",
        }
    )
    return config


def test_full_config_binds_exact_immutable_provenance() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)

    assert provenance == {
        "experiment_id": EXPERIMENT_ID,
        "authorization_status": "authorized_for_full_training",
        "release_review_status": "completed_unreviewed",
        "source": {
            "github_repository": "aisportsbettingcontact/ai-sports-betting-dime-ai",
        },
        "datasets": {
            "foundation_sft": {
                "repo_id": "taileredsports/dime-foundation-sft",
                "revision": FOUNDATION_SHA,
            },
            "development_eval": {
                "repo_id": "taileredsports/dime-eval-development",
                "revision": DEVELOPMENT_SHA,
            },
            "locked_eval": {
                "repo_id": "taileredsports/dime-eval-locked",
                "revision_or_opaque_reference": LOCKED_REFERENCE,
            },
        },
    }


@pytest.mark.parametrize(
    ("section", "key"),
    [
        (("provenance", "datasets", "foundation_sft"), "revision"),
        (("provenance", "datasets", "development_eval"), "revision"),
    ],
)
def test_full_config_rejects_non_commit_revisions(
    section: tuple[str, ...],
    key: str,
) -> None:
    config = approved_full_config()
    target = config
    for part in section:
        target = target[part]
    target[key] = "main"

    with pytest.raises(ValueError, match="40-character commit SHA"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_full_config_rejects_placeholders_and_secret_locked_references() -> None:
    config = approved_full_config()
    config["run"]["experiment_id"] = "REPLACE_ME"
    config["run"]["name"] = "REPLACE_ME"
    with pytest.raises(ValueError, match="non-placeholder"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["provenance"]["datasets"]["locked_eval"]["revision_or_opaque_reference"] = (
        "reference:hf_not-a-governance-reference"
    )
    with pytest.raises(ValueError, match="structured opaque"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["provenance"]["datasets"]["locked_eval"]["revision_or_opaque_reference"] = (
        "human-readable hidden suite prose"
    )
    with pytest.raises(ValueError, match="structured opaque"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_training_and_release_share_the_same_experiment_id_boundary() -> None:
    config = approved_full_config()
    config["run"]["name"] = "short"
    config["run"]["experiment_id"] = "short"
    with pytest.raises(ValueError, match="unique"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["run"]["name"] = "12345678"
    config["run"]["experiment_id"] = "12345678"
    config["run"]["manifest"] = "/workspace/runs/12345678/run_manifest.json"
    config["training"]["output_dir"] = "/workspace/runs/12345678/checkpoints"
    config["training"]["final_adapter_dir"] = "/workspace/runs/12345678/adapters/final"
    provenance = TRAINING.assert_config(config, allow_full_run=True)
    assert provenance is not None
    assert provenance["experiment_id"] == "12345678"


def git_commit(repository: Path, message: str) -> str:
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "commit", "-qm", message],
        check=True,
    )
    return subprocess.run(
        ["git", "-C", str(repository), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def authorized_git_fixture(tmp_path: Path) -> tuple[Path, Path, Path, str, str]:
    repository = tmp_path / "repo"
    project = repository / "ml/dime-1.0"
    (project / "configs").mkdir(parents=True)
    tracked = project / "tracked.txt"
    config_path = project / "configs/sft_full.yaml"
    platform_contract = project / "configs/platform_contract.json"
    tracked.write_text("reviewed\n", encoding="utf-8")
    config_path.write_text("run:\n  mode: full\n", encoding="utf-8")
    platform_contract.write_text('{"status": "foundation_only"}\n', encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.name", "Dime Test"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.email", "test@example.invalid"],
        check=True,
    )
    source_commit = git_commit(repository, "reviewed source")
    platform_contract.write_text('{"status": "training_authorized"}\n', encoding="utf-8")
    authorization_commit = git_commit(repository, "authorize exact training candidate")
    return project, config_path, tracked, source_commit, authorization_commit


def test_full_training_requires_two_commit_authorization_chain(tmp_path: Path) -> None:
    project, config_path, tracked, source_commit, authorization_commit = authorized_git_fixture(
        tmp_path
    )
    assert (
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
        )
        == authorization_commit
    )

    tracked.write_text("locally changed\n", encoding="utf-8")
    with pytest.raises(ValueError, match="clean Git worktree"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
        )


def test_authorization_chain_rejects_any_other_project_change(tmp_path: Path) -> None:
    project, config_path, tracked, source_commit, _ = authorized_git_fixture(tmp_path)
    tracked.write_text("changed after source\n", encoding="utf-8")
    git_commit(tmp_path / "repo", "unauthorized code change")

    with pytest.raises(ValueError, match="Only the canonical platform contract"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
        )


def test_authorization_chain_rejects_changes_elsewhere_in_repository(tmp_path: Path) -> None:
    project, config_path, _, source_commit, _ = authorized_git_fixture(tmp_path)
    (tmp_path / "repo/README.md").write_text("unrelated change\n", encoding="utf-8")
    git_commit(tmp_path / "repo", "bundle unrelated repository change")

    with pytest.raises(ValueError, match="anywhere in the repository"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
        )


def test_full_config_rejects_revision_path_or_run_path_mismatch() -> None:
    config = approved_full_config()
    config["data"]["train"] = config["data"]["train"].replace(
        FOUNDATION_SHA,
        "d" * 40,
    )
    with pytest.raises(ValueError, match="foundation revision path"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["training"]["output_dir"] = "/workspace/runs/wrong/checkpoints"
    with pytest.raises(ValueError, match="experiment-scoped path"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_full_config_requires_authorization_status_and_explicit_flag() -> None:
    config = approved_full_config()
    with pytest.raises(ValueError, match="--allow-full-run"):
        TRAINING.assert_config(config, allow_full_run=False)

    config["run"]["authorization_status"] = "draft"
    with pytest.raises(ValueError, match="authorized_for_full_training"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["run"]["release_review_status"] = "approved_for_release_review"
    with pytest.raises(ValueError, match="cannot pre-approve"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_current_platform_contract_blocks_full_training() -> None:
    current = json.loads((PROJECT / "configs/platform_contract.json").read_text(encoding="utf-8"))
    with pytest.raises(ValueError, match="does not authorize"):
        TRAINING.validate_full_training_authorization(
            current,
            approved_full_config()["provenance"] | {"experiment_id": EXPERIMENT_ID},
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
        )

    authorized = deepcopy(current)
    authorized["status"] = "training_authorized"
    authorized["authorization"]["full_training"] = True
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None
    authorized["authorization"]["training_candidate"] = {
        "experiment_id": provenance["experiment_id"],
        "source_github_commit": SOURCE_SHA,
        "foundation_revision": provenance["datasets"]["foundation_sft"]["revision"],
        "foundation_dataset_manifest_sha256": DATASET_MANIFEST_HASH,
        "foundation_checksums_sha256": CHECKSUMS_HASH,
        "development_eval_revision": provenance["datasets"]["development_eval"]["revision"],
        "locked_eval_reference": provenance["datasets"]["locked_eval"][
            "revision_or_opaque_reference"
        ],
        "config_sha256": CONFIG_HASH,
        "run_manifest_sha256": RUN_MANIFEST_HASH,
    }
    assert (
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
        )
        == SOURCE_SHA
    )

    authorized["authorization"]["training_candidate"]["foundation_checksums_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="exact candidate"):
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
        )


def foundation_snapshot_fixture(tmp_path: Path) -> dict[str, Path]:
    snapshot = tmp_path / "foundation-v1"
    snapshot.mkdir()
    paths = {
        "train": snapshot / "train.jsonl",
        "validation": snapshot / "validation.jsonl",
        "manifest": snapshot / "dataset_manifest.json",
        "checksums": snapshot / "checksums.json",
        "dataset_card": snapshot / "dataset_card.md",
        "curriculum": tmp_path / "curriculum.yaml",
        "tools": tmp_path / "tools.json",
        "template": tmp_path / "template.jinja",
    }
    paths["train"].write_text('{"example_id":"train-fixture"}\n', encoding="utf-8")
    paths["validation"].write_text('{"example_id":"validation-fixture"}\n', encoding="utf-8")
    paths["dataset_card"].write_text("# Approved private fixture\n", encoding="utf-8")
    paths["curriculum"].write_text("schema_version: fixture\n", encoding="utf-8")
    paths["tools"].write_text("[]\n", encoding="utf-8")
    paths["template"].write_text("fixture\n", encoding="utf-8")
    manifest = {
        "schema_version": "dime-dataset-manifest-v3",
        "dataset_version": "dime-foundation-private-v1",
        "visibility": "private",
        "publication_classification": "private-only",
        "provenance_source_class": "synthetic",
        "source_owner": "Tailered Sports",
        "rights_basis": "owned synthetic fixtures",
        "license_or_usage_restrictions": "private training only",
        "synthetic_status": "fully-synthetic",
        "contains_user_data": False,
        "contains_provider_derived_data": False,
        "approval_status": "approved",
        "approved": True,
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "reviewer_ids": ["foundation-review-20260726"],
        "train_record_count": 1,
        "validation_record_count": 1,
        "train_sha256": TRAINING.file_sha256(paths["train"]),
        "validation_sha256": TRAINING.file_sha256(paths["validation"]),
        "curriculum_config_sha256": TRAINING.file_sha256(paths["curriculum"]),
        "tool_catalog_sha256": TRAINING.file_sha256(paths["tools"]),
        "chat_template_sha256": TRAINING.file_sha256(paths["template"]),
        "rights_reviewed": True,
        "consent_reviewed": True,
        "privacy_reviewed": True,
        "partition_audit_passed": True,
        "future_data_audit_passed": True,
        "semantic_dedup_audit_passed": True,
        "evaluation_contamination_audit_passed": True,
        "direct_identifier_scan_version": "scan-v1",
        "deletion_policy_id": "deletion-v1",
        "limitations_notes": "Synthetic private test fixture.",
    }
    paths["manifest"].write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_snapshot_checksums(paths)
    return paths


def write_snapshot_checksums(paths: dict[str, Path]) -> None:
    checksums = {
        "schema_version": "dime-foundation-checksums-v1",
        "files": {
            "train.jsonl": TRAINING.file_sha256(paths["train"]),
            "validation.jsonl": TRAINING.file_sha256(paths["validation"]),
            "dataset_manifest.json": TRAINING.file_sha256(paths["manifest"]),
            "dataset_card.md": TRAINING.file_sha256(paths["dataset_card"]),
        },
    }
    paths["checksums"].write_text(
        json.dumps(checksums, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def validate_snapshot(paths: dict[str, Path]) -> tuple[list[dict], list[dict], str, str]:
    return TRAINING.validate_foundation_snapshot(
        train_path=paths["train"],
        validation_path=paths["validation"],
        dataset_manifest_path=paths["manifest"],
        checksums_path=paths["checksums"],
        dataset_card_path=paths["dataset_card"],
        checksums_schema_path=FOUNDATION_CHECKSUMS_SCHEMA,
        curriculum_path=paths["curriculum"],
        tool_catalog_path=paths["tools"],
        template_path=paths["template"],
    )


def test_foundation_snapshot_requires_v3_private_manifest_and_exact_checksums(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    train, validation, manifest_hash, checksums_hash = validate_snapshot(paths)
    assert train == [{"example_id": "train-fixture"}]
    assert validation == [{"example_id": "validation-fixture"}]
    assert manifest_hash == TRAINING.file_sha256(paths["manifest"])
    assert checksums_hash == TRAINING.file_sha256(paths["checksums"])

    paths["train"].write_text('{"example_id":"tampered"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="checksum mismatch: train.jsonl"):
        validate_snapshot(paths)


def test_foundation_snapshot_rejects_legacy_manifest_even_when_rehashed(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["schema_version"] = "dime-dataset-manifest-v2"
    paths["manifest"].write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    write_snapshot_checksums(paths)

    with pytest.raises(ValueError, match="requires a dime-dataset-manifest-v3"):
        validate_snapshot(paths)


def run_manifest_fixture(tmp_path: Path) -> tuple[Path, dict, dict, dict[str, Path]]:
    config = approved_full_config()
    config_path = tmp_path / "sft_full.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    provenance = TRAINING.assert_config(config, allow_full_run=True)
    assert provenance is not None
    provenance["source"]["github_commit"] = SOURCE_SHA
    provenance["training_authorization"] = {"github_commit": "2" * 40}
    contract_paths = {
        name: PROJECT / relative for name, relative in config["provenance"]["files"].items()
    }
    runtime_path = PROJECT / "configs/runtime.env"
    requirements_path = PROJECT / "requirements.lock.txt"
    runtime = TRAINING.parse_runtime_contract(runtime_path)
    contracts = {
        "training_config_sha256": TRAINING.file_sha256(config_path),
        "system_prompt_sha256": TRAINING.file_sha256(contract_paths["system_prompt"]),
        "chat_template_sha256": TRAINING.file_sha256(contract_paths["chat_template"]),
        "tool_catalog_sha256": TRAINING.file_sha256(contract_paths["tool_catalog"]),
        "dataset_schema_sha256": TRAINING.file_sha256(contract_paths["dataset_schema"]),
        "evaluation_schema_sha256": TRAINING.file_sha256(contract_paths["evaluation_schema"]),
        "decoding_config_sha256": TRAINING.file_sha256(contract_paths["decoding_config"]),
        "runtime_contract_sha256": TRAINING.file_sha256(runtime_path),
        "requirements_lock_sha256": TRAINING.file_sha256(requirements_path),
        "run_manifest_schema_sha256": TRAINING.file_sha256(contract_paths["run_manifest_schema"]),
        "foundation_checksums_schema_sha256": TRAINING.file_sha256(
            contract_paths["foundation_checksums_schema"]
        ),
    }
    run_root = f"/workspace/runs/{EXPERIMENT_ID}"
    manifest = {
        "schema_version": "dime-run-manifest-v1",
        "experiment_id": EXPERIMENT_ID,
        "status": "preflight",
        "created_at_utc": "2026-07-26T12:00:00Z",
        "owner": "dime-ml-owner",
        "hypothesis": "Approved private foundation data improves tool routing.",
        "authorization": {
            "status": "authorized_for_full_training",
            "reference": "github-review-authorization",
            "approver": "dime-release-owner",
            "approved_at_utc": "2026-07-26T12:30:00Z",
        },
        "source": {
            "github_repository": TRAINING.GITHUB_REPOSITORY,
            "source_github_commit": SOURCE_SHA,
        },
        "datasets": {
            "foundation_sft": {
                **provenance["datasets"]["foundation_sft"],
                "dataset_manifest_sha256": DATASET_MANIFEST_HASH,
                "checksums_sha256": CHECKSUMS_HASH,
            },
            "development_eval": provenance["datasets"]["development_eval"],
            "locked_eval": provenance["datasets"]["locked_eval"],
        },
        "base_model": {
            "repo_id": TRAINING.PINNED_MODEL_ID,
            "revision": TRAINING.PINNED_MODEL_REVISION,
        },
        "starting_adapter": None,
        "contracts": contracts,
        "training": {
            "seed": 1729,
            "output_dir": f"{run_root}/checkpoints",
            "final_adapter_dir": f"{run_root}/adapters/final",
            "logs_dir": f"{run_root}/logs",
            "reports_dir": f"{run_root}/reports",
            "checkpoint_retention": {
                "save_steps": config["training"]["save_steps"],
                "save_total_limit": config["training"]["save_total_limit"],
            },
        },
        "environment": {
            "runpod_image": runtime["RUNPOD_IMAGE"],
            "python": runtime["PYTHON"],
            "pytorch": runtime["PYTORCH"],
            "cuda_runtime": runtime["CUDA_RUNTIME"],
            "gpu": runtime["GPU"],
        },
        "approvals": {
            "privacy": True,
            "provenance": True,
            "rights": True,
            "partition": True,
            "future_data": True,
            "semantic_deduplication": True,
            "evaluation_contamination": True,
        },
        "commands": ["python scripts/train_qlora.py --config configs/sft_full.yaml"],
        "results": {
            "final_artifact_sha256": None,
            "report_sha256": [],
        },
    }
    manifest_path = tmp_path / "run_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest_path, config, provenance, contract_paths


def validate_run_manifest_fixture(
    manifest_path: Path,
    config: dict,
    provenance: dict,
    contract_paths: dict[str, Path],
) -> dict:
    platform_contract = json.loads(
        (PROJECT / "configs/platform_contract.json").read_text(encoding="utf-8")
    )
    return TRAINING.validate_run_manifest(
        manifest_path=manifest_path,
        schema_path=RUN_MANIFEST_SCHEMA,
        config=config,
        config_path=manifest_path.parent / "sft_full.yaml",
        provenance=provenance,
        source_commit=SOURCE_SHA,
        foundation_dataset_manifest_sha256=DATASET_MANIFEST_HASH,
        foundation_checksums_sha256=CHECKSUMS_HASH,
        contract_paths=contract_paths,
        requirements_path=PROJECT / "requirements.lock.txt",
        runtime_path=PROJECT / "configs/runtime.env",
        platform_contract=platform_contract,
    )


def test_run_manifest_is_strict_and_cross_bound_before_training(tmp_path: Path) -> None:
    manifest_path, config, provenance, contract_paths = run_manifest_fixture(tmp_path)
    validated = validate_run_manifest_fixture(
        manifest_path,
        config,
        provenance,
        contract_paths,
    )
    assert validated["experiment_id"] == EXPERIMENT_ID

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["datasets"]["foundation_sft"]["checksums_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="dataset identities"):
        validate_run_manifest_fixture(manifest_path, config, provenance, contract_paths)

    manifest["unexpected"] = True
    manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="violates its schema"):
        validate_run_manifest_fixture(manifest_path, config, provenance, contract_paths)


def test_full_fingerprint_and_manifest_keep_all_provenance_and_hashes(
    tmp_path: Path,
) -> None:
    paths = {}
    for name in (
        "config",
        "train",
        "validation",
        "chat_template",
        "tool_catalog",
        "requirements",
        "runtime",
        "dataset_manifest",
        "curriculum",
        "system_prompt",
        "dataset_schema",
        "evaluation_schema",
        "decoding_config",
        "foundation_checksums",
        "run_manifest",
        "run_manifest_schema",
        "foundation_checksums_schema",
    ):
        path = tmp_path / name
        path.write_text(f"immutable fixture: {name}\n", encoding="utf-8")
        paths[name] = path

    provenance = TRAINING.assert_config(
        approved_full_config(),
        allow_full_run=True,
    )
    assert provenance is not None
    provenance["source"]["github_commit"] = SOURCE_SHA
    provenance["training_authorization"] = {"github_commit": "2" * 40}
    fingerprint = TRAINING.build_run_fingerprint(
        paths["config"],
        paths["train"],
        paths["validation"],
        paths["chat_template"],
        paths["tool_catalog"],
        paths["requirements"],
        paths["runtime"],
        paths["dataset_manifest"],
        paths["curriculum"],
        full_provenance=provenance,
        system_prompt_path=paths["system_prompt"],
        dataset_schema_path=paths["dataset_schema"],
        evaluation_schema_path=paths["evaluation_schema"],
        decoding_config_path=paths["decoding_config"],
        foundation_checksums_path=paths["foundation_checksums"],
        run_manifest_path=paths["run_manifest"],
        run_manifest_schema_path=paths["run_manifest_schema"],
        foundation_checksums_schema_path=paths["foundation_checksums_schema"],
    )

    assert fingerprint["source"] == provenance["source"]
    assert fingerprint["datasets"] == provenance["datasets"]
    assert fingerprint["experiment_id"] == EXPERIMENT_ID
    for field in TRAINING.FULL_FINGERPRINT_HASH_FIELDS:
        assert len(fingerprint[field]) == 64
        int(fingerprint[field], 16)
    assert fingerprint["system_prompt_sha256"] == TRAINING.file_sha256(paths["system_prompt"])
    fingerprint["training_platform_contract_sha256"] = "f" * 64
    TRAINING.validate_full_manifest_provenance(
        deepcopy(fingerprint),
        provenance,
    )

    tampered = deepcopy(fingerprint)
    tampered["datasets"] = "5.0.0"
    with pytest.raises(ValueError, match="datasets"):
        TRAINING.validate_full_manifest_provenance(tampered, provenance)


def test_rehearsal_config_remains_compatible_without_release_provenance() -> None:
    rehearsal = yaml.safe_load(REHEARSAL_CONFIG.read_text(encoding="utf-8"))
    assert TRAINING.assert_config(rehearsal, allow_full_run=False) is None


def test_saved_adapter_config_is_pinned_to_exact_parent_revision(
    tmp_path: Path,
) -> None:
    adapter_config = tmp_path / "adapter_config.json"
    adapter_config.write_text(
        json.dumps(
            {
                "base_model_name_or_path": TRAINING.PINNED_MODEL_ID,
                "revision": None,
                "peft_type": "LORA",
            }
        ),
        encoding="utf-8",
    )
    TRAINING.pin_adapter_config_revision(adapter_config)
    pinned = json.loads(adapter_config.read_text(encoding="utf-8"))
    assert pinned["revision"] == TRAINING.PINNED_MODEL_REVISION

    adapter_config.write_text(
        json.dumps({"base_model_name_or_path": "wrong/model"}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="unexpected parent"):
        TRAINING.pin_adapter_config_revision(adapter_config)


def test_full_template_and_decoding_contract_use_canonical_paths_and_values() -> None:
    template = yaml.safe_load(FULL_TEMPLATE.read_text(encoding="utf-8"))
    experiment_id = template["run"]["experiment_id"]
    run_root = f"/workspace/runs/{experiment_id}"
    foundation_placeholder = template["provenance"]["datasets"]["foundation_sft"]["revision"]
    assert foundation_placeholder in template["data"]["train"]
    assert foundation_placeholder in template["data"]["validation"]
    assert foundation_placeholder in template["data"]["manifest"]
    assert foundation_placeholder in template["data"]["checksums"]
    assert foundation_placeholder in template["data"]["dataset_card"]
    assert template["run"]["manifest"] == f"{run_root}/run_manifest.json"
    assert template["training"]["output_dir"] == f"{run_root}/checkpoints"
    assert template["training"]["final_adapter_dir"] == f"{run_root}/adapters/final"

    runbook = RUNPOD_RUNBOOK.read_text(encoding="utf-8")
    assert '"${DIME_RUN_DIR}/adapters" \\' in runbook
    assert '"${DIME_RUN_DIR}/adapters/final"' not in runbook
    assert "atomically renames it to `final/`" in runbook

    decoding = json.loads(DECODING_CONFIG.read_text(encoding="utf-8"))
    assert decoding == {
        "schema_version": "dime-decoding-v1",
        "purpose": "deterministic-release-evaluation",
        "do_sample": False,
        "temperature": 0,
        "top_p": 1,
        "max_new_tokens": 512,
        "seed": 1729,
    }
