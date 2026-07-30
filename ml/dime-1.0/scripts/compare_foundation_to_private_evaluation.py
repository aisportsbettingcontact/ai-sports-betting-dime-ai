#!/usr/bin/env python3
"""Compare accepted Foundation trainer material with authoritative semantic r5."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from dime_ai.foundation_private_evaluation_comparison import (
    FoundationEvaluationComparisonError,
    execute_comparison,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--accepted-root", type=Path, required=True)
    parser.add_argument("--semantic-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--comparison-id", required=True)
    parser.add_argument(
        "--created-at",
        default=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report, bindings = execute_comparison(
        accepted_root=args.accepted_root,
        semantic_root=args.semantic_root,
        output_root=args.output_root,
        comparison_id=args.comparison_id,
        created_at=args.created_at,
    )
    result = {
        "comparison_id": report["comparison_id"],
        "status": report["status"],
        "summary": report["summary"],
        "bindings": bindings,
        "publication_authorized": False,
        "external_operations": report["external_operations"],
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS_ZERO_DISALLOWED_OVERLAP" else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FoundationEvaluationComparisonError as error:
        raise SystemExit(f"FOUNDATION SEMANTIC COMPARISON BLOCKED: {error}") from error
