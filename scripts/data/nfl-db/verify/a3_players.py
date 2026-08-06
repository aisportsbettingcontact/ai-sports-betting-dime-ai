#!/usr/bin/env python3
"""
A3 - player identity verification against ESPN.

Read-only against nfl.db. Cache-backed and re-runnable: every ESPN response is
written under scripts/data/nfl-db/cache/a3/ and re-read on the next run rather
than re-fetched.

Modes
-----
  --fetch          fill the cache (network). Honours --limit and --sleep.
  (default)        verify from whatever is already cached; never touches network.

Exit codes
----------
  0  no identity mismatch found
  1  at least one identity mismatch (hard) found
  2  usage / environment error

Checks
------
  1. espn_id correctness   - ESPN athlete at that id is the same human as the
                             player row (name + birthdate/draft/college/pos/HW).
  2. same-name collisions  - every set of player rows sharing a display_name,
                             with the evidence that distinguishes them and the
                             fact-row attribution for each member.
  3. key uniqueness        - espn_id / pfr_id / esb_id mapping to >1 gsis_id
                             (and duplicate-person detection: one human split
                             across two gsis_ids).
  4. position + team hist  - DB position vs ESPN position; roster_season seasons
                             vs ESPN's own season/team log (statisticslog).
  5. prop-relevant players - >=200 player_game_stats rows, or 2023-2025
                             QB/RB/WR/TE, verified individually at 100%.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import queue
import re
import sqlite3
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # scripts/data/nfl-db
DB = os.path.join(ROOT, "nfl.db")
CACHE = os.path.join(ROOT, "cache", "a3")
ATH_DIR = os.path.join(CACHE, "athletes")
LOG_DIR = os.path.join(CACHE, "statlog")
COL_DIR = os.path.join(CACHE, "colleges")
SRCH_DIR = os.path.join(CACHE, "search")
MISS_PATH = os.path.join(CACHE, "misses.json")
FRAME_PATH = os.path.join(CACHE, "frame.json")

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
SEARCH = "https://site.web.api.espn.com/apis/search/v2"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) nfl-db-audit/a3"}

# --------------------------------------------------------------------------
# cache plumbing
# --------------------------------------------------------------------------


def _shard(dirpath: str, key: str) -> str:
    sub = key[-2:].rjust(2, "0")
    d = os.path.join(dirpath, sub)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{key}.json")


def cache_read(dirpath: str, key: str):
    p = _shard(dirpath, key)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return None


def cache_write(dirpath: str, key: str, obj) -> None:
    p = _shard(dirpath, key)
    tmp = p + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh)
    os.replace(tmp, p)


def load_misses() -> dict:
    if os.path.exists(MISS_PATH):
        try:
            with open(MISS_PATH) as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_misses(d: dict) -> None:
    os.makedirs(CACHE, exist_ok=True)
    tmp = MISS_PATH + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(d, fh, indent=0, sort_keys=True)
    os.replace(tmp, MISS_PATH)


def http_json(url: str, timeout: int = 25):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# --------------------------------------------------------------------------
# normalisation
# --------------------------------------------------------------------------

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# Common short-form / legal-name pairs seen between nflverse and ESPN. Each is a
# documented equivalence, not a fuzzy match: both sides refer to the same human.
NICKNAMES = {
    "mike": "michael", "chris": "christopher", "matt": "matthew", "nick": "nicholas",
    "rob": "robert", "bob": "robert", "bobby": "robert", "rob't": "robert",
    "will": "william", "bill": "william", "billy": "william", "willie": "william",
    "jim": "james", "jimmy": "james", "jamie": "james",
    "joe": "joseph", "joey": "joseph", "tom": "thomas", "tommy": "thomas",
    "dan": "daniel", "danny": "daniel", "dave": "david", "davey": "david",
    "steve": "steven", "stephen": "steven", "stevie": "steven",
    "ted": "theodore", "teddy": "theodore", "tony": "anthony",
    "ken": "kenneth", "kenny": "kenneth", "ron": "ronald", "ronnie": "ronald",
    "don": "donald", "donnie": "donald", "rick": "richard", "ricky": "richard",
    "dick": "richard", "richie": "richard", "greg": "gregory",
    "jeff": "jeffrey", "jon": "jonathan", "johnny": "john", "jack": "john",
    "ed": "edward", "eddie": "edward", "sam": "samuel", "sammy": "samuel",
    "ben": "benjamin", "benny": "benjamin", "alex": "alexander",
    "andy": "andrew", "drew": "andrew", "pat": "patrick", "patty": "patrick",
    "tim": "timothy", "timmy": "timothy", "phil": "phillip", "philip": "phillip",
    "zack": "zachary", "zach": "zachary", "cam": "cameron", "gabe": "gabriel",
    "nate": "nathan", "nat": "nathaniel", "vince": "vincent", "vinny": "vincent",
    "charlie": "charles", "chuck": "charles", "chas": "charles",
    "frank": "franklin", "fred": "frederick", "freddie": "frederick",
    "gus": "august", "hank": "henry", "larry": "lawrence", "lou": "louis",
    "marv": "marvin", "morris": "maurice", "pete": "peter", "ray": "raymond",
    "sol": "solomon", "walt": "walter", "wes": "wesley",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_name(s) -> str:
    if not s:
        return ""
    s = strip_accents(str(s)).lower()
    s = s.replace("&", " and ")
    # Apostrophes bind, they do not separate: Ja'Mori is one forename, not the
    # initial "Ja" plus "Mori". Splitting on them made "Ja'Mori Maclin" match
    # "Jeremy Maclin" through the initial-vs-name rule. Hyphens do separate
    # (Robertson-Harris), so they become spaces.
    s = re.sub(r"['‘’`]", "", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t]
    while toks and toks[-1] in SUFFIXES:
        toks.pop()
    return " ".join(toks)


def name_tokens(s) -> list:
    return [NICKNAMES.get(t, t) for t in norm_name(s).split()]


def _edit_distance_le(a: str, b: str, k: int) -> bool:
    """True when a and b are within k Damerau-Levenshtein edits - insert, delete,
    substitute, or transpose two adjacent characters. Transposition matters here
    because it is the commonest way a surname is mistyped (Tuimoloau /
    Tuimolaou). Used only on surnames, only at k=1, and only as corroboration
    alongside other evidence - never on its own."""
    if abs(len(a) - len(b)) > k:
        return False
    prev2, prev = None, list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            if (i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb):
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        if min(cur) > k:
            return False
        prev2, prev = prev, cur
    return prev[-1] <= k


def names_match(db_name: str, espn_name: str) -> tuple:
    """Return (match: bool, kind: str)."""
    a, b = norm_name(db_name), norm_name(espn_name)
    if not a or not b:
        return False, "missing"
    if a == b:
        return True, "exact"
    ta, tb = name_tokens(db_name), name_tokens(espn_name)
    if ta == tb:
        return True, "nickname"
    ra, rb = a.split(), b.split()          # raw tokens, before nickname folding
    if not ta or not tb:
        return False, "missing"
    # Surname must agree, but "agree" has to survive the ways the two sources
    # publish compound surnames: March / March-Lillard, Newman-Johnson / Newman,
    # Queiroz / Queiroz Neto, Decambra / De Cambra. Hyphens were turned into
    # spaces upstream, so the surname is "everything after the forename".
    sa, sb = ta[1:] or ta, tb[1:] or tb
    if ta[-1] != tb[-1]:
        joined_a, joined_b = "".join(sa), "".join(sb)
        if joined_a == joined_b:                      # Decambra / De Cambra
            return True, "surname.spacing"
        if set(sa) & set(sb):                         # March / March-Lillard
            return True, "surname.component"
        if joined_a.startswith(joined_b) or joined_b.startswith(joined_a):
            return True, "surname.prefix"
        if (min(len(joined_a), len(joined_b)) >= 6
                and _edit_distance_le(joined_a, joined_b, 1)):
            return True, "surname.spelling"           # Clarke/Clark, Bohringer
        return False, "surname"
    for fa, fb, tag in ((ta[0], tb[0], "nickname"), (ra[0], rb[0], "raw")):
        if fa == fb:
            return True, "middle"        # differing middle names only
        # initial-vs-name (T.J. Hockenson / Tyler Hockenson)
        if len(fa) <= 2 and fb.startswith(fa[0]):
            return True, "initial"
        if len(fb) <= 2 and fa.startswith(fb[0]):
            return True, "initial"
        # short form of the same forename (Cam / Camryn, Cam / Cameron)
        if len(fa) >= 3 and len(fb) >= 3 and (fa.startswith(fb) or fb.startswith(fa)):
            return True, f"prefix.{tag}"
    return False, "forename"


# position groups: DB position -> coarse group used for equivalence
POS_GROUP = {
    "QB": "QB",
    "RB": "RB", "FB": "RB", "HB": "RB",
    "WR": "WR",
    "TE": "TE",
    "T": "OL", "OT": "OL", "G": "OL", "OG": "OL", "C": "OL", "OL": "OL", "LS": "SPEC",
    "DE": "DL", "DT": "DL", "NT": "DL", "DL": "DL", "EDGE": "DL",
    "LB": "LB", "ILB": "LB", "OLB": "LB", "MLB": "LB",
    "CB": "DB", "S": "DB", "FS": "DB", "SS": "DB", "DB": "DB", "SAF": "DB",
    "K": "SPEC", "P": "SPEC", "PK": "SPEC", "KR": "SPEC", "PR": "SPEC",
}
# ESPN abbreviations that need mapping before POS_GROUP
ESPN_POS_ALIAS = {
    "PK": "K", "SAF": "S", "LS": "LS", "ATH": None, "-": None, "": None,
    "DL": "DL", "OL": "OL", "DB": "DB", "LB": "LB",
}


def pos_group(p) -> str:
    if not p:
        return ""
    p = str(p).strip().upper()
    p = ESPN_POS_ALIAS.get(p, p) or p
    return POS_GROUP.get(p, p)


COLLEGE_ALIAS = {
    # Each entry is a documented equivalence between how nflverse names a school
    # and how ESPN does. Note norm_college strips the word "state", so keys here
    # are already state-less.
    "nc": "north carolina", "app": "appalachian", "uconn": "connecticut",
    "umass amherst": "massachusetts", "umass": "massachusetts",
    "nw missouri": "northwest missouri", "se missouri": "southeast missouri",
    "sw missouri": "southwest missouri", "ne louisiana": "northeast louisiana",
    "miami ohio": "miami oh", "louisiana lafayette": "louisiana",
    "louisiana monroe": "ul monroe", "west texas": "west texas am",
    "indiana pa": "iu pennsylvania", "pitt": "pittsburgh",
    "usc": "southern california", "southern cal": "southern california",
    "ucf": "central florida", "unlv": "nevada las vegas", "utep": "texas el paso",
    "utsa": "texas san antonio", "smu": "southern methodist", "tcu": "texas christian",
    "lsu": "louisiana state", "byu": "brigham young", "ole miss": "mississippi",
    "miami fl": "miami", "miami florida": "miami", "miami oh": "miami ohio",
    "pitt": "pittsburgh", "cal": "california", "nc state": "north carolina state",
    "north carolina st": "north carolina state", "penn st": "penn state",
    "ohio st": "ohio state", "michigan st": "michigan state",
    "st johns": "saint johns", "texas a m": "texas am", "texas a and m": "texas am",
    "louisiana lafayette": "louisiana", "ul lafayette": "louisiana",
    "louisiana monroe": "ul monroe", "middle tennessee state": "middle tennessee",
    "san jose st": "san jose state", "boise st": "boise state",
    "florida intl": "florida international", "fiu": "florida international",
    "hawaii": "hawai i", "hawai i": "hawaii",
}


def norm_college(s) -> str:
    if not s:
        return ""
    s = strip_accents(str(s)).lower()
    s = re.sub(r"['‘’]", "", s)                       # Hawai'i -> hawaii
    s = re.sub(r"\b(university|univ|college|of|the|at|state)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = s.split()
    # collapse runs of single letters: "n c" -> "nc" (N.C. State / NC State)
    out, run = [], []
    for t in toks:
        if len(t) == 1:
            run.append(t)
        else:
            if run:
                out.append("".join(run))
                run = []
            out.append(t)
    if run:
        out.append("".join(run))
    s = " ".join(out)
    return COLLEGE_ALIAS.get(s, s)


def college_variants(s) -> set:
    """nflverse packs a player's whole college history into one field, separated
    by semicolons ("West Virginia; Lackawanna JC"). ESPN names one school. Each
    component is normalised and aliased separately so either can match."""
    if not s:
        return set()
    parts = [p for p in re.split(r"[;/]", str(s)) if p.strip()]
    out = set()
    for p in parts + [str(s)]:
        n = norm_college(p)
        if n:
            out.add(n)
            out.add(COLLEGE_ALIAS.get(n, n))
    return {v for v in out if v}


def colleges_match(a, b) -> bool:
    va, vb = college_variants(a), college_variants(b)
    if not va or not vb:
        return True                       # not evidence either way
    if va & vb:
        return True
    for x in va:
        for y in vb:
            if len(x) >= 4 and len(y) >= 4 and (x.startswith(y) or y.startswith(x)):
                return True
            if x in y or y in x:
                return True
            # shared distinctive token ("appalachian", "massachusetts")
            tx, ty = set(x.split()), set(y.split())
            if any(len(t) >= 6 for t in tx & ty):
                return True
    return False


def espn_dob(a) -> str:
    v = a.get("dateOfBirth")
    if not v:
        return ""
    return str(v)[:10]


def dob_delta_days(a: str, b: str):
    from datetime import date
    try:
        ya, ma, da = (int(x) for x in a.split("-")[:3])
        yb, mb, db_ = (int(x) for x in b.split("-")[:3])
        return abs((date(ya, ma, da) - date(yb, mb, db_)).days)
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------
# DB access (read-only)
# --------------------------------------------------------------------------


def connect():
    if not os.path.exists(DB):
        sys.exit(f"[a3] missing db: {DB}")
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def load_players(con):
    return {r["gsis_id"]: dict(r) for r in con.execute("SELECT * FROM player")}


def load_volumes(con):
    pgs = {r[0]: r[1] for r in con.execute(
        "SELECT gsis_id, COUNT(*) FROM player_game_stats GROUP BY gsis_id")}
    snp = {r[0]: r[1] for r in con.execute(
        "SELECT gsis_id, COUNT(*) FROM snap_count GROUP BY gsis_id")}
    ros = {r[0]: r[1] for r in con.execute(
        "SELECT gsis_id, COUNT(*) FROM roster_season GROUP BY gsis_id")}
    dep = {r[0]: r[1] for r in con.execute(
        "SELECT gsis_id, COUNT(*) FROM depth_chart GROUP BY gsis_id")}
    return pgs, snp, ros, dep


def load_pgs_seasons(con):
    d = defaultdict(set)
    for gid, season, fid in con.execute(
            "SELECT gsis_id, season, franchise_id FROM player_game_stats "
            "WHERE franchise_id IS NOT NULL GROUP BY gsis_id, season, franchise_id"):
        d[gid].add((season, fid))
    return d


def prop_relevant(con):
    """gsis_ids that must be verified at 100% regardless of sampling."""
    heavy = {r[0] for r in con.execute(
        "SELECT gsis_id FROM player_game_stats GROUP BY gsis_id HAVING COUNT(*) >= 200")}
    skill = {r[0] for r in con.execute("""
        SELECT gsis_id FROM player_game_stats
        WHERE season BETWEEN 2023 AND 2025
          AND position_group IN ('QB','RB','WR','TE')
        GROUP BY gsis_id""")}
    return heavy, skill


# --------------------------------------------------------------------------
# fetch frame: priority order == stratification
# --------------------------------------------------------------------------


def build_frame(con):
    players = load_players(con)
    pgs, snp, ros, dep = load_volumes(con)
    heavy, skill = prop_relevant(con)

    namesets = defaultdict(list)
    for gid, p in players.items():
        namesets[norm_name(p["display_name"])].append(gid)
    collision = {g for k, v in namesets.items() if len(v) > 1 and k for g in v}

    def tier(gid):
        p = players[gid]
        if gid in heavy:
            return 0                       # >=200 player_game_stats rows
        if gid in skill:
            return 1                       # 2023-2025 QB/RB/WR/TE
        if gid in collision:
            return 2                       # same-name collision member
        n = pgs.get(gid, 0)
        if n >= 100:
            return 3
        if n >= 25:
            return 4
        if n > 0:
            return 5
        if snp.get(gid, 0) or ros.get(gid, 0):
            return 6                       # roster/snap presence, no game stats
        return 7                           # no fact rows at all

    rows = []
    tiers = {}
    for gid, p in players.items():
        eid = (p.get("espn_id") or "").strip()
        if not eid:
            continue
        t = tier(gid)
        tiers[gid] = t
        rows.append((t, -pgs.get(gid, 0), -(p.get("last_season") or 0), eid, gid))
    rows.sort()
    return ([(r[3], r[4]) for r in rows], players, (pgs, snp, ros, dep),
            (heavy, skill), namesets, tiers)


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------


def fetch_all(targets, sleep, workers, want_statlog, limit, quiet=False):
    misses = load_misses()
    todo = []
    for eid, gid in targets:
        if cache_read(ATH_DIR, eid) is None and misses.get(f"ath:{eid}") is None:
            todo.append(("ath", eid))
    if want_statlog:
        for eid, gid in want_statlog:
            if cache_read(LOG_DIR, eid) is None and misses.get(f"log:{eid}") is None:
                todo.append(("log", eid))
    if limit:
        todo = todo[:limit]
    if not todo:
        print("[a3] cache complete for this frame; nothing to fetch")
        return
    print(f"[a3] fetching {len(todo)} documents "
          f"({workers} workers, {sleep}s sleep)", flush=True)

    q = queue.Queue()
    for t in todo:
        q.put(t)
    lock = threading.Lock()
    state = {"done": 0, "err": 0, "t0": time.time()}

    def work():
        while True:
            try:
                kind, eid = q.get_nowait()
            except queue.Empty:
                return
            url = (f"{CORE}/athletes/{eid}" if kind == "ath"
                   else f"{CORE}/athletes/{eid}/statisticslog")
            d = None
            err = None
            for attempt in range(3):
                try:
                    d = http_json(url)
                    break
                except urllib.error.HTTPError as e:
                    err = f"HTTP {e.code}"
                    if e.code in (400, 404):
                        break
                    time.sleep(1.5 * (attempt + 1))
                except Exception as e:                      # noqa: BLE001
                    err = f"{type(e).__name__}: {e}"
                    time.sleep(1.5 * (attempt + 1))
            with lock:
                if d is not None:
                    cache_write(ATH_DIR if kind == "ath" else LOG_DIR, eid, d)
                else:
                    misses[f"{kind}:{eid}"] = err
                    state["err"] += 1
                state["done"] += 1
                n = state["done"]
                if not quiet and (n % 250 == 0 or n == len(todo)):
                    el = time.time() - state["t0"]
                    rate = n / el if el else 0
                    print(f"[a3] {n}/{len(todo)}  {rate:.1f}/s  "
                          f"eta {(len(todo)-n)/rate/60:.1f}m  err={state['err']}", flush=True)
                    save_misses(misses)
            time.sleep(sleep)

    ths = [threading.Thread(target=work, daemon=True) for _ in range(workers)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    save_misses(misses)
    print(f"[a3] fetch done: {state['done']} docs, {state['err']} errors")


def fetch_colleges(quiet=False):
    """Resolve every college $ref seen in the athlete cache to a name."""
    ids = set()
    for sub in sorted(os.listdir(ATH_DIR)) if os.path.isdir(ATH_DIR) else []:
        d = os.path.join(ATH_DIR, sub)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(d, fn)) as fh:
                    a = json.load(fh)
            except (json.JSONDecodeError, OSError):
                continue
            cid = college_id(a)
            if cid:
                ids.add(cid)
    todo = [c for c in sorted(ids) if cache_read(COL_DIR, c) is None]
    if not todo:
        return
    print(f"[a3] resolving {len(todo)} colleges", flush=True)
    for i, cid in enumerate(todo, 1):
        try:
            cache_write(COL_DIR, cid, http_json(f"https://sports.core.api.espn.com/v2/colleges/{cid}"))
        except Exception as e:                                # noqa: BLE001
            cache_write(COL_DIR, cid, {"id": cid, "error": str(e)})
        time.sleep(0.05)
        if not quiet and i % 100 == 0:
            print(f"[a3] colleges {i}/{len(todo)}", flush=True)


def search_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", norm_name(name)) or "x"


def espn_search_queries(p) -> list:
    """Query strings to try, widest-evidence first.

    ESPN's index keys on its own spelling, so a middle initial or a source-side
    misspelling in `display_name` can return nothing. Falling back to first+last
    and to last-name-only recovers those without loosening the *match* test,
    which still runs against every candidate's full record.
    """
    qs = [p["display_name"]]
    toks = norm_name(p["display_name"]).split()
    if len(toks) > 2:
        qs.append(f"{toks[0]} {toks[-1]}")
    fn, ln = (p.get("first_name") or "").strip(), (p.get("last_name") or "").strip()
    if fn and ln:
        qs.append(f"{fn} {ln}")
    if ln:
        qs.append(ln)
    out, seen = [], set()
    for q in qs:
        if q and q.lower() not in seen:
            seen.add(q.lower())
            out.append(q)
    return out


def espn_search_nfl_ids(name: str, fetch: bool):
    """NFL athlete ids matching `name`, from the cached ESPN search index."""
    key = search_key(name)
    d = cache_read(SRCH_DIR, key)
    if d is None:
        if not fetch:
            return None
        q = urllib.parse.quote(name)
        try:
            d = http_json(f"{SEARCH}?query={q}&limit=40&region=us&lang=en")
        except Exception as e:                                # noqa: BLE001
            d = {"error": str(e)}
        cache_write(SRCH_DIR, key, d)
        time.sleep(0.3)
    ids = []
    for res in d.get("results", []):
        if res.get("type") != "player":
            continue
        for c in res.get("contents", []):
            uid = c.get("uid") or ""
            m = re.match(r"s:20~l:28~a:(\d+)$", uid)          # sport 20 / league 28 = NFL
            if not m:
                continue
            ok, _kind = names_match(name, c.get("displayName"))
            if ok:
                ids.append(m.group(1))
    return ids


def resolve_missing(fetch: bool):
    """Players with no espn_id but >=1 fact row: try to resolve them by name.

    These are the only rows in the no-espn_id population that can carry a live
    misattribution, so each one is resolved and reported individually.
    """
    con = connect()
    players = load_players(con)
    pgs, snp, ros, dep = load_volumes(con)
    targets = [g for g, p in players.items()
               if not (p.get("espn_id") or "").strip()
               and (pgs.get(g, 0) or snp.get(g, 0) or ros.get(g, 0) or dep.get(g, 0))]
    out = {}
    for gid in sorted(targets, key=lambda g: -pgs.get(g, 0)):
        p = players[gid]
        ids, queried, missing = [], [], False
        for q in espn_search_queries(p):
            got = espn_search_nfl_ids(q, fetch)
            queried.append(q)
            if got is None:
                missing = True
                continue
            for e in got:
                if e not in ids:
                    ids.append(e)
            if ids:
                break
        if not ids and missing:
            out[gid] = {"status": "NOT_SEARCHED", "name": p["display_name"]}
            continue
        cands = []
        for eid in ids:
            a = cache_read(ATH_DIR, eid)
            if a is None:
                if not fetch:
                    continue
                try:
                    a = http_json(f"{CORE}/athletes/{eid}")
                    cache_write(ATH_DIR, eid, a)
                except Exception:                             # noqa: BLE001
                    continue
                time.sleep(0.15)
            cands.append((eid, a, compare(p, a)))
        good = [c for c in cands if c[2]["verdict"] in (OK, SOFT)]
        out[gid] = {
            "name": p["display_name"], "pos": p["position"], "dob": p["birth_date"],
            "queries": queried,
            "facts": {"pgs": pgs.get(gid, 0), "snap": snp.get(gid, 0),
                      "roster": ros.get(gid, 0), "depth": dep.get(gid, 0)},
            "candidates": [{"espn_id": e, "espn_name": a.get("displayName"),
                            "espn_pos": espn_position(a), "espn_dob": espn_dob(a),
                            "verdict": r["verdict"], "reasons": r["reasons"],
                            "corr": r["corr"]} for e, a, r in cands],
            "status": ("RESOLVED_UNIQUE" if len(good) == 1 else
                       "RESOLVED_AMBIGUOUS" if len(good) > 1 else
                       "UNRESOLVED_NO_ESPN_MATCH" if cands else "UNRESOLVED_NOT_IN_INDEX"),
            "resolved_espn_id": good[0][0] if len(good) == 1 else None,
        }
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "missing_espn_resolution.json"), "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True, default=str)
    tally = defaultdict(int)
    for v in out.values():
        tally[v["status"]] += 1
    print(json.dumps({"targets": len(targets), **tally}, indent=1))
    return out


def cross_source_espn(fetch: bool):
    """Adjudicate the espn_id crosswalk against nflverse's *other* espn_id column.

    `player.espn_id` comes from raw/players.csv. raw/rosters.csv carries its own
    independent espn_id per roster row. Where the two disagree, one of them maps
    the player to the wrong human - so every disagreement is resolved by asking
    ESPN which id actually describes this player.
    """
    con = connect()
    players = load_players(con)
    pgs, *_ = load_volumes(con)
    roster = defaultdict(set)
    path = os.path.join(ROOT, "raw", "rosters.csv")
    if not os.path.exists(path):
        sys.exit(f"[a3] missing {path}")
    csv.field_size_limit(10 ** 7)
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            g, e = (r.get("gsis_id") or "").strip(), (r.get("espn_id") or "").strip()
            if g and e:
                roster[g].add(e)

    tally = defaultdict(int)
    disagreements = {}
    for gid, p in players.items():
        pe = (p.get("espn_id") or "").strip()
        rs = roster.get(gid, set())
        if not rs:
            tally["no_roster_espn_id"] += 1
            continue
        if not pe:
            tally["player_blank_roster_has"] += 1
            disagreements[gid] = {"player_csv": None, "roster_csv": sorted(rs)}
            continue
        if rs == {pe}:
            tally["agree"] += 1
        else:
            tally["disagree"] += 1
            disagreements[gid] = {"player_csv": pe, "roster_csv": sorted(rs - {pe})}

    out = {}
    for gid, d in sorted(disagreements.items()):
        p = players[gid]
        cands = {}
        for label, eids in (("players.csv", [d["player_csv"]] if d["player_csv"] else []),
                            ("rosters.csv", d["roster_csv"])):
            for eid in eids:
                a = cache_read(ATH_DIR, eid)
                if a is None and fetch:
                    try:
                        a = http_json(f"{CORE}/athletes/{eid}")
                        cache_write(ATH_DIR, eid, a)
                    except Exception as e:                       # noqa: BLE001
                        cands[f"{label}:{eid}"] = {"verdict": "ESPN_404_OR_ERROR",
                                                   "error": str(e)}
                        continue
                    time.sleep(0.2)
                if a is None:
                    cands[f"{label}:{eid}"] = {"verdict": "NOT_CACHED"}
                    continue
                r = compare(p, a)
                cands[f"{label}:{eid}"] = {
                    "verdict": r["verdict"], "espn_name": a.get("displayName"),
                    "espn_pos": espn_position(a), "espn_dob": espn_dob(a),
                    "reasons": r["reasons"]}
        good = [k for k, v in cands.items() if v["verdict"] in (OK, SOFT)]
        winner = ("players.csv" if len(good) == 1 and good[0].startswith("players.csv")
                  else "rosters.csv" if len(good) == 1 else
                  "BOTH_MATCH" if len(good) > 1 else "NEITHER_MATCHES")
        out[gid] = {"name": p["display_name"], "pos": p["position"],
                    "dob": p["birth_date"], "pgs_rows": pgs.get(gid, 0),
                    "db_value": d["player_csv"], "roster_value": d["roster_csv"],
                    "candidates": cands, "correct_source": winner}
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "cross_source_espn.json"), "w") as fh:
        json.dump({"tally": dict(tally), "disagreements": out}, fh,
                  indent=1, sort_keys=True, default=str)
    verdicts = defaultdict(int)
    for v in out.values():
        verdicts[v["correct_source"]] += 1
    print(json.dumps({"tally": dict(tally), "resolution": dict(verdicts)}, indent=1))
    return out


def college_id(a):
    c = a.get("college")
    if isinstance(c, dict):
        if c.get("id"):
            return str(c["id"])
        ref = c.get("$ref") or ""
        m = re.search(r"/colleges/(\d+)", ref)
        if m:
            return m.group(1)
    return None


_COL_CACHE = {}


def college_name(a):
    c = a.get("college")
    if isinstance(c, dict) and c.get("name"):
        return c["name"]
    cid = college_id(a)
    if not cid:
        return ""
    if cid not in _COL_CACHE:
        d = cache_read(COL_DIR, cid) or {}
        _COL_CACHE[cid] = d.get("name") or d.get("shortName") or ""
    return _COL_CACHE[cid]


def espn_position(a):
    """ESPN's position abbreviation, or "" when ESPN has none.

    ESPN emits abbreviation "-" (displayName "No Position") for most players who
    left the league before it began tracking positions. That is an ESPN-side gap,
    not evidence of a mismatch, so it is normalised to absent.
    """
    p = a.get("position")
    if not isinstance(p, dict):
        return ""
    v = (p.get("abbreviation") or "").strip()
    if v in ("", "-", "ATH", "N/A"):
        return ""
    return v


def statlog_seasons(eid):
    """-> set of (season, espn_team_id) from the cached statisticslog."""
    d = cache_read(LOG_DIR, eid)
    if d is None:
        return None
    out = set()
    for e in d.get("entries", []):
        ref = (e.get("season") or {}).get("$ref", "")
        m = re.search(r"/seasons/(\d{4})", ref)
        if not m:
            continue
        yr = int(m.group(1))
        teams = set()
        for s in e.get("statistics", []):
            tref = (s.get("team") or {}).get("$ref", "")
            tm = re.search(r"/teams/(\d+)", tref)
            if tm:
                teams.add(int(tm.group(1)))
        if teams:
            for t in teams:
                out.add((yr, t))
        else:
            out.add((yr, None))
    return out


# --------------------------------------------------------------------------
# per-player comparison
# --------------------------------------------------------------------------

HARD = "MISMATCH"
SOFT = "CONFLICT"
WEAK = "WEAK"
OK = "OK"


def compare(p, a):
    """Compare a player row against an ESPN athlete doc.

    Returns dict(verdict, reasons[], corroborators[]).
    """
    reasons, corr = [], []

    ok_name, kind = names_match(p["display_name"], a.get("displayName") or a.get("fullName"))
    if not ok_name:
        reasons.append(f"name: db='{p['display_name']}' espn='{a.get('displayName')}' ({kind})")
    elif kind != "exact":
        corr.append(f"name~{kind}")
    surname_ok = kind != "surname" and kind != "missing"

    # birthdate - the strongest single discriminator
    db_dob = (p.get("birth_date") or "").strip()
    e_dob = espn_dob(a)
    dob_delta = None
    dob_same_md = False
    if db_dob and e_dob:
        dob_delta = delta = dob_delta_days(db_dob[:10], e_dob)
        # Same month and day with a different year is the signature of a
        # transcription error, not of two people: the odds of two same-named
        # players sharing a birthday to the day are ~1/365.
        dob_same_md = (db_dob[5:10] == e_dob[5:10]
                       and db_dob[:4] != e_dob[:4]
                       and abs(int(db_dob[:4]) - int(e_dob[:4])) <= 5)
        if delta == 0:
            corr.append("dob")
        elif delta is not None and delta <= 1:
            corr.append("dob~1d")
        elif dob_same_md:
            corr.append("dob~year")
            reasons.append(f"birth_date: db={db_dob} espn={e_dob}")
        else:
            reasons.append(f"birth_date: db={db_dob} espn={e_dob}")

    # era - the decisive discriminator between "same human, bad field" and
    # "different human". ESPN's debutYear (or draft year) against nflverse's
    # rookie_year. NFL careers run 1-20 seasons; a gap of 4+ years between the
    # two sources' idea of when this person entered the league means they are
    # not describing the same person, whatever the name says.
    d = a.get("draft") or {}
    e_dy, e_dr, e_dp = d.get("year"), d.get("round"), d.get("selection")
    db_dy, db_dr, db_dp = p.get("draft_year"), p.get("draft_round"), p.get("draft_pick")
    db_dy = int(db_dy) if str(db_dy or "").strip().isdigit() else None
    db_dr = int(db_dr) if str(db_dr or "").strip().isdigit() else None
    db_dp = int(db_dp) if str(db_dp or "").strip().isdigit() else None

    def _yr(v):
        try:
            v = int(v)
            return v if 1930 <= v <= 2035 else None
        except (TypeError, ValueError):
            return None

    e_era = _yr(a.get("debutYear")) or _yr(e_dy)
    db_era = _yr(p.get("rookie_year")) or _yr(db_dy)
    era_gap = abs(e_era - db_era) if (e_era and db_era) else None
    if era_gap is not None:
        if era_gap <= 1:
            corr.append("era")
        elif era_gap >= 4:
            reasons.append(f"era: db_rookie={db_era} espn_debut={e_era} (gap {era_gap}y)")
        else:
            reasons.append(f"era~: db_rookie={db_era} espn_debut={e_era} (gap {era_gap}y)")

    # draft - year/round/pick triple.
    # ESPN encodes `selection` as the overall pick for modern drafts but as the
    # pick WITHIN the round for older ones (2001-2005 in this data). Both are
    # accepted; only a round or year disagreement is treated as evidence.
    if db_dy and e_dy:
        if db_dy == e_dy:
            if db_dr and e_dr and db_dr != e_dr:
                reasons.append(
                    f"draft: db={db_dy}/{db_dr}/{db_dp} espn={e_dy}/{e_dr}/{e_dp}")
            elif (db_dp and e_dp and db_dp != e_dp
                  and not (e_dp < db_dp and db_dp - e_dp >= 30)):
                reasons.append(
                    f"draft: db={db_dy}/{db_dr}/{db_dp} espn={e_dy}/{e_dr}/{e_dp}")
            else:
                corr.append("draft")
        else:
            reasons.append(f"draft_year: db={db_dy} espn={e_dy}")

    # college
    e_col = college_name(a)
    if p.get("college") and e_col:
        if colleges_match(p["college"], e_col):
            corr.append("college")
        else:
            reasons.append(f"college: db='{p['college']}' espn='{e_col}'")

    # position
    e_pos = espn_position(a)
    if p.get("position") and e_pos:
        if str(p["position"]).upper() == str(e_pos).upper():
            corr.append("pos")
        elif pos_group(p["position"]) and pos_group(p["position"]) == pos_group(e_pos):
            corr.append("pos_group")
        else:
            reasons.append(f"position: db={p['position']} espn={e_pos}")

    # height / weight - drifty, tolerant
    try:
        h_db = int(p["height"]) if p.get("height") else None
        h_e = int(a["height"]) if a.get("height") else None
        if h_db and h_e:
            if abs(h_db - h_e) <= 1:
                corr.append("height")
            elif abs(h_db - h_e) >= 3:
                reasons.append(f"height: db={h_db} espn={h_e}")
    except (TypeError, ValueError):
        pass
    try:
        w_db = int(p["weight"]) if p.get("weight") else None
        w_e = int(a["weight"]) if a.get("weight") else None
        if w_db and w_e:
            if abs(w_db - w_e) <= 10:
                corr.append("weight")
            elif abs(w_db - w_e) >= 30:
                reasons.append(f"weight: db={w_db} espn={w_e}")
    except (TypeError, ValueError):
        pass

    # ---- classify -------------------------------------------------------
    # MISMATCH means "the ESPN athlete at this id is a DIFFERENT HUMAN".
    # CONFLICT means "same human, but the two sources disagree on a field" -
    # a contradiction to report, per standing rule 4, not a misattribution.
    #
    # A birth_date disagreement is normally decisive evidence of a different
    # human. It is demoted to a contradiction only when identity is already
    # pinned by evidence a coincidence cannot produce: the same name plus an
    # exact draft year+round+pick triple, or the same name plus agreement on
    # position AND height AND weight AND debut year.
    cset = set(corr)
    physical = {"pos", "pos_group", "height", "weight", "college"} & cset

    # Identity is "pinned" when the evidence could not plausibly be produced by
    # a coincidence between two different humans. Three independent routes:
    #   1. same name + exact draft year/round/pick
    #   2. same name + same entry era + two or more physical attributes
    #   3. same surname + exact birthdate + strong corroboration, which settles
    #      identity even when the forename differs (legal name vs the name ESPN
    #      publishes: Marquise/Hollywood Brown, Jay/Jeremiah Ratliff)
    dob_ok = bool({"dob", "dob~1d"} & cset)
    pinned_by_name = ok_name and (
        "draft" in cset
        or ("era" in cset and len(physical) >= 2)
        or (dob_ok and (physical or "era" in cset))
        # a birthdate slip of under two months, with build and position agreeing:
        # a transcription difference, not a different person
        or (dob_delta is not None and dob_delta <= 60 and len(physical) >= 2)
        # a wider slip still counts if build agrees exactly on both dimensions
        or (dob_delta is not None and dob_delta <= 400 and len(physical) >= 2
            and {"height", "weight"} <= cset)
        # same month and day, year off by a few - the classic year typo
        or ("dob~year" in cset and (len(physical) >= 2
                                    or ("era" in cset and physical)))
    )
    pinned_by_dob = (surname_ok and dob_ok
                     and ("draft" in cset or len(physical) >= 2))
    identity_pinned = pinned_by_name or pinned_by_dob

    STRONG = {"dob", "dob~1d", "draft", "era"}
    MEDIUM = {"draft_year", "college", "pos", "height", "weight"}
    hard_fields = ("name", "birth_date", "draft", "draft_year", "era")
    hard = [r for r in reasons if r.split(":")[0] in hard_fields]
    demoted = []
    if identity_pinned:
        # Identity is settled, so a disagreeing birth_date, a disagreeing entry
        # year, or a forename ESPN publishes differently is a source
        # contradiction, not a wrong human.
        demote_fields = {"birth_date"} | ({"name"} if pinned_by_dob else set())
        if dob_ok:
            demote_fields.add("era")     # dob is the stronger of the two
        demoted = [r for r in hard if r.split(":")[0] in demote_fields]
        hard = [r for r in hard if r not in demoted]
    soft = [r for r in reasons if r not in hard]

    if hard or (not ok_name and not pinned_by_dob):
        verdict = HARD
    elif STRONG & cset or identity_pinned:
        verdict = SOFT if soft else OK
    elif len(MEDIUM & cset) >= 2:
        verdict = SOFT if soft else OK
    else:
        verdict = WEAK
    return {"verdict": verdict, "reasons": reasons, "hard": hard, "soft": soft,
            "corr": corr, "identity_pinned": identity_pinned,
            "demoted": demoted}


# --------------------------------------------------------------------------
# verification
# --------------------------------------------------------------------------


def verify(args):
    con = connect()
    targets, players, vols, prop, namesets, tiers = build_frame(con)
    pgs, snp, ros, dep = vols
    heavy, skill = prop

    results = {}
    fetched = 0
    for eid, gid in targets:
        a = cache_read(ATH_DIR, eid)
        if a is None:
            continue
        fetched += 1
        results[gid] = compare(players[gid], a)
        results[gid]["espn_id"] = eid
        results[gid]["espn_name"] = a.get("displayName")
        results[gid]["espn_pos"] = espn_position(a)
        results[gid]["espn_dob"] = espn_dob(a)

    hard = {g: r for g, r in results.items() if r["verdict"] == HARD}
    soft = {g: r for g, r in results.items() if r["verdict"] == SOFT}
    weak = {g: r for g, r in results.items() if r["verdict"] == WEAK}

    # ---- key uniqueness -------------------------------------------------
    keydupes = {}
    for col in ("espn_id", "pfr_id", "esb_id"):
        m = defaultdict(list)
        for gid, p in players.items():
            v = (p.get(col) or "").strip()
            if v:
                m[v].append(gid)
        keydupes[col] = {k: v for k, v in m.items() if len(v) > 1}

    # duplicate persons: same normalised name + same birth_date, two gsis_ids
    dupperson = defaultdict(list)
    for gid, p in players.items():
        bd = (p.get("birth_date") or "").strip()
        if bd:
            dupperson[(norm_name(p["display_name"]), bd)].append(gid)
    dupperson = {k: v for k, v in dupperson.items() if len(v) > 1}

    # ---- same-name collisions -------------------------------------------
    collisions = {k: v for k, v in namesets.items() if len(v) > 1 and k}
    coll = analyse_collisions(collisions, players, pgs, results)
    swaps = gap_fill_swaps(con, collisions, players)
    swaps_bad = [s for s in swaps if s["verdict"] == "MISATTRIBUTION"]
    snapx = snap_crosswalk_failures(con)

    # ---- roster_season vs ESPN season log --------------------------------
    ps = load_pgs_seasons(con)
    # roster_season is a final-week snapshot, so it legitimately records a team a
    # player never played a game for. Restricting to status ACT and to seasons
    # ESPN itself covers makes it a fair test of "credited with a season on a
    # team they never played for".
    rs_act = defaultdict(set)
    for gid, season, fid in con.execute(
            "SELECT gsis_id, season, franchise_id FROM roster_season "
            "WHERE gsis_id IS NOT NULL AND franchise_id IS NOT NULL AND status = 'ACT' "
            "GROUP BY gsis_id, season, franchise_id"):
        rs_act[gid].add((season, fid))
    teamhist = {"checked": 0, "no_log": 0, "clean": 0,
                "wrong_team": {}, "before_espn_debut": {}, "roster_wrong_team": {}}
    for gid, r in results.items():
        sl = statlog_seasons(r["espn_id"])
        if sl is None:
            continue
        teamhist["checked"] += 1
        espn_pairs = {(y, t) for (y, t) in sl if t is not None}
        espn_years = {y for (y, _) in sl}
        if not espn_pairs:
            # ESPN carries no season log for this athlete (common when ESPN has
            # a duplicate record for the same human and only one holds stats).
            # Absence of a log is not evidence of anything.
            teamhist["no_log"] += 1
            continue
        db_pairs = ps.get(gid, set())
        # (a) a season ESPN does cover, but on a team ESPN never lists
        wrong = sorted((y, t) for (y, t) in db_pairs
                       if y in espn_years and (y, t) not in espn_pairs)
        # (b) a season that predates ESPN's first record of this athlete by 2+
        #     years - ESPN says this person was not in the league yet
        first = min(espn_years)
        early = sorted((y, t) for (y, t) in db_pairs if y < first - 1)
        rec = {"espn": sorted(espn_pairs), "name": players[gid]["display_name"],
               "espn_id": r["espn_id"]}
        # (c) roster_season: an ACT roster row on a team ESPN never lists for a
        #     season ESPN does cover
        rwrong = sorted((y, t) for (y, t) in rs_act.get(gid, set())
                        if y in espn_years and (y, t) not in espn_pairs)
        if wrong:
            teamhist["wrong_team"][gid] = rec | {"db_unmatched": wrong}
        if early:
            teamhist["before_espn_debut"][gid] = rec | {"db_early": early}
        if rwrong:
            teamhist["roster_wrong_team"][gid] = rec | {"roster_unmatched": rwrong}
        if not wrong and not early and not rwrong:
            teamhist["clean"] += 1

    summary = {
        "db_players": len(players),
        "with_espn_id": len(targets),
        "verified": len(results),
        "OK": len(results) - len(hard) - len(soft) - len(weak),
        "MISMATCH": len(hard),
        "CONFLICT": len(soft),
        "WEAK": len(weak),
        "misses": len(load_misses()),
        "key_dupes": {k: len(v) for k, v in keydupes.items()},
        "dup_persons": len(dupperson),
        "name_collision_sets": len(collisions),
        "collision_buckets": coll["buckets"],
        "collision_risky": len(coll["risky"]),
        "collision_high_risk_live": len(coll["high_risk_live"]),
        "gap_fill_candidates": len(swaps),
        "gap_fill_misattributions": len(swaps_bad),
        "snap_impossible_weeks": len(snapx["impossible_weeks"]),
        "snap_super_bowl_swapped_seasons": snapx["super_bowl_swapped_seasons"],
        "snap_super_bowl_swapped_rows": snapx["super_bowl_swapped_rows"],
        "snap_non_sb_team_disagreements": len(snapx["non_sb_team_disagreements"]),
        "snap_pfr_swap_candidates": len(snapx["position_swap_candidates"]),
        "teamhist": {k: (len(v) if isinstance(v, dict) else v) for k, v in teamhist.items()},
    }

    out = {
        "summary": summary,
        "mismatch": {g: results[g] | {"db_name": players[g]["display_name"],
                                      "db_pos": players[g]["position"],
                                      "db_dob": players[g]["birth_date"]} for g in hard},
        "conflict": {g: results[g] | {"db_name": players[g]["display_name"]} for g in soft},
        "weak": {g: results[g] | {"db_name": players[g]["display_name"]} for g in weak},
        "key_dupes": keydupes,
        "dup_persons": {f"{k[0]}|{k[1]}": v for k, v in dupperson.items()},
        "collisions": coll,
        "gap_fill_swaps": swaps,
        "snap_crosswalk": snapx,
        "career_window": career_window_violations(con),
        "teamhist_wrong_team": teamhist["wrong_team"],
        "teamhist_roster_wrong_team": teamhist["roster_wrong_team"],
        "teamhist_before_espn_debut": teamhist["before_espn_debut"],
        "coverage": coverage_report(targets, results, players, pgs, heavy, skill),
        "tier_coverage": tier_coverage(tiers, results),
    }
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "verify_result.json"), "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True, default=str)

    print(json.dumps(summary, indent=1))
    print(f"[a3] detail -> {os.path.join(CACHE, 'verify_result.json')}")

    fatal = (len(hard) or len(keydupes["espn_id"]) or len(keydupes["pfr_id"])
             or len(dupperson) or len(swaps_bad)
             or out["career_window"]["player_game_stats"]["players"]
             or out["career_window"]["snap_count"]["players"]
             or len(snapx["impossible_weeks"])
             or len(snapx["super_bowl_swapped_seasons"])
             or len(snapx["position_swap_candidates"]))
    return 1 if fatal else 0


def career_window_violations(con):
    """Fact rows dated outside the player's own career window, plus gsis-id
    sequence outliers. Both are exhaustive over the whole database and catch a
    misattributed fact row without needing any network call.

    `player_game_stats` and `snap_count` are the two tables where a violation is
    unambiguous: a stat line or a snap count exists only if the player was on
    the field. `roster_season` legitimately carries practice-squad and camp rows
    in seasons where nflverse's rookie_year/last_season (which track game
    appearances) do not apply, so it is counted but not treated as a defect.
    """
    out = {}
    for tbl in ("player_game_stats", "snap_count", "roster_season", "depth_chart"):
        rows = list(con.execute(f"""
            SELECT f.gsis_id, p.display_name, p.position, p.rookie_year, p.last_season,
                   MIN(f.season), MAX(f.season), COUNT(*)
            FROM {tbl} f JOIN player p ON p.gsis_id = f.gsis_id
            WHERE (p.rookie_year <> '' AND f.season < CAST(p.rookie_year AS INTEGER))
               OR (p.last_season <> '' AND f.season > CAST(p.last_season AS INTEGER))
            GROUP BY f.gsis_id ORDER BY COUNT(*) DESC"""))
        blind = con.execute(f"""
            SELECT COUNT(*) FROM (SELECT DISTINCT gsis_id FROM {tbl}) s
            JOIN player p ON p.gsis_id = s.gsis_id
            WHERE p.rookie_year IS NULL OR p.rookie_year = ''
               OR p.last_season IS NULL OR p.last_season = ''""").fetchone()[0]
        out[tbl] = {
            "players": len(rows), "rows": sum(r[7] for r in rows),
            "blind_spot_players": blind,
            "detail": [dict(zip(("gsis_id", "name", "position", "rookie_year",
                                 "last_season", "min_season", "max_season", "rows"), r))
                       for r in rows[:60]],
        }
    # gsis ids are issued in rough chronological order; an id far ahead of its
    # debut cohort means the fact rows were hung on a player who did not exist yet.
    seq = list(con.execute("""
        WITH x AS (SELECT gsis_id, CAST(SUBSTR(gsis_id,4) AS INTEGER) num, MIN(season) mn
                   FROM player_game_stats WHERE gsis_id GLOB '00-0*' GROUP BY 1,2),
             m AS (SELECT mn, MAX(num) mx FROM x GROUP BY mn)
        SELECT x.gsis_id, p.display_name, x.mn, x.num, m.mx
        FROM x JOIN player p ON p.gsis_id = x.gsis_id JOIN m ON m.mn = x.mn + 2
        WHERE x.num > m.mx"""))
    out["gsis_sequence_outliers"] = [
        dict(zip(("gsis_id", "name", "first_season", "gsis_num",
                  "max_gsis_num_two_seasons_later"), r)) for r in seq]
    return out


def snap_crosswalk_failures(con):
    """`snap_count` is the only fact table resolved through `pfr_id` rather than
    `gsis_id`, so it is the only one where a bad crosswalk entry can move rows
    between humans. Three exhaustive, network-free tests:

      impossible_weeks - the same player with snap rows in two different games in
                         one week. Nobody plays twice in a week, so at least one
                         row belongs to somebody else.
      team_disagree    - a snap row whose team contradicts the player's OWN
                         `player_game_stats` row for the same season and week.
                         `player_game_stats` keys on gsis_id and is therefore the
                         trustworthy side of the comparison.
      position_swap    - a player whose snap positions share no position group
                         with his own stat positions AND who also has team
                         disagreements. Either alone is noisy (edge rushers are
                         labelled LB by one source and DE by the other); together
                         they are the signature of a swapped `pfr_id`.
    """
    impossible = [dict(zip(("gsis_id", "name", "pfr_id", "season", "week", "teams", "rows"), r))
                  for r in con.execute("""
        SELECT s.gsis_id, p.display_name, s.pfr_player_id, s.season, s.week,
               GROUP_CONCAT(DISTINCT s.franchise_id), COUNT(*)
        FROM snap_count s JOIN player p ON p.gsis_id = s.gsis_id
        WHERE s.gsis_id IS NOT NULL AND s.franchise_id IS NOT NULL
        GROUP BY s.gsis_id, s.season, s.week
        HAVING COUNT(DISTINCT s.franchise_id) > 1
        ORDER BY s.gsis_id, s.season, s.week""")]

    by_type = {r[0]: {"rows": r[1], "agree": r[2], "disagree": r[3]} for r in con.execute("""
        SELECT s.season_type, COUNT(*),
               SUM(CASE WHEN s.franchise_id = g.franchise_id THEN 1 ELSE 0 END),
               SUM(CASE WHEN s.franchise_id <> g.franchise_id THEN 1 ELSE 0 END)
        FROM snap_count s
        JOIN player_game_stats g ON g.gsis_id = s.gsis_id AND g.season = s.season
                                AND g.week = s.week
        WHERE s.franchise_id IS NOT NULL AND g.franchise_id IS NOT NULL
        GROUP BY 1""")}

    # Super Bowl rows are checked per season: a whole-game swap shows up as 100%
    # disagreement for that season and 0% for every other.
    sb = [dict(zip(("season", "rows", "agree", "disagree"), r)) for r in con.execute("""
        SELECT s.season, COUNT(*),
               SUM(CASE WHEN s.franchise_id = g.franchise_id THEN 1 ELSE 0 END),
               SUM(CASE WHEN s.franchise_id <> g.franchise_id THEN 1 ELSE 0 END)
        FROM snap_count s
        JOIN player_game_stats g ON g.gsis_id = s.gsis_id AND g.season = s.season
                                AND g.week = s.week
        WHERE s.season_type = 'SB' AND s.franchise_id IS NOT NULL
          AND g.franchise_id IS NOT NULL
        GROUP BY 1 ORDER BY 1""")]
    sb_swapped = [r["season"] for r in sb if r["agree"] == 0 and r["disagree"] > 0]
    sb_rows = con.execute(
        "SELECT COUNT(*) FROM snap_count WHERE season_type='SB' AND season IN "
        "(" + ",".join("?" * len(sb_swapped)) + ")", sb_swapped).fetchone()[0] if sb_swapped else 0

    # regular-season team disagreements, excluding the whole-game SB swap
    reg = [dict(zip(("gsis_id", "name", "dim_pos", "pfr_id", "season", "week",
                     "snap_team", "pgs_team", "snap_pos"), r)) for r in con.execute("""
        SELECT s.gsis_id, p.display_name, p.position, s.pfr_player_id, s.season, s.week,
               s.franchise_id, g.franchise_id, s.position
        FROM snap_count s
        JOIN player_game_stats g ON g.gsis_id = s.gsis_id AND g.season = s.season
                                AND g.week = s.week
        JOIN player p ON p.gsis_id = s.gsis_id
        WHERE s.season_type <> 'SB' AND s.franchise_id <> g.franchise_id
        ORDER BY s.season, s.week""")]

    # position-group swap signature
    snap_pos, pgs_pos = defaultdict(set), defaultdict(set)
    for g, pos in con.execute(
            "SELECT DISTINCT gsis_id, position FROM snap_count "
            "WHERE gsis_id IS NOT NULL AND position <> ''"):
        snap_pos[g].add(pos_group(pos))
    for g, pos in con.execute(
            "SELECT DISTINCT gsis_id, position FROM player_game_stats WHERE position <> ''"):
        pgs_pos[g].add(pos_group(pos))
    teams_bad = defaultdict(int)
    for r in reg:
        teams_bad[r["gsis_id"]] += 1
    names = {r[0]: (r[1], r[2], r[3]) for r in con.execute(
        "SELECT gsis_id, display_name, position, pfr_id FROM player")}
    swaps = []
    for g in set(snap_pos) & set(pgs_pos):
        sp, pp = snap_pos[g] - {""}, pgs_pos[g] - {""}
        if sp and pp and not (sp & pp) and teams_bad.get(g, 0) >= 2:
            nm, pos, pfr = names[g]
            swaps.append({"gsis_id": g, "name": nm, "dim_pos": pos, "pfr_id": pfr,
                          "snap_groups": sorted(sp), "pgs_groups": sorted(pp),
                          "team_disagreements": teams_bad[g]})
    return {"impossible_weeks": impossible,
            "team_agreement_by_season_type": by_type,
            "super_bowl_by_season": sb,
            "super_bowl_swapped_seasons": sb_swapped,
            "super_bowl_swapped_rows": sb_rows,
            "non_sb_team_disagreements": reg,
            "position_swap_candidates": swaps}


def gap_fill_swaps(con, collisions, players):
    """The sharpest same-name test that needs no network.

    A misattributed season leaves a matched pair of holes: player A is missing an
    interior season of his own career, and a same-named player B - who was not in
    the league that year - is the one carrying it. Two same-name players who were
    both genuinely active produce the first half of that pattern all the time, so
    only the second half (B's stats sitting outside B's own career window) is
    treated as evidence.
    """
    seasons = defaultdict(set)
    for g, s in con.execute(
            "SELECT gsis_id, season FROM player_game_stats GROUP BY gsis_id, season"):
        seasons[g].add(s)

    def win(p):
        try:
            return int(p["rookie_year"]), int(p["last_season"])
        except (TypeError, ValueError):
            return None

    out = []
    for name, gids in collisions.items():
        for g in gids:
            w, ss = win(players[g]), seasons.get(g, set())
            if not w or not ss:
                continue
            gaps = {y for y in range(w[0], w[1] + 1)
                    if y not in ss and min(ss) < y < max(ss)}
            for other in gids:
                if other == g:
                    continue
                ow, oss = win(players[other]), seasons.get(other, set())
                filled = gaps & oss
                if not filled or not ow:
                    continue
                outside = {y for y in filled if not (ow[0] <= y <= ow[1])}
                out.append({
                    "name": name, "missing_from": g, "missing_seasons": sorted(filled),
                    "carried_by": other, "carrier_window": list(ow),
                    "carrier_seasons": sorted(oss),
                    "carrier_seasons_outside_own_career": sorted(outside),
                    "verdict": "MISATTRIBUTION" if outside else "both-active (benign)"})
    return out


def analyse_collisions(collisions, players, pgs, results):
    """For every same-name set, record what distinguishes its members.

    A set is SAFE when every member is separable by a discriminator that is
    unique within the set. Ranked strongest first: distinct ESPN athlete id,
    distinct birth_date, distinct pfr_id. A set is RISKY when two members with
    overlapping careers share (or lack) every discriminator - that is the shape
    a misattribution hides in.
    """
    def career(p):
        try:
            return int(p["rookie_year"]), int(p["last_season"])
        except (TypeError, ValueError):
            return None

    buckets = defaultdict(list)
    detail = {}
    for name, gids in collisions.items():
        ps = [players[g] for g in gids]
        dobs = [(p["birth_date"] or "").strip() for p in ps]
        eids = [(p["espn_id"] or "").strip() for p in ps]
        pfrs = [(p["pfr_id"] or "").strip() for p in ps]
        n_active = sum(1 for g in gids if pgs.get(g, 0) > 0)
        uniq = lambda v: len(set(v)) == len(v) and all(v)     # noqa: E731
        disc = []
        if uniq(eids):
            disc.append("espn_id")
        if uniq(dobs):
            disc.append("birth_date")
        if uniq(pfrs):
            disc.append("pfr_id")
        cs = [career(p) for p in ps]
        overlap = any(a and b and a[0] <= b[1] and b[0] <= a[1]
                      for i, a in enumerate(cs) for b in cs[i + 1:])
        espn_ok = all(results.get(g, {}).get("verdict") in (OK, SOFT)
                      for g in gids if g in results)
        espn_seen = sum(1 for g in gids if g in results)
        status = ("SAFE" if disc else
                  "RISKY" if (overlap and n_active >= 2) else "WEAKLY_SEPARATED")
        buckets[(status, "overlap" if overlap else "disjoint",
                 "multi_active" if n_active >= 2 else
                 "one_active" if n_active == 1 else "none_active")].append(name)
        rec = {"members": [
            {"gsis_id": g, "pos": players[g]["position"], "dob": players[g]["birth_date"],
             "espn_id": players[g]["espn_id"], "pfr_id": players[g]["pfr_id"],
             "career": f'{players[g]["rookie_year"]}-{players[g]["last_season"]}',
             "pgs_rows": pgs.get(g, 0),
             "espn_verdict": results.get(g, {}).get("verdict", "NOT_VERIFIED"),
             "espn_name": results.get(g, {}).get("espn_name")}
            for g in sorted(gids, key=lambda x: -pgs.get(x, 0))],
            "discriminators": disc, "overlap": overlap, "n_active": n_active,
            "espn_all_ok": espn_ok, "espn_verified_members": espn_seen,
            "status": status}
        detail[name] = rec
    return {"buckets": {" / ".join(k): len(v) for k, v in sorted(buckets.items())},
            "risky": {k: v for k, v in detail.items() if v["status"] != "SAFE"},
            "high_risk_live": {k: v for k, v in detail.items()
                               if v["overlap"] and v["n_active"] >= 2},
            "all": detail}


TIER_LABELS = {
    0: ">=200 player_game_stats rows",
    1: "2023-2025 QB/RB/WR/TE",
    2: "member of a same-name collision set",
    3: "100-199 player_game_stats rows",
    4: "25-99 player_game_stats rows",
    5: "1-24 player_game_stats rows",
    6: "no stat rows, present in snap_count / roster_season",
    7: "no fact rows at all",
}


def tier_coverage(tiers, results):
    """Fetch progress per risk tier. The fetch queue is sorted by tier, so this
    is the sampling frame: any prefix of the queue is a justified stratum set."""
    out = {}
    for gid, t in tiers.items():
        d = out.setdefault(t, {"label": TIER_LABELS[t], "in_frame": 0, "verified": 0})
        d["in_frame"] += 1
        if gid in results:
            d["verified"] += 1
    return {str(k): out[k] for k in sorted(out)}


def coverage_report(targets, results, players, pgs, heavy, skill):
    """Prove the frame: what fraction of each stratum actually got verified."""
    done = set(results)
    with_eid = {g for _, g in targets}

    def cov(pop, label):
        pop = set(pop)
        eid = pop & with_eid
        return {"population": len(pop), "has_espn_id": len(eid),
                "verified": len(pop & done),
                "no_espn_id": sorted(pop - with_eid)[:50],
                "label": label}

    strata = {
        "pgs_ge_200": cov(heavy, ">=200 player_game_stats rows"),
        "skill_2023_2025": cov(skill, "2023-2025 QB/RB/WR/TE"),
        "any_pgs": cov(pgs.keys(), "any player_game_stats row"),
        "all_players": cov(players.keys(), "every player row"),
    }
    return strata


# --------------------------------------------------------------------------


def selftest(n=4000, seed=20260727):
    """Negative control: a detector that cannot fail cannot be trusted when it passes.

    Every player is compared against an ESPN athlete that is definitely NOT him,
    twice over:
      (a) a randomly chosen other athlete - the easy case;
      (b) an athlete belonging to a *different player with the same surname* -
          the hard case, and the one that actually matters, because that is the
          shape a real crosswalk error takes.
    Any verdict other than MISMATCH on (a) or (b) is a false pass. The run also
    reports CONFLICT/WEAK, which are not false passes - both are surfaced for
    review rather than accepted - but a rising count there is worth watching.
    """
    import random
    con = connect()
    players = load_players(con)
    targets, *_ = build_frame(con)
    cached = [(e, g) for e, g in targets if cache_read(ATH_DIR, e) is not None]
    if len(cached) < 100:
        sys.exit("[a3] cache too small to self-test; run --fetch first")
    rng = random.Random(seed)

    sample = rng.sample(cached, min(n, len(cached)))
    docs = {e: cache_read(ATH_DIR, e) for e, _ in sample}
    a_res, a_bad = defaultdict(int), []
    for i, (_e, g) in enumerate(sample):
        other = sample[(i + 1) % len(sample)][0]
        r = compare(players[g], docs[other])
        a_res[r["verdict"]] += 1
        if r["verdict"] == OK:
            a_bad.append((g, players[g]["display_name"], other, docs[other].get("displayName")))

    bysur = defaultdict(list)
    for e, g in cached:
        ln = norm_name(players[g].get("last_name") or "")
        if ln:
            bysur[ln].append((e, g))
    pairs = [(v[i][1], v[i + 1][0]) for v in bysur.values() if len(v) >= 2
             for i in range(len(v) - 1)]
    pairs = rng.sample(pairs, min(n, len(pairs)))
    b_res, b_bad = defaultdict(int), []
    for g, e in pairs:
        a = cache_read(ATH_DIR, e)
        if a is None:
            continue
        r = compare(players[g], a)
        b_res[r["verdict"]] += 1
        if r["verdict"] == OK:
            b_bad.append((g, players[g]["display_name"], e, a.get("displayName"), r["corr"]))

    out = {"random_wrong_athlete": dict(a_res), "random_false_pass": a_bad[:20],
           "same_surname_wrong_athlete": dict(b_res), "same_surname_false_pass": b_bad[:20]}
    with open(os.path.join(CACHE, "selftest.json"), "w") as fh:
        json.dump(out, fh, indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if not k.endswith("false_pass")}, indent=1))
    print(f"false passes: random={len(a_bad)} same-surname={len(b_bad)}")
    for x in a_bad[:10] + b_bad[:10]:
        print("  ", x)
    return 1 if (a_bad or b_bad) else 0


def emit_markdown():
    """Print the report's data sections from the last verify run."""
    path = os.path.join(CACHE, "verify_result.json")
    if not os.path.exists(path):
        sys.exit("[a3] run the verifier first")
    with open(path) as fh:
        d = json.load(fh)
    res = json.load(open(os.path.join(CACHE, "missing_espn_resolution.json"))) \
        if os.path.exists(os.path.join(CACHE, "missing_espn_resolution.json")) else {}

    print("### espn_id verification outcome\n")
    s = d["summary"]
    print("| outcome | players |")
    print("|---|---|")
    for k in ("OK", "CONFLICT", "WEAK", "MISMATCH"):
        print(f"| {k} | {s[k]} |")
    print(f"| **verified total** | **{s['verified']}** |\n")

    print("### stratum coverage\n")
    print("| stratum | population | has espn_id | verified |")
    print("|---|---|---|---|")
    for k, v in d["coverage"].items():
        print(f"| {v['label']} | {v['population']} | {v['has_espn_id']} | {v['verified']} |")
    print()

    print("### fetch frame by risk tier (tiers are exclusive, highest tier wins)\n")
    print("| tier | stratum | in frame | fetched | % |")
    print("|---|---|---|---|---|")
    for k, v in d.get("tier_coverage", {}).items():
        pct = 100.0 * v["verified"] / v["in_frame"] if v["in_frame"] else 0.0
        print(f"| {k} | {v['label']} | {v['in_frame']} | {v['verified']} | {pct:.1f}% |")
    print()

    print("### same-name collision sets\n")
    print("| classification | sets |")
    print("|---|---|")
    for k, v in d["summary"]["collision_buckets"].items():
        print(f"| {k} | {v} |")
    print(f"| **total** | **{d['summary']['name_collision_sets']}** |\n")

    print("### identity MISMATCH exceptions\n")
    print("| gsis_id | db name / pos / dob | espn_id | espn name / pos / dob | hard evidence |")
    print("|---|---|---|---|---|")
    for g, v in sorted(d["mismatch"].items()):
        print(f"| `{g}` | {v['db_name']} / {v['db_pos']} / {v['db_dob']} | `{v['espn_id']}` | "
              f"{v['espn_name']} / {v['espn_pos']} / {v['espn_dob']} | {'; '.join(v['hard'])} |")
    print()

    print("### players with fact rows but no espn_id\n")
    print("| gsis_id | name | fact rows (pgs/snap/roster/depth) | status | resolved espn_id |")
    print("|---|---|---|---|---|")
    for g, v in sorted(res.items(), key=lambda kv: -kv[1].get("facts", {}).get("pgs", 0)):
        f = v.get("facts", {})
        print(f"| `{g}` | {v['name']} | {f.get('pgs',0)}/{f.get('snap',0)}/"
              f"{f.get('roster',0)}/{f.get('depth',0)} | {v['status']} | "
              f"{v.get('resolved_espn_id') or '-'} |")
    print()

    print("### snap_count crosswalk (pfr_id-resolved table)\n")
    sx = d.get("snap_crosswalk", {})
    print("| test | result |")
    print("|---|---|")
    print(f"| impossible player-weeks (two games in one week) | {len(sx.get('impossible_weeks', []))} |")
    print(f"| Super Bowl seasons with team fully swapped | {sx.get('super_bowl_swapped_seasons')} |")
    print(f"| Super Bowl rows affected | {sx.get('super_bowl_swapped_rows')} |")
    print(f"| non-Super-Bowl team disagreements | {len(sx.get('non_sb_team_disagreements', []))} |")
    print(f"| swapped-pfr_id candidates | {len(sx.get('position_swap_candidates', []))} |")
    for c in sx.get("position_swap_candidates", []):
        print(f"| -> `{c['gsis_id']}` {c['name']} ({c['dim_pos']}, pfr {c['pfr_id']}) | "
              f"snaps {c['snap_groups']} vs stats {c['pgs_groups']}, "
              f"{c['team_disagreements']} team disagreements |")
    print()

    print("### fact rows outside the player's career window\n")
    cw = d["career_window"]
    print("| table | players | rows | players with no career window (detector blind spot) |")
    print("|---|---|---|---|")
    for t in ("player_game_stats", "snap_count", "roster_season", "depth_chart"):
        print(f"| {t} | {cw[t]['players']} | {cw[t]['rows']} | {cw[t]['blind_spot_players']} |")
    print()

    print("### full same-name collision appendix\n")
    print("| name | n | discriminators | careers overlap | members with stats | ESPN verdicts |")
    print("|---|---|---|---|---|---|")
    for name, v in sorted(d["collisions"]["all"].items()):
        verds = ",".join(m["espn_verdict"][:4] for m in v["members"])
        print(f"| {name} | {len(v['members'])} | {'+'.join(v['discriminators']) or '**none**'} | "
              f"{'yes' if v['overlap'] else 'no'} | {v['n_active']} | {verds} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="fill the cache (network)")
    ap.add_argument("--statlog", action="store_true",
                    help="also fetch statisticslog for the prop-relevant strata")
    ap.add_argument("--statlog-all", action="store_true",
                    help="fetch statisticslog for every target")
    ap.add_argument("--colleges", action="store_true", help="resolve college refs")
    ap.add_argument("--resolve-missing", action="store_true",
                    help="name-resolve fact-bearing players that carry no espn_id")
    ap.add_argument("--markdown", action="store_true",
                    help="print the report's data sections from the last verify run")
    ap.add_argument("--selftest", action="store_true",
                    help="negative control: verify the detector rejects known-wrong pairings")
    ap.add_argument("--cross-source", action="store_true",
                    help="adjudicate players.csv vs rosters.csv espn_id disagreements")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.12)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    for d in (ATH_DIR, LOG_DIR, COL_DIR, SRCH_DIR):
        os.makedirs(d, exist_ok=True)

    if args.selftest:
        return selftest()
    if args.markdown:
        emit_markdown()
        return 0
    if args.cross_source:
        cross_source_espn(fetch=True)
        return 0
    if args.resolve_missing:
        resolve_missing(fetch=True)
        return 0
    if args.fetch:
        con = connect()
        targets, players, vols, prop, _, _t = build_frame(con)
        heavy, skill = prop
        with open(FRAME_PATH, "w") as fh:
            json.dump({"n": len(targets), "order": [t[0] for t in targets]}, fh)
        sl = []
        if args.statlog_all:
            sl = targets
        elif args.statlog:
            want = heavy | skill
            sl = [(e, g) for e, g in targets if g in want]
        fetch_all(targets, args.sleep, max(1, min(args.workers, 3)), sl, args.limit)
        return 0
    if args.colleges:
        fetch_colleges()
        return 0
    return verify(args)


if __name__ == "__main__":
    sys.exit(main())
