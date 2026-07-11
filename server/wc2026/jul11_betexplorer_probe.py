#!/usr/bin/env python3
"""
WC2026 JUL 11 BetExplorer Probe — two QFs:
  - wc26-qf-099 (ESPN 760512): Norway (home) vs England (away)   [5 PM ET]
  - wc26-qf-100 (ESPN 760513): Argentina (home) vs Switzerland (away) [9 PM ET]

Derived verbatim from jul9_betexplorer_probe.py (which was derived from
betexplorer_scraper.py v4). Discovers each BetExplorer event_id from the
tournament fixtures page, pulls bet365 (bid=16, US fallback 549) odds via the
same AJAX endpoints, converts decimal->American, and prints one JSON blob per
match for the engine's JUL11_BOOK block.

NO database writes. Output is stdout only — consumed from the Actions log,
exactly how the Jul 7 (v22) and Jul 9 (v23) book blocks were produced.
"""

import json
import re
import time
import random
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.betexplorer.com"
TOURNAMENT_PATHS = [
    "/football/world/world-championship-2026/",
    "/football/world/world-cup-2026/",
]
AJAX_BEST = "{base}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en"
AJAX_ALL = "{base}/match-odds/{event_id}/0/{market}/allOdds/"
BET365_BIDS = [16, 549]
FLAT_MARKETS = ["1x2", "dc", "bts"]
LINED_MARKETS = ["ou", "ah"]

# fid, WC orientation (home listed first per ESPN/DB), and the two team-name
# tokens as they appear in BetExplorer slugs (either order on the page).
MATCHES = [
    {"fid": "wc26-qf-099", "espn": "760512", "home": "NOR", "away": "ENG",
     "tokens": ("norway", "england")},
    {"fid": "wc26-qf-100", "espn": "760513", "home": "ARG", "away": "SUI",
     "tokens": ("argentina", "switzerland")},
]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def log(level, msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] [JUL11-BE] [{level}] {msg}", flush=True)


def dec_to_american(dec_str):
    dec_str = str(dec_str).strip()
    if not dec_str or dec_str in ("0", "0.0", "-", ""):
        raise ValueError(f"invalid decimal '{dec_str}'")
    frac = Fraction(dec_str)
    dec = Decimal(frac.numerator) / Decimal(frac.denominator)
    if dec == Decimal("1.00"):
        return 100
    if dec >= Decimal("2.00"):
        return int(((dec - 1) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return int((Decimal("-100") / (dec - 1)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def discover_event(session, tokens):
    a, b = tokens
    link_re = re.compile(
        r'href="(/football/world/[a-z0-9-]+/((?:%s-%s|%s-%s)[a-z0-9-]*)/([A-Za-z0-9]{8})/)"'
        % (a, b, b, a)
    )
    for path in TOURNAMENT_PATHS:
        url = BASE_URL + path
        log("STEP", f"Fetching fixtures page: {url} (looking for {a}/{b})")
        try:
            resp = session.get(url, timeout=25)
        except Exception as e:
            log("WARN", f"fetch failed: {e}")
            continue
        log("STATE", f"HTTP {resp.status_code} | {len(resp.content):,}B")
        if resp.status_code != 200:
            continue
        html = resp.text
        m = link_re.search(html)
        if m:
            full_path, slug, event_id = m.group(1), m.group(2), m.group(3)
            log("PASS", f"FOUND: slug={slug} event_id={event_id} path={full_path}")
            return full_path, slug, event_id
        near = re.findall(
            r'href="(/football/world/[a-z0-9-]+/[a-z0-9-]*(?:%s|%s)[a-z0-9-]*/[A-Za-z0-9]{8}/)"' % (a, b),
            html)
        log("DEBUG", f"links mentioning {a}/{b} on this page: {sorted(set(near))}")
    log("FAIL", f"EVENT DISCOVERY FAILED — no {a}-{b} link found (match may not be posted yet)")
    return None, None, None


def parse_rows(soup):
    rows = []
    for bid in BET365_BIDS:
        for tr in soup.select(f'tr[data-bid="{bid}"]'):
            for td in tr.select("td[data-odd]"):
                dec = td.get("data-odd", "")
                if not dec:
                    continue
                try:
                    am = dec_to_american(dec)
                except ValueError:
                    continue
                rows.append({"bid": bid, "pos": td.get("data-pos", ""),
                             "hcp": td.get("data-hcp", tr.get("data-hcp", "")) or None,
                             "dec": dec, "american": am})
        if rows:
            break
    return rows


def fetch_market(session, event_id, market, referer):
    url = (AJAX_ALL if market in LINED_MARKETS else AJAX_BEST).format(
        base=BASE_URL, event_id=event_id, market=market)
    for attempt in range(1, 4):
        try:
            resp = session.get(url, timeout=25, headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest", "Referer": referer})
            if resp.status_code != 200:
                raise ValueError(f"HTTP {resp.status_code}")
            html = resp.json().get("odds", "")
            if not html:
                raise ValueError("empty 'odds' key")
            return parse_rows(BeautifulSoup(html, "html.parser"))
        except Exception as e:
            log("WARN", f"[{market}] attempt {attempt}: {e}")
            time.sleep(random.uniform(3, 6))
    log("FAIL", f"MARKET FETCH FAILED: {market}")
    return []


def probe_match(session, spec):
    log("STEP", f"===== {spec['fid']} {spec['home']} vs {spec['away']} =====")
    full_path, slug, event_id = discover_event(session, spec["tokens"])
    if not event_id:
        return {"fid": spec["fid"], "espn": spec["espn"], "error": "event not found"}
    referer = BASE_URL + full_path
    try:
        r = session.get(referer, timeout=25)
        title = re.search(r"<title>(.*?)</title>", r.text, re.S)
        if title:
            log("STATE", f"page title: {title.group(1).strip()[:120]}")
    except Exception as e:
        log("WARN", f"warmup failed: {e}")
    time.sleep(random.uniform(2, 4))
    result = {"fid": spec["fid"], "espn": spec["espn"], "home": spec["home"],
              "away": spec["away"], "slug": slug, "event_id": event_id,
              "scraped_at": datetime.now(timezone.utc).isoformat(), "markets": {}}
    for market in FLAT_MARKETS + LINED_MARKETS:
        rows = fetch_market(session, event_id, market, referer)
        result["markets"][market] = rows
        log("PASS", f"[{market}] {len(rows)} odds cells captured")
        time.sleep(random.uniform(2.5, 5))
    return result


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9", "Connection": "keep-alive"})
    out = []
    for spec in MATCHES:
        out.append(probe_match(session, spec))
        time.sleep(random.uniform(3, 6))
    print("\n===== JUL11_BOOK_RAW_JSON_BEGIN =====")
    print(json.dumps(out, indent=2))
    print("===== JUL11_BOOK_RAW_JSON_END =====")


if __name__ == "__main__":
    main()
