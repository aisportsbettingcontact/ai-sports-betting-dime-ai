-- 0122_dime_evidence_lifecycle_v1
--
-- Expand-only storage for authoritative dynamic-evidence lifecycle metadata.
-- Every field is nullable and has no default: historical or unsupported rows
-- must remain NULL. In particular, request/retrieval time must never be used as
-- a substitute for provider or ingestion time.
--
-- Each ALTER is independently guarded so a partially applied migration can be
-- resumed safely. The reviewed rollback is documented in:
-- drizzle/rollbacks/0122_dime_evidence_lifecycle_v1.rollback.sql

SET @dime_schema_name = DATABASE();--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'provider_observed_at'
  ),
  'SELECT ''provider_observed_at already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `provider_observed_at` timestamp(3) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'source_updated_at'
  ),
  'SELECT ''source_updated_at already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `source_updated_at` timestamp(3) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_received_at'
  ),
  'SELECT ''ingestion_received_at already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `ingestion_received_at` timestamp(3) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_normalized_at'
  ),
  'SELECT ''ingestion_normalized_at already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `ingestion_normalized_at` timestamp(3) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_persisted_at'
  ),
  'SELECT ''ingestion_persisted_at already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `ingestion_persisted_at` timestamp(3) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_pipeline_revision'
  ),
  'SELECT ''ingestion_pipeline_revision already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `ingestion_pipeline_revision` varchar(160) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;--> statement-breakpoint

SET @dime_migration_sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_run_id'
  ),
  'SELECT ''ingestion_run_id already present'' AS migration_status',
  'ALTER TABLE `games` ADD COLUMN `ingestion_run_id` varchar(160) NULL DEFAULT NULL'
);--> statement-breakpoint
PREPARE dime_migration_statement FROM @dime_migration_sql;--> statement-breakpoint
EXECUTE dime_migration_statement;--> statement-breakpoint
DEALLOCATE PREPARE dime_migration_statement;
