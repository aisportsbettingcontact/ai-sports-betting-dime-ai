#!/usr/bin/env python
"""Finalize a private Foundation pilot only after independent critic decisions exist."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from dime_ai.canonical_json import canonical_json_bytes
from dime_ai.foundation_control import (
    CRITIC_INDEPENDENCE_MUST_DIFFER,
    validate_foundation_record,
    validate_source_packet,
)
from dime_ai.foundation_data_factory import (
    DataFactoryError,
    convert_and_encode,
    source_packet_is_releasable,
)
from dime_ai.foundation_dataset import (
    _development_contamination,
    find_exact_duplicates,
    find_semantic_neighbors,
)
from dime_ai.foundation_instrumentation import (
    CRITIC_PROMPT_REVISION,
    DeterministicByteTokenizer,
    FoundationInstrumentationError,
    expected_critic_decision_receipt_sha256,
    expected_critic_execution_receipt_sha256,
    file_manifest,
    route_token_report,
    sha256_file,
    sha256_json,
    token_profile,
    validate_schema,
    write_new_bytes,
    write_new_json,
)
from dime_ai.foundation_partitioning import PartitionRegistryError, validate_partition_groups
from dime_ai.governed_json import load_governed_json

ML_ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = ML_ROOT / "data" / "private"
CRITIC_PROMPT_PATH = ML_ROOT / "prompts" / "foundation_critique_pilot_v1.md"
NUMERIC_TOKEN = re.compile(r"(?<![A-Za-z0-9_])[-+]?(?:\d+(?:\.\d+)?|\.\d+)%?")


class PilotFinalizationError(ValueError):
    """Raised when independent critique or deterministic conversion is incomplete."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot-root", type=Path, required=True)
    parser.add_argument("--finalized-at", required=True)
    return parser.parse_args()


def _private_directory(path: Path) -> Path:
    absolute = path.absolute()
    resolved = absolute.resolve(strict=True)
    private_root = PRIVATE_ROOT.resolve(strict=True)
    if resolved != absolute or not resolved.is_dir() or not resolved.is_relative_to(private_root):
        raise PilotFinalizationError(
            "pilot root must be a real non-symlink directory below data/private"
        )
    return resolved


def _load_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise PilotFinalizationError(f"{label} must be a regular file: {path}")
    value = load_governed_json(path)
    if not isinstance(value, dict):
        raise PilotFinalizationError(f"{label} must contain a JSON object")
    return value


def _load_evaluation_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted((ML_ROOT / "data" / "eval").glob("*")):
        if path.suffix == ".jsonl":
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    value = json.loads(line)
                    if isinstance(value, dict) and isinstance(value.get("messages"), list):
                        records.append(value)
            continue
        if path.suffix != ".json":
            continue
        value = json.loads(path.read_text(encoding="utf-8"))

        def walk(item: object) -> None:
            if isinstance(item, dict):
                if isinstance(item.get("case_id"), str) and isinstance(item.get("messages"), list):
                    records.append(item)
                for child in item.values():
                    walk(child)
            elif isinstance(item, list):
                for child in item:
                    walk(child)

        walk(value)
    return records


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> str:
    content = b"".join(canonical_json_bytes(value) for value in values)
    write_new_bytes(path, content)
    return hashlib.sha256(content).hexdigest()


def _decision_context_packet(
    pilot_root: Path,
    decision: dict[str, Any],
    draft: dict[str, Any],
) -> dict[str, Any]:
    record_id = decision["record_id"]
    path = pilot_root / "context-packets" / "critic" / f"{record_id}.json"
    packet = _load_object(path, f"{record_id} critic context packet")
    validate_schema(
        packet,
        "foundation_context_packet.schema.json",
        f"{record_id} critic context packet",
    )
    expected_context_sha256 = sha256_json(packet)
    if packet["record_id"] != record_id:
        raise PilotFinalizationError(f"{record_id}: critic context record mismatch")
    if packet["route"] != draft["record_payload"]["route"]:
        raise PilotFinalizationError(f"{record_id}: critic context route mismatch")
    if packet["role"] != "independent_critique":
        raise PilotFinalizationError(f"{record_id}: critic context role mismatch")
    if decision["critic_context_packet_sha256"] != expected_context_sha256:
        raise PilotFinalizationError(f"{record_id}: critic context packet hash mismatch")
    if decision["critic"]["context_sha256"] != expected_context_sha256:
        raise PilotFinalizationError(f"{record_id}: critic actor context hash mismatch")

    units = {unit["unit_id"]: unit for unit in packet["units"]}
    prompt_unit = units.get("critic-prompt")
    draft_unit = units.get("authoring-draft")
    prompt_sha256 = sha256_file(CRITIC_PROMPT_PATH)
    if (
        not isinstance(prompt_unit, dict)
        or prompt_unit["source_path"] != "prompts/foundation_critique_pilot_v1.md"
        or prompt_unit["source_sha256"] != prompt_sha256
        or prompt_unit["content_sha256"] != prompt_sha256
    ):
        raise PilotFinalizationError(f"{record_id}: critic prompt context is not exact")
    if (
        not isinstance(draft_unit, dict)
        or draft_unit["source_path"]
        not in {
            f"private:draft/{record_id}",
            f"private:repair-002-draft/{record_id}",
        }
        or draft_unit["source_sha256"] != draft["draft_sha256"]
        or draft_unit["content_sha256"] != draft["draft_sha256"]
    ):
        raise PilotFinalizationError(f"{record_id}: critic draft context is not exact")
    return packet


def _validate_decision(
    decision: dict[str, Any],
    draft: dict[str, Any],
    context_packet: dict[str, Any],
) -> None:
    record_id = draft["record_id"]
    validate_schema(
        decision,
        "foundation_critic_decision.schema.json",
        f"{record_id} critic decision",
    )
    if decision["record_id"] != record_id or decision["draft_sha256"] != draft["draft_sha256"]:
        raise PilotFinalizationError(f"{record_id}: critic decision does not bind exact draft")
    if decision["decision"] != "approved":
        raise PilotFinalizationError(f"{record_id}: critic decision is not approved")
    if decision["unresolved_material_findings"] != 0:
        raise PilotFinalizationError(f"{record_id}: unresolved material findings remain")
    if any(not finding["resolved"] for finding in decision["findings"]):
        raise PilotFinalizationError(f"{record_id}: unresolved critic finding remains")
    if decision["deterministic_validation_passed"] is not True:
        raise PilotFinalizationError(f"{record_id}: deterministic validation was not confirmed")

    generator = draft["record_payload"]["provenance"]["generator"]
    critic = decision["critic"]
    for field in CRITIC_INDEPENDENCE_MUST_DIFFER:
        if generator[field] == critic[field]:
            raise PilotFinalizationError(
                f"{record_id}: generator and critic share prohibited {field}"
            )
    expected_prompt_sha256 = sha256_file(CRITIC_PROMPT_PATH)
    if (
        critic["prompt_revision"] != CRITIC_PROMPT_REVISION
        or critic["prompt_sha256"] != expected_prompt_sha256
    ):
        raise PilotFinalizationError(f"{record_id}: critic prompt identity is not frozen")
    expected_execution_receipt = expected_critic_execution_receipt_sha256(
        record_id=record_id,
        draft_sha256=draft["draft_sha256"],
        critic=critic,
        context_sha256=sha256_json(context_packet),
        reviewed_at=decision["reviewed_at"],
    )
    if critic["execution_receipt_sha256"] != expected_execution_receipt:
        raise PilotFinalizationError(f"{record_id}: critic execution receipt mismatch")
    if decision["decision_receipt_sha256"] != expected_critic_decision_receipt_sha256(decision):
        raise PilotFinalizationError(f"{record_id}: critic decision receipt mismatch")


def _merge_review(draft: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    record = deepcopy(draft["record_payload"])
    record["provenance"]["critic"] = deepcopy(decision["critic"])
    record["independent_review"] = {
        "decision": decision["decision"],
        "rubric_version": decision["rubric_version"],
        "reviewed_at": decision["reviewed_at"],
        "unresolved_material_findings": decision["unresolved_material_findings"],
        "deterministic_validation_passed": decision["deterministic_validation_passed"],
    }
    return record


def main() -> None:
    args = parse_args()
    pilot_root = _private_directory(args.pilot_root)
    final_root = pilot_root / "finalized"
    if final_root.exists() or final_root.is_symlink():
        raise SystemExit(f"finalized output already exists: {final_root}")

    initial_report = _load_object(pilot_root / "pilot-report.json", "pilot report")
    validate_schema(initial_report, "foundation_pilot_report.schema.json", "pilot report")
    if initial_report["status"] != "DRAFTS_READY_FOR_INDEPENDENT_CRITIQUE":
        raise SystemExit("pilot drafts are not at the independent-critique boundary")

    draft_paths = sorted((pilot_root / "drafts").glob("*/*.json"))
    decision_paths = sorted((pilot_root / "critic-decisions").glob("*.json"))
    if len(draft_paths) != 20 or len(decision_paths) != 20:
        raise SystemExit(
            f"expected twenty drafts and twenty decisions; got {len(draft_paths)} and "
            f"{len(decision_paths)}"
        )
    drafts = [_load_object(path, "authoring draft") for path in draft_paths]
    decisions = [_load_object(path, "critic decision") for path in decision_paths]
    drafts_by_id = {draft["record_id"]: draft for draft in drafts}
    decisions_by_id = {decision["record_id"]: decision for decision in decisions}
    if len(drafts_by_id) != 20 or set(drafts_by_id) != set(decisions_by_id):
        raise SystemExit("critic decision inventory does not equal the exact draft inventory")

    source_packets: dict[str, dict[str, Any]] = {}
    rights_failures = 0
    for path in sorted((pilot_root / "source-packets").glob("*.json")):
        packet = _load_object(path, "source packet")
        issues = validate_source_packet(packet)
        if issues:
            rights_failures += 1
            continue
        try:
            source_packet_is_releasable(packet)
        except DataFactoryError:
            rights_failures += 1
        source_packets[packet["packet_id"]] = packet

    records: list[dict[str, Any]] = []
    trainer_records: list[dict[str, Any]] = []
    encoded_records: list[dict[str, Any]] = []
    critic_packets: list[dict[str, Any]] = []
    schema_failures = 0
    critic_independence_failures = 0
    conversion_failures = 0
    silent_truncations = 0
    unresolved_material_findings = 0
    numeric_errors = 0
    tokenizer = DeterministicByteTokenizer()
    profile = token_profile()

    for record_id in sorted(drafts_by_id):
        draft = drafts_by_id[record_id]
        decision = decisions_by_id[record_id]
        if draft["draft_sha256"] != sha256_json(draft["record_payload"]):
            schema_failures += 1
            continue
        try:
            packet = _decision_context_packet(pilot_root, decision, draft)
            _validate_decision(decision, draft, packet)
        except (FoundationInstrumentationError, PilotFinalizationError):
            critic_independence_failures += 1
            continue
        record = _merge_review(draft, decision)
        issues = validate_foundation_record(record)
        if issues:
            schema_failures += 1
            continue
        source_reference = record["source_reference"]
        source_packet = (
            source_packets.get(source_reference["packet_id"])
            if isinstance(source_reference, dict)
            else None
        )
        if (
            source_packet is None
            or source_packet["snapshot_sha256"] != source_reference["snapshot_sha256"]
            or source_packet["source_locator"] != source_reference["locator"]
        ):
            rights_failures += 1
            continue
        unresolved_material_findings += decision["unresolved_material_findings"]
        if (
            any(
                NUMERIC_TOKEN.search(message["content"])
                for message in record["conversation"]
                if message["role"] == "assistant"
            )
            and not record["numeric_assertions"]
        ):
            numeric_errors += 1
            continue
        try:
            converted = convert_and_encode(record, tokenizer, profile["max_length"])
        except (DataFactoryError, ValueError):
            conversion_failures += 1
            continue
        if converted["silent_truncation"]:
            silent_truncations += 1
            continue
        records.append(record)
        trainer_records.append(converted["trainer_record"])
        encoded_records.append(
            {
                "record_id": record_id,
                "route": record["route"],
                "encoded": converted["encoded"],
            }
        )
        critic_packets.append(packet)

    partition_collisions = 0
    try:
        partition_registry = validate_partition_groups(records)
    except PartitionRegistryError:
        partition_collisions = 1
        partition_registry = {}

    exact_duplicates = find_exact_duplicates(trainer_records)
    semantic_neighbors = find_semantic_neighbors(
        trainer_records,
        shingle_size=5,
        threshold=0.92,
    )
    evaluation_overlap = _development_contamination(
        trainer_records,
        _load_evaluation_records(),
        shingle_size=5,
        threshold=0.80,
    )
    counts = {
        "records": len(records),
        "trainer_records": len(trainer_records),
        "train": sum(record["split"] == "train" for record in records),
        "validation": sum(record["split"] == "validation" for record in records),
    }
    gates = {
        "schema_failures": schema_failures,
        "critic_independence_failures": critic_independence_failures,
        "partition_collisions": partition_collisions,
        "rights_failures": rights_failures,
        "numeric_errors": numeric_errors,
        "conversion_failures": conversion_failures,
        "silent_truncations": silent_truncations,
        "evaluation_overlap": len(evaluation_overlap),
        "unresolved_material_findings": unresolved_material_findings,
        "exact_duplicates": len(exact_duplicates),
        "semantic_duplicate_pairs": len(semantic_neighbors),
    }
    if counts != {
        "records": 20,
        "trainer_records": 20,
        "train": 18,
        "validation": 2,
    } or any(gates.values()):
        raise SystemExit(
            "FINALIZATION GATE FAILED: "
            + json.dumps({"counts": counts, "gates": gates}, sort_keys=True)
        )

    generator_packets = [
        _load_object(path, "generator context packet")
        for path in sorted((pilot_root / "context-packets" / "generator").glob("*.json"))
    ]
    all_context_packets = generator_packets + critic_packets
    final_route_report = route_token_report(encoded_records, all_context_packets)
    final_route_report["stage"] = "APPROVED_TRAINER_CONVERSION"

    critic_identity_tuples = {
        (
            decision["critic"]["actor_id"],
            decision["critic"]["model_id"],
            decision["critic"]["model_revision"],
            decision["critic"]["prompt_revision"],
            decision["critic"]["prompt_sha256"],
            decision["critic"]["responsibility"],
        )
        for decision in decisions
    }
    critic_identities = [
        {
            "actor_id": actor_id,
            "model_id": model_id,
            "model_revision": model_revision,
            "prompt_revision": prompt_revision,
            "prompt_path": "prompts/foundation_critique_pilot_v1.md",
            "prompt_sha256": prompt_sha256,
            "responsibility": responsibility,
        }
        for (
            actor_id,
            model_id,
            model_revision,
            prompt_revision,
            prompt_sha256,
            responsibility,
        ) in sorted(critic_identity_tuples)
    ]
    generator_identity_tuples = {
        (
            record["provenance"]["generator"]["actor_id"],
            record["provenance"]["generator"]["model_id"],
            record["provenance"]["generator"]["model_revision"],
            record["provenance"]["generator"]["prompt_revision"],
            record["provenance"]["generator"]["prompt_sha256"],
            record["provenance"]["generator"]["responsibility"],
        )
        for record in records
    }
    generator_identities = [
        {
            "actor_id": actor_id,
            "model_id": model_id,
            "model_revision": model_revision,
            "prompt_revision": prompt_revision,
            "prompt_path": (
                "prompts/foundation_generation_pilot_v1.md"
                if prompt_revision == "foundation-generation-pilot-v1"
                else "prompts/foundation_generation_repair_v1.md"
            ),
            "prompt_sha256": prompt_sha256,
            "responsibility": responsibility,
        }
        for (
            actor_id,
            model_id,
            model_revision,
            prompt_revision,
            prompt_sha256,
            responsibility,
        ) in sorted(generator_identity_tuples)
    ]

    os.umask(0o077)
    final_root.mkdir(mode=0o700)
    train_records = [record for record in records if record["split"] == "train"]
    validation_records = [record for record in records if record["split"] == "validation"]
    trainer_by_id = {record["example_id"]: record for record in trainer_records}
    trainer_train = [trainer_by_id[record["record_id"]] for record in train_records]
    trainer_validation = [trainer_by_id[record["record_id"]] for record in validation_records]

    authoring_train_sha256 = _write_jsonl(
        final_root / "authoring" / "train.jsonl",
        train_records,
    )
    authoring_validation_sha256 = _write_jsonl(
        final_root / "authoring" / "validation.jsonl",
        validation_records,
    )
    trainer_train_sha256 = _write_jsonl(
        final_root / "trainer" / "train.jsonl",
        trainer_train,
    )
    trainer_validation_sha256 = _write_jsonl(
        final_root / "trainer" / "validation.jsonl",
        trainer_validation,
    )

    authoring_manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "record_count": 20,
        "status": "APPROVED_PILOT_NOT_RELEASE",
        "entries": [
            {
                "path": "authoring/train.jsonl",
                "records": 18,
                "sha256": authoring_train_sha256,
            },
            {
                "path": "authoring/validation.jsonl",
                "records": 2,
                "sha256": authoring_validation_sha256,
            },
        ],
    }
    authoring_manifest_sha256 = write_new_json(
        final_root / "authoring-manifest.json",
        authoring_manifest,
    )
    trainer_manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "record_count": 20,
        "status": "APPROVED_PILOT_NOT_RELEASE",
        "entries": [
            {
                "path": "trainer/train.jsonl",
                "records": 18,
                "sha256": trainer_train_sha256,
            },
            {
                "path": "trainer/validation.jsonl",
                "records": 2,
                "sha256": trainer_validation_sha256,
            },
        ],
    }
    trainer_manifest_sha256 = write_new_json(
        final_root / "trainer-manifest.json",
        trainer_manifest,
    )
    context_manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "packet_count": len(all_context_packets),
        "status": "FROZEN",
        "entries": [
            {
                "record_id": packet["record_id"],
                "role": packet["role"],
                "sha256": sha256_json(packet),
            }
            for packet in sorted(
                all_context_packets,
                key=lambda packet: (packet["record_id"], packet["role"]),
            )
        ],
    }
    context_manifest_sha256 = write_new_json(
        final_root / "context-packet-manifest.json",
        context_manifest,
    )
    partition_registry_sha256 = write_new_json(
        final_root / "partition-registry.json",
        partition_registry,
    )
    token_profile_sha256 = write_new_json(final_root / "token-profile.json", profile)
    route_report_sha256 = write_new_json(
        final_root / "route-token-report.json",
        final_route_report,
    )

    execution_capsule = _load_object(
        pilot_root / "execution-context-capsule.json",
        "execution context capsule",
    )
    execution_capsule["frozen_at"] = args.finalized_at
    execution_capsule["token_profile"] = {
        "profile_id": profile["profile_id"],
        "path": "token-profile.json",
        "sha256": token_profile_sha256,
    }
    execution_capsule["actors"]["generator"] = (
        generator_identities[0] if len(generator_identities) == 1 else None
    )
    execution_capsule["actors"]["generators"] = generator_identities
    execution_capsule["actors"]["generator_state"] = (
        "SINGLE_EXECUTION_BOUND" if len(generator_identities) == 1 else "EXECUTION_SET_BOUND"
    )
    execution_capsule["actors"]["critic"] = (
        critic_identities[0] if len(critic_identities) == 1 else None
    )
    execution_capsule["actors"]["critics"] = critic_identities
    execution_capsule["actors"]["critic_state"] = (
        "INDEPENDENT_EXECUTION_BOUND"
        if len(critic_identities) == 1
        else "INDEPENDENT_EXECUTION_SET_BOUND"
    )
    validate_schema(
        execution_capsule,
        "foundation_execution_context_capsule.schema.json",
        "final execution context capsule",
    )
    execution_capsule_sha256 = write_new_json(
        final_root / "execution-context-capsule.json",
        execution_capsule,
    )

    report = {
        "schema_version": "dime-foundation-pilot-report-v1",
        "execution_id": "foundation-pilot-local-001-final",
        "generated_at": args.finalized_at,
        "source_commit": initial_report["source_commit"],
        "status": "PASS",
        "counts": counts,
        "gates": gates,
        "route_token_report": {
            "path": "route-token-report.json",
            "sha256": route_report_sha256,
            "stage": "APPROVED_TRAINER_CONVERSION",
            "totals": final_route_report["totals"],
        },
        "artifact_bindings": {
            "execution_context_capsule_sha256": execution_capsule_sha256,
            "token_profile_sha256": token_profile_sha256,
            "context_packet_manifest_sha256": context_manifest_sha256,
            "authoring_manifest_sha256": authoring_manifest_sha256,
            "trainer_manifest_sha256": trainer_manifest_sha256,
            "partition_registry_sha256": partition_registry_sha256,
        },
        "automatic_progression": {
            "target": "live_data_150_records_135_train_15_validation",
            "authorized": True,
            "status": "AUTHORIZED",
            "reason": (
                "The explicit user request authorizes the first live_data shard only after "
                "this 20-record pilot reaches PASS with every required gate at zero."
            ),
            "authorization_basis": {
                "kind": "EXPLICIT_USER_REQUEST_ATTACHMENT",
                "source_id": "f6ac81bb-a336-41c3-a653-539ed07c7cb8",
                "source_sha256": (
                    "b371b696c203e5fa8e160a11f9b869734361d594de4728b08ab133518dbc5b1f"
                ),
                "condition": "PILOT_PASS_WITH_ALL_REQUIRED_GATES_ZERO",
            },
        },
    }
    validate_schema(report, "foundation_pilot_report.schema.json", "final pilot report")
    write_new_json(final_root / "pilot-report.json", report)

    artifact_paths = [
        path.relative_to(final_root) for path in sorted(final_root.rglob("*")) if path.is_file()
    ]
    manifest = file_manifest(final_root, artifact_paths)
    write_new_json(final_root / "manifest.json", manifest)
    checksum_lines = [
        f"{sha256_file(path)}  {path.relative_to(final_root).as_posix()}\n"
        for path in sorted(final_root.rglob("*"))
        if path.is_file() and path.name != "SHA256SUMS"
    ]
    write_new_bytes(final_root / "SHA256SUMS", "".join(checksum_lines).encode())
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
