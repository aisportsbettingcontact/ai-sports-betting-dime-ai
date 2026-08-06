"""Fixed reviewer-workload probe for one purpose-bound signer."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
from collections.abc import Mapping
from typing import Any

OPERATION = "run_foundation_reviewer_provisioning_probe_v1"
SIGNER_OPERATION = "sign_foundation_reviewer_provisioning_challenge_v1"
CHALLENGE_DOMAIN = b"DIME-AI-REVIEWER-PROVISIONING-V1\x00"
MAX_CHALLENGE_BYTES = 4096
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_FIELDS = frozenset({"operation", "challenge_base64", "challenge_sha256"})


class RequestRejected(ValueError):
    """Raised when a workload request or signer response violates the contract."""


def _required_setting(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name)
    if not isinstance(value, str) or not value:
        raise RequestRejected("workload configuration is incomplete")
    return value


def _validate_challenge(event: Any, expected_digest: str) -> tuple[str, str]:
    if not isinstance(event, dict) or set(event) != ALLOWED_FIELDS:
        raise RequestRejected("request shape is invalid")
    if event["operation"] != OPERATION:
        raise RequestRejected("operation is not authorized")
    supplied_digest = event["challenge_sha256"]
    encoded = event["challenge_base64"]
    if (
        not isinstance(supplied_digest, str)
        or SHA256.fullmatch(supplied_digest) is None
        or not isinstance(encoded, str)
        or not encoded
    ):
        raise RequestRejected("challenge input is invalid")
    try:
        challenge = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RequestRejected("challenge input is invalid") from exc
    if (
        base64.b64encode(challenge).decode("ascii") != encoded
        or not 1 <= len(challenge) <= MAX_CHALLENGE_BYTES
        or not challenge.startswith(CHALLENGE_DOMAIN)
    ):
        raise RequestRejected("challenge input is invalid")
    computed = hashlib.sha256(challenge).hexdigest()
    if (
        expected_digest == "0" * 64
        or SHA256.fullmatch(expected_digest) is None
        or not hmac.compare_digest(computed, supplied_digest)
        or not hmac.compare_digest(computed, expected_digest)
    ):
        raise RequestRejected("challenge is not authorized")
    return encoded, computed


def _payload_bytes(response: Mapping[str, Any]) -> bytes:
    payload = response.get("Payload")
    if hasattr(payload, "read"):
        payload = payload.read()
    if not isinstance(payload, bytes):
        raise RequestRejected("signer returned an invalid response")
    return payload


def _access_denied(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error")
    return isinstance(error, dict) and error.get("Code") in {
        "AccessDenied",
        "AccessDeniedException",
    }


def run_probe(
    event: Any,
    *,
    lambda_client: Any,
    environ: Mapping[str, str],
) -> dict[str, Any]:
    """Invoke the owned signer and prove the peer signer is inaccessible."""

    expected_digest = _required_setting(environ, "EXPECTED_CHALLENGE_SHA256")
    encoded, computed_digest = _validate_challenge(event, expected_digest)
    own_signer = _required_setting(environ, "OWN_SIGNER_ALIAS_ARN")
    forbidden_signer = _required_setting(environ, "FORBIDDEN_SIGNER_ALIAS_ARN")
    if own_signer == forbidden_signer:
        raise RequestRejected("workload signer boundaries are invalid")

    signer_request = {
        "operation": SIGNER_OPERATION,
        "challenge_base64": encoded,
        "challenge_sha256": computed_digest,
    }
    response = lambda_client.invoke(
        FunctionName=own_signer,
        InvocationType="RequestResponse",
        Payload=json.dumps(signer_request, sort_keys=True, separators=(",", ":")).encode("utf-8"),
    )
    if response.get("StatusCode") != 200 or response.get("FunctionError") is not None:
        raise RequestRejected("owned signer invocation failed")
    try:
        signer_result = json.loads(_payload_bytes(response))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RequestRejected("signer returned an invalid response") from exc
    if (
        not isinstance(signer_result, dict)
        or signer_result.get("challenge_sha256") != computed_digest
        or signer_result.get("reviewer_id") != _required_setting(environ, "REVIEWER_ID")
        or signer_result.get("profile_id") != _required_setting(environ, "PROFILE_ID")
    ):
        raise RequestRejected("signer returned an invalid response")

    try:
        forbidden_response = lambda_client.invoke(
            FunctionName=forbidden_signer,
            InvocationType="RequestResponse",
            Payload=b"{}",
        )
    except Exception as exc:
        if not _access_denied(exc):
            raise RequestRejected("peer signer denial could not be proven") from exc
    else:
        # Any response proves that IAM admitted the cross-reviewer invocation,
        # even when the peer handler rejected the deliberately empty payload.
        _payload_bytes(forbidden_response)
        raise RequestRejected("peer signer invocation was not denied")

    return {
        "schema_version": "dime-ai-reviewer-provisioning-probe-v1",
        "reviewer_id": signer_result["reviewer_id"],
        "profile_id": signer_result["profile_id"],
        "challenge_sha256": computed_digest,
        "signature_base64": signer_result["signature_base64"],
        "key_id": signer_result["key_id"],
        "signing_algorithm": signer_result["signing_algorithm"],
        "cross_invocation_denied": True,
    }


def _lambda_client() -> Any:
    import boto3

    return boto3.client("lambda")


def lambda_handler(event: Any, _context: Any) -> dict[str, Any]:
    """AWS Lambda entry point."""

    return run_probe(event, lambda_client=_lambda_client(), environ=os.environ)
