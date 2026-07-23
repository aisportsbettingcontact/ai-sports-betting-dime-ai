-- 0001_user_activity_init.sql
-- User Activity analytics schema — DEDICATED "MySQL: Dime AI" database ONLY.
--
-- WHERE THIS RUNS (owner directive 2026-07-23):
--   * This DDL is executed by the `ai-sports-betting-backend` service against
--     USER_ACTIVITY_DATABASE_URL (→ MySQL: Dime AI, mysql.railway.internal).
--   * It MUST NOT be applied to the product TiDB database (global DATABASE_URL).
--   * The `ai-sports-betting-dime-ai` web service NEVER connects to this DB;
--     it only proxies to the backend. See ../README.md.
--
-- STATUS: reference DDL — NOT applied to any database and NOT verified against a
-- live MySQL from this session (no Railway/DB access). Adapt to the backend's
-- own migration framework before applying. Additive + idempotent
-- (CREATE TABLE IF NOT EXISTS); safe to re-run. MySQL 8.x / InnoDB / utf8mb4.
--
-- Identity rule: activity is keyed to the Dime account by an IMMUTABLE
-- `source_user_id` (the TiDB app_users.id). There are NO cross-database foreign
-- keys — TiDB and this MySQL are separate databases. `analytics_user_map` holds
-- only the minimum fields for authorized admin analysis (no PII/secrets).

SET NAMES utf8mb4;

-- ── Versioned event-definition registry ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_event_definitions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_name         VARCHAR(64)  NOT NULL,
  schema_version     INT          NOT NULL,
  definition_version INT          NOT NULL,
  surface            VARCHAR(32)  NOT NULL,          -- released product surface
  qualifies_active   TINYINT(1)   NOT NULL DEFAULT 0, -- counts toward DAU/WAU/MAU?
  required_outcome   VARCHAR(32)  NULL,               -- e.g. 'success'
  allowed_props_json JSON         NULL,               -- allowlist for propsJson
  exclusion_json     JSON         NULL,
  introduced_at_utc  BIGINT       NOT NULL,
  retired_at_utc     BIGINT       NULL,
  UNIQUE KEY uq_def (event_name, schema_version, definition_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Immutable accepted events (system of record) ────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id           VARCHAR(64)  NOT NULL,           -- client idempotency key
  event_name         VARCHAR(64)  NOT NULL,
  schema_version     INT          NOT NULL,
  definition_version INT          NOT NULL,
  source_user_id     BIGINT       NOT NULL,           -- immutable Dime account id
  session_id         VARCHAR(64)  NULL,
  tab_id             VARCHAR(64)  NULL,
  workflow_id        VARCHAR(64)  NULL,
  feature_id         VARCHAR(64)  NULL,
  surface            VARCHAR(32)  NOT NULL,
  outcome            VARCHAR(32)  NULL,
  occurred_at_utc    BIGINT       NOT NULL,           -- client clock (validated)
  received_at_utc    BIGINT       NOT NULL,           -- server clock (authoritative)
  environment        VARCHAR(32)  NOT NULL,
  app_version        VARCHAR(64)  NULL,               -- deployment SHA / version
  is_test            TINYINT(1)   NOT NULL DEFAULT 0,
  props_json         JSON         NULL,               -- allowlisted scalars only, no PII
  UNIQUE KEY uq_event_id (event_id),                  -- dedupe re-delivery
  KEY idx_subject_time (source_user_id, occurred_at_utc),
  KEY idx_event_time (event_name, occurred_at_utc),
  KEY idx_session (session_id),
  KEY idx_feature_time (feature_id, occurred_at_utc),
  KEY idx_env_test (environment, is_test)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Quarantine for rejected / conflicting events (no unsafe raw payload) ─────
CREATE TABLE IF NOT EXISTS analytics_event_quarantine (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id        VARCHAR(64)  NULL,
  event_name      VARCHAR(64)  NULL,
  schema_version  INT          NULL,
  reason          VARCHAR(64)  NOT NULL,              -- 'duplicate_conflict' | 'unknown_event' | ...
  payload_sha256  CHAR(64)     NULL,                  -- hash only, never the payload
  received_at_utc BIGINT       NOT NULL,
  KEY idx_reason_time (reason, received_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Foreground, non-idle engagement intervals (per session/tab) ─────────────
CREATE TABLE IF NOT EXISTS analytics_session_segments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id      VARCHAR(64)  NOT NULL,
  tab_id          VARCHAR(64)  NOT NULL,
  source_user_id  BIGINT       NOT NULL,
  started_at_utc  BIGINT       NOT NULL,
  ended_at_utc    BIGINT       NULL,                  -- NULL = open segment
  KEY idx_session (session_id),
  KEY idx_user_time (source_user_id, started_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Derived sessions (union of segments; excludes idle/hidden/open) ──────────
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id         VARCHAR(64)  NOT NULL,
  source_user_id     BIGINT       NOT NULL,
  started_at_utc     BIGINT       NOT NULL,
  ended_at_utc       BIGINT       NULL,
  engaged_ms         BIGINT       NULL,               -- unioned foreground ms; NULL while open
  status             VARCHAR(24)  NOT NULL,           -- 'open' | 'closed_logout' | 'closed_idle' | ...
  close_reason       VARCHAR(24)  NULL,
  definition_version INT          NOT NULL,
  UNIQUE KEY uq_session (session_id),
  KEY idx_user_time (source_user_id, started_at_utc),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Rebuildable daily user facts (materialize ONLY if query evidence needs it)
CREATE TABLE IF NOT EXISTS analytics_user_day (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  day_utc            DATE         NOT NULL,
  source_user_id     BIGINT       NOT NULL,
  qualifying_events  INT          NOT NULL DEFAULT 0,
  engaged_ms         BIGINT       NOT NULL DEFAULT 0,
  definition_version INT          NOT NULL,
  UNIQUE KEY uq_user_day (day_utc, source_user_id, definition_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Rebuildable daily feature facts (materialize ONLY if needed) ────────────
CREATE TABLE IF NOT EXISTS analytics_feature_day (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  day_utc            DATE         NOT NULL,
  feature_id         VARCHAR(64)  NOT NULL,
  eligible_users     INT          NOT NULL DEFAULT 0,
  qualifying_users   INT          NOT NULL DEFAULT 0,
  starts             INT          NOT NULL DEFAULT 0,
  completions        INT          NOT NULL DEFAULT 0,
  failures           INT          NOT NULL DEFAULT 0,
  definition_version INT          NOT NULL,
  UNIQUE KEY uq_feature_day (day_utc, feature_id, definition_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Aggregation-run watermarks / audit ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_aggregation_runs (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_name           VARCHAR(64)  NOT NULL,
  source_from_utc    BIGINT       NOT NULL,
  source_to_utc      BIGINT       NOT NULL,           -- watermark (evidence cutoff)
  definition_version INT          NOT NULL,
  rows_written       INT          NOT NULL DEFAULT 0,
  latency_ms         INT          NULL,
  status             VARCHAR(24)  NOT NULL,           -- 'ok' | 'partial' | 'error'
  started_at_utc     BIGINT       NOT NULL,
  finished_at_utc    BIGINT       NULL,
  KEY idx_job_time (job_name, finished_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Data-quality checks (freshness / coverage / reconciliation / conflicts) ──
CREATE TABLE IF NOT EXISTS analytics_data_quality_checks (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  check_name     VARCHAR(64)  NOT NULL,
  status         VARCHAR(24)  NOT NULL,               -- 'pass' | 'warn' | 'fail'
  detail_json    JSON         NULL,
  ran_at_utc     BIGINT       NOT NULL,
  KEY idx_check_time (check_name, ran_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Minimal, auditable account map (NO PII / secrets) ───────────────────────
-- source_user_id is the immutable TiDB app_users.id. Copy only the minimum
-- fields needed for authorized admin analysis. Sync is idempotent + auditable.
CREATE TABLE IF NOT EXISTS analytics_user_map (
  source_user_id     BIGINT       NOT NULL PRIMARY KEY,  -- immutable Dime account id
  role               VARCHAR(24)  NULL,                   -- for staff/test exclusion
  is_staff           TINYINT(1)   NOT NULL DEFAULT 0,
  is_test            TINYINT(1)   NOT NULL DEFAULT 0,
  has_access         TINYINT(1)   NULL,                   -- coarse entitlement snapshot
  discord_linked     TINYINT(1)   NULL,
  mapping_version    INT          NOT NULL DEFAULT 1,
  source_updated_at  BIGINT       NULL,                   -- source record update time
  synced_at_utc      BIGINT       NOT NULL,               -- last sync time
  sync_status        VARCHAR(24)  NOT NULL DEFAULT 'ok',  -- 'ok' | 'stale' | 'error'
  KEY idx_staff_test (is_staff, is_test)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
