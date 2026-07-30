# Credential executable closure v2 evidence

Date: 2026-07-30

Branch: `agent/credential-execution-closure-v2`

Base: `7ed09adb4fcdb9e2d9047e73e34f84c80d865b78`

Scope: PR #250 post-merge P1-A and P1-B only

## Authority and safety result

| Control                                                           | Result                                           |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Repository implementation and tests                               | Authorized                                       |
| Credential execution                                              | Not authorized; not attempted                    |
| Production login                                                  | Not authorized; not attempted                    |
| Hugging Face or RunPod execution                                  | Not authorized; not attempted                    |
| Railway/provider mutation                                         | Not authorized; not attempted                    |
| Root/administrator trust installation                             | Not provisioned; separate authorization required |
| Secret, credential, cookie, or Railway-variable bytes in evidence | Zero                                             |

The mandatory access capsule failed closed before implementation with
`node execution is blocked: independent root-owned provenance is unavailable`.
That gate was not bypassed and no credential-bearing command was run.

## P1-A: 1Password executable

The selected canonical absolute `op` path now passes two successful commands in
order:

1. `/usr/bin/codesign --verify --strict --verbose=4 <path>`
2. the same cryptographic verification plus the designated requirement for
   identifier `com.1password.op` and Team ID `2BUA8C4S2C`

Failed output is discarded. Identity verification is never attempted after a
failed cryptographic stage, and `op run` cannot be planned until both stages
pass.

Adversarial coverage:

- valid signed binary accepted by both stages;
- invalid signature with expected display metadata rejected;
- failed command with expected stderr metadata rejected;
- wrong identifier rejected;
- wrong Team ID rejected; and
- unsigned binary rejected before identity verification.

## P1-B: production-authentication closure

The credential-bearing child is now designed as:

```text
root-owned authentication/v2 (0555)
├── scripts/dime-production-auth.bundle.mjs (0444)
├── config/dime-agent-access.v1.json (0444)
├── ml/dime-1.0/configs/platform_contract.json (0444)
└── node_modules
    ├── playwright (complete closed inventory)
    └── playwright-core (complete closed inventory)
```

The signed closure manifest identifies the complete application inventory,
exact deterministic bundle, exact Node, exact browser executable, both exact
configuration files, and both Playwright package-tree inventories. It also
fixes the working directory, environment allowlist, cleared `NODE_PATH`,
cleared `NODE_OPTIONS`, and private-standard-input-pipe credential transport.

The root-pinned broker verifies its compiled Node, Railway, bundle, manifest,
and public-key hashes and structural modes. It then starts a broker-only
no-credential preflight in the immutable application directory. The preflight
verifies the Ed25519 signature and every closure entry before the native broker
can call Railway variable retrieval. The credential child repeats closure
verification before reading its private standard-input pipe and launches the
exact manifest-pinned browser executable.

Candidate generation bundles all repository-local modules. Its esbuild
metafile must show only `playwright` outside the Node built-in runtime. Two
independent fixture builds produced identical bundle and application-tree
hashes.

Adversarial coverage rejects:

- changed local module with unchanged top-level bundle;
- changed bundled artifact;
- changed Playwright package file;
- changed browser executable;
- changed signed manifest;
- invalid manifest signature;
- extra executable/inventory entry;
- symlinked dependency;
- writable dependency;
- ambient `NODE_PATH`, `NODE_OPTIONS`, or any non-allowlisted loader
  environment;
- any credential retrieval ordered before closure verification.

## Validation

| Command                                                      | Result                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pnpm agent:access:test`                                     | PASS — 41 tests                                                                                            |
| `pnpm exec vitest run scripts/dime-railway-keychain.test.ts` | PASS — 4 tests                                                                                             |
| `pnpm test:gated:local`                                      | PASS — 2,666 passed; 64 expected environment-bound; 0 unexplained; gate exit 0                             |
| Performance harness smoke tests                              | PASS — 6 tests with permitted local IPC                                                                    |
| Native broker strict compile (`clang`, warnings as errors)   | PASS                                                                                                       |
| Deterministic candidate fixture build                        | PASS — two identical bundle/tree hashes                                                                    |
| Local production candidate command                           | Correctly BLOCKED — installed Chrome is user-owned mode `0775` and its strict code-sign verification fails |

The local browser failure was not relaxed or bypassed. A reviewed valid browser
executable is a provisioning prerequisite.

## Residual gate

```yaml
credential_code: corrected
root_trust_material: NOT_PROVISIONED
reviewed_browser_executable: NOT_PROVISIONED
production_login: BLOCKED
hugging_face_execution: BLOCKED
runpod_execution: BLOCKED
credential_preverification_access: 0
```

Exact separately authorized provisioning instructions are in
`docs/runbooks/2026-07-30-dime-agent-access-v1.md`. Candidate generation and
ordinary broker installation cannot create or activate the trust root.
