"""Fail-closed static controls for Foundation, evaluation, and model-execution plans."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parents[1]

FOUNDATION_PLAN_PATH = ML_ROOT / "configs" / "foundation_release_plan_v1.json"
FOUNDATION_PLAN_SCHEMA_PATH = ML_ROOT / "schemas" / "foundation_release_plan.schema.json"
FOUNDATION_RECORD_SCHEMA_PATH = ML_ROOT / "schemas" / "foundation_record.schema.json"
FOUNDATION_RECORD_TEMPLATE_PATH = ML_ROOT / "data" / "templates" / "foundation_record_TEMPLATE.json"
EVALUATION_PLAN_PATH = ML_ROOT / "configs" / "evaluation_identity_plan_v1.json"
EVALUATION_PLAN_SCHEMA_PATH = ML_ROOT / "schemas" / "evaluation_identity_plan.schema.json"
EXECUTION_GATES_PATH = ML_ROOT / "configs" / "model_execution_gates_v1.json"
EXECUTION_GATES_SCHEMA_PATH = ML_ROOT / "schemas" / "model_execution_gates.schema.json"

PRODUCT_ROUTES = (
    "platform",
    "account",
    "educational",
    "bet_explanation",
    "matchup",
    "full_slate",
    "historical",
    "live_data",
    "general_sports",
)
FOUNDATION_SPLIT_TOTALS = {"total": 2400, "train": 2160, "validation": 240}
FOUNDATION_COVERAGE_MINIMUMS = {
    "tool_required": 720,
    "temporal_or_freshness_sensitive": 600,
    "missing_or_ambiguous_information": 480,
    "abstention_or_error_correction": 360,
    "multi_turn": 360,
    "adversarial_or_false_premise": 240,
}
EVALUATION_CASE_COUNTS = {
    "development": 270,
    "critical": 81,
    "locked": 180,
    "general_regression": 120,
}


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return value


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _schema_errors(instance: object, schema_path: Path) -> list[str]:
    schema = _load_json(schema_path)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = []
    for error in sorted(validator.iter_errors(instance), key=lambda item: list(item.path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{schema_path.name}:{location}: {error.message}")
    return errors


def _all_false(value: object) -> bool:
    return isinstance(value, dict) and bool(value) and all(item is False for item in value.values())


def _check_file_binding(binding: object, label: str, errors: list[str]) -> None:
    if not isinstance(binding, dict):
        errors.append(f"{label} must be an object.")
        return
    relative_path = binding.get("path")
    expected = binding.get("sha256")
    if not isinstance(relative_path, str) or not isinstance(expected, str):
        errors.append(f"{label} must bind path and sha256.")
        return
    path = REPO_ROOT / relative_path
    if not path.is_file():
        errors.append(f"{label} path is missing: {relative_path}")
    elif _sha256(path) != expected:
        errors.append(f"{label} sha256 does not match {relative_path}.")


def validate_foundation_record(record: object) -> list[str]:
    """Validate one canonical private authoring record without treating it as trainer-ready."""

    errors = _schema_errors(record, FOUNDATION_RECORD_SCHEMA_PATH)
    if errors or not isinstance(record, dict):
        return errors

    provenance = record["provenance"]
    if provenance["generator"]["actor_id"] == provenance["critic"]["actor_id"]:
        errors.append("A Foundation record generator cannot be its own critic.")

    coverage = record["expected_behavior"]["coverage"]
    if coverage["tool_required"] != (record["tool_requirement"] == "required"):
        errors.append("expected_behavior.coverage.tool_required must match tool_requirement.")
    temporal = record["freshness_class"] in {"historical_as_of", "temporal", "live"}
    if coverage["temporal_or_freshness_sensitive"] != temporal:
        errors.append(
            "expected_behavior.coverage.temporal_or_freshness_sensitive must match freshness_class."
        )
    user_turns = sum(message["role"] == "user" for message in record["conversation"])
    if coverage["multi_turn"] != (user_turns > 1):
        errors.append("expected_behavior.coverage.multi_turn must match the conversation.")
    if record["freshness_class"] == "live":
        constraints = " ".join(record["critical_constraints"]).casefold()
        if not {"retrieve", "validate", "abstain"} & set(constraints.split()):
            errors.append(
                "Live records must explicitly require retrieval, validation, or abstention."
            )
    return errors


def validate_foundation_plan(plan: object) -> list[str]:
    errors = _schema_errors(plan, FOUNDATION_PLAN_SCHEMA_PATH)
    if errors or not isinstance(plan, dict):
        return errors

    routes = plan["route_mixture"]
    if tuple(routes) != PRODUCT_ROUTES:
        errors.append("Foundation route mixture must use the canonical ordered nine routes.")
    observed_totals = {
        key: sum(route_counts[key] for route_counts in routes.values())
        for key in FOUNDATION_SPLIT_TOTALS
    }
    if observed_totals != FOUNDATION_SPLIT_TOTALS:
        errors.append(
            f"Foundation route totals are {observed_totals}; expected {FOUNDATION_SPLIT_TOTALS}."
        )
    for route, counts in routes.items():
        if counts["train"] + counts["validation"] != counts["total"]:
            errors.append(f"Foundation route {route} split counts do not equal its total.")
    if plan["cross_cutting_minimums"] != FOUNDATION_COVERAGE_MINIMUMS:
        errors.append("Foundation cross-cutting minimums differ from the frozen contract.")

    _check_file_binding(plan["canonical_record_boundary"], "canonical_record_boundary", errors)
    _check_file_binding(
        plan["trainer_release_boundary"]["schema"],
        "trainer_release_boundary.schema",
        errors,
    )
    factory = plan["data_factory"]
    if factory.get("maximum_records_per_generation_shard") != 200:
        errors.append("Data Factory generation shards must be capped at 200 records.")
    if factory.get("generator_may_approve_own_record") is not False:
        errors.append("Data Factory generators must not approve their own records.")
    if (
        factory.get("ai_authorship_policy", {}).get("resolution_status")
        != "BLOCKED_PENDING_EXPLICIT_GOVERNANCE_CHANGE"
    ):
        errors.append("AI-authorship policy conflict must remain explicit until resolved.")
    if not _all_false(plan["authorization_boundary"]):
        errors.append("Foundation plan authorization_boundary must remain entirely false.")
    return errors


def validate_evaluation_plan(plan: object) -> list[str]:
    errors = _schema_errors(plan, EVALUATION_PLAN_SCHEMA_PATH)
    if errors or not isinstance(plan, dict):
        return errors

    layers = plan["layers"]
    if set(layers) != set(EVALUATION_CASE_COUNTS):
        errors.append("Evaluation plan must contain exactly four governed layers.")
    for layer_id, expected_count in EVALUATION_CASE_COUNTS.items():
        layer = layers[layer_id]
        if layer["case_count"] != expected_count:
            errors.append(f"Evaluation layer {layer_id} must contain {expected_count} cases.")
        if layer["training_access"] != "prohibited":
            errors.append(f"Evaluation layer {layer_id} must prohibit training access.")
        for field in (
            "revision",
            "manifest_sha256",
            "record_checksums_sha256",
            "provenance_sha256",
        ):
            if layer[field] is not None:
                errors.append(
                    f"Evaluation layer {layer_id}.{field} must remain null while missing."
                )

    for layer_id, per_route in (("development", 30), ("locked", 20)):
        distribution = layers[layer_id]["route_distribution"]
        if not isinstance(distribution, dict) or tuple(distribution) != PRODUCT_ROUTES:
            errors.append(f"Evaluation layer {layer_id} must cover the canonical nine routes.")
        elif set(distribution.values()) != {per_route}:
            errors.append(f"Evaluation layer {layer_id} must contain {per_route} cases per route.")

    _check_file_binding(plan["legacy_exposed_critical"], "legacy_exposed_critical", errors)
    if (
        layers["critical"]["status"] != "EXPOSED_NOT_SELECTION_ELIGIBLE"
        or plan["legacy_exposed_critical"]["status"] != "EXPOSED_NOT_SELECTION_ELIGIBLE"
    ):
        errors.append(
            "The exposed 81-case suite cannot be mislabeled as sealed or selection-ready."
        )
    if plan["access_separation"]["current_status"] != "BLOCKED":
        errors.append("Evaluation access separation must remain blocked until implemented.")
    if plan["non_overlap_proof"]["status"] != "MISSING":
        errors.append("Evaluation non-overlap proof must remain missing until evidence exists.")
    if not _all_false(plan["authorization_boundary"]):
        errors.append("Evaluation plan authorization_boundary must remain entirely false.")
    return errors


def validate_execution_gates(contract: object) -> list[str]:
    errors = _schema_errors(contract, EXECUTION_GATES_SCHEMA_PATH)
    if errors or not isinstance(contract, dict):
        return errors

    base = contract["base_vs_instruct"]
    _check_file_binding(
        {
            "path": base["contract_path"],
            "sha256": base["contract_sha256"],
        },
        "base_vs_instruct.contract",
        errors,
    )
    if base["serialization_profiles_declared"] is not False:
        errors.append("Serialization profiles cannot be declared before exact manifests exist.")
    if base["execution_authorized"] is not False:
        errors.append("Base-versus-Instruct execution must remain unauthorized.")

    candidate_ab = contract["candidate_ab"]
    candidates = candidate_ab["candidates"]
    if candidates != [
        {
            "candidate_id": "candidate-a",
            "artifact": "selected_unadapted_base",
            "routing_revision": None,
        },
        {
            "candidate_id": "candidate-b",
            "artifact": "selected_unadapted_base",
            "routing_revision": "runtime-answer-routing-v1",
        },
    ]:
        errors.append("Candidate A/B overrides must differ only by routing revision.")
    unresolved_shared = (
        "base_model",
        "base_revision",
        "tokenizer_revision",
        "container_digest",
        "retrieval_revision",
        "evaluation_revisions",
    )
    if any(candidate_ab["shared_tuple"][key] is not None for key in unresolved_shared):
        errors.append("Unresolved Candidate A/B shared controls must remain null.")

    early = contract["early_stopping_preflight"]
    if early["minimum_validation_events"] != 6:
        errors.append("Full training must require at least six validation events.")
    if early["evaluation_and_checkpoint_cadence_aligned"] is not True:
        errors.append("Evaluation and checkpoint cadence must be aligned.")
    if early["best_checkpoint_restoration_verified"] is not False:
        errors.append("Best-checkpoint restoration cannot be claimed before smoke evidence.")

    gates = contract["runpod_gates"]
    if any(gate["authorized"] is not False for gate in gates.values()):
        errors.append("Every RunPod execution gate must remain unauthorized.")
    if any(gates["gate_3_full_candidate_c"]["prerequisites"].values()):
        errors.append("Full Candidate C prerequisites must remain false before evidence.")
    if not _all_false(contract["authorization_boundary"]):
        errors.append("Model execution authorization_boundary must remain entirely false.")
    return errors


def audit_foundation_control() -> dict[str, Any]:
    """Return a deterministic, sanitized audit report for every PR #247 control."""

    foundation_plan = _load_json(FOUNDATION_PLAN_PATH)
    evaluation_plan = _load_json(EVALUATION_PLAN_PATH)
    execution_gates = _load_json(EXECUTION_GATES_PATH)
    record_template = _load_json(FOUNDATION_RECORD_TEMPLATE_PATH)
    sections = {
        "foundation_plan": validate_foundation_plan(foundation_plan),
        "foundation_record_template": validate_foundation_record(record_template),
        "evaluation_plan": validate_evaluation_plan(evaluation_plan),
        "execution_gates": validate_execution_gates(execution_gates),
    }
    issues = [
        f"{section}: {issue}"
        for section, section_issues in sections.items()
        for issue in section_issues
    ]
    return {
        "schema_version": "dime-foundation-control-audit-v1",
        "pass": not issues,
        "sections": {
            section: {"pass": not section_issues, "issue_count": len(section_issues)}
            for section, section_issues in sections.items()
        },
        "issues": issues,
        "authorization_effect": "none",
    }
