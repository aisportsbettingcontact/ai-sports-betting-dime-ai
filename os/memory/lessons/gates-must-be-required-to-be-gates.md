# An advisory gate is not a gate — and raising the ceiling is not fixing the breach

**Verified 2026-08-05.**

`main` has exactly **4 required status checks**. The two jobs carrying the remediations for the
app-shell blockers — **Build & Preview Gate** (bundle budget + preview-activation scan) and **DB
Tests** (10 real-database suites) — both run on every PR and **neither blocks merge**. Separately,
30 of 38 Playwright tests run in no workflow at all, so the "live browser proof" for that same
remediation never executes.

And the bundle-budget allowance has been **ratcheted 9 times, 5,120 → 11,776 bytes (+130%)** — each
breach resolved by raising the ceiling, recorded in prose inside the config file it governs, emitting
no artifact.

**Why it mattered:** Dime repeatedly builds strong evaluation and then does not make it binding.
D8 is explicit that acceptance criteria mean a threshold repeatedly validated — not a number that
moves to accommodate the result. A gate whose verdict is advisory measures activity, not correctness.

**How to apply:**
- When you build a gate, the same change makes it a required check — or states in the PR why not,
  with an expiry.
- A budget breach is a finding. Raising the ceiling is a decision that needs a record and a reason,
  not a config edit.
- Check `gh api repos/{owner}/{repo}/branches/main/protection` before claiming anything is enforced.

Related: [[tests-can-report-green-without-asserting]].
