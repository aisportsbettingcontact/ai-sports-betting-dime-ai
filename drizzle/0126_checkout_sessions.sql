-- Checkout attempt ledger.
--
-- Before this table a checkout existed ONLY inside Stripe. The single local
-- trace was app_users.pendingStripeSessionId, written only when the buyer was
-- already a logged-in user -- so an anonymous purchase left no row anywhere,
-- and a session that never completed left nothing at all.
--
-- That is how two live payments were dropped without anyone noticing: the
-- webhook bailed, nothing recorded the bail, and the only evidence was a
-- console line in a log stream nobody was watching.
--
-- Every checkout is now written here BEFORE the buyer is sent to Stripe, and
-- updated when the webhook resolves it. `fulfillment` is deliberately separate
-- from `status`: a session can be status='completed' (Stripe took the money)
-- while fulfillment='dropped' (we granted nothing). Those two being
-- indistinguishable is exactly what hid the incident.
CREATE TABLE IF NOT EXISTS `checkout_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stripeSessionId` varchar(255) NOT NULL,
	`livemode` tinyint(1) NOT NULL DEFAULT 1,
	`mode` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'created',
	`fulfillment` varchar(16) NOT NULL DEFAULT 'pending',
	`fulfillmentReason` varchar(120),
	`userId` int,
	`planId` varchar(64),
	`planPriceId` int,
	`stripePriceId` varchar(64),
	`amountCents` int,
	`currency` varchar(8),
	`desiredUsername` varchar(64),
	`customerEmail` varchar(255),
	`stripeCustomerId` varchar(64),
	`stripeSubscriptionId` varchar(64),
	`stripePaymentIntentId` varchar(64),
	`paymentStatus` varchar(32),
	`origin` varchar(255),
	`createdAt` bigint NOT NULL,
	`completedAt` bigint,
	`resolvedAt` bigint,
	CONSTRAINT `checkout_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `checkout_sessions_stripeSessionId_unique` UNIQUE(`stripeSessionId`)
);
--> statement-breakpoint
-- "Show me every checkout that took money but granted nothing" -- the query
-- that would have surfaced both dropped payments the day they happened.
CREATE INDEX `checkout_sessions_fulfillment_idx` ON `checkout_sessions` (`fulfillment`,`status`);
--> statement-breakpoint
-- Funnel / conversion over time.
CREATE INDEX `checkout_sessions_status_created_idx` ON `checkout_sessions` (`status`,`createdAt`);
--> statement-breakpoint
-- "What did this member attempt?"
CREATE INDEX `checkout_sessions_user_idx` ON `checkout_sessions` (`userId`);
--> statement-breakpoint
-- Recovering an orphaned payment from the Stripe side.
CREATE INDEX `checkout_sessions_customer_idx` ON `checkout_sessions` (`stripeCustomerId`);
--> statement-breakpoint
-- Per-plan conversion.
CREATE INDEX `checkout_sessions_plan_idx` ON `checkout_sessions` (`planId`);
--> statement-breakpoint
-- Anonymous checkout is matched back by email when there is no user_id.
CREATE INDEX `checkout_sessions_email_idx` ON `checkout_sessions` (`customerEmail`);
