CREATE TABLE `wc2026_espn_expected_goals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`homeTeamAbbrev` varchar(8) NOT NULL,
	`awayTeamAbbrev` varchar(8) NOT NULL,
	`homeXG` decimal(6,3),
	`awayXG` decimal(6,3),
	`homeXGOpenPlay` decimal(6,3),
	`awayXGOpenPlay` decimal(6,3),
	`homeXGSetPlay` decimal(6,3),
	`awayXGSetPlay` decimal(6,3),
	`homeXGOT` decimal(6,3),
	`awayXGOT` decimal(6,3),
	`homeXA` decimal(6,3),
	`awayXA` decimal(6,3),
	`perPlayerJson` text,
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_expected_goals_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_wc2026_espn_xg_matchId` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_glossary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`abbreviation` varchar(16) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`category` enum('outfield','goalkeeper','both') NOT NULL DEFAULT 'both',
	`description` text,
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_glossary_id` PRIMARY KEY(`id`),
	CONSTRAINT `wc2026_espn_glossary_abbreviation_unique` UNIQUE(`abbreviation`),
	CONSTRAINT `idx_wc2026_espn_glossary_abbrev` UNIQUE(`abbreviation`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_match_odds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`provider` varchar(32),
	`headerText` varchar(64),
	`homeTeamAbbrev` varchar(8),
	`homeTeamName` varchar(64),
	`homeMoneylineOpen` varchar(16),
	`homeMoneylineCurrent` varchar(16),
	`homeTotalSide` varchar(16),
	`homeTotalOdds` varchar(16),
	`homeSpreadLine` varchar(16),
	`homeSpreadOdds` varchar(16),
	`awayTeamAbbrev` varchar(8),
	`awayTeamName` varchar(64),
	`awayMoneylineOpen` varchar(16),
	`awayMoneylineCurrent` varchar(16),
	`awayTotalSide` varchar(16),
	`awayTotalOdds` varchar(16),
	`awaySpreadLine` varchar(16),
	`awaySpreadOdds` varchar(16),
	`drawMoneylineOpen` varchar(16),
	`drawMoneylineCurrent` varchar(16),
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_match_odds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`uid` varchar(64),
	`competition` varchar(128),
	`round` varchar(64),
	`season` varchar(16) DEFAULT '2026',
	`matchDateUtc` bigint NOT NULL,
	`matchGameDate` varchar(10),
	`matchKickoffEt` varchar(8),
	`statusState` varchar(32),
	`statusDetail` varchar(64),
	`statusDisplay` varchar(32),
	`venue` varchar(128),
	`city` varchar(128),
	`attendance` int,
	`referee` varchar(128),
	`broadcasts` text,
	`homeTeamId` varchar(16) NOT NULL,
	`homeTeamAbbrev` varchar(8) NOT NULL,
	`homeTeamName` varchar(64) NOT NULL,
	`homeTeamLogo` text,
	`homeScore` int,
	`homeLinescores` text,
	`homeGoalScorers` text,
	`homeRedCards` text,
	`awayTeamId` varchar(16) NOT NULL,
	`awayTeamAbbrev` varchar(8) NOT NULL,
	`awayTeamName` varchar(64) NOT NULL,
	`awayTeamLogo` text,
	`awayScore` int,
	`awayLinescores` text,
	`awayGoalScorers` text,
	`awayRedCards` text,
	`homeFormation` varchar(16),
	`awayFormation` varchar(16),
	`scrapedAt` bigint NOT NULL,
	`scrapeDurationMs` int,
	`scrapeVersion` varchar(16) DEFAULT '500x',
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `wc2026_espn_matches_matchId_unique` UNIQUE(`matchId`),
	CONSTRAINT `idx_wc2026_espn_matches_matchId` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_player_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`athleteId` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`nameShort` varchar(64),
	`jersey` varchar(4),
	`teamAbbrev` varchar(8) NOT NULL,
	`teamName` varchar(64),
	`isHome` tinyint NOT NULL,
	`positionGroup` varchar(32),
	`isGoalkeeper` tinyint NOT NULL DEFAULT 0,
	`tch` int,
	`g` int,
	`a` int,
	`xG` decimal(6,4),
	`xA` decimal(6,4),
	`sog` int,
	`shot` int,
	`bcc` int,
	`dint` int,
	`duelw` int,
	`ga` int,
	`sv` int,
	`soga` int,
	`xGC` decimal(6,4),
	`xGOTC` decimal(6,4),
	`gp` decimal(6,4),
	`bcs` int,
	`clr` int,
	`cc` int,
	`ks` int,
	`appearances` int,
	`foulsCommitted` int,
	`foulsSuffered` int,
	`ownGoals` int,
	`redCards` int,
	`subIns` int,
	`yellowCards` int,
	`offsides` int,
	`shotsFaced` int,
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_player_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_wc2026_espn_player_stats_match_player` UNIQUE(`matchId`,`athleteId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_shot_map` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`shotId` varchar(32),
	`sequence` int,
	`playerId` varchar(32),
	`playerName` varchar(128),
	`playerShortName` varchar(64),
	`playerJersey` varchar(4),
	`teamAbbrev` varchar(8),
	`isAway` tinyint,
	`period` int,
	`clock` varchar(8),
	`iconType` varchar(16),
	`isOwnGoal` tinyint,
	`fieldStartX` decimal(6,2),
	`fieldStartY` decimal(6,2),
	`fieldEndX` decimal(6,2),
	`fieldEndY` decimal(6,2),
	`goalPositionY` decimal(6,2),
	`goalPositionZ` decimal(6,2),
	`xG` decimal(6,4),
	`xGOT` decimal(6,4),
	`distance` varchar(16),
	`shotType` varchar(32),
	`situation` varchar(32),
	`goalZone` varchar(32),
	`description` text,
	`shortDescription` varchar(255),
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_shot_map_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_team_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`homeTeamAbbrev` varchar(8) NOT NULL,
	`awayTeamAbbrev` varchar(8) NOT NULL,
	`possession` varchar(8),
	`shotsOnGoal` int,
	`shotsOnGoalAway` int,
	`shotAttempts` int,
	`shotAttemptsAway` int,
	`fouls` int,
	`foulsAway` int,
	`yellowCards` int,
	`yellowCardsAway` int,
	`redCards` int,
	`redCardsAway` int,
	`cornerKicks` int,
	`cornerKicksAway` int,
	`saves` int,
	`savesAway` int,
	`possessionAway` varchar(8),
	`matchRound` varchar(32),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_team_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_wc2026_espn_team_stats_matchId` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_espn_bracket` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`game_id` varchar(16) NOT NULL,
	`matchup_id` varchar(8) NOT NULL,
	`match_number` varchar(32),
	`round_id` smallint NOT NULL,
	`round_label` varchar(64) NOT NULL,
	`bracket_location` smallint,
	`date_utc` varchar(32),
	`status_detail` varchar(32),
	`status_state` varchar(8),
	`location` varchar(128),
	`broadcasts` varchar(64),
	`odds_display` varchar(32),
	`home_team_id` varchar(16),
	`home_team_name` varchar(64),
	`home_team_abbrev` varchar(8),
	`home_team_logo` text,
	`home_score` varchar(16),
	`home_winner` tinyint NOT NULL DEFAULT 0,
	`home_is_tbd` tinyint NOT NULL DEFAULT 0,
	`away_team_id` varchar(16),
	`away_team_name` varchar(64),
	`away_team_abbrev` varchar(8),
	`away_team_logo` text,
	`away_score` varchar(16),
	`away_winner` tinyint NOT NULL DEFAULT 0,
	`away_is_tbd` tinyint NOT NULL DEFAULT 0,
	`espn_link` text,
	`advancement_slug` varchar(128),
	`scraped_at` bigint NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `wc2026_espn_bracket_id` PRIMARY KEY(`id`),
	CONSTRAINT `wc2026_espn_bracket_game_id_unique` UNIQUE(`game_id`),
	CONSTRAINT `idx_wc2026_espn_bracket_game_id` UNIQUE(`game_id`)
);
--> statement-breakpoint
DROP TABLE `wc2026_expected_goals`;--> statement-breakpoint
DROP TABLE `wc2026_glossary`;--> statement-breakpoint
DROP TABLE `wc2026_match_odds`;--> statement-breakpoint
DROP TABLE `wc2026_matches`;--> statement-breakpoint
DROP TABLE `wc2026_player_stats`;--> statement-breakpoint
DROP TABLE `wc2026_shot_map`;--> statement-breakpoint
DROP TABLE `wc2026_team_stats`;--> statement-breakpoint
DROP TABLE `wc2026_betting_splits`;--> statement-breakpoint
ALTER TABLE `wc2026_espn_lineups` ADD `matchRound` varchar(32);--> statement-breakpoint
ALTER TABLE `wc2026_espn_match_stats` ADD `matchRound` varchar(32);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_xg_homeTeam` ON `wc2026_espn_expected_goals` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_xg_awayTeam` ON `wc2026_espn_expected_goals` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_xg_matchRound` ON `wc2026_espn_expected_goals` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_glossary_category` ON `wc2026_espn_glossary` (`category`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_odds_matchId` ON `wc2026_espn_match_odds` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_odds_homeTeam` ON `wc2026_espn_match_odds` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_odds_awayTeam` ON `wc2026_espn_match_odds` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_odds_matchRound` ON `wc2026_espn_match_odds` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_matches_homeTeam` ON `wc2026_espn_matches` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_matches_awayTeam` ON `wc2026_espn_matches` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_matches_date` ON `wc2026_espn_matches` (`matchDateUtc`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_matches_round` ON `wc2026_espn_matches` (`round`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_matches_matchRound` ON `wc2026_espn_matches` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_player_stats_matchId` ON `wc2026_espn_player_stats` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_player_stats_athleteId` ON `wc2026_espn_player_stats` (`athleteId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_player_stats_team` ON `wc2026_espn_player_stats` (`teamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_player_stats_position` ON `wc2026_espn_player_stats` (`positionGroup`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_player_stats_matchRound` ON `wc2026_espn_player_stats` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_shots_matchId` ON `wc2026_espn_shot_map` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_shots_player` ON `wc2026_espn_shot_map` (`playerId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_shots_team` ON `wc2026_espn_shot_map` (`teamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_shots_iconType` ON `wc2026_espn_shot_map` (`iconType`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_shots_matchRound` ON `wc2026_espn_shot_map` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_team_stats_homeTeam` ON `wc2026_espn_team_stats` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_team_stats_awayTeam` ON `wc2026_espn_team_stats` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_team_stats_matchRound` ON `wc2026_espn_team_stats` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_matchup_id` ON `wc2026_espn_bracket` (`matchup_id`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_round_id` ON `wc2026_espn_bracket` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_match_number` ON `wc2026_espn_bracket` (`match_number`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_bracket_loc` ON `wc2026_espn_bracket` (`round_id`,`bracket_location`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_status_state` ON `wc2026_espn_bracket` (`status_state`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_home_team` ON `wc2026_espn_bracket` (`home_team_abbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_bracket_away_team` ON `wc2026_espn_bracket` (`away_team_abbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_espn_lineups_matchRound` ON `wc2026_espn_lineups` (`matchRound`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_match_stats_matchRound` ON `wc2026_espn_match_stats` (`matchRound`);