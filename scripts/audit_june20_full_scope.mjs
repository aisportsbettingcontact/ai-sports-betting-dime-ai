/**
 * audit_june20_full_scope.mjs
 * Full-scope model output audit for all 14 June 20, 2026 MLB games.
 * Validates: Full Game ML/RL/OU, F5 ML/RL/OU, NRFI/YRFI, K-Props, HR Props
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const TAG = '[MLB_JUNE20_FULL_SCOPE]';
const pf = (v) => v != null ? parseFloat(v).toFixed(2) : 'null';
const pf1 = (v) => v != null ? parseFloat(v).toFixed(1) : 'null';
const fmt = (v) => v != null ? v : '—';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log(`${TAG} [INPUT] Connected to DB — auditing June 20, 2026 MLB games`);

  // Full game + F5 + NRFI
  const [games] = await conn.query(`
    SELECT 
      id, mlbGamePk, awayTeam, homeTeam, startTimeEst,
      awayStartingPitcher, homeStartingPitcher,
      awayPitcherConfirmed, homePitcherConfirmed,
      awayML, homeML, awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
      bookTotal, overOdds, underOdds,
      modelAwayML, modelHomeML,
      modelAwayWinPct, modelHomeWinPct,
      modelAwayScore, modelHomeScore, modelProjTotal,
      modelOverRate, modelUnderRate, modelOverOdds, modelUnderOdds,
      awayBookSpread, homeBookSpread, awayModelSpread, homeModelSpread,
      modelAwaySpreadOdds, modelHomeSpreadOdds,
      f5AwayML, f5HomeML, f5Total, f5OverOdds, f5UnderOdds,
      f5AwayRunLine, f5HomeRunLine, f5AwayRunLineOdds, f5HomeRunLineOdds,
      modelF5AwayML, modelF5HomeML,
      modelF5AwayWinPct, modelF5HomeWinPct,
      modelF5AwayScore, modelF5HomeScore, modelF5Total,
      modelF5OverRate, modelF5UnderRate, modelF5OverOdds, modelF5UnderOdds,
      modelF5AwayRLCoverPct, modelF5HomeRLCoverPct,
      modelF5AwayRlOdds, modelF5HomeRlOdds,
      nrfiOverOdds, yrfiUnderOdds,
      modelPNrfi, modelNrfiOdds, modelYrfiOdds, nrfiCombinedSignal,
      modelAwayHrPct, modelHomeHrPct, modelBothHrPct,
      modelAwayExpHr, modelHomeExpHr,
      modelRunAt, publishedToFeed, publishedModel
    FROM games
    WHERE gameDate = '2026-06-20' AND sport = 'MLB'
    ORDER BY startTimeEst ASC
  `);

  // K-Props: join via gameId
  const gameIds = games.map(g => g.id);
  const [kProps] = await conn.query(
    `SELECT gameId, side, pitcherName, bookLine, bookOverOdds, bookUnderOdds, kProj, pOver, pUnder, modelOverOdds, modelUnderOdds, verdict, bestEdge
     FROM mlb_strikeout_props WHERE gameId IN (?) ORDER BY gameId, side`,
    [gameIds]
  );
  const kMap = {};
  for (const k of kProps) {
    if (!kMap[k.gameId]) kMap[k.gameId] = [];
    kMap[k.gameId].push(k);
  }
  console.log(`${TAG} [STATE] K-Props loaded: ${kProps.length} rows across ${Object.keys(kMap).length} games`);

  // HR Props: join via gameId
  const [hrProps] = await conn.query(
    `SELECT gameId, side, playerName, teamAbbrev, bookLine, consensusOverOdds, consensusUnderOdds, modelPHr, modelOverOdds, edgeOver, verdict
     FROM mlb_hr_props WHERE gameId IN (?) ORDER BY gameId, side`,
    [gameIds]
  );
  const hrMap = {};
  for (const h of hrProps) {
    if (!hrMap[h.gameId]) hrMap[h.gameId] = [];
    hrMap[h.gameId].push(h);
  }
  console.log(`${TAG} [STATE] HR Props loaded: ${hrProps.length} rows across ${Object.keys(hrMap).length} games`);

  console.log(`\n${TAG} [STATE] Total June 20 games: ${games.length}/14`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════════════`);

  let issues = [];
  let sc = {
    fgML: 0, fgRL: 0, fgOU: 0,
    f5ML: 0, f5RL: 0, f5OU: 0,
    nrfi: 0, kProps: 0, hrProps: 0
  };

  for (const g of games) {
    const awaySPConf = g.awayPitcherConfirmed ? '✓CONF' : '(exp)';
    const homeSPConf = g.homePitcherConfirmed ? '✓CONF' : '(exp)';

    console.log(`\n${TAG} ── ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst} | id=${g.id} | gamePk=${g.mlbGamePk}`);
    console.log(`${TAG}    SP: ${g.awayStartingPitcher}${awaySPConf}(away) vs ${g.homeStartingPitcher}${homeSPConf}(home)`);

    // Full Game ML
    const fgMLOk = g.modelAwayML != null && g.modelHomeML != null;
    if (fgMLOk) sc.fgML++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing Full Game ML`);
    console.log(`${TAG}    [FG ML]   Book: ${fmt(g.awayML)}/${fmt(g.homeML)} | Model: ${fmt(g.modelAwayML)}/${fmt(g.modelHomeML)} | WinPct: ${pf1(g.modelAwayWinPct)}%/${pf1(g.modelHomeWinPct)}% | ${fgMLOk ? '✅' : '❌ MISSING'}`);

    // Full Game RL
    const fgRLOk = g.modelAwaySpreadOdds != null && g.modelHomeSpreadOdds != null;
    if (fgRLOk) sc.fgRL++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing Full Game RL`);
    console.log(`${TAG}    [FG RL]   Book: ${fmt(g.awayRunLine)}(${fmt(g.awayRunLineOdds)})/${fmt(g.homeRunLine)}(${fmt(g.homeRunLineOdds)}) | Model: ${fmt(g.awayModelSpread)}(${fmt(g.modelAwaySpreadOdds)})/${fmt(g.homeModelSpread)}(${fmt(g.modelHomeSpreadOdds)}) | ${fgRLOk ? '✅' : '❌ MISSING'}`);

    // Full Game O/U
    const fgOUOk = g.modelOverOdds != null && g.modelUnderOdds != null;
    if (fgOUOk) sc.fgOU++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing Full Game O/U`);
    console.log(`${TAG}    [FG O/U]  Book: ${fmt(g.bookTotal)} O${fmt(g.overOdds)}/U${fmt(g.underOdds)} | Model proj: ${pf(g.modelProjTotal)} O%=${pf1(g.modelOverRate)}% | Model odds: O${fmt(g.modelOverOdds)}/U${fmt(g.modelUnderOdds)} | ${fgOUOk ? '✅' : '❌ MISSING'}`);

    // F5 ML
    const f5MLOk = g.modelF5AwayML != null && g.modelF5HomeML != null;
    if (f5MLOk) sc.f5ML++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing F5 ML`);
    console.log(`${TAG}    [F5 ML]   Book: ${fmt(g.f5AwayML)}/${fmt(g.f5HomeML)} | Model: ${fmt(g.modelF5AwayML)}/${fmt(g.modelF5HomeML)} | WinPct: ${pf1(g.modelF5AwayWinPct)}%/${pf1(g.modelF5HomeWinPct)}% | ${f5MLOk ? '✅' : '❌ MISSING'}`);

    // F5 RL
    const f5RLOk = g.modelF5AwayRlOdds != null && g.modelF5HomeRlOdds != null;
    if (f5RLOk) sc.f5RL++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing F5 RL`);
    console.log(`${TAG}    [F5 RL]   Book: ${fmt(g.f5AwayRunLine)}(${fmt(g.f5AwayRunLineOdds)})/${fmt(g.f5HomeRunLine)}(${fmt(g.f5HomeRunLineOdds)}) | Model cover%: ${pf1(g.modelF5AwayRLCoverPct)}%/${pf1(g.modelF5HomeRLCoverPct)}% | Model odds: ${fmt(g.modelF5AwayRlOdds)}/${fmt(g.modelF5HomeRlOdds)} | ${f5RLOk ? '✅' : '❌ MISSING'}`);

    // F5 O/U
    const f5OUOk = g.modelF5OverOdds != null && g.modelF5UnderOdds != null;
    if (f5OUOk) sc.f5OU++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing F5 O/U`);
    console.log(`${TAG}    [F5 O/U]  Book: ${fmt(g.f5Total)} O${fmt(g.f5OverOdds)}/U${fmt(g.f5UnderOdds)} | Model proj: ${pf(g.modelF5Total)} O%=${pf1(g.modelF5OverRate)}% | Model odds: O${fmt(g.modelF5OverOdds)}/U${fmt(g.modelF5UnderOdds)} | ${f5OUOk ? '✅' : '❌ MISSING'}`);

    // NRFI/YRFI
    const nrfiOk = g.modelPNrfi != null && g.modelNrfiOdds != null;
    if (nrfiOk) sc.nrfi++;
    else issues.push(`${g.awayTeam}@${g.homeTeam}: Missing NRFI`);
    const nrfiPct = g.modelPNrfi != null ? parseFloat(g.modelPNrfi) : null;
    const yrfiPct = nrfiPct != null ? (100 - nrfiPct).toFixed(1) : 'null';
    console.log(`${TAG}    [NRFI]    Book: NRFI${fmt(g.nrfiOverOdds)}/YRFI${fmt(g.yrfiUnderOdds)} | Model: NRFI%=${pf1(g.modelPNrfi)}%(${fmt(g.modelNrfiOdds)}) YRFI%=${yrfiPct}%(${fmt(g.modelYrfiOdds)}) | Signal=${fmt(g.nrfiCombinedSignal)} | ${nrfiOk ? '✅' : '❌ MISSING'}`);

    // K-Props
    const kp = kMap[g.id] || [];
    if (kp.length > 0) {
      sc.kProps++;
      for (const k of kp) {
        console.log(`${TAG}    [K PROP]  ${k.pitcherName}(${k.side}): Book ${k.bookLine} O${k.bookOverOdds}/U${k.bookUnderOdds} | Model proj=${pf(k.kProj)} O%=${pf1(k.pOver*100)}% | Model odds: O${fmt(k.modelOverOdds)}/U${fmt(k.modelUnderOdds)} | Verdict=${k.verdict} Edge=${pf(k.bestEdge)} ✅`);
      }
    } else {
      console.log(`${TAG}    [K PROP]  ❌ No K-props found for game id=${g.id}`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: Missing K-Props`);
    }

    // HR Props
    const hr = hrMap[g.id] || [];
    if (hr.length > 0) {
      sc.hrProps++;
      for (const h of hr) {
        console.log(`${TAG}    [HR PROP] ${h.playerName}(${h.teamAbbrev}/${h.side}): Book ${h.bookLine} O${h.consensusOverOdds}/U${h.consensusUnderOdds} | Model P(HR)=${pf1(h.modelPHr*100)}% | Model odds: O${fmt(h.modelOverOdds)} | Edge=${pf(h.edgeOver)} | Verdict=${h.verdict} ✅`);
      }
    } else {
      console.log(`${TAG}    [HR PROP] ❌ No HR-props found for game id=${g.id}`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: Missing HR-Props`);
    }
  }

  console.log(`\n${TAG} ═══════════════════════════════════════════════════════════════`);
  console.log(`${TAG} ─── FULL SCOPE VALIDATION SUMMARY ─────────────────────────────`);
  console.log(`${TAG} Total games:          ${games.length}/14`);
  console.log(`${TAG} Full Game ML:         ${sc.fgML}/14 ${sc.fgML === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} Full Game RL:         ${sc.fgRL}/14 ${sc.fgRL === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} Full Game O/U:        ${sc.fgOU}/14 ${sc.fgOU === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} F5 ML:                ${sc.f5ML}/14 ${sc.f5ML === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} F5 RL:                ${sc.f5RL}/14 ${sc.f5RL === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} F5 O/U:               ${sc.f5OU}/14 ${sc.f5OU === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} NRFI/YRFI:            ${sc.nrfi}/14 ${sc.nrfi === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} K-Props:              ${sc.kProps}/14 ${sc.kProps === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} HR Props:             ${sc.hrProps}/14 ${sc.hrProps === 14 ? '✅' : '❌'}`);
  console.log(`${TAG} K-Props total rows:   ${kProps.length} (${(kProps.length/14).toFixed(1)} avg per game)`);
  console.log(`${TAG} HR Props total rows:  ${hrProps.length} (${(hrProps.length/14).toFixed(1)} avg per game)`);

  if (issues.length === 0) {
    console.log(`\n${TAG} [VERIFY] ✅ PASS — All 14 games fully modeled across all 9 scopes. Zero issues.`);
  } else {
    console.log(`\n${TAG} [VERIFY] ❌ FAIL — ${issues.length} issue(s) found:`);
    for (const issue of issues) {
      console.log(`${TAG}   ❌ ${issue}`);
    }
  }

  await conn.end();
}

main().catch(e => { console.error(`${TAG} [ERROR]`, e.message); process.exit(1); });
