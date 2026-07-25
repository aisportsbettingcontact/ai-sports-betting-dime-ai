#!/usr/bin/env python
"""Reload a saved adapter against the pinned parent and run one generation."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from dime_ai.chat_format import encode_generation_prompt

MODEL_ID = "meta-llama/Llama-3.1-8B"
MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    manifest = json.loads((args.adapter_dir / "training_manifest.json").read_text())
    if (
        manifest.get("parent_model_id") != MODEL_ID
        or manifest.get("parent_model_revision") != MODEL_REVISION
    ):
        raise SystemExit("Adapter manifest does not match the pinned parent.")

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.adapter_dir)
    tokenizer.clean_up_tokenization_spaces = False
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    base = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        token=token,
        quantization_config=quantization,
        dtype=torch.bfloat16,
        device_map={"": 0},
        attn_implementation="sdpa",
    )
    model = PeftModel.from_pretrained(base, args.adapter_dir, is_trainable=False)
    if not model.peft_config:
        raise RuntimeError("PEFT reports no loaded adapters.")
    active_adapters = model.active_adapters
    if callable(active_adapters):
        active_adapters = active_adapters()
    if not active_adapters:
        raise RuntimeError("PEFT reports no active adapter.")
    model.eval()
    prompt = encode_generation_prompt(
        tokenizer,
        [
            {
                "role": "system",
                "content": "You are Dime AI. Separate evidence from interpretation.",
            },
            {"role": "user", "content": "In one sentence, what does a simulation prove?"},
        ],
        max_length=1024,
    )
    input_ids = torch.tensor([prompt["input_ids"]], device="cuda")
    attention_mask = torch.tensor([prompt["attention_mask"]], device="cuda")
    eot_id = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    with torch.inference_mode():
        adapter_logits = (
            model(
                input_ids=input_ids,
                attention_mask=attention_mask,
            )
            .logits[:, -1, :]
            .float()
        )
        with model.disable_adapter():
            base_logits = (
                model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                )
                .logits[:, -1, :]
                .float()
            )
        logit_delta = (adapter_logits - base_logits).abs().max().item()
        if logit_delta <= 0:
            raise RuntimeError("Active adapter produced zero logit delta from the Base model.")
        output = model.generate(
            input_ids=input_ids,
            attention_mask=attention_mask,
            max_new_tokens=80,
            do_sample=False,
            eos_token_id=[tokenizer.eos_token_id, eot_id],
            pad_token_id=tokenizer.pad_token_id,
        )
    response = tokenizer.decode(output[0, input_ids.shape[1] :], skip_special_tokens=True)
    if not response.strip():
        raise RuntimeError("Adapter reload produced an empty response.")
    print(f"Active adapters: {active_adapters}")
    print(f"Max Base/adapter logit delta: {logit_delta:.8f}")
    print(response.strip())
    print("ADAPTER RELOAD SMOKE TEST PASSED")


if __name__ == "__main__":
    main()
