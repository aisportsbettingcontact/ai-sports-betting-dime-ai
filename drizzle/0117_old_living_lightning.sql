CREATE TABLE `cfb_games` (
	`game_id` int NOT NULL,
	`week` int NOT NULL,
	`kickoff_date` date NOT NULL,
	`kickoff_time_et` varchar(20) NOT NULL,
	`kickoff_utc` timestamp,
	`away_team_name` varchar(80) NOT NULL,
	`home_team_name` varchar(80) NOT NULL,
	`away_espn_id` int,
	`home_espn_id` int,
	`tv` varchar(120),
	`is_placeholder` boolean NOT NULL DEFAULT false,
	`is_flex` boolean NOT NULL DEFAULT false,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cfb_games_game_id` PRIMARY KEY(`game_id`)
);
--> statement-breakpoint
CREATE TABLE `cfb_players` (
	`athlete_id` int NOT NULL,
	`team_espn_id` int NOT NULL,
	`full_name` varchar(100) NOT NULL,
	`jersey` varchar(4),
	`position` varchar(8) NOT NULL,
	`height_in` smallint,
	`weight_lb` smallint,
	`class_year` varchar(12),
	`hometown` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cfb_players_athlete_id` PRIMARY KEY(`athlete_id`)
);
--> statement-breakpoint
CREATE TABLE `cfb_teams` (
	`espn_id` int NOT NULL,
	`espn_display_name` varchar(80) NOT NULL,
	`espn_abbreviation` varchar(10) NOT NULL,
	`fbschedules_name` varchar(80) NOT NULL,
	`fbschedules_slug` varchar(120) NOT NULL,
	`conference` varchar(60) NOT NULL,
	`division` varchar(20),
	`espn_group_id` int NOT NULL,
	`roster_count` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cfb_teams_espn_id` PRIMARY KEY(`espn_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cfb_games_week` ON `cfb_games` (`week`);--> statement-breakpoint
CREATE INDEX `idx_cfb_games_kickoff_date` ON `cfb_games` (`kickoff_date`);--> statement-breakpoint
CREATE INDEX `idx_cfb_games_home` ON `cfb_games` (`home_espn_id`);--> statement-breakpoint
CREATE INDEX `idx_cfb_games_away` ON `cfb_games` (`away_espn_id`);--> statement-breakpoint
CREATE INDEX `idx_cfb_players_team` ON `cfb_players` (`team_espn_id`);--> statement-breakpoint
CREATE INDEX `idx_cfb_players_position` ON `cfb_players` (`position`);--> statement-breakpoint
CREATE INDEX `idx_cfb_teams_conference` ON `cfb_teams` (`conference`);