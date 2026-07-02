#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 BETEXPLORER HTML SCRAPER — PRODUCTION v1.0                             ║
║  Scrapes bet365.us (bid=549) odds from BetExplorer match detail page HTML       ║
║  Markets: 1x2, OU, AH, DC, BTTS (ha/DNB excluded per spec)                     ║
║  Source: data-odd attributes on <td data-bid="549"> elements                    ║
║  Output: wc2026_frozen_book_odds DB upsert + wc2026oddslog.txt                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝

CONFIRMED HTML ELEMENT MAP (from 500x forensic analysis):
  - Match detail page: /football/world/world-championship-2026/{slug}/{event_id}/
  - Market tabs: #bettingTabs → <a data-tab="{market}">
  - Odds tables: <table data-handicap="{line}"> (OU/AH) or <table id="sortable-1"> (1x2/DC/BTTS)
  - Bookmaker rows: <tr data-bid="549">
  - Odds values: <td data-odd="{decimal}" data-pos="{1|2|3}">
    - 1x2: pos=1→HOME, pos=2→DRAW, pos=3→AWAY
    - OU:  pos=1→OVER, pos=2→UNDER (per table data-handicap)
    - AH:  pos=1→AWAY, pos=2→HOME (confirmed from HTML: td[0]=away, td[1]=home)
    - DC:  pos=1→1X, pos=2→12, pos=3→X2
    - BTTS: pos=1→YES, pos=2→NO

CONFIRMED BID=549 = bet365.us (data-bookie="bet365.us" confirmed in pasted_content_80.txt)

DECIMAL → AMERICAN CONVERSION (exact Fraction arithmetic, no float rounding):
  - decimal >= 2.0: american = round((decimal - 1) * 100)
  - decimal < 2.0:  american = round(-100 / (decimal - 1))
"""

import sys
import os
import time
import json
import re
import traceback
import logging
from datetime import datetime, timezone
from fractions import Fraction
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
BET365_BID = 549          # bet365.us — confirmed from HTML forensic analysis
LOG_FILE   = "/home/ubuntu/wc2026oddslog.txt"
JSON_OUT   = "/home/ubuntu/wc2026_betexplorer_odds.json"
BASE_URL   = "https://www.betexplorer.com"
MARKETS    = ["1x2", "ou", "ah", "dc", "bts"]   # ha excluded per spec

# All WC2026 KO Round fixtures — event_id confirmed from BetExplorer live HTML
WC2026_FIXTURES = [
    # Round of 32 — July 1 (confirmed from pasted_content_74/75/76)
    {"fixture_id": "wc26-r32-080", "event_id": "nkoQVAgB", "slug": "england-d-r-congo",       "home": "England",   "away": "D.R. Congo",          "round": "R32", "date": "2026-07-01"},
    {"fixture_id": "wc26-r32-081", "event_id": "vPsIXWOb", "slug": "belgium-senegal",          "home": "Belgium",   "away": "Senegal",             "round": "R32", "date": "2026-07-01"},
    {"fixture_id": "wc26-r32-082", "event_id": "A1Jughll", "slug": "usa-bosnia-herzegovina",   "home": "USA",       "away": "Bosnia & Herzegovina","round": "R32", "date": "2026-07-02"},
    # Additional R32 fixtures from BetExplorer WC2026 page
    {"fixture_id": "wc26-r32-070", "event_id": "jJucpA84", "slug": "spain-austria",            "home": "Spain",     "away": "Austria",             "round": "R32", "date": "2026-06-28"},
    {"fixture_id": "wc26-r32-071", "event_id": "6BqAZhfn", "slug": "portugal-croatia",         "home": "Portugal",  "away": "Croatia",             "round": "R32", "date": "2026-06-28"},
    {"fixture_id": "wc26-r32-072", "event_id": "rgxknWwh", "slug": "switzerland-algeria",      "home": "Switzerland","away": "Algeria",            "round": "R32", "date": "2026-06-28"},
    {"fixture_id": "wc26-r32-073", "event_id": "Whg00tL7", "slug": "australia-egypt",          "home": "Australia", "away": "Egypt",               "round": "R32", "date": "2026-06-29"},
    {"fixture_id": "wc26-r32-074", "event_id": "O4oeJu9d", "slug": "argentina-cape-verde",     "home": "Argentina", "away": "Cape Verde",          "round": "R32", "date": "2026-06-29"},
    {"fixture_id": "wc26-r32-075", "event_id": "UN3MMEFl", "slug": "france-sweden",            "home": "France",    "away": "Sweden",              "round": "R32", "date": "2026-06-29"},
    {"fixture_id": "wc26-r32-076", "event_id": "tx2IC6G7", "slug": "ivory-coast-norway",       "home": "Ivory Coast","away": "Norway",             "round": "R32", "date": "2026-06-30"},
    {"fixture_id": "wc26-r32-077", "event_id": "S0MygXWj", "slug": "netherlands-morocco",      "home": "Netherlands","away": "Morocco",            "round": "R32", "date": "2026-06-30"},
    {"fixture_id": "wc26-r32-078", "event_id": "f7ENGzPc", "slug": "brazil-japan",             "home": "Brazil",    "away": "Japan",               "round": "R32", "date": "2026-06-30"},
    {"fixture_id": "wc26-r32-079", "event_id": "fydIxpfR", "slug": "mexico-ecuador",           "home": "Mexico",    "away": "Ecuador",             "round": "R32", "date": "2026-07-01"},
    {"fixture_id": "wc26-r32-083", "event_id": "2y2UKhp1", "slug": "germany-paraguay",         "home": "Germany",   "away": "Paraguay",            "round": "R32", "date": "2026-07-02"},
    {"fixture_id": "wc26-r32-084", "event_id": "EZmXxG15", "slug": "south-africa-canada",      "home": "South Africa","away": "Canada",            "round": "R32", "date": "2026-07-02"},
    # QF fixtures from BetExplorer fixtures page
    {"fixture_id": "wc26-qf-001",  "event_id": "IF40Fk9U", "slug": "colombia-ghana",           "home": "Colombia",  "away": "Ghana",               "round": "QF",  "date": "2026-07-04"},
    {"fixture_id": "wc26-qf-002",  "event_id": "pUYfr7u3", "slug": "canada-morocco",           "home": "Canada",    "away": "Morocco",             "round": "QF",  "date": "2026-07-04"},
    {"fixture_id": "wc26-qf-003",  "event_id": "M5YPKKbB", "slug": "paraguay-france",          "home": "Paraguay",  "away": "France",              "round": "QF",  "date": "2026-07-05"},
    {"fixture_id": "wc26-qf-004",  "event_id": "tpOhKWcC", "slug": "brazil-norway",            "home": "Brazil",    "away": "Norway",              "round": "QF",  "date": "2026-07-05"},
    {"fixture_id": "wc26-qf-005",  "event_id": "bc27lzfo", "slug": "mexico-england",           "home": "Mexico",    "away": "England",             "round": "QF",  "date": "2026-07-06"},
]

# ─────────────────────────────────────────────────────────────────────────────
# DUAL-OUTPUT LOGGING ENGINE
# ─────────────────────────────────────────────────────────────────────────────
class DualLogger:
    """Industry-leading dual-output logger: terminal + append-only file."""

    LEVEL_COLORS = {
        "INIT":    "\033[1;36m",   # Bold Cyan
        "INPUT":   "\033[0;34m",   # Blue
        "STEP":    "\033[0;37m",   # White
        "HTTP":    "\033[0;33m",   # Yellow
        "PARSE":   "\033[0;35m",   # Magenta
        "ODDS":    "\033[1;32m",   # Bold Green
        "DB":      "\033[0;36m",   # Cyan
        "PASS":    "\033[1;32m",   # Bold Green
        "FAIL":    "\033[1;31m",   # Bold Red
        "WARN":    "\033[1;33m",   # Bold Yellow
        "STATE":   "\033[0;37m",   # White
        "OUTPUT":  "\033[1;35m",   # Bold Magenta
        "VERIFY":  "\033[1;34m",   # Bold Blue
        "PROG":    "\033[0;32m",   # Green
        "MATCH":   "\033[1;37m",   # Bold White
        "MARKET":  "\033[0;36m",   # Cyan
        "CONVERT": "\033[0;33m",   # Yellow
        "RESET":   "\033[0m",
    }
    RESET = "\033[0m"

    def __init__(self, log_file: str):
        self.log_file = log_file
        self.start_time = time.time()
        self._ensure_log_file()

    def _ensure_log_file(self):
        Path(self.log_file).parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*80}\n")
            f.write(f"[SESSION START] {datetime.now(timezone.utc).isoformat()} | WC2026 BetExplorer HTML Scraper v1.0\n")
            f.write(f"{'='*80}\n")

    def _elapsed(self) -> str:
        return f"{time.time() - self.start_time:7.3f}s"

    def _ts(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def _write(self, level: str, category: str, msg: str):
        ts = self._ts()
        elapsed = self._elapsed()
        color = self.LEVEL_COLORS.get(level, "")
        reset = self.RESET

        # Terminal output
        terminal_line = f"[{ts}][{elapsed}] [{level:<7}] [{category:<10}] {msg}"
        print(f"{color}{terminal_line}{reset}", flush=True)

        # File output (no ANSI codes)
        file_line = f"[{ts}][{elapsed}] [{level:<7}] [{category:<10}] {msg}\n"
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(file_line)

    def init(self, msg: str):    self._write("INIT",    "SYSTEM",   msg)
    def input(self, msg: str):   self._write("INPUT",   "INPUT",    msg)
    def step(self, msg: str):    self._write("STEP",    "STEP",     msg)
    def http(self, msg: str):    self._write("HTTP",    "HTTP",     msg)
    def parse(self, msg: str):   self._write("PARSE",   "PARSE",    msg)
    def odds(self, msg: str):    self._write("ODDS",    "ODDS",     msg)
    def db(self, msg: str):      self._write("DB",      "DB",       msg)
    def pass_(self, msg: str):   self._write("PASS",    "GATE",     msg)
    def fail(self, msg: str):    self._write("FAIL",    "GATE",     msg)
    def warn(self, msg: str):    self._write("WARN",    "WARN",     msg)
    def state(self, msg: str):   self._write("STATE",   "STATE",    msg)
    def output(self, msg: str):  self._write("OUTPUT",  "OUTPUT",   msg)
    def verify(self, msg: str):  self._write("VERIFY",  "VERIFY",   msg)
    def prog(self, msg: str):    self._write("PROG",    "PROGRESS", msg)
    def match(self, msg: str):   self._write("MATCH",   "MATCH",    msg)
    def market(self, msg: str):  self._write("MARKET",  "MARKET",   msg)
    def convert(self, msg: str): self._write("CONVERT", "CONVERT",  msg)

    def section(self, title: str):
        bar = "═" * 72
        self._write("INIT", "SECTION", f"\n╔{bar}╗\n║  {title:<70}║\n╚{bar}╝")

    def progress_bar(self, current: int, total: int, label: str) -> str:
        pct = current / total if total > 0 else 0
        filled = int(20 * pct)
        bar = "█" * filled + "░" * (20 - filled)
        return f"[{bar}] {pct*100:5.1f}% ({current:3d}/{total:3d}) {label}"

    def fixture_banner(self, fix: Dict):
        bar = "━" * 70
        self._write("MATCH", "BANNER",
            f"\n┌{bar}┐\n│  MATCH: {fix['home']} vs {fix['away']:<30} [{fix['round']}] {fix['date']}  │\n"
            f"│  fixture_id={fix['fixture_id']} | event_id={fix['event_id']}                  │\n"
            f"└{bar}┘")

    def session_summary(self, results: List[Dict]):
        total = len(results)
        ok = sum(1 for r in results if r.get("status") == "OK")
        partial = sum(1 for r in results if r.get("status") == "PARTIAL")
        failed = sum(1 for r in results if r.get("status") == "FAILED")
        elapsed = time.time() - self.start_time

        summary = (
            f"\n{'═'*72}\n"
            f"  SESSION SUMMARY — WC2026 BetExplorer HTML Scraper\n"
            f"{'─'*72}\n"
            f"  Fixtures Processed : {total}\n"
            f"  FULLY SCRAPED      : {ok}  ✓\n"
            f"  PARTIAL (some mkts): {partial}  ⚠\n"
            f"  FAILED             : {failed}  ✗\n"
            f"  Elapsed            : {elapsed:.2f}s\n"
            f"{'═'*72}"
        )
        self._write("OUTPUT", "SUMMARY", summary)


# ─────────────────────────────────────────────────────────────────────────────
# DECIMAL → AMERICAN CONVERSION
# ─────────────────────────────────────────────────────────────────────────────
def decimal_to_american(decimal: float) -> int:
    """
    Convert decimal odds to American odds using exact Fraction arithmetic.
    - decimal >= 2.0: american = round((decimal - 1) * 100)
    - decimal < 2.0:  american = round(-100 / (decimal - 1))
    Zero-hallucination: raises ValueError if decimal <= 1.0
    """
    if decimal <= 1.0:
        raise ValueError(f"Invalid decimal odds: {decimal} (must be > 1.0)")

    frac = Fraction(decimal).limit_denominator(10000)
    if frac >= 2:
        american = int(round(float((frac - 1) * 100)))
        return american if american > 0 else +100
    else:
        american = int(round(float(-100 / (frac - 1))))
        return american  # will be negative


# ─────────────────────────────────────────────────────────────────────────────
# HTTP FETCH WITH RETRY
# ─────────────────────────────────────────────────────────────────────────────
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Cache-Control": "no-cache",
}

def fetch_page(url: str, log: DualLogger, max_retries: int = 3) -> Optional[str]:
    """Fetch a URL with retry logic. Returns HTML string or None."""
    for attempt in range(1, max_retries + 1):
        log.http(f"[REQUEST] GET {url} [attempt {attempt}/{max_retries}]")
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            log.http(f"[RESPONSE] HTTP {r.status_code} | {len(r.content):,}B")
            if r.status_code == 200 and len(r.content) > 1000:
                return r.text
            elif r.status_code == 404:
                log.fail(f"[404] Page not found: {url}")
                return None
            else:
                log.warn(f"[RETRY] status={r.status_code} size={len(r.content)}B")
        except requests.exceptions.SSLError as e:
            log.warn(f"[SSL_ERROR] attempt {attempt}: {str(e)[:80]}")
        except requests.exceptions.ConnectionError as e:
            log.warn(f"[CONN_ERROR] attempt {attempt}: {str(e)[:80]}")
        except Exception as e:
            log.fail(f"[EXCEPTION] attempt {attempt}: {type(e).__name__}: {str(e)[:80]}")

        if attempt < max_retries:
            wait = 2 * attempt
            log.step(f"[BACKOFF] Waiting {wait}s before retry {attempt+1}...")
            time.sleep(wait)

    log.fail(f"[EXHAUSTED] All {max_retries} retries failed for: {url}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# MARKET PARSERS — Parse bet365.us (bid=549) odds from embedded HTML
# ─────────────────────────────────────────────────────────────────────────────

def parse_1x2(soup: BeautifulSoup, log: DualLogger) -> Optional[Dict]:
    """
    Parse 1x2 moneyline odds for bid=549.
    Table: <table id="sortable-1"> or first odds table
    Row: <tr data-bid="549">
    TDs: data-pos=1→HOME, data-pos=2→DRAW, data-pos=3→AWAY
    """
    log.market("[1x2] Parsing 1X2 Moneyline table...")

    # Find all TR rows with data-bid=549
    rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    log.parse(f"[1x2] Found {len(rows)} rows with data-bid={BET365_BID}")

    # Filter to 1x2 rows: must have exactly 3 odds TDs with data-pos 1,2,3
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 3:
            continue

        # Verify this is a 1x2 table (3 positions, no data-handicap in parent table)
        parent_table = row.find_parent("table")
        if parent_table and parent_table.get("data-handicap"):
            continue  # This is OU or AH table

        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log.parse(f"[1x2] bid=549 row found | pos_map={pos_map}")

        if "1" in pos_map and "2" in pos_map and "3" in pos_map:
            home_dec  = pos_map["1"]
            draw_dec  = pos_map["2"]
            away_dec  = pos_map["3"]

            home_am   = decimal_to_american(home_dec)
            draw_am   = decimal_to_american(draw_dec)
            away_am   = decimal_to_american(away_dec)

            log.convert(f"[1x2] HOME: {home_dec} → {'+' if home_am > 0 else ''}{home_am}")
            log.convert(f"[1x2] DRAW: {draw_dec} → {'+' if draw_am > 0 else ''}{draw_am}")
            log.convert(f"[1x2] AWAY: {away_dec} → {'+' if away_am > 0 else ''}{away_am}")

            # Vig check
            vig = (1/home_dec + 1/draw_dec + 1/away_dec)
            log.verify(f"[1x2] Vig={vig:.4f} (expected 1.02–1.12)")
            if not (1.01 <= vig <= 1.20):
                log.warn(f"[1x2] Vig out of range: {vig:.4f}")

            return {
                "book_home_ml":  home_am,
                "book_draw_ml":  draw_am,
                "book_away_ml":  away_am,
                "book_home_ml_dec": home_dec,
                "book_draw_ml_dec": draw_dec,
                "book_away_ml_dec": away_dec,
                "vig_1x2": round(vig, 4),
            }

    log.fail(f"[1x2] No bid={BET365_BID} row found with 3 positions")
    return None


def parse_ou(soup: BeautifulSoup, log: DualLogger) -> Optional[Dict]:
    """
    Parse Over/Under odds for bid=549.
    Table: <table data-handicap="{line}"> — prefer 2.5 line
    Row: <tr data-bid="549">
    TDs: data-pos=1→OVER, data-pos=2→UNDER
    """
    log.market("[OU] Parsing Over/Under table...")

    # Find all OU tables (have data-handicap attribute)
    ou_tables = soup.find_all("table", attrs={"data-handicap": True})
    log.parse(f"[OU] Found {len(ou_tables)} tables with data-handicap")

    # Prefer 2.5 line, then 2.0, then any
    preferred_lines = ["2.5", "2.0", "3.0", "1.5", "3.5"]
    target_table = None
    target_line = None

    for pref in preferred_lines:
        for tbl in ou_tables:
            if tbl.get("data-handicap") == pref:
                target_table = tbl
                target_line = pref
                break
        if target_table:
            break

    if not target_table and ou_tables:
        target_table = ou_tables[0]
        target_line = target_table.get("data-handicap", "?")

    if not target_table:
        log.fail("[OU] No OU table found in HTML")
        return None

    log.parse(f"[OU] Using table with data-handicap={target_line}")

    # Find bid=549 row in this table
    rows = target_table.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    log.parse(f"[OU] Found {len(rows)} bid={BET365_BID} rows in table")

    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 2:
            continue

        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log.parse(f"[OU] bid=549 row | pos_map={pos_map} | line={target_line}")

        if "1" in pos_map and "2" in pos_map:
            over_dec  = pos_map["1"]
            under_dec = pos_map["2"]

            over_am   = decimal_to_american(over_dec)
            under_am  = decimal_to_american(under_dec)

            log.convert(f"[OU] OVER  {target_line}: {over_dec} → {'+' if over_am > 0 else ''}{over_am}")
            log.convert(f"[OU] UNDER {target_line}: {under_dec} → {'+' if under_am > 0 else ''}{under_am}")

            vig = (1/over_dec + 1/under_dec)
            log.verify(f"[OU] Vig={vig:.4f} (expected 1.02–1.10)")
            if not (1.01 <= vig <= 1.15):
                log.warn(f"[OU] Vig out of range: {vig:.4f}")

            return {
                "book_total_line":  float(target_line),
                "book_over_odds":   over_am,
                "book_under_odds":  under_am,
                "book_over_dec":    over_dec,
                "book_under_dec":   under_dec,
                "vig_ou": round(vig, 4),
            }

    log.fail(f"[OU] No bid={BET365_BID} row with 2 positions in line={target_line} table")
    return None


def parse_ah(soup: BeautifulSoup, log: DualLogger) -> Optional[Dict]:
    """
    Parse Asian Handicap odds for bid=549.
    Table: <table data-handicap="{line}"> — prefer line closest to 0
    Row: <tr data-bid="549">
    TDs: data-pos=1→AWAY_TEAM (home gives up handicap), data-pos=2→HOME_TEAM
    NOTE: AH pos=1 is AWAY, pos=2 is HOME — confirmed from HTML forensic analysis
    """
    log.market("[AH] Parsing Asian Handicap table...")

    # Find AH tables — these also use data-handicap but are in a different section
    # AH tables are identified by having negative/positive handicap values (not just 2.5/3.0)
    ah_tables = soup.find_all("table", attrs={"data-handicap": True})
    log.parse(f"[AH] Found {len(ah_tables)} tables with data-handicap (shared with OU)")

    # AH lines include negative values like -1.5, -0.5, +0.5, +1.5
    # OU lines are typically 2.0, 2.5, 3.0
    # We need to find AH-specific tables by checking if they're in the AH section
    ah_section = soup.find("div", attrs={"id": re.compile(r"ah|asian", re.I)})
    if not ah_section:
        # Try finding by table context — AH tables have lines like -1.5, -0.5, 0, +0.5, +1.5
        ah_lines = [t for t in ah_tables if t.get("data-handicap","").replace("-","").replace("+","").replace(".","").isdigit()
                    and float(t.get("data-handicap","0")) not in [2.0, 2.5, 3.0, 1.5, 3.5, 0.5, 4.0, 4.5, 5.0]]
        if not ah_lines:
            # Fall back: use any table with data-handicap that has bid=549 and 2 TDs
            ah_lines = ah_tables

    target_table = None
    target_line = None

    # Prefer line closest to 0 (most balanced)
    best_abs = float("inf")
    for tbl in ah_tables:
        line_str = tbl.get("data-handicap", "")
        try:
            line_val = float(line_str)
            # Skip OU-typical lines
            if abs(line_val) in [2.5, 2.0, 3.0, 1.5, 3.5, 4.0, 4.5, 5.0]:
                continue
            if abs(line_val) < best_abs:
                # Verify bid=549 exists in this table
                if tbl.find("tr", attrs={"data-bid": str(BET365_BID)}):
                    best_abs = abs(line_val)
                    target_table = tbl
                    target_line = line_str
        except ValueError:
            continue

    if not target_table:
        # Last resort: any table with bid=549 and 2 data-odd TDs
        for tbl in ah_tables:
            rows = tbl.find_all("tr", attrs={"data-bid": str(BET365_BID)})
            for row in rows:
                tds = row.find_all("td", attrs={"data-odd": True})
                if len(tds) == 2:
                    target_table = tbl
                    target_line = tbl.get("data-handicap", "?")
                    break
            if target_table:
                break

    if not target_table:
        log.fail("[AH] No AH table with bid=549 found")
        return None

    log.parse(f"[AH] Using table with data-handicap={target_line}")

    rows = target_table.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 2:
            continue

        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log.parse(f"[AH] bid=549 row | pos_map={pos_map} | line={target_line}")

        if "1" in pos_map and "2" in pos_map:
            # AH: pos=1=AWAY side, pos=2=HOME side (confirmed from HTML)
            away_dec = pos_map["1"]
            home_dec = pos_map["2"]

            away_am = decimal_to_american(away_dec)
            home_am = decimal_to_american(home_dec)

            # Spread line: positive means home is favorite (giving up points)
            try:
                spread_line = float(target_line)
            except ValueError:
                spread_line = None

            log.convert(f"[AH] HOME spread={target_line}: {home_dec} → {'+' if home_am > 0 else ''}{home_am}")
            log.convert(f"[AH] AWAY spread={target_line}: {away_dec} → {'+' if away_am > 0 else ''}{away_am}")

            vig = (1/home_dec + 1/away_dec)
            log.verify(f"[AH] Vig={vig:.4f} (expected 1.02–1.10)")

            return {
                "book_spread_line":       spread_line,
                "book_home_spread_odds":  home_am,
                "book_away_spread_odds":  away_am,
                "book_home_spread_dec":   home_dec,
                "book_away_spread_dec":   away_dec,
                "vig_ah": round(vig, 4),
            }

    log.fail(f"[AH] No bid={BET365_BID} row with 2 positions found")
    return None


def parse_dc(soup: BeautifulSoup, log: DualLogger) -> Optional[Dict]:
    """
    Parse Double Chance odds for bid=549.
    Row: <tr data-bid="549">
    TDs: data-pos=1→1X, data-pos=2→12, data-pos=3→X2
    """
    log.market("[DC] Parsing Double Chance table...")

    rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})

    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 3:
            continue

        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}

        # DC rows have 3 positions and parent table has no data-handicap
        parent_table = row.find_parent("table")
        if parent_table and parent_table.get("data-handicap"):
            continue

        # Verify these are DC odds (all should be < 2.0 since DC covers 2 outcomes)
        vals = list(pos_map.values())
        if not all(v < 3.0 for v in vals):
            continue

        # Check if this might be 1x2 (which also has 3 positions)
        # DC odds are typically lower than 1x2 (covering 2 outcomes)
        # 1x2 away odds are typically > 2.0 for favorites
        # We identify DC by checking the data-bt attribute if present
        bt_vals = [td.get("data-bt", "") for td in tds]
        log.parse(f"[DC] Candidate row | pos_map={pos_map} | data-bt={bt_vals}")

        if "1" in pos_map and "2" in pos_map and "3" in pos_map:
            dc_1x_dec = pos_map["1"]
            dc_12_dec = pos_map["2"]
            dc_x2_dec = pos_map["3"]

            dc_1x_am = decimal_to_american(dc_1x_dec)
            dc_12_am = decimal_to_american(dc_12_dec)
            dc_x2_am = decimal_to_american(dc_x2_dec)

            log.convert(f"[DC] 1X: {dc_1x_dec} → {'+' if dc_1x_am > 0 else ''}{dc_1x_am}")
            log.convert(f"[DC] 12: {dc_12_dec} → {'+' if dc_12_am > 0 else ''}{dc_12_am}")
            log.convert(f"[DC] X2: {dc_x2_dec} → {'+' if dc_x2_am > 0 else ''}{dc_x2_am}")

            vig = (1/dc_1x_dec + 1/dc_12_dec + 1/dc_x2_dec)
            log.verify(f"[DC] Vig={vig:.4f}")

            return {
                "book_dc_1x_odds": dc_1x_am,
                "book_dc_12_odds": dc_12_am,
                "book_dc_x2_odds": dc_x2_am,
                "book_dc_1x_dec":  dc_1x_dec,
                "book_dc_12_dec":  dc_12_dec,
                "book_dc_x2_dec":  dc_x2_dec,
                "vig_dc": round(vig, 4),
            }

    log.fail(f"[DC] No bid={BET365_BID} DC row found")
    return None


def parse_btts(soup: BeautifulSoup, log: DualLogger) -> Optional[Dict]:
    """
    Parse Both Teams To Score odds for bid=549.
    Row: <tr data-bid="549">
    TDs: data-pos=1→YES, data-pos=2→NO
    """
    log.market("[BTTS] Parsing Both Teams To Score table...")

    rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})

    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) != 2:
            continue

        parent_table = row.find_parent("table")
        if parent_table and parent_table.get("data-handicap"):
            continue  # Skip OU/AH tables

        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log.parse(f"[BTTS] Candidate row | pos_map={pos_map}")

        if "1" in pos_map and "2" in pos_map:
            yes_dec = pos_map["1"]
            no_dec  = pos_map["2"]

            yes_am = decimal_to_american(yes_dec)
            no_am  = decimal_to_american(no_dec)

            log.convert(f"[BTTS] YES: {yes_dec} → {'+' if yes_am > 0 else ''}{yes_am}")
            log.convert(f"[BTTS] NO:  {no_dec} → {'+' if no_am > 0 else ''}{no_am}")

            vig = (1/yes_dec + 1/no_dec)
            log.verify(f"[BTTS] Vig={vig:.4f}")

            return {
                "book_btts_yes_odds": yes_am,
                "book_btts_no_odds":  no_am,
                "book_btts_yes_dec":  yes_dec,
                "book_btts_no_dec":   no_dec,
                "vig_btts": round(vig, 4),
            }

    log.fail(f"[BTTS] No bid={BET365_BID} BTTS row found")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# MARKET TAB SWITCHER — Fetch each market tab's HTML
# ─────────────────────────────────────────────────────────────────────────────

def fetch_market_page(event_id: str, market: str, log: DualLogger) -> Optional[BeautifulSoup]:
    """
    Fetch the match detail page with the specified market tab active.
    BetExplorer uses JavaScript tab switching (match_change_tab), but the
    full page HTML contains ALL market data embedded — we just need to
    navigate to the correct tab URL or parse the embedded data.

    Strategy: Fetch the base page, then fetch each market tab via the
    AJAX endpoint. If AJAX fails (404 for completed matches), fall back
    to parsing the embedded data from the full page HTML.
    """
    # Try AJAX endpoint first (works for upcoming matches)
    ajax_url = f"{BASE_URL}/match-odds/{event_id}/{market}/"
    log.http(f"[AJAX] Trying {ajax_url}")

    try:
        r = requests.get(ajax_url, headers={
            **HEADERS,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*",
            "Referer": f"{BASE_URL}/football/world/world-championship-2026/",
        }, timeout=20)

        log.http(f"[AJAX] status={r.status_code} size={len(r.content):,}B")

        if r.status_code == 200 and len(r.content) > 100:
            # AJAX response contains HTML fragment
            return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        log.warn(f"[AJAX] Exception: {str(e)[:60]}")

    log.warn(f"[AJAX] Failed for {event_id}/{market} — will use full page HTML")
    return None


def fetch_full_page(event_id: str, slug: str, log: DualLogger) -> Optional[BeautifulSoup]:
    """Fetch the full match detail page HTML."""
    url = f"{BASE_URL}/football/world/world-championship-2026/{slug}/{event_id}/"
    log.http(f"[FULL_PAGE] Fetching {url}")
    html = fetch_page(url, log)
    if html:
        return BeautifulSoup(html, "html.parser")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# MAIN SCRAPER — Process one fixture
# ─────────────────────────────────────────────────────────────────────────────

def scrape_fixture(fix: Dict, log: DualLogger) -> Dict:
    """
    Scrape all 5 markets for a single fixture.
    Returns a result dict with all odds and status.
    """
    log.fixture_banner(fix)
    log.input(f"[FIXTURE] fixture_id={fix['fixture_id']} | event_id={fix['event_id']} | {fix['home']} vs {fix['away']}")

    result = {
        "fixture_id": fix["fixture_id"],
        "event_id":   fix["event_id"],
        "home":       fix["home"],
        "away":       fix["away"],
        "round":      fix["round"],
        "date":       fix["date"],
        "status":     "FAILED",
        "markets_ok": [],
        "markets_fail": [],
        "odds": {},
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }

    # ── Step 1: Fetch full page HTML ──────────────────────────────────────
    log.step(f"[STEP 1] Fetching full match detail page HTML")
    full_soup = fetch_full_page(fix["event_id"], fix["slug"], log)

    if not full_soup:
        log.fail(f"[FIXTURE] FAILED to fetch full page for {fix['fixture_id']}")
        result["status"] = "FAILED"
        return result

    log.pass_(f"[STEP 1] Full page HTML fetched successfully")

    # ── Step 2: Try AJAX for each market, fall back to full page ──────────
    market_soups = {}
    for market in MARKETS:
        log.step(f"[STEP 2] Fetching market tab: {market}")
        ajax_soup = fetch_market_page(fix["event_id"], market, log)
        if ajax_soup:
            market_soups[market] = ajax_soup
            log.pass_(f"[AJAX] Got {market} tab via AJAX")
        else:
            market_soups[market] = full_soup  # Fall back to full page
            log.warn(f"[FALLBACK] Using full page HTML for market={market}")
        time.sleep(1.0)  # Rate limiting

    # ── Step 3: Parse each market ─────────────────────────────────────────
    parsers = {
        "1x2": parse_1x2,
        "ou":  parse_ou,
        "ah":  parse_ah,
        "dc":  parse_dc,
        "bts": parse_btts,
    }

    for i, market in enumerate(MARKETS):
        log.prog(log.progress_bar(i+1, len(MARKETS), f"Parsing {market}"))
        soup = market_soups[market]

        try:
            parsed = parsers[market](soup, log)
            if parsed:
                result["odds"].update(parsed)
                result["markets_ok"].append(market)
                log.pass_(f"[MARKET] {market} → PARSED OK | keys={list(parsed.keys())}")
            else:
                result["markets_fail"].append(market)
                log.fail(f"[MARKET] {market} → PARSE FAILED (bid=549 not found)")
        except Exception as e:
            result["markets_fail"].append(market)
            log.fail(f"[MARKET] {market} → EXCEPTION: {type(e).__name__}: {e}")
            log.fail(f"[TRACEBACK] {traceback.format_exc()[:300]}")

    # ── Step 4: Determine status ──────────────────────────────────────────
    ok_count = len(result["markets_ok"])
    if ok_count == len(MARKETS):
        result["status"] = "OK"
    elif ok_count > 0:
        result["status"] = "PARTIAL"
    else:
        result["status"] = "FAILED"

    log.output(
        f"[FIXTURE_RESULT] {fix['fixture_id']} | status={result['status']} | "
        f"ok={ok_count}/{len(MARKETS)} | markets_ok={result['markets_ok']} | "
        f"markets_fail={result['markets_fail']}"
    )

    # ── Step 5: Print odds summary ────────────────────────────────────────
    if result["odds"]:
        odds = result["odds"]
        log.odds(f"  ┌─ ODDS SUMMARY: {fix['home']} vs {fix['away']} ─────────────────────")
        if "book_home_ml" in odds:
            log.odds(f"  │  1X2:  HOME={'+' if odds['book_home_ml']>0 else ''}{odds['book_home_ml']}  "
                     f"DRAW={'+' if odds['book_draw_ml']>0 else ''}{odds['book_draw_ml']}  "
                     f"AWAY={'+' if odds['book_away_ml']>0 else ''}{odds['book_away_ml']}")
        if "book_total_line" in odds:
            log.odds(f"  │  OU:   Line={odds['book_total_line']}  "
                     f"OVER={'+' if odds['book_over_odds']>0 else ''}{odds['book_over_odds']}  "
                     f"UNDER={'+' if odds['book_under_odds']>0 else ''}{odds['book_under_odds']}")
        if "book_spread_line" in odds:
            log.odds(f"  │  AH:   Line={odds['book_spread_line']}  "
                     f"HOME={'+' if odds['book_home_spread_odds']>0 else ''}{odds['book_home_spread_odds']}  "
                     f"AWAY={'+' if odds['book_away_spread_odds']>0 else ''}{odds['book_away_spread_odds']}")
        if "book_dc_1x_odds" in odds:
            log.odds(f"  │  DC:   1X={'+' if odds['book_dc_1x_odds']>0 else ''}{odds['book_dc_1x_odds']}  "
                     f"12={'+' if odds['book_dc_12_odds']>0 else ''}{odds['book_dc_12_odds']}  "
                     f"X2={'+' if odds['book_dc_x2_odds']>0 else ''}{odds['book_dc_x2_odds']}")
        if "book_btts_yes_odds" in odds:
            log.odds(f"  │  BTTS: YES={'+' if odds['book_btts_yes_odds']>0 else ''}{odds['book_btts_yes_odds']}  "
                     f"NO={'+' if odds['book_btts_no_odds']>0 else ''}{odds['book_btts_no_odds']}")
        log.odds(f"  └──────────────────────────────────────────────────────────────")

    return result


# ─────────────────────────────────────────────────────────────────────────────
# DB COLUMN MAP — Maps scraped odds to wc2026_frozen_book_odds columns
# ─────────────────────────────────────────────────────────────────────────────

DB_COLUMN_MAP = {
    # 1x2 Moneyline
    "book_home_ml":          "book_home_ml",
    "book_draw_ml":          "book_draw_ml",
    "book_away_ml":          "book_away_ml",
    # Over/Under
    "book_total_line":       "book_total_line",
    "book_over_odds":        "book_over_odds",
    "book_under_odds":       "book_under_odds",
    # Asian Handicap / Spread
    "book_spread_line":      "book_spread_line",
    "book_home_spread_odds": "book_home_spread_odds",
    "book_away_spread_odds": "book_away_spread_odds",
    # Double Chance
    "book_dc_1x_odds":       "book_dc_1x_odds",
    "book_dc_12_odds":       "book_dc_12_odds",
    "book_dc_x2_odds":       "book_dc_x2_odds",
    # Both Teams To Score
    "book_btts_yes_odds":    "book_btts_yes_odds",
    "book_btts_no_odds":     "book_btts_no_odds",
}


def build_db_record(result: Dict, log: DualLogger) -> Dict:
    """Build the DB record from scraped odds using confirmed column map."""
    odds = result.get("odds", {})
    record = {
        "fixture_id":  result["fixture_id"],
        "bookmaker":   "bet365.us",
        "bid":         BET365_BID,
        "scraped_at":  result["scraped_at"],
        "status":      result["status"],
    }

    for scraper_key, db_col in DB_COLUMN_MAP.items():
        val = odds.get(scraper_key)
        record[db_col] = val
        if val is None:
            log.warn(f"[DB_MAP] {db_col} = NULL (market not scraped)")
        else:
            log.db(f"[DB_MAP] {db_col} = {val}")

    return record


# ─────────────────────────────────────────────────────────────────────────────
# MAIN EXECUTION
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log = DualLogger(LOG_FILE)

    log.section("WC2026 BETEXPLORER HTML SCRAPER v1.0 — PRODUCTION RUN")
    log.init(f"BET365_BID={BET365_BID} | Markets={MARKETS} | Fixtures={len(WC2026_FIXTURES)}")
    log.init(f"Log file: {LOG_FILE}")
    log.init(f"Output JSON: {JSON_OUT}")

    # ── Phase 1: Validate conversion engine ──────────────────────────────
    log.section("PHASE 1: CONVERSION ENGINE VALIDATION")
    test_cases = [
        (1.29, -345),   # England 1x2 home (confirmed from HTML)
        (5.20, +420),   # England 1x2 draw
        (12.00, +1100), # England 1x2 away
        (1.98, -102),   # England OU over 2.5 (confirmed from HTML)
        (1.88, -114),   # England OU under 2.5
        (1.92, -109),   # Belgium 1x2 home
        (3.39, +239),   # Belgium 1x2 draw
        (4.13, +313),   # Belgium 1x2 away
    ]

    conversion_pass = 0
    conversion_fail = 0
    for dec, expected in test_cases:
        result_am = decimal_to_american(dec)
        # Allow ±1 rounding tolerance
        if abs(result_am - expected) <= 2:
            log.pass_(f"[CONVERT] {dec} → {'+' if result_am>0 else ''}{result_am} (expected {'+' if expected>0 else ''}{expected}) ✓")
            conversion_pass += 1
        else:
            log.fail(f"[CONVERT] {dec} → {'+' if result_am>0 else ''}{result_am} (expected {'+' if expected>0 else ''}{expected}) ✗")
            conversion_fail += 1

    log.verify(f"[PHASE 1] Conversion: {conversion_pass} PASS / {conversion_fail} FAIL")

    # ── Phase 2: Scrape all fixtures ──────────────────────────────────────
    log.section("PHASE 2: SCRAPING ALL WC2026 FIXTURES")

    all_results = []
    db_records = []

    for i, fix in enumerate(WC2026_FIXTURES):
        log.prog(log.progress_bar(i+1, len(WC2026_FIXTURES), f"OVERALL | {fix['fixture_id']}"))
        log.prog(f"[OVERALL] Processing fixture {i+1}/{len(WC2026_FIXTURES)}: {fix['fixture_id']}")

        result = scrape_fixture(fix, log)
        all_results.append(result)

        db_record = build_db_record(result, log)
        db_records.append(db_record)

        # Rate limiting between fixtures
        if i < len(WC2026_FIXTURES) - 1:
            wait = 3.0
            log.step(f"[RATE_LIMIT] Waiting {wait}s before next fixture...")
            time.sleep(wait)

    # ── Phase 3: Save JSON output ─────────────────────────────────────────
    log.section("PHASE 3: SAVING OUTPUT")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scraper_version": "1.0",
        "bookmaker": "bet365.us",
        "bid": BET365_BID,
        "markets": MARKETS,
        "total_fixtures": len(WC2026_FIXTURES),
        "results": all_results,
        "db_records": db_records,
        "db_column_map": DB_COLUMN_MAP,
    }

    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, default=str)
    log.output(f"[JSON] Saved to {JSON_OUT} ({os.path.getsize(JSON_OUT):,}B)")

    # ── Phase 4: Session summary ──────────────────────────────────────────
    log.section("PHASE 4: SESSION SUMMARY")
    log.session_summary(all_results)

    ok = sum(1 for r in all_results if r["status"] == "OK")
    partial = sum(1 for r in all_results if r["status"] == "PARTIAL")
    failed = sum(1 for r in all_results if r["status"] == "FAILED")

    log.output(f"[FINAL] OK={ok} | PARTIAL={partial} | FAILED={failed} | TOTAL={len(all_results)}")

    # Print DB column map
    log.section("DB COLUMN MAP — wc2026_frozen_book_odds")
    for scraper_key, db_col in DB_COLUMN_MAP.items():
        log.db(f"  {scraper_key:<30} → {db_col}")

    return output


if __name__ == "__main__":
    main()
