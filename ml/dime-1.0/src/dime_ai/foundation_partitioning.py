"""Immutable, collection-wide partition assignments for Foundation authoring records."""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[2]
PARTITION_REGISTRY_PATH = ML_ROOT / "configs" / "foundation_partition_registry_v1.json"
PARTITION_REGISTRY_SCHEMA_PATH = ML_ROOT / "schemas" / "foundation_partition_registry.schema.json"

GROUP_DIMENSIONS = (
    "scenario_family_id",
    "template_family_id",
    "source_event_id",
    "conversation_family_id",
    "quantitative_scenario_id",
    "entity_set_temporal_bucket",
)
PARTITION_IDENTITY_FIELDS = frozenset(
    {
        "scenario_family_id",
        "template_family_id",
        "source_event_id",
        "conversation_family_id",
        "quantitative_scenario_id",
        "entity_set_sha256",
        "temporal_bucket",
        "split_assignment_basis",
        "split_assignment_revision",
        "split_assignment_seed",
    }
)
SHARD_ID = re.compile(r"^foundation-v1-[a-z0-9][a-z0-9._-]{3,95}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class PartitionRegistryError(ValueError):
    """Raised when a Foundation partition assignment is not globally immutable."""


def _load_json(path: Path) -> dict[str, Any]:
    value = load_governed_json(path)
    if not isinstance(value, dict):
        raise PartitionRegistryError(f"{path.name} must contain a JSON object")
    return value


def load_partition_registry() -> dict[str, Any]:
    """Return a detached copy of the committed pre-generation registry."""

    return deepcopy(_load_json(PARTITION_REGISTRY_PATH))


def validate_partition_registry(registry: object) -> list[str]:
    """Validate the closed-world registry and reject duplicate group assignments."""

    schema = _load_json(PARTITION_REGISTRY_SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    errors = []
    for error in sorted(validator.iter_errors(registry), key=lambda item: list(item.path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{location}: {error.message}")
    if errors or not isinstance(registry, dict):
        return errors

    assignments: dict[tuple[str, str], dict[str, Any]] = {}
    for assignment in registry["assignments"]:
        key = (assignment["group_dimension"], assignment["group_key_sha256"])
        if key in assignments:
            errors.append(
                "duplicate registry assignment for "
                f"{assignment['group_dimension']}:{assignment['group_key_sha256']}"
            )
        assignments[key] = assignment
    canonical_assignments = sorted(
        registry["assignments"],
        key=lambda item: (item["group_dimension"], item["group_key_sha256"]),
    )
    if registry["assignments"] != canonical_assignments:
        errors.append("registry assignments must use canonical group-dimension/hash order")
    return errors


def _require_valid_registry(registry: object) -> dict[str, Any]:
    errors = validate_partition_registry(registry)
    if errors or not isinstance(registry, dict):
        raise PartitionRegistryError("partition registry invalid: " + "; ".join(errors))
    return registry


def _require_nonempty_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PartitionRegistryError(f"{label} must be a non-empty string")
    return value


def _validate_partition_identity(
    partition_identity: object,
    registry: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(partition_identity, dict):
        raise PartitionRegistryError("partition_identity must be an object")
    if set(partition_identity) != PARTITION_IDENTITY_FIELDS:
        raise PartitionRegistryError(
            "partition_identity must contain the exact global partition fields"
        )

    algorithm = registry["assignment_algorithm"]
    if partition_identity["split_assignment_basis"] != algorithm["assignment_basis"]:
        raise PartitionRegistryError("record split-assignment algorithm drift")
    if partition_identity["split_assignment_revision"] != algorithm["assignment_revision"]:
        raise PartitionRegistryError("record split-assignment revision drift")
    seed = partition_identity["split_assignment_seed"]
    if isinstance(seed, bool) or seed != algorithm["assignment_seed"]:
        raise PartitionRegistryError("record split-assignment seed drift")

    _require_nonempty_string(
        partition_identity["scenario_family_id"],
        "partition_identity.scenario_family_id",
    )
    _require_nonempty_string(
        partition_identity["conversation_family_id"],
        "partition_identity.conversation_family_id",
    )
    for field in (
        "template_family_id",
        "source_event_id",
        "quantitative_scenario_id",
    ):
        value = partition_identity[field]
        if value is not None:
            _require_nonempty_string(value, f"partition_identity.{field}")

    entity_set = partition_identity["entity_set_sha256"]
    if not isinstance(entity_set, str) or not SHA256.fullmatch(entity_set):
        raise PartitionRegistryError(
            "partition_identity.entity_set_sha256 must be a lowercase SHA-256"
        )
    _require_nonempty_string(
        partition_identity["temporal_bucket"],
        "partition_identity.temporal_bucket",
    )
    return partition_identity


def assigned_split(
    partition_identity: object,
    registry: dict[str, Any] | None = None,
) -> str:
    """Derive the frozen split using only the pre-prose scenario identity."""

    active_registry = _require_valid_registry(
        load_partition_registry() if registry is None else registry
    )
    identity = _validate_partition_identity(partition_identity, active_registry)
    algorithm = active_registry["assignment_algorithm"]
    material = f"{algorithm['assignment_seed']}:{identity['scenario_family_id']}".encode()
    digest = hashlib.sha256(material).hexdigest()
    bucket = int(digest, 16) % algorithm["bucket_modulus"]
    return "validation" if bucket in set(algorithm["validation_buckets"]) else "train"


def _group_key_sha256(group_dimension: str, values: tuple[str, ...]) -> str:
    payload = json.dumps(
        [group_dimension, *values],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _partition_groups(
    partition_identity: object,
    registry: dict[str, Any],
) -> tuple[tuple[str, str], ...]:
    identity = _validate_partition_identity(partition_identity, registry)
    groups = []
    for field in GROUP_DIMENSIONS[:-1]:
        value = identity[field]
        if value is not None:
            groups.append((field, _group_key_sha256(field, (value,))))
    groups.append(
        (
            "entity_set_temporal_bucket",
            _group_key_sha256(
                "entity_set_temporal_bucket",
                (identity["entity_set_sha256"], identity["temporal_bucket"]),
            ),
        )
    )
    return tuple(groups)


def freeze_partition_assignment(
    registry: dict[str, Any],
    *,
    record_id: str,
    shard_id: str,
    partition_identity: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    """Return an in-memory registry candidate without mutating the input registry."""

    _require_nonempty_string(record_id, "record_id")
    if not isinstance(shard_id, str) or not SHARD_ID.fullmatch(shard_id):
        raise PartitionRegistryError("shard_id is not a canonical Foundation shard ID")
    active_registry = _require_valid_registry(registry)
    split = assigned_split(partition_identity, active_registry)
    candidate = deepcopy(active_registry)
    assignments = {
        (item["group_dimension"], item["group_key_sha256"]): item
        for item in candidate["assignments"]
    }

    for group_dimension, group_key_sha256 in _partition_groups(
        partition_identity,
        active_registry,
    ):
        key = (group_dimension, group_key_sha256)
        existing = assignments.get(key)
        if existing is not None:
            if existing["shard_id"] != shard_id:
                raise PartitionRegistryError(
                    f"partition group cross-shard collision for {group_dimension}"
                )
            if existing["split"] != split:
                raise PartitionRegistryError(
                    f"partition group cross-split collision for {group_dimension}"
                )
            continue
        assignment = {
            "group_dimension": group_dimension,
            "group_key_sha256": group_key_sha256,
            "shard_id": shard_id,
            "split": split,
        }
        candidate["assignments"].append(assignment)
        assignments[key] = assignment

    candidate["assignments"].sort(
        key=lambda item: (item["group_dimension"], item["group_key_sha256"])
    )
    _require_valid_registry(candidate)
    return candidate, split


def validate_partition_groups(
    all_authoring_records: list[dict[str, Any]],
    registry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate a complete authoring collection and return its in-memory registry candidate."""

    if not isinstance(all_authoring_records, list):
        raise PartitionRegistryError("all_authoring_records must be a list")
    source_registry = _require_valid_registry(
        load_partition_registry() if registry is None else registry
    )
    committed_assignments = {
        (item["group_dimension"], item["group_key_sha256"]): item
        for item in source_registry["assignments"]
    }
    observed_committed: set[tuple[str, str]] = set()
    records_by_id: dict[str, dict[str, Any]] = {}
    for record in all_authoring_records:
        if not isinstance(record, dict):
            raise PartitionRegistryError("every authoring record must be an object")
        record_id = _require_nonempty_string(record.get("record_id"), "record_id")
        if record_id in records_by_id:
            raise PartitionRegistryError(f"duplicate authoring record_id: {record_id}")
        records_by_id[record_id] = record

    candidate = deepcopy(source_registry)
    for record_id in sorted(records_by_id):
        record = records_by_id[record_id]
        provenance = record.get("provenance")
        if not isinstance(provenance, dict):
            raise PartitionRegistryError(f"{record_id}: provenance must be an object")
        shard_id = provenance.get("shard_id")
        if not isinstance(shard_id, str) or not SHARD_ID.fullmatch(shard_id):
            raise PartitionRegistryError(f"{record_id}: invalid provenance.shard_id")
        identity = record.get("partition_identity")
        expected_split = assigned_split(identity, source_registry)
        if record.get("split") != expected_split:
            raise PartitionRegistryError(
                f"{record_id}: record split disagrees with the frozen registry assignment"
            )

        for key in _partition_groups(identity, source_registry):
            committed = committed_assignments.get(key)
            if committed is None:
                continue
            observed_committed.add(key)
            if committed["split"] != expected_split or committed["shard_id"] != shard_id:
                raise PartitionRegistryError(
                    f"{record_id}: committed partition registry drift for {key[0]}"
                )

        candidate, frozen_split = freeze_partition_assignment(
            candidate,
            record_id=record_id,
            shard_id=shard_id,
            partition_identity=identity,
        )
        if frozen_split != expected_split:
            raise AssertionError("partition assignment changed during in-memory registry build")

    stale_assignments = set(committed_assignments) - observed_committed
    if stale_assignments:
        raise PartitionRegistryError(
            "committed partition registry drift: assignments are absent from the full collection"
        )
    return candidate
