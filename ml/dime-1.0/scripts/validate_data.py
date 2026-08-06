#!/usr/bin/env python
"""Validate training/evaluation assets before GPU work."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dime_ai.data_validation import (
    DataValidationError,
    partition_keys,
    read_jsonl,
    validate_eval_case,
    validate_public_repository_data,
    validate_sft_record,
    validate_unique_ids,
)
from dime_ai.foundation_contracts import load_foundation_contracts
from dime_ai.platform_knowledge import load_platform_knowledge


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def main() -> None:
    supplied_project = parse_args().project_dir
    foundation_contracts = load_foundation_contracts(project_root=supplied_project)
    project = supplied_project.absolute().resolve(strict=True)
    print(f"Foundation contracts: {len(foundation_contracts.contracts)}")
    print(f"Foundation contract bundle SHA-256: {foundation_contracts.bundle_sha256}")
    print("FOUNDATION CONTRACTS VALIDATED")

    platform_knowledge = load_platform_knowledge(project_root=supplied_project)
    print(
        "Platform knowledge: "
        f"{platform_knowledge.document['knowledge_version']} / "
        f"{len(platform_knowledge.document['features'])} features"
    )
    print(f"Platform knowledge SHA-256: {platform_knowledge.sha256}")
    print("PLATFORM KNOWLEDGE VALIDATED")

    train_path = project / "data/sft/train.sample.jsonl"
    validation_path = project / "data/sft/validation.sample.jsonl"
    eval_paths = sorted((project / "data/eval").glob("*.jsonl"))

    train = read_jsonl(train_path)
    validation = read_jsonl(validation_path)
    evaluations = [record for path in eval_paths for record in read_jsonl(path)]

    for record in [*train, *validation]:
        validate_sft_record(record)
    for case in evaluations:
        validate_eval_case(case)

    validate_unique_ids([*train, *validation], "example_id")
    validate_unique_ids(evaluations, "case_id")

    train_keys = set().union(*(partition_keys(record) for record in train))
    validation_keys = set().union(*(partition_keys(record) for record in validation))
    leakage = train_keys & validation_keys
    if leakage:
        raise DataValidationError(f"SFT train/validation partition leakage: {sorted(leakage)}")

    tool_names = {
        tool["function"]["name"]
        for tool in json.loads((project / "tools/tools.v1.json").read_text())
    }
    referenced_tools: set[str] = set()
    for case in evaluations:
        referenced_tools.update(case["allowed_tools"])
        referenced_tools.update(case["forbidden_tools"])
    unknown_tools = referenced_tools - tool_names
    if unknown_tools:
        raise DataValidationError(f"Evaluation references unknown tools: {sorted(unknown_tools)}")

    public_boundary = validate_public_repository_data(project)

    print(f"SFT train records: {len(train)}")
    print(f"SFT validation records: {len(validation)}")
    print(f"Evaluation records: {len(evaluations)}")
    print(f"Evaluation files: {len(eval_paths)}")
    print(f"Registered tools: {len(tool_names)}")
    print(
        "Public repository boundary: "
        f"{public_boundary['sample_files']} sample files / "
        f"{public_boundary['sample_records']} sample records / "
        f"{public_boundary['non_sample_files']} non-sample files"
    )
    print("DATA VALIDATION PASSED")


if __name__ == "__main__":
    main()
