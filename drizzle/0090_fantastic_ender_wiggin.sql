CREATE TABLE `rg_session_cache` (
	`id` int NOT NULL DEFAULT 1,
	`cookie_str` text NOT NULL,
	`fetched_at` bigint NOT NULL,
	`expires_at` bigint NOT NULL,
	CONSTRAINT `rg_session_cache_id` PRIMARY KEY(`id`)
);
