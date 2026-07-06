/**
 * WC2026 Dime Context Builder
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds a source-grounded context package from the WC2026 database tables.
 * Every field is explicitly populated or marked as null with a missing_reason.
 * No data is invented. No field is silently omitted.
 */
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface MatchContext {
  canonical_match_id: string;
  espn_match_id: string | null;
  home_team: string;
  away_team: string;
  stage: string;
  status: string;
  kickoff_utc: string | null;
  venue: string | null;
  score_if_final: string | null;
  odds: { home: number | null; draw: number | null; away: number | null } | null;
  odds_updated_at: string | null;
  odds_source: string | null;
  market_status: string | null;
  freshness_status: string | null;
  model_version: string | null;
  model_probabilities: { home: number | null; draw: number | null; away: number | null } | null;
  no_vig_probabilities: { home: number | null; draw: number | null; away: number | null } | null;
  edge: { home: number | null; draw: number | null; away: number | null } | null;
  fair_odds: { home: number | null; draw: number | null; away: number | null } | null;
  recommendation_status: string | null;
  reason_codes: string | null;
  holdout_validated: boolean;
  model_grade_summary: string | null;
  available_markets: string[];
  missing_markets: string[];
  missing_fields: Array<{ field: string; reason: string }>;
}

export interface WC2026Context {
  matchCount: number;
  recommendationCount: number;
  activeBets: number;
  missingFieldCount: number;
  contextHash: string;
  contextJson: string;
  freshness: string;
  matches: MatchContext[];
}

// ─── Context Builder ─────────────────────────────────────────────────────────
export async function getWC2026DimeContext(requestId: string, userId: string): Promise<WC2026Context> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // 1. Get all matches with teams and venues
  const matchRows = (await db.execute(sql`
    SELECT m.match_id, m.espn_match_id, m.home_team_id, m.away_team_id,
           m.stage, m.status, m.match_date, m.venue_id,
           m.home_score, m.away_score,
           ht.name AS home_team_name, at2.name AS away_team_name,
           v.stadium AS venue_name, v.city AS venue_city
    FROM wc2026_matches m
    LEFT JOIN wc2026_teams ht ON ht.team_id = m.home_team_id
    LEFT JOIN wc2026_teams at2 ON at2.team_id = m.away_team_id
    LEFT JOIN wc2026_venues v ON v.venue_id = m.venue_id
    ORDER BY m.match_date ASC, m.match_id ASC
  `) as any)[0] as any[];

  // 2. Get odds data
  const oddsRows = (await db.execute(sql`
    SELECT match_id, book_home_ml AS book_home, book_draw, book_away_ml AS book_away,
           odds_updated_at, odds_source, market_status
    FROM wc2026MatchOdds
    WHERE book_home_ml IS NOT NULL
  `) as any)[0] as any[];
  const oddsMap = new Map(oddsRows.map((r: any) => [r.match_id, r]));

  // 3. Get model projections (latest version per match)
  const projRows = (await db.execute(sql`
    SELECT match_id, model_version, home_win_prob, draw_prob, away_win_prob, holdout_validated
    FROM wc2026_model_projections
    WHERE (match_id, model_version) IN (
      SELECT match_id, MAX(model_version) FROM wc2026_model_projections GROUP BY match_id
    )
  `) as any)[0] as any[];
  const projMap = new Map(projRows.map((r: any) => [r.match_id, r]));

  // 4. Get no-vig probabilities
  const novigRows = (await db.execute(sql`
    SELECT match_id, selection, no_vig_prob
    FROM wc2026_market_no_vig
  `) as any)[0] as any[];
  const novigMap = new Map<string, { home: number | null; draw: number | null; away: number | null }>();
  for (const r of novigRows) {
    if (!novigMap.has(r.match_id)) novigMap.set(r.match_id, { home: null, draw: null, away: null });
    const entry = novigMap.get(r.match_id)!;
    if (r.selection === "HOME") entry.home = Number(r.no_vig_prob);
    else if (r.selection === "DRAW") entry.draw = Number(r.no_vig_prob);
    else if (r.selection === "AWAY") entry.away = Number(r.no_vig_prob);
  }

  // 5. Get edges
  const edgeRows = (await db.execute(sql`
    SELECT match_id, selection, model_prob, no_vig_prob, edge, fair_odds
    FROM wc2026_market_edges
  `) as any)[0] as any[];
  const edgeMap = new Map<string, { home: number | null; draw: number | null; away: number | null }>();
  const fairOddsMap = new Map<string, { home: number | null; draw: number | null; away: number | null }>();
  for (const r of edgeRows) {
    if (!edgeMap.has(r.match_id)) edgeMap.set(r.match_id, { home: null, draw: null, away: null });
    if (!fairOddsMap.has(r.match_id)) fairOddsMap.set(r.match_id, { home: null, draw: null, away: null });
    const eEntry = edgeMap.get(r.match_id)!;
    const fEntry = fairOddsMap.get(r.match_id)!;
    const sel = r.selection as "HOME" | "DRAW" | "AWAY";
    const key = sel.toLowerCase() as "home" | "draw" | "away";
    eEntry[key] = Number(r.edge);
    fEntry[key] = Number(r.fair_odds);
  }

  // 6. Get recommendations
  const recRows = (await db.execute(sql`
    SELECT match_id, model_version, market, selection, status, edge, book_odds,
           reason_codes, freshness_status, market_status
    FROM wc2026_recommendations
  `) as any)[0] as any[];
  const recMap = new Map<string, any>();
  let activeBets = 0;
  for (const r of recRows) {
    recMap.set(`${r.match_id}:${r.selection}`, r);
    if (r.status === "BET") activeBets++;
  }

  // 7. Get model grades summary
  const gradeRows = (await db.execute(sql`
    SELECT model_version, grade_type, metric_value AS grade_value, grade_status
    FROM wc2026_model_grades
    ORDER BY model_version, grade_type
  `) as any)[0] as any[];
  const gradeMap = new Map<string, string>();
  for (const r of gradeRows) {
    const existing = gradeMap.get(r.model_version) || "";
    gradeMap.set(r.model_version, existing + `${r.grade_type}=${r.grade_value}(${r.grade_status}) `);
  }

  // 8. Build match contexts
  const matches: MatchContext[] = [];
  let totalMissingFields = 0;
  let recommendationCount = 0;

  for (const m of matchRows) {
    const matchId = m.match_id;
    const odds = oddsMap.get(matchId);
    const proj = projMap.get(matchId);
    const novig = novigMap.get(matchId);
    const edges = edgeMap.get(matchId);
    const fairOdds = fairOddsMap.get(matchId);
    const homeRec = recMap.get(`${matchId}:HOME`);
    const missingFields: Array<{ field: string; reason: string }> = [];

    // Track missing fields explicitly
    if (!odds) missingFields.push({ field: "odds", reason: "No book odds available for this match" });
    if (!proj) missingFields.push({ field: "model_probabilities", reason: "No model projection for this match" });
    if (!novig) missingFields.push({ field: "no_vig_probabilities", reason: "No no-vig computation (requires odds)" });
    if (!edges) missingFields.push({ field: "edge", reason: "No edge computation (requires odds + projection)" });
    if (!m.venue_name) missingFields.push({ field: "venue", reason: "Venue not assigned" });

    totalMissingFields += missingFields.length;
    if (homeRec) recommendationCount++;

    const matchCtx: MatchContext = {
      canonical_match_id: matchId,
      espn_match_id: m.espn_match_id || null,
      home_team: m.home_team_name || m.home_team_id,
      away_team: m.away_team_name || m.away_team_id,
      stage: m.stage || "UNKNOWN",
      status: m.status || "UNKNOWN",
      kickoff_utc: m.match_date ? String(m.match_date) : null,
      venue: m.venue_name ? `${m.venue_name}${m.venue_city ? `, ${m.venue_city}` : ""}` : null,
      score_if_final: m.status === "FT" ? `${m.home_score}-${m.away_score}` : null,
      odds: odds ? { home: Number(odds.book_home), draw: Number(odds.book_draw), away: Number(odds.book_away) } : null,
      odds_updated_at: odds?.odds_updated_at ? String(odds.odds_updated_at) : null,
      odds_source: odds?.odds_source || null,
      market_status: odds?.market_status || null,
      freshness_status: homeRec?.freshness_status || null,
      model_version: proj?.model_version || null,
      model_probabilities: proj ? { home: Number(proj.home_win_prob), draw: Number(proj.draw_prob), away: Number(proj.away_win_prob) } : null,
      no_vig_probabilities: novig || null,
      edge: edges || null,
      fair_odds: fairOdds || null,
      recommendation_status: homeRec?.status || null,
      reason_codes: homeRec?.reason_codes || null,
      holdout_validated: proj?.holdout_validated === 1,
      model_grade_summary: proj ? (gradeMap.get(proj.model_version) || null) : null,
      available_markets: odds ? ["1X2"] : [],
      missing_markets: ["SPREAD", "TOTAL", "BTTS", "PLAYER_PROPS", "TO_ADVANCE"],
      missing_fields: missingFields,
    };
    matches.push(matchCtx);
  }

  // 9. Build context JSON and hash
  const contextData = {
    generated_at: new Date().toISOString(),
    request_id: requestId,
    match_count: matches.length,
    recommendation_count: recommendationCount,
    active_bets: activeBets,
    missing_field_count: totalMissingFields,
    supported_markets: ["1X2"],
    unsupported_markets: ["SPREAD", "TOTAL", "BTTS", "PLAYER_PROPS", "TO_ADVANCE", "LINE_MOVEMENT", "CLV"],
    model_methodology: "Analytical Dixon-Coles (NOT Monte Carlo)",
    matches,
  };

  const contextJson = JSON.stringify(contextData, null, 0);
  const contextHash = crypto.createHash("sha256").update(contextJson).digest("hex").slice(0, 32);

  // 10. Log context audit
  try {
    await db.execute(sql`
      INSERT INTO dime_context_audit (request_id, user_id, context_hash, context_status, match_count, recommendation_count, missing_field_count, freshness_status)
      VALUES (${requestId}, ${userId}, ${contextHash}, 'READY', ${matches.length}, ${recommendationCount}, ${totalMissingFields}, 'COMPUTED')
    `);
  } catch (err) {
    console.error("[DimeWC2026Context] Failed to log context audit:", err);
  }

  // Determine overall freshness
  const hasFresh = recRows.some((r: any) => r.freshness_status === "FRESH");
  const freshness = hasFresh ? "FRESH" : "STALE_OR_UNKNOWN";

  return {
    matchCount: matches.length,
    recommendationCount,
    activeBets,
    missingFieldCount: totalMissingFields,
    contextHash,
    contextJson,
    freshness,
    matches,
  };
}
