# PR #200 Dime LLM foundation audit — 2026-07-25

## Session identity

- Repository: `aisportsbettingcontact/ai-sports-betting-dime-ai`
- Base: `470e3fad9477c37228a912e5fce1db5ab328d62f`
- Branch: `agent/restore-dime-1-0-llama31-foundation`
- Base state: `ml/dime-1.0/` absent; worktree clean
- Validated implementation commit:
  `92cf9f86481e089eefa7460563ab95697e1967b9`
- Draft PR: recorded after GitHub creates it

The work was performed in a clean isolated worktree created directly from the
base above. No unrelated audit-worktree file was copied, staged, or modified.

## Source inventory

The source was treated as untrusted data and never executed. The complete
84-file snapshot below uses paths relative to the reviewed source collection;
it contains no local filesystem path. Columns are path, MIME type, byte count,
and SHA-256.

```text
.DS_Store | application/octet-stream | 6148 | cd969b26dad10367ad227aac598e91060cebcaad7d5c0d7dbfc48b57604a2ef9
README.md | text/plain | 3301 | c127a5300666a0e57ce93848b1ee72766ebbeaede058f6e81b7ce10194067725
archive/README.md | text/plain | 663 | 0b06005b947d4707c4b2bde11646488271a3479b2c054b89f72ae557b8486ad4
archive/pre-reorganization/legacy-codex-session-2026-07-24.tar.gz | application/gzip | 1087971 | 574b0c74a7eed5d70bd76fba7abcaf9c3d71937c9baf46e8a988c2b28347201d
archive/pre-reorganization/legacy-codex-session-2026-07-24_SHA256.txt | text/plain | 105 | 0f28122dade6319df10c2af7f374bd242124f5d629481a68fe72f8fc3d2e11e8
dime-ai/.gitignore | text/plain | 244 | d577da33e3e4880b1247d6e70c48f3e8846b7b021c650742dec8c44acc91b387
dime-ai/LICENSE | text/plain | 344 | 48ec263209f85c0c430ba139e6e3255de6939a4b9daa356935a2d88f9f5f98cb
dime-ai/NOTICE | text/plain | 347 | 53c93cfe58d6532998ee5a415285b8a717de88e06b5faa8d2944ffc380dd9419
dime-ai/README.md | text/plain | 8506 | 403fb1a6a7d8368209c01f944c3b35573e04e4724785cbca08fef52c2d6e5b9f
dime-ai/VERSION | text/plain | 6 | 1575e1af4a95f12f70b4ee6a6adce8160953d93ea17dc2611b90883ccc3ad3b8
dime-ai/configs/curriculum_v1.yaml | text/plain | 2424 | d5227bae35f1b6759b9041cfdf1f25c2b131c100d832cc27d7a84974a3618020
dime-ai/configs/dataset_manifest_TEMPLATE.json | application/json | 700 | a47ecb133c778d6a41ad4b54b51174884cde5354847bae9e1d3f74ae712a1e6b
dime-ai/configs/evaluation_program_v1.yaml | text/plain | 3348 | 25ad5c526af72a708b53bd8fe30d4e026df9c9a276bc2feb512c117719e44d9a
dime-ai/configs/runtime.env | text/plain | 470 | 87df0f32b43e77228eb1b5f910d190c2d8531b9078b1daf88f0dbe475104af97
dime-ai/configs/sft_full_TEMPLATE.yaml | text/plain | 1458 | 6eb7bd0d6a6112b6692bfb57b1ed3ee85844cc8dfd0835e074475d5702262f02
dime-ai/configs/sft_rehearsal.yaml | text/plain | 1312 | 80c23700fb6b0f665b66c6486b2836c13301b9a7848e268070b5675280802f8b
dime-ai/data/eval/dev.sample.jsonl | application/json | 13708 | 04ad1bb96e037d15d5a55b162060c71278601dfd43e51247f80cf7d77894a0bb
dime-ai/data/eval/safety_red_team.sample.jsonl | application/json | 7066 | 1576397bfe351e9bb9f54ec6abc9f16e8a5e73ca8152b9b8fd74fcb1f7220b09
dime-ai/data/sft/train.sample.jsonl | application/json | 13322 | 98a07c4ae1ec87a1647177b7404db909d1db7032d9e9234e15ea74f848c3d033
dime-ai/data/sft/validation.sample.jsonl | application/json | 5417 | 56a9e8d038ae0639dd590704ab59129bcb64bd74381165d8decc8e074f2c5c66
dime-ai/data/templates/eval_case_TEMPLATE.json | application/json | 1468 | 53fcb13cdf51169cc30fb479c460836414272550c5ab8ed3c20a508d639126e4
dime-ai/data/templates/sft_record_TEMPLATE.json | application/json | 1274 | 9a6006ea9846e4abe6b541db14759f35e00f89ed41116a1c116968a303734d58
dime-ai/docs/ARCHITECTURE.md | text/plain | 2744 | 46843a90fb5cd6dc965de2fcfbc5e23cc0e87913f7bcc8aaa12316ef09acbff2
dime-ai/docs/DATA_GOVERNANCE.md | text/plain | 2677 | 0e1e23bbf354b793a4427ccc69ba408a37c8d886177b73b2c433b6d5aee58454
dime-ai/docs/DIME_V1_CURRICULUM_AND_EVALUATION.md | text/plain | 12182 | 429cab24d3e48a4b032628b438348293d3ae7e06d94e224661e053553190d820
dime-ai/docs/DIME_V1_SYSTEM_ARCHITECTURE.md | text/plain | 15696 | 81261dd16933f9691be77340b9fd675b48e2768d952f33c8018e631c111f200f
dime-ai/docs/EXPERIMENT_TEMPLATE.md | text/plain | 658 | a98ffc38a91cdc3097bda0e94692b6e5ceaf6cb83ad68d6a715003854750815a
dime-ai/docs/LLAMA_LICENSE_CHECKLIST.md | text/plain | 1060 | 173fae931d9eace8683ea97a83f2d96df667ce32eb0861a4e3fd9271f1163ce6
dime-ai/docs/MODEL_CARD_TEMPLATE.md | text/plain | 2750 | 5ba2c1194bc76cb69e485c507d835c05d282b5151bbc05b36c2fb28fca6abcc1
dime-ai/docs/RELEASE_ATTESTATION_TEMPLATE.json | application/json | 789 | bf2e05add4cc7ce7ed36c589973a97d16cf7432384360b6c328a530ee5522ee3
dime-ai/docs/RELEASE_GATES.md | text/plain | 2754 | c720a24a7fa68a121d4e29d7954ee59a909e8557a080cae4d8f4e92a2c2ceea6
dime-ai/docs/TRAINING_ROADMAP.md | text/plain | 4395 | 94eedffb45eb3c592ead3619e11ff0359fa56d39b28f829e8fe43b6d6248b77a
dime-ai/docs/experiments/2026-07-25-dime-sft-rehearsal-v1.md | text/plain | 4389 | d28ce28339101c8754eab21254e7b63f1e7c7b6b8df6d52ed7c22754a9c15376
dime-ai/evidence/audits/starter-v1.1.0/curriculum-audit.json | application/json | 3525 | 4da9a7ae0080d660ce6a17ee6329bb5ee30eac94b843ac9d07978297f8b2a5fb
dime-ai/evidence/audits/starter-v1.1.0/evaluation-program-audit.json | application/json | 4724 | 524f384f4c2fae821904382ff5ba30c33ea4ec56f7192c0b5e5596e0fb7a56e5
dime-ai/evidence/rehearsals/dime-sft-rehearsal-v1/artifacts/adapters/dime-sft-rehearsal-final/adapter_config.json | application/json | 1102 | 3d59d711f27fc2882f5dbdf9645ad38a88fb7a1bca58e91de4d90f7fb00ef009
dime-ai/evidence/rehearsals/dime-sft-rehearsal-v1/artifacts/adapters/dime-sft-rehearsal-final/training_manifest.json | application/json | 1660 | d37af624e8a6767c56f96c47400e8fb525a1ab703cb495f519a48d552880b7fb
dime-ai/evidence/rehearsals/dime-sft-rehearsal-v1/artifacts/baselines/base-control.jsonl | application/json | 6237 | 4d07e41b61dacab18ae22bb38b4149e1244d9542f24150d9eeb3fdacb0714a2d
dime-ai/evidence/rehearsals/dime-sft-rehearsal-v1/artifacts/checkpoints/dime-sft-rehearsal-v1/run_fingerprint.json | application/json | 778 | 3f97b2cb991b6110e97c74be5057bf1cba5b83f6dcedb046e94596c0c2a702ac
dime-ai/evidence/rehearsals/dime-sft-rehearsal-v1/artifacts/reports/eval-report.json | application/json | 4338 | 799d95c151e67035dab4f6d252824831937d4c06bd240c3926e30ad86c0dcc58
dime-ai/prompts/chat_format_v1.md | text/plain | 1143 | 7cbcf4b19bd7f5134196966f0a2d964d9fe63bb918965b5ef635ebb8716dbef2
dime-ai/prompts/dime_system_v1.md | text/plain | 2794 | 2c87485aa8a5e53be3ada6320b44b47915638b743f75dc9699f25151660675dd
dime-ai/prompts/llama3_dime_chat_template_v1.jinja | text/plain | 847 | 2407ed345ce3013e1e1279d46ea7e4e6e78a9a0696ac226a2f24f697b9504087
dime-ai/pyproject.toml | text/plain | 563 | 3bae8ad7973997a9ddcaecd4218c1786ab1fc95fb6b8921455e139e9b8ec2719
dime-ai/requirements.lock.txt | text/plain | 1221 | 42aacd1366922702d8643334af0f89da74d26c306f03279ee69467ea27123dc6
dime-ai/schemas/dataset_manifest.schema.json | application/json | 1996 | fb11e4b689f580910c7b2198be15c6a0046bc7bfea9c08aedb133fac66884536
dime-ai/schemas/eval_case.schema.json | application/json | 5867 | 79daa69e8be18351f303f5bfa249e8577846d458b875166e5c975a0226ae74b3
dime-ai/schemas/sft_record.schema.json | application/json | 5325 | ccd00560bfa2e0ff421dafe948e9d15b3012cbdd9d5d9c92f57ab83b8ebb9369
dime-ai/schemas/tool_response.schema.json | application/json | 777 | 5a4ee70cb1fd7e3acd7b5381f692b2ddae8fbb35aea58b91b3644455e73a4324
dime-ai/scripts/adapter_smoke_test.py | text/x-script.python | 4147 | 7a445ffb8dfb493598552693c8279902f2e27f86634a7434c9b81f37bbf87e53
dime-ai/scripts/audit_curriculum.py | text/x-script.python | 1773 | 49ebcdf18a3a0d0f226db800c97a7608e25afaff2122625c17c2637d91d07302
dime-ai/scripts/audit_evaluation_program.py | text/x-script.python | 1827 | 08abbe46331eb34af7e8e8bd1e7a44e34baa40fde4da75849dd426d1c201e07f
dime-ai/scripts/baseline_generate.py | text/x-script.python | 6835 | d4a6803aa4bea5334547a44a321f06c0888e423bf2500893ff5de2abfecc87be
dime-ai/scripts/bootstrap_env.sh | text/x-shellscript | 1196 | 059f075df7fb56e66fff13d186021499745bd2dba1c2538769eddfd9bd1d12b0
dime-ai/scripts/evaluate_outputs.py | text/x-script.python | 5376 | 1fa28ecd9eb09c9c38f3a1376d9236f6344306bdbc68753ab6a553efe65798e5
dime-ai/scripts/model_smoke_test.py | text/x-script.python | 2168 | c95caf0d4e4c062551b7b477a94ca0c88f121699fd22669a45093e846cafc24f
dime-ai/scripts/publish_adapter.py | text/x-script.python | 7822 | c67766bc60736a6d7b4f92865ca5f4dbb020cbaa847aadacf5b2a8ff4a7b6840
dime-ai/scripts/template_contract_test.py | text/x-script.python | 4343 | 46f221e7e04784a754cfbcd076bb911a420b0137703bde1d526c0d1dfe2ab3d3
dime-ai/scripts/train_qlora.py | text/x-script.python | 18372 | 4510f10e0017bc561c2db3b615bca622fd4f7e4992b39f1e42cc6d0c0aa300c1
dime-ai/scripts/validate_data.py | text/x-script.python | 2366 | 75a12d9906d17f2dfe001606ba1e3f53e83867dc0f585e54cf5e4a6943082208
dime-ai/scripts/verify_runtime.py | text/x-script.python | 2154 | f3a45bf1ec004aae2bca647e6b9204a546aab032d6ad42d654be05489e9e112a
dime-ai/src/dime_ai/__init__.py | text/plain | 74 | eafba0f1698edce7c783d9ba42c2fd1fb65bb4660a765ddddcaee9adc0f45325
dime-ai/src/dime_ai/chat_format.py | text/plain | 10131 | 41a3febf6e789611ac2ddf656fd9dcc3e8c7c28f593ba4c19b944d6e7c7db46e
dime-ai/src/dime_ai/data_validation.py | text/plain | 18523 | fa4f4237e4b17918a2207083e66dea48e2c9e98322854a678eeac291c9367811
dime-ai/src/dime_ai/eval_rules.py | text/plain | 5910 | 03a530e792429b99f5029dc5b665313d9eaa1dedff8c864a56f97d5d6241eb8a
dime-ai/src/dime_ai/market_math.py | text/plain | 8125 | d0d7165d9ebca956ccf5a0d800391b19c2fda14337b7d2ffbb95f7e318f59405
dime-ai/src/dime_ai/program_audit.py | text/plain | 12395 | d40336183e356d8a17cc5d5a8834b2266240f287dc053c5f64efa15bd691a0f2
dime-ai/tests/test_chat_format.py | text/x-script.python | 2943 | 47b71a7eb5d1dbb24d6a735fd14ecf4e32eba388a0866eab2015570f7ad20753
dime-ai/tests/test_data_validation.py | text/x-script.python | 9322 | 95b54e87ba3a76de50343f42b38591bb0227bdd0084975d4a6a970188ce0aa8d
dime-ai/tests/test_eval_rules.py | text/x-script.python | 2804 | 98ff949befef3c87158bc85c36d3d46bee3f37036a15206d53f089f22509a83e
dime-ai/tests/test_market_math.py | text/x-script.python | 4479 | c2a214afb600f6e91f40c065c9e61253f557a7641f5ca7f1176239429998d2e3
dime-ai/tests/test_program_audit.py | text/x-script.python | 4382 | fdcfc652d2470172b732e4795fd05cf4fd75be8376f483151650202a89a1b42c
dime-ai/tools/tools.v1.json | text/plain | 9294 | e964e7e4a9dfd2229f320a337618a53a815b50ac570c86fc5e2a341317fd6569
dime-ai/uv.lock | text/plain | 45808 | ebd1f64a528ac4787ab25f7726026bef83906cd20b15aa7e4d32b3ac3273eb10
docs/README.md | text/plain | 1117 | 96b33321a807661e83092c2738b5e2bf6b6a9b72ef8a96ddde0a8a7bb9cfe874
docs/plans/2026-07-25-rehearsal-verification-and-v1-build-plan.md | text/plain | 6383 | 3ae42b1fbbd84c23c220abb922136cb95a36732efa94673315d747149905e9eb
docs/research/2026-07-24-model-and-training-strategy.md | text/plain | 52209 | 65709ff5b392b4272b400c2b40ae10dc25fe369db62bdeb41f61dbf4d71a309c
docs/research/2026-07-25-llama3-build-finetune-and-optimization-playbook.md | text/plain | 46098 | 637c16bec31e95851781d91dcff7ba8e92ac15969527e2eaf22fe2254db67093
releases/README.md | text/plain | 788 | 122f0f8f718fcec9a8fb20eef891f359f059da8f090e1a30a224dda888f95fef
releases/v1.0.0/Dime_Llama_Training_Starter_1.0.zip | application/zip | 76004 | 4827544be433c8d88dc22cb5067a7fb1c1ebf280519240d1270c13cf4dfe2aa8
releases/v1.0.0/Dime_Llama_Training_Starter_1.0_RunPod_Guide.md | text/plain | 4832 | a4f6480ebe1b088260e7f9ab13a399503dac19e4e04b8753106f7c2811863d95
releases/v1.0.0/Dime_Llama_Training_Starter_1.0_SHA256.txt | text/plain | 102 | 5745fda69ef0ef3abc93470cfd9a03099513431efe2e8020b564f74873e6df9e
releases/v1.1.0/Dime_Llama_Training_Starter_1.1.zip | application/zip | 112436 | 545bcbfe2b52f251fcdef7000aaba0f5d4bcd688d7201a18e699c5d5093c8ad0
releases/v1.1.0/Dime_Llama_Training_Starter_1.1_SHA256.txt | text/plain | 102 | 412de361914d842d9e03246e034ad88ab72141086eaa07a589a321ed33d2c6ef
```

Pre-import inspection found no nested Git repository, symlink, environment
file, private key, unexpected publishable binary, private endpoint, or model
weight. One synthetic secret-shaped test fixture and one example email were
rewritten as noncontiguous fragments without weakening validation. Obsolete
project-root assumptions were repaired; documented disposable compute cache
paths remain environment-scoped rather than repository assumptions.

## Mapping and exclusions

- `dime-ai/**` mapped to `ml/dime-1.0/**`, then adapted for the monorepo.
- `docs/README.md` mapped to `ml/dime-1.0/docs/README.md`.
- `docs/research/*.md` mapped to `ml/dime-1.0/docs/research/*.md` and labeled
  date-stamped background material.
- `docs/plans/*.md` mapped to `ml/dime-1.0/docs/plans/*.md`.
- The collection root README, metadata file, archive tree, releases tree,
  packaged ZIP/TAR material, checksums for packages, obsolete v1 RunPod guide,
  raw generated baseline, caches, environments, logs, and generated artifacts
  were excluded.
- No old adapter merge, AWQ quantization, local vLLM serving, dataset generator,
  or dataset auditor implementation was restored from history.
- The existing application-level `dime-ai/` tree was not changed.

## Public-data and privacy review

The committed JSONL corpus consists of four clearly named `.sample.jsonl`
files: 8 synthetic training records, 4 synthetic validation records, and 16
synthetic public evaluation records. The repository-boundary validator found
28 sample records and zero non-sample JSONL files. No user history,
conversation, account identifier, provider export, private retrieval context,
licensed odds/splits export, hidden evaluation, raw prompt with private
context, or hash of raw personal data is included.

The two synthetic Bet Tracker coaching examples were corrected from imported
user-data metadata to synthetic-only metadata; their content was already
wholly fabricated. A new v3 manifest contract binds publication
classification, provenance, ownership, rights, restrictions, synthetic and
user/provider status, record counts, whole-file hashes, approvals, reviews,
audits, deletion policy, and limitations. V2 behavior remains supported.
Non-sample public data fails closed unless the exact approved train/validation
pair is bound by a fully approved-public v3 manifest.

## License finding

`LICENSE` and `NOTICE` were preserved byte-for-byte. The license says:

```text
Copyright (c) 2026 Tailered Sports. All rights reserved.

This internal starter kit is provided for evaluation and development within
Tailered Sports. No public redistribution or sublicensing permission is granted
by this file. A qualified reviewer must select and document the production code
and adapter licenses before any external release.
```

Because a public feature branch is publication, no push is authorized until
the owner gives the explicit publication confirmation required by this task.
That exact confirmation was received in the task thread on 2026-07-25 before
the first push. `LICENSE` and `NOTICE` remain unchanged.

## Rehearsal evidence selection

The evidence archive was listed and path-validated before extraction outside
the repository. It contained five safe regular files and no traversal or
symlink entry. Archive SHA-256:
`91f65b86bf78668e6d46c4300ffd240840492ca853927df1a313823d9f2b66de`.

Four small, reviewed JSON files were preserved verbatim: adapter
configuration, training manifest, run fingerprint, and evaluation report.
Their published hashes are recorded in
`ml/dime-1.0/evidence/rehearsals/2026-07-25/SHA256SUMS`. The generated
base-control output and archive were excluded. The README records 8 training
records, 4 validation records, 3 of 10 evaluation cases scored, zero passes,
critical failures, `release_gate_pass: false`, mechanical adapter reload
success, and repetitive qualitatively unusable output. It explicitly keeps
the provider frozen.

## Validation evidence

- `uv lock --check`: passed; lock synchronized.
- `uv sync --frozen --dev`: passed; 13 CPU development packages installed.
- Ruff: passed, zero findings.
- Pytest: 55 passed, 0 failed, 0 skipped.
- Python compile: passed for `src` and `scripts`.
- Data validation: passed; 8 train, 4 validation, 16 evaluation records, 2
  evaluation files, 7 tools, 4 sample files, 28 sample records, 0 non-sample
  files.
- Dependency health: 13 packages checked, all compatible.
- Curriculum and evaluation-program audits: regenerated to temporary paths and
  matched both committed starter reports byte-for-byte. Both reports remain
  truthfully non-release (`pass: false`).
- TypeScript: `tsc --noEmit` passed.
- Focused Dime tests: 4 files passed, 45 tests passed, 0 failed.
- Full local environment gate: policy passed; 158 files ran, 146 passed and 12
  had environment-bound failures; 2,329 tests ran, 2,265 passed and 64 failed
  only for declared unavailable database/provider/CI configuration; 0 skipped,
  0 not-executed, 64 classified environment-bound.
- Production build: passed; 3,156 client modules transformed, preview gate
  passed across 104 files, server bundle built.
- Bundle: 217,753 gzip bytes, 689 bytes under the 218,442-byte ceiling.
- `git diff --check`: passed.
- Gitleaks: not executed because no trusted installation was available.

Not executed: runtime GPU verification, model smoke test, tokenizer-backed
template test, baseline generation, QLoRA training, adapter smoke test, adapter
publishing, model/tokenizer download, any GPU operation, any model-host upload,
and any disposable-compute operation. These are gated, require credentials or
GPU access, and are prohibited for this CPU/public-repository validation.

The provider constant remains exactly `"frozen"`. No deployment, database
mutation, model-host mutation, compute-provider mutation, tag, release, or
production operation occurred.
