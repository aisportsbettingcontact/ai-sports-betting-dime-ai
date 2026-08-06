#!/usr/bin/env python3
"""Generate or verify the ignored private Dime evaluation semantic suites."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dime_ai.private_evaluation_semantics import (
    ML_ROOT,
    PrivateEvaluationError,
    verify_private_release,
    write_private_release,
)

PRIVATE_ROOT = ML_ROOT / "data" / "private"


def _private_output(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    private_root = PRIVATE_ROOT.resolve()
    if not path.is_relative_to(private_root) or path == private_root:
        raise argparse.ArgumentTypeError(
            f"output must be a child of the ignored private boundary: {private_root}"
        )
    return path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    generate = subparsers.add_parser("generate")
    generate.add_argument("--output", required=True, type=_private_output)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--output", required=True, type=_private_output)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "generate":
            manifest = write_private_release(args.output)
            result = {
                "status": "PASS",
                "operation": "private_semantic_generation",
                "record_count": manifest["record_count"],
                "layer_counts": manifest["layer_counts"],
                "contains_answer_keys": manifest["contains_answer_keys"],
                "publication_authorized": manifest["publication_authorized"],
                "release_non_overlap_proof_complete": manifest[
                    "release_non_overlap_proof_complete"
                ],
                "release_blocker": manifest["release_blocker"],
            }
        else:
            result = {
                "status": "PASS",
                "operation": "private_semantic_verification",
                **verify_private_release(args.output),
            }
    except PrivateEvaluationError as exc:
        raise SystemExit(f"private semantic evaluation gate failed: {exc}") from exc
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
