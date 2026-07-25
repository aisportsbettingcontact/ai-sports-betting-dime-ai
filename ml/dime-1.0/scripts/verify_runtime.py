#!/usr/bin/env python
"""Fail closed unless the active RunPod runtime matches the approved matrix."""

from __future__ import annotations

import os
import platform
from importlib.metadata import version

import torch

EXPECTED_PACKAGES = {
    "accelerate": "1.14.0",
    "bitsandbytes": "0.49.2",
    "datasets": "5.0.0",
    "huggingface_hub": "1.24.0",
    "jsonschema": "4.26.0",
    "peft": "0.19.1",
    "PyYAML": "6.0.3",
    "safetensors": "0.8.0",
    "tokenizers": "0.22.2",
    "transformers": "5.14.1",
    "trl": "1.8.0",
}


def main() -> None:
    failures = []
    if platform.python_version() != "3.12.3":
        failures.append(f"Python is {platform.python_version()}, expected 3.12.3")
    if torch.__version__ != "2.8.0+cu128":
        failures.append(f"PyTorch is {torch.__version__}, expected 2.8.0+cu128")
    if torch.version.cuda != "12.8":
        failures.append(f"Torch CUDA is {torch.version.cuda}, expected 12.8")
    if not torch.cuda.is_available():
        failures.append("CUDA is unavailable")
    else:
        gpu = torch.cuda.get_device_name(0)
        if "RTX 4090" not in gpu:
            failures.append(f"GPU is {gpu}, expected an RTX 4090")
        if not torch.cuda.is_bf16_supported():
            failures.append("GPU/runtime does not report BF16 support")

    for package, expected in EXPECTED_PACKAGES.items():
        actual = version(package)
        if actual != expected:
            failures.append(f"{package} is {actual}, expected {expected}")

    if os.environ.get("HF_HOME") != "/workspace/.cache/huggingface":
        failures.append("HF_HOME must be /workspace/.cache/huggingface")
    if not os.environ.get("HF_TOKEN"):
        failures.append("HF_TOKEN is not configured")

    if failures:
        details = "\n".join(f"- {failure}" for failure in failures)
        raise SystemExit(f"RUNTIME VERIFICATION FAILED\n{details}")

    print(f"Python: {platform.python_version()}")
    print(f"PyTorch: {torch.__version__}; CUDA runtime: {torch.version.cuda}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print("RUNTIME VERIFICATION PASSED")


if __name__ == "__main__":
    main()
