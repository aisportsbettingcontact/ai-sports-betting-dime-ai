#!/usr/bin/env python
"""Guarded single-GPU QLoRA SFT for the pinned Dime parent model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import re
import subprocess
import sys
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from jsonschema import Draft202012Validator, FormatChecker

if TYPE_CHECKING:
    from datasets import Dataset

from dime_ai.chat_format import (
    IGNORE_INDEX,
    AssistantOnlyCollator,
    attach_tool_catalog,
    encode_assistant_only,
)
from dime_ai.data_validation import (
    partition_keys,
    read_jsonl,
    validate_dataset_manifest,
    validate_sft_record,
    validate_unique_ids,
)
from dime_ai.program_audit import audit_curriculum

PINNED_MODEL_ID = "meta-llama/Llama-3.1-8B"
PINNED_MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"
GITHUB_REPOSITORY = "aisportsbettingcontact/ai-sports-betting-dime-ai"
FOUNDATION_DATASET_REPOSITORY = "taileredsports/dime-foundation-sft"
DEVELOPMENT_EVAL_REPOSITORY = "taileredsports/dime-eval-development"
LOCKED_EVAL_REPOSITORY = "taileredsports/dime-eval-locked"
INITIAL_RELEASE_REVIEW_STATUS = "not_started"
TRAINING_OUTPUT_RELEASE_REVIEW_STATUS = "completed_unreviewed"
FULL_TRAINING_AUTHORIZATION_STATUS = "authorized_for_full_training"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
EXPERIMENT_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{7,127}$")
SAFE_LOCKED_REFERENCE = re.compile(
    r"^(?:[0-9a-f]{40}|locked-eval-(?:approval|suite|revision):"
    r"[a-z0-9][a-z0-9._-]{3,95})$"
)
PLACEHOLDER_MARKERS = {"", "none", "null", "replace_me", "tbd", "todo", "latest", "main"}
FULL_PROVENANCE_FILE_PATHS = {
    "system_prompt": "prompts/dime_system_v1.md",
    "chat_template": "prompts/llama3_dime_chat_template_v1.jinja",
    "tool_catalog": "tools/tools.v1.json",
    "dataset_schema": "schemas/sft_record.schema.json",
    "evaluation_schema": "schemas/eval_case.schema.json",
    "decoding_config": "configs/decoding_v1.json",
    "run_manifest_schema": "schemas/run_manifest.schema.json",
    "foundation_checksums_schema": "schemas/foundation_checksums.schema.json",
}
FULL_FINGERPRINT_HASH_FIELDS = {
    "config_sha256",
    "system_prompt_sha256",
    "chat_template_sha256",
    "tool_catalog_sha256",
    "dataset_schema_sha256",
    "evaluation_schema_sha256",
    "decoding_config_sha256",
    "run_manifest_schema_sha256",
    "foundation_checksums_schema_sha256",
    "foundation_dataset_manifest_sha256",
    "foundation_checksums_sha256",
    "run_manifest_sha256",
}
FULL_MANIFEST_HASH_FIELDS = FULL_FINGERPRINT_HASH_FIELDS | {"training_platform_contract_sha256"}
CANONICAL_PLATFORM_CONTRACT = "configs/platform_contract.json"
CANONICAL_PROJECT_PATH = "ml/dime-1.0"
FULL_RUN_REQUIRED_ENTRIES = {
    "checkpoints",
    "adapters",
    "logs",
    "reports",
    "run_manifest.json",
}
PROHIBITED_TRAINING_CREDENTIALS = {
    "dime-serving-read-v1",
    "dime-release-publisher-v1",
    "dime-locked-evaluator-read-v1",
    "dime-locked-publisher-v1",
}
ALLOWED_TARGET_MODULES = {
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument(
        "--allow-full-run",
        action="store_true",
        help="Required when run.mode is full; does not bypass data or model checks.",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="Start from step zero; refuses to overwrite an existing output directory.",
    )
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_output(project: Path, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(project), *args],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError("Cannot verify the full-training Git authorization chain.") from error


def verify_reviewed_authorization_checkout(
    project: Path,
    source_commit: str,
    config_path: Path,
) -> str:
    """Verify a clean authorization HEAD layered only over a prior source commit."""
    source_commit = require_full_sha(source_commit, "source_github_commit")
    try:
        repository_root = Path(git_output(project, "rev-parse", "--show-toplevel")).resolve()
        project_relative = project.resolve().relative_to(repository_root).as_posix()
        if project_relative != CANONICAL_PROJECT_PATH:
            raise ValueError("Full training must run from the canonical ml/dime-1.0 checkout.")
        config_relative = config_path.resolve().relative_to(repository_root).as_posix()
        authorization_commit = require_full_sha(
            git_output(project, "rev-parse", "HEAD"),
            "authorization Git commit",
        )
        status = subprocess.run(
            [
                "git",
                "-C",
                str(project),
                "status",
                "--porcelain",
                "--untracked-files=all",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        raise ValueError("Cannot verify the full-training Git authorization chain.") from error
    if status:
        raise ValueError("Full training requires a completely clean Git worktree.")
    if authorization_commit == source_commit:
        raise ValueError("Full training requires a separate reviewed authorization commit.")
    try:
        subprocess.run(
            ["git", "-C", str(project), "merge-base", "--is-ancestor", source_commit, "HEAD"],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as error:
        raise ValueError(
            "The authorized source commit must be an ancestor of the authorization commit."
        ) from error

    canonical_contract = f"{project_relative}/{CANONICAL_PLATFORM_CONTRACT}"
    changed = git_output(
        repository_root,
        "diff",
        "--name-status",
        "--no-renames",
        source_commit,
        authorization_commit,
    ).splitlines()
    if changed != [f"M\t{canonical_contract}"]:
        raise ValueError(
            "Only the canonical platform contract may change anywhere in the repository "
            "between the source and authorization commits."
        )
    tracked_config = git_output(
        repository_root,
        "ls-tree",
        "--name-only",
        source_commit,
        "--",
        config_relative,
    )
    if tracked_config != config_relative:
        raise ValueError("The full-training config must be tracked in the prior source commit.")
    return authorization_commit


def resolved(project: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else project / path


def load_config(path: Path) -> dict[str, Any]:
    config = yaml.safe_load(path.read_text())
    if not isinstance(config, dict):
        raise ValueError("Training config must contain a mapping.")
    return config


def require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a mapping.")
    return value


def require_full_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not FULL_SHA.fullmatch(value):
        raise ValueError(f"{label} must be an exact lowercase 40-character commit SHA.")
    return value


def contains_placeholder(value: str) -> bool:
    normalized = value.strip().lower()
    return normalized in PLACEHOLDER_MARKERS or "replace" in normalized


def validate_locked_eval_reference(value: Any) -> str:
    if not isinstance(value, str) or contains_placeholder(value):
        raise ValueError(
            "provenance.datasets.locked_eval.revision_or_opaque_reference "
            "must be a non-placeholder revision or opaque reference."
        )
    if "hf_" in value.casefold() or not SAFE_LOCKED_REFERENCE.fullmatch(value):
        raise ValueError(
            "The locked-evaluation reference must be an approved structured opaque "
            "identifier or exact 40-character revision."
        )
    return value


def validate_full_training_config(config: dict[str, Any]) -> dict[str, Any]:
    run = require_mapping(config.get("run"), "run")
    experiment_id = run.get("experiment_id")
    if (
        not isinstance(experiment_id, str)
        or contains_placeholder(experiment_id)
        or not EXPERIMENT_ID.fullmatch(experiment_id)
    ):
        raise ValueError(
            "run.experiment_id must be a unique, non-placeholder identifier using "
            "lowercase letters, numbers, dots, underscores, or hyphens."
        )
    if run.get("name") != experiment_id:
        raise ValueError("Full-run run.name must exactly equal run.experiment_id.")
    if run.get("authorization_status") != FULL_TRAINING_AUTHORIZATION_STATUS:
        raise ValueError(
            "Full training requires run.authorization_status: "
            f"{FULL_TRAINING_AUTHORIZATION_STATUS}."
        )
    if run.get("release_review_status") != INITIAL_RELEASE_REVIEW_STATUS:
        raise ValueError(
            "Full training requires run.release_review_status: "
            f"{INITIAL_RELEASE_REVIEW_STATUS}; training cannot pre-approve its output."
        )

    provenance = require_mapping(config.get("provenance"), "provenance")
    source = require_mapping(provenance.get("source"), "provenance.source")
    if source != {"github_repository": GITHUB_REPOSITORY}:
        raise ValueError(f"GitHub source must be {GITHUB_REPOSITORY}.")

    datasets = require_mapping(provenance.get("datasets"), "provenance.datasets")
    foundation = require_mapping(
        datasets.get("foundation_sft"),
        "provenance.datasets.foundation_sft",
    )
    development = require_mapping(
        datasets.get("development_eval"),
        "provenance.datasets.development_eval",
    )
    locked = require_mapping(
        datasets.get("locked_eval"),
        "provenance.datasets.locked_eval",
    )
    expected_repositories = (
        (foundation, FOUNDATION_DATASET_REPOSITORY, "foundation_sft"),
        (development, DEVELOPMENT_EVAL_REPOSITORY, "development_eval"),
        (locked, LOCKED_EVAL_REPOSITORY, "locked_eval"),
    )
    for details, expected_repository, label in expected_repositories:
        if details.get("repo_id") != expected_repository:
            raise ValueError(f"provenance.datasets.{label}.repo_id must be {expected_repository}.")
    foundation_revision = require_full_sha(
        foundation.get("revision"),
        "provenance.datasets.foundation_sft.revision",
    )
    development_revision = require_full_sha(
        development.get("revision"),
        "provenance.datasets.development_eval.revision",
    )
    locked_reference = validate_locked_eval_reference(locked.get("revision_or_opaque_reference"))

    files = require_mapping(provenance.get("files"), "provenance.files")
    if files != FULL_PROVENANCE_FILE_PATHS:
        raise ValueError(
            "provenance.files must contain the exact frozen prompt, template, tool, "
            "schema, and decoding paths."
        )
    model = require_mapping(config.get("model"), "model")
    if model.get("chat_template") != files["chat_template"]:
        raise ValueError("model.chat_template must match provenance.files.chat_template.")
    if model.get("tool_catalog") != files["tool_catalog"]:
        raise ValueError("model.tool_catalog must match provenance.files.tool_catalog.")

    data = require_mapping(config.get("data"), "data")
    foundation_root = f"/workspace/datasets/foundation-sft/{foundation_revision}/foundation-v1"
    expected_data_paths = {
        "train": f"{foundation_root}/train.jsonl",
        "validation": f"{foundation_root}/validation.jsonl",
        "manifest": f"{foundation_root}/dataset_manifest.json",
        "checksums": f"{foundation_root}/checksums.json",
        "dataset_card": f"{foundation_root}/dataset_card.md",
    }
    for key, expected_path in expected_data_paths.items():
        if data.get(key) != expected_path:
            raise ValueError(f"data.{key} must match the foundation revision path: {expected_path}")

    training = require_mapping(config.get("training"), "training")
    run_root = f"/workspace/runs/{experiment_id}"
    expected_output_paths = {
        "output_dir": f"{run_root}/checkpoints",
        "final_adapter_dir": f"{run_root}/adapters/final",
    }
    for key, expected_path in expected_output_paths.items():
        if training.get(key) != expected_path:
            raise ValueError(f"training.{key} must be the experiment-scoped path: {expected_path}")
    expected_manifest_path = f"{run_root}/run_manifest.json"
    if run.get("manifest") != expected_manifest_path:
        raise ValueError(
            f"run.manifest must be the experiment-scoped path: {expected_manifest_path}"
        )

    return {
        "experiment_id": experiment_id,
        "authorization_status": FULL_TRAINING_AUTHORIZATION_STATUS,
        "release_review_status": TRAINING_OUTPUT_RELEASE_REVIEW_STATUS,
        "source": {
            "github_repository": GITHUB_REPOSITORY,
        },
        "datasets": {
            "foundation_sft": {
                "repo_id": FOUNDATION_DATASET_REPOSITORY,
                "revision": foundation_revision,
            },
            "development_eval": {
                "repo_id": DEVELOPMENT_EVAL_REPOSITORY,
                "revision": development_revision,
            },
            "locked_eval": {
                "repo_id": LOCKED_EVAL_REPOSITORY,
                "revision_or_opaque_reference": locked_reference,
            },
        },
    }


def validate_full_training_authorization(
    contract: dict[str, Any],
    provenance: dict[str, Any],
    config_sha256: str,
    foundation_dataset_manifest_sha256: str,
    foundation_checksums_sha256: str,
    run_manifest_sha256: str,
) -> str:
    if contract.get("schema_version") != "dime-platform-contract-v1":
        raise ValueError("Unsupported platform-contract schema.")
    if contract.get("status") != "training_authorized":
        raise ValueError("Platform status does not authorize full training.")
    authorization = contract.get("authorization")
    if not isinstance(authorization, dict) or authorization.get("full_training") is not True:
        raise ValueError("Platform contract explicitly blocks full training.")
    if any(
        authorization.get(field) is not False
        for field in (
            "locked_evaluation",
            "adapter_publication",
            "serving",
            "provider_activation",
        )
    ):
        raise ValueError(
            "Full-training authorization cannot enable evaluation, publication, or serving."
        )
    if contract.get("github") != {
        "repository": GITHUB_REPOSITORY,
        "project_path": "ml/dime-1.0",
    }:
        raise ValueError("Platform contract has the wrong GitHub identity.")
    if contract.get("base_model") != {
        "repo_type": "model",
        "repo_id": PINNED_MODEL_ID,
        "revision": PINNED_MODEL_REVISION,
    }:
        raise ValueError("Platform contract has the wrong base-model identity.")
    runpod = contract.get("runpod")
    if (
        not isinstance(runpod, dict)
        or runpod.get("credential") != "dime-training-read-v1"
        or set(runpod.get("required_run_entries", [])) != FULL_RUN_REQUIRED_ENTRIES
        or set(runpod.get("prohibited_credentials", [])) != PROHIBITED_TRAINING_CREDENTIALS
        or runpod.get("locked_evaluation_path") is not None
    ):
        raise ValueError("Platform contract has invalid training credential boundaries.")
    candidate = require_mapping(
        authorization.get("training_candidate"),
        "authorization.training_candidate",
    )
    source_commit = require_full_sha(
        candidate.get("source_github_commit"),
        "authorization.training_candidate.source_github_commit",
    )
    expected_candidate = {
        "experiment_id": provenance["experiment_id"],
        "source_github_commit": source_commit,
        "foundation_revision": provenance["datasets"]["foundation_sft"]["revision"],
        "foundation_dataset_manifest_sha256": foundation_dataset_manifest_sha256,
        "foundation_checksums_sha256": foundation_checksums_sha256,
        "development_eval_revision": provenance["datasets"]["development_eval"]["revision"],
        "locked_eval_reference": provenance["datasets"]["locked_eval"][
            "revision_or_opaque_reference"
        ],
        "config_sha256": config_sha256,
        "run_manifest_sha256": run_manifest_sha256,
    }
    if candidate != expected_candidate:
        raise ValueError("Platform training authorization is not bound to this exact candidate.")
    return source_commit


def validate_json_document(
    document: dict[str, Any],
    schema_path: Path,
    label: str,
) -> None:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))
    if errors:
        error = errors[0]
        location = "$"
        if error.absolute_path:
            location += "".join(
                f"[{part}]" if isinstance(part, int) else f".{part}" for part in error.absolute_path
            )
        raise ValueError(f"{label} violates its schema at {location}: {error.message}")


def require_snapshot_file(path: Path, root: Path, label: str) -> None:
    if root.is_symlink() or path.is_symlink():
        raise ValueError(f"{label} must not be a symbolic link.")
    if not root.is_dir() or not path.is_file():
        raise ValueError(f"{label} is missing from the foundation snapshot.")
    if path.parent.resolve() != root.resolve():
        raise ValueError(f"{label} must be a direct member of the foundation snapshot.")


def validate_foundation_snapshot(
    *,
    train_path: Path,
    validation_path: Path,
    dataset_manifest_path: Path,
    checksums_path: Path,
    dataset_card_path: Path,
    checksums_schema_path: Path,
    curriculum_path: Path,
    tool_catalog_path: Path,
    template_path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str]:
    snapshot_root = dataset_manifest_path.parent
    snapshot_files = {
        "train.jsonl": train_path,
        "validation.jsonl": validation_path,
        "dataset_manifest.json": dataset_manifest_path,
        "checksums.json": checksums_path,
        "dataset_card.md": dataset_card_path,
    }
    for name, path in snapshot_files.items():
        require_snapshot_file(path, snapshot_root, name)

    checksums = json.loads(checksums_path.read_text(encoding="utf-8"))
    if not isinstance(checksums, dict):
        raise ValueError("Foundation checksums must contain a JSON object.")
    validate_json_document(checksums, checksums_schema_path, "Foundation checksums")
    expected_hashes = checksums["files"]
    for name in (
        "train.jsonl",
        "validation.jsonl",
        "dataset_manifest.json",
        "dataset_card.md",
    ):
        actual = file_sha256(snapshot_files[name])
        if expected_hashes[name] != actual:
            raise ValueError(f"Foundation snapshot checksum mismatch: {name}")

    dataset_manifest = json.loads(dataset_manifest_path.read_text(encoding="utf-8"))
    if not isinstance(dataset_manifest, dict):
        raise ValueError("Foundation dataset manifest must contain a JSON object.")
    if dataset_manifest.get("schema_version") != "dime-dataset-manifest-v3":
        raise ValueError("Full training requires a dime-dataset-manifest-v3 foundation manifest.")
    if (
        dataset_manifest.get("visibility") != "private"
        or dataset_manifest.get("publication_classification") != "private-only"
    ):
        raise ValueError(
            "Full training requires a private, private-only foundation dataset release."
        )

    train_records = read_jsonl(train_path)
    validation_records = read_jsonl(validation_path)
    validate_dataset_manifest(
        dataset_manifest,
        file_sha256(train_path),
        file_sha256(validation_path),
        file_sha256(curriculum_path),
        file_sha256(tool_catalog_path),
        file_sha256(template_path),
        train_record_count=len(train_records),
        validation_record_count=len(validation_records),
    )
    return (
        train_records,
        validation_records,
        file_sha256(dataset_manifest_path),
        file_sha256(checksums_path),
    )


def parse_runtime_contract(runtime_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in runtime_path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key or not value:
            raise ValueError("Runtime contract contains an invalid assignment.")
        values[key] = value
    required = {"RUNPOD_IMAGE", "PYTHON", "PYTORCH", "CUDA_RUNTIME", "GPU"}
    if not required <= values.keys():
        raise ValueError("Runtime contract is missing required full-training identity fields.")
    return values


def validate_run_manifest(
    *,
    manifest_path: Path,
    schema_path: Path,
    config: dict[str, Any],
    config_path: Path,
    provenance: dict[str, Any],
    source_commit: str,
    foundation_dataset_manifest_sha256: str,
    foundation_checksums_sha256: str,
    contract_paths: dict[str, Path],
    requirements_path: Path,
    runtime_path: Path,
    platform_contract: dict[str, Any],
) -> dict[str, Any]:
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("A pre-existing, non-symlink run_manifest.json is required.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("Run manifest must contain a JSON object.")
    validate_json_document(manifest, schema_path, "Run manifest")

    expected_source = {
        "github_repository": GITHUB_REPOSITORY,
        "source_github_commit": source_commit,
    }
    expected_datasets = {
        "foundation_sft": {
            **provenance["datasets"]["foundation_sft"],
            "dataset_manifest_sha256": foundation_dataset_manifest_sha256,
            "checksums_sha256": foundation_checksums_sha256,
        },
        "development_eval": provenance["datasets"]["development_eval"],
        "locked_eval": provenance["datasets"]["locked_eval"],
    }
    if manifest["experiment_id"] != provenance["experiment_id"]:
        raise ValueError("Run manifest experiment identity does not match the training config.")
    if manifest["source"] != expected_source:
        raise ValueError("Run manifest source identity does not match the authorized source.")
    if manifest["datasets"] != expected_datasets:
        raise ValueError("Run manifest dataset identities do not match the authorized snapshots.")
    if manifest["base_model"] != {
        "repo_id": PINNED_MODEL_ID,
        "revision": PINNED_MODEL_REVISION,
    }:
        raise ValueError("Run manifest base-model identity does not match the pinned parent.")
    if manifest["starting_adapter"] is not None:
        raise ValueError("Dime v1 full training must start from the pinned base model.")

    expected_contract_hashes = {
        "training_config_sha256": file_sha256(config_path),
        "system_prompt_sha256": file_sha256(contract_paths["system_prompt"]),
        "chat_template_sha256": file_sha256(contract_paths["chat_template"]),
        "tool_catalog_sha256": file_sha256(contract_paths["tool_catalog"]),
        "dataset_schema_sha256": file_sha256(contract_paths["dataset_schema"]),
        "evaluation_schema_sha256": file_sha256(contract_paths["evaluation_schema"]),
        "decoding_config_sha256": file_sha256(contract_paths["decoding_config"]),
        "runtime_contract_sha256": file_sha256(runtime_path),
        "requirements_lock_sha256": file_sha256(requirements_path),
        "run_manifest_schema_sha256": file_sha256(contract_paths["run_manifest_schema"]),
        "foundation_checksums_schema_sha256": file_sha256(
            contract_paths["foundation_checksums_schema"]
        ),
    }
    if manifest["contracts"] != expected_contract_hashes:
        raise ValueError("Run manifest contract hashes do not match the local governed inputs.")

    experiment_id = provenance["experiment_id"]
    training = config["training"]
    expected_training = {
        "seed": int(config["run"]["seed"]),
        "output_dir": training["output_dir"],
        "final_adapter_dir": training["final_adapter_dir"],
        "logs_dir": f"/workspace/runs/{experiment_id}/logs",
        "reports_dir": f"/workspace/runs/{experiment_id}/reports",
        "checkpoint_retention": {
            "save_steps": int(training["save_steps"]),
            "save_total_limit": int(training["save_total_limit"]),
        },
    }
    if manifest["training"] != expected_training:
        raise ValueError(
            "Run manifest training paths or checkpoint policy do not match the config."
        )

    runtime = parse_runtime_contract(runtime_path)
    expected_environment = {
        "runpod_image": runtime["RUNPOD_IMAGE"],
        "python": runtime["PYTHON"],
        "pytorch": runtime["PYTORCH"],
        "cuda_runtime": runtime["CUDA_RUNTIME"],
        "gpu": runtime["GPU"],
    }
    if manifest["environment"] != expected_environment:
        raise ValueError("Run manifest environment does not match the runtime contract.")
    if platform_contract["runpod"]["container_image"] != expected_environment["runpod_image"]:
        raise ValueError("Run manifest runtime image does not match the platform contract.")
    return manifest


def assert_config(
    config: dict[str, Any],
    allow_full_run: bool,
) -> dict[str, Any] | None:
    model = config["model"]
    if model["id"] != PINNED_MODEL_ID or model["revision"] != PINNED_MODEL_REVISION:
        raise ValueError("Config does not match the frozen Dime parent ID and revision.")
    mode = config["run"]["mode"]
    if mode not in {"rehearsal", "full"}:
        raise ValueError("run.mode must be rehearsal or full.")
    if mode == "full" and not allow_full_run:
        raise ValueError("Full training requires an explicit --allow-full-run.")
    full_provenance = validate_full_training_config(config) if mode == "full" else None
    targets = set(config["lora"]["target_modules"])
    if targets != ALLOWED_TARGET_MODULES:
        raise ValueError(
            "LoRA targets must be the seven explicit Llama projection modules; "
            "do not wrap lm_head or embeddings."
        )
    if config["data"].get("reject_overlength") is not True:
        raise ValueError("Dime requires reject_overlength: true.")
    warmup_fraction = float(config["training"]["warmup_fraction"])
    if not 0 <= warmup_fraction <= 1:
        raise ValueError("training.warmup_fraction must be between 0 and 1.")
    return full_provenance


def seed_everything(seed: int) -> None:
    import torch

    random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def tokenize_records(
    records: list[dict[str, Any]],
    tokenizer: Any,
    tools: list[dict[str, Any]],
    max_length: int,
    minimum_assistant_tokens: int,
    production: bool,
) -> Dataset:
    from datasets import Dataset

    encoded_records = []
    for record in records:
        validate_sft_record(record, production=production)
        try:
            messages = attach_tool_catalog(record["messages"], tools)
            encoded = encode_assistant_only(tokenizer, messages, max_length)
        except ValueError as exc:
            raise ValueError(f"{record['example_id']}: {exc}") from exc
        supervised = sum(label != IGNORE_INDEX for label in encoded["labels"])
        if supervised < minimum_assistant_tokens:
            raise ValueError(
                f"{record['example_id']}: only {supervised} assistant target tokens; "
                f"minimum is {minimum_assistant_tokens}"
            )
        encoded_records.append(encoded)
    return Dataset.from_list(encoded_records)


def build_run_fingerprint(
    config_path: Path,
    train_path: Path,
    validation_path: Path,
    template_path: Path,
    tool_catalog_path: Path,
    requirements_path: Path,
    runtime_path: Path,
    dataset_manifest_path: Path | None,
    curriculum_path: Path | None,
    *,
    full_provenance: dict[str, Any] | None = None,
    system_prompt_path: Path | None = None,
    dataset_schema_path: Path | None = None,
    evaluation_schema_path: Path | None = None,
    decoding_config_path: Path | None = None,
    foundation_checksums_path: Path | None = None,
    run_manifest_path: Path | None = None,
    run_manifest_schema_path: Path | None = None,
    foundation_checksums_schema_path: Path | None = None,
) -> dict[str, Any]:
    fingerprint = {
        "parent_model_id": PINNED_MODEL_ID,
        "parent_model_revision": PINNED_MODEL_REVISION,
        "config_sha256": file_sha256(config_path),
        "train_data_sha256": file_sha256(train_path),
        "validation_data_sha256": file_sha256(validation_path),
        "chat_template_sha256": file_sha256(template_path),
        "tool_catalog_sha256": file_sha256(tool_catalog_path),
        "requirements_lock_sha256": file_sha256(requirements_path),
        "runtime_contract_sha256": file_sha256(runtime_path),
    }
    if dataset_manifest_path is not None:
        fingerprint["dataset_manifest_sha256"] = file_sha256(dataset_manifest_path)
    if curriculum_path is not None:
        fingerprint["curriculum_config_sha256"] = file_sha256(curriculum_path)
    if full_provenance is not None:
        required_contract_paths = {
            "system_prompt": system_prompt_path,
            "dataset_schema": dataset_schema_path,
            "evaluation_schema": evaluation_schema_path,
            "decoding_config": decoding_config_path,
            "dataset_manifest": dataset_manifest_path,
            "foundation_checksums": foundation_checksums_path,
            "run_manifest": run_manifest_path,
            "run_manifest_schema": run_manifest_schema_path,
            "foundation_checksums_schema": foundation_checksums_schema_path,
        }
        missing = sorted(name for name, path in required_contract_paths.items() if path is None)
        if missing:
            raise ValueError(
                "Full-run fingerprint is missing contract paths: " + ", ".join(missing)
            )
        fingerprint.update(full_provenance)
        fingerprint.update(
            {
                "system_prompt_sha256": file_sha256(required_contract_paths["system_prompt"]),
                "dataset_schema_sha256": file_sha256(required_contract_paths["dataset_schema"]),
                "evaluation_schema_sha256": file_sha256(
                    required_contract_paths["evaluation_schema"]
                ),
                "decoding_config_sha256": file_sha256(required_contract_paths["decoding_config"]),
                "run_manifest_schema_sha256": file_sha256(
                    required_contract_paths["run_manifest_schema"]
                ),
                "foundation_checksums_schema_sha256": file_sha256(
                    required_contract_paths["foundation_checksums_schema"]
                ),
                "foundation_dataset_manifest_sha256": file_sha256(
                    required_contract_paths["dataset_manifest"]
                ),
                "foundation_checksums_sha256": file_sha256(
                    required_contract_paths["foundation_checksums"]
                ),
                "run_manifest_sha256": file_sha256(required_contract_paths["run_manifest"]),
            }
        )
    return fingerprint


def establish_run_fingerprint(output_dir: Path, fingerprint: dict[str, Any]) -> None:
    fingerprint_path = output_dir / "run_fingerprint.json"
    if fingerprint_path.exists():
        existing = json.loads(fingerprint_path.read_text())
        if existing != fingerprint:
            raise SystemExit(
                "Existing output directory belongs to a different model, config, data, "
                "template, tool catalog, or runtime. Use a new run name."
            )
        return
    if any(output_dir.glob("checkpoint-*")):
        raise SystemExit(
            "Checkpoint exists without a run fingerprint; automatic resume is blocked."
        )
    fingerprint_path.write_text(json.dumps(fingerprint, indent=2, sort_keys=True) + "\n")


def validate_full_manifest_provenance(
    manifest: dict[str, Any],
    expected_provenance: dict[str, Any],
) -> None:
    for key in (
        "experiment_id",
        "authorization_status",
        "release_review_status",
        "source",
        "training_authorization",
        "datasets",
    ):
        if manifest.get(key) != expected_provenance[key]:
            raise ValueError(f"Full training manifest lost immutable provenance field: {key}")
    for key in FULL_MANIFEST_HASH_FIELDS:
        value = manifest.get(key)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError(f"Full training manifest is missing exact hash field: {key}")


def pin_adapter_config_revision(adapter_config_path: Path) -> None:
    adapter_config = json.loads(adapter_config_path.read_text(encoding="utf-8"))
    if adapter_config.get("base_model_name_or_path") != PINNED_MODEL_ID:
        raise ValueError("Saved adapter config has an unexpected parent model.")
    adapter_config["revision"] = PINNED_MODEL_REVISION
    adapter_config_path.write_text(
        json.dumps(adapter_config, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    cli = parse_args()
    project = Path(__file__).resolve().parents[1]
    config_path = cli.config if cli.config.is_absolute() else project / cli.config
    config = load_config(config_path)
    full_provenance = assert_config(config, cli.allow_full_run)
    data_config = config["data"]
    production = config["run"]["mode"] == "full"
    train_path = resolved(project, data_config["train"])
    validation_path = resolved(project, data_config["validation"])
    dataset_manifest_path = resolved(project, data_config["manifest"]) if production else None
    curriculum_path = resolved(project, data_config["curriculum"]) if production else None
    template_path = resolved(project, config["model"]["chat_template"])
    tool_catalog_path = resolved(project, config["model"]["tool_catalog"])
    requirements_path = project / "requirements.lock.txt"
    runtime_path = project / "configs/runtime.env"
    output_dir = resolved(project, config["training"]["output_dir"])
    final_adapter_dir = resolved(project, config["training"]["final_adapter_dir"])
    platform_contract_path = project / "configs/platform_contract.json"
    platform_contract: dict[str, Any] | None = None
    train_records: list[dict[str, Any]] | None = None
    validation_records: list[dict[str, Any]] | None = None
    system_prompt_path = None
    dataset_schema_path = None
    evaluation_schema_path = None
    decoding_config_path = None
    checksums_path = None
    dataset_card_path = None
    run_manifest_path = None
    run_manifest_schema_path = None
    foundation_checksums_schema_path = None
    if full_provenance is not None:
        if dataset_manifest_path is None or curriculum_path is None:
            raise AssertionError("Production manifest/curriculum paths were not resolved.")
        provenance_files = config["provenance"]["files"]
        contract_paths = {name: resolved(project, path) for name, path in provenance_files.items()}
        system_prompt_path = contract_paths["system_prompt"]
        dataset_schema_path = contract_paths["dataset_schema"]
        evaluation_schema_path = contract_paths["evaluation_schema"]
        decoding_config_path = contract_paths["decoding_config"]
        run_manifest_schema_path = contract_paths["run_manifest_schema"]
        foundation_checksums_schema_path = contract_paths["foundation_checksums_schema"]
        checksums_path = resolved(project, data_config["checksums"])
        dataset_card_path = resolved(project, data_config["dataset_card"])
        run_manifest_path = resolved(project, config["run"]["manifest"])
        (
            train_records,
            validation_records,
            foundation_dataset_manifest_sha256,
            foundation_checksums_sha256,
        ) = validate_foundation_snapshot(
            train_path=train_path,
            validation_path=validation_path,
            dataset_manifest_path=dataset_manifest_path,
            checksums_path=checksums_path,
            dataset_card_path=dataset_card_path,
            checksums_schema_path=foundation_checksums_schema_path,
            curriculum_path=curriculum_path,
            tool_catalog_path=tool_catalog_path,
            template_path=template_path,
        )
        if run_manifest_path.is_symlink() or not run_manifest_path.is_file():
            raise ValueError("A pre-existing, non-symlink run_manifest.json is required.")
        run_manifest_sha256 = file_sha256(run_manifest_path)
        platform_contract = json.loads(platform_contract_path.read_text(encoding="utf-8"))
        source_commit = validate_full_training_authorization(
            platform_contract,
            full_provenance,
            file_sha256(config_path),
            foundation_dataset_manifest_sha256,
            foundation_checksums_sha256,
            run_manifest_sha256,
        )
        authorization_commit = verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
        )
        full_provenance["source"]["github_commit"] = source_commit
        full_provenance["training_authorization"] = {
            "github_commit": authorization_commit,
        }
        validate_run_manifest(
            manifest_path=run_manifest_path,
            schema_path=run_manifest_schema_path,
            config=config,
            config_path=config_path,
            provenance=full_provenance,
            source_commit=source_commit,
            foundation_dataset_manifest_sha256=foundation_dataset_manifest_sha256,
            foundation_checksums_sha256=foundation_checksums_sha256,
            contract_paths=contract_paths,
            requirements_path=requirements_path,
            runtime_path=runtime_path,
            platform_contract=platform_contract,
        )

    import torch
    from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        GenerationConfig,
    )
    from transformers.trainer_utils import get_last_checkpoint
    from trl import SFTConfig, SFTTrainer

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable.")

    seed = int(config["run"]["seed"])
    seed_everything(seed)
    if cli.restart and output_dir.exists() and any(output_dir.iterdir()):
        raise SystemExit(
            f"--restart refuses to overwrite non-empty {output_dir}. "
            "Archive it or choose a new run name."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = build_run_fingerprint(
        config_path,
        train_path,
        validation_path,
        template_path,
        tool_catalog_path,
        requirements_path,
        runtime_path,
        dataset_manifest_path,
        curriculum_path,
        full_provenance=full_provenance,
        system_prompt_path=system_prompt_path,
        dataset_schema_path=dataset_schema_path,
        evaluation_schema_path=evaluation_schema_path,
        decoding_config_path=decoding_config_path,
        foundation_checksums_path=checksums_path,
        run_manifest_path=run_manifest_path,
        run_manifest_schema_path=run_manifest_schema_path,
        foundation_checksums_schema_path=foundation_checksums_schema_path,
    )
    if full_provenance is not None:
        if platform_contract is None:
            raise AssertionError("Full-training platform contract was not resolved.")
        fingerprint["training_platform_contract_sha256"] = file_sha256(platform_contract_path)
    establish_run_fingerprint(output_dir, fingerprint)

    if train_records is None:
        train_records = read_jsonl(train_path)
    if validation_records is None:
        validation_records = read_jsonl(validation_path)
    if production:
        if dataset_manifest_path is None or curriculum_path is None:
            raise AssertionError("Production manifest/curriculum paths were not resolved.")
        curriculum_config = yaml.safe_load(curriculum_path.read_text())
        for record in [*train_records, *validation_records]:
            validate_sft_record(record, production=True)
        curriculum_report = audit_curriculum(
            train_records,
            validation_records,
            curriculum_config,
        )
        (output_dir / "curriculum_audit.json").write_text(
            json.dumps(curriculum_report, indent=2, sort_keys=True) + "\n"
        )
        if not curriculum_report["pass"]:
            raise SystemExit(
                "Production curriculum audit failed:\n- "
                + "\n- ".join(curriculum_report["issues"][:20])
            )
    validate_unique_ids([*train_records, *validation_records], "example_id")
    train_keys = set().union(*(partition_keys(record) for record in train_records))
    validation_keys = set().union(*(partition_keys(record) for record in validation_records))
    leakage = train_keys & validation_keys
    if leakage:
        raise ValueError(f"Train/validation partition leakage: {sorted(leakage)}")
    tools = json.loads(tool_catalog_path.read_text())
    if not isinstance(tools, list) or not tools:
        raise ValueError("Tool catalog must be a non-empty array.")

    tokenizer = AutoTokenizer.from_pretrained(
        PINNED_MODEL_ID,
        revision=PINNED_MODEL_REVISION,
        token=token,
    )
    tokenizer.clean_up_tokenization_spaces = False
    tokenizer.padding_side = "right"
    tokenizer.chat_template = template_path.read_text()
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    max_length = int(data_config["max_length"])
    minimum_targets = int(data_config["minimum_assistant_tokens"])
    train_dataset = tokenize_records(
        train_records,
        tokenizer,
        tools,
        max_length,
        minimum_targets,
        production,
    )
    eval_dataset = tokenize_records(
        validation_records,
        tokenizer,
        tools,
        max_length,
        minimum_targets,
        production,
    )

    quantization = BitsAndBytesConfig(
        load_in_4bit=bool(config["quantization"]["load_in_4bit"]),
        bnb_4bit_quant_type=config["quantization"]["quant_type"],
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=bool(config["quantization"]["use_double_quant"]),
    )
    model = AutoModelForCausalLM.from_pretrained(
        PINNED_MODEL_ID,
        revision=PINNED_MODEL_REVISION,
        token=token,
        quantization_config=quantization,
        dtype=torch.bfloat16,
        device_map={"": 0},
        low_cpu_mem_usage=True,
        attn_implementation=config["model"]["attention_implementation"],
    )
    if not getattr(model, "is_loaded_in_4bit", False):
        raise RuntimeError("Parent model is not loaded in 4-bit.")
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=bool(config["training"]["gradient_checkpointing"]),
        gradient_checkpointing_kwargs={"use_reentrant": False},
    )

    lora = config["lora"]
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=int(lora["rank"]),
        lora_alpha=int(lora["alpha"]),
        lora_dropout=float(lora["dropout"]),
        bias=lora["bias"],
        target_modules=list(lora["target_modules"]),
    )
    model = get_peft_model(model, peft_config)
    trainable_names = [
        name for name, parameter in model.named_parameters() if parameter.requires_grad
    ]
    unexpected = [
        name
        for name in trainable_names
        if "lora_" not in name or "lm_head" in name or "embed_tokens" in name
    ]
    if unexpected:
        raise RuntimeError(f"Unexpected trainable parameters: {unexpected[:10]}")
    trainable_count = sum(
        parameter.numel() for parameter in model.parameters() if parameter.requires_grad
    )
    if not 40_000_000 <= trainable_count <= 44_000_000:
        raise RuntimeError(f"Unexpected LoRA trainable parameter count: {trainable_count:,}")
    model.print_trainable_parameters()

    training = config["training"]
    max_steps = int(training["max_steps"])
    epochs = float(training["epochs"])
    batch_size = int(training["per_device_train_batch_size"])
    accumulation = int(training["gradient_accumulation_steps"])
    if max_steps > 0:
        planned_steps = max_steps
    else:
        optimizer_steps_per_epoch = math.ceil(len(train_dataset) / (batch_size * accumulation))
        planned_steps = math.ceil(optimizer_steps_per_epoch * epochs)
    warmup_steps = math.ceil(planned_steps * float(training["warmup_fraction"]))
    training_args = SFTConfig(
        output_dir=str(output_dir),
        max_length=max_length,
        num_train_epochs=epochs,
        max_steps=max_steps,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=int(training["per_device_eval_batch_size"]),
        gradient_accumulation_steps=accumulation,
        learning_rate=float(training["learning_rate"]),
        weight_decay=float(training["weight_decay"]),
        warmup_steps=warmup_steps,
        lr_scheduler_type=training["scheduler"],
        logging_steps=int(training["logging_steps"]),
        eval_strategy="steps",
        eval_steps=int(training["eval_steps"]),
        save_strategy="steps",
        save_steps=int(training["save_steps"]),
        save_total_limit=int(training["save_total_limit"]),
        save_only_model=False,
        max_grad_norm=float(training["max_grad_norm"]),
        optim=training["optimizer"],
        gradient_checkpointing=bool(training["gradient_checkpointing"]),
        gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=bool(training["bf16"]),
        fp16=False,
        tf32=bool(training["tf32"]),
        packing=False,
        remove_unused_columns=False,
        dataset_kwargs={"skip_prepare_dataset": True},
        report_to=training["report_to"],
        seed=seed,
        data_seed=seed,
    )
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=AssistantOnlyCollator(tokenizer.pad_token_id),
        processing_class=tokenizer,
    )

    checkpoint = None if cli.restart else get_last_checkpoint(str(output_dir))
    result = trainer.train(resume_from_checkpoint=checkpoint)
    if not math.isfinite(result.training_loss):
        raise RuntimeError("Training loss is not finite.")

    if final_adapter_dir.exists():
        raise SystemExit(
            f"Final adapter directory already exists: {final_adapter_dir}. "
            "Use a new run name; stale artifacts will not be overwritten."
        )
    staging_dir = final_adapter_dir.with_name(f"{final_adapter_dir.name}.staging")
    if staging_dir.exists():
        raise SystemExit(f"Staging directory already exists: {staging_dir}")
    staging_dir.mkdir(parents=True)
    trainer.save_model(str(staging_dir))
    pin_adapter_config_revision(staging_dir / "adapter_config.json")
    tokenizer.save_pretrained(staging_dir)
    (staging_dir / "chat_template.jinja").write_text(template_path.read_text())
    eot_id = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    generation_config = GenerationConfig.from_model_config(model.config)
    generation_config.eos_token_id = [tokenizer.eos_token_id, eot_id]
    generation_config.pad_token_id = tokenizer.pad_token_id
    generation_config.save_pretrained(staging_dir)

    manifest = {
        "artifact_kind": "peft_adapter",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "run_name": config["run"]["name"],
        "run_mode": config["run"]["mode"],
        "parent_model_id": PINNED_MODEL_ID,
        "parent_model_revision": PINNED_MODEL_REVISION,
        **fingerprint,
        "train_records": len(train_dataset),
        "validation_records": len(eval_dataset),
        "seed": seed,
        "global_step": trainer.state.global_step,
        "training_loss": result.training_loss,
        "trainable_parameters": trainable_count,
        "quantization": "nf4-double",
        "compute_dtype": "bfloat16",
        "torch": torch.__version__,
        "cuda_runtime": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0),
        "python": sys.version,
        "platform": platform.platform(),
        "transformers": version("transformers"),
        "trl": version("trl"),
        "peft": version("peft"),
        "bitsandbytes": version("bitsandbytes"),
        "accelerate": version("accelerate"),
        ("datasets_package" if full_provenance is not None else "datasets"): version("datasets"),
        "huggingface_hub": version("huggingface_hub"),
        "tokenizers": version("tokenizers"),
        "safetensors": version("safetensors"),
        "generation_eos_token_ids": [tokenizer.eos_token_id, eot_id],
        "planned_optimizer_steps": planned_steps,
        "warmup_steps": warmup_steps,
    }
    if full_provenance is not None:
        validate_full_manifest_provenance(manifest, full_provenance)
    (staging_dir / "training_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    (staging_dir / "README.md").write_text((project / "docs/MODEL_CARD_TEMPLATE.md").read_text())
    os.replace(staging_dir, final_adapter_dir)
    print(f"Final adapter: {final_adapter_dir}")
    print("QLORA TRAINING COMPLETED")


if __name__ == "__main__":
    main()
