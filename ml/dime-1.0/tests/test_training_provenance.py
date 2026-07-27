import errno
import importlib.util
import json
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
TRAIN_SCRIPT = PROJECT / "scripts/train_qlora.py"
FULL_TEMPLATE = PROJECT / "configs/sft_full_TEMPLATE.yaml"
REHEARSAL_CONFIG = PROJECT / "configs/sft_rehearsal.yaml"
DECODING_CONFIG = PROJECT / "configs/decoding_v1.json"
RUN_MANIFEST_SCHEMA = PROJECT / "schemas/run_manifest.schema.json"
FOUNDATION_CHECKSUMS_SCHEMA = PROJECT / "schemas/foundation_checksums.schema.json"
RUNPOD_RUNBOOK = PROJECT / "docs/RUNPOD_WORKSPACE_RUNBOOK.md"

SOURCE_SHA = "a" * 40
FOUNDATION_SHA = "b" * 40
DEVELOPMENT_SHA = "c" * 40
ADAPTER_SHA = "d" * 40
EXPERIMENT_ID = "dime-foundation-v1-20260726-a1"
LOCKED_REFERENCE = "locked-eval-approval:2026-07-26-a1"
DATASET_MANIFEST_HASH = "d" * 64
CHECKSUMS_HASH = "e" * 64
DEVELOPMENT_MANIFEST_HASH = "9" * 64
DEVELOPMENT_IDENTITY_HASH = "a" * 64
CONFIG_HASH = "f" * 64
RUN_MANIFEST_HASH = "1" * 64
FOUNDATION_EVIDENCE_HASHES = {
    "system_prompt_sha256": "2" * 64,
    "foundation_build_config_sha256": "3" * 64,
    "source_registry_sha256": "4" * 64,
    "source_artifacts_sha256": "9" * 64,
    "reviewer_registry_sha256": "0" * 64,
    "review_ledger_sha256": "5" * 64,
    "candidate_audit_sha256": "6" * 64,
    "approval_record_sha256": "7" * 64,
    "audit_reports": {
        audit_type: "8" * 64
        for audit_type in {
            "semantic_deduplication",
            "privacy_and_identifiers",
            "rights",
            "development_evaluation_contamination",
            "locked_evaluation_contamination",
            "numeric_traceability",
        }
    },
}


def load_training_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dime_train_qlora_test", TRAIN_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TRAINING = load_training_module()


def approved_full_config() -> dict[str, object]:
    config = yaml.safe_load(FULL_TEMPLATE.read_text(encoding="utf-8"))
    config["run"].update(
        {
            "name": EXPERIMENT_ID,
            "experiment_id": EXPERIMENT_ID,
        }
    )
    datasets = config["provenance"]["datasets"]
    datasets["foundation_sft"]["revision"] = FOUNDATION_SHA
    datasets["development_eval"]["revision"] = DEVELOPMENT_SHA
    datasets["locked_eval"]["revision_or_opaque_reference"] = LOCKED_REFERENCE

    foundation_root = f"/workspace/datasets/foundation-sft/{FOUNDATION_SHA}/foundation-v1"
    config["data"].update(
        {
            "train": f"{foundation_root}/train.jsonl",
            "validation": f"{foundation_root}/validation.jsonl",
            "manifest": f"{foundation_root}/dataset_manifest.json",
            "checksums": f"{foundation_root}/checksums.json",
            "dataset_card": f"{foundation_root}/dataset_card.md",
        }
    )
    run_root = f"/workspace/runs/{EXPERIMENT_ID}"
    config["run"]["manifest"] = f"{run_root}/run_manifest.json"
    config["training"].update(
        {
            "output_dir": f"{run_root}/checkpoints",
            "final_adapter_dir": f"{run_root}/adapters/final",
        }
    )
    return config


def hf_permission_contract(
    *,
    state: str = "governance_scaffold_only",
    governance_head: str = ADAPTER_SHA,
    approved_release_revision: str | None = None,
) -> dict[str, object]:
    return {
        "hugging_face": {
            "repositories": {
                "promoted_adapter": {
                    "repo_type": "model",
                    "repo_id": TRAINING.PROMOTED_ADAPTER_REPOSITORY,
                    "current_governance_head": governance_head,
                    "current_state": state,
                    "approved_release_revision": approved_release_revision,
                }
            }
        }
    }


def test_full_config_binds_exact_immutable_provenance() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)

    assert provenance == {
        "experiment_id": EXPERIMENT_ID,
        "authorization_status": "authorized_for_full_training",
        "release_review_status": "completed_unreviewed",
        "source": {
            "github_repository": "aisportsbettingcontact/ai-sports-betting-dime-ai",
        },
        "datasets": {
            "foundation_sft": {
                "repo_id": "taileredsports/dime-foundation-sft",
                "revision": FOUNDATION_SHA,
            },
            "development_eval": {
                "repo_id": "taileredsports/dime-eval-development",
                "revision": DEVELOPMENT_SHA,
            },
            "locked_eval": {
                "repo_id": "taileredsports/dime-eval-locked",
                "revision_or_opaque_reference": LOCKED_REFERENCE,
            },
        },
    }


@pytest.mark.parametrize(
    ("section", "key"),
    [
        (("provenance", "datasets", "foundation_sft"), "revision"),
        (("provenance", "datasets", "development_eval"), "revision"),
    ],
)
def test_full_config_rejects_non_commit_revisions(
    section: tuple[str, ...],
    key: str,
) -> None:
    config = approved_full_config()
    target = config
    for part in section:
        target = target[part]
    target[key] = "main"

    with pytest.raises(ValueError, match="40-character commit SHA"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_full_config_rejects_placeholders_and_secret_locked_references() -> None:
    config = approved_full_config()
    config["run"]["experiment_id"] = "REPLACE_ME"
    config["run"]["name"] = "REPLACE_ME"
    with pytest.raises(ValueError, match="non-placeholder"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["provenance"]["datasets"]["locked_eval"]["revision_or_opaque_reference"] = (
        "reference:hf_not-a-governance-reference"
    )
    with pytest.raises(ValueError, match="structured opaque"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["provenance"]["datasets"]["locked_eval"]["revision_or_opaque_reference"] = (
        "human-readable hidden suite prose"
    )
    with pytest.raises(ValueError, match="structured opaque"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_training_and_release_share_the_same_experiment_id_boundary() -> None:
    config = approved_full_config()
    config["run"]["name"] = "short"
    config["run"]["experiment_id"] = "short"
    with pytest.raises(ValueError, match="unique"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["run"]["name"] = "12345678"
    config["run"]["experiment_id"] = "12345678"
    config["run"]["manifest"] = "/workspace/runs/12345678/run_manifest.json"
    config["training"]["output_dir"] = "/workspace/runs/12345678/checkpoints"
    config["training"]["final_adapter_dir"] = "/workspace/runs/12345678/adapters/final"
    provenance = TRAINING.assert_config(config, allow_full_run=True)
    assert provenance is not None
    assert provenance["experiment_id"] == "12345678"


def git_commit(repository: Path, message: str) -> str:
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "commit", "-qm", message],
        check=True,
    )
    return subprocess.run(
        ["git", "-C", str(repository), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def authorized_git_fixture(tmp_path: Path) -> tuple[Path, Path, Path, str, str]:
    repository = tmp_path / "repo"
    remote = tmp_path / "origin.git"
    project = repository / "ml/dime-1.0"
    (project / "configs").mkdir(parents=True)
    tracked = project / "tracked.txt"
    config_path = project / "configs/sft_full.yaml"
    platform_contract = project / "configs/platform_contract.json"
    tracked.write_text("reviewed\n", encoding="utf-8")
    config_path.write_text("run:\n  mode: full\n", encoding="utf-8")
    platform_contract.write_text('{"status": "foundation_only"}\n', encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.name", "Dime Test"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "config", "user.email", "test@example.invalid"],
        check=True,
    )
    source_commit = git_commit(repository, "reviewed source")
    platform_contract.write_text('{"status": "training_authorized"}\n', encoding="utf-8")
    authorization_commit = git_commit(repository, "authorize exact training candidate")
    subprocess.run(["git", "-C", str(repository), "branch", "-M", "main"], check=True)
    subprocess.run(
        ["git", "-C", str(repository), "remote", "add", "origin", str(remote)],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "push", "-qu", "origin", "main"],
        check=True,
    )
    return project, config_path, tracked, source_commit, authorization_commit


def test_full_training_requires_two_commit_authorization_chain(tmp_path: Path) -> None:
    project, config_path, tracked, source_commit, authorization_commit = authorized_git_fixture(
        tmp_path
    )
    assert (
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )
        == authorization_commit
    )

    tracked.write_text("locally changed\n", encoding="utf-8")
    with pytest.raises(ValueError, match="clean Git worktree"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )


def test_authorization_chain_rejects_any_other_project_change(tmp_path: Path) -> None:
    project, config_path, tracked, source_commit, _ = authorized_git_fixture(tmp_path)
    tracked.write_text("changed after source\n", encoding="utf-8")
    git_commit(tmp_path / "repo", "unauthorized code change")
    subprocess.run(
        ["git", "-C", str(tmp_path / "repo"), "push", "-q", "origin", "main"],
        check=True,
    )

    with pytest.raises(ValueError, match="Only the canonical platform contract"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )


def test_authorization_chain_rejects_changes_elsewhere_in_repository(tmp_path: Path) -> None:
    project, config_path, _, source_commit, _ = authorized_git_fixture(tmp_path)
    (tmp_path / "repo/README.md").write_text("unrelated change\n", encoding="utf-8")
    git_commit(tmp_path / "repo", "bundle unrelated repository change")
    subprocess.run(
        ["git", "-C", str(tmp_path / "repo"), "push", "-q", "origin", "main"],
        check=True,
    )

    with pytest.raises(ValueError, match="anywhere in the repository"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )


def test_authorization_chain_rejects_wrong_origin_url(tmp_path: Path) -> None:
    project, config_path, _, source_commit, _ = authorized_git_fixture(tmp_path)

    with pytest.raises(ValueError, match="canonical GitHub origin URL"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "different-origin.git"),
        )


def test_authorization_head_must_be_reachable_from_live_remote_main(
    tmp_path: Path,
) -> None:
    project, config_path, _, source_commit, _ = authorized_git_fixture(tmp_path)
    repository = tmp_path / "repo"
    subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "push",
            "--force",
            "-q",
            "origin",
            f"{source_commit}:refs/heads/main",
        ],
        check=True,
    )

    with pytest.raises(ValueError, match="reachable from the verified live origin/main"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )


def test_live_main_revocation_invalidates_an_ancestor_authorization(
    tmp_path: Path,
) -> None:
    project, config_path, _, source_commit, authorization_commit = authorized_git_fixture(tmp_path)
    repository = tmp_path / "repo"
    platform_contract = project / "configs/platform_contract.json"
    platform_contract.write_text('{"status": "foundation_only"}\n', encoding="utf-8")
    git_commit(repository, "revoke prior training authorization")
    subprocess.run(
        ["git", "-C", str(repository), "push", "-q", "origin", "main"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "checkout", "-q", "--detach", authorization_commit],
        check=True,
    )

    with pytest.raises(ValueError, match="no longer carries this exact"):
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )
    with pytest.raises(ValueError, match="no longer carries this exact"):
        TRAINING.verify_authorization_checkout_still_current(
            project,
            authorization_commit,
            expected_origin_url=str(tmp_path / "origin.git"),
        )


def test_unrelated_live_main_advance_preserves_an_unchanged_authorization(
    tmp_path: Path,
) -> None:
    project, config_path, _, source_commit, authorization_commit = authorized_git_fixture(tmp_path)
    repository = tmp_path / "repo"
    (repository / "README.md").write_text("unrelated later documentation\n", encoding="utf-8")
    git_commit(repository, "advance main without changing authorization")
    subprocess.run(
        ["git", "-C", str(repository), "push", "-q", "origin", "main"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repository), "checkout", "-q", "--detach", authorization_commit],
        check=True,
    )

    assert (
        TRAINING.verify_reviewed_authorization_checkout(
            project,
            source_commit,
            config_path,
            expected_origin_url=str(tmp_path / "origin.git"),
        )
        == authorization_commit
    )
    TRAINING.verify_authorization_checkout_still_current(
        project,
        authorization_commit,
        expected_origin_url=str(tmp_path / "origin.git"),
    )


def test_production_origin_url_is_canonical_github_repository() -> None:
    assert TRAINING.CANONICAL_GITHUB_ORIGIN_URL == (
        "https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai.git"
    )


def test_hf_training_token_identity_requires_the_exact_fine_grained_token() -> None:
    seen: list[str] = []

    def probe(token: str) -> dict:
        seen.append(token)
        return {
            "auth": {
                "type": "access_token",
                "accessToken": {
                    "displayName": "dime-training-read-v1",
                    "role": "fineGrained",
                },
            }
        }

    TRAINING.verify_hf_training_token_identity(
        "hf_test_training_token",
        probe=probe,
    )
    assert seen == ["hf_test_training_token"]


@pytest.mark.parametrize(
    ("identity", "message"),
    [
        (
            {
                "auth": {
                    "type": "oauth",
                    "accessToken": {
                        "displayName": "dime-training-read-v1",
                        "role": "fineGrained",
                    },
                }
            },
            "access_token",
        ),
        (
            {
                "auth": {
                    "type": "access_token",
                    "accessToken": {
                        "displayName": "dime-serving-read-v1",
                        "role": "fineGrained",
                    },
                }
            },
            "named training credential",
        ),
        (
            {
                "auth": {
                    "type": "access_token",
                    "accessToken": {
                        "displayName": "dime-training-read-v1",
                        "role": "fine-grained",
                    },
                }
            },
            "exact fine-grained role",
        ),
        ({"auth": {"type": "access_token"}}, "accessToken identity"),
    ],
)
def test_hf_training_token_identity_fails_closed(
    identity: dict,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        TRAINING.verify_hf_training_token_identity(
            "hf_test_training_token",
            probe=lambda _token: identity,
        )


def test_hf_effective_permission_preflight_proves_reads_and_locked_denial() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None
    expected_revisions = {
        TRAINING.FOUNDATION_DATASET_REPOSITORY: FOUNDATION_SHA,
        TRAINING.DEVELOPMENT_EVAL_REPOSITORY: DEVELOPMENT_SHA,
        TRAINING.PINNED_MODEL_ID: TRAINING.PINNED_MODEL_REVISION,
        TRAINING.PROMOTED_ADAPTER_REPOSITORY: ADAPTER_SHA,
    }
    calls: list[tuple[str, str, str | None, str]] = []
    write_calls: list[tuple[str, str, str]] = []

    def probe(
        repo_id: str,
        repo_type: str,
        revision: str | None,
        token: str,
    ) -> tuple[bool, str | None]:
        calls.append((repo_id, repo_type, revision, token))
        if repo_id == TRAINING.LOCKED_EVAL_REPOSITORY:
            return False, None
        return True, expected_revisions[repo_id]

    def write_probe(repo_id: str, repo_type: str, token: str) -> bool:
        write_calls.append((repo_id, repo_type, token))
        return False

    verified = TRAINING.verify_hf_effective_permissions(
        provenance,
        "hf_test_training_token",
        platform_contract=hf_permission_contract(),
        probe=probe,
        write_probe=write_probe,
    )

    assert verified == expected_revisions
    assert calls == [
        (
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            FOUNDATION_SHA,
            "hf_test_training_token",
        ),
        (
            TRAINING.DEVELOPMENT_EVAL_REPOSITORY,
            "dataset",
            DEVELOPMENT_SHA,
            "hf_test_training_token",
        ),
        (
            TRAINING.PINNED_MODEL_ID,
            "model",
            TRAINING.PINNED_MODEL_REVISION,
            "hf_test_training_token",
        ),
        (
            TRAINING.PROMOTED_ADAPTER_REPOSITORY,
            "model",
            ADAPTER_SHA,
            "hf_test_training_token",
        ),
        (
            TRAINING.LOCKED_EVAL_REPOSITORY,
            "dataset",
            None,
            "hf_test_training_token",
        ),
    ]
    assert write_calls == [
        (
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            "hf_test_training_token",
        ),
        (
            TRAINING.DEVELOPMENT_EVAL_REPOSITORY,
            "dataset",
            "hf_test_training_token",
        ),
        (
            TRAINING.PROMOTED_ADAPTER_REPOSITORY,
            "model",
            "hf_test_training_token",
        ),
    ]


def test_hf_repository_access_probe_binds_canonical_hub_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import huggingface_hub

    class CanonicalApi:
        def repo_info(self, **kwargs: object) -> object:
            return SimpleNamespace(id=kwargs["repo_id"], sha=FOUNDATION_SHA)

    monkeypatch.setattr(huggingface_hub, "HfApi", CanonicalApi)
    assert TRAINING.probe_hf_repository_access(
        TRAINING.FOUNDATION_DATASET_REPOSITORY,
        "dataset",
        FOUNDATION_SHA,
        "hf_explicit_test_token",
    ) == (True, FOUNDATION_SHA)


@pytest.mark.parametrize("returned_repo_id", ["taileredsports/redirected-dataset", None, ""])
def test_hf_repository_access_probe_rejects_wrong_or_missing_hub_identity(
    returned_repo_id: str | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import huggingface_hub

    class SubstitutedApi:
        def repo_info(self, **_kwargs: object) -> object:
            return SimpleNamespace(id=returned_repo_id, sha=FOUNDATION_SHA)

    monkeypatch.setattr(huggingface_hub, "HfApi", SubstitutedApi)
    with pytest.raises(ValueError, match="wrong repository identity"):
        TRAINING.probe_hf_repository_access(
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            FOUNDATION_SHA,
            "hf_explicit_test_token",
        )


def test_hf_effective_permission_preflight_rejects_revision_substitution() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None

    def probe(
        repo_id: str,
        repo_type: str,
        revision: str | None,
        token: str,
    ) -> tuple[bool, str | None]:
        del repo_type, token
        if repo_id == TRAINING.LOCKED_EVAL_REPOSITORY:
            return False, None
        if repo_id == TRAINING.FOUNDATION_DATASET_REPOSITORY:
            return True, "0" * 40
        return True, revision

    with pytest.raises(ValueError, match="not the authorized revision"):
        TRAINING.verify_hf_effective_permissions(
            provenance,
            "hf_test_training_token",
            platform_contract=hf_permission_contract(),
            probe=probe,
            write_probe=lambda _repo_id, _repo_type, _token: False,
        )


def test_promoted_adapter_revision_follows_the_contract_release_lifecycle() -> None:
    assert TRAINING.authorized_promoted_adapter_revision(hf_permission_contract()) == ADAPTER_SHA
    approved_revision = "e" * 40
    assert (
        TRAINING.authorized_promoted_adapter_revision(
            hf_permission_contract(
                state="approved_release",
                approved_release_revision=approved_revision,
            )
        )
        == approved_revision
    )

    with pytest.raises(ValueError, match="cannot name an approved release"):
        TRAINING.authorized_promoted_adapter_revision(
            hf_permission_contract(approved_release_revision=approved_revision)
        )
    with pytest.raises(ValueError, match="unsupported promoted-adapter release state"):
        TRAINING.authorized_promoted_adapter_revision(hf_permission_contract(state="draft"))


def test_hf_effective_permission_preflight_rejects_adapter_revision_substitution() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None

    def probe(
        repo_id: str,
        repo_type: str,
        revision: str | None,
        token: str,
    ) -> tuple[bool, str | None]:
        del repo_type, token
        if repo_id == TRAINING.LOCKED_EVAL_REPOSITORY:
            return False, None
        if repo_id == TRAINING.PROMOTED_ADAPTER_REPOSITORY:
            return True, "0" * 40
        return True, revision

    with pytest.raises(ValueError, match="not the authorized revision"):
        TRAINING.verify_hf_effective_permissions(
            provenance,
            "hf_test_training_token",
            platform_contract=hf_permission_contract(),
            probe=probe,
            write_probe=lambda _repo_id, _repo_type, _token: False,
        )


def test_hf_effective_permission_preflight_rejects_locked_eval_access() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None

    def probe(
        repo_id: str,
        repo_type: str,
        revision: str | None,
        token: str,
    ) -> tuple[bool, str | None]:
        del repo_type, token
        if repo_id == TRAINING.LOCKED_EVAL_REPOSITORY:
            return True, "0" * 40
        return True, revision

    with pytest.raises(ValueError, match="can access the locked-evaluation"):
        TRAINING.verify_hf_effective_permissions(
            provenance,
            "hf_test_training_token",
            platform_contract=hf_permission_contract(),
            probe=probe,
            write_probe=lambda _repo_id, _repo_type, _token: False,
        )


def test_hf_effective_permission_preflight_rejects_missing_required_access() -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None

    def probe(
        repo_id: str,
        repo_type: str,
        revision: str | None,
        token: str,
    ) -> tuple[bool, str | None]:
        del repo_type, token
        if repo_id == TRAINING.DEVELOPMENT_EVAL_REPOSITORY:
            return False, None
        return True, revision

    with pytest.raises(ValueError, match="cannot read required dataset repository"):
        TRAINING.verify_hf_effective_permissions(
            provenance,
            "hf_test_training_token",
            platform_contract=hf_permission_contract(),
            probe=probe,
            write_probe=lambda _repo_id, _repo_type, _token: False,
        )


@pytest.mark.parametrize(
    "writable_repository",
    [
        TRAINING.FOUNDATION_DATASET_REPOSITORY,
        TRAINING.DEVELOPMENT_EVAL_REPOSITORY,
        TRAINING.PROMOTED_ADAPTER_REPOSITORY,
    ],
)
def test_hf_effective_permission_preflight_rejects_any_repository_write_access(
    writable_repository: str,
) -> None:
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None

    def read_probe(
        repo_id: str,
        repo_type: str,
        revision: str | None,
        token: str,
    ) -> tuple[bool, str | None]:
        del repo_type, token
        if repo_id == TRAINING.LOCKED_EVAL_REPOSITORY:
            return False, None
        return True, revision

    def write_probe(repo_id: str, repo_type: str, token: str) -> bool:
        expected_type = "model" if repo_id == TRAINING.PROMOTED_ADAPTER_REPOSITORY else "dataset"
        assert repo_type == expected_type
        assert token == "hf_test_training_token"
        return repo_id == writable_repository

    with pytest.raises(ValueError, match="forbidden write access"):
        TRAINING.verify_hf_effective_permissions(
            provenance,
            "hf_test_training_token",
            platform_contract=hf_permission_contract(),
            probe=read_probe,
            write_probe=write_probe,
        )


def test_hf_write_probe_forwards_the_explicit_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import huggingface_hub

    calls: list[tuple] = []

    class FakeApi:
        def __init__(self, *, token: str) -> None:
            calls.append(("init", token))

        def auth_check(
            self,
            *,
            repo_id: str,
            repo_type: str,
            token: str,
            write: bool,
        ) -> None:
            calls.append(("auth_check", repo_id, repo_type, token, write))

    monkeypatch.setattr(huggingface_hub, "HfApi", FakeApi)
    assert (
        TRAINING.probe_hf_repository_write_access(
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            "hf_explicit_test_token",
        )
        is True
    )
    assert calls == [
        ("init", "hf_explicit_test_token"),
        (
            "auth_check",
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            "hf_explicit_test_token",
            True,
        ),
    ]


@pytest.mark.parametrize("status_code", [401, 403, 404])
def test_hf_write_probe_distinguishes_expected_permission_denial(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    import huggingface_hub

    denied = RuntimeError("denied")
    denied.response = SimpleNamespace(status_code=status_code)

    class FakeApi:
        def __init__(self, *, token: str) -> None:
            del token

        def auth_check(self, **_kwargs: object) -> None:
            raise denied

    monkeypatch.setattr(huggingface_hub, "HfApi", FakeApi)
    assert (
        TRAINING.probe_hf_repository_write_access(
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            "hf_explicit_test_token",
        )
        is False
    )


def test_hf_write_probe_fails_closed_on_transport_or_ambiguous_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import huggingface_hub

    class TransportFailureApi:
        def __init__(self, *, token: str) -> None:
            del token

        def auth_check(self, **_kwargs: object) -> None:
            failure = RuntimeError("transport")
            failure.response = SimpleNamespace(status_code=500)
            raise failure

    monkeypatch.setattr(huggingface_hub, "HfApi", TransportFailureApi)
    with pytest.raises(ValueError, match="Cannot verify Hugging Face write denial"):
        TRAINING.probe_hf_repository_write_access(
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            "hf_explicit_test_token",
        )

    class AmbiguousApi:
        def __init__(self, *, token: str) -> None:
            del token

        def auth_check(self, **_kwargs: object) -> bool:
            return False

    monkeypatch.setattr(huggingface_hub, "HfApi", AmbiguousApi)
    with pytest.raises(ValueError, match="ambiguous write check"):
        TRAINING.probe_hf_repository_write_access(
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            "dataset",
            "hf_explicit_test_token",
        )


def test_full_training_requires_explicitly_approved_curriculum() -> None:
    passing_metrics_do_not_approve = {
        "schema_version": "dime-curriculum-v1",
        "status": "proposed",
        "task_families": {"market_math": {"train": 1, "validation": 1}},
    }
    with pytest.raises(ValueError, match="curriculum status: approved"):
        TRAINING.require_approved_curriculum(passing_metrics_do_not_approve)

    approved = deepcopy(passing_metrics_do_not_approve)
    approved["status"] = "approved"
    assert TRAINING.require_approved_curriculum(approved) is approved


def test_full_config_rejects_revision_path_or_run_path_mismatch() -> None:
    config = approved_full_config()
    config["data"]["train"] = config["data"]["train"].replace(
        FOUNDATION_SHA,
        "d" * 40,
    )
    with pytest.raises(ValueError, match="foundation revision path"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["training"]["output_dir"] = "/workspace/runs/wrong/checkpoints"
    with pytest.raises(ValueError, match="experiment-scoped path"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_full_config_requires_authorization_status_and_explicit_flag() -> None:
    config = approved_full_config()
    with pytest.raises(ValueError, match="--allow-full-run"):
        TRAINING.assert_config(config, allow_full_run=False)

    config["run"]["authorization_status"] = "draft"
    with pytest.raises(ValueError, match="authorized_for_full_training"):
        TRAINING.assert_config(config, allow_full_run=True)

    config = approved_full_config()
    config["run"]["release_review_status"] = "approved_for_release_review"
    with pytest.raises(ValueError, match="cannot pre-approve"):
        TRAINING.assert_config(config, allow_full_run=True)


def test_current_platform_contract_blocks_full_training() -> None:
    current = json.loads((PROJECT / "configs/platform_contract.json").read_text(encoding="utf-8"))
    with pytest.raises(ValueError, match="does not authorize"):
        TRAINING.validate_full_training_authorization(
            current,
            approved_full_config()["provenance"] | {"experiment_id": EXPERIMENT_ID},
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
            FOUNDATION_EVIDENCE_HASHES,
        )

    authorized = deepcopy(current)
    authorized["status"] = "training_authorized"
    authorized["authorization"]["full_training"] = True
    provenance = TRAINING.assert_config(approved_full_config(), allow_full_run=True)
    assert provenance is not None
    authorized["authorization"]["training_candidate"] = {
        "experiment_id": provenance["experiment_id"],
        "source_github_commit": SOURCE_SHA,
        "foundation_revision": provenance["datasets"]["foundation_sft"]["revision"],
        "foundation_dataset_manifest_sha256": DATASET_MANIFEST_HASH,
        "foundation_checksums_sha256": CHECKSUMS_HASH,
        "foundation_evidence_hashes": FOUNDATION_EVIDENCE_HASHES,
        "development_eval_revision": provenance["datasets"]["development_eval"]["revision"],
        "locked_eval_reference": provenance["datasets"]["locked_eval"][
            "revision_or_opaque_reference"
        ],
        "config_sha256": CONFIG_HASH,
        "run_manifest_sha256": RUN_MANIFEST_HASH,
    }
    with pytest.raises(ValueError, match="approved_release state"):
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
            FOUNDATION_EVIDENCE_HASHES,
        )

    repositories = authorized["hugging_face"]["repositories"]
    repositories["foundation_sft"]["current_state"] = "approved_release"
    with pytest.raises(ValueError, match="approved-release revision"):
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
            FOUNDATION_EVIDENCE_HASHES,
        )
    repositories["foundation_sft"].update(
        {
            "current_state": "approved_release",
            "approved_release_revision": FOUNDATION_SHA,
        }
    )
    repositories["development_eval"].update(
        {
            "current_state": "approved_release",
            "approved_release_revision": DEVELOPMENT_SHA,
        }
    )
    assert (
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
            FOUNDATION_EVIDENCE_HASHES,
        )
        == SOURCE_SHA
    )
    repositories["foundation_sft"]["approved_release_revision"] = "0" * 40
    with pytest.raises(ValueError, match="approved-release revision"):
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
            FOUNDATION_EVIDENCE_HASHES,
        )
    repositories["foundation_sft"]["approved_release_revision"] = FOUNDATION_SHA

    assert TRAINING.authorized_training_evaluation_references(
        authorized,
        provenance,
    ) == (DEVELOPMENT_SHA, LOCKED_REFERENCE)

    authorized["authorization"]["training_candidate"]["development_eval_revision"] = "d" * 40
    with pytest.raises(ValueError, match="development-evaluation revision"):
        TRAINING.authorized_training_evaluation_references(
            authorized,
            provenance,
        )
    authorized["authorization"]["training_candidate"]["development_eval_revision"] = DEVELOPMENT_SHA

    authorized["authorization"]["training_candidate"]["locked_eval_reference"] = (
        "locked-eval-approval:2026-07-26-b2"
    )
    with pytest.raises(ValueError, match="locked-evaluation reference"):
        TRAINING.authorized_training_evaluation_references(
            authorized,
            provenance,
        )
    authorized["authorization"]["training_candidate"]["locked_eval_reference"] = LOCKED_REFERENCE

    authorized["authorization"]["training_candidate"]["foundation_checksums_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="exact candidate"):
        TRAINING.validate_full_training_authorization(
            authorized,
            provenance,
            CONFIG_HASH,
            DATASET_MANIFEST_HASH,
            CHECKSUMS_HASH,
            RUN_MANIFEST_HASH,
            FOUNDATION_EVIDENCE_HASHES,
        )


def foundation_snapshot_fixture(tmp_path: Path) -> dict[str, Path]:
    snapshot = tmp_path / "foundation-v1"
    snapshot.mkdir()
    paths = {
        "train": snapshot / "train.jsonl",
        "validation": snapshot / "validation.jsonl",
        "manifest": snapshot / "dataset_manifest.json",
        "checksums": snapshot / "checksums.json",
        "dataset_card": snapshot / "dataset_card.md",
        "curriculum": tmp_path / "curriculum.yaml",
        "foundation_build_config": tmp_path / "foundation-build.yaml",
        "reviewer_registry": tmp_path / "foundation-reviewers.json",
        "system_prompt": tmp_path / "system-prompt.md",
        "tools": tmp_path / "tools.json",
        "template": tmp_path / "template.jinja",
    }
    paths["train"].write_text('{"example_id":"train-fixture"}\n', encoding="utf-8")
    paths["validation"].write_text('{"example_id":"validation-fixture"}\n', encoding="utf-8")
    paths["dataset_card"].write_text("# Approved private fixture\n", encoding="utf-8")
    paths["curriculum"].write_text("schema_version: fixture\n", encoding="utf-8")
    paths["foundation_build_config"].write_text(
        "schema_version: fixture-build\n",
        encoding="utf-8",
    )
    paths["reviewer_registry"].write_text(
        '{"schema_version":"fixture-reviewers"}\n',
        encoding="utf-8",
    )
    paths["system_prompt"].write_text("Governed system prompt.\n", encoding="utf-8")
    paths["tools"].write_text("[]\n", encoding="utf-8")
    paths["template"].write_text("fixture\n", encoding="utf-8")
    audit = {
        "passed": True,
        "report_sha256": "a" * 64,
        "tool_id": "fixture-auditor",
        "tool_version": "1.0.0",
        "completed_at_utc": "2026-07-26T11:00:00Z",
        "reviewer_ids": ["audit-reviewer-001"],
    }
    manifest = {
        "schema_version": "dime-dataset-manifest-v4",
        "dataset_version": "dime-sft-foundation-v1",
        "visibility": "private",
        "publication_classification": "private-only",
        "provenance_source_class": "synthetic",
        "source_owner": "Tailered Sports",
        "rights_basis": "owned synthetic fixtures",
        "license_or_usage_restrictions": "private training only",
        "synthetic_status": "fully-synthetic",
        "contains_user_data": False,
        "contains_provider_derived_data": False,
        "approval_status": "approved",
        "approved": True,
        "approved_at_utc": (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "evidence_valid_until_utc": (datetime.now(UTC) + timedelta(days=1)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "reviewer_ids": ["dataset-approver-001", "dataset-approver-002"],
        "train_record_count": 1,
        "validation_record_count": 1,
        "train_sha256": TRAINING.file_sha256(paths["train"]),
        "validation_sha256": TRAINING.file_sha256(paths["validation"]),
        "curriculum_config_sha256": TRAINING.file_sha256(paths["curriculum"]),
        "system_prompt_sha256": TRAINING.file_sha256(paths["system_prompt"]),
        "tool_catalog_sha256": TRAINING.file_sha256(paths["tools"]),
        "chat_template_sha256": TRAINING.file_sha256(paths["template"]),
        "foundation_build_config_sha256": TRAINING.file_sha256(paths["foundation_build_config"]),
        "source_registry_sha256": "b" * 64,
        "source_artifacts_sha256": "f" * 64,
        "reviewer_registry_sha256": TRAINING.file_sha256(paths["reviewer_registry"]),
        "review_ledger_sha256": "c" * 64,
        "candidate_audit_sha256": "d" * 64,
        "approval_record_sha256": "e" * 64,
        "development_eval_repo_id": TRAINING.DEVELOPMENT_EVAL_REPOSITORY,
        "development_eval_revision": DEVELOPMENT_SHA,
        "development_eval_manifest_sha256": DEVELOPMENT_MANIFEST_HASH,
        "development_eval_identity_sha256": DEVELOPMENT_IDENTITY_HASH,
        "locked_evaluation_reference": LOCKED_REFERENCE,
        "audit_reports": {
            "semantic_deduplication": audit,
            "privacy_and_identifiers": audit,
            "rights": audit,
            "development_evaluation_contamination": audit,
            "locked_evaluation_contamination": audit,
            "numeric_traceability": audit,
        },
        "rights_reviewed": True,
        "consent_reviewed": True,
        "privacy_reviewed": True,
        "partition_audit_passed": True,
        "future_data_audit_passed": True,
        "exact_dedup_audit_passed": True,
        "semantic_dedup_audit_passed": True,
        "evaluation_contamination_audit_passed": True,
        "numeric_traceability_audit_passed": True,
        "canonical_system_prompt_enforced": True,
        "direct_identifier_scan_version": "scan-v1",
        "deletion_policy_id": "deletion-v1",
        "limitations_notes": "Synthetic private test fixture.",
    }
    paths["manifest"].write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_snapshot_checksums(paths)
    return paths


def write_snapshot_checksums(paths: dict[str, Path]) -> None:
    checksums = {
        "schema_version": "dime-foundation-checksums-v1",
        "files": {
            "train.jsonl": TRAINING.file_sha256(paths["train"]),
            "validation.jsonl": TRAINING.file_sha256(paths["validation"]),
            "dataset_manifest.json": TRAINING.file_sha256(paths["manifest"]),
            "dataset_card.md": TRAINING.file_sha256(paths["dataset_card"]),
        },
    }
    paths["checksums"].write_text(
        json.dumps(checksums, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def validate_snapshot(paths: dict[str, Path]) -> tuple[list[dict], list[dict], str, str]:
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    return TRAINING.validate_foundation_snapshot(
        train_path=paths["train"],
        validation_path=paths["validation"],
        dataset_manifest_path=paths["manifest"],
        checksums_path=paths["checksums"],
        dataset_card_path=paths["dataset_card"],
        checksums_schema_path=FOUNDATION_CHECKSUMS_SCHEMA,
        curriculum_path=paths["curriculum"],
        foundation_build_config_path=paths["foundation_build_config"],
        reviewer_registry_path=paths["reviewer_registry"],
        system_prompt_path=paths["system_prompt"],
        tool_catalog_path=paths["tools"],
        template_path=paths["template"],
        authorized_evidence_hashes=TRAINING.manifest_foundation_evidence_hashes(manifest),
        authorized_development_eval_revision=DEVELOPMENT_SHA,
        authorized_locked_eval_reference=LOCKED_REFERENCE,
    )


def remote_foundation_snapshot(
    paths: dict[str, Path],
    *,
    private: bool = True,
    inventory: frozenset[str] | None = None,
    files: dict[str, bytes] | None = None,
) -> object:
    remote_files = {
        "foundation-v1/train.jsonl": paths["train"].read_bytes(),
        "foundation-v1/validation.jsonl": paths["validation"].read_bytes(),
        "foundation-v1/dataset_manifest.json": paths["manifest"].read_bytes(),
        "foundation-v1/checksums.json": paths["checksums"].read_bytes(),
        "foundation-v1/dataset_card.md": paths["dataset_card"].read_bytes(),
    }
    return TRAINING.FoundationRemoteSnapshot(
        repo_id=TRAINING.FOUNDATION_DATASET_REPOSITORY,
        resolved_revision=FOUNDATION_SHA,
        private=private,
        inventory=inventory if inventory is not None else frozenset({"README.md", *remote_files}),
        files=files if files is not None else remote_files,
    )


def verify_remote_foundation_snapshot(
    paths: dict[str, Path],
    snapshot: object,
) -> None:
    calls: list[tuple[str, str, str]] = []

    def fetch(repo_id: str, revision: str, token: str) -> object:
        calls.append((repo_id, revision, token))
        return snapshot

    TRAINING.verify_foundation_hf_snapshot(
        revision=FOUNDATION_SHA,
        token="hf_test_training_token",
        train_path=paths["train"],
        validation_path=paths["validation"],
        dataset_manifest_path=paths["manifest"],
        checksums_path=paths["checksums"],
        dataset_card_path=paths["dataset_card"],
        fetch=fetch,
    )
    assert calls == [
        (
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            FOUNDATION_SHA,
            "hf_test_training_token",
        )
    ]


def _install_foundation_snapshot_hub_fakes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    returned_repo_id: str | None,
) -> None:
    import huggingface_hub

    class SnapshotApi:
        def __init__(self, *, token: str) -> None:
            assert token == "hf_explicit_test_token"

        def repo_info(self, **_kwargs: object) -> object:
            return SimpleNamespace(
                id=returned_repo_id,
                sha=FOUNDATION_SHA,
                private=True,
            )

        def list_repo_files(self, **_kwargs: object) -> list[str]:
            return [
                TRAINING.FOUNDATION_ROOT_DATASET_CARD,
                *sorted(TRAINING.FOUNDATION_RELEASE_FILES),
            ]

    def download(**kwargs: object) -> str:
        filename = str(kwargs["filename"])
        path = tmp_path / "hub-downloads" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"remote:{filename}\n".encode())
        return str(path)

    monkeypatch.setattr(huggingface_hub, "HfApi", SnapshotApi)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", download)


def test_fetch_foundation_snapshot_uses_canonical_hub_repository_identity(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _install_foundation_snapshot_hub_fakes(
        monkeypatch,
        tmp_path,
        returned_repo_id=TRAINING.FOUNDATION_DATASET_REPOSITORY,
    )

    snapshot = TRAINING.fetch_foundation_hf_snapshot(
        TRAINING.FOUNDATION_DATASET_REPOSITORY,
        FOUNDATION_SHA,
        "hf_explicit_test_token",
    )

    assert snapshot.repo_id == TRAINING.FOUNDATION_DATASET_REPOSITORY
    assert snapshot.resolved_revision == FOUNDATION_SHA
    assert snapshot.private is True


@pytest.mark.parametrize("returned_repo_id", ["taileredsports/redirected-dataset", None, ""])
def test_fetch_foundation_snapshot_rejects_wrong_or_missing_hub_identity(
    returned_repo_id: str | None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _install_foundation_snapshot_hub_fakes(
        monkeypatch,
        tmp_path,
        returned_repo_id=returned_repo_id,
    )

    with pytest.raises(ValueError, match="wrong Foundation repository identity"):
        TRAINING.fetch_foundation_hf_snapshot(
            TRAINING.FOUNDATION_DATASET_REPOSITORY,
            FOUNDATION_SHA,
            "hf_explicit_test_token",
        )

    assert not (tmp_path / "hub-downloads").exists()


def test_remote_foundation_snapshot_is_private_exact_and_byte_equal(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    verify_remote_foundation_snapshot(paths, remote_foundation_snapshot(paths))


def test_remote_foundation_snapshot_rejects_a_public_repository(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    with pytest.raises(ValueError, match="must be private"):
        verify_remote_foundation_snapshot(
            paths,
            remote_foundation_snapshot(paths, private=False),
        )


def test_remote_foundation_snapshot_requires_a_root_dataset_card(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    with pytest.raises(ValueError, match="root README.md"):
        verify_remote_foundation_snapshot(
            paths,
            remote_foundation_snapshot(
                paths,
                inventory=frozenset(TRAINING.FOUNDATION_RELEASE_FILES),
            ),
        )


@pytest.mark.parametrize(
    "inventory",
    [
        frozenset(
            {
                TRAINING.FOUNDATION_ROOT_DATASET_CARD,
                *(TRAINING.FOUNDATION_RELEASE_FILES - {"foundation-v1/dataset_card.md"}),
            }
        ),
        frozenset(
            {
                TRAINING.FOUNDATION_ROOT_DATASET_CARD,
                *TRAINING.FOUNDATION_RELEASE_FILES,
                "foundation-v1/unapproved-notes.txt",
            }
        ),
    ],
)
def test_remote_foundation_snapshot_rejects_missing_or_extra_release_files(
    tmp_path: Path,
    inventory: frozenset[str],
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    with pytest.raises(ValueError, match="release inventory mismatch"):
        verify_remote_foundation_snapshot(
            paths,
            remote_foundation_snapshot(paths, inventory=inventory),
        )


def test_remote_foundation_snapshot_rejects_any_byte_mismatch(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    snapshot = remote_foundation_snapshot(paths)
    mismatched_files = dict(snapshot.files)
    mismatched_files["foundation-v1/train.jsonl"] += b" "

    with pytest.raises(ValueError, match="bytes differ.*train.jsonl"):
        verify_remote_foundation_snapshot(
            paths,
            remote_foundation_snapshot(paths, files=mismatched_files),
        )


def test_foundation_snapshot_requires_v4_private_manifest_and_exact_checksums(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    train, validation, manifest_hash, checksums_hash = validate_snapshot(paths)
    assert train == [{"example_id": "train-fixture"}]
    assert validation == [{"example_id": "validation-fixture"}]
    assert manifest_hash == TRAINING.file_sha256(paths["manifest"])
    assert checksums_hash == TRAINING.file_sha256(paths["checksums"])

    paths["train"].write_text('{"example_id":"tampered"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="checksum mismatch: train.jsonl"):
        validate_snapshot(paths)


def test_foundation_snapshot_rejects_legacy_manifest_even_when_rehashed(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["schema_version"] = "dime-dataset-manifest-v2"
    paths["manifest"].write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    write_snapshot_checksums(paths)

    with pytest.raises(ValueError, match="requires a dime-dataset-manifest-v4"):
        validate_snapshot(paths)


def test_foundation_snapshot_rejects_unknown_files(tmp_path: Path) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    (paths["manifest"].parent / "notes.txt").write_text("not governed\n", encoding="utf-8")

    with pytest.raises(ValueError, match="inventory mismatch"):
        validate_snapshot(paths)


@pytest.mark.parametrize(
    ("field", "tampered_value", "message"),
    [
        ("development_eval_revision", "d" * 40, "development-evaluation revision"),
        (
            "locked_evaluation_reference",
            "locked-eval-approval:2026-07-26-b2",
            "locked-evaluation reference",
        ),
    ],
)
def test_foundation_snapshot_rejects_unauthorized_evaluation_identity(
    tmp_path: Path,
    field: str,
    tampered_value: str,
    message: str,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest[field] = tampered_value
    paths["manifest"].write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_snapshot_checksums(paths)

    with pytest.raises(ValueError, match=message):
        validate_snapshot(paths)


def test_foundation_snapshot_rejects_unauthorized_evidence_hash(tmp_path: Path) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    evidence = TRAINING.manifest_foundation_evidence_hashes(manifest)
    evidence["source_registry_sha256"] = "0" * 64

    with pytest.raises(ValueError, match="source_registry_sha256 mismatch"):
        TRAINING.validate_foundation_snapshot(
            train_path=paths["train"],
            validation_path=paths["validation"],
            dataset_manifest_path=paths["manifest"],
            checksums_path=paths["checksums"],
            dataset_card_path=paths["dataset_card"],
            checksums_schema_path=FOUNDATION_CHECKSUMS_SCHEMA,
            curriculum_path=paths["curriculum"],
            foundation_build_config_path=paths["foundation_build_config"],
            reviewer_registry_path=paths["reviewer_registry"],
            system_prompt_path=paths["system_prompt"],
            tool_catalog_path=paths["tools"],
            template_path=paths["template"],
            authorized_evidence_hashes=evidence,
            authorized_development_eval_revision=DEVELOPMENT_SHA,
            authorized_locked_eval_reference=LOCKED_REFERENCE,
        )


def test_foundation_snapshot_rejects_unauthorized_source_artifact_hash(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    evidence = TRAINING.manifest_foundation_evidence_hashes(manifest)
    evidence["source_artifacts_sha256"] = "0" * 64

    with pytest.raises(ValueError, match="source_artifacts_sha256 mismatch"):
        TRAINING.validate_foundation_snapshot(
            train_path=paths["train"],
            validation_path=paths["validation"],
            dataset_manifest_path=paths["manifest"],
            checksums_path=paths["checksums"],
            dataset_card_path=paths["dataset_card"],
            checksums_schema_path=FOUNDATION_CHECKSUMS_SCHEMA,
            curriculum_path=paths["curriculum"],
            foundation_build_config_path=paths["foundation_build_config"],
            reviewer_registry_path=paths["reviewer_registry"],
            system_prompt_path=paths["system_prompt"],
            tool_catalog_path=paths["tools"],
            template_path=paths["template"],
            authorized_evidence_hashes=evidence,
            authorized_development_eval_revision=DEVELOPMENT_SHA,
            authorized_locked_eval_reference=LOCKED_REFERENCE,
        )


def test_foundation_snapshot_rejects_local_prompt_or_build_config_drift(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    evidence = TRAINING.manifest_foundation_evidence_hashes(manifest)
    paths["system_prompt"].write_text("tampered prompt\n", encoding="utf-8")

    with pytest.raises(ValueError, match="system-prompt hash"):
        TRAINING.validate_foundation_snapshot(
            train_path=paths["train"],
            validation_path=paths["validation"],
            dataset_manifest_path=paths["manifest"],
            checksums_path=paths["checksums"],
            dataset_card_path=paths["dataset_card"],
            checksums_schema_path=FOUNDATION_CHECKSUMS_SCHEMA,
            curriculum_path=paths["curriculum"],
            foundation_build_config_path=paths["foundation_build_config"],
            reviewer_registry_path=paths["reviewer_registry"],
            system_prompt_path=paths["system_prompt"],
            tool_catalog_path=paths["tools"],
            template_path=paths["template"],
            authorized_evidence_hashes=evidence,
            authorized_development_eval_revision=DEVELOPMENT_SHA,
            authorized_locked_eval_reference=LOCKED_REFERENCE,
        )


def test_foundation_snapshot_rejects_local_reviewer_registry_drift(
    tmp_path: Path,
) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    evidence = TRAINING.manifest_foundation_evidence_hashes(manifest)
    paths["reviewer_registry"].write_text('{"tampered":true}\n', encoding="utf-8")

    with pytest.raises(ValueError, match="reviewer-registry hash"):
        TRAINING.validate_foundation_snapshot(
            train_path=paths["train"],
            validation_path=paths["validation"],
            dataset_manifest_path=paths["manifest"],
            checksums_path=paths["checksums"],
            dataset_card_path=paths["dataset_card"],
            checksums_schema_path=FOUNDATION_CHECKSUMS_SCHEMA,
            curriculum_path=paths["curriculum"],
            foundation_build_config_path=paths["foundation_build_config"],
            reviewer_registry_path=paths["reviewer_registry"],
            system_prompt_path=paths["system_prompt"],
            tool_catalog_path=paths["tools"],
            template_path=paths["template"],
            authorized_evidence_hashes=evidence,
            authorized_development_eval_revision=DEVELOPMENT_SHA,
            authorized_locked_eval_reference=LOCKED_REFERENCE,
        )


@pytest.mark.parametrize(
    ("now", "message"),
    [
        ("2026-07-26T11:59:59Z", "approval is in the future"),
        ("2026-07-27T12:00:00Z", "evidence has expired"),
        ("2026-07-28T00:00:00Z", "evidence has expired"),
    ],
)
def test_foundation_evidence_window_fails_closed(
    now: str,
    message: str,
) -> None:
    manifest = {
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "evidence_valid_until_utc": "2026-07-27T12:00:00Z",
    }

    with pytest.raises(ValueError, match=message):
        TRAINING.require_current_foundation_evidence(
            manifest,
            now=TRAINING.parse_utc_timestamp(now, "now"),
        )


def test_foundation_evidence_window_accepts_open_interval() -> None:
    manifest = {
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "evidence_valid_until_utc": "2026-07-27T12:00:00Z",
    }

    expiry = TRAINING.require_current_foundation_evidence(
        manifest,
        now=TRAINING.parse_utc_timestamp("2026-07-27T11:59:59Z", "now"),
    )

    assert expiry == TRAINING.parse_utc_timestamp(
        manifest["evidence_valid_until_utc"],
        "expiry",
    )


def test_snapshot_rejects_a_symlinked_ancestor(tmp_path: Path) -> None:
    paths = foundation_snapshot_fixture(tmp_path)
    linked_root = tmp_path / "linked-foundation"
    linked_root.symlink_to(paths["manifest"].parent, target_is_directory=True)

    with pytest.raises(ValueError, match="symbolic-link component"):
        TRAINING.require_snapshot_file(
            linked_root / "train.jsonl",
            linked_root,
            "train.jsonl",
        )


def test_bound_file_rejects_a_symlinked_ancestor(tmp_path: Path) -> None:
    real_root = tmp_path / "real"
    real_root.mkdir()
    (real_root / "run_manifest.json").write_text("{}\n", encoding="utf-8")
    linked_root = tmp_path / "linked"
    linked_root.symlink_to(real_root, target_is_directory=True)

    with pytest.raises(ValueError, match="symbolic-link component"):
        TRAINING.read_bound_file(linked_root / "run_manifest.json", "run manifest")


def test_bound_file_detects_replace_then_restore_of_identical_bytes(
    tmp_path: Path,
) -> None:
    governed = tmp_path / "governed.json"
    governed.write_text('{"approved":true}\n', encoding="utf-8")
    captured = TRAINING.read_bound_file(governed, "governed fixture")
    replacement = tmp_path / "replacement.json"
    replacement.write_bytes(captured.data)
    replacement.replace(governed)

    with pytest.raises(ValueError, match="changed after authorization"):
        TRAINING.assert_bound_file_unchanged(captured, "governed fixture")


def test_training_fence_rechecks_governed_files_after_training(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    governed = tmp_path / "governed.json"
    governed.write_text('{"approved":true}\n', encoding="utf-8")
    captured = TRAINING.capture_bound_files([governed])
    manifest = {
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "evidence_valid_until_utc": "2026-07-28T12:00:00Z",
    }
    calls = 0

    class MutatingTrainer:
        def train(self, *, resume_from_checkpoint: str | None) -> object:
            nonlocal calls
            assert resume_from_checkpoint is None
            calls += 1
            governed.write_text('{"approved":false}\n', encoding="utf-8")
            return object()

    monkeypatch.setattr(
        TRAINING,
        "verify_authorization_checkout_still_current",
        lambda _project, _commit: None,
    )

    with pytest.raises(ValueError, match="changed after authorization"):
        TRAINING.train_with_execution_fences(
            MutatingTrainer(),
            None,
            production=True,
            project=tmp_path,
            governed_files=captured,
            foundation_manifest=manifest,
            authorization_commit="a" * 40,
            clock=lambda: datetime(2026, 7, 27, 12, tzinfo=UTC),
        )

    assert calls == 1


def test_training_fence_rechecks_evidence_expiry_after_training(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    governed = tmp_path / "governed.json"
    governed.write_text('{"approved":true}\n', encoding="utf-8")
    captured = TRAINING.capture_bound_files([governed])
    manifest = {
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "evidence_valid_until_utc": "2026-07-27T12:01:00Z",
    }
    times = iter(
        [
            datetime(2026, 7, 27, 12, 0, 59, tzinfo=UTC),
            datetime(2026, 7, 27, 12, 1, tzinfo=UTC),
        ]
    )
    calls = 0

    class CompletingTrainer:
        def train(self, *, resume_from_checkpoint: str | None) -> object:
            nonlocal calls
            assert resume_from_checkpoint is None
            calls += 1
            return object()

    monkeypatch.setattr(
        TRAINING,
        "verify_authorization_checkout_still_current",
        lambda _project, _commit: None,
    )

    with pytest.raises(ValueError, match="evidence has expired"):
        TRAINING.train_with_execution_fences(
            CompletingTrainer(),
            None,
            production=True,
            project=tmp_path,
            governed_files=captured,
            foundation_manifest=manifest,
            authorization_commit="a" * 40,
            clock=lambda: next(times),
        )

    assert calls == 1


def run_manifest_fixture(tmp_path: Path) -> tuple[Path, dict, dict, dict[str, Path]]:
    config = approved_full_config()
    config_path = tmp_path / "sft_full.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    provenance = TRAINING.assert_config(config, allow_full_run=True)
    assert provenance is not None
    provenance["source"]["github_commit"] = SOURCE_SHA
    provenance["training_authorization"] = {"github_commit": "2" * 40}
    contract_paths = {
        name: PROJECT / relative for name, relative in config["provenance"]["files"].items()
    }
    runtime_path = PROJECT / "configs/runtime.env"
    requirements_path = PROJECT / "requirements.lock.txt"
    runtime = TRAINING.parse_runtime_contract(runtime_path)
    contracts = {
        "training_config_sha256": TRAINING.file_sha256(config_path),
        "system_prompt_sha256": TRAINING.file_sha256(contract_paths["system_prompt"]),
        "chat_template_sha256": TRAINING.file_sha256(contract_paths["chat_template"]),
        "tool_catalog_sha256": TRAINING.file_sha256(contract_paths["tool_catalog"]),
        "dataset_schema_sha256": TRAINING.file_sha256(contract_paths["dataset_schema"]),
        "evaluation_schema_sha256": TRAINING.file_sha256(contract_paths["evaluation_schema"]),
        "decoding_config_sha256": TRAINING.file_sha256(contract_paths["decoding_config"]),
        "runtime_contract_sha256": TRAINING.file_sha256(runtime_path),
        "requirements_lock_sha256": TRAINING.file_sha256(requirements_path),
        "run_manifest_schema_sha256": TRAINING.file_sha256(contract_paths["run_manifest_schema"]),
        "foundation_checksums_schema_sha256": TRAINING.file_sha256(
            contract_paths["foundation_checksums_schema"]
        ),
    }
    run_root = f"/workspace/runs/{EXPERIMENT_ID}"
    manifest = {
        "schema_version": "dime-run-manifest-v1",
        "experiment_id": EXPERIMENT_ID,
        "status": "preflight",
        "created_at_utc": "2026-07-26T12:00:00Z",
        "owner": "dime-ml-owner",
        "hypothesis": "Approved private foundation data improves tool routing.",
        "authorization": {
            "status": "authorized_for_full_training",
            "reference": "github-review-authorization",
            "approver": "dime-release-owner",
            "approved_at_utc": "2026-07-26T12:30:00Z",
        },
        "source": {
            "github_repository": TRAINING.GITHUB_REPOSITORY,
            "source_github_commit": SOURCE_SHA,
        },
        "datasets": {
            "foundation_sft": {
                **provenance["datasets"]["foundation_sft"],
                "dataset_manifest_sha256": DATASET_MANIFEST_HASH,
                "checksums_sha256": CHECKSUMS_HASH,
            },
            "development_eval": provenance["datasets"]["development_eval"],
            "locked_eval": provenance["datasets"]["locked_eval"],
        },
        "base_model": {
            "repo_id": TRAINING.PINNED_MODEL_ID,
            "revision": TRAINING.PINNED_MODEL_REVISION,
        },
        "starting_adapter": None,
        "contracts": contracts,
        "training": {
            "seed": 1729,
            "output_dir": f"{run_root}/checkpoints",
            "final_adapter_dir": f"{run_root}/adapters/final",
            "logs_dir": f"{run_root}/logs",
            "reports_dir": f"{run_root}/reports",
            "checkpoint_retention": {
                "save_steps": config["training"]["save_steps"],
                "save_total_limit": config["training"]["save_total_limit"],
            },
        },
        "environment": {
            "runpod_image": runtime["RUNPOD_IMAGE"],
            "python": runtime["PYTHON"],
            "pytorch": runtime["PYTORCH"],
            "cuda_runtime": runtime["CUDA_RUNTIME"],
            "gpu": runtime["GPU"],
        },
        "approvals": {
            "privacy": True,
            "provenance": True,
            "rights": True,
            "partition": True,
            "future_data": True,
            "semantic_deduplication": True,
            "evaluation_contamination": True,
        },
        "commands": ["python scripts/train_qlora.py --config configs/sft_full.yaml"],
        "results": {
            "final_artifact_sha256": None,
            "report_sha256": [],
        },
    }
    manifest_path = tmp_path / "run_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest_path, config, provenance, contract_paths


def validate_run_manifest_fixture(
    manifest_path: Path,
    config: dict,
    provenance: dict,
    contract_paths: dict[str, Path],
) -> dict:
    platform_contract = json.loads(
        (PROJECT / "configs/platform_contract.json").read_text(encoding="utf-8")
    )
    return TRAINING.validate_run_manifest(
        manifest_path=manifest_path,
        schema_path=RUN_MANIFEST_SCHEMA,
        config=config,
        config_path=manifest_path.parent / "sft_full.yaml",
        provenance=provenance,
        source_commit=SOURCE_SHA,
        foundation_dataset_manifest_sha256=DATASET_MANIFEST_HASH,
        foundation_checksums_sha256=CHECKSUMS_HASH,
        contract_paths=contract_paths,
        requirements_path=PROJECT / "requirements.lock.txt",
        runtime_path=PROJECT / "configs/runtime.env",
        platform_contract=platform_contract,
    )


def test_run_manifest_is_strict_and_cross_bound_before_training(tmp_path: Path) -> None:
    manifest_path, config, provenance, contract_paths = run_manifest_fixture(tmp_path)
    validated = validate_run_manifest_fixture(
        manifest_path,
        config,
        provenance,
        contract_paths,
    )
    assert validated["experiment_id"] == EXPERIMENT_ID

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["datasets"]["foundation_sft"]["checksums_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="dataset identities"):
        validate_run_manifest_fixture(manifest_path, config, provenance, contract_paths)

    manifest["unexpected"] = True
    manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="violates its schema"):
        validate_run_manifest_fixture(manifest_path, config, provenance, contract_paths)


def test_full_fingerprint_and_manifest_keep_all_provenance_and_hashes(
    tmp_path: Path,
) -> None:
    paths = {}
    for name in (
        "config",
        "train",
        "validation",
        "chat_template",
        "tool_catalog",
        "requirements",
        "runtime",
        "dataset_manifest",
        "curriculum",
        "system_prompt",
        "dataset_schema",
        "evaluation_schema",
        "decoding_config",
        "foundation_checksums",
        "run_manifest",
        "run_manifest_schema",
        "foundation_checksums_schema",
    ):
        path = tmp_path / name
        path.write_text(f"immutable fixture: {name}\n", encoding="utf-8")
        paths[name] = path

    provenance = TRAINING.assert_config(
        approved_full_config(),
        allow_full_run=True,
    )
    assert provenance is not None
    provenance["source"]["github_commit"] = SOURCE_SHA
    provenance["training_authorization"] = {"github_commit": "2" * 40}
    fingerprint = TRAINING.build_run_fingerprint(
        paths["config"],
        paths["train"],
        paths["validation"],
        paths["chat_template"],
        paths["tool_catalog"],
        paths["requirements"],
        paths["runtime"],
        paths["dataset_manifest"],
        paths["curriculum"],
        full_provenance=provenance,
        system_prompt_path=paths["system_prompt"],
        dataset_schema_path=paths["dataset_schema"],
        evaluation_schema_path=paths["evaluation_schema"],
        decoding_config_path=paths["decoding_config"],
        foundation_checksums_path=paths["foundation_checksums"],
        run_manifest_path=paths["run_manifest"],
        run_manifest_schema_path=paths["run_manifest_schema"],
        foundation_checksums_schema_path=paths["foundation_checksums_schema"],
    )

    assert fingerprint["source"] == provenance["source"]
    assert fingerprint["datasets"] == provenance["datasets"]
    assert fingerprint["experiment_id"] == EXPERIMENT_ID
    for field in TRAINING.FULL_FINGERPRINT_HASH_FIELDS:
        assert len(fingerprint[field]) == 64
        int(fingerprint[field], 16)
    assert fingerprint["system_prompt_sha256"] == TRAINING.file_sha256(paths["system_prompt"])
    fingerprint["training_platform_contract_sha256"] = "f" * 64
    TRAINING.validate_full_manifest_provenance(
        deepcopy(fingerprint),
        provenance,
    )

    tampered = deepcopy(fingerprint)
    tampered["datasets"] = "5.0.0"
    with pytest.raises(ValueError, match="datasets"):
        TRAINING.validate_full_manifest_provenance(tampered, provenance)


def test_rehearsal_config_remains_compatible_without_release_provenance() -> None:
    rehearsal = yaml.safe_load(REHEARSAL_CONFIG.read_text(encoding="utf-8"))
    assert TRAINING.assert_config(rehearsal, allow_full_run=False) is None


def test_saved_adapter_config_is_pinned_to_exact_parent_revision(
    tmp_path: Path,
) -> None:
    adapter_config = tmp_path / "adapter_config.json"
    adapter_config.write_text(
        json.dumps(
            {
                "base_model_name_or_path": TRAINING.PINNED_MODEL_ID,
                "revision": None,
                "peft_type": "LORA",
            }
        ),
        encoding="utf-8",
    )
    TRAINING.pin_adapter_config_revision(adapter_config)
    pinned = json.loads(adapter_config.read_text(encoding="utf-8"))
    assert pinned["revision"] == TRAINING.PINNED_MODEL_REVISION

    adapter_config.write_text(
        json.dumps({"base_model_name_or_path": "wrong/model"}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="unexpected parent"):
        TRAINING.pin_adapter_config_revision(adapter_config)


def test_final_adapter_promotion_cannot_clobber_a_racing_destination(
    tmp_path: Path,
) -> None:
    parent = tmp_path / "adapters"
    staging = parent / "final.staging"
    destination = parent / "final"
    staging.mkdir(parents=True)
    (staging / "adapter_model.safetensors").write_bytes(b"new adapter")

    def inject_destination_then_rename(source: Path, target: Path) -> None:
        assert source == staging
        assert target == destination
        target.mkdir()
        (target / "owner.txt").write_text("existing release\n", encoding="utf-8")
        raise FileExistsError(errno.EEXIST, "destination exists", str(target))

    with pytest.raises(SystemExit, match="existing release was not changed"):
        TRAINING.promote_adapter_directory_no_replace(
            staging,
            destination,
            rename=inject_destination_then_rename,
        )

    assert (destination / "owner.txt").read_text(encoding="utf-8") == "existing release\n"
    assert not (destination / "adapter_model.safetensors").exists()
    assert not staging.exists()


def test_final_adapter_promotion_rechecks_live_authorization_after_staging(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent = tmp_path / "adapters"
    staging = parent / "final.staging"
    destination = parent / "final"
    staging.mkdir(parents=True)
    (staging / "adapter_model.safetensors").write_bytes(b"staged adapter")
    governed = tmp_path / "governed.json"
    governed.write_text('{"authorized":true}\n', encoding="utf-8")
    captured = TRAINING.capture_bound_files([governed])
    manifest = {
        "approved_at_utc": "2026-07-26T12:00:00Z",
        "evidence_valid_until_utc": "2026-07-28T12:00:00Z",
    }
    authorization_calls: list[tuple[Path, str]] = []
    rename_calls = 0

    def revoked(project: Path, authorization_commit: str) -> None:
        authorization_calls.append((project, authorization_commit))
        raise ValueError("authorization revoked during adapter staging")

    def forbidden_rename(_source: Path, _target: Path) -> None:
        nonlocal rename_calls
        rename_calls += 1

    monkeypatch.setattr(
        TRAINING,
        "verify_authorization_checkout_still_current",
        revoked,
    )
    with pytest.raises(ValueError, match="revoked during adapter staging"):
        TRAINING.promote_adapter_after_execution_fence(
            staging,
            destination,
            production=True,
            project=tmp_path,
            governed_files=captured,
            foundation_manifest=manifest,
            authorization_commit="a" * 40,
            clock=lambda: datetime(2026, 7, 27, 12, tzinfo=UTC),
            rename=forbidden_rename,
        )

    assert authorization_calls == [(tmp_path, "a" * 40)]
    assert rename_calls == 0
    assert staging.exists()
    assert not destination.exists()


def test_final_adapter_promotion_uses_the_injected_no_replace_primitive(
    tmp_path: Path,
) -> None:
    parent = tmp_path / "adapters"
    staging = parent / "final.staging"
    destination = parent / "final"
    staging.mkdir(parents=True)
    (staging / "adapter_model.safetensors").write_bytes(b"approved adapter")
    calls: list[tuple[Path, Path]] = []

    def rename(source: Path, target: Path) -> None:
        calls.append((source, target))
        source.rename(target)

    TRAINING.promote_adapter_directory_no_replace(
        staging,
        destination,
        rename=rename,
    )

    assert calls == [(staging, destination)]
    assert (destination / "adapter_model.safetensors").read_bytes() == b"approved adapter"
    assert not staging.exists()


def test_full_template_and_decoding_contract_use_canonical_paths_and_values() -> None:
    template = yaml.safe_load(FULL_TEMPLATE.read_text(encoding="utf-8"))
    experiment_id = template["run"]["experiment_id"]
    run_root = f"/workspace/runs/{experiment_id}"
    foundation_placeholder = template["provenance"]["datasets"]["foundation_sft"]["revision"]
    assert foundation_placeholder in template["data"]["train"]
    assert foundation_placeholder in template["data"]["validation"]
    assert foundation_placeholder in template["data"]["manifest"]
    assert foundation_placeholder in template["data"]["checksums"]
    assert foundation_placeholder in template["data"]["dataset_card"]
    assert template["run"]["manifest"] == f"{run_root}/run_manifest.json"
    assert template["training"]["output_dir"] == f"{run_root}/checkpoints"
    assert template["training"]["final_adapter_dir"] == f"{run_root}/adapters/final"

    runbook = RUNPOD_RUNBOOK.read_text(encoding="utf-8")
    assert '"${DIME_RUN_DIR}/adapters" \\' in runbook
    assert '"${DIME_RUN_DIR}/adapters/final"' not in runbook
    assert "atomically renames it to `final/`" in runbook

    decoding = json.loads(DECODING_CONFIG.read_text(encoding="utf-8"))
    assert decoding == {
        "schema_version": "dime-decoding-v1",
        "purpose": "deterministic-release-evaluation",
        "do_sample": False,
        "temperature": 0,
        "top_p": 1,
        "max_new_tokens": 512,
        "seed": 1729,
    }
