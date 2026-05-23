ALTER TABLE `mlb_game_backtest` ADD `gameTime` varchar(32);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `gameStartUtcMs` bigint;--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `voidReason` text;--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `auditVersion` varchar(64);