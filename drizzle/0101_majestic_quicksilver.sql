ALTER TABLE `wc2026_matches` ADD `display_order` int;--> statement-breakpoint
ALTER TABLE `wc2026_frozen_book_odds` ADD `to_advance_home_odds` smallint;--> statement-breakpoint
ALTER TABLE `wc2026_frozen_book_odds` ADD `to_advance_away_odds` smallint;--> statement-breakpoint
ALTER TABLE `wc2026_model_projections` ADD `to_advance_home_prob` double;--> statement-breakpoint
ALTER TABLE `wc2026_model_projections` ADD `to_advance_away_prob` double;--> statement-breakpoint
ALTER TABLE `wc2026_model_projections` ADD `to_advance_home_odds` smallint;--> statement-breakpoint
ALTER TABLE `wc2026_model_projections` ADD `to_advance_away_odds` smallint;