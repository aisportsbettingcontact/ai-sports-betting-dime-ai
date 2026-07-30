# Dime Evidence Lifecycle Migration 0122

## Status and authority

Migration `0122_dime_evidence_lifecycle_v1.sql` is locally implemented and
reviewable. This runbook does not authorize a production database mutation,
application deployment, trace activation, traffic capture, Research Alpha
change, route activation, shadow execution, or model change.

The migration is an expand-only prerequisite for Phase 1 deployment parity. It
must be applied while `DIME_CHAT_TRACE_V1_ENABLED=false` and before deploying
application code that selects the new columns.

## Storage contract

Migration 0122 adds these nullable columns to `games`:

| Column                        | Type           | Meaning                               |
| ----------------------------- | -------------- | ------------------------------------- |
| `provider_observed_at`        | `timestamp(3)` | Provider-authored observation time    |
| `source_updated_at`           | `timestamp(3)` | Provider/source last-update time      |
| `ingestion_received_at`       | `timestamp(3)` | Ingestion boundary receive time       |
| `ingestion_normalized_at`     | `timestamp(3)` | Normalization completion time         |
| `ingestion_persisted_at`      | `timestamp(3)` | Durable persistence time              |
| `ingestion_pipeline_revision` | `varchar(160)` | Immutable producing-pipeline revision |
| `ingestion_run_id`            | `varchar(160)` | Stable producing-run identity         |

All columns have `NULL DEFAULT NULL`. There is no backfill. Historical rows and
new rows from producers that do not supply authoritative lifecycle evidence
remain null. Request, retrieval, response, `createdAt`, and `modelRunAt` times
must never be copied into these fields as substitutes.

## Compatibility and ordering

This is an expand-contract migration:

1. Apply migration 0122 while the old application remains deployed.
2. Verify the exact schema.
3. Deploy the reviewed application commit with tracing still disabled.
4. Verify parity.
5. Leave the columns in place through the compatibility window.

The old application ignores the new columns. The reviewed new application
requires them in its Dime context query. Therefore, do not deploy the new
application before post-migration verification passes.

Do not combine the database mutation, application deploy, trace activation, or
route activation into one operation.

## Preflight

Required evidence:

- the exact production database and environment are identified;
- a recovery point and responsible operator are named;
- `DIME_CHAT_TRACE_V1_ENABLED=false` is directly verified;
- no other schema migration is running;
- the Drizzle journal is reconciled through migration 0121; and
- a disposable MySQL 8 migration test has passed.

Inspect existing columns:

```sql
SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  DATETIME_PRECISION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'games'
  AND COLUMN_NAME IN (
    'provider_observed_at',
    'source_updated_at',
    'ingestion_received_at',
    'ingestion_normalized_at',
    'ingestion_persisted_at',
    'ingestion_pipeline_revision',
    'ingestion_run_id'
  )
ORDER BY COLUMN_NAME;
```

The acceptable preflight states are:

- all seven columns absent; or
- a resumable partial state in which every present column exactly matches this
  runbook.

Stop if a present column has a different type, nullability, default, or
meaning. Do not coerce or overwrite it during this migration.

## Application

Use the exact reviewed commit and the checked-in reconciled migration runner:

```bash
corepack pnpm db:migrate:reconciled
```

Do not run ad hoc `ALTER` statements. The migration guards each column through
`information_schema.COLUMNS`, so a partially applied attempt can be resumed.
MySQL DDL is not treated as an all-or-nothing transaction.

## Post-migration verification

Repeat the preflight query. It must return exactly seven rows with:

- the five time columns as `timestamp(3)`, nullable, default null;
- the two identity columns as `varchar(160)`, nullable, default null; and
- no other `games` column changes.

Then verify:

```sql
SELECT COUNT(*) AS migration_0122_rows
FROM __drizzle_migrations
WHERE created_at = 1785329270345;
```

The result must be exactly `1`. Re-run the migration command once; it must
complete as a no-op. Do not write test lifecycle values into production rows.

## Failure and recovery

If an operation stops after only some columns are added, keep the old
application serving, diagnose the cause, and resume the guarded migration.
Do not deploy the new application in a partial schema state.

If application rollback is required after migration 0122:

1. keep tracing disabled;
2. restore the pre-0122 application;
3. verify service and Dime Chat behavior; and
4. normally leave the additive nullable columns in place.

Physical removal is a separate destructive decision. Only after the old
application is restored and retained lifecycle data is dispositioned may an
authorized operator run:

```text
drizzle/rollbacks/0122_dime_evidence_lifecycle_v1.rollback.sql
```

The rollback script is guarded and manual. It is never discovered or run by
the reconciled migration runner.
