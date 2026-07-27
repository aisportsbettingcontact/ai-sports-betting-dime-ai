#!/usr/bin/env python
"""Publish one authorized Dime adapter and verify its immutable HF revision."""

from __future__ import annotations

import argparse
import json
import mmap
import os
import re
import shutil
import struct
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO

import numpy as np
from huggingface_hub import HfApi

from dime_ai.release_contract import (
    CANONICAL_REPO_ID,
    OPTIONAL_FILES,
    REMOTE_METADATA_FILES,
    REQUIRED_FILES,
    ReleaseContractError,
    bundle_payload_sha256,
    file_sha256,
    require_full_commit_sha,
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

MAX_ADAPTER_BYTES = 2 * 1024**3
BINARY_FILES = {"adapter_model.safetensors"}
PROJECT = Path(__file__).resolve().parents[1]
PLATFORM_CONTRACT_PATH = PROJECT / "configs/platform_contract.json"
SECRET_PATTERNS = [
    re.compile(r"\bhf_[A-Za-z0-9]{12,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(
        r"""(?ix)
        ["']?(?:api[_-]?key|access[_-]?token|password)["']?
        \s*[:=]\s*
        ["']?[^\s,"'}]+
        """
    ),
]
PLACEHOLDER_PATTERN = re.compile(r"(?i)(?:\b(?:todo|tbd)\b|\breplace(?:[_ -][a-z0-9]+)*)")
TARGET_MODULES = {
    "q_proj": ("self_attn", 4096, 4096),
    "k_proj": ("self_attn", 4096, 1024),
    "v_proj": ("self_attn", 4096, 1024),
    "o_proj": ("self_attn", 4096, 4096),
    "gate_proj": ("mlp", 4096, 14336),
    "up_proj": ("mlp", 4096, 14336),
    "down_proj": ("mlp", 14336, 4096),
}
LLAMA_LAYER_COUNT = 32
APPROVED_LORA_RANK = 16
APPROVED_LORA_ALPHA = 32
APPROVED_LORA_DROPOUT = 0.05
APPROVED_LORA_CONFIG_VALUES = {
    "alora_invocation_tokens": None,
    "alpha_pattern": {},
    "arrow_config": None,
    "auto_mapping": None,
    "bias": "none",
    "corda_config": None,
    "ensure_weight_tying": False,
    "eva_config": None,
    "exclude_modules": None,
    "fan_in_fan_out": False,
    "inference_mode": True,
    "init_lora_weights": True,
    "layer_replication": None,
    "layers_pattern": None,
    "layers_to_transform": None,
    "loftq_config": {},
    "lora_alpha": APPROVED_LORA_ALPHA,
    "lora_bias": False,
    "lora_dropout": APPROVED_LORA_DROPOUT,
    "lora_ga_config": None,
    "megatron_config": None,
    "megatron_core": "megatron.core",
    "modules_to_save": None,
    "peft_type": "LORA",
    "peft_version": "0.19.1",
    "qalora_group_size": 16,
    "r": APPROVED_LORA_RANK,
    "rank_pattern": {},
    "target_parameters": None,
    "task_type": "CAUSAL_LM",
    "trainable_token_indices": None,
    "use_bdlora": None,
    "use_dora": False,
    "use_qalora": False,
    "use_rslora": False,
}
APPROVED_ADAPTER_CONFIG_KEYS = frozenset(
    {
        "base_model_name_or_path",
        "revision",
        "target_modules",
        *APPROVED_LORA_CONFIG_VALUES,
    }
)
SAFETENSORS_HEADER_LIMIT_BYTES = 16 * 1024**2
SAFETENSORS_METADATA = {"format": "pt"}
SAFETENSORS_DTYPE_BYTES = {
    "BF16": 2,
    "F16": 2,
    "F32": 4,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter-dir", type=Path, required=True)
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--confirm-repo", required=True)
    parser.add_argument("--expected-parent-commit", required=True)
    parser.add_argument("--evaluation-report", type=Path, required=True)
    parser.add_argument("--release-attestation", type=Path, required=True)
    parser.add_argument(
        "--receipt",
        type=Path,
        required=True,
        help="New path outside the adapter bundle for the verified publication receipt.",
    )
    parser.add_argument(
        "--private",
        action="store_true",
        required=True,
        help="Required confirmation that the existing destination must be private.",
    )
    return parser.parse_args()


def read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseContractError(f"Cannot read valid JSON object from {path.name}.") from error
    if not isinstance(value, dict):
        raise ReleaseContractError(f"{path.name} must contain a JSON object.")
    return value


def git_output(project: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(project), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise ReleaseContractError("Cannot verify the reviewed Git platform contract.") from error
    return result.stdout.strip()


def load_reviewed_platform_contract(
    project: Path = PROJECT,
) -> tuple[dict[str, Any], str, str]:
    """Load an exact, focused authorization commit and preserve its prior champion."""
    contract_path = project / "configs/platform_contract.json"
    if contract_path.is_symlink():
        raise ReleaseContractError("Canonical platform contract cannot be a symlink.")
    repository_root = Path(git_output(project, "rev-parse", "--show-toplevel")).resolve()
    try:
        relative_path = contract_path.resolve().relative_to(repository_root)
    except ValueError as error:
        raise ReleaseContractError(
            "Canonical platform contract is outside the Git repository."
        ) from error
    pathspec = f":(top){relative_path.as_posix()}"
    git_output(project, "ls-files", "--error-unmatch", pathspec)
    try:
        status = subprocess.run(
            [
                "git",
                "-C",
                str(project),
                "diff",
                "--quiet",
                "HEAD",
                "--",
                pathspec,
            ],
            check=False,
        )
    except OSError as error:
        raise ReleaseContractError(
            "Cannot verify the canonical platform contract worktree state."
        ) from error
    if status.returncode == 1:
        raise ReleaseContractError(
            "Canonical platform contract differs from HEAD; commit and review it first."
        )
    if status.returncode != 0:
        raise ReleaseContractError("Cannot verify the canonical platform contract worktree state.")
    if git_output(project, "status", "--porcelain", "--untracked-files=all"):
        raise ReleaseContractError(
            "Release publication requires a completely clean reviewed Git worktree."
        )
    head = require_full_commit_sha(
        git_output(project, "rev-parse", "HEAD"),
        "authorization Git commit",
    )
    contract = read_json_object(contract_path)
    parent = require_full_commit_sha(
        git_output(project, "rev-parse", f"{head}^1"),
        "authorization parent Git commit",
    )
    authorization_diff = git_output(
        project,
        "diff",
        "--name-status",
        parent,
        head,
    )
    expected_change = f"M\t{relative_path.as_posix()}"
    if authorization_diff != expected_change:
        raise ReleaseContractError(
            "Release publication must run from an exact authorization commit whose "
            "entire repository diff modifies only configs/platform_contract.json."
        )
    try:
        prior_contract = json.loads(
            git_output(
                project,
                "show",
                f"{parent}:{relative_path.as_posix()}",
            )
        )
    except json.JSONDecodeError as error:
        raise ReleaseContractError(
            "Authorization parent does not contain a valid platform contract."
        ) from error
    prior_promoted = (
        prior_contract.get("hugging_face", {}).get("repositories", {}).get("promoted_adapter", {})
    )
    current_promoted = (
        contract.get("hugging_face", {}).get("repositories", {}).get("promoted_adapter", {})
    )
    if prior_promoted.get("approved_release_revision") != current_promoted.get(
        "approved_release_revision"
    ):
        raise ReleaseContractError(
            "Release authorization must preserve the previously approved champion revision."
        )
    return contract, file_sha256(contract_path), head


def validate_release_time(value: object) -> None:
    if not isinstance(value, str):
        raise ReleaseContractError("Release attestation requires approved_at_utc.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReleaseContractError("approved_at_utc must be ISO-8601.") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ReleaseContractError("approved_at_utc must include an explicit UTC offset.")
    if parsed.utcoffset().total_seconds() != 0:
        raise ReleaseContractError("approved_at_utc must be normalized to UTC.")


def scan_text_file(path: Path) -> None:
    carry = ""
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), ""):
            candidate = carry + chunk
            for pattern in SECRET_PATTERNS:
                if pattern.search(candidate):
                    raise ReleaseContractError(f"Possible secret detected in {path.name}")
            carry = candidate[-512:]


def scan_artifacts(files: list[Path]) -> None:
    for path in files:
        if path.is_symlink():
            raise ReleaseContractError(f"Symlinks are not publishable: {path.name}")
        if path.name.startswith("."):
            raise ReleaseContractError(f"Hidden files are not publishable: {path.name}")
        if path.name not in BINARY_FILES:
            scan_text_file(path)


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"Duplicate safetensors header key: {key}")
        value[key] = item
    return value


def _read_safetensors_header(
    handle: BinaryIO,
    file_size: int,
) -> tuple[dict[str, Any], int]:
    prefix = handle.read(8)
    if len(prefix) != 8:
        raise ValueError("Safetensors file is missing its header length.")
    header_size = struct.unpack("<Q", prefix)[0]
    if (
        header_size == 0
        or header_size % 8 != 0
        or header_size > SAFETENSORS_HEADER_LIMIT_BYTES
        or header_size > file_size - 8
    ):
        raise ValueError("Safetensors header length is invalid.")

    encoded_header = handle.read(header_size)
    if (
        len(encoded_header) != header_size
        or not encoded_header.startswith(b"{")
        or not encoded_header.rstrip(b" ").endswith(b"}")
    ):
        raise ValueError("Safetensors header framing is invalid.")
    header = json.loads(
        encoded_header.decode("utf-8"),
        object_pairs_hook=_reject_duplicate_json_keys,
    )
    if not isinstance(header, dict):
        raise ValueError("Safetensors header must be a JSON object.")
    return header, 8 + header_size


def _validate_finite_tensor_values(
    handle: BinaryIO,
    regions: list[tuple[str, str, int, int, int]],
) -> None:
    with mmap.mmap(handle.fileno(), length=0, access=mmap.ACCESS_READ) as mapped:
        for key, dtype, absolute_start, _absolute_end, element_count in regions:
            if dtype == "BF16":
                values = np.frombuffer(
                    mapped,
                    dtype="<u2",
                    count=element_count,
                    offset=absolute_start,
                )
                non_finite = np.any(np.bitwise_and(values, np.uint16(0x7F80)) == np.uint16(0x7F80))
            else:
                numpy_dtype = "<f2" if dtype == "F16" else "<f4"
                values = np.frombuffer(
                    mapped,
                    dtype=numpy_dtype,
                    count=element_count,
                    offset=absolute_start,
                )
                non_finite = not bool(np.isfinite(values).all())
            del values
            if bool(non_finite):
                raise ReleaseContractError(f"Adapter tensor contains non-finite values: {key}")


def validate_adapter_safetensors(
    path: Path,
    adapter_config: dict[str, Any],
) -> None:
    """Reject renamed base weights and require the exact Dime LoRA tensor structure."""
    rank = adapter_config.get("r")
    targets = adapter_config.get("target_modules")
    if (
        set(adapter_config) != APPROVED_ADAPTER_CONFIG_KEYS
        or any(
            field not in adapter_config or adapter_config[field] != expected
            for field, expected in APPROVED_LORA_CONFIG_VALUES.items()
        )
        or not isinstance(rank, int)
        or isinstance(rank, bool)
        or not isinstance(targets, list)
        or len(targets) != len(TARGET_MODULES)
        or any(not isinstance(target, str) for target in targets)
        or set(targets) != set(TARGET_MODULES)
    ):
        raise ReleaseContractError(
            "Adapter config is not the exact adapter-only Dime LoRA structure."
        )

    expected: dict[str, tuple[int, int]] = {}
    for layer in range(LLAMA_LAYER_COUNT):
        for module, (block, input_size, output_size) in TARGET_MODULES.items():
            prefix = f"base_model.model.model.layers.{layer}.{block}.{module}"
            expected[f"{prefix}.lora_A.weight"] = (rank, input_size)
            expected[f"{prefix}.lora_B.weight"] = (output_size, rank)

    try:
        if path.is_symlink() or not path.is_file():
            raise ValueError("Safetensors checkpoint must be a regular file.")
        with path.open("rb") as handle:
            file_size = os.fstat(handle.fileno()).st_size
            header, data_start = _read_safetensors_header(handle, file_size)
            metadata = header.get("__metadata__")
            if metadata != SAFETENSORS_METADATA:
                raise ReleaseContractError(
                    "Adapter safetensors metadata must be exactly {'format': 'pt'}."
                )

            tensor_keys = set(header) - {"__metadata__"}
            if tensor_keys != set(expected):
                raise ReleaseContractError(
                    "Adapter tensor inventory is not the exact 32-layer Dime LoRA structure."
                )

            regions: list[tuple[str, str, int, int, int]] = []
            for key, expected_shape in expected.items():
                descriptor = header[key]
                if not isinstance(descriptor, dict) or set(descriptor) != {
                    "dtype",
                    "shape",
                    "data_offsets",
                }:
                    raise ReleaseContractError(f"Adapter tensor has an invalid descriptor: {key}")

                dtype = descriptor["dtype"]
                if dtype not in SAFETENSORS_DTYPE_BYTES:
                    raise ReleaseContractError(f"Adapter tensor has invalid dtype: {key}")

                shape = descriptor["shape"]
                if (
                    not isinstance(shape, list)
                    or any(
                        not isinstance(dimension, int) or isinstance(dimension, bool)
                        for dimension in shape
                    )
                    or tuple(shape) != expected_shape
                ):
                    raise ReleaseContractError(f"Adapter tensor has invalid shape: {key}")

                offsets = descriptor["data_offsets"]
                if (
                    not isinstance(offsets, list)
                    or len(offsets) != 2
                    or any(
                        not isinstance(offset, int) or isinstance(offset, bool)
                        for offset in offsets
                    )
                ):
                    raise ReleaseContractError(f"Adapter tensor has invalid data offsets: {key}")
                start, end = offsets
                element_count = expected_shape[0] * expected_shape[1]
                expected_size = element_count * SAFETENSORS_DTYPE_BYTES[dtype]
                if start < 0 or end <= start or end - start != expected_size:
                    raise ReleaseContractError(f"Adapter tensor has invalid data offsets: {key}")
                regions.append((key, dtype, data_start + start, data_start + end, element_count))

            cursor = data_start
            for key, _dtype, absolute_start, absolute_end, _count in sorted(
                regions,
                key=lambda region: region[2],
            ):
                if absolute_start != cursor or absolute_end > file_size:
                    raise ReleaseContractError(f"Adapter tensor has invalid data offsets: {key}")
                cursor = absolute_end
            if cursor != file_size:
                raise ReleaseContractError("Adapter safetensors payload has gaps or trailing data.")

            _validate_finite_tensor_values(handle, regions)
    except ReleaseContractError:
        raise
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise ReleaseContractError(
            "adapter_model.safetensors is not a valid Dime LoRA checkpoint."
        ) from error


def snapshot_release_bundle(source: Path, destination: Path) -> set[str]:
    """Copy once, then validate and upload only the immutable local snapshot."""
    present = validate_file_inventory(source)
    destination.mkdir(parents=True, exist_ok=False)
    for name in sorted(present):
        source_path = source / name
        if source_path.is_symlink():
            raise ReleaseContractError(f"Symlinks are not publishable: {name}")
        shutil.copyfile(source_path, destination / name, follow_symlinks=False)
    return validate_file_inventory(destination)


def validate_local_release(
    args: argparse.Namespace,
    adapter_dir: Path,
    platform_contract: dict[str, Any],
    platform_contract_hash: str,
    authorization_github_commit: str,
) -> tuple[set[str], dict[str, Any], dict[str, str], str, dict[str, str]]:
    if args.repo_id != args.confirm_repo:
        raise ReleaseContractError("Repository confirmation does not match --repo-id.")
    if args.private is not True:
        raise ReleaseContractError(
            "Promoted-adapter publication requires explicit private-repository confirmation."
        )
    validate_repo_id(args.repo_id)
    expected_parent = require_full_commit_sha(
        args.expected_parent_commit,
        "--expected-parent-commit",
    )

    present = validate_file_inventory(adapter_dir)
    files = [adapter_dir / name for name in sorted(present)]
    scan_artifacts(files)
    total_size = sum(path.stat().st_size for path in files)
    if total_size > MAX_ADAPTER_BYTES:
        raise ReleaseContractError(
            f"Adapter directory is unexpectedly large: {total_size / 1e9:.2f} GB"
        )

    manifest_path = adapter_dir / "training_manifest.json"
    model_card_path = adapter_dir / "README.md"
    manifest = read_json_object(manifest_path)
    adapter_config = read_json_object(adapter_dir / "adapter_config.json")
    validate_parent_identity(adapter_config, manifest)
    validate_training_manifest(manifest)
    validate_platform_authorization(platform_contract)
    validate_adapter_safetensors(
        adapter_dir / "adapter_model.safetensors",
        adapter_config,
    )
    validate_checksum_manifest(adapter_dir, present)

    model_card = model_card_path.read_text(encoding="utf-8")
    if PLACEHOLDER_PATTERN.search(model_card):
        raise ReleaseContractError("Model card still contains placeholder fields.")
    for disclosure in ("Built with Llama", "AI-generated"):
        if disclosure.lower() not in model_card.lower():
            raise ReleaseContractError(f"Model card is missing required disclosure: {disclosure}")

    bundled_evaluation = adapter_dir / "evaluation_summary.json"
    bundled_attestation = adapter_dir / "release_attestation.json"

    candidate_hashes = {
        "adapter_model_sha256": file_sha256(adapter_dir / "adapter_model.safetensors"),
        "adapter_config_sha256": file_sha256(adapter_dir / "adapter_config.json"),
        "training_manifest_sha256": file_sha256(manifest_path),
    }
    release_candidate = platform_contract["authorization"].get("release_candidate")
    if not isinstance(release_candidate, dict):
        raise ReleaseContractError("Platform contract is missing release-candidate authorization.")
    locked_suite_manifest_sha256 = release_candidate.get("locked_suite_manifest_sha256")
    locked_suite_expected_cases = release_candidate.get("locked_suite_expected_cases")
    approved_release_revision = platform_contract["hugging_face"]["repositories"][
        "promoted_adapter"
    ].get("approved_release_revision")
    evaluation = read_json_object(bundled_evaluation)
    validate_evaluation_report(
        evaluation,
        manifest,
        candidate_hashes,
        locked_suite_manifest_sha256,
        locked_suite_expected_cases,
        approved_release_revision,
    )
    comparison = evaluation["comparison"]
    comparison_control = comparison["control"]
    quality = evaluation["quality"]
    expected_hashes = {
        "bundle_payload_sha256": bundle_payload_sha256(adapter_dir, present),
        **candidate_hashes,
        "model_card_sha256": file_sha256(model_card_path),
        "evaluation_report_sha256": file_sha256(bundled_evaluation),
    }
    validate_platform_authorization(
        platform_contract,
        manifest=manifest,
        expected_parent_commit=expected_parent,
        adapter_model_sha256=candidate_hashes["adapter_model_sha256"],
        adapter_config_sha256=candidate_hashes["adapter_config_sha256"],
        training_manifest_sha256=candidate_hashes["training_manifest_sha256"],
        evaluation_summary_sha256=expected_hashes["evaluation_report_sha256"],
        bundle_payload_sha256=expected_hashes["bundle_payload_sha256"],
        locked_suite_manifest_sha256=locked_suite_manifest_sha256,
        locked_suite_expected_cases=locked_suite_expected_cases,
        comparison_control_kind=comparison_control["kind"],
        comparison_control_repo_id=comparison_control["repo_id"],
        comparison_control_revision=comparison_control["revision"],
        comparison_control_artifact_sha256=comparison_control["artifact_sha256"],
        comparison_report_sha256=comparison["comparison_report_sha256"],
        quality_slice_report_sha256=quality["slice_report_sha256"],
    )
    attestation = read_json_object(bundled_attestation)
    validate_release_time(attestation.get("approved_at_utc"))
    if file_sha256(adapter_dir / "chat_template.jinja") != manifest.get("chat_template_sha256"):
        raise ReleaseContractError(
            "Published chat_template.jinja does not match the training manifest."
        )
    validate_attestation(
        attestation,
        manifest,
        expected_parent,
        platform_contract_hash,
        authorization_github_commit,
        expected_hashes,
        str(evaluation["evaluator_run_id"]),
    )

    file_hashes = {name: file_sha256(adapter_dir / name) for name in sorted(present)}
    return (
        present,
        manifest,
        expected_hashes,
        str(evaluation["evaluator_run_id"]),
        file_hashes,
    )


def verify_remote_hashes(
    api: HfApi,
    repo_id: str,
    revision: str,
    file_hashes: dict[str, str],
) -> None:
    with tempfile.TemporaryDirectory(prefix="dime-hf-verify-") as cache_dir:
        for name, expected_hash in sorted(file_hashes.items()):
            remote_path = Path(
                api.hf_hub_download(
                    repo_id=repo_id,
                    filename=name,
                    repo_type="model",
                    revision=revision,
                    cache_dir=cache_dir,
                    force_download=True,
                )
            )
            if file_sha256(remote_path) != expected_hash:
                raise ReleaseContractError(f"Published hash verification failed: {name}")


def preflight_receipt_path(receipt_path: Path) -> None:
    """Prove the receipt can be durably written before any registry mutation."""
    if receipt_path.exists():
        raise ReleaseContractError("Publication receipt already exists; refusing to overwrite it.")
    receipt_created = False
    try:
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor = os.open(
            receipt_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )
        receipt_created = True
        with os.fdopen(file_descriptor, mode="w", encoding="utf-8") as handle:
            handle.write('{"receipt_preflight":"passed"}\n')
            handle.flush()
            os.fsync(handle.fileno())
        directory_fd = os.open(receipt_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
            receipt_path.unlink()
            receipt_created = False
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        if receipt_created:
            try:
                receipt_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise ReleaseContractError(
            "Publication receipt destination is not durably writable."
        ) from error


def write_receipt_atomic(
    receipt_path: Path,
    receipt: dict[str, Any],
    published_commit: str,
) -> None:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=receipt_path.parent,
            prefix=f".{receipt_path.name}.write-",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(receipt, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary_path, receipt_path)
        temporary_path.unlink()
        temporary_path = None
        directory_fd = os.open(receipt_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise ReleaseContractError(
            f"Upload created {CANONICAL_REPO_ID}@{published_commit}, but the verified "
            "publication receipt could not be persisted. Do not publish again or serve "
            "this revision; preserve the SHA for an explicit recovery review."
        ) from error


def publish_adapter(
    args: argparse.Namespace,
    publisher_api: HfApi,
    verifier_api: HfApi,
) -> dict[str, Any]:
    source_adapter_dir = args.adapter_dir.resolve()
    receipt_path = args.receipt.resolve()
    if receipt_path == source_adapter_dir or receipt_path.is_relative_to(source_adapter_dir):
        raise ReleaseContractError("Publication receipt must be outside the adapter bundle.")
    preflight_receipt_path(receipt_path)
    if args.evaluation_report.resolve() != source_adapter_dir / "evaluation_summary.json":
        raise ReleaseContractError(
            "--evaluation-report must reference the bundled evaluation_summary.json."
        )
    if args.release_attestation.resolve() != source_adapter_dir / "release_attestation.json":
        raise ReleaseContractError(
            "--release-attestation must reference the bundled release_attestation.json."
        )

    platform_contract, platform_contract_hash, authorization_commit = (
        load_reviewed_platform_contract()
    )
    expected_parent = require_full_commit_sha(
        args.expected_parent_commit,
        "--expected-parent-commit",
    )

    with tempfile.TemporaryDirectory(prefix="dime-release-snapshot-") as temporary:
        adapter_dir = Path(temporary) / "bundle"
        snapshot_release_bundle(source_adapter_dir, adapter_dir)
        (
            present,
            manifest,
            expected_hashes,
            evaluator_run_id,
            file_hashes,
        ) = validate_local_release(
            args,
            adapter_dir,
            platform_contract,
            platform_contract_hash,
            authorization_commit,
        )

        info = publisher_api.model_info(args.repo_id, revision="main")
        if info.private is not True:
            raise ReleaseContractError(
                "The promoted-adapter destination must already be a private repository."
            )
        remote_head = require_full_commit_sha(
            getattr(info, "sha", None),
            "remote repository head",
        )
        if remote_head != expected_parent:
            raise ReleaseContractError("Remote repository head changed before publication.")

        remote_before = set(
            publisher_api.list_repo_files(
                repo_id=args.repo_id,
                repo_type="model",
                revision=expected_parent,
            )
        )
        stale, _ = validate_remote_inventory(remote_before, present)
        result = publisher_api.upload_folder(
            repo_id=args.repo_id,
            repo_type="model",
            folder_path=str(adapter_dir),
            revision="main",
            parent_commit=expected_parent,
            commit_message=f"Publish approved Dime adapter {manifest['experiment_id']}",
            allow_patterns=sorted(REQUIRED_FILES | OPTIONAL_FILES),
            delete_patterns=sorted(stale) or None,
        )
        published_commit = require_full_commit_sha(
            getattr(result, "oid", None),
            "published Hugging Face commit",
        )

        try:
            remote_after = set(
                verifier_api.list_repo_files(
                    repo_id=args.repo_id,
                    repo_type="model",
                    revision=published_commit,
                )
            )
            expected_remote = present | REMOTE_METADATA_FILES
            unknown_after = remote_after - expected_remote
            if unknown_after or remote_after != expected_remote:
                raise ReleaseContractError(
                    "Published remote inventory verification failed; "
                    f"unknown={sorted(unknown_after)}, "
                    f"missing={sorted(expected_remote - remote_after)}, "
                    f"stale={sorted(remote_after - expected_remote)}"
                )
            verify_remote_hashes(
                verifier_api,
                args.repo_id,
                published_commit,
                file_hashes,
            )
        except Exception as error:
            raise ReleaseContractError(
                f"Upload created {args.repo_id}@{published_commit}, but pinned read-only "
                "verification failed. Do not publish again or serve it; preserve this SHA "
                "for an explicit verification/recovery review."
            ) from error

    receipt = {
        "schema_version": "dime-hf-publication-receipt-v1",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "repo_type": "model",
        "repo_id": args.repo_id,
        "private": bool(args.private),
        "parent_commit": expected_parent,
        "published_commit": published_commit,
        "experiment_id": manifest["experiment_id"],
        "evaluator_run_id": evaluator_run_id,
        "source": manifest["source"],
        "authorization_github_commit": authorization_commit,
        "datasets": manifest["datasets"],
        "files": file_hashes,
        "attested_hashes": expected_hashes,
        "remote_inventory": sorted(remote_after),
        "publisher_tool_version": "dime-publish-adapter-v1",
        "verification_credential": {
            "distinct_from_publisher": True,
            "scope_identity": "not_introspected_by_huggingface_hub",
        },
        "checksums_sha256": file_hashes["checksums.sha256"],
        "release_attestation_sha256": file_hashes["release_attestation.json"],
        "tag": None,
        "rollback_commit": expected_parent,
        "verification": {
            "result": "passed",
            "parent_commit_guard": True,
            "exact_inventory": True,
            "pinned_remote_hashes": True,
        },
    }
    write_receipt_atomic(receipt_path, receipt, published_commit)
    return receipt


def main() -> None:
    args = parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    verification_token = os.environ.get("HF_VERIFY_TOKEN")
    if not verification_token:
        raise SystemExit("HF_VERIFY_TOKEN is not configured.")
    if verification_token == token:
        raise SystemExit("HF_VERIFY_TOKEN must be a separate read-only credential.")
    try:
        receipt = publish_adapter(
            args,
            HfApi(token=token),
            HfApi(token=verification_token),
        )
    except ReleaseContractError as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(receipt, indent=2, sort_keys=True))
    print(
        "Published and verified adapter-only artifact at "
        f"{receipt['repo_id']}@{receipt['published_commit']}"
    )


if __name__ == "__main__":
    main()
