#!/usr/bin/env python3.11
"""
ActionNetworkPropsScraper.py
============================
Scrapes MLB pitcher strikeout prop lines from Action Network.

Usage:
    python3.11 ActionNetworkPropsScraper.py [--date YYYY-MM-DD] [--output /path/to/output.json]

Output JSON format:
    {
      "scraped_at": "2026-03-25T19:30:00",
      "props": [
        {
          "player_name": "Max Fried",
          "team": "NYY",
          "book_line": 4.5,
          "best_over_odds": -150,
          "best_under_odds": 120,
          "consensus_over_odds": -152,
          "consensus_under_odds": 115,
          "books": [
            {"book": "BetMGM", "over_line": 4.5, "over_odds": -150, "under_line": 4.5, "under_odds": 120},
            ...
          ]
        },
        ...
      ]
    }

Exit codes:
    0 = success
    1 = scrape failed / no data found
    2 = browser error
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone

# ── Logging helpers ────────────────────────────────────────────────────────────


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[ActionNetworkScraper] [{ts}] {msg}", flush=True)


def log_err(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[ActionNetworkScraper] [ERROR] [{ts}] {msg}", file=sys.stderr, flush=True)


# ── Odds parsing helpers ───────────────────────────────────────────────────────


def parse_odds_str(s: str) -> int | None:
    """
    Parse an American odds string like '-150', '+105', '105' into an integer.
    Returns None if unparseable.
    """
    if not s:
        return None
    s = s.strip()
    # Remove leading 'o' or 'u' (over/under prefix) if present
    s = re.sub(r"^[ou]", "", s, flags=re.IGNORECASE)
    try:
        return int(s)
    except ValueError:
        return None


def parse_line_str(s: str) -> float | None:
    """
    Parse a line string like 'o4.5', 'u6.5', '4.5' into a float.
    Returns None if unparseable.
    """
    if not s:
        return None
    s = s.strip()
    # Strip leading 'o' or 'u'
    s = re.sub(r"^[ou]", "", s, flags=re.IGNORECASE)
    try:
        return float(s)
    except ValueError:
        return None


# ── Main scraper ───────────────────────────────────────────────────────────────


def scrape_action_network_strikeouts(date_str: str | None = None) -> list[dict]:  # noqa: ARG001
    """
    Navigate to Action Network MLB strikeouts props page and extract all pitcher K prop lines.

    Returns a list of prop dicts.
    """
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright

    url = "https://www.actionnetwork.com/mlb/props/pitching"
    log(f"Navigating to: {url}")

    props_data: list[dict] = []

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-web-security",
                    "--disable-features=IsolateOrigins,site-per-process",
                ],
            )
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                viewport={"width": 1440, "height": 900},
                locale="en-US",
                timezone_id="America/New_York",
            )

            # Intercept API responses to capture raw JSON data
            page = context.new_page()

            captured_api_data = []

            def on_response(response):
                url_r = response.url
                if "actionnetwork.com" in url_r and (
                    "props" in url_r or "player" in url_r or "strikeout" in url_r
                ):
                    log(f"  [API] Intercepted: {url_r} → status={response.status}")
                    try:
                        if response.status == 200:
                            body = response.json()
                            captured_api_data.append({"url": url_r, "data": body})
                            log(f"  [API] Captured JSON from: {url_r}")
                    except Exception as e:
                        log(f"  [API] Could not parse JSON from {url_r}: {e}")

            page.on("response", on_response)

            log("Loading page...")
            try:
                page.goto(url, wait_until="networkidle", timeout=45000)
            except PWTimeout:
                log("networkidle timeout — trying domcontentloaded fallback")
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                time.sleep(5)

            log("Page loaded. Waiting for props table...")

            # Wait for the props table rows to appear
            try:
                page.wait_for_selector(
                    ".total-prop-row__player-name, .props-table__player-header",
                    timeout=20000,
                )
                log("Props table found.")
            except PWTimeout:
                log_err(
                    "Props table not found within timeout. Dumping page title and URL."
                )
                log(f"  Page title: {page.title()}")
                log(f"  Page URL: {page.url}")
                # Try scrolling to trigger lazy load
                page.evaluate("window.scrollTo(0, 500)")
                time.sleep(3)

            # Additional wait for all rows to render
            time.sleep(2)

            # ── Parse the DOM ──────────────────────────────────────────────────
            log("Parsing props table DOM...")

            rows_data = page.evaluate("""
                () => {
                    const results = [];
                    // Find all player prop rows
                    const rows = document.querySelectorAll('tr[data-index], .total-prop-row__player-container');

                    // Try the virtualized table approach first
                    const tableRows = document.querySelectorAll('tr[data-item-index]');

                    if (tableRows.length > 0) {
                        console.log('[DOM] Found ' + tableRows.length + ' virtualized table rows');
                        tableRows.forEach((row, rowIdx) => {
                            const playerNameEl = row.querySelector('.total-prop-row__player-name a, .total-prop-row__player-name');
                            const teamEl = row.querySelector('.total-prop-row__player-team');

                            if (!playerNameEl) return;

                            const playerName = playerNameEl.textContent.trim();
                            const team = teamEl ? teamEl.textContent.trim() : '';

                            // Get all book cells in this row
                            const cells = row.querySelectorAll('td');
                            const bookCells = [];

                            // First cell is player info, rest are book cells
                            for (let i = 1; i < cells.length; i++) {
                                const cell = cells[i];
                                const oddsEls = cell.querySelectorAll('[data-testid="book-cell__odds"]');

                                if (oddsEls.length >= 2) {
                                    // Over row
                                    const overEl = oddsEls[0];
                                    const underEl = oddsEls[1];

                                    const overLineEl = overEl.querySelector('.css-1jlt5rt, [class*="ep4ea6p2"]');
                                    const overOddsEl = overEl.querySelector('.book-cell__secondary');
                                    const underLineEl = underEl.querySelector('.css-1jlt5rt, [class*="ep4ea6p2"]');
                                    const underOddsEl = underEl.querySelector('.book-cell__secondary');

                                    bookCells.push({
                                        cellIndex: i,
                                        overLine: overLineEl ? overLineEl.textContent.trim() : '',
                                        overOdds: overOddsEl ? overOddsEl.textContent.trim() : '',
                                        underLine: underLineEl ? underLineEl.textContent.trim() : '',
                                        underOdds: underOddsEl ? underOddsEl.textContent.trim() : '',
                                    });
                                }
                            }

                            results.push({
                                playerName,
                                team,
                                bookCells,
                                rowIndex: rowIdx,
                            });
                        });
                    }

                    return results;
                }
            """)

            log(f"DOM parse returned {len(rows_data)} rows")

            # Also get column headers to identify which book is which
            headers_data = page.evaluate("""
                () => {
                    const headers = [];
                    const headerCells = document.querySelectorAll('.props-table__header, .props-table__best-odds-header, .props-table__player-header');
                    headerCells.forEach((h, i) => {
                        const imgEl = h.querySelector('img');
                        const alt = imgEl ? imgEl.alt : '';
                        headers.push({
                            index: i,
                            text: h.textContent.trim(),
                            bookName: alt.replace(' logo', '').replace(' NV', '').replace(' Logo', '').trim(),
                        });
                    });
                    return headers;
                }
            """)

            log(f"Column headers: {headers_data}")

            # Log all captured API data
            if captured_api_data:
                log(f"Captured {len(captured_api_data)} API responses")
                for item in captured_api_data:
                    log(f"  API URL: {item['url']}")

            browser.close()

            # ── Process DOM data ───────────────────────────────────────────────
            # Build book name map from headers
            # headers: [Player, Best Odds, Consensus, Book1, Book2, ...]
            book_names = []
            for h in headers_data:
                if h["bookName"] and h["bookName"] not in (
                    "Player",
                    "Best Odds",
                    "Consensus",
                    "",
                ):
                    book_names.append(h["bookName"])
                elif h["text"] in ("Best Odds", "Consensus"):
                    book_names.append(h["text"])

            log(f"Identified book columns: {book_names}")

            for row in rows_data:
                player_name = row["playerName"]
                team = row["team"]
                book_cells = row["bookCells"]

                log(
                    f"  Processing: {player_name} ({team}) — {len(book_cells)} book cells"
                )

                if not book_cells:
                    log("    SKIP: no book cells")
                    continue

                # Cell 0 = Best Odds, Cell 1 = Consensus, Cell 2+ = individual books
                best_cell = book_cells[0] if len(book_cells) > 0 else None
                consensus_cell = book_cells[1] if len(book_cells) > 1 else None
                individual_books = book_cells[2:] if len(book_cells) > 2 else []

                # Parse best odds
                best_over_line = (
                    parse_line_str(best_cell["overLine"]) if best_cell else None
                )
                best_over_odds = (
                    parse_odds_str(best_cell["overOdds"]) if best_cell else None
                )
                best_under_line = (
                    parse_line_str(best_cell["underLine"]) if best_cell else None
                )
                best_under_odds = (
                    parse_odds_str(best_cell["underOdds"]) if best_cell else None
                )

                # Parse consensus
                cons_over_line = (
                    parse_line_str(consensus_cell["overLine"])
                    if consensus_cell
                    else None
                )
                cons_over_odds = (
                    parse_odds_str(consensus_cell["overOdds"])
                    if consensus_cell
                    else None
                )
                cons_under_line = (
                    parse_line_str(consensus_cell["underLine"])
                    if consensus_cell
                    else None
                )
                cons_under_odds = (
                    parse_odds_str(consensus_cell["underOdds"])
                    if consensus_cell
                    else None
                )

                # Use best odds line as the primary book line
                book_line = (
                    best_over_line
                    or best_under_line
                    or cons_over_line
                    or cons_under_line
                )

                log(
                    f"    Best: o{best_over_line} {best_over_odds} / u{best_under_line} {best_under_odds}"
                )
                log(
                    f"    Consensus: o{cons_over_line} {cons_over_odds} / u{cons_under_line} {cons_under_odds}"
                )

                # Parse individual books
                books = []
                for i, cell in enumerate(individual_books):
                    book_name = (
                        book_names[i + 2] if i + 2 < len(book_names) else f"Book{i + 1}"
                    )
                    over_line = parse_line_str(cell["overLine"])
                    over_odds = parse_odds_str(cell["overOdds"])
                    under_line = parse_line_str(cell["underLine"])
                    under_odds = parse_odds_str(cell["underOdds"])
                    if over_line is not None or under_line is not None:
                        books.append(
                            {
                                "book": book_name,
                                "over_line": over_line,
                                "over_odds": over_odds,
                                "under_line": under_line,
                                "under_odds": under_odds,
                            }
                        )
                        log(
                            f"    {book_name}: o{over_line} {over_odds} / u{under_line} {under_odds}"
                        )

                props_data.append(
                    {
                        "player_name": player_name,
                        "team": team,
                        "book_line": book_line,
                        "best_over_odds": best_over_odds,
                        "best_under_odds": best_under_odds,
                        "consensus_over_line": cons_over_line,
                        "consensus_over_odds": cons_over_odds,
                        "consensus_under_line": cons_under_line,
                        "consensus_under_odds": cons_under_odds,
                        "books": books,
                    }
                )

    except Exception as e:
        log_err(f"Browser error: {e}")
        import traceback

        traceback.print_exc(file=sys.stderr)
        sys.exit(2)

    return props_data


# ── Entry point ────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Scrape Action Network MLB strikeout prop lines"
    )
    parser.add_argument(
        "--date", default=None, help="Date in YYYY-MM-DD format (default: today)"
    )
    parser.add_argument(
        "--output", default=None, help="Output JSON file path (default: stdout)"
    )
    parser.add_argument(
        "--pitcher",
        default=None,
        help="Filter to specific pitcher name (partial match, case-insensitive)",
    )
    args = parser.parse_args()

    log("=== ActionNetworkPropsScraper START ===")
    log(f"Date filter: {args.date or 'today'}")
    log(f"Pitcher filter: {args.pitcher or 'all'}")

    props = scrape_action_network_strikeouts(date_str=args.date)

    if not props:
        log_err("No props data scraped. Exiting with code 1.")
        sys.exit(1)

    log(f"Scraped {len(props)} pitcher props")

    # Apply pitcher filter if specified
    if args.pitcher:
        filter_lower = args.pitcher.lower()
        props = [p for p in props if filter_lower in p["player_name"].lower()]
        log(f"After pitcher filter '{args.pitcher}': {len(props)} props")

    output = {
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "props": props,
    }

    output_json = json.dumps(output, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output_json)
        log(f"Output written to: {args.output}")
    else:
        print(output_json)

    log("=== ActionNetworkPropsScraper DONE ===")
    sys.exit(0)


if __name__ == "__main__":
    main()
