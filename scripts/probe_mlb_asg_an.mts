/**
 * probe_mlb_asg_an.mts — reconnaissance for the 2026 MLB All-Star Game (AL vs NL)
 *
 * The sandbox has no egress to api.actionnetwork.com (org policy 403), so this
 * runs in GitHub Actions (see .github/workflows/mlb-asg-probe.yml).
 *
 * Goal: capture, with ZERO guessing, the facts needed to wire the ASG into the
 * MLB "AI Model Projections" feed —
 *   1. AN team `url_slug` for the American League + National League squads
 *      (this becomes `anSlug` in shared/mlbTeams.ts so the EXISTING live AN
 *       refresh — refreshAnApiOdds → getMlbTeamByAnSlug — resolves the game and
 *       keeps its book odds current; the odds are NOT static).
 *   2. AN home/away orientation (which league AN lists as home).
 *   3. Current book ML / Run Line / Total (for the pre-publish relay + sanity).
 *   4. Confirmation of the ASG date.
 *
 * PRIMARY view uses the real scraper file `fetchActionNetworkOdds("mlb", date)`
 * (server/actionNetworkScraper.ts) so what we see == what the live refresh sees.
 * DIAGNOSTIC view raw-fetches the same AN v2 scoreboard endpoint and dumps the
 * unresolved game's full team + markets JSON, so nothing is hidden if the ASG
 * odds live under a book the scraper doesn't parse into fields.
 *
 * LOGGING: [ASG_PROBE]
 */
import { fetchActionNetworkOdds } from "../server/actionNetworkScraper";
import { getMlbTeamByAnSlug } from "../shared/mlbTeams";

const TAG = "[ASG_PROBE]";

// ASG is expected 2026-07-14 (Tue). Scan a small window so we can't miss it.
const DATES = (process.env.ASG_DATES?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [
  "2026-07-14",
  "2026-07-13",
  "2026-07-15",
  "2026-07-16",
];

const AN_BASE = "https://api.actionnetwork.com/web/v2/scoreboard";
const BOOK_IDS = "15,30,68,69,71,75,79";
const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/",
  Origin: "https://www.actionnetwork.com",
};

/** Human label for a book id (for the diagnostic dump). */
const BOOK_LABELS: Record<string, string> = {
  "15": "Consensus",
  "30": "Open",
  "68": "DK NJ",
  "69": "FanDuel NJ",
  "71": "BetRivers NJ",
  "75": "BetMGM NJ",
  "79": "bet365 NJ",
};

async function rawScoreboard(date: string): Promise<any | null> {
  const url = `${AN_BASE}/mlb?bookIds=${BOOK_IDS}&date=${date.replace(/-/g, "")}&periods=event`;
  try {
    const r = await fetch(url, { headers: AN_HEADERS });
    console.log(`${TAG} [RAW] GET ${url} -> HTTP ${r.status}`);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.log(`${TAG} [RAW] fetch failed: ${(e as Error).message}`);
    return null;
  }
}

function dumpRawAsg(date: string, raw: any): void {
  const games: any[] = raw?.games ?? [];
  for (const g of games) {
    const teams: any[] = g.teams ?? [];
    const byId = new Map<number, any>(teams.map((t) => [t.id, t]));
    const away = byId.get(g.away_team_id);
    const home = byId.get(g.home_team_id);
    const awaySlug = away?.url_slug ?? "?";
    const homeSlug = home?.url_slug ?? "?";
    const isAsg = !getMlbTeamByAnSlug(awaySlug) || !getMlbTeamByAnSlug(homeSlug);
    if (!isAsg) continue;

    console.log(`\n${TAG} ${"=".repeat(78)}`);
    console.log(`${TAG} *** UNRESOLVED (ALL-STAR?) GAME on ${date} — anGameId=${g.id} ***`);
    console.log(`${TAG} start_time=${g.start_time} status=${g.status} real_status=${g.real_status ?? "-"}`);
    console.log(`${TAG} AWAY (away_team_id=${g.away_team_id}): id=${away?.id} abbr=${away?.abbr} full_name="${away?.full_name}" display_name="${away?.display_name}" url_slug="${awaySlug}"`);
    console.log(`${TAG} HOME (home_team_id=${g.home_team_id}): id=${home?.id} abbr=${home?.abbr} full_name="${home?.full_name}" display_name="${home?.display_name}" url_slug="${homeSlug}"`);
    console.log(`${TAG} ORIENTATION: AN lists ${away?.abbr}/${away?.full_name} @ ${home?.abbr}/${home?.full_name}  (away @ home)`);

    // Full raw markets per book so no odds are hidden.
    const markets = g.markets ?? {};
    for (const bookId of BOOK_IDS.split(",")) {
      const ev = markets?.[bookId]?.event;
      if (!ev) continue;
      const ml = ev.moneyline ?? [];
      const sp = ev.spread ?? [];
      const tot = ev.total ?? [];
      if (ml.length === 0 && sp.length === 0 && tot.length === 0) continue;
      console.log(`${TAG}   [book ${bookId} ${BOOK_LABELS[bookId] ?? "?"}]`);
      const fmt = (o: any) =>
        `side=${o.side ?? "-"} team_id=${o.team_id ?? "-"} value=${o.value ?? "-"} odds=${o.odds} is_live=${o.is_live ?? false}`;
      for (const o of ml) console.log(`${TAG}       ML     ${fmt(o)}`);
      for (const o of sp) console.log(`${TAG}       SPREAD ${fmt(o)}`);
      for (const o of tot) console.log(`${TAG}       TOTAL  ${fmt(o)}`);
    }
    console.log(`${TAG} FULL RAW GAME JSON:`);
    console.log(JSON.stringify({ id: g.id, start_time: g.start_time, status: g.status, away_team_id: g.away_team_id, home_team_id: g.home_team_id, teams: g.teams, markets: g.markets }, null, 2));
  }
}

async function main() {
  console.log(`${TAG} ${"=".repeat(78)}`);
  console.log(`${TAG} MLB All-Star Game AN probe — dates: ${DATES.join(", ")}`);
  console.log(`${TAG} ${"=".repeat(78)}`);

  let foundAny = false;

  for (const date of DATES) {
    console.log(`\n${TAG} ${"-".repeat(78)}`);
    console.log(`${TAG} DATE ${date}`);

    // ── PRIMARY: the real scraper file (what the live refresh will see) ──────
    let anGames: Awaited<ReturnType<typeof fetchActionNetworkOdds>> = [];
    try {
      anGames = await fetchActionNetworkOdds("mlb", date);
    } catch (e) {
      console.log(`${TAG} [SCRAPER] fetchActionNetworkOdds threw: ${(e as Error).message}`);
    }
    console.log(`${TAG} [SCRAPER] fetchActionNetworkOdds("mlb","${date}") -> ${anGames.length} games`);
    for (const g of anGames) {
      const awayResolved = !!getMlbTeamByAnSlug(g.awayUrlSlug);
      const homeResolved = !!getMlbTeamByAnSlug(g.homeUrlSlug);
      const flag = awayResolved && homeResolved ? "    " : ">>> ";
      console.log(
        `${TAG} ${flag}${g.awayUrlSlug} (${g.awayAbbr}) @ ${g.homeUrlSlug} (${g.homeAbbr}) | anId=${g.gameId} | ` +
        `resolved away=${awayResolved} home=${homeResolved}`
      );
      console.log(
        `${TAG}       DK:   ML=${g.dkAwayML}/${g.dkHomeML} RL=${g.dkAwaySpread}(${g.dkAwaySpreadOdds})/${g.dkHomeSpread}(${g.dkHomeSpreadOdds}) TOT=${g.dkTotal}(O ${g.dkOverOdds}/U ${g.dkUnderOdds})`
      );
      console.log(
        `${TAG}       OPEN: ML=${g.openAwayML}/${g.openHomeML} RL=${g.openAwaySpread}(${g.openAwaySpreadOdds})/${g.openHomeSpread}(${g.openHomeSpreadOdds}) TOT=${g.openTotal}(O ${g.openOverOdds}/U ${g.openUnderOdds})`
      );
      if (!awayResolved || !homeResolved) {
        foundAny = true;
        console.log(`${TAG}       ^^^ UNRESOLVED SLUG(S) — this is the All-Star game. anSlug to register: away="${g.awayUrlSlug}" home="${g.homeUrlSlug}"`);
        console.log(`${TAG}       full names: away="${g.awayFullName}" home="${g.homeFullName}" | startTime=${g.startTime} status=${g.status}`);
      }
    }

    // ── DIAGNOSTIC: raw markets dump for the unresolved game ─────────────────
    const raw = await rawScoreboard(date);
    if (raw) dumpRawAsg(date, raw);
  }

  console.log(`\n${TAG} ${"=".repeat(78)}`);
  console.log(`${TAG} DONE. All-Star game found in window: ${foundAny}`);
  if (!foundAny) {
    console.log(`${TAG} No unresolved (AL/NL) game in ${DATES.join(",")}. Re-run with ASG_DATES=YYYY-MM-DD[,...] once the correct date is known.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} [FATAL] ${err?.stack ?? err}`);
  process.exit(1);
});
