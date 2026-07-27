import importlib.util
import json
import os
import struct
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from dime_ai.release_contract import BASE_MODEL_ID, BASE_MODEL_REVISION, ReleaseContractError

PROJECT = Path(__file__).resolve().parents[1]
PUBLISHER_PATH = PROJECT / "scripts/publish_adapter.py"

spec = importlib.util.spec_from_file_location("dime_safetensors_publisher", PUBLISHER_PATH)
assert spec and spec.loader
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

DEFAULT_METADATA = object()


def adapter_config(rank: int = publisher.APPROVED_LORA_RANK) -> dict[str, Any]:
    config = deepcopy(publisher.APPROVED_LORA_CONFIG_VALUES)
    config.update(
        {
            "base_model_name_or_path": BASE_MODEL_ID,
            "revision": BASE_MODEL_REVISION,
            "r": rank,
            "target_modules": sorted(publisher.TARGET_MODULES),
        }
    )
    return config


def expected_shapes(
    rank: int = publisher.APPROVED_LORA_RANK,
) -> dict[str, tuple[int, int]]:
    expected: dict[str, tuple[int, int]] = {}
    for layer in range(publisher.LLAMA_LAYER_COUNT):
        for module, (block, input_size, output_size) in publisher.TARGET_MODULES.items():
            prefix = f"base_model.model.model.layers.{layer}.{block}.{module}"
            expected[f"{prefix}.lora_A.weight"] = (rank, input_size)
            expected[f"{prefix}.lora_B.weight"] = (output_size, rank)
    return expected


def write_sparse_safetensors(
    path: Path,
    *,
    rank: int = publisher.APPROVED_LORA_RANK,
    dtype: str = "BF16",
    descriptor_dtype: str | None = None,
    metadata: object = DEFAULT_METADATA,
    omit_key: str | None = None,
    shape_override: tuple[str, list[int]] | None = None,
) -> tuple[int, dict[str, tuple[int, int]]]:
    dtype_bytes = {"BF16": 2, "F16": 2, "F32": 4}[dtype]
    if metadata is DEFAULT_METADATA:
        metadata = {"format": "pt"}
    header: dict[str, Any] = {"__metadata__": metadata}
    offsets: dict[str, tuple[int, int]] = {}
    cursor = 0
    for key, shape in sorted(expected_shapes(rank).items()):
        if key == omit_key:
            continue
        stored_shape = (
            shape_override[1] if shape_override and key == shape_override[0] else list(shape)
        )
        element_count = shape[0] * shape[1]
        end = cursor + element_count * dtype_bytes
        header[key] = {
            "dtype": descriptor_dtype or dtype,
            "shape": stored_shape,
            "data_offsets": [cursor, end],
        }
        offsets[key] = (cursor, end)
        cursor = end

    encoded_header = json.dumps(
        header,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded_header += b" " * (-len(encoded_header) % 8)
    data_start = 8 + len(encoded_header)
    with path.open("wb") as handle:
        handle.write(struct.pack("<Q", len(encoded_header)))
        handle.write(encoded_header)
        if cursor:
            handle.seek(data_start + cursor - 1, os.SEEK_SET)
            handle.write(b"\0")
    return data_start, offsets


def test_real_sparse_checkpoint_passes_without_torch_or_safetensors(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    write_sparse_safetensors(adapter)

    publisher.validate_adapter_safetensors(adapter, adapter_config())


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("r", 8),
        ("lora_alpha", 16),
        ("lora_dropout", 0.0),
        ("fan_in_fan_out", True),
        ("use_rslora", True),
        ("alpha_pattern", {"q_proj": 999}),
        ("alora_invocation_tokens", [1]),
        ("arrow_config", {"router_temperature": 1.0}),
        ("lora_bias", True),
        ("use_qalora", True),
        ("use_bdlora", True),
    ],
)
def test_inference_relevant_lora_config_is_exact(
    tmp_path: Path,
    field: str,
    value: object,
) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    adapter.write_bytes(b"not reached")
    config = adapter_config()
    config[field] = value

    with pytest.raises(ReleaseContractError, match="exact adapter-only"):
        publisher.validate_adapter_safetensors(adapter, config)


def test_duplicate_target_module_is_rejected(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    adapter.write_bytes(b"not reached")
    config = adapter_config()
    config["target_modules"].append(config["target_modules"][0])

    with pytest.raises(ReleaseContractError, match="exact adapter-only"):
        publisher.validate_adapter_safetensors(adapter, config)


def test_unknown_adapter_config_feature_is_rejected(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    adapter.write_bytes(b"not reached")
    config = adapter_config()
    config["future_unreviewed_feature"] = False

    with pytest.raises(ReleaseContractError, match="exact adapter-only"):
        publisher.validate_adapter_safetensors(adapter, config)


@pytest.mark.parametrize(
    "metadata",
    [
        None,
        {"format": "pt", "unreviewed": "value"},
        {"format": "tensorflow"},
    ],
)
def test_metadata_must_be_exactly_benign(
    tmp_path: Path,
    metadata: object,
) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    write_sparse_safetensors(adapter, metadata=metadata)

    with pytest.raises(ReleaseContractError, match="metadata must be exactly"):
        publisher.validate_adapter_safetensors(adapter, adapter_config())


@pytest.mark.parametrize(
    ("dtype", "non_finite_bytes"),
    [
        ("BF16", struct.pack("<H", 0x7FC1)),
        ("F16", struct.pack("<H", 0x7E01)),
        ("F32", struct.pack("<I", 0x7FC00001)),
    ],
)
def test_non_finite_tensor_values_are_rejected(
    tmp_path: Path,
    dtype: str,
    non_finite_bytes: bytes,
) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    data_start, offsets = write_sparse_safetensors(adapter, dtype=dtype)
    first_key = next(iter(sorted(offsets)))
    with adapter.open("r+b") as handle:
        handle.seek(data_start + offsets[first_key][0])
        handle.write(non_finite_bytes)

    with pytest.raises(ReleaseContractError, match="contains non-finite values"):
        publisher.validate_adapter_safetensors(adapter, adapter_config())


def test_missing_tensor_key_is_rejected(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    missing_key = next(iter(sorted(expected_shapes())))
    write_sparse_safetensors(adapter, omit_key=missing_key)

    with pytest.raises(ReleaseContractError, match="exact 32-layer"):
        publisher.validate_adapter_safetensors(adapter, adapter_config())


def test_wrong_tensor_shape_is_rejected(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    key = next(iter(sorted(expected_shapes())))
    write_sparse_safetensors(adapter, shape_override=(key, [1, 1]))

    with pytest.raises(ReleaseContractError, match="invalid shape"):
        publisher.validate_adapter_safetensors(adapter, adapter_config())


def test_unsupported_tensor_dtype_is_rejected(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    write_sparse_safetensors(adapter, descriptor_dtype="I16")

    with pytest.raises(ReleaseContractError, match="invalid dtype"):
        publisher.validate_adapter_safetensors(adapter, adapter_config())


def test_renamed_payload_is_not_accepted_as_safetensors(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter_model.safetensors"
    adapter.write_bytes(b"not a safetensors container")

    with pytest.raises(ReleaseContractError, match="not a valid Dime LoRA"):
        publisher.validate_adapter_safetensors(adapter, adapter_config())
