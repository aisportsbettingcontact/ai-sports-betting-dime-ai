#!/usr/bin/env python3
"""Validate or emit inactive, sanitized RunPod reviewer endpoint plans."""

from __future__ import annotations

import argparse

from dime_ai.reviewer_runtime import (
    ReviewerRuntimeError,
    load_reviewer_runtime,
    write_sanitized_endpoint_plans,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate the inactive reviewer runtime or write two sanitized endpoint plans. "
            "This command never calls RunPod, reads secrets, or authorizes execution."
        )
    )
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument(
        "--check",
        action="store_true",
        help="Validate the governed runtime without writing files.",
    )
    action.add_argument(
        "--output-dir",
        help="Existing real directory outside the Git worktree for new mode-0600 plans.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.check:
            runtime = load_reviewer_runtime()
            print(f"Runtime contract SHA-256: {runtime.contract_sha256}")
            print("Reviewer authority: INACTIVE")
            print("Endpoint status: PLANNED AND UNPROVISIONED")
            print("Network/GPU/secret access: NOT USED")
            print("REVIEWER RUNTIME CONTRACT PASSED")
            return 0
        outputs = write_sanitized_endpoint_plans(args.output_dir)
    except ReviewerRuntimeError as exc:
        print(f"REVIEWER RUNTIME CONTRACT FAILED: {exc}")
        return 1
    for path, digest in outputs:
        print(f"{path.name}: {digest}")
    print("Reviewer authority: INACTIVE")
    print("Endpoint status: PLANNED AND UNPROVISIONED")
    print("Network/GPU/secret access: NOT USED")
    print("SANITIZED REVIEWER ENDPOINT PLANS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
