# RELEASING — merge → production

> **THE LAW:** merging to `main` does NOT deploy. Production (aisportsbettingmodels.com)
> is Manus-hosted (Cloud Run behind the Manus edge) and code ships ONLY when you press
> **Deploy/Publish inside Manus**. Evidence: `references/periodic-updates.md:28,125,269`
> ("save a checkpoint, ask the user to Deploy"), `server/discordAuth.ts:8`.
> No GitHub workflow deploys code; no Manus publish API exists in this repo.

## The 2-step release (do this every time)

**Step 1 — GitHub (automated, `/ship` command or manually):**
1. PR green (Security Audit + TypeScript required; Vitest once secrets land) → merge to `main`.
2. If the schema changed: run the `db-push.yml` workflow (Actions → DB Push → Run) BEFORE deploying code that needs it.

**Step 2 — Manus (the only manual click):** open the Manus project and paste:

```
Pull the latest main branch from GitHub (aisportsbettingcontact/ai-sports-betting-models),
run npm install if the lockfile changed, run npm run build to verify it compiles,
save a checkpoint, and Deploy/Publish the site. Then confirm the deployed URL serves
the latest commit (check that /landingpage returns the Dime landing page).
```

That paste-prompt is the whole Manus step. Until Manus exposes a publish API, this is the
automation ceiling — everything before it is scripted, everything after it is one click.

## Verify after deploy

- `https://aisportsbettingmodels.com/landingpage` → Dime landing renders, both plan cards
- A pricing button opens Stripe checkout (test mode if applicable)
- `/feed` still works (regression canary)

## Why not full auto — PROBE ANSWERED (2026-07-08)

Asked Manus directly: **no publish/deploy API exists.** The Publish button in the Manus
Management UI is the only deploy mechanism — AGENT crons and Heartbeats can run code but
cannot trigger a deployment. A fully automated GitHub→production pipeline is not
achievable on this platform. The confirmed ceiling:

- **Manus AGENT cron (SET UP — see below):** on schedule, pulls `github/main`, installs if
  the lockfile changed, build-verifies, saves a checkpoint, notifies. Everything is
  pre-staged; the human step is exactly one Publish click.
- **Migrating off Manus** remains a real project, not a tweak — four hard platform deps
  (recon-verified): Forge LLM proxy + credits (`server/storage.ts:9`), Manus OAuth
  (`api.manus.im`), `/manus-storage/*` file storage, and Heartbeat crons hitting
  `/api/scheduled/*` (in-process timers die on Cloud Run idle). Strategy decision
  (2026-07-08, recorded in `dime-ai/ZERO-TO-ONE-ROADMAP.md`): stay on Manus through
  launch, fold migration seams into E2–E5, migrate only on trigger.

## Never blocked while waiting

Deploys gate RELEASES, not WORK. Keep shipping in parallel:
- One feature branch per workstream via worktrees (`.worktrees/` is git-ignored; remote
  sessions have the native `EnterWorktree` tool — prefer it).
- `/gh-fix <issue#>` — assign any GitHub issue to an agent: isolated worktree → fix →
  PR, without touching your current tree.
- Batch merges, deploy once: N merged PRs still cost exactly one Manus click.
