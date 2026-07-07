# Hardening Directive — Final Report

**Date:** 2026-07-07  
**Session:** Remediation + Hardening (Audit V2 findings + permanent guardrails)

---

## SEC-006: Credential Exposure Filing

### Credential Inventory (23 credentials — NAMES ONLY)

| # | Credential | Category | Rotation Priority |
|---|-----------|----------|-------------------|
| 1 | DATABASE_URL | Infrastructure | MUST ROTATE |
| 2 | DRIZZLE_DATABASE_URL | Infrastructure | MUST ROTATE |
| 3 | STRIPE_SECRET_KEY | Payment | MUST ROTATE |
| 4 | STRIPE_WEBHOOK_SECRET | Payment | MUST ROTATE |
| 5 | JWT_SECRET | Application | MUST ROTATE |
| 6 | SUPABASE_SERVICE_ROLE_KEY | Infrastructure | MUST ROTATE |
| 7 | GOOGLE_SERVICE_ACCOUNT_JSON | Third-party | MUST ROTATE |
| 8 | ANTHROPIC_API_KEY | Third-party | SHOULD ROTATE |
| 9 | DISCORD_BOT_TOKEN | Third-party | SHOULD ROTATE |
| 10 | DISCORD_CLIENT_SECRET | Third-party | SHOULD ROTATE |
| 11 | CF_API_TOKEN | Infrastructure | SHOULD ROTATE |
| 12 | GMAIL_APP_PASSWORD | Third-party | SHOULD ROTATE |
| 13 | METABET_API_KEY | Third-party | SHOULD ROTATE |
| 14 | KENPOM_PASSWORD | Third-party | SHOULD ROTATE |
| 15 | ROTOGRINDERS_PASSWORD | Third-party | SHOULD ROTATE |
| 16 | VSIN_PASSWORD | Third-party | SHOULD ROTATE |
| 17 | BUILT_IN_FORGE_API_KEY | Platform | LOW (platform-managed) |
| 18 | VITE_FRONTEND_FORGE_API_KEY | Platform | LOW (limited scope) |
| 19 | SUPABASE_ANON_KEY | Infrastructure | LOW (public by design) |
| 20 | VITE_STRIPE_PUBLISHABLE_KEY | Payment | LOW (public by design) |
| 21 | DISCORD_PUBLIC_KEY | Third-party | LOW (not a secret) |
| 22 | git_remote.secret_access_key | Platform | NONE (auto-rotates) |
| 23 | git_remote.session_token | Platform | NONE (expired, auto-rotates) |

### Exposure Surface

| Remote | Push Succeeded? | Contains Secrets? | Public? | Evidence |
|--------|----------------|-------------------|---------|----------|
| origin (Manus S3) | YES | YES (in history) | No (platform-internal) | VERIFIED: `git ls-tree 9a8a8420 -- .project-config.json` returns blob |
| ai-sports-betting-models | YES (after filter-branch) | NO | Private repo | VERIFIED: `gh api commits?path=.project-config.json` returns 0 |
| ai-sports-betting-manus | NO (Push Protection blocked) | N/A | N/A | VERIFIED: push error in shell output |

### Push Protection Assessment

GitHub Push Protection blocked every push attempt containing the dirty history. The only successful push to a GitHub remote contained rewritten (clean) history. No public exposure confirmed. VERIFIED.

### Status: OPEN

Credentials remain in Manus S3 git history (not publicly accessible). **Owner must confirm rotation of items 1-16 above.** Finding closes only after owner confirms all rotations complete.

---

## INC-006: Verdict

**RESOLVED.** Full run history analysis (162 failed runs examined) shows:

- Zero 401/403 runs after SEC-004 deployment (2026-07-07 04:06 UTC). VERIFIED via `manus-heartbeat logs`.
- The string "caller does not have permission" does NOT exist in our codebase. VERIFIED via `grep -rn`.
- The string is the Manus platform's notification template label for non-200 heartbeat responses. VERIFIED: the actual response bodies for the two post-deploy 500s were HTML/SVG error pages, not our JSON.
- 6 consecutive HTTP 200 runs after deploy (04:33 through 05:11). VERIFIED.

SEC-004 is NOT rejecting legitimate platform calls. The incident was caused by deploy-window service unavailability (INC-005), not by the auth gate.

---

## Test Outputs

### SEC-002 (Stripe webhook 400s) — vitest PASS

```
✓ server/stripeWebhook.sec002.test.ts (3 tests)
  ✓ returns 400 with missing_signature_header when no Stripe-Signature
  ✓ returns 400 with signature_verification_failed for invalid signature
  ✓ returns 400 with webhook_secret_not_configured when env missing
```

### SEC-001 (tokenVersion check) — vitest PASS

```
✓ server/dimeAuth.sec001.test.ts (2 tests)
  ✓ JWT claims include tokenVersion field
  ✓ authenticateDimeRequest source contains tokenVersion mismatch check
```

Note: SEC-001 test is structural (source-text assertion), not behavioral. It verifies the code contains the check, not that the route rejects revoked tokens end-to-end. Full behavioral test would require a running server with DB state.

### Pre-commit hook (gitleaks) — VERIFIED BLOCKING

```
$ echo 'const x = "sk_live_51Ta74ZPJCvfgjOblRealSecretKeyHere1234567890";' > secret_test.ts
$ git add secret_test.ts && git commit -m "test blocked"
[pre-commit] Scanning staged changes for secrets...
5:33AM WRN leaks found: 1
╔══════════════════════════════════════════════════════════════╗
║  SECRET DETECTED — commit blocked.                          ║
╚══════════════════════════════════════════════════════════════╝
EXIT=1
```

### Full test suite — 1290/1291 PASS

```
Test Files  1 failed | 60 passed (61)
     Tests  1 failed | 1290 passed (1291)
```

Only failure: `discord.bot.token.test.ts` — pre-existing Discord token validation failure (token revoked/invalid). Unrelated to this remediation.

---

## Guardrail Proof

| Guardrail | Implementation | Acceptance Test | Result |
|-----------|---------------|-----------------|--------|
| Pre-commit secret scan | `.githooks/pre-commit` (gitleaks --no-git on staged files) | Fake `sk_live_` commit attempt | BLOCKED (exit 1). VERIFIED. |
| CI secret scan | `.github/workflows/secrets-scan.yml` (gitleaks-action) | File exists, triggers on push/PR to main | Cannot verify from sandbox (requires GitHub Actions run) |
| Hardened .gitignore | `*credentials*`, `*secrets*`, `*.pem`, `*.key` patterns | `git check-ignore` on test paths | Patterns active. VERIFIED. |
| Deploy-window docs | `audit-notes/deploy-restart-window.md` | Document exists with mitigation strategy | VERIFIED. |
| Notification enrichment | All 8 notifyOwner calls include `endpoint=`, `http_status=`, `err=` | Source inspection | VERIFIED via grep. |
| OPERATING-RULES.md | Repo root, 10 rules + constraints | File exists | VERIFIED. |
| INCIDENTS.md as fixture | `audit-notes/INCIDENTS.md` committed to repo | File tracked by git | VERIFIED. |

**Caveat (pre-commit hook):** If `gitleaks` is not installed on a developer's machine, the hook prints a warning and exits 0 (does not block). The CI scan is the backstop.

---

## Updated 9-Finding Status Table

| Finding | Status | Evidence Level | Blocking Issue |
|---------|--------|---------------|----------------|
| SEC-004 | IN PROGRESS | Sandbox: 401 on unauth curl ✅. Dashboard: 6 consecutive 200s post-deploy ✅. | Cannot verify from sandbox that future scheduled runs will continue succeeding indefinitely. Requires 24h observation. |
| PROD-001 | IN PROGRESS | Sandbox: routes return 200, content includes compliance text ✅. | Cannot verify production crawlability from sandbox. Requires production URL check. |
| DB-001 | IN PROGRESS | Code: atomic conditional UPDATE with FOR UPDATE ✅. | Concurrency test not run (requires DB transaction isolation testing beyond vitest). |
| SEC-001 | IN PROGRESS | Code: tokenVersion check present ✅. Vitest: structural assertion passes ✅. | No behavioral end-to-end test (would need running server + DB with revoked token). |
| SEC-002 | DONE | Vitest: 3 tests pass (400 on missing sig, invalid sig, missing secret) ✅. Curl: webhook returns 400 without signature ✅. | — |
| SEC-005 | IN PROGRESS | Code: `unsafe-eval` gated behind `NODE_ENV !== 'production'` ✅. | Cannot verify production CSP header from sandbox. Requires `curl -I` against production URL. |
| BE-006 | IN PROGRESS | Sandbox: `/api/db-status` and `/api/perf` return 401 without auth ✅. | Cannot verify owner-auth path works (requires authenticated session). |
| ENG-007 | IN PROGRESS | Code: all 8 error paths call notifyOwner with enriched content ✅. | Cannot trigger a real failure and confirm notification delivery from sandbox. |
| DB-002 | IN PROGRESS | Code: 6 dime_* tables defined in `drizzle/dime.schema.ts` ✅. Column counts match production (verified via SQL query) ✅. | `drizzle-kit generate` shows drift from other tables (wc2026 espn_match_id columns); dime_* tables specifically are clean but cannot isolate them in the generate output. |

### Findings that qualify as DONE under Rule 6:
- **SEC-002** — acceptance criteria run verbatim (vitest + curl), raw output logged, tests green, zero related OPEN incidents.

### Findings that are IN PROGRESS (honest status):
- All others — each has code-level evidence but lacks either production runtime verification or full behavioral acceptance testing that cannot be performed from this sandbox.

---

## Incident Register Summary

| ID | Title | Status |
|----|-------|--------|
| INC-001 | tsc OOM hang | RESOLVED |
| INC-002 | GitHub push — workflows permission | OPEN |
| INC-003 | GitHub push — secrets detection | RESOLVED |
| INC-004 | Workflow file removal | RESOLVED |
| INC-005 | Heartbeat 500s during deploy | RESOLVED |
| INC-006 | "caller does not have permission" | RESOLVED |

**1 OPEN incident remaining:** INC-002 (push to `ai-sports-betting-manus` blocked by GitHub App workflows permission). Owner action required.

---

## What You Must Do (Owner Actions)

1. **Rotate credentials 1-16** from the SEC-006 table above. Start with items 1-7 (MUST ROTATE). Confirm completion to close SEC-006.
2. **Resolve INC-002:** Either grant `workflows` write permission to the Manus GitHub App, or provide a fine-grained PAT (with `repo` + `workflow` scopes) as a secret via Settings → Secrets.
3. **Verify production:** After next deploy, check:
   - `curl -I https://aisportsbettingmodels.com/privacy` returns 200 (PROD-001)
   - Response header `Content-Security-Policy` does NOT contain `unsafe-eval` (SEC-005)
   - `/api/db-status` returns 401 without auth, 200 with owner session (BE-006)
4. **Monitor heartbeats for 24h:** Confirm zero auth rejections in the Manus dashboard (SEC-004 final verification).
