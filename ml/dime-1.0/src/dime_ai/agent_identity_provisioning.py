"""Prepare inactive, public-only Foundation AI reviewer profile candidates."""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import os
import re
import stat
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from jsonschema import Draft202012Validator, FormatChecker

from dime_ai.canonical_json import canonical_json_bytes

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROVISIONING_INPUT_NAME = "provisioning.json"
PROVISIONING_INPUT_SCHEMA = "schemas/foundation_ai_reviewer_provisioning_input.schema.json"
REVIEWER_REGISTRY_PATH = "configs/foundation_reviewer_registry.json"
REVIEWER_REGISTRY_SCHEMA = "schemas/foundation_reviewer_registry.schema.json"
PLATFORM_CONTRACT_PATH = "configs/platform_contract.json"
PROVISIONING_CHALLENGE_DOMAIN = b"DIME-AI-REVIEWER-PROVISIONING-V1\x00"
MAX_INPUT_BYTES = 1024 * 1024
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_ERROR_LENGTH = 2048
REGISTRY_VERSION = re.compile(
    r"^dime-foundation-reviewers-v(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)$"
)


class AgentIdentityProvisioningError(ValueError):
    """Raised when public reviewer provisioning inputs are unsafe or inconsistent."""

    def __init__(self, message: str) -> None:
        bounded = message
        if len(bounded) > MAX_ERROR_LENGTH:
            bounded = bounded[: MAX_ERROR_LENGTH - 3] + "..."
        super().__init__(bounded)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _public_artifact_sha256(value: bytes, *, label: str) -> str:
    try:
        text = value.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise AgentIdentityProvisioningError(f"{label}: invalid UTF-8") from exc
    if "\x00" in text:
        raise AgentIdentityProvisioningError(f"{label}: NUL bytes are prohibited")
    pem_boundary = "-" * 5
    prohibited_markers = tuple(
        f"{pem_boundary}BEGIN {key_kind}{pem_boundary}"
        for key_kind in (
            "PRIVATE KEY",
            "OPENSSH PRIVATE KEY",
            "RSA PRIVATE KEY",
            "EC PRIVATE KEY",
        )
    )
    if any(marker in text for marker in prohibited_markers):
        raise AgentIdentityProvisioningError(f"{label}: private-key material is prohibited")
    return sha256_bytes(value)


def _real_directory(path: str | Path, *, label: str) -> Path:
    candidate = Path(path).absolute()
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise AgentIdentityProvisioningError(f"{label}: missing directory") from exc
    if candidate != resolved or candidate.is_symlink() or not candidate.is_dir():
        raise AgentIdentityProvisioningError(f"{label}: expected a real, non-symlink directory")
    return candidate


def _safe_relative_path(value: str, *, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise AgentIdentityProvisioningError(
            f"{label}: expected a nonempty repository-relative path"
        )
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise AgentIdentityProvisioningError(f"{label}: unsafe path segments are prohibited")
    relative = PurePosixPath(value)
    if relative.is_absolute():
        raise AgentIdentityProvisioningError(f"{label}: absolute paths are prohibited")
    return relative


def _read_regular_file(
    root: Path,
    relative_path: str,
    *,
    label: str,
    maximum_bytes: int,
) -> bytes:
    relative = _safe_relative_path(relative_path, label=label)
    required_flags = ("O_CLOEXEC", "O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK")
    if any(not hasattr(os, flag) for flag in required_flags) or os.open not in os.supports_dir_fd:
        raise AgentIdentityProvisioningError(
            f"{label}: secure descriptor-based file access is unavailable"
        )

    common_flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
    directory_flags = common_flags | os.O_DIRECTORY
    file_flags = common_flags | os.O_NONBLOCK
    descriptors: list[int] = []
    try:
        root_fd = os.open(root, directory_flags)
        descriptors.append(root_fd)
        directory_fd = root_fd
        for part in relative.parts[:-1]:
            directory_fd = os.open(part, directory_flags, dir_fd=directory_fd)
            descriptors.append(directory_fd)
            if not stat.S_ISDIR(os.fstat(directory_fd).st_mode):
                raise AgentIdentityProvisioningError(
                    f"{label}: path components must be real directories"
                )
        file_fd = os.open(relative.parts[-1], file_flags, dir_fd=directory_fd)
        descriptors.append(file_fd)
        file_stat = os.fstat(file_fd)
        if not stat.S_ISREG(file_stat.st_mode):
            raise AgentIdentityProvisioningError(f"{label}: expected a regular file")
        if file_stat.st_size <= 0 or file_stat.st_size > maximum_bytes:
            raise AgentIdentityProvisioningError(f"{label}: file size is outside the allowed range")
        chunks: list[bytes] = []
        total = 0
        while chunk := os.read(file_fd, min(1024 * 1024, maximum_bytes + 1 - total)):
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum_bytes:
                raise AgentIdentityProvisioningError(
                    f"{label}: file size is outside the allowed range"
                )
        return b"".join(chunks)
    except AgentIdentityProvisioningError:
        raise
    except OSError as exc:
        raise AgentIdentityProvisioningError(f"{label}: could not safely read file") from exc
    finally:
        for descriptor in reversed(descriptors):
            try:
                os.close(descriptor)
            except OSError:
                pass


def _strict_json(value: bytes, *, label: str) -> dict[str, Any]:
    try:
        text = value.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise AgentIdentityProvisioningError(f"{label}: invalid UTF-8") from exc

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        document: dict[str, Any] = {}
        for key, item in pairs:
            if key in document:
                raise AgentIdentityProvisioningError(f"{label}: duplicate JSON key")
            document[key] = item
        return document

    try:
        parsed = json.loads(
            text,
            object_pairs_hook=object_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(
                AgentIdentityProvisioningError(f"{label}: non-finite JSON number")
            ),
        )
    except AgentIdentityProvisioningError:
        raise
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise AgentIdentityProvisioningError(f"{label}: invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise AgentIdentityProvisioningError(f"{label}: expected a JSON object")
    return parsed


def _validate(document: dict[str, Any], schema: dict[str, Any], *, label: str) -> None:
    try:
        Draft202012Validator.check_schema(schema)
        errors = sorted(
            Draft202012Validator(
                schema,
                format_checker=FormatChecker(),
            ).iter_errors(document),
            key=lambda error: tuple(str(part) for part in error.absolute_path),
        )
    except Exception as exc:
        raise AgentIdentityProvisioningError(f"{label}: schema validation failed") from exc
    if errors:
        path = ".".join(str(part) for part in errors[0].absolute_path) or "<root>"
        raise AgentIdentityProvisioningError(f"{label}: invalid field at {path}")


def _decode_base64(value: Any, *, expected_length: int, label: str) -> bytes:
    if not isinstance(value, str):
        raise AgentIdentityProvisioningError(f"{label}: expected canonical Base64")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise AgentIdentityProvisioningError(f"{label}: expected canonical Base64") from exc
    if len(decoded) != expected_length or base64.b64encode(decoded).decode("ascii") != value:
        raise AgentIdentityProvisioningError(f"{label}: invalid encoding or length")
    return decoded


def _version_tuple(value: Any, *, label: str) -> tuple[int, int, int]:
    match = REGISTRY_VERSION.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise AgentIdentityProvisioningError(f"{label}: invalid registry version")
    return tuple(int(match.group(part)) for part in ("major", "minor", "patch"))


def _utc_timestamp(value: Any, *, label: str) -> datetime:
    if not isinstance(value, str):
        raise AgentIdentityProvisioningError(f"{label}: expected a UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AgentIdentityProvisioningError(f"{label}: expected a UTC timestamp") from exc
    if parsed.tzinfo != UTC:
        raise AgentIdentityProvisioningError(f"{label}: expected a UTC timestamp")
    return parsed


def _require_blocked_platform_contract(platform_contract: dict[str, Any]) -> None:
    expected_authorization = {
        "full_training": False,
        "locked_evaluation": False,
        "adapter_publication": False,
        "serving": False,
        "provider_activation": False,
        "training_candidate": None,
        "release_candidate": None,
    }
    owner_decision = platform_contract.get("foundation_v1_owner_decision")
    reviewer_authority = (
        owner_decision.get("reviewer_authority") if isinstance(owner_decision, dict) else None
    )
    authorization_effect = (
        owner_decision.get("authorization_effect") if isinstance(owner_decision, dict) else None
    )
    if (
        platform_contract.get("status") != "foundation_only"
        or platform_contract.get("authorization") != expected_authorization
        or not isinstance(reviewer_authority, dict)
        or reviewer_authority.get("activation_authorized") is not False
        or reviewer_authority.get("ai_agent_activation_authorized") is not False
        or not isinstance(authorization_effect, dict)
        or not authorization_effect
        or any(value is not False for value in authorization_effect.values())
    ):
        raise AgentIdentityProvisioningError(
            "platform contract: authorization gates must remain fully blocked"
        )


def provisioning_challenge_bytes(
    *,
    reviewer_id: str,
    source_registry_sha256: str,
    target_registry_version: str,
    profile: dict[str, Any],
) -> bytes:
    """Return the exact bytes an external non-exportable signer must sign."""

    payload = {
        "schema_version": "dime-ai-reviewer-provisioning-challenge-v1",
        "reviewer_id": reviewer_id,
        "source_registry_sha256": source_registry_sha256,
        "target_registry_version": target_registry_version,
        "agent_profile": profile,
    }
    return PROVISIONING_CHALLENGE_DOMAIN + canonical_json_bytes(payload)


def _profile_and_public_key_from_spec(
    bundle_root: Path,
    specification: dict[str, Any],
) -> tuple[dict[str, Any], bytes]:
    artifact_fields = {
        "system_instruction_sha256": "system_instruction_path",
        "tool_contract_sha256": "tool_contract_path",
        "inference_policy_sha256": "inference_policy_path",
        "conflict_policy_sha256": "conflict_policy_path",
        "recusal_policy_sha256": "recusal_policy_path",
    }
    digests = {
        output_field: _public_artifact_sha256(
            _read_regular_file(
                bundle_root,
                specification[input_field],
                label=input_field,
                maximum_bytes=MAX_ARTIFACT_BYTES,
            ),
            label=input_field,
        )
        for output_field, input_field in artifact_fields.items()
    }
    key = copy.deepcopy(specification["receipt_verification_key"])
    public_key = _decode_base64(
        key["public_key_base64"],
        expected_length=32,
        label="receipt verification key",
    )
    public_key_sha256 = sha256_bytes(public_key)
    if key["public_key_sha256"] != public_key_sha256:
        raise AgentIdentityProvisioningError("receipt verification key: digest mismatch")
    valid_from = _utc_timestamp(
        key["valid_from_utc"],
        label="receipt verification key valid_from_utc",
    )
    valid_until_value = key["valid_until_or_open_ended"]
    if valid_until_value is not None:
        valid_until = _utc_timestamp(
            valid_until_value,
            label="receipt verification key valid_until_or_open_ended",
        )
        if valid_until <= valid_from:
            raise AgentIdentityProvisioningError(
                "receipt verification key: validity end must be after validity start"
            )
        if valid_until <= datetime.now(UTC):
            raise AgentIdentityProvisioningError(
                "receipt verification key: validity window is already expired"
            )

    profile = {
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
        "receipt_issuer_key_id": f"key-{public_key_sha256}",
        "receipt_verification_key": key,
    }
    return profile, public_key


def _verify_possession_proof(
    specification: dict[str, Any],
    *,
    source_registry_sha256: str,
    target_registry_version: str,
    profile: dict[str, Any],
    public_key: bytes,
) -> None:
    signature = _decode_base64(
        specification["possession_proof_signature_base64"],
        expected_length=64,
        label="possession proof",
    )
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(
            signature,
            provisioning_challenge_bytes(
                reviewer_id=specification["reviewer_id"],
                source_registry_sha256=source_registry_sha256,
                target_registry_version=target_registry_version,
                profile=profile,
            ),
        )
    except (InvalidSignature, ValueError) as exc:
        raise AgentIdentityProvisioningError(
            "possession proof: signature verification failed"
        ) from exc


def _require_independent_profiles(profiles: list[dict[str, Any]]) -> None:
    unique_fields = (
        "model_lineage_id",
        "policy_lineage_id",
        "workload_identity_id",
        "receipt_issuer_key_id",
    )
    for field in unique_fields:
        if len({profile[field] for profile in profiles}) != len(profiles):
            raise AgentIdentityProvisioningError(
                f"reviewer profiles must use distinct {field} values"
            )
    model_stacks = {(profile["model_provider"], profile["model_id"]) for profile in profiles}
    if len(model_stacks) != len(profiles):
        raise AgentIdentityProvisioningError(
            "reviewer profiles must use materially distinct model stacks"
        )
    policy_stacks = {
        (
            profile["system_instruction_sha256"],
            profile["inference_policy_sha256"],
            profile["conflict_policy_sha256"],
            profile["recusal_policy_sha256"],
        )
        for profile in profiles
    }
    if len(policy_stacks) != len(profiles):
        raise AgentIdentityProvisioningError(
            "reviewer profiles must use materially distinct policy stacks"
        )


def _load_provisioning_context(
    bundle_directory: str | Path,
    *,
    project_root: str | Path,
) -> tuple[Path, Path, dict[str, Any], dict[str, Any], dict[str, dict[str, Any]]]:
    project = _real_directory(project_root, label="project root")
    bundle = _real_directory(bundle_directory, label="provisioning bundle")
    if bundle == project or project in bundle.parents or bundle in project.parents:
        raise AgentIdentityProvisioningError(
            "provisioning bundle must not overlap the public Git worktree"
        )

    input_document = _strict_json(
        _read_regular_file(
            bundle,
            PROVISIONING_INPUT_NAME,
            label="provisioning input",
            maximum_bytes=MAX_INPUT_BYTES,
        ),
        label="provisioning input",
    )
    input_schema = _strict_json(
        _read_regular_file(
            project,
            PROVISIONING_INPUT_SCHEMA,
            label="provisioning input schema",
            maximum_bytes=MAX_INPUT_BYTES,
        ),
        label="provisioning input schema",
    )
    _validate(input_document, input_schema, label="provisioning input")
    platform_contract = _strict_json(
        _read_regular_file(
            project,
            PLATFORM_CONTRACT_PATH,
            label="platform contract",
            maximum_bytes=MAX_INPUT_BYTES,
        ),
        label="platform contract",
    )
    _require_blocked_platform_contract(platform_contract)

    source_registry_bytes = _read_regular_file(
        project,
        REVIEWER_REGISTRY_PATH,
        label="source reviewer registry",
        maximum_bytes=MAX_INPUT_BYTES,
    )
    if input_document["source_registry_sha256"] != sha256_bytes(source_registry_bytes):
        raise AgentIdentityProvisioningError("source reviewer registry: digest mismatch")
    source_registry = _strict_json(source_registry_bytes, label="source reviewer registry")
    if (
        source_registry.get("status") != "proposed"
        or source_registry.get("receipt_verifier", {}).get("activation_authorized") is not False
        or any(reviewer.get("active") for reviewer in source_registry.get("reviewers", []))
    ):
        raise AgentIdentityProvisioningError(
            "source reviewer registry must remain proposed and fully inactive"
        )

    current_version = _version_tuple(
        source_registry.get("registry_version"),
        label="source reviewer registry",
    )
    target_version = _version_tuple(
        input_document["target_registry_version"],
        label="target reviewer registry",
    )
    if target_version <= current_version:
        raise AgentIdentityProvisioningError(
            "target reviewer registry version must advance monotonically"
        )

    source_by_id = {
        reviewer["reviewer_id"]: reviewer
        for reviewer in source_registry["reviewers"]
        if reviewer.get("principal_type") == "ai_agent"
    }
    supplied_by_id = {
        specification["reviewer_id"]: specification for specification in input_document["reviewers"]
    }
    if len(supplied_by_id) != len(input_document["reviewers"]) or set(supplied_by_id) != set(
        source_by_id
    ):
        raise AgentIdentityProvisioningError(
            "provisioning input must cover each proposed AI reviewer exactly once"
        )
    return project, bundle, input_document, source_registry, source_by_id


def _build_profiles(
    bundle: Path,
    input_document: dict[str, Any],
    source_by_id: dict[str, dict[str, Any]],
    *,
    verify_possession: bool,
) -> dict[str, dict[str, Any]]:
    profiles: dict[str, dict[str, Any]] = {}
    for specification in input_document["reviewers"]:
        reviewer_id = specification["reviewer_id"]
        source_profile = source_by_id[reviewer_id].get("agent_profile")
        if not isinstance(source_profile, dict) or (
            specification["profile_id"] != source_profile.get("profile_id")
        ):
            raise AgentIdentityProvisioningError(
                "provisioning input profile does not match its stable reviewer assignment"
            )
        profile, public_key = _profile_and_public_key_from_spec(
            bundle,
            specification,
        )
        if verify_possession:
            _verify_possession_proof(
                specification,
                source_registry_sha256=input_document["source_registry_sha256"],
                target_registry_version=input_document["target_registry_version"],
                profile=profile,
                public_key=public_key,
            )
        profiles[reviewer_id] = profile
    _require_independent_profiles(list(profiles.values()))
    return profiles


def prepare_provisioning_challenges(
    bundle_directory: str | Path,
    *,
    project_root: str | Path = PROJECT_ROOT,
) -> dict[str, bytes]:
    """Build the exact public challenge bytes each bound external signer must sign."""

    _, bundle, input_document, _, source_by_id = _load_provisioning_context(
        bundle_directory,
        project_root=project_root,
    )
    profiles = _build_profiles(
        bundle,
        input_document,
        source_by_id,
        verify_possession=False,
    )
    return {
        reviewer_id: provisioning_challenge_bytes(
            reviewer_id=reviewer_id,
            source_registry_sha256=input_document["source_registry_sha256"],
            target_registry_version=input_document["target_registry_version"],
            profile=profile,
        )
        for reviewer_id, profile in profiles.items()
    }


def prepare_candidate_registry(
    bundle_directory: str | Path,
    *,
    project_root: str | Path = PROJECT_ROOT,
) -> dict[str, Any]:
    """Build a proposed, inactive registry candidate from public provisioning inputs."""

    project, bundle, input_document, source_registry, source_by_id = _load_provisioning_context(
        bundle_directory,
        project_root=project_root,
    )
    profiles = _build_profiles(
        bundle,
        input_document,
        source_by_id,
        verify_possession=True,
    )

    candidate = copy.deepcopy(source_registry)
    candidate["registry_version"] = input_document["target_registry_version"]
    candidate["status"] = "proposed"
    candidate["receipt_verifier"]["activation_authorized"] = False
    for reviewer in candidate["reviewers"]:
        reviewer["active"] = False
        if reviewer["reviewer_id"] in profiles:
            reviewer["agent_profile"] = profiles[reviewer["reviewer_id"]]

    registry_schema = _strict_json(
        _read_regular_file(
            project,
            REVIEWER_REGISTRY_SCHEMA,
            label="reviewer registry schema",
            maximum_bytes=MAX_INPUT_BYTES,
        ),
        label="reviewer registry schema",
    )
    _validate(candidate, registry_schema, label="candidate reviewer registry")
    return candidate


def _write_new_file(
    bundle: Path,
    *,
    output_name: str,
    value: bytes,
    label: str,
) -> Path:
    if "/" in output_name or "\\" in output_name or output_name in {"", ".", ".."}:
        raise AgentIdentityProvisioningError(f"{label}: expected a flat filename")
    root_fd: int | None = None
    file_fd: int | None = None
    try:
        root_fd = os.open(
            bundle,
            os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_DIRECTORY,
        )
        file_fd = os.open(
            output_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
            0o600,
            dir_fd=root_fd,
        )
        view = memoryview(value)
        while view:
            written = os.write(file_fd, view)
            if written <= 0:
                raise AgentIdentityProvisioningError(f"{label}: incomplete write")
            view = view[written:]
        os.fsync(file_fd)
    except FileExistsError as exc:
        raise AgentIdentityProvisioningError(f"{label}: file already exists") from exc
    except AgentIdentityProvisioningError:
        raise
    except OSError as exc:
        raise AgentIdentityProvisioningError(f"{label}: could not write safely") from exc
    finally:
        if file_fd is not None:
            try:
                os.close(file_fd)
            except OSError:
                pass
        if root_fd is not None:
            try:
                os.close(root_fd)
            except OSError:
                pass
    return bundle / output_name


def write_provisioning_challenges(
    bundle_directory: str | Path,
    *,
    project_root: str | Path = PROJECT_ROOT,
) -> dict[str, tuple[Path, str]]:
    """Write exact public signer challenges without requiring possession signatures."""

    bundle = _real_directory(bundle_directory, label="provisioning bundle")
    challenges = prepare_provisioning_challenges(bundle, project_root=project_root)
    outputs: dict[str, tuple[Path, str]] = {}
    for reviewer_id, challenge in challenges.items():
        output = _write_new_file(
            bundle,
            output_name=f"{reviewer_id}.challenge.bin",
            value=challenge,
            label="provisioning challenge output",
        )
        outputs[reviewer_id] = (output, sha256_bytes(challenge))
    return outputs


def write_candidate_registry(
    bundle_directory: str | Path,
    *,
    output_name: str = "candidate-reviewer-registry.json",
    project_root: str | Path = PROJECT_ROOT,
) -> tuple[Path, str]:
    """Write one deterministic candidate beside the private provisioning input."""

    bundle = _real_directory(bundle_directory, label="provisioning bundle")
    candidate = prepare_candidate_registry(bundle, project_root=project_root)
    candidate_bytes = canonical_json_bytes(candidate)
    output = _write_new_file(
        bundle,
        output_name=output_name,
        value=candidate_bytes,
        label="candidate output",
    )
    return output, sha256_bytes(candidate_bytes)
