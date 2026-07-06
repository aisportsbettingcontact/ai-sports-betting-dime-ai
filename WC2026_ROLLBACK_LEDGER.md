# WC2026 Rollback Ledger

**Created:** 2026-07-06  
**Branch:** wc2026-tier1-repair

---

## Rollback Commands (Execute in Reverse Order)

### A5 Rollback: Revert model_version to varchar(64)

```sql
ALTER TABLE wc2026_model_projections MODIFY COLUMN model_version VARCHAR(64) NOT NULL;
```

Then revert Drizzle schema to `varchar("model_version", { length: 64 })` and run `pnpm db:push`.

---

### A4 Rollback: Drop UNIQUE Index

```sql
DROP INDEX uq_match_version ON wc2026_model_projections;
```

---

### A3 Rollback: Restore Archived Rows

```sql
INSERT INTO wc2026_model_projections SELECT * FROM wc2026_mp_dedup_archive_20260706;
-- Note: Must drop UNIQUE index (A4) BEFORE restoring duplicates
```

---

### A2 Rollback: Remove Dime Auth Middleware

Remove the auth validation block added to `server/dime-chat.route.ts` (lines inserted before the Claude call).

---

### A1 Rollback: Revert espnIngest to publicProcedure

In `server/wc2026/wc2026Router.ts` line 717, change `ownerProcedure` back to `publicProcedure`.

---

## Rollback Execution Log

| # | Fix Rolled Back | Reason | Executed At | Result |
|---|----------------|--------|-------------|--------|
| — | No rollbacks executed | N/A | N/A | All fixes verified passing |
