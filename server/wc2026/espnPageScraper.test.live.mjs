/**
 * espnPageScraper.test.live.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Live integration test for the 100x ESPN Page Scraper.
 * Validates all 13 tables using the EXACT field names from the scraper output.
 *
 * Usage:
 *   node server/wc2026/espnPageScraper.test.live.mjs
 */

import { spawnSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
const logDir = join(projectRoot, ".manus-logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

// ── ANSI colors ────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", blue: "\x1b[34m", magenta: "\x1b[35m",
};

function banner(title, color = C.blue) {
  const line = "═".repeat(72);
  console.log(`\n${C.bold}${color}${line}${C.reset}`);
  console.log(`${C.bold}${color}  ${title}${C.reset}`);
  console.log(`${C.bold}${color}${line}${C.reset}\n`);
}
function pass(label, detail = "") {
  console.log(`  ${C.green}${C.bold}✓ PASS${C.reset}  ${label}${detail ? C.dim + "  " + detail + C.reset : ""}`);
}
function fail(label, detail = "") {
  console.log(`  ${C.red}${C.bold}✗ FAIL${C.reset}  ${label}${detail ? C.dim + "  " + detail + C.reset : ""}`);
}
function section(title) {
  console.log(`\n  ${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}

// ── Main test ──────────────────────────────────────────────────────────────
banner("ESPN PAGE SCRAPER — LIVE INTEGRATION TEST v2", C.cyan);
console.log(`  ${C.dim}Target: https://www.espn.com/soccer/player-stats/_/gameId/760487${C.reset}`);
console.log(`  ${C.dim}Tables: 13 required | Mode: DIRECT PAGE SCRAPE — ZERO API FALLBACK${C.reset}\n`);

const resultFile = join(logDir, "espn-page-scraper-result.json");
const runnerScript = `
import { scrapeEspnMatchPage } from "${join(__dirname, "espnPageScraper.ts")}";
import { writeFileSync } from "fs";
const data = await scrapeEspnMatchPage("760487", { logDir: "${logDir}", saveHtml: false });
writeFileSync("${resultFile}", JSON.stringify(data, null, 2));
process.stderr.write("[RUNNER] Done\\n");
`;

const tmpScript = join(logDir, "_test_runner.mts");
writeFileSync(tmpScript, runnerScript);

const t0 = Date.now();
let result;

try {
  console.log(`  ${C.bold}Launching Playwright scraper...${C.reset}`);
  console.log(`  ${C.dim}(60-120s for 3 ESPN page loads — logger output below)${C.reset}\n`);
  console.log(`  ${"─".repeat(68)}`);

  const proc = spawnSync(
    join(projectRoot, "node_modules/.bin/tsx"),
    [tmpScript],
    { cwd: projectRoot, timeout: 300_000, maxBuffer: 50 * 1024 * 1024, stdio: ["inherit", "inherit", "inherit"] }
  );

  if (proc.status !== 0) {
    const elapsed = Date.now() - t0;
    banner(`SCRAPER PROCESS FAILED (exit ${proc.status}, ${(elapsed/1000).toFixed(1)}s)`, C.red);
    if (proc.error) console.error(proc.error);
    process.exit(1);
  }

  if (!existsSync(resultFile)) {
    banner("RESULT FILE NOT FOUND", C.red);
    process.exit(1);
  }

  result = JSON.parse(readFileSync(resultFile, "utf-8"));
  console.log(`\n  ${"─".repeat(68)}`);
} catch (err) {
  banner(`SCRAPER FAILED (${((Date.now()-t0)/1000).toFixed(1)}s)`, C.red);
  console.error(err.message ?? err);
  process.exit(1);
}

const elapsed = Date.now() - t0;
let passCount = 0, failCount = 0;

function check(condition, label, detail = "") {
  if (condition) { pass(label, detail); passCount++; }
  else { fail(label, detail); failCount++; }
}

banner("VALIDATION — ALL 13 TABLES", C.magenta);

// ── 1. GAME STRIP ──────────────────────────────────────────────────────────
section("1. GAME STRIP");
const gs = result.gameStrip;
check(!!gs, "gameStrip object present");
check(!!gs?.gameId, "gameId present", gs?.gameId);
check(!!gs?.homeTeam?.displayName, "homeTeam.displayName", gs?.homeTeam?.displayName);
check(!!gs?.awayTeam?.displayName, "awayTeam.displayName", gs?.awayTeam?.displayName);
check(typeof gs?.homeTeam?.score === "number", "homeTeam.score is number", String(gs?.homeTeam?.score));
check(typeof gs?.awayTeam?.score === "number", "awayTeam.score is number", String(gs?.awayTeam?.score));
check(!!gs?.competition, "competition name", gs?.competition);
check(!!gs?.venue, "venue", gs?.venue);
check(Array.isArray(gs?.homeTeam?.goals), "homeTeam.goals array", `${gs?.homeTeam?.goals?.length ?? 0} goals`);
check(Array.isArray(gs?.homeTeam?.linescores), "homeTeam.linescores array", gs?.homeTeam?.linescores?.join(","));
check(!!gs?.status, "match status", gs?.status);
check(!!gs?.referee, "referee present", gs?.referee);

// ── 2. BOXSCORE (outfield players) ─────────────────────────────────────────
section("2. BOXSCORE — OUTFIELD PLAYERS");
const bs = result.boxscore;
check(!!bs, "boxscore object present");
const homePlayers = bs?.homeTeam?.outfieldPlayers?.length ?? 0;
const awayPlayers = bs?.awayTeam?.outfieldPlayers?.length ?? 0;
check(homePlayers >= 10, `homeTeam has ≥10 outfield players`, `${homePlayers} players`);
check(awayPlayers >= 10, `awayTeam has ≥10 outfield players`, `${awayPlayers} players`);
const sp = bs?.homeTeam?.outfieldPlayers?.[0];
check(!!sp?.name, "player.name present", sp?.name);
check(!!sp?.positionGroup, "player.positionGroup present", sp?.positionGroup);
check(typeof sp?.stats === "object" && sp.stats !== null, "player.stats is object");
const statKeys = Object.keys(sp?.stats ?? {});
check(statKeys.length >= 5, `player has ≥5 stat columns`, statKeys.slice(0,10).join(", "));
// Verify key stat columns present
check("G" in (sp?.stats ?? {}) || "totalGoals" in (sp?.stats ?? {}), "Goals stat present");
check("xG" in (sp?.stats ?? {}) || "expectedGoals" in (sp?.stats ?? {}), "xG stat present");
check(Array.isArray(bs?.statColumns) && bs.statColumns.length > 0, "statColumns array", bs?.statColumns?.join(","));

// ── 3. GOALKEEPING ─────────────────────────────────────────────────────────
section("3. GOALKEEPING");
const homeGK = bs?.homeTeam?.goalkeeper;
const awayGK = bs?.awayTeam?.goalkeeper;
check(homeGK !== null && homeGK !== undefined, "homeTeam goalkeeper present");
check(awayGK !== null && awayGK !== undefined, "awayTeam goalkeeper present");
check(!!homeGK?.name, "home GK name", homeGK?.name);
check(!!awayGK?.name, "away GK name", awayGK?.name);
check(typeof homeGK?.stats === "object" && homeGK.stats !== null, "home GK stats object");
const gkStatKeys = Object.keys(homeGK?.stats ?? {});
check(gkStatKeys.length >= 3, `GK has ≥3 stat columns`, gkStatKeys.slice(0,10).join(", "));
check("SV" in (homeGK?.stats ?? {}) || "saves" in (homeGK?.stats ?? {}), "Saves stat present in GK");
check("GA" in (homeGK?.stats ?? {}) || "goalsConceded" in (homeGK?.stats ?? {}), "Goals Conceded stat present in GK");

// ── 4. FORMATIONS & LINEUPS ────────────────────────────────────────────────
section("4. FORMATIONS & LINEUPS");
const lu = result.lineups;
check(!!lu, "lineups object present");
check(!!lu?.home?.formation, "home formation", lu?.home?.formation);
check(!!lu?.away?.formation, "away formation", lu?.away?.formation);
const homeStarters = lu?.home?.starters?.length ?? 0;
const awayStarters = lu?.away?.starters?.length ?? 0;
check(homeStarters >= 11, `home has ≥11 starters`, `${homeStarters} starters`);
check(awayStarters >= 11, `away has ≥11 starters`, `${awayStarters} starters`);
const sLU = lu?.home?.starters?.[0];
check(!!sLU?.name, "starter name", sLU?.name);
check(!!sLU?.formationPlace, "starter formationPlace", String(sLU?.formationPlace));
check(!!sLU?.jersey, "starter jersey number", String(sLU?.jersey));
check(typeof sLU?.stats === "object", "starter stats object");
check(Array.isArray(lu?.home?.substitutes), "home substitutes array", `${lu?.home?.substitutes?.length ?? 0} subs`);

// ── 5. TEAM STATS ──────────────────────────────────────────────────────────
section("5. TEAM STATS");
const ts = result.teamStats;
check(!!ts, "teamStats object present");
check(Array.isArray(ts?.stats), "teamStats.stats array");
const tsCount = ts?.stats?.length ?? 0;
check(tsCount >= 5, `teamStats has ≥5 rows`, `${tsCount} rows`);
const tsSample = ts?.stats?.[0];
check(!!tsSample?.name, "stat name present", tsSample?.name);
check(tsSample?.homeValue !== undefined && tsSample?.homeValue !== null, "homeValue present", String(tsSample?.homeValue));
check(tsSample?.awayValue !== undefined && tsSample?.awayValue !== null, "awayValue present", String(tsSample?.awayValue));
// Verify possession is present
const possessionRow = ts?.stats?.find(s => s.name?.toLowerCase().includes("possession"));
check(!!possessionRow, "Possession stat present", possessionRow ? `${possessionRow.homeValue} vs ${possessionRow.awayValue}` : "missing");

// ── 6. EXPECTED GOALS ──────────────────────────────────────────────────────
section("6. EXPECTED GOALS");
const xg = result.expectedGoals;
check(!!xg, "expectedGoals object present");
check(!!xg?.homeTeamXG, "homeTeamXG present", String(xg?.homeTeamXG));
check(!!xg?.awayTeamXG, "awayTeamXG present", String(xg?.awayTeamXG));
check(Array.isArray(xg?.perPlayer), "perPlayer array", `${xg?.perPlayer?.length ?? 0} players`);
const xgPlayer = xg?.perPlayer?.[0];
check(!!xgPlayer?.name, "perPlayer[0].name", xgPlayer?.name);
check(!!xgPlayer?.xG, "perPlayer[0].xG", String(xgPlayer?.xG));

// ── 7. SHOT MAP ────────────────────────────────────────────────────────────
section("7. SHOT MAP");
const sm = result.shotMap;
check(!!sm, "shotMap object present");
check(Array.isArray(sm?.shots), "shotMap.shots array");
const shotCount = sm?.shots?.length ?? 0;
check(shotCount >= 1, `shotMap has ≥1 shot`, `${shotCount} shots`);
const s0 = sm?.shots?.[0];
check(!!s0?.playerName, "shot.playerName", s0?.playerName);
check(!!s0?.teamAbbrev, "shot.teamAbbrev", s0?.teamAbbrev);
check(!!s0?.clock, "shot.clock (minute)", s0?.clock);
check(!!s0?.iconType, "shot.iconType (outcome)", s0?.iconType);
check(!!s0?.description, "shot.description", s0?.description?.slice(0,60));
check(s0?.xG !== undefined && s0?.xG !== null, "shot.xG present", String(s0?.xG));

// ── 8. SHOTS ───────────────────────────────────────────────────────────────
section("8. SHOTS");
const shots = result.shots;
check(!!shots, "shots object present");
check(shots?.homeTotalShots !== undefined, "homeTotalShots", String(shots?.homeTotalShots));
check(shots?.awayTotalShots !== undefined, "awayTotalShots", String(shots?.awayTotalShots));
check(shots?.homeGoals !== undefined, "homeGoals", String(shots?.homeGoals));
check(shots?.awayGoals !== undefined, "awayGoals", String(shots?.awayGoals));
check(shots?.homeBlocked !== undefined, "homeBlocked", String(shots?.homeBlocked));
check(shots?.homeOffTarget !== undefined, "homeOffTarget", String(shots?.homeOffTarget));

// ── 9. PASSES ──────────────────────────────────────────────────────────────
section("9. PASSES");
const passes = result.passes;
check(!!passes, "passes object present");
check(!!passes?.homeAccuratePasses, "homeAccuratePasses", String(passes?.homeAccuratePasses));
check(!!passes?.awayAccuratePasses, "awayAccuratePasses", String(passes?.awayAccuratePasses));
check(!!passes?.homePassAccuracyPct, "homePassAccuracyPct", String(passes?.homePassAccuracyPct));
check(!!passes?.awayPassAccuracyPct, "awayPassAccuracyPct", String(passes?.awayPassAccuracyPct));

// ── 10. DUELS ──────────────────────────────────────────────────────────────
section("10. DUELS");
const duels = result.duels;
check(!!duels, "duels object present");
check(!!duels?.homeDuelsWon, "homeDuelsWon", String(duels?.homeDuelsWon));
check(!!duels?.awayDuelsWon, "awayDuelsWon", String(duels?.awayDuelsWon));

// ── 11. FOULS ──────────────────────────────────────────────────────────────
section("11. FOULS");
const fouls = result.fouls;
check(!!fouls, "fouls object present");
check(!!fouls?.homeFoulsCommitted || fouls?.homeFoulsCommitted === "0", "homeFoulsCommitted", String(fouls?.homeFoulsCommitted));
check(!!fouls?.awayFoulsCommitted, "awayFoulsCommitted", String(fouls?.awayFoulsCommitted));
check(fouls?.homeYellowCards !== undefined, "homeYellowCards", String(fouls?.homeYellowCards));
check(fouls?.awayYellowCards !== undefined, "awayYellowCards", String(fouls?.awayYellowCards));
check(fouls?.homeRedCards !== undefined, "homeRedCards", String(fouls?.homeRedCards));
check(fouls?.awayRedCards !== undefined, "awayRedCards", String(fouls?.awayRedCards));

// ── 12. ATTACK ─────────────────────────────────────────────────────────────
section("12. ATTACK (BIG CHANCES)");
const attack = result.attack;
check(!!attack, "attack object present");
check(attack?.homeBigChancesCreated !== undefined, "homeBigChancesCreated", String(attack?.homeBigChancesCreated));
check(attack?.awayBigChancesCreated !== undefined, "awayBigChancesCreated", String(attack?.awayBigChancesCreated));
check(attack?.homeBigChancesMissed !== undefined, "homeBigChancesMissed", String(attack?.homeBigChancesMissed));
check(attack?.awayBigChancesMissed !== undefined, "awayBigChancesMissed", String(attack?.awayBigChancesMissed));

// ── 13. FULL TEAM STATS ────────────────────────────────────────────────────
section("13. FULL TEAM STATS (mtchStatsGrph)");
const fts = result.fullTeamStats;
check(Array.isArray(fts), "fullTeamStats is array");
const ftsCount = fts?.length ?? 0;
check(ftsCount >= 5, `fullTeamStats has ≥5 rows`, `${ftsCount} rows`);
const ftsSample = fts?.[0];
check(!!ftsSample?.name, "fullTeamStats[0].name", ftsSample?.name);
check(ftsSample?.homeValue !== undefined, "fullTeamStats[0].homeValue", String(ftsSample?.homeValue));
check(ftsSample?.awayValue !== undefined, "fullTeamStats[0].awayValue", String(ftsSample?.awayValue));
// Verify xG is in fullTeamStats
const ftsXG = fts?.find(s => s.name?.toLowerCase().includes("expected"));
check(!!ftsXG, "Expected Goals in fullTeamStats", ftsXG ? `${ftsXG.homeValue} vs ${ftsXG.awayValue}` : "missing");

// ── SUMMARY ────────────────────────────────────────────────────────────────
banner("TEST SUMMARY", failCount === 0 ? C.green : C.red);

const total = passCount + failCount;
const pct = total > 0 ? Math.round((passCount / total) * 100) : 0;
const bars = Math.round(pct / 5);
const bar = "█".repeat(bars) + "░".repeat(20 - bars);

console.log(`  ${C.bold}Result:   ${passCount === total ? C.green : C.yellow}${passCount}/${total} PASS (${pct}%)${C.reset}`);
console.log(`  ${C.bold}Progress: ${C.green}${bar}${C.reset}`);
console.log(`  ${C.bold}Duration: ${C.reset}${(elapsed / 1000).toFixed(1)}s`);
console.log(`  ${C.bold}Failures: ${failCount > 0 ? C.red + failCount + C.reset : C.green + "0" + C.reset}`);
console.log(`  ${C.bold}Log file: ${C.reset}.manus-logs/espn-page-scraper.log`);
console.log(`  ${C.bold}Result:   ${C.reset}.manus-logs/espn-page-scraper-result.json`);

if (result) {
  console.log(`\n  ${C.bold}${C.cyan}── KEY DATA POINTS ──${C.reset}`);
  const ht = result.gameStrip?.homeTeam;
  const at = result.gameStrip?.awayTeam;
  console.log(`  ${C.dim}Match:       ${ht?.displayName ?? "?"} ${ht?.score ?? "?"} - ${at?.score ?? "?"} ${at?.displayName ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Competition: ${result.gameStrip?.competition ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Venue:       ${result.gameStrip?.venue ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Referee:     ${result.gameStrip?.referee ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Formations:  ${result.lineups?.home?.formation ?? "?"} vs ${result.lineups?.away?.formation ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}xG:          Home ${result.expectedGoals?.homeTeamXG ?? "?"} | Away ${result.expectedGoals?.awayTeamXG ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Shots:       Home ${result.shots?.homeTotalShots ?? "?"} total (${result.shots?.homeGoals ?? "?"} goals, ${result.shots?.homeBlocked ?? "?"} blocked, ${result.shots?.homeOffTarget ?? "?"} off target)${C.reset}`);
  console.log(`  ${C.dim}             Away ${result.shots?.awayTotalShots ?? "?"} total (${result.shots?.awayGoals ?? "?"} goals, ${result.shots?.awayBlocked ?? "?"} blocked, ${result.shots?.awayOffTarget ?? "?"} off target)${C.reset}`);
  console.log(`  ${C.dim}Passes:      Home ${result.passes?.homeAccuratePasses ?? "?"} (${result.passes?.homePassAccuracyPct ?? "?"}) | Away ${result.passes?.awayAccuratePasses ?? "?"} (${result.passes?.awayPassAccuracyPct ?? "?"})${C.reset}`);
  console.log(`  ${C.dim}Duels Won:   Home ${result.duels?.homeDuelsWon ?? "?"} | Away ${result.duels?.awayDuelsWon ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Fouls:       Home ${result.fouls?.homeFoulsCommitted ?? "?"} (Y:${result.fouls?.homeYellowCards ?? "?"} R:${result.fouls?.homeRedCards ?? "?"}) | Away ${result.fouls?.awayFoulsCommitted ?? "?"} (Y:${result.fouls?.awayYellowCards ?? "?"} R:${result.fouls?.awayRedCards ?? "?"})${C.reset}`);
  console.log(`  ${C.dim}Big Chances: Home Created:${result.attack?.homeBigChancesCreated ?? "?"} Missed:${result.attack?.homeBigChancesMissed ?? "?"} | Away Created:${result.attack?.awayBigChancesCreated ?? "?"} Missed:${result.attack?.awayBigChancesMissed ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Players:     Home ${homePlayers} outfield + GK:${result.boxscore?.homeTeam?.goalkeeper?.name ?? "?"} | Away ${awayPlayers} outfield + GK:${result.boxscore?.awayTeam?.goalkeeper?.name ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Shot Map:    ${result.shotMap?.shots?.length ?? 0} shots | Full Stats: ${ftsCount} rows${C.reset}`);
  console.log(`  ${C.dim}xG Players:  ${result.expectedGoals?.perPlayer?.length ?? 0} players with xG/xA data${C.reset}`);
}

if (failCount > 0) {
  console.log(`\n  ${C.red}${C.bold}FAILED — ${failCount} check(s) did not pass${C.reset}`);
  process.exit(1);
} else {
  console.log(`\n  ${C.green}${C.bold}ALL 13 TABLES CONFIRMED — 100x ESPN Page Scraper OPERATIONAL${C.reset}`);
}
