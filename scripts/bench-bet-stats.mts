/**
 * bench-bet-stats.mts — where does the Bet Tracker stats read actually break?
 *
 * Run this before optimising anything in the stats path. It was written because
 * "push the aggregation into SQL" was the assumed fix, and the measurement said
 * otherwise: the aggregation is not the bottleneck and moving it to SQL would
 * have optimised 1% of the payload while adding a second implementation of the
 * accounting rules to keep in lockstep.
 *
 * WHAT IT FOUND (MySQL 8.4 on loopback, single user, 2026-08-04)
 *
 *   rows    query+transfer   JS aggregate   equity pts   stats payload
 *      184           1.2ms          0.3ms          109           17 KB
 *    1,000           2.5ms          1.0ms          561           79 KB
 *   10,000          28.0ms         11.4ms        5,729          795 KB
 *   50,000          89.9ms         36.5ms       28,565        4,045 KB
 *
 *   At 50,000 rows the curve alone is 3,992 KB of that 4,045 KB — 99%.
 *   Scalars plus all seven breakdowns are 53 KB and stay flat, because they are
 *   keyed by month/sport/market rather than by bet.
 *
 * AND AGAINST PRODUCTION (TiDB Serverless, 184 real rows)
 *
 *   full row transfer  82ms
 *   SQL aggregate      79ms
 *
 *   Identical. A round trip costs ~80ms whether it returns 184 rows or one
 *   aggregate row, so replacing the read with GROUP BY buys nothing at any
 *   scale this product has reached. Latency dominates, not bytes or CPU.
 *
 * CONCLUSION: bound the curve (see downsampleEquityCurve), leave the single
 * aggregation implementation alone. Revisit SQL aggregation only when a single
 * account's DB->server transfer becomes the measured constraint — on this data
 * that is around 50,000 bets, i.e. ~11.6 MB per read.
 *
 * USAGE
 *   Point BENCH_DATABASE_URL at a THROWAWAY database — this script drops and
 *   recreates `tracked_bets` on every run. Never aim it at production.
 *
 *   1. Start a disposable MySQL with a generated root password:
 *        PW=$(openssl rand -hex 16)
 *        docker run -d --name dime-bench -e MYSQL_ROOT_PASSWORD="$PW" \
 *          -e MYSQL_DATABASE=dimebench -p 3907:3306 mysql:8.4
 *   2. Wait for it to finish initialising (mysqladmin ping succeeds twice).
 *   3. Export BENCH_DATABASE_URL as a mysql2 DSN for root@127.0.0.1:3907
 *      against the `dimebench` database, using that password.
 *   4. pnpm tsx scripts/bench-bet-stats.mts
 */
import { createConnection } from "mysql2/promise";
import {
  aggregateStats,
  downsampleEquityCurve,
} from "../server/betTrackerCore";

const URI = process.env.BENCH_DATABASE_URL;
if (!URI) {
  console.error(
    "BENCH_DATABASE_URL is required. Point it at a throwaway database — this " +
      "script DROPS and recreates `tracked_bets`. See the header for a one-liner."
  );
  process.exit(1);
}
const SCALES = [184, 1_000, 10_000, 50_000];
const USER = 7777;

const DDL = `CREATE TABLE IF NOT EXISTS tracked_bets (
  id int NOT NULL AUTO_INCREMENT, userId int NOT NULL,
  sport varchar(16) NOT NULL DEFAULT 'MLB', gameDate varchar(20) NOT NULL,
  betType enum('ML','RL','OVER','UNDER','PROP','PARLAY','TEASER','FUTURE','CUSTOM') NOT NULL DEFAULT 'ML',
  pick varchar(255) NOT NULL, odds int NOT NULL,
  risk decimal(10,2) NOT NULL, toWin decimal(10,2) NOT NULL,
  result enum('PENDING','WIN','LOSS','PUSH','VOID') NOT NULL DEFAULT 'PENDING',
  timeframe enum('FULL_GAME','FIRST_5','FIRST_INNING','NRFI','YRFI','REGULATION','FIRST_PERIOD','FIRST_HALF','FIRST_QUARTER') NOT NULL DEFAULT 'FULL_GAME',
  market enum('ML','RL','TOTAL') NOT NULL DEFAULT 'ML',
  wagerType enum('PREGAME','LIVE') NOT NULL DEFAULT 'PREGAME',
  riskUnits decimal(8,2) DEFAULT NULL, toWinUnits decimal(8,2) DEFAULT NULL,
  PRIMARY KEY (id), KEY idx_tb_user_date (userId,gameDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

/** Deterministic PRNG so every scale sees the same shape of data. */
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const choose = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

const SPORTS = ["MLB", "NBA", "NHL", "NFL"] as const;
const MARKETS = ["ML", "RL", "TOTAL"] as const;
const TIMEFRAMES = ["FULL_GAME", "FIRST_5", "NRFI", "YRFI"] as const;
const RESULTS = [
  "WIN",
  "WIN",
  "LOSS",
  "LOSS",
  "PUSH",
  "VOID",
  "PENDING",
] as const;

function synth(n: number): unknown[][] {
  const out: unknown[][] = [];
  const start = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(start + Math.floor(i / 4) * 86_400_000);
    const odds =
      rnd() < 0.5
        ? -(100 + Math.floor(rnd() * 200))
        : 100 + Math.floor(rnd() * 300);
    const riskUnits = Math.round((0.5 + rnd() * 4) * 100) / 100;
    const risk = riskUnits * 100;
    const toWin = odds > 0 ? risk * (odds / 100) : risk * (100 / -odds);
    out.push([
      USER,
      choose(SPORTS),
      d.toISOString().slice(0, 10),
      "ML",
      `Pick ${i}`,
      odds,
      risk.toFixed(2),
      toWin.toFixed(2),
      choose(RESULTS),
      choose(TIMEFRAMES),
      choose(MARKETS),
      "PREGAME",
      riskUnits.toFixed(2),
      (toWin / 100).toFixed(2),
    ]);
  }
  return out;
}

const SELECT = `SELECT id, gameDate, result, sport, market, betType, timeframe,
  wagerType, pick, odds, risk, toWin, riskUnits, toWinUnits
  FROM tracked_bets WHERE userId = ? ORDER BY gameDate ASC, id ASC`;

const elapsed = (t: bigint) => Number(process.hrtime.bigint() - t) / 1e6;
const median = (a: number[]) =>
  a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

const c = await createConnection({ uri: URI, connectTimeout: 20_000 });
await c.query("DROP TABLE IF EXISTS tracked_bets");
await c.query(DDL);

console.log(
  "rows    | query+transfer | JS aggregate | equity pts | payload | thinned payload"
);
console.log(
  "--------|----------------|--------------|------------|---------|----------------"
);

for (const n of SCALES) {
  await c.query("DELETE FROM tracked_bets");
  const data = synth(n);
  for (let i = 0; i < data.length; i += 1_000) {
    await c.query(
      `INSERT INTO tracked_bets (userId,sport,gameDate,betType,pick,odds,risk,toWin,
        result,timeframe,market,wagerType,riskUnits,toWinUnits) VALUES ?`,
      [data.slice(i, i + 1_000)]
    );
  }
  await c.query("ANALYZE TABLE tracked_bets");

  const qs: number[] = [],
    as: number[] = [];
  let stats!: ReturnType<typeof aggregateStats>;
  for (let r = 0; r < 5; r++) {
    const t0 = process.hrtime.bigint();
    const [rs] = await c.query(SELECT, [USER]);
    qs.push(elapsed(t0));
    const t1 = process.hrtime.bigint();
    stats = aggregateStats(rs as never, 100);
    as.push(elapsed(t1));
  }

  const full = JSON.stringify(stats).length;
  const thinned = JSON.stringify({
    ...stats,
    equityCurve: downsampleEquityCurve(stats.equityCurve),
  }).length;

  console.log(
    `${String(n).padStart(7)} | ${(median(qs).toFixed(1) + "ms").padStart(14)} | ` +
      `${(median(as).toFixed(1) + "ms").padStart(12)} | ` +
      `${String(stats.equityCurve.length).padStart(10)} | ` +
      `${((full / 1024).toFixed(0) + "KB").padStart(7)} | ` +
      `${((thinned / 1024).toFixed(0) + "KB").padStart(14)}`
  );
}

await c.end();
