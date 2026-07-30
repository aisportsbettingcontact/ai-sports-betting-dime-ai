#!/usr/bin/env python3
"""Validate the proposed Foundation Data Factory without executing it."""

from __future__ import annotations

import json

from dime_ai.foundation_control import (
    DATA_FACTORY_GOVERNANCE_PATH,
    _load_json,
    validate_data_factory_governance,
)
from dime_ai.foundation_partitioning import (
    load_partition_registry,
    validate_partition_groups,
    validate_partition_registry,
)


def main() -> int:
    contract = _load_json(DATA_FACTORY_GOVERNANCE_PATH)
    issues = validate_data_factory_governance(contract)
    registry = load_partition_registry()
    issues.extend(f"partition registry: {issue}" for issue in validate_partition_registry(registry))
    empty_collection_registry = validate_partition_groups([], registry)
    report = {
        "schema_version": "dime-foundation-data-factory-audit-v1",
        "contract_valid": not issues,
        "status": contract.get("status"),
        "executing": False,
        "authorization_effect": "none",
        "generated_record_count": 0,
        "published_record_count": 0,
        "external_invocation_count": 0,
        "duplicate_governed_json_keys": 0,
        "cross_split_group_collisions": 0,
        "partition_registry_drift": 0,
        "partition_registry_assignments": len(empty_collection_registry["assignments"]),
        "incomplete_release_publication_possible": False,
        "issues": issues,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
