ALTER TABLE `app_users` ADD `planPriceId` int;
--> statement-breakpoint
CREATE INDEX `app_users_plan_price_idx` ON `app_users` (`planPriceId`);
--> statement-breakpoint
CREATE INDEX `app_users_stripe_plan_id_idx` ON `app_users` (`stripePlanId`);
