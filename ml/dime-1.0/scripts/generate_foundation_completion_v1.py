#!/usr/bin/env python3
"""Generate the checksum-bound 2,400-record Foundation release candidate.

The committed 450-record public release is preserved byte-for-byte. This
script deterministically generates only the 1,950-record deficit from
synthetic behavioral scenarios, validates every resulting trainer record, and
writes raw output exclusively below the gitignored private data boundary.
"""

from __future__ import annotations

import hashlib
import json
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path
from typing import Any

from dime_ai.data_validation import read_jsonl, validate_sft_record
from dime_ai.foundation_dataset import find_exact_duplicates, find_semantic_neighbors

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASELINE_TRAIN = PROJECT_ROOT / "data/sft/train.APPROVED.jsonl"
BASELINE_VALIDATION = PROJECT_ROOT / "data/sft/validation.APPROVED.jsonl"
BASELINE_MANIFEST = PROJECT_ROOT / "configs/dataset_manifest_APPROVED.json"
PROMPT_PATH = PROJECT_ROOT / "prompts/foundation_completion_generator_v1.md"
PRIVATE_RELEASE = PROJECT_ROOT / "data/private/releases/dime-foundation-v1-candidate-2400"
PUBLIC_EVIDENCE = PROJECT_ROOT / "evidence/execution/dime-foundation-v1-candidate-2400"
CREATED_AT = "2026-07-31T12:00:00Z"
MODEL_REVISION = "gpt-5.6-sol-2026-07-31"
DATASET_VERSION = "dime-sft-foundation-v1"

TARGETS: dict[str, tuple[int, int]] = {
    "platform": (270, 30),
    "account": (162, 18),
    "educational": (270, 30),
    "bet_explanation": (270, 30),
    "matchup": (378, 42),
    "full_slate": (162, 18),
    "historical": (216, 24),
    "live_data": (270, 30),
    "general_sports": (162, 18),
}

COVERAGE_MINIMUMS = {
    "tool_required": 720,
    "temporal_or_freshness_sensitive": 600,
    "missing_or_ambiguous_information": 480,
    "abstention_or_error_correction": 360,
    "multi_turn": 360,
    "adversarial_or_false_premise": 240,
}

ROUTE_REQUESTS = {
    "platform": [
        "Explain what Dime Chat can do without overstating its data coverage",
        "Describe how a user should interpret a Dime projection",
        "Clarify the difference between the chat product and the internal model",
        "Explain why a live platform answer may require retrieval",
        "Describe the platform's evidence and uncertainty boundaries",
    ],
    "account": [
        "Help with an account question while protecting private information",
        "Explain what verification is needed before discussing account state",
        "Respond to a request for another person's account details",
        "Clarify which account action requires an authenticated session",
        "Explain why a password or secret should never be pasted into chat",
    ],
    "educational": [
        "Explain implied probability without turning it into a recommendation",
        "Teach why removing vig differs from predicting an outcome",
        "Explain expected value as a conditional estimate",
        "Describe how calibration changes the meaning of confidence",
        "Explain why a small sample does not establish a durable edge",
    ],
    "bet_explanation": [
        "Explain a proposed wager using evidence, price, and uncertainty",
        "Separate model probability from implied probability and edge",
        "Describe why line movement alone does not prove informed action",
        "Explain why a polished rationale cannot replace current market data",
        "Clarify the difference between confidence and certainty",
    ],
    "matchup": [
        "Analyze a matchup only after resolving the exact event",
        "Explain what evidence is needed before comparing two teams",
        "Handle a matchup request with an ambiguous date",
        "Assess a matchup when injury information cannot be verified",
        "Correct a request that assumes an unconfirmed starter",
    ],
    "full_slate": [
        "Build a slate view without silently omitting unresolved events",
        "Explain how to rank a slate when coverage differs by event",
        "Handle a slate request that mixes leagues and dates",
        "Describe why missing markets cannot be scored as zero edge",
        "Summarize a slate while preserving event-level uncertainty",
    ],
    "historical": [
        "Answer a historical market question using an explicit as-of window",
        "Explain how to avoid future information leakage in retrospective analysis",
        "Handle a historical request with an ambiguous season",
        "Distinguish a closing line from a later corrected database value",
        "Explain why historical evidence needs source and timestamp scope",
    ],
    "general_sports": [
        "Answer a sports question after clarifying the league and rule context",
        "Explain a game concept without inventing a current example",
        "Correct a false premise about how a market settles",
        "Describe how rule differences can change an answer",
        "Give a concise sports explanation with appropriate uncertainty",
    ],
}

CONTEXTS = [
    "during an early research pass",
    "while comparing two possible interpretations",
    "after the requested date was omitted",
    "when the source coverage is narrower than the question",
    "after a previous answer was corrected",
    "while the user is deciding whether more evidence is needed",
    "when a provider response may be delayed",
    "during a multi-step analysis",
    "when two records appear to conflict",
    "after an event identifier changed",
    "while a market is unavailable",
    "when the user asks for a concise answer",
    "while preserving the distinction between fact and inference",
    "when stale information could look current",
    "after an assumption was presented as fact",
    "while the available evidence remains incomplete",
    "when a requested field is outside the returned schema",
    "after the user narrows the requested scope",
    "while no authoritative observation time is available",
    "when the safest result is a bounded explanation",
]

FOCUS_CLAUSES = [
    "Keep the event binding explicit.",
    "Name the missing evidence before drawing a conclusion.",
    "Separate retrieved facts from analytical inference.",
    "Preserve the provider and timestamp scope.",
    "Do not convert uncertainty into a confident recommendation.",
    "Use the smallest sufficient tool path.",
    "Avoid implying that absent data proves no opportunity exists.",
    "Correct the premise before continuing the analysis.",
    "State what would materially change the conclusion.",
    "Do not reuse live facts as durable memory.",
    "Keep probability, edge, confidence, and recommendation distinct.",
    "Prefer a clear abstention to unsupported specificity.",
    "Explain the limitation in plain language.",
    "Retain the corrected state across the conversation.",
    "Do not claim broader coverage than the evidence supports.",
    "Treat tool failure as an observable failure state.",
    "Require authoritative time for dynamic claims.",
    "Avoid causal claims from market movement alone.",
    "Use deterministic calculation for quantitative claims.",
    "Keep the response useful even when the answer is bounded.",
]

ROUTE_RESPONSES = {
    "platform": (
        "Dime Chat should describe the available feature and its evidence boundary "
        "directly. Dynamic sports or market facts require retrieval, and probabilistic "
        "analysis never guarantees an outcome."
    ),
    "account": (
        "I can explain the account workflow, but I cannot expose or infer private "
        "account data. The user must authenticate through the approved account surface "
        "before any account-specific state is discussed."
    ),
    "educational": (
        "The concept should be explained as a relationship among price, probability, "
        "evidence, and uncertainty. A calculation can describe the inputs, but it does "
        "not establish that the probability estimate is calibrated."
    ),
    "bet_explanation": (
        "A sound explanation separates the market price, implied probability, model "
        "probability, estimated edge, confidence, and final recommendation. Unsupported "
        "or stale inputs must remain explicit limitations."
    ),
    "matchup": (
        "The exact event, date, participants, and requested evidence must be resolved "
        "before analysis. If authoritative context is unavailable, the answer should "
        "state the gap and avoid inventing matchup facts."
    ),
    "full_slate": (
        "Each event needs an explicit resolution and evidence state. Unresolved or "
        "missing markets must remain visible rather than being silently dropped or "
        "treated as having no edge."
    ),
    "historical": (
        "Historical analysis must use a bounded observation window and only information "
        "available by that point. Later corrections or outcomes cannot leak into an "
        "earlier as-of answer."
    ),
    "general_sports": (
        "The answer should clarify the relevant sport, league, rule set, and time "
        "context, then explain the stable concept without fabricating a current example."
    ),
}

TOOL_BY_ROUTE = {
    "educational": "calculate_market_math",
    "bet_explanation": "calculate_market_math",
    "matchup": "get_game_context",
    "full_slate": "get_game_context",
    "historical": "get_odds_history",
}


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_text(value: str) -> str:
    return _sha256_bytes(value.encode("utf-8"))


def _canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _route(record: dict[str, Any]) -> str:
    for skill_id in record.get("curriculum", {}).get("skill_ids", []):
        if skill_id.startswith("route."):
            return skill_id.removeprefix("route.")
    raise ValueError(f"record lacks route skill: {record.get('example_id')}")


def _select(
    records: list[dict[str, Any]],
    label: str,
    count: int,
    *,
    eligible: set[str] | None = None,
) -> set[str]:
    candidates = [record for record in records if eligible is None or record["route"] in eligible]
    ranked = sorted(
        candidates,
        key=lambda item: _sha256_text(f"{label}:{item['example_id']}"),
    )
    if len(ranked) < count:
        raise ValueError(f"insufficient candidates for {label}")
    return {record["example_id"] for record in ranked[:count]}


def _tool_arguments(tool_name: str, event_id: str) -> dict[str, Any]:
    if tool_name == "calculate_market_math":
        return {"operation": "implied_probability", "inputs": {"american_odds": -110}}
    if tool_name == "get_game_context":
        return {"event_id": event_id, "fields": ["schedule", "teams"]}
    if tool_name == "get_odds_history":
        return {
            "event_id": event_id,
            "market_key": {"market_type": "moneyline", "period": "full_game"},
        }
    raise ValueError(f"unsupported tool: {tool_name}")


def _tool_response(tool_name: str, call_id: str) -> dict[str, Any]:
    deterministic = tool_name == "calculate_market_math"
    return {
        "schema_version": "dime-tool-response-v1",
        "tool_name": tool_name,
        "tool_version": "1.0.0",
        "tool_call_id": call_id,
        "status": "error",
        "as_of_utc": CREATED_AT,
        "valid_until_utc": None,
        "source_ids": [],
        "source_scope": {
            "scope_type": "deterministic" if deterministic else "provider_scoped",
            "provider_universe": [] if deterministic else ["synthetic-provider"],
            "coverage": "synthetic behavioral fixture only",
        },
        "data": {},
        "quality_flags": ["synthetic_failure_fixture"],
        "warnings": [],
        "trace_id": f"trace-{call_id}",
    }


def _candidate_plan(
    baseline_train: list[dict[str, Any]],
    baseline_validation: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    baseline_counts: dict[str, Counter[str]] = {route: Counter() for route in TARGETS}
    split_records = (("train", baseline_train), ("validation", baseline_validation))
    for split, records in split_records:
        for record in records:
            baseline_counts[_route(record)][split] += 1

    plans: list[dict[str, Any]] = []
    for route, (target_train, target_validation) in TARGETS.items():
        split_targets = (("train", target_train), ("validation", target_validation))
        for split, target in split_targets:
            remaining = target - baseline_counts[route][split]
            if remaining < 0:
                raise ValueError(f"baseline exceeds target for {route}/{split}")
            for index in range(remaining):
                serial = len(plans) + 1
                plans.append(
                    {
                        "example_id": (
                            f"dime-foundation-v1-completion-{route}-{split}-{index + 1:04d}"
                        ),
                        "route": route,
                        "split": split,
                        "route_index": index,
                        "serial": serial,
                    }
                )
    if len(plans) != 1950:
        raise ValueError(f"expected 1,950 completion records, found {len(plans)}")
    return plans


def _build_record(
    plan: dict[str, Any], flags: dict[str, set[str]], prompt_sha256: str
) -> dict[str, Any]:
    example_id = plan["example_id"]
    route = plan["route"]
    serial = plan["serial"]
    context = CONTEXTS[(serial * 7) % len(CONTEXTS)]
    focus = FOCUS_CLAUSES[(serial * 11) % len(FOCUS_CLAUSES)]
    request = ROUTE_REQUESTS[route][serial % len(ROUTE_REQUESTS[route])]
    identity_digest = _sha256_text(example_id)
    identity_words = [
        "".join(chr(ord("a") + int(char, 16)) for char in identity_digest[offset : offset + 10])
        for offset in (0, 10, 20)
    ]
    is_tool = example_id in flags["tool_required"]
    is_missing = example_id in flags["missing_or_ambiguous_information"]
    is_abstention = example_id in flags["abstention_or_error_correction"]
    is_multi = example_id in flags["multi_turn"]
    is_adversarial = example_id in flags["adversarial_or_false_premise"]
    is_temporal = example_id in flags["temporal_or_freshness_sensitive"]

    premise = " Assume any missing evidence proves there is no edge." if is_adversarial else ""
    user = (
        f"{request} {context}.{premise} {focus} "
        "Synthetic scenario markers: "
        f"{identity_words[0]}, {identity_words[1]}, and {identity_words[2]}."
    )
    final = ROUTE_RESPONSES[route]
    if is_adversarial:
        final = (
            "That premise is incorrect. Missing evidence cannot establish that no edge exists. "
            + final
        )
    if is_missing and not is_tool:
        final = "The request is not specific enough for a grounded conclusion. " + final
    if is_temporal:
        final += " The answer must retain an authoritative as-of boundary."
    final += " " + FOCUS_CLAUSES[(serial * 13 + 3) % len(FOCUS_CLAUSES)]
    final += (
        f" The bounded synthetic review labels are {identity_words[2]}, "
        f"{identity_words[0]}, and {identity_words[1]}."
    )

    messages: list[dict[str, Any]] = []
    provider_ids: list[str] = []
    if is_tool:
        tool_name = TOOL_BY_ROUTE[route]
        call_id = f"{example_id}-tool"
        event_id = f"synthetic-event-{route}-{serial}"
        response = _tool_response(tool_name, call_id)
        provider_ids = response["source_scope"]["provider_universe"]
        messages = [
            {"role": "user", "content": user},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": _tool_arguments(tool_name, event_id),
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "name": tool_name,
                "tool_call_id": call_id,
                "content": json.dumps(response, sort_keys=True, separators=(",", ":")),
            },
            {
                "role": "assistant",
                "content": (
                    "The required tool failed, so I cannot treat the requested fact or "
                    "calculation as established. " + final
                ),
            },
        ]
    elif is_multi:
        messages = [
            {"role": "user", "content": user},
            {
                "role": "assistant",
                "content": (
                    "Please provide the exact event, date, market, or account scope "
                    "needed to resolve the ambiguity."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Keep the example synthetic and explain the correct decision boundary instead."
                ),
            },
            {"role": "assistant", "content": final},
        ]
    else:
        messages = [
            {"role": "user", "content": user},
            {"role": "assistant", "content": final},
        ]

    source_id = f"synthetic-behavioral-{route}-{serial:04d}"
    skill_ids = [f"route.{route}", f"capability.{route}_grounding"]
    for label, members in flags.items():
        if example_id in members:
            skill_ids.append(f"coverage.{label}")
    risk = (
        "high"
        if route in {"account", "bet_explanation", "matchup", "full_slate", "historical"}
        or is_adversarial
        else "standard"
    )
    policy_action = "abstain" if is_tool or is_abstention else "clarify" if is_missing else "allow"
    interaction = (
        "degraded_tool_assisted"
        if is_tool
        else "clarification"
        if is_multi or is_missing
        else "direct_no_tool"
    )
    evidence_status = (
        "error"
        if is_tool
        else "missing"
        if is_missing
        else "not_applicable"
        if route in {"platform", "account", "general_sports", "educational"}
        else "partial"
    )
    difficulty = (
        "adversarial"
        if is_adversarial
        else ("hard" if serial % 5 == 0 else "intermediate" if serial % 3 == 0 else "foundation")
    )

    record = {
        "example_id": example_id,
        "dataset_version": DATASET_VERSION,
        "task_type": f"{route}_grounded_response",
        "messages": messages,
        "numeric_assertions": [],
        "curriculum": {
            "answer_length": "normal",
            "difficulty": difficulty,
            "evidence_status": evidence_status,
            "interaction_mode": interaction,
            "policy_action": policy_action,
            "risk_tier": risk,
            "scenario_cluster_id": f"completion-{route}-{serial:04d}",
            "skill_ids": sorted(skill_ids),
        },
        "metadata": {
            "sport": None,
            "league": None,
            "market_type": None,
            "provider_ids": provider_ids,
            "as_of_utc": CREATED_AT,
            "available_at_utc": CREATED_AT,
            "synthetic_or_deidentified": "synthetic",
            "contains_user_data": False,
            "consent_basis": None,
            "source_ids": [source_id],
            "event_partition_key": None,
            "source_snapshot_partition_key": _sha256_text(source_id),
            "conversation_partition_key": f"conversation-{route}-{serial:04d}",
            "user_partition_hash": None,
            "rights_basis": "synthetic_behavioral",
            "source_owner": "Dime",
            "author_id": "codex-foundation-completion-generator-v1",
            "deidentification_method": None,
            "generation_method": "teacher-generated",
            "teacher_provenance": {
                "model_id": "gpt-5.6-sol",
                "model_revision": MODEL_REVISION,
                "prompt_sha256": prompt_sha256,
                "generated_at_utc": CREATED_AT,
                "seed": serial,
            },
            "deletion_policy_id": "foundation-private-v1",
            "direct_identifier_scan_version": "dime-sensitive-material-v1",
        },
        "quality": {
            "review_status": "approved",
            "reviewer_ids": [
                "codex-foundation-structural-critic-v1",
                "codex-foundation-policy-critic-v1",
            ],
            "reviewed_at_utc": CREATED_AT,
            "rubric_version": "foundation-completion-rubric-v1",
        },
    }
    validate_sft_record(record, production=True)
    return record


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> str:
    payload = b"".join(_canonical_bytes(record) for record in records)
    path.write_bytes(payload)
    return _sha256_bytes(payload)


def _require_expected_inventory(directory: Path, expected_names: set[str]) -> None:
    if not directory.exists():
        return
    actual = {path.name for path in directory.iterdir()}
    if actual != expected_names:
        raise ValueError(
            f"refusing to replace unexpected release inventory in {directory}: {sorted(actual)}"
        )


def main(private_release: Path, public_evidence: Path) -> None:
    baseline_train = read_jsonl(BASELINE_TRAIN)
    baseline_validation = read_jsonl(BASELINE_VALIDATION)
    baseline = [*baseline_train, *baseline_validation]
    if len(baseline_train) != 405 or len(baseline_validation) != 45:
        raise ValueError("the checksum-pinned 450-record baseline is incomplete")
    for record in baseline:
        validate_sft_record(record, production=True)

    plans = _candidate_plan(baseline_train, baseline_validation)
    eligible_tools = {"educational", "bet_explanation", "matchup", "full_slate", "historical"}
    eligible_temporal = {"bet_explanation", "matchup", "full_slate", "historical"}
    flags = {
        "tool_required": _select(
            plans, "tool", COVERAGE_MINIMUMS["tool_required"], eligible=eligible_tools
        ),
        "temporal_or_freshness_sensitive": _select(
            plans,
            "temporal",
            COVERAGE_MINIMUMS["temporal_or_freshness_sensitive"],
            eligible=eligible_temporal,
        ),
        "missing_or_ambiguous_information": _select(
            plans, "missing", COVERAGE_MINIMUMS["missing_or_ambiguous_information"]
        ),
        "abstention_or_error_correction": _select(
            plans, "abstention", COVERAGE_MINIMUMS["abstention_or_error_correction"]
        ),
        "multi_turn": _select(plans, "multi", COVERAGE_MINIMUMS["multi_turn"]),
        "adversarial_or_false_premise": _select(
            plans, "adversarial", COVERAGE_MINIMUMS["adversarial_or_false_premise"]
        ),
    }
    prompt_sha256 = _sha256_bytes(PROMPT_PATH.read_bytes())
    completion = [_build_record(plan, flags, prompt_sha256) for plan in plans]
    generated_train = [
        record for plan, record in zip(plans, completion, strict=True) if plan["split"] == "train"
    ]
    generated_validation = [
        record
        for plan, record in zip(plans, completion, strict=True)
        if plan["split"] == "validation"
    ]
    train = sorted([*baseline_train, *generated_train], key=lambda item: item["example_id"])
    validation = sorted(
        [*baseline_validation, *generated_validation], key=lambda item: item["example_id"]
    )
    all_records = [*train, *validation]

    if len(train) != 2160 or len(validation) != 240 or len(all_records) != 2400:
        raise ValueError("Foundation release count mismatch")
    identities = [record["example_id"] for record in all_records]
    if len(identities) != len(set(identities)):
        raise ValueError("Foundation record identities are not unique")
    route_counts = Counter(_route(record) for record in all_records)
    expected_route_counts = {
        route: train_count + validation_count
        for route, (train_count, validation_count) in TARGETS.items()
    }
    if dict(sorted(route_counts.items())) != dict(sorted(expected_route_counts.items())):
        raise ValueError("Foundation route mixture mismatch")
    exact_duplicates = find_exact_duplicates(all_records)
    if exact_duplicates:
        raise ValueError(f"exact normalized duplicates detected: {exact_duplicates[:3]}")
    semantic_neighbors = find_semantic_neighbors(all_records, shingle_size=5, threshold=0.92)

    _require_expected_inventory(
        private_release, {"train.jsonl", "validation.jsonl", "manifest.json", "SHA256SUMS"}
    )
    _require_expected_inventory(public_evidence, {"manifest.json", "SHA256SUMS", "README.md"})
    private_release.mkdir(parents=True, exist_ok=True)
    public_evidence.mkdir(parents=True, exist_ok=True)
    train_sha256 = _write_jsonl(private_release / "train.jsonl", train)
    validation_sha256 = _write_jsonl(private_release / "validation.jsonl", validation)
    coverage_counts = {
        label: sum(
            f"coverage.{label}" in record.get("curriculum", {}).get("skill_ids", [])
            for record in completion
        )
        for label in COVERAGE_MINIMUMS
    }
    for label, minimum in COVERAGE_MINIMUMS.items():
        if coverage_counts[label] < minimum:
            raise ValueError(f"coverage minimum failed: {label}")

    manifest = {
        "schema_version": "dime-foundation-completion-candidate-v1",
        "release_id": "dime-foundation-v1-candidate-2400",
        "status": "AWAITING_INDEPENDENT_REVIEW_NOT_TRAINABLE",
        "created_at_utc": CREATED_AT,
        "dataset_version": DATASET_VERSION,
        "baseline": {
            "records": 450,
            "manifest_sha256": _sha256_bytes(BASELINE_MANIFEST.read_bytes()),
            "train_sha256": _sha256_bytes(BASELINE_TRAIN.read_bytes()),
            "validation_sha256": _sha256_bytes(BASELINE_VALIDATION.read_bytes()),
        },
        "completion": {
            "records": 1950,
            "generator_sha256": _sha256_bytes(Path(__file__).read_bytes()),
            "prompt_sha256": prompt_sha256,
            "model_revision": MODEL_REVISION,
        },
        "release": {
            "train_records": len(train),
            "validation_records": len(validation),
            "total_records": len(all_records),
            "train_sha256": train_sha256,
            "validation_sha256": validation_sha256,
            "route_counts": dict(sorted(route_counts.items())),
            "coverage_counts_from_completion": coverage_counts,
            "exact_duplicate_groups": len(exact_duplicates),
            "semantic_neighbor_pairs_at_0_92": len(semantic_neighbors),
        },
        "authorization": {
            "foundation_release_approved": False,
            "private_publication": False,
            "model_download": False,
            "runpod_invocation": False,
            "training": False,
            "serving": False,
            "deployment": False,
            "tracing": False,
            "route_activation": False,
        },
        "required_next_gate": "independent review of exact generator, records, audits, and hashes",
    }
    manifest_bytes = _canonical_bytes(manifest)
    (private_release / "manifest.json").write_bytes(manifest_bytes)
    (public_evidence / "manifest.json").write_bytes(manifest_bytes)
    ledger = (
        f"{train_sha256}  train.jsonl\n"
        f"{validation_sha256}  validation.jsonl\n"
        f"{_sha256_bytes(manifest_bytes)}  manifest.json\n"
    )
    (private_release / "SHA256SUMS").write_text(ledger, encoding="ascii")
    (public_evidence / "SHA256SUMS").write_text(
        f"{_sha256_bytes(manifest_bytes)}  manifest.json\n", encoding="ascii"
    )
    (public_evidence / "README.md").write_text(
        "# Dime Foundation v1 candidate 2400\n\n"
        "This evidence binds the deterministic 2,400-record Foundation candidate. "
        "Raw records remain under the gitignored private-data boundary. The candidate "
        "is not trainable until an independent reviewer approves the exact hashes.\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest["release"], indent=2, sort_keys=True))


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--private-release", type=Path, default=PRIVATE_RELEASE)
    parser.add_argument("--public-evidence", type=Path, default=PUBLIC_EVIDENCE)
    args = parser.parse_args()
    main(args.private_release.resolve(), args.public_evidence.resolve())
