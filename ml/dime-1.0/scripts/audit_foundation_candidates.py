#!/usr/bin/env python
"""Audit private Foundation v1 candidates without publishing or training."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dime_ai.foundation_dataset import (
    PROJECT_ROOT,
    FoundationDatasetError,
    audit_foundation_candidates,
    canonical_json_bytes,
    validate_private_workspace_paths,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the governed CPU-only Foundation v1 candidate audit. "
            "Every shard argument may be supplied more than once."
        )
    )
    parser.add_argument("--train", action="append", required=True, type=Path)
    parser.add_argument("--validation", action="append", required=True, type=Path)
    parser.add_argument("--development-eval", action="append", required=True, type=Path)
    parser.add_argument("--development-eval-identity", required=True, type=Path)
    parser.add_argument("--development-eval-manifest", required=True, type=Path)
    parser.add_argument("--source-artifact-root", required=True, type=Path)
    parser.add_argument("--source-registry", required=True, type=Path)
    parser.add_argument("--review-ledger", required=True, type=Path)
    parser.add_argument(
        "--generated-at-utc",
        required=True,
        help="Normalized UTC timestamp intentionally bound into the immutable audit.",
    )
    parser.add_argument("--report", required=True, type=Path)
    return parser.parse_args()


def write_new_report(
    path: Path,
    content: bytes,
    *,
    project_root: Path = PROJECT_ROOT,
) -> None:
    validate_private_workspace_paths(
        project_root=project_root,
        destinations=(("candidate audit report destination", path),),
    )
    if path.exists() or path.is_symlink():
        raise FoundationDatasetError(f"audit report destination already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(content)
            handle.flush()
    except FileExistsError as exc:
        raise FoundationDatasetError(f"audit report destination already exists: {path}") from exc


def main() -> None:
    args = parse_args()
    try:
        validate_private_workspace_paths(
            project_root=PROJECT_ROOT,
            destinations=(("candidate audit report destination", args.report),),
        )
        result = audit_foundation_candidates(
            train_paths=args.train,
            validation_paths=args.validation,
            source_artifact_root=args.source_artifact_root,
            source_registry_path=args.source_registry,
            review_ledger_path=args.review_ledger,
            development_eval_paths=args.development_eval,
            development_eval_identity_path=args.development_eval_identity,
            development_eval_manifest_path=args.development_eval_manifest,
            generated_at_utc=args.generated_at_utc,
            hf_token=os.environ.get("HF_TOKEN", ""),
        )
        write_new_report(args.report, canonical_json_bytes(result.report))
    except FoundationDatasetError as exc:
        raise SystemExit(f"FOUNDATION CANDIDATE AUDIT ERROR: {exc}") from exc

    print(f"Candidate audit report: {args.report}")
    print(
        "Records: "
        f"{result.report['records']['train']} train / "
        f"{result.report['records']['validation']} validation"
    )
    if not result.report["pass"]:
        print("FOUNDATION CANDIDATE AUDIT FAILED", file=sys.stderr)
        for issue in result.report["issues"][:20]:
            print(f"- {issue}", file=sys.stderr)
        raise SystemExit(2)
    print("FOUNDATION CANDIDATE AUDIT PASSED")


if __name__ == "__main__":
    main()
