-- Payment ledger -- every money movement, recorded locally.
--
-- Before this table the money existed ONLY inside Stripe. entitlement_events
-- recorded that access changed, and checkout_sessions recorded that a checkout
-- resolved, but no row anywhere carried an AMOUNT. The database could not
-- answer "what did we collect this month", "which renewals failed", or "how
-- much is sitting in dispute" -- every one of those required opening Stripe.
--
-- That matters most for the failure paths. A failed renewal (invoice.payment_failed)
-- was three log lines and a `break`: correct behaviour, since Stripe owns the
-- retry, but invisible to us. Under a recurring model the first thing you need
-- to know is which members are failing to pay, and that was unanswerable.
--
-- One row per Stripe money object per event type. `outcome` is separate from
-- `status` for the same reason it is on checkout_sessions: what Stripe did and
-- what WE did about it are different facts, and collapsing them is how a silent
-- drop hides.
CREATE TABLE IF NOT EXISTS `payment_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stripeEventId` varchar(255) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`livemode` tinyint(1) NOT NULL DEFAULT 1,
	-- The Stripe money object this row is about (pi_/in_/ch_/dp_).
	`objectId` varchar(64) NOT NULL,
	`objectType` varchar(32) NOT NULL,
	-- 'succeeded' | 'failed' | 'refunded' | 'disputed' | 'uncollectible'
	`kind` varchar(24) NOT NULL,
	-- What WE did: 'recorded' | 'granted' | 'revoked' | 'noop'
	`outcome` varchar(16) NOT NULL DEFAULT 'recorded',
	`outcomeReason` varchar(160),
	`amountCents` int,
	`currency` varchar(8),
	-- Net of refunds, for revenue math that does not need a second query.
	`amountRefundedCents` int,
	`userId` int,
	`stripeCustomerId` varchar(64),
	`stripeSubscriptionId` varchar(64),
	`stripeInvoiceId` varchar(64),
	`customerEmail` varchar(255),
	`failureCode` varchar(64),
	`failureMessage` varchar(255),
	`attemptCount` int,
	`occurredAt` bigint NOT NULL,
	`recordedAt` bigint NOT NULL,
	CONSTRAINT `payment_events_id` PRIMARY KEY(`id`),
	-- One row per (event, object). Stripe delivers at least once, so the webhook
	-- write-back must be an idempotent upsert rather than an append.
	CONSTRAINT `payment_events_event_object_unique` UNIQUE(`stripeEventId`,`objectId`)
);
--> statement-breakpoint
-- "Which payments failed, newest first" and "revenue in a window".
CREATE INDEX `payment_events_kind_occurred_idx` ON `payment_events` (`kind`,`occurredAt`);
--> statement-breakpoint
-- A member's full payment history.
CREATE INDEX `payment_events_user_idx` ON `payment_events` (`userId`,`occurredAt`);
--> statement-breakpoint
-- Recovery from the Stripe side.
CREATE INDEX `payment_events_customer_idx` ON `payment_events` (`stripeCustomerId`);
--> statement-breakpoint
-- Renewal history for one subscription.
CREATE INDEX `payment_events_subscription_idx` ON `payment_events` (`stripeSubscriptionId`);
--> statement-breakpoint
-- Invoice -> attempts, for dunning.
CREATE INDEX `payment_events_invoice_idx` ON `payment_events` (`stripeInvoiceId`);
--> statement-breakpoint
-- "Money moved but we did nothing" -- the silent-drop query.
CREATE INDEX `payment_events_outcome_idx` ON `payment_events` (`outcome`,`kind`);
