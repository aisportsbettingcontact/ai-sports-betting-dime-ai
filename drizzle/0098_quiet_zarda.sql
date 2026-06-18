CREATE TABLE `waitlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`full_name` varchar(256),
	`why_text` text,
	`unit_size_min` int,
	`unit_size_max` int,
	`step2_completed` boolean DEFAULT false,
	`status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
	`adminNote` varchar(1024),
	`ipAddress` varchar(64),
	`userAgent` varchar(512),
	`utmSource` varchar(128),
	`utmMedium` varchar(128),
	`utmCampaign` varchar(128),
	`reviewedAt` bigint,
	`reviewedBy` int,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `waitlist_id` PRIMARY KEY(`id`),
	CONSTRAINT `waitlist_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_match_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`fixture_id` varchar(16) NOT NULL,
	`team_id` varchar(8),
	`event_type` enum('GOAL','OWN_GOAL','PENALTY','YELLOW','RED','SUB','VAR') NOT NULL,
	`player_name` varchar(96),
	`assist_player_name` varchar(96),
	`minute_str` varchar(8),
	`minute_num` tinyint,
	`is_first_half` boolean NOT NULL DEFAULT true,
	CONSTRAINT `wc2026_match_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_match_stats` (
	`fixture_id` varchar(16) NOT NULL,
	`ingested_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`home_possession_pct` double,
	`away_possession_pct` double,
	`home_total_shots` tinyint,
	`away_total_shots` tinyint,
	`home_shots_on_target` tinyint,
	`away_shots_on_target` tinyint,
	`home_corners` tinyint,
	`away_corners` tinyint,
	`home_fouls` tinyint,
	`away_fouls` tinyint,
	`home_yellow_cards` tinyint,
	`away_yellow_cards` tinyint,
	`home_red_cards` tinyint,
	`away_red_cards` tinyint,
	`home_offsides` tinyint,
	`away_offsides` tinyint,
	`home_saves` tinyint,
	`away_saves` tinyint,
	`home_total_passes` smallint,
	`away_total_passes` smallint,
	`home_accurate_passes` smallint,
	`away_accurate_passes` smallint,
	`home_pass_pct` double,
	`away_pass_pct` double,
	`home_effective_tackles` tinyint,
	`away_effective_tackles` tinyint,
	`home_interceptions` tinyint,
	`away_interceptions` tinyint,
	`home_xg` double,
	`away_xg` double,
	`home_blocked_shots` tinyint,
	`away_blocked_shots` tinyint,
	CONSTRAINT `wc2026_match_stats_fixture_id` PRIMARY KEY(`fixture_id`)
);
--> statement-breakpoint
ALTER TABLE `wc2026_fixtures` ADD `espn_event_id` varchar(16);--> statement-breakpoint
ALTER TABLE `wc2026_fixtures` ADD `attendance` int;--> statement-breakpoint
ALTER TABLE `wc2026_match_events` ADD CONSTRAINT `wc2026_match_events_fixture_id_wc2026_fixtures_fixture_id_fk` FOREIGN KEY (`fixture_id`) REFERENCES `wc2026_fixtures`(`fixture_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_match_events` ADD CONSTRAINT `wc2026_match_events_team_id_wc2026_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `wc2026_teams`(`team_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wc2026_match_stats` ADD CONSTRAINT `wc2026_match_stats_fixture_id_wc2026_fixtures_fixture_id_fk` FOREIGN KEY (`fixture_id`) REFERENCES `wc2026_fixtures`(`fixture_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_waitlist_email` ON `waitlist` (`email`);--> statement-breakpoint
CREATE INDEX `idx_waitlist_status` ON `waitlist` (`status`);--> statement-breakpoint
CREATE INDEX `idx_waitlist_created_at` ON `waitlist` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_me_fixture` ON `wc2026_match_events` (`fixture_id`);--> statement-breakpoint
CREATE INDEX `idx_me_type` ON `wc2026_match_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_ms_fixture` ON `wc2026_match_stats` (`fixture_id`);