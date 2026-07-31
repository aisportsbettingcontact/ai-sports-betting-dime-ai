#!/usr/bin/env python3
"""Freeze incremental aggregate-only cumulative Foundation evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dime_ai.foundation_cumulative_evidence import freeze_cumulative_evidence
from dime_ai.foundation_execution_evidence import FoundationExecutionEvidenceError


def _mapping(values: list[str], label: str) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        identity, separator, raw_path = value.partition("=")
        if not separator or not identity or identity in result or not raw_path:
            raise FoundationExecutionEvidenceError(f"{label} mapping is malformed")
        result[identity] = Path(raw_path)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--boundary-manifest", type=Path, required=True)
    parser.add_argument("--boundary-manifest-sha256", required=True)
    parser.add_argument("--prior-artifact-root", action="append", default=[])
    parser.add_argument("--prior-source-packet-root", action="append", default=[])
    parser.add_argument("--delta-artifact-root", type=Path, required=True)
    parser.add_argument("--delta-source-packet-root", type=Path, required=True)
    parser.add_argument("--quarantine-root", action="append", default=[])
    parser.add_argument("--semantic-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--created-at", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = freeze_cumulative_evidence(
        boundary_manifest_path=args.boundary_manifest,
        expected_boundary_manifest_sha256=args.boundary_manifest_sha256,
        prior_artifact_roots=_mapping(
            args.prior_artifact_root,
            "prior artifact root",
        ),
        prior_source_packet_roots=_mapping(
            args.prior_source_packet_root,
            "prior source-packet root",
        ),
        delta_artifact_root=args.delta_artifact_root,
        delta_source_packet_root=args.delta_source_packet_root,
        quarantine_roots=_mapping(args.quarantine_root, "quarantine root"),
        semantic_root=args.semantic_root,
        output_root=args.output_root,
        created_at=args.created_at,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FoundationExecutionEvidenceError as exc:
        raise SystemExit(f"FOUNDATION CUMULATIVE EVIDENCE BLOCKED: {exc}") from exc
