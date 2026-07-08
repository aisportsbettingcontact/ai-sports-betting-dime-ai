-- Individual dump: wc2026_mp_dedup_archive
-- Timestamp: 2026-07-08T04:15:34.324Z
-- Row count: 14

DROP TABLE IF EXISTS `wc2026_mp_dedup_archive`;
CREATE TABLE `wc2026_mp_dedup_archive` (
  `id` bigint DEFAULT NULL,
  `match_id` varchar(64) DEFAULT NULL,
  `model_version` varchar(64) DEFAULT NULL,
  `modeled_at` datetime DEFAULT NULL,
  `archived_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `archive_reason` varchar(64) DEFAULT 'duplicate_dedup'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT INTO `wc2026_mp_dedup_archive` (`id`,`match_id`,`model_version`,`modeled_at`,`archived_at`,`archive_reason`) VALUES
(33,'wc26-g-035','v4.0-recal-june20','2026-06-20 06:50:13','2026-07-06 10:15:21','duplicate_dedup'),
(34,'wc26-g-033','v4.0-recal-june20','2026-06-20 06:50:13','2026-07-06 10:15:21','duplicate_dedup'),
(35,'wc26-g-034','v4.0-recal-june20','2026-06-20 06:50:14','2026-07-06 10:15:21','duplicate_dedup'),
(36,'wc26-g-036','v4.0-recal-june20','2026-06-20 06:50:14','2026-07-06 10:15:21','duplicate_dedup'),
(2264768,'wc26-g-061','v4.2-corrected-june25-27','2026-06-24 05:57:27','2026-07-06 10:15:21','duplicate_dedup'),
(2264769,'wc26-g-062','v4.2-corrected-june25-27','2026-06-24 05:57:27','2026-07-06 10:15:21','duplicate_dedup'),
(2264770,'wc26-g-063','v4.2-corrected-june25-27','2026-06-24 05:57:27','2026-07-06 10:15:21','duplicate_dedup'),
(2264771,'wc26-g-064','v4.2-corrected-june25-27','2026-06-24 05:57:28','2026-07-06 10:15:21','duplicate_dedup'),
(2264772,'wc26-g-065','v4.2-corrected-june25-27','2026-06-24 05:57:28','2026-07-06 10:15:21','duplicate_dedup'),
(2264773,'wc26-g-066','v4.2-corrected-june25-27','2026-06-24 05:57:28','2026-07-06 10:15:21','duplicate_dedup'),
(2324762,'wc26-r16-089','v18.0-KO26-RECALIBRATED-16MATCH-R16','2026-07-04 12:29:58','2026-07-06 10:15:21','duplicate_dedup'),
(2324763,'wc26-r16-090','v18.0-KO26-RECALIBRATED-16MATCH-R16','2026-07-04 12:29:58','2026-07-06 10:15:21','duplicate_dedup'),
(2324764,'wc26-r16-089','v18.0-KO26-RECALIBRATED-16MATCH-R16','2026-07-04 12:30:17','2026-07-06 10:15:21','duplicate_dedup'),
(2324765,'wc26-r16-090','v18.0-KO26-RECALIBRATED-16MATCH-R16','2026-07-04 12:30:17','2026-07-06 10:15:21','duplicate_dedup');
