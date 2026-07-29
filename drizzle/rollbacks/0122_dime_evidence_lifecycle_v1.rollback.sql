-- REVIEWED MANUAL ROLLBACK ONLY — never run through drizzle-kit migrate.
--
-- Preconditions:
-- 1. DIME_CHAT_TRACE_V1_ENABLED=false.
-- 2. The deployed application no longer selects these columns.
-- 3. An operator has verified that no retained authoritative lifecycle data is
--    needed. Dropping a populated column is destructive.
--
-- Each DROP is guarded so the rollback can be resumed safely.

SET @dime_schema_name = DATABASE();

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_run_id'
  ),
  'ALTER TABLE `games` DROP COLUMN `ingestion_run_id`',
  'SELECT ''ingestion_run_id already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_pipeline_revision'
  ),
  'ALTER TABLE `games` DROP COLUMN `ingestion_pipeline_revision`',
  'SELECT ''ingestion_pipeline_revision already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_persisted_at'
  ),
  'ALTER TABLE `games` DROP COLUMN `ingestion_persisted_at`',
  'SELECT ''ingestion_persisted_at already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_normalized_at'
  ),
  'ALTER TABLE `games` DROP COLUMN `ingestion_normalized_at`',
  'SELECT ''ingestion_normalized_at already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'ingestion_received_at'
  ),
  'ALTER TABLE `games` DROP COLUMN `ingestion_received_at`',
  'SELECT ''ingestion_received_at already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'source_updated_at'
  ),
  'ALTER TABLE `games` DROP COLUMN `source_updated_at`',
  'SELECT ''source_updated_at already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;

SET @dime_rollback_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dime_schema_name
       AND TABLE_NAME = 'games'
       AND COLUMN_NAME = 'provider_observed_at'
  ),
  'ALTER TABLE `games` DROP COLUMN `provider_observed_at`',
  'SELECT ''provider_observed_at already absent'' AS rollback_status'
);
PREPARE dime_rollback_statement FROM @dime_rollback_sql;
EXECUTE dime_rollback_statement;
DEALLOCATE PREPARE dime_rollback_statement;
