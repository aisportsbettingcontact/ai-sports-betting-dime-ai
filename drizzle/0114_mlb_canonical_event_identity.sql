-- Canonical MLB identity migration.  This migration intentionally does not delete
-- colliding rows: a duplicate historical gamePk is an incident requiring review.
-- MySQL unique indexes permit multiple NULLs, so non-provider legacy rows remain valid.
ALTER TABLE `games` ADD COLUMN `eventProvider` varchar(32);--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `providerEventId` varchar(64);--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `canonicalEventId` varchar(128);--> statement-breakpoint
UPDATE `games`
SET `eventProvider` = 'mlb-stats',
    `providerEventId` = CAST(`mlbGamePk` AS CHAR),
    `canonicalEventId` = CONCAT('mlb-stats:MLB:', `mlbGamePk`)
WHERE `sport` = 'MLB' AND `mlbGamePk` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `games` DROP INDEX `games_matchup_unique`;--> statement-breakpoint
CREATE INDEX `games_matchup_idx` ON `games` (`gameDate`,`awayTeam`,`homeTeam`,`gameNumber`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_canonical_event_unique` ON `games` (`canonicalEventId`);
