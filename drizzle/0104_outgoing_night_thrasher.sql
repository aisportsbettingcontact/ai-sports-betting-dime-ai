CREATE TABLE `wc2026_expected_goals` (
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
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_expected_goals_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_wc2026_xg_matchId` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_glossary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`abbreviation` varchar(16) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`category` enum('outfield','goalkeeper','both') NOT NULL DEFAULT 'both',
	`description` text,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_glossary_id` PRIMARY KEY(`id`),
	CONSTRAINT `wc2026_glossary_abbreviation_unique` UNIQUE(`abbreviation`),
	CONSTRAINT `idx_wc2026_glossary_abbrev` UNIQUE(`abbreviation`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_match_odds` (
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
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_match_odds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` varchar(32) NOT NULL,
	`uid` varchar(64),
	`competition` varchar(128),
	`round` varchar(64),
	`season` varchar(16) DEFAULT '2026',
	`matchDateUtc` bigint NOT NULL,
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
	`scrapeVersion` varchar(16) DEFAULT '250x',
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `wc2026_matches_matchId_unique` UNIQUE(`matchId`),
	CONSTRAINT `idx_wc2026_matches_matchId` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_player_stats` (
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
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_player_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_wc2026_player_stats_match_player` UNIQUE(`matchId`,`athleteId`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_shot_map` (
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
	`createdAt` bigint NOT NULL,
	CONSTRAINT `wc2026_shot_map_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wc2026_team_stats` (
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
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `wc2026_team_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_wc2026_team_stats_matchId` UNIQUE(`matchId`)
);
--> statement-breakpoint
CREATE INDEX `idx_wc2026_xg_homeTeam` ON `wc2026_expected_goals` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_xg_awayTeam` ON `wc2026_expected_goals` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_glossary_category` ON `wc2026_glossary` (`category`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_odds_matchId` ON `wc2026_match_odds` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_odds_homeTeam` ON `wc2026_match_odds` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_odds_awayTeam` ON `wc2026_match_odds` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_matches_homeTeam` ON `wc2026_matches` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_matches_awayTeam` ON `wc2026_matches` (`awayTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_matches_date` ON `wc2026_matches` (`matchDateUtc`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_matches_round` ON `wc2026_matches` (`round`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_player_stats_matchId` ON `wc2026_player_stats` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_player_stats_athleteId` ON `wc2026_player_stats` (`athleteId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_player_stats_team` ON `wc2026_player_stats` (`teamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_player_stats_position` ON `wc2026_player_stats` (`positionGroup`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_shots_matchId` ON `wc2026_shot_map` (`matchId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_shots_player` ON `wc2026_shot_map` (`playerId`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_shots_team` ON `wc2026_shot_map` (`teamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_shots_iconType` ON `wc2026_shot_map` (`iconType`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_team_stats_homeTeam` ON `wc2026_team_stats` (`homeTeamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_wc2026_team_stats_awayTeam` ON `wc2026_team_stats` (`awayTeamAbbrev`);