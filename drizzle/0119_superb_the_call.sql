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
	CONSTRAINT `mlb_boxscore_batting_game_pk_mlbam_id_pk` PRIMARY KEY(`game_pk`,`mlbam_id`)
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
	CONSTRAINT `mlb_boxscore_pitching_game_pk_mlbam_id_pk` PRIMARY KEY(`game_pk`,`mlbam_id`)
);
--> statement-breakpoint
CREATE TABLE `mlb_franchises` (
	`team_id` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`abbrev` varchar(8) NOT NULL,
	`league` varchar(4),
	`division` varchar(16),
	`active` boolean NOT NULL,
	`first_season` int,
	`last_season` int,
	`vsin_slug` varchar(64),
	`an_slug` varchar(64),
	`an_team_id` int,
	`br_abbrev` varchar(8),
	`mlb_code` varchar(8),
	`an_logo_slug` varchar(64),
	`db_slug` varchar(64),
	CONSTRAINT `mlb_franchises_team_id` PRIMARY KEY(`team_id`)
);
--> statement-breakpoint
CREATE TABLE `mlb_games` (
	`game_pk` int NOT NULL,
	`game_guid` varchar(64),
	`season` int NOT NULL,
	`game_type` char(1) NOT NULL,
	`series_description` varchar(48),
	`official_date` date NOT NULL,
	`game_datetime_utc` datetime NOT NULL,
	`day_night` varchar(8),
	`double_header` char(1) NOT NULL,
	`game_number` int NOT NULL,
	`games_in_series` int,
	`series_game_number` int,
	`status_code` varchar(4) NOT NULL,
	`detailed_state` varchar(48) NOT NULL,
	`is_tie` boolean NOT NULL DEFAULT false,
	`away_team_id` int NOT NULL,
	`home_team_id` int NOT NULL,
	`away_score` int NOT NULL,
	`home_score` int NOT NULL,
	`away_hits` int,
	`home_hits` int,
	`away_errors` int,
	`home_errors` int,
	`innings` int NOT NULL,
	`scheduled_innings` int,
	`venue_id` int,
	`attendance` int,
	`duration_minutes` int,
	`first_pitch_utc` datetime,
	`weather_condition` varchar(48),
	`temp_f` int,
	`wind` varchar(64),
	`winner_pitcher_id` int,
	`loser_pitcher_id` int,
	`save_pitcher_id` int,
	`gameday_type` char(1),
	`feed_timestamp` varchar(16) NOT NULL,
	`loaded_at` datetime NOT NULL,
	CONSTRAINT `mlb_games_game_pk` PRIMARY KEY(`game_pk`)
);
--> statement-breakpoint
CREATE TABLE `mlb_officials` (
	`game_pk` int NOT NULL,
	`mlbam_id` int NOT NULL,
	`position` varchar(24) NOT NULL,
	CONSTRAINT `mlb_officials_game_pk_mlbam_id_pk` PRIMARY KEY(`game_pk`,`mlbam_id`)
);
--> statement-breakpoint
CREATE TABLE `mlb_people` (
	`mlbam_id` int NOT NULL,
	`full_name` varchar(120) NOT NULL,
	`first_name` varchar(60),
	`last_name` varchar(60),
	`primary_position` varchar(8),
	`bat_side` char(1),
	`pitch_hand` char(1),
	`birth_date` date,
	`mlb_debut` date,
	`active` boolean,
	`is_umpire` boolean NOT NULL DEFAULT false,
	`br_id` varchar(16),
	`an_player_id` int,
	`rotowire_id` int,
	`retrosheet_id` varchar(16),
	CONSTRAINT `mlb_people_mlbam_id` PRIMARY KEY(`mlbam_id`)
);
--> statement-breakpoint
CREATE TABLE `mlb_pitches` (
	`play_id` varchar(40) NOT NULL,
	`game_pk` int NOT NULL,
	`season` int NOT NULL,
	`at_bat_index` int NOT NULL,
	`pitch_number` int NOT NULL,
	`batter_id` int NOT NULL,
	`pitcher_id` int NOT NULL,
	`is_pitch` boolean NOT NULL DEFAULT true,
	`call_code` varchar(4),
	`call_description` varchar(48),
	`pitch_type_code` varchar(4),
	`pitch_type` varchar(32),
	`type_confidence` decimal(4,2),
	`balls` int,
	`strikes` int,
	`start_speed` decimal(5,2),
	`end_speed` decimal(5,2),
	`spin_rate` int,
	`extension` decimal(5,2),
	`plate_time` decimal(5,3),
	`px` decimal(6,3),
	`pz` decimal(6,3),
	`zone` int,
	`sz_top` decimal(5,3),
	`sz_bot` decimal(5,3),
	`break_angle` decimal(6,2),
	`break_length` decimal(6,2),
	`break_vertical` decimal(6,2),
	`break_horizontal` decimal(6,2),
	`is_in_play` boolean,
	`launch_speed` decimal(5,2),
	`launch_angle` decimal(5,2),
	`total_distance` int,
	`trajectory` varchar(32),
	`hit_coord_x` decimal(7,2),
	`hit_coord_y` decimal(7,2),
	CONSTRAINT `mlb_pitches_play_id` PRIMARY KEY(`play_id`)
);
--> statement-breakpoint
CREATE TABLE `mlb_plays` (
	`game_pk` int NOT NULL,
	`at_bat_index` int NOT NULL,
	`inning` int NOT NULL,
	`half` varchar(6) NOT NULL,
	`batter_id` int NOT NULL,
	`pitcher_id` int NOT NULL,
	`bat_side` char(1),
	`pitch_hand` char(1),
	`event_type` varchar(48) NOT NULL,
	`event` varchar(64),
	`description` text,
	`rbi` int NOT NULL,
	`away_score` int NOT NULL,
	`home_score` int NOT NULL,
	`is_scoring_play` boolean NOT NULL,
	`has_out` boolean,
	`outs_end` int,
	`balls_end` int,
	`strikes_end` int,
	`men_on_base_split` varchar(16),
	`start_time_utc` datetime,
	`end_time_utc` datetime,
	`runners` json,
	`pitch_count` int NOT NULL,
	CONSTRAINT `mlb_plays_game_pk_at_bat_index_pk` PRIMARY KEY(`game_pk`,`at_bat_index`)
);
--> statement-breakpoint
CREATE TABLE `mlb_seasons` (
	`season` int NOT NULL,
	`regular_season_start` date NOT NULL,
	`regular_season_end` date NOT NULL,
	`postseason_end` date,
	`games_expected` int NOT NULL,
	`notes` varchar(255),
	CONSTRAINT `mlb_seasons_season` PRIMARY KEY(`season`)
);
--> statement-breakpoint
CREATE TABLE `mlb_venues` (
	`venue_id` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`active` boolean,
	`capacity` int,
	`turf_type` varchar(32),
	`roof_type` varchar(32),
	`left_line` int,
	`left_field` int,
	`left_center` int,
	`center` int,
	`right_center` int,
	`right_field` int,
	`right_line` int,
	`city` varchar(80),
	`state` varchar(40),
	`timezone` varchar(48),
	CONSTRAINT `mlb_venues_venue_id` PRIMARY KEY(`venue_id`)
);
--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `gamePk` int;--> statement-breakpoint
CREATE INDEX `idx_mlb_boxscore_batting_mlbam_id` ON `mlb_boxscore_batting` (`mlbam_id`);--> statement-breakpoint
CREATE INDEX `idx_mlb_boxscore_pitching_mlbam_id` ON `mlb_boxscore_pitching` (`mlbam_id`);--> statement-breakpoint
CREATE INDEX `idx_mlb_games_official_date` ON `mlb_games` (`official_date`);--> statement-breakpoint
CREATE INDEX `idx_mlb_games_season_type` ON `mlb_games` (`season`,`game_type`);--> statement-breakpoint
CREATE INDEX `idx_mlb_games_away_season` ON `mlb_games` (`away_team_id`,`season`);--> statement-breakpoint
CREATE INDEX `idx_mlb_games_home_season` ON `mlb_games` (`home_team_id`,`season`);--> statement-breakpoint
CREATE INDEX `idx_mlb_games_venue` ON `mlb_games` (`venue_id`);--> statement-breakpoint
CREATE INDEX `idx_mlb_pitches_game_pk` ON `mlb_pitches` (`game_pk`);--> statement-breakpoint
CREATE INDEX `idx_mlb_pitches_pitcher_season` ON `mlb_pitches` (`pitcher_id`,`season`);--> statement-breakpoint
CREATE INDEX `idx_mlb_pitches_batter_season` ON `mlb_pitches` (`batter_id`,`season`);--> statement-breakpoint
CREATE INDEX `idx_mlb_plays_batter` ON `mlb_plays` (`batter_id`);--> statement-breakpoint
CREATE INDEX `idx_mlb_plays_pitcher` ON `mlb_plays` (`pitcher_id`);--> statement-breakpoint
CREATE INDEX `idx_mlb_plays_event_type` ON `mlb_plays` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_msh_game_pk` ON `mlb_schedule_history` (`gamePk`);