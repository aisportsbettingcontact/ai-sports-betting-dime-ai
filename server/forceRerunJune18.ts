/**
 * forceRerunJune18.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Force-rerun the MLB model for all 9 June 18, 2026 games.
 * 
 * Execution spec:
 *   - 400,000 Monte Carlo simulations per game (SIMULATIONS=400_000 in MLBAIModel.py)
 *   - forceRerun=true — all games re-modeled regardless of modelRunAt
 *   - Full scope: Full Game ML/RL/O/U, F5, NRFI/YRFI, K-Props, HR Props
 *   - Uses 2026 stats: mlb_pitcher_stats, mlb_bullpen_stats, mlb_park_factors
 *   - Pitchers from mlb_lineups (Rotowire): all 9 games pre-validated
 *   - Lineups from mlb_lineups (Rotowire): all 9 games have 9-batter lineups
 *   - Weather: BOS(74°F/21mph Out), PHI(89°F/20mph Out), NYY(86°F/16mph Out),
 *              ATL(75°F/9mph Out), KC(78°F/5mph L-R), LAA(82°F/13mph)
 *              MIL/TEX/SEA: Dome
 * 
 * Validation gates:
 *   - All 9 games must have modelRunAt set after run
 *   - All 9 games must have modelAwayScore, modelHomeScore populated
 *   - All 9 games must have spreadEdge, totalEdge populated
 *   - NRFI/YRFI, F5, K-Props, HR Props must be populated
 * 
 * Run: npx tsx server/forceRerunJune18.ts
 * 
 * ─── Logging format ──────────────────────────────────────────────────────────
 *   [ForceRerunJune18] [INPUT]  → pre-run state
 *   [ForceRerunJune18] [STEP]   → operation
 *   [ForceRerunJune18] [STATE]  → intermediate
 *   [ForceRerunJune18] [OUTPUT] → result
 *   [ForceRerunJune18] [VERIFY] → PASS/FAIL + reason
 */
import mysql from 'mysql2/promise';
import { runMlbModelForDate } from "./mlbModelRunner";

const TAG = "[ForceRerunJune18]";
const DATE_STR = "2026-06-18";

async function preRunAudit(conn: mysql.Connection): Promise<void> {
  console.log(`${TAG} [INPUT] ══════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] PRE-RUN AUDIT — ${DATE_STR}`);
  
  const [games] = await conn.execute(`
    SELECT id, awayTeam, homeTeam, awayStartingPitcher, homeStartingPitcher,
           awayML, homeML, bookTotal, awayRunLine, awayRunLineOdds, homeRunLineOdds,
           modelRunAt
    FROM games 
    WHERE gameDate = '${DATE_STR}' AND sport = 'MLB'
    ORDER BY startTimeEst
  `) as [any[], any];
  
  console.log(`${TAG} [INPUT] Games found: ${games.length}`);
  for (const g of games) {
    console.log(`${TAG} [INPUT] id=${g.id} ${g.awayTeam}@${g.homeTeam} | awayP="${g.awayStartingPitcher}" homeP="${g.homeStartingPitcher}" | ML=${g.awayML}/${g.homeML} total=${g.bookTotal} rl=${g.awayRunLine}(${g.awayRunLineOdds}/${g.homeRunLineOdds}) | modelRunAt=${g.modelRunAt ? 'SET' : 'NULL'}`);
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
  
  console.log(`${TAG} [INPUT] Lineups found: ${lineups.length}/9`);
  for (const l of lineups) {
    console.log(`${TAG} [INPUT] gameId=${l.gameId} | awayP="${l.awayPitcherName}"(${l.awayPitcherHand},mlbam=${l.awayPitcherMlbamId}) homeP="${l.homePitcherName}"(${l.homePitcherHand},mlbam=${l.homePitcherMlbamId}) | awayConf=${l.awayLineupConfirmed} homeConf=${l.homeLineupConfirmed} | umpire="${l.umpire}" temp="${l.weatherTemp}" wind="${l.weatherWind}" dome=${l.weatherDome}`);
  }
  
  console.log(`${TAG} [INPUT] ══════════════════════════════════════════════`);
}

async function postRunValidation(conn: mysql.Connection): Promise<{ passed: boolean; issues: string[] }> {
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
           awayStartingPitcher, homeStartingPitcher
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
    } else {
      console.error(`${TAG} [VERIFY] FAIL id=${g.id} ${gameTag}: ${gameIssues.join(', ')}`);
      issues.push(...gameIssues.map(i => `${gameTag}: ${i}`));
    }
  }
  
  const passed = passCount === 9 && issues.length === 0;
  console.log(`${TAG} [VERIFY] ══════════════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] ${passed ? 'PASS' : 'FAIL'} — ${passCount}/9 games fully modeled`);
  if (issues.length > 0) {
    console.error(`${TAG} [VERIFY] Issues (${issues.length}):`);
    for (const issue of issues) console.error(`  - ${issue}`);
  }
  
  return { passed, issues };
}

async function main() {
  console.log(`${TAG} ══════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] JUNE 18, 2026 MLB MODEL FORCE-RERUN`);
  console.log(`${TAG} [INPUT] Date: ${DATE_STR}`);
  console.log(`${TAG} [INPUT] Games: 9`);
  console.log(`${TAG} [INPUT] Simulations: 400,000 per game`);
  console.log(`${TAG} [INPUT] Scope: Full Game ML/RL/O/U + F5 + NRFI/YRFI + K-Props + HR Props`);
  console.log(`${TAG} [INPUT] forceRerun=true`);
  console.log(`${TAG} ══════════════════════════════════════════════`);
  
  const conn = await (await import('mysql2/promise')).createConnection(process.env.DATABASE_URL!);
  
  // Pre-run audit
  await preRunAudit(conn);
  
  console.log(`${TAG} [STEP] Starting model run for ${DATE_STR}...`);
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
    
    // Post-run validation
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
    
    console.log(`${TAG} ══════════════════════════════════════════════`);
    console.log(`${TAG} [PASS] ${summary.written}/9 games modeled, validated, and published to feed`);
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
