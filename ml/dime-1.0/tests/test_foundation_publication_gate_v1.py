import pytest

from dime_ai.foundation_publication import (
    REQUIRED_PUBLICATION_EVIDENCE,
    private_hugging_face_publication_allowed,
)

COUNT_FIELDS = tuple(
    key for key, expected in REQUIRED_PUBLICATION_EVIDENCE.items() if type(expected) is int
)


def complete_release_evidence() -> dict[str, int | bool]:
    return dict(REQUIRED_PUBLICATION_EVIDENCE)


def test_exact_complete_release_is_publication_eligible() -> None:
    assert private_hugging_face_publication_allowed(complete_release_evidence()) is True


def test_incomplete_release_publication_possible_is_false() -> None:
    incomplete_releases = []
    for key, expected in REQUIRED_PUBLICATION_EVIDENCE.items():
        evidence = complete_release_evidence()
        evidence[key] = False if expected is True else expected + 1
        incomplete_releases.append(evidence)

    incomplete_release_publication_possible = any(
        private_hugging_face_publication_allowed(evidence) for evidence in incomplete_releases
    )

    assert incomplete_release_publication_possible is False


@pytest.mark.parametrize("key", tuple(REQUIRED_PUBLICATION_EVIDENCE))
def test_each_missing_precondition_fails_closed(key: str) -> None:
    evidence = complete_release_evidence()
    del evidence[key]

    assert private_hugging_face_publication_allowed(evidence) is False


def test_unknown_precondition_fails_closed() -> None:
    evidence = complete_release_evidence()
    evidence["publication_override"] = True

    assert private_hugging_face_publication_allowed(evidence) is False


@pytest.mark.parametrize("key", COUNT_FIELDS)
def test_boolean_does_not_count_as_an_integer(key: str) -> None:
    evidence = complete_release_evidence()
    evidence[key] = bool(REQUIRED_PUBLICATION_EVIDENCE[key])

    assert private_hugging_face_publication_allowed(evidence) is False


@pytest.mark.parametrize("key", COUNT_FIELDS)
def test_numeric_lookalikes_do_not_count_as_integers(key: str) -> None:
    evidence = complete_release_evidence()
    evidence[key] = float(REQUIRED_PUBLICATION_EVIDENCE[key])

    assert private_hugging_face_publication_allowed(evidence) is False


@pytest.mark.parametrize("value", (1, 1.0, "true", None))
def test_release_checksum_verification_requires_an_exact_boolean(value: object) -> None:
    evidence = complete_release_evidence()
    evidence["release_checksum_verified"] = value

    assert private_hugging_face_publication_allowed(evidence) is False


@pytest.mark.parametrize(
    "evidence",
    (
        None,
        (),
        [],
        "",
        0,
        True,
    ),
)
def test_non_object_evidence_fails_closed(evidence: object) -> None:
    assert private_hugging_face_publication_allowed(evidence) is False


@pytest.mark.parametrize(
    ("key", "failed_value"),
    (
        ("authoring_records", 2399),
        ("trainer_records", 2399),
        ("unconverted_records", 1),
        ("unexpected_extra_records", 1),
        ("pending_rights_records", 1),
        ("unresolved_material_findings", 1),
        ("exact_duplicates", 1),
        ("cross_split_group_collisions", 1),
        ("evaluation_contamination", 1),
        ("conversion_hash_mismatches", 1),
        ("silent_truncations", 1),
        ("release_checksum_verified", False),
    ),
)
def test_each_single_failed_condition_rejects_publication(
    key: str,
    failed_value: int | bool,
) -> None:
    evidence = complete_release_evidence()
    evidence[key] = failed_value

    assert private_hugging_face_publication_allowed(evidence) is False
