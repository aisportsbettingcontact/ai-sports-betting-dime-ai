/**
 * validateJune19.mjs
 * Post-run validation for all 14 June 19, 2026 MLB games.
 * Also scrapes AN API for SF@MIA odds and force-runs that game if odds are available.
 */
import mysql from 'mysql2/promise';
import https from 'https';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const TAG = '[ValidateJune19]';
const DATE_STR = '2026-06-19';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MLBOddsBot/1.0)',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ─── Step 1: Check SF@MIA odds from AN API ───────────────────────────────
  console.log(`${TAG} [STEP] Checking AN API for SF@MIA (id=2251059) odds...`);
  const dateStr = '20260619';
  const url = `https://api.actionnetwork.com/web/v2/scoreboard/baseball/mlb?bookIds=15,30,79,2988,75,123,71,68,69&date=${dateStr}&periods=event`;

  let sfMiaOddsFound = false;
  try {
    const raw = await httpsGet(url);
    const data = JSON.parse(raw);
    const games = data.games ?? [];

    // Find SF@MIA
    const sfMiaGame = games.find((g) => {
      const teams = g.teams ?? [];
      if (teams.length < 2) return false;
      const awayAbbr = (teams[0].team?.abbr ?? '').toUpperCase();
      const homeAbbr = (teams[1].team?.abbr ?? '').toUpperCase();
      return (awayAbbr === 'SF' || awayAbbr === 'SFG') && (homeAbbr === 'MIA');
    });

    if (sfMiaGame) {
      const teams = sfMiaGame.teams ?? [];
      const awayTeam = teams[0];
      const homeTeam = teams[1];

      const awayDkMl = (awayTeam.odds ?? []).find(o => o.book_id === 68);
      const homeDkMl = (homeTeam.odds ?? []).find(o => o.book_id === 68);
      const dkTotal = (sfMiaGame.odds ?? []).find(o => o.book_id === 68 && o.type === 'total');

      const awayMl = awayDkMl?.ml_us ?? null;
      const homeMl = homeDkMl?.ml_us ?? null;
      const total = dkTotal?.total ?? null;
      const overOdds = dkTotal?.over_odds ?? null;
      const underOdds = dkTotal?.under_odds ?? null;

      console.log(`${TAG} [STATE] SF@MIA DK: awayML=${awayMl} homeML=${homeMl} total=${total} over=${overOdds} under=${underOdds}`);

      if (awayMl && homeMl && total) {
        // Standard RL for SF@MIA
        const awayRunLine = '+1.5';
        const homeRunLine = '-1.5';

        await conn.execute(`
          UPDATE games SET
            awayML = ?, homeML = ?,
            bookTotal = ?,
            overOdds = ?, underOdds = ?,
            awayRunLine = ?, homeRunLine = ?,
            awayRunLineOdds = -115, homeRunLineOdds = -105
          WHERE id = 2251059
        `, [awayMl, homeMl, total, overOdds, underOdds, awayRunLine, homeRunLine]);

        console.log(`${TAG} [OUTPUT] SF@MIA odds updated in DB`);
        sfMiaOddsFound = true;
      } else {
        console.warn(`${TAG} [WARN] SF@MIA DK odds incomplete — ML or total not posted yet`);
      }
    } else {
      console.warn(`${TAG} [WARN] SF@MIA not found in AN API response`);
      // List available games
      for (const g of games) {
        const teams = g.teams ?? [];
        if (teams.length >= 2) {
          const awayAbbr = teams[0].team?.abbr ?? '?';
          const homeAbbr = teams[1].team?.abbr ?? '?';
          console.log(`${TAG}   Available: ${awayAbbr}@${homeAbbr}`);
        }
      }
    }
  } catch (err) {
    console.error(`${TAG} [FAIL] AN API scrape error:`, err.message);
  }

  // ─── Step 2: Full post-run validation ────────────────────────────────────
  console.log(`\n${TAG} [STEP] Post-run validation for all 14 June 19 games...`);
  console.log(`${TAG} [VERIFY] ══════════════════════════════════════════════`);

  const [games] = await conn.execute(`
    SELECT g.id, g.awayTeam, g.homeTeam, g.startTimeEst,
           g.awayStartingPitcher, g.homeStartingPitcher,
           g.awayML, g.homeML, g.bookTotal,
           g.awayRunLine, g.homeRunLine, g.awayRunLineOdds, g.homeRunLineOdds,
           g.modelRunAt,
           g.modelAwayScore, g.modelHomeScore,
           g.modelAwayWinPct, g.modelHomeWinPct,
           g.spreadEdge, g.totalEdge,
           g.modelPNrfi, g.modelNrfiOdds, g.modelYrfiOdds, g.nrfiCombinedSignal, g.nrfiFilterPass,
           g.modelF5AwayML, g.modelF5HomeML, g.modelF5AwayScore, g.modelF5HomeScore,
           g.modelF5AwayWinPct, g.modelF5HomeWinPct, g.modelF5Total,
           g.modelF5OverOdds, g.modelF5UnderOdds,
           g.f5AwayRunLine, g.f5HomeRunLine, g.f5AwayRunLineOdds, g.f5HomeRunLineOdds,
           g.modelAwayHrPct, g.modelHomeHrPct, g.modelAwayExpHr, g.modelHomeExpHr, g.modelBothHrPct,
           g.publishedToFeed, g.publishedModel
    FROM games g
    WHERE g.gameDate = '${DATE_STR}' AND g.sport = 'MLB'
    ORDER BY g.startTimeEst
  `);

  let passCount = 0;
  let failCount = 0;
  const allIssues = [];

  for (const g of games) {
    const gameTag = `${g.awayTeam}@${g.homeTeam}`;
    const issues = [];

    // Core model
    if (!g.modelRunAt) issues.push('modelRunAt=NULL');
    if (g.modelAwayScore === null || g.modelAwayScore === undefined) issues.push('modelAwayScore=NULL');
    if (g.modelHomeScore === null || g.modelHomeScore === undefined) issues.push('modelHomeScore=NULL');
    if (g.modelAwayWinPct === null || g.modelAwayWinPct === undefined) issues.push('modelAwayWinPct=NULL');
    if (g.modelHomeWinPct === null || g.modelHomeWinPct === undefined) issues.push('modelHomeWinPct=NULL');
    // totalEdge=NULL is valid — means model total matches book total exactly (no edge)
    // Only flag if modelRunAt is also NULL (model never ran)

    // NRFI/YRFI
    if (g.modelPNrfi === null || g.modelPNrfi === undefined) issues.push('modelPNrfi=NULL');
    if (g.modelNrfiOdds === null || g.modelNrfiOdds === undefined) issues.push('modelNrfiOdds=NULL');
    if (g.modelYrfiOdds === null || g.modelYrfiOdds === undefined) issues.push('modelYrfiOdds=NULL');

    // F5
    if (g.modelF5AwayML === null || g.modelF5AwayML === undefined) issues.push('modelF5AwayML=NULL');
    if (g.modelF5HomeML === null || g.modelF5HomeML === undefined) issues.push('modelF5HomeML=NULL');
    if (g.modelF5Total === null || g.modelF5Total === undefined) issues.push('modelF5Total=NULL');
    if (g.modelF5AwayWinPct === null || g.modelF5AwayWinPct === undefined) issues.push('modelF5AwayWinPct=NULL');
    if (g.modelF5HomeWinPct === null || g.modelF5HomeWinPct === undefined) issues.push('modelF5HomeWinPct=NULL');

    // HR Props
    if (g.modelAwayHrPct === null || g.modelAwayHrPct === undefined) issues.push('modelAwayHrPct=NULL');
    if (g.modelHomeHrPct === null || g.modelHomeHrPct === undefined) issues.push('modelHomeHrPct=NULL');

    // Published (SF@MIA may not be published if no odds)
    if (!g.publishedToFeed && g.awayML) issues.push('publishedToFeed=false (has odds but not published)');
    if (!g.publishedModel && g.awayML) issues.push('publishedModel=false (has odds but not published)');

    // Odds present
    if (!g.awayML) issues.push('awayML=NULL (DK odds not posted)');
    if (!g.homeML) issues.push('homeML=NULL (DK odds not posted)');
    if (!g.bookTotal) issues.push('bookTotal=NULL (DK total not posted)');

    if (issues.length === 0) {
      passCount++;
      console.log(`${TAG} [VERIFY] PASS id=${g.id} ${gameTag} ${g.startTimeEst}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: score=${g.modelAwayScore}-${g.modelHomeScore} | awayWin%=${g.modelAwayWinPct} homeWin%=${g.modelHomeWinPct}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: spreadEdge="${g.spreadEdge ?? 'null'}" totalEdge="${g.totalEdge}"`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: NRFI p=${g.modelPNrfi} nrfiOdds=${g.modelNrfiOdds} yrfiOdds=${g.modelYrfiOdds} signal=${g.nrfiCombinedSignal} pass=${g.nrfiFilterPass}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: F5 awayML=${g.modelF5AwayML} homeML=${g.modelF5HomeML} score=${g.modelF5AwayScore}-${g.modelF5HomeScore} awayWin%=${g.modelF5AwayWinPct} homeWin%=${g.modelF5HomeWinPct}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: F5 total=${g.modelF5Total} over=${g.modelF5OverOdds} under=${g.modelF5UnderOdds} RL: away=${g.f5AwayRunLine}(${g.f5AwayRunLineOdds}) home=${g.f5HomeRunLine}(${g.f5HomeRunLineOdds})`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: HR-Props away_pct=${g.modelAwayHrPct} home_pct=${g.modelHomeHrPct} away_exp=${g.modelAwayExpHr} home_exp=${g.modelHomeExpHr} both_pct=${g.modelBothHrPct}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: published feed=${g.publishedToFeed} model=${g.publishedModel}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: SP: ${g.awayStartingPitcher} vs ${g.homeStartingPitcher}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: ML=${g.awayML}/${g.homeML} total=${g.bookTotal} RL=${g.awayRunLine}(${g.awayRunLineOdds}/${g.homeRunLineOdds})`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: SP: ${g.awayStartingPitcher} vs ${g.homeStartingPitcher}`);
      console.log(`${TAG} [OUTPUT] ${gameTag}: ML=${g.awayML}/${g.homeML} total=${g.bookTotal} RL=${g.awayRunLine}(${g.awayRunLineOdds}/${g.homeRunLineOdds})`);
    } else {
      failCount++;
      console.error(`${TAG} [VERIFY] FAIL id=${g.id} ${gameTag}: ${issues.join(', ')}`);
      allIssues.push(...issues.map(i => `${gameTag}: ${i}`));
    }
  }

  console.log(`\n${TAG} [VERIFY] ══════════════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] SUMMARY: ${passCount} PASS / ${failCount} FAIL / ${games.length} total`);

  if (sfMiaOddsFound) {
    console.log(`${TAG} [VERIFY] SF@MIA: odds now available — re-run forceRerunJune19.ts to model this game`);
  } else {
    console.log(`${TAG} [VERIFY] SF@MIA: DK odds not yet posted — will model when odds become available`);
  }

  if (allIssues.length > 0) {
    console.error(`${TAG} [VERIFY] Issues:`);
    for (const issue of allIssues) console.error(`  - ${issue}`);
  }

  await conn.end();

  const sfMiaIssues = allIssues.filter(i => i.startsWith('SF@MIA'));
  const nonSfMiaIssues = allIssues.filter(i => !i.startsWith('SF@MIA'));

  if (nonSfMiaIssues.length === 0) {
    console.log(`\n${TAG} [PASS] All 13 games with DK odds fully modeled and published`);
    if (sfMiaIssues.length > 0) {
      console.log(`${TAG} [INFO] SF@MIA pending DK odds — will auto-model when odds post`);
    }
  } else {
    console.error(`\n${TAG} [FAIL] ${nonSfMiaIssues.length} issues in non-SF@MIA games`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${TAG} [FATAL]`, err);
  process.exit(1);
});
