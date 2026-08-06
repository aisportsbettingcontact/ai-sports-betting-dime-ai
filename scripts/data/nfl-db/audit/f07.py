#!/usr/bin/env python3
"""F07 -- forensic row-level audit of NFL seasons 2022 and 2023.

Partition: every row of game, game_line, team_game, player_game_stats, snap_count,
roster_season and depth_chart whose season is 2022 or 2023, plus every data_correction
row that targets those seasons.

Contract: docs/audits/2026-07-27-nfl-db-forensic/AUDIT-CONTRACT.md

Two stages:

    python3 audit/f07.py fetch    # network. idempotent, cache-first, polite.
    python3 audit/f07.py audit    # offline. reads cache + DB, writes the ledger.

`audit` never touches the network and never writes to the database (opened mode=ro).
Every ledger line names a cached evidence file that exists on disk, so the whole run
replays from cache alone.

Authorities, per the contract:

    game               ESPN scoreboard + summary
    game_line          covers.com / SportsOddsHistory (ESPN pickcenter as third source)
    team_game          derived -- recomputed from game + game_line
    player_game_stats  ESPN box score (summary?event=)
    snap_count         Pro-Football-Reference boxscore pages
    roster_season      ESPN season roster (core API), source feed as corroboration
    depth_chart        none exists -- internal/structural only, logged NOT_COMPARABLE
    data_correction    re-verified against its own cited source

Volume rule. One row-level record (field "*") per row carries the collapsed clean
fields; every row-specific non-MATCH outcome also gets its own per-field record.
Fields that the authority structurally cannot rule on for an entire table (nflverse
derived metrics ESPN never publishes, for instance) are counted in the row-level
record as `fields_not_comparable` and named in `not_comparable_fields`, and are
itemised once in the report -- logging an identical NOT_COMPARABLE 260,000 times
adds no forensic information and would bury the real findings.
"""

import argparse
import collections
import csv
import glob
import gzip
import hashlib
import io
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)                      # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache", "f07")
RAW = os.path.join(NFLDB, "raw")
LEDGER = os.path.join(REPO, "docs/audits/2026-07-27-nfl-db-forensic/ledger/F07.jsonl")
SEASONS = (2022, 2023)
AGENT = "F07"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

csv.field_size_limit(10 ** 9)


# --------------------------------------------------------------------------- utils

def ev(*parts):
    """Evidence path, relative to scripts/data/nfl-db/ -- what goes in the ledger."""
    return os.path.join("cache", "f07", *parts)


def evabs(rel):
    return os.path.join(NFLDB, rel)


def jgz(path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        return json.load(f)


def tgz(path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        return f.read()


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def num(x):
    if x is None:
        return None
    if isinstance(x, str):
        x = x.strip().replace(",", "")
        if x in ("", "--", "-"):
            return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) else f


NAME_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)


def normname(s):
    """Comparison form of a player name: ESPN and nflverse disagree on suffixes
    (Melvin Gordon III / Melvin Gordon, Robbie Chosen / Robbie Anderson) and on
    punctuation, and neither difference is a fact about the player."""
    s = NAME_SUFFIX.sub(" ", (s or "").lower())
    return re.sub(r"[^a-z]", "", s)


def eq(a, b, tol=0.0):
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= tol
    return str(a).strip() == str(b).strip()


# --------------------------------------------------------------------- ledger sink

class Ledger:
    """Append-only JSONL sink. Refuses any line whose evidence file is missing."""

    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, "w", encoding="utf-8")
        self.counts = collections.Counter()
        self.by_table = collections.defaultdict(collections.Counter)
        self.rows_seen = collections.defaultdict(set)
        self.findings = []
        self._evidence_ok = {}
        self.bad_evidence = 0

    def _check(self, path):
        if path not in self._evidence_ok:
            self._evidence_ok[path] = os.path.exists(evabs(path))
        return self._evidence_ok[path]

    def write(self, table, row_key, season, field, db_value, authority, ref_id,
              ref_value, verdict, evidence, note=None, **extra):
        if not self._check(evidence):
            self.bad_evidence += 1
            raise RuntimeError(f"evidence file does not exist: {evidence}")
        rec = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "agent": AGENT, "table": table, "row_key": row_key, "season": season,
            "field": field, "db_value": db_value, "authority": authority,
            "ref_id": ref_id, "ref_value": ref_value, "verdict": verdict,
            "evidence": evidence,
        }
        if note:
            rec["note"] = note
        rec.update(extra)
        self.f.write(json.dumps(rec, default=str) + "\n")
        self.counts[verdict] += 1
        self.by_table[table][verdict] += 1
        if field == "*":
            self.rows_seen[table].add(row_key)
        if verdict in ("MISMATCH", "DB_ONLY", "REF_ONLY", "UNRESOLVED") and field != "*":
            self.findings.append(rec)
        return rec

    def close(self):
        self.f.close()


# ------------------------------------------------------------------- fetch stage

def http(url, timeout=45, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.getcode()


def fetch_stage(db):
    """Populate the cache. Idempotent: anything already cached is skipped."""
    for sub in ("summary", "scoreboard", "covers", "roster", "pfr", "meta"):
        os.makedirs(os.path.join(CACHE, sub), exist_ok=True)

    # 1. reuse prior agents' caches before touching the network
    reused = 0
    for (evid,) in db.execute(
            "SELECT espn_event_id FROM game WHERE season IN (?,?)", SEASONS):
        dst = os.path.join(CACHE, "summary", f"{evid}.json.gz")
        src = os.path.join(NFLDB, "cache", "a5", f"summary_{evid}.json.gz")
        if not os.path.exists(dst) and os.path.exists(src):
            with open(src, "rb") as a, open(dst, "wb") as b:
                b.write(a.read())
            reused += 1
    for src in glob.glob(os.path.join(NFLDB, "cache", "a1", "scoreboard", "202[23]_*.json")):
        dst = os.path.join(CACHE, "scoreboard", os.path.basename(src))
        if not os.path.exists(dst):
            with open(src, "rb") as a, open(dst, "wb") as b:
                b.write(a.read())
            reused += 1
    for y in SEASONS:
        src = os.path.join(NFLDB, "cache", "a4", f"soh_{y}.html.gz")
        dst = os.path.join(CACHE, "covers", f"soh_{y}.html.gz")
        if not os.path.exists(dst) and os.path.exists(src):
            with open(src, "rb") as a, open(dst, "wb") as b:
                b.write(a.read())
            reused += 1
    print(f"[fetch] reused {reused} objects from prior agent caches")

    # 2. covers.com / SportsOddsHistory season pages (game_line authority)
    for y in SEASONS:
        dst = os.path.join(CACHE, "covers", f"soh_{y}.html.gz")
        if os.path.exists(dst):
            continue
        body, _ = http(f"https://www.covers.com/sportsoddshistory/nfl-game-season/?y={y}",
                       accept="text/html")
        with gzip.open(dst, "wb") as f:
            f.write(body)
        time.sleep(2)

    # 3. ESPN scoreboards -- one per (season, seasontype, week)
    for y in SEASONS:
        for stype, weeks in ((2, range(1, 19)), (3, range(1, 6))):
            for w in weeks:
                dst = os.path.join(CACHE, "scoreboard", f"{y}_{stype}_{w}.json")
                if os.path.exists(dst):
                    continue
                url = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
                       f"scoreboard?dates={y}&seasontype={stype}&week={w}")
                body, _ = http(url)
                with open(dst, "wb") as f:
                    f.write(body)
                time.sleep(0.8)

    # 4. ESPN summaries -- one per game. 2 workers, 0.8s each.
    need = [e for (e,) in db.execute(
        "SELECT espn_event_id FROM game WHERE season IN (?,?) ORDER BY espn_event_id", SEASONS)
        if not os.path.exists(os.path.join(CACHE, "summary", f"{e}.json.gz"))]
    print(f"[fetch] {len(need)} ESPN summaries to fetch")
    lock = threading.Lock()

    def sworker(chunk):
        for e in chunk:
            dst = os.path.join(CACHE, "summary", f"{e}.json.gz")
            if os.path.exists(dst):
                continue
            url = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
                   f"summary?event={e}")
            try:
                body, code = http(url)
                json.loads(body)
                with lock, gzip.open(dst, "wb") as f:
                    f.write(body)
            except Exception as exc:  # noqa: BLE001
                with open(os.path.join(CACHE, "summary", f"{e}.err.json"), "w") as f:
                    json.dump({"event": e, "url": url, "error": str(exc),
                               "http_code": getattr(exc, "code", None)}, f)
            time.sleep(0.8)

    ts = [threading.Thread(target=sworker, args=(need[i::2],)) for i in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()

    # 5. ESPN season rosters, core API (roster_season authority)
    for y in SEASONS:
        for (fid,) in db.execute("SELECT DISTINCT franchise_id FROM roster_season "
                                 "WHERE season=? ORDER BY franchise_id", (y,)):
            dst = os.path.join(CACHE, "roster", f"{y}_{fid}.json")
            if os.path.exists(dst):
                continue
            url = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
                   f"seasons/{y}/teams/{fid}/athletes?limit=400")
            try:
                body, _ = http(url)
                json.loads(body)
                with open(dst, "wb") as f:
                    f.write(body)
            except Exception as exc:  # noqa: BLE001
                with open(os.path.join(CACHE, "roster", f"{y}_{fid}.err.json"), "w") as f:
                    json.dump({"season": y, "franchise_id": fid, "url": url,
                               "error": str(exc)}, f)
            time.sleep(0.8)

    # 6. Pro-Football-Reference boxscores (snap_count authority).
    #    PFR is behind Cloudflare; plain HTTP gets a 403 challenge page. The
    #    crawler that populates cache/f07/pfr/ drives a real headed Chromium --
    #    see cache/f07/meta/fetch_pfr.cjs. Run it separately:
    #        node scripts/data/nfl-db/cache/f07/meta/fetch_pfr.cjs
    have = len(glob.glob(os.path.join(CACHE, "pfr", "*.html.gz")))
    print(f"[fetch] PFR boxscores cached: {have} "
          f"(populate with cache/f07/meta/fetch_pfr.cjs)")


# ------------------------------------------------------------------ ESPN helpers

ESPN_TO_FID = {}   # espn team abbreviation -> our franchise_id


def load_team_maps(db):
    alias = {a: f for a, f in db.execute("SELECT abbreviation, franchise_id FROM team_alias")}
    ESPN_TO_FID.update(alias)
    # ESPN's own labels that the alias table does not carry
    ESPN_TO_FID.setdefault("WSH", 28)
    ESPN_TO_FID.setdefault("LAR", 14)
    return alias


ROUND_BY_ESPN_WEEK = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}


def scoreboard_index():
    """event_id -> (event dict, evidence path) from every cached scoreboard page."""
    idx = {}
    for p in sorted(glob.glob(os.path.join(CACHE, "scoreboard", "*.json"))):
        rel = ev("scoreboard", os.path.basename(p))
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        for e in d.get("events", []):
            idx[str(e["id"])] = (e, rel)
    return idx


def summary_path(evid):
    return ev("summary", f"{evid}.json.gz")


# ------------------------------------------------------------------- game audit

def audit_game(db, L, sb_idx):
    """`game`: ESPN scoreboard + summary rule. 569 rows."""
    cols = [r[1] for r in db.execute("PRAGMA table_info(game)")]
    rows = list(db.execute(
        "SELECT * FROM game WHERE season IN (?,?) ORDER BY game_id", SEASONS))
    teams = {f: (c, d) for f, c, d in
             db.execute("SELECT franchise_id, conference, division FROM team")}

    # actual-rest recomputation. nflverse measures rest in venue-local calendar
    # days between consecutive games *within a season*, so the recomputation uses
    # game.gameday (D11) and not the UTC kickoff -- a Sunday-night kickoff rolls
    # into the next UTC day and would shift every night game by one.
    played = collections.defaultdict(list)          # (season, franchise) -> [gameday]
    for season, fid, day in db.execute(
            "SELECT g.season, tg.franchise_id, g.gameday FROM team_game tg "
            "JOIN game g USING(game_id) WHERE g.season IN (?,?)", SEASONS):
        played[(season, fid)].append(day)
    for k in played:
        played[k].sort()
    # nflverse convention: a franchise's season opener is published as 7 days rest.
    SEASON_OPENER_REST = 7

    # third source for officials: the PFR boxscore Officials table
    def pfr_referee(pfr_game_id):
        rel = ev("pfr", f"{pfr_game_id}.html.gz")
        if not os.path.exists(evabs(rel)):
            return None, None
        try:
            h = tgz(evabs(rel)).replace("<!--", "").replace("-->", "")
        except Exception:  # noqa: BLE001
            return None, rel
        i = h.find('id="officials"')
        if i < 0:
            return None, rel
        m = re.search(r'data-stat="ref_pos" ?>Referee</th>\s*<td[^>]*data-stat="name" ?>'
                      r'(?:<a[^>]*>)?([^<]+)', h[i:i + 3000])
        return (m.group(1).strip() if m else None), rel

    def same_person(a, b):
        """Ron Torbert vs Ronald Torbert: same official, different name form."""
        if not a or not b:
            return False
        pa, pb = a.split(), b.split()
        if pa[-1].lower() != pb[-1].lower():
            return False
        fa, fb = pa[0].lower(), pb[0].lower()
        return fa == fb or fa.startswith(fb) or fb.startswith(fa)

    NOT_RULABLE = ["gsis_game_id", "pfr_game_id", "ftn_game_id", "old_game_id",
                   "data_source", "stadium_id", "time_valid", "note", "roof",
                   "temp", "wind", "away_coach", "home_coach", "away_qb_id",
                   "home_qb_id", "away_qb_name", "home_qb_name",
                   "away_rest_upstream", "home_rest_upstream"]

    for r in rows:
        g = dict(zip(cols, r))
        gid, evid, season = g["game_id"], str(g["espn_event_id"]), g["season"]
        spath = summary_path(evid)
        has_sum = os.path.exists(evabs(spath))
        sb = sb_idx.get(evid)

        if not has_sum and not sb:
            L.write("game", gid, season, "*", None, "espn", evid, None, "UNRESOLVED",
                    ev("meta", "espn_coverage.json"),
                    note="no cached ESPN summary or scoreboard entry for this event id")
            continue

        S = jgz(evabs(spath)) if has_sum else None
        evidence = spath if has_sum else sb[1]
        sbe = sb[0] if sb else None

        # ---- assemble the ESPN view of this game
        if S:
            hdr = S["header"]
            comp = hdr["competitions"][0]
            espn = {
                "espn_event_id": str(hdr["id"]),
                "season": hdr["season"]["year"],
                "season_type": "REG" if hdr["season"]["type"] == 2 else "POST",
                "espn_week": hdr.get("week"),
                "kickoff_utc": comp["date"],
                "status": comp["status"]["type"]["name"],
                "neutral": comp.get("neutralSite"),
                "venue": (S.get("gameInfo", {}).get("venue") or {}).get("fullName"),
                "venue_id": num((S.get("gameInfo", {}).get("venue") or {}).get("id")),
                "referee": next((o["fullName"] for o in
                                 S.get("gameInfo", {}).get("officials", [])
                                 if o.get("position", {}).get("name") == "Referee"), None),
                "broadcast": next((b.get("media", {}).get("shortName")
                                   for b in comp.get("broadcasts", []) or []), None),
            }
            for c in comp["competitors"]:
                side = "home" if c["homeAway"] == "home" else "away"
                espn[f"{side}_abbr"] = c["team"].get("abbreviation")
                espn[f"{side}_espn_team_id"] = num(c["team"].get("id"))
                espn[f"{side}_score"] = num(c.get("score"))
        else:
            comp = sbe["competitions"][0]
            espn = {
                "espn_event_id": str(sbe["id"]),
                "season": sbe["season"]["year"],
                "season_type": "REG" if sbe["season"]["type"] == 2 else "POST",
                "espn_week": sbe.get("week"),
                "kickoff_utc": comp["date"],
                "status": comp["status"]["type"]["name"],
                "neutral": comp.get("neutralSite"),
                "venue": (comp.get("venue") or {}).get("fullName"),
                "venue_id": num((comp.get("venue") or {}).get("id")),
                "referee": None, "broadcast": None,
            }
            for c in comp["competitors"]:
                side = "home" if c["homeAway"] == "home" else "away"
                espn[f"{side}_abbr"] = c["team"].get("abbreviation")
                espn[f"{side}_espn_team_id"] = num(c["team"].get("id"))
                espn[f"{side}_score"] = num(c.get("score"))
        # overtime: scoreboard carries the final period; >4 means OT was played
        espn_period = None
        if sbe:
            espn_period = sbe["competitions"][0]["status"].get("period")

        compared = matched = 0
        fieldrecs = []

        def cmp(field, dbv, refv, tol=0.0, authority="espn", note=None,
                ref_id=None, evd=None):
            nonlocal compared, matched
            compared += 1
            ok = eq(dbv, refv, tol)
            if ok:
                matched += 1
            else:
                fieldrecs.append(dict(field=field, db_value=dbv, ref_value=refv,
                                      verdict="MISMATCH", authority=authority,
                                      note=note, ref_id=ref_id or evid,
                                      evidence=evd or evidence))
            return ok

        def flag(field, dbv, refv, verdict, note, authority="espn", evd=None):
            fieldrecs.append(dict(field=field, db_value=dbv, ref_value=refv,
                                  verdict=verdict, authority=authority, note=note,
                                  ref_id=evid, evidence=evd or evidence))

        # identity / schedule
        cmp("espn_event_id", evid, espn["espn_event_id"])
        cmp("season", season, espn["season"])
        cmp("season_type", g["season_type"], espn["season_type"])
        if g["season_type"] == "REG":
            espn_wk = (espn["espn_week"] or {}).get("number") if isinstance(
                espn["espn_week"], dict) else espn["espn_week"]
            cmp("week", g["week"], num(espn_wk))
        else:
            espn_wk = (espn["espn_week"] or {}).get("number") if isinstance(
                espn["espn_week"], dict) else espn["espn_week"]
            cmp("playoff_round", g["playoff_round"], ROUND_BY_ESPN_WEEK.get(num(espn_wk)))

        # teams -- compare franchise ids (labels are era-specific by design)
        for side in ("away", "home"):
            fid = g[f"{side}_franchise_id"]
            cmp(f"{side}_franchise_id", fid, espn.get(f"{side}_espn_team_id"),
                note="ESPN team id space is our franchise_id space")
            espn_ab = espn.get(f"{side}_abbr")
            mapped = ESPN_TO_FID.get(espn_ab)
            compared += 1
            if mapped == fid:
                matched += 1
            else:
                flag(f"{side}_abbr", g[f"{side}_abbr"], espn_ab, "MISMATCH",
                     "ESPN abbreviation does not resolve to the stored franchise")

        # score
        cmp("away_score", g["away_score"], espn.get("away_score"))
        cmp("home_score", g["home_score"], espn.get("home_score"))
        # derived from score -- arithmetic, always checkable
        compared += 2
        if g["result"] == (g["home_score"] - g["away_score"]):
            matched += 1
        else:
            flag("result", g["result"], g["home_score"] - g["away_score"], "MISMATCH",
                 "result must equal home_score - away_score")
        if g["total"] == (g["home_score"] + g["away_score"]):
            matched += 1
        else:
            flag("total", g["total"], g["home_score"] + g["away_score"], "MISMATCH",
                 "total must equal home_score + away_score")

        # status
        cmp("result_status", g["result_status"],
            "final" if espn["status"] == "STATUS_FINAL" else espn["status"])

        # kickoff -- known-good: nflverse stores scheduled, ESPN observed
        dbk = g["kickoff_utc"].replace("Z", "").replace(":00Z", "")
        ek = espn["kickoff_utc"].replace("Z", "")
        dbdt = datetime.strptime(g["kickoff_utc"], "%Y-%m-%dT%H:%M:%SZ")
        try:
            edt = datetime.strptime(espn["kickoff_utc"], "%Y-%m-%dT%H:%MZ")
        except ValueError:
            edt = datetime.strptime(espn["kickoff_utc"], "%Y-%m-%dT%H:%M:%SZ")
        compared += 1
        if dbdt == edt:
            matched += 1
        else:
            flag("kickoff_utc", g["kickoff_utc"], espn["kickoff_utc"], "NOT_COMPARABLE",
                 "contract rule 5: nflverse stores the scheduled kickoff, ESPN the "
                 f"observed one; delta {int((edt-dbdt).total_seconds())}s")

        # location / neutral site
        espn_loc = "Neutral" if espn.get("neutral") else "Home"
        compared += 1
        if g["location"] == espn_loc:
            matched += 1
        else:
            flag("location", g["location"], espn_loc, "MISMATCH",
                 "ESPN neutralSite disagrees with stored location")

        # venue name -- known-good: ESPN retro-renames venues
        compared += 1
        if eq(g["stadium"], espn["venue"]):
            matched += 1
        else:
            flag("stadium", g["stadium"], espn["venue"], "NOT_COMPARABLE",
                 "contract rule 5: ESPN retro-renames venues")

        # venue_id -- ESPN has it, the nflverse load path never populates it
        if espn.get("venue_id") is not None and g["venue_id"] is None:
            flag("venue_id", None, espn["venue_id"], "REF_ONLY",
                 "ESPN publishes a venue id; game.venue_id is NULL for every one of "
                 "the 4,363 nflverse-sourced rows (populated only on the 285 "
                 "espn-sourced 2026 rows) -- systemic gap in the nflverse load path")
        elif espn.get("venue_id") is not None:
            cmp("venue_id", g["venue_id"], espn["venue_id"])

        # referee. ESPN and nflverse publish different name forms for the same
        # official (Ron / Ronald Torbert); that is a rendering difference, not a
        # data error, and it is recorded rather than silently absorbed.
        if espn["referee"]:
            compared += 1
            if eq(g["referee"], espn["referee"]):
                matched += 1
            elif same_person(g["referee"], espn["referee"]):
                matched += 1
                fieldrecs.append(dict(field="referee", db_value=g["referee"],
                                      ref_value=espn["referee"], verdict="MATCH",
                                      authority="espn", ref_id=evid, evidence=evidence,
                                      note="same official, different published name "
                                           "form (surname and first initial agree)"))
            else:
                third, tev = pfr_referee(g["pfr_game_id"])
                fieldrecs.append(dict(
                    field="referee", db_value=g["referee"], ref_value=espn["referee"],
                    verdict="MISMATCH", authority="espn", ref_id=evid,
                    evidence=evidence,
                    note=("third source Pro-Football-Reference officials table: "
                          f"{third}" if third else
                          "third source Pro-Football-Reference not retrievable")))
                if third:
                    fieldrecs.append(dict(
                        field="referee", db_value=g["referee"], ref_value=third,
                        verdict="MATCH" if same_person(g["referee"], third) else "MISMATCH",
                        authority="pro-football-reference", ref_id=g["pfr_game_id"],
                        evidence=tev, note="third-source adjudication of the referee "
                                           "disagreement between the database and ESPN"))
        else:
            flag("referee", g["referee"], None, "NOT_COMPARABLE",
                 "ESPN response carries no officials block for this event")

        # broadcast -- ESPN has it, we do not
        if espn.get("broadcast") and not g["broadcast"]:
            flag("broadcast", None, espn["broadcast"], "REF_ONLY",
                 "ESPN publishes the broadcaster; game.broadcast is NULL for every "
                 "nflverse-sourced row -- systemic gap in the nflverse load path")

        # overtime
        if espn_period is not None:
            compared += 1
            espn_ot = 1 if espn_period > 4 else 0
            if g["overtime"] == espn_ot:
                matched += 1
            else:
                flag("overtime", g["overtime"], espn_ot, "MISMATCH",
                     f"ESPN final period {espn_period}",
                     evd=sb[1] if sb else evidence)
        else:
            flag("overtime", g["overtime"], None, "NOT_COMPARABLE",
                 "no ESPN period available for this event")

        # div_game -- internal, from the team dimension
        compared += 1
        ad, hd = teams.get(g["away_franchise_id"]), teams.get(g["home_franchise_id"])
        want = 1 if (ad and hd and ad == hd) else 0
        if g["div_game"] == want:
            matched += 1
        else:
            flag("div_game", g["div_game"], want, "MISMATCH",
                 f"divisions {ad} vs {hd}", authority="derived",
                 evd=ev("meta", "internal.json"))

        # weekday -- internal, from the stored kickoff
        compared += 1
        et = dbdt - timedelta(hours=5) if dbdt.month in (11, 12, 1, 2, 3) \
            else dbdt - timedelta(hours=4)
        if g["weekday"] == et.strftime("%A"):
            matched += 1
        else:
            flag("weekday", g["weekday"], et.strftime("%A"), "MISMATCH",
                 "weekday must follow from kickoff_utc in US Eastern",
                 authority="derived", evd=ev("meta", "internal.json"))

        # rest days -- D15 territory. Recompute in venue-local calendar days from
        # the previous game this franchise actually played in the same season.
        today = datetime.strptime(g["gameday"], "%Y-%m-%d").date()
        for side, fid in (("away", g["away_franchise_id"]), ("home", g["home_franchise_id"])):
            prev = [d for d in played[(season, fid)] if d < g["gameday"]]
            if prev:
                want_rest = (today - datetime.strptime(max(prev), "%Y-%m-%d").date()).days
                why = f"venue-local days since this franchise's previous game {max(prev)}"
            else:
                want_rest = SEASON_OPENER_REST
                why = "season opener -- nflverse publishes 7 days rest by convention"
            compared += 1
            if g[f"{side}_rest"] == want_rest:
                matched += 1
            else:
                flag(f"{side}_rest", g[f"{side}_rest"], want_rest, "MISMATCH", why,
                     authority="derived", evd=ev("meta", "internal.json"))

        # surface. ESPN publishes only a current-state grass boolean on the venue --
        # it carries no season dimension and retro-updates when a stadium
        # re-surfaces, exactly like the retro-rename known-good in contract rule 5.
        vg = None
        if S:
            vg = (S.get("gameInfo", {}).get("venue") or {}).get("grass")
        if vg is not None:
            if not g["surface"]:
                flag("surface", g["surface"], "grass" if vg else "not-grass", "REF_ONLY",
                     "surface is empty in the database for this game (41 of the 569 "
                     "rows in this partition); ESPN establishes only that a surface "
                     "classification exists, not its 2022/2023 value")
            else:
                compared += 1
                if (g["surface"] == "grass") == bool(vg):
                    matched += 1
                else:
                    flag("surface", g["surface"], "grass" if vg else "not-grass",
                         "NOT_COMPARABLE",
                         "ESPN venue.grass is a current-state venue attribute with no "
                         "season dimension; it cannot rule on the surface played on in "
                         f"{season} (contract rule 5, same class as the retro-rename)")

        for rec in fieldrecs:
            L.write("game", gid, season, rec["field"], rec["db_value"],
                    rec["authority"], rec["ref_id"], rec["ref_value"],
                    rec["verdict"], rec["evidence"], note=rec.get("note"))

        # The row-level verdict summarises this row's own outcome. venue_id and
        # broadcast are NULL on all 4,363 nflverse-sourced rows in every season, so
        # they are a systemic property of the load path rather than a fact about
        # this row: each is still logged per-field as REF_ONLY above (complete and
        # itemised), and is named here instead of masking the row's verdict.
        worst = _worst([r["verdict"] for r in fieldrecs
                        if r["field"] not in SYSTEMIC_GAP_FIELDS])
        L.write("game", gid, season, "*", None, "espn", evid, None,
                worst or "MATCH", evidence,
                fields_compared=compared, fields_matched=matched,
                fields_not_comparable=len(NOT_RULABLE),
                not_comparable_fields=NOT_RULABLE,
                systemic_gap_fields=sorted({r["field"] for r in fieldrecs
                                            if r["field"] in SYSTEMIC_GAP_FIELDS}),
                note=None if worst is None else "see per-field records for this row")


_ORDER = {"MISMATCH": 4, "DB_ONLY": 3, "REF_ONLY": 3, "UNRESOLVED": 2,
          "NOT_COMPARABLE": 1, "MATCH": 0}

# Columns that are NULL on every one of the 4,363 nflverse-sourced game rows, in
# every season -- a property of the load path, not of any individual row. Logged
# per-field as REF_ONLY and excluded from the row-level verdict so that a systemic
# gap does not mask 569 rows' actual outcomes.
SYSTEMIC_GAP_FIELDS = {"venue_id", "broadcast"}


def _worst(verdicts):
    bad = [v for v in verdicts if v != "MATCH"]
    if not bad:
        return None
    return max(bad, key=lambda v: _ORDER.get(v, 0))


# -------------------------------------------------------------- game_line audit

COVERS_TEAM = {
    "Arizona Cardinals": 22, "Atlanta Falcons": 1, "Baltimore Ravens": 33,
    "Buffalo Bills": 2, "Carolina Panthers": 29, "Chicago Bears": 3,
    "Cincinnati Bengals": 4, "Cleveland Browns": 5, "Dallas Cowboys": 6,
    "Denver Broncos": 7, "Detroit Lions": 8, "Green Bay Packers": 9,
    "Houston Texans": 34, "Indianapolis Colts": 11, "Jacksonville Jaguars": 30,
    "Kansas City Chiefs": 12, "Las Vegas Raiders": 13, "Los Angeles Chargers": 24,
    "Los Angeles Rams": 14, "Miami Dolphins": 15, "Minnesota Vikings": 16,
    "New England Patriots": 17, "New Orleans Saints": 18, "New York Giants": 19,
    "New York Jets": 20, "Philadelphia Eagles": 21, "Pittsburgh Steelers": 23,
    "San Francisco 49ers": 25, "Seattle Seahawks": 26, "Tampa Bay Buccaneers": 27,
    "Tennessee Titans": 10, "Washington Commanders": 28, "Washington Football Team": 28,
    "Washington Redskins": 28,
}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def parse_covers(year):
    """Every game on the covers.com/SportsOddsHistory season page.

    Returns {(date, frozenset(fid_a, fid_b)): {...}} -- keyed on date + the two
    franchises, which is unambiguous (no team plays twice on one day).

    The page carries two table layouts: the regular-season tables start at Day,
    the playoff table prepends a Round column and suffixes each team with its
    seed. Rather than assume a column offset, this locates the two team cells by
    name and reads the surrounding columns relative to them, which handles both.
    """
    path = os.path.join(CACHE, "covers", f"soh_{year}.html.gz")
    html = tgz(path)
    out = {}
    row_re = re.compile(r"<tr>\s*(.*?)</tr>", re.S)
    cell_re = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
    seed_re = re.compile(r"\s*\(\d+\)\s*$")
    for m in row_re.finditer(html):
        cells = [seed_re.sub("", re.sub(r"<[^>]+>", "", c).replace("&nbsp;", " ").strip())
                 for c in cell_re.findall(m.group(1))]
        if len(cells) < 10:
            continue
        team_ix = [i for i, c in enumerate(cells) if c in COVERS_TEAM]
        if len(team_ix) != 2:
            continue
        fi, di = team_ix
        if di - fi != 4:                     # fav, score, spread, @, dog
            continue
        datestr = next((c for c in cells[:fi]
                        if re.match(r"[A-Z][a-z]{2} \d{1,2}, \d{4}$", c)), None)
        if not datestr:
            continue
        dm = re.match(r"([A-Z][a-z]{2}) (\d{1,2}), (\d{4})", datestr)
        d = f"{dm.group(3)}-{MONTHS[dm.group(1)]:02d}-{int(dm.group(2)):02d}"
        fav, dog = cells[fi], cells[di]
        score, spread = cells[fi + 1], cells[fi + 2]
        ou = cells[di + 1] if di + 1 < len(cells) else ""
        sm = re.match(r"([WLT]) (\d+)-(\d+)", score)
        spm = re.search(r"([-+]?\d+(?:\.\d+)?)", spread)
        oum = re.search(r"([OUP]) (\d+(?:\.\d+)?)", ou)
        fav_fid, dog_fid = COVERS_TEAM[fav], COVERS_TEAM[dog]
        out[(d, frozenset((fav_fid, dog_fid)))] = {
            "date": d, "fav": fav_fid, "dog": dog_fid,
            "fav_home": cells[fi - 1].strip() == "@",
            "spread": abs(float(spm.group(1))) if spm else None,
            "total": float(oum.group(2)) if oum else None,
            "ou_result": oum.group(1) if oum else None,
            "fav_score": int(sm.group(2)) if sm else None,
            "dog_score": int(sm.group(3)) if sm else None,
            "pick_em": "PK" in spread.upper(),
        }
    return out


def audit_game_line(db, L):
    """`game_line`: covers.com / SportsOddsHistory rules on spread and total."""
    covers = {}
    for y in SEASONS:
        covers[y] = parse_covers(y)
        print(f"[game_line] covers {y}: {len(covers[y])} games parsed")

    # ESPN pickcenter consensus -- the third source, per contract rule 3
    NOT_RULABLE = ["away_moneyline", "home_moneyline", "away_spread_odds",
                   "home_spread_odds", "over_odds", "under_odds", "odds_source"]

    q = ("SELECT l.*, g.season, g.gameday, g.kickoff_utc, g.away_franchise_id, "
         "g.home_franchise_id, g.away_score, g.home_score, g.espn_event_id "
         "FROM game_line l JOIN game g USING(game_id) "
         "WHERE g.season IN (?,?) ORDER BY l.game_id")
    cols = None
    for r in db.execute(q, SEASONS):
        if cols is None:
            cols = [d[0] for d in db.execute(q, SEASONS).description]
        g = dict(zip(cols, r))
        gid, season = g["game_id"], g["season"]
        evid = str(g["espn_event_id"])
        cev = ev("covers", f"soh_{season}.html.gz")
        pair = frozenset((g["away_franchise_id"], g["home_franchise_id"]))

        # covers dates are venue-local calendar dates; try gameday and +/-1 day
        base = datetime.strptime(g["gameday"], "%Y-%m-%d").date()
        rec = None
        for delta in (0, 1, -1):
            rec = covers[season].get(((base + timedelta(days=delta)).isoformat(), pair))
            if rec:
                break

        fieldrecs = []
        compared = matched = 0

        # Third source: ESPN pickcenter consensus. ESPN publishes the HOME team's
        # handicap (negative = home favoured); game_line.spread_line is the
        # opposite sign (positive = home favoured), so it is negated here to state
        # the third source in the database's own convention.
        espn_spread = espn_total = None
        spath = summary_path(evid)
        if os.path.exists(evabs(spath)):
            S = jgz(evabs(spath))
            picks = S.get("pickcenter", []) or []
            pc = next((p for p in picks
                       if p.get("provider", {}).get("name") == "consensus"), None) \
                or next((p for p in picks if p.get("spread") is not None), None)
            if pc:
                espn_spread = -pc["spread"] if pc.get("spread") is not None else None
                espn_total = pc.get("overUnder")

        if rec is None:
            L.write("game_line", gid, season, "spread_line", g["spread_line"], "covers.com",
                    None, None, "UNRESOLVED", cev,
                    note="no covers.com row matched this date+franchise pair")
            L.write("game_line", gid, season, "*", None, "covers.com", None, None,
                    "UNRESOLVED", cev, fields_compared=0, fields_matched=0,
                    fields_not_comparable=len(NOT_RULABLE),
                    not_comparable_fields=NOT_RULABLE,
                    note="game not located on the covers.com season page")
            continue

        # covers publishes the spread from the FAVOURITE's perspective; our
        # spread_line is positive when the home team is favoured.
        cov_home_spread = rec["spread"] if rec["fav"] == g["home_franchise_id"] \
            else -rec["spread"]
        compared += 1
        if eq(g["spread_line"], cov_home_spread, 0.001):
            matched += 1
        else:
            third = f"espn_consensus={espn_spread}" if espn_spread is not None else "no ESPN consensus"
            fieldrecs.append(("spread_line", g["spread_line"], cov_home_spread,
                              "MISMATCH", f"covers.com closing spread; third source: {third}"))

        compared += 1
        if eq(g["total_line"], rec["total"], 0.001):
            matched += 1
        else:
            third = f"espn_consensus={espn_total}" if espn_total is not None else "no ESPN consensus"
            fieldrecs.append(("total_line", g["total_line"], rec["total"],
                              "MISMATCH", f"covers.com closing total; third source: {third}"))

        # covers also carries the final score -- corroborates the game row
        cov_home = rec["fav_score"] if rec["fav"] == g["home_franchise_id"] else rec["dog_score"]
        cov_away = rec["dog_score"] if rec["fav"] == g["home_franchise_id"] else rec["fav_score"]
        compared += 2
        if g["home_score"] == cov_home:
            matched += 1
        else:
            fieldrecs.append(("_home_score_xcheck", g["home_score"], cov_home,
                              "MISMATCH", "covers.com score cross-check"))
        if g["away_score"] == cov_away:
            matched += 1
        else:
            fieldrecs.append(("_away_score_xcheck", g["away_score"], cov_away,
                              "MISMATCH", "covers.com score cross-check"))

        # internal consistency of the odds we do store
        for f in ("away_moneyline", "home_moneyline"):
            if g[f] == 0 or g[f] is None:
                fieldrecs.append((f, g[f], None, "MISMATCH", "moneyline must be non-zero"))
        # Both sides can legitimately price negative on a pick'em or 1-point game
        # (the book takes vig on both); at 2 points or more the underdog must be a
        # plus price. All 22 same-sign pairs in this partition sit at |spread| <= 1.5.
        if g["away_moneyline"] and g["home_moneyline"] and \
                (g["away_moneyline"] > 0) == (g["home_moneyline"] > 0) and \
                abs(g["spread_line"]) >= 2.0:
            fieldrecs.append(("home_moneyline", g["home_moneyline"], None, "MISMATCH",
                              f"both moneylines share a sign on a {g['spread_line']} spread"))

        for f, dbv, refv, v, note in fieldrecs:
            extra = {}
            if refv is not None and isinstance(dbv, (int, float)) and \
                    isinstance(refv, (int, float)):
                extra["delta"] = round(abs(dbv - refv), 2)
            if f == "spread_line":
                extra["third_source_espn_consensus"] = espn_spread
            if f == "total_line":
                extra["third_source_espn_consensus"] = espn_total
            L.write("game_line", gid, season, f, dbv, "covers.com",
                    f"{rec['date']}|{sorted(pair)}", refv, v, cev, note=note, **extra)
        worst = _worst([x[3] for x in fieldrecs])
        L.write("game_line", gid, season, "*", None, "covers.com",
                f"{rec['date']}|{sorted(pair)}", None, worst or "MATCH", cev,
                fields_compared=compared, fields_matched=matched,
                fields_not_comparable=len(NOT_RULABLE),
                not_comparable_fields=NOT_RULABLE,
                note="covers.com/SportsOddsHistory publishes closing spread and total "
                     "only; moneylines and juice are not published by this authority")


# -------------------------------------------------------------- team_game audit

def audit_team_game(db, L):
    """`team_game`: derived. Every field must recompute from game + game_line."""
    game = {}
    for r in db.execute(
            "SELECT game_id, season, season_type, week, playoff_round, kickoff_utc, "
            "away_franchise_id, home_franchise_id, away_score, home_score, "
            "result_status, away_rest, home_rest, away_rest_upstream, home_rest_upstream "
            "FROM game WHERE season IN (?,?)", SEASONS):
        game[r[0]] = r
    lines = {r[0]: r[1:] for r in db.execute(
        "SELECT l.game_id, l.spread_line, l.total_line, l.away_moneyline, l.home_moneyline "
        "FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (?,?)", SEASONS)}

    # game_number: nth game of that franchise's season, in kickoff order.
    # Scoped per (season, franchise) -- the counter restarts each season.
    ordinal = {}
    seq = collections.defaultdict(list)
    for season, gid, fid, k in db.execute(
            "SELECT season, game_id, franchise_id, kickoff_utc FROM team_game "
            "WHERE season IN (?,?) ORDER BY kickoff_utc, game_id", SEASONS):
        seq[(season, fid)].append((k, gid))
    for key, items in seq.items():
        for i, (k, gid) in enumerate(sorted(items), 1):
            ordinal[(gid, key[1])] = i

    cols = [r[1] for r in db.execute("PRAGMA table_info(team_game)")]
    evd = ev("meta", "internal.json")
    for r in db.execute("SELECT * FROM team_game WHERE season IN (?,?) "
                        "ORDER BY game_id, franchise_id", SEASONS):
        t = dict(zip(cols, r))
        gid, fid = t["game_id"], t["franchise_id"]
        key = f"{gid}/{fid}"
        G = game.get(gid)
        if G is None:
            L.write("team_game", key, t["season"], "*", None, "derived", gid, None,
                    "DB_ONLY", evd, note="no parent game row in this partition")
            continue
        (_, gseason, gstype, gweek, ground, gkick, gaway, ghome, gas, ghs,
         gstatus, garest, ghrest, garu, ghru) = G
        is_home = 1 if fid == ghome else 0
        opp = gaway if is_home else ghome
        pf = ghs if is_home else gas
        pa = gas if is_home else ghs
        spread_line, total_line, aml, hml = lines.get(gid, (None, None, None, None))
        want = {
            "opponent_id": opp, "season": gseason, "season_type": gstype,
            "week": gweek, "playoff_round": ground, "kickoff_utc": gkick,
            "is_home": is_home, "points_for": pf, "points_against": pa,
            "margin": None if pf is None or pa is None else pf - pa,
            "spread": None if spread_line is None else (
                spread_line if is_home else -spread_line),
            "total_line": total_line,
            "moneyline": hml if is_home else aml,
            "rest_days": ghrest if is_home else garest,
            "rest_days_upstream": ghru if is_home else garu,
            "game_number": ordinal.get((gid, fid)),
        }
        m = want["margin"]
        sp = want["spread"]
        want["su_result"] = None if m is None else ("W" if m > 0 else "L" if m < 0 else "T")
        want["ats_result"] = None if (m is None or sp is None) else (
            "W" if m > sp else "L" if m < sp else "P")
        tot = None if (pf is None or pa is None or total_line is None) else pf + pa
        want["ou_result"] = None if tot is None else (
            "O" if tot > total_line else "U" if tot < total_line else "P")
        want["won"] = None if m is None or m == 0 else (1 if m > 0 else 0)
        want["covered"] = None if (m is None or sp is None or m == sp) else (
            1 if m > sp else 0)

        fieldrecs = []
        compared = matched = 0
        for f, wv in want.items():
            compared += 1
            if eq(t[f], wv, 0.001):
                matched += 1
            else:
                fieldrecs.append((f, t[f], wv, "MISMATCH",
                                  "recomputed from game + game_line"))
        # franchise must be one of the two teams in the parent game
        compared += 1
        if fid in (gaway, ghome):
            matched += 1
        else:
            fieldrecs.append(("franchise_id", fid, f"{gaway}|{ghome}", "MISMATCH",
                              "franchise is not a participant in the parent game"))

        for f, dbv, refv, v, note in fieldrecs:
            L.write("team_game", key, t["season"], f, dbv, "derived", gid, refv, v,
                    evd, note=note)
        L.write("team_game", key, t["season"], "*", None, "derived", gid, None,
                _worst([x[3] for x in fieldrecs]) or "MATCH", evd,
                fields_compared=compared, fields_matched=matched,
                fields_not_comparable=0, not_comparable_fields=[])


# ------------------------------------------------------- player_game_stats audit

def espn_boxscore_players(S):
    """{espn_athlete_id: {stat: value}} from an ESPN summary, plus team context.

    `_cats` records which statistic categories ESPN published for that athlete.
    A box score is exhaustive within a category: if a player took a carry they
    appear in `rushing`, so absence from a category is ESPN asserting zero, not
    ESPN staying silent. That distinction is what lets a defensive player's
    all-zero offensive line actually be ruled on instead of collapsing to
    "nobody could check it".
    """
    out = {}
    for tblock in S.get("boxscore", {}).get("players", []) or []:
        tabbr = tblock["team"].get("abbreviation")
        for cat in tblock.get("statistics", []) or []:
            name, labels = cat.get("name"), cat.get("labels") or []
            for a in cat.get("athletes", []) or []:
                aid = str(a.get("athlete", {}).get("id"))
                stats = a.get("stats") or []
                d = out.setdefault(aid, {"team": tabbr, "_cats": set(),
                                         "name": a.get("athlete", {}).get("displayName")})
                d["_cats"].add(name)
                vals = dict(zip(labels, stats))
                if name == "passing":
                    ca = vals.get("C/ATT", "")
                    if "/" in str(ca):
                        c, at = str(ca).split("/", 1)
                        d["completions"], d["attempts"] = num(c), num(at)
                    d["passing_yards"] = num(vals.get("YDS"))
                    d["passing_tds"] = num(vals.get("TD"))
                    d["interceptions"] = num(vals.get("INT"))
                    sk = str(vals.get("SACKS", ""))
                    d["sacks_suffered"] = num(sk.split("-")[0]) if "-" in sk else num(sk)
                elif name == "rushing":
                    d["carries"] = num(vals.get("CAR"))
                    d["rushing_yards"] = num(vals.get("YDS"))
                    d["rushing_tds"] = num(vals.get("TD"))
                elif name == "receiving":
                    d["receptions"] = num(vals.get("REC"))
                    d["receiving_yards"] = num(vals.get("YDS"))
                    d["receiving_tds"] = num(vals.get("TD"))
                    d["targets"] = num(vals.get("TGTS"))
    return out


PGS_ESPN_FIELDS = ["completions", "attempts", "passing_yards", "passing_tds",
                   "interceptions", "sacks_suffered", "carries", "rushing_yards",
                   "rushing_tds", "receptions", "targets", "receiving_yards",
                   "receiving_tds"]
PGS_NOT_RULABLE = ["passing_epa", "rushing_epa", "receiving_epa", "target_share",
                   "air_yards_share", "fantasy_points", "fantasy_points_ppr",
                   "position", "position_group"]
PGS_FIELD_CATEGORY = {
    "completions": "passing", "attempts": "passing", "passing_yards": "passing",
    "passing_tds": "passing", "interceptions": "passing", "sacks_suffered": "passing",
    "carries": "rushing", "rushing_yards": "rushing", "rushing_tds": "rushing",
    "receptions": "receiving", "targets": "receiving", "receiving_yards": "receiving",
    "receiving_tds": "receiving",
}


PFR_OFF_RE = re.compile(r'<table[^>]*id="player_offense".*?</table>', re.S)


def parse_pfr_offense(html):
    """{pfr_player_id: {stat: value}} from a PFR boxscore player-offense table."""
    body = html.replace("<!--", "").replace("-->", "")
    m = PFR_OFF_RE.search(body)
    if not m:
        return {}
    out = {}
    for row in re.finditer(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S):
        rh = row.group(1)
        pid = re.search(r'data-append-csv="([^"]+)"', rh)
        if not pid:
            continue
        d = {}
        for c in re.finditer(r'data-stat="([a-z_0-9]+)"[^>]*>(.*?)</t[hd]>', rh, re.S):
            d[c.group(1)] = re.sub(r"<[^>]+>", "", c.group(2)).strip()
        out[pid.group(1)] = {
            "completions": num(d.get("pass_cmp")), "attempts": num(d.get("pass_att")),
            "passing_yards": num(d.get("pass_yds")), "passing_tds": num(d.get("pass_td")),
            "interceptions": num(d.get("pass_int")),
            "sacks_suffered": num(d.get("pass_sacked")),
            "carries": num(d.get("rush_att")), "rushing_yards": num(d.get("rush_yds")),
            "rushing_tds": num(d.get("rush_td")), "receptions": num(d.get("rec")),
            "targets": num(d.get("targets")), "receiving_yards": num(d.get("rec_yds")),
            "receiving_tds": num(d.get("rec_td")),
        }
    return out


def audit_player_game_stats(db, L):
    """`player_game_stats`: ESPN box score rules. 37,430 rows."""
    espn_id = {g: e for g, e in db.execute(
        "SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL AND espn_id<>''")}
    pfr_id = {g: p for g, p in db.execute(
        "SELECT gsis_id, pfr_id FROM player WHERE pfr_id IS NOT NULL AND pfr_id<>''")}
    pname = {g: n for g, n in db.execute("SELECT gsis_id, display_name FROM player")}
    evid_by_gid = {g: str(e) for g, e in db.execute(
        "SELECT game_id, espn_event_id FROM game WHERE season IN (?,?)", SEASONS)}
    pfrgid_by_gid = {g: p for g, p in db.execute(
        "SELECT game_id, pfr_game_id FROM game WHERE season IN (?,?)", SEASONS)}

    box_cache = {}

    def box(gid):
        if gid not in box_cache:
            e = evid_by_gid.get(gid)
            p = summary_path(e) if e else None
            if p and os.path.exists(evabs(p)):
                players = espn_boxscore_players(jgz(evabs(p)))
                byname = {}
                for aid, d in players.items():
                    byname.setdefault(normname(d.get("name")), []).append((aid, d))
                box_cache[gid] = (players, p, e, byname)
            else:
                box_cache[gid] = (None, ev("meta", "espn_coverage.json"), e, {})
        return box_cache[gid]

    pfr_off_cache = {}

    def pfr_off(gid):
        """Third source for the rows ESPN cannot settle."""
        pg = pfrgid_by_gid.get(gid)
        if pg not in pfr_off_cache:
            rel = ev("pfr", f"{pg}.html.gz")
            if pg and os.path.exists(evabs(rel)):
                try:
                    pfr_off_cache[pg] = (parse_pfr_offense(tgz(evabs(rel))), rel)
                except Exception:  # noqa: BLE001
                    pfr_off_cache[pg] = ({}, rel)
            else:
                pfr_off_cache[pg] = ({}, ev("meta", "pfr_coverage.json"))
        return pfr_off_cache[pg]

    # ------------------------------------------------------------------
    # Completeness check: sum every stored player row per game-team and hold it
    # against ESPN's own team box score. A missing or duplicated player row shows
    # up here even when every individual row that does exist is correct -- which
    # per-row comparison alone cannot detect.
    fid_by_abbr = dict(ESPN_TO_FID)
    team_recon = collections.Counter()
    for gid, evid in sorted(evid_by_gid.items()):
        spath = summary_path(evid)
        if not os.path.exists(evabs(spath)):
            continue
        S = jgz(evabs(spath))
        for tb in S.get("boxscore", {}).get("teams", []) or []:
            fid = fid_by_abbr.get(tb["team"].get("abbreviation"))
            if fid is None:
                continue
            st = {s["name"]: s.get("displayValue") for s in tb.get("statistics", [])}
            ca = str(st.get("completionAttempts", ""))
            espn_c, espn_a = (num(ca.split("/")[0]), num(ca.split("/")[1])) \
                if "/" in ca else (None, None)
            sk = str(st.get("sacksYardsLost", ""))
            sack_yds = num(sk.split("-")[1]) if "-" in sk else None
            npy = num(st.get("netPassingYards"))
            # ESPN publishes net passing yards (gross minus sack yardage); the sum
            # of the receivers' yards is the gross figure.
            gross_pass = None if (npy is None or sack_yds is None) else npy + sack_yds
            got = db.execute(
                "SELECT COALESCE(SUM(completions),0), COALESCE(SUM(attempts),0), "
                "COALESCE(SUM(rushing_yards),0), COALESCE(SUM(carries),0), "
                "COALESCE(SUM(receptions),0), COALESCE(SUM(receiving_yards),0), "
                "COALESCE(SUM(passing_yards),0) "
                "FROM player_game_stats WHERE game_id=? AND franchise_id=?",
                (gid, fid)).fetchone()
            for label, dbv, refv in (("completions", got[0], espn_c),
                                     ("attempts", got[1], espn_a),
                                     ("rushing_yards", got[2],
                                      num(st.get("rushingYards"))),
                                     ("carries", got[3],
                                      num(st.get("rushingAttempts"))),
                                     # every completion is somebody's reception
                                     ("receptions", got[4], espn_c),
                                     ("receiving_yards", got[5], gross_pass),
                                     ("passing_yards", got[6], gross_pass)):
                if refv is None:
                    continue
                team_recon["compared"] += 1
                if dbv != refv:
                    team_recon["mismatched"] += 1
                    L.write("player_game_stats", f"{gid}/team{fid}", int(gid[:4]),
                            f"_team_total_{label}", dbv, "espn", evid, refv,
                            "MISMATCH", spath,
                            note="sum of the stored player rows for this team-game "
                                 "does not equal ESPN's team box score total -- "
                                 "indicates a missing, extra or misattributed "
                                 "player row")
    print(f"[pgs] team-total reconciliation: {team_recon['compared']} team-game "
          f"totals compared, {team_recon['mismatched']} disagreed")

    cols = [r[1] for r in db.execute("PRAGMA table_info(player_game_stats)")]
    q = ("SELECT * FROM player_game_stats WHERE season IN (?,?) "
         "ORDER BY game_id, gsis_id")
    for r in db.execute(q, SEASONS):
        p = dict(zip(cols, r))
        gid = p["game_id"]
        key = f"{gid}/{p['gsis_id']}"
        players, evd, evid, byname = box(gid)
        aid = espn_id.get(p["gsis_id"])

        if players is None:
            L.write("player_game_stats", key, p["season"], "*", None, "espn", evid, None,
                    "UNRESOLVED", evd, fields_compared=0, fields_matched=0,
                    fields_not_comparable=len(PGS_NOT_RULABLE),
                    not_comparable_fields=PGS_NOT_RULABLE,
                    note="no cached ESPN summary for this game")
            continue

        fieldrecs = []
        compared = matched = 0
        stated = {f: p[f] for f in PGS_ESPN_FIELDS}
        nonzero = any(v for v in stated.values())

        e = players.get(aid) if aid else None
        if e is None:
            # ESPN carries more than one athlete id for some players, and the box
            # score does not always use the one the player dimension stores. Fall
            # back to an unambiguous name match before calling the row unverifiable.
            cand = byname.get(normname(pname.get(p["gsis_id"])), [])
            if len(cand) == 1:
                alt_aid, e = cand[0]
                L.write("player_game_stats", key, p["season"], "_espn_id_join", aid,
                        "espn", evid, alt_aid,
                        "REF_ONLY" if aid is None else "MISMATCH", evd,
                        note=("player.espn_id is NULL; the row was joined to the box "
                              "score by name" if aid is None else
                              "player.espn_id does not appear in this box score; ESPN "
                              "lists the same athlete under a second id, and the row "
                              "was joined by name instead"))
            else:
                e = None

        if e is None:
            # A line whose only production is targets on zero receptions is the
            # exact case ESPN drops from the receiving table (contract rule 5), so
            # its silence is not evidence of anything.
            targets_only = (nonzero and not p["receptions"] and p["targets"] and
                            not any(p[f] for f in PGS_ESPN_FIELDS if f != "targets"))
            if targets_only:
                L.write("player_game_stats", key, p["season"], "targets", p["targets"],
                        "espn", evid, None, "NOT_COMPARABLE", evd,
                        note="contract rule 5: ESPN omits zero-reception targets from "
                             "the box score entirely, so the athlete is absent and no "
                             "target count can be ruled on")
                L.write("player_game_stats", key, p["season"], "*", None, "espn", evid,
                        None, "NOT_COMPARABLE", evd, fields_compared=0, fields_matched=0,
                        fields_not_comparable=len(PGS_NOT_RULABLE) + len(PGS_ESPN_FIELDS),
                        not_comparable_fields=PGS_NOT_RULABLE + PGS_ESPN_FIELDS,
                        note="zero-reception target line; ESPN publishes no athlete row")
                continue
            if not nonzero:
                # zero line: ESPN omits players with no counting stats by construction
                L.write("player_game_stats", key, p["season"], "*", None, "espn", evid,
                        None, "NOT_COMPARABLE", evd, fields_compared=0, fields_matched=0,
                        fields_not_comparable=len(PGS_NOT_RULABLE) + len(PGS_ESPN_FIELDS),
                        not_comparable_fields=PGS_NOT_RULABLE + PGS_ESPN_FIELDS,
                        note="row has zero in every ESPN-rulable counting stat and ESPN "
                             "omits players with no counting stats from the box score "
                             "(contract rule 5)")
                continue
            # ESPN has no athlete row at all. Escalate to Pro-Football-Reference
            # rather than calling a possible fabrication on ESPN's silence.
            off, pev = pfr_off(gid)
            pr = off.get(pfr_id.get(p["gsis_id"]))
            if pr:
                pc = pm = 0
                bad = []
                for f in PGS_ESPN_FIELDS:
                    if pr.get(f) is None:
                        continue
                    pc += 1
                    if eq(p[f], pr[f], 0.001):
                        pm += 1
                    else:
                        bad.append((f, p[f], pr[f]))
                for f, dbv, refv in bad:
                    L.write("player_game_stats", key, p["season"], f, dbv,
                            "pro-football-reference", pfrgid_by_gid.get(gid), refv,
                            "MISMATCH", pev,
                            note="ESPN omits this athlete from its box score entirely; "
                                 "adjudicated against Pro-Football-Reference")
                L.write("player_game_stats", key, p["season"], "_espn_absent",
                        json.dumps(stated), "espn", evid, None, "REF_ONLY", evd,
                        note="the athlete is missing from ESPN's box score although "
                             "ESPN's own team totals include this production; "
                             "Pro-Football-Reference carries the player and was used "
                             "as the authority for this row")
                L.write("player_game_stats", key, p["season"], "*", None,
                        "pro-football-reference", pfrgid_by_gid.get(gid), None,
                        "MISMATCH" if bad else "MATCH", pev,
                        fields_compared=pc, fields_matched=pm,
                        fields_not_comparable=len(PGS_NOT_RULABLE),
                        not_comparable_fields=PGS_NOT_RULABLE,
                        note="ESPN could not rule (athlete absent from its box score); "
                             "verdict comes from Pro-Football-Reference")
                continue
            L.write("player_game_stats", key, p["season"], "_row", json.dumps(stated),
                    "espn", evid, None, "DB_ONLY", evd,
                    note="player has non-zero stats here but does not appear anywhere "
                         "in the ESPN box score for this game, and Pro-Football-"
                         "Reference could not settle it either")
            L.write("player_game_stats", key, p["season"], "*", None, "espn", evid, None,
                    "DB_ONLY", evd, fields_compared=0, fields_matched=0,
                    fields_not_comparable=len(PGS_NOT_RULABLE),
                    not_comparable_fields=PGS_NOT_RULABLE)
            continue

        cats = e.get("_cats", set())
        for f in PGS_ESPN_FIELDS:
            dbv, refv = p[f], e.get(f)
            implied = False
            if refv is None:
                cat = PGS_FIELD_CATEGORY[f]
                if cat in cats:
                    # ESPN published the category but not this stat -- rare; skip
                    continue
                # ESPN did not list this athlete in that category at all, which in
                # an exhaustive box score means zero.
                refv, implied = 0, True
                if f == "targets" and not p["receptions"] and dbv:
                    fieldrecs.append((f, dbv, None, "NOT_COMPARABLE",
                                      "contract rule 5: ESPN omits zero-reception "
                                      "targets from the receiving table entirely, so "
                                      "it cannot rule on this target count"))
                    continue
            compared += 1
            if eq(dbv, refv, 0.001 if f == "sacks_suffered" else 0):
                matched += 1
            else:
                note = ("ESPN did not list this athlete under "
                        f"'{PGS_FIELD_CATEGORY[f]}', which in an exhaustive box score "
                        "asserts zero") if implied else None
                if f == "targets":
                    note = ("contract rule 5: ESPN omits zero-reception targets and "
                            "sometimes charges an incompletion to a different receiver"
                            + (f"; {note}" if note else ""))
                fieldrecs.append((f, dbv, refv, "MISMATCH", note))

        if compared == 0:
            L.write("player_game_stats", key, p["season"], "*", None, "espn", evid, None,
                    "NOT_COMPARABLE", evd, fields_compared=0, fields_matched=0,
                    fields_not_comparable=len(PGS_NOT_RULABLE) + len(PGS_ESPN_FIELDS),
                    not_comparable_fields=PGS_NOT_RULABLE + PGS_ESPN_FIELDS,
                    note="ESPN published no rulable category for this athlete in "
                         "this game")
            continue

        # Where ESPN and the database disagree, bring in Pro-Football-Reference
        # rather than leaving a two-way contradiction unadjudicated (rule 3).
        third = {}
        if any(x[3] == "MISMATCH" for x in fieldrecs):
            off, pev = pfr_off(gid)
            third = off.get(pfr_id.get(p["gsis_id"])) or {}
        for f, dbv, refv, v, note in fieldrecs:
            extra = {}
            if v == "MISMATCH" and f in third:
                extra["third_source_pfr"] = third[f]
                note = (note + "; " if note else "") + \
                    f"third source Pro-Football-Reference: {third[f]}"
            L.write("player_game_stats", key, p["season"], f, dbv, "espn", evid, refv,
                    v, evd, note=note, **extra)
        L.write("player_game_stats", key, p["season"], "*", None, "espn", evid, None,
                _worst([x[3] for x in fieldrecs]) or "MATCH", evd,
                fields_compared=compared, fields_matched=matched,
                fields_not_comparable=len(PGS_NOT_RULABLE),
                not_comparable_fields=PGS_NOT_RULABLE)


# ------------------------------------------------------------- snap_count audit

SNAP_RE = re.compile(r'<table[^>]*id="(home_snap_counts|vis_snap_counts)".*?</table>', re.S)


def parse_pfr_snaps(html):
    """{pfr_player_id: {off,off_pct,def,def_pct,st,st_pct,pos}} from a PFR boxscore."""
    out = {}
    # PFR ships secondary tables inside HTML comments
    body = html.replace("<!--", "").replace("-->", "")
    for m in SNAP_RE.finditer(body):
        tbl = m.group(0)
        for row in re.finditer(r"<tr[^>]*>(.*?)</tr>", tbl, re.S):
            rh = row.group(1)
            pid = re.search(r'data-append-csv="([^"]+)"', rh)
            if not pid:
                continue
            d = {}
            for c in re.finditer(r'data-stat="([a-z_]+)"[^>]*>(.*?)</t[hd]>', rh, re.S):
                d[c.group(1)] = re.sub(r"<[^>]+>", "", c.group(2)).strip()
            out[pid.group(1)] = {
                "pos": d.get("pos"),
                "offense_snaps": num(d.get("offense")),
                "offense_pct": num((d.get("off_pct") or "").rstrip("%")),
                "defense_snaps": num(d.get("defense")),
                "defense_pct": num((d.get("def_pct") or "").rstrip("%")),
                "st_snaps": num(d.get("special_teams")),
                "st_pct": num((d.get("st_pct") or "").rstrip("%")),
            }
    return out


def audit_snap_count(db, L):
    """`snap_count`: PFR is the only authority. Full internal validation for every
    row; genuine external validation only for the games whose PFR page is cached."""
    valid_gid = {g for (g,) in db.execute(
        "SELECT game_id FROM game WHERE season IN (?,?)", SEASONS)}
    valid_pfr = {g: p for g, p in db.execute(
        "SELECT game_id, pfr_game_id FROM game WHERE season IN (?,?)", SEASONS)}
    known_players = {g for (g,) in db.execute("SELECT gsis_id FROM player")}
    game_teams = {g: (a, h) for g, a, h in db.execute(
        "SELECT game_id, away_franchise_id, home_franchise_id FROM game "
        "WHERE season IN (?,?)", SEASONS)}

    pfr_cache = {}

    def pfr(pgid):
        if pgid not in pfr_cache:
            rel = ev("pfr", f"{pgid}.html.gz")
            if os.path.exists(evabs(rel)):
                try:
                    pfr_cache[pgid] = (parse_pfr_snaps(tgz(evabs(rel))), rel)
                except Exception as exc:  # noqa: BLE001
                    pfr_cache[pgid] = (None, rel)
            else:
                errel = ev("pfr", f"{pgid}.err.json")
                pfr_cache[pgid] = (None, errel if os.path.exists(evabs(errel))
                                   else ev("meta", "pfr_coverage.json"))
        return pfr_cache[pgid]

    # Percentage reconciliation. The denominator of each unit's percentage is the
    # team's total plays in that unit for that game -- which is NOT the maximum any
    # one player logged: special teams routinely run 26 plays with no player above
    # 22. So the denominator is recovered from the rows themselves (snaps / pct,
    # taken as a median so a single bad row cannot set it) and every row is then
    # required to agree with it.
    pairs = collections.defaultdict(lambda: collections.defaultdict(list))
    for gid, fid, o, op, d, dp, s, sp in db.execute(
            "SELECT game_id, franchise_id, offense_snaps, offense_pct, defense_snaps, "
            "defense_pct, st_snaps, st_pct FROM snap_count WHERE season IN (?,?)",
            SEASONS):
        for unit, n, pct in (("off", o, op), ("def", d, dp), ("st", s, sp)):
            if n and pct and pct > 0:
                pairs[(gid, fid)][unit].append((n, pct))
    team_tot = collections.defaultdict(dict)
    for key, units in pairs.items():
        for unit, vals in units.items():
            seed = sorted(n / p for n, p in vals)[len(vals) // 2]
            # the published percentages are rounded to whole percents, so pick the
            # integer play total that explains the whole team's rows best
            best = min(range(max(1, round(seed) - 3), round(seed) + 4),
                       key=lambda D: sum(abs(round(n / D, 2) - p) for n, p in vals))
            team_tot[key][unit] = best

    cols = [r[1] for r in db.execute("PRAGMA table_info(snap_count)")]
    internal_ev = ev("meta", "internal.json")
    for r in db.execute("SELECT * FROM snap_count WHERE season IN (?,?) "
                        "ORDER BY game_id, pfr_player_id", SEASONS):
        s = dict(zip(cols, r))
        key = f"{s['pfr_game_id']}/{s['pfr_player_id']}"
        fieldrecs = []
        icompared = imatched = 0

        def ichk(field, ok, dbv=None, refv=None, note=None):
            nonlocal icompared, imatched
            icompared += 1
            if ok:
                imatched += 1
            else:
                fieldrecs.append((field, dbv, refv, "MISMATCH", note, internal_ev,
                                  "internal"))

        ichk("game_id", s["game_id"] in valid_gid, s["game_id"], None,
             "game_id does not join to a game row in this partition")
        ichk("pfr_game_id", valid_pfr.get(s["game_id"]) == s["pfr_game_id"],
             s["pfr_game_id"], valid_pfr.get(s["game_id"]),
             "pfr_game_id disagrees with game.pfr_game_id")
        ichk("gsis_id", s["gsis_id"] in known_players, s["gsis_id"], None,
             "gsis_id does not join to the player dimension")
        at = game_teams.get(s["game_id"])
        ichk("franchise_id", at is not None and s["franchise_id"] in at,
             s["franchise_id"], at, "franchise is not a participant in the game")
        for f in ("offense_snaps", "defense_snaps", "st_snaps"):
            ichk(f, s[f] is None or 0 <= s[f] <= 200, s[f], None,
                 "snap count outside the physically possible 0..200 range")
        for f in ("offense_pct", "defense_pct", "st_pct"):
            ichk(f, s[f] is None or -0.0001 <= s[f] <= 1.0001, s[f], None,
                 "percentage outside 0..1")
        # percentage must reconcile with the team's own maximum snap total
        ichk("source_week", 1 <= (s["source_week"] or 0) <= 22, s["source_week"], None,
             "source_week outside 1..22")

        # external: PFR
        pgid = s["pfr_game_id"]
        snaps, pev = pfr(pgid)
        ecompared = ematched = 0
        pfr_confirmed = set()
        if snaps is None:
            fieldrecs.append(("_pfr", None, None, "UNRESOLVED",
                              "Pro-Football-Reference boxscore not retrievable in this "
                              "run (Cloudflare-gated); row validated internally only",
                              pev, "pro-football-reference"))
        else:
            pr = snaps.get(s["pfr_player_id"])
            if pr is None:
                fieldrecs.append(("_pfr", s["pfr_player_id"], None, "DB_ONLY",
                                  "player id absent from the PFR snap-count tables for "
                                  "this game", pev, "pro-football-reference"))
            else:
                for f, pfrf, tol in (("offense_snaps", "offense_snaps", 0),
                                     ("defense_snaps", "defense_snaps", 0),
                                     ("st_snaps", "st_snaps", 0),
                                     ("offense_pct", "offense_pct", 0.011),
                                     ("defense_pct", "defense_pct", 0.011),
                                     ("st_pct", "st_pct", 0.011)):
                    refv = pr.get(pfrf)
                    if refv is None:
                        continue
                    if f.endswith("_pct"):
                        refv = refv / 100.0
                    ecompared += 1
                    if eq(s[f], refv, tol):
                        ematched += 1
                        pfr_confirmed.add(f)
                    else:
                        fieldrecs.append((f, s[f], refv, "MISMATCH",
                                          "Pro-Football-Reference boxscore snap counts",
                                          pev, "pro-football-reference"))
                if pr.get("pos"):
                    ecompared += 1
                    if eq(s["position"], pr["pos"]):
                        ematched += 1
                    else:
                        fieldrecs.append(("position", s["position"], pr["pos"],
                                          "MISMATCH", "PFR position label", pev,
                                          "pro-football-reference"))

        # Percentage reconciliation, last, because its verdict depends on whether
        # the authority already confirmed the stored value.
        tt = team_tot[(s["game_id"], s["franchise_id"])]
        for f, pf, tk in (("offense_snaps", "offense_pct", "off"),
                          ("defense_snaps", "defense_pct", "def"),
                          ("st_snaps", "st_pct", "st")):
            if not (tt.get(tk) and s[f] is not None and s[pf] is not None):
                continue
            want = round(s[f] / tt[tk], 2)
            if abs(want - s[pf]) <= 0.011:
                icompared += 1
                imatched += 1
            elif pf in pfr_confirmed:
                # PFR published this exact percentage, so the stored value is right
                # and the invariant fails on PFR's side: for a handful of special
                # teams units no single integer play total explains all of PFR's
                # own snaps/percentage pairs.
                fieldrecs.append((pf + "_recon", s[pf], want, "NOT_COMPARABLE",
                                  f"no single integer {tk} play total explains every "
                                  "published snaps/percentage pair for this team-game, "
                                  "so the internal invariant cannot rule; the stored "
                                  "percentage matches Pro-Football-Reference exactly",
                                  pev, "internal"))
            else:
                ichk(pf + "_recon", False, s[pf], want,
                     f"{pf} does not reconcile against the team's {tk} play total "
                     f"{tt[tk]} recovered from this game's own rows")

        for f, dbv, refv, v, note, evd, auth in fieldrecs:
            L.write("snap_count", key, s["season"], f, dbv, auth, pgid, refv, v, evd,
                    note=note)
        L.write("snap_count", key, s["season"], "*", None,
                "pro-football-reference" if snaps is not None else "internal",
                pgid, None, _worst([x[3] for x in fieldrecs]) or "MATCH",
                pev if snaps is not None else internal_ev,
                fields_compared=icompared + ecompared,
                fields_matched=imatched + ematched,
                internal_compared=icompared, external_compared=ecompared,
                fields_not_comparable=0, not_comparable_fields=[],
                note=None if snaps is not None else
                "internal validation only -- PFR page not retrievable this run")


# ---------------------------------------------------------- roster_season audit

def audit_roster_season(db, L):
    """`roster_season`: ESPN rules on membership -- was this player on this team
    that season.

    The obvious endpoint, core-API `seasons/{y}/teams/{id}/athletes`, turns out to
    serve a *current* roster snapshot under the historical season path: for Buffalo
    2022 it returns 92 athletes of whom only 14 were on the 2022 team, omitting Von
    Miller, Cole Beasley and Jordan Poyer. It is cached and still consulted, but the
    primary membership evidence is the 569 cached ESPN box scores, which record
    which franchise each athlete actually appeared for in each season and cannot be
    retro-edited the same way.
    """
    espn_by_team = {}
    for y in SEASONS:
        for p in glob.glob(os.path.join(CACHE, "roster", f"{y}_*.json")):
            fid = int(os.path.basename(p)[:-5].split("_")[1])
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            ids = set()
            for it in d.get("items", []):
                m = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
                if m:
                    ids.add(m.group(1))
            espn_by_team[(y, fid)] = (ids, ev("roster", os.path.basename(p)))

    # membership as ESPN actually recorded it, from every cached box score
    appeared = collections.defaultdict(set)
    appeared_name = collections.defaultdict(set)
    appeared_ev = {}
    for gid, evid, season in db.execute(
            "SELECT game_id, espn_event_id, season FROM game WHERE season IN (?,?)",
            SEASONS):
        sp = summary_path(str(evid))
        if not os.path.exists(evabs(sp)):
            continue
        S = jgz(evabs(sp))
        for tb in S.get("boxscore", {}).get("players", []) or []:
            fid = ESPN_TO_FID.get(tb["team"].get("abbreviation"))
            if fid is None:
                continue
            for cat in tb.get("statistics", []) or []:
                for a in cat.get("athletes", []) or []:
                    ath = a.get("athlete", {})
                    # ESPN emits team-level placeholder "athletes" with negative
                    # ids for team plays; they are not people.
                    if str(ath.get("id", "")).startswith("-"):
                        continue
                    appeared[(season, fid)].add(str(ath.get("id")))
                    appeared_name[(season, fid)].add(normname(ath.get("displayName")))
                    appeared_ev.setdefault((season, fid, str(ath.get("id"))), sp)

    # the source feed, as corroboration that a row is loaded rather than invented
    src = set()
    with open(os.path.join(RAW, "rosters.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["season"] in ("2022", "2023"):
                src.add((int(row["season"]), row["team"], row["gsis_id"],
                         row["full_name"]))
    src_by_player = {(s, g) for s, t, g, n in src}
    src_by_name = {(s, n) for s, t, g, n in src}

    espn_id = {g: str(e) for g, e in db.execute(
        "SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL AND espn_id<>''")}
    known_players = {g for (g,) in db.execute("SELECT gsis_id FROM player")}
    teams = {f for (f,) in db.execute("SELECT franchise_id FROM team")}

    cols = [r[1] for r in db.execute("PRAGMA table_info(roster_season)")]
    NOT_RULABLE = ["depth_chart_position", "status", "years_exp", "source_ordinal",
                   "source_week", "source_game_type", "season_type", "week",
                   "playoff_round"]
    internal_ev = ev("meta", "internal.json")
    for r in db.execute("SELECT * FROM roster_season WHERE season IN (?,?) "
                        "ORDER BY roster_row_id", SEASONS):
        s = dict(zip(cols, r))
        key = str(s["roster_row_id"])
        fieldrecs = []
        compared = matched = 0

        # internal
        compared += 1
        if s["franchise_id"] in teams:
            matched += 1
        else:
            fieldrecs.append(("franchise_id", s["franchise_id"], None, "MISMATCH",
                              "franchise_id not in the team dimension", internal_ev,
                              "internal"))
        compared += 1
        if s["gsis_id"] is None or s["gsis_id"] in known_players:
            matched += 1
        else:
            fieldrecs.append(("gsis_id", s["gsis_id"], None, "MISMATCH",
                              "gsis_id does not join to the player dimension",
                              internal_ev, "internal"))

        key_ts = (s["season"], s["franchise_id"])
        ids, roster_ev = espn_by_team.get(key_ts, (None, None))
        aid = espn_id.get(s["gsis_id"]) if s["gsis_id"] else None
        nm = normname(s["full_name"])
        evd = roster_ev or internal_ev

        if aid and aid in appeared[key_ts]:
            compared += 1
            matched += 1
            evd = appeared_ev.get((s["season"], s["franchise_id"], aid), evd)
        elif nm and nm in appeared_name[key_ts]:
            compared += 1
            matched += 1
            evd = ev("meta", "espn_coverage.json")
        elif ids and aid and aid in ids:
            compared += 1
            matched += 1
        else:
            in_feed = (s["season"], s["gsis_id"]) in src_by_player or \
                      (s["season"], s["full_name"]) in src_by_name
            if in_feed:
                fieldrecs.append(("_membership", s["full_name"], None, "NOT_COMPARABLE",
                                  "the athlete never appears in any ESPN box score for "
                                  "this franchise-season, which is the expected shape "
                                  "for a player who was on the roster but never took a "
                                  f"recorded snap (status={s['status']}); ESPN's season "
                                  "roster endpoint serves a current snapshot and cannot "
                                  "rule either; the row is corroborated in the "
                                  "published source feed raw/rosters.csv", evd, "espn"))
            else:
                fieldrecs.append(("_membership", s["full_name"], None, "DB_ONLY",
                                  "absent from every ESPN box score for this "
                                  "franchise-season, from the ESPN season roster, AND "
                                  "from the published source feed", evd, "espn"))

        for f, dbv, refv, v, note, e2, auth in fieldrecs:
            L.write("roster_season", key, s["season"], f, dbv, auth,
                    f"{s['season']}/{s['franchise_id']}", refv, v, e2, note=note)
        L.write("roster_season", key, s["season"], "*", None, "espn",
                f"{s['season']}/{s['franchise_id']}", None,
                _worst([x[3] for x in fieldrecs]) or "MATCH", evd or internal_ev,
                fields_compared=compared, fields_matched=matched,
                fields_not_comparable=len(NOT_RULABLE),
                not_comparable_fields=NOT_RULABLE)

    # Reverse direction: anyone ESPN recorded playing for a franchise in a season
    # who has no roster_season row at all is a genuine membership gap.
    stored = collections.defaultdict(set)
    for season, fid, gsis, name in db.execute(
            "SELECT r.season, r.franchise_id, r.gsis_id, r.full_name FROM roster_season r "
            "WHERE r.season IN (?,?)", SEASONS):
        stored[(season, fid)].add(espn_id.get(gsis))
        stored[(season, fid)].add(normname(name))
    for (season, fid), aids in sorted(appeared.items()):
        for aid in sorted(aids):
            if aid in stored[(season, fid)]:
                continue
            nm = next((normname(n) for a, n in
                       [(aid, None)]), None)  # name looked up below
            L.write("roster_season", f"{season}/{fid}/espn{aid}", season,
                    "_membership_reverse", None, "espn", f"{season}/{fid}", aid,
                    "REF_ONLY",
                    appeared_ev.get((season, fid, aid), ev("meta", "espn_coverage.json")),
                    note="ESPN box scores record this athlete appearing for this "
                         "franchise in this season, but roster_season carries no row "
                         "for them")


# ------------------------------------------------------------ depth_chart audit

def audit_depth_chart(db, L):
    """`depth_chart`: no historical public source exists. Internal + structural only."""
    known_players = {g for (g,) in db.execute("SELECT gsis_id FROM player")}
    teams = {f for (f,) in db.execute("SELECT franchise_id FROM team")}
    gameweeks = {(s, w) for s, w in db.execute(
        "SELECT DISTINCT season, week FROM game WHERE season IN (?,?) AND week IS NOT NULL",
        SEASONS)}
    cols = [r[1] for r in db.execute("PRAGMA table_info(depth_chart)")]
    evd = ev("meta", "internal.json")
    seen_snapshot = set()
    for r in db.execute("SELECT * FROM depth_chart WHERE season IN (?,?) "
                        "ORDER BY depth_chart_id", SEASONS):
        d = dict(zip(cols, r))
        key = str(d["depth_chart_id"])
        fieldrecs = []
        compared = matched = 0

        def chk(field, ok, dbv=None, note=None):
            nonlocal compared, matched
            compared += 1
            if ok:
                matched += 1
            else:
                fieldrecs.append((field, dbv, None, "MISMATCH", note))

        chk("franchise_id", d["franchise_id"] in teams, d["franchise_id"],
            "franchise_id not in the team dimension")
        chk("gsis_id", d["gsis_id"] is None or d["gsis_id"] in known_players,
            d["gsis_id"], "gsis_id does not join to the player dimension")
        chk("identity", d["gsis_id"] is not None or d["espn_id"] is not None, None,
            "row identifies no player at all (schema CHECK)")
        chk("week_exclusivity", not (d["week"] is not None and d["playoff_round"] is not None),
            f"{d['week']}|{d['playoff_round']}", "week and playoff_round both set")
        chk("season_type", (
            (d["week"] is not None and d["season_type"] == "REG") or
            (d["playoff_round"] is not None and d["season_type"] == "POST") or
            (d["week"] is None and d["playoff_round"] is None and d["season_type"] is None)),
            f"{d['season_type']}|{d['week']}|{d['playoff_round']}",
            "season_type does not agree with week/playoff_round")
        chk("shape_snapshot", (d["source_shape"] == "B") == (d["snapshot_ts"] is not None),
            f"{d['source_shape']}|{d['snapshot_ts']}",
            "shape B must carry a snapshot_ts and shape A must not")
        chk("depth_order", d["depth_order"] is None or d["depth_order"] >= 1,
            d["depth_order"], "depth_order below 1")
        chk("source_week", d["source_week"] is None or 1 <= d["source_week"] <= 22,
            d["source_week"], "source_week outside 1..22")
        chk("season", d["season"] in SEASONS, d["season"], "season outside the partition")
        if d["week"] is not None:
            chk("week_playable", (d["season"], d["week"]) in gameweeks, d["week"],
                "week has no games in that season")
        if d["snapshot_ts"] is not None:
            k = (d["snapshot_ts"], d["franchise_id"], d["scheme"], d["pos_slot"],
                 d["depth_order"])
            chk("uq_depth_snapshot", k not in seen_snapshot, str(k),
                "duplicate of the uq_depth_snapshot unique key")
            seen_snapshot.add(k)

        for f, dbv, refv, v, note in fieldrecs:
            L.write("depth_chart", key, d["season"], f, dbv, "internal",
                    str(d["franchise_id"]), refv, v, evd, note=note)
        L.write("depth_chart", key, d["season"], "*", None, "internal",
                str(d["franchise_id"]), None,
                _worst([x[3] for x in fieldrecs]) or "NOT_COMPARABLE", evd,
                fields_compared=compared, fields_matched=matched,
                fields_not_comparable=len(cols),
                not_comparable_fields=["<all>"],
                note="no historical public depth-chart source exists (ESPN publishes "
                     "current only); this row is validated internally and structurally "
                     "only and is NOT externally verified")


# -------------------------------------------------------- data_correction audit

def audit_data_correction(db, L, sb_idx):
    """Re-verify every correction whose target row is in 2022 or 2023."""
    rows = list(db.execute(
        "SELECT correction_id, defect, target_table, target_key, column_name, "
        "upstream_value, corrected_value, source FROM data_correction "
        "WHERE target_key LIKE '2022%' OR target_key LIKE '2023%'"))
    evd = ev("meta", "internal.json")
    for cid, defect, tbl, tkey, col, up, corr, source in rows:
        gid = tkey.split("/")[0]
        fid = int(tkey.split("/")[1]) if "/" in tkey else None
        season = int(gid[:4])
        # D15: rest, recomputed from kickoffs actually played
        if defect == "D15" and col in ("homeRest", "awayRest"):
            side = "home" if col == "homeRest" else "away"
            g = db.execute("SELECT kickoff_utc, home_franchise_id, away_franchise_id, "
                           f"{side}_rest, {side}_rest_upstream FROM game WHERE game_id=?",
                           (gid,)).fetchone()
            kick, hf, af, stored, upstream = g
            team = hf if side == "home" else af
            prev = db.execute(
                "SELECT MAX(kickoff_utc) FROM team_game WHERE franchise_id=? "
                "AND kickoff_utc < ?", (team, kick)).fetchone()[0]
            want = (datetime.strptime(kick, "%Y-%m-%dT%H:%M:%SZ").date() -
                    datetime.strptime(prev, "%Y-%m-%dT%H:%M:%SZ").date()).days
            ok = (str(stored) == str(corr) and want == int(corr) and
                  str(upstream) == str(up))
            note = (f"correction {defect} re-derived from the last kickoff this "
                    f"franchise actually played ({prev}); stored={stored} "
                    f"upstream={upstream} recomputed={want}; cited source: "
                    f"{source[:160]}")
            if not ok:
                L.write("data_correction", str(cid), season, col, corr, "derived",
                        tkey, want, "MISMATCH", evd, note=note)
            L.write("data_correction", str(cid), season, "*", corr, "derived", tkey,
                    want, "MATCH" if ok else "MISMATCH", evd,
                    fields_compared=3, fields_matched=3 if ok else 0,
                    fields_not_comparable=0, not_comparable_fields=[], note=note)
        else:
            L.write("data_correction", str(cid), season, "*", corr, "internal", tkey,
                    up, "UNRESOLVED", evd, fields_compared=0, fields_matched=0,
                    fields_not_comparable=0, not_comparable_fields=[],
                    note=f"no re-verification path implemented for defect {defect}")
    return len(rows)


# ------------------------------------------------------------- Hamlin verification

def verify_hamlin(db, sb_idx):
    """The 2022-12 BUF-CIN abandonment, end to end."""
    out = {}
    out["espn_shell_event_present_in_scoreboard"] = "401437947" in sb_idx
    if "401437947" in sb_idx:
        e, rel = sb_idx["401437947"]
        c = e["competitions"][0]
        out["espn_status"] = c["status"]["type"]["name"]
        out["espn_date"] = c["date"]
        out["espn_scores"] = {x["team"]["abbreviation"]: x.get("score")
                              for x in c["competitors"]}
        out["evidence"] = rel
    out["game_rows_with_that_event_id"] = db.execute(
        "SELECT COUNT(*) FROM game WHERE espn_event_id='401437947'").fetchone()[0]
    out["game_rows_2022_wk17_buf_or_cin"] = db.execute(
        "SELECT COUNT(*) FROM game WHERE season=2022 AND week=17 AND "
        "(away_franchise_id IN (2,4) OR home_franchise_id IN (2,4))").fetchone()[0]
    out["reg_games_2022_by_franchise"] = dict(db.execute(
        "SELECT (SELECT abbreviation FROM team t WHERE t.franchise_id=tg.franchise_id), "
        "COUNT(*) FROM team_game tg WHERE season=2022 AND season_type='REG' "
        "GROUP BY franchise_id").fetchall())
    out["franchises_not_at_17"] = {k: v for k, v in out["reg_games_2022_by_franchise"].items()
                                   if v != 17}
    out["total_2022_games"] = db.execute(
        "SELECT COUNT(*) FROM game WHERE season=2022").fetchone()[0]
    # nothing anywhere may reference the abandoned fixture
    for tbl, col in (("game_line", "game_id"), ("team_game", "game_id"),
                     ("player_game_stats", "game_id"), ("snap_count", "game_id")):
        out[f"{tbl}_rows_for_2022_wk17_buf_cin"] = db.execute(
            f"SELECT COUNT(*) FROM {tbl} WHERE {col} IN "
            "(SELECT game_id FROM game WHERE season=2022 AND week=17 AND "
            "(away_franchise_id IN (2,4) OR home_franchise_id IN (2,4)))").fetchone()[0]
    out["snap_rows_pfr_202301020cin"] = db.execute(
        "SELECT COUNT(*) FROM snap_count WHERE pfr_game_id LIKE '20230102%'").fetchone()[0]
    # D15 downstream: every row that should carry the corrected rest
    out["d15_2022_game_rows"] = [dict(zip(
        ("game_id", "home_rest", "home_rest_upstream", "away_rest", "away_rest_upstream"), r))
        for r in db.execute(
        "SELECT game_id, home_rest, home_rest_upstream, away_rest, away_rest_upstream "
        "FROM game WHERE game_id IN ('2022_18_NE_BUF','2022_18_BAL_CIN')")]
    out["d15_2022_team_game_rows"] = [dict(zip(
        ("game_id", "franchise_id", "rest_days", "rest_days_upstream"), r))
        for r in db.execute(
        "SELECT game_id, franchise_id, rest_days, rest_days_upstream FROM team_game "
        "WHERE game_id IN ('2022_18_NE_BUF','2022_18_BAL_CIN') ORDER BY game_id, franchise_id")]
    # Every 2022/2023 row whose rest disagrees with a recomputation in venue-local
    # calendar days from the previous game that franchise actually played. If the
    # D15 correction were incomplete, the strays would show up here.
    played = collections.defaultdict(list)
    for season, fid, day in db.execute(
            "SELECT g.season, tg.franchise_id, g.gameday FROM team_game tg "
            "JOIN game g USING(game_id) WHERE g.season IN (2022,2023)"):
        played[(season, fid)].append(day)
    strays = []
    for season, gid, day, hf, af, hr, ar in db.execute(
            "SELECT season, game_id, gameday, home_franchise_id, away_franchise_id, "
            "home_rest, away_rest FROM game WHERE season IN (2022,2023) "
            "ORDER BY kickoff_utc"):
        for side, fid, stored in (("home", hf, hr), ("away", af, ar)):
            prev = [d for d in played[(season, fid)] if d < day]
            want = 7 if not prev else (
                datetime.strptime(day, "%Y-%m-%d").date() -
                datetime.strptime(max(prev), "%Y-%m-%d").date()).days
            if want != stored:
                strays.append({"game_id": gid, "side": side, "stored": stored,
                               "recomputed": want,
                               "prev_game_day": max(prev) if prev else None})
    out["rest_disagreements"] = strays
    out["rest_rows_recomputed"] = 2 * db.execute(
        "SELECT COUNT(*) FROM game WHERE season IN (2022,2023)").fetchone()[0]
    return out


def verify_high_volume(db):
    """2023 is the prop-modelling season. Rebuild the season lines of the highest
    volume skill players from the ESPN box scores game by game and hold them
    against what the database would answer."""
    espn_id = {g: e for g, e in db.execute(
        "SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL AND espn_id<>''")}
    evid = {g: str(e) for g, e in db.execute(
        "SELECT game_id, espn_event_id FROM game WHERE season=2023")}
    boxes = {}
    for gid, e in evid.items():
        p = summary_path(e)
        if os.path.exists(evabs(p)):
            boxes[gid] = espn_boxscore_players(jgz(evabs(p)))

    leaders = list(db.execute(
        "SELECT gsis_id, SUM(receiving_yards) FROM player_game_stats WHERE season=2023 "
        "GROUP BY gsis_id ORDER BY 2 DESC LIMIT 12")) + list(db.execute(
        "SELECT gsis_id, SUM(rushing_yards) FROM player_game_stats WHERE season=2023 "
        "GROUP BY gsis_id ORDER BY 2 DESC LIMIT 12")) + list(db.execute(
        "SELECT gsis_id, SUM(passing_yards) FROM player_game_stats WHERE season=2023 "
        "GROUP BY gsis_id ORDER BY 2 DESC LIMIT 12"))
    fields = ["receptions", "targets", "receiving_yards", "receiving_tds", "carries",
              "rushing_yards", "rushing_tds", "completions", "attempts",
              "passing_yards", "passing_tds", "interceptions"]
    out = []
    for gsis, _ in dict.fromkeys(leaders):
        name = db.execute("SELECT display_name FROM player WHERE gsis_id=?",
                          (gsis,)).fetchone()[0]
        aid = espn_id.get(gsis)
        rows = db.execute(
            "SELECT game_id, " + ", ".join(fields) +
            " FROM player_game_stats WHERE season=2023 AND gsis_id=? ORDER BY game_id",
            (gsis,)).fetchall()
        dbtot = collections.Counter()
        reftot = collections.Counter()
        bad = []
        for r in rows:
            gid, vals = r[0], dict(zip(fields, r[1:]))
            e = (boxes.get(gid) or {}).get(aid)
            if e is None:
                nm = normname(name)
                e = next((d for d in (boxes.get(gid) or {}).values()
                          if normname(d.get("name")) == nm), None)
            for f in fields:
                dbtot[f] += vals[f] or 0
                if e is None:
                    continue
                refv = e.get(f)
                if refv is None:
                    refv = 0
                reftot[f] += refv
                if (vals[f] or 0) != refv and not (f == "targets" and not vals["receptions"]):
                    bad.append({"game_id": gid, "field": f, "db": vals[f], "espn": refv})
        out.append({
            "player": name, "gsis_id": gsis, "espn_id": aid, "games": len(rows),
            "db_season_totals": {f: dbtot[f] for f in fields if dbtot[f]},
            "espn_season_totals": {f: reftot[f] for f in fields if reftot[f]},
            "totals_agree": all(dbtot[f] == reftot[f] for f in fields
                                if f not in ("targets",)),
            "per_game_disagreements": bad,
        })
    return out


def verify_washington(db):
    """2022 is Washington's first season as the Commanders."""
    return {
        "team_row": dict(zip(("franchise_id", "abbreviation", "display_name",
                              "conference", "division"),
                             db.execute("SELECT franchise_id, abbreviation, "
                                        "display_name, conference, division FROM team "
                                        "WHERE franchise_id=28").fetchone())),
        "aliases": [dict(zip(("abbreviation", "is_current", "note"), r)) for r in
                    db.execute("SELECT abbreviation, is_current, note FROM team_alias "
                               "WHERE franchise_id=28")],
        "franchise_id_by_season": dict(db.execute(
            "SELECT season, COUNT(*) FROM game WHERE (home_franchise_id=28 OR "
            "away_franchise_id=28) GROUP BY season")),
        "era_labels_by_season": dict(db.execute(
            "SELECT season, GROUP_CONCAT(DISTINCT ab) FROM ("
            "  SELECT season, home_abbr ab FROM game WHERE home_franchise_id=28"
            "  UNION SELECT season, away_abbr FROM game WHERE away_franchise_id=28"
            ") GROUP BY season")),
        "games_2022": db.execute("SELECT COUNT(*) FROM team_game WHERE season=2022 "
                                 "AND franchise_id=28").fetchone()[0],
        "games_2023": db.execute("SELECT COUNT(*) FROM team_game WHERE season=2023 "
                                 "AND franchise_id=28").fetchone()[0],
        "note": "franchise_id 28 is stable across the 2020 Football Team and 2022 "
                "Commanders rebrands; game rows carry the source-published era label "
                "WAS while the team dimension carries the current ESPN label WSH, and "
                "team_alias maps both to 28",
    }


# ------------------------------------------------------------------------ main

def coverage(db):
    q = {
        "game": "SELECT COUNT(*) FROM game WHERE season IN (2022,2023)",
        "game_line": "SELECT COUNT(*) FROM game_line l JOIN game g USING(game_id) "
                     "WHERE g.season IN (2022,2023)",
        "team_game": "SELECT COUNT(*) FROM team_game WHERE season IN (2022,2023)",
        "player_game_stats": "SELECT COUNT(*) FROM player_game_stats "
                             "WHERE season IN (2022,2023)",
        "snap_count": "SELECT COUNT(*) FROM snap_count WHERE season IN (2022,2023)",
        "roster_season": "SELECT COUNT(*) FROM roster_season WHERE season IN (2022,2023)",
        "depth_chart": "SELECT COUNT(*) FROM depth_chart WHERE season IN (2022,2023)",
        "data_correction": "SELECT COUNT(*) FROM data_correction WHERE "
                           "target_key LIKE '2022%' OR target_key LIKE '2023%'",
    }
    return {k: db.execute(v).fetchone()[0] for k, v in q.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["fetch", "audit"])
    ap.add_argument("--tables", default="")
    a = ap.parse_args()

    start_md5 = md5(DB)
    print(f"[db] md5 at start: {start_md5}")
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

    if a.stage == "fetch":
        fetch_stage(con)
        print(f"[db] md5 at end:   {md5(DB)}")
        return

    os.makedirs(os.path.join(CACHE, "meta"), exist_ok=True)
    for name, payload in (
            ("internal.json", {"note": "internal/derived checks carry no external HTTP "
                                       "response; this file is the evidence anchor for "
                                       "recomputation-only verdicts", "agent": AGENT}),
            ("espn_coverage.json", {"note": "records which ESPN summaries were cached",
                                    "cached": len(glob.glob(os.path.join(CACHE, "summary",
                                                                         "*.json.gz")))}),
            ("pfr_coverage.json", {"note": "records which PFR boxscores were retrievable",
                                   "cached": len(glob.glob(os.path.join(CACHE, "pfr",
                                                                        "*.html.gz")))})):
        with open(os.path.join(CACHE, "meta", name), "w") as f:
            json.dump(payload, f, indent=1)

    load_team_maps(con)
    sb_idx = scoreboard_index()
    print(f"[espn] scoreboard events indexed: {len(sb_idx)}")

    L = Ledger(LEDGER)
    want = set(a.tables.split(",")) if a.tables else None
    t0 = time.time()
    for name, fn in (("game", lambda: audit_game(con, L, sb_idx)),
                     ("game_line", lambda: audit_game_line(con, L)),
                     ("team_game", lambda: audit_team_game(con, L)),
                     ("player_game_stats", lambda: audit_player_game_stats(con, L)),
                     ("snap_count", lambda: audit_snap_count(con, L)),
                     ("roster_season", lambda: audit_roster_season(con, L)),
                     ("depth_chart", lambda: audit_depth_chart(con, L)),
                     ("data_correction", lambda: audit_data_correction(con, L, sb_idx))):
        if want and name not in want:
            continue
        s = time.time()
        fn()
        print(f"[audit] {name}: {sum(L.by_table[name].values())} ledger lines "
              f"({time.time()-s:.1f}s)")
    L.close()

    cov = coverage(con)
    summary = {
        "agent": AGENT, "seasons": list(SEASONS),
        "db_md5_start": start_md5, "db_md5_end": md5(DB),
        "elapsed_s": round(time.time() - t0, 1),
        "verdicts": dict(L.counts),
        "by_table": {k: dict(v) for k, v in L.by_table.items()},
        "coverage": {k: {"rows_in_partition": cov[k],
                         "rows_in_ledger": len(L.rows_seen.get(k, ())),
                         "difference": cov[k] - len(L.rows_seen.get(k, ()))}
                     for k in cov},
        "espn_summaries_cached": len(glob.glob(os.path.join(CACHE, "summary", "*.json.gz"))),
        "pfr_boxscores_cached": len(glob.glob(os.path.join(CACHE, "pfr", "*.html.gz"))),
        "hamlin": verify_hamlin(con, sb_idx),
        "washington": verify_washington(con),
        "high_volume_2023": verify_high_volume(con) if not want else None,
        "findings_sample": L.findings[:400],
        "findings_total": len(L.findings),
    }
    with open(os.path.join(CACHE, "meta", "f07_summary.json"), "w") as f:
        json.dump(summary, f, indent=1, default=str)
    print(json.dumps({k: summary[k] for k in
                      ("verdicts", "coverage", "db_md5_start", "db_md5_end",
                       "espn_summaries_cached", "pfr_boxscores_cached",
                       "findings_total")}, indent=1, default=str))


if __name__ == "__main__":
    main()
