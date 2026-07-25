#!/usr/bin/env python
"""Guarded single-GPU QLoRA SFT for the pinned Dime parent model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import sys
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import torch
import yaml
from datasets import Dataset
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    GenerationConfig,
)
from transformers.trainer_utils import get_last_checkpoint
from trl import SFTConfig, SFTTrainer

from dime_ai.chat_format import (
    IGNORE_INDEX,
    AssistantOnlyCollator,
    attach_tool_catalog,
    encode_assistant_only,
)
from dime_ai.data_validation import (
    partition_keys,
    read_jsonl,
    validate_dataset_manifest,
    validate_sft_record,
    validate_unique_ids,
)
from dime_ai.program_audit import audit_curriculum

PINNED_MODEL_ID = "meta-llama/Llama-3.1-8B"
PINNED_MODEL_REVISION = "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"
ALLOWED_TARGET_MODULES = {
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument(
        "--allow-full-run",
        action="store_true",
        help="Required when run.mode is full; does not bypass data or model checks.",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="Start from step zero; refuses to overwrite an existing output directory.",
    )
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolved(project: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else project / path


def load_config(path: Path) -> dict[str, Any]:
    config = yaml.safe_load(path.read_text())
    if not isinstance(config, dict):
        raise ValueError("Training config must contain a mapping.")
    return config


def assert_config(config: dict[str, Any], allow_full_run: bool) -> None:
    model = config["model"]
    if model["id"] != PINNED_MODEL_ID or model["revision"] != PINNED_MODEL_REVISION:
        raise ValueError("Config does not match the frozen Dime parent ID and revision.")
    mode = config["run"]["mode"]
    if mode not in {"rehearsal", "full"}:
        raise ValueError("run.mode must be rehearsal or full.")
    if mode == "full" and not allow_full_run:
        raise ValueError("Full training requires an explicit --allow-full-run.")
    targets = set(config["lora"]["target_modules"])
    if targets != ALLOWED_TARGET_MODULES:
        raise ValueError(
            "LoRA targets must be the seven explicit Llama projection modules; "
            "do not wrap lm_head or embeddings."
        )
    if config["data"].get("reject_overlength") is not True:
        raise ValueError("Dime requires reject_overlength: true.")
    warmup_fraction = float(config["training"]["warmup_fraction"])
    if not 0 <= warmup_fraction <= 1:
        raise ValueError("training.warmup_fraction must be between 0 and 1.")


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def tokenize_records(
    records: list[dict[str, Any]],
    tokenizer: Any,
    tools: list[dict[str, Any]],
    max_length: int,
    minimum_assistant_tokens: int,
    production: bool,
) -> Dataset:
    encoded_records = []
    for record in records:
        validate_sft_record(record, production=production)
        try:
            messages = attach_tool_catalog(record["messages"], tools)
            encoded = encode_assistant_only(tokenizer, messages, max_length)
        except ValueError as exc:
            raise ValueError(f"{record['example_id']}: {exc}") from exc
        supervised = sum(label != IGNORE_INDEX for label in encoded["labels"])
        if supervised < minimum_assistant_tokens:
            raise ValueError(
                f"{record['example_id']}: only {supervised} assistant target tokens; "
                f"minimum is {minimum_assistant_tokens}"
            )
        encoded_records.append(encoded)
    return Dataset.from_list(encoded_records)


def build_run_fingerprint(
    config_path: Path,
    train_path: Path,
    validation_path: Path,
    template_path: Path,
    tool_catalog_path: Path,
    requirements_path: Path,
    runtime_path: Path,
    dataset_manifest_path: Path | None,
    curriculum_path: Path | None,
) -> dict[str, str]:
    fingerprint = {
        "parent_model_id": PINNED_MODEL_ID,
        "parent_model_revision": PINNED_MODEL_REVISION,
        "config_sha256": file_sha256(config_path),
        "train_data_sha256": file_sha256(train_path),
        "validation_data_sha256": file_sha256(validation_path),
        "chat_template_sha256": file_sha256(template_path),
        "tool_catalog_sha256": file_sha256(tool_catalog_path),
        "requirements_lock_sha256": file_sha256(requirements_path),
        "runtime_contract_sha256": file_sha256(runtime_path),
    }
    if dataset_manifest_path is not None:
        fingerprint["dataset_manifest_sha256"] = file_sha256(dataset_manifest_path)
    if curriculum_path is not None:
        fingerprint["curriculum_config_sha256"] = file_sha256(curriculum_path)
    return fingerprint


def establish_run_fingerprint(output_dir: Path, fingerprint: dict[str, str]) -> None:
    fingerprint_path = output_dir / "run_fingerprint.json"
    if fingerprint_path.exists():
        existing = json.loads(fingerprint_path.read_text())
        if existing != fingerprint:
            raise SystemExit(
                "Existing output directory belongs to a different model, config, data, "
                "template, tool catalog, or runtime. Use a new run name."
            )
        return
    if any(output_dir.glob("checkpoint-*")):
        raise SystemExit(
            "Checkpoint exists without a run fingerprint; automatic resume is blocked."
        )
    fingerprint_path.write_text(json.dumps(fingerprint, indent=2, sort_keys=True) + "\n")


def main() -> None:
    cli = parse_args()
    project = Path(__file__).resolve().parents[1]
    config_path = cli.config if cli.config.is_absolute() else project / cli.config
    config = load_config(config_path)
    assert_config(config, cli.allow_full_run)

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is not configured.")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable.")

    seed = int(config["run"]["seed"])
    seed_everything(seed)
    data_config = config["data"]
    production = config["run"]["mode"] == "full"
    train_path = resolved(project, data_config["train"])
    validation_path = resolved(project, data_config["validation"])
    dataset_manifest_path = resolved(project, data_config["manifest"]) if production else None
    curriculum_path = resolved(project, data_config["curriculum"]) if production else None
    template_path = resolved(project, config["model"]["chat_template"])
    tool_catalog_path = resolved(project, config["model"]["tool_catalog"])
    requirements_path = project / "requirements.lock.txt"
    runtime_path = project / "configs/runtime.env"
    output_dir = resolved(project, config["training"]["output_dir"])
    final_adapter_dir = resolved(project, config["training"]["final_adapter_dir"])

    if cli.restart and output_dir.exists() and any(output_dir.iterdir()):
        raise SystemExit(
            f"--restart refuses to overwrite non-empty {output_dir}. "
            "Archive it or choose a new run name."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = build_run_fingerprint(
        config_path,
        train_path,
        validation_path,
        template_path,
        tool_catalog_path,
        requirements_path,
        runtime_path,
        dataset_manifest_path,
        curriculum_path,
    )
    establish_run_fingerprint(output_dir, fingerprint)

    train_records = read_jsonl(train_path)
    validation_records = read_jsonl(validation_path)
    if production:
        if dataset_manifest_path is None or curriculum_path is None:
            raise AssertionError("Production manifest/curriculum paths were not resolved.")
        dataset_manifest = json.loads(dataset_manifest_path.read_text())
        curriculum_config = yaml.safe_load(curriculum_path.read_text())
        validate_dataset_manifest(
            dataset_manifest,
            file_sha256(train_path),
            file_sha256(validation_path),
            file_sha256(curriculum_path),
            file_sha256(tool_catalog_path),
            file_sha256(template_path),
        )
        for record in [*train_records, *validation_records]:
            validate_sft_record(record, production=True)
        curriculum_report = audit_curriculum(
            train_records,
            validation_records,
            curriculum_config,
        )
        (output_dir / "curriculum_audit.json").write_text(
            json.dumps(curriculum_report, indent=2, sort_keys=True) + "\n"
        )
        if not curriculum_report["pass"]:
            raise SystemExit(
                "Production curriculum audit failed:\n- "
                + "\n- ".join(curriculum_report["issues"][:20])
            )
    validate_unique_ids([*train_records, *validation_records], "example_id")
    train_keys = set().union(*(partition_keys(record) for record in train_records))
    validation_keys = set().union(*(partition_keys(record) for record in validation_records))
    leakage = train_keys & validation_keys
    if leakage:
        raise ValueError(f"Train/validation partition leakage: {sorted(leakage)}")
    tools = json.loads(tool_catalog_path.read_text())
    if not isinstance(tools, list) or not tools:
        raise ValueError("Tool catalog must be a non-empty array.")

    tokenizer = AutoTokenizer.from_pretrained(
        PINNED_MODEL_ID,
        revision=PINNED_MODEL_REVISION,
        token=token,
    )
    tokenizer.clean_up_tokenization_spaces = False
    tokenizer.padding_side = "right"
    tokenizer.chat_template = template_path.read_text()
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    max_length = int(data_config["max_length"])
    minimum_targets = int(data_config["minimum_assistant_tokens"])
    train_dataset = tokenize_records(
        train_records,
        tokenizer,
        tools,
        max_length,
        minimum_targets,
        production,
    )
    eval_dataset = tokenize_records(
        validation_records,
        tokenizer,
        tools,
        max_length,
        minimum_targets,
        production,
    )

    quantization = BitsAndBytesConfig(
        load_in_4bit=bool(config["quantization"]["load_in_4bit"]),
        bnb_4bit_quant_type=config["quantization"]["quant_type"],
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=bool(config["quantization"]["use_double_quant"]),
    )
    model = AutoModelForCausalLM.from_pretrained(
        PINNED_MODEL_ID,
        revision=PINNED_MODEL_REVISION,
        token=token,
        quantization_config=quantization,
        dtype=torch.bfloat16,
        device_map={"": 0},
        low_cpu_mem_usage=True,
        attn_implementation=config["model"]["attention_implementation"],
    )
    if not getattr(model, "is_loaded_in_4bit", False):
        raise RuntimeError("Parent model is not loaded in 4-bit.")
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=bool(config["training"]["gradient_checkpointing"]),
        gradient_checkpointing_kwargs={"use_reentrant": False},
    )

    lora = config["lora"]
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=int(lora["rank"]),
        lora_alpha=int(lora["alpha"]),
        lora_dropout=float(lora["dropout"]),
        bias=lora["bias"],
        target_modules=list(lora["target_modules"]),
    )
    model = get_peft_model(model, peft_config)
    trainable_names = [
        name for name, parameter in model.named_parameters() if parameter.requires_grad
    ]
    unexpected = [
        name
        for name in trainable_names
        if "lora_" not in name or "lm_head" in name or "embed_tokens" in name
    ]
    if unexpected:
        raise RuntimeError(f"Unexpected trainable parameters: {unexpected[:10]}")
    trainable_count = sum(
        parameter.numel() for parameter in model.parameters() if parameter.requires_grad
    )
    if not 40_000_000 <= trainable_count <= 44_000_000:
        raise RuntimeError(f"Unexpected LoRA trainable parameter count: {trainable_count:,}")
    model.print_trainable_parameters()

    training = config["training"]
    max_steps = int(training["max_steps"])
    epochs = float(training["epochs"])
    batch_size = int(training["per_device_train_batch_size"])
    accumulation = int(training["gradient_accumulation_steps"])
    if max_steps > 0:
        planned_steps = max_steps
    else:
        optimizer_steps_per_epoch = math.ceil(len(train_dataset) / (batch_size * accumulation))
        planned_steps = math.ceil(optimizer_steps_per_epoch * epochs)
    warmup_steps = math.ceil(planned_steps * float(training["warmup_fraction"]))
    training_args = SFTConfig(
        output_dir=str(output_dir),
        max_length=max_length,
        num_train_epochs=epochs,
        max_steps=max_steps,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=int(training["per_device_eval_batch_size"]),
        gradient_accumulation_steps=accumulation,
        learning_rate=float(training["learning_rate"]),
        weight_decay=float(training["weight_decay"]),
        warmup_steps=warmup_steps,
        lr_scheduler_type=training["scheduler"],
        logging_steps=int(training["logging_steps"]),
        eval_strategy="steps",
        eval_steps=int(training["eval_steps"]),
        save_strategy="steps",
        save_steps=int(training["save_steps"]),
        save_total_limit=int(training["save_total_limit"]),
        save_only_model=False,
        max_grad_norm=float(training["max_grad_norm"]),
        optim=training["optimizer"],
        gradient_checkpointing=bool(training["gradient_checkpointing"]),
        gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=bool(training["bf16"]),
        fp16=False,
        tf32=bool(training["tf32"]),
        packing=False,
        remove_unused_columns=False,
        dataset_kwargs={"skip_prepare_dataset": True},
        report_to=training["report_to"],
        seed=seed,
        data_seed=seed,
    )
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=AssistantOnlyCollator(tokenizer.pad_token_id),
        processing_class=tokenizer,
    )

    checkpoint = None if cli.restart else get_last_checkpoint(str(output_dir))
    result = trainer.train(resume_from_checkpoint=checkpoint)
    if not math.isfinite(result.training_loss):
        raise RuntimeError("Training loss is not finite.")

    if final_adapter_dir.exists():
        raise SystemExit(
            f"Final adapter directory already exists: {final_adapter_dir}. "
            "Use a new run name; stale artifacts will not be overwritten."
        )
    staging_dir = final_adapter_dir.with_name(f"{final_adapter_dir.name}.staging")
    if staging_dir.exists():
        raise SystemExit(f"Staging directory already exists: {staging_dir}")
    staging_dir.mkdir(parents=True)
    trainer.save_model(str(staging_dir))
    tokenizer.save_pretrained(staging_dir)
    (staging_dir / "chat_template.jinja").write_text(template_path.read_text())
    eot_id = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    generation_config = GenerationConfig.from_model_config(model.config)
    generation_config.eos_token_id = [tokenizer.eos_token_id, eot_id]
    generation_config.pad_token_id = tokenizer.pad_token_id
    generation_config.save_pretrained(staging_dir)

    manifest = {
        "artifact_kind": "peft_adapter",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "run_name": config["run"]["name"],
        "run_mode": config["run"]["mode"],
        "parent_model_id": PINNED_MODEL_ID,
        "parent_model_revision": PINNED_MODEL_REVISION,
        **fingerprint,
        "train_records": len(train_dataset),
        "validation_records": len(eval_dataset),
        "seed": seed,
        "global_step": trainer.state.global_step,
        "training_loss": result.training_loss,
        "trainable_parameters": trainable_count,
        "quantization": "nf4-double",
        "compute_dtype": "bfloat16",
        "torch": torch.__version__,
        "cuda_runtime": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0),
        "python": sys.version,
        "platform": platform.platform(),
        "transformers": version("transformers"),
        "trl": version("trl"),
        "peft": version("peft"),
        "bitsandbytes": version("bitsandbytes"),
        "accelerate": version("accelerate"),
        "datasets": version("datasets"),
        "huggingface_hub": version("huggingface_hub"),
        "tokenizers": version("tokenizers"),
        "safetensors": version("safetensors"),
        "generation_eos_token_ids": [tokenizer.eos_token_id, eot_id],
        "planned_optimizer_steps": planned_steps,
        "warmup_steps": warmup_steps,
    }
    (staging_dir / "training_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    (staging_dir / "README.md").write_text((project / "docs/MODEL_CARD_TEMPLATE.md").read_text())
    os.replace(staging_dir, final_adapter_dir)
    print(f"Final adapter: {final_adapter_dir}")
    print("QLORA TRAINING COMPLETED")


if __name__ == "__main__":
    main()
