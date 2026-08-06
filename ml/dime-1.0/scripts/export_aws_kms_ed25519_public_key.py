#!/usr/bin/env python3
"""Convert an AWS KMS SPKI DER public key to Dime's raw Ed25519 key record."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import stat
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

MAX_DER_BYTES = 4096


class PublicKeyExportError(ValueError):
    """Raised when an input is not one canonical Ed25519 SPKI public key."""


def _read_regular_der(path: str | Path) -> bytes:
    candidate = Path(path).absolute()
    if candidate.is_symlink():
        raise PublicKeyExportError("input must be a non-symlink regular file")
    try:
        metadata = candidate.stat()
    except OSError as exc:
        raise PublicKeyExportError("input public-key file is unavailable") from exc
    if not stat.S_ISREG(metadata.st_mode) or not 1 <= metadata.st_size <= MAX_DER_BYTES:
        raise PublicKeyExportError("input must be a bounded regular file")

    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
    descriptor: int | None = None
    try:
        descriptor = os.open(candidate, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_dev != metadata.st_dev
            or opened.st_ino != metadata.st_ino
            or not 1 <= opened.st_size <= MAX_DER_BYTES
        ):
            raise PublicKeyExportError("input public-key identity changed during validation")
        chunks: list[bytes] = []
        remaining = opened.st_size
        while remaining:
            chunk = os.read(descriptor, min(remaining, 4096))
            if not chunk:
                raise PublicKeyExportError("input public-key file ended unexpectedly")
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            raise PublicKeyExportError("input public-key file grew during validation")
        return b"".join(chunks)
    except PublicKeyExportError:
        raise
    except OSError as exc:
        raise PublicKeyExportError("input public-key file could not be read safely") from exc
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass


def export_public_key(der: bytes) -> dict[str, Any]:
    """Return Dime's public-only record for one canonical Ed25519 SPKI value."""

    if (
        not isinstance(der, bytes)
        or not 1 <= len(der) <= MAX_DER_BYTES
        or b"-----BEGIN" in der
        or b"PRIVATE KEY" in der
    ):
        raise PublicKeyExportError("input must be DER-encoded public-key material")
    try:
        public_key = serialization.load_der_public_key(der)
    except (TypeError, ValueError) as exc:
        raise PublicKeyExportError("input is not a valid SPKI DER public key") from exc
    if not isinstance(public_key, Ed25519PublicKey):
        raise PublicKeyExportError("input public key must use Ed25519")
    canonical_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    if canonical_der != der:
        raise PublicKeyExportError("input is not one canonical SPKI DER value")
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    if len(raw) != 32:
        raise PublicKeyExportError("Ed25519 public key must be exactly 32 bytes")
    return {
        "algorithm": "ed25519",
        "encoding": "raw-base64",
        "public_key_base64": base64.b64encode(raw).decode("ascii"),
        "public_key_sha256": hashlib.sha256(raw).hexdigest(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert a public AWS KMS GetPublicKey SPKI DER file to Dime's raw Ed25519 "
            "public-key record. This command never contacts AWS."
        )
    )
    parser.add_argument("--spki-der", required=True, help="Path to the public SPKI DER file")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    record = export_public_key(_read_regular_der(args.spki_der))
    print(json.dumps(record, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
