from copy import deepcopy

import pytest

from dime_ai.data_validation import (
    DataValidationError,
    partition_keys,
    validate_dataset_manifest,
    validate_eval_case,
    validate_public_repository_data,
    validate_sft_record,
    validate_unique_ids,
)


def sft_record() -> dict:
    return {
        "example_id": "sft_001",
        "dataset_version": "dime-sft-v0.0.1",
        "task_type": "market_math",
        "messages": [
            {"role": "user", "content": "Question"},
            {"role": "assistant", "content": "Answer"},
        ],
        "metadata": {
            "as_of_utc": "2026-07-25T12:00:00Z",
            "synthetic_or_deidentified": "synthetic",
            "contains_user_data": False,
            "consent_basis": None,
            "source_ids": ["source_1"],
            "event_partition_key": "event_1",
            "user_partition_hash": None,
        },
        "quality": {
            "review_status": "approved",
            "reviewer_ids": [],
            "rubric_version": "dime-answer-v1",
        },
    }


def eval_case() -> dict:
    return {
        "case_id": "eval_001",
        "dataset_version": "dime-eval-v0.0.1",
        "split": "dev",
        "task_type": "market_math",
        "severity": "critical",
        "as_of_utc": "2026-07-25T12:00:00Z",
        "messages": [{"role": "user", "content": "Question"}],
        "allowed_tools": ["calculate_market_math"],
        "forbidden_tools": [],
        "tool_fixtures": [],
        "gold": {
            "required_tool_calls": ["calculate_market_math"],
            "forbidden_tool_calls": [],
            "numbers": [],
            "facts": [],
            "required_concepts": [],
            "forbidden_claims": [],
            "expected_policy_action": "allow",
        },
        "scoring": {
            "rubric_version": "dime-eval-v1",
            "numeric_tolerance": 0.000001,
            "requires_human_review": False,
        },
        "provenance": {
            "synthetic": True,
            "source_ids": [],
            "available_at_max": "2026-07-25T12:00:00Z",
        },
    }


def test_valid_records() -> None:
    validate_sft_record(sft_record())
    validate_eval_case(eval_case())


def test_user_data_requires_deidentification_and_consent() -> None:
    record = sft_record()
    record["metadata"]["contains_user_data"] = True
    record["metadata"]["synthetic_or_deidentified"] = "none"
    with pytest.raises(DataValidationError):
        validate_sft_record(record)


def test_secret_and_direct_identifier_detection() -> None:
    secret = sft_record()
    secret["messages"][0]["content"] = "hf_" + "synthetic" + "testvalue1234567890"
    with pytest.raises(DataValidationError, match="token"):
        validate_sft_record(secret)
    email = sft_record()
    email["messages"][0]["content"] = "person" + "@" + "example.test"
    with pytest.raises(DataValidationError, match="identifier"):
        validate_sft_record(email)


def test_future_data_and_tool_overlap_fail() -> None:
    future = eval_case()
    future["provenance"]["available_at_max"] = "2026-07-25T12:00:01Z"
    with pytest.raises(DataValidationError, match="future-data"):
        validate_eval_case(future)
    overlap = eval_case()
    overlap["forbidden_tools"] = ["calculate_market_math"]
    with pytest.raises(DataValidationError, match="both allowed and forbidden"):
        validate_eval_case(overlap)


def test_unique_ids_and_partition_keys() -> None:
    first = sft_record()
    second = deepcopy(first)
    with pytest.raises(DataValidationError, match="Duplicate"):
        validate_unique_ids([first, second], "example_id")
    assert partition_keys(first) == {"source_1", "event_1"}


def test_schema_enums_and_utc_are_strict() -> None:
    invalid_split = eval_case()
    invalid_split["split"] = "anything"
    with pytest.raises(DataValidationError, match="schema violation"):
        validate_eval_case(invalid_split)
    naive_time = eval_case()
    naive_time["as_of_utc"] = "2026-07-25T12:00:00"
    with pytest.raises(DataValidationError, match="UTC offset"):
        validate_eval_case(naive_time)


def test_nested_fixture_future_time_fails() -> None:
    record = eval_case()
    record["tool_fixtures"] = [
        {
            "tool": "calculate_market_math",
            "arguments": {
                "operation": "remove_vig",
                "inputs": {"american_odds": {"a": -110, "b": -110}},
            },
            "returns": {
                "status": "ok",
                "as_of_utc": "2099-01-01T00:00:00Z",
                "source_ids": ["future"],
                "data": {},
                "quality_flags": [],
                "warnings": [],
            },
        }
    ]
    with pytest.raises(DataValidationError, match="future-data"):
        validate_eval_case(record)


def test_malformed_tool_call_and_linkage_fail() -> None:
    malformed = sft_record()
    malformed["messages"][1]["tool_calls"] = "not-an-array"
    with pytest.raises(DataValidationError, match="schema violation"):
        validate_sft_record(malformed)

    unlinked = sft_record()
    unlinked["messages"].insert(
        1,
        {
            "role": "tool",
            "name": "calculate_market_math",
            "tool_call_id": "missing",
            "content": "{}",
        },
    )
    with pytest.raises(DataValidationError, match="unknown call"):
        validate_sft_record(unlinked)


def test_production_records_require_lineage_and_reviewers() -> None:
    with pytest.raises(DataValidationError, match="reviewer"):
        validate_sft_record(sft_record(), production=True)


def test_production_records_require_curriculum_and_double_review_critical() -> None:
    record = sft_record()
    record["metadata"].update(
        {
            "rights_basis": "synthetic-owned",
            "source_owner": "dime",
            "generation_method": "human-authored",
            "direct_identifier_scan_version": "scan-v1",
        }
    )
    record["quality"].update(
        {
            "reviewer_ids": ["reviewer-a"],
            "reviewed_at_utc": "2026-07-25T12:00:00Z",
        }
    )
    record["curriculum"] = {
        "skill_ids": ["market_math.expected_value"],
        "difficulty": "hard",
        "interaction_mode": "successful_tool_assisted",
        "scenario_cluster_id": "scenario-1",
        "evidence_status": "complete",
        "policy_action": "allow",
        "risk_tier": "critical",
    }
    with pytest.raises(DataValidationError, match="two reviewers"):
        validate_sft_record(record, production=True)
    record["quality"]["reviewer_ids"].append("reviewer-b")
    validate_sft_record(record, production=True)


def test_production_eval_uses_exposure_split_and_suite() -> None:
    record = eval_case()
    with pytest.raises(DataValidationError, match="suite"):
        validate_eval_case(record, production=True)
    record["suite"] = "standard"
    record["tags"] = {
        "program_family": "market_math",
        "skill_ids": ["market_math.expected_value"],
        "scenario_cluster_id": "eval-scenario-1",
        "turn_depth": 1,
        "tool_statuses": ["ok"],
        "data_quality_conditions": [],
        "risk_states": ["normal"],
        "control_pair_id": None,
        "sport": None,
        "league": None,
        "market_type": None,
        "market_phase": "general",
    }
    validate_eval_case(record, production=True)
    record["split"] = "red_team"
    record["suite"] = "red_team"
    with pytest.raises(DataValidationError, match="legacy exposure split"):
        validate_eval_case(record, production=True)


def test_v2_dataset_manifest_contract_remains_supported() -> None:
    hashes = {
        "train": "a" * 64,
        "validation": "b" * 64,
        "curriculum": "c" * 64,
        "tools": "d" * 64,
        "template": "e" * 64,
    }
    manifest = {
        "schema_version": "dime-dataset-manifest-v2",
        "dataset_version": "dime-sft-foundation-v1",
        "approved": True,
        "approved_at_utc": "2026-07-25T12:00:00Z",
        "reviewer_ids": ["reviewer-a"],
        "train_sha256": hashes["train"],
        "validation_sha256": hashes["validation"],
        "curriculum_config_sha256": hashes["curriculum"],
        "tool_catalog_sha256": hashes["tools"],
        "chat_template_sha256": hashes["template"],
        "rights_reviewed": True,
        "consent_reviewed": True,
        "privacy_reviewed": True,
        "partition_audit_passed": True,
        "future_data_audit_passed": True,
        "semantic_dedup_audit_passed": True,
        "evaluation_contamination_audit_passed": True,
        "direct_identifier_scan_version": "scan-v1",
        "deletion_policy_id": "deletion-v1",
        "notes": "Approved synthetic foundation fixture.",
    }
    validate_dataset_manifest(
        manifest,
        hashes["train"],
        hashes["validation"],
        hashes["curriculum"],
        hashes["tools"],
        hashes["template"],
    )
    manifest["tool_catalog_sha256"] = "f" * 64
    with pytest.raises(DataValidationError, match="tool_catalog_sha256 mismatch"):
        validate_dataset_manifest(
            manifest,
            hashes["train"],
            hashes["validation"],
            hashes["curriculum"],
            hashes["tools"],
            hashes["template"],
        )


def test_v3_public_manifest_binds_governance_counts_and_hashes() -> None:
    hashes = {
        "train": "a" * 64,
        "validation": "b" * 64,
        "curriculum": "c" * 64,
        "tools": "d" * 64,
        "template": "e" * 64,
    }
    manifest = {
        "schema_version": "dime-dataset-manifest-v3",
        "dataset_version": "dime-sft-public-v1",
        "visibility": "public",
        "publication_classification": "approved-public",
        "provenance_source_class": "synthetic",
        "source_owner": "Tailered Sports",
        "rights_basis": "owned synthetic fixtures",
        "license_or_usage_restrictions": "public repository publication only",
        "synthetic_status": "fully-synthetic",
        "contains_user_data": False,
        "contains_provider_derived_data": False,
        "approval_status": "approved",
        "approved": True,
        "approved_at_utc": "2026-07-25T12:00:00Z",
        "reviewer_ids": ["publication-review-20260725"],
        "train_record_count": 10,
        "validation_record_count": 2,
        "train_sha256": hashes["train"],
        "validation_sha256": hashes["validation"],
        "curriculum_config_sha256": hashes["curriculum"],
        "tool_catalog_sha256": hashes["tools"],
        "chat_template_sha256": hashes["template"],
        "rights_reviewed": True,
        "consent_reviewed": True,
        "privacy_reviewed": True,
        "partition_audit_passed": True,
        "future_data_audit_passed": True,
        "semantic_dedup_audit_passed": True,
        "evaluation_contamination_audit_passed": True,
        "direct_identifier_scan_version": "scan-v1",
        "deletion_policy_id": "deletion-v1",
        "limitations_notes": "Synthetic public fixture contract.",
    }
    validate_dataset_manifest(
        manifest,
        hashes["train"],
        hashes["validation"],
        hashes["curriculum"],
        hashes["tools"],
        hashes["template"],
        10,
        2,
        require_public_publication=True,
    )

    manifest["contains_user_data"] = True
    with pytest.raises(DataValidationError, match="user data is not publishable"):
        validate_dataset_manifest(
            manifest,
            hashes["train"],
            hashes["validation"],
            hashes["curriculum"],
            hashes["tools"],
            hashes["template"],
            10,
            2,
            require_public_publication=True,
        )


def test_public_repository_rejects_unmanifested_non_sample_jsonl(tmp_path) -> None:
    data_dir = tmp_path / "data/sft"
    data_dir.mkdir(parents=True)
    (data_dir / "train.public.jsonl").write_text("{}\n", encoding="utf-8")
    with pytest.raises(DataValidationError, match="non-sample public JSONL"):
        validate_public_repository_data(tmp_path)
