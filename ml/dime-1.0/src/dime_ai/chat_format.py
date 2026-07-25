"""Versioned Llama 3 chat rendering with assistant-only labels."""

from __future__ import annotations

import json
from collections.abc import Iterable
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

IGNORE_INDEX = -100
VALID_ROLES = {"system", "user", "assistant", "tool"}


class ChatFormatError(ValueError):
    """Raised when a conversation cannot be encoded safely."""


def _compact_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _message_content(message: dict[str, Any]) -> str:
    content = message.get("content", "")
    if not isinstance(content, str):
        raise ChatFormatError("Message content must be a string.")
    if message.get("role") == "tool":
        envelope = {
            "tool_call_id": message.get("tool_call_id", ""),
            "name": message.get("name", ""),
            "content": content,
        }
        return f"<tool_result>{_compact_json(envelope)}</tool_result>"
    calls = message.get("tool_calls", [])
    if calls:
        rendered = "\n".join(f"<tool_call>{_compact_json(call)}</tool_call>" for call in calls)
        content = f"{content}\n{rendered}".strip()
    return content


def attach_tool_catalog(
    messages: Iterable[dict[str, Any]],
    tools: list[dict[str, Any]],
    catalog_version: str = "dime-tools-v1",
) -> list[dict[str, Any]]:
    """Inject one canonical read-only tool catalog into the system message."""

    result = deepcopy(list(messages))
    catalog = _compact_json(tools)
    block = (
        f"\n\nAvailable read-only tools ({catalog_version}). "
        "Use only these schemas; never invent a tool or field.\n"
        f"<tools>{catalog}</tools>"
    )
    if result and result[0].get("role") == "system":
        result[0]["content"] = result[0].get("content", "") + block
    else:
        result.insert(
            0,
            {
                "role": "system",
                "content": (
                    "Use only authorized read-only tools for changing facts and "
                    "deterministic calculations." + block
                ),
            },
        )
    return result


def _template_assistant_only(
    tokenizer: Any,
    messages: list[dict[str, Any]],
    max_length: int,
) -> dict[str, list[int]]:
    rendered = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=False,
        truncation=False,
        return_dict=True,
        return_assistant_tokens_mask=True,
    )
    input_ids = list(rendered["input_ids"])
    attention_mask = list(rendered.get("attention_mask", [1] * len(input_ids)))
    assistant_mask = rendered.get("assistant_masks")
    if assistant_mask is None:
        raise ChatFormatError("Chat template did not return assistant masks.")
    assistant_mask = list(assistant_mask)
    if len(input_ids) != len(assistant_mask):
        raise ChatFormatError("Assistant mask length does not match input IDs.")
    if len(input_ids) > max_length:
        raise ChatFormatError(
            f"Encoded record has {len(input_ids)} tokens, exceeding max_length={max_length}; "
            "the record was rejected instead of truncated."
        )
    labels = [
        token_id if supervised else IGNORE_INDEX
        for token_id, supervised in zip(input_ids, assistant_mask, strict=True)
    ]
    if not any(label != IGNORE_INDEX for label in labels):
        raise ChatFormatError("Chat template produced no assistant target tokens.")
    return {
        "input_ids": input_ids,
        "attention_mask": attention_mask,
        "labels": labels,
    }


def _required_token_id(tokenizer: Any, token: str) -> int:
    token_id = tokenizer.convert_tokens_to_ids(token)
    unknown_id = getattr(tokenizer, "unk_token_id", None)
    if token_id is None or token_id == unknown_id:
        raise ChatFormatError(f"Tokenizer does not define required token {token!r}.")
    return int(token_id)


def encode_assistant_only(
    tokenizer: Any,
    messages: Iterable[dict[str, Any]],
    max_length: int,
) -> dict[str, list[int]]:
    """Encode one conversation and supervise only assistant content/eot tokens."""

    if max_length <= 0:
        raise ChatFormatError("max_length must be positive.")

    message_list = list(messages)
    if getattr(tokenizer, "chat_template", None) and hasattr(tokenizer, "apply_chat_template"):
        return _template_assistant_only(tokenizer, message_list, max_length)

    bos_id = getattr(tokenizer, "bos_token_id", None)
    if bos_id is None:
        bos_id = _required_token_id(tokenizer, "<|begin_of_text|>")
    start_header = _required_token_id(tokenizer, "<|start_header_id|>")
    end_header = _required_token_id(tokenizer, "<|end_header_id|>")
    eot = _required_token_id(tokenizer, "<|eot_id|>")

    input_ids = [int(bos_id)]
    labels = [IGNORE_INDEX]
    assistant_seen = False

    if not message_list:
        raise ChatFormatError("Conversation must not be empty.")

    for message in message_list:
        role = message.get("role")
        if role not in VALID_ROLES:
            raise ChatFormatError(f"Unsupported role: {role!r}")
        role_ids = tokenizer.encode(role, add_special_tokens=False)
        newline_ids = tokenizer.encode("\n\n", add_special_tokens=False)
        content_ids = tokenizer.encode(_message_content(message), add_special_tokens=False)
        header_ids = [start_header, *role_ids, end_header, *newline_ids]

        input_ids.extend(header_ids)
        labels.extend([IGNORE_INDEX] * len(header_ids))
        input_ids.extend(content_ids)

        if role == "assistant":
            assistant_seen = True
            labels.extend(content_ids)
            input_ids.append(eot)
            labels.append(eot)
        else:
            labels.extend([IGNORE_INDEX] * len(content_ids))
            input_ids.append(eot)
            labels.append(IGNORE_INDEX)

    if not assistant_seen:
        raise ChatFormatError("Conversation must contain at least one assistant message.")
    if len(input_ids) > max_length:
        raise ChatFormatError(
            f"Encoded record has {len(input_ids)} tokens, exceeding max_length={max_length}; "
            "the record was rejected instead of truncated."
        )
    if len(input_ids) != len(labels):
        raise AssertionError("Input and label lengths diverged.")

    return {
        "input_ids": input_ids,
        "attention_mask": [1] * len(input_ids),
        "labels": labels,
    }


def encode_generation_prompt(
    tokenizer: Any,
    messages: Iterable[dict[str, Any]],
    max_length: int,
) -> dict[str, list[int]]:
    """Encode prior turns and end at an empty assistant header for generation."""

    message_list = list(messages)
    if not message_list:
        raise ChatFormatError("Generation prompt must not be empty.")
    if any(message.get("role") == "assistant" for message in message_list[-1:]):
        raise ChatFormatError("Generation prompt must not already end with an assistant message.")

    if getattr(tokenizer, "chat_template", None) and hasattr(tokenizer, "apply_chat_template"):
        rendered = tokenizer.apply_chat_template(
            message_list,
            tokenize=True,
            add_generation_prompt=True,
            truncation=False,
            return_dict=True,
        )
        input_ids = list(rendered["input_ids"])
        if len(input_ids) > max_length:
            raise ChatFormatError(
                f"Generation prompt has {len(input_ids)} tokens, exceeding max_length={max_length}."
            )
        return {
            "input_ids": input_ids,
            "attention_mask": list(rendered.get("attention_mask", [1] * len(input_ids))),
        }

    bos_id = getattr(tokenizer, "bos_token_id", None)
    if bos_id is None:
        bos_id = _required_token_id(tokenizer, "<|begin_of_text|>")
    start_header = _required_token_id(tokenizer, "<|start_header_id|>")
    end_header = _required_token_id(tokenizer, "<|end_header_id|>")
    eot = _required_token_id(tokenizer, "<|eot_id|>")
    newline_ids = tokenizer.encode("\n\n", add_special_tokens=False)

    input_ids = [int(bos_id)]
    for message in message_list:
        role = message.get("role")
        if role not in VALID_ROLES:
            raise ChatFormatError(f"Unsupported role: {role!r}")
        role_ids = tokenizer.encode(role, add_special_tokens=False)
        content_ids = tokenizer.encode(_message_content(message), add_special_tokens=False)
        input_ids.extend([start_header, *role_ids, end_header, *newline_ids])
        input_ids.extend([*content_ids, eot])

    assistant_ids = tokenizer.encode("assistant", add_special_tokens=False)
    input_ids.extend([start_header, *assistant_ids, end_header, *newline_ids])
    if len(input_ids) > max_length:
        raise ChatFormatError(
            f"Generation prompt has {len(input_ids)} tokens, exceeding max_length={max_length}."
        )
    return {"input_ids": input_ids, "attention_mask": [1] * len(input_ids)}


@dataclass
class AssistantOnlyCollator:
    """Right-pad pretokenized examples without altering assistant-only labels."""

    pad_token_id: int

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, Any]:
        import torch

        if not features:
            raise ChatFormatError("Cannot collate an empty batch.")
        max_size = max(len(item["input_ids"]) for item in features)

        def pad(values: list[int], pad_value: int) -> list[int]:
            return values + [pad_value] * (max_size - len(values))

        return {
            "input_ids": torch.tensor(
                [pad(item["input_ids"], self.pad_token_id) for item in features],
                dtype=torch.long,
            ),
            "attention_mask": torch.tensor(
                [pad(item["attention_mask"], 0) for item in features],
                dtype=torch.long,
            ),
            "labels": torch.tensor(
                [pad(item["labels"], IGNORE_INDEX) for item in features],
                dtype=torch.long,
            ),
        }
