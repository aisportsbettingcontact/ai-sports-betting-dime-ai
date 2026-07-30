import json
from pathlib import Path

from jsonschema import Draft202012Validator

PROJECT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT / "configs/route_context_compiler_v1.json"
SCHEMA_PATH = PROJECT / "schemas/route_context_compiler_v1.schema.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_route_context_compiler_config_is_schema_valid() -> None:
    schema = load_json(SCHEMA_PATH)
    config = load_json(CONFIG_PATH)

    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(config)


def test_route_context_compiler_is_fail_closed_and_inactive() -> None:
    config = load_json(CONFIG_PATH)

    assert config["status"] == "IMPLEMENTED_OFFLINE_NOT_ACTIVATED"
    assert set(config["authorizations"].values()) == {False}
    assert config["tokenMeasurementStatus"] == "STRUCTURAL_ESTIMATE_NOT_MODEL_EXACT"
    assert config["offlineAcceptance"] == {
        "criticalFactRecall": 1.0,
        "routePolicyViolations": 0,
        "duplicateContextRateMaximum": 0.02,
        "irrelevantContextRateMaximum": 0.05,
        "silentContextTruncations": 0,
    }


def test_every_supported_route_has_a_bounded_policy() -> None:
    policies = load_json(CONFIG_PATH)["routePolicies"]

    assert set(policies) == {
        "platform",
        "account",
        "educational",
        "bet_explanation",
        "matchup",
        "full_slate",
        "historical",
        "live_data",
        "general_sports",
    }
    assert all(0 < policy["maxTokens"] <= 16_384 for policy in policies.values())
    assert policies["platform"]["gameRetrieval"] == "prohibited"
    assert policies["account"]["gameRetrieval"] == "prohibited"
    assert policies["historical"]["pointInTimeCutoffRequired"] is True
    assert policies["live_data"]["authoritativeObservationTimestampRequired"] is True
