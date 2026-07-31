"""Incremental, fail-closed Foundation admission and sanitized evidence.

The prior cumulative proof is checksum-pinned and identity-revalidated. Only the
new delta is re-admitted and compared. Any proof-contract, corpus, private-root,
or lineage mismatch requires a separately authorized full historical rerun.
"""

from __future__ import annotations

import ast
import hashlib
import inspect
import os
import re
import shutil
import stat
import textwrap
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from dime_ai import (
    foundation_dataset,
    foundation_partitioning,
    foundation_private_evaluation_comparison,
)
from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.data_validation import CREDENTIAL_PATTERNS, DISALLOWED_KEYS, EMAIL_PATTERN
from dime_ai.foundation_dataset import (
    _development_contamination,
    find_exact_duplicates,
    find_semantic_neighbors,
    normalized_message_signature,
)
from dime_ai.foundation_execution_evidence import (
    AUTHORIZATION_BOUNDARY,
    EXTERNAL_OPERATIONS,
    FoundationExecutionEvidenceError,
    _load_object,
    _manifest_records,
    _private_root,
    _public_file,
    _reject_continuation_private_fields,
    _repository_evaluation_records,
    _sha256_file,
    _source_packets,
    route_deficits,
    secure_inventory,
    validate_foundation_artifact,
)
from dime_ai.foundation_partitioning import (
    PartitionRegistryError,
    validate_partition_groups,
)
from dime_ai.foundation_private_evaluation_comparison import (
    CHARACTER_JACCARD_THRESHOLD,
    CHARACTER_SHINGLE_SIZE,
    TOKEN_BIGRAM_JACCARD_THRESHOLD,
    FoundationEvaluationComparisonError,
    compare_partitions,
    load_accepted_foundation,
    load_semantic_r5,
)
from dime_ai.private_evaluation_semantics import validate_semantic_case

ML_ROOT = Path(__file__).resolve().parents[2]
RELEASE_PLAN_PATH = ML_ROOT / "configs" / "foundation_release_plan_v1.json"
BOUNDARY_SCHEMA_PATH = ML_ROOT / "schemas" / "foundation_cumulative_boundary.schema.json"
EVIDENCE_SCHEMA_PATH = ML_ROOT / "schemas" / "foundation_cumulative_evidence.schema.json"
ROUTES = (
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
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
EXECUTION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]+$")
PRIVATE_PATH_MARKERS = (
    "/private-output/",
    "/private-recovery/",
    "\\private-output\\",
    "\\private-recovery\\",
)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?<!\S)(?:/|[A-Za-z]:[\\/]|\\\\)[^\s]*")
PROOF_CONTRACT_VERSION = "dime-foundation-incremental-proof-contract-v1"
PROOF_COMPATIBILITY_MODE = (
    "BOOTSTRAP_PRIOR_PROOF_SEMANTIC_PRIMITIVES_UNCHANGED_ADDITIVE_VALIDATION_ONLY"
)
NO_FALLBACK = "FULL_HISTORICAL_RERUN_REQUIRED"
PRIOR_SCHEMA_VERSION = "dime-foundation-continuation-evidence-v1"
PRIOR_EXPECTED_RECORDS = 300
DELTA_EXPECTED_RECORDS = 150
SEMANTIC_CASE_COUNT = 651


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _validate_schema(document: Mapping[str, Any], path: Path, label: str) -> None:
    schema = _load_object(path, f"{label} schema")
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(document),
        key=lambda error: tuple(str(part) for part in error.absolute_path),
    )
    if errors:
        error = errors[0]
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        raise FoundationExecutionEvidenceError(f"{label}.{location}: {error.message}")


def _ml_path(relative: str, label: str) -> Path:
    candidate = Path(relative)
    if (
        not relative
        or candidate.is_absolute()
        or ".." in candidate.parts
        or candidate.as_posix() != relative
    ):
        raise FoundationExecutionEvidenceError(f"{label} path is unsafe")
    absolute = (ML_ROOT / candidate).absolute()
    resolved_parent = absolute.parent.resolve(strict=True)
    if not resolved_parent.is_relative_to(ML_ROOT):
        raise FoundationExecutionEvidenceError(f"{label} path escapes the ML root")
    return absolute


def _regular_public_file(path: Path, label: str) -> Path:
    absolute = path.absolute()
    if absolute.is_symlink() or not absolute.is_file():
        raise FoundationExecutionEvidenceError(f"{label} is not a regular public file")
    info = absolute.stat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) not in {0o444, 0o600, 0o644}
    ):
        raise FoundationExecutionEvidenceError(f"{label} public file boundary failed")
    return absolute


def _exact_public_ledger(
    *,
    root: Path,
    readme_sha256: str,
    evidence_sha256: str,
    ledger_sha256: str,
) -> None:
    expected = (f"{readme_sha256}  README.md\n{evidence_sha256}  evidence.json\n").encode("ascii")
    ledger = _regular_public_file(root / "SHA256SUMS", "prior SHA256SUMS")
    if ledger.read_bytes() != expected or _sha256_file(ledger) != ledger_sha256:
        raise FoundationExecutionEvidenceError("prior public checksum ledger drifted")
    actual = {path.name for path in root.iterdir() if path.is_file() and not path.is_symlink()}
    if actual != {"README.md", "evidence.json", "SHA256SUMS"}:
        raise FoundationExecutionEvidenceError("prior public evidence inventory is not exact")


def _ast_sha256(function: Callable[..., object]) -> str:
    source = textwrap.dedent(inspect.getsource(function))
    tree = ast.parse(source)
    return _sha256_bytes(ast.dump(tree, include_attributes=False).encode("utf-8"))


def _primitive_hashes() -> dict[str, str]:
    return {
        "canonical_json_bytes": _ast_sha256(canonical_json_bytes),
        "compare_partitions": _ast_sha256(compare_partitions),
        "cross_foundation_comparator": _ast_sha256(_compare_delta_to_prior),
        "development_contamination": _ast_sha256(_development_contamination),
        "evaluation_material": _ast_sha256(
            foundation_private_evaluation_comparison._evaluation_material
        ),
        "find_exact_duplicates": _ast_sha256(find_exact_duplicates),
        "find_semantic_neighbors": _ast_sha256(find_semantic_neighbors),
        "foundation_material": _ast_sha256(
            foundation_private_evaluation_comparison._foundation_material
        ),
        "foundation_shingles": _ast_sha256(foundation_dataset._shingles),
        "normalized_message_signature": _ast_sha256(
            foundation_dataset.normalized_message_signature
        ),
        "partition_groups": _ast_sha256(foundation_partitioning._partition_groups),
        "partition_validator": _ast_sha256(validate_partition_groups),
        "semantic_case_validator": _ast_sha256(validate_semantic_case),
    }


def _expected_semantic_parameters() -> dict[str, int | float]:
    return {
        "foundation_shingle_size": 5,
        "foundation_jaccard_threshold": 0.92,
        "evaluation_character_shingle_size": CHARACTER_SHINGLE_SIZE,
        "evaluation_character_jaccard_threshold": CHARACTER_JACCARD_THRESHOLD,
        "evaluation_token_bigram_jaccard_threshold": TOKEN_BIGRAM_JACCARD_THRESHOLD,
    }


def _validate_file_hashes(entries: object, label: str) -> None:
    if not isinstance(entries, list) or not entries:
        raise FoundationExecutionEvidenceError(f"{label} file bindings are absent")
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            raise FoundationExecutionEvidenceError(f"{label} file binding is malformed")
        relative = entry["path"]
        expected = entry["sha256"]
        if (
            not isinstance(relative, str)
            or relative in seen
            or not isinstance(expected, str)
            or SHA256_PATTERN.fullmatch(expected) is None
        ):
            raise FoundationExecutionEvidenceError(f"{label} file binding is malformed")
        seen.add(relative)
        path = _regular_public_file(_ml_path(relative, label), label)
        if _sha256_file(path) != expected:
            raise FoundationExecutionEvidenceError(f"{label} file hash drifted: {relative}")


def _contract_hash(contract: Mapping[str, Any]) -> str:
    payload = {key: value for key, value in contract.items() if key != "contract_sha256"}
    return _sha256_bytes(b"dime-foundation-proof-contract-v1\0" + canonical_json_bytes(payload))


def _repository_evaluation_identity(contract: Mapping[str, Any]) -> None:
    identity = contract.get("repository_evaluation_identity")
    if not isinstance(identity, dict) or set(identity) != {"record_count", "files"}:
        raise FoundationExecutionEvidenceError("repository evaluation identity is malformed")
    _validate_file_hashes(identity["files"], "repository evaluation")
    if identity["record_count"] != len(_repository_evaluation_records()):
        raise FoundationExecutionEvidenceError("repository evaluation record count drifted")


def validate_proof_contract(contract: Mapping[str, Any]) -> None:
    if (
        contract.get("contract_version") != PROOF_CONTRACT_VERSION
        or contract.get("compatibility_mode") != PROOF_COMPATIBILITY_MODE
        or contract.get("fallback_on_mismatch") != NO_FALLBACK
        or contract.get("semantic_parameters") != _expected_semantic_parameters()
        or contract.get("primitive_ast_sha256") != _primitive_hashes()
    ):
        raise FoundationExecutionEvidenceError(
            "proof contract mismatch requires a full historical rerun"
        )
    _validate_file_hashes(contract.get("file_sha256"), "proof contract")
    _repository_evaluation_identity(contract)
    expected_hash = contract.get("contract_sha256")
    if (
        not isinstance(expected_hash, str)
        or SHA256_PATTERN.fullmatch(expected_hash) is None
        or expected_hash != _contract_hash(contract)
    ):
        raise FoundationExecutionEvidenceError("proof contract hash drifted")


def _validate_historical_compatibility(
    *,
    prior: Mapping[str, Any],
    evidence: Mapping[str, Any],
    contract: Mapping[str, Any],
) -> None:
    identity = contract["prior_proof_identity"]
    capsule = evidence["context_capsule"]
    repository = capsule["repository"]
    release_plan_binding = next(
        (
            item["sha256"]
            for item in contract["file_sha256"]
            if item["path"] == "configs/foundation_release_plan_v1.json"
        ),
        None,
    )
    if (
        identity["evidence_commit"] != prior["evidence_commit"]
        or identity["private_proof_dependency_commit"] != prior["private_proof_dependency_commit"]
        or repository["base_commit"] != prior["private_proof_dependency_commit"]
        or repository["corrective_commit"] != prior["private_proof_dependency_commit"]
        or capsule["governing_implementations"] != identity["governing_implementations"]
        or evidence["semantic_evaluation"]["bindings"] != contract["semantic_suite_identity"]
        or capsule["release_plan"]["sha256"] != release_plan_binding
        or identity["repository_evaluation_policy"]
        != "RERUN_CURRENT_CUMULATIVE_NO_HISTORICAL_REUSE"
    ):
        raise FoundationExecutionEvidenceError(
            "historical proof compatibility requires a full affected-gate rerun"
        )


def _exact_zero_operations(value: object) -> bool:
    return value == EXTERNAL_OPERATIONS


def _exact_closed_authorization(value: object) -> bool:
    return value == AUTHORIZATION_BOUNDARY


def _validate_prior_public_proof(prior: Mapping[str, Any]) -> dict[str, Any]:
    if prior.get("schema_version") != PRIOR_SCHEMA_VERSION:
        raise FoundationExecutionEvidenceError("prior schema-version boundary drifted")
    for name in ("evidence_sha256", "readme_sha256", "sha256sums_sha256"):
        if SHA256_PATTERN.fullmatch(str(prior.get(name))) is None:
            raise FoundationExecutionEvidenceError("prior public hash is malformed")
    evidence_path = _regular_public_file(
        _ml_path(str(prior["evidence_path"]), "prior evidence"),
        "prior evidence",
    )
    readme_path = _regular_public_file(
        _ml_path(str(prior["readme_path"]), "prior README"),
        "prior README",
    )
    ledger_path = _regular_public_file(
        _ml_path(str(prior["sha256sums_path"]), "prior SHA256SUMS"),
        "prior SHA256SUMS",
    )
    if (
        evidence_path.parent != readme_path.parent
        or evidence_path.parent != ledger_path.parent
        or _sha256_file(evidence_path) != prior["evidence_sha256"]
        or _sha256_file(readme_path) != prior["readme_sha256"]
    ):
        raise FoundationExecutionEvidenceError("prior public proof anchor drifted")
    _exact_public_ledger(
        root=evidence_path.parent,
        readme_sha256=prior["readme_sha256"],
        evidence_sha256=prior["evidence_sha256"],
        ledger_sha256=prior["sha256sums_sha256"],
    )
    schema_path = _regular_public_file(
        _ml_path(str(prior["schema_path"]), "prior schema"),
        "prior schema",
    )
    if _sha256_file(schema_path) != prior["schema_sha256"]:
        raise FoundationExecutionEvidenceError("prior evidence schema hash drifted")
    evidence = _load_object(evidence_path, "prior cumulative evidence")
    _reject_continuation_private_fields(evidence)
    _validate_schema(evidence, schema_path, "prior cumulative evidence")
    admission = evidence.get("admission", {})
    combined = evidence.get("combined_gate", {})
    semantic = evidence.get("semantic_evaluation", {})
    semantic_overlap = semantic.get("foundation_to_evaluation_non_overlap", {})
    capsule = evidence.get("context_capsule", {})
    if (
        evidence.get("schema_version") != prior["schema_version"]
        or evidence.get("evidence_id") != prior["evidence_id"]
        or admission.get("admitted_record_count") != prior["record_count"]
        or combined.get("record_count") != prior["record_count"]
        or combined.get("split") != prior["split"]
        or combined.get("route_counts")
        != {route: count for route, count in prior["route_counts"].items() if count}
        or semantic.get("case_count") != prior["semantic_case_count"]
        or semantic_overlap.get("pair_comparisons") != prior["semantic_pair_comparisons"]
        or semantic_overlap.get("disallowed_overlap_count") != 0
        or evidence.get("private_content_counts")
        != {
            "answer_keys": 0,
            "credentials": 0,
            "foundation_records": 0,
            "semantic_cases": 0,
        }
        or not _exact_zero_operations(capsule.get("external_operations"))
        or not _exact_closed_authorization(capsule.get("authorization_boundary"))
    ):
        raise FoundationExecutionEvidenceError("prior cumulative proof drifted")
    if prior["record_count"] != PRIOR_EXPECTED_RECORDS:
        raise FoundationExecutionEvidenceError("prior record count is not the 300-record proof")
    return evidence


def _record_identity_root(
    records: Sequence[Mapping[str, Any]],
    *,
    label: str,
) -> tuple[str, set[str]]:
    identifiers = [record.get("example_id") for record in records]
    if any(not isinstance(item, str) or not item for item in identifiers) or len(
        set(identifiers)
    ) != len(identifiers):
        raise FoundationExecutionEvidenceError(f"{label} record identity inventory drifted")
    values = {str(item) for item in identifiers}
    leaves = sorted(
        _sha256_bytes(b"dime-foundation-record-identity-v1\0" + value.encode("utf-8"))
        for value in values
    )
    root = _sha256_bytes(
        b"dime-foundation-record-set-v1\0"
        + canonical_json_bytes({"count": len(leaves), "leaves": leaves})
    )
    return root, values


def _compare_delta_to_prior(
    prior_records: Sequence[Mapping[str, Any]],
    delta_records: Sequence[Mapping[str, Any]],
    *,
    shingle_size: int = 5,
    threshold: float = 0.92,
) -> dict[str, int]:
    """Compare only the new delta to its parent without replaying parent-internal work."""

    prior_features = []
    for record in prior_records:
        signature = normalized_message_signature(dict(record))
        prior_features.append((signature, foundation_dataset._shingles(signature, shingle_size)))
    exact_duplicates = 0
    semantic_duplicates = 0
    pair_comparisons = 0
    for record in delta_records:
        signature = normalized_message_signature(dict(record))
        current = foundation_dataset._shingles(signature, shingle_size)
        for prior_signature, prior in prior_features:
            pair_comparisons += 1
            if signature == prior_signature:
                exact_duplicates += 1
            union = current | prior
            similarity = len(current & prior) / len(union) if union else 1.0
            if similarity >= threshold:
                semantic_duplicates += 1
    return {
        "pair_comparisons": pair_comparisons,
        "exact_duplicates": exact_duplicates,
        "semantic_duplicates": semantic_duplicates,
    }


def _validate_prior_private_artifacts(
    *,
    prior: Mapping[str, Any],
    evidence: Mapping[str, Any],
    artifact_roots: Mapping[str, Path],
    source_packet_roots: Mapping[str, Path],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    expectations = prior["private_artifacts"]
    expected_ids = [item["artifact_id"] for item in expectations]
    if (
        set(artifact_roots) != set(expected_ids)
        or set(source_packet_roots) != set(expected_ids)
        or len(expected_ids) != len(set(expected_ids))
    ):
        raise FoundationExecutionEvidenceError("prior private-root mapping is not exact")
    all_authoring: list[dict[str, Any]] = []
    all_trainers: list[dict[str, Any]] = []
    bindings: list[dict[str, Any]] = []
    prior_admission = evidence["admission"]
    prior_inventories = evidence["private_inventory_bindings"]
    for expected in expectations:
        artifact_id = expected["artifact_id"]
        root = _private_root(artifact_roots[artifact_id], artifact_id)
        inventory = secure_inventory(root, artifact_id)
        authoring, _ = _manifest_records(
            root,
            "authoring-manifest.json",
            "ACCEPTED_PRIVATE_NOT_RELEASED",
        )
        try:
            trainers, _report, loader_bindings = load_accepted_foundation(
                root,
                expected_counts=expected["expected_counts"],
                expected_execution_id=expected["execution_id"],
                expected_report_schema=expected["report_schema"],
            )
        except FoundationEvaluationComparisonError as exc:
            raise FoundationExecutionEvidenceError(
                f"prior private artifact failed: {artifact_id}"
            ) from exc
        _packets, source_inventory = _source_packets(
            source_packet_roots[artifact_id],
            f"{artifact_id}_source_packets",
        )
        observed = {
            "artifact_id": artifact_id,
            "execution_id": loader_bindings["execution_id"],
            "sha256sums_sha256": inventory["sha256sums_sha256"],
            "authoring_manifest_sha256": _sha256_file(root / "authoring-manifest.json"),
            "trainer_manifest_sha256": loader_bindings["trainer_manifest_sha256"],
            "report_sha256": loader_bindings["final_report_sha256"],
            "source_packet_content_inventory_sha256": source_inventory["content_inventory_sha256"],
        }
        expected_observed = {key: expected[key] for key in observed}
        public_bindings = prior_admission[artifact_id]["bindings"]
        prior_inventory_key = artifact_id
        prior_source_inventory_key = artifact_id.replace("_shard", "_source_packets")
        if (
            observed != expected_observed
            or prior_inventories[prior_inventory_key] != inventory
            or prior_inventories[prior_source_inventory_key] != source_inventory
            or public_bindings["authoring_manifest_sha256"] != observed["authoring_manifest_sha256"]
            or public_bindings["trainer_manifest_sha256"] != observed["trainer_manifest_sha256"]
            or public_bindings["report_sha256"] != observed["report_sha256"]
            or public_bindings["source_packet_content_inventory_sha256"]
            != observed["source_packet_content_inventory_sha256"]
        ):
            raise FoundationExecutionEvidenceError(
                f"prior protected-root binding drifted: {artifact_id}"
            )
        bindings.append(
            {
                **observed,
                "inventory": inventory,
                "source_packet_inventory": source_inventory,
            }
        )
        all_authoring.extend(authoring)
        all_trainers.extend(trainers)
    if len(all_trainers) != prior["record_count"]:
        raise FoundationExecutionEvidenceError("prior private record total drifted")
    return all_authoring, all_trainers, bindings


def _delta_expectation_checks(
    *,
    expectation: Mapping[str, Any],
    admission: Mapping[str, Any],
    authoring: Sequence[Mapping[str, Any]],
    trainers: Sequence[Mapping[str, Any]],
    prior_authoring: Sequence[Mapping[str, Any]],
    packets: Mapping[str, Mapping[str, Any]],
) -> None:
    counts = expectation["expected_counts"]
    task_types = {str(record["task_type"]) for record in authoring}
    prior_task_types = {str(record["task_type"]) for record in prior_authoring}
    tool_counts = Counter(str(record["tool_requirement"]) for record in authoring)
    coverage = Counter()
    for record in authoring:
        coverage.update(
            key for key, enabled in record["expected_behavior"]["coverage"].items() if enabled
        )
    source_hashes = {packet["snapshot_sha256"] for packet in packets.values()}
    if (
        len(authoring) != DELTA_EXPECTED_RECORDS
        or len(trainers) != DELTA_EXPECTED_RECORDS
        or admission["reported_counts"] != counts
        or admission["per_record_admission"]["route_split_counts"]
        != expectation["route_split_counts"]
        or len(packets) != expectation["source_packet_count"]
        or len(task_types) != expectation["task_type_count"]
        or len(task_types & prior_task_types) != expectation["prior_task_type_overlap"]
        or dict(tool_counts) != expectation["tool_requirement_counts"]
        or expectation["prior_record_count"] != len(prior_authoring)
        or expectation["delta_to_prior_pair_comparisons"] != len(trainers) * len(prior_authoring)
        or expectation["delta_to_semantic_pair_comparisons"] != len(trainers) * SEMANTIC_CASE_COUNT
        or not set(expectation["required_source_snapshot_sha256"]).issubset(source_hashes)
        or any(coverage[key] < minimum for key, minimum in expectation["coverage_minima"].items())
    ):
        raise FoundationExecutionEvidenceError("delta artifact expectation drifted")


def _validate_delta(
    *,
    expectation: Mapping[str, Any],
    artifact_root: Path,
    source_packet_root: Path,
    prior_authoring: Sequence[Mapping[str, Any]],
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
]:
    artifact_id = expectation["artifact_id"]
    admission, authoring = validate_foundation_artifact(
        root=artifact_root,
        source_packet_root=source_packet_root,
        pilot=False,
        artifact_label=artifact_id,
        expected_counts=expectation["expected_counts"],
        expected_execution_id=expectation["execution_id"],
        expected_report_schema=expectation["report_schema"],
    )
    try:
        trainers, _report, loader_bindings = load_accepted_foundation(
            artifact_root,
            expected_counts=expectation["expected_counts"],
            expected_execution_id=expectation["execution_id"],
            expected_report_schema=expectation["report_schema"],
        )
    except FoundationEvaluationComparisonError as exc:
        raise FoundationExecutionEvidenceError("delta trainer boundary failed") from exc
    packets, source_inventory = _source_packets(
        source_packet_root,
        f"{artifact_id}_source_packets_recheck",
    )
    _delta_expectation_checks(
        expectation=expectation,
        admission=admission,
        authoring=authoring,
        trainers=trainers,
        prior_authoring=prior_authoring,
        packets=packets,
    )
    root = _private_root(artifact_root, artifact_id)
    bindings = {
        "artifact_id": artifact_id,
        "execution_id": loader_bindings["execution_id"],
        "sha256sums_sha256": admission["inventory"]["sha256sums_sha256"],
        "authoring_manifest_sha256": admission["bindings"]["authoring_manifest_sha256"],
        "trainer_manifest_sha256": loader_bindings["trainer_manifest_sha256"],
        "report_sha256": loader_bindings["final_report_sha256"],
        "source_packet_content_inventory_sha256": source_inventory["content_inventory_sha256"],
        "latest_report_sha256": _sha256_file(root / expectation["latest_report_path"]),
        "partition_registry_sha256": _sha256_file(root / "partition-registry.json"),
    }
    if (
        bindings["latest_report_sha256"] != expectation["latest_report_sha256"]
        or bindings["partition_registry_sha256"] != expectation["partition_registry_sha256"]
        or bindings["source_packet_content_inventory_sha256"]
        != expectation["source_packet_content_inventory_sha256"]
    ):
        raise FoundationExecutionEvidenceError("delta cumulative-report binding drifted")
    return admission, authoring, trainers, bindings


def _validate_semantic_suite(
    *,
    semantic_root: Path,
    contract: Mapping[str, Any],
    delta_trainers: Sequence[Mapping[str, Any]],
    expected_pair_count: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    try:
        cases, manifest, bindings = load_semantic_r5(semantic_root)
        comparisons, collisions = compare_partitions(delta_trainers, cases)
    except FoundationEvaluationComparisonError as exc:
        raise FoundationExecutionEvidenceError("delta semantic gate failed") from exc
    if bindings != contract["semantic_suite_identity"]:
        raise FoundationExecutionEvidenceError(
            "semantic-suite identity changed; full historical rerun required"
        )
    answer_key_failures = sum(
        1
        for partition in cases.values()
        for case in partition
        if validate_semantic_case(case)
        or case.get("privacy", {}).get("contains_gold_answers") is not False
        or any(key in case for key in ("answer", "answer_key", "expected_answer", "gold"))
    )
    pair_count = sum(item["pair_comparisons"] for item in comparisons.values())
    if collisions or answer_key_failures or pair_count != expected_pair_count:
        raise FoundationExecutionEvidenceError("delta semantic comparison failed")
    return (
        {
            "case_count": sum(len(partition) for partition in cases.values()),
            "pair_comparisons": pair_count,
            "disallowed_overlap_count": 0,
            "answer_key_case_count": 0,
            "partition_comparisons": {
                name: {
                    "foundation_records": item["foundation_records"],
                    "evaluation_cases": item["evaluation_cases"],
                    "pair_comparisons": item["pair_comparisons"],
                    "collision_count": 0,
                    "status": item["status"],
                }
                for name, item in comparisons.items()
            },
        },
        manifest,
        bindings,
    )


def _validate_latest_cumulative_report(
    *,
    delta_root: Path,
    expectation: Mapping[str, Any],
    cumulative: Mapping[str, Any],
    partition_registry: Mapping[str, Any],
) -> None:
    root = _private_root(delta_root, "delta cumulative report")
    report_path = root / expectation["latest_report_path"]
    report = _load_object(report_path, "delta cumulative report")
    nonzero_routes = {route: count for route, count in cumulative["route_counts"].items() if count}
    if (
        _sha256_file(report_path) != expectation["latest_report_sha256"]
        or report.get("combined_record_count") != cumulative["record_count"]
        or report.get("combined_split") != cumulative["split"]
        or report.get("route_counts") != nonzero_routes
        or any(report.get("gates", {}).values())
        or report.get("private_semantic_comparison", {}).get("pair_comparisons")
        != cumulative["cumulative_semantic_pair_comparisons_reconciled"]
        or report.get("private_semantic_comparison", {}).get("collision_count") != 0
        or _sha256_file(root / "partition-registry.json")
        != expectation["partition_registry_sha256"]
        or _load_object(root / "partition-registry.json", "delta partition registry")
        != partition_registry
    ):
        raise FoundationExecutionEvidenceError("delta cumulative report drifted")


def _quarantine_summary(
    root: Path,
    expected: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    inventory = secure_inventory(root, f"quarantine_{expected['root_id']}")
    if (
        inventory != expected["inventory"]
        or inventory["sha256sums_sha256"] != expected["sha256sums_sha256"]
    ):
        raise FoundationExecutionEvidenceError("quarantine inventory hash drifted")
    receipt_path = _private_root(root, "quarantine root") / expected["receipt_path"]
    receipt = _load_object(receipt_path, "quarantine receipt")
    if (
        _sha256_file(receipt_path) != expected["receipt_sha256"]
        or receipt.get("incident_id") != expected["incident_id"]
        or receipt.get("status") != expected["status"]
        or receipt.get("admitted_records", 0) != 0
        or any(receipt.get("admission_boundary", {}).values())
        or any(receipt.get("downstream_authorization", {}).values())
    ):
        raise FoundationExecutionEvidenceError("quarantine receipt drifted")
    role = expected["receipt_role"]
    role_assurance = {
        "ORIGINAL_SELF_AUTHORED_INCIDENT_RECEIPT": "SELF_AUTHORED_NOT_INDEPENDENT",
        "SEPARATE_POINT_IN_TIME_LIVE_PROCESS_AUDIT": ("POINT_IN_TIME_ONLY_NO_CONTAINMENT_CLAIM"),
    }
    process_assertion = role_assurance.get(role)
    if process_assertion is None:
        raise FoundationExecutionEvidenceError("unknown quarantine receipt role")
    if role == "ORIGINAL_SELF_AUTHORED_INCIDENT_RECEIPT":
        audit = receipt.get("process_audit", {})
        contradiction = receipt.get("terminal_contradiction", {})
        if (
            audit.get("active_producer_processes") != 0
            or audit.get("audit_completed") is not True
            or audit.get("producer_process_group_remaining") is not False
            or contradiction.get("accepted_tree_observed") is not True
            or contradiction.get("unexpected_post_termination_accepted_tree") is not True
        ):
            raise FoundationExecutionEvidenceError("original quarantine receipt drifted")
    elif role == "SEPARATE_POINT_IN_TIME_LIVE_PROCESS_AUDIT":
        audit = receipt.get("live_process_audit", {})
        binding = receipt.get("producer_control_binding", {})
        if (
            audit.get("matching_producers") != 0
            or audit.get("quiescence_observed") is not True
            or audit.get("detached_process_impossibility_proven") is not False
            or any(binding.values())
        ):
            raise FoundationExecutionEvidenceError("live quarantine audit drifted")
    return (
        {
            "root_id": expected["root_id"],
            "incident_id": expected["incident_id"],
            "receipt_role": role,
            "status": expected["status"],
            "admitted_records": 0,
            "eligible_for_admission": False,
            "eligible_for_repair_or_reuse": False,
            "process_assurance": process_assertion,
            "receipt_sha256": expected["receipt_sha256"],
            "sha256sums_sha256": expected["sha256sums_sha256"],
        },
        inventory,
    )


def _state_hash(domain: str, value: Mapping[str, Any]) -> str:
    return _sha256_bytes(domain.encode("ascii") + b"\0" + canonical_json_bytes(value))


def _validate_lineage(
    *,
    manifest: Mapping[str, Any],
    prior_record_root: str,
    delta_record_root: str,
    cumulative_record_root: str,
    prior_bindings: Sequence[Mapping[str, Any]],
    delta_bindings: Mapping[str, Any],
    proof_contract_sha256: str,
) -> dict[str, str]:
    lineage = manifest["lineage"]
    prior = manifest["prior_boundary"]
    delta = manifest["delta_artifact"]
    parent_payload = {
        "evidence_id": prior["evidence_id"],
        "evidence_commit": prior["evidence_commit"],
        "evidence_sha256": prior["evidence_sha256"],
        "sha256sums_sha256": prior["sha256sums_sha256"],
        "record_identity_root_sha256": prior_record_root,
        "private_artifacts": [
            {
                key: item[key]
                for key in (
                    "artifact_id",
                    "execution_id",
                    "sha256sums_sha256",
                    "trainer_manifest_sha256",
                    "source_packet_content_inventory_sha256",
                )
            }
            for item in prior_bindings
        ],
    }
    parent_hash = _state_hash("dime-foundation-parent-state-v1", parent_payload)
    delta_payload = {
        "artifact_id": delta["artifact_id"],
        "execution_id": delta["execution_id"],
        "record_identity_root_sha256": delta_record_root,
        "bindings": dict(delta_bindings),
    }
    delta_hash = _state_hash("dime-foundation-delta-state-v1", delta_payload)
    cumulative_payload = {
        "parent_state_sha256": parent_hash,
        "delta_identity_sha256": delta_hash,
        "proof_contract_sha256": proof_contract_sha256,
        "cumulative": manifest["cumulative"],
    }
    cumulative_hash = _state_hash(lineage["domain"], cumulative_payload)
    expected = {
        "parent_state_sha256": parent_hash,
        "delta_identity_sha256": delta_hash,
        "prior_record_identity_root_sha256": prior_record_root,
        "delta_record_identity_root_sha256": delta_record_root,
        "cumulative_record_identity_root_sha256": cumulative_record_root,
        "cumulative_state_sha256": cumulative_hash,
    }
    if (
        lineage["parent_evidence_id"] != prior["evidence_id"]
        or lineage["delta_artifact_id"] != delta["artifact_id"]
        or any(lineage[key] != value for key, value in expected.items())
    ):
        raise FoundationExecutionEvidenceError("incremental lineage hash drifted")
    return expected


def validate_cumulative_boundary_manifest(document: Mapping[str, Any]) -> None:
    """Validate the recursively closed manifest and all aggregate formulas."""

    _reject_continuation_private_fields(document)
    _validate_schema(document, BOUNDARY_SCHEMA_PATH, "incremental boundary")
    prior = document["prior_boundary"]
    delta = document["delta_artifact"]
    cumulative = document["cumulative"]
    if (
        prior["evidence_commit"] != document["dependency_commit"]
        or prior["artifact_count"] != len(prior["private_artifacts"])
        or prior["record_count"] != PRIOR_EXPECTED_RECORDS
        or prior["record_count"]
        != sum(item["expected_counts"]["accepted_records"] for item in prior["private_artifacts"])
        or len({item["artifact_id"] for item in prior["private_artifacts"]})
        != len(prior["private_artifacts"])
        or len({item["execution_id"] for item in prior["private_artifacts"]})
        != len(prior["private_artifacts"])
        or delta["artifact_id"] in {item["artifact_id"] for item in prior["private_artifacts"]}
        or delta["execution_id"] in {item["execution_id"] for item in prior["private_artifacts"]}
    ):
        raise FoundationExecutionEvidenceError("incremental identity boundary drifted")
    counts = delta["expected_counts"]
    delta_total = counts["accepted_records"]
    if (
        delta_total != DELTA_EXPECTED_RECORDS
        or counts["trainer_records"] != delta_total
        or counts["train"] + counts["validation"] != delta_total
        or counts["approved_originals"] + counts["approved_repairs"] != delta_total
        or sum(delta["tool_requirement_counts"].values()) != delta_total
        or sum(
            split for splits in delta["route_split_counts"].values() for split in splits.values()
        )
        != delta_total
        or delta["prior_record_count"] != prior["record_count"]
        or delta["delta_to_prior_pair_comparisons"] != delta_total * prior["record_count"]
        or delta["delta_to_semantic_pair_comparisons"] != delta_total * prior["semantic_case_count"]
    ):
        raise FoundationExecutionEvidenceError("incremental delta totals drifted")
    routes = Counter(prior["route_counts"])
    for route, splits in delta["route_split_counts"].items():
        routes[route] += splits["train"] + splits["validation"]
    if (
        cumulative["artifact_count"] != prior["artifact_count"] + 1
        or cumulative["record_count"] != prior["record_count"] + delta_total
        or cumulative["split"]
        != {
            "train": prior["split"]["train"] + counts["train"],
            "validation": prior["split"]["validation"] + counts["validation"],
        }
        or cumulative["route_counts"] != dict(routes)
        or cumulative["prior_semantic_pair_comparisons_reused"]
        != prior["semantic_pair_comparisons"]
        or cumulative["delta_semantic_pair_comparisons_new"]
        != delta["delta_to_semantic_pair_comparisons"]
        or cumulative["cumulative_semantic_pair_comparisons_reconciled"]
        != prior["semantic_pair_comparisons"] + delta["delta_to_semantic_pair_comparisons"]
        or any(item["admitted_records"] != 0 for item in document["quarantines"])
    ):
        raise FoundationExecutionEvidenceError("incremental cumulative totals drifted")
    validate_proof_contract(document["proof_contract"])


def _private_value_scan(
    value: object,
    *,
    forbidden_identifiers: set[str] | None = None,
    location: tuple[str, ...] = (),
) -> None:
    forbidden = forbidden_identifiers or set()
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized_key = str(key).casefold()
            if normalized_key in DISALLOWED_KEYS or any(
                pattern.search(str(key)) for _name, pattern in CREDENTIAL_PATTERNS
            ):
                joined = ".".join((*location, str(key))) or "<root>"
                raise FoundationExecutionEvidenceError(
                    f"public evidence contains a private or sensitive key: {joined}"
                )
            _private_value_scan(
                child,
                forbidden_identifiers=forbidden,
                location=(*location, str(key)),
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _private_value_scan(
                child,
                forbidden_identifiers=forbidden,
                location=(*location, str(index)),
            )
    elif isinstance(value, str):
        if (
            any(identifier in value for identifier in forbidden)
            or ABSOLUTE_PATH_PATTERN.search(value) is not None
            or any(marker in value for marker in PRIVATE_PATH_MARKERS)
            or any(pattern.search(value) for _name, pattern in CREDENTIAL_PATTERNS)
            or EMAIL_PATTERN.search(value) is not None
        ):
            joined = ".".join(location) or "<root>"
            raise FoundationExecutionEvidenceError(
                f"public evidence contains a private or sensitive value: {joined}"
            )


def _validate_public_manifest_bindings(document: Mapping[str, Any]) -> None:
    boundary = document["boundary_manifest"]
    path = _regular_public_file(
        _ml_path(boundary["path"], "incremental evidence boundary"),
        "incremental evidence boundary",
    )
    if _sha256_file(path) != boundary["sha256"]:
        raise FoundationExecutionEvidenceError("public evidence boundary hash drifted")
    manifest = _load_object(path, "incremental evidence boundary")
    validate_cumulative_boundary_manifest(manifest)
    prior = manifest["prior_boundary"]
    delta = manifest["delta_artifact"]
    cumulative = manifest["cumulative"]
    prior_evidence = _validate_prior_public_proof(prior)
    _validate_historical_compatibility(
        prior=prior,
        evidence=prior_evidence,
        contract=manifest["proof_contract"],
    )
    expected_parent = {
        "evidence_id": prior["evidence_id"],
        "evidence_commit": prior["evidence_commit"],
        "evidence_sha256": prior["evidence_sha256"],
        "sha256sums_sha256": prior["sha256sums_sha256"],
        "schema_sha256": prior["schema_sha256"],
        "record_identity_root_sha256": manifest["lineage"]["prior_record_identity_root_sha256"],
        "record_count": prior["record_count"],
        "split": prior["split"],
        "route_counts": prior["route_counts"],
    }
    expected_lineage = {
        "domain": manifest["lineage"]["domain"],
        "parent_state_sha256": manifest["lineage"]["parent_state_sha256"],
        "prior_record_identity_root_sha256": manifest["lineage"][
            "prior_record_identity_root_sha256"
        ],
        "delta_artifact_id": delta["artifact_id"],
        "delta_identity_sha256": manifest["lineage"]["delta_identity_sha256"],
        "delta_record_identity_root_sha256": manifest["lineage"][
            "delta_record_identity_root_sha256"
        ],
        "cumulative_record_identity_root_sha256": manifest["lineage"][
            "cumulative_record_identity_root_sha256"
        ],
        "cumulative_state_sha256": manifest["lineage"]["cumulative_state_sha256"],
        "single_parent": True,
        "acyclic": True,
        "duplicate_artifact_identities": 0,
        "duplicate_execution_identities": 0,
        "duplicate_record_identities": 0,
    }
    prior_bindings = {
        item["artifact_id"]: item
        for item in document["private_inventory_bindings"]["prior_artifacts"]
    }
    if set(prior_bindings) != {item["artifact_id"] for item in prior["private_artifacts"]}:
        raise FoundationExecutionEvidenceError("public prior binding inventory drifted")
    for expected in prior["private_artifacts"]:
        observed = prior_bindings[expected["artifact_id"]]
        for key in (
            "artifact_id",
            "execution_id",
            "sha256sums_sha256",
            "authoring_manifest_sha256",
            "trainer_manifest_sha256",
            "report_sha256",
            "source_packet_content_inventory_sha256",
        ):
            if observed[key] != expected[key]:
                raise FoundationExecutionEvidenceError("public prior artifact binding drifted")
        if (
            observed["inventory"]
            != prior_evidence["private_inventory_bindings"][expected["artifact_id"]]
            or observed["source_packet_inventory"]
            != prior_evidence["private_inventory_bindings"][
                expected["artifact_id"].replace("_shard", "_source_packets")
            ]
            or observed["source_packet_inventory"]["content_inventory_sha256"]
            != expected["source_packet_content_inventory_sha256"]
        ):
            raise FoundationExecutionEvidenceError("public prior artifact inventory drifted")
    delta_bindings = document["private_inventory_bindings"]["delta_artifact"]["bindings"]
    for key in (
        "artifact_id",
        "execution_id",
        "sha256sums_sha256",
        "authoring_manifest_sha256",
        "trainer_manifest_sha256",
        "report_sha256",
        "source_packet_content_inventory_sha256",
        "latest_report_sha256",
        "partition_registry_sha256",
    ):
        if delta_bindings[key] != delta[key]:
            raise FoundationExecutionEvidenceError("public delta artifact binding drifted")
    admitted_aggregate_records: list[dict[str, str]] = []
    for route, values in prior_evidence["foundation_deficits"]["routes"].items():
        for split in ("train", "validation"):
            admitted_aggregate_records.extend(
                {"route": route, "split": split} for _index in range(values["admitted"][split])
            )
    for route, splits in delta["route_split_counts"].items():
        for split, count in splits.items():
            admitted_aggregate_records.extend(
                {"route": route, "split": split} for _index in range(count)
            )
    expected_deficits = route_deficits(
        admitted_aggregate_records,
        release_plan=_load_object(RELEASE_PLAN_PATH, "Foundation release plan"),
    )
    expected_quarantines = {item["root_id"]: item for item in manifest["quarantines"]}
    observed_quarantines = {item["root_id"]: item for item in document["quarantines"]}
    quarantine_inventories = {
        item["root_id"]: item["inventory"]
        for item in document["private_inventory_bindings"]["quarantines"]
    }
    if set(observed_quarantines) != set(expected_quarantines) or set(quarantine_inventories) != set(
        expected_quarantines
    ):
        raise FoundationExecutionEvidenceError("public quarantine inventory drifted")
    for root_id, expected in expected_quarantines.items():
        observed = observed_quarantines[root_id]
        for key in (
            "root_id",
            "incident_id",
            "receipt_role",
            "status",
            "receipt_sha256",
            "sha256sums_sha256",
        ):
            if observed[key] != expected[key]:
                raise FoundationExecutionEvidenceError("public quarantine binding drifted")
        expected_assurance = {
            "ORIGINAL_SELF_AUTHORED_INCIDENT_RECEIPT": "SELF_AUTHORED_NOT_INDEPENDENT",
            "SEPARATE_POINT_IN_TIME_LIVE_PROCESS_AUDIT": (
                "POINT_IN_TIME_ONLY_NO_CONTAINMENT_CLAIM"
            ),
        }[expected["receipt_role"]]
        if (
            observed["process_assurance"] != expected_assurance
            or quarantine_inventories[root_id] != expected["inventory"]
        ):
            raise FoundationExecutionEvidenceError("public quarantine inventory drifted")
    semantic_partitions = prior_evidence["semantic_evaluation"]["partition_counts"]
    expected_partition_comparisons = {
        name: {
            "foundation_records": DELTA_EXPECTED_RECORDS,
            "evaluation_cases": count,
            "pair_comparisons": DELTA_EXPECTED_RECORDS * count,
            "collision_count": 0,
            "status": "PASS",
        }
        for name, count in semantic_partitions.items()
    }
    if (
        document["parent_proof"] != expected_parent
        or document["lineage"] != expected_lineage
        or document["proof_reuse"]["proof_contract_sha256"]
        != manifest["proof_contract"]["contract_sha256"]
        or document["admission"]["split"] != cumulative["split"]
        or document["admission"]["route_counts"] != cumulative["route_counts"]
        or document["semantic_evaluation"]["prior_pair_comparisons_reused"]
        != cumulative["prior_semantic_pair_comparisons_reused"]
        or document["semantic_evaluation"]["delta_pair_comparisons_new"]
        != cumulative["delta_semantic_pair_comparisons_new"]
        or document["semantic_evaluation"]["cumulative_pair_comparisons_reconciled"]
        != cumulative["cumulative_semantic_pair_comparisons_reconciled"]
        or document["semantic_evaluation"]["bindings"]
        != manifest["proof_contract"]["semantic_suite_identity"]
        or document["foundation_deficits"] != expected_deficits
        or document["admission"]["delta"]["bindings"]
        != {key: delta_bindings[key] for key in document["admission"]["delta"]["bindings"]}
        or document["admission"]["delta"]["inventory"]
        != document["private_inventory_bindings"]["delta_artifact"]["inventory"]
        or document["admission"]["delta"]["source_packet_inventory"]
        != document["private_inventory_bindings"]["delta_artifact"]["source_packet_inventory"]
        or document["semantic_evaluation"]["semantic_inventory"]["sha256sums_sha256"]
        != document["semantic_evaluation"]["bindings"]["sha256sums_sha256"]
        or document["private_inventory_bindings"]["semantic_r5"]
        != document["semantic_evaluation"]["semantic_inventory"]
        or document["semantic_evaluation"]["delta_partition_comparisons"]
        != expected_partition_comparisons
    ):
        raise FoundationExecutionEvidenceError("public cumulative binding drifted")


def validate_cumulative_evidence_document(
    document: Mapping[str, Any],
    *,
    forbidden_identifiers: set[str] | None = None,
) -> None:
    _reject_continuation_private_fields(document)
    _private_value_scan(document, forbidden_identifiers=forbidden_identifiers)
    _validate_schema(document, EVIDENCE_SCHEMA_PATH, "incremental evidence")
    _validate_public_manifest_bindings(document)
    admission = document["admission"]
    semantic = document["semantic_evaluation"]
    deficits = document["foundation_deficits"]
    if (
        admission["prior_admitted_records"] + admission["delta_admitted_records"]
        != admission["cumulative_admitted_records"]
        or admission["cumulative_admitted_records"] != deficits["admitted_records"]
        or semantic["prior_pair_comparisons_reused"] + semantic["delta_pair_comparisons_new"]
        != semantic["cumulative_pair_comparisons_reconciled"]
        or any(item["admitted_records"] != 0 for item in document["quarantines"])
        or document["proof_reuse"]["fallback_used"] is not False
    ):
        raise FoundationExecutionEvidenceError(
            "incremental public evidence totals do not reconcile"
        )


def validate_cumulative_artifacts(
    *,
    boundary_manifest_path: Path,
    expected_boundary_manifest_sha256: str,
    prior_artifact_roots: Mapping[str, Path],
    prior_source_packet_roots: Mapping[str, Path],
    delta_artifact_root: Path,
    delta_source_packet_root: Path,
    quarantine_roots: Mapping[str, Path],
    semantic_root: Path,
) -> tuple[dict[str, Any], set[str]]:
    boundary_manifest_path = _regular_public_file(
        boundary_manifest_path.absolute(),
        "incremental boundary manifest",
    )
    try:
        boundary_relative = boundary_manifest_path.relative_to(ML_ROOT).as_posix()
    except ValueError as exc:
        raise FoundationExecutionEvidenceError(
            "incremental boundary manifest is outside the ML root"
        ) from exc
    if boundary_relative != "configs/foundation_cumulative_boundary_450_v1.json":
        raise FoundationExecutionEvidenceError(
            "incremental boundary manifest path is not authoritative"
        )
    manifest = _load_object(boundary_manifest_path, "incremental boundary manifest")
    validate_cumulative_boundary_manifest(manifest)
    if _sha256_file(boundary_manifest_path) != expected_boundary_manifest_sha256:
        raise FoundationExecutionEvidenceError("incremental boundary manifest hash drifted")
    prior = manifest["prior_boundary"]
    prior_evidence = _validate_prior_public_proof(prior)
    _validate_historical_compatibility(
        prior=prior,
        evidence=prior_evidence,
        contract=manifest["proof_contract"],
    )
    prior_authoring, prior_trainers, prior_bindings = _validate_prior_private_artifacts(
        prior=prior,
        evidence=prior_evidence,
        artifact_roots=prior_artifact_roots,
        source_packet_roots=prior_source_packet_roots,
    )
    delta = manifest["delta_artifact"]
    delta_admission, delta_authoring, delta_trainers, delta_bindings = _validate_delta(
        expectation=delta,
        artifact_root=delta_artifact_root,
        source_packet_root=delta_source_packet_root,
        prior_authoring=prior_authoring,
    )
    prior_record_root, prior_ids = _record_identity_root(
        prior_trainers,
        label="prior",
    )
    delta_record_root, delta_ids = _record_identity_root(
        delta_trainers,
        label="delta",
    )
    if prior_ids & delta_ids:
        raise FoundationExecutionEvidenceError("delta reuses a prior record identity")
    combined_trainers = [*prior_trainers, *delta_trainers]
    cumulative_record_root, cumulative_ids = _record_identity_root(
        combined_trainers,
        label="cumulative",
    )
    if cumulative_ids != prior_ids | delta_ids:
        raise FoundationExecutionEvidenceError("cumulative record identity inventory drifted")
    combined_authoring = [*prior_authoring, *delta_authoring]
    cross_overlap = _compare_delta_to_prior(prior_trainers, delta_trainers)
    if (
        cross_overlap["pair_comparisons"] != delta["delta_to_prior_pair_comparisons"]
        or cross_overlap["exact_duplicates"]
        or cross_overlap["semantic_duplicates"]
    ):
        raise FoundationExecutionEvidenceError("delta-to-prior duplicate gate failed")
    try:
        partition_registry = validate_partition_groups(combined_authoring)
    except PartitionRegistryError as exc:
        raise FoundationExecutionEvidenceError("delta-to-prior partition gate failed") from exc
    repository_records = _repository_evaluation_records()
    if _development_contamination(
        combined_trainers,
        repository_records,
        shingle_size=5,
        threshold=0.80,
    ):
        raise FoundationExecutionEvidenceError("cumulative repository-evaluation overlap detected")
    semantic_result, semantic_manifest, semantic_bindings = _validate_semantic_suite(
        semantic_root=semantic_root,
        contract=manifest["proof_contract"],
        delta_trainers=delta_trainers,
        expected_pair_count=delta["delta_to_semantic_pair_comparisons"],
    )
    cumulative = manifest["cumulative"]
    _validate_latest_cumulative_report(
        delta_root=delta_artifact_root,
        expectation=delta,
        cumulative=cumulative,
        partition_registry=partition_registry,
    )
    release_plan = _load_object(RELEASE_PLAN_PATH, "Foundation release plan")
    deficits = route_deficits(combined_authoring, release_plan=release_plan)
    if (
        deficits["remaining_records"] != cumulative["remaining_records"]
        or deficits["remaining_split"] != cumulative["remaining_split"]
        or deficits["admitted_records"] != cumulative["record_count"]
        or deficits["admitted_split"] != cumulative["split"]
    ):
        raise FoundationExecutionEvidenceError("incremental Foundation deficit drifted")
    expected_quarantines = {item["root_id"]: item for item in manifest["quarantines"]}
    if set(quarantine_roots) != set(expected_quarantines):
        raise FoundationExecutionEvidenceError("quarantine-root mapping is not exact")
    quarantines: list[dict[str, Any]] = []
    quarantine_inventories: list[dict[str, Any]] = []
    for root_id, expected in expected_quarantines.items():
        summary, inventory = _quarantine_summary(
            quarantine_roots[root_id],
            expected,
        )
        quarantines.append(summary)
        quarantine_inventories.append({"root_id": root_id, "inventory": inventory})
    proof_contract_hash = manifest["proof_contract"]["contract_sha256"]
    lineage = _validate_lineage(
        manifest=manifest,
        prior_record_root=prior_record_root,
        delta_record_root=delta_record_root,
        cumulative_record_root=cumulative_record_root,
        prior_bindings=prior_bindings,
        delta_bindings=delta_bindings,
        proof_contract_sha256=proof_contract_hash,
    )
    semantic_inventory = secure_inventory(semantic_root, "semantic_r5")
    private_identifiers = prior_ids | delta_ids
    return (
        {
            "boundary_manifest": {
                "boundary_id": manifest["boundary_id"],
                "path": boundary_relative,
                "sha256": expected_boundary_manifest_sha256,
                "dependency_commit": manifest["dependency_commit"],
                "status": manifest["status"],
            },
            "parent_proof": {
                "evidence_id": prior["evidence_id"],
                "evidence_commit": prior["evidence_commit"],
                "evidence_sha256": prior["evidence_sha256"],
                "sha256sums_sha256": prior["sha256sums_sha256"],
                "schema_sha256": prior["schema_sha256"],
                "record_identity_root_sha256": prior_record_root,
                "record_count": prior["record_count"],
                "split": prior["split"],
                "route_counts": prior["route_counts"],
            },
            "proof_reuse": {
                "status": "PASS_EXACT_PARENT_WITH_BOOTSTRAP_COMPATIBILITY",
                "proof_contract_sha256": proof_contract_hash,
                "compatibility_mode": manifest["proof_contract"]["compatibility_mode"],
                "fallback_policy": manifest["proof_contract"]["fallback_on_mismatch"],
                "fallback_used": False,
                "historical_checks_reused": [
                    "prior_full_admission",
                    "prior_internal_deduplication",
                    "prior_semantic_r5_comparisons",
                ],
                "prior_identity_checks_rerun": [
                    "public_evidence_schema_and_checksum_ledger",
                    "private_artifact_closed_inventories",
                    "trainer_and_authoring_manifests",
                    "source_packet_inventory_bindings",
                    "semantic_suite_identity",
                    "repository_evaluation_identity",
                    "proof_contract_identity",
                    "prior_historical_implementation_identity",
                ],
                "delta_checks_new": [
                    "full_delta_admission",
                    "delta_to_prior_exact_and_semantic_overlap",
                    "combined_partition_isolation",
                    "cumulative_repository_evaluation_overlap_rerun",
                    "delta_to_semantic_r5_overlap",
                ],
            },
            "lineage": {
                "domain": manifest["lineage"]["domain"],
                "parent_state_sha256": lineage["parent_state_sha256"],
                "prior_record_identity_root_sha256": lineage["prior_record_identity_root_sha256"],
                "delta_artifact_id": delta["artifact_id"],
                "delta_identity_sha256": lineage["delta_identity_sha256"],
                "delta_record_identity_root_sha256": delta_record_root,
                "cumulative_record_identity_root_sha256": lineage[
                    "cumulative_record_identity_root_sha256"
                ],
                "cumulative_state_sha256": lineage["cumulative_state_sha256"],
                "single_parent": True,
                "acyclic": True,
                "duplicate_artifact_identities": 0,
                "duplicate_execution_identities": 0,
                "duplicate_record_identities": 0,
            },
            "admission": {
                "prior_admitted_records": prior["record_count"],
                "delta": delta_admission,
                "delta_admitted_records": len(delta_authoring),
                "cumulative_admitted_records": len(combined_authoring),
                "quarantined_admitted_records": 0,
                "split": cumulative["split"],
                "route_counts": cumulative["route_counts"],
            },
            "gates": {
                "delta_internal_failures": 0,
                "delta_to_prior_exact_duplicates": 0,
                "delta_to_prior_semantic_duplicates": 0,
                "delta_to_prior_partition_collisions": 0,
                "delta_to_prior_pair_comparisons": cross_overlap["pair_comparisons"],
                "cumulative_repository_evaluation_overlap": 0,
                "delta_private_semantic_overlap": 0,
                "answer_key_cases": 0,
            },
            "semantic_evaluation": {
                "status": "PASS_INCREMENTAL_RECONCILED",
                "semantic_only": True,
                "case_count": SEMANTIC_CASE_COUNT,
                "answer_key_case_count": 0,
                "prior_pair_comparisons_reused": cumulative[
                    "prior_semantic_pair_comparisons_reused"
                ],
                "delta_pair_comparisons_new": semantic_result["pair_comparisons"],
                "cumulative_pair_comparisons_reconciled": cumulative[
                    "cumulative_semantic_pair_comparisons_reconciled"
                ],
                "disallowed_overlap_count": 0,
                "semantic_manifest_release_proof_complete": False,
                "semantic_manifest_blocker": semantic_manifest["release_blocker"],
                "semantic_inventory": semantic_inventory,
                "bindings": semantic_bindings,
                "delta_partition_comparisons": semantic_result["partition_comparisons"],
            },
            "foundation_deficits": deficits,
            "quarantines": quarantines,
            "private_inventory_bindings": {
                "prior_artifacts": prior_bindings,
                "delta_artifact": {
                    "artifact_id": delta["artifact_id"],
                    "inventory": delta_admission["inventory"],
                    "source_packet_inventory": delta_admission["source_packet_inventory"],
                    "bindings": delta_bindings,
                },
                "semantic_r5": semantic_inventory,
                "quarantines": quarantine_inventories,
            },
        },
        private_identifiers,
    )


def _verify_public_output(root: Path) -> None:
    if root.is_symlink() or not root.is_dir():
        raise FoundationExecutionEvidenceError("public output root is unsafe")
    expected_names = {"README.md", "evidence.json", "SHA256SUMS"}
    actual_names = {path.name for path in root.iterdir()}
    if actual_names != expected_names:
        raise FoundationExecutionEvidenceError("public output inventory is not exact")
    for path in root.iterdir():
        _regular_public_file(path, f"public output {path.name}")
    evidence_hash = _sha256_file(root / "evidence.json")
    readme_hash = _sha256_file(root / "README.md")
    expected_ledger = (f"{readme_hash}  README.md\n{evidence_hash}  evidence.json\n").encode(
        "ascii"
    )
    if (root / "SHA256SUMS").read_bytes() != expected_ledger:
        raise FoundationExecutionEvidenceError("public output checksum ledger drifted")


def freeze_cumulative_evidence(
    *,
    boundary_manifest_path: Path,
    expected_boundary_manifest_sha256: str,
    prior_artifact_roots: Mapping[str, Path],
    prior_source_packet_roots: Mapping[str, Path],
    delta_artifact_root: Path,
    delta_source_packet_root: Path,
    quarantine_roots: Mapping[str, Path],
    semantic_root: Path,
    output_root: Path,
    created_at: str,
) -> dict[str, Any]:
    try:
        parsed = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise FoundationExecutionEvidenceError("created_at must be canonical UTC") from exc
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != created_at or parsed > datetime.now(UTC):
        raise FoundationExecutionEvidenceError("created_at must be canonical non-future UTC")
    cumulative, private_identifiers = validate_cumulative_artifacts(
        boundary_manifest_path=boundary_manifest_path,
        expected_boundary_manifest_sha256=expected_boundary_manifest_sha256,
        prior_artifact_roots=prior_artifact_roots,
        prior_source_packet_roots=prior_source_packet_roots,
        delta_artifact_root=delta_artifact_root,
        delta_source_packet_root=delta_source_packet_root,
        quarantine_roots=quarantine_roots,
        semantic_root=semantic_root,
    )
    evidence = {
        "schema_version": "dime-foundation-incremental-evidence-v1",
        "evidence_id": cumulative["boundary_manifest"]["boundary_id"],
        "created_at": created_at,
        "classification": "SANITIZED_AGGREGATE_ONLY",
        "private_content_counts": {
            "foundation_records": 0,
            "semantic_cases": 0,
            "answer_keys": 0,
            "credentials": 0,
            "task_text": 0,
            "record_identifiers": 0,
        },
        **cumulative,
        "context_capsule": {
            "repository": {
                "branch": "agent/foundation-platform-shard-v1",
                "dependency_commit": cumulative["boundary_manifest"]["dependency_commit"],
            },
            "external_operations": EXTERNAL_OPERATIONS,
            "authorization_boundary": AUTHORIZATION_BOUNDARY,
        },
    }
    validate_cumulative_evidence_document(
        evidence,
        forbidden_identifiers=private_identifiers,
    )
    target = output_root.absolute()
    if target.exists() or target.is_symlink():
        raise FoundationExecutionEvidenceError("incremental evidence output already exists")
    parent = target.parent.resolve(strict=True)
    if stat.S_IMODE(parent.stat().st_mode) not in {0o700, 0o755}:
        raise FoundationExecutionEvidenceError("public evidence parent mode is unsafe")
    lock_path = parent / f".{target.name}.promotion.lock"
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise FoundationExecutionEvidenceError(
            "incremental evidence promotion is already locked"
        ) from exc
    staging = parent / f".{target.name}.staging-{os.getpid()}"
    promoted_identity: tuple[int, int] | None = None
    try:
        if target.exists() or target.is_symlink():
            raise FoundationExecutionEvidenceError("incremental evidence output already exists")
        if staging.exists() or staging.is_symlink():
            raise FoundationExecutionEvidenceError("public evidence staging path exists")
        staging.mkdir(mode=0o755)
        evidence_hash = _public_file(
            staging / "evidence.json",
            canonical_json_bytes(evidence),
        )
        readme = (
            "# Foundation incremental evidence v1\n\n"
            f"Parent records reused: {evidence['admission']['prior_admitted_records']}.\n"
            f"Delta records admitted: {evidence['admission']['delta_admitted_records']}.\n"
            f"Cumulative records: {evidence['admission']['cumulative_admitted_records']}.\n"
            f"Remaining records: {evidence['foundation_deficits']['remaining_records']}.\n"
            "Historical semantic comparisons are checksum-bound and reused; only the "
            "delta comparisons were newly executed.\n\n"
            "This aggregate-only directory contains no private records, task text, "
            "answer keys, credentials, provider output, or record identifiers. It "
            "authorizes no training, publication, deployment, provider execution, "
            "route activation, credential access, model download, or Railway mutation.\n\n"
            "## Reproduce\n\n"
            "Set the nine private-root variables below to independently protected local "
            "roots. The command validates exact manifests and hashes before comparison "
            "and uses a cooperative exclusive promotion lock. A failed promotion cleans "
            "only the target inode created by this process. This does not claim hostile "
            "same-user filesystem containment.\n\n"
            "```sh\n"
            "uv run --frozen python scripts/freeze_foundation_cumulative_evidence.py \\\n"
            "  --boundary-manifest configs/foundation_cumulative_boundary_450_v1.json \\\n"
            f"  --boundary-manifest-sha256 {expected_boundary_manifest_sha256} \\\n"
            '  --prior-artifact-root "first_live_data_shard=${DIME_PRIOR_FIRST_ROOT}" \\\n'
            '  --prior-artifact-root "second_live_data_shard=${DIME_PRIOR_SECOND_ROOT}" \\\n'
            '  --prior-source-packet-root "first_live_data_shard=${DIME_PRIOR_FIRST_SOURCES}" \\\n'
            "  --prior-source-packet-root "
            '"second_live_data_shard=${DIME_PRIOR_SECOND_SOURCES}" \\\n'
            '  --delta-artifact-root "${DIME_DELTA_ROOT}" \\\n'
            '  --delta-source-packet-root "${DIME_DELTA_SOURCES}" \\\n'
            '  --quarantine-root "platform_shard_001_incident=${DIME_INCIDENT_QUARANTINE}" \\\n'
            '  --quarantine-root "platform_shard_001_live_audit=${DIME_AUDIT_QUARANTINE}" \\\n'
            '  --semantic-root "${DIME_SEMANTIC_R5_ROOT}" \\\n'
            "  --output-root evidence/execution/dime-llm-v1-foundation-003 \\\n"
            f"  --created-at {created_at}\n"
            "```\n"
        )
        readme_hash = _public_file(staging / "README.md", readme.encode("utf-8"))
        ledger_hash = _public_file(
            staging / "SHA256SUMS",
            (f"{readme_hash}  README.md\n{evidence_hash}  evidence.json\n").encode("ascii"),
        )
        _verify_public_output(staging)
        if target.exists() or target.is_symlink():
            raise FoundationExecutionEvidenceError("incremental evidence target raced")
        staged = staging.stat()
        promoted_identity = (staged.st_dev, staged.st_ino)
        os.rename(staging, target)
        _verify_public_output(target)
    except BaseException:
        if staging.exists() and staging.is_dir() and not staging.is_symlink():
            shutil.rmtree(staging)
        if (
            promoted_identity is not None
            and target.exists()
            and not target.is_symlink()
            and (target.stat().st_dev, target.stat().st_ino) == promoted_identity
        ):
            shutil.rmtree(target)
        raise
    finally:
        os.close(lock_fd)
        lock_path.unlink(missing_ok=True)
    return {
        "status": "PASS",
        "prior_records_reused": evidence["admission"]["prior_admitted_records"],
        "delta_records_admitted": evidence["admission"]["delta_admitted_records"],
        "cumulative_records": evidence["admission"]["cumulative_admitted_records"],
        "remaining_records": evidence["foundation_deficits"]["remaining_records"],
        "delta_pair_comparisons": evidence["semantic_evaluation"]["delta_pair_comparisons_new"],
        "cumulative_pair_comparisons": evidence["semantic_evaluation"][
            "cumulative_pair_comparisons_reconciled"
        ],
        "bindings": {
            "readme_sha256": readme_hash,
            "evidence_sha256": evidence_hash,
            "sha256sums_sha256": ledger_hash,
        },
    }
