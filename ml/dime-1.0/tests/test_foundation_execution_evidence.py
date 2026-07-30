from __future__ import annotations

import os
from pathlib import Path

import pytest

from dime_ai.foundation_execution_evidence import (
    FoundationExecutionEvidenceError,
    route_deficits,
    secure_inventory,
)


def _release_plan() -> dict:
    return {
        "route_mixture": {
            "platform": {"total": 2, "train": 1, "validation": 1},
            "live_data": {"total": 3, "train": 2, "validation": 1},
        }
    }


def test_route_deficits_use_only_admitted_records() -> None:
    records = [
        {"route": "live_data", "split": "train"},
        {"route": "live_data", "split": "validation"},
    ]

    result = route_deficits(records, release_plan=_release_plan())

    assert result["calculation_basis"] == "ADMITTED_RECORDS_ONLY"
    assert result["target_records"] == 5
    assert result["admitted_records"] == 2
    assert result["remaining_records"] == 3
    assert result["routes"]["platform"]["deficit"] == {
        "total": 2,
        "train": 1,
        "validation": 1,
    }
    assert result["routes"]["live_data"]["deficit"] == {
        "total": 1,
        "train": 1,
        "validation": 0,
    }


def test_secure_inventory_is_closed_and_rejects_symlinks(tmp_path: Path) -> None:
    root = tmp_path / "private"
    root.mkdir(mode=0o700)
    payload = root / "payload.json"
    payload.write_text("{}\n", encoding="utf-8")
    payload.chmod(0o600)
    checksum = __import__("hashlib").sha256(payload.read_bytes()).hexdigest()
    sums = root / "SHA256SUMS"
    sums.write_text(f"{checksum}  payload.json\n", encoding="utf-8")
    sums.chmod(0o600)

    assert secure_inventory(root, "test")["closed_inventory"] is True

    link = root / "link.json"
    os.symlink(payload, link)
    with pytest.raises(FoundationExecutionEvidenceError, match="symlink"):
        secure_inventory(root, "test")
