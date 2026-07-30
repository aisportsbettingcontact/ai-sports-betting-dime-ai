from __future__ import annotations

import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parents[1]
TRAINING_CONTRACT_PATH = ML_ROOT / "configs" / "dime_training_contract_v1.json"
TRAINING_SCHEMA_PATH = ML_ROOT / "schemas" / "dime_training_contract.schema.json"
PLATFORM_CONTRACT_PATH = ML_ROOT / "configs" / "platform_contract.json"
BENCHMARK_ROOT = ML_ROOT / "evidence" / "benchmarks" / "model-artifact-evaluation-v1"
BENCHMARK_CONTRACT_PATH = BENCHMARK_ROOT / "contract.json"
SUITABILITY_ROOT = ML_ROOT / "evidence" / "benchmarks" / "base-model-suitability-v1"
SUITABILITY_CONTRACT_PATH = SUITABILITY_ROOT / "contract.json"
DECISION_ROOT = ML_ROOT / "evidence" / "decisions" / "dime-model-artifact-decision-v1"
DECISION_PATH = DECISION_ROOT / "decision.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def count_cases(path: Path) -> int:
    if path.suffix == ".jsonl":
        return len([line for line in path.read_text(encoding="utf-8").splitlines() if line])
    return len(load_json(path)["cases"])


def checksum_manifest(directory: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for line in (directory / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative_path = line.split("  ", maxsplit=1)
        entries[relative_path] = digest
    return entries


def assert_checksum_manifest(directory: Path, expected_paths: set[str]) -> None:
    entries = checksum_manifest(directory)
    assert set(entries) == expected_paths
    for relative_path, expected_digest in entries.items():
        artifact = directory / relative_path
        assert artifact.is_file()
        assert sha256(artifact) == expected_digest


def walk_strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for child in value for item in walk_strings(child)]
    if isinstance(value, dict):
        return [item for child in value.values() for item in walk_strings(child)]
    return []


def test_active_platform_architecture_has_the_correct_ownership_boundary() -> None:
    platform = load_json(PLATFORM_CONTRACT_PATH)
    architecture = platform["dime_llm_architecture"]

    assert architecture["training_orchestrator"] == {
        "platform": "Codex",
        "agent": "5.6 Sol",
        "role": "engineering_and_training_control",
    }
    assert architecture["model_compute"] == {
        "platform": "RunPod",
        "role": "training_and_inference_compute",
    }
    assert architecture["excluded_providers"] == ["anthropic"]
    assert architecture["production_candidate"] == {
        "provider": "runpod",
        "model": None,
        "model_revision": None,
        "adapter_revision": None,
        "status": "pending_training_and_evaluation",
    }
    assert architecture["deterministic_control"]["role"] == ("fallback_and_non_generative_control")
    assert architecture["candidate_evaluation"]["external_api_comparison_authorized"] is False
    assert platform["status"] == "foundation_only"
    assert not any(platform["authorization"].values())


def test_training_contract_is_schema_valid_pinned_and_fail_closed() -> None:
    schema = load_json(TRAINING_SCHEMA_PATH)
    contract = load_json(TRAINING_CONTRACT_PATH)
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(contract)

    assert contract["status"] == "INCOMPLETE_NOT_AUTHORIZED"
    assert contract["capability_hypothesis"]["falsifiable"] is True
    assert contract["base_model"] == contract["tokenizer"]
    assert contract["base_model"]["revision"] == ("d04e592bb4f6aa9cfee91e2e20afa771667e1d4b")
    assert contract["source"]["training_code_commit"] is None

    pinned_files = [
        ("training_script_path", "training_script_sha256"),
        ("training_config_path", "training_config_sha256"),
        ("requirements_lock_path", "requirements_lock_sha256"),
    ]
    for path_key, hash_key in pinned_files:
        assert sha256(REPO_ROOT / contract["source"][path_key]) == contract["source"][hash_key]

    for section_name in ("prompt", "routing", "evaluation"):
        section = contract[section_name]
        for item in section["files"]:
            assert sha256(REPO_ROOT / item["path"]) == item["sha256"]

    prohibited_aliases = {"main", "latest"}
    assert prohibited_aliases.isdisjoint(walk_strings(contract))
    assert contract["readiness"]["training_contract_complete"] is False
    assert contract["readiness"]["verdict"] == "REVISE"
    assert not any(contract["authorization_boundary"].values())


def test_foundation_dataset_gate_does_not_misstate_the_public_sample_as_release() -> None:
    contract = load_json(TRAINING_CONTRACT_PATH)
    dataset = contract["foundation_dataset"]

    assert dataset["target_record_count"] == 2400
    assert dataset["train_record_count"] == 2160
    assert dataset["validation_record_count"] == 240
    assert dataset["revision"] is None
    assert dataset["dataset_manifest_sha256"] is None
    assert dataset["checksums_sha256"] is None
    assert dataset["approved_release"] is False
    assert dataset["observed_public_sample_record_count"] == 12
    assert len(dataset["validation_requirements"]) == 11

    sample_count = 0
    for name in ("train.sample.jsonl", "validation.sample.jsonl"):
        path = ML_ROOT / "data" / "sft" / name
        sample_lines = path.read_text(encoding="utf-8").splitlines()
        sample_count += len([line for line in sample_lines if line])
    assert sample_count == dataset["observed_public_sample_record_count"]

    separation = contract["separation"]
    assert separation["foundation_train_and_validation"]["training_access"] == "allowed"
    for key in (
        "development_evaluation",
        "model_artifact_evaluation",
        "general_capability_regression_evaluation",
        "locked_evaluation",
    ):
        assert separation[key]["training_access"] == "prohibited"


def test_model_artifact_evaluation_is_81_cases_and_excludes_provider_scoring() -> None:
    contract = load_json(BENCHMARK_CONTRACT_PATH)
    assert contract["status"] == "FROZEN_NOT_AUTHORIZED"
    assert contract["dataset"]["total_case_count"] == 81
    assert contract["architecture"]["excluded_providers"] == ["anthropic"]
    assert contract["architecture"]["frozen_no_provider_role"] == (
        "deterministic_fallback_and_non_generative_control"
    )

    total = 0
    for source in contract["dataset"]["sources"]:
        path = REPO_ROOT / source["path"]
        assert sha256(path) == source["sha256"]
        assert count_cases(path) == source["case_count"]
        total += source["case_count"]
        if "schema_path" in source:
            assert sha256(REPO_ROOT / source["schema_path"]) == source["schema_sha256"]
    assert total == 81

    candidates = contract["candidates"]
    assert [candidate["candidate_id"] for candidate in candidates] == [
        "candidate-a",
        "candidate-b",
        "candidate-c",
    ]
    assert {candidate["model_compute"] for candidate in candidates} == {"runpod"}
    assert {candidate["base_revision"] for candidate in candidates} == {
        "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"
    }
    assert candidates[0]["runtime_answer_routing_revision"] is None
    assert candidates[1]["runtime_answer_routing_revision"] == "runtime-answer-routing-v1"
    assert candidates[2]["runtime_answer_routing_revision"] == "runtime-answer-routing-v1"
    assert candidates[0]["model_artifact"] == candidates[1]["model_artifact"] == "base_model"
    assert candidates[2]["model_artifact"] == "dime_qlora_adapter"
    assert candidates[2]["adapter_revision"] is None
    assert all(candidate["endpoint_invoked"] is False for candidate in candidates)
    assert "provider" not in {key for candidate in candidates for key in candidate}


def test_base_model_selection_is_explicit_frozen_and_non_authorizing() -> None:
    training = load_json(TRAINING_CONTRACT_PATH)
    selection = training["base_model_selection"]
    suitability = load_json(SUITABILITY_CONTRACT_PATH)

    assert selection["status"] == "BLOCKED_PENDING_SUITABILITY_EVALUATION"
    assert selection["selected_candidate"] is None
    assert selection["current_training_code_binding"] == "candidate-base"
    assert selection["current_binding_is_selection"] is False
    assert selection["required_before_dataset_approval"] is True
    assert selection["required_before_training_authorization"] is True
    assert (
        sha256(REPO_ROOT / selection["evaluation_contract"]["path"])
        == (selection["evaluation_contract"]["sha256"])
    )

    assert suitability["status"] == "FROZEN_NOT_AUTHORIZED"
    assert suitability["dataset"]["total_case_count"] == 81
    candidates = {candidate["candidate_id"]: candidate for candidate in suitability["candidates"]}
    assert candidates["candidate-base"]["revision"] == ("d04e592bb4f6aa9cfee91e2e20afa771667e1d4b")
    assert candidates["candidate-instruct"]["repo_id"] == ("meta-llama/Llama-3.1-8B-Instruct")
    assert candidates["candidate-instruct"]["revision"] == (
        "0e9e39f249a16976918f6564b8830bc894c89659"
    )
    assert suitability["selection_rule"]["statistical_tie_preference"] == "candidate-instruct"
    assert (
        suitability["selection_rule"][
            "base_selection_requires_minimum_factual_correctness_gain_over_instruct"
        ]
        == 0.02
    )
    assert suitability["execution_readiness"]["verdict"] == "REVISE"
    assert not any(suitability["authorization_boundary"].values())
    assert suitability["production_mutations_performed"] == []


def test_model_artifact_thresholds_and_runpod_cost_policy_fail_closed() -> None:
    contract = load_json(BENCHMARK_CONTRACT_PATH)
    thresholds = contract["promotion_thresholds"]

    zero_tolerance = (
        "fabricated_dynamic_fact_count",
        "incorrect_event_identity_count",
        "doubleheader_confusion_count",
        "cross_user_or_identity_failure_count",
        "mandatory_tool_violation_count",
        "stale_data_presented_as_current_count",
        "missing_evidence_presented_as_no_edge_count",
        "critical_schema_failure_count",
    )
    for name in zero_tolerance:
        assert thresholds[name] == {"maximum": 0, "hard_gate": True}

    assert thresholds["candidate_c_material_correctness_gain_over_b"] == {
        "minimum_absolute_gain": 0.02,
        "hard_gate": True,
    }
    assert thresholds["candidate_c_calibration_regression_against_b"] == {
        "maximum_absolute_increase": 0.0,
        "hard_gate": True,
    }
    assert (
        thresholds["protected_platform_or_account_route_regression"]["maximum_relative_regression"]
        == 0.0
    )
    assert contract["selection_rule"]["candidate_b_as_good_as_candidate_c_result"] == (
        "REVISE_AND_RETRAIN"
    )
    assert contract["selection_rule"]["allowed_verdicts"] == [
        "REJECT",
        "REVISE_AND_RETRAIN",
        "SELECT_FOR_CONTROLLED_VALIDATION",
    ]

    pricing = contract["runpod_pricing_policy"]
    assert pricing["unknown_utilization_treatment"] == "cost_unavailable"
    assert pricing["generic_external_api_token_tariff_allowed"] is False
    assert pricing["pricing_entry_authorized"] is False
    assert not any(contract["authorization_boundary"].values())
    assert contract["production_mutations_performed"] == []


def test_active_decision_supersedes_but_does_not_rewrite_historical_evidence() -> None:
    decision = load_json(DECISION_PATH)
    assert decision["verdict"] == "REVISE"
    assert decision["selection"] is None
    assert decision["excluded_providers"] == ["anthropic"]
    assert decision["production_candidate"] == {
        "provider": "runpod",
        "model": None,
        "model_revision": None,
        "adapter_revision": None,
        "status": "pending_training_and_evaluation",
    }
    assert not any(decision["authorization_boundary"].values())
    assert decision["production_mutations_performed"] == []

    for historical in decision["supersedes_active_authority"]:
        path = REPO_ROOT / historical["path"]
        assert historical["preservation"] == "immutable_historical_evidence"
        assert sha256(path) == historical["sha256"]

    governed = decision["governed_artifacts"]
    for artifact in governed.values():
        assert sha256(REPO_ROOT / artifact["path"]) == artifact["sha256"]


def test_model_artifact_evidence_packages_are_checksum_pinned() -> None:
    assert_checksum_manifest(
        SUITABILITY_ROOT,
        {
            "README.md",
            "contract.json",
            "../../../data/eval/product_route_observability_v1.benchmark.json",
            "../../../data/eval/runtime_answer_routing_v1.benchmark.json",
            "../../../data/eval/platform_grounding_v1.sample.jsonl",
            "../../../data/eval/dev.sample.jsonl",
            "../../../data/eval/safety_red_team.sample.jsonl",
            "../../../data/eval/provider_selection_v1.supplemental.json",
            "../../../schemas/provider_selection_supplemental.schema.json",
        },
    )
    assert_checksum_manifest(
        BENCHMARK_ROOT,
        {
            "README.md",
            "contract.json",
            "../../../data/eval/product_route_observability_v1.benchmark.json",
            "../../../data/eval/runtime_answer_routing_v1.benchmark.json",
            "../../../data/eval/platform_grounding_v1.sample.jsonl",
            "../../../data/eval/dev.sample.jsonl",
            "../../../data/eval/safety_red_team.sample.jsonl",
            "../../../data/eval/provider_selection_v1.supplemental.json",
            "../../../schemas/provider_selection_supplemental.schema.json",
        },
    )
    assert_checksum_manifest(DECISION_ROOT, {"README.md", "decision.json"})
