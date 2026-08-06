#!/usr/bin/env python3
"""
F06 — row-level forensic audit of seasons 2020 and 2021.

Partition (every row, no sampling):

    game                554   (2020: 269, 2021: 285)
    game_line           554
    team_game         1,108   (2 per game, derived)
    player_game_stats 36,528
    snap_count        51,467
    roster_season      6,029
    depth_chart       73,655
    ------------------------
    total            169,895

Authorities, per AUDIT-CONTRACT.md:

    game               ESPN summary?event=            (full)
    game_line          SportsOddsHistory/covers.com   (spread, total)
                       ESPN core-API odds             (moneyline corroboration)
    team_game          derived — recomputed from game + game_line
    player_game_stats  ESPN box score + nflverse transport diff (raw/player_stats.csv)
    snap_count         Pro-Football-Reference (+ nflverse transport diff)
    roster_season      ESPN season roster (+ nflverse transport diff)
    depth_chart        NO historical public source — internal/structural only

The database is opened read-only (mode=ro). Every HTTP response is cached under
cache/f06/ and the whole audit replays offline from cache with --offline.

Usage
    python3 audit/f06.py --phase fetch              # network: ESPN summaries + odds
    python3 audit/f06.py --phase fetch-pfr          # network: PFR snap sample
    python3 audit/f06.py --phase fetch-roster       # network: ESPN season rosters
    python3 audit/f06.py --phase all --offline      # the audit itself, no network
    python3 audit/f06.py --phase game --offline
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import glob
import gzip
import hashlib
import html
import io
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                  # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(ROOT)))
DB = os.path.join(ROOT, "nfl.db")
RAW = os.path.join(ROOT, "raw")
CACHE = os.path.join(ROOT, "cache", "f06")
EV = os.path.join(CACHE, "ev")                                # derived evidence bundles
PARTS = os.path.join(CACHE, "ledger_parts")
LEDGER_DIR = os.path.join(REPO, "docs", "audits",
                          "2026-07-27-nfl-db-forensic", "ledger")
LEDGER = os.path.join(LEDGER_DIR, "F06.jsonl")

SEASONS = (2020, 2021)
AGENT = "F06"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36 nfl-db-audit/F06")
SLEEP = 1.5            # ten agents share this network
PFR_SLEEP = 8.0        # PFR rate-limits hard; be a good citizen

SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={}"
ODDS_URL = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/"
            "{0}/competitions/{0}/odds?limit=50")
ROSTER_URL = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/"
              "{0}/teams/{1}/athletes?limit=300")
PFR_URL = "https://www.pro-football-reference.com/boxscores/{}.htm"

# Caches written by earlier agents; consulted before every fetch (contract §Rate limiting)
FOREIGN_SUMMARY_GLOBS = [
    os.path.join(ROOT, "cache", "a5", "summary_{}.json.gz"),
    os.path.join(ROOT, "cache", "a2", "espn_summary_{}.json"),
    os.path.join(ROOT, "cache", "a1", "summary", "{}.json"),
    os.path.join(ROOT, "cache", "s2", "summary_{}.json"),
]
FOREIGN_ODDS_GLOBS = [
    os.path.join(ROOT, "cache", "a4", "espn", "odds_{}.json.gz"),
    os.path.join(ROOT, "cache", "a4", "espn", "odds_{}.json"),
]

_MON = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


# ======================================================================================
# plumbing
# ======================================================================================
def rel(path: str) -> str:
    """Evidence paths are recorded relative to scripts/data/nfl-db/."""
    return os.path.relpath(path, ROOT)


def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def open_text(path: str) -> io.TextIOBase:
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, "r", encoding="utf-8", errors="replace")


def load_json(path: str):
    with open_text(path) as fh:
        return json.load(fh)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def find_cached(event_id: str, kind: str) -> str | None:
    """Return an existing cache path for this event, mine first then other agents'."""
    mine = os.path.join(CACHE, f"{kind}_{event_id}.json.gz")
    if os.path.exists(mine):
        return mine
    for tmpl in (FOREIGN_SUMMARY_GLOBS if kind == "summary" else FOREIGN_ODDS_GLOBS):
        p = tmpl.format(event_id)
        if os.path.exists(p):
            return p
    return None


def http_get(url: str, dest: str, sleep: float = SLEEP, binary: bool = False) -> str | None:
    """Fetch to dest (gzip). Caches 4xx bodies too — a 404 is evidence, not an error."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    body, status = None, None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                body, status = r.read(), r.status
            break
        except urllib.error.HTTPError as e:
            body, status = e.read(), e.code
            if status in (429, 503) and attempt < 2:
                time.sleep(sleep * (6 ** (attempt + 1)))
                continue
            break
        except Exception as e:                                   # noqa: BLE001
            if attempt == 2:
                body = json.dumps({"__fetch_error__": repr(e), "url": url}).encode()
                status = -1
                break
            time.sleep(sleep * (attempt + 2))
    with gzip.open(dest, "wb") as fh:
        fh.write(body if body is not None else b"")
    meta = dest + ".meta.json"
    with open(meta, "w") as fh:
        json.dump({"url": url, "status": status,
                   "fetched": dt.datetime.now(dt.timezone.utc).isoformat()}, fh)
    time.sleep(sleep)
    return dest


class Ledger:
    """One JSON object per line; shard per phase so phases stay independently re-runnable."""

    def __init__(self, phase: str):
        os.makedirs(PARTS, exist_ok=True)
        self.path = os.path.join(PARTS, f"{phase}.jsonl")
        self.fh = open(self.path, "w", encoding="utf-8")
        self.n = 0
        self.verdicts = collections.Counter()
        self.by_table = collections.Counter()
        self.rowkeys = collections.defaultdict(set)
        self.ts = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def write(self, *, table, row_key, season, field, db_value, authority,
              ref_id, ref_value, verdict, evidence, note=None, **extra):
        rec = {"ts": self.ts, "agent": AGENT, "table": table, "row_key": row_key,
               "season": season, "field": field, "db_value": db_value,
               "authority": authority, "ref_id": ref_id, "ref_value": ref_value,
               "verdict": verdict, "evidence": evidence}
        if note:
            rec["note"] = note
        rec.update(extra)
        self.fh.write(json.dumps(rec, separators=(",", ":"), default=str) + "\n")
        self.n += 1
        self.verdicts[verdict] += 1
        self.by_table[table] += 1
        if field == "*":
            self.rowkeys[table].add(row_key)

    def close(self):
        self.fh.close()


class RowAudit:
    """Accumulates per-field outcomes for one row, then emits per the volume rule."""

    def __init__(self, ledger, table, row_key, season, authority, evidence):
        self.L, self.table, self.row_key = ledger, table, row_key
        self.season, self.authority, self.evidence = season, authority, evidence
        self.compared = 0
        self.matched = 0
        self.nonmatch = []

    def field(self, name, db_value, ref_value, *, verdict=None, ref_id=None,
              authority=None, evidence=None, note=None):
        auth = authority or self.authority
        ev = evidence or self.evidence
        if verdict is None:
            verdict = "MATCH" if db_value == ref_value else "MISMATCH"
        self.compared += 1
        if verdict == "MATCH":
            self.matched += 1
            return
        self.nonmatch.append(dict(field=name, db_value=db_value, ref_value=ref_value,
                                  verdict=verdict, ref_id=ref_id, authority=auth,
                                  evidence=ev, note=note))

    def emit(self, ref_id, extra_note=None, force=None):
        for nm in self.nonmatch:
            self.L.write(table=self.table, row_key=self.row_key, season=self.season,
                         field=nm["field"], db_value=nm["db_value"],
                         authority=nm["authority"], ref_id=nm["ref_id"] or ref_id,
                         ref_value=nm["ref_value"], verdict=nm["verdict"],
                         evidence=nm["evidence"], note=nm["note"])
        # Row-level roll-up. Adverse verdicts dominate. A row with some NOT_COMPARABLE
        # fields is still MATCH *if the authority actually ruled on something* — the
        # per-field NOT_COMPARABLE lines stand on their own and fields_compared /
        # fields_matched carry the exact split. A row where nothing at all was comparable
        # is NOT_COMPARABLE, never MATCH (contract, "a row nobody could check").
        kinds = {n["verdict"] for n in self.nonmatch}
        verdict = force or (
            "MISMATCH" if "MISMATCH" in kinds
            else "DB_ONLY" if "DB_ONLY" in kinds
            else "REF_ONLY" if "REF_ONLY" in kinds
            else "UNRESOLVED" if "UNRESOLVED" in kinds
            else "MATCH" if self.matched > 0
            else "NOT_COMPARABLE")
        self.L.write(table=self.table, row_key=self.row_key, season=self.season,
                     field="*", db_value=None, authority=self.authority,
                     ref_id=ref_id, ref_value=None, verdict=verdict,
                     evidence=self.evidence, note=extra_note,
                     fields_compared=self.compared, fields_matched=self.matched)


def chunk_evidence(name: str, records: dict, size: int = 2000) -> dict:
    """Write derived/internal evidence to addressable chunks; return row_key -> path."""
    os.makedirs(EV, exist_ok=True)
    index, keys = {}, sorted(records)
    for i in range(0, len(keys), size):
        part = keys[i:i + size]
        path = os.path.join(EV, f"{name}_{i // size:04d}.json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump({k: records[k] for k in part}, fh, default=str)
        for k in part:
            index[k] = rel(path)
    return index


# ======================================================================================
# fetch phases
# ======================================================================================
def events(conn):
    return [(r["game_id"], r["espn_event_id"], r["season"], r["result_status"])
            for r in conn.execute(
                "SELECT game_id, espn_event_id, season, result_status FROM game "
                "WHERE season IN (?,?) ORDER BY kickoff_utc", SEASONS)]


def phase_fetch(conn, offline: bool):
    os.makedirs(CACHE, exist_ok=True)
    todo_s, todo_o = [], []
    for gid, eid, season, _ in events(conn):
        if find_cached(eid, "summary") is None:
            todo_s.append((gid, eid))
        if find_cached(eid, "odds") is None:
            todo_o.append((gid, eid))
    print(f"[fetch] summaries missing {len(todo_s)}, odds missing {len(todo_o)}")
    if offline:
        return
    for i, (gid, eid) in enumerate(todo_s, 1):
        http_get(SUMMARY_URL.format(eid), os.path.join(CACHE, f"summary_{eid}.json.gz"))
        if i % 25 == 0:
            print(f"[fetch] summary {i}/{len(todo_s)}", flush=True)
    for i, (gid, eid) in enumerate(todo_o, 1):
        http_get(ODDS_URL.format(eid), os.path.join(CACHE, f"odds_{eid}.json.gz"))
        if i % 25 == 0:
            print(f"[fetch] odds {i}/{len(todo_o)}", flush=True)
    print("[fetch] done")


def phase_fetch_roster(conn, offline: bool):
    os.makedirs(CACHE, exist_ok=True)
    fids = [r[0] for r in conn.execute("SELECT franchise_id FROM team ORDER BY 1")]
    todo = [(s, f) for s in SEASONS for f in fids
            if not os.path.exists(os.path.join(CACHE, f"roster_{s}_{f}.json.gz"))]
    print(f"[fetch-roster] missing {len(todo)}")
    if offline:
        return
    for i, (s, f) in enumerate(todo, 1):
        http_get(ROSTER_URL.format(s, f),
                 os.path.join(CACHE, f"roster_{s}_{f}.json.gz"))
        if i % 10 == 0:
            print(f"[fetch-roster] {i}/{len(todo)}", flush=True)
    print("[fetch-roster] done")


def pfr_sample(conn, n_per_season=9):
    """Deterministic PFR sample: postseason first (D16's blast radius), then spread
    across the regular season by a frozen stride. Never random, so it replays."""
    out = []
    for season in SEASONS:
        post = [r["pfr_game_id"] for r in conn.execute(
            "SELECT DISTINCT pfr_game_id FROM snap_count WHERE season=? AND season_type='POST'"
            " ORDER BY pfr_game_id", (season,))]
        reg = [r["pfr_game_id"] for r in conn.execute(
            "SELECT DISTINCT pfr_game_id FROM snap_count WHERE season=? AND season_type='REG'"
            " ORDER BY pfr_game_id", (season,))]
        picks = post[:1] + post[-1:]                       # SB + one other round
        stride = max(1, len(reg) // (n_per_season - len(picks)))
        picks += reg[::stride][:n_per_season - len(picks)]
        out += [(season, p) for p in dict.fromkeys(picks)]
    return out


def phase_fetch_pfr(conn, offline: bool):
    os.makedirs(CACHE, exist_ok=True)
    todo = [(s, p) for s, p in pfr_sample(conn)
            if not os.path.exists(os.path.join(CACHE, f"pfr_{p}.html.gz"))]
    print(f"[fetch-pfr] missing {len(todo)}")
    if offline:
        return
    for i, (s, p) in enumerate(todo, 1):
        http_get(PFR_URL.format(p), os.path.join(CACHE, f"pfr_{p}.html.gz"),
                 sleep=PFR_SLEEP)
        print(f"[fetch-pfr] {i}/{len(todo)} {p}", flush=True)
    print("[fetch-pfr] done")


# ======================================================================================
# shared loaders
# ======================================================================================
ESPN_POST_WEEK = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}
PACIFIC = "America/Los_Angeles"


def pacific_date(kickoff_utc: str) -> str:
    from zoneinfo import ZoneInfo
    inst = dt.datetime.fromisoformat(kickoff_utc.replace("Z", "+00:00"))
    return inst.astimezone(ZoneInfo(PACIFIC)).date().isoformat()


def load_games(conn):
    return {r["game_id"]: dict(r) for r in conn.execute(
        "SELECT * FROM game WHERE season IN (?,?)", SEASONS)}


def summaries(conn):
    """game_id -> (path, parsed json | None)."""
    out = {}
    for gid, eid, season, _ in events(conn):
        p = find_cached(eid, "summary")
        doc = None
        if p:
            try:
                doc = load_json(p)
            except Exception:                                    # noqa: BLE001
                doc = None
            if isinstance(doc, dict) and ("header" not in doc):
                doc = None
        out[gid] = (p, eid, doc)
    return out


def espn_game_facts(doc):
    """Flatten the ESPN summary into the facts `game` claims."""
    h = doc["header"]
    c = h["competitions"][0]
    f = {"espn_id": str(h.get("id")),
         "season": (h.get("season") or {}).get("year"),
         "espn_season_type": (h.get("season") or {}).get("type"),
         "espn_week": h.get("week"),
         "time_valid": 1 if h.get("timeValid") else 0,
         "date": c.get("date"),
         "neutral": bool(c.get("neutralSite")),
         "completed": bool(((c.get("status") or {}).get("type") or {}).get("completed")),
         "state": ((c.get("status") or {}).get("type") or {}).get("state")}
    for cc in c["competitors"]:
        side = cc["homeAway"]
        f[side + "_fid"] = int(cc["team"]["id"])
        f[side + "_abbr"] = cc["team"].get("abbreviation")
        f[side + "_score"] = int(cc["score"]) if cc.get("score") not in (None, "") else None
        f[side + "_periods"] = len(cc.get("linescores") or [])
    gi = doc.get("gameInfo") or {}
    v = gi.get("venue") or {}
    f["venue_id"] = int(v["id"]) if v.get("id") else None
    f["venue_name"] = v.get("fullName")
    f["venue_grass"] = v.get("grass")
    f["attendance"] = gi.get("attendance")
    f["overtime"] = 1 if max(f.get("home_periods") or 0, f.get("away_periods") or 0) > 4 else 0
    st = f["espn_season_type"]
    if st == 2:
        f["season_type"], f["week"], f["round"] = "REG", f["espn_week"], None
    elif st == 3:
        f["season_type"], f["week"] = "POST", None
        f["round"] = ESPN_POST_WEEK.get(f["espn_week"])
    else:
        f["season_type"], f["week"], f["round"] = None, None, None
    return f


# ======================================================================================
# PHASE game
# ======================================================================================
def recompute_rest(games: dict):
    """Actual rest, in calendar days, from each franchise's PREVIOUS PLAYED gameday.
    Week 1 / first game of the season = 7 by the loader's own convention."""
    by_team = collections.defaultdict(list)
    for g in games.values():
        for fid in (g["away_franchise_id"], g["home_franchise_id"]):
            if fid is not None:
                by_team[(g["season"], fid)].append(g)
    rest, gameno = {}, {}
    for key, gs in by_team.items():
        gs.sort(key=lambda x: (x["kickoff_utc"], x["game_id"]))
        prev = None
        for i, g in enumerate(gs, 1):
            if prev is None:
                rest[(g["game_id"], key[1])] = 7
            else:
                d0 = dt.date.fromisoformat(prev["gameday"])
                d1 = dt.date.fromisoformat(g["gameday"])
                rest[(g["game_id"], key[1])] = (d1 - d0).days
            gameno[(g["game_id"], key[1])] = i
            prev = g
    return rest, gameno


def known_alias_pairs(conn):
    """{(db_abbr, espn_abbr)} that denote the same franchise."""
    per_fid = collections.defaultdict(set)
    for r in conn.execute("SELECT abbreviation, franchise_id FROM team_alias"):
        per_fid[r["franchise_id"]].add(r["abbreviation"])
    for r in conn.execute("SELECT abbreviation, franchise_id FROM team"):
        per_fid[r["franchise_id"]].add(r["abbreviation"])
    pairs = set()
    for fid, abbrs in per_fid.items():
        for a in abbrs:
            for b in abbrs:
                pairs.add((a, b))
    return pairs


def phase_game(conn, L: Ledger, ctx: dict):
    games = ctx["games"]
    sums = ctx["summaries"]
    aliases = known_alias_pairs(conn)
    divisions = {r["franchise_id"]: (r["conference"], r["division"])
                 for r in conn.execute("SELECT * FROM team")}
    rest, gameno = recompute_rest(games)
    ctx["rest"], ctx["gameno"] = rest, gameno

    derived = {}
    for gid, g in games.items():
        derived[gid] = {
            "result": (g["home_score"] - g["away_score"]) if g["home_score"] is not None else None,
            "total": (g["home_score"] + g["away_score"]) if g["home_score"] is not None else None,
            "div_game": int(divisions.get(g["away_franchise_id"]) ==
                            divisions.get(g["home_franchise_id"]))
            if g["away_franchise_id"] and g["home_franchise_id"] else None,
            "gameday_pacific": pacific_date(g["kickoff_utc"]),
            "weekday": dt.date.fromisoformat(g["gameday"]).strftime("%A"),
            "away_rest": rest[(gid, g["away_franchise_id"])],
            "home_rest": rest[(gid, g["home_franchise_id"])],
        }
    devidx = chunk_evidence("game_derived", derived)
    ctx["game_derived"] = derived

    stats = collections.Counter()
    for gid in sorted(games):
        g = games[gid]
        path, eid, doc = sums[gid]
        d = derived[gid]
        ev_derived = devidx[gid]

        if doc is None:
            ra = RowAudit(L, "game", gid, g["season"], "espn",
                          rel(path) if path else ev_derived)
            for fld in ("away_score", "home_score", "week", "kickoff_utc"):
                ra.field(fld, g[fld], None, verdict="UNRESOLVED",
                         note="ESPN summary unavailable/unparseable for this event id")
            ra.emit(eid, extra_note="ESPN summary missing from cache")
            stats["no_summary"] += 1
            continue

        f = espn_game_facts(doc)
        ev = rel(path)
        ra = RowAudit(L, "game", gid, g["season"], "espn", ev)

        ra.field("espn_event_id", str(g["espn_event_id"]), f["espn_id"])
        ra.field("season", g["season"], f["season"])
        ra.field("season_type", g["season_type"], f["season_type"])
        ra.field("week", g["week"], f["week"])
        ra.field("playoff_round", g["playoff_round"], f["round"])
        ra.field("away_franchise_id", g["away_franchise_id"], f.get("away_fid"))
        ra.field("home_franchise_id", g["home_franchise_id"], f.get("home_fid"))

        for side in ("away", "home"):
            db_ab, es_ab = g[f"{side}_abbr"], f.get(f"{side}_abbr")
            if db_ab == es_ab:
                ra.field(f"{side}_abbr", db_ab, es_ab)
            elif (db_ab, es_ab) in aliases:
                ra.field(f"{side}_abbr", db_ab, es_ab, verdict="NOT_COMPARABLE",
                         note="ESPN publishes only its current abbreviation for the "
                              "franchise; both strings are registered aliases of the same "
                              "franchise_id, so ESPN cannot rule on era-correct labelling")
            else:
                ra.field(f"{side}_abbr", db_ab, es_ab)

        if g["result_status"] == "final":
            ra.field("away_score", g["away_score"], f.get("away_score"))
            ra.field("home_score", g["home_score"], f.get("home_score"))
            ra.field("result", g["result"], (f.get("home_score") - f.get("away_score"))
                     if None not in (f.get("home_score"), f.get("away_score")) else None)
            ra.field("total", g["total"], (f.get("home_score") + f.get("away_score"))
                     if None not in (f.get("home_score"), f.get("away_score")) else None)
            ra.field("overtime", g["overtime"], f["overtime"])
        else:
            for fld in ("away_score", "home_score", "result", "total", "overtime"):
                ra.field(fld, g[fld], None, verdict="NOT_COMPARABLE",
                         note="game not final; scores absent by construction")

        ra.field("result_status", g["result_status"],
                 "final" if f["completed"] else "scheduled")
        ra.field("time_valid", g["time_valid"], f["time_valid"])

        espn_k = f["date"]
        norm_db = dt.datetime.fromisoformat(g["kickoff_utc"].replace("Z", "+00:00"))
        try:
            norm_es = dt.datetime.fromisoformat(espn_k.replace("Z", "+00:00"))
        except Exception:                                        # noqa: BLE001
            norm_es = None
        if norm_es is not None and norm_db == norm_es:
            # ESPN drops the seconds field; compare the instants, not the strings
            ra.field("kickoff_utc", g["kickoff_utc"], espn_k, verdict="MATCH")
        else:
            delta = None if norm_es is None else (norm_es - norm_db).total_seconds() / 60.0
            ra.field("kickoff_utc", g["kickoff_utc"], espn_k, verdict="MISMATCH",
                     note=f"delta_minutes={delta}; nflverse publishes the SCHEDULED "
                          f"kickoff, ESPN the OBSERVED one")
            stats["kickoff_delta"] += 1

        espn_loc = "Neutral" if f["neutral"] else "Home"
        ra.field("location", g["location"], espn_loc,
                 note=None if g["location"] == espn_loc else
                 "ESPN's neutralSite flag disagrees; check `stadium` on this row — a home "
                 "game played away from the franchise's own venue is corroborated by the "
                 "venue string itself. Recorded, not resolved (contract rule 3)")
        if g["venue_id"] is None and f["venue_id"] is not None:
            ra.field("venue_id", None, f["venue_id"], verdict="REF_ONLY",
                     note="ESPN publishes a venue id for this event; game.venue_id is "
                          "NULL — the column is unpopulated for every game before 2026")
        else:
            ra.field("venue_id", g["venue_id"], f["venue_id"])
        if g["stadium"] == f["venue_name"]:
            ra.field("stadium", g["stadium"], f["venue_name"])
        else:
            ra.field("stadium", g["stadium"], f["venue_name"], verdict="NOT_COMPARABLE",
                     note="ESPN retro-renames venues (known-good difference, contract §5)")

        # derived / internal
        ra.field("result_arith", g["result"], d["result"], authority="derived",
                 evidence=ev_derived, ref_id="home_score-away_score")
        ra.field("total_arith", g["total"], d["total"], authority="derived",
                 evidence=ev_derived, ref_id="home_score+away_score")
        ra.field("div_game", g["div_game"], d["div_game"], authority="derived",
                 evidence=ev_derived, ref_id="team.division")
        ra.field("gameday", g["gameday"], d["gameday_pacific"], authority="derived",
                 evidence=ev_derived, ref_id="D11 US/Pacific rule")
        ra.field("weekday", g["weekday"], d["weekday"], authority="derived",
                 evidence=ev_derived, ref_id="gameday")
        ra.field("away_rest", g["away_rest"], d["away_rest"], authority="derived",
                 evidence=ev_derived, ref_id="prev played gameday")
        ra.field("home_rest", g["home_rest"], d["home_rest"], authority="derived",
                 evidence=ev_derived, ref_id="prev played gameday")

        ra.emit(eid, extra_note=f"espn_attendance={f['attendance']}")
        stats["ok"] += 1

    ctx["game_stats"] = stats
    return stats


# ======================================================================================
# PHASE line
# ======================================================================================
_SOH_ALIASES = {
    "washington football team": 28, "washington redskins": 28,
    "oakland raiders": 13, "las vegas raiders": 13,
    "st. louis rams": 14, "san diego chargers": 24,
}


def parse_soh(path):
    with open_text(path) as fh:
        doc = fh.read()
    out = []
    for table in re.findall(r"<table.*?</table>", doc, re.S):
        trs = re.findall(r"<tr.*?</tr>", table, re.S)
        if not trs:
            continue
        hdr = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip()
               for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", trs[0], re.S)]
        joined = " ".join(hdr)
        if "Favorite" not in joined or "Over/Under" not in joined:
            continue
        off = 1 if hdr and hdr[0].startswith("Round") else 0
        for tr in trs[1:]:
            cl = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip()
                  for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cl) < 10 + off:
                continue
            m = re.match(r"^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$", cl[1 + off])
            if not m:
                continue
            out.append({"date": dt.date(int(m.group(3)), _MON[m.group(1)], int(m.group(2))),
                        "fav_home": "@" in cl[3 + off], "fav": cl[4 + off],
                        "score": cl[5 + off], "spread": cl[6 + off],
                        "dog": cl[8 + off], "ou": cl[9 + off]})
    return out


RELIABLE_SKIP = {"Caesars Sportsbook", "Opening", "consensus",
                 "Caesars Sportsbook (New Jersey) - Live Odds", "ESPN Bet - Live Odds",
                 "ESPN BET - Live Odds"}


def espn_odds_consensus(path):
    """Median-ish consensus of reputable pre-game providers in an ESPN odds document."""
    try:
        doc = load_json(path)
    except Exception:                                            # noqa: BLE001
        return None
    items = doc.get("items") or []
    sp, tot, hml, aml, provs = [], [], [], [], []
    for it in items:
        prov = (it.get("provider") or {}).get("name", "?")
        if prov in RELIABLE_SKIP:
            continue
        provs.append(prov)
        if it.get("spread") is not None:
            sp.append(-float(it["spread"]))                       # ESPN posts HOME handicap
        if it.get("overUnder") is not None:
            tot.append(float(it["overUnder"]))
        h = (it.get("homeTeamOdds") or {}).get("moneyLine")
        a = (it.get("awayTeamOdds") or {}).get("moneyLine")
        if h:
            hml.append(int(h))
        if a:
            aml.append(int(a))

    def mode(xs):
        return collections.Counter(xs).most_common(1)[0][0] if xs else None

    def rng(xs):
        return [min(xs), max(xs)] if xs else None

    return {"providers": sorted(set(provs)), "n": len(provs),
            "spread": mode(sp), "spread_range": rng(sp),
            "total": mode(tot), "total_range": rng(tot),
            "home_ml": mode(hml), "home_ml_range": rng(hml),
            "away_ml": mode(aml), "away_ml_range": rng(aml)}


def pickcenter_consensus(doc):
    pc = doc.get("pickcenter") or []
    out = []
    for it in pc:
        prov = (it.get("provider") or {}).get("name", "?")
        out.append({"provider": prov, "spread": it.get("spread"),
                    "overUnder": it.get("overUnder"),
                    "home_ml": (it.get("homeTeamOdds") or {}).get("moneyLine"),
                    "away_ml": (it.get("awayTeamOdds") or {}).get("moneyLine"),
                    "over_odds": it.get("overOdds"), "under_odds": it.get("underOdds")})
    return out


def implied(ml):
    ml = float(ml)
    return 100.0 / (ml + 100.0) if ml > 0 else (-ml) / (-ml + 100.0)


def phase_line(conn, L: Ledger, ctx: dict):
    games = ctx["games"]
    sums = ctx["summaries"]
    lines = {r["game_id"]: dict(r) for r in conn.execute(
        "SELECT l.* FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (?,?)",
        SEASONS)}
    names = {r["display_name"].lower(): r["franchise_id"]
             for r in conn.execute("SELECT franchise_id, display_name FROM team")}
    names.update(_SOH_ALIASES)

    # ---- SportsOddsHistory, cached by A4 -------------------------------------------
    soh_by_key, soh_files = {}, {}
    for season in SEASONS:
        for cand in (os.path.join(ROOT, "cache", "a4", f"soh_{season}.html.gz"),
                     os.path.join(ROOT, "cache", "a4", f"soh_{season}.html")):
            if os.path.exists(cand):
                soh_files[season] = cand
                break
    soh_rows = []
    for season, path in soh_files.items():
        for s in parse_soh(path):
            f_ = names.get(re.sub(r"\s*\(\d+\)\s*$", "", s["fav"]).strip().lower())
            d_ = names.get(re.sub(r"\s*\(\d+\)\s*$", "", s["dog"]).strip().lower())
            if f_ is None or d_ is None:
                continue
            soh_rows.append((season, path, f_, d_, s))
    by_pair = collections.defaultdict(list)
    for season, path, f_, d_, s in soh_rows:
        by_pair[frozenset((f_, d_))].append((season, path, f_, d_, s))

    def soh_for(g):
        cands = by_pair.get(frozenset((g["away_franchise_id"], g["home_franchise_id"])), [])
        gd = dt.date.fromisoformat(g["gameday"])
        best = None
        for season, path, f_, d_, s in cands:
            delta = abs((s["date"] - gd).days)
            if delta <= 3 and (best is None or delta < best[0]):
                best = (delta, path, f_, d_, s)
        return best

    def mag(s):
        m = re.search(r"(-?\d+(?:\.\d+)?)", s.upper().replace("PK", "0"))
        return None if m is None else abs(float(m.group(1)))

    def ou_num(s):
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        return None if m is None else float(m.group(1))

    # ---- evidence bundle for every ESPN odds consensus ------------------------------
    odds_ev, hold_report, mism = {}, [], []
    for gid in sorted(lines):
        g = games[gid]
        eid = str(g["espn_event_id"])
        op = find_cached(eid, "odds")
        cons = espn_odds_consensus(op) if op else None
        _, _, doc = sums[gid]
        pc = pickcenter_consensus(doc) if doc else []
        odds_ev[gid] = {"espn_odds_file": rel(op) if op else None,
                        "espn_consensus": cons, "pickcenter": pc}
    oidx = chunk_evidence("line_espn", odds_ev, size=200)

    stats = collections.Counter()
    for gid in sorted(lines):
        ln, g = lines[gid], games[gid]
        best = soh_for(g)
        ev = oidx[gid]
        soh_ev = rel(best[1]) if best else None
        ra = RowAudit(L, "game_line", gid, g["season"], "sportsoddshistory",
                      soh_ev or ev)
        cons = odds_ev[gid]["espn_consensus"]
        espn_ev = ev

        # spread + total: SportsOddsHistory is the named authority
        if best:
            _, path, f_, d_, s = best
            m = mag(s["spread"])
            soh_home = None if m is None else (m if g["home_franchise_id"] == f_ else -m)
            dsp = None if soh_home is None else round(ln["spread_line"] - soh_home, 2)
            ra.field("spread_line", ln["spread_line"], soh_home, ref_id="soh",
                     note=None if dsp in (0, None) else
                     f"delta={dsp:+g}; |delta|<=1 is ordinary closing-line variance "
                     f"between two publishers, |delta|>=2 is material")
            sot = ou_num(s["ou"])
            dto = None if sot is None else round(ln["total_line"] - sot, 2)
            ra.field("total_line", ln["total_line"], sot, ref_id="soh",
                     note=None if dto in (0, None) else
                     f"delta={dto:+g}; |delta|<=1 is ordinary closing-line variance "
                     f"between two publishers, |delta|>=2 is material")
            stats["soh_matched"] += 1
            if dsp is not None and abs(dsp) >= 2:
                stats["spread_material"] += 1
            if dto is not None and abs(dto) >= 2:
                stats["total_material"] += 1
        else:
            ra.field("spread_line", ln["spread_line"], None, verdict="UNRESOLVED",
                     note="no SportsOddsHistory row matched within +/-3 days")
            ra.field("total_line", ln["total_line"], None, verdict="UNRESOLVED",
                     note="no SportsOddsHistory row matched within +/-3 days")
            stats["soh_unmatched"] += 1

        # moneylines: SOH does not publish them -> ESPN core-API odds
        if cons and cons["n"]:
            for col, key, rkey in (("home_moneyline", "home_ml", "home_ml_range"),
                                   ("away_moneyline", "away_ml", "away_ml_range")):
                ref, rng = cons[key], cons[rkey]
                if ref is None:
                    ra.field(col, ln[col], None, verdict="UNRESOLVED",
                             authority="espn", evidence=espn_ev,
                             note="no reputable ESPN provider quoted this side")
                elif rng and rng[0] <= ln[col] <= rng[1]:
                    ra.field(col, ln[col], ref, verdict="MATCH",
                             authority="espn", evidence=espn_ev)
                else:
                    ra.field(col, ln[col], ref, verdict="MISMATCH",
                             authority="espn", evidence=espn_ev,
                             ref_id=f"espn_range={rng}",
                             note=f"db outside the full ESPN provider range {rng} "
                                  f"({cons['n']} providers)")
        else:
            for col in ("home_moneyline", "away_moneyline"):
                ra.field(col, ln[col], None, verdict="UNRESOLVED", authority="espn",
                         evidence=espn_ev, note="no ESPN odds document cached for this event")

        # juice columns: neither archive publishes closing juice for these games
        for col in ("away_spread_odds", "home_spread_odds", "over_odds", "under_odds"):
            ref = None
            if cons and cons["n"]:
                ref = None                    # ESPN spread/total juice is provider-specific
            ra.field(col, ln[col], ref, verdict="NOT_COMPARABLE", authority="espn",
                     evidence=espn_ev,
                     note="closing juice is not published by SportsOddsHistory and ESPN "
                          "quotes it per-provider, not as a settled closing number")
        ra.field("odds_source", ln["odds_source"], None, verdict="NOT_COMPARABLE",
                 authority="internal", evidence=espn_ev,
                 note="provenance metadata; no external authority defines this column")

        # overround / arbitrage screen (internal coherence, always logged if broken)
        s_imp = implied(ln["away_moneyline"]) + implied(ln["home_moneyline"])
        if s_imp < 1.0:
            hold_report.append((gid, round(s_imp, 4), ln["away_moneyline"],
                                ln["home_moneyline"], cons))
            ra.field("moneyline_overround", round(s_imp, 4), ">1.0",
                     verdict="UNRESOLVED", authority="derived", evidence=espn_ev,
                     ref_id="implied_prob_sum",
                     note="implied probabilities sum below 1.0 — a risk-free arbitrage no "
                          "single book posts; recorded, NOT resolved (contract rule 3)")
        ra.emit(str(g["espn_event_id"]))
    ctx["hold_report"] = hold_report
    ctx["line_stats"] = stats
    return stats


# ======================================================================================
# PHASE teamgame
# ======================================================================================
def phase_teamgame(conn, L: Ledger, ctx: dict):
    games, rest, gameno = ctx["games"], ctx["rest"], ctx["gameno"]
    lines = {r["game_id"]: dict(r) for r in conn.execute(
        "SELECT l.* FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (?,?)",
        SEASONS)}
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM team_game WHERE season IN (?,?)", SEASONS)]

    # derive the expected 2-per-game population first
    expect = set()
    for gid, g in games.items():
        for fid in (g["away_franchise_id"], g["home_franchise_id"]):
            expect.add((gid, fid))
    have = {(r["game_id"], r["franchise_id"]) for r in rows}

    derived = {}
    for gid, g in games.items():
        ln = lines.get(gid)
        for fid, opp, is_home in ((g["away_franchise_id"], g["home_franchise_id"], 0),
                                  (g["home_franchise_id"], g["away_franchise_id"], 1)):
            pf = g["home_score"] if is_home else g["away_score"]
            pa = g["away_score"] if is_home else g["home_score"]
            margin = None if pf is None else pf - pa
            spread = None if ln is None else (ln["spread_line"] if is_home
                                              else -ln["spread_line"])
            total_line = None if ln is None else ln["total_line"]
            ml = None if ln is None else (ln["home_moneyline"] if is_home
                                          else ln["away_moneyline"])
            su = None if margin is None else ("W" if margin > 0 else
                                              "L" if margin < 0 else "T")
            ats = None if (margin is None or spread is None) else (
                "W" if margin > spread else "L" if margin < spread else "P")
            ou = None if (pf is None or total_line is None) else (
                "O" if pf + pa > total_line else "U" if pf + pa < total_line else "P")
            won = None if margin is None or margin == 0 else int(margin > 0)
            covered = None if ats is None or ats == "P" else int(ats == "W")
            derived[f"{gid}/{fid}"] = {
                "opponent_id": opp, "season": g["season"], "season_type": g["season_type"],
                "week": g["week"], "playoff_round": g["playoff_round"],
                "kickoff_utc": g["kickoff_utc"], "is_home": is_home,
                "points_for": pf, "points_against": pa, "margin": margin,
                "spread": spread, "total_line": total_line, "moneyline": ml,
                "rest_days": rest[(gid, fid)], "won": won, "covered": covered,
                "su_result": su, "ats_result": ats, "ou_result": ou,
                "game_number": gameno[(gid, fid)],
            }
    didx = chunk_evidence("team_game_derived", derived)

    stats = collections.Counter()
    for r in sorted(rows, key=lambda x: (x["game_id"], x["franchise_id"])):
        key = f'{r["game_id"]}/{r["franchise_id"]}'
        d = derived.get(key)
        ev = didx.get(key)
        ra = RowAudit(L, "team_game", key, r["season"], "derived", ev or "")
        if d is None:
            ra.field("*", None, None, verdict="DB_ONLY",
                     evidence=didx[next(iter(didx))],
                     note="team_game row whose (game_id, franchise_id) is not derivable "
                          "from `game`")
            ra.emit(r["game_id"])
            stats["db_only"] += 1
            continue
        for col, want in d.items():
            ra.field(col, r[col], want, ref_id="recomputed from game+game_line")
        # upstream columns are provenance, not derivable
        ra.field("rest_days_upstream", r["rest_days_upstream"], None,
                 verdict="NOT_COMPARABLE",
                 note="preserved nflverse value; by construction it may differ from the "
                      "recomputed rest (D15)")
        ra.emit(r["game_id"])
        stats["ok"] += 1

    for miss in sorted(expect - have):
        L.write(table="team_game", row_key=f"{miss[0]}/{miss[1]}", season=games[miss[0]]["season"],
                field="*", db_value=None, authority="derived", ref_id=miss[0],
                ref_value="expected row", verdict="REF_ONLY",
                evidence=didx.get(f"{miss[0]}/{miss[1]}", next(iter(didx.values()))),
                note="game implies this team_game row; it is absent from the table")
        stats["ref_only"] += 1
    ctx["team_game_expected"] = len(expect)
    ctx["team_game_stats"] = stats
    return stats


# ======================================================================================
# nflverse transport slices — the loader's own input, cached so the audit replays offline
# ======================================================================================
SLICE = os.path.join(CACHE, "raw_slice")


def build_slice(name: str, csv_name: str, season_col: str = "season"):
    out = os.path.join(SLICE, f"{name}.csv.gz")
    if os.path.exists(out):
        return out
    os.makedirs(SLICE, exist_ok=True)
    src = os.path.join(RAW, csv_name)
    with open(src, newline="", encoding="utf-8") as fh, \
            gzip.open(out, "wt", newline="", encoding="utf-8") as oh:
        rd = csv.DictReader(fh)
        wr = csv.DictWriter(oh, fieldnames=rd.fieldnames)
        wr.writeheader()
        want = {str(s) for s in SEASONS}
        for row in rd:
            if row.get(season_col) in want:
                wr.writerow(row)
    return out


def read_slice(path):
    with gzip.open(path, "rt", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def num(v, cast=float):
    if v in (None, "", "NA", "NaN", "nan"):
        return None
    try:
        return cast(v)
    except (TypeError, ValueError):
        try:
            return cast(float(v))
        except (TypeError, ValueError):
            return None


def close(a, b, tol=1e-4):
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= tol


# ======================================================================================
# ESPN box-score parsing (serves player_game_stats AND the snap/roster membership checks)
# ======================================================================================
def parse_boxscore(doc):
    """-> {"teams": {tid: abbr}, "players": {athlete_id: {...}}}"""
    out = {"teams": {}, "players": {}}
    for tblk in (doc.get("boxscore") or {}).get("players") or []:
        tid = int(tblk["team"]["id"])
        out["teams"][tid] = tblk["team"].get("abbreviation")
        for cat in tblk.get("statistics") or []:
            name = cat.get("name")
            keys = cat.get("keys") or []
            for ath in cat.get("athletes") or []:
                aid = str((ath.get("athlete") or {}).get("id"))
                vals = ath.get("stats") or []
                rec = out["players"].setdefault(
                    aid, {"team": tid, "cats": {},
                          "name": (ath.get("athlete") or {}).get("displayName")})
                rec["team"] = rec.get("team", tid)
                rec["cats"][name] = dict(zip(keys, vals))
    return out


def _split(s, idx):
    if not s or s in ("--", "-"):
        return None
    parts = re.split(r"[/-]", s)
    try:
        return int(parts[idx])
    except (IndexError, ValueError):
        return None


def espn_player_stats(cats):
    """ESPN box-score numbers in the DB's own vocabulary. Missing category = absent."""
    s = {}
    p = cats.get("passing")
    if p:
        s["completions"] = _split(p.get("completions/passingAttempts"), 0)
        s["attempts"] = _split(p.get("completions/passingAttempts"), 1)
        s["passing_yards"] = num(p.get("passingYards"), int)
        s["passing_tds"] = num(p.get("passingTouchdowns"), int)
        s["interceptions"] = num(p.get("interceptions"), int)
        s["sacks_suffered"] = _split(p.get("sacks-sackYardsLost"), 0)
    r = cats.get("rushing")
    if r:
        s["carries"] = num(r.get("rushingAttempts"), int)
        s["rushing_yards"] = num(r.get("rushingYards"), int)
        s["rushing_tds"] = num(r.get("rushingTouchdowns"), int)
    c = cats.get("receiving")
    if c:
        s["receptions"] = num(c.get("receptions"), int)
        s["receiving_yards"] = num(c.get("receivingYards"), int)
        s["receiving_tds"] = num(c.get("receivingTouchdowns"), int)
        s["targets"] = num(c.get("receivingTargets"), int)
    return s


ESPN_COMPARABLE = ["completions", "attempts", "passing_yards", "passing_tds",
                   "interceptions", "sacks_suffered", "carries", "rushing_yards",
                   "rushing_tds", "receptions", "targets", "receiving_yards",
                   "receiving_tds"]
ESPN_CAT_OF = {"completions": "passing", "attempts": "passing", "passing_yards": "passing",
               "passing_tds": "passing", "interceptions": "passing",
               "sacks_suffered": "passing", "carries": "rushing",
               "rushing_yards": "rushing", "rushing_tds": "rushing",
               "receptions": "receiving", "targets": "receiving",
               "receiving_yards": "receiving", "receiving_tds": "receiving"}
NOT_ESPN = ["passing_epa", "rushing_epa", "receiving_epa", "target_share",
            "air_yards_share", "fantasy_points", "fantasy_points_ppr"]


_PBP_CACHE = {}


def espn_play_texts(doc):
    """Every play-description string ESPN publishes for a game (drives + scoring plays).
    This is a SECOND ESPN surface, independent of the box-score player tables."""
    key = id(doc)
    if key in _PBP_CACHE:
        return _PBP_CACHE[key]
    texts = []
    dr = doc.get("drives") or {}
    buckets = []
    if isinstance(dr, dict):
        buckets += dr.get("previous") or []
        if dr.get("current"):
            buckets.append(dr["current"])
    for d in buckets:
        for p in d.get("plays") or []:
            if p.get("text"):
                texts.append(p["text"])
    for p in doc.get("scoringPlays") or []:
        if p.get("text"):
            texts.append(p["text"])
    _PBP_CACHE[key] = texts
    return texts


def pbp_receiving(doc, display_name):
    """Receptions/targets ESPN's own play-by-play attributes to `display_name`.
    Returns None when the abbreviation is ambiguous or never appears."""
    parts = display_name.split()
    if len(parts) < 2:
        return None
    abbr = f"{parts[0][0]}.{parts[-1]}"
    texts = espn_play_texts(doc)
    rec = tgt = 0
    for t in texts:
        if abbr not in t:
            continue
        if "pass" not in t and "PASS" not in t:
            continue
        tgt += 1
        if "incomplete" not in t and "INTERCEPTED" not in t:
            rec += 1
    if tgt == 0:
        return None
    return {"receptions": rec, "targets": tgt, "abbr": abbr}


def build_boxscores(ctx):
    if "boxscores" in ctx:
        return ctx["boxscores"]
    bx = {}
    for gid, (path, eid, doc) in ctx["summaries"].items():
        bx[gid] = parse_boxscore(doc) if doc else None
    ctx["boxscores"] = bx
    return bx


# ======================================================================================
# PHASE pgs
# ======================================================================================
def phase_pgs(conn, L: Ledger, ctx: dict):
    games = ctx["games"]
    bx = build_boxscores(ctx)
    sums = ctx["summaries"]

    espn_of = {}
    gsis_of_espn = collections.defaultdict(set)
    for r in conn.execute("SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL"):
        espn_of[r["gsis_id"]] = str(r["espn_id"])
        gsis_of_espn[str(r["espn_id"])].add(r["gsis_id"])
    pname = {r["gsis_id"]: r["display_name"] for r in
             conn.execute("SELECT gsis_id, display_name FROM player")}
    dbname_by_game = collections.defaultdict(set)

    sl = build_slice("player_stats", "player_stats.csv")
    raw = {}
    for row in read_slice(sl):
        raw[(row["player_id"], row["season"], row["week"], row["season_type"])] = row
    raw_ev = rel(sl)

    # D19 re-keyed 13 player_game_stats rows away from the id the CSV publishes; the
    # transport lookup has to follow the correction or it reports a phantom DB_ONLY.
    d19 = {}
    for r in conn.execute("SELECT target_key, upstream_value, corrected_value FROM "
                          "data_correction WHERE defect='D19' AND column_name='gsis_id'"):
        m = re.match(r"\('([^']+)',\s*(\d+),\s*(\d+),\s*'([A-Z]+)'\)", r["target_key"])
        if m:
            d19[(r["corrected_value"], m.group(2), m.group(3), m.group(4))] = \
                (r["upstream_value"], r["target_key"])

    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM player_game_stats WHERE season IN (?,?)", SEASONS)]

    # every ESPN athlete with real offensive production, for the REF_ONLY sweep
    db_by_game = collections.defaultdict(set)
    for r in rows:
        db_by_game[r["game_id"]].add(espn_of.get(r["gsis_id"]))
        n = pname.get(r["gsis_id"])
        if n:
            dbname_by_game[r["game_id"]].add(n.lower())

    stats = collections.Counter()
    for r in sorted(rows, key=lambda x: (x["game_id"], x["gsis_id"])):
        gid = r["game_id"]
        g = games.get(gid)
        key = f'{gid}/{r["gsis_id"]}'
        path, eid, doc = sums.get(gid, (None, None, None))
        b = bx.get(gid)
        ev = rel(path) if path else raw_ev
        season = r["season"]
        ra = RowAudit(L, "player_game_stats", key, season, "espn", ev)

        # ---- transport: the loader vs its own nflverse input --------------------------
        rk = (r["gsis_id"], str(season), str(r["week"]),
              "REG" if r["season_type"] == "REG" else "POST")
        rr = raw.get(rk)
        if rr is None:
            for st in ("POST", "REG"):
                rr = raw.get((r["gsis_id"], str(season), str(r["week"]), st))
                if rr:
                    break
        d19hit = None
        if rr is None:
            for st in ("REG", "POST"):
                d19hit = d19.get((r["gsis_id"], str(season), str(r["week"]), st))
                if d19hit:
                    rr = raw.get((d19hit[0], str(season), str(r["week"]), st))
                    break
            if rr is not None:
                ra.field("D19_rekey", r["gsis_id"], r["gsis_id"],
                         authority="data_correction", evidence=raw_ev,
                         ref_id=d19hit[1], verdict="MATCH",
                         note=f"raw/player_stats.csv publishes this row under "
                              f"{d19hit[0]}; D19 re-keyed it to {r['gsis_id']}")
                stats["d19_rekey"] += 1
        if rr is None:
            ra.field("nflverse_transport", key, None, verdict="DB_ONLY",
                     authority="nflverse", evidence=raw_ev,
                     note="no row with this natural key in raw/player_stats.csv")
            stats["no_raw"] += 1
        else:
            bad = []
            for dbcol, csvcol in (("completions", "completions"), ("attempts", "attempts"),
                                  ("passing_yards", "passing_yards"),
                                  ("passing_tds", "passing_tds"),
                                  ("interceptions", "passing_interceptions"),
                                  ("sacks_suffered", "sacks_suffered"),
                                  ("carries", "carries"), ("rushing_yards", "rushing_yards"),
                                  ("rushing_tds", "rushing_tds"),
                                  ("receptions", "receptions"), ("targets", "targets"),
                                  ("receiving_yards", "receiving_yards"),
                                  ("receiving_tds", "receiving_tds"),
                                  ("fantasy_points", "fantasy_points"),
                                  ("fantasy_points_ppr", "fantasy_points_ppr"),
                                  ("passing_epa", "passing_epa"),
                                  ("rushing_epa", "rushing_epa"),
                                  ("receiving_epa", "receiving_epa")):
                if not close(r[dbcol], num(rr.get(csvcol)), 1e-3):
                    bad.append((dbcol, r[dbcol], rr.get(csvcol)))
            if bad:
                for c, dv, rv in bad:
                    ra.field(f"nflverse:{c}", dv, rv, verdict="MISMATCH",
                             authority="nflverse", evidence=raw_ev,
                             note="loader diverges from raw/player_stats.csv")
                stats["transport_bad"] += 1
            else:
                ra.field("nflverse_transport", "identical", "identical",
                         authority="nflverse", evidence=raw_ev)

        # ---- ESPN box score ----------------------------------------------------------
        aid = espn_of.get(r["gsis_id"])
        pl = (b or {}).get("players", {}).get(aid) if (b and aid) else None
        dname = pname.get(r["gsis_id"])

        # An espn_id that resolves to nobody in the box score, while an athlete of the
        # same published name IS in it, is a player.espn_id defect — not a missing stat.
        if b is not None and pl is None and dname:
            for cand_id, cand in b["players"].items():
                if (cand.get("name") or "").lower() == dname.lower():
                    ra.field("player.espn_id", aid, cand_id, verdict="MISMATCH",
                             ref_id=f"espn:{cand_id}",
                             note=f"player.espn_id for {dname} does not appear in this "
                                  f"box score; ESPN's athlete of that exact display name "
                                  f"in this game is {cand_id}. Cross-table defect in "
                                  f"`player`, surfaced here.")
                    pl = cand
                    stats["espn_id_defect"] += 1
                    break

        if b is None:
            for c in ESPN_COMPARABLE:
                ra.field(c, r[c], None, verdict="UNRESOLVED",
                         note="ESPN summary unavailable for this game")
            stats["no_summary"] += 1
        elif pl is None:
            live = [c for c in ESPN_COMPARABLE if (r[c] or 0) != 0]
            if live:
                pbp = pbp_receiving(doc, dname) if (doc and dname) else None
                if pbp is not None:
                    agree = r["receptions"] == pbp["receptions"]
                    ra.field("receptions", r["receptions"], pbp["receptions"],
                             ref_id=f"espn_pbp:{pbp['abbr']}",
                             verdict="MATCH" if agree else "UNRESOLVED",
                             note="ESPN's box score omits this athlete entirely; the "
                                  "reference number is counted from ESPN's OWN "
                                  "play-by-play text, a second ESPN surface. That tally "
                                  "is a heuristic — it cannot see laterals, plays negated "
                                  "by penalty or two-point conversions — so agreement "
                                  "corroborates but disagreement settles nothing.")
                    for c in live:
                        if c == "receptions":
                            continue
                        ra.field(c, r[c], None, verdict="UNRESOLVED",
                                 note="ESPN's box score omits this athlete entirely "
                                      "although ESPN's own play-by-play names him; the "
                                      "box score cannot rule on this field")
                    stats["boxscore_omission_pbp"] += 1
                else:
                    for c in live:
                        ra.field(c, r[c], None, verdict="DB_ONLY",
                                 note="player carries non-zero counting stats here but "
                                      "does not appear anywhere in the ESPN box score, "
                                      "and ESPN's play-by-play does not name him either")
                    stats["db_only_player"] += 1
            else:
                ra.field("espn_participation", None, None, verdict="NOT_COMPARABLE",
                         note="all ESPN-comparable counting stats are zero/NULL and ESPN "
                              "omits players with no counting stats — structural absence")
                stats["zero_stat_row"] += 1
        else:
            es = espn_player_stats(pl["cats"])
            ra.field("franchise_id", r["franchise_id"], pl["team"],
                     ref_id=f"espn_athlete:{aid}")
            for c in ESPN_COMPARABLE:
                dbv = r[c]
                if c in es and es[c] is not None:
                    if c == "targets" and dbv != es[c]:
                        ra.field(c, dbv, es[c], verdict="MISMATCH", ref_id=f"espn:{aid}",
                                 note="ESPN sometimes charges an incompletion to a "
                                      "different receiver (known-good class, contract §5) "
                                      "— recorded, not adjudicated")
                    else:
                        ra.field(c, dbv, es[c], ref_id=f"espn:{aid}")
                else:
                    cat = ESPN_CAT_OF[c]
                    if (dbv or 0) == 0:
                        ra.field(c, dbv, 0, verdict="MATCH", ref_id=f"espn:{aid}")
                    elif c == "targets" and (r["receptions"] or 0) == 0:
                        ra.field(c, dbv, None, verdict="NOT_COMPARABLE",
                                 ref_id=f"espn:{aid}",
                                 note="ESPN omits zero-reception targets entirely "
                                      "(known-good, contract §5)")
                    else:
                        ra.field(c, dbv, None, verdict="MISMATCH", ref_id=f"espn:{aid}",
                                 note=f"ESPN publishes no `{cat}` line for this player "
                                      f"in this game")
            stats["espn_compared"] += 1

        for c in NOT_ESPN:
            ra.field(c, r[c], None, verdict="NOT_COMPARABLE",
                     note="ESPN publishes no EPA / share / fantasy figures")

        # game linkage (D1 class)
        if g is None:
            ra.field("game_id", gid, None, verdict="DB_ONLY", authority="derived",
                     evidence=raw_ev, note="game_id does not resolve to a `game` row "
                                           "in this partition")
        ra.emit(eid or gid)

    # ---- REF_ONLY sweep: ESPN offensive producers we have no row for -----------------
    refonly = 0
    ref_ev = {}
    for gid, b in bx.items():
        if not b:
            continue
        for aid, pl in b["players"].items():
            es = espn_player_stats(pl["cats"])
            if not any((es.get(c) or 0) != 0 for c in ESPN_COMPARABLE):
                continue
            if aid in db_by_game[gid]:
                continue
            if (pl.get("name") or "").lower() in dbname_by_game[gid]:
                continue          # same human, reached through the espn_id defect above
            if not gsis_of_espn.get(aid):
                ref_ev[f"{gid}/espn:{aid}"] = {"name": pl.get("name"), "team": pl["team"],
                                               "stats": es, "known_gsis": None}
            else:
                ref_ev[f"{gid}/espn:{aid}"] = {"name": pl.get("name"), "team": pl["team"],
                                               "stats": es,
                                               "known_gsis": sorted(gsis_of_espn[aid])}
    ridx = chunk_evidence("pgs_ref_only", ref_ev, size=500) if ref_ev else {}
    for k, v in sorted(ref_ev.items()):
        gid = k.split("/")[0]
        L.write(table="player_game_stats", row_key=k, season=games[gid]["season"],
                field="*", db_value=None, authority="espn", ref_id=k.split("espn:")[1],
                ref_value=v["stats"], verdict="REF_ONLY", evidence=ridx[k],
                note="ESPN credits this athlete with counting stats in this game and "
                     "player_game_stats has no row for them")
        refonly += 1
    stats["ref_only"] = refonly
    ctx["pgs_stats"] = stats
    return stats


# ======================================================================================
# PHASE snap
# ======================================================================================
def phase_snap(conn, L: Ledger, ctx: dict):
    games = ctx["games"]
    bx = build_boxscores(ctx)
    sums = ctx["summaries"]

    espn_of = {r["gsis_id"]: str(r["espn_id"]) for r in
               conn.execute("SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL")}
    players = {r[0] for r in conn.execute("SELECT gsis_id FROM player")}
    teams = {r[0] for r in conn.execute("SELECT franchise_id FROM team")}

    sl = build_slice("snap_counts", "snap_counts.csv")
    raw = {(r["pfr_player_id"], r["pfr_game_id"]): r for r in read_slice(sl)}
    raw_ev = rel(sl)

    d16 = {}
    for r in conn.execute("SELECT target_key, upstream_value, corrected_value "
                          "FROM data_correction WHERE defect='D16'"):
        d16[r["target_key"]] = (int(r["upstream_value"]), int(r["corrected_value"]))

    # every cached PFR attempt, for honest evidence of the external-authority outcome
    pfr_attempts = {}
    for meta in sorted(glob.glob(os.path.join(CACHE, "pfr_*.html.gz.meta.json"))):
        m = json.load(open(meta))
        gidp = re.search(r"pfr_(.+?)\.html\.gz", os.path.basename(meta)).group(1)
        pfr_attempts[gidp] = {"status": m["status"], "url": m["url"],
                              "evidence": rel(meta[:-len(".meta.json")])}
    ctx["pfr_attempts"] = pfr_attempts

    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM snap_count WHERE season IN (?,?)", SEASONS)]

    # Team snap totals. PFR publishes pct rounded to 2dp, so no single row pins the
    # denominator. The sound test is existential: is there ONE integer team total T for
    # which every row of that team-game satisfies |pct - snaps/T| <= 0.005 (+1e-9 for the
    # half-up/half-even boundary)? If such a T exists the team-game is internally
    # coherent; if none does, the rows genuinely contradict each other.
    pairs = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in rows:
        k = (r["game_id"], r["franchise_id"])
        for unit in ("offense", "defense", "st"):
            v, p = r[f"{unit}_snaps"], r[f"{unit}_pct"]
            if v is not None and p is not None and v > 0 and p > 0:
                pairs[k][unit].append((v, p))
    tot = {}
    for k, units in pairs.items():
        out = {}
        for unit, ps in units.items():
            lo = max(v for v, _ in ps)
            best, best_bad = None, None
            for T in range(lo, lo + 121):
                bad = sum(1 for v, p in ps if abs(p - v / T) > 0.005 + 1e-9)
                if best_bad is None or bad < best_bad:
                    best, best_bad = T, bad
                if bad == 0:
                    break
            out[unit] = {"total": best, "rows_inconsistent_at_best_T": best_bad,
                         "n_rows": len(ps)}
        tot[k] = out
    ctx["snap_team_totals"] = {f"{a}/{b}": v for (a, b), v in tot.items()}
    tidx = chunk_evidence("snap_team_totals", ctx["snap_team_totals"], size=500)

    stats = collections.Counter()
    for r in sorted(rows, key=lambda x: (x["pfr_game_id"], x["pfr_player_id"])):
        gid = r["game_id"]
        g = games.get(gid)
        key = f'{gid}/{r["pfr_player_id"]}'
        path, eid, doc = sums.get(gid, (None, None, None))
        b = bx.get(gid)
        ev = rel(path) if path else raw_ev
        ra = RowAudit(L, "snap_count", key, r["season"], "pro-football-reference", ev)

        # ---- external authority: PFR -------------------------------------------------
        att = pfr_attempts.get(r["pfr_game_id"])
        if att and att["status"] == 200:
            stats["pfr_available"] += 1        # parsed below if we ever get a 200
        ra.field("pfr_snapcounts", [r["offense_snaps"], r["defense_snaps"], r["st_snaps"]],
                 None, verdict="UNRESOLVED",
                 evidence=att["evidence"] if att else raw_ev,
                 ref_id=r["pfr_game_id"],
                 note=("Pro-Football-Reference returned HTTP %s (Cloudflare interstitial) "
                       "for every request from this environment; the cached response is "
                       "the evidence. No independent snap-count authority exists — ESPN "
                       "does not publish snap counts."
                       % (att["status"] if att else "403 (sampled games)")))

        # ---- transport ---------------------------------------------------------------
        rr = raw.get((r["pfr_player_id"], r["pfr_game_id"]))
        if rr is None:
            ra.field("nflverse_transport", key, None, verdict="DB_ONLY",
                     authority="nflverse", evidence=raw_ev,
                     note="no row with this (pfr_player_id, pfr_game_id) in "
                          "raw/snap_counts.csv")
            stats["no_raw"] += 1
        else:
            bad = []
            for dbcol, csvcol in (("offense_snaps", "offense_snaps"),
                                  ("offense_pct", "offense_pct"),
                                  ("defense_snaps", "defense_snaps"),
                                  ("defense_pct", "defense_pct"),
                                  ("st_snaps", "st_snaps"), ("st_pct", "st_pct"),
                                  ("position", "position"), ("season", "season"),
                                  ("source_week", "week"),
                                  ("source_game_type", "game_type")):
                dv, rv = r[dbcol], rr.get(csvcol)
                ok = (str(dv) == str(rv)) if isinstance(dv, str) or dv is None \
                    else close(dv, num(rv), 1e-6)
                if not ok:
                    bad.append((dbcol, dv, rv))
            for c, dv, rv in bad:
                ra.field(f"nflverse:{c}", dv, rv, verdict="MISMATCH",
                         authority="nflverse", evidence=raw_ev)
            if not bad:
                ra.field("nflverse_transport", "identical", "identical",
                         authority="nflverse", evidence=raw_ev)
            else:
                stats["transport_bad"] += 1

        # ---- D16: franchise_id vs preserved upstream ---------------------------------
        ck = f'{gid}/{r["pfr_player_id"]}'
        if r["franchise_id"] != r["franchise_id_upstream"]:
            if ck in d16 and d16[ck] == (r["franchise_id_upstream"], r["franchise_id"]):
                ra.field("D16_correction", r["franchise_id"], d16[ck][1],
                         authority="data_correction", evidence=raw_ev, ref_id=ck)
                stats["d16_rows"] += 1
            else:
                ra.field("franchise_id_upstream", r["franchise_id_upstream"],
                         r["franchise_id"], verdict="MISMATCH",
                         authority="data_correction", evidence=raw_ev, ref_id=ck,
                         note="franchise_id diverges from the preserved upstream value "
                              "with no matching D16 correction row")
                stats["unlogged_divergence"] += 1
        elif ck in d16:
            ra.field("D16_correction", r["franchise_id"], d16[ck][1], verdict="MISMATCH",
                     authority="data_correction", evidence=raw_ev, ref_id=ck,
                     note="a D16 correction exists for this row but franchise_id still "
                          "equals the upstream value")
            stats["unapplied_correction"] += 1

        # ---- structural / referential -------------------------------------------------
        ra.field("fk_player", r["gsis_id"] in players, True, authority="derived",
                 evidence=raw_ev, ref_id="player.gsis_id")
        ra.field("fk_team", r["franchise_id"] in teams, True, authority="derived",
                 evidence=raw_ev, ref_id="team.franchise_id")
        anysnap = any((r[f"{u}_snaps"] or 0) > 0 for u in ("offense", "defense", "st"))
        ra.field("has_any_snap", anysnap, True, authority="derived", evidence=raw_ev,
                 ref_id="offense+defense+st",
                 note=None if anysnap else
                 "snap row records zero offensive, defensive and special-teams snaps — "
                 "it asserts a participation fact with no participation in it")
        if g is None:
            ra.field("fk_game", gid, None, verdict="DB_ONLY", authority="derived",
                     evidence=raw_ev, note="game_id absent from `game`")
        else:
            ra.field("team_plays_in_game",
                     r["franchise_id"] in (g["away_franchise_id"], g["home_franchise_id"]),
                     True, authority="derived", evidence=raw_ev, ref_id=gid,
                     note=None if r["franchise_id"] in (g["away_franchise_id"],
                                                        g["home_franchise_id"])
                     else "snap row credits a franchise that did not play in this game")
            ra.field("season_type", r["season_type"], g["season_type"],
                     authority="derived", evidence=raw_ev, ref_id=gid)
            ra.field("week", r["week"], g["week"], authority="derived",
                     evidence=raw_ev, ref_id=gid)
            ra.field("playoff_round", r["playoff_round"], g["playoff_round"],
                     authority="derived", evidence=raw_ev, ref_id=gid)

        # ---- ESPN participation cross-check (genuinely external, team-side only) ------
        aid = espn_of.get(r["gsis_id"])
        pl = (b or {}).get("players", {}).get(aid) if (b and aid) else None
        if pl is not None:
            ra.field("espn_team_of_player", r["franchise_id"], pl["team"],
                     authority="espn", evidence=rel(path), ref_id=f"espn:{aid}",
                     note=None if r["franchise_id"] == pl["team"] else
                     "ESPN's box score puts this athlete on the other team in this game "
                     "— the D16 transposition signature")
            stats["espn_team_checked"] += 1
        else:
            ra.field("espn_team_of_player", r["franchise_id"], None,
                     verdict="NOT_COMPARABLE", authority="espn", evidence=ev,
                     note="athlete has no counting stats in the ESPN box score, so ESPN "
                          "cannot place them on a side")

        # ---- percentage arithmetic ----------------------------------------------------
        tk = f'{gid}/{r["franchise_id"]}'
        tt = ctx["snap_team_totals"].get(tk, {})
        for unit in ("offense", "defense", "st"):
            snaps, pct = r[f"{unit}_snaps"], r[f"{unit}_pct"]
            info = tt.get(unit) or {}
            base = info.get("total")
            if snaps is None or pct is None or snaps <= 0 or pct <= 0 or not base:
                continue
            resid = abs(pct - snaps / base)
            if pct > 1.0:
                ra.field(f"{unit}_pct_arith", round(pct, 3), round(snaps / base, 3),
                         authority="derived", evidence=tidx.get(tk, raw_ev),
                         ref_id=f"team_{unit}_snaps={base}", verdict="MISMATCH",
                         note=f"published {unit}_pct exceeds 1.0 — a participation share "
                              f"above 100% is impossible whatever the denominator")
                stats[f"pct_over_one_{unit}"] += 1
            elif resid <= 0.005 + 1e-9:
                ra.field(f"{unit}_pct_arith", round(pct, 3), round(snaps / base, 3),
                         authority="derived", evidence=tidx.get(tk, raw_ev),
                         ref_id=f"team_{unit}_snaps={base}", verdict="MATCH")
            elif resid <= 0.01 + 1e-9:
                ra.field(f"{unit}_pct_arith", round(pct, 3), round(snaps / base, 3),
                         verdict="NOT_COMPARABLE", authority="derived",
                         evidence=tidx.get(tk, raw_ev),
                         ref_id=f"team_{unit}_snaps={base}",
                         note=f"published {unit}_pct is {resid:.3f} off the best single "
                              f"team denominator (T={base}) — under one percentage point, "
                              f"i.e. rounding drift inside the upstream published figure. "
                              f"Only Pro-Football-Reference could settle it and PFR is "
                              f"unreachable from here (HTTP 403).")
                stats[f"pct_rounding_drift_{unit}"] += 1
            else:
                ra.field(f"{unit}_pct_arith", round(pct, 3), round(snaps / base, 3),
                         authority="derived", evidence=tidx.get(tk, raw_ev),
                         ref_id=f"team_{unit}_snaps={base}", verdict="MISMATCH",
                         note=f"published {unit}_pct is {resid:.3f} off the best single "
                              f"team denominator (T={base}, which leaves "
                              f"{info.get('rows_inconsistent_at_best_T')} of "
                              f"{info.get('n_rows')} rows out) — more than a percentage "
                              f"point, beyond any rounding explanation")
                stats[f"pct_material_{unit}"] += 1
        ra.emit(r["pfr_game_id"])
        stats["ok"] += 1

    ctx["snap_stats"] = stats
    return stats


# ======================================================================================
# PHASE roster
# ======================================================================================
def phase_roster(conn, L: Ledger, ctx: dict):
    games = ctx["games"]
    players = {r[0] for r in conn.execute("SELECT gsis_id FROM player")}
    teams = {r[0] for r in conn.execute("SELECT franchise_id FROM team")}
    espn_of = {r["gsis_id"]: str(r["espn_id"]) for r in
               conn.execute("SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL")}

    # ---------------------------------------------------------------------------------
    # ESPN membership authority.
    #
    # ESPN's seasons/{y}/teams/{id}/athletes endpoint is NOT usable for historical
    # membership: it was fetched for all 64 team-seasons here and, for 2020 Atlanta,
    # only 3 of the 56 athletes who actually appear in Atlanta's own 2020 ESPN box
    # scores are in it. The endpoint is recorded as evidence of that determination, but
    # it is not used to rule on any row.
    #
    # What ESPN CAN prove is participation: an athlete listed in a team's box score in
    # season S was on that team in season S. That is used as the positive test; it can
    # only confirm, never refute, so a miss is NOT_COMPARABLE and never a MISMATCH.
    # ---------------------------------------------------------------------------------
    espn_roster, espn_files = {}, {}
    for season in SEASONS:
        for fid in sorted(teams):
            p = os.path.join(CACHE, f"roster_{season}_{fid}.json.gz")
            if not os.path.exists(p):
                continue
            espn_files[(season, fid)] = rel(p)
            try:
                doc = load_json(p)
            except Exception:                                    # noqa: BLE001
                continue
            ids = set()
            for it in doc.get("items") or []:
                m = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
                if m:
                    ids.add(m.group(1))
            espn_roster[(season, fid)] = ids
    ctx["espn_roster_sizes"] = {f"{s}/{f}": len(v) for (s, f), v in espn_roster.items()}

    bx = build_boxscores(ctx)
    box_member = collections.defaultdict(set)
    box_ev = {}
    for gid, b in bx.items():
        if not b:
            continue
        season = games[gid]["season"]
        for aid, pl in b["players"].items():
            box_member[(season, pl["team"])].add(aid)
            box_ev.setdefault((season, pl["team"]), rel(ctx["summaries"][gid][0]))
    ctx["espn_box_member_sizes"] = {f"{s}/{f}": len(v) for (s, f), v in box_member.items()}

    sl = build_slice("rosters", "rosters.csv")
    raw = collections.defaultdict(list)
    for row in read_slice(sl):
        raw[(row["gsis_id"], row["season"], row["team"], row["week"],
             row["game_type"])].append(row)
    raw_ev = rel(sl)

    abbr_of = {r["franchise_id"]: r["abbreviation"] for r in
               conn.execute("SELECT franchise_id, abbreviation FROM team")}
    alias_of = collections.defaultdict(set)
    for r in conn.execute("SELECT abbreviation, franchise_id FROM team_alias"):
        alias_of[r["franchise_id"]].add(r["abbreviation"])
    for f, a in abbr_of.items():
        alias_of[f].add(a)

    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM roster_season WHERE season IN (?,?)", SEASONS)]

    stats = collections.Counter()
    for r in sorted(rows, key=lambda x: x["roster_row_id"]):
        season, fid = r["season"], r["franchise_id"]
        key = f'{season}/{fid}/{r["gsis_id"] or "NULL"}/{r["source_game_type"]}' \
              f'{r["source_week"]}/{r["source_ordinal"]}'
        ev = espn_files.get((season, fid), raw_ev)
        ra = RowAudit(L, "roster_season", key, season, "espn", ev)

        # transport
        hit = None
        for ab in alias_of[fid]:
            cand = raw.get((r["gsis_id"] or "", str(season), ab, str(r["source_week"]),
                            r["source_game_type"]))
            if cand:
                hit = cand[min(r["source_ordinal"], len(cand)) - 1]
                break
        if hit is None:
            ra.field("nflverse_transport", key, None, verdict="DB_ONLY",
                     authority="nflverse", evidence=raw_ev,
                     note="no matching row in raw/rosters.csv")
            stats["no_raw"] += 1
        else:
            bad = []
            for dbcol, csvcol in (("position", "position"),
                                  ("depth_chart_position", "depth_chart_position"),
                                  ("jersey_number", "jersey_number"),
                                  ("status", "status"), ("full_name", "full_name"),
                                  ("years_exp", "years_exp")):
                dv, rv = r[dbcol], hit.get(csvcol)
                rv = None if rv in ("", "NA", None) else rv
                if isinstance(dv, int) and rv is not None:
                    ok = close(dv, num(rv), 1e-6)
                else:
                    ok = (dv or None) == (rv or None)
                if not ok:
                    bad.append((dbcol, dv, rv))
            for c, dv, rv in bad:
                ra.field(f"nflverse:{c}", dv, rv, verdict="MISMATCH",
                         authority="nflverse", evidence=raw_ev)
            if not bad:
                ra.field("nflverse_transport", "identical", "identical",
                         authority="nflverse", evidence=raw_ev)
            else:
                stats["transport_bad"] += 1

        # referential
        ra.field("fk_team", fid in teams, True, authority="derived", evidence=raw_ev)
        if r["gsis_id"] is None:
            ra.field("gsis_id", None, None, verdict="NOT_COMPARABLE", authority="derived",
                     evidence=raw_ev,
                     note="upstream row publishes no gsis_id (known N9 class, 18 rows "
                          "league-wide); the FK is legally NULL")
            stats["null_gsis"] += 1
        else:
            ra.field("fk_player", r["gsis_id"] in players, True, authority="derived",
                     evidence=raw_ev)

        # ESPN membership — box-score participation is the only sound ESPN test here
        aid = espn_of.get(r["gsis_id"]) if r["gsis_id"] else None
        bm = box_member.get((season, fid), set())
        if aid is None:
            ra.field("espn_membership", fid, None, verdict="NOT_COMPARABLE",
                     note="player has no espn_id in the player dimension, so ESPN cannot "
                          "be queried for membership")
            stats["no_espn_id"] += 1
        elif aid in bm:
            ra.field("espn_membership", fid, fid, ref_id=f"espn:{aid}",
                     evidence=box_ev.get((season, fid), ev),
                     note="ESPN box scores place this athlete on this franchise in this "
                          "season")
            stats["espn_confirmed"] += 1
        else:
            ra.field("espn_membership", fid, None, verdict="NOT_COMPARABLE",
                     ref_id=f"espn:{aid}",
                     note="ESPN cannot rule: its box scores list only players who record "
                          "a counting stat, and its seasons/{y}/teams/{id}/athletes "
                          "endpoint is demonstrably wrong for historical seasons (for "
                          "2020 ATL it returns 92 athletes of whom only 3 appear in "
                          "Atlanta's own 2020 ESPN box scores). Absence here is not "
                          "evidence of non-membership.")
            stats["espn_cannot_rule"] += 1
        ra.emit(f"{season}/{fid}")
        stats["ok"] += 1

    ctx["roster_stats"] = stats
    return stats


# ======================================================================================
# PHASE depth
# ======================================================================================
def phase_depth(conn, L: Ledger, ctx: dict):
    games = ctx["games"]
    players = {r[0] for r in conn.execute("SELECT gsis_id FROM player")}
    teams = {r[0] for r in conn.execute("SELECT franchise_id FROM team")}

    sl = build_slice("depth_charts", "depth_charts.csv")

    def nz(v):
        """The loader trims whitespace-only cells to NULL; match on the same normal form."""
        return "" if v is None else str(v).strip()

    raw = collections.defaultdict(list)
    for row in read_slice(sl):
        # depth_team is part of the natural key, not a payload: one player can hold two
        # slots at the same published position in the same week.
        raw[(nz(row["season"]), nz(row["club_code"]), nz(row["week"]),
             nz(row["game_type"]), nz(row["gsis_id"]),
             nz(row["depth_position"]), nz(row["depth_team"]))].append(row)
    raw_ev = rel(sl)
    ctx["depth_raw_rows"] = sum(len(v) for v in raw.values())

    abbr_of = {r["franchise_id"]: r["abbreviation"] for r in
               conn.execute("SELECT franchise_id, abbreviation FROM team")}
    alias_of = collections.defaultdict(set)
    for r in conn.execute("SELECT abbreviation, franchise_id FROM team_alias"):
        alias_of[r["franchise_id"]].add(r["abbreviation"])
    for f, a in abbr_of.items():
        alias_of[f].add(a)

    # roster_season is NOT a per-week roster: nflverse publishes one row per player per
    # (season, game_type) with `week` marking the LAST week that player appears in the
    # weekly feed (1,494 of 2020's 1,893 REG rows sit on week 17). Season-level membership
    # is therefore the only sound cross-table check.
    roster_season_membership = collections.defaultdict(set)
    for r in conn.execute("SELECT season, franchise_id, gsis_id "
                          "FROM roster_season WHERE season IN (?,?)", SEASONS):
        roster_season_membership[(r["season"], r["franchise_id"])].add(r["gsis_id"])

    reg_weeks = {}
    for r in conn.execute("SELECT season, MAX(week) m FROM game WHERE season IN (?,?) "
                          "AND season_type='REG' GROUP BY season", SEASONS):
        reg_weeks[r["season"]] = r["m"]

    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM depth_chart WHERE season IN (?,?)", SEASONS)]

    natural = collections.Counter()
    exact = collections.Counter()
    for r in rows:
        nk = (r["season"], r["franchise_id"], r["source_week"], r["source_game_type"],
              r["depth_position"], r["depth_order"], r["gsis_id"], r["espn_id"])
        natural[nk] += 1
        exact[nk + (r["source_ordinal"],)] += 1
    ctx["depth_natural_dup_groups"] = sum(1 for v in natural.values() if v > 1)

    struct = {}
    for r in rows:
        rid = str(r["depth_chart_id"])
        nk = (r["season"], r["franchise_id"], r["source_week"], r["source_game_type"],
              r["depth_position"], r["depth_order"], r["gsis_id"], r["espn_id"])
        checks = {}
        checks["fk_team"] = r["franchise_id"] in teams
        checks["identity_present"] = (r["gsis_id"] is not None) or (r["espn_id"] is not None)
        checks["fk_player"] = (r["gsis_id"] is None) or (r["gsis_id"] in players)
        checks["week_round_exclusive"] = (r["week"] is None) or (r["playoff_round"] is None)
        checks["type_week_coherent"] = (
            (r["week"] is not None and r["season_type"] == "REG")
            or (r["playoff_round"] is not None and r["season_type"] == "POST")
            or (r["week"] is None and r["playoff_round"] is None and r["season_type"] is None))
        checks["bucket_coherent"] = (r["week"] is not None or r["playoff_round"] is not None
                                     or r["bucket"] in ("postseason", "offseason"))
        checks["shape_snapshot"] = (r["source_shape"] == "B") == (r["snapshot_ts"] is not None)
        checks["depth_order_positive"] = (r["depth_order"] is None) or (r["depth_order"] >= 1)
        checks["source_week_range"] = (r["source_week"] is None) or (1 <= r["source_week"] <= 22)
        # a published slot label must resolve through POSITION_CROSSWALK; a NULL label
        # has nothing to resolve and is not a failure
        checks["canonical_position"] = (r["depth_position"] is None
                                        or r["depth_position_canonical"] is not None)
        # source_ordinal is what makes upstream duplicate rows distinguishable (D23/N8)
        checks["distinguishable"] = exact[nk + (r["source_ordinal"],)] == 1
        # the week-18 / week-19 collision: nflverse keeps publishing REG charts one week
        # past the real regular season. Those rows MUST NOT be stored as a regular week.
        over = (r["source_game_type"] == "REG"
                and r["source_week"] is not None
                and r["source_week"] > reg_weeks.get(r["season"], 17))
        checks["week_encoding"] = (not over) or (r["week"] is None
                                                 and r["playoff_round"] is None
                                                 and r["bucket"] == "postseason")
        checks["on_roster_that_season"] = (
            r["gsis_id"] is None
            or r["gsis_id"] in roster_season_membership.get((r["season"],
                                                             r["franchise_id"]), set()))
        struct[rid] = {"checks": checks, "key": [r["season"], r["franchise_id"],
                                                 r["source_week"], r["source_game_type"],
                                                 r["depth_position"], r["depth_order"],
                                                 r["source_ordinal"]],
                       "natural_key_multiplicity": natural[nk]}
    sidx = chunk_evidence("depth_structural", struct, size=4000)

    stats = collections.Counter()
    for r in sorted(rows, key=lambda x: x["depth_chart_id"]):
        rid = str(r["depth_chart_id"])
        key = (f'{r["season"]}/{r["franchise_id"]}/{r["source_game_type"]}'
               f'{r["source_week"]}/{r["depth_position"]}/{r["depth_order"]}/{rid}')
        ev = sidx[rid]
        ra = RowAudit(L, "depth_chart", key, r["season"], "internal", ev)

        # transport
        hit = None
        for ab in alias_of[r["franchise_id"]]:
            cand = raw.get((nz(r["season"]), ab, nz(r["source_week"]),
                            nz(r["source_game_type"]), nz(r["gsis_id"]),
                            nz(r["depth_position"]), nz(r["depth_order"])))
            if cand:
                hit = cand[min(r["source_ordinal"], len(cand)) - 1]
                break
        if hit is None:
            ra.field("nflverse_transport", key, None, verdict="MISMATCH",
                     authority="nflverse", evidence=raw_ev,
                     note="no matching row in raw/depth_charts.csv on "
                          "(season, club, week, game_type, gsis_id, depth_position)")
            stats["no_raw"] += 1
        else:
            bad = []
            for dbcol, csvcol in (("position", "position"),
                                  ("jersey_number", "jersey_number"),
                                  ("full_name", "full_name"), ("elias_id", "elias_id")):
                dv, rv = r[dbcol], hit.get(csvcol)
                rv = None if rv in ("", "NA", None) else rv
                if isinstance(dv, int) and rv is not None:
                    ok = close(dv, num(rv), 1e-6)
                else:
                    ok = (dv or None) == (rv or None)
                if not ok:
                    bad.append((dbcol, dv, rv))
            for c, dv, rv in bad:
                ra.field(f"nflverse:{c}", dv, rv, verdict="MISMATCH",
                         authority="nflverse", evidence=raw_ev)
            if not bad:
                ra.field("nflverse_transport", "identical", "identical",
                         authority="nflverse", evidence=raw_ev)
            else:
                stats["transport_bad"] += 1

        for name, ok in struct[rid]["checks"].items():
            ra.field(name, ok, True, authority="internal", evidence=ev,
                     verdict="MATCH" if ok else "MISMATCH",
                     note=None if ok else f"internal/structural check `{name}` failed")
            if not ok:
                stats[f"fail_{name}"] += 1

        ra.field("external_validation", None, None, verdict="NOT_COMPARABLE",
                 authority="none", evidence=ev,
                 note="No historical public source for NFL depth charts exists — ESPN "
                      "publishes the current chart only. This row is validated "
                      "internally and structurally ONLY; no external authority ruled "
                      "on it (contract table, depth_chart).")
        ra.emit(rid, force="NOT_COMPARABLE")
        stats["ok"] += 1

    ctx["depth_stats"] = stats
    return stats


# ======================================================================================
def run_audit(conn, phase: str) -> int:
    t0 = time.time()
    md5_start = md5(DB)
    print(f"[db] md5 at start: {md5_start}")
    ctx = {"md5_start": md5_start}
    ctx["games"] = load_games(conn)
    ctx["summaries"] = summaries(conn)
    order = ["game", "line", "teamgame", "pgs", "snap", "roster", "depth"]
    todo = order if phase in ("all", "assemble") else [phase]
    if phase not in ("all", "assemble"):
        # `line`, `teamgame` need the derived rest map that `game` computes
        if phase in ("line", "teamgame"):
            L0 = Ledger("_warm")
            phase_game(conn, L0, ctx)
            L0.close()
            os.remove(L0.path)
    fn = {"game": phase_game, "line": phase_line, "teamgame": phase_teamgame,
          "pgs": phase_pgs, "snap": phase_snap, "roster": phase_roster,
          "depth": phase_depth}
    sfile = os.path.join(CACHE, "phase_summary.json")
    summary = json.load(open(sfile)) if os.path.exists(sfile) else {}
    if phase != "assemble":
        for p in todo:
            L = Ledger(p)
            st = fn[p](conn, L, ctx)
            L.close()
            summary[p] = {"ledger_rows": L.n, "row_keys": {t: len(v) for t, v in
                                                           L.rowkeys.items()},
                          "verdicts": dict(L.verdicts), "stats": dict(st)}
            print(f"[{p}] {L.n} ledger rows  {dict(L.verdicts)}  ({time.time()-t0:.0f}s)",
                  flush=True)
            with open(sfile, "w") as fh:
                json.dump(summary, fh, indent=1, default=str)

    # assemble
    os.makedirs(LEDGER_DIR, exist_ok=True)
    with open(LEDGER, "w", encoding="utf-8") as out:
        for p in order:
            sp = os.path.join(PARTS, f"{p}.jsonl")
            if os.path.exists(sp):
                with open(sp, encoding="utf-8") as fh:
                    for line in fh:
                        out.write(line)
    ctx["md5_end"] = md5(DB)
    print(f"[db] md5 at end:   {ctx['md5_end']}  "
          f"({'UNCHANGED' if ctx['md5_end'] == ctx['md5_start'] else 'CHANGED — STOP'})")
    with open(os.path.join(CACHE, "run.json"), "w") as fh:
        json.dump({"md5_start": ctx["md5_start"], "md5_end": ctx["md5_end"],
                   "summary": summary,
                   "hold_report": ctx.get("hold_report"),
                   "pfr_attempts": ctx.get("pfr_attempts"),
                   "espn_roster_sizes": ctx.get("espn_roster_sizes"),
                   "seconds": round(time.time() - t0, 1)}, fh, indent=1, default=str)
    print(f"[done] ledger -> {LEDGER}")
    return 0


# ======================================================================================
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", default="all",
                    choices=["fetch", "fetch-roster", "fetch-pfr", "game", "line",
                             "teamgame", "pgs", "snap", "roster", "depth", "all",
                             "assemble"])
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(DB):
        print(f"missing {DB}", file=sys.stderr)
        return 2
    conn = connect()

    if args.phase == "fetch":
        phase_fetch(conn, args.offline)
        return 0
    if args.phase == "fetch-roster":
        phase_fetch_roster(conn, args.offline)
        return 0
    if args.phase == "fetch-pfr":
        phase_fetch_pfr(conn, args.offline)
        return 0

    return run_audit(conn, args.phase)


if __name__ == "__main__":
    sys.exit(main())
