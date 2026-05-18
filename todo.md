# AI Sports Betting Models - TODO

## Session: 2026-04-16 - NHL PL Sign Fix (All Rendering Paths)

- [x] Audit ALL GameCard rendering paths that display NHL book puck line label
- [x] Move odds-authoritative correction to top of GameCard component (awayBookSpread/homeBookSpread reassigned globally)
- [x] Remove redundant _correctedAwaySpread block from DesktopMergedPanel path
- [x] TypeScript: 0 errors
- [x] Tests: 487/487 passing

- [x] Initialize project scaffold
- [x] Upgrade to full-stack (web-db-user)
- [x] Add model_files and games tables to schema
- [x] Run db:push to sync schema
- [x] Build storage helpers for CSV file upload
- [x] Add tRPC router: files.upload, files.list, files.delete
- [x] Add tRPC router: games.list (reads from DB)
- [x] Build XLSX/CSV parser on server to ingest uploaded files into games table
- [x] Build Login page (Manus OAuth sign-in)
- [x] Build Dashboard page (MODEL PROJECTIONS with game cards, sport tabs, date grouping)
- [x] Build File Manager page (upload CSV/XLSX, list files with status, delete)
- [x] Wire App.tsx routes: /, /login, /files
- [x] Dark theme CSS tokens (matching reference site)
- [x] Upload 62 NCAAM team logos to S3 with original filenames (NCAAM/teamname.png)
- [x] Build TeamLogo component (CDN logos + colored badge fallback)
- [x] Write vitest tests for fileParser (13 tests passing)
- [x] Re-upload logos with original filenames (no hash suffix)
- [x] Save checkpoint and deliver
- [x] Inspect Google Sheets structure and verify public CSV export access
- [x] Build server-side Google Sheets sync (fetch latest sheet, parse, upsert games)
- [x] Add tRPC procedures: sheets.syncLatest (public) and sheets.syncAll (protected)
- [x] Add auto-sync on dashboard load + manual refresh button with status indicator
- [x] Save checkpoint with Sheets integration
- [x] Remove NFL and NCAAF tabs from dashboard sport selector
- [x] Verify all 62 NCAAM logos are present in S3 storage
- [x] Re-upload any missing logos (none missing)
- [x] Ensure teamLogos.ts has all 62 entries in A-Z order
- [x] Rebuild GameCard to match reference screenshot (date header, BOOKS/MODEL LINE/MODEL O/U columns, team rows with logo+spread+O/U pills, edge footer)
- [x] Rewrite GameCard to match reference implementation (edge color scale, consensus column, dark pills, formatTeamName, framer-motion) with Google Sheets data
- [x] Scrape ESPN NCAAM teams page and build slug→ESPN logo URL map
- [x] Update GameCard to use ESPN CDN logo URLs instead of local PNGs
- [x] Add espn_teams table to DB schema (slug, espn_id, display_name, conference, sport)
- [x] Build ESPN scraper service (scrapes on server startup + daily schedule)
- [x] Add tRPC procedure to expose team data to frontend
- [x] Update TeamLogo to use ESPN CDN URLs resolved from DB dynamically
- [x] Remove static teamLogos.ts hardcoded map
- [x] Delete local PNG files from webdev-static-assets (S3 delete API not available)
- [x] Remove bottom footer from dashboard
- [x] Change sync toast to "ALL NCAAM Games Updated"
- [x] Fix logo visibility on dark background (changed mix-blend-mode from multiply to screen)
- [x] Create hardcoded static ESPN team ID map (espnTeamIds.ts) for all 62 NCAAM teams
- [x] Fix incorrect ESPN IDs (portland_state: 2502, sacramento_state: 16, and 12 others)
- [x] Update GameCard to use static ESPN ID map as primary logo source (no DB/API needed)
- [x] All 16 team logos loading correctly across 8 game cards
- [x] Remove Model Files page (/files route) from App.tsx
- [x] Remove upload button from Dashboard header
- [x] Remove any nav links pointing to /files
- [x] Change top-left branding text from "AI MODELS" to "PREZ BETS AI"
- [x] Keep "MODEL PROJECTIONS" title absolutely centered in the header
- [x] Redesign header to be more organized and professional
- [x] Ensure header displays correctly on mobile (no overflow, proper spacing, centered title)
- [x] Header: single centered line with chart icon + "PREZ BETS" (bold white) + "AI MODEL PROJECTIONS" (light gray), user icon right, larger font on desktop
- [x] Remove NBA, MLB, NHL tabs — keep only NCAAM
- [x] Reduce excessive whitespace — tighten header padding, date header, card gaps
- [x] Fix sticky date row gap — must sit flush against header when scrolling
- [x] Set Barlow Condensed as the uniform global font throughout the site
- [x] Show two-line team names in GameCard: school name on top, nickname on bottom
- [x] Enforce strict single-line per row for school name and nickname (no wrapping, truncate with ellipsis)
- [x] Widen name column so no school names are ever truncated
- [x] Update Google Sheets sync to pull from 03-03-2026 tab
- [x] Fix fileParser to be header-name-driven (handles any column order)
- [x] Add teamNormalizer to convert display names to snake_case slugs
- [x] Expand ESPN ID map and team nicknames map to cover all NCAAM teams (200+ teams)
- [x] Remove March 2nd game data from database (only March 3rd data remains, 44 games)
- [x] Update DB schema: add username, passwordHash, role (owner/admin/user), hasAccess, expiryDate to users table
- [x] Backend: custom login (email+password), register, and owner-only user CRUD procedures
- [x] Frontend: Owner-only User Management panel (create/edit/delete accounts)
- [x] Add "User Management" to profile dropdown for owner role only
- [x] Create @prez owner account (aisportbettingcontact@gmail.com, Tailered101$, lifetime access)
- [x] Replace Manus OAuth with custom email/password authentication on Login page
- [x] Add auth guards to Dashboard and UserManagement pages
- [x] Test login flow end-to-end with @prez credentials
- [x] Test User Management CRUD (create, delete)
- [x] Fix AgeModal text: replace "EdgeGuide" with "Prez Bets AI"
- [x] Add "Last Updated" timestamp next to refresh button in date row
- [x] Add show/hide password toggle to UserManagement create/edit account modal
- [x] Add termsAccepted (boolean) and termsAcceptedAt (timestamp) to app_users DB schema
- [x] Add tRPC procedure: appUsers.acceptTerms (sets termsAccepted=true, termsAcceptedAt=now)
- [x] Update Dashboard: show Age modal only if termsAccepted is false/null (DB-backed, not sessionStorage)
- [x] Call acceptTerms mutation when user clicks "I Understand & Accept"
- [x] Add TERMS column to User Management dashboard table showing accepted/pending status
- [x] Redesign Home page as paywall landing (feature highlights + inline login panel, no redirect)
- [x] Remove Manus OAuth sign-in button and all Manus branding from public-facing pages
- [x] Add Stay Logged In checkbox to login form (extends session to 90 days vs 1 day)
- [x] Gate dashboard behind app_session cookie check; redirect unauthenticated users to home
- [x] Add per-column filter/sort dropdowns to User Management table (sort asc/desc + multi-select filter per column)
- [x] Add search field to User Management (filter by username or email)
- [x] Fix Role sort hierarchy: Owner→Admin→User (asc), User→Admin→Owner (desc)
- [x] Fix Expiry sort: ascending = soonest first, Lifetime at bottom; descending = Lifetime at top
- [x] Enforce expiry date: block login if current time > expiryDate (set hasAccess=false automatically)
- [x] Add session-level expiry check: even if already logged in, redirect expired users out of dashboard
- [x] Test expiry enforcement with a test account (expired date)
- [x] Show Last Sign In as HH:MM AM/PM EST in User Management table
- [x] Show expiry dates with full precision and EST label in User Management table
- [x] Add 3 hours to all existing non-lifetime expiry dates in the database
- [x] Fix game feed: only show games for today's date (EST), remove previous days' games automatically
- [x] Fix todayEst() date format mismatch: was MM-DD-YYYY, now YYYY-MM-DD to match DB storage (parseDate output)
- [x] Add daily 6am EST cron job to delete games older than today (purge previous day's games automatically)
- [x] Replace all user-facing "Google Sheets" references with "Model Database"
- [x] Scrape WagerTalk for 40 March 4 NCAAM games (22 regular season + 18 conference tournament)
- [x] Add gameType, conference, and publishedToFeed fields to games DB schema
- [x] Import 40 March 4 games with Consensus odds, blank model projections, and unpublished status
- [x] Build owner-only Publish Model Projections page with editable game rows and publish toggles
- [x] Add Publish Projections to profile dropdown (owner-only)
- [x] Update public games.list to only return publishedToFeed=true games
- [x] Redesign PublishProjections page to match GameCard feed style with inline MODEL LINE and MODEL O/U inputs
- [x] Enforce strict owner-only access on PublishProjections (frontend redirect + backend ownerProcedure)
- [x] Show all 40 March 4 games on Dashboard feed with book lines (model columns empty until published)\n
- [x] Debug: March 4 games not showing on feed — fixed by using gte(today) instead of eq(today)
- [x] Show March 3 and March 4 games on feed grouped by date (March 4 below March 3)
- [x] Populate ESPN team logos for all 40 March 4 WagerTalk games
- [x] Add team nicknames for all 40 March 4 WagerTalk schools to teamNicknames.ts
- [x] Fix Oral Roberts ESPN ID (was 2497, now 198)
- [x] Replace NaN with '-' for games without book lines on GameCard
- [x] Replace partial ESPN ID map with complete mapping of all NCAAM teams from ESPN (362 teams)
- [x] Regenerate teamNicknames.ts with correct school names and mascot nicknames for all 362 NCAAM teams
- [ ] Add missing ESPN IDs for teams not in bulk API (Lindenwood, etc.)
- [x] Add UL Lafayette (309), Georgia Southern (290), Lindenwood (2815) ESPN IDs to map
- [x] Full audit: confirm all 40 March 4 games, lines/totals, and school names/nicknames
- [x] Delete all March 3rd games from DB permanently
- [x] Remove Google Sheets sync code (sheetsSync.ts, syncLatest/syncAll procedures, dashboard auto-sync call)
- [x] Remove Sheets-related UI (sync button, status indicator) from Dashboard
- [x] Reorder Publish Projections games to match WagerTalk order (by wagerTalkId / sortOrder)
- [ ] Store VSIN_EMAIL and VSIN_PASSWORD as app secrets
- [ ] Update vsinScraper to auto-login with stored credentials
- [ ] Test Refresh Books end-to-end
- [x] Fix refresh progress count to use VSiN game count (not DB game count)
- [x] Add vsinRowIndex to ScrapedOdds and write it as sortOrder to DB during refresh
- [x] Display games in VSiN order on Publish Projections page and public feed
- [x] Build smart auto-refresh cron: update today's odds, auto-import tomorrow's games as unpublished stubs, ignore past dates
- [x] Expose last-refresh result via tRPC games.lastRefresh query
- [x] Remove manual Refresh Books button from Publish Projections UI
- [x] Show last-auto-refreshed timestamp on Publish Projections page
- [x] Sort Publish Projections and public feed by VSiN sortOrder
- [x] Investigate NCAA scoreboard page structure for start time extraction
- [x] Build ncaaScoreboard.ts scraper: fetch games with EST start times, match to DB slugs
- [x] Integrate NCAA start time scraper into auto-refresh cron
- [x] Apply NCAA start times to existing March 4 DB games
- [x] Fix edge footer: display the book line (the line with the edge), not the model line; recalculate spread and total edge correctly
- [x] Pull James Madison game spread from VSiN
- [x] Fix Georgia Southern opponent: TBD → old_dominion
- [x] Audit and correct all March 4 start times in EST
- [x] Audit and verify edge calculation math in GameCard.tsx for all scenarios
- [ ] Verify every March 4 game's book spread/total in DB against live VSiN page
- [ ] Fix Georgia Southern book spread to match current VSiN line (+2.5/-2.5)
- [ ] Import 9 missing VSiN games as unpublished stubs (UW-Milwaukee, Cleveland ST, Stonehill, Wagner, Chicago ST, N Florida, Florida ST, Ark-Little Rock, Colorado ST)
- [ ] Fix alias maps in vsinScraper.ts and ncaaScoreboard.ts for the 9 new teams
- [x] Fix duplicate game entries in DB (Rutgers vs Michigan State, lemoyne, c_conn_st, w_georgia)
- [x] Add michigan-st, c-conn-st, and other missing aliases to HREF_SLUG_MAP in vsinScraper.ts
- [x] Add slugsMatch() fuzzy fallback to vsinAutoRefresh to prevent future duplicate inserts
- [x] Purge 4 duplicate wrong-slug rows from DB (lemoyne, c_conn_st, w_georgia, michigan_st)
- [x] Fix PublishProjections gameDate to be dynamic (today PST, not hardcoded 2026-03-04)
- [x] Add VSiN odds status indicator (green/red dot) on EditableGameCard header
- [x] Fix formatMilitaryTime in PublishProjections to handle TBD gracefully (returns "TBD" not "12:BD AM EST")
- [x] Add withOddsCount / missingOddsCount stats row to PublishProjections header
- [x] Verify games display in VSiN page order (sortOrder) on Dashboard and PublishProjections
- [ ] Add search bar to public feed (Dashboard) filtering by school name and nickname
- [ ] Add date picker to Publish Projections page (default today PST, navigate to future dates)
- [ ] Add Refresh Now button to Publish Projections to manually trigger VSiN + NCAA re-scrape
- [ ] Load all NCAA games for 03/04-03/10 on Publish Projections (not just VSiN games)
- [ ] Fix TBA -> TBD for teams without confirmed start times
- [ ] Ensure all times display in EST on both Feed and Publish Projections
- [x] Feed: only show games with live VSiN odds (awayBookSpread or bookTotal not null)
- [x] Publish Projections: block publish toggle for games without live VSiN odds
- [x] Publish All: only publish games that have live VSiN odds
- [x] Feed: show ALL games with live VSiN odds (remove publishedToFeed filter from listGames)
- [x] GameCard: show model projections (MODEL LINE/O/U/edge) only when publishedToFeed=true, otherwise show dashes
- [x] Fix missing team logos in PublishProjections EditableGameCard (logos show on feed but not admin page)
- [x] Feed: replace search icon button with always-visible search input bar between header and first date group; dropdown results ordered by start time EST
- [x] Feed search: move bar into sticky header, placeholder "Search for Games", 3-at-a-time dropdown with scroll, team logo+name layout, solid bg overlay, highlight animation on select
- [x] Fix "miami fl" → "Miami (FL)" in teamNicknames.ts; desktop dropdown full-width row layout; mobile stacked
- [x] Fix gap between sticky search bar and first date banner (no gap on desktop and mobile)
- [ ] Fix search dropdown: TEAM_NAMES lookup for all slugs (no lowercase slug fallback), home team Logo+School+Nickname layout, Miami (FL) correct display
- [x] Migrate DB to canonical CSV dbSlugs (121 rows updated), purge non-365-team games (223 rows deleted)
- [x] Generate shared/ncaamTeams.ts registry from authoritative 365-team CSV
- [x] Refactor GameCard.tsx to use registry getTeamByDbSlug() for names/nicknames/logos
- [x] Refactor Dashboard.tsx search to use registry for team names/logos
- [x] Add server-side VALID_DB_SLUGS filtering to games.list, games.listStaging, games.listPublished
- [x] Update ncaaScoreboard.ts to use registry BY_NCAA_SLUG as primary lookup
- [x] Update vsinScraper.ts: remove HREF_SLUG_FALLBACK legacy map, use BY_VSIN_SLUG registry as sole lookup
- [x] Update vsinAutoRefresh.ts: replace legacy slugsMatch() alias map with registry-based lookup
- [x] Update vsinAutoRefresh.ts: replace hardcoded 03/04-03/10 date range with dynamic 7-day rolling window
- [x] Update refreshBooksRoute.ts: replace matchTeam() name-based matching with slug-based matching
- [x] Remove dead matchTeam/scrapeVsinOdds imports from routers.ts
- [x] Delete orphaned teamNicknames.ts (no longer imported anywhere)
- [x] Update vsinScraper.test.ts: remove normalizeTeamName tests, update matchTeam tests
- [x] All 24 tests passing after refactoring

## Pipeline Audit Fixes (2026-03-06)
- [x] Fix epochToEst() DST bug in ncaaScoreboard.ts (hardcoded UTC-5 breaks after March 8 DST change, should use Intl)
- [x] Remove deprecated matchTeam() and its 100-line abbrevMap from vsinScraper.ts (not called anywhere)
- [x] Fix stale comments in vsinAutoRefresh.ts (still references "03/04-03/10" in 3 places)
- [x] Fix per-date log count in vsinAutoRefresh.ts (uses different filter than actual update/insert logic)
- [x] Delete orphaned sheetsSync.ts (not imported anywhere, all references removed)
- [x] Delete orphaned csvParser.ts (only imported by sheetsSync.ts which is dead)
- [x] Delete orphaned teamNormalizer.ts — replaced with inline registry lookup in fileParser.ts
- [x] Remove NCAA_ALIAS entirely from ncaaScoreboard.ts — registry is sole lookup, non-D1 teams filtered by VALID_DB_SLUGS
- [x] Fix refreshBooksRoute.ts: hardcoded default date "2026-03-04" replaced with dynamic today PST
- [ ] Consolidate ESPN logo source: teams.list DB query is redundant since registry has NCAA logos for all 365 teams (deferred — ESPN sync still used as fallback)

## Publish Projections + Feed Correctness (2026-03-06)
- [ ] Audit and fix duplicate game sources in vsinAutoRefresh (contestId + slug dedup)
- [ ] Add DB-level unique constraint on (gameDate, awayTeam, homeTeam) to prevent duplicates at insert
- [ ] Fix game ordering: sort by startTimeEst (earliest to latest) in all DB queries and frontend
- [ ] Ensure Publish Projections page shows NCAA name, nickname, logo URL from registry
- [ ] Ensure Feed shows NCAA name, nickname, logo URL from registry
- [ ] Enforce 365-team filter on all game queries (server-side, not just at insert time)
- [ ] Fix start time display: always show EST, never TBD on Feed
- [ ] Populate all NCAA.com games where both teams are in 365-team registry

## Midnight Game Date + Start Time Fixes (2026-03-06)
- [ ] Fix midnight game date: 12:00 AM ET games (West Coast late-night) should be assigned to the prior calendar day
- [ ] Investigate Youngstown St. vs Robert Morris showing 12:00 AM ET — likely TBD stored as 00:00
- [ ] Fix epochToEst() to return "TBD" instead of "00:00" when NCAA API returns no start time
- [ ] Clean up existing DB rows with bad 00:00 start times

## Midnight Game Header Display Fix (2026-03-06)
- [x] GameCard: when startTimeEst = "00:00", display header date as gameDate + 1 day (next ET calendar day), e.g. "Fri, Mar 6 · 12:00 AM ET"
- [x] EditableGameCard (PublishProjections): same fix — show next-day ET date in header for midnight games
- [x] Game remains grouped under gameDate (Thu, Mar 5) in the feed — only the header label changes

## Midnight Game Sort Order Fix (2026-03-06)
- [x] DB queries: treat startTimeEst = "00:00" as "24:00" in ORDER BY so midnight games sort last on the day's slate

## NBA Team Registry (2026-03-06)
- [ ] Read NBAMapping-MASTERSHEET.csv and inspect NBA.com slug/logo URL patterns
- [ ] Build shared/nbaTeams.ts registry (same structure as ncaamTeams.ts)
- [ ] Add nba_teams DB table to drizzle/schema.ts and push migration
- [ ] Wire up NBA registry to server (db.ts helpers, routers.ts procedure)
- [ ] Run tests and save checkpoint

## ESPN Removal + NBA Teams (2026-03-06)
- [x] Drop espn_teams DB table and remove from drizzle/schema.ts
- [x] Remove listEspnTeams, getEspnTeamBySlug, upsertEspnTeam helpers from db.ts
- [x] Remove all ESPN imports from routers.ts and any other files
- [x] Delete espnScraper.ts; TeamLogo.tsx updated to use registry directly
- [x] Add upsertNbaTeams, listNbaTeams, getNbaTeamByDbSlug, getNbaTeamByNbaSlug helpers to db.ts
- [x] Seed nba_teams table from NBA_TEAMS registry (30 teams inserted)
- [x] Add nbaTeams.list and nbaTeams.byDbSlug tRPC procedures to routers.ts

## NBA Data Pipeline (2026-03-07)
- [ ] Inspect NBA.com/schedule API endpoint structure
- [ ] Inspect VSiN NBA betting-splits page structure
- [ ] Build nbaScoreboard.ts — NBA.com schedule scraper with registry mapping
- [ ] Build nbaVsinScraper.ts — VSiN NBA betting splits scraper
- [ ] Build nbaAutoRefresh.ts — merge scoreboard + odds, upsert games table
- [ ] Wire up to server startup cron and tRPC refresh procedure
- [ ] Run tests and save checkpoint

## League Logos + Sport Filter (2026-03-07)
- [ ] Download NCAA and NBA league SVG logos and upload to CDN
- [ ] Store league logos in shared/leagues.ts registry
- [ ] Add sport field (ncaam | nba) to games table schema and push migration
- [ ] Update all game queries to accept optional sport filter
- [ ] Add NCAAM/NBA sport filter toggle to Dashboard feed
- [ ] Add NCAAM/NBA sport filter toggle to Publish Projections page
- [ ] Persist selected sport in URL query param or localStorage

## NBA Pipeline + Sport Filter Completion (2026-03-07)
- [x] Rebuilt nbaTeams.ts from NBAMapping-MASTERSHEET.csv (authoritative source)
- [x] Built nbaScoreboard.ts — NBA.com CDN JSON schedule scraper
- [x] Built nbaVsinScraper.ts — VSiN NBA betting splits scraper (same structure as NCAAM)
- [x] Updated vsinAutoRefresh.ts to handle NBA games alongside NCAAM
- [x] NBA games now auto-refresh every 30 min (13 live today + 46 schedule-only for next 7 days)
- [x] Added NCAAM/NBA sport filter toggle with logos to Dashboard feed
- [x] Added NCAAM/NBA sport filter toggle with logos to Publish Projections page
- [x] publishAll mutation now scoped to selected sport
- [x] GameCard, SearchResultRow, TeamBadge all resolve NBA team names/logos
- [x] normalizeEdgeLabel resolves NBA team names in edge verdict display

## Betting Splits Feature (2026-03-07)
- [ ] Audit existing DB schema for splits columns
- [ ] Add splits columns to DB schema (spreadAwayBetsPct, spreadAwayMoneyPct, totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct)
- [ ] Run db:push migration
- [ ] Update vsinScraper.ts to parse and store all 6 splits fields
- [ ] Update nbaVsinScraper.ts to parse and store all 6 splits fields
- [ ] Update db.ts query helpers to return splits fields
- [ ] Update tRPC procedures to expose splits data
- [ ] Build BettingSplitsPanel component (side-by-side with model projections)
- [ ] Integrate splits panel on Dashboard feed game cards (expandable)
- [ ] Add splits view to Publish Projections page

## Betting Splits Feature (2026-03-07) - COMPLETED
- [x] Add 8 new DB columns (spreadAwayBetsPct, spreadAwayMoneyPct, totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct, awayML, homeML)
- [x] Run db:push migration to apply columns
- [x] Update vsinScraper.ts to parse 4 NCAAM splits fields (Bets%, Money% for spread and total)
- [x] Update nbaVsinScraper.ts to parse 6 NBA splits fields + ML odds
- [x] Fix NBA column order (Handle=money% is td[2]/td[5]/td[8], Bets% is td[3]/td[6]/td[9])
- [x] Update updateBookOdds in db.ts to write splits fields
- [x] Update vsinAutoRefresh.ts to pass splits to updateBookOdds for both NCAAM and NBA
- [x] Build BettingSplitsPanel component with animated bars, section headers, VSiN attribution
- [x] Integrate BettingSplitsPanel into GameCard with collapsible toggle
- [x] Integrate BettingSplitsPanel into PublishProjections with collapsible toggle
- [x] Verify splits data populated in DB (NCAAM: 4 fields, NBA: 6 fields + ML odds)

## Team Colors Database (2026-03-07)
- [x] Add primaryColor/secondaryColor/tertiaryColor columns to nba_teams table
- [x] Create ncaam_teams table with all team info + color columns
- [x] Run db:push migration (migration 0016)
- [x] Seed 365 NCAAM teams with colors from master CSV
- [x] Update 30 NBA teams with colors from NBA master CSV
- [x] Add getTeamColors / getGameTeamColors helpers to db.ts
- [x] Add teamColors.getForGame tRPC procedure to routers.ts
- [x] Rewrite BettingSplitsPanel to fetch colors from DB via tRPC
- [x] No hardcoded colors or CSV references in app code

## Team Colors Database (2026-03-07)
- [x] Add primaryColor/secondaryColor/tertiaryColor columns to nba_teams table
- [x] Create ncaam_teams table with all team info + color columns
- [x] Run db:push migration (migration 0016)
- [x] Seed 365 NCAAM teams with colors from master CSV
- [x] Update 30 NBA teams with colors from NBA master CSV
- [x] Add getTeamColors / getGameTeamColors helpers to db.ts
- [x] Add teamColors.getForGame tRPC procedure to routers.ts
- [x] Rewrite BettingSplitsPanel to fetch colors from DB via tRPC
- [x] No hardcoded colors or CSV references in app code

## Betting Splits Always-Visible Redesign (2026-03-07)
- [x] Redesign BettingSplitsPanel: always-visible, two-color bars, team abbreviations, Spread+Total (NCAAM) / Spread+Total+ML (NBA)
- [x] Restructure GameCard: splits panel left, model projections right on desktop; stacked on mobile
- [ ] Apply same layout to PublishProjections page (deferred — PublishProjections uses EditableGameCard, separate component)

## GameCard Layout Fix (2026-03-07)
- [x] Fix GameCard flex layout: splits column must be constrained to fixed width on desktop so model projections are always visible

## GameCard Layout Restructure (2026-03-07)
- [x] Move betting splits to right side, model projections to left side, 50/50 split
- [x] Polish overall card spacing, alignment, and justification

## GameCard Whitespace Fix (2026-03-07)
- [x] Remove dead vertical whitespace in projections column — both columns must fill height equally with no empty gaps

## BettingSplitsPanel Header Redesign (2026-03-07)
- [x] Center "BETTING SPLITS" in h1 style
- [x] Center "SPREAD" in h2 style with "{Away Team} {Away Spread}" left and "{Home Team} {Home Spread}" right using live book spread
- [x] Center "TOTAL" in h2 style with "OVER {Total}" left and "UNDER {Total}" right using live O/U
- [x] Ensure % bars are accurate to each corresponding side

## BettingSplitsPanel Black Bar Fix (2026-03-07)
- [x] No bar should ever be black in any sport/league — if primary color is black/very dark, fall back to secondary color

## BettingSplitsPanel Adaptive Bar Text Color (2026-03-07)
- [x] When bar color is white/very light, switch in-bar % text to black for readability

## BettingSplitsPanel WCAG Bar Text Contrast (2026-03-07)
- [x] Replace simple luminance threshold with WCAG contrast-ratio check for maximum bar text readability

## Splits Auto-Refresh Integration (2026-03-07)
- [x] Auto-refresh script: extract and persist betting splits alongside lines/odds on every tick
  - NCAAM update path: already writing all 4 splits fields
  - NCAAM insert path: fixed — now writes all 4 splits fields on first insert
  - NBA update path: already writing all 6 splits fields + ML odds
  - NBA insert path: already writing all 6 splits fields + ML odds
- [x] Refresh Now button: also update betting splits for each game when triggered
  - refreshBooksRoute.ts rewritten: scrapes NCAAM + NBA in parallel, writes all splits fields in updateBookOdds call

## Splits Timestamp + EditableGameCard Splits (2026-03-07)
- [x] Add global "Splits updated X min ago" timestamp at top of Dashboard feed (not per-card)
- [x] Add BettingSplitsPanel to EditableGameCard on Publish Projections page (50/50 layout, splits right, inputs left)

## Splits Timestamp Styling (2026-03-07)
- [x] Make "Updated ## min ago" green (#39FF14), always visible, clock icon, format: "Updated ## min ago"

## BettingSplitsPanel UX Polish (2026-03-07)
- [x] Swap row order: TICKET % on top, MONEY % on bottom
- [x] Rename "BET %" label to "TICKET %"
- [x] Make label text white
- [x] Add border/outline to bars (pills) and to the split divider line between the two halves

## BettingSplitsPanel Color Similarity Fix (2026-03-07)
- [x] Detect when away/home bar colors are too similar; cycle away team through secondary/tertiary/fallback until visually distinct
- [x] No white or black allowed on bars (isUnusableBarColor blocks both black <8% luminance and white >90% luminance)
- [x] Home team keeps primary unless it is white or black

## BettingSplitsPanel Color Assignment Audit (2026-03-07)
- [x] Verify each bar half uses only the hex color for the correct team (away left, home right) — no cross-contamination
- [x] Fix darkness threshold: lowered from 8% to 4% so deep purples (High Point) and dark maroons (Texas A&M) are allowed through

## Missing Team Colors (2026-03-07)
- [ ] Identify all NCAAM and NBA teams with null primaryColor in the DB
- [ ] Populate correct hex colors for all teams missing color data (source: ESPN team pages)

## NCAAM Feed Game Status Filter (2026-03-07)
- [x] Add gameStatus field to games DB schema (enum: 'upcoming' | 'live' | 'final')
- [x] Run db:push migration
- [x] Update ncaaScoreboard.ts NcaaGame interface to include gameStatus from gameState field (P→upcoming, I→live, F→final)
- [x] Update fetchNcaaGames() to return gameStatus on each game
- [x] Update vsinAutoRefresh.ts to write gameStatus on insert and update
- [x] Update db.ts updateNcaaStartTime to also update gameStatus
- [x] Add ALL/Upcoming/LIVE/FINAL filter tabs to Dashboard NCAAM feed
- [x] Wire filter tabs to gameStatus field in games.list tRPC procedure
- [x] Show live game count badge on LIVE tab
- [x] Save checkpoint and deliver

## Publish Projections Game Status Filter (2026-03-07)
- [x] Add ALL/UPCOMING/LIVE/FINAL filter tabs to Publish Projections page (mirrors Dashboard)
- [x] Apply client-side status filter to the game list on Publish Projections
- [x] Show live game count badge on LIVE tab
- [x] Save checkpoint and deliver

## Dashboard Status Filter Multi-Select + FINAL Sort (2026-03-07)
- [x] Change status filter from single-select to multi-select (UPCOMING, LIVE, FINAL can be combined)
- [x] When all three are selected simultaneously, auto-revert to ALL (unselect all)
- [x] When ALL is active, sort FINAL games to the bottom within each date group
- [x] Save checkpoint and deliver

## Live/Final Scores on GameCard (2026-03-07)
- [x] Add awayScore, homeScore, gameClock columns to games DB schema
- [x] Run db:push migration
- [x] Update ncaaScoreboard.ts to extract scores and gameClock from NCAA GraphQL API
- [x] Update vsinAutoRefresh.ts to write scores on insert and update
- [x] Add updateGameScores helper in db.ts
- [x] Wire 5-minute score refresh cycle in vsinAutoRefresh.ts
- [x] Update GameCard to show scores for LIVE and FINAL games
- [x] Show gameClock for LIVE games (e.g. "15:07 1st")
- [x] Save checkpoint and deliver

## GameCard LIVE Header Redesign (2026-03-07)
- [x] Hide date when game is LIVE (date is implied to be today)
- [x] Reformat LIVE score as: AwayLogo AwayScore-HomeScore HomeLogo
- [x] Save checkpoint and deliver

## NBA Live Scores + Status Filter (2026-03-07)
- [x] Add fetchNbaLiveScores() to nbaScoreboard.ts using todaysScoreboard_00.json
- [x] Map NBA teamId → DB slug for score matching (via NBA_BY_TEAM_ID from logo URLs)
- [x] Wire NBA scores/status/clock into vsinAutoRefresh.ts on insert and update
- [x] Add 5-minute NBA score refresh cycle in vsinAutoRefresh.ts
- [x] Add ALL/UPCOMING/LIVE/FINAL filter tabs to Dashboard for NBA sport
- [x] Verify GameCard LIVE/FINAL header displays correctly for NBA games
- [x] Save checkpoint and deliver

## 30-Second Score Refresh (2026-03-08)
- [x] Change SCORE_INTERVAL_MS from 5 minutes to 30 seconds in vsinAutoRefresh.ts
- [x] Update frontend refetchInterval from 5 minutes to 30 seconds in Dashboard
- [x] Save checkpoint and deliver

## GameCard FINAL Header Score Format (2026-03-08)
- [x] Update FINAL game header to use AwayLogo AwayScore-HomeScore HomeLogo (same as LIVE)
- [x] Save checkpoint and deliver

## Fix HTTP 414 Request-URI Too Large (2026-03-08)
- [x] Switch tRPC httpBatchLink to use maxURLLength: 2048 to auto-POST large batches (fixes 414 without breaking single-query GET)
- [x] Save checkpoint and deliver

## Remove Element at PublishProjections line 1065 (2026-03-08)
- [x] Identify and remove the element(s) around line 1065 that user marked "you can get rid of these"
- [x] Save checkpoint and deliver

## Dashboard LIVE+FINAL Sort Order (2026-03-08)
- [x] When LIVE+FINAL selected: LIVE games first (OT top, then period desc, clock asc), FINAL games after sorted by start time asc
- [x] Save checkpoint and deliver

## Fix LIVE Sort Always-On (2026-03-08)
- [x] Apply OT-first LIVE sort in ALL filter states (LIVE only, LIVE+FINAL, ALL), not just LIVE+FINAL
- [x] Save checkpoint and deliver

## Fix parseLiveSortKey for 2OT/3OT (2026-03-08)
- [x] Fixed: gameClock stored as "MM:SS 2OT" — added clockOtMatch regex to handle clock+OT-label format
- [x] Save checkpoint and deliver

## Fix Midnight ET Game Date Grouping (2026-03-08)
- [x] Audit backend: how gameDate is derived from startTime in NCAA and NBA scrapers
- [x] Audit frontend: how date groups are computed from gameDate/startTime in Dashboard.tsx
- [x] Fix backend: removed isMidnightGame prior-day logic; NCAA API already returns games under correct ET calendar date
- [x] Fix frontend: no change needed — groups by gameDate from DB which is now correct
- [x] Fixed DB record: Long Beach St @ Hawaii moved from 2026-03-07 to 2026-03-08
- [x] Test and verify Long Beach St vs Hawaii appears under March 8, not March 7
- [x] Save checkpoint and deliver

## Publish Projections Stats Bar Redesign (2026-03-08)
- [x] Add scoresRefreshedAt field to RefreshResult in vsinAutoRefresh.ts
- [x] Update refreshAllScoresNow() to record scoresRefreshedAt timestamp
- [x] Expose scoresRefreshedAt via lastRefresh tRPC procedure
- [x] Redesign stats bar: X/Y Games with Odds | X/Y Games Modeled | Odds Last Updated HH:MM:SS AM/PM EST | Scores Last Updated HH:MM:SS AM/PM EST
- [x] Save checkpoint and deliver

## Publish Projections: Stats Scoping + Submit + Refresh Now (2026-03-08)
- [x] Fix stats bar: withOddsCount, withModelCount, totalCount scoped to selected league+date (not all games)
- [x] Fix withOddsCount to require BOTH spread AND total (not just either)
- [x] Fix withModelCount to require BOTH spread AND total entered
- [x] Added league+date context label to stats bar header
- [x] Refresh Now now triggers full VSiN odds + all scores (NCAAM + NBA) refresh
- [x] Rename "Submit" for first-time save; after submit, dirty changes show "Save"
- [x] Save checkpoint and deliver

## Publish Projections: New Filter Tabs + Sort Order (2026-03-08)
- [x] Add MISSING ODDS filter tab to status filter row (orange, shows count)
- [x] Add MODELED filter tab to status filter row (green, shows count)
- [x] Add NOT MODELED filter tab to status filter row (amber, shows count)
- [x] Verified sort order: DB query already orders by startTimeEst earliest to latest
- [x] Added date-change reset so filter resets to ALL when navigating dates
- [x] Added contextual empty-state messages for each new filter
- [x] Save checkpoint and deliver

## Publish Projections: Delete Game Feature (2026-03-08)
- [x] Add deleteGame backend procedure (owner-only, hard delete from DB)
- [x] Add DELETE button to game card header (next to Live/No Odds badge)
- [x] Show DELETE button only in MISSING ODDS and NOT MODELED filter views
- [x] High-alert confirmation dialog: irreversible warning before deletion
- [x] Auto-hide MISSING ODDS/MODELED/NOT MODELED row when slate is fully complete (0 missing + 0 not modeled)
- [x] Stats bar counts update immediately after deletion (via listStaging invalidation)
- [x] Save checkpoint and deliver

## Score Refresh: 15s Interval + Real-Time Feed Updates (2026-03-08)
- [x] Change SCORE_INTERVAL_MS from 30s to 15s in vsinAutoRefresh.ts
- [x] Wire Feed page to auto-poll scores every 15s (refetchInterval) without page refresh
- [x] Animate score updates on GameCard: score flashes green with glow for 800ms when it changes
- [x] Save checkpoint and deliver

## GameCard Score App Redesign (2026-03-08)
- [x] Rebuild GameCard: Score-app style score panel (left), Books/Model table (center), Betting Splits (right) on desktop
- [x] Mobile: Score panel (left half), Betting Splits (right half), Model table full-width below
- [x] Upcoming games: show date + start time in score panel instead of scores
- [x] Large per-team score rows: logo + name left, big clamp(22-36px) score number right
- [x] Game clock / LIVE badge / FINAL badge above the score rows
- [x] Full responsive scaling: clamp() font sizes, lg breakpoint for 3-col vs 2-row layout
- [x] Winner highlighting: winning team name bold white, loser muted on FINAL
- [x] Save checkpoint and deliver

## Feed Desktop Full-Width Layout (2026-03-08)
- [x] Remove max-w-3xl constraint from main feed container
- [x] Remove max-w-3xl from header rows (brand, sport filter, status tabs, search bar)
- [x] Game cards fill full screen width edge-to-edge on desktop
- [x] Save checkpoint and deliver

## GameCard Layout Fixes: Full-Width, Compact Model Table, Horizontal Splits (2026-03-08)
- [x] Fix model table: remove justify-between, rows now compact and vertically centered
- [x] Fix score panel: flush left, no internal gaps
- [x] Redesign BettingSplitsPanel: horizontal SPREAD | TOTAL | ML columns on desktop/tablet (≥md)
- [x] Each market column: title, side labels, TICKETS bar on top, HANDLE bar on bottom
- [x] Remove rounded-xl from card, remove border-x from wrapper so cards fill full width edge-to-edge
- [x] Mobile: vertical stacked layout preserved (< md)
- [x] Save checkpoint and deliver

## Add ML Betting Splits to VSiN Scraper (NCAAM + NBA) (2026-03-08)
- [x] Update ScrapedOdds interface to include awayML, homeML, mlAwayBetsPct, mlAwayMoneyPct
- [x] Parse td[7] (ML lines), td[8] (ML tickets), td[9] (ML handle) in vsinScraper.ts
- [x] Confirmed vsinAutoRefresh.ts already writes ML fields to DB on upsert
- [x] Remove isNba guard from BettingSplitsPanel — ML column shows for any sport with data
- [x] Save checkpoint and deliver

## Add NCAAM Team Abbreviations to DB (2026-03-08)
- [x] Add abbrev column to ncaam_teams schema
- [x] Run db:push migration (0019_true_james_howlett.sql)
- [x] Bulk-upsert all abbreviations from provided list (match by vsinName/ncaaName)
- [x] Verified: 365/365 teams matched and updated (0 unmatched)
- [x] Save checkpoint and deliver

## Add NBA Team Abbreviations to DB (2026-03-08)
- [x] Add abbrev column to nba_teams schema
- [x] Run db:push migration (0020_faithful_deathbird.sql)
- [x] Seed all 30 NBA abbreviations
- [x] Verified: 30/30 teams matched (0 unmatched)
- [x] Save checkpoint and deliver

## VSiN Auth + NCAAM ML Splits + OVER/UNDER Label (2026-03-08)
- [x] Log into VSiN via browser and extract session cookies
- [x] Store VSiN credentials as env secrets and update scraper to send auth cookies
- [x] Verify NCAAM ML splits data is now populated after next refresh (8+ games with ML data confirmed)
- [x] Update BettingSplitsPanel: OVER/UNDER on desktop/tablet, O/U on mobile
- [x] Add ML fields to NCAAM updateBookOdds call in vsinAutoRefresh.ts (was missing)
- [x] Save checkpoint and deliver

## NBA VSiN Splits Verification (2026-03-08)
- [x] Verified NBA VSiN page HTML structure matches scraper column mapping (td[0]-td[9])
- [x] Confirmed NBA scraper correctly parses SPREAD (td[1]), TOTAL (td[4]), ML (td[7]) odds
- [x] Confirmed NBA scraper correctly parses Spread splits (td[2]=money, td[3]=tickets)
- [x] Confirmed NBA scraper correctly parses Total splits (td[5]=money, td[6]=tickets)
- [x] Confirmed NBA scraper correctly parses ML splits (td[8]=money, td[9]=tickets)
- [x] Confirmed 10 NBA games with full splits data in DB (all 3 markets populated)
- [x] Confirmed BettingSplitsPanel shows "Over/Under" on desktop/tablet and "O/U" on mobile for NBA
- [x] All 20 tests passing
- [x] Save checkpoint and deliver

## Live Game Visibility Fix (2026-03-08)
- [x] Remove today-only date filter from listGames — show all games that have VSiN odds regardless of date (purge handles cleanup at 6am EST)
- [x] Verified: 114 NCAAM games now visible (90 from 03/07 including 5 live + 24 from 03/08)
- [x] All 20 tests passing
- [x] Save checkpoint and deliver

## Midnight Game Date Fix (2026-03-08)
- [x] Delete duplicate 03/08 Long Beach State @ Hawaii record (id=930320)
- [x] Update 03/07 record (id=1620009) with correct startTimeEst=00:00
- [x] Fix NCAA scraper: fetch next-day midnight games and store them under current day's date
- [x] Fix score refresh: also fetch next-day midnight games for live score updates
- [x] Verified: long_beach_st @ hawaii now shows as date=2026-03-07 startTime=00:00 status=live
- [x] All 20 tests passing
- [x] Save checkpoint and deliver

## BettingSplitsPanel Abbreviation Display (2026-03-08)
- [x] Revert invalid inline styles injected by visual editor on the root div
- [x] Add abbrev field to TeamColors interface and getTeamColors query (server/db.ts)
- [x] Show school abbreviations (e.g., UND, SEAU) next to spread odds in SPREAD section
- [x] Show school abbreviations next to ML odds in ML section
- [x] Falls back to full awayLabel/homeLabel when abbrev is null
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## BettingSplitsPanel Label Formatting (2026-03-08)
- [x] Unbold team abbreviation/name in Spread and ML label rows (fontWeight: 400)
- [x] Put spread value in parentheses: "UND (+11.5)" not "UND +11.5"
- [x] Put ML value in parentheses: "UND (+575)" not "UND +575"
- [x] Rename "Over/Under" section title to "Total" (desktop and mobile)
- [x] Rename "ML" section title to "Moneyline" (desktop and mobile)
- [x] Restructure Total label row: OVER {total#} UNDER left-center-right layout
- [x] Apply to both desktop MarketColumn and mobile MarketSection via isTotalMarket prop
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## GameCard Layout Restructure (2026-03-08)
- [x] Move team scores adjacent to team names (score inline, not pushed to far right)
- [x] Score now sits immediately after team name in a grouped flex container
- [x] Desktop 3-column order confirmed: Score | Book/Model | Betting Splits
- [x] Mobile layout unchanged (score+splits row 1, model table row 2)
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## GameCard Mobile Layout Fix (2026-03-08)
- [x] Restructure mobile layout: Score (row 1) → Model Table (row 2) → Betting Splits (row 3)
- [x] Desktop layout confirmed correct: Score | Model Table | Betting Splits (3 columns)
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## GameCard Always-Horizontal Layout (2026-03-08)
- [x] Remove all responsive stacking — single horizontal 3-column row at ALL screen sizes
- [x] Score | Book/Model Table | Betting Splits always left-to-right, never vertical
- [x] overflow-x: auto on the card wrapper for very small screens
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## ODDS/LINES Title for Model Table (2026-03-08)
- [x] Add "ODDS/LINES" section title to ModelTablePanel, styled same as "BETTING SPLITS" title
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## ODDS/LINES Redesign with BOOK/MODEL Toggle (2026-03-08)
- [x] Add BOOK/MODEL toggle to ODDS/LINES section
- [x] BOOK mode: show VSiN SPREAD, TOTAL (O/U), MONEYLINE for away and home teams
- [x] MODEL mode: show model SPREAD, TOTAL (O/U), MONEYLINE for away and home teams (model ML shows — until schema updated)
- [x] Columns: SPREAD | TOTAL | MONEYLINE (matching Betting Splits layout)
- [x] Equal height alignment via h-full on both columns
- [x] Column headers change color: white for BOOK, green (#39FF14) for MODEL
- [x] Edge verdict shows only in MODEL tab when published
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## ODDS/LINES MODEL Toggle — Edge-Only Values (2026-03-08)
- [x] MODEL mode: only replace the edge side's spread/total/ML value; non-edge side keeps the book line
- [x] Spread: awayModelSpread < awayBookSpread → away has edge (shows model spread); home keeps book spread
- [x] Total: modelTotal < bookTotal → UNDER has edge; modelTotal > bookTotal → OVER has edge
- [x] ML: non-edge side keeps book ML (model ML shows — until schema updated)
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## Mobile GameCard Layout Redesign (2026-03-08)
- [x] Mobile: Score full-width on top, then ODDS/LINES left + BETTING SPLITS right side-by-side below
- [x] Desktop: keep existing 3-column horizontal layout (Score | Odds/Lines | Betting Splits)
- [x] Test and save checkpoint

## ScorePanel Layout — Score Pushed to Far Right (2026-03-08)
- [x] Team rows: logo+name on left, score pushed to far right (justify-between), no whitespace gap
- [x] Large score font, matching reference screenshot style
- [x] Test and save checkpoint

## Mobile Layout v2 — Score+OddsLines top, Splits below (2026-03-08)
- [x] Mobile row 1: Score (left) + ODDS/LINES (right) side-by-side
- [x] Mobile row 2: BETTING SPLITS full-width below
- [x] Desktop: unchanged 3-column layout
- [x] Test and save checkpoint

## BettingSplitsPanel — Always 3-column horizontal on mobile (2026-03-08)
- [x] Remove mobile vertical stacked layout (md:hidden flex-col)
- [x] Use horizontal 3-column layout at all screen sizes (compact mode on mobile)
- [x] Test and save checkpoint

## Two-Page Split: Model Projections + Betting Splits (2026-03-08)
- [ ] Create ModelProjections page: matchup/score + ODDS/LINES only (no splits)
- [ ] Create BettingSplits page: splits data only (no ODDS/LINES) for all leagues
- [ ] Add top-level navigation between the two pages
- [ ] Update App.tsx routes: /projections and /splits
- [ ] Update header nav to link to both pages
- [ ] Test and save checkpoint

## Two Dedicated Pages

- [x] Add mode prop to GameCard (projections / splits / full)
- [x] Create /projections page (ModelProjections) — score + ODDS/LINES only
- [x] Create /splits page (BettingSplitsPage) — score + BETTING SPLITS only
- [x] Register both routes in App.tsx
- [x] Page-tab navigation (Model Projections | Betting Splits) in both page headers

## Prominent Tab Bar Navigation

- [x] Replace small pill tabs with full-width underline tab bar in ModelProjections header
- [x] Replace small pill tabs with full-width underline tab bar in BettingSplits header

## Fix Post-Login Redirect & Dashboard

- [x] Change Home.tsx post-login redirect from /dashboard to /projections
- [x] Redirect /dashboard route to /projections in App.tsx

## Betting Splits Page Layout Fix

- [x] GameCard splits mode: Score on left, BettingSplits table on right (side-by-side)

## BettingSplitsPanel Redesign

- [x] Redesign BettingSplitsPanel: maximized padding, centering, spacing, large values, clear labels

## BettingSplitsPanel Readability Fix

- [x] Fix GameCard splits-mode: give splits panel more width (score narrower)
- [x] Fix BettingSplitsPanel: full-width bars, no-wrap labels, readable at any width

## Mobile Splits Height Fix

- [x] Shrink mobile MarketBlock height to match compact score panel height

## CompactScorePanel Name Display Fix

- [x] CompactScorePanel: show school name for NCAAM, nickname for NBA

## Share/Export Button Removal
- [x] Remove share/export buttons and ShareSheet from GameCard

## BettingSplitsPanel Label Redesign
- [x] Remove current bar labels and replace with AWAY_ABBR (SPREAD) - XX% format for Tickets and Handle rows

## Splits Bar Label Position Fix
- [x] Move ABBR (LINE) labels above each bar; show only % inside the pill

## Mobile Splits Market Toggle
- [x] Add 3-way toggle (SPREAD / ML / TOTAL) to mobile splits panel; show only active market's bars

## Visual Edit Batch (Mar 8)
- [x] BettingSplitsPanel: rename toggle labels to SPREAD/TOTAL/MONEYLINE
- [x] BettingSplitsPanel: fix pill overflow so both % values are always readable with padding
- [x] BettingSplitsPanel: remove market label span (SPR/TOT/ML text left of bars)
- [x] BettingSplits page: unselected tabs use light gray text (not white), selected stays white+bold
- [x] BettingSplits page: NCAAM icon → test tube clipart
- [x] BettingSplits page: NBA icon → money bag clipart
- [x] BettingSplits page: NCAAM/NBA tab selection style → white border only, no neon green fill
- [x] BettingSplits page: fix sticky date header gap when scrolling
- [x] Fix midnight EST game ordering (between March 7 and March 8 games)
- [x] Replace AI MODEL PROJECTIONS tab icon with test tube image
- [x] Replace BETTING SPLITS tab icon with money bag image
- [x] Replace NCAAM filter icon with March Madness logo
- [x] Replace NBA filter icon with NBA logo
- [x] Fix midnight EST game date: remove "pull from next day" logic in vsinAutoRefresh.ts
- [x] Fix frontend effectiveGameDate helper to not subtract a day for midnight games
- [x] Sort FINAL games to the bottom of their date group (after upcoming and live games) on both pages

## Visual Edit Batch (Mar 8 - ML Inputs & EV Grade)
- [ ] PublishProjections: add modelAwayML and modelHomeML editable input fields
- [ ] PublishProjections: wire ML inputs to updateProjections save mutation
- [ ] Backend: extend updateProjections to accept modelAwayML/modelHomeML
- [ ] EdgeVerdict (GameCard): add EV Grade A+–F scale below edge pts display
- [ ] EdgeVerdictLive (PublishProjections): add EV Grade A+–F scale below edge pts display
- [x] Move star/favorite button to left of game clock/start time in ScorePanel status row
- [x] Add neon green (#39FF14) LIVE indicator to the right of the period/clock (only when live, hidden when final/upcoming)
- [x] Add onFavoriteNotify prop to GameCard for in-page notification callback
- [x] Add in-page square notification (FavNotificationBanner) that appears top-right when user favorites a game, auto-dismisses after 4s
- [x] Add Favorites tab button (star icon) to the left of the calendar dropdown in filter bar
- [x] Favorites tab shows active favorite count badge
- [x] Favorites tab feed shows only favorited games (all sports, all dates)
- [x] isFavoriteStillActive() function: favorites expire at 11:00 UTC the day after the game date
- [x] getFavoriteGamesWithDates server helper: returns gameId + gameDate for expiry logic
- [x] getMyFavoritesWithDates tRPC procedure added to favorites router
- [x] Favorites tab hides calendar/sport/search filters and shows "MY FAVORITES" label instead
- [x] Model toggle available in both normal and favorites tab modes
- [x] Remove '⭐ MY FAVORITES' header from Favorites tab feed
- [x] Keep NCAAM/NBA sport buttons and search bar visible when Favorites tab is active (calendar also always visible)
- [x] Auto-dismiss Favorites tab and return user to main feed when activeFavCount drops to 0
- [x] Merge /projections and /splits into unified /feed route
- [x] AI MODEL PROJECTIONS and BETTING SPLITS tabs switch inline on /feed (no page navigation)
- [x] Redirect /projections, /splits, /dashboard to /feed
- [x] Update Home.tsx to redirect to /feed on login
- [x] Remove AI MODEL PROJECTIONS / BETTING SPLITS tab toggle from feed header
- [x] Display both odds/lines table AND betting splits panel on every game card (no tab switching needed)
- [x] Remove activeMainTab state and all tab-switching logic from ModelProjections
- [x] Sticky/frozen score panel on mobile: score column stays fixed left while odds/splits scroll horizontally underneath
- [x] Fix sticky score panel: ensure it fully occludes scrolling odds/splits content (no merged display when scrolling)
- [x] Fix sticky score panel clipping: scrolled content must not bleed through/over the frozen score panel
- [ ] Definitive fix: scrolled content must be fully hidden/clipped behind sticky score panel (no overlap/bleed-through on mobile)
- [x] Redesign Publish Projections mobile card layout: stacked SPREAD/TOTAL/MONEYLINE sections (replaces cramped side-by-side layout that caused input overlap at 375px-428px)
- [x] Fix /feed query error: replace unsupported CASE WHEN ORDER BY with app-level sort in listGames, listGamesByDate, listStagingGames, and listStagingGamesRange
- [x] Mobile GameCard redesign: team abbreviations in score panel, sticky BOOK/MODEL LINES + BETTING MARKET SPLITS + EDGE tab header, date title left-aligned above score, section order EDGE→BOOK ODDS→MODEL PROJECTIONS→SPLITS, toggle dimming behavior
- [ ] Desktop/tablet GameCard: always show full team name + nickname (two lines) in score panel for all sports (NCAAM: school + nickname, NBA: city + team name)
- [x] Implement production-grade structured client-side logging in GameCard (render, tab switch, edge calc, data validation)
- [x] Implement structured server-side logging in routers.ts and db.ts (request tracing, timing, error context, query diagnostics) — server/logger.ts created
- [x] Mobile GameCard OddsTable: BK→BOOK, MDL→MODEL sub-headers; active=white bold, inactive=light gray unbolded
- [x] Mobile GameCard OddsTable: inactive values use light gray 20% opacity (not neon green); active model values use #39FF14 bold full opacity; active book values use white bold
- [x] Mobile GameCard frozen left panel: two-line school+nickname layout (140px panel), ellipsis fallback for long names, score fixed-width 28px column
- [x] Mobile OddsTable: reduce away/home row font by 2pt (clamp down from 13px base)
- [x] Mobile OddsTable: MODEL edge values = #39FF14; non-edge active model = white bold 10% opacity
- [x] Mobile frozen panel: show game clock + period/half/quarter when live (gameClock field, neon green)
- [x] Mobile frozen panel: score flash (#39FF14) only on the team whose score increased (awayScoreFlash/homeScoreFlash)
- [x] Mobile frozen panel: scores precisely vertically centered with their team row (alignItems: center explicit)
- [x] Mobile frozen panel: game clock white font, inline right of LIVE badge; NCAAM 1st→1H format; NBA MM:SS + Q1/Q2/Q3/Q4/HALFTIME
- [x] Mobile frozen panel: team/school name +2pt font size (clamp 10px base), nickname +1pt (clamp 8px base)
- [x] Mobile OddsTable: non-edge active model values white 55% opacity (was 10%)
- [x] Mobile tab bar: active tab = white bold + neon green underline; inactive = gray 45%
- [x] Mobile frozen panel: justifyContent center + alignSelf stretch for full-height vertical centering
- [x] Rebuild mobile OddsTable: always-visible combined table, BOOK gray unbolded, MODEL neon green header, edge=#39FF14, non-edge model=white bold, book=gray 50%, ML underdog + prefix via formatMl()
- [x] OddsTable color/weight fix: BOOK tab=book white bold + model white unbolded 70% (edge=#39FF14 bold); MODEL tab=book white unbolded 70% + model light gray bold 90% (edge=#39FF14 bold); BOOK sub-header white 75% unbolded always
- [x] OddsTable sub-header tab-responsive: BOOK tab=BOOK white bold + MODEL white unbolded; MODEL tab=BOOK white unbolded + MODEL neon green bold
- [x] MODEL sub-header: not neon green or bold when BOOK LINES is active — white unbolded when BOOK active, neon green bold only when MODEL active; modelStyle factory now tab-branched (no edge highlight on BOOK tab)
- [x] MODEL non-edge values: white bold (not light gray) when MODEL tab active
- [x] Clock formatter: HT → HALFTIME always (all sports)
- [x] Frozen panel: away/home rows have minHeight: 36px to match OddsTable py-2 rows for precise vertical alignment
- [x] Revert incorrect hardcoded color on away spread model span (restored modelStyle factory call)
- [x] Sync frozen panel team rows and OddsTable rows to identical height: both use height: 44px, frozen panel padding: '0 6px', status row paddingTop: 8px paddingBottom: 4px to match OddsTable header height
- [x] Mobile tab bar dual-select: BOOK LINES + MODEL LINES can both be active simultaneously; dual mode = book light gray unbolded + model white bold (non-edge) / neon green bold (edge); sub-headers: BOOK white bold + MODEL neon green bold in dual
- [x] Default tab state = 'dual' (BOOK+MODEL both active) on every card mount and sport switch
- [x] Cannot deselect last active tab (at least one must always be active)
- [x] SPLITS and EDGE are exclusive single-select (cannot combine with BOOK/MODEL or each other)
- [x] OddsTable hidden when SPLITS or EDGE is active (only relevant section data shown)
- [x] Persist tab preference in localStorage (survives page reload and sport switch, 'dual' as default for new users)
- [x] ML edge detection using implied probability; +100 displays as EV (no -100 exists)
- [x] Mobile frozen panel: school/team name font +4pt, nickname +2pt
- [x] Mobile frozen panel: LIVE indicator +6pt, game start time +6pt, clock +6pt, FINAL badge +6pt
- [x] Mobile frozen panel: favorite star icon larger
- [x] School name: truncation fallback to abbreviation on mobile only; desktop/tablet always full name
- [x] Unbold game start time and clock time; keep FINAL bolded
- [x] Period notation: use 1Q/2Q/3Q/4Q, 1H/2H, 1P/2P/3P instead of 1st/2nd/3rd/4th
- [x] Nickname: +1pt bigger, white (#ffffff), not bolded
- [x] School name: semi-bold, white (#ffffff), all-caps; spell out State not St. (fallback to St. if truncated)
- [x] Start time: display EST instead of ET
- [x] Tab bar button text: +1pt font size
- [x] Team logo: add gap/padding between logo and name, center logo vertically between school+nickname, slightly bigger
- [x] ModelProjections date title: +6pt font size, white, bold
- [x] CalendarPicker: show "TODAY" for the active feed date (user local time + 11:00 UTC gate), with timezone debug logging
- [x] ModelProjections header: clean up duplicate fontSize properties, dot white 22px bold, league label 15px all-caps, apply across all feed pages
- [x] Desktop GameCard left panel: widen to fit long names like Oklahoma City without truncation
- [x] Desktop ScorePanel: ResizeObserver-based auto-scaling so team names never truncate at any viewport width
- [x] Responsive audit: automated overflow detection across 16 screen sizes (4 desktop, 4 tablet, 8 mobile)
- [x] Apply universal clamp/auto-scale rules to eliminate all truncation at every breakpoint
- [x] Re-run audit to confirm zero failures across all 16 screen sizes
- [x] Mobile frozen panel: deep diagnostic — measure all team names, find correct font size that fits every name without truncation
- [x] Mobile frozen panel: apply useAutoFontSize hook (same as desktop), remove maxWidth constraints, widen panel
- [x] Update audit script to detect overflow:hidden truncation via Canvas measureText on mobile
- [x] Sticky date/league header: always show full DATE · LEAGUE string on all screen sizes; responsive font sizing (mobile < tablet < desktop)
- [x] NCAAM clock: 1st→1ST HALF, 2nd→2ND HALF; 00:00 1st/2nd→END 1ST/2ND HALF; HALFTIME stays HALFTIME; FINAL stays FINAL
- [x] ModelProjections league label: fix duplicate fontSize property, set to 12px responsive clamp
- [x] Game clock span: enforce single-line display (no wrapping), font size capped so text never overflows to second line
- [x] MobileTeamNameBlock: school name font always >= nickname font (enforce in useAutoFontSize logic)
- [x] Add NHL button to sport filter (all feed pages); clicking shows NHL Coming Soon page with NHL logo + bold header + subheader
- [x] Sport filter buttons: reduce size so more leagues fit in the row
- [x] Uniform school/city name font size: single responsive clamp across all cards (computed from longest name vs container width)
- [x] Uniform nickname font size: single responsive clamp, always smaller than school/city name
- [x] Remove per-card useAutoFontSize from MobileTeamNameBlock and desktop ScorePanel; replace with fixed uniform values
- [x] Audit all 395 names, build abbreviation map (SAINT→ST., CALIFORNIA→CAL, etc.) to bring longest names under 14-char threshold
- [x] Update ncaamTeams.ts ncaaName display values with shortened forms; verify all fit at uniform font size
- [x] Replace useAutoFontSize in MobileTeamNameBlock with uniform clamp(9px, 2.4vw, 11px) for names and clamp(8px, 2.1vw, 10px) for nicknames
- [x] Widen mobile frozen panel grid column from 140px to 170px
- [x] Apply 30-team user-specified abbreviation map to ncaamTeams.ts with full verification log
- [x] Confirm no wrong-school mapping errors exist (Northwestern St. incident was caught — audit all 30)
- [x] Mobile game card school name: +2pt (clamp 11→13px), ALL CAPS, bold (700)
- [x] Mobile game card nickname: +1pt (clamp 9→11px), lowercase, semi-bold (600)
- [x] Mobile game card school name: +3pt more (clamp 14→16px), ALL CAPS bold
- [x] Mobile game card nickname: +1.5pt more (clamp 10.5→12.5px), lowercase semi-bold
- [x] GameCard tab buttons: +1pt font size
- [x] GameCard BOOK/MODEL sub-headers (column headers): +0.5pt font size
- [x] GameCard SPREAD/TOTAL/ML section headers: +1pt font size
- [x] GameCard OddsTable values: +0.25pt font size, +0.2px cell spacing
- [x] GameCard clock/time/FINAL: +1.5pt font size
- [x] GameCard LIVE indicator: +2pt font size
- [x] GameCard favorite star icon: larger (proportional to LIVE/clock)
- [x] GameCard score: left-align (duplicate CSS removed, clean single textAlign: left)
- [x] GameCard team logos: 1.5x larger (22px → 33px)
- [x] GameCard mobile: extend tab bar divider line full card width; move star+LIVE/FINAL/time above it in a single proportionally-scaled header row (star 13px, LIVE 9px, clock 8.5px, FINAL/time 8.5px, tabs 8px)
- [x] Move 4-tab filter (BOOK LINES/MODEL LINES/SPLITS/EDGE) from individual GameCards to a single feed-wide filter bar below date/sport header; applies to all cards at once; default dual-active BOOK+MODEL; present on NCAAM, NBA, NHL, Favorites feeds
- [x] Feed tab bar buttons: fix duplicate fontSize, set to 13px (single clean declaration)
- [x] OddsTable: SPREAD/TOTAL/ML headers +1pt (now clamp(10.25px,2.5vw,12.25px)), BOOK/MODEL sub-headers +0.75pt (now 8.25px), value cells +0.5pt (now 10.25-10.5px)
- [x] GameCard mobile: move per-card status row (star/LIVE/FINAL/time) into frozen left panel above home team row; text matches SPREAD/TOTAL/ML size; 30px height aligns with OddsTable header block
- [x] GameCard mobile: move status row (star/LIVE/FINAL/time) to above the away team row (above away, not between away and home)
- [x] GameCard mobile: style FINAL badge as a light grey pill with neon green (#39FF14) text
- [x] GameCard: never abbreviate "LOS ANGELES" to "LA" in team name display (DB updated + defensive normalization in code)
- [x] BUG FIXED: Oregon vs Maryland duplicate — deleted stale NCAA-only stub (id=1620073); added reverse-order team match in VSiN and NCAA-only insertion paths in vsinAutoRefresh.ts to prevent future duplicates
- [x] BUG FIXED: UMass-Lowell vs UMBC missing — fixed UMBC vsinSlug from 'umbc' to 'md-balt-co' in ncaamTeams.ts; next auto-refresh will populate odds and splits
- [x] AUDIT: 24 games on March 10 NCAAM slate, all confirmed present; no other duplicates or missing games found
- [x] Publish all 24 March 10 NCAAM model lines (spread, ML, total) to DB — 24/24 updated, all publishedToFeed=1
- [x] BettingSplitsPanel: fix rowLabel (TICKETS/MONEY) span — removed opacity:0 and duplicate fontSize; now white, bold, fully visible
- [x] BettingSplitsPanel: added letterSpacing 0.04em to all 4 inside percentage label spans to prevent clamping
- [x] BettingSplitsPanel: advanced splits bar logic — 100%/0% full bar single label, ≥1% always inside pill with min-width guarantee, labels never outside pill; unit tests for 100/0, 1/99, 4/96, 50/50 cases
- [x] BettingSplitsPanel: away segment label flush-left, home segment label flush-right; black stroke textShadow on every % label in all bars (mobile + desktop)
- [x] Desktop splits pill: fix home label clipped by overflow — ensure flex sizing keeps all labels fully visible inside pill
- [x] Desktop GameCard: vertically center left panel (team names/scores) with OddsTable rows
- [x] Feed tab bar (BOOK/MODEL/SPLITS/EDGE): hide on desktop/tablet (lg+), show only on mobile
- [x] BettingSplitsPanel: universal black stroke on ALL % labels every screen/code path; increase minWidth so single-digit values (1-9%) always have enough room inside pill on all screens
- [x] SplitBar desktop: dynamic proportional font+segment scaling with clamp() so % values scale with bar height at all viewport widths; single-digit always fully visible; 100% rule intact
- [x] GameCard desktop/tablet: consistent team name font sizes (school name + nickname) scaled with clamp() matching mobile hierarchy
- [x] Phase 1: CSS --scale variable in :root (100vw/393, clamped 1–3.85) + device viewport database comment
- [x] Phase 2: useViewportScale() hook — throttled resize, returns {width,height,scale,deviceType}
- [x] Phase 3: Fluid typography — clamp(base, calc(base * var(--scale)), max) on all text elements
- [x] Phase 4: Scale-adjusted spacing/dimensions — padding, margin, row-height, logo-size, card-radius
- [x] Phase 5: Fluid minmax grid columns for game board
- [x] Phase 6: useViewportScale hook integrated into app context
- [x] Phase 7-9: Mobile/tablet/desktop layout verified with scale engine
- [x] Phase 10: react-window virtualized game list rendering
- [x] Phase 11: Validation vitest against 25-device viewport database
- [x] GameCard desktop: widen left panel from 170px to clamp(170px,14vw,220px); bump useAutoFontSize max to 20px; nickname clamp(13px,1.3vw,17px) so names scale visibly larger on desktop
- [ ] GameCard desktop: diagnose and fix font size inconsistency — some names appear smaller than others; ensure all team name paths use consistent fluid clamp() sizing
- [x] Fix team name font scaling: MobileTeamNameBlock now uses useAutoFontSize (max=18px, min=9px) instead of fixed clamp() — long names like "UMass Lowell" auto-shrink to fit container
- [x] Fix awayNameRef/homeNameRef containers in ScorePanel: added flex-1 so useAutoFontSize measures full available width (was 68.6px, now 124.6px) — "UMass Lowell" now renders at 19.5px instead of 10.5px
- [x] Remove all truncation from team names/nicknames — no overflow:hidden, no textOverflow:ellipsis, no clipping; uniform clamp() font sizes scale with viewport, containers expand to fit full text
- [x] Desktop: merge ODDS + SPLITS into single unified table (BOOK → splits bars → MODEL per section) with EdgeVerdict on far right; mobile/tablet unchanged
- [x] Desktop DesktopMergedPanel refinement: per-column vertical stack = section header → BOOK row → TICKETS bar → HANDLE bar → MODEL row; EdgeVerdict pinned right; full screen width; desktop only
- [x] Desktop SectionCol: split bars show team labels flanking left/right of each bar (away label left, home label right), TICKETS/MONEY centered above bar — matching reference screenshots
- [x] Desktop SectionCol restructure: top = team labels + BOOK/MODEL column headers + values in same row; bottom = TICKETS bar + MONEY bar completely below the odds table
- [x] Desktop SectionCol exact layout: section title → 2-col grid (BOOK header | MODEL header → away book | away model → home book | home model) → separator → TICKETS bar → MONEY bar
- [x] Desktop SectionCol: add team abbreviation prefix to each value cell — SPREAD/ML show "ABBR value" (e.g. "PSU +4.5"), TOTAL keeps o/u prefix only (e.g. "o143.5"); desktop only
- [x] Desktop: uniform game card height — all cards same fixed height, all section columns same dimensions
- [x] Desktop SectionCol: team logos in SPREAD and MONEYLINE row labels (away logo left of away values, home logo left of home values)
- [x] Desktop SectionCol TOTAL: spell out "OVER" and "UNDER" as row labels instead of blank/o/u prefix
- [x] Desktop: remove team abbreviation text from SPREAD/ML row labels — logos only, no text
- [x] Desktop: fix OVER/UNDER in TOTAL section — text directly next to values, no separate label column
- [x] Desktop: enforce uniform fixed card height across all game cards (no minHeight variance)
- [x] Desktop: enforce uniform splits bar height and width across all 3 sections (SPREAD/TOTAL/ML) and all game cards
- [x] Desktop: logos must be immediately adjacent (right next to) the BOOK and MODEL spread/ML values — no gap between logo and number
- [x] Desktop: logos appear in BOTH BOOK and MODEL cells for SPREAD/ML rows (not just BOOK)
- [x] Desktop: TOTAL section — show plain "OVER" / "UNDER" text only, no o{total}/u{total} prefix notation
- [ ] Desktop: uniform splits bar height and width across all 3 sections (TICKETS and MONEY bars identical size)
- [ ] Desktop: OVER/UNDER rows show "OVER {bookTotal}" and "UNDER {bookTotal}" in BOOK cell, "OVER {modelTotal}" and "UNDER {modelTotal}" in MODEL cell
- [ ] Desktop: strip ALL o/u prefix from OVER/UNDER total values — format must be exactly "OVER {number}" / "UNDER {number}" with no o or u characters anywhere
- [x] Desktop: TICKETS and MONEY split bars same height (MONEY pill is currently taller than TICKETS)
- [x] Desktop: TOTAL section title must say "TOTAL" not "OVER/UNDER" (section header text fix)
- [x] Desktop: show team abbreviation next to logo in SPREAD and ML sections — {LOGO} {ABBR}
- [x] Desktop: uniform column widths — all section borders align at same horizontal positions across all game cards
- [x] Desktop: uniform height for every game card row (GAME/MATCHUP | SPREAD | TOTAL | MONEYLINE | EDGE all same height)
- [x] Desktop: TOTAL section header — remove OVER/UNDER corner texts and remove total value line beneath title
- [x] Desktop: enforce perfectly uniform SPREAD/TOTAL/ML/EDGE panel widths (grid-based, not flex)
- [x] Desktop: BOOK/MODEL column headers 4pt larger than value rows beneath them
- [x] Desktop: value rows 4pt smaller than BOOK/MODEL headers; abbreviations/OVER/UNDER labels 1pt smaller than values
- [x] Desktop: ALL BOOK values — light gray #D3D3D3, font-weight 500
- [x] Desktop: ALL MODEL non-edge values — white #FFFFFF, font-weight 600
- [x] Desktop: ALL MODEL edge values — neon green #39FF14, font-weight 700
- [x] Desktop: deep pixel-level audit and fix of game card panel uniform height/width — EDGE column fixed at clamp(120px,10vw,160px); pixel measurement confirms all 24 cards now have exactly 312|1|312|1|312|1|128px column widths (1 unique pattern, was 17 unique patterns)
- [x] Desktop: BOOK column title in all 3 SPLITS sections — change to white font
- [x] Desktop: fix SPREAD splits bar labels — homeSpreadLabel bug fixed (was using awayAbbr, now uses homeAbbr)
- [x] Desktop: TICKETS and MONEY row titles — change to white font
- [x] Desktop: score/matchup panel — teams wrapped in flex-col justify-center group, py-2→py-1 on each row; pixel measurement: teams at top=48px and top=126px in 179px card, now grouped and centered
- [ ] Desktop: move teams higher in score panel (reduce top padding/offset)
- [ ] Desktop: scale favorite star, game clock/startTime, and LIVE/FINAL badge to 1.5× team name font size
- [ ] Desktop+all screens: FINAL button neon green (#39FF14) matching mobile style

## Style Changes (2026-03-11)
- [x] SPREAD/TOTAL/MONEYLINE labels: increase font size by 1.5pt relative to BOOK/MODEL labels
- [x] Losing team score: reduce font-weight by 200 (e.g. 700→500)
- [x] LIVE badge: match FINAL pill style (neon green border, background, same font/padding)
- [x] Betting split pill %% values: add letterSpacing +0.2em to all percentage text in pills
- [x] SPREAD/TOTAL/MONEYLINE: increase font size by 1.5pt more than BOOK/MODEL (iteration 2)
- [x] Losing team score: add 100 back to bold level (500→600)
- [x] LIVE pill: increase border-radius to be more rounded (full pill shape)
- [x] LIVE pill: move to LEFT of gameClock/gameStatus text
- [x] Betting split pill %%: decrease letterSpacing by 0.2, then add 0.1 gap before % symbol via thin-space
- [x] LIVE/FINAL pill: halve border-radius (9999px → ~6px)
- [x] LIVE pill: add gap/space between dot and LIVE text
- [x] gameClock/LIVE/FINAL/star buttons: reduce size by 25%
- [x] Winning score fontWeight: reduce by 50 (900→850) for FINAL and LIVE games
- [x] SPREAD/TOTAL/MONEYLINE titles: reduce fontWeight by 50 (800→750)
- [x] Star favorite glow: reduce shine/glow intensity when toggled
- [x] Losing team score: visually distinct fontWeight from winner in both LIVE and FINAL games
- [ ] Score fontWeight ratio: winner=700, loser=600
- [ ] Exact vertical centering of gameClock/status, team names, and scores within card
- [ ] Enhanced Edge Verdict section on desktop

## Systemic Duplicate Game + Missing Odds Root Cause Fix (2026-03-11)
- [ ] Deep audit: DB state for all current duplicates across all dates
- [ ] Fix: team-pair reversal dedup (VSiN away/home != NCAA away/home)
- [ ] Fix: schedule-odds merge logic (update existing row instead of inserting new)
- [ ] Fix: add DB unique constraint on (gameDate, sorted awayTeam, sorted homeTeam)
- [ ] Fix: vsinAutoRefresh canonical team-pair key (sort teams alphabetically before lookup)
- [ ] Fix: ncaaScoreboard merge should update startTimeEst on existing VSiN row, not insert new
- [ ] Clean up all current DB duplicates after pipeline fix
- [ ] Add comprehensive pipeline logging for every insert/update/skip decision
- [ ] Full pipeline audit: cross-reference VSiN source, NCAA schedule, NBA schedule against DB
- [ ] Fix all odds/splits mapping mismatches found in audit
- [x] Fix reversed-team odds mapping bug in vsinAutoRefresh.ts (VSiN home/away order vs NCAA order mismatch causes inverted spreads/ML/splits — e.g. Bethune-Cookman @ Prairie View, isReversedMatch swap logic added)
- [x] Add kenpomSlug field to NcaamTeam interface and all 365 registry entries in ncaamTeams.ts
- [x] Push DB migration for kenpomSlug column in ncaam_teams table
- [x] Seed kenpomSlug values for all 365 ncaam_teams rows with full cross-validation

## Model v9 Backend Integration
- [x] Add modelAwayScore and modelHomeScore columns to games schema
- [x] Run db:push to sync new schema columns
- [x] Write server/model_v9_engine.py — headless Python engine (stdin JSON → stdout JSON)
- [x] Write server/ncaamModelEngine.ts — TS wrapper spawning Python engine per game
- [x] Write server/ncaamModelSync.ts — orchestrator: fetch games → lookup kenpomSlug/conf → parallel model runs → write to DB
- [x] Add conference→KenPom short code mapping (ncaamTeams conference names → model CONF_AVG_DE keys)
- [x] Add tRPC procedure model.runForDate (owner-only) — triggers manual model run
- [x] Auto-trigger model sync after VSiN refresh completes in vsinAutoRefresh.ts
- [x] Write vitest test for ncaamModelEngine (12 tests passing)
- [x] Save checkpoint after integration

## V9 Origination Engine Decoupling & Automation
- [ ] Remove v9 auto-trigger hook from vsinAutoRefresh.ts (keep slate/odds pipelines fully separate)
- [ ] Build dedicated ncaamModelWatcher.ts — polls DB for new unoriginated NCAAM games, fires v9 per game immediately on detection
- [ ] Wire ncaamModelWatcher into server startup (runs independently of VSiN refresh and slate population)
- [ ] Add tRPC procedure model.runFullSlate (owner-only) — manual full re-run of all today's games
- [ ] Populate modelAwayScore, modelHomeScore, modelAwaySpread, modelHomeSpread, modelTotal, modelAwayML, modelHomeML into game cards as pre-review placeholders
- [ ] Add deep structured logging to model watcher (game detected, v9 dispatched, result written, errors)
- [ ] Write integration test: simulate new game insertion → verify v9 fires and DB fields populate
- [ ] Verify slate population, odds refresh, and v9 origination are fully independent execution paths
- [ ] Save checkpoint after full integration test passes

## V9 Hardcoded Team Data (Eliminate Live KenPom Fetches)
- [ ] Bulk-fetch all 365 teams' KenPom conference-only scouting data (OE, DE, Tempo, APLO, secondary stats)
- [ ] Bulk-fetch all 365 teams' conference schedule PPG (scored and allowed, OT-adjusted)
- [ ] Build TEAM_DATA lookup dict in model_v9_engine.py — keyed by kenpomSlug
- [ ] Remove all live kenpompy fetches from model_v9_engine.py
- [ ] Update ncaamModelEngine.ts to remove kenpom_email/kenpom_pass from input JSON
- [ ] Update ncaamModelWatcher.ts to remove credential passing
- [ ] Test end-to-end pipeline with hardcoded data on all 4 test games
- [ ] Verify game card population for all test games
- [ ] Save checkpoint

## Model Projection Gating + Spread Rounding (2026-03-12)
- [ ] Round model spreads to nearest 0.5 in model_v9_engine.py output (e.g. -7.96 → -8.0, +3.43 → +3.5)
- [ ] Round model totals to nearest 0.5 in model_v9_engine.py output
- [ ] Add publishedModel boolean column to games DB schema (default false)
- [ ] Run db:push migration for publishedModel column
- [ ] Gate model fields (awayModelSpread, homeModelSpread, modelTotal, modelAwayML, modelHomeML) behind publishedModel=true in games.list public API — return null for unpublished model data
- [ ] Update Publish Projections page to show model projections (spread, total, ML, scores, over/under rates, win %) for review
- [ ] Add "Approve Model" toggle/button per game on Publish Projections page
- [ ] Add "Approve All" bulk action on Publish Projections page
- [ ] Wire publishedModel toggle to new tRPC procedure games.setModelPublished (owner-only)
- [ ] Verify public feed shows dashes for model columns until @prez approves each game
- [ ] Update vitest tests for new gating logic
- [ ] Re-run watcher to re-populate model data with rounded spreads/totals

## Spread Sign Fix + 0.5 Rounding (2026-03-12)
- [x] Fix spread sign logic: projected favorite (lower score) must get negative spread, underdog gets positive
- [x] Round awayModelSpread, homeModelSpread to nearest 0.5 before writing to DB
- [x] Round modelTotal to nearest 0.5 before writing to DB
- [x] Clear all existing model data from DB and re-run watcher to repopulate with correct values
- [x] Round model moneylines to whole integers (no decimal points) in watcher formatML
- [x] URGENT: Gate all model fields in listGames API — only return model data when publishedModel = true
- [x] URGENT: Clear all model data from DB until gating is in place
- [x] Add publishedModel boolean column to games table schema and run migration
- [x] Add setGameModelPublished helper in db.ts
- [x] Add setModelPublished tRPC procedure (ownerProcedure) in routers.ts
- [x] Add Approve Model / Model Live button to EditableGameCard in PublishProjections (NCAAM only, only when model data exists)
- [x] Scope publishedModel gate to NCAAM games only in listGames

## Login Error Investigation (2026-03-12)
- [x] Diagnose "string did not match expected pattern" login error — caused by missing app_session cookie (session cookie cleared during server crash window)
- [x] Fix slow site load issue — caused by publishedmodel column missing from DB during brief migration window
- [x] Fix "Failed to update model approval status" error on Publish Projections page — root cause: sameSite:none cookie without secure:true silently dropped by browser; fixed with trust proxy + conditional sameSite
- [x] Fix feed loading screen crash (happening simultaneously with model approval error) — same root cause as above

## Slow Load + No Games Found Investigation (2026-03-12)
- [x] Diagnose site taking very long to load — caused by polling storm (5 simultaneous games.list polls at 15s intervals); fixed by raising all to 60s with 30s staleTime
- [x] Diagnose "no games found" after refresh — all 44 NCAAM games had publishedToFeed=0 (temporary state); re-published all 44 games
- [ ] Investigate whether all user sessions need to be invalidated

## Session Invalidation System (2026-03-12)
- [x] Deep analysis: trace full auth lifecycle to determine best invalidation strategy
- [x] Implement tokenVersion field in app_users table for per-user JWT invalidation
- [x] Add forceLogout (individual) and forceLogoutAll (bulk) procedures
- [x] Add admin UI controls for force-logout in User Management page
- [x] Run DB migration and verify end-to-end
- [x] Write vitest tests for tokenVersion system (16 tests passing)

## Bulk Approve Models (2026-03-12)
- [x] Add bulkApproveModels DB helper (approves all pending games with model data for a date)
- [x] Add games.bulkApproveModels tRPC procedure (owner-only)
- [x] Add "Approve All Models" button to Publish Projections header (neon green ghost style, shows pending count badge, hidden when count=0)
- [x] Add 5 vitest tests for pendingApprovalCount logic (168/169 total passing)

## Mobile Layout Fixes (2026-03-12)
- [x] Fix filter bar (Favorites/Today/Sport tabs/Search) to fit within screen width — no horizontal scroll, all items visible
- [x] Fix date+league subtitle to always be single-line, fully centered, never clipped on any screen width
- [x] Ensure tab bar scales proportionally to screen width (font size, padding, icon size all responsive)
- [x] Verify no horizontal overflow anywhere on Dashboard on mobile (375px width)

## Mobile Deep Optimization Audit (2026-03-12)
- [x] Add useMobileDebug hook: logs vw/vh, devicePixelRatio, safeAreaInsets, headerHeight, scale factor on every resize
- [x] Fix index.css: add env(safe-area-inset-*) support, ensure --scale is clamped correctly for 320px-430px range
- [x] Fix ModelProjections header: all rows fit on every mobile width 320px-430px without overflow
- [x] Fix GameCard: frozen left panel correct width, horizontal scroll table correct column widths on all mobile sizes
- [x] Fix feed main area: height = 100dvh - headerHeight, no vertical scroll bleed, safe area bottom padding
- [x] Verify no overflow:hidden clipping on any interactive element (search dropdown, calendar picker)

## Edge Detection Fix (2026-03-12)
- [x] Audit spread, total, and ML edge detection algorithms in GameCard
- [x] Fix ML edge: must be directionally consistent with spread edge (if UCLA spread is edge, Rutgers ML cannot also be edge)
- [x] Implement unified edge direction model: spread-first with implied-prob fallback when no spread edge
- [x] Write vitest tests for edge consistency across all scenarios (17 tests passing)

## NHL Teams Database (2026-03-12)
- [x] Extract NHL slugs and logo URLs from NHL.com HTML source
- [x] Extract VSiN slugs and team names from VSiN HTML source
- [x] Build complete 32-team mapping with all 12 columns validated (13 checks: 0 errors, 0 warnings)
- [x] Add nhl_teams table to DB schema and run db:push (migration 0027)
- [x] Add upsertNhlTeams, getNhlTeams, getNhlTeamByDbSlug, getNhlTeamByAbbrev helpers to db.ts
- [x] Extend getTeamColors() to handle sport="NHL"
- [x] Seed all 32 NHL teams into the database (32/32 inserted, 0 errors)
- [x] Run validation query confirming 32 rows, no nulls, correct conferences/divisions (13/13 checks passed)

## NHL Data Pipeline (2026-03-12)
- [x] Audit existing VSIN scraper (vsinScraper.ts) and NBA scraper to understand exact API endpoints
- [x] Test NHL.com API endpoint (api-web.nhle.com/v1/schedule/today) for today's games
- [x] Test VSIN NHL API endpoint for betting splits
- [x] Build nhlVsinScraper.ts: authenticate, fetch NHL splits, parse into ScrapedOdds objects
- [x] Build nhlSchedule.ts: fetch NHL.com API schedule, extract start times, map to DB slugs via nhl_teams table
- [x] Add NHL game import to auto-refresh cron (same pattern as NCAAM/NBA)
- [x] Add NHL tRPC procedures: games.listNhl, games.refreshNhl
- [x] Write vitest tests for NHL scraper mapping

## NHL Pipeline Full Test (2026-03-13)
- [x] Audit NCAAM/NBA refresh job and DB helpers to mirror for NHL
- [x] Finalize nhlVsinScraper.ts with full debug logging
- [x] Build nhlRefreshJob.ts: VSiN scrape + NHL API schedule + map/match + DB upsert (integrated into vsinAutoRefresh.ts)
- [x] Add NHL DB helpers: upsertNhlGame, getNhlGames, getNhlGamesByDate
- [x] Add NHL tRPC procedures: nhl.listGames, nhl.refresh
- [x] Wire NHL refresh into auto-refresh cron
- [x] Run end-to-end pipeline test: scrape → map → store → verify DB rows (14/14 games, 14/14 odds, 14/14 splits)
- [x] Validate mapping accuracy: every VSiN game matched to NHL API game (16/16 VSiN games processed)
- [x] Write vitest tests for NHL pipeline

## NHL tRPC Integration (2026-03-13)
- [x] Fix triggerRefresh fallback object to include nhlUpdated/nhlInserted/nhlScheduleInserted/nhlTotal fields
- [x] Add NHL case to isValidGame() in routers.ts (NHL_VALID_DB_SLUGS)
- [x] Add NHL sport selector button to Publish Projections page
- [x] Add NHL Refresh Stats section to Publish Projections stats bar
- [x] Fix fetchNhlLiveScores() to use DST-aware ET date calculation (was hardcoded -5h, now uses Intl.DateTimeFormat)
- [x] Live end-to-end validation: 13/13 HTML parse checks passed, 11/11 slug checks passed, 14/14 DB games verified

## NHL Full-Stack Display Audit (2026-03-13)
- [x] DB audit: 14/14 today's games with complete odds/splits/scores; 42 future schedule-only stubs (expected, no VSiN lines yet)
- [x] GameCard.tsx: add NHL_BY_DB_SLUG import and NHL team lookup (city, nickname, logoUrl)
- [x] PublishProjections.tsx: add NHL_BY_DB_SLUG import and NHL team lookup in EditableGameCard
- [x] Dashboard.tsx: add NHL sport tab button (blue #4FC3F7 style), NHL_BY_DB_SLUG import
- [x] Dashboard.tsx: fix SearchResultRow to use NHL city/nickname for NHL teams
- [x] Dashboard.tsx: fix TeamBadge to use NHL logo for NHL teams
- [x] Dashboard.tsx: fix sport label to show 'NHL HOCKEY' when NHL tab active
- [x] routers.ts: confirmed isValidGame() handles sport='NHL' via NHL_VALID_DB_SLUGS
- [x] TypeScript: 0 errors after all changes
- [x] Test suite: 185/186 passing (1 pre-existing KenPom credentials failure)

## NHL Feed + Publish Projections Display Fixes (2026-03-13)
- [x] Remove "NHL MODEL / COMING SOON..." placeholder from ModelProjections.tsx NHL tab — show real game cards
- [x] Fix Publish Projections ML display: add BOOK ML column to desktop layout showing awayML/homeML from DB
- [x] Confirmed publishedToFeed: all 14 today's NHL games are published (0 unpublished)
- [x] Advanced debug audit: 14/14 games with spread, total, ML, published — 0 missing fields
- [x] Mobile tab filter: removed NHL gate so mobile tab bar shows for NHL too
- [x] TypeScript: 0 errors; 185/186 tests passing (1 pre-existing KenPom env failure)

## Auth Error Fix (2026-03-13)
- [x] Diagnose "Not authenticated" TRPCClientError: race condition in initial tRPC batch — favorites.getMyFavorites fires before appUsers.me resolves, no app_session cookie yet
- [x] Fix ModelProjections.tsx: change isAppAuthedForFav to !appAuthLoading && Boolean(appUser) so favorites queries wait for auth state to resolve
- [x] Fix ModelProjections.tsx: add retry:false to favorites queries to prevent retry loops
- [x] Fix main.tsx: suppress UNAUTHORIZED console errors for optional auth-gated queries (favorites) to eliminate noise
- [x] TypeScript: 0 errors; 185/186 tests passing (1 pre-existing KenPom env failure)

## Loading Screen Fix (2026-03-13)
- [ ] Add QueryClient defaultOptions: staleTime=5min, retry=1 to prevent long spinners
- [ ] Add 3s timeout fallback in Home.tsx so landing page shows even if auth is slow
- [ ] Add staleTime to useAppAuth hook to cache appUsers.me for 5 minutes
- [ ] Verify fix: loading screen resolves quickly on mobile

## Site-Wide Hardening Audit (2026-03-13)
- [ ] Server: Fix DB connection pool (single connection → pool of 10, keepAlive, connectTimeout)
- [ ] Server: Add global unhandledRejection + uncaughtException handlers to prevent server crash
- [ ] Server: Add request timeout middleware (30s) to prevent hanging requests causing 503s
- [ ] Server: Add health check endpoint /api/health for load balancer monitoring
- [ ] Auth: Fix loading screen — add 5s timeout fallback so users see login prompt not black spinner
- [ ] Auth: Add staleTime to QueryClient defaults to reduce cold-start latency
- [ ] Auth: Fix tokenVersion mismatch UX — show clear session-expired message instead of blank spinner
- [ ] Frontend: Fix all TypeScript errors in GameCard.tsx, vsinAutoRefresh.ts
- [ ] Frontend: Add React ErrorBoundary to all pages to prevent full page crashes
- [ ] Frontend: Add loading timeout fallback to ModelProjections, Dashboard, PublishProjections
- [ ] Cron: Add try/catch around every cron job tick to prevent uncaught exceptions crashing server
- [ ] Cron: Fix ScoreRefresh — add NHL score refresh to the score refresh cycle
- [ ] Cron: Add memory leak protection — clear intervals on process exit
- [ ] DB: Fix TypeScript type for drizzle pool instance

## Site-Wide 100x Hardening Audit (2026-03-13)
- [x] TypeScript: eliminated all 331 errors (292 from sortGamesByStartTime generic inference bug, 39 from implicit any lambdas)
- [x] Root cause: sortGamesByStartTime<T> generic + _db:any caused Drizzle rows to lose all fields except {gameDate,startTimeEst,sortOrder}
- [x] Fix: added explicit Promise<Game[]> return types to listGames, listGamesByDate, listStagingGames, listStagingGamesRange
- [x] Fix: added explicit Promise<AppUser[]> return types to listAppUsers and app user helpers
- [x] Fix: added ModelFile type annotation to routers.ts lambda; FileRow type to FilesPage.tsx
- [x] Server: added global process.on('unhandledRejection') and process.on('uncaughtException') crash guards in server/_core/index.ts
- [x] Server: added /health endpoint for load balancer health probes (returns 200 without hitting DB)
- [x] Server: added 30-second request timeout middleware to kill hanging connections
- [x] Server: added tRPC onError handler to log INTERNAL_SERVER_ERROR paths with stack traces
- [x] DB: upgraded from single connection to mysql2 connection pool (max=10, connectTimeout=10s, keepAlive=true)
- [x] Auth: added 4-second timeout to Home.tsx and LoginPage.tsx loading spinners (shows login page if server is slow)
- [x] Auth: updated useAppAuth hook with staleTime=5min, retry=1, retryDelay=1s, refetchOnWindowFocus=false
- [x] QueryClient: added defaultOptions with staleTime=5min, retry=1, retryDelay=1s, refetchOnWindowFocus=false
- [x] Cron: confirmed all setInterval ticks in vsinAutoRefresh.ts are wrapped in try/catch
- [x] Frontend: favorites queries use !appAuthLoading guard to prevent race condition on initial load
- [x] Test suite: 185/186 passing (1 pre-existing KenPom env failure unrelated to hardening)

## NHL Puck Line Odds + O/U Odds (2026-03-13)
- [x] Add awaySpreadOdds, homeSpreadOdds, overOdds, underOdds columns to games DB schema
- [x] Run db:push migration
- [x] Build MetaBet consensus odds scraper for NHL (vsin.com/odds/ with HKN filter)
- [x] Parse consensus spread odds, O/U odds from MetaBet board HTML
- [x] Wire MetaBet scrape into NHL refresh pipeline (alongside VSiN splits)
- [x] Update updateBookOdds DB helper to write spread/O/U odds columns
- [x] Update GameCard to display puck line odds in parentheses (e.g. +1.5 (-226))
- [x] Update GameCard to display O/U odds in parentheses (e.g. o5.5 (-107))

## MetaBet Consensus Spread Odds + O/U Odds — All Sports (2026-03-13)
- [x] Build shared metabetScraper.ts: fetch MetaBet API for BKC (NCAAM), BKP (NBA), HKN (NHL)
- [x] Parse consensus spread odds (awaySpreadOdds, homeSpreadOdds) and O/U odds (overOdds, underOdds)
- [x] Extend updateBookOdds DB helper to accept and write awaySpreadOdds, homeSpreadOdds, overOdds, underOdds
- [x] Wire MetaBet scrape into NCAAM refresh pipeline (alongside VSiN splits)
- [x] Wire MetaBet scrape into NBA refresh pipeline
- [x] Wire MetaBet scrape into NHL refresh pipeline
- [x] Update GameCard BOOK view: show spread odds in parentheses e.g. +4.5 (-105) for all sports
- [x] Update GameCard BOOK view: show O/U odds in parentheses e.g. o233.5 (-113) for all sports
- [ ] Write vitest tests for MetaBet scraper decimal-to-American conversion

## MetaBet DraftKings → Consensus Fallback
- [x] Update metabetScraper: fetch both DraftKings and consensus providers per game
- [x] Apply DK first, fall back to consensus per-market (spread, O/U, ML) when DK value is null
- [x] Verify North Texas @ Tulsa resolves correctly with consensus fallback

## Full Odds/Lines DB Population + Display Audit
- [ ] Diagnose why awayBookSpread and bookTotal are null in DB after MetaBet refresh
- [ ] Fix MetaBet refresh pipeline wiring so spread line and total write to DB correctly
- [ ] Trigger live refresh and re-run DB audit to confirm 100% field completeness
- [ ] Visual audit: mobile display of spread/ML/O/U odds for NCAAM, NBA, NHL
- [ ] Visual audit: tablet display of spread/ML/O/U odds for NCAAM, NBA, NHL
- [ ] Visual audit: desktop display of spread/ML/O/U odds for NCAAM, NBA, NHL
- [ ] Fix any display gaps or truncation issues found across screen sizes

- [ ] Audit vsin.com/odds/ page structure for NBA and NHL spread/total/ML lines with juice
- [ ] Build vsin.com/odds/ scraper for NBA and NHL (spread number + juice, total + juice, ML)
- [ ] Integrate new odds scraper into vsinAutoRefresh.ts (replace/supplement current NBA/NHL odds source)
- [ ] Publish NBA March 13 games to feed after odds are populated
- [ ] Verify NBA and NHL game cards display spread, total, and ML with correct odds on mobile and desktop

## NCAA.com Full Slate Audit (2026-03-13)
- [ ] Fix March 13: remove duplicate new_mexico@san_diego_st entry (wrong date - real game is March 14)
- [ ] Fix March 13: kent@akron status correction (showing live but should be upcoming)
- [ ] Populate missing spread/total odds for 16 March 13 games via MetaBet NCAAM endpoint
- [ ] Audit March 14+ dates for missing D1 NCAAM games (check NCAA.com for each date)
- [ ] Ensure NCAA scoreboard sync covers all 365 teams on all dates going forward
- [ ] Fix Ole Miss slug mapping (NCAA.com shows "Ole Miss", DB slug is "mississippi")
- [ ] Fix CSUN slug mapping (NCAA.com shows "CSUN", DB slug is "csu_northridge")
- [ ] Fix Southern U. slug mapping (NCAA.com shows "Southern U.", DB slug is "southern_u")
- [ ] Fix Florida A&M HTML entity (NCAA.com shows "Florida A&amp;M", DB slug is "florida_a_and_m")
- [ ] Fix Alabama A&M HTML entity (NCAA.com shows "Alabama A&amp;M", DB slug is "alabama_a_and_m")

## Action Network Odds Integration
- [ ] Discover Action Network API endpoints for NCAAB, NBA, NHL odds
- [ ] Build actionNetworkScraper.ts using Open + DK NJ (book 128508) columns
- [ ] Integrate Action Network scraper into vsinAutoRefresh replacing MetaBet
- [ ] Backfill today's games (March 13) with Action Network odds
- [ ] Verify all leagues display correctly on feed (mobile + desktop)
- [x] Replace MetaBet with Action Network v1 API for all DK odds (spread, O/U, ML, juice) for NCAAM, NBA, NHL
- [x] Add anSlug field to all 365 NCAAM, 30 NBA, and 32 NHL team registries
- [x] Add BY_AN_SLUG lookup maps and getTeamByAnSlug helpers to all three team registries
- [x] Build actionNetworkScraper.ts using AN v1 API for DK odds (spread, total, ML, awaySpreadOdds, homeSpreadOdds, overOdds, underOdds)
- [x] Build vsinBettingSplitsScraper.ts using data.vsin.com/betting-splits/ for splits only (today + tomorrow)
- [x] Rebuild vsinAutoRefresh.ts to use Action Network for odds and new VSiN scraper for splits
- [x] Add tomorrow's VSiN splits pre-population (runTomorrowSplitsUpdate) in main refresh orchestrator
- [x] Fix NHL live clock: rewrite fetchNhlLiveScores to use /v1/scoreboard/now for period/clock/intermission data
- [x] Add NHL intermission support to frontend clock formatter (1ST INT, 2ND INT, OT INT, Final/OT, Final/SO)
- [x] Confirm DK juice (awaySpreadOdds, homeSpreadOdds, overOdds, underOdds) populated in DB and displayed on Feed
- [ ] Switch AN scraper from v1 API to v2 API to get all 34 NCAAB games with DK odds and opening lines
- [ ] Fix New Mexico vs San Diego St. gameDate (should be 2026-03-14, not 2026-03-13) and TBD start time
- [ ] Add Utah Hockey Club to NHL registry (missing anSlug causing NO_SLUG in logs)
## Action Network HTML Parser Integration (March 14, 2026)
- [x] Build anHtmlParser.ts: parse AN best-odds HTML table to extract DK spread odds for all NCAAB games
- [x] Build tRPC procedure: games.ingestAnHtml (owner-only) to accept spread HTML + totals HTML and apply DK odds to DB
- [x] Add UI panel in PublishProjections for pasting AN HTML (spread + totals pages)
- [x] Add vitest tests for anHtmlParser
- [x] Upgrade to All Markets mode (3 rows per game: spread + total + ML)
- [x] Add 18 new DB schema columns: openAwaySpread, openHomeSpread, openTotal, openOverOdds, openUnderOdds, openAwayML, openHomeML, openAwaySpreadOdds, openHomeSpreadOdds + DK NJ equivalents
- [x] Build IngestAnOdds page at /admin/ingest-an with paste area, date/sport controls, result display
- [x] 21/21 NCAAB games matched and parsed correctly with 0 failures
- [x] 6 vitest tests passing for anHtmlParser

## NBA + NHL AN HTML Parser Extension (March 14, 2026)
- [x] Fetch and deep-parse NBA AN HTML to understand team slug format
- [x] Fetch and deep-parse NHL AN HTML to understand team slug format
- [x] Build NBA slug lookup map (anSlug → dbSlug) in ingestAnHtml procedure
- [x] Build NHL slug lookup map (anSlug → dbSlug) in ingestAnHtml procedure
- [x] Test NBA: 7/7 games matched and parsed correctly
- [x] Test NHL: 14/14 games matched and parsed correctly
- [x] Add vitest cases for NBA and NHL (4 new tests, 10 total passing)
- [x] Fix classifyRow MIN_CELLS threshold for 11-column NBA/NHL tables
- [x] Checkpoint

## Full Pipeline Audit: VSIN ↔ League Site + AN Odds + Splits (March 14, 2026)
- [ ] Deep audit: parse VSiN splits HTML (pasted_content_27) and extract all NCAAB/NBA/NHL games
- [ ] Deep audit: parse NBA.com schedule HTML (pasted_content_28) and extract all NBA games
- [ ] Deep audit: parse NHL.com scores HTML (pasted_content_29) and extract all NHL games
- [ ] Deep audit: parse NCAA.com scoreboard HTML (pasted_content_30) and extract all NCAAB games
- [ ] Cross-reference DB state vs league site: find all unmatched/missing games
- [ ] Fix VSIN ↔ League site matching for NCAAB (slug normalization, missing teams)
- [ ] Fix VSIN ↔ League site matching for NBA (team name normalization)
- [ ] Fix VSIN ↔ League site matching for NHL (team name normalization)
- [ ] Verify AN odds (Open + DK) are mapped to correct away/home fields for all 3 sports
- [ ] Fix any AN odds field inversion issues (away vs home team assignment)
- [ ] Verify betting splits are fetched and stored for all 3 sports
- [ ] Fix splits pipeline for NBA and NHL if not working
- [ ] Verify splits display correctly on GameCard for all 3 sports
- [ ] Full end-to-end test and checkpoint

## Odds/Lines Source Refactor: AN Only (March 14, 2026)
- [x] Remove all VSiN odds/lines scraping — keep only splits scraping in vsinAutoRefresh.ts
- [x] Remove applyActionNetworkOdds and fetchActionNetworkOdds (AN API-based odds) from pipeline
- [x] Fix ingestAnHtml to write DK line to awayBookSpread/homeBookSpread/bookTotal/awayML/homeML + juice fields
- [x] Remove redundant dkAwaySpread/dkHomeSpread/dkTotal/dkAwayML/dkHomeML columns from schema (9 columns dropped)
- [x] Fix GameCard to use awayBookSpread/homeBookSpread as primary display (no DK-specific fallback)
- [x] Fix GameCard TypeScript errors from open/dk line refactor (moved string builders to correct scope)
- [x] Fix OddsLinesPanel second call site to pass open line props
- [x] Fix updateAnOdds to parse spread/total strings to numbers for decimal columns
- [x] 195/196 vitest tests passing (1 pre-existing KenPom env var failure)
- [x] Checkpoint
- [ ] Change NCAAM start times from EST to PST to avoid midnight confusion
- [ ] Keep NBA and NHL start times in EST
- [ ] Update existing DB games with corrected PST start times for NCAAM

- [x] Change NCAAM start times from EST to PST (NCAA scraper uses epochToPt, vsinAutoRefresh uses gameDatePst)
- [x] Keep NBA and NHL start times in EST
- [x] Fix all 21 NCAAM games for March 14 to use correct PST start times from NCAA API epochs
- [x] Move Cal Baptist @ Utah Valley from March 15 to March 14 (correct PST date = March 14 at 8:59 PM PST)
- [x] Remove UNM vs SDSU from March 14 (moved to March 13 per PST calendar date)
- [x] Apply AN odds to all 42 games (21 NCAAM + 7 NBA + 14 NHL) - 42/42 with DK + Open odds
- [x] Apply VSiN splits to all 42 games - 41/42 with splits (Kings @ Clippers late game, splits not yet posted)
- [x] Add gameDatePst field to NcaaGame interface for correct PST calendar date assignment
- [x] Update vsinAutoRefresh to use gameDatePst when inserting NCAAM games
- [x] Update sortGamesByStartTime to remove 00:00 special case (no longer needed with PST)
- [x] Update GameCard.tsx formatMilitaryTime to show PST for NCAAM, EST for NBA/NHL

- [x] Fix Kings vs Clippers missing splits from VSiN HTML provided by user (getNbaTeamByVsinSlug alias resolution fix)
- [x] Fix GameCard height/overflow/truncation - replaced fixed height+overflow:hidden with minHeight so content never clips
- [x] Ensure dynamic scaling for all GameCard content across all leagues and screen sizes (removed all overflow:hidden from desktop layout columns)

- [x] Audit VSiN scraper for March 15 NCAAM/NBA/NHL slate completeness (18/18 games resolved, 0 slug failures)
- [x] Audit Action Network scraper for March 15 Open/DK NJ odds mapping (7/7 NBA resolved, NCAAM/NHL DK not yet posted by DK)
- [x] Run live diagnostic against VSiN tomorrow endpoint for all leagues (5 NCAAM + 7 NBA + 6 NHL = 18 games, all matched)
- [x] Run live diagnostic against Action Network for March 15 odds (7 NBA games with DK odds, all matched)
- [x] Fix Portland Trail Blazers slug mismatch: NBA.com CDN uses "blazers" but registry had "trailblazers" — added NBA_SCHEDULE_SLUG_ALIASES and updated getNbaTeamByNbaSlug()
- [x] Fix Kings vs Clippers missing splits: VSiNAutoRefresh was using NBA_BY_VSIN_SLUG.get() directly instead of getNbaTeamByVsinSlug() — fixed to use alias-aware helper
- [x] Build refreshAnApiOdds() function: auto-populates DK NJ current lines from AN API for all leagues (NBA/NHL/NCAAM) without manual HTML paste
- [x] Wire refreshAnApiOdds() into runVsinRefresh() for both today and tomorrow dates
- [x] Verify all March 15 games have correct splits and odds in DB (5 NCAAM + 7 NBA + 6 NHL all present with splits and DK odds where available)
- [x] Fix DK NJ book ID: was 79 (bet365 NJ), correct is 68 (DK NJ) — fixed in actionNetworkScraper.ts
- [x] Fix Open line book ID: was missing, correct is 30 — added to actionNetworkScraper.ts
- [x] Upgrade actionNetworkScraper.ts to AN v2 scoreboard API (returns ALL games including conference tournament games not in v1 API)
- [x] Add NCAAM_AN_SLUG_ALIASES for v2 API slug differences: wichita-state-shockers, south-florida-bulls, pennsylvania-quakers
- [x] Update getNcaamTeamByAnSlug() to apply NCAAM_AN_SLUG_ALIASES for transparent v1/v2 resolution
- [x] Update refreshAnApiOdds() to use alias-aware getNcaamTeamByAnSlug() for NCAAM slug resolution
- [x] Update refreshAnApiOdds() to pass Open line data (spread, total, ML) through to updateAnOdds()
- [x] FINAL DIAGNOSTIC: 18/18 March 15 games — ALL slugs resolved, ALL DB matched, ALL DK populated, ALL Open populated
- [x] Build OddsCell pill component: rounded rectangle, bold main value + smaller juice below, orange bookmark badge for best-value cell
- [x] Integrate OddsCell into desktop SectionCol BOOK cells (DesktopMergedPanel)
- [x] Integrate OddsCell into desktop OddsLinesPanel BOOK cells
- [x] Integrate OddsCell into mobile OddsTable BOOK cells (full mode)
- [x] Integrate OddsCell MODEL cells with pill style (neon green edge / white non-edge)
- [x] Ensure OddsCell scales seamlessly across all breakpoints (clamp-based sizing)
- [x] DEBUG: Diagnose why DK NJ spread shows wrong value (user reports Dayton +3.5 -118 on DK NJ but app shows different)
- [x] DEBUG: Diagnose why book odds update constantly/dynamically (possibly pulling live-betting lines from AN instead of pre-game)
- [x] FIX: Ensure AN scraper targets only pre-game DK NJ lines, not live/in-game lines
- [x] FIX: Ensure correct book (DK NJ) and correct line type (spread, not live) is being stored and displayed

## AN Odds Pipeline Hardening + Odds History (March 15, 2026)
- [x] Add odds_history table to drizzle schema (gameId, sport, scrapedAt UTC, source, awaySpread, awaySpreadOdds, homeSpread, homeSpreadOdds, total, overOdds, underOdds, awayML, homeML)
- [x] Run db:push to migrate schema
- [x] Build insertOddsHistory() and listOddsHistory() DB helpers
- [x] Freeze odds on game start: skip updateAnOdds() for games with gameStatus='live' or 'final'
- [x] Change AN refresh schedule from 30-min to hourly, 3am–midnight PST
- [x] Write to odds_history on every AN refresh (auto + manual)
- [x] Ensure manual Refresh Now button also writes to odds_history
- [x] Build OddsHistory UI component in Publish Projections (per-game collapsible table, EST timestamps)
- [x] Confirm EST timestamp: DST-aware (10:59am PDT → 1:59pm EDT; 10:59am PST → 1:59pm EST)
- [x] Write vitest tests for odds freeze logic and history insertion
- [x] Save checkpoint

## Publish Projections UX Fixes (March 15, 2026 - Round 2)
- [x] Verify OddsHistoryPanel is visible and functional on every game card in Publish Projections
- [x] Fix OddsHistoryPanel to render correctly (tRPC procedure wired, component placement confirmed)
- [x] Scope "Refresh Now" button to only refresh the active sport tab (NCAAM/NBA/NHL)
- [x] Scope "Publish All" button to only publish games on the active sport tab
- [x] Pass active sport to triggerRefresh tRPC procedure so server only refreshes that sport
- [x] Add deep server-side logging to refresh pipeline (sport-scoped, per-game, freeze detection)
- [x] Add deep server-side logging to publish pipeline (sport-scoped, per-game publish confirmation)
- [x] Add deep client-side logging for Refresh Now and Publish All button actions

## NHL Model Pipeline
- [ ] Write nhl_model_engine.py: Monte Carlo model with NaturalStatTrick + goalie factor
- [ ] Write nhlNaturalStatScraper.ts: scrape team stats from NaturalStatTrick
- [ ] Write nhlGoalieScraper.ts: scrape goalie stats from NaturalStatTrick
- [ ] Write nhlRotoWireScraper.ts: scrape starting goalies from RotoWire
- [ ] Add NHL-specific DB columns: awayPuckLineOdds, homePuckLineOdds, awayStartingGoalie, homeStartingGoalie, modelAwayGoals, modelHomeGoals
- [ ] Run db:push to migrate new NHL columns
- [ ] Write nhlModelEngine.ts: TypeScript wrapper that spawns nhl_model_engine.py
- [ ] Write nhlModelSync.ts: auto-detect new NHL games, run model, store unpublished projections
- [ ] Wire nhlModelSync into vsinAutoRefresh.ts cron (hourly, 3am-midnight PST)
- [ ] Wire nhlModelSync into runVsinRefreshManual (sport-scoped)
- [ ] Extend Publish Projections page to show puck line odds for NHL game cards
- [ ] Ensure Refresh Now and Publish All on NHL tab only trigger NHL pipeline
- [ ] Write vitest tests for NHL model engine and scraper
- [ ] Save checkpoint

## NHL Model Pipeline (Mar 15, 2026)
- [x] Write NHL Monte Carlo model engine Python script (nhl_model_engine.py) — NaturalStatTrick + MoneyPuck + RotoWire data sources
- [x] Build NaturalStatTrick team/player/goalie stats scraper (nhlNaturalStatScraper.ts)
- [x] Build RotoWire starting goalie scraper (nhlRotoWireScraper.ts)
- [x] Build NHL model engine TypeScript wrapper (nhlModelEngine.ts) — stdin/stdout JSON bridge
- [x] Extend DB schema with NHL-specific fields (awayGoalie, homeGoalie, awayGoalieConfirmed, homeGoalieConfirmed, modelAwayPLCoverPct, modelHomePLCoverPct)
- [x] Run db:push to migrate NHL-specific columns
- [x] Build nhlModelSync.ts: auto-detect new games, run model, store unpublished projections
- [x] Wire nhlModelSync into server startup (_core/index.ts)
- [x] Wire runVsinRefreshManual to call syncNhlModelForToday when NHL is in scope
- [x] Update Publish Projections: show PUCK LINE label instead of SPREAD for NHL
- [x] Update Publish Projections: show goalie names (confirmed=green, projected=amber) below team names for NHL
- [x] Update Publish Projections: show puck line odds in Book column for NHL
- [x] Update Publish Projections: show PL Odds column header instead of Book ML for NHL
- [x] Ensure Refresh Now and Publish All on NHL tab only operate on NHL data
- [x] Write 24 vitest tests for NHL model pipeline (puck line odds, goalie adj, cover pct, sport-scoping, freeze detection)

## NHL Sharp Line Origination Engine Rewrite (Mar 15, 2026)
- [ ] Rewrite nhl_model_engine.py: correlated NB distributions (k=7-10, rho=0.12-0.18), 200k sims
- [ ] Implement OFF_rating (xGF60 0.40, HDCF60 0.20, Rush60 0.15, Rebounds60 0.10, ShotAttempts60 0.15)
- [ ] Implement DEF_rating (xGA60 0.40, HDCA60 0.25, RushAllowed 0.20, SlotShots 0.15)
- [ ] Implement goalie_multiplier = 1 - (GSAX / shots_faced), typical range 0.92-1.08
- [ ] Implement fatigue factors (normal=1.00, 1-day=0.97, B2B=0.94)
- [ ] Implement home_ice = 1.04
- [ ] Implement pace_factor from combined shot rate
- [ ] Ensure ML/PL/total all derive from same joint distribution (no independent estimation)
- [ ] Update nhlNaturalStatScraper.ts to supply Rush60, Rebounds60, SlotShots, HD Save%, workload
- [ ] Update nhlModelEngine.ts to pass new input fields
- [ ] Update nhlModelSync.ts to pass new scraped fields to model
- [ ] Verify model output consistency constraints (Section 11)
- [ ] Run tests, verify engine produces correct output, save checkpoint

## NHL Improvements (Mar 15 2026 - Round 2)
- [ ] Add Puck Line odds input (awayPLOdds, homePLOdds) and Over/Under odds inputs (overOdds, underOdds) to NHL game cards in Publish Projections
- [ ] Upgrade edge detection in nhl_model_engine.py to full probability-space engine (Sections 1-12 pseudocode): implied prob → no-vig → model prob → EV → edge classification for ML, PL, Total
- [ ] Wire real rest-days from last game date into fatigue multiplier in nhlModelSync.ts
- [ ] Add RotoWire injury feed check: poll for goalie scratches every 30 min, auto-update DB goalie fields, re-run model if starter is scratched

## Current Sprint (Mar 15, 2026)
- [x] Add awayPLOdds/homePLOdds state + input fields to EditableGameCard PUCK LINE section (NHL only)
- [x] Add overOdds/underOdds state + input fields to EditableGameCard TOTAL section (NHL only)
- [x] Wire NHL odds inputs into handleSave, handleReset, computeEdges
- [x] Implement industry-grade Sharp Edge Detection Engine in nhl_model_engine.py (distribution-translated, vig-removed, EV + classification)
- [x] Build 10-minute RotoWire goalie auto-check cron (nhlGoalieWatcher.ts)
- [x] Parse RotoWire lineups page for goalie name + status (Confirmed/Expected)
- [x] Compare scraped goalies vs DB; if confirmed starter changed, update DB + re-run NHL model
- [x] Register goalie watcher in server startup + add tRPC procedures for manual trigger
- [ ] Wire real rest days into fatigue multiplier (days since last game from schedule)

## Sprint Mar 15, 2026 — Part 2

- [x] Build Hockey Reference schedule scraper (nhlHockeyRefScraper.ts) — parse https://www.hockey-reference.com/leagues/NHL_2026_games.html for all game dates by team
- [x] Wire rest-days (days since last game) into nhlModelSync.ts and pass to Python model engine as away_rest_days / home_rest_days
- [x] Fix nhlModelSync.ts team abbrev resolution — use NHL_BY_DB_SLUG instead of .toUpperCase() (was silently failing for TBL, CBJ, NJD, NYI, NYR, LAK, SJS, VGK)
- [x] Add Utah Hockey Club AN slug alias (utah-hockey-club → utah_mammoth) in nhlTeams.ts + use getNhlTeamByAnSlug helper in vsinAutoRefresh.ts
- [x] Audit AN NHL scraper — confirmed all markets (PL, total, ML) and both books (Open + DK NJ) are captured and written to DB correctly
- [x] Display goalie name + confirmed/expected status below each team name in NHL Publish Projections game cards (desktop + mobile)
- [x] Add Goalie Watcher last-check timestamp + change count + model re-run indicator to NHL stats bar
- [x] Trigger goalie watcher check when "Refresh Now" is clicked while NHL tab is active
- [x] Write 30 unit tests for all new NHL features (rest days, abbrev resolution, Utah alias, americanOddsToBreakEven, matchGameToDb) — all passing

## Sprint Mar 15, 2026 — Part 3 (NHL Auto-Model + Goalie Fix)

- [ ] Fix nhlRotoWireScraper.ts: use .lineup__player-highlight selector, extract full goalie name from .lineup__player-highlight-name a, status from .is-confirmed/.is-expected class
- [ ] Fix RotoWire team abbrev extraction: use .lineup__abbr (is-visit = away, is-home = home) not the advanced-lineups approach
- [ ] Auto-trigger NHL model immediately when both goalies are populated for a game (in goalie watcher + on server startup)
- [ ] nhlModelSync.ts: on startup, run model for all today's NHL games that have both goalies but no modelRunAt
- [ ] Ensure every game card in Publish Projections shows goalie name + confirmed/expected status
- [ ] Fix goalie watcher to use correct HTML selectors matching pasted_content_21.txt structure

## NHL Pipeline Fixes (2026-03-15)
- [x] Fix NST goalie stats URL: goaliestats.php (404) → playerteams.php?stdoi=g
- [x] Fix NST team name normalization: full names ("Chicago Blackhawks") → 3-letter abbrevs ("CHI")
- [x] Fix NST dot-notation codes: N.J → NJD, S.J → SJS, T.B → TBL, L.A → LAK
- [x] Add vitest tests for normalizeAbbrev (8 tests, all passing)
- [x] Implement new puck line origination engine in Python model (Sections 1-9 of spec)
- [x] Implement new Total Origination Engine (compute_pace_factor, fix NoneType SA_60 bug)
- [x] Fix NoneType + NoneType bug in compute_pace_factor (SA_60 None handling)
- [x] Fix RotoWire goalie watcher: ensure all current-day NHL games show goalie names with confirmed/expected status
- [x] Verify full NHL model pipeline: real NST stats used, valid puck lines produced, goalie data populated
- [x] Display model puck line odds on Publish Projections page (e.g., -1.5 (-115) / +1.5 (+105))
- [x] Display model total odds on Publish Projections page (e.g., 6.5 O(-110) / U(-110))
- [x] Fix GoalieWatcher to process ALL games on RotoWire (live + final + upcoming), not just upcoming
- [x] Add schema columns: modelAwayPLOdds, modelHomePLOdds, modelOverOdds, modelUnderOdds, modelPuckLineSpread
- [x] Add vitest tests for GoalieWatcher (12 tests passing)
- [x] Display model puck line odds on public feed GameCard for NHL games
- [x] Display model total odds on public feed GameCard for NHL games

## NHL Model Improvements (2026-03-15 Session 2)
- [x] Display model puck line odds on public feed GameCard for NHL games (MODEL LINES column)
- [x] Display model total odds on public feed GameCard for NHL games (MODEL LINES column)
- [ ] Auto-trigger model run when both goalies are populated (GoalieWatcher + server startup)
- [ ] Add goalie confirmed/expected status badges to Publish Projections NHL game cards
- [ ] Rewrite NHL model engine: single Monte Carlo simulation core (N=50000 trials)
- [ ] All markets (ML, PL, O/U) derived from same simulation distribution
- [ ] Remove all separate calculation paths (no spread = expected_home - expected_away)
- [ ] Verify mathematically consistent outputs: ML/PL/total all from same sim
- [ ] Expand NST scraper to pull HDCF%, SCF%, HDCF/60, HDCA/60, Rush/60, RushA/60, Reb/60, Slot Shots for all teams
- [ ] Update NhlTeamStats type and DB schema with all new columns
- [ ] Remove fallback paths in compute_off_rating and compute_def_rating - require all fields
- [ ] Run DB migration and force model re-run with complete data
- [x] Fix goalie multiplier: Bayesian regression (K=500) prevents tiny-sample backups from dominating (Brossoit 1 GP: 1.106 → 1.004)
- [x] Add 6 new vitest tests for Bayesian goalie multiplier regression behavior (308 total passing)
- [x] Raise edge detection thresholds: ML=5pp, PL=6pp, Total=8pp to reduce noise
- [x] Re-run all 6 March 15 NHL games with corrected goalie model
- [ ] Fix total edge direction: book u6.5 +114 vs model u6.5 -118 should flag UNDER edge, not OVER
- [ ] Fix puck line model odds: +468/+155 are wildly wrong (should be realistic ±1.5 cover probabilities)
- [ ] Add nightly league-average recalibration cron job (scrape NST each morning, update engine constants)
- [ ] Add C3 violation alerts to Publish Projections admin panel (P(home-1.5) > P(home_win) flag)
- [ ] Full audit: NHL puck line odds calculation (Python engine) - mkt_pl_away_odds bug
- [ ] Full audit: NHL total odds calculation and edge direction (Python engine + GameCard)
- [ ] Full audit: NHL moneyline odds calculation (Python engine)
- [ ] Full audit: DB storage of model odds (nhlModelSync writes)
- [ ] Full audit: GameCard display of all NHL model values across all 3 panels
- [ ] Fix all identified bugs in puck line, total, ML calculations and display
- [x] Fix NHL puck line mkt_pl computation: favorite-aware logic (away-fav games were computing P(home wins by 2+) instead of P(away wins by 2+))
- [x] Fix NHL puck line edge detection: same favorite-aware fix applied to edge detection section
- [x] Fix NHL model spread display: modelAwayPuckLine/modelHomePuckLine now mirrors book spread (not model origination)
- [x] Fix NHL total edge direction: GameCard now uses model odds at book line to determine over/under edge direction
- [x] Fix ML vs puck line mathematical inconsistency: WPG ML=+106 (48.6% win) but WPG -1.5 puck line=-273 (73% cover) — impossible, team with 48.6% win rate cannot be 73% to win by 2+
- [x] Fix puck line favorite assignment: team with more negative ML should always be at -1.5; derive book spread from ML odds not spread field (STL -112 ML = STL is -1.5 favorite, not WPG)
- [x] NHL puck line fallback: when DK gives ML favorite a +1.5 spread, use FanDuel spread instead (if both DK and FD give +1.5 to ML fav, keep DK as-is)
- [ ] NHL puck line consensus: use DK + Open majority vote to determine -1.5 favorite (not ML-based); FD is outlier for STL@WPG
- [ ] NHL puck line best odds: display best available odds between DK NJ and FD NJ for each side of the puck line
- [ ] Revert NHL puck line to DK NJ only — remove FD fallback and ML-based override, use DK spread as-is
- [x] Fix STL@WPG spread: DK NJ has WPG Jets -1.5 (+235), STL Blues +1.5 (-290) — DB corrected + model re-run + edge label fix
- [x] Audit Python engine edge detection: verify model implied prob > book break-even prob for ML, PL, total
- [x] Fix any incorrect edge direction logic in Python engine
- [x] Add deep diagnostic logging for all edge calculations (break-even, implied prob, edge pp, verdict)
- [x] Fix mobile odds cell overlap: redesign OddsCell to two-line dark card style (line value top white, odds bottom neon green), fix grid spacing
- [x] Fix 1: One sticky global column header (SPREAD/TOTAL/ML + BOOK/MODEL sub-labels) — remove per-card headers
- [x] Fix 2: Collapse FINAL/LIVE status into card top-left — remove full-width status row
- [x] Fix 3: Remove green borders from MODEL cells — color-only distinction (bright green text, dark cell, no border)
- [x] Fix 4: Bind score tightly to team name — same row, adjacent, brand green when live
- [x] Fix 5: Add Edge Badge as rightmost column on each game card
- [x] Rename MDL → MODEL everywhere in UI
- [x] Implement calculateEdge/getVerdict/getEdgeColor helpers in GameCard.tsx (juice-only math, per-market independent)
- [x] Redesign EdgeBadge: 3 stacked rows (SPR/O/U/ML) with verdict label + pp value, dynamic bg/border from bestEdge
- [x] Apply BettingCell color grammar: line=white/75% 400 11px, juice=white/90% or neon green 700 18px
- [x] Wire all three market edges from juice numbers (not string parsing), recalculate on every render
- [x] Shrink left panel to 80px — keep logo (20px) and star button (compact 10px)
- [x] Show abbreviation-only team name (e.g. "STL") + score on same row in left panel
- [x] Replace circular sub-cells with flat 2-column BettingCell grid (BK/MDL headers, line, juice rows)
- [x] Equalize all 3 market columns to flex-1 (SPREAD/TOTAL/ML identical width)
- [x] EdgeBadge fixed at 60px (w-[60px] shrink-0)
- [x] Outer row: gap-[4px] to fit 375px screen budget
- [x] Make team logos bigger in left panel (from 20px to 28px)
- [x] Use city abbreviations instead of team abbreviations (NHL: official abbrev e.g. "NSH", "EDM")
- [x] Spell out BOOK and MODEL in BettingCell header (not BK/MDL)
- [x] Edge-conditional neon green: only MODEL juice is green when that side has an edge; both white if no edge
- [x] Add empty spacer row above ML odds to align with SPREAD/TOTAL line row height
- [x] Run NHL model for all 5 March 16 2026 games manually
- [x] Post all 5 NHL model projections to the main feed (publishedModel=1 for all 5 games)
- [x] Wire automatic daily NHL model execution (scheduler every 30min 9AM-9PM PST, auto-approve after each run)

## UI/Discord Fixes (March 18, 2026)
- [x] Fix Discord /auth/discord/connect 404 on production — moved all routes to /api/auth/discord/* (Manus proxy only forwards /api/* to Express)
- [x] Deep-audit route registration chain: confirmed routes registered before serveStatic catch-all
- [x] Add granular checkpoint logging at every layer of Discord OAuth flow (CHECKPOINT:1-9, A-C)
- [x] Verify production build includes Discord routes (confirmed in dist/index.js at line 3184)
- [x] Test Discord OAuth end-to-end on dev server — all 3 routes respond correctly
- [x] Update frontend ModelProjections.tsx to use /api/auth/discord/* URLs
- [x] Add route prefix invariant tests to discordAuth.test.ts (6 new tests, all passing)
- [x] Update Discord Developer Portal redirect URI to https://aisportsbettingmodels.com/api/auth/discord/callback
- [x] Fix redirect_uri construction: x-forwarded-host resolves to internal Cloud Run hostname (*.a.run.app) not public domain
- [x] Added PUBLIC_ORIGIN env var (set to https://aisportsbettingmodels.com) — used as canonical origin for redirect_uri
- [x] Add deep CHECKPOINT:1-10 + A-C logging at every step of OAuth flow including all proxy headers
- [x] Add PUBLIC_ORIGIN invariant tests (3 new tests: value set, no trailing slash, exact callback URL match)
- [x] Confirmed PUBLIC_ORIGIN=SET in dev server startup log
- [ ] Test Discord OAuth end-to-end on published site after publishing
- [x] Check callback logs to confirm DB write succeeded — DB columns exist and updateAppUser call is correct
- [x] Add Discord Status column to User Management table (Connected/Not Connected badge with Discord logo)
- [x] Add Discord Username column to User Management table (@username in Discord purple or —)
- [x] Verified header button shows @discordUsername when discordId is set, Connect Discord when null
- [x] Added discord_linked/discord_error URL param handler in ModelProjections.tsx — force-refetches appUsers.me and shows toast
- [x] Updated colSpan from 9 to 10 for loading/empty state rows in UserManagement table
- [x] Hard-lock EDGE ROI footer in GameCard - remove EDGE column rendering permanently
- [x] Ensure edge footer shows for all sports (NHL, NBA, NCAAM) in MODEL PROJECTIONS

## Discord DB-Backed State Fix (March 18, 2026)
- [x] Root cause identified: in-memory CSRF state fails across Cloud Run instances (state_mismatch)
- [x] Add discord_oauth_states table to schema (state, userId, expiresAt, createdAt)
- [x] Run db:push to migrate discord_oauth_states table to production DB
- [x] Rewrite discordAuth.ts: DB-backed state storage (insert on /connect, lookup+delete on /callback)
- [x] Add exhaustive CHECKPOINT:1-11 + A-C logging at every step of the OAuth flow
- [x] Add DB write verification in CHECKPOINT:10 (read-back after updateAppUser to confirm write)
- [x] Add cleanup of expired states on each /connect and /callback request
- [x] Write test-discord-connect.ts: verifies JWT → /connect → DB state row inserted → correct redirect_uri
- [x] Write test-discord-callback.ts: verifies DB state lookup → token exchange → state consumed
- [x] Both test scripts PASS: state_mismatch eliminated, token_exchange_failed on fake code (expected)
- [x] TypeScript: 0 errors. 23/23 Discord tests passing.
- [ ] Test Discord OAuth end-to-end on published site after publishing

## Discord Button Branding & One-Time Lock (March 18, 2026)
- [x] Restyle Discord button: solid #738ADB bg, white text, GG Sans font, Discord SVG logo — no opacity/transparency
- [x] Not connected state: Discord logo + "CONNECT DISCORD" (white, GG Sans, read-only link to /api/auth/discord/connect)
- [x] Connected state: Discord logo + "@DISPLAYNAME" (white, GG Sans, read-only div — no click, no disconnect)
- [x] Remove all user-facing disconnect options from ModelProjections.tsx (confirmed by test)
- [x] Remove disconnect mutation call from frontend (users cannot disconnect their own Discord)
- [x] Add owner-only Disconnect button in User Management table (Discord logo icon, hover Discord purple)
- [x] Add appUsers.adminDisconnectDiscord ownerProcedure on server (clears discordId/Username/Avatar/ConnectedAt)
- [x] Load GG Sans woff2 fonts via @font-face in index.html (CDN-hosted, 4 weights: 400/500/600/700)
- [x] Apply GG Sans to Discord button only via inline fontFamily style (not global font change)
- [x] Updated discordAuth.test.ts: replaced disconnect URL test with one-time-only policy invariant test
- [x] TypeScript: 0 errors. 331/332 tests passing (1 pre-existing KenPom env var test)

## Discord Button Color Fix & Uniqueness Enforcement (March 18, 2026)
- [x] Change Discord button color from #738ADB to #3238a9 (darker, richer blue)
- [x] Ensure mobile shows full text: CONNECT DISCORD or @DISPLAYNAME (removed hidden sm:inline, always visible)
- [x] Server-side uniqueness check already implemented at CHECKPOINT:9 (already_linked redirect)
- [x] Added comprehensive error messages map: already_linked shows clear "Each Discord account can only be connected to one account" message
- [x] One-time-only connection policy intact: no user disconnect option, owner-only in User Management

## Mobile Header Layout Fix (March 18, 2026)
- [x] Fix PREZ BETS title overlapping CONNECT DISCORD button on mobile
- [x] Removed absolute centering (absolute left-1/2 -translate-x-1/2) — replaced with left-aligned flex item
- [x] PREZ BETS left-aligned, Discord button + user icon right-aligned via flex-1 spacer
- [x] Dynamic font scaling via clamp(12px, 3.5vw, 18px) for brand text, clamp(14px, 3.5vw, 20px) for icon
- [x] TypeScript: 0 errors

## March Madness Focus (March 2026)
- [x] Rename NCAAM → MARCH MADNESS in all UI labels (tabs, headers, subtitles)
- [x] Create MARCH_MADNESS_TEAMS allowlist (68 bracket teams) in shared/marchMadnessTeams.ts
- [x] Filter NCAAM feed to only show March Madness bracket teams
- [x] Populate First Four games (PV A&M vs Lehigh, Miami OH vs SMU) with VSiN odds/splits
- [x] Publish First Four games to feed
- [x] Ensure auto-refresh pipeline only ingests March Madness games going forward (VSiN scraper accepts all D1; feed API filters to bracket teams only)
- [x] Cross-reference First Four game odds (VSiN vs Action Network) for PV A&M vs Lehigh and Miami OH vs SMU

## March Madness Full Feed Audit (March 18, 2026)
- [x] Identify and fix 2 missing Round of 64 games — confirmed 30 R64 in DB + 2 TBD (FF-dependent, not yet in DB)
- [x] March 17 First Four games (UMBC vs Howard, Texas vs NC State) — already played, not added (daily purge would delete them; historical only)
- [x] VSiN has not yet posted R64 odds (March 19-20 games) — auto-refresh will pick them up as they go live
- [x] Publish BYU vs Texas and Howard vs Michigan (R64 games with complete odds+splits) — published ✅
- [x] Unpublish 4 non-bracket contaminating games (navy/wake_forest, dayton/bradley, george_washington/utah_valley, sam_houston_st/new_mexico)
- [x] isValidGame filter in routers.ts confirmed working — blocks all non-bracket NCAAM teams at API layer
- [x] Re-run full audit — confirmed: 4 games on feed (2 FF + 2 R64), all with complete odds+splits, zero contamination

## Bracket Region Verification (March 18, 2026)
- [x] EAST region (8 games) verified against NCAA.com HTML — all 8 match DB
- [ ] SOUTH region (8 games) verified against NCAA.com HTML
- [ ] WEST region (8 games) verified against NCAA.com HTML
- [ ] MIDWEST region (8 games) verified against NCAA.com HTML

## Bracket Fixes (2026-03-19)
- [x] Fix bracket advancement: TCU won (66 vs Ohio St. 64) but has not advanced to next round slot
- [x] Fix team row layout: logos must only appear on the LEFT side; scores must appear on the RIGHT side (remove right-side logo circles)
- [x] Audit all completed March 19 R64 games and auto-advance winners to R32 slots
- [x] Ensure bracket advancement is fully automated (score refresh triggers advancement)

## March 20 Model Runs (2026-03-20)
- [x] Model and publish game 1: Santa Clara @ Kentucky (09:15 EST) — spread +2.0/-2.0, total 150.0, MOD edges on spread+total
- [x] Model and publish game 2: Akron @ Texas Tech (09:40 EST) — spread +8.0/-8.0, total 150.5, LOW edge on total UNDER
- [x] Model and publish game 3: LIU Brooklyn @ Arizona (10:35 EST) — spread +27.0/-27.0, total 143.5, HIGH edges on spread+total

## March 20 Model Runs — Games 4–8 (2026-03-20)
- [x] Model and publish game 4: Wright St. @ Virginia (10:50 EST) — spread +15.5/-15.5, total 141.5, LOW edges on spread+total UNDER
- [x] Model and publish game 5: Tennessee St. @ Iowa St. (11:50 EST) — spread +22.5/-22.5, total 142.5, MOD edges on spread+total UNDER
- [x] Model and publish game 6: Hofstra @ Alabama (12:15 EST) — spread +10.0/-10.0, total 153.0, MOD edges on spread+total UNDER
- [x] Model and publish game 7: Utah St. @ Villanova (13:10 EST) — spread -0.5/+0.5, total 143.0, LOW edge on total UNDER
- [x] Model and publish game 8: Miami OH @ Tennessee (13:25 EST) — spread +11.5/-11.5, total 144.0, MOD edge on total UNDER

## March 20 Model Runs — Remaining Games (2026-03-20)
- [x] Publish game 9: Iowa @ Clemson (15:50) — spread -1.5/+1.5, total 131.0, no edges
- [x] Publish game 10: N. Iowa @ St. John's (16:10) — spread +8.0/-8.0, total 128.0, LOW spread edge
- [x] Publish game 11: UCF @ UCLA (16:25) — spread +4.5/-4.5, total 149.0, no edges
- [x] Publish game 12: Queens NC @ Purdue (16:35) — spread +22.0/-22.0, total 159.0, LOW spread edge
- [x] Publish game 13: Prairie View A&M @ Florida (18:25) — spread +30.5/-30.5, total 148.5, HIGH edges
- [x] Publish game 14: Cal Baptist @ Kansas (18:45) — spread +11.5/-11.5, total 134.5, HIGH edges
- [x] Publish game 15: Furman @ Connecticut (19:00) — spread +18.5/-18.5, total 134.5, LOW total edge
- [x] Publish game 16: Missouri @ Miami FL (19:10) — spread +3.5/-3.5, total 145.0, LOW total edge
- [x] Fix date for 4 games incorrectly tagged as March 20 (Michigan St, TCU, Nebraska, Arkansas) — moved to 2026-03-21 with correct VSiN lines
- [x] Trigger model watcher for 2026-03-21 — modeled 7 games (Michigan St, TCU, Nebraska, Arkansas, Saint Louis, VCU, Liberty)
- [x] All 16 March 20 NCAAM games: published=16/16, modeled=16/16

## Bracket Tab Full Overhaul (2026-03-20)
- [x] Teams must STAY in R64 slot with final scores; loser dimmed, winner highlighted — do NOT remove teams from R64
- [x] Winners correctly populate R32/R16/E8/F4/Championship slots
- [x] Connector SVG lines: gapless, no disconnected matchups in any region
- [x] Zoom/scroll/pan: fully functional on mobile, tablet, desktop
- [x] Responsive scaling: correct bracket sizing across all screen sizes
- [x] Full audit: all regions (SOUTH, EAST, MIDWEST, WEST), all rounds, all scores accurate
- [x] Debug logging: bracket data flow from DB → component → render
- [x] Re-insert 16 missing R64 games + 4 First Four games deleted by daily purge
- [x] Protect bracket games from daily purge (bracketGameId IS NOT NULL exclusion in deleteOldGames)
- [x] Auto-scale on load: bracket fits viewport width after data loads (useLayoutEffect + setTimeout 300ms)
- [x] Auto-scale re-runs on window resize

## Bracket Mobile Fix (2026-03-20)
- [ ] Fix auto-scale not firing on mobile (375px viewport) — bracket renders at full 2012px width- [x] Fix auto-scale on mobile — ResizeObserver on bk-layout to read offsetWidth (not scrollWidth inside overflow:hidden)
- [x] Fix touch zoom/pan — pinch-to-zoom and drag-to-pan on iOS Safari
- [x] Fix page scroll conflict — bracket container must capture touch events without blocking page scroll
- [x] Fix bracket container height on mobile — must fill viewport without overflow
- [x] Ensure transform-origin is top-left so scaled bracket starts at top-left corner of bracket canvas on all screen sizes (mobile, tablet, desktop)

## Bracket Connector Audit (2026-03-20)
- [ ] Deep debug connector logic: inject articulate logging for all card positions, midpoints, path coordinates
- [ ] Fix connector gaps: every R64→R32→S16→E8 transition must be gapless in all 4 regions
- [ ] Fix RTL connector direction: WEST and MIDWEST regions connect right-to-left correctly
- [ ] Verify connector scaling: paths are drawn in the wrap coordinate space (unaffected by canvas scale transform)
- [ ] Verify connector redraw fires after auto-scale changes the canvas transform

## Bracket Connector Full Fix (2026-03-20)
- [ ] Fix drawConnectors: use cy(tgt) as yMid convergence point (not midpoint of source cards)
- [ ] Fix R64→R32→S16→E8 connectors in all 4 regions (28 transitions, max 40.1px offset)
- [ ] Fix E8→Final Four connectors (LTR E8 right edge → FF left; RTL E8 left edge → FF right)
- [ ] Fix Final Four→Championship connectors (FF top/bottom cards → Champ center)
- [ ] Verify all transitions ≤1px offset after fix

## Bracket Layout Redesign — Championship Dead Center (2026-03-20)
- [ ] Championship card must be in the absolute dead center of the bracket canvas
- [ ] Work backwards: FF cards flank Championship left/right, E8 cards flank FF, S16 flank E8, R32 flank S16, R64 outermost
- [ ] All connectors radiate inward from R64 → R32 → S16 → E8 → FF → Championship
- [ ] EAST and SOUTH regions on the LEFT half (LTR), WEST and MIDWEST on the RIGHT half (RTL)
- [ ] Vertical centering: Championship at vertical midpoint, regions stacked above/below

## Bracket Spacing / Overlap Fix (2026-03-20)
- [ ] Compute mathematically exact layout: no overlap, no clamping, consistent gaps across all rounds
- [ ] Championship at exact dead center (y = layoutHeight / 2)
- [ ] FF cards equidistant above/below Championship, not overlapping E8 cards
- [ ] R64 gaps computed from card height so no cards overlap within a column
- [ ] R32/S16/E8 gaps computed as 2x/4x/8x the R64 gap (standard bracket doubling)
- [ ] ROUND_PAD values computed so card[0] center aligns with its feeder midpoint
- [ ] All connector paths arrive at exact card center-Y (no offset)

## Discord Splits Card Quality Improvements (2026-03-24)
- [x] Embed Barlow Condensed fonts as base64 data URIs in splits_card.html (no CDN dependency)
- [x] Fix center header readability: "@" symbol bright white (30px bold), league/time/date fully visible
- [x] Fix JS syntax error in onerror handler (use global logoErr() function instead of inline code)
- [x] Enable 2x device pixel ratio rendering (--force-device-scale-factor=2) for maximum sharpness
- [x] Use scale:"device" in Playwright screenshot for crisp 2x output

## Discord Splits Card v2 (2026-03-24)
- [x] Remove "NBA · DAILY BETTING SPLITS" subtitle from center header (keep @ symbol, time, date only)
- [x] Fix Over color to #39FF14 (neon green), Under color to #FF1818 (bright red)
- [x] Add sport filter option to /splits command: NBA, NHL, NCAAM, ALL
- [x] Add game selection option: ALL (post all games) or individual game picker (select one game)
- [x] Update fetchAllDailySplits to accept optional sport parameter
- [x] Wire autocomplete handler in bot.ts for game picker
- [x] Re-register Discord slash command with new sport/game/date options

## Discord Splits Card v3 (2026-03-24)
- [x] Remove Discord header text message ("📊 Daily Betting Splits — ...") from /splits posts
- [x] Increase card canvas width 820px → 1100px for higher resolution output
- [x] Increase Playwright viewport 860px → 1160px
- [x] Make city names significantly bigger: 22px → 30px
- [x] Make team nicknames bigger: 11px → 15px
- [x] Make team logos bigger: 54px circle → 80px circle, 38px image → 58px image
- [x] Increase overall card padding and spacing for premium feel
- [x] Increase market section fonts: labels 12px → 16px, line values 26px → 36px, bars 26px → 34px

## Discord Splits Card Logo Fix (2026-03-24)
- [x] Debug onerror handler: ROOT CAUSE = inline onerror with double-quoted style string broke HTML attribute parsing, leaking fallback text as DOM content
- [x] Fix logoHTML function: removed inline onerror entirely, use hidden .abbr-fallback span + JS addEventListener after DOM build
- [x] Verified fix with GSW/DAL logos: images load cleanly (naturalWidth=500), fallback span stays display:none
- [x] Rebuilt splits_card.html v4 with corrected logo rendering

## Remove March Madness Bracket (2026-03-24)
- [x] Remove Bracket tab from navigation/sidebar (FEED_TABS, bracket pill button)
- [x] Delete MarchMadnessBracket.tsx page component permanently
- [x] Remove /bracket route and MarchMadnessBracket import from App.tsx
- [x] Remove bracket type from FeedMobileTab, GameCard props, VirtualizedGameList
- [x] Remove CDN_MARCH_MADNESS constant and March Madness icon from nav pill
- [x] NCAAM pill now shows plain text label with no icon

## Sport Tab Auto-Hide (2026-03-24)
- [x] Add tRPC procedure games.activeSports returning which sports have games today or tomorrow (UTC)
- [x] Add getActiveSports() helper to db.ts using groupBy query on gameDate + sport
- [x] Update ModelProjections.tsx to query activeSports and hide pills with no upcoming games
- [x] Auto-switch selected sport if current sport becomes hidden (fallback: NHL → NBA → NCAAM)
- [x] Pills show during loading (activeSports undefined) to avoid flash of empty nav

## NCAAM Tab Visibility Bug (2026-03-24)
- [x] Debug: ROOT CAUSE = getActiveSports counted unpublished regular season NCAAM games (wichita_st@tulsa, st_josephs@new_mexico) that have odds but publishedToFeed=0 and no bracketGameId
- [x] Fix: NCAAM now requires bracketGameId IS NOT NULL — only March Madness bracket games trigger the tab
- [x] Verified: [activeSports] log confirms NCAAM=false when no bracket games exist today/tomorrow

## Discord Splits Card Total Bar Colors (2026-03-24)
- [x] Over bar: now uses CSS var(--away-primary) — matches away team color
- [x] Under bar: now uses CSS var(--home-primary) — matches home team color
- [x] Verified via test render: MIL(green) Over / LAC(blue) Under display correctly

## /splits Command Channel Targeting (2026-03-24)
- [ ] Audit splitsCommand.ts: find where target channel is set (hardcoded vs interaction.channelId)
- [ ] Update execute() to post cards to interaction.channelId (the channel where /splits was run)
- [ ] Add detailed logging: log channelId, gameCount, and per-card success/failure
- [ ] Verify TypeScript compiles cleanly

## /splits Channel Targeting + NYI/NYR Fix (2026-03-24)
- [x] Fix stray backtick syntax error on summary line in splitsCommand.ts (auto-fixed by file tool)
- [x] /splits posts to interaction.channelId (channel where command was run) — removed hardcoded SPLITS_CHANNEL_ID
- [x] Deep debug NYI/NYR splits loading failure:
      ROOT CAUSE: vsinAutoRefresh.ts used raw NHL_BY_VSIN_SLUG.get(g.awayVsinSlug) without applying
      VSIN_NHL_HREF_ALIASES first. VSiN page sends "ny-islanders" and "ny-rangers" but the map
      is keyed on "new-york-islanders" and "new-york-rangers". Silent miss = NULL splits every time.
- [x] Fix: added resolveNhlVsinSlug() helper that applies VSIN_NHL_HREF_ALIASES before map lookup
- [x] Replaced both raw NHL_BY_VSIN_SLUG.get() call sites (today + tomorrow blocks) with resolveNhlVsinSlug()
- [x] Added detailed alias-resolution logging to confirm matches in server logs
- [x] Zero raw NHL_BY_VSIN_SLUG.get() calls remain in the codebase
- [x] Future aliases: add to VSIN_NHL_HREF_ALIASES in shared/nhlTeams.ts only — no code changes needed elsewhere

## Discord Splits Card Team Name Fix (2026-03-24)
- [x] Audit how city/nickname are passed to splits card template (buildCardData in splitsCommand.ts)
- [x] Fixed city/nickname for all NHL/NBA multi-word teams: added city+nickname fields to TeamEntry interface,
      populated from NHL_TEAMS/NBA_TEAMS shared registries (which already have city/nickname),
      fetchSplits.ts now passes away_city/away_nickname/home_city/home_nickname,
      splitsCommand.ts uses these directly instead of splitTeamName() — no more wrapping bugs
- [x] Ensure city line never wraps (single line always) — verified in test renders
- [x] Ensure nickname line never wraps (single line always) — verified in test renders
- [x] Test render VGK, CBJ, TOR, GSW, OKC cards to verify correct display — all confirmed working

## Production ENOENT Fix (2026-03-24)
- [x] Fixed ENOENT: splits_card.html not found in production (/usr/src/app/dist/splits_card.html)
      Root cause: esbuild bundles TS into dist/index.js but never copies static assets.
      In prod, import.meta.url = dist/index.js so __dirname = dist/, but splits_card.html was only in server/discord/.
      Fix: updated build script in package.json to cp splits_card.html, model_v10_engine.py, nhl_model_engine.py to dist/ after esbuild.
      All three files now present in dist/ after build. Verified build output.

## Discord Bot "Application Did Not Respond" Fix (2026-03-24)
- [x] Audit full interaction handling chain: bot.ts, splitsCommand.ts, defer/timeout logic
- [x] Identified root cause: Discord gateway duplicate delivery — same interaction ID delivered twice;
      second delivery hits deferReply on already-acknowledged interaction → throws → outer catch
      tries interaction.reply() but interaction is in broken state → Discord sees no valid response
- [x] Implemented guaranteed immediate deferReply at very top of handleSplitsCommand (before auth check)
      wrapped in try/catch: if deferReply fails (duplicate), bail out immediately with no further action
- [x] Moved access control AFTER deferReply so unauthorized users get editReply (not reply)
- [x] Added interaction deduplication guard in bot.ts: tracks seen interaction IDs for 10s,
      drops duplicates before they reach the command handler
- [x] Added interaction ID to all log lines for full traceability
- [x] Improved outer catch in bot.ts: checks deferred/replied state before choosing editReply vs reply
      logs reply failures separately instead of swallowing them

## /splits Command Performance Optimization (2026-03-24)
- [x] Profiled: 11.6s breakdown = 8.8s Playwright cold-start (76%) + 1.1s render + 0.45s upload + 0.16s deferReply
- [x] Identified root bottleneck: Chromium launched fresh on every command (no warm browser)
- [x] Implemented warmUpRenderer() called on bot login: Chromium + template + 2 pooled pages ready in ~2.6s
      First /splits after restart now finds warm browser — cold-start eliminated
- [x] Parallel rendering: all cards rendered concurrently with Promise.all() — N games = ~1x render time
- [x] Template HTML cached in memory at module load (1.1 MB read once, not on every render)
- [x] Parallel logo fetch: away+home logos fetched with Promise.all() instead of sequentially
- [x] Warm page pool: 2 pre-opened pages maintained; refilled async after each render
- [x] IMAGE_DELAY_MS reduced from 1500ms to 800ms (safe: 1.25 msg/s vs Discord limit of 1 msg/s)
- [x] Granular timing logs: each phase (logo fetch, page claim, setContent, screenshot) logged with ms
- [x] Expected result: 1-card warm = ~1.5s, 4-card warm = ~2.5s (parallel render) + 3x800ms gaps = ~5s total

## MLB Database — Teams + Active Players (2026-03-24)
- [ ] Add brAbbrev field to mlbTeams.ts shared registry (30 teams)
- [ ] Add brAbbrev column to mlb_teams schema
- [ ] Add mlb_players table to schema (brId, name, position, bats, throws, currentTeamBrAbbrev, mlbamId, isActive)
- [ ] Run db:push to create mlb_teams and mlb_players tables
- [ ] Seed all 30 MLB teams with complete data: mlbId, mlbCode, abbrev, vsinSlug, anSlug, anLogoSlug, brAbbrev, name, nickname, city, league, division, logoUrl, primaryColor, secondaryColor, tertiaryColor
- [ ] Seed active players from BR player list HTML (55 active players extracted, mapped to current teams)
- [ ] Verify all 30 teams and active players are correctly stored with accurate team assignments

## MLB Database — Teams + Active Players (2026-03-24)
- [x] Audit existing NHL/NBA team schema and shared registry structure
- [x] Build mlbTeams.ts shared registry: all 30 teams with mlbId, mlbCode, abbrev, brAbbrev, league, division, city, nickname, name, vsinSlug, dbSlug, anSlug, anLogoSlug, logoUrl, primaryColor, secondaryColor, tertiaryColor
- [x] Cross-referenced sources: MLB.com (mlbId, mlbCode), Baseball Reference (brAbbrev), VSiN (vsinSlug), Action Network (anSlug, anLogoSlug), Rotowire (dbSlug)
- [x] Added mlb_teams table to drizzle/schema.ts (19 columns) and ran db:push
- [x] Added mlb_players table to drizzle/schema.ts (12 columns: brId, mlbamId, name, position, bats, throws, currentTeamBrAbbrev, isActive, lastSyncedAt) and ran db:push
- [x] Fetched 902 active players from MLB Stats API (2026 season) for MLBAM ID cross-reference
- [x] Extracted 55 notable active/recent players from Baseball Reference active player list (pasted_content_12.txt, pasted_content_13.txt)
- [x] Cross-referenced all 55 BR players with MLBAM API: 40 matched in 2026 season, 15 found in 2025 season (marked isActive=false)
- [x] Wrote seed-mlb.mjs and ran successfully: 30 teams inserted, 55 players inserted
- [x] Verified: 30 teams (5 per division × 6 divisions), 40 active + 15 inactive players

## MLB Player Sync Cron (08:00 UTC nightly)
- [ ] Audit existing cron infrastructure (scoreRefresh, vsinScraper crons)
- [ ] Write server/discord/mlbPlayerSync.ts with MLB Stats API integration
- [ ] Implement diff-based update logic: insert new players, update changed team/status
- [ ] Add structured noise-free logging: sync start, API fetch count, inserts, updates, skips, errors
- [ ] Register cron at 08:00 UTC in server startup
- [ ] Verify TypeScript compiles cleanly
- [ ] Test sync manually before relying on cron

## MLB Feed Integration (2026-03-24)
- [x] Fix isValidGame() in routers.ts to use MLB_VALID_DB_SLUGS (dbSlug) instead of MLB_BY_ABBREV (abbrev) for MLB team validation
- [x] Add MLB_VALID_ABBREVS export to mlbTeams.ts (set of all 30 MLB abbreviations)
- [x] Fix isValidGame() to accept both abbreviations (NYY, SF) and dbSlugs (yankees, giants) for MLB
- [x] Publish Yankees @ Giants (NYY @ SF) game on March 25 to the feed (publishedToFeed=1)
- [x] Fix formatMilitaryTime in GameCard.tsx to handle MLB's "H:MM AM/PM ET" format
- [x] Fix formatMilitaryTime in ModelProjections.tsx to handle MLB's "H:MM AM/PM ET" format
- [x] Fix timeToMinutes in ModelProjections.tsx to correctly sort MLB games (12-hour AM/PM format)
- [x] Update MLB tab logo in ModelProjections.tsx to use league-on-dark/1.svg
- [x] Add MLB pill to ModelProjections.tsx sport selector (NHL | NBA | NCAAM | MLB)
- [x] Add MLB to selectedSport type in ModelProjections.tsx
- [x] Update auto-switch logic in ModelProjections.tsx to include MLB in fallback order (MLB → NHL → NBA → NCAAM)
- [x] Update date header label in ModelProjections.tsx for MLB: "MLB BASEBALL"
- [x] Update column header in ModelProjections.tsx for MLB: "RUN LINE" instead of "SPREAD"
- [x] Add MLB choice to Discord /splits command sport filter
- [x] Fix root cause of "Unknown column" DB errors: columns were already in DB, errors were from before migration was applied

## MLB Live Data Infrastructure (2026-03-24)
- [x] Build mlbScoreRefresh.ts — live scores from MLB Stats API with deep structured logging
- [x] Build scrapeVsinMlbBettingSplits() in vsinBettingSplitsScraper.ts — MLB-specific URL + column mapping (ML→Total→RL)
- [x] Add refreshMlb() function in vsinAutoRefresh.ts — VSiN splits + AN odds wired together
- [x] Wire MLB into 10-minute MLBCycle cron in vsinAutoRefresh.ts (separate from hourly NCAAM/NBA/NHL cron)
- [x] Add MLB to refreshAnApiOdds() — team resolution via getMlbTeamByAnSlug() → abbrev → DB match
- [x] Add MLB to triggerRefresh procedure in routers.ts
- [x] Verify all three pipelines fire correctly and update DB on schedule

## MLB Splits Fix (2026-03-24)
- [x] Diagnosed: VSiN MLB uses dedicated URL (data.vsin.com/mlb/betting-splits/) not combined page
- [x] Fixed: MLB column order is ML(1-3) → Total(4-6) → RL(7-9), opposite of NBA/NHL order
- [x] Fixed: VSIN_MLB_HREF_ALIASES now includes all 30 full hyphenated slugs (new-york-yankees etc.)
- [x] Fixed: refreshMlb queries both today + tomorrow DB games (MLB games seeded a day ahead)
- [x] Fixed: MLBCycle AN odds fetches both today + tomorrow dates in parallel
- [x] Fixed: mlbScoreRefresh team resolution uses MLB_BY_ID.get(team.id)?.abbrev (API has no abbreviation field)
- [x] Fixed: mlbScoreRefresh probablePitcher path uses teams.away.probablePitcher (not game.probablePitchers)
- [x] VERIFIED: NYY @ SF (2026-03-25) — runLine=-1.5/+1.5, total=7, ml=-123/+101, splits 77%/84% RL bets/handle ✅

## MLB Tab Order + Opening Day (2026-03-24)
- [ ] Move MLB tab before NHL in ModelProjections.tsx sport selector
- [ ] Update auto-switch fallback order: MLB first
- [ ] Publish all March 25 MLB games to feed (publishedToFeed=1)
- [ ] Verify feed shows March 25 MLB games when MLB tab is selected

## MLB Tab Order + Opening Day (2026-03-24)
- [x] Move MLB pill before NHL in ModelProjections.tsx (feed) sport selector
- [x] Move MLB button before NHL in PublishProjections.tsx sport selector
- [x] Seed all 2,430 MLB regular season games (March 25 - September 27, 2026) into DB
- [x] Publish March 25 (NYY @ SF) and March 26 (11 games) to feed
- [x] Add 7-day rolling window filter to listGames() for MLB (prevents 2430-game payload)
- [x] Update getActiveSports() to use 7-day window for MLB tab visibility
- [x] Auto-advance selectedDate to first available date when current date has no games (MLB opening day fix)

## MLB Lineups Tab (2026-03-24)
- [ ] Add mlbLineups table to drizzle/schema.ts (gameId, awayLineup, homeLineup JSON, pitcherIds, weather, umpire, scrapedAt)
- [ ] Build server/rotowireLineupScraper.ts — scrape rotowire.com/baseball/lineups with deep structured logging
- [ ] Add getLineups / upsertLineup helpers to server/db.ts
- [ ] Add games.lineups tRPC procedure to server/routers.ts
- [ ] Wire Rotowire scraper into 10-minute MLBCycle in vsinAutoRefresh.ts
- [ ] Build client/src/components/MlbLineupFeed.tsx matching the HTML mockup design
- [ ] Add LINEUPS sub-tab to ModelProjections.tsx (left of MODEL PROJECTIONS) when MLB is selected
- [ ] Verify end-to-end: scraper → DB → tRPC → UI
- [x] Fix Rotowire scraper: use `title` attribute for full player names (was using abbreviated visible text)
- [x] Fix Rotowire ID extractor for new URL format `/baseball/player/name-ID`
- [x] Populate mlbamId for pitchers and batters via mlb_players name lookup in upsertLineupsToDB
- [x] Add generational suffix stripping (Jr./Sr./II/III) to name normalizer for better matching
- [x] Re-scrape Rotowire lineups: all 9 NYY batters now have full names + mlbamIds
- [ ] Fix MlbLineupCard home side row layout: mirror away side (number → photo → position → name → bats, right-aligned)
- [ ] Zoom out player headshot photos slightly (reduce objectPosition crop)
- [x] Fix MlbLineupCard: both Away and Home sides use identical left-aligned layout: [number] [photo] [position] [name] [bats]
- [x] Fix player photo crop: photos are too zoomed in showing chin/neck, need to show full face
- [x] Fix home side pitcher section: should be left-aligned matching away side
- [x] Fix player headshot: objectPosition top center shows cap/helmet, need to shift down to show face (use center 30% or similar)
- [x] Fix MlbLineupCard mobile: stack Away/Home vertically on mobile so names don't get cut off
- [x] Fix MlbLineupCard photo size: increase avatar to ~56px to match desktop reference screenshot
- [x] Fix MlbLineupCard photo crop: match the working state shown in reference (face fully visible, not cut off)
- [ ] MlbLineupCard: side-by-side columns on ALL screen sizes (no stacking), compact scaling so both teams fit on 390px iPhone without truncation
- [ ] MlbLineupCard: dynamic avatar/font/padding scaling based on viewport width
- [x] MlbLineupCard: increase player circle size (28→36px) and name font (11→13px) on mobile
- [x] MlbLineupCard: improve position/handedness readability — styled pill badge + colored handedness indicator
- [ ] MlbLineupCard: remove dark circle border container from PlayerAvatar, display raw MLB headshot image directly (no clip/overflow hidden)
- [x] Add MLB support to /splits Discord command
- [x] Build /lineups Discord command (renders MLB lineup cards as images, posts to channel 1400758184188186744)
- [x] Register /lineups slash command with Discord
- [ ] Rebuild /splits with dropdown sport selector and MLB population fix
- [ ] Rebuild /lineups with date/ALL/game dropdowns and deep logging
- [ ] Re-register both commands with Discord
- [x] Fix MLB splits card: team logos not rendering (showing letter circles instead of logos)
- [x] Fix MLB splits card: team names showing abbrev instead of city/nickname (NYY/SF instead of New York/Yankees, San Francisco/Giants)
- [x] Fix MLB splits card: game time showing wrong value (7:05 AM instead of correct ET time)
- [x] Add deep diagnostic logging to MLB team registry resolution in fetchSplits.ts
- [x] Fix /lineups: replace MLB_BY_DB_SLUG with resolveTeam() so NYY/SF abbreviations resolve correctly
- [x] Rebuild /lineups with date scope dropdown (TODAY/ALL/YYYY-MM-DD) and game autocomplete
- [x] Rebuild /splits with dropdown sport selector and game autocomplete (already had this, verified working)
- [x] Fix MLB splits card team colors: NYY shows orange instead of navy (#003087), SF shows orange instead of black (#27251F) — audit full color pipeline
- [x] Improve splits card logo circle backgrounds: use contrasting/lighter color so logos are clearly visible against the background
- [x] Fix Playwright Chromium missing binary error in production: copy build 1208 to /root/.cache/ms-playwright/ and add auto-install check in getBrowser()
- [x] Enhance lineup card image quality 10x: 4x device scale, larger viewport, crisp fonts, higher-res headshots, optimal Discord sizing
- [x] lineup_card.html: remove white corner artifacts on player headshot images
- [x] lineup_card.html: improve weather section readability (larger text, better contrast, bigger icons)
- [x] lineup_card.html: add CONFIRMED (#39FF14) / EXPECTED (#FFFF33) badges next to pitcher names and lineup section headers
- [x] lineupsCommand.ts + renderLineupCard.ts: pass awayLineupConfirmed/homeLineupConfirmed to template
- [x] lineup_card.html: white font for precip percentage and label, spell out PRECIPITATION fully
- [x] lineup_card.html: white font for wind speed and direction text
- [x] lineup_card.html: move position pill and handedness to immediately after player name (not right-edge)
- [x] lineup_card.html: fix name flex:1 stretching so POS pill and HAND are pixel-adjacent to name text
- [x] renderLineupCard.ts: boost render quality (higher DPR, larger viewport, sharper output)
- [x] lineupsCommand.ts: post to channel 1486210563276144700 instead of current channel
- [x] lineupsCommand.ts: remove text header message (date/game count) before posting cards
- [x] lineup_card.html: add game date (Month Day, Year) above ET start time in rendered card
- [ ] Recalibrate NHL model goal projection scoring — projected totals (~13-14 combined) are inflated vs book total (6.5); trace xGF_60/xGA_60 scaling and pace factors in nhlModelEngine.py and nhlHockeyRefTeamStats.ts

## MLB Strikeout Props Feature

- [x] Create mlb_strikeout_props DB table (33 columns) in drizzle/schema.ts
- [x] Add upsertStrikeoutProp() helper to server/db.ts
- [x] Add getStrikeoutPropsByGame() helper to server/db.ts
- [x] Add getStrikeoutPropsByGames() helper to server/db.ts
- [x] Build server/strikeoutModelRunner.ts — spawns StrikeoutModel.py, parses JSON, upserts to DB
- [x] Fix __dirname in strikeoutModelRunner.ts (ES module: fileURLToPath)
- [x] Add strikeoutProps tRPC router (getByGame, getByGames, runModel procedures)
- [x] Build client/src/components/MlbPropsCard.tsx — styled to match MlbLineupCard
- [x] Wire 'K PROPS' tab (4th tab) into FEED_TABS in ModelProjections.tsx (MLB only)
- [x] Add mlbPropsMap query (trpc.strikeoutProps.getByGames) to ModelProjections.tsx
- [x] Write vitest tests for strikeout props feature (12 tests passing)
- [ ] Run StrikeoutModel.py for March 26 games and verify Props tab displays correctly
- [ ] Add book line inputs to Publish Projections page for K props (optional)

## K Props Restyling + Action Network Consensus Integration
- [x] Rebuilt MlbPropsCard.tsx to match Lineups rendered-image style (Barlow Condensed, #090E14 bg, team color gradient bar, headshots, two-column pitcher layout)
- [x] Built ActionNetworkKPropsAPI.py — fast API scraper using book_id=15 for Consensus lines only (no browser needed)
- [x] Re-ran StrikeoutModel with real consensus lines: Max Fried 5.5 / Logan Webb 6.5
- [x] Populated mlb_strikeout_props with real data (MLBAM IDs 608331/657277 set for headshots)
- [x] Added unique index on (gameId, side) to prevent duplicate rows
- [x] Fixed verdict/bestSide logic in MlbPropsCard (EDGE verdict + bestSide OVER/UNDER)
- [x] Fixed signal breakdown display to show actual model keys (base_k_rate, whiff_mult, etc.)
- [x] Fixed matchup rows to use spot field and correct kRate/adj display
- [x] Verified tRPC endpoint returns correct data (Max Fried UNDER 5.5 @ -150, Logan Webb OVER 6.5 @ +105)

## MLB Team Logo Rendering Audit & Fix
- [ ] Audit Discord lineup image generator — exact logo source, URL pattern, mapping logic
- [ ] Audit MlbLineupCard web component — current logo rendering approach
- [ ] Audit MlbPropsCard web component — current logo rendering approach
- [ ] Apply exact same logo source/mapping to both web card components
- [ ] Add deep logging for logo load failures (fallback chain)
- [ ] Verify logos render correctly on both Lineups and K Props tabs

## Remove Daily Purge Logic (March 25, 2026+)
- [x] Audited all purge/delete/cleanup functions across entire codebase (3 locations found)
- [x] Replaced dailyPurge.ts with no-op stub — startDailyPurgeSchedule() export preserved for compile compatibility
- [x] Removed deleteOldGames() from db.ts, updated stale purge comments to reflect indefinite retention
- [x] Removed unused lt import from db.ts (was only used by deleted deleteOldGames)
- [x] Full data integrity check: 2615 games, 37 users, 12 lineups, 2 K props, 19691 odds history rows — all intact
- [x] Verified all pre-March-25 rows are bracket games (bracketGameId IS NOT NULL) — 0 non-bracket rows before 2026-03-25
- [x] Zero TypeScript errors after all changes

## MLB Run Line / Total Odds Display (March 26, 2026)
- [ ] Audit NHL puck line/total odds display in GameCard for exact layout reference
- [ ] Fix MLB game card run line and total odds to match NHL display style
- [ ] Verify all 11 March 26 MLB games display correctly in the feed

## VSiN Betting Splits Pipeline Audit & Streamlining (March 31, 2026)
- [x] Fix cron schedule: all sports (NBA/NHL/NCAAM/MLB) now refresh every 10 min from 14:01–04:59 UTC (6:01 AM–11:59 PM EST)
- [x] Lock NCAAM to Final Four only: Illinois, Connecticut, Michigan, Arizona on 04/04/2026 (refreshNcaam + runTomorrowSplitsUpdate)
- [x] Fix MLB team colors: getTeamColors MLB branch now queries by abbrev (e.g. NYY, BOS) matching games table storage
- [x] Add /betting-splits route to App.tsx (standalone BettingSplits page)
- [x] Add NHL and MLB to BettingSplits page sport selector (was only NCAAM + NBA)
- [x] Add page-level tab bar to ModelProjections linking to /betting-splits
- [x] Validate splits coverage: 48/49 games today+tomorrow (1 missing = MIN@KC, VSiN data availability)
- [x] Validate team colors: 8/8 pass across NBA/NHL/MLB/NCAAM with correct hex codes
- [x] Validate scheduler: 10-min tick confirmed firing, last refresh 5 min ago, active window correct
- [x] Validate NCAAM Final Four filter: CLEAN (no non-FF games on today/tomorrow)

## Remove Page-Level Tabs (March 31, 2026)
- [x] Remove "AI MODEL PROJECTIONS" / "BETTING SPLITS" two-tab row from ModelProjections header
- [x] Delete BettingSplits.tsx standalone page from codebase
- [x] Remove /betting-splits route from App.tsx

## MLB Engine MAX SPEC Rebuild (March 31, 2026)
- [ ] Audit current mlb_engine_adapter.py vs MAX SPEC blueprint (12-step gap analysis)
- [ ] Rebuild mlb_engine_adapter.py: 250k sims, NB-Gamma Mixture, extra innings ghost runner, bullpen fatigue, lineup dynamic weights
- [ ] Implement Steps 4-10: totals origination, ML origination, RL origination, conditional validation, cross-market consistency, inverse symmetry, market shaping
- [ ] Implement Step 12: full mandatory logging (distribution shapes, key number mass, cross-market flags)
- [ ] Test rebuilt engine on today's MLB games and validate output
- [ ] Integrate into mlbModelRunner.ts and run full pipeline validation

## MLB Pitcher Stats Enhancements (2026-03-31)
- [x] Schema: add fip, xfip, throwsHand columns to mlb_pitcher_stats
- [x] Schema: create mlb_team_batting_splits table (vs LHP / vs RHP per team)
- [x] Schema: create mlb_pitcher_rolling5 table (last 5 GS rolling stats)
- [x] Seed: fetch FIP, xFIP, handedness from MLB Stats API into pitcher stats
- [x] Seed: fetch team batting splits vs LHP/RHP from MLB Stats API
- [x] Seed: compute last-5-starts rolling stats from MLB Stats API game logs
- [ ] Engine: integrate pitcher handedness + batter-vs-handedness splits into run-scoring model
- [x] Engine: integrate FIP/xFIP as quality signal alongside ERA
- [ ] Engine: use rolling-5 stats for hot/cold starter weighting
- [x] Daily cron: refresh all three new tables alongside existing pitcher stats refresh
- [ ] Validate: zero unknown-pitcher warnings, correct handedness splits applied

## MLB Pitcher Stats Enhancements (2026-03-31)
- [x] Schema: add fip, xfip, throwsHand columns to mlb_pitcher_stats
- [x] Schema: create mlb_team_batting_splits table (vs LHP / vs RHP per team)
- [x] Schema: create mlb_pitcher_rolling5 table (last 5 GS rolling stats)
- [x] Seed: fetch FIP, xFIP, handedness from MLB Stats API
- [x] Seed: fetch team batting splits vs LHP/RHP
- [x] Seed: compute last-5-starts rolling stats from game logs
- [x] Engine: integrate handedness + batter-vs-handedness splits
- [x] Engine: integrate FIP/xFIP as quality signal
- [x] Engine: rolling-5 hot/cold starter weighting
- [x] Daily cron: refresh all three new tables
- [x] Validate: zero unknown-pitcher warnings, correct splits applied

## MLB Model Precision Enhancements v2 (2026-03-31)
- [ ] Schema: mlb_park_factors table (3-year rolling run factor per venue)
- [ ] Schema: mlb_bullpen_stats table (ERA, K/BB, leverage, rest per team)
- [ ] Schema: mlb_umpire_modifiers table (K/BB rate modifier per umpire)
- [ ] Seed: park factors from MLB Stats API (3-season run-scoring data)
- [ ] Seed: bullpen stats from MLB Stats API (relief pitcher aggregates)
- [ ] Seed: umpire modifiers from MLB Stats API historical game data
- [ ] Engine: replace static park_run_factor with live DB lookup
- [ ] Engine: replace _default_bullpen() with real team bullpen stats
- [ ] Engine: apply umpire K/BB modifier to pitcher features pre-simulation
- [ ] Daily cron: refresh all 3 new tables
- [ ] Validate: all 3 signals active in [ENGINE] log per game
- [x] Port pickLogoBg + darkShade contrast algorithm from Discord lineup_card.html to shared teamLogoCircle.ts utility
- [x] Update MlbPropsCard LogoCircle to use teamLogoGradient (matches Discord /lineups output for all 30 teams)
- [x] Update MlbLineupCard logo circles (away + home) to use teamLogoGradient (matches Discord /lineups output)
- [x] Logo size corrected to 65% of circle diameter (matching Discord 0.65 ratio)
- [x] Fix cross-day lineup overwrite bug: add targetDate param to upsertLineupsToDB to restrict DB lookup to exact game date
- [x] Pass targetDate (todayStr/mlbTomorrowStr) from vsinAutoRefresh.ts to upsertLineupsToDB calls
- [x] Fix umpire extraction to grab only name (not R/G + K/G stats block)
- [x] Restore correct April 3, 2026 lineups to DB (overwritten by April 4 scrape)
- [x] Verify all 14 April 3 games have correct pitchers in DB (Sheehan, McGreevy, Perez, King, etc.)
- [x] Deep audit entire Rotowire lineup pipeline for accuracy and bulletproofing
- [x] Ensure 10-minute auto-refresh cycle for MLB lineups with maximum logging (MLB_INTERVAL_MS = 10min, confirmed running)
- [x] Wire StatusPill to awayPitcherConfirmed/homePitcherConfirmed in MlbLineupCard and MlbPropsCard
- [x] Re-run K-Props insert with correct April 3 lineups (28 records, all correct pitchers)
- [x] End-to-end verification of scrape → DB → frontend display (all 14 games verified, 10 CONF / 4 EXP)
- [ ] Build live AN pitching props scraper (actionnetwork.com/mlb/props/pitching)
- [ ] Build daily K-Props pipeline: AN scrape → StrikeoutModel → DB with calibration
- [ ] Build automated backtest engine: actual K fetch → error compute → rolling calibration update
- [ ] Wire K-Props pipeline into MLBCycle (projections at lineup lock, backtest at game completion)
- [ ] Add backtest accuracy display to K PROPS feed tab
- [x] Backfill MLBAM IDs for all 28 April 3 pitchers (100% match via crosswalk CSV)
- [x] Fix accent/diacritic normalization in matchPitcherName (NFD decomposition)
- [x] Upgrade getDailyBacktest + getCalibrationMetrics to ownerProcedure (owner-only)
- [x] Add getRichDailyBacktestResults service function (team names, headshots, edge data)
- [x] Add getRichDailyBacktest ownerProcedure to strikeoutProps router
- [x] Build ModelResults.tsx — owner-only backtest results page (styled like Publish Projections)
- [x] Wire /admin/model-results route in App.tsx
- [x] Add Model Results link to owner admin menu in Dashboard.tsx (BarChart3 icon)
- [x] Backfill MLBAM IDs for all 28 April 3 pitchers (100% match via crosswalk CSV)
- [x] Fix accent/diacritic normalization in matchPitcherName (NFD decomposition)
- [x] Upgrade getDailyBacktest + getCalibrationMetrics to ownerProcedure (owner-only)
- [x] Add getRichDailyBacktestResults service function (team names, headshots, edge data)
- [x] Add getRichDailyBacktest ownerProcedure to strikeoutProps router
- [x] Build ModelResults.tsx owner-only backtest results page (styled like Publish Projections)
- [x] Wire /admin/model-results route in App.tsx
- [x] Add Model Results link to owner admin menu in Dashboard.tsx
- [x] Fix 5 pipeline bugs: F5 fields missing from project_game(), F5/NRFI date format 400 error, HR Props log→stdout JSON parse error, SQL game_id column mismatch, modelResult.modeled→.written
- [x] Verify all 16 April 5 games fully populated across all markets (MODEL+F5-MODEL+NRFI-MODEL+F5-ODDS+NRFI-ODDS+HR-PROPS)
- [x] Confirm book source routing: DK NJ (68) for full game ML/RL/Total, FanDuel NJ (69) for F5/NRFI, Consensus (15) for HR/K-Props
- [x] Build mlbHrPropsModelService.ts: mlbamId resolution via MLB Stats API + mlb_players name-match, calibrated per-player HR probability model (dampened pitcher adjustment, park factor, PA-per-game), EV computation (modelPHr, modelOverOdds, edgeOver, evOver, verdict)
- [x] Add getHrPropsByGames DB helper to db.ts
- [x] Add hrProps.getByGames tRPC procedure to routers.ts
- [x] Build MlbF5NrfiCard.tsx: F5 ML/RL/Total + NRFI/YRFI display with FanDuel NJ book odds and model projections
- [x] Build MlbHrPropsCard.tsx: HR Props display with consensus odds, model P(HR), edge, EV, verdict badges
- [x] Add F5/NRFI and HR PROPS tabs to ModelProjections.tsx (6-tab MLB feed: PROJECTIONS | SPLITS | LINEUPS | K PROPS | F5/NRFI | HR PROPS)
- [x] Wire mlbHrPropsMap and trpc.hrProps.getByGames query into ModelProjections.tsx
- [x] Add Step 7 (F5/NRFI scrape, FanDuel NJ) to runMlbCycle() in vsinAutoRefresh.ts
- [x] Add Step 8 (HR Props scrape + model EV computation) to runMlbCycle() in vsinAutoRefresh.ts
- [x] Verify 277/277 HR Props records: mlbamId resolved, modelPHr computed, 73 OVER edges, 204 PASS
- [x] Verify 16/16 F5/NRFI games: all book odds + model fields populated in DB
- [x] All 441 vitest tests passing (24 test files, 0 regressions)
- [x] Fix K-Props date format bug: run_april6_full_pipeline.ts was passing YYYY-MM-DD instead of YYYYMMDD to fetchANKProps
- [x] Build upsertKPropsFromAN: insert-or-update K-Props rows from AN scrape (was update-only before)
- [x] Seed 26/26 K-Props records for April 6, 2026 via upsertKPropsFromAN
- [x] Build mlbKPropsModelService.ts: Poisson lambda model (pitcher K9 + xFIP adj + opp K-rate adj + IP estimate), pOver, edge, EV, verdict
- [x] Wire K-Props model into vsinAutoRefresh.ts (runs after each upsert in 10-min cycle)
- [x] Wire K-Props model into run_april6_full_pipeline.ts (Step 6b)
- [x] Build mlbHrPropsBacktestService.ts: fetch actual HR results from MLB Stats API box score, populate actualHr + backtestResult in mlb_hr_props
- [x] Wire HR Props backtest into vsinAutoRefresh.ts (runs in K-Props pipeline after upsert)
- [x] Run HR Props backtest for April 5: 273/277 props updated, 0 errors
- [x] Rewrite MlbF5NrfiCard.tsx: add edge% + EV text display for all markets (F5 ML/RL/Total + NRFI/YRFI), fix YRFI model odds rendering bug
- [x] DB audit April 6: 26/26 K-Props modeled, 25 edges, 169/169 HR Props modeled, 38 edges
- [x] All 441 vitest tests passing (24 test files, 0 regressions)
- [x] DB audit: enumerate all MLB games March 25–April 5 and identify data gaps across all 4 markets
- [x] Fetch actual outcomes from MLB Stats API: F5 scores (inning-by-inning), 1st inning runs, pitcher Ks, batter HRs for all games
- [x] Build full historical backtest engine (all 4 markets: F5, NRFI/YRFI, K-Props, HR Props)
- [x] Run full backtest pipeline March 25–April 5 with deep logging and calibration metrics
- [x] Generate per-game + aggregate backtest report with accuracy, ROI, edge distribution
- [x] Save checkpoint and deliver full backtest report
- [x] Model and publish all 15 MLB games and all 3 NHL games for April 8, 2026 (AN odds + Monte Carlo + K-Props + NHL Poisson)
- [ ] Audit all NCAAM references across frontend, backend, cron jobs, and DB queries
- [ ] Remove NCAAM tab from Dashboard sport selector and all NCAAM-specific frontend components
- [ ] Remove NCAAM from PublishProjections page sport filter
- [ ] Disable all NCAAM cron jobs, auto-refresh, and scraper calls in vsinAutoRefresh.ts
- [ ] Remove NCAAM-specific tRPC procedures and DB queries that populate NCAAM data
- [ ] Verify no NCAAM data leaks to public feed after removal
- [ ] Run vitest suite and save checkpoint

## NCAAM Removal Cleanup (2026-04-08)
- [ ] Delete all dead NCAAM files (fix_sweet16_games.ts, ncaamModelWatcher.ts, vsinScraper.ts, dbPopulationAudit.ts, and any other dead NCAAM-only files)
- [ ] Make MLB the primary/default sport tab across Dashboard, ModelProjections, PublishProjections, BettingSplits
- [ ] Purge all NCAAM games from the database (DELETE WHERE sport = 'NCAAM')
- [ ] Add MLB to VSiN auto-refresh cron scheduler in vsinAutoRefresh.ts

## Security Hardening (2026-04-09)
- [ ] Install express-rate-limit, rate-limiter-flexible, helmet, express-validator
- [ ] Add global rate limiter (100 req/min per IP) to all Express routes
- [ ] Add strict auth rate limiter (5 attempts per 15 min) to /api/oauth/* and login routes
- [ ] Add strict auth rate limiter to tRPC auth.* and appUsers.login procedures
- [ ] Scan and remove all hardcoded API keys/tokens/passwords from codebase
- [ ] Move any hardcoded secrets to environment variables
- [ ] Verify no VITE_ prefixed secrets expose sensitive server-side keys to frontend bundle
- [ ] Add express body-parser size limits (10kb JSON, 1mb multipart)
- [ ] Add Zod schema validation/sanitization to all tRPC procedures with user input
- [ ] Add HTTP security headers (helmet.js)
- [ ] Sanitize all string inputs (strip HTML/script injection)
- [ ] Reject malformed/oversized payloads at middleware level
- [ ] Run full security audit and produce vulnerability report

## Odds History + Splits Timeline (10-min automation)

- [ ] Add splits columns to odds_history schema (spreadAwayBets/Money, totalOverBets/Money, mlAwayBets/Money for all 3 sports)
- [ ] Push DB migration (pnpm db:push)
- [ ] Update insertOddsHistory() to accept splits data
- [ ] Update all insertOddsHistory call sites (refreshAnApiOdds + MLB cycle) to pass current VSIN splits
- [ ] Ensure 10-min snapshot cadence for MLB, NBA, NHL (verify all 3 sports hit insertOddsHistory every 10 min)
- [ ] Change oddsHistory.listForGame from ownerProcedure to publicProcedure
- [ ] Update OddsHistoryPanel to show splits columns side-by-side with odds
- [ ] Wire OddsHistoryPanel into frontend BettingSplitsPanel (Betting Splits tab per game)
- [ ] Ensure OddsHistoryPanel remains in PublishProjections Odds History dropdown
- [ ] TypeScript check, vitest, checkpoint

## Security Hardening Round 2 (Apr 10, 2026)
- [x] Add GitHub Actions CI workflow: pnpm audit --audit-level=high + tsc --noEmit + vitest run
- [x] Implement CSRF Origin header check in tRPC middleware (trpc.ts) with structured logging
- [x] Set NBA_SHEET_ID in production secrets via Manus Secrets panel
- [x] Add startup validation guard in nbaModelSync.ts — fail loudly if NBA_SHEET_ID is missing
- [x] Add early-return guard in syncNbaModelFromSheet() when CSV_URL is empty
- [x] Create nbaSheetId.test.ts — validates NBA_SHEET_ID format + live sheet reachability
- [x] Fix auth.logout.test.ts mock req to include req.get() for CSRF middleware compatibility
- [x] TypeScript: 0 errors | Vitest: 430/430 passing (23 test files)

## Security Hardening Round 3 (Apr 10, 2026)
- [x] Add weekly GitHub Actions workflow (security-audit-weekly.yml): pnpm audit --audit-level=moderate, every Monday 09:00 UTC, manual dispatch with configurable level, artifact upload, structured severity breakdown log
- [x] Wire CSRF block to notifyOwner() alert: production-only, rate-limited 1 alert per IP per 10 min, in-memory cooldown map with auto-pruning, structured alert payload with IP/origin/path/timestamp/remediation steps, fire-and-forget async (never blocks the 403 response)
- [x] Add ciSecrets.test.ts: 5 tests validating all 7 required GitHub Actions secrets (presence, length, format) with safe preview logging (never logs full values)
- [x] Update ci.yml: fix test count to 435, improve secrets documentation with formats and values, add MySQL format note for DATABASE_URL
- [x] TypeScript: 0 errors | Vitest: 435/435 passing (24 test files)

## Security Hardening Round 3 (2026-04-10)
- [x] Weekly moderate-level security audit GitHub Actions workflow (security-audit-weekly.yml)
- [x] CSRF block → notifyOwner() alert with in-memory rate-limit guard (1 alert/IP/10min)
- [x] ciSecrets.test.ts — 5 Vitest tests validating all 7 required GitHub Actions secrets
- [x] security_events DB table (migration 0054) with indexes on eventType, ip, occurredAt
- [x] DB helpers: insertSecurityEvent, getSecurityEvents, getSecurityEventCounts, pruneSecurityEvents
- [x] CSRF block persistence: fireCsrfBlockAlert() writes to security_events table
- [x] tRPC security router: security.events.list, security.events.counts, security.events.prune
- [x] SecurityEvents.tsx owner-only admin page: 24h rolling counts, filterable event log, prune dialog
- [x] /admin/security route registered in App.tsx
- [x] Security Events button added to UserManagement.tsx header nav
- [x] Dependabot config (.github/dependabot.yml): weekly npm + GitHub Actions updates, grouped patch/minor PRs
- [x] GitHub Secrets documentation (.github/SECRETS_SETUP.md) with all 7 required + 10 optional secrets

## Security Hardening Round 4 (2026-04-10)
- [x] GitHub secrets set via API (7/7 confirmed): DATABASE_URL, JWT_SECRET, PUBLIC_ORIGIN, VITE_APP_ID, OAUTH_SERVER_URL, OWNER_OPEN_ID, NBA_SHEET_ID
- [x] RATE_LIMIT events wired into all 3 Express rate limiter handlers (global, auth, trpc_auth)
- [x] In-memory dedup guard on RATE_LIMIT events (1 DB write per IP per 60s, auto-prune at 5000 entries)
- [x] AUTH_FAIL events wired into login mutation (4 failure paths: user_not_found, account_access_disabled, account_expired, invalid_password)
- [x] Dependabot auto-merge workflow (auto-merge-dependabot.yml): patch-only PRs auto-approved + squash-merged after CI passes; minor/major skipped with explicit log

## Security Hardening Round 5 (2026-04-10)
- [x] GitHub Actions workflow permissions: default_workflow_permissions=write, can_approve_pull_request_reviews=true (HTTP 204 confirmed)
- [x] 8 optional GitHub secrets set (HTTP 201 each, total_count=15 verified): DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, KENPOM_EMAIL, KENPOM_PASSWORD, VSIN_EMAIL, VSIN_PASSWORD, METABET_API_KEY
- [x] securityDigest.ts: daily 08:00 EST cron (13:00 UTC), queries 24h event counts, top-5 IPs, threat level (CLEAN/LOW/MODERATE/HIGH/CRITICAL), fires notifyOwner(), prunes events older than 90 days
- [x] startSecurityDigestScheduler() wired into server startup in index.ts

## Discord Security Channel Integration (April 10, 2026)
- [x] Create server/discord/discordSecurityAlert.ts — structured Discord embeds for CSRF_BLOCK (red), RATE_LIMIT (yellow), AUTH_FAIL (orange) posted to channel 1492280227567501403
- [x] Wire CSRF_BLOCK → postSecurityAlert() in server/_core/trpc.ts (inside fireCsrfBlockAlert, after DB insert)
- [x] Wire RATE_LIMIT → postSecurityAlert() in server/_core/index.ts (inside fireRateLimitEvent, after DB insert)
- [x] Wire AUTH_FAIL → postSecurityAlert() in server/routers/appUsers.ts (inside fireAuthFailEvent, after DB insert)
- [x] All 3 wires are fire-and-forget (non-blocking), 30s per-IP dedup guard, full structured logging
- [x] TypeScript: 0 errors | Vitest: 458/458 passing | Build: clean

## Discord Security Channel — Full Integration (Apr 10 2026)
- [x] postSecurityAlert() helper with CSRF_BLOCK, RATE_LIMIT, AUTH_FAIL embeds
- [x] Brute-force IP escalation detector (3+ AUTH_FAIL in 10 min → @here alert)
- [x] Daily digest Discord embed in securityDigest.ts (plain-English, layman-friendly)
- [x] triggerSecurityDigestNow() manual export for owner-initiated digest
- [x] security.test.fireEvent tRPC procedure (fire test embeds per type or ALL)
- [x] security.test.fireDigest tRPC procedure (manual digest trigger)
- [x] SecurityEvents.tsx Discord Test Controls panel (Send Test + Post Digest buttons)
- [x] TypeScript: 0 errors | Vitest: 458/458 pass

## Discord Security Enhancements — Round 2 (Apr 10 2026)
- [ ] Add targeted username/email to AUTH_FAIL SecurityAlertPayload and embed
- [ ] Wire targetIdentifier into all AUTH_FAIL call sites in appUsers.ts
- [ ] Implement weekly threat trend digest (Sunday 08:00 EST) with 7-day bar breakdown
- [ ] Add Cloudflare IP block tRPC procedure (security.blockIp) with CF API secrets
- [ ] Add Block IP button to SecurityEvents.tsx table rows

## Cloudflare Removal (2026-04-10)
- [x] Delete server/cloudflareBlock.ts
- [x] Delete server/cloudflareBlock.test.ts
- [x] Remove cloudflare router block from server/routers/security.ts
- [x] Remove CF import from security.ts
- [x] Confirm zero CF references remain in codebase
- [x] TypeScript: 0 errors | Vitest: 458/458

## Cloudflare Removal (2026-04-10)
- [x] Delete server/cloudflareBlock.ts
- [x] Delete server/cloudflareBlock.test.ts
- [x] Remove cloudflare router block from server/routers/security.ts
- [x] Remove CF import from security.ts
- [x] Confirm zero CF references remain in codebase
- [x] TypeScript: 0 errors | Vitest: 458/458

## New Features (2026-04-10)
- [ ] Fix ?code= OAuth redirect loop on published domain
- [ ] Fix Last Sign In format: MM/DD/YYYY HH:MM AM/PM EST in User Management
- [ ] Add session_activity table to DB (userId, date, sessionStart, sessionEnd, durationMs)
- [ ] Add session tracking middleware (record login, heartbeat, logout)
- [ ] Add tRPC procedures: metrics.activityStats (DAU/MAU/WAU, avgSessionTime)
- [ ] Add member tier tracking: payingMembers, lifetimeMembers, nonPayingMembers
- [ ] Add discordConnected field to app_users + tRPC metrics.memberStats
- [ ] Build metrics panel UI with 8 KPI cards (DAU/MAU/WAU, avgSession, paying/lifetime/nonPaying/discord)

## MLB Last 5 Games + Team Schedule (2026-04-11)
- [ ] Add mlb_schedule_history DB table (migration 0056) for AN DK NJ schedule/odds history
- [ ] Build mlbScheduleHistoryService.ts — AN DK NJ fetcher for MLB team schedule + odds + results
- [ ] Build tRPC procedures: mlbSchedule.getTeamSchedule, mlbSchedule.getLast5ForMatchup
- [ ] Build MlbTeamSchedule.tsx — full team schedule page with run line/total/ML/covered/won/O-U
- [ ] Add Last 5 Games panel to each MLB matchup card in GameCard.tsx
- [ ] Wire team logo click → /mlb/team/:slug route
- [ ] Wire daily refresh scheduler for mlb_schedule_history (runs nightly, backfills last 30 days)
- [ ] TypeScript 0 errors + Vitest 458/458 after all changes

## Recent Schedule + Situational Results Panels — MLB/NBA/NHL (2026-04-11)
- [x] Add nba_schedule_history DB table (migration 0057) for AN DK NJ schedule/odds history
- [x] Add nhl_schedule_history DB table (migration 0057) for AN DK NJ schedule/odds history
- [x] Build nbaScheduleHistoryService.ts — AN DK NJ fetcher for NBA team schedule + odds + results
- [x] Build nhlScheduleHistoryService.ts — AN DK NJ fetcher for NHL team schedule + odds + results
- [x] Add getSituationalStats to mlbScheduleHistoryService.ts (ML/Spread/Total records)
- [x] Build nbaSchedule tRPC router (getTeamSchedule, getLast5ForMatchup, getSituationalStats, refreshSchedule)
- [x] Build nhlSchedule tRPC router (getTeamSchedule, getLast5ForMatchup, getSituationalStats, refreshSchedule)
- [x] Build RecentSchedulePanel.tsx — unified MLB/NBA/NHL Last 5 games panel (team tab selector, W/L + ATS + O/U chips)
- [x] Build SituationalResultsPanel.tsx — ML/Spread/Total tabs with side-by-side record bars for both teams
- [x] Wire RecentSchedulePanel + SituationalResultsPanel into GameCard for MLB, NBA, NHL
- [x] Build NbaTeamSchedule.tsx — full team schedule page (/nba/team/:slug)
- [x] Build NhlTeamSchedule.tsx — full team schedule page (/nhl/team/:slug)
- [x] Register /nba/team/:slug and /nhl/team/:slug routes in App.tsx
- [x] Build nbaScheduleHistoryScheduler.ts — startup 7-day backfill + every 4h refresh
- [x] Build nhlScheduleHistoryScheduler.ts — startup 7-day backfill + every 4h refresh
- [x] Wire NBA + NHL schedulers into server/_core/index.ts
- [x] TypeScript: 0 errors | Vitest: 458/458 passing

## MLB Closing Line Scraper + UI Fixes (2026-04-11)
- [ ] Build MLB closing-line cron scraper — AN API fires at game start time, stores closing DK NJ lines to mlb_schedule_history
- [ ] Fix Situational Results "undefined-undefined" bug in W-L record display
- [ ] Wire Head-to-Head section from mlb_schedule_history DB (now fully populated)
- [ ] Spell out full team city names in Recent Schedule tabs (e.g., "Pittsburgh" not "PITT")
- [ ] Remove "DK NJ · RUN LINE · Total · ML" label from Recent Schedule section header

## MLB UI Fixes + Closing Line Scraper (Apr 11 2026)
- [x] Fix Situational Results "undefined-undefined" — server was returning {w,l} but frontend expected {wins,losses}
- [ ] Wire Head-to-Head tab in RecentSchedulePanel using mlb_schedule_history DB data
- [ ] Spell out full city names in RecentSchedulePanel team tabs (e.g. "Pittsburgh" not "PITT")
- [ ] Remove "DK NJ · RUN LINE · Total · ML" label from Recent Schedule header
- [ ] Build MLB closing-line cron scraper — AN API fires at game start time, stores closing DK NJ lines

## Neutral Site + Doubleheader Hardening (2026-04-11) [URGENT]
- [ ] [URGENT] Add neutral_site boolean column to mlb_schedule_history schema (migration) — populate from AN API response field
- [ ] [URGENT] Wire neutral_site → LOCATION column in MlbTeamSchedule.tsx to show "Neutral" for London/Mexico City/neutral games
- [ ] Harden doubleheader storage: ensure anGameId uniqueness prevents duplicate rows; verify both DH games stored with correct gameDate and distinct anGameId
- [ ] Verify doubleheader display: two rows with same date render correctly in MlbTeamSchedule (no deduplication, no merging)

## RL Cover Stat Fix (2026-04-11)
- [x] Remove push tracking from RL COVER chip — MLB 1.5 run line never pushes; notCovered = completed - wins (binary W/N only)

## MLB TRENDS Automation (2026-04-11)
- [x] Automated nightly MLB TRENDS refresh: cron job fires at 2:59 AM EST (11:59 PM PST) nightly, re-ingests yesterday+today, per-row validation, 30-team cross-validation, owner notification, manual trigger via tRPC triggerNightlyTrendsRefresh
- [x] Manual on-demand backfill tRPC procedure for owner-triggered date re-ingestion
- [x] Full 30-team cross-validation audit after nightly refresh confirms accuracy

## Open-Line Seeding + Odds Source Labeling (MLB + NHL)
- [x] Backend: seed every MLB/NHL game with AN Opening line on day-prior (spread, total, ML + juice)
- [x] Backend: per-field DK NJ replacement — only overwrite Opening field when DK NJ has a non-null value for that field
- [x] Backend: add oddsSource field to games table: enum('open','dk') — tracks current state of primary book columns
- [x] Backend: add oddsSource column to odds_history table: enum('open','dk') — per-snapshot label
- [x] Backend: updateAnOdds writes oddsSource='open' when using Opening line, 'dk' when all DK fields present
- [x] Backend: insertOddsHistory includes lineSource in every snapshot
- [x] Backend: post-cycle completeness validation gate — after every AN odds cycle, query DB and log every game with any null field
- [x] Backend: atomic DK-vs-Open switch (not per-field) — all 3 markets use same source
- [x] Frontend: odds+splits history table shows source label per snapshot (DK logo / OPEN text)
- [x] Frontend: SOURCE column in OddsHistoryPanel (DK logo / OPEN text)
- [x] Run full Apr 12 verification — NHL 6/6 complete, MLB 11/15 complete (4 pending DK odds)

## Open-Line Seeding + DK Logo Source Column (Apr 11 v2)
- [x] Backend: atomic Open-vs-DK switch — use OPEN for ALL 3 markets until DK NJ has ALL 3 (RL/PL + ML + O/U)
- [x] Backend: dual-write spread to awayRunLine+awayBookSpread (MLB) / awayPuckLine+awayBookSpread (NHL)
- [x] Backend: AN API fetch retry with exponential backoff (3 attempts: 2s/4s/8s)
- [x] Backend: completeness gate uses correct field set (runLine/puckLine + total + ML)
- [x] Frontend: OddsHistoryPanel SOURCE — DK logo image for dk, OPEN text for open, NO PARTIAL badge
- [x] Frontend: SOURCE column only for MLB/NHL; F5/NRFI/K-Props/HR Props have no source column

## Missing Opening Line Write Fix (Apr 11 v3)
- [ ] Audit: trace AN API response for PIT@CHC, HOU@SEA, MIN@TOR, CWS@KC — confirm Open fields returned
- [ ] Fix: ensure Open odds are written even when DK fields are all null (not just when DK is present)
- [ ] Fix: atomic switch must write Open line to ALL DB columns when DK is absent
- [ ] Force re-seed all 4 missing MLB games and verify completeness

## Cross-Device Audit UI/UX Improvements (Apr 13 2026)
- [ ] Add xs (375px), md (768px), 2xl (1600px) Tailwind breakpoints to index.css @theme
- [ ] Decompose GameCard.tsx: extract useEdgeCalculation.ts hook
- [ ] Decompose GameCard.tsx: extract OddsCell as standalone component
- [ ] Add md: tablet breakpoint 2-col Score|OddsTable layout in GameCard (Fix #1)
- [ ] Virtualize game feed with react-window VariableSizeList + AutoSizer (Fix #2)
- [ ] Cap desktop feed at max-w-[1600px] mx-auto with CSS Grid column alignment (Fix #3)
- [ ] Lazy-load BettingSplitsPanel, OddsHistoryPanel, RecentSchedulePanel, SituationalResultsPanel (Fix #4)
- [ ] Eliminate trpc.teamColors.getForGame calls — use client-side registry lookup (Fix #5)
- [ ] Replace useAutoFontSize Canvas measureText with CSS container queries cqw (Fix #6)
- [ ] Fix mobile frozen panel from 160px to clamp(140px, 38%, 180px) (Fix #7)
- [ ] Increase all touch targets to minimum 44x44px (Fix #8)
- [ ] Add overflow-x:auto + scroll-snap to MLB 6-tab sub-tab row (Fix #9)
- [ ] Add font preload + font-display:optional for Barlow Condensed 700 woff2 (Perf #1)
- [ ] Add Vite manualChunks for MLB panels and admin pages (Perf #2)
- [ ] Debounce useViewportScale ResizeObserver at 100ms (Perf #3)
- [ ] Add Cache-Control + ETag headers to games.list tRPC response (Perf #4)
- [ ] Move selectedSport/feedMobileTab/selectedDate/selectedStatuses to URL query params (Arch #1)
- [ ] Add IntersectionObserver-gated data fetching for below-fold secondary panels (Arch #2)

## Cross-Device Audit UI/UX Improvements (Apr 13, 2026)

### Fix Prescriptions
- [x] Fix #1: Add md: tablet breakpoint at 768px (xs/md/2xl added to @theme in index.css)
- [x] Fix #2: Virtualize game feed with react-window VariableSizeList + AutoSizer
- [x] Fix #3: Cap desktop feed at max-w-[1600px] mx-auto with CSS Grid
- [x] Fix #4: Lazy-load BettingSplitsPanel, OddsHistoryPanel, RecentSchedulePanel, SituationalResultsPanel
- [x] Fix #5: Eliminate trpc.teamColors.getForGame calls — replaced with client-side getGameTeamColorsClient
- [x] Fix #6: Replace useAutoFontSize Canvas measureText with CSS container queries (cqw units)
- [x] Fix #7: Fix mobile frozen panel from hardcoded 160px to clamp(140px, 38%, 180px)
- [x] Fix #8: Increase all touch targets (star, sport pills, tab buttons, calendar) to 44x44px minimum
- [x] Fix #9: Add overflow-x:auto + scroll-snap to MLB 6-tab sub-tab row

### Performance
- [x] Add font preload for Barlow Condensed 700-weight woff2 + font-display:optional in index.html
- [x] Add manualChunks to vite.config.ts splitting MLB panels and admin pages
- [x] Debounce useViewportScale ResizeObserver at 100ms (already implemented via rAF throttle)
- [x] Add Cache-Control + ETag headers to games.list tRPC response

### Architecture
- [x] Add xs, md, 2xl Tailwind breakpoints (375px, 768px, 1600px) to @theme in index.css
- [x] Extract useEdgeCalculation.ts hook from GameCard.tsx
- [x] Move selectedSport, feedMobileTab, selectedDate, selectedStatuses to URL query params via useSearch()
- [x] Add IntersectionObserver-gated data fetching for below-fold secondary panels (useVisibility hook)

## Tablet Layout + URL Param Fixes (Apr 13, 2026)

- [x] Switch GameCard desktop layout from lg: (1024px) to md: (768px) breakpoint
- [x] Update ScorePanel clamp from clamp(200px,16vw,260px) to clamp(170px,22vw,260px) for better tablet proportions
- [x] Fix URL param persistence: setSelectedSport/setSelectedDate use replace:false (push to history)
- [x] Auto-sport-switch uses isAutoSwitch=true (replace:true) to not pollute history
- [x] Update GameCard header comment to reflect 3-tier layout (mobile/tablet/desktop)

## Tablet Layout + Sport Pills Session (Apr 13 2026)
- [x] Verified md: breakpoint CSS generates md:hidden and md:flex at 768px in built CSS
- [x] EdgeVerdict clamp floor reduced: 150px → 120px (clamp(120px,11.5vw,190px)) — +10px per SectionCol at 768px
- [x] Sport pills md: breakpoint: px-3, py-2, gap-1.5, logo 14px, font 13px at 768px+
- [x] Favorites button md: breakpoint: px-3, py-2, gap-2, text-[13px] at 768px+
- [x] Sport pills container: md:px-4 md:gap-3 for better tablet spacing
- [x] Pixel-perfect width audit: 768px SectionCol=158px, 820px SectionCol=172px (both above 104px min)

## Tablet Scaling Session (Apr 13, 2026)
- [x] md: tab bar scaling — CSS @media (min-width: 768px) override for .feed-tab: padding 10px 18px, font-size 12px, letter-spacing 0.07em
- [x] md: CalendarPicker scaling — md:gap-2 md:px-3 md:py-2 md:text-[13px] md:w-4 md:h-4 on trigger button
- [x] ScorePanel team name audit — verified all 80+ MLB/NHL/NBA names fit at 13px within 110px available width at 768px (max "San Francisco" = 79.3px). No overflow. No font size change needed.
- [x] Dead code removal — removed 102 lines of dead useAutoFontSize/computeAutoFontSize/measureTextWidth/_autoFontCanvas code from GameCard.tsx (was defined but never called)
- [x] GameCard.tsx reduced from 3,802 → 3,712 lines (-90 lines net after all changes)

## Tablet Header/Tab Scaling (Apr 13, 2026 — Session 2)
- [x] Search bar md: scaling — md:text-[13px] on input, md:py-2 md:px-3 on container, md:w-4 md:h-4 on Search/X icons
- [x] Sticky header height md: scaling — Row 1 md:pt-3 md:pb-2, Row 3 md:pt-2 md:pb-1 (auto-height header expands naturally)
- [x] Tab bar fade-right gradient scroll indicator — tabsScrollRef + tabsShowFade state + ResizeObserver; fade auto-hides when content fits or user scrolls to end

## Tablet Header + Tab UX + Apr 12 Seeding (Apr 13, 2026 — Session 3)
- [x] Date header Row 4 md: scaling — md:py-2 on container + clamp(8px,2.1vw,14px) league label + favorites header md:py-2 + clamp(11px,2vw,15px)
- [x] Active tab scroll-into-view on sport switch — useEffect on selectedSport + rAF + data-active attr + querySelector + scrollIntoView inline:nearest
- [x] Seed Apr 12 MLB games: CWS@KC, PIT@CHC, HOU@SEA — AN API book_id=30 opening lines, patch_apr12_missing.ts, 3/3 patched+verified

## Tab Font Scaling + Smooth Scroll + Apr 12 Model Cycle (Apr 14, 2026 — Session 4)
- [x] Feed tab bar label md: font scaling — index.css @media 768px font-size: 15px + padding: 10px 20px (math: 6 tabs=640px ≤ 768px)
- [x] Active tab scroll-into-view smooth behavior — behavior: 'smooth' added to scrollIntoView call
- [x] Apr 12 MLB model cycle — CORRECTED: games were NOT purged (false alarm from Drizzle ORM bug); model ran successfully, 15/15 MODEL_OK

## MLB Purge Bug — Full Audit + Fix (Apr 14, 2026 — Session 5)
- [x] Audit all game delete/purge code paths — cron jobs, tRPC, direct DB calls (RESULT: no purge occurred; dailyPurge.ts is a no-op since 2026-03-25; only 3 delete paths exist: deleteModelFile, deleteGamesByFileId, deleteGameById — all owner-triggered, none automatic)
- [x] Trace exact purge execution — ROOT CAUSE: check_apr12_model.ts had 2 bugs: (1) gte/lte on string gameDate column returns 0 rows due to Drizzle ORM type coercion; (2) sport='mlb' (lowercase) doesn’t match DB value 'MLB' (uppercase). All 15 Apr 12 games are intact in DB (2,430 total MLB rows: 2026-03-25 → 2026-09-27)
- [x] Fix: corrected check_apr12_model.ts to use eq() + uppercase 'MLB'; ran MLB model for Apr 12 → 15/15 MODEL_OK (PIT@CHC + HOU@SEA now have full projections); 0 TypeScript errors; 458/458 tests pass

## lg: Tab Bar + Script Guards + Apr 13 Audit + Logos/Abbrevs (Apr 14, 2026 — Session 6)
- [x] Add lg: breakpoint to .feed-tab CSS — index.css @media 1024px: font-size: 17px + padding: 11px 22px (math: 6 MLB tabs=712px ≤ 1024px with 312px spare)
- [x] DB query guard for all diagnostic scripts — fixed 4 lowercase 'mlb' occurrences in 3 scripts; added check_team_keys.ts audit script (MLB_BY_ABBREV/NHL_BY_DB_SLUG/getNbaTeamByDbSlug all 30/30 hits)
- [x] Verify Apr 13 MLB model cycle — 10/10 MODEL_OK; MLBCycle FAILED(6) is for Apr 14 future games without pitchers (normal, not a bug)
- [x] Audit team logo visibility/readability — all 3 sports 100% hit rate: MLB_BY_ABBREV(30/30), NHL_BY_DB_SLUG(30/30), getNbaTeamByDbSlug(30/30); logos render via official CDN URLs
- [x] Audit and fix team abbreviations — nbaTeams.ts: added abbrev field to NbaTeam interface + all 30 official NBA abbreviations (BOS/BKN/NYK/PHI/TOR/CHI/CLE/DET/IND/MIL/ATL/CHA/MIA/ORL/WAS/DEN/MIN/OKC/POR/UTA/GSW/LAC/LAL/PHX/SAC/DAL/HOU/MEM/NOP/SAS); GameCard.tsx: makeCityAbbr now uses NHL→NBA→MLB official abbrev (30/30 MLB fixed: NYY/NYM/LAA/LAD/CWS/CHC/STL/KC/TB/SF/SD etc.)

## 5-Issue Fix: Truncation + A's Logo + Tab Scroll + xl: + Abbrev (Apr 14, 2026 — Session 7)
- [x] Fix MIN truncation — CompactScorePanel now uses awayAbbr/homeAbbr (official 2-3 char: MIN/ATH/NYY/NYM/LAA/LAD/CWS/CHC); removed truncate class + whiteSpace:nowrap + letterSpacing:0.05em
- [x] Fix A's logo visibility — brightness(1.25) + drop-shadow(0 0 2px rgba(255,255,255,0.10)) on all TeamLogo imgs; lifts dark-primary-color logos (A's #003831, Pirates/CWS #000000) off dark card bg
- [x] Fix tab bar vertical scroll bleed — overflowY:hidden + overscrollBehaviorX:contain + touchAction:pan-x on feed-tabs-scroll; prevents iOS/Android vertical scroll chain on horizontal swipe
- [x] Add xl: tab bar breakpoint — index.css @media 1280px: font-size:18px + padding:12px 24px + letter-spacing:0.09em (math: 6 MLB tabs=721px ≤ 1280px with 559px spare); 4-tier scale complete: 13→15→17→18px
- [x] Abbrev in mobile ScorePanel — CompactScorePanel (frozen panel) now shows official abbreviations; ScorePanel (desktop) correctly shows city+nickname in 2 lines; no separate label needed

## HANDICAPPER Role + BET TRACKER Page (Apr 14, 2026 — Session 8)
- [ ] Add "handicapper" to appUsers.role enum in drizzle/schema.ts
- [ ] Add tracked_bets table to schema (userId, gameId, sport, betType, team, odds, risk, toWin, book, note, result, createdAt)
- [ ] Run pnpm db:push to migrate schema
- [ ] Add handicapperProcedure to server/routers/appUsers.ts (gates on owner|admin|handicapper)
- [ ] Update createUser/updateUser zod enums to include "handicapper"
- [ ] Add betTracker router with list/create/update/delete procedures
- [ ] Update UserManagement.tsx: ROLE_ICONS, ROLE_COLORS, ROLE_ORDER, form select, stats counter for HANDICAPPER
- [ ] Build client/src/pages/BetTracker.tsx: sport tabs, game slate, bet entry form, saved bets list
- [ ] Add /bet-tracker route to App.tsx
- [ ] Add "Bet Tracker" to profile dropdown for owner|admin|handicapper roles
- [ ] Wire role-based access guard on BetTracker page

## Session: HANDICAPPER Role + Bet Tracker (Apr 13-14, 2026)

- [x] Add 'handicapper' to appUsers.role enum in drizzle/schema.ts
- [x] Create tracked_bets table (17 columns, 5 indexes) in drizzle/schema.ts
- [x] Run pnpm db:push — migration applied successfully (drizzle/0061_petite_unus.sql)
- [x] Add handicapperProcedure to server/routers/appUsers.ts (owner | admin | handicapper)
- [x] Update createUser/updateUser Zod enums to include 'handicapper'
- [x] Create server/routers/betTracker.ts — list, create, update, delete, getSlate, getStats procedures
- [x] Register betTrackerRouter in server/routers.ts
- [x] Update UserManagement.tsx — AppUserRow type, ROLE_ICONS (BarChart2), ROLE_COLORS (emerald), ROLE_ORDER, FormState, stats counter (5 cols), role select
- [x] Create client/src/pages/BetTracker.tsx — sport tabs, game slate selector, bet entry form, stats bar, bets list with quick result buttons, edit/delete
- [x] Add /bet-tracker route to App.tsx
- [x] Add "Bet Tracker" link to profile dropdown in ModelProjections.tsx (owner | admin | handicapper)
- [x] 0 TypeScript errors, 458/458 tests passing

## Session: Bet Tracker v2 — Action Network Slate + $/Units Toggle

- [x] Research Action Network v2 scoreboard API endpoint (confirmed: /web/v2/scoreboard/{sport}?bookIds=...&date=YYYYMMDD&periods=event)
- [x] Build server/actionNetwork.ts — fetchAnSlate() with full structured logging
- [x] Update betTracker.getSlate to call fetchAnSlate() instead of internal DB games table
- [x] Return awayFull, homeFull, status fields from getSlate for richer UI
- [x] Add $/Units stake toggle to BetTracker.tsx (persisted in localStorage)
- [x] Remove Sportsbook field from Add Bet form and BetCard display
- [x] Update game slate dropdown to show AN games with time + status
- [x] Update stats bar to respect stakeMode ($ vs units formatting)
- [x] All 458 tests passing, 0 TypeScript errors

## Session: Bet Tracker v3 — Slate Speed + Structured Dropdowns

- [ ] Add server-side in-memory cache to actionNetwork.ts (5-min TTL per sport+date key)
- [ ] Pre-warm slate cache on server startup for today's date across all 4 sports
- [ ] Add timeframe enum to tracked_bets schema (FULL_GAME, FIRST_5, FIRST_INNING)
- [ ] Add market enum to tracked_bets schema (ML, RL, TOTAL)
- [ ] Run pnpm db:push to apply schema changes
- [ ] Update betTracker create/update/list router to include timeframe + market
- [ ] Replace free-text PICK field with auto-derived string from GAME + TIMEFRAME + MARKET + PICK_TEAM/SIDE
- [ ] Add TIMEFRAME dropdown (Full Game / First 5 Innings / First Inning)
- [ ] Add MARKET dropdown (Moneyline / Run Line / Total)
- [ ] Add PICK dropdown (Away team / Home team / Over / Under — context-aware per market)
- [ ] Remove manual AWAY/HOME text inputs (game always selected from AN slate)
- [ ] TypeScript check, 458/458 tests passing, checkpoint

## Session: Bet Tracker v3 — AN Slate + Structured Dropdowns
- [x] Server-side AN slate cache (5-min TTL, pre-warm on startup, deduplication guard)
- [x] DB schema: anGameId, timeframe (FULL_GAME/FIRST_5/FIRST_INNING), market (ML/RL/TOTAL), pickSide (AWAY/HOME/OVER/UNDER) columns added + migrated (migration 0062)
- [x] betTracker router: create/update/list/getSlate updated for structured fields, pick auto-derived server-side
- [x] BetTracker.tsx: DATE + GAME (AN slate) + TIMEFRAME + MARKET + PICK dropdowns, no free-text
- [x] $/Units toggle with configurable unit size, persisted in localStorage
- [x] Sportsbook field fully removed from form and bet cards
- [x] 0 TypeScript errors, 458/458 tests passing

## Session: Bet Tracker v6 — Auto-Grade Scheduler + Score Display + Social Card Export
- [ ] Server-side auto-grade scheduler: nightly 11:30 PM EST cron + 15-min polling during game hours (10 AM–2 AM EST)
- [ ] Persist awayScore/homeScore on settled bets in DB
- [ ] Score + team logos display on WIN/LOSS/PUSH bet cards
- [ ] Social media card export: units-sorted (highest to lowest), shareable PNG
- [ ] TypeScript check, tests, checkpoint

- [ ] BUG FIX: O/U model line and odds must always be anchored to book total line (not model-computed line) — ARI/BAL showing o8.5 model vs o9 book
- [ ] BUG FIX: Run/puck/point line model spread must always match book side — KC/DET showing inverted RL (book KC -1.5 but model showing KC +1.5)
- [ ] Apply both fixes across MLB, NHL, NBA with deep per-game validation logging

## CHEAT SHEETS Tab (April 14, 2026)
- [x] Rename F5/NRFI tab to CHEAT SHEETS
- [ ] Extend DB schema: add innDist (JSON), f5ModelML, f5ModelRL, f5ModelTotal, f5ModelAwayScore, f5ModelHomeScore, nrfiModelOdds, yrfiModelOdds columns to games table
- [ ] Extend MLBAIModel.py: compute and return I1-I5 per-team run distributions, F5 model ML/RL/Total, NRFI/YRFI model odds from simulation
- [ ] Update mlbModelRunner.ts: write new F5/NRFI model line fields to DB
- [ ] Build Action Network F5/NRFI odds scraper (F5 ML, RL, Total; NRFI/YRFI odds)
- [ ] Build tRPC endpoint for CHEAT SHEETS data
- [ ] Build CHEAT SHEETS UI: F5 section with I1-I5 distribution bars + AN odds + model lines
- [ ] Build CHEAT SHEETS UI: NRFI section with I1 distribution + YRFI%/NRFI% + AN odds + model odds
- [ ] Full validation audit: all games populated, odds correct, model lines accurate

## Outcome Ingestion + F5 Win Pct Backfill (April 15, 2026)
- [x] Trigger outcome ingestion for 2026-04-14 — confirmed already ingested at 07:30 UTC (15/15 games, 0 errors)
- [x] Add modelF5HomeWinPct + modelF5AwayWinPct to CheatSheet F5 card CENTER section (Away Win% | Push% | Home Win% row, neon green on leader)
- [x] Build and launch backfillF5WinPct.mts — re-runs Python engine for all 256 modeled games (2026-03-26 → 2026-04-14) with per-game VERIFY logging
- [x] Wire checkDrift post-backfill — call checkF5ShareDrift() after all 256 games populated, log rolling 50-game window result
- [x] Add F5 ML edge display to CheatSheet F5 card — no-vig implied prob from book F5 ML vs modelF5HomeWinPct/modelF5AwayWinPct, show edge delta
- [x] Build rolling Brier score trend chart on Admin page — 20-game rolling window, 3 markets (FG ML, F5 ML, NRFI)
- [ ] Monitor and complete F5 win pct historical backfill (256 games, 20 dates, 2026-03-26 to 2026-04-14) [IN PROGRESS: 7/20 dates, 75/256 games, 0 errors]
- [x] Trigger checkDrift after backfill completes — 50-game rolling window, full drift report with calibration recommendations
- [x] Add FG Total and F5 Total Brier lines to Brier Trend chart (dashed purple/teal)
- [x] Wire notifyOwner at end of ingestMlbOutcomes with per-market Brier scores for morning calibration push notification
- [x] Re-ingest 2026-04-14 with force=true after backfill completes — recompute correct brierF5Ml for 15 games
- [x] Add Re-ingest button to Admin Brier Trend per-game table (force=true per date row)
- [x] Build 5-market Brier heatmap by date (date x market grid: FG ML / F5 ML / NRFI / FG Total / F5 Total)

## 7-Task Sprint (April 15, 2026)
- [ ] Verify April 15 nightly pipeline end-to-end — model runner, outcome ingestor, Brier scoring, notifyOwner push notification
- [ ] Fix 3 NULL brierF5Ml games (CHC@PHI id=2250235, CLE@STL id=2250241, NYM@LAD id=2250245) — audit f5AwayML/f5HomeML NULL root cause and backfill odds
- [ ] Backfill F5 ML odds for all historical games with NULL f5AwayML (games with modelF5AwayWinPct populated but no book F5 ML odds)
- [ ] Add daily F5 ML odds scraper coverage audit — count games where modelF5AwayWinPct IS NOT NULL AND f5AwayML IS NULL, surface in morning notifyOwner
- [ ] Wire drift detector minimum threshold — set configurable minimum (default 20 games), tune 0.02 delta threshold against actual variance
- [ ] Build F5 ML edge leaderboard — tRPC procedure + UI page ranking all historical games by F5 ML edge (model win% vs no-vig book implied%)
- [ ] Build Brier heatmap date × market drill-down — click-through from heatmap cell to per-game list for that date × market combination
- [ ] Deep-dive AN API for historical F5 ML odds — recover 9 missing games (2026-03-31: 8 games, 2026-04-03: 1 game) and backfill into DB

## 8-Task Sprint (April 15, 2026 — Evening)
- [ ] Task 1: Verify April 15 nightly ingest fires correctly (12:30 AM PST cron, notifyOwner, Brier scores)
- [ ] Task 2: Wire drift detector to Admin UI — banner on BRIER TREND page showing latest drift result
- [ ] Task 3: Build F5 ML edge leaderboard — tRPC procedure + UI page (model win% vs no-vig book implied%, ranked by edge)
- [ ] Task 4: Add daily F5 ML coverage audit to notifyOwner — count modelF5AwayWinPct IS NOT NULL AND f5AwayML IS NULL
- [ ] Task 5: Wire checkF5ShareDrift() to nightly ingest — call after ingestMlbOutcomes, include result in notifyOwner
- [ ] Task 6: Build Brier heatmap drill-down — click cell to see individual game list for that date x market
- [ ] Task 7: Build F5 edge vs outcome scatter plot — model edge (x) vs actual outcome (y) for all 256 historical games
- [ ] Task 8: Add FG Total and F5 Total edge display to CheatSheet card (no-vig implied vs model projected total)

## Unified THE MODEL RESULTS Page (Session: Apr 15, 2026)
- [ ] Merge "THE MODEL" + "F5 EDGE BOARD" into single "THE MODEL RESULTS" page at /admin/model-results
- [ ] 5 market tabs: FULL GAME, FIRST 5 INNINGS, 1ST INNING, K-PROPS, HR PROPS
- [ ] FULL GAME tab: Brier trend (FG ML + FG Total), heatmap, FG ML edge leaderboard + scatter, drift banner, rolling accuracy from mlbBacktest
- [ ] FIRST 5 INNINGS tab: Brier trend (F5 ML + F5 Total), F5 ML edge leaderboard + scatter, rolling accuracy
- [ ] 1ST INNING tab: NRFI Brier trend, NRFI daily results (date nav), rolling accuracy
- [ ] K-PROPS tab: daily backtest (date nav), last 7 days aggregate, calibration metrics
- [ ] HR PROPS tab: daily HR props results (date nav), rolling accuracy, backtest results
- [ ] Single sidebar entry "THE MODEL RESULTS" with FlaskConical icon (replace both old entries)
- [ ] Remove /admin/f5-edge route (redirect to /admin/model-results)
- [ ] TypeScript 0 errors, 487/487 tests passing

## MLB Headshot Backfill + Responsive UI (Session: Apr 15, 2026 — Continuation)
- [x] Fix React Error #310 (hooks violation) — moved hrPropsList, fgRows, f5Rows useMemo above early returns
- [x] Fix OAuth redirect on scatter button click — added enabled:!!appUser guard to RollingAccuracyPanel, /admin/* path guard in main.tsx, 14 OPTIONAL_AUTH_PATHS
- [x] Add type="button" to all 140 buttons across 20 files (including shadcn Button default + SidebarRail)
- [x] StatGrid responsive grid component (repeat(auto-fill, minmax(110px, 1fr)))
- [x] StatCard label wrapping (removed nowrap/ellipsis), value font 22px
- [x] MiniStatCard label wrapping + overflow hidden for responsive fit
- [x] KPropPitcherRow stats flexWrap for mobile layout
- [x] HrPropRow stats section flexWrap + minWidth:0 for mobile layout
- [x] MiniStatCard grids in FG/F5 edge summary sections wrapped in StatGrid (minColWidth=120)
- [x] Add fetchMlbamIdMap() to mlbKPropsModelService.ts (mirrors mlbHrPropsModelService pattern)
- [x] Add backfillAllKPropsMlbamIds() export to mlbKPropsModelService.ts
- [x] Fix TypeScript implicit any on filter callback (KPropsRow type cast)
- [x] Add backfillKPropsMlbamIds ownerProcedure to server/routers.ts (mlbBacktest router)
- [x] Add MLB HEADSHOT BACKFILL button to K-PROPS tab in TheModelResults admin UI
- [x] TypeScript 0 errors, 487/487 tests passing

## Auto-Populate MLBAM IDs — Full Pipeline Automation (Session: Apr 15, 2026)
- [x] Auto-resolve MLBAM IDs immediately after K-Props rows are written (upsertStrikeoutProps pipeline)
- [x] Wire MLBAM backfill into nightly K-Props cron (after model run, before DB write completes)
- [x] Wire MLBAM backfill into server startup (alongside existing 60-day schedule backfill)
- [x] Add structured logging: [MLBAM_BACKFILL] resolved/alreadyHad/unresolved/errors at every trigger point
- [x] TypeScript 0 errors, all tests passing

## MLB Betting Splits — 5-Issue Fix (Session: Apr 15, 2026)
- [x] Fix MLB team logos not loading in betting splits (root cause audit)
- [x] Fix Trends table — not updating in real time, always current
- [x] Fix Last 5 Games table — not updating in real time, always current
- [x] Remove "169 consecutive duplicates hidden" from frontend UI (backend-only logging)
- [x] Add OPEN line display to betting splits

## Betting Splits — 3 Persistent Issues (2026-04-15)

- [ ] Fix splits bars — use team hex colors from DB (primary color per team)
- [ ] Fix Last 5 Games — stale data, must auto-update daily with current completed games
- [ ] Fix OPEN line — pull from AN API 'Open' category, store as lineSource='open', display in OddsHistoryPanel

## Session: 2026-04-16 - Critical Bug Fixes

- [x] Fix upsertMlbScheduleHistory silent failure: onDuplicateKeyUpdate used snake_case column names (game_status, away_score) but actual MySQL columns are camelCase (gameStatus, awayScore) — MySQL error 42S22 "Unknown column 'game_status' in field list". Fixed by using sql`VALUES(${sql.raw('columnName')})` pattern.
- [x] Backfill 14 days of MLB schedule history (4/3-4/16): 191 games upserted, 0 errors. All games from 4/11-4/15 now show correct scores and 'complete' status.
- [x] Verify team colors fix: MLB_ABBREV_ALIASES fully populated in teamColors.ts, merged into ALL_COLORS map. getTeamColors('NYM') now correctly returns Mets blue.
- [x] Implement OPEN line pinning in OddsHistoryPanel: separates OPEN rows from DK rows, pins first non-null OPEN row at top with amber "OPENING LINE" separator, filters null-value rows from dedup display, adds "LIVE MARKET MOVEMENT" separator between OPEN and DK sections.

## Session: 2026-04-16 - MLB 10-Game Fix

- [x] Fix RL sign inversion: awayModelSpread anchored to book awayRunLine (dbGameById lookup)
- [x] Fix RL odds swap: awayRlOdds/homeRlOdds sign-corrected variables when Python inverts
- [x] Add dbGameById map to model runner for book RL label anchoring
- [x] Re-run model for 2026-04-16: all 10 games modeled, validation PASSED, 0 errors
- [x] Update mlbRunLineOdds.test.ts assertions to match new book-anchored RL pattern
- [x] 487/487 tests passing

## Session: 2026-04-16 - RL Inversion + Total Mismatch Bugs

- [x] Fix TOR@MIL RL inversion: model column shows inverted labels vs book column
- [x] Fix LAA@NYY total mismatch: model shows 9.5 instead of matching book total 10
- [x] Permanently fix total anchoring in model runner (always use book ou_line, never r.total_line)
- [x] Re-run model for April 16 after fixes, verify all 10 games correct
- [x] 487/487 tests passing

## Session: 2026-04-16 - Full MLB+NHL Model Line Mirror Audit

- [ ] Hardcode scipy installation into model startup (never missing again)
- [ ] Fix NHL puck line inversion: STL@UTA shows +1.5/-221 model when book is +1.5/+200
- [ ] Full audit: all NHL games modelSpread sign matches awayPuckLine sign
- [ ] Full audit: all NHL games modelTotal equals bookTotal
- [ ] Full audit: all MLB games modelSpread sign matches awayRunLine sign
- [ ] Full audit: all MLB games modelTotal equals bookTotal
- [ ] 487/487 tests passing

## Session: 2026-04-16 - Full MLB/NHL Line Mirror Audit

- [x] Hardcode scipy auto-install into MLBAIModel.py (never missing again)
- [x] MLB audit: verify 10/10 games correct RL signs and totals (ALL OK)
- [x] NHL audit: trace STL@UTA puck line inversion root cause (awayBookSpread wrong sign from AN API)
- [x] Fix NHL puck line sign: odds-authoritative correction (awaySpreadOdds > 0 = dog = +1.5)
- [x] Fix NHL validator: use awaySpreadOdds (not stale awayBookSpread) for sign check
- [x] Add [VERIFY] log after every NHL DB write confirming PL sign and total match
- [x] Re-run NHL model for April 16: 6/6 games PASS (STL, ANA, SJS, LAK, VAN, SEA all corrected)
- [x] 487/487 tests passing, 0 TypeScript errors

## Session: 2026-04-16 - NHL PL Book Sign Fix (GameCard)

- [x] Root cause: awayBookSpread in DB has wrong sign from AN API (5 of 6 April 16 games affected)
- [x] Fix: GameCard odds-authoritative correction for NHL book spread display (_correctedAwaySpread/_correctedHomeSpread)
- [x] DB audit: modelAwayPuckLine signs are 100% correct for all 6 April 16 NHL games
- [x] 487/487 tests passing, 0 TypeScript errors

## Session: 2026-04-17 - Rotowire Watcher Pipeline Rebuild

- [ ] Audit: find all Rotowire log files across server and DB
- [ ] Diagnose why April 18 NHL games are not modeled
- [ ] Audit MLB/NHL live score APIs for in-progress detection
- [ ] Remove ALL time gates from vsinAutoRefresh (MLBCycle, VSiN splits, AN API odds)
- [ ] Remove ALL time gates from nhlGoalieWatcher (today + tomorrow seeder)
- [ ] Remove ALL time gates from mlbLineupsWatcher
- [ ] Set all watcher intervals to 5 minutes
- [ ] Model on EXPECTED lineups (not just confirmed) — run model as soon as any lineup is populated
- [ ] Re-model on any lineup/pitcher/goalie change (late scratches)
- [ ] Add modelRunAt IS NULL guard to prevent re-running already-modeled confirmed games
- [ ] Watch both today AND tomorrow pages for MLB and NHL every 5 min
- [ ] Stop watching/modeling once game is live or final (use API game status)
- [ ] Integrate MLB Stats API for live game status detection
- [ ] Integrate NHL API for live game status detection
- [ ] Add structured per-cycle log file for Rotowire watcher (rotowire-watcher.log)
- [ ] Validate April 17 today + April 18 tomorrow pipeline end-to-end
- [ ] Save checkpoin## MLB Model P0 Automation Fixes (2026-04-19)
- [x] Fix CASE C guard in mlbLineupsWatcher.ts — add modelRunAt IS NULL check before skipping unchanged lineups
- [x] Fix CASE D guard in mlbLineupsWatcher.ts — add modelRunAt IS NULL check before skipping confirmed lineups
- [x] Fix pitcher source in runMlbModelForDate — COALESCE mlb_lineups.awayPitcherName with games.awayStartingPitcher
- [x] Step 6 tomorrow fallback — already present, confirmed live
- [x] Create startMlbModelSyncScheduler — standalone 5-min scheduler for today+tomorrow, registered in index.tstMlbModelSyncScheduler — standalone 5-min scheduler for today+tomorrow, register in index.ts

## Session: 2026-04-20 - TiDB Outage Resilience + MLB Backtest Fixes

- [x] Add DB health check endpoint (/api/health) that returns DB status without crashing
- [x] Make OAuth callback DB-resilient: set session cookie even if upsertUser fails (DB down)
- [x] Make authenticateRequest DB-resilient: serve JWT-only session when DB is unavailable
- [x] Add in-memory user cache to avoid DB round-trips for recently authenticated users
- [x] Add DB circuit breaker: after N consecutive failures, return cached/degraded responses instead of hanging
- [x] Add connection timeout reduction (5s max) to prevent 30s hangs on every request
- [x] Add /api/db-status endpoint to show real-time TiDB connectivity
- [ ] Fix FG ML home confidence: edge-based (done, TSC clean)
- [ ] Fix F5 ML home confidence: edge-based (done, TSC clean)
- [ ] Launch auto-retry rerun watcher (done, PID 26141 running)
- [ ] Run full re-backtest once TiDB recovers
- [ ] Run diagnostic SQL queries and grade all markets
- [ ] Deliver Market-by-Market A-grade diagnostic report

## Session: 2026-04-23 - Model Line Mirroring + SD@COL Fix

- [ ] Fix model total line to always mirror book total line exactly (same number, model odds only)
- [ ] Fix model F5 total line to always mirror book F5 total line exactly
- [ ] Fix SD@COL (and any game) skip condition — diagnose why SD@COL was not modeled
- [ ] Re-run production model for April 23 2026 after fixes
- [ ] Verify all games on feed show matching book/model lines with correct odds

## Bet Tracker — 2026 MLB Import + Multi-Handicapper Upgrade (2026-04-28)

- [x] Clear 8 stale test bets (ids 1-8) before import
- [x] Import 85 Prez 2026 MLB bets into tracked_bets (userId=1, sport=MLB, unit-based)
- [x] Set 6 pending bets (04/21) to result=PENDING for auto-grading
- [x] Extend getStats: add byType, bySize, byMonth, bySport, equityCurve, bestWin, worstLoss
- [x] Add targetUserId param to list/getStats for owner/admin cross-handicapper view
- [x] Enforce visibility: owner/admin see all handicappers; porter/hanksthebank see only own bets
- [x] Add listHandicappers procedure (owner/admin only) for handicapper selector UI
- [x] Build EquityChart React component (Canvas 2D, cumulative P/L over time)
- [x] Build BreakdownGrid component (By Type / By Size / By Month / By Sport)
- [x] Add Best Win + Worst Loss stat cards to header row
- [x] Add day-separator rows with daily W-L summary to bet log table
- [x] Add handicapper selector dropdown (owner/admin only) to BetTracker page
- [ ] Wire auto-grading for 04/21 pending bets via MLB API scoreGrader
- [x] Run vitest for betTracker router after all changes (487/487 passing)
- [x] Save checkpoint and deploy (5b2f90ec)

## Session: 2026-04-29 - BetTracker Major Feature Update

- [ ] Default handicapper dropdown to logged-in user on page load
- [ ] All-Time toggle: on by default, active/highlighted
- [ ] Role-based access: prez/sippi/owner see prez bets; porter/hank see own only; admin sees all
- [ ] Immutable bets for porter/hank: no delete after creation; edit-request flow instead
- [ ] Schema: add wagerType enum (PREGAME/LIVE) to trackedBets
- [ ] Schema: add customLine (decimal) field to trackedBets for RL/Total custom line values
- [ ] Schema: add betEditRequests table for porter/hank edit/delete requests
- [ ] DB push migrations
- [ ] Server: LOGS procedure (prez/sippi/admin only) — all creates, edits, edit requests
- [ ] Server: enforce immutability for porter/hank bets (block delete/edit, allow edit-request)
- [ ] Frontend: pregame/live wager toggle in ADD BET form
- [ ] Frontend: customizable line field for RL and Total markets (replaces hardcoded 7.5)
- [ ] Frontend: editable TO WIN (U) field (currently read-only, calculated)
- [ ] Frontend: unit size analytics fix — 1U/2U/3U/4U/5U/10U buckets; plus-money uses risk, minus-money uses toWin
- [ ] Frontend: LOGS tab (prez/sippi/admin only) with full audit trail
- [ ] Slate load speed: in-memory cache with 60s TTL for AN slate per sport/date

## Session: 2026-04-29 - BetTracker v4 (Role Access, Immutability, LOGS, Analytics Fix)

- [x] Schema: add wagerType (PREGAME/LIVE) and customLine to tracked_bets
- [x] Schema: create bet_edit_requests table (betId, requestedBy, requestType, proposedChanges, reason, status, reviewedBy, reviewedAt, reviewNote)
- [x] Run db:push to apply schema changes
- [x] Server: fix bySize analytics — plus-money uses risk as unit count, minus-money uses toWin as unit count
- [x] Server: bySize buckets ordered 10U → 5U → 4U → 3U → 2U → 1U
- [x] Server: listHandicappers returns all owner/admin/handicapper accounts
- [x] Server: list procedure — OWNER/ADMIN can view any user via targetUserId; HANDICAPPER sees own bets only
- [x] Server: create procedure — accepts wagerType and customLine fields
- [x] Server: update procedure — HANDICAPPER forbidden; ADMIN cannot touch owner bets; OWNER can only edit own bets
- [x] Server: delete procedure — HANDICAPPER forbidden (must submitEditRequest); ADMIN cannot delete owner bets
- [x] Server: submitEditRequest — handicapper submits EDIT or DELETE request for own bet
- [x] Server: reviewEditRequest — OWNER/ADMIN approves or denies pending edit request
- [x] Server: getLogs — OWNER/ADMIN: full audit log of all bets + all edit requests with user info
- [x] Client: default logged-in user selected in handicapper dropdown on BetTracker page
- [x] Client: All-Time toggled ON by default
- [x] Client: wagerType (PREGAME/LIVE) toggle in bet creation form
- [x] Client: customLine field for RL/TOTAL bets (editable text input)
- [x] Client: TO WIN field is now editable/typable (not just auto-calculated)
- [x] Client: LOGS tab visible to owner/admin — shows all bets created + all edit requests
- [x] Client: porter/hank edit/delete triggers submit-request modal (immutable bets)
- [x] Client: review modal in LOGS tab for owner/admin to approve/deny requests
- [x] TypeScript: 0 errors

## Session: BetTracker v13 — Stats, Chart, Layout

- [x] Fix TS2802 error: replace for...of on MapIterator with dayPLMap.forEach()
- [x] Add biggestDay (date + units) computation to getStats in betTracker.ts
- [x] Add longestWinStreak computation to getStats in betTracker.ts
- [x] Add biggestDayDate, biggestDayUnits, longestWinStreak to stats return object
- [x] Update StatsData type in BetTrackerAnalytics.tsx with new optional fields
- [x] EquityChart: dynamic PAD.left from ctx.measureText() on widest y-label
- [x] EquityChart: PAD.bottom = 40, minLabelPx = 44 for x-axis date spacing
- [x] Chart title: large centered +/- UNITS (text-xl font-bold, TrendingUp size=22)
- [x] StatCard: min-h-[72px] h-auto overflow-visible (fixes ROI sub-label clipping)
- [x] Stat pills: hide Pushes when pushes === 0
- [x] Stat pills: hide Pending when pending === 0
- [x] Stat pills: replace Best Win with Biggest Day (+units, date sub-label)
- [x] Stat pills: replace Worst L with Win Streak (longestWinStreak W)
- [x] Layout: 2-col grid [2fr 1fr] replacing 3-col [360px 300px 1fr]
- [x] Layout: left column wraps Add Bet form + Breakdowns (stacked below form)
- [x] TypeScript: 0 errors

## Session: BetTracker v14 — Apr 30 2026

- [x] Add ALL sport tab to the left of MLB (SportOrAll type, formSport fallback to MLB)
- [x] Add date range filter pills: All-Time | Today | L7 Days | L14 Days | 1M
- [x] Server: dateFrom/dateTo params added to list and getStats procedures (gte/lte drizzle-orm)
- [x] Stat pills: uniform min-h-[72px] height, centered flex-wrap layout on desktop/tablet
- [x] Mobile stat pills: 3x2 grid (Total Bets / +Units / Wins / Losses / WP% / ROI%)
- [x] Pushes and Pending pills hidden when value is 0
- [x] Chart title = actual +/- units value (dynamic color: green/red)
- [x] Remove Net P/L stat card (replaced by +/- Units in chart title)
- [x] Remove MLB 9-inning linescore from BetCard
- [x] todayPt() helper (UTC-8 Pacific Time) and subtractDays() utility added

## Session: Postponed Game Follow-up Features

- [ ] Feature 1: Postponed/rescheduled game detection — auto-detect when a postponed game gets rescheduled on a future date, log with structured output, notify owner
- [ ] Feature 2: Admin postponed-game view — filter toggle in owner dashboard to audit all postponed games across the season
- [ ] Feature 3: Suspended game handling — 'suspended' as distinct status, resume detection, feed exclusion

## Session: Postponed Game Follow-up Features (v15)

- [x] Feature 1: Rescheduled game detection — mlbPostponedTracker.ts detectRescheduledGames() scans MLB Stats API schedule 14 days forward, detects when a postponed game has a new gamePk/date, logs it and sends owner notification
- [x] Feature 2: Admin postponed-game view — /admin/postponed-games page with full audit table, status badges, filter/sort, manual status override dialog, 60s auto-refresh; wired into admin nav dropdown
- [x] Feature 3: Suspended game handling — 'suspended' added to gameStatus enum (migration 0079), detectResumedSuspendedGames() checks MLB API for final status, auto-updates DB and notifies owner
- [x] Step 0 in runMlbCycle — detectRescheduledGames + detectResumedSuspendedGames run every 10 min before score refresh, non-fatal
- [x] games.listPostponed tRPC procedure — owner-only, returns all postponed/suspended games
- [x] games.markGameStatus tRPC procedure — owner-only manual status override
- [x] listGames feed filter extended — excludes both 'postponed' AND 'suspended' from public feed

## Session: BetTracker v16 — Responsive Layout Fixes
- [x] Sport tabs: horizontal scroll on mobile (no wrapping, all tabs always visible)
- [x] Date range pills: single scrollable row on mobile, flex-wrap on sm+
- [x] Stat pills mobile: strict 3x2 grid (Total Bets / +Units / Wins | Losses / WP% / ROI%)
- [x] Stat pills desktop/tablet: centered flex-wrap, each pill min-w-[100px], equal spacing both sides
- [x] StatCard: removed truncate, whitespace-nowrap value, overflow-visible, min-h-[76px]
- [x] Chart title: text-3xl sm:text-4xl, TrendingUp size=28
- [x] EquityChart height: responsive ratio (0.70 mobile / 0.40 tablet / 0.30 desktop), clamped [200, 380]
- [x] EquityChart Y-axis: bold font, yLabelFontSize=max(10,min(11,W/60)), PAD.left = maxLabelW+18
- [x] EquityChart X-axis: xLabelFontSize=max(10,min(11,W/65)), lastLabelX dedup, PAD.bottom=46
- [x] Mouse handler: dynamic PAD_LEFT computed from same formula as draw (no hardcoded 58)
- [x] Header: flex-shrink-0 right side, narrower unit input on mobile (w-12 sm:w-16)

## Session: BetTracker v17 — Season Filter + Stats Bar Layout
- [x] Filters moved inline with user dropdown (single scrollable row, no separate row)
- [x] L7 Days → L7, L14 Days → L14 (shortened labels)
- [x] Season filter added after 1M
- [x] SEASON_START map: MLB=2026-03-25, NHL=2025-10-04, NBA=2025-10-22, NCAAM=2025-11-04
- [x] Season chart title: sport emoji + "2026 MLB SEASON" (sport-specific) + PREZ BETS sub + +/- units
- [x] Other modes: existing trend icon + units + subtitle (L7/L14 labels shortened)
- [x] TypeScript: 0 errors

## Session: BetTracker v18 — Collapsible Sections
- [x] Add Bet form: collapsible on mobile with chevron toggle (collapsed by default, always open on lg+)
- [x] Bet log: each date section collapses to a strip showing DATE W-L +/-UNITS
- [x] All dates default to collapsed (empty expandedDates Set)
- [x] Per-date expand/collapse is independent (Set-based toggle, no mutual exclusion)
- [x] netProfit per day computed from riskUnits/toWinUnits + result (WIN=+toWin, LOSS=-risk, PUSH/VOID/PENDING=0)
- [x] TypeScript: 0 errors

## Session: 2026-04-30 — BetTracker 100x Performance Optimization

- [x] Add gzip/brotli response compression middleware (threshold=512, 70-85% payload reduction)
- [x] Add `listWithStats` combined tRPC procedure — eliminates double round-trip (2 queries → 1)
- [x] Single-pass aggregation in `listWithStats` — all 7 breakdown dimensions computed in one loop
- [x] Migrate BetTracker.tsx to use `listWithStats` — single network request replaces list+getStats
- [x] Update `invalidate` callback to target `listWithStats` (single cache entry)
- [x] Wrap `handleResult` in `useCallback` — stable ref prevents BetCard memo invalidation
- [x] Extract `handleDeleteOpen`/`handleEditOpen` as stable `useCallback` refs — eliminates inline lambda re-renders
- [x] Replace inline `onDelete`/`onEdit` lambdas in BetCard call site with stable refs
- [x] Add `idx_tb_user_result` composite index (userId + result)
- [x] Add `idx_tb_user_result_date` composite index (userId + result + gameDate) — optimal for auto-grade pending queries
- [x] Run `pnpm db:push` — 2 new indexes applied (migration 0081)
- [x] TypeScript: 0 errors

## Session: 2026-04-30 — BetTracker 250x Performance Optimization

- [x] Server: add `listWithStatsPaginated` cursor-based infinite-scroll procedure (limit=50, cursor by gameDate+id)
- [x] Server: add `isHistorical` flag — skip slate enrichment for fully historical result sets
- [x] Server: parallel page+stats queries in `listWithStatsPaginated` (Promise.all)
- [x] Server: import lt, or, sql from drizzle-orm for cursor pagination support
- [x] Frontend: replace `listWithStats.useQuery` with `listWithStatsPaginated.useInfiniteQuery`
- [x] Frontend: `isHistoricalRange` derived flag — staleTime:Infinity for graded historical data
- [x] Frontend: staleTime:Infinity + gcTime:30m for historical ranges (ALL_TIME, L7, L14, 1M when dateTo < today)
- [x] Frontend: `paginatedQueryInput` stabilized with useMemo — no unstable object references
- [x] Frontend: `allPageBets` flattened from all pages via useMemo
- [x] Frontend: skeleton BetCard loading states (6 placeholders with animate-pulse)
- [x] Frontend: “LOAD MORE BETS” button with isFetchingNextPage spinner
- [x] Frontend: `betsWithSeparators` single-pass aggregation — replaces 4x .filter() + 1x .reduce() per date group
- [x] Frontend: linescore query — staleTime:Infinity for historical MLB dates, refetchInterval:false when no live dates
- [x] Frontend: `hasLiveMlbDates` derived flag — only polls live MLB games
- [x] Frontend: `invalidate` updated to target both `listWithStats` and `listWithStatsPaginated`
- [x] TypeScript: 0 errors

## Session: 2026-04-30 — BetTracker 500x Performance Optimization

- [x] Frontend: IntersectionObserver auto-load on scroll (loadMoreRef sentinel, no click required)
- [x] Frontend: filter-change prefetch on mouseenter of sport tabs + date range buttons
- [x] Frontend: optimistic bet creation — onMutate inserts bet into page 0 cache, onSettled reconciles
- [x] Frontend: optimistic delete — onMutate removes bet from all pages immediately
- [x] Frontend: optimistic result update — onMutate patches result in all pages immediately
- [x] Server: in-memory stats cache (Map<string, StatsCacheEntry> keyed by userId+filters, TTL=30s live / 5m historical)
- [x] Server: buildStatsCacheKey — deterministic JSON key from userId + all filter dimensions
- [x] Server: invalidateStatsCacheForUser — called on every create/update/delete mutation
- [x] Server: cache-aware IIFE aggregation — full-table scan skipped on cache hit
- [x] TypeScript: 0 errors

## Session: 2026-04-30 — MLB April 30 Slate Modeling

- [ ] Scrape tomorrow's 11 MLB games (matchups, starters, book lines)
- [ ] Pull pitcher stats (ERA, FIP, xFIP, K/9, BB/9, HR/9, WHIP, recent form)
- [ ] Pull team offense/defense metrics (wRC+, wOBA, ISO, K%, BB%, OPS vs LHP/RHP)
- [ ] Pull park factors and weather for all 11 venues
- [ ] Run run-total model projections for all 11 games
- [ ] Convert run totals to moneyline probabilities and no-vig prices
- [ ] Generate spread (run line) projections
- [ ] Upsert all 11 games into DB with model lines
- [ ] Publish all 11 games to feed
- [ ] Verify all 11 games visible on public feed

## Session: 2026-04-30 — Auth Wall Removal (Public Access Mode) — COMPLETED

- [x] Frontend: removed auth redirect useEffect from ModelProjections.tsx (MLB/NBA/NHL Projections, Lineups, K Props, Cheat Sheets, HR Props)
- [x] Frontend: removed auth redirect useEffect from BettingSplits.tsx (MLB/NBA/NHL Splits)
- [x] Frontend: deactivated landing page — "/" redirects to "/feed", landing preserved at "/home"
- [x] Frontend: "/login" redirect updated to "/feed" (public mode)
- [x] Frontend: heartbeat mutation gated behind appUser — no UNAUTHORIZED noise for public viewers
- [x] Server: all public-facing procedures already publicProcedure (games.list, mlbLineups, strikeoutProps, hrProps, activeSports, lastRefresh)
- [x] Server: admin/owner procedures (ownerProcedure, appUserProcedure) preserved unchanged
- [x] Server: OWNER/ADMIN/HANDICAPPER/USER role gates untouched — zero changes to existing accounts or permissions
- [x] TypeScript: 0 errors

## Session: 2026-04-30 - Phases 11B-15 Refactor (Shared Utils, Performance, Correctness)

- [x] Phase 11B: Remove local duplicate functions from GameCard.tsx (formatGameTime, spreadSign, toNum, getEdgeColor, calculateEdge) — import from shared libs
- [x] Phase 12: Extract mobile IIFE (822 lines) from GameCard.tsx into MobileGameCard.tsx as React.memo with custom comparison
- [x] Phase 13: Add isCardVisible guard to OddsHistoryPanel, RecentSchedulePanel, SituationalResultsPanel render conditions
- [x] Phase 14: BettingSplitsPanel — replace CSS lg:hidden/hidden lg:flex with useIsDesktop() conditional rendering
- [x] Phase 15: Final verification — 22/22 checks pass, 0 TypeScript errors

## Session: 2026-04-30 - MLB Run Line / NHL Puck Line Model Flip Bug

- [ ] Deep diagnostic: trace model spread values from DB → server → GameCard render for MLB/NHL
- [ ] Identify root cause of model run line/puck line being mirrored relative to book line
- [ ] Fix: enforce strict mirroring — model line must always match the same side as book line
- [ ] Verify fix: 0 TypeScript errors, visual confirmation on MLB/NHL game cards

## Session: 2026-04-30 - MLB/NHL Run Line / Puck Line Flip Fix

- [x] Root cause identified: MLB feedback loop (mlbModelRunner overwrote awayRunLine/homeRunLine book fields) + NHL awayModelSpread used model origination line instead of book spread
- [x] MLB fix: Removed awayRunLine/homeRunLine writes from mlbModelRunner.ts; added sign-enforcement guard (safeAwayRunLine/safeHomeRunLine) that auto-corrects any flip before DB write
- [x] NHL fix: Changed awayModelSpread/homeModelSpread in nhlModelSync.ts to use correctedAwaySpreadStr (book-authoritative) instead of modelAwayPL (model origination line)
- [x] DB correction: Fixed 5 flipped games (KC@ATH MLB + EDM@ANA NHL + others); 44 games verified PASS, 0 FAIL
- [x] TypeScript check: 0 errors

## Session: 2026-05-08 — RESOURCES Page Enhancements

- [x] Build RESOURCES page server proxy at /api/rg-proxy (rotogrinderProxy.ts) with cheerio table scraping
- [x] Fix Rotogrinders login endpoint (POST /sign-in with username/password fields)
- [x] Fix NAME cell parser (span.first() selector)
- [x] Build Resources.tsx with 4-tab native sortable table UI
- [x] Gate RESOURCES page to @prez and @lucianobets only (frontend + backend)
- [x] Add RESOURCES dropdown item to ModelProjections nav (violet BookOpen icon)
- [x] Feature: CSV Export — per-tab Download CSV button using only visible columns, filename includes tab + timestamp
- [x] Feature: Column Visibility Groups — 7 named groups each for pitchers/hitters with Show All / Reset buttons
- [x] Feature: Staleness Auto-Refresh — 15-min stale check on tab switch with [STALE] diagnostic log
- [x] Feature: Refresh All — force-refresh all 4 tabs in parallel
- [x] Feature: Stale badge (amber) on metadata bar when data >15 min old
- [x] Feature: Per-tab refresh button + global Refresh All button in header
- [x] Feature: Sticky NAME column with shadow, alternating row colors, key column highlighting
- [x] Feature: Structured diagnostic logging ([FETCH][STEP/OUTPUT], [CACHE][HIT], [STALE], [SORT][STATE], [COLVIS][STEP], [CSV][STEP/OUTPUT], [REFRESH_ALL][STEP])
- [x] TypeScript: 0 errors (fixed Set spread iteration with Array.from())

## Session: 2026-05-08 — RESOURCES Page Deep Fix & Enrichment

- [x] ROOT CAUSE: Today Pitchers 0-row bug — pitchers table uses "PLAYER" column, hitters use "NAME"; parser filtered on row["NAME"] dropping ALL pitcher rows
- [x] Fix rotogrinderProxy.ts: detect PLAYER vs NAME column, normalize to NAME in output
- [x] Add PLAYER_ID extraction from /players/slug-{id} href attribute
- [x] Add MLB_ID resolution via MLB Stats API (statsapi.mlb.com) with 24h in-memory cache
- [x] Add HEADSHOT_URL field per row (MLB static CDN img.mlbstatic.com)
- [x] Add TEAM_LOGO_URL and OPP_LOGO_URL fields per row (ESPN CDN a.espncdn.com)
- [x] Resources.tsx: player headshots in NAME column (circular avatar, fallback initials)
- [x] Resources.tsx: team logos in TEAM and OPP/OPP_TM columns (ESPN CDN 20px)
- [x] Resources.tsx: PLAYER_ID and MLB_ID in Identity column group
- [x] Resources.tsx: remove "Open RG" button from header
- [x] Resources.tsx: all column groups visible by default (defaultVisible: true for all)
- [x] Resources.tsx: localStorage persistence for column visibility preferences (key: rg_col_vis_v2)
- [x] Resources.tsx: clean compact metadata bar (single-line strip: ↻ age · rows · cols · RG timestamp)
- [x] Resources.tsx: INTERNAL_COLS set (HEADSHOT_URL, TEAM_LOGO_URL, OPP_LOGO_URL) excluded from display and CSV
- [x] TypeScript: 0 errors

## Session: 2026-05-08 — Bet Tracker Doubleheader Fix

- [x] ROOT CAUSE: AN API has no game_number field; DH games are two entries with same away+home matchup and different IDs/start times; findGame() always returned first match (G1) for any team-name lookup
- [x] actionNetwork.ts: Add gameNumber: 1|2 field to SlateGame interface
- [x] actionNetwork.ts: Post-sort DH detection in fetchAnSlateRaw — assign G1/G2 by chronological start time order
- [x] actionNetwork.ts: Same DH detection logic added to fetchMlbStatsSlate fallback
- [x] actionNetwork.ts: Log [AN][DH] when doubleheader G2 is detected
- [x] betTracker router: Pass gameNumber through getSlate return mapping
- [x] BetTracker.tsx: Add gameNumber: 1|2 to SlateGame frontend interface
- [x] BetTracker.tsx: GameSelector — dhMatchups Set detects same-matchup pairs on the slate
- [x] BetTracker.tsx: GameSelector — amber G1/G2 badge shown in dropdown list and selected trigger when DH detected
- [x] BetTracker.tsx: GameSelector — getLs() tries DH-qualified key (gameDate:away:home:gameNumber) before base key
- [x] scoreGrader.ts: gradeTrackedBet — primary resolution via anGameId (direct gameId === String(anGameId) match), fallback to team-name match
- [x] scoreGrader.ts: Detailed logging for both resolution paths with DH context
- [x] TypeScript: 0 errors
- [x] FIX CRITICAL: G2 doubleheader bets display G1 score (HOU 3-10) instead of G2 score (HOU 11-5) — both bets show same score
  - Root cause: LinescoreEntry type in BetTracker.tsx missing gameNumber field → keys "...:undefined" → fallback to ambiguous linescoreByTeams
  - Fix: Added gameNumber: 1 | 2 to LinescoreEntry type (BetTracker.tsx)
  - DB corrected: bet 60008 result=LOSS awayScore=11 homeScore=5 (via full grader pipeline re-run)
- [x] FIX: createBet autoGradeOnCreate missing gameNumber in gradeTrackedBet call — G2 DH bets graded as G1 on creation
  - Fix: Added gameNumber: (input.gameNumber ?? 1) as 1 | 2 to gradeTrackedBet call in createBet
- [x] IMPROVEMENT: Frontend createMut onSuccess handler — replace optimistic PENDING bet with real graded server response immediately
  - Fix: Added onSuccess(realBet, _input, context) that replaces optimistic bet by exact tempId (stored in onMutate context)
  - Benefit: Zero PENDING window for past games — UI shows WIN/LOSS/PUSH the instant the mutation resolves
  - Safe for rapid-fire creation: each optimistic entry has a unique tempId (−Date.now())
- [x] VALIDATION: 29/29 checks pass across 8 layers (MLB Stats API, gradeTrackedBet, gameNumber propagation, frontend onSuccess, DB state)

## Session: 2026-05-10 — OddsCell Line/Odds Display Fix (GameCard.tsx)
- [x] ROOT CAUSE: OddsCell received combined strings like `+1.5 (-181)` as mainValue with juiceStr=null — odds wrapped inside fixed-width pill and appeared as a second "line" value, causing visual confusion between book line and model line
- [x] FIX: Refactor all OddsCell variable declarations in OddsLinesPanel to separate line-only strings from odds-only strings
  - bkAwaySpreadLine / bkAwaySpreadJuice (was: bkAwaySpread = combined string)
  - bkHomeSpreadLine / bkHomeSpreadJuice (was: bkHomeSpread)
  - bkOverTotalLine / bkOverJuice (was: bkOverTotal)
  - bkUnderTotalLine / bkUnderJuice (was: bkUnderTotal)
  - mdlAwaySpreadLine / mdlAwaySpreadJuice (was: combined string)
  - mdlHomeSpreadLine / mdlHomeSpreadJuice (was: combined string)
  - mdlOverTotalLine / mdlOverJuice (was: combined string for NHL/MLB)
  - mdlUnderTotalLine / mdlUnderJuice (was: combined string for NHL/MLB)
- [x] Update all 8 OddsCell calls (4 away row + 4 home row) to pass mainValue=line and juiceStr=odds separately
- [x] TypeScript: 0 errors (confirmed post-fix)
- [x] Tests: 582/582 passing (confirmed post-fix)

## Session: 2026-05-10 — Model RL Odds Bug (mlbModelRunner.ts)
- [ ] ROOT CAUSE AUDIT: modelHomeSpreadOdds = -221 for LAD (-132 ML) is mathematically impossible — trace how rl_cover_pct is computed in mlbModelRunner.ts
- [ ] FIX: Correct the run-line cover probability calculation so model spread odds are consistent with model ML
- [ ] VERIFY: All 15 May 10 MLB games — modelHomeSpreadOdds must be worse than homeML for favorites, modelAwaySpreadOdds must be worse than awayML for underdogs
- [ ] TEST: 0 TypeScript errors, all tests passing

## Session: 2026-05-10 — MLB Model RL Odds Invariant Fix

- [x] Root cause identified: model ran with wrong rl_home_spread sign (awayRunLine had wrong sign at model run time, before scraper corrected it)
- [x] Added RL SIGN GUARD: detect flip → invalidate modelRunAt (skip bad write, re-run next cycle)
- [x] Added RL INVARIANT CHECK: P(cover -1.5) must be ≤ P(win outright) + 2pp — violation triggers invalidation
- [x] Added `invalidated` counter to summary log line
- [x] Updated mlbRunLineOdds.test.ts to use getMainSetBlock() helper (avoids capturing invalidation block)
- [x] Added 2 new tests: invariant guard presence + P(cover) ≤ P(win) check
- [x] All 584 tests passing, TypeScript 0 errors
- [x] DB: cleared modelRunAt for ATL@LAD (wrong -221 odds) — model re-ran and corrected to +127
- [x] Verified: 15/15 today's MLB games pass invariant check (0 violations)

## Session: 2026-05-10 — P1–P4 MLB AI Model Full Enhancement Roadmap

### P1-A: Weather Integration
- [ ] Add weather fields to dbGames SELECT in mlbModelRunner.ts (weatherTemp, weatherWind, weatherDome from mlbLineups)
- [ ] Parse weatherTemp string to temp_f float
- [ ] Parse weatherWind string to wind_speed_mph float + wind_dir string
- [ ] Add weather dict to EngineInput interface and pass to Python
- [ ] Add modelWeatherAdj column to games table for traceability
- [ ] Write vitest tests for weather parsing edge cases

### P1-B: Confirmed Lineup Statcast Data in Main Game Model
- [ ] Fetch awayLineup + homeLineup JSON from mlbLineups in mlbModelRunner.ts
- [ ] Batch-fetch mlbPlayers (iso, barrelPct, hardHitPct) by mlbamId
- [ ] Aggregate per-lineup weighted avg barrel/ISO/hard-hit
- [ ] Pass lineup Statcast dicts to EngineInput and Python
- [ ] Python: override team_stats_to_batter_features barrel_rate/iso/hard_hit with lineup data
- [ ] Write vitest tests for Statcast aggregation logic

### P1-C: NRFI Product Formula Fix
- [ ] Python: change nrfi_combined_signal from average to product formula
- [ ] Update NRFI_COMBINED_THRESHOLD to match product scale
- [ ] mlbModelRunner.ts: update TS-side combined signal to product formula
- [ ] Write vitest tests for product formula correctness

### P2-A: K-Props IP Fallback Fix
- [ ] Add ipPerGame to pitcher stats SELECT in mlbKPropsModelService.ts
- [ ] Change IP fallback: rolling5Ip ?? stats?.ipPerGame ?? EMPIRICAL_IP_PER_START
- [ ] Write vitest tests for IP fallback priority chain

### P2-B: HR-Specific Park Factor
- [ ] drizzle/schema.ts: add hrFactor double column to mlbParkFactors table
- [ ] Run pnpm db:push
- [ ] Backfill hrFactor from PARK_FACTORS Python constant
- [ ] mlbHrPropsModelService.ts: use hrFactor instead of parkFactor3yr
- [ ] Write vitest tests for hrFactor lookup

### P2-C: HR Props wOBA Double-Count Fix
- [ ] Remove woba_scale from base_rate in computePlayerPHr()
- [ ] Recalibrate HR_CALIBRATION_FACTOR
- [ ] Write vitest tests for wOBA-free base rate computation

### P2-D: Display Raw exp_total as Model Projection
- [ ] drizzle/schema.ts: add modelProjTotal decimal(6,2) column to games table
- [ ] Run pnpm db:push
- [ ] mlbModelRunner.ts: write r.proj_total to modelProjTotal
- [ ] GameCard.tsx + MlbCheatSheetCard.tsx: display modelProjTotal alongside total_line
- [ ] Write vitest tests for modelProjTotal DB write

### P3-A: RE Matrix 2025 Update
- [ ] Update RE_MATRIX dict in MLBAIModel.py with 2025 empirical values
- [ ] Recalibrate LEAGUE_CALIBRATION_MULT after RE matrix update

### P3-B: Per-Inning Linescore in NRFI Table View + Hundredths Precision
- [ ] Add InningBoxGrid to NrfiTableRowV3 component (compact inline design)
- [ ] Ensure all inning values display at 2 decimal places throughout
- [ ] Add responsive breakpoints: hide I6-I9 on mobile

### P3-C: NRFI Threshold Re-evaluation
- [ ] Recalibrate NRFI_COMBINED_THRESHOLD after product formula change

### P4-A: Lineup Order Integration
- [ ] mlbModelRunner.ts: fetch and parse awayLineup + homeLineup JSON
- [ ] Build per-batter feature dicts using individual player stats
- [ ] Pass lineup_players arrays to Python
- [ ] Python: use actual batting order when lineup confirmed and >= 7 players
- [ ] Write vitest tests for lineup order integration

### P4-B: Platoon Composition Adjustment for K-Props
- [ ] Parse lineup JSON to count LHH vs RHH batters
- [ ] Compute platoon_adj multiplier based on pitcher hand vs lineup composition
- [ ] Write vitest tests for platoon adjustment logic

## Session: 2026-05-10 — P1–P4 MLB AI Model Enhancements

- [x] P1-A: Weather integration — parse mlbLineups weather fields and pass to Python engine
- [x] P1-B: Confirmed lineup Statcast data in main game model — aggregate per-game barrel/ISO/hard-hit
- [x] P1-C: NRFI product formula fix — replace arithmetic average with geometric mean (product formula)
- [x] P2-A: K-Props IP fallback fix — 4-tier priority: ipMean3yr → ip/gs → rolling5Ip → EMPIRICAL
- [x] P2-B: HR-specific park factor — added hrFactor column to mlbParkFactors, migrated DB, backfilled 30 teams, wired into HR Props model
- [x] P2-C: HR Props wOBA double-count fix — removed woba_scale from base_rate, recalibrated HR_CALIBRATION_FACTOR to 0.82
- [x] P2-D: Display raw exp_total (model projection) alongside total_line (originated line) in TotalRow and F5GameCardV3
- [x] P3-A: Updated RE_MATRIX and RUN_VALUES to 2024 empirical values; updated PARK_FACTORS HR values for all 30 teams
- [x] P3-B: Per-inning linescore in NRFI table view with expandable I1–I9 grid + hundredths precision display
- [x] P3-C: NRFI threshold recalibrated to 0.52 (combined) and 0.54 (both) from 2026 live data analysis
- [x] P4-A: Per-player lineup order integration — replaced 9x team-average with heterogeneous per-player Statcast array
- [x] P4-B: Platoon composition adjustment for K-props — LHP vs RHH-heavy (+8%), LHP vs LHH-heavy (-6%), RHP vs LHH-heavy (+5%), RHP vs RHH-heavy (-3%)

## Session: 2026-05-10 — Full Multi-Market Backtest (2026 Live Data)

- [x] Backtest: Audit 2026 live data — 554 final MLB games (Mar 26 – May 10), 693 K-Props, 510 HR Props
- [x] Backtest: Full historical backtest engine (mlbFullBacktestEngine.ts) — all 5 markets
- [x] Backtest: tRPC procedures (getFullReport, getDailyTimeSeries, getEdgeBuckets, getKPropsReport, getHrPropsReport, runHistoricalBacktest)
- [x] Backtest: MlbBacktest UI page (/admin/backtest) — market tables, ROI curves, calibration charts, K/HR props deep-dive
- [x] Backtest: Optimal thresholds panel — 5 markets hitting ≥70% with exact threshold values
- [x] Backtest: HR Props calibration fix (HR_CALIBRATION_FACTOR 0.875 → 0.720, bias 3.57pp)
- [x] Backtest: K-Props calibration fix (bias -0.52 Ks/start → OVER ×1.05, UNDER ×1.03)
- [x] Backtest: Vitest coverage — 46 new tests (630 total passing, 0 failures)
- [x] Backtest: DB connection fix in backtest runner (createPool instead of createConnection)

## Session: 2026-05-14 — Paywall Restore
- [x] Restore paywall as default entry point: / → Home (hard gate)
- [x] Add auth guard on /feed — unauthenticated users redirected to /
- [x] Remove public mode /login redirect (restore proper login flow)
## Session: 2026-05-14 — Server-Side Auth Enforcement (Full Security Hardening)
- [x] Audit all publicProcedure endpoints — identified 13 sensitive procedures exposing model/betting data without auth
- [x] Convert games.list to appUserProcedure (model projections, edges, spread/ML odds)
- [x] Convert games.mlbLineups to appUserProcedure (pitcher/batting order data)
- [x] Convert games.mlbEnvSignals to appUserProcedure (park factors, bullpen ERA/FIP, umpire modifiers)
- [x] Convert oddsHistory.listForGame to appUserProcedure (odds movement data)
- [x] Convert strikeoutProps.getByGame/getByGames to appUserProcedure (K-prop projections)
- [x] Convert hrProps.getByGame/getByGames to appUserProcedure (HR prop projections)
- [x] Convert bracket.getGames to appUserProcedure (bracket data)
- [x] Convert mlbSchedule.getLast5ForMatchup/getTeamSchedule/getSituationalStats/getH2HGames to appUserProcedure
- [x] Convert nbaSchedule.getLast5ForMatchup/getTeamSchedule/getSituationalStats to appUserProcedure
- [x] Convert nhlSchedule.getLast5ForMatchup/getTeamSchedule/getSituationalStats to appUserProcedure
- [x] Add enabled: isAppAuthedForFav guard to ModelProjections.tsx games.list queries (fires AFTER auth resolves)
- [x] Add enabled: isAppAuthed guard to BettingSplits.tsx games.list query
- [x] Add enabled: appUser guard to NbaTeamSchedule, NhlTeamSchedule, MlbTeamSchedule queries
- [x] Fix SituationalResultsPanel NHL queries to respect enabled prop
- [x] Force-logout all 48 non-owner users via tokenVersion increment (DB: 2026-05-14 04:14:00)
- [x] TypeScript: 0 errors throughout
## Session: 2026-05-14 — User Management UI Responsive Fix + AVG Session Duration Accuracy
- [x] Fix header overflow on mobile: two-row layout (title row + actions row), actions use flex-1 to fill width
- [x] Fix stats grid orphan card: grid-cols-3 on mobile (3+2 layout, no orphan), grid-cols-5 on sm+
- [x] Fix MetricsPanel text sizes: text-[10px] sm:text-xs (was backwards sm:text-sm > text-xs)
- [x] Fix MetricsPanel value overflow: min-w-0 + overflow-hidden + truncate on value div
- [x] Fix AVG SESSION DURATION sublabel: "Avg active time per session" (was "Average time on platform per day")
- [x] Fix closeUserSessions: use lastHeartbeat-startedAt as durationMs (not now-startedAt)
- [x] Fix closeIdleSessions: same lastHeartbeat-based duration fix
- [x] Fix getSessionMetrics: cap outlier sessions at 4h (14_400_000ms) to exclude pre-fix corrupted rows
- [x] TypeScript: 0 errors

## Session: 2026-05-14 — Three UX Enhancements
- [x] Session-expired toast: intercept UNAUTHORIZED in query/mutation cache, show toast before redirect
- [x] durationMs histogram: server-side bucket query + MetricsPanel bar chart
- [x] User table: default lastSignedIn DESC sort + clickable column header sort

## Session: 2026-05-14 — Login Fix
- [x] Fix iOS Safari "string did not match expected pattern" on login: add name/id attributes to username and password inputs, replace bullet placeholder with text placeholder

## Session: 2026-05-14 — CSRF Fix + Auth Features
- [x] Fix CSRF false-positive: whitelist production domains, fix origin detection
- [x] Forgot password flow: requestPasswordReset + resetPassword with time-limited token
- [x] Login rate limiting: per-IP 10 attempts / 15 min, 429 response
- [x] Session duration badge in user menu when stayLoggedIn is active

## Session: 2026-05-14 — Blank Screen Fix (React 19 render-phase navigate anti-pattern)
- [x] UserManagement: move render-phase navigate() to useEffect, add loading/redirecting skeleton
- [x] AdminModelStatus: move hooks before auth guard (Rules of Hooks violation), move navigate to useEffect
- [x] IngestAnOdds: move render-phase navigate() to useEffect
- [x] PostponedGames: move hooks before auth guard, move navigate to useEffect
- [x] SecurityEvents: move render-phase navigate() to useEffect

## Session: 2026-05-14 — iOS Safari Password Show/Hide Fix (Root Cause)
- [x] LoginModal: keep type=password always, use CSS webkit-text-security for show/hide, add autoCapitalize/autoCorrect/spellCheck
- [x] Home.tsx: same fix + add id/name attributes + fix bullet placeholder
- [x] ResetPassword.tsx: both new-password and confirm-password fields fixed
- [x] UserManagement.tsx: admin create/edit password field fixed

## Session: 2026-05-14 — Login hardening (3 improvements)
- [x] Fix 1: Add id="home-login-username" and name="username" to Home.tsx username input for Safari AutoFill matching
- [x] Fix 2: Harden ForgotPasswordModal for iOS Safari — add noValidate to form, replace required+minLength with aria-required+onInvalid on email input
- [x] Fix 3: Backend — export loginRateMap, LOGIN_RATE_MAX_FAILURES, LOGIN_RATE_WINDOW_MS; extend checkLoginRateLimit to return lockoutUntil; add getLoginStatus publicProcedure
- [x] Fix 3: Frontend — create LoginAttemptBanner component with attempt counter + lockout countdown; wire into Home.tsx and LoginModal.tsx
- [x] Fix 3: Tests — 11 new vitest tests in loginStatus.test.ts (all passing)
## Session: 2026-05-15 — Login Button + Owner Dropdown Fix
- [x] Fix: Restore login button (Sign In) for unauthenticated users in ModelProjections.tsx header dropdown
- [x] Fix: Restore login button (Sign In) for unauthenticated users in BettingSplits.tsx header dropdown
- [x] Fix: Ensure owner-exclusive dropdown pages are accessible to @prez after login

## Session: 2026-05-15 — iOS Safari Login Fix (Definitive 7-Signal Elimination)
- [x] LoginModal.tsx: remove name attr, autoComplete="off", remove autoFocus, always type="password" + webkit-text-security for show/hide
- [x] Home.tsx: same 7-signal fix on inline login panel (username + password inputs)
- [x] ResetPassword.tsx: remove name attrs, always type="password" + webkit-text-security on both password fields
- [x] ForgotPasswordModal.tsx: remove name attr, autoComplete="off" on identifier input
- [x] TypeScript: 0 errors | Tests: 655/655 pass

## Session: 2026-05-15 — JACK MAC Tab
- [x] useUrlState.ts: add 'jackmac' to FeedMobileTab type and VALID_TABS
- [x] ModelProjections.tsx: add JACK MAC tab to FEED_TABS (MLB only, whitelist-gated render)
- [x] ModelProjections.tsx: add JACK MAC view section (inline Resources content, all 4 sub-tabs)
- [x] ModelProjections.tsx: remove RESOURCES dropdown entry
- [x] rotogrinderProxy.ts: add 'sippi' to ALLOWED_USERNAMES
- [x] Resources.tsx: add 'sippi' to ALLOWED set (fallback page still accessible)
- [x] TypeScript: 0 errors | Tests: 655/655 passed

## Session: 2026-05-15 — Google Sheets Sync + JACK MAC UX
- [ ] Store GOOGLE_SERVICE_ACCOUNT_JSON secret
- [ ] Install googleapis npm package
- [ ] Create server/jackMacSheetsSync.ts — sync all 4 RG pages to Google Sheet tabs
- [ ] Add jackMac.syncToSheets tRPC procedure (whitelist-gated)
- [ ] Add REFRESH GOOGLE SHEETS button to JackMacView.tsx (#34A853, bold white, Sheets logo)
- [ ] Reorder JACK MAC tab to leftmost position for @lucianobets only
- [ ] TypeScript: 0 errors | Tests: pass

## Session: 2026-05-15 - Fangraphs Lineup Scraper

- [x] Inspect Fangraphs scores page structure (headless browser, understand React-rendered lineup data)
- [x] Build fangraphsScraper.ts: scrape lineups for today + tomorrow (PST dates), full logging (MLB Stats API)
- [x] Integrate into jackMacSheetsSync.ts: append 2 new tabs (Today Lineups, Tomorrow Lineups)
- [x] Add tRPC procedure: jackMac.getLineups (whitelist-gated)
- [x] Add Fangraphs Lineups sub-tab to JackMacView.tsx (LINEUPS main tab in JackMacView)
- [x] Full end-to-end test: 678/678 tests pass, 15 MLB games with 9-player lineups verified

## Performance Audit Fixes (2026-05-16)

- [ ] FIX-1: Add composite DB index on games(sport, gameDate, gameStatus) — eliminates IndexLookUp+TableRowIDScan double-read
- [ ] FIX-2: Add server-side in-memory cache for games.list (30s TTL, keyed by sport+date) — eliminates redundant DB round-trips on every 60s refetch
- [ ] FIX-3: Add server-side cache for games.activeSports (60s TTL) — eliminates separate DB query on every page load
- [ ] FIX-4: Eliminate upsertUser(lastSignedIn) on every authenticated request — replace with debounced write (max once per 5 min per user)
- [ ] FIX-5: Reduce superjson overhead on games.list — 187-column SELECT * returns 440KB; add column projection for public feed
- [ ] FIX-6: Deduplicate games.list(NBA) query — allNbaGames fires always even when sport=MLB; gate with enabled flag
- [ ] FIX-7: Add staleTime to activeSports query (currently 5min staleTime but refetchOnWindowFocus:true causes extra fetches)

## Speed Audit Round 2 (2026-05-16)
- [ ] FIX-A: Strip null fields from games.list response (425KB → ~60KB)
- [ ] FIX-B: Pre-warm games.list cache at server startup (MLB, NHL, NBA)
- [ ] FIX-C: Replace superjson Date meta with Unix timestamps (eliminate 111-entry meta section)
- [ ] FIX-D: Add games.list GET-level HTTP cache headers for Cloudflare edge caching
- [ ] FIX-E: Add server-side session cache to skip JWT verify + DB lookup for repeat requests

## Session: 2026-05-16 - Fix "No MLB games found" at 3:01 AM

- [ ] Root cause: games.list query sends sport=MLB with NO gameDate → server applies 7-day rolling window. The cache key is MLB:ROLLING. The cache pre-warm fires at startup using Date.now() at that moment. But the cache TTL is only 30s — so the pre-warmed cache expires in 30s. After that, every listGames call re-runs the 7-day window using the current server time. This is NOT the bug. The real bug is: the client sends { sport: 'MLB' } with NO gameDate. The server returns all games in the 7-day window. The client then filters by selectedDate (from useUrlState → todayUTC()). todayUTC() at 3:01 AM PST = 11:01 UTC → before 11:00 UTC cutoff → effective date = UTC date - 1 day = yesterday. But the server's 7-day window starts from today UTC (since 11:01 UTC > 11:00 UTC cutoff on server). So the server window starts from 2026-05-16 but the client filters for 2026-05-15. The client gets games but filters them all out → "No MLB games found".
- [ ] Fix: align the server-side 7-day window start with the client-side todayUTC() effective date. The server must use the same FEED_CUTOFF_UTC_HOUR=11 gate and include yesterday's games when UTC hour < 11. ALREADY DONE in db.ts (lines 318-332). But wait — at 3:01 AM PST = 11:01 UTC, the UTC hour IS 11, so isBeforeCutoff = (11 < 11) = FALSE. Server window starts from today (2026-05-16). Client todayUTC() at 11:01 UTC: isBeforeCutoff = (11 < 11) = FALSE → effective date = today UTC = 2026-05-16. So they should MATCH. Re-examine: 3:01 AM shown in screenshot is device local time. User is in PST (UTC-7 in summer / PDT). 3:01 AM PDT = 10:01 AM UTC. UTC hour = 10. isBeforeCutoff on server: (10 < 11) = TRUE → window starts from yesterday (2026-05-15). Client todayUTC() at 10:01 UTC: isBeforeCutoff = (10 < 11) = TRUE → effective date = yesterday = 2026-05-15. They MATCH. So the date logic is correct. The real issue must be something else.
- [ ] Deep dive: check if the 30s cache TTL is causing stale data. At 3:01 AM, the server pre-warms the cache at startup. The cache key is MLB:ROLLING. The pre-warm runs at startup time T. At T, UTC hour might be different from 10. If the server restarted at e.g. 2:00 AM PDT = 9:00 UTC (before cutoff), it pre-warms with yesterday's games. Then at 3:01 AM PDT = 10:01 UTC (still before cutoff), the cache key MLB:ROLLING is still valid (same key). But if the server restarted at e.g. 4:00 AM PDT = 11:00 UTC (after cutoff), it pre-warms with today's games. Then the cache has today's games. But the client at 3:01 AM PDT (before cutoff) requests yesterday's games. The server returns today's games from cache. Client filters by yesterday → 0 games.
- [ ] ACTUAL ROOT CAUSE: The cache key MLB:ROLLING does NOT encode the date window start. Two different calls at different UTC hours (one before cutoff, one after) produce DIFFERENT game sets but share the SAME cache key. If the cache was populated after the 11:00 UTC cutoff (e.g. server restarted at 11:05 UTC), it contains today's games. A user at 10:59 UTC (before cutoff) hits the cache and gets today's games, but their client filters for yesterday → 0 games.
- [ ] Fix: include the effective window start date in the cache key for MLB:ROLLING queries. Cache key should be MLB:ROLLING:{windowStartDate} so pre-cutoff and post-cutoff windows are cached separately.
- [ ] Also: the cache pre-warm at startup fires once. If the server starts before 11:00 UTC, the cache contains yesterday's window. After 11:00 UTC the cache expires (30s TTL) and the next request re-populates with today's window. This is correct. The bug only occurs if the cache was populated AFTER 11:00 UTC and a user accesses BEFORE 11:00 UTC (impossible since cache expires in 30s). Actually with 30s TTL this scenario is impossible — the cache can't be stale for more than 30s. So the date-in-cache-key fix is a nice-to-have but not the root cause.
- [ ] NEW HYPOTHESIS: The auto-advance logic in ModelProjections.tsx. Lines 601-608: if allGames has games but none match selectedDate, it auto-advances to allDates[0]. If allDates[0] is today (2026-05-16) but selectedDate is yesterday (2026-05-15), it auto-advances to today. This is correct behavior. But what if allGames is empty? Then allDates is empty, the auto-advance doesn't fire, and selectedDate stays as yesterday. But the server returned games for yesterday (before cutoff), so allGames should not be empty.
- [ ] FINAL HYPOTHESIS: The games.list query is called with { sport: selectedSport } and NO gameDate. The server returns the 7-day window. But the client-side filter at line 613 filters by selectedDate. If selectedDate = yesterday and allGames contains only today's games (because the server window started from today), then the filter returns 0 games. This can happen if: (1) the server's isBeforeCutoff check uses a DIFFERENT time than the client's. The server runs in UTC. The client runs in the user's browser. They both use Date.now() which is UTC-based. They should agree. Unless... the server's clock is wrong or the server is in a different timezone. Cloud Run containers run in UTC. Date.now() is always UTC. So they should agree.
- [ ] SIMPLEST FIX: Instead of relying on the server to return the right window and the client to filter, send the explicit gameDate from the client to the server. The client already knows selectedDate (from todayUTC()). Pass it as gameDate in the query. Then the server does an exact match (eq(games.gameDate, opts.gameDate)) and returns only that date's games. No window logic, no cutoff logic, no mismatch possible.
- [x] Implement fix: pass selectedDate as gameDate in games.list query in ModelProjections.tsx
- [x] Update server cache key to use explicit gameDate when provided (already done — key is MLB:{gameDate})
- [x] Add games.getAvailableDates tRPC procedure + db.getAvailableDates function (5-min TTL cache)
- [x] Replace allDates computation from allGames with dedicated getAvailableDates query in ModelProjections
- [x] Update auto-advance logic to use allDates.includes(selectedDate) instead of allGames scan
- [x] Invalidate _availableDatesCache in invalidateGamesCache() on any game mutation
- [x] TypeScript: 0 errors
- [x] Tests: 678/678 pass
- [x] Checkpoint and publish

## Session: 2026-05-16 — Bet Tracker Full Audit & Performance Overhaul

- [ ] Root-cause White Sox ML 5U bet save failure
- [ ] Audit all add-bet form validation (sport, betType, odds, units, result, date)
- [ ] Audit tRPC bets.add procedure — input schema, DB insert, error propagation
- [ ] Audit DB insert helper — field mapping, constraint violations, silent failures
- [ ] Audit client-side form state — reset logic, optimistic updates, error display
- [ ] Fix all identified save/validation bugs
- [ ] Performance: memoize all expensive computations (stats, grouping, filtering)
- [ ] Performance: eliminate all unnecessary re-renders and unstable references
- [ ] Performance: audit refetch intervals and staleTime settings
- [ ] Performance: audit loading/skeleton states
- [ ] TypeScript: 0 errors
- [ ] Tests: all pass
- [ ] Checkpoint

## Session: 2026-05-16 — Bet Tracker Audit & Performance Overhaul

- [x] BUG #1 CRITICAL: Fix permanent submission lock — isSubmittingRef not released on validation failure (White Sox ML save failure root cause)
- [x] BUG #2 CRITICAL: Fix idempotency guard returning partial sentinel {id, duplicate:true} — now returns full bet row from DB
- [x] BUG #2 CLIENT: Guard onSuccess against duplicate sentinel shape — skip cache replacement, let invalidate() sync
- [x] BUG #4 MEDIUM: Fix handleResult useCallback — use stable ref pattern so React.memo(BetCard) is never broken by unstable mutateAsync reference
- [x] PERF: Remove per-entry console.log from linescoreByPk useMemo (30+ logs/60s eliminated)
- [x] PERF: Remove per-entry console.log from linescoreByGameNum useMemo (30+ logs/60s eliminated)
- [x] PERF: Remove per-row console.log from GameSelector dropdown render (fires on every open × every game)
- [x] TypeScript: 0 errors
- [x] Tests: 678/678 pass
- [x] Checkpoint saved

## Session: 2026-05-16 — Bet Tracker Save Failure & Blank Page Crash (Round 2)

- [ ] Audit server betTracker.create procedure end-to-end for silent failure paths
- [ ] Audit client handleSubmit for any remaining lock/guard issues
- [ ] Identify and fix blank page rendering crash after data loads
- [ ] Fix optimistic update pipeline (onMutate → onSuccess → onSettled)
- [ ] Eliminate all performance bottlenecks in initial load and re-render
- [ ] TypeScript: 0 errors
- [ ] Tests: all pass
- [ ] Checkpoint saved

## Session: 2026-05-17 — ModelProjections No-Games & Loading Overhaul

- [x] BUG #1 CRITICAL: Fix startup pre-warm — was using MLB:ROLLING cache key, client requests MLB:{date} — now pre-warms yesterday/today/tomorrow with explicit gameDate
- [x] BUG #2 CRITICAL: Add games.getCurrentDate server procedure — returns authoritative effective date
- [x] BUG #2 CLIENT: Add server-authoritative date sync in ModelProjections — useEffect syncs selectedDate to server date on mount
- [x] PERF #1: Increase games.list staleTime from 30s to 60s — matches server cache TTL, eliminates unnecessary refetches
- [x] PERF #2: Add placeholderData: keepPreviousData to games.list — eliminates Loading projections flash on sport/date switch
- [x] TypeScript: 0 errors
- [x] Tests: 678/678 pass
- [x] Checkpoint saved

## Session: 2026-05-17 — Loading Performance Audit (8:23 PM PDT)

- [ ] Audit server startup pre-warm timing and cache state
- [ ] Audit DB query latency for games.list (cold vs warm)
- [ ] Audit tRPC request chain timing (network + server + DB)
- [ ] Audit client rendering pipeline (bundle size, hydration, query waterfall)
- [ ] Fix all identified bottlenecks
- [ ] TypeScript: 0 errors
- [ ] Tests pass
- [ ] Checkpoint saved

## Session: 2026-05-17 — Loading Performance Overhaul

- [x] ROOT CAUSE: Identified runaway cache invalidation loop — 60+ invalidations/minute from per-game updateBookOdds/updateNcaaStartTime calls during VSiN refresh cycles
- [x] FIX: Replace synchronous invalidateGamesCache() with debounced 500ms version — burst of 15 game updates now produces 1 invalidation instead of 15+
- [x] FIX: Add forceInvalidateGamesCache() for admin operations (publish, delete, approve) — immediate visibility, no debounce
- [x] FIX: Upgrade deleteGamesByFileId, deleteGameById, setGameModelPublished, bulkApproveModels, setGamePublished, publishAllStagingGames to forceInvalidateGamesCache()
- [x] PERF: Increase GAMES_LIST_TTL_MS from 30s to 60s — safe now that invalidation is debounced, halves DB round-trips per session
- [x] TypeScript: 0 errors
- [x] Tests: 678/678 pass
- [x] Checkpoint saved

## Session: 2026-05-17 — 100x Feed Performance Overhaul
- [x] REACT: Wrap GameCard in React.memo — prevents re-renders when parent re-renders due to unrelated state changes (now-ticker, search query, header height)
- [x] REACT: Wrap toggleModel in useCallback([]) — stable reference across renders
- [x] REACT: Wrap handleFeedTabChange in useCallback — stable reference, eliminates new function on every render
- [x] REACT: Wrap handleToggleFavorite in useCallback — stable reference, eliminates new function on every render
- [x] REACT: Hoist mobileTab computation to useMemo (gameMobileTab) — inline ternary was creating new string reference every render, defeating GameCard.memo
- [x] REACT: Hoist isAppAuthed computation to useMemo (isAppAuthedProp) — Boolean(appUser) inline was unstable
- [x] REACT: Replace inline onMobileTabChange arrow functions with stable handleFeedTabChange callback
- [x] REACT: Merge games + gamesByDate into single useMemo pass — eliminated one full O(n) iteration over the games array
- [x] QUERY: Add staleTime: 55_000 + refetchOnWindowFocus: false to lastRefresh query
- [x] QUERY: Add staleTime: 30_000 to favData and favWithDatesData queries
- [x] BUNDLE: Add lazy() loading for all 15 non-critical pages — eliminates ~60% of initial JS bundle
- [x] BUNDLE: Add Suspense boundary in Router for lazy pages
- [x] BUNDLE: Add vendor chunk splitting (vendor-react, vendor-trpc, vendor-motion, vendor-radix)
- [x] BUNDLE: Set build target to es2020/chrome90/firefox88/safari14
- [x] ANIMATION: Reduce GameCard motion.div y offset 8->4 and add explicit duration: 0.12s
- [x] SERVER: Silence GamesCache HIT log — was logging on every cache hit (~1/min per user)
- [x] SERVER: Silence AvailDatesCache HIT log
- [x] SERVER: Silence ActiveSportsCache HIT log
- [x] SERVER: Silence games.list PUBLIC log — was logging on every page load and every 60s refetch
- [x] SERVER: Silence getCurrentDate log — was logging every 5 minutes per user
- [x] SERVER: Silence getAvailableDates log — was logging every 5 minutes per user
- [x] DB: Increase connection pool from 10 to 20
- [x] DB: Increase queue limit from 50 to 100
- [x] DB: Increase idleTimeout from 10s to 30s
- [x] DB: Add compress: true — reduces wire traffic between app server and TiDB
- [x] OBSERVABILITY: Add cache hit/miss counters to all 3 cache layers
- [x] OBSERVABILITY: Add /api/perf endpoint — real-time cache hit rates, invalidation timing, memory usage, DB circuit state
- [x] TypeScript: 0 errors
- [x] Tests: 678/678 pass

## Session: 2026-05-17 — BetTracker 100x Performance Overhaul

- [x] Guard getLs() HIT/MISS/GAMENUM console.logs with IS_DEV (fired on every linescore lookup in production)
- [x] Guard linescoreByPk and linescoreByGameNum useMemo summary logs with IS_DEV
- [x] Guard IntersectionObserver sentinel log with IS_DEV
- [x] Guard dateRange STATE logs in useMemo with IS_DEV
- [x] Guard autoGrade STATE/STEP logs with IS_DEV
- [x] Guard game select, addBet toggle, dateRange changed logs with IS_DEV
- [x] Guard BetCard render-loop MLB linescore log with IS_DEV (was firing per-card per-render)
- [x] Hoist daySections IIFE out of JSX into useMemo (was rebuilding sections array on every render)
- [x] Replace IIFE in JSX with pre-computed daySections.map()
- [x] Wrap EquityChart in React.memo (prevents redraw when parent stats panel re-renders)
- [x] Wrap BreakdownPanel in React.memo
- [x] Wrap BreakdownGrid in React.memo
- [x] Guard EquityChart ResizeObserver and canvas draw logs with NODE_ENV check
- [x] Guard server-side stats cache HIT/MISS logs with NODE_ENV check
- [x] Guard getLinescores STEP log (fires per MLB date per 60s poll) with NODE_ENV check
- [x] TypeScript: 0 errors | Tests: 678/678 pass

- [x] Discord-only login — replaced email/password with Discord OAuth as sole login method
- [x] discordLogin.ts — new server route /api/auth/discord-login/connect + /callback
- [x] discordLoginStates DB table — CSRF state store for Discord-as-primary-login
- [x] LoginModal rewritten — Discord-only, no password fields
- [x] Home.tsx rewritten — Discord Sign In CTA, error banners for all OAuth failure paths
- [x] Discord guild role check — verifies AI MODEL SUB role (ID: 1474938477664796672) via guilds.members.read scope
- [x] JWT-based CSRF state in /connect — zero DB operations, <2ms
- [x] Parallel Discord API calls in /callback — saves ~200ms
- [x] Fire-and-forget profile update after redirect
- [x] Loading spinner + "Redirecting to Discord..." state on login buttons (LoginModal + Home.tsx)
- [x] prompt=consent as server default — prevents silent failures for users with expired Discord sessions
- [x] RequireAuth component — auth gate on all protected routes
- [x] Global force-logout — tokenVersion incremented for all 53 users
- [x] Sign-out fix — cache invalidation + hard redirect to /login
- [x] useAppAuth fix — staleTime:0, gcTime:0, refetchOnWindowFocus:true
- [x] RequireAuth fix — added minWaitDone state + 800ms useEffect to prevent redirect race on OAuth callback
- [x] RequireAuth fix — timeout increased from 5s to 10s
- [x] LoginModal fix — removed prompt=none from loginUrl (server defaults to consent)
- [x] TypeScript: 0 errors | Tests: 698/698 pass | Build: clean 7.00s

- [x] discordLogin fix — removed guilds.members.read scope (caused Discord Server Error when bot not in guild)
- [x] discordLogin fix — OAuth scope changed to identify only; access controlled by DB (discordId + hasAccess + expiryDate)
- [x] discordLogin fix — wrapped entire /callback handler in top-level try/catch (Express 4 async safety)
- [x] discordLogin fix — added explicit HTTP status check on Discord profile response
- [x] discordLogin fix — added access_token presence validation after token exchange
- [x] discordLogin.test.ts — updated tests to reflect new DB-level access control invariants (21/21 pass)
- [x] TypeScript: 0 errors | discordLogin tests: 21/21 pass

- [x] discordLogin fix — added AbortSignal.timeout(8000) to Discord token exchange fetch (was hanging indefinitely)
- [x] discordLogin fix — added AbortSignal.timeout(8000) to Discord profile fetch (was hanging indefinitely)
- [x] discordLogin fix — added 15s total callback deadline timer (clearTimeout on success/error)
- [x] discordLogin fix — added isTimeout detection to distinguish timeout vs API error in catch blocks
- [x] Home.tsx fix — added timeout, server_error, db_unavailable error message cases
- [x] TypeScript: 0 errors | discordLogin tests: 21/21 pass | callback response: 3ms

- [x] Generate Unique Invite Link button for unconnected users in UserManagement
- [x] discordInviteTokens DB table (token, userId, expiresAt, usedAt, createdAt)
- [x] server/discordInvite.ts — /connect and /callback Express routes
- [x] generateDiscordInvite tRPC procedure in appUsers router
- [x] Invite modal UI with copy-to-clipboard, expiry display, how-it-works guide
- [x] discordInvite.test.ts — 24 tests covering token structure, security, error paths, success path

- [x] Fix execSync blocking event loop in renderSplitsCard.ts — replaced with async execAsync (promisify exec) so Playwright install does not freeze all HTTP requests for 2 minutes at cold start

## Session: 2026-05-17 - Bet Tracker Save Failure Fix + Past Date Slate Support

- [ ] Fix: sanitize formDate on iOS Safari — strip time component from date input value (slice 0,10)
- [ ] Fix: add Zod .transform() to normalize gameDate on server side (strip T and beyond)
- [ ] Fix: add past date slate fallback for NHL, NBA, NCAAM (currently only MLB has fallback)
- [ ] Fix: handle empty formDate (date picker cleared) with graceful validation message
- [ ] Enhancement: add staleTime to getSlate query for past dates (immutable — use Infinity)
- [ ] Enhancement: show "No games found for this date" with manual entry option for past dates

## Session: 2026-05-17 - Bet Tracker Save Fix + Past Date Slates

- [x] Fix Bet Tracker save failure — iOS Safari date format (Zod regex)
- [x] Add server-side Zod transform for gameDate normalization (safety net)
- [x] Add NHL fallback (api-web.nhle.com) for past date slates
- [x] Add NBA fallback (ESPN API) for past date slates
- [x] Add NCAAM fallback (ESPN API) for past date slates
- [x] Add staleTime:Infinity for past-date slate queries (immutable cache)
- [x] Fix Bet Tracker date filter defaulting to today — change default to "All Time" so all historical bets load
- [x] ruff + vulture audit: 0 Python errors, dead code removed
- [x] Shared mlbamIdCache module: eliminates duplicate MLB Stats API calls (HR + K-Props)
- [x] NHL fetch timeout: AbortSignal.timeout(12s/10s) on schedule + live scores endpoints
- [x] Remove unused imports in routers.ts: updateBookOdds, runVsinRefresh, MLB_BY_ABBREV
- [x] Exhaustive Discord invite-link audit: find and fix ALL failure modes causing service errors

## Session: 2026-05-18 - Exhaustive Dead Code Elimination + Performance Optimization

- [ ] Phase 1: Map full project structure (Python, TypeScript, dependencies)
- [ ] Phase 2: ruff + vulture on all Python; TypeScript dead-code analysis
- [ ] Phase 3: Unused npm dependency scan; import audit across client + server
- [ ] Phase 4: Server log mining for recurring errors, slow queries, circuit breaker trips
- [ ] Phase 5: Execute all Python fixes
- [ ] Phase 6: Execute all TypeScript fixes (dead files, imports, exports, bottlenecks)
- [ ] Phase 7: Remove unused npm dependencies
- [ ] Phase 8: Fix all recurring server errors
- [ ] Phase 9: Full test suite + build verification

## Session: 2026-05-18 - Projection Loading Speed Optimization (100x)
- [x] Verify DB index idx_games_sport_date_status on (sport, gameDate, gameStatus) — already present
- [x] Fix getAvailableDates staleTime: 30s → 60s to match server cache TTL (eliminates spurious refetch)
- [x] Fix allNbaGames staleTime: 30s → 60s to match server cache TTL
- [x] Defer lastRefresh query until gamesLoading=false (non-critical, was competing for tRPC batch slot)
- [x] Defer favData query until gamesLoading=false (non-critical, was competing for tRPC batch slot)
- [x] Defer favWithDatesData query until gamesLoading=false (non-critical, was competing for tRPC batch slot)
- [x] URL-aware prefetch in RequireAuth: read ?sport= and ?date= from URL so prefetch cache key matches ModelProjections mount request exactly
- [x] Prefetch yesterday as fallback in RequireAuth to cover 11:00 UTC date transition (both dates warm in cache)
- [x] Replace all 5 Loader2 spinners in feed with GameCardSkeleton (content-shaped placeholder, zero layout shift)
- [x] Replace auto-retry Loader2 spinner with GameCardSkeleton for consistency
- [x] TypeScript check: 0 errors
- [x] Test suite: 723/723 passed

## Session: 2026-05-18 - Manual Discord ID Pre-Registration in User Management
- [x] Add manualDiscordId VARCHAR(32) column to app_users schema (migration 0088)
- [x] Add manualDiscordId to listUsers return map in appUsers.ts router
- [x] Add manualDiscordId to AppUserRow type in UserManagement.tsx
- [x] Add setManualDiscordId ownerProcedure: snowflake validation, uniqueness check, DB write
- [x] Inject CP-3b fallback in discordLogin.ts: lookup by manualDiscordId when discordId not found
- [x] CP-3b: atomically promote manualDiscordId → discordId on first Discord login, clear manualDiscordId
- [x] UserManagement DISCORD USERNAME cell: clickable "–" opens inline input for rows with no discordId
- [x] Inline input: Enter to save, Escape to cancel, pending spinner, amber "pending" badge for pre-registered IDs
- [x] TypeScript check: 0 errors
- [x] Test suite: 723/723 passed

## Session: 2026-05-18 - Discord ID Input Bug Fix (Table Cell Clipping)
- [x] Root cause identified: TableCell whitespace-nowrap + overflow-hidden clipped inline input to ~0px effective width
- [x] Replaced inline input with fixed-position modal rendered outside table DOM tree
- [x] Modal escapes all overflow-hidden/whitespace-nowrap constraints on TableCell
- [x] Modal shows user context (@username + email), instructions, autoFocus input, Enter/Escape keyboard shortcuts
- [x] Amber (pending) badge in table cell for pre-registered IDs still shown; click to re-open modal
- [x] rawUsers used for modal user lookup (not filtered 'users' array)
- [x] TypeScript check: 0 errors
- [x] Test suite: 723/723 passed

## Session: 2026-05-18 - Discord ID Immediate Connection (Admin-side Bot API resolution)
- [x] setManualDiscordId procedure rewritten: now calls Discord Bot API GET /users/{id} immediately
- [x] Resolves discordId + discordUsername + discordAvatar + discordConnectedAt on save
- [x] Writes full Discord connection directly to app_users — no login required from user
- [x] Clears manualDiscordId after successful connection (no pending state)
- [x] Fallback to pending mode if DISCORD_BOT_TOKEN not set
- [x] Frontend onSuccess handler updated to show @username on immediate connect
- [x] Modal instructions updated: "immediately connected — no login required"
- [x] Button text changed from "Save Discord ID" to "Connect Discord"
- [x] Pending badge removed from table cell (no longer needed)
- [x] TypeScript check: 0 errors
- [x] Test suite: 723/723 passed

## Session: 2026-05-18 - Fix ownerProcedure permission gate (DB-authoritative role check)
- [x] Root cause identified: ownerProcedure checked JWT payload.role (stale) instead of DB user.role (live)
- [x] ownerProcedure rewritten: DB lookup happens BEFORE role check — role is now DB-authoritative
- [x] JWT role claim still logged for audit but not used for access decision
- [x] @prez and @sippi (role='owner' in DB) now pass ownerProcedure without re-login
- [x] TypeScript check: 0 errors
- [x] Test suite: 723/723 passed

## Session: 2026-05-18 - Fix ownerProcedure stale cache causing permission denial
- [x] Root cause 2 identified: _appUserByIdCache (30s TTL) + dbCircuitBreaker cache returned stale role
- [x] Added invalidateAppUserByIdCache + invalidateCachedAppUser at top of ownerProcedure
- [x] ownerProcedure now forces a fresh DB read on every call — zero stale role risk
- [x] TypeScript check: 0 errors
- [x] Test suite: 723/723 passed

## Session: 2026-05-18 - Discord Bot Token Refresh + Error Message Fix
- [x] Validated new Discord Bot token (status=200, username=prezbets, global_name=PREZ)
- [x] Updated DISCORD_BOT_TOKEN secret in production
- [x] Fixed errorUtils.ts CHECK 4 to use exact string matching instead of msg.includes("permission") — prevents Bot token errors from being masked as permission errors
- [x] Fixed setManualDiscordId 401/403 error message to be explicit and actionable
