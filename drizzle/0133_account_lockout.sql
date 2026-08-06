ALTER TABLE `app_users` ADD `failedLoginCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `firstFailedLoginAt` bigint;--> statement-breakpoint
ALTER TABLE `app_users` ADD `lockedUntil` bigint;