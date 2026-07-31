from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest

from dime_ai import foundation_execution_evidence
from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_execution_evidence import (
    FoundationExecutionEvidenceError,
    _manifest_records,
    _source_packets,
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
    checksum = hashlib.sha256(payload.read_bytes()).hexdigest()
    sums = root / "SHA256SUMS"
    sums.write_text(f"{checksum}  payload.json\n", encoding="utf-8")
    sums.chmod(0o600)

    inventory = secure_inventory(root, "test")
    assert inventory["closed_inventory"] is True
    assert inventory["payload_file_count"] == 1
    assert inventory["checksum_ledger_file_count"] == 1
    assert inventory["total_file_count"] == 2
    assert inventory["total_byte_count"] == (
        inventory["payload_byte_count"] + inventory["checksum_ledger_byte_count"]
    )

    link = root / "link.json"
    os.symlink(payload, link)
    with pytest.raises(FoundationExecutionEvidenceError, match="symlink"):
        secure_inventory(root, "test")


def test_manifest_record_path_cannot_escape_private_root(tmp_path: Path) -> None:
    root = tmp_path / "private"
    root.mkdir(mode=0o700)
    outside = tmp_path / "outside.jsonl"
    outside.write_bytes(canonical_json_bytes({"record_id": "outside"}))
    outside.chmod(0o600)
    manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "status": "ACCEPTED_PRIVATE_NOT_RELEASED",
        "record_count": 1,
        "entries": [
            {
                "path": "../outside.jsonl",
                "records": 1,
                "sha256": hashlib.sha256(outside.read_bytes()).hexdigest(),
            }
        ],
    }
    manifest_path = root / "authoring-manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest))
    manifest_path.chmod(0o600)

    with pytest.raises(FoundationExecutionEvidenceError, match="path is unsafe"):
        _manifest_records(
            root,
            "authoring-manifest.json",
            "ACCEPTED_PRIVATE_NOT_RELEASED",
        )


def test_source_packet_inventory_detects_mid_read_mutation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "source-packets"
    root.mkdir(mode=0o700)
    packet_path = root / "packet.json"
    packet_path.write_bytes(canonical_json_bytes({"packet_id": "packet-1"}))
    packet_path.chmod(0o600)
    original_loader = foundation_execution_evidence._load_object

    def mutating_loader(path: Path, label: str) -> dict:
        packet = original_loader(path, label)
        path.write_bytes(canonical_json_bytes({"packet_id": "packet-2"}))
        path.chmod(0o600)
        return packet

    monkeypatch.setattr(foundation_execution_evidence, "_load_object", mutating_loader)
    monkeypatch.setattr(foundation_execution_evidence, "validate_source_packet", lambda _: [])
    monkeypatch.setattr(
        foundation_execution_evidence,
        "source_packet_is_releasable",
        lambda _: None,
    )

    with pytest.raises(FoundationExecutionEvidenceError, match="changed during"):
        _source_packets(root, "test_source_packets")
