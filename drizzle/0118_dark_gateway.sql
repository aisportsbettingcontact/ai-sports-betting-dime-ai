CREATE TABLE `nfl_games` (
	`event_id` int NOT NULL,
	`season_type` int NOT NULL,
	`week` int NOT NULL,
	`kickoff_utc` timestamp NOT NULL,
	`kickoff_date` date NOT NULL,
	`time_valid` boolean NOT NULL,
	`away_team_name` varchar(60) NOT NULL,
	`home_team_name` varchar(60) NOT NULL,
	`away_espn_id` int,
	`home_espn_id` int,
	`venue_id` int,
	`broadcast` varchar(120),
	`is_tbd` boolean NOT NULL DEFAULT false,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nfl_games_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `nfl_players` (
	`athlete_id` int NOT NULL,
	`team_espn_id` int NOT NULL,
	`full_name` varchar(100) NOT NULL,
	`jersey` varchar(4),
	`position` varchar(8) NOT NULL,
	`height_in` smallint,
	`weight_lb` smallint,
	`experience` varchar(20),
	`hometown` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nfl_players_athlete_id` PRIMARY KEY(`athlete_id`)
);
--> statement-breakpoint
CREATE TABLE `nfl_teams` (
	`espn_id` int NOT NULL,
	`display_name` varchar(60) NOT NULL,
	`abbreviation` varchar(5) NOT NULL,
	`conference` varchar(3) NOT NULL,
	`division` varchar(12) NOT NULL,
	`venue_id` int NOT NULL,
	`roster_count` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nfl_teams_espn_id` PRIMARY KEY(`espn_id`)
);
--> statement-breakpoint
CREATE TABLE `nfl_venues` (
	`venue_id` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`city` varchar(60) NOT NULL,
	`state` varchar(30),
	`country` varchar(40),
	`capacity` int,
	`indoor` boolean,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nfl_venues_venue_id` PRIMARY KEY(`venue_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_nfl_games_week` ON `nfl_games` (`season_type`,`week`);--> statement-breakpoint
CREATE INDEX `idx_nfl_games_kickoff_date` ON `nfl_games` (`kickoff_date`);--> statement-breakpoint
CREATE INDEX `idx_nfl_games_home` ON `nfl_games` (`home_espn_id`);--> statement-breakpoint
CREATE INDEX `idx_nfl_games_away` ON `nfl_games` (`away_espn_id`);--> statement-breakpoint
CREATE INDEX `idx_nfl_players_team` ON `nfl_players` (`team_espn_id`);--> statement-breakpoint
CREATE INDEX `idx_nfl_players_position` ON `nfl_players` (`position`);--> statement-breakpoint
CREATE INDEX `idx_nfl_teams_division` ON `nfl_teams` (`division`);