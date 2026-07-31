CREATE TABLE IF NOT EXISTS `stripe_webhook_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stripeEventId` varchar(255) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`livemode` boolean NOT NULL DEFAULT false,
	`eventCreatedAt` bigint,
	`processedAt` bigint NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'processed',
	CONSTRAINT `stripe_webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_webhook_events_event_id_unique` UNIQUE(`stripeEventId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `entitlement_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripeEventId` varchar(255),
	`eventType` varchar(64) NOT NULL,
	`reason` varchar(64) NOT NULL,
	`actor` varchar(64) NOT NULL DEFAULT 'webhook',
	`beforeHasAccess` boolean,
	`afterHasAccess` boolean,
	`beforePlanId` varchar(64),
	`afterPlanId` varchar(64),
	`beforeExpiryDate` bigint,
	`afterExpiryDate` bigint,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `entitlement_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_events_event_type_idx` ON `stripe_webhook_events` (`eventType`);
--> statement-breakpoint
CREATE INDEX `entitlement_events_user_created_idx` ON `entitlement_events` (`userId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `entitlement_events_stripe_event_id_idx` ON `entitlement_events` (`stripeEventId`);
--> statement-breakpoint
ALTER TABLE `app_users` ADD `pendingSetupExpiresAt` bigint;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `stripeSubscriptionStatus` varchar(32);
--> statement-breakpoint
ALTER TABLE `app_users` ADD `lastStripeEventAt` bigint;
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_stripe_customer_id_unique` ON `app_users` (`stripeCustomerId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_stripe_subscription_id_unique` ON `app_users` (`stripeSubscriptionId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_pending_stripe_session_id_unique` ON `app_users` (`pendingStripeSessionId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_prices_stripe_price_id_unique` ON `plan_prices` (`stripePriceId`);
