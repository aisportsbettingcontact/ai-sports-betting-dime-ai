/**
 * Minimal DB write test to isolate the MySQL error
 * Tests the exact same fields that mlbModelRunner writes
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq } from 'drizzle-orm';
import { games } from '../drizzle/schema.ts';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);

const TEST_ID = 2250861; // MIA@WSH

console.log('[TEST] Testing minimal DB write for game id=', TEST_ID);

try {
  // Test 1: Write just the HR props fields
  console.log('[TEST 1] Writing HR props fields...');
  await db.update(games)
    .set({
      modelAwayHrPct: '45.92',
      modelHomeHrPct: '63.26',
      modelBothHrPct: '29.03',
      modelAwayExpHr: '0.61',
      modelHomeExpHr: '1.00',
    })
    .where(eq(games.id, TEST_ID));
  console.log('[TEST 1] PASS — HR props written successfully');
} catch (err) {
  console.error('[TEST 1] FAIL:', err.message);
  console.error('[TEST 1] CAUSE:', err.cause?.message ?? err.cause ?? 'none');
  console.error('[TEST 1] CODE:', err.cause?.code ?? 'none');
}

try {
  // Test 2: Write NRFI fields
  console.log('[TEST 2] Writing NRFI fields...');
  await db.update(games)
    .set({
      modelPNrfi: '0.4677',
      modelNrfiOdds: '+112',
      modelYrfiOdds: '-132',
    })
    .where(eq(games.id, TEST_ID));
  console.log('[TEST 2] PASS — NRFI fields written successfully');
} catch (err) {
  console.error('[TEST 2] FAIL:', err.message);
  console.error('[TEST 2] CAUSE:', err.cause?.message ?? err.cause ?? 'none');
  console.error('[TEST 2] CODE:', err.cause?.code ?? 'none');
}

try {
  // Test 3: Write inning fields
  console.log('[TEST 3] Writing inning fields...');
  await db.update(games)
    .set({
      modelInningHomeExp: '[0.5,0.4,0.5,0.4,0.4,0.4,0.4,0.4,0.4]',
      modelInningAwayExp: '[0.5,0.4,0.5,0.4,0.4,0.4,0.4,0.4,0.4]',
      modelInningTotalExp: '[1.0,0.9,1.0,0.9,0.9,0.9,0.9,0.9,0.9]',
      modelInningPHomeScores: '[0.29,0.25,0.28,0.24,0.24,0.24,0.23,0.22,0.21]',
      modelInningPAwayScores: '[0.28,0.25,0.28,0.24,0.24,0.24,0.23,0.22,0.21]',
      modelInningPNeitherScores: '[0.50,0.56,0.51,0.56,0.56,0.56,0.57,0.58,0.59]',
    })
    .where(eq(games.id, TEST_ID));
  console.log('[TEST 3] PASS — Inning fields written successfully');
} catch (err) {
  console.error('[TEST 3] FAIL:', err.message);
  console.error('[TEST 3] CAUSE:', err.cause?.message ?? err.cause ?? 'none');
  console.error('[TEST 3] CODE:', err.cause?.code ?? 'none');
}

try {
  // Test 4: Write modelProjTotal and modelWeatherAdj
  console.log('[TEST 4] Writing modelProjTotal and modelWeatherAdj...');
  await db.update(games)
    .set({
      modelProjTotal: '8.67',
      modelWeatherAdj: '0.0000',
    })
    .where(eq(games.id, TEST_ID));
  console.log('[TEST 4] PASS — modelProjTotal and modelWeatherAdj written successfully');
} catch (err) {
  console.error('[TEST 4] FAIL:', err.message);
  console.error('[TEST 4] CAUSE:', err.cause?.message ?? err.cause ?? 'none');
  console.error('[TEST 4] CODE:', err.cause?.code ?? 'none');
}

await conn.end();
console.log('[TEST] Done');
process.exit(0);
