# SEC-006 Tasks E, F, G — Addendum

**Audit Date:** 2026-07-08 (UTC)
**Auditor:** Manus (automated)
**Mode:** READ-ONLY — one `git fetch github` (read-only network operation) executed; zero writes to working tree or git history
**Appends:** `SEC-006-rotation-verification-worksheet-v2.md`

---

## Claim Taxonomy

All claims carry one of: **VERIFIED** / **INFERRED** / **UNKNOWN**

---

## TASK E — GitHub Remote Presence of Secret-Bearing Artifacts

### Setup

The `github` remote was re-added (not persistent across sessions) and a read-only fetch was performed:

```
git remote add github https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai.git
git fetch github
```

**Note on repo name:** The prior session context referenced `ai-sports-betting-models` as the GitHub remote. That repo returned `Repository not found` (HTTP 404). The correct active GitHub remote is `ai-sports-betting-dime-ai` — this is the repo confirmed pushed in the prior session (HEAD `a5ddeb6f`). The fetch succeeded and `github/main` resolved to commit `14727576` dated `2026-07-08 22:23:58 UTC` with 1,419 total commits. **VERIFIED**

### E1 — HEAD Presence (github/main at fetch time)

Checked via `git ls-tree -r github/main --name-only | grep <file>` for each artifact:

| File | Present at github/main HEAD | Label |
|------|----------------------------|-------|
| `audit-notes/FINAL-REPORT.md` | **YES** | VERIFIED |
| `database_audit.txt` | **YES** | VERIFIED |
| `debug_rg_today-hitters.html` | **YES** | VERIFIED |
| `debug_rg_today-pitchers.html` | **YES** | VERIFIED |
| `schema_alignment_findings.md` | **YES** | VERIFIED |

**All five secret-bearing artifacts are present at `github/main` HEAD.** VERIFIED

### E2 — Commit Count Reachable from github/main History

Checked via `git log github/main --oneline -- <file> | wc -l`:

| File | Commits in github/main History | Introducing Commit | Most Recent Commit | Secret Pattern Type(s) | Label |
|------|-------------------------------|-------------------|-------------------|----------------------|-------|
| `audit-notes/FINAL-REPORT.md` | **2** | `1795f7f1` | `c2b6df4f` | `stripe-access-token` (gitleaks rule) — test fixture string `sk_live_` in pre-commit hook documentation | VERIFIED |
| `database_audit.txt` | **10** | `c079aa00` | `956b0452` | `generic-api-key` (gitleaks rule) — API key pattern in audit trail output at line 2992 | VERIFIED |
| `debug_rg_today-hitters.html` | **1** | `6b5126f9` | `6b5126f9` | `generic-api-key` (gitleaks rule) — API key pattern in HTML debug output at line 123 | VERIFIED |
| `debug_rg_today-pitchers.html` | **1** | `6b5126f9` | `6b5126f9` | `generic-api-key` (gitleaks rule) — API key pattern in HTML debug output at line 123 | VERIFIED |
| `schema_alignment_findings.md` | **1** | `d3f3c449` | `d3f3c449` | `generic-api-key` (gitleaks rule) — API key pattern in findings output at line 91 | VERIFIED |

---

## INCIDENT FILING — SEC-INC-001: Secrets in External Remote History

**Trigger:** All five secret-bearing artifacts are reachable in `github/main` history, which is an external public/private remote outside the Manus S3 store.

| Field | Value |
|-------|-------|
| **1. Incident ID** | SEC-INC-001 |
| **2. Title** | Secret-bearing artifacts present in GitHub remote history (`aisportsbettingcontact/ai-sports-betting-dime-ai`) |
| **3. Severity** | P1 — External remote exposure; secrets reachable from outside Manus S3 store |
| **4. Discovery Date** | 2026-07-08 (this session) |
| **5. Discovery Method** | `git fetch github` + `git ls-tree` + `git log github/main -- <file>` |
| **6. Affected Repository** | `https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai` |
| **7. Affected Branch** | `main` (HEAD `14727576`, 2026-07-08 22:23:58 UTC) |
| **8. Affected Files** | 5 files: `audit-notes/FINAL-REPORT.md`, `database_audit.txt`, `debug_rg_today-hitters.html`, `debug_rg_today-pitchers.html`, `schema_alignment_findings.md` |
| **9. Secret Pattern Types** | `stripe-access-token` (test fixture string in FINAL-REPORT.md); `generic-api-key` (API key patterns in database_audit.txt, debug HTML files, schema_alignment_findings.md) |
| **10. Earliest Exposure Commit** | `c079aa00` (database_audit.txt, WC2026 Tier 1 audit) |
| **11. Total Commits Exposing Secrets** | 15 commits across 5 files (2 + 10 + 1 + 1 + 1) |
| **12. Current Status** | OPEN — files present at HEAD; history not purged |
| **13. Remediation Path** | (a) Remove files from HEAD via `git rm --cached`; (b) Add to `.gitignore`; (c) Purge from history via `git filter-repo --path <file> --invert-paths`; (d) Force-push to GitHub; (e) Request GitHub support to invalidate cached views. Disposition is owner's decision — see Task G for exact commands. |
| **14. Blockers** | Owner authorization required before any write operation; `git filter-repo` not installed (requires `pip install git-filter-repo`); GitHub force-push requires owner credentials |
| **15. Label** | All findings: VERIFIED |

---

## TASK F — Stripe LIVE Key: Platform Env Surface

### Surfaces Inspected

| Surface | Method | sk_live_ Found | Label |
|---------|--------|---------------|-------|
| Process environment (`env` command) | `env \| grep sk_live_` | **NOT FOUND** — `STRIPE_SECRET_KEY` = `sk_test_51...` (TEST mode) | VERIFIED |
| `.project-config.json` secrets block | `grep sk_live_` | **NOT FOUND** — `STRIPE_SECRET_KEY` = `sk_test_51...` | VERIFIED |
| `~/.manus/config/config.json` | `grep sk_live_` | **NOT FOUND** — Stripe connectors listed but disabled, no key values stored | VERIFIED |
| `~/.manus/config/baseline/config.json` | `grep sk_live_` | **NOT FOUND** | VERIFIED |
| `~/.manus/config/multiAccounts.json` | `grep sk_live_` | **NOT FOUND** | VERIFIED |
| `~/.manus/` full recursive scan | `grep -r sk_live_` | **NOT FOUND** | VERIFIED |
| `/opt/.manus/webdev.sh.env` | Read attempt | **BLOCKED** — sandbox shell policy prevents reading `.env` files via shell commands | VERIFIED (blocker) |
| Manus Settings → Payment UI | Browser UI inspection | **NOT INSPECTABLE** from sandbox — requires browser UI access to the Manus management panel | UNKNOWN (blocker: requires browser UI) |
| Deployed production runtime env (`aisportsbet-mw3ficty.manus.space`) | Sandbox has no direct access to production container env | **NOT INSPECTABLE** from sandbox | UNKNOWN (blocker: no production env access) |

### Summary

**`sk_live_` NOT FOUND** in all inspectable platform env surfaces (process env, `.project-config.json`, all `~/.manus/` JSON config files). **VERIFIED**

Two surfaces remain uninspectable from the sandbox:

1. `/opt/.manus/webdev.sh.env` — blocked by sandbox shell policy (`.env` file read restriction). **Blocker: VERIFIED**
2. Manus Settings → Payment UI and production deployment runtime — not accessible from sandbox. **Blocker: VERIFIED**

**Finding:** The Stripe LIVE key is NOT FOUND in any sandbox-accessible platform env surface. Whether a LIVE key exists in the two uninspectable surfaces (webdev.sh.env, production deployment env) is **UNKNOWN**. The application is confirmed operating in TEST mode in the sandbox runtime.

---

## TASK G — Artifact Disposition Commands (No Execution — Owner's Decision)

The following commands are provided for owner reference only. None were executed. Disposition (execute, defer, or decline) is the owner's decision, contingent on Task E incident findings.

### Per-Artifact Commands

**For each of the 5 artifacts, two independent operations are available:**

#### (a) Remove from git tracking while keeping local copy

```bash
# Run from project root: /home/ubuntu/ai-sports-betting

git rm --cached audit-notes/FINAL-REPORT.md
git rm --cached database_audit.txt
git rm --cached debug_rg_today-hitters.html
git rm --cached debug_rg_today-pitchers.html
git rm --cached schema_alignment_findings.md

# Then commit the removal:
git commit -m "chore: untrack secret-bearing audit artifacts from git index"
```

#### (b) Add each file to .gitignore

```bash
# Append to .gitignore (run from project root):
cat >> .gitignore << 'EOF'

# Secret-bearing audit artifacts (SEC-INC-001)
audit-notes/FINAL-REPORT.md
database_audit.txt
debug_rg_today-hitters.html
debug_rg_today-pitchers.html
schema_alignment_findings.md
EOF

git add .gitignore
git commit -m "chore: add secret-bearing audit artifacts to .gitignore (SEC-INC-001)"
```

### GitHub History Purge (Requires Separate Tool Install)

If the owner decides to purge these files from GitHub history after the above steps:

```bash
# Install git-filter-repo (not currently installed):
pip install git-filter-repo

# Purge each file from full history (run from project root):
git filter-repo --path audit-notes/FINAL-REPORT.md --invert-paths
git filter-repo --path database_audit.txt --invert-paths
git filter-repo --path debug_rg_today-hitters.html --invert-paths
git filter-repo --path debug_rg_today-pitchers.html --invert-paths
git filter-repo --path schema_alignment_findings.md --invert-paths

# Force-push to GitHub (requires owner credentials):
git push github main --force

# Request GitHub to invalidate cached views:
# https://support.github.com/contact (request cached data removal)
```

**Warning:** `git filter-repo` rewrites all commit SHAs. All collaborators must re-clone after a force-push. The Manus S3 store (`origin`) will diverge from GitHub after this operation — a separate push to `origin` with `--force` would be required, which carries risk to the Manus deployment history.

### Combined Single-Command Block (All 5 Files)

```bash
# Step 1: Untrack all 5 files
git rm --cached \
  audit-notes/FINAL-REPORT.md \
  database_audit.txt \
  debug_rg_today-hitters.html \
  debug_rg_today-pitchers.html \
  schema_alignment_findings.md

# Step 2: Add all 5 to .gitignore
printf '\n# Secret-bearing audit artifacts (SEC-INC-001)\naudit-notes/FINAL-REPORT.md\ndatabase_audit.txt\ndebug_rg_today-hitters.html\ndebug_rg_today-pitchers.html\nschema_alignment_findings.md\n' >> .gitignore

# Step 3: Commit both changes together
git add .gitignore
git commit -m "chore: untrack and gitignore secret-bearing audit artifacts (SEC-INC-001)"
```

---

## Claim-Count Summary (This Addendum)

| Label | Count |
|-------|-------|
| **VERIFIED** | 28 |
| **INFERRED** | 0 |
| **UNKNOWN** | 3 |
| **Total** | 31 |

---

*SEC-006 Tasks E/F/G Addendum — Generated 2026-07-08T22:37:42Z by Manus (automated, READ-ONLY session)*
*One read-only `git fetch github` executed. Zero working-tree writes. Zero git history mutations.*
