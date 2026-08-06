# Dime AI Standalone HTML — Full Migration Report

**Artifact:** `Dime_AI_Standalone.html` · 1,911,608 bytes · sha256
`5dca1193664cff40b49c3a2cae4714da6e106b9cf0362325b7f851271e917c1d`
**Date:** 2026-07-10 · **Companion:** `dime-ai/STANDALONE-HTML-MIGRATION-BLUEPRINT.md`
(work queue + §17 deep audit). **Status: write-only audit — nothing executed.**

Owner rulings in force: **D1** mint theme sitewide per prototype · **D1a** brand mint
`#45E0A8` is THE mint everywhere · **D2** credit pricing implementing (D2a price point at
build time) · **D3** splits stay VSiN · **D4** odds-format setting will be fixed/implemented ·
**D7** no NBA props now · **D8** top-up packs implementing · **D9** abort-charge policy at
build time.

---

## 1. Executive Migration Verdict

The file is a **self-unpacking design prototype**, not an application. Of its 3.95 MB
decoded payload, 79% is Babel-standalone; the product content is a 774-line logic class +
1,028-line inline-styled template rendered by a prototype engine ("dc-runtime") inside a
fake device frame. **Zero executable code migrates.** What migrates is: the visual and
interaction *intent* of five surfaces (chat home, conversation with analysis cards,
betting splits, profile, credit chrome), a **three-theme token vocabulary**
(dark/light/**mint** — mint now first-class per D1) extracted **with corrections** against
`design-system/dime-ai/MASTER.md`, and a feature checklist the platform already
half-implements server-side (real SSE chat, credit ledger, VSiN splits, Stripe billing).
Credits/membership in the artifact are client-authoritative toys; production equivalents
must be (and partly already are) server-authoritative. Readiness **8/10** — remaining
unknowns are implementation-time choices, not discovery.

## 2. Scope and Evidence Standard

- Read-only audit. Artifact untouched; no repo code modified; no issues/PRs created.
- Every quantitative claim reproduced by command in-session (hashes, byte counts, contrast
  ratios, edge recomputations, grep counts, font table parses via fontTools).
- Multi-agent method: bundle forensics (lead session) → parallel design-system auditor +
  repo cartographer → rendering verifier → credits/Stripe/VSiN investigator. All agent
  claims carry file:line citations; conflicts were re-checked (e.g., the verifier could not
  find `nav-icons.js` — the lead session had already extracted it and confirmed contents).
- **Target-platform adaptation:** the original brief assumed Next.js App Router/Supabase.
  The actual repo is supplied and is the source of truth: **React 19 + Vite + wouter SPA
  (standalone frontend host) · Express + tRPC + Drizzle/MySQL (Railway) · Stripe · legacy prod until
  cutover (since completed)**. All "Server Component" guidance is translated to this stack: server-owned
  data via tRPC/Express routes; the SPA client renders. Where the two differ, this report
  says so explicitly rather than presenting assumptions as fact.

## 3. File and Bundle Anatomy

Outer HTML: 204 lines; three giant script payloads — `__bundler/manifest` (line 194,
1,751,181 chars JSON: 35 base64 assets), `__bundler/ext_resources` (line 198: 15
id→uuid mappings incl. React/ReactDOM/Babel unpkg URLs), `__bundler/template` (line 202:
149,909-char JSON string = the real app document). Shell provides: loading pill
("Unpacking…"), full-screen SVG thumbnail (dime wordmark on `#0B0B0F`), noscript notice,
window-level error sink that survives document replacement. Fonts are emitted as `data:`
URLs (host CSP allows `font-src data:` but not `blob:` — comment at line 107); everything
else becomes blob URLs retained in `window.__resourceBlobs` (never revoked, by design).
Failure mode: undecodable asset → empty blob + console error; missing
`DecompressionStream` → warning, asset unrendered.

## 4. Runtime Execution Sequence

1. `DOMContentLoaded` → parse manifest; per-asset: base64→bytes → optional gunzip →
   blob/data URL (lines 75–121).
2. Template string-replace: 35 UUIDs → URLs (line 135); strip `integrity`/`crossorigin`
   (line 140, file:// null-origin rationale in comments).
3. Inject `window.__resources` script after `<head>` (lines 142–154).
4. `DOMParser` → **`document.documentElement.replaceWith(...)`** (line 161) — full live
   document replacement.
5. Re-create every `<script>` (DOMParser scripts are inert per spec); await `onload` for
   src scripts to preserve order; inline `text/babel` src content from blobs (lines 162–179).
6. Manually invoke `Babel.transformScriptTags()` (line 183).
7. Inside the template: fetch/XHR monkey-patch shim maps `ios-frame.jsx`/`nav-icons.js` →
   blobs; `nav-icons.js` registers `<dime-nav-icon>`/`<dime-logo>` custom elements;
   `bdb093e9` = dc-runtime (generated, `// GENERATED from dc-runtime/src/*.ts`) loads
   React/ReactDOM UMD blobs, parses `<x-dc>` + `data-dc-script`, renders with reviewer
   prop panel (`initialTheme: dark|light|mint`, `creditScenario` ×7, `startWithConversation`).

Classification — A bundler shell: REMOVE · B dc-runtime/Babel/React UMDs: REMOVE ·
C embedded assets: see §5 · D external deps: none at runtime (all inlined) ·
E reviewer controls/device frame: REMOVE.

## 5. Embedded Asset Ledger

35 assets · 1,748,016 B encoded → 3,946,303 B decoded · zero duplicates (sha256-verified).

| Asset | Decoded | Used | Prod-suitable | Class |
|---|---|---|---|---|
| @babel/standalone 7.29.0 | 3,137,752 B | runtime | no | REMOVE |
| react-dom 18.3.1 / react 18.3.1 UMD | 131,835 / 10,751 B | runtime | no | REMOVE |
| dc-runtime (`bdb093e9`) | 62,106 B | runtime | no | REMOVE |
| iosFrame.jsx | 21,081 B | device chrome (self-labeled `@ds-adherence-ignore` scaffold) | no | REMOVE |
| navIcons.js | 2,219 B | nav glyphs (feed rect+lines · splits 3-bars · chat bubble · props flask · profile person; 22×22, stroke 1.7) | reference only | EXTRACT shapes; keep repo lucide set (semantics 5/5) |
| Team logos ×8 (MLB ATL/BOS/NYY/PIT, NBA BOS/DEN/NY/OKC; 500×500 PNG) | 8,647–98,474 B | sample cards | no (third-party team IP; repo has `TeamLogo.tsx` + ESPN CDN registry) | REMOVE |
| flagAr / flagFr | 569 / 150 B | WC sample | no | REMOVE |
| `49fbba8b.jpg` 400×400 — "Prez Bets" photo (= prezcirca.jpg) | 44,676 B | avatar ×5 sizes (30/32/52/64 px, all with width/height attrs — no CLS) | **no — personal reference material; never redistribute** (repo already has `dime-chat/assets/prez-avatar.jpg`) | REMOVE |
| Familjen Grotesk woff2 ×3 (latin/latin-ext/vietnamese) | 18,884/15,532/6,272 B | UI font | **genuine variable font, fvar wght 400–700** (fontTools-verified); one file per subset declared at 4 weights — Google-Fonts pattern, NOT synthesis | REMOVE files (repo loads same family via Google Fonts) |
| IBM Plex Mono woff2 ×15 | 4,000–10,120 B | metrics font | genuine statics 400/500/**600** ×5 subsets (usWeightClass verified) | REMOVE files; do NOT adopt the 600 weight (§10) |

Wordmark asset: none — the wordmark is CSS-constructed markup (§10). No unused assets
except the mono-600 faces becoming unused once typography is normalized.

## 6. Application Architecture Reconstruction

One class `Component extends DCLogic` (dc-script.js:2–774). View = declarative
`<x-dc>` template with `sc-if`/`sc-for`/`{{ }}` bindings; a single `renderVals()`
(dc-script.js:382–773) computes ~90 derived bindings per render. No routing — a `tab`
enum (chat/profile/splits). No persistence of any kind: reload resets credits,
conversations, profile edits, membership. Random ids via `Math.random()`. Simulated
streaming: `send()` → 700 ms thinking → 2 words/45 ms → 350 ms settle → attach
card/followups → client-side −40 credits. Keyword-matched canned responses (`world
cup|simulation`, `prop|edge`, `yankee|red sox`, fallback). `genToken` counter guards
stale timers (correct pattern). **Defects:** 4 timers (`fadeTimer/restoreTimer/
toastTimer/streamTimer`) never cleaned on unmount (only matchMedia+resize are,
dc-script.js:47–50); clipboard false-success (toast regardless of async rejection,
:444); fake 600 ms profile save (:718).

## 7. Component and State Map

27 state properties in one bag, decomposed for the rebuild:

| Inferred component | State it owns today | Reusable? | Target owner |
|---|---|---|---|
| Shell / ThemeProvider | `theme, resolvedTheme, tab, deviceCat/Id, viewH/W` | concept | `ThemeContext` (typed `'dark'\|'light'\|'mint'`), wouter routes; device state REMOVED |
| DesktopSidebar | derived nav/recents | yes (labels already in repo) | `DimeShell` client component |
| MobileHeader + AvatarMenu | `avatarMenuOpen` | yes | shell |
| ChatHome (Identity, Composer, PromptPills) | `composerText, composerFocused, identityFaded/Gone` | yes | `dime-chat/` (repo composer exists) |
| ConversationThread | `messages, genToken, scrolledUp` | pattern | repo `chatReducer.ts` (real SSE) |
| MatchCard / PropCards | per-message `evidenceOpen, whyOpen, saved` | visual+ARIA yes; data no | new `dime-chat/cards/` fed by `[EDGE]` grammar v2 |
| CreditPill + CreditsSheet | `credits, scenario` | states yes; authority no | server-derived via `dimeCredits` router |
| HistoryDrawer | `historyOpen, historyQuery, renamingId, renameDraft, confirmDeleteId, convos, currentConvoId` | interaction yes | `dime_conversations` table + router |
| ProfilePage | `displayName, editNameDraft, saving, notifsOn, discordConnected, oddsFormat, membershipCanceled, savedIds, savedCount` | layout yes | merged `Profile.tsx`+`ManageAccount.tsx`; oddsFormat = real pref (D4) |
| Sheets ×4 + LogoutConfirm | `creditsOpen, membershipOpen, editOpen, logoutOpen` | layout yes | shared focus-trapped `<DimeSheet>/<DimeDialog>` |
| SplitsPage | none (all literals) | layout yes | `BettingSplits.tsx` reskin over VSiN data |
| Toast | `toastText, toastVisible` | yes (`role="status"`) | shared toast |
| DeviceFrame + ReviewerControls | device state | no | REMOVE (scenario states → Storybook/test fixtures) |

## 8. Feature and State Matrix

| Feature | Trigger | Persistence | Reality | Class → production requirement |
|---|---|---|---|---|
| New Chat | sidebar/+ drawer | none | functional (local) | RETAIN concept; repo has it |
| Send/stream/stop | composer | none | **locally simulated** | RETAIN repo SSE core; REBUILD chrome |
| Regenerate | actions row | none | simulated | REFACTOR onto real re-request |
| Suggested prompts | 3 pills | — | functional | RETAIN (labels identical in repo) |
| Follow-up chips | post-answer | none | canned | REBUILD (model-driven meta) |
| Match card | keyword | none | hardcoded | REBUILD on `[EDGE]` v2 (WC2026/MLB) |
| Prop cards | keyword | none | hardcoded **NBA** | REBUILD MLB; **DEFER NBA (D7)** |
| Copy | actions | — | **false success** | REBUILD (await clipboard) |
| Save analysis | actions | none | simulated | REBUILD server-side or DEFER (D6 open) |
| Credit pill/sheet (7 states) | header | none | **client-authoritative** | REBUILD server-derived (D2) |
| Add credits +1,000 | sheet CTA | none | simulated | REBUILD as top-up packs (D8, §17-B blueprint) |
| Membership view/cancel/resume | sheet | none | client toggle | REFACTOR onto live Stripe mutations |
| Upgrade → Elite | menu | — | toast stub | REFACTOR onto CheckoutPage |
| Edit name | sheet | none | fake save | REBUILD (new mutation) |
| Discord connect | profile row | none | toggle | RETAIN repo OAuth |
| Notifications toggle | profile | none | toggle, off-law motion | DEFER (no pref field) |
| Odds format | profile radiogroup | none | **dead control (zero consumers)** | REBUILD end-to-end (**D4 resolved: implement**) |
| Theme dark/light/mint | profile + preview chips | none | works; mint phone-only | REBUILD sitewide 3-theme (**D1**) |
| History search/rename/delete | drawer | none | functional (local, two-tap delete) | REBUILD on persistence |
| Recent chats | sidebar | none | canned ×6 | REBUILD on persistence |
| Betting splits page | tab | — | fully hardcoded | RETAIN VSiN data path (**D3**); REBUILD skin to prototype layout |
| Feed/Trends/Props nav | sidebar/bottom | — | toast stubs / dead `#` | DEFER (E8; Trends data exists, no read proc) |
| Bet Tracker nav | sidebar | — | toast stub | RETAIN repo route |
| Logout confirm | alertdialog | — | toast | REFACTOR (repo lacks confirm) |
| Device selector/frame | reviewer bar | — | prototype-only | REMOVE |
| Loading/empty/error states | pill shimmer, credits error, splits em-dash | — | designed | RETAIN visual intent |

## 9. Data and Business-Logic Audit

All data hardcoded (dc-script.js:147–226 convos/cards; :511–556 splits; :698–702 credit
activity). No fetch/storage/external requests (fetch shim only remaps two prototype
files). Recomputation of the implied-probability edge (fair% − book%):

| Market | Computed | Displayed | Verdict |
|---|---|---|---|
| Tatum O27.5 (−112/−138) | +5.15 | +5.2% | consistent |
| ARG ML (+136/+117) | +3.63…3.71 | +3.6% | consistent |
| SGA (−108/−129) | +4.41 | +4.1% | **inconsistent** |
| Brunson (−105/−118) | +2.91 | +2.6% | **inconsistent** |
| NYY/BOS O8.5 (−105/−124) | +4.14 | +4.3% | **inconsistent** |
| Pirates ML ROI (−110 vs −135) | EV ≈ +9.7% | **+14.89%** | not derivable |
| Pirates +1.5 ROI (−168 vs −189) | EV ≈ +4.3% | **+9.05%** | not derivable |

⇒ Artifact numbers are illustrative strings. **Extract no math.** Production formulas are
law: `client/src/lib/edgeUtils.ts` (`calculateEdge` ≥1.5pp Option-B, `calculateRoi` =
modelImplied/bookNoVig−1, 6-tier verdicts), `useEdgeCalculation.ts`, GameCard verdicts.
Server-authoritative mandates: credits (`dime_credit_ledger`, append-only w/
`balance_after`), membership (Stripe webhook), model prices (`games.model*` columns),
splits (VSiN pipeline), conversations/saves (new tables). The artifact's client-side
deduction/`addCredits`/membership toggles must not be ported. Full server-path audit with
gaps and risks (chat↔ledger auth mismatch, abort double-charge, first-row race, webhook
mode-branch misfulfillment, idempotency, refund clawback, VSiN 0/0 guards, staleness):
blueprint §17.

## 10. Design-System Extraction

44 CSS vars × 3 themes (template :252–296). Brand core matches law; `#39FF14`, gradients,
purple: absent ✓. Corrections required before adoption (evidence in blueprint §7 + agent
register of 35 violations):

1. Light `--canvas/--work-bg #EDEDF2` → LAW `#FFFFFF`.
2. Light single `--mint:#0FA36B` collapses fills+text → fills stay **brand mint `#45E0A8`**
   (D1a); `#0FA36B` remains only as mint-TEXT-on-light (MASTER `--mint-on-light`) — and
   even that passes only ≥18.66px/700 (it measures 3.24:1 on white at small sizes).
3. LAW border colors `#24242E/#D5D5DC` used as surfaces (`--surface2`, `--bubble`).
4. `--text3` as running text: dark ≈4.05–4.13:1, light 2.38:1 — FAIL; `--text-body #C9C9D4`
   tier absent entirely.
5. `--on-mint #FFFFFF` on `#0FA36B` CTAs = 3.24:1 — keep light CTAs `#45E0A8`+`#0B0B0F` ink (11.68:1).
6. **Typography inversion:** values in IBM Plex Mono 500–700, labels in Familjen — LAW is
   the opposite (mono = 10–11px uppercase labels @0.08em, 400/500 only; values = Familjen
   700 15–20px). Normalizing removes the mono-600/700 dependency.
7. Mint-filled decorative prompt pills (pp1-light/pp3-dark) — mint without signal.
8. Motion: five easings, 0.15–0.5 s, instant hovers → LAW one curve
   `cubic-bezier(0.16,1,0.3,1)` @160 ms (`landing-v2.css` already complies).
9. Send caret/plus colors swapped vs MASTER composer spec in both themes.
10. **13 comment-anchor hex patches**, 4 critical: mobile composer white-on-white textarea
    (:650–652); splits "Model" label `#FFFFFF` invisible on light (:705); credit pill
    `#FFFFFF/#000000` (:397–400); history icon white stroke (:388). Plus split-bar white
    borders (:719/722), emptied mobile-prompts block (:647–649), `text-align:justify`
    artifact (:673), avatar `#FFFFFF2E` border (:406), bottom-nav `color:#FFFFFF` (:858).
11. **Wordmark** off frozen spec (dot 0.281em/0.233em vs 0.20em; tracking −0.0125/−0.0167em
    vs −0.05em; missing +0.03em offset; two mutually inconsistent instances) — repo's
    `BrandHero` (`DimeChatPage.tsx:302-314`) implements MASTER verbatim; reuse it.
12. Mint theme block (:282–296) is now canonical per D1 with ONE fix: `--text3` alpha
    0.52→**≥0.62** (3.47→4.64:1). Rest passes (`--text2` 6.24:1; ink-on-mint 11.68:1;
    splits dark-island cards 16.84:1; white coin-dot + hairline = MASTER rule).

NEW semantics to add to MASTER (D5): `--scrim, --track, --on-mint, --sp-*` (splits
namespace), prompt-pill tiers, composer `--send-*` — with corrected values + mint column.
Keep from the prototype: mint-rationing instinct (grey non-signal), composed ARIA card
sentences, `width/height` on images, `prefers-reduced-motion` handling.

## 11. Responsive Architecture Audit

**Simulated, not responsive.** An 18-device catalog (dc-script.js:51–78) drives a scaled
frame (`frameScale`, :132–135); "breakpoints" branch on the *selected device's* width in
JS: `sideLayout` (desktop ≥1900/≥1440; tablet ≥1032/906/820, sidebar 216–280 px, homeMax
520–760 px) and `splitsLayout` tiers row/tab3/tab2/stack at 800/700 with phone paddings
keyed to 360/375/393/412/420/430. Only real media query: `prefers-reduced-motion`. Mint
was phone-gated (now lifted per D1). Per requested viewport validation: every listed
phone/tablet/desktop size maps to an explicit tier in those two functions — the intent is
fully recoverable and must be re-expressed as CSS breakpoints/container queries:

- Desktop/tablet: left sidebar (law: 264 px per feed draft; prototype 216–280) ·
  Mobile: bottom nav (5 tabs) + 52 px-offset header ✓ matches requirement.
- Content clamp 680 px above 700 px width; splits grid `idW + repeat(3,minmax(0,1fr)) +
  edgeW` → 3-col → 2-col → stacked.
- Repo collision: `index.css` viewport `--scale` engine (`clamp(0.81,100vw/393,3.85)`) —
  `BettingSplitsPanel` consumes `--pill-height`; scope or retire per-surface, don't fight it.
- Repo gap: chat is desktop-gated (`ViewportGate` <1024) — the prototype's mobile chat
  becomes the spec for lifting the gate.
- Clamping risks: prototype `homeMax` 520 px at 744-wide tablet is tighter than needed;
  keyboard avoidance/safe-areas unimplemented (fake frame) — must be real
  (`env(safe-area-inset-*)`, `100dvh` — template already uses `100dvh` at :311).

## 12. Accessibility Audit

Keep (genuinely good): composed `aria-label` sentences on match/prop/splits cards
(:509/:569/:679/:712); `role="img"` split bars with truthful ARIA; `aria-expanded`
disclosures; radiogroup/radio + switch semantics (:792–806); `role="status"` toast;
`aria-current` nav; ≥44 px nav/menu rows; real `<label>` wrappers; reduced-motion honored.

Fix in rebuild (WCAG cited):

| Defect | Component | Remedy | WCAG | Test |
|---|---|---|---|---|
| No focus trap/initial focus/Escape/restore | 5 dialogs (:871/:921/:959/:985/:1009) + menu (:412) | shared `<DimeSheet>/<DimeDialog>` with trap+Escape+restore; menu arrow-keys + `aria-haspopup` | 2.1.2, 2.4.3 | keyboard-only open/close cycle |
| No `aria-live` on stream | thread (`main` :435) | polite live region announcing completion | 4.1.3 | SR announces answer done |
| Contrast failures | §10 items 2/4/5 + mint `--text3` 3.47:1 + light `--sp-text3` 4.34:1 + splits Model label 1.00:1 | corrected tokens | 1.4.3 | scripted ratio check ≥4.5:1 |
| Split-bar visual contradicts ARIA (97/3 ≈ 80/20 via `min-width:46px`) | :719/:722 | `width:%` + external label for tiny segments | 1.4.1-adjacent | 97/3 renders 97/3 |
| Text glyphs as icons (`✓ › ▴▾`) | :970–973, :835–848, chevrons | brand SVG/lucide, `aria-hidden` | — | no glyph icons |
| 36–38 px action buttons | :610–627, :636 | ≥44 px hit area | 2.5.8 | tap-target audit |
| Focus ring 2 px outline | :298 | 3 px `box-shadow var(--ring)` per MASTER | 2.4.7 | visible on all interactives |
| No doc `lang`/`title` in template head | template | shell provides (`index.html` already does) | 3.1.1, 2.4.2 | — |
| 200% zoom / text scaling | untested in artifact (fixed frame) | verify in rebuild | 1.4.4/1.4.10 | zoom sweep |

## 13. Security and Trust Audit

No secrets/keys/PII beyond the personal photo (removed from scope). No network calls. All
issues architectural, all resolved by discarding the container:

| Issue | Severity | Exploitability | Action |
|---|---|---|---|
| Runtime code gen (Babel `transformScriptTags`) + blob-URL script execution + full document replacement + fetch/XHR monkey-patching | High (CSP: needs `unsafe-eval`, `blob:`) | low (self-contained) | REMOVE — production is Vite-compiled, standard CSP |
| Client-authoritative credits/membership/entitlements | High (trust) | trivial if ported | REBUILD server-authoritative (§9; blueprint §17-A/B) |
| Clipboard false-success | Low (integrity) | — | await promise |
| Untrusted rendering | n/a in artifact; rebuild renders model/user text via React text nodes only — no `dangerouslySetInnerHTML` | — | enforce in review |
| SRI stripping (line 140) | n/a (bytes are local) | — | REMOVE with bundler |

Repo-side notes surfaced during audit (pre-existing, out of artifact scope): webhook 200s
before async processing with no event-dedup store; `products.ts` hardcoded live-price
fallbacks — both already documented in blueprint §17-B for the packs work.

## 14. Performance Audit

Artifact: 1.91 MB HTML → 3.95 MB in-memory; Babel = 3.14 MB (79%) + JSX transform + full
document re-parse, all main-thread; base64+gunzip decode on load; object URLs retained
forever. Product-code weight is trivial (~160 KB template+logic; ~450 KB images; ~139 KB
fonts). None of this carries over. Target treatment (mostly already true in repo): lazy
wouter routes (chat/splits/profile already lazy in `App.tsx`); Google Fonts
`display=swap` + preconnect (present; **drop legacy Inter/JetBrains load**,
`client/index.html:20`); ESPN CDN team logos with dimensioned `<img>`; real SSE streaming;
60 s feed polling with `placeholderData` (contract); budget: chat route JS <250 KB gz;
CLS ≈0 via dimensioned media; no artifact-bundler concept survives.

## 15. Mandatory Issue Verification

All 27 items re-verified with reproduced evidence (full table in blueprint §9):
**Confirmed (22):** browser-side unpacking · base64 assets · blob-URL loading · document
replacement · browser Babel · monolithic architecture · inline styling · repeated
literals · hardcoded data · dead controls · simulated device responsiveness ·
client-authoritative credits · client-authoritative membership · wordmark mismatch ·
light-theme hardcoded white text · split-bar distortion · ROI/edge inconsistency ·
incomplete mint support (now being completed per D1) · insufficient contrast · missing
modal focus management · uncleaned timers · clipboard false-success · missing document
metadata. **Partially confirmed (3):** tablet clamping (deliberate, mild) · touch targets
(nav ≥44, actions 36–38) · live regions (toast yes, stream no). **Not confirmed (1):**
synthetic Familjen weights — genuine variable font.

## 16. Complete Migration Ledger

| # | Item | Class | Target |
|---|---|---|---|
| 1 | Bundler/unpacker/error sink/thumbnail | REMOVE | — |
| 2 | Babel, React/ReactDOM UMD, dc-runtime, fetch-shim | REMOVE | — |
| 3 | iosFrame.jsx, reviewer controls, device catalog/scaling, scenario chips UI | REMOVE | scenario states survive as test fixtures |
| 4 | Team logos, flags, profile JPEG, font woff2s | REMOVE | repo equivalents (§5) |
| 5 | navIcons glyph geometry | EXTRACT (reference) | lucide stays |
| 6 | Dark+light token blocks | EXTRACT + correct (§10) | `client/src/styles/dime-tokens.css` |
| 7 | Mint token block | EXTRACT + correct (alpha ≥0.62) — **first-class per D1** | same file; MASTER mint column |
| 8 | Wordmark markup | REMOVE (repo BrandHero is spec-exact) | shared `<DimeWordmark>` |
| 9 | Chat chrome (identity fade, composer states, actions, followups) | REBUILD | `client/src/pages/dime-chat/` |
| 10 | Match/prop card visual+ARIA design | REBUILD | `dime-chat/cards/` on `[EDGE]` v2 |
| 11 | Canned convos/splits/credit-activity sample data | EXTRACT as fixtures | `__fixtures__/` + Storybook |
| 12 | Simulated streaming | REMOVE (real SSE exists) | — |
| 13 | Credit pill/sheet 7-state design | REBUILD server-derived | `dimeCredits` router + shell chrome |
| 14 | Add-credits CTA | REBUILD as packs (D8) | Stripe `mode:"payment"` path (blueprint §17-B) |
| 15 | Membership sheet | REFACTOR | live Stripe mutations, merged profile |
| 16 | Edit name / logout confirm | REBUILD / REFACTOR | new mutation; confirm dialog |
| 17 | Odds-format setting | REBUILD end-to-end (**D4**) | user pref + `edgeUtils` formatter |
| 18 | Notifications toggle, saved analyses | DEFER (D6 open for saves) | — |
| 19 | History drawer + recents | REBUILD | `dime_conversations` + router |
| 20 | Splits page layout (identity col, 3 markets, Book+Model, bars, ROI chips) | REBUILD skin | `BettingSplits.tsx` over VSiN + `edgeUtils` |
| 21 | Splits/edge/ROI math | RETAIN repo | artifact numbers banned |
| 22 | Bottom nav | REFACTOR | flip owner flag + retokenize |
| 23 | A11y card/radiogroup/switch/toast patterns | RETAIN pattern | all rebuilt components |
| 24 | Focus traps, live region, SVG icons, 44 px targets, ring | REBUILD (new) | shared primitives |
| 25 | Trends/Prop-Projections destinations | DEFER (E8) | — |
| 26 | NBA prop cards | DEFER (**D7**) | — |
| 27 | dc `data-props` reviewer schema | UNKNOWN→REMOVE (no prod use identified) | — |

## 17. Source-to-Target Component Map

| Prototype (template lines) | Target |
|---|---|
| Desktop sidebar :380–436 | `DimeShell/Sidebar.tsx` (exists partially as `DimeChatPage` sidebar :160–300 — lift out) |
| Mobile header + pill + avatar menu :382–433 | `DimeShell/MobileHeader.tsx` + `CreditPill.tsx` + `AccountMenu.tsx` |
| Identity empty state :437–451 | `dime-chat/BrandHero` (exists) |
| Desktop home + composer :454–477 | `dime-chat/Composer.tsx` (exists; add plus-button behavior or keep inert) |
| Thread + bubbles :483–507 | `dime-chat/ConversationThread` (exists via chatReducer) |
| Match card :508–562 | new `dime-chat/cards/MatchAnalysisCard.tsx` |
| Prop cards :566–603 | new `dime-chat/cards/PropCard.tsx` (MLB) |
| Actions row + followups :610–627 | new `dime-chat/MessageActions.tsx` |
| Return-to-latest :636–642 | thread affordance |
| Splits page :668–753 | `pages/BettingSplits.tsx` + `BettingSplitsPanel` (exist — reskin per prototype layout) |
| Profile :756–851 | merged `pages/Profile.tsx` (+`ManageAccount` functions) |
| History drawer :869–916 | new `dime-chat/HistoryDrawer.tsx` |
| Credits sheet :919–954 | new `credits/CreditsSheet.tsx` |
| Membership sheet :957–980 | `profile/MembershipSheet.tsx` |
| Edit profile :983–1004 / logout :1007–1017 | `profile/EditProfileSheet.tsx` / shared confirm dialog |
| Toast :1020–1022 | shared `Toast` (`role="status"`) |
| Bottom nav :855–864 | `mobileOwnerTabs` (exists — retokenize, un-gate) |

## 18. Target Route Architecture

Existing wouter table stands (App.tsx:116–201). Prototype maps onto: `/chat` (chat home +
conversation) · `/betting-splits` (splits; fix the `/splits` self-link bug at
`BettingSplits.tsx:541` → `App.tsx:137` redirect) · `/profile` (merged profile; absorb
`/account` functions, keep `/account` as redirect) · `/feed` (projections; unchanged
contracts) · `/bet-tracker` (unchanged) · Trends + Prop Projections: no routes yet
(deliberate; E8). New shell test route `/dime` during W1–W2, deleted at cutover. Mobile
`/m/:rest*` retires when the public bottom nav ships.

## 19. Target Component Tree

```
<App>
 └─ <ThemeProvider theme='dark'|'light'|'mint'>          (data-theme on <html>)
     └─ <DimeShell>
         ├─ <Sidebar> (≥1024px)  · <DimeWordmark> · NavRows · RecentChats · <CreditPill> · ProfileRow
         ├─ <MobileHeader> (<1024px) · HistoryButton · <CreditPill> · <AccountMenu>
         ├─ <Outlet/> (wouter routes)
         │   ├─ ChatPage: <BrandHero> | <ConversationThread> → <MessageBubble> · <AIMessage>
         │   │     → <MatchAnalysisCard> | <PropCard[]> | <MessageActions> | <FollowupChips>
         │   │   + <Composer> (send/stop) + <ReturnToLatest>
         │   ├─ BettingSplitsPage: <MatchIdentity> · <MarketBlock×3> → <SplitBar×2> · <ModelEdgeChips>
         │   ├─ ProfilePage: identity · membership card · credits card · personalization
         │   │     (ThemePicker · OddsFormatPicker) · Discord · activity · <EditProfileSheet>
         │   └─ FeedPage (existing, restyled per draft Phases B–C)
         ├─ <MobileBottomNav> (5 tabs)
         ├─ <CreditsSheet> · <MembershipSheet> · <DimeDialog(logout)>  (focus-trapped)
         ├─ <HistoryDrawer> (focus-trapped)
         └─ <Toast role="status"> · aria-live stream region
```
Shared: DimeWordmark, CreditPill, DimeSheet/DimeDialog, Toast, TeamLogo (exists),
SplitBar. Feature-specific stays in its feature folder — no premature abstraction.

## 20. Target Directory Structure

Adapted to the existing repo (not Next.js):

```
client/src/
  components/dime-shell/    Sidebar, MobileHeader, MobileBottomNav, AccountMenu
  components/ui-dime/       DimeWordmark, DimeSheet, DimeDialog, Toast, CreditPill
  pages/dime-chat/          (exists) + cards/, HistoryDrawer, MessageActions, __fixtures__/
  pages/BettingSplits.tsx   (reskin in place)
  pages/Profile.tsx         (merged)
  features/credits/         CreditsSheet, useCredits (tRPC hooks)
  styles/dime-tokens.css    three-theme corrected token layer
server/
  routers/dimeCredits.ts    balance/activity (appUserProcedure)
  routers/dimeConversations.ts
  stripe/products.ts        + pack catalog
  stripeWebhook.ts          + mode:"payment" branch, dedup, refund clawback
  dime-chat.route.ts        + app_session auth, metering, credit SSE frames
drizzle/dime.schema.ts      + conversations/messages, event-dedup, ledger unique idx
design-system/dime-ai/MASTER.md   + mint column + new semantics (D5)
tests/  (Vitest + Playwright baselines ×3 themes; axe CI)
```

## 21. Server and Client Boundary Map

| Concern | Owner | Notes |
|---|---|---|
| Credits balance/activity/deduction/grants/packs | **Server** (ledger + webhook + routes) | client renders states only; SSE `creditsCharged` frame |
| Membership/plan/expiry | **Server** (Stripe webhook → app_users) | client mutates via tRPC only |
| Model prices/edges/ROI | Server data (`games.model*`) + deterministic client recompute via `edgeUtils` (shared lib) | never client-invented |
| Splits percentages | Server (VSiN cron → games cols) | client derives `100−x` display side |
| Conversations/messages/saves | Server (new tables) | drawer state local |
| Chat streaming | Server SSE; client renders + abort | charge server-side post-stream per D9 ruling at build time |
| Theme/odds-format prefs | Client-persisted (localStorage) now; odds-format may join user record with D4 build | |
| Ephemeral UI (sheets, fades, toasts, composer) | Client | |

## 22. Data Contract Requirements

(A = exists in artifact as concept · R = exists in repo · + = must add)

- **User** — R `app_users`: id, email, username, hasAccess, expiryDate(null=lifetime),
  role, discordId/Username, tokenVersion, stripeCustomerId/SubscriptionId/PlanId,
  cancelAtPeriodEnd, pendingSetup. + `displayName` mutation path (A: editable name).
- **Membership** — R: derived from app_users Stripe fields (`derivePlanLabel`). A adds
  cancel/resume view state → served by existing mutations. + plan-credit allotment config.
- **CreditBalance** — A client number · R derived = latest `dime_credit_ledger.balance_after`
  (virtual-100 default). + seed-row-on-grant to kill the virtual default; `unlimited`
  derivation for owner/admin.
- **CreditTransaction** — R `dime_credit_ledger` {userId, requestId?, deltaCredits,
  balanceAfter, reason, createdAt}. + unique (requestId, reason); + reasons
  `CHAT_ANSWER | PLAN_GRANT | CREDIT_PACK_PURCHASE | REFUND_CLAWBACK`.
- **CreditPack** (+, D8) — {packId, priceId(env), credits, amountCents}; webhook
  fulfillment keyed by unique event/session id.
- **Conversation** (+) — {id, userId, title, createdAt, updatedAt, deletedAt?}; **Message**
  (+) — {id, conversationId, role, content, edgeBlocks?, creditsCharged?, createdAt}.
- **SuggestedPrompt** — static config (R labels already match A).
- **Team** — R shared registries + `TeamLogo`. **Match/Game** — R `games` (~175 cols).
- **Market / SportsbookPrice / ModelPrice** — R `games` columns (§17-C field map);
  **BettingSplit** — R six pct columns + derived complement; + `splitsUpdatedAt` (Q20).
- **Edge** — computed (`edgeUtils`), never stored, never from artifact.
- **ThemePreference** — + `'dark'|'light'|'mint'` (D1). **ProfileSettings** — +
  oddsFormat `'american'|'decimal'` (D4); notifications deferred.

## 23. Asset and Font Migration Plan

Migrate **nothing binary** from the artifact. Fonts: keep the existing Google Fonts link
(Familjen 400–700 variable + Plex Mono 400;500), remove the legacy Inter/JetBrains
request; do not add mono 600 — normalize specs to law instead. Logos: `TeamLogo` +
ESPN CDN registry (already dimensioned/fallbacked). Avatar: real user photo via existing
profile pipeline; prototype photo stays out of bundles. Wordmark: shared component from
repo's spec-exact implementation; mint theme = white dot + `#0B0B0F` hairline.

## 24. Theme Migration Plan

One mechanism: `data-theme="dark|light|mint"` on `<html>`, set by a switchable
`ThemeProvider` typed `'dark'|'light'|'mint'` (replaces dark-lock at `App.tsx:207`,
bridges chat's `.theme-*` and retires the `html.dark`-only path; nothing in the repo sets
`body[data-theme]` today). Token source: `dime-tokens.css` — dark/light per MASTER (the
corrected values, §10), **mint per prototype block :282–296 with alpha fix** (D1). All
mint = brand `#45E0A8` (D1a); on-light mint text = `#0FA36B` at MASTER-permitted sizes
only. Purple shadcn `--primary/--accent/--ring` fenced away from Dime surfaces
(frozen-tokens.css:18–20 shows the pattern). `#39FF14` sweep (252 occurrences) proceeds
per draft Phases B–C so every surface resolves correctly under all three themes. Landing
gains mint alongside dark (D1a: sitewide).

## 25. Responsive Migration Plan

Replace the device simulator with real CSS: breakpoints ~<700 stacked / 700–799 2-col /
800–1023 3-col+tablet-sidebar / ≥1024 desktop-sidebar (+ ≥1440, ≥1900 enhancements),
container queries where the shell embeds cards; mobile bottom nav <1024, sidebar ≥1024
(prototype tablet sidebar 216–240 px, desktop 240–280 px; law 264 px — reconcile in Q3);
lift chat's `ViewportGate`; `100dvh` + safe-area insets; keyboard avoidance on the mobile
composer; validation = Playwright baselines at the §29 viewport grid ×3 themes.

## 26. Phased Migration Waves

W0 evidence preservation ✅ (this audit) → **W1** foundation: shell at `/dime`, 3-theme
provider + corrected tokens + MASTER amendment, wordmark, purple fence, font cleanup →
**W2** static parity: chat chrome, splits reskin (prototype layout over VSiN + `edgeUtils`,
proportional bars, 0/0 guards, `/splits` fix), profile shell, bottom-nav retokenize,
`#39FF14` sweep → **W3** data: chat auth unification → `dimeCredits` router → chat
metering (D2a price, D9 policy at build) → pack catalog/checkout/webhook-mode-branch/
dedup/refunds (D8, sequencing law: webhook branch before any pack price) → plan-credit
grants → odds-format pref (D4) → conversations schema (`db-push.yml` first) → membership
wiring + edit-name → **W4** interaction: `[EDGE]` v2 cards, history drawer, copy/regenerate,
saves (D6) → **W5** hardening: focus-trapped primitives, live region, axe + visual CI,
perf budgets, RG language check → **W6** cutover: flip routes, un-gate mobile nav,
Railway/frontend-host parallel validation, flags + rollback. Entry/exit criteria, risks, and
per-wave rollback: blueprint §12; work items Q1–Q20: blueprint §14. **None executed.**

## 27. Risk Register

| Risk | Sev | Mitigation |
|---|---|---|
| Pack purchase misfulfilled as "monthly" subscription (webhook ignores `session.mode`) | **Critical** | Q19 lands before any pack price exists (sequencing law) |
| Double-credit on webhook replay (no dedup store) | High | unique event-id store + idempotent insert |
| Chat charge on wrong identity (legacy OAuth vs app_session) | High | Q7 auth unification precedes Q7b |
| Abort double-charge (wc2026 fallthrough) | High | D9 policy decided at build; test enforces |
| Virtual-100 first-row race | Med | seed grant row on entitlement |
| `balance_after` chain corruption from out-of-transaction inserts | High | all ledger writes use the `FOR UPDATE` pattern |
| Mint theme regressions on legacy components (252 `#39FF14`, purple vars, `--scale` engine) | Med | 3-theme visual baselines; fencing; per-component sweep |
| VSiN markup change silently nulls splits; no staleness signal | Med | Q20 `splitsUpdatedAt` + SPLITS_HEALTH monitoring |
| 0%/0% Total/ML false 100% bars in new UI | Med | replicate guard client-side (test) |
| Feed contract breakage during reskin | High | contracts inviolable; restyle-only rule; existing tests |
| Schema/deploy ordering (legacy prod until cutover, since completed) | Med | `db-push.yml` before dependent code; merge≠deploy law |
| Scope creep from prototype's dead controls | Low | ledger classifications are binding |

## 28. Dependency and Decision Register

Resolved: **D1** mint sitewide (prototype block, alpha fix) · **D1a** brand mint `#45E0A8`
everywhere · **D2** credits implementing · **D3** VSiN · **D4** odds-format implement ·
**D7** no NBA · **D8** packs implementing. Deferred to build time by owner: **D2a** price
point · **D9** abort-charge policy. Still open (low-stakes): **D5** MASTER amendment
review (required before W1 merge) · **D6** saved analyses now vs E8.
Dependency spine: Q2 tokens → Q1 provider → Q3 shell → W2 skins; Q7 auth → Q7b metering →
Q8 pill; Q17 catalog → Q18 checkout → **after** Q19 webhook branch; Q10 schema →
Q12 drawer; `db-push.yml` precedes Q7c/Q10/Q19/Q20 deploys.

## 29. Acceptance Test Matrix

Baselines: 360×780 · 390×844 · 430×932 · 768×1024 · 1032×1376 · 1366×768 · 1440×900 ·
1920×1080 × **dark/light/mint** × {chat-home, conversation+cards, splits, profile, each
sheet/drawer}. Pass = pixel diff <0.5% vs approved baseline.
Functional (pass/fail): send→stream→stop→regenerate; Enter/Shift+Enter; followup→send;
history search/rename/two-tap delete + reload-persistence; pill→sheet for all 7 states
(server-derived); pack purchase credits exactly once under simulated Stripe replay;
refund clawback row written; subscription webhook regression after mode branch;
concurrent first-request race; abort-charge per D9 ruling; 402 → zero-state; odds-format
toggle reformats every displayed price (D4); splits bars: widths = data (97/3 test),
sum-to-100, 0/0 → "not yet available"; edge/ROI = `edgeUtils` output; theme switch
persists across reload; mint renders on every migrated surface (D1).
A11y: keyboard-only walkthrough; trap/Escape/restore per dialog; stream completion
announced; contrast script ≥4.5:1 all tokens ×3 themes; 200% zoom no loss; reduced-motion
kills all animation. Perf: chat route <250 KB gz; CLS≈0. Compliance: 21+ /
1-800-GAMBLER present on user surfaces.

## 30. Cutover Plan

Preconditions: W1–W5 exit criteria green; Railway backend + standalone frontend-host client previews serving
the shell; `deploy-smoke.yml` green; 3-theme baselines approved. Steps: (1) flag-gated
route flip `/chat`,`/betting-splits`,`/profile` to shell versions; (2) un-gate mobile
bottom nav (`MOBILE_OWNER_TABS_PUBLIC_ENABLED`); (3) 24–48 h parallel validation (legacy
reachable at fallback routes); (4) retire `/dime` test route + `/m/*`; (5) platform
cutover per `references/railway-deploy.md` (until then the legacy host is prod and
merge≠deploy); (6) post-cutover: push-to-main auto-deploys both platforms — schema always
via `db-push.yml` first.

## 31. Rollback Plan

UI waves: release-flag revert (shell routes flip back to legacy pages — kept intact until
W6+1). Schema: additive-only migrations (new tables/columns/indexes; no drops until
post-cutover cleanup) — rollback = ignore. Stripe: pack prices created only after Q19
merges; misfulfillment rollback = deactivate pack prices + reconcile ledger from
`dime_request_audit`/Stripe events. Deploy: frontend-host instant rollback to previous build;
Railway redeploy previous image; the legacy host untouched until cutover. Data: ledger is
append-only — corrections are compensating entries, never edits.

## 32. Unresolved Questions

1. D2a credit price per chat answer (owner: "soon") — config value, not architecture.
2. D9 abort/disconnect charge policy — decide at Q7b; test will enforce whichever ruling.
3. D5 MASTER amendment sign-off (mint column + new semantics) — required before W1 merge.
4. D6 saved analyses in W4 vs E8.
5. Whether `#0FA36B` survives as mint-text-on-light (WCAG-driven) or all mint text on
   light goes large-type `#45E0A8` — flagged under D1a; default = keep MASTER's rule.
6. Tablet sidebar width reconciliation (prototype 216–240 vs law 264) — Q3 design detail.
7. dc `data-props` reviewer schema: no production use identified (UNKNOWN→REMOVE unless
   the owner wants scenario-preview tooling kept as Storybook).

## 33. Final Migration Readiness Score

**8/10.** Evidence complete; artifact fully decoded; every surface mapped to repo files
with verdicts; corrected tokens specified; server gaps audited to file:line; work queue
sequenced with tests. Deducted: −1 for build-time decisions (D2a/D9/D5/D6) and −1 for
untested-at-scale mint rollout across 252 legacy accent sites. Nothing requires
re-auditing the artifact.

## 34. Exact Claude Code Implementation Prompt

> [Deliverable for a FUTURE session — NOT executed. Owner must explicitly start it.]
>
> Execute the Dime AI standalone-HTML migration using
> `dime-ai/FULL-MIGRATION-REPORT.md` and `dime-ai/STANDALONE-HTML-MIGRATION-BLUEPRINT.md`
> as the sole sources of truth — do not re-audit the artifact. Binding rulings: mint theme
> sitewide per the prototype token block with the ≥0.62 alpha correction (D1), brand mint
> `#45E0A8` everywhere (D1a), credit pricing on (D2; price set at build), VSiN splits
> (D3), odds-format setting implemented end-to-end (D4), no NBA props (D7), top-up packs
> (D8), abort-charge policy decided when built (D9). Work wave by wave (report §26 /
> blueprint §12), one issue/worktree/PR per queue item (blueprint §14 Q1–Q20) in
> dependency order (report §28). Sequencing laws: webhook `session.mode` branch (Q19)
> BEFORE any pack price exists in Stripe; chat auth unification (Q7) BEFORE any chat
> charge (Q7b); `db-push.yml` BEFORE any code depending on new schema. Hard rules: strict
> TypeScript (`npx tsc --noEmit` green per PR); Dime brand law (amended MASTER.md) beats
> the prototype on every conflict (report §10 corrections are mandatory); never port the
> artifact's bundler, Babel, blob execution, device simulator, dead controls, timers
> without cleanup, clipboard false-success, or any client-authoritative
> credit/membership/entitlement logic; credits, membership, conversations, and all
> model/edge/ROI numbers are server-authoritative or `edgeUtils`-computed — artifact
> numbers are known-inconsistent fixtures; feed data contracts are inviolable; keep the
> SSE core streaming-intact; render model/user text as React text nodes only; keep
> responsible-gaming language (21+, 1-800-GAMBLER); no redesign, no new features beyond
> this report; testing gates per report §29 on every PR (3-theme baselines, a11y, credit
> race/replay tests); rollback note per PR (report §31); require explicit owner approval
> before anything production-facing or destructive (deploys, flag flips, schema pushes,
> Stripe product/price creation, route cutover).

---

*All quantitative claims reproduced by command in the audit session of 2026-07-10.
Write-only audit: no product code modified; no issues or PRs created.*
