#!/usr/bin/env python3
"""Print a sanitized, static RunPod Gate 1 readiness audit."""

from __future__ import annotations

import json
import sys

from dime_ai.runpod_gate_1 import static_audit


def main() -> int:
    report = static_audit()
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
