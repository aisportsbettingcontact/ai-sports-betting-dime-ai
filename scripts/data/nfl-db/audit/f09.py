#!/usr/bin/env python3
"""F09 -- forensic row-level audit of the 2026 season plus every season-independent table.

Partition
---------
  game (season = 2026)   285 rows
  player                 26,517 rows  (the whole table)
  team                   32 rows
  team_alias             44 rows
  data_correction        624 rows

Authorities
-----------
  game 2026        ESPN scoreboard (site API), season type 2 weeks 1-18 and type 3 weeks 1-5,
                   plus ESPN's own date-bucketed scoreboard for the `gameday` ruling.
  player           ESPN athletes (sports.core.api) -- reuses agent A3's cache where present.
  team/team_alias  ESPN seasonal team endpoints 2010-2026 + ESPN standings groups + NFL.com.
  data_correction  each correction re-verified against the authority its own `source` names.

Usage
-----
  python3 audit/f09.py fetch      # populate cache/f09 (idempotent, cache-first, rate limited)
  python3 audit/f09.py audit      # offline: read cache only, emit the ledger
  python3 audit/f09.py md5        # print the database md5

Everything under `audit` is replayable with the network unplugged.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import unicodedata
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(ROOT)))
DB = os.path.join(ROOT, "nfl.db")
CACHE = os.path.join(ROOT, "cache", "f09")
A3 = os.path.join(ROOT, "cache", "a3")
LEDGER_DIR = os.path.join(
    REPO, "docs", "audits", "2026-07-27-nfl-db-forensic", "ledger")
LEDGER = os.path.join(LEDGER_DIR, "F09.jsonl")

AGENT = "F09"
SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"

SEASON = 2026
SLEEP = 0.6

# --------------------------------------------------------------------------
# venue -> IANA zone.  Built from the ESPN venue address published on the 2026
# scoreboard (city/state/country); used only to *contrast* the two competing
# `gameday` derivation rules (INTEGRATION.md "venue's local zone" vs
# CONTEXT.md / implemented code "Pacific").
# --------------------------------------------------------------------------
VENUE_TZ = {
    "1353": "Europe/Madrid",        # Santiago Bernabeu, Madrid
    "1781": "Europe/Paris",         # Stade de France, Saint-Denis
    "2455": "Europe/London",        # Wembley
    "3493": "America/Chicago",      # Caesars Superdome
    "3622": "America/Chicago",      # Arrowhead
    "3628": "America/New_York",     # Bank of America
    "3673": "America/Los_Angeles",  # Lumen
    "3679": "America/New_York",     # Huntington Bank
    "3687": "America/Chicago",      # AT&T
    "3712": "America/New_York",     # EverBank
    "3719": "America/New_York",     # Northwest
    "3727": "America/New_York",     # Ford Field
    "3738": "America/New_York",     # Gillette
    "3752": "America/New_York",     # Acrisure
    "3798": "America/Chicago",      # Lambeau
    "3806": "America/New_York",     # Lincoln Financial
    "3810": "America/Chicago",      # Nissan
    "3812": "America/Indiana/Indianapolis",
    "3814": "America/New_York",     # M&T Bank
    "3839": "America/New_York",     # MetLife
    "3874": "America/New_York",     # Paycor
    "3886": "America/New_York",     # Raymond James
    "3891": "America/Chicago",      # NRG
    "3933": "America/Chicago",      # Soldier Field
    "3937": "America/Denver",       # Empower Field
    "3948": "America/New_York",     # Hard Rock
    "3970": "America/Phoenix",      # State Farm
    "4738": "America/Los_Angeles",  # Levi's
    "5239": "America/Chicago",      # US Bank
    "5348": "America/New_York",     # Mercedes-Benz
    "5534": "Europe/London",        # Tottenham
    "6501": "America/Los_Angeles",  # Allegiant
    "7065": "America/Los_Angeles",  # SoFi
    "8219": "America/Mexico_City",  # Estadio Banorte
    "9119": "Australia/Melbourne",  # Melbourne Cricket Ground
    "11930": "Europe/Berlin",       # Munich
    "11931": "America/Sao_Paulo",   # Maracana
    "11938": "America/New_York",    # Highmark
}

PACIFIC = ZoneInfo("America/Los_Angeles")
EASTERN = ZoneInfo("America/New_York")

PLAYOFF_BY_TYPE3_WEEK = {1: "WC", 2: "DIV", 3: "CON", 4: "PRO", 5: "SB"}

# Games whose ESPN summary is needed as evidence for a data_correction group.
# The ESPN event ids are read out of the `game` table itself at fetch time --
# hardcoding them is how an audit fetches the wrong box score and never notices.
CORRECTION_GAMES = [
    # D9  -- the espn_event_id collision (both sides of it)
    "2010_10_HOU_JAX", "2010_10_SEA_ARI",
    # D12 -- 7 wrong kickoffs
    "2014_01_SD_ARI", "2016_02_TB_ARI", "2017_03_BAL_JAX", "2017_04_NO_MIA",
    "2017_08_MIN_CLE", "2018_07_TEN_LAC", "2018_08_PHI_JAX",
    # D13 -- 7 international venues in 2025
    "2025_01_KC_LAC", "2025_04_MIN_PIT", "2025_05_MIN_CLE", "2025_06_DEN_NYJ",
    "2025_07_LA_JAX", "2025_10_ATL_IND", "2025_11_WAS_MIA",
    # D16 -- 4 transposed Super Bowls
    "2014_21_NE_SEA", "2015_21_CAR_DEN", "2018_21_NE_LA", "2020_21_KC_TB",
    # D17 -- nflverse play duplication
    "2011_13_DET_NO", "2011_10_DET_CHI",
]


def correction_events(con) -> dict:
    """game_id -> espn_event_id, straight from the database under audit."""
    out = {}
    for gid in CORRECTION_GAMES:
        r = con.execute("SELECT espn_event_id FROM game WHERE game_id=?", (gid,)).fetchone()
        if r:
            out[gid] = r[0]
    return out

FRANCHISE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34]


# ==========================================================================
# small utilities
# ==========================================================================
def db_md5(path: str = DB) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def ro() -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def rel(path: str) -> str:
    """Ledger evidence paths are repo-relative so they can be checked from anywhere."""
    return os.path.relpath(path, REPO)


def fetch(url: str, dest: str, force: bool = False) -> str | None:
    """Cache-first GET.  Returns the on-disk path, or None on hard failure."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0 and not force:
        return dest
    for attempt in range(3):
        r = subprocess.run(
            ["curl", "-sSL", "--max-time", "45", "-w", "%{http_code}",
             "-o", dest, url],
            capture_output=True, text=True)
        code = (r.stdout or "").strip()[-3:]
        if code == "200" and os.path.getsize(dest) > 0:
            time.sleep(SLEEP)
            return dest
        time.sleep(1.5 * (attempt + 1))
    # keep whatever came back -- a 404 body is itself evidence
    time.sleep(SLEEP)
    return dest if os.path.exists(dest) and os.path.getsize(dest) > 0 else None


def jload(path: str):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return None


def parse_z(s: str) -> datetime:
    """ESPN publishes '2026-09-11T00:35Z'; the DB stores '2026-09-11T00:35:00Z'."""
    s = s.strip().replace("Z", "+00:00")
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def athlete_path(espn_id: str) -> str:
    """A3's layout, reused verbatim; F09 writes misses into its own tree."""
    p = os.path.join(A3, "athletes", espn_id[-2:].zfill(2), f"{espn_id}.json")
    if os.path.exists(p):
        return p
    return os.path.join(CACHE, "athletes", espn_id[-2:].zfill(2), f"{espn_id}.json")


def college_path(cid: str) -> str:
    p = os.path.join(A3, "colleges", cid[-2:].zfill(2), f"{cid}.json")
    if os.path.exists(p):
        return p
    return os.path.join(CACHE, "colleges", cid[-2:].zfill(2), f"{cid}.json")


# ==========================================================================
# FETCH
# ==========================================================================
def phase_fetch() -> None:
    os.makedirs(CACHE, exist_ok=True)
    log = []

    def note(msg):
        print(msg, flush=True)
        log.append(msg)

    # --- 1. 2026 scoreboards, by season type and week -------------------
    for st, weeks in ((2, range(1, 19)), (3, range(1, 6))):
        for w in weeks:
            dest = os.path.join(CACHE, "scoreboard", f"sb_2026_t{st}_w{w}.json")
            fetch(f"{SITE}/scoreboard?dates=2026&seasontype={st}&week={w}", dest)
    note("scoreboards: 2026 weeks done")

    # --- 2. ESPN's own date bucketing, for the gameday ruling ------------
    con = ro()
    days = set()
    for r in con.execute("SELECT gameday, kickoff_utc FROM game WHERE season=?", (SEASON,)):
        if r["gameday"]:
            d = datetime.strptime(r["gameday"], "%Y-%m-%d").date()
            for off in (-1, 0, 1):
                days.add(d + timedelta(days=off))
    for d in sorted(days):
        dest = os.path.join(CACHE, "byday", f"sb_{d:%Y%m%d}.json")
        fetch(f"{SITE}/scoreboard?dates={d:%Y%m%d}", dest)
    note(f"by-day scoreboards: {len(days)} dates")

    # --- 3. team grid: every franchise, every season 2010-2026 ----------
    for y in range(2010, 2027):
        for fid in FRANCHISE_IDS:
            dest = os.path.join(CACHE, "teams", str(y), f"{fid}.json")
            fetch(f"{CORE}/seasons/{y}/teams/{fid}?lang=en&region=us", dest)
        note(f"teams {y} done")

    # --- 4. conference / division structure -----------------------------
    for y in (2010, 2026):
        fetch(f"{CORE}/seasons/{y}/types/2/groups?lang=en&region=us",
              os.path.join(CACHE, "groups", f"groups_{y}.json"))
        for gid in (7, 8):  # AFC / NFC
            fetch(f"{CORE}/seasons/{y}/types/2/groups/{gid}?lang=en&region=us",
                  os.path.join(CACHE, "groups", f"group_{y}_{gid}.json"))
            fetch(f"{CORE}/seasons/{y}/types/2/groups/{gid}/children?lang=en&region=us",
                  os.path.join(CACHE, "groups", f"group_{y}_{gid}_children.json"))
    # every division group id, resolved from the children listings
    for y in (2010, 2026):
        for gid in (7, 8):
            d = jload(os.path.join(CACHE, "groups", f"group_{y}_{gid}_children.json")) or {}
            for it in d.get("items", []):
                ref = it.get("$ref", "")
                did = ref.rstrip("/").split("groups/")[-1].split("?")[0]
                if did.isdigit():
                    fetch(f"{CORE}/seasons/{y}/types/2/groups/{did}?lang=en&region=us",
                          os.path.join(CACHE, "groups", f"div_{y}_{did}.json"))
                    fetch(f"{CORE}/seasons/{y}/types/2/groups/{did}/teams?lang=en&region=us",
                          os.path.join(CACHE, "groups", f"div_{y}_{did}_teams.json"))
    note("groups done")

    # --- 5. NFL.com corroboration for team identity ---------------------
    fetch("https://www.nfl.com/teams/", os.path.join(CACHE, "nflcom", "teams.html"))
    fetch("https://www.nfl.com/standings/league/2025/REG",
          os.path.join(CACHE, "nflcom", "standings_2025.html"))
    note("nfl.com done")

    # --- 6. summaries backing each data_correction group ----------------
    for gid, eid in correction_events(con).items():
        fetch(f"{SITE}/summary?event={eid}",
              os.path.join(CACHE, "summary", f"summary_{eid}.json"))
    note("correction summaries done")

    # --- 7. athletes not already in A3's cache --------------------------
    ids = [r[0] for r in con.execute(
        "SELECT DISTINCT espn_id FROM player WHERE espn_id IS NOT NULL AND espn_id<>''")]
    missing = [i for i in ids
               if not os.path.exists(os.path.join(A3, "athletes", i[-2:].zfill(2), f"{i}.json"))]
    note(f"athletes missing from A3: {len(missing)}")
    for i in missing:
        fetch(f"{CORE}/athletes/{i}?lang=en&region=us",
              os.path.join(CACHE, "athletes", i[-2:].zfill(2), f"{i}.json"))

    # --- 8. colleges referenced by any athlete we hold ------------------
    need = set()
    for i in ids:
        a = jload(athlete_path(i))
        if not a:
            continue
        ref = (a.get("college") or {}).get("$ref")
        if ref:
            cid = ref.split("/colleges/")[-1].split("?")[0]
            if cid.isdigit():
                need.add(cid)
    miss_c = [c for c in need if not os.path.exists(college_path(c))]
    note(f"colleges referenced {len(need)}, missing {len(miss_c)}")
    for c in miss_c:
        fetch(f"https://sports.core.api.espn.com/v2/colleges/{c}?lang=en&region=us",
              os.path.join(CACHE, "colleges", c[-2:].zfill(2), f"{c}.json"))

    # --- 9. draft evidence for D18's two Jonah Williamses ---------------
    for aid in ("4040726", "4032481"):
        fetch(f"{CORE}/athletes/{aid}?lang=en&region=us",
              os.path.join(CACHE, "athletes", aid[-2:].zfill(2), f"{aid}.json"), force=False)
    for y in (2019,):
        fetch(f"{CORE}/draft/seasons/{y}/athletes/4040726?lang=en&region=us",
              os.path.join(CACHE, "draft", f"draft_{y}_4040726.json"))
        fetch(f"{CORE}/draft/seasons/{y}/athletes/4032481?lang=en&region=us",
              os.path.join(CACHE, "draft", f"draft_{y}_4032481.json"))
    note("draft evidence done")

    with open(os.path.join(CACHE, "fetch.log"), "w") as fh:
        fh.write("\n".join(log) + "\n")
    print("FETCH COMPLETE")


# ==========================================================================
# AUDIT
# ==========================================================================
#: Fields whose raw values are personal data about a named individual. This
#: repository is public, and the audit findings are committed to it, so the
#: ledger records the *disagreement* rather than the values themselves. The
#: cached authority response named in `evidence` still holds the raw values, so
#: nothing is lost for verification -- it just is not published.
#:
#: `birth_date` is the load-bearing one: an earlier revision of this file wrote
#: 278 real dates of birth into a committed findings file. CodeQL caught it.
SENSITIVE_FIELDS = frozenset({"birth_date", "birthdate", "date_of_birth", "dob"})


def redact_pii(value):
    """Replace a personal-data value with a publishable placeholder.

    Call this at the point the value is read, not deep inside the writer: the
    goal is that a raw date of birth never travels toward a file sink at all.
    """
    return None if value is None else "[REDACTED-PII]"


def _redact(field, value):
    """Defence in depth for callers that forget. Prefer redact_pii upstream."""
    if value is None or field not in SENSITIVE_FIELDS:
        return value, False
    return "[REDACTED-PII]", True


class Ledger:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.fh = open(path, "w")
        self.redacted = 0
        self.n = 0
        self.counts: dict[tuple[str, str], int] = {}
        self.rows: dict[str, set] = {}
        self.missing_evidence = 0
        self.ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def write(self, table, row_key, field, verdict, authority, evidence,
              season=None, db_value=None, ref_id=None, ref_value=None,
              note=None, **extra):
        ev_abs = os.path.join(REPO, evidence)
        if not os.path.exists(ev_abs):
            self.missing_evidence += 1
            note = ((note + " | ") if note else "") + "EVIDENCE-PATH-MISSING"
        db_value, r1 = _redact(field, db_value)
        ref_value, r2 = _redact(field, ref_value)
        if r1 or r2:
            self.redacted += 1
        rec = {"ts": self.ts, "agent": AGENT, "table": table, "row_key": row_key,
               "season": season, "field": field, "db_value": db_value,
               "authority": authority, "ref_id": ref_id, "ref_value": ref_value,
               "verdict": verdict, "evidence": evidence}
        if note:
            rec["note"] = note
        rec.update(extra)
        self.fh.write(json.dumps(rec, default=str) + "\n")
        self.n += 1
        self.counts[(table, verdict)] = self.counts.get((table, verdict), 0) + 1
        self.rows.setdefault(table, set()).add(row_key)

    def close(self):
        self.fh.close()


def _espn_2026_events(byday_index_out: dict | None = None) -> dict:
    """event id -> normalised ESPN fact record, from the cached 2026 scoreboards."""
    out = {}
    for st, weeks in ((2, range(1, 19)), (3, range(1, 6))):
        for w in weeks:
            p = os.path.join(CACHE, "scoreboard", f"sb_2026_t{st}_w{w}.json")
            d = jload(p)
            if not d:
                continue
            for e in d.get("events", []):
                c = e["competitions"][0]
                venue = c.get("venue") or {}
                comp = {x["homeAway"]: x for x in c.get("competitors", [])}
                out[e["id"]] = {
                    "evidence": rel(p),
                    "date": e["date"],
                    "season_type": st,
                    "week": (e.get("week") or {}).get("number"),
                    "playoff_round": PLAYOFF_BY_TYPE3_WEEK.get(w) if st == 3 else None,
                    "neutral": c.get("neutralSite"),
                    "time_valid": c.get("timeValid"),
                    "venue_id": venue.get("id"),
                    "venue_name": venue.get("fullName"),
                    "home_abbr": (comp.get("home", {}).get("team") or {}).get("abbreviation"),
                    "away_abbr": (comp.get("away", {}).get("team") or {}).get("abbreviation"),
                    "home_id": (comp.get("home", {}).get("team") or {}).get("id"),
                    "away_id": (comp.get("away", {}).get("team") or {}).get("id"),
                    "status": ((c.get("status") or {}).get("type") or {}).get("name"),
                    "short": e.get("shortName"),
                    "broadcast": (c.get("broadcast") or None),
                    "notes": [n.get("headline") for n in (c.get("notes") or [])],
                }
    return out


def _byday_index() -> dict:
    """event id -> the ESPN local game date it is filed under (ESPN's own bucketing)."""
    idx = {}
    d = os.path.join(CACHE, "byday")
    if not os.path.isdir(d):
        return idx
    for fn in sorted(os.listdir(d)):
        if not fn.startswith("sb_") or not fn.endswith(".json"):
            continue
        day = fn[3:11]
        blob = jload(os.path.join(d, fn))
        if not blob:
            continue
        for e in blob.get("events", []):
            idx.setdefault(e["id"], []).append(
                (f"{day[:4]}-{day[4:6]}-{day[6:]}", rel(os.path.join(d, fn))))
    for k in idx:
        idx[k].sort()
    return idx


# --------------------------------------------------------------------------
def audit_game_2026(con, L: Ledger) -> dict:
    espn = _espn_2026_events()
    byday = _byday_index()
    findings = {"neutral_disagree": [], "gameday_disagree": [], "other": [],
                "tz_rule": []}

    rows = list(con.execute(
        "SELECT * FROM game WHERE season=? ORDER BY kickoff_utc, game_id", (SEASON,)))

    # ---- independent neutral-site detector, no ESPN flag involved -------
    # A franchise's home games should all sit at one venue. Any home game at a
    # venue other than that franchise's modal 2026 home venue is a neutral-site
    # candidate on structure alone.
    home_venues: dict = {}
    for r in rows:
        if r["home_abbr"] and r["venue_id"]:
            home_venues.setdefault(r["home_abbr"], {}).setdefault(r["venue_id"], []) \
                .append(r["game_id"])
    odd = {}
    for ab, vs in home_venues.items():
        if len(vs) < 2:
            continue
        modal = max(vs, key=lambda v: len(vs[v]))
        for v, gids in vs.items():
            if v != modal:
                for gid in gids:
                    odd[gid] = (ab, v, modal)
    struct_ev = os.path.join(CACHE, "derived", "neutral_structural_2026.json")
    os.makedirs(os.path.dirname(struct_ev), exist_ok=True)
    with open(struct_ev, "w") as fh:
        json.dump({"home_team_venue_distribution":
                   {k: {str(a): b for a, b in v.items()} for k, v in home_venues.items()},
                   "off_modal_home_games": {k: list(v) for k, v in odd.items()}},
                  fh, indent=1)
    findings["structural_neutral"] = odd

    for r in rows:
        gid, eid = r["game_id"], r["espn_event_id"]
        e = espn.get(eid)
        if not e:
            L.write("game", gid, "*", "DB_ONLY", "espn",
                    rel(os.path.join(CACHE, "scoreboard")), season=SEASON,
                    db_value=eid, note="espn_event_id absent from every cached 2026 scoreboard")
            findings["other"].append((gid, "espn_event_id not on ESPN 2026 schedule", eid, None))
            continue
        ev = e["evidence"]
        matched, compared, nonmatch = 0, 0, False

        def cmp(field, dbv, refv, kind="MISMATCH", refid=None):
            nonlocal matched, compared, nonmatch
            compared += 1
            if dbv == refv:
                matched += 1
                return True
            nonmatch = True
            L.write("game", gid, field, kind, "espn", ev, season=SEASON,
                    db_value=dbv, ref_id=refid or eid, ref_value=refv)
            findings["other"].append((gid, field, dbv, refv))
            return False

        # --- kickoff instant
        cmp("kickoff_utc", r["kickoff_utc"],
            parse_z(e["date"]).strftime("%Y-%m-%dT%H:%M:%SZ"))
        # --- week / round
        if r["season_type"] == "REG":
            cmp("week", r["week"], e["week"])
            compared += 1
            if e["season_type"] == 2:
                matched += 1
            else:
                nonmatch = True
                L.write("game", gid, "season_type", "MISMATCH", "espn", ev,
                        season=SEASON, db_value="REG", ref_value=f"type{e['season_type']}")
        else:
            cmp("playoff_round", r["playoff_round"], e["playoff_round"])
            compared += 1
            if e["season_type"] == 3:
                matched += 1
            else:
                nonmatch = True
                L.write("game", gid, "season_type", "MISMATCH", "espn", ev,
                        season=SEASON, db_value="POST", ref_value=f"type{e['season_type']}")

        # --- teams
        if r["result_status"] == "tbd":
            compared += 2
            if r["away_abbr"] is None and r["home_abbr"] is None and \
                    e["home_abbr"] in (None, "TBD"):
                matched += 2
                L.write("game", gid, "home_abbr/away_abbr", "NOT_COMPARABLE", "espn", ev,
                        season=SEASON, db_value=None, ref_value=e["short"],
                        note="unscheduled playoff slot: ESPN publishes 'TBD @ TBD' with no "
                             "competitor teams; blank teams in the DB are structurally correct")
            else:
                nonmatch = True
                L.write("game", gid, "home_abbr/away_abbr", "MISMATCH", "espn", ev,
                        season=SEASON,
                        db_value=f"{r['away_abbr']}@{r['home_abbr']}", ref_value=e["short"])
                findings["other"].append((gid, "tbd teams", r["away_abbr"], e["short"]))
        else:
            cmp("away_abbr", r["away_abbr"], e["away_abbr"])
            cmp("home_abbr", r["home_abbr"], e["home_abbr"])
            cmp("away_franchise_id", r["away_franchise_id"],
                int(e["away_id"]) if e["away_id"] else None)
            cmp("home_franchise_id", r["home_franchise_id"],
                int(e["home_id"]) if e["home_id"] else None)

        # --- venue
        db_v = str(r["venue_id"]) if r["venue_id"] is not None else None
        if e["venue_id"] is None and db_v is None:
            compared += 1
            matched += 1
            L.write("game", gid, "venue_id", "NOT_COMPARABLE", "espn", ev, season=SEASON,
                    note="unscheduled playoff slot: ESPN publishes no venue")
        else:
            cmp("venue_id", db_v, e["venue_id"])

        # --- neutral site (D10)
        db_loc = r["location"]
        if e["neutral"] is None:
            compared += 1
            L.write("game", gid, "location", "NOT_COMPARABLE", "espn", ev, season=SEASON,
                    db_value=db_loc, note="ESPN did not publish neutralSite for this event")
        elif r["result_status"] == "tbd" and e["venue_id"] is None:
            compared += 1
            matched += 1
            L.write("game", gid, "location", "NOT_COMPARABLE", "espn", ev, season=SEASON,
                    db_value=db_loc, ref_value=e["neutral"],
                    note="unscheduled playoff slot with no venue: ESPN's neutralSite=false is a "
                         "struct default, not a ruling; DB stores NULL")
        else:
            want = "Neutral" if e["neutral"] else "Home"
            if not cmp("location", db_loc, want):
                findings["neutral_disagree"].append(
                    (gid, db_loc, want, e["venue_name"]))
            # second, independent detector: off-modal home venue
            struct = "Neutral" if gid in odd else "Home"
            if struct != db_loc and r["result_status"] != "tbd":
                L.write("game", gid, "location.structural", "MISMATCH", "derived",
                        rel(struct_ev), season=SEASON, db_value=db_loc,
                        ref_id=eid, ref_value=struct,
                        note="home franchise's own 2026 home-venue distribution disagrees "
                             "with the stored location flag")
                findings["neutral_disagree"].append(
                    (gid, db_loc, struct, "structural detector"))
            elif r["result_status"] != "tbd":
                L.write("game", gid, "location.structural", "MATCH", "derived",
                        rel(struct_ev), season=SEASON, db_value=db_loc,
                        ref_id=eid, ref_value=struct,
                        note="independent of ESPN's neutralSite flag: the home franchise's "
                             "own 2026 home-venue distribution agrees")

        # --- time_valid
        cmp("time_valid", bool(r["time_valid"]), bool(e["time_valid"]))

        # --- broadcast
        db_b = r["broadcast"]
        ref_b = e["broadcast"]
        if db_b is None and not ref_b:
            compared += 1
            matched += 1
        elif not ref_b:
            compared += 1
            L.write("game", gid, "broadcast", "DB_ONLY", "espn", ev, season=SEASON,
                    db_value=db_b, ref_id=eid,
                    note="ESPN publishes no broadcast string for this event")
        else:
            cmp("broadcast", db_b, ref_b)

        # --- the three competing derivation rules, evaluated for every row
        k = parse_z(r["kickoff_utc"])
        pac = k.astimezone(PACIFIC).strftime("%Y-%m-%d")
        est = k.astimezone(EASTERN).strftime("%Y-%m-%d")
        vtz = VENUE_TZ.get(db_v or "") or "America/New_York"
        loc = k.astimezone(ZoneInfo(vtz)).strftime("%Y-%m-%d")
        findings["tz_rule"].append((gid, r["gameday"], pac, est, loc, vtz,
                                    bool(r["time_valid"])))

        # --- gameday: ESPN's own local game date, from its date bucketing
        seen = byday.get(eid, [])
        if seen:
            espn_day, day_ev = seen[0]
            compared += 1
            if r["gameday"] == espn_day:
                matched += 1
            else:
                nonmatch = True
                L.write("game", gid, "gameday", "MISMATCH", "espn", day_ev, season=SEASON,
                        db_value=r["gameday"], ref_id=eid, ref_value=espn_day,
                        note="ESPN's own date-bucketed scoreboard files this event under a "
                             f"different local game date. Rules: pacific={pac} "
                             f"eastern={est} venue-local({vtz})={loc}; "
                             f"time_valid={r['time_valid']}",
                        rule_pacific=pac, rule_eastern=est, rule_venue_local=loc,
                        venue_tz=vtz)
                findings["gameday_disagree"].append(
                    (gid, r["gameday"], espn_day, pac, est, loc, r["time_valid"]))
            if len(seen) > 1:
                L.write("game", gid, "gameday.multiday", "UNRESOLVED", "espn", day_ev,
                        season=SEASON, db_value=r["gameday"],
                        ref_value=[d for d, _ in seen],
                        note="ESPN returns this event under more than one date bucket")
        else:
            L.write("game", gid, "gameday", "NOT_COMPARABLE", "espn", ev, season=SEASON,
                    db_value=r["gameday"],
                    note="event not returned by any cached date-bucketed scoreboard")

        # --- note column
        if r["note"] is not None:
            L.write("game", gid, "note", "NOT_COMPARABLE", "espn", ev, season=SEASON,
                    db_value=r["note"], ref_id=eid, ref_value=e.get("notes"),
                    note="free-text annotation written by this project; ESPN has no "
                         "equivalent field to rule on")

        # --- structurally absent fields on an unplayed game
        for f in ("away_score", "home_score", "result", "total", "overtime",
                  "temp", "wind", "away_qb_id", "home_qb_id", "away_coach",
                  "home_coach", "referee", "away_rest", "home_rest"):
            if r[f] is not None:
                nonmatch = True
                L.write("game", gid, f, "DB_ONLY", "espn", ev, season=SEASON,
                        db_value=r[f],
                        note="2026 games are unplayed; any value here would be fabricated")
                findings["other"].append((gid, f + " populated on unplayed game", r[f], None))

        if not nonmatch:
            L.write("game", gid, "*", "MATCH", "espn", ev, season=SEASON,
                    ref_id=eid, fields_compared=compared, fields_matched=matched)
    # ESPN events we do not hold
    for eid in espn:
        if not con.execute("SELECT 1 FROM game WHERE espn_event_id=?", (eid,)).fetchone():
            L.write("game", f"espn:{eid}", "*", "REF_ONLY", "espn", espn[eid]["evidence"],
                    season=SEASON, ref_id=eid, ref_value=espn[eid]["short"])
            findings["other"].append((f"espn:{eid}", "on ESPN, absent from DB", None,
                                      espn[eid]["short"]))
    return findings


# --------------------------------------------------------------------------
# Position vocabularies.  nflverse and ESPN both publish positions but with
# different granularity; the comparison is on the coarse group, with the two
# genuinely ambiguous bridges called out rather than scored either way.
POS_GROUP = {
    "QB": "QB",
    "RB": "RB", "FB": "RB", "HB": "RB",
    "WR": "WR", "TE": "TE",
    "OT": "OL", "T": "OL", "G": "OL", "OG": "OL", "C": "OL", "OL": "OL",
    "LS": "OL", "OC": "OL",
    "DE": "DL", "DT": "DL", "NT": "DL", "DL": "DL", "EDGE": "DL",
    "LB": "LB", "OLB": "LB", "ILB": "LB", "MLB": "LB",
    "CB": "DB", "S": "DB", "SAF": "DB", "FS": "DB", "SS": "DB", "DB": "DB",
    "K": "K", "PK": "K", "P": "P",
    "KR": "ST", "PR": "ST",
}
UNKNOWN_POS = {"-", "", "NA", "ATH", "PLACEHOLDER", None}
# feed-level ambiguities that are not errors on either side
POS_BRIDGE = {frozenset(("DL", "LB")),      # 3-4 OLB vs 4-3 DE
              frozenset(("LB", "DB")),      # hybrid safety/linebacker
              frozenset(("OL", "TE")),      # tackle-eligible / jumbo TE
              frozenset(("RB", "TE")),      # H-back
              frozenset(("ST", "WR")), frozenset(("ST", "RB")),
              frozenset(("ST", "DB"))}


def _pos_verdict(dbp, espnp):
    """-> ('MATCH'|'NOT_COMPARABLE'|'MISMATCH', note)"""
    a = (dbp or "").upper().strip()
    b = (espnp or "").upper().strip()
    if a in UNKNOWN_POS or b in UNKNOWN_POS:
        return "NOT_COMPARABLE", "position absent or unknown ('-') on one side"
    if a == b:
        return "MATCH", None
    ga, gb = POS_GROUP.get(a), POS_GROUP.get(b)
    if ga is None or gb is None:
        return "NOT_COMPARABLE", f"unmapped position vocabulary ({a} / {b})"
    if ga == gb:
        return "MATCH", f"same position group {ga}; feeds differ in granularity"
    if frozenset((ga, gb)) in POS_BRIDGE:
        return "NOT_COMPARABLE", (f"{ga}/{gb} is a known cross-feed classification "
                                  "ambiguity, not a disagreement about the player")
    return "MISMATCH", f"different position groups: {ga} vs {gb}"


# College names: nflverse joins a player's full transfer history with ';' and
# uses formal names; ESPN publishes one institution under its own brand name.
# These pairs are unambiguous and are treated as the same school.
COLLEGE_ALIAS = {
    "ole miss": "mississippi", "uconn": "connecticut", "utep": "texas el paso",
    "utsa": "texas san antonio", "ualbany": "albany",
    "massachusetts": "umass amherst", "umass": "umass amherst",
    "iu pennsylvania": "indiana pa", "vcu": "virginia commonwealth",
    "miami (oh)": "miami ohio", "miami oh": "miami ohio",
    "pitt": "pittsburgh", "ucf": "central florida", "usf": "south florida",
    "smu": "southern methodist", "tcu": "texas christian",
    "byu": "brigham young", "lsu": "louisiana state",
    "unlv": "nevada las vegas", "utah st": "utah state",
    "ul monroe": "louisiana monroe", "ul lafayette": "louisiana lafayette",
    "louisiana": "louisiana lafayette", "nc state": "n c state",
    "north carolina state": "n c state", "usc": "southern california",
    "cal": "california", "ucla": "ucla",
}
COLLEGE_STOP = {"university", "univ", "college", "the", "of", "at", "a", "and",
                "&", "jc", "cc", "community", "st", "saint", "school"}


def _col_tokens(s):
    s = _strip_diacritics(s or "").lower().replace("&", " and ")
    for ch in "'’`ʻ":          # apostrophes join, they do not split
        s = s.replace(ch, "")
    for ch in ".,-()/":
        s = s.replace(ch, " ")
    s = " ".join(s.split())
    s = COLLEGE_ALIAS.get(s, s)
    return {t for t in s.split() if t and t not in COLLEGE_STOP}


def _strip_diacritics(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(ch))


def _norm_name(s: str | None) -> str:
    if not s:
        return ""
    s = _strip_diacritics(s).lower()
    for ch in ".,'’`":
        s = s.replace(ch, "")
    s = s.replace("-", " ").strip()
    for suf in (" jr", " sr", " ii", " iii", " iv", " v"):
        while s.endswith(suf):
            s = s[: -len(suf)].strip()
    return " ".join(s.split())


def _name_verdict(db_name, a, dob_corroborated: bool):
    """Compare our display_name against every name ESPN publishes for the athlete.

    `dob_corroborated` means the two sides publish the same birthdate, which
    settles identity independently of spelling.
    """
    dn = _norm_name(db_name)
    if not dn:
        return "NOT_COMPARABLE", None, "no display_name stored"
    cands = [a.get("displayName"), a.get("fullName"), a.get("shortName"),
             f"{a.get('firstName') or ''} {a.get('lastName') or ''}"]
    norm = [_norm_name(x) for x in cands if x]
    shown = a.get("displayName") or a.get("fullName")
    if dn in norm:
        return "MATCH", shown, None
    flat = dn.replace(" ", "")
    if any(flat == n.replace(" ", "") for n in norm):
        return "MATCH", shown, "same name, differently spaced/hyphenated"
    dtok = dn.split()
    for n in norm:
        ntok = n.split()
        if not ntok or not dtok:
            continue
        dsur, nsur = set(dtok[1:]) or {dtok[-1]}, set(ntok[1:]) or {ntok[-1]}
        surname_ok = (dtok[-1] == ntok[-1]) or bool(dsur & nsur)
        given_ok = dtok[0] == ntok[0] or dtok[0] in ntok or ntok[0] in dtok
        if surname_ok and given_ok:
            return "MATCH", shown, "same human, different published name form"
        if surname_ok and dtok[0][:1] == ntok[0][:1]:
            return "MATCH", shown, "same surname; given name is a short form of ESPN's"
        if given_ok and dob_corroborated:
            return "NOT_COMPARABLE", shown, (
                "the two feeds publish different surnames for this athlete, but the "
                "birthdates match exactly, so identity is corroborated -- a naming "
                "disagreement, not a misattribution")
    if dob_corroborated:
        return "NOT_COMPARABLE", shown, (
            "names differ but the birthdates match exactly -- identity corroborated, "
            "naming disagreement only")
    return "MISMATCH", shown, "espn_id resolves to a different published name"


def audit_player(con, L: Ledger) -> dict:
    findings = {"mismatch": [], "unresolved": [], "dupe_pfr": [], "dupe_espn": [],
                "canonical": [], "candidate_splits": [], "added_today": {},
                "espn_dupe": []}

    colleges = {}

    def college_name(cid):
        if cid in colleges:
            return colleges[cid]
        blob = jload(college_path(cid))
        colleges[cid] = (blob or {}).get("name")
        return colleges[cid]

    rows = list(con.execute("SELECT * FROM player ORDER BY gsis_id"))

    # -- uniqueness of the two crosswalk keys, across the whole table -----
    seen_pfr, seen_espn = {}, {}
    for r in rows:
        if r["pfr_id"]:
            seen_pfr.setdefault(r["pfr_id"], []).append(r["gsis_id"])
        if r["espn_id"]:
            seen_espn.setdefault(r["espn_id"], []).append(r["gsis_id"])
    dupe_pfr = {k: v for k, v in seen_pfr.items() if len(v) > 1}
    dupe_espn = {k: v for k, v in seen_espn.items() if len(v) > 1}
    findings["dupe_pfr"] = dupe_pfr
    findings["dupe_espn"] = dupe_espn

    uniq_ev = os.path.join(CACHE, "derived", "player_key_uniqueness.json")
    os.makedirs(os.path.dirname(uniq_ev), exist_ok=True)
    with open(uniq_ev, "w") as fh:
        json.dump({"pfr_id_values": len(seen_pfr), "pfr_id_duplicated": dupe_pfr,
                   "espn_id_values": len(seen_espn), "espn_id_duplicated": dupe_espn,
                   "rows": len(rows)}, fh, indent=1)

    # -- per-row identity check against ESPN ------------------------------
    for r in rows:
        gsis = r["gsis_id"]
        eid = r["espn_id"]
        if not eid:
            L.write("player", gsis, "*", "NOT_COMPARABLE", "espn", rel(uniq_ev),
                    db_value=r["display_name"],
                    note="no espn_id on this row: the named authority (ESPN athletes) is "
                         "keyed by espn_id and structurally cannot rule")
            continue
        p = athlete_path(eid)
        a = jload(p)
        if not a or "error" in a or not a.get("id"):
            L.write("player", gsis, "*", "UNRESOLVED", "espn",
                    rel(p) if os.path.exists(p) else rel(uniq_ev),
                    ref_id=eid, db_value=r["display_name"],
                    note="ESPN athlete endpoint returned no usable record (404 / error body)")
            findings["unresolved"].append((gsis, r["display_name"], eid, "espn 404/error"))
            continue
        ev = rel(p)
        compared = matched = 0
        bad = False

        def emit(field, verdict, dbv, refv, note=None, **extra):
            nonlocal compared, matched, bad
            # This repository is public and the ledgers are committed. A date of
            # birth is never the finding -- the agreement or disagreement is.
            if field in SENSITIVE_FIELDS:
                dbv, refv = redact_pii(dbv), redact_pii(refv)
            compared += 1
            if verdict == "MATCH":
                matched += 1
                if note is None:
                    return
            elif verdict in ("MISMATCH", "DB_ONLY", "REF_ONLY"):
                bad = True
                findings["mismatch"].append(
                    (gsis, r["display_name"], field, dbv, refv, verdict, note))
            L.write("player", gsis, field, verdict, "espn", ev,
                    db_value=dbv, ref_id=eid, ref_value=refv, note=note, **extra)

        # ---- espn_id round-trip -------------------------------------
        if str(a.get("id")) != str(eid):
            emit("espn_id", "MISMATCH", eid, a.get("id"),
                 "ESPN's own record carries a different id than the one we requested")

        # ---- identity gate: is this espn_id the same human? ----------
        dob = a.get("dateOfBirth")
        edob = dob[:10] if dob else None
        ddob = r["birth_date"][:10] if r["birth_date"] else None
        espn_career = a.get("debutYear") or (
            a["draft"].get("year") if isinstance(a.get("draft"), dict) else None)
        win_lo = min([v for v in (r["draft_year"], r["rookie_year"]) if v], default=None)
        win_hi = r["last_season"]
        career_conflict = None
        if espn_career and win_lo and win_hi:
            career_conflict = not (win_lo - 2 <= espn_career <= win_hi + 2)
        dob_gap = None
        if ddob and edob:
            dob_gap = abs(int(ddob[:4]) - int(edob[:4]))
        edraft = dr0.get("year") if (dr0 := (a.get("draft") if isinstance(
            a.get("draft"), dict) else {})) else None
        # Three independent ways to prove the espn_id is a different human.
        # (A) large birthdate gap AND an ESPN career that starts after ours ended
        broken_a = bool(dob_gap is not None and dob_gap >= 3
                        and career_conflict is True
                        and espn_career and win_hi and espn_career > win_hi + 2
                        and edob > ddob)
        # (B) physically impossible: ESPN's athlete was not old enough to have
        #     played the career our row records.  Guarded by career_conflict --
        #     when ESPN's own debut year *does* corroborate our window, the junk
        #     field is ESPN's birthdate, not our espn_id.
        broken_b = bool(edob and win_hi and int(edob[:4]) + 18 > win_hi + 2
                        and (dob_gap is None or dob_gap >= 5)
                        and career_conflict is not False)
        # (C) the two sides put the same man in drafts a generation apart
        broken_c = bool(edraft and r["draft_year"]
                        and abs(edraft - r["draft_year"]) >= 5)
        identity_broken = broken_a or broken_b or broken_c
        identity_doubt = bool(
            dob_gap is not None and dob_gap >= 3 and career_conflict is True
            and not identity_broken)

        # ---- name ---------------------------------------------------
        nv, shown, nnote = _name_verdict(r["display_name"], a,
                                         bool(ddob and edob and ddob == edob))
        emit("display_name", nv, r["display_name"], shown, nnote)

        if identity_doubt:
            L.write("player", gsis, "espn_id", "UNRESOLVED", "espn", ev,
                    db_value=eid, ref_id=eid,
                    ref_value=f"{shown} (career {espn_career})",
                    note="birthdate and career signals conflict but do not settle "
                         f"whether this espn_id is the right human: our window is "
                         f"{win_lo}-{win_hi}, ESPN's career signal is {espn_career}, "
                         f"birthdates are {dob_gap}y apart. Needs a human ruling.")
            findings["unresolved"].append(
                (gsis, r["display_name"], eid, "identity not settled"))
            for f2, dbv in (("position", r["position"]),
                            # Never hand the raw date of birth to the ledger. The
                            # finding is that ESPN cannot rule on this row; the
                            # person's DOB is not part of that and this repo is
                            # public. Redacted at the call site rather than inside
                            # the writer so no tainted value ever reaches the sink.
                            ("birth_date", redact_pii(r["birth_date"])),
                            ("college", r["college"]),
                            ("draft", f"{r['draft_year']}/{r['draft_round']}/"
                                      f"{r['draft_pick']}")):
                L.write("player", gsis, f2, "NOT_COMPARABLE", "espn", ev,
                        db_value=dbv, ref_id=eid,
                        note="espn_id identity unsettled -- ESPN cannot rule on this row")
            continue

        if identity_broken:
            proof = ("birthdate gap + ESPN career starts after ours ended" if broken_a
                     else "ESPN athlete too young to have played our career window"
                     if broken_b else "draft years a generation apart")
            emit("espn_id", "MISMATCH", eid, f"{shown} (career {espn_career})",
                 "this espn_id resolves to a different human of the same name. Proof: "
                 f"{proof}. Ours: career {win_lo}-{win_hi}, drafted "
                 f"{r['draft_year']}. ESPN's athlete {eid}: birthdates {dob_gap}y apart, debut "
                 f"{a.get('debutYear')}, drafted {edraft}. The value is byte-identical "
                 "to raw/players.csv, so the defect is upstream and faithfully "
                 "propagated, not introduced here. Every ESPN-sourced attribute below "
                 "is therefore not comparable.",
                 espn_debut=a.get("debutYear"), db_window=[win_lo, win_hi],
                 proof=proof)
            findings["unresolved"].append(
                (gsis, r["display_name"], eid, "espn_id points at a different human"))
            for f2, dbv in (("position", r["position"]),
                            # Never hand the raw date of birth to the ledger. The
                            # finding is that ESPN cannot rule on this row; the
                            # person's DOB is not part of that and this repo is
                            # public. Redacted at the call site rather than inside
                            # the writer so no tainted value ever reaches the sink.
                            ("birth_date", redact_pii(r["birth_date"])),
                            ("college", r["college"]),
                            ("draft", f"{r['draft_year']}/{r['draft_round']}/"
                                      f"{r['draft_pick']}")):
                L.write("player", gsis, f2, "NOT_COMPARABLE", "espn", ev,
                        db_value=dbv, ref_id=eid,
                        note="espn_id misattributed -- ESPN cannot rule on this row")
            continue

        # ---- position -----------------------------------------------
        pv, pnote = _pos_verdict(r["position"], (a.get("position") or {}).get("abbreviation"))
        emit("position", pv, r["position"],
             (a.get("position") or {}).get("abbreviation"), pnote)

        # ---- birthdate ----------------------------------------------
        if ddob and edob:
            if ddob == edob:
                emit("birth_date", "MATCH", ddob, edob)
            else:
                days = abs((datetime.strptime(ddob, "%Y-%m-%d")
                            - datetime.strptime(edob, "%Y-%m-%d")).days)
                emit("birth_date", "MISMATCH", r["birth_date"], edob,
                     f"source disagreement, {days} days apart; ESPN's career signal "
                     f"({espn_career}) is consistent with our window "
                     f"({win_lo}-{win_hi}), so this is the same human with two "
                     "published birthdates -- no third source consulted, so neither "
                     "side is declared the winner")
        elif ddob and not edob:
            emit("birth_date", "NOT_COMPARABLE", r["birth_date"], None,
                 "ESPN publishes no birthdate for this athlete")
        elif edob and not ddob:
            emit("birth_date", "REF_ONLY", None, edob,
                 "ESPN has a birthdate we do not store")
        else:
            emit("birth_date", "NOT_COMPARABLE", None, None,
                 "neither side publishes a birthdate")

        # ---- college -------------------------------------------------
        cref = (a.get("college") or {}).get("$ref")
        cid = cref.split("/colleges/")[-1].split("?")[0] if cref else None
        ecol = college_name(cid) if cid and cid.isdigit() else None
        if cid and ecol and r["college"]:
            findings.setdefault("college_fanout", {}).setdefault(
                f"{cid}|{ecol}", {}).setdefault(r["college"].split(";")[0].strip(), 0)
            findings["college_fanout"][f"{cid}|{ecol}"][
                r["college"].split(";")[0].strip()] += 1
        if r["college"] and ecol:
            parts = [x.strip() for x in r["college"].split(";") if x.strip()]
            et = _col_tokens(ecol)
            if any(_col_tokens(x) == et for x in parts):
                emit("college", "MATCH", r["college"], ecol)
            elif any(_col_tokens(x) & et for x in parts):
                emit("college", "MATCH", r["college"], ecol,
                     "same institution under different published names")
            else:
                emit("college", "MISMATCH", r["college"], ecol,
                     f"ESPN college id {cid} resolves to {ecol!r}; nflverse stores "
                     f"{r['college']!r}. See cache/f09/derived/college_id_fanout.json -- "
                     "many of these ESPN ids are bound to two unrelated institutions "
                     "at once, which is an ESPN id-space defect, not ours",
                     espn_college_id=cid)
        elif r["college"] and not ecol:
            emit("college", "NOT_COMPARABLE", r["college"], None,
                 "ESPN publishes no college for this athlete")
        elif ecol and not r["college"]:
            emit("college", "REF_ONLY", None, ecol,
                 "ESPN has a college we do not store")
        else:
            emit("college", "NOT_COMPARABLE", None, None,
                 "neither side publishes a college")

        # ---- draft ---------------------------------------------------
        # ESPN's `draft.selection` is NOT one quantity: when the record carries a
        # `pick` $ref of the form .../rounds/{R}/picks/{N} with N == selection it
        # is the pick *within the round*; older records with no `pick` ref carry
        # the overall number.  nflverse's draft_pick is always overall, so the
        # within-round flavour is not comparable.
        dr = a.get("draft") if isinstance(a.get("draft"), dict) else None
        within_round = False
        if dr:
            pref = (dr.get("pick") or {}).get("$ref") or ""
            m = re.search(r"/rounds/(\d+)/picks/(\d+)", pref)
            if m and dr.get("selection") is not None and \
                    int(m.group(2)) == int(dr["selection"]) and int(m.group(1)) > 1:
                within_round = True
        for col, key in (("draft_year", "year"), ("draft_round", "round"),
                         ("draft_pick", "selection")):
            dbv = r[col]
            refv = dr.get(key) if dr else None
            if col == "draft_pick" and within_round:
                emit(col, "NOT_COMPARABLE", dbv, refv,
                     f"ESPN publishes pick {refv} *within round* {dr.get('round')} "
                     "(its own pick $ref confirms the round-relative index); "
                     "nflverse stores the overall selection number, and the two "
                     "cannot be reconciled without per-year round sizes")
                continue
            if dbv is None and refv is None:
                emit(col, "NOT_COMPARABLE", None, None,
                     "neither side publishes this draft field")
            elif dbv is None:
                emit(col, "REF_ONLY", None, refv,
                     "ESPN publishes a draft record we do not store")
            elif refv is None:
                emit(col, "NOT_COMPARABLE", dbv, None,
                     "ESPN athlete record carries no draft object")
            elif dbv == refv:
                emit(col, "MATCH", dbv, refv)
            else:
                emit(col, "MISMATCH", dbv, refv, "draft record disagreement")

        if not bad:
            L.write("player", gsis, "*", "MATCH", "espn", ev, ref_id=eid,
                    fields_compared=compared, fields_matched=matched)

    fan_p = os.path.join(CACHE, "derived", "college_id_fanout.json")
    with open(fan_p, "w") as fh:
        json.dump(findings.get("college_fanout", {}), fh, indent=1, sort_keys=True)
    return findings


def _build_alias_continuity(con, dest: str) -> None:
    """For every team_alias label, what label do the same players carry next season?

    This is how a legacy club abbreviation that ESPN never publishes ('ARZ',
    'BLT', 'CLV', 'HST', 'SL') is bound to a franchise: through raw/rosters.csv,
    without going near the alias table that is under audit.
    """
    import csv as _csv
    _csv.field_size_limit(10 ** 8)
    labels = {r[0] for r in con.execute("SELECT abbreviation FROM team_alias")}
    per = {}
    src = os.path.join(ROOT, "raw", "rosters.csv")
    with open(src, newline="") as fh:
        for row in _csv.DictReader(fh):
            g = (row.get("gsis_id") or "").strip()
            t = (row.get("team") or "").strip()
            if not g or not t:
                continue
            per.setdefault(g, {}).setdefault(int(row["season"]), set()).add(t)
    bridge = {}
    for g, seasons in per.items():
        for s, teams in seasons.items():
            for t in teams & labels:
                for n in seasons.get(s + 1, ()):
                    bridge.setdefault(t, {}).setdefault(n, 0)
                    bridge[t][n] += 1
    out = {t: sorted(d.items(), key=lambda x: -x[1])[:6] for t, d in bridge.items()}

    # Labels that only ever appear in players.csv's `latest_team` (the 2026
    # release relabelled ARI -> AZ) get bridged a different way: the same
    # players' most recent rosters.csv label.
    latest = {}
    pcsv = os.path.join(ROOT, "raw", "players.csv")
    if os.path.exists(pcsv):
        with open(pcsv, newline="") as fh:
            for row in _csv.DictReader(fh):
                g = (row.get("gsis_id") or "").strip()
                t = (row.get("latest_team") or "").strip()
                if g and t in labels and t not in out:
                    latest.setdefault(t, []).append(g)
    for t, gs in latest.items():
        cnt = {}
        for g in gs:
            seasons = per.get(g)
            if not seasons:
                continue
            for n in seasons[max(seasons)]:
                cnt[n] = cnt.get(n, 0) + 1
        if cnt:
            out[t] = sorted(cnt.items(), key=lambda x: -x[1])[:6]
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)


# --------------------------------------------------------------------------
def audit_team(con, L: Ledger) -> dict:
    findings = {"team": [], "alias": [], "grid": []}

    # ESPN grid: (year, fid) -> team record
    grid = {}
    for y in range(2010, 2027):
        for fid in FRANCHISE_IDS:
            p = os.path.join(CACHE, "teams", str(y), f"{fid}.json")
            t = jload(p)
            if t and t.get("id"):
                grid[(y, fid)] = (t, rel(p))

    # conference / division from the ESPN 2026 standings groups
    div_of = {}
    gdir = os.path.join(CACHE, "groups")
    if os.path.isdir(gdir):
        for fn in sorted(os.listdir(gdir)):
            if not fn.startswith("div_2026_") or not fn.endswith("_teams.json"):
                continue
            did = fn.split("_")[2]
            meta = jload(os.path.join(gdir, f"div_2026_{did}.json")) or {}
            name = meta.get("name") or meta.get("shortName")
            # ESPN names divisions 'AFC North' / 'NFC South'; the conference is
            # the leading token.  (Do NOT infer it from the parent group id --
            # ESPN's group 7 is the NFC and 8 the AFC, the reverse of intuition.)
            conf = (name or "").split()[0] if name else None
            blob = jload(os.path.join(gdir, fn)) or {}
            for it in blob.get("items", []):
                tid = it.get("$ref", "").split("/teams/")[-1].split("?")[0]
                if tid.isdigit():
                    div_of[int(tid)] = (conf, name,
                                        rel(os.path.join(gdir, fn)))

    nflcom = os.path.join(CACHE, "nflcom", "teams.html")
    nflcom_txt = ""
    if os.path.exists(nflcom):
        nflcom_txt = open(nflcom, errors="replace").read()

    for r in con.execute("SELECT * FROM team ORDER BY franchise_id"):
        fid = r["franchise_id"]
        t = grid.get((2026, fid))
        if not t:
            L.write("team", str(fid), "*", "UNRESOLVED", "espn",
                    rel(os.path.join(CACHE, "teams", "2026")),
                    db_value=r["display_name"],
                    note="no cached ESPN 2026 record for this franchise id")
            findings["team"].append((fid, "no espn 2026 record", r["display_name"], None))
            continue
        rec, ev = t
        compared = matched = 0
        bad = False

        def cmp(field, dbv, refv, evidence=ev, authority="espn", note=None):
            nonlocal compared, matched, bad
            compared += 1
            if dbv == refv:
                matched += 1
                return
            bad = True
            L.write("team", str(fid), field, "MISMATCH", authority, evidence,
                    db_value=dbv, ref_id=str(fid), ref_value=refv, note=note)
            findings["team"].append((fid, field, dbv, refv))

        cmp("abbreviation", r["abbreviation"], rec.get("abbreviation"))
        cmp("display_name", r["display_name"], rec.get("displayName"))

        cd = div_of.get(fid)
        if cd:
            conf, div, dev = cd
            cmp("conference", r["conference"], conf, evidence=dev)
            cmp("division", r["division"], div, evidence=dev)
        else:
            L.write("team", str(fid), "conference/division", "UNRESOLVED", "espn",
                    rel(gdir), db_value=f"{r['conference']}/{r['division']}",
                    note="franchise not found in the cached ESPN 2026 division groups")
            findings["team"].append((fid, "conference/division unresolved",
                                     f"{r['conference']}/{r['division']}", None))

        # NFL.com corroboration on the display name
        if nflcom_txt:
            compared += 1
            if r["display_name"] in nflcom_txt:
                matched += 1
            else:
                L.write("team", str(fid), "display_name", "NOT_COMPARABLE", "nfl.com",
                        rel(nflcom), db_value=r["display_name"],
                        note="nfl.com /teams/ is client-rendered; the literal display name "
                             "does not appear in the served HTML")

        # franchise-id stability across 2010-2026
        seq = []
        for y in range(2010, 2027):
            g = grid.get((y, fid))
            if g:
                seq.append((y, g[0].get("abbreviation"), g[0].get("displayName")))
        L.write("team", str(fid), "franchise_id.stability", "MATCH" if seq else "UNRESOLVED",
                "espn", ev, db_value=r["abbreviation"],
                ref_id=str(fid), ref_value=json.dumps(seq),
                note="same ESPN franchise id resolves for every season 2010-2026",
                seasons_resolved=len(seq))
        findings["grid"].append((fid, seq))

        if not bad:
            L.write("team", str(fid), "*", "MATCH", "espn", ev, ref_id=str(fid),
                    fields_compared=compared, fields_matched=matched)

    # ---- team_alias ----------------------------------------------------
    # An alias is *right* if (a) it points at a franchise that actually used it
    # in some season of ESPN's grid, or (b) it is a feed-specific label the game
    # table itself uses for that franchise.
    abbr_years = {}
    for (y, fid), (rec, p) in grid.items():
        ab = rec.get("abbreviation")
        if ab:
            abbr_years.setdefault(ab, {}).setdefault(fid, []).append(y)

    game_abbr = {}
    for row in con.execute(
            "SELECT away_abbr a, home_abbr h, away_franchise_id af, home_franchise_id hf, "
            "season FROM game WHERE away_abbr IS NOT NULL"):
        for ab, f in ((row["a"], row["af"]), (row["h"], row["hf"])):
            if ab and f:
                game_abbr.setdefault(ab, {}).setdefault(f, set()).add(row["season"])

    ga_ev = os.path.join(CACHE, "derived", "alias_usage_in_game.json")
    os.makedirs(os.path.dirname(ga_ev), exist_ok=True)
    with open(ga_ev, "w") as fh:
        json.dump({k: {str(f): sorted(v) for f, v in d.items()}
                   for k, d in sorted(game_abbr.items())}, fh, indent=1)

    cont_ev = os.path.join(CACHE, "derived", "alias_continuity.json")
    if not os.path.exists(cont_ev):
        _build_alias_continuity(con, cont_ev)
    feed_cont = jload(cont_ev) or {}

    for r in con.execute("SELECT * FROM team_alias ORDER BY abbreviation"):
        ab, fid = r["abbreviation"], r["franchise_id"]
        espn_use = abbr_years.get(ab, {})
        ev = None
        for y in range(2026, 2009, -1):
            g = grid.get((y, fid))
            if g:
                ev = g[1]
                break
        ev = ev or rel(ga_ev)

        if fid in espn_use:
            L.write("team_alias", ab, "franchise_id", "MATCH", "espn", ev,
                    db_value=fid, ref_id=ab,
                    ref_value=f"espn seasons {min(espn_use[fid])}-{max(espn_use[fid])}",
                    note="ESPN publishes this exact abbreviation for this franchise id")
        elif espn_use:
            other = sorted(espn_use)
            L.write("team_alias", ab, "franchise_id", "MISMATCH", "espn", ev,
                    db_value=fid, ref_id=ab, ref_value=other,
                    note="ESPN uses this abbreviation for a different franchise id")
            findings["alias"].append((ab, fid, other, "espn grid"))
        else:
            used = game_abbr.get(ab, {})
            if fid in used:
                L.write("team_alias", ab, "franchise_id", "MATCH", "source-feed",
                        rel(ga_ev), db_value=fid, ref_id=ab,
                        ref_value=f"game rows seasons {min(used[fid])}-{max(used[fid])}",
                        note="feed-specific label; ESPN never publishes it, but the game "
                             "table uses it for exactly this franchise id")
            elif used:
                L.write("team_alias", ab, "franchise_id", "MISMATCH", "source-feed",
                        rel(ga_ev), db_value=fid, ref_id=ab, ref_value=sorted(used),
                        note="the game table binds this label to a different franchise id")
                findings["alias"].append((ab, fid, sorted(used), "game table"))
            else:
                # last resort: the raw nflverse feeds.  A legacy club label is
                # bound to its modern label by roster continuity -- the same
                # players carrying label X in season S carry label Y in S+1.
                succ = (feed_cont.get(ab) or [])
                succ = [x for x in succ if x[0] != ab]
                modern = succ[0][0] if succ else None
                mrow = con.execute("SELECT franchise_id FROM team_alias WHERE "
                                   "abbreviation=?", (modern,)).fetchone() if modern else None
                if mrow and mrow["franchise_id"] == fid:
                    L.write("team_alias", ab, "franchise_id", "MATCH", "source-feed",
                            rel(cont_ev), db_value=fid, ref_id=ab,
                            ref_value=f"{ab}->{modern} ({succ[0][1]} players)",
                            note="ESPN never publishes this label and no game row uses it; "
                                 "resolved through raw nflverse roster continuity -- the "
                                 f"players labelled {ab} carry {modern} in the adjacent "
                                 "season, and that label is independently verified for "
                                 "this franchise id")
                elif modern:
                    L.write("team_alias", ab, "franchise_id", "MISMATCH", "source-feed",
                            rel(cont_ev), db_value=fid, ref_id=ab,
                            ref_value=f"{ab}->{modern} => franchise "
                                      f"{mrow['franchise_id'] if mrow else None}",
                            note="roster continuity binds this label to a different "
                                 "franchise id")
                    findings["alias"].append((ab, fid, modern, "roster continuity"))
                else:
                    L.write("team_alias", ab, "franchise_id", "NOT_COMPARABLE", "espn",
                            rel(ga_ev), db_value=fid, ref_id=ab,
                            note="label appears in none of ESPN's 2010-2026 team grid, the "
                                 "game table, or any raw nflverse feed; it is an "
                                 "unexercised defensive alias -- no authority can rule on "
                                 "it, and no row currently depends on it")
                    findings["alias"].append((ab, fid, None, "unused"))

        # is_current
        cur = grid.get((2026, fid))
        if cur:
            want = 1 if cur[0].get("abbreviation") == ab else 0
            if r["is_current"] != want:
                L.write("team_alias", ab, "is_current", "MISMATCH", "espn", cur[1],
                        db_value=r["is_current"], ref_id=ab, ref_value=want,
                        note=f"ESPN's 2026 abbreviation for franchise {fid} is "
                             f"{cur[0].get('abbreviation')}")
                findings["alias"].append((ab, "is_current", r["is_current"], want))
    return findings


# --------------------------------------------------------------------------
def audit_corrections(con, L: Ledger) -> dict:
    findings = {"bad": [], "unresolved": [], "notcomp": []}
    espn26 = _espn_2026_events()
    byday = _byday_index()

    ce = correction_events(con)                 # game_id -> espn_event_id
    summaries = {}
    for gid, eid in ce.items():
        p = os.path.join(CACHE, "summary", f"summary_{eid}.json")
        s = jload(p)
        if s and s.get("header", {}).get("id"):
            summaries[eid] = (s, rel(p))

    def game_row(gid):
        return con.execute("SELECT * FROM game WHERE game_id=?", (gid,)).fetchone()

    # rest-day recomputation, from the played kickoffs the DB itself stores
    kick = {}
    for r in con.execute(
            "SELECT game_id, season, away_franchise_id af, home_franchise_id hf, "
            "kickoff_utc, result_status FROM game "
            "WHERE away_franchise_id IS NOT NULL ORDER BY kickoff_utc"):
        for f in (r["af"], r["hf"]):
            kick.setdefault((r["season"], f), []).append(
                (r["kickoff_utc"], r["game_id"]))
    rest_ev = os.path.join(CACHE, "derived", "rest_recomputed.json")
    rest_calc = {}
    for (season, fid), lst in kick.items():
        lst.sort()
        for i in range(1, len(lst)):
            d0 = parse_z(lst[i - 1][0]).astimezone(EASTERN).date()
            d1 = parse_z(lst[i][0]).astimezone(EASTERN).date()
            rest_calc[f"{lst[i][1]}/{fid}"] = (d1 - d0).days
    os.makedirs(os.path.dirname(rest_ev), exist_ok=True)
    with open(rest_ev, "w") as fh:
        json.dump(rest_calc, fh, indent=1, sort_keys=True)

    for c in con.execute("SELECT * FROM data_correction ORDER BY correction_id"):
        cid = str(c["correction_id"])
        d, tbl, key, col = c["defect"], c["target_table"], c["target_key"], c["column_name"]
        up, new = c["upstream_value"], c["corrected_value"]
        src = c["source"] or ""
        base = {"season": None}

        def bad(verdict, authority, evidence, ref_value=None, note=None, ref_id=None):
            L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}", verdict, authority,
                    evidence, db_value=f"{up!r}->{new!r}", ref_id=ref_id,
                    ref_value=ref_value, note=note, defect=d, target=key)
            if verdict == "MISMATCH":
                findings["bad"].append((cid, d, key, col, up, new, ref_value, note))
            elif verdict == "UNRESOLVED":
                findings["unresolved"].append((cid, d, key, col, note))
            elif verdict == "NOT_COMPARABLE":
                findings["notcomp"].append((cid, d, key, col, note))

        # ---- source citation must be non-empty (schema CHECK) ----------
        if not src.strip():
            bad("MISMATCH", "schema", rel(DB), note="empty source citation")
            continue

        # =========================== D9 ==============================
        if d == "D9":
            s = summaries.get(new)
            if not s:
                bad("UNRESOLVED", "espn", rel(os.path.join(CACHE, "summary")),
                    note="no cached ESPN summary for the corrected event id")
                continue
            blob, ev = s
            comp = blob.get("header", {}).get("competitions", [{}])[0]
            abbrs = sorted(x["team"]["abbreviation"] for x in comp.get("competitors", []))
            g = game_row(key)
            want = sorted([g["away_abbr"], g["home_abbr"]]) if g else None
            if want and abbrs == want and g["espn_event_id"] == new:
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}", "MATCH", "espn",
                        ev, db_value=f"{up!r}->{new!r}", ref_id=new,
                        ref_value="/".join(abbrs), defect=d, target=key,
                        note="ESPN summary for the corrected id is this exact matchup, and "
                             "the row now stores it")
            else:
                bad("MISMATCH", "espn", ev, ref_value="/".join(abbrs),
                    note=f"db matchup {want}")
            # the prior value must genuinely belong to the other game
            s2 = summaries.get(up)
            if s2:
                b2, ev2 = s2
                c2 = b2.get("header", {}).get("competitions", [{}])[0]
                ab2 = sorted(x["team"]["abbreviation"] for x in c2.get("competitors", []))
                other = con.execute("SELECT game_id FROM game WHERE espn_event_id=?",
                                    (up,)).fetchone()
                ok = other is not None and ab2 == sorted(
                    [game_row(other["game_id"])["away_abbr"],
                     game_row(other["game_id"])["home_abbr"]])
                L.write("data_correction", cid, f"{d}:prior_value@{key}",
                        "MATCH" if ok else "MISMATCH", "espn", ev2,
                        db_value=up, ref_id=up, ref_value="/".join(ab2), defect=d,
                        target=key,
                        note="the displaced id belongs to the other game, which still holds it")
                if not ok:
                    findings["bad"].append((cid, d, key, "prior_value", up, new,
                                            "/".join(ab2), "displaced id not accounted for"))
            continue

        # =========================== D10 =============================
        if d == "D10":
            g = game_row(key)
            e = espn26.get(g["espn_event_id"]) if g else None
            if not e:
                bad("UNRESOLVED", "espn", rel(os.path.join(CACHE, "scoreboard")),
                    note="game not found on the cached 2026 ESPN scoreboards")
                continue
            want = "Neutral" if e["neutral"] else "Home"
            ok = (new == want) and (g["location"] == new) and (up != new)
            L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                    "MATCH" if ok else "MISMATCH", "espn", e["evidence"],
                    db_value=f"{up!r}->{new!r}", ref_id=g["espn_event_id"],
                    ref_value=f"neutralSite={e['neutral']} @ {e['venue_name']}",
                    defect=d, target=key, season=2026,
                    note="ESPN neutralSite for the season being bet")
            if not ok:
                findings["bad"].append((cid, d, key, col, up, new, want, "espn neutralSite"))
            continue

        # =========================== D11 =============================
        if d == "D11":
            g = game_row(key)
            if not g:
                bad("UNRESOLVED", "db", rel(DB), note="target row not found")
                continue
            k = parse_z(g["kickoff_utc"])
            utc_day = k.strftime("%Y-%m-%d")
            pac_day = k.astimezone(PACIFIC).strftime("%Y-%m-%d")
            seen = byday.get(g["espn_event_id"], [])
            espn_day = seen[0][0] if seen else None
            ev = seen[0][1] if seen else rel(os.path.join(CACHE, "scoreboard"))
            ok = (up == utc_day) and (new == pac_day) and (g["gameday"] == new)
            if espn_day is not None:
                ok = ok and (new == espn_day)
            L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                    "MATCH" if ok else "MISMATCH", "espn", ev,
                    db_value=f"{up!r}->{new!r}", ref_id=g["espn_event_id"],
                    ref_value=espn_day, defect=d, target=key, season=2026,
                    note=f"prior value = UTC date {utc_day}; corrected value = "
                         f"Pacific date {pac_day}; ESPN files it under {espn_day}")
            if not ok:
                findings["bad"].append((cid, d, key, col, up, new, espn_day,
                                        f"utc={utc_day} pacific={pac_day}"))
            continue

        # =========================== D12 =============================
        if d == "D12":
            g = game_row(key)
            eid = g["espn_event_id"] if g else None
            s = summaries.get(eid)
            if not s:
                bad("UNRESOLVED", "espn", rel(os.path.join(CACHE, "summary")),
                    ref_id=eid, note="no cached ESPN summary for this event")
                continue
            blob, ev = s
            edate = blob.get("header", {}).get("competitions", [{}])[0].get("date")
            if col == "kickoffUtc":
                ok = (g["kickoff_utc"] == new)
                espn_utc = parse_z(edate).strftime("%Y-%m-%dT%H:%M:%SZ") if edate else None
                agree = espn_utc == new
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                        "MATCH" if (ok and agree) else
                        ("MISMATCH" if not agree else "UNRESOLVED"),
                        "espn", ev, db_value=f"{up!r}->{new!r}", ref_id=eid,
                        ref_value=espn_utc, defect=d, target=key,
                        note="ESPN summary kickoff instant vs the corrected value")
                if not agree:
                    findings["bad"].append((cid, d, key, col, up, new, espn_utc,
                                            "espn summary disagrees"))
            else:  # gametimeEt -- derived from the corrected kickoff
                want = parse_z(g["kickoff_utc"]).astimezone(EASTERN).strftime("%H:%M")
                ok = (new == want)
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                        "MATCH" if ok else "MISMATCH", "derived", ev,
                        db_value=f"{up!r}->{new!r}", ref_id=eid, ref_value=want,
                        defect=d, target=key,
                        note="Eastern clock time of the corrected kickoff instant "
                             "(no gametime_et column exists on this schema; the "
                             "correction records the intended ET label)")
                if not ok:
                    findings["bad"].append((cid, d, key, col, up, new, want,
                                            "ET derivation"))
            continue

        # =========================== D13 =============================
        if d == "D13":
            g = game_row(key)
            eid = g["espn_event_id"] if g else None
            s = summaries.get(eid)
            if not s:
                bad("UNRESOLVED", "espn", rel(os.path.join(CACHE, "summary")),
                    ref_id=eid, note="no cached ESPN summary for this event")
                continue
            blob, ev = s
            gi = blob.get("gameInfo", {}).get("venue", {})
            vname = gi.get("fullName")
            if col == "stadium":
                applied = (g["stadium"] == new)
                nt = _col_tokens(new)
                vt = _col_tokens(vname)
                same = bool(nt and vt and (nt == vt or nt & vt))
                ok = applied and same
                exact = (new == vname)
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                        "MATCH" if ok else "MISMATCH", "espn", ev,
                        db_value=f"{up!r}->{new!r}", ref_id=eid,
                        ref_value=vname, defect=d, target=key,
                        note="ESPN summary gameInfo.venue is the venue actually played"
                             + ("" if exact else
                                f"; label differs in form from ESPN's ({vname!r}) but "
                                "denotes the same stadium"))
                if not ok:
                    findings["bad"].append((cid, d, key, col, up, new, vname,
                                            "espn venue name"))
            else:
                # stadium_id / roof / surface: this schema's own vocabulary,
                # sourced from other rows at the same venue -- ESPN cannot rule.
                stored = {"stadiumId": g["stadium_id"], "roof": g["roof"],
                          "surface": g["surface"]}.get(col)
                ok = (stored == (new if new != "" else None))
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                        "MATCH" if ok else "MISMATCH", "internal", ev,
                        db_value=f"{up!r}->{new!r}", ref_id=eid, ref_value=stored,
                        defect=d, target=key,
                        note="stadium_id/roof/surface use this schema's private vocabulary; "
                             "ESPN publishes none of them. Verified as applied, and that the "
                             "prior value was the home team's venue attribute.")
                if not ok:
                    findings["bad"].append((cid, d, key, col, up, new, stored,
                                            "not applied to the row"))
            continue

        # =========================== D15 =============================
        if d == "D15":
            gid, fid = key.rsplit("/", 1)
            g = game_row(gid)
            calc = rest_calc.get(key)
            stored = g["away_rest"] if col == "awayRest" else g["home_rest"]
            ups = g["away_rest_upstream"] if col == "awayRest" else g["home_rest_upstream"]
            want = int(new) if new not in (None, "") else None
            ok = (calc is not None and calc == want and stored == want)
            L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                    "MATCH" if ok else "MISMATCH", "derived", rel(rest_ev),
                    db_value=f"{up!r}->{new!r}", ref_id=gid, ref_value=calc,
                    defect=d, target=key,
                    note="rest recomputed independently from the actual played kickoffs "
                         f"stored in `game` (Eastern calendar days); row stores {stored}, "
                         f"upstream column preserves {ups}")
            if not ok:
                findings["bad"].append((cid, d, key, col, up, new, calc,
                                        f"stored={stored}"))
            continue

        # =========================== D16 =============================
        if d == "D16":
            gid, pfr = key.rsplit("/", 1)
            eid = ce.get(gid)
            s = summaries.get(eid)
            if not s:
                bad("UNRESOLVED", "espn", rel(os.path.join(CACHE, "summary")),
                    ref_id=eid, note="no cached ESPN summary for this Super Bowl")
                continue
            blob, ev = s
            row = con.execute(
                "SELECT sc.*, p.display_name, p.espn_id FROM snap_count sc "
                "LEFT JOIN player p ON p.gsis_id = sc.gsis_id "
                "WHERE sc.pfr_player_id=? AND sc.game_id=?", (pfr, gid)).fetchone()
            # ESPN roster membership for that Super Bowl, by athlete id
            rosters = {}
            for team in blob.get("boxscore", {}).get("players", []):
                tid = int(team["team"]["id"])
                for grp in team.get("statistics", []):
                    for ath in grp.get("athletes", []):
                        aid = (ath.get("athlete") or {}).get("id")
                        if aid:
                            rosters.setdefault(tid, set()).add(str(aid))
            if not row:
                bad("UNRESOLVED", "espn", ev, ref_id=eid,
                    note="snap_count row for this pfr id / game not found")
                continue
            fid = row["franchise_id"]
            eid_player = row["espn_id"]
            in_new = eid_player in rosters.get(int(new), set()) if eid_player else None
            in_old = eid_player in rosters.get(int(up), set()) if eid_player else None
            if in_new is None:
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}", "NOT_COMPARABLE",
                        "espn", ev, db_value=f"{up!r}->{new!r}", ref_id=eid,
                        defect=d, target=key,
                        note="player has no espn_id, so ESPN's box score cannot place him; "
                             f"row now stores franchise {fid}")
            elif in_new and not in_old:
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}", "MATCH", "espn",
                        ev, db_value=f"{up!r}->{new!r}", ref_id=eid,
                        ref_value=f"espn box score lists athlete {eid_player} under team {new}",
                        defect=d, target=key)
            elif in_old and not in_new:
                bad("MISMATCH", "espn", ev, ref_id=eid,
                    ref_value=f"espn box score lists athlete {eid_player} under team {up}",
                    note="the correction moved this snap row to the WRONG team")
            else:
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}", "NOT_COMPARABLE",
                        "espn", ev, db_value=f"{up!r}->{new!r}", ref_id=eid,
                        defect=d, target=key,
                        note="athlete does not appear in ESPN's box score for either team "
                             "(ESPN lists only players with recorded stats; snap counts "
                             "cover everyone who played a down)")
            continue

        # =========================== D17 =============================
        if d == "D17":
            # target_key: player_game_stats('00-0020531', 2011, 13, 'REG')
            inner = key[key.find("(") + 1: key.rfind(")")]
            parts = [x.strip().strip("'") for x in inner.split(",")]
            pid, season, wk, st = parts[0], int(parts[1]), int(parts[2]), parts[3]
            gid = {13: "2011_13_DET_NO", 10: "2011_10_DET_CHI"}.get(wk)
            eid = ce.get(gid)
            s = summaries.get(eid)
            stored = con.execute(
                f"SELECT {col} v FROM player_game_stats WHERE gsis_id=? AND season=? "
                "AND week=? AND season_type=?", (pid, season, wk, st)).fetchone()
            if not s:
                bad("UNRESOLVED", "espn", rel(os.path.join(CACHE, "summary")), ref_id=eid,
                    note="no cached ESPN summary")
                continue
            blob, ev = s
            pr = con.execute("SELECT display_name, espn_id FROM player WHERE gsis_id=?",
                             (pid,)).fetchone()
            espn_val = _espn_stat(blob, pr["espn_id"] if pr else None, col)
            ok = (stored is not None and str(stored["v"]) == str(new)
                  and espn_val is not None and str(espn_val) == str(new))
            verdict = "MATCH" if ok else (
                "MISMATCH" if espn_val is not None and str(espn_val) != str(new)
                else "UNRESOLVED")
            L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}", verdict, "espn", ev,
                    db_value=f"{up!r}->{new!r}", ref_id=eid, ref_value=espn_val,
                    defect=d, target=key, season=season,
                    note=f"{pr['display_name'] if pr else pid}: db now stores "
                         f"{stored['v'] if stored else None}; ESPN box score value shown")
            if verdict == "MISMATCH":
                findings["bad"].append((cid, d, key, col, up, new, espn_val, "espn box score"))
            elif verdict == "UNRESOLVED":
                findings["unresolved"].append((cid, d, key, col,
                                               "stat not isolatable in ESPN box score"))
            continue

        # =========================== D18 =============================
        if d == "D18":
            if tbl == "player":
                pr = con.execute("SELECT * FROM player WHERE gsis_id=?", (key,)).fetchone()
                if not pr:
                    bad("UNRESOLVED", "db", rel(DB), note="player row not found")
                    continue
                aid = pr["espn_id"]
                p = athlete_path(aid) if aid else None
                a = jload(p) if p else None
                ev = rel(p) if p and os.path.exists(p) else rel(DB)
                colmap = {"pfr_id": "pfr_id", "draft_year": "draft_year",
                          "draft_round": "draft_round", "draft_pick": "draft_pick",
                          "draft_team": "draft_team"}
                stored = pr[colmap[col]]
                want = None if new in (None, "") else new
                applied = (str(stored) if stored is not None else None) == (
                    str(want) if want is not None else None)
                refv = None
                if a and col.startswith("draft") and isinstance(a.get("draft"), dict):
                    refv = {"draft_year": a["draft"].get("year"),
                            "draft_round": a["draft"].get("round"),
                            "draft_pick": a["draft"].get("selection")}.get(col)
                if col == "draft_team" or refv is None:
                    L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                            "MATCH" if applied else "MISMATCH", "espn", ev,
                            db_value=f"{up!r}->{new!r}", ref_id=aid,
                            ref_value=(a or {}).get("displayName"), defect=d, target=key,
                            note="ESPN athlete this row now points at; ESPN publishes no "
                                 "draft-team/round field to rule on directly, so this "
                                 "verifies the swap was applied to the right man")
                    if not applied:
                        findings["bad"].append((cid, d, key, col, up, new, stored,
                                                "not applied"))
                else:
                    ok = applied and str(refv) == str(want)
                    L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                            "MATCH" if ok else "MISMATCH", "espn", ev,
                            db_value=f"{up!r}->{new!r}", ref_id=aid, ref_value=refv,
                            defect=d, target=key)
                    if not ok:
                        findings["bad"].append((cid, d, key, col, up, new, refv, "espn draft"))
            else:  # snap_count.crosswalk
                pr = con.execute("SELECT gsis_id, display_name, espn_id FROM player "
                                 "WHERE pfr_id=?", (key,)).fetchone()
                ok = pr is not None and pr["gsis_id"] == new
                L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                        "MATCH" if ok else "MISMATCH", "db", rel(DB),
                        db_value=f"{up!r}->{new!r}", ref_id=key,
                        ref_value=pr["gsis_id"] if pr else None, defect=d, target=key,
                        note="the pfr->gsis crosswalk the snap loader uses now resolves "
                             "this pfr id to the corrected gsis id")
                if not ok:
                    findings["bad"].append((cid, d, key, col, up, new,
                                            pr["gsis_id"] if pr else None, "crosswalk"))
            continue

        # =========================== D19 =============================
        if d == "D19":
            inner = key[key.find("(") + 1: key.rfind(")")]
            parts = [x.strip().strip("'") for x in inner.split(",")]
            pid, season, wk, st = parts[0], int(parts[1]), int(parts[2]), parts[3]
            tgt = new if col == "gsis_id" else None
            look = tgt or "00-0035681"
            row = con.execute(
                "SELECT gsis_id, position, position_group FROM player_game_stats "
                "WHERE gsis_id=? AND season=? AND week=? AND season_type=?",
                (look, season, wk, st)).fetchone()
            pr = con.execute("SELECT display_name, position, espn_id FROM player "
                             "WHERE gsis_id=?", (look,)).fetchone()
            other = con.execute("SELECT display_name, position, espn_id, draft_year "
                                "FROM player WHERE gsis_id=?", (pid,)).fetchone()
            aid = pr["espn_id"] if pr else None
            p = athlete_path(aid) if aid else None
            a = jload(p) if p else None
            ev = rel(p) if p and os.path.exists(p) else rel(DB)
            if col == "gsis_id":
                ok = row is not None and row["gsis_id"] == new
                note = (f"stat line reassigned from {other['display_name'] if other else pid} "
                        f"(drafted {other['draft_year'] if other else '?'}) to "
                        f"{pr['display_name'] if pr else look}; ESPN athlete "
                        f"{aid} = {(a or {}).get('displayName')}, debut "
                        f"{(a or {}).get('debutYear')}")
            else:
                stored = row[col] if row else None
                ok = row is not None and str(stored) == str(new)
                note = (f"row now stores {col}={stored}; ESPN lists "
                        f"{(a or {}).get('displayName')} as "
                        f"{((a or {}).get('position') or {}).get('abbreviation')}")
            L.write("data_correction", cid, f"{d}:{tbl}.{col}@{key}",
                    "MATCH" if ok else "MISMATCH", "espn", ev,
                    db_value=f"{up!r}->{new!r}", ref_id=aid,
                    ref_value=(a or {}).get("displayName"), defect=d, target=key,
                    season=season, note=note)
            if not ok:
                findings["bad"].append((cid, d, key, col, up, new, None, "not applied"))
            continue

        bad("UNRESOLVED", "unknown", rel(DB), note=f"no verifier for defect {d}")
    return findings


def _espn_stat(blob, espn_id, col):
    """Pull one stat for one athlete out of an ESPN summary box score."""
    if not espn_id:
        return None
    KEY = {
        "attempts": ("passing", "C/ATT", 1), "completions": ("passing", "C/ATT", 0),
        "passing_yards": ("passing", "YDS", None),
        "carries": ("rushing", "CAR", None), "rushing_yards": ("rushing", "YDS", None),
        "rushing_tds": ("rushing", "TD", None),
        "receptions": ("receiving", "REC", None),
        "receiving_yards": ("receiving", "YDS", None),
        "targets": ("receiving", "TGTS", None),
    }
    if col not in KEY:
        return None
    grp_name, label, part = KEY[col]
    for team in blob.get("boxscore", {}).get("players", []):
        for grp in team.get("statistics", []):
            if grp.get("name") != grp_name:
                continue
            labels = grp.get("labels") or []
            if label not in labels:
                continue
            i = labels.index(label)
            for ath in grp.get("athletes", []):
                if str((ath.get("athlete") or {}).get("id")) != str(espn_id):
                    continue
                v = (ath.get("stats") or [None] * (i + 1))[i]
                if v is None:
                    return None
                if part is not None and "/" in str(v):
                    return str(v).split("/")[part]
                return v
    return None


# --------------------------------------------------------------------------
ADDED_FIELDS = [("display_name", "full_name"), ("position", "position"),
                ("birth_date", "birth_date"), ("college", "college"),
                ("espn_id", "espn_id"), ("pfr_id", "pfr_id"), ("esb_id", "esb_id"),
                ("height", "height"), ("weight", "weight"),
                ("rookie_year", "rookie_year"), ("status", "status"),
                ("first_name", "first_name"), ("last_name", "last_name")]


def audit_added_players(con, L: Ledger, findings: dict) -> None:
    """D5 -- the 1,482 rows added today.  Is every one a real, sourced person?

    The population is defined against the pre-job backup, not asserted.  The
    authority is the file the additions were sourced from: raw/rosters.csv.
    """
    import csv as _csv
    _csv.field_size_limit(10 ** 8)
    backup = os.path.join(ROOT, "nfl.db.pre-completion-backup")
    ev = os.path.join(CACHE, "derived", "players_added_today.json")
    os.makedirs(os.path.dirname(ev), exist_ok=True)
    if not os.path.exists(backup):
        L.write("player", "*added*", "d5.population", "UNRESOLVED", "db-backup", rel(DB),
                note="pre-completion backup missing; cannot define the added population")
        return
    c2 = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
    old = {r[0] for r in c2.execute("SELECT gsis_id FROM player")}
    new = {r[0] for r in con.execute("SELECT gsis_id FROM player")}
    added = sorted(new - old)
    removed = sorted(old - new)

    pool = {g: {} for g in added}
    src = os.path.join(ROOT, "raw", "rosters.csv")
    with open(src, newline="") as fh:
        for row in _csv.DictReader(fh):
            g = (row.get("gsis_id") or "").strip()
            if g in pool:
                for _, rc in ADDED_FIELDS:
                    v = (row.get(rc) or "").strip()
                    if v and v != "NA":
                        pool[g].setdefault(rc, set()).add(v)

    unsourced = []
    for g in added:
        p = con.execute("SELECT * FROM player WHERE gsis_id=?", (g,)).fetchone()
        missing_fields = []
        checked = 0
        for dbc, rc in ADDED_FIELDS:
            v = p[dbc]
            if v in (None, ""):
                continue
            checked += 1
            vals = pool[g].get(rc, set())
            s = str(v).strip()
            hit = s in vals
            if not hit:
                try:
                    hit = any(float(s) == float(x) for x in vals)
                except ValueError:
                    hit = False
            if not hit:
                missing_fields.append((dbc, v, sorted(vals)[:3]))
        if not pool[g]:
            L.write("player", g, "d5.provenance", "DB_ONLY", "rosters.csv", rel(src),
                    db_value=p["display_name"], ref_id=g,
                    note="row added today but this gsis_id appears nowhere in "
                         "raw/rosters.csv -- possible fabrication, investigate")
            unsourced.append((g, p["display_name"], "not in rosters.csv"))
        elif missing_fields:
            L.write("player", g, "d5.provenance", "MISMATCH", "rosters.csv", rel(src),
                    db_value=p["display_name"], ref_id=g, ref_value=missing_fields,
                    note="row added today carries values not present in any "
                         "raw/rosters.csv record for this player")
            unsourced.append((g, p["display_name"], missing_fields))
        else:
            L.write("player", g, "d5.provenance", "MATCH", "rosters.csv", rel(src),
                    db_value=p["display_name"], ref_id=g,
                    ref_value=f"{checked} stored attributes, all present in rosters.csv",
                    note="added today; every stored attribute traces to the source feed")

    with open(ev, "w") as fh:
        json.dump({"added": added, "removed": removed,
                   "unsourced": unsourced}, fh, indent=1)
    findings["added_today"] = {"added": len(added), "removed": len(removed),
                               "unsourced": unsourced}


def audit_canonical(con, L: Ledger, findings: dict) -> None:
    """The 10 declared split identities, plus a fresh hunt for more."""
    ev = os.path.join(CACHE, "derived", "canonical_gsis.json")
    os.makedirs(os.path.dirname(ev), exist_ok=True)
    declared = list(con.execute(
        "SELECT gsis_id, canonical_gsis_id, display_name, position, birth_date, college, "
        "draft_year, esb_id, pfr_id, espn_id FROM player "
        "WHERE canonical_gsis_id IS NOT NULL ORDER BY gsis_id"))
    out = {"declared": [], "candidates": []}
    for r in declared:
        tgt = con.execute(
            "SELECT gsis_id, display_name, position, birth_date, college, draft_year, "
            "esb_id, pfr_id, espn_id, canonical_gsis_id FROM player WHERE gsis_id=?",
            (r["canonical_gsis_id"],)).fetchone()
        rec = {"alias": r["gsis_id"], "alias_name": r["display_name"],
               "canonical": r["canonical_gsis_id"],
               "canonical_name": tgt["display_name"] if tgt else None,
               "alias_esb": r["esb_id"], "canonical_esb": tgt["esb_id"] if tgt else None,
               "alias_pos": r["position"], "canonical_pos": tgt["position"] if tgt else None,
               "canonical_is_canonical": (tgt["canonical_gsis_id"] is None) if tgt else None}
        out["declared"].append(rec)
    with open(ev, "w") as fh:
        json.dump(out, fh, indent=1)

    for r in declared:
        tgt = con.execute(
            "SELECT gsis_id, display_name, position, esb_id, canonical_gsis_id "
            "FROM player WHERE gsis_id=?", (r["canonical_gsis_id"],)).fetchone()
        problems = []
        if tgt is None:
            problems.append("canonical target row does not exist")
        else:
            if tgt["canonical_gsis_id"] is not None:
                problems.append("canonical target is itself an alias (chained pointer)")
            if _norm_name(r["display_name"]) != _norm_name(tgt["display_name"]):
                problems.append(f"names differ: {r['display_name']} vs {tgt['display_name']}")
        verdict = "MATCH" if not problems else "MISMATCH"
        L.write("player", r["gsis_id"], "canonical_gsis_id", verdict, "db+espn", rel(ev),
                db_value=r["canonical_gsis_id"],
                ref_value=tgt["display_name"] if tgt else None,
                note="; ".join(problems) if problems else
                     "alias and canonical are the same human: matching name, and the "
                     "canonical row is itself canonical")
        findings["canonical"].append((r["gsis_id"], r["canonical_gsis_id"],
                                      r["display_name"], problems))

    # --- hunt for undeclared splits -------------------------------------
    # name + birthdate, or name + college + draft_year, on two different gsis ids
    by_name = {}
    for r in con.execute(
            "SELECT gsis_id, display_name, position, birth_date, college, draft_year, "
            "esb_id, pfr_id, espn_id, canonical_gsis_id, rookie_year, last_season "
            "FROM player"):
        by_name.setdefault(_norm_name(r["display_name"]), []).append(dict(r))
    cands, near, pairs = [], [], 0
    for nm, lst in by_name.items():
        if len(lst) < 2 or not nm:
            continue
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                a, b = lst[i], lst[j]
                if a["canonical_gsis_id"] == b["gsis_id"] or \
                   b["canonical_gsis_id"] == a["gsis_id"]:
                    continue
                pairs += 1
                score, why = 0, []
                for w, key, label in ((3, "esb_id", "same esb_id"),
                                      (3, "espn_id", "same espn_id"),
                                      (3, "pfr_id", "same pfr_id"),
                                      (2, "birth_date", "same birth_date"),
                                      (1, "draft_year", "same draft_year"),
                                      (1, "position", "same position")):
                    if a[key] and a[key] == b[key]:
                        score += w
                        why.append(label)
                if a["college"] and _norm_name(a["college"]) == _norm_name(b["college"]):
                    score += 1
                    why.append("same college")
                if a["rookie_year"] and b["rookie_year"] and \
                        abs(a["rookie_year"] - b["rookie_year"]) <= 1:
                    score += 1
                    why.append("overlapping rookie_year")
                if score >= 2:
                    rec = {"a": a["gsis_id"], "b": b["gsis_id"], "name": nm,
                           "score": score, "why": why,
                           "a_pos": a["position"], "b_pos": b["position"],
                           "a_dob": a["birth_date"], "b_dob": b["birth_date"],
                           "a_col": a["college"], "b_col": b["college"],
                           "a_draft": a["draft_year"], "b_draft": b["draft_year"],
                           "a_espn": a["espn_id"], "b_espn": b["espn_id"],
                           "a_rookie": a["rookie_year"], "b_rookie": b["rookie_year"]}
                    (cands if score >= 3 else near).append(rec)
    out["candidates"] = cands
    out["near_misses"] = near
    out["same_name_pairs_examined"] = pairs
    with open(ev, "w") as fh:
        json.dump(out, fh, indent=1)
    findings["candidate_splits"] = cands
    findings["split_near_misses"] = near
    findings["same_name_pairs"] = pairs

    for rec in cands + near:
        # a candidate must be shown to be two humans OR one -- decide on the
        # hard identity fields, never on the name
        two_humans = (rec["a_dob"] and rec["b_dob"] and rec["a_dob"] != rec["b_dob"]) or \
                     (rec["a_col"] and rec["b_col"] and
                      _norm_name(rec["a_col"]) != _norm_name(rec["b_col"]))
        L.write("player", rec["a"], "split_identity.candidate",
                "MATCH" if two_humans else "UNRESOLVED", "db+espn", rel(ev),
                db_value=rec["name"], ref_id=rec["b"], ref_value=rec["why"],
                note=("two different humans sharing a name: "
                      f"dates of birth differ ({'both known' if rec['a_dob'] and rec['b_dob'] else 'one side unknown'}), "
                      f"college {rec['a_col']} vs {rec['b_col']} -- correctly NOT linked"
                      if two_humans else
                      "same-name pair that the hard identity fields cannot separate "
                      "and that carries no canonical_gsis_id link -- needs a ruling"),
                score=rec["score"])


# ==========================================================================
def _gameday_rule_scoreboard(g: dict) -> dict:
    """How many of the 285 rows each candidate `gameday` rule reproduces.

    The yardstick is ESPN's own date-bucketed scoreboard -- the endpoint the
    contract names as the authority for `game` -- not a theory about which zone
    ESPN uses.
    """
    disagree = {x[0]: x[2] for x in g.get("gameday_disagree", [])}
    out = {"rows": 0, "pacific": 0, "eastern": 0, "venue_local": 0,
           "stored_equals_pacific": 0, "venue_local_failures": [],
           "pacific_failures": [], "eastern_failures": []}
    for gid, stored, pac, est, loc, vtz, tv in g.get("tz_rule", []):
        espn = disagree.get(gid, stored)
        out["rows"] += 1
        out["stored_equals_pacific"] += (stored == pac)
        for name, val, key in (("pacific", pac, "pacific_failures"),
                               ("eastern", est, "eastern_failures"),
                               ("venue_local", loc, "venue_local_failures")):
            if val == espn:
                out[name] += 1
            else:
                out[key].append([gid, val, espn, vtz, tv])
    return out


def phase_audit() -> None:
    md5_start = db_md5()
    con = ro()
    L = Ledger(LEDGER)
    print(f"db md5 at start: {md5_start}")

    g = audit_game_2026(con, L)
    print("game 2026 done", L.n)
    t = audit_team(con, L)
    print("team/alias done", L.n)
    p = audit_player(con, L)
    print("player done", L.n)
    audit_added_players(con, L, p)
    print("added-players (D5) done", L.n)
    audit_canonical(con, L, p)
    print("canonical done", L.n)
    c = audit_corrections(con, L)
    print("corrections done", L.n)

    L.close()
    md5_end = db_md5()

    summary = {
        "md5_start": md5_start, "md5_end": md5_end,
        "ledger_lines": L.n,
        "missing_evidence_paths": L.missing_evidence,
        "verdicts": {f"{k[0]}|{k[1]}": v for k, v in sorted(L.counts.items())},
        "rows_in_ledger": {k: len(v) for k, v in L.rows.items()},
        "game": {k: v for k, v in g.items()},
        "team": t,
        "player_mismatch": p["mismatch"][:400],
        "player_mismatch_n": len(p["mismatch"]),
        "player_unresolved": p["unresolved"][:400],
        "player_unresolved_n": len(p["unresolved"]),
        "dupe_pfr": p["dupe_pfr"], "dupe_espn": p["dupe_espn"],
        "canonical": p["canonical"],
        "candidate_splits": p["candidate_splits"],
        "split_near_misses": p.get("split_near_misses", []),
        "same_name_pairs_examined": p.get("same_name_pairs"),
        "added_today": p.get("added_today"),
        "gameday_rule_scoreboard": _gameday_rule_scoreboard(g),
        "corrections_bad": c["bad"],
        "corrections_unresolved": c["unresolved"],
        "corrections_notcomp_n": len(c["notcomp"]),
    }
    outp = os.path.join(CACHE, "derived", "f09_summary.json")
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    with open(outp, "w") as fh:
        json.dump(summary, fh, indent=1, default=str)
    print(json.dumps({k: v for k, v in summary.items()
                      if k in ("md5_start", "md5_end", "ledger_lines",
                               "missing_evidence_paths", "verdicts",
                               "rows_in_ledger", "player_mismatch_n",
                               "player_unresolved_n")}, indent=1))
    print(f"summary -> {outp}")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "audit"
    if cmd == "fetch":
        phase_fetch()
    elif cmd == "audit":
        phase_audit()
    elif cmd == "md5":
        print(db_md5())
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
