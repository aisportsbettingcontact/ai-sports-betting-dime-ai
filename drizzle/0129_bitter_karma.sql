CREATE INDEX `idx_tb_result_date` ON `tracked_bets` (`result`,`gameDate`);--> statement-breakpoint
CREATE INDEX `idx_tb_user_game` ON `tracked_bets` (`userId`,`anGameId`,`gameNumber`);