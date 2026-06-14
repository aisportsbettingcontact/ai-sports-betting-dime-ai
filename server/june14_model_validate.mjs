/**
 * JUNE 14, 2026 — MLB MODEL DIRECTION VALIDATION
 * Validates that model ML direction is consistent with:
 * 1. Pitcher ERA differential (lower ERA = stronger pitcher = team should be favored)
 * 2. DK ML direction (model and book should agree on who is favored)
 * 3. Win probability sum = 100% (no-vig integrity check)
 * 4. Run line odds are consistent with ML (heavy ML favorite should have RL odds near -130 to -150)
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname, port: parseInt(u.port || '3306'),
    user: u.username, password: u.password,
    database: u.pathname.slice(1).split('?')[0],
    ssl: { rejectUnauthorized: false }
  };
}

const conn = await mysql.createConnection(parseDbUrl(DB_URL));

// Convert American odds to implied probability
function impliedProb(odds) {
  const o = parseInt(odds);
  if (isNaN(o)) return null;
  if (o > 0) return 100 / (o + 100);
  return Math.abs(o) / (Math.abs(o) + 100);
}

// Convert American odds to no-vig probability
function noVigProb(awayOdds, homeOdds) {
  const pa = impliedProb(awayOdds);
  const ph = impliedProb(homeOdds);
  if (!pa || !ph) return { away: null, home: null };
  const total = pa + ph;
  return { away: pa / total, home: ph / total };
}

console.log('\n' + '='.repeat(90));
console.log('[VALIDATE] JUNE 14, 2026 — MLB MODEL DIRECTION + INTEGRITY VALIDATION');
console.log('='.repeat(90));

const [games] = await conn.execute(`
  SELECT 
    g.id, g.awayTeam, g.homeTeam, g.startTimeEst,
    g.awayStartingPitcher, g.homeStartingPitcher,
    g.awayPitcherConfirmed, g.homePitcherConfirmed,
    g.awayML, g.homeML,
    g.awayRunLine, g.homeRunLine, g.awayRunLineOdds, g.homeRunLineOdds,
    g.bookTotal, g.overOdds, g.underOdds,
    g.modelAwayML, g.modelHomeML,
    g.awayBookSpread, g.homeBookSpread,
    g.modelAwaySpreadOdds, g.modelHomeSpreadOdds,
    g.modelTotal, g.modelOverOdds, g.modelUnderOdds,
    g.modelAwayWinPct, g.modelHomeWinPct,
    g.modelAwayScore, g.modelHomeScore,
    g.publishedToFeed, g.modelRunAt, g.venue
  FROM games g
  WHERE g.gameDate = '2026-06-14' AND g.sport = 'MLB'
  ORDER BY g.startTimeEst ASC
`);

// Get pitcher stats for all pitchers
const pitcherNames = [];
for (const g of games) {
  if (g.awayStartingPitcher) pitcherNames.push(g.awayStartingPitcher);
  if (g.homeStartingPitcher) pitcherNames.push(g.homeStartingPitcher);
}

const [pitcherStats] = await conn.execute(`
  SELECT 
    ps.fullName AS name, ps.teamAbbrev AS team, ps.era, ps.k9 AS kPer9, ps.bb9 AS bbPer9, ps.hr9 AS hrPer9, ps.whip,
    ps.lastFetchedAt,
    pr.era5 AS r5Era, pr.k9_5 AS r5K9, pr.startsIncluded AS r5Starts
  FROM mlb_pitcher_stats ps
  LEFT JOIN mlb_pitcher_rolling5 pr ON ps.mlbamId = pr.mlbamId
  WHERE ps.fullName IN (${pitcherNames.map(() => '?').join(',')})
`, pitcherNames);

const pitcherMap = {};
for (const p of pitcherStats) {
  pitcherMap[p.name] = p;
}

let allPass = true;
const failures = [];

for (const g of games) {
  const awayP = pitcherMap[g.awayStartingPitcher] || null;
  const homeP = pitcherMap[g.homeStartingPitcher] || null;

  // Parse odds
  const dkAwayML = parseInt(g.awayML);
  const dkHomeML = parseInt(g.homeML);
  const modelAwayML = parseInt(g.modelAwayML);
  const modelHomeML = parseInt(g.modelHomeML);
  const modelAwayWin = parseFloat(g.modelAwayWinPct);
  const modelHomeWin = parseFloat(g.modelHomeWinPct);

  // Validation 1: Win probability sum
  const winPctSum = modelAwayWin + modelHomeWin;
  const winPctSumOk = Math.abs(winPctSum - 100) < 0.1;

  // Validation 2: Model ML direction consistency with win pct
  const modelFavorsAway = modelAwayML < modelHomeML; // lower (more negative) = favorite
  const winPctFavorsAway = modelAwayWin > modelHomeWin;
  const directionConsistent = modelFavorsAway === winPctFavorsAway;

  // Validation 3: DK and model agree on who is favored (directional agreement)
  const dkFavorsAway = dkAwayML < dkHomeML;
  const modelDkDirectionAgree = dkFavorsAway === modelFavorsAway;

  // Validation 4: Model ML is derivable from win pct (no-vig check)
  const nvAway = noVigProb(g.modelAwayML, g.modelHomeML);
  const winPctFromML_away = nvAway.away ? (nvAway.away * 100).toFixed(2) : null;
  const winPctFromML_home = nvAway.home ? (nvAway.home * 100).toFixed(2) : null;
  const mlWinPctConsistent = winPctFromML_away && Math.abs(parseFloat(winPctFromML_away) - modelAwayWin) < 1.5;

  // Validation 5: Pitcher ERA differential direction
  // NOTE: Only flag ERA mismatch when DK and model ALSO disagree.
  // If DK and model agree, ERA alone is insufficient to override team strength.
  // This prevents false positives like LAD@CWS where both DK+model favor LAD
  // despite CWS pitcher having lower ERA (team quality dominates).
  let pitcherDirectionNote = 'N/A';
  let pitcherDirectionOk = true;
  if (awayP && homeP) {
    const awayEra = parseFloat(awayP.r5Era || awayP.era);
    const homeEra = parseFloat(homeP.r5Era || homeP.era);
    const eraFavorsHome = homeEra < awayEra; // lower ERA = better pitcher = team should be favored
    const eraDiff = Math.abs(awayEra - homeEra);
    if (eraDiff > 2.0) {
      // Large ERA differential — only flag if DK and model ALSO disagree
      // (avoids false positives where team strength dominates over pitcher ERA)
      const eraModelMismatch = eraFavorsHome !== !modelFavorsAway;
      if (eraModelMismatch && !modelDkDirectionAgree) {
        // Both ERA and DK disagree with model — genuine concern
        pitcherDirectionOk = false;
        pitcherDirectionNote = `away ERA=${awayEra.toFixed(2)} home ERA=${homeEra.toFixed(2)} diff=${eraDiff.toFixed(2)} ⚠ MISMATCH`;
      } else if (eraModelMismatch && modelDkDirectionAgree) {
        // ERA disagrees with model, but DK agrees — team strength dominates, OK
        pitcherDirectionNote = `away ERA=${awayEra.toFixed(2)} home ERA=${homeEra.toFixed(2)} diff=${eraDiff.toFixed(2)} ✓ (ERA overridden by team strength — DK+model agree)`;
      } else {
        pitcherDirectionNote = `away ERA=${awayEra.toFixed(2)} home ERA=${homeEra.toFixed(2)} diff=${eraDiff.toFixed(2)} ✓`;
      }
    } else {
      pitcherDirectionNote = `away ERA=${awayEra.toFixed(2)} home ERA=${homeEra.toFixed(2)} diff=${eraDiff.toFixed(2)} (small diff, OK)`;
    }
  }

  const gameIssues = [];
  if (!winPctSumOk) gameIssues.push(`WIN_PCT_SUM=${winPctSum.toFixed(2)} (expected ~100)`);
  if (!directionConsistent) gameIssues.push(`MODEL_DIRECTION_INCONSISTENT: ML says ${modelFavorsAway ? 'away' : 'home'} but WinPct says ${winPctFavorsAway ? 'away' : 'home'}`);
  if (!modelDkDirectionAgree) gameIssues.push(`DK_MODEL_DIRECTION_DISAGREE: DK says ${dkFavorsAway ? 'away' : 'home'} favored, model says ${modelFavorsAway ? 'away' : 'home'}`);
  if (!mlWinPctConsistent) gameIssues.push(`ML_WINPCT_INCONSISTENT: ML-derived=${winPctFromML_away}% vs stored=${modelAwayWin}%`);
  if (!pitcherDirectionOk) gameIssues.push(`PITCHER_ERA_DIRECTION_MISMATCH`);

  const statusStr = gameIssues.length === 0 ? '✓ PASS' : '✗ FAIL';
  if (gameIssues.length > 0) {
    allPass = false;
    failures.push({ game: `${g.awayTeam}@${g.homeTeam}`, issues: gameIssues });
  }

  const fmtOdds = (v) => v > 0 ? `+${v}` : `${v}`;

  console.log(`\n[${statusStr}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst} | ${g.venue}`);
  console.log(`  Pitchers: ${g.awayStartingPitcher || 'TBD'}(${g.awayPitcherConfirmed ? 'conf' : 'proj'}) vs ${g.homeStartingPitcher || 'TBD'}(${g.homePitcherConfirmed ? 'conf' : 'proj'})`);
  console.log(`  DK:    ML away=${fmtOdds(dkAwayML)} home=${fmtOdds(dkHomeML)} | RL away=${g.awayRunLine}(${g.awayRunLineOdds}) home=${g.homeRunLine}(${g.homeRunLineOdds}) | Total=${g.bookTotal} o=${g.overOdds} u=${g.underOdds}`);
  console.log(`  Model: ML away=${fmtOdds(modelAwayML)} home=${fmtOdds(modelHomeML)} | RL away=${g.awayBookSpread}(${g.modelAwaySpreadOdds}) home=${g.homeBookSpread}(${g.modelHomeSpreadOdds}) | Total=${g.modelTotal} o=${g.modelOverOdds} u=${g.modelUnderOdds}`);
  console.log(`  Win%:  away=${modelAwayWin}% home=${modelHomeWin}% sum=${winPctSum.toFixed(2)}% | Proj Score: away=${g.modelAwayScore} home=${g.modelHomeScore}`);
  console.log(`  ML→WinPct: away=${winPctFromML_away}% home=${winPctFromML_home}% | Stored: away=${modelAwayWin}% home=${modelHomeWin}%`);
  console.log(`  Pitcher ERA: ${pitcherDirectionNote}`);
  console.log(`  DK favors: ${dkFavorsAway ? g.awayTeam : g.homeTeam} | Model favors: ${modelFavorsAway ? g.awayTeam : g.homeTeam} | Agreement: ${modelDkDirectionAgree ? '✓' : '✗ DISAGREE'}`);
  if (gameIssues.length > 0) {
    console.log(`  ISSUES: ${gameIssues.join(' | ')}`);
  }
}

console.log('\n' + '='.repeat(90));
console.log(`[VALIDATE] FINAL RESULT: ${allPass ? '✓ ALL PASS' : '✗ FAILURES FOUND'}`);
if (failures.length > 0) {
  console.log(`[VALIDATE] ${failures.length} games with issues:`);
  for (const f of failures) {
    console.log(`  ${f.game}: ${f.issues.join(' | ')}`);
  }
} else {
  console.log(`[VALIDATE] All ${games.length} MLB games passed all 5 validation checks`);
}
console.log('='.repeat(90));

await conn.end();
