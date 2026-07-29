from __future__ import annotations

import importlib
import shutil
from pathlib import Path

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
LOADER_PATH = PROJECT / "src/dime_ai/foundation_contracts.py"


def api():
    assert LOADER_PATH.is_file(), "Step 2 stage-profile contract loader is missing"
    return importlib.import_module("dime_ai.foundation_contracts")


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("configs", "schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def mutate_stage(project: Path, mutator) -> None:
    path = project / "configs/foundation_stage_profiles_v1.yaml"
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    mutator(document)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")


def profile(document, profile_id: str):
    return next(item for item in document["profiles"] if item["profile_id"] == profile_id)


def test_exact_four_profile_readiness_sequence_and_non_authorizing_envelope() -> None:
    document = api().load_foundation_contract("stage_profiles").document
    assert document["readiness_sequence"] == (
        "foundation_screen_v1",
        "overfit_diagnostic_v1",
        "foundation_tranche_v1",
        "complete_foundation_sft_v1",
    )
    assert tuple(item["profile_id"] for item in document["profiles"]) == (
        "foundation_screen_v1",
        "overfit_diagnostic_v1",
        "foundation_tranche_v1",
        "complete_foundation_sft_v1",
    )
    assert document["deferred_stage_ids"] == ("one_epoch_candidate",)
    assert document["authorization_effect"]["scope"] == "governance_validation_only"
    assert not any(
        value for key, value in document["authorization_effect"].items() if key != "scope"
    )


def test_exact_screen_diagnostic_tranche_and_complete_boundaries() -> None:
    document = api().load_foundation_contract("stage_profiles").document
    screen = profile(document, "foundation_screen_v1")
    diagnostic = profile(document, "overfit_diagnostic_v1")
    tranche = profile(document, "foundation_tranche_v1")
    complete = profile(document, "complete_foundation_sft_v1")

    assert (screen["total"], screen["splits"]) == (48, {"development": 48})
    assert (diagnostic["total"], diagnostic["splits"]) == (
        32,
        {"train": 32, "validation": 0},
    )
    assert (tranche["total"], tranche["splits"]) == (
        600,
        {"train": 540, "validation": 60},
    )
    assert (complete["total"], complete["splits"]) == (
        2400,
        {"train": 2160, "validation": 240},
    )
    assert sum(screen["category_quotas"].values()) == 48
    assert sum(value["train"] for value in tranche["task_allocations"].values()) == 540
    assert sum(value["validation"] for value in tranche["task_allocations"].values()) == 60
    assert sum(value["train"] for value in tranche["interaction_allocations"].values()) == 540
    assert sum(value["validation"] for value in tranche["interaction_allocations"].values()) == 60
    assert tranche["task_allocations"]["odds_movement_splits"] == {
        "train": 68,
        "validation": 7,
    }
    assert tranche["interaction_allocations"]["clarification"] == {
        "train": 23,
        "validation": 2,
    }


def test_stage_minimums_tools_and_gate_eligibility_are_exact() -> None:
    document = api().load_foundation_contract("stage_profiles").document
    screen = profile(document, "foundation_screen_v1")
    tranche = profile(document, "foundation_tranche_v1")
    complete = profile(document, "complete_foundation_sft_v1")
    assert screen["cross_cutting_minimums"] == {
        "multi_turn": 24,
        "non_ok_or_adversarial": 12,
        "benign_boundary_controls": 12,
        "tool_requiring": 38,
    }
    assert all(value == 10 for value in tranche["tool_single_call_minimums"].values())
    assert tranche["cross_cutting_minimums"]["control_pair_records"] == 60
    assert tranche["cross_cutting_minimums"]["distinct_control_pairs"] == 30
    assert complete["eligibility"] == {
        "candidate_audit_eligible": True,
        "freeze_gate_eligible": True,
        "release_eligible": False,
    }
    assert all(not item["eligibility"]["release_eligible"] for item in document["profiles"])


@pytest.mark.parametrize(
    ("profile_id", "train", "validation"),
    [
        ("overfit_diagnostic_v1", 31, 0),
        ("overfit_diagnostic_v1", 33, 0),
        ("foundation_tranche_v1", 539, 61),
        ("foundation_tranche_v1", 541, 59),
        ("complete_foundation_sft_v1", 2159, 241),
        ("complete_foundation_sft_v1", 2161, 239),
    ],
)
def test_split_boundary_mutations_fail_closed(
    project_copy: Path,
    profile_id: str,
    train: int,
    validation: int,
) -> None:
    contract_api = api()

    def mutation(document) -> None:
        item = profile(document, profile_id)
        item["splits"] = {"train": train, "validation": validation}

    mutate_stage(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match="stage|split|profile"):
        contract_api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize("screen_total", [47, 49])
def test_screen_boundary_mutations_fail_closed(project_copy: Path, screen_total: int) -> None:
    contract_api = api()
    mutate_stage(
        project_copy,
        lambda document: profile(document, "foundation_screen_v1")["splits"].__setitem__(
            "development", screen_total
        ),
    )
    with pytest.raises(contract_api.FoundationContractError, match="screen|profile|split"):
        contract_api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            lambda doc: (
                profile(doc, "foundation_tranche_v1")["task_allocations"][
                    "conversation_epistemics"
                ].__setitem__("train", 55),
                profile(doc, "foundation_tranche_v1")["task_allocations"][
                    "tool_selection_arguments"
                ].__setitem__("train", 80),
            ),
            "allocation",
        ),
        (
            lambda doc: profile(doc, "foundation_tranche_v1")["task_allocations"].__setitem__(
                "unknown_task", {"train": 0, "validation": 0}
            ),
            "task",
        ),
        (
            lambda doc: profile(doc, "foundation_tranche_v1")["eligibility"].__setitem__(
                "freeze_gate_eligible", True
            ),
            "freeze",
        ),
        (
            lambda doc: profile(doc, "complete_foundation_sft_v1")["eligibility"].__setitem__(
                "release_eligible", True
            ),
            "release",
        ),
        (
            lambda doc: profile(doc, "foundation_screen_v1").__setitem__(
                "training_authorized", True
            ),
            "Additional properties",
        ),
    ],
)
def test_invalid_stage_relationships_fail_closed(
    project_copy: Path,
    mutation,
    reason: str,
) -> None:
    contract_api = api()
    mutate_stage(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match=reason):
        contract_api.load_foundation_contracts(project_root=project_copy)


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            lambda doc: profile(doc, "overfit_diagnostic_v1")["tool_single_call_minimums"].pop(
                "get_game_context"
            ),
            "diagnostic.*tool",
        ),
        (
            lambda doc: profile(doc, "foundation_tranche_v1")[
                "tool_single_call_minimums"
            ].__setitem__("get_game_context", 9),
            "tranche.*tool",
        ),
        (
            lambda doc: profile(doc, "complete_foundation_sft_v1")["eligibility"].__setitem__(
                "freeze_gate_eligible", False
            ),
            "complete.*freeze",
        ),
    ],
)
def test_weakened_stage_minimums_or_complete_gate_fail_closed(
    project_copy: Path,
    mutation,
    reason: str,
) -> None:
    contract_api = api()
    mutate_stage(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match=reason):
        contract_api.load_foundation_contracts(project_root=project_copy)
