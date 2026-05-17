CREATE TABLE `discord_login_states` (
	`state` varchar(64) NOT NULL,
	`returnPath` varchar(512) NOT NULL DEFAULT '/',
	`expiresAt` bigint NOT NULL,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `discord_login_states_state` PRIMARY KEY(`state`)
);
