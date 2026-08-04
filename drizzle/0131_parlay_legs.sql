CREATE TABLE `tracked_bet_legs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`betId` int NOT NULL,
	`legIndex` int NOT NULL,
	`sport` varchar(16) NOT NULL DEFAULT 'MLB',
	`gameDate` varchar(20) NOT NULL,
	`awayTeam` varchar(128),
	`homeTeam` varchar(128),
	`anGameId` int,
	`gameNumber` int DEFAULT 1,
	`market` enum('ML','RL','TOTAL') NOT NULL DEFAULT 'ML',
	`pickSide` enum('AWAY','HOME','OVER','UNDER'),
	`timeframe` enum('FULL_GAME','FIRST_5','FIRST_INNING','NRFI','YRFI','REGULATION','FIRST_PERIOD','FIRST_HALF','FIRST_QUARTER') NOT NULL DEFAULT 'FULL_GAME',
	`line` decimal(6,1),
	`odds` int NOT NULL,
	`pick` varchar(255) NOT NULL,
	`result` enum('PENDING','WIN','LOSS','PUSH','VOID') NOT NULL DEFAULT 'PENDING',
	`awayScore` varchar(16),
	`homeScore` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tracked_bet_legs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `originalOdds` int;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `legCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_tbl_bet` ON `tracked_bet_legs` (`betId`,`legIndex`);--> statement-breakpoint
CREATE INDEX `idx_tbl_result_date` ON `tracked_bet_legs` (`result`,`gameDate`);