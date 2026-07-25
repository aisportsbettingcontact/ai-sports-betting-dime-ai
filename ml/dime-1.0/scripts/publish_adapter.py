#!/usr/bin/env python
"""Fail-closed, adapter-only Hugging Face publisher."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path

from huggingface_hub import HfApi

REQUIRED_FILES = {
    "adapter_config.json",
    "adapter_model.safetensors",
    "chat_template.jinja",
    "generation_config.json",
    "LICENSE.llama3.1",
    "NOTICE",
    "README.md",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "training_manifest.json",
}
OPTIONAL_FILES = {"added_tokens.json"}
MAX_ADAPTER_BYTES = 2 * 1024**3
SECRET_PATTERNS = [
    re.compile(r"\bhf_[A-Za-z0-9]{12,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+"),
]
TEXT_FILES = {
    ".json",
    ".jinja",
    ".md",
    ".txt",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter-dir", type=Path, required=True)
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--confirm-repo", required=True)
    parser.add_argument("--evaluation-report", type=Path, required=True)
    parser.add_argument("--release-attestation", type=Path, required=True)
    parser.add_argument(
        "--private",
        action="store_true",
        help="The existing repository must already have the requested visibility.",
    )
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_release_time(value: object) -> None:
    if not isinstance(value, str):
        raise SystemExit("Release attestation requires approved_at_utc.")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SystemExit("approved_at_utc must include an explicit UTC offset.")
    if parsed.utcoffset().total_seconds() != 0:
        raise SystemExit("approved_at_utc must be normalized to UTC.")


def scan_artifacts(files: list[Path]) -> None:
    for path in files:
        if path.is_symlink():
            raise SystemExit(f"Symlinks are not publishable: {path.name}")
        if path.name.startswith("."):
            raise SystemExit(f"Hidden files are not publishable: {path.name}")
        if path.suffix.lower() not in TEXT_FILES:
            continue
        text = path.read_text(errors="replace")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                raise SystemExit(f"Possible secret detected in {path.name}")


def main() -> None:
    args = parse_args()
    adapter_dir = args.adapter_dir.resolve()
    if args.repo_id != args.confirm_repo:
        raise SystemExit("Repository confirmation does not match --repo-id.")
    model_name = args.repo_id.rsplit("/", 1)[-1]
    if not model_name.startswith("Llama"):
        raise SystemExit("A Llama derivative repository name must begin with 'Llama'.")
    if not adapter_dir.is_dir():
        raise SystemExit(f"Adapter directory not found: {adapter_dir}")

    files = [path for path in adapter_dir.iterdir() if path.is_file() or path.is_symlink()]
    nested = [path for path in adapter_dir.rglob("*") if path.parent != adapter_dir]
    if nested:
        raise SystemExit("Nested directories/files are not allowed in a publish artifact.")
    present = {path.name for path in files}
    missing = REQUIRED_FILES - present
    unknown = present - REQUIRED_FILES - OPTIONAL_FILES
    if missing:
        raise SystemExit(f"Adapter directory is missing: {sorted(missing)}")
    if unknown:
        raise SystemExit(f"Unknown files are blocked from upload: {sorted(unknown)}")
    scan_artifacts(files)
    total_size = sum(path.stat().st_size for path in files)
    if total_size > MAX_ADAPTER_BYTES:
        raise SystemExit(f"Adapter directory is unexpectedly large: {total_size / 1e9:.2f} GB")

    manifest_path = adapter_dir / "training_manifest.json"
    model_card_path = adapter_dir / "README.md"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("artifact_kind") != "peft_adapter":
        raise SystemExit("training_manifest.json does not identify a PEFT adapter.")
    if manifest.get("run_mode") == "rehearsal":
        raise SystemExit("Rehearsal adapters cannot be published.")
    model_card = model_card_path.read_text()
    if "TODO" in model_card:
        raise SystemExit("Model card still contains TODO fields.")
    for disclosure in ("Built with Llama", "AI-generated"):
        if disclosure.lower() not in model_card.lower():
            raise SystemExit(f"Model card is missing required disclosure: {disclosure}")

    evaluation = json.loads(args.evaluation_report.read_text())
    if evaluation.get("summary", {}).get("release_gate_pass") is not True:
        raise SystemExit("Evaluation report does not pass release gates.")
    if evaluation.get("summary", {}).get("control_mode") is True:
        raise SystemExit("A control-mode report cannot authorize release.")

    attestation = json.loads(args.release_attestation.read_text())
    if attestation.get("schema_version") != "dime-release-attestation-v1":
        raise SystemExit("Unsupported release-attestation schema.")
    if attestation.get("public_release_approved") is not True:
        raise SystemExit("Public/private registry release has not been approved.")
    if attestation.get("repo_id") != args.repo_id:
        raise SystemExit("Release attestation is bound to a different repository.")
    if not attestation.get("approver"):
        raise SystemExit("Release attestation requires an approver.")
    validate_release_time(attestation.get("approved_at_utc"))

    expected_hashes = {
        "adapter_model_sha256": file_sha256(adapter_dir / "adapter_model.safetensors"),
        "training_manifest_sha256": file_sha256(manifest_path),
        "model_card_sha256": file_sha256(model_card_path),
        "evaluation_report_sha256": file_sha256(args.evaluation_report),
        "chat_template_sha256": file_sha256(adapter_dir / "chat_template.jinja"),
    }
    for field, expected in expected_hashes.items():
        if attestation.get(field) != expected:
            raise SystemExit(f"Release attestation hash mismatch: {field}")
    approval_fields = {
        "base_model_license_reviewed",
        "adapter_license_reviewed",
        "code_license_reviewed",
        "dataset_rights_reviewed",
        "evaluation_rights_reviewed",
        "feed_rights_reviewed",
        "privacy_reviewed",
        "responsible_gaming_reviewed",
        "security_reviewed",
    }
    approvals = attestation.get("approvals", {})
    missing_approvals = sorted(
        field for field in approval_fields if approvals.get(field) is not True
    )
    if missing_approvals:
        raise SystemExit(f"Release approvals incomplete: {missing_approvals}")

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    api = HfApi(token=token)
    info = api.model_info(args.repo_id, token=token)
    if bool(info.private) != bool(args.private):
        raise SystemExit(
            "Repository visibility does not match the command. "
            "Review the existing Hugging Face repository before uploading."
        )
    api.upload_folder(
        repo_id=args.repo_id,
        repo_type="model",
        folder_path=str(adapter_dir),
        commit_message=f"Upload reviewed Dime adapter {manifest.get('run_name', '')}".strip(),
        token=token,
        allow_patterns=sorted(REQUIRED_FILES | OPTIONAL_FILES),
    )
    print(f"Published reviewed adapter-only artifact to {args.repo_id}")


if __name__ == "__main__":
    main()
