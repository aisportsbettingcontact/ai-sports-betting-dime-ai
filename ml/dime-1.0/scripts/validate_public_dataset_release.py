#!/usr/bin/env python3
"""Validate the complete owner-authorized public dataset release."""

from __future__ import annotations

import json

from dime_ai.public_dataset_release import (
    PublicDatasetReleaseError,
    validate_public_dataset_release,
)


def main() -> int:
    print(json.dumps(validate_public_dataset_release(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PublicDatasetReleaseError as exc:
        raise SystemExit(f"PUBLIC DATASET RELEASE BLOCKED: {exc}") from exc
