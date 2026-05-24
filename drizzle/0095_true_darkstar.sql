ALTER TABLE `app_users` ADD `pendingSetup` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `pendingEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `app_users` ADD `pendingUsername` varchar(64);--> statement-breakpoint
ALTER TABLE `app_users` ADD `pendingStripeSessionId` varchar(128);