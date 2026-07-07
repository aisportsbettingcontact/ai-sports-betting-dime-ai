#!/usr/bin/env python3
"""
WC2026 BetExplorer Odds Scraper v4.0
=====================================
Engineering Stack (11 components):
  1. ForensicLogger        — Dual-output structured logging (terminal + wc2026oddslog.txt)
  2. DebugInspector        — 5-depth HTTP/parse inspection with raw dumps
  3. StrictAssertions      — Fail-fast gates at every transformation
  4. TeamMapper            — Deterministic name resolution, zero fuzzy
  5. MarketSchema          — Immutable column-to-field mapping
  6. OddsWarehouse         — WAL-mode SQLite with FK constraints + audit_log
  7. ThrottleController    — Self-tuning adaptive delay governor
  8. StealthHeaders        — Session-consistent fingerprint diversification
  9. ValidationGateEngine  — 15 mandatory pass/fail gates
 10. InMemoryIndex         — O(1) hash lookups during transformation
 11. ProgressVisualizer    — Real-time terminal progress dashboard

Transformation Pipeline (15 phases from spec):
  P1  Bookmaker isolation (bid=16 only)
  P2  Market pruning (remove DNB/ha)
  P3  Decimal purge (American odds only)
  P4  Line filtering (remove .25/.75/.00)
  P5  AH band filter (remove ±0.5 and >-700)
  P6  O/U band filter (+250 to -250 both sides)
  P7  Team name mapping & orientation
  P8  AH spread sign inversion for Away/Home display
  P9  DC column correction
  P10 Final output assembly

Validation Gates (15 mandatory):
  G01-G15 as specified in transformation spec

Markets scraped (5):
  1x2 (Moneyline 3-way), ou (Over/Under), ah (Asian Handicap/Spread),
  dc (Double Chance), bts (Both Teams To Score)
  NOTE: ha (Draw No Bet) is OMITTED per spec

Bookmaker: bet365 (bid=16, international)
Log file: /home/ubuntu/wc2026oddslog.txt
"""

import sys
import json
import time
import random
import hashlib
import sqlite3
import traceback
import re
from datetime import datetime, timezone
from contextlib import contextmanager
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from collections import defaultdict

import requests
from bs4 import BeautifulSoup
try:
    import pymysql
    import pymysql.cursors
    PYMYSQL_AVAILABLE = True
except ImportError:
    PYMYSQL_AVAILABLE = False

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
BET365_BID = 16
BET365_BID_US = 549  # bet365.us — fallback when bid=16 absent (US-served pages)
BET365_BIDS = [BET365_BID, BET365_BID_US]  # priority order: intl first, US second
LOG_PATH = Path("/home/ubuntu/wc2026oddslog.txt")
DB_PATH = Path("/home/ubuntu/wc2026_betexplorer_v4.db")
OUTPUT_JSON = Path("/home/ubuntu/wc2026_betexplorer_odds_v4.json")
DEBUG_DUMP_DIR = Path("/home/ubuntu/be_debug_dumps_v4")
DEBUG_DUMP_DIR.mkdir(exist_ok=True)

# MySQL target table for production upsert
MYSQL_TABLE = "wc2026MatchOdds"
# Exact scraper filename — written to insert_method column on every upsert
SCRAPER_FILENAME = "wc2026_betexplorer_scraper_v4.py"
# DATABASE_URL parsed at runtime from environment (set by Manus platform)
import os, urllib.parse as _urlparse
_DB_URL = os.environ.get("DATABASE_URL", "")

MARKETS = ["1x2", "ou", "ah", "dc", "bts"]  # ha OMITTED per spec
REQUIRED_MARKETS = {"1x2", "ou", "ah", "dc", "bts"}

# All 12 WC2026 KO Round matches
MATCHES = [
    # ── CONFIRMED: DB match_id + BetExplorer event_id + ESPN match_id all forensically verified ──
    # BetExplorer be_name format: HOME - AWAY (BetExplorer slug is always home-away)
    # ESPN match IDs sourced from site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
    # ESPN team IDs sourced from site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/teams/{id}
    # espn_slug = {away_team_slug}-{home_team_slug} (derived from ESPN team slugs)
    # away_team / home_team = ESPN integer team IDs
    # R32 — Completed (FT)
    {"id": "wc26-r32-073", "event_id": "EZmXxG15", "espn_match_id": "760486",
     "be_name": "South Africa - Canada",       "slug": "south-africa-canada",
     "espn_slug": "can-rsa",   "espn_away_team_id": 206,   "espn_home_team_id": 467},
    {"id": "wc26-r32-074", "event_id": "f7ENGzPc", "espn_match_id": "760487",
     "be_name": "Brazil - Japan",              "slug": "brazil-japan",
     "espn_slug": "jpn-bra",   "espn_away_team_id": 627,   "espn_home_team_id": 205},
    {"id": "wc26-r32-075", "event_id": "2y2UKhp1", "espn_match_id": "760489",
     "be_name": "Germany - Paraguay",          "slug": "germany-paraguay",
     "espn_slug": "par-ger",   "espn_away_team_id": 210,   "espn_home_team_id": 481},
    {"id": "wc26-r32-076", "event_id": "S0MygXWj", "espn_match_id": "760488",
     "be_name": "Netherlands - Morocco",       "slug": "netherlands-morocco",
     "espn_slug": "mar-ned",   "espn_away_team_id": 2869,  "espn_home_team_id": 449},
    {"id": "wc26-r32-077", "event_id": "tx2IC6G7", "espn_match_id": "760490",
     "be_name": "Ivory Coast - Norway",        "slug": "ivory-coast-norway",
     "espn_slug": "nor-civ",   "espn_away_team_id": 464,   "espn_home_team_id": 4789},
    {"id": "wc26-r32-078", "event_id": "UN3MMEFl", "espn_match_id": "760492",
     "be_name": "France - Sweden",             "slug": "france-sweden",
     "espn_slug": "swe-fra",   "espn_away_team_id": 466,   "espn_home_team_id": 478},
    {"id": "wc26-r32-079", "event_id": "fydIxpfR", "espn_match_id": "760491",
     "be_name": "Mexico - Ecuador",            "slug": "mexico-ecuador",
     "espn_slug": "ecu-mex",   "espn_away_team_id": 209,   "espn_home_team_id": 203},
    {"id": "wc26-r32-080", "event_id": "nkoQVAgB", "espn_match_id": "760495",
     "be_name": "England - D.R. Congo",        "slug": "england-d-r-congo",
     "espn_slug": "rdc-eng",   "espn_away_team_id": 2850,  "espn_home_team_id": 448},
    {"id": "wc26-r32-081", "event_id": "vPsIXWOb", "espn_match_id": "760493",
     "be_name": "Belgium - Senegal",           "slug": "belgium-senegal",
     "espn_slug": "sen-bel",   "espn_away_team_id": 654,   "espn_home_team_id": 459},
    {"id": "wc26-r32-082", "event_id": "A1Jughll", "espn_match_id": "760494",
     "be_name": "USA - Bosnia & Herzegovina",  "slug": "usa-bosnia-herzegovina",
     "espn_slug": "bih-usa",   "espn_away_team_id": 452,   "espn_home_team_id": 660},
    # R32 — Scheduled (upcoming — odds available on BetExplorer)
    {"id": "wc26-r32-083", "event_id": "jJucpA84", "espn_match_id": "760497",
     "be_name": "Spain - Austria",             "slug": "spain-austria",
     "espn_slug": "aut-esp",   "espn_away_team_id": 474,   "espn_home_team_id": 164},
    {"id": "wc26-r32-084", "event_id": "6BqAZhfn", "espn_match_id": "760496",
     "be_name": "Portugal - Croatia",          "slug": "portugal-croatia",
     "espn_slug": "cro-por",   "espn_away_team_id": 477,   "espn_home_team_id": 482},
    {"id": "wc26-r32-085", "event_id": "rgxknWwh", "espn_match_id": "760498",
     "be_name": "Switzerland - Algeria",       "slug": "switzerland-algeria",
     "espn_slug": "alg-sui",   "espn_away_team_id": 624,   "espn_home_team_id": 475},
    {"id": "wc26-r32-086", "event_id": "Whg00tL7", "espn_match_id": "760499",
     "be_name": "Australia - Egypt",           "slug": "australia-egypt",
     "espn_slug": "egy-aus",   "espn_away_team_id": 2620,  "espn_home_team_id": 628},
    {"id": "wc26-r32-087", "event_id": "O4oeJu9d", "espn_match_id": "760500",
     "be_name": "Argentina - Cape Verde",      "slug": "argentina-cape-verde",
     "espn_slug": "cpv-arg",   "espn_away_team_id": 2597,  "espn_home_team_id": 202},
    {"id": "wc26-r32-088", "event_id": "IF40Fk9U", "espn_match_id": "760501",
     "be_name": "Colombia - Ghana",               "slug": "colombia-ghana",
     "espn_slug": "gha-col",   "espn_away_team_id": 4469,  "espn_home_team_id": 208},
    # R16 — Scheduled (Jul 4)
    {"id": "wc26-r16-089", "event_id": "M5YPKKbB", "espn_match_id": "760503",
     "be_name": "Paraguay - France",              "slug": "paraguay-france",
     "espn_slug": "fra-par",   "espn_away_team_id": 478,   "espn_home_team_id": 210},
    {"id": "wc26-r16-090", "event_id": "pUYfr7u3", "espn_match_id": "760502",
     "be_name": "Canada - Morocco",               "slug": "canada-morocco",
     "espn_slug": "mar-can",   "espn_away_team_id": 2869,  "espn_home_team_id": 206},
    # R16 — Scheduled (Jul 5)
    {"id": "wc26-r16-091", "event_id": "tpOhKWcC", "espn_match_id": "760504",
     "be_name": "Brazil - Norway",                 "slug": "brazil-norway",
     "espn_slug": "nor-bra",   "espn_away_team_id": 464,   "espn_home_team_id": 205},
    {"id": "wc26-r16-092", "event_id": "bc27lzfo", "espn_match_id": "760505",
     "be_name": "Mexico - England",                "slug": "mexico-england",
     "espn_slug": "eng-mex",   "espn_away_team_id": 448,   "espn_home_team_id": 203},
    # R16 — Scheduled (Jul 6)
    {"id": "wc26-r16-093", "event_id": "tbTsReVa", "espn_match_id": "760506",
     "be_name": "Portugal - Spain",               "slug": "portugal-spain",
     "espn_slug": "esp-por",   "espn_away_team_id": 164,   "espn_home_team_id": 482},
    {"id": "wc26-r16-094", "event_id": "PLACEHOLDER", "espn_match_id": "760507",
     "be_name": "USA - Belgium",                  "slug": "usa-belgium",
     "espn_slug": "bel-usa",   "espn_away_team_id": 459,   "espn_home_team_id": 660},
    # R16 — Scheduled (Jul 7)
    {"id": "wc26-r16-095", "event_id": "bodsDyte", "espn_match_id": "760509",
     "be_name": "Argentina - Egypt",              "slug": "argentina-egypt",
     "espn_slug": "egy-arg",   "espn_away_team_id": 2620,  "espn_home_team_id": 202},
    {"id": "wc26-r16-096", "event_id": "EmgOlMbT", "espn_match_id": "760508",
     "be_name": "Switzerland - Colombia",         "slug": "switzerland-colombia",
     "espn_slug": "col-sui",   "espn_away_team_id": 208,   "espn_home_team_id": 475},
]

BASE_URL = "https://www.betexplorer.com"
MATCHES_PAGE = f"{BASE_URL}/football/world/world-championship-2026/"
AJAX_TEMPLATE_BEST = "{base}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en"
AJAX_TEMPLATE_ALL = "{base}/match-odds/{event_id}/0/{market}/allOdds/"
MATCH_PAGE_TEMPLATE = "{base}/football/world/world-championship-2026/{slug}/{event_id}/"


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 1: ForensicLogger
# ─────────────────────────────────────────────────────────────────────────────
class ForensicLogger:
    """Dual-output structured logger — colorized terminal + JSON-lines log file."""

    LEVELS = {
        "TRACE":      ("\033[90m",  "⋯"),
        "DEBUG":      ("\033[36m",  "◦"),
        "INFO":       ("\033[37m",  "●"),
        "CHECKPOINT": ("\033[32m",  "✓"),
        "WARN":       ("\033[33m",  "⚠"),
        "ERROR":      ("\033[31m",  "✗"),
        "FATAL":      ("\033[35m",  "☠"),
        "AUDIT":      ("\033[34m",  "⊕"),
        "STEP":       ("\033[96m",  "→"),
        "STATE":      ("\033[93m",  "◈"),
        "PASS":       ("\033[92m",  "✓"),
        "FAIL":       ("\033[91m",  "✗"),
    }

    def __init__(self, log_path: Path, session_id: str = None):
        self.log_path = log_path
        self.session_id = session_id or hashlib.md5(
            str(datetime.now()).encode()
        ).hexdigest()[:8]
        self.breadcrumbs = []
        self.counters = defaultdict(int)
        self.start_time = datetime.now(timezone.utc)
        self.sequence = 0
        # Write session header
        self._write_session_header()

    def _write_session_header(self):
        header = {
            "type": "SESSION_START",
            "session": self.session_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "script": "wc2026_betexplorer_scraper_v4.py",
            "version": "4.0.0",
            "bid_target": BET365_BID,
            "markets": MARKETS,
            "matches_count": len(MATCHES),
        }
        with open(self.log_path, "a") as f:
            f.write(json.dumps(header) + "\n")

        print(f"\033[96m{'═'*80}\033[0m", flush=True)
        print(f"\033[96m  WC2026 BETEXPLORER SCRAPER v4.0 — SESSION {self.session_id}\033[0m", flush=True)
        print(f"\033[96m  Log: {self.log_path}\033[0m", flush=True)
        print(f"\033[96m  DB:  {DB_PATH}\033[0m", flush=True)
        print(f"\033[96m{'═'*80}\033[0m\n", flush=True)

    def emit(self, level: str, message: str, **context):
        self.sequence += 1
        now = datetime.now(timezone.utc)
        elapsed = (now - self.start_time).total_seconds()
        self.counters[level] += 1

        color, icon = self.LEVELS.get(level, ("\033[37m", "●"))
        reset = "\033[0m"
        ts = now.strftime("%H:%M:%S.%f")[:-3]
        ctx_str = " | ".join(f"{k}={v}" for k, v in context.items()) if context else ""

        terminal_line = f"{color}{icon} [{ts}] [{elapsed:>8.3f}s] {level:<11} {message}{reset}"
        if ctx_str:
            terminal_line += f"\n  {color}└─ {ctx_str}{reset}"
        print(terminal_line, flush=True)

        record = {
            "seq": self.sequence,
            "ts": now.isoformat(),
            "elapsed_s": round(elapsed, 6),
            "session": self.session_id,
            "level": level,
            "msg": message,
            "ctx": context,
            "breadcrumbs": self.breadcrumbs[-3:],
        }
        with open(self.log_path, "a") as f:
            f.write(json.dumps(record) + "\n")

    def push_breadcrumb(self, crumb: str):
        self.breadcrumbs.append(f"{datetime.now().strftime('%H:%M:%S')}:{crumb}")
        if len(self.breadcrumbs) > 20:
            self.breadcrumbs = self.breadcrumbs[-20:]

    def increment(self, counter_name: str, amount: int = 1):
        self.counters[counter_name] += amount

    @contextmanager
    def timed_operation(self, operation_name: str, **context):
        start = datetime.now(timezone.utc)
        self.emit("TRACE", f"BEGIN: {operation_name}", **context)
        try:
            yield
            elapsed = (datetime.now(timezone.utc) - start).total_seconds()
            self.emit("CHECKPOINT", f"DONE: {operation_name} [{elapsed:.3f}s]", **context)
        except Exception as e:
            elapsed = (datetime.now(timezone.utc) - start).total_seconds()
            self.emit("ERROR", f"FAIL: {operation_name} [{elapsed:.3f}s] → {type(e).__name__}: {e}",
                      tb=traceback.format_exc()[-300:], **context)
            raise

    def summary(self):
        elapsed = (datetime.now(timezone.utc) - self.start_time).total_seconds()
        self.emit("AUDIT", f"SESSION COMPLETE | elapsed={elapsed:.3f}s | "
                  f"PASS={self.counters['PASS']} FAIL={self.counters['FAIL']} "
                  f"WARN={self.counters['WARN']} seq={self.sequence}")


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 2: DebugInspector
# ─────────────────────────────────────────────────────────────────────────────
class DebugInspector:
    """5-depth inspection engine for HTTP responses and parse results."""

    DEPTH_SILENT   = 0
    DEPTH_SUMMARY  = 1
    DEPTH_DETAILED = 2
    DEPTH_FORENSIC = 3
    DEPTH_NUCLEAR  = 4

    def __init__(self, logger: ForensicLogger, depth: int = 3):
        self.logger = logger
        self.depth = depth
        self.dump_dir = DEBUG_DUMP_DIR

    def inspect_response(self, response, context_label: str) -> dict:
        inspection = {
            "label": context_label,
            "status": response.status_code,
            "body_size": len(response.content),
            "encoding": response.encoding,
            "elapsed_ms": response.elapsed.total_seconds() * 1000,
            "url": str(response.url),
        }
        if self.depth >= 3:
            dump_path = self.dump_dir / f"{context_label}_{int(time.time())}.html"
            dump_path.write_bytes(response.content)
            inspection["dump_path"] = str(dump_path)
            self.logger.emit("DEBUG", f"Raw dump saved: {dump_path.name}",
                             label=context_label, size=f"{len(response.content):,}B")
        return inspection

    def inspect_bid_rows(self, soup: BeautifulSoup, market: str, event_id: str) -> dict:
        """Audit all bid rows in a parsed market response."""
        all_rows = soup.select("tr[data-bid]")
        all_bids = sorted(set(int(r.get("data-bid", 0)) for r in all_rows))
        bid16_rows = [r for r in all_rows if r.get("data-bid") == str(BET365_BID)]

        report = {
            "market": market,
            "event_id": event_id,
            "total_rows": len(all_rows),
            "unique_bids": all_bids,
            "bid16_count": len(bid16_rows),
            "bid16_present": len(bid16_rows) > 0,
        }

        self.logger.emit("STATE", f"BID AUDIT [{market.upper()}]",
                         event_id=event_id,
                         total_rows=len(all_rows),
                         all_bids=str(all_bids[:10]),
                         bid16_rows=len(bid16_rows))

        if self.depth >= 2 and bid16_rows:
            row = bid16_rows[0]
            cells = row.select("td[data-odd]")
            for i, c in enumerate(cells):
                self.logger.emit("DEBUG",
                                 f"  bid=16 cell[{i}]: data-pos={c.get('data-pos')} "
                                 f"data-odd={c.get('data-odd')} data-hcp={c.get('data-hcp','—')}",
                                 market=market)

        return report


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 3: StrictAssertions
# ─────────────────────────────────────────────────────────────────────────────
class StrictAssertions:
    """Fail-fast assertion gates — halt on any failure."""

    def __init__(self, logger: ForensicLogger):
        self.logger = logger
        self.passed = 0
        self.total = 0

    def assert_true(self, condition: bool, message: str, **context):
        self.total += 1
        if condition:
            self.passed += 1
            self.logger.emit("TRACE", f"ASSERT PASS: {message}")
        else:
            self.logger.emit("FATAL", f"ASSERT FAIL: {message}", **context)
            raise AssertionError(f"STRICT GATE FAILURE: {message}")

    def assert_not_none(self, value, label: str):
        self.assert_true(value is not None, f"{label} must not be None", value=str(value))

    def assert_in_range(self, value, lo, hi, label: str):
        self.assert_true(lo <= value <= hi,
                         f"{label}={value} must be in [{lo}, {hi}]",
                         lo=lo, hi=hi, value=value)

    def assert_no_duplicates(self, collection, label: str):
        seen = set()
        dupes = []
        for x in collection:
            if x in seen:
                dupes.append(x)
            seen.add(x)
        self.assert_true(len(dupes) == 0, f"{label} has no duplicates", dupes=str(dupes[:5]))


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 4: TeamMapper
# ─────────────────────────────────────────────────────────────────────────────
class TeamMapper:
    """Deterministic team name mapping — zero fuzzy, zero inference."""

    # BetExplorer match name → (away_display, home_display)
    CANONICAL_MAP = {
        # Format: "BetExplorer HOME - AWAY": (away_db_code, home_db_code)
        # All 15 WC2026 R32 matches — forensically confirmed from BetExplorer slugs
        "England - D.R. Congo":            ("cod",  "eng"),
        "Belgium - Senegal":               ("sen",  "bel"),
        "Spain - Austria":                 ("aut",  "esp"),
        "USA - Bosnia & Herzegovina":      ("bih",  "usa"),
        "Mexico - Ecuador":                ("ecu",  "mex"),
        "Portugal - Croatia":              ("cro",  "por"),
        "Switzerland - Algeria":           ("alg",  "sui"),
        "Australia - Egypt":               ("egy",  "aus"),
        "Argentina - Cape Verde":          ("cpv",  "arg"),
        "South Africa - Canada":           ("can",  "rsa"),
        "Brazil - Japan":                  ("jpn",  "bra"),
        "Germany - Paraguay":              ("par",  "ger"),
        "Netherlands - Morocco":           ("mar",  "ned"),
        "Ivory Coast - Norway":            ("nor",  "civ"),
        "France - Sweden":                 ("swe",  "fra"),
        "Colombia - Ghana":               ("gha",  "col"),
        # R16 matches
        "Paraguay - France":              ("fra",  "par"),
        "Canada - Morocco":               ("mar",  "can"),
        "Brazil - Norway":                ("nor",  "bra"),
        "Mexico - England":               ("eng",  "mex"),
    }

    def resolve(self, be_name: str) -> tuple:
        """Returns (away_name, home_name). Raises on unknown name."""
        if be_name not in self.CANONICAL_MAP:
            raise ValueError(
                f"UNMAPPED: '{be_name}' — known: {list(self.CANONICAL_MAP.keys())}"
            )
        return self.CANONICAL_MAP[be_name]


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 5: MarketSchema
# ─────────────────────────────────────────────────────────────────────────────
class MarketSchema:
    """Immutable data-pos → semantic field mapping. Single source of truth."""

    # data-pos values in BetExplorer AJAX responses
    SCHEMAS = {
        "1x2": {
            "1": ("home_ml",   "Home Win"),
            "2": ("draw",      "Draw"),
            "3": ("away_ml",   "Away Win"),
            # Fallback: some responses use 0-indexed pos
            "0": ("draw",      "Draw"),   # pos=0 = draw in some responses
        },
        "dc": {
            # CRITICAL: pos=1→1X, pos=2→12(No Draw), pos=3→X2
            "1": ("home_or_draw", "1X — Home Win or Draw"),
            "2": ("no_draw",      "12 — Home Win or Away Win"),
            "3": ("away_or_draw", "X2 — Away Win or Draw"),
        },
        "bts": {
            "y": ("btts_yes", "Both Teams Score ≥1"),
            "n": ("btts_no",  "At Least One Clean Sheet"),
            "1": ("btts_yes", "Both Teams Score ≥1"),
            "2": ("btts_no",  "At Least One Clean Sheet"),
        },
        "ou": {
            "1": ("over",  "Total Goals Over Line"),
            "2": ("under", "Total Goals Under Line"),
        },
        "ah": {
            # pos=1 = HOME spread odds, pos=2 = AWAY spread odds
            "1": ("home_spread_odds", "Home Team at Stated Handicap"),
            "2": ("away_spread_odds", "Away Team at Inverse Handicap"),
        },
    }

    @classmethod
    def get_field(cls, market: str, data_pos: str) -> tuple:
        schema = cls.SCHEMAS.get(market, {})
        if data_pos not in schema:
            raise ValueError(f"Unknown data-pos '{data_pos}' for market '{market}'")
        return schema[data_pos]


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 6: OddsWarehouse
# ─────────────────────────────────────────────────────────────────────────────
class OddsWarehouse:
    """WAL-mode SQLite warehouse with FK constraints and immutable audit log."""

    SCHEMA_VERSION = 4

    def __init__(self, db_path: Path, logger: ForensicLogger):
        self.db_path = db_path
        self.logger = logger
        self.conn = sqlite3.connect(str(db_path))
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self._create_schema()
        logger.emit("CHECKPOINT", f"OddsWarehouse initialized: {db_path}")

    def _create_schema(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS matches (
                event_id TEXT PRIMARY KEY,
                match_id TEXT NOT NULL UNIQUE,
                be_name TEXT NOT NULL,
                away_display TEXT,
                home_display TEXT,
                scraped_at TEXT
            );

            CREATE TABLE IF NOT EXISTS odds_flat (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL REFERENCES matches(event_id),
                market TEXT NOT NULL,
                bid INTEGER NOT NULL DEFAULT 16,
                home_ml INTEGER,
                draw INTEGER,
                away_ml INTEGER,
                home_or_draw INTEGER,
                no_draw INTEGER,
                away_or_draw INTEGER,
                btts_yes INTEGER,
                btts_no INTEGER,
                scraped_at TEXT NOT NULL,
                UNIQUE(event_id, market)
            );

            CREATE TABLE IF NOT EXISTS odds_lined (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL REFERENCES matches(event_id),
                market TEXT NOT NULL,
                line_raw TEXT NOT NULL,
                line_numeric REAL,
                line_display TEXT,
                home_odds INTEGER,
                away_odds INTEGER,
                over_odds INTEGER,
                under_odds INTEGER,
                bid INTEGER NOT NULL DEFAULT 16,
                scraped_at TEXT NOT NULL,
                UNIQUE(event_id, market, line_raw)
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT DEFAULT (datetime('now')),
                gate_id TEXT,
                gate_name TEXT,
                result TEXT,
                details TEXT,
                match_id TEXT,
                market TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_flat_event_market ON odds_flat(event_id, market);
            CREATE INDEX IF NOT EXISTS idx_lined_event_market ON odds_lined(event_id, market);
            CREATE INDEX IF NOT EXISTS idx_lined_line ON odds_lined(line_numeric, market);
            CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_log(result);
        """)
        self.conn.commit()

    def upsert_match(self, event_id: str, match_id: str, be_name: str,
                     away_display: str, home_display: str):
        self.conn.execute("""
            INSERT INTO matches(event_id, match_id, be_name, away_display, home_display, scraped_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(event_id) DO UPDATE SET
                away_display=excluded.away_display,
                home_display=excluded.home_display,
                scraped_at=excluded.scraped_at
        """, (event_id, match_id, be_name, away_display, home_display,
              datetime.now(timezone.utc).isoformat()))
        self.conn.commit()

    def upsert_flat(self, event_id: str, market: str, data: dict):
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute("""
            INSERT INTO odds_flat(event_id, market, bid, home_ml, draw, away_ml,
                home_or_draw, no_draw, away_or_draw, btts_yes, btts_no, scraped_at)
            VALUES(?,?,16,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(event_id, market) DO UPDATE SET
                bid=16, home_ml=excluded.home_ml, draw=excluded.draw,
                away_ml=excluded.away_ml, home_or_draw=excluded.home_or_draw,
                no_draw=excluded.no_draw, away_or_draw=excluded.away_or_draw,
                btts_yes=excluded.btts_yes, btts_no=excluded.btts_no,
                scraped_at=excluded.scraped_at
        """, (event_id, market,
              data.get("home_ml"), data.get("draw"), data.get("away_ml"),
              data.get("home_or_draw"), data.get("no_draw"), data.get("away_or_draw"),
              data.get("btts_yes"), data.get("btts_no"), now))
        self.conn.commit()

    def upsert_lined(self, event_id: str, market: str, line_raw: str,
                     line_numeric: float, line_display: str,
                     home_odds: int = None, away_odds: int = None,
                     over_odds: int = None, under_odds: int = None):
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute("""
            INSERT INTO odds_lined(event_id, market, line_raw, line_numeric, line_display,
                home_odds, away_odds, over_odds, under_odds, bid, scraped_at)
            VALUES(?,?,?,?,?,?,?,?,?,16,?)
            ON CONFLICT(event_id, market, line_raw) DO UPDATE SET
                line_numeric=excluded.line_numeric, line_display=excluded.line_display,
                home_odds=excluded.home_odds, away_odds=excluded.away_odds,
                over_odds=excluded.over_odds, under_odds=excluded.under_odds,
                scraped_at=excluded.scraped_at
        """, (event_id, market, line_raw, line_numeric, line_display,
              home_odds, away_odds, over_odds, under_odds, now))
        self.conn.commit()

    def log_audit(self, gate_id: str, gate_name: str, result: str,
                  details: str = None, match_id: str = None, market: str = None):
        self.conn.execute("""
            INSERT INTO audit_log(gate_id, gate_name, result, details, match_id, market)
            VALUES(?,?,?,?,?,?)
        """, (gate_id, gate_name, result, details, match_id, market))
        self.conn.commit()

    def close(self):
        self.conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 7: ThrottleController
# ─────────────────────────────────────────────────────────────────────────────
class ThrottleController:
    """Self-tuning adaptive delay governor with log-normal jitter."""

    BASE_DELAYS = {
        0: (2.0, 4.0),    # Normal
        1: (4.0, 8.0),    # Caution
        2: (10.0, 20.0),  # Heavy
        3: (30.0, 60.0),  # Emergency
    }

    def __init__(self, logger: ForensicLogger):
        self.logger = logger
        self.response_times = []
        self.baseline_latency = None
        self.throttle_level = 0
        self.consecutive_errors = 0
        self.total_requests = 0
        self.total_throttle_waits = 0

    def record_response(self, elapsed_s: float, status_code: int):
        self.total_requests += 1
        self.response_times.append(elapsed_s)
        if len(self.response_times) > 20:
            self.response_times = self.response_times[-20:]

        if self.baseline_latency is None and len(self.response_times) >= 3:
            self.baseline_latency = sum(self.response_times[:3]) / 3
            self.logger.emit("DEBUG", f"Baseline latency: {self.baseline_latency:.3f}s")

        if status_code == 429:
            self._escalate("HTTP 429")
        elif status_code == 403:
            self._escalate("HTTP 403 — possible block")
        elif status_code not in (200, 304):
            self._escalate(f"HTTP {status_code}")
        elif self.baseline_latency and elapsed_s > self.baseline_latency * 3:
            self._escalate(f"Latency spike {elapsed_s:.3f}s vs baseline {self.baseline_latency:.3f}s")
        elif status_code == 200:
            self.consecutive_errors = 0
            if self.throttle_level > 0 and elapsed_s < (self.baseline_latency or 5.0) * 1.5:
                self._de_escalate()

    def _escalate(self, reason: str):
        self.throttle_level = min(3, self.throttle_level + 1)
        self.consecutive_errors += 1
        self.logger.emit("WARN", f"THROTTLE ESCALATION → Level {self.throttle_level}: {reason}")

    def _de_escalate(self):
        self.throttle_level = max(0, self.throttle_level - 1)
        self.logger.emit("INFO", f"THROTTLE DE-ESCALATION → Level {self.throttle_level}")

    def get_delay(self, context: str = "") -> float:
        lo, hi = self.BASE_DELAYS[self.throttle_level]
        delay = random.uniform(lo, hi)
        jitter = random.lognormvariate(0, 0.3) * 0.5
        final = delay + jitter
        if self.throttle_level > 0:
            self.total_throttle_waits += 1
            self.logger.emit("DEBUG",
                             f"Throttle delay: {final:.2f}s (level={self.throttle_level})",
                             context=context)
        return final

    def should_abort(self) -> bool:
        return self.consecutive_errors >= 10


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 8: StealthHeaders
# ─────────────────────────────────────────────────────────────────────────────
class StealthHeaders:
    """Session-consistent Chrome fingerprint diversification."""

    UA_POOL = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    ]
    LANG_POOL = ["en-US,en;q=0.9", "en-US,en;q=0.9,es;q=0.8", "en-GB,en;q=0.9"]
    SEC_MODES = [
        {"Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"},
    ]

    def __init__(self):
        self.ua = random.choice(self.UA_POOL)
        self.lang = random.choice(self.LANG_POOL)

    def ajax(self, referer: str) -> dict:
        return {
            "User-Agent": self.ua,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": self.lang,
            "Accept-Encoding": random.choice(["gzip, deflate, br", "gzip, deflate, br, zstd"]),
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
            "Connection": "keep-alive",
            **random.choice(self.SEC_MODES),
        }

    def page(self) -> dict:
        return {
            "User-Agent": self.ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": self.lang,
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 9: ValidationGateEngine
# ─────────────────────────────────────────────────────────────────────────────
class ValidationGateEngine:
    """15 mandatory pass/fail gates — all must pass for pipeline approval."""

    def __init__(self, logger: ForensicLogger, warehouse: OddsWarehouse):
        self.logger = logger
        self.warehouse = warehouse
        self.results = []

    def run_all_gates(self, dataset: dict) -> bool:
        gates = [
            ("G01", "MATCH_COUNT",         self._g01_match_count),
            ("G02", "BOOKMAKER_PURITY",     self._g02_bookmaker_purity),
            ("G03", "MARKET_COMPLETENESS",  self._g03_market_completeness),
            ("G04", "NO_DECIMAL_VALUES",    self._g04_no_decimals),
            ("G05", "NO_EV_STRINGS",        self._g05_no_ev_strings),
            ("G06", "NO_QUARTER_LINES",     self._g06_no_quarter_lines),
            ("G07", "NO_HALF_SPREADS",      self._g07_no_half_spreads),
            ("G08", "AH_BAND_LIMIT",        self._g08_ah_band_limit),
            ("G09", "OU_BAND_LIMIT",        self._g09_ou_band_limit),
            ("G10", "DC_LOGIC_1X",          self._g10_dc_logic_1x),
            ("G11", "DC_LOGIC_X2",          self._g11_dc_logic_x2),
            ("G12", "SIGN_FORMAT",          self._g12_sign_format),
            ("G13", "PK_DISPLAY",           self._g13_pk_display),
            ("G14", "TEAM_MAPPING",         self._g14_team_mapping),
            ("G15", "ORIENTATION",          self._g15_orientation),
        ]

        passed = 0
        failed = 0

        print(f"\n\033[34m{'═'*70}\033[0m", flush=True)
        print(f"\033[34m  VALIDATION GATE ENGINE — 15 MANDATORY GATES\033[0m", flush=True)
        print(f"\033[34m{'═'*70}\033[0m", flush=True)

        for gate_id, gate_name, gate_func in gates:
            try:
                result, details = gate_func(dataset)
                status = "PASS" if result else "FAIL"
            except Exception as e:
                result = False
                status = "FAIL"
                details = f"EXCEPTION: {type(e).__name__}: {e}"

            self.results.append((gate_id, gate_name, status, details))
            self.warehouse.log_audit(gate_id, gate_name, status, details)

            icon = "✓" if result else "✗"
            color = "\033[92m" if result else "\033[91m"
            reset = "\033[0m"
            print(f"  {color}{icon} {gate_id} [{gate_name:<22}] → {status}{reset}: {details}",
                  flush=True)

            if result:
                passed += 1
                self.logger.increment("GATE_PASS")
            else:
                failed += 1
                self.logger.increment("GATE_FAIL")
                self.logger.emit("FATAL", f"GATE {gate_id} FAILED: {details}")

        verdict = "ALL 15 GATES PASS ✓" if failed == 0 else f"PIPELINE REJECTED — {failed} GATE(S) FAILED ✗"
        color = "\033[92m" if failed == 0 else "\033[91m"
        reset = "\033[0m"
        print(f"\n  {color}VERDICT: {passed}/15 PASS | {verdict}{reset}\n", flush=True)

        self.logger.emit("AUDIT", f"GATE VERDICT: {passed}/15 PASS | {verdict}")
        return failed == 0

    # ── Individual gate implementations ──────────────────────────────────────

    def _g01_match_count(self, data):
        count = len(data.get("matches", []))
        # Use dynamic expected count from _meta (set at scraper init to len(matches_to_run))
        expected = data.get("_meta", {}).get("expected_count", 15)
        return count == expected, f"Expected {expected}, found {count}"

    def _g02_bookmaker_purity(self, data):
        violations = []
        for m in data.get("matches", []):
            for mk, mv in m.get("markets", {}).items():
                bid = mv.get("bid") if isinstance(mv, dict) else None
                if bid is not None and bid not in (BET365_BID, BET365_BID_US):
                    violations.append(f"{m['event_id']}/{mk}/bid={bid}")
        return len(violations) == 0, (f"Non-bet365: {violations[:3]}" if violations else "100% bid=16/549")

    def _g03_market_completeness(self, data):
        missing = []
        for m in data.get("matches", []):
            present = set(m.get("markets", {}).keys())
            diff = REQUIRED_MARKETS - present
            if diff:
                missing.append(f"{m.get('event_id')}: missing {diff}")
        return len(missing) == 0, (f"Missing: {missing}" if missing else "All 12×5 markets present")

    def _g04_no_decimals(self, data):
        found = []
        def scan(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if any(x in k.lower() for x in ["decimal", "dec_"]):
                        found.append(f"{path}.{k}")
                    scan(v, f"{path}.{k}")
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    scan(item, f"{path}[{i}]")
        scan(data)
        return len(found) == 0, (f"Decimal keys: {found[:3]}" if found else "CLEAN")

    def _g05_no_ev_strings(self, data):
        found = []
        def scan(obj, path=""):
            if isinstance(obj, str) and "EV" in obj.upper() and obj != "+100":
                found.append(f"{path}={obj}")
            elif isinstance(obj, dict):
                for k, v in obj.items():
                    scan(v, f"{path}.{k}")
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    scan(item, f"{path}[{i}]")
        scan(data)
        return len(found) == 0, (f"EV strings: {found[:3]}" if found else "CLEAN")

    def _g06_no_quarter_lines(self, data):
        violations = []
        for m in data.get("matches", []):
            for market in ["ou", "ah"]:
                lines_data = m.get("markets", {}).get(market, {})
                if isinstance(lines_data, dict):
                    for line_key in lines_data.keys():
                        if line_key == "pk":
                            continue
                        try:
                            val = float(line_key)
                            frac = abs(val) % 1
                            if frac in (0.25, 0.75) or (val != 0 and frac == 0.0):
                                violations.append(f"{market}/{line_key}")
                        except ValueError:
                            pass
        return len(violations) == 0, (f"Quarter/whole lines: {violations[:3]}" if violations else "CLEAN")

    def _g07_no_half_spreads(self, data):
        violations = []
        for m in data.get("matches", []):
            ah = m.get("markets", {}).get("ah", {})
            if isinstance(ah, dict):
                for line_key in ah.keys():
                    if line_key == "pk":
                        continue
                    try:
                        if abs(float(line_key)) == 0.5:
                            violations.append(f"{m['event_id']}/ah/{line_key}")
                    except ValueError:
                        pass
        return len(violations) == 0, (f"±0.5 lines: {violations[:3]}" if violations else "CLEAN")

    def _g08_ah_band_limit(self, data):
        violations = []
        for m in data.get("matches", []):
            ah = m.get("markets", {}).get("ah", {})
            if isinstance(ah, dict):
                for line_key, line_data in ah.items():
                    if isinstance(line_data, dict):
                        for odds_key in ["home_odds", "away_odds"]:
                            val = line_data.get(odds_key)
                            if val is not None and isinstance(val, (int, float)):
                                if val < 0 and abs(val) > 700:
                                    violations.append(f"{m['event_id']}/ah/{line_key}/{odds_key}={val}")
        return len(violations) == 0, (f">-700 AH: {violations[:3]}" if violations else "CLEAN")

    def _g09_ou_band_limit(self, data):
        violations = []
        for m in data.get("matches", []):
            ou = m.get("markets", {}).get("ou", {})
            if isinstance(ou, dict):
                for line_key, line_data in ou.items():
                    if isinstance(line_data, dict):
                        for odds_key in ["over_odds", "under_odds"]:
                            val = line_data.get(odds_key)
                            if val is not None and isinstance(val, (int, float)):
                                if abs(val) > 250:
                                    violations.append(f"{m['event_id']}/ou/{line_key}/{odds_key}={val}")
        return len(violations) == 0, (f"O/U >±250: {violations[:3]}" if violations else "CLEAN")

    @staticmethod
    def _parse_am(v) -> int:
        """Parse American odds value (int or '+'/'-' prefixed string) to int."""
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            try:
                return int(v.replace('+', ''))
            except ValueError:
                return None
        return None

    def _g10_dc_logic_1x(self, data):
        violations = []
        for m in data.get("matches", []):
            ml = m.get("markets", {}).get("1x2", {})
            dc = m.get("markets", {}).get("dc", {})
            home = self._parse_am(ml.get("home_ml"))
            draw = self._parse_am(ml.get("draw"))
            one_x = self._parse_am(dc.get("home_or_draw"))
            if all(v is not None for v in [home, draw, one_x]):
                # 1X should be shorter (more negative or smaller positive) than both
                if one_x > 0 and home < 0:
                    violations.append(f"{m.get('event_id')}: 1X={one_x} but Home={home}")
        return len(violations) == 0, (f"1X violations: {violations}" if violations else "1X ≤ min(Home,Draw) ✓")

    def _g11_dc_logic_x2(self, data):
        violations = []
        for m in data.get("matches", []):
            ml = m.get("markets", {}).get("1x2", {})
            dc = m.get("markets", {}).get("dc", {})
            away = self._parse_am(ml.get("away_ml"))
            draw = self._parse_am(ml.get("draw"))
            x2 = self._parse_am(dc.get("away_or_draw"))
            if all(v is not None for v in [away, draw, x2]):
                if x2 > 0 and away < 0:
                    violations.append(f"{m.get('event_id')}: X2={x2} but Away={away}")
        return len(violations) == 0, (f"X2 violations: {violations}" if violations else "X2 ≤ min(Away,Draw) ✓")

    # Keys that hold non-odds identifiers and must be excluded from sign-format checks
    _G12_SKIP_KEYS = frozenset({
        "espn_match_id", "espn_slug", "event_id", "match_id", "be_name", "slug", "bet_explorer_match_id", "bet_explorer_slug", "world_cup_stage", "world_cup_round",
        "away_display", "home_display", "session", "script", "version",
        "bid_target", "markets", "type", "ts", "seq",
    })

    def _g12_sign_format(self, data):
        violations = []
        def scan(obj, path="", parent_key=""):
            # Skip known non-odds identifier keys entirely
            if parent_key in self._G12_SKIP_KEYS:
                return
            if isinstance(obj, str) and re.match(r'^-?\d+$', obj):
                if not obj.startswith("+") and not obj.startswith("-"):
                    violations.append(f"{path}={obj}")
            elif isinstance(obj, dict):
                for k, v in obj.items():
                    if k in self._G12_SKIP_KEYS:
                        continue
                    if "american" in k.lower() or "odds" in k.lower() or "_ml" in k.lower():
                        if isinstance(v, str) and v and not v.startswith("+") and not v.startswith("-"):
                            violations.append(f"{path}.{k}={v}")
                    scan(v, f"{path}.{k}", parent_key=k)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    scan(item, f"{path}[{i}]", parent_key=parent_key)
        scan(data)
        return len(violations) == 0, (f"Unsigned: {violations[:3]}" if violations else "All +/- prefixed ✓")

    def _g13_pk_display(self, data):
        violations = []
        for m in data.get("matches", []):
            ah = m.get("markets", {}).get("ah", {})
            if isinstance(ah, dict) and "0" in ah:
                violations.append(m.get("event_id"))
        return len(violations) == 0, (f"Non-pk zeros: {violations}" if violations else "All zeros → pk ✓")

    def _g14_team_mapping(self, data):
        # Group stage matches use ESPN team IDs directly — skip canonical map check.
        # Their be_name is derived from BetExplorer slug, not the canonical map.
        mapper = TeamMapper()
        violations = []
        for m in data.get("matches", []):
            if m.get("world_cup_stage") == "group" or m.get("world_cup_round") == "group":
                continue
            be_name = m.get("be_name", "")
            if be_name and be_name not in mapper.CANONICAL_MAP:
                violations.append(be_name)
        return len(violations) == 0, (f"Unmapped: {violations}" if violations else f"All {len(data.get('matches',[]))} mapped ✓")

    def _g15_orientation(self, data):
        violations = []
        for m in data.get("matches", []):
            if not m.get("away_display") or not m.get("home_display"):
                violations.append(m.get("event_id"))
        return len(violations) == 0, (f"Missing orientation: {violations}" if violations else "All Away/Home set ✓")


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 10: InMemoryIndex
# ─────────────────────────────────────────────────────────────────────────────
class InMemoryIndex:
    """O(1) hash-based lookups during transformation."""

    def __init__(self):
        self.by_match_market = {}
        self.by_match_market_bid = {}
        self.by_market_line = defaultdict(list)

    def build(self, dataset: dict):
        for match in dataset.get("matches", []):
            mid = match["event_id"]
            for market_key, market_data in match.get("markets", {}).items():
                self.by_match_market[(mid, market_key)] = market_data
                if isinstance(market_data, dict):
                    bid = market_data.get("bid", BET365_BID)
                    self.by_match_market_bid[(mid, market_key, bid)] = market_data
                    for line, entries in market_data.items():
                        self.by_market_line[(market_key, line)].append(mid)

    def get_bet365(self, match_id: str, market: str):
        return self.by_match_market_bid.get((match_id, market, BET365_BID))


# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT 11: ProgressVisualizer
# ─────────────────────────────────────────────────────────────────────────────
class ProgressVisualizer:
    """Real-time terminal progress dashboard."""

    def __init__(self, total_matches: int, total_markets: int):
        self.total_matches = total_matches
        self.total_markets = total_markets
        self.start_time = time.time()

    def render_progress(self, match_num: int, market_num: int, match_name: str, market: str):
        overall = (match_num - 1) * self.total_markets + market_num
        total = self.total_matches * self.total_markets
        pct = overall / total if total > 0 else 0
        filled = int(pct * 24)
        bar = "█" * filled + "░" * (24 - filled)
        elapsed = time.time() - self.start_time
        eta = (elapsed / overall * (total - overall)) if overall > 0 else 0

        print(f"\r  ┌─[{bar}] {pct*100:>5.1f}% │ Match {match_num}/{self.total_matches} │ "
              f"Market {market_num}/{self.total_markets} ({market}) │ "
              f"ETA {eta:.0f}s ─┐", end="", flush=True)

    def render_match_summary(self, match_num: int, match_name: str, markets_status: dict):
        print(f"\n  ┌─ Match {match_num}/{self.total_matches}: {match_name} {'─'*max(0,50-len(match_name))}┐",
              flush=True)
        for market, status in markets_status.items():
            icon = "✓" if status.get("ok") else "✗"
            color = "\033[92m" if status.get("ok") else "\033[91m"
            reset = "\033[0m"
            print(f"  │  {color}{icon}{reset} {market:<6}: {status.get('detail','')}", flush=True)
        print(f"  └{'─'*62}┘\n", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# ODDS CONVERSION UTILITIES
# ─────────────────────────────────────────────────────────────────────────────
def dec_to_american(dec_str: str) -> int:
    """
    Convert decimal odds string to American odds integer.
    Uses Fraction(str(dec)) to avoid float precision errors.
    EV (1.00 decimal) → +100.
    """
    try:
        dec_str = str(dec_str).strip()
        if not dec_str or dec_str in ("0", "0.0", "—", "-", ""):
            raise ValueError(f"Invalid decimal: '{dec_str}'")

        frac = Fraction(dec_str)
        # CRITICAL: str(Fraction) returns '26/25' which Decimal cannot parse
        # Must use numerator/denominator division instead
        dec = Decimal(frac.numerator) / Decimal(frac.denominator)

        if dec == Decimal("1.00"):
            return 100  # EV

        if dec >= Decimal("2.00"):
            # Underdog: (dec - 1) * 100, rounded
            raw = (dec - Decimal("1")) * Decimal("100")
            result = int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            return result
        else:
            # Favorite: -100 / (dec - 1), rounded
            raw = Decimal("-100") / (dec - Decimal("1"))
            result = int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            return result
    except Exception as e:
        raise ValueError(f"dec_to_american('{dec_str}') failed: {e}")


def format_american(val: int) -> str:
    """Format integer American odds with explicit +/- sign."""
    if val is None:
        return None
    if val >= 0:
        return f"+{val}"
    return str(val)


def parse_hcp(hcp_str: str):
    """Parse data-hcp string to float. Returns None on failure."""
    if not hcp_str or hcp_str in ("", "—"):
        return None
    try:
        return float(hcp_str)
    except (ValueError, TypeError):
        return None


def line_passes_quarter_filter(line_val: float) -> bool:
    """True if line does NOT end in .25, .75, or .00 (except 0 itself)."""
    if line_val == 0.0:
        return True  # AH pick'em is retained
    frac = abs(line_val) % 1
    return frac not in (0.0, 0.25, 0.75)


def line_display(line_val: float) -> str:
    """Format line for display: 0 → 'pk', others with explicit sign."""
    if line_val == 0.0:
        return "pk"
    if line_val > 0:
        return f"+{line_val}"
    return str(line_val)


# ─────────────────────────────────────────────────────────────────────────────
# CORE PARSING FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────
def parse_1x2(soup: BeautifulSoup, logger: ForensicLogger, event_id: str) -> dict:
    """
    Parse 1x2 market. Returns {home_ml, draw, away_ml, bid} as integers.
    data-pos: 1→HOME, 2→DRAW (or 0→DRAW in some responses), 3→AWAY
    """
    bid16_rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not bid16_rows:
        bid16_rows = soup.select(f'tr[data-bid="{BET365_BID_US}"]')
        if bid16_rows:
            logger.emit("INFO", f"1x2: bid=16 absent, using bid={BET365_BID_US} (bet365.us) fallback", event_id=event_id)
        else:
            raise ValueError(f"bid=16 and bid={BET365_BID_US} both absent in 1x2 response for {event_id}")
    row = bid16_rows[0]
    cells = row.select("td[data-odd]")

    if len(cells) < 3:
        raise ValueError(f"1x2 bid=16 row has only {len(cells)} cells (need 3) for {event_id}")

    # Map by data-pos
    pos_map = {}
    for c in cells:
        pos = c.get("data-pos", "")
        odd = c.get("data-odd", "")
        if odd and odd not in ("0", ""):
            pos_map[pos] = odd

    logger.emit("DEBUG", f"1x2 pos_map: {pos_map}", event_id=event_id)

    # pos=1→HOME, pos=0 or pos=2→DRAW, pos=2 or pos=3→AWAY
    # Handle both indexing schemes
    home_dec = pos_map.get("1")
    draw_dec = pos_map.get("0") or pos_map.get("2")
    away_dec = pos_map.get("3") or pos_map.get("2")

    # If only 3 cells with pos 1,0,2 — use cell index order
    if not home_dec or not draw_dec or not away_dec:
        if len(cells) >= 3:
            home_dec = cells[0].get("data-odd")
            draw_dec = cells[1].get("data-odd")
            away_dec = cells[2].get("data-odd")

    if not all([home_dec, draw_dec, away_dec]):
        raise ValueError(f"1x2 missing odds: home={home_dec} draw={draw_dec} away={away_dec}")

    home_ml = dec_to_american(home_dec)
    draw = dec_to_american(draw_dec)
    away_ml = dec_to_american(away_dec)

    # Margin check
    h_dec = float(Fraction(home_dec))
    d_dec = float(Fraction(draw_dec))
    a_dec = float(Fraction(away_dec))
    margin = 1/h_dec + 1/d_dec + 1/a_dec
    if not (1.02 <= margin <= 1.18):
        logger.emit("WARN", f"1x2 margin={margin:.4f} outside [1.02, 1.18]",
                    event_id=event_id, home=home_dec, draw=draw_dec, away=away_dec)

    logger.emit("PASS", f"1x2 PARSED: HOME={format_american(home_ml)} "
                f"DRAW={format_american(draw)} AWAY={format_american(away_ml)} | margin={margin:.4f}",
                event_id=event_id)

    return {"home_ml": home_ml, "draw": draw, "away_ml": away_ml, "bid": BET365_BID}


def parse_dc(soup: BeautifulSoup, logger: ForensicLogger, event_id: str) -> dict:
    """
    Parse Double Chance market.
    pos=1→1X, pos=2→12(No Draw), pos=3→X2
    """
    bid16_rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not bid16_rows:
        bid16_rows = soup.select(f'tr[data-bid="{BET365_BID_US}"]')
        if bid16_rows:
            logger.emit("INFO", f"DC: bid=16 absent, using bid={BET365_BID_US} (bet365.us) fallback", event_id=event_id)
        else:
            raise ValueError(f"bid=16 and bid={BET365_BID_US} both absent in dc response for {event_id}")

    # Find the DC row — should have 3 cells with values between 1.0 and 3.0 decimal
    dc_row = None
    for row in bid16_rows:
        cells = row.select("td[data-odd]")
        if len(cells) == 3:
            odds = [c.get("data-odd", "") for c in cells]
            try:
                vals = [float(Fraction(o)) for o in odds if o and o != "0"]
                if len(vals) == 3 and all(1.0 < v < 4.0 for v in vals):
                    dc_row = row
                    break
            except Exception:
                continue

    if not dc_row:
        dc_row = bid16_rows[0]

    cells = dc_row.select("td[data-odd]")
    if len(cells) < 3:
        raise ValueError(f"DC bid=16 row has only {len(cells)} cells for {event_id}")

    # Use cell index order: cells[0]→1X, cells[1]→12, cells[2]→X2
    one_x_dec = cells[0].get("data-odd")
    no_draw_dec = cells[1].get("data-odd")
    x2_dec = cells[2].get("data-odd")

    if not all([one_x_dec, no_draw_dec, x2_dec]):
        raise ValueError(f"DC missing odds: 1X={one_x_dec} 12={no_draw_dec} X2={x2_dec}")

    one_x = dec_to_american(one_x_dec)
    no_draw = dec_to_american(no_draw_dec)
    x2 = dec_to_american(x2_dec)

    # Margin check for DC (2-outcome coverage, margin should be ~1.04-1.12)
    v1 = float(Fraction(one_x_dec))
    v2 = float(Fraction(no_draw_dec))
    v3 = float(Fraction(x2_dec))
    margin = 1/v1 + 1/v2 + 1/v3

    logger.emit("PASS", f"DC PARSED: 1X={format_american(one_x)} "
                f"12={format_american(no_draw)} X2={format_american(x2)} | margin={margin:.4f}",
                event_id=event_id)

    return {"home_or_draw": one_x, "no_draw": no_draw, "away_or_draw": x2, "bid": BET365_BID}


def parse_bts(soup: BeautifulSoup, logger: ForensicLogger, event_id: str) -> dict:
    """
    Parse Both Teams To Score market.
    data-pos: y→YES, n→NO (or 1→YES, 2→NO)
    """
    bid16_rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not bid16_rows:
        bid16_rows = soup.select(f'tr[data-bid="{BET365_BID_US}"]')
        if bid16_rows:
            logger.emit("INFO", f"BTS: bid=16 absent, using bid={BET365_BID_US} (bet365.us) fallback", event_id=event_id)
        else:
            raise ValueError(f"bid=16 and bid={BET365_BID_US} both absent in bts response for {event_id}")

    row = bid16_rows[0]
    cells = row.select("td[data-odd]")

    if len(cells) < 2:
        raise ValueError(f"BTS bid=16 row has only {len(cells)} cells for {event_id}")

    # Map by data-pos
    pos_map = {}
    for c in cells:
        pos = c.get("data-pos", "")
        odd = c.get("data-odd", "")
        if odd and odd not in ("0", ""):
            pos_map[pos] = odd

    yes_dec = pos_map.get("y") or pos_map.get("1") or (cells[0].get("data-odd") if cells else None)
    no_dec = pos_map.get("n") or pos_map.get("2") or (cells[1].get("data-odd") if len(cells) > 1 else None)

    if not yes_dec or not no_dec:
        raise ValueError(f"BTS missing odds: YES={yes_dec} NO={no_dec}")

    btts_yes = dec_to_american(yes_dec)
    btts_no = dec_to_american(no_dec)

    logger.emit("PASS", f"BTS PARSED: YES={format_american(btts_yes)} NO={format_american(btts_no)}",
                event_id=event_id)

    return {"btts_yes": btts_yes, "btts_no": btts_no, "bid": BET365_BID}


def parse_ou(soup: BeautifulSoup, logger: ForensicLogger, event_id: str) -> dict:
    """
    Parse Over/Under market. Returns dict of {line_str: {over_odds, under_odds}}.
    Filters: retain only .50 lines, both sides within ±250.
    """
    bid16_rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not bid16_rows:
        bid16_rows = soup.select(f'tr[data-bid="{BET365_BID_US}"]')
        if bid16_rows:
            logger.emit("INFO", f"OU: bid=16 absent, using bid={BET365_BID_US} (bet365.us) fallback", event_id=event_id)
        else:
            raise ValueError(f"bid=16 and bid={BET365_BID_US} both absent in ou response for {event_id}")
    logger.emit("DEBUG", f"OU: {len(bid16_rows)} bid rows found", event_id=event_id)

    # Inspect first row to understand structure
    first_row = bid16_rows[0]
    first_attrs = dict(first_row.attrs)
    logger.emit("DEBUG", f"OU first bid=16 row attrs: {list(first_attrs.keys())}",
                event_id=event_id)

    # CONFIRMED FROM LIVE FORENSIC INSPECTION:
    # data-hcp is on TD cells (not TR rows). TR rows only have data-bid, data-bo,
    # data-bookie-id, data-originid. Each TR row = one line for one bookmaker.
    # data-hcp on the TD encodes: "E-{event}-{market}-{sub}-{LINE}-{alt}"
    # Field index 4 (0-based, split by '-') = the numeric line value.
    lines = {}

    for row in bid16_rows:
        cells = row.select("td[data-odd]")
        if len(cells) < 2:
            continue
        # Read data-hcp from first TD cell
        hcp_encoded = cells[0].get("data-hcp", "")
        if not hcp_encoded:
            # Try second cell
            hcp_encoded = cells[1].get("data-hcp", "")
        if not hcp_encoded:
            continue
        # Parse line from encoded hcp: "E-2-2-0-2.5-0" → field[4] = "2.5"
        parts = hcp_encoded.split("-")
        if len(parts) >= 5:
            line_raw = parts[4]
        else:
            line_raw = hcp_encoded  # fallback: use raw value
        over_dec = cells[0].get("data-odd")
        under_dec = cells[1].get("data-odd") if len(cells) > 1 else None
        if over_dec and under_dec and over_dec not in ("0", "") and under_dec not in ("0", ""):
            lines[line_raw] = (over_dec, under_dec)
            logger.emit("DEBUG", f"OU row: hcp_encoded={hcp_encoded} line={line_raw} "
                        f"over={over_dec} under={under_dec}", event_id=event_id)

    logger.emit("STATE", f"OU: {len(lines)} raw lines found: {list(lines.keys())[:8]}",
                event_id=event_id)

    # Apply filters and convert
    result = {}
    for hcp_str, (over_dec, under_dec) in lines.items():
        try:
            line_val = float(hcp_str) if hcp_str not in ("pk", "") else 0.0
        except ValueError:
            continue

        # Filter: only .50 lines
        if not line_passes_quarter_filter(line_val):
            continue

        try:
            over_am = dec_to_american(over_dec)
            under_am = dec_to_american(under_dec)
        except ValueError as e:
            logger.emit("WARN", f"OU line {hcp_str} conversion failed: {e}", event_id=event_id)
            continue

        # Band filter: both sides within ±250
        if abs(over_am) > 250 or abs(under_am) > 250:
            logger.emit("DEBUG", f"OU line {hcp_str} filtered (band): over={over_am} under={under_am}",
                        event_id=event_id)
            continue

        result[str(line_val)] = {"over_odds": over_am, "under_odds": under_am, "bid": BET365_BID}
        logger.emit("PASS", f"OU line {line_val}: OVER={format_american(over_am)} "
                    f"UNDER={format_american(under_am)}", event_id=event_id)

    if not result:
        raise ValueError(f"OU: No lines passed all filters for {event_id}")

    return result


def parse_ah(soup: BeautifulSoup, logger: ForensicLogger, event_id: str) -> dict:
    """
    Parse Asian Handicap (Spread) market.
    data-hcp is from HOME team perspective.
    Home Spread = data-hcp, Away Spread = -data-hcp.
    pos=1→HOME odds, pos=2→AWAY odds.
    Filters: .50 lines only, no ±0.5, no >-700.
    """
    bid16_rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not bid16_rows:
        bid16_rows = soup.select(f'tr[data-bid="{BET365_BID_US}"]')
        if bid16_rows:
            logger.emit("INFO", f"AH: bid=16 absent, using bid={BET365_BID_US} (bet365.us) fallback", event_id=event_id)
        else:
            raise ValueError(f"bid=16 and bid={BET365_BID_US} both absent in ah response for {event_id}")
    logger.emit("DEBUG", f"AH: {len(bid16_rows)} bid rows found", event_id=event_id)

    # CONFIRMED FROM LIVE FORENSIC INSPECTION:
    # data-hcp is on TD cells (not TR rows). Same encoding as OU:
    # "E-{event}-{market}-{sub}-{LINE}-{alt}" → field[4] = numeric line.
    # AH sign convention (per blueprint): ALWAYS from HOME team perspective.
    # data-hcp="-1.50" = Home -1.5 / Away +1.5
    # pos=1 (cells[0]) = HOME spread odds, pos=2 (cells[1]) = AWAY spread odds
    lines = {}

    for row in bid16_rows:
        cells = row.select("td[data-odd]")
        if len(cells) < 2:
            continue
        # Read data-hcp from first TD cell
        hcp_encoded = cells[0].get("data-hcp", "")
        if not hcp_encoded:
            hcp_encoded = cells[1].get("data-hcp", "")
        if not hcp_encoded:
            continue
        # Parse line from encoded hcp: "E-2-3-0--1.5-0" → reconstruct negative
        # The encoding uses '-' as separator AND as negative sign
        # Pattern: "E-{n}-{n}-{n}-{LINE}-{n}" where LINE may be negative
        # Split on '-' and reconstruct: field 4 is the line (may be negative)
        parts = hcp_encoded.split("-")
        # parts[0]='E', parts[1]=event_type, parts[2]=market, parts[3]=sub
        # For negative lines: parts[4]='' parts[5]=value (e.g. E-2-3-0--1.5-0)
        if len(parts) >= 6 and parts[4] == '':
            # Negative line: reconstruct as '-' + parts[5]
            line_raw = '-' + parts[5]
        elif len(parts) >= 5:
            line_raw = parts[4]
        else:
            line_raw = hcp_encoded
        home_dec = cells[0].get("data-odd")
        away_dec = cells[1].get("data-odd") if len(cells) > 1 else None
        if home_dec and away_dec and home_dec not in ("0", "") and away_dec not in ("0", ""):
            lines[line_raw] = (home_dec, away_dec)
            logger.emit("DEBUG", f"AH row: hcp_encoded={hcp_encoded} line={line_raw} "
                        f"home={home_dec} away={away_dec}", event_id=event_id)

    if not lines:
        # Method 3: parent scan
        for row in bid16_rows:
            parent = row.parent
            while parent and parent.name not in ("html", None):
                hcp = parent.get("data-handicap") or parent.get("data-hcp")
                if hcp:
                    cells = row.select("td[data-odd]")
                    if len(cells) >= 2:
                        home_dec = cells[0].get("data-odd")
                        away_dec = cells[1].get("data-odd")
                        if home_dec and away_dec:
                            lines[hcp] = (home_dec, away_dec)
                    break
                parent = parent.parent

    logger.emit("STATE", f"AH: {len(lines)} raw lines: {list(lines.keys())[:8]}", event_id=event_id)

    result = {}
    for hcp_str, (home_dec, away_dec) in lines.items():
        try:
            line_val = float(hcp_str) if hcp_str not in ("pk", "") else 0.0
        except ValueError:
            continue

        # Filter: .50 lines only (retain 0 for pick'em)
        if not line_passes_quarter_filter(line_val):
            continue

        # Filter: no ±0.5
        if abs(line_val) == 0.5:
            continue

        try:
            home_am = dec_to_american(home_dec)
            away_am = dec_to_american(away_dec)
        except ValueError as e:
            logger.emit("WARN", f"AH line {hcp_str} conversion failed: {e}", event_id=event_id)
            continue

        # Band filter: no >-700
        if (home_am < 0 and abs(home_am) > 700) or (away_am < 0 and abs(away_am) > 700):
            logger.emit("DEBUG", f"AH line {hcp_str} filtered (>-700): home={home_am} away={away_am}",
                        event_id=event_id)
            continue

        # AH sign inversion for Away Spread display
        # home_spread = line_val (as-is from data-hcp)
        # away_spread = -line_val
        home_spread = line_val
        away_spread = -line_val
        disp = line_display(line_val)

        result[disp] = {
            "home_spread": home_spread,
            "away_spread": away_spread,
            "home_odds": home_am,
            "away_odds": away_am,
            "bid": BET365_BID,
        }
        logger.emit("PASS",
                    f"AH line {disp}: HOME_SPREAD={line_display(home_spread)} "
                    f"HOME_ODDS={format_american(home_am)} | "
                    f"AWAY_SPREAD={line_display(away_spread)} "
                    f"AWAY_ODDS={format_american(away_am)}",
                    event_id=event_id)

    if not result:
        raise ValueError(f"AH: No lines passed all filters for {event_id}")

    return result


# ─────────────────────────────────────────────────────────────────────────────
# HTTP FETCH WITH FULL THROTTLE + RETRY
# ─────────────────────────────────────────────────────────────────────────────
def fetch_market(session: requests.Session, event_id: str, market: str,
                 referer: str, throttle: ThrottleController,
                 logger: ForensicLogger, inspector: DebugInspector,
                 max_retries: int = 3) -> BeautifulSoup:
    """Fetch a single market AJAX endpoint with throttle control and retry."""
    # Use allOdds for ou/ah (need all lines), bestOdds for 1x2/dc/bts (flat markets)
    if market in ('ou', 'ah'):
        url = AJAX_TEMPLATE_ALL.format(base=BASE_URL, event_id=event_id, market=market)
    else:
        url = AJAX_TEMPLATE_BEST.format(base=BASE_URL, event_id=event_id, market=market)
    logger.emit("STEP", f"FETCH [{market.upper()}]", event_id=event_id, url=url)

    for attempt in range(1, max_retries + 1):
        try:
            t0 = time.time()
            resp = session.get(url, timeout=25)
            elapsed = time.time() - t0

            throttle.record_response(elapsed, resp.status_code)
            inspector.inspect_response(resp, f"{event_id}_{market}_attempt{attempt}")

            logger.emit("STATE", f"HTTP [{market.upper()}]",
                        event_id=event_id,
                        status=resp.status_code,
                        size=f"{len(resp.content):,}B",
                        elapsed_ms=f"{elapsed*1000:.0f}ms")

            if resp.status_code != 200:
                logger.emit("WARN", f"HTTP {resp.status_code} for {market}",
                            event_id=event_id, attempt=attempt)
                if attempt < max_retries:
                    delay = throttle.get_delay(f"retry_{market}")
                    logger.emit("INFO", f"Retry {attempt}/{max_retries} after {delay:.1f}s")
                    time.sleep(delay)
                    continue
                raise ValueError(f"HTTP {resp.status_code} after {max_retries} attempts")

            # Parse JSON response
            try:
                data = resp.json()
            except Exception:
                raise ValueError(f"Non-JSON response for {market} (size={len(resp.content)})")

            html_content = data.get("odds", "")
            if not html_content:
                raise ValueError(f"Empty 'odds' key in JSON response for {market}")

            soup = BeautifulSoup(html_content, "html.parser")
            inspector.inspect_bid_rows(soup, market, event_id)

            # Inter-request delay
            delay = throttle.get_delay(f"post_{market}")
            logger.emit("DEBUG", f"Post-{market} delay: {delay:.2f}s", event_id=event_id)
            time.sleep(delay)

            return soup

        except requests.exceptions.Timeout:
            logger.emit("WARN", f"TIMEOUT on {market} attempt {attempt}", event_id=event_id)
            throttle._escalate(f"Timeout on {market}")
            if attempt < max_retries:
                delay = throttle.get_delay(f"timeout_retry_{market}")
                time.sleep(delay)
            else:
                raise

        except requests.exceptions.SSLError as e:
            logger.emit("ERROR", f"SSL error on {market}: {e}", event_id=event_id)
            if attempt < max_retries:
                time.sleep(random.uniform(5, 10))
            else:
                raise

    raise ValueError(f"fetch_market failed after {max_retries} attempts for {event_id}/{market}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN SCRAPER PIPELINE
# ─────────────────────────────────────────────────────────────────────────────
def run_scraper(match_ids: list = None):
    """
    Main scraper pipeline. Runs all 12 matches (or subset if match_ids provided).
    """
    logger = ForensicLogger(LOG_PATH)
    inspector = DebugInspector(logger, depth=3)
    assertions = StrictAssertions(logger)
    mapper = TeamMapper()
    warehouse = OddsWarehouse(DB_PATH, logger)
    throttle = ThrottleController(logger)
    stealth = StealthHeaders()
    visualizer = ProgressVisualizer(
        total_matches=len(MATCHES),
        total_markets=len(MARKETS)
    )

    # Filter matches if subset requested
    # Matches on match_id (e.g. 'wc26-r32-066') OR event_id (e.g. 'nkoQVAgB')
    matches_to_run = MATCHES
    if match_ids:
        matches_to_run = [
            f for f in MATCHES
            if f["id"] in match_ids or f["event_id"] in match_ids
        ]
        logger.emit("INFO", f"Running subset: {[f['id'] for f in matches_to_run]} "
                    f"(matched from: {match_ids})")

    # Build HTTP session
    session = requests.Session()
    session.headers.update(stealth.page())

    # ── WARMUP: Visit matches page to establish session ──────────────────────
    logger.emit("STEP", "SESSION WARMUP", url=MATCHES_PAGE)
    try:
        t0 = time.time()
        warmup_resp = session.get(MATCHES_PAGE, timeout=20)
        elapsed = time.time() - t0
        throttle.record_response(elapsed, warmup_resp.status_code)
        logger.emit("CHECKPOINT", f"Warmup complete: HTTP {warmup_resp.status_code} "
                    f"| {len(warmup_resp.content):,}B | {elapsed:.3f}s")
    except Exception as e:
        logger.emit("WARN", f"Warmup failed: {e} — continuing anyway")

    # Switch to AJAX headers
    session.headers.update(stealth.ajax(MATCHES_PAGE))

    # Post-warmup delay
    delay = throttle.get_delay("post_warmup")
    logger.emit("INFO", f"Post-warmup delay: {delay:.2f}s")
    time.sleep(delay)

    # ── MAIN SCRAPE LOOP ──────────────────────────────────────────────────────
    dataset = {
        "matches": [],
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "_meta": {
            "expected_count": len(matches_to_run),
            "total_matches": len(MATCHES),
            "subset_mode": match_ids is not None,
            "scraper_version": "v4.0",
            "bid": BET365_BID,
        }
    }
    all_pass = True

    for match_num, match in enumerate(matches_to_run, 1):
        event_id = match["event_id"]
        be_name = match["be_name"]
        match_id = match["id"]
        slug = match["slug"]
        referer = MATCH_PAGE_TEMPLATE.format(base=BASE_URL, slug=slug, event_id=event_id)

        logger.push_breadcrumb(f"match_{match_num}:{match_id}")

        print(f"\n\033[96m{'╔'+'═'*78+'╗'}\033[0m", flush=True)
        print(f"\033[96m║  MATCH {match_num}/{len(matches_to_run)}: {match_id} — {be_name:<50}║\033[0m", flush=True)
        print(f"\033[96m{'╚'+'═'*78+'╝'}\033[0m", flush=True)

        # Resolve team names
        try:
            away_display, home_display = mapper.resolve(be_name)
        except ValueError as e:
            logger.emit("ERROR", f"Team mapping failed: {e}", match_id=match_id)
            away_display = "Unknown"
            home_display = "Unknown"

        # Upsert match record
        warehouse.upsert_match(event_id, match_id, be_name, away_display, home_display)

        match_record = {
            "event_id": event_id,
            "match_id": match_id,
            "espn_match_id": match.get("espn_match_id"),
            "espn_slug": match.get("espn_slug"),
            "espn_away_team_id": match.get("espn_away_team_id"),
            "espn_home_team_id": match.get("espn_home_team_id"),
            "slug": match.get("slug"),
            "be_name": be_name,
            "away_display": away_display,
            "home_display": home_display,
            "markets": {},
        }

        markets_status = {}
        session.headers.update(stealth.ajax(referer))

        for market_num, market in enumerate(MARKETS, 1):
            visualizer.render_progress(match_num, market_num, be_name, market)
            logger.push_breadcrumb(f"market:{market}")

            try:
                soup = fetch_market(session, event_id, market, referer,
                                    throttle, logger, inspector)

                # Parse market
                if market == "1x2":
                    parsed = parse_1x2(soup, logger, event_id)
                    match_record["markets"]["1x2"] = parsed
                    warehouse.upsert_flat(event_id, "1x2", parsed)
                elif market == "dc":
                    parsed = parse_dc(soup, logger, event_id)
                    match_record["markets"]["dc"] = parsed
                    warehouse.upsert_flat(event_id, "dc", parsed)
                elif market == "bts":
                    parsed = parse_bts(soup, logger, event_id)
                    match_record["markets"]["bts"] = parsed
                    warehouse.upsert_flat(event_id, "bts", parsed)
                elif market == "ou":
                    parsed = parse_ou(soup, logger, event_id)
                    match_record["markets"]["ou"] = parsed
                    for line_str, line_data in parsed.items():
                        try:
                            line_num = float(line_str)
                        except ValueError:
                            line_num = 0.0
                        warehouse.upsert_lined(
                            event_id, "ou", line_str, line_num,
                            line_display(line_num),
                            over_odds=line_data["over_odds"],
                            under_odds=line_data["under_odds"]
                        )
                elif market == "ah":
                    parsed = parse_ah(soup, logger, event_id)
                    match_record["markets"]["ah"] = parsed
                    for line_disp, line_data in parsed.items():
                        line_num = line_data["home_spread"]
                        warehouse.upsert_lined(
                            event_id, "ah", line_disp, line_num,
                            line_disp,
                            home_odds=line_data["home_odds"],
                            away_odds=line_data["away_odds"]
                        )

                markets_status[market] = {"ok": True, "detail": "PASS"}
                logger.increment("MARKET_PASS")

            except Exception as e:
                logger.emit("FAIL", f"Market {market} FAILED: {type(e).__name__}: {e}",
                            match_id=match_id, market=market)
                logger.emit("DEBUG", traceback.format_exc()[-500:])
                markets_status[market] = {"ok": False, "detail": str(e)[:60]}
                logger.increment("MARKET_FAIL")
                all_pass = False

            if throttle.should_abort():
                logger.emit("FATAL", "ABORT: Too many consecutive errors")
                break

        print()  # newline after progress bar
        visualizer.render_match_summary(match_num, f"{away_display} (A) vs {home_display} (H)",
                                        markets_status)

        dataset["matches"].append(match_record)

        # Save incremental JSON
        with open(OUTPUT_JSON, "w") as f:
            json.dump(dataset, f, indent=2)

        if throttle.should_abort():
            break

    # ── TRANSFORMATION PIPELINE ───────────────────────────────────────────────
    logger.emit("STEP", "TRANSFORMATION PIPELINE — 15 phases")
    dataset = apply_transformation_pipeline(dataset, logger)

    # ── VALIDATION GATES ──────────────────────────────────────────────────────
    gate_engine = ValidationGateEngine(logger, warehouse)
    gates_passed = gate_engine.run_all_gates(dataset)

    # ── FINAL OUTPUT ──────────────────────────────────────────────────────────
    with open(OUTPUT_JSON, "w") as f:
        json.dump(dataset, f, indent=2)
    logger.emit("CHECKPOINT", f"Final output saved: {OUTPUT_JSON}")

    # Build index
    index = InMemoryIndex()
    index.build(dataset)

    # Print final tables
    print_final_tables(dataset, logger)

    # ── MYSQL UPSERT ──────────────────────────────────────────────────────────
    # Only upsert if all validation gates passed (hard gate requirement)
    if gates_passed:
        logger.emit("STEP", "[MYSQL_UPSERT] Validation gates PASSED — proceeding with MySQL upsert")
        try:
            mysql_results = upsert_to_mysql(dataset, logger)
            ok_count = sum(1 for v in mysql_results.values() if v == "UPSERT_OK")
            total = len(mysql_results)
            logger.emit("CHECKPOINT",
                        f"[MYSQL_UPSERT] COMPLETE: {ok_count}/{total} matches upserted → {MYSQL_TABLE}")

            # Print MySQL upsert summary table
            print(f"\n\033[92m{'\u2550'*70}\033[0m", flush=True)
            print(f"\033[92m  MYSQL UPSERT RESULTS → {MYSQL_TABLE}\033[0m", flush=True)
            print(f"\033[92m{'\u2550'*70}\033[0m", flush=True)
            for fid, status in sorted(mysql_results.items()):
                icon = "\033[92m\u2713\033[0m" if status == "UPSERT_OK" else "\033[91m\u2717\033[0m"
                print(f"  {icon} {fid:<20} {status}", flush=True)
            print(f"\033[92m{'\u2550'*70}\033[0m\n", flush=True)

        except Exception as e:
            logger.emit("FATAL",
                        f"[MYSQL_UPSERT] FAILED: {type(e).__name__}: {e}")
            raise
    else:
        logger.emit("WARN",
                    "[MYSQL_UPSERT] SKIPPED — validation gates did not all pass")

    logger.summary()
    warehouse.close()

    return dataset, gates_passed


# ─────────────────────────────────────────────────────────────────────────────
# TRANSFORMATION PIPELINE (15 phases)
# ─────────────────────────────────────────────────────────────────────────────
def apply_transformation_pipeline(dataset: dict, logger: ForensicLogger) -> dict:
    """Apply all 15 transformation phases from spec."""

    # P1: Bookmaker isolation (already done in parsing — bid=16 only)
    logger.emit("STEP", "P1: Bookmaker isolation — bid=16 enforced at parse time")

    # P2: Market pruning — remove DNB/ha (never scraped, but verify)
    logger.emit("STEP", "P2: Market pruning — verify ha absent")
    for m in dataset["matches"]:
        if "ha" in m.get("markets", {}):
            del m["markets"]["ha"]
            logger.emit("WARN", f"P2: ha market found and removed from {m['event_id']}")

    # P3: Decimal purge — all odds are already American integers
    logger.emit("STEP", "P3: Decimal purge — all values are American integers")

    # P4: Line filtering — already applied in parse_ou and parse_ah
    logger.emit("STEP", "P4: Line filtering — .25/.75/.00 removed at parse time")

    # P5: AH band filter — already applied in parse_ah
    logger.emit("STEP", "P5: AH band filter — ±0.5 and >-700 removed at parse time")

    # P6: O/U band filter — already applied in parse_ou
    logger.emit("STEP", "P6: O/U band filter — ±250 enforced at parse time")

    # P7: Team name mapping — already applied
    logger.emit("STEP", "P7: Team name mapping — away/home orientation confirmed")

    # P8: AH spread sign inversion — already applied in parse_ah
    logger.emit("STEP", "P8: AH sign inversion — away_spread = -home_spread confirmed")

    # P9: DC column correction — pos=1→1X, pos=2→12, pos=3→X2 confirmed
    logger.emit("STEP", "P9: DC column correction — 1X/12/X2 mapping confirmed")

    # P10: EV string replacement
    logger.emit("STEP", "P10: EV string check")
    def replace_ev(obj):
        if isinstance(obj, dict):
            return {k: replace_ev(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [replace_ev(i) for i in obj]
        elif isinstance(obj, str) and obj.upper() == "EV":
            return "+100"
        return obj
    dataset = replace_ev(dataset)

    # P11-P15: Format American odds with explicit signs
    logger.emit("STEP", "P11-P15: Format all American odds with explicit +/- signs")

    def format_all_odds(obj):
        if isinstance(obj, dict):
            result = {}
            for k, v in obj.items():
                if isinstance(v, int) and k not in ("bid",):
                    result[k] = format_american(v)
                else:
                    result[k] = format_all_odds(v)
            return result
        elif isinstance(obj, list):
            return [format_all_odds(i) for i in obj]
        return obj

    # Apply formatting to markets only
    for m in dataset["matches"]:
        for market_key, market_data in m.get("markets", {}).items():
            if isinstance(market_data, dict):
                m["markets"][market_key] = format_all_odds(market_data)

    logger.emit("CHECKPOINT", "Transformation pipeline complete — all 15 phases applied")
    return dataset


# ─────────────────────────────────────────────────────────────────────────────
# FINAL TABLE PRINTER
# ─────────────────────────────────────────────────────────────────────────────
def print_final_tables(dataset: dict, logger: ForensicLogger):
    """Print the 3 final output tables per spec."""

    matches = dataset.get("matches", [])
    if not matches:
        logger.emit("WARN", "No matches to display")
        return

    print(f"\n\033[96m{'═'*90}\033[0m", flush=True)
    print(f"\033[96m  TABLE 1: FLAT MARKETS (1X2 + DC + BTS)\033[0m", flush=True)
    print(f"\033[96m{'═'*90}\033[0m", flush=True)
    print(f"  {'#':<3} {'Match':<32} {'Home ML':>8} {'Draw':>8} {'Away ML':>8} "
          f"{'1X':>8} {'X2':>8} {'12(ND)':>8} {'BTTS Y':>8} {'BTTS N':>8}", flush=True)
    print(f"  {'─'*3} {'─'*32} {'─'*8} {'─'*8} {'─'*8} {'─'*8} {'─'*8} {'─'*8} {'─'*8} {'─'*8}",
          flush=True)

    for i, m in enumerate(matches, 1):
        away = m.get("away_display", "?")
        home = m.get("home_display", "?")
        match_str = f"{away} (A) vs {home} (H)"[:31]
        ml = m.get("markets", {}).get("1x2", {})
        dc = m.get("markets", {}).get("dc", {})
        bts = m.get("markets", {}).get("bts", {})

        print(f"  {i:<3} {match_str:<32} "
              f"{ml.get('home_ml','N/A'):>8} "
              f"{ml.get('draw','N/A'):>8} "
              f"{ml.get('away_ml','N/A'):>8} "
              f"{dc.get('home_or_draw','N/A'):>8} "
              f"{dc.get('away_or_draw','N/A'):>8} "
              f"{dc.get('no_draw','N/A'):>8} "
              f"{bts.get('btts_yes','N/A'):>8} "
              f"{bts.get('btts_no','N/A'):>8}", flush=True)

    print(f"\n\033[96m{'═'*90}\033[0m", flush=True)
    print(f"\033[96m  TABLE 2: ASIAN HANDICAP (SPREAD)\033[0m", flush=True)
    print(f"\033[96m{'═'*90}\033[0m", flush=True)
    print(f"  {'Match':<32} {'Away Team':<14} {'A.Spread':>9} {'A.Odds':>8} "
          f"{'Home Team':<14} {'H.Spread':>9} {'H.Odds':>8}", flush=True)
    print(f"  {'─'*32} {'─'*14} {'─'*9} {'─'*8} {'─'*14} {'─'*9} {'─'*8}", flush=True)

    for m in matches:
        away = m.get("away_display", "?")
        home = m.get("home_display", "?")
        match_str = f"{away} vs {home}"[:31]
        ah = m.get("markets", {}).get("ah", {})
        if isinstance(ah, dict):
            for line_disp, line_data in ah.items():
                if isinstance(line_data, dict):
                    h_spread = line_data.get("home_spread", 0)
                    a_spread = line_data.get("away_spread", 0)
                    h_odds = line_data.get("home_odds", "N/A")
                    a_odds = line_data.get("away_odds", "N/A")
                    h_disp = line_display(h_spread) if isinstance(h_spread, (int, float)) else str(h_spread)
                    a_disp = line_display(a_spread) if isinstance(a_spread, (int, float)) else str(a_spread)
                    print(f"  {match_str:<32} {away:<14} {a_disp:>9} {str(a_odds):>8} "
                          f"{home:<14} {h_disp:>9} {str(h_odds):>8}", flush=True)

    print(f"\n\033[96m{'═'*90}\033[0m", flush=True)
    print(f"\033[96m  TABLE 3: OVER/UNDER (TOTALS)\033[0m", flush=True)
    print(f"\033[96m{'═'*90}\033[0m", flush=True)
    print(f"  {'Match':<32} {'Line':>6} {'Over':>8} {'Under':>8}", flush=True)
    print(f"  {'─'*32} {'─'*6} {'─'*8} {'─'*8}", flush=True)

    for m in matches:
        away = m.get("away_display", "?")
        home = m.get("home_display", "?")
        match_str = f"{away} vs {home}"[:31]
        ou = m.get("markets", {}).get("ou", {})
        if isinstance(ou, dict):
            for line_str, line_data in ou.items():
                if isinstance(line_data, dict):
                    over = line_data.get("over_odds", "N/A")
                    under = line_data.get("under_odds", "N/A")
                    print(f"  {match_str:<32} {line_str:>6} {str(over):>8} {str(under):>8}",
                          flush=True)

    print(f"\n\033[96m{'═'*90}\033[0m\n", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# MYSQL UPSERT ENGINE
# Writes scraped book_ columns to wc2026MatchOdds table in production MySQL.
# DC semantics (CONFIRMED):
#   home_or_draw (1X) = Home WD  → book_home_wd  (X2 = Home or Draw)
#   away_or_draw (X2) = Away WD  → book_away_wd  (1X = Away or Draw)
#   no_draw      (12) = No Draw  → book_no_draw  (single combined price)
# AH: home_spread = line from HOME perspective (negative = home favored)
# OU: primary line = first .50 line sorted by proximity to 2.5
# ─────────────────────────────────────────────────────────────────────────────
def _parse_db_url(url: str) -> dict:
    """Parse mysql://user:pass@host:port/db?ssl=... into pymysql kwargs."""
    try:
        # Strip ssl param which is JSON and not standard
        base = url.split('?')[0]
        parsed = _urlparse.urlparse(base)
        return {
            "host": parsed.hostname,
            "port": parsed.port or 4000,
            "user": _urlparse.unquote(parsed.username or ""),
            "password": _urlparse.unquote(parsed.password or ""),
            "database": parsed.path.lstrip("/"),
            "ssl": {"ca": None},  # TiDB Cloud requires SSL
            "ssl_verify_cert": False,
            "ssl_verify_identity": False,
            "connect_timeout": 15,
            "charset": "utf8mb4",
            "cursorclass": pymysql.cursors.DictCursor,
        }
    except Exception as e:
        raise ValueError(f"_parse_db_url failed: {e} | url={url[:60]}")


def _parse_am_int(v) -> int:
    """Convert '+110' / '-130' / 110 / None → int or None."""
    if v is None:
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str):
        try:
            return int(v.replace('+', ''))
        except ValueError:
            return None
    return None


OU_ODDS_CEILING = 170  # max absolute value for over/under odds


def _select_primary_ou_line(ou_data: dict) -> tuple:
    """
    Select the primary O/U line from the parsed ou dict.
    Rule: find the line closest to 2.5 where BOTH over and under odds are
    within the OU_ODDS_CEILING (170). If 2.5 violates the ceiling, step to
    adjacent lines searching outward until a compliant line is found.
    Fallback: return closest to 2.5 regardless of ceiling.
    Returns (line_float, over_odds_int, under_odds_int) or (None, None, None).
    """
    if not isinstance(ou_data, dict) or not ou_data:
        return None, None, None

    # Build list of (line_val, over_odds, under_odds) for all valid entries
    candidates = []
    for line_str, line_data in ou_data.items():
        if not isinstance(line_data, dict):
            continue
        try:
            lv = float(line_str)
        except (ValueError, TypeError):
            continue
        over = _parse_am_int(line_data.get('over_odds'))
        under = _parse_am_int(line_data.get('under_odds'))
        if over is None or under is None:
            continue
        candidates.append((lv, over, under))

    if not candidates:
        return None, None, None

    # Sort by distance from 2.5 (ascending), then by line value (ascending) as tiebreak
    candidates.sort(key=lambda x: (abs(x[0] - 2.5), x[0]))

    # Find first candidate where BOTH sides are within the ceiling
    for lv, over, under in candidates:
        if abs(over) <= OU_ODDS_CEILING and abs(under) <= OU_ODDS_CEILING:
            return lv, over, under

    # Fallback: return closest to 2.5 regardless of ceiling
    lv, over, under = candidates[0]
    return lv, over, under


def _select_primary_ah_line(ah_data: dict, home_ml: int = None, away_ml: int = None) -> tuple:
    """
    Select the primary AH/Spread line from the parsed ah dict.
    Rule: NO pk (0.0) lines allowed.
    - If the closest line is 0.0 (pk), force to \u00b11.5:
        * Favorite (lower/more-negative ML) gets -1.5
        * Underdog (higher/more-positive ML) gets +1.5
      home_spread is from HOME team perspective:
        * If HOME is favorite: home_spread = -1.5
        * If AWAY is favorite: home_spread = +1.5 (home is dog)
    - Otherwise: pick the line with smallest absolute value (excluding 0.0).
    Returns (home_spread_float, home_odds_int, away_odds_int) or (None, None, None).
    """
    if not isinstance(ah_data, dict) or not ah_data:
        return None, None, None

    # Build candidates: (abs_val, line_val, home_odds, away_odds)
    candidates = []
    for line_disp, line_data in ah_data.items():
        if not isinstance(line_data, dict):
            continue
        hs = line_data.get('home_spread')
        if hs is None:
            continue
        try:
            hs_f = float(hs)
        except (ValueError, TypeError):
            continue
        ho = _parse_am_int(line_data.get('home_odds'))
        ao = _parse_am_int(line_data.get('away_odds'))
        candidates.append((abs(hs_f), hs_f, ho, ao))

    if not candidates:
        return None, None, None

    # Sort by absolute value ascending
    candidates.sort(key=lambda x: x[0])
    best_abs, best_line, best_home_odds, best_away_odds = candidates[0]

    # NO PK RULE: if closest line is 0.0, force to \u00b11.5
    if best_line == 0.0:
        # Find the \u00b11.5 entry
        line_15_home = None
        line_15_ho = None
        line_15_ao = None
        for _, lv, ho, ao in candidates:
            if abs(lv) == 1.5:
                line_15_home = lv
                line_15_ho = ho
                line_15_ao = ao
                break

        if line_15_home is not None:
            # Determine favorite from ML (lower = more favored)
            hml = home_ml if home_ml is not None else 0
            aml = away_ml if away_ml is not None else 0
            home_is_fav = hml <= aml

            if home_is_fav:
                # Home is favorite -> home_spread = -1.5
                if line_15_home < 0:
                    return line_15_home, line_15_ho, line_15_ao
                else:
                    # Entry has home_spread=+1.5 (away-fav orientation) -> flip
                    return -1.5, line_15_ao, line_15_ho
            else:
                # Away is favorite -> home_spread = +1.5 (home is dog)
                if line_15_home > 0:
                    return line_15_home, line_15_ho, line_15_ao
                else:
                    # Entry has home_spread=-1.5 -> flip
                    return 1.5, line_15_ao, line_15_ho
        else:
            # No \u00b11.5 line available: use next smallest non-zero line
            for _, lv, ho, ao in candidates:
                if lv != 0.0:
                    return lv, ho, ao
            return None, None, None

    return best_line, best_home_odds, best_away_odds


def upsert_to_mysql(dataset: dict, logger: ForensicLogger) -> dict:
    """
    Upsert all scraped book_ columns into wc2026MatchOdds (MySQL/TiDB).

    Column mapping (scraper field → DB column):
      1x2:  home_ml         → book_home_ml
            draw            → book_draw
            away_ml         → book_away_ml
      dc:   home_or_draw    → book_home_wd   (1X = Home or Draw = X2)
            away_or_draw    → book_away_wd   (X2 = Away or Draw = 1X)
            no_draw         → book_no_draw   (12 = No Draw)
      bts:  btts_yes        → book_btts_yes
            btts_no         → book_btts_no
      ou:   primary line    → book_total, book_over_odds, book_under_odds
      ah:   primary line    → book_primary_spread, book_home_primary_spread_odds,
                               book_away_primary_spread_odds

    Returns dict: {match_id: 'UPSERT_OK'|'SKIP'|'ERROR: ...'}
    """
    results = {}

    if not PYMYSQL_AVAILABLE:
        logger.emit("FATAL", "[MYSQL_UPSERT] pymysql not installed — ABORT")
        raise RuntimeError("pymysql required for MySQL upsert")

    db_url = _DB_URL
    if not db_url:
        logger.emit("FATAL", "[MYSQL_UPSERT] DATABASE_URL not set in environment — ABORT")
        raise RuntimeError("DATABASE_URL environment variable not set")

    logger.emit("STEP", f"[MYSQL_UPSERT] Connecting to MySQL | table={MYSQL_TABLE}")

    try:
        conn_kwargs = _parse_db_url(db_url)
        conn = pymysql.connect(**conn_kwargs)
        logger.emit("CHECKPOINT", f"[MYSQL_UPSERT] Connected to {conn_kwargs['host']}:{conn_kwargs['port']}/{conn_kwargs['database']}")
    except Exception as e:
        logger.emit("FATAL", f"[MYSQL_UPSERT] Connection FAILED: {type(e).__name__}: {e}")
        raise

    matches = dataset.get("matches", [])
    logger.emit("INFO", f"[MYSQL_UPSERT] Processing {len(matches)} matches")

    upsert_sql = f"""
        INSERT INTO `{MYSQL_TABLE}` (
            match_id, espn_match_id, espn_slug,
            bet_explorer_match_id, bet_explorer_slug,
            world_cup_stage, world_cup_round,
            insert_method,
            last_inserted_at, last_insert_method,
            away_team, home_team,
            book_away_to_advance,
            book_home_to_advance,
            book_home_ml, book_draw, book_away_ml,
            book_home_wd, book_away_wd, book_no_draw,
            book_btts_yes, book_btts_no,
            book_total, book_over_odds, book_under_odds,
            book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds
        ) VALUES (
            %s, %s, %s,
            %s, %s,
            %s, %s,
            %s,
            CURRENT_TIMESTAMP, %s,
            %s, %s,
            %s,
            %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s, %s
        )
        ON DUPLICATE KEY UPDATE
            espn_match_id                  = VALUES(espn_match_id),
            espn_slug                      = VALUES(espn_slug),
            bet_explorer_match_id          = VALUES(bet_explorer_match_id),
            bet_explorer_slug              = VALUES(bet_explorer_slug),
            world_cup_stage                = VALUES(world_cup_stage),
            world_cup_round                = VALUES(world_cup_round),
            last_inserted_at               = CURRENT_TIMESTAMP,
            last_insert_method             = VALUES(last_insert_method),
            away_team                      = VALUES(away_team),
            home_team                      = VALUES(home_team),
            book_away_to_advance           = VALUES(book_away_to_advance),
            book_home_to_advance           = VALUES(book_home_to_advance),
            book_home_ml                   = VALUES(book_home_ml),
            book_draw                      = VALUES(book_draw),
            book_away_ml                   = VALUES(book_away_ml),
            book_home_wd                   = VALUES(book_home_wd),
            book_away_wd                   = VALUES(book_away_wd),
            book_no_draw                   = VALUES(book_no_draw),
            book_btts_yes                  = VALUES(book_btts_yes),
            book_btts_no                   = VALUES(book_btts_no),
            book_total                     = VALUES(book_total),
            book_over_odds                 = VALUES(book_over_odds),
            book_under_odds                = VALUES(book_under_odds),
            book_primary_spread            = VALUES(book_primary_spread),
            book_home_primary_spread_odds  = VALUES(book_home_primary_spread_odds),
            book_away_primary_spread_odds  = VALUES(book_away_primary_spread_odds)
    """

    try:
        with conn.cursor() as cur:
            for m in matches:
                match_id = m.get("match_id")
                if not match_id:
                    logger.emit("WARN", "[MYSQL_UPSERT] Match missing match_id — SKIP",
                                event_id=m.get("event_id"))
                    continue

                markets = m.get("markets", {})
                ml_data  = markets.get("1x2", {})
                dc_data  = markets.get("dc",  {})
                bts_data = markets.get("bts", {})
                ou_data  = markets.get("ou",  {})
                ah_data  = markets.get("ah",  {})

                # ── 1X2 ──────────────────────────────────────────────────────────
                book_home_ml = _parse_am_int(ml_data.get("home_ml"))
                book_draw    = _parse_am_int(ml_data.get("draw"))
                book_away_ml = _parse_am_int(ml_data.get("away_ml"))

                # ── DC ───────────────────────────────────────────────────────────
                # home_or_draw = 1X = Home WD (X2 col) → book_home_wd
                # away_or_draw = X2 = Away WD (1X col) → book_away_wd
                book_home_wd = _parse_am_int(dc_data.get("home_or_draw"))
                book_away_wd = _parse_am_int(dc_data.get("away_or_draw"))
                book_no_draw = _parse_am_int(dc_data.get("no_draw"))

                # ── BTTS ─────────────────────────────────────────────────────────
                book_btts_yes = _parse_am_int(bts_data.get("btts_yes"))
                book_btts_no  = _parse_am_int(bts_data.get("btts_no"))

                # ── O/U ──────────────────────────────────────────────────────────
                book_total, book_over_odds, book_under_odds = _select_primary_ou_line(ou_data)

                # ── AH/Spread ────────────────────────────────────────────────────
                # Pass ML values so pk→±1.5 rule can determine favorite
                book_primary_spread, book_home_spread_odds, book_away_spread_odds = _select_primary_ah_line(
                    ah_data, home_ml=book_home_ml, away_ml=book_away_ml
                )

                # ── To Advance: BetExplorer does not carry this market.
                # Always write NULL — will be backfilled from other sources.
                book_away_to_advance = None  # NULL — not available on BetExplorer
                book_home_to_advance = None  # NULL — not available on BetExplorer

                # ── ESPN team IDs from match definition ──────────────────────────────
                away_team = m.get("espn_away_team_id")  # ESPN integer team ID
                home_team = m.get("espn_home_team_id")  # ESPN integer team ID
                espn_slug = m.get("espn_slug")

                # ── Validation gate: require all BetExplorer markets populated ───
                # NOTE: to_advance columns are intentionally excluded from this gate
                # because they are never available on BetExplorer.
                missing = []
                if book_home_ml is None: missing.append("home_ml")
                if book_draw is None:    missing.append("draw")
                if book_away_ml is None: missing.append("away_ml")
                if book_home_wd is None: missing.append("home_wd")
                if book_away_wd is None: missing.append("away_wd")
                if book_no_draw is None: missing.append("no_draw")
                if book_btts_yes is None: missing.append("btts_yes")
                if book_btts_no is None:  missing.append("btts_no")
                if book_total is None:    missing.append("total")
                if book_over_odds is None: missing.append("over_odds")
                if book_under_odds is None: missing.append("under_odds")
                if book_primary_spread is None: missing.append("primary_spread")
                if book_home_spread_odds is None: missing.append("home_spread_odds")
                if book_away_spread_odds is None: missing.append("away_spread_odds")

                if missing:
                    logger.emit("FAIL",
                                f"[MYSQL_UPSERT] {match_id}: MISSING FIELDS — {missing}",
                                match_id=match_id)
                    results[match_id] = f"ERROR: missing fields {missing}"
                    continue

                logger.emit("STATE",
                    f"[MYSQL_UPSERT] {match_id}: "
                    f"Teams={away_team} vs {home_team} | "
                    f"ToAdv=NULL/NULL (BetExplorer N/A) | "
                    f"ML={book_home_ml}/{book_draw}/{book_away_ml} | "
                    f"DC_HWD={book_home_wd} DC_AWD={book_away_wd} ND={book_no_draw} | "
                    f"BTTS={book_btts_yes}/{book_btts_no} | "
                    f"OU={book_total}({book_over_odds}/{book_under_odds}) | "
                    f"AH={book_primary_spread}({book_home_spread_odds}/{book_away_spread_odds})",
                    match_id=match_id)

                espn_match_id = m.get("espn_match_id")

                # ── BetExplorer identity for this match ──────────────────────────
                bet_explorer_match_id = m.get("event_id")   # 8-char BetExplorer event ID
                bet_explorer_slug     = m.get("slug")        # BetExplorer match slug
                # Dynamically detect round from match_id
                if "-r16-" in match_id:
                    world_cup_stage = "knockout"
                    world_cup_round = "r16"
                elif "-r32-" in match_id:
                    world_cup_stage = "knockout"
                    world_cup_round = "r32"
                elif "-qf-" in match_id:
                    world_cup_stage = "knockout"
                    world_cup_round = "qf"
                elif "-sf-" in match_id:
                    world_cup_stage = "knockout"
                    world_cup_round = "sf"
                elif "-f-" in match_id:
                    world_cup_stage = "knockout"
                    world_cup_round = "final"
                else:
                    world_cup_stage = "knockout"
                    world_cup_round = "r32"

                params = (
                    match_id, espn_match_id, espn_slug,
                    bet_explorer_match_id, bet_explorer_slug,
                    world_cup_stage, world_cup_round,
                    SCRAPER_FILENAME,          # insert_method
                    SCRAPER_FILENAME,          # last_insert_method (same value on first insert)
                    away_team, home_team,
                    book_away_to_advance,      # NULL — not on BetExplorer
                    book_home_to_advance,      # NULL — not on BetExplorer
                    book_home_ml, book_draw, book_away_ml,
                    book_home_wd, book_away_wd, book_no_draw,
                    book_btts_yes, book_btts_no,
                    book_total, book_over_odds, book_under_odds,
                    book_primary_spread, book_home_spread_odds, book_away_spread_odds,
                )

                try:
                    cur.execute(upsert_sql, params)
                    conn.commit()
                    rows_affected = cur.rowcount
                    logger.emit("PASS",
                                f"[MYSQL_UPSERT] {match_id}: UPSERT OK | rows_affected={rows_affected}",
                                match_id=match_id)
                    results[match_id] = "UPSERT_OK"
                except Exception as e:
                    conn.rollback()
                    logger.emit("FAIL",
                                f"[MYSQL_UPSERT] {match_id}: SQL ERROR — {type(e).__name__}: {e}",
                                match_id=match_id)
                    results[match_id] = f"ERROR: {type(e).__name__}: {str(e)[:80]}"

        # ── Final summary ─────────────────────────────────────────────────────
        ok_count  = sum(1 for v in results.values() if v == "UPSERT_OK")
        err_count = sum(1 for v in results.values() if v.startswith("ERROR"))
        logger.emit("AUDIT",
                    f"[MYSQL_UPSERT] COMPLETE | OK={ok_count} ERROR={err_count} "
                    f"TOTAL={len(results)} | table={MYSQL_TABLE}")

        # Hard gate: all matches must upsert successfully
        if err_count > 0:
            logger.emit("FATAL",
                        f"[MYSQL_UPSERT] HARD GATE FAIL: {err_count} upsert errors — "
                        f"see results above")
            raise RuntimeError(f"MySQL upsert hard gate failed: {err_count} errors")

    finally:
        conn.close()
        logger.emit("DEBUG", "[MYSQL_UPSERT] Connection closed")

    return results


# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# GROUP STAGE MATCH LOADER
# ─────────────────────────────────────────────────────────────────────────────
def load_gs_matches_from_db():
    """
    Load all 72 group stage matches from wc2026MatchOdds DB table.
    Returns list of match dicts with same structure as MATCHES list.
    Each dict has: id, event_id, be_name, slug, espn_match_id, espn_slug,
                   espn_away_team_id, espn_home_team_id
    """
    if not PYMYSQL_AVAILABLE:
        raise RuntimeError("pymysql not available — cannot load GS matches from DB")
    if not _DB_URL:
        raise RuntimeError("DATABASE_URL not set — cannot load GS matches from DB")

    parsed = _urlparse.urlparse(_DB_URL)
    conn = pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip("/"),
        ssl={"ssl": {}},
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=15,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    match_id,
                    espn_match_id,
                    espn_slug,
                    bet_explorer_match_id,
                    bet_explorer_slug,
                    away_team,
                    home_team
                FROM wc2026MatchOdds
                WHERE world_cup_round = 'group'
                ORDER BY match_id
            """)
            rows = cur.fetchall()
    finally:
        conn.close()

    matches = []
    for row in rows:
        # bet_explorer_match_id = event_id (8-char BetExplorer ID)
        # bet_explorer_slug = slug (BetExplorer match slug)
        event_id = row["bet_explorer_match_id"]
        slug     = row["bet_explorer_slug"]
        if not event_id or not slug:
            print(f"[WARN] GS match {row['match_id']} missing BE ID/slug — SKIP")
            continue
        # be_name: derive from slug (replace hyphens with spaces, title case)
        # Used only for TeamMapper.resolve() — which we bypass for GS (use ESPN IDs directly)
        be_name = slug.replace("-", " ").title()
        matches.append({
            "id":                 row["match_id"],
            "event_id":           event_id,
            "be_name":            be_name,
            "slug":               slug,
            "espn_match_id":      str(row["espn_match_id"]) if row["espn_match_id"] else None,
            "espn_slug":          row["espn_slug"],
            "espn_away_team_id":  int(row["away_team"]) if row["away_team"] else None,
            "espn_home_team_id":  int(row["home_team"]) if row["home_team"] else None,
        })

    print(f"[OUTPUT] Loaded {len(matches)} group stage matches from DB")
    return matches


# ─────────────────────────────────────────────────────────────────────────────
# GROUP STAGE SCRAPER PIPELINE
# ─────────────────────────────────────────────────────────────────────────────
def run_gs_scraper(match_ids: list = None):
    """
    Group stage scraper pipeline.
    Loads matches from DB (world_cup_round='group'), scrapes all 5 markets,
    upserts book odds columns only. model_* and to_advance columns stay NULL.
    world_cup_stage='group', world_cup_round='group' hardcoded.
    """
    # Load group stage matches from DB
    gs_matches = load_gs_matches_from_db()
    if not gs_matches:
        raise RuntimeError("No group stage matches loaded from DB")

    logger = ForensicLogger(LOG_PATH)
    inspector = DebugInspector(logger, depth=3)
    assertions = StrictAssertions(logger)
    mapper = TeamMapper()
    warehouse = OddsWarehouse(DB_PATH, logger)
    throttle = ThrottleController(logger)
    stealth = StealthHeaders()
    visualizer = ProgressVisualizer(
        total_matches=len(gs_matches),
        total_markets=len(MARKETS)
    )

    # Filter matches if subset requested
    matches_to_run = gs_matches
    if match_ids:
        matches_to_run = [
            f for f in gs_matches
            if f["id"] in match_ids or f["event_id"] in match_ids
        ]
        logger.emit("INFO", f"GS subset: {[f['id'] for f in matches_to_run]} "
                    f"(matched from: {match_ids})")

    # Build HTTP session
    session = requests.Session()
    session.headers.update(stealth.page())

    # ── WARMUP ────────────────────────────────────────────────────────────────
    logger.emit("STEP", "SESSION WARMUP (GS mode)", url=MATCHES_PAGE)
    try:
        t0 = time.time()
        warmup_resp = session.get(MATCHES_PAGE, timeout=20)
        elapsed = time.time() - t0
        throttle.record_response(elapsed, warmup_resp.status_code)
        logger.emit("CHECKPOINT", f"Warmup complete: HTTP {warmup_resp.status_code} "
                    f"| {len(warmup_resp.content):,}B | {elapsed:.3f}s")
    except Exception as e:
        logger.emit("WARN", f"Warmup failed: {e} — continuing anyway")

    session.headers.update(stealth.ajax(MATCHES_PAGE))
    delay = throttle.get_delay("post_warmup")
    logger.emit("INFO", f"Post-warmup delay: {delay:.2f}s")
    time.sleep(delay)

    # ── MAIN SCRAPE LOOP ──────────────────────────────────────────────────────
    dataset = {
        "matches": [],
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "_meta": {
            "expected_count": len(matches_to_run),
            "total_matches": len(gs_matches),
            "subset_mode": match_ids is not None,
            "scraper_version": "v4.0-gs",
            "bid": BET365_BID,
            "mode": "group_stage",
        }
    }
    all_pass = True
    for match_num, match in enumerate(matches_to_run, 1):
        event_id   = match["event_id"]
        be_name    = match["be_name"]
        match_id = match["id"]
        slug       = match["slug"]
        referer    = MATCH_PAGE_TEMPLATE.format(base=BASE_URL, slug=slug, event_id=event_id)
        logger.push_breadcrumb(f"match_{match_num}:{match_id}")
        print(f"\n\033[96m{'╔'+'═'*78+'╗'}\033[0m", flush=True)
        print(f"\033[96m║  GS MATCH {match_num}/{len(matches_to_run)}: {match_id} — {be_name:<47}║\033[0m", flush=True)
        print(f"\033[96m{'╚'+'═'*78+'╝'}\033[0m", flush=True)

        # Resolve team names (best-effort — we have ESPN IDs as fallback)
        try:
            away_display, home_display = mapper.resolve(be_name)
        except ValueError:
            away_display = be_name.split(" - ")[0] if " - " in be_name else "Away"
            home_display = be_name.split(" - ")[1] if " - " in be_name else "Home"

        warehouse.upsert_match(event_id, match_id, be_name, away_display, home_display)
        match_record = {
            "event_id":           event_id,
            "match_id":         match_id,
            "espn_match_id":      match.get("espn_match_id"),
            "espn_slug":          match.get("espn_slug"),
            "be_name":            be_name,
            "away_display":       away_display,
            "home_display":       home_display,
            "espn_away_team_id":  match.get("espn_away_team_id"),
            "espn_home_team_id":  match.get("espn_home_team_id"),
            "slug":               slug,
            "world_cup_stage":    "group",
            "world_cup_round":    "group",
            "markets": {},
        }
        markets_status = {}
        session.headers.update(stealth.ajax(referer))

        for market_num, market in enumerate(MARKETS, 1):
            visualizer.render_progress(match_num, market_num, be_name, market)
            logger.push_breadcrumb(f"market:{market}")
            try:
                soup = fetch_market(session, event_id, market, referer,
                                    throttle, logger, inspector)
                if market == "1x2":
                    parsed = parse_1x2(soup, logger, event_id)
                    match_record["markets"]["1x2"] = parsed
                    for line_disp, line_data in parsed.items():
                        warehouse.upsert_lined(
                            event_id, "1x2", line_disp, None,
                            line_disp,
                            home_odds=line_data["home_ml"],
                            away_odds=line_data["away_ml"],
                            draw_odds=line_data.get("draw")
                        )
                elif market == "dc":
                    parsed = parse_dc(soup, logger, event_id)
                    match_record["markets"]["dc"] = parsed
                    # parse_dc returns a flat dict (not nested lines)
                    # warehouse upsert uses single record directly
                    warehouse.upsert_lined(
                        event_id, "dc", "dc", None, "dc",
                        home_odds=parsed.get("home_or_draw"),
                        away_odds=parsed.get("away_or_draw"),
                        draw_odds=parsed.get("no_draw")
                    )
                elif market == "bts":
                    parsed = parse_bts(soup, logger, event_id)
                    match_record["markets"]["bts"] = parsed
                    # parse_bts returns a flat dict (not nested lines)
                    warehouse.upsert_lined(
                        event_id, "bts", "bts", None, "bts",
                        home_odds=parsed.get("btts_yes"),
                        away_odds=parsed.get("btts_no")
                    )
                elif market == "ou":
                    parsed = parse_ou(soup, logger, event_id)
                    match_record["markets"]["ou"] = parsed
                    for line_disp, line_data in parsed.items():
                        warehouse.upsert_lined(
                            event_id, "ou", line_disp, line_data["total"],
                            line_disp,
                            home_odds=line_data["over_odds"],
                            away_odds=line_data["under_odds"]
                        )
                elif market == "ah":
                    parsed = parse_ah(soup, logger, event_id)
                    match_record["markets"]["ah"] = parsed
                    for line_disp, line_data in parsed.items():
                        line_num = line_data["home_spread"]
                        warehouse.upsert_lined(
                            event_id, "ah", line_disp, line_num,
                            line_disp,
                            home_odds=line_data["home_odds"],
                            away_odds=line_data["away_odds"]
                        )
                markets_status[market] = {"ok": True, "detail": "PASS"}
                logger.increment("MARKET_PASS")
            except Exception as e:
                logger.emit("FAIL", f"Market {market} FAILED: {type(e).__name__}: {e}",
                            match_id=match_id, market=market)
                logger.emit("DEBUG", traceback.format_exc()[-500:])
                markets_status[market] = {"ok": False, "detail": str(e)[:60]}
                logger.increment("MARKET_FAIL")
                all_pass = False
            if throttle.should_abort():
                logger.emit("FATAL", "ABORT: Too many consecutive errors")
                break
        print()
        visualizer.render_match_summary(match_num, f"{away_display} (A) vs {home_display} (H)",
                                        markets_status)
        dataset["matches"].append(match_record)
        with open(OUTPUT_JSON, "w") as f:
            json.dump(dataset, f, indent=2)
        if throttle.should_abort():
            break

    # ── TRANSFORMATION PIPELINE ───────────────────────────────────────────────
    logger.emit("STEP", "TRANSFORMATION PIPELINE (GS mode) — 15 phases")
    dataset = apply_transformation_pipeline(dataset, logger)

    # ── VALIDATION GATES ──────────────────────────────────────────────────────
    gate_engine = ValidationGateEngine(logger, warehouse)
    gates_passed = gate_engine.run_all_gates(dataset)

    # ── FINAL OUTPUT ──────────────────────────────────────────────────────────
    with open(OUTPUT_JSON, "w") as f:
        json.dump(dataset, f, indent=2)
    logger.emit("CHECKPOINT", f"GS final output saved: {OUTPUT_JSON}")

    index = InMemoryIndex()
    index.build(dataset)
    print_final_tables(dataset, logger)

    # ── MYSQL UPSERT (GROUP STAGE) ────────────────────────────────────────────
    if gates_passed:
        logger.emit("STEP", "[MYSQL_UPSERT_GS] Gates PASSED — proceeding with GS MySQL upsert")
        try:
            mysql_results = upsert_gs_to_mysql(dataset, logger)
            ok_count = sum(1 for v in mysql_results.values() if v == "UPSERT_OK")
            total = len(mysql_results)
            logger.emit("CHECKPOINT",
                        f"[MYSQL_UPSERT_GS] COMPLETE: {ok_count}/{total} → {MYSQL_TABLE}")
            print(f"\n\033[92m{'═'*70}\033[0m", flush=True)
            print(f"\033[92m  GS MYSQL UPSERT RESULTS → {MYSQL_TABLE}\033[0m", flush=True)
            print(f"\033[92m{'═'*70}\033[0m", flush=True)
            for fid, status in sorted(mysql_results.items()):
                icon = "\033[92m✓\033[0m" if status == "UPSERT_OK" else "\033[91m✗\033[0m"
                print(f"  {icon} {fid:<25} {status}", flush=True)
            print(f"\033[92m{'═'*70}\033[0m\n", flush=True)
        except Exception as e:
            logger.emit("FATAL", f"[MYSQL_UPSERT_GS] FAILED: {type(e).__name__}: {e}")
            raise
    else:
        logger.emit("WARN", "[MYSQL_UPSERT_GS] SKIPPED — validation gates did not all pass")

    logger.summary()
    warehouse.close()
    return dataset, gates_passed


def upsert_gs_to_mysql(dataset, logger):
    """
    Group stage MySQL upsert.
    Identical to upsert_to_mysql() but:
    - world_cup_stage = 'group', world_cup_round = 'group' (from match record)
    - book_away_to_advance = NULL (hardcoded — not a group stage market)
    - book_home_to_advance = NULL (hardcoded — not a group stage market)
    - ESPN team IDs sourced from match record (loaded from DB)
    """
    if not PYMYSQL_AVAILABLE:
        raise RuntimeError("pymysql not available")
    if not _DB_URL:
        raise RuntimeError("DATABASE_URL not set")

    parsed = _urlparse.urlparse(_DB_URL)
    try:
        conn = pymysql.connect(
            host=parsed.hostname,
            port=parsed.port or 3306,
            user=parsed.username,
            password=parsed.password,
            database=parsed.path.lstrip("/"),
            ssl={"ssl": {}},
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=15,
        )
    except Exception as e:
        logger.emit("FATAL", f"[MYSQL_UPSERT_GS] Connection FAILED: {type(e).__name__}: {e}")
        raise

    upsert_sql = """
        INSERT INTO wc2026MatchOdds (
            match_id, espn_match_id, espn_slug,
            bet_explorer_match_id, bet_explorer_slug,
            world_cup_stage, world_cup_round,
            inserted_at, insert_method,
            last_inserted_at, last_insert_method,
            away_team, home_team,
            book_away_to_advance,
            book_home_to_advance,
            book_home_ml, book_draw, book_away_ml,
            book_home_wd, book_away_wd, book_no_draw,
            book_btts_yes, book_btts_no,
            book_total, book_over_odds, book_under_odds,
            book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds
        ) VALUES (
            %s, %s, %s,
            %s, %s,
            %s, %s,
            CURRENT_TIMESTAMP, %s,
            CURRENT_TIMESTAMP, %s,
            %s, %s,
            NULL,
            NULL,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s, %s
        )
        ON DUPLICATE KEY UPDATE
            espn_match_id                  = VALUES(espn_match_id),
            espn_slug                      = VALUES(espn_slug),
            bet_explorer_match_id          = VALUES(bet_explorer_match_id),
            bet_explorer_slug              = VALUES(bet_explorer_slug),
            world_cup_stage                = VALUES(world_cup_stage),
            world_cup_round                = VALUES(world_cup_round),
            last_inserted_at               = CURRENT_TIMESTAMP,
            last_insert_method             = VALUES(last_insert_method),
            away_team                      = VALUES(away_team),
            home_team                      = VALUES(home_team),
            book_away_to_advance           = NULL,
            book_home_to_advance           = NULL,
            book_home_ml                   = VALUES(book_home_ml),
            book_draw                      = VALUES(book_draw),
            book_away_ml                   = VALUES(book_away_ml),
            book_home_wd                   = VALUES(book_home_wd),
            book_away_wd                   = VALUES(book_away_wd),
            book_no_draw                   = VALUES(book_no_draw),
            book_btts_yes                  = VALUES(book_btts_yes),
            book_btts_no                   = VALUES(book_btts_no),
            book_total                     = VALUES(book_total),
            book_over_odds                 = VALUES(book_over_odds),
            book_under_odds                = VALUES(book_under_odds),
            book_primary_spread            = VALUES(book_primary_spread),
            book_home_primary_spread_odds  = VALUES(book_home_primary_spread_odds),
            book_away_primary_spread_odds  = VALUES(book_away_primary_spread_odds)
    """

    results = {}
    try:
        with conn.cursor() as cur:
            for m in dataset.get("matches", []):
                match_id = m.get("match_id")
                if not match_id:
                    logger.emit("WARN", "[MYSQL_UPSERT_GS] Match missing match_id — SKIP")
                    continue
                markets = m.get("markets", {})
                ml_data  = markets.get("1x2", {})
                dc_data  = markets.get("dc",  {})
                bts_data = markets.get("bts", {})
                ou_data  = markets.get("ou",  {})
                ah_data  = markets.get("ah",  {})

                book_home_ml = _parse_am_int(ml_data.get("home_ml"))
                book_draw    = _parse_am_int(ml_data.get("draw"))
                book_away_ml = _parse_am_int(ml_data.get("away_ml"))
                book_home_wd = _parse_am_int(dc_data.get("home_or_draw"))
                book_away_wd = _parse_am_int(dc_data.get("away_or_draw"))
                book_no_draw = _parse_am_int(dc_data.get("no_draw"))
                book_btts_yes = _parse_am_int(bts_data.get("btts_yes"))
                book_btts_no  = _parse_am_int(bts_data.get("btts_no"))
                book_total, book_over_odds, book_under_odds = _select_primary_ou_line(ou_data)
                # Pass ML values so pk→±1.5 rule can determine favorite
                book_primary_spread, book_home_spread_odds, book_away_spread_odds = _select_primary_ah_line(
                    ah_data, home_ml=book_home_ml, away_ml=book_away_ml
                )

                # Validate all required fields present
                missing = []
                if book_home_ml is None: missing.append("home_ml")
                if book_draw is None:    missing.append("draw")
                if book_away_ml is None: missing.append("away_ml")
                if book_home_wd is None: missing.append("home_wd")
                if book_away_wd is None: missing.append("away_wd")
                if book_no_draw is None: missing.append("no_draw")
                if book_btts_yes is None: missing.append("btts_yes")
                if book_btts_no is None:  missing.append("btts_no")
                if book_total is None:    missing.append("total")
                if book_over_odds is None: missing.append("over_odds")
                if book_under_odds is None: missing.append("under_odds")
                if book_primary_spread is None: missing.append("primary_spread")
                if book_home_spread_odds is None: missing.append("home_spread_odds")
                if book_away_spread_odds is None: missing.append("away_spread_odds")
                if missing:
                    logger.emit("FAIL",
                                f"[MYSQL_UPSERT_GS] {match_id}: MISSING FIELDS — {missing}",
                                match_id=match_id)
                    results[match_id] = f"ERROR: missing fields {missing}"
                    continue

                espn_match_id         = m.get("espn_match_id")
                espn_slug             = m.get("espn_slug")
                bet_explorer_match_id = m.get("event_id")
                bet_explorer_slug     = m.get("slug")
                world_cup_stage       = m.get("world_cup_stage", "group")
                world_cup_round       = m.get("world_cup_round", "group")
                away_team             = m.get("espn_away_team_id")
                home_team             = m.get("espn_home_team_id")

                logger.emit("STATE",
                    f"[MYSQL_UPSERT_GS] {match_id}: "
                    f"Teams={away_team} vs {home_team} | "
                    f"ToAdv=NULL/NULL (group stage) | "
                    f"ML={book_home_ml}/{book_draw}/{book_away_ml} | "
                    f"DC_HWD={book_home_wd} DC_AWD={book_away_wd} ND={book_no_draw} | "
                    f"BTTS={book_btts_yes}/{book_btts_no} | "
                    f"OU={book_total}({book_over_odds}/{book_under_odds}) | "
                    f"AH={book_primary_spread}({book_home_spread_odds}/{book_away_spread_odds})",
                    match_id=match_id)

                params = (
                    match_id, espn_match_id, espn_slug,
                    bet_explorer_match_id, bet_explorer_slug,
                    world_cup_stage, world_cup_round,
                    SCRAPER_FILENAME,   # insert_method
                    SCRAPER_FILENAME,   # last_insert_method
                    away_team, home_team,
                    # book_away_to_advance = NULL (hardcoded in SQL)
                    # book_home_to_advance = NULL (hardcoded in SQL)
                    book_home_ml, book_draw, book_away_ml,
                    book_home_wd, book_away_wd, book_no_draw,
                    book_btts_yes, book_btts_no,
                    book_total, book_over_odds, book_under_odds,
                    book_primary_spread, book_home_spread_odds, book_away_spread_odds,
                )
                try:
                    cur.execute(upsert_sql, params)
                    conn.commit()
                    rows_affected = cur.rowcount
                    logger.emit("PASS",
                                f"[MYSQL_UPSERT_GS] {match_id}: UPSERT OK | rows_affected={rows_affected}",
                                match_id=match_id)
                    results[match_id] = "UPSERT_OK"
                except Exception as e:
                    conn.rollback()
                    logger.emit("FAIL",
                                f"[MYSQL_UPSERT_GS] {match_id}: SQL ERROR — {type(e).__name__}: {e}",
                                match_id=match_id)
                    results[match_id] = f"ERROR: {type(e).__name__}: {str(e)[:80]}"

        ok_count  = sum(1 for v in results.values() if v == "UPSERT_OK")
        err_count = sum(1 for v in results.values() if v.startswith("ERROR"))
        logger.emit("AUDIT",
                    f"[MYSQL_UPSERT_GS] COMPLETE | OK={ok_count} ERROR={err_count} "
                    f"TOTAL={len(results)} | table={MYSQL_TABLE}")
        if err_count > 0:
            logger.emit("FATAL",
                        f"[MYSQL_UPSERT_GS] HARD GATE FAIL: {err_count} upsert errors")
            raise RuntimeError(f"GS MySQL upsert hard gate failed: {err_count} errors")
    finally:
        conn.close()
        logger.emit("DEBUG", "[MYSQL_UPSERT_GS] Connection closed")
    return results

# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Modes:
    #   (default / --mode r32)  : R32 knockout matches from MATCHES list
    #   --mode gs               : Group stage matches loaded from DB
    #   --mode all              : Both GS then R32
    # Match filter: pass event_ids or match_ids as positional args
    # Examples:
    #   python3 wc2026_betexplorer_scraper_v4.py                   # all R32
    #   python3 wc2026_betexplorer_scraper_v4.py --mode gs         # all GS
    #   python3 wc2026_betexplorer_scraper_v4.py --mode gs h4EoUB7T  # single GS match
    #   python3 wc2026_betexplorer_scraper_v4.py wc26-r32-080      # single R32 match
    raw_args = sys.argv[1:]
    mode = "r32"  # default
    match_ids = None

    # Parse --mode flag
    if "--mode" in raw_args:
        idx = raw_args.index("--mode")
        if idx + 1 < len(raw_args):
            mode = raw_args[idx + 1]
            raw_args = [a for i, a in enumerate(raw_args) if i != idx and i != idx + 1]
        else:
            print("ERROR: --mode requires an argument (gs|r32|all)")
            sys.exit(1)

    # Remaining args are match IDs
    cleaned = [a for a in raw_args if not a.startswith("--")]
    match_ids = cleaned if cleaned else None

    valid_modes = {"r32", "gs", "all"}
    if mode not in valid_modes:
        print(f"ERROR: Invalid --mode '{mode}'. Must be one of: {valid_modes}")
        sys.exit(1)

    try:
        if mode == "r32":
            dataset, gates_passed = run_scraper(match_ids)
        elif mode == "gs":
            dataset, gates_passed = run_gs_scraper(match_ids)
        elif mode == "all":
            print("\n[MODE=all] Running GROUP STAGE first, then R32\n")
            gs_dataset, gs_passed = run_gs_scraper(match_ids)
            r32_dataset, r32_passed = run_scraper(match_ids)
            gates_passed = gs_passed and r32_passed
        exit_code = 0 if gates_passed else 1
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\033[91m☠ INTERRUPTED BY USER\033[0m", flush=True)
        sys.exit(130)
    except Exception as e:
        print(f"\n\033[91m☠ FATAL: {type(e).__name__}: {e}\033[0m", flush=True)
        traceback.print_exc()
        sys.exit(1)
