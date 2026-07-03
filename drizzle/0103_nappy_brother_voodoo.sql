ALTER TABLE `wc2026_matches` MODIFY COLUMN `status` enum('SCHEDULED','LIVE','HT','ET','SHOOTOUT','FT') NOT NULL DEFAULT 'SCHEDULED';--> statement-breakpoint
ALTER TABLE `wc2026_matches` ADD `match_minute` varchar(16);--> statement-breakpoint
ALTER TABLE `wc2026_matches` ADD `fifa_match_id` varchar(32);