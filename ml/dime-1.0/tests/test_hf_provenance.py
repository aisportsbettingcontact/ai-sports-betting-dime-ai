from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from dime_ai.hf_provenance import (
    DEVELOPMENT_EVAL_MANIFEST_PATH,
    DEVELOPMENT_EVAL_REPO_ID,
    DevelopmentEvalProvenanceError,
    HuggingFaceDevelopmentEvalRemote,
    RemoteDevelopmentEvalSnapshot,
    case_inventory_sha256,
    verify_development_evaluation_provenance,
)

REVISION = "1" * 40
CASE_PATH = "cases/development/part-000.jsonl"


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json_bytes(value: Any) -> bytes:
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


def _case(case_id: str = "dev-case-001") -> dict[str, Any]:
    return {
        "case_id": case_id,
        "dataset_version": "dime-eval-development-v1",
        "split": "dev",
        "suite": "standard",
        "tags": {
            "program_family": "market_analysis",
            "skill_ids": ["evidence-calibration"],
            "scenario_cluster_id": f"scenario-{case_id}",
            "turn_depth": 1,
            "tool_statuses": [],
            "data_quality_conditions": [],
            "risk_states": ["normal"],
            "market_phase": "general",
        },
        "task_type": "market_analysis",
        "severity": "medium",
        "as_of_utc": "2026-07-25T12:00:00Z",
        "messages": [{"role": "user", "content": "Explain the evidence limits."}],
        "allowed_tools": [],
        "forbidden_tools": [],
        "tool_fixtures": [],
        "gold": {
            "required_tool_calls": [],
            "forbidden_tool_calls": [],
            "numbers": [],
            "required_concepts": ["state evidence limits"],
            "forbidden_claims": ["guaranteed"],
            "expected_policy_action": "allow",
        },
        "scoring": {
            "rubric_version": "dime-eval-v1",
            "numeric_tolerance": 0.000001,
            "requires_human_review": False,
        },
        "provenance": {
            "synthetic": True,
            "source_ids": ["synthetic-dev-001"],
            "available_at_max": "2026-07-25T12:00:00Z",
        },
    }


def _jsonl_bytes(records: list[dict[str, Any]]) -> bytes:
    return b"".join(_json_bytes(record) for record in records)


class FakeRemote:
    def __init__(
        self,
        snapshot: RemoteDevelopmentEvalSnapshot,
        *,
        error: Exception | None = None,
        on_fetch: Callable[[], None] | None = None,
    ) -> None:
        self.snapshot = snapshot
        self.error = error
        self.on_fetch = on_fetch
        self.calls: list[dict[str, Any]] = []

    def fetch(self, **kwargs: Any) -> RemoteDevelopmentEvalSnapshot:
        self.calls.append(kwargs)
        if self.on_fetch is not None:
            self.on_fetch()
        if self.error is not None:
            raise self.error
        return self.snapshot


def _write_identity(path: Path, identity: dict[str, Any]) -> None:
    path.write_bytes(_json_bytes(identity))


def _fixture(
    tmp_path: Path,
    *,
    case_records: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    records_by_path = case_records or {CASE_PATH: [_case()]}
    root = tmp_path / "development-evaluation"
    root.mkdir(parents=True)
    manifest_path = root / DEVELOPMENT_EVAL_MANIFEST_PATH
    manifest_bytes = _json_bytes(
        {
            "schema_version": "dime-eval-development-manifest-v1",
            "dataset_id": "dime-eval-development",
        }
    )
    manifest_path.write_bytes(manifest_bytes)

    evaluation_paths: list[Path] = []
    remote_case_bytes: dict[str, bytes] = {}
    case_files: list[dict[str, Any]] = []
    for repo_path, records in sorted(records_by_path.items()):
        raw = _jsonl_bytes(records)
        local_path = root.joinpath(*repo_path.split("/"))
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(raw)
        evaluation_paths.append(local_path)
        remote_case_bytes[repo_path] = raw
        case_files.append(
            {
                "path": repo_path,
                "sha256": _sha256(raw),
                "record_count": len(records),
            }
        )

    identity = {
        "schema_version": "dime-foundation-development-eval-identity-v2",
        "repo_type": "dataset",
        "repo_id": DEVELOPMENT_EVAL_REPO_ID,
        "revision": REVISION,
        "manifest_path": DEVELOPMENT_EVAL_MANIFEST_PATH,
        "manifest_sha256": _sha256(manifest_bytes),
        "case_root": "cases",
        "case_files": case_files,
        "case_files_sha256": case_inventory_sha256(case_files),
        "case_count": sum(len(records) for records in records_by_path.values()),
    }
    identity_path = tmp_path / "development_eval_identity.json"
    _write_identity(identity_path, identity)

    remote_files = {
        DEVELOPMENT_EVAL_MANIFEST_PATH: manifest_bytes,
        **remote_case_bytes,
    }
    snapshot = RemoteDevelopmentEvalSnapshot(
        repo_id=DEVELOPMENT_EVAL_REPO_ID,
        resolved_revision=REVISION,
        private=True,
        inventory=frozenset(
            {
                "README.md",
                DEVELOPMENT_EVAL_MANIFEST_PATH,
                "rubrics/dime-answer-v1.md",
                *remote_case_bytes,
            }
        ),
        files=remote_files,
    )
    return {
        "root": root,
        "manifest_path": manifest_path,
        "manifest_bytes": manifest_bytes,
        "evaluation_paths": evaluation_paths,
        "identity": identity,
        "identity_path": identity_path,
        "snapshot": snapshot,
    }


def _verify(fixture: dict[str, Any], remote: FakeRemote | None = None) -> Any:
    adapter = remote or FakeRemote(fixture["snapshot"])
    return verify_development_evaluation_provenance(
        fixture["evaluation_paths"],
        fixture["identity_path"],
        fixture["manifest_path"],
        token="hf_test_development_read",
        remote=adapter,
    )


def test_exact_private_remote_revision_and_bytes_pass(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    remote = FakeRemote(fixture["snapshot"])

    verified = _verify(fixture, remote)

    assert verified.repo_id == DEVELOPMENT_EVAL_REPO_ID
    assert verified.revision == REVISION
    assert verified.case_count == 1
    assert verified.records[0]["case_id"] == "dev-case-001"
    assert verified.case_bytes == ((CASE_PATH, fixture["snapshot"].files[CASE_PATH]),)
    assert remote.calls == [
        {
            "repo_id": DEVELOPMENT_EVAL_REPO_ID,
            "repo_type": "dataset",
            "revision": REVISION,
            "requested_paths": frozenset({DEVELOPMENT_EVAL_MANIFEST_PATH, CASE_PATH}),
            "token": "hf_test_development_read",
        }
    ]


def test_production_remote_passes_explicit_token_to_every_hub_method(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import huggingface_hub

    calls: list[tuple[str, dict[str, Any]]] = []
    requested_paths = frozenset({DEVELOPMENT_EVAL_MANIFEST_PATH, CASE_PATH})
    downloaded_files: dict[str, Path] = {}
    for repo_path in requested_paths:
        downloaded = tmp_path.joinpath(*repo_path.split("/"))
        downloaded.parent.mkdir(parents=True, exist_ok=True)
        downloaded.write_bytes(f"bytes for {repo_path}".encode())
        downloaded_files[repo_path] = downloaded

    class SpyHfApi:
        def __init__(self, *, token: str) -> None:
            calls.append(("init", {"token": token}))

        def repo_info(self, **kwargs: Any) -> SimpleNamespace:
            calls.append(("repo_info", kwargs))
            return SimpleNamespace(
                id=DEVELOPMENT_EVAL_REPO_ID,
                sha=REVISION,
                private=True,
            )

        def list_repo_files(self, **kwargs: Any) -> list[str]:
            calls.append(("list_repo_files", kwargs))
            return ["README.md", *sorted(requested_paths)]

        def hf_hub_download(self, **kwargs: Any) -> str:
            calls.append(("hf_hub_download", kwargs))
            return str(downloaded_files[kwargs["filename"]])

    monkeypatch.setattr(huggingface_hub, "HfApi", SpyHfApi)

    snapshot = HuggingFaceDevelopmentEvalRemote().fetch(
        repo_id=DEVELOPMENT_EVAL_REPO_ID,
        repo_type="dataset",
        revision=REVISION,
        requested_paths=requested_paths,
        token="hf_explicit_training_read",
    )

    assert snapshot.repo_id == DEVELOPMENT_EVAL_REPO_ID
    assert snapshot.resolved_revision == REVISION
    assert calls[0] == ("init", {"token": "hf_explicit_training_read"})
    assert all(
        kwargs["token"] == "hf_explicit_training_read" for name, kwargs in calls if name != "init"
    )


def test_missing_token_fails_before_remote_access(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    remote = FakeRemote(fixture["snapshot"])

    with pytest.raises(DevelopmentEvalProvenanceError, match="explicit Hugging Face token"):
        verify_development_evaluation_provenance(
            fixture["evaluation_paths"],
            fixture["identity_path"],
            fixture["manifest_path"],
            token="",
            remote=remote,
        )
    assert remote.calls == []


def test_identity_v1_is_rejected_without_remote_fallback(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    fixture["identity"]["schema_version"] = "dime-foundation-development-eval-identity-v1"
    _write_identity(fixture["identity_path"], fixture["identity"])
    remote = FakeRemote(fixture["snapshot"])

    with pytest.raises(DevelopmentEvalProvenanceError, match="schema violation"):
        _verify(fixture, remote)
    assert remote.calls == []


@pytest.mark.parametrize("revision", ["main", "A" * 40, "1" * 39, "1" * 41])
def test_identity_requires_exact_lowercase_commit_sha(tmp_path: Path, revision: str) -> None:
    fixture = _fixture(tmp_path)
    fixture["identity"]["revision"] = revision
    _write_identity(fixture["identity_path"], fixture["identity"])

    with pytest.raises(DevelopmentEvalProvenanceError, match="schema violation"):
        _verify(fixture)


@pytest.mark.parametrize(
    "path",
    [
        "/cases/development/part-000.jsonl",
        "cases/development/../part-000.jsonl",
        "cases\\development\\part-000.jsonl",
        "outside/part-000.jsonl",
        "cases/development/part-000.json",
    ],
)
def test_identity_rejects_unsafe_case_paths(tmp_path: Path, path: str) -> None:
    fixture = _fixture(tmp_path)
    fixture["identity"]["case_files"][0]["path"] = path
    fixture["identity"]["case_files_sha256"] = case_inventory_sha256(
        fixture["identity"]["case_files"]
    )
    _write_identity(fixture["identity_path"], fixture["identity"])

    with pytest.raises(DevelopmentEvalProvenanceError):
        _verify(fixture)


def test_identity_rejects_unsorted_or_duplicate_case_paths(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    first = fixture["identity"]["case_files"][0]
    fixture["identity"]["case_files"] = [
        {
            **first,
            "path": "cases/validation/z.jsonl",
        },
        {
            **first,
            "path": "cases/development/a.jsonl",
        },
    ]
    fixture["identity"]["case_files_sha256"] = case_inventory_sha256(
        fixture["identity"]["case_files"]
    )
    fixture["identity"]["case_count"] = 2
    _write_identity(fixture["identity_path"], fixture["identity"])
    with pytest.raises(DevelopmentEvalProvenanceError, match="strictly sorted"):
        _verify(fixture)

    fixture["identity"]["case_files"] = [first, {**first, "sha256": "f" * 64}]
    fixture["identity"]["case_files_sha256"] = case_inventory_sha256(
        fixture["identity"]["case_files"]
    )
    fixture["identity"]["case_count"] = 2
    _write_identity(fixture["identity_path"], fixture["identity"])
    with pytest.raises(DevelopmentEvalProvenanceError, match="duplicate paths"):
        _verify(fixture)


def test_identity_rejects_inventory_digest_and_total_count_mismatch(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    fixture["identity"]["case_files_sha256"] = "f" * 64
    _write_identity(fixture["identity_path"], fixture["identity"])
    with pytest.raises(DevelopmentEvalProvenanceError, match="inventory digest"):
        _verify(fixture)

    fixture["identity"]["case_files_sha256"] = case_inventory_sha256(
        fixture["identity"]["case_files"]
    )
    fixture["identity"]["case_count"] = 2
    _write_identity(fixture["identity_path"], fixture["identity"])
    with pytest.raises(DevelopmentEvalProvenanceError, match="does not equal"):
        _verify(fixture)


def test_remote_transport_failure_has_no_local_fallback(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    remote = FakeRemote(fixture["snapshot"], error=TimeoutError("network unavailable"))

    with pytest.raises(DevelopmentEvalProvenanceError, match="Cannot verify"):
        _verify(fixture, remote)
    assert len(remote.calls) == 1


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("repo_id", "other/repository", "wrong development-evaluation repository"),
        ("resolved_revision", "2" * 40, "exact authorized"),
        ("private", False, "must be private"),
    ],
)
def test_remote_repository_identity_is_fail_closed(
    tmp_path: Path,
    field: str,
    value: Any,
    message: str,
) -> None:
    fixture = _fixture(tmp_path)
    snapshot = replace(fixture["snapshot"], **{field: value})

    with pytest.raises(DevelopmentEvalProvenanceError, match=message):
        _verify(fixture, FakeRemote(snapshot))


def test_remote_requires_root_readme_and_manifest(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    without_readme = replace(
        fixture["snapshot"],
        inventory=fixture["snapshot"].inventory - {"README.md"},
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="missing required"):
        _verify(fixture, FakeRemote(without_readme))

    without_manifest = replace(
        fixture["snapshot"],
        inventory=fixture["snapshot"].inventory - {DEVELOPMENT_EVAL_MANIFEST_PATH},
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="missing required"):
        _verify(fixture, FakeRemote(without_manifest))


def test_remote_case_inventory_rejects_selective_subset_and_missing_bytes(
    tmp_path: Path,
) -> None:
    fixture = _fixture(tmp_path)
    subset = replace(
        fixture["snapshot"],
        inventory=fixture["snapshot"].inventory | {"cases/validation/withheld.jsonl"},
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="extra="):
        _verify(fixture, FakeRemote(subset))

    missing_bytes = replace(
        fixture["snapshot"],
        files={DEVELOPMENT_EVAL_MANIFEST_PATH: fixture["manifest_bytes"]},
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="byte inventory"):
        _verify(fixture, FakeRemote(missing_bytes))


def test_local_and_remote_manifest_bytes_must_match_identity(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    fixture["manifest_path"].write_bytes(b'{"mutated":true}\n')
    with pytest.raises(DevelopmentEvalProvenanceError, match="manifest differs"):
        _verify(fixture)

    fixture = _fixture(tmp_path / "remote-mismatch")
    remote_manifest = b'{"remote":"mutated"}\n'
    snapshot = replace(
        fixture["snapshot"],
        files={
            **fixture["snapshot"].files,
            DEVELOPMENT_EVAL_MANIFEST_PATH: remote_manifest,
        },
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="manifest hash"):
        _verify(fixture, FakeRemote(snapshot))


def test_local_and_remote_case_bytes_must_match_identity(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    fixture["evaluation_paths"][0].write_bytes(_jsonl_bytes([_case("local-mutated")]))
    with pytest.raises(DevelopmentEvalProvenanceError, match="differs from remote"):
        _verify(fixture)

    fixture = _fixture(tmp_path / "remote-mismatch")
    snapshot = replace(
        fixture["snapshot"],
        files={
            **fixture["snapshot"].files,
            CASE_PATH: _jsonl_bytes([_case("remote-mutated")]),
        },
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="case hash"):
        _verify(fixture, FakeRemote(snapshot))


def test_per_file_record_count_and_duplicate_case_ids_fail(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)
    fixture["identity"]["case_files"][0]["record_count"] = 2
    fixture["identity"]["case_count"] = 2
    fixture["identity"]["case_files_sha256"] = case_inventory_sha256(
        fixture["identity"]["case_files"]
    )
    _write_identity(fixture["identity_path"], fixture["identity"])
    with pytest.raises(DevelopmentEvalProvenanceError, match="record count mismatch"):
        _verify(fixture)

    duplicate = _case()
    fixture = _fixture(
        tmp_path / "duplicates",
        case_records={
            "cases/development/a.jsonl": [duplicate],
            "cases/validation/b.jsonl": [duplicate],
        },
    )
    with pytest.raises(DevelopmentEvalProvenanceError, match="Duplicate case_id"):
        _verify(fixture)


def test_invalid_production_case_fails(tmp_path: Path) -> None:
    invalid = _case()
    invalid.pop("suite")
    fixture = _fixture(tmp_path, case_records={CASE_PATH: [invalid]})

    with pytest.raises(DevelopmentEvalProvenanceError, match="requires suite"):
        _verify(fixture)


def test_verified_result_uses_bytes_captured_before_local_mutation(tmp_path: Path) -> None:
    fixture = _fixture(tmp_path)

    def mutate_local_after_capture() -> None:
        fixture["manifest_path"].write_bytes(b'{"mutated":"after-capture"}\n')
        fixture["evaluation_paths"][0].write_bytes(_jsonl_bytes([_case("after-capture")]))

    remote = FakeRemote(fixture["snapshot"], on_fetch=mutate_local_after_capture)
    verified = _verify(fixture, remote)

    assert verified.manifest_bytes == fixture["manifest_bytes"]
    assert verified.records[0]["case_id"] == "dev-case-001"
