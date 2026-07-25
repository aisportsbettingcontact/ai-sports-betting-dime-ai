# Experiment: dime-sft-rehearsal-v1

## Decision

**Pipeline accepted; model artifact rejected for release.**

The experiment proves that the pinned Base model, canonical Dime chat template,
tool catalog injection, assistant-only labels, 4-bit QLoRA, checkpoint
fingerprinting, adapter save/reload, and evaluation-report pipeline execute on
the approved RTX 4090 runtime. It does not establish useful Dime behavior.

The rehearsal adapter is retained only as engineering evidence. It must not be
published, deployed, merged into the Base weights, or treated as a training
checkpoint for a production run.

## Objective

Prove the complete low-cost training path before creating a substantive
dataset:

```text
frozen Base control
→ strict data/template/runtime validation
→ three-step QLoRA rehearsal
→ immutable adapter artifact
→ adapter reload and nonzero logit effect
```

## Frozen inputs

| Item | Value |
|---|---|
| Parent | `meta-llama/Llama-3.1-8B` |
| Revision | `d04e592bb4f6aa9cfee91e2e20afa771667e1d4b` |
| Run mode | `rehearsal` |
| Seed | `1729` |
| GPU | NVIDIA GeForce RTX 4090 |
| PyTorch/CUDA | `2.8.0+cu128` / `12.8` |
| Quantization | NF4 4-bit, double quantization, BF16 compute |
| LoRA | rank 16, alpha 32, dropout 0.05 |
| Trainable parameters | 41,943,040 |
| Train/validation records | 8 / 4 synthetic fixtures |
| Maximum steps | 3 |

## Verified fingerprints

The imported RunPod manifest exactly matches the reviewed GitHub project source
used to produce it:

| Source | SHA-256 |
|---|---|
| Rehearsal config | `be2a7cfcbfacec09a4b215bff356a4f3fff16c0c96e442f05c0f1a0d57cc104b` |
| Train data | `98a07c4ae1ec87a1647177b7404db909d1db7032d9e9234e15ea74f848c3d033` |
| Validation data | `56a9e8d038ae0639dd590704ab59129bcb64bd74381165d8decc8e074f2c5c66` |
| Chat template | `2407ed345ce3013e1e1279d46ea7e4e6e78a9a0696ac226a2f24f697b9504087` |
| Tool catalog | `e964e7e4a9dfd2229f320a337618a53a815b50ac570c86fc5e2a341317fd6569` |
| Dependency lock | `42aacd1366922702d8643334af0f89da74d26c306f03279ee69467ea27123dc6` |
| Runtime contract | `87df0f32b43e77228eb1b5f910d190c2d8531b9078b1daf88f0dbe475104af97` |

The source evaluation file hash
`04ad1bb96e037d15d5a55b162060c71278601dfd43e51247f80cf7d77894a0bb`
also matches the hash recorded in the Base-control report.

## Observed results

### Foundation checks

- strict SFT and evaluation validation: passed;
- deterministic unit tests: `40 passed`;
- real-tokenizer chat-template contract: passed;
- 4-bit Base-model GPU forward pass: passed at 5.72 GB allocated;
- rehearsal training: completed all 3 steps in 31.82 seconds;
- final training loss: 2.0591;
- observed validation loss: 2.362 at step 1 and 1.945 at step 3;
- adapter reload: passed;
- active adapter: `default`;
- maximum Base/adapter logit delta: 3.21875.

### Base control

The three-case control intentionally failed:

- tool routing: 0/3;
- numeric fidelity: 0/3;
- policy action: 0/3;
- deterministic case pass: 0/3;
- critical failures: no-vig math and expected-value math.

The raw Base checkpoint repeated prompts, fabricated unsupported calculations,
did not call the required tools, and did not produce the required Dime policy
classification. This is the expected evidence that the Base checkpoint needs
instruction-and-tool foundation training.

### Rehearsal output quality

The reloaded adapter produced a repetitive and incorrect statement about a
simulation proving the universe is a simulation. This is not a regression
because the experiment changed only three optimizer steps over twelve tiny
synthetic examples. It is direct evidence that:

1. the adapter affects logits;
2. training mechanics work;
3. training loss is not a product-quality metric;
4. this artifact must never be promoted.

## Evidence location

The imported, non-weight evidence is stored under:

`evidence/rehearsals/2026-07-25/`

The archive supplied from RunPod had SHA-256:

`91f65b86bf78668e6d46c4300ffd240840492ca853927df1a313823d9f2b66de`

## Next gate

No additional GPU run is authorized by this result. The next stage is to:

1. freeze Dime v1 competencies and tool/policy contracts;
2. build a rights-cleared, human-reviewed instruction-and-tool dataset;
3. create separate development, validation, locked, and adversarial sets;
4. run deterministic data and evaluation audits;
5. approve a new experiment record before returning to RunPod.

The provider remains frozen. This record is not evidence of release readiness
or production model quality.
