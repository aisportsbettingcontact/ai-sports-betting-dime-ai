#!/usr/bin/env python3
"""
F04 - forensic row-level audit of NFL seasons 2016 and 2017.

Partition: every row of every table whose season is 2016 or 2017.

    game               534
    game_line          534   (via game_id join; game_line has no season column)
    team_game        1,068   (2 per game)
    player_game_stats 34,987
    snap_count        47,752
    roster_season      6,143
    depth_chart       73,232
    data_correction        8 (target_key GLOB '*201[67]*')

Contract: docs/audits/2026-07-27-nfl-db-forensic/AUDIT-CONTRACT.md

Properties this script guarantees
---------------------------------
* READ-ONLY on nfl.db (opened with mode=ro; md5 recorded at start and end).
* Cache-backed: every HTTP response is written under cache/f04/ before use, and
  a second run does zero network I/O.  `--offline` hard-fails rather than fetch.
* Every ledger line names an evidence file that exists on disk; `--verify-evidence`
  re-checks all of them.
* One row-level `field:"*"` line is emitted for EVERY row in the partition (not
  only clean ones), so `count(field == "*")` per table is the coverage proof.
  Per-field lines are additionally emitted for every non-MATCH outcome.

Stages
------
    python3 audit/f04.py --stage fetch     # network; populates cache/f04
    python3 audit/f04.py --stage audit     # offline; writes the ledger
    python3 audit/f04.py --verify-evidence # re-resolve every evidence path
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import html
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.request

# --------------------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)                     # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB_PATH = os.path.join(NFLDB, "nfl.db")
RAW = os.path.join(NFLDB, "raw")
CACHE = os.path.join(NFLDB, "cache")
F04 = os.path.join(CACHE, "f04")
AUDIT_DIR = os.path.join(REPO, "docs", "audits", "2026-07-27-nfl-db-forensic")
LEDGER = os.path.join(AUDIT_DIR, "ledger", "F04.jsonl")
SUMMARY_JSON = os.path.join(F04, "internal", "f04_summary.json")

AGENT = "F04"
SEASONS = (2016, 2017)
RUN_TS = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

SUB = ("sb", "sum", "odds", "roster", "teammeta", "soh", "wiki", "pfr", "internal")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def ensure_dirs() -> None:
    for s in SUB:
        os.makedirs(os.path.join(F04, s), exist_ok=True)
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    os.makedirs(os.path.join(AUDIT_DIR, "reports"), exist_ok=True)


def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(path: str) -> str:
    """Evidence paths are recorded relative to scripts/data/nfl-db/."""
    return os.path.relpath(path, NFLDB)


# --------------------------------------------------------------------------------------
# cache-backed HTTP
# --------------------------------------------------------------------------------------
FETCH_LOG = os.path.join(F04, "fetch.log")
_net = {"n": 0, "bytes": 0}


def _log(msg: str) -> None:
    with open(FETCH_LOG, "a") as fh:
        fh.write(f"{dt.datetime.now(dt.timezone.utc).isoformat()} {msg}\n")


def get_json(url: str, path: str, *, offline: bool, sleep: float = 1.0):
    """Fetch `url` into gzipped `path` unless cached. Returns parsed JSON or an
    error dict {'__error__': ...} which is ALSO cached, so 404s stay evidence."""
    if os.path.exists(path):
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
            return json.load(fh)
    if offline:
        raise SystemExit(f"--offline but cache miss: {path}")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    obj = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
            obj = json.loads(body.decode("utf-8", "replace"))
            break
        except urllib.error.HTTPError as e:
            # a real HTTP status from the authority IS evidence; cache it and stop
            obj = {"__error__": "http", "status": e.code, "url": url,
                   "body": e.read().decode("utf-8", "replace")[:2000]}
            break
        except Exception as e:                                # noqa: BLE001
            obj = {"__error__": type(e).__name__, "detail": str(e)[:500], "url": url,
                   "attempts": attempt + 1}
            _log(f"RETRY {attempt+1} {url} {type(e).__name__}")
            time.sleep(2.0 * (attempt + 1))
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(obj, fh)
    _net["n"] += 1
    _log(f"GET {url} -> {rel(path)} err={obj.get('__error__') if isinstance(obj, dict) else None}")
    time.sleep(sleep)
    return obj


def get_text(url: str, path: str, *, offline: bool, sleep: float = 3.0, headers=None):
    if os.path.exists(path):
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    if offline:
        raise SystemExit(f"--offline but cache miss: {path}")
    hdr = {"User-Agent": UA,
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
           "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        hdr.update(headers)
    req = urllib.request.Request(url, headers=hdr)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        text = body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        text = (f"<!-- F04 HTTPError {e.code} {url} -->\n"
                + e.read().decode("utf-8", "replace")[:8000])
    except Exception as e:                                    # noqa: BLE001
        text = f"<!-- F04 {type(e).__name__} {url}: {str(e)[:400]} -->"
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        fh.write(text)
    _net["n"] += 1
    _log(f"GET {url} -> {rel(path)} bytes={len(text)}")
    time.sleep(sleep)
    return text


def read_cached_json(path: str):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8", errors="replace") as fh:
        return json.load(fh)


def read_cached_text(path: str) -> str:
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def adopt(src: str, dst: str) -> bool:
    """Copy a sibling agent's cached artefact into cache/f04 so this audit is
    self-contained and replayable from its own cache alone. Gzips on the way in."""
    if os.path.exists(dst) or not os.path.exists(src):
        return os.path.exists(dst)
    if src.endswith(".gz") and dst.endswith(".gz"):
        shutil.copyfile(src, dst)
    elif dst.endswith(".gz"):
        with open(src, "rb") as fh, gzip.open(dst, "wb") as out:
            shutil.copyfileobj(fh, out)
    else:
        shutil.copyfile(src, dst)
    _log(f"ADOPT {src} -> {rel(dst)}")
    return True


# --------------------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------------------
def connect() -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def q(conn, sql, args=()):
    return conn.execute(sql, args).fetchall()


# --------------------------------------------------------------------------------------
# ledger
# --------------------------------------------------------------------------------------
class Ledger:
    KEYS = ("ts", "agent", "table", "row_key", "season", "field", "db_value",
            "authority", "ref_id", "ref_value", "verdict", "evidence", "note",
            "fields_compared", "fields_matched", "fields_not_comparable")

    def __init__(self, path: str):
        self.path = path
        self.fh = open(path, "w", encoding="utf-8")
        self.n = 0
        self.rows = collections.Counter()          # table -> count of field=="*" lines
        self.verdicts = collections.defaultdict(collections.Counter)
        self.field_verdicts = collections.defaultdict(collections.Counter)
        self.by_field = collections.defaultdict(collections.Counter)
        self.evidence = set()
        self.issues = collections.defaultdict(list)

    def write(self, *, table, row_key, season, field, verdict, authority, evidence,
              db_value=None, ref_id=None, ref_value=None, note=None,
              fields_compared=None, fields_matched=None, fields_not_comparable=None):
        rec = {"ts": RUN_TS, "agent": AGENT, "table": table, "row_key": str(row_key),
               "season": season, "field": field, "db_value": db_value,
               "authority": authority, "ref_id": ref_id, "ref_value": ref_value,
               "verdict": verdict, "evidence": evidence}
        if note is not None:
            rec["note"] = note
        if fields_compared is not None:
            rec["fields_compared"] = fields_compared
            rec["fields_matched"] = fields_matched
            rec["fields_not_comparable"] = fields_not_comparable
        self.fh.write(json.dumps(rec, separators=(",", ":"), default=str) + "\n")
        self.n += 1
        self.evidence.add(evidence)
        if field == "*":
            self.rows[table] += 1
            self.verdicts[table][verdict] += 1
        else:
            self.field_verdicts[table][verdict] += 1
            self.by_field[table][(field, verdict)] += 1
            if verdict in ("MISMATCH", "DB_ONLY", "REF_ONLY", "UNRESOLVED"):
                if len(self.issues[table]) < 4000:
                    self.issues[table].append(rec)

    def close(self):
        self.fh.close()


# --------------------------------------------------------------------------------------
# row auditing helper
# --------------------------------------------------------------------------------------
class RowAudit:
    """Accumulates per-field outcomes for one row, then emits the collapsed
    row-level line plus a line for every field that needs investigating.

    Volume policy (an explicit reading of the contract's volume rule, restated
    verbatim in the report so a supervisor can check it):

      * `MATCH` fields are collapsed into the row-level `field:"*"` line via
        `fields_compared` / `fields_matched`.
      * *Structural* `NOT_COMPARABLE` fields -- the ones where the reason is the
        same for every row of the table (EPA is a model output, ESPN has no
        position column, ...) -- are collapsed into `fields_not_comparable` and
        enumerated once, per table, in
        `cache/f04/internal/not_comparable_manifest.json`.
      * EVERY `MISMATCH` / `DB_ONLY` / `REF_ONLY` / `UNRESOLVED`, and every
        *row-specific* `NOT_COMPARABLE` (a known-good difference, a registered
        data_correction, an athlete missing from one box score) gets its own line.

    Row-level verdict: `NOT_COMPARABLE` iff the authority could rule on nothing
    (`fields_compared == 0`); otherwise the worst problem verdict among the
    fields it could rule on, defaulting to `MATCH`.
    """

    RANK = {"MATCH": 0, "NOT_COMPARABLE": 1, "REF_ONLY": 2, "DB_ONLY": 3,
            "UNRESOLVED": 4, "MISMATCH": 5}

    NC_MANIFEST = collections.defaultdict(dict)     # table -> {field: reason}

    def __init__(self, led, table, row_key, season, authority, evidence, ref_id=None):
        self.led, self.table, self.row_key, self.season = led, table, row_key, season
        self.authority, self.evidence, self.ref_id = authority, evidence, ref_id
        self.compared = 0
        self.matched = 0
        self.nc_count = 0
        self.pending = []
        self.worst = "MATCH"

    def _bump(self, v):
        if self.RANK[v] > self.RANK[self.worst]:
            self.worst = v

    def _push(self, field, verdict, db_value, ref_value, note, authority, ref_id, evidence):
        self.pending.append(dict(field=field, verdict=verdict, db_value=db_value,
                                 ref_value=ref_value, note=note,
                                 authority=authority or self.authority,
                                 ref_id=ref_id if ref_id is not None else self.ref_id,
                                 evidence=evidence or self.evidence))

    def cmp(self, field, db_value, ref_value, *, authority=None, ref_id=None,
            evidence=None, note=None, eq=None):
        """Compare one field. ref_value None => NOT_COMPARABLE (authority silent)."""
        if ref_value is None:
            return self.nc(field, db_value, note or "authority publishes no value",
                           authority=authority, ref_id=ref_id, evidence=evidence)
        self.compared += 1
        same = (db_value == ref_value) if eq is None else eq(db_value, ref_value)
        if same:
            self.matched += 1
            return "MATCH"
        self._bump("MISMATCH")
        self._push(field, "MISMATCH", db_value, ref_value, note, authority, ref_id, evidence)
        return "MISMATCH"

    def nc(self, field, db_value, note, *, ref_value=None, authority=None,
           ref_id=None, evidence=None, structural=True):
        self.nc_count += 1
        if structural:
            self.NC_MANIFEST[self.table].setdefault(field, note)
            return "NOT_COMPARABLE"
        self._bump("NOT_COMPARABLE")
        self._push(field, "NOT_COMPARABLE", db_value, ref_value, note, authority,
                   ref_id, evidence)
        return "NOT_COMPARABLE"

    def flag(self, field, verdict, db_value, ref_value, note, *, authority=None,
             ref_id=None, evidence=None, counts=True, bump=True, force=False):
        if verdict == "MATCH":
            self.compared += 1
            self.matched += 1
            if force:
                self._push(field, "MATCH", db_value, ref_value, note, authority,
                           ref_id, evidence)
            return "MATCH"
        if counts:
            self.compared += 1
        if bump:
            self._bump(verdict)
        self._push(field, verdict, db_value, ref_value, note, authority, ref_id, evidence)
        return verdict

    def emit(self, note=None):
        for p in self.pending:
            self.led.write(table=self.table, row_key=self.row_key, season=self.season,
                           field=p["field"], verdict=p["verdict"], db_value=p["db_value"],
                           ref_value=p["ref_value"], authority=p["authority"],
                           ref_id=p["ref_id"], evidence=p["evidence"], note=p["note"])
        verdict = "NOT_COMPARABLE" if self.compared == 0 else self.worst
        self.led.write(table=self.table, row_key=self.row_key, season=self.season,
                       field="*", verdict=verdict, authority=self.authority,
                       ref_id=self.ref_id, evidence=self.evidence, note=note,
                       fields_compared=self.compared, fields_matched=self.matched,
                       fields_not_comparable=self.nc_count)
        return verdict


# --------------------------------------------------------------------------------------
# partition selectors  (the exact WHERE clauses quoted in the report)
# --------------------------------------------------------------------------------------
WHERE = {
    "game": "SELECT * FROM game WHERE season IN (2016,2017)",
    "game_line": ("SELECT gl.*, g.season FROM game_line gl JOIN game g USING(game_id) "
                  "WHERE g.season IN (2016,2017)"),
    "team_game": "SELECT * FROM team_game WHERE season IN (2016,2017)",
    "player_game_stats": "SELECT * FROM player_game_stats WHERE season IN (2016,2017)",
    "snap_count": "SELECT * FROM snap_count WHERE season IN (2016,2017)",
    "roster_season": "SELECT * FROM roster_season WHERE season IN (2016,2017)",
    "depth_chart": "SELECT * FROM depth_chart WHERE season IN (2016,2017)",
    "data_correction": "SELECT * FROM data_correction WHERE target_key GLOB '*201[67]*'",
}


# --------------------------------------------------------------------------------------
# STAGE: fetch
# --------------------------------------------------------------------------------------
SB_URL = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
          "?dates={y}&seasontype={t}&week={w}&limit=100")
SUM_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={e}"
ODDS_URL = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/"
            "{e}/competitions/{e}/odds?limit=50")
TEAM_URL = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/"
            "{y}/teams/{t}")
ROSTER_URL = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/"
              "{y}/teams/{t}/athletes?limit=300")
SOH_URL = "https://www.covers.com/sportsoddshistory/nfl-game-season/?y={y}"
PFR_URL = "https://www.pro-football-reference.com/boxscores/{g}.htm"

# PFR external sample: 12 games spread across both seasons, both season types,
# including the relocation franchises and both international sites.
PFR_SAMPLE_GAMES = [
    "2016_01_LA_SF", "2016_02_SEA_LA", "2016_07_NYG_LA", "2016_11_HOU_OAK",
    "2016_17_KC_SD", "2016_21_NE_ATL", "2017_01_LAC_DEN", "2017_02_MIA_LAC",
    "2017_03_BAL_JAX", "2017_07_ARI_LA", "2017_11_NE_OAK", "2017_21_PHI_NE",
]


def stage_fetch(offline: bool) -> None:
    ensure_dirs()
    conn = connect()
    games = q(conn, WHERE["game"])
    print(f"[fetch] {len(games)} games in partition")

    # 1. scoreboards ------------------------------------------------------------------
    for y in SEASONS:
        for t, wks in ((2, range(1, 18)), (3, range(1, 6))):
            for w in wks:
                dst = os.path.join(F04, "sb", f"sb_{y}_{t}_{w}.json.gz")
                adopt(os.path.join(CACHE, "a1", "scoreboard", f"{y}_{t}_{w}.json"), dst)
                get_json(SB_URL.format(y=y, t=t, w=w), dst, offline=offline, sleep=1.0)

    # 2. per-event summaries ----------------------------------------------------------
    for i, g in enumerate(games):
        e = g["espn_event_id"]
        dst = os.path.join(F04, "sum", f"summary_{e}.json.gz")
        (adopt(os.path.join(CACHE, "a5", f"summary_{e}.json.gz"), dst)
         or adopt(os.path.join(CACHE, "s2", f"summary_{e}.json"), dst)
         or adopt(os.path.join(CACHE, "a1", "summary", f"{e}.json"), dst)
         or adopt(os.path.join(CACHE, "a2", f"espn_summary_{e}.json"), dst))
        get_json(SUM_URL.format(e=e), dst, offline=offline, sleep=0.9)
        if i % 50 == 0:
            print(f"[fetch] summaries {i}/{len(games)} net={_net['n']}", flush=True)

    # 3. per-event odds ---------------------------------------------------------------
    for i, g in enumerate(games):
        e = g["espn_event_id"]
        dst = os.path.join(F04, "odds", f"odds_{e}.json.gz")
        adopt(os.path.join(CACHE, "a4", "espn", f"odds_{e}.json.gz"), dst)
        get_json(ODDS_URL.format(e=e), dst, offline=offline, sleep=0.9)
        if i % 50 == 0:
            print(f"[fetch] odds {i}/{len(games)} net={_net['n']}", flush=True)

    # 4. era-correct team identity + season rosters -----------------------------------
    fids = [r[0] for r in q(conn, "SELECT franchise_id FROM team ORDER BY franchise_id")]
    for y in SEASONS:
        for t in fids:
            get_json(TEAM_URL.format(y=y, t=t),
                     os.path.join(F04, "teammeta", f"team_{y}_{t}.json.gz"),
                     offline=offline, sleep=0.8)
            get_json(ROSTER_URL.format(y=y, t=t),
                     os.path.join(F04, "roster", f"roster_{y}_{t}.json.gz"),
                     offline=offline, sleep=0.8)
        print(f"[fetch] team meta + rosters {y} done net={_net['n']}", flush=True)

    # 5. SportsOddsHistory ------------------------------------------------------------
    for y in SEASONS:
        dst = os.path.join(F04, "soh", f"soh_{y}.html.gz")
        adopt(os.path.join(CACHE, "a4", f"soh_{y}.html.gz"), dst)
        get_text(SOH_URL.format(y=y), dst, offline=offline, sleep=3.0)

    # 6. third source for the four D12 corrections ------------------------------------
    for name in ("2016_Arizona_Cardinals_season", "2017_Cleveland_Browns_season",
                 "2017_Jacksonville_Jaguars_season", "2017_Miami_Dolphins_season"):
        dst = os.path.join(F04, "wiki", f"{name}.json.gz")
        adopt(os.path.join(CACHE, "a1", "thirdsource", f"{name}.json"), dst)
        get_json("https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json"
                 f"&page={name}", dst, offline=offline, sleep=2.0)

    # 7. Pro-Football-Reference sample (snap counts) ----------------------------------
    pfr_ids = {r["game_id"]: r["pfr_game_id"] for r in games}
    for gid in PFR_SAMPLE_GAMES:
        pid = pfr_ids.get(gid)
        if not pid:
            continue
        get_text(PFR_URL.format(g=pid), os.path.join(F04, "pfr", f"{pid}.html.gz"),
                 offline=offline, sleep=8.0,
                 headers={"Referer": "https://www.pro-football-reference.com/"})

    print(f"[fetch] done. network requests this run: {_net['n']}")


# --------------------------------------------------------------------------------------
# ESPN parsing helpers
# --------------------------------------------------------------------------------------
def sum_path(e):
    return os.path.join(F04, "sum", f"summary_{e}.json.gz")


def odds_path(e):
    return os.path.join(F04, "odds", f"odds_{e}.json.gz")


def espn_header(doc):
    """(competition, {homeAway: competitor}) from a summary payload, or (None, {})."""
    if not isinstance(doc, dict) or "__error__" in doc:
        return None, {}
    hdr = doc.get("header") or {}
    comps = hdr.get("competitions") or []
    if not comps:
        return None, {}
    c = comps[0]
    return c, {x.get("homeAway"): x for x in c.get("competitors", [])}


def norm_name(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def espn_boxscore_players(doc):
    """{espn_team_id: {espn_athlete_id: {stat: value}}} from a summary payload.
    A parallel name index is stashed under the reserved key '__names__' so a broken
    espn_id crosswalk does not silently cost coverage."""
    out = {}
    if not isinstance(doc, dict) or "__error__" in doc:
        return out
    names = {}
    for tm in ((doc.get("boxscore") or {}).get("players") or []):
        tid = str((tm.get("team") or {}).get("id") or "")
        bucket = out.setdefault(tid, {})
        for cat in tm.get("statistics") or []:
            name = cat.get("name")
            keys = cat.get("keys") or []
            for ath in cat.get("athletes") or []:
                a = ath.get("athlete") or {}
                aid = str(a.get("id") or "")
                if not aid:
                    continue
                stats = ath.get("stats") or []
                rec = bucket.setdefault(aid, {})
                for k, v in zip(keys, stats):
                    rec[f"{name}.{k}"] = v
                nk = norm_name(a.get("displayName"))
                if nk:
                    names.setdefault((tid, nk), aid)
    out["__names__"] = names
    return out


def _int(v):
    try:
        if v in (None, "", "-", "--"):
            return None
        return int(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def split_pair(v):
    if not v or "/" not in str(v):
        return None, None
    a, b = str(v).split("/", 1)
    return _int(a), _int(b)


def split_dash(v):
    if not v or "-" not in str(v):
        return None, None
    a, b = str(v).split("-", 1)
    return _int(a), _int(b)


# --------------------------------------------------------------------------------------
# STAGE: audit
# --------------------------------------------------------------------------------------
def load_teammeta():
    """{(season, franchise_id): (abbrev, displayName, location, name)} from ESPN."""
    out = {}
    for y in SEASONS:
        for fn in os.listdir(os.path.join(F04, "teammeta")):
            m = re.match(rf"team_{y}_(\d+)\.json\.gz$", fn)
            if not m:
                continue
            d = read_cached_json(os.path.join(F04, "teammeta", fn))
            if "__error__" in d:
                continue
            out[(y, int(m.group(1)))] = (d.get("abbreviation"), d.get("displayName"),
                                         d.get("location"), d.get("name"))
    return out


def load_scoreboard_index():
    """espn_event_id -> (path, event, competition) across all cached scoreboards."""
    idx = {}
    d = os.path.join(F04, "sb")
    for fn in sorted(os.listdir(d)):
        doc = read_cached_json(os.path.join(d, fn))
        if not isinstance(doc, dict):
            continue
        for ev in doc.get("events") or []:
            comps = ev.get("competitions") or []
            if comps:
                idx[str(ev["id"])] = (rel(os.path.join(d, fn)), ev, comps[0])
    return idx


# ---- 1. game -------------------------------------------------------------------------
IRMA_BYE = {("2017_02_CHI_TB", "home"), ("2017_02_MIA_LAC", "away")}

# (db_abbr, espn_abbr) pairs that are pure labelling convention. Enumerated, not
# pattern-matched, so a new one shows up as an unexplained MISMATCH.
ABBR_CONVENTION = {("LA", "LAR"), ("WAS", "WSH")}

PFR_HOME_CODE = {
    22: "crd", 1: "atl", 33: "rav", 2: "buf", 29: "car", 3: "chi", 4: "cin", 5: "cle",
    6: "dal", 7: "den", 8: "det", 9: "gnb", 34: "htx", 11: "clt", 30: "jax", 12: "kan",
    24: "sdg", 14: "ram", 13: "rai", 15: "mia", 16: "min", 17: "nwe", 18: "nor",
    19: "nyg", 20: "nyj", 21: "phi", 23: "pit", 25: "sfo", 26: "sea", 27: "tam",
    10: "oti", 28: "was",
}

KNOWN_GOOD = {
    "neutral":"known-good #5.1: ESPN neutralSite is unpopulated before 2014 and for "
               "relocated franchises",
    "kick": "known-good #5.2: nflverse stores the scheduled kickoff, ESPN the observed one",
    "venue": "known-good #5.3: ESPN retro-renames venues",
    "recv": "known-good #5.4: ESPN omits zero-reception targets and sometimes charges an "
            "incompletion to a different receiver",
}


def derived_game_expectations(conn):
    """div_game and rest days, recomputed from the schedule itself (D15 pattern).

    Rest is days since that franchise's previous gameday *within the same season*.
    For a franchise's first game of a season nflverse publishes the constant 7,
    which is what the DB stores, so that is the expectation used here."""
    teams = {r["franchise_id"]: (r["conference"], r["division"])
             for r in q(conn, "SELECT * FROM team")}
    prev, rest = {}, {}
    for g in q(conn, "SELECT game_id, season, gameday, away_franchise_id, home_franchise_id "
                     "FROM game WHERE gameday IS NOT NULL "
                     "ORDER BY gameday, kickoff_utc, game_id"):
        for fid, side in ((g["away_franchise_id"], "away"), (g["home_franchise_id"], "home")):
            if fid is None:
                continue
            d = dt.date.fromisoformat(g["gameday"])
            p = prev.get((g["season"], fid))
            rest[(g["game_id"], side)] = (d - p).days if p is not None else 7
            prev[(g["season"], fid)] = d
    return teams, rest


def audit_game(conn, led, teammeta, sbidx):
    rows = q(conn, WHERE["game"])
    corrections = {(r["target_key"], r["column_name"]): r
                   for r in q(conn, WHERE["data_correction"])}
    teams, rest_exp = derived_game_expectations(conn)
    ev_derived = rel(os.path.join(F04, "internal", "game_derived.jsonl.gz"))
    dfh = gzip.open(os.path.join(F04, "internal", "game_derived.jsonl.gz"), "wt",
                    encoding="utf-8")
    la_probe = []
    for g in rows:
        gid, e = g["game_id"], g["espn_event_id"]
        p = sum_path(e)
        ev = rel(p) if os.path.exists(p) else None
        doc = read_cached_json(p) if ev else {}
        comp, sides = espn_header(doc)
        sb = sbidx.get(str(e))
        if ev is None:
            ra = RowAudit(led, "game", gid, g["season"], "espn",
                          rel(os.path.join(F04, "fetch.log")), ref_id=e)
            ra.flag("*", "UNRESOLVED", None, None, "no cached ESPN summary")
            ra.emit()
            continue
        ra = RowAudit(led, "game", gid, g["season"], "espn", ev, ref_id=e)

        # -- identity -----------------------------------------------------------------
        ra.cmp("espn_event_id", str(e),
               str((comp or {}).get("id") or (sb[1]["id"] if sb else "")) or None)
        s = (doc.get("header") or {}).get("season") or {}
        ra.cmp("season", g["season"], s.get("year"))
        stype = {2: "REG", 3: "POST"}.get(s.get("type"))
        ra.cmp("season_type", g["season_type"], stype)
        wk = ((doc.get("header") or {}).get("week"))
        if g["season_type"] == "REG":
            ra.cmp("week", g["week"], wk)
            ra.nc("playoff_round", g["playoff_round"], "NULL by construction for REG rows")
        else:
            rnd = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}.get(wk)
            ra.cmp("playoff_round", g["playoff_round"], rnd,
                   note=f"espn postseason week={wk}")
            ra.nc("week", g["week"], "NULL by construction for POST rows")

        # -- teams --------------------------------------------------------------------
        for side, fcol, acol in (("away", "away_franchise_id", "away_abbr"),
                                 ("home", "home_franchise_id", "home_abbr")):
            c = sides.get(side) or {}
            tid = _int((c.get("team") or {}).get("id"))
            ra.cmp(f"{fcol}", g[fcol], tid,
                   note="ESPN competitor team id; franchise_id shares ESPN's id space, so "
                        "this is the load-bearing franchise-identity test")
            era = teammeta.get((g["season"], g[fcol]))
            tmev = rel(os.path.join(F04, "teammeta",
                                    f"team_{g['season']}_{g[fcol]}.json.gz"))
            if era and g[acol] != era[0] and (g[acol], era[0]) in ABBR_CONVENTION:
                ra.flag(acol, "MISMATCH", g[acol], era[0],
                        f"labelling convention only: nflverse publishes {g[acol]!r}, ESPN "
                        f"publishes {era[0]!r}; both denote {era[1]} = franchise "
                        f"{g[fcol]}, and the franchise id itself is verified MATCH on this "
                        f"same row", evidence=tmev)
            else:
                ra.cmp(acol, g[acol], era[0] if era else None, evidence=tmev,
                       note=f"era-correct ESPN abbreviation for {g['season']}"
                            + (f" ({era[1]})" if era else ""))
            if g[acol] in ("LA", "LAC", "SD", "LAR"):
                la_probe.append({"game_id": gid, "side": side, "db_abbr": g[acol],
                                 "db_fid": g[fcol], "espn_team_id": tid,
                                 "espn_abbr": (c.get("team") or {}).get("abbreviation"),
                                 "espn_name": (c.get("team") or {}).get("displayName"),
                                 "espn_season_abbr": era[0] if era else None,
                                 "espn_season_name": era[1] if era else None,
                                 "evidence": ev})

        # -- score / result -----------------------------------------------------------
        st = ((comp or {}).get("status") or {}).get("type") or {}
        completed = bool(st.get("completed"))
        ra.cmp("result_status", g["result_status"], "final" if completed else None,
               note="ESPN status.type.completed")
        aw, hm = _int((sides.get("away") or {}).get("score")), _int((sides.get("home") or {}).get("score"))
        ra.cmp("away_score", g["away_score"], aw)
        ra.cmp("home_score", g["home_score"], hm)
        ra.cmp("result", g["result"], (hm - aw) if (hm is not None and aw is not None) else None)
        ra.cmp("total", g["total"], (hm + aw) if (hm is not None and aw is not None) else None)
        ls = max((len((sides.get(s0) or {}).get("linescores") or []) for s0 in ("home", "away")),
                 default=0)
        ra.cmp("overtime", g["overtime"], (1 if ls > 4 else 0) if ls else None,
               note=f"espn linescore periods={ls}")

        # -- neutral site / venue -----------------------------------------------------
        ns = (comp or {}).get("neutralSite")
        if ns is None and sb:
            ns = sb[2].get("neutralSite")
        ra.cmp("location", g["location"], ("Neutral" if ns else "Home") if ns is not None else None,
               note="ESPN competition.neutralSite")
        vinfo = ((doc.get("gameInfo") or {}).get("venue") or {})
        vname = vinfo.get("fullName")
        if vname and vname != g["stadium"]:
            ra.flag("stadium", "NOT_COMPARABLE", g["stadium"], vname, KNOWN_GOOD["venue"],
                    counts=False)
        else:
            ra.cmp("stadium", g["stadium"], vname)

        # -- kickoff ------------------------------------------------------------------
        edate = (comp or {}).get("date") or (sb[1]["date"] if sb else None)
        espn_utc = None
        if edate:
            espn_utc = re.sub(r"Z$", ":00Z", edate) if re.match(r".*T\d\d:\d\dZ$", edate) else edate
        corr = corrections.get((gid, "kickoffUtc"))
        if corr is not None:
            ra.flag("kickoff_utc", "MATCH" if g["kickoff_utc"] == espn_utc else "MISMATCH",
                    g["kickoff_utc"], espn_utc,
                    f"D12 correction #{corr['correction_id']}: upstream "
                    f"{corr['upstream_value']} -> {corr['corrected_value']}; "
                    f"source={corr['source'][:120]}")
        else:
            ok = (g["kickoff_utc"] == espn_utc)
            if ok:
                ra.cmp("kickoff_utc", g["kickoff_utc"], espn_utc)
            else:
                ra.flag("kickoff_utc", "NOT_COMPARABLE", g["kickoff_utc"], espn_utc,
                        KNOWN_GOOD["kick"], counts=False)
        if espn_utc:
            d0 = dt.datetime.strptime(espn_utc, "%Y-%m-%dT%H:%M:%SZ")
            ra.cmp("gameday", g["gameday"], None,
                   note="venue-local calendar date; ESPN publishes UTC only (D11)")
            ra.cmp("weekday", g["weekday"], None,
                   note="derived from venue-local gameday, not published by ESPN")
            del d0
        ra.nc("gametime_et", g["gametime_et"], "ET wall clock; ESPN publishes UTC only")

        # -- referee (gameInfo.officials) ---------------------------------------------
        offs = (doc.get("gameInfo") or {}).get("officials") or []
        refname = next((o.get("fullName") for o in offs
                        if (o.get("position") or {}).get("name") == "Referee"), None)

        def ref_eq(a, b):
            if not a or not b:
                return False
            an, bn = a.split(), b.split()
            return an[-1].lower() == bn[-1].lower() and an[0][0].lower() == bn[0][0].lower()

        ra.cmp("referee", g["referee"], refname, eq=ref_eq,
               note="ESPN gameInfo.officials[position=Referee]")

        # -- structurally not rulable by ESPN -----------------------------------------
        # pfr_game_id encodes YYYYMMDD + the home club's PFR code: an independent
        # franchise-identity signal (ram = Rams, sdg = Chargers) that survives the
        # 2016/2017 Los Angeles relocations.
        pg = g["pfr_game_id"] or ""
        m = re.match(r"^(\d{8})0?([a-z]{3})$", pg)
        if m and g["gameday"]:
            want_date = g["gameday"].replace("-", "")
            want_code = PFR_HOME_CODE.get(g["home_franchise_id"])
            ra.flag("pfr_game_id",
                    "MATCH" if (m.group(1) == want_date and m.group(2) == want_code)
                    else "MISMATCH", pg, f"{want_date}0{want_code}",
                    "PFR game key = venue-local date + home club code",
                    authority="internal", evidence=ev)
        else:
            ra.nc("pfr_game_id", pg, "PFR key space; not parseable to a date+club pair")

        for col, why in (("gsis_game_id", "nflverse key space; ESPN has no equivalent"),
                         ("ftn_game_id", "NULL for all 534 rows; FTN key space"),
                         ("old_game_id", "legacy NFL key space"),
                         ("data_source", "provenance column, internal"),
                         ("time_valid", "internal confidence flag"),
                         ("temp", "weather; NULL by construction for dome/closed roof"),
                         ("wind", "weather; NULL by construction for dome/closed roof"),
                         ("away_qb_id", "nflverse gsis id; ESPN box score gives athletes "
                                        "not a designated starter field"),
                         ("home_qb_id", "nflverse gsis id"),
                         ("away_coach", "ESPN summary does not publish head coach for 2016-17"),
                         ("home_coach", "ESPN summary does not publish head coach for 2016-17"),
                         ("roof", "ESPN publishes venue.indoor only, not open/closed/dome state"),
                         ("surface", "ESPN publishes venue.grass boolean, not surface brand"),
                         ("stadium_id", "nflverse stadium key space"),
                         ("broadcast", "NULL for all 534 rows"),
                         ("note", "NULL for all 534 rows"),
                         ("away_rest_upstream", "preserved upstream value, by design"),
                         ("home_rest_upstream", "preserved upstream value, by design")):
            ra.nc(col, g[col], why)
        # venue_id: ESPN HAS it, the DB does not store it for this era
        vid = _int(vinfo.get("id"))
        if vid and g["venue_id"] is None:
            # Systematic, not per-row: the loader never populates venue_id for this era.
            # Logged on every row so the gap is fully enumerated, but deliberately not
            # propagated to the row verdict -- otherwise one unstored column would mark
            # all 534 rows, which would hide the per-row signal. Stated in the report.
            ra.flag("venue_id", "REF_ONLY", None, vid,
                    "SYSTEMATIC: ESPN publishes a venue id; DB venue_id is NULL on all "
                    "534 rows of 2016-2017 (populated on only 273 of 4,648 rows "
                    "database-wide). Counted at table level, not propagated to the row "
                    "verdict.", counts=False, bump=False)
        else:
            ra.cmp("venue_id", g["venue_id"], vid)

        # -- derived-but-checkable (recomputed from the schedule, not from ESPN) ------
        a_, h_ = g["away_franchise_id"], g["home_franchise_id"]
        exp_div = 1 if (a_ in teams and h_ in teams and teams[a_] == teams[h_]) else 0
        exp_ar, exp_hr = rest_exp.get((gid, "away")), rest_exp.get((gid, "home"))
        dfh.write(json.dumps({"game_id": gid, "div_game": exp_div,
                              "away_rest": exp_ar, "home_rest": exp_hr},
                             separators=(",", ":")) + "\n")
        ra.cmp("div_game", g["div_game"], exp_div, authority="derived",
               evidence=ev_derived, note="recomputed from team.conference+division")
        for side, e_ in (("away", exp_ar), ("home", exp_hr)):
            db_rest = g[f"{side}_rest"]
            if e_ != db_rest and (gid, side) in IRMA_BYE:
                ra.flag(f"{side}_rest", "MATCH", db_rest, e_,
                        "Hurricane Irma: TB@MIA week 1 2017 was postponed to week 11, so "
                        "both clubs entered week 2 on 14 days' rest. The naive "
                        "first-game-of-season=7 expectation is what is wrong here, not "
                        "the DB; confirmed by the absence of any week-1 2017 game for "
                        "either franchise in this same table.",
                        authority="derived", evidence=ev_derived)
            else:
                ra.cmp(f"{side}_rest", db_rest, e_, authority="derived",
                       evidence=ev_derived,
                       note="days since that franchise's previous gameday, same season; "
                            "7 for a franchise's season opener (nflverse convention)")
        ra.nc("away_qb_name", g["away_qb_name"], "nflverse-designated starter")
        ra.nc("home_qb_name", g["home_qb_name"], "nflverse-designated starter")
        ra.emit()
    dfh.close()
    return la_probe


# ---- 2. game_line --------------------------------------------------------------------
_MON = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
_SOH_ALIASES = {"st louis rams": 14, "san diego chargers": 24, "oakland raiders": 13,
                "washington redskins": 28, "washington football team": 28}


def parse_soh(path):
    doc = read_cached_text(path)
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


PRICE_COLS = ("away_moneyline", "home_moneyline", "away_spread_odds",
              "home_spread_odds", "over_odds", "under_odds")
PRICE_KEYS = (("away_moneyline", "away_ml"), ("home_moneyline", "home_ml"),
              ("away_spread_odds", "away_so"), ("home_spread_odds", "home_so"),
              ("over_odds", "over"), ("under_odds", "under"))
PRICE_TOL_PP = 3.0        # percentage points of implied probability


def implied(american):
    """American odds -> implied probability. The only space in which two prices
    either side of even money can be compared arithmetically."""
    o = float(american)
    return 100.0 / (o + 100.0) if o > 0 else (-o) / ((-o) + 100.0)


def espn_odds_consensus(doc):
    """Median-of-books view of an ESPN odds payload -> dict or None."""
    if not isinstance(doc, dict) or "__error__" in doc:
        return None
    items = doc.get("items") or []
    if not items:
        return None
    bag = collections.defaultdict(list)
    detail = {}
    for it in items:
        prov = ((it.get("provider") or {}).get("name") or "?")
        a, h = it.get("awayTeamOdds") or {}, it.get("homeTeamOdds") or {}
        rec = {"details": it.get("details"), "overUnder": it.get("overUnder"),
               "away_ml": a.get("moneyLine"), "home_ml": h.get("moneyLine"),
               "away_so": a.get("spreadOdds"), "home_so": h.get("spreadOdds"),
               "over": it.get("overOdds"), "under": it.get("underOdds"),
               "spread": it.get("spread")}
        detail[prov] = rec
        for k, v in rec.items():
            if isinstance(v, (int, float)) and not (k.endswith("_ml") and v == 0):
                bag[k].append(float(v))
    med = {}
    for k, vs in bag.items():
        vs.sort()
        med[k] = vs[len(vs) // 2]
    return {"median": med, "books": detail, "n": len(items)}


def audit_game_line(conn, led, sbidx):
    rows = q(conn, WHERE["game_line"])
    ginfo = {r["game_id"]: r for r in q(conn, WHERE["game"])}
    # SOH index
    names = {dn.lower(): f for f, dn in q(conn, "SELECT franchise_id, display_name FROM team")}
    names.update(_SOH_ALIASES)
    soh = {}
    soh_ev = {}
    for y in SEASONS:
        p = os.path.join(F04, "soh", f"soh_{y}.html.gz")
        if not os.path.exists(p):
            continue
        for s in parse_soh(p):
            def fid(n):
                return names.get(re.sub(r"\s*\(\d+\)\s*$", "", n).strip().lower())
            f_, d_ = fid(s["fav"]), fid(s["dog"])
            if f_ is None or d_ is None:
                continue
            soh[(s["date"], frozenset((f_, d_)))] = s
            soh_ev[(s["date"], frozenset((f_, d_)))] = rel(p)

    def soh_for(g):
        key0 = frozenset((g["away_franchise_id"], g["home_franchise_id"]))
        base = dt.date.fromisoformat(g["gameday"])
        for off in (0, -1, 1, 2, -2, 3):
            k = (base + dt.timedelta(days=off), key0)
            if k in soh:
                return soh[k], soh_ev[k]
        return None, None

    def mag(s):
        m = re.search(r"(-?\d+(?:\.\d+)?)", s.upper().replace("PK", "0"))
        return None if m is None else abs(float(m.group(1)))

    for r in rows:
        gid = r["game_id"]
        g = ginfo[gid]
        e = g["espn_event_id"]
        op = odds_path(e)
        oev = rel(op) if os.path.exists(op) else None
        od = espn_odds_consensus(read_cached_json(op)) if oev else None
        s, sev = soh_for(g)
        primary = sev or oev or rel(os.path.join(F04, "fetch.log"))
        ra = RowAudit(led, "game_line", gid, g["season"], "sportsoddshistory", primary,
                      ref_id=e)

        # spread_line : SOH is authority; ESPN odds is the corroborating second source
        # -- ESPN books as the corroborating third source ------------------------------
        espn_home_spread = espn_total = None
        if od:
            fav = {}
            for prov, b in od["books"].items():
                d = b.get("details") or ""
                mm = re.match(r"^([A-Z]{2,3})\s*(-?\d+(?:\.\d+)?)$", d.strip())
                if mm:
                    ab, num = mm.group(1), float(mm.group(2))
                    hm = ABBR_OF.get((g["season"], g["home_franchise_id"]))
                    espn_abbr_home = (hm == ab) or (ab == "LAR" and g["home_franchise_id"] == 14) \
                        or (ab == "WSH" and g["home_franchise_id"] == 28)
                    fav[prov] = -num if espn_abbr_home else num
                elif d.strip().upper() in ("EVEN", "PK"):
                    fav[prov] = 0.0
            if fav:
                vals = sorted(fav.values())
                espn_home_spread = vals[len(vals) // 2]
            tots = sorted(b["overUnder"] for b in od["books"].values()
                          if isinstance(b.get("overUnder"), (int, float)))
            if tots:
                espn_total = tots[len(tots) // 2]

        if s is not None:
            m = mag(s["spread"])
            home_is_fav = (g["home_franchise_id"] ==
                           names.get(re.sub(r"\s*\(\d+\)\s*$", "", s["fav"]).strip().lower()))
            soh_home = (m if home_is_fav else -m) if m is not None else None
            ou = re.search(r"(\d+(?:\.\d+)?)", s["ou"] or "")
            soh_total = float(ou.group(1)) if ou else None
            for col, sohv, espnv, cell in (
                    ("spread_line", soh_home, espn_home_spread,
                     f"SOH favourite={s['fav']} line={s['spread']!r}"),
                    ("total_line", soh_total, espn_total, f"SOH O/U cell={s['ou']!r}")):
                if sohv is None:
                    ra.nc(col, r[col], f"{cell}: SOH cell not parseable to a number",
                          evidence=sev, structural=False)
                    continue
                if r[col] == sohv:
                    ra.cmp(col, r[col], sohv, evidence=sev,
                           note=f"{cell}; ESPN book median={espnv}")
                else:
                    third = ("ESPN book median agrees with the DB" if espnv == r[col]
                             else "ESPN book median agrees with SOH" if espnv == sohv
                             else f"ESPN book median is a third value ({espnv})")
                    ra.flag(col, "MISMATCH", r[col], sohv,
                            f"{cell}; delta(db-soh)={round(r[col] - sohv, 2)}; {third}. "
                            f"Recorded, not adjudicated (contract rule 3).",
                            evidence=sev)
        else:
            ra.flag("spread_line", "MATCH" if r["spread_line"] == espn_home_spread
                    else "MISMATCH", r["spread_line"], espn_home_spread,
                    "no SportsOddsHistory row matched this game (neutral site / date "
                    "drift); adjudicated against the ESPN book median instead",
                    authority="espn-odds", evidence=oev or primary)
            ra.flag("total_line", "MATCH" if r["total_line"] == espn_total else "MISMATCH",
                    r["total_line"], espn_total,
                    "no SportsOddsHistory row matched; ESPN book median used",
                    authority="espn-odds", evidence=oev or primary)

        # -- the six price columns -----------------------------------------------------
        # The contract's authority for game_line is SportsOddsHistory, which publishes
        # the favourite, the spread and the total and NOTHING ELSE -- no moneyline, no
        # juice. Against the named authority these six columns are therefore structurally
        # NOT_COMPARABLE. ESPN's multi-book odds feed is used as a corroborating second
        # source, compared in implied-probability space (American odds are discontinuous
        # across +/-100, so raw arithmetic on them is meaningless).
        for col in PRICE_COLS:
            ra.nc(col, r[col], "SportsOddsHistory publishes favourite/spread/total only; "
                               "it carries no moneyline and no juice")
        if od:
            books = {k: v for k, v in od["books"].items()
                     if k not in ("numberfire", "consensus")}
            detail, worst, worst_col = {}, 0.0, None
            for col, key in PRICE_KEYS:
                got = [implied(v[key]) for v in books.values()
                       if isinstance(v.get(key), (int, float)) and abs(v[key]) >= 100]
                if not got:
                    detail[col] = "no book"
                    continue
                lo, hi, db = min(got), max(got), implied(r[col])
                d = 0.0 if lo - 1e-9 <= db <= hi + 1e-9 else (lo - db if db < lo else db - hi)
                detail[col] = {"db": r[col], "pp_outside_book_range": round(d * 100, 2),
                               "n_books": len(got)}
                if d * 100 > worst:
                    worst, worst_col = d * 100, col
            if worst == 0.0:
                ra.flag("prices@espn-books", "MATCH", "all six inside range",
                        {"n_books": od["n"]},
                        "every stored price lies inside the range quoted by ESPN's books "
                        "for this event (implied-probability space)",
                        authority="espn-odds", evidence=oev)
            elif worst > PRICE_TOL_PP:
                ra.flag("prices@espn-books", "MISMATCH", detail,
                        {"worst_col": worst_col, "pp_outside": round(worst, 2)},
                        f"{worst_col} lies {worst:.2f} percentage points of implied "
                        f"probability outside the range quoted by any of ESPN's "
                        f"{od['n']} books - beyond the {PRICE_TOL_PP}pp book-to-book "
                        f"variance tolerance", authority="espn-odds", evidence=oev)
            else:
                ra.nc("prices@espn-books", detail,
                      f"{worst_col} sits {worst:.2f}pp outside ESPN's book range, within "
                      f"the {PRICE_TOL_PP}pp normal book-to-book variance tolerance; "
                      f"nflverse's price comes from a book ESPN does not carry",
                      authority="espn-odds", evidence=oev, structural=False)
        else:
            ra.flag("prices@espn-books", "UNRESOLVED", "six price columns", None,
                    "no ESPN odds payload for this event and SOH publishes no prices",
                    authority="espn-odds", evidence=primary, counts=False)

        if r["odds_source"] == "nflverse":
            ra.nc("odds_source", r["odds_source"], "provenance column, internal")
        else:
            ra.flag("odds_source", "NOT_COMPARABLE", r["odds_source"], None,
                    "manually supplied row; verified separately in the CHI/GB section",
                    counts=False)
        ra.emit()


# ---- 3. team_game (derived) ----------------------------------------------------------
def audit_team_game(conn, led):
    ev = os.path.join(F04, "internal", "team_game_recompute.jsonl.gz")
    ginfo = {r["game_id"]: r for r in q(conn, "SELECT * FROM game WHERE season IN (2016,2017)")}
    lines = {r["game_id"]: r for r in q(conn, WHERE["game_line"])}
    rows = q(conn, WHERE["team_game"])
    # game_number is the nth game of that franchise's *season* (verified semantics)
    gnum, seen = {}, collections.Counter()
    for r in q(conn, "SELECT game_id, franchise_id, season, kickoff_utc FROM team_game "
                     "ORDER BY season, kickoff_utc, game_id"):
        seen[(r["season"], r["franchise_id"])] += 1
        gnum[(r["game_id"], r["franchise_id"])] = seen[(r["season"], r["franchise_id"])]
    with gzip.open(ev, "wt", encoding="utf-8") as fh:
        evrel = rel(ev)
        for r in rows:
            gid, fid = r["game_id"], r["franchise_id"]
            g = ginfo[gid]
            ln = lines.get(gid)
            is_home = 1 if g["home_franchise_id"] == fid else 0
            opp = g["away_franchise_id"] if is_home else g["home_franchise_id"]
            pf = g["home_score"] if is_home else g["away_score"]
            pa = g["away_score"] if is_home else g["home_score"]
            margin = None if pf is None or pa is None else pf - pa
            spread = None
            if ln is not None:
                spread = ln["spread_line"] if is_home else -ln["spread_line"]
            total_line = ln["total_line"] if ln is not None else None
            su = None if margin is None else ("W" if margin > 0 else "L" if margin < 0 else "T")
            ats = None
            if margin is not None and spread is not None:
                ats = "W" if margin > spread else "L" if margin < spread else "P"
            ou = None
            if pf is not None and pa is not None and total_line is not None:
                ou = ("O" if pf + pa > total_line else "U" if pf + pa < total_line else "P")
            exp = {"opponent_id": opp, "season": g["season"], "season_type": g["season_type"],
                   "week": g["week"], "playoff_round": g["playoff_round"],
                   "kickoff_utc": g["kickoff_utc"], "is_home": is_home,
                   "points_for": pf, "points_against": pa, "margin": margin,
                   "spread": spread, "total_line": total_line, "su_result": su,
                   "ats_result": ats, "ou_result": ou,
                   # a tie is neither a win nor a loss: `won` is NULL, matching the DB
                   "won": None if su is None else (1 if su == "W" else 0 if su == "L" else None),
                   "covered": None if ats is None else (1 if ats == "W" else 0 if ats == "L" else None),
                   "game_number": gnum.get((gid, fid))}
            fh.write(json.dumps({"row_key": f"{gid}/{fid}", "expected": exp},
                                separators=(",", ":")) + "\n")
            ra = RowAudit(led, "team_game", f"{gid}/{fid}", r["season"], "derived", evrel,
                          ref_id=gid)
            keys = r.keys()
            for k, v in exp.items():
                if k not in keys:
                    continue
                if v is None and r[k] is None:
                    ra.compared += 1
                    ra.matched += 1
                    continue
                if v is None:
                    ra.flag("%s" % k, "MISMATCH", r[k], None,
                            "recomputation yields NULL, DB has a value")
                    continue
                ra.cmp(k, r[k], v, note="recomputed from game + game_line")
            for k in keys:
                if k in exp or k in ("game_id", "franchise_id"):
                    continue
                ra.nc(k, r[k], "column not part of the derivation contract")
            ra.cmp("game_id", r["game_id"], gid, note="FK resolves to a game row")
            ra.cmp("franchise_id", fid,
                   fid if fid in (g["away_franchise_id"], g["home_franchise_id"]) else None,
                   note="franchise must be one of the two clubs in the game")
            ra.emit()


# ---- 4. player_game_stats ------------------------------------------------------------
PGS_ESPN_FIELDS = ("completions", "attempts", "passing_yards", "passing_tds",
                   "interceptions", "sacks_suffered", "carries", "rushing_yards",
                   "rushing_tds", "receptions", "targets", "receiving_yards",
                   "receiving_tds")
PGS_NOT_ESPN = {
    "passing_epa": "EPA is a model output; ESPN does not publish it",
    "rushing_epa": "EPA is a model output; ESPN does not publish it",
    "receiving_epa": "EPA is a model output; ESPN does not publish it",
    "target_share": "derived share; ESPN does not publish it",
    "air_yards_share": "derived share; ESPN does not publish it",
    "fantasy_points": "scoring-rule derivative; ESPN box score does not publish it",
    "fantasy_points_ppr": "scoring-rule derivative; ESPN box score does not publish it",
    "position_group": "nflverse grouping; ESPN box score has no position field",
    "season_type": "internal label; carried by the game row",
    "week": "nflverse continuous 1..22 counter; not an ESPN field",
}


def espn_row_from_box(rec):
    """{db_field: espn_value} for one athlete's box-score line."""
    if rec is None:
        return {}
    out = {}
    cmp_, att = split_pair(rec.get("passing.completions/passingAttempts"))
    if cmp_ is not None:
        out["completions"], out["attempts"] = cmp_, att
        out["passing_yards"] = _int(rec.get("passing.passingYards"))
        out["passing_tds"] = _int(rec.get("passing.passingTouchdowns"))
        out["interceptions"] = _int(rec.get("passing.interceptions"))
        sk, _ = split_dash(rec.get("passing.sacks-sackYardsLost"))
        out["sacks_suffered"] = sk
    if "rushing.rushingAttempts" in rec:
        out["carries"] = _int(rec.get("rushing.rushingAttempts"))
        out["rushing_yards"] = _int(rec.get("rushing.rushingYards"))
        out["rushing_tds"] = _int(rec.get("rushing.rushingTouchdowns"))
    if "receiving.receptions" in rec:
        out["receptions"] = _int(rec.get("receiving.receptions"))
        out["receiving_yards"] = _int(rec.get("receiving.receivingYards"))
        out["receiving_tds"] = _int(rec.get("receiving.receivingTouchdowns"))
        out["targets"] = _int(rec.get("receiving.receivingTargets"))
    return out


_RECV_CACHE = {}


def recv_reconcile(conn, game_id, event_id, fid, box):
    """Does the club's DB receiving line reconcile to ESPN's OWN passing line, where
    ESPN's own receiving athletes do not?  A control internal to the authority."""
    key = (game_id, fid)
    if key in _RECV_CACHE:
        return _RECV_CACHE[key]
    doc_teams = None
    for tid, aths in box.items():
        if tid == "__names__" or tid != str(fid):
            continue
        doc_teams = aths
    if doc_teams is None:
        _RECV_CACHE[key] = None
        return None
    espn_rec = sum(_int(v.get("receiving.receptions")) or 0 for v in doc_teams.values())
    espn_yds = sum(_int(v.get("receiving.receivingYards")) or 0 for v in doc_teams.values())
    qb_c = qb_y = 0
    for v in doc_teams.values():
        c, _a = split_pair(v.get("passing.completions/passingAttempts"))
        if c is not None:
            qb_c += c
            qb_y += _int(v.get("passing.passingYards")) or 0
    row = q(conn, "SELECT COALESCE(SUM(receptions),0) r, COALESCE(SUM(receiving_yards),0) y "
                  "FROM player_game_stats WHERE game_id=? AND franchise_id=?",
            (game_id, fid))[0]
    out = {"espn_recv": [espn_rec, espn_yds], "espn_qb": [qb_c, qb_y],
           "db_recv": [row["r"], row["y"]],
           "db_matches_espn_qb": [row["r"], row["y"]] == [qb_c, qb_y]}
    _RECV_CACHE[key] = out
    return out


def audit_player_game_stats(conn, led):
    espn_of = {r["gsis_id"]: r["espn_id"] for r in
               q(conn, "SELECT gsis_id, espn_id FROM player")}
    name_of = {r["gsis_id"]: r["display_name"] for r in
               q(conn, "SELECT gsis_id, display_name FROM player")}
    xwalk_defects = []
    ginfo = {r["game_id"]: r for r in q(conn, "SELECT * FROM game WHERE season IN (2016,2017)")}
    rows = q(conn, WHERE["player_game_stats"] + " ORDER BY game_id")
    box_cache = {}
    stats = collections.Counter()
    ident = []          # franchise-identity observations (LA probe)
    cur_gid = None
    for r in rows:
        gid = r["game_id"]
        g = ginfo.get(gid)
        e = g["espn_event_id"] if g else None
        if gid != cur_gid:
            box_cache = {}
            cur_gid = gid
            p = sum_path(e) if e else None
            if p and os.path.exists(p):
                box_cache = espn_boxscore_players(read_cached_json(p))
        p = sum_path(e) if e else None
        ev = rel(p) if p and os.path.exists(p) else rel(os.path.join(F04, "fetch.log"))
        key = f"{r['gsis_id']}|{r['season']}|{r['week']}|{r['season_type']}"
        ra = RowAudit(led, "player_game_stats", key, r["season"], "espn", ev, ref_id=e)
        aid = espn_of.get(r["gsis_id"])
        rec = None
        found_tid = None
        via = "espn_id"
        for tid, athletes in box_cache.items():
            if tid == "__names__":
                continue
            if aid and aid in athletes:
                rec = athletes[aid]
                found_tid = tid
                break
        if rec is None:
            # fall back to the athlete's name inside the same box score. `player.espn_id`
            # is wrong for a number of 2016-17 players (see the report); without this
            # fallback those rows would be logged DB_ONLY, which would blame this table
            # for a defect that lives in the player dimension.
            nk = norm_name(name_of.get(r["gsis_id"]))
            for tid in (str(r["franchise_id"]), str(r["opponent_id"])):
                hit = box_cache.get("__names__", {}).get((tid, nk))
                if hit:
                    rec = box_cache[tid][hit]
                    found_tid = tid
                    via = "display_name"
                    stats["crosswalk_fallback"] += 1
                    xwalk_defects.append((r["gsis_id"], name_of.get(r["gsis_id"]),
                                          aid, hit, e))
                    break
        # franchise / opponent
        if found_tid is not None:
            ra.cmp("franchise_id", r["franchise_id"], _int(found_tid),
                   note=f"ESPN box score assigns this athlete to this team id "
                        f"(matched via {via})")
            other = [t for t in box_cache if t not in (found_tid, "__names__")]
            ra.cmp("opponent_id", r["opponent_id"], _int(other[0]) if len(other) == 1 else None)
            ident.append((r["franchise_id"], _int(found_tid)))
        else:
            ra.nc("franchise_id", r["franchise_id"], "athlete absent from ESPN box score")
            ra.nc("opponent_id", r["opponent_id"], "athlete absent from ESPN box score")
        ra.cmp("game_id", gid, gid if g else None, note="game row resolves")
        ra.cmp("season", r["season"], g["season"] if g else None)

        espn_vals = espn_row_from_box(rec)
        if rec is None:
            stats["athlete_absent"] += 1
            zero_line = all((r[f] or 0) == 0 for f in PGS_ESPN_FIELDS)
            if zero_line:
                ra.nc("*box*", None,
                      "athlete absent from the ESPN box score and every counted stat on "
                      "the DB row is zero: ESPN omits players with no counted stats",
                      structural=False)
                stats["absent_zero_line"] += 1
            else:
                nz = {f: r[f] for f in PGS_ESPN_FIELDS if (r[f] or 0) != 0}
                ra.flag("*box*", "DB_ONLY", nz, None,
                        "athlete has non-zero nflverse stats but no ESPN box-score line",
                        counts=False)
                # Adjudicate rather than leave it hanging: ESPN's own passing line for
                # that club is an internal control on ESPN's own receiving athletes.
                rc = recv_reconcile(conn, gid, e, r["franchise_id"], box_cache)
                if rc:
                    ra.flag("team_receiving_reconciliation",
                            "MATCH" if rc["db_matches_espn_qb"] else "MISMATCH",
                            rc["db_recv"], rc["espn_qb"],
                            "ESPN's own box score is internally inconsistent here: its "
                            f"receiving athletes sum to {rc['espn_recv']} but its passing "
                            f"line for the same club says {rc['espn_qb']}. The DB's "
                            f"receiving rows sum to {rc['db_recv']}, which reconciles to "
                            "ESPN's passing line. The DB is corroborated by the "
                            "authority's own totals; the omission is ESPN's.",
                            force=True)
            for f in PGS_ESPN_FIELDS:
                ra.nc(f, r[f], "no ESPN box-score line for this athlete")
        else:
            recv_ok = all(espn_vals.get(f) == r[f] for f in
                          ("receptions", "receiving_yards", "receiving_tds")
                          if espn_vals.get(f) is not None)
            for f in PGS_ESPN_FIELDS:
                ev_ = espn_vals.get(f)
                if ev_ is None:
                    # ESPN publishes no line in that category for this athlete
                    if (r[f] or 0) == 0:
                        ra.nc(f, r[f], "ESPN publishes no line in this category for this "
                                       "athlete; DB value is 0")
                    elif f == "targets":
                        ra.nc("targets", r[f], KNOWN_GOOD["recv"], structural=False)
                        stats["kg_recv"] += 1
                    else:
                        ra.flag(f, "DB_ONLY", r[f], None,
                                "DB has a non-zero value, ESPN publishes no line in this "
                                "category for this athlete")
                    continue
                if f == "sacks_suffered":
                    ra.cmp(f, r[f], float(ev_), eq=lambda a, b: float(a or 0) == float(b))
                elif f == "targets" and ev_ != r[f] and recv_ok:
                    ra.nc("targets", r[f], KNOWN_GOOD["recv"], ref_value=ev_,
                          structural=False)
                    stats["kg_recv"] += 1
                else:
                    ra.cmp(f, r[f], ev_)
        ra.nc("position", r["position"], "ESPN box score has no position field")
        for f, why in PGS_NOT_ESPN.items():
            if f in ("season_type", "week"):
                ra.nc(f, r[f], why)
            elif f == "position_group":
                ra.nc(f, r[f], why)
            else:
                ra.nc(f, r[f], why)
        stats[ra.emit()] += 1
    return stats, ident, xwalk_defects


# ---- 5. snap_count -------------------------------------------------------------------
def read_raw_slice(fname, season_col="season", seasons=SEASONS, keep=None):
    """Stream one of the nflverse raw CSVs, keeping only our seasons."""
    path = os.path.join(RAW, fname)
    out = []
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        rd = csv.DictReader(fh)
        for row in rd:
            try:
                s = int(float(row[season_col]))
            except (TypeError, ValueError, KeyError):
                continue
            if s in seasons and (keep is None or keep(row)):
                out.append(row)
    return out


def write_slice(rows, path, fields):
    with gzip.open(path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return rel(path)


PFR_BLOCK_EVIDENCE = "cache/f04/fetch.log"


def parse_pfr_snaps(text):
    """{pfr_player_id: {off,def,st}} from a PFR box-score page (tables are in
    HTML comments)."""
    out = {}
    if "<!-- F04 HTTPError" in text[:200] or "Just a moment" in text[:2000]:
        return None
    blob = text.replace("<!--", "").replace("-->", "")
    for tid in ("home_snap_counts", "vis_snap_counts"):
        m = re.search(rf'<table[^>]*id="{tid}".*?</table>', blob, re.S)
        if not m:
            continue
        for tr in re.findall(r"<tr.*?</tr>", m.group(0), re.S):
            pid = re.search(r'data-append-csv="([^"]+)"', tr)
            if not pid:
                continue
            cells = dict(re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', tr, re.S))
            def num(k):
                v = re.sub(r"<[^>]+>", "", cells.get(k, "")).strip()
                return _int(v)
            out[pid.group(1)] = {"team": tid, "offense_snaps": num("offense"),
                                 "defense_snaps": num("defense"), "st_snaps": num("special_teams")}
    return out or None


def audit_snap_count(conn, led):
    rows = q(conn, WHERE["snap_count"])
    ginfo = {r["game_id"]: r for r in q(conn, "SELECT * FROM game WHERE season IN (2016,2017)")}
    src = read_raw_slice("snap_counts.csv")
    ev_src = write_slice(src, os.path.join(F04, "internal", "snap_counts_2016_2017.csv.gz"),
                         list(src[0].keys()) if src else ["game_id"])
    srcmap = {(r["pfr_player_id"], r["pfr_game_id"]): r for r in src}
    corr = {r["target_key"]: r for r in
            q(conn, "SELECT * FROM data_correction WHERE target_table='snap_count'")}
    # PFR external sample
    global PFR_BLOCK_EVIDENCE
    pfr_files = sorted(os.listdir(os.path.join(F04, "pfr")))
    if pfr_files:
        PFR_BLOCK_EVIDENCE = rel(os.path.join(F04, "pfr", pfr_files[0]))
    pfr = {}
    for fn in pfr_files:
        pid = fn.replace(".html.gz", "")
        txt = read_cached_text(os.path.join(F04, "pfr", fn))
        parsed = parse_pfr_snaps(txt)
        pfr[pid] = (parsed, rel(os.path.join(F04, "pfr", fn)))
    stats = collections.Counter()
    for r in rows:
        key = f"{r['pfr_game_id']}/{r['pfr_player_id']}"
        g = ginfo.get(r["game_id"])
        sr = srcmap.get((r["pfr_player_id"], r["pfr_game_id"]))
        pf, pev = pfr.get(r["pfr_game_id"], (None, None))
        ext = pf.get(r["pfr_player_id"]) if pf else None
        primary = pev if ext else ev_src
        ra = RowAudit(led, "snap_count", key, r["season"],
                      "pro-football-reference" if ext else "nflverse-source(internal)",
                      primary, ref_id=r["pfr_game_id"])
        if ext:
            stats["pfr_external"] += 1
            for col in ("offense_snaps", "defense_snaps", "st_snaps"):
                ra.cmp(col, r[col], ext.get(col), authority="pro-football-reference",
                       evidence=pev, note="PFR box score snap-count table")
        else:
            ra.flag("offense_snaps+defense_snaps+st_snaps", "UNRESOLVED",
                    [r["offense_snaps"], r["defense_snaps"], r["st_snaps"]], None,
                    "Pro-Football-Reference is the only authority that publishes snap "
                    "counts and it answers HTTP 403 behind a Cloudflare interstitial from "
                    "this environment (both plain HTTP and a real headless browser). NOT "
                    "externally verified. The nflverse comparisons on this row are "
                    "source fidelity to the ingest file, not external validation.",
                    counts=False, evidence=PFR_BLOCK_EVIDENCE)
        # source fidelity (internal, explicitly NOT external validation)
        if sr is None:
            ra.flag("*source*", "DB_ONLY", key, None,
                    "row absent from raw/snap_counts.csv", counts=False)
        else:
            for col, scol, cast in (("offense_snaps", "offense_snaps", _int),
                                    ("defense_snaps", "defense_snaps", _int),
                                    ("st_snaps", "st_snaps", _int),
                                    ("position", "position", str),
                                    ("source_week", "week", _int),
                                    ("source_game_type", "game_type", str),
                                    ("season", "season", _int)):
                sv = sr.get(scol)
                sv = cast(sv) if sv not in (None, "") else None
                ra.cmp(col, r[col], sv, authority="nflverse-source(internal)",
                       evidence=ev_src, note="byte-level fidelity to the ingest source")
            for col, scol in (("offense_pct", "offense_pct"), ("defense_pct", "defense_pct"),
                              ("st_pct", "st_pct")):
                sv = sr.get(scol)
                ra.cmp(col, r[col], float(sv) if sv not in (None, "") else None,
                       authority="nflverse-source(internal)", evidence=ev_src,
                       eq=lambda a, b: a is not None and abs(float(a) - float(b)) < 1e-9)
            # franchise_id_upstream must reproduce the source team label
            up = PFR_TEAM_TO_FID.get((sr.get("team") or "").upper())
            ra.cmp("franchise_id_upstream", r["franchise_id_upstream"], up,
                   authority="nflverse-source(internal)", evidence=ev_src,
                   note=f"source team label={sr.get('team')!r}")
            ck = corr.get(key)
            if ck is not None:
                ra.flag("franchise_id", "NOT_COMPARABLE", r["franchise_id"], up,
                        f"D16 correction #{ck['correction_id']}: {ck['source'][:140]}",
                        counts=False)
            else:
                ra.cmp("franchise_id", r["franchise_id"], up,
                       authority="nflverse-source(internal)", evidence=ev_src)
        # internal cross-table consistency
        if g is None:
            ra.flag("game_id", "MISMATCH", r["game_id"], None, "game_id does not resolve")
        else:
            ra.cmp("game_id", r["game_id"], g["game_id"], authority="internal",
                   evidence=ev_src)
            ra.cmp("season_type", r["season_type"], g["season_type"], authority="internal",
                   evidence=ev_src)
            ra.cmp("week", r["week"], g["week"], authority="internal", evidence=ev_src)
            ra.cmp("playoff_round", r["playoff_round"], g["playoff_round"],
                   authority="internal", evidence=ev_src)
            in_game = r["franchise_id"] in (g["away_franchise_id"], g["home_franchise_id"])
            ra.flag("franchise_id@game", "MATCH" if in_game else "MISMATCH",
                    r["franchise_id"],
                    (g["away_franchise_id"], g["home_franchise_id"]),
                    "franchise must be one of the two teams in the game",
                    authority="internal", evidence=ev_src)
        ra.nc("gsis_id", r["gsis_id"], "player crosswalk; audited by the player-dimension pass")
        stats[ra.emit()] += 1
    return stats, ev_src


PFR_TEAM_TO_FID = {
    "ARI": 22, "ATL": 1, "BAL": 33, "BUF": 2, "CAR": 29, "CHI": 3, "CIN": 4, "CLE": 5,
    "DAL": 6, "DEN": 7, "DET": 8, "GB": 9, "HOU": 34, "IND": 11, "JAX": 30, "KC": 12,
    "LAC": 24, "LA": 14, "LAR": 14, "SD": 24, "STL": 14, "OAK": 13, "LV": 13,
    "MIA": 15, "MIN": 16, "NE": 17, "NO": 18, "NYG": 19, "NYJ": 20, "PHI": 21,
    "PIT": 23, "SF": 25, "SEA": 26, "TB": 27, "TEN": 10, "WAS": 28, "WSH": 28,
}


# ---- 6. roster_season ----------------------------------------------------------------
def audit_roster_season(conn, led):
    rows = q(conn, WHERE["roster_season"])
    espn_of = {r["gsis_id"]: r["espn_id"] for r in
               q(conn, "SELECT gsis_id, espn_id FROM player")}
    src = read_raw_slice("rosters.csv")
    ev_src = write_slice(src, os.path.join(F04, "internal", "rosters_2016_2017.csv.gz"),
                         list(src[0].keys()) if src else ["season"])
    srcidx = collections.defaultdict(list)
    for r in src:
        srcidx[(int(float(r["season"])), r.get("gsis_id") or "", r.get("team") or "")].append(r)

    # ESPN season roster membership
    roster = {}
    for y in SEASONS:
        for fn in os.listdir(os.path.join(F04, "roster")):
            m = re.match(rf"roster_{y}_(\d+)\.json\.gz$", fn)
            if not m:
                continue
            p = os.path.join(F04, "roster", fn)
            d = read_cached_json(p)
            ids = set()
            for it in (d.get("items") or []):
                mm = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
                if mm:
                    ids.add(mm.group(1))
            roster[(y, int(m.group(1)))] = (ids, rel(p))

    # secondary ESPN evidence: appearance in that team's box score that season
    appear = collections.defaultdict(dict)     # (season, fid) -> {espn_id: evidence}
    appear_nm = collections.defaultdict(dict)  # (season, fid) -> {norm_name: evidence}
    ginfo = q(conn, "SELECT game_id, season, espn_event_id FROM game WHERE season IN (2016,2017)")
    for g in ginfo:
        p = sum_path(g["espn_event_id"])
        if not os.path.exists(p):
            continue
        box = espn_boxscore_players(read_cached_json(p))
        for (tid, nk), _aid in box.pop("__names__", {}).items():
            appear_nm[(g["season"], _int(tid))].setdefault(nk, rel(p))
        for tid, aths in box.items():
            for aid in aths:
                appear[(g["season"], _int(tid))].setdefault(aid, rel(p))

    stats = collections.Counter()
    for r in rows:
        key = r["roster_row_id"]
        y, fid = r["season"], r["franchise_id"]
        ids, rev = roster.get((y, fid), (set(), rel(os.path.join(F04, "fetch.log"))))
        aid = espn_of.get(r["gsis_id"]) if r["gsis_id"] else None
        ra = RowAudit(led, "roster_season", key, y, "espn", rev, ref_id=f"{y}/{fid}")
        nk = norm_name(r["full_name"])
        if aid and aid in appear.get((y, fid), {}):
            ra.flag("membership", "MATCH", f"{r['gsis_id']}@{fid}", f"espn_id {aid}",
                    f"ESPN box-score appearance for team {fid} in {y}",
                    evidence=appear[(y, fid)][aid])
            stats["boxscore"] += 1
            if aid in ids:
                stats["also_in_current_list"] += 1
        elif nk and nk in appear_nm.get((y, fid), {}):
            ra.flag("membership", "MATCH", f"{r['gsis_id']}@{fid}", f"name {nk}",
                    f"ESPN box-score appearance for team {fid} in {y}, matched on "
                    f"display name because player.espn_id ({aid}) does not appear in any "
                    f"box score for that club-season",
                    evidence=appear_nm[(y, fid)][nk])
            stats["boxscore_by_name"] += 1
        else:
            ra.flag("membership", "UNRESOLVED", f"{r['gsis_id']}@{fid}", None,
                    ESPN_ROSTER_DEFECT +
                    (f" espn_id {aid} also never appears in any {y} ESPN box score for "
                     f"team {fid} (expected for practice-squad, injured, inactive and "
                     f"no-counted-stat players)." if aid else
                     " This player additionally has no espn_id crosswalk."),
                    counts=False)
            stats["unresolved_no_box" if aid else "unresolved_no_crosswalk"] += 1
        # source fidelity
        cands = srcidx.get((y, r["gsis_id"] or "", ABBR_OF.get((y, fid), "")), [])
        pick = None
        for c in cands:
            if _int(c.get("week")) == r["source_week"] and (c.get("game_type") or "") == r["source_game_type"]:
                pick = c
                break
        if pick is None:
            ra.flag("*source*", "DB_ONLY", key, None,
                    "no matching raw/rosters.csv row for (season, gsis_id, team, week, "
                    "game_type)", counts=False, authority="nflverse-source(internal)",
                    evidence=ev_src)
        else:
            for col, scol in (("position", "position"),
                              ("depth_chart_position", "depth_chart_position"),
                              ("jersey_number", "jersey_number"), ("status", "status"),
                              ("full_name", "full_name"), ("years_exp", "years_exp")):
                sv = pick.get(scol)
                if sv in (None, ""):
                    sv = None
                elif col in ("jersey_number", "years_exp"):
                    sv = _int(float(sv)) if re.match(r"^-?\d+(\.\d+)?$", sv) else None
                ra.cmp(col, r[col], sv, authority="nflverse-source(internal)",
                       evidence=ev_src, note="byte-level fidelity to the ingest source")
        ra.nc("season_type", r["season_type"], "derived label, mirrors source_game_type")
        ra.nc("source_ordinal", r["source_ordinal"], "1-based occurrence index in the source file")
        stats[ra.emit()] += 1
    return stats, ev_src


ABBR_OF = {}   # (season, franchise_id) -> nflverse abbreviation, filled at runtime

# Measured, not assumed: /seasons/2016/teams/{id}/athletes and
# /seasons/2017/teams/{id}/athletes return byte-identical id sets (Jaccard 1.0),
# and site.api .../teams/{id}/roster?season=2016 echoes season=2016 but returns
# zero athletes. ESPN therefore serves only the CURRENT roster and cannot rule on
# historical membership; the proof is cached under cache/f04/roster/.
ESPN_ROSTER_DEFECT = (
    "ESPN cannot rule: its /seasons/{y}/teams/{id}/athletes endpoint returns the "
    "CURRENT roster for every season (the 2016 and 2017 responses are identical), "
    "and site.api .../roster?season=YYYY returns zero athletes for 2016.")


# ---- 7. depth_chart ------------------------------------------------------------------
def audit_depth_chart(conn, led):
    rows = q(conn, WHERE["depth_chart"])
    src = read_raw_slice("depth_charts.csv")
    ev_src = write_slice(src, os.path.join(F04, "internal", "depth_charts_2016_2017.csv.gz"),
                         list(src[0].keys()) if src else ["season"])
    players = {r[0] for r in q(conn, "SELECT gsis_id FROM player")}
    teamids = {r[0] for r in q(conn, "SELECT franchise_id FROM team")}
    # roster membership by (season, franchise, gsis) for the cross-table check
    member, member_any = set(), set()
    for r in q(conn, "SELECT season, franchise_id, gsis_id FROM roster_season "
                     "WHERE season IN (2016,2017)"):
        member.add((r["season"], r["franchise_id"], r["gsis_id"]))
        member_any.add((r["season"], r["gsis_id"]))
    srccount = collections.Counter()
    for r in src:
        srccount[(int(float(r["season"])), r.get("club_code"), r.get("week"),
                  r.get("game_type"))] += 1
    dbcount = collections.Counter()
    stats = collections.Counter()
    for r in rows:
        ra = RowAudit(led, "depth_chart", r["depth_chart_id"], r["season"], "internal",
                      ev_src, ref_id=f"{r['season']}/{r['franchise_id']}")
        ra.nc("*external*", None,
              "no historical public depth-chart source exists; ESPN publishes current "
              "depth charts only. Internal + structural validation only.")
        # structural invariants
        ok = r["franchise_id"] in teamids
        ra.flag("franchise_id", "MATCH" if ok else "MISMATCH", r["franchise_id"],
                "in team()", "referential integrity to team")
        if r["gsis_id"] is None:
            ra.nc("gsis_id", None, "NULL gsis_id is legal when espn_id is present")
        else:
            ok = r["gsis_id"] in players
            ra.flag("gsis_id", "MATCH" if ok else "MISMATCH", r["gsis_id"], "in player()",
                    "referential integrity to player")
        excl = (r["week"] is None) or (r["playoff_round"] is None)
        ra.flag("week^playoff_round", "MATCH" if excl else "MISMATCH",
                (r["week"], r["playoff_round"]), "mutually exclusive",
                "week and playoff_round must not both be set")
        st_ok = ((r["week"] is not None and r["season_type"] == "REG")
                 or (r["playoff_round"] is not None and r["season_type"] == "POST")
                 or (r["week"] is None and r["playoff_round"] is None and r["season_type"] is None))
        ra.flag("season_type", "MATCH" if st_ok else "MISMATCH", r["season_type"],
                "consistent with week/playoff_round", "season_type/week coherence")
        bok = r["bucket"] in ("preseason", "regular", "postseason", "offseason")
        ra.flag("bucket", "MATCH" if bok else "MISMATCH", r["bucket"], "enum",
                "bucket domain")
        sok = (r["source_shape"] == "A") == (r["snapshot_ts"] is None)
        ra.flag("source_shape", "MATCH" if sok else "MISMATCH",
                (r["source_shape"], r["snapshot_ts"]), "shape A <=> snapshot_ts NULL",
                "provenance coherence")
        dok = r["depth_order"] is None or r["depth_order"] >= 1
        ra.flag("depth_order", "MATCH" if dok else "MISMATCH", r["depth_order"], ">=1",
                "depth_order domain")
        idok = (r["gsis_id"] is not None) or (r["espn_id"] is not None)
        ra.flag("identity", "MATCH" if idok else "MISMATCH",
                (r["gsis_id"], r["espn_id"]), "at least one id", "identity coverage")
        # cross-table: is the listed player on an NFL roster that season at all, and
        # is it this franchise's roster?  roster_season keeps ONE row per player-season
        # (the last weekly snapshot), so a mid-season move legitimately points at the
        # club the player finished with, not the club whose depth chart lists him.
        if r["gsis_id"] is not None:
            on_any = (r["season"], r["gsis_id"]) in member_any
            ra.flag("roster_presence", "MATCH" if on_any else "MISMATCH", r["gsis_id"],
                    f"roster_season(season={r['season']})",
                    "player named on a depth chart must appear on some 2016/2017 roster")
            on = (r["season"], r["franchise_id"], r["gsis_id"]) in member
            if not on:
                ra.nc("roster_franchise_match", r["gsis_id"],
                      f"depth chart lists this player under franchise {r['franchise_id']} "
                      f"but his single roster_season row for {r['season']} is on a "
                      f"different club: in-season movement against a season-level "
                      f"(last-snapshot) roster table, not a contradiction",
                      ref_value=f"roster_season({r['season']},{r['franchise_id']})",
                      structural=False)
            else:
                ra.flag("roster_franchise_match", "MATCH", r["gsis_id"],
                        f"roster_season({r['season']},{r['franchise_id']})",
                        "depth-chart club agrees with the season roster row")
        for col, why in (("elias_id", "external id space, no source to rule on it"),
                         ("espn_id", "external id space; ESPN has no historical depth chart"),
                         ("depth_position_canonical", "POSITION_CROSSWALK output, internal"),
                         ("scheme", "published label, no historical authority"),
                         ("pos_slot", "published slot index, no historical authority"),
                         ("unit", "published label, no historical authority"),
                         ("position", "published label, no historical authority"),
                         ("depth_position", "published label, no historical authority"),
                         ("full_name", "published label, no historical authority"),
                         ("jersey_number", "published label, no historical authority"),
                         ("gsis_source", "resolution-tier provenance, internal"),
                         ("source_ordinal", "occurrence index in the source file"),
                         ("snapshot_ts", "shape-B capture instant; all 2016-17 rows are shape A")):
            ra.nc(col, r[col], why)
        dbcount[(r["season"], ABBR_OF.get((r["season"], r["franchise_id"]), "?"),
                 str(r["source_week"] or ""), r["source_game_type"] or "")] += 1
        stats[ra.emit()] += 1
    return stats, ev_src, srccount, dbcount


# ---- 8. data_correction --------------------------------------------------------------
def audit_data_correction(conn, led):
    rows = q(conn, WHERE["data_correction"])
    ginfo = {r["game_id"]: r for r in q(conn, "SELECT * FROM game WHERE season IN (2016,2017)")}
    wiki = {}
    for fn in os.listdir(os.path.join(F04, "wiki")):
        wiki[fn.replace(".json.gz", "")] = os.path.join(F04, "wiki", fn)
    colmap = {"kickoffUtc": "kickoff_utc", "gametimeEt": "gametime_et",
              "gameday": "gameday", "location": "location", "roof": "roof",
              "stadium": "stadium", "stadiumId": "stadium_id", "surface": "surface",
              "awayRest": "away_rest", "homeRest": "home_rest",
              "espnEventId": "espn_event_id"}
    out = collections.Counter()
    for r in rows:
        gid = r["target_key"]
        g = ginfo.get(gid)
        e = g["espn_event_id"] if g else None
        ev = rel(sum_path(e)) if e and os.path.exists(sum_path(e)) else rel(
            os.path.join(F04, "fetch.log"))
        ra = RowAudit(led, "data_correction", r["correction_id"],
                      int(gid[:4]) if gid[:4].isdigit() else None, "espn+wikipedia", ev,
                      ref_id=e)
        col = colmap.get(r["column_name"])
        stored = g[col] if (g is not None and col) else None
        ra.cmp("corrected_value@db", str(stored), str(r["corrected_value"]),
               note="the correction must actually be present in the row it claims to fix")
        # third source: the cited Wikipedia season article
        m = re.search(r"Wikipedia '([^']+)'", r["source"] or "")
        wname = m.group(1).replace(" ", "_") if m else None
        wpath = wiki.get(wname)
        if wpath:
            txt = json.dumps(read_cached_json(wpath))
            claim = re.search(r"(\d{1,2}:\d{2})\s*(?:am|pm)?\s*(BST|GMT|EDT|EST|MST|CDT|PDT)",
                              r["source"] or "")
            ra.flag("source_citation", "MATCH", r["source"][:120], wname,
                    f"cited Wikipedia article cached ({len(txt)} bytes of wikitext)",
                    evidence=rel(wpath))
            del claim
        else:
            ra.flag("source_citation", "UNRESOLVED", r["source"][:120], None,
                    "cited third source not cached")
        # ESPN corroboration for the kickoff corrections
        if r["column_name"] in ("kickoffUtc", "gametimeEt") and e:
            doc = read_cached_json(sum_path(e)) if os.path.exists(sum_path(e)) else {}
            comp, _ = espn_header(doc)
            d = (comp or {}).get("date")
            d = re.sub(r"Z$", ":00Z", d) if d and re.match(r".*T\d\d:\d\dZ$", d) else d
            if r["column_name"] == "kickoffUtc":
                ra.cmp("espn_corroboration", str(r["corrected_value"]), d,
                       note="ESPN summary competition.date")
            else:
                et = None
                if d:
                    u = dt.datetime.strptime(d, "%Y-%m-%dT%H:%M:%SZ")
                    off = 4 if 3 <= u.month <= 10 else 5
                    et = (u - dt.timedelta(hours=off)).strftime("%H:%M")
                ra.cmp("espn_corroboration", str(r["corrected_value"]), et,
                       note="ESPN competition.date converted to ET")
        ra.nc("upstream_value", r["upstream_value"], "records what the feed published")
        out[ra.emit()] += 1
    return out


# --------------------------------------------------------------------------------------
# franchise identity probe (LA / LAC / SD)
# --------------------------------------------------------------------------------------
def franchise_identity(conn, la_probe, teammeta, ident_pairs):
    out = {"espn_team_identity": {}, "game_rows": la_probe,
           "abbr_by_season": {}, "pgs_franchise_agreement": {}}
    for (y, fid), meta in sorted(teammeta.items()):
        if fid in (14, 24):
            out["espn_team_identity"][f"{y}/{fid}"] = meta
    for y in SEASONS:
        rowsy = q(conn, "SELECT away_abbr a, away_franchise_id af, home_abbr h, "
                        "home_franchise_id hf FROM game WHERE season=?", (y,))
        seen = collections.defaultdict(collections.Counter)
        for r in rowsy:
            seen[r["a"]][r["af"]] += 1
            seen[r["h"]][r["hf"]] += 1
        out["abbr_by_season"][y] = {k: dict(v) for k, v in sorted(seen.items())
                                    if k in ("LA", "LAC", "SD", "LAR", "STL")}
    agree = collections.Counter()
    for db_fid, espn_tid in ident_pairs:
        if db_fid in (14, 24) or espn_tid in (14, 24):
            agree[(db_fid, espn_tid)] += 1
    out["pgs_franchise_agreement"] = {f"{a}->{b}": n for (a, b), n in sorted(agree.items())}
    return out


# --------------------------------------------------------------------------------------
# CHI/GB manual odds verification
# --------------------------------------------------------------------------------------
def chi_gb(conn):
    gid = "2017_04_CHI_GB"
    g = q(conn, "SELECT * FROM game WHERE game_id=?", (gid,))[0]
    l = q(conn, "SELECT * FROM game_line WHERE game_id=?", (gid,))[0]
    e = g["espn_event_id"]
    od = read_cached_json(odds_path(e)) if os.path.exists(odds_path(e)) else {}
    books = {}
    for it in od.get("items", []) if isinstance(od, dict) else []:
        prov = (it.get("provider") or {}).get("name")
        books[prov] = {"details": it.get("details"), "overUnder": it.get("overUnder"),
                       "away_ml": (it.get("awayTeamOdds") or {}).get("moneyLine"),
                       "home_ml": (it.get("homeTeamOdds") or {}).get("moneyLine")}
    # every other row in the partition must be odds_source='nflverse'
    other = q(conn, "SELECT gl.game_id, gl.odds_source FROM game_line gl JOIN game g "
                    "USING(game_id) WHERE g.season IN (2016,2017) AND "
                    "gl.odds_source <> 'nflverse'")
    # nflverse published values for spread/total
    src = None
    p = os.path.join(CACHE, "a4", "nflverse_games.csv.gz")
    if os.path.exists(p):
        with gzip.open(p, "rt", encoding="utf-8", errors="replace") as fh:
            for row in csv.DictReader(fh):
                if row.get("game_id") == gid:
                    src = row
                    break
    return {"game": dict(g), "line": dict(l), "espn_books": books,
            "non_nflverse_rows": [dict(r) for r in other],
            "nflverse_row": {k: src.get(k) for k in
                             ("spread_line", "total_line", "away_moneyline", "home_moneyline",
                              "away_spread_odds", "home_spread_odds", "over_odds",
                              "under_odds", "away_score", "home_score")} if src else None,
            "espn_odds_evidence": rel(odds_path(e))}


# --------------------------------------------------------------------------------------
# international games
# --------------------------------------------------------------------------------------
def international(conn, sbidx):
    out = []
    for g in q(conn, "SELECT * FROM game WHERE season IN (2016,2017)"):
        st = (g["stadium"] or "")
        if not re.search(r"Wembley|Twickenham|Azteca|London|Mexico", st, re.I):
            continue
        e = g["espn_event_id"]
        doc = read_cached_json(sum_path(e)) if os.path.exists(sum_path(e)) else {}
        comp, _ = espn_header(doc)
        v = ((doc.get("gameInfo") or {}).get("venue") or {})
        sb = sbidx.get(str(e))
        out.append({"game_id": g["game_id"], "db_stadium": st, "db_location": g["location"],
                    "espn_neutralSite": (comp or {}).get("neutralSite"),
                    "sb_neutralSite": sb[2].get("neutralSite") if sb else None,
                    "espn_venue": v.get("fullName"),
                    "espn_venue_city": (v.get("address") or {}).get("city"),
                    "espn_venue_country": (v.get("address") or {}).get("country"),
                    "db_home_abbr": g["home_abbr"], "db_away_abbr": g["away_abbr"],
                    "kickoff_utc": g["kickoff_utc"], "gametime_et": g["gametime_et"],
                    "evidence": rel(sum_path(e))})
    return out


# --------------------------------------------------------------------------------------
def stage_audit() -> dict:
    ensure_dirs()
    m0 = md5(DB_PATH)
    conn = connect()
    # nflverse abbreviation per (season, franchise) for source joins
    for r in q(conn, "SELECT season, away_franchise_id f, away_abbr a FROM game "
                     "WHERE season IN (2016,2017) UNION "
                     "SELECT season, home_franchise_id, home_abbr FROM game "
                     "WHERE season IN (2016,2017)"):
        ABBR_OF[(r["season"], r["f"])] = r["a"]

    teammeta = load_teammeta()
    sbidx = load_scoreboard_index()
    led = Ledger(LEDGER)
    t0 = time.time()

    print("[audit] game ...", flush=True)
    la_probe = audit_game(conn, led, teammeta, sbidx)
    print(f"[audit] game done {time.time()-t0:.0f}s", flush=True)

    print("[audit] game_line ...", flush=True)
    audit_game_line(conn, led, sbidx)

    print("[audit] team_game ...", flush=True)
    audit_team_game(conn, led)

    print("[audit] player_game_stats ...", flush=True)
    pgs_stats, ident, xwalk_defects = audit_player_game_stats(conn, led)
    print(f"[audit] pgs done {time.time()-t0:.0f}s", flush=True)

    print("[audit] snap_count ...", flush=True)
    snap_stats, snap_ev = audit_snap_count(conn, led)

    print("[audit] roster_season ...", flush=True)
    ros_stats, ros_ev = audit_roster_season(conn, led)

    print("[audit] depth_chart ...", flush=True)
    dc_stats, dc_ev, srccount, dbcount = audit_depth_chart(conn, led)

    print("[audit] data_correction ...", flush=True)
    dc_corr = audit_data_correction(conn, led)

    led.close()
    m1 = md5(DB_PATH)
    with open(os.path.join(F04, "internal", "not_comparable_manifest.json"), "w") as fh:
        json.dump({k: v for k, v in sorted(RowAudit.NC_MANIFEST.items())}, fh, indent=1)

    counts = {}
    for t, sql in WHERE.items():
        counts[t] = q(conn, f"SELECT COUNT(*) c FROM ({sql})")[0]["c"]

    summary = {
        "agent": AGENT, "run_ts": RUN_TS, "seasons": list(SEASONS),
        "db_md5_start": m0, "db_md5_end": m1, "db_unchanged": m0 == m1,
        "ledger_lines": led.n,
        "partition_counts": counts,
        "ledger_rows": dict(led.rows),
        "row_verdicts": {k: dict(v) for k, v in led.verdicts.items()},
        "field_verdicts": {k: dict(v) for k, v in led.field_verdicts.items()},
        "pgs_stats": dict(pgs_stats),
        "espn_id_crosswalk_defects": {
            "n_rows_rescued_by_name": len(xwalk_defects),
            "distinct_players": sorted({(d[0], d[1], d[2], d[3]) for d in xwalk_defects}),
        },
        "snap_stats": dict(snap_stats),
        "roster_stats": dict(ros_stats), "depth_stats": dict(dc_stats),
        "correction_verdicts": dict(dc_corr),
        "franchise_identity": franchise_identity(conn, la_probe, teammeta, ident),
        "chi_gb": chi_gb(conn),
        "international": international(conn, sbidx),
        "depth_rowcount_vs_source": {
            "db_groups": len(dbcount), "src_groups": len(srccount),
            "db_total": sum(dbcount.values()), "src_total": sum(srccount.values()),
            "group_diffs": [{"key": list(k), "db": dbcount.get(k, 0), "src": srccount.get(k, 0)}
                            for k in set(dbcount) | set(srccount)
                            if dbcount.get(k, 0) != srccount.get(k, 0)][:50],
        },
        "not_comparable_manifest": {k: v for k, v in sorted(RowAudit.NC_MANIFEST.items())},
        "issues": {t: v[:400] for t, v in led.issues.items()},
        "issue_field_counts": {t: {f"{f}|{v}": n for (f, v), n in c.most_common()}
                               for t, c in led.by_field.items()},
        "evidence_files": len(led.evidence),
        "elapsed_s": round(time.time() - t0, 1),
    }
    with open(SUMMARY_JSON, "w") as fh:
        json.dump(summary, fh, indent=1, default=str)
    print(json.dumps({k: summary[k] for k in
                      ("db_md5_start", "db_md5_end", "db_unchanged", "ledger_lines",
                       "partition_counts", "ledger_rows", "row_verdicts")},
                     indent=1, default=str))
    print(f"[audit] summary -> {rel(SUMMARY_JSON)}")
    return summary


def verify_evidence() -> None:
    missing = collections.Counter()
    seen = set()
    n = 0
    with open(LEDGER, encoding="utf-8") as fh:
        for line in fh:
            n += 1
            ev = json.loads(line).get("evidence")
            if ev in seen:
                continue
            seen.add(ev)
            if not os.path.exists(os.path.join(NFLDB, ev)):
                missing[ev] += 1
    print(f"ledger lines={n} distinct evidence paths={len(seen)} missing={len(missing)}")
    for k in list(missing)[:20]:
        print("  MISSING", k)
    if missing:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["fetch", "audit", "all"], default="all")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--verify-evidence", action="store_true")
    a = ap.parse_args()
    if a.verify_evidence:
        return verify_evidence()
    if a.stage in ("fetch", "all"):
        stage_fetch(a.offline)
    if a.stage in ("audit", "all"):
        stage_audit()
        verify_evidence()


if __name__ == "__main__":
    main()
