from __future__ import annotations

from copy import deepcopy

import pytest

from dime_ai.foundation_instrumentation import (
    TOKEN_PROFILE_ID,
    DeterministicByteTokenizer,
    FoundationInstrumentationError,
    build_context_packet,
    context_efficiency_report,
    expected_critic_decision_receipt_sha256,
    expected_critic_execution_receipt_sha256,
    route_token_report,
    token_profile,
    validate_schema,
)


def context_packet(*, duplicate: bool = False) -> dict:
    first = {
        "unit_id": "governance",
        "source_path": "configs/foundation_data_factory_governance_v1.json",
        "source_sha256": "a" * 64,
        "content": "retrieve validate or abstain",
        "relevant": True,
    }
    second = {
        "unit_id": "route-policy",
        "source_path": "configs/foundation_release_plan_v1.json",
        "source_sha256": "b" * 64,
        "content": first["content"] if duplicate else "live facts are never durable memory",
        "relevant": True,
    }
    return build_context_packet(
        packet_id="foundation-context-record-001-generation",
        record_id="dime-foundation-v1-record-instrumentation-001",
        route="live_data",
        role="generation",
        created_at="2026-07-30T18:00:00Z",
        units=[first, second],
    )


def test_frozen_token_profile_is_explicitly_not_the_training_tokenizer() -> None:
    profile = token_profile()

    assert profile["profile_id"] == TOKEN_PROFILE_ID
    assert profile["training_tokenizer_equivalent"] is False
    assert profile["encoding"]["token_unit"] == "one_token_per_utf8_byte"
    assert "production_model_token_count" in profile["prohibited_claims"]


def test_byte_tokenizer_is_unicode_deterministic() -> None:
    tokenizer = DeterministicByteTokenizer()

    assert tokenizer.encode("edge") == tokenizer.encode("edge")
    assert len(tokenizer.encode("é")) == len("é".encode()) == 2
    assert tokenizer.convert_tokens_to_ids("<|eot_id|>") == 4


def test_context_metrics_count_exact_duplicate_units() -> None:
    unique = context_packet()
    duplicate = context_packet(duplicate=True)

    assert unique["metrics"]["context_relevance"] == 1
    assert unique["metrics"]["context_redundancy"] == 0
    assert duplicate["units"][1]["duplicate_of"] == "governance"
    assert duplicate["metrics"]["redundant_context_tokens"] > 0
    assert duplicate["metrics"]["context_redundancy"] == 0.5


def test_context_schema_rejects_metric_widening() -> None:
    packet = context_packet()
    packet["unreviewed"] = True

    with pytest.raises(FoundationInstrumentationError, match="Additional properties"):
        validate_schema(packet, "foundation_context_packet.schema.json", "packet")


def test_route_token_report_aggregates_masking_and_context() -> None:
    packet = context_packet()
    encoded = [
        {
            "record_id": packet["record_id"],
            "route": "live_data",
            "encoded": {
                "input_ids": [1, 2, 3, 4],
                "labels": [-100, -100, 3, 4],
            },
        }
    ]

    report = route_token_report(encoded, [packet])
    route = report["routes"]["live_data"]
    assert route["records"] == 1
    assert route["input_tokens"] == 4
    assert route["supervised_tokens"] == 2
    assert route["masked_tokens"] == 2
    assert route["context_relevance"] == 1
    assert route["context_redundancy"] == 0
    assert route["within_packet_context_redundancy"] == 0
    assert report["training_tokenizer_equivalent"] is False
    assert report["context_efficiency"]["totals"]["unique_cache_ratio"] == 1


def test_context_efficiency_separates_cross_record_and_unique_cache() -> None:
    first = context_packet()
    second = deepcopy(first)
    second["packet_id"] = "foundation-context-record-002-generation"
    second["record_id"] = "dime-foundation-v1-record-instrumentation-002"

    report = context_efficiency_report([first, second])
    totals = report["totals"]
    assert totals["within_packet_repeated_context_tokens"] == 0
    assert totals["same_record_cross_packet_context_tokens"] == 0
    assert totals["cross_record_shared_context_tokens"] > 0
    assert totals["unique_cached_context_tokens"] * 2 == totals["logical_context_tokens"]
    assert (
        totals["unique_cached_context_tokens"] + totals["repeated_logical_context_tokens"]
        == totals["logical_context_tokens"]
    )


def test_context_efficiency_separates_same_record_cross_packet_reuse() -> None:
    first = context_packet()
    second = deepcopy(first)
    second["packet_id"] = "foundation-context-record-001-independent-critique"
    second["role"] = "independent_critique"

    totals = context_efficiency_report([first, second])["totals"]
    assert totals["cross_record_shared_context_tokens"] == 0
    assert totals["same_record_cross_packet_context_tokens"] > 0
    assert totals["within_packet_repeated_context_tokens"] == 0


def test_critic_decision_schema_rejects_generator_responsibility() -> None:
    decision = {
        "schema_version": "dime-foundation-independent-critic-decision-v1",
        "decision_id": "foundation-critic-decision-record-001",
        "record_id": "dime-foundation-v1-record-instrumentation-001",
        "draft_sha256": "a" * 64,
        "critic": {
            "actor_id": "critic-record-001",
            "model_id": "gpt-5.6-sol",
            "model_revision": "gpt-5.6-sol-2026-07-30",
            "prompt_revision": "foundation-critique-pilot-v1",
            "prompt_sha256": "b" * 64,
            "execution_receipt_sha256": "c" * 64,
            "context_sha256": "d" * 64,
            "responsibility": "independent_critique",
        },
        "critic_context_packet_sha256": "d" * 64,
        "decision": "approved",
        "rubric_version": "foundation-rubric-v1",
        "reviewed_at": "2026-07-30T18:00:00Z",
        "findings": [],
        "unresolved_material_findings": 0,
        "deterministic_validation_passed": True,
        "decision_receipt_sha256": "e" * 64,
    }
    validate_schema(
        decision,
        "foundation_critic_decision.schema.json",
        "critic decision",
    )
    widened = deepcopy(decision)
    widened["critic"]["responsibility"] = "generation"
    with pytest.raises(FoundationInstrumentationError, match="independent_critique"):
        validate_schema(
            widened,
            "foundation_critic_decision.schema.json",
            "critic decision",
        )


def test_critic_receipts_bind_exact_context_draft_and_decision() -> None:
    critic = {
        "actor_id": "critic-record-001",
        "model_id": "gpt-5.6-sol",
        "model_revision": "gpt-5.6-sol-2026-07-30",
        "prompt_revision": "foundation-critique-pilot-v1",
        "prompt_sha256": "b" * 64,
        "execution_receipt_sha256": "",
        "context_sha256": "d" * 64,
        "responsibility": "independent_critique",
    }
    critic["execution_receipt_sha256"] = expected_critic_execution_receipt_sha256(
        record_id="dime-foundation-v1-record-instrumentation-001",
        draft_sha256="a" * 64,
        critic=critic,
        context_sha256=critic["context_sha256"],
        reviewed_at="2026-07-30T18:00:00Z",
    )
    decision = {
        "schema_version": "dime-foundation-independent-critic-decision-v1",
        "decision_id": "foundation-critic-decision-record-001",
        "record_id": "dime-foundation-v1-record-instrumentation-001",
        "draft_sha256": "a" * 64,
        "critic": critic,
        "critic_context_packet_sha256": "d" * 64,
        "decision": "approved",
        "rubric_version": "foundation-rubric-v1",
        "reviewed_at": "2026-07-30T18:00:00Z",
        "findings": [],
        "unresolved_material_findings": 0,
        "deterministic_validation_passed": True,
        "decision_receipt_sha256": "",
    }
    decision["decision_receipt_sha256"] = expected_critic_decision_receipt_sha256(decision)

    first = expected_critic_decision_receipt_sha256(decision)
    assert first == decision["decision_receipt_sha256"]
    changed = deepcopy(decision)
    changed["decision"] = "rejected"
    assert expected_critic_decision_receipt_sha256(changed) != first
