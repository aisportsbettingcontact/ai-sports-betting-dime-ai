ALTER TABLE `wc2026MatchOdds` ADD `odds_updated_at` datetime;--> statement-breakpoint
ALTER TABLE `wc2026MatchOdds` ADD `odds_source` varchar(64);--> statement-breakpoint
ALTER TABLE `wc2026MatchOdds` ADD `market_status` varchar(32) DEFAULT 'UNKNOWN' NOT NULL;