/**
 * PREZ BETS & HANKSTHEBANK — 2026 MLB SEASON RECAP CHARTS
 * =========================================================
 * Pulls live cumulative unit P&L per date from tracked_bets.
 * Generates two separate PNG charts with maximum precision.
 *
 * P&L logic:
 *   WIN  → +toWinUnits
 *   LOSS → -riskUnits
 *   (No PUSH/VOID in dataset)
 *
 * Cumulative curve: sorted by gameDate ASC, running sum per day.
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('[ERROR] DATABASE_URL missing'); process.exit(1); }

// ─── CONNECT ──────────────────────────────────────────────────────────────────
console.log('[INPUT] Connecting to database...');
const conn = await mysql.createConnection(DB_URL);

// ─── QUERY: daily P&L per user ────────────────────────────────────────────────
// userId=1 = Prez, userId=60002 = Hanksthebank
const USER_IDS = [1, 60002];
const USER_LABELS = { 1: 'PREZ BETS', 60002: 'HANKSTHEBANK' };
const USER_HANDLES = { 1: 'prez', 60002: 'hanksthebank' };

console.log('[STEP] Querying daily P&L for both users...');

const [rows] = await conn.execute(`
  SELECT
    userId,
    gameDate,
    SUM(CASE
      WHEN result = 'WIN'  THEN toWinUnits
      WHEN result = 'LOSS' THEN -riskUnits
      WHEN result = 'PUSH' THEN 0
      WHEN result = 'VOID' THEN 0
      ELSE 0
    END) AS daily_pnl,
    COUNT(*) AS bet_count,
    SUM(CASE WHEN result = 'WIN'  THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) AS losses,
    SUM(riskUnits) AS total_risked
  FROM tracked_bets
  WHERE sport = 'MLB'
    AND userId IN (1, 60002)
    AND result IN ('WIN','LOSS','PUSH','VOID')
  GROUP BY userId, gameDate
  ORDER BY userId ASC, gameDate ASC
`);

await conn.end();
console.log(`[STATE] Raw rows returned: ${rows.length}`);

// ─── BUILD CUMULATIVE CURVES ──────────────────────────────────────────────────
const userData = {};

for (const userId of USER_IDS) {
  const userRows = rows.filter(r => r.userId === userId);
  console.log(`\n[STATE] ${USER_LABELS[userId]}: ${userRows.length} game dates`);

  let cumulative = 0;
  const curve = [];

  for (const row of userRows) {
    const pnl = parseFloat(row.daily_pnl) || 0;
    cumulative += pnl;
    curve.push({
      date: row.gameDate,
      daily_pnl: pnl,
      cumulative: parseFloat(cumulative.toFixed(4)),
      bets: row.bet_count,
      wins: row.wins,
      losses: row.losses,
    });
    console.log(`  [STATE] ${row.gameDate}: daily=${pnl.toFixed(2)}U  cumulative=${cumulative.toFixed(2)}U  (${row.wins}W-${row.losses}L)`);
  }

  const totalRisked = userRows.reduce((s, r) => s + parseFloat(r.total_risked || 0), 0);
  const finalUnits = cumulative;
  const roi = totalRisked > 0 ? (finalUnits / totalRisked) * 100 : 0;

  console.log(`[OUTPUT] ${USER_LABELS[userId]} FINAL: ${finalUnits >= 0 ? '+' : ''}${finalUnits.toFixed(2)}U  ROI=${roi.toFixed(2)}%  Risked=${totalRisked.toFixed(2)}U`);

  userData[userId] = {
    label: USER_LABELS[userId],
    handle: USER_HANDLES[userId],
    curve,
    finalUnits,
    totalRisked,
    roi,
  };
}

// ─── WRITE DATA TO JSON FOR PYTHON ────────────────────────────────────────────
const jsonPath = '/home/ubuntu/chart_data.json';
writeFileSync(jsonPath, JSON.stringify(userData, null, 2));
console.log(`\n[OUTPUT] Data written to ${jsonPath}`);
console.log('[VERIFY] PASS — data extraction complete');
