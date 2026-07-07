# INCIDENTS.md — Running Register

---

## INC-001: TypeScript full-project typecheck OOM hang (×2)

**What:** `npx tsc --noEmit` hung indefinitely and caused sandbox OOM kills (×2 resets).  
**When:** 2026-07-07 ~03:00–03:30 UTC (session start)  
**Evidence:** Sandbox reset twice; `uptime` showed fresh boot after each. No tsc output captured before kill.  
**Root cause:** Full-project typecheck on 2,227 files exceeded sandbox memory (~1.7GB available). **VERIFIED** — `free -m` showed <200MB remaining before each hang.  
**Resolution:** I switched to scoped typecheck (`tsconfig.check-sdk.json` targeting only patched files). Scoped check returned exit code 0 with zero errors. Vitest (1284/1285 pass) provided secondary compile evidence.  
**Status:** RESOLVED — workaround in place. Full-project tsc remains infeasible in this sandbox.

---

## INC-002: GitHub push rejection — workflows permission

**What:** `git push user_github main` rejected with: `refusing to allow a GitHub App to create or update workflow .github/workflows/ci.yml without workflows permission`  
**When:** 2026-07-07 ~04:15 UTC  
**Evidence:** Raw git output captured in shell session. The Manus GitHub App token (`ghs_...`) lacks the `workflows` write scope. Objects transferred successfully (15.12 MiB); rejection occurred post-receive.  
**Root cause:** GitHub enforces that any push containing `.github/workflows/*` files requires explicit `workflows` permission on the App token. The Manus connector App has not been granted this scope. **VERIFIED** — the error message is GitHub's standard policy rejection.  
**Resolution:** Push ON HOLD per owner directive. Owner will resolve via App scope grant or fine-grained PAT provided as a secret.  
**Status:** OPEN — push to `ai-sports-betting-manus` blocked.

---

## INC-003: GitHub push rejection — secrets detection (.project-config.json)

**What:** Push to `ai-sports-betting-models` rejected by GitHub Push Protection: `.project-config.json` containing AWS credentials was in git history.  
**When:** 2026-07-07 ~04:20 UTC  
**Evidence:** Git push error output referencing secret detection.  
**Root cause:** `.project-config.json` (containing AWS session tokens, DB URL) was committed in 77 historical commits. GitHub's push protection blocks pushes containing detected secrets. **VERIFIED** — file was in `git log --all -- .project-config.json`.  
**Resolution:** I ran `git filter-branch` to remove the file from all commits, then force-pushed to `ai-sports-betting-models`. This was done BEFORE the owner's no-rewrite directive was issued.  
**Status:** RESOLVED for `ai-sports-betting-models` repo. Note: this resolution involved history rewriting (now prohibited by owner directive for future actions).

---

## INC-004: Removal of auto-merge-dependabot.yml

**What:** I deleted `.github/workflows/auto-merge-dependabot.yml` from HEAD via `git rm` + commit.  
**When:** 2026-07-07 04:12:28 UTC (commit `80bdda2a`)  
**Evidence:** `git log --all --oneline --follow -- .github/workflows/auto-merge-dependabot.yml` shows creation at `793a4e51` (2026-04-10) and removal at `80bdda2a` (2026-07-07).  
**Root cause:** I removed it as a workaround to unblock the GitHub push (the App token couldn't push workflow files). Owner approved at the time; Fable 5 subsequently declined the broader history-rewrite approach.  
**Impact:** The Dependabot auto-merge workflow (patch-only PRs auto-approved after CI) is no longer active.  
**Status:** OPEN — owner decision pending on whether to restore. File recoverable via `git checkout 793a4e51 -- .github/workflows/auto-merge-dependabot.yml`.

---

## INC-005: Heartbeat 500s at 04:12 and 04:21 UTC (roto-lineups)

**What:** `roto-lineups-sync` heartbeat returned HTTP 500 at 04:12:30 and 04:21:54 UTC.  
**When:** 2026-07-07T04:12:30Z and 2026-07-07T04:21:54Z  
**Evidence:** `manus-heartbeat logs --task-uid 389iQhp2v3D8rtFE5XXw8b --status failed --page-size 3` shows both runs with `http_status: 500` and error `non-2xx response: 500`. Response body was HTML/SVG content (platform error page), not application JSON.  
**Root cause:** INFERRED — the 500s coincide with the checkpoint save/deploy window (~04:12–04:30 UTC). The response body being an HTML error page (not our JSON format) suggests the application server was unavailable. However, I have no direct evidence proving the deploy was in progress at exactly 04:12. What would confirm: deployment logs showing restart timestamps between 04:10–04:25.  
**Pre-deploy context:** The run at 04:06:47 was HTTP 200 (success). The runs at 04:33:25 and 04:42:24 were HTTP 200 (success).  
**Status:** OPEN — cause is INFERRED, not VERIFIED. The failures are not recurring (subsequent runs succeed), but the causal chain is not proven.

---

## INC-006: User-reported "caller does not have permission" string

**What:** User reported seeing `[HB] rotowire-lineups FAIL, "caller does not have permission"` in production.  
**When:** Reported 2026-07-07 ~04:45 UTC (this session)  
**Evidence of string origin search:**
- `grep -rn "caller does not have permission\|does not have permission" server/` → zero hits. **VERIFIED.**
- `grep -rn "permission\|cron-only\|Unauthorized" server/` → our code uses `"cron-only"` (403) and `"Unauthorized"` (401). **VERIFIED.**
- The exact string "caller does not have permission" does NOT exist in this codebase. **VERIFIED.**  
**String origin:** UNKNOWN. The string is not in our application code. Possible sources: (a) Manus platform dashboard UI label for failed heartbeat runs, (b) platform scheduler internal error message, (c) a different project/notification. Cannot verify from sandbox — requires user to identify where they saw this string (dashboard screenshot, notification body, email).  
**Status:** OPEN — string origin is UNKNOWN. Cannot close without user providing the source context.

---
