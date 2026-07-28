"""Fail-closed verification for content-addressed AI-agent decision receipts."""

from __future__ import annotations

import base64
import binascii
import hashlib
from datetime import UTC, datetime
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from dime_ai.canonical_json import canonical_json_bytes

RECEIPT_SCHEMA_VERSION = "dime-agent-decision-receipt-v1"
RECEIPT_CANONICALIZATION = "dime-canonical-json-v1"
RECEIPT_SIGNATURE_ALGORITHM = "ed25519"
RECEIPT_VERIFIER_ID = "dime-ed25519-decision-receipt-verifier"
RECEIPT_VERIFIER_VERSION = "1.0.0"
RECEIPT_SIGNATURE_DOMAIN = b"DIME-AGENT-DECISION-RECEIPT-V1\x00"
RECEIPT_PURPOSES = {
    "record_review",
    "source_rights_review",
    "external_audit",
    "dataset_approval",
}


class AgentDecisionReceiptError(ValueError):
    """Raised when an AI-agent receipt cannot establish reviewer authority."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def decision_context_sha256(
    document: dict[str, Any],
    *,
    receipt_field: str,
) -> str:
    """Hash the exact decision object with its detached receipt references removed."""

    context = {key: value for key, value in document.items() if key != receipt_field}
    return sha256_bytes(canonical_json_bytes(context))


def agent_profile_sha256(profile: dict[str, Any]) -> str:
    """Bind a receipt to one exact immutable agent profile."""

    return sha256_bytes(canonical_json_bytes(profile))


def _parse_utc(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise AgentDecisionReceiptError(f"{label} must be canonical UTC ending in Z")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AgentDecisionReceiptError(f"{label} is invalid") from exc
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise AgentDecisionReceiptError(f"{label} must be normalized to UTC")
    return parsed.astimezone(UTC)


def _decode_base64(value: Any, *, expected_length: int, label: str) -> bytes:
    if not isinstance(value, str):
        raise AgentDecisionReceiptError(f"{label} must be canonical base64")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise AgentDecisionReceiptError(f"{label} must be canonical base64") from exc
    if len(decoded) != expected_length or base64.b64encode(decoded).decode("ascii") != value:
        raise AgentDecisionReceiptError(f"{label} has an invalid encoding or length")
    return decoded


def verify_agent_decision_receipt(
    receipt: dict[str, Any],
    *,
    expected_receipt_sha256: str,
    reviewer: dict[str, Any],
    reviewer_registry_sha256: str,
    reviewer_registry_version: str,
    purpose: str,
    subject_sha256: str,
    decision_context_sha256_value: str,
    decision_at: datetime,
) -> None:
    """Verify signature, key, profile, registry, purpose, subject, and decision bindings."""

    if purpose not in RECEIPT_PURPOSES:
        raise AgentDecisionReceiptError("unsupported AI-agent receipt purpose")
    if decision_at.microsecond != 0:
        raise AgentDecisionReceiptError(
            "AI-agent receipt decision time must use whole-second UTC precision"
        )
    if receipt.get("schema_version") != RECEIPT_SCHEMA_VERSION:
        raise AgentDecisionReceiptError("unsupported AI-agent receipt schema")
    if receipt.get("canonicalization") != RECEIPT_CANONICALIZATION:
        raise AgentDecisionReceiptError("unsupported AI-agent receipt canonicalization")
    if receipt.get("signature_algorithm") != RECEIPT_SIGNATURE_ALGORITHM:
        raise AgentDecisionReceiptError("unsupported AI-agent receipt signature algorithm")
    if sha256_bytes(canonical_json_bytes(receipt)) != expected_receipt_sha256:
        raise AgentDecisionReceiptError("AI-agent receipt digest mismatch")
    if reviewer.get("principal_type") != "ai_agent" or not reviewer.get("active"):
        raise AgentDecisionReceiptError("AI-agent receipt reviewer is not an active AI principal")

    profile = reviewer.get("agent_profile")
    if not isinstance(profile, dict) or profile.get("status") != "active":
        raise AgentDecisionReceiptError("AI-agent receipt profile is not active")
    key = profile.get("receipt_verification_key")
    if not isinstance(key, dict) or key.get("status") != "active":
        raise AgentDecisionReceiptError("AI-agent receipt verification key is not active")
    if key.get("algorithm") != RECEIPT_SIGNATURE_ALGORITHM:
        raise AgentDecisionReceiptError(
            "AI-agent receipt verification key algorithm is unsupported"
        )
    if key.get("encoding") != "raw-base64":
        raise AgentDecisionReceiptError("AI-agent receipt verification key encoding is unsupported")

    payload = receipt.get("payload")
    if not isinstance(payload, dict):
        raise AgentDecisionReceiptError("AI-agent receipt payload is missing")
    expected_payload = {
        "purpose": purpose,
        "reviewer_id": reviewer.get("reviewer_id"),
        "agent_profile_id": profile.get("profile_id"),
        "agent_profile_sha256": agent_profile_sha256(profile),
        "reviewer_registry_version": reviewer_registry_version,
        "reviewer_registry_sha256": reviewer_registry_sha256,
        "receipt_issuer_key_id": profile.get("receipt_issuer_key_id"),
        "subject_sha256": subject_sha256,
        "decision_context_sha256": decision_context_sha256_value,
        "decision_at_utc": decision_at.isoformat().replace("+00:00", "Z"),
    }
    for field, expected in expected_payload.items():
        if payload.get(field) != expected:
            raise AgentDecisionReceiptError(f"AI-agent receipt {field} binding mismatch")

    public_key = _decode_base64(
        key.get("public_key_base64"),
        expected_length=32,
        label="AI-agent receipt public key",
    )
    public_key_sha256 = sha256_bytes(public_key)
    if key.get("public_key_sha256") != public_key_sha256:
        raise AgentDecisionReceiptError("AI-agent receipt public-key digest mismatch")
    if profile.get("receipt_issuer_key_id") != f"key-{public_key_sha256}":
        raise AgentDecisionReceiptError(
            "AI-agent receipt key ID is not derived from its public key"
        )

    key_start = _parse_utc(key.get("valid_from_utc"), "receipt key valid_from_utc")
    raw_key_end = key.get("valid_until_or_open_ended")
    key_end = (
        None
        if raw_key_end is None
        else _parse_utc(raw_key_end, "receipt key valid_until_or_open_ended")
    )
    if key_end is not None and key_end <= key_start:
        raise AgentDecisionReceiptError("AI-agent receipt key validity period is nonpositive")
    if decision_at < key_start or (key_end is not None and decision_at >= key_end):
        raise AgentDecisionReceiptError("AI-agent receipt was signed outside key validity")
    if _parse_utc(payload.get("decision_at_utc"), "receipt decision_at_utc") != decision_at:
        raise AgentDecisionReceiptError("AI-agent receipt decision time binding mismatch")

    signature = _decode_base64(
        receipt.get("signature_base64"),
        expected_length=64,
        label="AI-agent receipt signature",
    )
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(
            signature,
            RECEIPT_SIGNATURE_DOMAIN + canonical_json_bytes(payload),
        )
    except (InvalidSignature, ValueError) as exc:
        raise AgentDecisionReceiptError("AI-agent receipt signature verification failed") from exc
