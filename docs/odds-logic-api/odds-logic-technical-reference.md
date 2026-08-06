# OddsLogic API Ecosystem — Integration-Grade Technical Reference

**Status: `INCOMPLETE`** (preserved from the source report; see §25 for why no other verdict is defensible)
**Reverification date:** 2026-07-26 · **Supersedes:** `odds-logic-api.md` (source report, self-declared INCOMPLETE, retrievals dated 2026-07-27)
**Machine-readable appendices:** [`appendix/`](appendix/) — claim ledger, capability inventory, enumerations, entities, market taxonomy, odds formulas + validated test vectors, grading states, verification observations, observed HDF bootstrap format, unknowns checklist, sources.

Every material statement carries one of: `VERIFIED_OFFICIAL`, `VERIFIED_OBSERVED`, `PARTIALLY_VERIFIED`, `SECONDARY_ONLY`, `INFERRED`, `CONTRADICTED`, `INACCESSIBLE`, `UNKNOWN`.

---

## 1. Executive findings

1. **The source report's core conclusion stands.** OddsLogic commercially advertises a managed sports-odds API but publishes **no public technical contract** — no endpoints, schemas, auth model, transport, rate limits, or license terms. All 35 material claims in the source report were re-verified on 2026-07-26; none was overturned, several were extended, and two were resolved (`appendix/claim-ledger.json`). `VERIFIED_OBSERVED`
2. **The negative evidence got stronger.** `docs.oddslogic.com` and `api.oddslogic.com` do not resolve (DNS ENOTFOUND), and fresh searches surface zero OddsLogic developer materials — only unrelated vendors. `VERIFIED_OBSERVED` — but absence from public search is not proof private customer docs don't exist.
3. **New primary evidence closed real gaps.** A user-authorized capture of the app's page source revealed `window.__HDF_TEXT__`, a proprietary brace-delimited **schedule bootstrap payload** proving: stable 7-digit numeric event IDs, rotation numbers, UTC start instants with a Pacific-Time snapshot header, neutral-site venue fields, listed-pitcher fields (with an `UNDECIDED` sentinel), write-in / Grand Salami / series-price constructs, and observed coverage across 14+ leagues (CFL, NFL, CFB, WNBA, MLB, NHL, AFL, BIG3, TBT, FIBA, NPB, LMB, MiLB AAA). It also exposed the commercial stack: Tapfiliate affiliate tracking with Stripe integration. `VERIFIED_OBSERVED` — full analysis in `appendix/observed-hdf-bootstrap-format.json`. Crucially, the capture contains **no odds prices, no book list, and no live-update channel**, so the API contract gap remains open.
4. **New commercial facts the source report missed:** $99/month Early Release pricing with 7-day trial and 30-day money-back guarantee; planned $399/month real-time and $99/month delayed tiers; FAQ future features (team+player props, arb alerts, +EV alerts); official WagerTalk partner page resolving the `ref=` parameter as partner attribution; named leadership (Rick Allec, Mark Simons, Chris Rasmussen, Zach Allec; CTO James Piet `SECONDARY_ONLY`). `VERIFIED_OFFICIAL` except as noted.
5. **Five contradictions are registered** (§21), the sharpest being sportsbook-count claims (50+ vs 35+ vs 38 vs 50) and player-props status (API page: current; FAQ: future; competitor: limited).
6. **Verdict: `INCOMPLETE`.** Everything needed to integrate — endpoints, auth, schemas, update mechanics, settlement semantics, usage rights — is obtainable only from OddsLogic directly (`support@oddslogic.com`). §22 lists the exact artifacts to request.

## 2. Scope, methodology, environment, access limitations

- **Inputs:** the source report (decomposed claim-by-claim), live re-fetches of every cited official URL, new official-page discovery (`/wagertalk/`), candidate-host DNS checks, targeted web searches, secondary sources (founder interview, competitor comparison, partner site), and one user-authorized browser capture of the app page source.
- **Method:** read-only public HTTP GETs and searches only. No authentication attempted, no access controls bypassed, no automated probing, no reverse-engineering of protected algorithms. Odds mathematics validated by executable script with assertions (all passing).
- **Limitations:** no OddsLogic credentials were available; live app network traffic was not inspected (`INACCESSIBLE`). All app-payload conclusions come from the single authorized bootstrap capture and are point-in-time.

## 3. Source decomposition and claim ledger

`appendix/claim-ledger.json` reconciles **every** material claim from `odds-logic-api.md`: 35 source claims (C01–C35) plus 8 new claims (N01–N08) and 5 contradictions (X01–X05). Dispositions: 24 CONFIRMED, 4 CONFIRMED_UPDATED, 5 EXTENDED, 1 RESOLVED (ref-parameter semantics), 1 CONTRADICTED-confirmed (marketing vs. public docs). **No source claim was dropped; none was overturned.** Notable updates:

- C02: the app shell is not "sparse" — it partially renders odds behind an "UNLOCKING ODDSLOGIC" overlay (both observations are point-in-time renders).
- C05 → RESOLVED: `ref` is partner/referral attribution (`ref=wagertalk` on the official partner page; Tapfiliate+Stripe stack in the app head).
- C26 → partially closed: internal event IDs demonstrably exist (O15); API exposure still unknown.

## 4. Evidence hierarchy

As mandated: official docs/contract (1) > direct authorized observation (2) > official product/support/policy pages (3) > official samples/SDKs (4) > reputable secondary (5) > community/competitor (6) > inference (7). **Nothing in class 1 or 4 exists publicly for OddsLogic.** The bootstrap capture (class 2) and official pages (class 3) are the ceiling of available evidence; classes 5–6 supplied leads only.

## 5. Verified surface architecture

Four surface families, all HTTPS `VERIFIED_OFFICIAL`/`VERIFIED_OBSERVED` (inventory: `appendix/capability-inventory.json`):

| Surface | Host/path | Nature |
|---|---|---|
| Marketing/support/policy | `www.oddslogic.com/*` | Static, Morphic-built (footer "Powered by Morphic") |
| Partner landings | `www.oddslogic.com/wagertalk/` (family of one observed) | Promo codes + `ref=`-tagged app links |
| Odds-screen app | `odds.oddslogic.com/OddsLogic/` | Client-rendered app; server-embedded `__HDF_TEXT__` bootstrap; subscription-gated with partial unauthenticated render; Tapfiliate/Stripe commercial stack |
| FreeOdds | `freeodds.oddslogic.com/` + `/ol-lite-stage/` | Partner-branded lite surface ("Loading WagerTalk FreeOdds"); `-stage` suffix suggests staging (`INFERRED`) |

Non-existent: `docs.` and `api.` subdomains (DNS negative). Environments (sandbox/test/versioned), CDN, and observability stack: `UNKNOWN`. WagerTalk claims one login across WagerTalk/FreeOdds/OddsLogic (`SECONDARY_ONLY`) — implies shared identity infrastructure.

## 6. Canonical endpoint / capability inventory

**No private API route is listed anywhere in this reference, because none is publicly evidenced — inventing paths is prohibited and none were invented.** The inventory (`appendix/capability-inventory.json`) therefore has three strata:

1. **12 observed public GET operations** (marketing, support, policy, partner, app shells) with the single observed query parameter `ref` (partner attribution).
2. **3 negative observations** (DNS misses, empty doc searches).
3. **11 claimed private capability families** — pre-match odds, in-play odds, player props, grading, history/archive, alerts, betting percentages, sharp plays, scores, planned features, account/entitlement — each `PARTIALLY_VERIFIED` (existence claimed officially; every technical property undisclosed, itemized per family).

## 7. Authentication and entitlement model

`VERIFIED_OFFICIAL`: subscription product, immediate access post-payment, recurring monthly/annual billing, cancel-anytime, 30-day money-back. `VERIFIED_OBSERVED`: Stripe payments, Tapfiliate affiliates, gated app with unlock overlay. `SECONDARY_ONLY`: shared login across the WagerTalk family. **`UNKNOWN`: everything about API credentialing** — key/token/session/IP-allowlist, scopes, per-seat vs server licensing, sandbox existence. The "lightning-fast API activation" claim is marketing; the actual onboarding artifact is gap G02.

## 8. Transport and update model

`UNKNOWN`, with one new structural datum: the app boots from a **server-embedded snapshot** (`__HDF_TEXT__`), which means live updates necessarily arrive over a separate channel — but whether that channel is WebSocket, SSE, or polling was not observed, and the B2B API may differ entirely. "Real-time", "fastest updates", "99.999%" are `VERIFIED_OFFICIAL` marketing claims with no protocol, ordering, sequencing, replay, heartbeat, or SLA disclosure. Snapshot-vs-delta semantics: `UNKNOWN` (questions itemized in G03).

## 9. Resource and identifier model

`appendix/entity-relationships.json` holds the full model with per-entity evidence. Verified existence: sport, league, event, segment, market (by type), sportsbook, line-history, alert, sharp-play signal, ticket/money percentages. Newly `VERIFIED_OBSERVED` identifiers (app surface only): 7-digit event IDs, rotation numbers, numeric sport ids (1–4) and league/board ids (mapping table in `appendix/enumerations.json`). Still `UNKNOWN`: book/player/team/market IDs, external crosswalks, ID stability guarantees, correction/tombstone behavior. The ER diagram from the source report is preserved **as a recommended consumer model, explicitly not the vendor schema**.

## 10. Coverage

`VERIFIED_OFFICIAL` claims: 50+ sportsbooks (home), 35+ API data providers, 200+ leagues, 100+ markets, sports list (football, baseball, basketball, hockey, fighting, golf, tennis, auto, global soccer). `VERIFIED_OBSERVED` (bootstrap capture): CFL, NFL (incl. Melbourne international), CFB (incl. Dublin/Rio internationals), WNBA (incl. 2026 expansion teams), MLB (+series prices, Grand Salami, write-ins), NHL, AFL, BIG3, TBT, FIBA (men's + Women's World Cup), NPB, Mexico LMB, MiLB AAA. Book-count contradiction X01 unresolved; the authoritative per-tier book list is gap G11.

## 11. Market and outcome taxonomy

`appendix/market-taxonomy.json`. Officially named: Spread, Total, Moneyline, Team Total, 3-Way over Full Game/Halves/Quarters/Periods/Innings; props per §10. Observed extras: Grand Salami (league-wide totals as pseudo-events), MLB series prices, write-in slots. `UNKNOWN`/disputed: alternate lines (competitor says none), DNB, Asian/quarter lines, futures, exotics. The taxonomy defines **deterministic normalization keys** with collision guards for doubleheaders (game_number), reschedules (tombstone+relink), sign conventions (home-relative spreads), alternate-line identity (line value in key), listed-pitcher context, and DST (venue-timezone date rule — consistent with this repo's kickoff-datetime convention).

## 12. Odds-mathematics specification

`appendix/odds-formulas-test-vectors.json` — **generated by an executable script whose assertion suite passes**; every number is machine-computed, none hand-derived. Covers: American/decimal/fractional/HK/Indonesian/Malay conversions; implied probability; 2-way/3-way/multi-outcome overround and hold; no-vig by proportional, additive, power, and Shin methods (Shin solved by bisection on z; power on k); fair price; EV; break-even; arbitrage detection (+105/+105 → 2.44% margin; −105/+100 → none); CLV vs. no-vig close; full and fractional Kelly. Edge cases validated: invalid odds rejection (0, ±50, decimal ≤ 1), additive-method negative probabilities on a high-vig futures field (must clamp or reject), push semantics on integer lines. **Attribution rule enforced: OddsLogic defines none of these formulas — every one is labeled `RECOMMENDED_DOWNSTREAM`.** OddsLogic's own ticket/money-percentage and sharp-play computations remain proprietary (`UNKNOWN`).

## 13. Line movement and historical data

`VERIFIED_OFFICIAL`: per-event-per-book full line-movement history; "Yesterday" and Archive to any past date. `UNKNOWN`: retention depth, snapshot granularity, timestamp precision, revision vs overwrite on corrections, API access path (gaps G06, G17 — G17 partially advanced by the observed UTC convention on the app surface).

## 14. Alerts and sharp-play analytics

Alert classes `VERIFIED_OFFICIAL`: breaking injuries, pitching changes, halftime, finals, misc event info; customizable by type and league; visual/audio in-product. Sharp Plays `VERIFIED_OFFICIAL`: near-simultaneous cross-book move detection with user-configurable line constraints, timing parameters, leagues, books; beta. Everything deeper — algorithm, thresholds, originating-book attribution, magnitude, confidence, explainability, API/webhook delivery — is proprietary or undisclosed (`UNKNOWN`, gaps G13/G14/G16). Reverse line movement and steam-move semantics are **consumer-side concepts** here; OddsLogic does not document them.

## 15. Scores, grading, settlement, correction

Grading feeds exist (`VERIFIED_OFFICIAL` as a phrase; nothing more). `appendix/grading-states.json` supplies a **recommended consumer vocabulary** (pending/won/lost/push/void/half_won/half_lost/dead_heat_reduced/regraded) with explicit warnings that void/no-action/listed-pitcher/dead-heat rules are book- and provider-specific and must never be assumed universal. Nine deterministic edge fixtures are defined (doubleheaders, postponements, pitcher changes, OT semantics, soccer ET/pens, stat-correction regrades, DST, out-of-order updates, invalid odds) — the bootstrap capture confirms OddsLogic itself models listed pitchers and doubleheader-capable boards, but its settlement semantics remain `UNKNOWN` (gap G07).

## 16. Errors, rate limits, reliability, recovery

`UNKNOWN` in full. Observed: one trailing-slash redirect; no-cache headers on the app shell; 99.999% marketing uptime with no SLA (G08, G09). Consumer design must assume: no idempotency guarantees, no documented retry guidance, and no replay facility until proven otherwise.

## 17–18. Normalized consumer model and ingestion architecture

The source report's recommendations are confirmed and extended (`INFERRED`, engineering): immutable raw landing store (store `__HDF_TEXT__`-class payloads verbatim); normalized snapshot store keyed by §11 keys; append-only quote and grade ledgers ordered by (source_timestamp, ingest_sequence), never arrival order; schema-observation versioning with drift alarms; entity crosswalk owned by the consumer (pattern: this repo's FBS team crosswalk); settlement as reconciliation, not terminal event; quarantine for invalid odds; per-league timezone date rules. The report's mermaid ingestion diagram remains valid; nothing observed contradicts it.

## 19. Production use-case matrix

| Use case | Verdict | Blocking gaps |
|---|---|---|
| Multi-book odds comparison / line shopping | **CONDITIONAL** — capability verified, contract absent | G01–G05, G11 |
| Live odds screen (B2C via OddsLogic's own app) | **READY as a subscription product** ($99/mo) — not an integration | — |
| Live data integration (B2B) | **BLOCKED on vendor packet** | G01–G04, G08 |
| Historical backtesting / CLV measurement | **CONDITIONAL** — history exists; depth/granularity unknown | G06, G17 |
| Model feature generation | **CONDITIONAL** | G04–G06 |
| Sharp-move alerting | **CONDITIONAL** — in-product only until API delivery proven | G14, G16 |
| Player-prop analytics | **CONDITIONAL + disputed** (X02) | G12 |
| Settlement/reconciliation | **BLOCKED** — no settlement semantics | G07 |
| Customer-facing redistribution | **BLOCKED** — no license terms | G10 |
| Automated pricing/trading | **BLOCKED** — no latency/ordering/limits data | G03, G08, G09 |

## 20. Security, privacy, licensing, redistribution

Public policy surface covers B2C subscription/refunds only. **No API license, redistribution, attribution, or field-of-use terms are public** (G10) — treat all data as proprietary and non-redistributable until a contract says otherwise. Third-party processors observed: Stripe (payments), Tapfiliate (affiliates). No credentials, tokens, or customer data were captured or exposed in this investigation; the bootstrap capture contains only public schedule data. For this repo specifically: any OddsLogic-derived data shown on Dime AI surfaces would require explicit redistribution rights first.

## 21. Contradiction register

Full detail in `appendix/claim-ledger.json` → `contradictions`. X01 book counts (50+/35+/38/50 — plausibly different denominators, never reconciled by vendor). X02 props current-vs-future (likely stale FAQ; treat prop depth as unverified). X03 real-time tier price ($399 official vs ~$500 interview). X04 offshore/PPH coverage (secondary sources conflict). X05 "clearly documented" marketing vs zero public documentation (confirmed; docs presumably private post-sales).

## 22. Unknowns and evidence-acquisition checklist

`appendix/unknowns-evidence-checklist.json`: 20 gaps (G01–G20), each with the exact closing artifact. **Single next action:** email `support@oddslogic.com` requesting the API documentation packet, sample payloads for one full game lifecycle (pre-match → in-play → grading → correction), the per-tier sportsbook list, license terms, and trial API credentials. G05/G17 are partially advanced by O15 but not closed.

## 23. Source register

`appendix/sources.json` — 19 sources with authority ratings; S11 (the authorized app-source capture) is the highest-authority technical source (class 2); no class-1 or class-4 source exists publicly.

## 24. Coverage ledger

Verified: all official surfaces (now including the partner page), commercial API existence, pricing, feature/enum vocabulary, app bootstrap format, internal event/league IDs, Tapfiliate/Stripe stack, coverage breadth. Partially verified: every claimed data-family. Unresolved: the entire machine contract (endpoints, auth, schemas beyond the bootstrap, transports, errors, limits, settlement, licensing). No claim from the source report is unaccounted for.

## 25. Integration-readiness verdict

# `INCOMPLETE`

`INTEGRATION_READY` and `CONDITIONALLY_INTEGRATION_READY` are prohibited: the API contract, authentication, schemas, update mechanics, error behavior, rate limits, settlement semantics, and usage rights are all unverified. `BLOCKED` would overstate the situation — a clear, legitimate acquisition path exists (vendor packet via support@oddslogic.com, 7-day trial for authorized in-app observation), and this cycle demonstrably closed gaps. The truthful status is **INCOMPLETE with a defined path to completion**.
