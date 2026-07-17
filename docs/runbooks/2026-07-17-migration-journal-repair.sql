-- ─────────────────────────────────────────────────────────────────────────────
-- Migration-journal repair runbook (2026-07-17 doubleheader incident follow-up)
-- Target: production TiDB, schema MW3FicTy7ae3qrm8dx8Lua
-- Operator: run in the TiDB Cloud SQL Editor, one statement at a time.
--
-- WHY: `db-push.yml` (drizzle-kit migrate) fails with ER_TABLE_EXISTS_ERROR on
-- 0112 because the production journal (__drizzle_migrations) was last updated
-- at 0111 while the 0112/0113 objects were applied outside the journaled path.
-- 0114 was applied MANUALLY during the 2026-07-17 feed outage (rescheduledFrom
-- column + games_mlb_gamepk_unique index). Until the journal rows below exist,
-- every db-push run replays 0112 and dies — future migrations are blocked.
--
-- drizzle-orm's MySQL migrator applies journal entries whose folder timestamp
-- is greater than MAX(created_at) in __drizzle_migrations, so recording these
-- three rows makes 0115+ apply cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

USE MW3FicTy7ae3qrm8dx8Lua;

-- STEP 0 — Preconditions: verify each migration's objects actually exist
-- before recording it as applied. Every query below must return the expected
-- count; if any does not, STOP — apply that migration's DDL first.

-- 0112 objects (dime chat tables). Expected: 2 rows.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'MW3FicTy7ae3qrm8dx8Lua'
  AND table_name IN ('dime_chat_messages', 'dime_chat_threads');

-- 0113 objects (Discord identity unique indexes). Expected: 2 rows.
-- If 0 rows: FIRST check for duplicates —
--   SELECT discordId, COUNT(*) c FROM app_users WHERE discordId IS NOT NULL
--    GROUP BY discordId HAVING c > 1;   (must be empty)
--   SELECT manualDiscordId, COUNT(*) c FROM app_users WHERE manualDiscordId IS NOT NULL
--    GROUP BY manualDiscordId HAVING c > 1;   (must be empty)
-- then apply:
--   ALTER TABLE app_users ADD CONSTRAINT app_users_discord_id_unique UNIQUE(discordId);
--   ALTER TABLE app_users ADD CONSTRAINT app_users_manual_discord_id_unique UNIQUE(manualDiscordId);
SELECT DISTINCT index_name FROM information_schema.statistics
WHERE table_schema = 'MW3FicTy7ae3qrm8dx8Lua' AND table_name = 'app_users'
  AND index_name IN ('app_users_discord_id_unique', 'app_users_manual_discord_id_unique');

-- 0114 objects (applied manually 2026-07-17 ~22:00 UTC during the outage).
-- Expected: 1 row from each.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'MW3FicTy7ae3qrm8dx8Lua' AND table_name = 'games'
  AND column_name = 'rescheduledFrom';
SELECT DISTINCT index_name FROM information_schema.statistics
WHERE table_schema = 'MW3FicTy7ae3qrm8dx8Lua' AND table_name = 'games'
  AND index_name = 'games_mlb_gamepk_unique';

-- STEP 1 — Sanity-check the journal table (expect last row = 0111 era,
-- created_at 1783489039828 or earlier):
SELECT id, LEFT(hash, 12) AS hash12, created_at
FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 3;

-- STEP 2 — Record 0112/0113/0114 as applied. Hashes are the real sha256 of
-- the migration files at repo main (197c67f); created_at values are the
-- drizzle journal `when` timestamps (drizzle/meta/_journal.json).
INSERT INTO __drizzle_migrations (hash, created_at) VALUES
  ('96917cba557a0227c0a40b941d78ba0f54c0e86a57da2a7b2d1cbada26f9b3af', 1783864285270),
  ('2da4e065c654f75f0b939f899cc62bf69641fe78ae8ff4c4470e7ddb5f2f543c', 1784296797624),
  ('c5d48c22f32e49d418fb2b706c9742c36ba3b3397c0275354d3621cf9901203e', 1784305826958);

-- STEP 3 — Verify:
SELECT id, LEFT(hash, 12) AS hash12, created_at
FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 4;
-- Expected: newest row created_at = 1784305826958 (0114).

-- STEP 4 — Re-run the db-push.yml workflow (Actions → "DB Push"). It should
-- now report "no migrations to apply" (or apply only 0115+) and exit green.
--
-- Rollback of this runbook: DELETE FROM __drizzle_migrations WHERE created_at
-- IN (1783864285270, 1784296797624, 1784305826958);
