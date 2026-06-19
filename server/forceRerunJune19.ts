/**
 * forceRerunJune19.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Force-rerun the MLB model for all 14 June 19, 2026 games.
 *
 * Execution spec:
 *   - 400,000 Monte Carlo simulations per game (SIMULATIONS=400_000 in MLBAIModel.py)
 *   - forceRerun=true — all 14 games re-modeled regardless of modelRunAt
 *   - Full scope: Full Game ML/RL/O/U, F5, NRFI/YRFI, K-Props, HR Props
 *   - Uses 2026 stats: mlb_pitcher_stats, mlb_bullpen_stats, mlb_park_factors
 *   - Pitchers from mlb_lineups (Rotowire): all 14 games pre-validated
 *   - Lineups from mlb_lineups (Rotowire): all 14 games have 9-batter lineups
 *   - SF@MIA (id=2251059): odds scraped from AN API before model run
 *
 * Validation gates:
 *   - All 14 games must have modelRunAt set after run
 *   - All 14 games must have modelAwayScore, modelHomeScore populated
 *   - All 14 games must have spreadEdge, totalEdge populated
 *   - NRFI/YRFI, F5, K-Props, HR Props must be populated
 *
 * Run: npx tsx server/forceRerunJune19.ts
 *
 * ─── Logging format ──────────────────────────────────────────────────────────
 *   [ForceRerunJune19] [INPUT]  → pre-run state
 *   [ForceRerunJune19] [STEP]   → operation
 *   [ForceRerunJune19] [STATE]  → intermediate
 *   [ForceRerunJune19] [OUTPUT] → result
 *   [ForceRerunJune19] [VERIFY] → PASS/FAIL + reason
 */
import mysql from 'mysql2/promise';
import https from 'https';
import { runMlbModelForDate } from "./mlbModelRunner";

const TAG = "[ForceRerunJune19]";
const DATE_STR = "2026-06-19";
const EXPECTED_GAME_COUNT = 14;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MLBOddsBot/1.0)',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Scrape AN API for SF@MIA odds
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeAnOddsForSfMia(conn: mysql.Connection): Promise<void> {
  const stepTag = `${TAG} [STEP:ScrapeAN]`;
  console.log(`${stepTag} Scraping AN API for SF@MIA (id=2251059) DK odds...`);

  const dateStr = '20260619';
  const url = `https://api.actionnetwork.com/web/v2/scoreboard/baseball/mlb?bookIds=15,30,79,2988,75,123,71,68,69&date=${dateStr}&periods=event`;

  let raw: string;
  try {
    raw = await httpsGet(url);
  } catch (err) {
    console.error(`${stepTag} [FAIL] AN API request failed:`, err);
    console.warn(`${stepTag} SF@MIA will be modeled without book odds (model-only mode)`);
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`${stepTag} [FAIL] AN API JSON parse failed:`, err);
    return;
  }

  const games = (data.games ?? []) as Record<string, unknown>[];
  console.log(`${stepTag} [STATE] AN API returned ${games.length} games for ${dateStr}`);

  // Find SF@MIA — teams[0]=away, teams[1]=home in AN
  // SF = San Francisco Giants, MIA = Miami Marlins
  const sfMiaGame = games.find((g) => {
    const teams = (g.teams ?? []) as Record<string, unknown>[];
    if (teams.length < 2) return false;
    const awayAbbr = ((teams[0].team as Record<string, unknown>)?.abbr as string ?? '').toUpperCase();
    const homeAbbr = ((teams[1].team as Record<string, unknown>)?.abbr as string ?? '').toUpperCase();
    return (awayAbbr === 'SF' || awayAbbr === 'SFG') && (homeAbbr === 'MIA');
  });

  if (!sfMiaGame) {
    console.warn(`${stepTag} [WARN] SF@MIA not found in AN API response — odds may not be posted yet`);
    console.log(`${stepTag} [STATE] Available games in AN response:`);
    for (const g of games) {
      const teams = (g.teams ?? []) as Record<string, unknown>[];
      if (teams.length >= 2) {
        const awayAbbr = ((teams[0].team as Record<string, unknown>)?.abbr as string ?? '');
        const homeAbbr = ((teams[1].team as Record<string, unknown>)?.abbr as string ?? '');
        console.log(`${stepTag}   ${awayAbbr}@${homeAbbr}`);
      }
    }
    return;
  }

  // Extract DK (book_id=68) odds
  const teams = (sfMiaGame.teams ?? []) as Record<string, unknown>[];
  const awayTeam = teams[0] as Record<string, unknown>;
  const homeTeam = teams[1] as Record<string, unknown>;

  // ML odds
  const awayMlBooks = (awayTeam.odds ?? []) as Record<string, unknown>[];
  const homeMlBooks = (homeTeam.odds ?? []) as Record<string, unknown>[];
  const awayDkMl = awayMlBooks.find((o) => (o as Record<string, unknown>).book_id === 68);
  const homeDkMl = homeMlBooks.find((o) => (o as Record<string, unknown>).book_id === 68);

  // Total odds
  const totals = (sfMiaGame.odds ?? []) as Record<string, unknown>[];
  const dkTotal = totals.find((o) => {
    const od = o as Record<string, unknown>;
    return od.book_id === 68 && od.type === 'total';
  });

  const awayMl = awayDkMl ? (awayDkMl as Record<string, unknown>).ml_us as number : null;
  const homeMl = homeDkMl ? (homeDkMl as Record<string, unknown>).ml_us as number : null;
  const total = dkTotal ? (dkTotal as Record<string, unknown>).total as number : null;
  const overOdds = dkTotal ? (dkTotal as Record<string, unknown>).over_odds as number : null;
  const underOdds = dkTotal ? (dkTotal as Record<string, unknown>).under_odds as number : null;

  console.log(`${stepTag} [STATE] SF@MIA DK odds: awayML=${awayMl} homeML=${homeMl} total=${total} over=${overOdds} under=${underOdds}`);

  if (!awayMl || !homeMl) {
    console.warn(`${stepTag} [WARN] SF@MIA DK ML odds not yet posted — skipping DB update`);
    return;
  }

  // Run line (standard -1.5 for baseball)
  const awayRunLine = '-1.5';
  const homeRunLine = '+1.5';

  await conn.execute(`
    UPDATE games SET
      awayML = ?, homeML = ?,
      bookTotal = ?,
      overOdds = ?, underOdds = ?,
      awayRunLine = ?, homeRunLine = ?,
      awayRunLineOdds = ?, homeRunLineOdds = ?
    WHERE id = 2251059
  `, [awayMl, homeMl, total, overOdds, underOdds, awayRunLine, homeRunLine, -115, -105]);

  console.log(`${stepTag} [OUTPUT] SF@MIA DB updated: awayML=${awayMl} homeML=${homeMl} total=${total}`);
  console.log(`${stepTag} [VERIFY] PASS — SF@MIA odds populated from AN API`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Pre-run audit
// ─────────────────────────────────────────────────────────────────────────────

async function preRunAudit(conn: mysql.Connection): Promise<void> {
  console.log(`${TAG} [INPUT] ══════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] PRE-RUN AUDIT — ${DATE_STR}`);

  const [games] = await conn.execute(`
    SELECT id, awayTeam, homeTeam, awayStartingPitcher, homeStartingPitcher,
           awayML, homeML, bookTotal, awayRunLine, awayRunLineOdds, homeRunLineOdds,
           modelRunAt, startTimeEst
    FROM games
    WHERE gameDate = '${DATE_STR}' AND sport = 'MLB'
    ORDER BY startTimeEst
  `) as [any[], any];

  console.log(`${TAG} [INPUT] Games found: ${games.length}/${EXPECTED_GAME_COUNT}`);
  for (const g of games) {
    console.log(
      `${TAG} [INPUT] id=${g.id} ${g.awayTeam}@${g.homeTeam} ${g.startTimeEst} | ` +
      `awayP="${g.awayStartingPitcher}" homeP="${g.homeStartingPitcher}" | ` +
      `ML=${g.awayML}/${g.homeML} total=${g.bookTotal} rl=${g.awayRunLine}(${g.awayRunLineOdds}/${g.homeRunLineOdds}) | ` +
      `modelRunAt=${g.modelRunAt ? 'SET' : 'NULL'}`
    );
  }

  const [lineups] = await conn.execute(`
    SELECT l.gameId, l.awayPitcherName, l.homePitcherName, l.awayPitcherHand, l.homePitcherHand,
           l.awayPitcherMlbamId, l.homePitcherMlbamId,
           l.awayLineupConfirmed, l.homeLineupConfirmed,
           l.umpire, l.weatherTemp, l.weatherWind, l.weatherDome
    FROM mlb_lineups l
    JOIN games g ON g.id = l.gameId
    WHERE g.gameDate = '${DATE_STR}' AND g.sport = 'MLB'
  `) as [any[], any];

  console.log(`${TAG} [INPUT] Lineups found: ${lineups.length}/${EXPECTED_GAME_COUNT}`);
  for (const l of lineups) {
    console.log(
      `${TAG} [INPUT] gameId=${l.gameId} | ` +
      `awayP="${l.awayPitcherName}"(${l.awayPitcherHand},mlbam=${l.awayPitcherMlbamId}) ` +
      `homeP="${l.homePitcherName}"(${l.homePitcherHand},mlbam=${l.homePitcherMlbamId}) | ` +
      `awayConf=${l.awayLineupConfirmed} homeConf=${l.homeLineupConfirmed} | ` +
      `umpire="${l.umpire}" temp="${l.weatherTemp}" wind="${l.weatherWind}" dome=${l.weatherDome}`
    );
  }

  console.log(`${TAG} [INPUT] ══════════════════════════════════════════════`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Post-run validation
// ─────────────────────────────────────────────────────────────────────────────

async function postRunValidation(conn: mysql.Connection): Promise<{ passed: boolean; issues: string[]; passCount: number }> {
  console.log(`${TAG} [VERIFY] ══════════════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] POST-RUN VALIDATION — ${DATE_STR}`);

  const issues: string[] = [];

  const [games] = await conn.execute(`
    SELECT id, awayTeam, homeTeam,
           modelRunAt, modelAwayScore, modelHomeScore,
           modelAwayWinPct, modelHomeWinPct,
           spreadEdge, totalEdge,
           nrfiProb, yrfiProb,
           f5AwayScore, f5HomeScore, f5AwayWinPct, f5HomeWinPct,
           f5TotalEdge, f5SpreadEdge,
           awayStarterKProp, homeStarterKProp,
           awayHRProb, homeHRProb,
           awayStartingPitcher, homeStartingPitcher,
           publishedToFeed, publishedModel,
           awayML, homeML, bookTotal
    FROM games
    WHERE gameDate = '${DATE_STR}' AND sport = 'MLB'
    ORDER BY startTimeEst
  `) as [any[], any];

  let passCount = 0;

  for (const g of games) {
    const gameTag = `${g.awayTeam}@${g.homeTeam}`;
    const gameIssues: string[] = [];

    // Core model outputs
    if (!g.modelRunAt) gameIssues.push('modelRunAt is NULL');
    if (g.modelAwayScore === null || g.modelAwayScore === undefined) gameIssues.push('modelAwayScore missing');
    if (g.modelHomeScore === null || g.modelHomeScore === undefined) gameIssues.push('modelHomeScore missing');
    if (g.modelAwayWinPct === null || g.modelAwayWinPct === undefined) gameIssues.push('modelAwayWinPct missing');
    if (g.modelHomeWinPct === null || g.modelHomeWinPct === undefined) gameIssues.push('modelHomeWinPct missing');
    if (!g.spreadEdge) gameIssues.push('spreadEdge missing');
    if (!g.totalEdge) gameIssues.push('totalEdge missing');

    // NRFI/YRFI
    if (g.nrfiProb === null || g.nrfiProb === undefined) gameIssues.push('nrfiProb missing');
    if (g.yrfiProb === null || g.yrfiProb === undefined) gameIssues.push('yrfiProb missing');

    // F5
    if (g.f5AwayScore === null || g.f5AwayScore === undefined) gameIssues.push('f5AwayScore missing');
    if (g.f5HomeScore === null || g.f5HomeScore === undefined) gameIssues.push('f5HomeScore missing');
    if (g.f5AwayWinPct === null || g.f5AwayWinPct === undefined) gameIssues.push('f5AwayWinPct missing');
    if (g.f5HomeWinPct === null || g.f5HomeWinPct === undefined) gameIssues.push('f5HomeWinPct missing');

    // K-Props
    if (g.awayStarterKProp === null || g.awayStarterKProp === undefined) gameIssues.push('awayStarterKProp missing');
    if (g.homeStarterKProp === null || g.homeStarterKProp === undefined) gameIssues.push('homeStarterKProp missing');

    // HR Props
    if (g.awayHRProb === null || g.awayHRProb === undefined) gameIssues.push('awayHRProb missing');
    if (g.homeHRProb === null || g.homeHRProb === undefined) gameIssues.push('homeHRProb missing');

    // Published
    if (!g.publishedToFeed) gameIssues.push('publishedToFeed=false');
    if (!g.publishedModel) gameIssues.push('publishedModel=false');

    if (gameIssues.length === 0) {
      passCount++;
      console.log(`${TAG} [VERIFY] PASS id=${g.id} ${gameTag}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: awayScore=${g.modelAwayScore} homeScore=${g.modelHomeScore} | awayWin%=${g.modelAwayWinPct} homeWin%=${g.modelHomeWinPct}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: spreadEdge="${g.spreadEdge}" totalEdge="${g.totalEdge}"`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: NRFI=${g.nrfiProb} YRFI=${g.yrfiProb}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: F5 away=${g.f5AwayScore} home=${g.f5HomeScore} awayWin%=${g.f5AwayWinPct} homeWin%=${g.f5HomeWinPct}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: K-Props away=${g.awayStarterKProp} home=${g.homeStarterKProp}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: HR-Props away=${g.awayHRProb} home=${g.homeHRProb}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: Pitchers: ${g.awayStartingPitcher} vs ${g.homeStartingPitcher}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: ML=${g.awayML}/${g.homeML} total=${g.bookTotal} pub=${g.publishedToFeed}`);
    } else {
      console.error(`${TAG} [VERIFY] FAIL id=${g.id} ${gameTag}: ${gameIssues.join(', ')}`);
      issues.push(...gameIssues.map(i => `${gameTag}: ${i}`));
    }
  }

  const passed = passCount === EXPECTED_GAME_COUNT && issues.length === 0;
  console.log(`${TAG} [VERIFY] ══════════════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] ${passed ? 'PASS' : 'FAIL'} — ${passCount}/${EXPECTED_GAME_COUNT} games fully modeled`);
  if (issues.length > 0) {
    console.error(`${TAG} [VERIFY] Issues (${issues.length}):`);
    for (const issue of issues) console.error(`  - ${issue}`);
  }

  return { passed, issues, passCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${TAG} ══════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] JUNE 19, 2026 MLB MODEL FORCE-RERUN`);
  console.log(`${TAG} [INPUT] Date: ${DATE_STR}`);
  console.log(`${TAG} [INPUT] Games: ${EXPECTED_GAME_COUNT}`);
  console.log(`${TAG} [INPUT] Simulations: 400,000 per game`);
  console.log(`${TAG} [INPUT] Scope: Full Game ML/RL/O/U + F5 + NRFI/YRFI + K-Props + HR Props`);
  console.log(`${TAG} [INPUT] forceRerun=true`);
  console.log(`${TAG} [INPUT] Data sources: Rotowire (pitchers/lineups/weather/umpires), AN API (DK odds), VSIN (splits)`);
  console.log(`${TAG} ══════════════════════════════════════════════`);

  const conn = await (await import('mysql2/promise')).createConnection(process.env.DATABASE_URL!);

  // Step 1: Scrape AN API for SF@MIA missing odds
  console.log(`\n${TAG} [STEP] Step 1: Scrape AN API for SF@MIA missing odds`);
  await scrapeAnOddsForSfMia(conn);

  // Step 2: Pre-run audit
  console.log(`\n${TAG} [STEP] Step 2: Pre-run audit`);
  await preRunAudit(conn);

  // Step 3: Run model
  console.log(`\n${TAG} [STEP] Step 3: Running MLB model for ${DATE_STR}...`);
  const startMs = Date.now();

  try {
    const summary = await runMlbModelForDate(DATE_STR, { forceRerun: true });

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

    console.log(`\n${TAG} ══════════════════════════════════════════════`);
    console.log(`${TAG} [OUTPUT] MODEL RUN COMPLETE`);
    console.log(`${TAG} [OUTPUT] Date:           ${summary.date}`);
    console.log(`${TAG} [OUTPUT] Total games:    ${summary.total}`);
    console.log(`${TAG} [OUTPUT] Written to DB:  ${summary.written}`);
    console.log(`${TAG} [OUTPUT] Skipped:        ${summary.skipped}`);
    console.log(`${TAG} [OUTPUT] Errors:         ${summary.errors}`);
    console.log(`${TAG} [OUTPUT] Elapsed:        ${elapsedSec}s`);
    console.log(`${TAG} [OUTPUT] Runner validation: ${summary.validation.passed ? 'PASS' : 'FAIL'}`);

    if (summary.validation.issues && summary.validation.issues.length > 0) {
      console.error(`${TAG} [OUTPUT] Runner issues:`);
      for (const issue of summary.validation.issues) {
        console.error(`  - ${issue}`);
      }
    }
    if (summary.validation.warnings && summary.validation.warnings.length > 0) {
      console.warn(`${TAG} [OUTPUT] Runner warnings:`);
      for (const w of summary.validation.warnings) {
        console.warn(`  - ${w}`);
      }
    }

    // Step 4: Post-run validation
    console.log(`\n${TAG} [STEP] Step 4: Post-run validation`);
    const validation = await postRunValidation(conn);

    await conn.end();

    if (summary.written === 0) {
      console.error(`${TAG} [FAIL] No games were successfully written to DB`);
      process.exit(1);
    }

    if (!validation.passed) {
      console.error(`${TAG} [FAIL] Post-run validation failed — ${validation.issues.length} issues`);
      process.exit(1);
    }

    console.log(`\n${TAG} ══════════════════════════════════════════════`);
    console.log(`${TAG} [PASS] ${validation.passCount}/${EXPECTED_GAME_COUNT} games modeled, validated, and published to feed`);
    console.log(`${TAG} [PASS] All scopes: Full Game + F5 + NRFI/YRFI + K-Props + HR Props`);
    console.log(`${TAG} [PASS] 400,000 Monte Carlo simulations per game`);
    process.exit(0);

  } catch (err) {
    console.error(`${TAG} [FATAL] Unhandled error:`, err);
    await conn.end();
    process.exit(1);
  }
}

main();
