"""Fail-closed authorization guard for private Foundation publication."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

REQUIRED_PUBLICATION_EVIDENCE: Final[Mapping[str, int | bool]] = MappingProxyType(
    {
        "authoring_records": 2400,
        "trainer_records": 2400,
        "unconverted_records": 0,
        "unexpected_extra_records": 0,
        "pending_rights_records": 0,
        "unresolved_material_findings": 0,
        "exact_duplicates": 0,
        "cross_split_group_collisions": 0,
        "evaluation_contamination": 0,
        "conversion_hash_mismatches": 0,
        "silent_truncations": 0,
        "release_checksum_verified": True,
    }
)

_COUNT_FIELDS: Final[tuple[str, ...]] = tuple(
    key for key, expected in REQUIRED_PUBLICATION_EVIDENCE.items() if type(expected) is int
)


def private_hugging_face_publication_allowed(evidence: object) -> bool:
    """Return true only for exact, complete, type-safe Foundation release evidence."""

    if type(evidence) is not dict:
        return False
    if set(evidence) != set(REQUIRED_PUBLICATION_EVIDENCE):
        return False
    for key in _COUNT_FIELDS:
        value = evidence[key]
        if type(value) is not int or value != REQUIRED_PUBLICATION_EVIDENCE[key]:
            return False
    return evidence["release_checksum_verified"] is True
