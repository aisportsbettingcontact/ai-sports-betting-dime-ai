#!/usr/bin/env python3
"""Quantize the merged Dime 1.0 checkpoint to 4-bit AWQ for vLLM serving.

AWQ w4 / group 128 / GEMM is the production format: vLLM loads it directly
with --quantization awq on the 24 GB RunPod worker class.

Usage:
  python quantize_awq.py --model out/merged --out out/awq [--calib-data calib.jsonl]
"""

import argparse
import json

from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

QUANT_CONFIG = {"zero_point": True, "q_group_size": 128, "w_bit": 4, "version": "GEMM"}


def load_calibration(path: str | None) -> list[str] | None:
    """Optional domain calibration: JSONL with {"text": ...} per line.
    Betting-domain calibration text measurably helps 4-bit quality; without
    it AutoAWQ falls back to its default calibration corpus (needs network).
    """
    if not path:
        return None
    samples = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line)["text"])
    return samples


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", required=True, help="merged fp16 checkpoint dir")
    p.add_argument("--out", required=True)
    p.add_argument("--calib-data", default=None)
    args = p.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoAWQForCausalLM.from_pretrained(args.model, safetensors=True, device_map="auto")

    calib = load_calibration(args.calib_data)
    if calib:
        model.quantize(tokenizer, quant_config=QUANT_CONFIG, calib_data=calib)
    else:
        model.quantize(tokenizer, quant_config=QUANT_CONFIG)

    model.save_quantized(args.out, safetensors=True)
    tokenizer.save_pretrained(args.out)
    print(f"[dime-1.0] AWQ 4-bit checkpoint saved to {args.out}")
    print("[dime-1.0] serve with: vllm serve <path-or-hf-repo> --quantization awq")


if __name__ == "__main__":
    main()
