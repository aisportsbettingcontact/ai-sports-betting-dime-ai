from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
LOADER_PATH = PROJECT / "src/dime_ai/foundation_contracts.py"


def contracts_api():
    assert LOADER_PATH.is_file(), "Step 2 shared Foundation contract loader is missing"
    return importlib.import_module("dime_ai.foundation_contracts")


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("configs", "schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def write_yaml(path: Path, document: dict) -> None:
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")


def test_valid_bundle_has_exact_registry_manifest_and_deterministic_identity() -> None:
    api = contracts_api()
    first = api.load_foundation_contracts()
    second = api.load_foundation_contracts()

    assert tuple(first.contracts) == (
        "numeric_policy",
        "separation_of_duties",
        "stage_profiles",
        "taxonomy",
    )
    assert [entry["name"] for entry in first.manifest["entries"]] == [
        "foundation_build",
        "numeric_policy",
        "separation_of_duties",
        "stage_profiles",
        "taxonomy",
    ]
    assert first.bundle_sha256 == second.bundle_sha256
    assert len(first.bundle_sha256) == 64
    assert api.canonical_contract_manifest_bytes([first.build, *first.contracts.values()]).endswith(
        b"\n"
    )


def test_individual_contract_lookup_and_unknown_name() -> None:
    api = contracts_api()
    assert api.load_foundation_contract("taxonomy").name == "taxonomy"
    with pytest.raises(api.FoundationContractError, match="unknown contract"):
        api.load_foundation_contract("unknown")


@pytest.mark.parametrize(
    ("relative_path", "kind"),
    [
        ("configs/foundation_taxonomy_v1.yaml", "config"),
        ("schemas/foundation_taxonomy.schema.json", "schema"),
    ],
)
def test_missing_registered_file_fails_closed(
    project_copy: Path,
    relative_path: str,
    kind: str,
) -> None:
    api = contracts_api()
    (project_copy / relative_path).unlink()
    with pytest.raises(api.FoundationContractError, match=rf"taxonomy.*{kind}.*missing"):
        api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    ("registry_field", "unsafe_value"),
    [
        ("config_path", "../foundation_taxonomy_v1.yaml"),
        ("config_path", "/tmp/foundation_taxonomy_v1.yaml"),
        ("config_path", r"configs\foundation_taxonomy_v1.yaml"),
        ("schema_path", "./schemas/foundation_taxonomy.schema.json"),
    ],
)
def test_unsafe_or_redirected_registry_path_fails_closed(
    project_copy: Path,
    registry_field: str,
    unsafe_value: str,
) -> None:
    api = contracts_api()
    build_path = project_copy / "configs/foundation_v1_build.yaml"
    build = load_yaml(build_path)
    build["contract_registry"]["contracts"]["taxonomy"][registry_field] = unsafe_value
    write_yaml(build_path, build)

    with pytest.raises(api.FoundationContractError, match="foundation_build"):
        api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize("target_kind", ["config", "schema"])
def test_registered_symlink_fails_closed(
    project_copy: Path,
    target_kind: str,
) -> None:
    api = contracts_api()
    relative = {
        "config": Path("configs/foundation_taxonomy_v1.yaml"),
        "schema": Path("schemas/foundation_taxonomy.schema.json"),
    }[target_kind]
    target = project_copy / relative
    real = target.with_suffix(target.suffix + ".real")
    target.rename(real)
    target.symlink_to(real.name)

    with pytest.raises(api.FoundationContractError, match="symlink"):
        api.load_foundation_contracts(project_root=project_copy)


def test_symlinked_project_ancestor_fails_closed(project_copy: Path) -> None:
    api = contracts_api()
    alias = project_copy.parent / "project-alias"
    alias.symlink_to(project_copy, target_is_directory=True)
    with pytest.raises(api.FoundationContractError, match="project_root.*symlink"):
        api.load_foundation_contracts(project_root=alias)


def test_registered_ancestor_symlink_fails_closed(project_copy: Path) -> None:
    api = contracts_api()
    schemas = project_copy / "schemas"
    real_schemas = project_copy / "schemas.real"
    schemas.rename(real_schemas)
    schemas.symlink_to(real_schemas.name, target_is_directory=True)

    with pytest.raises(api.FoundationContractError, match="symlink"):
        api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    "relative_path",
    [
        "configs/foundation_taxonomy_v1.yaml",
        "schemas/foundation_taxonomy.schema.json",
    ],
)
def test_registered_directory_fails_closed(project_copy: Path, relative_path: str) -> None:
    api = contracts_api()
    path = project_copy / relative_path
    path.unlink()
    path.mkdir()

    with pytest.raises(api.FoundationContractError, match="regular file"):
        api.load_foundation_contracts(project_root=project_copy)


def test_registered_fifo_fails_closed_without_blocking(project_copy: Path) -> None:
    caller_controlled = "caller-controlled-secret"
    controlled_project = project_copy.with_name(caller_controlled)
    project_copy.rename(controlled_project)
    fifo = controlled_project / "configs/foundation_taxonomy_v1.yaml"
    fifo.unlink()
    os.mkfifo(fifo)

    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import sys\n"
                "from dime_ai.foundation_contracts import "
                "FoundationContractError, load_foundation_contracts\n"
                "try:\n"
                "    load_foundation_contracts(project_root=sys.argv[1])\n"
                "except FoundationContractError as exc:\n"
                "    print(f'FOUNDATION_ERROR: {exc}')\n"
                "    raise SystemExit(7)\n"
                "raise SystemExit(0)\n"
            ),
            str(controlled_project),
        ],
        cwd=PROJECT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    started = time.monotonic()
    try:
        stdout, stderr = child.communicate(timeout=2.0)
    except subprocess.TimeoutExpired:
        child.kill()
        child.communicate()
        pytest.fail("governed FIFO validation exceeded the outer timeout")
    elapsed = time.monotonic() - started
    output = stdout + stderr

    assert elapsed < 2.0
    assert child.returncode == 7
    assert "FOUNDATION_ERROR:" in output
    assert "expected a regular file" in output
    assert str(controlled_project) not in output
    assert caller_controlled not in output


def test_loader_does_not_reopen_validated_paths(
    project_copy: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = contracts_api()

    def reject_pathname_reopen(path: Path) -> bytes:
        raise AssertionError(f"unexpected pathname reopen for {path.name}")

    monkeypatch.setattr(Path, "read_bytes", reject_pathname_reopen)

    bundle = api.load_foundation_contracts(project_root=project_copy)
    assert bundle.contracts["taxonomy"].document["status"] == "proposed"


@pytest.mark.parametrize(
    ("payload", "reason"),
    [
        (b"", "object"),
        (b"- item\n", "object"),
        (b"status: proposed\n---\nstatus: proposed\n", "single YAML document"),
        (b"status: proposed\nstatus: proposed\n", "duplicate YAML key"),
        (b"root: &anchor value\ncopy: *anchor\n", "YAML aliases"),
        (b"base: &base\n  value: one\nmerged:\n  <<: *base\n", "YAML"),
        (b"1: value\n", "string mapping keys"),
        (b"value: .nan\n", "finite"),
        (b"\xff", "UTF-8"),
    ],
)
def test_strict_yaml_rejects_unsafe_documents(
    project_copy: Path,
    payload: bytes,
    reason: str,
) -> None:
    api = contracts_api()
    (project_copy / "configs/foundation_taxonomy_v1.yaml").write_bytes(payload)
    with pytest.raises(api.FoundationContractError, match=reason):
        api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    ("payload", "reason"),
    [
        (b"{", "invalid JSON"),
        (
            b'{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","type":"object"}',
            "duplicate JSON key",
        ),
        (b'{"$schema":"http://json-schema.org/draft-07/schema#","type":"object"}', "Draft 2020-12"),
        (
            b'{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"https://example.test/schema.json"}',
            "local",
        ),
        (
            b'{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"not-a-type"}',
            "invalid JSON Schema",
        ),
        (b"\xff", "UTF-8"),
    ],
)
def test_strict_schema_loading_rejects_unsafe_json(
    project_copy: Path,
    payload: bytes,
    reason: str,
) -> None:
    api = contracts_api()
    (project_copy / "schemas/foundation_taxonomy.schema.json").write_bytes(payload)
    with pytest.raises(api.FoundationContractError, match=reason):
        api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize("overflow", [b"1e10000", b"-1e10000"])
def test_strict_schema_rejects_exponent_overflow(
    project_copy: Path,
    overflow: bytes,
) -> None:
    api = contracts_api()
    schema_path = project_copy / "schemas/foundation_taxonomy.schema.json"
    schema = schema_path.read_bytes().rstrip()
    assert schema.endswith(b"}")
    schema_path.write_bytes(schema[:-1] + b',"x-overflow":' + overflow + b"}\n")

    with pytest.raises(api.FoundationContractError, match="finite"):
        api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize("keyword", ["$dynamicRef", "$recursiveRef"])
def test_strict_schema_rejects_remote_reference_keywords(
    project_copy: Path,
    keyword: str,
) -> None:
    api = contracts_api()
    schema_path = project_copy / "schemas/foundation_taxonomy.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    schema.setdefault("$defs", {})["unused_external_reference"] = {
        keyword: "https://example.invalid/attacker-controlled-schema.json"
    }
    schema_path.write_text(json.dumps(schema), encoding="utf-8")

    with pytest.raises(api.FoundationContractError, match="local") as failure:
        api.load_foundation_contracts(project_root=project_copy)
    assert "example.invalid" not in str(failure.value)


def test_strict_schema_accepts_local_dynamic_reference(project_copy: Path) -> None:
    api = contracts_api()
    schema_path = project_copy / "schemas/foundation_taxonomy.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    schema.setdefault("$defs", {}).update(
        {
            "local_dynamic_target": {
                "$dynamicAnchor": "local_dynamic_target",
                "type": "object",
            },
            "unused_local_dynamic_reference": {
                "$dynamicRef": "#local_dynamic_target",
            },
        }
    )
    schema_path.write_text(json.dumps(schema), encoding="utf-8")

    assert api.load_foundation_contracts(project_root=project_copy).contracts["taxonomy"]


@pytest.mark.parametrize(
    "payload_factory",
    [
        lambda key: f"{key}: one\n{key}: two\n".encode(),
        lambda key: f"{key}: .nan\n".encode(),
    ],
)
def test_yaml_parser_errors_are_bounded_deterministic_and_do_not_echo_keys(
    project_copy: Path,
    payload_factory,
) -> None:
    api = contracts_api()
    secret_key = "secret_token_material_" + ("x" * 512)
    (project_copy / "configs/foundation_taxonomy_v1.yaml").write_bytes(payload_factory(secret_key))

    messages = []
    for _ in range(2):
        with pytest.raises(api.FoundationContractError) as failure:
            api.load_foundation_contracts(project_root=project_copy)
        messages.append(str(failure.value))

    assert messages[0] == messages[1]
    assert len(messages[0]) <= 2_048
    assert secret_key not in messages[0]
    assert "secret_token_material" not in messages[0]
    assert "taxonomy config configs/foundation_taxonomy_v1.yaml" in messages[0]


def test_json_parser_errors_are_bounded_deterministic_and_do_not_echo_keys(
    project_copy: Path,
) -> None:
    api = contracts_api()
    secret_key = "secret_token_material_" + ("x" * 4_096)
    payload = (
        b'{"$schema":"https://json-schema.org/draft/2020-12/schema","'
        + secret_key.encode()
        + b'":true,"'
        + secret_key.encode()
        + b'":false}'
    )
    (project_copy / "schemas/foundation_taxonomy.schema.json").write_bytes(payload)

    messages = []
    for _ in range(2):
        with pytest.raises(api.FoundationContractError) as failure:
            api.load_foundation_contracts(project_root=project_copy)
        messages.append(str(failure.value))

    assert messages[0] == messages[1]
    assert len(messages[0]) <= 2_048
    assert secret_key not in messages[0]
    assert "secret_token_material" not in messages[0]
    assert "taxonomy schema schemas/foundation_taxonomy.schema.json" in messages[0]


def test_caller_controlled_contract_and_manifest_names_are_not_echoed() -> None:
    api = contracts_api()
    secret_name = "secret_token_material_" + ("x" * 4_096)

    unknown_messages = []
    for _ in range(2):
        with pytest.raises(api.FoundationContractError) as failure:
            api.load_foundation_contract(secret_name)
        unknown_messages.append(str(failure.value))
    assert unknown_messages[0] == unknown_messages[1]
    assert len(unknown_messages[0]) <= 2_048
    assert "secret_token_material" not in unknown_messages[0]
    assert "unknown contract name" in unknown_messages[0]

    build = api.load_foundation_contracts().build
    duplicate = replace(build, name=secret_name)
    manifest_messages = []
    for _ in range(2):
        with pytest.raises(api.FoundationContractError) as failure:
            api.canonical_contract_manifest_bytes([duplicate, duplicate])
        manifest_messages.append(str(failure.value))
    assert manifest_messages[0] == manifest_messages[1]
    assert len(manifest_messages[0]) <= 2_048
    assert "secret_token_material" not in manifest_messages[0]
    assert "bundle manifest" in manifest_messages[0]


def test_hashes_change_when_validated_config_or_schema_bytes_change(project_copy: Path) -> None:
    api = contracts_api()
    first = api.load_foundation_contracts(project_root=project_copy)
    config_path = project_copy / "configs/foundation_taxonomy_v1.yaml"
    config_path.write_bytes(config_path.read_bytes() + b"\n")
    second = api.load_foundation_contracts(project_root=project_copy)
    schema_path = project_copy / "schemas/foundation_taxonomy.schema.json"
    schema_path.write_bytes(schema_path.read_bytes() + b"\n")
    third = api.load_foundation_contracts(project_root=project_copy)

    assert first.contracts["taxonomy"].config_sha256 != second.contracts["taxonomy"].config_sha256
    assert first.bundle_sha256 != second.bundle_sha256
    assert second.contracts["taxonomy"].schema_sha256 != third.contracts["taxonomy"].schema_sha256
    assert second.bundle_sha256 != third.bundle_sha256


def test_stale_foundation_tool_contract_hash_fails_closed(project_copy: Path) -> None:
    api = contracts_api()
    build_path = project_copy / "configs/foundation_v1_build.yaml"
    build = load_yaml(build_path)
    build["tool_contract_bundle_sha256"] = "0" * 64
    write_yaml(build_path, build)

    with pytest.raises(api.FoundationContractError, match="tool contract bundle mismatch"):
        api.load_foundation_contracts(project_root=project_copy)


def test_second_load_observes_changed_bytes_and_documents_are_immutable(
    project_copy: Path,
) -> None:
    api = contracts_api()
    first = api.load_foundation_contracts(project_root=project_copy)
    with pytest.raises(TypeError):
        first.contracts["taxonomy"].document["status"] = "active"

    config_path = project_copy / "configs/foundation_taxonomy_v1.yaml"
    config_path.write_bytes(config_path.read_bytes() + b"\n")
    second = api.load_foundation_contracts(project_root=project_copy)
    assert first.contracts["taxonomy"].config_sha256 != second.contracts["taxonomy"].config_sha256
    assert second.contracts["taxonomy"].document["status"] == "proposed"


def test_schema_errors_are_bounded_deterministic_and_sanitized(project_copy: Path) -> None:
    api = contracts_api()
    config_path = project_copy / "configs/foundation_taxonomy_v1.yaml"
    config_path.write_text("{}\n", encoding="utf-8")

    messages = []
    for _ in range(2):
        with pytest.raises(api.FoundationContractError) as failure:
            api.load_foundation_contracts(project_root=project_copy)
        messages.append(str(failure.value))

    assert messages[0] == messages[1]
    assert "foundation_taxonomy_v1.yaml" in messages[0]
    assert str(project_copy) not in messages[0]
    assert messages[0].count("\n") <= 20


def test_child_schema_version_mismatch_fails_closed(project_copy: Path) -> None:
    api = contracts_api()
    config_path = project_copy / "configs/foundation_taxonomy_v1.yaml"
    taxonomy = load_yaml(config_path)
    taxonomy["schema_version"] = "dime-foundation-taxonomy-v2"
    write_yaml(config_path, taxonomy)
    with pytest.raises(api.FoundationContractError, match="schema_version"):
        api.load_foundation_contracts(project_root=project_copy)


def test_manifest_bytes_are_canonical_json() -> None:
    api = contracts_api()
    bundle = api.load_foundation_contracts()
    encoded = api.canonical_contract_manifest_bytes([bundle.build, *bundle.contracts.values()])
    parsed = json.loads(encoded)
    assert parsed == {
        "schema_version": "dime-foundation-contract-bundle-manifest-v1",
        "entries": [dict(entry) for entry in bundle.manifest["entries"]],
    }
