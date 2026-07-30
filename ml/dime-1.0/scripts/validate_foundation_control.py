#!/usr/bin/env python
"""Validate the non-authorizing Foundation and evaluation control plane."""

from __future__ import annotations

import json
import sys

from dime_ai.foundation_control import audit_foundation_control


def main() -> None:
    report = audit_foundation_control()
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["pass"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
