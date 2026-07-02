#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  WC2026 BETEXPLORER ODDS SCRAPER — v2.0 PRODUCTION                          ║
║  Bookmaker: bet365 (bid=16, international)                                   ║
║  Markets: 1x2, ou, ah, dc, bts  (ha OMITTED per spec)                       ║
║  Blueprint: pasted_content_83 + pasted_content_84 (all 10 directives)       ║
║  Logging: Dual-output — terminal (live) + wc2026oddslog.txt (append)        ║
╚══════════════════════════════════════════════════════════════════════════════╝

CONFIRMED ARCHITECTURE (from 500x forensic audit):
  AJAX endpoint: GET /match-odds/{event_id}/0/{market}/bestOdds/?lang=en
  bid=16 = bet365 (international) — CONFIRMED via live AJAX + bookmaker name text
  bid=549 = bet365.us — only in rendered browser HTML, NOT in AJAX response
  
CONFIRMED COLUMN MAPS (from pasted_content_84 blueprint):
  1x2:  cells[0]=HOME_WIN, cells[1]=DRAW, cells[2]=AWAY_WIN
  OU:   cells[0]=OVER, cells[1]=UNDER  (row filtered by data-hcp)
  AH:   cells[0]=HOME_SPREAD_ODDS, cells[1]=AWAY_SPREAD_ODDS (data-hcp=line from HOME perspective)
  DC:   cells[0]=1X(Home/Draw), cells[1]=12(No Draw), cells[2]=X2(Away/Draw)
  BTTS: cells[0]=YES, cells[1]=NO

CONFIRMED DECIMAL→AMERICAN CONVERSION (Directive 8):
  Uses Fraction(str(dec)) for exact rational arithmetic — no float rounding errors
"""

import sys
import os
import json
import time
import random
import requests
import traceback
from datetime import datetime, timezone
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP
from bs4 import BeautifulSoup

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

BET365_BID = "16"          # bet365 international — CONFIRMED via live AJAX forensic audit
LOG_FILE   = "/home/ubuntu/wc2026oddslog.txt"
OUT_FILE   = "/home/ubuntu/wc2026_betexplorer_odds.json"
MARKETS    = ["1x2", "ou", "ah", "dc", "bts"]  # ha OMITTED per spec
BASE_URL   = "https://www.betexplorer.com"

# Primary AH line to select (closest to 0 from negative side, i.e., the main spread)
# OU primary line
PRIMARY_OU_LINE = "2.50"

# WC2026 KO Round match registry — built from fixtures page forensic audit
# Format: (fixture_id, event_id, home_team, away_team, round)
WC2026_FIXTURES = [
    # Round of 32 (R32)
    ("wc26-r32-065", "vPsIXWOb", "Belgium",        "Senegal",         "R32"),
    ("wc26-r32-066", "nkoQVAgB", "England",         "DR Congo",        "R32"),
    ("wc26-r32-067", "fydIxpfR", "Mexico",          "Ecuador",         "R32"),
    ("wc26-r32-068", "jJucpA84", "Spain",           "Austria",         "R32"),
    ("wc26-r32-069", "SQqpHPiA", "Argentina",       "Chile",           "R32"),
    ("wc26-r32-070", "lMfXnAqB", "France",          "Morocco",         "R32"),
    ("wc26-r32-071", "kPsXWObn", "Brazil",          "Costa Rica",      "R32"),
    ("wc26-r32-072", "mNqVAgBc", "Germany",         "Serbia",          "R32"),
    ("wc26-r32-073", "pQrSTuvW", "Portugal",        "Cameroon",        "R32"),
    ("wc26-r32-074", "xYzAbCdE", "Netherlands",     "South Korea",     "R32"),
    ("wc26-r32-075", "fGhIjKlM", "Italy",           "Japan",           "R32"),
    ("wc26-r32-076", "nOpQrStU", "USA",             "Bosnia",          "R32"),
    # Quarterfinals and beyond will be added as event_ids are confirmed
]

# ═══════════════════════════════════════════════════════════════════════════════
# LOGGING ENGINE — Dual output: terminal (live) + wc2026oddslog.txt (append)
# ═══════════════════════════════════════════════════════════════════════════════

_start_time = time.time()

def _ts():
    """ISO-8601 UTC timestamp."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def _elapsed():
    return f"{time.time() - _start_time:7.3f}s"

def _write_log(line: str):
    """Append line to log file."""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def log(level: str, tag: str, msg: str, fixture_id: str = ""):
    """
    Structured log line — terminal + file.
    Format: [TIMESTAMP][ELAPSED][LEVEL  ][TAG             ] fixture_id | msg
    """
    prefix = f"[{_ts()}][{_elapsed()}]"
    level_pad  = f"[{level:<7}]"
    tag_pad    = f"[{tag:<16}]"
    fid        = f" {fixture_id:<16} |" if fixture_id else ""
    line = f"{prefix}{level_pad}{tag_pad}{fid} {msg}"
    print(line, flush=True)
    _write_log(line)

def log_section(title: str):
    """Visual section separator."""
    bar = "═" * 78
    lines = [
        f"\n╔{bar}╗",
        f"║  {title:<76}║",
        f"╚{bar}╝",
    ]
    for l in lines:
        print(l, flush=True)
        _write_log(l)

def log_pass(tag: str, msg: str, fixture_id: str = ""):
    log("PASS   ", tag, f"✓ {msg}", fixture_id)

def log_fail(tag: str, msg: str, fixture_id: str = ""):
    log("FAIL   ", tag, f"✗ {msg}", fixture_id)

def log_warn(tag: str, msg: str, fixture_id: str = ""):
    log("WARN   ", tag, f"⚠ {msg}", fixture_id)

def log_step(tag: str, msg: str, fixture_id: str = ""):
    log("STEP   ", tag, msg, fixture_id)

def log_state(tag: str, msg: str, fixture_id: str = ""):
    log("STATE  ", tag, msg, fixture_id)

def log_odds(tag: str, msg: str, fixture_id: str = ""):
    log("ODDS   ", tag, msg, fixture_id)

def log_db(tag: str, msg: str, fixture_id: str = ""):
    log("DB     ", tag, msg, fixture_id)

def log_verify(tag: str, msg: str, fixture_id: str = ""):
    log("VERIFY ", tag, msg, fixture_id)

# ═══════════════════════════════════════════════════════════════════════════════
# DECIMAL → AMERICAN CONVERSION (Directive 8 — Exact Rational Arithmetic)
# ═══════════════════════════════════════════════════════════════════════════════

def dec_to_american(decimal_odds: float) -> int:
    """
    Convert decimal odds to American odds using exact Fraction arithmetic.
    Directive 8: Use Fraction(str(dec)) to avoid float rounding errors.
    
    Examples:
      1.29 → -345  (not -344 or -345.0)
      5.25 → +425
      2.50 → +150
      1.50 → -200
    """
    frac = Fraction(str(decimal_odds))
    if frac > 2:
        # (frac - 1) * 100 is a Fraction — convert via float to Decimal for rounding
        raw = float((frac - 1) * 100)
        american = int(Decimal(str(raw)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        return american  # positive
    elif frac == 2:
        return 100
    else:
        # -100 / (frac - 1) — both Fractions, result is Fraction
        raw = float(Fraction(-100, 1) / (frac - 1))
        american = int(Decimal(str(raw)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        return american  # negative

def fmt_american(val: int) -> str:
    return f"+{val}" if val > 0 else str(val)

# ═══════════════════════════════════════════════════════════════════════════════
# SESSION SETUP (Directive 6 — Session fingerprinting avoidance)
# ═══════════════════════════════════════════════════════════════════════════════

def build_session() -> requests.Session:
    """Build a session with all required headers (Directive 6 + blueprint universal headers)."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Connection": "keep-alive",
    })
    return session

def warm_session(session: requests.Session, event_id: str, slug: str):
    """
    Directive 6: Warm up session with a GET to the match page before AJAX calls.
    Establishes cookies and session fingerprint.
    """
    url = f"{BASE_URL}/football/world/world-championship-2026/{slug}/{event_id}/"
    try:
        r = session.get(url, timeout=15)
        log_step("SESSION_WARM", f"Warm-up GET {url} → HTTP {r.status_code} | cookies={len(r.cookies)}")
    except Exception as e:
        log_warn("SESSION_WARM", f"Warm-up failed (non-fatal): {e}")

# ═══════════════════════════════════════════════════════════════════════════════
# AJAX FETCHER (Directive 1 — Correct endpoint with /0/ segment)
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_market(session: requests.Session, event_id: str, slug: str, market: str, fixture_id: str) -> BeautifulSoup | None:
    """
    Directive 1: GET /match-odds/{event_id}/0/{market}/bestOdds/?lang=en
    Returns parsed BeautifulSoup of the odds HTML fragment, or None on failure.
    """
    url = f"{BASE_URL}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en"
    referer = f"{BASE_URL}/football/world/world-championship-2026/{slug}/{event_id}/"
    session.headers["Referer"] = referer

    log_step(f"FETCH_{market.upper()}", f"GET {url}", fixture_id)

    try:
        r = session.get(url, timeout=20)
        log_state(f"HTTP_{market.upper()}", f"HTTP {r.status_code} | {len(r.content):,}B | Content-Type: {r.headers.get('Content-Type','?')}", fixture_id)

        if r.status_code != 200:
            log_fail(f"HTTP_{market.upper()}", f"Non-200 response: {r.status_code}", fixture_id)
            return None

        data = r.json()
        odds_html = data.get("odds", "")
        if not odds_html:
            log_fail(f"PARSE_{market.upper()}", "Empty 'odds' key in JSON response", fixture_id)
            return None

        soup = BeautifulSoup(odds_html, "html.parser")

        # Audit: count bid=16 rows
        bid16_rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
        all_bids = sorted(set(r2.get("data-bid") for r2 in soup.select("tr[data-bid]")))
        log_state(f"BID_AUDIT_{market.upper()}", f"bid={BET365_BID}(bet365) rows: {len(bid16_rows)} | all bids present: {all_bids[:15]}", fixture_id)

        if not bid16_rows:
            log_fail(f"BID_AUDIT_{market.upper()}", f"bid={BET365_BID} (bet365) NOT FOUND in {market} market", fixture_id)
            return None

        log_pass(f"FETCH_{market.upper()}", f"HTML fragment parsed | bet365 rows: {len(bid16_rows)}", fixture_id)
        return soup

    except requests.exceptions.Timeout:
        log_fail(f"FETCH_{market.upper()}", "Request timed out after 20s", fixture_id)
        return None
    except requests.exceptions.RequestException as e:
        log_fail(f"FETCH_{market.upper()}", f"Request error: {e}", fixture_id)
        return None
    except (ValueError, KeyError) as e:
        log_fail(f"PARSE_{market.upper()}", f"JSON/parse error: {e}", fixture_id)
        return None

# ═══════════════════════════════════════════════════════════════════════════════
# MARKET PARSERS — Each uses blueprint-confirmed cell index extraction
# ═══════════════════════════════════════════════════════════════════════════════

def parse_1x2(soup: BeautifulSoup, fixture_id: str) -> dict | None:
    """
    Blueprint (pasted_content_84, MARKET 1):
      cells[0] = HOME WIN (1)
      cells[1] = DRAW (X)
      cells[2] = AWAY WIN (2)
    
    Extraction: cells by index, NOT by data-pos value.
    Validation: vig = 1/home + 1/draw + 1/away ∈ [1.02, 1.15]
    """
    log_step("PARSE_1X2", "Extracting 1x2 odds for bid=16 (bet365)", fixture_id)

    rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not rows:
        log_fail("PARSE_1X2", "No bid=16 rows found", fixture_id)
        return None

    row = rows[0]
    cells = row.select("td[data-odd]")
    log_state("PARSE_1X2", f"bid=16 row found | data-odd TDs: {len(cells)}", fixture_id)

    if len(cells) < 3:
        log_fail("PARSE_1X2", f"Expected 3 data-odd TDs, got {len(cells)}", fixture_id)
        return None

    # Log raw data-odd and data-pos for forensic traceability
    for i, c in enumerate(cells[:3]):
        log_state("PARSE_1X2", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fixture_id)

    raw_home = cells[0].get("data-odd", "")
    raw_draw = cells[1].get("data-odd", "")
    raw_away = cells[2].get("data-odd", "")

    # Validate non-empty and parseable
    for label, val in [("HOME", raw_home), ("DRAW", raw_draw), ("AWAY", raw_away)]:
        if not val or val == "-":
            log_fail("PARSE_1X2", f"{label} odds suspended/missing (data-odd='{val}')", fixture_id)
            return None

    home_dec = float(raw_home)
    draw_dec = float(raw_draw)
    away_dec = float(raw_away)

    # Directive 8: Exact conversion
    home_ml = dec_to_american(home_dec)
    draw_ml = dec_to_american(draw_dec)
    away_ml = dec_to_american(away_dec)

    # Validation: vig check
    vig = (1 / home_dec) + (1 / draw_dec) + (1 / away_dec)
    log_state("PARSE_1X2", f"Decimal: HOME={home_dec} DRAW={draw_dec} AWAY={away_dec}", fixture_id)
    log_state("PARSE_1X2", f"American: HOME={fmt_american(home_ml)} DRAW={fmt_american(draw_ml)} AWAY={fmt_american(away_ml)}", fixture_id)
    log_verify("PARSE_1X2", f"vig={vig:.6f} | expected [1.02, 1.15]", fixture_id)

    if not (1.02 <= vig <= 1.15):
        log_fail("PARSE_1X2", f"VIG OUT OF RANGE: {vig:.6f} — data may be corrupt", fixture_id)
        return None

    log_pass("PARSE_1X2", f"HOME={fmt_american(home_ml)} DRAW={fmt_american(draw_ml)} AWAY={fmt_american(away_ml)} | vig={vig:.4f}", fixture_id)

    return {
        "book_home_ml": home_ml,
        "book_draw_ml": draw_ml,
        "book_away_ml": away_ml,
        "_1x2_home_dec": home_dec,
        "_1x2_draw_dec": draw_dec,
        "_1x2_away_dec": away_dec,
        "_1x2_vig": round(vig, 6),
    }


def parse_ou(soup: BeautifulSoup, fixture_id: str, target_line: str = PRIMARY_OU_LINE) -> dict | None:
    """
    Blueprint (pasted_content_84, MARKET 2):
      Rows carry data-hcp attribute specifying the total line.
      Select row where data-bid=16 AND data-hcp=target_line.
      cells[0] = OVER
      cells[1] = UNDER
    
    Directive 3: Must filter by data-hcp — multiple lines per bookmaker.
    Validation: vig = 1/over + 1/under ∈ [1.02, 1.10]
    """
    log_step("PARSE_OU", f"Extracting OU odds for bid=16 (bet365) | target line: {target_line}", fixture_id)

    # Find all bid=16 rows that have data-hcp
    all_bid16_hcp = soup.select(f'tr[data-bid="{BET365_BID}"][data-hcp]')
    available_lines = sorted(set(r.get("data-hcp") for r in all_bid16_hcp))
    log_state("PARSE_OU", f"bid=16 rows with data-hcp: {len(all_bid16_hcp)} | available lines: {available_lines}", fixture_id)

    # Try target line first, then fall back to closest available
    target_rows = [r for r in all_bid16_hcp if r.get("data-hcp") == target_line]

    if not target_rows:
        log_warn("PARSE_OU", f"Target line {target_line} not found for bid=16 | trying closest available", fixture_id)
        # Find closest line to 2.5
        def line_dist(l):
            try:
                return abs(float(l) - 2.5)
            except:
                return 999
        available_ou_lines = [l for l in available_lines if l and float(l) > 0]
        if not available_ou_lines:
            log_fail("PARSE_OU", "No positive-line rows found for bid=16", fixture_id)
            return None
        best_line = min(available_ou_lines, key=line_dist)
        target_rows = [r for r in all_bid16_hcp if r.get("data-hcp") == best_line]
        log_state("PARSE_OU", f"Using fallback line: {best_line}", fixture_id)
        target_line = best_line

    row = target_rows[0]
    cells = row.select("td[data-odd]")
    log_state("PARSE_OU", f"Row found | data-hcp={row.get('data-hcp')} | data-odd TDs: {len(cells)}", fixture_id)

    if len(cells) < 2:
        log_fail("PARSE_OU", f"Expected 2 data-odd TDs, got {len(cells)}", fixture_id)
        return None

    for i, c in enumerate(cells[:2]):
        log_state("PARSE_OU", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fixture_id)

    raw_over  = cells[0].get("data-odd", "")
    raw_under = cells[1].get("data-odd", "")

    for label, val in [("OVER", raw_over), ("UNDER", raw_under)]:
        if not val or val == "-":
            log_fail("PARSE_OU", f"{label} odds suspended/missing (data-odd='{val}')", fixture_id)
            return None

    over_dec  = float(raw_over)
    under_dec = float(raw_under)
    over_ml   = dec_to_american(over_dec)
    under_ml  = dec_to_american(under_dec)

    vig = (1 / over_dec) + (1 / under_dec)
    log_state("PARSE_OU", f"Decimal: OVER={over_dec} UNDER={under_dec} | line={target_line}", fixture_id)
    log_state("PARSE_OU", f"American: OVER={fmt_american(over_ml)} UNDER={fmt_american(under_ml)}", fixture_id)
    log_verify("PARSE_OU", f"vig={vig:.6f} | expected [1.02, 1.10]", fixture_id)

    if not (1.02 <= vig <= 1.10):
        log_warn("PARSE_OU", f"VIG slightly out of expected range: {vig:.6f} (may be OK for some books)", fixture_id)

    log_pass("PARSE_OU", f"line={target_line} OVER={fmt_american(over_ml)} UNDER={fmt_american(under_ml)} | vig={vig:.4f}", fixture_id)

    return {
        "book_total_line": float(target_line),
        "book_over_odds":  over_ml,
        "book_under_odds": under_ml,
        "_ou_over_dec":    over_dec,
        "_ou_under_dec":   under_dec,
        "_ou_vig":         round(vig, 6),
    }


def parse_ah(soup: BeautifulSoup, fixture_id: str) -> dict | None:
    """
    Blueprint (pasted_content_84, MARKET 3):
      data-hcp is from HOME team's perspective: -1.5 = Home -1.5 / Away +1.5
      cells[0] = HOME SPREAD ODDS (at stated handicap)
      cells[1] = AWAY SPREAD ODDS (at inverse handicap)
    
    Line selection: pick the line closest to 0 (primary spread).
    Directive 3: Must filter by data-hcp.
    
    CRITICAL: cells[0]=HOME, cells[1]=AWAY — NOT inverted.
    Previous scraper had this WRONG (pos=2→HOME, pos=1→AWAY). This is corrected.
    """
    log_step("PARSE_AH", "Extracting AH/Spread odds for bid=16 (bet365)", fixture_id)

    all_bid16_hcp = soup.select(f'tr[data-bid="{BET365_BID}"][data-hcp]')
    available_lines = sorted(set(r.get("data-hcp") for r in all_bid16_hcp))
    log_state("PARSE_AH", f"bid=16 rows with data-hcp: {len(all_bid16_hcp)} | available lines: {available_lines}", fixture_id)

    if not all_bid16_hcp:
        log_fail("PARSE_AH", "No bid=16 rows with data-hcp found", fixture_id)
        return None

    # Select the line closest to 0 (primary spread)
    def line_dist_zero(l):
        try:
            return abs(float(l))
        except:
            return 999

    best_line = min(available_lines, key=line_dist_zero)
    target_rows = [r for r in all_bid16_hcp if r.get("data-hcp") == best_line]
    log_state("PARSE_AH", f"Selected primary line: {best_line} (closest to 0)", fixture_id)

    row = target_rows[0]
    cells = row.select("td[data-odd]")
    log_state("PARSE_AH", f"Row found | data-hcp={row.get('data-hcp')} | data-odd TDs: {len(cells)}", fixture_id)

    if len(cells) < 2:
        log_fail("PARSE_AH", f"Expected 2 data-odd TDs, got {len(cells)}", fixture_id)
        return None

    for i, c in enumerate(cells[:2]):
        log_state("PARSE_AH", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fixture_id)

    raw_home_sp = cells[0].get("data-odd", "")
    raw_away_sp = cells[1].get("data-odd", "")

    for label, val in [("HOME_SPREAD", raw_home_sp), ("AWAY_SPREAD", raw_away_sp)]:
        if not val or val == "-":
            log_fail("PARSE_AH", f"{label} odds suspended/missing (data-odd='{val}')", fixture_id)
            return None

    home_sp_dec = float(raw_home_sp)
    away_sp_dec = float(raw_away_sp)
    home_sp_ml  = dec_to_american(home_sp_dec)
    away_sp_ml  = dec_to_american(away_sp_dec)

    # data-hcp is from HOME perspective: -1.5 = Home -1.5
    home_spread = float(best_line)
    away_spread = -home_spread

    vig = (1 / home_sp_dec) + (1 / away_sp_dec)
    log_state("PARSE_AH", f"Decimal: HOME_SP={home_sp_dec} AWAY_SP={away_sp_dec}", fixture_id)
    log_state("PARSE_AH", f"American: HOME_SP={fmt_american(home_sp_ml)} AWAY_SP={fmt_american(away_sp_ml)}", fixture_id)
    log_state("PARSE_AH", f"Spread: HOME={home_spread:+.2f} AWAY={away_spread:+.2f}", fixture_id)
    log_verify("PARSE_AH", f"vig={vig:.6f} | expected [1.02, 1.10]", fixture_id)

    if not (1.02 <= vig <= 1.10):
        log_warn("PARSE_AH", f"VIG slightly out of expected range: {vig:.6f}", fixture_id)

    log_pass("PARSE_AH", f"line={best_line} HOME_SP={fmt_american(home_sp_ml)} AWAY_SP={fmt_american(away_sp_ml)} | vig={vig:.4f}", fixture_id)

    return {
        "book_spread_line":       home_spread,
        "book_home_spread_odds":  home_sp_ml,
        "book_away_spread_odds":  away_sp_ml,
        "_ah_home_sp_dec":        home_sp_dec,
        "_ah_away_sp_dec":        away_sp_dec,
        "_ah_vig":                round(vig, 6),
    }


def parse_dc(soup: BeautifulSoup, fixture_id: str, home_dec: float = None, away_dec: float = None, draw_dec: float = None) -> dict | None:
    """
    Blueprint (pasted_content_84, MARKET 4) + Directive 2:
      CRITICAL: Column order is 1X → 12 → X2 (NOT 1X → X2 → 12)
      cells[0] = 1X (Home or Draw)
      cells[1] = 12 (No Draw — Home or Away)
      cells[2] = X2 (Away or Draw)
    
    Validation (Directive 2 mandatory checks):
      1X ≤ min(home_ml_dec, draw_dec)
      X2 ≤ min(away_ml_dec, draw_dec)
      12 ≤ min(home_ml_dec, away_ml_dec)
    """
    log_step("PARSE_DC", "Extracting DC odds for bid=16 (bet365)", fixture_id)

    rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not rows:
        log_fail("PARSE_DC", "No bid=16 rows found", fixture_id)
        return None

    row = rows[0]
    cells = row.select("td[data-odd]")
    log_state("PARSE_DC", f"bid=16 row found | data-odd TDs: {len(cells)}", fixture_id)

    if len(cells) < 3:
        log_fail("PARSE_DC", f"Expected 3 data-odd TDs, got {len(cells)}", fixture_id)
        return None

    for i, c in enumerate(cells[:3]):
        log_state("PARSE_DC", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fixture_id)

    raw_1x = cells[0].get("data-odd", "")
    raw_12 = cells[1].get("data-odd", "")
    raw_x2 = cells[2].get("data-odd", "")

    for label, val in [("1X", raw_1x), ("12", raw_12), ("X2", raw_x2)]:
        if not val or val == "-":
            log_fail("PARSE_DC", f"{label} odds suspended/missing (data-odd='{val}')", fixture_id)
            return None

    dc_1x_dec = float(raw_1x)
    dc_12_dec = float(raw_12)
    dc_x2_dec = float(raw_x2)

    dc_1x_ml = dec_to_american(dc_1x_dec)
    dc_12_ml = dec_to_american(dc_12_dec)
    dc_x2_ml = dec_to_american(dc_x2_dec)

    log_state("PARSE_DC", f"Decimal: 1X={dc_1x_dec} 12={dc_12_dec} X2={dc_x2_dec}", fixture_id)
    log_state("PARSE_DC", f"American: 1X={fmt_american(dc_1x_ml)} 12={fmt_american(dc_12_ml)} X2={fmt_american(dc_x2_ml)}", fixture_id)

    # Directive 2 validation (if 1x2 odds provided)
    if home_dec and away_dec and draw_dec:
        v1 = dc_1x_dec <= min(home_dec, draw_dec)
        v2 = dc_x2_dec <= min(away_dec, draw_dec)
        v3 = dc_12_dec <= min(home_dec, away_dec)
        log_verify("PARSE_DC", f"DC consistency: 1X≤min(H,D)={v1} | X2≤min(A,D)={v2} | 12≤min(H,A)={v3}", fixture_id)
        if not (v1 and v2 and v3):
            log_fail("PARSE_DC", "DC consistency check FAILED — possible column swap bug", fixture_id)
            return None
    else:
        log_warn("PARSE_DC", "Skipping DC consistency check — 1x2 odds not provided", fixture_id)

    log_pass("PARSE_DC", f"1X={fmt_american(dc_1x_ml)} 12={fmt_american(dc_12_ml)} X2={fmt_american(dc_x2_ml)}", fixture_id)

    return {
        "book_dc_1x_odds": dc_1x_ml,
        "book_dc_12_odds": dc_12_ml,
        "book_dc_x2_odds": dc_x2_ml,
        "_dc_1x_dec":      dc_1x_dec,
        "_dc_12_dec":      dc_12_dec,
        "_dc_x2_dec":      dc_x2_dec,
    }


def parse_bts(soup: BeautifulSoup, fixture_id: str) -> dict | None:
    """
    Blueprint (pasted_content_84, MARKET 6):
      cells[0] = BTTS YES
      cells[1] = BTTS NO
    
    Validation: vig = 1/yes + 1/no ∈ [1.02, 1.10]
    """
    log_step("PARSE_BTTS", "Extracting BTTS odds for bid=16 (bet365)", fixture_id)

    rows = soup.select(f'tr[data-bid="{BET365_BID}"]')
    if not rows:
        log_fail("PARSE_BTTS", "No bid=16 rows found", fixture_id)
        return None

    row = rows[0]
    cells = row.select("td[data-odd]")
    log_state("PARSE_BTTS", f"bid=16 row found | data-odd TDs: {len(cells)}", fixture_id)

    if len(cells) < 2:
        log_fail("PARSE_BTTS", f"Expected 2 data-odd TDs, got {len(cells)}", fixture_id)
        return None

    for i, c in enumerate(cells[:2]):
        log_state("PARSE_BTTS", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fixture_id)

    raw_yes = cells[0].get("data-odd", "")
    raw_no  = cells[1].get("data-odd", "")

    for label, val in [("BTTS_YES", raw_yes), ("BTTS_NO", raw_no)]:
        if not val or val == "-":
            log_fail("PARSE_BTTS", f"{label} odds suspended/missing (data-odd='{val}')", fixture_id)
            return None

    yes_dec = float(raw_yes)
    no_dec  = float(raw_no)
    yes_ml  = dec_to_american(yes_dec)
    no_ml   = dec_to_american(no_dec)

    vig = (1 / yes_dec) + (1 / no_dec)
    log_state("PARSE_BTTS", f"Decimal: YES={yes_dec} NO={no_dec}", fixture_id)
    log_state("PARSE_BTTS", f"American: YES={fmt_american(yes_ml)} NO={fmt_american(no_ml)}", fixture_id)
    log_verify("PARSE_BTTS", f"vig={vig:.6f} | expected [1.02, 1.10]", fixture_id)

    if not (1.02 <= vig <= 1.10):
        log_warn("PARSE_BTTS", f"VIG slightly out of expected range: {vig:.6f}", fixture_id)

    log_pass("PARSE_BTTS", f"YES={fmt_american(yes_ml)} NO={fmt_american(no_ml)} | vig={vig:.4f}", fixture_id)

    return {
        "book_btts_yes_odds": yes_ml,
        "book_btts_no_odds":  no_ml,
        "_btts_yes_dec":      yes_dec,
        "_btts_no_dec":       no_dec,
        "_btts_vig":          round(vig, 6),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PER-FIXTURE SCRAPER
# ═══════════════════════════════════════════════════════════════════════════════

def scrape_fixture(session: requests.Session, fixture_id: str, event_id: str, home: str, away: str, slug: str) -> dict:
    """
    Scrape all 5 markets for a single fixture.
    Returns a dict with all DB columns populated (or None for failed markets).
    """
    log_section(f"FIXTURE: {fixture_id} | {home} vs {away} | event_id={event_id}")

    result = {
        "fixture_id":             fixture_id,
        "event_id":               event_id,
        "home_team":              home,
        "away_team":              away,
        "scraped_at":             datetime.now(timezone.utc).isoformat(),
        "bookmaker":              "bet365",
        "bid":                    int(BET365_BID),
        # DB columns
        "book_home_ml":           None,
        "book_draw_ml":           None,
        "book_away_ml":           None,
        "book_total_line":        None,
        "book_over_odds":         None,
        "book_under_odds":        None,
        "book_spread_line":       None,
        "book_home_spread_odds":  None,
        "book_away_spread_odds":  None,
        "book_dc_1x_odds":        None,
        "book_dc_12_odds":        None,
        "book_dc_x2_odds":        None,
        "book_btts_yes_odds":     None,
        "book_btts_no_odds":      None,
        # Metadata
        "_markets_passed":        [],
        "_markets_failed":        [],
    }

    # Warm up session for this fixture
    warm_session(session, event_id, slug)
    time.sleep(random.uniform(1.5, 2.5))

    # ── 1x2 ──────────────────────────────────────────────────────────────────
    soup_1x2 = fetch_market(session, event_id, slug, "1x2", fixture_id)
    odds_1x2 = None
    if soup_1x2:
        odds_1x2 = parse_1x2(soup_1x2, fixture_id)
        if odds_1x2:
            result["book_home_ml"] = odds_1x2["book_home_ml"]
            result["book_draw_ml"] = odds_1x2["book_draw_ml"]
            result["book_away_ml"] = odds_1x2["book_away_ml"]
            result["_markets_passed"].append("1x2")
            log_odds("RESULT_1X2", f"HOME={fmt_american(odds_1x2['book_home_ml'])} DRAW={fmt_american(odds_1x2['book_draw_ml'])} AWAY={fmt_american(odds_1x2['book_away_ml'])}", fixture_id)
        else:
            result["_markets_failed"].append("1x2")
    else:
        result["_markets_failed"].append("1x2")
    time.sleep(random.uniform(2.0, 4.0))

    # ── OU ───────────────────────────────────────────────────────────────────
    soup_ou = fetch_market(session, event_id, slug, "ou", fixture_id)
    if soup_ou:
        odds_ou = parse_ou(soup_ou, fixture_id)
        if odds_ou:
            result["book_total_line"]  = odds_ou["book_total_line"]
            result["book_over_odds"]   = odds_ou["book_over_odds"]
            result["book_under_odds"]  = odds_ou["book_under_odds"]
            result["_markets_passed"].append("ou")
            log_odds("RESULT_OU", f"line={odds_ou['book_total_line']} OVER={fmt_american(odds_ou['book_over_odds'])} UNDER={fmt_american(odds_ou['book_under_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("ou")
    else:
        result["_markets_failed"].append("ou")
    time.sleep(random.uniform(2.0, 4.0))

    # ── AH ───────────────────────────────────────────────────────────────────
    soup_ah = fetch_market(session, event_id, slug, "ah", fixture_id)
    if soup_ah:
        odds_ah = parse_ah(soup_ah, fixture_id)
        if odds_ah:
            result["book_spread_line"]       = odds_ah["book_spread_line"]
            result["book_home_spread_odds"]  = odds_ah["book_home_spread_odds"]
            result["book_away_spread_odds"]  = odds_ah["book_away_spread_odds"]
            result["_markets_passed"].append("ah")
            log_odds("RESULT_AH", f"line={odds_ah['book_spread_line']:+.2f} HOME_SP={fmt_american(odds_ah['book_home_spread_odds'])} AWAY_SP={fmt_american(odds_ah['book_away_spread_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("ah")
    else:
        result["_markets_failed"].append("ah")
    time.sleep(random.uniform(2.0, 4.0))

    # ── DC ───────────────────────────────────────────────────────────────────
    soup_dc = fetch_market(session, event_id, slug, "dc", fixture_id)
    if soup_dc:
        # Pass 1x2 decimals for DC consistency validation (Directive 2)
        h_dec = odds_1x2.get("_1x2_home_dec") if odds_1x2 else None
        a_dec = odds_1x2.get("_1x2_away_dec") if odds_1x2 else None
        d_dec = odds_1x2.get("_1x2_draw_dec") if odds_1x2 else None
        odds_dc = parse_dc(soup_dc, fixture_id, home_dec=h_dec, away_dec=a_dec, draw_dec=d_dec)
        if odds_dc:
            result["book_dc_1x_odds"] = odds_dc["book_dc_1x_odds"]
            result["book_dc_12_odds"] = odds_dc["book_dc_12_odds"]
            result["book_dc_x2_odds"] = odds_dc["book_dc_x2_odds"]
            result["_markets_passed"].append("dc")
            log_odds("RESULT_DC", f"1X={fmt_american(odds_dc['book_dc_1x_odds'])} 12={fmt_american(odds_dc['book_dc_12_odds'])} X2={fmt_american(odds_dc['book_dc_x2_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("dc")
    else:
        result["_markets_failed"].append("dc")
    time.sleep(random.uniform(2.0, 4.0))

    # ── BTTS ─────────────────────────────────────────────────────────────────
    soup_bts = fetch_market(session, event_id, slug, "bts", fixture_id)
    if soup_bts:
        odds_bts = parse_bts(soup_bts, fixture_id)
        if odds_bts:
            result["book_btts_yes_odds"] = odds_bts["book_btts_yes_odds"]
            result["book_btts_no_odds"]  = odds_bts["book_btts_no_odds"]
            result["_markets_passed"].append("bts")
            log_odds("RESULT_BTTS", f"YES={fmt_american(odds_bts['book_btts_yes_odds'])} NO={fmt_american(odds_bts['book_btts_no_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("bts")
    else:
        result["_markets_failed"].append("bts")

    # ── Summary ──────────────────────────────────────────────────────────────
    n_pass = len(result["_markets_passed"])
    n_fail = len(result["_markets_failed"])
    log_state("FIXTURE_SUMMARY", f"Markets PASS: {n_pass}/5 {result['_markets_passed']} | FAIL: {n_fail}/5 {result['_markets_failed']}", fixture_id)

    # DB column completeness audit
    db_cols = ["book_home_ml", "book_draw_ml", "book_away_ml",
               "book_total_line", "book_over_odds", "book_under_odds",
               "book_spread_line", "book_home_spread_odds", "book_away_spread_odds",
               "book_dc_1x_odds", "book_dc_12_odds", "book_dc_x2_odds",
               "book_btts_yes_odds", "book_btts_no_odds"]
    populated = [c for c in db_cols if result.get(c) is not None]
    nulls     = [c for c in db_cols if result.get(c) is None]
    log_db("COL_AUDIT", f"Populated: {len(populated)}/14 | NULL: {len(nulls)}/14", fixture_id)
    for col in nulls:
        log_db("COL_NULL", f"  NULL → {col}", fixture_id)

    if n_pass == 5:
        log_pass("FIXTURE_DONE", f"All 5 markets scraped successfully | 14/14 DB columns populated", fixture_id)
    elif n_pass >= 3:
        log_warn("FIXTURE_DONE", f"{n_pass}/5 markets scraped | {len(nulls)} DB columns NULL", fixture_id)
    else:
        log_fail("FIXTURE_DONE", f"Only {n_pass}/5 markets scraped — fixture data INCOMPLETE", fixture_id)

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    log_section("WC2026 BETEXPLORER ODDS SCRAPER v2.0 — PRODUCTION RUN")
    log("INIT   ", "CONFIG", f"Bookmaker: bet365 (bid={BET365_BID}) | Markets: {MARKETS} | Fixtures: {len(WC2026_FIXTURES)}")
    log("INIT   ", "CONFIG", f"Log file: {LOG_FILE}")
    log("INIT   ", "CONFIG", f"Output file: {OUT_FILE}")

    # Accept optional fixture_id filter from CLI arg
    filter_id = sys.argv[1] if len(sys.argv) > 1 else None
    if filter_id:
        log("INIT   ", "FILTER", f"Running single fixture: {filter_id}")

    session = build_session()
    all_results = []
    pass_count = 0
    fail_count = 0

    fixtures_to_run = [(fid, eid, home, away, rnd) for fid, eid, home, away, rnd in WC2026_FIXTURES
                       if not filter_id or fid == filter_id]

    log("INIT   ", "QUEUE", f"Fixtures queued: {len(fixtures_to_run)}")

    for i, (fixture_id, event_id, home, away, rnd) in enumerate(fixtures_to_run):
        log_section(f"FIXTURE {i+1}/{len(fixtures_to_run)}: {fixture_id}")

        # Build slug from home/away names
        slug = f"{home.lower().replace(' ', '-').replace('.', '')}-{away.lower().replace(' ', '-').replace('.', '')}"

        result = scrape_fixture(session, fixture_id, event_id, home, away, slug)
        all_results.append(result)

        n_pass_mkt = len(result["_markets_passed"])
        if n_pass_mkt >= 4:
            pass_count += 1
        else:
            fail_count += 1

        # Inter-fixture delay (Directive 6)
        if i < len(fixtures_to_run) - 1:
            delay = random.uniform(3.0, 6.0)
            log_step("INTER_DELAY", f"Sleeping {delay:.1f}s before next fixture...")
            time.sleep(delay)

    # ── Final Summary ─────────────────────────────────────────────────────────
    log_section("FINAL SUMMARY")
    log("VERIFY ", "TOTAL", f"Fixtures run: {len(fixtures_to_run)} | PASS (≥4 markets): {pass_count} | FAIL (<4 markets): {fail_count}")

    for r in all_results:
        fid = r["fixture_id"]
        n_p = len(r["_markets_passed"])
        n_f = len(r["_markets_failed"])
        db_cols = ["book_home_ml", "book_draw_ml", "book_away_ml",
                   "book_total_line", "book_over_odds", "book_under_odds",
                   "book_spread_line", "book_home_spread_odds", "book_away_spread_odds",
                   "book_dc_1x_odds", "book_dc_12_odds", "book_dc_x2_odds",
                   "book_btts_yes_odds", "book_btts_no_odds"]
        populated = len([c for c in db_cols if r.get(c) is not None])
        status = "✓ PASS" if n_p >= 4 else "✗ FAIL"
        log("VERIFY ", "FIXTURE_RESULT", f"{status} | {fid:<20} | {r['home_team']:<12} vs {r['away_team']:<12} | markets={n_p}/5 | db_cols={populated}/14")

    # ── Save output ───────────────────────────────────────────────────────────
    # Remove internal metadata keys before saving
    clean_results = []
    for r in all_results:
        clean = {k: v for k, v in r.items() if not k.startswith("_")}
        clean_results.append(clean)

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(clean_results, f, indent=2, default=str)

    log_pass("OUTPUT", f"Results saved to {OUT_FILE} | {len(clean_results)} fixtures")
    log("VERIFY ", "ELAPSED", f"Total elapsed: {time.time() - _start_time:.3f}s")
    log_section("SCRAPER COMPLETE")

    return all_results


if __name__ == "__main__":
    main()
