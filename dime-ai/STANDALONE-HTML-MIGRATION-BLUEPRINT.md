# Dime AI Standalone HTML — Migration Blueprint

> Evidence-based audit + migration plan for `Dime_AI_Standalone.html` → this platform
> (React + Vite client on a **standalone frontend host**, Express + tRPC backend on **Railway**).
> Produced by a multi-agent audit (design-system auditor · repo cartographer · rendering
> verifier) with every load-bearing claim reproduced by command. Read-only: the artifact
> was not modified. A separate implementation session can execute this plan without
> re-auditing the artifact.
>
> **Artifact:** `Dime_AI_Standalone.html` · 1,911,608 bytes ·
> sha256 `5dca1193664cff40b49c3a2cae4714da6e106b9cf0362325b7f851271e917c1d`
> **Date:** 2026-07-10 · **Target repo state:** branch `claude/dime-ai-html-migration-audit-ao6q81`
>
> **v2 — owner decisions applied (2026-07-10):** D1 **mint theme ships sitewide, non-negotiable,
> per the HTML prototype** · D2 credit pricing IS being implemented · D3 Betting Splits stay
> VSiN-sourced · D7 no NBA props for now · D8 credit **top-up packs ARE being implemented**.
> This blueprint is a **write-only audit**: it maps and investigates; **nothing in it has been
> executed** (no issues opened, no code changed). See §17 for the credits/packs/VSiN deep audit.

---

## 1. Executive Migration Verdict

The file is **not an application — it is a self-unpacking design prototype** (a "dc-runtime"
artifact). Its value to production is: (a) the **visual & interaction intent** of five
surfaces (chat home, conversation with analysis cards, betting splits, profile, credit
chrome), (b) a **three-theme token vocabulary** (dark/light/mint) that must be *corrected*
against `design-system/dime-ai/MASTER.md` before adoption, and (c) a **feature checklist**
(credits UI, chat persistence, structured cards, profile consolidation) that the platform
already half-implements server-side.

**Nothing executable migrates.** 100% of the runtime (bundler, Babel-standalone, blob-URL
loading, dc-runtime, device simulator) is REMOVE. The product surfaces are REBUILD against
existing repo components; the sample data is EXTRACT (fixtures only); credits/membership
logic is REBUILD server-authoritative (the `dime_credit_ledger` already exists).

**Migration readiness: 8/10.** The repo already ships real SSE chat, splits data with
tests, Stripe billing, a credit ledger, and the exact five-tab mobile nav. The blockers are
product decisions (§13), not unknowns.

---

## 2. File & Bundle Anatomy (Phase 1)

Outer document: 204 lines; lines 194/198/202 are three JSON payloads.

| Layer | Evidence | Disposition |
|---|---|---|
| A. Bundler shell — loading pill, SVG thumbnail (dime wordmark on `#0B0B0F`), noscript notice, error sink | lines 1–191 | REMOVE |
| B. Unpacker script — decodes base64 manifest, gunzips via `DecompressionStream`, makes **blob URLs** (fonts → `data:` URLs), string-replaces 35 UUIDs into the template, strips SRI/crossorigin, `DOMParser` + **`document.documentElement.replaceWith()`**, re-creates every `<script>` to force execution, manually triggers `Babel.transformScriptTags()` | lines 33–189 | REMOVE |
| C. Manifest — 35 assets, 1,748,016 B encoded / **3,946,303 B decoded** | line 194 | EXTRACT selectively (§3) |
| D. Template — 149,909-char JSON string containing the real app document | line 202 | source of truth for REBUILD |
| E. External-resource map — 15 ids incl. `react@18.3.1`, `react-dom@18.3.1`, `@babel/standalone@7.29.0` UMDs rewritten to blobs | line 198 | REMOVE |

**Runtime sequence:** DOMContentLoaded → decode/gunzip 35 assets → blob/data URLs →
UUID→URL substitution in template → inject `window.__resources` map → parse template →
**replace the entire live document** → re-create scripts in order (fetch-shim → navIcons →
dc-runtime) → dc-runtime loads React/ReactDOM UMDs → parses `<x-dc>` template + the
`data-dc-script` logic class → renders. Object URLs are **never revoked** (memory retained
by design so the swapped document keeps working); failed decodes degrade to empty blobs.

**Inside the template:** an `<x-dc>` view (1,028 lines, `sc-if`/`sc-for`/`{{ }}` bindings,
all inline styles) + one `data-dc-script` logic class (774 lines) + reviewer prop schema
(`initialTheme: dark|light|mint`, `creditScenario: live|low|critical|zero|unlimited|loading|error`,
`startWithConversation`). A fetch/XHR monkey-patch shim maps `ios-frame.jsx`/`nav-icons.js`
to blobs. The dc-runtime is generated code (`// GENERATED from dc-runtime/src/*.ts`).

---

## 3. Embedded Asset Ledger (Phase 2)

35 assets, no duplicates (verified by sha256). Encoded 1,748,016 B → decoded 3,946,303 B.

| Asset | Type / size (dec) | Verdict | Action |
|---|---|---|---|
| Babel standalone 7.29.0 | JS 3,137,752 B (79% of payload) | prototype infra | REMOVE |
| ReactDOM 18.3.1 / React 18.3.1 UMD | 131,835 / 10,751 B | infra | REMOVE (repo has React 19 toolchain) |
| dc-runtime (`bdb093e9`) | JS 62,106 B, generated | infra | REMOVE |
| iosFrame.jsx | 21,081 B — iOS/iPad/Android status bars, Dynamic Island/notch/punch-hole frames, fake keyboard; self-labeled `@ds-adherence-ignore` scaffold | reviewer chrome | REMOVE |
| navIcons.js | 2,219 B — `<dime-nav-icon>` custom element: feed/splits/chat/props/profile stroke glyphs (22×22, stroke 1.7) + `<dime-logo>` | icon shapes only | EXTRACT shapes as reference; repo's lucide set (Newspaper/BarChart3/MessageSquare/FlaskConical/User) is semantically 5/5 — keep lucide, optionally restyle to 1.7 stroke |
| 8 team logos (mlbAtl/Bos/Nyy/Pit, nbaBos/Den/Ny/Okc; 500×500 PNG, 8.6–98 KB) | sample-data imagery, third-party team IP | REMOVE — repo already has `TeamLogo.tsx` + registries + ESPN CDN ids; do not ship bundled league logos |
| flagAr / flagFr (160px PNGs) | WC sample data | REMOVE (WC2026 pipeline has team data) |
| `49fbba8b.jpg` 400×400 — "Prez Bets" profile photo (= prezcirca.jpg) | personal reference material | REMOVE from any bundle; repo already has `client/src/pages/dime-chat/assets/prez-avatar.jpg`. Per repo law: never redistribute |
| Familjen Grotesk woff2 ×3 (latin/latin-ext/vietnamese) | **genuine variable font, fvar wght 400–700** (verified via fontTools), declared at 400/500/600/700 per subset | no synthetic weights | REMOVE files — repo loads the same family from Google Fonts (`client/index.html:15`) |
| IBM Plex Mono woff2 ×15 | genuine statics: **400/500/600** × latin/latin-ext/vietnamese/+2 subsets (usWeightClass verified) | REMOVE files; weight policy decided in §8 (MASTER caps mono at 400/500 — normalize specs, do NOT add 600) |

Layout shift: every `<img>` in the template carries `width`/`height` — good pattern, keep it.

---

## 4. Application Reconstruction (Phase 3)

Single monolithic class `Component extends DCLogic` — **27 state properties** in one bag:
theme(2) · navigation(1 `tab`: chat/profile/splits) · composer(3) · identity fade(2) ·
messages(2 incl. `genToken` race guard) · credits(2: `credits: 2480`, `scenario`) ·
6 sheet booleans · history(4: query/renamingId/renameDraft/confirmDeleteId) · convos(2) ·
profile(6: displayName/editDraft/saving/notifsOn/discordConnected/oddsFormat) ·
membershipCanceled · saved(2) · scroll/toast(3) · **device simulator(4: deviceCat/deviceId/viewH/viewW)**.

Timers: `fadeTimer`, `restoreTimer`, `toastTimer`, `streamTimer`. `componentWillUnmount`
removes only the matchMedia + resize listeners — **all four timers leak on unmount**
(dc-script.js:47–50). `Math.random()` message ids. No persistence of any kind: reload
resets credits, conversations, profile edits, membership state.

Simulated streaming: `send()` → 700 ms "thinking" → 2 words per 45 ms tick → 350 ms settle
→ attach card + followups → deduct 40 credits (client-side). Responses chosen by keyword
(`world cup|simulation` / `prop|edge` / `yankee|red sox` / fallback).

Component map (inferred; template is one file): Shell → {DesktopSidebar, MobileHeader
(+AvatarMenu), ChatHome (Identity, Composer, PromptPills), ConversationThread (UserBubble,
AIMessage → MatchCard | PropCards | Actions | FollowupChips), SplitsPage (TeamsPanel,
MarketBlock ×3 → SplitBar ×2, EdgeChips), ProfilePage (radiogroups, switch, rows),
HistoryDrawer, CreditsSheet, MembershipSheet, EditProfileSheet, LogoutConfirm, Toast,
BottomNav, DeviceFrame + ReviewerControls}. All REBUILD as typed React components mapped in §11.

---

## 5. Feature-State Matrix (Phase 4)

| Feature | Reality in artifact | Production requirement | Class |
|---|---|---|---|
| Chat send/streaming | locally simulated (timers, canned) | already real: `POST /api/dime/chat` SSE (`server/dime-chat.route.ts`), AbortController client | RETAIN repo core; REBUILD chrome |
| Stop / regenerate | works vs the fake stream (`genToken` guard) | wire to real abort + re-request; repo has stop, lacks regenerate | REFACTOR |
| Suggested prompts | 3 pills → `send(label)` | identical labels already in `DimeChatPage.tsx:58-68` | RETAIN |
| Follow-up chips | canned per response | needs model-driven followups in SSE meta | REBUILD (DEFER if API work exceeds wave) |
| Match-analysis card | hardcoded WC + MLB objects | extend `[EDGE]` block grammar (`dime-chat/edgeParser.ts`) → structured card; WC2026 data exists (`server/dime-wc2026.route.ts`) | REBUILD |
| Player-prop cards | hardcoded **NBA** trio (no NBA data exists in repo) | MLB props routers exist (`strikeoutProps`, `hrProps`) | REBUILD for MLB; **DEFER NBA** |
| Copy response | `navigator.clipboard.writeText` in try/catch, **toast fires regardless — false success** (async rejection uncaught) | await promise; toast on resolve only | REBUILD |
| Save analysis | client boolean + count 3 | no table/router exists | REBUILD server-side or DEFER |
| Credit pill + sheet + scenarios | client-authoritative: 2480, −40/analysis, `addCredits()` +1000, scenario chips | server-authoritative: `dime_credit_ledger` + `dime_user_entitlements` exist; only WC2026 route charges (1 cr); `/api/dime/chat` uncharged; no client UI at all | REBUILD (P1) |
| Membership view/cancel/resume | client boolean toggle | real: `stripe.cancelSubscription`/`reactivateSubscription` in `ManageAccount.tsx` | REFACTOR (merge into profile) |
| Upgrade → Elite | toast stub | plans exist (pro/sharp/operator, `server/stripe/products.ts`) + embedded `CheckoutPage.tsx` | REFACTOR |
| Edit display name | fake 600 ms save | no mutation exists (`appUsers` owner-only `updateUser` is admin) | REBUILD |
| Discord connect | boolean toggle + toast | real OAuth exists (`server/discordAuth.ts`, cols on `app_users`) | RETAIN repo |
| Notifications toggle | boolean, off-law 0.2s motion | no user pref field exists | DEFER |
| Odds format | state exists, **zero consumers — dead control** (all prices are strings) | `edgeUtils.ts:59` has converter; needs user pref + formatting layer | REBUILD or DEFER |
| Theme dark/light/mint | body[data-theme]; mint phone-only, force-reset to dark off-phone | repo dark-locked (`App.tsx:207`); MASTER defines dark+light | REBUILD all three — **D1 resolved: mint ships sitewide per prototype token block (:282–296); drop the phone-only gate/force-reset (dc-script.js:474,752,768); amend MASTER with a mint column** |
| History drawer search/rename/delete | in-memory only | no `dime_conversations` table (planned, DIME-FEED-MIGRATION-DRAFT Phase D) | REBUILD (needs `db-push.yml`) |
| Recent chats (6 canned titles) | click → canned convo | repo session-only `recentChats.ts`, inert rows | REBUILD on persistence |
| Betting splits page | fully hardcoded (ATL 10–5 PIT; 6 bars; 2 ROI chips) | real: VSiN scraper → `games` cols → `BettingSplitsPanel` (tested: `server/splitsBar.test.ts`) | RETAIN data path; REBUILD skin |
| Feed / Trends / Props nav | toast stubs / dead `#` links | Trends data precomputed (`mlbNightlyTrendsRefresh.ts`, no read proc); props = feed tabs | DEFER (E8) |
| Bet tracker nav | toast stub | real `/bet-tracker` + router | RETAIN repo |
| Logout confirm | alertdialog → toast | `Profile.tsx` logs out without confirm | REFACTOR (add confirm) |
| Device selector + frame | 18-device catalog, scale transform, fake breakpoints (`sideLayout`/`splitsLayout` branch on *selected device width*, not viewport) | real CSS breakpoints/container queries | REMOVE |
| Reviewer controls / scenario chips | preview-only | — | REMOVE (keep scenario states as Storybook/test fixtures) |

---

## 6. Data & Business-Logic Audit (Phase 5)

All displayed data is hardcoded in `dc-script.js` (`buildSeedConvos` L147–226, splits
L511–556). No fetch, no storage, no external requests (verified: fetch shim only remaps
two prototype files).

**Edge formula forensics** (edge ≈ fair implied % − book implied %), recomputed:

| Market | Book | Fair | Computed | Displayed | Verdict |
|---|---|---|---|---|---|
| Tatum Pts O27.5 | −112 | −138 | **+5.15** | +5.2% | consistent |
| ARG ML | +136 | +117 | +3.71 (or 3.63 vs 46% flat) | +3.6% | consistent |
| SGA Pts+Ast | −108 | −129 | **+4.41** | +4.1% | **inconsistent** |
| Brunson Ast O6.5 | −105 | −118 | **+2.91** | +2.6% | **inconsistent** |
| NYY/BOS O8.5 | −105 | −124 | **+4.14** | +4.3% | **inconsistent** |
| Pirates ML ROI | −110 book / −135 model | — | EV ≈ +9.7% | **+14.89% ROI** | not derivable |
| Pirates +1.5 ROI | −168 book / −189 model | — | EV ≈ +4.3% | **+9.05% ROI** | not derivable |

⇒ The artifact's numbers are illustrative strings, not formulas. **Do not extract any
math from the artifact.** Production edge/ROI math already exists and is law:
`client/src/lib/edgeUtils.ts`, `useEdgeCalculation.ts`, GameCard verdicts — restyle only,
never re-derive (per `DIME-FEED-MIGRATION-DRAFT.md` §contracts).

**Server-authoritative mandates:** credits (ledger exists — append-only with
`balance_after`), membership/plan (Stripe webhook is source of truth), model prices/edges
(model pipeline), saved analyses & conversations (new tables). The artifact's
client-side deduction, `addCredits()`, and membership toggles must not be ported.

---

## 7. Design-System Extraction (Phase 6) — verdict: EXTRACT-WITH-CORRECTIONS

Prototype defines 44 vars × 3 themes (template lines 252–296). Brand core matches law
(`#0B0B0F/#101016/#1A1A22/#45E0A8/#EDEDF2`; `#0FA36B` present; `#39FF14` absent ✓;
no gradients/purple ✓). Full token map + 35-item violations register preserved in the
audit transcript; the binding corrections:

**Hard violations (fix in the target tokens, not carried over):**
1. Light `--canvas`/`--work-bg` `#EDEDF2` → LAW `#FFFFFF` (`--color-background`).
2. Light single `--mint: #0FA36B` collapses fills+text → LAW: fills stay `#45E0A8`; only text uses `--mint-on-light #0FA36B`.
3. `#24242E`/`#D5D5DC` (LAW border colors) promoted to surfaces (`--surface2`, `--bubble`).
4. `--text3` used as running text: dark ≈4.05–4.13:1, light `#9A9AA8` on `#EDEDF2` = **2.38:1** (reproduced) — WCAG 1.4.3 FAIL. `--text-body #C9C9D4` tier missing entirely.
5. `--on-mint #FFFFFF` on `#0FA36B` = **3.24:1** at 13–14 px CTAs — FAIL (light CTAs should stay `#45E0A8` fill + `#0B0B0F` ink, 11.68:1).
6. **Typography inversion:** prototype sets values in IBM Plex Mono 500–700 and labels in Familjen — LAW is the opposite (mono = 10–11 px uppercase labels @0.08em; values = Familjen 700 15–20 px). Normalizing to LAW also removes the mono-600/700 dependency (fonts URL stays `400;500`).
7. Mint-filled decorative prompt pill (pp1-light/pp3-dark) — mint without signal; use neutral pill tiers.
8. Motion: five easing curves, 0.15–0.5 s, instant hovers → LAW: one curve `cubic-bezier(0.16,1,0.3,1)` @160 ms (landing-v2.css already complies).
9. Send-button caret/plus colors swapped vs MASTER composer spec in both themes.
10. 13 `data-comment-anchor` hex patches, 4 **critical**: mobile composer `#FFFFFF` bg with `color:#FFFFFF` textarea (typed text invisible in every theme, :650–652); splits "Model" label `color:#FFFFFF` (invisible on light, :705); mobile credit pill `#FFFFFF/#000000` (:397–400); history icon `stroke:#FFFFFF` (:388). Plus split-bar `border-color:#FFFFFF` (:719/:722) and emptied mobile-prompts block (:647–649).

**Wordmark:** prototype geometry off frozen spec (dot 0.281em/0.233em vs 0.20em; tracking
−0.0125/−0.0167em vs −0.05em; missing +0.03em x-offset; light dot `#0FA36B` vs law mint+hairline)
— and the repo's `BrandHero` (`DimeChatPage.tsx:302-314`) already implements the spec
**verbatim**. ⇒ Extract nothing; reuse the repo's wordmark as a shared component.

**NEW semantics worth adding to MASTER (with corrected values):** `--scrim`, `--track`,
`--on-mint`, splits namespace (`--sp-*` as component tokens), prompt-pill tiers, composer
`--send-*` set. (Decision D5.)

---

## 8. Responsive, Accessibility, Security, Performance (Phases 7–10)

**Responsive:** The artifact is **not responsive** — it renders inside a scaled fake device
frame; all "breakpoints" branch on the *selected device's* width in JS (`sideLayout`
w≥1900/1440; `splitsLayout` tiers row/tab3/tab2/stack at 800/700; phone paddings keyed to
360/375/393/412/420/430). The only real media query is `prefers-reduced-motion`. ⇒ REMOVE
simulator; re-express the four splits tiers + sidebar scaling as CSS breakpoints/container
queries. Layout intent to preserve: desktop/tablet = left sidebar (240–280 px / 216–240 px);
mobile = bottom nav + 52 px-offset header; content clamp 680 px above 700 px; splits grid
`idW px + repeat(3,minmax(0,1fr)) + edgeW px` on desktop → 3/2/1 columns down the tiers.
Repo collision: `index.css` viewport `--scale` engine (`clamp(0.81,100vw/393,3.85)`) — the
ported shell must not fight it; scope or retire per-surface.

**Accessibility — strengths to keep:** composed `aria-label` sentences on match/prop/splits
cards; `role="img"` + full-sentence ARIA on split bars; `aria-expanded` disclosures;
radiogroup/radio + switch semantics on profile; `role="status"` toast; ≥44 px touch targets
on nav/menu rows; labeled form fields; `prefers-reduced-motion` honored.
**Defects to fix in rebuild (each with WCAG ref):** no focus trap/initial focus/Escape/
restoration on all 5 dialogs+menu (2.1.2, 2.4.3); no `aria-live` on streaming thread (4.1.3);
contrast failures per §7 (1.4.3, incl. mint-theme `--text3` 3.48:1); split-bar visual lies
vs its ARIA (97/3 renders ≈80/20 via `min-width:46px` — 1.4.1-adjacent data integrity);
text glyphs as icons (`✓ › ▴▾`); document has no `lang`/`<title>` of its own (template
head carries neither — the bundler's "Bundled Page" title is discarded); focus style 2 px
outline vs law 3 px ring. Acceptance tests in §12.

**Security:** No secrets/API keys found (grep swept). No network calls. Risks are
architectural: runtime `eval`-class execution (Babel-standalone), blob-URL script
execution, full-document replacement, `data:` font URLs, fetch/XHR monkey-patching —
all CSP-hostile (`script-src` would need `unsafe-eval` + `blob:`) and all REMOVE.
Client-authoritative credits/membership = trust violation → server-authoritative (§6).
Clipboard false-success = integrity bug (§5). Untrusted-data rendering: N/A (no external
data), but the rebuild must render model/user strings as text (React default) — never
`dangerouslySetInnerHTML`.

**Performance:** 1.9 MB HTML → 3.95 MB decoded in-memory; Babel alone is 3.14 MB (79%) +
JSX transform + full document re-parse on the main thread; object URLs never revoked.
Product-code weight is trivial (~160 KB template+logic). Target treatment: normal Vite
code-splitting (chat/splits/profile lazy routes already lazy in `App.tsx`), Google Fonts
with `display=swap` (already), ESPN CDN logos (already), SSE streaming (already). Drop
legacy Inter/JetBrains font load (`client/index.html:20`). No artifact-bundler concept
survives.

---

## 9. Mandatory Issue Verification (reproduced evidence)

| Issue | Verdict | Evidence |
|---|---|---|
| Browser-side bundle unpacking | **Confirmed** | lines 33–189 unpacker |
| Base64 embedded assets | **Confirmed** | 35-entry manifest, line 194 |
| Blob URL runtime loading | **Confirmed** | `URL.createObjectURL` L112; fonts as `data:` L108 |
| Full-document replacement | **Confirmed** | `documentElement.replaceWith` L161 |
| Browser-side Babel | **Confirmed** | 3,137,752 B standalone + `transformScriptTags()` L183 |
| Monolithic React architecture | **Confirmed** | one class, 27 state props |
| Excessive inline styling | **Confirmed** | ~100% of 1,028 template lines |
| Repeated style literals | **Confirmed** | wordmark ×2 divergent; sheet shells ×4; pill styles ×2 |
| Hardcoded sample data | **Confirmed** | dc-script.js:147–226, 511–556 |
| Dead controls | **Confirmed** | Feed/Trends/Props/attach/upgrade/photo → toasts; odds format has zero consumers |
| Simulated device responsiveness | **Confirmed** | devices() catalog, frameScale, width-branch layout fns |
| Client-authoritative credit state | **Confirmed** | `credits: 2480`, `−40`, `addCredits()` |
| Client-authoritative membership | **Confirmed** | `membershipCanceled` toggle |
| Synthetic Familjen weights | **Not confirmed** | genuine variable font, fvar wght 400–700 (fontTools) |
| Wordmark mismatch | **Confirmed** | §7 geometry table |
| Light-theme hardcoded white text | **Confirmed** | :652 textarea, :705 label, :388 icon |
| Tablet content clamping | **Partially confirmed** | homeMax 520–660 px + contentMax 680 px are deliberate; risk only vs 1032-wide tablets (xl tier present) |
| Split-bar proportional distortion | **Confirmed** | `min-width:46px` ×2 (reproduced); 97/3 → ≈80/20 |
| ROI/edge inconsistency | **Confirmed** | §6 recomputation (SGA/Brunson/MLB/ROIs) |
| Incomplete Mint support | **Confirmed** | phone-only; force-reset dark (dc-script.js:768); unsanctioned by MASTER |
| Insufficient contrast | **Confirmed** | 2.38 / 3.24 / 4.05–4.41 / 3.48 measured |
| Touch targets < 44×44 | **Partially confirmed** | nav/menus ≥44; response-action buttons 36 px, return-to-latest 38 px |
| Missing modal focus management | **Confirmed** | zero focus()/trap/Escape (grep) |
| Missing live-region behavior | **Partially confirmed** | toast has `role="status"`; streaming thread has none |
| Uncleaned timers | **Confirmed** | 4 timers vs unmount cleanup of 2 listeners only |
| Clipboard false-success | **Confirmed** | dc-script.js:444 |
| Missing document metadata | **Confirmed** | template `<head>` has charset+viewport only; no title/lang/description |

---

## 10. Repo File Map (verified)

| Prototype surface | Repo reality | Verdict |
|---|---|---|
| Chat shell `/chat` | `client/src/pages/dime-chat/DimeChatPage.tsx` (876 ln) + `chatReducer.ts` + `edgeParser.ts` + `frozen-tokens.css` + `conversation.css`; SSE `server/dime-chat.route.ts` (claude-fable-5) | EXISTS — repo chat is a port of `design/frozen/dime-ai-home-{dark,light}.html`, a *different design generation* than this prototype; nav labels + prompt-pill labels + send glyph = exact match; credits chrome absent; desktop-gated (`ViewportGate` <1024) |
| Sidebar nav 6 rows | `DimeChatPage.tsx:45-52` — labels exact; proj→`/feed`, splits→`/betting-splits`, tracker→`/bet-tracker`, Trends/Props inert `#` | MATCH (superset of live targets) |
| Credits | server: `drizzle/dime.schema.ts` (`dime_credit_ledger`, `dime_user_entitlements`) charged only by `server/dime-wc2026.route.ts` (1 cr, atomic, 402 on empty); **zero client UI** | GAP P1 |
| Chat persistence | `recentChats.ts` session-only; no conversations table/router | GAP P1 (draft Phase D) |
| Splits | `client/src/pages/BettingSplits.tsx` (legacy skin) + `BettingSplitsPanel.tsx` (tickets/money bars, labels-inside enforced, tested) + `GameCard.tsx` edge/ROI verdicts (projections-mode only) + `OddsHistoryPanel.tsx` + VSiN scraper | EXISTS-DIVERGENT: model price columns intentionally hidden on this page; ROI chips not wired in splits mode; "Handle" vs "Money" label split; team-colored bars vs mint |
| Profile | `Profile.tsx` + `profile.css` + `ManageAccount.tsx` (cancel/reactivate/portal) + Discord OAuth | EXISTS split across 2 pages; missing: edit name, odds pref, theme picker, saved, notif toggle, logout confirm |
| Theme | `ThemeContext.tsx` dark-locked (`App.tsx:207 defaultTheme="dark"`), typed light|dark; **three mechanisms coexist**: `html.dark` (app) vs `.theme-*` div (chat) vs prototype's `body[data-theme]` | GAP P1 |
| Tokens | `frozen-tokens.css` (chat, MASTER-faithful) · `landing-v2.css` (= MASTER verbatim incl. wordmark + 160 ms) · `index.css` (Tailwind 4 + **purple oklch `--primary/--accent/--ring`** + viewport `--scale` engine) · **252× `#39FF14`** across 10+ components (reproduced) | landing/chat aligned; feed legacy = draft Phases B–C |
| Fonts | `client/index.html:15` Familjen 400–700 + Plex Mono **400;500** (+ legacy Inter/JetBrains at :20) | keep; normalize prototype mono-600/700 specs to law instead of adding weights |
| Mobile bottom nav | `features/mobileOwnerTabs/` — five tabs **exactly** feed/splits/chat/props/profile; owner-gated (`config.ts:11 MOBILE_OWNER_TABS_PUBLIC_ENABLED=false`); `MobileOwnerBottomTabs.tsx` hardcodes `#39FF14/#000000` ("PERMANENT" comment — violates both MASTER and prototype) | EXISTS-DIVERGENT |
| Cards/data | `games.list` feed contracts (inviolable, `design-system/dime-ai/pages/ai-model-projections.md`), MLB props routers, WC2026 schema+route; **no NBA prop data anywhere** | prototype's NBA trio not implementable |
| Deploy | `Dockerfile`+`railway.json` (backend), a standalone frontend-host config (client build + `/api/*` proxy to Railway), merge≠deploy until cutover (superseded: Railway auto-deploys `main`); schema via `db-push.yml` | ready |
| Bugs found incidentally | `BettingSplits.tsx:541` active tab links `/splits` → `App.tsx:137` redirects to `/feed` (self-navigating-away tab) | fix in Wave 2 |

---

## 11. Migration Ledger (condensed classifications)

| Item | Class | Target |
|---|---|---|
| Bundler/unpacker/Babel/React UMDs/dc-runtime/iosFrame/reviewer controls/device sim | REMOVE | — |
| Team logos, flags, profile JPEG, font files | REMOVE (repo equivalents exist) | — |
| navIcons glyph shapes | EXTRACT (reference) | keep lucide set |
| Token vocabulary (3 themes) | EXTRACT + correct per §7 | `client/src/styles/dime-tokens.css` (new shared layer feeding `.theme-*`) |
| Mint theme (token block :282–296) | EXTRACT + correct (D1: sitewide, first-class) | third `data-theme` value; `--text3` alpha 0.52→**≥0.62** (3.47:1→4.64:1, computed); rest of block passes (`--text2` 6.24:1, ink-on-mint 11.68:1, splits dark-island cards 16.84:1); wordmark white-dot+hairline already matches MASTER coin-dot rule |
| Wordmark markup | REMOVE (repo BrandHero is spec-correct) | shared `<DimeWordmark>` from repo code |
| Chat chrome (identity fade, composer states, followups, actions row) | REBUILD | `dime-chat/` components |
| Match card / prop cards | REBUILD (visual intent + ARIA sentences) | `dime-chat/cards/` on `[EDGE]`-grammar extension |
| Simulated streaming/canned data | EXTRACT as test fixtures only | `client/src/pages/dime-chat/__fixtures__/` + Storybook/scenario states |
| Credit pill/sheet/scenario states | REBUILD server-authoritative | tRPC `dimeCredits` router over ledger |
| History drawer (search/rename/delete, two-tap delete) | REBUILD on persistence | `dime_conversations` table + router |
| Profile page composition | REFACTOR (merge Profile+ManageAccount, add gaps) | `/profile` |
| Splits page layout (identity col, 3 markets, bars, edge chips) | REBUILD skin over existing data | `BettingSplits.tsx` restyle; bar widths `width:%` not flex-grow+min-width |
| Edge/ROI math | RETAIN repo (`edgeUtils`, GameCard) — artifact math untrusted | — |
| Odds-format setting | REBUILD or DEFER (D4) | user pref + `edgeUtils` formatter |
| Notifications toggle, saved analyses | DEFER | — |
| NBA prop cards | DEFER (no data) | — |
| Bottom nav | REFACTOR (flip public flag + retokenize) | `mobileOwnerTabs` |
| A11y patterns (card ARIA, radiogroups, switch, status toast, 44px rows) | RETAIN pattern | all rebuilt components |
| Focus traps, aria-live, contrast fixes, SVG icons | REBUILD (new) | shared `<Sheet>/<Dialog>` primitives |

---

## 12. Roadmap — waves mapped to the ZERO-TO-ONE epics

Inputs (from repo corpus, not assumption): priorities = launch rebrand (E1/E2 Now);
committed = E1–E8 + Railway/frontend-host cutover; constraints = solo operator, brand law closed,
feed contracts inviolable, RG language, merge≠deploy until cutover, schema via `db-push.yml`.
Horizon = cutover (E6). This prototype **slots into E2/E3/E5/E8 — it does not create a new track.**

**W0 — Evidence preservation (done by this audit).** Artifact hashed; assets + template +
logic extracted; fixtures frozen; this blueprint committed. Exit: blueprint on branch. ✅

**W1 — Foundation (maps E2 shell + draft Phase A/B).** Unified `DimeShell` (desktop/tablet
left sidebar, mobile header+bottom nav) at test route `/dime`; one theme mechanism
(`data-theme` on `<html>`, ThemeProvider switchable **dark/light/mint** — mint is first-class
sitewide per D1, typed `'dark'|'light'|'mint'`, prototype token block with the §11 contrast
correction, no device gating); chat `.theme-*` bridged; shared corrected token layer
(+ mint column added to MASTER.md); purple `--primary` fenced; legacy Inter/JetBrains dropped;
`<DimeWordmark>` shared (mint = white dot + black hairline). Exit: shell renders at `/dime`
in all THREE themes; typecheck green; zero regressions on existing routes (visual baselines).
Rollback: test-route only — delete route.

**W2 — Static visual parity (E3/E4 start, draft Phase C).** Chat chrome parity (placeholder
copy, stop glyph, followup chip shells, actions row); splits reskin on real VSiN data per the
§17-C field map (mint bars + mono-label law, `width:%` bars, Money label, `/splits` self-link
fix, Book+Model columns + model-favored highlight + ROI chips recomputed via `edgeUtils` —
prototype layout wins per D1/D3, values never from the artifact); profile consolidation shell;
mobile nav retokenized behind flag. Exit: side-by-side screenshot parity vs corrected spec at
390/768/1440 × **dark+light+mint**; `#39FF14` count in touched components = 0.

**W3 — Production data integration (E5 + credits + packs; D2/D8 confirmed).** Prereq:
**auth unification** — `/api/dime/chat` authenticates via legacy OAuth (`sdk.authenticateRequest`,
identity discarded) while the ledger keys on `app_users.id` via `app_session` JWT; the chat
route must adopt the wc2026 JWT pattern before it can charge (§17-A gap 3). Then: `dimeCredits`
tRPC router on `appUserProcedure` (balance, activity from ledger); charge `/api/dime/chat`
(price per D2a) — port the wc2026 transaction pattern **with its three defects fixed**
(abort-then-fallthrough double charge, virtual-first-row race, non-unique `request_id` index —
§17-A risks); pre-flight 402 before `flushHeaders()`, new SSE frame
`{type:"error", reason:"INSUFFICIENT_CREDITS"}` + `creditsCharged` on `done`; pill states
(live/low/critical/zero/unlimited/loading/error as real derivations); credit pill + sheet;
**top-up packs (D8)**: pack catalog (one-time prices), `mode:"payment"` embedded session
builder, webhook `session.mode` branch + idempotent ledger credit (+N under the same
`FOR UPDATE` pattern) + event-dedup store + `charge.refunded` clawback (§17-B — currently a
pack purchase would be misfulfilled as a 31-day "monthly" subscription); monthly plan-credit
grant mechanism (pricing page promises 1,000/3,000/8,000 — no schema/job exists);
membership surface wiring (upgrade→CheckoutPage, cancel/resume); edit-name mutation;
`dime_conversations` schema → **`db-push.yml` before code deploy**. Exit: credits decrement
server-side and survive reload; pack purchase credits exactly once under webhook replay;
Stripe flows pass `/stripe` review gates.

**W4 — Interaction parity (E3 completion).** Structured match/prop cards from `[EDGE]`
grammar v2 (MLB + WC2026); history drawer (search/rename/two-tap delete) on persistence;
copy (await clipboard), regenerate; saved analyses if D6=yes. Exit: E2E chat flow with
real stream + cards + history reload.

**W5 — Hardening.** Focus-trapped sheet/dialog primitives (Escape, restore, initial focus);
`aria-live="polite"` stream region; contrast fixes verified ≥4.5:1; reduced-motion; 200%
zoom; axe CI; perf budget (chat route JS < 250 KB gz); error/empty/loading states; RG
language check on all new surfaces. Exit: axe zero critical; keyboard-only walkthrough
passes; Vitest+typecheck green in CI.

**W6 — Cutover (E6, deploy law).** Flip `/dime` shell to primary routes; mobile nav public
flag on; parallel validation on Railway/frontend-host preview; smoke (`deploy-smoke.yml`);
release flag + rollback = flag revert (the legacy host remains prod until the platform cutover
completes; after cutover, push-to-main auto-deploys both platforms). Exit: production on
Dime shell; legacy accents gone from user paths.

---

## 13. Decision Register — owner rulings applied 2026-07-10

| # | Decision | Status |
|---|---|---|
| D1 | Mint theme | **RESOLVED: ships sitewide, non-negotiable, per the HTML prototype token block** (:282–296). Prototype's phone-only gate + force-reset-to-dark are dropped; mint is a first-class `data-theme` on all devices/surfaces. MASTER.md gains a mint column (values = prototype block + `--text3` alpha ≥0.62 contrast correction). Sub-item **D1a RESOLVED: "all mint needs to be our color mint"** — brand mint `#45E0A8` is THE mint everywhere, all surfaces including landing; no alternate greens. (`#0FA36B` survives only in its MASTER-defined role as the dark *text* rendering of mint on light surfaces for WCAG — it is not a second brand color; if the owner wants it gone entirely, mint text on light must be ≥18.66px/700) |
| D2 | Credit pricing | **RESOLVED: implementing.** Sub-item **D2a: deferred — credit system ships "soon"; price point set at build time** (prototype shows 40 cr/analysis; live wc2026 route charges 1; unify on ledger with per-route cost config) |
| D3 | Betting Splits source | **RESOLVED: VSiN** (already the live pipeline — 15-min cron, §17-C field map). Prototype layout (Book+Model columns, model-favored highlight, ROI chips) renders over VSiN splits + `games` model columns via `edgeUtils` recomputation |
| D4 | Odds-format preference | **RESOLVED: fix it — implement** the American/Decimal setting end-to-end (user pref + formatting layer over `edgeUtils.ts:59` converter; the prototype's toggle is dead, the repo has no pref). Ship in W3 |
| D5 | MASTER amendments | Required before W1: mint column + `--scrim/--track/--on-mint/--sp-*` etc. with corrected values |
| D6 | Saved analyses | Open — new table + router (W4) or DEFER to E8 |
| D7 | NBA props | **RESOLVED: none for now.** DEFER until an NBA pipeline exists (do not fake) |
| D8 | Credit top-up packs | **RESOLVED: implementing.** Requires the full §17-B gap set: one-time price catalog, `mode:"payment"` session builder, webhook mode branch + idempotent fulfillment + dedup store, refund clawback. **Do not ship pack prices before the webhook branch** (misfulfillment walk-through §17-B) |
| D9 | Charge policy on aborted streams | **Deferred by owner ("fix it when it happens")** — decide charge/no-charge/partial at Q7b build time; the defect stays documented in §17-A risk 1 and MUST NOT be ported silently |

---

## 14. Mapped Work Queue — **NOT EXECUTED** (write-only audit)

Issue-ready specifications, one worktree/PR each when the owner gives the go
(`/gh-fix <issue#>` after issues are opened). Nothing below has been started. Ordered by wave.

| # | Title | Files | Acceptance |
|---|---|---|---|
| Q1 (W1) | Unify theme mechanism + switchable **dark/light/mint** provider (D1: mint sitewide, typed `'dark'\|'light'\|'mint'`, no device gating) | `ThemeContext.tsx`, `App.tsx:207`, `index.html:2`, `dime-chat/frozen-tokens.css` (+ new `.theme-mint` block), `DimeChatPage.tsx:799` | one `data-theme` source; chat + shell follow it in all three themes; no visual regression dark |
| Q2 (W1) | Shared corrected Dime token layer (light canvas `#FFFFFF`, mint-fill/text split, text tiers incl. `--text-body`) + **mint theme block from prototype :282–296 with `--text3` alpha ≥0.62** | new `client/src/styles/dime-tokens.css`; MASTER.md amendment (D5: mint column) | tokens match amended MASTER; contrast script ≥4.5:1 across all three themes |
| Q3 (W1) | `DimeShell` at `/dime` test route (sidebar/tablet/mobile chrome, wordmark shared) | new `client/src/components/dime-shell/`; `App.tsx` route | shell renders 390/768/1440; existing routes untouched |
| Q4 (W1) | Fence purple shadcn vars + drop legacy Inter/JetBrains load | `index.css:125-156`, `client/index.html:20` | no oklch purple reachable under Dime surfaces; fonts request count −1 |
| Q5 (W2) | Betting Splits reskin per §10/§11/§17-C: prototype layout (Book+Model columns, model-favored highlight via `edgeUtils`, ROI chips) over VSiN data + `/splits` self-link fix + Money/Handle unification + proportional bars + replicate the 0%/0% guard for Total/ML (only spread is server-guarded) | `BettingSplits.tsx`, `BettingSplitsPanel.tsx`, `GameCard.tsx`, `edgeUtils.ts` (read-only reuse) | bars width:% (97/3 renders 97/3); tab stays on page; `#39FF14`=0 in files; 0/0 markets show "not yet available", never 100% bars |
| Q6 (W2) | Mobile bottom nav: retokenize `#39FF14/#000000` → tokens; prep public flag | `MobileOwnerBottomTabs.tsx`, `config.ts` | matches prototype semantics (mint active, canvas bg, no dot); flag still off |
| Q7 (W3) | Chat auth unification: `/api/dime/chat` adopts the `app_session` JWT pattern (identity captured) — prerequisite for any charge | `server/dime-chat.route.ts:92` (replace `sdk.authenticateRequest`), pattern from `dime-wc2026.route.ts:85-109` | chat rejects legacy-OAuth-only sessions consistently; user_id available to metering |
| Q7b (W3) | `dimeCredits` tRPC router (balance + activity on `appUserProcedure`) + charge `/api/dime/chat` per D2a + pre-flush 402 + `INSUFFICIENT_CREDITS` SSE frame + `creditsCharged` on done — fixing the three wc2026 defects (abort fallthrough double-charge per D9, virtual-first-row race via seed row on entitlement grant, unique index on `(request_id, reason)`) | `server/routers.ts`, `server/dime-chat.route.ts`, `drizzle/dime.schema.ts:66` | balance survives reload; concurrent first-request test; abort test charges per D9 policy; replayed request_id cannot double-insert |
| Q7c (W3) | Plan-credit grant mechanism: schema for monthly allotments (pricing page promises 1,000/3,000/8,000), grant job/webhook hook writing +N ledger rows, wire `dime_user_entitlements` (currently dead: no reader/writer) | `drizzle/dime.schema.ts`, `server/stripeWebhook.ts`, new cron or invoice.paid hook — **schema via `db-push.yml` first** | new subscriber receives plan credits exactly once per cycle; renewal grants on `invoice.paid` |
| Q8 (W3) | Credit pill + credits sheet (all 7 states server-derived) | `dime-chat/`, shell header | states driven by real balance; a11y labels per prototype |
| Q9 (W3) | Profile consolidation (merge ManageAccount, edit-name mutation, logout confirm, theme picker) | `Profile.tsx`, `ManageAccount.tsx`, `server/routers/appUsers.ts` | cancel/resume/upgrade live; name persists; confirm dialog focus-trapped |
| Q10 (W3) | `dime_conversations` schema + router (**db-push.yml first**) | `drizzle/dime.schema.ts`, new router | CRUD + list-by-user; RLS/user scoping tested |
| Q11 (W4) | Structured chat cards: `[EDGE]` grammar v2 → match + prop cards (MLB/WC2026) | `edgeParser.ts`, `dime-chat/cards/`, `server/dime-chat.route.ts` prompt | cards render from real stream; ARIA sentence per prototype pattern |
| Q12 (W4) | History drawer (search/rename/two-tap delete) + recents wiring | `dime-chat/`, `recentChats.ts` → router | reload restores; rename persists; delete confirmed in-row |
| Q13 (W4) | Response actions: copy (await clipboard), regenerate | `dime-chat/` | toast only on resolved copy; regenerate aborts + re-streams |
| Q14 (W5) | Focus-trapped `<DimeSheet>/<DimeDialog>` primitives + aria-live stream region | shared components | Escape/restore/initial-focus tests; SR announces stream completion |
| Q15 (W5) | axe + visual-regression CI gates for Dime surfaces | `.github/workflows/ci.yml`, Playwright | axe zero critical; baselines at 6 viewports × 2 themes |
| Q16 (W2, sweep) | `#39FF14` → mint across feed components (252 occurrences, batched per component per draft Phase C) | GameCard, OddsHistoryPanel, MlbPropsCard, BetTracker*, Mobile*, Calendar* | grep count trends to 0; edge math untouched |
| Q17 (W3, D8) | Credit-pack catalog: one-time products/prices (env-var price IDs, `pack_size` credits), extend `zodPlanId`-style validation with pack ids | `server/stripe/products.ts`, `server/routers/stripe.ts:40` | packs listed; subscriptions unaffected |
| Q18 (W3, D8) | Pack checkout: `mode:"payment"` embedded session builder (login required or `customer_creation:"always"`; `metadata:{pack_id,pack_size,user_id}`) + CheckoutPage pack path (Elements plumbing is mode-agnostic and reusable) | `server/routers/stripe.ts` (new builder — do NOT reuse subscription builders, `mode` is hardcoded at :144/:259), `client/src/pages/dime/CheckoutPage.tsx` | pack session creates; no `subscription_data` present; anonymous purchase impossible or fully fulfillable |
| Q19 (W3, D8) | Webhook pack fulfillment: branch on `session.mode === "payment"` **before** plan resolution (today a pack would default to plan "monthly" and grant 31-day access with zero credits); idempotent `+N` ledger insert under `FOR UPDATE` with event-dedup (unique key on event/session id); `charge.refunded` clawback (−N row, floor at spent) | `server/stripeWebhook.ts:208-293` (mode branch), `drizzle/dime.schema.ts` (dedup store — `db-push.yml` first) | replayed `checkout.session.completed` credits once; subscription path regression-tested; refund writes clawback row |
| Q20 (W2) | Splits freshness: add `splitsUpdatedAt` (or expose scrape timestamp) so the 15-min VSiN cadence is visible; surface "as of" on the splits page | `server/vsinAutoRefresh.ts`, `drizzle/schema.ts` (`db-push.yml` first), `BettingSplitsPanel.tsx` | stale (>30 min) splits visibly flagged |

---

## 15. Acceptance & Parity Test Matrix (per wave gates)

- **Visual:** Playwright baselines at 360×780, 390×844, 430×932, 768×1024, 1032×1376, 1366×768, 1440×900, 1920×1080 × **dark+light+mint** × chat-home/conversation/splits/profile/sheets.
- **Interaction:** send→stream→stop→regenerate; Enter vs Shift+Enter; followup chip → send; history search/rename/delete; pill → sheet; cancel/resume membership; theme switch persists.
- **Data:** credits decrement server-side (parallel-request race test incl. two concurrent FIRST requests); 402 → zero-state UI; abort-mid-stream charge behavior matches D9 policy; pack purchase credits exactly once under simulated Stripe event replay; refund writes clawback; subscription webhook path regression-green after the mode branch lands; splits %s sum to 100 and bar widths equal data; 0%/0% Total/ML markets render "not yet available"; edge/ROI values match `edgeUtils` output (never artifact numbers).
- **A11y:** keyboard-only full walkthrough; focus trap + Escape + restore on all dialogs; stream announced via live region; contrast script ≥4.5:1 on all text tokens; 200% zoom no clipping; reduced-motion disables all animation.
- **Deploy:** typecheck (`npx tsc --noEmit`), Vitest (CI secrets), `deploy-smoke.yml` green on Railway+frontend-host preview before flag flip; rollback = release-flag revert; schema rollbacks never required by UI waves (additive only).

---

## 16. Implementation prompt for the executing Claude Code session

> [This prompt is a deliverable for a FUTURE session. It has NOT been executed; the owner
> must explicitly start it.]
>
> Execute the Dime AI standalone-HTML migration per
> `dime-ai/STANDALONE-HTML-MIGRATION-BLUEPRINT.md` (this file — source of truth; do not
> re-audit the artifact). Resolved rulings are binding: mint theme sitewide per the
> prototype (D1), credit pricing on (D2), VSiN splits (D3), no NBA props (D7), top-up
> packs on (D8). Work wave by wave (W1→W6, §12), one `/gh-fix`-style issue/worktree/PR
> per queue item (§14), in queue order, respecting the still-open gates (D1a, D2a, D4,
> D6, D9 — stop and ask). Sequencing law from §17: webhook `session.mode` branch (Q19)
> lands BEFORE any pack price exists in Stripe; chat auth unification (Q7) lands before
> any chat charge (Q7b). Hard rules: strict TypeScript
> (`npx tsc --noEmit` green before every PR); Dime brand law
> (`design-system/dime-ai/MASTER.md` + pages overrides) beats the prototype wherever they
> conflict (§7 corrections are mandatory); never port the artifact's bundler, Babel,
> blob-URL loading, device simulator, dead controls, or any client-authoritative
> credit/membership logic; credits, membership, entitlements, conversations, and all
> model/edge numbers are server-authoritative (ledger + Stripe webhook + `edgeUtils` are
> the only sources — artifact numbers are known-inconsistent fixtures); feed data
> contracts (`design-system/dime-ai/pages/ai-model-projections.md`,
> `dime-ai/DIME-FEED-MIGRATION-DRAFT.md` §4) are inviolable; keep the SSE core of
> `/api/dime/chat` streaming-intact when reskinning; schema changes ship via the manual
> `db-push.yml` workflow before any dependent code deploy; keep responsible-gaming
> language (21+, 1-800-GAMBLER) on user surfaces; do not redesign, do not invent features
> beyond this blueprint, and require explicit approval before any production-facing or
> destructive operation (deploys, flag flips, schema pushes, Stripe product changes).
> Every PR: tests per §15 gate, screenshots for visual work, rollback note.

---

## 17. Deep Audit Addendum — Credits, Top-Up Packs, VSiN (triggered by D2/D3/D8)

Read-only investigation of the exact server paths the resolved decisions depend on.

### 17-A. Credit metering path

**Working reference — `server/dime-wc2026.route.ts`:** `CREDITS_PER_ANSWER=1` (:42);
auth = `app_session` JWT + tokenVersion vs DB (:85-109); entitlement check reads
**app_users** (`hasAccess`/`expiryDate`/owner-admin bypass), NOT `dime_user_entitlements`
(:112-121); balance = latest `dime_credit_ledger.balance_after` with **virtual default 100**
(COALESCE fallback, never seeded; :124-136); pre-flight 402 JSON with
`reason:"INSUFFICIENT_CREDITS"` + balance (:415-425); atomic deduction in a
`db.transaction` with `... FOR UPDATE` re-check, insert `delta_credits=-N, balance_after,
reason='DIME_WC2026_ANSWER'` (:154-184); charges **post-stream**, only when
`responseMode==="ANSWER"` (:685-698); audit rows in `dime_request_audit` (unique
`request_id`, dime.schema.ts:89) + `dime_response_audit.credits_charged`.

**Ledger schema (`drizzle/dime.schema.ts`):** `dime_credit_ledger` (:53-68) —
user_id/request_id/delta_credits/balance_after/reason; indexes `idx_credit_user`,
`idx_credit_request` **both non-unique** (:64-67). `dime_user_entitlements` (:161-177) —
unique user_id, status/tier/source/dates; **no quota/unlimited/allotment columns and zero
runtime readers or writers — the table is dead code today.**

**Chat route (`server/dime-chat.route.ts`):** zero credit code. Auth is
`sdk.authenticateRequest(req)` (:92) = **legacy OAuth** (`users` table by openId,
`server/_core/sdk.ts:319-339`) — a *different identity domain* than the ledger's
`app_users.id`, and the result is discarded (user never captured). Charge hook must sit
between auth and `res.flushHeaders()` (:139-142) for a plain 402; after flush, only SSE
frames exist (`{type: meta|delta|error|done}`, :151/:197/:211) — an
`INSUFFICIENT_CREDITS` frame type does not exist yet. No tRPC procedure anywhere reads the
ledger; the only balance ever surfaced is the wc2026 402 body. A new `dimeCredits` router
belongs on `appUserProcedure` (`server/routers/appUsers.ts:199-240`) — same identity
domain as the ledger.

**GAPS:** (1) no metering on chat; (2) no balance/activity API or UI; (3) chat↔ledger auth
mismatch; (4) `dime_user_entitlements` dead + pricing page promises 1,000/3,000/8,000
monthly credits (`CheckoutPage.tsx:71,94,109`) with **no schema or grant mechanism**;
(5) no monthly grant/reset job (default-100 is a SQL fallback in two places);
(6) no SSE credit frames.

**RISKS (must be fixed, not ported):**
1. **Abort double-charge:** on client disconnect the catch block no-ops without returning
   (:650-675) → falls through to the deduction (STEP 13) → full charge for an aborted
   answer; a client retry re-charges. Policy = open decision D9.
2. **Virtual-first-row race:** `FOR UPDATE` locks no row when the user has zero ledger
   rows — two concurrent first requests both read the virtual 100 and both write
   `balance_after=99` (forked history). Fix: seed a grant row on entitlement creation.
3. **Non-unique `idx_credit_request`** — DB permits duplicate ledger rows per request_id;
   the unique guard exists only on the *audit* table.
4. Check-then-act spans the whole Claude call — race loser gets a free answer (caught,
   returns −1) but model tokens were spent.

### 17-B. Stripe top-up packs — gap analysis (D8)

**Catalog (`server/stripe/products.ts`):** five subscription plans only (monthly $99.99 /
annual $499.99 with hardcoded live-price fallbacks :45/:58; pro $99 / sharp $249 /
operator $499 env-only). Every plan has an `interval`; `normalizePlanId` **defaults
unknown ids to "monthly"** (:111-114). No one-time products.

**Webhook (`server/stripeWebhook.ts:203-380`):** handles checkout.session.completed
(:208-293), subscription created/updated (:295-321), deleted (:323-331), invoice.paid
renewal (:333-353), invoice.payment_failed log-only (:355-361),
**payment_intent.succeeded/failed log-only** (:363-375). `checkout.session.completed`
**never reads `session.mode`.**

**Misfulfillment walk-through (why Q19 precedes any pack price):** a `mode:"payment"`
pack session today → `payment_status==="paid"` passes → pack price not in plan map →
plan **defaults to "monthly"** → `subscription:null` → `stripeSubscriptionId=""` → if
customer+`client_reference_id` exist, `grantUserAccess` sets `hasAccess=true`,
`expiryDate=now+31d`, `stripePlanId="monthly"` — **a one-time pack buys a month of
subscription access and grants zero credits**; if anonymous, it dead-ends at the
no-customer check (:242) or mints a pending *subscriber* account (:256-289). No webhook
path writes `dime_credit_ledger`.

**Idempotency:** endpoint 200s before async processing (:417-421); **no processed-events
store exists** (grep: none); `grantUserAccess` is replay-safe (overwrite) but a naive
ledger `+N` insert is not — Stripe retries would double-credit. **Refunds:** no
`charge.refunded`/dispute handling anywhere → no clawback path.

**Reusable:** `CheckoutPage.tsx` Payment-Element/Appearance plumbing (:155-341) is
mode-agnostic; both session builders are NOT (`mode:"subscription"` hardcoded,
`server/routers/stripe.ts:144/:259-260`; `zodPlanId` enum blocks pack ids, :40).

### 17-C. VSiN splits field map (D3)

**Scraper → DB:** `server/vsinBettingSplitsScraper.ts` extracts six away-side 0-100
percentages per game — spread bets/money (td[4]/td[3]), total-over bets/money
(td[7]/td[6]), ML-away bets/money (td[10]/td[9]); "Money"=handle%, "Tickets"=bets%.
Written by `server/vsinAutoRefresh.ts` (NBA :316-322, NHL :486-492, MLB :753-764) into
`games.{spreadAway,totalOver,mlAway}{Bets,Money}Pct` (schema.ts:216-226); MLB also mirrors
spread→`rlAway*Pct` (:349-351) — **columns no client code reads**. Home/under side is never
stored; always derived `100−x` at render (BettingSplitsPanel.tsx:325-327,541-543) so bars
sum to 100 by construction. Swapped team order flips via `100−x`
(vsinAutoRefresh.ts:722-733). **0%/0% unopened-market guard exists server-side for
spread/run-line only** (:196-199,:230-233,:742-752); Total/ML rely on the client `bothZero`
check — a new UI must replicate it or render a false 100% bar. Cadence: GitHub cron every
15 min (`cron-vsin-odds.yml:21`) → `POST /api/cron/vsin-odds` under run-lock; history
snapshots to `odds_history` (schema.ts:887-896).

**Prototype-unit sources:** Tickets/Money bars ← the six `games` columns (+`100−x`);
Book prices ← Action Network/MetaBet ingestion into the same `games` row (schema.ts:194-265,
340-347 — the scraper deliberately ignores VSiN's own price cells); Model prices ←
`games.model{Away,Home}ML/modelTotal/model*SpreadOdds/model{Over,Under}Odds`
(schema.ts:200,267-285,374-376); model-favored highlight ← client
`calculateEdge ≥ 1.5pp` (edgeUtils.ts:79-84,141); ROI chips ← `calculateRoi`/`formatRoi`
(edgeUtils.ts:191-205,236-240); freshness gate ← `modelRunAt` (schema.ts:293).
**No source exists for:** stored home/under splits, stored edge/ROI/verdict (all
client-computed), and any **splits timestamp** (`splitsUpdatedAt` missing → staleness
invisible; Q20).

**RISKS:** VSiN HTML-structure coupling (11-td contract) silently nulls splits on markup
change; unresolved team slugs drop games silently (SPLITS_HEALTH log is the only
detector); cron is best-effort UTC — lag has no user-facing signal.

---

*Verification record: all quantitative claims in this document were reproduced by command
(hash, asset counts/sizes, contrast ratios 2.38/3.24 and mint-correction threshold
alpha≥0.62→4.64:1, edge recomputations, `#39FF14`=252, font URL weights, `/splits`
redirect, theme lock) in the audit session on 2026-07-10. §17 claims carry inline
file:line citations gathered by a read-only investigation agent in the same session.
This document is the audit deliverable; no repo code was modified and no issues/PRs
were created.*
