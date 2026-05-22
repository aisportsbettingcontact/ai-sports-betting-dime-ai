CREATE TABLE `jack_mac_sync_jobs` (
	`jobId` varchar(64) NOT NULL,
	`runId` varchar(64) NOT NULL,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`startedAt` bigint NOT NULL,
	`completedAt` bigint,
	`result` text,
	`error` text,
	`triggeredBy` varchar(64),
	CONSTRAINT `jack_mac_sync_jobs_jobId` PRIMARY KEY(`jobId`)
);
--> statement-breakpoint
CREATE INDEX `idx_jmsj_status` ON `jack_mac_sync_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jmsj_started_at` ON `jack_mac_sync_jobs` (`startedAt`);