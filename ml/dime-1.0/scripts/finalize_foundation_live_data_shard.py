#!/usr/bin/env python
"""Fail-closed composition and conversion for the first accepted live-data shard."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
from copy import deepcopy
from datetime import UTC, datetime
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
    context_efficiency_report,
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
SOURCE_COMMIT = "b9ba7788749365253a6f725fee2a2a367a3475dd"
EXECUTION_ID = "foundation-live-data-shard-001-accepted-b9ba7788"
NUMERIC_TOKEN = re.compile(r"(?<![A-Za-z0-9_])[-+]?(?:\d+(?:\.\d+)?|\.\d+)%?")


class LiveDataFinalizationError(ValueError):
    """Raised before output when any acceptance precondition is incomplete."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--repair-root", type=Path, required=True)
    parser.add_argument("--second-review-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def _render_utc(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _private_input(path: Path, label: str) -> Path:
    absolute = path.absolute()
    resolved = absolute.resolve(strict=True)
    if (
        resolved != absolute
        or not resolved.is_dir()
        or not resolved.is_relative_to(PRIVATE_ROOT.resolve(strict=True))
    ):
        raise LiveDataFinalizationError(f"{label} must be a real directory below data/private")
    return resolved


def _private_output(path: Path) -> Path:
    absolute = path.absolute()
    if absolute.exists() or absolute.is_symlink():
        raise LiveDataFinalizationError(f"output already exists: {absolute}")
    if not absolute.parent.resolve(strict=True).is_relative_to(PRIVATE_ROOT.resolve(strict=True)):
        raise LiveDataFinalizationError("output must be below data/private")
    return absolute


def _load_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise LiveDataFinalizationError(f"{label} must be a regular file: {path}")
    value = load_governed_json(path)
    if not isinstance(value, dict):
        raise LiveDataFinalizationError(f"{label} must contain one JSON object")
    return value


def _inventory(root: Path, relative_glob: str) -> dict[str, Path]:
    result = {}
    for path in sorted(root.glob(relative_glob)):
        value = _load_object(path, "inventory item")
        record_id = value["record_id"]
        if record_id in result:
            raise LiveDataFinalizationError(f"duplicate inventory id: {record_id}")
        result[record_id] = path
    return result


def _all_file_manifest(root: Path) -> dict[str, Any]:
    paths = [path.relative_to(root) for path in sorted(root.rglob("*")) if path.is_file()]
    result = file_manifest(root, paths)
    result["file_count"] = len(paths)
    return result


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> str:
    content = b"".join(canonical_json_bytes(value) for value in values)
    write_new_bytes(path, content)
    return hashlib.sha256(content).hexdigest()


def _write_sha256sums(root: Path) -> None:
    lines = [
        f"{sha256_file(path)}  {path.relative_to(root).as_posix()}\n"
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.name != "SHA256SUMS"
    ]
    write_new_bytes(root / "SHA256SUMS", "".join(lines).encode("utf-8"))


def _verify_sha256sums(root: Path) -> int:
    checksum_path = root / "SHA256SUMS"
    if checksum_path.is_symlink() or not checksum_path.is_file():
        raise LiveDataFinalizationError("second review requires SHA256SUMS")
    seen = set()
    for number, line in enumerate(
        checksum_path.read_text(encoding="utf-8").splitlines(),
        1,
    ):
        if "  " not in line:
            raise LiveDataFinalizationError(f"second-review SHA256SUMS line {number} is malformed")
        expected, relative_text = line.split("  ", 1)
        relative = Path(relative_text)
        if (
            not re.fullmatch(r"[0-9a-f]{64}", expected)
            or relative.is_absolute()
            or ".." in relative.parts
            or relative_text in seen
        ):
            raise LiveDataFinalizationError(f"second-review SHA256SUMS line {number} is unsafe")
        path = root / relative
        if path.is_symlink() or not path.is_file() or sha256_file(path) != expected:
            raise LiveDataFinalizationError(f"second-review checksum mismatch: {relative_text}")
        seen.add(relative_text)
    expected_inventory = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.name != "SHA256SUMS"
    }
    if seen != expected_inventory:
        missing = sorted(expected_inventory - seen)
        unexpected = sorted(seen - expected_inventory)
        raise LiveDataFinalizationError(
            "second-review checksum inventory is not exhaustive: "
            f"missing={missing}, unexpected={unexpected}"
        )
    return len(seen)


def _mode_failures(root: Path) -> list[str]:
    failures = []
    for path in [root, *sorted(root.rglob("*"))]:
        expected = 0o700 if path.is_dir() else 0o600
        mode = stat.S_IMODE(path.stat().st_mode)
        if path.is_symlink() or mode != expected:
            failures.append(f"{path.relative_to(root)}:{mode:04o}")
    return failures


def _load_evaluation_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    def walk(value: object) -> None:
        if isinstance(value, dict):
            if isinstance(value.get("case_id"), str) and isinstance(value.get("messages"), list):
                records.append(value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    for path in sorted((ML_ROOT / "data" / "eval").glob("*")):
        if path.suffix == ".jsonl":
            values = [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        elif path.suffix == ".json":
            values = [json.loads(path.read_text(encoding="utf-8"))]
        else:
            continue
        for value in values:
            walk(value)
    return records


def required_repair_decision_gate(
    repair_ids: set[str],
    decisions: dict[str, dict[str, Any]],
    carried_findings: dict[str, set[str]],
) -> None:
    """Require the exact independent-review boundary before any composition."""

    if len(repair_ids) != 100 or set(decisions) != repair_ids:
        raise LiveDataFinalizationError("repair decision gate requires exactly 100 decisions")
    resolved = 0
    for record_id in sorted(repair_ids):
        decision = decisions[record_id]
        finding_ids = {finding["finding_id"] for finding in decision["findings"]}
        if (
            decision["decision"] != "approved"
            or decision["unresolved_material_findings"] != 0
            or decision["deterministic_validation_passed"] is not True
            or any(not finding["resolved"] for finding in decision["findings"])
            or finding_ids != carried_findings[record_id]
        ):
            raise LiveDataFinalizationError(
                f"{record_id}: repair decision is not an exact approval"
            )
        resolved += len(finding_ids)
    if resolved != 110:
        raise LiveDataFinalizationError(
            f"repair decision gate requires 110 resolved carried findings; got {resolved}"
        )


def required_second_review_gate(
    selected_drafts: dict[str, dict[str, Any]],
    decisions: dict[str, dict[str, Any]],
) -> None:
    if len(selected_drafts) != 150 or set(decisions) != set(selected_drafts):
        raise LiveDataFinalizationError("second-review gate requires exactly 150 decisions")
    for record_id, draft in selected_drafts.items():
        decision = decisions[record_id]
        if (
            decision["decision"] != "approved"
            or decision["draft_sha256"] != draft["draft_sha256"]
            or decision["unresolved_material_findings"] != 0
            or decision["deterministic_validation_passed"] is not True
            or any(not finding["resolved"] for finding in decision["findings"])
        ):
            raise LiveDataFinalizationError(f"{record_id}: second review is not an exact approval")


def _verify_manifest_entries(
    root: Path,
    manifest: dict[str, Any],
    expected_paths: set[str],
    label: str,
) -> None:
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise LiveDataFinalizationError(f"{label} entries are missing")
    by_path = {
        entry.get("path"): entry
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    }
    if len(by_path) != len(entries) or set(by_path) != expected_paths:
        raise LiveDataFinalizationError(f"{label} inventory does not match exact files")
    for relative_text, entry in by_path.items():
        relative = Path(relative_text)
        if relative.is_absolute() or ".." in relative.parts:
            raise LiveDataFinalizationError(f"{label} contains an unsafe path")
        path = root / relative
        if (
            path.is_symlink()
            or not path.is_file()
            or entry.get("bytes") != path.stat().st_size
            or entry.get("sha256") != sha256_file(path)
        ):
            raise LiveDataFinalizationError(f"{label} file binding failed: {relative_text}")


def required_second_review_artifact_gate(
    root: Path,
    selected_drafts: dict[str, dict[str, Any]],
) -> None:
    """Verify the aggregate independent-review verdict and all of its manifests."""

    review_id = "foundation-live-data-shard-001-second-review-001"
    report = _load_object(root / "second-review-report.json", "second-review report")
    decision_manifest = _load_object(
        root / "decision-manifest.json",
        "second-review decision manifest",
    )
    context_manifest = _load_object(
        root / "context-manifest.json",
        "second-review context manifest",
    )
    artifact_manifest = _load_object(root / "manifest.json", "second-review artifact manifest")
    expected_counts = {
        "approvals": 150,
        "context_packets": 150,
        "decision_receipts": 150,
        "execution_receipts": 150,
        "original_records": 50,
        "prior_findings_closed": 110,
        "repaired_records": 100,
        "selected_records": 150,
        "train": 135,
        "unresolved_material_findings": 0,
        "validation": 15,
    }
    expected_authorization = {
        "commit": False,
        "credential_access": False,
        "dataset_finalization": False,
        "deployment": False,
        "external_upload": False,
        "provider_invocation": False,
        "publication": False,
        "pull_request": False,
        "push": False,
        "railway_mutation": False,
        "routing": False,
        "tracing": False,
        "training": False,
    }
    if (
        report.get("schema_version") != "dime-foundation-live-data-second-review-report-v1"
        or report.get("review_id") != review_id
        or report.get("source_commit") != SOURCE_COMMIT
        or report.get("status") != "PASS"
        or report.get("counts") != expected_counts
        or not isinstance(report.get("gates"), dict)
        or not report["gates"]
        or any(value != 0 for value in report["gates"].values())
        or report.get("authorization_boundary") != expected_authorization
        or report.get("permissions") != {"directory_mode": "0700", "file_mode": "0600"}
        or report.get("external_operations")
        != {"credential_accesses": 0, "external_writes": 0, "network_calls": 0}
        or report.get("actor", {}).get("actor_id")
        != "codex-foundation-live-data-second-independent-critic-001"
        or report.get("actor", {}).get("responsibility") != "second_independent_critique"
    ):
        raise LiveDataFinalizationError("second-review aggregate verdict drifted")
    bindings = report.get("bindings", {})
    if (
        bindings.get("decision_manifest_sha256") != sha256_file(root / "decision-manifest.json")
        or bindings.get("context_manifest_sha256") != sha256_file(root / "context-manifest.json")
        or bindings.get("critic_prompt_revision") != CRITIC_PROMPT_REVISION
        or bindings.get("critic_prompt_sha256") != sha256_file(CRITIC_PROMPT_PATH)
    ):
        raise LiveDataFinalizationError("second-review report bindings drifted")

    selected_ids = set(selected_drafts)
    for manifest, schema_version, directory, label in (
        (
            decision_manifest,
            "dime-foundation-second-review-decision-manifest-v1",
            "critic-decisions",
            "second-review decision manifest",
        ),
        (
            context_manifest,
            "dime-foundation-second-review-context-manifest-v1",
            "context-packets/critic",
            "second-review context manifest",
        ),
    ):
        entries = manifest.get("entries")
        if (
            manifest.get("schema_version") != schema_version
            or manifest.get("review_id") != review_id
            or manifest.get("record_count") != 150
            or not isinstance(entries, list)
            or len(entries) != 150
            or {entry.get("record_id") for entry in entries} != selected_ids
        ):
            raise LiveDataFinalizationError(f"{label} aggregate drifted")
        expected_paths = {f"{directory}/{record_id}.json" for record_id in selected_ids}
        _verify_manifest_entries(root, manifest, expected_paths, label)
        for entry in entries:
            draft = selected_drafts[entry["record_id"]]
            if entry.get("draft_sha256") != draft["draft_sha256"]:
                raise LiveDataFinalizationError(
                    f"{entry['record_id']}: {label} draft binding drifted"
                )

    expected_artifact_paths = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.name not in {"SHA256SUMS", "manifest.json"}
    }
    if (
        artifact_manifest.get("schema_version") != "dime-foundation-artifact-manifest-v1"
        or artifact_manifest.get("artifact_id") != review_id
        or artifact_manifest.get("file_count") != len(expected_artifact_paths)
    ):
        raise LiveDataFinalizationError("second-review artifact manifest drifted")
    _verify_manifest_entries(
        root,
        artifact_manifest,
        expected_artifact_paths,
        "second-review artifact manifest",
    )


def _context_and_decision(
    *,
    root: Path,
    draft: dict[str, Any],
    decision: dict[str, Any],
    draft_unit_id: str,
    draft_source_prefix: str,
) -> dict[str, Any]:
    record_id = draft["record_id"]
    validate_schema(
        decision,
        "foundation_critic_decision.schema.json",
        f"{record_id} decision",
    )
    path = root / "context-packets" / "critic" / f"{record_id}.json"
    packet = _load_object(path, f"{record_id} critic context")
    validate_schema(
        packet,
        "foundation_context_packet.schema.json",
        f"{record_id} critic context",
    )
    context_sha256 = sha256_json(packet)
    units = {unit["unit_id"]: unit for unit in packet["units"]}
    prompt_unit = units.get("critic-prompt")
    draft_unit = units.get(draft_unit_id)
    prompt_sha256 = sha256_file(CRITIC_PROMPT_PATH)
    if (
        decision["record_id"] != record_id
        or decision["draft_sha256"] != draft["draft_sha256"]
        or draft["draft_sha256"] != sha256_json(draft["record_payload"])
        or packet["record_id"] != record_id
        or packet["role"] != "independent_critique"
        or packet["route"] != draft["record_payload"]["route"]
        or decision["critic_context_packet_sha256"] != context_sha256
        or decision["critic"]["context_sha256"] != context_sha256
        or not isinstance(prompt_unit, dict)
        or prompt_unit["source_path"] != "prompts/foundation_critique_pilot_v1.md"
        or prompt_unit["source_sha256"] != prompt_sha256
        or prompt_unit["content_sha256"] != prompt_sha256
        or not isinstance(draft_unit, dict)
        or draft_unit["source_path"] != f"{draft_source_prefix}/{record_id}"
        or draft_unit["source_sha256"] != draft["draft_sha256"]
        or draft_unit["content_sha256"] != draft["draft_sha256"]
    ):
        raise LiveDataFinalizationError(
            f"{record_id}: decision context does not bind the exact draft"
        )
    critic = decision["critic"]
    generator = draft["record_payload"]["provenance"]["generator"]
    for field in CRITIC_INDEPENDENCE_MUST_DIFFER:
        if critic[field] == generator[field]:
            raise LiveDataFinalizationError(
                f"{record_id}: critic shares prohibited generator {field}"
            )
    if (
        critic["prompt_revision"] != CRITIC_PROMPT_REVISION
        or critic["prompt_sha256"] != prompt_sha256
        or critic["execution_receipt_sha256"]
        != expected_critic_execution_receipt_sha256(
            record_id=record_id,
            draft_sha256=draft["draft_sha256"],
            critic=critic,
            context_sha256=context_sha256,
            reviewed_at=decision["reviewed_at"],
        )
        or decision["decision_receipt_sha256"] != expected_critic_decision_receipt_sha256(decision)
    ):
        raise LiveDataFinalizationError(f"{record_id}: critic identity or receipt mismatch")
    return packet


def _merge_review(
    draft: dict[str, Any],
    primary_decision: dict[str, Any],
    second_decision: dict[str, Any],
) -> dict[str, Any]:
    record = deepcopy(draft["record_payload"])
    record["provenance"]["critic"] = deepcopy(primary_decision["critic"])
    record["independent_review"] = {
        "decision": primary_decision["decision"],
        "rubric_version": primary_decision["rubric_version"],
        "reviewed_at": max(
            primary_decision["reviewed_at"],
            second_decision["reviewed_at"],
        ),
        "unresolved_material_findings": 0,
        "deterministic_validation_passed": primary_decision["deterministic_validation_passed"]
        and second_decision["deterministic_validation_passed"],
        "review_receipts": [
            {
                "reviewer_id": decision["critic"]["actor_id"],
                "decision_receipt_sha256": decision["decision_receipt_sha256"],
            }
            for decision in (primary_decision, second_decision)
        ],
    }
    return record


def main() -> None:
    args = parse_args()
    captured = _utc_now()
    created_at = _render_utc(captured)
    source_root = _private_input(args.source_root, "source root")
    repair_root = _private_input(args.repair_root, "repair root")
    second_review_root = _private_input(
        args.second_review_root,
        "second-review root",
    )
    output_root = _private_output(args.output_root)

    source_report = _load_object(source_root / "shard-report.json", "source report")
    repair_report = _load_object(repair_root / "repair-report.json", "repair report")
    if (
        source_report["status"] != "READY_FOR_INDEPENDENT_CRITIQUE"
        or source_report["counts"]
        != {
            "accepted_records": 0,
            "drafts": 150,
            "train": 135,
            "trainer_records": 0,
            "validation": 15,
        }
        or repair_report["status"] != "READY_FOR_INDEPENDENT_REREVIEW"
        or repair_report["counts"]["repaired_records"] != 100
        or repair_report["counts"]["critic_findings_addressed"] != 110
    ):
        raise LiveDataFinalizationError("source or repair report boundary drifted")

    source_draft_paths = _inventory(source_root, "drafts/*/*.json")
    source_decision_paths = _inventory(source_root, "critic-decisions/*.json")
    repair_draft_paths = _inventory(repair_root, "drafts/*/*.json")
    repair_decision_paths = _inventory(repair_root, "critic-decisions/*.json")
    if (
        len(source_draft_paths) != 150
        or len(source_decision_paths) != 150
        or len(repair_draft_paths) != 100
    ):
        raise LiveDataFinalizationError("source or repair inventory count drifted")

    source_drafts = {
        record_id: _load_object(path, f"{record_id} source draft")
        for record_id, path in source_draft_paths.items()
    }
    source_decisions = {
        record_id: _load_object(path, f"{record_id} source decision")
        for record_id, path in source_decision_paths.items()
    }
    repair_drafts = {
        record_id: _load_object(path, f"{record_id} repair draft")
        for record_id, path in repair_draft_paths.items()
    }
    repair_decisions = {
        record_id: _load_object(path, f"{record_id} repair decision")
        for record_id, path in repair_decision_paths.items()
    }
    approved_original_ids = {
        record_id
        for record_id, decision in source_decisions.items()
        if decision["decision"] == "approved"
    }
    repair_ids = {
        record_id
        for record_id, decision in source_decisions.items()
        if decision["decision"] == "changes_requested"
    }
    carried_findings = {
        record_id: {finding["finding_id"] for finding in decision["findings"]}
        for record_id, decision in source_decisions.items()
        if record_id in repair_ids
    }
    if (
        len(approved_original_ids) != 50
        or len(repair_ids) != 100
        or set(repair_drafts) != repair_ids
        or sum(len(values) for values in carried_findings.values()) != 110
    ):
        raise LiveDataFinalizationError("source decision partition drifted")

    # This gate intentionally executes before any output directory is created.
    required_repair_decision_gate(
        repair_ids,
        repair_decisions,
        carried_findings,
    )
    selected_drafts = {
        record_id: (
            repair_drafts[record_id] if record_id in repair_ids else source_drafts[record_id]
        )
        for record_id in source_drafts
    }
    second_review_decision_paths = _inventory(
        second_review_root,
        "critic-decisions/*.json",
    )
    second_review_decisions = {
        record_id: _load_object(path, f"{record_id} second-review decision")
        for record_id, path in second_review_decision_paths.items()
    }
    required_second_review_gate(selected_drafts, second_review_decisions)
    if _verify_sha256sums(second_review_root) == 0:
        raise LiveDataFinalizationError("second-review checksum inventory is empty")
    required_second_review_artifact_gate(second_review_root, selected_drafts)

    source_manifest_before = _all_file_manifest(source_root)
    repair_manifest_before = _all_file_manifest(repair_root)
    second_review_manifest_before = _all_file_manifest(second_review_root)
    critic_packets = []
    generator_packets = []
    records = []
    trainer_records = []
    encoded_records = []
    selection_rows = []
    rights_failures = 0
    source_packets = {}
    for path in sorted((source_root / "source-packets").glob("*.json")):
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

    profile = token_profile()
    tokenizer = DeterministicByteTokenizer()
    schema_failures = 0
    critic_independence_failures = 0
    decision_receipt_failures = 0
    context_binding_failures = 0
    numeric_errors = 0
    conversion_failures = 0
    conversion_error_samples: list[str] = []
    silent_truncations = 0
    unresolved_material_findings = 0
    for record_id in sorted(source_drafts):
        use_repair = record_id in repair_ids
        root = repair_root if use_repair else source_root
        draft = repair_drafts[record_id] if use_repair else source_drafts[record_id]
        decision = repair_decisions[record_id] if use_repair else source_decisions[record_id]
        second_decision = second_review_decisions[record_id]
        try:
            packet = _context_and_decision(
                root=root,
                draft=draft,
                decision=decision,
                draft_unit_id="repaired-draft" if use_repair else "authoring-draft",
                draft_source_prefix=(
                    "private:live-data-repair-draft" if use_repair else "private:live-data-draft"
                ),
            )
            second_packet = _context_and_decision(
                root=second_review_root,
                draft=draft,
                decision=second_decision,
                draft_unit_id="selected-draft",
                draft_source_prefix="private:accepted-selection-draft",
            )
        except FoundationInstrumentationError:
            context_binding_failures += 1
            continue
        except LiveDataFinalizationError as error:
            if "receipt" in str(error):
                decision_receipt_failures += 1
            elif "critic" in str(error):
                critic_independence_failures += 1
            else:
                context_binding_failures += 1
            continue
        if (
            decision["critic"]["actor_id"] == second_decision["critic"]["actor_id"]
            or decision["decision_receipt_sha256"] == second_decision["decision_receipt_sha256"]
            or sha256_json(packet) == sha256_json(second_packet)
        ):
            critic_independence_failures += 1
            continue
        if (
            decision["decision"] != "approved"
            or decision["unresolved_material_findings"] != 0
            or any(not finding["resolved"] for finding in decision["findings"])
            or second_decision["decision"] != "approved"
            or second_decision["unresolved_material_findings"] != 0
            or any(not finding["resolved"] for finding in second_decision["findings"])
        ):
            unresolved_material_findings += 1
            continue
        record = _merge_review(draft, decision, second_decision)
        issues = validate_foundation_record(record)
        if issues:
            schema_failures += 1
            continue
        reference = record["source_reference"]
        source_packet = source_packets.get(reference["packet_id"])
        if (
            source_packet is None
            or source_packet["snapshot_sha256"] != reference["snapshot_sha256"]
            or source_packet["source_locator"] != reference["locator"]
        ):
            rights_failures += 1
            continue
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
        except (DataFactoryError, ValueError) as error:
            conversion_failures += 1
            if len(conversion_error_samples) < 3:
                conversion_error_samples.append(f"{record_id}: {error}")
            continue
        if converted["silent_truncation"]:
            silent_truncations += 1
            continue
        generator_path = root / "context-packets" / "generator" / f"{record_id}.json"
        generator_packet = _load_object(
            generator_path,
            f"{record_id} generator context",
        )
        generator_context_sha256 = sha256_json(generator_packet)
        if (
            draft["generator_context_packet_sha256"] != generator_context_sha256
            or record["provenance"]["generator"]["context_sha256"] != generator_context_sha256
        ):
            context_binding_failures += 1
            continue
        records.append(record)
        trainer_records.append(converted["trainer_record"])
        encoded_records.append(
            {
                "record_id": record_id,
                "route": "live_data",
                "encoded": converted["encoded"],
            }
        )
        generator_packets.append(generator_packet)
        critic_packets.append(packet)
        critic_packets.append(second_packet)
        selection_rows.append(
            {
                "record_id": record_id,
                "source": "repair-001" if use_repair else "original",
                "source_draft_file_sha256": sha256_file(
                    repair_draft_paths[record_id] if use_repair else source_draft_paths[record_id]
                ),
                "draft_sha256": draft["draft_sha256"],
                "decision_file_sha256": sha256_file(
                    repair_decision_paths[record_id]
                    if use_repair
                    else source_decision_paths[record_id]
                ),
                "second_review_decision_file_sha256": sha256_file(
                    second_review_decision_paths[record_id]
                ),
            }
        )

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
    r5_overlap = _development_contamination(
        trainer_records,
        _load_evaluation_records(),
        shingle_size=5,
        threshold=0.80,
    )
    counts = {
        "accepted_records": len(records),
        "trainer_records": len(trainer_records),
        "train": sum(record["split"] == "train" for record in records),
        "validation": sum(record["split"] == "validation" for record in records),
        "approved_originals": sum(row["source"] == "original" for row in selection_rows),
        "approved_repairs": sum(row["source"] == "repair-001" for row in selection_rows),
        "resolved_carried_findings": sum(len(values) for values in carried_findings.values()),
    }
    source_preservation_failures = int(
        _all_file_manifest(source_root) != source_manifest_before
        or _all_file_manifest(repair_root) != repair_manifest_before
        or _all_file_manifest(second_review_root) != second_review_manifest_before
    )
    gates = {
        "schema_failures": schema_failures,
        "rights_failures": rights_failures,
        "partition_collisions": partition_collisions,
        "numeric_errors": numeric_errors,
        "conversion_failures": conversion_failures,
        "silent_truncations": silent_truncations,
        "r5_evaluation_overlap": len(r5_overlap),
        "exact_duplicates": len(exact_duplicates),
        "semantic_duplicate_pairs": len(semantic_neighbors),
        "critic_independence_failures": critic_independence_failures,
        "unresolved_material_findings": unresolved_material_findings,
        "decision_receipt_failures": decision_receipt_failures,
        "context_binding_failures": context_binding_failures,
        "source_preservation_failures": source_preservation_failures,
        "mode_failures": 0,
        "future_timestamp_failures": int(captured > _utc_now()),
    }
    required_counts = {
        "accepted_records": 150,
        "trainer_records": 150,
        "train": 135,
        "validation": 15,
        "approved_originals": 50,
        "approved_repairs": 100,
        "resolved_carried_findings": 110,
    }
    if counts != required_counts or any(gates.values()):
        raise LiveDataFinalizationError(
            "final acceptance gates failed: "
            + json.dumps(
                {
                    "counts": counts,
                    "gates": gates,
                    "conversion_error_samples": conversion_error_samples,
                },
                sort_keys=True,
            )
        )

    route_report = route_token_report(
        encoded_records,
        generator_packets + critic_packets,
    )
    route_report["stage"] = "APPROVED_TRAINER_CONVERSION"
    efficiency_report = context_efficiency_report(generator_packets + critic_packets)

    # Output creation occurs only after the complete independent-review and data gates.
    os.umask(0o077)
    output_root.mkdir(mode=0o700)
    records_by_id = {record["record_id"]: record for record in records}
    trainer_by_id = {record["example_id"]: record for record in trainer_records}
    train_ids = sorted(
        record_id for record_id, record in records_by_id.items() if record["split"] == "train"
    )
    validation_ids = sorted(
        record_id for record_id, record in records_by_id.items() if record["split"] == "validation"
    )
    authoring_train_sha256 = _write_jsonl(
        output_root / "authoring" / "train.jsonl",
        [records_by_id[record_id] for record_id in train_ids],
    )
    authoring_validation_sha256 = _write_jsonl(
        output_root / "authoring" / "validation.jsonl",
        [records_by_id[record_id] for record_id in validation_ids],
    )
    trainer_train_sha256 = _write_jsonl(
        output_root / "trainer" / "train.jsonl",
        [trainer_by_id[record_id] for record_id in train_ids],
    )
    trainer_validation_sha256 = _write_jsonl(
        output_root / "trainer" / "validation.jsonl",
        [trainer_by_id[record_id] for record_id in validation_ids],
    )
    source_selection_manifest = {
        "schema_version": "dime-foundation-live-data-selection-manifest-v1",
        "status": "FROZEN",
        "record_count": 150,
        "entries": selection_rows,
    }
    source_selection_manifest_sha256 = write_new_json(
        output_root / "source-selection-manifest.json",
        source_selection_manifest,
    )
    second_review_source_manifest_sha256 = write_new_json(
        output_root / "second-review-source-manifest.json",
        second_review_manifest_before,
    )
    fail_closed_attempts = {
        "schema_version": "dime-foundation-live-data-fail-closed-attempts-v1",
        "recorded_at": created_at,
        "attempts": [
            {
                "sequence": 1,
                "gate": "REPAIR_DECISION_INVENTORY",
                "result": "BLOCKED_EXPECTED",
                "reason": (
                    "The repair revision contained zero of 100 required independent "
                    "decisions; composition stopped before output."
                ),
                "accepted_artifacts_written": False,
                "source_evidence_mutations": 0,
            },
            {
                "sequence": 2,
                "gate": "HIGH_RISK_REVIEWER_CARDINALITY",
                "result": "BLOCKED_EXPECTED",
                "reason": (
                    "The governed converter required two distinct reviewers for all "
                    "150 high-risk records; composition stopped before output."
                ),
                "accepted_artifacts_written": False,
                "source_evidence_mutations": 0,
            },
        ],
    }
    validate_schema(
        fail_closed_attempts,
        "foundation_live_data_fail_closed_attempts.schema.json",
        "fail-closed attempts",
    )
    fail_closed_attempts_sha256 = write_new_json(
        output_root / "fail-closed-attempts.json",
        fail_closed_attempts,
    )
    authoring_manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "status": "ACCEPTED_PRIVATE_NOT_RELEASED",
        "record_count": 150,
        "entries": [
            {
                "path": "authoring/train.jsonl",
                "records": 135,
                "sha256": authoring_train_sha256,
            },
            {
                "path": "authoring/validation.jsonl",
                "records": 15,
                "sha256": authoring_validation_sha256,
            },
        ],
    }
    authoring_manifest_sha256 = write_new_json(
        output_root / "authoring-manifest.json",
        authoring_manifest,
    )
    trainer_manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "status": "ACCEPTED_PRIVATE_NOT_RELEASED",
        "record_count": 150,
        "entries": [
            {
                "path": "trainer/train.jsonl",
                "records": 135,
                "sha256": trainer_train_sha256,
            },
            {
                "path": "trainer/validation.jsonl",
                "records": 15,
                "sha256": trainer_validation_sha256,
            },
        ],
    }
    trainer_manifest_sha256 = write_new_json(
        output_root / "trainer-manifest.json",
        trainer_manifest,
    )
    context_manifest = {
        "schema_version": "dime-foundation-artifact-manifest-v1",
        "status": "FROZEN",
        "packet_count": 450,
        "entries": [
            {
                "packet_id": packet["packet_id"],
                "record_id": packet["record_id"],
                "role": packet["role"],
                "sha256": sha256_json(packet),
            }
            for packet in sorted(
                generator_packets + critic_packets,
                key=lambda packet: (packet["record_id"], packet["role"]),
            )
        ],
    }
    context_manifest_sha256 = write_new_json(
        output_root / "context-manifest.json",
        context_manifest,
    )
    partition_registry_sha256 = write_new_json(
        output_root / "partition-registry.json",
        partition_registry,
    )
    token_profile_sha256 = write_new_json(
        output_root / "token-profile.json",
        profile,
    )
    route_token_report_sha256 = write_new_json(
        output_root / "route-token-report.json",
        route_report,
    )
    context_efficiency_report_sha256 = write_new_json(
        output_root / "context-efficiency-report.json",
        efficiency_report,
    )
    gates["mode_failures"] = len(_mode_failures(output_root))
    report = {
        "schema_version": "dime-foundation-live-data-final-report-v1",
        "execution_id": EXECUTION_ID,
        "created_at": created_at,
        "source_commit": SOURCE_COMMIT,
        "status": "PASS",
        "counts": counts,
        "gates": gates,
        "artifact_bindings": {
            "source_selection_manifest_sha256": (source_selection_manifest_sha256),
            "second_review_source_manifest_sha256": (second_review_source_manifest_sha256),
            "fail_closed_attempts_sha256": fail_closed_attempts_sha256,
            "authoring_manifest_sha256": authoring_manifest_sha256,
            "trainer_manifest_sha256": trainer_manifest_sha256,
            "context_manifest_sha256": context_manifest_sha256,
            "partition_registry_sha256": partition_registry_sha256,
            "token_profile_sha256": token_profile_sha256,
            "route_token_report_sha256": route_token_report_sha256,
            "context_efficiency_report_sha256": (context_efficiency_report_sha256),
        },
        "downstream_authorization": {
            "publication": False,
            "training": False,
            "deployment": False,
            "route_activation": False,
        },
        "external_operations": {
            "credential_reads": 0,
            "network_calls": 0,
            "provider_invocations": 0,
            "model_downloads": 0,
            "railway_mutations": 0,
            "production_data_reads": 0,
            "training_runs": 0,
            "publications": 0,
        },
    }
    validate_schema(
        report,
        "foundation_live_data_final_report.schema.json",
        "accepted live-data report",
    )
    write_new_json(output_root / "final-report.json", report)
    manifest_paths = [
        path.relative_to(output_root) for path in sorted(output_root.rglob("*")) if path.is_file()
    ]
    manifest = file_manifest(output_root, manifest_paths)
    manifest.update({"execution_id": EXECUTION_ID, "status": "PASS"})
    write_new_json(output_root / "manifest.json", manifest)
    _write_sha256sums(output_root)
    final_mode_failures = _mode_failures(output_root)
    if final_mode_failures:
        raise LiveDataFinalizationError(
            f"accepted artifact modes are not private: {final_mode_failures}"
        )
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (
        FoundationInstrumentationError,
        LiveDataFinalizationError,
        ValueError,
    ) as error:
        raise SystemExit(f"FINAL COMPOSITION BLOCKED: {error}") from error
