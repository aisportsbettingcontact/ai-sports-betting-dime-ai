#!/usr/bin/env python
"""Audit a governed evaluation bank against Dime's frozen program."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from dime_ai.data_validation import read_jsonl, validate_eval_case, validate_unique_ids
from dime_ai.program_audit import audit_evaluation_program


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("configs/evaluation_program_v1.yaml"),
    )
    parser.add_argument(
        "--cases",
        type=Path,
        nargs="+",
        default=[
            Path("data/eval/dev.sample.jsonl"),
            Path("data/eval/safety_red_team.sample.jsonl"),
            Path("data/eval/platform_grounding_v1.sample.jsonl"),
        ],
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("artifacts/reports/evaluation-program-audit.json"),
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Require production split/suite/tags and exit nonzero on program gaps.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = yaml.safe_load(args.config.read_text())
    records = []
    for path in args.cases:
        records.extend(read_jsonl(path))
    validate_unique_ids(records, "case_id")
    for record in records:
        validate_eval_case(record, production=args.strict)
    report = audit_evaluation_program(records, config)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2))
    print(f"Report written to {args.report}")
    if args.strict and not report["pass"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
