from __future__ import annotations

import base64
import hashlib
import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PROJECT = Path(__file__).resolve().parents[1]
SCRIPT = PROJECT / "scripts/export_aws_kms_ed25519_public_key.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dime_kms_public_key_export", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


exporter = _load()


def _ed25519_der() -> tuple[bytes, bytes]:
    public_key = Ed25519PrivateKey.generate().public_key()
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return der, raw


def test_exports_canonical_raw_ed25519_public_key() -> None:
    der, raw = _ed25519_der()

    assert exporter.export_public_key(der) == {
        "algorithm": "ed25519",
        "encoding": "raw-base64",
        "public_key_base64": base64.b64encode(raw).decode("ascii"),
        "public_key_sha256": hashlib.sha256(raw).hexdigest(),
    }


def test_rejects_non_ed25519_public_key() -> None:
    public_key = generate_private_key(SECP256R1()).public_key()
    der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    with pytest.raises(exporter.PublicKeyExportError, match="Ed25519"):
        exporter.export_public_key(der)


@pytest.mark.parametrize(
    "invalid",
    [
        b"",
        b"not-der",
        b"-----BEGIN PUBLIC KEY-----\nnot-der\n-----END PUBLIC KEY-----\n",
        b"-----BEGIN " + b"PRIVATE KEY-----\nnot-der\n-----END " + b"PRIVATE KEY-----\n",
    ],
)
def test_rejects_non_der_and_private_markers(invalid: bytes) -> None:
    with pytest.raises(exporter.PublicKeyExportError):
        exporter.export_public_key(invalid)


def test_rejects_private_key_der_and_appended_bytes() -> None:
    private_key = Ed25519PrivateKey.generate()
    private_der = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    with pytest.raises(exporter.PublicKeyExportError):
        exporter.export_public_key(private_der)

    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    with pytest.raises(exporter.PublicKeyExportError):
        exporter.export_public_key(public_der + b"\x00")


def test_safe_reader_rejects_symlink(tmp_path: Path) -> None:
    der, _ = _ed25519_der()
    target = tmp_path / "public.der"
    target.write_bytes(der)
    link = tmp_path / "linked.der"
    link.symlink_to(target)

    with pytest.raises(exporter.PublicKeyExportError, match="non-symlink"):
        exporter._read_regular_der(link)
