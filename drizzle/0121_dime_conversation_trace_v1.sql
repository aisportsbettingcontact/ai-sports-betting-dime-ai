ALTER TABLE `dime_chat_messages` ADD CONSTRAINT `uq_dime_chat_messages_thread_seq` UNIQUE(`threadId`,`seq`);--> statement-breakpoint
CREATE TABLE `dime_chat_generations` (
	`id` varchar(36) NOT NULL,
	`turnId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`idempotencyKey` varchar(36) NOT NULL,
	`requestedThreadId` int,
	`clientAssistantMessageId` varchar(36) NOT NULL,
	`attempt` int NOT NULL,
	`inputSha256` varchar(64) NOT NULL,
	`requestFingerprintSha256` varchar(64) NOT NULL,
	`historySha256` varchar(64) NOT NULL,
	`historySnapshot` mediumtext,
	`provider` varchar(64) NOT NULL,
	`deploymentTier` varchar(32) NOT NULL,
	`endpointSource` varchar(32),
	`requestedModel` varchar(160) NOT NULL,
	`actualModel` varchar(160),
	`baseRevision` varchar(64),
	`adapterRevision` varchar(64),
	`sourceCommit` varchar(64),
	`productProfile` varchar(64) NOT NULL,
	`profileVersion` varchar(32) NOT NULL,
	`promptSource` varchar(64) NOT NULL,
	`systemPromptSha256` varchar(64),
	`blueprintHash` varchar(64),
	`maxTokens` int NOT NULL,
	`temperature` varchar(16),
	`contextFreshness` enum('live','delayed','none') NOT NULL DEFAULT 'none',
	`contextSha256` varchar(64),
	`contextRowCount` int NOT NULL DEFAULT 0,
	`contextSnapshot` text,
	`status` enum('generating','completed','blocked','failed','aborted') NOT NULL DEFAULT 'generating',
	`rawOutput` text,
	`servedOutput` text,
	`validationErrors` text,
	`certaintyViolation` boolean NOT NULL DEFAULT false,
	`finishReason` varchar(64),
	`promptTokens` int,
	`completionTokens` int,
	`totalTokens` int,
	`latencyMs` int,
	`errorClass` varchar(96),
	`errorCode` varchar(64),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`leaseExpiresAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`purgeAfter` timestamp NOT NULL,
	CONSTRAINT `dime_chat_generations_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_dime_chat_generations_request_id` UNIQUE(`requestId`),
	CONSTRAINT `idx_dime_chat_generations_user_idempotency` UNIQUE(`userId`,`idempotencyKey`),
	CONSTRAINT `idx_dime_chat_generations_turn_attempt` UNIQUE(`turnId`,`attempt`)
);
--> statement-breakpoint
CREATE TABLE `dime_chat_sessions` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`clientSessionId` varchar(36) NOT NULL,
	`surface` varchar(32) NOT NULL DEFAULT 'dime-chat-web',
	`policyVersion` varchar(32) NOT NULL,
	`retentionClass` enum('product_history','restricted_quality') NOT NULL DEFAULT 'product_history',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dime_chat_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_dime_chat_sessions_user_client_session` UNIQUE(`userId`,`clientSessionId`)
);
--> statement-breakpoint
CREATE TABLE `dime_chat_trace_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`turnId` varchar(36) NOT NULL,
	`generationId` varchar(36),
	`eventType` varchar(64) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dime_chat_trace_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dime_chat_turns` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`threadId` int NOT NULL,
	`clientTurnId` varchar(36) NOT NULL,
	`userMessageId` int NOT NULL,
	`assistantMessageId` int,
	`lastGenerationId` varchar(36) NOT NULL,
	`inputSha256` varchar(64) NOT NULL,
	`requestClass` varchar(32) NOT NULL,
	`responseBudget` int NOT NULL,
	`status` enum('generating','completed','blocked','failed','aborted') NOT NULL DEFAULT 'generating',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dime_chat_turns_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_dime_chat_turns_session_client_turn` UNIQUE(`sessionId`,`clientTurnId`)
);
--> statement-breakpoint
ALTER TABLE `dime_chat_messages` ADD `sessionId` varchar(36);--> statement-breakpoint
ALTER TABLE `dime_chat_messages` ADD `turnId` varchar(36);--> statement-breakpoint
ALTER TABLE `dime_chat_messages` ADD `clientMessageId` varchar(36);--> statement-breakpoint
ALTER TABLE `dime_chat_messages` ADD `generationId` varchar(36);--> statement-breakpoint
ALTER TABLE `dime_chat_messages` ADD `contentSha256` varchar(64);--> statement-breakpoint
ALTER TABLE `dime_chat_messages` ADD CONSTRAINT `idx_dime_chat_messages_thread_client_message` UNIQUE(`threadId`,`clientMessageId`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_generations_status_started` ON `dime_chat_generations` (`status`,`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_generations_purge_after` ON `dime_chat_generations` (`purgeAfter`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_sessions_user_last_seen` ON `dime_chat_sessions` (`userId`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_trace_events_turn_event` ON `dime_chat_trace_events` (`turnId`,`id`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_trace_events_generation_event` ON `dime_chat_trace_events` (`generationId`,`id`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_turns_thread_started` ON `dime_chat_turns` (`threadId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_turns_user_started` ON `dime_chat_turns` (`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_turns_last_generation` ON `dime_chat_turns` (`lastGenerationId`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_messages_turn` ON `dime_chat_messages` (`turnId`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_messages_generation` ON `dime_chat_messages` (`generationId`);--> statement-breakpoint
DROP INDEX `idx_dime_chat_messages_thread_seq` ON `dime_chat_messages`;
