#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${DIME_PROJECT_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
VENV_DIR="${DIME_VENV_DIR:-/opt/dime-venv}"
PIP_CACHE_DIR="${DIME_PIP_CACHE_DIR:-/workspace/.cache/pip}"
export HF_HOME="${HF_HOME:-/workspace/.cache/huggingface}"

if [[ ! -d "${PROJECT_DIR}" ]]; then
  echo "Project directory not found: ${PROJECT_DIR}" >&2
  exit 1
fi

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is not configured. Attach the RunPod Hugging Face secret first." >&2
  exit 1
fi

mkdir -p "${PIP_CACHE_DIR}" "${HF_HOME}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Creating fast environment at ${VENV_DIR}"
  python -m venv --system-site-packages "${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install \
  --cache-dir "${PIP_CACHE_DIR}" \
  --requirement "${PROJECT_DIR}/requirements.lock.txt"
python -m pip install --no-deps --editable "${PROJECT_DIR}"
python -m pip check
python "${PROJECT_DIR}/scripts/verify_runtime.py"

echo "Environment ready: $(command -v python)"
echo "HF_HOME: ${HF_HOME:-NOT SET}"
if [[ -n "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN configured: True"
else
  echo "HF_TOKEN configured: False"
fi
