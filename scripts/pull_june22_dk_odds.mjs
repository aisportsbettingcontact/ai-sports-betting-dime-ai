/**
 * pull_june22_dk_odds.mjs  v2
 * ============================================================
 * Pulls DraftKings (book_id=68) odds for all 4 June 22, 2026
 * WC2026 matches from the Action Network API.
 *
 * Confirmed AN API structure (from inspection):
 *   game.markets["68"].event = {
 *     moneyline: [...],
 *     totals: [...],
 *     double_chance: [...],   // may not exist
 *     ...
 *   }
 *
 * Orientation resolution:
 *   - Uses game.home_team_id / game.away_team_id (AN ground truth)
 *   - Uses team_id on each outcome for per-outcome resolution
 *   - Flags any AN vs user-provided home/away discrepancy
 *
 * User-provided match orientations (Away vs Home):
 *   1. Austria (away) vs Argentina (home)  — Argentina favorite
 *   2. Iraq (away) vs France (home)        — France favorite
 *   3. Senegal (away) vs Norway (home)     — Norway favorite
 *   4. Algeria (away) vs Jordan (home)     — Algeria favorite
 * ============================================================
 */

import https from "https";
import zlib from "zlib";

const AN_DATE = "20260622";
const DK_BOOK_ID = "68";
const AN_BASE = "api.actionnetwork.com";
const AN_PATH = `/web/v2/scoreboard/soccer?bookIds=68&date=${AN_DATE}&periods=event`;

const AN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Encoding": "gzip",
  "Referer": "https://www.actionnetwork.com/",
  "Origin": "https://www.actionnetwork.com",
  "Connection": "keep-alive",
};

// User-provided match orientations
const USER_MATCHES = [
  { awayTeam: "Austria",  homeTeam: "Argentina", awayId: 2214, homeId: 1934, favorite: "Argentina" },
  { awayTeam: "Iraq",     homeTeam: "France",    awayId: 6181, homeId: 1944, favorite: "France"    },
  { awayTeam: "Senegal",  homeTeam: "Norway",    awayId: 1959, homeId: 6134, favorite: "Norway"    },
  { awayTeam: "Algeria",  homeTeam: "Jordan",    awayId: 6174, homeId: 6104, favorite: "Algeria"   },
];

function fetchAN(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: AN_BASE, path, method: "GET", headers: AN_HEADERS }, (res) => {
      console.log(`[AN_API] [STATE] HTTP ${res.statusCode} | Content-Encoding: ${res.headers["content-encoding"] ?? "none"}`);
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers["content-encoding"] ?? "";
        const decompress = enc === "gzip" ? zlib.gunzip : enc === "br" ? zlib.brotliDecompress : (b, cb) => cb(null, b);
        decompress(buf, (err, out) => {
          if (err) { reject(err); return; }
          const text = out.toString("utf8");
          console.log(`[AN_API] [STATE] Decompressed: ${text.length} bytes`);
          try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function americanToProb(a) {
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}

function removeVig3(h, d, a) {
  const pH = americanToProb(h), pD = americanToProb(d), pA = americanToProb(a);
  const t = pH + pD + pA;
  return { h: pH/t, d: pD/t, a: pA/t, vig: ((t-1)*100).toFixed(2) };
}

function removeVig2(o, u) {
  const pO = americanToProb(o), pU = americanToProb(u);
  const t = pO + pU;
  return { o: pO/t, u: pU/t, vig: ((t-1)*100).toFixed(2) };
}

function probToAmerican(p) {
  if (p >= 0.5) return -Math.round((p / (1-p)) * 100);
  return Math.round(((1-p) / p) * 100);
}

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("[JUNE22_ODDS] WC2026 June 22 DK Odds Pull — v2");
  console.log(`[JUNE22_ODDS] Date: ${AN_DATE} | Book: DraftKings (book_id=${DK_BOOK_ID})`);
  console.log("════════════════════════════════════════════════════════");

  // ── Step 1: Fetch AN API ──────────────────────────────────
  console.log("\n[STEP 1] Fetching Action Network API (HTTP/1.1, gzip)...");
  const data = await fetchAN(AN_PATH);
  console.log(`[STEP 1] [VERIFY] games returned: ${data.games?.length ?? 0}`);

  // Map AN games by game_id for quick lookup
  const anGames = {};
  for (const g of (data.games ?? [])) {
    anGames[g.id] = g;
    const t0 = g.teams[0].full_name;
    const t1 = g.teams[1].full_name;
    console.log(`[STEP 1]   game_id=${g.id}: "${t0}"(id=${g.teams[0].id}) vs "${t1}"(id=${g.teams[1].id}) | AN home_team_id=${g.home_team_id} away_team_id=${g.away_team_id}`);
  }

  const results = [];

  for (const fix of USER_MATCHES) {
    console.log("\n════════════════════════════════════════════════════════");
    console.log(`[MATCH] ${fix.awayTeam} (away, id=${fix.awayId}) @ ${fix.homeTeam} (home, id=${fix.homeId}) | Favorite: ${fix.favorite}`);
    console.log("════════════════════════════════════════════════════════");

    // ── Step 2: Find matching AN game ─────────────────────────
    const game = data.games?.find(g =>
      (g.teams[0].id === fix.homeId || g.teams[1].id === fix.homeId) &&
      (g.teams[0].id === fix.awayId || g.teams[1].id === fix.awayId)
    );

    if (!game) {
      console.error(`[STEP 2] [FAIL] No AN game found for ${fix.awayTeam} @ ${fix.homeTeam}`);
      results.push({ fix, error: "NOT_FOUND" });
      continue;
    }

    console.log(`[STEP 2] [OUTPUT] Matched game_id=${game.id}`);
    console.log(`[STEP 2] [STATE] AN home_team_id=${game.home_team_id} | AN away_team_id=${game.away_team_id}`);

    // ── Step 3: Orientation validation ───────────────────────
    const anHomeIsUserHome = game.home_team_id === fix.homeId;
    const anAwayIsUserAway = game.away_team_id === fix.awayId;

    if (anHomeIsUserHome && anAwayIsUserAway) {
      console.log(`[STEP 3] [VERIFY] ✅ AN orientation MATCHES user assignment: ${fix.homeTeam}=home, ${fix.awayTeam}=away`);
    } else {
      console.warn(`[STEP 3] [WARN] ⚠️ AN ORIENTATION MISMATCH:`);
      console.warn(`[STEP 3] [WARN]   AN home_team_id=${game.home_team_id} → ${game.home_team_id === fix.homeId ? fix.homeTeam : fix.awayTeam}`);
      console.warn(`[STEP 3] [WARN]   AN away_team_id=${game.away_team_id} → ${game.away_team_id === fix.awayId ? fix.awayTeam : fix.homeTeam}`);
      console.warn(`[STEP 3] [WARN]   User says: ${fix.homeTeam}=home, ${fix.awayTeam}=away`);
      console.warn(`[STEP 3] [WARN]   team_id-based resolution will be used for all outcome mapping`);
    }

    // ── Step 4: Extract DK markets ────────────────────────────
    const dkBook = game.markets?.[DK_BOOK_ID];
    if (!dkBook) {
      console.error(`[STEP 4] [FAIL] No DK (book_id=${DK_BOOK_ID}) markets for this game`);
      results.push({ fix, error: "NO_DK_MARKETS" });
      continue;
    }

    const dkEvent = dkBook.event ?? {};
    const availableTypes = Object.keys(dkEvent);
    console.log(`[STEP 4] [STATE] DK market types available: ${availableTypes.join(", ")}`);

    // ── 4a: Moneyline (1X2) ───────────────────────────────────
    console.log("\n[STEP 4a] ── MONEYLINE (1X2) ──");
    const mlArr = dkEvent.moneyline ?? dkEvent["1x2"] ?? dkEvent["three_way_moneyline"] ?? [];
    let homeML = null, drawML = null, awayML = null;

    if (mlArr.length === 0) {
      console.warn("[STEP 4a] [WARN] No moneyline market found for DK");
    } else {
      console.log(`[STEP 4a] [STATE] Moneyline outcomes: ${mlArr.length}`);
      for (const o of mlArr) {
        const side = o.side?.toLowerCase();
        const odds = o.odds ?? o.money;
        const teamId = o.team_id ?? o.competitor_id;
        console.log(`[STEP 4a] [STATE] outcome: side="${side}" odds=${odds} team_id=${teamId ?? "N/A"}`);

        if (side === "draw") {
          drawML = odds;
          console.log(`[STEP 4a] [OUTPUT] DRAW = ${odds}`);
        } else if (teamId === fix.homeId) {
          homeML = odds;
          console.log(`[STEP 4a] [OUTPUT] HOME ML (${fix.homeTeam}, team_id=${teamId}) = ${odds} ✅ [team_id resolved]`);
        } else if (teamId === fix.awayId) {
          awayML = odds;
          console.log(`[STEP 4a] [OUTPUT] AWAY ML (${fix.awayTeam}, team_id=${teamId}) = ${odds} ✅ [team_id resolved]`);
        } else if (teamId === 0 || teamId == null) {
          // No team_id — use side label with AN home_team_id as reference
          if (side === "home") {
            if (anHomeIsUserHome) {
              homeML = odds;
              console.log(`[STEP 4a] [OUTPUT] HOME ML (${fix.homeTeam}) = ${odds} [side label, no team_id]`);
            } else {
              awayML = odds;
              console.log(`[STEP 4a] [OUTPUT] AWAY ML (${fix.awayTeam}) = ${odds} [side label swapped, no team_id]`);
            }
          } else if (side === "away") {
            if (anHomeIsUserHome) {
              awayML = odds;
              console.log(`[STEP 4a] [OUTPUT] AWAY ML (${fix.awayTeam}) = ${odds} [side label, no team_id]`);
            } else {
              homeML = odds;
              console.log(`[STEP 4a] [OUTPUT] HOME ML (${fix.homeTeam}) = ${odds} [side label swapped, no team_id]`);
            }
          }
        } else {
          console.warn(`[STEP 4a] [WARN] Unknown team_id=${teamId} for side="${side}" odds=${odds}`);
        }
      }

      // Validate: favorite should have negative ML
      if (homeML !== null && awayML !== null) {
        const favIsHome = fix.favorite === fix.homeTeam;
        const favML = favIsHome ? homeML : awayML;
        const dogML = favIsHome ? awayML : homeML;
        console.log(`\n[STEP 4a] [VERIFY] Favorite (${fix.favorite}) ML = ${favML} | expected: negative`);
        console.log(`[STEP 4a] [VERIFY] Underdog ML = ${dogML} | expected: positive`);
        if (favML > 0) {
          console.error(`[STEP 4a] [FAIL] ❌ ORIENTATION ERROR: ${fix.favorite} has POSITIVE ML=${favML} — INVERTED`);
          [homeML, awayML] = [awayML, homeML];
          console.log(`[STEP 4a] [VERIFY] After emergency swap: HOME(${fix.homeTeam})=${homeML} | AWAY(${fix.awayTeam})=${awayML}`);
        } else {
          console.log(`[STEP 4a] [VERIFY] ✅ Orientation correct`);
        }
      }
    }

    // ── 4b: Totals ────────────────────────────────────────────
    console.log("\n[STEP 4b] ── TOTALS ──");
    const totArr = dkEvent.totals ?? dkEvent.total ?? dkEvent.over_under ?? [];
    let overLine = null, overOdds = null, underOdds = null;

    if (totArr.length === 0) {
      console.warn("[STEP 4b] [WARN] No totals market found for DK");
    } else {
      console.log(`[STEP 4b] [STATE] Totals outcomes: ${totArr.length}`);
      for (const o of totArr) {
        const side = o.side?.toLowerCase();
        const odds = o.odds ?? o.money;
        const line = o.value ?? o.total ?? o.handicap;
        console.log(`[STEP 4b] [STATE] outcome: side="${side}" odds=${odds} line=${line}`);

        if (side === "over") {
          overLine = line;
          overOdds = odds;
          console.log(`[STEP 4b] [OUTPUT] OVER line=${line} odds=${odds}`);
        } else if (side === "under") {
          if (!overLine) overLine = line;
          underOdds = odds;
          console.log(`[STEP 4b] [OUTPUT] UNDER line=${line} odds=${odds}`);
        }
      }

      if (overOdds !== null && underOdds !== null) {
        const nv = removeVig2(overOdds, underOdds);
        console.log(`[STEP 4b] [VERIFY] ✅ O${overLine}=${overOdds} U${overLine}=${underOdds} | no-vig O=${(nv.o*100).toFixed(1)}% U=${(nv.u*100).toFixed(1)}% | vig=${nv.vig}%`);
      }
    }

    // ── 4c: Double Chance ─────────────────────────────────────
    console.log("\n[STEP 4c] ── DOUBLE CHANCE ──");
    const dcArr = dkEvent.double_chance ?? dkEvent["double chance"] ?? dkEvent.dc ?? [];
    let homeDraw = null, awayDraw = null;
    let dcSource = "DK_BOOK";

    if (dcArr.length === 0) {
      console.warn("[STEP 4c] [WARN] No double_chance market found for DK on this game");
      console.warn("[STEP 4c] [WARN] Available DK market types: " + availableTypes.join(", "));
      dcSource = "COMPUTED_FROM_1X2";

      if (homeML !== null && drawML !== null && awayML !== null) {
        const nv = removeVig3(homeML, drawML, awayML);
        homeDraw = probToAmerican(nv.h + nv.d);
        awayDraw = probToAmerican(nv.a + nv.d);
        console.log(`[STEP 4c] [STATE] Computed from 1X2 no-vig: 1X(${fix.homeTeam} or Draw)=${homeDraw} | X2(${fix.awayTeam} or Draw)=${awayDraw}`);
        console.log(`[STEP 4c] [WARN] ⚠️ DC values are COMPUTED (no DK line available)`);
      } else {
        console.warn("[STEP 4c] [WARN] Cannot compute DC — 1X2 incomplete");
      }
    } else {
      console.log(`[STEP 4c] [STATE] Double chance outcomes: ${dcArr.length}`);
      for (const o of dcArr) {
        const side = o.side?.toLowerCase();
        const odds = o.odds ?? o.money;
        const teamId = o.team_id ?? o.competitor_id;
        const label = o.label ?? o.name ?? side;
        console.log(`[STEP 4c] [STATE] outcome: side="${side}" odds=${odds} team_id=${teamId ?? "N/A"} label="${label}"`);

        // DC sides: "home_draw" (1X) and "away_draw" (X2)
        // Use team_id to resolve which team is "home" in this DC context
        if (side === "home_draw" || side === "1x") {
          if (teamId != null && teamId !== 0 && teamId === fix.awayId) {
            // AN labeled home_draw but team_id is away — swap
            awayDraw = odds;
            console.log(`[STEP 4c] [OUTPUT] X2 (${fix.awayTeam} or Draw) = ${odds} [team_id override]`);
          } else {
            homeDraw = odds;
            console.log(`[STEP 4c] [OUTPUT] 1X (${fix.homeTeam} or Draw) = ${odds}`);
          }
        } else if (side === "away_draw" || side === "x2") {
          if (teamId != null && teamId !== 0 && teamId === fix.homeId) {
            // AN labeled away_draw but team_id is home — swap
            homeDraw = odds;
            console.log(`[STEP 4c] [OUTPUT] 1X (${fix.homeTeam} or Draw) = ${odds} [team_id override]`);
          } else {
            awayDraw = odds;
            console.log(`[STEP 4c] [OUTPUT] X2 (${fix.awayTeam} or Draw) = ${odds}`);
          }
        } else {
          console.warn(`[STEP 4c] [WARN] Unknown DC side="${side}" — skipping`);
        }
      }
    }

    // ── Step 5: No-vig validation ─────────────────────────────
    console.log("\n[STEP 5] ── NO-VIG VALIDATION ──");
    if (homeML !== null && drawML !== null && awayML !== null) {
      const nv = removeVig3(homeML, drawML, awayML);
      const favProb = fix.favorite === fix.homeTeam ? nv.h : nv.a;
      console.log(`[STEP 5] [STATE] 1X2 no-vig: H=${(nv.h*100).toFixed(2)}% D=${(nv.d*100).toFixed(2)}% A=${(nv.a*100).toFixed(2)}% | vig=${nv.vig}%`);
      console.log(`[STEP 5] [VERIFY] Favorite (${fix.favorite}) no-vig prob: ${(favProb*100).toFixed(1)}%`);
    }
    if (overOdds !== null && underOdds !== null) {
      const nv = removeVig2(overOdds, underOdds);
      console.log(`[STEP 5] [STATE] Total no-vig: O${overLine}=${(nv.o*100).toFixed(2)}% U${overLine}=${(nv.u*100).toFixed(2)}% | vig=${nv.vig}%`);
    }

    // ── Step 6: Final output ──────────────────────────────────
    console.log(`\n[STEP 6] ════ FINAL OUTPUT: ${fix.awayTeam} (away) @ ${fix.homeTeam} (home) ════`);
    console.log(`[STEP 6]   Away ML  (${fix.awayTeam.padEnd(10)}): ${awayML ?? "UNAVAILABLE"}`);
    console.log(`[STEP 6]   Home ML  (${fix.homeTeam.padEnd(10)}): ${homeML ?? "UNAVAILABLE"}`);
    console.log(`[STEP 6]   Draw                     : ${drawML ?? "UNAVAILABLE"}`);
    console.log(`[STEP 6]   Away/Draw X2 (${fix.awayTeam.padEnd(6)}): ${awayDraw ?? "UNAVAILABLE"}${dcSource === "COMPUTED_FROM_1X2" ? " ⚠️ COMPUTED" : ""}`);
    console.log(`[STEP 6]   Home/Draw 1X (${fix.homeTeam.padEnd(6)}): ${homeDraw ?? "UNAVAILABLE"}${dcSource === "COMPUTED_FROM_1X2" ? " ⚠️ COMPUTED" : ""}`);
    console.log(`[STEP 6]   Over/Under Line           : ${overLine ?? "UNAVAILABLE"}`);
    console.log(`[STEP 6]   Over Odds                 : ${overOdds ?? "UNAVAILABLE"}`);
    console.log(`[STEP 6]   Under Odds                : ${underOdds ?? "UNAVAILABLE"}`);

    results.push({ fix, anGameId: game.id, anHomeId: game.home_team_id, anAwayId: game.away_team_id, anHomeIsUserHome, homeML, drawML, awayML, overLine, overOdds, underOdds, homeDraw, awayDraw, dcSource });
  }

  // ── Final summary ─────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════");
  console.log("[JUNE22_ODDS] ═══ COMPLETE SUMMARY — ALL 4 MATCHES ═══");
  console.log("════════════════════════════════════════════════════════");

  for (const r of results) {
    if (r.error) {
      console.log(`\n❌ ${r.fix.awayTeam} @ ${r.fix.homeTeam}: ${r.error}`);
      continue;
    }
    const orientFlag = r.anHomeIsUserHome ? "✅ MATCH" : "⚠️ MISMATCH";
    console.log(`\n✅ ${r.fix.awayTeam} (away) @ ${r.fix.homeTeam} (home) | game_id=${r.anGameId}`);
    console.log(`   AN orientation: ${orientFlag} | AN home_id=${r.anHomeId} | AN away_id=${r.anAwayId}`);
    console.log(`   Away ML  (${r.fix.awayTeam}):  ${r.awayML ?? "N/A"}`);
    console.log(`   Home ML  (${r.fix.homeTeam}): ${r.homeML ?? "N/A"}`);
    console.log(`   Draw:                          ${r.drawML ?? "N/A"}`);
    console.log(`   Away/Draw X2 (${r.fix.awayTeam}): ${r.awayDraw ?? "N/A"}${r.dcSource === "COMPUTED_FROM_1X2" ? " ⚠️ COMPUTED" : ""}`);
    console.log(`   Home/Draw 1X (${r.fix.homeTeam}): ${r.homeDraw ?? "N/A"}${r.dcSource === "COMPUTED_FROM_1X2" ? " ⚠️ COMPUTED" : ""}`);
    console.log(`   Over/Under Line: ${r.overLine ?? "N/A"}`);
    console.log(`   Over Odds:       ${r.overOdds ?? "N/A"}`);
    console.log(`   Under Odds:      ${r.underOdds ?? "N/A"}`);
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log("[JUNE22_ODDS] Pull complete.");
  return results;
}

main().catch(err => { console.error("[FATAL]", err.message); process.exit(1); });
