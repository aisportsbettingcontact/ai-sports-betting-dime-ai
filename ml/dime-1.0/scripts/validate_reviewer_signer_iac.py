#!/usr/bin/env python3
"""Fail-closed static validation for the Foundation reviewer signer SAM stack."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = PROJECT_ROOT / "infrastructure/aws/reviewer-signers/template.yaml"
REGISTRY_PATH = PROJECT_ROOT / "configs/foundation_reviewer_registry.json"
PLATFORM_CONTRACT_PATH = PROJECT_ROOT / "configs/platform_contract.json"
ZERO_SHA256 = "0" * 64

ROLE_IDS = {
    "ReviewerAWorkloadRole",
    "ReviewerBWorkloadRole",
    "ReviewerASignerRole",
    "ReviewerBSignerRole",
}
FUNCTION_IDS = {
    "ReviewerAWorkloadFunction",
    "ReviewerBWorkloadFunction",
    "ReviewerASignerFunction",
    "ReviewerBSignerFunction",
}
KEY_IDS = {"ReviewerASigningKey", "ReviewerBSigningKey"}
POLICY_IDS = {
    "ReviewerAWorkloadBoundaryPolicy",
    "ReviewerBWorkloadBoundaryPolicy",
    "ReviewerASignerBoundaryPolicy",
    "ReviewerBSignerBoundaryPolicy",
}
LOG_GROUP_IDS = {
    "ReviewerAWorkloadLogGroup",
    "ReviewerBWorkloadLogGroup",
    "ReviewerASignerLogGroup",
    "ReviewerBSignerLogGroup",
}
EXPECTED_OUTPUTS = {
    "StackMode",
    "ReviewerAWorkloadRoleArn",
    "ReviewerBWorkloadRoleArn",
    "ReviewerAWorkloadAliasArn",
    "ReviewerBWorkloadAliasArn",
    "ReviewerASignerRoleArn",
    "ReviewerBSignerRoleArn",
    "ReviewerASignerAliasArn",
    "ReviewerBSignerAliasArn",
    "ReviewerAKmsKeyArn",
    "ReviewerBKmsKeyArn",
    "ReviewerAKmsKeyId",
    "ReviewerBKmsKeyId",
    "ReviewerAKmsAlias",
    "ReviewerBKmsAlias",
    "AuditTrailArn",
    "AuditLogBucketName",
}
FORBIDDEN_RESOURCE_TYPES = {
    "AWS::ApiGateway::RestApi",
    "AWS::ApiGatewayV2::Api",
    "AWS::Cognito::UserPool",
    "AWS::IAM::AccessKey",
    "AWS::IAM::User",
    "AWS::Lambda::Url",
    "AWS::RDS::DBInstance",
    "AWS::SecretsManager::Secret",
    "AWS::Serverless::Api",
    "AWS::Serverless::HttpApi",
}


class IacValidationError(ValueError):
    """Raised when infrastructure could broaden reviewer authority."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise IacValidationError(message)


def _read_yaml(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        raise IacValidationError("reviewer signer template could not be read safely") from exc
    _require(isinstance(value, dict), "reviewer signer template must be an object")
    return value


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IacValidationError(f"{label} could not be read safely") from exc
    _require(isinstance(value, dict), f"{label} must be an object")
    return value


def _resource_ids(resources: dict[str, Any], resource_type: str) -> set[str]:
    return {
        logical_id
        for logical_id, resource in resources.items()
        if isinstance(resource, dict) and resource.get("Type") == resource_type
    }


def _statements(resource: dict[str, Any]) -> dict[str, dict[str, Any]]:
    document = resource["Properties"]["PolicyDocument"]
    statements = document["Statement"]
    _require(isinstance(statements, list), "IAM policy statements must be an array")
    by_sid = {
        statement["Sid"]: statement
        for statement in statements
        if isinstance(statement, dict) and isinstance(statement.get("Sid"), str)
    }
    _require(len(by_sid) == len(statements), "IAM policy statement IDs must be unique")
    return by_sid


def _key_statements(resource: dict[str, Any]) -> dict[str, dict[str, Any]]:
    statements = resource["Properties"]["KeyPolicy"]["Statement"]
    by_sid = {
        statement["Sid"]: statement
        for statement in statements
        if isinstance(statement, dict) and isinstance(statement.get("Sid"), str)
    }
    _require(len(by_sid) == len(statements), "KMS key-policy statement IDs must be unique")
    return by_sid


def _get_att(logical_id: str, attribute: str = "Arn") -> dict[str, list[str]]:
    return {"Fn::GetAtt": [logical_id, attribute]}


def _sub(value: str) -> dict[str, str]:
    return {"Fn::Sub": value}


def _validate_roles(resources: dict[str, Any]) -> None:
    _require(
        _resource_ids(resources, "AWS::IAM::Role") == ROLE_IDS,
        "stack must define exactly four reviewer execution roles",
    )
    expected_trust = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "LambdaServiceOnly",
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }
        ],
    }
    for role_id in ROLE_IDS:
        role = resources[role_id]
        _require(
            role["Properties"].get("AssumeRolePolicyDocument") == expected_trust,
            f"{role_id} must trust only the Lambda service",
        )
        _require(
            "ManagedPolicyArns" not in role["Properties"] and "Policies" not in role["Properties"],
            f"{role_id} must not contain unreviewed embedded permissions",
        )


def _validate_keys(resources: dict[str, Any]) -> None:
    _require(
        _resource_ids(resources, "AWS::KMS::Key") == KEY_IDS,
        "stack must define exactly two KMS signing keys",
    )
    pairs = (
        ("ReviewerASigningKey", "ReviewerASignerRole"),
        ("ReviewerBSigningKey", "ReviewerBSignerRole"),
    )
    for key_id, signer_role_id in pairs:
        key = resources[key_id]
        properties = key["Properties"]
        _require(key.get("DeletionPolicy") == "Retain", f"{key_id} must be retained")
        _require(key.get("UpdateReplacePolicy") == "Retain", f"{key_id} replacement must retain")
        _require(properties.get("KeySpec") == "ECC_NIST_EDWARDS25519", f"{key_id} spec is wrong")
        _require(properties.get("KeyUsage") == "SIGN_VERIFY", f"{key_id} usage is wrong")
        _require(properties.get("Origin") == "AWS_KMS", f"{key_id} origin is wrong")
        _require(properties.get("MultiRegion") is False, f"{key_id} must be single-Region")
        _require(properties.get("EnableKeyRotation") is False, f"{key_id} rotation is unsupported")
        _require(properties.get("PendingWindowInDays") == 30, f"{key_id} deletion window is wrong")
        _require(
            properties.get("Enabled") == {"Fn::If": ["KeysEnabled", True, False]},
            f"{key_id} enabled state must be controlled by StackMode",
        )
        statements = _key_statements(key)
        allow = statements.get(
            "AllowOnlyReviewerASigner"
            if key_id.startswith("ReviewerA")
            else "AllowOnlyReviewerBSigner"
        )
        _require(allow is not None, f"{key_id} must explicitly allow only its signer")
        _require(allow.get("Principal", {}).get("AWS") == _get_att(signer_role_id), "wrong signer")
        _require(allow.get("Action") == "kms:Sign", f"{key_id} may allow only kms:Sign")
        _require(
            allow.get("Condition", {}).get("StringEquals")
            == {
                "kms:MessageType": "RAW",
                "kms:SigningAlgorithm": "ED25519_SHA_512",
            },
            f"{key_id} must bind RAW Ed25519 signing",
        )
        deny = statements.get("DenyEveryOtherSigningPrincipal")
        _require(
            deny is not None
            and deny.get("Effect") == "Deny"
            and deny.get("Principal") == "*"
            and deny.get("Action") == "kms:Sign"
            and deny.get("Condition", {}).get("ArnNotEquals", {}).get("aws:PrincipalArn")
            == _get_att(signer_role_id),
            f"{key_id} must deny every non-owned signing principal",
        )
        _require(
            {"DenyUnexpectedSigningAlgorithm", "DenyUnexpectedMessageType"} <= statements.keys(),
            f"{key_id} must deny alternate signing modes",
        )


def _validate_functions(resources: dict[str, Any], registry: dict[str, Any]) -> None:
    _require(
        _resource_ids(resources, "AWS::Serverless::Function") == FUNCTION_IDS,
        "stack must define exactly four reviewer functions",
    )
    reviewers = registry.get("reviewers")
    _require(
        isinstance(reviewers, list) and len(reviewers) == 2, "registry must have two reviewers"
    )
    stable_pairs = {
        (
            reviewer["reviewer_id"],
            reviewer["agent_profile"]["profile_id"],
        )
        for reviewer in reviewers
    }
    observed_pairs: set[tuple[str, str]] = set()
    for function_id in FUNCTION_IDS:
        properties = resources[function_id]["Properties"]
        _require(properties.get("Runtime") == "python3.12", f"{function_id} runtime must be pinned")
        _require(
            properties.get("Architectures") == ["arm64"], f"{function_id} architecture is wrong"
        )
        _require(properties.get("MemorySize") == 128, f"{function_id} memory must stay bounded")
        _require(properties.get("Timeout") == 10, f"{function_id} timeout must stay bounded")
        _require(
            properties.get("ReservedConcurrentExecutions")
            == {"Fn::If": ["FunctionsEnabled", 1, 0]},
            f"{function_id} concurrency must be default-locked",
        )
        _require(
            properties.get("AutoPublishAlias") == "provisioning-v1"
            and properties.get("AutoPublishAliasAllProperties") is True,
            f"{function_id} must expose only an immutable provisioning alias",
        )
        _require(
            properties.get("RecursiveLoop") == "Terminate", f"{function_id} loop guard is wrong"
        )
        variables = properties["Environment"]["Variables"]
        pair = (variables.get("REVIEWER_ID"), variables.get("PROFILE_ID"))
        _require(pair in stable_pairs, f"{function_id} does not use a governed stable identity")
        observed_pairs.add(pair)
        _require(
            set(variables).isdisjoint(
                {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"}
            ),
            f"{function_id} must not carry static AWS credentials",
        )
    _require(
        observed_pairs == stable_pairs, "functions must cover both governed reviewer identities"
    )


def _validate_policies(resources: dict[str, Any]) -> None:
    _require(
        _resource_ids(resources, "AWS::IAM::Policy") == POLICY_IDS,
        "stack must define exactly four reviewer boundary policies",
    )
    workload_pairs = (
        (
            "ReviewerAWorkloadBoundaryPolicy",
            "ReviewerASignerFunction",
            "ReviewerBSignerFunction",
        ),
        (
            "ReviewerBWorkloadBoundaryPolicy",
            "ReviewerBSignerFunction",
            "ReviewerASignerFunction",
        ),
    )
    for policy_id, owned_signer, peer_signer in workload_pairs:
        statements = _statements(resources[policy_id])
        allow = statements.get("AllowOwnedSignerAlias")
        _require(
            allow is not None
            and allow.get("Action") == "lambda:InvokeFunction"
            and allow.get("Resource") == _sub(f"${{{owned_signer}.Arn}}:provisioning-v1"),
            f"{policy_id} must invoke only its owned signer alias",
        )
        peer = statements.get("DenyPeerSigner")
        _require(
            peer is not None
            and peer.get("Effect") == "Deny"
            and _get_att(peer_signer) in peer.get("Resource", [])
            and _sub(f"${{{peer_signer}.Arn}}:*") in peer.get("Resource", []),
            f"{policy_id} must explicitly deny its peer signer",
        )
        all_others = statements.get("DenyEveryOtherLambdaTarget")
        _require(
            all_others is not None
            and all_others.get("Effect") == "Deny"
            and all_others.get("NotResource") == _sub(f"${{{owned_signer}.Arn}}:provisioning-v1"),
            f"{policy_id} must deny every other Lambda target",
        )
        direct_kms = statements.get("DenyDirectKmsSigning")
        _require(
            direct_kms is not None
            and direct_kms.get("Effect") == "Deny"
            and direct_kms.get("Action") == "kms:Sign"
            and direct_kms.get("Resource") == "*",
            f"{policy_id} must deny direct KMS signing",
        )

    signer_pairs = (
        (
            "ReviewerASignerBoundaryPolicy",
            "ReviewerASigningKey",
            "ReviewerBSigningKey",
        ),
        (
            "ReviewerBSignerBoundaryPolicy",
            "ReviewerBSigningKey",
            "ReviewerASigningKey",
        ),
    )
    for policy_id, owned_key, peer_key in signer_pairs:
        statements = _statements(resources[policy_id])
        allow = statements.get("AllowOwnedKeyWithExactAlgorithm")
        _require(
            allow is not None
            and allow.get("Action") == "kms:Sign"
            and allow.get("Resource") == _get_att(owned_key)
            and allow.get("Condition", {}).get("StringEquals")
            == {
                "kms:MessageType": "RAW",
                "kms:SigningAlgorithm": "ED25519_SHA_512",
            },
            f"{policy_id} must bind its one key and algorithm",
        )
        _require(
            statements.get("DenyPeerSigningKey", {}).get("Resource") == _get_att(peer_key),
            f"{policy_id} must explicitly deny its peer key",
        )
        _require(
            statements.get("DenyEveryOtherSigningKey", {}).get("NotResource")
            == _get_att(owned_key),
            f"{policy_id} must deny all non-owned signing keys",
        )


def _validate_audit(resources: dict[str, Any]) -> None:
    _require(
        _resource_ids(resources, "AWS::Logs::LogGroup") == LOG_GROUP_IDS,
        "stack must define four bounded log groups",
    )
    for log_group_id in LOG_GROUP_IDS:
        log_group = resources[log_group_id]
        _require(log_group.get("DeletionPolicy") == "Retain", "log groups must be retained")
        _require(log_group["Properties"].get("RetentionInDays") == 30, "log retention is wrong")

    bucket = resources.get("AuditLogBucket")
    _require(bucket is not None and bucket.get("Type") == "AWS::S3::Bucket", "audit bucket missing")
    _require(
        bucket.get("DeletionPolicy") == "Retain" and bucket.get("UpdateReplacePolicy") == "Retain",
        "audit bucket must be retained",
    )
    public_access = bucket["Properties"].get("PublicAccessBlockConfiguration", {})
    _require(
        all(public_access.get(field) is True for field in public_access)
        and set(public_access)
        == {"BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"},
        "audit bucket must block all public access",
    )
    _require(
        bucket["Properties"].get("VersioningConfiguration") == {"Status": "Enabled"},
        "audit bucket versioning must be enabled",
    )

    trail = resources.get("ReviewerSignerAuditTrail")
    _require(
        trail is not None and trail.get("Type") == "AWS::CloudTrail::Trail",
        "reviewer signer CloudTrail is missing",
    )
    properties = trail["Properties"]
    _require(
        properties.get("IsLogging") is True
        and properties.get("IsMultiRegionTrail") is True
        and properties.get("EnableLogFileValidation") is True,
        "CloudTrail must remain enabled, multi-Region, and integrity validated",
    )
    serialized_selectors = json.dumps(properties.get("AdvancedEventSelectors"), sort_keys=True)
    for required in (
        "kms.amazonaws.com",
        "AWS::Lambda::Function",
        "ReviewerAWorkloadFunction",
        "ReviewerBWorkloadFunction",
        "ReviewerASignerFunction",
        "ReviewerBSignerFunction",
    ):
        _require(required in serialized_selectors, f"CloudTrail selector is missing {required}")


def _validate_platform_remains_blocked(platform: dict[str, Any]) -> None:
    authorization = platform.get("authorization")
    _require(isinstance(authorization, dict), "platform authorization contract is missing")
    for field in (
        "full_training",
        "locked_evaluation",
        "adapter_publication",
        "serving",
        "provider_activation",
    ):
        _require(
            authorization.get(field) is False, f"platform authorization {field} must stay false"
        )
    reviewer_authority = platform["foundation_v1_owner_decision"]["reviewer_authority"]
    _require(
        reviewer_authority.get("activation_authorized") is False
        and reviewer_authority.get("ai_agent_activation_authorized") is False,
        "reviewer authority must remain inactive",
    )


def validate_template(
    template_path: Path = TEMPLATE_PATH,
    *,
    registry_path: Path = REGISTRY_PATH,
    platform_contract_path: Path = PLATFORM_CONTRACT_PATH,
) -> dict[str, Any]:
    """Validate the complete static reviewer signer security contract."""

    template = _read_yaml(template_path)
    registry = _read_json(registry_path, "reviewer registry")
    platform = _read_json(platform_contract_path, "platform contract")
    _require(
        template.get("Transform") == "AWS::Serverless-2016-10-31",
        "template must use the AWS SAM transform",
    )
    parameters = template.get("Parameters")
    _require(isinstance(parameters, dict), "template parameters are missing")
    stack_mode = parameters.get("StackMode", {})
    _require(
        stack_mode.get("Default") == "LOCKED"
        and stack_mode.get("AllowedValues") == ["LOCKED", "KEY_SETUP", "PROVISIONING"],
        "StackMode must be default-locked with only three controlled states",
    )
    for parameter in (
        "ReviewerAExpectedChallengeSha256",
        "ReviewerBExpectedChallengeSha256",
    ):
        _require(
            parameters.get(parameter, {}).get("Default") == ZERO_SHA256
            and parameters.get(parameter, {}).get("NoEcho") is False,
            f"{parameter} must be public, explicit, and unconfigured by default",
        )
    _require(
        "ProvisioningRequiresConfiguredChallengeHashes" in template.get("Rules", {}),
        "PROVISIONING must require both exact challenge hashes",
    )
    _require(
        template.get("Conditions", {}).get("FunctionsEnabled")
        == {"Fn::Equals": [{"Ref": "StackMode"}, "PROVISIONING"]},
        "functions may run only in PROVISIONING mode",
    )

    resources = template.get("Resources")
    _require(isinstance(resources, dict), "template resources are missing")
    observed_types = {
        resource.get("Type") for resource in resources.values() if isinstance(resource, dict)
    }
    _require(
        observed_types.isdisjoint(FORBIDDEN_RESOURCE_TYPES),
        "template contains a forbidden public, secret, or identity resource",
    )
    serialized = json.dumps(template, sort_keys=True)
    for marker in ("{{resolve:", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "FunctionUrl"):
        _require(marker not in serialized, f"template contains prohibited marker {marker}")

    _validate_roles(resources)
    _validate_keys(resources)
    _validate_functions(resources, registry)
    _validate_policies(resources)
    _validate_audit(resources)
    _validate_platform_remains_blocked(platform)
    _require(set(template.get("Outputs", {})) == EXPECTED_OUTPUTS, "stack output contract changed")
    return template


def main() -> None:
    template = validate_template()
    resources = template["Resources"]
    print(f"Reviewer signer resources: {len(resources)}")
    print("KMS signing keys: 2")
    print("Reviewer roles/functions: 4 / 4")
    print("Default stack mode: LOCKED")
    print("Reviewer activation: unauthorized")
    print("REVIEWER SIGNER IAC VALIDATION PASSED")


if __name__ == "__main__":
    main()
