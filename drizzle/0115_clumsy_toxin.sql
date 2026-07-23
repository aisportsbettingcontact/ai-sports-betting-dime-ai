CREATE TABLE `analytics_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`eventName` varchar(64) NOT NULL,
	`schemaVersion` int NOT NULL,
	`subjectId` int NOT NULL,
	`sessionId` varchar(64),
	`source` varchar(32) NOT NULL,
	`environment` varchar(32) NOT NULL,
	`occurredAtUtc` bigint NOT NULL,
	`receivedAtUtc` bigint NOT NULL,
	`outcome` varchar(32),
	`dataState` varchar(32),
	`propsJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analytics_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `analytics_events_eventId_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
CREATE INDEX `idx_analytics_events_subject_id` ON `analytics_events` (`subjectId`);--> statement-breakpoint
CREATE INDEX `idx_analytics_events_event_name` ON `analytics_events` (`eventName`);--> statement-breakpoint
CREATE INDEX `idx_analytics_events_occurred_at` ON `analytics_events` (`occurredAtUtc`);