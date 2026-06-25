CREATE TABLE `wc2026_frozen_book_odds` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`fixture_id` varchar(16) NOT NULL,
	`frozen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`frozen_by` varchar(64) NOT NULL DEFAULT 'system',
	`book_home_ml` smallint,
	`book_draw_ml` smallint,
	`book_away_ml` smallint,
	`book_spread_line` double,
	`book_home_spread_odds` smallint,
	`book_away_spread_odds` smallint,
	`book_total_line` double,
	`book_over_odds` smallint,
	`book_under_odds` smallint,
	`book_btts_yes_odds` smallint,
	`book_btts_no_odds` smallint,
	`book_dc_1x_odds` smallint,
	`book_dc_x2_odds` smallint,
	`book_no_draw_home_odds` smallint,
	`book_no_draw_away_odds` smallint,
	`book_source` varchar(32) NOT NULL DEFAULT 'DraftKings',
	CONSTRAINT `wc2026_frozen_book_odds_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_frozen_book_fixture` UNIQUE(`fixture_id`)
);
--> statement-breakpoint
ALTER TABLE `wc2026_model_projections` ADD `is_frozen` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wc2026_model_projections` ADD `frozen_at` timestamp;--> statement-breakpoint
ALTER TABLE `wc2026_frozen_book_odds` ADD CONSTRAINT `wc2026_frozen_book_odds_fixture_id_wc2026_fixtures_fixture_id_fk` FOREIGN KEY (`fixture_id`) REFERENCES `wc2026_fixtures`(`fixture_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_frozen_book_fixture` ON `wc2026_frozen_book_odds` (`fixture_id`);