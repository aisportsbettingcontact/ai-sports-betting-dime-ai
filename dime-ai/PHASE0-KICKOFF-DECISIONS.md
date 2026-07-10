# Dime AI Chat — Phase 0 (Owner Mode) kickoff decisions

This file records founder decisions and environment findings established at the
start of the Phase 0 build, so they survive an environment switch or a fresh
session. It is **not** the specification. The authoritative spec is
`dime-ai-vercel-blueprint-v1.1.md` (must be present at the repo root before any
Phase 0 code is written).

## Founder decisions

- **Database path: Path B — TiDB via Drizzle.** `SELECT ... FOR UPDATE`
  transactions guard the credit reservation lock; no row-level security. Chosen
  to match the repo's existing Drizzle/MySQL stack. Carry the §1 deviation flag
  in `VERIFY.md` when it is created.
- **Model: Sonnet 5 only** (`anthropic/claude-sonnet-5` via Vercel AI Gateway).
  If VERIFY-01 shows the Gateway model string differs or is unavailable, fall
  back to the direct `@ai-sdk/anthropic` provider per §3 rule 4 and note it.
- **Owners:** handles `prez` and `sippi` via `DIME_OWNER_HANDLES`, seeded with
  500 credits each (`source='promo_grant'`), zero Stripe state.

## Environment finding — database reachability

- The TiDB endpoint speaks the MySQL wire protocol on **port 4000 (raw TCP)**.
- The managed Claude-Code web sandbox routes outbound traffic through an
  HTTPS-only egress proxy that explicitly does **not** support "non-443 HTTPS
  ports, raw-TCP databases." A direct connection from that sandbox times out.
- **Resolution:** run the DB-dependent Phase 0 work (apply schema + SQL
  functions, credit-race test, three refund paths, smoke test, 200-request
  ledger-invariant check) in an environment with **direct outbound egress** to
  the TiDB gateway. HTTPS-only sessions cannot execute those exit criteria.

## Secrets handling

- The TiDB connection string is a secret. It must live only in an untracked
  `.env`/`.env.local` (already git-ignored) and never appear in any tracked
  file, commit, log, or PR (SEC-006 / gitleaks constraint).
