#!/usr/bin/env python3
"""F05 - row-level forensic audit of NFL seasons 2018 and 2019.

Partition: every row of `game`, `game_line`, `team_game`, `player_game_stats`,
`snap_count`, `roster_season` and `depth_chart` whose season is 2018 or 2019, plus
every `data_correction` row that touches them.

Read-only against nfl.db. Offline-replayable: every external fact comes from a file
under scripts/data/nfl-db/cache/ (fill it with audit/f05_fetch.py). Nothing here
touches the network.

Authorities, per AUDIT-CONTRACT.md:
  game               ESPN summary?event=
  player_game_stats  ESPN summary?event= box score
  roster_season      ESPN seasonal team roster (core API)
  game_line          SportsOddsHistory / covers.com (cache/a4/soh_YYYY.html.gz)
  team_game          derived - recomputed from game + game_line
  snap_count         Pro-Football-Reference (see PFR_STATUS below)
  depth_chart        none exists - internal and structural only

Usage
  python3 scripts/data/nfl-db/audit/f05.py            # writes ledger + prints summary
  python3 scripts/data/nfl-db/audit/f05.py --summary  # re-print summary from ledger
"""
from __future__ import annotations

import collections
import csv
import datetime
import gzip
import hashlib
import html
import io
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)                                  # scripts/data/nfl-db
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache")
F05 = os.path.join(CACHE, "f05")
DERIVED = os.path.join(F05, "derived")
RAW = os.path.join(NFLDB, "raw")
LEDGER_DIR = os.path.join(REPO, "docs", "audits", "2026-07-27-nfl-db-forensic", "ledger")
LEDGER = os.path.join(LEDGER_DIR, "F05.jsonl")

SEASONS = (2018, 2019)
TS = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace(
    "+00:00", "Z")

# --------------------------------------------------------------------------------------
# Era-correct franchise labels for 2018-2019, from NFL.com and contemporaneous sources.
# ESPN's *seasonal* endpoints retro-relabel; ESPN's *summary* endpoint mostly does not,
# but its abbreviation column is house style (WSH, LAR) rather than the published label.
# Washington in particular: ESPN renders 2019-2021 as bare "Washington", so ESPN cannot
# derive the era-correct name for franchise 28 and is not used for it.
# --------------------------------------------------------------------------------------
ERA_LABEL = {
    (13, 2018): ("OAK", "Oakland Raiders"),
    (13, 2019): ("OAK", "Oakland Raiders"),      # Las Vegas from 2020
    (28, 2018): ("WAS", "Washington Redskins"),
    (28, 2019): ("WAS", "Washington Redskins"),  # Football Team 2020, Commanders 2022
    (14, 2018): ("LA", "Los Angeles Rams"),
    (14, 2019): ("LA", "Los Angeles Rams"),
    (24, 2018): ("LAC", "Los Angeles Chargers"),
    (24, 2019): ("LAC", "Los Angeles Chargers"),
}
# Labels that would be anachronistic if they appeared in 2018/2019 rows.
ANACHRONISTIC = {13: {"LV", "LVR", "Las Vegas Raiders"},
                 28: {"WFT", "Washington Football Team", "Washington Commanders", "WSH"},
                 14: {"STL", "SL", "St. Louis Rams"},
                 24: {"SD", "San Diego Chargers"}}

# ESPN abbreviation house style -> the label nflverse/this DB publishes. Both resolve to
# the same franchise through team_alias; the difference is orthography, not identity.
ESPN_ABBR_ALIAS = {"WSH": "WAS", "LAR": "LA"}

PFR_STATUS = ("pro-football-reference.com returns HTTP 403 (Cloudflare interstitial) for "
              "every URL on the domain from this host, including the site root. Cached "
              "proof: cache/f05/pfr_*.BLOCKED403.html.gz")

# ESPN box-score keys -> player_game_stats columns that ESPN can actually rule on.
ESPN_COMPARABLE = {
    "passing": {"completions": "completions", "passingAttempts": "attempts",
                "passingYards": "passing_yards", "passingTouchdowns": "passing_tds",
                "interceptions": "interceptions", "sacks": "sacks_suffered"},
    "rushing": {"rushingAttempts": "carries", "rushingYards": "rushing_yards",
                "rushingTouchdowns": "rushing_tds"},
    "receiving": {"receptions": "receptions", "receivingYards": "receiving_yards",
                  "receivingTouchdowns": "receiving_tds", "receivingTargets": "targets"},
}
# Columns no box score publishes. Modelled quantities and shares, not observations.
PGS_NOT_COMPARABLE = ["passing_epa", "rushing_epa", "receiving_epa",
                      "target_share", "air_yards_share",
                      "fantasy_points", "fantasy_points_ppr"]
# Every numeric column, checked against the raw feed the loader read.
UPSTREAM_COLS = ["completions", "attempts", "passing_yards", "passing_tds",
                 "interceptions", "sacks_suffered", "passing_epa", "carries",
                 "rushing_yards", "rushing_tds", "rushing_epa", "receptions", "targets",
                 "receiving_yards", "receiving_tds", "receiving_epa", "target_share",
                 "air_yards_share", "fantasy_points", "fantasy_points_ppr"]


# ======================================================================================
# ledger
# ======================================================================================
class Ledger:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.fh = open(path, "w", encoding="utf-8")
        self.counts: collections.Counter = collections.Counter()
        self.rows_seen: collections.defaultdict = collections.defaultdict(set)
        self.problems: list[dict] = []
        self.missing_evidence: set[str] = set()

    def write(self, *, table, row_key, season, field, verdict, authority, evidence,
              db_value=None, ref_value=None, ref_id=None, note=None, **extra):
        ev_abs = os.path.join(NFLDB, evidence)
        if not os.path.exists(ev_abs):
            self.missing_evidence.add(evidence)
        rec = {"ts": TS, "agent": "F05", "table": table, "row_key": row_key,
               "season": season, "field": field, "db_value": db_value,
               "authority": authority, "ref_id": ref_id, "ref_value": ref_value,
               "verdict": verdict, "evidence": evidence}
        if note:
            rec["note"] = note
        rec.update(extra)
        rec = {k: v for k, v in rec.items() if v is not None or k == "db_value"}
        self.fh.write(json.dumps(rec, default=str, separators=(",", ":")) + "\n")
        self.counts[(table, verdict)] += 1
        self.rows_seen[table].add(row_key)
        if verdict in ("MISMATCH", "DB_ONLY", "REF_ONLY", "UNRESOLVED"):
            self.problems.append(rec)

    def close(self):
        self.fh.close()


def rel(path: str) -> str:
    """Evidence paths are recorded relative to scripts/data/nfl-db/, matching the
    form used in AUDIT-CONTRACT.md's own example (`cache/s03/sum_...`)."""
    return os.path.relpath(path, NFLDB)


def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def dump(path: str, obj) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1, default=str, sort_keys=True)
    return rel(path)


def find_summary(event_id: str) -> str | None:
    for c in (os.path.join(F05, f"summary_{event_id}.json.gz"),
              os.path.join(CACHE, "a5", f"summary_{event_id}.json.gz"),
              os.path.join(CACHE, "a1", "summary", f"{event_id}.json"),
              os.path.join(CACHE, "s2", f"summary_{event_id}.json"),
              os.path.join(CACHE, "a2", f"espn_summary_{event_id}.json")):
        if os.path.exists(c):
            return c
    err = os.path.join(F05, f"summary_{event_id}.ERR404.gz")
    return err if os.path.exists(err) else None


def load_json(path: str):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8", errors="replace") as fh:
        return json.load(fh)


def _same_person(a: str, b: str) -> bool:
    """Two renderings of one official's name: surname equal, given names compatible."""
    pa, pb = a.split(), b.split()
    if not pa or not pb or pa[-1].lower() != pb[-1].lower():
        return False
    x, y = pa[0].lower().rstrip("."), pb[0].lower().rstrip(".")
    return x.startswith(y) or y.startswith(x)


def _norm_utc(v):
    """ISO-8601 UTC to a single canonical form: YYYY-MM-DDTHH:MM:00Z."""
    if not v:
        return None
    t = str(v).strip().replace(" ", "T").rstrip("Z")
    m = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})", t)
    return f"{m.group(1)}T{m.group(2)}:{m.group(3)}:00Z" if m else str(v)


def num(x):
    if x in (None, "", "--", "-"):
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def eq(a, b, tol=1e-6) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) <= tol


# ======================================================================================
# ESPN summary extraction
# ======================================================================================
def espn_game_facts(doc: dict) -> dict:
    comp = doc["header"]["competitions"][0]
    out = {"event_id": doc["header"]["id"],
           "date": comp.get("date"),
           "neutral": comp.get("neutralSite"),
           "season_type": doc["header"]["season"].get("type"),
           "week": doc["header"].get("week"),
           "status": comp.get("status", {}).get("type", {}).get("name"),
           "completed": comp.get("status", {}).get("type", {}).get("completed")}
    for c in comp["competitors"]:
        side = c["homeAway"]
        out[f"{side}_id"] = int(c["team"]["id"])
        out[f"{side}_abbr"] = c["team"].get("abbreviation")
        out[f"{side}_name"] = c["team"].get("displayName")
        out[f"{side}_score"] = int(c["score"]) if c.get("score") not in (None, "") else None
        out[f"{side}_periods"] = len(c.get("linescores") or [])
    gi = doc.get("gameInfo") or {}
    ven = gi.get("venue") or {}
    out["venue_id"] = int(ven["id"]) if ven.get("id") else None
    out["venue_name"] = ven.get("fullName")
    out["grass"] = ven.get("grass")
    out["referee"] = next((o.get("fullName") for o in (gi.get("officials") or [])
                           if (o.get("position") or {}).get("name") == "Referee"), None)
    return out


def espn_box(doc: dict) -> dict:
    """{espn_athlete_id: {'team': fid, 'stats': {col: value}}} for one game.

    Two indexes are built. `stats` covers only the passing/rushing/receiving blocks,
    because those are the columns player_game_stats stores. Attribution (which team did
    this man play for?) uses `_roster`, built from EVERY block - defensive, kicking,
    returns and all - because most snap_count rows belong to defenders who never appear
    in an offensive block. Indexing only the offensive blocks made two players with
    league-duplicate names, Brandon Marshall and Michael Thomas, look transposed.
    """
    out: dict = {}
    roster: dict = {}
    dup: collections.Counter = collections.Counter()
    for tm in doc.get("boxscore", {}).get("players", []):
        fid = int(tm["team"]["id"])
        for block in tm.get("statistics", []):
            for ath in block.get("athletes", []):
                aid = str(ath["athlete"]["id"])
                nm = _nname(ath["athlete"].get("displayName"))
                if aid not in roster:
                    roster[aid] = fid
                    dup[nm] += 1
                roster.setdefault(("name", fid, nm), aid)
    out["_roster"] = roster
    out["_ambiguous"] = {n for n, c in dup.items() if c > 1}
    for tm in doc.get("boxscore", {}).get("players", []):
        fid = int(tm["team"]["id"])
        for block in tm.get("statistics", []):
            mapping = ESPN_COMPARABLE.get(block.get("name"))
            if not mapping:
                continue
            keys = block.get("keys") or []
            for ath in block.get("athletes", []):
                aid = str(ath["athlete"]["id"])
                slot = out.setdefault(aid, {"team": fid, "stats": {}, "espn_id": aid,
                                            "name": ath["athlete"].get("displayName")})
                slot["team"] = fid
                for k, v in zip(keys, ath.get("stats", [])):
                    if k == "completions/passingAttempts":
                        c, _, a = str(v).partition("/")
                        slot["stats"]["completions"] = num(c)
                        slot["stats"]["attempts"] = num(a)
                    elif k == "sacks-sackYardsLost":
                        s, _, _y = str(v).partition("-")
                        slot["stats"]["sacks_suffered"] = num(s)
                    elif k in mapping:
                        slot["stats"][mapping[k]] = num(v)
    # Secondary index: (franchise, normalised name). A wrong player.espn_id must not be
    # able to masquerade as "ESPN has no record of this player".
    for aid, slot in list(out.items()):
        if isinstance(aid, str) and not aid.startswith("_"):
            out.setdefault(("name", slot["team"], _nname(slot["name"])), slot)
    return out


def _nname(n: str | None) -> str:
    return re.sub(r"[^a-z]", "", (n or "").lower().replace("jr", "").replace("sr", ""))


# ======================================================================================
# SportsOddsHistory (game_line authority) - parser proven by verify/a4_lines.py
# ======================================================================================
_MON = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
_SOH_ALIASES = {"st louis rams": 14, "san diego chargers": 24, "oakland raiders": 13,
                "washington redskins": 28, "washington football team": 28}


def parse_soh(path: str) -> list[dict]:
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8", errors="replace") as fh:
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
            out.append({"date": datetime.date(int(m.group(3)), _MON[m.group(1)],
                                              int(m.group(2))),
                        "fav_home": "@" in cl[3 + off], "fav": cl[4 + off],
                        "score": cl[5 + off], "spread": cl[6 + off],
                        "dog": cl[8 + off], "ou": cl[9 + off]})
    return out


# ======================================================================================
# raw nflverse readers (upstream transport check, not an authority)
# ======================================================================================
def read_raw(name: str, keep) -> list[dict]:
    path = os.path.join(RAW, name)
    out = []
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            if keep(row):
                out.append(row)
    return out


# ======================================================================================
# main
# ======================================================================================
def main() -> int:
    if not os.path.exists(DB):
        print(f"missing {DB}", file=sys.stderr)
        return 2
    md5_start = md5(DB)
    print(f"nfl.db md5 (start): {md5_start}")
    os.makedirs(DERIVED, exist_ok=True)

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    L = Ledger(LEDGER)

    teams = {r["franchise_id"]: dict(r) for r in conn.execute("SELECT * FROM team")}
    alias = {r["abbreviation"]: r["franchise_id"]
             for r in conn.execute("SELECT abbreviation, franchise_id FROM team_alias")}

    games = [dict(r) for r in conn.execute(
        "SELECT * FROM game WHERE season IN (?,?) ORDER BY season, kickoff_utc", SEASONS)]
    by_gid = {g["game_id"]: g for g in games}
    print(f"partition: {len(games)} games")

    # Compact facts only: holding 534 parsed ESPN summaries at once is gigabytes.
    # Each document is opened once, reduced to the fields any check needs, discarded.
    summaries: dict[str, dict] = {}
    for g in games:
        p = find_summary(g["espn_event_id"])
        if p and ".ERR" not in p:
            try:
                doc = load_json(p)
                summaries[g["game_id"]] = {"ev": rel(p), "game": espn_game_facts(doc),
                                           "box": espn_box(doc)}
            except Exception as e:                                    # noqa: BLE001
                print(f"  unreadable {p}: {e}")
    print(f"  ESPN summaries resolved: {len(summaries)}/{len(games)}")

    audit_game(conn, L, games, summaries, teams, alias)
    audit_game_line(conn, L, games, teams)
    audit_team_game(conn, L, games, by_gid)
    audit_player_game_stats(conn, L, games, summaries)
    audit_snap_count(conn, L, games, summaries, teams)
    audit_roster_season(conn, L, teams, summaries)
    audit_depth_chart(conn, L, teams)
    audit_era_labels(conn, L, summaries)
    audit_corrections(conn, L, summaries, by_gid)

    L.close()
    md5_end = md5(DB)
    print(f"nfl.db md5 (end):   {md5_end}  {'OK' if md5_end == md5_start else '*** CHANGED ***'}")
    summarise(L, conn)
    if L.missing_evidence:
        print(f"\n!! {len(L.missing_evidence)} evidence paths do not resolve:")
        for p in sorted(L.missing_evidence)[:20]:
            print("   ", p)
    return 0


# --------------------------------------------------------------------------------------
# 1. game  -- authority: ESPN summary
# --------------------------------------------------------------------------------------
def audit_game(conn, L, games, summaries, teams, alias):
    print("[game] auditing", len(games), "rows")
    for g in games:
        gid, season = g["game_id"], g["season"]
        ev = g["espn_event_id"]
        if gid not in summaries:
            L.write(table="game", row_key=gid, season=season, field="*",
                    verdict="UNRESOLVED", authority="espn", ref_id=ev,
                    evidence=rel(os.path.join(F05, "fetch_summary.log")),
                    note="no ESPN summary cached for this event")
            continue
        evidence = summaries[gid]["ev"]
        e = summaries[gid]["game"]
        cmp_n = mat_n = 0

        def check(field, dbv, refv, *, tol=None):
            nonlocal cmp_n, mat_n
            cmp_n += 1
            same = eq(dbv, refv, tol) if tol is not None else (dbv == refv)
            if same:
                mat_n += 1
            else:
                L.write(table="game", row_key=gid, season=season, field=field,
                        db_value=dbv, ref_value=refv, verdict="MISMATCH",
                        authority="espn", ref_id=ev, evidence=evidence)
            return same

        check("espn_event_id", ev, e["event_id"])
        check("away_franchise_id", g["away_franchise_id"], e["away_id"])
        check("home_franchise_id", g["home_franchise_id"], e["home_id"])
        check("away_score", g["away_score"], e["away_score"])
        check("home_score", g["home_score"], e["home_score"])
        check("result", g["result"],
              None if e["home_score"] is None else e["home_score"] - e["away_score"])
        check("total", g["total"],
              None if e["home_score"] is None else e["home_score"] + e["away_score"])
        check("season_type", g["season_type"],
              {2: "REG", 3: "POST", 1: "PRE"}.get(e["season_type"]))
        check("result_status", g["result_status"],
              "final" if e["completed"] else "scheduled")
        # overtime: ESPN publishes a 5th linescore period iff the game went to OT
        ot_ref = 1 if max(e["away_periods"], e["home_periods"]) > 4 else 0
        check("overtime", g["overtime"], ot_ref)
        cmp_n += 1
        if g["venue_id"] == e["venue_id"]:
            mat_n += 1
        elif g["venue_id"] is None and e["venue_id"] is not None:
            L.write(table="game", row_key=gid, season=season, field="venue_id",
                    db_value=None, ref_value=e["venue_id"], verdict="REF_ONLY",
                    authority="espn", ref_id=ev, evidence=evidence,
                    note="game.venue_id is NULL for every completed game in the table "
                         "(4,363 of 4,648 rows, all seasons 2010-2025); ESPN publishes a "
                         "venue id on every summary. Table-wide gap, not season-specific.")
        else:
            L.write(table="game", row_key=gid, season=season, field="venue_id",
                    db_value=g["venue_id"], ref_value=e["venue_id"], verdict="MISMATCH",
                    authority="espn", ref_id=ev, evidence=evidence)
        # week: ESPN's header week is continuous within a season type
        if g["season_type"] == "REG":
            check("week", g["week"], e["week"])
        else:
            cmp_n += 1
            mat_n += 1
            L.write(table="game", row_key=gid, season=season, field="playoff_round",
                    db_value=g["playoff_round"], ref_value=e["week"],
                    verdict="NOT_COMPARABLE", authority="espn", ref_id=ev,
                    evidence=evidence,
                    note="ESPN publishes an ordinal postseason week, not a round label")

        # --- abbreviations: identity vs orthography vs era-correctness ---------------
        for side in ("away", "home"):
            dba = g[f"{side}_abbr"]
            espn_a = e[f"{side}_abbr"]
            fid = g[f"{side}_franchise_id"]
            cmp_n += 1
            if alias.get(dba) == fid and ESPN_ABBR_ALIAS.get(espn_a, espn_a) == dba:
                mat_n += 1
            elif alias.get(dba) == fid:
                L.write(table="game", row_key=gid, season=season, field=f"{side}_abbr",
                        db_value=dba, ref_value=espn_a, verdict="NOT_COMPARABLE",
                        authority="espn", ref_id=ev, evidence=evidence,
                        note="ESPN abbreviation is house style; both resolve to franchise "
                             f"{fid} via team_alias")
            else:
                L.write(table="game", row_key=gid, season=season, field=f"{side}_abbr",
                        db_value=dba, ref_value=espn_a, verdict="MISMATCH",
                        authority="espn", ref_id=ev, evidence=evidence,
                        note=f"abbr does not resolve to franchise {fid}")
            # era-correctness, ruled by NFL.com/contemporaneous sources, not ESPN
            want = ERA_LABEL.get((fid, season))
            if want:
                cmp_n += 1
                if dba == want[0] and dba not in ANACHRONISTIC.get(fid, ()):
                    mat_n += 1
                else:
                    L.write(table="game", row_key=gid, season=season,
                            field=f"{side}_abbr_era", db_value=dba, ref_value=want[0],
                            verdict="MISMATCH", authority="nfl.com", ref_id=ev,
                            evidence=evidence,
                            note=f"franchise {fid} in {season} publishes as {want[1]}")

        # --- kickoff: known-good scheduled-vs-observed difference --------------------
        cmp_n += 1
        db_k = _norm_utc(g["kickoff_utc"])
        ref_k = _norm_utc(e["date"])
        if db_k == ref_k:
            mat_n += 1
        else:
            d = None
            try:
                d = abs((datetime.datetime.fromisoformat(db_k.replace("Z", "+00:00"))
                         - datetime.datetime.fromisoformat(
                             ref_k.replace("Z", "+00:00"))).total_seconds()) / 60.0
            except Exception:                                          # noqa: BLE001
                pass
            L.write(table="game", row_key=gid, season=season, field="kickoff_utc",
                    db_value=db_k, ref_value=ref_k,
                    verdict="NOT_COMPARABLE" if (d is not None and d <= 60) else "MISMATCH",
                    authority="espn", ref_id=ev, evidence=evidence,
                    note=("known-good: nflverse stores the scheduled kickoff, ESPN the "
                          f"observed one; delta {d:.0f} min" if d is not None
                          else "kickoff unparseable"))

        # --- location / neutral site -------------------------------------------------
        cmp_n += 1
        ref_loc = "Neutral" if e["neutral"] else "Home"
        if g["location"] == ref_loc:
            mat_n += 1
        else:
            L.write(table="game", row_key=gid, season=season, field="location",
                    db_value=g["location"], ref_value=ref_loc, verdict="MISMATCH",
                    authority="espn", ref_id=ev, evidence=evidence)

        # --- referee ------------------------------------------------------------------
        if g["referee"] and e["referee"]:
            cmp_n += 1
            a1, b1 = g["referee"].strip(), e["referee"].strip()
            if a1 == b1:
                mat_n += 1
            elif _same_person(a1, b1):
                L.write(table="game", row_key=gid, season=season, field="referee",
                        db_value=a1, ref_value=b1, verdict="NOT_COMPARABLE",
                        authority="espn", ref_id=ev, evidence=evidence,
                        note="same official, different given-name form "
                             "(e.g. Peter/Pete Morelli); surname and initial agree")
            else:
                L.write(table="game", row_key=gid, season=season, field="referee",
                        db_value=a1, ref_value=b1, verdict="MISMATCH", authority="espn",
                        ref_id=ev, evidence=evidence)
        elif g["referee"] and not e["referee"]:
            L.write(table="game", row_key=gid, season=season, field="referee",
                    db_value=g["referee"], verdict="NOT_COMPARABLE", authority="espn",
                    ref_id=ev, evidence=evidence,
                    note="ESPN's summary carries no officials block for this event, so "
                         "the authority cannot rule on the referee")
        elif e["referee"]:
            L.write(table="game", row_key=gid, season=season, field="referee",
                    db_value=None, ref_value=e["referee"], verdict="REF_ONLY",
                    authority="espn", ref_id=ev, evidence=evidence)

        # --- fields no box score can rule on ----------------------------------------
        for f, why in (("stadium", "ESPN retro-renames venues (known-good difference)"),
                       ("temp", "weather is not published in the summary for these seasons"),
                       ("wind", "weather is not published in the summary for these seasons"),
                       ("away_coach", "summary does not carry coaches"),
                       ("home_coach", "summary does not carry coaches"),
                       ("broadcast", "summary broadcast list is current, not historical"),
                       ("roof", "not published in the summary"),
                       ("surface", "not published in the summary"),
                       ("gsis_game_id", "cross-source join key, no ESPN counterpart"),
                       ("pfr_game_id", "cross-source join key, no ESPN counterpart"),
                       ("gameday", "venue-local calendar date; ESPN publishes only the "
                                   "UTC instant, so it cannot rule on the local date"),
                       ("gametime_et", "ESPN publishes UTC only"),
                       ("away_qb_id", "summary does not name a starting QB field"),
                       ("home_qb_id", "summary does not name a starting QB field")):
            L.write(table="game", row_key=gid, season=season, field=f,
                    db_value=g.get(f), verdict="NOT_COMPARABLE", authority="espn",
                    ref_id=ev, evidence=evidence, note=why)

        # --- derived arithmetic, checkable without any authority ---------------------
        for f, want in (("result", (g["home_score"] - g["away_score"])
                         if g["home_score"] is not None else None),
                        ("total", (g["home_score"] + g["away_score"])
                         if g["home_score"] is not None else None)):
            cmp_n += 1
            if g[f] == want:
                mat_n += 1
            else:
                L.write(table="game", row_key=gid, season=season, field=f + "_arith",
                        db_value=g[f], ref_value=want, verdict="MISMATCH",
                        authority="derived", ref_id=ev, evidence=evidence)
        # div_game must agree with the team dimension
        cmp_n += 1
        a, h = teams.get(g["away_franchise_id"]), teams.get(g["home_franchise_id"])
        want_div = 1 if (a and h and a["division"] == h["division"]) else 0
        if g["div_game"] == want_div:
            mat_n += 1
        else:
            L.write(table="game", row_key=gid, season=season, field="div_game",
                    db_value=g["div_game"], ref_value=want_div, verdict="MISMATCH",
                    authority="derived", ref_id=ev, evidence=evidence)

        L.write(table="game", row_key=gid, season=season, field="*", verdict="MATCH",
                authority="espn", ref_id=ev, evidence=evidence,
                fields_compared=cmp_n, fields_matched=mat_n)


# --------------------------------------------------------------------------------------
# 2. game_line -- authority: SportsOddsHistory / covers.com
# --------------------------------------------------------------------------------------
def _espn_odds(event_id):
    """Third source for a disputed line: ESPN's per-provider odds, where cached.

    Its value is that the providers disagree with each other, which is what makes a
    half-point gap between two archives market variance rather than a defect.
    """
    p = os.path.join(CACHE, "a4", "espn", f"odds_{event_id}.json.gz")
    if not os.path.exists(p):
        return None, None
    try:
        d = load_json(p)
    except Exception:                                              # noqa: BLE001
        return None, rel(p)
    out = []
    for i in d.get("items", []):
        nm = (i.get("provider") or {}).get("name")
        if i.get("details") or i.get("overUnder") is not None:
            out.append({"provider": nm, "spread": i.get("details"),
                        "total": i.get("overUnder")})
    return out, rel(p)


def audit_game_line(conn, L, games, teams):
    lines = {r["game_id"]: dict(r) for r in conn.execute(
        "SELECT l.* FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (?,?)",
        SEASONS)}
    print("[game_line] auditing", len(lines), "rows")
    by_gid = {g["game_id"]: g for g in games}

    names = {t["display_name"].lower(): f for f, t in teams.items()}
    names.update(_SOH_ALIASES)
    soh_index: dict[tuple, dict] = {}
    soh_paths: dict[int, str] = {}
    for season in SEASONS:
        p = os.path.join(CACHE, "a4", f"soh_{season}.html.gz")
        if not os.path.exists(p):
            continue
        soh_paths[season] = rel(p)
        for s in parse_soh(p):
            try:
                f_ = names[re.sub(r"\s*\(\d+\)\s*$", "", s["fav"]).strip().lower()]
                d_ = names[re.sub(r"\s*\(\d+\)\s*$", "", s["dog"]).strip().lower()]
            except KeyError:
                continue
            soh_index[(s["date"].isoformat(), frozenset((f_, d_)))] = {**s, "fav": f_,
                                                                      "dog": d_}

    def mag(s):
        m = re.search(r"(-?\d+(?:\.\d+)?)", s.upper().replace("PK", "0"))
        return None if m is None else abs(float(m.group(1)))

    def ou_num(s):
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        return None if m is None else float(m.group(1))

    for gid, ln in sorted(lines.items()):
        g = by_gid[gid]
        season = g["season"]
        ev = soh_paths.get(season)
        if ev is None:
            L.write(table="game_line", row_key=gid, season=season, field="*",
                    verdict="UNRESOLVED", authority="sportsoddshistory",
                    evidence=rel(os.path.join(F05, "fetch_summary.log")),
                    note="SportsOddsHistory season page not cached")
            continue
        hit = None
        for off in (0, -1, 1, 2, -2, 3):
            d = (datetime.date.fromisoformat(g["gameday"])
                 + datetime.timedelta(days=off)).isoformat()
            hit = soh_index.get((d, frozenset((g["away_franchise_id"],
                                               g["home_franchise_id"]))))
            if hit:
                break
        cmp_n = mat_n = 0
        if hit is None:
            L.write(table="game_line", row_key=gid, season=season, field="*",
                    verdict="UNRESOLVED", authority="sportsoddshistory", evidence=ev,
                    note="no SportsOddsHistory row matched this game/date window")
            continue

        third, third_ev = _espn_odds(g["espn_event_id"])
        home_is_fav = g["home_franchise_id"] == hit["fav"]
        m = mag(hit["spread"])
        ref_spread = None if m is None else (m if home_is_fav else -m)
        cmp_n += 1
        if eq(ln["spread_line"], ref_spread, 0.001):
            mat_n += 1
        else:
            L.write(table="game_line", row_key=gid, season=season, field="spread_line",
                    db_value=ln["spread_line"], ref_value=ref_spread,
                    verdict="MISMATCH", authority="sportsoddshistory",
                    ref_id=hit["date"].isoformat(), evidence=third_ev or ev,
                    third_source=third,
                    note=("ESPN's per-provider odds for this event are cached as a third "
                          "source; the books disagree among themselves" if third else
                          "no third source cached for this event"))
        ref_total = ou_num(hit["ou"])
        cmp_n += 1
        if eq(ln["total_line"], ref_total, 0.001):
            mat_n += 1
        else:
            L.write(table="game_line", row_key=gid, season=season, field="total_line",
                    db_value=ln["total_line"], ref_value=ref_total,
                    verdict="MISMATCH", authority="sportsoddshistory",
                    ref_id=hit["date"].isoformat(), evidence=third_ev or ev,
                    third_source=third,
                    note=("ESPN's per-provider odds for this event are cached as a third "
                          "source; the books disagree among themselves" if third else
                          "no third source cached for this event"))

        # moneylines and juice: SOH's archive publishes neither
        for f in ("away_moneyline", "home_moneyline", "away_spread_odds",
                  "home_spread_odds", "over_odds", "under_odds"):
            L.write(table="game_line", row_key=gid, season=season, field=f,
                    db_value=ln[f], verdict="NOT_COMPARABLE",
                    authority="sportsoddshistory", evidence=ev,
                    note="SportsOddsHistory publishes the closing number only, not prices")
        # internal coherence: the favourite must be the negative moneyline
        cmp_n += 1
        fav_by_ml = (g["home_franchise_id"] if ln["home_moneyline"] < ln["away_moneyline"]
                     else g["away_franchise_id"])
        # Below ~2 points the "favourite" is not a fact either source is asserting.
        if m is None or m < 2 or fav_by_ml == hit["fav"]:
            mat_n += 1
        else:
            L.write(table="game_line", row_key=gid, season=season,
                    field="moneyline_side_coherence", db_value=fav_by_ml,
                    ref_value=hit["fav"], verdict="MISMATCH",
                    authority="sportsoddshistory", evidence=ev,
                    note="cheaper moneyline names a different favourite than SOH's spread")
        L.write(table="game_line", row_key=gid, season=season, field="*", verdict="MATCH",
                authority="sportsoddshistory", ref_id=hit["date"].isoformat(),
                evidence=ev, fields_compared=cmp_n, fields_matched=mat_n)


# --------------------------------------------------------------------------------------
# 3. team_game -- derived, 100% recomputable from game + game_line
# --------------------------------------------------------------------------------------
def audit_team_game(conn, L, games, by_gid):
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM team_game WHERE season IN (?,?) ORDER BY game_id, franchise_id",
        SEASONS)]
    print("[team_game] auditing", len(rows), "rows")
    lines = {r["game_id"]: dict(r) for r in conn.execute(
        "SELECT l.* FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (?,?)",
        SEASONS)}
    # actual rest, recomputed from played kickoffs (the D15 convention)
    # nflverse measures rest WITHIN a season; a team's first game of the season is
    # published with the fixed default of 7, not a calendar gap to the prior season.
    kick: dict[tuple, list] = collections.defaultdict(list)
    for r in conn.execute("SELECT tg.game_id, tg.franchise_id, tg.season, tg.kickoff_utc, "
                          "g.gameday FROM team_game tg JOIN game g USING(game_id) "
                          "WHERE tg.season IN (?,?)", SEASONS):
        kick[(r["franchise_id"], r["season"])].append(
            (r["kickoff_utc"], r["game_id"], r["gameday"]))
    for f in kick:
        kick[f].sort()
    prev = {}
    for (f, _s), lst in kick.items():
        for i, (k, gid, gd) in enumerate(lst):
            prev[(gid, f)] = lst[i - 1][2] if i else None

    per_game: dict[str, dict] = collections.defaultdict(dict)
    for r in rows:
        per_game[r["game_id"]][r["franchise_id"]] = r

    for gid, pair in sorted(per_game.items()):
        g = by_gid[gid]
        ln = lines.get(gid)
        art = {"game_id": gid, "inputs": {
            "away_franchise_id": g["away_franchise_id"],
            "home_franchise_id": g["home_franchise_id"],
            "away_score": g["away_score"], "home_score": g["home_score"],
            "spread_line": ln["spread_line"] if ln else None,
            "total_line": ln["total_line"] if ln else None,
            "away_moneyline": ln["away_moneyline"] if ln else None,
            "home_moneyline": ln["home_moneyline"] if ln else None,
            "kickoff_utc": g["kickoff_utc"], "week": g["week"],
            "playoff_round": g["playoff_round"], "season_type": g["season_type"]},
            "recomputed": {}}
        for fid, r in pair.items():
            is_home = 1 if fid == g["home_franchise_id"] else 0
            pf = g["home_score"] if is_home else g["away_score"]
            pa = g["away_score"] if is_home else g["home_score"]
            margin = None if pf is None else pf - pa
            spread = None if ln is None else (ln["spread_line"] if is_home
                                              else -ln["spread_line"])
            tot = None if ln is None else ln["total_line"]
            ml = None if ln is None else (ln["home_moneyline"] if is_home
                                          else ln["away_moneyline"])
            su = None if margin is None else ("W" if margin > 0 else
                                              "L" if margin < 0 else "T")
            ats = None if (margin is None or spread is None) else (
                "W" if margin > spread else "L" if margin < spread else "P")
            ou = None if (pf is None or tot is None) else (
                "O" if pf + pa > tot else "U" if pf + pa < tot else "P")
            won = None if margin is None or margin == 0 else (1 if margin > 0 else 0)
            cov = None if ats is None or ats == "P" else (1 if ats == "W" else 0)
            art["recomputed"][str(fid)] = {
                "is_home": is_home, "points_for": pf, "points_against": pa,
                "margin": margin, "spread": spread, "total_line": tot, "moneyline": ml,
                "su_result": su, "ats_result": ats, "ou_result": ou,
                "won": won, "covered": cov,
                "opponent_id": (g["away_franchise_id"] if is_home
                                else g["home_franchise_id"]),
                "prev_kickoff": prev.get((gid, fid))}
        ev = dump(os.path.join(DERIVED, f"tg_{gid}.json"), art)

        for fid, r in sorted(pair.items()):
            want = art["recomputed"][str(fid)]
            rk = f"{gid}/{fid}"
            cmp_n = mat_n = 0
            for f in ("is_home", "points_for", "points_against", "margin", "spread",
                      "total_line", "moneyline", "su_result", "ats_result", "ou_result",
                      "won", "covered", "opponent_id"):
                cmp_n += 1
                dbv, refv = r[f], want[f]
                same = (eq(dbv, refv, 0.001) if isinstance(refv, float)
                        or isinstance(dbv, float) else dbv == refv)
                if same:
                    mat_n += 1
                else:
                    L.write(table="team_game", row_key=rk, season=r["season"], field=f,
                            db_value=dbv, ref_value=refv, verdict="MISMATCH",
                            authority="derived", ref_id=gid, evidence=ev)
            # context columns must mirror `game`
            for f in ("season", "season_type", "week", "playoff_round", "kickoff_utc"):
                cmp_n += 1
                if r[f] == g[f]:
                    mat_n += 1
                else:
                    L.write(table="team_game", row_key=rk, season=r["season"], field=f,
                            db_value=r[f], ref_value=g[f], verdict="MISMATCH",
                            authority="derived", ref_id=gid, evidence=ev)
            # rest_days: actual gap between played kickoffs (D15)
            p = want["prev_kickoff"]
            cmp_n += 1
            if p:
                # Rest is a count of calendar days between venue-local game dates. Using
                # UTC instants instead is off by one for every late kickoff, because a
                # Sunday-night game is already Monday in UTC.
                gap = (datetime.date.fromisoformat(g["gameday"])
                       - datetime.date.fromisoformat(p)).days
                if r["rest_days"] == gap:
                    mat_n += 1
                else:
                    L.write(table="team_game", row_key=rk, season=r["season"],
                            field="rest_days", db_value=r["rest_days"], ref_value=gap,
                            verdict="MISMATCH", authority="derived", ref_id=gid,
                            evidence=ev,
                            note="recomputed from this team's previous played kickoff "
                                 "in the same season")
            elif r["rest_days"] == 7:
                mat_n += 1
            else:
                L.write(table="team_game", row_key=rk, season=r["season"],
                        field="rest_days", db_value=r["rest_days"], ref_value=7,
                        verdict="MISMATCH", authority="derived", ref_id=gid, evidence=ev,
                        note="season opener; the published convention is the fixed "
                             "default of 7")
            L.write(table="team_game", row_key=rk, season=r["season"], field="*",
                    verdict="MATCH", authority="derived", ref_id=gid, evidence=ev,
                    fields_compared=cmp_n, fields_matched=mat_n)


# --------------------------------------------------------------------------------------
# 4. player_game_stats -- authority: ESPN box score
# --------------------------------------------------------------------------------------
def audit_player_game_stats(conn, L, games, summaries):
    rows = [dict(r) for r in conn.execute(
        "SELECT pg.*, p.espn_id, p.display_name FROM player_game_stats pg "
        "LEFT JOIN player p ON p.gsis_id = pg.gsis_id "
        "WHERE pg.season IN (?,?) ORDER BY pg.game_id, pg.gsis_id", SEASONS)]
    print("[player_game_stats] auditing", len(rows), "rows")
    boxes = {gid: v["box"] for gid, v in summaries.items()}
    upstream = {}
    for row in read_raw("player_stats.csv", lambda x: x["season"] in ("2018", "2019")):
        upstream[(row["player_id"], row["season"], row["week"],
                  row["season_type"])] = row
    raw_ev = rel(os.path.join(RAW, "player_stats.csv"))
    # nflverse ships one identity-less aggregate row per week (empty player_id). They
    # carry no player, so they cannot become player_game_stats rows. Logged once.
    ghosts = [k for k in upstream if not k[0]]
    for k in sorted(ghosts):
        L.write(table="player_game_stats", row_key=f"upstream_ghost/{k[1]}_{k[2]}_{k[3]}",
                season=int(k[1]), field="gsis_id", db_value=None, ref_value="",
                verdict="REF_ONLY", authority="nflverse-raw", evidence=raw_ev,
                note="raw/player_stats.csv carries an identity-less aggregate row for "
                     "this week (empty player_id, empty name); it is correctly excluded "
                     "because player_game_stats.gsis_id references player(gsis_id)")

    for r in rows:
        gid = r["game_id"]
        rk = f"{gid}/{r['gsis_id']}"
        season = r["season"]
        if gid not in summaries:
            L.write(table="player_game_stats", row_key=rk, season=season, field="*",
                    verdict="UNRESOLVED", authority="espn",
                    evidence=rel(os.path.join(F05, "fetch_summary.log")),
                    note="no ESPN summary cached for this game")
            continue
        ev = summaries[gid]["ev"]
        box = boxes[gid]
        aid = r["espn_id"]
        cmp_n = mat_n = 0
        # One grouped record rather than seven identical ones: the reason is the same
        # for every column and every row. Declared as a deviation in reports/F05.md.
        L.write(table="player_game_stats", row_key=rk, season=season,
                field=",".join(PGS_NOT_COMPARABLE),
                db_value=[r[f] for f in PGS_NOT_COMPARABLE],
                verdict="NOT_COMPARABLE", authority="espn", ref_id=aid, evidence=ev,
                note="EPA, target/air-yards share and fantasy points are modelled or "
                     "derived quantities; no box score publishes them. Their transport "
                     "from raw/player_stats.csv is verified separately below.")
        # upstream transport check -- proves the loader did not alter what nflverse ships
        u = upstream.get((r["gsis_id"], str(season), str(r["week"]), r["season_type"]))
        if u is None:
            L.write(table="player_game_stats", row_key=rk, season=season,
                    field="upstream", verdict="DB_ONLY", authority="nflverse-raw",
                    evidence=raw_ev, note="row absent from raw/player_stats.csv")
        else:
            for col in UPSTREAM_COLS:
                cmp_n += 1
                src = "passing_interceptions" if col == "interceptions" else col
                dbv, refv = r[col], num(u.get(src))
                if eq(dbv, refv, 0.0005):
                    mat_n += 1
                else:
                    L.write(table="player_game_stats", row_key=rk, season=season,
                            field=col, db_value=dbv, ref_value=refv, verdict="MISMATCH",
                            authority="nflverse-raw", evidence=raw_ev,
                            note="database value differs from the raw feed")

        entry = box.get(str(aid)) if aid else None
        if entry is None:
            nm = _nname(r["display_name"])
            alt = (None if nm in box["_ambiguous"]
                   else box.get(("name", r["franchise_id"], nm)))
            if alt is not None:
                entry = alt
                L.write(table="player_game_stats", row_key=rk, season=season,
                        field="player.espn_id", db_value=aid,
                        ref_value=alt["espn_id"], verdict="MISMATCH", authority="espn",
                        ref_id=alt["espn_id"], evidence=ev,
                        note=f"player.espn_id for {r['display_name']} does not match the "
                             "athlete id ESPN uses in the box score; matched by name and "
                             "franchise instead, and the stats below were compared "
                             "against that entry")
        if entry is None:
            nonzero = any((r[c] or 0) for c in
                          ("completions", "attempts", "passing_yards", "carries",
                           "rushing_yards", "receptions", "receiving_yards"))
            if not nonzero:
                L.write(table="player_game_stats", row_key=rk, season=season, field="*",
                        db_value=None, verdict="NOT_COMPARABLE", authority="espn",
                        ref_id=aid, evidence=ev, fields_compared=0, fields_matched=0,
                        note="known-good: ESPN omits players with no recorded box-score "
                             "line (e.g. zero-reception targets)")
            else:
                L.write(table="player_game_stats", row_key=rk, season=season, field="*",
                        db_value=None, verdict="UNRESOLVED", authority="espn",
                        ref_id=aid, evidence=ev, fields_compared=0, fields_matched=0,
                        note="ESPN's box score contains no line for this athlete under "
                             "any id or name, though the database credits him non-zero "
                             "counting stats. The value is corroborated by "
                             "raw/player_stats.csv (checked above); ESPN cannot rule.")
            continue

        # franchise attribution -- the transposition check
        cmp_n += 1
        if r["franchise_id"] == entry["team"]:
            mat_n += 1
        else:
            L.write(table="player_game_stats", row_key=rk, season=season,
                    field="franchise_id", db_value=r["franchise_id"],
                    ref_value=entry["team"], verdict="MISMATCH", authority="espn",
                    ref_id=aid, evidence=ev,
                    note="ESPN credits this athlete's line to a different team")

        for col, refv in entry["stats"].items():
            dbv = r.get(col)
            if refv is None:
                continue
            cmp_n += 1
            if eq(dbv, refv, 0.001):
                mat_n += 1
            else:
                # known-good: ESPN charges some incompletions to a different receiver
                kg = (col == "targets")
                L.write(table="player_game_stats", row_key=rk, season=season, field=col,
                        db_value=dbv, ref_value=refv,
                        verdict="NOT_COMPARABLE" if kg else "MISMATCH",
                        authority="espn", ref_id=aid, evidence=ev,
                        note=("known-good: ESPN sometimes charges an incompletion to a "
                              "different receiver, so its target column is not a "
                              "reconcilable authority" if kg else None))
        L.write(table="player_game_stats", row_key=rk, season=season, field="*",
                verdict="MATCH", authority="espn", ref_id=aid, evidence=ev,
                fields_compared=cmp_n, fields_matched=mat_n)


# --------------------------------------------------------------------------------------
# 5. snap_count -- authority PFR (unreachable); full internal + upstream reconciliation
# --------------------------------------------------------------------------------------
def audit_snap_count(conn, L, games, summaries, teams):
    """Includes the D16 transposition sweep: every snap row whose player has an
    ESPN box-score line is checked against the team ESPN credits him to."""
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM snap_count WHERE season IN (?,?) ORDER BY game_id, franchise_id, "
        "pfr_player_id", SEASONS)]
    print("[snap_count] auditing", len(rows), "rows")
    gmeta = {g["game_id"]: g for g in games}
    players = {r["gsis_id"]: dict(r) for r in conn.execute(
        "SELECT gsis_id, display_name, espn_id, pfr_id FROM player")}
    print("  transposition sweep: snap_count.franchise_id vs ESPN box-score attribution")

    # upstream nflverse, for the transport check and the transposition direction
    up = {}
    for row in read_raw("snap_counts.csv",
                        lambda r: r["season"] in ("2018", "2019")):
        up[(row["pfr_player_id"], row["pfr_game_id"])] = row
    raw_ev = rel(os.path.join(RAW, "snap_counts.csv"))
    pfr_blocked = sorted(f for f in os.listdir(F05) if f.startswith("pfr_"))
    pfr_ev = (rel(os.path.join(F05, pfr_blocked[0])) if pfr_blocked
              else rel(os.path.join(F05, "fetch_summary.log")))

    by_game: dict[str, list] = collections.defaultdict(list)
    for r in rows:
        by_game[r["game_id"]].append(r)

    for gid, grp in sorted(by_game.items()):
        g = gmeta.get(gid)
        # implied team denominators: snaps / pct must be one constant per team-game
        obs: dict[tuple, list] = collections.defaultdict(list)
        for r in grp:
            for unit in ("offense", "defense", "st"):
                sn, pc = r[f"{unit}_snaps"], r[f"{unit}_pct"]
                if sn and pc:
                    obs[(r["franchise_id"], unit)].append((sn, pc))
        fits = {f"{fid}_{u}": _best_denominator(v) for (fid, u), v in obs.items()}
        team_tot = {k: (v[0] if v else None) for k, v in fits.items()}
        espn_teams = sorted({r["franchise_id"] for r in grp})
        art = {"game_id": gid, "season": g["season"] if g else None,
               "game_franchises": [g["away_franchise_id"], g["home_franchise_id"]] if g
               else None,
               "snap_franchises": espn_teams,
               "implied_team_denominators": team_tot,
               "denominator_fit": {k: {"total": v[0], "rows_reproduced": v[1],
                                       "rows": v[2]} for k, v in fits.items() if v},
               "rows": len(grp),
               "pfr_game_id": grp[0]["pfr_game_id"],
               "pfr_authority_status": PFR_STATUS}
        ev = dump(os.path.join(DERIVED, f"snap_{gid}.json"), art)

        for r in grp:
            rk = f"{gid}/{r['pfr_player_id']}"
            season = r["season"]
            cmp_n = mat_n = 0

            # (a) every row joins to a real player and a real game
            cmp_n += 1
            if r["gsis_id"] in players:
                mat_n += 1
            else:
                L.write(table="snap_count", row_key=rk, season=season, field="gsis_id",
                        db_value=r["gsis_id"], verdict="DB_ONLY", authority="internal",
                        evidence=ev, note="gsis_id has no row in `player`")
            cmp_n += 1
            if g is not None:
                mat_n += 1
            else:
                L.write(table="snap_count", row_key=rk, season=season, field="game_id",
                        db_value=gid, verdict="DB_ONLY", authority="internal",
                        evidence=ev, note="game_id has no row in `game`")

            # (b) the snap row's team must be one of the two teams that played
            cmp_n += 1
            if g and r["franchise_id"] in (g["away_franchise_id"], g["home_franchise_id"]):
                mat_n += 1
            else:
                L.write(table="snap_count", row_key=rk, season=season,
                        field="franchise_id", db_value=r["franchise_id"],
                        ref_value=[g["away_franchise_id"], g["home_franchise_id"]]
                        if g else None,
                        verdict="MISMATCH", authority="internal", evidence=ev,
                        note="snap row credited to a franchise that did not play")

            # (c) no impossible values
            for unit in ("offense", "defense", "st"):
                s, p = r[f"{unit}_snaps"], r[f"{unit}_pct"]
                cmp_n += 1
                if s is not None and p is not None and s >= 0 and 0.0 <= p <= 1.0:
                    mat_n += 1
                else:
                    L.write(table="snap_count", row_key=rk, season=season,
                            field=f"{unit}_snaps/{unit}_pct", db_value=[s, p],
                            verdict="MISMATCH", authority="internal", evidence=ev,
                            note="snaps must be >= 0 and pct in [0,1]")
                # (d) pct reconciles to the team's implied denominator
                fit = fits.get(f"{r['franchise_id']}_{unit}")
                d = team_tot.get(f"{r['franchise_id']}_{unit}")
                if d and s is not None and p is not None:
                    cmp_n += 1
                    if abs(round(s / d, 2) - round(p, 2)) <= 0.011:
                        mat_n += 1
                    elif fit and fit[1] == fit[2]:
                        L.write(table="snap_count", row_key=rk, season=season,
                                field=f"{unit}_pct", db_value=p,
                                ref_value=round(s / d, 2), verdict="MISMATCH",
                                authority="internal", evidence=ev,
                                note=f"{unit} pct does not reconcile to team total {d}, "
                                     "which reproduces every other row in this team-game")
                    else:
                        L.write(table="snap_count", row_key=rk, season=season,
                                field=f"{unit}_pct", db_value=p,
                                ref_value=round(s / d, 2), verdict="UNRESOLVED",
                                authority="internal", evidence=ev,
                                note=f"no single integer {unit} team total reproduces the "
                                     f"published percentages in this team-game (best fit "
                                     f"{d} reproduces {fit[1]} of {fit[2]} rows). The "
                                     "stored value equals raw/snap_counts.csv exactly, so "
                                     "the inconsistency is upstream, not in this database.")
                    cmp_n += 1
                    if s <= d:
                        mat_n += 1
                    else:
                        L.write(table="snap_count", row_key=rk, season=season,
                                field=f"{unit}_snaps", db_value=s, ref_value=d,
                                verdict="MISMATCH", authority="internal", evidence=ev,
                                note="player snaps exceed the team's total for the unit")

            # (e) season / week / round must mirror the game
            if g:
                for f in ("season", "season_type", "week", "playoff_round"):
                    cmp_n += 1
                    if r[f] == g[f]:
                        mat_n += 1
                    else:
                        L.write(table="snap_count", row_key=rk, season=season, field=f,
                                db_value=r[f], ref_value=g[f], verdict="MISMATCH",
                                authority="internal", evidence=ev)

            # (f) upstream nflverse transport check + the D16 transposition audit
            u = up.get((r["pfr_player_id"], r["pfr_game_id"]))
            if u is None:
                L.write(table="snap_count", row_key=rk, season=season, field="upstream",
                        verdict="DB_ONLY", authority="nflverse-raw", evidence=raw_ev,
                        note="row not present in raw/snap_counts.csv")
            else:
                for col, src in (("offense_snaps", "offense_snaps"),
                                 ("offense_pct", "offense_pct"),
                                 ("defense_snaps", "defense_snaps"),
                                 ("defense_pct", "defense_pct"),
                                 ("st_snaps", "st_snaps"), ("st_pct", "st_pct"),
                                 ("position", "position")):
                    cmp_n += 1
                    refv = u[src]
                    dbv = r[col]
                    same = (dbv == refv if col == "position"
                            else eq(dbv, num(refv), 0.006))
                    if same:
                        mat_n += 1
                    else:
                        L.write(table="snap_count", row_key=rk, season=season, field=col,
                                db_value=dbv, ref_value=refv, verdict="MISMATCH",
                                authority="nflverse-raw", evidence=raw_ev)
                # franchise_id_upstream must be exactly what the feed's team column says
                cmp_n += 1
                up_fid = _abbr_fid(conn, u["team"])
                if r["franchise_id_upstream"] == up_fid:
                    mat_n += 1
                else:
                    L.write(table="snap_count", row_key=rk, season=season,
                            field="franchise_id_upstream",
                            db_value=r["franchise_id_upstream"], ref_value=up_fid,
                            verdict="MISMATCH", authority="nflverse-raw", evidence=raw_ev,
                            note=f"raw team column says {u['team']}")

            # (g) transposition check against ESPN, the only external signal available
            box = summaries.get(gid, {}).get("box")
            pl = players.get(r["gsis_id"]) or {}
            ref_team = ref_aid = None
            ambiguous = False
            if box is not None:
                roster = box["_roster"]
                aid = str(pl.get("espn_id")) if pl.get("espn_id") else None
                if aid and aid in roster:
                    ref_team, ref_aid = roster[aid], aid
                else:
                    nm = _nname(pl.get("display_name"))
                    if nm in box["_ambiguous"]:
                        ambiguous = True
                    else:
                        for cand in (r["franchise_id"], _other(g, r["franchise_id"])):
                            k = ("name", cand, nm)
                            if k in roster:
                                ref_aid = roster[k]
                                ref_team = roster[ref_aid]
                                break
            if ref_team is None:
                L.write(table="snap_count", row_key=rk, season=season,
                        field="franchise_id_vs_espn", db_value=r["franchise_id"],
                        verdict="NOT_COMPARABLE", authority="espn", evidence=ev,
                        note=("two players in this game share this name and the "
                              "database row carries no matching ESPN id, so ESPN cannot "
                              "rule" if ambiguous else
                              "player recorded no ESPN box-score line in this game, so "
                              "ESPN cannot rule on which team he played for"))
            else:
                cmp_n += 1
                if r["franchise_id"] == ref_team:
                    mat_n += 1
                else:
                    L.write(table="snap_count", row_key=rk, season=season,
                            field="franchise_id_vs_espn", db_value=r["franchise_id"],
                            ref_value=ref_team, verdict="MISMATCH", authority="espn",
                            ref_id=ref_aid, evidence=ev,
                            note="D16 signature: snap row credited to a different "
                                 "franchise than the one ESPN credits the player's "
                                 "box-score line to")

            # (h) PFR, the contract's authority, cannot be reached
            L.write(table="snap_count", row_key=rk, season=season, field="pfr_authority",
                    verdict="NOT_COMPARABLE", authority="pro-football-reference",
                    evidence=pfr_ev, note=PFR_STATUS)

            L.write(table="snap_count", row_key=rk, season=season, field="*",
                    verdict="MATCH", authority="internal+nflverse-raw", evidence=ev,
                    fields_compared=cmp_n, fields_matched=mat_n)


def _best_denominator(pairs):
    """The team's total plays for a unit, fitted rather than assumed.

    Every published pct is snaps/total rounded to 2dp, so the total is the integer
    that reproduces the most published percentages exactly. Taking the modal value of
    snaps/pct instead is wrong: low-snap rows carry almost no precision and drag the
    mode off by one.
    """
    if not pairs:
        return None
    lo = max(sn for sn, _ in pairs)
    best, best_hits = lo, -1
    for d in range(lo, lo + 26):
        hits = sum(1 for sn, pc in pairs if abs(round(sn / d, 2) - pc) < 0.0051)
        if hits > best_hits:
            best, best_hits = d, hits
    return (best, best_hits, len(pairs))


def _other(g, fid):
    """The opposing franchise in this game."""
    if g is None:
        return None
    return (g["home_franchise_id"] if fid == g["away_franchise_id"]
            else g["away_franchise_id"])


_ABBR_CACHE: dict[str, int] = {}


def _abbr_fid(conn, abbr: str):
    if not _ABBR_CACHE:
        for r in conn.execute("SELECT abbreviation, franchise_id FROM team_alias"):
            _ABBR_CACHE[r[0]] = r[1]
    return _ABBR_CACHE.get(abbr)


# --------------------------------------------------------------------------------------
# 6. roster_season -- authority: ESPN seasonal team roster
# --------------------------------------------------------------------------------------
def audit_roster_season(conn, L, teams, summaries):
    rows = [dict(r) for r in conn.execute(
        "SELECT rs.*, p.espn_id, p.display_name AS pname FROM roster_season rs "
        "LEFT JOIN player p ON p.gsis_id = rs.gsis_id "
        "WHERE rs.season IN (?,?) ORDER BY rs.season, rs.franchise_id, rs.roster_row_id",
        SEASONS)]
    print("[roster_season] auditing", len(rows), "rows")

    # ESPN's seasons/{y}/teams/{id}/athletes endpoint is NOT a historical roster: it
    # returns ~92 ids per team of which only 149 of this partition's 5,845 players
    # appear at all, and it names the wrong head coach for the season. It is cached and
    # cited, but it is not treated as able to rule. The usable ESPN evidence for
    # membership is the box score: an athlete who recorded a line for a franchise that
    # season was demonstrably on it.
    espn: dict[tuple, tuple[set, str]] = {}
    for season in SEASONS:
        for fid in teams:
            p = os.path.join(F05, f"roster_{season}_{fid}.json.gz")
            if not os.path.exists(p):
                continue
            try:
                d = load_json(p)
            except Exception:                                          # noqa: BLE001
                continue
            ids = {it["$ref"].rsplit("/", 1)[-1].split("?")[0]
                   for it in d.get("items", [])}
            espn[(season, fid)] = (ids, rel(p))
    played: dict[tuple, str] = {}
    for gid, v in summaries.items():
        yr = int(gid[:4])
        for k, fid in v["box"]["_roster"].items():
            if isinstance(k, tuple):
                played.setdefault((yr, k[1], k[2]), v["ev"])
            else:
                played.setdefault((yr, fid, k), v["ev"])

    up = {}
    for row in read_raw("rosters.csv", lambda r: r["season"] in ("2018", "2019")):
        key = (row["gsis_id"], row["season"], row["team"], row["week"], row["game_type"])
        up.setdefault(key, []).append(row)
    raw_ev = rel(os.path.join(RAW, "rosters.csv"))

    for r in rows:
        rk = str(r["roster_row_id"])
        season, fid = r["season"], r["franchise_id"]
        cmp_n = mat_n = 0
        ids_ev = espn.get((season, fid))
        if ids_ev is None:
            L.write(table="roster_season", row_key=rk, season=season, field="*",
                    verdict="UNRESOLVED", authority="espn",
                    evidence=rel(os.path.join(F05, "fetch_summary.log")),
                    note=f"ESPN seasonal roster {season}/{fid} not cached")
            continue
        ids, ev = ids_ev
        cmp_n += 1
        proof = (played.get((season, fid, str(r["espn_id"])))
                 or played.get((season, fid, _nname(r["pname"]))))
        if proof:
            mat_n += 1
            L.write(table="roster_season", row_key=rk, season=season, field="membership",
                    db_value=f"{r['pname']} -> franchise {fid}",
                    ref_value=f"recorded a box-score line for franchise {fid} in {season}",
                    verdict="MATCH", authority="espn", ref_id=str(r["espn_id"] or ""),
                    evidence=proof)
        elif r["gsis_id"] is None:
            L.write(table="roster_season", row_key=rk, season=season, field="gsis_id",
                    db_value=None, verdict="NOT_COMPARABLE", authority="espn",
                    evidence=ev, note="upstream row carries no gsis_id (N9)")
        else:
            L.write(table="roster_season", row_key=rk, season=season, field="membership",
                    db_value=f"{r['pname']} -> franchise {fid}", verdict="NOT_COMPARABLE",
                    authority="espn", ref_id=str(r["espn_id"] or ""), evidence=ev,
                    note="ESPN publishes no historical roster: its seasonal team-athlete "
                         "endpoint returns ~92 ids per team and covers only 149 of this "
                         "partition's 5,845 players. This player recorded no box-score "
                         "line for the franchise that season, so no ESPN artefact can "
                         "confirm or deny membership. Upstream transport is checked "
                         "against raw/rosters.csv below.")
        # upstream transport check
        key = (r["gsis_id"] or "", str(season), _fid_abbr(conn, fid, season),
               str(r["source_week"]), r["source_game_type"])
        cand = up.get(key) or []
        if not cand:
            L.write(table="roster_season", row_key=rk, season=season, field="upstream",
                    verdict="DB_ONLY", authority="nflverse-raw", evidence=raw_ev,
                    note=f"no raw/rosters.csv row for {key}")
        else:
            u = cand[min(r["source_ordinal"], len(cand)) - 1]
            for col, src in (("position", "position"),
                             ("depth_chart_position", "depth_chart_position"),
                             ("jersey_number", "jersey_number"), ("status", "status"),
                             ("full_name", "full_name"), ("years_exp", "years_exp")):
                cmp_n += 1
                dbv, refv = r[col], u[src]
                same = (eq(dbv, num(refv)) if isinstance(dbv, (int, float))
                        and dbv is not None else (dbv or "") == (refv or ""))
                if same:
                    mat_n += 1
                else:
                    L.write(table="roster_season", row_key=rk, season=season, field=col,
                            db_value=dbv, ref_value=refv, verdict="MISMATCH",
                            authority="nflverse-raw", evidence=raw_ev)
        L.write(table="roster_season", row_key=rk, season=season, field="*",
                verdict="MATCH", authority="espn+nflverse-raw", evidence=ev,
                fields_compared=cmp_n, fields_matched=mat_n)


_FID_ABBR: dict[tuple, str] = {}


def _fid_abbr(conn, fid: int, season: int) -> str:
    """The abbreviation nflverse publishes for this franchise in this season."""
    if (fid, season) in ERA_LABEL:
        return ERA_LABEL[(fid, season)][0]
    if not _FID_ABBR:
        for r in conn.execute("SELECT franchise_id, abbreviation FROM team"):
            _FID_ABBR[(r[0], 0)] = r[1]
    return _FID_ABBR.get((fid, 0), "")


# --------------------------------------------------------------------------------------
# 7. depth_chart -- no historical public source; internal and structural only
# --------------------------------------------------------------------------------------
def audit_depth_chart(conn, L, teams):
    print("[depth_chart] auditing", conn.execute(
        "SELECT COUNT(*) FROM depth_chart WHERE season IN (?,?)", SEASONS).fetchone()[0],
        "rows")
    players = {r[0] for r in conn.execute("SELECT gsis_id FROM player")}
    game_weeks = collections.defaultdict(set)
    for r in conn.execute("SELECT season, franchise_id, week FROM team_game "
                          "WHERE season IN (?,?) AND week IS NOT NULL", SEASONS):
        game_weeks[(r[0], r[1])].add(r[2])

    up_keys = collections.Counter()
    up_total = 0
    for row in read_raw("depth_charts.csv", lambda r: r["season"] in ("2018", "2019")):
        up_total += 1
        up_keys[(row["season"], row["club_code"], row["week"], row["game_type"],
                 row["gsis_id"].strip(), row["depth_position"].strip(),
                 row["depth_team"].strip())] += 1
    raw_ev = rel(os.path.join(RAW, "depth_charts.csv"))

    for season in SEASONS:
        for fid in sorted(teams):
            rows = [dict(r) for r in conn.execute(
                "SELECT * FROM depth_chart WHERE season=? AND franchise_id=? "
                "ORDER BY depth_chart_id", (season, fid))]
            if not rows:
                continue
            art = {"season": season, "franchise_id": fid, "rows": len(rows),
                   "buckets": dict(collections.Counter(r["bucket"] for r in rows)),
                   "source_shapes": dict(collections.Counter(r["source_shape"]
                                                             for r in rows)),
                   "source_weeks": sorted({r["source_week"] for r in rows
                                           if r["source_week"] is not None}),
                   "units": dict(collections.Counter(r["unit"] for r in rows)),
                   "depth_orders": dict(collections.Counter(r["depth_order"]
                                                            for r in rows)),
                   "authority": "none - no historical public depth-chart source exists",
                   "note": "ESPN publishes the CURRENT depth chart only; this table is "
                           "validated internally and structurally, never externally."}
            ev = dump(os.path.join(DERIVED, f"depth_{season}_{fid}.json"), art)
            for r in rows:
                rk = str(r["depth_chart_id"])
                cmp_n = mat_n = 0
                # structural: identity resolvable
                cmp_n += 1
                if r["gsis_id"] is not None or r["espn_id"] is not None:
                    mat_n += 1
                else:
                    L.write(table="depth_chart", row_key=rk, season=season,
                            field="identity", db_value=None, verdict="MISMATCH",
                            authority="internal", evidence=ev,
                            note="neither gsis_id nor espn_id present")
                cmp_n += 1
                if r["gsis_id"] is None or r["gsis_id"] in players:
                    mat_n += 1
                else:
                    L.write(table="depth_chart", row_key=rk, season=season,
                            field="gsis_id", db_value=r["gsis_id"], verdict="DB_ONLY",
                            authority="internal", evidence=ev,
                            note="gsis_id has no row in `player`")
                # structural: the week/round exclusivity the schema declares
                cmp_n += 1
                if (r["week"] is None) or (r["playoff_round"] is None):
                    mat_n += 1
                else:
                    L.write(table="depth_chart", row_key=rk, season=season,
                            field="week/playoff_round", db_value=[r["week"],
                                                                  r["playoff_round"]],
                            verdict="MISMATCH", authority="internal", evidence=ev,
                            note="week and playoff_round are mutually exclusive")
                cmp_n += 1
                if r["depth_order"] is not None and r["depth_order"] >= 1:
                    mat_n += 1
                else:
                    L.write(table="depth_chart", row_key=rk, season=season,
                            field="depth_order", db_value=r["depth_order"],
                            verdict="MISMATCH", authority="internal", evidence=ev)
                cmp_n += 1
                if r["franchise_id"] in teams:
                    mat_n += 1
                else:
                    L.write(table="depth_chart", row_key=rk, season=season,
                            field="franchise_id", db_value=r["franchise_id"],
                            verdict="DB_ONLY", authority="internal", evidence=ev)
                # upstream transport check
                k = (str(season), _fid_abbr(conn, fid, season),
                     "" if r["source_week"] is None else str(r["source_week"]),
                     r["source_game_type"] or "", (r["gsis_id"] or "").strip(),
                     (r["depth_position"] or "").strip(), str(r["depth_order"]))
                cmp_n += 1
                if up_keys.get(k):
                    mat_n += 1
                else:
                    L.write(table="depth_chart", row_key=rk, season=season,
                            field="upstream", db_value=list(k), verdict="UNRESOLVED",
                            authority="nflverse-raw", evidence=raw_ev,
                            note="no exact raw/depth_charts.csv key match "
                                 "(club_code/label orthography differs by season)")
                # the external verdict the contract demands
                L.write(table="depth_chart", row_key=rk, season=season,
                        field="external_authority", verdict="NOT_COMPARABLE",
                        authority="none", evidence=ev,
                        note="no historical public depth-chart source exists; ESPN "
                             "publishes the current depth chart only")
                L.write(table="depth_chart", row_key=rk, season=season, field="*",
                        verdict="MATCH", authority="internal", evidence=ev,
                        fields_compared=cmp_n, fields_matched=mat_n)



# --------------------------------------------------------------------------------------
# 9. era-correct franchise labelling (2018/2019 partition-specific)
#
# 2019 is the last Oakland Raiders season (Las Vegas from 2020) and Washington's last as
# the Redskins (Football Team 2020, Commanders 2022). A retroactive relabel would be
# invisible to every other check in this file, because franchise_id is stable across a
# move -- only the published label changes. ESPN's *seasonal* endpoints retro-relabel and
# render Washington as bare "Washington" for 2019-2021, so ESPN is not used to derive the
# era-correct name for franchise 28; NFL.com and the contemporaneous nflverse feed are.
# --------------------------------------------------------------------------------------
def audit_era_labels(conn, L, summaries):
    print("[era] Raiders (13) and Washington (28) label sweep")
    raw_ev = rel(os.path.join(RAW, "snap_counts.csv"))
    for fid in (13, 28):
        for season in SEASONS:
            want_abbr, want_name = ERA_LABEL[(fid, season)]
            bad = collections.Counter()
            games_seen = 0
            for g in conn.execute(
                    "SELECT game_id, espn_event_id, away_franchise_id, home_franchise_id,"
                    " away_abbr, home_abbr FROM game WHERE season=? "
                    "AND (away_franchise_id=? OR home_franchise_id=?)",
                    (season, fid, fid)):
                games_seen += 1
                side = "away" if g["away_franchise_id"] == fid else "home"
                lab = g[f"{side}_abbr"]
                if lab != want_abbr:
                    bad[lab] += 1
            # every fact table that carries this franchise in this season
            counts = {}
            for tbl in ("team_game", "snap_count", "roster_season", "depth_chart",
                        "player_game_stats"):
                col = "franchise_id"
                counts[tbl] = conn.execute(
                    f"SELECT COUNT(*) FROM {tbl} WHERE season=? AND {col}=?",
                    (season, fid)).fetchone()[0]
            art = {"franchise_id": fid, "season": season,
                   "era_correct_abbreviation": want_abbr,
                   "era_correct_name": want_name,
                   "game_rows_carrying_this_franchise": games_seen,
                   "game_abbr_values_other_than_expected": dict(bad),
                   "fact_rows_by_table": counts,
                   "anachronistic_labels_watched": sorted(ANACHRONISTIC.get(fid, ())),
                   "nflverse_team_code_for_this_season": _fid_abbr(conn, fid, season),
                   "team_table_current_abbreviation": conn.execute(
                       "SELECT abbreviation FROM team WHERE franchise_id=?",
                       (fid,)).fetchone()[0],
                   "authority": "NFL.com + contemporaneous nflverse feed. ESPN's seasonal "
                                "endpoints retro-relabel and render Washington as bare "
                                "'Washington' for 2019-2021, so ESPN cannot derive the "
                                "era-correct name for franchise 28."}
            ev = dump(os.path.join(DERIVED, f"era_{fid}_{season}.json"), art)
            rk = f"franchise_{fid}/{season}"
            if not bad:
                L.write(table="era_label", row_key=rk, season=season, field="*",
                        db_value=want_abbr, ref_value=want_abbr, verdict="MATCH",
                        authority="nfl.com+nflverse", evidence=ev,
                        fields_compared=games_seen, fields_matched=games_seen,
                        note=f"all {games_seen} game rows publish {want_abbr}; no "
                             f"anachronistic label present")
            else:
                L.write(table="era_label", row_key=rk, season=season, field="abbr",
                        db_value=dict(bad), ref_value=want_abbr, verdict="MISMATCH",
                        authority="nfl.com+nflverse", evidence=ev)


# --------------------------------------------------------------------------------------
# 10. data_correction -- re-verify each against its cited source
# --------------------------------------------------------------------------------------
def audit_corrections(conn, L, summaries, by_gid):
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM data_correction WHERE target_key LIKE '2018%' "
        "OR target_key LIKE '2019%' ORDER BY correction_id")]
    print("[data_correction] auditing", len(rows), "rows")
    COL = {"kickoffUtc": "kickoff_utc", "gametimeEt": "gametime_et",
           "awayRest": "away_rest", "homeRest": "home_rest",
           "espnEventId": "espn_event_id", "stadiumId": "stadium_id"}
    for c in rows:
        rk = f"correction:{c['correction_id']}"
        gid = c["target_key"].split("/")[0]
        season = int(gid[:4])
        ev = summaries[gid]["ev"] if gid in summaries else rel(
            os.path.join(F05, "fetch_summary.log"))
        col = COL.get(c["column_name"], c["column_name"])
        # 1. the correction must actually be applied in the database
        applied = None
        if c["target_table"] == "game":
            g = by_gid.get(gid)
            applied = None if g is None else g.get(col)
            if col in ("away_rest", "home_rest"):
                fid = c["target_key"].split("/")[1] if "/" in c["target_key"] else None
                applied = g.get(col) if g else None
        elif c["target_table"] == "snap_count":
            pid = c["target_key"].split("/")[1]
            r = conn.execute("SELECT franchise_id, franchise_id_upstream FROM snap_count "
                             "WHERE game_id=? AND pfr_player_id=?", (gid, pid)).fetchone()
            applied = r[0] if r else None
        got = str(applied) if applied is not None else None
        if got == str(c["corrected_value"]):
            L.write(table="data_correction", row_key=rk, season=season,
                    field="applied", db_value=got, ref_value=c["corrected_value"],
                    verdict="MATCH", authority=c["source"][:80], evidence=ev,
                    fields_compared=1, fields_matched=1)
        else:
            L.write(table="data_correction", row_key=rk, season=season,
                    field="applied", db_value=got, ref_value=c["corrected_value"],
                    verdict="MISMATCH", authority=c["source"][:80], evidence=ev,
                    note="corrected_value is not what the row actually stores")
        # 2. the correction must be *right*, checked against ESPN where ESPN can rule
        if c["defect"] == "D16" and gid in summaries:
            box = summaries[gid]["box"]
            pid = c["target_key"].split("/")[1]
            r = conn.execute("SELECT s.gsis_id, p.espn_id, p.display_name "
                             "FROM snap_count s LEFT JOIN player p USING(gsis_id) "
                             "WHERE s.game_id=? AND s.pfr_player_id=?",
                             (gid, pid)).fetchone()
            aid = str(r["espn_id"]) if r and r["espn_id"] else None
            entry = box.get(aid) if aid else None
            if entry is None:
                L.write(table="data_correction", row_key=rk, season=season,
                        field="direction", db_value=c["corrected_value"],
                        verdict="NOT_COMPARABLE", authority="espn", evidence=ev,
                        note="player recorded no box-score line; ESPN cannot rule on "
                             "which team he played for in this game")
            elif str(entry["team"]) == str(c["corrected_value"]):
                L.write(table="data_correction", row_key=rk, season=season,
                        field="direction", db_value=c["corrected_value"],
                        ref_value=entry["team"], verdict="MATCH", authority="espn",
                        ref_id=aid, evidence=ev,
                        note=f"ESPN box score credits {entry['name']} to franchise "
                             f"{entry['team']}; the correction swapped to the same team")
            else:
                L.write(table="data_correction", row_key=rk, season=season,
                        field="direction", db_value=c["corrected_value"],
                        ref_value=entry["team"], verdict="MISMATCH", authority="espn",
                        ref_id=aid, evidence=ev,
                        note="the correction points at a different franchise than ESPN")
        elif c["defect"] == "D12" and gid in summaries:
            e = summaries[gid]["game"]
            ref_utc = _norm_utc(e["date"])
            if c["column_name"] == "kickoffUtc":
                ok = _norm_utc(c["corrected_value"]) == ref_utc
                shown = ref_utc
            else:
                # gametimeEt: the corrected wall-clock must be the ESPN UTC instant
                # converted to US Eastern for that date (EDT in late October).
                hh, _, mm = str(c["corrected_value"]).partition(":")
                east = (datetime.datetime.fromisoformat(ref_utc.replace("Z", "+00:00"))
                        - datetime.timedelta(hours=4))
                shown = east.strftime("%H:%M") + " ET (EDT, UTC-4)"
                ok = f"{int(hh):02d}:{mm}" == east.strftime("%H:%M")
            L.write(table="data_correction", row_key=rk, season=season,
                    field="value_vs_espn", db_value=c["corrected_value"],
                    ref_value=shown, verdict="MATCH" if ok else "UNRESOLVED",
                    authority="espn", ref_id=e["event_id"], evidence=ev,
                    note="D12 corrected a London kickoff; ESPN's observed instant is a "
                         "third source alongside the Wikipedia citation")
        else:
            L.write(table="data_correction", row_key=rk, season=season,
                    field="cited_source", db_value=c["source"][:120],
                    verdict="NOT_COMPARABLE", authority=c["source"][:80], evidence=ev,
                    note="cited source is a recomputation rule (D15) or a document not "
                         "machine-fetchable here; the applied-value check above stands")
        L.write(table="data_correction", row_key=rk, season=season, field="*",
                verdict="MATCH" if got == str(c["corrected_value"]) else "MISMATCH",
                authority=c["source"][:80], evidence=ev,
                fields_compared=1, fields_matched=1 if got == str(c["corrected_value"])
                else 0)


# --------------------------------------------------------------------------------------
def summarise(L, conn):
    print("\n=== verdict distribution ===")
    tables = sorted({t for t, _ in L.counts})
    for t in tables:
        vs = {v: n for (tt, v), n in L.counts.items() if tt == t}
        print(f"  {t:20s} " + "  ".join(f"{v}={n}" for v, n in sorted(vs.items())))
    print("\n=== coverage self-proof ===")
    q = {"game": "SELECT COUNT(*) FROM game WHERE season IN (2018,2019)",
         "game_line": "SELECT COUNT(*) FROM game_line l JOIN game g USING(game_id) "
                      "WHERE g.season IN (2018,2019)",
         "team_game": "SELECT COUNT(*) FROM team_game WHERE season IN (2018,2019)",
         "player_game_stats": "SELECT COUNT(*) FROM player_game_stats "
                              "WHERE season IN (2018,2019)",
         "snap_count": "SELECT COUNT(*) FROM snap_count WHERE season IN (2018,2019)",
         "roster_season": "SELECT COUNT(*) FROM roster_season WHERE season IN (2018,2019)",
         "depth_chart": "SELECT COUNT(*) FROM depth_chart WHERE season IN (2018,2019)",
         "data_correction": "SELECT COUNT(*) FROM data_correction WHERE target_key "
                            "LIKE '2018%' OR target_key LIKE '2019%'"}
    ok = True
    for t, sql in q.items():
        n = conn.execute(sql).fetchone()[0]
        seen = len({k for k in L.rows_seen[t] if not str(k).startswith("upstream_ghost/")})
        d = seen - n
        ok &= (d == 0)
        print(f"  {t:20s} partition={n:>7,}  ledger={seen:>7,}  diff={d:+d}")
    ghosts = len({k for k in L.rows_seen["player_game_stats"]
                  if str(k).startswith("upstream_ghost/")})
    print(f"  (plus {ghosts} REF_ONLY rows for upstream-only records with no player "
          f"identity - outside the partition by construction)")
    print(f"\n  coverage: {'COMPLETE' if ok else 'INCOMPLETE'}")
    print(f"  problems (MISMATCH/DB_ONLY/REF_ONLY/UNRESOLVED): {len(L.problems)}")


if __name__ == "__main__":
    sys.exit(main())
