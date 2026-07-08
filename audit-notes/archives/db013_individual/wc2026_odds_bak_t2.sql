-- Individual dump: wc2026_odds_bak_t2
-- Timestamp: 2026-07-08T04:15:34.642Z
-- Row count: 0

DROP TABLE IF EXISTS `wc2026_odds_bak_t2`;
CREATE TABLE `wc2026_odds_bak_t2` (
  `id` bigint DEFAULT NULL,
  `match_id` varchar(64) DEFAULT NULL,
  `book_home_ml` int DEFAULT NULL,
  `book_draw_ml` int DEFAULT NULL,
  `book_away_ml` int DEFAULT NULL,
  `book_home_spread` varchar(32) DEFAULT NULL,
  `book_away_spread` varchar(32) DEFAULT NULL,
  `book_over` varchar(32) DEFAULT NULL,
  `book_under` varchar(32) DEFAULT NULL,
  `book_btts_yes` int DEFAULT NULL,
  `book_btts_no` int DEFAULT NULL,
  `book_home_to_advance` int DEFAULT NULL,
  `book_away_to_advance` int DEFAULT NULL,
  `source` varchar(64) DEFAULT NULL,
  `snapshot_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

