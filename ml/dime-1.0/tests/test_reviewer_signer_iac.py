from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import yaml

PROJECT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = PROJECT / "scripts/validate_reviewer_signer_iac.py"
TEMPLATE_PATH = PROJECT / "infrastructure/aws/reviewer-signers/template.yaml"
SIGNER_INFRASTRUCTURE_PATH = PROJECT / "infrastructure/aws/reviewer-signers"
SAM_VERSION_PATH = SIGNER_INFRASTRUCTURE_PATH / "SAM_CLI_VERSION"
RUNBOOK_PATH = SIGNER_INFRASTRUCTURE_PATH / "README.md"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "dime_reviewer_signer_iac_validator", VALIDATOR_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load()


def _template() -> dict[str, Any]:
    value = yaml.safe_load(TEMPLATE_PATH.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _write_template(tmp_path: Path, value: dict[str, Any]) -> Path:
    output = tmp_path / "template.yaml"
    output.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return output


def test_reviewer_signer_stack_passes_complete_static_contract() -> None:
    template = validator.validate_template()

    assert len(template["Resources"]) == 23
    assert template["Parameters"]["StackMode"]["Default"] == "LOCKED"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda template: template["Parameters"]["StackMode"].update(Default="PROVISIONING"),
        lambda template: template["Resources"]["ReviewerASigningKey"]["Properties"].update(
            KeySpec="ECC_NIST_P256"
        ),
        lambda template: template["Resources"]["ReviewerAWorkloadBoundaryPolicy"]["Properties"][
            "PolicyDocument"
        ]["Statement"][0].update(Resource="*"),
        lambda template: template["Resources"]["ReviewerASignerFunction"]["Properties"].update(
            ReservedConcurrentExecutions=1
        ),
        lambda template: template["Resources"].update(
            PublicApi={"Type": "AWS::Serverless::Api", "Properties": {}}
        ),
        lambda template: template["Resources"]["ReviewerSignerAuditTrail"]["Properties"][
            "AdvancedEventSelectors"
        ][0]["FieldSelectors"].append({"Field": "eventSource", "Equals": ["kms.amazonaws.com"]}),
        lambda template: template["Resources"]["ReviewerSignerAuditTrail"]["Properties"][
            "AdvancedEventSelectors"
        ].append(
            {
                "FieldSelectors": [
                    {
                        "Field": "eventCategory",
                        "Equals": ["Data"],
                    }
                ]
            }
        ),
        lambda template: template["Resources"]["ReviewerSignerAuditTrail"]["Properties"][
            "AdvancedEventSelectors"
        ].append(
            copy.deepcopy(
                template["Resources"]["ReviewerSignerAuditTrail"]["Properties"][
                    "AdvancedEventSelectors"
                ][0]
            )
        ),
    ],
)
def test_security_broadening_fails_closed(tmp_path: Path, mutation: Any) -> None:
    template = copy.deepcopy(_template())
    mutation(template)

    with pytest.raises(validator.IacValidationError):
        validator.validate_template(_write_template(tmp_path, template))


def test_stable_reviewer_ids_are_bound_to_both_function_pairs() -> None:
    template = _template()
    identities = {
        (
            resource["Properties"]["Environment"]["Variables"]["REVIEWER_ID"],
            resource["Properties"]["Environment"]["Variables"]["PROFILE_ID"],
        )
        for resource in template["Resources"].values()
        if resource.get("Type") == "AWS::Serverless::Function"
    }

    assert identities == {
        (
            "dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980",
            "dime-agent-profile-85ef4149-03e2-49ae-b8a4-2767e8627404",
        ),
        (
            "dime-reviewer-c3ddb330-def3-4406-9325-1b4d48d32543",
            "dime-agent-profile-1a0eb37e-2be7-40c7-bae5-d2e71a2889b1",
        ),
    }


def test_audit_trail_records_all_management_events_without_source_filtering() -> None:
    selectors = _template()["Resources"]["ReviewerSignerAuditTrail"]["Properties"][
        "AdvancedEventSelectors"
    ]

    assert selectors[0] == {
        "Name": "AllManagementEvents",
        "FieldSelectors": [
            {
                "Field": "eventCategory",
                "Equals": ["Management"],
            }
        ],
    }


def test_sam_cli_version_pin_matches_the_owner_runbook() -> None:
    version_file = SAM_VERSION_PATH.read_text(encoding="utf-8")
    assert version_file == "1.164.0\n"

    version = version_file.strip()
    runbook = RUNBOOK_PATH.read_text(encoding="utf-8")

    assert f"`{version}`" in runbook
    assert f"https://github.com/aws/aws-sam-cli/releases/tag/v{version}" in runbook
