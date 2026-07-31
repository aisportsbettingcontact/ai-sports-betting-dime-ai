#!/usr/bin/env python
"""Generate an immutable untuned-Base control for a small evaluation slice."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from dime_ai.chat_format import attach_tool_catalog, encode_generation_prompt
from dime_ai.data_validation import read_jsonl
from dime_ai.platform_knowledge import (
    load_platform_knowledge,
    render_platform_knowledge,
)

MODEL_ID = "meta-llama/Llama-3.1-8B"
MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--max-new-tokens", type=int, default=256)
    parser.add_argument(
        "--cases",
        type=Path,
        default=Path("data/eval/dev.sample.jsonl"),
        help=(
            "Visible development case file to generate; use "
            "platform_grounding_v1.sample.jsonl for the platform slice."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/baselines/base-control.jsonl"),
    )
    return parser.parse_args()


def parse_tool_calls(text: str) -> list[dict[str, Any]]:
    calls = []
    for payload in re.findall(r"<tool_call>(.*?)</tool_call>", text, flags=re.DOTALL):
        try:
            value = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            calls.append(value)
    return calls


def generate_turn(
    model: Any,
    tokenizer: Any,
    messages: list[dict[str, Any]],
    max_new_tokens: int,
    stop_ids: list[int],
) -> str:
    encoded = encode_generation_prompt(tokenizer, messages, max_length=4096)
    input_ids = torch.tensor([encoded["input_ids"]], device="cuda")
    attention_mask = torch.tensor([encoded["attention_mask"]], device="cuda")
    with torch.inference_mode():
        generated = model.generate(
            input_ids=input_ids,
            attention_mask=attention_mask,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            eos_token_id=stop_ids,
            pad_token_id=tokenizer.pad_token_id,
        )
    new_tokens = generated[0, input_ids.shape[1] :]
    return tokenizer.decode(new_tokens, skip_special_tokens=True).strip()


def match_fixture(
    call: dict[str, Any],
    fixtures: list[dict[str, Any]],
) -> dict[str, Any] | None:
    function = call.get("function", {})
    name = function.get("name")
    arguments = function.get("arguments")
    if not isinstance(name, str) or not isinstance(arguments, dict):
        return None
    for fixture in fixtures:
        if fixture["tool"] == name and fixture["arguments"] == arguments:
            return fixture
    return None


def main() -> None:
    args = parse_args()
    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")

    project = Path(__file__).resolve().parents[1]
    case_path = args.cases if args.cases.is_absolute() else project / args.cases
    cases = read_jsonl(case_path)[: args.limit]
    platform_knowledge = load_platform_knowledge(project_root=project)
    system_prompt = "\n\n".join(
        [
            (project / "prompts/dime_system_v1.md").read_text().strip(),
            render_platform_knowledge(platform_knowledge),
        ]
    )
    tool_catalog = json.loads((project / "tools/tools.v1.json").read_text())
    chat_template = (project / "prompts/llama3_dime_chat_template_v1.jinja").read_text()

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        token=token,
    )
    tokenizer.clean_up_tokenization_spaces = False
    tokenizer.chat_template = chat_template
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        token=token,
        quantization_config=quantization,
        dtype=torch.bfloat16,
        device_map={"": 0},
        low_cpu_mem_usage=True,
        attn_implementation="sdpa",
    )
    model.eval()
    eot_id = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    stop_ids = sorted({tokenizer.eos_token_id, eot_id} - {None})

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for index, case in enumerate(cases, 1):
            messages = attach_tool_catalog(
                [{"role": "system", "content": system_prompt}, *case["messages"]],
                tool_catalog,
            )
            first_response = generate_turn(
                model,
                tokenizer,
                messages,
                args.max_new_tokens,
                stop_ids,
            )
            calls = parse_tool_calls(first_response)
            matched_results = []
            all_calls_matched = bool(calls)
            if calls:
                messages.append({"role": "assistant", "content": "", "tool_calls": calls})
                for call in calls:
                    fixture = match_fixture(call, case["tool_fixtures"])
                    if fixture is None:
                        all_calls_matched = False
                        continue
                    function = call["function"]
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call["id"],
                            "name": function["name"],
                            "content": json.dumps(
                                fixture["returns"],
                                sort_keys=True,
                                separators=(",", ":"),
                            ),
                        }
                    )
                    matched_results.append(fixture["returns"])
            if calls and all_calls_matched:
                response = generate_turn(
                    model,
                    tokenizer,
                    messages,
                    args.max_new_tokens,
                    stop_ids,
                )
            else:
                response = first_response
            trace = {
                "case_id": case["case_id"],
                "model_id": MODEL_ID,
                "model_revision": MODEL_REVISION,
                "control": "untuned-base",
                "prompt_version": (
                    f"dime-system-v1+platform-v{platform_knowledge.document['knowledge_version']}"
                ),
                "platform_knowledge_sha256": platform_knowledge.sha256,
                "first_response": first_response,
                "response": response,
                "tool_calls": calls,
                "tool_results": matched_results,
                "all_tool_calls_matched_fixtures": all_calls_matched,
                "policy_action": "unclassified_model_only",
            }
            handle.write(json.dumps(trace, sort_keys=True) + "\n")
            print(f"[{index}/{len(cases)}] {case['case_id']}")

    print(f"Baseline written to {args.output}")


if __name__ == "__main__":
    main()
