#!/usr/bin/env python
"""Load the pinned model in 4-bit and run one deterministic forward pass."""

from __future__ import annotations

import os

import torch
from huggingface_hub import HfApi
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

MODEL_ID = "meta-llama/Llama-3.1-8B"
MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"


def main() -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable.")

    remote_revision = HfApi().model_info(MODEL_ID, token=token).sha
    if remote_revision != MODEL_REVISION:
        print(f"Notice: the Hub default branch has moved; Dime remains pinned to {MODEL_REVISION}.")

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
    if not getattr(model, "is_loaded_in_4bit", False):
        raise RuntimeError("Model did not load in 4-bit.")

    inputs = tokenizer("Dime AI pinned model validation.", return_tensors="pt")
    inputs = {key: value.to("cuda") for key, value in inputs.items()}
    model.eval()
    with torch.inference_mode():
        logits = model(**inputs).logits

    print(f"Model: {MODEL_ID}")
    print(f"Revision: {MODEL_REVISION}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"Forward-pass shape: {tuple(logits.shape)}")
    print(f"GPU memory allocated GB: {torch.cuda.memory_allocated() / 1e9:.2f}")
    print("MODEL SMOKE TEST PASSED")


if __name__ == "__main__":
    main()
