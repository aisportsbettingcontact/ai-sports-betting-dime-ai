# Drizzle emits every schema column in INSERTs — new columns need db-push FIRST

**Source:** the AI-native program's Incident 43 (2026-07-28). Note that incident was never filed in
`INCIDENTS.md` — see [[incident-numbers-collide]].

Adding a column to an **existing** table in the Drizzle schema before running `db-push.yml` breaks
**all writes to that table** against the live DB, because Drizzle names every schema column in its
generated INSERT statements. Nine `mlbDoubleheader.db.test.ts` inserts failed this way; the columns
were reverted the same session and the attribution moved into an existing column instead.

**Why it mattered:** the failure is not localised to the new feature — it takes down every writer of
that table, in production, on deploy. It also produced a lingering defect: the schema addition was
reverted and **the import was not**, leaving `server/_core/aiCostMeter.ts:20` importing a
non-existent `aiWorkflowCosts` export. That single line makes the working tree fail `tsc --noEmit`,
which blocks committing any of the salvageable work until fixed.

**How to apply:**
- **New columns on an existing table:** run `db-push.yml` FIRST, then merge the schema + writer code.
- **New tables:** safe to land ahead of the push if writers are probe-guarded
  (`server/schemaCapabilities.ts` pattern).
- When reverting a schema change, grep for importers of the reverted export in the same commit.

Related: [[owner-gated-is-not-a-terminal-state]].
