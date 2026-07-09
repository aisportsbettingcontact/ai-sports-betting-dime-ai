# T4 Schema Reference (for context builder)

## wc2026_matches columns:
match_id, match_date, kickoff_utc, stage, group_letter, matchday, home_team_id, away_team_id, venue_id, home_score, away_score, status, is_host_home, espn_match_id, attendance, display_order, advancing_team_id, fifa_match_id, match_minute

## wc2026_teams columns:
team_id, name, fifa_code, group_letter, flag_code, flag_url, slug

## wc2026_venues columns:
venue_id, city, country, stadium, timezone, elevation_m

## wc2026MatchOdds columns (relevant):
id, match_id, espn_match_id, home_team, away_team
book_home_ml, book_draw, book_away_ml (1X2 odds)
book_home_wd, book_away_wd (win/draw odds)
book_home_to_advance, book_away_to_advance
odds_updated_at, odds_source, market_status

## CRITICAL: The 1X2 odds columns are:
- book_home_ml (NOT book_home)
- book_draw
- book_away_ml (NOT book_away)

## Context builder fix needed:
In wc2026Context.ts query #2:
- Change `book_home` → `book_home_ml`
- Change `book_away` → `book_away_ml`
- The WHERE clause should be: WHERE book_home_ml IS NOT NULL

## JWT payload for app_session:
{ sub: String(userId), role: 'owner'|'admin'|'user', type: 'app_user', tv: tokenVersion }
Signed with HS256 using ENV.cookieSecret (JWT_SECRET)

## Owner token for testing:
[REDACTED — token rotated, see SEC-INC-001]

## getAppUserById function location:
server/db.ts - returns user object with: id, role, hasAccess, expiryDate, stripeSubscriptionId, etc.

## Route registration:
server/_core/index.ts line 45: import { registerDimeWC2026Route } from "../dime-wc2026.route";
server/_core/index.ts line 444: registerDimeWC2026Route(app);

## Error from logs:
The first query (matches) now works with ht.name and v.stadium
The SECOND query (odds) fails because column is book_home_ml not book_home

## Test results so far:
- Unauthenticated → 401 AUTH_REQUIRED ✓
- No subscription (user 999999) → 403 SUBSCRIPTION_REQUIRED ✓
- Owner (user 1) → passes auth+sub+credit+rate+validation+intent → FAILS at context (wrong column names in odds query)
