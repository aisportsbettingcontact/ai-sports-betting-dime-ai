#!/usr/bin/env python
"""Validate and identify the exact Dime platform-knowledge contract."""

from __future__ import annotations

import argparse
from pathlib import Path

from dime_ai.platform_knowledge import load_platform_knowledge


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--repository-root", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    loaded = load_platform_knowledge(
        args.project_dir,
        repository_root=args.repository_root,
    )
    print(f"Platform knowledge version: {loaded.document['knowledge_version']}")
    print(f"Platform features: {len(loaded.document['features'])}")
    print(f"Platform knowledge SHA-256: {loaded.sha256}")
    print("PLATFORM KNOWLEDGE VALIDATION PASSED")


if __name__ == "__main__":
    main()
