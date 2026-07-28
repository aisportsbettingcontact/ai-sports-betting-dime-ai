#!/usr/bin/env python3
"""Prepare an inactive reviewer-registry candidate from a private public-only bundle."""

from __future__ import annotations

import argparse

from dime_ai.agent_identity_provisioning import (
    AgentIdentityProvisioningError,
    write_candidate_registry,
    write_provisioning_challenges,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Verify public AI-reviewer identity inputs and write an inactive candidate registry. "
            "The bundle must be outside the Git worktree and must never contain private keys."
        )
    )
    parser.add_argument(
        "--bundle-dir",
        required=True,
        help="Private directory containing provisioning.json and its public policy artifacts.",
    )
    parser.add_argument(
        "--output-name",
        default="candidate-reviewer-registry.json",
        help="New flat filename written inside the bundle directory.",
    )
    parser.add_argument(
        "--emit-challenges",
        action="store_true",
        help=(
            "Write the exact public challenge bytes for the two external signers. "
            "Possession-proof signatures may still be null in this mode."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.emit_challenges:
            outputs = write_provisioning_challenges(args.bundle_dir)
            for reviewer_id, (output, digest) in sorted(outputs.items()):
                print(f"{reviewer_id}: {output.name} {digest}")
            print("Private signing keys: NOT CREATED, IMPORTED, OR EXPOSED")
            print("AI REVIEWER PROVISIONING CHALLENGES PASSED")
            return 0
        output, digest = write_candidate_registry(
            args.bundle_dir,
            output_name=args.output_name,
        )
    except AgentIdentityProvisioningError as exc:
        print(f"AI REVIEWER PROVISIONING FAILED: {exc}")
        return 1
    print(f"Candidate file: {output.name}")
    print(f"Candidate SHA-256: {digest}")
    print("Reviewer authority: INACTIVE")
    print("Training/publication/serving/provider authorization: UNCHANGED AND BLOCKED")
    print("AI REVIEWER PROVISIONING CANDIDATE PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
