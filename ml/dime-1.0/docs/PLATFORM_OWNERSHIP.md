# Platform ownership contract

This contract defines where each Dime 1.0 asset is allowed to live. A branch or
draft pull request in this repository is already public.

## GitHub: canonical reviewed source

GitHub `main` permanently owns:

- source code;
- versioned prompts, chat templates, and tool contracts;
- dataset and evaluation schemas;
- synthetic or redistribution-cleared public training fixtures;
- public development evaluation cases;
- configurations, documentation, tests, and CPU-safe validation workflows;
- dataset manifests and SHA-256 hashes;
- experiment configurations and sanitized run fingerprints;
- sanitized evaluation reports and score summaries;
- model-card templates and release-gate definitions.

Branches and pull requests contain draft work. Only reviewed, rights-cleared
material may merge into `main`. Private data must never be committed, even
temporarily.

## Private Hugging Face model repository

The intended model repository is
`taileredsports/Llama-3-Dime-1.0`. It owns approved model artifacts:

- LoRA or QLoRA adapter weights;
- checkpoints;
- merged or quantized model weights;
- tokenizer artifacts or additions;
- release-specific model cards and artifact metadata; and
- deployment bundles.

This project does not upload or publish any model artifact by itself. Training
must use a write-scoped credential; future serving must use a separate
read-scoped credential. Neither credential belongs in GitHub.

## Private Hugging Face dataset repository

A separate private dataset repository will own private or proprietary approved
training data, licensed provider-derived data, hidden and locked evaluations,
private fixtures, and non-public dataset versions. Its name has not been
selected. This repository must not invent or create it.

## RunPod

RunPod is disposable compute only:

- a temporary GPU environment;
- caches and a training workspace;
- generated checkpoints awaiting authorized transfer; and
- temporary logs.

RunPod is never the permanent source of truth. A GPU session begins from a
clone or synchronized checkout of this GitHub repository and then enters
`ml/dime-1.0/`.

## Application user data

Bet Tracker histories, chat histories, user identifiers, raw account data, and
private conversations remain in the application’s authorized data systems.
They are not training data by default.

They must not enter GitHub or model training until consent, rights, deletion,
retention, de-identification, partitioning, and privacy controls are formally
approved.

## Prompt and runtime authority

- `prompts/dime_system_v1.md` is the versioned training behavior contract.
- `prompts/llama3_dime_chat_template_v1.jinja` is the versioned chat-template
  contract.
- `tools/tools.v1.json` is the versioned tool catalog.
- `server/_core/dime1Model.ts` is a frozen runtime integration scaffold.

The runtime and training prompts are not asserted to be identical. A later,
owner-authorized promotion pull request must reconcile and hash the approved
runtime prompt against the canonical training prompt before provider
activation.
