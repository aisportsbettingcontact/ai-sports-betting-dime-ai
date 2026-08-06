from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from dime_ai.platform_knowledge import (
    PlatformKnowledgeError,
    load_platform_knowledge,
    render_platform_knowledge,
)

PROJECT = Path(__file__).resolve().parents[1]
REPOSITORY = PROJECT.parents[1]


def project_copy(tmp_path: Path) -> tuple[Path, Path]:
    repository = tmp_path / "repository"
    project = repository / "ml/dime-1.0"
    shutil.copytree(PROJECT / "configs", project / "configs")
    shutil.copytree(PROJECT / "schemas", project / "schemas")
    knowledge_source = REPOSITORY / "shared/dime/platform_knowledge_v1.json"
    knowledge_target = repository / "shared/dime/platform_knowledge_v1.json"
    knowledge_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(knowledge_source, knowledge_target)
    for feature_path in {
        path
        for feature in load_platform_knowledge().document["features"]
        for path in feature["evidence_paths"]
    }:
        source = REPOSITORY / feature_path
        target = repository / feature_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return project, repository


def write_knowledge(repository: Path, document: dict) -> None:
    (repository / "shared/dime/platform_knowledge_v1.json").write_text(
        json.dumps(document, indent=2) + "\n",
        encoding="utf-8",
    )


def test_platform_knowledge_is_deterministic_and_repository_evidenced() -> None:
    first = load_platform_knowledge()
    second = load_platform_knowledge()

    assert first.sha256 == second.sha256
    assert len(first.sha256) == 64
    assert first.canonical_bytes.endswith(b"\n")
    assert len(first.document["features"]) == 6
    assert {feature["id"] for feature in first.document["features"]} >= {
        "dime_chat",
        "model_projections",
        "betting_splits_odds_history",
        "bet_tracker",
    }
    rendered = render_platform_knowledge(first)
    assert f"sha256={first.sha256}" in rendered
    assert "access=authenticated" in rendered


def test_duplicate_feature_id_fails_closed(tmp_path: Path) -> None:
    project, repository = project_copy(tmp_path)
    document = load_platform_knowledge().document
    document = json.loads(json.dumps(document))
    document["features"].append(document["features"][0])
    write_knowledge(repository, document)

    with pytest.raises(PlatformKnowledgeError, match="duplicate platform feature id"):
        load_platform_knowledge(project, repository_root=repository)


def test_missing_evidence_path_fails_closed(tmp_path: Path) -> None:
    project, repository = project_copy(tmp_path)
    document = load_platform_knowledge().document
    document = json.loads(json.dumps(document))
    document["features"][0]["evidence_paths"] = ["server/does-not-exist.ts"]
    write_knowledge(repository, document)

    with pytest.raises(PlatformKnowledgeError, match="evidence path is missing"):
        load_platform_knowledge(project, repository_root=repository)


def test_unavailable_feature_cannot_advertise_a_route(tmp_path: Path) -> None:
    project, repository = project_copy(tmp_path)
    document = load_platform_knowledge().document
    document = json.loads(json.dumps(document))
    feature = next(item for item in document["features"] if item["availability"] == "not_available")
    feature["route"] = "/not-live"
    write_knowledge(repository, document)

    with pytest.raises(PlatformKnowledgeError, match="schema violation"):
        load_platform_knowledge(project, repository_root=repository)


def test_live_feature_cannot_use_an_empty_route(tmp_path: Path) -> None:
    project, repository = project_copy(tmp_path)
    document = json.loads(json.dumps(load_platform_knowledge().document))
    feature = next(item for item in document["features"] if item["availability"] == "live")
    feature["route"] = ""
    write_knowledge(repository, document)

    with pytest.raises(PlatformKnowledgeError, match="schema violation"):
        load_platform_knowledge(project, repository_root=repository)


def test_duplicate_json_keys_fail_closed(tmp_path: Path) -> None:
    project, repository = project_copy(tmp_path)
    knowledge_path = repository / "shared/dime/platform_knowledge_v1.json"
    knowledge_path.write_text(
        '{"schema_version":"dime-platform-knowledge-v1",'
        '"schema_version":"dime-platform-knowledge-v1"}\n',
        encoding="utf-8",
    )

    with pytest.raises(PlatformKnowledgeError, match="duplicate JSON key"):
        load_platform_knowledge(project, repository_root=repository)
