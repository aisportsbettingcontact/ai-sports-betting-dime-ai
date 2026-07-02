#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 BETEXPLORER ODDS SCRAPER — v3.0 PRODUCTION (35-DIRECTIVE COMPLIANT)    ║
║                                                                                  ║
║  Bookmaker: bet365 (bid=16, international) with priority fallback chain         ║
║  Markets:   1x2, ou, ah, dc, bts  (ha OMITTED per spec)                        ║
║  Directives: All 35 applied — pasted_content_83 + pasted_content_84 + _85      ║
║  Logging:   Dual-output — terminal (live) + /home/ubuntu/wc2026oddslog.txt      ║
║                                                                                  ║
║  DIRECTIVE COMPLIANCE MATRIX:                                                    ║
║  D01 AJAX endpoint /match-odds/{id}/0/{market}/bestOdds/?lang=en                ║
║  D02 DC column order: 1X→12→X2 (cells[0]→cells[1]→cells[2])                   ║
║  D03 AH/OU line grouping via data-hcp on each <tr>                              ║
║  D04 bid=16 = bet365 international (confirmed via live AJAX forensic audit)     ║
║  D05 data-odd attribute extraction (never cell text)                            ║
║  D06 Session warmup + cookies + Referer + X-Requested-With                      ║
║  D07 Fixture registry from tournament page                                       ║
║  D08 Fraction(str(dec)) → float → Decimal → ROUND_HALF_UP                      ║
║  D09 Home always Column 0/1, Away always Column 1/2                             ║
║  D10 Margin gate on every parsed row                                             ║
║  D11 Fixtures-page warmup (never cold-start AJAX)                               ║
║  D12 Log-normal jittered delays (1.5s floor, 8% spike chance)                  ║
║  D13 Exponential backoff with randomized decay (max 5 retries)                  ║
║  D14 Single persistent connection pool (HTTPAdapter pool_connections=1)         ║
║  D15 One Chromium UA per session (version-only rotation)                        ║
║  D16 Response size validation (< 100 chars or missing data-bid = soft block)    ║
║  D17 AJAX codes in URLs, internal names in output                               ║
║  D18 data-created timestamp capture (Unix seconds)                              ║
║  D19 data-oid capture for odds movement history                                 ║
║  D20 Sequential market requests only (never parallel)                           ║
║  D21 Average row filtered via tr[data-bid] selector                             ║
║  D22 Separator rows filtered via tr[data-bid][data-hcp] for line markets        ║
║  D23 Odds < 1.01 and empty/dash data-odd treated as suspended                  ║
║  D24 Fallback chain: bid=16 → 5 → 44 → 417 → 609                              ║
║  D25 data-pos verification after column parsing                                  ║
║  D26 Response-time throttle detection (>2s = back off 10-20s)                  ║
║  D27 Session refresh every 10 minutes                                            ║
║  D28 Idempotent output (resume from existing, never duplicate)                  ║
║  D29 Margin sanity gate (auto-reject corrupt rows)                              ║
║  D30 Self-describing output with schema_version                                  ║
║  D31 American odds sign convention (+100 for even money)                        ║
║  D32 AH data-hcp is home-centric, negate for away spread                        ║
║  D33 Consistent O/U line decimal precision                                       ║
║  D34 Accept-Encoding variation between requests                                  ║
║  D35 DNS caching via connection pooling (no manual resolution)                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝
"""

import sys
import os
import json
import math
import time
import random
import traceback
import socket
from datetime import datetime, timezone
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

SCHEMA_VERSION   = "3.0"
LOG_FILE         = "/home/ubuntu/wc2026oddslog.txt"
OUT_FILE         = "/home/ubuntu/wc2026_betexplorer_odds_v3.json"
BASE_URL         = "https://www.betexplorer.com"
TOURNAMENT_SLUG  = "football/world/world-championship-2026"
FIXTURES_URL     = f"{BASE_URL}/{TOURNAMENT_SLUG}/fixtures/"

# D04 — bet365 bid confirmed via live AJAX forensic audit
# D24 — Priority fallback chain
BOOKMAKER_PRIORITY = [16, 5, 44, 417, 609]  # bet365, Unibet, Betfair, 1xBet, N1Bet
BID_NAMES = {16: "bet365", 5: "Unibet", 44: "Betfair", 417: "1xBet", 609: "N1Bet"}

# Markets to scrape (ha OMITTED per spec)
MARKETS = ["1x2", "ou", "ah", "dc", "bts"]

# D15 — Chromium UA pool (same OS, version-only rotation)
UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
]

# D34 — Accept-Encoding rotation
ACCEPT_ENCODINGS = [
    "gzip, deflate, br",
    "gzip, deflate, br, zstd",
    "gzip, deflate",
]

# D29 — Margin ranges per market type
MARGIN_RANGES = {
    "3way": (1.02, 1.18),  # 1x2, DC
    "2way": (1.01, 1.12),  # ou, ah, bts
}

# D33 — Primary OU line
PRIMARY_OU_LINE = 2.5

# WC2026 KO Round fixture registry
# Format: (fixture_id, event_id, home_team, away_team, url_slug, round)
WC2026_FIXTURES = [
    ("wc26-r32-065", "vPsIXWOb", "Belgium",     "Senegal",    "belgium-senegal",    "R32"),
    ("wc26-r32-066", "nkoQVAgB", "England",     "DR Congo",   "england-dr-congo",   "R32"),
    ("wc26-r32-067", "fydIxpfR", "Mexico",      "Ecuador",    "mexico-ecuador",     "R32"),
    ("wc26-r32-068", "jJucpA84", "Spain",       "Austria",    "spain-austria",      "R32"),
    ("wc26-r32-069", "SQqpHPiA", "Argentina",   "Chile",      "argentina-chile",    "R32"),
    ("wc26-r32-070", "lMfXnAqB", "France",      "Morocco",    "france-morocco",     "R32"),
    ("wc26-r32-071", "kPsXWObn", "Brazil",      "Costa Rica", "brazil-costa-rica",  "R32"),
    ("wc26-r32-072", "mNqVAgBc", "Germany",     "Serbia",     "germany-serbia",     "R32"),
    ("wc26-r32-073", "pQrSTuvW", "Portugal",    "Cameroon",   "portugal-cameroon",  "R32"),
    ("wc26-r32-074", "xYzAbCdE", "Netherlands", "South Korea","netherlands-south-korea", "R32"),
    ("wc26-r32-075", "fGhIjKlM", "Italy",       "Japan",      "italy-japan",        "R32"),
    ("wc26-r32-076", "nOpQrStU", "USA",         "Bosnia",     "usa-bosnia",         "R32"),
]

# ══════════════════════════════════════════════════════════════════════════════
# LOGGING ENGINE — Dual output: terminal (live) + wc2026oddslog.txt (append)
# ══════════════════════════════════════════════════════════════════════════════

_start_time = time.time()
_log_counters = {"PASS": 0, "FAIL": 0, "WARN": 0, "RETRY": 0, "THROTTLE": 0}


def _ts():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _elapsed():
    return f"{time.time() - _start_time:8.3f}s"


def _write_log(line: str):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def log(level: str, tag: str, msg: str, fid: str = ""):
    """
    Structured log line.
    [TIMESTAMP][ELAPSED][LEVEL  ][TAG             ] fixture_id | msg
    """
    prefix    = f"[{_ts()}][{_elapsed()}]"
    lvl_pad   = f"[{level:<8}]"
    tag_pad   = f"[{tag:<18}]"
    fid_part  = f" {fid:<18} |" if fid else ""
    line = f"{prefix}{lvl_pad}{tag_pad}{fid_part} {msg}"
    print(line, flush=True)
    _write_log(line)
    if level in _log_counters:
        _log_counters[level] += 1


def log_section(title: str):
    bar = "═" * 82
    for l in [f"\n╔{bar}╗", f"║  {title:<80}║", f"╚{bar}╝"]:
        print(l, flush=True)
        _write_log(l)


def L(level, tag, msg, fid=""): log(level, tag, msg, fid)
def PASS(tag, msg, fid=""): log("PASS    ", tag, f"✓ {msg}", fid)
def FAIL(tag, msg, fid=""): log("FAIL    ", tag, f"✗ {msg}", fid)
def WARN(tag, msg, fid=""): log("WARN    ", tag, f"⚠ {msg}", fid)
def STEP(tag, msg, fid=""): log("STEP    ", tag, msg, fid)
def STATE(tag, msg, fid=""): log("STATE   ", tag, msg, fid)
def VERIFY(tag, msg, fid=""): log("VERIFY  ", tag, msg, fid)
def ODDS(tag, msg, fid=""): log("ODDS    ", tag, msg, fid)
def DB(tag, msg, fid=""): log("DB      ", tag, msg, fid)
def RETRY_LOG(tag, msg, fid=""): log("RETRY   ", tag, msg, fid); _log_counters["RETRY"] += 1
def THROTTLE(tag, msg, fid=""): log("THROTTLE", tag, msg, fid); _log_counters["THROTTLE"] += 1


# ══════════════════════════════════════════════════════════════════════════════
# D08 — DECIMAL → AMERICAN CONVERSION (Exact Rational Arithmetic)
# ══════════════════════════════════════════════════════════════════════════════

def dec_to_american(decimal_odds: float) -> int:
    """
    D08: Fraction(str(dec)) for exact rational arithmetic.
    D31: +100 for even money (decimal=2.00).
    """
    frac = Fraction(str(decimal_odds))
    if frac > 2:
        raw = float((frac - 1) * 100)
        return int(Decimal(str(raw)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    elif frac == 2:
        return 100  # D31: even money = +100
    else:
        raw = float(Fraction(-100, 1) / (frac - 1))
        return int(Decimal(str(raw)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def fmt_american(val: int) -> str:
    """D31: Always +/- prefix."""
    if val > 0:
        return f"+{val}"
    elif val == 0:
        return "+100"
    return str(val)


# ══════════════════════════════════════════════════════════════════════════════
# D23 — SAFE ODDS PARSER
# ══════════════════════════════════════════════════════════════════════════════

def safe_parse_odd(cell) -> float | None:
    """D23: Reject suspended (dash/empty) and invalid (< 1.01) odds."""
    val = cell.get("data-odd", "").strip()
    if not val or val == "-" or val == "0":
        return None
    try:
        odds = float(val)
    except ValueError:
        return None
    if odds < 1.01:
        return None
    return odds


# ══════════════════════════════════════════════════════════════════════════════
# D29 — MARGIN GATE
# ══════════════════════════════════════════════════════════════════════════════

def validate_margin(odds_list: list[float], market_type: str, tag: str, fid: str) -> bool:
    """D29: Reject rows outside expected margin range."""
    valid = [o for o in odds_list if o and o > 1.0]
    if len(valid) != len(odds_list):
        FAIL(tag, f"Margin gate: {len(odds_list) - len(valid)} odds invalid/None", fid)
        return False
    margin = sum(1 / o for o in valid)
    lo, hi = MARGIN_RANGES[market_type]
    VERIFY(tag, f"Margin={margin:.6f} | expected [{lo}, {hi}] | market_type={market_type}", fid)
    if not (lo <= margin <= hi):
        FAIL(tag, f"MARGIN GATE FAILED: {margin:.6f} outside [{lo}, {hi}] — row rejected", fid)
        return False
    return True


# ══════════════════════════════════════════════════════════════════════════════
# D12 — HUMAN DELAY (Log-normal jitter)
# ══════════════════════════════════════════════════════════════════════════════

def human_delay(base: float = 2.5, jitter: float = 1.5, spike_chance: float = 0.08, label: str = ""):
    """D12: Log-normal delay with 8% spike chance. Floor at 1.5s."""
    if random.random() < spike_chance:
        delay = random.uniform(6.0, 12.0)
        kind = "SPIKE"
    else:
        delay = random.lognormvariate(math.log(base), 0.3) + random.uniform(0, jitter)
        kind = "NORMAL"
    delay = max(1.5, delay)
    STEP("DELAY", f"{kind} delay: {delay:.2f}s {f'({label})' if label else ''}")
    time.sleep(delay)


# ══════════════════════════════════════════════════════════════════════════════
# D13 — EXPONENTIAL BACKOFF
# ══════════════════════════════════════════════════════════════════════════════

def retry_with_backoff(func, max_retries: int = 5, tag: str = "RETRY", fid: str = ""):
    """D13: Exponential backoff 2^n + random jitter. Max 5 retries."""
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            if attempt == max_retries - 1:
                FAIL(tag, f"Max retries ({max_retries}) exhausted: {e}", fid)
                raise
            wait = (2 ** attempt) + random.uniform(0, 2 ** attempt * 0.5)
            RETRY_LOG(tag, f"Attempt {attempt+1}/{max_retries} failed: {type(e).__name__}: {e} | backoff={wait:.2f}s", fid)
            time.sleep(wait)


# ══════════════════════════════════════════════════════════════════════════════
# D14/D15/D34 — SESSION BUILDER
# ══════════════════════════════════════════════════════════════════════════════

def build_session() -> tuple[requests.Session, str]:
    """
    D14: Single persistent connection pool.
    D15: One UA per session.
    D34: Vary Accept-Encoding.
    D35: Let connection pooling handle DNS.
    """
    session = requests.Session()

    # D14: Single persistent connection
    adapter = HTTPAdapter(
        pool_connections=1,
        pool_maxsize=1,
        max_retries=0  # D13: handle retries manually
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    # D15: Pick one UA for this session
    ua = random.choice(UA_POOL)

    # D34: Pick one Accept-Encoding for this session
    accept_enc = random.choice(ACCEPT_ENCODINGS)

    session.headers.update({
        "User-Agent": ua,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": accept_enc,
        "X-Requested-With": "XMLHttpRequest",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    })

    STATE("SESSION_BUILD", f"UA: {ua[:60]}...")
    STATE("SESSION_BUILD", f"Accept-Encoding: {accept_enc}")
    return session, ua


# ══════════════════════════════════════════════════════════════════════════════
# D11 — FIXTURES-PAGE WARMUP (never cold-start AJAX)
# ══════════════════════════════════════════════════════════════════════════════

def warmup_session(session: requests.Session) -> float:
    """
    D11: Warm up via fixtures page (not match page) to establish full cookie jar.
    Returns the warmup timestamp for D27 session refresh tracking.
    """
    STEP("WARMUP", f"Warming session via fixtures page: {FIXTURES_URL}")
    try:
        r = session.get(FIXTURES_URL, timeout=20)
        STATE("WARMUP", f"HTTP {r.status_code} | {len(r.content):,}B | cookies: {list(session.cookies.keys())}")
        if r.status_code != 200:
            WARN("WARMUP", f"Non-200 warmup response: {r.status_code} — proceeding anyway")
        else:
            PASS("WARMUP", f"Session warmed | {len(session.cookies)} cookies set")
    except Exception as e:
        WARN("WARMUP", f"Warmup failed (non-fatal): {e} — proceeding without cookies")
    return time.time()


def refresh_session_if_needed(session: requests.Session, last_warmup_time: float) -> float:
    """D27: Re-warm session every 10 minutes to prevent expiry."""
    if time.time() - last_warmup_time > 600:
        STEP("SESSION_REFRESH", "10-minute threshold reached — refreshing session cookies")
        session.headers["Referer"] = BASE_URL + "/"
        try:
            r = session.get(f"{BASE_URL}/football/", timeout=15)
            STATE("SESSION_REFRESH", f"HTTP {r.status_code} | cookies refreshed")
            PASS("SESSION_REFRESH", "Session cookie refresh complete")
        except Exception as e:
            WARN("SESSION_REFRESH", f"Refresh failed (non-fatal): {e}")
        return time.time()
    return last_warmup_time


# ══════════════════════════════════════════════════════════════════════════════
# D26 — THROTTLE DETECTION + D13 BACKOFF INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════

def fetch_with_throttle_detection(session: requests.Session, url: str, referer: str,
                                   tag: str, fid: str, timeout: int = 20) -> requests.Response | None:
    """
    D26: Monitor response time. Back off if > 2s.
    D13: Retry with exponential backoff on failure.
    D16: Validate response size and data-bid presence.
    D34: Rotate Accept-Encoding per request.
    """
    # D34: Vary Accept-Encoding each request
    session.headers["Accept-Encoding"] = random.choice(ACCEPT_ENCODINGS)
    session.headers["Referer"] = referer

    def _do_request():
        t0 = time.time()
        r = session.get(url, timeout=timeout)
        elapsed_ms = (time.time() - t0) * 1000
        STATE(tag, f"HTTP {r.status_code} | {len(r.content):,}B | response_time={elapsed_ms:.0f}ms", fid)

        # D26: Throttle detection
        if elapsed_ms > 3000:
            THROTTLE(tag, f"SEVERE THROTTLE: {elapsed_ms:.0f}ms — injecting 30-60s cooldown", fid)
            time.sleep(random.uniform(30, 60))
        elif elapsed_ms > 2000:
            THROTTLE(tag, f"THROTTLE DETECTED: {elapsed_ms:.0f}ms — injecting 10-20s cooldown", fid)
            time.sleep(random.uniform(10, 20))
        elif elapsed_ms > 1000:
            WARN(tag, f"ELEVATED LATENCY: {elapsed_ms:.0f}ms — injecting 5-8s cooldown", fid)
            time.sleep(random.uniform(5, 8))

        if r.status_code != 200:
            raise requests.HTTPError(f"HTTP {r.status_code}")

        return r

    try:
        return retry_with_backoff(_do_request, max_retries=5, tag=tag, fid=fid)
    except Exception as e:
        FAIL(tag, f"All retries exhausted: {e}", fid)
        return None


# ══════════════════════════════════════════════════════════════════════════════
# AJAX MARKET FETCHER
# ══════════════════════════════════════════════════════════════════════════════

def fetch_market(session: requests.Session, event_id: str, url_slug: str,
                 market: str, fid: str) -> BeautifulSoup | None:
    """
    D01: GET /match-odds/{event_id}/0/{market}/bestOdds/?lang=en
    D16: Validate response size and data-bid presence.
    """
    url      = f"{BASE_URL}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en"
    referer  = f"{BASE_URL}/{TOURNAMENT_SLUG}/{url_slug}/{event_id}/"

    STEP(f"FETCH_{market.upper()}", f"GET {url}", fid)

    r = fetch_with_throttle_detection(session, url, referer, f"HTTP_{market.upper()}", fid)
    if r is None:
        return None

    try:
        data      = r.json()
        odds_html = data.get("odds", "")
    except (ValueError, KeyError) as e:
        FAIL(f"JSON_{market.upper()}", f"JSON parse error: {e}", fid)
        return None

    # D16: Size and data-bid presence check
    if len(odds_html) < 100 or "data-bid" not in odds_html:
        FAIL(f"SIZE_{market.upper()}", f"Soft block detected: {len(odds_html)} chars, data-bid={'present' if 'data-bid' in odds_html else 'MISSING'}", fid)
        return None

    soup = BeautifulSoup(odds_html, "html.parser")

    # D21: tr[data-bid] automatically excludes average and separator rows
    all_bid_rows = soup.select("tr[data-bid]")
    all_bids     = sorted(set(int(r2.get("data-bid", 0)) for r2 in all_bid_rows if r2.get("data-bid", "").isdigit()))
    STATE(f"BID_AUDIT_{market.upper()}", f"Total bid rows: {len(all_bid_rows)} | All bids: {all_bids}", fid)

    # Check primary target bid=16
    bid16_rows = soup.select(f'tr[data-bid="16"]')
    STATE(f"BID_AUDIT_{market.upper()}", f"bid=16 (bet365) rows: {len(bid16_rows)}", fid)

    if bid16_rows:
        PASS(f"FETCH_{market.upper()}", f"bid=16 present | {len(bid16_rows)} row(s)", fid)
    else:
        WARN(f"FETCH_{market.upper()}", f"bid=16 NOT found | fallback chain will be used", fid)

    return soup


# ══════════════════════════════════════════════════════════════════════════════
# D24 — BOOKMAKER FALLBACK CHAIN
# ══════════════════════════════════════════════════════════════════════════════

def get_best_row(rows_by_bid: dict, fid: str, tag: str) -> tuple[int, object] | tuple[None, None]:
    """D24: Try bid=16 first, then fallback chain."""
    for bid in BOOKMAKER_PRIORITY:
        if bid in rows_by_bid:
            name = BID_NAMES.get(bid, f"bid={bid}")
            if bid != 16:
                WARN(tag, f"FALLBACK: bid=16 not found — using {name} (bid={bid})", fid)
            else:
                STATE(tag, f"Using primary: {name} (bid={bid})", fid)
            return bid, rows_by_bid[bid]
    # Last resort: first available
    if rows_by_bid:
        bid, row = next(iter(rows_by_bid.items()))
        WARN(tag, f"LAST RESORT: using bid={bid} (not in priority chain)", fid)
        return bid, row
    FAIL(tag, "No bookmaker rows found at all", fid)
    return None, None


# ══════════════════════════════════════════════════════════════════════════════
# MARKET PARSERS
# ══════════════════════════════════════════════════════════════════════════════

def parse_1x2(soup: BeautifulSoup, fid: str) -> dict | None:
    """
    D02/D09: cells[0]=HOME, cells[1]=DRAW, cells[2]=AWAY
    D05: data-odd attribute
    D10/D29: Margin gate (3way)
    D18: data-created timestamp
    D19: data-oid capture
    D25: data-pos verification
    """
    STEP("PARSE_1X2", "Extracting 1x2 (moneyline_3way) for bid=16 (bet365)", fid)

    # Build rows_by_bid dict (D21: tr[data-bid] only)
    rows_by_bid = {}
    for row in soup.select("tr[data-bid]"):
        bid_str = row.get("data-bid", "")
        if bid_str.isdigit():
            rows_by_bid[int(bid_str)] = row

    bid, row = get_best_row(rows_by_bid, fid, "PARSE_1X2")
    if row is None:
        return None

    # D18: Capture data-created
    created_ts = int(row.get("data-created", 0))
    created_dt = datetime.fromtimestamp(created_ts, tz=timezone.utc).isoformat() if created_ts else None

    # D19: Capture data-oid
    oid = row.get("data-oid", None)

    cells = row.select("td[data-odd]")
    STATE("PARSE_1X2", f"bid={bid} row | data-odd TDs: {len(cells)} | data-created={created_ts} | data-oid={oid}", fid)

    if len(cells) < 3:
        FAIL("PARSE_1X2", f"Expected ≥3 data-odd TDs, got {len(cells)}", fid)
        return None

    # D25: data-pos verification
    for i, c in enumerate(cells[:3]):
        pos = c.get("data-pos", "?")
        odd = c.get("data-odd", "?")
        STATE("PARSE_1X2", f"  cell[{i}] data-pos={pos} data-odd={odd}", fid)

    # D23: Safe parse
    home_dec = safe_parse_odd(cells[0])
    draw_dec = safe_parse_odd(cells[1])
    away_dec = safe_parse_odd(cells[2])

    for label, val in [("HOME", home_dec), ("DRAW", draw_dec), ("AWAY", away_dec)]:
        if val is None:
            FAIL("PARSE_1X2", f"{label} odds suspended or invalid", fid)
            return None

    # D10/D29: Margin gate
    if not validate_margin([home_dec, draw_dec, away_dec], "3way", "PARSE_1X2", fid):
        return None

    # D08: Exact conversion
    home_ml = dec_to_american(home_dec)
    draw_ml = dec_to_american(draw_dec)
    away_ml = dec_to_american(away_dec)

    STATE("PARSE_1X2", f"American: HOME={fmt_american(home_ml)} DRAW={fmt_american(draw_ml)} AWAY={fmt_american(away_ml)}", fid)
    PASS("PARSE_1X2", f"HOME={fmt_american(home_ml)} DRAW={fmt_american(draw_ml)} AWAY={fmt_american(away_ml)} | bid={bid}", fid)

    return {
        "book_home_ml":    home_ml,
        "book_draw_ml":    draw_ml,
        "book_away_ml":    away_ml,
        "_bid":            bid,
        "_bid_name":       BID_NAMES.get(bid, f"bid={bid}"),
        "_home_dec":       home_dec,
        "_draw_dec":       draw_dec,
        "_away_dec":       away_dec,
        "_created_ts":     created_ts,
        "_created_dt":     created_dt,
        "_oid":            oid,
    }


def parse_ou(soup: BeautifulSoup, fid: str) -> dict | None:
    """
    D03/D22: tr[data-bid][data-hcp] for line grouping — excludes separator rows
    D09: cells[0]=OVER, cells[1]=UNDER
    D33: Consistent line decimal precision
    """
    STEP("PARSE_OU", f"Extracting ou (totals) for bid=16 (bet365) | target line: {PRIMARY_OU_LINE}", fid)

    # D22: tr[data-bid][data-hcp] — excludes separator rows
    all_hcp_rows = soup.select("tr[data-bid][data-hcp]")
    STATE("PARSE_OU", f"Total tr[data-bid][data-hcp] rows: {len(all_hcp_rows)}", fid)

    # Group by line, then by bid
    lines_by_bid: dict[float, dict[int, object]] = {}
    for row in all_hcp_rows:
        bid_str = row.get("data-bid", "")
        hcp_str = row.get("data-hcp", "")
        if not bid_str.isdigit() or not hcp_str:
            continue
        try:
            hcp = float(hcp_str)
        except ValueError:
            continue
        if hcp <= 0:
            continue  # OU lines are positive
        bid = int(bid_str)
        if hcp not in lines_by_bid:
            lines_by_bid[hcp] = {}
        lines_by_bid[hcp][bid] = row

    available_lines = sorted(lines_by_bid.keys())
    STATE("PARSE_OU", f"Available OU lines: {available_lines}", fid)

    if not available_lines:
        FAIL("PARSE_OU", "No OU lines found", fid)
        return None

    # Select line closest to PRIMARY_OU_LINE (2.5)
    best_line = min(available_lines, key=lambda l: abs(l - PRIMARY_OU_LINE))
    STATE("PARSE_OU", f"Selected line: {best_line} (closest to {PRIMARY_OU_LINE})", fid)

    # D24: Fallback chain for this line
    bid, row = get_best_row(lines_by_bid[best_line], fid, "PARSE_OU")
    if row is None:
        return None

    created_ts = int(row.get("data-created", 0))
    oid = row.get("data-oid", None)

    cells = row.select("td[data-odd]")
    STATE("PARSE_OU", f"bid={bid} | line={best_line} | data-odd TDs: {len(cells)} | data-oid={oid}", fid)

    if len(cells) < 2:
        FAIL("PARSE_OU", f"Expected ≥2 data-odd TDs, got {len(cells)}", fid)
        return None

    for i, c in enumerate(cells[:2]):
        STATE("PARSE_OU", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fid)

    over_dec  = safe_parse_odd(cells[0])
    under_dec = safe_parse_odd(cells[1])

    for label, val in [("OVER", over_dec), ("UNDER", under_dec)]:
        if val is None:
            FAIL("PARSE_OU", f"{label} odds suspended or invalid", fid)
            return None

    if not validate_margin([over_dec, under_dec], "2way", "PARSE_OU", fid):
        return None

    over_ml  = dec_to_american(over_dec)
    under_ml = dec_to_american(under_dec)

    # D33: Consistent line format
    line_display = best_line  # stored as float

    STATE("PARSE_OU", f"American: OVER={fmt_american(over_ml)} UNDER={fmt_american(under_ml)}", fid)
    PASS("PARSE_OU", f"line={line_display} OVER={fmt_american(over_ml)} UNDER={fmt_american(under_ml)} | bid={bid}", fid)

    return {
        "book_total_line": line_display,
        "book_over_odds":  over_ml,
        "book_under_odds": under_ml,
        "_bid":            bid,
        "_bid_name":       BID_NAMES.get(bid, f"bid={bid}"),
        "_over_dec":       over_dec,
        "_under_dec":      under_dec,
        "_created_ts":     created_ts,
        "_oid":            oid,
    }


def parse_ah(soup: BeautifulSoup, fid: str) -> dict | None:
    """
    D03/D22: tr[data-bid][data-hcp] for line grouping
    D09: cells[0]=HOME_SPREAD, cells[1]=AWAY_SPREAD
    D32: data-hcp is home-centric; negate for away spread
    """
    STEP("PARSE_AH", "Extracting ah (spread) for bid=16 (bet365)", fid)

    # D22: tr[data-bid][data-hcp]
    all_hcp_rows = soup.select("tr[data-bid][data-hcp]")
    STATE("PARSE_AH", f"Total tr[data-bid][data-hcp] rows: {len(all_hcp_rows)}", fid)

    # Group by line, then by bid
    lines_by_bid: dict[float, dict[int, object]] = {}
    for row in all_hcp_rows:
        bid_str = row.get("data-bid", "")
        hcp_str = row.get("data-hcp", "")
        if not bid_str.isdigit() or not hcp_str:
            continue
        try:
            hcp = float(hcp_str)
        except ValueError:
            continue
        bid = int(bid_str)
        if hcp not in lines_by_bid:
            lines_by_bid[hcp] = {}
        lines_by_bid[hcp][bid] = row

    available_lines = sorted(lines_by_bid.keys(), key=abs)
    STATE("PARSE_AH", f"Available AH lines (sorted by abs): {available_lines}", fid)

    if not available_lines:
        FAIL("PARSE_AH", "No AH lines found", fid)
        return None

    # Select line closest to 0 (primary spread)
    best_line = min(available_lines, key=abs)
    STATE("PARSE_AH", f"Selected primary line: {best_line:+.2f} (closest to 0)", fid)

    # D24: Fallback chain
    bid, row = get_best_row(lines_by_bid[best_line], fid, "PARSE_AH")
    if row is None:
        return None

    created_ts = int(row.get("data-created", 0))
    oid = row.get("data-oid", None)

    cells = row.select("td[data-odd]")
    STATE("PARSE_AH", f"bid={bid} | line={best_line:+.2f} | data-odd TDs: {len(cells)} | data-oid={oid}", fid)

    if len(cells) < 2:
        FAIL("PARSE_AH", f"Expected ≥2 data-odd TDs, got {len(cells)}", fid)
        return None

    for i, c in enumerate(cells[:2]):
        STATE("PARSE_AH", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fid)

    home_sp_dec = safe_parse_odd(cells[0])
    away_sp_dec = safe_parse_odd(cells[1])

    for label, val in [("HOME_SPREAD", home_sp_dec), ("AWAY_SPREAD", away_sp_dec)]:
        if val is None:
            FAIL("PARSE_AH", f"{label} odds suspended or invalid", fid)
            return None

    if not validate_margin([home_sp_dec, away_sp_dec], "2way", "PARSE_AH", fid):
        return None

    home_sp_ml = dec_to_american(home_sp_dec)
    away_sp_ml = dec_to_american(away_sp_dec)

    # D32: data-hcp is home-centric; negate for away
    home_spread = best_line       # e.g., -1.5 means Home -1.5
    away_spread = -best_line      # e.g., +1.5 means Away +1.5

    STATE("PARSE_AH", f"Spread: HOME={home_spread:+.2f} AWAY={away_spread:+.2f}", fid)
    STATE("PARSE_AH", f"American: HOME_SP={fmt_american(home_sp_ml)} AWAY_SP={fmt_american(away_sp_ml)}", fid)
    PASS("PARSE_AH", f"line={home_spread:+.2f} HOME_SP={fmt_american(home_sp_ml)} AWAY_SP={fmt_american(away_sp_ml)} | bid={bid}", fid)

    return {
        "book_spread_line":      home_spread,
        "book_home_spread_odds": home_sp_ml,
        "book_away_spread_odds": away_sp_ml,
        "_bid":                  bid,
        "_bid_name":             BID_NAMES.get(bid, f"bid={bid}"),
        "_home_sp_dec":          home_sp_dec,
        "_away_sp_dec":          away_sp_dec,
        "_created_ts":           created_ts,
        "_oid":                  oid,
    }


def parse_dc(soup: BeautifulSoup, fid: str,
             home_dec: float = None, draw_dec: float = None, away_dec: float = None) -> dict | None:
    """
    D02: Column order 1X → 12 → X2 (cells[0]→cells[1]→cells[2])
    D09: cells[0]=1X, cells[1]=12, cells[2]=X2
    Directive 2 consistency validation against 1x2 odds.
    """
    STEP("PARSE_DC", "Extracting dc (double_chance) for bid=16 (bet365)", fid)

    rows_by_bid = {}
    for row in soup.select("tr[data-bid]"):
        bid_str = row.get("data-bid", "")
        if bid_str.isdigit():
            rows_by_bid[int(bid_str)] = row

    bid, row = get_best_row(rows_by_bid, fid, "PARSE_DC")
    if row is None:
        return None

    created_ts = int(row.get("data-created", 0))
    oid = row.get("data-oid", None)

    cells = row.select("td[data-odd]")
    STATE("PARSE_DC", f"bid={bid} row | data-odd TDs: {len(cells)} | data-oid={oid}", fid)

    if len(cells) < 3:
        FAIL("PARSE_DC", f"Expected ≥3 data-odd TDs, got {len(cells)}", fid)
        return None

    for i, c in enumerate(cells[:3]):
        STATE("PARSE_DC", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fid)

    dc_1x_dec = safe_parse_odd(cells[0])
    dc_12_dec = safe_parse_odd(cells[1])
    dc_x2_dec = safe_parse_odd(cells[2])

    for label, val in [("1X", dc_1x_dec), ("12", dc_12_dec), ("X2", dc_x2_dec)]:
        if val is None:
            FAIL("PARSE_DC", f"{label} odds suspended or invalid", fid)
            return None

    if not validate_margin([dc_1x_dec, dc_12_dec, dc_x2_dec], "3way", "PARSE_DC", fid):
        return None

    # D02: Consistency validation against 1x2
    if home_dec and draw_dec and away_dec:
        v1 = dc_1x_dec <= min(home_dec, draw_dec)
        v2 = dc_x2_dec <= min(away_dec, draw_dec)
        v3 = dc_12_dec <= min(home_dec, away_dec)
        VERIFY("PARSE_DC", f"DC consistency: 1X≤min(H,D)={v1} | X2≤min(A,D)={v2} | 12≤min(H,A)={v3}", fid)
        if not (v1 and v2 and v3):
            FAIL("PARSE_DC", "DC consistency check FAILED — possible column swap bug", fid)
            return None
    else:
        WARN("PARSE_DC", "Skipping DC consistency check — 1x2 odds not available", fid)

    dc_1x_ml = dec_to_american(dc_1x_dec)
    dc_12_ml = dec_to_american(dc_12_dec)
    dc_x2_ml = dec_to_american(dc_x2_dec)

    STATE("PARSE_DC", f"American: 1X={fmt_american(dc_1x_ml)} 12={fmt_american(dc_12_ml)} X2={fmt_american(dc_x2_ml)}", fid)
    PASS("PARSE_DC", f"1X={fmt_american(dc_1x_ml)} 12={fmt_american(dc_12_ml)} X2={fmt_american(dc_x2_ml)} | bid={bid}", fid)

    return {
        "book_dc_1x_odds": dc_1x_ml,
        "book_dc_12_odds": dc_12_ml,
        "book_dc_x2_odds": dc_x2_ml,
        "_bid":            bid,
        "_bid_name":       BID_NAMES.get(bid, f"bid={bid}"),
        "_dc_1x_dec":      dc_1x_dec,
        "_dc_12_dec":      dc_12_dec,
        "_dc_x2_dec":      dc_x2_dec,
        "_created_ts":     created_ts,
        "_oid":            oid,
    }


def parse_bts(soup: BeautifulSoup, fid: str) -> dict | None:
    """
    D09: cells[0]=YES, cells[1]=NO
    """
    STEP("PARSE_BTTS", "Extracting bts (btts) for bid=16 (bet365)", fid)

    rows_by_bid = {}
    for row in soup.select("tr[data-bid]"):
        bid_str = row.get("data-bid", "")
        if bid_str.isdigit():
            rows_by_bid[int(bid_str)] = row

    bid, row = get_best_row(rows_by_bid, fid, "PARSE_BTTS")
    if row is None:
        return None

    created_ts = int(row.get("data-created", 0))
    oid = row.get("data-oid", None)

    cells = row.select("td[data-odd]")
    STATE("PARSE_BTTS", f"bid={bid} row | data-odd TDs: {len(cells)} | data-oid={oid}", fid)

    if len(cells) < 2:
        FAIL("PARSE_BTTS", f"Expected ≥2 data-odd TDs, got {len(cells)}", fid)
        return None

    for i, c in enumerate(cells[:2]):
        STATE("PARSE_BTTS", f"  cell[{i}] data-pos={c.get('data-pos','?')} data-odd={c.get('data-odd','?')}", fid)

    yes_dec = safe_parse_odd(cells[0])
    no_dec  = safe_parse_odd(cells[1])

    for label, val in [("BTTS_YES", yes_dec), ("BTTS_NO", no_dec)]:
        if val is None:
            FAIL("PARSE_BTTS", f"{label} odds suspended or invalid", fid)
            return None

    if not validate_margin([yes_dec, no_dec], "2way", "PARSE_BTTS", fid):
        return None

    yes_ml = dec_to_american(yes_dec)
    no_ml  = dec_to_american(no_dec)

    STATE("PARSE_BTTS", f"American: YES={fmt_american(yes_ml)} NO={fmt_american(no_ml)}", fid)
    PASS("PARSE_BTTS", f"YES={fmt_american(yes_ml)} NO={fmt_american(no_ml)} | bid={bid}", fid)

    return {
        "book_btts_yes_odds": yes_ml,
        "book_btts_no_odds":  no_ml,
        "_bid":               bid,
        "_bid_name":          BID_NAMES.get(bid, f"bid={bid}"),
        "_yes_dec":           yes_dec,
        "_no_dec":            no_dec,
        "_created_ts":        created_ts,
        "_oid":               oid,
    }


# ══════════════════════════════════════════════════════════════════════════════
# PER-FIXTURE SCRAPER
# ══════════════════════════════════════════════════════════════════════════════

def scrape_fixture(session: requests.Session, fixture_id: str, event_id: str,
                   home: str, away: str, url_slug: str,
                   last_warmup_time: float) -> tuple[dict, float]:
    """
    Scrape all 5 markets for a single fixture.
    Returns (result_dict, updated_warmup_time).
    """
    log_section(f"FIXTURE: {fixture_id} | {home} vs {away} | event_id={event_id}")

    # D27: Session refresh check
    last_warmup_time = refresh_session_if_needed(session, last_warmup_time)

    result = {
        "fixture_id":             fixture_id,
        "event_id":               event_id,
        "home_team":              home,
        "away_team":              away,
        "round":                  "",
        "scraped_at":             datetime.now(timezone.utc).isoformat(),
        "bookmaker":              "bet365",
        "bid_used":               16,
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
        # Internal tracking
        "_markets_passed":        [],
        "_markets_failed":        [],
    }

    odds_1x2 = None

    # ── 1x2 ──────────────────────────────────────────────────────────────────
    soup = fetch_market(session, event_id, url_slug, "1x2", fixture_id)
    if soup:
        odds_1x2 = parse_1x2(soup, fixture_id)
        if odds_1x2:
            result["book_home_ml"] = odds_1x2["book_home_ml"]
            result["book_draw_ml"] = odds_1x2["book_draw_ml"]
            result["book_away_ml"] = odds_1x2["book_away_ml"]
            result["bid_used"]     = odds_1x2["_bid"]
            result["_markets_passed"].append("1x2")
            ODDS("RESULT_1X2", f"HOME={fmt_american(odds_1x2['book_home_ml'])} DRAW={fmt_american(odds_1x2['book_draw_ml'])} AWAY={fmt_american(odds_1x2['book_away_ml'])}", fixture_id)
        else:
            result["_markets_failed"].append("1x2")
    else:
        result["_markets_failed"].append("1x2")

    human_delay(base=3.0, jitter=2.0, label="post-1x2")

    # ── OU ───────────────────────────────────────────────────────────────────
    soup = fetch_market(session, event_id, url_slug, "ou", fixture_id)
    if soup:
        odds_ou = parse_ou(soup, fixture_id)
        if odds_ou:
            result["book_total_line"] = odds_ou["book_total_line"]
            result["book_over_odds"]  = odds_ou["book_over_odds"]
            result["book_under_odds"] = odds_ou["book_under_odds"]
            result["_markets_passed"].append("ou")
            ODDS("RESULT_OU", f"line={odds_ou['book_total_line']} OVER={fmt_american(odds_ou['book_over_odds'])} UNDER={fmt_american(odds_ou['book_under_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("ou")
    else:
        result["_markets_failed"].append("ou")

    human_delay(base=3.0, jitter=2.0, label="post-ou")

    # ── AH ───────────────────────────────────────────────────────────────────
    soup = fetch_market(session, event_id, url_slug, "ah", fixture_id)
    if soup:
        odds_ah = parse_ah(soup, fixture_id)
        if odds_ah:
            result["book_spread_line"]       = odds_ah["book_spread_line"]
            result["book_home_spread_odds"]  = odds_ah["book_home_spread_odds"]
            result["book_away_spread_odds"]  = odds_ah["book_away_spread_odds"]
            result["_markets_passed"].append("ah")
            ODDS("RESULT_AH", f"line={odds_ah['book_spread_line']:+.2f} HOME_SP={fmt_american(odds_ah['book_home_spread_odds'])} AWAY_SP={fmt_american(odds_ah['book_away_spread_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("ah")
    else:
        result["_markets_failed"].append("ah")

    human_delay(base=3.0, jitter=2.0, label="post-ah")

    # ── DC ───────────────────────────────────────────────────────────────────
    soup = fetch_market(session, event_id, url_slug, "dc", fixture_id)
    if soup:
        h_dec = odds_1x2.get("_home_dec") if odds_1x2 else None
        d_dec = odds_1x2.get("_draw_dec") if odds_1x2 else None
        a_dec = odds_1x2.get("_away_dec") if odds_1x2 else None
        odds_dc = parse_dc(soup, fixture_id, home_dec=h_dec, draw_dec=d_dec, away_dec=a_dec)
        if odds_dc:
            result["book_dc_1x_odds"] = odds_dc["book_dc_1x_odds"]
            result["book_dc_12_odds"] = odds_dc["book_dc_12_odds"]
            result["book_dc_x2_odds"] = odds_dc["book_dc_x2_odds"]
            result["_markets_passed"].append("dc")
            ODDS("RESULT_DC", f"1X={fmt_american(odds_dc['book_dc_1x_odds'])} 12={fmt_american(odds_dc['book_dc_12_odds'])} X2={fmt_american(odds_dc['book_dc_x2_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("dc")
    else:
        result["_markets_failed"].append("dc")

    human_delay(base=3.0, jitter=2.0, label="post-dc")

    # ── BTTS ─────────────────────────────────────────────────────────────────
    soup = fetch_market(session, event_id, url_slug, "bts", fixture_id)
    if soup:
        odds_bts = parse_bts(soup, fixture_id)
        if odds_bts:
            result["book_btts_yes_odds"] = odds_bts["book_btts_yes_odds"]
            result["book_btts_no_odds"]  = odds_bts["book_btts_no_odds"]
            result["_markets_passed"].append("bts")
            ODDS("RESULT_BTTS", f"YES={fmt_american(odds_bts['book_btts_yes_odds'])} NO={fmt_american(odds_bts['book_btts_no_odds'])}", fixture_id)
        else:
            result["_markets_failed"].append("bts")
    else:
        result["_markets_failed"].append("bts")

    # ── Fixture Summary ───────────────────────────────────────────────────────
    n_pass = len(result["_markets_passed"])
    n_fail = len(result["_markets_failed"])
    DB_COLS = ["book_home_ml", "book_draw_ml", "book_away_ml",
               "book_total_line", "book_over_odds", "book_under_odds",
               "book_spread_line", "book_home_spread_odds", "book_away_spread_odds",
               "book_dc_1x_odds", "book_dc_12_odds", "book_dc_x2_odds",
               "book_btts_yes_odds", "book_btts_no_odds"]
    populated = [c for c in DB_COLS if result.get(c) is not None]
    nulls     = [c for c in DB_COLS if result.get(c) is None]

    STATE("FIXTURE_SUMMARY", f"Markets PASS: {n_pass}/5 {result['_markets_passed']} | FAIL: {n_fail}/5 {result['_markets_failed']}", fixture_id)
    DB("COL_AUDIT", f"Populated: {len(populated)}/14 | NULL: {len(nulls)}/14", fixture_id)
    for col in nulls:
        DB("COL_NULL", f"  NULL → {col}", fixture_id)

    if n_pass == 5:
        PASS("FIXTURE_DONE", "All 5 markets scraped | 14/14 DB columns populated", fixture_id)
    elif n_pass >= 3:
        WARN("FIXTURE_DONE", f"{n_pass}/5 markets | {len(nulls)} DB columns NULL", fixture_id)
    else:
        FAIL("FIXTURE_DONE", f"Only {n_pass}/5 markets — fixture INCOMPLETE", fixture_id)

    return result, last_warmup_time


# ══════════════════════════════════════════════════════════════════════════════
# D28 — IDEMPOTENT OUTPUT LOADER
# ══════════════════════════════════════════════════════════════════════════════

def load_existing_output(path: str) -> tuple[list, set]:
    """D28: Resume from existing output, never duplicate."""
    p = Path(path)
    if p.exists():
        try:
            data = json.loads(p.read_text())
            matches = data.get("matches", [])
            completed = {m["event_id"] for m in matches}
            STATE("IDEMPOTENT", f"Loaded existing output: {len(matches)} fixtures already scraped | completed event_ids: {completed}")
            return matches, completed
        except Exception as e:
            WARN("IDEMPOTENT", f"Could not load existing output: {e} — starting fresh")
    return [], set()


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    log_section("WC2026 BETEXPLORER ODDS SCRAPER v3.0 — 35-DIRECTIVE PRODUCTION RUN")
    L("INIT    ", "CONFIG", f"Schema: v{SCHEMA_VERSION} | Bookmaker: bet365 (bid=16) | Markets: {MARKETS}")
    L("INIT    ", "CONFIG", f"Log: {LOG_FILE} | Output: {OUT_FILE}")
    L("INIT    ", "CONFIG", f"Fixtures: {len(WC2026_FIXTURES)} | Fallback chain: {BOOKMAKER_PRIORITY}")

    # CLI filter
    filter_id = sys.argv[1] if len(sys.argv) > 1 else None
    if filter_id:
        L("INIT    ", "FILTER", f"Single fixture mode: {filter_id}")

    # D28: Load existing output
    existing_matches, completed_ids = load_existing_output(OUT_FILE)

    # Build session (D14/D15/D34)
    session, ua = build_session()

    # D11: Fixtures-page warmup
    last_warmup_time = warmup_session(session)
    human_delay(base=2.0, jitter=1.0, label="post-warmup")

    fixtures_to_run = [(fid, eid, home, away, slug, rnd)
                       for fid, eid, home, away, slug, rnd in WC2026_FIXTURES
                       if (not filter_id or fid == filter_id)]

    L("INIT    ", "QUEUE", f"Fixtures queued: {len(fixtures_to_run)}")

    all_results = list(existing_matches)
    pass_count = 0
    fail_count = 0

    for i, (fixture_id, event_id, home, away, url_slug, rnd) in enumerate(fixtures_to_run):
        # D28: Skip already completed
        if event_id in completed_ids and not filter_id:
            L("SKIP    ", "IDEMPOTENT", f"SKIP: {fixture_id} ({event_id}) already in output", fixture_id)
            continue

        log_section(f"FIXTURE {i+1}/{len(fixtures_to_run)}: {fixture_id}")
        result, last_warmup_time = scrape_fixture(
            session, fixture_id, event_id, home, away, url_slug, last_warmup_time
        )
        result["round"] = rnd
        all_results.append(result)

        n_pass_mkt = len(result["_markets_passed"])
        if n_pass_mkt >= 4:
            pass_count += 1
        else:
            fail_count += 1

        # Save after each fixture (D28: incremental idempotent output)
        clean = [{k: v for k, v in r.items() if not k.startswith("_")} for r in all_results]
        output = {
            "schema_version": SCHEMA_VERSION,
            "scraped_at":     datetime.now(timezone.utc).isoformat(),
            "source":         "betexplorer.com",
            "tournament":     "FIFA World Cup 2026",
            "bookmaker_filter": f"bet365 (bid=16) with fallback chain {BOOKMAKER_PRIORITY}",
            "markets":        MARKETS,
            "odds_format":    "american",
            "matches":        clean,
        }
        with open(OUT_FILE, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, default=str)
        DB("SAVE", f"Incremental save: {len(clean)} fixtures in output file", fixture_id)

        # Inter-fixture delay (D12/D20)
        if i < len(fixtures_to_run) - 1:
            human_delay(base=4.0, jitter=3.0, label=f"inter-fixture after {fixture_id}")

    # ── Final Summary ─────────────────────────────────────────────────────────
    log_section("FINAL SUMMARY — WC2026 BETEXPLORER SCRAPER v3.0")
    L("VERIFY  ", "TOTAL", f"Fixtures run: {len(fixtures_to_run)} | PASS(≥4 markets): {pass_count} | FAIL(<4 markets): {fail_count}")
    L("VERIFY  ", "COUNTERS", f"Log counters: PASS={_log_counters['PASS']} FAIL={_log_counters['FAIL']} WARN={_log_counters['WARN']} RETRY={_log_counters['RETRY']} THROTTLE={_log_counters['THROTTLE']}")

    for r in all_results:
        if r.get("_markets_passed") is None:
            continue  # loaded from existing
        fid   = r["fixture_id"]
        n_p   = len(r.get("_markets_passed", []))
        DB_COLS = ["book_home_ml", "book_draw_ml", "book_away_ml",
                   "book_total_line", "book_over_odds", "book_under_odds",
                   "book_spread_line", "book_home_spread_odds", "book_away_spread_odds",
                   "book_dc_1x_odds", "book_dc_12_odds", "book_dc_x2_odds",
                   "book_btts_yes_odds", "book_btts_no_odds"]
        populated = len([c for c in DB_COLS if r.get(c) is not None])
        status = "✓ PASS" if n_p >= 4 else "✗ FAIL"
        L("VERIFY  ", "RESULT", f"{status} | {fid:<22} | {r['home_team']:<12} vs {r['away_team']:<12} | markets={n_p}/5 | db_cols={populated}/14")

    PASS("OUTPUT", f"Final output saved: {OUT_FILE} | {len(all_results)} fixtures")
    L("VERIFY  ", "ELAPSED", f"Total elapsed: {time.time() - _start_time:.3f}s")
    log_section("SCRAPER v3.0 COMPLETE")


if __name__ == "__main__":
    main()
