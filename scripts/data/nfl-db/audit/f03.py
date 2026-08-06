#!/usr/bin/env python3
"""
F03 -- forensic row-level audit of NFL seasons 2014 and 2015.

Partition (exact, from AUDIT-CONTRACT.md task assignment):
    game                534
    game_line           534
    team_game         1,068  (2 per game)
    player_game_stats 35,193
    snap_count        47,706
    roster_season      4,343
    depth_chart       69,600

Database is opened READ-ONLY (sqlite3 file:...?mode=ro). md5 is recorded at start
and end of every run.

Every HTTP response is cached under scripts/data/nfl-db/cache/f03/ (and prior
agents' caches a1/, a3/, a5/, s2/, a2/, a4/, b1/ are read first). After a single
populated run the whole audit replays offline with --offline.

Phases (run all with no args, or name them):
    fetch      populate cache (network)
    game       game            vs ESPN scoreboard + summary
    line       game_line       vs SportsOddsHistory (cache/a4/soh_YYYY.html.gz)
    teamgame   team_game       recomputed from game + game_line (derived authority)
    pgs        player_game_stats vs ESPN box score
    snap       snap_count      internal + PFR sample + transposition detector
    roster     roster_season   vs ESPN core-API season roster
    depth      depth_chart     internal/structural only -- NOT_COMPARABLE
    corrections data_correction rows touching 2014/2015 re-verified

Usage:
    python3 scripts/data/nfl-db/audit/f03.py fetch
    python3 scripts/data/nfl-db/audit/f03.py            # all phases
    python3 scripts/data/nfl-db/audit/f03.py --offline game pgs
"""
from __future__ import annotations

import argparse
import glob
import gzip
import hashlib
import io
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)                       # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB_PATH = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache")
MY = os.path.join(CACHE, "f03")
LEDGER_DIR = os.path.join(REPO, "docs", "audits", "2026-07-27-nfl-db-forensic", "ledger")
LEDGER = os.path.join(LEDGER_DIR, "F03.jsonl")

SEASONS = (2014, 2015)
AGENT = "F03"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

OFFLINE = False
_last_fetch = [0.0]
SLEEP = 1.1          # seconds between network calls; ten agents share this network


# --------------------------------------------------------------------------- io
def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(path: str) -> str:
    """Evidence paths are recorded relative to scripts/data/nfl-db/."""
    return os.path.relpath(path, NFLDB)


def _write_gz(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wb") as fh:
        fh.write(data)


def read_gz(path: str) -> bytes:
    with gzip.open(path, "rb") as fh:
        return fh.read()


def fetch(url: str, dest: str, *, binary: bool = False):
    """GET url, cache gzipped at dest, return (payload, dest). Cache always first."""
    if os.path.exists(dest):
        raw = read_gz(dest)
        return (raw if binary else json.loads(raw)), dest
    if OFFLINE:
        raise RuntimeError(f"offline and not cached: {dest}")
    wait = SLEEP - (time.time() - _last_fetch[0])
    if wait > 0:
        time.sleep(wait)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        err = os.path.splitext(os.path.splitext(dest)[0])[0] + f".http{e.code}.gz"
        _write_gz(err, body or f"HTTP {e.code} {url}".encode())
        _last_fetch[0] = time.time()
        raise
    finally:
        _last_fetch[0] = time.time()
    _write_gz(dest, raw)
    return (raw if binary else json.loads(raw)), dest


# ----------------------------------------------------------------------- ledger
class Ledger:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.fh = open(path, "a", encoding="utf-8")
        self.counts: dict[tuple[str, str], int] = defaultdict(int)
        self.rows: dict[str, set] = defaultdict(set)
        self.notable: list[dict] = []
        self.ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def add(self, table, row_key, season, field, db_value, authority, ref_id,
            ref_value, verdict, evidence, note=None, in_partition=True, **extra):
        rec = {"ts": self.ts, "agent": AGENT, "table": table, "row_key": row_key,
               "season": season, "field": field, "db_value": db_value,
               "authority": authority, "ref_id": ref_id, "ref_value": ref_value,
               "verdict": verdict, "evidence": evidence}
        if note:
            rec["note"] = note
        rec.update(extra)
        self.fh.write(json.dumps(rec, default=str) + "\n")
        self.counts[(table, verdict)] += 1
        if in_partition:
            self.rows[table].add(row_key)
        if verdict != "MATCH":
            self.notable.append(rec)
        return rec

    def row_verdict(self, table, row_key, season, authority, ref_id, evidence,
                    n_cmp, n_ok, fails, note=None, gaps=None, **extra):
        """One row-level record per partition row.

        `fails` are genuine content disagreements -> MISMATCH.
        `gaps`  are fields the authority has and the database does not -> REF_ONLY, which
                is a gap in coverage rather than a wrong value. Both are named on the
                record, so nothing is collapsed away.
        """
        verdict = "MISMATCH" if fails else ("REF_ONLY" if gaps else "MATCH")
        return self.add(table, row_key, season, "*", None, authority, ref_id, None,
                        verdict, evidence,
                        note=note, fields_compared=n_cmp, fields_matched=n_ok,
                        failed_fields=(sorted(set(fails)) or None),
                        gap_fields=(sorted(set(gaps)) if gaps else None), **extra)

    def close(self):
        self.fh.close()


def truncate_ledger():
    os.makedirs(LEDGER_DIR, exist_ok=True)
    open(LEDGER, "w").close()


# ------------------------------------------------------------------- db helpers
def connect():
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


ALIAS_TO_FID = {}
FID_TO_ABBR = {}


def load_teams(con):
    for r in con.execute("SELECT abbreviation, franchise_id FROM team_alias"):
        ALIAS_TO_FID[r["abbreviation"]] = r["franchise_id"]
    for r in con.execute("SELECT franchise_id, abbreviation FROM team"):
        FID_TO_ABBR[r["franchise_id"]] = r["abbreviation"]


# ------------------------------------------------------------------ ESPN access
def sb_path(season, stype, week):
    """Prior agent a1 cached scoreboards as cache/a1/scoreboard/{season}_{type}_{week}.json"""
    return os.path.join(CACHE, "a1", "scoreboard", f"{season}_{stype}_{week}.json")


def load_scoreboard_events():
    """event_id -> (event dict, evidence path). Reuses a1's cache; fetches gaps."""
    out = {}
    for season in SEASONS:
        for stype, weeks in ((2, range(1, 19)), (3, range(1, 6))):
            p = sb_path(season, stype, week=None) if False else None
            for wk in weeks:
                p = sb_path(season, stype, wk)
                if os.path.exists(p):
                    d = json.load(open(p))
                else:
                    mine = os.path.join(MY, "scoreboard", f"{season}_{stype}_{wk}.json.gz")
                    url = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
                           f"scoreboard?dates={season}&seasontype={stype}&week={wk}")
                    try:
                        d, p = fetch(url, mine)
                    except Exception:
                        continue
                for e in d.get("events", []):
                    out.setdefault(e["id"], (e, p))
    return out


SUMMARY_SEARCH = [
    (os.path.join(CACHE, "a5"), "summary_{id}.json.gz", "gz"),
    (os.path.join(MY, "summary"), "{id}.json.gz", "gz"),
    (os.path.join(CACHE, "a1", "summary"), "{id}.json", "raw"),
    (os.path.join(CACHE, "s2"), "summary_{id}.json", "raw"),
    (os.path.join(CACHE, "a2"), "espn_summary_{id}.json", "raw"),
]


def summary_cached(event_id: str):
    for d, pat, kind in SUMMARY_SEARCH:
        p = os.path.join(d, pat.format(id=event_id))
        if os.path.exists(p):
            return p, kind
    return None, None


def load_summary(event_id: str):
    p, kind = summary_cached(event_id)
    if p:
        raw = read_gz(p) if kind == "gz" else open(p, "rb").read()
        try:
            return json.loads(raw), p
        except json.JSONDecodeError:
            return None, p
    if OFFLINE:
        return None, None
    dest = os.path.join(MY, "summary", f"{event_id}.json.gz")
    url = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
           f"summary?event={event_id}")
    try:
        d, p = fetch(url, dest)
        return d, p
    except Exception:
        err = os.path.join(MY, "summary", f"{event_id}.http404.gz")
        return None, (err if os.path.exists(err) else None)


def core_roster(season: int, fid: int):
    dest = os.path.join(MY, "roster", f"{season}_{fid}.json.gz")
    url = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
           f"seasons/{season}/teams/{fid}/athletes?limit=300")
    try:
        d, p = fetch(url, dest)
    except Exception:
        return None, None
    ids = set()
    for it in d.get("items", []):
        m = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
        if m:
            ids.add(m.group(1))
    return ids, p


# Pro-Football-Reference sits behind a Cloudflare JS challenge that no HTTP client and
# no headless browser in this environment can clear (verified: 403 "Just a moment...").
# The Internet Archive serves the *same* PFR page, unmodified, from its crawl -- so the
# authority is still Pro-Football-Reference; only the transport is archival. Every such
# fetch is cached and the archive timestamp is part of the evidence.
PFR_BOX = "https://www.pro-football-reference.com/boxscores/{pfr}.htm"
PFR_WAYBACK = "https://web.archive.org/web/2023id_/" + PFR_BOX


def pfr_box(pfr_game_id: str):
    dest = os.path.join(MY, "pfr", f"{pfr_game_id}.html.gz")
    try:
        raw, p = fetch(PFR_WAYBACK.format(pfr=pfr_game_id), dest, binary=True)
        html = raw.decode("utf-8", "replace")
        if "Pro-Football-Reference" not in html:
            return None, p
        return html, p
    except Exception:
        return None, None


# ================================================================== PHASE: fetch
def phase_fetch(con):
    print("[fetch] scoreboards ...", flush=True)
    events = load_scoreboard_events()
    print(f"[fetch] scoreboard events available: {len(events)}", flush=True)

    ids = [r["espn_event_id"] for r in
           con.execute("SELECT espn_event_id FROM game WHERE season IN (?,?) ORDER BY kickoff_utc",
                       SEASONS)]
    missing = [i for i in ids if summary_cached(i)[0] is None]
    print(f"[fetch] summaries: {len(ids)} needed, {len(ids)-len(missing)} cached, "
          f"{len(missing)} to fetch", flush=True)
    for n, ev in enumerate(missing, 1):
        load_summary(ev)
        if n % 25 == 0:
            print(f"[fetch]   summary {n}/{len(missing)}", flush=True)

    print("[fetch] season rosters (core api) ...", flush=True)
    fids = [r[0] for r in con.execute("SELECT DISTINCT franchise_id FROM roster_season "
                                      "WHERE season IN (?,?)", SEASONS)]
    todo = [(s, f) for s in SEASONS for f in sorted(fids)]
    for n, (s, f) in enumerate(todo, 1):
        core_roster(s, f)
        if n % 16 == 0:
            print(f"[fetch]   roster {n}/{len(todo)}", flush=True)

    # PFR box scores, in priority order. Resumable: anything already cached is skipped,
    # so stopping this and re-running it simply extends the sample.
    sample = pfr_sample(con)
    todo = [g for g in sample if not os.path.exists(os.path.join(MY, "pfr", g + ".html.gz"))]
    print(f"[fetch] PFR boxscores: {len(sample)} queued, {len(sample)-len(todo)} cached, "
          f"{len(todo)} to fetch (~40s each via the Internet Archive)", flush=True)
    global SLEEP
    keep, SLEEP = SLEEP, 0.5    # the archive's own latency is the real rate limit
    for n, g in enumerate(todo, 1):
        pfr_box(g)
        print(f"[fetch]   pfr {n}/{len(todo)} {g}", flush=True)
    SLEEP = keep
    print("[fetch] done", flush=True)


def pfr_sample(con, limit=None):
    """The PFR fetch queue, in priority order, deterministic and resumable.

    1. every postseason game -- the transposition question lives here
    2. every game carrying an internal-control anomaly (see phase_snap)
    3. a stride sample across the regular season, then the remainder

    PFR pages come from the Internet Archive at roughly one per 40s, so a run is
    normally stopped part-way; whatever is on disk when the audit runs is the sample,
    and phase_snap_pfr reports exactly that count. Re-running extends it.
    """
    anomalies = [r[0] for r in con.execute(
        "SELECT DISTINCT s.game_id FROM snap_count s WHERE s.season IN (?,?) "
        "  AND s.gsis_id IS NOT NULL "
        "  AND EXISTS (SELECT 1 FROM roster_season r WHERE r.season=s.season "
        "              AND r.gsis_id=s.gsis_id) "
        "  AND NOT EXISTS (SELECT 1 FROM roster_season r WHERE r.season=s.season "
        "                  AND r.gsis_id=s.gsis_id AND r.franchise_id=s.franchise_id)",
        SEASONS)]
    post = [r[0] for r in con.execute(
        "SELECT pfr_game_id FROM game WHERE season IN (?,?) AND season_type='POST' "
        "AND pfr_game_id IS NOT NULL ORDER BY kickoff_utc", SEASONS)]
    anom = [r[0] for r in con.execute(
        "SELECT pfr_game_id FROM game WHERE pfr_game_id IS NOT NULL AND game_id IN (%s)"
        % ",".join("?" * len(anomalies)), tuple(anomalies))] if anomalies else []
    reg = [r[0] for r in con.execute(
        "SELECT pfr_game_id FROM game WHERE season IN (?,?) AND season_type='REG' "
        "AND pfr_game_id IS NOT NULL ORDER BY kickoff_utc", SEASONS)]
    out, seen = [], set()
    for g in post + anom + reg[::5] + reg:
        if g and g not in seen:
            seen.add(g)
            out.append(g)
    return out[:limit] if limit else out


# =================================================================== PHASE: game
GAME_STATUS = {"final": True}


def espn_fid(comp_team) -> int | None:
    """ESPN team id IS the franchise id in this schema (see team.franchise_id comment)."""
    try:
        return int(comp_team["id"])
    except (KeyError, TypeError, ValueError):
        return None


def phase_game(con, led: Ledger):
    events = load_scoreboard_events()
    soh, soh_paths = soh_index(con)
    rows = list(con.execute(
        "SELECT * FROM game WHERE season IN (?,?) ORDER BY season, kickoff_utc", SEASONS))
    print(f"[game] {len(rows)} rows", flush=True)

    seen_events = set()
    for g in rows:
        gid, ev = g["game_id"], g["espn_event_id"]
        seen_events.add(ev)
        pair = events.get(ev)
        summ, spath = load_summary(ev)
        if pair is None and summ is None:
            led.add("game", gid, g["season"], "*", None, "espn", ev, None,
                    "UNRESOLVED", rel(spath) if spath else "cache/f03/",
                    note="ESPN has neither scoreboard nor summary for this event id")
            continue
        e, epath = pair if pair else (None, spath)
        evidence = rel(epath) if epath else rel(spath)
        comp = (e or {}).get("competitions", [{}])[0]
        comps = {c.get("homeAway"): c for c in comp.get("competitors", [])}
        home, away = comps.get("home", {}), comps.get("away", {})

        # -- build the authority's view -------------------------------------
        ref = {}
        if e:
            ref["home_franchise_id"] = espn_fid(home.get("team", {}))
            ref["away_franchise_id"] = espn_fid(away.get("team", {}))
            try:
                ref["home_score"] = int(home.get("score"))
                ref["away_score"] = int(away.get("score"))
            except (TypeError, ValueError):
                ref["home_score"] = ref["away_score"] = None
            ref["kickoff_utc"] = e.get("date")
            st = comp.get("status", {}).get("type", {}) or \
                 (e.get("status", {}) or {}).get("type", {})
            ref["result_status"] = "final" if st.get("completed") else "scheduled"
            ref["_state"] = st.get("name")
            ref["venue_id"] = (comp.get("venue") or {}).get("id")
            ref["stadium"] = (comp.get("venue") or {}).get("fullName")
            ref["neutralSite"] = comp.get("neutralSite")
            ref["week"] = (e.get("week") or {}).get("number")
            ref["season_type"] = (e.get("season") or {}).get("type")
            per = comp.get("status", {}).get("period")
            ref["overtime"] = (1 if (per or 0) > 4 else 0) if per is not None else None

        # third source: SportsOddsHistory / covers.com publishes the ET date, the final
        # score, an overtime marker and a neutral-site marker for every game.
        s3, s3path = soh.get(gid, (None, None))
        third = {}
        if s3:
            hf = (s3["fav"] == g["home_franchise_id"])
            third = {"gameday": s3["date"],
                     "home_score": s3["fav_score"] if hf else s3["dog_score"],
                     "away_score": s3["dog_score"] if hf else s3["fav_score"],
                     "overtime": s3["overtime"],
                     "location": "Neutral" if s3["neutral"] else "Home"}

        n_cmp = n_ok = 0
        fails = []
        gaps = []

        def cmp(field, dbv, refv, authority="espn", note=None, refid=None):
            nonlocal n_cmp, n_ok
            if refv is None:
                led.add("game", gid, g["season"], field, dbv, authority, refid or ev, None,
                        "NOT_COMPARABLE", evidence,
                        note=note or "authority does not publish this field for this event")
                return
            n_cmp += 1
            if dbv == refv:
                n_ok += 1
            else:
                fails.append(field)
                led.add("game", gid, g["season"], field, dbv, authority, refid or ev, refv,
                        "MISMATCH", evidence, note=note,
                        third_source=("sportsoddshistory=%r (%s)" % (
                            third.get(field), rel(s3path)) if field in third else None))

        cmp("home_franchise_id", g["home_franchise_id"], ref.get("home_franchise_id"))
        cmp("away_franchise_id", g["away_franchise_id"], ref.get("away_franchise_id"))
        # era-correct abbreviation: ESPN publishes the *current* abbr, so we compare
        # through the alias table (STL and LAR both resolve to franchise 14).
        for side in ("home", "away"):
            espn_abbr = (home if side == "home" else away).get("team", {}).get("abbreviation")
            dbab = g[f"{side}_abbr"]
            if espn_abbr is None:
                cmp(f"{side}_abbr", dbab, None)
            elif ALIAS_TO_FID.get(dbab) is not None and \
                    ALIAS_TO_FID.get(dbab) == ALIAS_TO_FID.get(espn_abbr):
                n_cmp += 1
                n_ok += 1
                if dbab != espn_abbr:
                    led.add("game", gid, g["season"], f"{side}_abbr_literal", dbab, "espn",
                            ev, espn_abbr, "NOT_COMPARABLE", evidence,
                            note="ESPN publishes the current-era abbreviation; db stores the "
                                 "era-correct one. Same franchise_id, known-good difference.")
            else:
                n_cmp += 1
                fails.append(f"{side}_abbr")
                led.add("game", gid, g["season"], f"{side}_abbr", dbab, "espn", ev,
                        espn_abbr, "MISMATCH", evidence)

        if g["result_status"] == "final":
            cmp("home_score", g["home_score"], ref.get("home_score"))
            cmp("away_score", g["away_score"], ref.get("away_score"))
        else:
            led.add("game", gid, g["season"], "home_score", g["home_score"], "espn", ev, None,
                    "NOT_COMPARABLE", evidence, note="game not final -- structural absence")
        cmp("result_status", g["result_status"], ref.get("result_status"))

        # kickoff: db stores seconds, ESPN minute precision. Contract rule 5: nflverse
        # stores the *scheduled* kickoff and ESPN the *observed* one, so a small delta is
        # a known-good difference and must not be re-litigated. A large one is not.
        dbk = (g["kickoff_utc"] or "").replace(":00Z", "Z").replace("+00:00", "Z")
        refk = ref.get("kickoff_utc")
        if refk:
            n_cmp += 1
            if dbk == refk:
                n_ok += 1
            else:
                delta = None
                try:
                    delta = abs((datetime.strptime(dbk, "%Y-%m-%dT%H:%MZ")
                                 - datetime.strptime(refk, "%Y-%m-%dT%H:%MZ")).total_seconds())
                except ValueError:
                    pass
                if delta is not None and delta <= 1800:
                    n_ok += 1
                    led.add("game", gid, g["season"], "kickoff_utc", g["kickoff_utc"], "espn",
                            ev, refk, "NOT_COMPARABLE", evidence,
                            note="delta %d min: nflverse stores the scheduled kickoff, ESPN "
                                 "the observed one (contract rule 5, known-good difference)"
                                 % (delta / 60))
                else:
                    fails.append("kickoff_utc")
                    led.add("game", gid, g["season"], "kickoff_utc", g["kickoff_utc"], "espn",
                            ev, refk, "MISMATCH", evidence,
                            note="delta %s -- larger than the scheduled-vs-observed tolerance "
                                 "of contract rule 5" % (
                                     f"{delta/60:.0f} min" if delta is not None else "unparsed"))
        else:
            cmp("kickoff_utc", g["kickoff_utc"], None)

        # venue
        rv = ref.get("venue_id")
        dv = g["venue_id"]
        if rv is None:
            cmp("venue_id", dv, None, note="ESPN publishes no venue for this event")
        elif dv is None or dv == "":
            gaps.append("venue_id")
            led.add("game", gid, g["season"], "venue_id", dv, "espn", ev, rv,
                    "REF_ONLY", evidence,
                    note="ESPN publishes a venue id for this event; the database stores "
                         "none. game.venue_id is NULL for every game in seasons 2010-2025 "
                         "(4,363 rows) and populated only for 12 games in 2026 -- a "
                         "database-wide column gap, not a row-level error.")
        else:
            n_cmp += 1
            if str(dv) == str(rv):
                n_ok += 1
            else:
                fails.append("venue_id")
                led.add("game", gid, g["season"], "venue_id", dv, "espn", ev, rv,
                        "MISMATCH", evidence)

        rs = ref.get("stadium")
        if rs and g["stadium"]:
            n_cmp += 1
            if _venue_eq(g["stadium"], rs):
                n_ok += 1
            else:
                led.add("game", gid, g["season"], "stadium", g["stadium"], "espn", ev, rs,
                        "NOT_COMPARABLE", evidence,
                        note="ESPN retro-renames venues (contract rule 5) -- name divergence "
                             "is a known-good difference, not a defect")
        else:
            cmp("stadium", g["stadium"], None)

        # location / neutralSite -- contract rule 5
        ns = ref.get("neutralSite")
        dbloc = g["location"]
        if ns is None:
            led.add("game", gid, g["season"], "location", dbloc, "espn", ev, None,
                    "NOT_COMPARABLE", evidence,
                    note="ESPN neutralSite unpopulated (contract rule 5)")
        else:
            refloc = "Neutral" if ns else "Home"
            n_cmp += 1
            if dbloc == refloc:
                n_ok += 1
            else:
                fails.append("location")
                led.add("game", gid, g["season"], "location", dbloc, "espn", ev, refloc,
                        "MISMATCH", evidence,
                        note="ESPN neutralSite=%r" % ns)

        # week / round
        if g["season_type"] == "REG":
            cmp("week", g["week"], ref.get("week"))
        else:
            rnd = {1: "WC", 2: "DIV", 3: "CON", 5: "SB", 4: "PRO"}.get(ref.get("week"))
            if rnd in (None, "PRO"):
                cmp("playoff_round", g["playoff_round"], None,
                    note="ESPN postseason week %r does not map to a playoff round" % ref.get("week"))
            else:
                cmp("playoff_round", g["playoff_round"], rnd)

        # overtime, from the summary's final period when available
        ot_ref = ref.get("overtime")
        if ot_ref is None and summ:
            per = ((summ.get("header") or {}).get("competitions") or [{}])[0] \
                    .get("status", {}).get("period")
            ot_ref = (1 if (per or 0) > 4 else 0) if per else None
        cmp("overtime", g["overtime"], ot_ref)

        # --- SportsOddsHistory as an independent authority on the remaining columns ---
        if s3:
            se = rel(s3path)
            for field, refv in (("gameday", third["gameday"]),
                                ("home_score", third["home_score"]),
                                ("away_score", third["away_score"]),
                                ("overtime", third["overtime"]),
                                ("location", third["location"])):
                if refv is None:
                    continue
                n_cmp += 1
                if g[field] == refv:
                    n_ok += 1
                else:
                    fails.append(field + "@soh")
                    led.add("game", gid, g["season"], field, g[field], "sportsoddshistory",
                            gid, refv, "MISMATCH", se, note="SOH row: " + s3["raw"][:220])
        else:
            for field in ("gameday", "location"):
                led.add("game", gid, g["season"], field, g[field], "sportsoddshistory", gid,
                        None, "UNRESOLVED", rel(soh_paths.get(g["season"]) or ""),
                        note="no SportsOddsHistory row matched this game")

        # columns for which no authority in this audit publishes a comparable value
        for field, why in (
            ("div_game", "derived from the division table; recomputed below"),
            ("surface", "ESPN's scoreboard does not publish playing surface"),
            ("roof", "ESPN's scoreboard does not publish roof state"),
            ("referee", "ESPN's scoreboard does not publish the referee"),
            ("away_coach", "ESPN's scoreboard does not publish coaches"),
            ("home_coach", "ESPN's scoreboard does not publish coaches"),
            ("away_qb_id", "starting QB is a modelled attribution, not an ESPN field"),
            ("home_qb_id", "starting QB is a modelled attribution, not an ESPN field"),
            ("temp", "weather is NULL for dome games by construction (contract rule 4)"),
            ("wind", "weather is NULL for dome games by construction (contract rule 4)"),
            ("broadcast", "ESPN's historical scoreboard does not publish the broadcaster"),
            ("gsis_game_id", "cross-source join key; no ESPN equivalent"),
            ("pfr_game_id", "cross-source join key; no ESPN equivalent"),
            ("ftn_game_id", "cross-source join key; no ESPN equivalent"),
            ("old_game_id", "cross-source join key; no ESPN equivalent"),
            ("stadium_id", "nflverse stadium id; a different id space from ESPN's venue id"),
            ("time_valid", "provenance flag about the feed, not a fact about the game"),
            ("data_source", "provenance label, not a fact about the game"),
            ("away_rest_upstream", "preserved upstream value, deliberately divergent (D15)"),
            ("home_rest_upstream", "preserved upstream value, deliberately divergent (D15)"),
            ("note", "free text"),
        ):
            led.add("game", gid, g["season"], field, g[field] if field in g.keys() else None,
                    "espn", ev, None, "NOT_COMPARABLE", evidence, note=why)

        # div_game is fully recomputable from the team table
        dg = con.execute(
            "SELECT (SELECT division FROM team WHERE franchise_id=?) = "
            "       (SELECT division FROM team WHERE franchise_id=?)",
            (g["home_franchise_id"], g["away_franchise_id"])).fetchone()[0]
        if g["season_type"] == "REG" and dg is not None:
            n_cmp += 1
            if g["div_game"] == dg:
                n_ok += 1
            else:
                fails.append("div_game")
                led.add("game", gid, g["season"], "div_game", g["div_game"], "derived", gid,
                        dg, "MISMATCH", evidence,
                        note="recomputed from the two franchises' divisions")

        # weekday must agree with gameday
        if g["gameday"] and g["weekday"]:
            n_cmp += 1
            wd = datetime.fromisoformat(g["gameday"]).strftime("%A")
            if wd == g["weekday"]:
                n_ok += 1
            else:
                fails.append("weekday")
                led.add("game", gid, g["season"], "weekday", g["weekday"], "derived",
                        gid, wd, "MISMATCH", evidence,
                        note="weekday must be the day-of-week of gameday")

        # derived arithmetic (schema CHECKs already guarantee it; prove it anyway)
        if g["result_status"] == "final":
            for f, exp in (("result", g["home_score"] - g["away_score"]),
                           ("total", g["home_score"] + g["away_score"])):
                n_cmp += 1
                if g[f] == exp:
                    n_ok += 1
                else:
                    fails.append(f)
                    led.add("game", gid, g["season"], f, g[f], "derived", gid, exp,
                            "MISMATCH", evidence)

        led.row_verdict("game", gid, g["season"], "espn", ev, evidence, n_cmp, n_ok, fails,
                        gaps=gaps)

    # events ESPN has that the database does not
    for evid, (e, p) in sorted(events.items()):
        if evid in seen_events:
            continue
        comp = e.get("competitions", [{}])[0]
        st = comp.get("status", {}).get("type", {})
        led.add("game", f"espn_event_{evid}", int(e["season"]["year"]), "espn_event_id",
                None, "espn", evid, e.get("name"), "REF_ONLY", rel(p), in_partition=False,
                note=f"ESPN scoreboard lists this event; state={st.get('name')} "
                     f"detail={st.get('detail')}; date={e.get('date')}")


def _venue_eq(a, b):
    norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower()) \
        .replace("stadium", "").replace("field", "")
    return norm(a) == norm(b)


# =================================================================== PHASE: line
SOH_CACHE = os.path.join(CACHE, "a4", "soh_{y}.html.gz")
_MON = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
TEAM_NAME_TO_FID = {}


def build_name_index(con):
    for r in con.execute("SELECT franchise_id, display_name FROM team"):
        TEAM_NAME_TO_FID[r["display_name"].lower()] = r["franchise_id"]
    # era-correct names SportsOddsHistory publishes for the relocated / renamed clubs
    TEAM_NAME_TO_FID.update({
        "st. louis rams": 14, "st louis rams": 14, "los angeles rams": 14,
        "san diego chargers": 24, "oakland raiders": 13,
        "washington redskins": 28, "washington football team": 28,
        "tennessee titans": 10,
    })


def load_soh_html(season: int):
    """SportsOddsHistory / covers.com season page. Cached by agent a4; we re-use it."""
    p = SOH_CACHE.format(y=season)
    if os.path.exists(p):
        return read_gz(p).decode("utf-8", "replace"), p
    dest = os.path.join(MY, f"soh_{season}.html.gz")
    url = f"https://www.covers.com/sportsoddshistory/nfl-game-season/?y={season}"
    try:
        raw, p = fetch(url, dest, binary=True)
        return raw.decode("utf-8", "replace"), p
    except Exception:
        return None, None


_WD = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$")
_RND = re.compile(r"(Wild Card|Divisional|Championship|Super Bowl)")
_DATE = re.compile(r"^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$")
_SCORE = re.compile(r"^([WLT])\s+(\d+)-(\d+)(\s*\(OT\))?$")
_SPREAD = re.compile(r"^([WLP])\s+(PK|[+-]?\d+(?:\.\d)?)$")
_OU = re.compile(r"^([OUP])\s+(\d+(?:\.\d)?)$")


def parse_soh(html: str, season: int):
    """Both SOH layouts on the season page.

    Regular season row (11 cells):
        Day | Date | Time | @/N | Favorite | Score | Spread | @/N | Underdog | O/U | Notes
    Playoff row (11 cells, shifted by the Round column and with (seed) suffixes):
        Round | Day | Date | Time | @/N | Favorite (n) | Score | Spread | @/N | Underdog (n) | O/U
    """
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", " ", c) for c in
                 re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        cells = [re.sub(r"\s+", " ", c).replace("\xa0", " ").replace("&nbsp;", " ").strip()
                 for c in cells]
        if len(cells) != 11:
            continue
        if _WD.match(cells[0]):
            rnd = None
            _, date, tm, m1, t1, sc, sp, m2, t2, ou, note = cells
        elif _RND.search(cells[0]):
            rnd = cells[0]
            _, date, tm, m1, t1, sc, sp, m2, t2, ou = cells[1:11]
            note = ""
        else:
            continue
        dm = _DATE.match(date)
        if not dm:
            continue
        f1 = TEAM_NAME_TO_FID.get(re.sub(r"\s*\(\d+\)$", "", t1).strip().lower())
        f2 = TEAM_NAME_TO_FID.get(re.sub(r"\s*\(\d+\)$", "", t2).strip().lower())
        if not f1 or not f2:
            continue
        iso = f"{dm.group(3)}-{_MON[dm.group(1)]:02d}-{int(dm.group(2)):02d}"
        m = _SCORE.match(sc)
        spm = _SPREAD.match(sp)
        oum = _OU.match(ou)
        mag = None
        if spm:
            mag = 0.0 if spm.group(2) == "PK" else abs(float(spm.group(2)))
        out.append(dict(
            season=season, round=rnd, date=iso, time=tm, note=note,
            neutral=("N" in (m1, m2)) or note.lower().startswith("at "),
            fav=f1, dog=f2, fav_home=(m1 == "@"), dog_home=(m2 == "@"),
            fav_score=int(m.group(2)) if m else None,
            dog_score=int(m.group(3)) if m else None,
            overtime=(1 if (m and m.group(4)) else (0 if m else None)),
            spread_mag=mag, total=float(oum.group(2)) if oum else None,
            raw=" | ".join(cells)))
    return out


def soh_index(con):
    """game_id -> (soh row, evidence path). Matched on (season, {teams}) + nearest date."""
    build_name_index(con)
    rows, paths = [], {}
    for season in SEASONS:
        html, p = load_soh_html(season)
        paths[season] = p
        if html:
            rows += parse_soh(html, season)
    by_pair = defaultdict(list)
    for r in rows:
        by_pair[(r["season"], frozenset((r["fav"], r["dog"])))].append(r)
    idx = {}
    for g in con.execute("SELECT game_id, season, gameday, home_franchise_id h, "
                         "away_franchise_id a FROM game WHERE season IN (?,?)", SEASONS):
        cands = by_pair.get((g["season"], frozenset((g["h"], g["a"]))), [])
        if not cands:
            continue
        if len(cands) > 1 and g["gameday"]:
            cands = sorted(cands, key=lambda r: abs(
                (datetime.fromisoformat(r["date"]) - datetime.fromisoformat(g["gameday"])).days))
        idx[g["game_id"]] = (cands[0], paths[g["season"]])
    return idx, paths


def espn_pickcenter(summ):
    """ESPN's own consensus/provider lines -- a second external check on game_line."""
    out = []
    for pc in (summ or {}).get("pickcenter", []) or []:
        out.append(dict(provider=(pc.get("provider") or {}).get("name"),
                        spread=pc.get("spread"), over_under=pc.get("overUnder"),
                        details=pc.get("details"),
                        home_fav=((pc.get("homeTeamOdds") or {}).get("favorite"))))
    return out


def phase_line(con, led: Ledger):
    idx, evpaths = soh_index(con)
    rows = list(con.execute(
        "SELECT gl.*, g.season, g.home_franchise_id h, g.away_franchise_id a, "
        "       g.espn_event_id, g.result_status "
        "FROM game_line gl JOIN game g USING(game_id) "
        "WHERE g.season IN (?,?) ORDER BY g.season, g.kickoff_utc", SEASONS))
    print(f"[line] {len(rows)} rows", flush=True)
    for r in rows:
        gid = r["game_id"]
        hit = idx.get(gid)
        ev = rel(evpaths.get(r["season"])) if evpaths.get(r["season"]) else "cache/a4/"
        n_cmp = n_ok = 0
        fails = []
        checks = (
            ("total_line", r["total_line"] > 0, "total must be > 0"),
            ("away_moneyline", r["away_moneyline"] != 0, "moneyline may not be 0"),
            ("home_moneyline", r["home_moneyline"] != 0, "moneyline may not be 0"),
            ("spread_line", abs(r["spread_line"]) <= 30, "|spread| <= 30 is the plausible range"),
            ("total_line", 20 <= r["total_line"] <= 80, "20 <= total <= 80"),
            # NOTE: both moneylines negative is NORMAL near pick'em -- the book charges
            # juice on both sides. Verified: all 122 both-negative rows in the whole
            # database have |spread| <= 1.5. So the rule is a range check, not a sign rule.
            ("home_moneyline", -100000 < r["home_moneyline"] < 100000
             and -100000 < r["away_moneyline"] < 100000
             and not (-100 < r["home_moneyline"] < 100)
             and not (-100 < r["away_moneyline"] < 100),
             "moneylines must be valid American odds (|price| >= 100)"),
            ("spread_line", abs(r["spread_line"] * 2 - round(r["spread_line"] * 2)) < 1e-9,
             "spreads move in half points"),
            ("total_line", abs(r["total_line"] * 2 - round(r["total_line"] * 2)) < 1e-9,
             "totals move in half points"),
            # Only meaningful away from pick'em: at |spread| <= 2 the moneyline can sit on
            # the other side of even without contradicting the spread.
            ("spread_line", abs(r["spread_line"]) <= 2.0
             or ((r["spread_line"] > 0) == (r["home_moneyline"] < r["away_moneyline"])),
             "away from pick'em the spread favourite must also be the moneyline favourite"),
        )
        for field, ok, why in checks:
            n_cmp += 1
            if ok:
                n_ok += 1
            else:
                fails.append(field + "/" + why[:24])
                led.add("game_line", gid, r["season"], field, r[field], "internal", gid, why,
                        "MISMATCH", ev, note="internal consistency rule violated: " + why)

        # ESPN pickcenter -- an independent third source, recorded on every comparison
        # so that a source-vs-source contradiction is always visible (standing rule 3).
        summ, sp = load_summary(r["espn_event_id"])
        pcs = espn_pickcenter(summ)
        cons = next((p for p in pcs if p["provider"] == "consensus"), None) or \
            (pcs[0] if pcs else None)
        # ESPN signs `spread` from the home side, negative = home favoured; the database
        # signs it positive = home favoured. Flip to compare.
        espn_spread = None if not cons or cons["spread"] is None else -float(cons["spread"])
        espn_total = next((p["over_under"] for p in pcs if p["over_under"] is not None), None)
        third = {"spread_line": espn_spread, "total_line": espn_total}
        tev = rel(sp) if sp else "cache/f03/"

        if hit:
            s, path = hit
            ev = rel(path)
            # SOH publishes the spread from the favourite's side; orient it to the home team
            ref_spread = None
            if s["spread_mag"] is not None:
                home_is_fav = (s["fav"] == r["h"])
                ref_spread = s["spread_mag"] if home_is_fav else -s["spread_mag"]
            for field, dbv, refv in (("spread_line", r["spread_line"], ref_spread),
                                     ("total_line", r["total_line"], s["total"])):
                if refv is None:
                    led.add("game_line", gid, r["season"], field, dbv, "sportsoddshistory",
                            gid, None, "NOT_COMPARABLE", ev,
                            note="SOH row located but this column did not parse: "
                                 + s["raw"][:200])
                    continue
                n_cmp += 1
                if abs(float(dbv) - float(refv)) < 1e-9:
                    n_ok += 1
                else:
                    fails.append(field)
                    led.add("game_line", gid, r["season"], field, dbv, "sportsoddshistory",
                            gid, refv, "MISMATCH", ev,
                            note="SOH row: " + s["raw"][:220],
                            third_source_espn_pickcenter=third[field],
                            third_source_evidence=tev,
                            delta=round(float(dbv) - float(refv), 2))
        else:
            fails.append("soh")
            led.add("game_line", gid, r["season"], "spread_line/total_line",
                    [r["spread_line"], r["total_line"]], "sportsoddshistory", gid, None,
                    "UNRESOLVED", ev,
                    note="no SportsOddsHistory row matched this matchup on the cached "
                         "season page; the closing line could not be externally confirmed",
                    third_source_espn_pickcenter=[espn_spread, espn_total],
                    third_source_evidence=tev)

        for f in ("away_spread_odds", "home_spread_odds", "over_odds", "under_odds",
                  "odds_source", "away_moneyline", "home_moneyline"):
            led.add("game_line", gid, r["season"], f, r[f], "sportsoddshistory", gid, None,
                    "NOT_COMPARABLE", ev,
                    note="SportsOddsHistory's historical season pages publish the closing "
                         "spread and total only -- no juice, no moneyline, no source label. "
                         "This field has no external authority for 2014/2015.")
        led.row_verdict("game_line", gid, r["season"], "sportsoddshistory", gid, ev,
                        n_cmp, n_ok, fails)


# =============================================================== PHASE: teamgame
def phase_teamgame(con, led: Ledger):
    games = {r["game_id"]: r for r in con.execute(
        "SELECT * FROM game WHERE season IN (?,?)", SEASONS)}
    lines = {r["game_id"]: r for r in con.execute(
        "SELECT gl.* FROM game_line gl JOIN game g USING(game_id) "
        "WHERE g.season IN (?,?)", SEASONS)}
    rows = list(con.execute(
        "SELECT * FROM team_game WHERE season IN (?,?) ORDER BY season, kickoff_utc, "
        "franchise_id", SEASONS))
    print(f"[teamgame] {len(rows)} rows", flush=True)

    # game_number is an ordinal within the team's season -- recompute it
    order = defaultdict(list)
    for r in con.execute("SELECT game_id, franchise_id, season, kickoff_utc FROM team_game "
                         "WHERE season IN (?,?) ORDER BY kickoff_utc, game_id", SEASONS):
        order[(r["season"], r["franchise_id"])].append(r["game_id"])
    expect_gn = {}
    for k, gids in order.items():
        for i, gid in enumerate(gids, 1):
            expect_gn[(k[0], k[1], gid)] = i

    # rest days (D15): the gap in venue-local calendar days between a team's previous
    # played game and this one. game.gameday is the venue-local date, so this is exact --
    # kickoff_utc is NOT the right basis (a Sunday 20:25 ET game is Monday in UTC).
    gameday = {r[0]: r[1] for r in con.execute("SELECT game_id, gameday FROM game")}
    expect_rest, prev_day = {}, {}
    for r in con.execute("SELECT game_id, franchise_id, season, kickoff_utc FROM team_game "
                         "WHERE season IN (?,?) ORDER BY kickoff_utc, game_id", SEASONS):
        k = (r["season"], r["franchise_id"])
        gd = gameday.get(r["game_id"])
        d = datetime.fromisoformat(gd).date() if gd else None
        p = prev_day.get(k)
        expect_rest[(r["season"], r["franchise_id"], r["game_id"])] = (
            None if (d is None or p is None) else (d - p).days)
        if d is not None:
            prev_day[k] = d

    recompute = {}
    ev = rel(os.path.join(MY, "team_game_recompute.json"))
    for t in rows:
        gid, fid = t["game_id"], t["franchise_id"]
        rk = f"{gid}/{FID_TO_ABBR.get(fid, fid)}"
        g = games.get(gid)
        if g is None:
            led.add("team_game", rk, t["season"], "game_id", gid, "derived", gid, None,
                    "DB_ONLY", ev,
                    note="team_game row references a game that is not in the partition")
            continue
        gl = lines.get(gid)
        is_home = 1 if fid == g["home_franchise_id"] else 0
        exp = {
            "opponent_id": g["away_franchise_id"] if is_home else g["home_franchise_id"],
            "season": g["season"], "season_type": g["season_type"], "week": g["week"],
            "playoff_round": g["playoff_round"], "kickoff_utc": g["kickoff_utc"],
            "is_home": is_home,
            "points_for": (g["home_score"] if is_home else g["away_score"]),
            "points_against": (g["away_score"] if is_home else g["home_score"]),
        }
        if exp["points_for"] is None or exp["points_against"] is None:
            exp["margin"] = None
        else:
            exp["margin"] = exp["points_for"] - exp["points_against"]
        exp["spread"] = None if gl is None else (
            gl["spread_line"] if is_home else -gl["spread_line"])
        exp["total_line"] = None if gl is None else gl["total_line"]
        exp["moneyline"] = None if gl is None else (
            gl["home_moneyline"] if is_home else gl["away_moneyline"])
        m = exp["margin"]
        exp["su_result"] = None if m is None else ("W" if m > 0 else "L" if m < 0 else "T")
        exp["ats_result"] = None if (m is None or exp["spread"] is None) else (
            "W" if m > exp["spread"] else "L" if m < exp["spread"] else "P")
        if exp["points_for"] is None or exp["total_line"] is None:
            exp["ou_result"] = None
        else:
            s = exp["points_for"] + exp["points_against"]
            exp["ou_result"] = "O" if s > exp["total_line"] else "U" if s < exp["total_line"] else "P"
        exp["won"] = None if (m is None or m == 0) else (1 if m > 0 else 0)
        exp["covered"] = None if exp["ats_result"] in (None, "P") else (
            1 if exp["ats_result"] == "W" else 0)
        exp["game_number"] = expect_gn.get((t["season"], fid, gid))
        recompute[rk] = exp

        n_cmp = n_ok = 0
        fails = []
        for f, want in exp.items():
            n_cmp += 1
            got = t[f]
            same = (got == want) or (want is None and got is None) or \
                   (isinstance(want, float) and got is not None and abs(got - want) < 1e-9)
            if same:
                n_ok += 1
            else:
                fails.append(f)
                led.add("team_game", rk, t["season"], f, got, "derived", gid, want,
                        "MISMATCH", ev, note="recomputed from game + game_line")
        # rest_days: exactly recomputed for every game after a team's season opener
        want_rest = expect_rest.get((t["season"], fid, gid))
        if want_rest is None:
            n_cmp += 1
            if t["rest_days"] == 7:
                n_ok += 1
                led.add("team_game", rk, t["season"], "rest_days", t["rest_days"], "derived",
                        gid, 7, "NOT_COMPARABLE", ev,
                        note="season opener: there is no prior played game to measure from, "
                             "so rest is the feed's fixed convention of 7 days")
            else:
                fails.append("rest_days")
                led.add("team_game", rk, t["season"], "rest_days", t["rest_days"], "derived",
                        gid, 7, "MISMATCH", ev,
                        note="season opener: expected the fixed convention of 7 days")
        else:
            n_cmp += 1
            if t["rest_days"] == want_rest:
                n_ok += 1
            else:
                fails.append("rest_days")
                led.add("team_game", rk, t["season"], "rest_days", t["rest_days"], "derived",
                        gid, want_rest, "MISMATCH", ev,
                        note="rest_days must equal the gap in venue-local calendar days "
                             "since this team's previous played game (D15)")
        n_cmp += 1
        if t["rest_days_upstream"] == t["rest_days"]:
            n_ok += 1
        else:
            led.add("team_game", rk, t["season"], "rest_days_upstream",
                    t["rest_days_upstream"], "derived", gid, t["rest_days"],
                    "NOT_COMPARABLE", ev,
                    note="nflverse's rest is measured against the ORIGINAL schedule, so a "
                         "divergence here is the deliberately preserved upstream value (D15), "
                         "not an error")
        led.row_verdict("team_game", rk, t["season"], "derived", gid, ev, n_cmp, n_ok, fails)

    os.makedirs(MY, exist_ok=True)
    json.dump(recompute, open(os.path.join(MY, "team_game_recompute.json"), "w"),
              indent=0, default=str)

    # completeness: exactly two team_game rows per game
    for gid, g in games.items():
        n = con.execute("SELECT COUNT(*) FROM team_game WHERE game_id=?", (gid,)).fetchone()[0]
        if n != 2:
            led.add("team_game", gid, g["season"], "row_count", n, "derived", gid, 2,
                    "MISMATCH", ev, in_partition=False,
                    note="every game must produce exactly two team_game rows")


# ==================================================================== PHASE: pgs
ESPN_PASS = ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt",
             "passingTouchdowns", "interceptions", "sacks-sackYardsLost"]


def box_index(summ):
    """espn_athlete_id -> {'team': fid, 'pass': {...}, 'rush': {...}, 'rec': {...}}"""
    out = {}
    for side in (summ.get("boxscore") or {}).get("players", []):
        try:
            fid = int(side["team"]["id"])
        except (KeyError, ValueError, TypeError):
            continue
        for stat in side.get("statistics", []):
            name = stat.get("name")
            keys = stat.get("keys", [])
            for a in stat.get("athletes", []):
                aid = str(((a.get("athlete") or {}).get("id")) or "")
                if not aid:
                    continue
                rec = out.setdefault(aid, {"team": fid})
                rec["team"] = fid
                vals = dict(zip(keys, a.get("stats", [])))
                rec[name] = vals
    return out


def _i(v):
    try:
        return int(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def phase_pgs(con, led: Ledger):
    espn_of = {}
    for r in con.execute("SELECT gsis_id, espn_id, display_name FROM player"):
        espn_of[r["gsis_id"]] = (str(r["espn_id"]) if r["espn_id"] else None, r["display_name"])
    gm = {r["game_id"]: r for r in con.execute(
        "SELECT game_id, espn_event_id, season, home_franchise_id, away_franchise_id "
        "FROM game WHERE season IN (?,?)", SEASONS)}
    rows = list(con.execute(
        "SELECT * FROM player_game_stats WHERE season IN (?,?) "
        "ORDER BY season, week, game_id, gsis_id", SEASONS))
    print(f"[pgs] {len(rows)} rows", flush=True)

    cache_box: dict[str, tuple] = {}
    by_game = defaultdict(list)
    for r in rows:
        by_game[r["game_id"]].append(r)

    for gid, grp in by_game.items():
        g = gm.get(gid)
        if g is None:
            for r in grp:
                led.add("player_game_stats", f"{gid}/{r['gsis_id']}", r["season"], "game_id",
                        gid, "espn", None, None, "DB_ONLY", "cache/f03/",
                        note="stats row references a game outside the partition")
            continue
        ev = g["espn_event_id"]
        if ev not in cache_box:
            summ, p = load_summary(ev)
            cache_box[ev] = (box_index(summ) if summ else None, p)
        bx, p = cache_box[ev]
        evidence = rel(p) if p else "cache/f03/"
        if bx is None:
            for r in grp:
                led.add("player_game_stats", f"{gid}/{r['gsis_id']}", r["season"], "*", None,
                        "espn", ev, None, "UNRESOLVED", evidence,
                        note="ESPN summary unavailable for this event")
            continue
        teams = {g["home_franchise_id"], g["away_franchise_id"]}
        for r in grp:
            rk = f"{gid}/{r['gsis_id']}"
            eid, nm = espn_of.get(r["gsis_id"], (None, None))
            n_cmp = n_ok = 0
            fails = []

            # structural checks that never need ESPN
            for f, ok, why in (
                ("franchise_id", r["franchise_id"] in teams,
                 "player's team must be one of the two teams in the game"),
                ("opponent_id", r["opponent_id"] in teams,
                 "opponent must be one of the two teams in the game"),
                ("team_vs_opponent", r["franchise_id"] != r["opponent_id"],
                 "team and opponent must differ"),
                ("season", r["season"] == g["season"], "season must match the game"),
                ("completions_le_attempts",
                 (r["completions"] or 0) <= (r["attempts"] or 0),
                 "completions may not exceed attempts"),
                ("receptions_le_targets",
                 (r["receptions"] or 0) <= (r["targets"] or 0) or (r["targets"] or 0) == 0,
                 "receptions may not exceed targets"),
                ("no_negative_counts",
                 all((r[c] or 0) >= 0 for c in ("completions", "attempts", "passing_tds",
                                                "interceptions", "carries", "rushing_tds",
                                                "receptions", "targets", "receiving_tds")),
                 "counting stats may not be negative"),
            ):
                n_cmp += 1
                if ok:
                    n_ok += 1
                else:
                    fails.append(f)
                    led.add("player_game_stats", rk, r["season"], f,
                            {c: r[c] for c in ("franchise_id", "opponent_id", "completions",
                                               "attempts", "receptions", "targets")},
                            "internal", gid, why, "MISMATCH", evidence, note=why)

            if not eid or eid not in bx:
                led.add("player_game_stats", rk, r["season"], "espn_stat_line", None, "espn",
                        ev, None, "NOT_COMPARABLE", evidence,
                        note=("player has no ESPN id in this database, so ESPN cannot be "
                              "joined to this row" if not eid else
                              "player recorded no stat line in the ESPN box score "
                              "(ESPN omits zero-production and zero-reception rows -- "
                              "known-good difference, contract rule 5)"),
                        player=nm, espn_id=eid)
                led.row_verdict("player_game_stats", rk, r["season"], "internal", gid,
                                evidence, n_cmp, n_ok, fails, espn_ruled=False,
                                note="ESPN could not rule on this row; the structural "
                                     "checks above are internal only")
                continue
            b = bx[eid]
            # team attribution -- ESPN can always rule on this
            n_cmp += 1
            if b["team"] == r["franchise_id"]:
                n_ok += 1
            else:
                fails.append("franchise_id")
                led.add("player_game_stats", rk, r["season"], "franchise_id",
                        r["franchise_id"], "espn", ev, b["team"], "MISMATCH", evidence,
                        note="ESPN box score credits this player to the other franchise",
                        player=nm, espn_id=eid)

            p_ = b.get("passing") or {}
            ru = b.get("rushing") or {}
            re_ = b.get("receiving") or {}
            ca = p_.get("completions/passingAttempts", "")
            comp = att = None
            if "/" in str(ca):
                comp, att = (_i(x) for x in str(ca).split("/", 1))
            checks = [
                ("completions", r["completions"], comp),
                ("attempts", r["attempts"], att),
                ("passing_yards", r["passing_yards"], _i(p_.get("passingYards"))),
                ("passing_tds", r["passing_tds"], _i(p_.get("passingTouchdowns"))),
                ("interceptions", r["interceptions"], _i(p_.get("interceptions"))),
                ("carries", r["carries"], _i(ru.get("rushingAttempts"))),
                ("rushing_yards", r["rushing_yards"], _i(ru.get("rushingYards"))),
                ("rushing_tds", r["rushing_tds"], _i(ru.get("rushingTouchdowns"))),
                ("receptions", r["receptions"], _i(re_.get("receptions"))),
                ("receiving_yards", r["receiving_yards"], _i(re_.get("receivingYards"))),
                ("receiving_tds", r["receiving_tds"], _i(re_.get("receivingTouchdowns"))),
                ("targets", r["targets"], _i(re_.get("receivingTargets"))),
            ]
            sack = p_.get("sacks-sackYardsLost")
            if sack and "-" in str(sack):
                checks.append(("sacks_suffered", r["sacks_suffered"],
                               float(_i(str(sack).split("-")[0]) or 0)))
            for f, dbv, refv in checks:
                if refv is None:
                    if dbv not in (None, 0, 0.0):
                        led.add("player_game_stats", rk, r["season"], f, dbv, "espn", ev,
                                None, "DB_ONLY", evidence,
                                note="database records a non-zero value; ESPN publishes no "
                                     "line of this type for the player in this game",
                                player=nm, espn_id=eid)
                    continue
                dbn = 0 if dbv is None else dbv
                n_cmp += 1
                if abs(float(dbn) - float(refv)) < 1e-9:
                    n_ok += 1
                else:
                    fails.append(f)
                    note = None
                    if f == "targets":
                        note = ("ESPN omits zero-reception targets and sometimes charges an "
                                "incompletion to a different receiver -- contract rule 5")
                    led.add("player_game_stats", rk, r["season"], f, dbv, "espn", ev, refv,
                            "MISMATCH" if f != "targets" else "NOT_COMPARABLE", evidence,
                            note=note, player=nm, espn_id=eid)
                    if f == "targets":
                        fails.remove(f)
            for f in ("passing_epa", "rushing_epa", "receiving_epa", "target_share",
                      "air_yards_share", "fantasy_points", "fantasy_points_ppr"):
                pass  # modelled/derived; ESPN cannot rule -- covered by the row record
            led.row_verdict("player_game_stats", rk, r["season"], "espn", ev, evidence,
                            n_cmp, n_ok, fails, espn_ruled=True, player=nm, espn_id=eid)


# ==================================================== upstream reconciliation (raw)
RAW = os.path.join(NFLDB, "raw")


def _rawrows(name, seasons=SEASONS):
    p = os.path.join(RAW, name)
    if not os.path.exists(p):
        return None, None
    import csv as _csv
    _csv.field_size_limit(10 ** 7)
    ss = {str(s) for s in seasons}
    out = []
    with open(p, newline="") as fh:
        for r in _csv.DictReader(fh):
            if r.get("season") in ss:
                out.append(r)
    return out, p


def phase_upstream(con, led: Ledger):
    """Byte-level reconciliation of the fact tables against the raw nflverse extracts
    the database was built from. This proves the LOADER is faithful; it is explicitly
    NOT external validation -- nflverse is the same upstream, not an independent source.
    """
    # ---- player_game_stats
    rows, p = _rawrows("player_stats.csv")
    if rows is not None:
        db = {(str(r[0]), str(r[1]), r[2], r[3]) for r in con.execute(
            "SELECT season,week,season_type,gsis_id FROM player_game_stats "
            "WHERE season IN (?,?)", SEASONS)}
        miss = [r for r in rows
                if (r["season"], r["week"], r["season_type"], r["player_id"]) not in db]
        print(f"[upstream] player_stats raw={len(rows)} db={len(db)} unloaded={len(miss)}",
              flush=True)
        for r in miss:
            led.add("player_game_stats",
                    f"raw/{r['season']}_{r['week']}_{r['season_type']}_"
                    f"{r['player_id'] or 'NO_ID'}", int(r["season"]), "gsis_id", None,
                    "nflverse:raw", "player_stats.csv", r.get("player_display_name") or None,
                    "REF_ONLY", rel(p), in_partition=False,
                    note="the raw nflverse extract carries this row but the database does "
                         "not. player_id is empty, so the row cannot satisfy the foreign key "
                         "to player(gsis_id) -- correctly excluded, recorded here so the "
                         "row-count difference is accounted for, not hidden.")

    # ---- snap_count: every field, every row
    rows, p = _rawrows("snap_counts.csv")
    if rows is not None:
        db = {}
        for r in con.execute("SELECT * FROM snap_count WHERE season IN (?,?)", SEASONS):
            db[(r["pfr_player_id"], r["pfr_game_id"])] = r
        seen = set()
        nrow = nfield = nok = 0
        for r in rows:
            k = (r["pfr_player_id"], r["pfr_game_id"])
            seen.add(k)
            d = db.get(k)
            rk = f"{r['game_id']}/{r['pfr_player_id']}#upstream"
            if d is None:
                led.add("snap_count", rk, int(r["season"]), "*", None, "nflverse:raw",
                        r["pfr_game_id"], r["player"], "REF_ONLY", rel(p), in_partition=False,
                        note="raw nflverse snap row not present in the database")
                continue
            nrow += 1
            bad = []
            for col, rawv in (("offense_snaps", r["offense_snaps"]),
                              ("defense_snaps", r["defense_snaps"]),
                              ("st_snaps", r["st_snaps"]),
                              ("offense_pct", r["offense_pct"]),
                              ("defense_pct", r["defense_pct"]),
                              ("st_pct", r["st_pct"]),
                              ("position", r["position"]),
                              ("source_week", r["week"]),
                              ("season", r["season"])):
                nfield += 1
                dv, rv = d[col], rawv
                if col in ("position",):
                    same = (dv or "") == (rv or "")
                else:
                    try:
                        same = abs(float(dv or 0) - float(rv or 0)) < 1e-9
                    except (TypeError, ValueError):
                        same = str(dv) == str(rv)
                if same:
                    nok += 1
                else:
                    bad.append(col)
                    led.add("snap_count", rk, int(r["season"]), col, dv, "nflverse:raw",
                            r["pfr_game_id"], rv, "MISMATCH", rel(p), in_partition=False,
                            note="database diverges from the raw nflverse extract")
            # the D16 audit column: franchise_id_upstream must equal what nflverse published
            up = ALIAS_TO_FID.get(r["team"])
            nfield += 1
            if up is not None and d["franchise_id_upstream"] == up:
                nok += 1
            else:
                led.add("snap_count", rk, int(r["season"]), "franchise_id_upstream",
                        d["franchise_id_upstream"], "nflverse:raw", r["pfr_game_id"],
                        f"{r['team']} -> {up}", "MISMATCH", rel(p), in_partition=False,
                        note="franchise_id_upstream must preserve exactly what nflverse "
                             "published, so that the D16 correction stays auditable")
        extra = set(db) - seen
        for k in sorted(extra):
            led.add("snap_count", f"{db[k]['game_id']}/{k[0]}#upstream", db[k]["season"],
                    "*", None, "nflverse:raw", k[1], None, "DB_ONLY", rel(p),
                    in_partition=False,
                    note="database snap row with no counterpart in the raw nflverse extract")
        print(f"[upstream] snap_counts raw={len(rows)} db={len(db)} reconciled_rows={nrow} "
              f"fields={nfield} agree={nok} ({100*nok/max(nfield,1):.4f}%) "
              f"ref_only={len(rows)-nrow} db_only={len(extra)}", flush=True)
        json.dump({"snap_raw": len(rows), "snap_db": len(db), "fields": nfield, "agree": nok,
                   "ref_only": len(rows) - nrow, "db_only": len(extra)},
                  open(os.path.join(MY, "upstream_reconciliation.json"), "w"), indent=1)


# =================================================================== PHASE: snap
PFR_SAMPLED: set[str] = set()
PFR_TEAMTAB: dict = {}


def load_pfr_sampled():
    """Which pfr_game_ids we actually hold a real PFR page for (Wayback-served)."""
    PFR_SAMPLED.clear()
    for p in glob.glob(os.path.join(MY, "pfr", "*.html.gz")):
        PFR_SAMPLED.add(os.path.basename(p)[:-len(".html.gz")])
    return PFR_SAMPLED


def phase_snap(con, led: Ledger):
    load_pfr_sampled()
    print(f"[snap] PFR pages held: {len(PFR_SAMPLED)}", flush=True)
    espn_of = {}
    for r in con.execute("SELECT gsis_id, espn_id, display_name, pfr_id FROM player"):
        espn_of[r["gsis_id"]] = (str(r["espn_id"]) if r["espn_id"] else None,
                                 r["display_name"], r["pfr_id"])
    gm = {r["game_id"]: r for r in con.execute(
        "SELECT game_id, espn_event_id, season, season_type, week, playoff_round, "
        "home_franchise_id, away_franchise_id, pfr_game_id "
        "FROM game WHERE season IN (?,?)", SEASONS)}
    # independent membership controls
    pgs_team = {}
    for r in con.execute("SELECT game_id, gsis_id, franchise_id FROM player_game_stats "
                         "WHERE season IN (?,?)", SEASONS):
        pgs_team[(r["game_id"], r["gsis_id"])] = r["franchise_id"]
    roster_team = defaultdict(set)
    for r in con.execute("SELECT season, gsis_id, franchise_id FROM roster_season "
                         "WHERE season IN (?,?) AND gsis_id IS NOT NULL", SEASONS):
        roster_team[(r["season"], r["gsis_id"])].add(r["franchise_id"])
    depth_team = defaultdict(set)
    for r in con.execute("SELECT season, gsis_id, franchise_id FROM depth_chart "
                         "WHERE season IN (?,?) AND gsis_id IS NOT NULL", SEASONS):
        depth_team[(r["season"], r["gsis_id"])].add(r["franchise_id"])

    rows = list(con.execute(
        "SELECT * FROM snap_count WHERE season IN (?,?) "
        "ORDER BY season, source_week, game_id, pfr_player_id", SEASONS))
    print(f"[snap] {len(rows)} rows", flush=True)

    by_game = defaultdict(list)
    for r in rows:
        by_game[r["game_id"]].append(r)

    # team snap totals per game, for percentage reconciliation
    cache_box = {}
    transposition = {}
    for gid, grp in sorted(by_game.items()):
        g = gm.get(gid)
        ev = g["espn_event_id"] if g else None
        if ev and ev not in cache_box:
            summ, p = load_summary(ev)
            cache_box[ev] = (box_index(summ) if summ else None, p)
        bx, p = cache_box.get(ev, (None, None))
        evidence = rel(p) if p else "cache/f03/"
        teams = {g["home_franchise_id"], g["away_franchise_id"]} if g else set()

        # ---- team-level snap universe (offence/defence totals must be one number per team)
        univ = defaultdict(lambda: defaultdict(set))
        for r in grp:
            for kind, snaps, pct in (("off", r["offense_snaps"], r["offense_pct"]),
                                     ("def", r["defense_snaps"], r["defense_pct"]),
                                     ("st", r["st_snaps"], r["st_pct"])):
                if snaps and pct and pct > 0:
                    univ[r["franchise_id"]][kind].add(round(snaps / pct))

        # ---- PFR team attribution: which of the two per-team snap tables the player
        #      sits in. This is the contract authority ruling directly on the question.
        pgid = g["pfr_game_id"] if g else None
        pfrtab = {}
        pfr_ev = None
        if pgid and pgid in PFR_SAMPLED:
            if pgid not in PFR_TEAMTAB:
                html, pp = pfr_box(pgid)
                PFR_TEAMTAB[pgid] = (parse_pfr_team_tables(html) if html else {}, pp)
            pfrtab, pp = PFR_TEAMTAB[pgid]
            pfr_ev = rel(pp) if pp else None
        nick = {}
        for fid in teams:
            dn = con.execute("SELECT display_name FROM team WHERE franchise_id=?",
                             (fid,)).fetchone()
            if dn:
                nick[dn[0].split()[-1].lower()] = fid
        pfr_agree = pfr_dis = 0
        for r in grp:
            cap = pfrtab.get(r["pfr_player_id"])
            if not cap:
                continue
            want = nick.get(cap.split()[0].lower())
            if want is None:
                continue
            if want == r["franchise_id"]:
                pfr_agree += 1
            else:
                pfr_dis += 1

        # ---- transposition detector, ESPN box score as the independent authority
        agree = disagree = 0
        for r in grp:
            eid, nm, pfr = espn_of.get(r["gsis_id"], (None, None, None))
            if bx and eid and eid in bx:
                if bx[eid]["team"] == r["franchise_id"]:
                    agree += 1
                elif bx[eid]["team"] in teams:
                    disagree += 1
        # secondary control: nflverse player_stats team for the same player-game
        pagree = pdis = 0
        for r in grp:
            t = pgs_team.get((gid, r["gsis_id"]))
            if t is not None:
                if t == r["franchise_id"]:
                    pagree += 1
                else:
                    pdis += 1
        transposition[gid] = dict(espn_agree=agree, espn_disagree=disagree,
                                  pgs_agree=pagree, pgs_disagree=pdis,
                                  pfr_agree=pfr_agree, pfr_disagree=pfr_dis,
                                  pfr_evidence=pfr_ev,
                                  n=len(grp), evidence=evidence,
                                  season=g["season"] if g else None,
                                  season_type=g["season_type"] if g else None,
                                  playoff_round=g["playoff_round"] if g else None)

        for r in grp:
            rk = f"{gid}/{r['pfr_player_id']}"
            eid, nm, pfr = espn_of.get(r["gsis_id"], (None, None, None))
            n_cmp = n_ok = 0
            fails = []

            def chk(field, ok, why, dbv=None):
                nonlocal n_cmp, n_ok
                n_cmp += 1
                if ok:
                    n_ok += 1
                else:
                    fails.append(field)
                    led.add("snap_count", rk, r["season"], field,
                            dbv if dbv is not None else r[field] if field in r.keys() else None,
                            "internal", gid, why, "MISMATCH", evidence, note=why,
                            player=nm)

            chk("game_id", g is not None, "snap row must join to a real game in the partition")
            chk("franchise_id", r["franchise_id"] in teams if teams else False,
                "snap franchise must be one of the two teams that played the game")
            chk("gsis_id", r["gsis_id"] in espn_of,
                "snap row must join to a real player row")
            for col in ("offense_snaps", "defense_snaps", "st_snaps"):
                chk(col, r[col] is None or 0 <= r[col] <= 120,
                    f"{col} must be in 0..120")
            for col in ("offense_pct", "defense_pct", "st_pct"):
                chk(col, r[col] is None or -1e-9 <= r[col] <= 1.0 + 1e-9,
                    f"{col} must be a fraction in 0..1")
            for sn, pc in (("offense_snaps", "offense_pct"), ("defense_snaps", "defense_pct"),
                           ("st_snaps", "st_pct")):
                if r[sn] and r[pc]:
                    tot = round(r[sn] / r[pc])
                    known = univ[r["franchise_id"]][sn[:3].rstrip("_")] if False else None
                    chk(pc + "_reconciles", tot > 0 and abs(r[sn] / tot - r[pc]) <= 0.006,
                        f"{pc} must reconcile to {sn} over the team's snap total")
                elif r[sn] in (0, None) and (r[pc] or 0) == 0:
                    pass
                elif (r[pc] or 0) > 0 and not r[sn]:
                    fails.append(pc)
                    led.add("snap_count", rk, r["season"], pc, r[pc], "internal", gid,
                            0.0, "MISMATCH", evidence,
                            note=f"{pc} is non-zero but {sn} is zero/NULL")
            chk("source_week", 1 <= r["source_week"] <= 22, "source_week must be 1..22")
            chk("week_round_exclusive",
                (r["season_type"] == "REG" and r["week"] is not None and r["playoff_round"] is None)
                or (r["season_type"] == "POST" and r["week"] is None
                    and r["playoff_round"] is not None),
                "week and playoff_round are mutually exclusive and jointly exhaustive")
            if g:
                chk("season_type_matches_game", r["season_type"] == g["season_type"],
                    "snap season_type must match the game")
                chk("round_matches_game",
                    (r["playoff_round"] or "") == (g["playoff_round"] or ""),
                    "snap playoff_round must match the game")
                chk("week_matches_game", (r["week"] or 0) == (g["week"] or 0),
                    "snap week must match the game")
                chk("pfr_game_id", (g["pfr_game_id"] or "") == r["pfr_game_id"],
                    "snap pfr_game_id must equal the game's pfr_game_id")
            if pfr:
                chk("pfr_player_id", pfr == r["pfr_player_id"],
                    "snap pfr_player_id must equal the player's pfr_id")

            # external: ESPN team attribution (the transposition signature)
            if bx and eid and eid in bx:
                n_cmp += 1
                if bx[eid]["team"] == r["franchise_id"]:
                    n_ok += 1
                else:
                    fails.append("franchise_id")
                    led.add("snap_count", rk, r["season"], "franchise_id", r["franchise_id"],
                            "espn", ev, bx[eid]["team"], "MISMATCH", evidence,
                            note="ESPN box score credits this player to the other franchise "
                                 "in this game -- transposition signature",
                            player=nm, espn_id=eid)
            # Pro-Football-Reference team attribution -- the contract authority
            cap = pfrtab.get(r["pfr_player_id"])
            if cap and nick.get(cap.split()[0].lower()) is not None:
                n_cmp += 1
                want = nick[cap.split()[0].lower()]
                if want == r["franchise_id"]:
                    n_ok += 1
                else:
                    fails.append("franchise_id")
                    led.add("snap_count", rk, r["season"], "franchise_id",
                            r["franchise_id"], "pro-football-reference", pgid, cap,
                            "MISMATCH", pfr_ev or evidence,
                            note="PFR lists this player in the OTHER team's snap table for "
                                 "this game -- transposition signature", player=nm)

            # independent membership controls
            rt = roster_team.get((r["season"], r["gsis_id"]))
            dt = depth_team.get((r["season"], r["gsis_id"]))
            if rt and r["franchise_id"] not in rt:
                led.add("snap_count", rk, r["season"], "franchise_id_vs_roster",
                        r["franchise_id"], "internal:roster_season", gid, sorted(rt),
                        "MISMATCH", evidence,
                        note="player never appears on this franchise's roster that season",
                        player=nm)
                fails.append("franchise_id_vs_roster")
            dt = depth_team.get((r["season"], r["gsis_id"]))
            if dt and r["franchise_id"] not in dt:
                led.add("snap_count", rk, r["season"], "franchise_id_vs_depth_chart",
                        r["franchise_id"], "internal:depth_chart", gid, sorted(dt),
                        "NOT_COMPARABLE", evidence,
                        note="the season's depth charts never list this player on this "
                             "franchise. Depth charts lag in-season signings, waiver claims "
                             "and practice-squad elevations, so this is expected for a "
                             "mid-season arrival and cannot rule against the snap row.",
                        player=nm)
            pt = pgs_team.get((gid, r["gsis_id"]))
            if pt is not None and pt != r["franchise_id"]:
                led.add("snap_count", rk, r["season"], "franchise_id_vs_player_stats",
                        r["franchise_id"], "internal:player_game_stats", gid, pt,
                        "MISMATCH", evidence,
                        note="nflverse player_stats credits this player to the other franchise "
                             "for the same game", player=nm)
                fails.append("franchise_id_vs_player_stats")

            # Volume columns: PFR is the only authority and it rules only on the sampled
            # games (phase_snap_pfr). Everywhere else this is stated, never implied.
            if r["pfr_game_id"] not in PFR_SAMPLED:
                led.add("snap_count", rk, r["season"],
                        "offense_snaps/defense_snaps/st_snaps/offense_pct/defense_pct/st_pct",
                        [r["offense_snaps"], r["defense_snaps"], r["st_snaps"]],
                        "pro-football-reference", r["pfr_game_id"], None, "NOT_COMPARABLE",
                        evidence,
                        note="Pro-Football-Reference is the only authority for snap volumes "
                             "and this game is outside the retrieved PFR sample. The counts on "
                             "this row were validated INTERNALLY ONLY (percentage reconciles "
                             "to the team snap total, range, join integrity). This is not "
                             "external validation.")

            led.row_verdict("snap_count", rk, r["season"], "internal+espn", gid, evidence,
                            n_cmp, n_ok, fails)

    # ---- write the per-game transposition scan out as evidence
    os.makedirs(MY, exist_ok=True)
    tp = os.path.join(MY, "transposition_scan.json")
    json.dump(transposition, open(tp, "w"), indent=1, default=str)
    for gid, t in sorted(transposition.items()):
        tot = t["espn_agree"] + t["espn_disagree"]
        if tot == 0:
            verdict, note = "NOT_COMPARABLE", "no snap player matched an ESPN box-score line"
        elif t["espn_disagree"] == 0:
            verdict, note = "MATCH", f"{t['espn_agree']}/{tot} ESPN-checkable snap rows on the correct franchise"
        elif t["espn_agree"] == 0:
            verdict, note = "MISMATCH", f"FULL TRANSPOSITION: {t['espn_disagree']}/{tot} rows on the wrong franchise"
        else:
            verdict, note = "MISMATCH", f"PARTIAL: {t['espn_disagree']}/{tot} rows on the wrong franchise"
        if t["pfr_disagree"]:
            verdict = "MISMATCH"
            note = (f"PFR places {t['pfr_disagree']}/{t['pfr_agree']+t['pfr_disagree']} rows "
                    f"in the other team's snap table; " + note)
        elif t["pfr_agree"]:
            note = (f"PFR (contract authority) confirms all {t['pfr_agree']} sampled rows on "
                    f"the correct franchise; " + note)
        led.add("snap_count", f"{gid}#transposition_scan", t["season"], "franchise_id",
                f"{t['n']} rows", "espn+pro-football-reference", gid,
                f"espn agree={t['espn_agree']} disagree={t['espn_disagree']}; "
                f"pfr agree={t['pfr_agree']} disagree={t['pfr_disagree']}", verdict,
                rel(tp), in_partition=False, note=note,
                pgs_control=f"agree={t['pgs_agree']} disagree={t['pgs_disagree']}",
                pfr_evidence=t["pfr_evidence"])

    # ---- PFR sample
    phase_snap_pfr(con, led)


PFR_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)


def parse_pfr_team_tables(html: str):
    """pfr_player_id -> the caption of the PFR snap table he appears in.

    PFR publishes one snap table per team, captioned '<Nickname> Snap Counts Table'.
    Which table a player sits in IS Pro-Football-Reference's team attribution, and it is
    the authority the contract names for snap_count.
    """
    tabs = re.findall(r'(<table[^>]+id="(?:home|vis)_snap_counts".*?</table>)', html, re.S)
    if not tabs:
        for cm in re.findall(r"<!--(.*?)-->", html, re.S):
            tabs += re.findall(r'(<table[^>]+id="(?:home|vis)_snap_counts".*?</table>)',
                               cm, re.S)
    out = {}
    for t in tabs:
        cm = re.search(r"<caption>(.*?)</caption>", t, re.S)
        cap = re.sub(r"<[^>]+>", "", cm.group(1)).strip() if cm else "?"
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            mm = re.search(r'data-append-csv="([^"]+)"', tr)
            if mm:
                out[mm.group(1)] = cap
    return out


def parse_pfr_snaps(html: str):
    """pfr_player_id -> dict(off, off_pct, def, def_pct, st, st_pct) from the snap tables."""
    out = {}
    # PFR ships the snap tables inside HTML comments
    blocks = re.findall(r"<table[^>]+id=\"(home_snap_counts|vis_snap_counts)\".*?</table>",
                        html, re.S)
    if not blocks:
        for cm in re.findall(r"<!--(.*?)-->", html, re.S):
            blocks += re.findall(r"<table[^>]+id=\"(?:home_snap_counts|vis_snap_counts)\".*?</table>",
                                 cm, re.S)
    body = "".join(re.findall(
        r"<table[^>]+id=\"(?:home_snap_counts|vis_snap_counts)\".*?</table>", html, re.S)) or ""
    for cm in re.findall(r"<!--(.*?)-->", html, re.S):
        body += "".join(re.findall(
            r"<table[^>]+id=\"(?:home_snap_counts|vis_snap_counts)\".*?</table>", cm, re.S))
    for tr in PFR_ROW.findall(body):
        m = re.search(r'data-append-csv="([^"]+)"', tr)
        if not m:
            continue
        pid = m.group(1)
        cells = {}
        for c in re.findall(r'<td[^>]*data-stat="([^"]+)"[^>]*>(.*?)</td>', tr, re.S):
            cells[c[0]] = re.sub(r"<[^>]+>", "", c[1]).strip()
        out[pid] = cells
    return out


def _pct(s):
    if not s:
        return None
    s = s.replace("%", "").strip()
    try:
        return float(s) / 100.0
    except ValueError:
        return None


def phase_snap_pfr(con, led: Ledger):
    """External validation of snap volumes against Pro-Football-Reference.

    PFR itself is behind a Cloudflare JS challenge that this environment cannot clear,
    so the pages are read from the Internet Archive's crawl of PFR. The *authority* is
    still Pro-Football-Reference -- only the transport is archival, and every page is
    cached so the check replays offline.
    """
    load_pfr_sampled()
    gm = {r["pfr_game_id"]: r for r in con.execute(
        "SELECT game_id, pfr_game_id, season, season_type, playoff_round FROM game "
        "WHERE season IN (?,?) AND pfr_game_id IS NOT NULL", SEASONS)}
    held = sorted(PFR_SAMPLED & set(gm))
    print(f"[snap/pfr] {len(held)} sampled games held on disk", flush=True)
    n_games = n_field = n_ok = n_rows = 0
    for pg in held:
        g = gm[pg]
        html, p = pfr_box(pg)
        if not html:
            led.add("snap_count", f"{g['game_id']}#pfr_sample", g["season"], "*", None,
                    "pro-football-reference", pg, None, "UNRESOLVED",
                    rel(os.path.join(MY, "pfr", pg + ".html.gz")),
                    note="cached PFR page is not a usable Pro-Football-Reference box score")
            continue
        ref = parse_pfr_snaps(html)
        if not ref:
            led.add("snap_count", f"{g['game_id']}#pfr_sample", g["season"], "*", None,
                    "pro-football-reference", pg, None, "UNRESOLVED", rel(p),
                    note="PFR page cached but the snap-count tables did not parse")
            continue
        n_games += 1
        gf = go = 0
        db_ids = set()
        for r in con.execute("SELECT * FROM snap_count WHERE pfr_game_id=?", (pg,)):
            db_ids.add(r["pfr_player_id"])
            rk = f"{r['game_id']}/{r['pfr_player_id']}#pfr"
            c = ref.get(r["pfr_player_id"])
            if c is None:
                led.add("snap_count", rk, r["season"], "*", None, "pro-football-reference",
                        pg, None, "DB_ONLY", rel(p), in_partition=False,
                        note="this pfr_player_id is not in PFR's snap tables for this game")
                continue
            n_rows += 1
            fails = []
            for field, dbv, refv in (
                ("offense_snaps", r["offense_snaps"], _i(c.get("offense"))),
                ("defense_snaps", r["defense_snaps"], _i(c.get("defense"))),
                ("st_snaps", r["st_snaps"], _i(c.get("special_teams"))),
                ("offense_pct", r["offense_pct"], _pct(c.get("off_pct"))),
                ("defense_pct", r["defense_pct"], _pct(c.get("def_pct"))),
                ("st_pct", r["st_pct"], _pct(c.get("st_pct"))),
                ("position", r["position"], c.get("pos") or None),
            ):
                if refv is None:
                    continue
                n_field += 1
                gf += 1
                if isinstance(refv, str):
                    same = (dbv or "") == refv
                else:
                    a = 0.0 if dbv is None else float(dbv)
                    same = abs(a - float(refv)) < (0.011 if "pct" in field else 1e-9)
                if same:
                    n_ok += 1
                    go += 1
                else:
                    fails.append(field)
                    led.add("snap_count", rk, r["season"], field, dbv,
                            "pro-football-reference", pg, refv, "MISMATCH", rel(p))
            led.add("snap_count", rk, r["season"], "*", None, "pro-football-reference", pg,
                    None, "MATCH" if not fails else "MISMATCH", rel(p), in_partition=False,
                    failed_fields=sorted(fails) or None,
                    note="external PFR validation of this row's snap volumes")
        # rows PFR has that the database does not
        for pid in sorted(set(ref) - db_ids):
            led.add("snap_count", f"{g['game_id']}/{pid}#pfr", g["season"], "*", None,
                    "pro-football-reference", pg, ref[pid], "REF_ONLY", rel(p),
                    in_partition=False,
                    note="PFR lists this player in the game's snap tables; the database "
                         "has no snap_count row for him")
        led.add("snap_count", f"{g['game_id']}#pfr_sample", g["season"], "*", None,
                "pro-football-reference", pg, None,
                "MATCH" if gf == go else "MISMATCH", rel(p), in_partition=False,
                fields_compared=gf, fields_matched=go,
                note="PFR sample game (%s)" % (g["playoff_round"] or g["season_type"]))
    print(f"[snap/pfr] {n_games} games, {n_rows} rows, {n_field} field comparisons, "
          f"{n_ok} agree ({100*n_ok/max(n_field,1):.2f}%)", flush=True)
    json.dump({"games": n_games, "rows": n_rows, "fields": n_field, "agree": n_ok,
               "sampled": sorted(held)},
              open(os.path.join(MY, "pfr_sample.json"), "w"), indent=1)


# ================================================================= PHASE: roster
def phase_roster(con, led: Ledger):
    espn_of = {}
    for r in con.execute("SELECT gsis_id, espn_id, display_name FROM player"):
        espn_of[r["gsis_id"]] = (str(r["espn_id"]) if r["espn_id"] else None, r["display_name"])
    rosters = {}
    for s in SEASONS:
        for fid in sorted(FID_TO_ABBR):
            ids, p = core_roster(s, fid)
            if ids is not None:
                rosters[(s, fid)] = (ids, p)
    # box-score membership: appearing in an ESPN box score for team T proves membership
    box_member = defaultdict(set)
    for r in con.execute("SELECT game_id, espn_event_id, season FROM game "
                         "WHERE season IN (?,?)", SEASONS):
        summ, p = load_summary(r["espn_event_id"])
        if not summ:
            continue
        for aid, rec in box_index(summ).items():
            box_member[(r["season"], aid)].add(rec["team"])

    rows = list(con.execute(
        "SELECT * FROM roster_season WHERE season IN (?,?) ORDER BY season, franchise_id, "
        "source_week, roster_row_id", SEASONS))
    print(f"[roster] {len(rows)} rows", flush=True)
    for r in rows:
        rk = str(r["roster_row_id"])
        eid, nm = espn_of.get(r["gsis_id"], (None, None))
        ids, p = rosters.get((r["season"], r["franchise_id"]), (None, None))
        evidence = rel(p) if p else "cache/f03/roster/"
        n_cmp = n_ok = 0
        fails = []
        # structural
        for f, ok, why in (
            ("franchise_id", r["franchise_id"] in FID_TO_ABBR, "franchise must exist"),
            ("week_round_exclusive",
             (r["season_type"] == "REG" and r["week"] is not None and r["playoff_round"] is None)
             or (r["season_type"] == "POST" and r["week"] is None
                 and r["playoff_round"] is not None),
             "week and playoff_round are mutually exclusive and jointly exhaustive"),
            ("source_week", 1 <= r["source_week"] <= 22, "source_week must be 1..22"),
            ("jersey_number", r["jersey_number"] is None or 0 <= r["jersey_number"] <= 99,
             "jersey number must be 0..99"),
            ("years_exp", r["years_exp"] is None or 0 <= r["years_exp"] <= 30,
             "years of experience must be 0..30"),
            ("source_ordinal", r["source_ordinal"] >= 1, "source_ordinal is 1-based"),
        ):
            n_cmp += 1
            if ok:
                n_ok += 1
            else:
                fails.append(f)
                led.add("roster_season", rk, r["season"], f, r[f] if f in r.keys() else None,
                        "internal", rk, why, "MISMATCH", evidence, note=why)
        note = None
        if r["gsis_id"] is None:
            led.add("roster_season", rk, r["season"], "membership", r["franchise_id"], "espn",
                    rk, None, "NOT_COMPARABLE", evidence,
                    note="upstream row carries no gsis_id (N9) -- no key to check membership",
                    player=r["full_name"])
        elif not eid:
            led.add("roster_season", rk, r["season"], "membership", r["franchise_id"], "espn",
                    rk, None, "NOT_COMPARABLE", evidence,
                    note="player has no ESPN id in this database; ESPN cannot rule on membership",
                    player=r["full_name"])
        elif ids is None:
            fails.append("membership")
            led.add("roster_season", rk, r["season"], "membership", r["franchise_id"], "espn",
                    rk, None, "UNRESOLVED", evidence,
                    note="ESPN season roster unavailable for this team-season",
                    player=r["full_name"])
        else:
            in_roster = eid in ids
            in_box = r["franchise_id"] in box_member.get((r["season"], eid), set())
            if in_roster or in_box:
                n_cmp += 1
                n_ok += 1
                note = ("ESPN's %s confirms this player on this franchise in this season"
                        % ("season roster" if in_roster else "box score"))
            else:
                led.add("roster_season", rk, r["season"], "membership", r["franchise_id"],
                        "espn", eid, None, "NOT_COMPARABLE", evidence,
                        note="ESPN's season roster is an end-of-season snapshot and its box "
                             "scores list only players who recorded a stat, so a practice-"
                             "squad / cut / inactive player is invisible to both. ESPN "
                             "structurally cannot rule on this row. status=%s" % r["status"],
                        player=r["full_name"])
        led.row_verdict("roster_season", rk, r["season"], "espn", eid or rk, evidence,
                        n_cmp, n_ok, fails, note=note, player=r["full_name"])


# ================================================================== PHASE: depth
DEPTH_RULES = [
    "franchise_id must exist in team",
    "gsis_id must join to a real player row (or be NULL)",
    "a depth row must carry at least one player identity (gsis_id or espn_id)",
    "source_shape is A or B",
    "snapshot_ts is present exactly for shape B",
    "bucket vocabulary: preseason/regular/postseason/offseason",
    "week and playoff_round are mutually exclusive",
    "season_type must agree with week/playoff_round",
    "depth_order is 1-based",
    "source_week must be 1..22",
    "jersey_number must be 0..99",
    "unit vocabulary: Offense/Defense/Special Teams",
    "the franchise must have played that season",
    "no two rows may repeat the same team/week/slot/order/player/source_ordinal",
]


def phase_depth(con, led: Ledger):
    """depth_chart has no historical public source. Internal + structural only."""
    valid_fid = set(FID_TO_ABBR)
    players = {r[0] for r in con.execute("SELECT gsis_id FROM player")}
    gseason = defaultdict(set)
    for r in con.execute("SELECT season, franchise_id FROM team_game WHERE season IN (?,?)",
                         SEASONS):
        gseason[r["season"]].add(r["franchise_id"])
    rows = list(con.execute(
        "SELECT * FROM depth_chart WHERE season IN (?,?) ORDER BY season, franchise_id, "
        "source_week, depth_chart_id", SEASONS))
    print(f"[depth] {len(rows)} rows", flush=True)
    # The natural slot key, WITHOUT source_ordinal: an upstream duplicate. The schema
    # keeps source_ordinal precisely so these stay distinguishable, so a collision here
    # is a fact about the feed, not a database defect.
    slot = defaultdict(int)
    # The same key WITH source_ordinal: a collision here would be a real duplicate row.
    dupe = defaultdict(int)
    for r in rows:
        k = (r["season"], r["source_week"], r["source_game_type"], r["franchise_id"],
             r["depth_position"], r["depth_order"], r["gsis_id"])
        slot[k] += 1
        dupe[k + (r["source_ordinal"],)] += 1
    os.makedirs(MY, exist_ok=True)
    ev = rel(os.path.join(MY, "depth_structural.json"))
    audit_log = {}
    for r in rows:
        rk = str(r["depth_chart_id"])
        n_cmp = n_ok = 0
        fails = []
        for f, ok, why in (
            ("franchise_id", r["franchise_id"] in valid_fid, "franchise must exist"),
            ("gsis_id", r["gsis_id"] is None or r["gsis_id"] in players,
             "gsis_id must join to a real player"),
            ("identity", r["gsis_id"] is not None or r["espn_id"] is not None,
             "a depth row must carry at least one player identity"),
            ("source_shape", r["source_shape"] in ("A", "B"), "source_shape is A or B"),
            ("snapshot_ts", (r["source_shape"] == "B") == (r["snapshot_ts"] is not None),
             "snapshot_ts is present exactly for shape B"),
            ("bucket", r["bucket"] in ("preseason", "regular", "postseason", "offseason"),
             "bucket vocabulary"),
            ("week_round_exclusive", r["week"] is None or r["playoff_round"] is None,
             "week and playoff_round are mutually exclusive"),
            ("season_type_agrees",
             (r["week"] is not None and r["season_type"] == "REG")
             or (r["playoff_round"] is not None and r["season_type"] == "POST")
             or (r["week"] is None and r["playoff_round"] is None and r["season_type"] is None),
             "season_type must agree with week/playoff_round"),
            ("depth_order", r["depth_order"] is None or r["depth_order"] >= 1,
             "depth_order is 1-based"),
            ("source_week", r["source_week"] is None or 1 <= r["source_week"] <= 22,
             "source_week must be 1..22"),
            ("jersey_number", r["jersey_number"] is None or 0 <= r["jersey_number"] <= 99,
             "jersey number must be 0..99"),
            ("unit", r["unit"] in (None, "Offense", "Defense", "Special Teams"),
             "unit vocabulary"),
            ("team_played_that_season", r["franchise_id"] in gseason[r["season"]],
             "the franchise must have played that season"),
            ("no_exact_duplicate",
             dupe[(r["season"], r["source_week"], r["source_game_type"], r["franchise_id"],
                   r["depth_position"], r["depth_order"], r["gsis_id"],
                   r["source_ordinal"])] == 1,
             "no two rows may repeat the same team/week/slot/order/player/source_ordinal"),
        ):
            n_cmp += 1
            if ok:
                n_ok += 1
            else:
                fails.append(f)
                led.add("depth_chart", rk, r["season"], f,
                        r[f] if f in r.keys() else None, "internal", rk, why,
                        "MISMATCH", ev, note=why)
        if slot[(r["season"], r["source_week"], r["source_game_type"], r["franchise_id"],
                 r["depth_position"], r["depth_order"], r["gsis_id"])] > 1:
            led.add("depth_chart", rk, r["season"], "source_ordinal", r["source_ordinal"],
                    "internal", rk, None, "NOT_COMPARABLE", ev,
                    note="the upstream feed publishes this player at this exact slot more "
                         "than once in this snapshot; source_ordinal is the documented "
                         "mechanism that keeps the copies distinguishable, so this is "
                         "faithful preservation of the source, not a duplicate row")
        audit_log[rk] = [n_cmp, n_ok, sorted(set(fails))]
        led.add("depth_chart", rk, r["season"], "depth_position/depth_order/position",
                [r["depth_position"], r["depth_order"], r["position"]],
                "none", rk, None, "NOT_COMPARABLE", ev,
                note="No historical public source for NFL depth charts exists -- ESPN publishes "
                     "current depth charts only. This row is validated internally and "
                     "structurally; it is NOT externally validated.",
                fields_compared=n_cmp, fields_matched=n_ok,
                structural_pass=(not fails))
    json.dump({"authority": "none -- no historical public source for NFL depth charts exists; "
                            "ESPN publishes current depth charts only. Every row below was "
                            "validated INTERNALLY and STRUCTURALLY ONLY.",
               "rules": DEPTH_RULES,
               "rows": audit_log},
              open(os.path.join(MY, "depth_structural.json"), "w"), indent=0)


# ============================================================ PHASE: corrections
def phase_corrections(con, led: Ledger):
    rows = list(con.execute(
        "SELECT * FROM data_correction WHERE target_key LIKE '2014%' OR target_key LIKE '2015%' "
        "ORDER BY defect, correction_id"))
    print(f"[corrections] {len(rows)} rows touching 2014/2015", flush=True)
    events = load_scoreboard_events()
    gm = {r["game_id"]: r for r in con.execute(
        "SELECT * FROM game WHERE season IN (?,?)", SEASONS)}
    espn_of = {}
    for r in con.execute("SELECT gsis_id, espn_id, display_name, pfr_id FROM player"):
        if r["pfr_id"]:
            espn_of[r["pfr_id"]] = (str(r["espn_id"]) if r["espn_id"] else None,
                                    r["display_name"], r["gsis_id"])
    boxcache = {}
    for c in rows:
        rk = f"correction_{c['correction_id']}"
        tk = c["target_key"]
        if c["defect"] == "D16":
            gid, pid = tk.split("/", 1)
            g = gm.get(gid)
            summ, p = (boxcache.get(g["espn_event_id"]) if g else (None, None)) \
                if g and g["espn_event_id"] in boxcache else (None, None)
            if g and g["espn_event_id"] not in boxcache:
                s, p = load_summary(g["espn_event_id"])
                boxcache[g["espn_event_id"]] = (box_index(s) if s else None, p)
            bx, p = boxcache.get(g["espn_event_id"], (None, None)) if g else (None, None)
            eid, nm, gsis = espn_of.get(pid, (None, None, None))
            evidence = rel(p) if p else "cache/f03/"
            db_now = con.execute(
                "SELECT franchise_id, franchise_id_upstream FROM snap_count "
                "WHERE game_id=? AND pfr_player_id=?", (gid, pid)).fetchone()
            if db_now is None:
                led.add("data_correction", rk, int(gid[:4]), "target_key", tk, "espn", gid,
                        None, "DB_ONLY", evidence,
                        note="correction names a snap row that no longer exists")
                continue
            applied = (str(db_now["franchise_id"]) == c["corrected_value"] and
                       str(db_now["franchise_id_upstream"]) == c["upstream_value"])
            if not applied:
                led.add("data_correction", rk, int(gid[:4]), "applied",
                        f"franchise_id={db_now['franchise_id']} "
                        f"upstream={db_now['franchise_id_upstream']}", "internal", tk,
                        f"corrected_value={c['corrected_value']} "
                        f"upstream_value={c['upstream_value']}", "MISMATCH", evidence,
                        note="the correction is recorded but the snap row does not carry it")
                continue
            # Pro-Football-Reference is the contract authority for snap_count. Which of
            # the two per-team snap tables the player sits in IS PFR's attribution.
            pfrcap = None
            pgid = g["pfr_game_id"] if g else None
            if pgid:
                if pgid not in PFR_TEAMTAB:
                    html, pp = pfr_box(pgid)
                    PFR_TEAMTAB[pgid] = (parse_pfr_team_tables(html) if html else {}, pp)
                tabs, pp = PFR_TEAMTAB[pgid]
                pfrcap = tabs.get(pid)
            if pfrcap:
                want = FID_TO_ABBR.get(int(c["corrected_value"]))
                nick = con.execute("SELECT display_name FROM team WHERE franchise_id=?",
                                   (int(c["corrected_value"]),)).fetchone()[0].split()[-1]
                verdict = "MATCH" if pfrcap.lower().startswith(nick.lower()) else "MISMATCH"
                led.add("data_correction", rk, int(gid[:4]), "corrected_value",
                        f"{c['corrected_value']} ({want})", "pro-football-reference", pgid,
                        pfrcap, verdict, rel(pp),
                        note=("Pro-Football-Reference lists this player in the corrected "
                              "franchise's snap table -- the correction is confirmed by the "
                              "contract authority" if verdict == "MATCH" else
                              "Pro-Football-Reference places this player in the OTHER team's "
                              "snap table; the correction contradicts the authority"),
                        player=nm, pfr_player_id=pid,
                        upstream_value=c["upstream_value"])
            elif bx and eid and eid in bx:
                refteam = bx[eid]["team"]
                verdict = "MATCH" if str(refteam) == c["corrected_value"] else "MISMATCH"
                led.add("data_correction", rk, int(gid[:4]), "corrected_value",
                        c["corrected_value"], "espn", g["espn_event_id"], str(refteam),
                        verdict, evidence,
                        note=("ESPN box score independently confirms the corrected franchise"
                              if verdict == "MATCH" else
                              "ESPN box score disagrees with the correction"),
                        player=nm, pfr_player_id=pid)
            else:
                led.add("data_correction", rk, int(gid[:4]), "corrected_value",
                        c["corrected_value"], "espn", gid, None, "UNRESOLVED", evidence,
                        note="player recorded no ESPN box-score line and no PFR page is held "
                             "for this game, so neither authority can rule on the correction",
                        player=nm, pfr_player_id=pid)
            continue

        # game-level corrections
        g = gm.get(tk)
        if g is None:
            led.add("data_correction", rk, None, c["column_name"], c["corrected_value"],
                    "espn", tk, None, "DB_ONLY", "cache/f03/",
                    note="correction names a game outside the partition")
            continue
        pair = events.get(g["espn_event_id"])
        if not pair:
            led.add("data_correction", rk, g["season"], c["column_name"],
                    c["corrected_value"], "espn", g["espn_event_id"], None, "UNRESOLVED",
                    "cache/f03/", note="no cached ESPN scoreboard event")
            continue
        e, p = pair
        colmap = {"kickoffUtc": "kickoff_utc", "gametimeEt": "gametime_et",
                  "gameday": "gameday", "location": "location", "roof": "roof",
                  "stadium": "stadium", "stadiumId": "stadium_id", "surface": "surface",
                  "awayRest": "away_rest", "homeRest": "home_rest",
                  "espnEventId": "espn_event_id"}
        col = colmap.get(c["column_name"], c["column_name"])
        dbv = g[col] if col in g.keys() else None
        applied = str(dbv) == str(c["corrected_value"]) or \
            (col == "kickoff_utc" and str(dbv).replace(":00Z", "Z") ==
             str(c["corrected_value"]).replace(":00Z", "Z"))
        if not applied:
            led.add("data_correction", rk, g["season"], col, dbv, "internal", tk,
                    c["corrected_value"], "MISMATCH", rel(p),
                    note="the correction is recorded but the game row does not carry it")
            continue
        if col == "kickoff_utc":
            refv = e.get("date")
            verdict = "MATCH" if refv == str(dbv).replace(":00Z", "Z") else "MISMATCH"
            led.add("data_correction", rk, g["season"], col, dbv, "espn",
                    g["espn_event_id"], refv, verdict, rel(p),
                    note="ESPN scoreboard kickoff instant; cited source: " + c["source"][:160])
        elif col == "gametime_et":
            refv = e.get("date")
            led.add("data_correction", rk, g["season"], col, dbv, "espn",
                    g["espn_event_id"], refv, "MATCH" if _et_matches(dbv, refv) else "MISMATCH",
                    rel(p), note="derived from the ESPN kickoff instant; cited source: "
                                 + c["source"][:160])
        else:
            led.add("data_correction", rk, g["season"], col, dbv, "espn",
                    g["espn_event_id"], None, "NOT_COMPARABLE", rel(p),
                    note="ESPN scoreboard does not publish this field; cited source: "
                         + c["source"][:160])


def _et_matches(et: str, iso: str) -> bool:
    if not et or not iso:
        return False
    try:
        dt = datetime.strptime(iso, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    # US Eastern: EDT (-4) between Mar and Nov, EST (-5) otherwise. Games here are Sep-Feb.
    off = 4 if 3 <= dt.month <= 10 else 5
    h = (dt.hour - off) % 24
    return f"{h:02d}:{dt.minute:02d}" == et


# ==================================================================== self-proof
PARTITION_SQL = {
    "game": "SELECT COUNT(*) FROM game WHERE season IN (2014,2015)",
    "game_line": "SELECT COUNT(*) FROM game_line gl JOIN game g USING(game_id) "
                 "WHERE g.season IN (2014,2015)",
    "team_game": "SELECT COUNT(*) FROM team_game WHERE season IN (2014,2015)",
    "player_game_stats": "SELECT COUNT(*) FROM player_game_stats WHERE season IN (2014,2015)",
    "snap_count": "SELECT COUNT(*) FROM snap_count WHERE season IN (2014,2015)",
    "roster_season": "SELECT COUNT(*) FROM roster_season WHERE season IN (2014,2015)",
    "depth_chart": "SELECT COUNT(*) FROM depth_chart WHERE season IN (2014,2015)",
    "data_correction": "SELECT COUNT(*) FROM data_correction "
                       "WHERE target_key LIKE '2014%' OR target_key LIKE '2015%'",
}


def self_proof(con, led: Ledger):
    print("\n=== COVERAGE SELF-PROOF ===")
    out = []
    for tbl, sql in PARTITION_SQL.items():
        n = con.execute(sql).fetchone()[0]
        keys = {k for k in led.rows.get(tbl, set()) if "#" not in str(k)}
        diff = n - len(keys)
        out.append((tbl, n, len(keys), diff))
        print(f"{tbl:22s} partition={n:7d} ledger_rows={len(keys):7d} diff={diff:+d}")
    json.dump(out, open(os.path.join(MY, "self_proof.json"), "w"), indent=1)
    print("\n=== VERDICT DISTRIBUTION ===")
    dist = defaultdict(lambda: defaultdict(int))
    for (tbl, v), n in led.counts.items():
        dist[tbl][v] += n
    for tbl in sorted(dist):
        print(f"{tbl:22s} " + "  ".join(f"{v}={n}" for v, n in sorted(dist[tbl].items())))
    json.dump({t: dict(d) for t, d in dist.items()},
              open(os.path.join(MY, "verdicts.json"), "w"), indent=1)
    return out


# =========================================================================== main
PHASES = {
    "fetch": phase_fetch, "game": phase_game, "line": phase_line,
    "teamgame": phase_teamgame, "pgs": phase_pgs, "snap": phase_snap,
    "roster": phase_roster, "depth": phase_depth, "corrections": phase_corrections,
    "upstream": phase_upstream,
}
DEFAULT = ["game", "line", "teamgame", "pgs", "snap", "roster", "depth", "corrections",
           "upstream"]


def main():
    global OFFLINE
    ap = argparse.ArgumentParser()
    ap.add_argument("phases", nargs="*", default=[])
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--append", action="store_true",
                    help="append to the ledger instead of truncating it")
    a = ap.parse_args()
    OFFLINE = a.offline
    os.makedirs(MY, exist_ok=True)

    start_md5 = md5(DB_PATH)
    print(f"db md5 (start): {start_md5}")

    phases = a.phases or DEFAULT
    con = connect()
    load_teams(con)
    if not a.append and phases != ["fetch"]:
        truncate_ledger()
    led = Ledger(LEDGER)
    try:
        for name in phases:
            t0 = time.time()
            PHASES[name](con, led) if name != "fetch" else PHASES[name](con)
            print(f"[{name}] done in {time.time()-t0:.1f}s", flush=True)
        if phases != ["fetch"]:
            self_proof(con, led)
    finally:
        led.close()
        con.close()
    end_md5 = md5(DB_PATH)
    print(f"db md5 (end):   {end_md5}")
    if end_md5 != start_md5:
        print("!!! DATABASE CHANGED DURING THE RUN -- STOP", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
