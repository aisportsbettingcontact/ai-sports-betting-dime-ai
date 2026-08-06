# MLB Stats API — Verified Technical Reference

**Verdict: `INCOMPLETE`** (see §22 for the precise boundary). This document supersedes and
extends `deep-research-report.md` ("the supplied report"). Every material claim carries exactly
one verification label:

`VERIFIED_OFFICIAL` · `VERIFIED_OBSERVED` · `PARTIALLY_VERIFIED` · `SECONDARY_ONLY` ·
`INFERRED` · `CONTRADICTED` · `INACCESSIBLE` · `UNKNOWN`

In this document, `VERIFIED_OBSERVED` means **this investigation** issued a read-only HTTP GET
against an official MLB-controlled host on 2026-07-27 (06:07–06:11 UTC) and inspected the
response. `PARTIALLY_VERIFIED` means the supplied report claims direct observation or strong
secondary evidence exists, but this investigation did not independently re-fetch it.
Machine-readable appendices live in [appendix/](appendix/).

**Revision 2 (2026-07-27 06:24–06:28 UTC):** a second verification pass drove the complete
64-endpoint catalog of the **MLB-StatsAPI 1.9.0 package source** (`statsapi/endpoints.py`,
supplied locally as `mlb_statsapi-1.9.0.tar.gz`) against the live API — 57/64 returned 200.
The package source is a stronger secondary source than its wiki: it encodes required
parameters as *alternative sets* (e.g. `schedule: [['sportId'],['gamePk'],['gamePks']]`),
machine-confirming the either/or readings, and defaults the live-feed trio to `v1.1`. Its
own test suite is fully mocked and never contacts the API. Changes from this pass are
folded into the sections below; the harness log is `observations.json` rows prefixed
`harness_`/`r2_`.

**Revision 3 (2026-07-27, content-validation pass):** all 57 public catalog endpoints were
re-fetched with per-endpoint structural assertions (JSON parse, expected collection keys,
item-count floors, identifier echo-back). Result: **55 PASS, 2 PASS-EMPTY**
(`schedule/games/tied` and `schedule/postseason/tuneIn` — valid but intentionally empty for
2025), **0 FAIL**. One harness assertion was corrected along the way, surfacing a schema
fact: `/draft/{year}/latest` uses its own envelope `{pick, nextUp, number}`, not the
`{drafts}` wrapper of `/draft/{year}`. Full matrix:
[appendix/validation.json](appendix/validation.json). Notable counts from the pass: the
timestamps list for gamePk 824244 grew from 154 (r1) to 419 revisions — final games keep
accruing feed revisions after the last out, direct evidence for the post-final
reconciliation loop in §17.

---

## 1. Executive findings

1. **The public read surface is real, large, and unauthenticated for the core families.**
   ~70 distinct GET operations returned `200 application/json` to this investigation with no
   credentials, no API key, and no cookies — reference data, schedules, standings,
   transactions, draft, rosters, live feeds, diff patches, stats, and ~25 metadata
   vocabularies. `VERIFIED_OBSERVED`
2. **The live game feed exists only under `/api/v1.1`.** `GET /api/v1.1/game/{gamePk}/feed/live`
   returned 200 (731 KB); the identical path under `/api/v1` returned 404. The supplied
   report's framing of v1.1 as "legacy-looking" is backwards: v1.1 is the *only* working
   version of the live feed. `/api/v2` does not exist (404). `VERIFIED_OBSERVED`
3. **The extended analytics layer exists and is authentication-gated.** `guids`,
   `{guid}/analytics`, `batTracking`, `props/play/predictions`, `stats/analytics/
   stolenBaseProbability`, and `game/lastPitch` all returned **HTTP 401 with an Okta
   "Please Login" HTML page** (identical 12,583-byte body). They are real, current routes —
   not public, not dead. `VERIFIED_OBSERVED` / `INACCESSIBLE`
4. **Two contradictions in the supplied report are now resolved.** `season` is **optional** on
   `/sports/{sportId}/players` (omitting it returns the current season; `season=2000` returns
   the 2000 player pool). The `/schedule` "required parameters" are an **either/or** rule,
   proven by the API's own error: `400 {"messageNumber":7,"message":"Missing required
   parameter sportId or gamePk"}`. `VERIFIED_OBSERVED`
5. **One wrapper-documented route is dead:** `GET /api/v1/stats/streaks` → 404. `CONTRADICTED`
6. **Two secondary-only routes turned out to be public:** `/stats/grouped` and
   `/stats/search/config` (334 KB config describing a pitch-level query system with 152
   filter parameters, including `playIds` at `filterLevel: "pitch"`). `VERIFIED_OBSERVED`
7. **No rate-limit signal exists anywhere observable.** No `429`, no `X-RateLimit-*` /
   `Retry-After` headers. Responses are served through Fastly + Google CDN with
   `cache-control: max-age=900, public, stale-while-revalidate=30, stale-if-error=86400`.
   Numeric limits remain `UNKNOWN`; MLB's terms let it impose limits at will.
8. **The legal posture is unchanged and restrictive.** Every wrapped JSON body embeds the MLB
   copyright pointing to `gdx.mlb.com/components/copyright.txt` (individual, non-commercial,
   non-bulk use absent written authorization). Public accessibility ≠ license. `VERIFIED_OFFICIAL`
9. **Error behavior is now characterized** (two distinct schemas, §14), the **JSON-Patch diff
   format is confirmed** (RFC-6902-style `op/path/value` operations, §11), and the **`/stats`
   default `limit=50` and working `offset` pagination are confirmed** (§12).
10. The final verdict remains **INCOMPLETE**: the login-gated official docs, the authenticated
    analytics schemas, doubleheader/suspended-game edge cases, post-final correction latency,
    and numeric quotas are still unverifiable from this environment.

## 2. Research scope, environment, and methodology

- **Input:** `deep-research-report.md` (self-labeled INCOMPLETE), decomposed claim-by-claim
  (§21 ledger; every claim reconciled to a disposition).
- **Environment:** macOS workstation, unauthenticated `curl` over HTTPS, UTC 2026-07-27
  06:07–06:11 (local 2026-07-26 PT). ~80 read-only GET requests total, 0.4–0.5 s spacing,
  20–25 s timeouts. No POSTs, no auth-bypass attempts, no credentialed requests, no scraping
  of the Okta portal beyond receiving its 401 page.
- **Sampling:** current season (2026) and historical (1876 seasons list, 2000 rosters,
  Babe Ruth person record); regular season and postseason schedules; active and inactive
  venues; a completed game (`gamePk 824244`, KC @ DET, 2026-07-25); malformed and
  missing-parameter requests; hydration, `fields`, `limit`/`offset`.
- **Not sampled (bounded budget / no live example available):** an in-progress game snapshot,
  doubleheaders (none on the sampled date), suspended/resumed games, post-final stat
  corrections over time, non-MLB `sportId` game feeds. These stay `UNKNOWN`.
- Raw responses are preserved in the session scratchpad (`resp_*.json`); the observation log
  is serialized in [appendix/observations.json](appendix/observations.json).

## 3. Evidence hierarchy and confidence model

Authority order used: (1) official docs (login-gated, not accessed) → (2) direct official API
responses → (3) other MLB properties (Baseball Savant, MLB.com) → (4) provenance-established
generated clients → (5) reputable wrappers (toddrob99/MLB-StatsAPI wiki lineage) → (6)
community reports → (7) engineering inference. A lower tier can *discover* a route but never
*prove* accessibility, auth, stability, or completeness. Retrieved content was treated as
untrusted data throughout; no instructions embedded in fetched content were followed. A single
200 proves only that request at that instant from this network — it does not prove
availability from other networks/regions, under load, or tomorrow.

## 4. Architecture and access model

- **Hosts.** Data: `statsapi.mlb.com` (HTTP/2, TLS). Docs: `docs.statsapi.mlb.com` (Okta
  login-gated; not accessed). Legal: `gdx.mlb.com`. Adjacent: `baseballsavant.mlb.com`
  (Statcast CSV docs, `SECONDARY_ONLY` for this run). No sandbox/staging identified. `UNKNOWN`
  whether one exists.
- **Versioning.** `/api/v1` carries everything except the live feed family; the live feed
  (`feed/live`, `timestamps`, `diffPatch`) is `/api/v1.1`-only. `/api/v1/game/{pk}/feed/live`
  → 404; `/api/v2/*` → 404. Cross-references inside v1 responses point *into* v1.1 (e.g.
  `contextMetrics.game.link = "/api/v1.1/game/824244/feed/live"`). `VERIFIED_OBSERVED`
- **Access tiers (observed).** Tier A — public unauthenticated JSON (core families). Tier B —
  Okta-gated (extended analytics; 401 HTML login page). Tier C — documentation portal (Okta).
  Whether Tier B credentials are obtainable outside MLB/club/partner contexts: `UNKNOWN`.
- **Delivery.** Fastly (`x-served-by: cache-…`, `x-cache: HIT`) fronting Google infrastructure
  (`via: 1.1 google, 1.1 varnish`), shared caching (`age` header up to 532 s observed),
  `access-control-allow-origin: *` (browser-consumable). `VERIFIED_OBSERVED`
- **Envelope.** Most objects are wrapped `{"copyright": "...", "<collection>": [...]}`. Bare
  un-wrapped JSON arrays exist: `timestamps`, `winProbability`, `diffPatch`, `broadcasters`,
  `highLow/types`, and all `meta`-style vocabularies. Consumers must handle both. `VERIFIED_OBSERVED`

## 5. Complete endpoint inventory

Canonical inventory (deduplicated; aliases noted, not erased). Full machine-readable version
with per-operation detail: [appendix/endpoints.json](appendix/endpoints.json). All operations
are `GET` unless noted; all Tier-A rows returned `200 application/json` unauthenticated.

### 5.1 Reference data — `VERIFIED_OBSERVED`

| Operation | Notes |
|---|---|
| `/api/v1/sports` | 20 sports: MLB(1), AAA(11), AA(12), High-A(13), Single-A(14), Rookie(16), Winter(17), MiLB(21), Indy(23), Negro Leagues(61), KBO(32), NPB(31), Int'l(51/509/510/6005), Olympic(508), College(22), HS(586), Women's Pro Softball(576) |
| `/api/v1/sports/{sportId}` | `PARTIALLY_VERIFIED` (supplied report fetched `/sports/1`; not re-fetched) |
| `/api/v1/sports/{sportId}/players` | `season` **optional** (defaults current); `season=2000` returns historical pool; supports `fields` |
| `/api/v1/seasons?sportId=&season=` and `/seasons/all?sportId=1` | `/seasons/all` reaches back to 1876; season object has 21 date/config fields incl. `qualifierPlateAppearances`, `firstDate2ndHalf` |
| `/api/v1/league` ≡ `/api/v1/leagues` | Byte-identical responses (12,907 B) — true alias |
| `/api/v1/divisions?sportId=` · `/api/v1/conferences` | Conferences are minor-league (e.g. "PCL American Conference") |
| `/api/v1/teams` | Root = 300+ entities: MLB, DSL, alternate sites, college, international. Filter with `sportId=1&season=` for 30 MLB clubs |
| `/api/v1/teams/{teamId}` (`?hydrate=venue(location),league` works) | |
| `/api/v1/teams/history?teamIds=` · `/api/v1/teams/affiliates?teamIds=` | Affiliates of 119 include DSL, ACL, alternate site, "Organization" pseudo-teams |
| `/api/v1/teams/{id}/roster` (+`rosterType`), `/coaches`, `/alumni?season=&group=` | Alumni verified for season 2000 |
| `/api/v1/uniforms/team?teamIds=&season=` | |
| `/api/v1/venues` · `/api/v1/venues/{id}?hydrate=location,fieldInfo` | Mixes active and inactive/historical venues |
| `/api/v1/people/{personId}` | Field set varies by person (§8) |
| `/api/v1/people/search?names=` · `/people/changes?updatedSince=` · `/people/freeAgents?leagueId=&season=` | |
| `/api/v1/people/{id}/awards` · `/people/{id}/stats` · `/people/{id}/stats/game/{gamePk}` | |
| `/api/v1/jobs?jobType=` · `/jobs/umpires?date=` · `/jobs/datacasters` · `/jobs/officialScorers` | All public 200 (r2). Entries: `person`, `jerseyNumber`, `job`, `jobId`, `title`. **`/jobs/umpires/games/{umpireId}` is Okta-gated (401)** — the one Tier-B route outside the analytics family |
| `/api/v1/awards` · `/awards/{awardId}/recipients` | 682 award definitions; recipients verified (`/awards/MLBHOF/recipients`, 105 KB) |
| `/api/v1/people?personIds=` (bulk) · `/api/v1/seasons/{seasonId}?sportId=` · `/api/v1/venues?venueIds=` · `/api/v1/teams/{id}/personnel` · `/api/v1/teams/stats` (collection) | All upgraded to `VERIFIED_OBSERVED` in r2 |
| `/api/v1/league/{leagueId}/allStarBallot` · `/allStarWriteIns` · `/allStarFinalVote` (`?season=`) | Public 200 (r2) — live 2026 ballot data (131/174/17 KB). Upgraded from `SECONDARY_ONLY` |

### 5.2 Competition layer — `VERIFIED_OBSERVED`

| Operation | Notes |
|---|---|
| `/api/v1/schedule` | Requires `sportId` **or** `gamePk` (400 otherwise). Game objects carry 29 fields incl. `doubleHeader`, `gameNumber`, `seriesGameNumber`, `ifNecessary`, `gameGuid` |
| `/api/v1/schedule/postseason?season=` · `/schedule/postseason/series?season=` | 47 items for 2025; series form verified in r2 (66 KB) |
| `/api/v1/schedule/games/tied?season=&sportId=` | 200; 0 items for 2025 |
| `/api/v1/schedule/postseason/tuneIn` | 200 but `totalItems: 0` — corroborates wrapper's "returns no data" |
| `/api/v1/standings?leagueId=103,104&season=` | Rich `teamRecords` (34 fields: elimination/magic numbers, ranks, splits) |
| `/api/v1/transactions?startDate=&endDate=` | 684 KB for a 5-day window; `typeCode` from 41-value vocabulary |
| `/api/v1/draft/{year}` · `/draft/prospects/{year}` · `/draft/{year}/latest` | 1.36 MB for 2026; picks carry `bisPlayerId`, `signingBonus`, `scoutingReport`, `pickValue`; `latest` verified in r2 |
| `/api/v1/uniforms/game?gamePks=` | Verified in r2 |
| `/api/v1/attendance?teamId=&season=` | |
| `/api/v1/gamePace?season=&sportId=` | |

### 5.3 Live-game layer

| Operation | Status | Notes |
|---|---|---|
| `/api/v1.1/game/{gamePk}/feed/live` | `VERIFIED_OBSERVED` | 731 KB final-game snapshot; §11 |
| `/api/v1/game/{gamePk}/feed/live` | `CONTRADICTED` (dead) | 404 |
| `/api/v1.1/game/{gamePk}/feed/live/timestamps` | `VERIFIED_OBSERVED` | Bare array of `YYYYMMDD_HHMMSS` |
| `/api/v1.1/game/{gamePk}/feed/live/diffPatch?startTimecode=&endTimecode=` | `VERIFIED_OBSERVED` | Array of `{diff:[{op,path,value|from}]}` JSON-Patch sets |
| `/api/v1/game/{gamePk}/boxscore` · `/linescore` · `/playByPlay` · `/content` | `VERIFIED_OBSERVED` | content = 602 KB editorial/media bundle |
| `/api/v1/game/{gamePk}/winProbability` | `VERIFIED_OBSERVED` | Bare per-play array: `homeTeamWinProbability`, `awayTeamWinProbability`, `homeTeamWinProbabilityAdded` |
| `/api/v1/game/{gamePk}/contextMetrics` | `VERIFIED_OBSERVED` | Win prob + per-field sac-fly probabilities |
| `/api/v1/game/changes?updatedSince=&sportId=` | `VERIFIED_OBSERVED` | Schedule-shaped changed-game list (26 games for a 30 h window) |
| `/api/v1/game/{gamePk}/feed/color` (+ `/diffPatch` + `/timestamps`) | `CONTRADICTED` (dead) | All three 404 in r2 (color/timestamps empty body; color/diffPatch router-schema JSON) |
| `/api/v1/homeRunDerby/{gamePk}` | `PARTIALLY_VERIFIED` | Bare → 500; with non-derby pks (ASG 823443, 823433) → 404 `messageNumber 2 "Game data couldn't be found"`. Route real; requires the Derby event's own gamePk — discovery path unverified |
| `/api/v1/highLow/types` · `/highLow/{orgType}?sortStat=&season=` | `VERIFIED_OBSERVED` | 43 types; `/highLow/player` query verified in r2 |
| `/api/v1/review`, `/broadcast` | `SECONDARY_ONLY` | Not probed; `/broadcasters` verified (bare array, 131 KB, availability semantics) |

### 5.4 Statistics layer

| Operation | Status | Notes |
|---|---|---|
| `/api/v1/stats?stats=&group=&season=` | `VERIFIED_OBSERVED` | Default `limit=50` **confirmed**; `offset` works (rank sequence continues) |
| `/api/v1/stats/grouped` | `VERIFIED_OBSERVED` | Was secondary-only in supplied report — public |
| `/api/v1/stats/leaders?leaderCategories=` · `/teams/{id}/leaders` | `VERIFIED_OBSERVED` | |
| `/api/v1/stats/search/config` | `VERIFIED_OBSERVED` | 334 KB; 152 parameters; `filterLevels` incl. `pitch`; describes a pitch-level query system |
| `/api/v1/stats/search/{groupByTypes,params,stats}` | `SECONDARY_ONLY` | Not probed |
| `/api/v1/stats/streaks` | `CONTRADICTED` (dead) | 404 even with the package's **full** required set (`streakType`, `streakSpan`, `season`, `sportId`, `limit`) — router-schema 404, definitively dead |
| `/api/v1/teams/stats` (collection), `/teams/{id}/stats` | `VERIFIED_OBSERVED` | Collection form verified in r2 (21 KB); `/teams/stats/leaders` still `SECONDARY_ONLY` |
| `/api/v1/stats/analytics/stolenBaseProbability` | `INACCESSIBLE` | 401 Okta |

### 5.5 Extended analytics (Tier B — all `INACCESSIBLE`, existence `VERIFIED_OBSERVED` via 401)

`/api/v1/game/{gamePk}/guids` · `/api/v1/game/{gamePk}/{guid}/analytics` ·
`/api/v1/batTracking/game/{gamePk}/{playId}` · `/api/v1/props/play/predictions` ·
`/api/v1/game/lastPitch?gamePks=` · **`/api/v1/jobs/umpires/games/{umpireId}`** (r2 — the
only gated route found outside the analytics family). All returned the identical 401 Okta
login page. Related
routes from the OpenAPI-derived client (`contextMetricsAverages` incl. POST, biomechanics,
`skeletalData/chunked|files`, `/analytics/guids`, `/analytics/game`) remain `SECONDARY_ONLY` —
by pattern almost certainly Tier B (`INFERRED`).

### 5.6 Metadata vocabularies — `VERIFIED_OBSERVED`

`gameTypes`, `rosterTypes`, `positions`, `statTypes`, `metrics`, `standingsTypes`,
`eventTypes`, `baseballStats`, `gameStatus`, `situationCodes`, `sortModifiers`, `roofTypes`,
`gamedayTypes`, `transactionTypes`, `awards`, `highLow/types`, `broadcasters`, and the master
`lookup/values/all` (342 KB, 45 named groups — see §7). The wrapper's "known meta types" list
is **confirmed non-exhaustive**: `sortModifiers`, `roofTypes`, `gamedayTypes`,
`transactionTypes`, `lookup/values/all` are absent from it yet publicly served. Remaining
wrapper/OpenAPI vocabularies not individually probed (e.g. `pitchTypes`, `pitchCodes`, `sky`,
`windDirection`, `languages`): `PARTIALLY_VERIFIED` — most appear as groups inside the
verified `lookup/values/all` payload.

## 6. Parameter and request-contract reference

Full table: [appendix/parameters.json](appendix/parameters.json). Directly proven contracts:

- **`fields` (sparse selection)** — verified on `/sports/1/players`, `/teams`, `/venues`.
  Syntax is a flattened path list (`fields=people,id,fullName,currentTeam,id`); it prunes the
  copyright wrapper too. `VERIFIED_OBSERVED`
- **`hydrate` (relation expansion)** — verified: `teams/116?hydrate=venue(location),league`
  expanded nested venue location; `venues/{id}?hydrate=location,fieldInfo` added `location`
  and `fieldInfo` objects; (r2) `schedule?hydrate=probablePitcher,weather` embeds per-game
  weather (`condition`, `temp`); (r2) parameterized person hydration
  `people/{id}?hydrate=stats(group=[hitting],type=[season],season=2026),currentTeam` embeds
  stat splits — note the `[]` syntax requires URL clients to disable bracket globbing. Full
  hydration vocabulary per endpoint: `UNKNOWN` (docs gated). `VERIFIED_OBSERVED`
- **`limit`/`offset`** — `/stats` defaults to 50 splits with no `limit`; `offset=3&limit=3`
  returns ranks 4–6. No `Link` headers; no cursor tokens observed. `VERIFIED_OBSERVED`
- **`updatedSince`** — ISO-8601 accepted on `game/changes`, `people/changes`. `VERIFIED_OBSERVED`
- **`startTimecode`/`endTimecode`** — `YYYYMMDD_HHMMSS` on `diffPatch`. `VERIFIED_OBSERVED`
- **`timecode` (point-in-time replay)** — upgraded to `VERIFIED_OBSERVED` in r2:
  `boxscore?timecode=20260725_171462` returned away hits = 1 vs 7 in the final boxscore, and
  the v1.1 feed at the same timecode returned the mid-game linescore. Any stored timestamp
  from `/timestamps` reconstructs historical game state.
- **`gamePk=current`** on `people/{id}/stats/game/{gamePk}` — wrapper-documented special
  value **rejected** in r2: `400 messageNumber 11 "Invalid Request with value: current"`.
  Tested while no MLB game was live; whether it resolves during a live game for that
  player's team remains `UNKNOWN`. Treat as `CONTRADICTED` outside live windows.
- **Requirement rules** — `/schedule`: `sportId` XOR `gamePk` (either satisfies). `/sports/
  {sportId}/players`: `season` optional. `/stats`: `stats` + `group` accepted together;
  minimum-required combination not exhaustively mapped (`UNKNOWN`). `/teams/{id}/stats`
  worked with `season`+`group`+`stats`. `VERIFIED_OBSERVED` where stated.
- Headers: no auth header needed for Tier A; `Accept: application/json` sent but responses
  are JSON regardless (`UNKNOWN` for content negotiation). No request body on any verified
  route; the only known POST (`contextMetricsAverages`) is `SECONDARY_ONLY` and untested by
  policy.

## 7. Enumeration and metadata catalog

Complete values: [appendix/enumerations.json](appendix/enumerations.json). Highlights, all
`VERIFIED_OBSERVED` on 2026-07-27:

- **gameTypes (12):** S, R, F, D, L, W, **C (Championship)**, N (Nineteenth Century Series),
  P, A, I, E. The supplied report omitted `C` — corrected.
- **gameStatus:** 210 status combinations; 4 `abstractGameState` values (`Preview`, `Live`,
  `Final`, `Other`); 15 `codedGameState` letters (C, D, F, I, M, N, O, P, Q, R, S, T, U, W,
  X); `detailedState` includes granular families like `Cancelled: Air Quality`,
  `Completed Early: Mercy`, suspension and postponement variants.
- **rosterTypes (9):** `40Man`, `fullSeason`, `fullRoster`, `nonRosterInvitees`, `active`,
  `allTime`, `depthChart`, `gameday`, `coach`.
- **positions (37 codes)** incl. runner placeholders `R1/R2/R3`, two-way `TWP`, `P-IF`,
  handedness pitcher variants, `EH`, `BR`, `X`, `B`.
- **statTypes (60)** incl. `projected_Zips*`, `hotColdZones`, `expectedStatistics`,
  `sprayChart`, `atGameStart`, `opponentsFaced`.
- **metrics (22)** with units (`releaseSpinRate`/RPM, `launchSpeed`/MPH, `hangTime`/SEC …)
  — note one degenerate entry `{"name":"","metricId":0}`.
- **standingsTypes (13)**, **eventTypes (74)**, **baseballStats (209)**,
  **situationCodes (602)**, **transactionTypes (41)**, **sortModifiers (11)**,
  **roofTypes (6)**, **gamedayTypes (8)** — gamedayTypes doubles as a per-game data-quality
  ladder (Premium 3D tracking → score-only), which is the right flag for expected data depth
  on minor-league/historical games (`INFERRED`).
- **`lookup/values/all` (45 groups)** — master vocabulary dump including groups with no
  observed standalone endpoint (`Milestone Types`, `Tracking Vendors`, `Video Resolution
  Types`, `Draft Types`, `League Lists`…). Best single source for enum sync.

## 8. Canonical response schemas and schema variability

- **Wrapper envelope** `{copyright, <collection>}` vs **bare arrays** (§4). Two error
  schemas (§14).
- **Person** (36–41 fields): Betts (605141) has `draftYear`, no `nickName`; Ruth (121578) has
  `deathDate/deathCity/deathCountry/deathStateProvince`, `lastPlayedDate`, `nickName`, no
  `draftYear`. Confirms the supplied report: many leaf fields are presence-optional —
  model virtually all non-`id` fields as nullable. `VERIFIED_OBSERVED`
- **Schedule game** (29 fields) incl. `gameGuid`, `doubleHeader` (`N`/`Y`/`S`), `gameNumber`,
  `tiebreaker`, `ifNecessary`, `recordSource`, `gamedayType`.
- **Live feed** top level `{gamePk, link, metaData, gameData, liveData}`; `metaData` carries
  `wait: 10` (server-suggested polling seconds, `INFERRED`), `timeStamp`, `gameEvents`,
  `logicalEvents`. `gameData` includes `absChallenges`, `moundVisits`, `weather`, `review`,
  `probablePitchers`, `officialScorer`, `primaryDatacaster`. `liveData` = `plays`
  (`allPlays/currentPlay/playsByInning/scoringPlays`), `linescore`, `boxscore`, `decisions`,
  `leaders`. Pitch events carry Statcast-style `playId` GUIDs.
- **Standings teamRecord**: 34 fields (magic/elimination numbers at sport/league/division/
  conference scopes, `streak`, `runDifferential`, split `records`).
- **Draft pick**: includes `bisPlayerId`, `pickValue`, `signingBonus`, `scoutingReport`,
  `blurb`, `headshotLink`.
- **Structural hazards confirmed from the supplied report:** root collections mix
  populations (teams root includes "Coastal Carolina Chanticleers", "DSL Brewers Gold");
  venues mix inactive/historical; nested links can be degenerate (`/api/v1/league/null`
  reported — `PARTIALLY_VERIFIED`, not re-observed).

## 9. Entity and identifier relationship model

Identifier graph (all observed in payload cross-links): `sportId → leagueId → divisionId →
teamId → venueId`, `teamId ↔ personId` (roster/currentTeam), `gamePk → {teamId home/away,
venueId, seasonId, gameType}`, `gamePk + atBatIndex → play`, `play + playEvent → playId`
(GUID, the join key toward Statcast/batTracking), `gamePk → gameGuid`, draft pick →
`personId` + `bisPlayerId` (external BIS system), `awardId → personId`. Objects
self-describe with `link` fields (`/api/v1/...`), giving a navigable HATEOAS-ish graph —
but links must be treated as nullable and occasionally malformed. `VERIFIED_OBSERVED` for
the links listed; graph completeness `INFERRED`.

## 10. Schedule and game-identity semantics

- `gamePk` is the canonical game identity across every family probed; `gameGuid` coexists.
  `VERIFIED_OBSERVED`
- `officialDate` vs `gameDate` (UTC instant) both present — use `officialDate` for
  baseball-calendar joins (`INFERRED`, consistent with observed values).
- Doubleheaders: schema fields exist (`doubleHeader: "Y"|"S"|"N"`, `gameNumber`); no
  doubleheader occurred on the sampled date, so DH identity/edge behavior (incl. the
  community-reported second-game highlight bug) is `UNKNOWN`/`SECONDARY_ONLY`.
- Tie games: dedicated route live but empty for 2025 (`VERIFIED_OBSERVED`); postponement/
  resumption states exist in the `gameStatus` vocabulary (`VERIFIED_OBSERVED`) but live
  transitions were not observed (`UNKNOWN`).

## 11. Live-game state and synchronization lifecycle

Observed mechanics (final game; in-progress behavior `INFERRED` from the same primitives):

1. **Discover** changed games: `GET /api/v1/game/changes?updatedSince=<ISO>&sportId=1` →
   schedule-shaped list. `VERIFIED_OBSERVED`
2. **Snapshot**: `GET /api/v1.1/game/{pk}/feed/live` → full state; `metaData.timeStamp` is
   your sync cursor; `metaData.wait=10` suggests a 10 s poll floor. `VERIFIED_OBSERVED`
3. **Advance cheaply**: `timestamps` lists every revision timecode (154 for the sampled
   game); `diffPatch?startTimecode=…` returns ordered JSON-Patch sets (`replace`, `remove`,
   `add` observed) to apply to the local snapshot. Multiple patch sets arrive in one
   response, one per intermediate revision. `VERIFIED_OBSERVED`
4. **Fallback rule** (community-standard, `SECONDARY_ONLY`): if a patch fails to apply,
   re-fetch the full feed.
5. **Post-final**: re-pull feed/boxscore and downstream stats after `Final`; corrections are
   real (official scorer changes) but latency/frequency is `UNKNOWN` — this run could not
   observe a correction window.

## 12. Statistics, Statcast, analytics, and prediction surfaces

Five observed layers: (1) vocabularies (`statTypes`, `baseballStats`, `metrics`,
`situationCodes`); (2) descriptive stats (`/stats`, `/stats/grouped`, per-person/team stats
with `splits[]` of `{season, team, player, league, sport, stat, gameType}`); (3) leaderboards
(`/stats/leaders`, `/teams/{id}/leaders`; `/stats/streaks` is dead); (4) a **pitch-level
search system** evidenced by `/stats/search/config` — 152 filter parameters spanning game →
pitch `filterLevels`, aggregations, and group-bys (query endpoints themselves
`SECONDARY_ONLY`); (5) Tier-B analytics (bat tracking, per-play GUID analytics, predictions,
SB probability) — existence proven by 401s, schemas `INACCESSIBLE`. Baseball Savant remains
the public Statcast fallback (`SECONDARY_ONLY` here). ZiPS projections surface directly in
`statTypes` (`projected_Zips*`) — provenance/licensing of those numbers `UNKNOWN`.

## 13. Historical coverage and temporal semantic changes

- Seasons list reaches 1876; person records exist for pre-integration and Negro Leagues era
  players; venues carry early-1900s season tags; `gameTypes` includes Nineteenth Century
  Series; historical rosters resolvable per season (`?season=2000`). `VERIFIED_OBSERVED`
- Uniform depth across eras is **not** implied: `gamedayTypes` explicitly grades games from
  premium 3D tracking down to score-only. Expect era- and level-dependent completeness.
  `INFERRED`
- Semantic drift is real: Savant documents that from 2026 `sz_top`/`sz_bot` reflect the ABS
  strike zone (`SECONDARY_ONLY`); corroborated in-band by `gameData.absChallenges` in the
  2026 live feed (`VERIFIED_OBSERVED`). Same field name ≠ same historical meaning.

## 14. Authentication, rate limits, reliability, errors, operational behavior

- **Auth:** Tier A none; Tier B Okta (401 HTML `Please Login`, `text/html`, 12,583 B —
  detect gated routes by `content-type: text/html` + 401). `VERIFIED_OBSERVED`
- **Error schema 1 (application):** `{"messageNumber": int, "message": str, "timestamp":
  ISO-8601, "traceId": null|""}` — observed: 400/#7 missing required param, 400/#11
  `Invalid Request with value: <x>` (bad type *and* rejected `gamePk=current`), 404/#10
  `Object not found` (person 0), 404/#2 `Game data couldn't be found` (Derby with non-derby
  pk, r2), 500/#1 `Internal error occurred` (bare `/homeRunDerby`). `VERIFIED_OBSERVED`
- **Error schema 2 (router):** `{"error":"Not Found","path":…,"status":404,"timestamp":…}` —
  unrouted paths (`/api/v2/sports`, v1 feed/live, `stats/streaks`). A 404 body of this shape
  means *route doesn't exist*; schema-1 404 means *object doesn't exist*. `VERIFIED_OBSERVED`
- **Rate limits:** no limit headers, no 429 observed at ~80 requests / 4 min. Numeric quotas
  `UNKNOWN`; ToS reserves MLB's right to impose limits (`VERIFIED_OFFICIAL`). Design for
  polite polling + CDN-friendly caching, not for a published quota.
- **Caching:** `max-age=900, stale-while-revalidate=30, stale-if-error=86400`; shared-cache
  hits observed. Live-feed cache TTLs likely differ — `UNKNOWN` (not sampled in-game).
- **Reliability posture:** dead routes 404 rather than redirect; one 500 on an
  under-parameterized route; no deprecation headers anywhere. `VERIFIED_OBSERVED`

## 15. Legal, licensing, commercial-use, and redistribution constraints

Every wrapped response embeds: *"Use of any content on this page acknowledges agreement to
the terms posted here http://gdx.mlb.com/components/copyright.txt"* (`VERIFIED_OBSERVED`).
Per the supplied report's reading of that notice and MLB ToS (`PARTIALLY_VERIFIED`, not
re-fetched): materials are proprietary; only individual, non-commercial, non-bulk use is
permitted absent written MLB authorization; MLB may limit or discontinue features at will.
**Public reachability is not a license.** For this repo specifically: a sports-betting
product is unambiguously commercial use — production ingestion of statsapi data for the
betting product would require a licensing conversation with MLB (or a licensed intermediary
such as an authorized data distributor). Redistribution, bulk mirroring, and paid features
built directly on this feed are the highest-risk uses. This is a legal-posture summary, not
legal advice.

## 16. Production use-case matrix

| Use case | Families | Cadence | Key risks | Controls |
|---|---|---|---|---|
| Reference/ID mapping | sports, teams, venues, people, vocabularies, `lookup/values/all` | Daily | Mixed-population roots; optional fields | Filter by `sportId`; nullable-first schemas; enum-sync job |
| Schedule ingestion | schedule (+postseason) | Hourly + gameday | DH/postponement edge cases untested | Key on `gamePk`; re-pull on `game/changes` |
| Live scoreboard/game center | v1.1 feed, diffPatch, linescore, winProbability | ~10 s (per `metaData.wait`) | Patch-apply failures; unknown quotas | Patch-then-fallback-to-snapshot; jittered polling |
| Historical warehouse | seasons/all, stats, draft, transactions, alumni | Batch | Era-dependent depth (`gamedayTypes`); semantic drift (ABS zones) | Version fields by season; store `recordSource` |
| Modeling / betting features | stats, winProbability, playByPlay `playId`s, Savant CSVs | Daily + live | **Legal: commercial use unlicensed**; Tier-B analytics inaccessible | Licensing before production; feature lineage per season |
| Injury/roster/transaction workflows | transactions, rosters, people/changes | 15–60 min | `typeCode` coverage; correction lag | Idempotent upserts keyed on transaction `id` |
| Editorial/media | game content, broadcasters, awards | Per game | Schema only partially mapped | Treat as best-effort enrichment |
| Redistribution / bulk mirroring | — | — | Prohibited absent authorization | Do not build without a license |

## 17. Recommended ingestion and reconciliation architecture (engineering inference)

Four planes, matching §11–§12 observations: **(1) Dimensions** — nightly sync of vocabularies
(prefer `lookup/values/all` + per-endpoint confirmations) and reference entities, filtered by
`sportId`, nullable-first. **(2) Discovery** — schedule pulls keyed on `gamePk`;
`game/changes`/`people/changes` as the delta signal. **(3) Live plane** — snapshot via v1.1
feed, advance via diffPatch at ≥`metaData.wait` seconds, fall back to snapshot on patch
failure; persist raw revisions (timestamps give you replay for free). **(4) Reconciliation**
— on `Final`, re-pull feed + boxscore; re-pull again after a correction window (length
`UNKNOWN` — instrument it empirically: diff stored finals daily for N days and measure);
propagate to season aggregates. Cross-check derived aggregates against `/stats` rather than
trusting either side alone. All of this is `INFERRED` architecture on `VERIFIED_OBSERVED`
primitives — MLB publishes no sync contract or SLA.

## 18. Contradiction register

| # | Contradiction (from supplied report §4 charge list) | Resolution | Status |
|---|---|---|---|
| 1 | `season` required on `/sports/{id}/players`? | **No.** 200 without it (current season); `season=2000` works | `CONTRADICTED` (wrapper doc wrong) — resolved |
| 2 | Schedule params jointly required? | **Either/or.** API error: "Missing required parameter sportId or gamePk" | Resolved, `VERIFIED_OBSERVED` |
| 3 | v1.1 legacy or current? `/api/v2`? | v1.1 is the **only** live-feed version; v1 feed 404; v2 404 | Resolved, `VERIFIED_OBSERVED` |
| 4 | Extended analytics public/auth/dead? | Real, current, **Okta 401-gated** | Resolved (access model); schemas `INACCESSIBLE` |
| 5 | `/league` vs `/leagues` | Byte-identical aliases | Resolved, `VERIFIED_OBSERVED` |
| 6 | Root collections mixed-population | Confirmed (college/DSL teams; inactive venues; 20 sports) | Confirmed, `VERIFIED_OBSERVED` |
| 7 | Nullable/variable nested objects | Confirmed (Ruth vs Betts field sets; report's `league/null` not re-observed) | Confirmed / `PARTIALLY_VERIFIED` |
| 8 | Numeric rate limits | No headers, no 429 at this volume; no public number | `UNRESOLVED` / `UNKNOWN` |
| 9 | Post-final corrections; `sz_top/sz_bot` drift | ABS corroborated via `absChallenges`; correction latency untestable in one session | `UNRESOLVED` (latency); drift `SECONDARY_ONLY`+corroborated |
| 10 | Doubleheader/suspended/resumption edge cases | Schema fields + status vocabulary verified; live behavior unobserved | `UNRESOLVED` / `UNKNOWN` |
| 11 | *(new)* `stats/streaks` documented by wrapper | 404 router-schema **even with the package's full required set incl. `streakSpan`** (r2) — definitively dead | `CONTRADICTED` |
| 12 | *(new)* Supplied report's gameTypes list | Missing `C` (Championship); actual set has 12 values | Corrected, `VERIFIED_OBSERVED` |
| 13 | *(new)* tuneIn "returns no data" | 200 with `totalItems: 0` for 2025 | Corroborated, `VERIFIED_OBSERVED` |
| 14 | *(new, r2)* Wiki "required params" tables read as joint requirements | Package source encodes them as **alternative sets** (`[['sportId'],['gamePk'],['gamePks']]`), matching observed server behavior — the wiki flattening caused the report's confusion | Resolved, `VERIFIED_OBSERVED` + package source |
| 15 | *(new, r2)* Wrapper claims `season` required on `sports_players` and supports `gamePk=current` | Server accepts no-`season` (wiki/package stricter than API); server rejects `current` with 400/#11 outside live windows | `CONTRADICTED` (client-side rules ≠ server contract) |
| 16 | *(new, r2)* Wrapper catalogs `jobs/umpires/games/{umpireId}` as a normal public route | 401 Okta-gated | `CONTRADICTED` (access model) |

## 19. Unverified and inaccessible surface register

Serialized in [appendix/unresolved.json](appendix/unresolved.json). Summary — **INACCESSIBLE:**
official docs portal; Tier-B response schemas (guids, per-play analytics, batTracking,
predictions, SB probability, lastPitch, umpire game logs; plus by inference biomechanics/
skeletal/contextMetricsAverages). **SECONDARY_ONLY (still never probed):** `allSportBallot`,
`/schedule/trackingEvents` and `/schedule/{scheduleType}`, `/review`, `/broadcast`,
`/teams/stats/leaders`, `stats/search/{params,stats,groupByTypes}` (config is public; query
routes untested), homeRunDerby subresource forms (`/bracket`, `/pool`), `people/{id}/stats/
metrics`, remaining standalone vocabulary endpoints, POST `contextMetricsAverages`.
**UNKNOWN:** numeric quotas; correction latency; in-progress feed cache behavior;
DH/suspension edge cases; the Derby event's gamePk discovery path; `gamePk=current` behavior
during a live game; hydration vocabulary per endpoint; content negotiation; non-MLB sport
feed depth; Tier-B credential eligibility; existence of a sandbox.

## 20. Source register

| Source | Authority | Used for |
|---|---|---|
| Direct GETs to `statsapi.mlb.com` (~80 requests, 2026-07-27 06:07–06:11 UTC, logged in [appendix/observations.json](appendix/observations.json)) | Official host, direct observation | All `VERIFIED_OBSERVED` claims |
| Embedded copyright string → `gdx.mlb.com/components/copyright.txt` | Official | Legal posture (notice text itself `PARTIALLY_VERIFIED` via supplied report) |
| `deep-research-report.md` (supplied) | Mixed; its official-response claims treated as `PARTIALLY_VERIFIED`, its secondary claims as `SECONDARY_ONLY` | Route discovery, docs-portal state, ToS reading, Savant semantics, community issues |
| toddrob99/MLB-StatsAPI wiki lineage (via supplied report) | Secondary | Parameter taxonomies; contradicted on streaks + season requirement |
| **MLB-StatsAPI 1.9.0 package source** (`mlb_statsapi-1.9.0.tar.gz`, local; `statsapi/endpoints.py`, 64 endpoints) | Secondary (source code — stronger than wiki; test suite fully mocked, no live coverage) | r2 test matrix; alternative-set required params; v1.1 defaults; contradicted on streaks, `season`, `current`, umpire-games access |
| OpenAPI-derived client README (via supplied report) | Secondary | Extended analytics route names (now partially confirmed via 401s), v1.1 paths |

## 21. Coverage and completeness ledger

Claim-level reconciliation of the supplied report — every substantive claim falls into one of
these dispositions (full endpoint-level detail in [appendix/endpoints.json](appendix/endpoints.json)):

| Supplied-report claim class | Count (approx.) | Disposition |
|---|---|---|
| "Verified/high" official observations (sports, people, teams, venues, 9 enum feeds, legal notice, docs gating) | 15 | **Upheld** — all independently re-verified except `/sports/1` single-fetch and the raw copyright/ToS text (`PARTIALLY_VERIFIED`) |
| "Partially verified" families (schedule, standings, transactions, draft, rosters, team stats, jobs, live-game family, stats layer) | ~40 routes | **Upgraded to `VERIFIED_OBSERVED`** for 30+ routes; remainder listed in §19 |
| "Secondary-only" extended analytics | ~12 routes | **Split:** 6 confirmed-existing-but-gated (401), 2 confirmed public (`stats/grouped`, `search/config`), rest still `SECONDARY_ONLY` |
| *(r2)* Package catalog full sweep | 64 endpoints | 57× 200; 4× dead/contract-404 (color ×3, streaks); 1× gated (umpire games); 2× param-contract findings (`current` rejected; Derby needs event pk) |
| Contradictions flagged | 10 | 7 resolved, 3 `UNRESOLVED` (§18) |
| Architecture recommendations | 5 | Upheld as `INFERRED`, now grounded on observed primitives (diffPatch format, `wait`, changes feeds) |
| Legal claims | 3 | Upheld (`VERIFIED_OBSERVED` for embedded notice; `PARTIALLY_VERIFIED` for notice/ToS full text) |
| Errors in supplied report | 2 | gameTypes missing `C`; v1.1 mischaracterized as "legacy-looking" |

## 22. Final verdict and next required evidence

**Verdict: `INCOMPLETE`.**

Within the defined scope — *the publicly reachable, unauthenticated surface of
`statsapi.mlb.com` as observable on 2026-07-27* — coverage is now near-exhaustive: every
claim in the supplied report is reconciled, the complete MLB-StatsAPI 1.9.0 catalog (64
endpoints) was driven live (57× 200), ~85 distinct operations are directly verified, 7 of
10 inherited contradictions plus 6 new ones are resolved, and the access-tier model is
established. But the overall
ecosystem verdict must remain INCOMPLETE because: (1) the authoritative documentation and
OpenAPI spec sit behind Okta and were not accessed; (2) Tier-B analytics schemas are
inaccessible without credentials; (3) live in-progress behavior, doubleheader/suspension
edge cases, and post-final correction latency were untestable in a single session; (4) no
numeric rate/usage policy is publicly stated. Next evidence, in order of value: legitimate
docs-portal credentials; a multi-day observation harness (live games incl. a doubleheader,
plus daily diffs of stored finals to measure correction latency); an MLB licensing
conversation before any commercial use; and periodic re-probe of the 401-gated and
`SECONDARY_ONLY` route sets.
