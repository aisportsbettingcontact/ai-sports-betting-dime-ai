"""Pure, fail-closed validation for a promoted Dime PEFT adapter release."""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

CANONICAL_REPO_ID = "taileredsports/Llama-3-Dime-1.0"
CANONICAL_GITHUB_REPOSITORY = "aisportsbettingcontact/ai-sports-betting-dime-ai"
BASE_MODEL_ID = "meta-llama/Llama-3.1-8B"
BASE_MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"
FOUNDATION_REPO_ID = "taileredsports/dime-foundation-sft"
DEVELOPMENT_EVAL_REPO_ID = "taileredsports/dime-eval-development"
LOCKED_EVAL_REPO_ID = "taileredsports/dime-eval-locked"

REQUIRED_FILES = frozenset(
    {
        "README.md",
        "LICENSE",
        "NOTICE",
        "adapter_model.safetensors",
        "adapter_config.json",
        "training_manifest.json",
        "evaluation_summary.json",
        "release_attestation.json",
        "checksums.sha256",
        "chat_template.jinja",
        "generation_config.json",
    }
)
OPTIONAL_FILES = frozenset(
    {
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "added_tokens.json",
    }
)
REMOTE_METADATA_FILES = frozenset({".gitattributes"})
CHECKSUM_FILE = "checksums.sha256"
FULL_COMMIT_SHA = re.compile(r"^[0-9a-f]{40}$")
FULL_SHA256 = re.compile(r"^[0-9a-f]{64}$")
EXPERIMENT_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{7,127}$")
LOCKED_REFERENCE = re.compile(
    r"^(?:[0-9a-f]{40}|locked-eval-(?:approval|suite|revision):"
    r"[a-z0-9][a-z0-9._-]{3,95})$"
)
EVALUATOR_RUN_ID = re.compile(r"^locked-evaluator-run-[a-z0-9][a-z0-9._-]{3,63}$")
PROVENANCE_HASH_FIELDS = (
    "config_sha256",
    "system_prompt_sha256",
    "chat_template_sha256",
    "tool_catalog_sha256",
    "dataset_schema_sha256",
    "evaluation_schema_sha256",
    "decoding_config_sha256",
    "runtime_contract_sha256",
    "run_manifest_schema_sha256",
    "foundation_checksums_schema_sha256",
    "foundation_dataset_manifest_sha256",
    "foundation_checksums_sha256",
    "run_manifest_sha256",
)
RELEASE_EVALUATION_SCHEMA = (
    Path(__file__).resolve().parents[2] / "schemas/release_evaluation_summary.schema.json"
)


class ReleaseContractError(ValueError):
    """Raised when a release bundle violates the promoted-adapter contract."""


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bundle_payload_sha256(adapter_dir: Path, present: set[str]) -> str:
    excluded = {"checksums.sha256", "release_attestation.json"}
    inventory = {name: file_sha256(adapter_dir / name) for name in sorted(present - excluded)}
    canonical = json_bytes(inventory)
    return hashlib.sha256(canonical).hexdigest()


def json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def require_full_commit_sha(value: object, field: str) -> str:
    if not isinstance(value, str) or not FULL_COMMIT_SHA.fullmatch(value):
        raise ReleaseContractError(f"{field} must be a full 40-character commit SHA.")
    return value


def require_sha256(value: object, field: str) -> str:
    if not isinstance(value, str) or not FULL_SHA256.fullmatch(value):
        raise ReleaseContractError(f"{field} must be a lowercase SHA-256 digest.")
    return value


def require_non_placeholder(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReleaseContractError(f"{field} must be a non-empty string.")
    normalized = value.strip()
    if any(marker in normalized.upper() for marker in ("TODO", "REPLACE", "TBD")):
        raise ReleaseContractError(f"{field} still contains a placeholder.")
    return normalized


def require_locked_reference(value: object, field: str) -> str:
    normalized = require_non_placeholder(value, field)
    if "hf_" in normalized.casefold() or not LOCKED_REFERENCE.fullmatch(normalized):
        raise ReleaseContractError(
            f"{field} must be an approved locked-evaluation commit or opaque ID."
        )
    return normalized


def require_evaluator_run_id(value: object, field: str) -> str:
    normalized = require_non_placeholder(value, field)
    if not EVALUATOR_RUN_ID.fullmatch(normalized):
        raise ReleaseContractError(f"{field} must be a structured evaluator run ID.")
    return normalized


def validate_repo_id(repo_id: str) -> None:
    if repo_id != CANONICAL_REPO_ID:
        raise ReleaseContractError(
            f"Release destination must be the canonical repository: {CANONICAL_REPO_ID}"
        )


def validate_file_inventory(adapter_dir: Path) -> set[str]:
    if not adapter_dir.is_dir():
        raise ReleaseContractError(f"Adapter directory not found: {adapter_dir}")
    entries = list(adapter_dir.iterdir())
    symlinks = sorted(path.name for path in entries if path.is_symlink())
    if symlinks:
        raise ReleaseContractError(f"Symlinks are blocked: {symlinks}")
    nested = [path for path in adapter_dir.rglob("*") if path.parent != adapter_dir]
    if nested:
        raise ReleaseContractError(
            "Nested directories/files are not allowed in a promoted adapter bundle."
        )
    non_files = sorted(path.name for path in entries if not path.is_file())
    if non_files:
        raise ReleaseContractError(f"Non-file entries are blocked: {non_files}")

    present = {path.name for path in entries}
    missing = REQUIRED_FILES - present
    unknown = present - REQUIRED_FILES - OPTIONAL_FILES
    if missing:
        raise ReleaseContractError(f"Adapter directory is missing: {sorted(missing)}")
    if unknown:
        raise ReleaseContractError(f"Unknown files are blocked from upload: {sorted(unknown)}")
    tokenizer_core = {
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
    }
    supplied_tokenizer_core = present & tokenizer_core
    if supplied_tokenizer_core and supplied_tokenizer_core != tokenizer_core:
        raise ReleaseContractError(
            "Tokenizer override files must be supplied as one complete root-level set."
        )
    if "added_tokens.json" in present and supplied_tokenizer_core != tokenizer_core:
        raise ReleaseContractError(
            "added_tokens.json requires the complete tokenizer override set."
        )
    return present


def validate_parent_identity(
    adapter_config: dict[str, Any],
    training_manifest: dict[str, Any],
) -> None:
    if adapter_config.get("base_model_name_or_path") != BASE_MODEL_ID:
        raise ReleaseContractError("adapter_config.json has the wrong base model.")
    if adapter_config.get("revision") != BASE_MODEL_REVISION:
        raise ReleaseContractError("adapter_config.json does not pin the exact base revision.")
    if training_manifest.get("parent_model_id") != BASE_MODEL_ID:
        raise ReleaseContractError("training_manifest.json has the wrong parent model.")
    if training_manifest.get("parent_model_revision") != BASE_MODEL_REVISION:
        raise ReleaseContractError("training_manifest.json does not pin the exact parent revision.")


def validate_checksum_manifest(adapter_dir: Path, present: set[str]) -> None:
    checksum_path = adapter_dir / CHECKSUM_FILE
    recorded: dict[str, str] = {}

    for line_number, raw_line in enumerate(
        checksum_path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            raise ReleaseContractError(
                f"{CHECKSUM_FILE}:{line_number} must contain '<sha256>  <filename>'."
            )
        digest, name = parts
        name = name.lstrip("*")
        require_sha256(digest, f"{CHECKSUM_FILE}:{line_number}")
        if "/" in name or name in {".", ".."}:
            raise ReleaseContractError(
                f"{CHECKSUM_FILE}:{line_number} must reference a root file name."
            )
        if name in recorded:
            raise ReleaseContractError(f"{CHECKSUM_FILE} repeats {name}.")
        recorded[name] = digest

    expected_names = present - {CHECKSUM_FILE}
    if set(recorded) != expected_names:
        missing = sorted(expected_names - set(recorded))
        unknown = sorted(set(recorded) - expected_names)
        raise ReleaseContractError(
            f"{CHECKSUM_FILE} inventory mismatch; missing={missing}, unknown={unknown}"
        )

    for name, recorded_digest in recorded.items():
        actual_digest = file_sha256(adapter_dir / name)
        if recorded_digest != actual_digest:
            raise ReleaseContractError(f"{CHECKSUM_FILE} hash mismatch: {name}")


def validate_platform_authorization(
    contract: dict[str, Any],
    *,
    manifest: dict[str, Any] | None = None,
    expected_parent_commit: str | None = None,
    adapter_model_sha256: str | None = None,
    adapter_config_sha256: str | None = None,
    training_manifest_sha256: str | None = None,
    evaluation_summary_sha256: str | None = None,
    bundle_payload_sha256: str | None = None,
    locked_suite_manifest_sha256: str | None = None,
    locked_suite_expected_cases: int | None = None,
    comparison_control_kind: str | None = None,
    comparison_control_repo_id: str | None = None,
    comparison_control_revision: str | None = None,
    comparison_control_artifact_sha256: str | None = None,
    comparison_report_sha256: str | None = None,
    quality_slice_report_sha256: str | None = None,
) -> None:
    if contract.get("schema_version") != "dime-platform-contract-v1":
        raise ReleaseContractError("Unsupported platform-contract schema.")
    if contract.get("status") != "release_authorized":
        raise ReleaseContractError("Platform status does not authorize adapter publication.")
    authorization = contract.get("authorization")
    if not isinstance(authorization, dict) or authorization.get("adapter_publication") is not True:
        raise ReleaseContractError("Platform contract explicitly blocks adapter publication.")
    if (
        authorization.get("full_training") is not False
        or authorization.get("locked_evaluation") is not False
        or authorization.get("serving") is not False
        or authorization.get("provider_activation") is not False
    ):
        raise ReleaseContractError(
            "Adapter publication requires an isolated release-only authorization stage."
        )
    if contract.get("github") != {
        "repository": CANONICAL_GITHUB_REPOSITORY,
        "project_path": "ml/dime-1.0",
    }:
        raise ReleaseContractError("Platform contract has the wrong GitHub identity.")
    if contract.get("base_model") != {
        "repo_type": "model",
        "repo_id": BASE_MODEL_ID,
        "revision": BASE_MODEL_REVISION,
    }:
        raise ReleaseContractError("Platform contract has the wrong base-model identity.")
    repositories = contract.get("hugging_face", {}).get("repositories", {})
    promoted = repositories.get("promoted_adapter", {})
    if promoted.get("repo_id") != CANONICAL_REPO_ID:
        raise ReleaseContractError("Platform contract has the wrong promoted-adapter repository.")
    if promoted.get("current_state") != "release_authorized":
        raise ReleaseContractError("Promoted-adapter repository is not release-authorized.")
    approved_release_revision = promoted.get("approved_release_revision")
    if approved_release_revision is not None:
        require_full_commit_sha(
            approved_release_revision,
            "promoted_adapter.approved_release_revision",
        )
    publication = contract.get("hugging_face", {}).get("adapter_publication")
    if publication != {
        "publisher_credential": "dime-release-publisher-v1",
        "post_upload_verifier_credential": "dime-serving-read-v1",
        "separate_token_values_required": True,
        "verification_revision": "returned_full_commit_sha",
    }:
        raise ReleaseContractError("Platform contract has the wrong publication roles.")
    model_repository = contract.get("model_repository", {})
    if set(model_repository.get("required_files", [])) != set(REQUIRED_FILES):
        raise ReleaseContractError("Platform contract required-file inventory is out of sync.")
    if set(model_repository.get("optional_files", [])) != set(OPTIONAL_FILES):
        raise ReleaseContractError("Platform contract optional-file inventory is out of sync.")
    if set(model_repository.get("remote_metadata_files", [])) != set(REMOTE_METADATA_FILES):
        raise ReleaseContractError("Platform contract remote metadata inventory is out of sync.")
    if manifest is None:
        return

    if approved_release_revision is None:
        expected_control = (
            "pinned_base_control",
            BASE_MODEL_ID,
            BASE_MODEL_REVISION,
        )
    else:
        expected_control = (
            "promoted_champion_adapter",
            CANONICAL_REPO_ID,
            approved_release_revision,
        )
        if expected_parent_commit != approved_release_revision:
            raise ReleaseContractError(
                "A subsequent release must use the current promoted champion as its parent."
            )
    if (
        comparison_control_kind,
        comparison_control_repo_id,
        comparison_control_revision,
    ) != expected_control:
        raise ReleaseContractError(
            "Release authorization does not bind the required immutable comparison control."
        )

    expected_candidate = {
        "experiment_id": manifest.get("experiment_id"),
        "source_github_commit": manifest.get("source", {}).get("github_commit"),
        "training_authorization_github_commit": manifest.get("training_authorization", {}).get(
            "github_commit"
        ),
        "training_platform_contract_sha256": manifest.get("training_platform_contract_sha256"),
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
    if authorization.get("release_candidate") != expected_candidate:
        raise ReleaseContractError(
            "Platform release authorization is not bound to this exact candidate."
        )


def validate_training_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("artifact_kind") != "peft_adapter":
        raise ReleaseContractError("training_manifest.json does not identify a PEFT adapter.")
    if manifest.get("run_mode") != "full":
        raise ReleaseContractError("Only an exact run_mode of 'full' is publishable.")
    if manifest.get("release_review_status") != "completed_unreviewed":
        raise ReleaseContractError(
            "Training manifest must preserve its immutable completed_unreviewed state."
        )
    if manifest.get("authorization_status") != "authorized_for_full_training":
        raise ReleaseContractError(
            "Training manifest does not preserve its full-training authorization."
        )
    experiment_id = require_non_placeholder(manifest.get("experiment_id"), "experiment_id")
    if not EXPERIMENT_ID.fullmatch(experiment_id):
        raise ReleaseContractError("experiment_id is not a valid immutable run identifier.")

    source = manifest.get("source")
    if not isinstance(source, dict):
        raise ReleaseContractError("Training manifest requires source provenance.")
    if source.get("github_repository") != CANONICAL_GITHUB_REPOSITORY:
        raise ReleaseContractError("Training manifest has the wrong GitHub repository.")
    source_commit = require_full_commit_sha(source.get("github_commit"), "source.github_commit")
    training_authorization = manifest.get("training_authorization")
    if not isinstance(training_authorization, dict):
        raise ReleaseContractError("Training manifest requires training-authorization provenance.")
    training_authorization_commit = require_full_commit_sha(
        training_authorization.get("github_commit"),
        "training_authorization.github_commit",
    )
    if training_authorization_commit == source_commit:
        raise ReleaseContractError("Training source and authorization commits must be distinct.")

    datasets = manifest.get("datasets")
    if not isinstance(datasets, dict):
        raise ReleaseContractError("Training manifest requires dataset provenance.")
    expected_repositories = {
        "foundation_sft": FOUNDATION_REPO_ID,
        "development_eval": DEVELOPMENT_EVAL_REPO_ID,
        "locked_eval": LOCKED_EVAL_REPO_ID,
    }
    for key, expected_repo in expected_repositories.items():
        details = datasets.get(key)
        if not isinstance(details, dict) or details.get("repo_id") != expected_repo:
            raise ReleaseContractError(f"Training manifest has invalid {key} provenance.")
    require_full_commit_sha(
        datasets["foundation_sft"].get("revision"),
        "datasets.foundation_sft.revision",
    )
    foundation_manifest_sha256 = require_sha256(
        datasets["foundation_sft"].get("dataset_manifest_sha256"),
        "datasets.foundation_sft.dataset_manifest_sha256",
    )
    foundation_checksums_sha256 = require_sha256(
        datasets["foundation_sft"].get("checksums_sha256"),
        "datasets.foundation_sft.checksums_sha256",
    )
    if foundation_manifest_sha256 != manifest.get("foundation_dataset_manifest_sha256"):
        raise ReleaseContractError(
            "Foundation dataset-manifest hash does not match training provenance."
        )
    if foundation_checksums_sha256 != manifest.get("foundation_checksums_sha256"):
        raise ReleaseContractError(
            "Foundation checksum-manifest hash does not match training provenance."
        )
    require_full_commit_sha(
        datasets["development_eval"].get("revision"),
        "datasets.development_eval.revision",
    )
    require_locked_reference(
        datasets["locked_eval"].get("revision_or_opaque_reference"),
        "datasets.locked_eval.revision_or_opaque_reference",
    )
    for field in PROVENANCE_HASH_FIELDS:
        require_sha256(manifest.get(field), f"training_manifest.{field}")
    require_sha256(
        manifest.get("training_platform_contract_sha256"),
        "training_manifest.training_platform_contract_sha256",
    )
    preflight = manifest.get("training_preflight")
    if not isinstance(preflight, dict):
        raise ReleaseContractError("Training manifest requires a derived training preflight.")
    if (
        preflight.get("minimum_validation_events") != 6
        or not isinstance(preflight.get("expected_validation_events"), int)
        or preflight["expected_validation_events"] < 6
        or preflight.get("evaluation_and_checkpoint_cadence_aligned") is not True
        or preflight.get("best_checkpoint_restoration_verification_required") is not True
        or preflight.get("eval_steps") != preflight.get("save_steps")
    ):
        raise ReleaseContractError(
            "Training manifest does not prove an operable early-stopping schedule."
        )
    early_stopping = manifest.get("early_stopping")
    if not isinstance(early_stopping, dict):
        raise ReleaseContractError("Training manifest requires early-stopping evidence.")
    if early_stopping.get("best_checkpoint_restoration_verified") is not True:
        raise ReleaseContractError("Training manifest does not verify best-checkpoint restoration.")
    if (
        not isinstance(early_stopping.get("best_metric"), (int, float))
        or isinstance(early_stopping.get("best_metric"), bool)
        or not math.isfinite(float(early_stopping["best_metric"]))
    ):
        raise ReleaseContractError("Training manifest best_metric must be finite.")
    for field in (
        "checkpoint_payload_sha256",
        "checkpoint_manifest_sha256",
        "checkpoint_adapter_sha256",
        "staged_adapter_sha256",
    ):
        require_sha256(
            early_stopping.get(field),
            f"training_manifest.early_stopping.{field}",
        )
    if early_stopping["checkpoint_adapter_sha256"] != early_stopping["staged_adapter_sha256"]:
        raise ReleaseContractError(
            "Training manifest staged adapter does not match the best checkpoint."
        )


def validate_evaluation_report(
    evaluation: dict[str, Any],
    manifest: dict[str, Any],
    candidate_hashes: dict[str, str],
    locked_suite_manifest_sha256: str,
    locked_suite_expected_cases: int,
    approved_release_revision: str | None,
) -> None:
    """Validate the sanitized aggregate exported by the isolated evaluator."""
    if "results" in evaluation or "case_ids" in evaluation:
        raise ReleaseContractError(
            "Release evaluation summary must not contain case-level locked evidence."
        )
    schema = json.loads(RELEASE_EVALUATION_SCHEMA.read_text(encoding="utf-8"))
    errors = sorted(
        Draft202012Validator(schema).iter_errors(evaluation),
        key=lambda error: [str(part) for part in error.absolute_path],
    )
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.absolute_path) or "<root>"
        raise ReleaseContractError(
            f"Release evaluation summary schema failed at {location}: {first.message}"
        )
    if evaluation.get("report_version") != "dime-release-evaluation-summary-v1":
        raise ReleaseContractError("Unsupported release-evaluation summary schema.")
    summary = evaluation.get("summary")
    inputs = evaluation.get("inputs")
    if not isinstance(summary, dict) or not isinstance(inputs, dict):
        raise ReleaseContractError("Evaluation summary is missing summary or inputs.")
    require_evaluator_run_id(
        evaluation.get("evaluator_run_id"),
        "evaluation.evaluator_run_id",
    )
    locked_suite = evaluation.get("locked_suite")
    manifest_locked = manifest.get("datasets", {}).get("locked_eval")
    if not isinstance(locked_suite, dict) or not isinstance(manifest_locked, dict):
        raise ReleaseContractError("Evaluation summary is missing locked-suite provenance.")
    if {
        "repo_id": locked_suite.get("repo_id"),
        "revision_or_opaque_reference": locked_suite.get("revision_or_opaque_reference"),
    } != manifest_locked:
        raise ReleaseContractError(
            "Evaluation summary locked-suite provenance does not match training."
        )
    require_locked_reference(
        locked_suite.get("revision_or_opaque_reference"),
        "evaluation.locked_suite.revision_or_opaque_reference",
    )
    require_sha256(
        locked_suite_manifest_sha256,
        "authorized locked-suite manifest SHA-256",
    )
    if locked_suite.get("manifest_sha256") != locked_suite_manifest_sha256:
        raise ReleaseContractError(
            "Evaluation summary locked-suite manifest does not match authorization."
        )
    if (
        not isinstance(locked_suite_expected_cases, int)
        or isinstance(locked_suite_expected_cases, bool)
        or locked_suite_expected_cases < 1
        or locked_suite.get("expected_cases") != locked_suite_expected_cases
    ):
        raise ReleaseContractError(
            "Evaluation summary locked-suite case count does not match authorization."
        )
    comparison = evaluation.get("comparison")
    quality = evaluation.get("quality")
    if not isinstance(comparison, dict) or not isinstance(quality, dict):
        raise ReleaseContractError("Evaluation summary is missing comparison or quality evidence.")
    control = comparison.get("control")
    if not isinstance(control, dict):
        raise ReleaseContractError("Evaluation comparison is missing its immutable control.")
    control_revision = require_full_commit_sha(
        control.get("revision"),
        "evaluation.comparison.control.revision",
    )
    if approved_release_revision is None:
        expected_control = (
            "pinned_base_control",
            BASE_MODEL_ID,
            BASE_MODEL_REVISION,
        )
    else:
        approved_release_revision = require_full_commit_sha(
            approved_release_revision,
            "promoted_adapter.approved_release_revision",
        )
        expected_control = (
            "promoted_champion_adapter",
            CANONICAL_REPO_ID,
            approved_release_revision,
        )
    if (
        control.get("kind"),
        control.get("repo_id"),
        control_revision,
    ) != expected_control:
        raise ReleaseContractError(
            "Evaluation comparison does not use the required immutable control."
        )
    require_sha256(
        control.get("artifact_sha256"),
        "evaluation.comparison.control.artifact_sha256",
    )
    require_sha256(
        comparison.get("control_report_sha256"),
        "evaluation.comparison.control_report_sha256",
    )
    require_sha256(
        comparison.get("comparison_report_sha256"),
        "evaluation.comparison.comparison_report_sha256",
    )
    quality_metrics = quality.get("metrics")
    if not isinstance(quality_metrics, dict) or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
        for value in quality_metrics.values()
    ):
        raise ReleaseContractError("Evaluation quality metrics must be finite numbers.")
    slice_regression = quality.get("max_important_slice_regression_percentage_points")
    if (
        isinstance(slice_regression, bool)
        or not isinstance(slice_regression, (int, float))
        or not math.isfinite(slice_regression)
    ):
        raise ReleaseContractError("Evaluation slice regression must be finite.")
    require_sha256(
        quality.get("slice_report_sha256"),
        "evaluation.quality.slice_report_sha256",
    )
    if inputs.get("experiment_id") != manifest.get("experiment_id"):
        raise ReleaseContractError("Evaluation summary experiment ID does not match the candidate.")
    expected_candidate = {
        "adapter_model_sha256": candidate_hashes.get("adapter_model_sha256"),
        "adapter_config_sha256": candidate_hashes.get("adapter_config_sha256"),
        "training_manifest_sha256": candidate_hashes.get("training_manifest_sha256"),
        "parent_model_id": BASE_MODEL_ID,
        "parent_model_revision": BASE_MODEL_REVISION,
        "source_github_commit": manifest.get("source", {}).get("github_commit"),
        "training_authorization_github_commit": manifest.get("training_authorization", {}).get(
            "github_commit"
        ),
        "config_sha256": manifest.get("config_sha256"),
        "chat_template_sha256": manifest.get("chat_template_sha256"),
        "tool_catalog_sha256": manifest.get("tool_catalog_sha256"),
        "decoding_config_sha256": manifest.get("decoding_config_sha256"),
    }
    if inputs.get("candidate") != expected_candidate:
        raise ReleaseContractError("Evaluation summary is not bound to this exact candidate.")
    require_sha256(
        inputs.get("restricted_report_sha256"),
        "evaluation.inputs.restricted_report_sha256",
    )

    if summary.get("release_gate_pass") is not True:
        raise ReleaseContractError("Evaluation summary does not pass release gates.")
    if summary.get("control_mode") is not False:
        raise ReleaseContractError("A control or unspecified evaluation cannot authorize release.")
    expected = summary.get("expected_cases")
    scored = summary.get("cases_scored")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
        raise ReleaseContractError("Evaluation expected_cases must be a positive integer.")
    if expected != locked_suite_expected_cases or scored != expected:
        raise ReleaseContractError("Evaluation does not have exact case coverage.")
    paired_cases = comparison.get("paired_cases")
    candidate_wins = comparison.get("candidate_wins")
    ties = comparison.get("ties")
    control_wins = comparison.get("control_wins")
    comparison_counts = (paired_cases, candidate_wins, ties, control_wins)
    if (
        any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0
            for value in comparison_counts
        )
        or paired_cases != expected
        or candidate_wins + ties + control_wins != paired_cases
    ):
        raise ReleaseContractError("Evaluation comparison does not cover the exact locked suite.")
    decision = comparison.get("decision")
    if decision == "candidate_better" and candidate_wins <= control_wins:
        raise ReleaseContractError("Candidate-better decision is inconsistent with paired wins.")
    if decision == "statistical_tie" and candidate_wins < control_wins:
        raise ReleaseContractError("Statistical-tie decision would regress against the control.")
    for field in ("deterministic_passes", "case_passes", "json_serializable_passes"):
        if summary.get(field) != expected:
            raise ReleaseContractError(f"Evaluation summary is not all-pass: {field}")
    for field in ("missing_cases", "unknown_cases", "duplicate_traces", "critical_failures"):
        if summary.get(field) != 0:
            raise ReleaseContractError(f"Evaluation summary contains nonzero {field}.")

    requiring_human = summary.get("cases_requiring_human_review")
    human_passes = summary.get("human_review_passes")
    if (
        not isinstance(requiring_human, int)
        or isinstance(requiring_human, bool)
        or requiring_human < 0
        or human_passes != requiring_human
    ):
        raise ReleaseContractError("Evaluation human-review count is invalid.")
    if requiring_human:
        require_sha256(
            inputs.get("human_reviews_sha256"),
            "evaluation.inputs.human_reviews_sha256",
        )


def validate_attestation(
    attestation: dict[str, Any],
    manifest: dict[str, Any],
    expected_parent_commit: str,
    platform_contract_sha256: str,
    authorization_github_commit: str,
    expected_hashes: dict[str, str],
    evaluator_run_id: str,
) -> None:
    if attestation.get("schema_version") != "dime-release-attestation-v1":
        raise ReleaseContractError("Unsupported release-attestation schema.")
    if attestation.get("release_review_status") != "approved_for_release_review":
        raise ReleaseContractError("Release attestation has the wrong review status.")
    if attestation.get("private_registry_publication_approved") is not True:
        raise ReleaseContractError("Private registry publication has not been approved.")
    if attestation.get("approved_for_serving") is not True:
        raise ReleaseContractError("Adapter has not been approved for serving.")
    if attestation.get("repo_id") != CANONICAL_REPO_ID:
        raise ReleaseContractError("Release attestation is bound to a different repository.")
    if attestation.get("repo_type") != "model":
        raise ReleaseContractError("Release attestation must identify a model repository.")
    if attestation.get("base_model") != {
        "repo_id": BASE_MODEL_ID,
        "revision": BASE_MODEL_REVISION,
    }:
        raise ReleaseContractError("Release attestation has the wrong base-model identity.")
    if (
        require_full_commit_sha(
            attestation.get("expected_parent_commit"),
            "attestation.expected_parent_commit",
        )
        != expected_parent_commit
    ):
        raise ReleaseContractError("Release attestation parent commit does not match the command.")
    if attestation.get("experiment_id") != manifest.get("experiment_id"):
        raise ReleaseContractError("Release attestation experiment ID does not match training.")
    if attestation.get("evaluator_run_id") != evaluator_run_id:
        raise ReleaseContractError(
            "Release attestation evaluator run does not match the evaluation summary."
        )
    require_non_placeholder(attestation.get("approver"), "attestation.approver")

    source = attestation.get("source")
    if (
        not isinstance(source, dict)
        or source.get("github_repository") != CANONICAL_GITHUB_REPOSITORY
    ):
        raise ReleaseContractError("Release attestation has invalid source provenance.")
    if source.get("github_commit") != manifest.get("source", {}).get("github_commit"):
        raise ReleaseContractError("Release attestation Git commit does not match training.")
    if (
        require_full_commit_sha(
            source.get("authorization_github_commit"),
            "attestation.source.authorization_github_commit",
        )
        != authorization_github_commit
    ):
        raise ReleaseContractError(
            "Release attestation is not bound to the reviewed authorization commit."
        )
    if authorization_github_commit == manifest.get("training_authorization", {}).get(
        "github_commit"
    ):
        raise ReleaseContractError(
            "Release authorization must be distinct from training authorization."
        )
    if require_full_commit_sha(
        source.get("training_authorization_github_commit"),
        "attestation.source.training_authorization_github_commit",
    ) != manifest.get("training_authorization", {}).get("github_commit"):
        raise ReleaseContractError(
            "Release attestation training-authorization commit does not match training."
        )
    if source.get("platform_contract_sha256") != platform_contract_sha256:
        raise ReleaseContractError("Release attestation platform-contract hash does not match.")
    if attestation.get("datasets") != manifest.get("datasets"):
        raise ReleaseContractError(
            "Release attestation dataset provenance does not match training."
        )

    provenance_hashes = attestation.get("provenance_hashes")
    if not isinstance(provenance_hashes, dict):
        raise ReleaseContractError("Release attestation requires provenance hashes.")
    for field in PROVENANCE_HASH_FIELDS:
        if provenance_hashes.get(field) != manifest.get(field):
            raise ReleaseContractError(f"Release provenance hash mismatch: {field}")
    for field, expected in expected_hashes.items():
        require_sha256(attestation.get(field), f"attestation.{field}")
        if attestation.get(field) != expected:
            raise ReleaseContractError(f"Release attestation hash mismatch: {field}")

    approval_fields = {
        "platform_publication_authorized",
        "provenance_reviewed",
        "release_contract_reviewed",
        "evaluation_complete",
        "base_model_license_reviewed",
        "adapter_license_reviewed",
        "code_license_reviewed",
        "dataset_rights_reviewed",
        "evaluation_rights_reviewed",
        "feed_rights_reviewed",
        "privacy_reviewed",
        "responsible_gaming_reviewed",
        "security_reviewed",
        "locked_evaluation_reviewed",
        "serving_reviewed",
    }
    approvals = attestation.get("approvals")
    if not isinstance(approvals, dict):
        raise ReleaseContractError("Release attestation requires approvals.")
    missing = sorted(field for field in approval_fields if approvals.get(field) is not True)
    if missing:
        raise ReleaseContractError(f"Release approvals incomplete: {missing}")


def validate_remote_inventory(
    remote_files: set[str],
    local_files: set[str],
) -> tuple[set[str], set[str]]:
    allowed_remote = REQUIRED_FILES | OPTIONAL_FILES | REMOTE_METADATA_FILES
    unknown = remote_files - allowed_remote
    if unknown:
        raise ReleaseContractError(
            f"Remote repository contains prohibited files: {sorted(unknown)}"
        )
    stale_release_files = (remote_files - REMOTE_METADATA_FILES) - local_files
    expected_after_upload = local_files | REMOTE_METADATA_FILES
    return stale_release_files, expected_after_upload
