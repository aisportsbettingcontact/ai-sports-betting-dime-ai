-- EVIDENCE EXTRACTION QUERIES FOR TIER 2 VALIDATION
-- Each query is labeled and will be run individually

-- Q1: All 60 remapped rows (page 1: rows 1-30)
SELECT CONCAT(o.match_id, '|wc26-gs-', m.provider_match_id, '|', m.provider_match_id, '|', m.mapping_method, '|', CAST(m.mapping_confidence AS CHAR)) AS remap_data FROM wc2026MatchOdds o INNER JOIN wc2026_provider_match_map m ON o.match_id = m.canonical_match_id WHERE m.provider = 'ESPN' ORDER BY m.provider_match_id;

-- Q2: All 12 quarantined rows
SELECT id, original_match_id, reason, review_status FROM wc2026_orphan_match_odds_quarantine ORDER BY id;

-- Q3: All 63 no-vig rows
SELECT match_id, market, selection, book_odds, raw_implied_prob, no_vig_prob, market_hold FROM wc2026_market_no_vig ORDER BY match_id, selection;

-- Q4: All 54 edge rows
SELECT match_id, model_version, market, selection, model_prob, no_vig_prob, edge, edge_pct, fair_odds, edge_status FROM wc2026_market_edges ORDER BY match_id, selection;

-- Q5: All 28 BET recommendations
SELECT match_id, model_version, market, selection, status, reason, model_prob, no_vig_prob, edge, edge_pct, fair_odds, book_odds FROM wc2026_recommendations WHERE status = 'BET' ORDER BY edge_pct DESC;

-- Q6: All 26 PASS recommendations
SELECT match_id, model_version, market, selection, status, reason, model_prob, no_vig_prob, edge, edge_pct, fair_odds, book_odds FROM wc2026_recommendations WHERE status = 'PASS' ORDER BY edge_pct;

-- Q7: NO_MARKET count by match
SELECT match_id, model_version, COUNT(*) AS selections FROM wc2026_recommendations WHERE status = 'NO_MARKET' GROUP BY match_id, model_version ORDER BY match_id;
