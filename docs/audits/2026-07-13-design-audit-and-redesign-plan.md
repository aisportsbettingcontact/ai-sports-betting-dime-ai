# Dime AI design + copy audit and redesign plan

**Date:** 2026-07-13 · **Scope:** full client (shell, chat, feed/data, bet tracker, marketing/auth/legal, copy) · **Method:** 7 parallel file-level audits + measured WCAG contrast math + font-file inspection + reference-page delta. Static analysis only; runtime browser verification is blocked in this environment (same limitation THREE-COLOR-LAW.md records).

**Lenses:** redesign-skill · taste-skill · frontend-design · stop-slop · WCAG 2.1 AA · brand law (`design-system/dime-ai/MASTER.md`, `dime-ai/THREE-COLOR-LAW.md`, `design-system/dime-ai/pages/*.md`).

---

## 1. Executive verdict

The de-slop pass worked where it aimed. Chromatic slop is dead: no purple, no neon `#39FF14`, no gold, no gradients, one accent, and the copy voice on the landing is the opposite of AI slop ("A system that passes is more valuable than a system that screams"). The engineering under the paint is strong: the 160ms brand curve survives everywhere, `prefers-reduced-motion` is honored in depth, the drawer has a real focus trap, the checkout mirrors validation client/server, and DimeModelFeed is a genuinely disciplined data surface.

The over-rotation is precise and measurable: **the Three-Color Law deleted tone along with color.** Purple was slop. Grey never was. By mapping every text tier, every surface tier, and every border to the same two values, the law removed the machinery that makes a dense data product scannable, and it did so on a product whose thesis (MASTER.md's own words) is "edge values pop because everything else is grey."

Three facts frame everything below:

1. **Hierarchy bandwidth collapsed from four tiers to one.** The old dark theme carried text at 16.8:1, 12.0:1, 7.1:1, and 3.7:1 against its ground. The current theme renders every tier at 21.0:1. Borders also render at 21.0:1, which means **a hairline now shouts exactly as loud as a headline.** Size and weight are the only surviving hierarchy channels, and roughly a dozen components (documented below) were never re-expressed in those channels, so they render as no-ops or literally invisible elements.
2. **The strict-3 palette is already fictional.** Production renders team colors, country flags, bet-loss red, Discord blurple `#738ADB`, GG Sans (Discord's proprietary font, hotlinked in `index.html`), IBM Plex Mono (still fetched by Stripe checkout), chart alpha, drawer-scrim alpha, and ten-plus opacity dims that are grey by another name. The purity being paid for in hierarchy, affordance, and legibility does not exist in the shipped pixels.
3. **The two brand-law documents contradict each other.** MASTER.md mandates IBM Plex Mono micro-labels, grey tiers, and rgba hovers. THREE-COLOR-LAW.md retires all three. CLAUDE.md still names MASTER.md as authoritative. Every future session inherits this ambiguity.

**Recommendation (section 9): keep the law's spirit, amend its letter.** Three *hues* stays the law: mint is the only chroma in the UI. But tones of black and white (achromatic greys) return as hierarchy machinery. That preserves everything the de-slop pass achieved while restoring scannability, affordance, and AA compliance. The alternative (committed strict-3 brutalism) is priced honestly in section 9 as well.

---

## 2. Measurements

| Measurement | Value | Source |
|---|---|---|
| Old dark text ramp (primary/body/secondary/muted on `#0B0B0F`) | 16.84 / 11.96 / 7.07 / 3.69 :1 | computed |
| New dark text ramp (all tiers) | 21.00:1, single tier | computed |
| Old border loudness (`#24242E` on `#16161C`) | 1.17:1 (whisper) | computed |
| New border loudness (`#FFFFFF` on `#000000`) | 21.00:1 (= headline) | computed |
| White text on mint fill | **1.68:1 — hard AA fail** | computed; ships in ≥10 files |
| Black text on mint fill | 12.48:1 — the correct ink | computed |
| Mint text on white (light theme) | 1.68:1 — fail | computed |
| Old `--mint-on-light` `#0FA36B` on white | 3.24:1 — fails AA normal text | computed |
| Proposed `#0B8557` on white | **4.66:1 — passes AA** (and 4.51:1 on black) | computed |
| `--loss-red #FF3B3B` on white (light theme) | 3.53:1 — fails AA normal text | computed |
| Loss-red vs win-mint luminance on black | 5.94:1 vs 12.48:1 — losses ~2× less salient than wins | computed |
| Familjen Grotesk digits | all ten = 680 units wide: **default figures are tabular**; retiring Plex Mono did not break number alignment | font-file inspection |
| Familjen Grotesk OpenType features | `ccmp, kern, mark, mkmk` only (no `tnum` needed, none present) | font-file inspection |

---

## 3. What is excellent (preserve list — do not regress)

- **The honesty architecture.** `landing-content.ts` HONESTY LAW, abstract DEMO data, PASS as first-class output, no fake win rates or testimonials. This is the brand.
- **DimeModelFeed** (`client/src/pages/DimeModelFeed.tsx`) is the reference surface: mint strictly signal-only, white-outline active chips, `tabular-nums` everywhere, dedicated verdict strip, PASS cards go zero-mint and dim. A first-time user finds the pick in under 3 seconds. Every other card surface should converge on it.
- **Motion discipline.** 160ms `cubic-bezier(0.16,1,0.3,1)` intact across shell, chat, pressables; FLIP composer animation; mint active-rail animation; `prefers-reduced-motion` gated in 8+ places including JS-level drawer physics.
- **A11y scaffolding.** Drawer `role="dialog"`/`aria-modal`/inert/focus-trap/Escape/focus-restore; sr-only per-pane h1s; `aria-live` log region; `aria-current` nav; 44px touch targets; safe-area insets; 16px composer font (no iOS zoom).
- **Solid mint focus ring** (`0 0 0 3px #45E0A8`): an upgrade over the old rgba ring. Keep it (add an inner contrast for mint-filled targets, see P0-6).
- **Sign + color everywhere in Bet Tracker** (`+`/`-`, arrows, positions): the reason the win/loss encoding is color-blind-safe.
- **`getEdgeColor`** (`edgeUtils.ts:113`): mint ≥2.5 else white. The one-function expression of "mint = signal."
- **Checkout engineering**: in-domain Stripe Elements, session-expiry recovery, labels above inputs, mirrored validation, no dead links.
- **`profile.css`**: fully token-driven, real focus rings, reduced-motion handling. The model for how surfaces should consume the system.
- **Compliance**: 21+ / 1-800-GAMBLER on every marketing, auth, and checkout surface, with `tel:` + NCPG links.
- **Chat error copy**: "Dime couldn't reach the model. Your message is saved above." No "Oops," no exclamation, names what's preserved.

---

## 4. P0 — broken today (fix under any direction)

| # | file:line | Finding | Fix |
|---|---|---|---|
| P0-1 | `client/index.html:250,380` | SEO shell + FAQ JSON-LD claim **"10,000 simulations per game"**; the entire React app claims **400,000**. Crawlable factual self-contradiction on a product whose pitch is "we don't fabricate numbers." | One truth everywhere (app + SEO + JSON-LD). |
| P0-2 | `frozen-tokens.css:86` | Composer placeholder `color:#FFFFFF` unconditional; light composer bg is white → **"Ask dime anything…" is invisible in light mode.** | Theme-aware placeholder color. |
| P0-3 | ≥10 files: `ErrorBoundary.tsx:65`, `BetTracker.tsx:2694,2699,3062,3255,3567,3654`, `ForgotPasswordModal.tsx:120,194`, `ResetPassword.tsx:117,259`, `NotFound.tsx:42`, `Resources.tsx:531`, `BettingSplitsPanel.tsx:693`, `SituationalResultsPanel.tsx:178`, `F5EdgeLeaderboard.tsx:232`, `MlbBacktest.tsx:232` | **White text on mint fill, 1.68:1.** The system's own token says `--accent-foreground:#000000`; these bypass it. Home.tsx does it correctly. | Black ink on every mint fill. Grep-enforce: no `text-white` adjacent to mint bg. |
| P0-4 | `MlbBacktest.tsx:85,411`, `F5EdgeLeaderboard.tsx:85,411` | **Mint-on-mint** "✓ 70%" hit-target badge: content invisible. | Black ink on mint pill. |
| P0-5 | Token-collapse invisibles: `conversation.css:48` (user chat capsule = page bg, no border), `BetTrackerAnalytics.tsx:262` (equity break-even line = bg), `BetCalendar.tsx:523` (past-day numbers = bg), `BetCalendar.tsx:472` + `DimeModelFeed.tsx:1023` (skeletons = bg), `SituationalResultsPanel.tsx:187` (white record text on white bar), `TeamLogo/DimeModelFeed:980` (white monogram on white fallback disc, light) | Elements painted in tokens that now resolve to their own background. **They render as nothing.** | Border the user capsule; stroke the zero-line; give skeletons/cells a perceptible fill; compute monogram ink from disc luminance. |
| P0-6 | `frozen-tokens.css:265` + `conversation.css:141` | Mint focus ring on mint-filled targets (mint pill, Upgrade button): **invisible focus.** | Add 1px black inset ring on mint-background focusables. |
| P0-7 | `components/ui/skeleton.tsx` | Skeleton uses `bg-accent` = mint. A loading slate renders **~15 pulsing mint blocks per card**: loading state screams "everything is an edge" and destroys mint discipline at first paint. | Neutral skeleton fill; never the signal color. |
| P0-8 | `CheckoutPage.tsx:172-187` | Stripe fields: `focusBoxShadow:"none"`, invalid border = normal border. **Zero focus or error affordance on the payment form.** | Mint ring on `.Input:focus`; distinct `--invalid` treatment. |
| P0-9 | `SubscribeSuccess.tsx:301-326` | Signup inputs: `outline-none`, error ternary returns identical white both branches. No focus, no invalid state, on the post-payment account-creation form. | Mint focus ring; real invalid treatment. |
| P0-10 | `client/index.html` head | **No Open Graph / Twitter Card tags at all.** Social shares render bare. | Add og:title/description/image + twitter:card. |
| P0-11 | `main.tsx` (light) + `dime-mobile.css:19` | Light theme keeps `--dime-mint-text: #45e0a8` (1.68:1 on white) in the tracker, while chat maps mint text → black. WIN text near-invisible in light; and in chat, **the edge number carries no signal color at all in light mode.** | Adopt AA mint-for-text-on-light (`#0B8557`, 4.66:1) in both places, or carry light-mode signal via mint fills with black ink. |
| P0-12 | `SubscribeSuccess.tsx:47-53` | Post-paywall page claims "MLB, NBA, NFL, NHL" — contradicts the landing's honest "MLB live today, World Cup 2026 next." | Align to what ships. |

---

## 5. P1 — structural costs of the strict-3 mapping

| # | Evidence | Finding |
|---|---|---|
| P1-1 | `index.css:140,185` (`muted-foreground === foreground`), `dime-mobile.css:28-30,61-63`, `frozen-tokens.css:52-53` (`--text-secondary === --text-primary`) | **Text hierarchy collapse.** Labels, values, timestamps, footnotes, disclaimers, DELAYED pills, typing rows all render at full strength. A dozen `var(--text-secondary)` rules are silent no-ops. |
| P1-2 | `frozen-tokens.css:73,121-122`, `conversation.css:658-659`, `dime-mobile.css:34-36`, `landing-v2.css:65,126,159,233`, `Resources.tsx` dead hovers | **Hover feedback is dead** on nav rows, menu items, thread menus, tabs, links (transparent→transparent, white→white). Affordance rests on `cursor:pointer` + `:active` scale only. In the Star/Archive/Delete menu you cannot see what you're about to click. |
| P1-3 | Mint spent as chrome: rails on all 5 MLB cards (`MlbCheatSheetCard:822` et al.), always-mint Model% column (`MlbHrPropsCard:163`), permanently-mint Favorites tab (`ModelProjections:1234-1239`), CONFIRMED pills, mint skeletons (P0-7) | **Mint no longer means signal.** On the older card surfaces a user finds *a* mint thing in 3 seconds, not necessarily *the pick*. DimeModelFeed proves the discipline still works when enforced. |
| P1-4 | All surfaces: border `#FFFFFF` on `#000000` at 21:1 | **Wireframe effect + halation.** A typical viewport stacks sidebar border + N card borders + pill borders + composer border, all at maximum contrast. Pure white-on-black at max contrast is a documented strain trigger for astigmatic users. |
| P1-5 | `conversation.css:46-56` vs reference `dime-chat-dark.html` | **Speaker differentiation lost.** Reference had two bordered, asymmetric-corner bubbles (tail grammar). Current: invisible user capsule + bare assistant prose; alignment is the only cue. |
| P1-6 | `frozen-tokens.css:182` (`box-shadow:none`), opaque modal scrims (`LoginModal:75`, `AgeModal:16`) | **Floating surfaces don't float.** Menus/popovers separate by 1px line only; modal scrims are fully opaque so context vanishes; `backdrop-filter` is a no-op over opaque black. |
| P1-7 | `MobileGameCard.tsx:508-585` | BOOK/MODEL/DUAL tab system computes four color branches that **all return `#FFFFFF`**; toggling barely changes the screen. The interaction is inert. |
| P1-8 | `conversation.css:232-238` (disabled nav = live nav), `BetCalendar.tsx:330-339` (disabled month nav = enabled), `BettingSplitsPanel.tsx:693` (disabled markets = enabled), `LoginAttemptBanner.tsx:118-125` (3 severity tiers identical) | **Disabled/severity states are visually identical to active states.** Only `cursor` differs. |
| P1-9 | `conversation.css:660` | **Delete looks identical to Star/Archive** (`--danger { color:inherit !important }`). Destructive action carries no cue; relies on `window.confirm`. |
| P1-10 | `BetTracker` red analysis | Loss-red is ~2× dimmer than win-mint (5.94 vs 12.48:1): **losses systematically under-weighted vs wins** in a bankroll product. Red also scope-crept from "win-loss records" to every financial negative. |
| P1-11 | `GameCard.tsx` (53×), `ModelProjections.tsx:1410` | `hsl(var(--x))` wraps around hex tokens = **invalid CSS**; renders only via inheritance, and `hsl(var(--border) / 0.5)` silently drops a border. Fragile on any non-default ground. |
| P1-12 | `BetTrackerAnalytics.tsx:224`, `MlbBacktest.tsx:446+`, `ModelResults.tsx:839`, `TheModelResults.tsx:330,577` | **Chart gridlines at solid full-white outshout the 2px mint data lines.** The sanctioned chart-alpha exception exists for exactly this and is under-used. `MlbBacktest` also encodes 8 market groups in identical mint (color-only, indistinguishable). |
| P1-13 | `Hero.tsx:16-24` + every landing section | Every section carries an ASCII box-frame label AND a mono eyebrow AND per-card pseudo-codes ("SIM.ENGINE", "EDGE // MODEL − IMPLIED"). Taste-skill eyebrow budget: ≤1 per 3 sections. Current: ~3 per section, same template stamped 11×. |
| P1-14 | `ModelResults.tsx:369,1102,1273,1392` | Multi-tier quality thresholds where every non-mint branch returns identical white: a 1.5 MAE and a 3.0 MAE look the same. Fake gradations. |
| P1-15 | Law-internal contradictions: `.dc-edge--pass{opacity:.82}`, drawer scrim opacity 0→0.46 (`DimeChatPage:786`), `sig-row--pass{opacity:.82}`, `btn:disabled{opacity:.55}`, hover `opacity:.85/.7`, `color-mix` calendar heat | **Opacity is grey by another name.** The law bans alpha, then leans on element opacity as its only de-emphasis tool. Either tones are allowed (then use real ones) or they aren't (then these all violate). |

---

## 6. P2 — hygiene debt (compressed)

- **Stale-comment fossils** describing retired systems: "Barlow Condensed" math (`index.css:313,328`), "IBM Plex Mono is loaded" (`frozen-tokens.css:297`, `dime-mobile.css:74`, `conversation.css:513`), `#39FF14`/`#0FA36B`/gold/gradient references (`MobileOwnerBottomTabs:6-27`, `BetTrackerAnalytics:1-18`, `Profile.tsx:2-6`, `edgeUtils` docs, `MlbCheatSheetCard:821` "Gradient bar"), placeholder comment claiming `#6A6A78` while value is white (`frozen-tokens.css:85`).
- **Dead code:** `AppLoadingShell.tsx` (never imported, contradicts real shell), `DashboardLayout.tsx` (legacy boilerplate with unmapped shadcn greys/shadows — a law landmine if ever rendered), `.dc-frame` rule, dead color ternaries (`x ? "#FFF" : "#FFF"` in Resources, ModelProjections favorites, ModelResults, LoginAttemptBanner, MobileGameCard), dead `:hover` blocks on neutralized tokens, 0-alpha box-shadows (`BetTrackerAnalytics:516,1138`).
- **No-op animation:** `shell-logo-pulse` animates `filter:none → none` infinitely (`index.html:96-103`).
- **Off-law leftovers:** `shadow-lg/md/2xl` utilities never neutralized (`NotFound:15`, `LoginModal:79`, `AgeModal:19`, `ManageAccount:351`); `hover:bg-accent` full-mint hover flash (`ManageAccount:243+`); emoji color leaks (👑💀🔥✅❌ in BetCalendar/BetTracker); GG Sans loaded globally in `index.html:23-51` for one Discord button in `ModelProjections:1046` (licensing + perf + undocumented exception); Stripe still fetches IBM Plex Mono (`CheckoutPage:216`); Discord blurple `#738ADB` undocumented.
- **Console spam:** `MobileOwnerBottomTabs:94-183` logs on every mount and tab tap.
- **Sub-pixel borders:** `0.5px` on send button/pill icons (`frozen-tokens.css:247,279`) render inconsistently across DPRs.
- **`!important` wall:** 100+ in `dime-mobile.css` remap layer; documented mechanism, real specificity debt.
- **Missing `tabular-nums`:** `MlbHrPropsCard:153-174` 7-column odds grid; page-level spans in `ModelProjections`/`BettingSplits`.
- **404 near-dead-end:** apology copy + single "Go Home"; no useful routes.
- **Heading order gaps:** hero h1 → console h3; Trust section leads with h3 (`TrustArchitecture:14`).

---

## 7. Copy audit (stop-slop)

**Score: 7.5/10** (directness 8, rhythm 6, trust 9, authenticity 8, density 8). Unusually good for a product this size; the landing module reads like a disciplined bettor wrote it. The debt is concentrated and mechanical:

1. **The sims-number contradiction** (P0-1) is also the worst copy bug: the honesty brand cannot ship two different core claims.
2. **Naming drift:** "Log in" vs "Sign in/Sign In" vs "Log Out" (+ toast "Signed out" after pressing "Log out"); "Dime Chat" vs "AI Analyst" vs "AI MODEL CHAT"; "Dime Credits" vs "AI Analyst credits." One word per action, one name per feature.
3. **Title Case creep** in app chrome (~25 strings: "Try Again", "Reload Page", "Cancel Subscription", "Explain This Edge"...) against a sentence-case product convention the landing already follows.
4. **Exclamation-mark successes** ("Password reset successfully!", "Subscription reactivated!", "Discord account connected!") and one apology ("Sorry, the page you are looking for doesn't exist.").
5. **Vague errors:** "Something went wrong. Please try again." ×3; ErrorBoundary renders a raw stack trace to users by default; "Contact support." with no channel named (×5 in Home.tsx).
6. **Em-dashes in transactional micro-copy** (session-expired toast, status lines, labels). The landing's em-dash prose voice is a deliberate house style; toasts and errors are not prose. (The `—` empty-cell glyph in tables is a legitimate convention; keep it.)
7. **Residual filler:** "AI-powered analytical outputs" (Terms/Privacy), "Unlock →" CTAs, "Coming soon in test mode" jargon leak.

**Voice spec (adopt as `design-system/dime-ai/VOICE.md`):**
1. Sentence case for everything a human reads; ALL-CAPS only for mono/eyebrow telemetry labels.
2. One word per action, one name per feature: **log in / log out**, **Dime Chat**, **Dime Credits**, **AI Model Projections**. Grep-enforce.
3. Errors name what failed and the next move: "[what broke]. [what you can do / what's preserved]." Ban "Something went wrong," "Oops," "Sorry," bare "An error occurred." Never render a stack trace by default.
4. No exclamation marks in success/info. No decorative emoji in toasts.
5. Periods and colons over em-dashes in transactional copy.
6. Numbers are load-bearing: every figure matches the model, everywhere, including SEO/JSON-LD. Sample data stays abstract + DEMO-labeled.
7. Speak bettor, not brochure: "keep your bankroll" over "unlock insights." If a sharp friend wouldn't say it across a table, cut it.
8. 21+ / 1-800-GAMBLER is non-negotiable furniture on every public surface.

---

## 8. The reference-page delta (what got better, what got lost)

Full table in the audit transcript; the classification:

**Upgrades to keep:** pure-black ground as brand territory · solid mint focus ring · white-hairline starkness *as a rationed signature* · mint-only signal discipline (where enforced) · no gradients anywhere.

**Regressions to reverse:** five text tiers → one · hover feedback → none · four surface tiers → one flat plane · bordered speaker bubbles → invisible/bare · menu shadow → none · value weight 700 → 500 · mono micro-label texture → plain uppercase Grotesk.

**Neutral:** composer fill→outline; LIVE pill treatment.

---

## 9. The direction decision

### Option A — commit to strict-3 brutalism
Keep exactly three rendered values and make brutalism do the hierarchy work: differentiate every state by weight/size/geometry (double keylines for active, dotted borders for disabled, reversed blocks white-bg/black-ink for emphasis and user bubbles, black-ink-on-mint everywhere). Fix only the P0s expressible inside the law.
- **Honest price:** hover stays cursor-only; menus stay shadowless; halation stays; PASS de-emphasis stays opacity (i.e., the law keeps cheating with alpha); light mode keeps no mint text signal; charts stay 1-hue. This is a legitimate *poster* aesthetic permanently taxing a *dashboard* product. Taste-skill and redesign-skill both flag max-contrast-everything as an anti-pattern for data density; MASTER.md's density dial is 8/10.

### Option B — the Tonal Amendment (recommended)
**Law v2: three hues, tonal freedom.** Mint stays the only chroma; black and white may render as achromatic tones (greys carry zero hue — nothing "colorful" returns). Everything the de-slop pass killed stays dead: no purple, no neon, no gold, no gradients, no blue-tinted greys, no second accent. What returns is hierarchy machinery: quiet borders, text tiers, surface steps, hover fills, one menu shadow.

Why B: it keeps the brand-ownable starkness (true-black ground, white keylines *where they signify*, mint scarcity) and un-breaks the twelve P0/P1 classes above at the token layer, mostly without touching component logic. It is also what the codebase is already reaching for illegally via opacity dims, `color-mix` heat, and scrim alpha: the demand for tone exists; v2 just makes it lawful and consistent.

---

## 10. Proposed token spec (Law v2 — all values verified for contrast)

Achromatic tones only. Mint is the single hue. All old chromatic bans stay.

### Dark (default)
| Token | Value | Notes |
|---|---|---|
| `--background` | `#000000` | keep: brand ground |
| `--surface-card` | `#0A0A0A` | one step up; borders become optional |
| `--surface-raised` | `#141414` | menus, active pills, hover fill |
| `--surface-bubble` | `#111111` | user chat capsule (+ border) |
| `--text-primary` | `#FFFFFF` | 21:1 |
| `--text-secondary` | `#A6A6A6` | 8.6:1 — labels, timestamps, meta |
| `--text-muted` | `#6E6E6E` | 4.1:1 — placeholders, faint (large/secondary only) |
| `--border` | `#262626` | quiet default hairline |
| `--border-strong` | `#FFFFFF` | **the rationed signature**: composer, verdict strip, section frames only |
| `--row-hover` | `#141414` | hover returns |
| `--row-active` | `#1F1F1F` + mint rail | |
| `--ring` | `#45E0A8` solid | keep (inner 1px black on mint fills) |
| `--shadow-menu` | `0 12px 32px rgba(0,0,0,0.55)` | floating surfaces only; scoped alpha exception like charts |
| `--accent` / ink | `#45E0A8` / always `#000000` on it | |
| `--loss-red` | `#FF6B5A`-family, luminance-matched to mint | fix the 2× salience gap; verify ≥4.5:1 both themes |

### Light
| Token | Value | Notes |
|---|---|---|
| `--background` | `#FFFFFF` | |
| `--surface-card` | `#F7F7F7` · raised `#EFEFEF` | |
| `--text-primary` | `#000000` · secondary `#595959` (7.0:1) · muted `#767676` (4.5:1) | |
| `--border` | `#D9D9D9` · strong `#000000` (rationed) | |
| `--mint-text-on-light` | **`#0B8557`** | 4.66:1 — light mode gets its signal color back |
| Mint fills | `#45E0A8` + black ink | unchanged |

### Typography
- Familjen Grotesk stays the only face (digit tabularity verified; single-font law held up).
- Restore the micro-label signature without a second font: 10-11px / 600 / 0.08em tracking / uppercase / `--text-secondary`.
- Data values return to **700** at 15-20px per MASTER.md.
- Remove GG Sans from global `index.html`; scope it to the Discord button or drop it. Remove IBM Plex Mono from Stripe fonts config.

### Motion
Unchanged: 160ms brand curve, reduced-motion discipline, no scroll effects. Hover states become visible again via `--row-hover`.

---

## 11. Phased plan

**Phase 0 — stop the bleeding (direction-independent, ~1 day).** Every P0: sims number + JSON-LD, OG/Twitter tags, black ink on all mint fills (grep-enforceable), placeholder theme fix, neutral skeletons, Stripe focus/invalid, signup form focus/invalid, user-bubble border, equity zero-line, calendar invisibles, monogram ink from disc luminance, focus-ring inner contrast on mint, success-page claim alignment.

**Phase 1 — the token decision (A or B, ~1-2 days).** If B: land Law v2 values in `index.css`, `dime-mobile.css`, `frozen-tokens.css`, `landing-v2.css`; then sweep hardcoded `#FFFFFF` literals that the 3-color pass inlined (they bypass tokens and will miss the amendment). Replace all `hsl(var(--x))` wraps with `var(--x)`. Delete the opacity-as-grey hacks the tones replace.

**Phase 2 — affordance restoration (~1-2 days).** Hover fills on rows/menus/tabs; visible disabled states; destructive-action cue in thread menu; menu shadow; MobileGameCard tab emphasis made real; pinned OPEN row + zebra keylines in odds history; scrim decision (translucent now lawful, or solid + documented).

**Phase 3 — mint rationing (~1 day).** Strip mint from chrome: 5 card top-rails → quiet keylines; HR Model% column → white; Favorites tab → white w/ mint only when active; CONFIRMED pills → bordered white; chart gridlines → low-alpha; luminance-match loss-red. Acceptance test: on any card, the mint-est thing is the pick.

**Phase 4 — copy pass (~half day).** Adopt VOICE.md; fix the naming trio (log in / Dime Chat / Dime Credits); sentence-case sweep; exclamation/apology/vague-error sweep; em-dash-in-microcopy sweep; ErrorBoundary stack trace behind a toggle; landing eyebrow budget (one label per section: frame OR eyebrow, drop per-card pseudo-codes); 404 gets real destinations.

**Phase 5 — hygiene (~half day).** Delete dead components/rules/ternaries/no-op keyframes; fix stale comments; neutralize shadow utilities; scope GG Sans; drop Stripe Plex Mono; silence tab-bar logging; 0.5px → 1px; add missing `tabular-nums`.

**Phase 6 — guardrails.** Extend the law doc with v2 tables + full exception registry (team colors, loss-red, chart alpha, menu shadow, Discord brand row, scrims). Reconcile MASTER.md (mark superseded sections instead of contradicting). Add a CI grep gate: banned pairs (`text-white` + mint bg), banned values (`#39FF14`, purple families), `hsl(var(--`, em-dash in `client/src` UI strings. Re-run smoke + a contrast script over the token file.

---

## 12. Verification limits

Static audit: file-level reads + computed contrast + font inspection. Runtime rendering (halation severity, actual chart legibility, Stripe iframe behavior) was not re-verified in-browser because browser automation is blocked in this environment; recommend a LiveLab pass over Phases 1-3 before merge.
