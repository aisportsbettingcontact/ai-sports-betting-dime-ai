CREATE TABLE `dime_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` int NOT NULL,
	`seq` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dime_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dime_chat_threads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(80) NOT NULL,
	`starred` boolean NOT NULL DEFAULT false,
	`archived` boolean NOT NULL DEFAULT false,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dime_chat_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_dime_chat_messages_thread_seq` ON `dime_chat_messages` (`threadId`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_dime_chat_threads_user_updated` ON `dime_chat_threads` (`userId`,`updatedAt`);