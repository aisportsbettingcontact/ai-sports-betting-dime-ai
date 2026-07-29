from __future__ import annotations

import json
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker

PROJECT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = PROJECT / "schemas/engineering_control_artifact.schema.json"
CONFIG_PATH = PROJECT / "configs/composite_engineering_control_v1.yaml"
SHA256 = "a" * 64
COMMIT = "b" * 40


def artifact(artifact_type: str, agent: str, payload: dict) -> dict:
    return {
        "schema_version": "dime-engineering-control-artifact-v1",
        "artifact_id": f"{artifact_type}-20260729",
        "artifact_type": artifact_type,
        "created_at_utc": "2026-07-29T12:00:00Z",
        "producer": {
            "agent": agent,
            "principal_id": f"dime:{agent}:v1",
            "source_commit": COMMIT,
        },
        "evidence": [
            {
                "kind": "evaluation",
                "reference": "development-eval:case-42",
                "sha256": SHA256,
                "observed_at_utc": "2026-07-29T11:00:00Z",
            }
        ],
        "authorization_effect": {
            "authorizes_training": False,
            "authorizes_locked_evaluation": False,
            "authorizes_release": False,
            "authorizes_serving": False,
            "authorizes_provider_activation": False,
        },
        "payload": payload,
    }


def validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def assert_valid(document: dict) -> None:
    errors = sorted(validator().iter_errors(document), key=lambda error: list(error.path))
    assert errors == [], [error.message for error in errors]


def efficiency() -> dict:
    return {
        "correctness": 0.9,
        "usefulness": 0.9,
        "groundedness": 0.9,
        "calibration": 0.9,
        "reliability": 0.9,
        "latency": 1.0,
        "cost": 1.0,
        "complexity": 1.0,
        "regression_risk": 1.0,
    }


def test_control_config_is_non_authorizing_and_complete() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    assert config["schema_version"] == "dime-composite-engineering-control-v1"
    assert config["status"] == "proposed_non_authorizing"
    assert not any(config["authorization_effect"].values())
    assert len(config["agents"]) == 11
    assert config["release_verdicts"] == [
        "REJECT",
        "REVISE",
        "SHADOW",
        "CANARY",
        "RELEASE",
        "ROLLBACK",
    ]
    assert config["separation_of_duties"]["builder_may_approve_own_candidate"] is False


def test_all_agent_handoff_artifact_types_validate() -> None:
    assert_valid(
        artifact(
            "failure_diagnosis",
            "failure_diagnosis_agent",
            {
                "failure_class": "reasoning",
                "root_cause": "Verified multi-step probability comparison failure.",
                "reproduced": True,
                "baseline": {
                    "name": "reasoning_accuracy",
                    "value": 0.72,
                    "sample_size": 100,
                },
                "deterministic_layers_checked": [
                    "product_logic",
                    "routing",
                    "retrieval",
                    "tool_use",
                    "context_construction",
                    "data_quality",
                ],
                "smallest_sufficient_intervention": "small_adapter",
                "training_candidate": True,
            },
        )
    )
    assert_valid(
        artifact(
            "training_strategy",
            "model_strategy_governor",
            {
                "failure_artifact_id": "failure-diagnosis-20260729",
                "failure_class": "reasoning",
                "root_cause": "Verified multi-step probability comparison failure.",
                "training_necessity": "required",
                "deterministic_causes_eliminated": True,
                "simpler_interventions_rejected": [
                    "runtime_fix",
                    "prompt_or_schema",
                    "retrieval_improvement",
                ],
                "capability_target": "Calibrated multi-step market comparison",
                "falsifiable_hypothesis": (
                    "Increase development reasoning accuracy from 0.72 to at least 0.82."
                ),
                "training_method": "QLoRA supervised instruction tuning",
                "curriculum": [
                    "single_step_reasoning",
                    "multi_step_reasoning",
                    "conflicting_evidence",
                ],
                "data_requirements": ["Two hundred independently reviewed traces."],
                "expected_gain": {
                    "metric": "reasoning_accuracy",
                    "baseline": 0.72,
                    "target": 0.82,
                },
                "regression_risks": ["General instruction-following regression."],
                "stop_conditions": ["Stop after two evaluations without improvement."],
                "acceptance_thresholds": ["Locked target accuracy must be at least 0.82."],
            },
        )
    )
    assert_valid(
        artifact(
            "architecture_experiment",
            "architecture_research_agent",
            {
                "failure_artifact_id": "failure-diagnosis-20260729",
                "baseline": {
                    "name": "retrieval_precision",
                    "value": 0.81,
                    "sample_size": 100,
                },
                "competing_approaches": [
                    "Route-specific relational retrieval.",
                    "Hybrid relational and vector retrieval.",
                ],
                "ablation_plan": "Disable each retrieval lane independently.",
                "cost_projection": "Measure provider calls and storage per request.",
                "latency_projection": "Measure p50, p95, and p99 end-to-end latency.",
                "backward_compatibility": "Preserve Runtime Answer Routing v1 behavior.",
                "rollback_plan": "Disable the experiment flag and restore the prior route.",
            },
        )
    )
    assert_valid(
        artifact(
            "scaling_forecast",
            "scaling_science_agent",
            {
                "intervention": "small_adapter",
                "compute_required": "One measured single-GPU QLoRA run.",
                "data_required": "Two hundred reviewed target-capability records.",
                "estimated_quality_gain": "Five to ten percentage points.",
                "estimated_latency_effect": "No change before measured serving benchmark.",
                "estimated_inference_cost": "No change before measured serving benchmark.",
                "confidence_interval": "Wide interval until the first controlled run.",
                "break_even_usage": "Calculate after measured training and serving cost.",
                "failure_conditions": ["Stop when downstream quality plateaus."],
            },
        )
    )
    assert_valid(
        artifact(
            "evaluation_decision",
            "evaluation_authority",
            {
                "candidate_id": "adapter-candidate-20260729",
                "builder_principal_id": "dime:training:v1",
                "evaluator_principal_id": "dime:evaluation:v1",
                "independence_verified": True,
                "baseline": efficiency(),
                "candidate": {**efficiency(), "correctness": 0.94},
                "targeted_capability_improved": True,
                "zero_tolerance_failures": 0,
                "regression_limits_passed": True,
                "locked_evaluation_passed": True,
                "rollback_ready": True,
                "verdict": "SHADOW",
            },
        )
    )


def test_training_required_fails_closed_for_runtime_layer_or_unresolved_causes() -> None:
    document = artifact(
        "training_strategy",
        "model_strategy_governor",
        {
            "failure_artifact_id": "failure-diagnosis-20260729",
            "failure_class": "routing",
            "root_cause": "The deterministic router selects the wrong route.",
            "training_necessity": "required",
            "deterministic_causes_eliminated": False,
            "simpler_interventions_rejected": [],
            "capability_target": "Correct deterministic routing behavior",
            "falsifiable_hypothesis": "Increase routing accuracy from 0.60 to at least 0.95.",
            "training_method": "QLoRA supervised instruction tuning",
            "curriculum": ["tool_use"],
            "data_requirements": ["One hundred reviewed examples."],
            "expected_gain": {
                "metric": "routing_accuracy",
                "baseline": 0.6,
                "target": 0.95,
            },
            "regression_risks": ["General routing regression."],
            "stop_conditions": ["Stop after one failed evaluation."],
            "acceptance_thresholds": ["Routing accuracy must be at least 0.95."],
        },
    )
    errors = list(validator().iter_errors(document))
    assert errors


def test_agent_artifacts_cannot_self_authorize_training_or_release() -> None:
    document = artifact(
        "failure_diagnosis",
        "failure_diagnosis_agent",
        {
            "failure_class": "knowledge",
            "root_cause": "The model lacks a verified static domain abstraction.",
            "reproduced": True,
            "baseline": {
                "name": "knowledge_accuracy",
                "value": 0.5,
                "sample_size": 20,
            },
            "deterministic_layers_checked": [],
            "smallest_sufficient_intervention": "retrieval_improvement",
            "training_candidate": False,
        },
    )
    document["authorization_effect"]["authorizes_training"] = True
    document["authorization_effect"]["authorizes_release"] = True
    errors = list(validator().iter_errors(document))
    assert len(errors) >= 2
