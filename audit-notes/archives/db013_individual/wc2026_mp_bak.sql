-- Individual dump: wc2026_mp_bak
-- Timestamp: 2026-07-08T04:15:34.219Z
-- Row count: 0

DROP TABLE IF EXISTS `wc2026_mp_bak`;
CREATE TABLE `wc2026_mp_bak` (
  `id` int NOT NULL,
  `match_id` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

