"""Strict JSON parsing and deterministic scanning for governed repository artifacts."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

GOVERNED_DIRECTORY_ROOTS = (
    Path("configs"),
    Path("schemas"),
    Path("evidence"),
    Path("tools"),
    Path("data/templates"),
)
GOVERNED_STANDALONE_FILES = (Path("docs/RELEASE_ATTESTATION_TEMPLATE.json"),)
EXCLUDED_DIRECTORY_NAMES = frozenset(
    {
        ".git",
        ".pytest_cache",
        ".ruff_cache",
        ".uv-cache",
        ".venv",
        "__pycache__",
        "artifacts",
        "cache",
        "caches",
        "node_modules",
        "outputs",
        "runs",
        "runtime",
        "scratch",
        "tool-outputs",
    }
)


class GovernedJsonError(ValueError):
    """Raised when governed JSON cannot be discovered or parsed safely."""


class DuplicateJsonKeyError(GovernedJsonError):
    """Raised when one JSON object repeats a key."""


@dataclass(frozen=True)
class GovernedJsonIssue:
    """One deterministic governed-JSON validation failure."""

    path: str
    error: str

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "error": self.error}


@dataclass(frozen=True)
class GovernedJsonScanReport:
    """Sanitized result of scanning the closed governed-JSON inventory."""

    paths: tuple[str, ...]
    issues: tuple[GovernedJsonIssue, ...]

    @property
    def passed(self) -> bool:
        return not self.issues

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "dime-governed-json-scan-v1",
            "pass": self.passed,
            "file_count": len(self.paths),
            "issue_count": len(self.issues),
            "paths": list(self.paths),
            "issues": [issue.as_dict() for issue in self.issues],
        }


def _reject_nonfinite_numbers(value: Any, *, source: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise GovernedJsonError(f"{source}: non-finite JSON number")
    if isinstance(value, list):
        for item in value:
            _reject_nonfinite_numbers(item, source=source)
    elif isinstance(value, dict):
        for item in value.values():
            _reject_nonfinite_numbers(item, source=source)


def loads_governed_json(value: str | bytes, *, source: str = "<memory>") -> Any:
    """Parse standards-compliant JSON while rejecting duplicate object keys."""

    if isinstance(value, bytes):
        try:
            text = value.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise GovernedJsonError(f"{source}: invalid UTF-8") from exc
    elif isinstance(value, str):
        text = value
    else:
        raise TypeError("governed JSON input must be str or bytes")

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in pairs:
            if key in result:
                raise DuplicateJsonKeyError(f"{source}: duplicate JSON key {key!r}")
            result[key] = item
        return result

    def reject_constant(constant: str) -> None:
        raise GovernedJsonError(f"{source}: non-finite JSON number {constant!r}")

    try:
        parsed = json.loads(
            text,
            object_pairs_hook=object_pairs,
            parse_constant=reject_constant,
        )
    except GovernedJsonError:
        raise
    except json.JSONDecodeError as exc:
        raise GovernedJsonError(
            f"{source}: invalid JSON at line {exc.lineno}, column {exc.colno}"
        ) from exc
    _reject_nonfinite_numbers(parsed, source=source)
    return parsed


def load_governed_json(path: Path, *, source: str | None = None) -> Any:
    """Read and strictly parse one regular governed JSON file."""

    if path.is_symlink():
        raise GovernedJsonError(f"{path}: governed JSON cannot be a symlink")
    if not path.is_file():
        raise GovernedJsonError(f"{path}: governed JSON must be a regular file")
    try:
        value = path.read_bytes()
    except OSError as exc:
        raise GovernedJsonError(f"{path}: governed JSON could not be read") from exc
    return loads_governed_json(value, source=source or path.as_posix())


def _is_excluded(relative_path: Path) -> bool:
    return any(part in EXCLUDED_DIRECTORY_NAMES for part in relative_path.parts[:-1])


def governed_json_paths(project_root: Path) -> tuple[Path, ...]:
    """Return the deterministic closed inventory of governed JSON files."""

    try:
        root = project_root.resolve(strict=True)
    except OSError as exc:
        raise GovernedJsonError("governed JSON project root does not exist") from exc
    if not root.is_dir():
        raise GovernedJsonError("governed JSON project root must be a directory")

    paths: set[Path] = set()
    for relative_root in GOVERNED_DIRECTORY_ROOTS:
        scope = root / relative_root
        if scope.is_symlink() or not scope.is_dir():
            raise GovernedJsonError(
                f"governed JSON scope is missing or unsafe: {relative_root.as_posix()}"
            )
        for candidate in scope.rglob("*.json"):
            relative_path = candidate.relative_to(root)
            if _is_excluded(relative_path):
                continue
            if candidate.is_symlink():
                raise GovernedJsonError(
                    f"governed JSON inventory contains a symlink: {relative_path.as_posix()}"
                )
            if candidate.is_file():
                paths.add(candidate)

    for relative_path in GOVERNED_STANDALONE_FILES:
        candidate = root / relative_path
        if candidate.is_symlink() or not candidate.is_file():
            raise GovernedJsonError(
                f"governed JSON file is missing or unsafe: {relative_path.as_posix()}"
            )
        paths.add(candidate)

    if not paths:
        raise GovernedJsonError("governed JSON inventory is empty")
    return tuple(sorted(paths, key=lambda path: path.relative_to(root).as_posix()))


def scan_governed_json(project_root: Path) -> GovernedJsonScanReport:
    """Strictly parse every governed JSON file and return all failures in path order."""

    root = project_root.resolve(strict=True)
    paths = governed_json_paths(root)
    relative_paths = tuple(path.relative_to(root).as_posix() for path in paths)
    issues: list[GovernedJsonIssue] = []
    for path, relative_path in zip(paths, relative_paths, strict=True):
        try:
            load_governed_json(path, source=relative_path)
        except GovernedJsonError as exc:
            issues.append(GovernedJsonIssue(path=relative_path, error=str(exc)))
    return GovernedJsonScanReport(paths=relative_paths, issues=tuple(issues))
