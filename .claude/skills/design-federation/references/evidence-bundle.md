# Evidence bundle — the artifact that closes the loop

A federated UI change is unfinished until this bundle exists. It is the release
evidence a reviewer (or the owner) reads instead of trusting claims.

## Location

`docs/audits/<yyyy-mm-dd>-<surface>-evidence/` — the repo's existing audit-evidence
convention. **PNG law:** `docs/audits/*-evidence/screenshots/` is gitignored (same
2026-08-05 clone-size policy as root `audits/**/*.png`); screenshots stay untracked
on disk and are attached/embedded in the PR body. The markdown summary and JSON
sidecars are tracked.

## Contents

| File | What it proves | Produced by |
| --- | --- | --- |
| `summary.md` | What changed and why; links the brief; names the Lead and advisors; lists every gate result | you |
| `brief.yaml` | The mission this was built against (copy of the filled brief) | you |
| `typecheck-tests.txt` | `npx tsc --noEmit` + scoped `vitest` output, verbatim | `/sp-verify` |
| `smoke.txt` | Production build + boot + `node scripts/smoke-deploy.mjs <url>` output | `verify` skill |
| `impeccable-detect.json` | Deterministic detector findings (or empty array) | `npx impeccable@3.5.0 detect --json` |
| `screenshots/` | The MASTER.md checklist widths (375/768/1024/1440) at minimum 375×812 + 1440×900, dark and light, plus a reduced-motion pass; before/after for redesigns | playwright-cli / agent-browser |
| `motion-review.md` | Block/Approve verdict with file:line — **required whenever the diff touches motion** | review-animations (via Read) |
| `checklist.md` | MASTER.md Pre-Delivery Checklist, item-by-item with pass/fail | you |

## Rules

- Verbatim command output, not paraphrase. A failed check appears as failed — with
  the output — never silently dropped (evidence before assertions).
- If a gate was skipped, `summary.md` says so and why. An absent file reads as
  "not run", so absence must be explained or fixed.
- Bounded repair: findings from one audit round get one batched fix + at most one
  confirm round. Leftovers are listed in `summary.md` as known issues, not polished
  open-endedly.
- The bundle accompanies the PR; owner visual sign-off remains the merge gate for
  brand-surface changes (merge to main IS a production deploy).
