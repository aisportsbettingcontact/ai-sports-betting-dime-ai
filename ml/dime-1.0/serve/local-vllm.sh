#!/usr/bin/env bash
# Serve the Dime 1.0 AWQ checkpoint locally with vLLM (any CUDA box; not Railway).
# Mirrors the RunPod Serverless vLLM configuration so local behavior matches prod.
#
# Usage:
#   ./local-vllm.sh <hf-repo-or-local-path> [port]
#   DIME_MODEL_API_SECRET=... ./local-vllm.sh aisportsbetting/Llama-3-Dime-1.0 8000
#
# Then point the backend at it:
#   DIME_MODEL_BASE_URL=http://127.0.0.1:8000/v1
set -euo pipefail

MODEL="${1:?usage: local-vllm.sh <hf-repo-or-local-path> [port]}"
PORT="${2:-8000}"

exec vllm serve "$MODEL" \
  --quantization awq \
  --dtype half \
  --served-model-name "${DIME_MODEL_VERSION:-dime-1.0}" \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --port "$PORT" \
  ${DIME_MODEL_API_SECRET:+--api-key "$DIME_MODEL_API_SECRET"}
