#!/usr/bin/env python
"""Run deterministic first-pass evaluation over generated JSONL traces."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from dime_ai.data_validation import read_jsonl, validate_eval_case
from dime_ai.eval_rules import score_trace


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", type=Path, required=True)
    parser.add_argument(
        "--cases",
        type=Path,
        default=Path("data/eval/dev.sample.jsonl"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("artifacts/reports/eval-report.json"),
    )
    parser.add_argument("--human-reviews", type=Path)
    parser.add_argument(
        "--control",
        action="store_true",
        help="Record a knowingly failing/partial control without a nonzero exit status.",
    )
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    args = parse_args()
    case_records = read_jsonl(args.cases)
    for case in case_records:
        validate_eval_case(case, production=not args.control)
    cases = {case["case_id"]: case for case in case_records}
    traces = read_jsonl(args.outputs)
    reviews = {}
    if args.human_reviews:
        for review in read_jsonl(args.human_reviews):
            case_id = review.get("case_id")
            if not isinstance(case_id, str) or not case_id:
                raise SystemExit("Every human review requires case_id.")
            if case_id in reviews:
                raise SystemExit(f"Duplicate human review for {case_id}.")
            required = {"approved", "reviewer", "reviewed_at_utc", "notes"}
            if required - review.keys():
                raise SystemExit(f"Human review for {case_id} is incomplete.")
            reviews[case_id] = review

    results = []
    unknown_case_ids = []
    seen_trace_ids = set()
    duplicate_trace_ids = []
    for trace in traces:
        case_id = trace.get("case_id")
        if case_id in seen_trace_ids:
            duplicate_trace_ids.append(case_id)
            continue
        seen_trace_ids.add(case_id)
        case = cases.get(case_id)
        if case is None:
            unknown_case_ids.append(case_id)
            continue
        result = score_trace(case, trace)
        review = reviews.get(case_id)
        human_review_pass = not result["needs_human_review"] or bool(
            review and review.get("approved") is True
        )
        result["human_review_pass"] = human_review_pass
        result["case_pass"] = result["deterministic_pass"] and human_review_pass
        results.append(result)

    expected_ids = set(cases)
    scored_ids = {result["case_id"] for result in results}
    missing_case_ids = sorted(expected_ids - scored_ids)
    exact_coverage = not missing_case_ids and not unknown_case_ids and not duplicate_trace_ids
    critical_failures = [
        result["case_id"]
        for result in results
        if result["severity"] == "critical" and not result["case_pass"]
    ]
    release_gate_pass = (
        exact_coverage and not critical_failures and all(result["case_pass"] for result in results)
    )
    summary = {
        "release_gate_pass": release_gate_pass,
        "control_mode": args.control,
        "expected_cases": len(cases),
        "cases_scored": len(results),
        "tool_route_passes": sum(item["tool_route_pass"] for item in results),
        "tool_argument_passes": sum(item["tool_argument_pass"] for item in results),
        "numeric_passes": sum(item["numeric_pass"] for item in results),
        "policy_action_passes": sum(item["policy_action_pass"] for item in results),
        "deterministic_passes": sum(item["deterministic_pass"] for item in results),
        "case_passes": sum(item["case_pass"] for item in results),
        "json_serializable_passes": sum(item["json_serializable"] for item in results),
        "cases_requiring_human_review": sum(item["needs_human_review"] for item in results),
        "missing_case_ids": missing_case_ids,
        "unknown_case_ids": unknown_case_ids,
        "duplicate_trace_ids": duplicate_trace_ids,
        "critical_failures": critical_failures,
        "note": (
            "Literal concept and prose-number checks are conservative triage. "
            "Human-reviewed facts, evidence fidelity, privacy, and safety remain required."
        ),
    }
    report = {
        "report_version": "dime-eval-report-v1",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "inputs": {
            "cases_sha256": file_sha256(args.cases),
            "outputs_sha256": file_sha256(args.outputs),
            "human_reviews_sha256": (
                file_sha256(args.human_reviews) if args.human_reviews else None
            ),
        },
        "summary": summary,
        "results": results,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(summary, indent=2))
    print(f"Report written to {args.report}")
    if not release_gate_pass and not args.control:
        sys.exit(2)


if __name__ == "__main__":
    main()
