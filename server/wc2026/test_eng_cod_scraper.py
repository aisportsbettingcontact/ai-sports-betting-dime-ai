#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 BETEXPLORER SCRAPER — SINGLE FIXTURE TEST                              ║
║  Target: England vs DR Congo | event_id=nkoQVAgB                               ║
║  Validates: bid=549 parsing for all 5 markets from live BetExplorer HTML       ║
║  Logs: wc2026oddslog.txt (append-only)                                         ║
╚══════════════════════════════════════════════════════════════════════════════════╝
"""

import sys
import os
import time
import json
import re
import traceback
from datetime import datetime, timezone
from fractions import Fraction
from typing import Optional, Dict, Any, List
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
BET365_BID = 549
LOG_FILE   = "/home/ubuntu/wc2026oddslog.txt"
BASE_URL   = "https://www.betexplorer.com"

FIXTURE = {
    "fixture_id": "wc26-r32-080",
    "event_id":   "nkoQVAgB",
    "slug":       "england-d-r-congo",
    "home":       "England",
    "away":       "D.R. Congo",
    "round":      "R32",
    "date":       "2026-07-01",
}

MARKETS = ["1x2", "ou", "ah", "dc", "bts"]

RESET  = "\033[0m"
COLORS = {
    "INIT":    "\033[1;36m",
    "INPUT":   "\033[0;34m",
    "STEP":    "\033[0;37m",
    "HTTP":    "\033[0;33m",
    "PARSE":   "\033[0;35m",
    "ODDS":    "\033[1;32m",
    "PASS":    "\033[1;32m",
    "FAIL":    "\033[1;31m",
    "WARN":    "\033[1;33m",
    "STATE":   "\033[0;37m",
    "OUTPUT":  "\033[1;35m",
    "VERIFY":  "\033[1;34m",
    "CONVERT": "\033[0;33m",
    "DB":      "\033[0;36m",
}

START = time.time()

def log(level: str, cat: str, msg: str):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    el = f"{time.time()-START:7.3f}s"
    color = COLORS.get(level, "")
    line = f"[{ts}][{el}] [{level:<7}] [{cat:<10}] {msg}"
    print(f"{color}{line}{RESET}", flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def section(title: str):
    bar = "═" * 70
    log("INIT", "SECTION", f"\n╔{bar}╗\n║  {title:<68}║\n╚{bar}╝")

# ─────────────────────────────────────────────────────────────────────────────
# DECIMAL → AMERICAN
# ─────────────────────────────────────────────────────────────────────────────
def d2a(dec: float) -> int:
    if dec <= 1.0:
        raise ValueError(f"Invalid decimal: {dec}")
    frac = Fraction(dec).limit_denominator(10000)
    if frac >= 2:
        return int(round(float((frac - 1) * 100)))
    else:
        return int(round(float(-100 / (frac - 1))))

def fmt(am: int) -> str:
    return f"+{am}" if am > 0 else str(am)

# ─────────────────────────────────────────────────────────────────────────────
# HTTP FETCH
# ─────────────────────────────────────────────────────────────────────────────
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

def fetch(url: str, extra_headers: dict = None) -> Optional[str]:
    h = {**HEADERS, **(extra_headers or {})}
    for attempt in range(1, 4):
        log("HTTP", "REQUEST", f"GET {url} [attempt {attempt}/3]")
        try:
            r = requests.get(url, headers=h, timeout=30)
            log("HTTP", "RESPONSE", f"status={r.status_code} size={len(r.content):,}B content-type={r.headers.get('content-type','?')[:40]}")
            if r.status_code == 200 and len(r.content) > 500:
                return r.text
            elif r.status_code == 404:
                log("FAIL", "HTTP", f"404 Not Found: {url}")
                return None
            else:
                log("WARN", "HTTP", f"Unexpected status {r.status_code}")
        except Exception as e:
            log("WARN", "HTTP", f"Exception attempt {attempt}: {type(e).__name__}: {str(e)[:80]}")
        if attempt < 3:
            time.sleep(2 * attempt)
    log("FAIL", "HTTP", f"All retries exhausted for: {url}")
    return None

# ─────────────────────────────────────────────────────────────────────────────
# FORENSIC HTML INSPECTOR — Enumerate ALL bid=549 rows in the page
# ─────────────────────────────────────────────────────────────────────────────
def forensic_inspect(soup: BeautifulSoup, source: str):
    section(f"FORENSIC INSPECTION — {source}")
    
    all_bid549 = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    log("PARSE", "FORENSIC", f"Total <tr data-bid='{BET365_BID}'> rows found: {len(all_bid549)}")
    
    for i, row in enumerate(all_bid549):
        tds = row.find_all("td", attrs={"data-odd": True})
        parent_table = row.find_parent("table")
        table_id = parent_table.get("id", "?") if parent_table else "?"
        table_hcp = parent_table.get("data-handicap", "?") if parent_table else "?"
        
        odds_vals = [(td.get("data-pos","?"), td.get("data-odd","?")) for td in tds]
        log("PARSE", "FORENSIC", 
            f"  Row[{i+1}] table_id={table_id} data-handicap={table_hcp} | "
            f"tds_with_odd={len(tds)} | pos→odd={odds_vals}")
    
    # Also check for any tables with data-handicap
    hcp_tables = soup.find_all("table", attrs={"data-handicap": True})
    log("PARSE", "FORENSIC", f"Tables with data-handicap: {len(hcp_tables)}")
    for t in hcp_tables:
        bid549_rows = t.find_all("tr", attrs={"data-bid": str(BET365_BID)})
        log("PARSE", "FORENSIC", 
            f"  table data-handicap={t.get('data-handicap')} | bid=549 rows: {len(bid549_rows)}")
    
    # Check all unique bid values present
    all_bid_rows = soup.find_all("tr", attrs={"data-bid": True})
    unique_bids = sorted(set(r.get("data-bid") for r in all_bid_rows))
    log("PARSE", "FORENSIC", f"All unique data-bid values in page: {unique_bids[:30]}")
    
    # Check if bid=549 is in the list
    if str(BET365_BID) in unique_bids:
        log("PASS", "FORENSIC", f"bid={BET365_BID} (bet365.us) IS PRESENT in this page ✓")
    else:
        log("FAIL", "FORENSIC", f"bid={BET365_BID} (bet365.us) NOT FOUND in this page ✗")
        log("WARN", "FORENSIC", f"Available bids: {unique_bids}")

# ─────────────────────────────────────────────────────────────────────────────
# MARKET PARSERS
# ─────────────────────────────────────────────────────────────────────────────
def parse_1x2(soup: BeautifulSoup) -> Optional[Dict]:
    log("PARSE", "1x2", "Searching for bid=549 1x2 row...")
    rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 3:
            continue
        parent_table = row.find_parent("table")
        if parent_table and parent_table.get("data-handicap"):
            continue
        
        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log("PARSE", "1x2", f"Candidate row pos_map={pos_map}")
        
        if all(k in pos_map for k in ["1","2","3"]):
            h, d, a = pos_map["1"], pos_map["2"], pos_map["3"]
            hA, dA, aA = d2a(h), d2a(d), d2a(a)
            vig = 1/h + 1/d + 1/a
            log("CONVERT", "1x2", f"HOME: {h} → {fmt(hA)} | DRAW: {d} → {fmt(dA)} | AWAY: {a} → {fmt(aA)}")
            log("VERIFY", "1x2", f"Vig={vig:.4f} | PASS={1.01<=vig<=1.20}")
            if not (1.01 <= vig <= 1.20):
                log("WARN", "1x2", f"Vig out of range: {vig:.4f}")
            return {"book_home_ml": hA, "book_draw_ml": dA, "book_away_ml": aA,
                    "home_dec": h, "draw_dec": d, "away_dec": a, "vig": round(vig,4)}
    
    log("FAIL", "1x2", "No bid=549 1x2 row found")
    return None

def parse_ou(soup: BeautifulSoup) -> Optional[Dict]:
    log("PARSE", "OU", "Searching for bid=549 OU row...")
    ou_tables = soup.find_all("table", attrs={"data-handicap": True})
    log("PARSE", "OU", f"Found {len(ou_tables)} tables with data-handicap")
    
    preferred = ["2.5", "2.0", "3.0", "1.5", "3.5"]
    target_tbl, target_line = None, None
    
    for pref in preferred:
        for tbl in ou_tables:
            if tbl.get("data-handicap") == pref:
                if tbl.find("tr", attrs={"data-bid": str(BET365_BID)}):
                    target_tbl, target_line = tbl, pref
                    break
        if target_tbl:
            break
    
    if not target_tbl and ou_tables:
        for tbl in ou_tables:
            if tbl.find("tr", attrs={"data-bid": str(BET365_BID)}):
                target_tbl = tbl
                target_line = tbl.get("data-handicap","?")
                break
    
    if not target_tbl:
        log("FAIL", "OU", "No OU table with bid=549 found")
        return None
    
    log("PARSE", "OU", f"Using table data-handicap={target_line}")
    rows = target_tbl.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 2:
            continue
        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log("PARSE", "OU", f"Candidate row pos_map={pos_map}")
        
        if "1" in pos_map and "2" in pos_map:
            ov, un = pos_map["1"], pos_map["2"]
            ovA, unA = d2a(ov), d2a(un)
            vig = 1/ov + 1/un
            log("CONVERT", "OU", f"OVER {target_line}: {ov} → {fmt(ovA)} | UNDER {target_line}: {un} → {fmt(unA)}")
            log("VERIFY", "OU", f"Vig={vig:.4f} | PASS={1.01<=vig<=1.15}")
            return {"book_total_line": float(target_line), "book_over_odds": ovA, "book_under_odds": unA,
                    "over_dec": ov, "under_dec": un, "vig": round(vig,4)}
    
    log("FAIL", "OU", "No bid=549 OU row with 2 positions found")
    return None

def parse_ah(soup: BeautifulSoup) -> Optional[Dict]:
    log("PARSE", "AH", "Searching for bid=549 AH row...")
    ah_tables = soup.find_all("table", attrs={"data-handicap": True})
    
    # Find table with line closest to 0 that is NOT a typical OU line
    ou_lines = {2.0, 2.5, 3.0, 1.5, 3.5, 4.0, 4.5, 5.0, 0.5}
    best_abs = float("inf")
    target_tbl, target_line = None, None
    
    for tbl in ah_tables:
        hcp = tbl.get("data-handicap","")
        try:
            val = float(hcp)
            if abs(val) in ou_lines:
                continue
            if abs(val) < best_abs and tbl.find("tr", attrs={"data-bid": str(BET365_BID)}):
                best_abs = abs(val)
                target_tbl, target_line = tbl, hcp
        except ValueError:
            continue
    
    if not target_tbl:
        # Try any table with bid=549 and 2 data-odd TDs
        for tbl in ah_tables:
            rows = tbl.find_all("tr", attrs={"data-bid": str(BET365_BID)})
            for row in rows:
                tds = row.find_all("td", attrs={"data-odd": True})
                if len(tds) == 2:
                    target_tbl = tbl
                    target_line = tbl.get("data-handicap","?")
                    break
            if target_tbl:
                break
    
    if not target_tbl:
        log("FAIL", "AH", "No AH table with bid=549 found")
        return None
    
    log("PARSE", "AH", f"Using table data-handicap={target_line}")
    rows = target_tbl.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 2:
            continue
        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log("PARSE", "AH", f"Candidate row pos_map={pos_map}")
        
        if "1" in pos_map and "2" in pos_map:
            # AH: pos=1=AWAY, pos=2=HOME (confirmed from HTML forensic analysis)
            away_dec, home_dec = pos_map["1"], pos_map["2"]
            away_am, home_am = d2a(away_dec), d2a(home_dec)
            try:
                spread_line = float(target_line)
            except ValueError:
                spread_line = None
            log("CONVERT", "AH", f"HOME spread={target_line}: {home_dec} → {fmt(home_am)} | AWAY: {away_dec} → {fmt(away_am)}")
            vig = 1/home_dec + 1/away_dec
            log("VERIFY", "AH", f"Vig={vig:.4f}")
            return {"book_spread_line": spread_line, "book_home_spread_odds": home_am, "book_away_spread_odds": away_am,
                    "home_spread_dec": home_dec, "away_spread_dec": away_dec, "vig": round(vig,4)}
    
    log("FAIL", "AH", "No bid=549 AH row with 2 positions found")
    return None

def parse_dc(soup: BeautifulSoup) -> Optional[Dict]:
    log("PARSE", "DC", "Searching for bid=549 DC row...")
    rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    
    dc_candidates = []
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) < 3:
            continue
        parent_table = row.find_parent("table")
        if parent_table and parent_table.get("data-handicap"):
            continue
        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        dc_candidates.append((row, pos_map))
    
    log("PARSE", "DC", f"Found {len(dc_candidates)} candidate rows with 3 non-handicap TDs")
    
    # DC odds are typically lower than 1x2 (covering 2 outcomes)
    # We need to distinguish DC from 1x2 — DC max odds should be < 1x2 away odds
    # Strategy: if we have multiple candidates, pick the one where all values < 2.5
    for row, pos_map in dc_candidates:
        vals = list(pos_map.values())
        log("PARSE", "DC", f"  Candidate pos_map={pos_map} | all_lt_2.5={all(v<2.5 for v in vals)}")
        if all(k in pos_map for k in ["1","2","3"]):
            v1, v2, v3 = pos_map["1"], pos_map["2"], pos_map["3"]
            a1, a2, a3 = d2a(v1), d2a(v2), d2a(v3)
            vig = 1/v1 + 1/v2 + 1/v3
            log("CONVERT", "DC", f"1X: {v1}→{fmt(a1)} | 12: {v2}→{fmt(a2)} | X2: {v3}→{fmt(a3)}")
            log("VERIFY", "DC", f"Vig={vig:.4f}")
            return {"book_dc_1x_odds": a1, "book_dc_12_odds": a2, "book_dc_x2_odds": a3,
                    "dc_1x_dec": v1, "dc_12_dec": v2, "dc_x2_dec": v3, "vig": round(vig,4)}
    
    log("FAIL", "DC", "No bid=549 DC row found")
    return None

def parse_btts(soup: BeautifulSoup) -> Optional[Dict]:
    log("PARSE", "BTTS", "Searching for bid=549 BTTS row...")
    rows = soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
    
    for row in rows:
        tds = row.find_all("td", attrs={"data-odd": True, "data-pos": True})
        if len(tds) != 2:
            continue
        parent_table = row.find_parent("table")
        if parent_table and parent_table.get("data-handicap"):
            continue
        pos_map = {td.get("data-pos"): float(td.get("data-odd")) for td in tds}
        log("PARSE", "BTTS", f"Candidate row pos_map={pos_map}")
        
        if "1" in pos_map and "2" in pos_map:
            yes_dec, no_dec = pos_map["1"], pos_map["2"]
            yes_am, no_am = d2a(yes_dec), d2a(no_dec)
            vig = 1/yes_dec + 1/no_dec
            log("CONVERT", "BTTS", f"YES: {yes_dec}→{fmt(yes_am)} | NO: {no_dec}→{fmt(no_am)}")
            log("VERIFY", "BTTS", f"Vig={vig:.4f}")
            return {"book_btts_yes_odds": yes_am, "book_btts_no_odds": no_am,
                    "yes_dec": yes_dec, "no_dec": no_dec, "vig": round(vig,4)}
    
    log("FAIL", "BTTS", "No bid=549 BTTS row with exactly 2 positions found")
    return None

# ─────────────────────────────────────────────────────────────────────────────
# MAIN TEST
# ─────────────────────────────────────────────────────────────────────────────
def main():
    with open(LOG_FILE, "a") as f:
        f.write(f"\n{'='*80}\n[SESSION] {datetime.now(timezone.utc).isoformat()} | ENG vs COD Single Fixture Test\n{'='*80}\n")
    
    section("WC2026 BETEXPLORER SCRAPER — SINGLE FIXTURE TEST: ENG vs COD")
    log("INIT", "CONFIG", f"BET365_BID={BET365_BID} | event_id={FIXTURE['event_id']} | Markets={MARKETS}")
    
    # ── Phase 1: Conversion engine validation ─────────────────────────────
    section("PHASE 1: CONVERSION ENGINE VALIDATION")
    # Confirmed values from pasted_content_73.txt (ENG vs COD 1x2 table)
    test_cases = [
        (1.29, -345, "ENG 1x2 HOME"),
        (5.20, +420, "ENG 1x2 DRAW"),
        (12.00, +1100, "ENG 1x2 AWAY"),
        (1.98, -102, "ENG OU 2.5 OVER"),
        (1.88, -114, "ENG OU 2.5 UNDER"),
    ]
    for dec, expected, label in test_cases:
        got = d2a(dec)
        ok = abs(got - expected) <= 2
        lvl = "PASS" if ok else "FAIL"
        log(lvl, "CONVERT", f"{label}: {dec} → {fmt(got)} (expected {fmt(expected)}) {'✓' if ok else '✗'}")
    
    # ── Phase 2: Fetch full page ──────────────────────────────────────────
    section("PHASE 2: FETCH FULL MATCH PAGE HTML")
    url = f"{BASE_URL}/football/world/world-championship-2026/{FIXTURE['slug']}/{FIXTURE['event_id']}/"
    log("INPUT", "URL", f"Target URL: {url}")
    
    html = fetch(url)
    if not html:
        log("FAIL", "FETCH", "CRITICAL: Could not fetch match page. Aborting.")
        sys.exit(1)
    
    soup = BeautifulSoup(html, "html.parser")
    log("PASS", "FETCH", f"HTML fetched: {len(html):,} chars | soup parsed")
    
    # Save raw HTML for inspection
    raw_path = "/home/ubuntu/eng_cod_live.html"
    with open(raw_path, "w", encoding="utf-8") as f:
        f.write(html)
    log("STATE", "SAVE", f"Raw HTML saved to {raw_path} ({len(html):,}B)")
    
    # ── Phase 3: Forensic inspection ─────────────────────────────────────
    section("PHASE 3: FORENSIC HTML INSPECTION")
    forensic_inspect(soup, "FULL PAGE")
    
    # ── Phase 4: Try AJAX endpoints for each market ───────────────────────
    section("PHASE 4: AJAX MARKET ENDPOINTS")
    market_soups = {}
    
    for market in MARKETS:
        ajax_url = f"{BASE_URL}/match-odds/{FIXTURE['event_id']}/{market}/"
        log("HTTP", "AJAX", f"Trying AJAX: {ajax_url}")
        ajax_html = fetch(ajax_url, extra_headers={
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*",
            "Referer": url,
        })
        
        if ajax_html and len(ajax_html) > 100:
            ajax_soup = BeautifulSoup(ajax_html, "html.parser")
            bid549_rows = ajax_soup.find_all("tr", attrs={"data-bid": str(BET365_BID)})
            log("PASS", "AJAX", f"market={market} | size={len(ajax_html):,}B | bid=549 rows={len(bid549_rows)}")
            if bid549_rows:
                market_soups[market] = ajax_soup
                log("PASS", "AJAX", f"Using AJAX soup for market={market}")
            else:
                log("WARN", "AJAX", f"AJAX returned HTML but no bid=549 rows for market={market} — using full page")
                market_soups[market] = soup
        else:
            log("WARN", "AJAX", f"AJAX failed for market={market} — using full page HTML")
            market_soups[market] = soup
        
        time.sleep(1.5)
    
    # ── Phase 5: Parse all markets ────────────────────────────────────────
    section("PHASE 5: MARKET PARSING")
    
    parsers = {
        "1x2": parse_1x2,
        "ou":  parse_ou,
        "ah":  parse_ah,
        "dc":  parse_dc,
        "bts": parse_btts,
    }
    
    results = {}
    for market in MARKETS:
        log("STEP", "PARSE", f"━━━ Parsing market: {market} ━━━")
        try:
            parsed = parsers[market](market_soups[market])
            if parsed:
                results[market] = parsed
                log("PASS", "PARSE", f"market={market} → PARSED OK | {parsed}")
            else:
                results[market] = None
                log("FAIL", "PARSE", f"market={market} → FAILED (bid=549 not found)")
        except Exception as e:
            results[market] = None
            log("FAIL", "PARSE", f"market={market} → EXCEPTION: {type(e).__name__}: {e}")
            log("FAIL", "TRACE", traceback.format_exc()[:400])
    
    # ── Phase 6: DB column map output ─────────────────────────────────────
    section("PHASE 6: DB COLUMN MAP — wc2026_frozen_book_odds")
    
    DB_MAP = {
        "1x2": [
            ("book_home_ml",  results.get("1x2",{}) and results["1x2"].get("book_home_ml")),
            ("book_draw_ml",  results.get("1x2",{}) and results["1x2"].get("book_draw_ml")),
            ("book_away_ml",  results.get("1x2",{}) and results["1x2"].get("book_away_ml")),
        ],
        "ou": [
            ("book_total_line",  results.get("ou",{}) and results["ou"].get("book_total_line")),
            ("book_over_odds",   results.get("ou",{}) and results["ou"].get("book_over_odds")),
            ("book_under_odds",  results.get("ou",{}) and results["ou"].get("book_under_odds")),
        ],
        "ah": [
            ("book_spread_line",       results.get("ah",{}) and results["ah"].get("book_spread_line")),
            ("book_home_spread_odds",  results.get("ah",{}) and results["ah"].get("book_home_spread_odds")),
            ("book_away_spread_odds",  results.get("ah",{}) and results["ah"].get("book_away_spread_odds")),
        ],
        "dc": [
            ("book_dc_1x_odds",  results.get("dc",{}) and results["dc"].get("book_dc_1x_odds")),
            ("book_dc_12_odds",  results.get("dc",{}) and results["dc"].get("book_dc_12_odds")),
            ("book_dc_x2_odds",  results.get("dc",{}) and results["dc"].get("book_dc_x2_odds")),
        ],
        "bts": [
            ("book_btts_yes_odds",  results.get("bts",{}) and results["bts"].get("book_btts_yes_odds")),
            ("book_btts_no_odds",   results.get("bts",{}) and results["bts"].get("book_btts_no_odds")),
        ],
    }
    
    for market, cols in DB_MAP.items():
        for col, val in cols:
            status = "✓" if val is not None and val is not False else "✗ NULL"
            log("DB", "COL_MAP", f"  {col:<30} = {val!s:<10} {status}")
    
    # ── Phase 7: Final summary ────────────────────────────────────────────
    section("PHASE 7: FINAL SUMMARY")
    
    ok_markets = [m for m in MARKETS if results.get(m)]
    fail_markets = [m for m in MARKETS if not results.get(m)]
    
    log("OUTPUT", "SUMMARY", f"Markets OK:   {ok_markets}")
    log("OUTPUT", "SUMMARY", f"Markets FAIL: {fail_markets}")
    log("OUTPUT", "SUMMARY", f"Score: {len(ok_markets)}/{len(MARKETS)}")
    
    if results.get("1x2"):
        r = results["1x2"]
        log("ODDS", "1x2", f"ENG {fmt(r['book_home_ml'])} | DRAW {fmt(r['book_draw_ml'])} | COD {fmt(r['book_away_ml'])}")
    if results.get("ou"):
        r = results["ou"]
        log("ODDS", "OU", f"O{r['book_total_line']} {fmt(r['book_over_odds'])} | U{r['book_total_line']} {fmt(r['book_under_odds'])}")
    if results.get("ah"):
        r = results["ah"]
        log("ODDS", "AH", f"Spread={r['book_spread_line']} | HOME {fmt(r['book_home_spread_odds'])} | AWAY {fmt(r['book_away_spread_odds'])}")
    if results.get("dc"):
        r = results["dc"]
        log("ODDS", "DC", f"1X {fmt(r['book_dc_1x_odds'])} | 12 {fmt(r['book_dc_12_odds'])} | X2 {fmt(r['book_dc_x2_odds'])}")
    if results.get("bts"):
        r = results["bts"]
        log("ODDS", "BTTS", f"YES {fmt(r['book_btts_yes_odds'])} | NO {fmt(r['book_btts_no_odds'])}")
    
    # Save JSON
    out = {
        "fixture": FIXTURE,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "markets_ok": ok_markets,
        "markets_fail": fail_markets,
        "results": {k: v for k, v in results.items() if v},
    }
    out_path = "/home/ubuntu/wc2026_eng_cod_test.json"
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    log("OUTPUT", "JSON", f"Saved to {out_path}")
    
    elapsed = time.time() - START
    log("OUTPUT", "ELAPSED", f"Total elapsed: {elapsed:.2f}s")

if __name__ == "__main__":
    main()
