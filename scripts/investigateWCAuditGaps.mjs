/**
 * investigateWCAuditGaps.mjs
 * 
 * Investigates two gaps from the main audit:
 * 1. 2018/2022 wc_bt_matches stage values (why 0 rows for stage='GROUP')
 * 2. wc26-g-001 and wc26-g-002 (Jun 11, 2026) — ESPN match lookup
 */
import mysql from 'mysql2/promise';
import https from 'https';
import { config } from 'dotenv';
config();

const TAG = '[WC_AUDIT_GAPS]';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} WC Audit Gap Investigation`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(80)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── GAP 1: wc_bt_matches stage values ────────────────────────────────────
  console.log(`${TAG} [GAP 1] wc_bt_matches — distinct stage values by tournament_year:`);
  const [stages] = await conn.execute(
    `SELECT tournament_year, stage, COUNT(*) as cnt 
     FROM wc_bt_matches 
     GROUP BY tournament_year, stage 
     ORDER BY tournament_year, stage`
  );
  if (stages.length === 0) {
    console.log(`${TAG}   [STATE] wc_bt_matches is EMPTY (0 rows total)`);
  } else {
    stages.forEach(r => console.log(`${TAG}   year=${r.tournament_year} stage='${r.stage}' count=${r.cnt}`));
  }

  // Total count
  const [total] = await conn.execute('SELECT COUNT(*) as cnt FROM wc_bt_matches');
  console.log(`${TAG}   [STATE] Total wc_bt_matches rows: ${total[0].cnt}`);

  // ── GAP 2: wc26-g-001 and wc26-g-002 in DB ───────────────────────────────
  console.log(`\n${TAG} [GAP 2] wc26-g-001 and wc26-g-002 DB state:`);
  const [gap2] = await conn.execute(
    `SELECT match_id, home_team_id, away_team_id, match_date, kickoff_utc,
            home_score, away_score, status, espn_event_id
     FROM wc2026_matches
     WHERE match_id IN ('wc26-g-001', 'wc26-g-002')`
  );
  gap2.forEach(r => {
    console.log(`${TAG}   ${r.match_id}: ${r.home_team_id} vs ${r.away_team_id} | date=${r.match_date} | score=${r.home_score}-${r.away_score} | status=${r.status} | espn_event_id=${r.espn_event_id}`);
  });

  // ── GAP 2b: Try ESPN for Jun 11, 2026 ────────────────────────────────────
  console.log(`\n${TAG} [GAP 2b] Fetching ESPN for 2026-06-11 (wc26-g-001 and wc26-g-002 date)...`);
  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611&limit=20';
    const data = await httpsGet(url);
    const events = data.events || [];
    console.log(`${TAG}   ESPN Jun 11 events: ${events.length}`);
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      const completed = ev.status?.type?.completed;
      console.log(`${TAG}   id=${ev.id} | ${home?.team?.displayName} vs ${away?.team?.displayName} | score: ${home?.score}-${away?.score} | completed=${completed}`);
    }
  } catch (e) {
    console.warn(`${TAG}   [WARN] ESPN Jun 11 fetch failed: ${e.message}`);
  }

  // ── GAP 2c: Try ESPN by specific event IDs from DB ───────────────────────
  for (const row of gap2) {
    if (row.espn_event_id) {
      console.log(`\n${TAG} [GAP 2c] Fetching ESPN event ${row.espn_event_id} for ${row.match_id}...`);
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${row.espn_event_id}`;
        const data = await httpsGet(url);
        const header = data.header;
        if (header) {
          const comps = header.competitions?.[0];
          const home = comps?.competitors?.find(c => c.homeAway === 'home');
          const away = comps?.competitors?.find(c => c.homeAway === 'away');
          console.log(`${TAG}   ${row.match_id}: ${home?.team?.displayName} ${home?.score}-${away?.score} ${away?.team?.displayName}`);
          console.log(`${TAG}   DB: ${row.home_team_id} ${row.home_score}-${row.away_score} ${row.away_team_id}`);
          const espnHomeScore = parseInt(home?.score ?? '-1', 10);
          const espnAwayScore = parseInt(away?.score ?? '-1', 10);
          const match = espnHomeScore === row.home_score && espnAwayScore === row.away_score;
          console.log(`${TAG}   Score match: ${match ? '✅' : '❌ MISMATCH'}`);
        } else {
          console.log(`${TAG}   No header data in ESPN summary response`);
          console.log(`${TAG}   Keys: ${Object.keys(data).join(', ')}`);
        }
      } catch (e) {
        console.warn(`${TAG}   [WARN] ESPN summary fetch failed: ${e.message}`);
      }
    } else {
      console.log(`${TAG}   ${row.match_id}: no espn_event_id in DB — cannot fetch by ID`);
    }
  }

  // ── GAP 2d: Try ESPN scoreboard for Jun 10-12 range ──────────────────────
  console.log(`\n${TAG} [GAP 2d] Fetching ESPN scoreboard for Jun 10-12, 2026 range...`);
  for (const date of ['20260610', '20260611', '20260612']) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date}&limit=20`;
      const data = await httpsGet(url);
      const events = data.events || [];
      if (events.length > 0) {
        console.log(`${TAG}   ${date}: ${events.length} events`);
        for (const ev of events) {
          const comp = ev.competitions?.[0];
          const home = comp?.competitors?.find(c => c.homeAway === 'home');
          const away = comp?.competitors?.find(c => c.homeAway === 'away');
          const completed = ev.status?.type?.completed;
          console.log(`${TAG}     id=${ev.id} | ${home?.team?.displayName} ${home?.score}-${away?.score} ${away?.team?.displayName} | completed=${completed}`);
        }
      } else {
        console.log(`${TAG}   ${date}: 0 events`);
      }
    } catch (e) {
      console.warn(`${TAG}   [WARN] ${date}: ${e.message}`);
    }
  }

  await conn.end();
  console.log(`\n${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
