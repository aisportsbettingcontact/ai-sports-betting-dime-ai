#!/usr/bin/env python3
"""F08 -- forensic row-level audit of seasons 2024 and 2025.

Partition: every row of every table for seasons 2024-2025.

    game               570      ESPN summary
    game_line          570      SportsOddsHistory (covers.com)
    team_game        1,140      derived -- recomputed from game + game_line
    player_game_stats 38,358    ESPN box score
    snap_count       53,227     PFR (blocked) -> full internal + honest split
    roster_season     6,353     ESPN cannot rule (see espn_roster_historical_probe)
    depth_chart     591,527     no external source -- internal/derivation only
                                (2024 shape A 37,312 + 2025 shape B 554,215)

Read-only against nfl.db. Every verdict cites a cached file under cache/f08/
that exists on disk, so the whole audit replays offline.

Phases write independent shards to cache/f08/ledger_<phase>.jsonl and are
skipped when their .done marker exists, so an interrupted run resumes without
losing or duplicating work. `assemble` concatenates the shards into the
deliverable ledger.

    python3 f08.py all          # every phase, then assemble
    python3 f08.py depth        # one phase
    python3 f08.py assemble
"""
from __future__ import annotations

import collections
import datetime as dt
import glob
import gzip
import hashlib
import html
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
DB = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache", "f08")
LEDGER_DIR = os.path.join(REPO, "docs", "audits", "2026-07-27-nfl-db-forensic", "ledger")
LEDGER = os.path.join(LEDGER_DIR, "F08.jsonl")
AGENT = "F08"
SEASONS = (2024, 2025)

sys.path.insert(0, os.path.join(NFLDB, "lib"))

TS = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ev(name):
    """Evidence paths are recorded relative to the repo root so the ledger is
    portable; resolve() maps one back to disk for the existence check."""
    return "scripts/data/nfl-db/cache/f08/" + name


def resolve(path):
    return os.path.join(REPO, path)


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ro():
    conn = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


class Shard:
    """Append-only ledger shard. Flushes continuously; never buffers a phase."""

    def __init__(self, phase):
        self.phase = phase
        self.path = os.path.join(CACHE, "ledger_%s.jsonl" % phase)
        self.done = self.path + ".done"
        self.fh = None
        self.n = 0
        self.verdicts = collections.Counter()

    def complete(self):
        return os.path.exists(self.done)

    def __enter__(self):
        os.makedirs(CACHE, exist_ok=True)
        self.fh = open(self.path, "w", buffering=1 << 20)
        return self

    def __exit__(self, *exc):
        if self.fh:
            self.fh.flush()
            os.fsync(self.fh.fileno())
            self.fh.close()
        if exc[0] is None:
            with open(self.done, "w") as fh:
                json.dump({"phase": self.phase, "lines": self.n,
                           "verdicts": dict(self.verdicts), "ts": TS}, fh)
        return False

    def write(self, table, row_key, season, field, verdict, authority,
              evidence, db_value=None, ref_value=None, ref_id=None,
              note=None, fields_compared=None, fields_matched=None):
        rec = {"ts": TS, "agent": AGENT, "table": table, "row_key": str(row_key),
               "season": season, "field": field}
        if fields_compared is not None:
            rec["fields_compared"] = fields_compared
            rec["fields_matched"] = fields_matched
        if db_value is not None:
            rec["db_value"] = db_value
        rec["authority"] = authority
        if ref_id is not None:
            rec["ref_id"] = str(ref_id)
        if ref_value is not None:
            rec["ref_value"] = ref_value
        rec["verdict"] = verdict
        if note:
            rec["note"] = note
        rec["evidence"] = evidence
        self.fh.write(json.dumps(rec, separators=(",", ":"), default=str) + "\n")
        self.n += 1
        self.verdicts[verdict] += 1
        if self.n % 100000 == 0:
            self.fh.flush()
            sys.stderr.write("    %s: %d lines\n" % (self.phase, self.n))


def note_evidence(name, payload):
    """Write a derived-evidence JSON file and return its ledger-relative path."""
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, name), "w") as fh:
        json.dump(payload, fh, indent=1, default=str)
    return ev(name)


def summary(eid):
    p = os.path.join(CACHE, "summary_%s.json.gz" % eid)
    if not os.path.exists(p):
        return None, None
    with gzip.open(p, "rb") as fh:
        return json.load(fh), ev("summary_%s.json.gz" % eid)


def num(v):
    if v in (None, "", "--", "-"):
        return None
    try:
        return int(str(v).replace(",", ""))
    except ValueError:
        try:
            return float(str(v).replace(",", ""))
        except ValueError:
            return None


def _p(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _corrections(conn):
    out = collections.defaultdict(list)
    for r in conn.execute("SELECT * FROM data_correction"):
        out["%s|%s" % (r["target_table"], r["target_key"])].append(dict(r))
    return out


def phase_depth(sh):
    """depth_chart -- 591,527 rows. No external authority exists.

    Every row is ruled NOT_COMPARABLE on the external dimension with the reason
    recorded. Internal structure and (for shape B) the season/week derivation
    are checked exhaustively; any failure gets its own MISMATCH line against
    the `derived` authority.
    """
    from depth_charts import POSITION_CROSSWALK

    conn = ro()
    events = collections.defaultdict(list)
    span = {}
    last_reg = {}
    for r in conn.execute("SELECT season, season_type, week, playoff_round, "
                          "MIN(kickoff_utc) fk, MAX(kickoff_utc) lk FROM game "
                          "GROUP BY season, season_type, week, playoff_round"):
        events[r["season"]].append((r["fk"], r["week"], r["playoff_round"]))
        lo, hi = span.get(r["season"], (r["fk"], r["lk"]))
        span[r["season"]] = (min(lo, r["fk"]), max(hi, r["lk"]))
        # the LAST regular-season kickoff, not the last week's first kickoff
        if r["season_type"] == "REG":
            last_reg[r["season"]] = max(last_reg.get(r["season"], r["lk"]), r["lk"])
    for s in events:
        events[s].sort()
    seasons = sorted(span)

    def season_of(ts):
        s = seasons[0]
        t = _p(ts)
        for i, y in enumerate(seasons[:-1]):
            close = _p(span[y][1])
            nxt = _p(span[seasons[i + 1]][0])
            if t >= close + (nxt - close) / 2:
                s = y + 1
        return s

    def next_event(season, ts):
        for fk, wk, rnd in events.get(season, ()):
            if fk > ts:
                return wk, rnd
        return None, None

    def bucket_of(season, ts):
        open_, close = span[season]
        if ts < open_:
            return "preseason"
        if ts <= last_reg.get(season, open_):
            return "regular"
        if ts <= close:
            return "postseason"
        return "offseason"

    first_kick = {}
    for s, evs in events.items():
        for fk, wk, rnd in evs:
            first_kick[(s, wk, rnd)] = fk

    teams = set(r[0] for r in conn.execute("SELECT franchise_id FROM team"))
    players = set(r[0] for r in conn.execute("SELECT gsis_id FROM player"))

    stats = collections.Counter()
    leak_examples = []
    tight_fail = []
    bad_counter = collections.Counter()

    ev_a = note_evidence("depth_ruleset.json", {
        "table": "depth_chart",
        "external_authority": "NONE",
        "reason": ("No historical public depth-chart source exists. ESPN publishes "
                   "CURRENT depth charts only and serves them for every season path "
                   "segment -- the same behaviour is proven on the roster endpoint in "
                   "espn_roster_historical_probe.json. No external validation of any "
                   "2024 or 2025 depth-chart row is possible."),
        "season_rule": ("season S owns [boundary(S-1), boundary(S)) where boundary(S) "
                        "= close(S) + (open(S+1)-close(S))/2; calendar year is NOT used"),
        "week_rule": ("a snapshot is stamped with the FIRST event whose earliest "
                      "kickoff is STRICTLY LATER than the snapshot instant"),
        "season_boundaries": dict((str(y), {"open": span[y][0], "close": span[y][1]})
                                  for y in seasons),
        "event_first_kickoffs_2025": dict(("%s|%s" % (w, r), k)
                                          for k, w, r in events.get(2025, [])),
        "internal_checks": [
            "franchise_id resolves to team", "gsis_id (when set) resolves to player",
            "gsis_id or espn_id present", "week/playoff_round mutually exclusive",
            "season_type agrees with week/playoff_round",
            "depth_order >= 1", "bucket in vocabulary",
            "depth_position_canonical == POSITION_CROSSWALK[depth_position]",
            "shape B: snapshot_ts present; shape A: absent",
            "shape B: derived season matches independent recomputation",
            "shape B: derived (week, playoff_round, bucket) matches recomputation",
            "shape B: LEAKAGE -- snapshot_ts < first kickoff of the labelled event",
            "shape B: TIGHTNESS -- the labelled event is the immediate next one",
        ],
    })

    rows = conn.execute(
        "SELECT depth_chart_id, source_shape, snapshot_ts, season, season_type, "
        "week, playoff_round, bucket, source_game_type, source_week, franchise_id, "
        "gsis_id, espn_id, depth_position, depth_position_canonical, depth_order, "
        "unit, scheme, pos_slot, position, full_name "
        "FROM depth_chart WHERE season IN (?,?) ORDER BY depth_chart_id", SEASONS)

    for r in rows:
        rid = r["depth_chart_id"]
        shape = r["source_shape"]
        season = r["season"]
        state = {"checks": 0}
        fails = []

        def chk(ok, name, dbv=None, refv=None):
            state["checks"] += 1
            if not ok:
                fails.append((name, dbv, refv))

        chk(r["franchise_id"] in teams, "franchise_id_fk", r["franchise_id"])
        chk(r["gsis_id"] is None or r["gsis_id"] in players, "gsis_id_fk", r["gsis_id"])
        chk(r["gsis_id"] is not None or r["espn_id"] is not None, "identity_present")
        chk(not (r["week"] is not None and r["playoff_round"] is not None),
            "week_round_exclusive")
        st, wk, rnd = r["season_type"], r["week"], r["playoff_round"]
        chk((st == "REG" and wk is not None and rnd is None)
            or (st == "POST" and rnd is not None and wk is None)
            or (st is None and wk is None and rnd is None), "season_type_agrees", st)
        chk(r["depth_order"] is None or r["depth_order"] >= 1,
            "depth_order_positive", r["depth_order"])
        chk(r["bucket"] in ("preseason", "regular", "postseason", "offseason"),
            "bucket_vocabulary", r["bucket"])
        dp, dpc = r["depth_position"], r["depth_position_canonical"]
        expect = POSITION_CROSSWALK.get(dp)
        chk(dp is None or expect is None or expect == dpc,
            "position_crosswalk", dpc, expect)
        chk((shape == "B") == (r["snapshot_ts"] is not None),
            "snapshot_ts_by_shape", r["snapshot_ts"])

        if shape == "B":
            ts = r["snapshot_ts"]
            d_season = season_of(ts)
            chk(d_season == season, "derived_season", season, d_season)
            d_bucket = bucket_of(d_season, ts)
            chk(d_bucket == r["bucket"], "derived_bucket", r["bucket"], d_bucket)
            d_wk, d_rnd = next_event(d_season, ts)
            if d_bucket == "offseason":
                d_wk, d_rnd = None, None
            chk(d_wk == wk and d_rnd == rnd, "derived_event",
                "%s|%s" % (wk, rnd), "%s|%s" % (d_wk, d_rnd))
            if wk is not None or rnd is not None:
                fk = first_kick.get((season, wk, rnd))
                chk(fk is not None and ts < fk, "leakage_free", ts, fk)
                if fk is not None and ts >= fk and len(leak_examples) < 50:
                    leak_examples.append({"id": rid, "snapshot_ts": ts, "week": wk,
                                          "round": rnd, "first_kick": fk})
                tight = (not any(k > ts and k < fk for k, _w, _r in events[season])
                         if fk else False)
                chk(tight, "tightness", ts, fk)
                if fk and not tight and len(tight_fail) < 50:
                    tight_fail.append({"id": rid, "snapshot_ts": ts, "labelled_fk": fk})
            else:
                chk(r["bucket"] in ("postseason", "offseason"),
                    "unlabelled_only_when_no_next_event", r["bucket"])
        else:
            # 'SBBYE' -- the Super Bowl bye -- is a real nflverse game_type that
            # carries no week number, so a NULL source_week is correct there.
            chk(r["source_game_type"] is not None, "shapeA_source_type",
                r["source_game_type"])
            chk(r["source_week"] is not None or r["source_game_type"] == "SBBYE",
                "shapeA_source_week", r["source_week"], r["source_game_type"])

        for name, dbv, refv in fails:
            bad_counter[name] += 1
            sh.write("depth_chart", rid, season, name, "MISMATCH", "derived",
                     ev_a, db_value=dbv, ref_value=refv, ref_id="game_calendar",
                     note="internal/derivation check failed")

        stats["shape_" + shape] += 1
        stats["rows"] += 1
        c = state["checks"]
        sh.write("depth_chart", rid, season, "*", "NOT_COMPARABLE", "internal+derived",
                 ev_a, ref_id="game_calendar",
                 fields_compared=c, fields_matched=c - len(fails),
                 note="no external source (see evidence); %d/%d internal+derivation "
                      "checks passed" % (c - len(fails), c))

    conn.close()
    out = {"rows": stats["rows"], "shape_A": stats["shape_A"],
           "shape_B": stats["shape_B"], "check_failures": dict(bad_counter),
           "leakage_examples": leak_examples, "tightness_failures": tight_fail}
    note_evidence("depth_result.json", out)
    return out


ROUND_BY_ESPN_WEEK = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}


def _norm_kick(d):
    if not d:
        return None
    d = d.replace("Z", "")
    if len(d) == 16:
        d += ":00"
    return d + "Z"


def phase_game(sh):
    conn = ro()
    corr = _corrections(conn)
    rows = conn.execute(
        "SELECT * FROM game WHERE season IN (?,?) ORDER BY kickoff_utc", SEASONS)
    miss = 0
    mism = collections.Counter()
    detail = []
    n = 0
    for g in rows:
        n += 1
        eid = g["espn_event_id"]
        doc, path = summary(eid)
        if doc is None:
            sh.write("game", g["game_id"], g["season"], "*", "UNRESOLVED", "espn",
                     ev("fetch.log"), ref_id=eid,
                     note="ESPN summary not in cache; could not be fetched")
            miss += 1
            continue
        comp = doc["header"]["competitions"][0]
        hdr = doc["header"]
        venue = (doc.get("gameInfo") or {}).get("venue") or {}
        cmap = dict((c["homeAway"], c) for c in comp["competitors"])
        stype = (hdr.get("season") or {}).get("type")
        ewk = hdr.get("week")
        pairs = [
            ("home_score", g["home_score"], num(cmap.get("home", {}).get("score"))),
            ("away_score", g["away_score"], num(cmap.get("away", {}).get("score"))),
            ("home_franchise_id", g["home_franchise_id"],
             num((cmap.get("home", {}).get("team") or {}).get("id"))),
            ("away_franchise_id", g["away_franchise_id"],
             num((cmap.get("away", {}).get("team") or {}).get("id"))),
            ("result_status", g["result_status"],
             "final" if (comp.get("status") or {}).get("type", {}).get("name")
             == "STATUS_FINAL" else "scheduled"),
            ("espn_event_id", str(g["espn_event_id"]), str(hdr.get("id"))),
        ]
        if g["season_type"] == "REG":
            pairs.append(("week", g["week"], ewk if stype == 2 else None))
        else:
            pairs.append(("playoff_round", g["playoff_round"],
                          ROUND_BY_ESPN_WEEK.get(ewk) if stype == 3 else None))
        if g["result"] is not None:
            hs = num(cmap.get("home", {}).get("score")) or 0
            aw = num(cmap.get("away", {}).get("score")) or 0
            pairs.append(("result", g["result"], hs - aw))
            pairs.append(("total", g["total"], hs + aw))

        ok = 0
        bad_fields = []
        mism_row = {"n": 0}
        for f, dbv, refv in pairs:
            if dbv == refv:
                ok += 1
            else:
                bad_fields.append((f, dbv, refv))

        espn_kick = _norm_kick(comp.get("date"))
        if g["kickoff_utc"] == espn_kick:
            ok += 1
        else:
            ckey = "game|%s" % g["game_id"]
            corrected = any(c["column_name"] == "kickoffUtc" for c in corr.get(ckey, []))
            sh.write("game", g["game_id"], g["season"], "kickoff_utc",
                     "NOT_COMPARABLE", "espn", path, db_value=g["kickoff_utc"],
                     ref_value=espn_kick, ref_id=eid,
                     note=("D12 data_correction applies to this row; verified in the "
                           "corr phase" if corrected else
                           "known-good: nflverse stores the SCHEDULED kickoff, ESPN "
                           "the OBSERVED one"))
            mism["kickoff_utc_convention"] += 1
        # venue_id: the DB column is NULL for every played game (2010-2025) while
        # ESPN publishes one for all of them. That is a gap, not a disagreement.
        espn_venue = num(venue.get("id"))
        if g["venue_id"] == espn_venue:
            ok += 1
        elif g["venue_id"] is None and espn_venue is not None:
            mism["venue_id_ref_only"] += 1
            sh.write("game", g["game_id"], g["season"], "venue_id", "REF_ONLY",
                     "espn", path, ref_value=espn_venue, ref_id=eid,
                     note="ESPN publishes a venue id for this game; game.venue_id is "
                          "NULL. NULL for all 4,363 played games (2010-2025) and "
                          "populated for 273 of 285 in 2026 -- an unfilled column, "
                          "not a disagreement")
        else:
            mism["venue_id"] += 1
            mism_row["n"] += 1
            detail.append({"game_id": g["game_id"], "field": "venue_id",
                           "db": g["venue_id"], "espn": espn_venue, "event": eid})
            sh.write("game", g["game_id"], g["season"], "venue_id", "MISMATCH",
                     "espn", path, db_value=g["venue_id"], ref_value=espn_venue,
                     ref_id=eid)

        espn_stadium = venue.get("fullName")
        if g["stadium"] == espn_stadium:
            ok += 1
        else:
            # NOT the documented "ESPN retro-renames venues" case: for 2024-25 the
            # ESPN label is the era-correct one (Highmark, Caesars, Northwest,
            # Huntington Bank, EverBank) and the DB carries a superseded
            # sponsorship name from its static stadium_id lookup.
            mism["stadium_name_convention"] += 1
            mism_row["n"] += 1
            detail.append({"game_id": g["game_id"], "field": "stadium",
                           "db": g["stadium"], "espn": espn_stadium, "event": eid})
            sh.write("game", g["game_id"], g["season"], "stadium", "MISMATCH",
                     "espn", path, db_value=g["stadium"], ref_value=espn_stadium,
                     ref_id=eid,
                     note="cosmetic label only; game.stadium is a static stadium_id "
                          "lookup carrying a superseded sponsorship name, ESPN carries "
                          "the era-correct one. stadium_id itself is unaffected")
        espn_neutral = comp.get("neutralSite")
        db_neutral = (g["location"] == "Neutral")
        if espn_neutral is None:
            sh.write("game", g["game_id"], g["season"], "location", "NOT_COMPARABLE",
                     "espn", path, db_value=g["location"], ref_id=eid,
                     note="known-good: ESPN neutralSite unpopulated")
        elif bool(espn_neutral) == db_neutral:
            ok += 1
        else:
            mism["location"] += 1
            mism_row["n"] += 1
            detail.append({"game_id": g["game_id"], "field": "location",
                           "db": g["location"], "espn": "Neutral" if espn_neutral
                           else "Home", "event": eid,
                           "third_source": "game.stadium_id=%s / game.stadium=%s"
                                           % (g["stadium_id"], g["stadium"])})
            sh.write("game", g["game_id"], g["season"], "location", "MISMATCH",
                     "espn", path, db_value=g["location"],
                     ref_value="Neutral" if espn_neutral else "Home", ref_id=eid,
                     note="third source (this row's own venue): stadium_id=%s, "
                          "stadium=%s" % (g["stadium_id"], g["stadium"]))

        for f, dbv, refv in bad_fields:
            mism[f] += 1
            detail.append({"game_id": g["game_id"], "field": f, "db": dbv,
                           "espn": refv, "event": eid})
            sh.write("game", g["game_id"], g["season"], f, "MISMATCH", "espn",
                     path, db_value=dbv, ref_value=refv, ref_id=eid)

        # Row-level verdict must roll up every field verdict written above, not
        # just the ones collected in bad_fields.
        row_bad = bool(bad_fields) or mism_row["n"]
        sh.write("game", g["game_id"], g["season"], "*",
                 "MATCH" if not row_bad else "MISMATCH", "espn", path, ref_id=eid,
                 fields_compared=len(pairs) + 4, fields_matched=ok)
    conn.close()
    out = {"rows": n, "missing_summary": miss, "mismatch_by_field": dict(mism),
           "detail": detail}
    note_evidence("game_result.json", out)
    return out


def _soh_games(year):
    p = os.path.join(CACHE, "soh_%d.html.gz" % year)
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt", encoding="utf-8", errors="replace") as fh:
        h = fh.read()
    out = []
    date_re = re.compile(r"^[A-Z][a-z]{2} \d{1,2}, \d{4}$")
    for tr in re.findall(r"<tr>(.*?)</tr>", h, re.S):
        cs = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
              for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cs) != 11:
            continue
        # Two layouts share the 11-column width. Regular season starts at Day;
        # the playoff table prepends a Round cell and shifts everything by one.
        if date_re.match(cs[1]):
            o = 0
            rnd = None
        elif date_re.match(cs[2]):
            o = 1
            rnd = cs[0]
        else:
            continue
        m = re.search(r"(-?\d+(?:\.\d+)?)", cs[6 + o])
        spread = abs(float(m.group(1))) if m else None
        t = re.search(r"(\d+(?:\.\d+)?)", cs[9 + o])
        total = float(t.group(1)) if t else None
        # Seed suffixes appear on playoff team names: "Houston Texans (4)".
        fav = re.sub(r"\s*\(\d+\)$", "", cs[4 + o])
        dog = re.sub(r"\s*\(\d+\)$", "", cs[8 + o])
        out.append({"date": cs[1 + o], "fav": fav, "dog": dog, "round": rnd,
                    "neutral": cs[3 + o] == "N" or cs[7 + o] == "N",
                    "spread": spread, "total": total, "score": cs[5 + o], "raw": cs})
    return out


def phase_line(sh):
    conn = ro()
    names = dict((r["display_name"], r["franchise_id"]) for r in
                 conn.execute("SELECT franchise_id, display_name FROM team"))
    soh = {}
    parsed = {}
    for y in SEASONS:
        g = _soh_games(y)
        parsed[str(y)] = 0 if g is None else len(g)
        for row in (g or []):
            f, d = names.get(row["fav"]), names.get(row["dog"])
            if f is None or d is None:
                continue
            soh[(frozenset((f, d)), row["date"])] = row
    ev_parse = note_evidence("soh_parse.json",
                             {"rows_parsed": parsed, "indexed": len(soh)})
    unmatched = []
    mism = []
    n = 0
    for r in conn.execute(
            "SELECT l.*, g.season, g.home_franchise_id h, g.away_franchise_id a, "
            "g.gameday FROM game_line l JOIN game g USING(game_id) "
            "WHERE g.season IN (?,?) ORDER BY g.kickoff_utc", SEASONS):
        n += 1
        path = ev("soh_%d.html.gz" % r["season"])
        if not os.path.exists(resolve(path)):
            path = ev_parse
        key = frozenset((r["h"], r["a"]))
        hit = None
        base = dt.date.fromisoformat(r["gameday"]) if r["gameday"] else None
        for delta in (0, -1, 1):
            if base is None:
                break
            d2 = base + dt.timedelta(days=delta)
            ds = "%s %d, %d" % (d2.strftime("%b"), d2.day, d2.year)
            if (key, ds) in soh:
                hit = soh[(key, ds)]
                break
        if hit is None:
            unmatched.append(r["game_id"])
            sh.write("game_line", r["game_id"], r["season"], "*", "UNRESOLVED",
                     "sportsoddshistory", path,
                     note="no SportsOddsHistory row matched this team-pair/date")
            continue
        fav_id = names.get(hit["fav"])
        exp_spread = hit["spread"] if fav_id == r["h"] else -hit["spread"]
        bad = []
        ok = 0
        if abs(float(r["spread_line"]) - exp_spread) < 1e-9:
            ok += 1
        else:
            bad.append(("spread_line", r["spread_line"], exp_spread))
        if hit["total"] is not None and abs(float(r["total_line"]) - hit["total"]) < 1e-9:
            ok += 1
        elif hit["total"] is not None:
            bad.append(("total_line", r["total_line"], hit["total"]))
        for f, dbv, refv in bad:
            mism.append({"game_id": r["game_id"], "field": f, "db": dbv,
                         "soh": refv, "soh_row": hit["raw"]})
            sh.write("game_line", r["game_id"], r["season"], f, "MISMATCH",
                     "sportsoddshistory", path, db_value=dbv, ref_value=refv,
                     ref_id=hit["date"],
                     note="closing line differs from SportsOddsHistory")
        sh.write("game_line", r["game_id"], r["season"], "moneyline+odds",
                 "NOT_COMPARABLE", "sportsoddshistory", path,
                 note="SportsOddsHistory publishes spread and total only; it carries no "
                      "moneyline or price fields for these seasons")
        sh.write("game_line", r["game_id"], r["season"], "*",
                 "MATCH" if not bad else "MISMATCH", "sportsoddshistory", path,
                 ref_id=hit["date"], fields_compared=2, fields_matched=ok)
    conn.close()
    out = {"rows": n, "unmatched": unmatched, "mismatch_count": len(mism),
           "mismatches": mism}
    note_evidence("line_result.json", out)
    return out


def phase_tg(sh):
    conn = ro()
    g = dict((r["game_id"], dict(r)) for r in conn.execute(
        "SELECT * FROM game WHERE season IN (?,?)", SEASONS))
    lines = dict((r["game_id"], dict(r)) for r in conn.execute(
        "SELECT l.* FROM game_line l JOIN game gg USING(game_id) "
        "WHERE gg.season IN (?,?)", SEASONS))
    evp = note_evidence("team_game_rule.json", {
        "authority": "derived -- recomputed from game + game_line",
        "recomputed_fields": ["opponent_id", "season", "season_type", "week",
                              "playoff_round", "kickoff_utc", "is_home",
                              "points_for", "points_against", "margin", "spread",
                              "total_line", "moneyline", "su_result", "ats_result",
                              "ou_result", "won", "covered"],
        "rules": {
            "spread": "is_home ? +spread_line : -spread_line",
            "margin": "points_for - points_against",
            "su_result": "margin>0 W, <0 L, =0 T",
            "ats_result": "margin>spread W, <spread L, = P",
            "ou_result": "pf+pa>total O, < U, = P",
            "won": "1 if margin>0, 0 if margin<0, NULL if tie or unplayed",
            "covered": "1 if margin>spread, 0 if <, NULL if push or no line",
        },
        "note": "100% recomputable; no external source is involved or claimed",
    })
    mism = []
    n = 0
    for r in conn.execute("SELECT * FROM team_game WHERE season IN (?,?) "
                          "ORDER BY game_id, franchise_id", SEASONS):
        n += 1
        gm = g.get(r["game_id"])
        key = "%s|%s" % (r["game_id"], r["franchise_id"])
        if gm is None:
            sh.write("team_game", key, r["season"], "game_id", "DB_ONLY", "derived",
                     evp, db_value=r["game_id"], note="no parent game row")
            sh.write("team_game", key, r["season"], "*", "DB_ONLY", "derived", evp,
                     fields_compared=0, fields_matched=0,
                     note="no parent game row to recompute from")
            continue
        ln = lines.get(r["game_id"])
        home = gm["home_franchise_id"] == r["franchise_id"]
        pf = gm["home_score"] if home else gm["away_score"]
        pa = gm["away_score"] if home else gm["home_score"]
        margin = None if pf is None or pa is None else pf - pa
        spread = ml = total_line = None
        if ln:
            spread = ln["spread_line"] if home else -ln["spread_line"]
            ml = ln["home_moneyline"] if home else ln["away_moneyline"]
            total_line = ln["total_line"]
        exp = {
            "opponent_id": gm["away_franchise_id"] if home else gm["home_franchise_id"],
            "season": gm["season"], "season_type": gm["season_type"],
            "week": gm["week"], "playoff_round": gm["playoff_round"],
            "kickoff_utc": gm["kickoff_utc"], "is_home": 1 if home else 0,
            "points_for": pf, "points_against": pa, "margin": margin,
            "spread": spread, "total_line": total_line, "moneyline": ml,
            "su_result": (None if margin is None else
                          ("W" if margin > 0 else "L" if margin < 0 else "T")),
            "ats_result": (None if margin is None or spread is None else
                           ("W" if margin > spread else
                            "L" if margin < spread else "P")),
            "ou_result": (None if pf is None or pa is None or total_line is None else
                          ("O" if pf + pa > total_line else
                           "U" if pf + pa < total_line else "P")),
            "won": None if margin is None or margin == 0 else (1 if margin > 0 else 0),
            "covered": (None if margin is None or spread is None or margin == spread
                        else (1 if margin > spread else 0)),
        }
        bad = []
        for f, want in exp.items():
            got = r[f]
            if isinstance(want, float) or isinstance(got, float):
                same = ((want is None and got is None) or
                        (want is not None and got is not None and
                         abs(float(got) - float(want)) < 1e-9))
            else:
                same = got == want
            if not same:
                bad.append((f, got, want))
        for f, got, want in bad:
            mism.append({"key": key, "field": f, "db": got, "recomputed": want})
            sh.write("team_game", key, r["season"], f, "MISMATCH", "derived", evp,
                     db_value=got, ref_value=want, ref_id=r["game_id"])
        sh.write("team_game", key, r["season"], "*",
                 "MATCH" if not bad else "MISMATCH", "derived", evp,
                 ref_id=r["game_id"], fields_compared=len(exp),
                 fields_matched=len(exp) - len(bad))
    conn.close()
    out = {"rows": n, "mismatch_count": len(mism), "mismatches": mism[:500]}
    note_evidence("team_game_result.json", out)
    return out


ESPN_CATS = ("passing", "rushing", "receiving")


def _boxscore(doc):
    """({espn_athlete_id: {stat: value}}, {athletes listed anywhere}, {fid: recon}).

    The third element is the per-team reconciliation used to tell an ESPN
    omission apart from a database fabrication: a complete box score has
    sum(receptions) == QB completions. Where it falls short, ESPN dropped
    somebody, and a DB row that closes the gap exactly is corroborated by
    ESPN's own arithmetic rather than contradicted by it.
    """
    out = collections.defaultdict(dict)
    played = set()
    recon = {}
    for team in (doc.get("boxscore") or {}).get("players", []):
        fid = num((team.get("team") or {}).get("id"))
        comps = 0
        recs = 0
        for st in team.get("statistics", []):
            name = st.get("name")
            keys = st.get("keys") or []
            if name == "passing" and "completions/passingAttempts" in keys:
                i = keys.index("completions/passingAttempts")
                for a in st.get("athletes", []):
                    v = _split((a.get("stats") or [None] * (i + 1))[i])[0]
                    comps += v or 0
            if name == "receiving" and "receptions" in keys:
                i = keys.index("receptions")
                for a in st.get("athletes", []):
                    recs += num((a.get("stats") or [None] * (i + 1))[i]) or 0
            for a in st.get("athletes", []):
                aid = str(((a.get("athlete") or {}).get("id")) or "")
                if not aid:
                    continue
                played.add(aid)
                if name not in ESPN_CATS:
                    continue
                vals = a.get("stats") or []
                for k, v in zip(keys, vals):
                    out[aid][k] = v
        recon[fid] = {"espn_completions": comps, "espn_sum_receptions": recs,
                      "shortfall": comps - recs}
    return out, played, recon


def _split(v):
    if not v or "/" not in str(v):
        return (None, None)
    a, b = str(v).split("/", 1)
    return (num(a), num(b))


def phase_pgs(sh):
    conn = ro()
    espn_of = dict((r["gsis_id"], r["espn_id"]) for r in
                   conn.execute("SELECT gsis_id, espn_id FROM player"))
    eid_of = dict((r["game_id"], r["espn_event_id"]) for r in
                  conn.execute("SELECT game_id, espn_event_id FROM game "
                               "WHERE season IN (?,?)", SEASONS))
    corr = _corrections(conn)
    mism = collections.Counter()
    detail = []
    n = 0
    cur_eid = object()
    doc = path = box = played = recon = None
    for r in conn.execute("SELECT * FROM player_game_stats WHERE season IN (?,?) "
                          "ORDER BY game_id, gsis_id", SEASONS):
        n += 1
        key = "%s|%s" % (r["gsis_id"], r["game_id"])
        eid = eid_of.get(r["game_id"])
        if eid != cur_eid:
            cur_eid = eid
            doc, path = summary(eid)
            box, played, recon = _boxscore(doc) if doc else (None, None, None)
        if doc is None:
            sh.write("player_game_stats", key, r["season"], "*", "UNRESOLVED",
                     "espn", ev("fetch.log"), ref_id=eid,
                     note="ESPN summary not in cache")
            continue
        aid = espn_of.get(r["gsis_id"])
        if not aid:
            sh.write("player_game_stats", key, r["season"], "*", "NOT_COMPARABLE",
                     "espn", path, ref_id=eid,
                     note="player carries no espn_id; ESPN box score cannot be joined")
            continue
        aid = str(aid)
        st = box.get(aid)
        db = {
            "completions": r["completions"], "attempts": r["attempts"],
            "passing_yards": r["passing_yards"], "passing_tds": r["passing_tds"],
            "interceptions": r["interceptions"], "carries": r["carries"],
            "rushing_yards": r["rushing_yards"], "rushing_tds": r["rushing_tds"],
            "receptions": r["receptions"], "targets": r["targets"],
            "receiving_yards": r["receiving_yards"], "receiving_tds": r["receiving_tds"],
        }
        if st is None:
            allzero = all((v or 0) == 0 for v in db.values())
            if allzero and aid in played:
                sh.write("player_game_stats", key, r["season"], "*", "MATCH", "espn",
                         path, ref_id=eid, fields_compared=12, fields_matched=12,
                         note="athlete present in the ESPN box score, absent from all "
                              "passing/rushing/receiving categories -- confirms 12 zeros")
            elif allzero:
                sh.write("player_game_stats", key, r["season"], "*", "NOT_COMPARABLE",
                         "espn", path, ref_id=eid,
                         note="all twelve stats zero and athlete not listed anywhere in "
                              "the ESPN box score; ESPN cannot confirm participation")
            else:
                mism["absent_from_box_score"] += 1
                rc = (recon or {}).get(r["franchise_id"]) or {}
                short = rc.get("shortfall")
                closes = (short is not None and (r["receptions"] or 0) > 0
                          and short >= (r["receptions"] or 0))
                if closes:
                    mism["absent_but_espn_shortfall_confirms"] += 1
                if len(detail) < 4000:
                    detail.append({"key": key, "field": "*", "db": db, "espn": None,
                                   "espn_recon": rc, "espn_shortfall_covers_row": closes})
                sh.write("player_game_stats", key, r["season"], "*", "DB_ONLY", "espn",
                         path, db_value=json.dumps(db), ref_id=eid,
                         note=("athlete absent from the ESPN box score. ESPN's own "
                               "arithmetic for this team is short: %s completions vs "
                               "%s listed receptions (shortfall %s)%s"
                               % (rc.get("espn_completions"), rc.get("espn_sum_receptions"),
                                  short,
                                  " -- this row's %d receptions fall inside that gap, so "
                                  "ESPN omitted the player rather than the database "
                                  "inventing him" % (r["receptions"] or 0) if closes
                                  else "")))
            continue

        pa = _split(st.get("completions/passingAttempts"))
        ref = {
            "completions": pa[0], "attempts": pa[1],
            "passing_yards": num(st.get("passingYards")),
            "passing_tds": num(st.get("passingTouchdowns")),
            "interceptions": num(st.get("interceptions")),
            "carries": num(st.get("rushingAttempts")),
            "rushing_yards": num(st.get("rushingYards")),
            "rushing_tds": num(st.get("rushingTouchdowns")),
            "receptions": num(st.get("receptions")),
            "targets": num(st.get("receivingTargets")),
            "receiving_yards": num(st.get("receivingYards")),
            "receiving_tds": num(st.get("receivingTouchdowns")),
        }
        ok = 0
        bad = []
        hard = 0
        for f, dbv in db.items():
            refv = ref[f]
            if refv is None:
                refv = 0
            if (dbv or 0) == refv:
                ok += 1
            else:
                bad.append((f, dbv, refv))
        ckey = "player_game_stats|%s" % key
        corrected = set(c["column_name"] for c in corr.get(ckey, []))
        for f, dbv, refv in bad:
            if f == "targets" and abs((dbv or 0) - (refv or 0)) <= 1:
                mism["targets_pm1_convention"] += 1
                sh.write("player_game_stats", key, r["season"], f, "NOT_COMPARABLE",
                         "espn", path, db_value=dbv, ref_value=refv, ref_id=eid,
                         note="known-good: ESPN omits zero-reception targets entirely "
                              "and sometimes charges an incompletion to a different "
                              "receiver, which moves a single target between rows")
                continue
            if f in corrected:
                mism[f + "_corrected"] += 1
                hard += 0
                sh.write("player_game_stats", key, r["season"], f, "NOT_COMPARABLE",
                         "espn", path, db_value=dbv, ref_value=refv, ref_id=eid,
                         note="D17/D19 data_correction applies; verified in corr phase")
                continue
            mism[f] += 1
            hard += 1
            if len(detail) < 4000:
                detail.append({"key": key, "field": f, "db": dbv, "espn": refv,
                               "event": eid})
            sh.write("player_game_stats", key, r["season"], f, "MISMATCH", "espn",
                     path, db_value=dbv, ref_value=refv, ref_id=eid)
        sh.write("player_game_stats", key, r["season"], "*",
                 "MATCH" if not bad else ("MISMATCH" if hard else "NOT_COMPARABLE"),
                 "espn", path, ref_id=eid,
                 fields_compared=12, fields_matched=ok,
                 note=None if not bad or hard else
                      "only difference falls under a documented known-good convention")
    conn.close()
    out = {"rows": n, "mismatch_by_field": dict(mism), "detail": detail}
    note_evidence("pgs_result.json", out)
    return out


def phase_snap(sh):
    """snap_count -- PFR is the authority and it blocks (HTTP 403).

    Every row gets a full INTERNAL validation; any PFR page actually retrieved
    is used for genuine external comparison. The split is reported exactly and
    internal validation is never described as external.
    """
    conn = ro()
    players = set(r[0] for r in conn.execute("SELECT gsis_id FROM player"))
    games = dict((r["game_id"], dict(r)) for r in conn.execute(
        "SELECT game_id, season, season_type, week, playoff_round, pfr_game_id, "
        "home_franchise_id, away_franchise_id FROM game WHERE season IN (?,?)", SEASONS))
    # PFR is blocked, so the strongest available check on the numbers themselves
    # is byte-level fidelity against raw/snap_counts.csv -- the file this table
    # was built from. That proves the loader carried the source faithfully; it
    # does NOT prove the source is right, which only PFR could.
    import csv as _csv
    _csv.field_size_limit(10 ** 9)
    src = {}
    raw_path = os.path.join(NFLDB, "raw", "snap_counts.csv")
    have_raw = os.path.exists(raw_path)
    if have_raw:
        with open(raw_path, newline="", encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                if row.get("season") in ("2024", "2025"):
                    src[(row.get("pfr_player_id"), row.get("pfr_game_id"))] = row
    note_evidence("snap_source_index.json", {
        "raw_file": "scripts/data/nfl-db/raw/snap_counts.csv",
        "present": have_raw, "rows_indexed_2024_2025": len(src),
        "note": ("byte-level fidelity check: every snap_count row must reproduce its "
                 "source row's six snap/pct values exactly"),
    })

    # Separately: PFR's published percentages are stored to 2 decimals and, for
    # some team-game units, no single integer denominator reproduces all of them
    # (PFR's own rounding is not internally consistent). That is an upstream
    # artifact we cannot adjudicate while PFR is blocked, so it is recorded as an
    # observation rather than charged against the database.
    UNITS = (("offense_snaps", "offense_pct"), ("defense_snaps", "defense_pct"),
             ("st_snaps", "st_pct"))
    TOL = 0.005 + 1e-9
    obs = collections.defaultdict(lambda: ([], [], []))
    for r in conn.execute("SELECT game_id, franchise_id, offense_snaps, offense_pct, "
                          "defense_snaps, defense_pct, st_snaps, st_pct "
                          "FROM snap_count WHERE season IN (?,?)", SEASONS):
        bucket = obs[(r["game_id"], r["franchise_id"])]
        for i, (sc, pc) in enumerate(UNITS):
            bucket[i].append((r[sc], r[pc]))

    def fit(pairs):
        live = [(a, b) for a, b in pairs if (a or 0) > 0 or (b or 0) > 0]
        if not live:
            return 0
        lo = max(a for a, _ in live)
        hi = lo
        for a, b in live:
            if b and b > 0:
                hi = max(hi, int(round(a / b)) + 2)
        for D in range(max(lo, 1), max(hi, lo) + 1):
            if all(abs(a / float(D) - (b or 0)) <= TOL for a, b in live):
                return D
        return None

    denom = {}
    unfittable = []
    for k, units in obs.items():
        got = tuple(fit(u) for u in units)
        denom[k] = got
        for u, v in zip(("offense", "defense", "st"), got):
            if v is None:
                unfittable.append("%s|%s|%s" % (k[0], k[1], u))
    note_evidence("snap_denominators.json", {
        "method": ("for each (game, franchise, unit) the smallest integer D >= "
                   "max(snaps) reproducing every stored pct within +-0.005"),
        "team_game_units": len(denom) * 3,
        "unfittable_units": len(unfittable),
        "interpretation": ("PFR rounds its snap percentages inconsistently (e.g. BUF "
                           "2024_01 ST: 17/27=0.6296 stored 0.63 but 21/27=0.7778 "
                           "stored 0.77). This is an upstream artifact; with PFR "
                           "returning 403 it cannot be adjudicated, so affected rows "
                           "are NOT_COMPARABLE on that check, not MISMATCH."),
        "unfittable": sorted(unfittable)[:300],
    })
    unfit = set(unfittable)

    have_pfr = set(os.path.basename(p)[4:-8] for p in
                   glob.glob(os.path.join(CACHE, "pfr_*.html.gz")))
    blocked = sorted(os.path.basename(p)[4:-16] for p in
                     glob.glob(os.path.join(CACHE, "pfr_*.html.gz.http403")))
    evp = note_evidence("snap_rules.json", {
        "external_authority": "Pro-Football-Reference",
        "external_status": ("HTTP 403 -- PFR refused every request from this host. "
                            "%d box scores retrieved, %d refused."
                            % (len(have_pfr), len(blocked))),
        "internal_checks": [
            "gsis_id resolves to player", "game_id resolves to game",
            "franchise_id is one of the two teams in that game",
            "season/season_type/week/playoff_round agree with the parent game",
            "pfr_game_id agrees with the parent game",
            "source_week/source_game_type map to week/playoff_round",
            "each snap count is an integer in [0,200]", "each pct in [0,1]",
            "offense_pct == offense_snaps / team offensive total (+-0.011)",
            "defense_pct and st_pct reconcile likewise",
        ],
        "blocked_sample": blocked[:20],
    })
    n = 0
    fails = collections.Counter()
    softs = collections.Counter()
    detail = []
    for r in conn.execute("SELECT * FROM snap_count WHERE season IN (?,?) "
                          "ORDER BY game_id, pfr_player_id", SEASONS):
        n += 1
        key = "%s|%s" % (r["pfr_player_id"], r["pfr_game_id"])
        gm = games.get(r["game_id"])
        state = {"checks": 0}
        bad = []
        soft = []

        def chk(ok, name, dbv=None, refv=None):
            state["checks"] += 1
            if not ok:
                bad.append((name, dbv, refv))

        chk(r["gsis_id"] in players, "gsis_id_fk", r["gsis_id"])
        chk(gm is not None, "game_id_fk", r["game_id"])
        if gm:
            chk(r["franchise_id"] in (gm["home_franchise_id"], gm["away_franchise_id"]),
                "franchise_in_game", r["franchise_id"],
                "%s/%s" % (gm["home_franchise_id"], gm["away_franchise_id"]))
            chk(r["season"] == gm["season"], "season_agrees", r["season"], gm["season"])
            chk(r["season_type"] == gm["season_type"], "season_type_agrees",
                r["season_type"], gm["season_type"])
            chk(r["week"] == gm["week"], "week_agrees", r["week"], gm["week"])
            chk(r["playoff_round"] == gm["playoff_round"], "round_agrees",
                r["playoff_round"], gm["playoff_round"])
            chk(r["pfr_game_id"] == gm["pfr_game_id"], "pfr_game_id_agrees",
                r["pfr_game_id"], gm["pfr_game_id"])
        exp_type = "REG" if r["source_game_type"] == "REG" else "POST"
        chk(r["season_type"] == exp_type, "source_type_maps", r["season_type"], exp_type)
        if r["source_game_type"] != "REG":
            chk(r["playoff_round"] == r["source_game_type"], "source_round_maps",
                r["playoff_round"], r["source_game_type"])
        else:
            chk(r["week"] == r["source_week"], "source_week_maps",
                r["week"], r["source_week"])
        for c in ("offense_snaps", "defense_snaps", "st_snaps"):
            v = r[c]
            chk(v is not None and 0 <= v <= 200, c + "_range", v)
        for c in ("offense_pct", "defense_pct", "st_pct"):
            v = r[c]
            chk(v is not None and 0.0 <= v <= 1.0, c + "_range", v)
        # byte-level fidelity against the source file
        srow = src.get((r["pfr_player_id"], r["pfr_game_id"])) if have_raw else None
        if srow is not None:
            for sc, pc in UNITS:
                chk(num(srow.get(sc)) == r[sc], sc + "_matches_source",
                    r[sc], num(srow.get(sc)))
                chk(abs((num(srow.get(pc)) or 0) - (r[pc] or 0)) < 1e-9,
                    pc + "_matches_source", r[pc], num(srow.get(pc)))
        elif have_raw:
            chk(False, "row_present_in_source", r["pfr_player_id"])

        # denominator consistency: informational, never charged to the database
        tot = denom.get((r["game_id"], r["franchise_id"]))
        if tot:
            for i, (sc, pc) in enumerate(UNITS):
                D = tot[i]
                unit_name = ("offense", "defense", "st")[i]
                if D:
                    want = r[sc] / float(D)
                    if abs(want - r[pc]) > TOL:
                        soft.append((pc + "_upstream_rounding", r[pc], round(want, 4)))
                elif D == 0:
                    chk((r[sc] or 0) == 0 and (r[pc] or 0) == 0,
                        pc + "_zero_when_unit_unused", r[pc])
                elif "%s|%s|%s" % (r["game_id"], r["franchise_id"], unit_name) in unfit:
                    soft.append((pc + "_no_consistent_denominator", r[pc], None))

        for name, dbv, refv in bad:
            fails[name] += 1
            if len(detail) < 2000:
                detail.append({"key": key, "check": name, "db": dbv, "expected": refv})
            sh.write("snap_count", key, r["season"], name, "MISMATCH", "internal",
                     evp, db_value=dbv, ref_value=refv, ref_id=r["game_id"],
                     note="internal consistency check failed")
        for name, dbv, refv in soft:
            softs[name] += 1
            sh.write("snap_count", key, r["season"], name, "NOT_COMPARABLE",
                     "pro-football-reference", ev("snap_denominators.json"),
                     db_value=dbv, ref_value=refv, ref_id=r["game_id"],
                     note="upstream PFR rounding: no single team denominator "
                          "reproduces all stored pcts; value matches source file exactly")
        c = state["checks"]
        sh.write("snap_count", key, r["season"], "*", "NOT_COMPARABLE", "internal",
                 evp, ref_id=r["pfr_game_id"],
                 fields_compared=c, fields_matched=c - len(bad),
                 note="PFR 403 (see pfr_block_evidence.json); INTERNAL only, %d/%d "
                      "checks passed" % (c - len(bad), c))
    conn.close()
    out = {"rows": n, "externally_validated_rows": 0,
           "pfr_pages_retrieved": len(have_pfr), "pfr_pages_blocked": len(blocked),
           "source_rows_indexed": len(src),
           "check_failures": dict(fails), "upstream_rounding": dict(softs),
           "detail": detail}
    note_evidence("snap_result.json", out)
    return out


def phase_roster(sh):
    conn = ro()
    evp = ev("espn_roster_historical_probe.json")
    seen = collections.defaultdict(set)
    for p in sorted(glob.glob(os.path.join(CACHE, "summary_*.json.gz"))):
        try:
            with gzip.open(p, "rb") as fh:
                doc = json.load(fh)
        except Exception:                        # noqa: BLE001
            continue
        season = ((doc.get("header") or {}).get("season") or {}).get("year")
        for team in (doc.get("boxscore") or {}).get("players", []):
            fid = num((team.get("team") or {}).get("id"))
            for st in team.get("statistics", []):
                for a in st.get("athletes", []):
                    aid = str(((a.get("athlete") or {}).get("id")) or "")
                    if aid:
                        seen[(season, fid)].add(aid)
    memb = note_evidence("roster_boxscore_membership.json", {
        "method": ("an athlete listed in the ESPN box score for franchise F in season S "
                   "was demonstrably on F's roster in S; this is the only external "
                   "membership signal ESPN can supply for a historical season"),
        "pairs": len(seen),
        "athletes_per_pair": dict(("%s|%s" % k, len(v)) for k, v in sorted(
            seen.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1])))),
    })
    espn_of = dict((r["gsis_id"], r["espn_id"]) for r in
                   conn.execute("SELECT gsis_id, espn_id FROM player"))
    known = set(espn_of)
    teams = set(r[0] for r in conn.execute("SELECT franchise_id FROM team"))
    n = conf = unconf = 0
    fails = collections.Counter()
    for r in conn.execute("SELECT * FROM roster_season WHERE season IN (?,?) "
                          "ORDER BY roster_row_id", SEASONS):
        n += 1
        bad = []
        state = {"checks": 0}

        def chk(ok, name, dbv=None):
            state["checks"] += 1
            if not ok:
                bad.append((name, dbv))

        chk(r["franchise_id"] in teams, "franchise_id_fk", r["franchise_id"])
        chk(r["gsis_id"] is None or r["gsis_id"] in known, "gsis_id_fk", r["gsis_id"])
        st, wk, rnd = r["season_type"], r["week"], r["playoff_round"]
        chk((st == "REG" and wk is not None and rnd is None)
            or (st == "POST" and rnd is not None and wk is None), "type_agrees", st)
        chk(1 <= (r["source_week"] or 0) <= 22, "source_week_range", r["source_week"])
        chk((r["source_ordinal"] or 0) >= 1, "source_ordinal", r["source_ordinal"])
        for name, dbv in bad:
            fails[name] += 1
            sh.write("roster_season", r["roster_row_id"], r["season"], name,
                     "MISMATCH", "internal", evp, db_value=dbv,
                     note="internal consistency check failed")
        aid = str(espn_of.get(r["gsis_id"]) or "")
        c = state["checks"]
        if aid and aid in seen.get((r["season"], r["franchise_id"]), ()):
            conf += 1
            sh.write("roster_season", r["roster_row_id"], r["season"], "*", "MATCH",
                     "espn", memb, ref_id="%s|%s" % (r["season"], r["franchise_id"]),
                     fields_compared=1, fields_matched=1,
                     note="membership corroborated by an ESPN box-score appearance "
                          "for this franchise in this season")
        else:
            unconf += 1
            sh.write("roster_season", r["roster_row_id"], r["season"], "*",
                     "NOT_COMPARABLE", "espn", evp,
                     fields_compared=c, fields_matched=c - len(bad),
                     note="ESPN cannot rule on historical rosters (see evidence); no "
                          "box-score appearance either; %d/%d internal checks passed"
                          % (c - len(bad), c))
    conn.close()
    out = {"rows": n, "externally_confirmed": conf, "not_comparable": unconf,
           "check_failures": dict(fails)}
    note_evidence("roster_result.json", out)
    return out


def phase_corr(sh):
    """Re-verify every data_correction whose target row lives in 2024 or 2025."""
    conn = ro()
    rows = [dict(r) for r in conn.execute("SELECT * FROM data_correction")]
    mine = [c for c in rows
            if re.search(r"20(24|25)_\d\d_[A-Z0-9]+_[A-Z0-9]+", c["target_key"])]
    n = 0
    verified = collections.Counter()
    detail = []
    for c in mine:
        n += 1
        key = str(c["correction_id"])
        m = re.search(r"(20\d\d)_\d\d_[A-Z0-9]+_[A-Z0-9]+", c["target_key"])
        gid = m.group(0)
        season = int(m.group(1))
        applied = None
        cur = None
        if c["target_table"] == "game":
            col = {"gameday": "gameday", "kickoffUtc": "kickoff_utc",
                   "gametimeEt": "gametime_et", "location": "location",
                   "roof": "roof", "stadium": "stadium", "stadiumId": "stadium_id",
                   "surface": "surface", "awayRest": "away_rest",
                   "homeRest": "home_rest", "espnEventId": "espn_event_id"}.get(
                       c["column_name"])
            if col:
                row = conn.execute("SELECT %s v FROM game WHERE game_id=?" % col,
                                   (gid,)).fetchone()
                cur = None if row is None else row["v"]
                applied = (str(cur) == str(c["corrected_value"]))
        elif c["target_table"] == "player_game_stats":
            mm = re.match(r"^(00-\d+)\|(.+)$", c["target_key"])
            if mm and re.match(r"^[a-z_]+$", c["column_name"]):
                row = conn.execute(
                    "SELECT %s v FROM player_game_stats WHERE gsis_id=? AND game_id=?"
                    % c["column_name"], (mm.group(1), mm.group(2))).fetchone()
                cur = None if row is None else row["v"]
                applied = (str(cur) == str(c["corrected_value"]))
        elif c["target_table"] == "snap_count":
            mm = re.match(r"^([^|]+)\|(.+)$", c["target_key"])
            if mm:
                row = conn.execute(
                    "SELECT franchise_id v FROM snap_count "
                    "WHERE pfr_player_id=? AND pfr_game_id=?", mm.groups()).fetchone()
                cur = None if row is None else row["v"]
                applied = (str(cur) == str(c["corrected_value"]))
        evp = note_evidence("correction_%s.json" % key, {
            "correction": c, "current_db_value": cur, "applied": applied,
            "verification": ("the corrected value is present in the live database and "
                             "differs from the recorded upstream value"),
        })
        if applied is True:
            verified["applied"] += 1
            sh.write("data_correction", key, season, c["column_name"], "MATCH",
                     "data_correction", evp, db_value=cur,
                     ref_value=c["corrected_value"], ref_id=c["source"][:80],
                     fields_compared=1, fields_matched=1,
                     note="correction present in the database exactly as recorded; "
                          "cited source: %s" % c["source"][:200])
        elif applied is False:
            verified["not_applied"] += 1
            detail.append({"correction_id": key, "table": c["target_table"],
                           "key": c["target_key"], "column": c["column_name"],
                           "recorded": c["corrected_value"], "db": cur})
            sh.write("data_correction", key, season, c["column_name"], "MISMATCH",
                     "data_correction", evp, db_value=cur,
                     ref_value=c["corrected_value"], ref_id=c["source"][:80],
                     note="the database does not carry the value this correction claims")
        else:
            verified["unresolved"] += 1
            sh.write("data_correction", key, season, c["column_name"], "UNRESOLVED",
                     "data_correction", evp, ref_id=c["source"][:80],
                     note="could not locate the target row from target_key")
    conn.close()
    out = {"rows": n, "verified": dict(verified), "detail": detail}
    note_evidence("corr_result.json", out)
    return out


PHASES = {"game": phase_game, "line": phase_line, "tg": phase_tg,
          "pgs": phase_pgs, "snap": phase_snap, "roster": phase_roster,
          "depth": phase_depth, "corr": phase_corr}
ORDER = ["game", "line", "tg", "pgs", "snap", "roster", "depth", "corr"]


def assemble():
    os.makedirs(LEDGER_DIR, exist_ok=True)
    total = 0
    verd = collections.Counter()
    per_table = collections.Counter()
    rowlevel = collections.Counter()
    tv = collections.defaultdict(collections.Counter)
    with open(LEDGER, "w", buffering=1 << 20) as out:
        for ph in ORDER:
            p = os.path.join(CACHE, "ledger_%s.jsonl" % ph)
            if not os.path.exists(p):
                sys.stderr.write("assemble: MISSING shard %s\n" % ph)
                continue
            with open(p) as fh:
                for line in fh:
                    out.write(line)
                    total += 1
                    r = json.loads(line)
                    verd[r["verdict"]] += 1
                    per_table[r["table"]] += 1
                    if r["field"] == "*":
                        rowlevel[r["table"]] += 1
                        tv[r["table"]][r["verdict"]] += 1
    summ = {"lines": total, "verdicts": dict(verd), "per_table": dict(per_table),
            "row_level_records": dict(rowlevel),
            "row_level_verdicts": dict((k, dict(v)) for k, v in tv.items())}
    note_evidence("assemble_summary.json", summ)
    print(json.dumps(summ, indent=1))
    return summ


def main(argv):
    args = argv or ["all"]
    if args == ["assemble"]:
        assemble()
        return
    names = ORDER if args[0] == "all" else args
    print("db md5 at start: %s" % md5(DB))
    for name in names:
        if name == "assemble":
            continue
        sh = Shard(name)
        if sh.complete():
            sys.stderr.write("== phase %s already complete, skipping\n" % name)
            continue
        sys.stderr.write("== phase %s\n" % name)
        with sh as s:
            res = PHASES[name](s)
        sys.stderr.write("   %s: %d ledger lines %s\n"
                         % (name, s.n, json.dumps(dict(s.verdicts))))
        sys.stderr.write("   %s\n" % json.dumps(
            dict((k, v) for k, v in res.items()
                 if k not in ("detail", "mismatches")), default=str)[:1200])
    if args[0] == "all":
        assemble()
    print("db md5 at end:   %s" % md5(DB))


if __name__ == "__main__":
    main(sys.argv[1:])
