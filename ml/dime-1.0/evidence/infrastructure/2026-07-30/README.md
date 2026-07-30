# Migration-chain reconciliation evidence

This directory records the sanitized evidence for the WC2026 migration-chain
repair. It contains no credentials, prompts, responses, user records, game
records, or production row data.

## Verdict

- Production application parity: restored and verified on `ff95a7c`
- Production migration state: unchanged at `0121`
- Production plan through `0121`: pass, zero pending
- Production plan through `0122`: pass, exactly one pending
- Fresh MySQL 8 replay through `0122`: pass, 123 migrations
- Second fresh-database plan through `0122`: pass, zero pending
- Exact Railway legacy-profile multiset validation: pass, 14/14 rows
- Explicit repository-prefix coverage validation: pass
- Journal-integrity unit tests: pass, 9/9 (seven required negative cases)
- Production-schema clone application and guarded rollback: pass
- Application database tests: pass, 57/57
- TypeScript: pass
- Production build: pass
- Independent migration review: required

The repository-wide local Vitest command was also run with the loopback access
required by its performance harness. It produced 2,590 passing tests and 64
declared environment-bound failures because credentials and the default
`DATABASE_URL` were intentionally absent. The local environment-failure gate
passed. The six real-database suites were then run through the isolated
database gate and passed 57/57.

## Authorization boundary

This evidence does not authorize a Railway deployment, production migration,
trace activation, route activation, shadow traffic, model training, or Research
Alpha configuration change.

The production database was inspected read-only. Migration `0122` was applied
only to disposable local MySQL 8 databases.

The Railway profile is closed-world: missing, additional, or duplicated legacy
rows fail validation. Pending migrations are derived only from an explicitly
verified historical prefix. The corrective verification did not query or
mutate production.
