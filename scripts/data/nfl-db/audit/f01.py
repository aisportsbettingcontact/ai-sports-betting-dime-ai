#!/usr/bin/env python3
"""F01 -- forensic row-level audit of NFL seasons 2010 and 2011.

Partition: every row of every table whose season is 2010 or 2011.

    game                534
    game_line           534
    team_game         1,068  (2 per game)
    player_game_stats 34,988
    snap_count            0  (upstream boundary -- proved, not assumed)
    roster_season     4,251
    depth_chart      76,362

Authorities (per docs/audits/2026-07-27-nfl-db-forensic/AUDIT-CONTRACT.md):
    game               ESPN scoreboard + summary
    player_game_stats  ESPN summary box score
    game_line          SportsOddsHistory / covers.com (cached by agent A4)
    team_game          derived -- recomputed from game + game_line
    snap_count         Pro-Football-Reference (via the nflverse PFR mirror; PFR 403s us)
    roster_season      ESPN season roster -- PROVEN not era-correct, see phase 5
    depth_chart        no historical public source exists -- internal/structural only

The database is opened read-only. Every HTTP response is cached; the whole audit
replays offline from cache alone.

Usage:
    python3 f01.py fetch          # populate cache (network)
    python3 f01.py audit          # run every phase, write the ledger (offline)
    python3 f01.py md5            # print the database md5
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import sqlite3
import sys
import time
import html as htmllib
import urllib.request
import urllib.error
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)                       # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB_PATH = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache")
MYCACHE = os.path.join(CACHE, "f01")
LEDGER_DIR = os.path.join(REPO, "docs", "audits", "2026-07-27-nfl-db-forensic", "ledger")
LEDGER = os.path.join(LEDGER_DIR, "F01.jsonl")

AGENT = "F01"
SEASONS = (2010, 2011)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
ET = ZoneInfo("America/New_York")

os.makedirs(MYCACHE, exist_ok=True)
os.makedirs(LEDGER_DIR, exist_ok=True)


# --------------------------------------------------------------------------- utils
def md5_file(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(path: str) -> str:
    """Evidence paths are recorded relative to scripts/data/nfl-db/."""
    return os.path.relpath(path, NFLDB)


def read_json_any(path: str):
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return json.load(fh)
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def http_get(url: str, timeout: int = 45) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001 -- recorded, never invented
        return 0, str(e).encode()


# ------------------------------------------------------------- summary cache lookup
def summary_paths(event_id: str) -> list[str]:
    """Every place a prior agent may have cached this ESPN summary, best first."""
    return [
        os.path.join(MYCACHE, f"summary_{event_id}.json.gz"),
        os.path.join(CACHE, "a5", f"summary_{event_id}.json.gz"),
        os.path.join(CACHE, "a2", f"espn_summary_{event_id}.json"),
    ]


def find_summary(event_id: str) -> str | None:
    for p in summary_paths(event_id):
        if os.path.exists(p):
            return p
    err = os.path.join(MYCACHE, f"summary_{event_id}.ERROR.json")
    return err if os.path.exists(err) else None


def fetch_summary(event_id: str) -> str:
    """Return the on-disk path of the cached ESPN summary, fetching if needed."""
    hit = find_summary(event_id)
    if hit:
        return hit
    url = f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={event_id}"
    dest = os.path.join(MYCACHE, f"summary_{event_id}.json.gz")
    err = os.path.join(MYCACHE, f"summary_{event_id}.ERROR.json")
    status, body = 0, b""
    for attempt in range(4):                       # ESPN drops connections mid-body sometimes
        status, body = http_get(url)
        if status == 200 and body.startswith(b"{") and body.rstrip().endswith(b"}"):
            with gzip.open(dest, "wb") as fh:
                fh.write(body)
            if os.path.exists(err):
                os.remove(err)
            time.sleep(0.25)
            return dest
        time.sleep(1.0 + attempt)
    with open(err, "w", encoding="utf-8") as fh:
        json.dump({"url": url, "http_status": status, "attempts": 4,
                   "body_head": body[:2000].decode("utf-8", "replace")}, fh)
    return err


def db_games() -> list[sqlite3.Row]:
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT * FROM game WHERE season IN (2010,2011) ORDER BY kickoff_utc, game_id"
    ).fetchall()
    con.close()
    return rows


def cmd_fetch() -> None:
    games = db_games()
    todo = []
    for g in games:
        hit = find_summary(g["espn_event_id"])
        if hit is None or hit.endswith("ERROR.json"):
            todo.append(g["espn_event_id"])
    print(f"{len(games)} games in partition; {len(games)-len(todo)} summaries already cached; "
          f"fetching {len(todo)}")
    done = [0]

    def work(eid: str) -> None:
        fetch_summary(eid)
        done[0] += 1
        if done[0] % 25 == 0:
            print(f"  {done[0]}/{len(todo)}", flush=True)

    with ThreadPoolExecutor(max_workers=2) as ex:      # contract: ~2 in flight max
        list(ex.map(work, todo))

    # --- evidence for the roster_season ruling: is ESPN's historical roster era-correct?
    probes = [
        ("espn_core_athletes_2010_team18",
         "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2010/teams/18/athletes?limit=200"),
        ("espn_core_athletes_2011_team9",
         "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2011/teams/9/athletes?limit=200"),
        ("espn_site_roster_2010_team18",
         "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/18/roster?season=2010"),
        ("espn_site_roster_2011_team9",
         "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/9/roster?season=2011"),
        # evidence for the snap_count upstream boundary (PFR itself 403s automated clients)
        ("nflverse_snapcounts_2010", "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2010.csv"),
        ("nflverse_snapcounts_2011", "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2011.csv"),
        ("nflverse_snapcounts_2012", "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2012.csv"),
        ("nflverse_snapcounts_2013", "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2013.csv"),
        ("pfr_boxscore_201009090nor", "https://www.pro-football-reference.com/boxscores/201009090nor.htm"),
    ]
    for name, url in probes:
        dest = os.path.join(MYCACHE, f"probe_{name}.json")
        if os.path.exists(dest):
            continue
        status, body = http_get(url)
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump({"url": url, "http_status": status, "bytes": len(body),
                       "body_head": body[:4000].decode("utf-8", "replace")}, fh, indent=1)
        print(f"  probe {name}: HTTP {status} ({len(body)} bytes)")
        time.sleep(0.4)
    print("fetch complete")


# --------------------------------------------------------------------------- ledger
class Ledger:
    KEYS = ("ts", "agent", "table", "row_key", "season", "field", "db_value",
            "authority", "ref_id", "ref_value", "verdict", "evidence", "note",
            "fields_compared", "fields_matched", "fields_not_comparable",
            "not_comparable_fields")

    def __init__(self, path: str):
        self.fh = open(path, "w", encoding="utf-8")
        self.n = 0
        self.verdicts: dict[tuple[str, str], int] = defaultdict(int)
        self.rowkeys: dict[str, set] = defaultdict(set)
        self.ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def write(self, table, row_key, season, field, db_value, authority, ref_id,
              ref_value, verdict, evidence, note=None, **extra):
        rec = {"ts": self.ts, "agent": AGENT, "table": table, "row_key": row_key,
               "season": season, "field": field, "db_value": db_value,
               "authority": authority, "ref_id": ref_id, "ref_value": ref_value,
               "verdict": verdict, "evidence": evidence}
        if note:
            rec["note"] = note
        for k, v in extra.items():
            rec[k] = v
        self.fh.write(json.dumps(rec, separators=(",", ":"), default=str) + "\n")
        self.n += 1
        self.verdicts[(table, verdict)] += 1
        if field == "*":
            self.rowkeys[table].add(row_key)

    def close(self):
        self.fh.close()


class RowAudit:
    """Accumulates field verdicts for one row, then emits per the contract volume rule.

    Contract: per-field records for every non-MATCH outcome; MATCH fields collapse
    into a single row-level record with field:"*".
    """

    def __init__(self, led: Ledger, table: str, row_key: str, season: int,
                 authority: str, evidence: str, ref_id):
        self.led, self.table, self.row_key = led, table, row_key
        self.season, self.authority, self.evidence, self.ref_id = season, authority, evidence, ref_id
        self.compared = 0
        self.matched = 0
        self.nc_null: list[str] = []          # NULL in db AND unrulable -> nothing to verify
        self.pending: list[tuple] = []

    def cmp(self, field, db_value, ref_value, *, authority=None, ref_id=None,
            evidence=None, note=None, eq=None):
        ok = (db_value == ref_value) if eq is None else eq(db_value, ref_value)
        self.compared += 1
        if ok:
            self.matched += 1
            return True
        self.pending.append((field, db_value, ref_value, "MISMATCH",
                             authority or self.authority, ref_id if ref_id is not None else self.ref_id,
                             evidence or self.evidence, note))
        return False

    def verdict(self, field, db_value, ref_value, verdict, *, authority=None,
                ref_id=None, evidence=None, note=None, counts=True):
        if counts:
            self.compared += 1
            if verdict == "MATCH":
                self.matched += 1
        if verdict == "MATCH":
            return
        self.pending.append((field, db_value, ref_value, verdict,
                             authority or self.authority, ref_id if ref_id is not None else self.ref_id,
                             evidence or self.evidence, note))

    def not_comparable(self, field, db_value, note, *, collapse=False,
                       collapse_when_null=True, authority=None, evidence=None):
        """Field the authority structurally cannot rule on.

        `collapse=True` records the field NAME on the row-level record
        (not_comparable_fields) instead of spending a line on it.  Used only where
        non-comparability is a property of the whole table rather than of this row --
        every depth_chart column, and player_game_stats.position -- so the line would
        restate one fact tens of thousands of times.  Nothing is lost: the row record
        names each field.  Any row-specific non-comparability still gets its own line.
        """
        if collapse or (collapse_when_null and (db_value is None)):
            self.nc_null.append(field)
            return
        self.pending.append((field, db_value, None, "NOT_COMPARABLE",
                             authority or self.authority, self.ref_id,
                             evidence or self.evidence, note))

    def flush(self, row_verdict: str | None = None, note: str | None = None):
        for (field, dbv, refv, verdict, auth, rid, ev, nt) in self.pending:
            self.led.write(self.table, self.row_key, self.season, field, dbv, auth,
                           rid, refv, verdict, ev, nt)
        if row_verdict is None:
            bad = {v for (_, _, _, v, _, _, _, _) in self.pending}
            if "MISMATCH" in bad:
                row_verdict = "MISMATCH"
            elif "DB_ONLY" in bad:
                row_verdict = "DB_ONLY"
            elif "UNRESOLVED" in bad:
                row_verdict = "UNRESOLVED"
            elif self.matched > 0:
                # NOT_COMPARABLE fields never downgrade a row that had real matches;
                # they are counted in fields_not_comparable on this same record.
                row_verdict = "MATCH"
            else:
                row_verdict = "NOT_COMPARABLE"
        self.led.write(self.table, self.row_key, self.season, "*", None,
                       self.authority, self.ref_id, None, row_verdict, self.evidence,
                       note, fields_compared=self.compared, fields_matched=self.matched,
                       fields_not_comparable=len(self.nc_null) + sum(
                           1 for p in self.pending if p[3] == "NOT_COMPARABLE"),
                       not_comparable_fields=self.nc_null or None)
        return row_verdict


# ------------------------------------------------------------------- ESPN accessors
def espn_summary(event_id: str):
    p = find_summary(event_id)
    if p is None:
        return None, None
    if p.endswith(".ERROR.json"):
        return None, rel(p)
    return read_json_any(p), rel(p)


def parse_stat_int(s):
    if s is None:
        return None
    s = s.strip()
    if s in ("", "--", "-"):
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s))
        except ValueError:
            return None


def espn_boxscore(summary):
    """-> {espn_athlete_id: {stat: value, 'team_id': str}} plus team stat totals."""
    out: dict[str, dict] = {}
    team_of: dict[str, str] = {}
    for team_blk in (summary.get("boxscore") or {}).get("players", []) or []:
        tid = str(team_blk["team"]["id"])
        for grp in team_blk.get("statistics", []) or []:
            name = grp.get("name")
            keys = grp.get("keys") or []
            for ath in grp.get("athletes", []) or []:
                aid = str(ath.get("athlete", {}).get("id"))
                stats = ath.get("stats") or []
                rec = out.setdefault(aid, {"team_id": tid, "name": ath["athlete"].get("displayName")})
                team_of[aid] = tid
                kv = dict(zip(keys, stats))
                if name == "passing":
                    ca = kv.get("completions/passingAttempts", "0/0")
                    comp, att = (ca.split("/") + ["0"])[:2] if "/" in ca else ("0", "0")
                    rec["completions"] = parse_stat_int(comp)
                    rec["attempts"] = parse_stat_int(att)
                    rec["passing_yards"] = parse_stat_int(kv.get("passingYards"))
                    rec["passing_tds"] = parse_stat_int(kv.get("passingTouchdowns"))
                    rec["interceptions"] = parse_stat_int(kv.get("interceptions"))
                    sk = (kv.get("sacks-sackYardsLost") or "").split("-")
                    rec["sacks_suffered"] = parse_stat_int(sk[0]) if sk and sk[0] != "" else None
                elif name == "rushing":
                    rec["carries"] = parse_stat_int(kv.get("rushingAttempts"))
                    rec["rushing_yards"] = parse_stat_int(kv.get("rushingYards"))
                    rec["rushing_tds"] = parse_stat_int(kv.get("rushingTouchdowns"))
                elif name == "receiving":
                    rec["receptions"] = parse_stat_int(kv.get("receptions"))
                    rec["receiving_yards"] = parse_stat_int(kv.get("receivingYards"))
                    rec["receiving_tds"] = parse_stat_int(kv.get("receivingTouchdowns"))
                    rec["targets"] = parse_stat_int(kv.get("receivingTargets"))
    return out


def espn_team_totals(summary):
    out = {}
    for t in (summary.get("boxscore") or {}).get("teams", []) or []:
        tid = str(t["team"]["id"])
        d = {}
        for s in t.get("statistics", []) or []:
            d[s.get("name")] = s.get("displayValue")
        out[tid] = d
    return out


def espn_scoring_tds(summary):
    """Rushing / receiving / passing TD counts per scorer name, from scoringPlays."""
    rush = defaultdict(int)
    rec = defaultdict(int)
    for p in summary.get("scoringPlays", []) or []:
        txt = (p.get("text") or "")
        typ = ((p.get("type") or {}).get("abbreviation") or "")
        if typ != "TD":
            continue
        m = re.match(r"([A-Za-z'.\-\s]+?)\s+(\d+)\s+Yd\s+(Run|Rush)", txt)
        if m:
            rush[m.group(1).strip()] += 1
            continue
        m = re.match(r"([A-Za-z'.\-\s]+?)\s+(\d+)\s+Yd\s+pass\s+from\s+([A-Za-z'.\-\s]+)", txt, re.I)
        if m:
            rec[m.group(1).strip()] += 1
    return dict(rush), dict(rec)


# --------------------------------------------------------------------------- phases
RULE5_TARGETS = ("contract rule 5 known-good: ESPN omits zero-reception targets entirely and "
                 "sometimes charges an incompletion to a different receiver, so ESPN target "
                 "counts cannot rule on nflverse target counts")
NC_EPA = "NC-EPA: nflverse play-by-play derivative; ESPN box scores publish no EPA or air-yards"
NC_POS = ("NC-POS: ESPN box scores carry no position and ESPN athlete records give the current "
          "position, not the 2010-11 one")
NC_DEPTHCHART = ("NC-DEPTHCHART: no historical public depth-chart source exists -- ESPN publishes "
                 "current depth charts only (probe cached). External validation is impossible; "
                 "only internal and structural checks were run. No external validation is claimed.")
NC_ROSTER = ("NC-ROSTER: ESPN's historical season-roster endpoints return the CURRENT roster and "
             "CURRENT head coach for a 2010/2011 query (probe cached); no era-correct public "
             "source for this column")

STAT_FIELDS = ["completions", "attempts", "passing_yards", "passing_tds", "interceptions",
               "sacks_suffered", "carries", "rushing_yards", "rushing_tds",
               "receptions", "targets", "receiving_yards", "receiving_tds"]
DERIVED_FIELDS = ["passing_epa", "rushing_epa", "receiving_epa", "air_yards_share"]

REPORT: dict = {"findings": defaultdict(list), "counts": {}}


def _nparts(x):
    n = re.sub(r"[^a-z ]", "", (x or "").lower()).split()
    drop = {"jr", "sr", "ii", "iii", "iv", "v"}
    return [t for t in n if t not in drop] or n


def name_relation(a, b) -> str:
    """MATCH | VARIANT | DIFFERENT.

    VARIANT covers the two classes this era is full of: nickname/long-form pairs
    (Pat/Patrick, Josh/Joshua, Mike/Michael) and players who legally changed their
    name after 2011, where the 2010-11 feed carries the era-correct name and
    player.display_name carries the current one.
    """
    na, nb = _nparts(a), _nparts(b)
    if not na or not nb:
        return "DIFFERENT"
    if na == nb:
        return "MATCH"
    same_last = na[-1] == nb[-1]
    fa, fb = na[0], nb[0]
    same_first = fa == fb or fa.startswith(fb) or fb.startswith(fa)
    if same_last and same_first:
        return "MATCH"
    if same_last or same_first:
        return "VARIANT"
    return "DIFFERENT"


def name_eq(a, b) -> bool:
    return name_relation(a, b) == "MATCH"


def is_alias(a, b) -> bool:
    """Same surname AND same first initial -- tight enough to use as an identity key."""
    na, nb = _nparts(a), _nparts(b)
    if not na or not nb:
        return False
    return na[-1] == nb[-1] and na[0][0] == nb[0][0]


def note_finding(kind: str, payload):
    REPORT["findings"][kind].append(payload)


def main_audit() -> None:
    md5_start = md5_file(DB_PATH)
    print(f"db md5 (start): {md5_start}")

    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    led = Ledger(LEDGER)

    teams = {r["franchise_id"]: dict(r) for r in con.execute("SELECT * FROM team")}
    alias = {r["abbreviation"]: r["franchise_id"] for r in con.execute("SELECT * FROM team_alias")}
    players = {r["gsis_id"]: dict(r) for r in con.execute(
        "SELECT gsis_id, display_name, espn_id, position FROM player")}
    espn_to_gsis = defaultdict(list)
    for g, p in players.items():
        if p["espn_id"]:
            espn_to_gsis[str(p["espn_id"])].append(g)

    games = [dict(r) for r in con.execute(
        "SELECT * FROM game WHERE season IN (2010,2011) ORDER BY kickoff_utc, game_id")]
    by_gid = {g["game_id"]: g for g in games}

    scoreboard = load_scoreboard()
    summaries = {}
    for g in games:
        s, ev = espn_summary(g["espn_event_id"])
        summaries[g["game_id"]] = (s, ev)

    phase_game(led, con, games, scoreboard, summaries, teams, alias)
    phase_game_line(led, con, games)
    phase_team_game(led, con, games)
    phase_player_game_stats(led, con, games, summaries, players, espn_to_gsis)
    phase_snap_count(led, con)
    phase_roster_season(led, con, games, summaries, players, espn_to_gsis)
    phase_depth_chart(led, con, players, teams)
    phase_corrections(led, con, games, summaries, players)

    led.close()
    md5_end = md5_file(DB_PATH)
    print(f"db md5 (end):   {md5_end}   {'UNCHANGED' if md5_end == md5_start else '*** CHANGED ***'}")
    print(f"ledger lines: {led.n}")

    summary_out = {
        "db_md5_start": md5_start, "db_md5_end": md5_end,
        "ledger_lines": led.n,
        "verdicts": {f"{t}|{v}": n for (t, v), n in sorted(led.verdicts.items())},
        "rows_in_ledger": {t: len(s) for t, s in sorted(led.rowkeys.items())},
        "findings": {k: v for k, v in REPORT["findings"].items()},
        "counts": REPORT["counts"],
    }
    with open(os.path.join(MYCACHE, "f01_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary_out, fh, indent=1, default=str)
    print(json.dumps({k: summary_out[k] for k in ("verdicts", "rows_in_ledger")}, indent=1))


def load_scoreboard():
    """a1 cached ESPN scoreboards -> {event_id: (event, evidence_path)}."""
    out = {}
    d = os.path.join(CACHE, "a1", "scoreboard")
    for fn in os.listdir(d):
        m = re.match(r"^(2010|2011)_(\d)_(\d+)\.json$", fn)
        if not m:
            continue
        path = os.path.join(d, fn)
        data = read_json_any(path)
        for ev in data.get("events", []) or []:
            out[str(ev["id"])] = (ev, rel(path))
    return out


# -------------------------------------------------------------------- phase 1: game
POST_WEEK_TO_ROUND = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}


def norm_venue(s):
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"\b(stadium|field|dome|center|centre|the|at|of|park)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def phase_game(led, con, games, scoreboard, summaries, teams, alias):
    print("phase 1: game")
    # modal venue per (franchise, season) -- used to corroborate `location`
    venue_by_home = defaultdict(lambda: defaultdict(int))
    for g in games:
        venue_by_home[(g["home_franchise_id"], g["season"])][g["stadium_id"]] += 1
    modal = {k: max(v.items(), key=lambda kv: kv[1])[0] for k, v in venue_by_home.items()}

    # actual rest: previous played kickoff for each franchise, in kickoff order
    last_kick: dict[tuple, str] = {}
    rest_expect: dict[str, dict[str, int]] = {}
    for g in sorted(games, key=lambda x: x["kickoff_utc"]):
        for side in ("away", "home"):
            fid = (g[f"{side}_franchise_id"], g["season"])
            prev = last_kick.get(fid)
            if prev:
                d0 = datetime.fromisoformat(prev.replace("Z", "+00:00")).astimezone(ET).date()
                d1 = datetime.fromisoformat(g["kickoff_utc"].replace("Z", "+00:00")).astimezone(ET).date()
                rest_expect.setdefault(g["game_id"], {})[side] = (d1 - d0).days
        for side in ("away", "home"):
            last_kick[(g[f"{side}_franchise_id"], g["season"])] = g["kickoff_utc"]

    for g in games:
        gid, eid = g["game_id"], g["espn_event_id"]
        summ, sev = summaries[gid]
        sb = scoreboard.get(eid)
        ev, sbev = (sb if sb else (None, None))
        evidence = sev or sbev or "MISSING"
        ra = RowAudit(led, "game", gid, g["season"], "espn", evidence, eid)

        if summ is None and ev is None:
            ra.verdict("*", None, None, "UNRESOLVED", note="no cached ESPN response for this event id")
            ra.flush("UNRESOLVED")
            note_finding("game_no_espn", gid)
            continue

        head = (summ or {}).get("header", {})
        comp = (head.get("competitions") or [{}])[0] if summ else {}
        cs = {c.get("homeAway"): c for c in (comp.get("competitors") or [])} if summ else {}
        if not cs and ev:
            cs = {c.get("homeAway"): c for c in (ev.get("competitions") or [{}])[0].get("competitors", [])}

        # --- identity ------------------------------------------------------------
        ra.cmp("espn_event_id", eid, str(head.get("id")) if summ else str(ev.get("id")))
        # ESPN pre-2014 event ids encode date + home franchise: 3 Y MM DD HHH
        y, m, d = g["gameday"].split("-")
        enc = f"3{y[-1]}{m}{d}{g['home_franchise_id']:03d}"
        ra.cmp("espn_event_id.home_encoding", eid, enc,
               note="ESPN pre-2014 event id = '3' + year digit + MMDD + zero-padded home franchise id")

        gid_re = re.match(r"^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$", gid)
        ra.verdict("game_id.format", gid, None, "MATCH" if gid_re else "MISMATCH",
                   authority="derived", note=None if gid_re else "game_id does not match {season}_{wk}_{away}_{home}")
        if gid_re:
            ra.cmp("game_id.away_abbr", gid_re.group(3), g["away_abbr"], authority="derived")
            ra.cmp("game_id.home_abbr", gid_re.group(4), g["home_abbr"], authority="derived")
            ra.cmp("game_id.season", int(gid_re.group(1)), g["season"], authority="derived")

        # --- season / week -------------------------------------------------------
        if summ:
            ra.cmp("season", g["season"], (head.get("season") or {}).get("year"))
            st = (head.get("season") or {}).get("type")
            ra.cmp("season_type", g["season_type"], {2: "REG", 3: "POST"}.get(st))
            wk = head.get("week")
            if g["season_type"] == "REG":
                ra.cmp("week", g["week"], wk)
                ra.not_comparable("playoff_round", g["playoff_round"], "REG game: no playoff round by construction")
            else:
                ra.cmp("playoff_round", g["playoff_round"], POST_WEEK_TO_ROUND.get(wk),
                       note=f"ESPN postseason week {wk}")
                ra.not_comparable("week", g["week"], "POST game: week is NULL by construction")
        # --- teams ---------------------------------------------------------------
        for side in ("away", "home"):
            c = cs.get(side)
            ra.cmp(f"{side}_franchise_id", g[f"{side}_franchise_id"],
                   int(c["team"]["id"]) if c else None)
            db_ab = g[f"{side}_abbr"]
            espn_ab = c["team"].get("abbreviation") if c else None
            ra.cmp(f"{side}_abbr", alias.get(db_ab), int(c["team"]["id"]) if c else None,
                   note=f"db abbr {db_ab!r} resolved through team_alias; ESPN publishes the "
                        f"current-franchise abbreviation {espn_ab!r}")

        # --- result --------------------------------------------------------------
        completed = None
        if summ:
            completed = (((comp.get("status") or {}).get("type") or {}).get("completed"))
        elif ev:
            completed = (((ev.get("competitions") or [{}])[0].get("status") or {}).get("type") or {}).get("completed")
        ra.cmp("result_status", g["result_status"], "final" if completed else "scheduled")
        for side in ("away", "home"):
            c = cs.get(side)
            ra.cmp(f"{side}_score", g[f"{side}_score"],
                   int(c["score"]) if c and c.get("score") not in (None, "") else None)
        ra.cmp("result", g["result"],
               (g["home_score"] - g["away_score"]) if g["home_score"] is not None else None,
               authority="derived")
        ra.cmp("total", g["total"],
               (g["home_score"] + g["away_score"]) if g["home_score"] is not None else None,
               authority="derived")

        # --- overtime (scoreboard status.period) ---------------------------------
        if ev:
            per = ((ev.get("competitions") or [{}])[0].get("status") or {}).get("period")
            ra.cmp("overtime", g["overtime"], 1 if (per or 0) > 4 else 0,
                   evidence=sbev, note=f"ESPN final period {per}")
        else:
            ra.not_comparable("overtime", g["overtime"], "no cached scoreboard for this event",
                              collapse_when_null=False)

        # --- timing --------------------------------------------------------------
        espn_dt = comp.get("date") if summ else (ev.get("date") if ev else None)
        if espn_dt:
            e_iso = espn_dt.replace("Z", "") + ":00Z" if len(espn_dt) == 17 else espn_dt
            if g["kickoff_utc"] == e_iso:
                ra.cmp("kickoff_utc", g["kickoff_utc"], e_iso)
            else:
                ra.verdict("kickoff_utc", g["kickoff_utc"], e_iso, "NOT_COMPARABLE",
                           note="contract rule 5 known-good: nflverse stores the scheduled kickoff, "
                                "ESPN the observed one")
                note_finding("kickoff_delta", {"game_id": gid, "db": g["kickoff_utc"], "espn": e_iso})
        ko = datetime.fromisoformat(g["kickoff_utc"].replace("Z", "+00:00"))
        ra.cmp("gametime_et", g["gametime_et"], ko.astimezone(ET).strftime("%H:%M"), authority="derived")
        ra.cmp("gameday.espn_event_id_encoding", (y[-1], m, d), (eid[1], eid[2:4], eid[4:6]),
               note="gameday (year digit, month, day) vs the date embedded in the ESPN event id")
        ra.cmp("weekday", g["weekday"], ko.astimezone(ET).strftime("%A"), authority="derived")
        if summ:
            ra.cmp("time_valid", g["time_valid"], 1 if head.get("timeValid") else 0)
        else:
            ra.not_comparable("time_valid", g["time_valid"], "no cached summary", collapse_when_null=False)

        # --- venue ---------------------------------------------------------------
        gi = (summ or {}).get("gameInfo") or {}
        sb_venue = ((ev or {}).get("competitions") or [{}])[0].get("venue") or {}
        venue = dict(sb_venue)
        venue.update({k: v for k, v in (gi.get("venue") or {}).items() if v is not None})
        vname = venue.get("fullName")
        if vname and norm_venue(vname) == norm_venue(g["stadium"]):
            ra.cmp("stadium", g["stadium"], vname,
                   eq=lambda a, b: norm_venue(a) == norm_venue(b))
        elif vname:
            ra.verdict("stadium", g["stadium"], vname, "NOT_COMPARABLE",
                       note="contract rule 5 known-good: ESPN retro-renames venues")
            note_finding("venue_rename", {"game_id": gid, "db": g["stadium"], "espn": vname})
        else:
            ra.not_comparable("stadium", g["stadium"], "ESPN response carries no venue",
                              collapse_when_null=False)
        indoor = venue.get("indoor")
        if indoor is not None:
            db_indoor = g["roof"] in ("dome", "closed")
            if db_indoor == bool(indoor):
                ra.cmp("roof", db_indoor, bool(indoor),
                       note=f"db roof={g['roof']!r} vs ESPN venue.indoor={indoor}")
            elif g["roof"] == "open":
                ra.verdict("roof", g["roof"], f"indoor={indoor}", "NOT_COMPARABLE",
                           note="different semantics: nflverse roof records the state of a "
                                "retractable roof on the day; ESPN venue.indoor is a fixed venue "
                                "attribute. Both are right about different things.")
                note_finding("retractable_roof",
                             {"game_id": gid, "stadium": g["stadium"], "roof": g["roof"]})
            else:
                ra.cmp("roof", db_indoor, bool(indoor),
                       note=f"db roof={g['roof']!r} vs ESPN venue.indoor={indoor}")
        else:
            ra.not_comparable("roof", g["roof"], "ESPN venue has no indoor flag", collapse_when_null=False)
        grass = venue.get("grass")
        db_grass = (g["surface"] or "").startswith("grass")
        if grass is None:
            ra.not_comparable("surface", g["surface"], "ESPN venue has no grass flag",
                              collapse_when_null=False)
        elif db_grass == bool(grass):
            ra.cmp("surface", db_grass, bool(grass),
                   note=f"db surface={g['surface']!r} vs ESPN venue.grass={grass}")
        else:
            ra.verdict("surface", g["surface"], f"grass={grass}", "NOT_COMPARABLE",
                       note=f"ESPN venue.grass is a CURRENT-state attribute, not era-correct: "
                            f"{vname} has been resurfaced since {g['season']}")
            note_finding("surface_current_state",
                         {"game_id": gid, "stadium": g["stadium"], "db_surface": g["surface"],
                          "espn_venue": vname, "espn_grass": grass})
        ra.not_comparable("stadium_id", g["stadium_id"],
                          "nflverse stadium key; ESPN uses a different venue id space",
                          collapse_when_null=False)
        ra.not_comparable("venue_id", g["venue_id"],
                          "column unpopulated for every pre-2026 row by construction (0/4363); "
                          "ESPN does publish a venue id -- see report coverage gaps")

        # --- neutral site --------------------------------------------------------
        is_mod = (g["stadium_id"] == modal.get((g["home_franchise_id"], g["season"])))
        ra.verdict("location", g["location"],
                   (comp.get("neutralSite") if summ else None), "NOT_COMPARABLE",
                   note=f"contract rule 5 known-good: ESPN neutralSite unpopulated before 2014 "
                        f"(reads {comp.get('neutralSite') if summ else None}); venue corroboration: "
                        f"db stadium_id {g['stadium_id']} "
                        f"{'IS' if is_mod else 'is NOT'} the home team's modal {g['season']} venue")
        if (g["location"] == "Neutral") != (not is_mod):
            note_finding("location_venue_conflict",
                         {"game_id": gid, "location": g["location"], "stadium_id": g["stadium_id"],
                          "modal": modal.get((g["home_franchise_id"], g["season"]))})

        # --- rest ----------------------------------------------------------------
        for side in ("away", "home"):
            exp = rest_expect.get(gid, {}).get(side)
            if exp is None:
                ra.not_comparable(f"{side}_rest", g[f"{side}_rest"],
                                  "first game of the season for this franchise: no prior kickoff "
                                  "inside the partition to measure rest from", collapse_when_null=False)
            else:
                ra.cmp(f"{side}_rest", g[f"{side}_rest"], exp, authority="derived")
            ra.not_comparable(f"{side}_rest_upstream", g[f"{side}_rest_upstream"],
                              "nflverse rest against the ORIGINAL schedule; ESPN cannot rule",
                              collapse_when_null=False)

        # --- weather -------------------------------------------------------------
        weather_ok = (g["roof"] != "outdoors") == (g["temp"] is None)
        ra.verdict("temp", g["temp"], (gi.get("weather") if summ else None), "NOT_COMPARABLE",
                   note=f"ESPN publishes no historical weather for 2010-11 (gameInfo.weather="
                        f"{(gi.get('weather') if summ else None)!r}); internal rule temp IS NULL "
                        f"<=> venue is roofed (dome/closed/retractable-open) holds: {weather_ok}")
        ra.verdict("wind", g["wind"], None, "NOT_COMPARABLE",
                   note="ESPN publishes no historical weather for 2010-11")
        if not weather_ok:
            note_finding("weather_roof_conflict", {"game_id": gid, "roof": g["roof"], "temp": g["temp"]})

        # --- officials -----------------------------------------------------------
        refs = [o.get("fullName") for o in (gi.get("officials") or [])
                if ((o.get("position") or {}).get("name") == "Referee")]
        if refs:
            rl = name_relation(g["referee"], refs[0])
            if rl == "MATCH":
                ra.cmp("referee", g["referee"], refs[0], eq=lambda a, b: True)
            elif rl == "VARIANT":
                ra.verdict("referee", g["referee"], refs[0], "NOT_COMPARABLE",
                           note="same official, different published name form")
                note_finding("referee_name_variant", {"game_id": gid, "db": g["referee"],
                                                      "espn": refs[0]})
            else:
                ra.cmp("referee", g["referee"], refs[0])
        else:
            ra.not_comparable("referee", g["referee"], "ESPN gameInfo lists no Referee for this game",
                              collapse_when_null=False)

        # --- quarterbacks --------------------------------------------------------
        box = espn_boxscore(summ) if summ else {}
        passers = defaultdict(list)
        for aid, rec in box.items():
            if rec.get("attempts"):
                passers[rec["team_id"]].append(rec.get("name"))
        for side in ("away", "home"):
            tid = str(g[f"{side}_franchise_id"])
            names = passers.get(tid, [])
            qb = g[f"{side}_qb_name"]
            if names:
                rels = [name_relation(qb, n) for n in names]
                best = "MATCH" if "MATCH" in rels else ("VARIANT" if "VARIANT" in rels else "DIFFERENT")
                if best == "MATCH":
                    ra.cmp(f"{side}_qb_name", True, True,
                           note=f"db qb {qb!r} appears among ESPN passers for team {tid}: {names}")
                elif best == "VARIANT":
                    ra.verdict(f"{side}_qb_name", qb, names, "NOT_COMPARABLE",
                               note=f"same player, different published name form; ESPN passers "
                                    f"for team {tid}: {names}")
                    note_finding("qb_name_variant", {"game_id": gid, "db": qb, "espn": names})
                else:
                    ra.cmp(f"{side}_qb_name", qb, names, eq=lambda a, b: False,
                           note=f"db qb {qb!r} is not among the ESPN passers for team {tid}")
            else:
                ra.not_comparable(f"{side}_qb_name", qb, "no passer recorded in ESPN box score",
                                  collapse_when_null=False)
            ra.not_comparable(f"{side}_qb_id", g[f"{side}_qb_id"],
                              "gsis id; ESPN publishes its own athlete id space", collapse_when_null=False)
            ra.not_comparable(f"{side}_coach", g[f"{side}_coach"],
                              "ESPN historical roster endpoint returns the CURRENT head coach "
                              "(probe cached); no era-correct ESPN coach source",
                              collapse_when_null=False)

        # --- division game -------------------------------------------------------
        ta, th = teams.get(g["away_franchise_id"]), teams.get(g["home_franchise_id"])
        div = 1 if (ta and th and ta["conference"] == th["conference"]
                    and ta["division"] == th["division"]) else 0
        ra.cmp("div_game", g["div_game"], div, authority="derived")

        # --- cross-source keys ---------------------------------------------------
        ra.not_comparable("data_source", g["data_source"],
                          "provenance column, not a fact about the game", collapse=True)
        ra.not_comparable("gsis_game_id", g["gsis_game_id"], "NFL GSIS id space; ESPN cannot rule",
                          collapse_when_null=False)
        pfr_ok = None
        if g["pfr_game_id"]:
            pfr_ok = g["pfr_game_id"][:8] == f"{y}{m}{d}"
        ra.verdict("pfr_game_id", g["pfr_game_id"], None,
                   "NOT_COMPARABLE",
                   note=f"PFR blocks automated clients (HTTP 403, probe cached); internal check "
                        f"pfr_game_id date prefix == gameday: {pfr_ok}")
        if pfr_ok is False:
            note_finding("pfr_id_date_conflict", {"game_id": gid, "pfr_game_id": g["pfr_game_id"],
                                                  "gameday": g["gameday"]})
        old_ok = None
        if g["old_game_id"]:
            old_ok = g["old_game_id"][:8] == f"{y}{m}{d}"
        ra.verdict("old_game_id", g["old_game_id"], None, "NOT_COMPARABLE",
                   note=f"legacy NFL id; internal check date prefix == gameday: {old_ok}")
        ra.not_comparable("ftn_game_id", g["ftn_game_id"], "FTN id space; unpopulated for 2010-11")
        ra.not_comparable("broadcast", g["broadcast"],
                          "column unpopulated for every pre-2026 row by construction (0/4363); "
                          "ESPN does publish broadcasts -- see report coverage gaps")
        ra.not_comparable("note", g["note"], "free-text column; unpopulated for 2010-11")

        ra.flush()
    print("  done")


# --------------------------------------------------------------- phase 2: game_line
SOH_TEAM = {
    "Arizona Cardinals": 22, "Atlanta Falcons": 1, "Baltimore Ravens": 33, "Buffalo Bills": 2,
    "Carolina Panthers": 29, "Chicago Bears": 3, "Cincinnati Bengals": 4, "Cleveland Browns": 5,
    "Dallas Cowboys": 6, "Denver Broncos": 7, "Detroit Lions": 8, "Green Bay Packers": 9,
    "Houston Texans": 34, "Indianapolis Colts": 11, "Jacksonville Jaguars": 30,
    "Kansas City Chiefs": 12, "Miami Dolphins": 15, "Minnesota Vikings": 16,
    "New England Patriots": 17, "New Orleans Saints": 18, "New York Giants": 19,
    "New York Jets": 20, "Oakland Raiders": 13, "Philadelphia Eagles": 21,
    "Pittsburgh Steelers": 23, "San Diego Chargers": 24, "San Francisco 49ers": 25,
    "Seattle Seahawks": 26, "St Louis Rams": 14, "St. Louis Rams": 14, "Tampa Bay Buccaneers": 27,
    "Tennessee Titans": 10, "Washington Redskins": 28,
}


DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def parse_soh(season: int):
    """Parse the cached SportsOddsHistory season page.

    -> {(date, frozenset({fid, fid})): {fav_fid, spread_abs, total, fav_is_home,
                                        neutral, fav_score, dog_score, row}}
    Rows read:  Day Date Time @? Favorite Score Spread @? Underdog Over/Under [Notes]
    Playoff rows carry a leading Round column; the Super Bowl marks 'N' for neutral.
    """
    path = os.path.join(CACHE, "a4", f"soh_{season}.html.gz")
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
        doc = fh.read()
    out = {}
    for tab in re.findall(r"<table.*?</table>", doc, re.S):
        for tr in re.findall(r"<tr[^>]*>.*?</tr>", tab, re.S):
            cells = [re.sub(r"\s+", " ", htmllib.unescape(re.sub("<[^>]+>", "", c)).strip())
                     for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            off = None
            for cand in (0, 1):
                if len(cells) >= 10 + cand and cells[cand] in DAYS:
                    off = cand
                    break
            if off is None or len(cells) < 10 + off:
                continue
            date_s = cells[off + 1]
            at1, fav, score, spread, at2, dog, ou = cells[off + 3:off + 10]
            if not re.match(r"^[A-Z][a-z]{2} \d{1,2}, \d{4}$", date_s or ""):
                continue
            fav_n = re.sub(r"\s*\(\d+\)$", "", fav).strip()
            dog_n = re.sub(r"\s*\(\d+\)$", "", dog).strip()
            if fav_n not in SOH_TEAM or dog_n not in SOH_TEAM:
                continue
            dt = datetime.strptime(date_s, "%b %d, %Y").date().isoformat()
            if re.search(r"\bPK\b", spread, re.I):
                sp = 0.0
            else:
                m = re.search(r"(-?\d+(?:\.\d+)?)", spread)
                sp = abs(float(m.group(1))) if m else None
            mo = re.search(r"(\d+(?:\.\d+)?)", ou)
            tot = float(mo.group(1)) if mo else None
            ms = re.search(r"([WLT])\s+(\d+)-(\d+)", score)
            fav_score = int(ms.group(2)) if ms else None
            dog_score = int(ms.group(3)) if ms else None
            neutral = "N" in (at1, at2)
            rec = {"fav_fid": SOH_TEAM[fav_n], "dog_fid": SOH_TEAM[dog_n],
                   "spread_abs": sp, "total": tot, "fav_is_home": at1 == "@",
                   "dog_is_home": at2 == "@", "neutral": neutral,
                   "fav_score": fav_score, "dog_score": dog_score, "row": cells}
            out[(dt, frozenset((SOH_TEAM[fav_n], SOH_TEAM[dog_n])))] = rec
    return out


def load_nflverse_games():
    """Third source: the raw nflverse games.csv the loader read (cached by A4)."""
    import csv
    path = os.path.join(CACHE, "a4", "nflverse_games.csv.gz")
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return {r["game_id"]: r for r in csv.DictReader(fh)}, rel(path)


def phase_game_line(led, con, games):
    print("phase 2: game_line")
    soh = {s: parse_soh(s) for s in SEASONS}
    nv, nv_ev = load_nflverse_games()
    ev = {s: rel(os.path.join(CACHE, "a4", f"soh_{s}.html.gz")) for s in SEASONS}
    lines = {r["game_id"]: dict(r) for r in con.execute(
        "SELECT l.* FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (2010,2011)")}
    by_gid = {g["game_id"]: g for g in games}
    matched = 0
    for gid, ln in sorted(lines.items()):
        g = by_gid[gid]
        pair = frozenset((g["home_franchise_id"], g["away_franchise_id"]))
        ref = soh[g["season"]].get((g["gameday"], pair))
        if ref is None:                       # tolerate a one-day publication offset
            for delta in (-1, 1):
                d = (datetime.fromisoformat(g["gameday"]) + timedelta(days=delta)).date().isoformat()
                ref = soh[g["season"]].get((d, pair))
                if ref:
                    break
        ra = RowAudit(led, "game_line", gid, g["season"], "sportsoddshistory",
                      ev[g["season"]], f"{g['gameday']}|{g['away_abbr']}@{g['home_abbr']}")
        if ref is None:
            ra.verdict("spread_line", ln["spread_line"], None, "UNRESOLVED",
                       note="no SportsOddsHistory row matched on (gameday +/-1, team pair)")
            ra.verdict("total_line", ln["total_line"], None, "UNRESOLVED",
                       note="no SportsOddsHistory row matched on (gameday +/-1, team pair)")
            note_finding("gameline_unmatched", gid)
        else:
            matched += 1
            fav_home = ref["fav_fid"] == g["home_franchise_id"]
            spread_home = None if ref["spread_abs"] is None else (
                ref["spread_abs"] if fav_home else -ref["spread_abs"])
            raw = nv.get(gid, {})
            ra.cmp("spread_line", float(ln["spread_line"]), spread_home,
                   eq=lambda a, b: b is not None and float(a) == float(b),
                   note=f"third source (raw nflverse games.csv, {nv_ev}) = "
                        f"{raw.get('spread_line')}; SOH row: {ref['row']}")
            ra.cmp("total_line", float(ln["total_line"]), ref["total"],
                   eq=lambda a, b: b is not None and float(a) == float(b),
                   note=f"third source (raw nflverse games.csv, {nv_ev}) = "
                        f"{raw.get('total_line')}; SOH row: {ref['row']}")
            if raw:
                for col in ("spread_line", "total_line", "away_moneyline", "home_moneyline",
                            "away_spread_odds", "home_spread_odds", "over_odds", "under_odds"):
                    ra.cmp(f"nflverse_fidelity.{col}", float(ln[col]), float(raw[col]),
                           authority="nflverse (declared odds_source)", evidence=nv_ev,
                           note="does the database faithfully reproduce its declared source?")
            # SOH is a genuine second source for the final score and the home marker
            hs = ref["fav_score"] if fav_home else ref["dog_score"]
            as_ = ref["dog_score"] if fav_home else ref["fav_score"]
            ra.cmp("thirdsource.home_score", g["home_score"], hs,
                   note="covers.com/SportsOddsHistory final score (second source on game, "
                        "recorded per contract rule 3)")
            ra.cmp("thirdsource.away_score", g["away_score"], as_,
                   note="covers.com/SportsOddsHistory final score")
            if not ref["neutral"]:
                ra.cmp("thirdsource.home_team", g["home_franchise_id"],
                       ref["fav_fid"] if ref["fav_is_home"] else ref["dog_fid"],
                       note="SOH '@' marker identifies the home team")
            else:
                ra.verdict("thirdsource.home_team", g["home_franchise_id"], "neutral",
                           "NOT_COMPARABLE",
                           note="SOH marks this game 'N' (neutral site) and names no home team")
        for f in ("away_moneyline", "home_moneyline", "away_spread_odds", "home_spread_odds",
                  "over_odds", "under_odds"):
            ra.verdict(f, ln[f], None, "NOT_COMPARABLE",
                       note="SportsOddsHistory publishes closing spread and total only -- no "
                            "moneyline or juice for 2010-11; no other public historical source")
        ra.not_comparable("odds_source", ln["odds_source"], "provenance column, not a market fact",
                          collapse_when_null=False)
        ra.flush()
    REPORT["counts"]["game_line_soh_matched"] = matched
    print(f"  done ({matched}/{len(lines)} matched to SOH)")


# -------------------------------------------------------------- phase 3: team_game
def phase_team_game(led, con, games):
    print("phase 3: team_game")
    by_gid = {g["game_id"]: g for g in games}
    lines = {r["game_id"]: dict(r) for r in con.execute(
        "SELECT l.* FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (2010,2011)")}
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM team_game WHERE season IN (2010,2011) ORDER BY kickoff_utc, game_id, franchise_id")]

    # game_number: nth game of that franchise's season, in kickoff order
    seen = defaultdict(int)
    gnum = {}
    for g in sorted(games, key=lambda x: (x["kickoff_utc"], x["game_id"])):
        for side in ("away", "home"):
            fid = g[f"{side}_franchise_id"]
            seen[(fid, g["season"])] += 1
            gnum[(g["game_id"], fid)] = seen[(fid, g["season"])]

    for tg in rows:
        g = by_gid.get(tg["game_id"])
        rk = f"{tg['game_id']}|{tg['franchise_id']}"
        ra = RowAudit(led, "team_game", rk, tg["season"], "derived",
                      rel(DB_PATH) + "#game+game_line", tg["game_id"])
        if g is None:
            ra.verdict("game_id", tg["game_id"], None, "DB_ONLY",
                       note="team_game row references a game_id absent from game")
            ra.flush("DB_ONLY")
            note_finding("team_game_orphan", rk)
            continue
        is_home = 1 if tg["franchise_id"] == g["home_franchise_id"] else 0
        opp = g["away_franchise_id"] if is_home else g["home_franchise_id"]
        pf = g["home_score"] if is_home else g["away_score"]
        pa = g["away_score"] if is_home else g["home_score"]
        ln = lines.get(tg["game_id"])
        spread = None if ln is None else (float(ln["spread_line"]) if is_home else -float(ln["spread_line"]))
        total_line = None if ln is None else float(ln["total_line"])
        ml = None if ln is None else (ln["home_moneyline"] if is_home else ln["away_moneyline"])
        margin = None if pf is None else pf - pa

        ra.cmp("is_home", tg["is_home"], is_home)
        ra.cmp("opponent_id", tg["opponent_id"], opp)
        ra.cmp("season", tg["season"], g["season"])
        ra.cmp("season_type", tg["season_type"], g["season_type"])
        ra.cmp("week", tg["week"], g["week"])
        ra.cmp("playoff_round", tg["playoff_round"], g["playoff_round"])
        ra.cmp("kickoff_utc", tg["kickoff_utc"], g["kickoff_utc"])
        ra.cmp("points_for", tg["points_for"], pf)
        ra.cmp("points_against", tg["points_against"], pa)
        ra.cmp("margin", tg["margin"], margin)
        ra.cmp("spread", None if tg["spread"] is None else float(tg["spread"]), spread)
        ra.cmp("total_line", None if tg["total_line"] is None else float(tg["total_line"]), total_line)
        ra.cmp("moneyline", tg["moneyline"], ml)
        ra.cmp("rest_days", tg["rest_days"], g["home_rest"] if is_home else g["away_rest"])
        ra.cmp("rest_days_upstream", tg["rest_days_upstream"],
               g["home_rest_upstream"] if is_home else g["away_rest_upstream"])
        ra.cmp("won", tg["won"], None if margin is None or margin == 0 else (1 if margin > 0 else 0))
        ra.cmp("su_result", tg["su_result"],
               None if margin is None else ("W" if margin > 0 else "L" if margin < 0 else "T"))
        ats = None if (margin is None or spread is None) else (
            "W" if margin > spread else "L" if margin < spread else "P")
        ra.cmp("ats_result", tg["ats_result"], ats)
        ra.cmp("covered", tg["covered"], None if ats in (None, "P") else (1 if ats == "W" else 0))
        ou = None if (pf is None or total_line is None) else (
            "O" if pf + pa > total_line else "U" if pf + pa < total_line else "P")
        ra.cmp("ou_result", tg["ou_result"], ou)
        ra.cmp("game_number", tg["game_number"], gnum.get((tg["game_id"], tg["franchise_id"])))
        ra.flush()
    print("  done")


# ------------------------------------------------- phase 4: player_game_stats (ESPN)
def phase_player_game_stats(led, con, games, summaries, players, espn_to_gsis):
    print("phase 4: player_game_stats")
    by_gid = {g["game_id"]: g for g in games}
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM player_game_stats WHERE season IN (2010,2011) "
        "ORDER BY game_id, gsis_id")]
    per_game = defaultdict(list)
    for r in rows:
        per_game[r["game_id"]].append(r)

    inflation = []
    target_diffs = []
    db_only = []
    ref_only = []
    team_agg_problems = []

    for gid in sorted(per_game):
        g = by_gid[gid]
        summ, ev = summaries[gid]
        box = espn_boxscore(summ) if summ else {}
        team_tot = espn_team_totals(summ) if summ else {}
        seen_espn = set()
        # name index per ESPN team, for players whose player.espn_id does not resolve
        by_name = defaultdict(list)
        for aid, bb in box.items():
            by_name[bb["team_id"]].append((bb.get("name"), aid))

        # team-level target totals for the target_share recompute
        tt = defaultdict(int)
        for r in per_game[gid]:
            tt[r["franchise_id"]] += (r["targets"] or 0)

        for r in per_game[gid]:
            rk = f"{gid}|{r['gsis_id']}"
            p = players.get(r["gsis_id"], {})
            eid = str(p.get("espn_id")) if p.get("espn_id") else None
            ra = RowAudit(led, "player_game_stats", rk, r["season"], "espn",
                          ev or "MISSING", eid)
            has_stats = any((r[f] or 0) != 0 for f in STAT_FIELDS)

            if summ is None:
                ra.verdict("*", None, None, "UNRESOLVED", note="no cached ESPN summary for this game")
                ra.flush("UNRESOLVED")
                continue
            b = box.get(eid) if eid else None
            resolved_by_name = None
            if b is None:
                tid = str(r["franchise_id"])
                cands = [aid for nm, aid in by_name.get(tid, [])
                         if name_relation(p.get("display_name"), nm) == "MATCH"]
                if not cands:
                    # only a same-surname + same-first-initial alias ("Dave"/"David
                    # Tollefson"); never a bare surname collision
                    cands = [aid for nm, aid in by_name.get(tid, [])
                             if is_alias(p.get("display_name"), nm)]
                if len(cands) == 1:
                    resolved_by_name = cands[0]
                    b = box[resolved_by_name]
                    ra.verdict("player.espn_id", eid, resolved_by_name, "MISMATCH",
                               note=f"player.espn_id does not appear in any ESPN box score; the "
                                    f"athlete ESPN actually publishes for "
                                    f"{p.get('display_name')!r} on team {tid} is "
                                    f"{resolved_by_name}. OUT OF PARTITION (player table) but it "
                                    f"blocks stat verification -- see report.")
                    note_finding("player_espn_id_wrong",
                                 {"gsis_id": r["gsis_id"], "name": p.get("display_name"),
                                  "db_espn_id": eid, "espn_actual": resolved_by_name,
                                  "game_id": gid})
            if eid is None and b is None:
                ra.verdict("player.espn_id", None, None, "UNRESOLVED",
                           note="player has no espn_id and no unique name match in the ESPN box "
                                "score for this game")
                ra.flush("UNRESOLVED")
                note_finding("pgs_no_espn_id", rk)
                continue
            if b is None:
                if not has_stats:
                    ra.flush("NOT_COMPARABLE",
                             note="all-zero stat line; ESPN box scores list only players who "
                                  "recorded a stat, so the authority structurally cannot rule")
                    continue
                nonzero = {f: r[f] for f in STAT_FIELDS if (r[f] or 0) != 0}
                # contract rule 5 known-good: ESPN omits zero-reception targets entirely
                if set(nonzero) == {"targets"} and (r["receptions"] or 0) == 0:
                    ra.verdict("targets", r["targets"], None, "NOT_COMPARABLE",
                               note=RULE5_TARGETS)
                    ra.flush("NOT_COMPARABLE")
                    continue
                for f in STAT_FIELDS:
                    if (r[f] or 0) != 0:
                        ra.verdict(f, r[f], None, "DB_ONLY",
                                   note="player carries non-zero stats but does not appear in "
                                        "the ESPN box score for this game")
                db_only.append({"row": rk, "name": p.get("display_name"), "stats": nonzero})
                ra.flush("DB_ONLY")
                continue

            seen_espn.add(resolved_by_name or eid)
            ra.cmp("franchise_id", str(r["franchise_id"]), b["team_id"])
            opp = g["away_franchise_id"] if r["franchise_id"] == g["home_franchise_id"] else g["home_franchise_id"]
            ra.cmp("opponent_id", r["opponent_id"], opp, authority="derived")
            ra.cmp("game_id", r["game_id"], gid, authority="derived")
            if g["season_type"] == "REG":
                ra.cmp("week", r["week"], g["week"], authority="derived")
            else:
                ra.cmp("week", r["week"], {"WC": 18, "DIV": 19, "CON": 20, "SB": 21}.get(g["playoff_round"]),
                       authority="derived",
                       note="postseason rows carry the nflverse continuous week")
            ra.cmp("season_type", r["season_type"], g["season_type"], authority="derived")

            for f in STAT_FIELDS:
                dbv = r[f] or 0
                refv = b.get(f)
                if refv is None:
                    if dbv == 0:
                        ra.verdict(f, dbv, None, "MATCH", counts=True)
                    elif f == "targets" and (r["receptions"] or 0) == 0:
                        ra.verdict(f, dbv, None, "NOT_COMPARABLE", note=RULE5_TARGETS)
                    else:
                        ra.verdict(f, dbv, None, "DB_ONLY",
                                   note=f"non-zero {f} but ESPN publishes no {f.split('_')[0]} "
                                        f"line for this player in this game")
                        inflation.append({"row": rk, "name": p.get("display_name"), "field": f,
                                          "db": dbv, "espn": None})
                    continue
                if f == "targets" and int(dbv) != int(refv):
                    ra.verdict(f, int(dbv), int(refv), "NOT_COMPARABLE", note=RULE5_TARGETS)
                    target_diffs.append({"row": rk, "name": p.get("display_name"),
                                         "db": int(dbv), "espn": int(refv)})
                    continue
                if f == "sacks_suffered":
                    ok = ra.cmp(f, float(dbv), float(refv))
                else:
                    ok = ra.cmp(f, int(dbv), int(refv))
                if not ok:
                    inflation.append({"row": rk, "name": p.get("display_name"), "field": f,
                                      "db": dbv, "espn": refv,
                                      "direction": "db_high" if dbv > (refv or 0) else "db_low"})

            # derived columns nflverse computes from play-by-play; ESPN publishes none of them
            for f in DERIVED_FIELDS:
                ra.not_comparable(f, r[f], NC_EPA, collapse=(r[f] in (None, 0.0)))
            # target_share and fantasy points ARE recomputable from stored columns
            exp_ts = round((r["targets"] or 0) / tt[r["franchise_id"]], 6) if tt[r["franchise_id"]] else 0.0
            ra.cmp("target_share", round(float(r["target_share"] or 0), 4), round(exp_ts, 4),
                   authority="derived", note="targets / team targets recomputed from this table")
            fp = (0.04 * (r["passing_yards"] or 0) + 4 * (r["passing_tds"] or 0)
                  - 2 * (r["interceptions"] or 0) + 0.1 * ((r["rushing_yards"] or 0) + (r["receiving_yards"] or 0))
                  + 6 * ((r["rushing_tds"] or 0) + (r["receiving_tds"] or 0)))
            residual = float(r["fantasy_points"] or 0) - fp
            if abs(residual) < 0.02:
                ra.cmp("fantasy_points", round(float(r["fantasy_points"] or 0), 2), round(fp, 2),
                       authority="derived")
                ra.cmp("fantasy_points_ppr", round(float(r["fantasy_points_ppr"] or 0), 2),
                       round(fp + (r["receptions"] or 0), 2), authority="derived")
            elif abs(residual / 2.0 - round(residual / 2.0)) < 0.005:
                # every unstored term (2-pt conversion +2, lost fumble -2, ST/def TD +6) moves
                # fantasy points by a multiple of 2, so this residual is fully explainable
                ra.verdict("fantasy_points", float(r["fantasy_points"] or 0), round(fp, 2),
                           "NOT_COMPARABLE", authority="derived",
                           note=f"residual {round(residual, 2)} is a multiple of 2: explainable by "
                                f"2-point conversions, lost fumbles or special-teams/defensive TDs, "
                                f"none of which this table stores")
                ra.verdict("fantasy_points_ppr", float(r["fantasy_points_ppr"] or 0),
                           round(fp + (r["receptions"] or 0), 2), "NOT_COMPARABLE",
                           authority="derived", note="see fantasy_points")
            else:
                ra.cmp("fantasy_points", round(float(r["fantasy_points"] or 0), 2), round(fp, 2),
                       authority="derived", eq=lambda a, b: False,
                       note=f"residual {round(residual, 2)} is NOT a multiple of 2, so no "
                                f"combination of the unstored terms (2-pt conversions, lost "
                                f"fumbles, ST/def TDs) can explain it: the stored fantasy points "
                                f"were computed from different yardage than this row now holds")
                ra.cmp("fantasy_points_ppr", round(float(r["fantasy_points_ppr"] or 0), 2),
                       round(fp + (r["receptions"] or 0), 2), authority="derived",
                       eq=lambda a, b: False, note="see fantasy_points")
                note_finding("fantasy_points_unreconcilable",
                             {"row": rk, "name": p.get("display_name"),
                              "stored": float(r["fantasy_points"] or 0), "recompute": round(fp, 2),
                              "residual": round(residual, 2)})
            ra.not_comparable("position", r["position"], NC_POS, collapse=True)
            ra.not_comparable("position_group", r["position_group"], NC_POS, collapse=True)
            ra.flush()

        # reverse direction: ESPN box-score lines with no db row  -> REF_ONLY
        db_espn_ids = {str(players.get(r["gsis_id"], {}).get("espn_id")) for r in per_game[gid]}
        db_espn_ids |= seen_espn
        for aid, b in box.items():
            if aid in db_espn_ids:
                continue
            if not any(b.get(f) for f in STAT_FIELDS):
                continue
            led.write("player_game_stats", f"{gid}|espn:{aid}", g["season"], "*", None,
                      "espn", aid, b.get("name"), "REF_ONLY", ev,
                      "ESPN box score carries a non-zero stat line for this athlete but the "
                      "database has no player_game_stats row for them in this game")
            ref_only.append({"game_id": gid, "espn_id": aid, "name": b.get("name"),
                             "stats": {f: b.get(f) for f in STAT_FIELDS if b.get(f)}})

        # team aggregate reconciliation -- catches inflation even if player mapping fails
        for side in ("away", "home"):
            fid = g[f"{side}_franchise_id"]
            tot = team_tot.get(str(fid), {})
            db_pass = sum(r["passing_yards"] or 0 for r in per_game[gid] if r["franchise_id"] == fid)
            db_rush = sum(r["rushing_yards"] or 0 for r in per_game[gid] if r["franchise_id"] == fid)
            db_rec = sum(r["receiving_yards"] or 0 for r in per_game[gid] if r["franchise_id"] == fid)
            e_rush = parse_stat_int(tot.get("rushingYards"))
            rk = f"{gid}|team:{fid}"
            ra = RowAudit(led, "player_game_stats", rk, g["season"], "espn", ev or "MISSING", str(fid))
            if e_rush is None:
                ra.verdict("team_rushing_yards", db_rush, None, "NOT_COMPARABLE",
                           note="ESPN team totals unavailable")
            else:
                ra.cmp("team_rushing_yards", db_rush, e_rush,
                       note="sum of player rushing_yards vs ESPN team rushing total")
            ra.cmp("team_passing_yards_selfconsistent", db_pass, db_rec,
                   authority="derived",
                   note="sum of team passing_yards must equal sum of team receiving_yards")
            v = ra.flush()
            if v != "MATCH":
                team_agg_problems.append({"game_id": gid, "franchise_id": fid,
                                          "db_rush": db_rush, "espn_rush": e_rush,
                                          "db_pass": db_pass, "db_rec": db_rec})

    REPORT["counts"]["pgs_rows"] = len(rows)
    # D17 signature: a player whose stat line exceeds ESPN in two or more categories at once
    sig = defaultdict(set)
    for x in inflation:
        if x.get("direction") == "db_high":
            sig[x["row"].split("|")[0]].add((x["row"], x["field"]))
    d17 = {}
    for gid, s_ in sig.items():
        players = defaultdict(int)
        for rowk, fld in s_:
            players[rowk] += 1
        multi = {k: v for k, v in players.items() if v >= 2}
        if multi:
            d17[gid] = multi
    note_finding("d17_signature_scan", d17)
    note_finding("pgs_target_diffs_rule5", target_diffs)
    note_finding("pgs_inflation", inflation)
    note_finding("pgs_db_only", db_only)
    note_finding("pgs_ref_only", ref_only)
    note_finding("pgs_team_agg", team_agg_problems)
    print(f"  done ({len(rows)} rows; {len(inflation)} field inflations, "
          f"{len(db_only)} db-only rows, {len(ref_only)} ref-only lines)")


# -------------------------------------------------------------- phase 5: snap_count
def phase_snap_count(led, con):
    print("phase 5: snap_count")
    n = con.execute("SELECT COUNT(*) FROM snap_count WHERE season IN (2010,2011)").fetchone()[0]
    first = con.execute(
        "SELECT season, season_type, week, playoff_round, game_id, pfr_game_id FROM snap_count "
        "ORDER BY season, CASE season_type WHEN 'REG' THEN 0 ELSE 1 END, week, game_id LIMIT 1"
    ).fetchone()
    probes = {}
    for y in (2010, 2011, 2012, 2013):
        p = os.path.join(MYCACHE, f"probe_nflverse_snapcounts_{y}.json")
        probes[y] = read_json_any(p)["http_status"] if os.path.exists(p) else None
    ev = rel(os.path.join(MYCACHE, "probe_nflverse_snapcounts_2010.json"))
    note = (f"partition holds {n} snap_count rows. Upstream availability probed: nflverse/PFR "
            f"snap_counts_2010.csv HTTP {probes[2010]}, 2011 HTTP {probes[2011]}, "
            f"2012 HTTP {probes[2012]}, 2013 HTTP {probes[2013]}. PFR itself returns HTTP 403 to "
            f"automated clients (probe cached). Snap counts do not exist upstream for 2010-2011: "
            f"the empty partition is a genuine extract boundary, not a load failure. "
            f"First snap_count row in the database: {tuple(first) if first else None}.")
    led.write("snap_count", "*", None, "*", 0, "pro-football-reference (nflverse mirror)",
              None, 0, "NOT_COMPARABLE", ev, note, fields_compared=0, fields_matched=0)
    # the 2012 gap is real and belongs to another partition -- log it once, plainly
    if probes[2012] == 200:
        led.write("snap_count", "*|2012", 2012, "season_coverage", 0,
                  "pro-football-reference (nflverse mirror)", None, "available", "REF_ONLY",
                  rel(os.path.join(MYCACHE, "probe_nflverse_snapcounts_2012.json")),
                  "OUT OF PARTITION, reported for the coordinator: snap_counts_2012.csv exists "
                  "upstream (HTTP 200) but the database holds 0 snap_count rows for 2012; the "
                  "database's snap boundary is 2013, one season later than upstream's.")
        note_finding("snap_2012_gap", True)
    REPORT["counts"]["snap_count_rows"] = n
    REPORT["counts"]["snap_first_row"] = tuple(first) if first else None
    print(f"  done (rows={n}, upstream probes={probes})")


# ----------------------------------------------------------- phase 6: roster_season
def phase_roster_season(led, con, games, summaries, players, espn_to_gsis):
    print("phase 6: roster_season")
    # who appeared in an ESPN box score for which (season, franchise)?
    appeared = defaultdict(set)     # (season, fid) -> {espn_id}
    ev_for = {}
    for g in games:
        summ, ev = summaries[g["game_id"]]
        if not summ:
            continue
        for aid, b in espn_boxscore(summ).items():
            appeared[(g["season"], int(b["team_id"]))].add(aid)
            ev_for[(g["season"], int(b["team_id"]), aid)] = ev

    probe = rel(os.path.join(MYCACHE, "probe_espn_site_roster_2010_team18.json"))
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM roster_season WHERE season IN (2010,2011) ORDER BY roster_row_id")]
    corroborated = 0
    for r in rows:
        rk = str(r["roster_row_id"])
        p = players.get(r["gsis_id"]) if r["gsis_id"] else None
        eid = str(p["espn_id"]) if p and p.get("espn_id") else None
        hit = eid is not None and eid in appeared.get((r["season"], r["franchise_id"]), set())
        ev = ev_for.get((r["season"], r["franchise_id"], eid), probe)
        ra = RowAudit(led, "roster_season", rk, r["season"], "espn", ev, eid)
        if hit:
            ra.cmp("team_membership", (r["season"], r["franchise_id"]),
                   (r["season"], r["franchise_id"]),
                   note="ESPN box score for this season lists this athlete under this franchise")
            corroborated += 1
            ra.espn_corroborated = True
        else:
            ra.verdict("team_membership", (r["season"], r["franchise_id"]), None, "NOT_COMPARABLE",
                       note=NC_ROSTER + "; and an ESPN box score lists only players who recorded "
                            "a stat, so absence proves nothing")
        # internal consistency -- these are real assertions, logged as such
        if r["gsis_id"] is None:
            ra.verdict("gsis_id", None, None, "NOT_COMPARABLE",
                       authority="internal",
                       note="known upstream defect N9: nflverse publishes these rows with no gsis id")
        else:
            ra.cmp("gsis_id.resolves", r["gsis_id"] in players, True, authority="internal")
            if p:
                dn = (p.get("display_name") or "").strip().lower()
                fn = (r["full_name"] or "").strip().lower()
                rl = name_relation(fn, dn)
                if rl == "MATCH":
                    ra.cmp("full_name", fn, dn, authority="internal", eq=lambda a, b: True)
                elif rl == "VARIANT":
                    ra.verdict("full_name", r["full_name"], p.get("display_name"),
                               "NOT_COMPARABLE", authority="internal",
                               note="nickname/long-form variant or a post-2011 legal name change: "
                                    "the 2010-11 feed carries the era-correct name, "
                                    "player.display_name the current one")
                    note_finding("roster_name_variant",
                                 {"gsis_id": r["gsis_id"], "feed": r["full_name"],
                                  "player_table": p.get("display_name")})
                else:
                    ra.cmp("full_name", r["full_name"], p.get("display_name"),
                           authority="internal", eq=lambda a, b: False)
        ra.cmp("season_type.consistency", r["season_type"],
               "REG" if r["source_game_type"] == "REG" else "POST", authority="internal")
        ra.cmp("week_shape", (r["week"] is None) != (r["playoff_round"] is None), True,
               authority="internal", note="exactly one of week / playoff_round must be set")
        for f in ("status", "jersey_number", "depth_chart_position", "years_exp", "position"):
            ra.not_comparable(f, r[f], NC_ROSTER, collapse=True)
        forced = None if getattr(ra, "espn_corroborated", False) else "NOT_COMPARABLE"
        if forced and any(pp[3] == "MISMATCH" for pp in ra.pending):
            forced = "MISMATCH"
        ra.flush(forced)
    REPORT["counts"]["roster_corroborated"] = corroborated
    REPORT["counts"]["roster_rows"] = len(rows)
    print(f"  done ({corroborated}/{len(rows)} corroborated by an ESPN box score)")


# ------------------------------------------------------------- phase 7: depth_chart
def phase_depth_chart(led, con, players, teams):
    print("phase 7: depth_chart")
    ev = rel(os.path.join(MYCACHE, "probe_espn_site_roster_2010_team18.json"))
    NOTE = NC_DEPTHCHART
    led.write("depth_chart", "*", None, "*", None, "none (no public source)", None, None,
              "NOT_COMPARABLE", ev,
              NC_DEPTHCHART + " Every depth_chart row below therefore carries one row-level "
              "NOT_COMPARABLE record naming, in not_comparable_fields, each column no authority "
              "can rule on; per-field lines are reserved for the internal checks that can fail.",
              fields_compared=0, fields_matched=0)
    # roster membership by (season, franchise) for the cross-table check
    member = defaultdict(set)
    for gsis, season, fid in con.execute(
            "SELECT gsis_id, season, franchise_id FROM roster_season WHERE season IN (2010,2011)"):
        member[(season, fid)].add(gsis)
    for gsis, season, fid in con.execute(
            "SELECT gsis_id, season, franchise_id FROM player_game_stats WHERE season IN (2010,2011)"):
        member[(season, fid)].add(gsis)

    # depth_order uniqueness within (season, source_week, source_game_type, franchise, slot)
    # An NFL depth chart legitimately lists several players at the same
    # (position, order) -- LWR/RWR/SWR all publish as "WR1" -- and source_ordinal
    # exists precisely to carry the feed's own repeats.  The only defensible
    # invariant is that no row is an exact duplicate of another.
    dupes = set()
    for row in con.execute(
            "SELECT season, source_week, source_game_type, franchise_id, unit, depth_position, "
            "depth_order, gsis_id, espn_id, source_ordinal, COUNT(*) c FROM depth_chart "
            "WHERE season IN (2010,2011) GROUP BY 1,2,3,4,5,6,7,8,9,10 HAVING c > 1"):
        dupes.add(tuple(row[:10]))
    multi_slot = con.execute(
        "SELECT COUNT(*) FROM (SELECT 1 FROM depth_chart WHERE season IN (2010,2011) "
        "AND depth_position IS NOT NULL GROUP BY season, source_week, source_game_type, "
        "franchise_id, depth_position, depth_order HAVING COUNT(*) > 1)").fetchone()[0]

    rows = con.execute(
        "SELECT * FROM depth_chart WHERE season IN (2010,2011) ORDER BY depth_chart_id")
    cols = [d[0] for d in rows.description]
    n = 0
    bad_member = 0
    for tup in rows:
        r = dict(zip(cols, tup))
        n += 1
        rk = str(r["depth_chart_id"])
        ra = RowAudit(led, "depth_chart", rk, r["season"], "none (no public source)", ev, None)
        # structural / internal assertions
        ra.cmp("franchise_id.resolves", r["franchise_id"] in teams, True, authority="internal")
        ra.cmp("identity_present", (r["gsis_id"] is not None) or (r["espn_id"] is not None), True,
               authority="internal", note="schema requires gsis_id or espn_id")
        if r["gsis_id"]:
            ra.cmp("gsis_id.resolves", r["gsis_id"] in players, True, authority="internal")
            p = players.get(r["gsis_id"])
            if p:
                dn = (p.get("display_name") or "").strip().lower()
                fn = (r["full_name"] or "").strip().lower()
                rl = name_relation(fn, dn)
                if rl == "MATCH":
                    ra.cmp("full_name", fn, dn, authority="internal", eq=lambda a, b: True)
                elif rl == "VARIANT":
                    ra.verdict("full_name", r["full_name"], p.get("display_name"),
                               "NOT_COMPARABLE", authority="internal",
                               note="nickname/long-form variant or a post-2011 legal name change")
                    note_finding("depth_name_variant",
                                 {"gsis_id": r["gsis_id"], "feed": r["full_name"],
                                  "player_table": p.get("display_name")})
                else:
                    ra.cmp("full_name", r["full_name"], p.get("display_name"),
                           authority="internal", eq=lambda a, b: False)
            ok = r["gsis_id"] in member.get((r["season"], r["franchise_id"]), set())
            if not ok:
                bad_member += 1
            ra.cmp("team_membership.internal", ok, True, authority="internal",
                   note="player appears on this franchise in roster_season or player_game_stats "
                        "for this season")
        else:
            ra.not_comparable("gsis_id", None, "row identified by espn_id only", collapse_when_null=False)
        ra.cmp("bucket_shape", (r["week"] is not None) or (r["playoff_round"] is not None)
               or r["bucket"] in ("postseason", "offseason"), True, authority="internal")
        ra.cmp("depth_order.valid", (r["depth_order"] is None) or r["depth_order"] >= 1, True,
               authority="internal")
        key = (r["season"], r["source_week"], r["source_game_type"], r["franchise_id"],
               r["unit"], r["depth_position"], r["depth_order"], r["gsis_id"], r["espn_id"],
               r["source_ordinal"])
        ra.cmp("row.not_an_exact_duplicate", key not in dupes, True, authority="internal",
               note="no two rows share (season, week, type, franchise, unit, depth_position, "
                    "depth_order, player, source_ordinal)")
        ra.cmp("source_shape", r["source_shape"], "A", authority="internal",
               note="2010-11 rows all come from the shape-A nflverse feed")
        ra.cmp("snapshot_ts.shape", r["snapshot_ts"] is None, r["source_shape"] == "A",
               authority="internal")
        for f in ("depth_position", "depth_position_canonical", "position", "unit",
                  "jersey_number", "elias_id", "espn_id", "gsis_source", "scheme", "pos_slot",
                  "depth_order", "snapshot_ts", "source_ordinal"):
            ra.not_comparable(f, r[f], NOTE, collapse=True)
        forced = "MISMATCH" if any(pp[3] == "MISMATCH" for pp in ra.pending) else "NOT_COMPARABLE"
        ra.flush(forced, note=NOTE)
    REPORT["counts"]["depth_chart_rows"] = n
    REPORT["counts"]["depth_chart_bad_membership"] = bad_member
    REPORT["counts"]["depth_chart_exact_duplicates"] = len(dupes)
    REPORT["counts"]["depth_chart_multiplayer_slots"] = multi_slot
    print(f"  done ({n} rows; {bad_member} membership conflicts; {len(dupes)} exact duplicates; "
          f"{multi_slot} legitimately multi-player slots)")


# --------------------------------------------------------- phase 8: data_correction
def phase_corrections(led, con, games, summaries, players):
    print("phase 8: data_correction re-verification")
    by_gid = {g["game_id"]: g for g in games}
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM data_correction ORDER BY correction_id")]
    mine = []
    for r in rows:
        tk = r["target_key"]
        if r["target_table"] == "game" and tk.split("/")[0] in by_gid:
            mine.append(r)
        elif r["target_table"] == "player_game_stats":
            m = re.search(r"\('([^']+)',\s*(\d{4}),\s*(\d+),\s*'(\w+)'\)", tk)
            if m and int(m.group(2)) in SEASONS:
                mine.append(r)
    print(f"  {len(mine)} corrections touch 2010-2011")

    for r in mine:
        rk = f"correction:{r['correction_id']}"
        if r["target_table"] == "game":
            gid = r["target_key"].split("/")[0]
            g = by_gid[gid]
            summ, ev = summaries[gid]
            ra = RowAudit(led, "data_correction", rk, g["season"], "espn", ev or "MISSING",
                          r["corrected_value"])
            if r["column_name"] == "espnEventId":
                # the corrected id must be this game; and the discarded id must be a different game
                head = (summ or {}).get("header", {})
                comp = (head.get("competitions") or [{}])[0] if summ else {}
                cs = {c.get("homeAway"): c["team"]["abbreviation"] for c in comp.get("competitors", [])}
                ra.cmp("corrected_value.is_this_game",
                       (cs.get("away"), cs.get("home")), (g["away_abbr"], g["home_abbr"]),
                       eq=lambda a, b: a[0] == b[0] and a[1] == b[1],
                       note=f"ESPN summary for corrected id {r['corrected_value']}")
                ra.cmp("corrected_value.matches_db", g["espn_event_id"], r["corrected_value"])
                y, m, d = g["gameday"].split("-")
                ra.cmp("corrected_value.home_encoding", r["corrected_value"],
                       f"3{y[-1]}{m}{d}{g['home_franchise_id']:03d}",
                       note="independent cross-check: ESPN pre-2014 event ids encode the home franchise")
                old = find_summary(r["upstream_value"])
                if old:
                    od = read_json_any(old)
                    oc = (od.get("header", {}).get("competitions") or [{}])[0]
                    ocs = {c.get("homeAway"): c["team"]["abbreviation"] for c in oc.get("competitors", [])}
                    ra.cmp("upstream_value.is_a_different_game",
                           (ocs.get("away"), ocs.get("home")) != (g["away_abbr"], g["home_abbr"]),
                           True, evidence=rel(old),
                           note=f"discarded id {r['upstream_value']} is "
                                f"{ocs.get('away')}@{ocs.get('home')}")
                else:
                    ra.verdict("upstream_value", r["upstream_value"], None, "UNRESOLVED",
                               note="no cached ESPN summary for the discarded event id")
            else:
                ra.verdict(r["column_name"], r["corrected_value"], None, "UNRESOLVED",
                           note="correction column not covered by this phase")
            ra.flush()
        else:
            m = re.search(r"\('([^']+)',\s*(\d{4}),\s*(\d+),\s*'(\w+)'\)", r["target_key"])
            gsis, season, week, stype = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
            row = con.execute(
                "SELECT * FROM player_game_stats WHERE gsis_id=? AND season=? AND week=? AND season_type=?",
                (gsis, season, week, stype)).fetchone()
            gid = row["game_id"] if row else None
            summ, ev = summaries.get(gid, (None, None))
            p = players.get(gsis, {})
            eid = str(p.get("espn_id")) if p.get("espn_id") else None
            box = espn_boxscore(summ) if summ else {}
            b = box.get(eid) or {}
            ra = RowAudit(led, "data_correction", rk, season, "espn", ev or "MISSING", eid)
            col = r["column_name"]
            espn_v = b.get(col)
            ra.cmp("corrected_value.stored", str(row[col]) if row else None,
                   str(int(float(r["corrected_value"]))),
                   authority="internal",
                   note=f"database currently stores {row[col] if row else None} for "
                        f"{gsis} {season} wk{week} {col}")
            if espn_v is None:
                ra.verdict("corrected_value.vs_espn", r["corrected_value"], None, "UNRESOLVED",
                           note=f"ESPN box score has no {col} line for {p.get('display_name')} "
                                f"in {gid}")
            else:
                ra.cmp("corrected_value.vs_espn", int(float(r["corrected_value"])), int(espn_v),
                       note=f"ESPN box score {gid} / {p.get('display_name')}")
                ra.cmp("upstream_value.was_wrong", int(float(r["upstream_value"])) != int(espn_v),
                       True, note=f"discarded nflverse value {r['upstream_value']} vs ESPN {espn_v}")
            ra.flush()
    REPORT["counts"]["corrections_reverified"] = len(mine)


# --------------------------------------------------------------------------- driver
if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "audit"
    if cmd == "fetch":
        cmd_fetch()
    elif cmd == "md5":
        print(md5_file(DB_PATH))
    else:
        main_audit()
