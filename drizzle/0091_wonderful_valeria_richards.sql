ALTER TABLE `mlb_game_backtest` ADD `homeTeam` varchar(128);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `awayTeam` varchar(128);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `dayNight` varchar(2);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `isDoubleheader` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `gameNumber` tinyint DEFAULT 1;--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `quarantineReason` text;--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `bookOddsOpposite` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `closingOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `closingOddsOpposite` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `clv` decimal(6,4);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `profitLoss` decimal(8,4);--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `leakageSafe` tinyint DEFAULT 1;--> statement-breakpoint
ALTER TABLE `mlb_game_backtest` ADD `modelRunAt` bigint;