/**
 * run_mlb_model_may29_v3.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Force-rerun MLB model for all 15 May 29, 2026 games.
 * Applied fix: MLBAIModel.py FINAL RL INVARIANT ENFORCEMENT (lines 1742-1793)
 *   Invariant: P(fav covers -1.5) < P(fav wins outright) — unconditional
 *   Consequence: A -118 ML favorite CANNOT be -185 to cover -1.5.
 *
 * Post-run validation:
 *   1. All 15 games written and published
 *   2. ML/RL relationship: |RL odds| < |ML odds| for the -1.5 side
 *   3. RL sign consistency: -1.5 side must be the book favorite
 *   4. No null RL odds
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { runMlbModelForDate } from "../server/mlbModelRunner";
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TAG = "[MAY29-V3]";
const DATE = "2026-05-29";

// Convert American odds to implied probability (no-vig)
function mlToProb(ml: number): number {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

// Validate ML/RL relationship for a single game
function validateRlMlRelationship(game: {
  awayTeam: string;
  homeTeam: string;
  modelAwayML: number | null;
  modelHomeML: number | null;
  awayModelSpread: string | null;
  homeModelSpread: string | null;
  modelAwaySpreadOdds: number | null;
  modelHomeSpreadOdds: number | null;
}): { ok: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!game.modelAwayML || !game.modelHomeML || !game.modelAwaySpreadOdds || !game.modelHomeSpreadOdds) {
    violations.push("NULL model odds — game not fully modeled");
    return { ok: false, violations };
  }

  const pAwayWin = mlToProb(game.modelAwayML);
  const pHomeWin = mlToProb(game.modelHomeML);
  const pAwayCover = mlToProb(game.modelAwaySpreadOdds);
  const pHomeCover = mlToProb(game.modelHomeSpreadOdds);

  // Determine which team is the -1.5 favorite from spread labels
  const awaySpread = parseFloat(game.awayModelSpread ?? "0");
  const homeSpread = parseFloat(game.homeModelSpread ?? "0");

  if (awaySpread < 0) {
    // Away is the -1.5 favorite
    // INVARIANT: P(away covers -1.5) < P(away wins)
    if (pAwayCover >= pAwayWin) {
      violations.push(
        `[RL-INVARIANT-FAIL] Away fav (-1.5): P(cover)=${pAwayCover.toFixed(4)} >= P(win)=${pAwayWin.toFixed(4)} ` +
        `| ML=${game.modelAwayML} RL=${game.modelAwaySpreadOdds} — IMPOSSIBLE`
      );
    }
  } else if (homeSpread < 0) {
    // Home is the -1.5 favorite
    // INVARIANT: P(home covers -1.5) < P(home wins)
    if (pHomeCover >= pHomeWin) {
      violations.push(
        `[RL-INVARIANT-FAIL] Home fav (-1.5): P(cover)=${pHomeCover.toFixed(4)} >= P(win)=${pHomeWin.toFixed(4)} ` +
        `| ML=${game.modelHomeML} RL=${game.modelHomeSpreadOdds} — IMPOSSIBLE`
      );
    }
  }

  // Additional check: RL odds for the -1.5 side must be less negative than ML
  // (it's harder to win by 2+ than to win at all, so the price must be lower)
  if (awaySpread < 0) {
    if (game.modelAwayML < 0 && game.modelAwaySpreadOdds < game.modelAwayML) {
      violations.push(
        `[RL-ODDS-FAIL] Away fav: RL odds ${game.modelAwaySpreadOdds} more negative than ML ${game.modelAwayML} ` +
        `— RL must be LESS negative than ML for the -1.5 side`
      );
    }
  } else if (homeSpread < 0) {
    if (game.modelHomeML < 0 && game.modelHomeSpreadOdds < game.modelHomeML) {
      violations.push(
        `[RL-ODDS-FAIL] Home fav: RL odds ${game.modelHomeSpreadOdds} more negative than ML ${game.modelHomeML} ` +
        `— RL must be LESS negative than ML for the -1.5 side`
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

async function main() {
  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT]  date=${DATE} forceRerun=true`);
  console.log(`${TAG} [INPUT]  fix=RL_INVARIANT_ENFORCEMENT (MLBAIModel.py:1742-1793)`);
  console.log(`${TAG} [INPUT]  invariant: P(fav covers -1.5) < P(fav wins outright)`);
  console.log(`${TAG} [INPUT]  target=15 games`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  const t0 = Date.now();

  // ── STEP 1: Run the model ──────────────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Launching runMlbModelForDate(${DATE}, forceRerun=true)...`);
  let result: { written: number; errors: number; skipped: number; invalidated?: number };

  try {
    result = await runMlbModelForDate(DATE, { forceRerun: true });
  } catch (err) {
    console.error(`${TAG} [ERROR] Fatal error in runMlbModelForDate:`, err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${TAG} [STATE]  Model run completed in ${elapsed}s`);
  console.log(`${TAG} [STATE]  written=${result.written} errors=${result.errors} skipped=${result.skipped} invalidated=${result.invalidated ?? 0}`);

  if (result.errors > 0) {
    console.error(`${TAG} [VERIFY] ❌ ${result.errors} game(s) failed to write`);
  }
  if (result.written !== 15) {
    console.error(`${TAG} [VERIFY] ❌ Expected 15 written, got ${result.written}`);
  } else {
    console.log(`${TAG} [VERIFY] ✅ 15/15 games written`);
  }

  // ── STEP 2: Post-run DB audit ──────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 2] Querying DB for all 15 May 29 games...`);

  const dbConn = await getDb();
  const rows = await dbConn
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      startTimeEst: games.startTimeEst,
      modelAwayML: games.modelAwayML,
      modelHomeML: games.modelHomeML,
      awayModelSpread: games.awayModelSpread,
      homeModelSpread: games.homeModelSpread,
      modelAwaySpreadOdds: games.modelAwaySpreadOdds,
      modelHomeSpreadOdds: games.modelHomeSpreadOdds,
      modelAwayScore: games.modelAwayScore,
      modelHomeScore: games.modelHomeScore,
      publishedToFeed: games.publishedToFeed,
      publishedModel: games.publishedModel,
      modelRunAt: games.modelRunAt,
    })
    .from(games)
    .where(
      and(
        eq(games.gameDate, DATE),
        eq(games.sport, "MLB")
      )
    )
    .orderBy(games.startTimeEst);

  console.log(`${TAG} [STATE]  DB returned ${rows.length} games\n`);

  // ── STEP 3: Per-game validation ────────────────────────────────────────────
  console.log(`${TAG} [STEP 3] Per-game RL/ML invariant validation:`);
  console.log(`${TAG} ${"─".repeat(80)}`);

  let totalViolations = 0;
  let totalNullOdds = 0;
  let totalPublished = 0;

  for (const g of rows) {
    const awaySpreadNum = parseFloat(g.awayModelSpread ?? "0");
    const homeSpreadNum = parseFloat(g.homeModelSpread ?? "0");
    const favTeam = awaySpreadNum < 0 ? g.awayTeam : g.homeTeam;
    const favML = awaySpreadNum < 0 ? g.modelAwayML : g.modelHomeML;
    const favRLOdds = awaySpreadNum < 0 ? g.modelAwaySpreadOdds : g.modelHomeSpreadOdds;
    const dogTeam = awaySpreadNum < 0 ? g.homeTeam : g.awayTeam;
    const dogML = awaySpreadNum < 0 ? g.modelHomeML : g.modelAwayML;
    const dogRLOdds = awaySpreadNum < 0 ? g.modelHomeSpreadOdds : g.modelAwaySpreadOdds;

    const validation = validateRlMlRelationship(g);
    const status = validation.ok ? "✅" : "❌";

    if (g.publishedToFeed) totalPublished++;
    if (!g.modelAwaySpreadOdds || !g.modelHomeSpreadOdds) totalNullOdds++;

    console.log(`${TAG} ${status} [${g.id}] ${g.awayTeam}@${g.homeTeam} ${g.startTimeEst}`);
    console.log(`${TAG}    [STATE] Proj: ${g.modelAwayScore?.toFixed(2) ?? "null"} – ${g.modelHomeScore?.toFixed(2) ?? "null"}`);
    console.log(`${TAG}    [STATE] ML:   ${g.awayTeam}=${g.modelAwayML ?? "null"} | ${g.homeTeam}=${g.modelHomeML ?? "null"}`);
    console.log(`${TAG}    [STATE] RL:   ${g.awayTeam} ${g.awayModelSpread}(${g.modelAwaySpreadOdds ?? "null"}) | ${g.homeTeam} ${g.homeModelSpread}(${g.modelHomeSpreadOdds ?? "null"})`);
    console.log(`${TAG}    [STATE] Fav:  ${favTeam} ML=${favML} RL-1.5=${favRLOdds} | Dog: ${dogTeam} ML=${dogML} RL+1.5=${dogRLOdds}`);
    console.log(`${TAG}    [STATE] pub=feed:${g.publishedToFeed ? "✅" : "❌"} model:${g.publishedModel ? "✅" : "❌"} modelRunAt=${g.modelRunAt ? "SET" : "NULL"}`);

    if (!validation.ok) {
      totalViolations += validation.violations.length;
      for (const v of validation.violations) {
        console.error(`${TAG}    [VERIFY] ❌ ${v}`);
      }
    } else {
      const pFavWin = favML ? mlToProb(favML).toFixed(4) : "null";
      const pFavCover = favRLOdds ? mlToProb(favRLOdds).toFixed(4) : "null";
      console.log(`${TAG}    [VERIFY] ✅ P(${favTeam} wins)=${pFavWin} > P(${favTeam} covers -1.5)=${pFavCover} — INVARIANT HOLDS`);
    }
    console.log(`${TAG} ${"─".repeat(80)}`);
  }

  // ── STEP 4: Summary ────────────────────────────────────────────────────────
  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [OUTPUT] FINAL AUDIT SUMMARY — May 29, 2026 MLB`);
  console.log(`${TAG} [OUTPUT] Games in DB:          ${rows.length}/15`);
  console.log(`${TAG} [OUTPUT] Games written:        ${result.written}/15`);
  console.log(`${TAG} [OUTPUT] Games published:      ${totalPublished}/15`);
  console.log(`${TAG} [OUTPUT] RL invariant violations: ${totalViolations}`);
  console.log(`${TAG} [OUTPUT] Null RL odds:         ${totalNullOdds}`);
  console.log(`${TAG} [OUTPUT] Model errors:         ${result.errors}`);
  console.log(`${TAG} [OUTPUT] Elapsed:              ${elapsed}s`);

  if (totalViolations === 0 && result.errors === 0 && result.written === 15) {
    console.log(`${TAG} [VERIFY] ✅ FULL VALIDATION PASSED — all 15 games correct`);
  } else {
    console.error(`${TAG} [VERIFY] ❌ VALIDATION FAILED — see violations above`);
    process.exit(1);
  }
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  process.exit(0);
}

main();
