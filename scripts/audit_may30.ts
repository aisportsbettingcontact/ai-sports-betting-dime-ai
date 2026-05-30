/**
 * audit_may30.ts
 * Full pre-run DB audit for May 30, 2026 MLB games.
 * Enumerates all games, checks pitchers, odds, and current model state.
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TAG = "[AUDIT-MAY30-PRE]";
const DATE = "2026-05-30";

async function main() {
  const db = await getDb();
  const rows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      startTimeEst: games.startTimeEst,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
      awayPitcherConfirmed: games.awayPitcherConfirmed,
      homePitcherConfirmed: games.homePitcherConfirmed,
      awayML: games.awayML,
      homeML: games.homeML,
      awayRunLine: games.awayRunLine,
      homeRunLine: games.homeRunLine,
      awayRunLineOdds: games.awayRunLineOdds,
      homeRunLineOdds: games.homeRunLineOdds,
      awayBookSpread: games.awayBookSpread,
      homeBookSpread: games.homeBookSpread,
      overOdds: games.overOdds,
      underOdds: games.underOdds,
      bookTotal: games.bookTotal,
      modelAwayML: games.modelAwayML,
      modelHomeML: games.modelHomeML,
      publishedToFeed: games.publishedToFeed,
      publishedModel: games.publishedModel,
      modelRunAt: games.modelRunAt,
    })
    .from(games)
    .where(and(eq(games.gameDate, DATE), eq(games.sport, "MLB")))
    .orderBy(games.startTimeEst);

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} May 30, 2026 MLB — Pre-Run DB Audit`);
  console.log(`${TAG} Games in DB: ${rows.length}`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  let hasOdds = 0;
  let hasPitchers = 0;
  let alreadyModeled = 0;
  let alreadyPublished = 0;
  let issues: string[] = [];

  for (const g of rows) {
    const oddsOk = g.awayML != null && g.homeML != null && g.bookTotal != null;
    const pitchersOk = g.awayStartingPitcher != null && g.homeStartingPitcher != null;
    const modeled = g.modelRunAt != null;
    const published = g.publishedToFeed === 1 || g.publishedToFeed === true;

    if (oddsOk) hasOdds++;
    if (pitchersOk) hasPitchers++;
    if (modeled) alreadyModeled++;
    if (published) alreadyPublished++;

    const oddsFlag = oddsOk ? "✅" : "❌ MISSING ODDS";
    const pitchFlag = pitchersOk ? "✅" : "⚠️  UNCONFIRMED";
    const modelFlag = modeled ? "✅ MODELED" : "⏳ NOT YET";
    const pubFlag = published ? "✅ LIVE" : "⏳ UNPUBLISHED";

    console.log(`${TAG} [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${g.startTimeEst}`);
    console.log(`${TAG}   [INPUT]  Odds:    ${oddsFlag} | ML: ${g.awayML}/${g.homeML} | Total: ${g.bookTotal} (${g.overOdds}/${g.underOdds})`);
    console.log(`${TAG}   [INPUT]  RL:      Away=${g.awayRunLine}(${g.awayBookSpread}) | Home=${g.homeRunLine}(${g.homeBookSpread})`);
    console.log(`${TAG}   [INPUT]  Pitchers: ${pitchFlag} | Away=${g.awayStartingPitcher ?? "NULL"} (conf=${g.awayPitcherConfirmed}) | Home=${g.homeStartingPitcher ?? "NULL"} (conf=${g.homePitcherConfirmed})`);
    console.log(`${TAG}   [STATE]  Model:   ${modelFlag} | Published: ${pubFlag}`);

    if (!oddsOk) issues.push(`[${g.id}] ${g.awayTeam}@${g.homeTeam} — MISSING ODDS`);
    if (!pitchersOk) issues.push(`[${g.id}] ${g.awayTeam}@${g.homeTeam} — MISSING PITCHERS`);
    console.log(`${TAG}   ${"─".repeat(70)}`);
  }

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [OUTPUT] Total games:      ${rows.length}`);
  console.log(`${TAG} [OUTPUT] Has odds:         ${hasOdds}/${rows.length}`);
  console.log(`${TAG} [OUTPUT] Has pitchers:     ${hasPitchers}/${rows.length}`);
  console.log(`${TAG} [OUTPUT] Already modeled:  ${alreadyModeled}/${rows.length}`);
  console.log(`${TAG} [OUTPUT] Already published:${alreadyPublished}/${rows.length}`);
  if (issues.length > 0) {
    console.log(`${TAG} [VERIFY] ⚠️  Issues found:`);
    issues.forEach(i => console.log(`${TAG}   ${i}`));
  } else {
    console.log(`${TAG} [VERIFY] ✅ All games have odds and pitchers — ready to model`);
  }
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  process.exit(0);
}

main().catch(e => { console.error(`${TAG} [ERROR] ${e.message}`); process.exit(1); });
