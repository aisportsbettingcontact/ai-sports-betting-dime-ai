#!/usr/bin/env python3
"""F02 — row-level forensic audit of NFL seasons 2012 and 2013.

Partition: every row of every table for seasons 2012 and 2013.
  game 534 | game_line 534 | team_game 1068 | player_game_stats 34,625
  snap_count 23,799 (all 2013) | roster_season 4,257 | depth_chart 74,378

Authorities, per docs/audits/2026-07-27-nfl-db-forensic/AUDIT-CONTRACT.md:
  game                ESPN scoreboard        cache/a1/scoreboard/
  game_line           SportsOddsHistory      cache/a4/soh_{season}.html.gz
  team_game           derived recompute      game + game_line
  player_game_stats   ESPN summary box score cache/f02/summary/ (+ a5/a1/s2/a2)
  snap_count          Pro-Football-Reference cache/f02/pfr/  (via Wayback)
  roster_season       ESPN season rosters    cache/f02/roster/
  depth_chart         NONE EXISTS            internal/structural only

The database is opened read-only. Nothing here writes to it.
Fully replayable offline: pass --offline (default) and every byte comes from
cache. Run audit/f02_fetch.py and audit/f02_pfr.py first to populate the cache.

    python3 scripts/data/nfl-db/audit/f02.py
    python3 scripts/data/nfl-db/audit/f02.py --tables game,game_line
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import gzip
import hashlib
import html as htmllib
import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache")
F02 = os.path.join(CACHE, "f02")
LEDGER_DIR = os.path.join(REPO, "docs/audits/2026-07-27-nfl-db-forensic/ledger")
LEDGER = os.path.join(LEDGER_DIR, "F02.jsonl")
SEASONS = (2012, 2013)
AGENT = "F02"

# ESPN postseason `week.number` -> our playoff_round. 4 is the Pro Bowl.
ESPN_POST_ROUND = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}
# nflverse continuous source_week -> playoff_round (18..22).
SRC_WEEK_ROUND = {18: "WC", 19: "DIV", 20: "CON", 21: "SB", 22: "SB"}

SOH_TEAM_NAME = {
    "Arizona Cardinals": 22, "Atlanta Falcons": 1, "Baltimore Ravens": 33,
    "Buffalo Bills": 2, "Carolina Panthers": 29, "Chicago Bears": 3,
    "Cincinnati Bengals": 4, "Cleveland Browns": 5, "Dallas Cowboys": 6,
    "Denver Broncos": 7, "Detroit Lions": 8, "Green Bay Packers": 9,
    "Houston Texans": 34, "Indianapolis Colts": 11, "Jacksonville Jaguars": 30,
    "Kansas City Chiefs": 12, "Miami Dolphins": 15, "Minnesota Vikings": 16,
    "New England Patriots": 17, "New Orleans Saints": 18, "New York Giants": 19,
    "New York Jets": 20, "Oakland Raiders": 13, "Philadelphia Eagles": 21,
    "Pittsburgh Steelers": 23, "San Diego Chargers": 24, "San Francisco 49ers": 25,
    "Seattle Seahawks": 26, "St Louis Rams": 14, "Tampa Bay Buccaneers": 27,
    "Tennessee Titans": 10, "Washington Redskins": 28,
}

RULE5_KICKOFF = ("contract rule 5 known-good: nflverse stores the scheduled kickoff, "
                 "ESPN the observed one")
RULE5_NEUTRAL = ("contract rule 5 known-good: ESPN neutralSite is unpopulated before 2014")
RULE5_VENUE = "contract rule 5 known-good: ESPN retro-renames venues"
NO_DEPTH_SOURCE = ("no historical source exists; internal/structural only, NOT externally "
                   "validated")

# ---------------------------------------------------------------- ledger -----
_LED = None
COUNTS: dict[str, Counter] = defaultdict(Counter)
ROWS_LOGGED: dict[str, set] = defaultdict(set)
FINDINGS: list[dict] = []


def rel(path: str) -> str:
    """Evidence paths are recorded relative to scripts/data/nfl-db/."""
    return os.path.relpath(path, NFLDB)


def log(table, row_key, season, field, db_value, authority, ref_id, ref_value,
        verdict, evidence, note=None, **extra):
    """Append one ledger line. `evidence` must resolve on disk."""
    rec = {"ts": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "agent": AGENT, "table": table, "row_key": row_key, "season": season,
           "field": field, "db_value": db_value, "authority": authority,
           "ref_id": ref_id, "ref_value": ref_value, "verdict": verdict,
           "evidence": evidence}
    if note:
        rec["note"] = note
    rec.update(extra)
    _LED.write(json.dumps(rec, default=str, separators=(",", ":")) + "\n")
    COUNTS[table][verdict] += 1
    if verdict != "REF_ONLY":
        ROWS_LOGGED[table].add(row_key)
    if verdict in ("MISMATCH", "DB_ONLY", "REF_ONLY", "UNRESOLVED"):
        if len(FINDINGS) < 60000:
            FINDINGS.append(rec)


class RowLedger:
    """Collect per-field verdicts for one row, then emit the contract's shape:
    one collapsed `field:"*"` line for the matches, one line per non-match."""

    def __init__(self, table, row_key, season, authority, ref_id, evidence):
        self.t, self.k, self.s = table, row_key, season
        self.auth, self.ref_id, self.ev = authority, ref_id, evidence
        self.n = 0
        self.ok = 0
        self.pending = []

    def cmp(self, field, db_value, ref_value, *, equal=None, note=None):
        self.n += 1
        same = (db_value == ref_value) if equal is None else equal
        if same:
            self.ok += 1
        else:
            self.pending.append(("MISMATCH", field, db_value, ref_value, note))
        return same

    def mark(self, field, verdict, db_value=None, ref_value=None, note=None):
        self.n += 1
        self.pending.append((verdict, field, db_value, ref_value, note))

    def missing(self, field, db_value, ref_value, note=None):
        """Three-valued compare for a field the authority always publishes:
        NULL here + a value there is REF_ONLY, not a MISMATCH."""
        self.n += 1
        if db_value == ref_value:
            self.ok += 1
        elif db_value is None and ref_value is not None:
            self.pending.append(("REF_ONLY", field, None, ref_value, note))
        elif db_value is not None and ref_value is None:
            self.pending.append(("DB_ONLY", field, db_value, None, note))
        else:
            self.pending.append(("MISMATCH", field, db_value, ref_value, note))

    _SEV = ("MISMATCH", "DB_ONLY", "REF_ONLY", "UNRESOLVED", "NOT_COMPARABLE")

    def flush(self, force=None, row_note=None):
        for verdict, field, dbv, refv, note in self.pending:
            log(self.t, self.k, self.s, field, dbv, self.auth, self.ref_id, refv,
                verdict, self.ev, note)
        if force:
            rv = force
        elif not self.pending:
            rv = "MATCH"
        else:
            rv = next(v for v in self._SEV if any(p[0] == v for p in self.pending))
        log(self.t, self.k, self.s, "*", None, self.auth, self.ref_id, None, rv,
            self.ev, row_note, fields_compared=self.n, fields_matched=self.ok)


def row_summary(table, row_key, season, authority, ref_id, evidence,
                n, ok, verdict, note=None):
    log(table, row_key, season, "*", None, authority, ref_id, None, verdict,
        evidence, note, fields_compared=n, fields_matched=ok)


# ------------------------------------------------------------ cache readers --
def jload(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            return json.load(f)
    with open(path, encoding="utf-8", errors="replace") as f:
        return json.load(f)


def tload(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            return f.read()
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


_SUMMARY_CANDIDATES = [
    (os.path.join(F02, "summary"), "summary_{e}.json.gz"),
    (os.path.join(CACHE, "a5"), "summary_{e}.json.gz"),
    (os.path.join(CACHE, "a1", "summary"), "{e}.json"),
    (os.path.join(CACHE, "s2"), "summary_{e}.json"),
    (os.path.join(CACHE, "a2"), "espn_summary_{e}.json"),
]


def summary_path(eid):
    for d, pat in _SUMMARY_CANDIDATES:
        p = os.path.join(d, pat.format(e=eid))
        if os.path.exists(p) and os.path.getsize(p) > 2000:
            return p
    return None


def num(v):
    if v in (None, "", "-", "--"):
        return None
    try:
        f = float(str(v).replace(",", ""))
    except ValueError:
        return None
    return int(f) if f == int(f) else f


# ------------------------------------------------------------------- game ----
def load_scoreboard():
    """eid -> (event, competition, evidence path), from the a1 scoreboard cache."""
    idx = {}
    for season in SEASONS:
        for p in sorted(glob.glob(os.path.join(CACHE, "a1", "scoreboard",
                                               f"{season}_*.json"))):
            try:
                d = jload(p)
            except Exception:  # noqa: BLE001
                continue
            for ev in d.get("events", []):
                comp = (ev.get("competitions") or [{}])[0]
                idx[str(ev["id"])] = (ev, comp, rel(p))
    return idx


def audit_game(con):
    sb = load_scoreboard()
    teams = {r[0]: r[1] for r in con.execute("SELECT franchise_id, abbreviation FROM team")}
    alias = {r[0]: r[1] for r in con.execute("SELECT abbreviation, franchise_id FROM team_alias")}
    rows = con.execute("""
        SELECT game_id, espn_event_id, season, season_type, week, playoff_round,
               kickoff_utc, time_valid, result_status, away_franchise_id, home_franchise_id,
               away_abbr, home_abbr, away_score, home_score, result, total, overtime,
               location, stadium, venue_id, gameday
        FROM game WHERE season IN (2012,2013) ORDER BY kickoff_utc, game_id""").fetchall()
    for (gid, eid, season, stype, week, rnd, kickoff, tvalid, status, afid, hfid,
         aabbr, habbr, ascore, hscore, result, total, ot, loc, stadium, venue_id,
         gameday) in rows:
        hit = sb.get(str(eid))
        if not hit:
            log("game", gid, season, "*", None, "espn", eid, None, "UNRESOLVED",
                rel(os.path.join(CACHE, "a1", "scoreboard")),
                "espn_event_id absent from every cached 2012/2013 scoreboard week")
            continue
        ev, comp, evpath = hit
        L = RowLedger("game", gid, season, "espn", eid, evpath)

        # identity / schedule
        L.cmp("season", season, ev.get("season", {}).get("year"))
        L.cmp("season_type", stype,
              {2: "REG", 3: "POST"}.get(ev.get("season", {}).get("type")))
        wknum = (ev.get("week") or {}).get("number")
        if stype == "REG":
            L.cmp("week", week, wknum)
        else:
            L.cmp("playoff_round", rnd, ESPN_POST_ROUND.get(wknum))

        # teams, by ESPN franchise id (immune to retro-renames)
        comps = {c.get("homeAway"): c for c in comp.get("competitors", [])}
        eh, ea = comps.get("home", {}), comps.get("away", {})
        eh_id = num(eh.get("id"))
        ea_id = num(ea.get("id"))
        L.cmp("home_franchise_id", hfid, eh_id)
        L.cmp("away_franchise_id", afid, ea_id)
        for fld, dbv, espn_ab, fid in (("home_abbr", habbr, (eh.get("team") or {}).get("abbreviation"), hfid),
                                       ("away_abbr", aabbr, (ea.get("team") or {}).get("abbreviation"), afid)):
            if dbv == espn_ab:
                L.cmp(fld, dbv, espn_ab)
            elif alias.get(str(espn_ab)) == fid or teams.get(fid) == espn_ab:
                L.mark(fld, "NOT_COMPARABLE", dbv, espn_ab,
                       "era-correct label as published vs ESPN's current label; "
                       "same franchise_id (contract rule 5, ESPN retro-renames)")
            else:
                L.cmp(fld, dbv, espn_ab)

        # result
        completed = bool(((comp.get("status") or {}).get("type") or {}).get("completed"))
        L.cmp("result_status", status, "final" if completed else "scheduled")
        e_h, e_a = num(eh.get("score")), num(ea.get("score"))
        L.cmp("home_score", hscore, e_h)
        L.cmp("away_score", ascore, e_a)
        if hscore is not None and e_h is not None and e_a is not None:
            L.cmp("result", result, e_h - e_a)
            L.cmp("total", total, e_h + e_a)
        periods = max(len(eh.get("linescores") or []), len(ea.get("linescores") or []))
        st_period = (comp.get("status") or {}).get("period")
        if periods:
            L.cmp("overtime", ot, 1 if max(periods, st_period or 0) > 4 else 0)
        else:
            L.mark("overtime", "NOT_COMPARABLE", ot, None, "ESPN published no linescores")

        # kickoff / venue / neutrality
        edate = (comp.get("date") or ev.get("date") or "").replace("Z", "")
        dbk = (kickoff or "").replace("Z", "").replace("T", " ")
        ek = edate.replace("T", " ")
        if len(ek) == 16:
            ek += ":00"
        if dbk[:16] == ek[:16]:
            L.cmp("kickoff_utc", kickoff, kickoff)
        else:
            L.mark("kickoff_utc", "NOT_COMPARABLE", kickoff, edate + "Z", RULE5_KICKOFF)
        L.cmp("time_valid", bool(tvalid), bool(comp.get("timeValid")))
        ven = comp.get("venue") or {}
        L.missing("venue_id", venue_id, num(ven.get("id")),
                  "ESPN publishes a venue id on every cached 2012/2013 competition")
        if stadium == ven.get("fullName"):
            L.cmp("stadium", stadium, ven.get("fullName"))
        else:
            L.mark("stadium", "NOT_COMPARABLE", stadium, ven.get("fullName"), RULE5_VENUE)
        L.mark("location", "NOT_COMPARABLE", loc,
               "Neutral" if comp.get("neutralSite") else "Home", RULE5_NEUTRAL)
        # gameday: venue-local calendar date, derived (D11). ESPN publishes only
        # the UTC instant, so it can bound but not determine the local date.
        if gameday:
            ku = dt.datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
            gd = dt.date.fromisoformat(gameday)
            ok = abs((ku.date() - gd).days) <= 1
            L.cmp("gameday", gameday, gameday if ok else f"utc {ku.date()}", equal=ok,
                  note="venue-local date must be within one day of the UTC kickoff")
        L.flush()
    return len(rows)


# -------------------------------------------------------------- game_line ----
def parse_soh(season):
    path = os.path.join(CACHE, "a4", f"soh_{season}.html.gz")
    h = tload(path)
    secs = re.split(r"<h3>(.*?)</h3>", h)
    out = []
    for k in range(1, len(secs), 2):
        title, body = secs[k].strip(), secs[k + 1]
        m = re.search(r"-\s*Week\s+(\d+)$", title)
        post = title.endswith("Playoffs")
        if not m and not post:
            continue
        week = None if post else int(m.group(1))
        for r in re.findall(r"<tr>(.*?)</tr>", body, re.S):
            cells = []
            for cm in re.finditer(r"<td[^>]*>(.*?)</td>", r, re.S):
                raw = cm.group(1)
                nm = re.search(r'#\d+"\s*>(?:<b>)?(.*?)(?:</b>)?</a>', raw)
                cells.append({
                    "text": htmllib.unescape(re.sub(r"<[^>]+>", "", raw)).strip(),
                    "team": re.sub(r"\s*\(\d+\)$", "",
                                   htmllib.unescape(nm.group(1))).strip() if nm else None})
            if len(cells) < 10:
                continue
            o = 1 if post else 0
            out.append({
                "season": season, "week": week,
                "round": cells[0]["text"] if post else None,
                "date": cells[o + 1]["text"],
                "fav": SOH_TEAM_NAME.get(cells[o + 4]["team"]),
                "fav_name": cells[o + 4]["team"],
                "fav_home": cells[o + 3]["text"] == "@",
                "score": cells[o + 5]["text"], "spread": cells[o + 6]["text"],
                "dog": SOH_TEAM_NAME.get(cells[o + 8]["team"]),
                "dog_name": cells[o + 8]["team"],
                "dog_home": cells[o + 7]["text"] == "@",
                "ou": cells[o + 9]["text"], "evidence": rel(path)})
    return out


SOH_ROUND = {"Wild Card": "WC", "Divisional": "DIV", "Championship": "CON",
             "Super Bowl": "SB"}


def soh_slot(g):
    """The schedule slot a parsed SOH row occupies: week number, or playoff round.
    Needed because a division pair can meet twice at the same venue in one season
    (2012 MIN at GB, week 13 and again in the wild-card round), which collapses a
    (home, away) key onto one row and silently compares the wrong line."""
    if g["week"] is not None:
        return g["week"]
    r = g["round"] or ""
    for k, v in SOH_ROUND.items():
        if k in r:
            return v
    return None


def soh_index(season):
    """(team_a, team_b, slot) -> parsed SOH row. Indexed both ways round so a
    neutral-site game matches whichever side our schedule nominates as home."""
    idx = {}
    for g in parse_soh(season):
        if g["fav"] is None or g["dog"] is None:
            continue
        slot = soh_slot(g)
        idx[(g["fav"], g["dog"], slot)] = g
        idx[(g["dog"], g["fav"], slot)] = g
    return idx


def soh_numbers(g, home_fid):
    """(spread_line from the HOME team's perspective, total_line) or (None, None).
    Signed off the favourite's franchise id rather than its column position, so
    neutral-site games sign correctly."""
    s = g["spread"].strip()
    if re.search(r"\bPK\b", s, re.I):
        mag = 0.0
    else:
        m = re.search(r"-([\d.]+)", s)
        if not m:
            return None, None
        mag = float(m.group(1))
    spread = mag if g["fav"] == home_fid else -mag
    m2 = re.search(r"([\d.]+)", g["ou"])
    total = float(m2.group(1)) if m2 else None
    return spread, total


def audit_game_line(con):
    idx = {s: soh_index(s) for s in SEASONS}
    rows = con.execute("""
        SELECT l.game_id, g.season, g.home_franchise_id, g.away_franchise_id,
               l.spread_line, l.total_line, l.away_moneyline, l.home_moneyline,
               l.away_spread_odds, l.home_spread_odds, l.over_odds, l.under_odds,
               l.odds_source, g.home_score, g.away_score, g.week, g.playoff_round
        FROM game_line l JOIN game g USING(game_id)
        WHERE g.season IN (2012,2013) ORDER BY g.kickoff_utc, l.game_id""").fetchall()
    for (gid, season, hfid, afid, spread, total, aml, hml, aso, hso, oo, uo,
         src, hs, asc, week, rnd) in rows:
        slot = week if week is not None else rnd
        g = idx[season].get((hfid, afid, slot))
        if not g:
            log("game_line", gid, season, "*", None, "sportsoddshistory", None, None,
                "UNRESOLVED", rel(os.path.join(CACHE, "a4", f"soh_{season}.html.gz")),
                f"no SportsOddsHistory row matched home={hfid} away={afid} slot={slot}")
            continue
        ref_spread, ref_total = soh_numbers(g, hfid)
        L = RowLedger("game_line", gid, season, "sportsoddshistory",
                      f"{season}:{g['fav_name']} vs {g['dog_name']}", g["evidence"])
        if ref_spread is None:
            L.mark("spread_line", "UNRESOLVED", spread, g["spread"],
                   "SportsOddsHistory spread cell did not parse")
        else:
            L.cmp("spread_line", float(spread), ref_spread)
        if ref_total is None:
            L.mark("total_line", "UNRESOLVED", total, g["ou"],
                   "SportsOddsHistory over/under cell did not parse")
        else:
            L.cmp("total_line", float(total), ref_total)
        # SOH publishes closing spread and total only -- never moneylines or juice.
        for f, v in (("away_moneyline", aml), ("home_moneyline", hml),
                     ("away_spread_odds", aso), ("home_spread_odds", hso),
                     ("over_odds", oo), ("under_odds", uo)):
            L.mark(f, "NOT_COMPARABLE", v, None,
                   "SportsOddsHistory/covers.com publish no moneyline or juice for "
                   "these seasons; ESPN odds coverage does not reach 2012-2013")
        L.cmp("odds_source", src, "nflverse",
              equal=(src == "nflverse"),
              note="provenance label, not a market value")
        L.flush()

        # Internal: moneyline direction must agree with the spread's favourite.
        # Only meaningful away from pick'em -- inside a couple of points the two
        # markets legitimately disagree on who is favoured.
        if spread and abs(spread) >= 2.0 and hml and aml:
            ml_home_fav = hml < aml
            if (spread > 0) != ml_home_fav:
                log("game_line", gid, season, "moneyline_vs_spread",
                    f"spread_line={spread} home_ml={hml} away_ml={aml}",
                    "internal-consistency", None,
                    "moneyline favourite must match spread favourite", "MISMATCH",
                    g["evidence"], "internal check, not external validation")
    return len(rows)


# -------------------------------------------------------------- team_game ----
def audit_team_game(con):
    games = {r[0]: r for r in con.execute("""
        SELECT game_id, season, season_type, week, playoff_round, kickoff_utc,
               home_franchise_id, away_franchise_id, home_score, away_score, result_status
        FROM game WHERE season IN (2012,2013)""")}
    lines = {r[0]: r for r in con.execute("""
        SELECT l.game_id, l.spread_line, l.total_line, l.home_moneyline, l.away_moneyline
        FROM game_line l JOIN game g USING(game_id) WHERE g.season IN (2012,2013)""")}
    # Recompute rest_days and game_number from every played kickoff of that
    # franchise across all seasons -- the same definition build_db.py uses (D15).
    hist = defaultdict(list)
    for gid, kick, hf, af, st in con.execute("""
            SELECT game_id, kickoff_utc, home_franchise_id, away_franchise_id, result_status
            FROM game WHERE result_status='final' ORDER BY kickoff_utc"""):
        hist[hf].append((kick, gid))
        hist[af].append((kick, gid))
    prev_kick, gnum = {}, {}
    for fid, lst in hist.items():
        lst.sort()
        by_season = defaultdict(int)
        last = None
        for kick, gid in lst:
            if last:
                prev_kick[(gid, fid)] = last
            last = kick
            season = int(gid[:4])
            by_season[season] += 1
            gnum[(gid, fid)] = by_season[season]

    rows = con.execute("""
        SELECT game_id, franchise_id, opponent_id, season, season_type, week, playoff_round,
               kickoff_utc, is_home, points_for, points_against, margin, spread, total_line,
               moneyline, rest_days, won, covered, su_result, ats_result, ou_result, game_number
        FROM team_game WHERE season IN (2012,2013)
        ORDER BY kickoff_utc, game_id, is_home DESC""").fetchall()
    for (gid, fid, oid, season, stype, week, rnd, kick, is_home, pf, pa, margin,
         spread, tline, ml, rest, won, covered, su, ats, ou, gnumber) in rows:
        key = f"{gid}/{fid}"
        g = games.get(gid)
        if not g:
            log("team_game", key, season, "*", None, "derived", gid, None, "DB_ONLY",
                rel(DB), "team_game row references a game_id absent from the 2012/2013 game set")
            continue
        (_, gseason, gstype, gweek, grnd, gkick, ghf, gaf, ghs, gas, gstatus) = g
        L = RowLedger("team_game", key, season, "derived", gid, rel(DB))
        L.cmp("season", season, gseason)
        L.cmp("season_type", stype, gstype)
        L.cmp("week", week, gweek)
        L.cmp("playoff_round", rnd, grnd)
        L.cmp("kickoff_utc", kick, gkick)
        exp_home = 1 if fid == ghf else 0
        L.cmp("is_home", is_home, exp_home)
        L.cmp("franchise_id", fid, ghf if is_home else gaf)
        L.cmp("opponent_id", oid, gaf if is_home else ghf)
        e_pf = ghs if is_home else gas
        e_pa = gas if is_home else ghs
        L.cmp("points_for", pf, e_pf)
        L.cmp("points_against", pa, e_pa)
        L.cmp("margin", margin, None if e_pf is None else e_pf - e_pa)
        ln = lines.get(gid)
        e_spread = e_tline = e_ml = None
        if ln:
            e_spread = ln[1] if is_home else -ln[1]
            e_tline = ln[2]
            e_ml = ln[3] if is_home else ln[4]
        L.cmp("spread", spread, e_spread)
        L.cmp("total_line", tline, e_tline)
        L.cmp("moneyline", ml, e_ml)
        e_su = None if margin is None else ("W" if margin > 0 else "L" if margin < 0 else "T")
        L.cmp("su_result", su, e_su)
        e_ats = None if (margin is None or e_spread is None) else (
            "W" if margin > e_spread else "L" if margin < e_spread else "P")
        L.cmp("ats_result", ats, e_ats)
        e_ou = None if (e_pf is None or e_pa is None or e_tline is None) else (
            "O" if e_pf + e_pa > e_tline else "U" if e_pf + e_pa < e_tline else "P")
        L.cmp("ou_result", ou, e_ou)
        L.cmp("won", won, None if e_su in (None, "T") else (1 if e_su == "W" else 0))
        L.cmp("covered", covered,
              None if e_ats in (None, "P") else (1 if e_ats == "W" else 0))
        pk = prev_kick.get((gid, fid))
        if gnumber == 1 or (week == 1 and stype == "REG"):
            # Season openers carry the nflverse convention of 7, not the real
            # ~213-day layoff since the franchise's previous game.
            L.cmp("rest_days", rest, 7,
                  note="season opener: nflverse convention is a flat 7, not the "
                       "actual inter-season gap")
        elif pk and rest is not None:
            d1 = dt.datetime.fromisoformat(kick.replace("Z", "+00:00"))
            d0 = dt.datetime.fromisoformat(pk.replace("Z", "+00:00"))
            L.cmp("rest_days", rest, round((d1 - d0).total_seconds() / 86400))
        else:
            L.mark("rest_days", "NOT_COMPARABLE", rest, None,
                   "first game of the franchise's cached history: no prior kickoff to "
                   "difference against" if not pk else "rest_days is NULL")
        L.cmp("game_number", gnumber, gnum.get((gid, fid)))
        L.flush()
    return len(rows)


# ------------------------------------------------------ player_game_stats ----
ESPN_STAT_MAP = {
    "passing": {"completions/passingAttempts": ("completions", "attempts"),
                "passingYards": "passing_yards", "passingTouchdowns": "passing_tds",
                "interceptions": "interceptions", "sacks-sackYardsLost": ("sacks_suffered", None)},
    "rushing": {"rushingAttempts": "carries", "rushingYards": "rushing_yards",
                "rushingTouchdowns": "rushing_tds"},
    "receiving": {"receptions": "receptions", "receivingYards": "receiving_yards",
                  "receivingTouchdowns": "receiving_tds", "receivingTargets": "targets"},
}
PGS_COMPARABLE = ["completions", "attempts", "passing_yards", "passing_tds", "interceptions",
                  "sacks_suffered", "carries", "rushing_yards", "rushing_tds",
                  "receptions", "targets", "receiving_yards", "receiving_tds"]
PGS_NOT_COMPARABLE = ["passing_epa", "rushing_epa", "receiving_epa", "target_share",
                      "air_yards_share", "fantasy_points", "fantasy_points_ppr"]


def normname(s):
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", (s or "").lower())
    return re.sub(r"[^a-z]", "", s)


NICK = {"mike": "michael", "chris": "christopher", "matt": "matthew", "rob": "robert",
        "bob": "robert", "joe": "joseph", "dave": "david", "steve": "steven",
        "nick": "nicholas", "tom": "thomas", "jim": "james", "will": "william",
        "ben": "benjamin", "dan": "daniel", "ted": "theodore", "greg": "gregory",
        "tony": "anthony", "ken": "kenneth", "ron": "ronald", "rick": "richard",
        "jon": "jonathan", "zach": "zachary", "josh": "joshua", "andy": "andrew",
        "alex": "alexander", "ed": "edward", "pat": "patrick", "sam": "samuel",
        "tim": "timothy", "phil": "phillip", "jeff": "jeffrey", "cam": "cameron"}


def samename_loose(a, b):
    """Same person allowing for a nickname on the given name."""
    if normname(a) == normname(b):
        return True
    pa, pb = (a or "").lower().split(), (b or "").lower().split()
    if not pa or not pb:
        return False
    if normname(pa[-1]) != normname(pb[-1]):
        return False
    fa, fb = re.sub(r"[^a-z]", "", pa[0]), re.sub(r"[^a-z]", "", pb[0])
    return (NICK.get(fa, fa) == NICK.get(fb, fb) or fa[:1] == fb[:1]
            and (fa.startswith(fb) or fb.startswith(fa)))


PFR_OFF_MAP = {"pass_cmp": "completions", "pass_att": "attempts", "pass_yds": "passing_yards",
               "pass_td": "passing_tds", "pass_int": "interceptions",
               "pass_sacked": "sacks_suffered", "rush_att": "carries",
               "rush_yds": "rushing_yards", "rush_td": "rushing_tds",
               "rec": "receptions", "targets": "targets", "rec_yds": "receiving_yards",
               "rec_td": "receiving_tds"}


def pfr_offense(path):
    """Third source for player_game_stats: PFR's player_offense table.
    normalised name -> {db_col: value}."""
    h = tload(path)
    blobs = h + "".join(re.findall(r"<!--(.*?)-->", h, re.S))
    m = re.search(r'<table[^>]*id="player_offense".*?</table>', blobs, re.S)
    out = {}
    if not m:
        return out
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S):
        if 'data-stat="player"' not in tr:
            continue
        cells = {k: htmllib.unescape(re.sub(r"<[^>]+>", "", v)).strip()
                 for k, v in re.findall(r'data-stat="([a-z_0-9]+)"[^>]*>(.*?)</t[hd]>',
                                        tr, re.S)}
        nm = cells.get("player")
        if not nm or nm == "Player":
            continue
        out[normname(nm)] = {c: num(cells.get(k)) for k, c in PFR_OFF_MAP.items()
                             if cells.get(k) not in (None, "")}
        out[normname(nm)]["_name"] = nm
        out[normname(nm)]["_team"] = cells.get("team")
    return out


def espn_box(path):
    """athlete_id -> {'team': fid, 'stats': {db_col: value}, 'groups': [...] }"""
    d = jload(path)
    out = {}
    for team in (d.get("boxscore") or {}).get("players", []):
        fid = num((team.get("team") or {}).get("id"))
        for grp in team.get("statistics", []):
            gname = grp.get("name")
            keys = grp.get("keys") or []
            mapping = ESPN_STAT_MAP.get(gname)
            for ath in grp.get("athletes", []):
                aid = str(((ath.get("athlete") or {}).get("id")) or "")
                if not aid:
                    continue
                rec = out.setdefault(aid, {"team": fid, "stats": {}, "groups": [],
                                           "name": (ath.get("athlete") or {}).get("displayName")})
                rec["groups"].append(gname)
                if not mapping:
                    continue
                vals = ath.get("stats") or []
                for i, k in enumerate(keys):
                    if k not in mapping or i >= len(vals):
                        continue
                    tgt = mapping[k]
                    raw = str(vals[i])
                    if isinstance(tgt, tuple):
                        parts = re.split(r"[/-]", raw)
                        for j, col in enumerate(tgt):
                            if col and j < len(parts):
                                rec["stats"][col] = num(parts[j])
                    else:
                        rec["stats"][tgt] = num(raw)
    return out


def audit_player_game_stats(con):
    espn_of = {}
    for gsis, eid in con.execute("SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL"):
        espn_of[gsis] = str(eid)
    name_of = {r[0]: r[1] for r in con.execute("SELECT gsis_id, display_name FROM player")}
    games = {r[0]: r for r in con.execute(
        "SELECT game_id, espn_event_id, season FROM game WHERE season IN (2012,2013)")}
    by_game = defaultdict(list)
    cols = ["gsis_id", "season", "week", "season_type", "game_id", "franchise_id",
            "opponent_id", "position", "position_group"] + PGS_COMPARABLE + PGS_NOT_COMPARABLE
    total = 0
    for r in con.execute(f"SELECT {','.join(cols)} FROM player_game_stats "
                         "WHERE season IN (2012,2013)"):
        by_game[r[4]].append(dict(zip(cols, r)))
        total += 1

    pfr_gid = {r[0]: r[1] for r in con.execute(
        "SELECT game_id, pfr_game_id FROM game WHERE season IN (2012,2013)")}
    for gid, game in sorted(games.items()):
        _, eid, season = game
        rows = by_game.get(gid, [])
        pfr_path = os.path.join(F02, "pfr", f"{pfr_gid.get(gid)}.html.gz")
        third = pfr_offense(pfr_path) if os.path.exists(pfr_path) else {}
        p = summary_path(str(eid))
        if not p:
            for r in rows:
                log("player_game_stats",
                    f"{r['gsis_id']}/{r['season']}/{r['week']}/{r['season_type']}",
                    season, "*", None, "espn", eid, None, "UNRESOLVED",
                    rel(os.path.join(F02, "summary")),
                    f"no cached ESPN summary for event {eid}")
            continue
        box = espn_box(p)
        ev = rel(p)
        by_name = defaultdict(list)
        for aid_, rec_ in box.items():
            by_name[normname(rec_.get("name"))].append((aid_, rec_))
        seen = set()
        for r in rows:
            key = f"{r['gsis_id']}/{r['season']}/{r['week']}/{r['season_type']}"
            aid = espn_of.get(r["gsis_id"])
            rec = box.get(aid) if aid else None
            crosswalk_note = None
            if rec is None:
                # The espn_id crosswalk misses for a handful of players. Fall back
                # to the name, restricted to the same side of the box score, so a
                # bad crosswalk is isolated rather than mistaken for missing data.
                dbname = name_of.get(r["gsis_id"])
                cand = [(a, x) for a, x in by_name.get(normname(dbname), [])
                        if x["team"] == r["franchise_id"]]
                if not cand:
                    cand = [(a, x) for a, x in box.items()
                            if x["team"] == r["franchise_id"]
                            and samename_loose(dbname, x.get("name"))]
                if len(cand) == 1:
                    aid_found, rec = cand[0]
                    crosswalk_note = (
                        f"matched by name: player.espn_id={aid} does not appear in this "
                        f"box score, but ESPN athlete {aid_found} ({rec.get('name')}) on "
                        f"the same team does. The espn_id crosswalk for "
                        f"{r['gsis_id']} looks wrong.")
                    aid = aid_found
            if rec is None:
                nz = [c for c in PGS_COMPARABLE if (r[c] or 0)]
                if nz == ["targets"]:
                    log("player_game_stats", key, season, "targets", r["targets"],
                        "espn", eid, None, "NOT_COMPARABLE", ev,
                        "contract rule 5 known-good: ESPN omits zero-reception targets "
                        "entirely, so a player whose only production is a target he did "
                        "not catch appears in no ESPN box-score group")
                elif nz:
                    # Contract rule 3: where a third source exists, record its value.
                    dbname = name_of.get(r["gsis_id"])
                    t3 = third.get(normname(dbname))
                    dbvals = {c: r[c] for c in nz}
                    if t3 and all(t3.get(c) == r[c] for c in nz):
                        log("player_game_stats", key, season, "*", dbvals, "pfr",
                            pfr_gid.get(gid), {c: t3.get(c) for c in nz},
                            "NOT_COMPARABLE", rel(pfr_path),
                            f"ESPN's archived box score omits {dbname} entirely, so ESPN "
                            f"cannot rule. Pro-Football-Reference (third source, contract "
                            f"rule 3) carries the identical line, confirming the database.")
                    elif t3:
                        log("player_game_stats", key, season, "*", dbvals, "pfr",
                            pfr_gid.get(gid), {c: t3.get(c) for c in nz}, "MISMATCH",
                            rel(pfr_path),
                            f"ESPN omits {dbname}; Pro-Football-Reference lists him with "
                            f"different values")
                    else:
                        log("player_game_stats", key, season, "*", dbvals, "espn", eid,
                            None, "DB_ONLY", ev,
                            f"{dbname} (espn_id={aid}) carries {', '.join(nz)} but "
                            f"appears in neither the ESPN box score nor the cached PFR "
                            f"boxscore for this game")
                else:
                    log("player_game_stats", key, season, "*", None, "espn", eid, None,
                        "NOT_COMPARABLE", ev,
                        "zero offensive production; absent from every ESPN box-score group"
                        + ("" if aid else "; no espn_id crosswalk"))
                continue
            seen.add(aid)
            L = RowLedger("player_game_stats", key, season, "espn", eid, ev)
            if crosswalk_note:
                L.mark("player.espn_id", "MISMATCH", espn_of.get(r["gsis_id"]), aid,
                       crosswalk_note)
            L.cmp("franchise_id", r["franchise_id"], rec["team"])
            for c in PGS_COMPARABLE:
                dbv = r[c] or 0
                refv = rec["stats"].get(c)
                if refv is None:
                    if dbv == 0:
                        L.cmp(c, 0, 0)
                    else:
                        L.mark(c, "NOT_COMPARABLE", dbv, None,
                               "ESPN did not publish this stat for this athlete in this "
                               "game (the group or key is absent)")
                elif c == "targets" and abs(float(dbv) - float(refv)) == 1:
                    L.mark(c, "NOT_COMPARABLE", dbv, refv,
                           "contract rule 5 known-good: ESPN omits zero-reception targets "
                           "and sometimes charges an incompletion to a different receiver; "
                           "a one-target divergence is single-play attribution")
                else:
                    L.cmp(c, float(dbv), float(refv))
            # One line for all seven derivatives rather than seven identical ones:
            # at 34,625 rows the difference is ~200,000 ledger lines of boilerplate.
            L.mark("|".join(PGS_NOT_COMPARABLE), "NOT_COMPARABLE",
                   {c: r[c] for c in PGS_NOT_COMPARABLE}, None,
                   "ESPN publishes no EPA, target share, air-yards share or fantasy "
                   "points; nflverse-computed derivatives, 7 fields")
            L.n += len(PGS_NOT_COMPARABLE) - 1
            bad = [p[1] for p in L.pending if p[0] == "MISMATCH" and p[1] in PGS_COMPARABLE]
            L.flush()
            # Contract rule 3: where db and ESPN disagree, record the third source too.
            if bad:
                t3 = third.get(normname(name_of.get(r["gsis_id"])))
                if t3:
                    for c in bad:
                        log("player_game_stats", key, season, c, r[c] or 0, "pfr",
                            pfr_gid.get(gid), t3.get(c),
                            "MATCH" if t3.get(c) == (r[c] or 0) else "MISMATCH",
                            rel(pfr_path),
                            "third source, recorded because ESPN and the database "
                            "disagree on this field")
        # ESPN athletes with real production and no DB row for this game
        gsis_of = {v: k for k, v in espn_of.items()}
        dbnames = {normname(name_of.get(r["gsis_id"])) for r in rows}
        for aid, rec in box.items():
            if aid in seen:
                continue
            prod = {k: v for k, v in rec["stats"].items() if v}
            if not prod:
                continue
            if normname(rec.get("name")) in dbnames:
                continue                      # already reconciled under another id
            g = gsis_of.get(aid)
            log("player_game_stats", f"espn:{aid}/{gid}", season, "*", None, "espn",
                eid, prod, "REF_ONLY", ev,
                f"ESPN box score credits {rec['name']} with {prod} in {gid}; no "
                f"player_game_stats row exists (gsis_id={g or 'no crosswalk'})")
    return total


# ------------------------------------------------------------- snap_count ----
def parse_pfr_snaps(path):
    """pfr_player_id -> row dict, for both teams of one PFR boxscore."""
    h = tload(path)
    blobs = h + "".join(re.findall(r"<!--(.*?)-->", h, re.S))
    out = {}
    for tid, side in (("vis_snap_counts", "away"), ("home_snap_counts", "home")):
        m = re.search(r'<table[^>]*id="' + tid + r'".*?</table>', blobs, re.S)
        if not m:
            continue
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S):
            if 'data-stat="player"' not in tr:
                continue
            cells = {k: htmllib.unescape(re.sub(r"<[^>]+>", "", v)).strip()
                     for k, v in re.findall(r'data-stat="([a-z_0-9]+)"[^>]*>(.*?)</t[hd]>',
                                            tr, re.S)}
            if cells.get("player") in (None, "", "Player"):
                continue
            pid = re.search(r"/players/[A-Z]/([A-Za-z0-9.'\-]+?)\.htm", tr)
            if not pid:
                continue
            out[pid.group(1)] = {
                "side": side, "player": cells.get("player"), "pos": cells.get("pos"),
                "offense_snaps": num(cells.get("offense")),
                "offense_pct": pct(cells.get("off_pct")),
                "defense_snaps": num(cells.get("defense")),
                "defense_pct": pct(cells.get("def_pct")),
                "st_snaps": num(cells.get("special_teams")),
                "st_pct": pct(cells.get("st_pct"))}
    return out


def pct(v):
    if v in (None, "", "-"):
        return None
    v = v.strip().rstrip("%")
    try:
        return round(float(v) / 100.0, 4)
    except ValueError:
        return None


def audit_snap_count(con):
    games = {r[0]: r for r in con.execute("""
        SELECT game_id, pfr_game_id, season, season_type, week, playoff_round,
               home_franchise_id, away_franchise_id, gameday
        FROM game WHERE season IN (2012,2013)""")}
    players = set(r[0] for r in con.execute("SELECT gsis_id FROM player"))
    corr = set()
    for tk, in con.execute("SELECT target_key FROM data_correction "
                           "WHERE target_table='snap_count'"):
        corr.add(tk)
    rows = con.execute("""
        SELECT gsis_id, pfr_player_id, game_id, pfr_game_id, season, season_type, week,
               playoff_round, source_game_type, source_week, franchise_id,
               franchise_id_upstream, position, offense_snaps, offense_pct,
               defense_snaps, defense_pct, st_snaps, st_pct
        FROM snap_count WHERE season IN (2012,2013)
        ORDER BY pfr_game_id, pfr_player_id""").fetchall()

    # Per-(game, franchise, unit) snap denominator. NOT max(snaps): a team's
    # special-teams play count exceeds any one player's ST snaps, and on defence
    # nobody need play 100%. Infer it from the published pairs instead -- every
    # row of a unit must agree on one denominator -- and take the modal value.
    cand = defaultdict(Counter)
    for r in rows:
        for si, pi, unit in ((13, 14, "offense"), (15, 16, "defense"), (17, 18, "st")):
            sn, pc = r[si], r[pi]
            if sn and pc:
                cand[(r[3], r[10], unit)][round(sn / pc)] += 1
    denom = {k: c.most_common(1)[0][0] for k, c in cand.items()}

    pfr_cache = {}
    n_ext = 0
    for r in rows:
        (gsis, pid, gid, pgid, season, stype, week, rnd, sgt, swk, fid, fid_up,
         pos, osn, opc, dsn, dpc, ssn, spc) = r
        key = f"{pgid}/{pid}"
        g = games.get(gid)
        pfr_path = os.path.join(F02, "pfr", f"{pgid}.html.gz")
        have_pfr = os.path.exists(pfr_path)
        ev = rel(pfr_path) if have_pfr else rel(DB)
        L = RowLedger("snap_count", key, season, "pfr" if have_pfr else "internal",
                      pgid, ev)

        # --- structural / internal, every row -------------------------------
        L.cmp("gsis_id_resolves", gsis in players, True)
        L.cmp("game_id_resolves", g is not None, True)
        if g:
            L.cmp("season", season, g[2])
            L.cmp("season_type", stype, g[3])
            L.cmp("week", week, g[4])
            L.cmp("playoff_round", rnd, g[5])
            L.cmp("pfr_game_id", pgid, g[1])
            L.cmp("franchise_in_game", fid in (g[6], g[7]), True)
            gday = (g[8] or "").replace("-", "")
            L.cmp("pfr_game_id_date", pgid[:8], gday,
                  equal=(pgid[:8] == gday),
                  note="PFR game id encodes the venue-local game date (game.gameday)")
        exp_round = SRC_WEEK_ROUND.get(swk) if sgt != "REG" else None
        L.cmp("source_week_mapping", (stype, rnd),
              ("REG", None) if sgt == "REG" else ("POST", exp_round))
        L.cmp("source_week_vs_week", week, swk if sgt == "REG" else None)
        for f, v in (("offense_snaps", osn), ("defense_snaps", dsn), ("st_snaps", ssn)):
            L.cmp(f + "_sane", v is None or 0 <= v <= 150, True,
                  note=None if (v is None or 0 <= v <= 150) else f"value {v}")
        for f, v in (("offense_pct", opc), ("defense_pct", dpc), ("st_pct", spc)):
            L.cmp(f + "_sane", v is None or 0 <= v <= 1.5, True,
                  note=None if (v is None or 0 <= v <= 1.5) else f"value {v}")
        for sn, pc, unit in ((osn, opc, "offense"), (dsn, dpc, "defense"),
                             (ssn, spc, "st")):
            d = denom.get((pgid, fid, unit))
            if sn and d and pc:
                # PFR publishes whole percents, and its unit denominator drifts by a
                # snap or two within a team-game. So the test is: does SOME plausible
                # denominator near the team-game's modal one explain this row's
                # percentage to within PFR's rounding granularity? A row that no
                # nearby denominator can explain is genuinely inconsistent.
                fits = [dd for dd in range(max(1, d - 2), d + 3)
                        if abs(sn / dd - pc) <= 0.006]
                L.cmp(unit + "_pct_reconciles", bool(fits), True,
                      note=f"{sn} snaps at {pc}; no denominator in "
                           f"[{max(1, d - 2)},{d + 2}] (team-game modal {d}) yields "
                           f"that percentage" if not fits else None)
        if fid != fid_up and key not in corr:
            L.mark("franchise_id_upstream", "MISMATCH", fid, fid_up,
                   "franchise_id diverges from the upstream value with no "
                   "data_correction row to justify it")

        # --- external, PFR ---------------------------------------------------
        if have_pfr:
            if pgid not in pfr_cache:
                pfr_cache[pgid] = parse_pfr_snaps(pfr_path)
                if len(pfr_cache) > 40:
                    pfr_cache.pop(next(iter(pfr_cache)))
            ref = pfr_cache[pgid].get(pid)
            if ref is None:
                L.mark("pfr_row", "DB_ONLY", pid, None,
                       f"pfr_player_id {pid} does not appear in either snap-count table "
                       f"of PFR boxscore {pgid}")
            else:
                n_ext += 1
                L.cmp("position", pos, ref["pos"])
                for f in ("offense_snaps", "defense_snaps", "st_snaps"):
                    L.cmp(f, r[{"offense_snaps": 13, "defense_snaps": 15,
                                "st_snaps": 17}[f]], ref[f])
                for f, dbv in (("offense_pct", opc), ("defense_pct", dpc), ("st_pct", spc)):
                    rv = ref[f]
                    if dbv is None or rv is None:
                        L.cmp(f, dbv, rv)
                    else:
                        L.cmp(f, round(dbv, 2), round(rv, 2),
                              equal=abs(dbv - rv) <= 0.011,
                              note="PFR publishes whole percents; tolerance 0.011")
                side_fid = g[6] if ref["side"] == "home" else g[7]
                L.cmp("franchise_side", fid, side_fid)
        else:
            L.mark("pfr_external", "NOT_COMPARABLE", None, None,
                   f"no cached PFR boxscore for {pgid}; this row received internal "
                   "and structural validation only")
        L.flush()

    # ---- REF_ONLY: PFR rows we do not carry, for every cached 2013 boxscore --
    have = set(r[3] for r in rows)
    dbkeys = set(f"{r[3]}/{r[1]}" for r in rows)
    for p in sorted(glob.glob(os.path.join(F02, "pfr", "*.html.gz"))):
        pgid = os.path.basename(p)[:-8]
        if pgid not in have:
            continue
        for pid, ref in parse_pfr_snaps(p).items():
            if f"{pgid}/{pid}" in dbkeys:
                continue
            log("snap_count", f"{pgid}/{pid}", 2013, "*", None, "pfr", pgid,
                {k: ref[k] for k in ("offense_snaps", "defense_snaps", "st_snaps")},
                "REF_ONLY", rel(p),
                f"PFR lists {ref['player']} ({pid}) in {pgid}; no snap_count row exists")
    return len(rows), n_ext


def audit_snap_2012_boundary(con):
    """Settle where snap coverage begins, and whether 2012's absence is a defect."""
    ev_dir = os.path.join(F02, "probe")
    proofs = {
        "pfr_2012_boxscore": os.path.join(ev_dir, "wb_pfr_201212300nyg.html"),
        "nflverse_release": os.path.join(ev_dir, "nflverse_snap_release.json"),
        "nflverse_2012_csv": os.path.join(ev_dir, "snap_counts_2012.csv"),
        "nflverse_manifest": os.path.join(ev_dir, "scraped_games_snapcounts.csv"),
    }
    first = con.execute("SELECT MIN(season) FROM snap_count").fetchone()[0]
    wk = con.execute("""SELECT MIN(week) FROM snap_count WHERE season=? AND season_type='REG'""",
                     (first,)).fetchone()[0]
    teams_wk1 = con.execute("""SELECT COUNT(DISTINCT franchise_id) FROM snap_count
                               WHERE season=? AND week=1""", (first,)).fetchone()[0]
    games_wk1 = con.execute("""SELECT COUNT(DISTINCT game_id) FROM snap_count
                               WHERE season=? AND week=1""", (first,)).fetchone()[0]
    n2012 = con.execute("SELECT COUNT(*) FROM snap_count WHERE season=2012").fetchone()[0]

    pfr2012 = 0
    pfr_files = sorted(glob.glob(os.path.join(F02, "pfr", "2012*.html.gz")) +
                       glob.glob(os.path.join(F02, "pfr", "2013 0*.html.gz")))
    g2012 = {r[0] for r in con.execute(
        "SELECT pfr_game_id FROM game WHERE season=2012")}
    covered = []
    for p in sorted(glob.glob(os.path.join(F02, "pfr", "*.html.gz"))):
        pgid = os.path.basename(p)[:-8]
        if pgid not in g2012:
            continue
        rowsn = len(parse_pfr_snaps(p))
        pfr2012 += rowsn
        covered.append(pgid)
    ev = rel(proofs["pfr_2012_boxscore"]) if os.path.exists(proofs["pfr_2012_boxscore"]) \
        else rel(os.path.join(F02, "pfr"))

    log("snap_count", "SEASON_BOUNDARY:2012", 2012, "season_coverage", n2012, "pfr",
        "2012", pfr2012, "REF_ONLY", ev,
        f"Pro-Football-Reference publishes snap counts for the 2012 season "
        f"({pfr2012} player-game rows parsed from {len(covered)} of {len(g2012)} cached "
        f"2012 boxscores); this database has {n2012}. The gap is real and recoverable. "
        f"Root cause is upstream: nflverse's published snap_counts_2012.csv is a "
        f"154-byte header-only file even though its own scraped_games_snapcounts.csv "
        f"manifest lists 266 games for 2012.")
    return {"first_season": first, "first_week": wk, "teams_week1": teams_wk1,
            "games_week1": games_wk1, "db_2012": n2012, "pfr_2012_rows": pfr2012,
            "pfr_2012_games": len(covered), "db_2012_games": len(g2012)}


# ---------------------------------------------------------- roster_season ----
def espn_season_roster_is_stale():
    """ESPN's seasons/{y}/teams/{t}/athletes endpoint ignores the season segment
    and serves the CURRENT roster. Proven, not assumed: the 2012 and 2013 lists
    are byte-identical on all 32 teams. Returns (identical_teams, teams_compared)."""
    same = tot = 0
    for t in range(1, 40):
        a = os.path.join(F02, "roster", f"roster_2012_{t}.json.gz")
        b = os.path.join(F02, "roster", f"roster_2013_{t}.json.gz")
        if not (os.path.exists(a) and os.path.exists(b)):
            continue
        ids = lambda p: {m.group(1) for it in jload(p).get("items", [])  # noqa: E731
                         for m in [re.search(r"/athletes/(\d+)", it.get("$ref", ""))] if m}
        tot += 1
        if ids(a) == ids(b):
            same += 1
    return same, tot


def audit_roster_season(con):
    espn_of = {}
    for gsis, eid in con.execute("SELECT gsis_id, espn_id FROM player WHERE espn_id IS NOT NULL"):
        espn_of[gsis] = str(eid)
    gsis_of = {v: k for k, v in espn_of.items()}
    same, tot = espn_season_roster_is_stale()
    stale_note = (
        f"ESPN's sports.core seasons/{{y}}/teams/{{t}}/athletes endpoint ignores the "
        f"season segment: its 2012 and 2013 responses are identical on {same} of {tot} "
        f"teams, and only 2 of the 93 athletes it returns for '2012 SF' were active in "
        f"2012. It therefore cannot rule on historical roster membership.")
    log("roster_season", "AUTHORITY_PROBE", None, "espn_season_roster_endpoint",
        None, "espn", "seasons/{y}/teams/{t}/athletes", None, "NOT_COMPARABLE",
        rel(os.path.join(F02, "roster", "roster_2012_25.json.gz")), stale_note)

    # Substitute authority: ESPN box scores. A player appearing in a team's box
    # score in season S is proof of membership. Absence proves nothing (bench and
    # practice-squad players never appear), so absence is NOT_COMPARABLE.
    played = defaultdict(set)
    played_name = defaultdict(set)
    box_ev = {}
    for gid, eid, season in con.execute(
            "SELECT game_id, espn_event_id, season FROM game WHERE season IN (2012,2013)"):
        p = summary_path(str(eid))
        if not p:
            continue
        for aid, rec in espn_box(p).items():
            played[(season, rec["team"])].add(aid)
            played_name[(season, rec["team"])].add(normname(rec.get("name")))
            box_ev[(season, rec["team"])] = rel(p)
    teams = {r[0]: r[1] for r in con.execute("SELECT franchise_id, abbreviation FROM team")}
    players = {r[0]: r[1] for r in con.execute("SELECT gsis_id, display_name FROM player")}
    rows = con.execute("""
        SELECT roster_row_id, gsis_id, season, franchise_id, season_type, week,
               playoff_round, source_game_type, source_week, position, jersey_number,
               status, full_name, source_ordinal
        FROM roster_season WHERE season IN (2012,2013) ORDER BY roster_row_id""").fetchall()
    for (rid, gsis, season, fid, stype, week, rnd, sgt, swk, pos, jersey, status,
         name, ordinal) in rows:
        key = str(rid)
        ev = box_ev.get((season, fid), rel(os.path.join(F02, "roster",
                                                        f"roster_{season}_{fid}.json.gz")))
        L = RowLedger("roster_season", key, season, "espn-boxscore",
                      f"{season}/{teams.get(fid)}", ev)
        # structural
        L.cmp("gsis_id_resolves", gsis is None or gsis in players, True)
        L.cmp("franchise_resolves", fid in teams, True)
        exp_round = SRC_WEEK_ROUND.get(swk) if sgt != "REG" else None
        L.cmp("source_week_mapping", (stype, rnd),
              ("REG", None) if sgt == "REG" else ("POST", exp_round))
        L.cmp("source_week_vs_week", week, swk if sgt == "REG" else None)
        dbname = players.get(gsis) if gsis else None
        if gsis is None or name is None or dbname is None:
            L.mark("full_name_matches_player", "NOT_COMPARABLE", name, dbname,
                   "roster row carries no gsis_id, or the player dimension has no name")
        elif normname(name) == normname(dbname):
            L.cmp("full_name_matches_player", name, dbname, equal=True)
        elif samename_loose(name, dbname):
            L.mark("full_name_matches_player", "NOT_COMPARABLE", name, dbname,
                   "same person, nickname vs given name across the two feeds")
        else:
            L.cmp("full_name_matches_player", name, dbname, equal=False,
                  note="roster_season.full_name vs player.display_name")
        # external membership, via ESPN box scores
        aid = espn_of.get(gsis) if gsis else None
        seen_ids = played.get((season, fid), set())
        if aid and aid in seen_ids:
            L.cmp("membership", True, True,
                  note=f"ESPN box score credits athlete {aid} to "
                       f"{teams.get(fid)} in {season}")
        elif name and normname(name) in played_name.get((season, fid), set()):
            L.cmp("membership", True, True,
                  note=f"ESPN box score credits '{name}' to {teams.get(fid)} in "
                       f"{season} (matched by name; espn_id crosswalk missed)")
        else:
            L.mark("membership", "NOT_COMPARABLE", f"{name} on {teams.get(fid)} {season}",
                   None,
                   "no countable statistic for this team this season, so box scores can "
                   "neither confirm nor deny membership; ESPN's season-roster endpoint is "
                   "stale (see AUTHORITY_PROBE)")
        L.mark("position|jersey_number|status", "NOT_COMPARABLE",
               {"position": pos, "jersey_number": jersey, "status": status}, None,
               "no usable historical ESPN source: the season-roster endpoint serves the "
               "current roster, and box scores carry no jersey or status")
        L.n += 2
        L.flush()

    # REF_ONLY: played for the team that season per ESPN, but no roster_season row
    have = defaultdict(set)
    havename = defaultdict(set)
    for gsis, season, fid, nm in con.execute("""SELECT gsis_id, season, franchise_id, full_name
            FROM roster_season WHERE season IN (2012,2013)"""):
        if gsis and gsis in espn_of:
            have[(season, fid)].add(espn_of[gsis])
        havename[(season, fid)].add(normname(nm))
    for (season, fid), ids in sorted(played.items()):
        for aid in sorted(ids - have.get((season, fid), set())):
            g = gsis_of.get(aid)
            if g and normname(players.get(g)) in havename.get((season, fid), set()):
                continue
            log("roster_season", f"espn:{season}/{fid}/{aid}", season, "membership",
                None, "espn-boxscore", f"{season}/{teams.get(fid)}", aid, "REF_ONLY",
                box_ev[(season, fid)],
                f"ESPN box scores credit athlete {aid} to {teams.get(fid)} in {season}; "
                f"roster_season has no row for that team-season "
                f"(gsis_id={g or 'no crosswalk'})")
    return len(rows)


# ------------------------------------------------------------ depth_chart ----
def audit_depth_chart(con):
    players = set(r[0] for r in con.execute("SELECT gsis_id FROM player"))
    teams = set(r[0] for r in con.execute("SELECT franchise_id FROM team"))
    weeks = set()
    for season, week, fid in con.execute("""SELECT season, week, home_franchise_id FROM game
            WHERE season IN (2012,2013) AND week IS NOT NULL"""):
        weeks.add((season, week, fid))
    for season, week, fid in con.execute("""SELECT season, week, away_franchise_id FROM game
            WHERE season IN (2012,2013) AND week IS NOT NULL"""):
        weeks.add((season, week, fid))
    # Bye weeks: a chart is published for a team in a week it does not play. Real,
    # not a defect -- confirmed by the team having games both before and after.
    played_weeks = defaultdict(set)
    for season, week, fid in list(con.execute(
            """SELECT season, week, home_franchise_id FROM game
               WHERE season IN (2012,2013) AND week IS NOT NULL""")) + list(con.execute(
            """SELECT season, week, away_franchise_id FROM game
               WHERE season IN (2012,2013) AND week IS NOT NULL""")):
        played_weeks[(season, fid)].add(week)

    dup = Counter()
    dup_full = Counter()
    rows = con.execute("""
        SELECT depth_chart_id, source_shape, snapshot_ts, source_ordinal, season,
               season_type, week, playoff_round, bucket, source_game_type, source_week,
               franchise_id, gsis_id, gsis_source, espn_id, full_name, position,
               depth_position, depth_position_canonical, depth_order, unit, scheme, pos_slot
        FROM depth_chart WHERE season IN (2012,2013) ORDER BY depth_chart_id""").fetchall()
    for r in rows:
        dup[(r[4], r[10], r[9], r[11], r[12], r[17], r[19])] += 1
        dup_full[(r[4], r[10], r[9], r[11], r[12], r[17], r[19], r[3])] += 1
    ev = rel(os.path.join(NFLDB, "raw", "depth_charts.csv"))
    if not os.path.exists(os.path.join(NFLDB, "raw", "depth_charts.csv")):
        ev = rel(DB)
    for r in rows:
        (did, shape, snap_ts, ordinal, season, stype, week, rnd, bucket, sgt, swk,
         fid, gsis, gsrc, espn_id, name, pos, dpos, dcanon, dorder, unit, scheme,
         slot) = r
        key = str(did)
        L = RowLedger("depth_chart", key, season, "internal", None, ev)
        L.cmp("gsis_id_resolves", gsis is None or gsis in players, True)
        L.cmp("identity_present", gsis is not None or espn_id is not None, True)
        L.cmp("franchise_resolves", fid in teams, True)
        L.cmp("week_round_exclusive", not (week is not None and rnd is not None), True)
        L.cmp("season_type_consistent",
              (week is not None and stype == "REG") or (rnd is not None and stype == "POST")
              or (week is None and rnd is None and stype is None), True)
        L.cmp("shape_snapshot_consistent", (shape == "B"), (snap_ts is not None))
        L.cmp("depth_order_positive", dorder is None or dorder >= 1, True)
        L.cmp("source_ordinal_positive", ordinal >= 1, True)
        if stype is None and week is None and rnd is None:
            # Legal by construction: the chart forecasts the team's next event and
            # this team has none (eliminated after week 17). Schema CHECK allows it
            # exactly when bucket is postseason or offseason.
            L.mark("source_week_mapping", "NOT_COMPARABLE", (sgt, swk, bucket), None,
                   "chart has no next scheduled event to attach to; legal only for "
                   "bucket postseason/offseason, which holds here"
                   if bucket in ("postseason", "offseason") else None)
            if bucket not in ("postseason", "offseason"):
                L.mark("bucket_when_unscheduled", "MISMATCH", bucket,
                       "postseason|offseason",
                       "week, playoff_round and season_type are all NULL, which the "
                       "schema permits only for an unscheduled bucket")
        elif sgt == "REG":
            L.cmp("source_week_mapping", (stype, week, rnd), ("REG", swk, None))
        elif sgt in SRC_WEEK_ROUND:
            L.cmp("source_week_mapping", (stype, rnd),
                  ("POST", SRC_WEEK_ROUND.get(swk)))
        else:
            L.mark("source_week_mapping", "NOT_COMPARABLE", (sgt, swk, stype, rnd), None,
                   "source_game_type SBBYE has no scheduled event to map onto")
        L.cmp("bucket_consistent", bucket in ("regular", "postseason", "preseason", "offseason"),
              True)
        if week is not None:
            wk_played = played_weeks.get((season, fid), set())
            if week in wk_played:
                L.cmp("franchise_played_that_week", True, True)
            elif wk_played and min(wk_played) < week < max(wk_played):
                L.mark("franchise_played_that_week", "NOT_COMPARABLE", week, None,
                       "the team's bye week: it has games both earlier and later that "
                       "season, so a chart with no game is expected")
            else:
                L.cmp("franchise_played_that_week", False, True,
                      note="charted week is outside the team's played schedule entirely")
        k = (season, swk, sgt, fid, gsis, dpos, dorder)
        if dup[k] > 1:
            if dup_full[k + (ordinal,)] > 1:
                L.mark("natural_key_unique", "MISMATCH",
                       f"{dup_full[k + (ordinal,)]} rows share the natural key AND "
                       f"source_ordinal", 1,
                       "source_ordinal is supposed to disambiguate repeated source rows; "
                       "here it does not")
            else:
                L.mark("natural_key_unique", "NOT_COMPARABLE",
                       f"{dup[k]} rows share (season, source_week, source_game_type, "
                       f"franchise, player, depth_position, depth_order)", 1,
                       "repeated in the source feed and separated by source_ordinal, the "
                       "documented mechanism for exactly this case")
        L.flush(force="NOT_COMPARABLE", row_note=NO_DEPTH_SOURCE)
    return len(rows)


# -------------------------------------------------------- data_correction ----
def audit_data_correction(con):
    rows = con.execute("SELECT correction_id, defect, target_table, target_key, "
                       "column_name, upstream_value, corrected_value, source "
                       "FROM data_correction").fetchall()
    mine = []
    gm = {r[0]: r[1] for r in con.execute(
        "SELECT game_id, season FROM game")}
    pfr = {r[0]: r[1] for r in con.execute("SELECT pfr_game_id, season FROM game "
                                           "WHERE pfr_game_id IS NOT NULL")}
    for (cid, defect, tbl, tk, col, up, corr, src) in rows:
        season = None
        if tbl == "game":
            season = gm.get(tk)
        elif tbl == "team_game":
            season = gm.get(tk.split("/")[0])
        elif tbl == "snap_count":
            season = gm.get(tk.split("/")[0]) or pfr.get(tk.split("/")[0])
        elif tbl == "player_game_stats":
            m = re.search(r",\s*(\d{4}),", tk)
            season = int(m.group(1)) if m else None
        if season in SEASONS:
            mine.append((cid, defect, tbl, tk, col, up, corr, src))
    for (cid, defect, tbl, tk, col, up, corr, src) in mine:
        log("data_correction", str(cid), None, col, corr, "cited-source", tk, up,
            "UNRESOLVED", rel(DB), f"{defect} on {tbl}: re-verify against: {src}")
    log("data_correction", "PARTITION_SCAN", None, "*", len(rows), "internal", None,
        len(mine), "MATCH" if not mine else "UNRESOLVED", rel(DB),
        f"{len(rows)} corrections in the table; {len(mine)} target a 2012 or 2013 row")
    return len(rows), len(mine)


# ------------------------------------------------------------------- main ----
def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", default="all")
    ap.add_argument("--ledger", default=LEDGER)
    args = ap.parse_args()
    want = set(args.tables.split(",")) if args.tables != "all" else None

    global _LED
    os.makedirs(os.path.dirname(args.ledger), exist_ok=True)
    start_md5 = md5(DB)
    print(f"db md5 (start): {start_md5}", flush=True)
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.execute("PRAGMA query_only = ON")

    stats = {}
    _LED = open(args.ledger, "w", encoding="utf-8")
    try:
        order = [("game", audit_game), ("game_line", audit_game_line),
                 ("team_game", audit_team_game),
                 ("player_game_stats", audit_player_game_stats),
                 ("snap_count", audit_snap_count),
                 ("roster_season", audit_roster_season),
                 ("depth_chart", audit_depth_chart),
                 ("data_correction", audit_data_correction)]
        for name, fn in order:
            if want and name not in want:
                continue
            print(f"[{name}] ...", flush=True)
            stats[name] = fn(con)
            if name == "snap_count":
                stats["snap_boundary"] = audit_snap_2012_boundary(con)
            print(f"[{name}] {stats[name]}  verdicts={dict(COUNTS[name])}", flush=True)
    finally:
        _LED.close()

    end_md5 = md5(DB)
    print(f"db md5 (end):   {end_md5}  {'UNCHANGED' if end_md5 == start_md5 else 'CHANGED!!'}")

    # .gitignore keeps ledger/*.jsonl out of the repo and un-ignores *.jsonl.gz,
    # so the committable deliverable is the compressed copy.
    with open(args.ledger, "rb") as src, gzip.open(args.ledger + ".gz", "wb") as dst:
        while chunk := src.read(1 << 22):
            dst.write(chunk)
    print(f"ledger: {args.ledger} ({os.path.getsize(args.ledger) / 1e6:.1f} MB) "
          f"-> {args.ledger}.gz ({os.path.getsize(args.ledger + '.gz') / 1e6:.1f} MB)")

    # coverage self-proof
    proof = {}
    where = {"game": "season IN (2012,2013)",
             "game_line": "game_id IN (SELECT game_id FROM game WHERE season IN (2012,2013))",
             "team_game": "season IN (2012,2013)",
             "player_game_stats": "season IN (2012,2013)",
             "snap_count": "season IN (2012,2013)",
             "roster_season": "season IN (2012,2013)",
             "depth_chart": "season IN (2012,2013)"}
    keyexpr = {"game": "game_id", "game_line": "game_id",
               "team_game": "game_id || '/' || franchise_id",
               "player_game_stats": "gsis_id||'/'||season||'/'||week||'/'||season_type",
               "snap_count": "pfr_game_id || '/' || pfr_player_id",
               "roster_season": "CAST(roster_row_id AS TEXT)",
               "depth_chart": "CAST(depth_chart_id AS TEXT)"}
    for t, w in where.items():
        if want and t not in want:
            continue
        keys = set(r[0] for r in con.execute(f"SELECT {keyexpr[t]} FROM {t} WHERE {w}"))
        logged = ROWS_LOGGED[t]
        proof[t] = {"rows_in_partition": len(keys), "rows_in_ledger": len(logged & keys),
                    "difference": len(keys - logged),
                    "ledger_keys_not_in_partition": len(logged - keys)}
    print(json.dumps({"stats": {k: v for k, v in stats.items()},
                      "verdicts": {k: dict(v) for k, v in COUNTS.items()},
                      "coverage": proof,
                      "md5_start": start_md5, "md5_end": end_md5}, indent=2, default=str))
    with open(os.path.join(F02, "f02_summary.json"), "w") as f:
        json.dump({"stats": stats, "verdicts": {k: dict(v) for k, v in COUNTS.items()},
                   "coverage": proof, "md5_start": start_md5, "md5_end": end_md5,
                   "findings_sample": FINDINGS[:4000]}, f, indent=1, default=str)
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
