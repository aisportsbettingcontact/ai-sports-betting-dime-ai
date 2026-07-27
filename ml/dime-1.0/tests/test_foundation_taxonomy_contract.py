from __future__ import annotations

import importlib
import shutil
from pathlib import Path

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
LOADER_PATH = PROJECT / "src/dime_ai/foundation_contracts.py"

EXPECTED_UNRESOLVED = {
    "foundation_skill_ids",
    "foundation_synthetic_provider_ids",
    "evaluation_task_types",
    "evaluation_data_quality_conditions",
    "task_family_to_skill_mapping",
    "curriculum_to_evaluation_family_mapping",
    "foundation_screen_to_evaluation_family_mapping",
}


def api():
    assert LOADER_PATH.is_file(), "Step 2 taxonomy contract loader is missing"
    return importlib.import_module("dime_ai.foundation_contracts")


@pytest.fixture
def project_copy(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    for directory in ("configs", "schemas", "tools"):
        shutil.copytree(PROJECT / directory, project / directory)
    return project


def mutate_taxonomy(project: Path, mutator) -> None:
    path = project / "configs/foundation_taxonomy_v1.yaml"
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    mutator(document)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")


def test_taxonomy_versions_envelope_and_explicit_unresolved_inventory() -> None:
    contract = api().load_foundation_contract("taxonomy")
    document = contract.document
    assert document["schema_version"] == "dime-foundation-taxonomy-v1"
    assert document["contract_version"] == "dime-foundation-taxonomy-v1.0.0"
    assert document["status"] == "proposed"
    assert document["dataset_version"] == "dime-sft-foundation-v1"
    assert set(document["unresolved_decisions"]) == EXPECTED_UNRESOLVED
    assert len(document["unresolved_decisions"]) == len(EXPECTED_UNRESOLVED)
    assert document["purpose"] == "governance_and_validation_metadata_only"
    assert document["market_catalog"] == {
        "path": "tools/market_keys.v1.json",
        "version": "1.0.0",
        "sha256": "6be980c94117bdb4ad0f4930d254b89b63a90af6bd93d58891457d85ed2f5481",
    }
    assert document["authorization_effect"]["scope"] == "governance_validation_only"
    assert not any(
        value for key, value in document["authorization_effect"].items() if key != "scope"
    )


def test_taxonomy_matches_tools_reviewer_roles_and_source_class_relationships() -> None:
    document = api().load_foundation_contract("taxonomy").document
    assert tuple(document["registered_tools"]) == (
        "get_game_context",
        "get_current_odds",
        "get_odds_history",
        "get_market_splits",
        "calculate_market_math",
        "get_bet_tracker_summary",
        "run_simulation",
    )
    assert set(document["reviewer_roles"]) == {
        "domain",
        "numeric",
        "coaching",
        "simulation",
        "safety",
        "privacy",
        "rights",
        "semantic-audit",
        "evaluation-audit",
        "locked-evaluation",
        "dataset-approver",
    }
    assert set(document["source_classes"]["foundation_allowed"]) < set(
        document["source_classes"]["recognized"]
    )


def test_taxonomy_relationships_and_legacy_label_are_explicit() -> None:
    document = api().load_foundation_contract("taxonomy").document
    assert document["relationships"]["league_to_sport"] == {
        "nfl": "american_football",
        "ncaaf": "american_football",
        "mlb": "baseball",
        "nba": "basketball",
        "wnba": "basketball",
        "ncaab": "basketball",
        "nhl": "ice_hockey",
        "epl": "soccer",
    }
    assert document["legacy_labels"]["red_team_exposure_split"] == (
        "retained_legacy_label_while_red_team_transitions_to_suite"
    )
    assert set(document["matched_control_locator_types"]) == {
        "message_text_span",
        "tool_result_json_pointer",
    }


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            lambda doc: doc["vocabularies"]["task_families"].append(
                doc["vocabularies"]["task_families"][0]
            ),
            "unique",
        ),
        (
            lambda doc: doc["vocabularies"]["task_families"].append("Not_Canonical"),
            "canonical",
        ),
        (
            lambda doc: doc["aliases"]["sports"]["baseball"].append("gridiron"),
            "alias",
        ),
        (
            lambda doc: doc["relationships"]["league_to_sport"].__setitem__("nfl", "baseball"),
            "league",
        ),
        (
            lambda doc: doc["registered_tools"].pop(),
            "tool catalog",
        ),
        (
            lambda doc: doc["registered_tools"].append("unknown_tool"),
            "tool catalog",
        ),
        (
            lambda doc: doc["reviewer_roles"].append("legal_superuser"),
            "reviewer",
        ),
        (
            lambda doc: doc["source_classes"]["foundation_allowed"].append("provider-derived"),
            "source class",
        ),
        (
            lambda doc: doc.__setitem__("unexpected", True),
            "Additional properties",
        ),
        (
            lambda doc: doc["unresolved_decisions"].append("foundation_skill_ids"),
            "unique",
        ),
    ],
)
def test_taxonomy_mutations_fail_closed(
    project_copy: Path,
    mutation,
    reason: str,
) -> None:
    contract_api = api()
    mutate_taxonomy(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match=reason):
        contract_api.load_foundation_contracts(project_root=project_copy)


def test_canonical_but_unauthorized_vocabulary_substitution_fails_closed(
    project_copy: Path,
) -> None:
    contract_api = api()

    def mutation(document) -> None:
        document["vocabularies"]["policy_actions"][0] = "permit"

    mutate_taxonomy(project_copy, mutation)
    with pytest.raises(contract_api.FoundationContractError, match="policy_actions"):
        contract_api.load_foundation_contracts(project_root=project_copy)
