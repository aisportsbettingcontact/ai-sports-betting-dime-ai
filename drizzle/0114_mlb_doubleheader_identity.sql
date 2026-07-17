-- 0114_mlb_doubleheader_identity: canonical MLB event identity (2026-07-17 doubleheader incident)
-- 1) rescheduledFrom: original scheduled date for makeup games (provider rescheduledFrom).
-- 2) games_mlb_gamepk_unique: at most one row per MLB gamePk (multiple NULLs allowed).
-- PRE-DEPLOY CHECK (must return 0 rows before running db-push against production):
--   SELECT mlbGamePk, COUNT(*) c FROM games WHERE mlbGamePk IS NOT NULL GROUP BY mlbGamePk HAVING c > 1;
-- Rollback: DROP INDEX games_mlb_gamepk_unique ON games; ALTER TABLE games DROP COLUMN rescheduledFrom;
ALTER TABLE `games` ADD `rescheduledFrom` varchar(10);--> statement-breakpoint
ALTER TABLE `games` ADD CONSTRAINT `games_mlb_gamepk_unique` UNIQUE(`mlbGamePk`);