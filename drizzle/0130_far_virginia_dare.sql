ALTER TABLE `app_users` ADD `deletedAt` bigint;--> statement-breakpoint
CREATE INDEX `idx_tb_user_fingerprint` ON `tracked_bets` (`userId`,`updatedAt`,`id`);