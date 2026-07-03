CREATE TABLE `wc2026_betting_splits` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`match_id` varchar(16) NOT NULL,
	`snapshot_ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`team_id` varchar(8) NOT NULL,
	`market` enum('ML','TOTAL','SPREAD') NOT NULL DEFAULT 'ML',
	`tickets_pct` double,
	`money_pct` double,
	CONSTRAINT `wc2026_betting_splits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_matches` (
	`match_id` varchar(16) NOT NULL,
	`match_date` date NOT NULL,
	`kickoff_utc` datetime,
	`stage` enum('GROUP','R32','R16','QF','SF','THIRD','FINAL') NOT NULL DEFAULT 'GROUP',
	`group_letter` char(1),
	`matchday` tinyint,
	`home_team_id` varchar(8) NOT NULL,
	`away_team_id` varchar(8) NOT NULL,
	`venue_id` varchar(32) NOT NULL,
	`home_score` tinyint,
	`away_score` tinyint,
	`status` enum('SCHEDULED','LIVE','FT') NOT NULL DEFAULT 'SCHEDULED',
	`is_host_home` boolean NOT NULL DEFAULT false,
	CONSTRAINT `wc2026_matches_match_id` PRIMARY KEY(`match_id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_lineups` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`match_id` varchar(16) NOT NULL,
	`team_id` varchar(8) NOT NULL,
	`scraped_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`is_confirmed` boolean NOT NULL DEFAULT false,
	`player_name` varchar(96) NOT NULL,
	`position` varchar(8) NOT NULL,
	`is_starter` boolean NOT NULL DEFAULT true,
	`injury_status` varchar(16),
	`jersey_number` tinyint,
	CONSTRAINT `wc2026_lineups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_odds_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`match_id` varchar(16) NOT NULL,
	`snapshot_ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`book_id` smallint NOT NULL,
	`market` enum('1X2','TOTAL','ASIAN_HANDICAP','BTTS','DOUBLE_CHANCE') NOT NULL DEFAULT '1X2',
	`selection` varchar(16) NOT NULL,
	`line` double,
	`american_odds` smallint NOT NULL,
	`implied_prob` double NOT NULL,
	`is_closing` boolean NOT NULL DEFAULT false,
	CONSTRAINT `wc2026_odds_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_team_aliases` (
	`alias` varchar(64) NOT NULL,
	`team_id` varchar(8) NOT NULL,
	CONSTRAINT `wc2026_team_aliases_alias` PRIMARY KEY(`alias`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_teams` (
	`team_id` varchar(8) NOT NULL,
	`name` varchar(64) NOT NULL,
	`fifa_code` char(3) NOT NULL,
	`group_letter` char(1) NOT NULL,
	`flag_code` varchar(8) NOT NULL,
	`flag_url` varchar(128) NOT NULL,
	`slug` varchar(64) NOT NULL,
	CONSTRAINT `wc2026_teams_team_id` PRIMARY KEY(`team_id`),
	CONSTRAINT `uq_team_name` UNIQUE(`name`),
	CONSTRAINT `uq_fifa_code` UNIQUE(`fifa_code`),
	CONSTRAINT `uq_team_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_venues` (
	`venue_id` varchar(32) NOT NULL,
	`city` varchar(64) NOT NULL,
	`country` varchar(32) NOT NULL,
	`stadium` varchar(96) NOT NULL,
	`timezone` varchar(48) NOT NULL,
	`elevation_m` smallint NOT NULL,
	CONSTRAINT `wc2026_venues_venue_id` PRIMARY KEY(`venue_id`)
);
--> statement-breakpoint
ALTER TABLE `wc2026_betting_splits` ADD CONSTRAINT `wc2026_betting_splits_match_id_wc2026_matches_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `wc2026_matches`(`match_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_betting_splits` ADD CONSTRAINT `wc2026_betting_splits_team_id_wc2026_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `wc2026_teams`(`team_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_matches` ADD CONSTRAINT `wc2026_matches_home_team_id_wc2026_teams_team_id_fk` FOREIGN KEY (`home_team_id`) REFERENCES `wc2026_teams`(`team_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_matches` ADD CONSTRAINT `wc2026_matches_away_team_id_wc2026_teams_team_id_fk` FOREIGN KEY (`away_team_id`) REFERENCES `wc2026_teams`(`team_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_matches` ADD CONSTRAINT `wc2026_matches_venue_id_wc2026_venues_venue_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `wc2026_venues`(`venue_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_lineups` ADD CONSTRAINT `wc2026_lineups_match_id_wc2026_matches_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `wc2026_matches`(`match_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_lineups` ADD CONSTRAINT `wc2026_lineups_team_id_wc2026_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `wc2026_teams`(`team_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_odds_snapshots` ADD CONSTRAINT `wc2026_odds_snapshots_match_id_wc2026_matches_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `wc2026_matches`(`match_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_team_aliases` ADD CONSTRAINT `wc2026_team_aliases_team_id_wc2026_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `wc2026_teams`(`team_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_splits_match` ON `wc2026_betting_splits` (`match_id`);--> statement-breakpoint
CREATE INDEX `idx_splits_ts` ON `wc2026_betting_splits` (`snapshot_ts`);--> statement-breakpoint
CREATE INDEX `idx_date` ON `wc2026_matches` (`match_date`);--> statement-breakpoint
CREATE INDEX `idx_group_md` ON `wc2026_matches` (`group_letter`,`matchday`);--> statement-breakpoint
CREATE INDEX `idx_lineup_match` ON `wc2026_lineups` (`match_id`);--> statement-breakpoint
CREATE INDEX `idx_lineup_team` ON `wc2026_lineups` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_snap_match` ON `wc2026_odds_snapshots` (`match_id`);--> statement-breakpoint
CREATE INDEX `idx_snap_ts` ON `wc2026_odds_snapshots` (`snapshot_ts`);--> statement-breakpoint
CREATE INDEX `idx_snap_closing` ON `wc2026_odds_snapshots` (`match_id`,`is_closing`);--> statement-breakpoint
CREATE INDEX `idx_group` ON `wc2026_teams` (`group_letter`);