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
