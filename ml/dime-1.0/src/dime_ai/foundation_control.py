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
FOUNDATION_ROUTE_MIXTURE = {
    "platform": {"total": 300, "train": 270, "validation": 30},
    "account": {"total": 180, "train": 162, "validation": 18},
    "educational": {"total": 300, "train": 270, "validation": 30},
    "bet_explanation": {"total": 300, "train": 270, "validation": 30},
    "matchup": {"total": 420, "train": 378, "validation": 42},
    "full_slate": {"total": 180, "train": 162, "validation": 18},
    "historical": {"total": 240, "train": 216, "validation": 24},
    "live_data": {"total": 300, "train": 270, "validation": 30},
    "general_sports": {"total": 180, "train": 162, "validation": 18},
}
FOUNDATION_COVERAGE_MINIMUMS = {
    "tool_required": 720,
    "temporal_or_freshness_sensitive": 600,
    "missing_or_ambiguous_information": 480,
    "abstention_or_error_correction": 360,
    "multi_turn": 360,
    "adversarial_or_false_premise": 240,
}
FOUNDATION_AUTHORIZATION_KEYS = {
    "record_generation",
    "private_dataset_publication",
    "foundation_dataset_approval",
    "runpod_invocation",
    "model_download",
    "model_training",
    "benchmark_execution",
    "model_selection",
    "provider_activation",
    "railway_mutation",
    "trace_activation",
    "shadow_traffic",
    "route_activation",
}
EVALUATION_CASE_COUNTS = {
    "development": 270,
    "critical": 81,
    "locked": 180,
    "general_regression": 120,
}
EVALUATION_REPOSITORIES = {
    "development": (
        "taileredsports/dime-eval-development-cases",
        "taileredsports/dime-eval-development-keys",
    ),
    "critical": (
        "taileredsports/dime-eval-critical-cases",
        "taileredsports/dime-eval-critical-keys",
    ),
    "locked": (
        "taileredsports/dime-eval-locked-cases",
        "taileredsports/dime-eval-locked-keys",
    ),
    "general_regression": (
        "taileredsports/dime-eval-general-regression-cases",
        "taileredsports/dime-eval-general-regression-keys",
    ),
}
EVALUATION_IDENTITY_CONTROLS = [
    "immutable_repository_revision",
    "manifest_checksum",
    "record_checksum_manifest",
    "creation_provenance",
    "explicit_non_overlap_proof",
    "training_access_prohibition",
    "separate_answer_key_access",
]
EVALUATION_ACCESS_SEPARATION = {
    "semantic_cases_exclude_gold_answers": True,
    "answer_keys_bind_semantic_record_sha256": True,
    "training_denied_all_evaluation_repositories": False,
    "runner_denied_answer_keys": False,
    "scorer_denied_training_data_and_model_execution": False,
    "locked_maximum_execution_count": 1,
    "locked_consumption_ledger_required": True,
    "current_status": "BLOCKED",
}
EVALUATION_NON_OVERLAP = {
    "required_pairwise_suite_comparisons": 6,
    "foundation_against_each_suite_comparisons": 4,
    "checks": [
        "case_ids",
        "exact_record_hashes",
        "normalized_instructions",
        "contexts_and_tool_fixtures",
        "restricted_expected_answers",
        "source_event_user_conversation_and_scenario_partitions",
        "temporal_embargoes",
    ],
    "restricted_report_sha256": None,
    "public_proof_sha256": None,
    "status": "MISSING",
}
EVALUATION_AUTHORIZATION_KEYS = {
    "evaluation_dataset_publication",
    "answer_key_publication",
    "runpod_invocation",
    "model_download",
    "benchmark_execution",
    "locked_evaluation_execution",
    "model_selection",
    "model_training",
    "provider_activation",
    "railway_mutation",
    "trace_activation",
    "shadow_traffic",
    "route_activation",
}
EXECUTION_AUTHORIZATION_KEYS = {
    "runpod_invocation",
    "model_download",
    "baseline_inference",
    "model_training",
    "checkpoint_resume",
    "benchmark_execution",
    "locked_evaluation_execution",
    "model_selection",
    "model_serving",
    "provider_activation",
    "railway_mutation",
    "trace_activation",
    "shadow_traffic",
    "route_activation",
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


def _exact_false_map(value: object, expected_keys: set[str]) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == expected_keys
        and all(item is False for item in value.values())
    )


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
    if routes != FOUNDATION_ROUTE_MIXTURE:
        errors.append("Foundation route mixture differs from the exact frozen allocation.")
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
    if factory.get("private_chain_of_thought_allowed") is not False:
        errors.append("Foundation Data Factory cannot retain private chain-of-thought.")
    if not _exact_false_map(plan["authorization_boundary"], FOUNDATION_AUTHORIZATION_KEYS):
        errors.append("Foundation authorization_boundary must contain every exact false gate.")
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
        semantic_repo, answer_key_repo = EVALUATION_REPOSITORIES[layer_id]
        identities = (
            ("semantic_identity", semantic_repo),
            ("answer_key_identity", answer_key_repo),
        )
        for identity_key, expected_repo in identities:
            identity = layer[identity_key]
            if identity["repo_id"] != expected_repo:
                errors.append(f"Evaluation layer {layer_id}.{identity_key}.repo_id is not frozen.")
            for field in (
                "revision",
                "manifest_sha256",
                "record_checksums_sha256",
                "provenance_sha256",
            ):
                if identity[field] is not None:
                    errors.append(
                        f"Evaluation layer {layer_id}.{identity_key}.{field} "
                        "must remain null while missing."
                    )
        if semantic_repo == answer_key_repo:
            errors.append(f"Evaluation layer {layer_id} must separate semantic and answer keys.")
        if layer["required_training_access"] != "prohibited":
            errors.append(f"Evaluation layer {layer_id} must require prohibited training access.")
        if layer["effective_access_verified"] is not False:
            errors.append(
                f"Evaluation layer {layer_id} cannot claim effective access verification."
            )
        if layer["status"] != "MISSING":
            errors.append(f"Evaluation layer {layer_id} must remain missing.")

    for layer_id, per_route in (("development", 30), ("locked", 20)):
        distribution = layers[layer_id]["route_distribution"]
        if not isinstance(distribution, dict) or tuple(distribution) != PRODUCT_ROUTES:
            errors.append(f"Evaluation layer {layer_id} must cover the canonical nine routes.")
        elif set(distribution.values()) != {per_route}:
            errors.append(f"Evaluation layer {layer_id} must contain {per_route} cases per route.")

    _check_file_binding(plan["legacy_exposed_critical"], "legacy_exposed_critical", errors)
    if plan["legacy_exposed_critical"]["status"] != "EXPOSED_NOT_SELECTION_ELIGIBLE":
        errors.append("The legacy public 81-case suite must remain exposed and ineligible.")
    if plan["required_identity_controls"] != EVALUATION_IDENTITY_CONTROLS:
        errors.append("Evaluation identity controls differ from the frozen contract.")
    if plan["access_separation"] != EVALUATION_ACCESS_SEPARATION:
        errors.append("Evaluation access separation differs from the blocked contract.")
    if plan["non_overlap_proof"] != EVALUATION_NON_OVERLAP:
        errors.append("Evaluation non-overlap requirements differ from the missing-state contract.")
    if not _exact_false_map(plan["authorization_boundary"], EVALUATION_AUTHORIZATION_KEYS):
        errors.append("Evaluation plan authorization_boundary must contain every exact false gate.")
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
    if (
        candidate_ab["candidate_a_complete"] is not False
        or candidate_ab["candidate_b_complete"] is not False
        or candidate_ab["execution_authorized"] is not False
    ):
        errors.append("Candidate A/B completion and execution flags must remain false.")

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
    if gates["gate_2_smoke_training"]["serving_authorized"] is not False:
        errors.append("Gate 2 cannot authorize serving.")
    if any(gates["gate_3_full_candidate_c"]["prerequisites"].values()):
        errors.append("Full Candidate C prerequisites must remain false before evidence.")
    if contract["candidate_c_selection"]["selection_authorized"] is not False:
        errors.append("Candidate C selection must remain unauthorized.")
    if not _exact_false_map(contract["authorization_boundary"], EXECUTION_AUTHORIZATION_KEYS):
        errors.append("Model execution authorization_boundary must contain every exact false gate.")
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
        "plan_valid": not issues,
        "ready": False,
        "status": "INCOMPLETE_NOT_AUTHORIZED",
        "sections": {
            section: {"pass": not section_issues, "issue_count": len(section_issues)}
            for section, section_issues in sections.items()
        },
        "issues": issues,
        "authorization_effect": "none",
    }
