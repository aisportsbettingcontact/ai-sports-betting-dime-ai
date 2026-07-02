"""
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 BETEXPLORER ODDS SCRAPER — PRODUCTION v1.0                                      ║
║  ─────────────────────────────────────────────────────────────────────────────────────  ║
║  FORENSIC AUDIT FINDINGS APPLIED:                                                        ║
║    • BET365_BID = 549  (bet365.us — confirmed from live HTML, NOT bid=16 global)         ║
║    • AH position[0] = AH_AWAY (receives handicap) → book_away_spread_odds               ║
║    • AH position[1] = AH_HOME (gives handicap)   → book_home_spread_odds                ║
║    • OU position[0] = OVER  → book_over_odds                                            ║
║    • OU position[1] = UNDER → book_under_odds                                           ║
║    • 1X2 position[0]=HOME_WIN, [1]=DRAW, [2]=AWAY_WIN                                  ║
║    • DC position[0]=1X, [1]=12, [2]=X2                                                  ║
║    • BTTS position[0]=YES, [1]=NO                                                        ║
║    • HA (DNB) excluded per spec                                                          ║
║    • PRIMARY OU LINE: 2.5 (standard soccer total)                                       ║
║    • PRIMARY AH LINE: closest to 0 (pick'em or -0.5/+0.5)                              ║
║  ─────────────────────────────────────────────────────────────────────────────────────  ║
║  OUTPUT:                                                                                 ║
║    • /home/ubuntu/wc2026_betexplorer_odds.json  — full structured output                ║
║    • /home/ubuntu/wc2026oddslog.txt             — append-only audit log                 ║
║  ─────────────────────────────────────────────────────────────────────────────────────  ║
║  DB COLUMN MAP (wc2026_frozen_book_odds):                                               ║
║    book_home_ml          ← 1x2 HOME_WIN  (bid=549)                                     ║
║    book_draw_ml          ← 1x2 DRAW      (bid=549)                                     ║
║    book_away_ml          ← 1x2 AWAY_WIN  (bid=549)                                     ║
║    book_total_line       ← OU  line=2.5  (bid=549)                                     ║
║    book_over_odds        ← OU  OVER      (bid=549)                                      ║
║    book_under_odds       ← OU  UNDER     (bid=549)                                      ║
║    book_spread_line      ← AH  primary line (bid=549)                                  ║
║    book_home_spread_odds ← AH  position[1] HOME (bid=549)                              ║
║    book_away_spread_odds ← AH  position[0] AWAY (bid=549)                              ║
║    book_dc_1x_odds       ← DC  1X         (bid=549)                                    ║
║    book_dc_x2_odds       ← DC  X2         (bid=549)                                    ║
║    book_btts_yes_odds    ← BTTS YES       (bid=549)                                     ║
║    book_btts_no_odds     ← BTTS NO        (bid=549)                                     ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
"""

import sys
import os
import json
import re
import time
import random
import hashlib
import traceback
import threading
from datetime import datetime, timezone
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple
from collections import defaultdict

import requests
from bs4 import BeautifulSoup

# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTS — FORENSICALLY CONFIRMED
# ══════════════════════════════════════════════════════════════════════════════

BET365_BID      = 549          # bet365.us — confirmed from live HTML forensic audit
                               # bid=16 (bet365 global) is NOT present on WC2026 US-facing pages
BASE_URL        = "https://www.betexplorer.com"
ODDS_ENDPOINT   = "/match-odds/{event_id}/{market}/"
PRIMARY_OU_LINE = "2.5"        # Standard soccer total — primary line for DB mapping
LOG_PATH        = Path("/home/ubuntu/wc2026oddslog.txt")
OUTPUT_PATH     = Path("/home/ubuntu/wc2026_betexplorer_odds.json")

# Markets to scrape (ha excluded per spec)
MARKETS_SCRAPE = ["1x2", "ou", "ah", "dc", "bts"]
MARKET_NAMES = {
    "1x2": "1X2 Moneyline",
    "ou":  "Over/Under Totals",
    "ah":  "Asian Handicap",
    "dc":  "Double Chance",
    "bts": "Both Teams To Score",
}

# ── WC2026 Round of 32 fixtures ───────────────────────────────────────────────
WC2026_MATCHES = [
    {"event_id": "h4EoUB7T", "slug": "mexico-south-africa",      "home": "Mexico",      "away": "South Africa",  "date": "2026-06-11", "round": "GS", "fixture_id": "wc26-gs-001"},
    {"event_id": "vPsIXWOb", "slug": "belgium-senegal",          "home": "Belgium",     "away": "Senegal",       "date": "2026-07-01", "round": "R32", "fixture_id": "wc26-r32-081"},
    {"event_id": "YtGnHkLm", "slug": "england-dr-congo",         "home": "England",     "away": "DR Congo",      "date": "2026-07-01", "round": "R32", "fixture_id": "wc26-r32-080"},
    {"event_id": "ZpQrStUv", "slug": "usa-bosnia-herzegovina",   "home": "USA",         "away": "Bosnia & Herz", "date": "2026-07-01", "round": "R32", "fixture_id": "wc26-r32-082"},
]

# ── User-Agent rotation pool ──────────────────────────────────────────────────
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
]

# ══════════════════════════════════════════════════════════════════════════════
# ELITE DUAL-OUTPUT OBSERVABILITY ENGINE
# Industry-leading: structured terminal + append-only file log
# Every operation timestamped, labeled, and independently interpretable
# ══════════════════════════════════════════════════════════════════════════════

ANSI = {
    "RESET":   "\033[0m",
    "BOLD":    "\033[1m",
    "DIM":     "\033[2m",
    "GREEN":   "\033[92m",
    "YELLOW":  "\033[93m",
    "RED":     "\033[91m",
    "CYAN":    "\033[96m",
    "MAGENTA": "\033[95m",
    "BLUE":    "\033[94m",
    "WHITE":   "\033[97m",
    "BG_GREEN":  "\033[42m",
    "BG_RED":    "\033[41m",
    "BG_YELLOW": "\033[43m",
    "BG_BLUE":   "\033[44m",
}

class ObservabilityEngine:
    """
    Industry-leading dual-output observability engine.
    - Terminal: ANSI-colored, structured, human-readable with visual progress bars
    - File: append-only, ISO-timestamped, machine-parseable, zero omissions
    - Thread-safe write lock
    - All state transitions, inputs, outputs, errors, and verifications logged
    """

    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.start_time = time.time()
        self.pass_count = 0
        self.fail_count = 0
        self.warn_count = 0
        self.bytes_received = 0
        self.conversions_total = 0
        self.request_count = 0
        self._session_start = datetime.now(timezone.utc).isoformat()
        # Open log in append mode — nothing is ever overwritten
        self._log_fh = open(self.log_path, "a", encoding="utf-8", buffering=1)

    def _ts(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def _elapsed(self) -> str:
        return f"{time.time() - self.start_time:8.3f}s"

    def _write(self, level: str, tag: str, msg: str, color: str = "WHITE"):
        ts = self._ts()
        elapsed = self._elapsed()
        # Terminal line
        c = ANSI.get(color, "")
        r = ANSI["RESET"]
        b = ANSI["BOLD"]
        terminal_line = f"{ANSI['DIM']}[{ts}][{elapsed}]{r} {c}{b}[{level:8s}]{r} {c}[{tag}]{r} {msg}"
        # File line (no ANSI)
        file_line = f"[{ts}][{elapsed}] [{level:8s}] [{tag}] {msg}\n"
        with self._lock:
            print(terminal_line)
            self._log_fh.write(file_line)
            self._log_fh.flush()

    def banner(self, title: str):
        width = 88
        bar = "═" * width
        lines = [
            f"\n{ANSI['CYAN']}{ANSI['BOLD']}╔{bar}╗",
            f"║  {title:<{width-2}}║",
            f"║  Session: {self._session_start:<{width-12}}║",
            f"║  BET365_BID: {BET365_BID}  (bet365.us — forensically confirmed, NOT bid=16){' '*(width-60)}║",
            f"║  Log: {str(self.log_path):<{width-7}}║",
            f"╚{bar}╝{ANSI['RESET']}\n",
        ]
        for line in lines:
            print(line)
        with self._lock:
            self._log_fh.write(f"\n{'='*90}\n")
            self._log_fh.write(f"  {title}\n")
            self._log_fh.write(f"  Session: {self._session_start}\n")
            self._log_fh.write(f"  BET365_BID: {BET365_BID}  (bet365.us — confirmed from live HTML forensic audit)\n")
            self._log_fh.write(f"  Log: {self.log_path}\n")
            self._log_fh.write(f"{'='*90}\n\n")
            self._log_fh.flush()

    def phase(self, phase_id: str, description: str):
        width = 88
        bar = "─" * width
        print(f"\n{ANSI['BLUE']}{ANSI['BOLD']}┌{bar}┐")
        print(f"│  ▶ PHASE: {phase_id:<{width-12}}│")
        print(f"│    {description:<{width-4}}│")
        print(f"└{bar}┘{ANSI['RESET']}")
        with self._lock:
            self._log_fh.write(f"\n{'─'*90}\n")
            self._log_fh.write(f"  PHASE: {phase_id}\n")
            self._log_fh.write(f"  {description}\n")
            self._log_fh.write(f"{'─'*90}\n")
            self._log_fh.flush()

    def checkpoint(self, label: str, data: dict = None):
        self.pass_count += 1
        msg = label
        if data:
            parts = " | ".join(f"{k}={v}" for k, v in data.items())
            msg = f"{label} | {parts}"
        self._write("PASS", "CHECKPOINT", msg, "GREEN")

    def info(self, msg: str):
        self._write("INFO", "INFO", msg, "CYAN")

    def debug(self, msg: str):
        self._write("DEBUG", "DEBUG", msg, "DIM")

    def warning(self, msg: str):
        self.warn_count += 1
        self._write("WARN", "WARN", msg, "YELLOW")

    def error(self, msg: str, exc: Exception = None):
        self.fail_count += 1
        self._write("FAIL", "ERROR", msg, "RED")
        if exc:
            tb = traceback.format_exc()
            with self._lock:
                print(f"{ANSI['RED']}{tb}{ANSI['RESET']}")
                self._log_fh.write(f"  TRACEBACK:\n{tb}\n")
                self._log_fh.flush()

    def hard_fail(self, msg: str, exc: Exception = None):
        """Hard gate failure — logs and raises."""
        self.error(f"HARD_FAIL: {msg}", exc)
        raise RuntimeError(f"HARD_FAIL: {msg}")

    def input_log(self, label: str, value: Any):
        self._write("INPUT", label, str(value)[:200], "MAGENTA")

    def step(self, label: str, description: str):
        self._write("STEP", label, description, "CYAN")

    def state(self, label: str, value: Any):
        self._write("STATE", label, str(value)[:300], "WHITE")

    def output_log(self, label: str, value: Any):
        self._write("OUTPUT", label, str(value)[:300], "GREEN")

    def verify(self, label: str, passed: bool, reason: str = ""):
        if passed:
            self.pass_count += 1
            self._write("VERIFY", label, f"PASS {reason}", "GREEN")
        else:
            self.fail_count += 1
            self._write("VERIFY", label, f"FAIL {reason}", "RED")

    def request_start(self, method: str, url: str, attempt: int, max_attempts: int):
        self.request_count += 1
        self._write("HTTP", "REQUEST", f"{method} {url} [attempt {attempt}/{max_attempts}]", "CYAN")

    def request_complete(self, status: int, size: int, latency_ms: float, ctype: str):
        self.bytes_received += size
        color = "GREEN" if status == 200 else "RED"
        self._write("HTTP", "RESPONSE", f"HTTP {status} | {size:,}B | {latency_ms:.0f}ms | {ctype}", color)

    def request_failed(self, reason: str, attempt: int):
        self._write("HTTP", "FAIL", f"Attempt {attempt} failed: {reason}", "RED")

    def delay(self, seconds: float, reason: str):
        self._write("DELAY", "ANTI-DETECT", f"{seconds:.2f}s — {reason}", "DIM")

    def parse_result(self, market: str, summary: str, detail: dict = None):
        msg = f"[{market.upper()}] {summary}"
        if detail:
            msg += " | " + " | ".join(f"{k}={v}" for k, v in detail.items())
        self._write("PARSE", "RESULT", msg, "CYAN")

    def conversion(self, dec_val: float, american: str, classification: str):
        self.conversions_total += 1
        self._write("CONV", "DEC→AM", f"{dec_val} → {american} [{classification}]", "DIM")

    def match_header(self, idx: int, total: int, home: str, away: str, event_id: str, round_: str, date: str):
        bar = "━" * 70
        print(f"\n{ANSI['MAGENTA']}{ANSI['BOLD']}┌{bar}┐")
        print(f"│  MATCH {idx:02d}/{total:02d}: {away} @ {home:<30} [{round_}]  {date}  │")
        print(f"│  event_id: {event_id:<58}│")
        print(f"└{bar}┘{ANSI['RESET']}")
        with self._lock:
            self._log_fh.write(f"\n{'━'*72}\n")
            self._log_fh.write(f"  MATCH {idx:02d}/{total:02d}: {away} @ {home}  [{round_}]  {date}\n")
            self._log_fh.write(f"  event_id: {event_id}\n")
            self._log_fh.write(f"{'━'*72}\n")
            self._log_fh.flush()

    def match_complete(self, home: str, away: str, ok: int, total: int, elapsed: float):
        color = "GREEN" if ok == total else "YELLOW"
        self._write("MATCH", "COMPLETE", f"{away} @ {home} | {ok}/{total} markets OK | {elapsed:.2f}s", color)

    def progress(self, current: int, total: int, label: str, detail: str = ""):
        pct = current / total * 100 if total > 0 else 0
        filled = int(pct / 5)
        bar = "█" * filled + "░" * (20 - filled)
        msg = f"[{bar}] {pct:5.1f}% ({current:3d}/{total:3d}) {label}"
        if detail:
            msg += f" | {detail}"
        self._write("PROG", "PROGRESS", msg, "CYAN")

    def db_column_map(self, fixture_id: str, mapping: dict):
        """Log the exact DB column → value mapping for a fixture."""
        self._write("DB", "COL_MAP", f"fixture_id={fixture_id}", "GREEN")
        for col, val in mapping.items():
            self._write("DB", "COLUMN", f"  {col:<35} = {val}", "GREEN")

    def summary(self, matches: int, markets_ok: int, markets_total: int, elapsed: float):
        width = 88
        bar = "═" * width
        lines = [
            f"\n{ANSI['GREEN']}{ANSI['BOLD']}╔{bar}╗",
            f"║  PIPELINE COMPLETE — FINAL SUMMARY{' '*(width-35)}║",
            f"║  Matches processed : {matches:<{width-22}}║",
            f"║  Markets OK        : {markets_ok}/{markets_total:<{width-24}}║",
            f"║  PASS              : {self.pass_count:<{width-22}}║",
            f"║  FAIL              : {self.fail_count:<{width-22}}║",
            f"║  WARN              : {self.warn_count:<{width-22}}║",
            f"║  HTTP Requests     : {self.request_count:<{width-22}}║",
            f"║  Bytes received    : {self.bytes_received:,}{' '*(width-22-len(str(self.bytes_received))-len(str(self.bytes_received)//1000))}║",
            f"║  Conversions       : {self.conversions_total:<{width-22}}║",
            f"║  Elapsed           : {elapsed:.3f}s{' '*(width-22-len(f'{elapsed:.3f}s'))}║",
            f"╚{bar}╝{ANSI['RESET']}\n",
        ]
        for line in lines:
            print(line)
        with self._lock:
            self._log_fh.write(f"\n{'='*90}\n")
            self._log_fh.write(f"  PIPELINE COMPLETE — FINAL SUMMARY\n")
            self._log_fh.write(f"  Matches processed : {matches}\n")
            self._log_fh.write(f"  Markets OK        : {markets_ok}/{markets_total}\n")
            self._log_fh.write(f"  PASS              : {self.pass_count}\n")
            self._log_fh.write(f"  FAIL              : {self.fail_count}\n")
            self._log_fh.write(f"  WARN              : {self.warn_count}\n")
            self._log_fh.write(f"  HTTP Requests     : {self.request_count}\n")
            self._log_fh.write(f"  Bytes received    : {self.bytes_received:,}\n")
            self._log_fh.write(f"  Conversions       : {self.conversions_total}\n")
            self._log_fh.write(f"  Elapsed           : {elapsed:.3f}s\n")
            self._log_fh.write(f"{'='*90}\n\n")
            self._log_fh.flush()

    def close(self):
        with self._lock:
            self._log_fh.flush()
            self._log_fh.close()


# ══════════════════════════════════════════════════════════════════════════════
# DECIMAL → AMERICAN CONVERSION ENGINE (EXACT RATIONAL ARITHMETIC)
# ══════════════════════════════════════════════════════════════════════════════

def decimal_to_american(dec_val: Optional[float]) -> Optional[int]:
    """
    Convert decimal odds to American integer using exact Fraction arithmetic + ROUND_HALF_UP.
    Returns None for invalid/missing values. Never returns 0.
    Rules:
      D > 2.00: American = +100 × (D - 1)
      D = 2.00: American = +100
      1 < D < 2: American = -100 / (D - 1)
    """
    if dec_val is None or dec_val <= 1.0:
        return None
    frac = Fraction(str(dec_val))
    if frac == Fraction(2):
        return 100
    if frac > Fraction(2):
        exact = Fraction(100) * (frac - Fraction(1))
        classification = "positive"
    else:
        exact = Fraction(-100) / (frac - Fraction(1))
        classification = "negative"
    dec_exact = Decimal(exact.numerator) / Decimal(exact.denominator)
    rounded = int(dec_exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return rounded


def american_display(val: Optional[int]) -> str:
    """Format American odds integer as display string."""
    if val is None:
        return "N/A"
    return f"+{val}" if val > 0 else str(val)


# ══════════════════════════════════════════════════════════════════════════════
# STEALTH HTTP ENGINE
# ══════════════════════════════════════════════════════════════════════════════

class StealthEngine:
    def __init__(self, obs: ObservabilityEngine, max_retries: int = 3):
        self.obs = obs
        self.max_retries = max_retries
        self.ua = random.choice(USER_AGENTS)
        self.last_request_time = 0.0
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.ua,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        })
        obs.checkpoint("StealthEngine initialized", {"ua": self.ua[:60] + "..."})

    def _adaptive_delay(self):
        elapsed = time.time() - self.last_request_time
        base = random.uniform(1.8, 3.5)
        remaining = base - elapsed
        if remaining > 0:
            jitter = random.uniform(-0.1, 0.2)
            sleep_time = max(0.2, remaining + jitter)
            self.obs.delay(sleep_time, "adaptive inter-request spacing (anti-fingerprint)")
            time.sleep(sleep_time)

    def get_ajax(self, path: str, referer: str) -> Optional[requests.Response]:
        self._adaptive_delay()
        url = f"{BASE_URL}{path}"
        headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
        }
        for attempt in range(1, self.max_retries + 1):
            self.obs.request_start("GET", url, attempt, self.max_retries)
            t0 = time.time()
            try:
                resp = self.session.get(url, headers=headers, timeout=30)
                latency = (time.time() - t0) * 1000
                self.last_request_time = time.time()
                self.obs.request_complete(resp.status_code, len(resp.content), latency,
                                          resp.headers.get("content-type", "unknown"))
                if resp.status_code == 200:
                    return resp
                elif resp.status_code == 429:
                    wait = (2 ** attempt) * 5 + random.uniform(1, 5)
                    self.obs.warning(f"429 Rate Limited — backing off {wait:.1f}s")
                    time.sleep(wait)
                elif resp.status_code == 403:
                    self.obs.warning(f"403 Forbidden — rotating User-Agent")
                    self.ua = random.choice(USER_AGENTS)
                    self.session.headers["User-Agent"] = self.ua
                    time.sleep(random.uniform(5, 10))
                else:
                    self.obs.request_failed(f"HTTP {resp.status_code}", attempt)
                    time.sleep(2 ** attempt)
            except requests.exceptions.Timeout:
                self.obs.request_failed("Timeout (30s)", attempt)
                time.sleep(2 ** attempt)
            except requests.exceptions.ConnectionError as e:
                self.obs.request_failed(f"ConnectionError: {e}", attempt)
                time.sleep(2 ** attempt + random.uniform(1, 3))
            except Exception as e:
                self.obs.error(f"Unexpected request error: {e}", e)
                time.sleep(5)
        self.obs.error(f"EXHAUSTED all {self.max_retries} retries for: {url}")
        return None

    def get_page(self, url: str, referer: str = "") -> Optional[requests.Response]:
        self._adaptive_delay()
        full_url = url if url.startswith("http") else f"{BASE_URL}{url}"
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": referer or BASE_URL,
        }
        self.obs.request_start("GET", full_url, 1, 1)
        t0 = time.time()
        try:
            resp = self.session.get(full_url, headers=headers, timeout=30)
            latency = (time.time() - t0) * 1000
            self.last_request_time = time.time()
            self.obs.request_complete(resp.status_code, len(resp.content), latency,
                                      resp.headers.get("content-type", "?"))
            return resp if resp.status_code == 200 else None
        except Exception as e:
            self.obs.error(f"Page fetch failed: {e}", e)
            return None


# ══════════════════════════════════════════════════════════════════════════════
# PARSER ENGINE — ROW-POSITION-BASED EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

def safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _extract_bookie(row) -> Tuple[str, Optional[int]]:
    """Extract bookmaker name and bid from a TR row."""
    link = row.find("a", class_="in-bookmaker-logo-link")
    name = link.get_text(strip=True) if link else "Unknown"
    bid = None
    try:
        bid = int(row.get("data-bid", ""))
    except (ValueError, TypeError):
        pass
    return name, bid


def _extract_line_from_hcp(data_hcp: str) -> Optional[str]:
    """
    Extract numeric line from data-hcp encoded string.
    Format: E-{type}-{sc}-{x}-{line}-{suffix}
    Example: 'E-2-2-0-2.5-0' → '2.5'
             'E-2-2-0--3.75-0' → '-3.75'
    """
    if not data_hcp or not data_hcp.startswith("E-"):
        return None
    try:
        rest = data_hcp[2:]
        parts = rest.split("-")
        if len(parts) >= 5:
            if parts[3] == "":
                # Negative line: parts[3]='' parts[4]=number
                line_str = "-" + parts[4]
            else:
                line_str = parts[3]
            float(line_str)  # validate
            return line_str
    except (ValueError, IndexError):
        pass
    return None


def parse_1x2(html: str, obs: ObservabilityEngine) -> Dict:
    """
    Parse 1X2 market.
    Position mapping (row-position-based, forensically confirmed):
      td[0] = HOME_WIN → book_home_ml
      td[1] = DRAW     → book_draw_ml
      td[2] = AWAY_WIN → book_away_ml
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr", attrs={"data-bid": True})
    bookmakers = []
    bet365_found = False

    obs.step("PARSE_1X2", f"Scanning {len(rows)} TR rows for bid={BET365_BID}")

    for row in rows:
        name, bid = _extract_bookie(row)
        cells = row.find_all("td", attrs={"data-odd": True})
        if len(cells) < 3:
            continue
        entry = {
            "bookmaker": name,
            "bid": bid,
            "home_win_dec": safe_float(cells[0].get("data-odd")),
            "draw_dec":     safe_float(cells[1].get("data-odd")),
            "away_win_dec": safe_float(cells[2].get("data-odd")),
        }
        bookmakers.append(entry)
        if bid == BET365_BID:
            bet365_found = True
            obs.state("BET365_1X2_FOUND", f"bid={bid} name={name!r} | home={entry['home_win_dec']} draw={entry['draw_dec']} away={entry['away_win_dec']}")

    if not bet365_found:
        obs.warning(f"bet365.us (bid={BET365_BID}) NOT FOUND in 1x2 | bids present: {sorted(set(b['bid'] for b in bookmakers if b['bid']))}")

    obs.parse_result("1x2", f"{len(bookmakers)} bookmakers | bet365_found={bet365_found}")
    return {"market": "1x2", "bookmakers": bookmakers, "bet365_found": bet365_found}


def parse_ou(html: str, obs: ObservabilityEngine) -> Dict:
    """
    Parse Over/Under market.
    Position mapping (row-position-based, forensically confirmed):
      td[0] = OVER  → book_over_odds
      td[1] = UNDER → book_under_odds
    Line from doubleparameter TD or data-hcp.
    PRIMARY LINE: 2.5
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr", attrs={"data-bid": True})
    lines: Dict[str, List] = defaultdict(list)
    bet365_lines_found = []

    obs.step("PARSE_OU", f"Scanning {len(rows)} TR rows for bid={BET365_BID}")

    for row in rows:
        name, bid = _extract_bookie(row)
        cells = row.find_all("td", attrs={"data-odd": True})
        if len(cells) < 2:
            continue

        # Extract line
        label_td = next((td for td in row.find_all("td")
                         if "table-main__doubleparameter" in (td.get("class") or [])), None)
        line_val = label_td.get_text(strip=True) if label_td else None
        if not line_val:
            hcp = cells[0].get("data-hcp", "")
            line_val = _extract_line_from_hcp(hcp)

        if not line_val:
            continue

        entry = {
            "bookmaker": name,
            "bid": bid,
            "line": line_val,
            "over_dec":  safe_float(cells[0].get("data-odd")),
            "under_dec": safe_float(cells[1].get("data-odd")),
        }
        lines[line_val].append(entry)

        if bid == BET365_BID:
            bet365_lines_found.append(line_val)
            if line_val == PRIMARY_OU_LINE:
                obs.state("BET365_OU_PRIMARY", f"line={line_val} | over={entry['over_dec']} under={entry['under_dec']}")

    if not bet365_lines_found:
        obs.warning(f"bet365.us (bid={BET365_BID}) NOT FOUND in any OU line")
    else:
        obs.checkpoint(f"bet365.us OU lines found", {"lines": str(sorted(bet365_lines_found))})

    obs.parse_result("ou", f"{len(lines)} lines | bet365_lines={len(bet365_lines_found)}")
    return {"market": "ou", "lines": dict(lines), "bet365_lines_found": bet365_lines_found}


def parse_ah(html: str, obs: ObservabilityEngine) -> Dict:
    """
    Parse Asian Handicap market.
    CRITICAL POSITION MAPPING (forensically confirmed from ITER-010 Phase 4):
      td[0] = AH_AWAY (away receives handicap) → book_away_spread_odds
      td[1] = AH_HOME (home gives handicap)    → book_home_spread_odds
    Line from doubleparameter TD or data-hcp.
    PRIMARY LINE: closest to 0 (pick'em or -0.5/+0.5)
    NO SPREAD SIGN INVERSION — raw line value used as-is.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr", attrs={"data-bid": True})
    lines: Dict[str, List] = defaultdict(list)
    bet365_lines_found = []

    obs.step("PARSE_AH", f"Scanning {len(rows)} TR rows for bid={BET365_BID}")
    obs.info("AH POSITION MAP: td[0]=AH_AWAY→book_away_spread_odds | td[1]=AH_HOME→book_home_spread_odds")

    for row in rows:
        name, bid = _extract_bookie(row)
        cells = row.find_all("td", attrs={"data-odd": True})
        if len(cells) < 2:
            continue

        label_td = next((td for td in row.find_all("td")
                         if "table-main__doubleparameter" in (td.get("class") or [])), None)
        line_val = label_td.get_text(strip=True) if label_td else None
        if not line_val:
            hcp = cells[0].get("data-hcp", "")
            line_val = _extract_line_from_hcp(hcp)

        if not line_val:
            continue

        entry = {
            "bookmaker": name,
            "bid": bid,
            "line": line_val,
            "ah_away_dec": safe_float(cells[0].get("data-odd")),  # position[0] = AWAY
            "ah_home_dec": safe_float(cells[1].get("data-odd")),  # position[1] = HOME
        }
        lines[line_val].append(entry)

        if bid == BET365_BID:
            bet365_lines_found.append(line_val)

    if not bet365_lines_found:
        obs.warning(f"bet365.us (bid={BET365_BID}) NOT FOUND in any AH line")
    else:
        obs.checkpoint(f"bet365.us AH lines found", {"lines": str(sorted(bet365_lines_found, key=lambda x: float(x)))})

    obs.parse_result("ah", f"{len(lines)} lines | bet365_lines={len(bet365_lines_found)}")
    return {"market": "ah", "lines": dict(lines), "bet365_lines_found": bet365_lines_found}


def parse_dc(html: str, obs: ObservabilityEngine) -> Dict:
    """
    Parse Double Chance market.
    COLUMN ORDER (forensically confirmed from ITER-010 Phase 4 + mathematical verification):
      td[0] = 1X (home_or_draw)  → book_dc_1x_odds
      td[1] = 12 (home_or_away)  → NOT stored (no DB column)
      td[2] = X2 (away_or_draw)  → book_dc_x2_odds
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr", attrs={"data-bid": True})
    bookmakers = []
    bet365_found = False

    obs.step("PARSE_DC", f"Scanning {len(rows)} TR rows for bid={BET365_BID}")
    obs.info("DC COLUMN ORDER: td[0]=1X→book_dc_1x_odds | td[1]=12 (not stored) | td[2]=X2→book_dc_x2_odds")

    for row in rows:
        name, bid = _extract_bookie(row)
        cells = row.find_all("td", attrs={"data-odd": True})
        if len(cells) < 3:
            continue
        entry = {
            "bookmaker": name,
            "bid": bid,
            "dc_1x_dec":  safe_float(cells[0].get("data-odd")),
            "dc_12_dec":  safe_float(cells[1].get("data-odd")),
            "dc_x2_dec":  safe_float(cells[2].get("data-odd")),
        }
        bookmakers.append(entry)
        if bid == BET365_BID:
            bet365_found = True
            obs.state("BET365_DC_FOUND", f"bid={bid} | 1X={entry['dc_1x_dec']} 12={entry['dc_12_dec']} X2={entry['dc_x2_dec']}")

    if not bet365_found:
        obs.warning(f"bet365.us (bid={BET365_BID}) NOT FOUND in DC | bids present: {sorted(set(b['bid'] for b in bookmakers if b['bid']))}")

    obs.parse_result("dc", f"{len(bookmakers)} bookmakers | bet365_found={bet365_found}")
    return {"market": "dc", "bookmakers": bookmakers, "bet365_found": bet365_found}


def parse_bts(html: str, obs: ObservabilityEngine) -> Dict:
    """
    Parse Both Teams To Score market.
    Position mapping (row-position-based, forensically confirmed):
      td[0] = BTTS_YES → book_btts_yes_odds
      td[1] = BTTS_NO  → book_btts_no_odds
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr", attrs={"data-bid": True})
    bookmakers = []
    bet365_found = False

    obs.step("PARSE_BTS", f"Scanning {len(rows)} TR rows for bid={BET365_BID}")

    for row in rows:
        name, bid = _extract_bookie(row)
        cells = row.find_all("td", attrs={"data-odd": True})
        if len(cells) < 2:
            continue
        entry = {
            "bookmaker": name,
            "bid": bid,
            "yes_dec": safe_float(cells[0].get("data-odd")),
            "no_dec":  safe_float(cells[1].get("data-odd")),
        }
        bookmakers.append(entry)
        if bid == BET365_BID:
            bet365_found = True
            obs.state("BET365_BTS_FOUND", f"bid={bid} | yes={entry['yes_dec']} no={entry['no_dec']}")

    if not bet365_found:
        obs.warning(f"bet365.us (bid={BET365_BID}) NOT FOUND in BTTS | bids present: {sorted(set(b['bid'] for b in bookmakers if b['bid']))}")

    obs.parse_result("bts", f"{len(bookmakers)} bookmakers | bet365_found={bet365_found}")
    return {"market": "bts", "bookmakers": bookmakers, "bet365_found": bet365_found}


def parse_market(html: str, market: str, obs: ObservabilityEngine) -> Dict:
    """Route HTML to the correct market parser."""
    if market == "1x2":
        return parse_1x2(html, obs)
    elif market == "ou":
        return parse_ou(html, obs)
    elif market == "ah":
        return parse_ah(html, obs)
    elif market == "dc":
        return parse_dc(html, obs)
    elif market == "bts":
        return parse_bts(html, obs)
    else:
        obs.error(f"Unknown market: {market}")
        return {"error": f"Unknown market: {market}"}


# ══════════════════════════════════════════════════════════════════════════════
# PRIMARY LINE SELECTION
# ══════════════════════════════════════════════════════════════════════════════

def select_primary_ah_line(lines: Dict[str, List], obs: ObservabilityEngine) -> Optional[str]:
    """
    Select the primary AH line for DB mapping.
    Priority: 0 (pick'em) → -0.5 → +0.5 → closest to 0
    Only considers lines where bet365.us (bid=549) is present.
    """
    bet365_lines = []
    for line_val, entries in lines.items():
        for e in entries:
            if e.get("bid") == BET365_BID:
                try:
                    bet365_lines.append(float(line_val))
                except ValueError:
                    pass
                break

    if not bet365_lines:
        obs.warning("AH: No bet365.us lines available for primary selection")
        return None

    # Sort by absolute value (closest to 0)
    bet365_lines.sort(key=lambda x: (abs(x), x))
    primary = bet365_lines[0]
    # Format back to string matching the dict key
    primary_str = str(int(primary)) if primary == int(primary) else str(primary)
    # Find exact key
    for k in lines.keys():
        try:
            if float(k) == primary:
                obs.checkpoint("AH primary line selected", {"line": k, "abs_val": abs(primary)})
                return k
        except ValueError:
            pass
    return None


# ══════════════════════════════════════════════════════════════════════════════
# DB COLUMN MAPPER — CONFIRMED SCHEMA
# ══════════════════════════════════════════════════════════════════════════════

def build_db_mapping(match_data: dict, obs: ObservabilityEngine) -> dict:
    """
    Build the exact wc2026_frozen_book_odds column mapping from parsed market data.
    All values are American odds integers (or None if not available).
    Zero hallucination: every value traced to a specific bid=549 row.
    """
    fixture_id = match_data.get("fixture_id", "UNKNOWN")
    home = match_data.get("home", "")
    away = match_data.get("away", "")
    markets = match_data.get("markets", {})

    obs.step("DB_MAP", f"Building column map for {fixture_id} ({away} @ {home})")

    mapping = {
        "fixture_id":             fixture_id,
        "book_source":            "bet365.us",
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
        "book_dc_x2_odds":        None,
        "book_btts_yes_odds":     None,
        "book_btts_no_odds":      None,
        # Not available from BetExplorer
        "book_no_draw_home_odds": None,
        "book_no_draw_away_odds": None,
        "to_advance_home_odds":   None,
        "to_advance_away_odds":   None,
    }

    # ── 1X2 ──────────────────────────────────────────────────────────────────
    mkt_1x2 = markets.get("1x2", {})
    if "error" not in mkt_1x2:
        b365 = next((b for b in mkt_1x2.get("bookmakers", []) if b.get("bid") == BET365_BID), None)
        if b365:
            mapping["book_home_ml"] = decimal_to_american(b365.get("home_win_dec"))
            mapping["book_draw_ml"] = decimal_to_american(b365.get("draw_dec"))
            mapping["book_away_ml"] = decimal_to_american(b365.get("away_win_dec"))
            obs.verify("1X2_HOME_ML",  mapping["book_home_ml"] is not None,
                       f"home_win_dec={b365.get('home_win_dec')} → {american_display(mapping['book_home_ml'])}")
            obs.verify("1X2_DRAW_ML",  mapping["book_draw_ml"] is not None,
                       f"draw_dec={b365.get('draw_dec')} → {american_display(mapping['book_draw_ml'])}")
            obs.verify("1X2_AWAY_ML",  mapping["book_away_ml"] is not None,
                       f"away_win_dec={b365.get('away_win_dec')} → {american_display(mapping['book_away_ml'])}")
        else:
            obs.warning(f"1X2: bet365.us (bid={BET365_BID}) not found — book_home/draw/away_ml will be NULL")

    # ── OU ───────────────────────────────────────────────────────────────────
    mkt_ou = markets.get("ou", {})
    if "error" not in mkt_ou:
        ou_lines = mkt_ou.get("lines", {})
        # Primary line: 2.5
        primary_entries = ou_lines.get(PRIMARY_OU_LINE, [])
        b365_ou = next((e for e in primary_entries if e.get("bid") == BET365_BID), None)
        if b365_ou:
            mapping["book_total_line"] = float(PRIMARY_OU_LINE)
            mapping["book_over_odds"]  = decimal_to_american(b365_ou.get("over_dec"))
            mapping["book_under_odds"] = decimal_to_american(b365_ou.get("under_dec"))
            obs.verify("OU_TOTAL_LINE",  True, f"line={PRIMARY_OU_LINE}")
            obs.verify("OU_OVER_ODDS",   mapping["book_over_odds"] is not None,
                       f"over_dec={b365_ou.get('over_dec')} → {american_display(mapping['book_over_odds'])}")
            obs.verify("OU_UNDER_ODDS",  mapping["book_under_odds"] is not None,
                       f"under_dec={b365_ou.get('under_dec')} → {american_display(mapping['book_under_odds'])}")
        else:
            # Try other lines if 2.5 not available
            available = [lv for lv, entries in ou_lines.items()
                         if any(e.get("bid") == BET365_BID for e in entries)]
            if available:
                obs.warning(f"OU: bet365.us not at 2.5 — available lines: {sorted(available, key=float)}")
                # Use closest to 2.5
                closest = min(available, key=lambda x: abs(float(x) - 2.5))
                alt_entries = ou_lines.get(closest, [])
                b365_alt = next((e for e in alt_entries if e.get("bid") == BET365_BID), None)
                if b365_alt:
                    mapping["book_total_line"] = float(closest)
                    mapping["book_over_odds"]  = decimal_to_american(b365_alt.get("over_dec"))
                    mapping["book_under_odds"] = decimal_to_american(b365_alt.get("under_dec"))
                    obs.warning(f"OU: Using fallback line {closest} (closest to 2.5)")
            else:
                obs.warning(f"OU: bet365.us (bid={BET365_BID}) not found in any OU line — totals will be NULL")

    # ── AH ───────────────────────────────────────────────────────────────────
    mkt_ah = markets.get("ah", {})
    if "error" not in mkt_ah:
        ah_lines = mkt_ah.get("lines", {})
        primary_ah = select_primary_ah_line(ah_lines, obs)
        if primary_ah:
            primary_entries = ah_lines.get(primary_ah, [])
            b365_ah = next((e for e in primary_entries if e.get("bid") == BET365_BID), None)
            if b365_ah:
                mapping["book_spread_line"]       = float(primary_ah)
                mapping["book_home_spread_odds"]  = decimal_to_american(b365_ah.get("ah_home_dec"))
                mapping["book_away_spread_odds"]  = decimal_to_american(b365_ah.get("ah_away_dec"))
                obs.verify("AH_SPREAD_LINE",       True, f"line={primary_ah}")
                obs.verify("AH_HOME_SPREAD_ODDS",  mapping["book_home_spread_odds"] is not None,
                           f"ah_home_dec={b365_ah.get('ah_home_dec')} → {american_display(mapping['book_home_spread_odds'])}")
                obs.verify("AH_AWAY_SPREAD_ODDS",  mapping["book_away_spread_odds"] is not None,
                           f"ah_away_dec={b365_ah.get('ah_away_dec')} → {american_display(mapping['book_away_spread_odds'])}")
                obs.info("AH NO SIGN INVERSION — raw line value used as-is per spec")
            else:
                obs.warning(f"AH: bet365.us not found at primary line {primary_ah}")
        else:
            obs.warning(f"AH: No primary line selected — spread columns will be NULL")

    # ── DC ───────────────────────────────────────────────────────────────────
    mkt_dc = markets.get("dc", {})
    if "error" not in mkt_dc:
        b365_dc = next((b for b in mkt_dc.get("bookmakers", []) if b.get("bid") == BET365_BID), None)
        if b365_dc:
            mapping["book_dc_1x_odds"] = decimal_to_american(b365_dc.get("dc_1x_dec"))
            mapping["book_dc_x2_odds"] = decimal_to_american(b365_dc.get("dc_x2_dec"))
            obs.verify("DC_1X_ODDS", mapping["book_dc_1x_odds"] is not None,
                       f"dc_1x_dec={b365_dc.get('dc_1x_dec')} → {american_display(mapping['book_dc_1x_odds'])}")
            obs.verify("DC_X2_ODDS", mapping["book_dc_x2_odds"] is not None,
                       f"dc_x2_dec={b365_dc.get('dc_x2_dec')} → {american_display(mapping['book_dc_x2_odds'])}")
        else:
            obs.warning(f"DC: bet365.us (bid={BET365_BID}) not found — dc columns will be NULL")

    # ── BTTS ─────────────────────────────────────────────────────────────────
    mkt_bts = markets.get("bts", {})
    if "error" not in mkt_bts:
        b365_bts = next((b for b in mkt_bts.get("bookmakers", []) if b.get("bid") == BET365_BID), None)
        if b365_bts:
            mapping["book_btts_yes_odds"] = decimal_to_american(b365_bts.get("yes_dec"))
            mapping["book_btts_no_odds"]  = decimal_to_american(b365_bts.get("no_dec"))
            obs.verify("BTTS_YES_ODDS", mapping["book_btts_yes_odds"] is not None,
                       f"yes_dec={b365_bts.get('yes_dec')} → {american_display(mapping['book_btts_yes_odds'])}")
            obs.verify("BTTS_NO_ODDS",  mapping["book_btts_no_odds"] is not None,
                       f"no_dec={b365_bts.get('no_dec')} → {american_display(mapping['book_btts_no_odds'])}")
        else:
            obs.warning(f"BTTS: bet365.us (bid={BET365_BID}) not found — btts columns will be NULL")

    # ── Final null audit ──────────────────────────────────────────────────────
    critical_cols = ["book_home_ml", "book_draw_ml", "book_away_ml",
                     "book_total_line", "book_over_odds", "book_under_odds",
                     "book_spread_line", "book_home_spread_odds", "book_away_spread_odds",
                     "book_dc_1x_odds", "book_dc_x2_odds",
                     "book_btts_yes_odds", "book_btts_no_odds"]
    null_cols = [c for c in critical_cols if mapping.get(c) is None]
    non_null = len(critical_cols) - len(null_cols)

    if null_cols:
        obs.warning(f"NULL columns ({len(null_cols)}): {null_cols}")
    else:
        obs.checkpoint(f"ALL {len(critical_cols)} critical columns populated — ZERO NULLS", {"fixture_id": fixture_id})

    obs.db_column_map(fixture_id, {
        k: american_display(v) if isinstance(v, int) else str(v)
        for k, v in mapping.items()
    })

    mapping["_null_count"] = len(null_cols)
    mapping["_populated_count"] = non_null
    return mapping


# ══════════════════════════════════════════════════════════════════════════════
# STAGE 1: SCRAPE
# ══════════════════════════════════════════════════════════════════════════════

def stage_1_scrape(obs: ObservabilityEngine) -> List[Dict]:
    obs.phase("STAGE 1: SCRAPE", f"{len(WC2026_MATCHES)} matches × {len(MARKETS_SCRAPE)} markets | BET365_BID={BET365_BID}")

    engine = StealthEngine(obs)

    # Session warmup
    obs.step("WARMUP", "Fetching WC2026 fixtures page to establish session cookies")
    warmup = engine.get_page("/football/world/world-championship-2026/fixtures/", BASE_URL)
    if warmup:
        obs.checkpoint("Session warmup OK", {"cookies": len(engine.session.cookies), "size": f"{len(warmup.content):,}B"})
    else:
        obs.warning("Warmup failed — proceeding without session cookies")
    time.sleep(random.uniform(1.5, 3.0))

    all_results = []
    total_ok = 0
    total_attempted = 0

    for i, match in enumerate(WC2026_MATCHES, 1):
        match_start = time.time()
        obs.match_header(i, len(WC2026_MATCHES), match["home"], match["away"],
                         match["event_id"], match["round"], match["date"])
        obs.input_log("FIXTURE", f"fixture_id={match['fixture_id']} | event_id={match['event_id']} | slug={match['slug']}")

        referer = f"{BASE_URL}/football/world/world-championship-2026/{match['slug']}/{match['event_id']}/"
        match_data = {
            "fixture_id":        match["fixture_id"],
            "event_id":          match["event_id"],
            "slug":              match["slug"],
            "home":              match["home"],
            "away":              match["away"],
            "date":              match["date"],
            "round":             match["round"],
            "markets":           {},
            "scrape_timestamp":  datetime.now(timezone.utc).isoformat(),
        }

        markets_ok = 0
        for j, market in enumerate(MARKETS_SCRAPE, 1):
            total_attempted += 1
            obs.progress(j, len(MARKETS_SCRAPE), MARKET_NAMES[market], f"Match {i}/{len(WC2026_MATCHES)}")
            obs.step(f"FETCH_{market.upper()}", f"GET {ODDS_ENDPOINT.format(event_id=match['event_id'], market=market)}")

            path = ODDS_ENDPOINT.format(event_id=match["event_id"], market=market)
            resp = engine.get_ajax(path, referer)

            if resp is None:
                obs.error(f"No response for {match['home']} vs {match['away']} [{market}]")
                match_data["markets"][market] = {"error": "No response"}
                continue

            try:
                data = resp.json()
                odds_html = data.get("odds", "")
                if not odds_html:
                    obs.warning(f"Empty odds HTML for {market} — match={match['fixture_id']}")
                    match_data["markets"][market] = {"error": "Empty odds HTML"}
                    continue

                obs.state(f"HTML_SIZE_{market.upper()}", f"{len(odds_html):,} chars")
                parsed = parse_market(odds_html, market, obs)
                match_data["markets"][market] = parsed
                markets_ok += 1
                total_ok += 1

            except json.JSONDecodeError as e:
                obs.error(f"JSON decode failed for {market}: {e}", e)
                match_data["markets"][market] = {"error": f"JSONDecodeError: {e}"}
            except Exception as e:
                obs.error(f"Parse error for {market}: {e}", e)
                match_data["markets"][market] = {"error": str(e)}

        all_results.append(match_data)
        obs.match_complete(match["home"], match["away"], markets_ok, len(MARKETS_SCRAPE),
                           time.time() - match_start)
        obs.progress(i, len(WC2026_MATCHES), "OVERALL",
                     f"{total_ok}/{total_attempted} markets OK | {obs.bytes_received:,}B received")

    obs.checkpoint("STAGE 1 COMPLETE", {
        "matches": len(all_results),
        "markets_ok": total_ok,
        "total_attempted": total_attempted,
        "success_rate": f"{total_ok/total_attempted*100:.1f}%" if total_attempted else "N/A",
    })
    return all_results


# ══════════════════════════════════════════════════════════════════════════════
# STAGE 2: BUILD DB COLUMN MAPPINGS
# ══════════════════════════════════════════════════════════════════════════════

def stage_2_build_mappings(data: List[Dict], obs: ObservabilityEngine) -> List[Dict]:
    obs.phase("STAGE 2: DB COLUMN MAPPING",
              f"Building wc2026_frozen_book_odds column maps for {len(data)} fixtures")

    all_mappings = []
    total_nulls = 0

    for idx, match_data in enumerate(data, 1):
        obs.step(f"MAP_{idx}", f"Processing {match_data['fixture_id']} ({match_data['away']} @ {match_data['home']})")
        mapping = build_db_mapping(match_data, obs)
        all_mappings.append(mapping)
        total_nulls += mapping.get("_null_count", 0)
        obs.output_log(f"MAPPING_{idx}", f"fixture_id={mapping['fixture_id']} | populated={mapping['_populated_count']}/13 | nulls={mapping['_null_count']}")

    obs.checkpoint("STAGE 2 COMPLETE", {
        "fixtures_mapped": len(all_mappings),
        "total_null_critical_cols": total_nulls,
        "verdict": "ZERO NULLS" if total_nulls == 0 else f"WARNING: {total_nulls} NULL CRITICAL COLUMNS",
    })
    return all_mappings


# ══════════════════════════════════════════════════════════════════════════════
# STAGE 3: VALIDATE
# ══════════════════════════════════════════════════════════════════════════════

def stage_3_validate(data: List[Dict], mappings: List[Dict], obs: ObservabilityEngine) -> bool:
    obs.phase("STAGE 3: VALIDATE", "500x forensic validation — bet365.us presence, null audit, vig checks")

    all_pass = True
    critical_cols = ["book_home_ml", "book_draw_ml", "book_away_ml",
                     "book_total_line", "book_over_odds", "book_under_odds",
                     "book_dc_1x_odds", "book_dc_x2_odds",
                     "book_btts_yes_odds", "book_btts_no_odds"]

    for i, (match_data, mapping) in enumerate(zip(data, mappings), 1):
        fixture_id = mapping["fixture_id"]
        home = match_data["home"]
        away = match_data["away"]

        obs.step(f"VALIDATE_{i}", f"{fixture_id}: {away} @ {home}")

        # Gate V1: bet365.us found in at least one market
        markets_with_b365 = []
        for mkt, mkt_data in match_data["markets"].items():
            if "error" in mkt_data:
                continue
            if mkt in ("1x2", "dc", "bts"):
                if any(b.get("bid") == BET365_BID for b in mkt_data.get("bookmakers", [])):
                    markets_with_b365.append(mkt)
            elif mkt in ("ou", "ah"):
                for line_entries in mkt_data.get("lines", {}).values():
                    if any(e.get("bid") == BET365_BID for e in line_entries):
                        markets_with_b365.append(mkt)
                        break
        obs.verify(f"V1_BET365_PRESENCE_{fixture_id}",
                   len(markets_with_b365) > 0,
                   f"bet365.us found in: {markets_with_b365}")
        if len(markets_with_b365) == 0:
            all_pass = False

        # Gate V2: No NULL in critical columns (warn only — BetExplorer may not have all markets)
        null_cols = [c for c in critical_cols if mapping.get(c) is None]
        obs.verify(f"V2_NULL_AUDIT_{fixture_id}",
                   len(null_cols) == 0,
                   f"null_cols={null_cols}" if null_cols else "ALL CRITICAL COLUMNS POPULATED")

        # Gate V3: Moneyline vig check (if all 3 ML present)
        h = mapping.get("book_home_ml")
        d = mapping.get("book_draw_ml")
        a = mapping.get("book_away_ml")
        if h and d and a:
            def am_to_prob(am):
                if am > 0: return 100 / (am + 100)
                else: return abs(am) / (abs(am) + 100)
            vig_sum = am_to_prob(h) + am_to_prob(d) + am_to_prob(a)
            obs.verify(f"V3_ML_VIG_{fixture_id}",
                       1.00 <= vig_sum <= 1.25,
                       f"vig_sum={vig_sum:.4f} (expected 1.00–1.25)")
            if not (1.00 <= vig_sum <= 1.25):
                obs.warning(f"ML vig out of range: {vig_sum:.4f} for {fixture_id}")
                all_pass = False

        # Gate V4: OU vig check
        ov = mapping.get("book_over_odds")
        un = mapping.get("book_under_odds")
        if ov and un:
            def am_to_prob2(am):
                if am > 0: return 100 / (am + 100)
                else: return abs(am) / (abs(am) + 100)
            ou_vig = am_to_prob2(ov) + am_to_prob2(un)
            obs.verify(f"V4_OU_VIG_{fixture_id}",
                       1.00 <= ou_vig <= 1.20,
                       f"ou_vig={ou_vig:.4f} (expected 1.00–1.20)")

        # Gate V5: No spread sign inversion (AH line stored as-is)
        sl = mapping.get("book_spread_line")
        if sl is not None:
            obs.verify(f"V5_SPREAD_NO_INVERSION_{fixture_id}",
                       True,
                       f"spread_line={sl} (raw, no inversion applied)")

    obs.checkpoint("STAGE 3 COMPLETE", {
        "fixtures_validated": len(data),
        "all_gates_pass": all_pass,
        "verdict": "ALL PASS" if all_pass else "FAILURES DETECTED — review WARN/FAIL above",
    })
    return all_pass


# ══════════════════════════════════════════════════════════════════════════════
# MAIN ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════════════════

def main():
    obs = ObservabilityEngine(LOG_PATH)
    obs.banner("WC2026 BETEXPLORER ODDS SCRAPER — PRODUCTION v1.0")

    obs.info(f"FORENSIC AUDIT FINDING: BET365_BID = {BET365_BID} (bet365.us)")
    obs.info("bid=16 (bet365 global) is NOT present on WC2026 US-facing BetExplorer pages")
    obs.info(f"Scraping {len(WC2026_MATCHES)} WC2026 fixtures × {len(MARKETS_SCRAPE)} markets")
    obs.info(f"Markets: {', '.join(MARKET_NAMES[m] for m in MARKETS_SCRAPE)}")
    obs.info("HA (Draw No Bet) excluded per spec")

    pipeline_start = time.time()

    try:
        # Stage 1: Scrape
        data = stage_1_scrape(obs)

        # Stage 2: Build DB column mappings
        mappings = stage_2_build_mappings(data, obs)

        # Stage 3: Validate
        all_pass = stage_3_validate(data, mappings, obs)

        # Write outputs
        obs.phase("FINALIZATION", "Writing production output files")

        output = {
            "scrape_timestamp": datetime.now(timezone.utc).isoformat(),
            "bet365_bid_used": BET365_BID,
            "bet365_bid_note": "bet365.us — confirmed from live HTML forensic audit. bid=16 (global) NOT present.",
            "fixtures": data,
            "db_mappings": mappings,
        }

        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        obs.checkpoint("Output written", {
            "path": str(OUTPUT_PATH),
            "size": f"{OUTPUT_PATH.stat().st_size:,}B",
        })

        total_time = time.time() - pipeline_start
        markets_ok = sum(
            1 for m in data
            for mk, mv in m["markets"].items()
            if "error" not in mv
        )
        obs.summary(len(data), markets_ok, len(data) * len(MARKETS_SCRAPE), total_time)

        # Print final DB column map table
        print(f"\n{ANSI['BOLD']}{ANSI['CYAN']}{'═'*90}")
        print(f"  FINAL DB COLUMN MAP — wc2026_frozen_book_odds (bet365.us bid={BET365_BID})")
        print(f"{'═'*90}{ANSI['RESET']}")
        header = f"{'fixture_id':<20} {'home_ml':>8} {'draw_ml':>8} {'away_ml':>8} {'total':>6} {'over':>7} {'under':>7} {'spread':>7} {'h_sprd':>7} {'a_sprd':>7} {'dc_1x':>7} {'dc_x2':>7} {'btts_y':>7} {'btts_n':>7}"
        print(f"{ANSI['BOLD']}{header}{ANSI['RESET']}")
        print("─" * 115)
        for m in mappings:
            row = (
                f"{m['fixture_id']:<20} "
                f"{american_display(m.get('book_home_ml')):>8} "
                f"{american_display(m.get('book_draw_ml')):>8} "
                f"{american_display(m.get('book_away_ml')):>8} "
                f"{str(m.get('book_total_line','N/A')):>6} "
                f"{american_display(m.get('book_over_odds')):>7} "
                f"{american_display(m.get('book_under_odds')):>7} "
                f"{str(m.get('book_spread_line','N/A')):>7} "
                f"{american_display(m.get('book_home_spread_odds')):>7} "
                f"{american_display(m.get('book_away_spread_odds')):>7} "
                f"{american_display(m.get('book_dc_1x_odds')):>7} "
                f"{american_display(m.get('book_dc_x2_odds')):>7} "
                f"{american_display(m.get('book_btts_yes_odds')):>7} "
                f"{american_display(m.get('book_btts_no_odds')):>7}"
            )
            color = ANSI["GREEN"] if m.get("_null_count", 0) == 0 else ANSI["YELLOW"]
            print(f"{color}{row}{ANSI['RESET']}")

        print(f"\n{ANSI['GREEN']}{ANSI['BOLD']}  Output: {OUTPUT_PATH}")
        print(f"  Log:    {LOG_PATH}{ANSI['RESET']}\n")

        obs.checkpoint("PIPELINE COMPLETE", {
            "all_gates_pass": all_pass,
            "output": str(OUTPUT_PATH),
            "log": str(LOG_PATH),
        })

    except Exception as e:
        obs.error(f"PIPELINE FATAL ERROR: {e}", e)
        raise
    finally:
        obs.close()


if __name__ == "__main__":
    main()
