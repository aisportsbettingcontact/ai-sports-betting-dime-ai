CREATE TABLE IF NOT EXISTS `plan_features` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int NOT NULL,
	`featureKey` varchar(64) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `plan_features_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_features_plan_feature_unique` ON `plan_features` (`planId`,`featureKey`);
--> statement-breakpoint
CREATE INDEX `plan_features_feature_idx` ON `plan_features` (`featureKey`);
--> statement-breakpoint
CREATE INDEX `plan_features_plan_sort_idx` ON `plan_features` (`planId`,`sortOrder`);
