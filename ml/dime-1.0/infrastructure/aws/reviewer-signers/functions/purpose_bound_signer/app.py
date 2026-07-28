"""Purpose-bound AWS KMS signer for one Foundation reviewer challenge."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import re
from collections.abc import Mapping
from typing import Any

OPERATION = "sign_foundation_reviewer_provisioning_challenge_v1"
CHALLENGE_DOMAIN = b"DIME-AI-REVIEWER-PROVISIONING-V1\x00"
SIGNING_ALGORITHM = "ED25519_SHA_512"
MESSAGE_TYPE = "RAW"
MAX_CHALLENGE_BYTES = 4096
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_FIELDS = frozenset({"operation", "challenge_base64", "challenge_sha256"})


class RequestRejected(ValueError):
    """Raised when a request does not match the immutable signing contract."""


def _required_setting(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name)
    if not isinstance(value, str) or not value:
        raise RequestRejected("signer configuration is incomplete")
    return value


def _decode_challenge(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise RequestRejected("challenge encoding is invalid")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RequestRejected("challenge encoding is invalid") from exc
    if base64.b64encode(decoded).decode("ascii") != value:
        raise RequestRejected("challenge encoding is not canonical")
    if not 1 <= len(decoded) <= MAX_CHALLENGE_BYTES:
        raise RequestRejected("challenge length is outside the signing contract")
    if not decoded.startswith(CHALLENGE_DOMAIN):
        raise RequestRejected("challenge domain is invalid")
    return decoded


def sign_challenge(
    event: Any,
    *,
    kms_client: Any,
    environ: Mapping[str, str],
) -> dict[str, str]:
    """Validate and sign only the one challenge pinned in the environment."""

    if not isinstance(event, dict) or set(event) != ALLOWED_FIELDS:
        raise RequestRejected("request shape is invalid")
    if event["operation"] != OPERATION:
        raise RequestRejected("operation is not authorized")

    supplied_digest = event["challenge_sha256"]
    if not isinstance(supplied_digest, str) or SHA256.fullmatch(supplied_digest) is None:
        raise RequestRejected("challenge digest is invalid")

    expected_digest = _required_setting(environ, "EXPECTED_CHALLENGE_SHA256")
    if SHA256.fullmatch(expected_digest) is None or expected_digest == "0" * 64:
        raise RequestRejected("signer configuration is incomplete")

    challenge = _decode_challenge(event["challenge_base64"])
    computed_digest = hashlib.sha256(challenge).hexdigest()
    if not hmac.compare_digest(computed_digest, supplied_digest) or not hmac.compare_digest(
        computed_digest, expected_digest
    ):
        raise RequestRejected("challenge is not authorized")

    key_arn = _required_setting(environ, "KMS_KEY_ARN")
    reviewer_id = _required_setting(environ, "REVIEWER_ID")
    profile_id = _required_setting(environ, "PROFILE_ID")
    response = kms_client.sign(
        KeyId=key_arn,
        Message=challenge,
        MessageType=MESSAGE_TYPE,
        SigningAlgorithm=SIGNING_ALGORITHM,
    )
    signature = response.get("Signature")
    if (
        response.get("KeyId") != key_arn
        or response.get("SigningAlgorithm") != SIGNING_ALGORITHM
        or not isinstance(signature, bytes)
        or len(signature) != 64
    ):
        raise RequestRejected("signing service returned an invalid response")

    return {
        "schema_version": "dime-ai-reviewer-provisioning-signature-v1",
        "reviewer_id": reviewer_id,
        "profile_id": profile_id,
        "challenge_sha256": computed_digest,
        "key_id": key_arn,
        "signing_algorithm": SIGNING_ALGORITHM,
        "signature_base64": base64.b64encode(signature).decode("ascii"),
    }


def _kms_client() -> Any:
    import boto3

    return boto3.client("kms")


def lambda_handler(event: Any, _context: Any) -> dict[str, str]:
    """AWS Lambda entry point."""

    return sign_challenge(event, kms_client=_kms_client(), environ=os.environ)
