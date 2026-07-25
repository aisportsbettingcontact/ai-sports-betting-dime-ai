#!/usr/bin/env python
"""Audit SFT coverage against the frozen Dime curriculum."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from dime_ai.data_validation import read_jsonl, validate_sft_record
from dime_ai.program_audit import audit_curriculum


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("configs/curriculum_v1.yaml"),
    )
    parser.add_argument(
        "--train",
        type=Path,
        default=Path("data/sft/train.sample.jsonl"),
    )
    parser.add_argument(
        "--validation",
        type=Path,
        default=Path("data/sft/validation.sample.jsonl"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("artifacts/reports/curriculum-audit.json"),
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Require production lineage/review fields and exit nonzero on quota gaps.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = yaml.safe_load(args.config.read_text())
    train = read_jsonl(args.train)
    validation = read_jsonl(args.validation)
    for record in [*train, *validation]:
        validate_sft_record(record, production=args.strict)
    report = audit_curriculum(train, validation, config)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2))
    print(f"Report written to {args.report}")
    if args.strict and not report["pass"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
