from __future__ import annotations

import json
import shutil
import socket
import stat
from pathlib import Path

import pytest

from dime_ai.reviewer_runtime import (
    EXPECTED_REVIEWERS,
    ReviewerRuntimeError,
    build_queue_request,
    canonical_queue_request_bytes,
    load_reviewer_runtime,
    sanitized_endpoint_plans,
    validate_reviewer_decision,
    write_sanitized_endpoint_plans,
)

PROJECT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path("configs/foundation_reviewer_runtime_v1.json")


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("configs", "prompts", "schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, document: dict) -> None:
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def valid_decision(reviewer_id: str) -> dict:
    return {
        "schema_version": "dime-foundation-reviewer-decision-v1",
        "reviewer_id": reviewer_id,
        "decision": "changes_requested",
        "confidence": 0.9,
        "findings": [
            {
                "code": "numeric_mismatch",
                "severity": "high",
                "message": "The supplied calculation does not reproduce from the evidence.",
                "evidence_paths": ["record.numeric_trace.expected_value"],
            }
        ],
        "limitations": ["No external data was consulted."],
    }


def test_valid_runtime_has_exact_inactive_immutable_identities() -> None:
    first = load_reviewer_runtime()
    second = load_reviewer_runtime()

    assert first.contract_sha256 == second.contract_sha256
    assert len(first.contract_sha256) == 64
    assert first.document["status"] == "planned_unprovisioned"
    assert first.document["activation_authorized"] is False
    assert first.document["runtime"]["worker_source"] == {
        "repository": "runpod-workers/worker-vllm",
        "release": "v2.22.5",
        "source_revision": "9e1c4831366e828cad978ced046b1e2e56664e19",
    }
    container = first.document["runtime"]["container"]
    assert container["linux_amd64_digest"] == (
        "sha256:d8bc05a0b87d5a07a2112c7919b1995a5908651d46b9b43d8dd367fa4b2724f1"
    )
    assert container["runtime_version"] == (
        "d8bc05a0b87d5a07a2112c7919b1995a5908651d46b9b43d8dd367fa4b2724f1"
    )
    reviewers = {item["reviewer_id"]: item for item in first.document["reviewers"]}
    assert set(reviewers) == set(EXPECTED_REVIEWERS)
    assert {(item["model_id"], item["model_revision"]) for item in reviewers.values()} == {
        ("Qwen/Qwen3-32B", "9216db5781bf21249d130ec9da846c4624c16137"),
        (
            "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
            "95a6d26c4bfb886c58daf9d3f7332c857cb27b43",
        ),
    }
    assert all(item["active"] is False for item in reviewers.values())
    assert all(item["endpoint"]["endpoint_id"] is None for item in reviewers.values())
    assert all(item["endpoint"]["workload_identity_id"] is None for item in reviewers.values())
    assert all(item["endpoint"]["minimum_vram_gb"] >= 80 for item in reviewers.values())
    assert all(item["endpoint"]["workers_min"] == 0 for item in reviewers.values())
    assert all(item["endpoint"]["workers_max"] == 1 for item in reviewers.values())
    assert (
        reviewers["dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980"]["endpoint"]["environment"][
            "MAX_MODEL_LEN"
        ]
        == "16384"
    )
    assert all(
        item["endpoint"]["environment"]["ENABLE_LOG_REQUESTS"] == "false"
        for item in reviewers.values()
    )


def test_sanitized_endpoint_plans_are_deterministic_and_secretless() -> None:
    runtime = load_reviewer_runtime()
    first = sanitized_endpoint_plans(runtime)
    second = sanitized_endpoint_plans(runtime)

    assert first == second
    assert [name for name, _ in first] == [
        "mistral-evidence-policy.runpod-plan.json",
        "qwen3-quantitative.runpod-plan.json",
    ]
    for _, plan in first:
        encoded = canonical_queue_request_bytes(plan)
        assert encoded.endswith(b"\n")
        assert plan["status"] == "planned_unprovisioned"
        assert plan["activation_authorized"] is False
        assert plan["endpoint_id"] is None
        assert plan["workload_identity_id"] is None
        assert plan["secret_environment"] == ()
        assert plan["compute"]["workers_min"] == 0
        assert plan["compute"]["workers_max"] == 1
        assert b"HF_TOKEN" not in encoded
        assert b"RUNPOD_API_KEY" not in encoded
        assert b"Bearer " not in encoded
        assert b"hf_" not in encoded


def test_queue_request_matches_pinned_worker_openai_contract() -> None:
    runtime = load_reviewer_runtime()
    reviewer_id = "dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980"
    review_input = {
        "record_id": "sft_000001",
        "record_sha256": "0" * 64,
        "evidence": {"american_odds": -110, "modeled_probability": 0.55},
    }

    first = build_queue_request(
        runtime,
        reviewer_id=reviewer_id,
        review_input=review_input,
    )
    second = build_queue_request(
        runtime,
        reviewer_id=reviewer_id,
        review_input=review_input,
    )

    assert canonical_queue_request_bytes(first) == canonical_queue_request_bytes(second)
    inner = first["input"]
    assert inner["openai_route"] == "/v1/chat/completions"
    openai_input = inner["openai_input"]
    assert openai_input["model"] == "dime-foundation-quantitative-reviewer-v1"
    assert openai_input["temperature"] == 0.6
    assert openai_input["top_p"] == 0.95
    assert openai_input["top_k"] == 20
    assert openai_input["seed"] == 0
    assert openai_input["n"] == 1
    assert openai_input["stream"] is False
    assert openai_input["response_format"] == {"type": "json_object"}
    assert openai_input["chat_template_kwargs"] == {"enable_thinking": False}
    assert [message["role"] for message in openai_input["messages"]] == ["system", "user"]
    assert reviewer_id in openai_input["messages"][0]["content"]
    request_evidence = json.loads(openai_input["messages"][1]["content"])
    assert request_evidence["review_input"] == review_input
    assert b"endpoint_id" not in canonical_queue_request_bytes(first)


def test_valid_decision_is_strict_but_never_authorizes() -> None:
    reviewer_id = "dime-reviewer-c3ddb330-def3-4406-9325-1b4d48d32543"
    decision = validate_reviewer_decision(reviewer_id, valid_decision(reviewer_id))

    assert decision["decision"] == "changes_requested"
    assert decision["reviewer_id"] == reviewer_id
    assert "authorization_effect" not in decision


@pytest.mark.parametrize(
    "mutation",
    [
        "active",
        "model_alias",
        "mutable_image",
        "small_gpu",
        "secret_environment",
        "endpoint_id",
        "duplicate_lineage",
    ],
)
def test_unsafe_runtime_mutations_fail_closed(project_copy: Path, mutation: str) -> None:
    path = project_copy / CONFIG_PATH
    document = read_json(path)
    qwen, mistral = document["reviewers"]
    if mutation == "active":
        qwen["active"] = True
    elif mutation == "model_alias":
        qwen["model_revision"] = "main"
    elif mutation == "mutable_image":
        document["runtime"]["container"]["deploy_ref"] = "docker.io/runpod/worker-v1-vllm:latest"
    elif mutation == "small_gpu":
        qwen["endpoint"]["minimum_vram_gb"] = 24
    elif mutation == "secret_environment":
        qwen["endpoint"]["environment"]["HF_TOKEN"] = "hf_" + ("A" * 30)
        qwen["endpoint"]["secret_environment"] = ["HF_TOKEN"]
    elif mutation == "endpoint_id":
        qwen["endpoint"]["endpoint_id"] = "endpoint-123"
    elif mutation == "duplicate_lineage":
        mistral["policy_lineage_id"] = qwen["policy_lineage_id"]
    write_json(path, document)

    with pytest.raises(ReviewerRuntimeError):
        load_reviewer_runtime(project_copy)


def test_policy_artifact_tampering_fails_closed(project_copy: Path) -> None:
    prompt = project_copy / "prompts/reviewers/qwen3_quantitative_system_v1.md"
    prompt.write_text(prompt.read_text(encoding="utf-8") + "\nTampered.\n", encoding="utf-8")

    with pytest.raises(ReviewerRuntimeError, match="artifact digest mismatch"):
        load_reviewer_runtime(project_copy)


def test_registry_or_platform_activation_fails_closed(project_copy: Path) -> None:
    registry_path = project_copy / "configs/foundation_reviewer_registry.json"
    registry = read_json(registry_path)
    registry["reviewers"][0]["active"] = True
    write_json(registry_path, registry)

    with pytest.raises(ReviewerRuntimeError):
        load_reviewer_runtime(project_copy)

    shutil.copy2(PROJECT / "configs/foundation_reviewer_registry.json", registry_path)
    platform_path = project_copy / "configs/platform_contract.json"
    platform = read_json(platform_path)
    platform["authorization"]["serving"] = True
    write_json(platform_path, platform)

    with pytest.raises(ReviewerRuntimeError, match="authorization gates"):
        load_reviewer_runtime(project_copy)


def test_queue_request_rejects_secret_fields_and_noncanonical_values() -> None:
    runtime = load_reviewer_runtime()
    reviewer_id = "dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980"

    with pytest.raises(ReviewerRuntimeError, match="secret-bearing"):
        build_queue_request(
            runtime,
            reviewer_id=reviewer_id,
            review_input={"api_key": "not-permitted"},
        )
    with pytest.raises(ReviewerRuntimeError, match="canonical JSON"):
        build_queue_request(
            runtime,
            reviewer_id=reviewer_id,
            review_input={"value": float("nan")},
        )
    with pytest.raises(ReviewerRuntimeError, match="input exceeds"):
        build_queue_request(
            runtime,
            reviewer_id=reviewer_id,
            review_input={"oversized_evidence": "x" * (13 * 1024)},
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", "wrong"),
        ("reviewer_id", "dime-reviewer-wrong"),
        ("decision", "maybe"),
        ("confidence", 1.1),
        ("findings", "not-an-array"),
        ("limitations", []),
    ],
)
def test_malformed_decisions_fail_closed(field: str, value: object) -> None:
    reviewer_id = "dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980"
    decision = valid_decision(reviewer_id)
    decision[field] = value
    if field == "limitations":
        decision["limitations"] = [""]

    with pytest.raises(ReviewerRuntimeError):
        validate_reviewer_decision(reviewer_id, decision)


def test_plans_write_only_outside_worktree_with_mode_0600(tmp_path: Path) -> None:
    destination = tmp_path / "plans"
    destination.mkdir()

    outputs = write_sanitized_endpoint_plans(destination)

    assert len(outputs) == 2
    for path, digest in outputs:
        assert path.parent == destination
        assert len(digest) == 64
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        document = read_json(path)
        assert document["status"] == "planned_unprovisioned"
        assert document["activation_authorized"] is False

    with pytest.raises(ReviewerRuntimeError, match="refusing to overwrite"):
        write_sanitized_endpoint_plans(destination)


def test_plan_output_inside_worktree_is_rejected() -> None:
    with pytest.raises(ReviewerRuntimeError, match="outside the Git worktree"):
        write_sanitized_endpoint_plans(PROJECT / "configs")


def test_preexisting_plan_prevents_partial_output(tmp_path: Path) -> None:
    destination = tmp_path / "plans"
    destination.mkdir()
    occupied = destination / "qwen3-quantitative.runpod-plan.json"
    occupied.write_text("owner-controlled\n", encoding="utf-8")

    with pytest.raises(ReviewerRuntimeError, match="refusing to overwrite"):
        write_sanitized_endpoint_plans(destination)

    assert occupied.read_text(encoding="utf-8") == "owner-controlled\n"
    assert not (destination / "mistral-evidence-policy.runpod-plan.json").exists()


def test_validation_and_request_build_are_offline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_network(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("unexpected network use")

    monkeypatch.setattr(socket.socket, "connect", reject_network)
    runtime = load_reviewer_runtime()
    request = build_queue_request(
        runtime,
        reviewer_id="dime-reviewer-c3ddb330-def3-4406-9325-1b4d48d32543",
        review_input={"record_id": "sft_000002", "evidence": {"source_status": "complete"}},
    )

    assert request["input"]["openai_input"]["model"] == (
        "dime-foundation-evidence-policy-reviewer-v1"
    )
    assert "chat_template_kwargs" not in request["input"]["openai_input"]
