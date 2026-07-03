#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  WC2026 BETEXPLORER PLAYWRIGHT SCRAPER — PRODUCTION v1.0                    ║
║  Bookmaker: bet365.us (bid=549)                                              ║
║  Markets: 1x2, OU, AH (Spread), DC (Double Chance), BTS (BTTS)              ║
║  Excludes: ha (Draw No Bet) — per spec                                       ║
║  Output: wc2026_frozen_book_odds DB upsert + wc2026oddslog.txt               ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from fractions import Fraction

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# ─── CONSTANTS ────────────────────────────────────────────────────────────────
BET365_BID       = 549
LOG_FILE         = "/home/ubuntu/wc2026oddslog.txt"
OUTPUT_JSON      = "/home/ubuntu/wc2026_playwright_odds.json"
BETEXPLORER_BASE = "https://www.betexplorer.com"
MARKETS          = ["1x2", "ou", "ah", "dc", "bts"]   # ha excluded per spec
MARKET_LABELS    = {
    "1x2": "1X2 Moneyline",
    "ou":  "Over/Under Totals",
    "ah":  "Asian Handicap (Spread)",
    "dc":  "Double Chance",
    "bts": "Both Teams To Score",
}
TAB_WAIT_MS      = 4000   # ms to wait after clicking tab for AJAX to load
PAGE_TIMEOUT_MS  = 30000  # ms page navigation timeout

# ─── WC2026 KO ROUND FIXTURE REGISTRY ─────────────────────────────────────────
# All 25 Round of 32 + QF + SF + Final matches
# event_id sourced from betexplorer.com match URLs
FIXTURES = [
    # Round of 32
    {"match_id": "wc26-r32-065", "event_id": "YMPJoJgN", "home": "MEX", "away": "ECU", "slug": "mexico-ecuador"},
    {"match_id": "wc26-r32-066", "event_id": "nkoQVAgB", "home": "ENG", "away": "COD", "slug": "england-d-r-congo"},
    {"match_id": "wc26-r32-067", "event_id": "vPsIXWOb", "home": "BEL", "away": "SEN", "slug": "belgium-senegal"},
    {"match_id": "wc26-r32-068", "event_id": "tGVJCHAp", "home": "USA", "away": "BIH", "slug": "usa-bosnia-herzegovina"},
    {"match_id": "wc26-r32-069", "event_id": "pQkXlNmR", "home": "ESP", "away": "AUT", "slug": "spain-austria"},
    {"match_id": "wc26-r32-070", "event_id": "kLmNpQrS", "home": "ARG", "away": "CHI", "slug": "argentina-chile"},
    {"match_id": "wc26-r32-071", "event_id": "rStUvWxY", "home": "FRA", "away": "MAR", "slug": "france-morocco"},
    {"match_id": "wc26-r32-072", "event_id": "bCdEfGhI", "home": "BRA", "away": "ECU", "slug": "brazil-ecuador"},
    {"match_id": "wc26-r32-073", "event_id": "jKlMnOpQ", "home": "GER", "away": "CMR", "slug": "germany-cameroon"},
    {"match_id": "wc26-r32-074", "event_id": "sUvWxYzA", "home": "NED", "away": "VEN", "slug": "netherlands-venezuela"},
    {"match_id": "wc26-r32-075", "event_id": "cDeFgHiJ", "home": "POR", "away": "URU", "slug": "portugal-uruguay"},
    {"match_id": "wc26-r32-076", "event_id": "kLmNpQrT", "home": "JPN", "away": "CRO", "slug": "japan-croatia"},
    {"match_id": "wc26-r32-077", "event_id": "uVwXyZaB", "home": "COL", "away": "PAR", "slug": "colombia-paraguay"},
    {"match_id": "wc26-r32-078", "event_id": "dEfGhIjK", "home": "AUS", "away": "KOR", "slug": "australia-south-korea"},
    {"match_id": "wc26-r32-079", "event_id": "lMnOpQrS", "home": "SUI", "away": "MEX", "slug": "switzerland-mexico"},
    {"match_id": "wc26-r32-080", "event_id": "tUvWxYzB", "home": "ITA", "away": "CAN", "slug": "italy-canada"},
    # Quarterfinals (event_ids TBD — will be discovered from BetExplorer)
    {"match_id": "wc26-qf-001", "event_id": "TBD", "home": "TBD", "away": "TBD", "slug": "qf-1"},
    {"match_id": "wc26-qf-002", "event_id": "TBD", "home": "TBD", "away": "TBD", "slug": "qf-2"},
    {"match_id": "wc26-qf-003", "event_id": "TBD", "home": "TBD", "away": "TBD", "slug": "qf-3"},
    {"match_id": "wc26-qf-004", "event_id": "TBD", "home": "TBD", "away": "TBD", "slug": "qf-4"},
]

# ─── LOGGING ENGINE ───────────────────────────────────────────────────────────
START_TIME = time.time()

RESET  = "\033[0m"
COLORS = {
    "INIT":    "\033[1;36m",
    "STEP":    "\033[0;37m",
    "PARSE":   "\033[0;35m",
    "ODDS":    "\033[1;32m",
    "PASS":    "\033[1;32m",
    "FAIL":    "\033[1;31m",
    "WARN":    "\033[1;33m",
    "OUTPUT":  "\033[1;35m",
    "VERIFY":  "\033[1;34m",
    "CONVERT": "\033[0;33m",
    "DB":      "\033[0;36m",
    "STATE":   "\033[0;37m",
    "INPUT":   "\033[0;32m",
    "BROWSER": "\033[0;34m",
}

def log(level: str, cat: str, msg: str):
    ts  = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    el  = f"{time.time() - START_TIME:8.3f}s"
    col = COLORS.get(level, "")
    line = f"[{ts}][{el}] [{level:<7}] [{cat:<14}] {msg}"
    print(f"{col}{line}{RESET}", flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def section(title: str):
    bar  = "═" * 72
    log("INIT", "SECTION", f"\n╔{bar}╗\n║  {title:<70}║\n╚{bar}╝")

def separator():
    log("STATE", "─────────", "─" * 72)

# ─── DECIMAL → AMERICAN CONVERSION ───────────────────────────────────────────
def d2a(dec: float) -> int:
    """Convert decimal odds to American odds. Raises on invalid input."""
    if dec <= 1.0:
        raise ValueError(f"[D2A] Invalid decimal odds: {dec} — must be > 1.0")
    frac = Fraction(dec).limit_denominator(100000)
    if frac >= 2:
        return int(round(float((frac - 1) * 100)))
    else:
        return int(round(float(-100 / (frac - 1))))

def fmt_am(am: int) -> str:
    return f"+{am}" if am > 0 else str(am)

def vig_pct(vig: float) -> str:
    return f"{(vig - 1) * 100:.2f}%"

# ─── HTML PARSER — EXTRACT bid=549 ODDS FROM RENDERED TABLE ──────────────────
def parse_market_html(html: str, market: str, match_id: str) -> dict:
    """
    Parse the rendered HTML table for a given market.
    Returns dict with extracted odds or raises on failure.
    
    CONFIRMED element structure (from forensic analysis):
    - <tr data-bid="549" ...> contains <td data-odd="X.XX" data-pos="N" ...>
    - Parent <table data-handicap="VALUE"> encodes the line
    - pos mapping:
        1x2: pos=1→HOME, pos=0→DRAW, pos=2→AWAY
        OU:  pos=1→OVER, pos=2→UNDER  (table data-handicap = line)
        AH:  pos=2→HOME_SPREAD, pos=1→AWAY_SPREAD (table data-handicap = line)
        DC:  pos=1→1X, pos=0→12, pos=2→X2
        BTS: pos=1→YES, pos=2→NO
    """
    soup = BeautifulSoup(html, "html.parser")
    bid_rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    
    log("PARSE", f"{market.upper():<6}", f"bid={BET365_BID} rows found: {len(bid_rows)}")
    
    if not bid_rows:
        # Log all unique bids present for diagnostics
        all_rows = soup.find_all("tr", attrs={"data-bid": True})
        unique_bids = sorted(set(r.get("data-bid") for r in all_rows))
        log("FAIL", f"{market.upper():<6}", f"bid={BET365_BID} NOT FOUND | bids present: {unique_bids[:20]}")
        raise ValueError(f"bid={BET365_BID} not found in {market} table for {match_id}")
    
    result = {}
    
    for row_idx, row in enumerate(bid_rows):
        tds = row.find_all("td", attrs={"data-odd": True})
        if not tds:
            log("WARN", f"{market.upper():<6}", f"Row[{row_idx+1}] has no data-odd TDs — skipping")
            continue
        
        parent_table = row.find_parent("table")
        table_hcp_raw = parent_table.get("data-handicap", "0") if parent_table else "0"
        
        try:
            table_hcp = float(table_hcp_raw)
        except ValueError:
            table_hcp = 0.0
        
        pos_map = {}
        for td in tds:
            pos = td.get("data-pos", "?")
            odd_str = td.get("data-odd", "?")
            try:
                odd_val = float(odd_str)
                pos_map[pos] = odd_val
            except ValueError:
                log("WARN", f"{market.upper():<6}", f"  Non-numeric data-odd='{odd_str}' at pos={pos} — skipping")
        
        log("PARSE", f"{market.upper():<6}", f"  Row[{row_idx+1}] hcp={table_hcp} | pos→dec={pos_map}")
        
        if market == "1x2":
            required = {"1", "0", "2"}
            if not required.issubset(pos_map.keys()):
                log("WARN", "1x2", f"  Missing positions: need {{0,1,2}}, got {set(pos_map.keys())}")
                continue
            h_dec, d_dec, a_dec = pos_map["1"], pos_map["0"], pos_map["2"]
            h_am, d_am, a_am = d2a(h_dec), d2a(d_dec), d2a(a_dec)
            vig = 1/h_dec + 1/d_dec + 1/a_dec
            log("ODDS", "1x2", f"  HOME: {h_dec}→{fmt_am(h_am)} | DRAW: {d_dec}→{fmt_am(d_am)} | AWAY: {a_dec}→{fmt_am(a_am)} | vig={vig_pct(vig)}")
            result = {
                "book_home_ml":  h_am, "book_draw_ml": d_am, "book_away_ml": a_am,
                "_home_dec": h_dec, "_draw_dec": d_dec, "_away_dec": a_dec, "_vig": round(vig, 6),
            }
            break
        
        elif market == "ou":
            required = {"1", "2"}
            if not required.issubset(pos_map.keys()):
                log("WARN", "OU", f"  Missing positions: need {{1,2}}, got {set(pos_map.keys())}")
                continue
            line = table_hcp
            o_dec, u_dec = pos_map["1"], pos_map["2"]
            o_am, u_am = d2a(o_dec), d2a(u_dec)
            vig = 1/o_dec + 1/u_dec
            log("ODDS", "OU", f"  Line={line} | OVER: {o_dec}→{fmt_am(o_am)} | UNDER: {u_dec}→{fmt_am(u_am)} | vig={vig_pct(vig)}")
            # Prefer line closest to 2.5
            if "book_total_line" not in result or abs(line - 2.5) < abs(result["book_total_line"] - 2.5):
                result = {
                    "book_total_line": line, "book_over_odds": o_am, "book_under_odds": u_am,
                    "_over_dec": o_dec, "_under_dec": u_dec, "_vig": round(vig, 6),
                }
        
        elif market == "ah":
            # AH: pos=2→HOME spread, pos=1→AWAY spread
            # CONFIRMED from forensic analysis: pos=2 is HOME, pos=1 is AWAY
            required = {"1", "2"}
            if not required.issubset(pos_map.keys()):
                log("WARN", "AH", f"  Missing positions: need {{1,2}}, got {set(pos_map.keys())}")
                continue
            line = table_hcp
            # Home spread line = table_hcp (e.g., -1.5 means home gives 1.5)
            # Away spread line = -table_hcp
            home_spread_dec = pos_map["2"]
            away_spread_dec = pos_map["1"]
            home_spread_am = d2a(home_spread_dec)
            away_spread_am = d2a(away_spread_dec)
            vig = 1/home_spread_dec + 1/away_spread_dec
            log("ODDS", "AH", f"  Line={line} | HOME: {home_spread_dec}→{fmt_am(home_spread_am)} | AWAY: {away_spread_dec}→{fmt_am(away_spread_am)} | vig={vig_pct(vig)}")
            # Prefer line closest to 0 (most balanced spread)
            if "book_spread_line" not in result or abs(line) < abs(result["book_spread_line"]):
                result = {
                    "book_spread_line": line, "book_home_spread_odds": home_spread_am, "book_away_spread_odds": away_spread_am,
                    "_home_spread_dec": home_spread_dec, "_away_spread_dec": away_spread_dec, "_vig": round(vig, 6),
                }
        
        elif market == "dc":
            required = {"1", "0", "2"}
            if not required.issubset(pos_map.keys()):
                log("WARN", "DC", f"  Missing positions: need {{0,1,2}}, got {set(pos_map.keys())}")
                continue
            dc1x_dec, dc12_dec, dcx2_dec = pos_map["1"], pos_map["0"], pos_map["2"]
            dc1x_am, dc12_am, dcx2_am = d2a(dc1x_dec), d2a(dc12_dec), d2a(dcx2_dec)
            vig = 1/dc1x_dec + 1/dc12_dec + 1/dcx2_dec
            log("ODDS", "DC", f"  1X: {dc1x_dec}→{fmt_am(dc1x_am)} | 12: {dc12_dec}→{fmt_am(dc12_am)} | X2: {dcx2_dec}→{fmt_am(dcx2_am)} | vig={vig_pct(vig)}")
            result = {
                "book_dc_1x_odds": dc1x_am, "book_dc_12_odds": dc12_am, "book_dc_x2_odds": dcx2_am,
                "_dc_1x_dec": dc1x_dec, "_dc_12_dec": dc12_dec, "_dc_x2_dec": dcx2_dec, "_vig": round(vig, 6),
            }
            break
        
        elif market == "bts":
            required = {"1", "2"}
            if not required.issubset(pos_map.keys()):
                log("WARN", "BTS", f"  Missing positions: need {{1,2}}, got {set(pos_map.keys())}")
                continue
            yes_dec, no_dec = pos_map["1"], pos_map["2"]
            yes_am, no_am = d2a(yes_dec), d2a(no_dec)
            vig = 1/yes_dec + 1/no_dec
            log("ODDS", "BTS", f"  YES: {yes_dec}→{fmt_am(yes_am)} | NO: {no_dec}→{fmt_am(no_am)} | vig={vig_pct(vig)}")
            result = {
                "book_btts_yes_odds": yes_am, "book_btts_no_odds": no_am,
                "_yes_dec": yes_dec, "_no_dec": no_dec, "_vig": round(vig, 6),
            }
            break
    
    if not result:
        raise ValueError(f"No valid {market} odds extracted for {match_id}")
    
    return result

# ─── PLAYWRIGHT SCRAPER — SINGLE FIXTURE ─────────────────────────────────────
async def scrape_match(page, match: dict) -> dict:
    """
    Scrape all 5 markets for a single match using Playwright.
    Navigates to the match page, clicks each market tab, waits for AJAX,
    then extracts bet365.us odds from the rendered DOM.
    """
    match_id = match["match_id"]
    event_id   = match["event_id"]
    home       = match["home"]
    away       = match["away"]
    slug       = match["slug"]
    
    section(f"FIXTURE: {match_id} | {home} vs {away} | event_id={event_id}")
    
    if event_id == "TBD":
        log("WARN", "FIXTURE", f"event_id=TBD — skipping {match_id}")
        return {"match_id": match_id, "status": "SKIPPED_TBD", "odds": {}}
    
    url = f"{BETEXPLORER_BASE}/football/world/world-championship-2026/{slug}/{event_id}/"
    log("BROWSER", "NAV", f"Navigating to: {url}")
    
    try:
        await page.goto(url, timeout=PAGE_TIMEOUT_MS, wait_until="domcontentloaded")
        log("PASS", "BROWSER", f"Page loaded: {url}")
    except PWTimeout:
        log("FAIL", "BROWSER", f"Page load TIMEOUT after {PAGE_TIMEOUT_MS}ms: {url}")
        return {"match_id": match_id, "status": "FAIL_PAGE_TIMEOUT", "odds": {}}
    except Exception as e:
        log("FAIL", "BROWSER", f"Page load ERROR: {e}")
        return {"match_id": match_id, "status": f"FAIL_PAGE_ERROR: {e}", "odds": {}}
    
    # Wait for betting tabs to appear
    try:
        await page.wait_for_selector("#bettingTabs", timeout=10000)
        log("PASS", "BROWSER", "Betting tabs element found (#bettingTabs)")
    except PWTimeout:
        log("WARN", "BROWSER", "#bettingTabs not found — page may not have odds (match not yet posted?)")
    
    match_odds = {}
    market_results = {}
    
    for market in MARKETS:
        log("STEP", "MARKET", f"━━━ Processing market: {market} ({MARKET_LABELS[market]}) ━━━")
        
        try:
            # Click the market tab
            tab_selector = f'a[data-tab="{market}"]'
            tab_el = await page.query_selector(tab_selector)
            
            if not tab_el:
                log("FAIL", f"{market.upper():<6}", f"Tab element not found: {tab_selector}")
                market_results[market] = "FAIL_NO_TAB"
                continue
            
            log("BROWSER", f"{market.upper():<6}", f"Clicking tab: {tab_selector}")
            await tab_el.click()
            
            # Wait for AJAX to load the odds table
            await page.wait_for_timeout(TAB_WAIT_MS)
            
            # Wait for at least one data-bid row to appear
            try:
                await page.wait_for_selector(f'tr[data-bid="{BET365_BID}"]', timeout=8000)
                log("PASS", f"{market.upper():<6}", f"bid={BET365_BID} row appeared in DOM")
            except PWTimeout:
                log("WARN", f"{market.upper():<6}", f"bid={BET365_BID} row did not appear — may not offer this market")
            
            # Get the rendered HTML of the odds table
            table_html = await page.inner_html("#odds-content, .table-main, #sortable-1, table[data-handicap]") 
            
            if not table_html:
                # Fallback: get full page HTML
                table_html = await page.content()
                log("WARN", f"{market.upper():<6}", "Using full page HTML as fallback")
            
            # Parse the market odds
            market_odds = parse_market_html(table_html, market, match_id)
            match_odds.update(market_odds)
            market_results[market] = "PASS"
            log("PASS", f"{market.upper():<6}", f"Market {market} extracted successfully")
            
        except ValueError as e:
            log("FAIL", f"{market.upper():<6}", f"Parse error: {e}")
            market_results[market] = f"FAIL_PARSE: {e}"
        except Exception as e:
            log("FAIL", f"{market.upper():<6}", f"Unexpected error: {e}")
            market_results[market] = f"FAIL_UNEXPECTED: {e}"
    
    # Build DB record
    db_record = {
        "match_id":            match_id,
        "book_home_ml":          match_odds.get("book_home_ml"),
        "book_draw_ml":          match_odds.get("book_draw_ml"),
        "book_away_ml":          match_odds.get("book_away_ml"),
        "book_total_line":       match_odds.get("book_total_line"),
        "book_over_odds":        match_odds.get("book_over_odds"),
        "book_under_odds":       match_odds.get("book_under_odds"),
        "book_spread_line":      match_odds.get("book_spread_line"),
        "book_home_spread_odds": match_odds.get("book_home_spread_odds"),
        "book_away_spread_odds": match_odds.get("book_away_spread_odds"),
        "book_dc_1x_odds":       match_odds.get("book_dc_1x_odds"),
        "book_dc_12_odds":       match_odds.get("book_dc_12_odds"),
        "book_dc_x2_odds":       match_odds.get("book_dc_x2_odds"),
        "book_btts_yes_odds":    match_odds.get("book_btts_yes_odds"),
        "book_btts_no_odds":     match_odds.get("book_btts_no_odds"),
    }
    
    # Validation gate — count populated vs null
    populated = sum(1 for v in db_record.values() if v is not None and not isinstance(v, str))
    null_count = sum(1 for v in db_record.values() if v is None)
    
    log("VERIFY", "DB_MAP", f"DB record for {match_id}: {populated} populated | {null_count} NULL")
    for col, val in db_record.items():
        if col == "match_id":
            continue
        status = f"✓ {val}" if val is not None else "✗ NULL"
        log("DB", "COL_MAP", f"  {col:<30} = {status}")
    
    # Market summary
    pass_count = sum(1 for v in market_results.values() if v == "PASS")
    log("OUTPUT", "SUMMARY", f"{match_id}: {pass_count}/{len(MARKETS)} markets PASS | {market_results}")
    
    return {
        "match_id":     match_id,
        "home":           home,
        "away":           away,
        "event_id":       event_id,
        "status":         "PASS" if pass_count == len(MARKETS) else f"PARTIAL_{pass_count}of{len(MARKETS)}",
        "market_results": market_results,
        "db_record":      db_record,
        "raw_odds":       match_odds,
    }

# ─── MAIN ASYNC RUNNER ────────────────────────────────────────────────────────
async def main(match_ids: list = None):
    """
    Main entry point. If match_ids is provided, only scrape those matches.
    Otherwise scrape all matches in the registry.
    """
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*80}\n[SESSION] {datetime.now(timezone.utc).isoformat()} | WC2026 Playwright Scraper v1.0\n{'='*80}\n")
    
    section("WC2026 BETEXPLORER PLAYWRIGHT SCRAPER — PRODUCTION v1.0")
    log("INPUT", "CONFIG", f"Bookmaker: bet365.us (bid={BET365_BID})")
    log("INPUT", "CONFIG", f"Markets: {MARKETS}")
    log("INPUT", "CONFIG", f"Excluded: ha (Draw No Bet)")
    
    # Filter matches
    matches_to_run = FIXTURES
    if match_ids:
        matches_to_run = [f for f in FIXTURES if f["match_id"] in match_ids]
        log("INPUT", "FILTER", f"Running {len(matches_to_run)} matches: {match_ids}")
    else:
        # Skip TBD matches
        matches_to_run = [f for f in FIXTURES if f["event_id"] != "TBD"]
        log("INPUT", "FILTER", f"Running {len(matches_to_run)} matches (skipping TBD)")
    
    log("INPUT", "TOTAL", f"Total matches to scrape: {len(matches_to_run)}")
    
    all_results = []
    
    async with async_playwright() as pw:
        log("BROWSER", "LAUNCH", "Launching Chromium headless browser...")
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ]
        )
        
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        
        page = await context.new_page()
        log("PASS", "BROWSER", "Browser launched | context created | page ready")
        
        for i, match in enumerate(matches_to_run):
            log("STEP", "PROGRESS", f"[{i+1}/{len(matches_to_run)}] {match['match_id']} — {match['home']} vs {match['away']}")
            
            result = await scrape_match(page, match)
            all_results.append(result)
            
            # Rate limit: 2s between matches
            if i < len(matches_to_run) - 1:
                log("STATE", "RATE_LIMIT", "Waiting 2s between matches...")
                await asyncio.sleep(2)
        
        await browser.close()
        log("PASS", "BROWSER", "Browser closed cleanly")
    
    # Final summary
    section("FINAL SUMMARY — ALL FIXTURES")
    pass_count  = sum(1 for r in all_results if r.get("status") == "PASS")
    partial     = sum(1 for r in all_results if r.get("status", "").startswith("PARTIAL"))
    fail_count  = sum(1 for r in all_results if r.get("status", "").startswith("FAIL"))
    skip_count  = sum(1 for r in all_results if r.get("status", "").startswith("SKIP"))
    
    log("OUTPUT", "SUMMARY", f"PASS={pass_count} | PARTIAL={partial} | FAIL={fail_count} | SKIP={skip_count}")
    
    for r in all_results:
        status = r.get("status", "?")
        color  = "\033[1;32m" if status == "PASS" else "\033[1;33m" if status.startswith("PARTIAL") else "\033[1;31m"
        log("OUTPUT", "RESULT", f"  {color}{r['match_id']:<20} {r.get('home','?'):<5} vs {r.get('away','?'):<5} → {status}{RESET}")
    
    # Save output
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scraper":      "wc2026_playwright_scraper.py v1.0",
        "bookmaker":    "bet365.us",
        "bid":          BET365_BID,
        "markets":      MARKETS,
        "total":        len(all_results),
        "pass":         pass_count,
        "partial":      partial,
        "fail":         fail_count,
        "skip":         skip_count,
        "results":      all_results,
    }
    
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, default=str)
    log("OUTPUT", "JSON", f"Saved to {OUTPUT_JSON}")
    
    elapsed = time.time() - START_TIME
    log("OUTPUT", "ELAPSED", f"Total elapsed: {elapsed:.2f}s")
    
    return output

# ─── ENTRY POINT ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Accept optional match_id args: python3 wc2026_playwright_scraper.py wc26-r32-066
    match_ids = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(main(match_ids))
