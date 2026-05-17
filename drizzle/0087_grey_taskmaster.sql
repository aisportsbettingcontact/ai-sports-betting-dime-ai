CREATE TABLE `discord_invite_tokens` (
	`token` varchar(64) NOT NULL,
	`targetUserId` int NOT NULL,
	`expiresAt` bigint NOT NULL,
	`createdAt` bigint NOT NULL,
	`usedAt` bigint,
	`linkedDiscordId` varchar(32),
	`createdBy` int NOT NULL,
	CONSTRAINT `discord_invite_tokens_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint
CREATE INDEX `idx_dit_target_user` ON `discord_invite_tokens` (`targetUserId`);--> statement-breakpoint
CREATE INDEX `idx_dit_expires_at` ON `discord_invite_tokens` (`expiresAt`);