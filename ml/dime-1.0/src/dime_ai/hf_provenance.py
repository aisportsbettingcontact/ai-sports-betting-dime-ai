"""Fail-closed Hugging Face provenance for private development evaluations."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from jsonschema import Draft202012Validator

from dime_ai.data_validation import (
    DataValidationError,
    strict_json_loads,
    validate_eval_case,
    validate_unique_ids,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "schemas/foundation_development_eval_identity.schema.json"
)
DEVELOPMENT_EVAL_REPO_ID = "taileredsports/dime-eval-development"
DEVELOPMENT_EVAL_REPO_TYPE = "dataset"
DEVELOPMENT_EVAL_MANIFEST_PATH = "evaluation_manifest.json"
DEVELOPMENT_EVAL_CASE_ROOT = "cases"
REQUIRED_REMOTE_FILES = frozenset({"README.md", DEVELOPMENT_EVAL_MANIFEST_PATH})


class DevelopmentEvalProvenanceError(ValueError):
    """Raised when development-evaluation remote provenance cannot be proven."""


@dataclass(frozen=True)
class RemoteDevelopmentEvalSnapshot:
    """Remote metadata and exact requested bytes resolved at one immutable revision."""

    repo_id: str
    resolved_revision: str
    private: bool
    inventory: frozenset[str]
    files: Mapping[str, bytes]


@dataclass(frozen=True)
class VerifiedDevelopmentEvaluation:
    """Development-evaluation bytes proven equal to one private Hub commit."""

    repo_id: str
    revision: str
    identity_sha256: str
    manifest_sha256: str
    case_files_sha256: str
    case_count: int
    manifest_bytes: bytes
    case_bytes: tuple[tuple[str, bytes], ...]
    records: tuple[dict[str, Any], ...]


class DevelopmentEvalRemote(Protocol):
    """Injectable boundary for reading a private immutable Hub revision."""

    def fetch(
        self,
        *,
        repo_id: str,
        repo_type: str,
        revision: str,
        requested_paths: frozenset[str],
        token: str,
    ) -> RemoteDevelopmentEvalSnapshot:
        """Return live repository metadata, inventory, and requested file bytes."""


class HuggingFaceDevelopmentEvalRemote:
    """Production adapter backed by authenticated Hugging Face Hub calls."""

    def fetch(
        self,
        *,
        repo_id: str,
        repo_type: str,
        revision: str,
        requested_paths: frozenset[str],
        token: str,
    ) -> RemoteDevelopmentEvalSnapshot:
        try:
            from huggingface_hub import HfApi

            api = HfApi(token=token)
            info = api.repo_info(
                repo_id=repo_id,
                repo_type=repo_type,
                revision=revision,
                files_metadata=False,
                token=token,
            )
            inventory = frozenset(
                api.list_repo_files(
                    repo_id=repo_id,
                    repo_type=repo_type,
                    revision=revision,
                    token=token,
                )
            )
            files: dict[str, bytes] = {}
            for repo_path in sorted(requested_paths):
                downloaded = api.hf_hub_download(
                    repo_id=repo_id,
                    repo_type=repo_type,
                    revision=revision,
                    filename=repo_path,
                    token=token,
                )
                files[repo_path] = Path(downloaded).read_bytes()
        except Exception as exc:  # noqa: BLE001 - normalize every remote/cache failure
            raise DevelopmentEvalProvenanceError(
                "Cannot verify the private development-evaluation Hugging Face revision."
            ) from exc

        return RemoteDevelopmentEvalSnapshot(
            repo_id=str(getattr(info, "id", "")),
            resolved_revision=str(getattr(info, "sha", "")),
            private=getattr(info, "private", None) is True,
            inventory=inventory,
            files=files,
        )


@cache
def _identity_validator() -> Draft202012Validator:
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
    except (OSError, ValueError) as exc:
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation identity schema is unavailable or invalid."
        ) from exc
    return Draft202012Validator(schema)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def case_inventory_sha256(case_files: Sequence[Mapping[str, Any]]) -> str:
    """Return the path-bound canonical digest used by identity v2."""

    return _sha256(_canonical_json_bytes(list(case_files)))


def _absolute_non_symlink_file(path: str | Path, label: str) -> Path:
    absolute = Path(path).absolute()
    current = Path(absolute.anchor)
    try:
        for part in absolute.parts[1:]:
            current /= part
            if current.is_symlink():
                raise DevelopmentEvalProvenanceError(
                    f"{label} contains a symlink component: {current}"
                )
        if not absolute.is_file():
            raise DevelopmentEvalProvenanceError(
                f"{label} must be a regular non-symlink file: {absolute}"
            )
    except OSError as exc:
        raise DevelopmentEvalProvenanceError(f"Cannot inspect {label}: {absolute}") from exc
    return absolute


def _read_bytes_once(path: str | Path, label: str) -> tuple[Path, bytes]:
    source = _absolute_non_symlink_file(path, label)
    try:
        return source, source.read_bytes()
    except OSError as exc:
        raise DevelopmentEvalProvenanceError(f"Cannot read {label}: {source}") from exc


def _load_identity(path: str | Path) -> tuple[dict[str, Any], bytes]:
    _, raw = _read_bytes_once(path, "development-evaluation identity")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation identity is not valid UTF-8."
        ) from exc
    try:
        identity = strict_json_loads(text, "development-evaluation identity")
    except (DataValidationError, json.JSONDecodeError) as exc:
        raise DevelopmentEvalProvenanceError(str(exc)) from exc
    if not isinstance(identity, dict):
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation identity must contain a JSON object."
        )
    errors = sorted(
        _identity_validator().iter_errors(identity),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        error = errors[0]
        location = ".".join(str(item) for item in error.absolute_path) or "$"
        raise DevelopmentEvalProvenanceError(
            f"Development-evaluation identity schema violation at {location}: {error.message}"
        )
    return identity, raw


def _validate_repo_case_path(value: str) -> str:
    if "\\" in value:
        raise DevelopmentEvalProvenanceError(
            f"Development-evaluation case path is not POSIX-relative: {value!r}"
        )
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or value != path.as_posix()
        or not path.parts
        or path.parts[0] != DEVELOPMENT_EVAL_CASE_ROOT
        or len(path.parts) < 2
        or any(part in {"", ".", ".."} for part in path.parts)
        or path.suffix != ".jsonl"
    ):
        raise DevelopmentEvalProvenanceError(f"Unsafe development-evaluation case path: {value!r}")
    return value


def _validate_identity_semantics(identity: Mapping[str, Any]) -> tuple[str, ...]:
    case_files = identity["case_files"]
    paths = tuple(_validate_repo_case_path(item["path"]) for item in case_files)
    if list(paths) != sorted(paths):
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation case inventory must be strictly sorted by path."
        )
    if len(paths) != len(set(paths)):
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation case inventory contains duplicate paths."
        )
    expected_inventory_digest = case_inventory_sha256(case_files)
    if identity["case_files_sha256"] != expected_inventory_digest:
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation case inventory digest mismatch."
        )
    expected_count = sum(item["record_count"] for item in case_files)
    if identity["case_count"] != expected_count:
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation identity case count does not equal its file counts."
        )
    return paths


def _relative_local_case_paths(
    evaluation_paths: Sequence[Path],
    *,
    local_root: Path,
) -> dict[str, bytes]:
    result: dict[str, bytes] = {}
    for index, path in enumerate(evaluation_paths):
        source, raw = _read_bytes_once(path, f"development-evaluation case file {index}")
        try:
            relative = source.relative_to(local_root)
        except ValueError as exc:
            raise DevelopmentEvalProvenanceError(
                f"Development-evaluation case file escapes the manifest root: {source}"
            ) from exc
        repo_path = PurePosixPath(*relative.parts).as_posix()
        _validate_repo_case_path(repo_path)
        if repo_path in result:
            raise DevelopmentEvalProvenanceError(
                f"Duplicate local development-evaluation case path: {repo_path}"
            )
        result[repo_path] = raw
    return result


def _parse_remote_manifest(raw: bytes) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DevelopmentEvalProvenanceError(
            "Remote development-evaluation manifest is not valid UTF-8."
        ) from exc
    try:
        manifest = strict_json_loads(text, "remote development-evaluation manifest")
    except (DataValidationError, json.JSONDecodeError) as exc:
        raise DevelopmentEvalProvenanceError(str(exc)) from exc
    if not isinstance(manifest, dict):
        raise DevelopmentEvalProvenanceError(
            "Remote development-evaluation manifest must contain a JSON object."
        )
    return manifest


def _parse_case_jsonl(repo_path: str, raw: bytes) -> list[dict[str, Any]]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DevelopmentEvalProvenanceError(
            f"Remote development-evaluation case is not valid UTF-8: {repo_path}"
        ) from exc

    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = strict_json_loads(line, f"{repo_path}:{line_number}")
        except (DataValidationError, json.JSONDecodeError) as exc:
            raise DevelopmentEvalProvenanceError(str(exc)) from exc
        if not isinstance(record, dict):
            raise DevelopmentEvalProvenanceError(
                f"{repo_path}:{line_number}: each line must be a JSON object."
            )
        try:
            validate_eval_case(record, production=True)
        except DataValidationError as exc:
            raise DevelopmentEvalProvenanceError(f"{repo_path}:{line_number}: {exc}") from exc
        records.append(record)
    if not records:
        raise DevelopmentEvalProvenanceError(
            f"Remote development-evaluation case file has no records: {repo_path}"
        )
    return records


def _normalize_remote_snapshot(
    snapshot: RemoteDevelopmentEvalSnapshot,
    *,
    revision: str,
    requested_paths: frozenset[str],
    declared_case_paths: frozenset[str],
) -> None:
    if snapshot.repo_id != DEVELOPMENT_EVAL_REPO_ID:
        raise DevelopmentEvalProvenanceError(
            "Hugging Face returned the wrong development-evaluation repository."
        )
    if snapshot.resolved_revision != revision:
        raise DevelopmentEvalProvenanceError(
            "Hugging Face did not resolve the exact authorized development-evaluation commit."
        )
    if snapshot.private is not True:
        raise DevelopmentEvalProvenanceError(
            "The development-evaluation Hugging Face repository must be private."
        )
    if any(not isinstance(path, str) for path in snapshot.inventory):
        raise DevelopmentEvalProvenanceError(
            "Hugging Face returned an invalid development-evaluation inventory."
        )
    missing_required = sorted(REQUIRED_REMOTE_FILES - snapshot.inventory)
    if missing_required:
        raise DevelopmentEvalProvenanceError(
            f"Remote development-evaluation repository is missing required files: "
            f"{missing_required}"
        )
    remote_case_paths = frozenset(
        path
        for path in snapshot.inventory
        if path.startswith(f"{DEVELOPMENT_EVAL_CASE_ROOT}/") and path.endswith(".jsonl")
    )
    if remote_case_paths != declared_case_paths:
        missing = sorted(declared_case_paths - remote_case_paths)
        extra = sorted(remote_case_paths - declared_case_paths)
        raise DevelopmentEvalProvenanceError(
            "Remote development-evaluation case inventory mismatch; "
            f"missing={missing}, extra={extra}"
        )
    if set(snapshot.files) != set(requested_paths):
        missing = sorted(requested_paths - set(snapshot.files))
        extra = sorted(set(snapshot.files) - requested_paths)
        raise DevelopmentEvalProvenanceError(
            "Remote development-evaluation byte inventory mismatch; "
            f"missing={missing}, extra={extra}"
        )
    if any(not isinstance(value, bytes) for value in snapshot.files.values()):
        raise DevelopmentEvalProvenanceError(
            "Remote development-evaluation adapter returned non-byte file content."
        )


def verify_development_evaluation_provenance(
    evaluation_paths: Sequence[Path],
    identity_path: Path,
    manifest_path: Path,
    *,
    token: str,
    remote: DevelopmentEvalRemote | None = None,
) -> VerifiedDevelopmentEvaluation:
    """Prove local development cases equal one exact private Hugging Face commit."""

    if not isinstance(token, str) or not token.strip():
        raise DevelopmentEvalProvenanceError(
            "An explicit Hugging Face token is required for development-evaluation provenance."
        )
    identity, identity_bytes = _load_identity(identity_path)
    declared_paths = _validate_identity_semantics(identity)
    declared_path_set = frozenset(declared_paths)

    local_manifest_path, local_manifest_bytes = _read_bytes_once(
        manifest_path,
        "development-evaluation manifest",
    )
    local_root = local_manifest_path.parent
    expected_manifest_path = (local_root / identity["manifest_path"]).absolute()
    if local_manifest_path != expected_manifest_path:
        raise DevelopmentEvalProvenanceError(
            "Local development-evaluation manifest path does not match the identity."
        )
    local_case_bytes = _relative_local_case_paths(evaluation_paths, local_root=local_root)
    if set(local_case_bytes) != set(declared_paths):
        missing = sorted(declared_path_set - set(local_case_bytes))
        extra = sorted(set(local_case_bytes) - declared_path_set)
        raise DevelopmentEvalProvenanceError(
            "Local development-evaluation case inventory mismatch; "
            f"missing={missing}, extra={extra}"
        )

    requested_paths = frozenset({identity["manifest_path"], *declared_paths})
    adapter = remote or HuggingFaceDevelopmentEvalRemote()
    try:
        snapshot = adapter.fetch(
            repo_id=identity["repo_id"],
            repo_type=identity["repo_type"],
            revision=identity["revision"],
            requested_paths=requested_paths,
            token=token,
        )
    except DevelopmentEvalProvenanceError:
        raise
    except Exception as exc:  # noqa: BLE001 - injected adapters must also fail closed
        raise DevelopmentEvalProvenanceError(
            "Cannot verify the private development-evaluation Hugging Face revision."
        ) from exc

    _normalize_remote_snapshot(
        snapshot,
        revision=identity["revision"],
        requested_paths=requested_paths,
        declared_case_paths=declared_path_set,
    )

    remote_manifest_bytes = snapshot.files[identity["manifest_path"]]
    if _sha256(remote_manifest_bytes) != identity["manifest_sha256"]:
        raise DevelopmentEvalProvenanceError(
            "Remote development-evaluation manifest hash does not match the identity."
        )
    if local_manifest_bytes != remote_manifest_bytes:
        raise DevelopmentEvalProvenanceError(
            "Local development-evaluation manifest differs from the exact remote revision."
        )
    _parse_remote_manifest(remote_manifest_bytes)

    all_records: list[dict[str, Any]] = []
    verified_case_bytes: list[tuple[str, bytes]] = []
    case_specs = {item["path"]: item for item in identity["case_files"]}
    for repo_path in declared_paths:
        specification = case_specs[repo_path]
        remote_bytes = snapshot.files[repo_path]
        local_bytes = local_case_bytes[repo_path]
        if _sha256(remote_bytes) != specification["sha256"]:
            raise DevelopmentEvalProvenanceError(
                f"Remote development-evaluation case hash mismatch: {repo_path}"
            )
        if local_bytes != remote_bytes:
            raise DevelopmentEvalProvenanceError(
                f"Local development-evaluation case differs from remote: {repo_path}"
            )
        records = _parse_case_jsonl(repo_path, remote_bytes)
        if len(records) != specification["record_count"]:
            raise DevelopmentEvalProvenanceError(
                f"Development-evaluation record count mismatch: {repo_path}"
            )
        verified_case_bytes.append((repo_path, remote_bytes))
        all_records.extend(records)

    if len(all_records) != identity["case_count"]:
        raise DevelopmentEvalProvenanceError(
            "Development-evaluation total record count does not match the identity."
        )
    try:
        validate_unique_ids(all_records, "case_id")
    except DataValidationError as exc:
        raise DevelopmentEvalProvenanceError(str(exc)) from exc

    return VerifiedDevelopmentEvaluation(
        repo_id=identity["repo_id"],
        revision=identity["revision"],
        identity_sha256=_sha256(identity_bytes),
        manifest_sha256=identity["manifest_sha256"],
        case_files_sha256=identity["case_files_sha256"],
        case_count=identity["case_count"],
        manifest_bytes=remote_manifest_bytes,
        case_bytes=tuple(verified_case_bytes),
        records=tuple(all_records),
    )
