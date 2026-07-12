# Dime 1.0 — training, quantization, and serving runbook

Dime 1.0 is the self-hosted model behind Dime Chat's `"dime1"` provider: a QLoRA
fine-tune of `meta-llama/Meta-Llama-3-8B-Instruct`, quantized to 4-bit AWQ, served
by vLLM behind a **private RunPod Serverless endpoint**.

- **Product alias:** `Dime 1.0` (what the platform and served model name use)
- **Artifact name:** `Llama-3-Dime-1.0` — the Meta Llama 3 license requires
  derivative model names to begin with "Llama 3" (see [License compliance](#license-compliance))
- **Profile version:** `1.0.0` (`server/_core/dime1Model.ts`)

## v1 role (deliberately narrow)

1. Sports-betting-only analysis and explanation
2. Retrieval-grounded answers from Dime's live database context
3. Odds, projections, splits, and line-movement interpretation
4. Routing, extraction, classification, tagging, and summarization
5. Strict refusal to invent missing data

Non-goals for v1: web browsing, tool use, general chat, code, long-form content.

## Architecture

Railway hosts Dime AI. RunPod hosts the Dime 1.0 GPU model. Do not run the model
on Railway, and do not move the backend off Railway.

```
Dime AI frontend
        ↓
Railway backend            ← control plane (this repo)
  auth · entitlement · rate limits · sports/projection/splits retrieval
  prompt construction · deterministic calculations · response validation · logging
        ↓
Private RunPod endpoint    ← execution plane
  Dime 1.0 · vLLM · 4-bit AWQ · OpenAI-compatible API
        ↓
Validated response returned through Railway
```

| Component | Host |
|---|---|
| Dime website / backend API / database / data pipelines | Railway |
| Retrieval and prompt construction | Railway |
| Dime 1.0 inference | RunPod Serverless (load-balancing endpoint) |
| QLoRA training | Temporary RunPod Pod (terminated after artifacts are saved) |
| Model artifacts | Private Hugging Face repository |
| Serving engine | vLLM |
| Production GPU | 24 GB class (L4 / A5000 / 3090) — **not** an H100 |

Server wiring in this repo: `server/_core/dime1Client.ts` (transport),
`dime1Model.ts` (profile + system prompt), `dime1ChatHandler.ts` (chat branch),
`dime1Tasks.ts` (utility scopes), registered in `server/dime-chat.route.ts`
behind `DIME_CHAT_LLM_PROVIDER` in `server/_core/dimeChatModel.ts`.

## Environment variables

Railway backend (runtime):

| Variable | Purpose |
|---|---|
| `RUNPOD_ENDPOINT_ID` | Derives `https://api.runpod.ai/v2/<id>/openai/v1` |
| `DIME_MODEL_API_SECRET` | Bearer token for the private endpoint (wins over the API key) |
| `RUNPOD_API_KEY` | RunPod account key (fallback bearer; also used by tooling) |
| `DIME_MODEL_VERSION` | Served model name pin, e.g. `dime-1.0-v1.0.0` (falls back to `dime-1.0`) |
| `DIME_MODEL_BASE_URL` | Optional explicit OpenAI-compatible base URL incl. `/v1` (local dev override) |
| `DIME_MODEL_TIMEOUT_MS` | Optional request timeout (default 60000) |

Training / artifact side: `HF_TOKEN` (gated Llama 3 access + private repo pushes).
Never commit any of these; never bake them into images.

## Hugging Face private repo layout

One private repo, e.g. `aisportsbetting/Llama-3-Dime-1.0`:

```
adapter/          QLoRA adapter (LoRA weights + adapter_config.json)
merged/           fp16 merged checkpoint
awq/              4-bit AWQ production checkpoint  ← what RunPod serves
eval/             eval reports per version
MANIFEST.json     version manifest: base model, data hash, training args, eval scores
README.md         model card ("Built with Meta Llama 3", intended use, limits)
```

Tag every push with the `DIME_MODEL_VERSION` string. RunPod caches HF models
(including gated ones) across worker restarts — prefer HF-cached loading over
baking weights into the Docker image.

## Pipeline

### 0. License + access (once)

Accept the Meta Llama 3 license on the gated `meta-llama/Meta-Llama-3-8B-Instruct`
repo with the HF account that owns `HF_TOKEN`.

### 1. Create the training Pod (temporary)

| GPU | VRAM | ~$/hr | Use |
|---|---|---|---|
| RTX A6000 | 48 GB | $0.49 | **Default QLoRA training** |
| L40S | 48 GB | $0.99 | Faster training, newer hardware |
| A100 PCIe | 80 GB | $1.39 | Large runs, rapid experimentation |

PyTorch template, ≥100 GB volume. The Pod exists only for the run and is
**terminated after** the adapter, merged checkpoint, quantized artifact, eval
report, and training metadata are saved to HF.

```bash
git clone <this repo> && cd ai-sports-betting-dime-ai/ml/dime-1.0
pip install -r requirements.txt
export HF_TOKEN=...
```

### 2. Prepare data

See `data/README.md` for the schema (chat-format JSONL) and required category
mix — grounded analysis, missing-data refusals, off-topic refusals, utility
tasks, responsible gambling, injection resistance. `data/sample.train.jsonl`
shows the exact shape. Real training data is built from platform exports and
**never committed** to this repo.

### 3. Train (QLoRA, 4-bit NF4)

```bash
python train_qlora.py \
  --data /workspace/data/train.jsonl \
  --eval-data /workspace/data/val.jsonl \
  --out /workspace/out/adapter
```

Defaults: LoRA r=32 α=32 dropout=0.05 on all attention+MLP projections, NF4
double-quant base, bf16 compute, lr 2e-4 cosine, 2 epochs, seq len 4096.
~10–14 GB VRAM — fits the A6000 with headroom.

### 4. Merge and quantize (AWQ 4-bit for vLLM)

```bash
python merge_adapter.py --adapter /workspace/out/adapter --out /workspace/out/merged
python quantize_awq.py  --model  /workspace/out/merged  --out /workspace/out/awq
```

AWQ (w4, group 128, GEMM) is the production format — vLLM loads it directly
with `--quantization awq`. (GPTQ or BitsAndBytes also work with vLLM if ever
needed; GGUF is for llama.cpp, not vLLM.)

### 5. Evaluate — gates for unfreezing

```bash
# serve the AWQ checkpoint locally on the pod first (serve/local-vllm.sh), then:
python eval/eval_grounding.py \
  --endpoint http://127.0.0.1:8000/v1 --model dime-1.0 \
  --cases eval/sample.eval.jsonl --out /workspace/out/eval-report.json
```

Hard gates (script exits non-zero below thresholds):
- Missing-data refusal recall ≥ 0.95 (never answers with invented lines)
- Zero prohibited-certainty hits ("lock", "guaranteed", "risk-free", …)
- Off-topic refusal recall ≥ 0.95
- Grounded-answer accuracy ≥ 0.90 on must-contain checks

### 6. Push artifacts, terminate the Pod

```bash
huggingface-cli upload aisportsbetting/Llama-3-Dime-1.0 /workspace/out/adapter adapter --private
huggingface-cli upload aisportsbetting/Llama-3-Dime-1.0 /workspace/out/merged  merged  --private
huggingface-cli upload aisportsbetting/Llama-3-Dime-1.0 /workspace/out/awq     awq     --private
huggingface-cli upload aisportsbetting/Llama-3-Dime-1.0 /workspace/out/eval-report.json eval/v1.0.0.json --private
```

Update `MANIFEST.json`, then **terminate the Pod**.

### 7. Deploy the RunPod Serverless endpoint

RunPod Console → Serverless → New Endpoint → vLLM worker:

- **Endpoint type:** Load balancing (low-latency real-time API)
- **GPU:** 24 GB class (L4 / A5000 / 3090) — ~$0.69/hr active; 4090 Pro tier
  ~$1.10/hr if latency demands it. A 4-bit 8B model is ~4 GB of weights; 24 GB
  is the production minimum for KV cache, batching, and long prompts. **No H100.**
- **GPUs per worker:** 1
- Model: `aisportsbetting/Llama-3-Dime-1.0` (subfolder `awq`), `HF_TOKEN` set
- vLLM env: `QUANTIZATION=awq`, `SERVED_MODEL_NAME=dime-1.0` (must match
  `DIME_MODEL_VERSION` if pinned), `MAX_MODEL_LEN=8192`,
  `GPU_MEMORY_UTILIZATION=0.90`, API key = `DIME_MODEL_API_SECRET`

Worker settings:

| Phase | Active workers | Max workers | Idle timeout |
|---|---|---|---|
| Internal testing | 0 (scale-to-zero; cold starts expected) | 1 | 5–15 s |
| Paid beta | 1 (~$0.69 × 730h ≈ **$503.70/mo**) | 3 | default |

Flex workers cost nothing while idle and absorb bursts; the active worker
carries baseline traffic. Access is private: Railway is the only caller,
authenticated with the bearer secret.

### 8. Wire Railway and unfreeze

1. Set the Railway env vars from the table above.
2. Smoke the endpoint from a Railway shell:
   `curl -s $BASE/chat/completions -H "Authorization: Bearer $DIME_MODEL_API_SECRET" -d '{"model":"dime-1.0","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'`
3. Flip `DIME_CHAT_LLM_PROVIDER` to `"dime1"` in `server/_core/dimeChatModel.ts`.
   This is a deliberate code change (not an env var) and requires updating the
   provider-freeze contract test expectations in the same PR.
4. Do this only after the step-5 eval gates pass on the deployed checkpoint.

## License compliance

Meta Llama 3 Community License:
- Derivative model names must begin with "Llama 3" → the artifact is
  **`Llama-3-Dime-1.0`**. "Dime 1.0" is the product/service alias only.
- Include "Built with Meta Llama 3" attribution on the model card and any
  public surface that names the underlying model.
- Redistribute the license and Acceptable Use Policy with any weight sharing
  (the private HF repo counts — keep them in the repo).
- Weights are gated: every environment that pulls them needs an HF token whose
  account accepted the license.

## Local development

No GPU on Railway or laptops? Run the AWQ checkpoint on any CUDA box with
`serve/local-vllm.sh`, then point the backend at it with
`DIME_MODEL_BASE_URL=http://127.0.0.1:8000/v1`. The backend behaves identically —
the client resolves an explicit base URL before the RunPod-derived one.
