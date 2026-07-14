/**
 * mlbAllStarGameSync.ts — owner-triggered seed/refresh for the MLB All-Star Game.
 *
 * Runs server-side (Railway) where the DB + AN egress live. Wired to
 * POST /api/cron/mlb-asg (CRON_SECRET) in cron/cronRoutes.ts, and driven by the
 * mlb-asg.yml GitHub Actions workflow.
 *
 * Real run:
 *   1. Ensure the AL-vs-NL games row exists (insert identity row if missing;
 *      NO starting pitchers, so the Monte-Carlo model runner skips it and never
 *      clobbers the hand-seeded model — see mlbModelRunner.ts:1617 gate).
 *   2. refreshAnApiOdds(date, ["mlb"]) — the SAME production path that keeps
 *      every other MLB game's book live writes the ASG book (AL/NL resolve via
 *      the pseudo-team anSlug). The odds are therefore live, not static.
 *   3. Read the freshly-written book, select the model run-line + total rungs
 *      matching the book's live line (server/mlbAllStarGame.ts), and write ONLY
 *      the model columns + modelRunAt + published flags.
 *   4. Audit: every critical book + model column non-null, orientation AL@NL,
 *      isValidGame passes.
 *
 * Dry run: scrape + compute + return the book-vs-model tail, write nothing.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { fetchActionNetworkOdds } from "./actionNetworkScraper";
import { refreshAnApiOdds } from "./vsinAutoRefresh";
import { MLB_VALID_ABBREVS } from "../shared/mlbTeams";
import {
  MLB_ASG,
  findAsgInSlate,
  bookFromAnGame,
  computeAsgModel,
  impliedProb,
  type AsgBook,
  type AsgModel,
} from "./mlbAllStarGame";

const TAG = "[MLB-ASG]";

export interface AsgAuditCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface AsgSyncResult {
  dryRun: boolean;
  wrote: boolean;
  gameId: number | null;
  orientationOk: boolean;
  bookSource: string;
  book: AsgBook;
  model: AsgModel;
  audit: { pass: boolean; checks: AsgAuditCheck[] };
  tail: string;
}

const pctStr = (p: number) => (isNaN(p) ? "?" : `${p.toFixed(1)}%`);

/** Human-readable book-vs-model card (same layout as the CI preview). */
function buildTail(book: AsgBook, model: AsgModel): string {
  const pad = (s: string | null, n: number) => (s ?? "-").padEnd(n);
  return [
    `MLB All-Star Game — AL (away) @ NL (home) — ${MLB_ASG.gameDate}`,
    `book source=${book.source} | run-line rung=${model.runLineRung} | total rung=${model.totalRung}`,
    `  MARKET     | SIDE       | BOOK    | MODEL`,
    `  Moneyline  | AL (away)  | ${pad(book.awayML, 7)} | ${model.modelAwayML} (${pctStr(impliedProb(model.modelAwayML))})`,
    `             | NL (home)  | ${pad(book.homeML, 7)} | ${model.modelHomeML} (${pctStr(impliedProb(model.modelHomeML))})`,
    `  Run Line   | AL ${pad(book.awaySpread, 6)}| ${pad(book.awaySpreadOdds, 7)} | ${model.modelAwaySpreadOdds} (${pctStr(impliedProb(model.modelAwaySpreadOdds))} cover)`,
    `             | NL ${pad(book.homeSpread, 6)}| ${pad(book.homeSpreadOdds, 7)} | ${model.modelHomeSpreadOdds} (${pctStr(impliedProb(model.modelHomeSpreadOdds))} cover)`,
    `  Total      | O ${pad(book.total, 7)}| ${pad(book.overOdds, 7)} | ${model.modelOverOdds} (${pctStr(impliedProb(model.modelOverOdds))})`,
    `             | U ${pad(book.total, 7)}| ${pad(book.underOdds, 7)} | ${model.modelUnderOdds} (${pctStr(impliedProb(model.modelUnderOdds))})`,
  ].join("\n");
}

/** Build an AsgBook from a DB games row (book columns written by refreshAnApiOdds). */
function bookFromRow(row: typeof games.$inferSelect): AsgBook {
  return {
    awayML: row.awayML ?? null,
    homeML: row.homeML ?? null,
    awaySpread: row.awayRunLine ?? (row.awayBookSpread != null ? String(row.awayBookSpread) : null),
    awaySpreadOdds: row.awayRunLineOdds ?? row.awaySpreadOdds ?? null,
    homeSpread: row.homeRunLine ?? (row.homeBookSpread != null ? String(row.homeBookSpread) : null),
    homeSpreadOdds: row.homeRunLineOdds ?? row.homeSpreadOdds ?? null,
    total: row.bookTotal != null ? String(row.bookTotal) : null,
    overOdds: row.overOdds ?? null,
    underOdds: row.underOdds ?? null,
    source: (row.oddsSource as "dk" | "open" | null) ?? "none",
  };
}

/** Audit the written state — all critical columns non-null, orientation, valid teams. */
function auditRow(row: typeof games.$inferSelect): { pass: boolean; checks: AsgAuditCheck[] } {
  const checks: AsgAuditCheck[] = [];
  const nn = (name: string, v: unknown) =>
    checks.push({ name, ok: v != null && v !== "", detail: v == null ? "NULL" : String(v) });

  checks.push({
    name: "orientation AL@NL",
    ok: row.awayTeam === "AL" && row.homeTeam === "NL",
    detail: `${row.awayTeam}@${row.homeTeam}`,
  });
  checks.push({
    name: "isValidGame (AL/NL registered)",
    ok: MLB_VALID_ABBREVS.has(row.awayTeam) && MLB_VALID_ABBREVS.has(row.homeTeam),
  });
  checks.push({ name: "sport=MLB", ok: row.sport === "MLB", detail: row.sport });
  checks.push({ name: "no starting pitchers (model-runner safe)", ok: !row.awayStartingPitcher && !row.homeStartingPitcher });
  checks.push({ name: "modelRunAt set (card shows model)", ok: row.modelRunAt != null, detail: String(row.modelRunAt) });
  checks.push({ name: "publishedToFeed", ok: row.publishedToFeed === true });
  checks.push({ name: "publishedModel", ok: row.publishedModel === true });
  // Book (live)
  nn("book awayML", row.awayML);
  nn("book homeML", row.homeML);
  nn("book awayRunLine", row.awayRunLine);
  nn("book homeRunLine", row.homeRunLine);
  nn("book awayRunLineOdds", row.awayRunLineOdds);
  nn("book homeRunLineOdds", row.homeRunLineOdds);
  nn("book bookTotal", row.bookTotal);
  nn("book overOdds", row.overOdds);
  nn("book underOdds", row.underOdds);
  // Model
  nn("model modelAwayML", row.modelAwayML);
  nn("model modelHomeML", row.modelHomeML);
  nn("model awayModelSpread", row.awayModelSpread);
  nn("model homeModelSpread", row.homeModelSpread);
  nn("model modelAwaySpreadOdds", row.modelAwaySpreadOdds);
  nn("model modelHomeSpreadOdds", row.modelHomeSpreadOdds);
  nn("model modelTotal", row.modelTotal);
  nn("model modelOverOdds", row.modelOverOdds);
  nn("model modelUnderOdds", row.modelUnderOdds);

  return { pass: checks.every((c) => c.ok), checks };
}

/**
 * Seed/refresh the ASG row. dryRun scrapes + computes only; a real run inserts
 * (if needed), refreshes the book via the production path, writes the model, and
 * audits.
 */
export async function runMlbAllStarGameSync(opts: { dryRun: boolean }): Promise<AsgSyncResult> {
  const say = (s: string) => console.log(`${TAG} ${s}`);

  // 1. Scrape AN + locate the ASG + assert orientation.
  const anGames = await fetchActionNetworkOdds("mlb", MLB_ASG.gameDate);
  const asg = findAsgInSlate(anGames);
  if (!asg) throw new Error(`${TAG} ASG (anId=${MLB_ASG.anGameId}) not found in AN slate (${anGames.length} games) for ${MLB_ASG.gameDate}`);
  const orientationOk = asg.awayUrlSlug === MLB_ASG.awaySlug && asg.homeUrlSlug === MLB_ASG.homeSlug;
  if (!orientationOk) throw new Error(`${TAG} orientation mismatch: AN away=${asg.awayUrlSlug} home=${asg.homeUrlSlug} (expected ${MLB_ASG.awaySlug}@${MLB_ASG.homeSlug})`);

  const scrapedBook = bookFromAnGame(asg);
  say(`AN scrape ok: source=${scrapedBook.source} | AL ML ${scrapedBook.awayML} / NL ML ${scrapedBook.homeML} | AL ${scrapedBook.awaySpread}(${scrapedBook.awaySpreadOdds}) / NL ${scrapedBook.homeSpread}(${scrapedBook.homeSpreadOdds}) | Tot ${scrapedBook.total} O${scrapedBook.overOdds}/U${scrapedBook.underOdds}`);

  // ── Dry run: compute against the scrape, write nothing. ──────────────────────
  if (opts.dryRun) {
    const model = computeAsgModel(scrapedBook);
    const tail = buildTail(scrapedBook, model);
    say(`DRY RUN — nothing written.\n${tail}`);
    return {
      dryRun: true, wrote: false, gameId: null, orientationOk,
      bookSource: scrapedBook.source, book: scrapedBook, model,
      audit: { pass: true, checks: [{ name: "dry-run (no write)", ok: true }] }, tail,
    };
  }

  const db = await getDb();
  if (!db) throw new Error(`${TAG} database unavailable`);

  // 2. Ensure the games row exists (identity only; pitchers stay null).
  const findRow = () =>
    db.select().from(games).where(and(
      eq(games.gameDate, MLB_ASG.gameDate),
      eq(games.sport, "MLB"),
      eq(games.awayTeam, MLB_ASG.awayAbbr),
      eq(games.homeTeam, MLB_ASG.homeAbbr),
    ));

  let rows = await findRow();
  if (rows.length === 0) {
    await db.insert(games).values({
      fileId: 0,
      gameDate: MLB_ASG.gameDate,
      startTimeEst: MLB_ASG.startTimeEst,
      awayTeam: MLB_ASG.awayAbbr,
      homeTeam: MLB_ASG.homeAbbr,
      sport: "MLB",
      gameType: "regular_season",
      gameStatus: "upcoming",
      publishedToFeed: false,
      publishedModel: false,
    });
    rows = await findRow();
    say(`inserted ASG row id=${rows[0]?.id}`);
  } else {
    say(`ASG row exists id=${rows[0].id}`);
  }
  const gameId = rows[0].id;

  // 3. Refresh the BOOK via the production AN path (same code as every MLB game).
  const refresh = await refreshAnApiOdds(MLB_ASG.gameDate, ["mlb"], "manual");
  say(`refreshAnApiOdds: updated=${refresh.updated} skipped=${refresh.skipped} frozen=${refresh.frozen} errors=${refresh.errors.length}`);

  // 4. Read the freshly-written book + select the model rungs matching it.
  const afterRefresh = await db.select().from(games).where(eq(games.id, gameId));
  const rowBook = bookFromRow(afterRefresh[0]);
  const model = computeAsgModel(rowBook);
  say(`rung selection: run-line ${model.runLineRung} (book away spread ${rowBook.awaySpread}); total ${model.totalRung} (book total ${rowBook.total})`);

  // 5. Write ONLY the model columns + freshness/publish flags.
  const now = Date.now();
  await db.update(games).set({
    modelAwayML: model.modelAwayML,
    modelHomeML: model.modelHomeML,
    modelAwayWinPct: model.modelAwayWinPct,
    modelHomeWinPct: model.modelHomeWinPct,
    awayModelSpread: model.awayModelSpread,
    homeModelSpread: model.homeModelSpread,
    modelAwaySpreadOdds: model.modelAwaySpreadOdds,
    modelHomeSpreadOdds: model.modelHomeSpreadOdds,
    modelAwayPLCoverPct: model.modelAwayPLCoverPct,
    modelHomePLCoverPct: model.modelHomePLCoverPct,
    modelTotal: model.modelTotal,
    modelOverOdds: model.modelOverOdds,
    modelUnderOdds: model.modelUnderOdds,
    modelOverRate: model.modelOverRate,
    modelUnderRate: model.modelUnderRate,
    modelRunAt: now,
    publishedToFeed: true,
    publishedModel: true,
  }).where(eq(games.id, gameId));
  say(`model written id=${gameId} modelRunAt=${now}`);

  // 6. Audit the final state.
  const finalRows = await db.select().from(games).where(eq(games.id, gameId));
  const audit = auditRow(finalRows[0]);
  const tail = buildTail(bookFromRow(finalRows[0]), model);
  say(`AUDIT ${audit.pass ? "PASS" : "FAIL"} — ${audit.checks.filter((c) => c.ok).length}/${audit.checks.length} checks ok`);
  if (!audit.pass) {
    for (const c of audit.checks.filter((c) => !c.ok)) say(`  ✗ ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  }
  say(`\n${tail}`);

  return {
    dryRun: false, wrote: true, gameId, orientationOk,
    bookSource: rowBook.source, book: rowBook, model, audit, tail,
  };
}
