from __future__ import annotations

import hashlib
from copy import deepcopy

import pytest

from dime_ai.foundation_partitioning import (
    GROUP_DIMENSIONS,
    PARTITION_REGISTRY_PATH,
    PartitionRegistryError,
    assigned_split,
    freeze_partition_assignment,
    load_partition_registry,
    validate_partition_groups,
    validate_partition_registry,
)


def partition_identity(
    scenario_family_id: str,
    *,
    suffix: str | None = None,
    include_optional: bool = True,
) -> dict:
    identity_suffix = suffix or scenario_family_id
    return {
        "scenario_family_id": scenario_family_id,
        "template_family_id": (f"template-{identity_suffix}" if include_optional else None),
        "source_event_id": f"event-{identity_suffix}" if include_optional else None,
        "conversation_family_id": f"conversation-{identity_suffix}",
        "quantitative_scenario_id": (
            f"quantitative-{identity_suffix}" if include_optional else None
        ),
        "entity_set_sha256": hashlib.sha256(identity_suffix.encode("utf-8")).hexdigest(),
        "temporal_bucket": f"bucket-{identity_suffix}",
        "split_assignment_basis": "scenario_family_sha256_mod_10",
        "split_assignment_revision": "dime-foundation-partition-v1",
        "split_assignment_seed": 0,
    }


def authoring_record(
    record_id: str,
    scenario_family_id: str,
    shard_id: str,
    *,
    suffix: str | None = None,
    include_optional: bool = True,
) -> dict:
    identity = partition_identity(
        scenario_family_id,
        suffix=suffix,
        include_optional=include_optional,
    )
    return {
        "record_id": record_id,
        "provenance": {"shard_id": shard_id},
        "partition_identity": identity,
        "split": assigned_split(identity),
    }


def scenarios_for_split(split: str, count: int = 2) -> list[str]:
    matches = []
    for index in range(1000):
        scenario = f"scenario-{split}-{index:03d}"
        if assigned_split(partition_identity(scenario)) == split:
            matches.append(scenario)
        if len(matches) == count:
            return matches
    raise AssertionError(f"could not find {count} deterministic {split} scenarios")


def test_committed_registry_is_closed_world_and_may_start_empty() -> None:
    registry = load_partition_registry()

    assert PARTITION_REGISTRY_PATH.is_file()
    assert validate_partition_registry(registry) == []
    assert registry["status"] == "FROZEN"
    assert tuple(registry["group_dimensions"]) == GROUP_DIMENSIONS
    assert registry["assignments"] == []

    widened = deepcopy(registry)
    widened["unreviewed"] = True
    assert validate_partition_registry(widened)


def test_pre_prose_assignment_is_deterministic_and_never_mutates_seed() -> None:
    registry = load_partition_registry()
    original = deepcopy(registry)
    identity = partition_identity("scenario-pre-prose-001")

    first, first_split = freeze_partition_assignment(
        registry,
        record_id="dime-foundation-v1-record-pre-prose-001",
        shard_id="foundation-v1-shard-pre-prose",
        partition_identity=identity,
    )
    second, second_split = freeze_partition_assignment(
        registry,
        record_id="dime-foundation-v1-record-pre-prose-001",
        shard_id="foundation-v1-shard-pre-prose",
        partition_identity=identity,
    )

    assert registry == original
    assert load_partition_registry() == original
    assert first == second
    assert first_split == second_split == assigned_split(identity)
    assert len(first["assignments"]) == len(GROUP_DIMENSIONS)
    assert {item["group_dimension"] for item in first["assignments"]} == set(GROUP_DIMENSIONS)

    repeated, repeated_split = freeze_partition_assignment(
        first,
        record_id="dime-foundation-v1-record-pre-prose-002",
        shard_id="foundation-v1-shard-pre-prose",
        partition_identity=identity,
    )
    assert repeated == first
    assert repeated_split == first_split


def test_collection_builder_covers_every_non_null_group_and_is_order_independent() -> None:
    train_scenarios = scenarios_for_split("train")
    first = authoring_record(
        "dime-foundation-v1-record-collection-001",
        train_scenarios[0],
        "foundation-v1-shard-collection-a",
        suffix="collection-a",
    )
    second = authoring_record(
        "dime-foundation-v1-record-collection-002",
        train_scenarios[1],
        "foundation-v1-shard-collection-b",
        suffix="collection-b",
        include_optional=False,
    )

    forward = validate_partition_groups([first, second])
    reverse = validate_partition_groups([second, first])

    assert forward == reverse
    first_dimensions = {
        item["group_dimension"] for item in validate_partition_groups([first])["assignments"]
    }
    assert first_dimensions == set(GROUP_DIMENSIONS)
    second_dimensions = {
        item["group_dimension"] for item in validate_partition_groups([second])["assignments"]
    }
    assert second_dimensions == {
        "scenario_family_id",
        "conversation_family_id",
        "entity_set_temporal_bucket",
    }


@pytest.mark.parametrize("group_dimension", GROUP_DIMENSIONS)
def test_every_group_dimension_rejects_cross_shard_collision(
    group_dimension: str,
) -> None:
    scenarios = scenarios_for_split("train")
    left = authoring_record(
        "dime-foundation-v1-record-collision-left",
        scenarios[0],
        "foundation-v1-shard-collision-left",
        suffix="collision-left",
    )
    right = authoring_record(
        "dime-foundation-v1-record-collision-right",
        scenarios[1],
        "foundation-v1-shard-collision-right",
        suffix="collision-right",
    )
    left_identity = left["partition_identity"]
    right_identity = right["partition_identity"]

    if group_dimension == "scenario_family_id":
        right_identity["scenario_family_id"] = left_identity["scenario_family_id"]
        right["split"] = assigned_split(right_identity)
    elif group_dimension == "entity_set_temporal_bucket":
        right_identity["entity_set_sha256"] = left_identity["entity_set_sha256"]
        right_identity["temporal_bucket"] = left_identity["temporal_bucket"]
    else:
        right_identity[group_dimension] = left_identity[group_dimension]

    with pytest.raises(PartitionRegistryError, match="cross-shard collision"):
        validate_partition_groups([left, right])


def test_shared_group_rejects_cross_split_collision() -> None:
    train_scenario = scenarios_for_split("train", count=1)[0]
    validation_scenario = scenarios_for_split("validation", count=1)[0]
    train = authoring_record(
        "dime-foundation-v1-record-cross-split-train",
        train_scenario,
        "foundation-v1-shard-cross-split",
        suffix="cross-split-train",
    )
    validation = authoring_record(
        "dime-foundation-v1-record-cross-split-validation",
        validation_scenario,
        "foundation-v1-shard-cross-split",
        suffix="cross-split-validation",
    )
    validation["partition_identity"]["template_family_id"] = train["partition_identity"][
        "template_family_id"
    ]

    with pytest.raises(PartitionRegistryError, match="cross-split collision"):
        validate_partition_groups([train, validation])


def test_same_group_same_shard_and_split_is_valid() -> None:
    scenarios = scenarios_for_split("train")
    first = authoring_record(
        "dime-foundation-v1-record-shared-group-001",
        scenarios[0],
        "foundation-v1-shard-shared-group",
        suffix="shared-group-a",
    )
    second = authoring_record(
        "dime-foundation-v1-record-shared-group-002",
        scenarios[1],
        "foundation-v1-shard-shared-group",
        suffix="shared-group-b",
    )
    second["partition_identity"]["template_family_id"] = first["partition_identity"][
        "template_family_id"
    ]

    candidate = validate_partition_groups([first, second])
    assert validate_partition_registry(candidate) == []


def test_record_split_disagreement_is_rejected() -> None:
    record = authoring_record(
        "dime-foundation-v1-record-wrong-split",
        scenarios_for_split("train", count=1)[0],
        "foundation-v1-shard-wrong-split",
    )
    record["split"] = "validation"

    with pytest.raises(PartitionRegistryError, match="record split disagrees"):
        validate_partition_groups([record])


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("split_assignment_seed", 1, "seed drift"),
        ("split_assignment_basis", "unreviewed_algorithm", "algorithm drift"),
        ("split_assignment_revision", "unreviewed-revision", "revision drift"),
    ],
)
def test_record_assignment_algorithm_drift_is_rejected(
    field: str,
    value: object,
    message: str,
) -> None:
    record = authoring_record(
        f"dime-foundation-v1-record-{field}",
        "scenario-record-algorithm-drift",
        "foundation-v1-shard-record-algorithm",
    )
    record["partition_identity"][field] = value

    with pytest.raises(PartitionRegistryError, match=message):
        validate_partition_groups([record])


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("assignment_seed", 1),
        ("assignment_basis", "unreviewed_algorithm"),
        ("assignment_revision", "unreviewed-revision"),
        ("hash_algorithm", "sha512"),
        ("input_encoding", "unreviewed-encoding"),
        ("bucket_modulus", 11),
        ("validation_buckets", [1]),
    ],
)
def test_registry_seed_or_algorithm_drift_is_rejected(
    field: str,
    value: object,
) -> None:
    registry = load_partition_registry()
    registry["assignment_algorithm"][field] = value

    with pytest.raises(PartitionRegistryError, match="partition registry invalid"):
        validate_partition_groups([], registry)


def test_committed_registry_assignment_drift_and_stale_entries_are_rejected() -> None:
    record = authoring_record(
        "dime-foundation-v1-record-registry-drift",
        scenarios_for_split("train", count=1)[0],
        "foundation-v1-shard-registry-drift",
    )
    candidate = validate_partition_groups([record])
    drifted = deepcopy(candidate)
    drifted["assignments"][0]["split"] = "validation"

    with pytest.raises(PartitionRegistryError, match="committed partition registry drift"):
        validate_partition_groups([record], drifted)
    with pytest.raises(PartitionRegistryError, match="assignments are absent"):
        validate_partition_groups([], candidate)


def test_duplicate_registry_group_key_and_duplicate_record_id_are_rejected() -> None:
    record = authoring_record(
        "dime-foundation-v1-record-duplicate",
        "scenario-duplicate-registry",
        "foundation-v1-shard-duplicate",
    )
    candidate = validate_partition_groups([record])
    duplicate_registry = deepcopy(candidate)
    duplicate = deepcopy(duplicate_registry["assignments"][0])
    duplicate["shard_id"] = "foundation-v1-shard-duplicate-other"
    duplicate_registry["assignments"].append(duplicate)

    assert any(
        "duplicate registry assignment" in error
        for error in validate_partition_registry(duplicate_registry)
    )

    reordered_registry = deepcopy(candidate)
    reordered_registry["assignments"].reverse()
    assert any(
        "canonical group-dimension/hash order" in error
        for error in validate_partition_registry(reordered_registry)
    )

    with pytest.raises(PartitionRegistryError, match="duplicate authoring record_id"):
        validate_partition_groups([record, deepcopy(record)])
