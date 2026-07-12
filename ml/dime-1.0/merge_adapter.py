#!/usr/bin/env python3
"""Merge the Dime QLoRA adapter into the fp16 base — input for quantize_awq.py.

Usage:
  python merge_adapter.py --adapter out/adapter --out out/merged
"""

import argparse

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE_MODEL_DEFAULT = "meta-llama/Meta-Llama-3-8B-Instruct"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base-model", default=BASE_MODEL_DEFAULT)
    p.add_argument("--adapter", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args()

    # fp16 (not 4-bit): merging into a quantized base degrades the weights.
    base = AutoModelForCausalLM.from_pretrained(
        args.base_model, torch_dtype=torch.float16, device_map="auto"
    )
    merged = PeftModel.from_pretrained(base, args.adapter).merge_and_unload()
    merged.save_pretrained(args.out, safe_serialization=True)
    AutoTokenizer.from_pretrained(args.adapter).save_pretrained(args.out)
    print(f"[dime-1.0] merged fp16 checkpoint saved to {args.out}")


if __name__ == "__main__":
    main()
