#!/usr/bin/env python
"""Validate every governed JSON artifact with duplicate-key rejection."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dime_ai.governed_json import GovernedJsonError, scan_governed_json

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--project-root",
        type=Path,
        default=PROJECT_ROOT,
        help="Dime ML project root containing configs/, schemas/, and evidence/.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        report = scan_governed_json(args.project_root)
    except (GovernedJsonError, OSError) as exc:
        print(
            json.dumps(
                {
                    "schema_version": "dime-governed-json-scan-v1",
                    "pass": False,
                    "file_count": 0,
                    "issue_count": 1,
                    "paths": [],
                    "issues": [{"path": "<inventory>", "error": str(exc)}],
                },
                indent=2,
                sort_keys=True,
            )
        )
        sys.exit(2)

    print(json.dumps(report.as_dict(), indent=2, sort_keys=True))
    if not report.passed:
        sys.exit(2)


if __name__ == "__main__":
    main()
