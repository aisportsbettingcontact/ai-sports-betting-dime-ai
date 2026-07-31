from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "finalize_foundation_live_data_shard.py"
SPEC = importlib.util.spec_from_file_location("dime_live_data_finalizer", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
FINALIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FINALIZER)


def inventories() -> tuple[set[str], dict[str, set[str]], dict[str, dict]]:
    repair_ids = {f"dime-foundation-v1-live-data-{index:03d}-fixture" for index in range(11, 111)}
    carried = {}
    decisions = {}
    for index, record_id in zip(range(11, 111), sorted(repair_ids), strict=True):
        finding_ids = {f"live-data-{index:03d}-ungrounded-tool-arguments"}
        if 31 <= index <= 40:
            finding_ids.add(f"live-data-{index:03d}-stale-window-claim-unsupported")
        carried[record_id] = finding_ids
        decisions[record_id] = {
            "decision": "approved",
            "unresolved_material_findings": 0,
            "deterministic_validation_passed": True,
            "findings": [
                {"finding_id": finding_id, "resolved": True} for finding_id in sorted(finding_ids)
            ],
        }
    return repair_ids, carried, decisions


def selected_review_inventory() -> tuple[dict[str, dict], dict[str, dict]]:
    drafts = {}
    decisions = {}
    for index in range(1, 151):
        record_id = f"dime-foundation-v1-live-data-{index:03d}-fixture"
        draft_sha256 = f"{index:064x}"
        drafts[record_id] = {
            "record_id": record_id,
            "draft_sha256": draft_sha256,
        }
        decisions[record_id] = {
            "record_id": record_id,
            "draft_sha256": draft_sha256,
            "decision": "approved",
            "unresolved_material_findings": 0,
            "deterministic_validation_passed": True,
            "findings": [],
        }
    return drafts, decisions


def test_final_composition_blocks_missing_repair_decisions() -> None:
    repair_ids, carried, _ = inventories()

    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="exactly 100 decisions",
    ):
        FINALIZER.required_repair_decision_gate(repair_ids, {}, carried)


def test_final_composition_blocks_nonapproval_or_unresolved_finding() -> None:
    repair_ids, carried, decisions = inventories()
    first = sorted(decisions)[0]
    decisions[first]["decision"] = "changes_requested"

    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="not an exact approval",
    ):
        FINALIZER.required_repair_decision_gate(repair_ids, decisions, carried)

    decisions[first]["decision"] = "approved"
    decisions[first]["findings"][0]["resolved"] = False
    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="not an exact approval",
    ):
        FINALIZER.required_repair_decision_gate(repair_ids, decisions, carried)


def test_final_composition_accepts_exact_100_approvals_and_110_closures() -> None:
    repair_ids, carried, decisions = inventories()

    FINALIZER.required_repair_decision_gate(repair_ids, decisions, carried)


def test_final_composition_blocks_missing_second_review_decisions() -> None:
    drafts, decisions = selected_review_inventory()
    decisions.pop(next(iter(decisions)))

    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="exactly 150 decisions",
    ):
        FINALIZER.required_second_review_gate(drafts, decisions)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("decision", "changes_requested"),
        ("unresolved_material_findings", 1),
        ("deterministic_validation_passed", False),
        ("draft_sha256", "f" * 64),
    ],
)
def test_final_composition_blocks_nonapproval_in_second_review(
    field: str,
    value: object,
) -> None:
    drafts, decisions = selected_review_inventory()
    decisions[sorted(decisions)[0]][field] = value

    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="second review is not an exact approval",
    ):
        FINALIZER.required_second_review_gate(drafts, decisions)


def test_final_composition_blocks_unresolved_second_review_finding() -> None:
    drafts, decisions = selected_review_inventory()
    decisions[sorted(decisions)[0]]["findings"] = [
        {"finding_id": "second-review-001", "resolved": False}
    ]

    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="second review is not an exact approval",
    ):
        FINALIZER.required_second_review_gate(drafts, decisions)


def test_final_composition_accepts_exact_150_second_review_approvals() -> None:
    drafts, decisions = selected_review_inventory()

    FINALIZER.required_second_review_gate(drafts, decisions)


def test_second_review_checksum_inventory_must_cover_every_file(tmp_path: Path) -> None:
    reviewed = tmp_path / "reviewed.json"
    reviewed.write_text('{"status":"PASS"}\n', encoding="utf-8")
    checksum = FINALIZER.sha256_file(reviewed)
    (tmp_path / "SHA256SUMS").write_text(
        f"{checksum}  reviewed.json\n",
        encoding="utf-8",
    )

    assert FINALIZER._verify_sha256sums(tmp_path) == 1

    (tmp_path / "omitted.json").write_text("{}\n", encoding="utf-8")
    with pytest.raises(
        FINALIZER.LiveDataFinalizationError,
        match="checksum inventory is not exhaustive",
    ):
        FINALIZER._verify_sha256sums(tmp_path)
