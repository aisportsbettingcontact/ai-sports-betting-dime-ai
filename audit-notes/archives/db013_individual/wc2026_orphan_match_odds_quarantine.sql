-- Individual dump: wc2026_orphan_match_odds_quarantine
-- Timestamp: 2026-07-08T04:15:35.472Z
-- Row count: 12

DROP TABLE IF EXISTS `wc2026_orphan_match_odds_quarantine`;
CREATE TABLE `wc2026_orphan_match_odds_quarantine` (
  `id` int NOT NULL AUTO_INCREMENT,
  `original_match_id` varchar(64) NOT NULL,
  `original_row_json` json NOT NULL,
  `reason` varchar(255) NOT NULL,
  `review_status` enum('PENDING','RESOLVED','DISCARDED') DEFAULT 'PENDING',
  `quarantined_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_original_match_id` (`original_match_id`),
  KEY `idx_review_status` (`review_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=30001;

INSERT INTO `wc2026_orphan_match_odds_quarantine` (`id`,`original_match_id`,`original_row_json`,`reason`,`review_status`,`quarantined_at`,`resolved_at`) VALUES
(1,'wc26-gs-760438','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(2,'wc26-gs-760439','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(3,'wc26-gs-760440','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(4,'wc26-gs-760441','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(5,'wc26-gs-760453','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(6,'wc26-gs-760451','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(7,'wc26-gs-760450','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(8,'wc26-gs-760452','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(9,'wc26-gs-760456','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(10,'wc26-gs-760457','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(11,'wc26-gs-760454','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL),
(12,'wc26-gs-760455','[object Object]','ESPN_ID_NOT_IN_WC2026_MATCHES','PENDING','2026-07-06 11:08:16',NULL);
