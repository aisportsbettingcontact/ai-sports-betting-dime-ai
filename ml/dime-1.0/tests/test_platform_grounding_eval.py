from __future__ import annotations

import json
from pathlib import Path

from dime_ai.data_validation import validate_eval_case
from dime_ai.platform_knowledge import load_platform_knowledge

PROJECT = Path(__file__).resolve().parents[1]
EVAL_PATH = PROJECT / "data/eval/platform_grounding_v1.sample.jsonl"


def load_cases() -> list[dict]:
    return [
        json.loads(line)
        for line in EVAL_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_platform_grounding_slice_is_exact_visible_synthetic_dev_data() -> None:
    cases = load_cases()

    assert len(cases) == 12
    assert len({case["case_id"] for case in cases}) == 12
    assert {case["split"] for case in cases} == {"dev"}
    assert {case["task_type"] for case in cases} == {"platform_grounding"}
    assert all(case["provenance"]["synthetic"] is True for case in cases)
    assert all(case["tool_fixtures"] == [] for case in cases)
    assert all(case["gold"]["required_tool_calls"] == [] for case in cases)
    for case in cases:
        validate_eval_case(case)


def test_platform_grounding_slice_covers_supported_and_unavailable_boundaries() -> None:
    cases = load_cases()
    concepts = " ".join(concept for case in cases for concept in case["gold"]["required_concepts"])
    facts = {
        (fact["name"], str(fact["value"]))
        for case in cases
        for fact in case["gold"].get("facts", [])
    }
    catalog_ids = {feature["id"] for feature in load_platform_knowledge().document["features"]}

    assert "provider-scoped sample" in concepts
    assert "Dime Chat does not currently receive" in concepts
    assert ("availability", "not_available") in facts
    assert {
        "dime_chat",
        "model_projections",
        "betting_splits_odds_history",
        "bet_tracker",
        "prop_projections",
    } <= catalog_ids


def test_platform_slice_is_wired_into_generation_and_program_audit() -> None:
    baseline_source = (PROJECT / "scripts/baseline_generate.py").read_text(encoding="utf-8")
    audit_source = (PROJECT / "scripts/audit_evaluation_program.py").read_text(encoding="utf-8")

    assert '"--cases"' in baseline_source
    assert "render_platform_knowledge" in baseline_source
    assert "platform_knowledge_sha256" in baseline_source
    assert "data/eval/platform_grounding_v1.sample.jsonl" in audit_source
