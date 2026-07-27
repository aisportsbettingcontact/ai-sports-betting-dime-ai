import json
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


def tool_result(
    source_ids: list[str],
    *,
    tool_name: str = "get_game_context",
    call_id: str = "call-1",
    status: str = "ok",
    data: dict | None = None,
) -> str:
    if data is None:
        data = {
            "event_ref": "event-1",
            "requested_fields": [
                "schedule",
                "teams",
                "rosters",
                "injuries",
                "result",
                "live_state",
            ],
            "facts": {"period": "Q1"},
            "missing_fields": ["schedule", "teams", "rosters", "injuries", "result"],
        }
    if tool_name == "calculate_market_math":
        data = {
            "operation": "implied_probability",
            "formula_version": "dime-market-math-v1",
            "normalized_inputs": {"american_odds": -110},
            "output": {key: str(value) for key, value in data.items()},
        }
    return json.dumps(
        {
            "schema_version": "dime-tool-response-v1",
            "tool_name": tool_name,
            "tool_version": "1.0.0",
            "tool_call_id": call_id,
            "status": status,
            "as_of_utc": "2026-07-25T12:00:00Z",
            "valid_until_utc": (
                None
                if tool_name == "calculate_market_math"
                else "2026-07-25T12:00:00Z"
                if status in {"ok", "partial", "stale"}
                else None
            ),
            "source_ids": source_ids,
            "source_scope": {
                "scope_type": (
                    "deterministic" if tool_name == "calculate_market_math" else "provider_scoped"
                ),
                "provider_universe": (
                    [] if tool_name == "calculate_market_math" else ["synthetic-provider"]
                ),
                "coverage": "synthetic test",
            },
            "data": data,
            "quality_flags": [],
            "warnings": [],
            "trace_id": f"trace-{call_id}",
        }
    )


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


@pytest.mark.parametrize(
    ("mutation", "marker"),
    [
        (
            lambda record, marker: record["messages"][0].update(role=marker),
            "UNTRUSTED_DATASET_ENUM_MARKER",
        ),
        (
            lambda record, marker: record.update({marker: "value"}),
            "UNTRUSTED_DATASET_PROPERTY_MARKER",
        ),
    ],
)
def test_dataset_schema_errors_do_not_reflect_untrusted_content(mutation, marker: str) -> None:
    record = sft_record()
    mutation(record, marker)
    with pytest.raises(DataValidationError) as captured:
        validate_sft_record(record)
    message = str(captured.value)
    assert marker not in message
    assert "schema violation" in message
    assert "validation" in message


def test_user_data_requires_deidentification_and_consent() -> None:
    record = sft_record()
    record["metadata"]["contains_user_data"] = True
    record["metadata"]["synthetic_or_deidentified"] = "none"
    with pytest.raises(DataValidationError):
        validate_sft_record(record)


def test_secret_and_direct_identifier_detection() -> None:
    secret = sft_record()
    secret["messages"][0]["content"] = "hf_" + "synthetic" + "testvalue1234567890"
    with pytest.raises(DataValidationError, match="credential"):
        validate_sft_record(secret)
    email = sft_record()
    email["messages"][0]["content"] = "person" + "@" + "example.test"
    with pytest.raises(DataValidationError, match="identifier"):
        validate_sft_record(email)


@pytest.mark.parametrize(
    "credential",
    [
        pytest.param("sk-" + "A" * 32, id="openai-legacy"),
        pytest.param("sk-" + "proj-" + "B_" * 20, id="openai-project"),
        pytest.param("sk-" + "svcacct-" + "C-" * 20, id="openai-service-account"),
        pytest.param("sk-" + "ant-api03-" + "D" * 32, id="anthropic"),
        pytest.param("AI" + "za" + "E" * 35, id="google"),
        pytest.param("rpa_" + "R" * 32, id="runpod-prefixed"),
        pytest.param("RUNPOD_" + "API_KEY=" + "r" * 32, id="runpod-assignment"),
        pytest.param("THE_ODDS_" + "API_KEY=" + "a1" * 16, id="odds-provider-assignment"),
        pytest.param("sk_" + "live_" + "F" * 24, id="stripe-live-secret"),
        pytest.param("sk_" + "test_" + "G" * 24, id="stripe-test-secret"),
        pytest.param("rk_" + "live_" + "H" * 24, id="stripe-live-restricted"),
        pytest.param(
            "-----BEGIN " + "PRIVATE KEY-----\n" + "I" * 64 + "\n-----END PRIVATE KEY-----",
            id="private-key-pem",
        ),
        pytest.param(
            "postgresql://" + "candidate:synthetic-password@db.example.test/sports",
            id="credential-bearing-uri",
        ),
    ],
)
def test_named_credential_patterns_are_rejected(credential: str) -> None:
    record = sft_record()
    record["messages"][0]["content"] = f"Leaked value: {credential}"

    with pytest.raises(DataValidationError, match="credential"):
        validate_sft_record(record)


def test_credential_bearing_uri_in_tool_result_text_is_rejected() -> None:
    record = sft_record()
    credential_uri = "https://" + "worker:synthetic-password@api.example.test/v1"
    record["messages"] = [
        {"role": "user", "content": "Check the current game context."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "get_game_context",
                        "arguments": {"event_id": "event-1"},
                    },
                }
            ],
        },
        {
            "role": "tool",
            "name": "get_game_context",
            "tool_call_id": "call-1",
            "content": tool_result(
                ["source_1"],
                data={"upstream_uri": credential_uri},
            ),
        },
        {"role": "assistant", "content": "Answer."},
    ]

    with pytest.raises(DataValidationError, match="credential-bearing URI"):
        validate_sft_record(record)


@pytest.mark.parametrize(
    "benign_text",
    [
        pytest.param(
            "The sk-110 note is ordinary sportsbook shorthand, not a credential.",
            id="sports-sk-number",
        ),
        pytest.param(
            "Words such as sk-score, sk-prop, and skater are too short to be keys.",
            id="short-sk-words",
        ),
        pytest.param(
            "Public schedule: https://sports.example.test/league/week-1",
            id="ordinary-https-url",
        ),
        pytest.param(
            "Database docs use postgresql://db.example.test/sports without userinfo.",
            id="uri-without-credentials",
        ),
        pytest.param(
            "RUNPOD_API_KEY=your_api_key_here is an explicit placeholder.",
            id="runpod-placeholder",
        ),
        pytest.param(
            "RunPod documents placeholders such as rpa_YOUR_API_KEY.",
            id="runpod-prefixed-placeholder",
        ),
        pytest.param(
            "ODDS_API_KEY=replace_me is an explicit placeholder.",
            id="odds-placeholder",
        ),
        pytest.param(
            "Stripe publishable example: " + "pk_" + "test_" + "J" * 24,
            id="stripe-publishable-key",
        ),
        pytest.param(
            "-----BEGIN " + "PUBLIC KEY----- is not a private-key block.",
            id="public-key-pem",
        ),
    ],
)
def test_credential_scanner_allows_high_signal_near_misses(benign_text: str) -> None:
    record = sft_record()
    record["messages"][0]["content"] = benign_text

    validate_sft_record(record)


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
    assert partition_keys(first) == {
        "source:source_1",
        "event_partition_key:event_1",
    }


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
            "tool_call_id": "fixture-future",
            "tool": "calculate_market_math",
            "arguments": {
                "operation": "implied_probability",
                "inputs": {"american_odds": -110},
            },
            "returns": json.loads(
                tool_result(
                    ["future"],
                    tool_name="calculate_market_math",
                    call_id="fixture-future",
                    data={"implied_probability": 0.5238095238},
                )
            ),
        }
    ]
    record["tool_fixtures"][0]["returns"]["as_of_utc"] = "2099-01-01T00:00:00Z"
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


def test_valid_multi_call_iterative_and_multi_turn_sequence() -> None:
    record = sft_record()
    record["messages"] = [
        {"role": "system", "content": "Use tools carefully."},
        {"role": "user", "content": "Analyze the event."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-context",
                    "type": "function",
                    "function": {
                        "name": "get_game_context",
                        "arguments": {"event_id": "event-1"},
                    },
                },
                {
                    "id": "call-odds",
                    "type": "function",
                    "function": {
                        "name": "get_current_odds",
                        "arguments": {
                            "event_id": "event-1",
                            "market_key": {
                                "market_type": "spread",
                                "period": "full_game",
                            },
                        },
                    },
                },
            ],
        },
        {
            "role": "tool",
            "name": "get_current_odds",
            "tool_call_id": "call-odds",
            "content": tool_result(
                ["source_1"],
                tool_name="get_current_odds",
                call_id="call-odds",
                data={
                    "event_ref": "event-1",
                    "market_key": {"market_type": "spread", "period": "full_game"},
                    "market_phase": "pregame",
                    "provider_scope": "synthetic",
                    "quotes": [
                        {
                            "selection": "home",
                            "line": "-2.5",
                            "price_american": -110,
                            "observed_at_utc": "2026-07-25T12:00:00Z",
                            "quote_status": "current",
                            "source_id": "source_1",
                        }
                    ],
                },
            ),
        },
        {
            "role": "tool",
            "name": "get_game_context",
            "tool_call_id": "call-context",
            "content": tool_result(["source_1"], call_id="call-context"),
        },
        {
            "role": "assistant",
            "content": "I need the history too.",
            "tool_calls": [
                {
                    "id": "call-history",
                    "type": "function",
                    "function": {
                        "name": "get_odds_history",
                        "arguments": {
                            "event_id": "event-1",
                            "market_key": {
                                "market_type": "spread",
                                "period": "full_game",
                            },
                        },
                    },
                }
            ],
        },
        {
            "role": "tool",
            "name": "get_odds_history",
            "tool_call_id": "call-history",
            "content": tool_result(
                ["source_1"],
                tool_name="get_odds_history",
                call_id="call-history",
                data={
                    "event_ref": "event-1",
                    "market_key": {"market_type": "spread", "period": "full_game"},
                    "requested_from_utc": None,
                    "requested_to_utc": None,
                    "returned_from_utc": None,
                    "returned_to_utc": None,
                    "snapshots": [],
                    "next_cursor": None,
                    "truncated": False,
                    "gap_flags": [],
                },
            ),
        },
        {"role": "assistant", "content": "Here is the grounded analysis."},
        {"role": "user", "content": "Summarize it."},
        {"role": "assistant", "content": "Concise grounded summary."},
    ]

    validate_sft_record(record)


@pytest.mark.parametrize(
    "messages",
    [
        [
            {"role": "assistant", "content": "Answer before a question."},
            {"role": "user", "content": "Question arrives later."},
        ],
        [
            {"role": "user", "content": "Question."},
            {"role": "assistant", "content": "Answer."},
            {"role": "user", "content": "Unanswered follow-up."},
        ],
        [
            {"role": "user", "content": "Question."},
            {"role": "assistant", "content": "First answer."},
            {"role": "assistant", "content": "Second answer without a user turn."},
        ],
        [
            {"role": "user", "content": "Question."},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "get_game_context",
                            "arguments": {"event_id": "event-1"},
                        },
                    }
                ],
            },
            {"role": "user", "content": "Interrupt the pending call."},
            {
                "role": "tool",
                "name": "get_game_context",
                "tool_call_id": "call-1",
                "content": tool_result(["source_1"]),
            },
            {"role": "assistant", "content": "Answer."},
        ],
        [
            {"role": "user", "content": "Question."},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "get_game_context",
                            "arguments": {"event_id": "event-1"},
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "name": "get_game_context",
                "tool_call_id": "call-1",
                "content": tool_result(["source_1"]),
            },
        ],
    ],
)
def test_invalid_message_sequences_are_rejected(messages: list[dict]) -> None:
    record = sft_record()
    record["messages"] = messages

    with pytest.raises(DataValidationError, match="conversation|message|tool"):
        validate_sft_record(record)


def test_tool_result_sources_must_be_declared_in_record_metadata() -> None:
    record = sft_record()
    call = {
        "id": "call-1",
        "type": "function",
        "function": {
            "name": "get_game_context",
            "arguments": {"event_id": "event-1"},
        },
    }
    record["messages"] = [
        {"role": "user", "content": "Question."},
        {"role": "assistant", "content": "", "tool_calls": [call]},
        {
            "role": "tool",
            "name": "get_game_context",
            "tool_call_id": "call-1",
            "content": tool_result(["hidden-source"]),
        },
        {"role": "assistant", "content": "Answer."},
    ]

    with pytest.raises(DataValidationError, match="undeclared source IDs"):
        validate_sft_record(record)


def test_successful_data_tool_requires_nonempty_source_ids() -> None:
    record = sft_record()
    record["messages"] = [
        {"role": "user", "content": "Question."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "get_game_context",
                        "arguments": {"event_id": "event-1"},
                    },
                }
            ],
        },
        {
            "role": "tool",
            "name": "get_game_context",
            "tool_call_id": "call-1",
            "content": tool_result([]),
        },
        {"role": "assistant", "content": "Answer."},
    ]

    with pytest.raises(DataValidationError, match="requires source IDs"):
        validate_sft_record(record)


def test_calculate_market_math_may_use_a_source_less_result() -> None:
    record = sft_record()
    record["messages"] = [
        {"role": "user", "content": "What is the implied probability at -110?"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "calculate_market_math",
                        "arguments": {
                            "operation": "implied_probability",
                            "inputs": {"american_odds": -110},
                        },
                    },
                }
            ],
        },
        {
            "role": "tool",
            "name": "calculate_market_math",
            "tool_call_id": "call-1",
            "content": tool_result(
                [],
                tool_name="calculate_market_math",
                data={"implied_probability": 0.5238095238},
            ),
        },
        {"role": "assistant", "content": "The implied probability is about 52.38%."},
    ]

    validate_sft_record(record)


def test_partition_keys_include_tool_result_sources_defensively() -> None:
    record = sft_record()
    record["messages"] = [
        {"role": "user", "content": "Question."},
        {"role": "assistant", "content": "Answer."},
        {
            "role": "tool",
            "name": "get_game_context",
            "tool_call_id": "unvalidated-call",
            "content": tool_result(["tool-result-source"]),
        },
    ]

    assert partition_keys(record) == {
        "source:source_1",
        "source:tool-result-source",
        "event_partition_key:event_1",
    }


def test_curriculum_schema_requires_answer_length() -> None:
    record = sft_record()
    record["curriculum"] = {
        "skill_ids": ["market_math.expected_value"],
        "difficulty": "hard",
        "interaction_mode": "direct_no_tool",
        "scenario_cluster_id": "scenario-1",
        "evidence_status": "not_applicable",
        "policy_action": "allow",
        "risk_tier": "standard",
    }

    with pytest.raises(DataValidationError, match="required"):
        validate_sft_record(record)


def test_production_records_require_lineage_and_reviewers() -> None:
    with pytest.raises(DataValidationError, match="reviewer"):
        validate_sft_record(sft_record(), production=True)


def test_production_records_require_curriculum_and_double_review_critical() -> None:
    record = sft_record()
    record["dataset_version"] = "dime-sft-foundation-v1"
    record["metadata"].update(
        {
            "available_at_utc": "2026-07-25T12:00:00Z",
            "author_id": "author-001",
            "conversation_partition_key": "test",
            "rights_basis": "rights-synthetic-owned",
            "source_owner": "dime",
            "source_snapshot_partition_key": "snapshot-001",
            "generation_method": "human-authored",
            "direct_identifier_scan_version": "scan-v1",
            "provider_ids": [],
        }
    )
    record["quality"].update(
        {
            "reviewer_ids": ["domain-reviewer-001"],
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
        "answer_length": "concise",
    }
    with pytest.raises(DataValidationError, match="two reviewers"):
        validate_sft_record(record, production=True)
    record["quality"]["reviewer_ids"].append("numeric-reviewer-001")
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
