#!/usr/bin/env python3
"""Emit a sanitized static audit of evaluation answer-key governance v1."""

from __future__ import annotations

import json
import sys

from dime_ai.evaluation_answer_key_governance import governance_audit


def main() -> int:
    report = governance_audit()
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
