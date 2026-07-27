#!/usr/bin/env python
"""Guarded single-GPU QLoRA SFT for the pinned Dime parent model."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import math
import os
import platform
import random
import re
import shutil
import stat
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
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
    attach_canonical_system,
    attach_tool_catalog,
    encode_assistant_only,
)
from dime_ai.data_validation import (
    partition_keys,
    read_jsonl,
    strict_json_loads,
    validate_dataset_manifest,
    validate_sft_record,
    validate_unique_ids,
)
from dime_ai.program_audit import audit_curriculum

PINNED_MODEL_ID = "meta-llama/Llama-3.1-8B"
PINNED_MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"
GITHUB_REPOSITORY = "aisportsbettingcontact/ai-sports-betting-dime-ai"
CANONICAL_GITHUB_ORIGIN_URL = (
    "https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai.git"
)
FOUNDATION_DATASET_REPOSITORY = "taileredsports/dime-foundation-sft"
DEVELOPMENT_EVAL_REPOSITORY = "taileredsports/dime-eval-development"
LOCKED_EVAL_REPOSITORY = "taileredsports/dime-eval-locked"
PROMOTED_ADAPTER_REPOSITORY = "taileredsports/Llama-3-Dime-1.0"
TRAINING_HF_TOKEN_NAME = "dime-training-read-v1"
TRAINING_HF_TOKEN_ROLE = "fineGrained"
FOUNDATION_RELEASE_DIRECTORY = "foundation-v1"
FOUNDATION_ROOT_DATASET_CARD = "README.md"
FOUNDATION_RELEASE_FILES = frozenset(
    {
        f"{FOUNDATION_RELEASE_DIRECTORY}/train.jsonl",
        f"{FOUNDATION_RELEASE_DIRECTORY}/validation.jsonl",
        f"{FOUNDATION_RELEASE_DIRECTORY}/dataset_manifest.json",
        f"{FOUNDATION_RELEASE_DIRECTORY}/checksums.json",
        f"{FOUNDATION_RELEASE_DIRECTORY}/dataset_card.md",
    }
)
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
FOUNDATION_EVIDENCE_HASH_FIELDS = {
    "system_prompt_sha256",
    "foundation_build_config_sha256",
    "source_registry_sha256",
    "source_artifacts_sha256",
    "reviewer_registry_sha256",
    "review_ledger_sha256",
    "candidate_audit_sha256",
    "approval_record_sha256",
}
FOUNDATION_AUDIT_REPORT_TYPES = {
    "semantic_deduplication",
    "privacy_and_identifiers",
    "rights",
    "development_evaluation_contamination",
    "locked_evaluation_contamination",
    "numeric_traceability",
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


@dataclass(frozen=True)
class BoundFile:
    """One regular, non-symlink file captured for a single authorized run."""

    path: Path
    data: bytes
    sha256: str
    identity: tuple[int, int, int, int]


@dataclass(frozen=True)
class FoundationRemoteSnapshot:
    """Exact private Foundation release resolved and downloaded from Hugging Face."""

    repo_id: str
    resolved_revision: str
    private: bool
    inventory: frozenset[str]
    files: dict[str, bytes]


def absolute_without_resolution(path: Path) -> Path:
    """Normalize a path without following symbolic links."""

    return Path(os.path.abspath(os.fspath(path)))


def require_no_symlink_components(
    path: Path,
    label: str,
    *,
    require_file: bool = False,
    require_directory: bool = False,
    allow_missing_leaf: bool = False,
) -> Path:
    """Reject a symbolic link in the target or any existing ancestor."""

    absolute = absolute_without_resolution(path)
    current = Path(absolute.anchor)
    parts = absolute.parts[1:] if absolute.anchor else absolute.parts
    for index, part in enumerate(parts):
        current /= part
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            if allow_missing_leaf and index == len(parts) - 1:
                return absolute
            raise ValueError(f"{label} is missing: {absolute}") from None
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError(f"{label} contains a symbolic-link component: {current}")
    if require_file and not absolute.is_file():
        raise ValueError(f"{label} must be a regular file: {absolute}")
    if require_directory and not absolute.is_dir():
        raise ValueError(f"{label} must be a directory: {absolute}")
    return absolute


def read_bound_file(path: Path, label: str = "governed input") -> BoundFile:
    """Read one stable file descriptor and bind its bytes and filesystem identity."""

    absolute = require_no_symlink_components(path, label, require_file=True)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(absolute, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"{label} must be a regular file: {absolute}")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    before_identity = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    )
    after_identity = (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    )
    if before_identity != after_identity:
        raise ValueError(f"{label} changed while it was being read: {absolute}")
    data = b"".join(chunks)
    if len(data) != after.st_size:
        raise ValueError(f"{label} size changed while it was being read: {absolute}")
    return BoundFile(
        path=absolute,
        data=data,
        sha256=hashlib.sha256(data).hexdigest(),
        identity=after_identity,
    )


def assert_bound_file_unchanged(bound: BoundFile, label: str = "governed input") -> None:
    current = read_bound_file(bound.path, label)
    if current.identity != bound.identity or current.sha256 != bound.sha256:
        raise ValueError(f"{label} changed after authorization: {bound.path}")


def capture_bound_files(
    paths: list[Path],
    label: str = "governed input",
) -> dict[Path, BoundFile]:
    captured: dict[Path, BoundFile] = {}
    for path in paths:
        bound = read_bound_file(path, label)
        captured.setdefault(bound.path, bound)
    return captured


def assert_bound_files_unchanged(
    captured: dict[Path, BoundFile],
    label: str = "governed input",
) -> None:
    for bound in captured.values():
        assert_bound_file_unchanged(bound, label)


def bound_file(
    path: Path,
    captured: dict[Path, BoundFile] | None,
    label: str,
) -> BoundFile:
    absolute = absolute_without_resolution(path)
    if captured is not None and absolute in captured:
        return captured[absolute]
    return read_bound_file(absolute, label)


def parse_jsonl_bytes(data: bytes, label: str) -> list[dict[str, Any]]:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"{label} is not valid UTF-8.") from error
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        record = strict_json_loads(line, f"{label}:{line_number}")
        if not isinstance(record, dict):
            raise ValueError(f"{label}:{line_number}: each line must be an object")
        records.append(record)
    return records


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
    return read_bound_file(path, "hash input").sha256


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


def canonical_git_checkout(project: Path) -> tuple[Path, str]:
    """Resolve the canonical project path without trusting a local branch reference."""

    repository_root = Path(git_output(project, "rev-parse", "--show-toplevel")).resolve()
    try:
        project_relative = project.resolve().relative_to(repository_root).as_posix()
    except ValueError as error:
        raise ValueError("Full training must run inside the canonical repository.") from error
    if project_relative != CANONICAL_PROJECT_PATH:
        raise ValueError("Full training must run from the canonical ml/dime-1.0 checkout.")
    return repository_root, project_relative


def git_blob_bytes(repository_root: Path, commit: str, repository_path: str) -> bytes:
    """Read exact committed bytes, failing closed when the path is absent."""

    try:
        return subprocess.run(
            [
                "git",
                "-C",
                str(repository_root),
                "show",
                f"{commit}:{repository_path}",
            ],
            check=True,
            capture_output=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError(
            f"Cannot read governed Git object {repository_path} at {commit}."
        ) from error


def verify_live_origin_authorization(
    project: Path,
    authorization_commit: str,
    *,
    expected_origin_url: str = CANONICAL_GITHUB_ORIGIN_URL,
) -> str:
    """Bind authorization to the contract currently published on live origin/main."""

    authorization_commit = require_full_sha(
        authorization_commit,
        "authorization Git commit",
    )
    repository_root, project_relative = canonical_git_checkout(project)
    origin_url = git_output(repository_root, "remote", "get-url", "origin")
    if origin_url != expected_origin_url:
        raise ValueError(
            f"Full training requires the canonical GitHub origin URL: {expected_origin_url}"
        )
    try:
        remote_main_output = subprocess.run(
            [
                "git",
                "-C",
                str(repository_root),
                "ls-remote",
                "--exit-code",
                "origin",
                "refs/heads/main",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        fields = remote_main_output.split()
        if len(fields) != 2 or fields[1] != "refs/heads/main":
            raise ValueError("Cannot resolve the live origin/main identity.")
        remote_main_commit = require_full_sha(fields[0], "live origin/main Git commit")
        subprocess.run(
            [
                "git",
                "-C",
                str(repository_root),
                "fetch",
                "--quiet",
                "--no-tags",
                "origin",
                "refs/heads/main",
            ],
            check=True,
            capture_output=True,
        )
        fetched_main_commit = require_full_sha(
            git_output(repository_root, "rev-parse", "FETCH_HEAD"),
            "fetched origin/main Git commit",
        )
        if fetched_main_commit != remote_main_commit:
            raise ValueError("Fetched origin/main changed after its live identity check.")
        subprocess.run(
            [
                "git",
                "-C",
                str(repository_root),
                "merge-base",
                "--is-ancestor",
                authorization_commit,
                remote_main_commit,
            ],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as error:
        raise ValueError(
            "The authorization HEAD must be reachable from the verified live origin/main."
        ) from error
    except (OSError, ValueError) as error:
        raise ValueError("Cannot verify the live origin/main authorization state.") from error

    canonical_contract = f"{project_relative}/{CANONICAL_PLATFORM_CONTRACT}"
    authorization_contract = git_blob_bytes(
        repository_root,
        authorization_commit,
        canonical_contract,
    )
    live_contract = git_blob_bytes(
        repository_root,
        remote_main_commit,
        canonical_contract,
    )
    if live_contract != authorization_contract:
        raise ValueError(
            "Live origin/main no longer carries this exact full-training authorization."
        )
    return remote_main_commit


def verify_reviewed_authorization_checkout(
    project: Path,
    source_commit: str,
    config_path: Path,
    *,
    expected_origin_url: str = CANONICAL_GITHUB_ORIGIN_URL,
) -> str:
    """Verify a clean, remotely published authorization HEAD over a source commit."""
    source_commit = require_full_sha(source_commit, "source_github_commit")
    try:
        repository_root, project_relative = canonical_git_checkout(project)
        config_relative = config_path.resolve().relative_to(repository_root).as_posix()
        authorization_commit = require_full_sha(
            git_output(project, "rev-parse", "HEAD"),
            "authorization Git commit",
        )
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        raise ValueError("Cannot verify the full-training Git authorization chain.") from error
    verify_live_origin_authorization(
        project,
        authorization_commit,
        expected_origin_url=expected_origin_url,
    )
    try:
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


def verify_authorization_checkout_still_current(
    project: Path,
    authorization_commit: str,
    *,
    expected_origin_url: str = CANONICAL_GITHUB_ORIGIN_URL,
) -> None:
    """Recheck local state and live revocation state at an execution boundary."""

    authorization_commit = require_full_sha(
        authorization_commit,
        "authorization Git commit",
    )
    if git_output(project, "rev-parse", "HEAD") != authorization_commit:
        raise ValueError("Authorization Git HEAD changed before Trainer start.")
    status = git_output(project, "status", "--porcelain", "--untracked-files=all")
    if status:
        raise ValueError("Git worktree changed after full-training authorization.")
    verify_live_origin_authorization(
        project,
        authorization_commit,
        expected_origin_url=expected_origin_url,
    )


HFAccessProbe = Callable[
    [str, str, str | None, str],
    tuple[bool, str | None],
]
HFWriteProbe = Callable[[str, str, str], bool]
HFIdentityProbe = Callable[[str], dict[str, Any]]
FoundationSnapshotProbe = Callable[[str, str, str], FoundationRemoteSnapshot]


def probe_hf_repository_access(
    repo_id: str,
    repo_type: str,
    revision: str | None,
    token: str,
) -> tuple[bool, str | None]:
    """Return effective repository access and its resolved immutable revision."""
    from huggingface_hub import HfApi

    try:
        info = HfApi().repo_info(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=revision,
            token=token,
            files_metadata=False,
        )
    except Exception as error:  # noqa: BLE001 - normalize Hub transport failures
        status_code = getattr(getattr(error, "response", None), "status_code", None)
        if status_code in {401, 403, 404}:
            return False, None
        raise ValueError(f"Cannot verify effective Hugging Face access for {repo_id}.") from error
    returned_repo_id = getattr(info, "id", None)
    if (
        not isinstance(returned_repo_id, str)
        or not returned_repo_id.strip()
        or returned_repo_id != repo_id
    ):
        raise ValueError(f"Hugging Face returned the wrong repository identity for {repo_id}.")
    resolved_revision = getattr(info, "sha", None)
    if not isinstance(resolved_revision, str) or not FULL_SHA.fullmatch(resolved_revision):
        raise ValueError(f"Hugging Face returned no immutable revision identity for {repo_id}.")
    return True, resolved_revision


def probe_hf_repository_write_access(
    repo_id: str,
    repo_type: str,
    token: str,
) -> bool:
    """Return whether the explicit token can write, without mutating the repository."""

    from huggingface_hub import HfApi

    try:
        result = HfApi(token=token).auth_check(
            repo_id=repo_id,
            repo_type=repo_type,
            token=token,
            write=True,
        )
    except Exception as error:  # noqa: BLE001 - normalize Hub authorization failures
        status_code = getattr(getattr(error, "response", None), "status_code", None)
        if status_code in {401, 403, 404}:
            return False
        raise ValueError(f"Cannot verify Hugging Face write denial for {repo_id}.") from error
    if result is not None:
        raise ValueError(f"Hugging Face returned an ambiguous write check for {repo_id}.")
    return True


def probe_hf_token_identity(token: str) -> dict[str, Any]:
    """Read the authenticated token identity from the Hub without persisting it."""

    from huggingface_hub import HfApi

    try:
        response = HfApi(token=token).whoami(token=token, cache=False)
    except Exception as error:  # noqa: BLE001 - normalize Hub transport failures
        raise ValueError("Cannot verify the Hugging Face training-token identity.") from error
    if not isinstance(response, dict):
        raise ValueError("Hugging Face returned an invalid token-identity response.")
    return response


def verify_hf_training_token_identity(
    token: str,
    *,
    probe: HFIdentityProbe = probe_hf_token_identity,
) -> None:
    """Fail closed unless the runtime token is the named fine-grained training token."""

    if not isinstance(token, str) or not token.strip():
        raise ValueError("HF_TOKEN is required for the full-training identity preflight.")
    identity = probe(token)
    if not isinstance(identity, dict):
        raise ValueError("Hugging Face returned an invalid token-identity response.")
    auth = identity.get("auth")
    if not isinstance(auth, dict) or auth.get("type") != "access_token":
        raise ValueError("HF_TOKEN must authenticate as an access_token.")
    access_token = auth.get("accessToken")
    if not isinstance(access_token, dict):
        raise ValueError("Hugging Face did not return an accessToken identity.")
    if access_token.get("displayName") != TRAINING_HF_TOKEN_NAME:
        raise ValueError(
            f"HF_TOKEN must be the named training credential {TRAINING_HF_TOKEN_NAME}."
        )
    if access_token.get("role") != TRAINING_HF_TOKEN_ROLE:
        raise ValueError(
            f"HF_TOKEN must have the exact fine-grained role {TRAINING_HF_TOKEN_ROLE}."
        )


def authorized_promoted_adapter_revision(contract: dict[str, Any]) -> str:
    """Select the exact adapter revision authorized by the platform lifecycle state."""

    hugging_face = require_mapping(contract.get("hugging_face"), "hugging_face")
    repositories = require_mapping(
        hugging_face.get("repositories"),
        "hugging_face.repositories",
    )
    adapter = require_mapping(
        repositories.get("promoted_adapter"),
        "hugging_face.repositories.promoted_adapter",
    )
    if adapter.get("repo_type") != "model" or adapter.get("repo_id") != PROMOTED_ADAPTER_REPOSITORY:
        raise ValueError("Platform contract has the wrong promoted-adapter repository identity.")
    state = adapter.get("current_state")
    if state == "approved_release":
        return require_full_sha(
            adapter.get("approved_release_revision"),
            "promoted-adapter approved release revision",
        )
    if state == "governance_scaffold_only":
        if adapter.get("approved_release_revision") is not None:
            raise ValueError(
                "A scaffold-only promoted-adapter repository cannot name an approved release."
            )
        return require_full_sha(
            adapter.get("current_governance_head"),
            "promoted-adapter governance head",
        )
    raise ValueError("Platform contract has an unsupported promoted-adapter release state.")


def verify_hf_effective_permissions(
    provenance: dict[str, Any],
    token: str,
    *,
    platform_contract: dict[str, Any],
    probe: HFAccessProbe = probe_hf_repository_access,
    write_probe: HFWriteProbe = probe_hf_repository_write_access,
) -> dict[str, str]:
    """Prove exact reads, dataset write denial, and locked-evaluation denial."""
    if not isinstance(token, str) or not token.strip():
        raise ValueError("HF_TOKEN is required for the full-training access preflight.")
    datasets = require_mapping(provenance.get("datasets"), "full provenance datasets")
    foundation = require_mapping(datasets.get("foundation_sft"), "foundation_sft")
    development = require_mapping(datasets.get("development_eval"), "development_eval")
    locked = require_mapping(datasets.get("locked_eval"), "locked_eval")
    promoted_adapter_revision = authorized_promoted_adapter_revision(platform_contract)
    positive_checks = (
        (
            foundation.get("repo_id"),
            "dataset",
            require_full_sha(foundation.get("revision"), "foundation revision"),
        ),
        (
            development.get("repo_id"),
            "dataset",
            require_full_sha(development.get("revision"), "development revision"),
        ),
        (PINNED_MODEL_ID, "model", PINNED_MODEL_REVISION),
        (PROMOTED_ADAPTER_REPOSITORY, "model", promoted_adapter_revision),
    )
    verified: dict[str, str] = {}
    for repo_id, repo_type, revision in positive_checks:
        if not isinstance(repo_id, str):
            raise ValueError("Full-training Hugging Face repository identity is invalid.")
        accessible, resolved_revision = probe(repo_id, repo_type, revision, token)
        if not accessible:
            raise ValueError(
                f"Training token cannot read required {repo_type} repository {repo_id}."
            )
        if resolved_revision != revision:
            raise ValueError(
                f"Training token resolved {repo_id} to {resolved_revision}, "
                f"not the authorized revision {revision}."
            )
        verified[repo_id] = revision

    write_denials = (
        (FOUNDATION_DATASET_REPOSITORY, "dataset"),
        (DEVELOPMENT_EVAL_REPOSITORY, "dataset"),
        (PROMOTED_ADAPTER_REPOSITORY, "model"),
    )
    for repository, repo_type in write_denials:
        if write_probe(repository, repo_type, token):
            raise ValueError(
                f"Training token has forbidden write access to {repo_type} repository {repository}."
            )

    locked_repo_id = locked.get("repo_id")
    if locked_repo_id != LOCKED_EVAL_REPOSITORY:
        raise ValueError("Full provenance has the wrong locked-evaluation repository.")
    locked_accessible, _ = probe(locked_repo_id, "dataset", None, token)
    if locked_accessible:
        raise ValueError(
            "Training token can access the locked-evaluation repository; "
            "full training is forbidden."
        )
    return verified


def fetch_foundation_hf_snapshot(
    repo_id: str,
    revision: str,
    token: str,
) -> FoundationRemoteSnapshot:
    """Resolve and download the exact Foundation release with an explicit token."""

    from huggingface_hub import HfApi, hf_hub_download

    try:
        api = HfApi(token=token)
        info = api.repo_info(
            repo_id=repo_id,
            repo_type="dataset",
            revision=revision,
            token=token,
            files_metadata=False,
        )
    except Exception as error:  # noqa: BLE001 - normalize Hub transport failures
        raise ValueError("Cannot resolve the authorized private Foundation release.") from error

    returned_repo_id = getattr(info, "id", None)
    if (
        not isinstance(returned_repo_id, str)
        or not returned_repo_id.strip()
        or returned_repo_id != repo_id
    ):
        raise ValueError("Hugging Face returned the wrong Foundation repository identity.")

    try:
        inventory = frozenset(
            api.list_repo_files(
                repo_id=repo_id,
                repo_type="dataset",
                revision=revision,
                token=token,
            )
        )
        files = {
            path: Path(
                hf_hub_download(
                    repo_id=repo_id,
                    filename=path,
                    repo_type="dataset",
                    revision=revision,
                    token=token,
                    force_download=True,
                    local_files_only=False,
                )
            ).read_bytes()
            for path in FOUNDATION_RELEASE_FILES
        }
    except Exception as error:  # noqa: BLE001 - normalize Hub transport/filesystem failures
        raise ValueError("Cannot download the authorized private Foundation release.") from error

    resolved_revision = getattr(info, "sha", None)
    if not isinstance(resolved_revision, str):
        raise ValueError("Hugging Face returned no Foundation revision identity.")
    return FoundationRemoteSnapshot(
        repo_id=returned_repo_id,
        resolved_revision=resolved_revision,
        private=getattr(info, "private", None) is True,
        inventory=inventory,
        files=files,
    )


def verify_foundation_hf_snapshot(
    *,
    revision: str,
    token: str,
    train_path: Path,
    validation_path: Path,
    dataset_manifest_path: Path,
    checksums_path: Path,
    dataset_card_path: Path,
    captured_files: dict[Path, BoundFile] | None = None,
    fetch: FoundationSnapshotProbe = fetch_foundation_hf_snapshot,
) -> None:
    """Prove private remote bytes exactly equal the authorized local training snapshot."""

    revision = require_full_sha(revision, "authorized Foundation revision")
    if not isinstance(token, str) or not token.strip():
        raise ValueError("HF_TOKEN is required to verify the private Foundation release.")
    snapshot = fetch(FOUNDATION_DATASET_REPOSITORY, revision, token)
    if snapshot.repo_id != FOUNDATION_DATASET_REPOSITORY:
        raise ValueError("Hugging Face returned the wrong Foundation repository identity.")
    if snapshot.resolved_revision != revision:
        raise ValueError("Hugging Face did not resolve the exact authorized Foundation revision.")
    if snapshot.private is not True:
        raise ValueError("The authorized Foundation Hugging Face repository must be private.")
    if FOUNDATION_ROOT_DATASET_CARD not in snapshot.inventory:
        raise ValueError("The private Foundation repository must contain a root README.md.")

    release_inventory = frozenset(
        path for path in snapshot.inventory if path.startswith(f"{FOUNDATION_RELEASE_DIRECTORY}/")
    )
    if release_inventory != FOUNDATION_RELEASE_FILES:
        raise ValueError(
            "Remote Foundation release inventory mismatch: "
            f"expected {sorted(FOUNDATION_RELEASE_FILES)}, "
            f"got {sorted(release_inventory)}"
        )
    if frozenset(snapshot.files) != FOUNDATION_RELEASE_FILES:
        raise ValueError("Remote Foundation download did not return the exact release inventory.")

    local_paths = {
        f"{FOUNDATION_RELEASE_DIRECTORY}/train.jsonl": train_path,
        f"{FOUNDATION_RELEASE_DIRECTORY}/validation.jsonl": validation_path,
        f"{FOUNDATION_RELEASE_DIRECTORY}/dataset_manifest.json": dataset_manifest_path,
        f"{FOUNDATION_RELEASE_DIRECTORY}/checksums.json": checksums_path,
        f"{FOUNDATION_RELEASE_DIRECTORY}/dataset_card.md": dataset_card_path,
    }
    for remote_path, local_path in local_paths.items():
        local = bound_file(local_path, captured_files, f"local {remote_path}")
        if snapshot.files[remote_path] != local.data:
            raise ValueError(
                f"Authorized private Foundation bytes differ from local snapshot: {remote_path}"
            )


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


def parse_utc_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError(f"{label} must be a normalized UTC timestamp ending in Z.")
    try:
        parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise ValueError(f"{label} is not a valid UTC timestamp.") from error
    if parsed.utcoffset() != datetime.min.replace(tzinfo=UTC).utcoffset():
        raise ValueError(f"{label} must use UTC.")
    return parsed


def require_current_foundation_evidence(
    manifest: dict[str, Any],
    *,
    now: datetime | None = None,
) -> datetime:
    """Require an already-approved evidence window that remains open."""

    reference = now or datetime.now(UTC)
    approved_at = parse_utc_timestamp(manifest.get("approved_at_utc"), "approved_at_utc")
    valid_until = parse_utc_timestamp(
        manifest.get("evidence_valid_until_utc"),
        "evidence_valid_until_utc",
    )
    if valid_until <= approved_at:
        raise ValueError("Foundation evidence expiry must follow dataset approval.")
    if reference < approved_at:
        raise ValueError("Foundation dataset approval is in the future.")
    if reference >= valid_until:
        raise ValueError("Foundation evidence has expired; full training is forbidden.")
    return valid_until


def verify_full_training_execution_state(
    *,
    project: Path,
    governed_files: dict[Path, BoundFile] | None,
    foundation_manifest: dict[str, Any] | None,
    authorization_commit: str | None,
    clock: Callable[[], datetime] | None = None,
) -> None:
    """Recheck immutable inputs, evidence validity, and live Git authorization."""

    if governed_files is None or foundation_manifest is None or authorization_commit is None:
        raise AssertionError("Full-training authorization state is incomplete.")
    assert_bound_files_unchanged(
        governed_files,
        "full-training governed input",
    )
    require_current_foundation_evidence(
        foundation_manifest,
        now=clock() if clock is not None else None,
    )
    verify_authorization_checkout_still_current(project, authorization_commit)


def train_with_execution_fences(
    trainer: Any,
    checkpoint: str | None,
    *,
    production: bool,
    project: Path,
    governed_files: dict[Path, BoundFile] | None,
    foundation_manifest: dict[str, Any] | None,
    authorization_commit: str | None,
    clock: Callable[[], datetime] | None = None,
) -> Any:
    """Fence both sides of training before any full-run artifact can be promoted."""

    if not production:
        return trainer.train(resume_from_checkpoint=checkpoint)
    verify_full_training_execution_state(
        project=project,
        governed_files=governed_files,
        foundation_manifest=foundation_manifest,
        authorization_commit=authorization_commit,
        clock=clock,
    )
    result = trainer.train(resume_from_checkpoint=checkpoint)
    verify_full_training_execution_state(
        project=project,
        governed_files=governed_files,
        foundation_manifest=foundation_manifest,
        authorization_commit=authorization_commit,
        clock=clock,
    )
    return result


def validate_foundation_evidence_hashes(
    value: Any,
    label: str = "foundation_evidence_hashes",
) -> dict[str, Any]:
    evidence = require_mapping(value, label)
    expected_keys = FOUNDATION_EVIDENCE_HASH_FIELDS | {"audit_reports"}
    if set(evidence) != expected_keys:
        raise ValueError(f"{label} must contain exactly the governed Foundation v1 evidence keys.")
    for field in FOUNDATION_EVIDENCE_HASH_FIELDS:
        digest = evidence.get(field)
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"{label}.{field} must be a lowercase SHA-256.")
    audit_reports = require_mapping(evidence.get("audit_reports"), f"{label}.audit_reports")
    if set(audit_reports) != FOUNDATION_AUDIT_REPORT_TYPES:
        raise ValueError(f"{label}.audit_reports has an invalid inventory.")
    for audit_type, digest in audit_reports.items():
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"{label}.audit_reports.{audit_type} must be a lowercase SHA-256.")
    return evidence


def manifest_foundation_evidence_hashes(manifest: dict[str, Any]) -> dict[str, Any]:
    return {field: manifest[field] for field in sorted(FOUNDATION_EVIDENCE_HASH_FIELDS)} | {
        "audit_reports": {
            audit_type: manifest["audit_reports"][audit_type]["report_sha256"]
            for audit_type in sorted(FOUNDATION_AUDIT_REPORT_TYPES)
        }
    }


def authorized_foundation_evidence_hashes(contract: dict[str, Any]) -> dict[str, Any]:
    if contract.get("status") != "training_authorized":
        raise ValueError("Platform status does not authorize full training.")
    authorization = require_mapping(
        contract.get("authorization"),
        "authorization",
    )
    if authorization.get("full_training") is not True:
        raise ValueError("Platform contract explicitly blocks full training.")
    candidate = require_mapping(
        authorization.get("training_candidate"),
        "authorization.training_candidate",
    )
    return validate_foundation_evidence_hashes(
        candidate.get("foundation_evidence_hashes"),
        "authorization.training_candidate.foundation_evidence_hashes",
    )


def authorized_training_evaluation_references(
    contract: dict[str, Any],
    provenance: dict[str, Any],
) -> tuple[str, str]:
    if contract.get("status") != "training_authorized":
        raise ValueError("Platform status does not authorize full training.")
    authorization = require_mapping(
        contract.get("authorization"),
        "authorization",
    )
    if authorization.get("full_training") is not True:
        raise ValueError("Platform contract explicitly blocks full training.")
    candidate = require_mapping(
        authorization.get("training_candidate"),
        "authorization.training_candidate",
    )
    development_revision = require_full_sha(
        candidate.get("development_eval_revision"),
        "authorization.training_candidate.development_eval_revision",
    )
    locked_reference = validate_locked_eval_reference(candidate.get("locked_eval_reference"))
    if development_revision != provenance["datasets"]["development_eval"]["revision"]:
        raise ValueError(
            "Platform training authorization development-evaluation revision "
            "does not match full provenance."
        )
    if locked_reference != provenance["datasets"]["locked_eval"]["revision_or_opaque_reference"]:
        raise ValueError(
            "Platform training authorization locked-evaluation reference "
            "does not match full provenance."
        )
    return development_revision, locked_reference


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
    foundation_evidence_hashes: dict[str, Any],
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
    hugging_face = require_mapping(contract.get("hugging_face"), "hugging_face")
    repositories = require_mapping(
        hugging_face.get("repositories"),
        "hugging_face.repositories",
    )
    required_releases = (
        (
            "foundation_sft",
            FOUNDATION_DATASET_REPOSITORY,
            provenance["datasets"]["foundation_sft"]["revision"],
        ),
        (
            "development_eval",
            DEVELOPMENT_EVAL_REPOSITORY,
            provenance["datasets"]["development_eval"]["revision"],
        ),
    )
    for release_name, expected_repo_id, authorized_revision in required_releases:
        release = require_mapping(
            repositories.get(release_name),
            f"hugging_face.repositories.{release_name}",
        )
        if release.get("repo_type") != "dataset" or release.get("repo_id") != expected_repo_id:
            raise ValueError(f"Platform contract has the wrong {release_name} repository identity.")
        if release.get("current_state") != "approved_release":
            raise ValueError(f"Platform contract {release_name} must be in approved_release state.")
        if release.get("approved_release_revision") != authorized_revision:
            raise ValueError(
                f"Platform contract {release_name} approved-release revision "
                "does not match the authorized candidate."
            )
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
        "foundation_evidence_hashes": validate_foundation_evidence_hashes(
            foundation_evidence_hashes
        ),
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
    root = require_no_symlink_components(
        root,
        "foundation snapshot root",
        require_directory=True,
    )
    path = require_no_symlink_components(path, label, require_file=True)
    if path.parent != root:
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
    foundation_build_config_path: Path,
    reviewer_registry_path: Path,
    system_prompt_path: Path,
    tool_catalog_path: Path,
    template_path: Path,
    authorized_evidence_hashes: dict[str, Any],
    authorized_development_eval_revision: str,
    authorized_locked_eval_reference: str,
    captured_files: dict[Path, BoundFile] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str]:
    authorized_evidence = validate_foundation_evidence_hashes(
        authorized_evidence_hashes,
        "authorized foundation evidence",
    )
    authorized_development_eval_revision = require_full_sha(
        authorized_development_eval_revision,
        "authorized_development_eval_revision",
    )
    authorized_locked_eval_reference = validate_locked_eval_reference(
        authorized_locked_eval_reference
    )
    snapshot_root = dataset_manifest_path.parent
    snapshot_files = {
        "train.jsonl": train_path,
        "validation.jsonl": validation_path,
        "dataset_manifest.json": dataset_manifest_path,
        "checksums.json": checksums_path,
        "dataset_card.md": dataset_card_path,
    }
    actual_inventory = {path.name for path in snapshot_root.iterdir()}
    expected_inventory = set(snapshot_files)
    if actual_inventory != expected_inventory:
        raise ValueError(
            "Foundation snapshot inventory mismatch: "
            f"expected {sorted(expected_inventory)}, got {sorted(actual_inventory)}"
        )
    for name, path in snapshot_files.items():
        require_snapshot_file(path, snapshot_root, name)

    bound_snapshot = {
        name: bound_file(path, captured_files, name) for name, path in snapshot_files.items()
    }
    checksums = strict_json_loads(
        bound_snapshot["checksums.json"].data.decode("utf-8"),
        str(checksums_path),
    )
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
        actual = bound_snapshot[name].sha256
        if expected_hashes[name] != actual:
            raise ValueError(f"Foundation snapshot checksum mismatch: {name}")

    dataset_manifest = strict_json_loads(
        bound_snapshot["dataset_manifest.json"].data.decode("utf-8"),
        str(dataset_manifest_path),
    )
    if not isinstance(dataset_manifest, dict):
        raise ValueError("Foundation dataset manifest must contain a JSON object.")
    if dataset_manifest.get("schema_version") != "dime-dataset-manifest-v4":
        raise ValueError("Full training requires a dime-dataset-manifest-v4 foundation manifest.")
    if (
        dataset_manifest.get("visibility") != "private"
        or dataset_manifest.get("publication_classification") != "private-only"
    ):
        raise ValueError(
            "Full training requires a private, private-only foundation dataset release."
        )
    require_current_foundation_evidence(dataset_manifest)
    if dataset_manifest.get("development_eval_revision") != authorized_development_eval_revision:
        raise ValueError(
            "Foundation manifest development-evaluation revision does not match "
            "the reviewed training authorization."
        )
    if dataset_manifest.get("locked_evaluation_reference") != authorized_locked_eval_reference:
        raise ValueError(
            "Foundation manifest locked-evaluation reference does not match "
            "the reviewed training authorization."
        )

    train_records = parse_jsonl_bytes(bound_snapshot["train.jsonl"].data, str(train_path))
    validation_records = parse_jsonl_bytes(
        bound_snapshot["validation.jsonl"].data,
        str(validation_path),
    )
    v4_evidence_hashes = {
        field: authorized_evidence[field] for field in FOUNDATION_EVIDENCE_HASH_FIELDS
    }
    if (
        v4_evidence_hashes["system_prompt_sha256"]
        != bound_file(
            system_prompt_path,
            captured_files,
            "system prompt",
        ).sha256
    ):
        raise ValueError("Authorized Foundation system-prompt hash does not match Git.")
    if (
        v4_evidence_hashes["foundation_build_config_sha256"]
        != bound_file(
            foundation_build_config_path,
            captured_files,
            "foundation build config",
        ).sha256
    ):
        raise ValueError("Authorized Foundation build-config hash does not match Git.")
    if (
        v4_evidence_hashes["reviewer_registry_sha256"]
        != bound_file(
            reviewer_registry_path,
            captured_files,
            "foundation reviewer registry",
        ).sha256
    ):
        raise ValueError("Authorized Foundation reviewer-registry hash does not match Git.")
    validate_dataset_manifest(
        dataset_manifest,
        bound_snapshot["train.jsonl"].sha256,
        bound_snapshot["validation.jsonl"].sha256,
        bound_file(curriculum_path, captured_files, "curriculum").sha256,
        bound_file(tool_catalog_path, captured_files, "tool catalog").sha256,
        bound_file(template_path, captured_files, "chat template").sha256,
        train_record_count=len(train_records),
        validation_record_count=len(validation_records),
        v4_evidence_hashes=v4_evidence_hashes,
    )
    manifest_evidence = manifest_foundation_evidence_hashes(dataset_manifest)
    if manifest_evidence != authorized_evidence:
        raise ValueError(
            "Foundation manifest evidence hashes do not match the reviewed authorization."
        )
    return (
        train_records,
        validation_records,
        bound_snapshot["dataset_manifest.json"].sha256,
        bound_snapshot["checksums.json"].sha256,
    )


def parse_runtime_contract(
    runtime_path: Path,
    captured_files: dict[Path, BoundFile] | None = None,
) -> dict[str, str]:
    values: dict[str, str] = {}
    text = bound_file(runtime_path, captured_files, "runtime contract").data.decode("utf-8")
    for line in text.splitlines():
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
    captured_files: dict[Path, BoundFile] | None = None,
) -> dict[str, Any]:
    manifest_bound = bound_file(manifest_path, captured_files, "run manifest")
    manifest = json.loads(manifest_bound.data.decode("utf-8"))
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
        "training_config_sha256": bound_file(config_path, captured_files, "training config").sha256,
        "system_prompt_sha256": bound_file(
            contract_paths["system_prompt"], captured_files, "system prompt"
        ).sha256,
        "chat_template_sha256": bound_file(
            contract_paths["chat_template"], captured_files, "chat template"
        ).sha256,
        "tool_catalog_sha256": bound_file(
            contract_paths["tool_catalog"], captured_files, "tool catalog"
        ).sha256,
        "dataset_schema_sha256": bound_file(
            contract_paths["dataset_schema"], captured_files, "dataset schema"
        ).sha256,
        "evaluation_schema_sha256": bound_file(
            contract_paths["evaluation_schema"], captured_files, "evaluation schema"
        ).sha256,
        "decoding_config_sha256": bound_file(
            contract_paths["decoding_config"], captured_files, "decoding config"
        ).sha256,
        "runtime_contract_sha256": bound_file(
            runtime_path, captured_files, "runtime contract"
        ).sha256,
        "requirements_lock_sha256": bound_file(
            requirements_path, captured_files, "requirements lock"
        ).sha256,
        "run_manifest_schema_sha256": bound_file(
            contract_paths["run_manifest_schema"],
            captured_files,
            "run manifest schema",
        ).sha256,
        "foundation_checksums_schema_sha256": bound_file(
            contract_paths["foundation_checksums_schema"],
            captured_files,
            "foundation checksums schema",
        ).sha256,
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

    runtime = parse_runtime_contract(runtime_path, captured_files)
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


def require_approved_curriculum(curriculum: Any) -> dict[str, Any]:
    """Require an explicit governance approval independently of coverage metrics."""
    curriculum = require_mapping(curriculum, "curriculum")
    if curriculum.get("status") != "approved":
        raise ValueError(
            "Full training requires curriculum status: approved; "
            "passing curriculum metrics cannot authorize a proposed curriculum."
        )
    return curriculum


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
    system_prompt: str | None = None,
) -> Dataset:
    from datasets import Dataset

    encoded_records = []
    for record in records:
        validate_sft_record(record, production=production)
        try:
            if production:
                if system_prompt is None:
                    raise ValueError(
                        "Production tokenization requires the canonical system prompt."
                    )
                messages = attach_canonical_system(
                    record["messages"],
                    system_prompt,
                    tools,
                )
            else:
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


RenameNoReplace = Callable[[Path, Path], None]


def rename_directory_no_replace(source: Path, destination: Path) -> None:
    """Atomically rename a directory while refusing an existing destination."""

    if os.name != "posix":
        raise OSError(errno.ENOTSUP, "atomic no-replace rename requires POSIX")
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise OSError(errno.ENOTSUP, "renameat2(RENAME_NOREPLACE) is unavailable")
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    at_fdcwd = -100
    rename_noreplace = 1
    result = renameat2(
        at_fdcwd,
        os.fsencode(source),
        at_fdcwd,
        os.fsencode(destination),
        rename_noreplace,
    )
    if result != 0:
        error_number = ctypes.get_errno()
        raise OSError(
            error_number,
            os.strerror(error_number),
            os.fspath(destination),
        )


def promote_adapter_directory_no_replace(
    staging_dir: Path,
    final_adapter_dir: Path,
    *,
    rename: RenameNoReplace = rename_directory_no_replace,
) -> None:
    """Promote one staged adapter atomically without ever replacing a prior release."""

    staging_dir = require_no_symlink_components(
        staging_dir,
        "adapter staging directory",
        require_directory=True,
    )
    final_adapter_dir = absolute_without_resolution(final_adapter_dir)
    if staging_dir.parent != final_adapter_dir.parent:
        raise ValueError("Adapter staging and final directories must share one parent.")
    require_no_symlink_components(
        final_adapter_dir.parent,
        "final adapter parent",
        require_directory=True,
    )
    try:
        rename(staging_dir, final_adapter_dir)
    except OSError as error:
        if staging_dir.exists() and not staging_dir.is_symlink():
            shutil.rmtree(staging_dir)
        if error.errno in {errno.EEXIST, errno.ENOTEMPTY}:
            raise SystemExit(
                f"Final adapter directory already exists: {final_adapter_dir}. "
                "The staged adapter was discarded; the existing release was not changed."
            ) from error
        raise


def promote_adapter_after_execution_fence(
    staging_dir: Path,
    final_adapter_dir: Path,
    *,
    production: bool,
    project: Path,
    governed_files: dict[Path, BoundFile] | None,
    foundation_manifest: dict[str, Any] | None,
    authorization_commit: str | None,
    clock: Callable[[], datetime] | None = None,
    rename: RenameNoReplace = rename_directory_no_replace,
) -> None:
    """Reauthorize immediately before the atomic final-adapter promotion."""

    if production:
        verify_full_training_execution_state(
            project=project,
            governed_files=governed_files,
            foundation_manifest=foundation_manifest,
            authorization_commit=authorization_commit,
            clock=clock,
        )
    promote_adapter_directory_no_replace(
        staging_dir,
        final_adapter_dir,
        rename=rename,
    )


def main() -> None:
    cli = parse_args()
    project = Path(__file__).resolve().parents[1]
    config_path = cli.config if cli.config.is_absolute() else project / cli.config
    config_bound = read_bound_file(config_path, "training config")
    config = yaml.safe_load(config_bound.data.decode("utf-8"))
    if not isinstance(config, dict):
        raise ValueError("Training config must contain a mapping.")
    full_provenance = assert_config(config, cli.allow_full_run)
    token: str | None = None
    if full_provenance is not None:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise SystemExit("HF_TOKEN is not configured.")
        verify_hf_training_token_identity(token)
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
    foundation_evidence_hashes = None
    governed_files: dict[Path, BoundFile] | None = None
    authorization_commit: str | None = None
    foundation_manifest: dict[str, Any] | None = None
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
        governed_files = capture_bound_files(
            [
                config_path,
                platform_contract_path,
                train_path,
                validation_path,
                dataset_manifest_path,
                checksums_path,
                dataset_card_path,
                curriculum_path,
                project / "configs/foundation_v1_build.yaml",
                project / "configs/foundation_reviewer_registry.json",
                requirements_path,
                runtime_path,
                run_manifest_path,
                *contract_paths.values(),
            ],
            "full-training governed input",
        )
        platform_contract = strict_json_loads(
            bound_file(
                platform_contract_path,
                governed_files,
                "platform contract",
            ).data.decode("utf-8"),
            str(platform_contract_path),
        )
        if not isinstance(platform_contract, dict):
            raise ValueError("Platform contract must contain a JSON object.")
        if token is None:
            raise AssertionError("Full-training Hugging Face credential is incomplete.")
        verify_hf_effective_permissions(
            full_provenance,
            token,
            platform_contract=platform_contract,
        )
        foundation_evidence_hashes = authorized_foundation_evidence_hashes(platform_contract)
        (
            authorized_development_eval_revision,
            authorized_locked_eval_reference,
        ) = authorized_training_evaluation_references(
            platform_contract,
            full_provenance,
        )
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
            foundation_build_config_path=project / "configs/foundation_v1_build.yaml",
            reviewer_registry_path=project / "configs/foundation_reviewer_registry.json",
            system_prompt_path=system_prompt_path,
            tool_catalog_path=tool_catalog_path,
            template_path=template_path,
            authorized_evidence_hashes=foundation_evidence_hashes,
            authorized_development_eval_revision=authorized_development_eval_revision,
            authorized_locked_eval_reference=authorized_locked_eval_reference,
            captured_files=governed_files,
        )
        run_manifest_sha256 = bound_file(
            run_manifest_path,
            governed_files,
            "run manifest",
        ).sha256
        source_commit = validate_full_training_authorization(
            platform_contract,
            full_provenance,
            config_bound.sha256,
            foundation_dataset_manifest_sha256,
            foundation_checksums_sha256,
            run_manifest_sha256,
            foundation_evidence_hashes,
        )
        if token is None or checksums_path is None or dataset_card_path is None:
            raise AssertionError("Full-training Foundation release state is incomplete.")
        verify_foundation_hf_snapshot(
            revision=full_provenance["datasets"]["foundation_sft"]["revision"],
            token=token,
            train_path=train_path,
            validation_path=validation_path,
            dataset_manifest_path=dataset_manifest_path,
            checksums_path=checksums_path,
            dataset_card_path=dataset_card_path,
            captured_files=governed_files,
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
            captured_files=governed_files,
        )
        foundation_manifest_value = strict_json_loads(
            bound_file(
                dataset_manifest_path,
                governed_files,
                "foundation dataset manifest",
            ).data.decode("utf-8"),
            str(dataset_manifest_path),
        )
        if not isinstance(foundation_manifest_value, dict):
            raise ValueError("Foundation dataset manifest must contain a JSON object.")
        foundation_manifest = foundation_manifest_value
        assert_bound_files_unchanged(
            governed_files,
            "full-training governed input",
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

    if token is None:
        token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable.")

    seed = int(config["run"]["seed"])
    seed_everything(seed)
    if output_dir.exists():
        require_no_symlink_components(
            output_dir,
            "training output directory",
            require_directory=True,
        )
    else:
        require_no_symlink_components(
            output_dir,
            "training output directory",
            allow_missing_leaf=True,
        )
    if final_adapter_dir.exists():
        require_no_symlink_components(
            final_adapter_dir,
            "final adapter directory",
            require_directory=True,
        )
    else:
        require_no_symlink_components(
            final_adapter_dir,
            "final adapter directory",
            allow_missing_leaf=True,
        )
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
        fingerprint["training_platform_contract_sha256"] = bound_file(
            platform_contract_path,
            governed_files,
            "platform contract",
        ).sha256
    establish_run_fingerprint(output_dir, fingerprint)

    if train_records is None:
        train_records = read_jsonl(train_path)
    if validation_records is None:
        validation_records = read_jsonl(validation_path)
    if production:
        if dataset_manifest_path is None or curriculum_path is None:
            raise AssertionError("Production manifest/curriculum paths were not resolved.")
        curriculum_config = require_approved_curriculum(
            yaml.safe_load(
                bound_file(
                    curriculum_path,
                    governed_files,
                    "curriculum",
                ).data.decode("utf-8")
            )
        )
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
    tools = json.loads(
        bound_file(tool_catalog_path, governed_files, "tool catalog").data.decode("utf-8")
    )
    if not isinstance(tools, list) or not tools:
        raise ValueError("Tool catalog must be a non-empty array.")
    system_prompt = (
        bound_file(
            system_prompt_path,
            governed_files,
            "system prompt",
        ).data.decode("utf-8")
        if production
        else None
    )

    tokenizer = AutoTokenizer.from_pretrained(
        PINNED_MODEL_ID,
        revision=PINNED_MODEL_REVISION,
        token=token,
    )
    tokenizer.clean_up_tokenization_spaces = False
    tokenizer.padding_side = "right"
    chat_template_bound = bound_file(
        template_path,
        governed_files,
        "chat template",
    )
    tokenizer.chat_template = chat_template_bound.data.decode("utf-8")
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
        system_prompt,
    )
    eval_dataset = tokenize_records(
        validation_records,
        tokenizer,
        tools,
        max_length,
        minimum_targets,
        production,
        system_prompt,
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
    if full_provenance is not None:
        if checkpoint is not None:
            raise ValueError(
                "Full-training checkpoint resume is blocked until checkpoint contents "
                "have an approved checksum manifest."
            )
    result = train_with_execution_fences(
        trainer,
        checkpoint,
        production=full_provenance is not None,
        project=project,
        governed_files=governed_files,
        foundation_manifest=foundation_manifest,
        authorization_commit=authorization_commit,
    )
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
    (staging_dir / "chat_template.jinja").write_bytes(chat_template_bound.data)
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
    promote_adapter_after_execution_fence(
        staging_dir,
        final_adapter_dir,
        production=full_provenance is not None,
        project=project,
        governed_files=governed_files,
        foundation_manifest=foundation_manifest,
        authorization_commit=authorization_commit,
    )
    print(f"Final adapter: {final_adapter_dir}")
    print("QLORA TRAINING COMPLETED")


if __name__ == "__main__":
    main()
