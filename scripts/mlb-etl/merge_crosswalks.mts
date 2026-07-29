/**
 * Task 5 — no-loss crosswalk merge. Idempotent, UPDATE-only merge that copies identity
 * (crosswalk) values from the 17 legacy MLB tables onto the canonical `mlb_*` tables
 * (drizzle/mlb.schema.ts). Never overwrites a non-null canonical value, never modifies any
 * legacy table except populating the new nullable `mlb_schedule_history.gamePk` column, and
 * never deletes anything.
 *
 * Ground truth: .superpowers/sdd/task-5-brief.md,
 * docs/audits/2026-07-28-mlb-column-disposition.md, docs/audits/2026-07-28-mlb-reconciliation.md.
 *
 * The mlb_schedule_history away/home team-identity reversal found by the reconciliation
 * (~3,642 rows, 2023-2025) is NOT "fixed" here — this script only assigns a `gamePk` value
 * (matching in either orientation) and reports orientation stats. Legacy away-team/home-team
 * columns are left untouched.
 *
 * Usage (DATABASE_URL is not in any local .env — must come from Railway):
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/merge_crosswalks.mts --dry-run
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/merge_crosswalks.mts
 *
 * NEVER print, log, or persist DATABASE_URL.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const TAG = "[MergeCrosswalks]";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const AUDITS_DIR = join(REPO, "docs", "audits");
const REPORT_PATH = join(AUDITS_DIR, "2026-07-28-mlb-merge-report.md");
const UNMATCHED_PLAYERS_CSV = join(AUDITS_DIR, "2026-07-28-unmatched-legacy-players.csv");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── generic helpers ───────────────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sortedPairKey(a: number, b: number): string {
  return a <= b ? `${a}_${b}` : `${b}_${a}`;
}

/** First-seen-wins accumulator for a mlbamId -> value crosswalk harvest, with conflict tracking. */
class HarvestMap<V> {
  readonly first = new Map<number, { value: V; source: string }>();
  readonly conflicts: { mlbamId: number; firstValue: V; firstSource: string; laterValue: V; laterSource: string }[] = [];

  see(mlbamId: number | null | undefined, value: V | null | undefined, source: string): void {
    if (mlbamId === null || mlbamId === undefined) return;
    if (value === null || value === undefined || value === "") return;
    const existing = this.first.get(mlbamId);
    if (!existing) {
      this.first.set(mlbamId, { value, source });
      return;
    }
    if (existing.value !== value) {
      this.conflicts.push({
        mlbamId,
        firstValue: existing.value,
        firstSource: existing.source,
        laterValue: value,
        laterSource: source,
      });
    }
  }
}

interface ColumnMergeStats {
  label: string;
  updated: number;
  alreadyConsistent: number;
  conflicts: { key: string; existing: unknown; attempted: unknown; source?: string }[];
  unmatchedTargets: { mlbamIdOrKey: unknown; reason: string }[];
}

function newStats(label: string): ColumnMergeStats {
  return { label, updated: 0, alreadyConsistent: 0, conflicts: [], unmatchedTargets: [] };
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(`${TAG} DATABASE_URL is not set — aborting.`);
    process.exit(1);
  }

  console.log(`${TAG} mode=${DRY_RUN ? "DRY-RUN" : "REAL"}`);

  const pool = mysql.createPool({
    uri: dbUrl,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 50,
    connectTimeout: 15000,
    idleTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // DATE/DATETIME columns must come back as plain 'YYYY-MM-DD[ HH:MM:SS]' strings — the
    // schedule_history<->games join keys on exact date-string equality, and mysql2's default
    // JS-Date conversion (with implicit local-timezone rendering) would silently break every match.
    dateStrings: true,
  });

  const reportLines: string[] = [];
  reportLines.push(`# MLB Canonical Database — Task 5 Crosswalk Merge Report`);
  reportLines.push("");
  reportLines.push(`**Generated:** ${new Date().toISOString()} (${DRY_RUN ? "DRY-RUN" : "REAL RUN"})`);
  reportLines.push("");
  reportLines.push(
    `Ground truth: \`.superpowers/sdd/task-5-brief.md\`, ` +
      `\`docs/audits/2026-07-28-mlb-column-disposition.md\`, \`docs/audits/2026-07-28-mlb-reconciliation.md\`.`,
  );
  reportLines.push("");

  try {
    // ─── 1. mlb_teams → mlb_franchises ─────────────────────────────────────────────────────
    const teamsResult = await mergeTeamsToFranchises(pool);
    appendCrosswalkSection(reportLines, "1. `mlb_teams` → `mlb_franchises`", teamsResult);

    // ─── 2. mlb_players → mlb_people.br_id ─────────────────────────────────────────────────
    const playersResult = await mergePlayersToPeople(pool);
    appendCrosswalkSection(reportLines, "2. `mlb_players` → `mlb_people.br_id`", playersResult.stats);
    reportLines.push(
      `Null-\`mlbamId\` legacy rows: **${playersResult.nullMlbamIdRows.length}**. ` +
        `\`mlbamId\`-present-but-no-matching-\`mlb_people\`-row: **${playersResult.noPeopleMatchRows.length}**.`,
    );
    reportLines.push("");
    if (playersResult.unmatchedForCsv.length > 0) {
      writeUnmatchedPlayersCsv(playersResult.unmatchedForCsv);
      reportLines.push(
        `Unmatched legacy players (${playersResult.unmatchedForCsv.length}) written to ` +
          `\`docs/audits/2026-07-28-unmatched-legacy-players.csv\`.`,
      );
    } else {
      reportLines.push(`No unmatched legacy players — CSV not written.`);
    }
    reportLines.push("");

    // ─── 3. harvest crosswalks (rotowire_id / an_player_id / retrosheet_id) ───────────────
    const harvestResult = await mergeHarvestCrosswalks(pool);
    reportLines.push(`## 3. Harvest crosswalks → \`mlb_people\` (rotowire_id / an_player_id / retrosheet_id)`);
    reportLines.push("");
    reportLines.push(
      `First-seen-wins scan order: \`mlb_lineups\` (id ASC; per row: away pitcher, home pitcher, ` +
        `away lineup batters in array order, home lineup batters in array order) → \`mlb_hr_props\` ` +
        `(id ASC, an_player_id) → \`mlb_strikeout_props\` (id ASC, an_player_id then retrosheet_id).`,
    );
    reportLines.push("");
    appendCrosswalkSection(reportLines, "3a. `rotowire_id`", harvestResult.rotowire.stats);
    reportLines.push(`Harvest-source conflicts (same mlbamId, different rotowireId seen later): **${harvestResult.rotowire.harvestConflicts.length}**.`);
    if (harvestResult.rotowire.harvestConflicts.length > 0) {
      reportLines.push("");
      reportLines.push(`| mlbamId | first value | first source | later value | later source |`);
      reportLines.push(`|---|---|---|---|---|`);
      for (const c of harvestResult.rotowire.harvestConflicts) {
        reportLines.push(`| ${c.mlbamId} | ${c.firstValue} | ${c.firstSource} | ${c.laterValue} | ${c.laterSource} |`);
      }
    }
    reportLines.push("");
    appendCrosswalkSection(reportLines, "3b. `an_player_id`", harvestResult.anPlayer.stats);
    reportLines.push(`Harvest-source conflicts: **${harvestResult.anPlayer.harvestConflicts.length}**.`);
    if (harvestResult.anPlayer.harvestConflicts.length > 0) {
      reportLines.push("");
      reportLines.push(`| mlbamId | first value | first source | later value | later source |`);
      reportLines.push(`|---|---|---|---|---|`);
      for (const c of harvestResult.anPlayer.harvestConflicts) {
        reportLines.push(`| ${c.mlbamId} | ${c.firstValue} | ${c.firstSource} | ${c.laterValue} | ${c.laterSource} |`);
      }
    }
    reportLines.push("");
    appendCrosswalkSection(reportLines, "3c. `retrosheet_id`", harvestResult.retrosheet.stats);
    reportLines.push(`Harvest-source conflicts: **${harvestResult.retrosheet.harvestConflicts.length}**.`);
    if (harvestResult.retrosheet.harvestConflicts.length > 0) {
      reportLines.push("");
      reportLines.push(`| mlbamId | first value | first source | later value | later source |`);
      reportLines.push(`|---|---|---|---|---|`);
      for (const c of harvestResult.retrosheet.harvestConflicts) {
        reportLines.push(`| ${c.mlbamId} | ${c.firstValue} | ${c.firstSource} | ${c.laterValue} | ${c.laterSource} |`);
      }
    }
    reportLines.push("");

    // ─── 4. mlb_schedule_history.gamePk population ────────────────────────────────────────
    const scheduleResult = await mergeScheduleHistoryGamePk(pool);
    reportLines.push(`## 4. \`mlb_schedule_history.gamePk\` population`);
    reportLines.push("");
    reportLines.push(`| Metric | Count |`);
    reportLines.push(`|---|---:|`);
    reportLines.push(`| Total rows | ${scheduleResult.totalRows} |`);
    reportLines.push(`| Spring training (out of scope) | ${scheduleResult.springTraining} |`);
    reportLines.push(`| Cancelled | ${scheduleResult.cancelled} |`);
    reportLines.push(`| No AN-slug crosswalk | ${scheduleResult.noSlugCrosswalk} |`);
    reportLines.push(`| Eligible | ${scheduleResult.eligible} |`);
    reportLines.push(`| Matched — direct orientation | ${scheduleResult.directMatches} |`);
    reportLines.push(`| Matched — swap orientation | ${scheduleResult.swapMatches} |`);
    reportLines.push(`| Total matched | ${scheduleResult.directMatches + scheduleResult.swapMatches} |`);
    reportLines.push(`| Already had non-null gamePk (skipped, idempotency) | ${scheduleResult.alreadySet} |`);
    reportLines.push(`| **Newly updated this run** | **${scheduleResult.updated}** |`);
    reportLines.push(`| Conflicts (existing gamePk differs from computed match) | ${scheduleResult.conflicts.length} |`);
    reportLines.push(`| Truly unmatched | ${scheduleResult.unmatched.length} |`);
    reportLines.push("");
    reportLines.push(`### Orientation stats by season`);
    reportLines.push("");
    reportLines.push(`| Season | Direct | Swap |`);
    reportLines.push(`|---|---:|---:|`);
    for (const season of Object.keys(scheduleResult.orientationBySeason).sort()) {
      const s = scheduleResult.orientationBySeason[season];
      reportLines.push(`| ${season} | ${s.direct} | ${s.swap} |`);
    }
    reportLines.push("");
    if (scheduleResult.conflicts.length > 0) {
      reportLines.push(`### Conflicts (${scheduleResult.conflicts.length})`);
      reportLines.push("");
      reportLines.push(`| id | anGameId | gameDate | existing gamePk | computed gamePk |`);
      reportLines.push(`|---|---|---|---|---|`);
      for (const c of scheduleResult.conflicts) {
        reportLines.push(`| ${c.id} | ${c.anGameId} | ${c.gameDate} | ${c.existing} | ${c.computed} |`);
      }
      reportLines.push("");
    }
    reportLines.push(`### Unmatched (${scheduleResult.unmatched.length})`);
    reportLines.push("");
    if (scheduleResult.unmatched.length > 0) {
      reportLines.push(`| id | anGameId | gameDate | awaySlug | homeSlug | gameStatus | reason |`);
      reportLines.push(`|---|---|---|---|---|---|---|`);
      for (const u of scheduleResult.unmatched) {
        reportLines.push(
          `| ${u.id} | ${u.anGameId} | ${u.gameDate} | ${u.awaySlug} | ${u.homeSlug} | ${u.gameStatus} | ${u.reason} |`,
        );
      }
    } else {
      reportLines.push(`(none)`);
    }
    reportLines.push("");

    // ─── write report ───────────────────────────────────────────────────────────────────
    mkdirSync(AUDITS_DIR, { recursive: true });
    writeFileSync(REPORT_PATH, reportLines.join("\n") + "\n");
    console.log(`${TAG} report written: ${REPORT_PATH}`);

    console.log(`${TAG} complete (${DRY_RUN ? "dry-run — no writes performed" : "real run"}).`);
  } finally {
    await pool.end();
  }
}

function appendCrosswalkSection(lines: string[], title: string, stats: ColumnMergeStats[]): void {
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`| Column | Updated | Already consistent | Conflicts | Unmatched targets |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const s of stats) {
    lines.push(`| ${s.label} | ${s.updated} | ${s.alreadyConsistent} | ${s.conflicts.length} | ${s.unmatchedTargets.length} |`);
  }
  lines.push("");
  for (const s of stats) {
    if (s.conflicts.length > 0) {
      lines.push(`**${s.label} conflicts (${s.conflicts.length}):**`);
      lines.push("");
      lines.push(`| key | existing | attempted | source |`);
      lines.push(`|---|---|---|---|`);
      for (const c of s.conflicts) {
        lines.push(`| ${c.key} | ${c.existing} | ${c.attempted} | ${c.source ?? ""} |`);
      }
      lines.push("");
    }
    if (s.unmatchedTargets.length > 0) {
      lines.push(`**${s.label} unmatched targets (${s.unmatchedTargets.length}):**`);
      lines.push("");
      lines.push(`| key | reason |`);
      lines.push(`|---|---|`);
      for (const u of s.unmatchedTargets) {
        lines.push(`| ${u.mlbamIdOrKey} | ${u.reason} |`);
      }
      lines.push("");
    }
  }
}

// ─── 1. mlb_teams → mlb_franchises ─────────────────────────────────────────────────────────

interface LegacyTeamRow {
  mlbId: number | null;
  dbSlug: string | null;
  mlbCode: string | null;
  abbrev: string | null;
  vsinSlug: string | null;
  anSlug: string | null;
  anLogoSlug: string | null;
  brAbbrev: string | null;
  name: string | null;
}

interface FranchiseRow {
  team_id: number;
  db_slug: string | null;
  mlb_code: string | null;
  abbrev: string | null;
  vsin_slug: string | null;
  an_slug: string | null;
  an_logo_slug: string | null;
  br_abbrev: string | null;
  name: string | null;
}

const TEAM_CROSSWALK_COLS: { legacy: keyof LegacyTeamRow; canonical: keyof FranchiseRow; label: string }[] = [
  { legacy: "dbSlug", canonical: "db_slug", label: "db_slug" },
  { legacy: "mlbCode", canonical: "mlb_code", label: "mlb_code" },
  { legacy: "abbrev", canonical: "abbrev", label: "abbrev" },
  { legacy: "vsinSlug", canonical: "vsin_slug", label: "vsin_slug" },
  { legacy: "anSlug", canonical: "an_slug", label: "an_slug" },
  { legacy: "anLogoSlug", canonical: "an_logo_slug", label: "an_logo_slug" },
  { legacy: "brAbbrev", canonical: "br_abbrev", label: "br_abbrev" },
  { legacy: "name", canonical: "name", label: "name" },
];

async function mergeTeamsToFranchises(pool: mysql.Pool): Promise<ColumnMergeStats[]> {
  const [teamRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT mlbId, dbSlug, mlbCode, abbrev, vsinSlug, anSlug, anLogoSlug, brAbbrev, name FROM mlb_teams`,
  );
  const [franchiseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT team_id, db_slug, mlb_code, abbrev, vsin_slug, an_slug, an_logo_slug, br_abbrev, name FROM mlb_franchises`,
  );
  const franchisesById = new Map<number, FranchiseRow>();
  for (const r of franchiseRows as unknown as FranchiseRow[]) franchisesById.set(r.team_id, r);

  const statsByCol = new Map<string, ColumnMergeStats>();
  for (const c of TEAM_CROSSWALK_COLS) statsByCol.set(c.label, newStats(c.label));
  const nullMlbIdStats = newStats("mlbId null (finding)");
  const noFranchiseStats = newStats("mlbId not found in mlb_franchises");

  const updates: { teamId: number; sets: string[]; values: unknown[] }[] = [];

  for (const t of teamRows as unknown as LegacyTeamRow[]) {
    if (t.mlbId === null || t.mlbId === undefined) {
      nullMlbIdStats.unmatchedTargets.push({ mlbamIdOrKey: JSON.stringify(t), reason: "mlb_teams.mlbId is NULL" });
      continue;
    }
    const franchise = franchisesById.get(t.mlbId);
    if (!franchise) {
      noFranchiseStats.unmatchedTargets.push({
        mlbamIdOrKey: t.mlbId,
        reason: "no mlb_franchises row with this team_id",
      });
      continue;
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const c of TEAM_CROSSWALK_COLS) {
      const legacyVal = t[c.legacy];
      const canonicalVal = franchise[c.canonical];
      const stats = statsByCol.get(c.label)!;
      if (legacyVal === null || legacyVal === undefined || legacyVal === "") continue;
      if (canonicalVal === null || canonicalVal === undefined) {
        stats.updated++;
        sets.push(`${c.canonical} = ?`);
        values.push(legacyVal);
      } else if (canonicalVal === legacyVal) {
        stats.alreadyConsistent++;
      } else {
        stats.conflicts.push({ key: `team_id=${t.mlbId}`, existing: canonicalVal, attempted: legacyVal });
      }
    }
    if (sets.length > 0) updates.push({ teamId: t.mlbId, sets, values });
  }

  if (!DRY_RUN) {
    for (const u of updates) {
      await pool.query(`UPDATE mlb_franchises SET ${u.sets.join(", ")} WHERE team_id = ?`, [...u.values, u.teamId]);
    }
  }

  console.log(
    `${TAG} [1/4] mlb_teams->mlb_franchises: ${updates.length} rows would update ${updates.reduce((n, u) => n + u.sets.length, 0)} cells`,
  );

  return [...statsByCol.values(), nullMlbIdStats, noFranchiseStats];
}

// ─── 2. mlb_players → mlb_people.br_id ─────────────────────────────────────────────────────

interface LegacyPlayerRow {
  id: number;
  brId: string;
  mlbamId: number | null;
  name: string;
}

async function mergePlayersToPeople(pool: mysql.Pool): Promise<{
  stats: ColumnMergeStats[];
  nullMlbamIdRows: LegacyPlayerRow[];
  noPeopleMatchRows: LegacyPlayerRow[];
  unmatchedForCsv: (LegacyPlayerRow & { reason: string })[];
}> {
  const [playerRows] = await pool.query<mysql.RowDataPacket[]>(`SELECT id, brId, mlbamId, name FROM mlb_players`);
  const [peopleRows] = await pool.query<mysql.RowDataPacket[]>(`SELECT mlbam_id, br_id FROM mlb_people`);
  const peopleById = new Map<number, { br_id: string | null }>();
  for (const r of peopleRows as unknown as { mlbam_id: number; br_id: string | null }[]) {
    peopleById.set(r.mlbam_id, { br_id: r.br_id });
  }

  const stats = newStats("br_id");
  const nullMlbamIdRows: LegacyPlayerRow[] = [];
  const noPeopleMatchRows: LegacyPlayerRow[] = [];
  const unmatchedForCsv: (LegacyPlayerRow & { reason: string })[] = [];

  const updates: { mlbamId: number; brId: string }[] = [];

  for (const p of playerRows as unknown as LegacyPlayerRow[]) {
    if (p.mlbamId === null || p.mlbamId === undefined) {
      nullMlbamIdRows.push(p);
      unmatchedForCsv.push({ ...p, reason: "null_mlbamId" });
      continue;
    }
    const person = peopleById.get(p.mlbamId);
    if (!person) {
      noPeopleMatchRows.push(p);
      unmatchedForCsv.push({ ...p, reason: "mlbamId_not_in_mlb_people" });
      continue;
    }
    if (!p.brId) continue; // brId is NOT NULL/unique in legacy schema, defensive only
    if (person.br_id === null || person.br_id === undefined) {
      stats.updated++;
      updates.push({ mlbamId: p.mlbamId, brId: p.brId });
    } else if (person.br_id === p.brId) {
      stats.alreadyConsistent++;
    } else {
      stats.conflicts.push({ key: `mlbamId=${p.mlbamId}`, existing: person.br_id, attempted: p.brId });
    }
  }

  if (!DRY_RUN) {
    for (const u of updates) {
      await pool.query(`UPDATE mlb_people SET br_id = ? WHERE mlbam_id = ? AND br_id IS NULL`, [u.brId, u.mlbamId]);
    }
  }

  console.log(`${TAG} [2/4] mlb_players->mlb_people.br_id: ${updates.length} rows would update`);

  return { stats: [stats], nullMlbamIdRows, noPeopleMatchRows, unmatchedForCsv };
}

function writeUnmatchedPlayersCsv(rows: (LegacyPlayerRow & { reason: string })[]): void {
  const header = "id,brId,mlbamId,name,reason";
  const lines = rows.map((r) => [r.id, r.brId, r.mlbamId ?? "", r.name, r.reason].map(csvEscape).join(","));
  mkdirSync(AUDITS_DIR, { recursive: true });
  writeFileSync(UNMATCHED_PLAYERS_CSV, [header, ...lines].join("\n") + "\n");
}

// ─── 3. harvest crosswalks (rotowire_id / an_player_id / retrosheet_id) ───────────────────

interface LineupPlayerJson {
  mlbamId: number | null;
  rotowireId: number | null;
}

function parseLineupJson(text: string | null): LineupPlayerJson[] {
  if (!text) return [];
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.map((p: any) => ({
      mlbamId: typeof p?.mlbamId === "number" ? p.mlbamId : null,
      rotowireId: typeof p?.rotowireId === "number" ? p.rotowireId : null,
    }));
  } catch {
    return [];
  }
}

async function mergeHarvestCrosswalks(pool: mysql.Pool): Promise<{
  rotowire: { stats: ColumnMergeStats[]; harvestConflicts: HarvestMap<number>["conflicts"] };
  anPlayer: { stats: ColumnMergeStats[]; harvestConflicts: HarvestMap<number>["conflicts"] };
  retrosheet: { stats: ColumnMergeStats[]; harvestConflicts: HarvestMap<string>["conflicts"] };
}> {
  const rotowireHarvest = new HarvestMap<number>();
  const anPlayerHarvest = new HarvestMap<number>();
  const retrosheetHarvest = new HarvestMap<string>();

  // mlb_lineups: away pitcher, home pitcher, then batters in each JSON lineup array
  const [lineupRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, awayPitcherMlbamId, awayPitcherRotowireId, homePitcherMlbamId, homePitcherRotowireId,
            awayLineup, homeLineup
     FROM mlb_lineups ORDER BY id ASC`,
  );
  for (const r of lineupRows as unknown as {
    id: number;
    awayPitcherMlbamId: number | null;
    awayPitcherRotowireId: number | null;
    homePitcherMlbamId: number | null;
    homePitcherRotowireId: number | null;
    awayLineup: string | null;
    homeLineup: string | null;
  }[]) {
    rotowireHarvest.see(r.awayPitcherMlbamId, r.awayPitcherRotowireId, `mlb_lineups#${r.id}.awayPitcher`);
    rotowireHarvest.see(r.homePitcherMlbamId, r.homePitcherRotowireId, `mlb_lineups#${r.id}.homePitcher`);
    const awayBatters = parseLineupJson(r.awayLineup);
    awayBatters.forEach((b, i) => rotowireHarvest.see(b.mlbamId, b.rotowireId, `mlb_lineups#${r.id}.awayLineup[${i}]`));
    const homeBatters = parseLineupJson(r.homeLineup);
    homeBatters.forEach((b, i) => rotowireHarvest.see(b.mlbamId, b.rotowireId, `mlb_lineups#${r.id}.homeLineup[${i}]`));
  }

  // mlb_hr_props: (mlbamId, anPlayerId)
  const [hrRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, mlbamId, anPlayerId FROM mlb_hr_props ORDER BY id ASC`,
  );
  for (const r of hrRows as unknown as { id: number; mlbamId: number | null; anPlayerId: number | null }[]) {
    anPlayerHarvest.see(r.mlbamId, r.anPlayerId, `mlb_hr_props#${r.id}`);
  }

  // mlb_strikeout_props: (mlbamId, anPlayerId) and (mlbamId, retrosheetId)
  const [koRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, mlbamId, anPlayerId, retrosheetId FROM mlb_strikeout_props ORDER BY id ASC`,
  );
  for (const r of koRows as unknown as {
    id: number;
    mlbamId: number | null;
    anPlayerId: number | null;
    retrosheetId: string | null;
  }[]) {
    anPlayerHarvest.see(r.mlbamId, r.anPlayerId, `mlb_strikeout_props#${r.id}`);
    retrosheetHarvest.see(r.mlbamId, r.retrosheetId, `mlb_strikeout_props#${r.id}`);
  }

  const [peopleRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT mlbam_id, rotowire_id, an_player_id, retrosheet_id FROM mlb_people`,
  );
  const peopleById = new Map<
    number,
    { rotowire_id: number | null; an_player_id: number | null; retrosheet_id: string | null }
  >();
  for (const r of peopleRows as unknown as {
    mlbam_id: number;
    rotowire_id: number | null;
    an_player_id: number | null;
    retrosheet_id: string | null;
  }[]) {
    peopleById.set(r.mlbam_id, { rotowire_id: r.rotowire_id, an_player_id: r.an_player_id, retrosheet_id: r.retrosheet_id });
  }

  async function applyHarvest<V>(
    harvest: HarvestMap<V>,
    column: "rotowire_id" | "an_player_id" | "retrosheet_id",
    label: string,
  ): Promise<ColumnMergeStats> {
    const stats = newStats(label);
    const updates: { mlbamId: number; value: V }[] = [];
    for (const [mlbamId, entry] of harvest.first) {
      const person = peopleById.get(mlbamId);
      if (!person) {
        stats.unmatchedTargets.push({ mlbamIdOrKey: mlbamId, reason: "mlbamId not in mlb_people" });
        continue;
      }
      const existing = person[column];
      if (existing === null || existing === undefined) {
        stats.updated++;
        updates.push({ mlbamId, value: entry.value });
      } else if (existing === entry.value) {
        stats.alreadyConsistent++;
      } else {
        stats.conflicts.push({
          key: `mlbamId=${mlbamId}`,
          existing,
          attempted: entry.value,
          source: entry.source,
        });
      }
    }
    if (!DRY_RUN) {
      for (const u of updates) {
        await pool.query(`UPDATE mlb_people SET ${column} = ? WHERE mlbam_id = ? AND ${column} IS NULL`, [
          u.value,
          u.mlbamId,
        ]);
      }
    }
    console.log(`${TAG} [3/4] harvest ${column}: ${updates.length} rows would update`);
    return stats;
  }

  const rotowireStats = await applyHarvest(rotowireHarvest, "rotowire_id", "rotowire_id");
  const anPlayerStats = await applyHarvest(anPlayerHarvest, "an_player_id", "an_player_id");
  const retrosheetStats = await applyHarvest(retrosheetHarvest, "retrosheet_id", "retrosheet_id");

  return {
    rotowire: { stats: [rotowireStats], harvestConflicts: rotowireHarvest.conflicts },
    anPlayer: { stats: [anPlayerStats], harvestConflicts: anPlayerHarvest.conflicts },
    retrosheet: { stats: [retrosheetStats], harvestConflicts: retrosheetHarvest.conflicts },
  };
}

// ─── 4. mlb_schedule_history.gamePk population ─────────────────────────────────────────────

interface ScheduleRow {
  id: number;
  anGameId: number;
  gameDate: string;
  startTimeUtc: string;
  gameStatus: string;
  game_type: string | null;
  gamePk: number | null;
  awaySlug: string;
  homeSlug: string;
}

interface GameRow {
  game_pk: number;
  official_date: string;
  game_datetime_utc: string;
  game_number: number;
  away_team_id: number;
  home_team_id: number;
}

async function mergeScheduleHistoryGamePk(pool: mysql.Pool): Promise<{
  totalRows: number;
  springTraining: number;
  cancelled: number;
  noSlugCrosswalk: number;
  eligible: number;
  directMatches: number;
  swapMatches: number;
  alreadySet: number;
  updated: number;
  conflicts: { id: number; anGameId: number; gameDate: string; existing: number; computed: number }[];
  unmatched: { id: number; anGameId: number; gameDate: string; awaySlug: string; homeSlug: string; gameStatus: string; reason: string }[];
  orientationBySeason: Record<string, { direct: number; swap: number }>;
}> {
  // AN-slug -> statsapi mlbId crosswalk (verified clean 30/30 in reconciliation)
  const [teamRows] = await pool.query<mysql.RowDataPacket[]>(`SELECT anSlug, mlbId FROM mlb_teams`);
  const slugToMlbId = new Map<string, number>();
  for (const r of teamRows as unknown as { anSlug: string; mlbId: number }[]) slugToMlbId.set(r.anSlug, r.mlbId);

  const [schRowsRaw] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, anGameId, gameDate, startTimeUtc, gameStatus, game_type, gamePk, awaySlug, homeSlug
     FROM mlb_schedule_history`,
  );
  const schRows = schRowsRaw as unknown as ScheduleRow[];

  const [gameRowsRaw] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT game_pk, official_date, game_datetime_utc, game_number, away_team_id, home_team_id
     FROM mlb_games WHERE game_type != 'S'`,
  );
  const gameRows = gameRowsRaw as unknown as GameRow[];

  // Group mlb_games by (official_date, sorted team pair), sorted by game_number asc (tie: game_pk asc)
  const gamesByKey = new Map<string, GameRow[]>();
  for (const g of gameRows) {
    const key = `${g.official_date}|${sortedPairKey(g.away_team_id, g.home_team_id)}`;
    if (!gamesByKey.has(key)) gamesByKey.set(key, []);
    gamesByKey.get(key)!.push(g);
  }
  for (const list of gamesByKey.values()) {
    list.sort((a, b) => a.game_number - b.game_number || a.game_pk - b.game_pk);
  }

  let totalRows = schRows.length;
  let springTraining = 0;
  let cancelled = 0;
  let noSlugCrosswalk = 0;
  const eligibleRows: (ScheduleRow & { awayMlbId: number; homeMlbId: number })[] = [];

  for (const s of schRows) {
    if (s.game_type === "spring_training") {
      springTraining++;
      continue;
    }
    if (s.gameStatus === "cancelled") {
      cancelled++;
      continue;
    }
    const awayMlbId = slugToMlbId.get(s.awaySlug);
    const homeMlbId = slugToMlbId.get(s.homeSlug);
    if (awayMlbId === undefined || homeMlbId === undefined) {
      noSlugCrosswalk++;
      continue;
    }
    eligibleRows.push({ ...s, awayMlbId, homeMlbId });
  }

  // Group eligible schedule rows by (gameDate, sorted team pair), sorted by startTimeUtc asc (tie: id asc)
  const schByKey = new Map<string, (ScheduleRow & { awayMlbId: number; homeMlbId: number })[]>();
  for (const s of eligibleRows) {
    const key = `${s.gameDate}|${sortedPairKey(s.awayMlbId, s.homeMlbId)}`;
    if (!schByKey.has(key)) schByKey.set(key, []);
    schByKey.get(key)!.push(s);
  }
  for (const list of schByKey.values()) {
    list.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc) || a.id - b.id);
  }

  let directMatches = 0;
  let swapMatches = 0;
  let alreadySet = 0;
  let updated = 0;
  const conflicts: { id: number; anGameId: number; gameDate: string; existing: number; computed: number }[] = [];
  const unmatched: {
    id: number;
    anGameId: number;
    gameDate: string;
    awaySlug: string;
    homeSlug: string;
    gameStatus: string;
    reason: string;
  }[] = [];
  const orientationBySeason: Record<string, { direct: number; swap: number }> = {};
  const updates: { id: number; gamePk: number }[] = [];

  for (const [key, schGroup] of schByKey) {
    const gamesGroup = gamesByKey.get(key) ?? [];
    for (let i = 0; i < schGroup.length; i++) {
      const s = schGroup[i];
      if (i >= gamesGroup.length) {
        unmatched.push({
          id: s.id,
          anGameId: s.anGameId,
          gameDate: s.gameDate,
          awaySlug: s.awaySlug,
          homeSlug: s.homeSlug,
          gameStatus: s.gameStatus,
          reason: "no corresponding mlb_games row (postponed/never re-tracked or genuinely missing)",
        });
        continue;
      }
      const g = gamesGroup[i];
      const orientation = g.away_team_id === s.awayMlbId ? "direct" : "swap";
      if (orientation === "direct") directMatches++;
      else swapMatches++;
      const season = s.gameDate.slice(0, 4);
      if (!orientationBySeason[season]) orientationBySeason[season] = { direct: 0, swap: 0 };
      orientationBySeason[season][orientation]++;

      if (s.gamePk === null || s.gamePk === undefined) {
        updated++;
        updates.push({ id: s.id, gamePk: g.game_pk });
      } else if (s.gamePk === g.game_pk) {
        alreadySet++;
      } else {
        conflicts.push({ id: s.id, anGameId: s.anGameId, gameDate: s.gameDate, existing: s.gamePk, computed: g.game_pk });
      }
    }
  }

  if (!DRY_RUN) {
    for (const u of updates) {
      await pool.query(`UPDATE mlb_schedule_history SET gamePk = ? WHERE id = ? AND gamePk IS NULL`, [
        u.gamePk,
        u.id,
      ]);
    }
  }

  console.log(`${TAG} [4/4] mlb_schedule_history.gamePk: ${updates.length} rows would update`);

  return {
    totalRows,
    springTraining,
    cancelled,
    noSlugCrosswalk,
    eligible: eligibleRows.length,
    directMatches,
    swapMatches,
    alreadySet,
    updated,
    conflicts,
    unmatched,
    orientationBySeason,
  };
}

main().catch((err) => {
  console.error(`${TAG} FATAL:`, err?.message ?? err);
  process.exit(1);
});
