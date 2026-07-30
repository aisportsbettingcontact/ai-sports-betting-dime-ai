from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from dime_ai.chat_format import IGNORE_INDEX, ChatFormatError, _message_content
from dime_ai.foundation_control import (
    DATA_FACTORY_GOVERNANCE_PATH,
    FOUNDATION_RECORD_TEMPLATE_PATH,
    FOUNDATION_TOOL_STATES,
    validate_data_factory_governance,
    validate_foundation_record,
    validate_source_packet,
)
from dime_ai.foundation_data_factory import (
    DataFactoryError,
    assigned_split,
    convert_and_encode,
    convert_authoring_record,
    source_packet_is_releasable,
)


class FakeTokenizer:
    bos_token_id = 1
    unk_token_id = 0
    special = {
        "<|begin_of_text|>": 1,
        "<|start_header_id|>": 2,
        "<|end_header_id|>": 3,
        "<|eot_id|>": 4,
    }

    def convert_tokens_to_ids(self, token: str) -> int:
        return self.special.get(token, self.unk_token_id)

    def encode(self, value: str, add_special_tokens: bool = False) -> list[int]:
        del add_special_tokens
        return [100 + ord(character) for character in value]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def template_record() -> dict:
    record = load_json(FOUNDATION_RECORD_TEMPLATE_PATH)
    record["record_id"] = "dime-foundation-v1-governed-record-001"
    record["provenance"]["shard_id"] = "foundation-v1-governed-shard-001"
    record["provenance"]["generator"] = {
        "actor_id": "codex-generator-001",
        "model_id": "gpt-5.6-sol",
        "model_revision": "gpt-5.6-sol-2026-07-30",
        "prompt_revision": "foundation-generation-v1.0.0",
        "prompt_sha256": "a" * 64,
        "execution_receipt_sha256": "b" * 64,
        "context_sha256": "c" * 64,
        "responsibility": "generation",
    }
    record["provenance"]["critic"] = {
        "actor_id": "codex-critic-001",
        "model_id": "gpt-5.6-sol",
        "model_revision": "gpt-5.6-sol-2026-07-30",
        "prompt_revision": "foundation-critique-v1.0.0",
        "prompt_sha256": "d" * 64,
        "execution_receipt_sha256": "e" * 64,
        "context_sha256": "f" * 64,
        "responsibility": "independent_critique",
    }
    record["tool_schema_revision"] = "tools-v1.0.0"
    record["expected_tool_trace"][0]["tool_revision"] = "tools-v1.0.0"
    record["partition_identity"]["scenario_family_id"] = "governed-scenario-001"
    record["partition_identity"]["conversation_family_id"] = "governed-conversation-001"
    record["partition_identity"]["template_family_id"] = "governed-template-001"
    record["split"] = assigned_split(record)
    return record


def test_governance_is_closed_non_executing_and_scoped_to_five_actions() -> None:
    contract = load_json(DATA_FACTORY_GOVERNANCE_PATH)

    assert validate_data_factory_governance(contract) == []
    assert contract["status"] == "PROPOSED_NON_EXECUTING"
    assert contract["authorization_effect"] == "NONE_UNTIL_OWNER_MERGE_OF_EXACT_REVIEWED_HEAD"
    assert tuple(contract["tool_states"]) == FOUNDATION_TOOL_STATES
    assert len(contract["owner_merge_authorization_scope"]) == 5
    assert all(contract["owner_merge_authorization_scope"].values())
    assert len(contract["still_not_authorized"]) == 7
    assert not any(contract["still_not_authorized"].values())

    widened = deepcopy(contract)
    widened["still_not_authorized"]["model_training"] = True
    assert validate_data_factory_governance(widened)


def test_partition_assignment_is_pre_prose_deterministic_and_enforced() -> None:
    record = template_record()

    assert assigned_split(record) == record["split"]
    assert assigned_split(record) == assigned_split(deepcopy(record))

    drifted = deepcopy(record)
    drifted["split"] = "validation" if record["split"] == "train" else "train"
    issues = validate_foundation_record(drifted)
    assert any("scenario_family_sha256_mod_10" in issue for issue in issues)
    with pytest.raises(DataFactoryError, match="scenario_family_sha256_mod_10"):
        convert_authoring_record(drifted)


def test_conversion_is_deterministic_trainer_valid_and_assistant_only() -> None:
    record = template_record()

    first = convert_and_encode(record, FakeTokenizer(), max_length=4096)
    second = convert_and_encode(record, FakeTokenizer(), max_length=4096)

    assert first == second
    assert first["trainer_record"]["dataset_version"] == "dime-sft-foundation-v1"
    assert first["trainer_record"]["metadata"]["generation_method"] == "teacher-generated"
    assert first["trainer_record"]["quality"]["review_status"] == "approved"
    assert first["silent_truncation"] is False
    labels = first["encoded"]["labels"]
    assert any(value != IGNORE_INDEX for value in labels)
    assert any(value == IGNORE_INDEX for value in labels)

    with pytest.raises(ChatFormatError, match="rejected instead of truncated"):
        convert_and_encode(record, FakeTokenizer(), max_length=2)

    template = load_json(FOUNDATION_RECORD_TEMPLATE_PATH)
    with pytest.raises(DataFactoryError, match="placeholder"):
        convert_authoring_record(template)


def test_structured_tool_state_converts_calls_and_masks_results() -> None:
    record = template_record()
    step = record["expected_tool_trace"][0]
    step["expected_execution_state"] = "failure"
    step["normalized_arguments"] = {"event_id": "event-1"}
    step["expected_tool_response"] = {
        "schema_version": "dime-tool-response-v1",
        "tool_name": "get_game_context",
        "tool_version": "1.0.0",
        "tool_call_id": f"{record['record_id']}-tool-01",
        "status": "error",
        "as_of_utc": "2026-07-30T00:00:00Z",
        "valid_until_utc": None,
        "source_ids": [],
        "source_scope": {
            "scope_type": "provider_scoped",
            "provider_universe": ["governed-fixture"],
            "coverage": "governed failure fixture",
        },
        "data": {},
        "quality_flags": [],
        "warnings": [],
        "trace_id": "trace-governed-failure-1",
    }
    record["trainer_labels"]["interaction_mode"] = "degraded_tool_assisted"
    record["trainer_labels"]["evidence_status"] = "error"

    assert validate_foundation_record(record) == []
    converted = convert_authoring_record(record)
    assert [message["role"] for message in converted["messages"]] == [
        "user",
        "assistant",
        "tool",
        "assistant",
    ]
    encoded = convert_and_encode(record, FakeTokenizer(), max_length=20000)["encoded"]
    tool_result_text = _message_content(converted["messages"][2])
    tool_result_token_ids = FakeTokenizer().encode(tool_result_text)
    matching_offsets = [
        offset
        for offset in range(len(encoded["input_ids"]) - len(tool_result_token_ids) + 1)
        if encoded["input_ids"][offset : offset + len(tool_result_token_ids)]
        == tool_result_token_ids
    ]
    assert len(matching_offsets) == 1
    offset = matching_offsets[0]
    assert encoded["labels"][offset : offset + len(tool_result_token_ids)] == [IGNORE_INDEX] * len(
        tool_result_token_ids
    )


def test_source_packets_are_immutable_and_pending_rights_fail_closed() -> None:
    packet = {
        "packet_id": "packet-synthetic-policy-001",
        "source_class": "behavioral_principles",
        "source_locator": "repo:docs/DATA_GOVERNANCE.md",
        "snapshot_timestamp": "2026-07-30T00:00:00Z",
        "snapshot_sha256": "a" * 64,
        "rights_status": "approved_internal",
        "allowed_uses": ["private_foundation_authoring"],
        "prohibited_uses": ["public_raw_distribution"],
    }

    assert validate_source_packet(packet) == []
    assert source_packet_is_releasable(packet) is True

    pending = deepcopy(packet)
    pending["rights_status"] = "pending"
    with pytest.raises(DataFactoryError, match="pending source-packet rights"):
        source_packet_is_releasable(pending)

    overlap = deepcopy(packet)
    overlap["prohibited_uses"] = ["private_foundation_authoring"]
    assert validate_source_packet(overlap) == [
        "Source-packet allowed and prohibited uses must not overlap."
    ]


def test_self_review_and_tool_state_mismatches_fail_closed() -> None:
    self_reviewed = template_record()
    self_reviewed["provenance"]["critic"] = deepcopy(self_reviewed["provenance"]["generator"])
    with pytest.raises(DataFactoryError, match="cannot be its own critic"):
        convert_authoring_record(self_reviewed)

    unapproved = template_record()
    unapproved["independent_review"]["decision"] = "changes_requested"
    unapproved["independent_review"]["unresolved_material_findings"] = 1
    with pytest.raises(DataFactoryError, match="has not approved"):
        convert_authoring_record(unapproved)

    mismatched = template_record()
    mismatched["expected_tool_trace"][0]["expected_execution_state"] = "success"
    issues = validate_foundation_record(mismatched)
    assert any("requires a tool response" in issue for issue in issues)
