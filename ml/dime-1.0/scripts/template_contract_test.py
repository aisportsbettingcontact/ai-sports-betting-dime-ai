#!/usr/bin/env python
"""Validate the serialized chat template and assistant-only masks."""

from __future__ import annotations

import json
import os
from pathlib import Path

from transformers import AutoTokenizer

from dime_ai.chat_format import (
    IGNORE_INDEX,
    attach_tool_catalog,
    encode_assistant_only,
    encode_generation_prompt,
)
from dime_ai.data_validation import read_jsonl

MODEL_ID = "meta-llama/Llama-3.1-8B"
MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"


def main() -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    project = Path(__file__).resolve().parents[1]
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        token=token,
    )
    tokenizer.clean_up_tokenization_spaces = False
    tokenizer.chat_template = (project / "prompts/llama3_dime_chat_template_v1.jinja").read_text()
    tools = json.loads((project / "tools/tools.v1.json").read_text())

    required_tokens = [
        "<|begin_of_text|>",
        "<|start_header_id|>",
        "<|end_header_id|>",
        "<|eot_id|>",
    ]
    for required in required_tokens:
        token_id = tokenizer.convert_tokens_to_ids(required)
        if token_id is None or token_id == tokenizer.unk_token_id:
            raise RuntimeError(f"Tokenizer is missing {required}.")

    messages = [
        {"role": "system", "content": "System rule."},
        {"role": "user", "content": "Question."},
        {"role": "assistant", "content": "Answer."},
    ]
    encoded = encode_assistant_only(tokenizer, messages, max_length=1024)
    supervised = [
        token_id
        for token_id, label in zip(
            encoded["input_ids"],
            encoded["labels"],
            strict=True,
        )
        if label != IGNORE_INDEX
    ]
    eot_id = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    if not supervised or supervised[-1] != eot_id:
        raise RuntimeError("Assistant EOT is not supervised.")
    if encoded["labels"][0] != IGNORE_INDEX:
        raise RuntimeError("BOS/system region was unexpectedly supervised.")

    linkage_messages = [
        {"role": "user", "content": "Use the calculator."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_contract_1",
                    "type": "function",
                    "function": {
                        "name": "calculate_market_math",
                        "arguments": {
                            "operation": "market_hold",
                            "inputs": {"american_odds": {"a": -110, "b": -110}},
                        },
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_contract_1",
            "name": "calculate_market_math",
            "content": '{"status":"ok"}',
        },
        {"role": "assistant", "content": "Done."},
    ]
    rendered = tokenizer.apply_chat_template(linkage_messages, tokenize=False)
    for expected in ("call_contract_1", "calculate_market_math", "<tool_result>"):
        if expected not in rendered:
            raise RuntimeError(f"Rendered template lost tool identity: {expected}")

    generation = encode_generation_prompt(
        tokenizer,
        [{"role": "user", "content": "Question."}],
        max_length=1024,
    )
    suffix = tokenizer.decode(generation["input_ids"][-8:], skip_special_tokens=False)
    if "assistant" not in suffix or "<|end_header_id|>" not in suffix:
        raise RuntimeError("Generation prompt does not end at the assistant header.")

    records = [
        *read_jsonl(project / "data/sft/train.sample.jsonl"),
        *read_jsonl(project / "data/sft/validation.sample.jsonl"),
    ]
    longest = 0
    for record in records:
        catalog_messages = attach_tool_catalog(record["messages"], tools)
        tokenized = encode_assistant_only(tokenizer, catalog_messages, max_length=4096)
        longest = max(longest, len(tokenized["input_ids"]))

    print(f"Validated SFT records: {len(records)}")
    print(f"Longest catalog-injected record: {longest} tokens")
    print("CHAT TEMPLATE CONTRACT PASSED")


if __name__ == "__main__":
    main()
