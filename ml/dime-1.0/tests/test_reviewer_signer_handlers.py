from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

PROJECT = Path(__file__).resolve().parents[1]
SIGNER_PATH = PROJECT / "infrastructure/aws/reviewer-signers/functions/purpose_bound_signer/app.py"
WORKLOAD_PATH = PROJECT / "infrastructure/aws/reviewer-signers/functions/reviewer_workload/app.py"
DOMAIN = b"DIME-AI-REVIEWER-PROVISIONING-V1\x00"
REVIEWER_ID = "dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980"
PROFILE_ID = "dime-agent-profile-85ef4149-03e2-49ae-b8a4-2767e8627404"
OWN_KEY = "arn:aws:kms:us-west-2:111122223333:key/owned"
OWN_SIGNER = "arn:aws:lambda:us-west-2:111122223333:function:owned:provisioning-v1"
PEER_SIGNER = "arn:aws:lambda:us-west-2:111122223333:function:peer:provisioning-v1"


def _load(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


signer = _load("dime_reviewer_purpose_bound_signer", SIGNER_PATH)
workload = _load("dime_reviewer_workload", WORKLOAD_PATH)


def _challenge() -> bytes:
    return DOMAIN + b'{"reviewer":"a","purpose":"possession"}'


def _request(operation: str) -> tuple[dict[str, str], str]:
    challenge = _challenge()
    digest = hashlib.sha256(challenge).hexdigest()
    return (
        {
            "operation": operation,
            "challenge_base64": base64.b64encode(challenge).decode("ascii"),
            "challenge_sha256": digest,
        },
        digest,
    )


def _signer_environment(digest: str) -> dict[str, str]:
    return {
        "EXPECTED_CHALLENGE_SHA256": digest,
        "KMS_KEY_ARN": OWN_KEY,
        "REVIEWER_ID": REVIEWER_ID,
        "PROFILE_ID": PROFILE_ID,
    }


def _workload_environment(digest: str) -> dict[str, str]:
    return {
        "EXPECTED_CHALLENGE_SHA256": digest,
        "OWN_SIGNER_ALIAS_ARN": OWN_SIGNER,
        "FORBIDDEN_SIGNER_ALIAS_ARN": PEER_SIGNER,
        "REVIEWER_ID": REVIEWER_ID,
        "PROFILE_ID": PROFILE_ID,
    }


class FakeKms:
    def __init__(self, *, response: dict[str, Any] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.response = response

    def sign(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return self.response or {
            "KeyId": OWN_KEY,
            "SigningAlgorithm": "ED25519_SHA_512",
            "Signature": b"s" * 64,
        }


class AccessDeniedError(Exception):
    def __init__(self) -> None:
        self.response = {"Error": {"Code": "AccessDeniedException"}}
        super().__init__("denied")


class FakeLambda:
    def __init__(self, *, admit_peer: bool = False) -> None:
        self.admit_peer = admit_peer
        self.calls: list[dict[str, Any]] = []

    def invoke(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        if kwargs["FunctionName"] == PEER_SIGNER:
            if self.admit_peer:
                return {"StatusCode": 200, "Payload": io.BytesIO(b'{"rejected":"handler"}')}
            raise AccessDeniedError
        request = json.loads(kwargs["Payload"])
        response = {
            "schema_version": "dime-ai-reviewer-provisioning-signature-v1",
            "reviewer_id": REVIEWER_ID,
            "profile_id": PROFILE_ID,
            "challenge_sha256": request["challenge_sha256"],
            "key_id": OWN_KEY,
            "signing_algorithm": "ED25519_SHA_512",
            "signature_base64": base64.b64encode(b"s" * 64).decode("ascii"),
        }
        return {
            "StatusCode": 200,
            "Payload": io.BytesIO(json.dumps(response).encode("utf-8")),
        }


def test_purpose_bound_signer_uses_exact_raw_kms_contract(capsys: Any) -> None:
    event, digest = _request(signer.OPERATION)
    kms = FakeKms()

    result = signer.sign_challenge(
        event,
        kms_client=kms,
        environ=_signer_environment(digest),
    )

    assert result == {
        "schema_version": "dime-ai-reviewer-provisioning-signature-v1",
        "reviewer_id": REVIEWER_ID,
        "profile_id": PROFILE_ID,
        "challenge_sha256": digest,
        "key_id": OWN_KEY,
        "signing_algorithm": "ED25519_SHA_512",
        "signature_base64": base64.b64encode(b"s" * 64).decode("ascii"),
    }
    assert kms.calls == [
        {
            "KeyId": OWN_KEY,
            "Message": _challenge(),
            "MessageType": "RAW",
            "SigningAlgorithm": "ED25519_SHA_512",
        }
    ]
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == ""


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda event: event.update(operation="sign_anything"), "operation"),
        (lambda event: event.update(extra="value"), "shape"),
        (lambda event: event.update(challenge_sha256="f" * 64), "authorized"),
        (lambda event: event.update(challenge_base64="not base64"), "encoding"),
        (
            lambda event: event.update(
                challenge_base64=base64.b64encode(b"wrong-domain").decode("ascii"),
                challenge_sha256=hashlib.sha256(b"wrong-domain").hexdigest(),
            ),
            "domain",
        ),
    ],
)
def test_purpose_bound_signer_rejects_broadened_requests(
    mutate: Any,
    message: str,
) -> None:
    event, digest = _request(signer.OPERATION)
    mutate(event)
    kms = FakeKms()

    with pytest.raises(signer.RequestRejected, match=message):
        signer.sign_challenge(event, kms_client=kms, environ=_signer_environment(digest))

    assert kms.calls == []


def test_purpose_bound_signer_rejects_oversized_and_unconfigured_challenges() -> None:
    challenge = DOMAIN + b"x" * 4096
    digest = hashlib.sha256(challenge).hexdigest()
    event = {
        "operation": signer.OPERATION,
        "challenge_base64": base64.b64encode(challenge).decode("ascii"),
        "challenge_sha256": digest,
    }
    kms = FakeKms()
    with pytest.raises(signer.RequestRejected, match="length"):
        signer.sign_challenge(event, kms_client=kms, environ=_signer_environment(digest))

    normal, _ = _request(signer.OPERATION)
    environment = _signer_environment("0" * 64)
    with pytest.raises(signer.RequestRejected, match="configuration"):
        signer.sign_challenge(normal, kms_client=kms, environ=environment)
    assert kms.calls == []


@pytest.mark.parametrize(
    "response",
    [
        {"KeyId": "wrong", "SigningAlgorithm": "ED25519_SHA_512", "Signature": b"s" * 64},
        {"KeyId": OWN_KEY, "SigningAlgorithm": "ED25519_PH_SHA_512", "Signature": b"s" * 64},
        {"KeyId": OWN_KEY, "SigningAlgorithm": "ED25519_SHA_512", "Signature": b"s" * 63},
    ],
)
def test_purpose_bound_signer_rejects_invalid_kms_responses(response: dict[str, Any]) -> None:
    event, digest = _request(signer.OPERATION)
    with pytest.raises(signer.RequestRejected, match="invalid response"):
        signer.sign_challenge(
            event,
            kms_client=FakeKms(response=response),
            environ=_signer_environment(digest),
        )


def test_workload_invokes_owned_alias_and_proves_peer_access_denied(capsys: Any) -> None:
    event, digest = _request(workload.OPERATION)
    client = FakeLambda()

    result = workload.run_probe(
        event,
        lambda_client=client,
        environ=_workload_environment(digest),
    )

    assert result["cross_invocation_denied"] is True
    assert result["challenge_sha256"] == digest
    assert [call["FunctionName"] for call in client.calls] == [OWN_SIGNER, PEER_SIGNER]
    owned_payload = json.loads(client.calls[0]["Payload"])
    assert owned_payload["operation"] == signer.OPERATION
    assert client.calls[1]["Payload"] == b"{}"
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == ""


def test_workload_rejects_peer_handler_error_as_failed_access_boundary() -> None:
    event, digest = _request(workload.OPERATION)

    with pytest.raises(workload.RequestRejected, match="not denied"):
        workload.run_probe(
            event,
            lambda_client=FakeLambda(admit_peer=True),
            environ=_workload_environment(digest),
        )


def test_workload_rejects_changed_challenge_before_invocation() -> None:
    event, digest = _request(workload.OPERATION)
    event["challenge_sha256"] = "f" * 64
    client = FakeLambda()

    with pytest.raises(workload.RequestRejected, match="authorized"):
        workload.run_probe(
            event,
            lambda_client=client,
            environ=_workload_environment(digest),
        )
    assert client.calls == []
