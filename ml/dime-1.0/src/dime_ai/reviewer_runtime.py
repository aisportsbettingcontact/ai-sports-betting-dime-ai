"""Offline contract tooling for inactive RunPod Foundation reviewer candidates."""

from __future__ import annotations

import hashlib
import math
import os
import re
import stat
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_contracts import (
    FoundationContractError,
    _capture_json,
    _capture_schema,
    _freeze,
    _parse_strict_json,
    _project_directory,
    _read_file_once,
    _validate_document,
)

RUNTIME_CONFIG_PATH = "configs/foundation_reviewer_runtime_v1.json"
RUNTIME_SCHEMA_PATH = "schemas/foundation_reviewer_runtime.schema.json"
REGISTRY_PATH = "configs/foundation_reviewer_registry.json"
REGISTRY_SCHEMA_PATH = "schemas/foundation_reviewer_registry.schema.json"
PLATFORM_CONTRACT_PATH = "configs/platform_contract.json"
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_REVIEW_INPUT_BYTES = 12 * 1024
MAX_ERROR_LENGTH = 2048
REVIEW_DECISION_SCHEMA_VERSION = "dime-foundation-reviewer-decision-v1"
AUTHORIZATION_EFFECT_KEYS = frozenset(
    {
        "activates_reviewer",
        "approves_data",
        "authorizes_gpu_execution",
        "authorizes_training",
        "authorizes_locked_evaluation",
        "authorizes_publication",
        "authorizes_release",
        "authorizes_serving",
        "authorizes_provider_activation",
    }
)
PROHIBITED_SECRET_KEYS = frozenset(
    {
        "access_token",
        "api_key",
        "authorization",
        "credential",
        "hf_token",
        "password",
        "private_key",
        "runpod_api_key",
        "secret",
    }
)
SECRET_VALUE_PATTERN = re.compile(
    r"(?:"
    r"hf_[A-Za-z0-9]{20,}"
    r"|rpa_[A-Za-z0-9]{20,}"
    r"|sk-[A-Za-z0-9]{20,}"
    r"|Bearer\s+\S+"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r")"
)
FINDING_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$")

EXPECTED_RUNTIME = MappingProxyType(
    {
        "provider": "runpod_serverless",
        "endpoint_type": "queue",
        "worker_source": {
            "repository": "runpod-workers/worker-vllm",
            "release": "v2.22.5",
            "source_revision": "9e1c4831366e828cad978ced046b1e2e56664e19",
        },
        "container": {
            "repository": "docker.io/runpod/worker-v1-vllm",
            "release": "v2.22.5",
            "oci_index_digest": (
                "sha256:c7ca85687e77359708a984dc8fa62254494c432430a0ac89f7f7f516ac52faed"
            ),
            "linux_amd64_digest": (
                "sha256:d8bc05a0b87d5a07a2112c7919b1995a5908651d46b9b43d8dd367fa4b2724f1"
            ),
            "deploy_ref": (
                "docker.io/runpod/worker-v1-vllm:v2.22.5@"
                "sha256:d8bc05a0b87d5a07a2112c7919b1995a5908651d46b9b43d8dd367fa4b2724f1"
            ),
            "runtime_version": ("d8bc05a0b87d5a07a2112c7919b1995a5908651d46b9b43d8dd367fa4b2724f1"),
            "platform": "linux/amd64",
            "vllm_version": "0.20.2",
            "cuda_version": "13.0.2",
        },
        "security": {
            "secrets_in_repository_allowed": False,
            "network_calls_during_planning_allowed": False,
            "custom_handler": False,
            "model_weights_baked_in": False,
        },
    }
)

EXPECTED_REVIEWERS: Mapping[str, Mapping[str, Any]] = MappingProxyType(
    {
        "dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980": MappingProxyType(
            {
                "profile_id": "dime-agent-profile-85ef4149-03e2-49ae-b8a4-2767e8627404",
                "independence_group_id": (
                    "dime-independence-group-7e33b5f6-5167-4a16-b3a3-ec7d27140b1d"
                ),
                "model_id": "Qwen/Qwen3-32B",
                "model_revision": "9216db5781bf21249d130ec9da846c4624c16137",
                "model_lineage_id": "qwen-qwen3-32b",
                "policy_lineage_id": "dime-foundation-quantitative-review-v1",
                "roles": (
                    "domain",
                    "numeric",
                    "simulation",
                    "semantic-audit",
                    "dataset-approver",
                ),
                "served_model_name": "dime-foundation-quantitative-reviewer-v1",
                "plan_filename": "qwen3-quantitative.runpod-plan.json",
                "environment": MappingProxyType(
                    {
                        "MODEL_NAME": "Qwen/Qwen3-32B",
                        "MODEL_REVISION": "9216db5781bf21249d130ec9da846c4624c16137",
                        "TOKENIZER_REVISION": "9216db5781bf21249d130ec9da846c4624c16137",
                        "DTYPE": "bfloat16",
                        "MAX_MODEL_LEN": "16384",
                        "TENSOR_PARALLEL_SIZE": "1",
                        "GPU_MEMORY_UTILIZATION": "0.90",
                        "MAX_CONCURRENCY": "1",
                        "MAX_NUM_SEQS": "1",
                        "SEED": "0",
                        "ENABLE_LOG_REQUESTS": "false",
                        "TRUST_REMOTE_CODE": "false",
                        "REASONING_PARSER": "qwen3",
                        "OPENAI_SERVED_MODEL_NAME_OVERRIDE": (
                            "dime-foundation-quantitative-reviewer-v1"
                        ),
                    }
                ),
                "request_policy": MappingProxyType(
                    {
                        "temperature": 0.6,
                        "top_p": 0.95,
                        "top_k": 20,
                        "max_tokens": 2048,
                        "seed": 0,
                        "response_format": "json_object",
                    }
                ),
            }
        ),
        "dime-reviewer-c3ddb330-def3-4406-9325-1b4d48d32543": MappingProxyType(
            {
                "profile_id": "dime-agent-profile-1a0eb37e-2be7-40c7-bae5-d2e71a2889b1",
                "independence_group_id": (
                    "dime-independence-group-0734717e-69c8-4cc4-a1b6-bbb33f404be5"
                ),
                "model_id": "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
                "model_revision": "95a6d26c4bfb886c58daf9d3f7332c857cb27b43",
                "model_lineage_id": "mistral-small-3.2-24b-instruct",
                "policy_lineage_id": "dime-foundation-evidence-policy-review-v1",
                "roles": (
                    "coaching",
                    "safety",
                    "privacy",
                    "rights",
                    "evaluation-audit",
                    "locked-evaluation",
                    "dataset-approver",
                ),
                "served_model_name": "dime-foundation-evidence-policy-reviewer-v1",
                "plan_filename": "mistral-evidence-policy.runpod-plan.json",
                "environment": MappingProxyType(
                    {
                        "MODEL_NAME": "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
                        "MODEL_REVISION": "95a6d26c4bfb886c58daf9d3f7332c857cb27b43",
                        "TOKENIZER_REVISION": "95a6d26c4bfb886c58daf9d3f7332c857cb27b43",
                        "DTYPE": "bfloat16",
                        "MAX_MODEL_LEN": "32768",
                        "TENSOR_PARALLEL_SIZE": "1",
                        "GPU_MEMORY_UTILIZATION": "0.90",
                        "MAX_CONCURRENCY": "1",
                        "MAX_NUM_SEQS": "1",
                        "SEED": "0",
                        "ENABLE_LOG_REQUESTS": "false",
                        "TRUST_REMOTE_CODE": "false",
                        "TOKENIZER_MODE": "mistral",
                        "CONFIG_FORMAT": "mistral",
                        "LOAD_FORMAT": "mistral",
                        "OPENAI_SERVED_MODEL_NAME_OVERRIDE": (
                            "dime-foundation-evidence-policy-reviewer-v1"
                        ),
                    }
                ),
                "request_policy": MappingProxyType(
                    {
                        "temperature": 0.15,
                        "top_p": 1.0,
                        "top_k": -1,
                        "max_tokens": 2048,
                        "seed": 0,
                        "response_format": "json_object",
                    }
                ),
            }
        ),
    }
)


class ReviewerRuntimeError(ValueError):
    """Raised when the inactive reviewer runtime contract fails closed."""

    def __init__(self, message: str) -> None:
        bounded = message
        if len(bounded) > MAX_ERROR_LENGTH:
            bounded = bounded[: MAX_ERROR_LENGTH - 3] + "..."
        super().__init__(bounded)


@dataclass(frozen=True)
class LoadedReviewerRuntime:
    """A validated, inactive reviewer runtime candidate and its byte identities."""

    project_root: Path
    document: Mapping[str, Any]
    artifacts: Mapping[str, bytes]
    config_sha256: str
    schema_sha256: str
    contract_sha256: str


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_plain(item) for item in value]
    return value


def _ensure_no_secret_values(value: Any, *, label: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).lower()
            if normalized in PROHIBITED_SECRET_KEYS or normalized.endswith(
                ("_access_token", "_api_key", "_password", "_private_key")
            ):
                raise ReviewerRuntimeError(f"{label}: secret-bearing fields are prohibited")
            _ensure_no_secret_values(item, label=label)
        return
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for item in value:
            _ensure_no_secret_values(item, label=label)
        return
    if isinstance(value, str) and SECRET_VALUE_PATTERN.search(value):
        raise ReviewerRuntimeError(f"{label}: secret-like values are prohibited")


def _require_false_authorization_effect(value: Any, *, label: str) -> None:
    if (
        not isinstance(value, Mapping)
        or set(value) != AUTHORIZATION_EFFECT_KEYS
        or any(item is not False for item in value.values())
    ):
        raise ReviewerRuntimeError(f"{label}: authorization must remain fully blocked")


def _require_blocked_platform(root: Path) -> None:
    _, platform = _capture_json(
        root,
        PLATFORM_CONTRACT_PATH,
        logical_name="platform_contract",
        kind="config",
    )
    expected_authorization = {
        "full_training": False,
        "locked_evaluation": False,
        "adapter_publication": False,
        "serving": False,
        "provider_activation": False,
        "training_candidate": None,
        "release_candidate": None,
    }
    owner = platform.get("foundation_v1_owner_decision")
    reviewer_authority = owner.get("reviewer_authority") if isinstance(owner, dict) else None
    effect = owner.get("authorization_effect") if isinstance(owner, dict) else None
    if (
        platform.get("status") != "foundation_only"
        or platform.get("authorization") != expected_authorization
        or not isinstance(reviewer_authority, dict)
        or reviewer_authority.get("activation_authorized") is not False
        or reviewer_authority.get("ai_agent_activation_authorized") is not False
        or not isinstance(effect, dict)
        or not effect
        or any(item is not False for item in effect.values())
    ):
        raise ReviewerRuntimeError("platform contract: authorization gates must remain blocked")


def _registry_reviewers(root: Path) -> dict[str, dict[str, Any]]:
    _, schema = _capture_schema(
        root,
        REGISTRY_SCHEMA_PATH,
        logical_name="reviewer_registry",
    )
    _, registry = _capture_json(
        root,
        REGISTRY_PATH,
        logical_name="reviewer_registry",
        kind="config",
    )
    _validate_document(registry, schema, label="reviewer_registry")
    if (
        registry.get("status") != "proposed"
        or registry.get("receipt_verifier", {}).get("activation_authorized") is not False
    ):
        raise ReviewerRuntimeError("reviewer registry: must remain proposed and inactive")
    indexed = {reviewer["reviewer_id"]: reviewer for reviewer in registry["reviewers"]}
    if set(indexed) != set(EXPECTED_REVIEWERS):
        raise ReviewerRuntimeError("reviewer registry: stable reviewer inventory mismatch")
    return indexed


def _validate_registry_binding(
    reviewer: Mapping[str, Any],
    registry_reviewer: Mapping[str, Any],
    expected: Mapping[str, Any],
) -> None:
    profile = registry_reviewer.get("agent_profile")
    if (
        registry_reviewer.get("principal_type") != "ai_agent"
        or registry_reviewer.get("active") is not False
        or registry_reviewer.get("independence_group_id") != expected["independence_group_id"]
        or tuple(registry_reviewer.get("roles", ())) != expected["roles"]
        or not isinstance(profile, Mapping)
        or profile.get("profile_id") != expected["profile_id"]
        or profile.get("status") != "configuration_pending"
        or profile.get("revocation_status") != "configuration_pending"
    ):
        raise ReviewerRuntimeError("reviewer registry: inactive profile binding mismatch")
    pending_fields = (
        "model_provider",
        "model_id",
        "model_revision",
        "runtime_version",
        "model_lineage_id",
        "policy_lineage_id",
        "workload_identity_id",
        "system_instruction_sha256",
        "tool_contract_sha256",
        "inference_policy_sha256",
        "conflict_policy_sha256",
        "recusal_policy_sha256",
        "receipt_issuer_key_id",
        "receipt_verification_key",
    )
    if any(profile.get(field) is not None for field in pending_fields):
        raise ReviewerRuntimeError("reviewer registry: profile must remain unprovisioned")
    if reviewer["profile_id"] != profile["profile_id"]:
        raise ReviewerRuntimeError("reviewer runtime: profile ID does not match registry")


def _artifact_bytes(root: Path, path: str, *, label: str) -> bytes:
    data = _read_file_once(root, path, logical_name=label, kind="artifact")
    if not data or len(data) > MAX_ARTIFACT_BYTES:
        raise ReviewerRuntimeError(f"{label}: artifact size is outside the allowed range")
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ReviewerRuntimeError(f"{label}: artifact must be UTF-8") from exc
    if "\x00" in text or SECRET_VALUE_PATTERN.search(text):
        raise ReviewerRuntimeError(f"{label}: secret-like artifact content is prohibited")
    return data


def _validate_policy_artifact(
    *,
    field: str,
    data: bytes,
    reviewer: Mapping[str, Any],
) -> None:
    reviewer_id = reviewer["reviewer_id"]
    if field == "system_instruction":
        text = data.decode("utf-8")
        if reviewer_id not in text or "inactive candidate reviewer" not in text:
            raise ReviewerRuntimeError(
                "system instruction: stable identity and inactive status are required"
            )
        return
    parsed = _parse_strict_json(data, label=f"{field} artifact")
    if field == "tool_contract":
        if not isinstance(parsed, list) or not parsed:
            raise ReviewerRuntimeError("tool contract: expected a nonempty tool array")
        return
    if not isinstance(parsed, dict) or parsed.get("reviewer_id") != reviewer_id:
        raise ReviewerRuntimeError(f"{field}: reviewer identity mismatch")
    _require_false_authorization_effect(
        parsed.get("authorization_effect"),
        label=field,
    )
    if field == "inference_policy":
        if (
            parsed.get("schema_version") != "dime-foundation-reviewer-inference-policy-v1"
            or parsed.get("model_id") != reviewer["model_id"]
            or parsed.get("model_revision") != reviewer["model_revision"]
            or parsed.get("sampling") != reviewer["request_policy"]
            or parsed.get("input_policy", {}).get("external_network_allowed") is not False
            or parsed.get("input_policy", {}).get("production_tools_allowed") is not False
            or parsed.get("output_policy", {}).get("chain_of_thought_allowed") is not False
        ):
            raise ReviewerRuntimeError("inference policy: governed settings mismatch")
    elif field == "conflict_policy":
        if (
            parsed.get("schema_version") != "dime-foundation-reviewer-conflict-policy-v1"
            or parsed.get("required_action") != "recuse"
            or parsed.get("override_allowed") is not False
        ):
            raise ReviewerRuntimeError("conflict policy: fail-closed recusal is required")
    elif field == "recusal_policy":
        if (
            parsed.get("schema_version") != "dime-foundation-reviewer-recusal-policy-v1"
            or parsed.get("required_decision") != "recuse"
            or parsed.get("approval_on_recusal_allowed") is not False
        ):
            raise ReviewerRuntimeError("recusal policy: fail-closed recusal is required")


def _validate_reviewer(
    root: Path,
    reviewer: Mapping[str, Any],
    registry_reviewer: Mapping[str, Any],
    expected: Mapping[str, Any],
) -> dict[str, bytes]:
    if (
        reviewer["status"] != "planned_unprovisioned"
        or reviewer["active"] is not False
        or reviewer["model_provider"] != "hugging_face"
        or reviewer["profile_id"] != expected["profile_id"]
        or reviewer["independence_group_id"] != expected["independence_group_id"]
        or reviewer["model_id"] != expected["model_id"]
        or reviewer["model_revision"] != expected["model_revision"]
        or reviewer["model_lineage_id"] != expected["model_lineage_id"]
        or reviewer["policy_lineage_id"] != expected["policy_lineage_id"]
        or tuple(reviewer["roles"]) != expected["roles"]
        or reviewer["runtime_version"] != EXPECTED_RUNTIME["container"]["runtime_version"]
    ):
        raise ReviewerRuntimeError("reviewer runtime: immutable identity binding mismatch")
    _validate_registry_binding(reviewer, registry_reviewer, expected)
    _require_false_authorization_effect(
        reviewer["authorization_effect"],
        label="reviewer runtime",
    )
    endpoint = reviewer["endpoint"]
    if (
        endpoint["endpoint_id"] is not None
        or endpoint["workload_identity_id"] is not None
        or endpoint["secret_environment"] != []
        or endpoint["minimum_vram_gb"] < 80
        or endpoint["workers_min"] != 0
        or endpoint["workers_max"] != 1
        or endpoint["environment"] != expected["environment"]
        or reviewer["request_policy"] != expected["request_policy"]
    ):
        raise ReviewerRuntimeError("reviewer endpoint: planned nonsecret settings mismatch")
    if (
        endpoint["environment"]["MODEL_NAME"] != reviewer["model_id"]
        or endpoint["environment"]["MODEL_REVISION"] != reviewer["model_revision"]
        or endpoint["environment"]["TOKENIZER_REVISION"] != reviewer["model_revision"]
        or endpoint["environment"]["TRUST_REMOTE_CODE"] != "false"
    ):
        raise ReviewerRuntimeError("reviewer endpoint: model and tokenizer pins must remain exact")

    artifacts: dict[str, bytes] = {}
    for field, path in reviewer["policy_paths"].items():
        data = _artifact_bytes(root, path, label=field)
        if _sha256(data) != reviewer["policy_sha256"][field]:
            raise ReviewerRuntimeError(f"{field}: artifact digest mismatch")
        _validate_policy_artifact(field=field, data=data, reviewer=reviewer)
        artifacts[path] = data
    return artifacts


def load_reviewer_runtime(
    project_root: str | Path | None = None,
) -> LoadedReviewerRuntime:
    """Load and validate the inactive reviewer runtime without network or GPU use."""

    try:
        root = _project_directory(project_root)
        schema_bytes, schema = _capture_schema(
            root,
            RUNTIME_SCHEMA_PATH,
            logical_name="reviewer_runtime",
        )
        config_bytes, document = _capture_json(
            root,
            RUNTIME_CONFIG_PATH,
            logical_name="reviewer_runtime",
            kind="config",
        )
        _validate_document(document, schema, label="reviewer_runtime")
        _ensure_no_secret_values(document, label="reviewer runtime")
        if (
            document["status"] != "planned_unprovisioned"
            or document["activation_authorized"] is not False
            or document["runtime"] != EXPECTED_RUNTIME
        ):
            raise ReviewerRuntimeError("reviewer runtime: immutable runtime pin mismatch")
        _require_blocked_platform(root)
        registry = _registry_reviewers(root)
        indexed = {reviewer["reviewer_id"]: reviewer for reviewer in document["reviewers"]}
        if set(indexed) != set(EXPECTED_REVIEWERS):
            raise ReviewerRuntimeError("reviewer runtime: stable reviewer inventory mismatch")

        artifacts: dict[str, bytes] = {}
        for reviewer_id, expected in EXPECTED_REVIEWERS.items():
            artifacts.update(
                _validate_reviewer(
                    root,
                    indexed[reviewer_id],
                    registry[reviewer_id],
                    expected,
                )
            )

        distinct_fields = (
            "independence_group_id",
            "model_id",
            "model_revision",
            "model_lineage_id",
            "policy_lineage_id",
        )
        for field in distinct_fields:
            if len({reviewer[field] for reviewer in indexed.values()}) != 2:
                raise ReviewerRuntimeError(f"reviewer runtime: {field} must remain independent")

        config_sha256 = _sha256(config_bytes)
        schema_sha256 = _sha256(schema_bytes)
        identity = {
            "schema_version": "dime-foundation-reviewer-runtime-identity-v1",
            "config_sha256": config_sha256,
            "schema_sha256": schema_sha256,
            "artifact_sha256": {path: _sha256(data) for path, data in sorted(artifacts.items())},
        }
        contract_sha256 = _sha256(canonical_json_bytes(identity))
        return LoadedReviewerRuntime(
            project_root=root,
            document=_freeze(document),
            artifacts=MappingProxyType(dict(artifacts)),
            config_sha256=config_sha256,
            schema_sha256=schema_sha256,
            contract_sha256=contract_sha256,
        )
    except ReviewerRuntimeError:
        raise
    except FoundationContractError as exc:
        raise ReviewerRuntimeError(str(exc)) from exc


def _reviewer(runtime: LoadedReviewerRuntime, reviewer_id: str) -> Mapping[str, Any]:
    for reviewer in runtime.document["reviewers"]:
        if reviewer["reviewer_id"] == reviewer_id:
            return reviewer
    raise ReviewerRuntimeError("reviewer request: unknown reviewer ID")


def _json_copy(value: Any, *, label: str) -> Any:
    if isinstance(value, Mapping):
        if not all(isinstance(key, str) for key in value):
            raise ReviewerRuntimeError(f"{label}: JSON object keys must be strings")
        copied = {key: _json_copy(item, label=label) for key, item in value.items()}
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        copied = [_json_copy(item, label=label) for item in value]
    elif value is None or isinstance(value, (str, bool, int)):
        copied = value
    elif isinstance(value, float) and math.isfinite(value):
        copied = value
    else:
        raise ReviewerRuntimeError(f"{label}: value is not canonical JSON")
    _ensure_no_secret_values(copied, label=label)
    return copied


def build_queue_request(
    runtime: LoadedReviewerRuntime,
    *,
    reviewer_id: str,
    review_input: Mapping[str, Any],
) -> Mapping[str, Any]:
    """Build a deterministic, unsigned RunPod queue request with no endpoint or secret."""

    reviewer = _reviewer(runtime, reviewer_id)
    if not isinstance(review_input, Mapping) or not review_input:
        raise ReviewerRuntimeError("reviewer request: review_input must be a nonempty object")
    review_input_copy = _json_copy(review_input, label="reviewer request")
    request_evidence = {
        "schema_version": "dime-foundation-review-request-v1",
        "reviewer_id": reviewer_id,
        "review_input": review_input_copy,
    }
    evidence_bytes = canonical_json_bytes(request_evidence)
    if len(evidence_bytes) > MAX_REVIEW_INPUT_BYTES:
        raise ReviewerRuntimeError("reviewer request: input exceeds the allowed size")
    system_path = reviewer["policy_paths"]["system_instruction"]
    system_instruction = runtime.artifacts[system_path].decode("utf-8")
    sampling = _plain(reviewer["request_policy"])
    openai_input = {
        "model": reviewer["endpoint"]["environment"]["OPENAI_SERVED_MODEL_NAME_OVERRIDE"],
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": evidence_bytes.decode("utf-8").rstrip("\n")},
        ],
        "temperature": sampling["temperature"],
        "top_p": sampling["top_p"],
        "top_k": sampling["top_k"],
        "max_tokens": sampling["max_tokens"],
        "seed": sampling["seed"],
        "n": 1,
        "stream": False,
        "response_format": {"type": sampling["response_format"]},
    }
    if reviewer["model_id"] == "Qwen/Qwen3-32B":
        # Qwen3 thinking is enabled by default. The selected review policy
        # prohibits chain-of-thought, so disable it through the request field
        # consumed by the pinned worker's ChatCompletionRequest.
        openai_input["chat_template_kwargs"] = {"enable_thinking": False}
    return _freeze(
        {
            "input": {
                "openai_route": "/v1/chat/completions",
                "openai_input": openai_input,
            }
        }
    )


def canonical_queue_request_bytes(request: Mapping[str, Any]) -> bytes:
    """Return canonical bytes for a sanitized queue request."""

    return canonical_json_bytes(_plain(request))


def validate_reviewer_decision(
    reviewer_id: str,
    decision: Mapping[str, Any],
) -> Mapping[str, Any]:
    """Validate one model decision without treating it as an authorized approval."""

    expected_keys = {
        "schema_version",
        "reviewer_id",
        "decision",
        "confidence",
        "findings",
        "limitations",
    }
    copied = _json_copy(decision, label="reviewer decision")
    if not isinstance(copied, dict) or set(copied) != expected_keys:
        raise ReviewerRuntimeError("reviewer decision: field inventory mismatch")
    if (
        copied["schema_version"] != REVIEW_DECISION_SCHEMA_VERSION
        or copied["reviewer_id"] != reviewer_id
        or reviewer_id not in EXPECTED_REVIEWERS
        or copied["decision"] not in {"approve", "changes_requested", "reject", "recuse"}
    ):
        raise ReviewerRuntimeError("reviewer decision: identity or decision mismatch")
    confidence = copied["confidence"]
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        raise ReviewerRuntimeError("reviewer decision: confidence must be numeric")
    if not math.isfinite(float(confidence)) or not 0 <= confidence <= 1:
        raise ReviewerRuntimeError("reviewer decision: confidence must be between zero and one")
    findings = copied["findings"]
    if not isinstance(findings, list) or len(findings) > 100:
        raise ReviewerRuntimeError("reviewer decision: findings must be a bounded array")
    for finding in findings:
        if not isinstance(finding, dict) or set(finding) != {
            "code",
            "severity",
            "message",
            "evidence_paths",
        }:
            raise ReviewerRuntimeError("reviewer decision: finding field inventory mismatch")
        if (
            not isinstance(finding["code"], str)
            or not FINDING_CODE_PATTERN.fullmatch(finding["code"])
            or finding["severity"] not in {"low", "medium", "high", "critical"}
            or not isinstance(finding["message"], str)
            or not 1 <= len(finding["message"]) <= 1000
            or not isinstance(finding["evidence_paths"], list)
            or len(finding["evidence_paths"]) > 50
            or not all(
                isinstance(path, str) and 1 <= len(path) <= 240
                for path in finding["evidence_paths"]
            )
        ):
            raise ReviewerRuntimeError("reviewer decision: invalid finding")
    limitations = copied["limitations"]
    if (
        not isinstance(limitations, list)
        or len(limitations) > 50
        or not all(isinstance(item, str) and 1 <= len(item) <= 500 for item in limitations)
    ):
        raise ReviewerRuntimeError("reviewer decision: invalid limitations")
    return _freeze(copied)


def sanitized_endpoint_plans(
    runtime: LoadedReviewerRuntime,
) -> tuple[tuple[str, Mapping[str, Any]], ...]:
    """Return two deterministic, non-authorizing endpoint plans."""

    container = runtime.document["runtime"]["container"]
    plans = []
    for reviewer_id in sorted(EXPECTED_REVIEWERS):
        reviewer = _reviewer(runtime, reviewer_id)
        expected = EXPECTED_REVIEWERS[reviewer_id]
        plan = {
            "schema_version": "dime-runpod-reviewer-endpoint-plan-v1",
            "status": "planned_unprovisioned",
            "activation_authorized": False,
            "reviewer_id": reviewer_id,
            "profile_id": reviewer["profile_id"],
            "endpoint_id": None,
            "workload_identity_id": None,
            "endpoint_type": runtime.document["runtime"]["endpoint_type"],
            "container": {
                "deploy_ref": container["deploy_ref"],
                "runtime_version": container["runtime_version"],
                "platform": container["platform"],
            },
            "model": {
                "provider": reviewer["model_provider"],
                "model_id": reviewer["model_id"],
                "model_revision": reviewer["model_revision"],
                "model_lineage_id": reviewer["model_lineage_id"],
                "policy_lineage_id": reviewer["policy_lineage_id"],
            },
            "compute": {
                "minimum_vram_gb": reviewer["endpoint"]["minimum_vram_gb"],
                "workers_min": reviewer["endpoint"]["workers_min"],
                "workers_max": reviewer["endpoint"]["workers_max"],
                "gpu_candidates": _plain(reviewer["endpoint"]["gpu_candidates"]),
            },
            "environment": _plain(reviewer["endpoint"]["environment"]),
            "secret_environment": [],
            "request_policy": _plain(reviewer["request_policy"]),
            "policy_sha256": _plain(reviewer["policy_sha256"]),
            "runtime_contract_sha256": runtime.contract_sha256,
            "authorization_effect": _plain(reviewer["authorization_effect"]),
        }
        _ensure_no_secret_values(plan, label="endpoint plan")
        plans.append((expected["plan_filename"], _freeze(plan)))
    return tuple(plans)


def _outside_project_directory(output_dir: str | Path, project_root: Path) -> Path:
    candidate = Path(output_dir).absolute()
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise ReviewerRuntimeError("output directory: missing directory") from exc
    if candidate != resolved or candidate.is_symlink() or not candidate.is_dir():
        raise ReviewerRuntimeError("output directory: expected a real, non-symlink directory")
    try:
        resolved.relative_to(project_root)
    except ValueError:
        return resolved
    raise ReviewerRuntimeError("output directory: must be outside the Git worktree")


def write_sanitized_endpoint_plans(
    output_dir: str | Path,
    *,
    project_root: str | Path | None = None,
) -> tuple[tuple[Path, str], ...]:
    """Write two new mode-0600 plans outside the Git worktree without overwriting."""

    runtime = load_reviewer_runtime(project_root)
    destination = _outside_project_directory(output_dir, runtime.project_root)
    if (
        not hasattr(os, "O_CLOEXEC")
        or not hasattr(os, "O_DIRECTORY")
        or not hasattr(os, "O_NOFOLLOW")
        or os.open not in os.supports_dir_fd
    ):
        raise ReviewerRuntimeError("output directory: secure file creation is unavailable")
    directory_fd = os.open(
        destination,
        os.O_RDONLY | os.O_CLOEXEC | os.O_DIRECTORY | os.O_NOFOLLOW,
    )
    outputs: list[tuple[Path, str]] = []
    created_filenames: list[str] = []
    try:
        if not stat.S_ISDIR(os.fstat(directory_fd).st_mode):
            raise ReviewerRuntimeError("output directory: expected a real directory")
        plans = sanitized_endpoint_plans(runtime)
        for filename, _ in plans:
            try:
                os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            except OSError as exc:
                raise ReviewerRuntimeError(
                    "endpoint plan: could not safely inspect destination"
                ) from exc
            raise ReviewerRuntimeError("endpoint plan: refusing to overwrite existing file")
        for filename, plan in plans:
            data = canonical_json_bytes(_plain(plan))
            file_fd: int | None = None
            try:
                file_fd = os.open(
                    filename,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=directory_fd,
                )
                created_filenames.append(filename)
                os.fchmod(file_fd, 0o600)
                written = 0
                while written < len(data):
                    written += os.write(file_fd, data[written:])
                os.fsync(file_fd)
            except FileExistsError as exc:
                raise ReviewerRuntimeError(
                    "endpoint plan: destination changed during write"
                ) from exc
            except OSError as exc:
                raise ReviewerRuntimeError("endpoint plan: could not safely write file") from exc
            finally:
                if file_fd is not None:
                    try:
                        os.close(file_fd)
                    except OSError:
                        pass
            outputs.append((destination / filename, _sha256(data)))
    except Exception:
        for filename in reversed(created_filenames):
            try:
                os.unlink(filename, dir_fd=directory_fd)
            except OSError:
                pass
        raise
    finally:
        try:
            os.close(directory_fd)
        except OSError:
            pass
    return tuple(outputs)
