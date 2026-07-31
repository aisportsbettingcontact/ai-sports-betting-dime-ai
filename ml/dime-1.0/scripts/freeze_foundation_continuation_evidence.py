#!/usr/bin/env python3
"""Freeze sanitized aggregate evidence for the combined Foundation live-data route."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dime_ai.foundation_execution_evidence import (
    FoundationExecutionEvidenceError,
    freeze_continuation_evidence,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--first-root", type=Path, required=True)
    parser.add_argument("--first-source-packet-root", type=Path, required=True)
    parser.add_argument("--second-root", type=Path, required=True)
    parser.add_argument("--second-source-packet-root", type=Path, required=True)
    parser.add_argument("--semantic-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--base-commit", required=True)
    parser.add_argument("--corrective-commit", required=True)
    parser.add_argument("--created-at", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = freeze_continuation_evidence(
        first_root=args.first_root,
        first_source_packet_root=args.first_source_packet_root,
        second_root=args.second_root,
        second_source_packet_root=args.second_source_packet_root,
        semantic_root=args.semantic_root,
        output_root=args.output_root,
        base_commit=args.base_commit,
        corrective_commit=args.corrective_commit,
        created_at=args.created_at,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FoundationExecutionEvidenceError as exc:
        raise SystemExit(f"FOUNDATION CONTINUATION EVIDENCE BLOCKED: {exc}") from exc
