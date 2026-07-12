#!/usr/bin/env python3
"""QLoRA fine-tune of Meta-Llama-3-8B-Instruct into Llama-3-Dime-1.0.

Runs on a single 24-48 GB GPU (RTX A6000 48 GB is the default training Pod).
Base model loads in 4-bit NF4; only LoRA adapters train. Output is an adapter
directory consumed by merge_adapter.py.

Data: chat-format JSONL — one {"messages": [{"role": ..., "content": ...}]}
object per line (see data/README.md). The tokenizer's Llama 3 chat template
formats each example.

Usage:
  python train_qlora.py --data train.jsonl [--eval-data val.jsonl] --out out/adapter
"""

import argparse
import json
import time
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from trl import SFTTrainer

BASE_MODEL_DEFAULT = "meta-llama/Meta-Llama-3-8B-Instruct"
# All attention + MLP projections — the standard QLoRA target set for Llama 3.
LORA_TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base-model", default=BASE_MODEL_DEFAULT)
    p.add_argument("--data", required=True, help="training JSONL (chat format)")
    p.add_argument("--eval-data", default=None, help="optional validation JSONL")
    p.add_argument("--out", required=True, help="adapter output directory")
    p.add_argument("--epochs", type=float, default=2.0)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--grad-accum", type=int, default=4)
    p.add_argument("--seq-len", type=int, default=4096)
    p.add_argument("--lora-r", type=int, default=32)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--lora-dropout", type=float, default=0.05)
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        ),
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="sdpa",
    )
    model.config.use_cache = False

    data_files = {"train": args.data}
    if args.eval_data:
        data_files["eval"] = args.eval_data
    dataset = load_dataset("json", data_files=data_files)

    def formatting_func(batch):
        return [
            tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
            for messages in batch["messages"]
        ]

    training_args = TrainingArguments(
        output_dir=str(out_dir / "checkpoints"),
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        gradient_checkpointing=True,
        optim="paged_adamw_8bit",
        bf16=True,
        logging_steps=10,
        save_strategy="epoch",
        eval_strategy="epoch" if args.eval_data else "no",
        report_to="none",
        seed=args.seed,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset.get("eval"),
        formatting_func=formatting_func,
        max_seq_length=args.seq_len,
        peft_config=LoraConfig(
            task_type="CAUSAL_LM",
            r=args.lora_r,
            lora_alpha=args.lora_alpha,
            lora_dropout=args.lora_dropout,
            target_modules=LORA_TARGET_MODULES,
            bias="none",
        ),
        packing=False,
    )

    started = time.time()
    result = trainer.train()
    trainer.save_model(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))

    metadata = {
        "artifact": "Llama-3-Dime-1.0 adapter",
        "base_model": args.base_model,
        "train_file": args.data,
        "eval_file": args.eval_data,
        "train_examples": len(dataset["train"]),
        "hyperparameters": {
            "epochs": args.epochs,
            "learning_rate": args.lr,
            "batch_size": args.batch_size,
            "grad_accum": args.grad_accum,
            "seq_len": args.seq_len,
            "lora_r": args.lora_r,
            "lora_alpha": args.lora_alpha,
            "lora_dropout": args.lora_dropout,
            "target_modules": LORA_TARGET_MODULES,
            "seed": args.seed,
        },
        "train_loss": result.training_loss,
        "wall_seconds": round(time.time() - started, 1),
    }
    (out_dir / "training_metadata.json").write_text(json.dumps(metadata, indent=2))
    print(f"[dime-1.0] adapter + metadata saved to {out_dir}")


if __name__ == "__main__":
    main()
