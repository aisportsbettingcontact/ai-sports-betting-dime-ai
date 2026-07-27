#!/usr/bin/env python
"""Create a governed private Foundation v1 snapshot without publishing it."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dime_ai.foundation_dataset import (
    FoundationDatasetError,
    freeze_foundation_snapshot,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Re-audit approved Foundation v1 candidates and atomically create "
            "the exact five-file private snapshot."
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
    parser.add_argument("--candidate-audit", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--dataset-card", required=True, type=Path)
    parser.add_argument("--external-audit-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        manifest = freeze_foundation_snapshot(
            train_paths=args.train,
            validation_paths=args.validation,
            source_artifact_root=args.source_artifact_root,
            source_registry_path=args.source_registry,
            review_ledger_path=args.review_ledger,
            development_eval_paths=args.development_eval,
            development_eval_identity_path=args.development_eval_identity,
            development_eval_manifest_path=args.development_eval_manifest,
            candidate_audit_path=args.candidate_audit,
            approval_path=args.approval,
            dataset_card_path=args.dataset_card,
            external_audit_dir=args.external_audit_dir,
            output_directory=args.output,
            hf_token=os.environ.get("HF_TOKEN", ""),
        )
    except FoundationDatasetError as exc:
        raise SystemExit(f"FOUNDATION DATASET FREEZE ERROR: {exc}") from exc

    print(f"Frozen snapshot: {args.output}")
    print(
        "Records: "
        f"{manifest['train_record_count']} train / "
        f"{manifest['validation_record_count']} validation"
    )
    print(f"Manifest schema: {manifest['schema_version']}")
    print("FOUNDATION DATASET FREEZE PASSED")
    print("No Hugging Face upload, training run, or serving change was performed.")


if __name__ == "__main__":
    main()
