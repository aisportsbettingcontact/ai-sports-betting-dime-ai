#!/usr/bin/env python3
"""A2 - verify the franchise dimension of nfl.db against ESPN and NFL.com.

The whole schema is keyed on ESPN franchise ids. A wrong id produces joins that
look perfectly healthy (right row counts, right-looking output) but attribute
games to the wrong team. This script is the independent check on that key.

What it verifies
----------------
  C1  team row set              - exactly the 32 ids ESPN publishes, every season
  C2  name / abbreviation       - DB vs ESPN (current + every season) vs NFL.com
  C3  franchise id stability    - id unchanged across all four 2010-2026 moves
  C4  conference / division     - DB vs ESPN season groups vs NFL.com team pages
  C5  team_alias                - every alias maps to the right franchise, and
                                  every era label used by `game` is covered
  C6  era plausibility          - STL<=2015, LA/LAR>=2016, SD<=2016, LAC>=2017,
                                  OAK<=2019, LV>=2020, verified against the
                                  season ESPN says each move took effect
  C7  game.abbr <-> franchise   - the exact bug class that put Buffalo at id 17
  C8  games per franchise/season- 16 (2010-2020) / 17 (2021+), plus playoffs,
                                  every deviation individually explained and
                                  independently confirmed against ESPN
  C9  game franchise ids        - vs ESPN's own home/away assignment per event
  C10 legacy ESPN event ids     - pre-2014 ids encode the home franchise id, so
                                  2010-2013 gets a free ESPN-authored crosscheck
  C11 division column           - 8x4 shape, nflverse div_game flag agreement,
                                  and exactly 6 divisional games per team-season

Read-only on nfl.db.  Every HTTP response is cached under cache/a2/ and is the
evidence for the claims in the report; a second run does zero network I/O.

Exit status: 0 = every check passed, 1 = at least one mismatch, 2 = harness error.

Usage
-----
  python3 scripts/data/nfl-db/verify/a2_franchise.py
  python3 scripts/data/nfl-db/verify/a2_franchise.py --offline      # cache only
  python3 scripts/data/nfl-db/verify/a2_franchise.py --seasons 2015,2016
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB_DIR = os.path.dirname(HERE)
DB_PATH = os.path.join(NFLDB_DIR, "nfl.db")
CACHE_DIR = os.path.join(NFLDB_DIR, "cache", "a2")

ALL_SEASONS = list(range(2010, 2027))

# Ten agents share the network. One request in flight, deliberate sleep.
RATE_SLEEP = 0.30
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
NFL_TEAMS_URL = "https://www.nfl.com/teams/"

# Seasons on which `game`'s franchise ids are checked against ESPN's own home/away
# assignment, chosen so every era label in the DB is exercised at least once.
C9_SEASONS = [2015, 2017, 2020, 2022, 2026]

# Relocations / rebrands inside the 2010-2026 window. `effective` is the first
# season played under the new identity; the id must be identical either side.
IDENTITY_CHANGES = [
    dict(fid=14, effective=2016, before="St. Louis Rams", after="Los Angeles Rams",
         label="Rams relocate St. Louis -> Los Angeles"),
    dict(fid=24, effective=2017, before="San Diego Chargers", after="Los Angeles Chargers",
         label="Chargers relocate San Diego -> Los Angeles"),
    dict(fid=13, effective=2020, before="Oakland Raiders", after="Las Vegas Raiders",
         label="Raiders relocate Oakland -> Las Vegas"),
    dict(fid=28, effective=2020, before="Washington Redskins", after="Washington Football Team",
         label="Washington rebrand Redskins -> Football Team"),
    dict(fid=28, effective=2022, before="Washington Football Team", after="Washington Commanders",
         label="Washington rebrand Football Team -> Commanders"),
]

# Era windows for the labels `game` actually publishes, keyed by (abbr, fid).
# These are asserted against `game`, and the boundary seasons are cross-checked
# against ESPN's own record of when each move took effect (C6).
ERA_WINDOWS = {
    "STL": (14, None, 2015),
    "LA":  (14, 2016, None),
    "LAR": (14, 2016, None),
    "SD":  (24, None, 2016),
    "LAC": (24, 2017, None),
    "OAK": (13, None, 2019),
    "LV":  (13, 2020, None),
}

_last_fetch = [0.0]


# --------------------------------------------------------------------------- #
# cached HTTP
# --------------------------------------------------------------------------- #
def _cache_path(url: str, suffix: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", url.split("://", 1)[-1])[:110].strip("_")
    digest = hashlib.sha1(url.encode()).hexdigest()[:10]
    return os.path.join(CACHE_DIR, f"{slug}.{digest}{suffix}")


def fetch(url: str, *, suffix: str = ".json", offline: bool = False) -> str | None:
    """GET `url`, disk-cached. Returns body text, or None if it could not be had."""
    url = url.replace("http://sports.core.api.espn.com", "https://sports.core.api.espn.com")
    path = _cache_path(url, suffix)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    if offline:
        return None

    wait = RATE_SLEEP - (time.time() - _last_fetch[0])
    if wait > 0:
        time.sleep(wait)

    body = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 400):
                break                       # a real "does not exist"
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    _last_fetch[0] = time.time()

    if body is not None:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
    return body


def fetch_json(url: str, *, offline: bool = False):
    body = fetch(url, suffix=".json", offline=offline)
    if body is None:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


# --------------------------------------------------------------------------- #
# ESPN
# --------------------------------------------------------------------------- #
def espn_group_chain(ref: str, offline: bool) -> tuple[str | None, str | None]:
    """Resolve a team's group $ref to (conference, division)."""
    division = conference = None
    seen = set()
    while ref and ref not in seen:
        seen.add(ref)
        node = fetch_json(ref, offline=offline)
        if not node:
            break
        name = node.get("name")
        if node.get("isConference"):
            conference = name
        elif division is None:
            division = name
        parent = node.get("parent") or {}
        ref = parent.get("$ref")
    return conference, division


def espn_season_teams(year: int, offline: bool) -> dict[int, dict]:
    """{franchise_id: {...}} straight from ESPN's own team resource for `year`."""
    index = fetch_json(f"{ESPN_CORE}/seasons/{year}/teams?limit=40", offline=offline)
    if not index:
        return {}
    out: dict[int, dict] = {}
    for item in index.get("items", []):
        node = fetch_json(item["$ref"], offline=offline)
        if not node:
            continue
        fid = int(node["id"])
        conf, div = espn_group_chain((node.get("groups") or {}).get("$ref", ""), offline)
        out[fid] = dict(
            franchise_id=fid,
            display_name=node.get("displayName"),
            abbreviation=node.get("abbreviation"),
            location=node.get("location"),
            name=node.get("name"),
            slug=node.get("slug"),
            guid=node.get("guid"),
            uid=node.get("uid"),
            is_active=node.get("isActive"),
            conference=conf,
            division=div,
            venue=(node.get("venue") or {}).get("fullName"),
        )
    return out


def espn_team_schedule(fid: int, year: int, offline: bool) -> dict | None:
    """Parse ESPN's per-team regular-season schedule.

    ESPN keeps abandoned fixtures on the schedule with STATUS_CANCELED, so the
    number of events listed and the number of games actually played differ.  The
    DB stores games played, so `played` is the number to compare against.

    `sides` carries ESPN's own home/away franchise ids per event, which is what
    lets us prove `game`'s franchise ids point at the teams ESPN says played.
    """
    doc = fetch_json(f"{ESPN_SITE}/teams/{fid}/schedule?season={year}&seasontype=2",
                     offline=offline)
    if not doc:
        return None
    listed = played = 0
    canceled = []
    sides: dict[str, dict] = {}
    for ev in doc.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        status = ((comp.get("status") or {}).get("type") or {})
        name = status.get("name") or ""
        listed += 1
        if status.get("completed"):
            played += 1
        elif "CANCEL" in name.upper() or "POSTPON" in name.upper():
            canceled.append(dict(event_id=ev.get("id"), date=(ev.get("date") or "")[:10],
                                 status=name,
                                 teams=[c.get("team", {}).get("abbreviation")
                                        for c in comp.get("competitors", [])]))
        rec = dict(event_id=str(ev.get("id")), date=(ev.get("date") or "")[:10],
                   status=name, home=None, away=None,
                   home_abbr=None, away_abbr=None,
                   neutral=bool(comp.get("neutralSite")))
        for c in comp.get("competitors", []):
            ha = c.get("homeAway")
            tid = (c.get("team") or {}).get("id")
            if ha in ("home", "away") and tid is not None:
                rec[ha] = int(tid)
                rec[f"{ha}_abbr"] = (c.get("team") or {}).get("abbreviation")
        if rec["home"] is not None and rec["away"] is not None:
            sides[rec["event_id"]] = rec
    return dict(listed=listed, played=played, canceled=canceled, sides=sides,
                requested_season=year, franchise_id=fid)


def espn_team_schedule_counts(fid: int, year: int, offline: bool) -> dict | None:
    return espn_team_schedule(fid, year, offline)


# --------------------------------------------------------------------------- #
# NFL.com
# --------------------------------------------------------------------------- #
def nfl_com_teams(offline: bool) -> dict[str, dict]:
    """{display_name: {slug, conference, division}} scraped from nfl.com."""
    html = fetch(NFL_TEAMS_URL, suffix=".html", offline=offline)
    if not html:
        return {}

    # Every team card carries an analytics tag naming its conference section:
    # NFC cards use `teams-page-nfc-teams`, AFC cards `afc-east-teams-teams-page`
    # (nfl.com applies that one tag to the whole AFC block, so it is a reliable
    # conference signal but NOT a division signal - divisions come from the
    # individual team pages below).
    out: dict[str, dict] = {}
    pat = re.compile(
        r'data-link_type="([^"]*teams[^"]*)"[^>]*?'
        r'data-link_url="/teams/([a-z0-9-]+)/?"[^>]*?'
        r'title="View ([^"]+) Profile"', re.I)
    for link_type, slug, name in pat.findall(html):
        if name in out:
            continue
        lt = link_type.lower()
        conf = "AFC" if "afc" in lt else "NFC" if "nfc" in lt else None
        out[name] = dict(slug=slug, conference=conf, division=None, abbreviation=None)

    for name, rec in out.items():
        page = fetch(f"https://www.nfl.com/teams/{rec['slug']}/",
                     suffix=".html", offline=offline)
        if not page:
            continue
        hits = {f"{a} {b}" for a, b in
                re.findall(r"(AFC|NFC)[\s\-]?(North|South|East|West)", page)}
        if len(hits) == 1:
            rec["division"] = hits.pop()
        elif hits:
            rec["division"] = "AMBIGUOUS:" + ",".join(sorted(hits))
        # NFL's own club code, published in the ad-targeting call and the logo path
        codes = set(re.findall(r"setTargeting\(\s*'team'\s*,\s*'([A-Z]{2,3})'\s*\)", page))
        codes |= set(re.findall(r"league/api/clubs/logos/([A-Z]{2,3})\b", page))
        if len(codes) == 1:
            rec["abbreviation"] = codes.pop()
        elif codes:
            rec["abbreviation"] = "AMBIGUOUS:" + ",".join(sorted(codes))
    return out


# --------------------------------------------------------------------------- #
# DB (read-only)
# --------------------------------------------------------------------------- #
def open_db() -> sqlite3.Connection:
    if not os.path.exists(DB_PATH):
        print(f"FATAL: {DB_PATH} not found", file=sys.stderr)
        sys.exit(2)
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def db_teams(con) -> dict[int, dict]:
    return {r["franchise_id"]: dict(r)
            for r in con.execute("SELECT * FROM team ORDER BY franchise_id")}


def db_aliases(con) -> list[dict]:
    return [dict(r) for r in con.execute(
        "SELECT abbreviation, franchise_id, is_current, note FROM team_alias "
        "ORDER BY franchise_id, abbreviation")]


# --------------------------------------------------------------------------- #
# checks
# --------------------------------------------------------------------------- #
class Report:
    def __init__(self):
        self.failures: list[dict] = []
        self.notes: list[dict] = []
        self.data: dict = {}

    def fail(self, check: str, ident: str, detail: str, evidence: str = ""):
        self.failures.append(dict(check=check, id=ident, detail=detail, evidence=evidence))

    def note(self, check: str, ident: str, detail: str):
        self.notes.append(dict(check=check, id=ident, detail=detail))


def run(seasons: list[int], offline: bool, strict: bool = False) -> Report:
    rep = Report()
    con = open_db()
    dbt = db_teams(con)
    aliases = db_aliases(con)
    alias_map = {a["abbreviation"]: a["franchise_id"] for a in aliases}

    # ---- gather ESPN --------------------------------------------------------
    espn: dict[int, dict[int, dict]] = {}
    for year in seasons:
        got = espn_season_teams(year, offline)
        if not got:
            rep.fail("C0", f"espn/{year}", "ESPN season team list unavailable",
                     f"{ESPN_CORE}/seasons/{year}/teams?limit=40")
            continue
        espn[year] = got
    rep.data["espn"] = espn
    if not espn:
        rep.fail("C0", "espn", "no ESPN data at all - cannot verify", "")
        return rep

    latest = max(espn)
    nflcom = nfl_com_teams(offline)
    rep.data["nflcom"] = nflcom
    if len(nflcom) != 32:
        rep.fail("C5b", "nfl.com", f"expected 32 teams on nfl.com/teams/, parsed {len(nflcom)}",
                 NFL_TEAMS_URL)

    # ---- C1: row set --------------------------------------------------------
    for year, teams in sorted(espn.items()):
        missing = set(teams) - set(dbt)
        extra = set(dbt) - set(teams)
        if missing:
            rep.fail("C1", f"season {year}",
                     f"ESPN publishes franchise id(s) absent from team: {sorted(missing)}",
                     f"{ESPN_CORE}/seasons/{year}/teams?limit=40")
        if extra:
            rep.fail("C1", f"season {year}",
                     f"team has franchise id(s) ESPN does not publish: {sorted(extra)}",
                     f"{ESPN_CORE}/seasons/{year}/teams?limit=40")
        if len(teams) != 32:
            rep.fail("C1", f"season {year}", f"ESPN returned {len(teams)} teams, expected 32", "")

    # ---- C2: names + abbreviations -----------------------------------------
    for fid, row in sorted(dbt.items()):
        cur = espn.get(latest, {}).get(fid)
        if not cur:
            rep.fail("C2", f"fid {fid}", f"no ESPN record in latest season {latest}", "")
            continue
        if row["display_name"] != cur["display_name"]:
            rep.fail("C2", f"fid {fid}",
                     f"display_name DB={row['display_name']!r} ESPN({latest})={cur['display_name']!r}",
                     f"{ESPN_CORE}/seasons/{latest}/teams/{fid}")
        if row["abbreviation"] != cur["abbreviation"]:
            rep.fail("C2", f"fid {fid}",
                     f"abbreviation DB={row['abbreviation']!r} ESPN({latest})={cur['abbreviation']!r}",
                     f"{ESPN_CORE}/seasons/{latest}/teams/{fid}")
        nfl = nflcom.get(row["display_name"])
        if nflcom and nfl is None:
            rep.fail("C5b", f"fid {fid}",
                     f"DB display_name {row['display_name']!r} not present on nfl.com/teams/",
                     NFL_TEAMS_URL)

    # per-season identity history, and whether ESPN is era-correct
    history: dict[int, list[tuple[int, str, str]]] = defaultdict(list)
    for year in sorted(espn):
        for fid, t in espn[year].items():
            history[fid].append((year, t["display_name"], t["abbreviation"]))
    rep.data["history"] = history

    era_correct = any(
        len({dn for _, dn, _ in history.get(fid, [])}) > 1 for fid in (13, 14, 24, 28)
    )
    rep.data["espn_era_correct"] = era_correct

    # ---- C3: franchise id stability across every move -----------------------
    stability = []
    for chg in IDENTITY_CHANGES:
        fid, eff = chg["fid"], chg["effective"]
        prev_yr, next_yr = eff - 1, eff
        rec = dict(chg)
        rec["id_before"] = fid if fid in espn.get(prev_yr, {}) else None
        rec["id_after"] = fid if fid in espn.get(next_yr, {}) else None
        rec["espn_name_before"] = (espn.get(prev_yr, {}).get(fid) or {}).get("display_name")
        rec["espn_name_after"] = (espn.get(next_yr, {}).get(fid) or {}).get("display_name")
        rec["guid_before"] = (espn.get(prev_yr, {}).get(fid) or {}).get("guid")
        rec["guid_after"] = (espn.get(next_yr, {}).get(fid) or {}).get("guid")
        stability.append(rec)

        if prev_yr in espn and rec["id_before"] is None:
            rep.fail("C3", chg["label"],
                     f"franchise id {fid} absent from ESPN season {prev_yr} - id is NOT stable",
                     f"{ESPN_CORE}/seasons/{prev_yr}/teams?limit=40")
        if next_yr in espn and rec["id_after"] is None:
            rep.fail("C3", chg["label"],
                     f"franchise id {fid} absent from ESPN season {next_yr} - id is NOT stable",
                     f"{ESPN_CORE}/seasons/{next_yr}/teams?limit=40")
        if rec["guid_before"] and rec["guid_after"] and rec["guid_before"] != rec["guid_after"]:
            rep.fail("C3", chg["label"],
                     f"ESPN guid changed across the move: {rec['guid_before']} -> {rec['guid_after']}",
                     f"{ESPN_CORE}/seasons/{next_yr}/teams/{fid}")
    rep.data["stability"] = stability

    # Independent of the moves: across the whole window each franchise id must
    # keep one and only one ESPN guid. A reused or re-pointed id would show here.
    guids = defaultdict(set)
    for year in espn:
        for fid, t in espn[year].items():
            if t.get("guid"):
                guids[fid].add(t["guid"])
    rep.data["guids"] = {f: sorted(g) for f, g in sorted(guids.items())}
    for fid, g in sorted(guids.items()):
        if len(g) > 1:
            rep.fail("C3", f"fid {fid}",
                     f"ESPN franchise id maps to {len(g)} different guids across "
                     f"2010-2026: {sorted(g)} - the id is NOT a stable franchise key", "")
    inverted = defaultdict(set)
    for fid, g in guids.items():
        for one in g:
            inverted[one].add(fid)
    for guid, fids in inverted.items():
        if len(fids) > 1:
            rep.fail("C3", guid,
                     f"one ESPN franchise guid is served under multiple ids {sorted(fids)}", "")

    # ---- C4: conference / division -----------------------------------------
    def norm_conf(v):
        if not v:
            return None
        v = v.strip()
        if "American" in v:
            return "AFC"
        if "National" in v:
            return "NFC"
        return v

    def norm_div(v):
        if not v:
            return None
        v = v.strip()
        return v if v.startswith(("AFC", "NFC")) else v

    for year in sorted(espn):
        for fid, t in espn[year].items():
            row = dbt.get(fid)
            if not row:
                continue
            c, d = norm_conf(t["conference"]), norm_div(t["division"])
            if c and c != row["conference"]:
                rep.fail("C4", f"fid {fid} season {year}",
                         f"conference DB={row['conference']} ESPN={c}",
                         f"{ESPN_CORE}/seasons/{year}/teams/{fid} -> groups")
            if d and d != row["division"]:
                rep.fail("C4", f"fid {fid} season {year}",
                         f"division DB={row['division']} ESPN={d}",
                         f"{ESPN_CORE}/seasons/{year}/teams/{fid} -> groups")

    for fid, row in sorted(dbt.items()):
        nfl = nflcom.get(row["display_name"])
        if not nfl:
            continue
        if nfl["conference"] != row["conference"]:
            rep.fail("C5b", f"fid {fid}",
                     f"conference DB={row['conference']} NFL.com={nfl['conference']}",
                     NFL_TEAMS_URL)
        if nfl["division"] and nfl["division"] != row["division"]:
            rep.fail("C5b", f"fid {fid}",
                     f"division DB={row['division']} NFL.com={nfl['division']}",
                     f"https://www.nfl.com/teams/{nfl['slug']}/")
        # Standing rule 4: record the contradiction, do not resolve it. A club
        # code NFL uses must still be resolvable through team_alias, but the two
        # publishers are allowed to differ on which code is canonical.
        nfl_ab = nfl.get("abbreviation")
        espn_ab = (espn.get(latest, {}).get(fid) or {}).get("abbreviation")
        if nfl_ab and espn_ab and nfl_ab != espn_ab:
            rep.note("C5b", f"fid {fid}",
                     f"{row['display_name']}: NFL.com club code {nfl_ab!r} vs "
                     f"ESPN abbreviation {espn_ab!r} (DB stores {row['abbreviation']!r})")
        if nfl_ab and not nfl_ab.startswith("AMBIGUOUS"):
            if nfl_ab not in alias_map:
                # Not a mismatch: nothing in the DB is wrong about this franchise.
                # It is a coverage gap against a publisher the build does not
                # currently ingest. Itemised, and promotable to a failure with
                # --strict for anyone who does start ingesting NFL.com.
                rep.data.setdefault("unresolvable_labels", []).append(
                    dict(label=nfl_ab, source="nfl.com", franchise_id=fid,
                         team=row["display_name"],
                         url=f"https://www.nfl.com/teams/{nfl['slug']}/"))
                rep.note("C5b", nfl_ab,
                         f"NFL.com club code for {row['display_name']} (fid {fid}) has no "
                         "team_alias row - unresolvable if an NFL.com feed is ever ingested")
            elif alias_map[nfl_ab] != fid:
                rep.fail("C5b", nfl_ab,
                         f"NFL.com uses {nfl_ab!r} for {row['display_name']} (fid {fid}) "
                         f"but team_alias maps it to fid {alias_map[nfl_ab]}",
                         f"https://www.nfl.com/teams/{nfl['slug']}/")

    # per-season division drift inside ESPN itself
    div_by_fid = defaultdict(set)
    for year in sorted(espn):
        for fid, t in espn[year].items():
            if t["division"]:
                div_by_fid[fid].add((year, norm_div(t["division"])))
    for fid, pairs in div_by_fid.items():
        divs = {d for _, d in pairs}
        if len(divs) > 1:
            rep.fail("C4", f"fid {fid}",
                     f"ESPN reports more than one division across seasons: {sorted(divs)} "
                     "- team encodes a single division and cannot represent this",
                     "per-season groups")

    # ---- C5: team_alias -----------------------------------------------------
    espn_abbrs: dict[str, set[int]] = defaultdict(set)
    for year in espn:
        for fid, t in espn[year].items():
            if t["abbreviation"]:
                espn_abbrs[t["abbreviation"]].add(fid)

    for a in aliases:
        if a["franchise_id"] not in dbt:
            rep.fail("C5", a["abbreviation"],
                     f"alias points at franchise_id {a['franchise_id']} which is not in team", "")
            continue
        owners = espn_abbrs.get(a["abbreviation"])
        if owners and a["franchise_id"] not in owners:
            rep.fail("C5", a["abbreviation"],
                     f"alias -> fid {a['franchise_id']} ({dbt[a['franchise_id']]['display_name']}) "
                     f"but ESPN uses this abbreviation for fid(s) {sorted(owners)}",
                     "ESPN seasonal team resources")
        if owners and len(owners) > 1:
            rep.fail("C5", a["abbreviation"],
                     f"ESPN uses this abbreviation for MORE THAN ONE franchise {sorted(owners)} "
                     "- the alias is ambiguous", "ESPN seasonal team resources")

    # current alias must equal team.abbreviation, and exactly one per franchise
    cur_by_fid = defaultdict(list)
    for a in aliases:
        if a["is_current"]:
            cur_by_fid[a["franchise_id"]].append(a["abbreviation"])
    for fid, row in sorted(dbt.items()):
        got = cur_by_fid.get(fid, [])
        if got != [row["abbreviation"]]:
            rep.fail("C5", f"fid {fid}",
                     f"expected exactly one is_current alias == team.abbreviation "
                     f"{row['abbreviation']!r}, found {got}", "")

    # every era label `game` publishes must have an alias row
    used = {r[0] for r in con.execute(
        "SELECT away_abbr FROM game WHERE away_abbr IS NOT NULL "
        "UNION SELECT home_abbr FROM game WHERE home_abbr IS NOT NULL")}
    for ab in sorted(used - set(alias_map)):
        rep.fail("C5", ab, "abbreviation appears in game but has no team_alias row", "")
    rep.data["unused_aliases"] = sorted(set(alias_map) - used)

    # Every era label ESPN itself has ever published in this window should be
    # resolvable through team_alias, otherwise an ESPN-sourced feed can arrive
    # with a label the DB cannot map.
    espn_uncovered = []
    for ab, owners in sorted(espn_abbrs.items()):
        if ab not in alias_map:
            espn_uncovered.append(dict(abbr=ab, espn_fids=sorted(owners)))
            rep.fail("C5", ab,
                     f"ESPN publishes this abbreviation (fid {sorted(owners)}) but "
                     "team_alias has no row for it", "ESPN seasonal team resources")
    rep.data["espn_uncovered"] = espn_uncovered

    # LA / SL specifically
    for probe in ("LA", "SL", "STL", "LAR", "LAC", "SD", "OAK", "LV", "WAS", "WSH"):
        rep.data.setdefault("probe_aliases", {})[probe] = dict(
            db_fid=alias_map.get(probe),
            db_team=dbt.get(alias_map.get(probe, -1), {}).get("display_name"),
            espn_fids=sorted(espn_abbrs.get(probe, [])),
            used_in_game=probe in used,
        )

    # ---- C7: game.abbr <-> franchise_id -------------------------------------
    bad = con.execute(
        """
        SELECT g.game_id, g.season, g.away_abbr, g.away_franchise_id,
               g.home_abbr, g.home_franchise_id
        FROM game g
        LEFT JOIN team_alias aa ON aa.abbreviation = g.away_abbr
        LEFT JOIN team_alias ha ON ha.abbreviation = g.home_abbr
        WHERE (g.away_abbr IS NOT NULL AND aa.franchise_id IS NOT g.away_franchise_id)
           OR (g.home_abbr IS NOT NULL AND ha.franchise_id IS NOT g.home_franchise_id)
        """).fetchall()
    for r in bad[:50]:
        rep.fail("C7", r["game_id"],
                 f"abbr/franchise mismatch: away {r['away_abbr']}->{r['away_franchise_id']}, "
                 f"home {r['home_abbr']}->{r['home_franchise_id']}", "team_alias join")
    if len(bad) > 50:
        rep.fail("C7", "(truncated)", f"{len(bad)} rows total mismatch abbr vs franchise_id", "")
    rep.data["c7_mismatch_rows"] = len(bad)

    # ---- C6: era plausibility ----------------------------------------------
    for ab, (fid, lo, hi) in ERA_WINDOWS.items():
        rows = con.execute(
            "SELECT MIN(season) mn, MAX(season) mx, COUNT(*) n FROM ("
            "  SELECT season, away_abbr AS a FROM game WHERE away_abbr=? "
            "  UNION ALL SELECT season, home_abbr FROM game WHERE home_abbr=?)",
            (ab, ab)).fetchone()
        if rows["n"] == 0:
            continue
        if lo is not None and rows["mn"] < lo:
            rep.fail("C6", ab, f"used from season {rows['mn']} but identity begins {lo}", "")
        if hi is not None and rows["mx"] > hi:
            rep.fail("C6", ab, f"used through season {rows['mx']} but identity ends {hi}", "")
        rep.data.setdefault("era_observed", {})[ab] = dict(
            fid=fid, first=rows["mn"], last=rows["mx"], n=rows["n"],
            expect_first=lo, expect_last=hi)

    # Cross-check each boundary against ESPN's own seasonal record.
    #
    # Only one outcome here is actually dangerous: ESPN publishing the *current*
    # branding on a pre-move season. That would mean the seasonal endpoint is
    # backfilled, era labels cannot be derived from it, and any tooling that does
    # so is silently wrong. That is a hard failure.
    #
    # ESPN merely disagreeing with the historical record is a contradiction to
    # record, not a DB defect - `team` stores one current name per franchise and
    # has no historical-name column for ESPN to contradict.
    for chg in IDENTITY_CHANGES:
        fid, eff = chg["fid"], chg["effective"]
        got_before = (espn.get(eff - 1, {}).get(fid) or {}).get("display_name")
        got_after = (espn.get(eff, {}).get(fid) or {}).get("display_name")
        current = (espn.get(latest, {}).get(fid) or {}).get("display_name")
        if got_before and current and got_before == current and chg["before"] != current:
            rep.fail("C6", chg["label"],
                     f"ESPN backfills current branding onto season {eff-1}: it reports "
                     f"{got_before!r}, but the team played that season as {chg['before']!r}. "
                     "Era labels cannot be derived from this endpoint.",
                     f"{ESPN_CORE}/seasons/{eff-1}/teams/{fid}")
        if got_before and got_before != chg["before"]:
            rep.note("C6", chg["label"],
                     f"ESPN season {eff-1} display_name is {got_before!r}; the historical "
                     f"name was {chg['before']!r}")
        if got_after and got_after != chg["after"]:
            rep.note("C6", chg["label"],
                     f"ESPN season {eff} display_name is {got_after!r}; the historical "
                     f"name was {chg['after']!r}")

    # ---- C8: games per franchise per season ---------------------------------
    matrix = defaultdict(lambda: defaultdict(lambda: dict(REG=0, POST=0)))
    for r in con.execute(
        """
        SELECT season, season_type, franchise_id, COUNT(*) n FROM (
          SELECT season, season_type, away_franchise_id AS franchise_id FROM game
            WHERE away_franchise_id IS NOT NULL
          UNION ALL
          SELECT season, season_type, home_franchise_id FROM game
            WHERE home_franchise_id IS NOT NULL)
        GROUP BY season, season_type, franchise_id
        """):
        matrix[r["season"]][r["franchise_id"]][r["season_type"]] = r["n"]
    rep.data["matrix"] = {s: {f: dict(v) for f, v in d.items()} for s, d in matrix.items()}

    deviations = []
    db_seasons = [r[0] for r in con.execute("SELECT DISTINCT season FROM game ORDER BY season")]
    for season in db_seasons:
        expected_reg = 16 if season <= 2020 else 17
        # 4 is the ceiling in both eras: a team without a first-round bye that
        # reaches the Super Bowl plays WC + DIV + CON + SB.
        max_post = 4
        for fid in sorted(dbt):
            cell = matrix[season].get(fid, dict(REG=0, POST=0))
            if cell["REG"] != expected_reg:
                deviations.append(dict(season=season, fid=fid,
                                       team=dbt[fid]["display_name"],
                                       reg=cell["REG"], expected=expected_reg,
                                       post=cell["POST"]))
            if cell["POST"] > max_post:
                rep.fail("C8", f"fid {fid} season {season}",
                         f"{cell['POST']} postseason games, max possible is {max_post}", "")
    rep.data["deviations"] = deviations

    # Every deviation must be individually explained AND confirmed against ESPN.
    # The only genuine one in 2010-2026 is the game abandoned after Damar Hamlin's
    # cardiac arrest (BUF @ CIN, 2023-01-02, never resumed or replayed), which
    # left Buffalo and Cincinnati on 16 regular-season games in 2022.
    KNOWN = {(2022, 2), (2022, 4)}
    for dev in deviations:
        key = (dev["season"], dev["fid"])
        got = espn_team_schedule_counts(dev["fid"], dev["season"], offline)
        dev["espn_played"] = got["played"] if got else None
        dev["espn_listed"] = got["listed"] if got else None
        dev["espn_canceled"] = got["canceled"] if got else None
        if key not in KNOWN:
            rep.fail("C8", f"fid {dev['fid']} season {dev['season']}",
                     f"{dev['team']} has {dev['reg']} regular-season games, expected "
                     f"{dev['expected']} - unexplained deviation", "")
            continue
        if got is None:
            rep.fail("C8", f"fid {dev['fid']} season {dev['season']}",
                     "known exception could not be confirmed against ESPN (no response)",
                     f"{ESPN_SITE}/teams/{dev['fid']}/schedule?season={dev['season']}&seasontype=2")
            continue
        if got["played"] != dev["reg"]:
            rep.fail("C8", f"fid {dev['fid']} season {dev['season']}",
                     f"DB says {dev['reg']} regular-season games played, ESPN says {got['played']}",
                     f"{ESPN_SITE}/teams/{dev['fid']}/schedule?season={dev['season']}&seasontype=2")
        if len(got["canceled"] or []) != 1:
            rep.fail("C8", f"fid {dev['fid']} season {dev['season']}",
                     f"expected exactly one abandoned fixture on ESPN's schedule, "
                     f"found {len(got['canceled'] or [])}",
                     f"{ESPN_SITE}/teams/{dev['fid']}/schedule?season={dev['season']}&seasontype=2")
        else:
            ev = got["canceled"][0]
            # the abandoned fixture must be genuinely absent from `game`, not
            # silently present as a 0-0 or scheduled row
            present = con.execute("SELECT COUNT(*) FROM game WHERE espn_event_id = ?",
                                  (str(ev["event_id"]),)).fetchone()[0]
            dev["abandoned_event"] = ev
            dev["abandoned_event_in_db"] = present
            if present:
                rep.fail("C8", f"fid {dev['fid']} season {dev['season']}",
                         f"abandoned ESPN event {ev['event_id']} is present in `game` "
                         f"({present} row(s)) yet the team count is short - contradictory", "")
            if set(ev["teams"] or []) != {"BUF", "CIN"}:
                rep.fail("C8", f"fid {dev['fid']} season {dev['season']}",
                         f"abandoned fixture is {ev['teams']}, expected BUF/CIN", "")

    # and prove BUF/CIN are the ONLY short franchises in 2022, from ESPN directly
    if 2022 in db_seasons:
        espn_2022 = {}
        for fid in sorted(dbt):
            got = espn_team_schedule_counts(fid, 2022, offline)
            if got:
                espn_2022[fid] = dict(played=got["played"], listed=got["listed"],
                                      canceled=len(got["canceled"] or []))
        rep.data["espn_2022_reg"] = espn_2022
        if espn_2022:
            short = {f for f, v in espn_2022.items() if v["played"] < 17}
            db_short = {d["fid"] for d in deviations if d["season"] == 2022}
            if short != db_short:
                rep.fail("C8", "2022",
                         f"ESPN says franchises {sorted(short)} played <17 regular-season "
                         f"games in 2022; DB deviation set is {sorted(db_short)}",
                         f"{ESPN_SITE}/teams/{{id}}/schedule?season=2022&seasontype=2")

    # ---- C9: game.franchise_id vs ESPN's own home/away assignment -----------
    # The failure this whole job exists to catch (Buffalo written as 17, which is
    # New England) is invisible to row counts. The only way to see it is to ask
    # ESPN who actually played each event. Probe seasons are chosen so that every
    # era label in the DB is exercised: 2015 STL/SD/OAK, 2017 LA+LAC, 2020 LV+WAS,
    # 2022 the abandoned-game season, 2026 LAR/WSH (ESPN-sourced rows).
    c9 = dict(checked=0, matched=0, missing_in_db=0, mismatched=[],
              absent_non_games=[], seasons=C9_SEASONS)
    site_abbrs: dict[tuple, set] = defaultdict(set)   # (season, fid) -> abbrs
    for season in C9_SEASONS:
        if season not in db_seasons:
            continue
        sides: dict[str, dict] = {}
        for fid in sorted(dbt):
            sched = espn_team_schedule(fid, season, offline)
            if sched:
                sides.update(sched["sides"])
        if not sides:
            rep.fail("C9", f"season {season}", "no ESPN schedule data available", "")
            continue
        # espn_event_id is deliberately non-unique in the schema, so index to a
        # list and refuse to guess when one id covers more than one game.
        rows: dict[str, list[dict]] = defaultdict(list)
        for r in con.execute(
                "SELECT espn_event_id, game_id, away_franchise_id, home_franchise_id, "
                "away_abbr, home_abbr FROM game WHERE season = ? AND season_type='REG'",
                (season,)):
            rows[r["espn_event_id"]].append(dict(r))
        for eid, side in sides.items():
            bucket = rows.get(eid) or []
            if len(bucket) > 1:
                rep.fail("C9", f"event {eid} season {season}",
                         f"espn_event_id maps to {len(bucket)} game rows "
                         f"({', '.join(b['game_id'] for b in bucket)}) - cannot verify "
                         "attribution through an ambiguous key", "")
                continue
            row = bucket[0] if bucket else None
            if row is None:
                # ESPN retains shells for fixtures that were never played under
                # that id: abandoned games (handled by C8) and games postponed
                # then replayed under a fresh event id. Neither is a gap. An
                # absent event in any other state is a real one.
                st = (side["status"] or "").upper()
                if "CANCEL" in st or "POSTPON" in st:
                    c9["absent_non_games"].append(
                        dict(season=season, event_id=eid, date=side["date"],
                             status=side["status"],
                             matchup=f"{side['away_abbr']}@{side['home_abbr']}"))
                    continue
                c9["missing_in_db"] += 1
                rep.fail("C9", f"event {eid} season {season}",
                         f"ESPN publishes this event ({side['away_abbr']}@"
                         f"{side['home_abbr']}, {side['date']}, {side['status']}) "
                         "but `game` has no row with that espn_event_id",
                         f"{ESPN_SITE}/summary?event={eid}")
                continue
            c9["checked"] += 1
            if (row["home_franchise_id"] == side["home"]
                    and row["away_franchise_id"] == side["away"]):
                c9["matched"] += 1
            else:
                bad = dict(season=season, espn_event_id=eid, game_id=row["game_id"],
                           db_home=row["home_franchise_id"], espn_home=side["home"],
                           db_away=row["away_franchise_id"], espn_away=side["away"],
                           db_labels=f"{row['away_abbr']}@{row['home_abbr']}",
                           espn_labels=f"{side['away_abbr']}@{side['home_abbr']}")
                c9["mismatched"].append(bad)
                rep.fail("C9", f"{row['game_id']} (event {eid})",
                         f"franchise ids disagree with ESPN: DB away/home = "
                         f"{row['away_franchise_id']}/{row['home_franchise_id']} "
                         f"({bad['db_labels']}), ESPN away/home = "
                         f"{side['away']}/{side['home']} ({bad['espn_labels']})",
                         f"{ESPN_SITE}/teams/{side['home']}/schedule?season={season}&seasontype=2")
        for side in sides.values():
            for ha in ("home", "away"):
                if side[ha] is not None and side[f"{ha}_abbr"]:
                    site_abbrs[(season, side[ha])].add(side[f"{ha}_abbr"])
    for a in c9["absent_non_games"]:
        rep.note("C9", f"season {a['season']} event {a['event_id']}",
                 f"{a['matchup']} {a['date']} is {a['status']} on ESPN and is "
                 "deliberately absent from `game` - a fixture, not a game")
    rep.data["c9"] = c9

    # ESPN's site API and its core API are separate publications and can label
    # the same franchise differently. Record both, and flag any site-API label
    # team_alias cannot resolve.
    site_map = {f"{s}/{f}": sorted(v) for (s, f), v in sorted(site_abbrs.items())}
    rep.data["site_api_abbrs"] = site_map
    for (season, fid), labels in sorted(site_abbrs.items()):
        for lab in sorted(labels):
            core = (espn.get(season, {}).get(fid) or {}).get("abbreviation")
            if core and lab != core:
                rep.note("C5c", f"fid {fid} season {season}",
                         f"ESPN site API says {lab!r}, ESPN core API says {core!r}")
            if lab not in alias_map:
                rep.fail("C5c", lab,
                         f"ESPN site API label for fid {fid} in {season} has no team_alias row",
                         f"{ESPN_SITE}/teams/{fid}/schedule?season={season}&seasontype=2")
            elif alias_map[lab] != fid:
                rep.fail("C5c", lab,
                         f"ESPN site API uses {lab!r} for fid {fid} in {season}, but "
                         f"team_alias maps it to fid {alias_map[lab]}",
                         f"{ESPN_SITE}/teams/{fid}/schedule?season={season}&seasontype=2")

    # ---- C11: structural proof of the division column -----------------------
    # `team` stores one division per franchise and cannot express a per-season
    # value, so "is that safe for 2010-2026?" has to be answered, not assumed.
    # Two independent structural facts answer it:
    #
    #   (a) nflverse ships its own div_game flag per game. It must agree with the
    #       division column on every row that carries it.
    #   (b) Since the 2002 realignment every team plays its three division rivals
    #       home and away - exactly 6 divisional games, every team, every season.
    #       If any franchise sat in the wrong division for any season, its count
    #       would not be 6. This also detects a realignment we failed to model.
    shape = [dict(r) for r in con.execute(
        "SELECT conference, division, COUNT(*) n FROM team GROUP BY conference, division")]
    rep.data["division_shape"] = shape
    if len(shape) != 8 or any(s["n"] != 4 for s in shape):
        rep.fail("C11", "team",
                 f"expected 8 divisions of 4, got {[(s['division'], s['n']) for s in shape]}", "")

    flag_bad = con.execute(
        """
        SELECT COUNT(*) FROM game g
        JOIN team ta ON ta.franchise_id = g.away_franchise_id
        JOIN team th ON th.franchise_id = g.home_franchise_id
        WHERE g.div_game IS NOT NULL
          AND g.div_game <> (CASE WHEN ta.division = th.division THEN 1 ELSE 0 END)
        """).fetchone()[0]
    flag_total = con.execute(
        "SELECT COUNT(*) FROM game WHERE div_game IS NOT NULL").fetchone()[0]
    rep.data["div_flag"] = dict(checked=flag_total, disagreed=flag_bad)
    if flag_bad:
        rep.fail("C11", "div_game",
                 f"{flag_bad} of {flag_total} games have a nflverse div_game flag that "
                 "contradicts team.division", "")

    div_counts = con.execute(
        """
        WITH pf AS (
          SELECT g.season, g.away_franchise_id AS fid FROM game g
            JOIN team ta ON ta.franchise_id = g.away_franchise_id
            JOIN team th ON th.franchise_id = g.home_franchise_id
           WHERE g.season_type = 'REG' AND ta.division = th.division
          UNION ALL
          SELECT g.season, g.home_franchise_id FROM game g
            JOIN team ta ON ta.franchise_id = g.away_franchise_id
            JOIN team th ON th.franchise_id = g.home_franchise_id
           WHERE g.season_type = 'REG' AND ta.division = th.division)
        SELECT season, fid, COUNT(*) n FROM pf GROUP BY season, fid
        """).fetchall()
    off = [dict(season=r["season"], fid=r["fid"], n=r["n"])
           for r in div_counts if r["n"] != 6]
    rep.data["div_games_cells"] = len(div_counts)
    rep.data["div_games_off"] = off
    for o in off:
        rep.fail("C11", f"fid {o['fid']} season {o['season']}",
                 f"{o['n']} divisional games, expected exactly 6 - the franchise's "
                 "division is wrong for this season, or the league realigned", "")
    missing_cells = {(s, f) for s in db_seasons for f in dbt} - {
        (r["season"], r["fid"]) for r in div_counts}
    for s, f in sorted(missing_cells):
        rep.fail("C11", f"fid {f} season {s}", "no divisional games at all", "")

    # ---- C10: legacy ESPN event ids encode the home franchise id ------------
    # ESPN's pre-2014 event ids have the shape 3 + YYMMDD + zero-padded home
    # franchise id (301114022 = 2010-11-14, home franchise 22 = Arizona). That
    # makes every 2010-2013 row a free, offline, ESPN-authored cross-check on
    # home_franchise_id - and it is independent of everything above.
    legacy = con.execute(
        """
        SELECT game_id, espn_event_id, season, gameday, away_abbr, home_abbr,
               home_franchise_id,
               CAST(SUBSTR(espn_event_id, 7, 3) AS INTEGER) AS encoded_home
        FROM game
        WHERE season BETWEEN 2010 AND 2013
          AND LENGTH(espn_event_id) = 9 AND SUBSTR(espn_event_id, 1, 1) = '3'
        """).fetchall()
    c10 = dict(checked=len(legacy), agreed=0, disagreed=[])
    for r in legacy:
        if r["encoded_home"] == r["home_franchise_id"]:
            c10["agreed"] += 1
        else:
            # Resolve the disagreement against ESPN rather than asserting which
            # side is wrong: pull the summary for the id the row stores and for
            # the id the encoding implies, and report what each actually is.
            implied = f"{r['espn_event_id'][:6]}{r['home_franchise_id']:03d}"
            resolved = {}
            for label, eid in (("stored", r["espn_event_id"]), ("implied", implied)):
                doc = fetch_json(f"{ESPN_SITE}/summary?event={eid}", offline=offline)
                comp = ((doc or {}).get("header", {}).get("competitions") or [{}])[0]
                sides_seen = {c.get("homeAway"): (
                    (c.get("team") or {}).get("id"),
                    (c.get("team") or {}).get("abbreviation"),
                    c.get("score")) for c in comp.get("competitors", [])}
                resolved[label] = dict(event_id=eid, sides=sides_seen or None)
            bad = dict(game_id=r["game_id"], espn_event_id=r["espn_event_id"],
                       gameday=r["gameday"],
                       matchup=f"{r['away_abbr']}@{r['home_abbr']}",
                       home_franchise_id=r["home_franchise_id"],
                       encoded_home=r["encoded_home"],
                       implied_event_id=implied, resolved=resolved)
            c10["disagreed"].append(bad)
            rep.fail("C10", r["game_id"],
                     f"espn_event_id {r['espn_event_id']} encodes home franchise "
                     f"{r['encoded_home']}, but the row stores home_franchise_id "
                     f"{r['home_franchise_id']} ({r['away_abbr']}@{r['home_abbr']}). "
                     f"ESPN says {r['espn_event_id']} is {resolved['stored']['sides']} "
                     f"and {implied} is {resolved['implied']['sides']}",
                     f"{ESPN_SITE}/summary?event={r['espn_event_id']} and "
                     f"{ESPN_SITE}/summary?event={implied}")
    rep.data["c10"] = c10

    if strict:
        for u in rep.data.get("unresolvable_labels", []):
            rep.fail("C5b", u["label"],
                     f"--strict: {u['source']} label for {u['team']} (fid "
                     f"{u['franchise_id']}) has no team_alias row", u["url"])

    con.close()
    return rep


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", default=",".join(str(s) for s in ALL_SEASONS),
                    help="comma-separated seasons to verify (default 2010-2026)")
    ap.add_argument("--offline", action="store_true",
                    help="never hit the network; use only what is already cached")
    ap.add_argument("--json-out", default=None, help="dump the raw findings as JSON")
    ap.add_argument("--strict", action="store_true",
                    help="also fail on labels a cross-check publisher uses that "
                         "team_alias cannot resolve (default: itemised as notes)")
    args = ap.parse_args()

    seasons = [int(s) for s in args.seasons.split(",") if s.strip()]
    os.makedirs(CACHE_DIR, exist_ok=True)

    rep = run(seasons, args.offline, strict=args.strict)

    print("=" * 78)
    print("A2 - franchise dimension vs ESPN + NFL.com")
    print("=" * 78)

    espn = rep.data.get("espn", {})
    print(f"seasons verified against ESPN : {sorted(espn)}")
    print(f"ESPN teams per season         : "
          f"{ {y: len(t) for y, t in sorted(espn.items())} }")
    print(f"ESPN seasonal names era-correct: {rep.data.get('espn_era_correct')}")
    print(f"nfl.com teams parsed          : {len(rep.data.get('nflcom', {}))}")
    print(f"game abbr/franchise mismatches: {rep.data.get('c7_mismatch_rows')}")
    print(f"games-per-season deviations   : {len(rep.data.get('deviations', []))}")
    for d in rep.data.get("deviations", []):
        print(f"    {d['season']} fid {d['fid']:<2} {d['team']:<22} "
              f"DB REG={d['reg']} (expected {d['expected']})  "
              f"ESPN played={d.get('espn_played')} listed={d.get('espn_listed')} "
              f"canceled={d.get('espn_canceled')}")
    if rep.data.get("unused_aliases"):
        print(f"aliases never used in game    : {rep.data['unused_aliases']}")
    df = rep.data.get("div_flag") or {}
    print(f"C11 div_game flag vs division : {df.get('checked', 0) - df.get('disagreed', 0)}"
          f"/{df.get('checked')} agree")
    print(f"C11 divisional games per cell : "
          f"{rep.data.get('div_games_cells')} (season, franchise) cells, "
          f"{len(rep.data.get('div_games_off', []))} not equal to 6")
    c10 = rep.data.get("c10") or {}
    if c10:
        print(f"C10 legacy id -> home franchise: {c10.get('agreed')}/{c10.get('checked')} "
              f"agree, {len(c10.get('disagreed', []))} disagree")
    c9 = rep.data.get("c9") or {}
    if c9:
        print(f"C9 franchise-id vs ESPN sides : seasons {c9.get('seasons')} -> "
              f"{c9.get('matched')}/{c9.get('checked')} matched, "
              f"{len(c9.get('mismatched', []))} mismatched, "
              f"{c9.get('missing_in_db')} ESPN events absent from game")

    if rep.notes:
        print(f"\nnotes ({len(rep.notes)}) - contradictions recorded, not resolved:")
        for n in rep.notes:
            print(f"  [{n['check']}] {n['id']}: {n['detail']}")

    print()
    if rep.failures:
        print(f"FAIL - {len(rep.failures)} mismatch(es)")
        for f in rep.failures:
            print(f"  [{f['check']}] {f['id']}: {f['detail']}")
            if f["evidence"]:
                print(f"        evidence: {f['evidence']}")
    else:
        print("PASS - zero mismatches")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(dict(failures=rep.failures, notes=rep.notes, data=rep.data), fh,
                      indent=2, default=str)
        print(f"\nwrote {args.json_out}")

    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.exit(main())
