DROP TABLE IF EXISTS `mlb_boxscore_batting`;--> statement-breakpoint
DROP TABLE IF EXISTS `mlb_boxscore_pitching`;--> statement-breakpoint
CREATE TABLE `mlb_boxscore_batting` (
	`game_pk` int NOT NULL,
	`mlbam_id` int NOT NULL,
	`team_id` int NOT NULL,
	`batting_order` int,
	`position` varchar(8),
	`ab` int NOT NULL,
	`r` int NOT NULL,
	`h` int NOT NULL,
	`doubles` int NOT NULL,
	`triples` int NOT NULL,
	`hr` int NOT NULL,
	`rbi` int NOT NULL,
	`bb` int NOT NULL,
	`so` int NOT NULL,
	`hbp` int NOT NULL,
	`sb` int NOT NULL,
	`cs` int NOT NULL,
	`lob` int,
	`sac_bunts` int NOT NULL,
	`sac_flies` int NOT NULL,
	CONSTRAINT `mlb_boxscore_batting_game_pk_mlbam_id_team_id_pk` PRIMARY KEY(`game_pk`,`mlbam_id`,`team_id`)
);
--> statement-breakpoint
CREATE TABLE `mlb_boxscore_pitching` (
	`game_pk` int NOT NULL,
	`mlbam_id` int NOT NULL,
	`team_id` int NOT NULL,
	`outs_recorded` int NOT NULL,
	`batters_faced` int NOT NULL,
	`h` int NOT NULL,
	`r` int NOT NULL,
	`er` int NOT NULL,
	`bb` int NOT NULL,
	`so` int NOT NULL,
	`hr` int NOT NULL,
	`pitches` int,
	`strikes` int,
	`win` boolean NOT NULL,
	`loss` boolean NOT NULL,
	`save` boolean NOT NULL,
	`hold` boolean,
	CONSTRAINT `mlb_boxscore_pitching_game_pk_mlbam_id_team_id_pk` PRIMARY KEY(`game_pk`,`mlbam_id`,`team_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mlb_boxscore_batting_mlbam_id` ON `mlb_boxscore_batting` (`mlbam_id`);--> statement-breakpoint
CREATE INDEX `idx_mlb_boxscore_pitching_mlbam_id` ON `mlb_boxscore_pitching` (`mlbam_id`);
