"""Load and verify the public Dime platform-knowledge contract."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

PROJECT_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_PATH = Path("shared/dime/platform_knowledge_v1.json")
SCHEMA_PATH = Path("schemas/platform_knowledge.schema.json")


class PlatformKnowledgeError(ValueError):
    """Raised when platform knowledge is malformed or unsupported by repository evidence."""


@dataclass(frozen=True)
class LoadedPlatformKnowledge:
    document: dict[str, Any]
    sha256: str
    canonical_bytes: bytes


def _read_json(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise PlatformKnowledgeError(f"{label} must be a regular repository file")
    try:

        def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, item in pairs:
                if key in result:
                    raise PlatformKnowledgeError(f"{label} contains duplicate JSON key: {key}")
                result[key] = item
            return result

        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=strict_object,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PlatformKnowledgeError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise PlatformKnowledgeError(f"{label} must contain a JSON object")
    return value


def _repository_path(root: Path, raw_path: str) -> Path:
    relative = PurePosixPath(raw_path)
    if relative.is_absolute() or ".." in relative.parts or "\\" in raw_path:
        raise PlatformKnowledgeError(f"unsafe evidence path: {raw_path!r}")
    resolved = root.joinpath(*relative.parts)
    if resolved.is_symlink() or not resolved.is_file():
        raise PlatformKnowledgeError(f"evidence path is missing or not a regular file: {raw_path}")
    return resolved


def load_platform_knowledge(
    project_root: Path = PROJECT_ROOT,
    *,
    repository_root: Path | None = None,
) -> LoadedPlatformKnowledge:
    project = project_root.resolve(strict=True)
    repository = (
        repository_root.resolve(strict=True) if repository_root is not None else project.parents[1]
    )
    document = _read_json(repository / KNOWLEDGE_PATH, "platform knowledge")
    schema = _read_json(project / SCHEMA_PATH, "platform knowledge schema")

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(document), key=lambda error: list(error.path))
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.path) or "$"
        raise PlatformKnowledgeError(
            f"platform knowledge schema violation at {location}: {first.message}"
        )

    feature_ids: set[str] = set()
    for feature in document["features"]:
        feature_id = feature["id"]
        if feature_id in feature_ids:
            raise PlatformKnowledgeError(f"duplicate platform feature id: {feature_id}")
        feature_ids.add(feature_id)
        if feature["availability"] == "live" and feature["route"] is None:
            raise PlatformKnowledgeError(f"live feature {feature_id} requires a route")
        if feature["availability"] == "live" and feature["access_scope"] == "none":
            raise PlatformKnowledgeError(
                f"live feature {feature_id} requires a usable access scope"
            )
        if feature["availability"] == "not_available" and feature["route"] is not None:
            raise PlatformKnowledgeError(
                f"unavailable feature {feature_id} must not advertise a route"
            )
        for evidence_path in feature["evidence_paths"]:
            _repository_path(repository, evidence_path)

    canonical = (
        json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()
    return LoadedPlatformKnowledge(
        document=document,
        sha256=hashlib.sha256(canonical).hexdigest(),
        canonical_bytes=canonical,
    )


def render_platform_knowledge(loaded: LoadedPlatformKnowledge) -> str:
    """Render the governed catalog in the same closed-world shape used at runtime."""
    document = loaded.document
    lines = [
        (
            "DIME_PLATFORM_KNOWLEDGE "
            f"version={document['knowledge_version']} "
            f"sha256={loaded.sha256} "
            f"as_of_utc={document['as_of_utc']}"
        ),
        (
            "This is the closed-world source for Dime product and feature facts. "
            "It is trusted system policy, not user-supplied retrieval text."
        ),
        "Do not claim a feature, access level, account state, or integration that is absent below.",
    ]
    for feature in document["features"]:
        route = feature["route"] if feature["route"] is not None else "none"
        provided = (
            " | ".join(feature["provides"])
            if feature["provides"]
            else "Nothing currently available."
        )
        lines.extend(
            [
                (
                    f"- {feature['name']} [id={feature['id']}; "
                    f"availability={feature['availability']}; "
                    f"access={feature['access_scope']}; route={route}]"
                ),
                f"  Purpose: {feature['description']}",
                f"  Provides: {provided}",
                f"  Limits: {' | '.join(feature['limitations'])}",
            ]
        )
    lines.append("Platform answer rules:")
    lines.extend(f"- {rule}" for rule in document["global_rules"])
    return "\n".join(lines)
