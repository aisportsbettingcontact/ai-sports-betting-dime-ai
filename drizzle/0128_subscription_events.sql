-- Subscription lifecycle ledger -- every transition, recorded locally.
--
-- Plan changes route through the Stripe Customer Portal (the recommended
-- pattern), so no in-app code runs when a member upgrades or downgrades. The
-- only local trace was whatever grantUserAccess overwrote on app_users --
-- current state, not history. "Who downgraded last month", "how many scheduled
-- cancellations were reverted", "which subscription did this renewal extend"
-- were unanswerable without opening Stripe. One table serves avenues #3
-- (upgrades/downgrades), #4 (cancellations), and #8 (renewals).
--
-- `kind` (what happened to the subscription) is separate from `outcome` (what
-- WE did about it), same as checkout_sessions and payment_events -- collapsing
-- those two facts is exactly how the original checkout incident stayed hidden.
--
-- from/to price ids are STRIPE price ids: prices are immutable, so the pair
-- pins the exact SKUs either side of a transition across repricings.
CREATE TABLE IF NOT EXISTS `subscription_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	-- NULL for app-initiated actions (cancel/reactivate mutations).
	`stripeEventId` varchar(255),
	-- Stripe event type, or a synthetic `app.*` type for in-app actions.
	`eventType` varchar(64) NOT NULL,
	`livemode` tinyint(1) NOT NULL DEFAULT 1,
	`stripeSubscriptionId` varchar(64) NOT NULL,
	`stripeCustomerId` varchar(64),
	`userId` int,
	-- 'created' | 'plan_changed' | 'cancel_scheduled' | 'cancel_reverted' |
	-- 'status_changed' | 'updated' | 'deleted' | 'renewed' | 'trial_ending' |
	-- 'renewal_upcoming'
	`kind` varchar(24) NOT NULL,
	-- What WE did: 'recorded' | 'granted' | 'revoked' | 'noop'
	`outcome` varchar(16) NOT NULL DEFAULT 'recorded',
	`outcomeReason` varchar(160),
	`fromPlanId` varchar(64),
	`toPlanId` varchar(64),
	`fromPriceId` varchar(64),
	`toPriceId` varchar(64),
	`fromInterval` varchar(16),
	`toInterval` varchar(16),
	`status` varchar(24),
	`cancelAtPeriodEnd` tinyint(1),
	`periodEnd` bigint,
	-- 'webhook' | 'user' | 'owner' | 'system'
	`actor` varchar(16) NOT NULL DEFAULT 'webhook',
	`occurredAt` bigint NOT NULL,
	`recordedAt` bigint NOT NULL,
	CONSTRAINT `subscription_events_id` PRIMARY KEY(`id`),
	-- Redelivery guard. NULL stripeEventId (app-initiated) is exempt by SQL
	-- semantics -- a member scheduling, reverting, and re-scheduling a
	-- cancellation is three real acts, not one deduplicated one.
	CONSTRAINT `subscription_events_event_kind_unique` UNIQUE(`stripeEventId`,`kind`)
);
--> statement-breakpoint
-- One subscription's full lifecycle, in order.
CREATE INDEX `subscription_events_sub_occurred_idx` ON `subscription_events` (`stripeSubscriptionId`,`occurredAt`);
--> statement-breakpoint
-- One member's full lifecycle, in order.
CREATE INDEX `subscription_events_user_occurred_idx` ON `subscription_events` (`userId`,`occurredAt`);
--> statement-breakpoint
-- "All plan changes last month", "all cancellations scheduled this week".
CREATE INDEX `subscription_events_kind_occurred_idx` ON `subscription_events` (`kind`,`occurredAt`);
--> statement-breakpoint
-- Recovery from the Stripe side.
CREATE INDEX `subscription_events_customer_idx` ON `subscription_events` (`stripeCustomerId`);
--> statement-breakpoint
-- "The subscription changed but we did nothing" -- the silent-drop query.
CREATE INDEX `subscription_events_outcome_kind_idx` ON `subscription_events` (`outcome`,`kind`);
--> statement-breakpoint
-- Fail-closed default for the master access switch (CRITICAL, 2026-08-01).
-- Both live insert paths set hasAccess explicitly, so this changes NO existing
-- behaviour and NO existing rows -- it only ensures that a future insert path
-- that forgets the column denies access instead of granting a silent lifetime
-- membership (expiryDate NULL = lifetime). Metadata-only ALTER: instant on TiDB.
ALTER TABLE `app_users` ALTER COLUMN `hasAccess` SET DEFAULT 0;
