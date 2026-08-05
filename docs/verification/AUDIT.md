# Verification framework — Phase 0 discovery audit

Date: 2026-08-05 · Auditor: principal-platform-engineer pass (agent-assisted)
Variables: **RISK_TIER=critical** (Stripe billing, sessions/OAuth, PII, model
behavior all ship from this repo) · **AI_SURFACE=true** · ORG_CONTEXT:
Tailered Sports, Inc. — solo-maintainer sports-betting SaaS (Dime AI) deployed
on Railway (~90 paying subscribers), Stripe + Discord integrations,
responsible-gaming compliance surfaces, heavy agent-assisted development.

## 1. Stack

| Surface | Facts |
|---|---|
| Languages | TypeScript (strict; client React 18 + Vite 7, server Express + tRPC 11, esbuild bundle), Python 3 (model runners `server/*.py`, crawl/etl `scripts/mlb-*`, governed ML `ml/dime-1.0` on uv), Bash (ops), C (`scripts/dime-railway-keychain.c`, device-only broker) |
| Package managers / lockfiles | pnpm (`pnpm-lock.yaml`, `packageManager`-pinned via corepack), uv (`ml/dime-1.0/uv.lock`), `requirements.txt` (local-dev python; Railway installs via apt) |
| Build artifacts | Docker image (node:22-bookworm-slim + apt python/chromium), built BY RAILWAY from git on push to main (`COPY . .` + `pnpm run build`); dist = client bundle + server esbuild bundle + copied .py/.mjs engines |
| Deploy | Railway auto-deploy from `main` (merge to main IS production deploy). No artifact promotion — source rebuild. See §6 gap. |
| DB | MySQL/TiDB via drizzle-orm; migrations = `drizzle/0000–0132_*.sql` + `_journal.json`, applied by the repo's own reconciler (`scripts/reconciled-migrate.mjs`) through the manual `db-push.yml` workflow. Consumer-pinned snapshots 0108/0122/0132 guarded by `drizzle-meta-hygiene.test.ts`. |
| API schemas | tRPC (compile-time TS contracts; no OpenAPI/Protobuf/GraphQL). No cross-service consumers (the legacy second service is a decommissioned zombie). |
| Generated code | None regenerated at build time. drizzle-kit generate output is committed SQL, produced only through the owner-run `db:push` path. |

## 2. Existing CI inventory (24 workflows)

**PR/push gates:** `ci.yml` (jobs: security-audit [actions-security + OSV + env-failure gates], typecheck, test [gated vitest], db-tests [isolated DB + reconciled-chain replay], build [preview-production gate + bundle budget], smoke), `gitleaks.yml`, `feed-responsive-cross-browser.yml` (push), `dime-llm-validation.yml` (push/PR, `ml/**` paths — 1200+ deterministic tests incl. governed-manifest checksum/contamination checks).
**Scheduled:** 6 sport/stripe crons, `security-audit-weekly.yml`, `stripe-e2e.yml`.
**Dispatch ops:** db-push/query/reconcile, deploy-smoke, seeds, perf, p0 verifiers, pi-review (paused), railway-p0-control.

**Required checks on `main` (live ruleset `main-protection` id 18701573 + classic protection):** Security Audit, TypeScript Check, Vitest, Secret Scan (gitleaks); strict (branch must be current); PR review + code-owner + last-push approval; conversation resolution; non-fast-forward + deletion blocked; enforce_admins.

## 3. Fail-open findings (Phase 0 flag list)

| Location | Pattern | Verdict |
|---|---|---|
| `ci.yml:98` `osv-scanner … \|\| true` | scanner exit swallowed | **Fail-closed downstream** — `scripts/check-osv-scan.mjs` throws on missing/malformed report (verified lines 55/96, has its own test). Documented, not a defect. |
| `security-audit-weekly.yml` (6× `\|\| echo`) | summary-formatting fallbacks in a scheduled REPORT job | Cosmetic only; the audit content itself is attached raw. Accepted for the nightly report; the PR-blocking path does not use these. |
| `p0-*-verify.yml` (`\|\| true` ×4) | dispatch-only debugging tools | Not merge gates. Accepted. |
| Zero-tests-collected | — | **Already guarded**: `check-environment-failures.mjs` env-gate marks "file failed before any test ran" as never excusable (proven in production during the 0122-snapshot incident). |
| `continue-on-error` | none anywhere | ✅ |
| Action pinning | **0 non-SHA refs across 135 `uses:`** — enforced by the repo's own `check-github-actions-security.mjs` gate (63 refs checked each PR) | ✅ already at target |
| Workflow permissions | minimal-permissions enforced by the same gate (21 production-secret refs audited) | ✅ |

## 4. AI surface inventory

- **Prompts:** `server/_core/dimeChatModel.ts` (FALLBACK_DIME_CHAT_SYSTEM_PROMPT; content-pinned by tests), `server/dime-wc2026.route.ts` (WC2026_SYSTEM_PROMPT; 14-step enforcement, 22-path validated per header), platform knowledge `shared/dime/platform_knowledge_v1.json` (SHA-256 written into runtime prompts + Trace events).
- **Agent runtimes:** `server/_core/dimeAgent.ts` (Claude Agent SDK subprocess; env allowlist + deny-tested), `server/_core/piAgent.ts` (in-process pi-agent-core), both gateway-routed (`ANTHROPIC_BASE_URL`/`AUTH_TOKEN`).
- **Model routing:** `DIME_CHAT_LLM_PROVIDER = "anthropic"` pinned (owner-gated; `dimeChatProviderFreeze.test.ts`); model access tiers `dimeModelAccess.ts`; trace/observability `dimeChatTrace.ts` + pricing attestation tests.
- **Governed ML lane (dormant):** `ml/dime-1.0` — datasets/evals/adapters governed by manifests (`evidence/manifests/*/closure.json` + `SHA256SUMS`) carrying sha256/record counts/contamination checks, enforced by `test_phase1_observability_closure.py` + `test_governed_json.py` (this IS the Layer-7 governed-manifest requirement, already live).
- **Weights:** none in repo (adapter-only HF repos, governance cards only).

## 5. Test posture

Vitest 2.1.9, ~3,700 tests; DB-bound suites env-gated (local profile) and run against an isolated DB in CI. No coverage tooling configured (gap → Layer 6). No property-based testing (gap). No mutation/fuzz (gap). Python: mlb crawl/etl tests are local-only by design (depend on untracked 47G corpus); ml/dime-1.0 pytest (1207) runs in dime-llm-validation.

## 6. Gaps this framework fills (and honest non-fits)

**Real gaps:** CodeQL; Semgrep w/ repo-specific rules; dependency review + license policy; Renovate (currently dependabot auto-merge for patches only); zizmor (homegrown gate covers pinning/permissions but not untrusted-input interpolation classes); OpenSSF Scorecard; patch-coverage gate; property tests; mutation/fuzz (advisory); PR-time Docker build + Trivy + ephemeral boot smoke (**would have caught the 2026-08-05 dockerignore/esbuild production build failure at PR time**); SBOM + provenance attestation; proof-contract artifact; merge queue; `merge_group` triggers on required workflows; AI-review tooling.

**Documented non-fits / adaptations:**
- *Buf / Redocly / Pact*: no Protobuf/OpenAPI/cross-service consumers — N/A (tRPC compile-time contracts are covered by `tsc` + contract tests). Revisit if a public API ships.
- *Atlas migration linting*: the repo has a bespoke, tested reconciler with journal-integrity + destructive-history protections; adding Atlas would create a second source of truth. Adaptation: destructive-SQL lint + reconciled-chain replay (already in `db-tests`) + meta-hygiene tests, aggregated under check 08.
- *Codecov*: external account not assumed; native v8 coverage + an in-repo patch-coverage checker instead.
- *Build-once/promote-digest (SLSA)*: **Railway rebuilds from source on merge; it does not consume our attested artifact.** CI builds+attests the same Dockerfile as verification evidence (proves the source builds and what it contains), but promotion-by-digest requires switching the Railway service to image deploys — an owner decision recorded in ROLLOUT.md as the end-state.
- *Prettier as blocking format gate*: `--check` currently fails on 316 files. Starts advisory; a format-all commit graduates it (ROLLOUT.md).
- *CI model calls (AI reviewer LLM judges, promptfoo model evals)*: **paused by owner law** (LLM.md API-credit budget). Layer 9/10 ship config + deterministic subsets; anything that spends model tokens in CI is dispatch-only until the owner lifts the pause.
- *CIFuzz/OSS-Fuzz*: not an OSS-Fuzz project; fuzzing implemented as fast-check fuzz properties on the real parser surfaces (AN HTML parser, invite codes, odds math) in the property suite.
- *Semgrep `--strict`*: dropped after live calibration (Wave 0, 2026-08-05). Semgrep's TS parser emits partial-parse warnings on 4 known files (modern generics in `vi.fn<T>()`, a JSX text ampersand, one deep template literal) — ~0.1% of lines — and `--strict` escalates those to run failure with 0 findings. Without it the gate is still fail-closed: findings exit 1, fatal scan errors exit 2, both red. The 4 files are named in `03-semgrep.yml`'s comment.
- *Trivy gate shape*: split into two invocations (Wave 0, 2026-08-05) — a non-gating SARIF pass (CRITICAL+HIGH, exit 0) feeding the Security tab, then the blocking gate re-run in `table` format (CRITICAL fixable-only, exit 1) so a red job names its CVEs in the log instead of burying them in an unuploaded SARIF.

## 7. Secrets

GitHub push protection: org-level setting — to enable/confirm in UI (documented in RULESETS.md). Gitleaks already blocking on PR+push. CI secrets inventoried in `ci.yml` header; production creds live in Railway env, agent access via Dime brokers only.

## 8. Findings surfaced by the framework during installation

**KNOWN-FINDING-1 (owner review required — money code, deliberately NOT fixed
in the gates PR):** `settleParlay` (server/parlayCore.ts) crashes instead of
VOIDing when a pushed leg divided out of the ROUNDED ticket price leaves
decimal ≤ 1.0. Repro: legs `[+100 PUSH, -40001 WIN]`,
`originalOdds = combineLegOdds([...]) = +100` → `divideLegsOut` throws
"leaves no payout" from the grading path. `repriceParlay`'s own contract says
"the caller should VOID it" — the caller doesn't. Reachable only with extreme
favorites (|odds| ≳ 20000) where the survivor's decimal margin is smaller than
the ticket-price rounding loss. Suggested fix: a ~20-line guard in the WIN
branch returning VOID with a reason (drafted and validated against all 107
parlay tests during discovery, then reverted pending owner sign-off).
Tracked as `it.todo` in `server/property/odds.property.test.ts`.

**KNOWN-FINDING-2 (owner review) — 5 fixable CRITICAL CVEs ship in the production
image (check 09 red is a true positive).** First PR-time image scan (Wave 0,
2026-08-05, gate = CRITICAL + fixable-only):

| Component | Where | CVEs | Fix |
| --- | --- | --- | --- |
| node-tar 7.5.11 | global Node toolchain in `node:22-bookworm-slim` (npm's bundled tar; **not** in `pnpm-lock.yaml` — verified) | CVE-2026-59873 (gzip-bomb DoS) ×2 copies | 7.5.19 — arrives with a base-image/npm refresh |
| esbuild 0.18.20 linux-x64 binary | `app/node_modules/.pnpm/@esbuild+linux-x64@0.18.20` — old esbuild pulled by the `@esbuild-kit` chain (drizzle-kit loader) | CVE-2024-24790 (Go net/netip), CVE-2025-68121 (Go crypto/tls) | rebuilt esbuild ≥0.25.x via drizzle-kit upgrade or pnpm override |
| esbuild 0.25.12 linux-x64 binary | vite build chain in runtime node_modules | CVE-2025-68121 (Go crypto/tls) | rebuilt esbuild (Go ≥1.24.13) |

Root cause: the single-stage Dockerfile ships the **build toolchain into the
runtime image** — esbuild binaries and dev deps live in the production
node_modules. Runtime exploitability is low (esbuild only executes at build
time; nothing un-tars untrusted input), but every one is fixable, which is
exactly what the gate blocks on. Owner options, in order of preference:
1. Multi-stage Dockerfile: build stage → `pnpm prune --prod` (or deploy-filtered
   install) → slim runtime stage. Removes the whole class, shrinks the image and
   its attack surface. Production build change — owner-gated.
2. Targeted bumps: drizzle-kit upgrade (drops esbuild 0.18.20), base-image
   refresh for npm's tar.
3. `.trivyignore` with per-CVE justification + expiry — last resort; waives
   real fixables and weakens the gate's meaning.

**REMEDIATED 2026-08-05 (owner-authorized, option 1):** the Dockerfile is now
multi-stage — a `build` stage produces `dist`, a `proddeps` stage does a fresh
`pnpm install --prod --frozen-lockfile` (resolver-decided, no prune
semantics), and the runtime stage carries only prod `node_modules` + `dist` +
`package.json` + the one allow-listed pricing registry, with
npm/corepack/npx stripped from `/usr/local` (nothing at runtime spawns them —
verified: the server spawns only node, python3, python3.11, and chromium).
The `/app` geometry is unchanged, so `import.meta.dirname`-relative
resolution (static client serving, cp'd engines) behaves identically.
Verified by check 09's own build + Trivy CRITICAL-fixable gate + dead-DB boot
+ smoke.

**CodeQL baseline bootstrap (2026-08-05, appended for the record).** Main had
zero code-scanning analyses (default setup off, 02 PR-only, weekly cron
unfired), so the PR check attributed every pre-existing alert to the PR. Fixes:
`02-codeql` gained a `push: main` trigger (permanent baseline refresh) and a
dispatch-only baseline mode that analyzes main's actual tree and labels the
upload `refs/heads/main` (one-time bootstrap; run: baseline=true dispatch).
Main's baseline materialized 106 open alerts — the pre-existing backlog, now
visible in the Security tab alongside Dependabot's 37 dependency findings
(surfaced when the dependency graph was enabled). Two quirks worth knowing:
alert records born from pre-baseline PR analyses stay attributed to that PR
forever (all 19 were verified as unified records with open instances on main
— e.g. #333 @123, #302 @2531, #201 @50 — which is why PR #362 was closed and
recreated as PR #371 from the same branch), and check runs attach to commit
SHAs, so a recreated PR needs one fresh commit to shed the predecessor's
stale check runs (this commit).
