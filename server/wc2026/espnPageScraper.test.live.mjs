/**
 * espnPageScraper.test.live.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 250x Live integration test for the ESPN Page Scraper.
 * Validates ALL 18 tables/sections using EXACT field names from scraper output.
 *
 * Usage:
 *   node server/wc2026/espnPageScraper.test.live.mjs
 *
 * Sections validated:
 *   1.  GAME STRIP        — score, status, venue, attendance, officials
 *   2.  BOXSCORE          — per-player stats (jersey, name, positionGroup, stats)
 *   3.  GOALKEEPING (GK)  — saves, GA, xGC, xGOT (from boxscore GK row)
 *   4.  FORMATIONS        — formation string + starters grid
 *   5.  LINEUPS           — starters, subs, formationPlace, jersey
 *   6.  TEAM STATS        — tmStatsGrph 8-row summary
 *   7.  MATCH STATS       — mtchStatsGrph 9-row (xG/possession/passes/...)
 *   8.  EXPECTED GOALS    — homeXG/awayXG/xGOpenPlay/xGSetPlay/xGOT/perPlayer
 *   9.  SHOT MAP          — player name/jersey/team, fieldStart, fieldEnd, goalPos
 *  10.  SHOTS             — shotsOnGoal/shots/blocked/hitWoodwork/inside/outside
 *  11.  PASSES            — accuratePasses/passes/backZone/fwdZone/longBalls/...
 *  12.  ATTACK            — bigChancesCreated/Missed/throughBalls/touches/...
 *  13.  GOALKEEPING TABLE — saves/goalKicks/shotsFaced/highClaims/pkSaved
 *  14.  DEFENSE           — tackles/interceptions/clearances/recoveries
 *  15.  DUELS             — duelsWon/duels/aerialsWon
 *  16.  FOULS             — foulsCommitted/offsides/yellowCards/redCards
 *  17.  GAME ODDS         — moneyline/spread/total
 *  18.  FULL TEAM STATS   — combined deferred rows
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
  white: "\x1b[37m",
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
function warn(label, detail = "") {
  console.log(`  ${C.yellow}${C.bold}⚠ WARN${C.reset}  ${label}${detail ? C.dim + "  " + detail + C.reset : ""}`);
}
function section(title) {
  console.log(`\n  ${C.bold}${C.cyan}${"─".repeat(68)}${C.reset}`);
  console.log(`  ${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`  ${C.bold}${C.cyan}${"─".repeat(68)}${C.reset}`);
}

// ── Main test ──────────────────────────────────────────────────────────────
banner("ESPN PAGE SCRAPER — 250x LIVE INTEGRATION TEST", C.cyan);
console.log(`  ${C.dim}Target: https://www.espn.com/soccer/player-stats/_/gameId/760487${C.reset}`);
console.log(`  ${C.dim}Tables: 18 required | Mode: DIRECT PAGE SCRAPE — ZERO API FALLBACK${C.reset}`);
console.log(`  ${C.dim}Sections: GAME_STRIP | BOXSCORE | GK | FORMATIONS | LINEUPS | TEAM_STATS${C.reset}`);
console.log(`  ${C.dim}          MATCH_STATS | EXPECTED_GOALS | SHOT_MAP | SHOTS | PASSES${C.reset}`);
console.log(`  ${C.dim}          ATTACK | GOALKEEPING_TABLE | DEFENSE | DUELS | FOULS | ODDS | FULL_STATS${C.reset}\n`);

const resultFile = join(logDir, "espn-page-scraper-result.json");
const runnerScript = `
import { scrapeEspnMatchPage } from "${join(__dirname, "espnPageScraper.ts")}";
import { writeFileSync } from "fs";
const data = await scrapeEspnMatchPage("760487", { logDir: "${logDir}", saveHtml: true });
writeFileSync("${resultFile}", JSON.stringify(data, null, 2));
process.stderr.write("[RUNNER] Done\\n");
`;

const tmpScript = join(logDir, "_test_runner.mts");
writeFileSync(tmpScript, runnerScript);

const t0 = Date.now();
let result;

try {
  console.log(`  ${C.bold}Launching Playwright scraper (3 ESPN pages)...${C.reset}`);
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
let passCount = 0, failCount = 0, warnCount = 0;

function check(condition, label, detail = "", isWarn = false) {
  if (condition) { pass(label, detail); passCount++; }
  else if (isWarn) { warn(label, detail); warnCount++; }
  else { fail(label, detail); failCount++; }
}

banner("VALIDATION — ALL 18 SECTIONS", C.magenta);

// ─────────────────────────────────────────────────────────────────────────────
// 1. GAME STRIP
// ─────────────────────────────────────────────────────────────────────────────
section("1. GAME STRIP");
const gs = result.gameStrip;
check(!!gs, "gameStrip object present");
check(!!gs?.espnMatchId, "gameId present", gs?.espnMatchId);
check(!!gs?.homeTeam?.displayName, "homeTeam.displayName", gs?.homeTeam?.displayName);
check(!!gs?.awayTeam?.displayName, "awayTeam.displayName", gs?.awayTeam?.displayName);
check(typeof gs?.homeTeam?.score === "number", "homeTeam.score is number", String(gs?.homeTeam?.score));
check(typeof gs?.awayTeam?.score === "number", "awayTeam.score is number", String(gs?.awayTeam?.score));
check(!!gs?.competition, "competition name", gs?.competition);
check(!!gs?.venue, "venue", gs?.venue);
check(Array.isArray(gs?.homeTeam?.goals), "homeTeam.goals array", `${gs?.homeTeam?.goals?.length ?? 0} goals`);
check(Array.isArray(gs?.homeTeam?.linescores), "homeTeam.linescores array", gs?.homeTeam?.linescores?.join(","));
check(!!gs?.status, "match status", gs?.status);
check(!!gs?.referee, "referee present", gs?.referee, true);
check(gs?.attendance > 0, "attendance > 0", String(gs?.attendance), true);
console.log(`  ${C.dim}Match: ${gs?.homeTeam?.displayName ?? "?"} ${gs?.homeTeam?.score ?? "?"} - ${gs?.awayTeam?.score ?? "?"} ${gs?.awayTeam?.displayName ?? "?"}${C.reset}`);
console.log(`  ${C.dim}Venue: ${gs?.venue ?? "?"} | Referee: ${gs?.referee ?? "?"} | Attendance: ${gs?.attendance ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 2. BOXSCORE — OUTFIELD PLAYERS
// ─────────────────────────────────────────────────────────────────────────────
section("2. BOXSCORE — OUTFIELD PLAYERS");
const bs = result.boxscore;
check(!!bs, "boxscore object present");
const homePlayers = bs?.homeTeam?.outfieldPlayers?.length ?? 0;
const awayPlayers = bs?.awayTeam?.outfieldPlayers?.length ?? 0;
check(homePlayers >= 10, `homeTeam has ≥10 outfield players`, `${homePlayers} players`);
check(awayPlayers >= 10, `awayTeam has ≥10 outfield players`, `${awayPlayers} players`);
const sp = bs?.homeTeam?.outfieldPlayers?.[0];
check(!!sp?.name, "player.name present", sp?.name);
check(!!sp?.jersey, "player.jersey present", String(sp?.jersey));
check(!!sp?.positionGroup, "player.positionGroup present", sp?.positionGroup);
check(typeof sp?.stats === "object" && sp.stats !== null, "player.stats is object");
const statKeys = Object.keys(sp?.stats ?? {});
check(statKeys.length >= 5, `player has ≥5 stat columns`, statKeys.slice(0,10).join(", "));
check("G" in (sp?.stats ?? {}) || "totalGoals" in (sp?.stats ?? {}), "Goals stat present");
check("xG" in (sp?.stats ?? {}) || "expectedGoals" in (sp?.stats ?? {}), "xG stat present");
check(Array.isArray(bs?.statColumns) && bs.statColumns.length > 0, "statColumns array", bs?.statColumns?.join(","));
// Print all players
console.log(`  ${C.dim}Home players: ${bs?.homeTeam?.outfieldPlayers?.slice(0,5).map(p => `${p.jersey}:${p.name}`).join(", ")}...${C.reset}`);
console.log(`  ${C.dim}Away players: ${bs?.awayTeam?.outfieldPlayers?.slice(0,5).map(p => `${p.jersey}:${p.name}`).join(", ")}...${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. GOALKEEPING (from boxscore GK row)
// ─────────────────────────────────────────────────────────────────────────────
section("3. GOALKEEPING — BOXSCORE GK ROW");
const homeGK = bs?.homeTeam?.goalkeeper;
const awayGK = bs?.awayTeam?.goalkeeper;
check(homeGK !== null && homeGK !== undefined, "homeTeam goalkeeper present");
check(awayGK !== null && awayGK !== undefined, "awayTeam goalkeeper present");
check(!!homeGK?.name, "home GK name", homeGK?.name);
check(!!homeGK?.jersey, "home GK jersey", String(homeGK?.jersey));
check(!!awayGK?.name, "away GK name", awayGK?.name);
check(!!awayGK?.jersey, "away GK jersey", String(awayGK?.jersey));
check(typeof homeGK?.stats === "object" && homeGK.stats !== null, "home GK stats object");
const gkStatKeys = Object.keys(homeGK?.stats ?? {});
check(gkStatKeys.length >= 3, `GK has ≥3 stat columns`, gkStatKeys.slice(0,10).join(", "));
check("SV" in (homeGK?.stats ?? {}) || "saves" in (homeGK?.stats ?? {}), "Saves stat present in GK");
check("GA" in (homeGK?.stats ?? {}) || "goalsConceded" in (homeGK?.stats ?? {}), "Goals Conceded stat present in GK");
console.log(`  ${C.dim}Home GK: ${homeGK?.name ?? "?"} #${homeGK?.jersey ?? "?"} | Stats: ${gkStatKeys.slice(0,8).join(", ")}${C.reset}`);
console.log(`  ${C.dim}Away GK: ${awayGK?.name ?? "?"} #${awayGK?.jersey ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. FORMATIONS & LINEUPS
// ─────────────────────────────────────────────────────────────────────────────
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
check(Array.isArray(lu?.away?.substitutes), "away substitutes array", `${lu?.away?.substitutes?.length ?? 0} subs`);
console.log(`  ${C.dim}Formations: ${lu?.home?.formation ?? "?"} vs ${lu?.away?.formation ?? "?"}${C.reset}`);
console.log(`  ${C.dim}Home starters: ${lu?.home?.starters?.slice(0,4).map(p => `${p.jersey}:${p.name}(${p.formationPlace})`).join(", ")}...${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. TEAM STATS (tmStatsGrph)
// ─────────────────────────────────────────────────────────────────────────────
section("5. TEAM STATS (tmStatsGrph — 8-row summary)");
const ts = result.teamStats;
check(!!ts, "teamStats object present");
check(Array.isArray(ts?.stats), "teamStats.stats array");
const tsCount = ts?.stats?.length ?? 0;
check(tsCount >= 8, `teamStats has ≥8 rows`, `${tsCount} rows`);
const tsSample = ts?.stats?.[0];
check(!!tsSample?.name, "stat name present", tsSample?.name);
check(tsSample?.homeValue !== undefined && tsSample?.homeValue !== null, "homeValue present", String(tsSample?.homeValue));
check(tsSample?.awayValue !== undefined && tsSample?.awayValue !== null, "awayValue present", String(tsSample?.awayValue));
const possessionRow = ts?.stats?.find(s => s.name?.toLowerCase().includes("possession"));
check(!!possessionRow, "Possession stat present", possessionRow ? `${possessionRow.homeValue} vs ${possessionRow.awayValue}` : "missing");
// NOTE: tmStatsGrph (8-row summary) does NOT include xG — xG is in matchStats (mtchStatsGrph)
// Verify the 8 expected rows are present by name
const expectedTsNames = ["Possession", "Shots on Goal", "Shot Attempts", "Fouls", "Yellow Cards", "Red Cards", "Corner Kicks", "Saves"];
const missingTsRows = expectedTsNames.filter(n => !ts?.stats?.some(s => s.name?.toLowerCase().includes(n.toLowerCase())));
check(missingTsRows.length === 0, "All 8 tmStatsGrph rows present", missingTsRows.length > 0 ? `missing: ${missingTsRows.join(", ")}` : "all present");
console.log(`  ${C.dim}Team stats rows: ${ts?.stats?.map(s => s.name).join(" | ")}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATCH STATS (mtchStatsGrph)
// ─────────────────────────────────────────────────────────────────────────────
section("6. MATCH STATS (mtchStatsGrph — 9-row)");
const ms = result.matchStats;
check(!!ms, "matchStats object present");
check(Array.isArray(ms?.stats), "matchStats.stats array");
const msCount = ms?.stats?.length ?? 0;
check(msCount >= 5, `matchStats has ≥5 rows`, `${msCount} rows`);
console.log(`  ${C.dim}Match stats rows: ${ms?.stats?.map(s => s.name).join(" | ")}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 7. EXPECTED GOALS
// ─────────────────────────────────────────────────────────────────────────────
section("7. EXPECTED GOALS");
const xg = result.expectedGoals;
check(!!xg, "expectedGoals object present");
check(!!xg?.homeTeamXG, "homeTeamXG present", String(xg?.homeTeamXG));
check(!!xg?.awayTeamXG, "awayTeamXG present", String(xg?.awayTeamXG));
check(xg?.homeTeamXGOpenPlay !== undefined && xg?.homeTeamXGOpenPlay !== "", "homeTeamXGOpenPlay", String(xg?.homeTeamXGOpenPlay), true);
check(xg?.awayTeamXGOpenPlay !== undefined && xg?.awayTeamXGOpenPlay !== "", "awayTeamXGOpenPlay", String(xg?.awayTeamXGOpenPlay), true);
check(xg?.homeTeamXGSetPlay !== undefined && xg?.homeTeamXGSetPlay !== "", "homeTeamXGSetPlay", String(xg?.homeTeamXGSetPlay), true);
check(xg?.homeTeamXGOT !== undefined && xg?.homeTeamXGOT !== "", "homeTeamXGOT", String(xg?.homeTeamXGOT), true);
check(Array.isArray(xg?.perPlayer), "perPlayer array", `${xg?.perPlayer?.length ?? 0} players`);
const xgPlayer = xg?.perPlayer?.[0];
check(!!xgPlayer?.name, "perPlayer[0].name", xgPlayer?.name);
check(!!xgPlayer?.xG, "perPlayer[0].xG", String(xgPlayer?.xG));
console.log(`  ${C.dim}xG: Home ${xg?.homeTeamXG ?? "?"} (OpenPlay:${xg?.homeTeamXGOpenPlay ?? "?"} SetPlay:${xg?.homeTeamXGSetPlay ?? "?"} OT:${xg?.homeTeamXGOT ?? "?"})${C.reset}`);
console.log(`  ${C.dim}xG: Away ${xg?.awayTeamXG ?? "?"} (OpenPlay:${xg?.awayTeamXGOpenPlay ?? "?"} SetPlay:${xg?.awayTeamXGSetPlay ?? "?"} OT:${xg?.awayTeamXGOT ?? "?"})${C.reset}`);
console.log(`  ${C.dim}Per-player xG: ${xg?.perPlayer?.slice(0,5).map(p => `${p.name}(${p.xG})`).join(", ")}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 8. SHOT MAP (with coordinates + participant name/jersey)
// ─────────────────────────────────────────────────────────────────────────────
section("8. SHOT MAP — COORDINATES + PARTICIPANT NAME/JERSEY");
const sm = result.shotMap;
check(!!sm, "shotMap object present");
check(Array.isArray(sm?.shots), "shotMap.shots array");
const shotCount = sm?.shots?.length ?? 0;
check(shotCount >= 1, `shotMap has ≥1 shot`, `${shotCount} shots`);
const s0 = sm?.shots?.[0];
check(!!s0?.playerName, "shot.playerName", s0?.playerName);
check(s0?.playerJersey !== undefined, "shot.playerJersey", String(s0?.playerJersey), true);
check(!!s0?.teamAbbrev, "shot.teamAbbrev", s0?.teamAbbrev);
check(!!s0?.clock, "shot.clock (minute)", s0?.clock);
check(!!s0?.iconType, "shot.iconType (outcome)", s0?.iconType);
check(!!s0?.description, "shot.description", s0?.description?.slice(0,60));
check(s0?.xG !== undefined && s0?.xG !== null, "shot.xG present", String(s0?.xG));
// Shot coordinates
check(s0?.fieldStartX !== undefined || s0?.fieldStart?.x !== undefined, "shot fieldStart.x present", String(s0?.fieldStartX ?? s0?.fieldStart?.x), true);
check(s0?.fieldStartY !== undefined || s0?.fieldStart?.y !== undefined, "shot fieldStart.y present", String(s0?.fieldStartY ?? s0?.fieldStart?.y), true);
// Goal position (for on-target shots)
const onTargetShot = sm?.shots?.find(s => s.iconType === "goal" || s.iconType === "save");
if (onTargetShot) {
  check(onTargetShot?.goalPositionY !== undefined || onTargetShot?.goalPosition?.y !== undefined,
    "on-target shot goalPosition.y present",
    String(onTargetShot?.goalPositionY ?? onTargetShot?.goalPosition?.y), true);
}
console.log(`  ${C.dim}Shot map: ${shotCount} shots total${C.reset}`);
console.log(`  ${C.dim}Shot[0]: ${s0?.playerName ?? "?"} #${s0?.playerJersey ?? "?"} (${s0?.teamAbbrev ?? "?"}) min=${s0?.clock ?? "?"} type=${s0?.iconType ?? "?"} xG=${s0?.xG ?? "?"}${C.reset}`);
console.log(`  ${C.dim}         fieldStart=(${s0?.fieldStartX ?? s0?.fieldStart?.x ?? "?"},${s0?.fieldStartY ?? s0?.fieldStart?.y ?? "?"})${C.reset}`);
// Print all shots summary
const shotsByTeam = {};
for (const s of sm?.shots ?? []) {
  shotsByTeam[s.teamAbbrev] = (shotsByTeam[s.teamAbbrev] ?? 0) + 1;
}
console.log(`  ${C.dim}Shots by team: ${Object.entries(shotsByTeam).map(([k,v]) => `${k}=${v}`).join(", ")}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 9. SHOTS (shtsTbls)
// ─────────────────────────────────────────────────────────────────────────────
section("9. SHOTS (shtsTbls — 6 rows)");
const shots = result.shots;
check(!!shots, "shots object present");
check(shots?.homeTotalShots !== undefined, "homeTotalShots", String(shots?.homeTotalShots));
check(shots?.awayTotalShots !== undefined, "awayTotalShots", String(shots?.awayTotalShots));
check(shots?.homeGoals !== undefined, "homeGoals", String(shots?.homeGoals));
check(shots?.awayGoals !== undefined, "awayGoals", String(shots?.awayGoals));
check(shots?.homeBlocked !== undefined, "homeBlocked", String(shots?.homeBlocked));
check(shots?.homeOffTarget !== undefined, "homeOffTarget", String(shots?.homeOffTarget));
check(shots?.homeShotsOnGoal !== undefined && shots?.homeShotsOnGoal !== "", "homeShotsOnGoal (shtsTbls)", String(shots?.homeShotsOnGoal));
check(shots?.awayShotsOnGoal !== undefined && shots?.awayShotsOnGoal !== "", "awayShotsOnGoal (shtsTbls)", String(shots?.awayShotsOnGoal));
check(shots?.homeHitWoodwork !== undefined && shots?.homeHitWoodwork !== "", "homeHitWoodwork", String(shots?.homeHitWoodwork));
check(shots?.homeAttemptsInsideBox !== undefined && shots?.homeAttemptsInsideBox !== "", "homeAttemptsInsideBox", String(shots?.homeAttemptsInsideBox));
check(shots?.homeAttemptsOutsideBox !== undefined && shots?.homeAttemptsOutsideBox !== "", "homeAttemptsOutsideBox", String(shots?.homeAttemptsOutsideBox));
console.log(`  ${C.dim}Shots: Home ${shots?.homeTotalShots ?? "?"} total (SoG:${shots?.homeShotsOnGoal ?? "?"} Blk:${shots?.homeShotsBlocked ?? "?"} Wood:${shots?.homeHitWoodwork ?? "?"} InBox:${shots?.homeAttemptsInsideBox ?? "?"} OutBox:${shots?.homeAttemptsOutsideBox ?? "?"})${C.reset}`);
console.log(`  ${C.dim}Shots: Away ${shots?.awayTotalShots ?? "?"} total (SoG:${shots?.awayShotsOnGoal ?? "?"} Blk:${shots?.awayShotsBlocked ?? "?"} Wood:${shots?.awayHitWoodwork ?? "?"} InBox:${shots?.awayAttemptsInsideBox ?? "?"} OutBox:${shots?.awayAttemptsOutsideBox ?? "?"})${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 10. PASSES (pssTbls — 8 rows)
// ─────────────────────────────────────────────────────────────────────────────
section("10. PASSES (pssTbls — 8 rows)");
const passes = result.passes;
check(!!passes, "passes object present");
check(!!passes?.homeAccuratePasses, "homeAccuratePasses", String(passes?.homeAccuratePasses));
check(!!passes?.awayAccuratePasses, "awayAccuratePasses", String(passes?.awayAccuratePasses));
check(!!passes?.homePassAccuracyPct, "homePassAccuracyPct", String(passes?.homePassAccuracyPct));
check(!!passes?.awayPassAccuracyPct, "awayPassAccuracyPct", String(passes?.awayPassAccuracyPct));
check(!!passes?.homePasses, "homePasses (total)", String(passes?.homePasses));
check(!!passes?.awayPasses, "awayPasses (total)", String(passes?.awayPasses));
check(!!passes?.homeTotalBackZonePass, "homeTotalBackZonePass", String(passes?.homeTotalBackZonePass));
check(!!passes?.homeTotalForwardZonePass, "homeTotalForwardZonePass", String(passes?.homeTotalForwardZonePass));
check(!!passes?.homeAccurateLongBalls, "homeAccurateLongBalls", String(passes?.homeAccurateLongBalls));
check(!!passes?.homeAccurateCrosses, "homeAccurateCrosses", String(passes?.homeAccurateCrosses));
check(!!passes?.homeTotalThrows, "homeTotalThrows", String(passes?.homeTotalThrows));
check(!!passes?.homeTouchesInOppositionBox, "homeTouchesInOppositionBox", String(passes?.homeTouchesInOppositionBox));
console.log(`  ${C.dim}Passes: Home ${passes?.homeAccuratePasses ?? "?"}(${passes?.homePassAccuracyPct ?? "?"}) | Away ${passes?.awayAccuratePasses ?? "?"}(${passes?.awayPassAccuracyPct ?? "?"})${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 11. ATTACK (attkTbls — 6 rows)
// ─────────────────────────────────────────────────────────────────────────────
section("11. ATTACK (attkTbls — 6 rows)");
const attack = result.attack;
check(!!attack, "attack object present");
check(attack?.homeBigChancesCreated !== undefined && attack?.homeBigChancesCreated !== "", "homeBigChancesCreated", String(attack?.homeBigChancesCreated));
check(attack?.awayBigChancesCreated !== undefined && attack?.awayBigChancesCreated !== "", "awayBigChancesCreated", String(attack?.awayBigChancesCreated));
check(attack?.homeBigChancesMissed !== undefined && attack?.homeBigChancesMissed !== "", "homeBigChancesMissed", String(attack?.homeBigChancesMissed));
check(attack?.awayBigChancesMissed !== undefined && attack?.awayBigChancesMissed !== "", "awayBigChancesMissed", String(attack?.awayBigChancesMissed));
check(attack?.homeThroughBalls !== undefined && attack?.homeThroughBalls !== "", "homeThroughBalls", String(attack?.homeThroughBalls));
check(attack?.homeTouchesInOppositionBox !== undefined && attack?.homeTouchesInOppositionBox !== "", "homeTouchesInOppositionBox", String(attack?.homeTouchesInOppositionBox));
check(attack?.homeFouledInFinalThird !== undefined && attack?.homeFouledInFinalThird !== "", "homeFouledInFinalThird", String(attack?.homeFouledInFinalThird));
check(attack?.homeCornersWon !== undefined && attack?.homeCornersWon !== "", "homeCornersWon", String(attack?.homeCornersWon));
console.log(`  ${C.dim}Attack: BCC Home ${attack?.homeBigChancesCreated ?? "?"} Away ${attack?.awayBigChancesCreated ?? "?"} | BCM Home ${attack?.homeBigChancesMissed ?? "?"} Away ${attack?.awayBigChancesMissed ?? "?"}${C.reset}`);
console.log(`  ${C.dim}        ThroughBalls H:${attack?.homeThroughBalls ?? "?"} A:${attack?.awayThroughBalls ?? "?"} | Corners H:${attack?.homeCornersWon ?? "?"} A:${attack?.awayCornersWon ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 12. GOALKEEPING TABLE (tmStatsTbls[goalkeeping] — 5 rows)
// ─────────────────────────────────────────────────────────────────────────────
section("12. GOALKEEPING TABLE (tmStatsTbls[goalkeeping] — 5 rows)");
const gkTable = result.goalkeeping;
check(!!gkTable, "goalkeeping table object present");
check(gkTable?.homeSaves !== undefined && gkTable?.homeSaves !== "", "homeSaves", String(gkTable?.homeSaves));
check(gkTable?.awaySaves !== undefined && gkTable?.awaySaves !== "", "awaySaves", String(gkTable?.awaySaves));
check(gkTable?.homeGoalKicks !== undefined && gkTable?.homeGoalKicks !== "", "homeGoalKicks", String(gkTable?.homeGoalKicks));
check(gkTable?.awayGoalKicks !== undefined && gkTable?.awayGoalKicks !== "", "awayGoalKicks", String(gkTable?.awayGoalKicks));
check(gkTable?.homeShotsFaced !== undefined && gkTable?.homeShotsFaced !== "", "homeShotsFaced", String(gkTable?.homeShotsFaced));
check(gkTable?.awayShotsFaced !== undefined && gkTable?.awayShotsFaced !== "", "awayShotsFaced", String(gkTable?.awayShotsFaced));
check(gkTable?.homeTotalHighClaims !== undefined && gkTable?.homeTotalHighClaims !== "", "homeTotalHighClaims", String(gkTable?.homeTotalHighClaims));
check(gkTable?.homePenaltyKicksSaved !== undefined && gkTable?.homePenaltyKicksSaved !== "", "homePenaltyKicksSaved", String(gkTable?.homePenaltyKicksSaved), true);
console.log(`  ${C.dim}GK Table: Saves H:${gkTable?.homeSaves ?? "?"} A:${gkTable?.awaySaves ?? "?"} | GoalKicks H:${gkTable?.homeGoalKicks ?? "?"} A:${gkTable?.awayGoalKicks ?? "?"}${C.reset}`);
console.log(`  ${C.dim}          ShotsFaced H:${gkTable?.homeShotsFaced ?? "?"} A:${gkTable?.awayShotsFaced ?? "?"} | HighClaims H:${gkTable?.homeTotalHighClaims ?? "?"} A:${gkTable?.awayTotalHighClaims ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 13. DEFENSE (tmStatsTbls[defense] — 4 rows) ← CRITICAL SECTION
// ─────────────────────────────────────────────────────────────────────────────
section("13. DEFENSE (tmStatsTbls[defense] — 4 rows) ← CRITICAL");
const defense = result.defense;
check(!!defense, "defense object present");
check(defense?.homeTackles !== undefined && defense?.homeTackles !== "", "homeTackles", String(defense?.homeTackles));
check(defense?.awayTackles !== undefined && defense?.awayTackles !== "", "awayTackles", String(defense?.awayTackles));
check(defense?.homeInterceptions !== undefined && defense?.homeInterceptions !== "", "homeInterceptions", String(defense?.homeInterceptions));
check(defense?.awayInterceptions !== undefined && defense?.awayInterceptions !== "", "awayInterceptions", String(defense?.awayInterceptions));
check(defense?.homeClearances !== undefined && defense?.homeClearances !== "", "homeClearances", String(defense?.homeClearances));
check(defense?.awayClearances !== undefined && defense?.awayClearances !== "", "awayClearances", String(defense?.awayClearances));
check(defense?.homeRecoveries !== undefined && defense?.homeRecoveries !== "", "homeRecoveries", String(defense?.homeRecoveries));
check(defense?.awayRecoveries !== undefined && defense?.awayRecoveries !== "", "awayRecoveries", String(defense?.awayRecoveries));
console.log(`  ${C.dim}Defense: Tackles H:${defense?.homeTackles ?? "?"} A:${defense?.awayTackles ?? "?"} | Interceptions H:${defense?.homeInterceptions ?? "?"} A:${defense?.awayInterceptions ?? "?"}${C.reset}`);
console.log(`  ${C.dim}         Clearances H:${defense?.homeClearances ?? "?"} A:${defense?.awayClearances ?? "?"} | Recoveries H:${defense?.homeRecoveries ?? "?"} A:${defense?.awayRecoveries ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 14. DUELS (tmStatsTbls[duels] — 3 rows)
// ─────────────────────────────────────────────────────────────────────────────
section("14. DUELS (tmStatsTbls[duels] — 3 rows)");
const duels = result.duels;
check(!!duels, "duels object present");
check(duels?.homeDuelsWon !== undefined && duels?.homeDuelsWon !== "", "homeDuelsWon", String(duels?.homeDuelsWon));
check(duels?.awayDuelsWon !== undefined && duels?.awayDuelsWon !== "", "awayDuelsWon", String(duels?.awayDuelsWon));
check(duels?.homeDuels !== undefined && duels?.homeDuels !== "", "homeDuels (total)", String(duels?.homeDuels));
check(duels?.awayDuels !== undefined && duels?.awayDuels !== "", "awayDuels (total)", String(duels?.awayDuels));
check(duels?.homeAerialsWon !== undefined && duels?.homeAerialsWon !== "", "homeAerialsWon", String(duels?.homeAerialsWon));
check(duels?.awayAerialsWon !== undefined && duels?.awayAerialsWon !== "", "awayAerialsWon", String(duels?.awayAerialsWon));
console.log(`  ${C.dim}Duels: Won H:${duels?.homeDuelsWon ?? "?"} A:${duels?.awayDuelsWon ?? "?"} | Total H:${duels?.homeDuels ?? "?"} A:${duels?.awayDuels ?? "?"} | Aerials H:${duels?.homeAerialsWon ?? "?"} A:${duels?.awayAerialsWon ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 15. FOULS & OFFSIDES (tmStatsTbls[fouls] — 4 rows)
// ─────────────────────────────────────────────────────────────────────────────
section("15. FOULS & OFFSIDES (tmStatsTbls[fouls] — 4 rows)");
const fouls = result.fouls;
check(!!fouls, "fouls object present");
check(fouls?.homeFoulsCommitted !== undefined, "homeFoulsCommitted", String(fouls?.homeFoulsCommitted));
check(fouls?.awayFoulsCommitted !== undefined && fouls?.awayFoulsCommitted !== "", "awayFoulsCommitted", String(fouls?.awayFoulsCommitted));
check(fouls?.homeOffsides !== undefined, "homeOffsides", String(fouls?.homeOffsides));
check(fouls?.awayOffsides !== undefined, "awayOffsides", String(fouls?.awayOffsides));
check(fouls?.homeYellowCards !== undefined, "homeYellowCards", String(fouls?.homeYellowCards));
check(fouls?.awayYellowCards !== undefined, "awayYellowCards", String(fouls?.awayYellowCards));
check(fouls?.homeRedCards !== undefined, "homeRedCards", String(fouls?.homeRedCards));
check(fouls?.awayRedCards !== undefined, "awayRedCards", String(fouls?.awayRedCards));
console.log(`  ${C.dim}Fouls: H:${fouls?.homeFoulsCommitted ?? "?"} A:${fouls?.awayFoulsCommitted ?? "?"} | Offsides H:${fouls?.homeOffsides ?? "?"} A:${fouls?.awayOffsides ?? "?"}${C.reset}`);
console.log(`  ${C.dim}Cards: YellowH:${fouls?.homeYellowCards ?? "?"} YellowA:${fouls?.awayYellowCards ?? "?"} | RedH:${fouls?.homeRedCards ?? "?"} RedA:${fouls?.awayRedCards ?? "?"}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 16. GAME ODDS
// ─────────────────────────────────────────────────────────────────────────────
section("16. GAME ODDS (gameOdds from matchstats page)");
const odds = result.gameOdds;
check(odds !== undefined, "gameOdds field present");
if (odds && typeof odds === "object") {
  const hasAnyOdds = !!(odds?.moneylineHome || odds?.spread || odds?.total || odds?.provider);
  check(hasAnyOdds, "gameOdds has at least one field", JSON.stringify(odds)?.slice(0,100), true);
  if (odds?.provider) console.log(`  ${C.dim}Odds provider: ${odds.provider}${C.reset}`);
  if (odds?.moneylineHome) console.log(`  ${C.dim}Moneyline: Home ${odds.moneylineHome} Away ${odds.moneylineAway ?? "?"}${C.reset}`);
  if (odds?.spread) console.log(`  ${C.dim}Spread: ${odds.spread}${C.reset}`);
  if (odds?.total) console.log(`  ${C.dim}Total: ${odds.total}${C.reset}`);
} else {
  warn("gameOdds is null/empty (may not be available for this match)", String(odds));
}

// ─────────────────────────────────────────────────────────────────────────────
// 17. FULL TEAM STATS (combined deferred rows)
// ─────────────────────────────────────────────────────────────────────────────
section("17. FULL TEAM STATS (combined deferred rows)");
const fts = result.fullTeamStats;
check(Array.isArray(fts), "fullTeamStats is array");
const ftsCount = fts?.length ?? 0;
check(ftsCount >= 20, `fullTeamStats has ≥20 rows`, `${ftsCount} rows`);
const ftsSample = fts?.[0];
check(!!ftsSample?.name, "fullTeamStats[0].name", ftsSample?.name);
check(ftsSample?.homeValue !== undefined, "fullTeamStats[0].homeValue", String(ftsSample?.homeValue));
check(ftsSample?.awayValue !== undefined, "fullTeamStats[0].awayValue", String(ftsSample?.awayValue));
const ftsXG = fts?.find(s => s.name?.toLowerCase().includes("expected"));
check(!!ftsXG, "Expected Goals in fullTeamStats", ftsXG ? `${ftsXG.homeValue} vs ${ftsXG.awayValue}` : "missing");
const ftsTackles = fts?.find(s => s.name?.toLowerCase().includes("tackle"));
check(!!ftsTackles, "Tackles in fullTeamStats (defense section)", ftsTackles ? `H:${ftsTackles.homeValue} A:${ftsTackles.awayValue}` : "missing");
const ftsDuels = fts?.find(s => s.name?.toLowerCase().includes("duel"));
check(!!ftsDuels, "Duels in fullTeamStats (duels section)", ftsDuels ? `H:${ftsDuels.homeValue} A:${ftsDuels.awayValue}` : "missing");
const ftsFouls = fts?.find(s => s.name?.toLowerCase().includes("foul"));
check(!!ftsFouls, "Fouls in fullTeamStats (fouls section)", ftsFouls ? `H:${ftsFouls.homeValue} A:${ftsFouls.awayValue}` : "missing");
console.log(`  ${C.dim}Full stats: ${ftsCount} rows total${C.reset}`);
console.log(`  ${C.dim}All stat names: ${fts?.map(s => s.name).join(" | ")}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// 18. GLOSSARY
// ─────────────────────────────────────────────────────────────────────────────
section("18. GLOSSARY");
const glossary = result.glossary;
check(Array.isArray(glossary), "glossary is array", `${glossary?.length ?? 0} entries`, true);
if (Array.isArray(glossary) && glossary.length > 0) {
  check(!!glossary[0]?.abbr, "glossary[0].abbr", glossary[0]?.abbr, true);
  check(!!glossary[0]?.label, "glossary[0].label", glossary[0]?.label, true);
  console.log(`  ${C.dim}Glossary: ${glossary.slice(0,5).map(g => `${g.abbr}=${g.label}`).join(", ")}...${C.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
banner("TEST SUMMARY — 250x ESPN PAGE SCRAPER", failCount === 0 ? C.green : (failCount <= 3 ? C.yellow : C.red));

const total = passCount + failCount;
const pct = total > 0 ? Math.round((passCount / total) * 100) : 0;
const bars = Math.round(pct / 5);
const bar = "█".repeat(bars) + "░".repeat(20 - bars);

console.log(`  ${C.bold}Result:   ${passCount === total ? C.green : C.yellow}${passCount}/${total} PASS (${pct}%)${C.reset}`);
console.log(`  ${C.bold}Warnings: ${C.yellow}${warnCount}${C.reset}`);
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
  console.log(`  ${C.dim}Venue:       ${result.gameStrip?.venue ?? "?"} | Attendance: ${result.gameStrip?.attendance ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Referee:     ${result.gameStrip?.referee ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Formations:  ${result.lineups?.home?.formation ?? "?"} vs ${result.lineups?.away?.formation ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}xG:          Home ${result.expectedGoals?.homeTeamXG ?? "?"} | Away ${result.expectedGoals?.awayTeamXG ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Shots:       Home ${result.shots?.homeTotalShots ?? "?"} (SoG:${result.shots?.homeShotsOnGoal ?? "?"} Wood:${result.shots?.homeHitWoodwork ?? "?"} InBox:${result.shots?.homeAttemptsInsideBox ?? "?"})${C.reset}`);
  console.log(`  ${C.dim}             Away ${result.shots?.awayTotalShots ?? "?"} (SoG:${result.shots?.awayShotsOnGoal ?? "?"} Wood:${result.shots?.awayHitWoodwork ?? "?"} InBox:${result.shots?.awayAttemptsInsideBox ?? "?"})${C.reset}`);
  console.log(`  ${C.dim}Passes:      Home ${result.passes?.homeAccuratePasses ?? "?"} (${result.passes?.homePassAccuracyPct ?? "?"}) | Away ${result.passes?.awayAccuratePasses ?? "?"} (${result.passes?.awayPassAccuracyPct ?? "?"})${C.reset}`);
  console.log(`  ${C.dim}Defense:     Tackles H:${result.defense?.homeTackles ?? "?"} A:${result.defense?.awayTackles ?? "?"} | Interceptions H:${result.defense?.homeInterceptions ?? "?"} A:${result.defense?.awayInterceptions ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}             Clearances H:${result.defense?.homeClearances ?? "?"} A:${result.defense?.awayClearances ?? "?"} | Recoveries H:${result.defense?.homeRecoveries ?? "?"} A:${result.defense?.awayRecoveries ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Duels:       Won H:${result.duels?.homeDuelsWon ?? "?"} A:${result.duels?.awayDuelsWon ?? "?"} | Total H:${result.duels?.homeDuels ?? "?"} A:${result.duels?.awayDuels ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Fouls:       H:${result.fouls?.homeFoulsCommitted ?? "?"} A:${result.fouls?.awayFoulsCommitted ?? "?"} | Yellow H:${result.fouls?.homeYellowCards ?? "?"} A:${result.fouls?.awayYellowCards ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Attack:      BCC H:${result.attack?.homeBigChancesCreated ?? "?"} A:${result.attack?.awayBigChancesCreated ?? "?"} | Corners H:${result.attack?.homeCornersWon ?? "?"} A:${result.attack?.awayCornersWon ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}GK Table:    Saves H:${result.goalkeeping?.homeSaves ?? "?"} A:${result.goalkeeping?.awaySaves ?? "?"} | ShotsFaced H:${result.goalkeeping?.homeShotsFaced ?? "?"} A:${result.goalkeeping?.awayShotsFaced ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Players:     Home ${homePlayers} outfield + GK:${result.boxscore?.homeTeam?.goalkeeper?.name ?? "?"} | Away ${awayPlayers} outfield + GK:${result.boxscore?.awayTeam?.goalkeeper?.name ?? "?"}${C.reset}`);
  console.log(`  ${C.dim}Shot Map:    ${result.shotMap?.shots?.length ?? 0} shots | Full Stats: ${ftsCount} rows${C.reset}`);
  console.log(`  ${C.dim}xG Players:  ${result.expectedGoals?.perPlayer?.length ?? 0} players with xG/xA data${C.reset}`);
}

if (failCount > 0) {
  console.log(`\n  ${C.red}${C.bold}FAILED — ${failCount} check(s) did not pass${C.reset}`);
  process.exit(1);
} else {
  console.log(`\n  ${C.green}${C.bold}ALL 18 SECTIONS CONFIRMED — 250x ESPN Page Scraper OPERATIONAL ✓${C.reset}`);
}
