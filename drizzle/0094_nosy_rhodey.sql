ALTER TABLE `app_users` ADD `stripeCustomerId` varchar(64);--> statement-breakpoint
ALTER TABLE `app_users` ADD `stripeSubscriptionId` varchar(64);--> statement-breakpoint
ALTER TABLE `app_users` ADD `stripePlanId` varchar(16);