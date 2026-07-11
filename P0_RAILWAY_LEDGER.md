# P0 — Railway Feed Recovery — Execution Ledger

**Branch:** `p0/railway-feed-recovery` · **Base:** `origin/main` @ `9a41fa1`
**Archived prior run:** `archive/incomplete-p0-railway-run-20260711T064711Z` (+ `claude/dime-ai-full-audit-pewmxt`) — reference only, conclusions treated as unverified hypotheses.

## Exclusive P0 outcomes
1. Live **MLB Model Projections** on the Dime AI feed.
2. Live **World Cup Model Projections** on the Dime AI feed.
3. Live **MLB Betting Splits** on the Dime AI Betting Splits page.

Definition of done: real Railway-backed data visible through the deployed frontend **and** two independently-verified Railway update cycles.

## Access model
- `RAILWAY_API_TOKEN` is a GitHub Actions repository secret — available only inside a workflow run, never in the dev container. It is used exclusively by `.github/workflows/railway-p0-control.yml`.
- Values (token, Railway variable values) are never printed. Inspection returns names/scope/presence only.
- Read-only is the default operation. `run-job` / `deploy-service` are mutating and require explicit operation + service inputs; the owner authorizes each production mutation.

## Priority order (P0.1 → P0.9)
1. Railway access & topology (gate — nothing outranks it)
2. Source acquisition (MLB odds, WC odds, MLB splits)
3. Event/market/side identity & normalization
4. Model execution (MLB 400k sims, WC distribution, persistence)
5. Edge production (implied vs fair, best-book, correct side)
6. Production APIs (MLB projections, WC projections, MLB splits)
7. Frontend integration (real data + loading/empty/error/partial/stale)
8. Scheduling & reliability (cadence, retries, overlap prevention, last-success)
9. Railway deployment + two-cycle end-to-end verification

## Gate status
- [ ] P0.1 Railway access verified (blocked on: control workflow reachable on default branch + token scope)
- [ ] P0.2 Sources
- [ ] P0.3 Identity
- [ ] P0.4 Models
- [ ] P0.5 Edges
- [ ] P0.6 APIs
- [ ] P0.7 Frontend
- [ ] P0.8 Scheduling
- [ ] P0.9 Deploy + 2-cycle verify
