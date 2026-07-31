#!/usr/bin/env python3
"""Freeze sanitized Foundation execution and semantic comparison evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dime_ai.foundation_execution_evidence import (
    FoundationExecutionEvidenceError,
    freeze_public_evidence,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot-root", type=Path, required=True)
    parser.add_argument("--pilot-source-packet-root", type=Path, required=True)
    parser.add_argument("--accepted-root", type=Path, required=True)
    parser.add_argument("--accepted-source-packet-root", type=Path, required=True)
    parser.add_argument("--semantic-root", type=Path, required=True)
    parser.add_argument("--comparison-root", type=Path, required=True)
    parser.add_argument("--recovery-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--base-commit", required=True)
    parser.add_argument("--created-at", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = freeze_public_evidence(
        pilot_root=args.pilot_root,
        pilot_source_packet_root=args.pilot_source_packet_root,
        accepted_root=args.accepted_root,
        accepted_source_packet_root=args.accepted_source_packet_root,
        semantic_root=args.semantic_root,
        comparison_root=args.comparison_root,
        recovery_root=args.recovery_root,
        output_root=args.output_root,
        base_commit=args.base_commit,
        created_at=args.created_at,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FoundationExecutionEvidenceError as exc:
        raise SystemExit(f"FOUNDATION EXECUTION EVIDENCE BLOCKED: {exc}") from exc
