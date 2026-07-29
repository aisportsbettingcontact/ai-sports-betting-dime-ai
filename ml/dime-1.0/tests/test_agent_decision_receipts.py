from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from dime_ai import foundation_dataset
from dime_ai.agent_decision_receipts import (
    RECEIPT_SIGNATURE_DOMAIN,
    AgentDecisionReceiptError,
    agent_profile_sha256,
    decision_context_sha256,
    verify_agent_decision_receipt,
)
from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_dataset import (
    FoundationDatasetError,
    _require_agent_decision_receipts,
    canonical_record_sha256,
    load_agent_decision_receipts,
    validate_review_ledger,
)

REGISTRY_SHA256 = "a" * 64
REGISTRY_VERSION = "dime-foundation-reviewers-v0.5.0"
REVIEWER_ID = "dime-reviewer-agent-0001"
PROFILE_ID = "dime-agent-profile-agent-0001"
DECISION_AT = datetime(2026, 1, 3, tzinfo=UTC)


def _reviewer(
    private_key: Ed25519PrivateKey,
    *,
    key_status: str = "active",
) -> dict[str, Any]:
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    public_key_sha256 = hashlib.sha256(public_key).hexdigest()
    return {
        "reviewer_id": REVIEWER_ID,
        "principal_type": "ai_agent",
        "active": True,
        "roles": ["domain", "rights", "semantic-audit", "dataset-approver"],
        "independence_group_id": "dime-independence-group-agent-0001",
        "effective_start": "2026-01-01T00:00:00Z",
        "effective_end_or_open_ended": None,
        "agent_profile": {
            "profile_id": PROFILE_ID,
            "status": "active",
            "model_provider": "provider-001",
            "model_id": "model-001",
            "model_revision": "a" * 40,
            "runtime_version": "b" * 64,
            "model_lineage_id": "dime-model-lineage-agent-0001",
            "policy_lineage_id": "dime-policy-lineage-agent-0001",
            "workload_identity_id": "dime-workload-identity-agent-0001",
            "system_instruction_sha256": "1" * 64,
            "tool_contract_sha256": "2" * 64,
            "inference_policy_sha256": "3" * 64,
            "conflict_policy_sha256": "4" * 64,
            "recusal_policy_sha256": "5" * 64,
            "revocation_status": "clear",
            "receipt_issuer_key_id": f"key-{public_key_sha256}",
            "receipt_verification_key": {
                "algorithm": "ed25519",
                "encoding": "raw-base64",
                "public_key_base64": base64.b64encode(public_key).decode("ascii"),
                "public_key_sha256": public_key_sha256,
                "status": key_status,
                "valid_from_utc": "2026-01-01T00:00:00Z",
                "valid_until_or_open_ended": None,
            },
        },
    }


def _signed_receipt(
    private_key: Ed25519PrivateKey,
    reviewer: dict[str, Any],
    document: dict[str, Any],
    *,
    receipt_field: str,
    purpose: str,
    subject_sha256: str,
    decision_at: datetime = DECISION_AT,
    receipt_id: str = "dime-receipt-0123456789abcdef0123456789abcdef",
) -> tuple[dict[str, Any], str]:
    profile = reviewer["agent_profile"]
    payload = {
        "receipt_id": receipt_id,
        "purpose": purpose,
        "reviewer_id": reviewer["reviewer_id"],
        "agent_profile_id": profile["profile_id"],
        "agent_profile_sha256": agent_profile_sha256(profile),
        "reviewer_registry_version": REGISTRY_VERSION,
        "reviewer_registry_sha256": REGISTRY_SHA256,
        "receipt_issuer_key_id": profile["receipt_issuer_key_id"],
        "subject_sha256": subject_sha256,
        "decision_context_sha256": decision_context_sha256(
            document,
            receipt_field=receipt_field,
        ),
        "decision_at_utc": decision_at.isoformat().replace("+00:00", "Z"),
    }
    signature = private_key.sign(RECEIPT_SIGNATURE_DOMAIN + canonical_json_bytes(payload))
    receipt = {
        "schema_version": "dime-agent-decision-receipt-v1",
        "canonicalization": "dime-canonical-json-v1",
        "signature_algorithm": "ed25519",
        "payload": payload,
        "signature_base64": base64.b64encode(signature).decode("ascii"),
    }
    return receipt, hashlib.sha256(canonical_json_bytes(receipt)).hexdigest()


def _verify(
    receipt: dict[str, Any],
    digest: str,
    reviewer: dict[str, Any],
    document: dict[str, Any],
    *,
    receipt_field: str,
    purpose: str,
    subject_sha256: str,
    decision_at: datetime = DECISION_AT,
) -> None:
    verify_agent_decision_receipt(
        receipt,
        expected_receipt_sha256=digest,
        reviewer=reviewer,
        reviewer_registry_sha256=REGISTRY_SHA256,
        reviewer_registry_version=REGISTRY_VERSION,
        purpose=purpose,
        subject_sha256=subject_sha256,
        decision_context_sha256_value=decision_context_sha256(
            document,
            receipt_field=receipt_field,
        ),
        decision_at=decision_at,
    )


def test_valid_ed25519_receipt_verifies_with_all_identity_bindings() -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    document = {"record_sha256": "b" * 64, "decision": "approve"}
    receipt, digest = _signed_receipt(
        private_key,
        reviewer,
        document,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=document["record_sha256"],
    )

    _verify(
        receipt,
        digest,
        reviewer,
        document,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=document["record_sha256"],
    )


@pytest.mark.parametrize(
    ("field", "wrong_value", "message"),
    [
        ("purpose", "external_audit", "purpose"),
        ("reviewer_id", "dime-reviewer-agent-9999", "reviewer_id"),
        ("agent_profile_id", "dime-agent-profile-agent-9999", "agent_profile_id"),
        ("reviewer_registry_sha256", "f" * 64, "registry_sha256"),
        ("subject_sha256", "e" * 64, "subject_sha256"),
        ("decision_context_sha256", "d" * 64, "decision_context_sha256"),
        ("decision_at_utc", "2026-01-04T00:00:00Z", "decision_at_utc"),
    ],
)
def test_signed_payload_tampering_fails_closed(
    field: str,
    wrong_value: str,
    message: str,
) -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    document = {"record_sha256": "b" * 64, "decision": "approve"}
    receipt, _ = _signed_receipt(
        private_key,
        reviewer,
        document,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=document["record_sha256"],
    )
    receipt["payload"][field] = wrong_value
    digest = hashlib.sha256(canonical_json_bytes(receipt)).hexdigest()

    with pytest.raises(AgentDecisionReceiptError, match=message):
        _verify(
            receipt,
            digest,
            reviewer,
            document,
            receipt_field="agent_decision_receipt_sha256",
            purpose="record_review",
            subject_sha256=document["record_sha256"],
        )


def test_signature_tampering_and_inactive_key_fail_closed() -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    document = {"record_sha256": "b" * 64, "decision": "approve"}
    receipt, _ = _signed_receipt(
        private_key,
        reviewer,
        document,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=document["record_sha256"],
    )
    signature = bytearray(base64.b64decode(receipt["signature_base64"]))
    signature[0] ^= 1
    receipt["signature_base64"] = base64.b64encode(signature).decode("ascii")
    digest = hashlib.sha256(canonical_json_bytes(receipt)).hexdigest()
    with pytest.raises(AgentDecisionReceiptError, match="signature verification failed"):
        _verify(
            receipt,
            digest,
            reviewer,
            document,
            receipt_field="agent_decision_receipt_sha256",
            purpose="record_review",
            subject_sha256=document["record_sha256"],
        )

    retired_reviewer = _reviewer(private_key, key_status="retired")
    valid_receipt, valid_digest = _signed_receipt(
        private_key,
        retired_reviewer,
        document,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=document["record_sha256"],
    )
    with pytest.raises(AgentDecisionReceiptError, match="key is not active"):
        _verify(
            valid_receipt,
            valid_digest,
            retired_reviewer,
            document,
            receipt_field="agent_decision_receipt_sha256",
            purpose="record_review",
            subject_sha256=document["record_sha256"],
        )


@pytest.mark.parametrize(
    ("purpose", "receipt_field"),
    [
        ("record_review", "agent_decision_receipt_sha256"),
        ("source_rights_review", "agent_decision_receipts"),
        ("external_audit", "agent_decision_receipts"),
        ("dataset_approval", "agent_decision_receipts"),
    ],
)
def test_each_governed_decision_purpose_requires_a_valid_receipt(
    purpose: str,
    receipt_field: str,
) -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    subject = "b" * 64
    document = {"subject": subject, "decision": "approve"}
    receipt, digest = _signed_receipt(
        private_key,
        reviewer,
        document,
        receipt_field=receipt_field,
        purpose=purpose,
        subject_sha256=subject,
    )
    _require_agent_decision_receipts(
        {REVIEWER_ID},
        {REVIEWER_ID: reviewer},
        {REVIEWER_ID: digest},
        label=purpose,
        receipt_documents={digest: receipt},
        reviewer_registry_sha256=REGISTRY_SHA256,
        reviewer_registry_version=REGISTRY_VERSION,
        purpose=purpose,
        subject_sha256=subject,
        decision_document=document,
        receipt_field=receipt_field,
        decision_at=DECISION_AT,
    )


def test_review_ledger_verifies_receipt_and_rejects_decision_tampering() -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    rubric_sha256 = "c" * 64
    record = {
        "example_id": "conversation-001",
        "task_type": "conversation",
        "messages": [
            {"role": "user", "content": "Give a careful answer."},
            {"role": "assistant", "content": "Here is a careful answer."},
        ],
        "curriculum": {"risk_tier": "standard", "policy_action": "allow"},
        "metadata": {
            "author_id": "author-001",
            "available_at_utc": "2026-01-01T00:00:00Z",
        },
        "quality": {
            "reviewer_ids": [REVIEWER_ID],
            "reviewed_at_utc": "2026-01-03T00:00:00Z",
        },
    }
    decision = {
        "example_id": record["example_id"],
        "record_sha256": canonical_record_sha256(record),
        "reviewer_id": REVIEWER_ID,
        "decision": "approve",
        "reviewed_at_utc": "2026-01-03T00:00:00Z",
        "rubric_sha256": rubric_sha256,
        "content_quality_passed": True,
        "grounding_passed": True,
        "numeric_trace_passed": True,
        "policy_behavior_passed": True,
        "privacy_passed": True,
        "rights_passed": True,
        "findings": [],
    }
    receipt, digest = _signed_receipt(
        private_key,
        reviewer,
        decision,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=decision["record_sha256"],
    )
    decision["agent_decision_receipt_sha256"] = digest
    ledger = {
        "schema_version": "dime-foundation-review-ledger-v1",
        "dataset_version": "dime-sft-foundation-v1",
        "rubric": {"rubric_id": "dime-answer-v1", "sha256": rubric_sha256},
        "decisions": [decision],
    }
    build_config = {
        "review_policy": {
            "elevated_task_families": [],
            "elevated_policy_actions": [],
            "required_specialist_roles": {},
            "standard_reviewer_minimum": 1,
            "elevated_reviewer_minimum": 2,
        }
    }
    verification = {
        "receipt_documents": {digest: receipt},
        "reviewer_registry_sha256": REGISTRY_SHA256,
        "reviewer_registry_version": REGISTRY_VERSION,
    }

    validate_review_ledger(
        [record],
        ledger,
        {REVIEWER_ID: reviewer},
        build_config,
        rubric_sha256,
        effective_at=datetime(2026, 1, 5, tzinfo=UTC),
        **verification,
    )
    decision["findings"] = ["tampered after signature"]
    with pytest.raises(FoundationDatasetError, match="decision_context_sha256"):
        validate_review_ledger(
            [record],
            ledger,
            {REVIEWER_ID: reviewer},
            build_config,
            rubric_sha256,
            effective_at=datetime(2026, 1, 5, tzinfo=UTC),
            **verification,
        )


def test_receipt_store_enforces_canonical_content_addressed_flat_inventory(
    tmp_path: Path,
) -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    document = {"record_sha256": "b" * 64, "decision": "approve"}
    receipt, digest = _signed_receipt(
        private_key,
        reviewer,
        document,
        receipt_field="agent_decision_receipt_sha256",
        purpose="record_review",
        subject_sha256=document["record_sha256"],
    )
    directory = tmp_path / "receipts"
    directory.mkdir()
    (directory / f"{digest}.json").write_bytes(canonical_json_bytes(receipt))
    assert load_agent_decision_receipts(directory) == {digest: receipt}

    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "empty").mkdir()
    with pytest.raises(FoundationDatasetError, match="flat"):
        load_agent_decision_receipts(nested)

    noncanonical = tmp_path / "noncanonical"
    noncanonical.mkdir()
    pretty = json.dumps(receipt, indent=2).encode("utf-8")
    pretty_digest = hashlib.sha256(pretty).hexdigest()
    (noncanonical / f"{pretty_digest}.json").write_bytes(pretty)
    with pytest.raises(FoundationDatasetError, match="canonical JSON"):
        load_agent_decision_receipts(noncanonical)


def test_receipt_store_rejects_duplicate_receipt_ids_and_oversize_files(
    tmp_path: Path,
) -> None:
    private_key = Ed25519PrivateKey.generate()
    reviewer = _reviewer(private_key)
    directory = tmp_path / "duplicates"
    directory.mkdir()
    receipt_id = "dime-receipt-fedcba9876543210fedcba9876543210"
    for index, subject in enumerate(("b" * 64, "c" * 64)):
        document = {"subject": subject, "decision": "approve"}
        receipt, digest = _signed_receipt(
            private_key,
            reviewer,
            document,
            receipt_field="agent_decision_receipts",
            purpose="external_audit",
            subject_sha256=subject,
            receipt_id=receipt_id,
        )
        (directory / f"{digest}.json").write_bytes(canonical_json_bytes(receipt))
        assert index < 2
    with pytest.raises(FoundationDatasetError, match="receipt_id"):
        load_agent_decision_receipts(directory)

    oversize = tmp_path / "oversize"
    oversize.mkdir()
    content = b"x" * (64 * 1024 + 1)
    digest = hashlib.sha256(content).hexdigest()
    (oversize / f"{digest}.json").write_bytes(content)
    with pytest.raises(FoundationDatasetError, match="64 KiB"):
        load_agent_decision_receipts(oversize)


def test_receipt_store_bounds_before_read_and_rejects_fifo_without_blocking(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    file_count = tmp_path / "file-count"
    file_count.mkdir()
    for digest in ("0" * 64, "1" * 64):
        (file_count / f"{digest}.json").write_bytes(b"{}\n")
    monkeypatch.setattr(foundation_dataset, "MAX_AGENT_RECEIPT_FILES", 1)
    with pytest.raises(FoundationDatasetError, match="file-count limit"):
        load_agent_decision_receipts(file_count)

    fifo_store = tmp_path / "fifo"
    fifo_store.mkdir()
    os.mkfifo(fifo_store / f"{'2' * 64}.json")
    started = time.monotonic()
    with pytest.raises(FoundationDatasetError, match="regular files"):
        load_agent_decision_receipts(fifo_store)
    assert time.monotonic() - started < 2


def test_human_only_receipt_path_remains_secretless_and_receipt_free() -> None:
    reviewer = {
        "reviewer_id": "dime-reviewer-human-0001",
        "principal_type": "human",
        "active": True,
    }
    _require_agent_decision_receipts(
        {reviewer["reviewer_id"]},
        {reviewer["reviewer_id"]: reviewer},
        None,
        label="human review",
    )


def test_dime_canonical_json_v1_golden_vector() -> None:
    value = {
        "z": ["é", "\u0001", {"β": "東京"}],
        "a": {"line": "one\ntwo", "quote": '"'},
    }
    expected = (
        '{"a":{"line":"one\\ntwo","quote":"\\""},"z":["é","\\u0001",{"β":"東京"}]}\n'
    ).encode()
    assert canonical_json_bytes(value) == expected
    assert canonical_json_bytes(deepcopy(value)) == expected
