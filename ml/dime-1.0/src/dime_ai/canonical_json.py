"""Canonical JSON encoding shared by governed Dime evidence."""

from __future__ import annotations

import json
from typing import Any


def canonical_json_bytes(value: Any) -> bytes:
    """Encode one value using the Dime canonical JSON v1 byte contract."""

    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")
