# Trends Page v2 + Sidebar Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Branch: `claude/load-skills-repo-urklt7`, freshly restarted from `origin/main` at `2a6d7da` (PR #156 merged — this is a NEW change set; any PR opened for it is a new PR).

**Goal:** Four owner-directed refinements to the shipped Trends tab and shell sidebar: sidebar icons ×1.25 and text ×1.75, profile row hard-anchored to the sidebar bottom, Trends-page panels always expanded (never collapsible there), and each game's Last 5 Games + Trends rendered side-by-side in one row — plus a fix for the visible AM/PM time bug the owner's screenshot exposed ("6:40 AM ET" for an evening game).

**Architecture:** Sidebar sizing lives in `frozen-tokens.css` (D/L design-law tokens — owner directive overrides them; comments must record that) and `conversation.css` (≥1024 overrides, rail, profile), with icon sizes as `size={N}` props in `DimeChatPage.tsx`. The two panels (`RecentSchedulePanel`, `SituationalResultsPanel`) each own an internal `isExpanded` state gated by a header toggle button — they gain an optional `collapsible` prop (default `true`, all existing callers unchanged) that, when `false`, renders permanently expanded with a static header. `TrendsPage` swaps its stacked panel column for a two-column grid per game and replaces its three duplicated time/date helpers with the canonical `@/lib/gameUtils` implementations (whose 12-hour-input handling is exactly the missing piece behind the AM/PM bug). A new stubbed-tRPC Playwright spec (`e2e/trends-layout.spec.ts`) verifies the geometry, the always-expanded state, the sidebar scale, and the profile anchoring.

**Tech Stack:** React 18 + tRPC + CSS (frozen-tokens/conversation layers), Vitest source-contract + unit tests, Playwright with network-stubbed tRPC (pattern proven in `e2e/splits-layout.spec.ts`).

## Global Constraints

- Owner-directed multipliers are exact: **icons ×1.25** (`18 → 22.5`, `16 → 20`, `14 → 17.5`) and **text ×1.75** (`13px → 22.75px` nav rows/profile-row base, `11px → 19.25px` recents label & profile tier, `12px → 21px` profile name; ≥1024 profile overrides `15px → 26.25px` name, `12px → 21px` tier). Fractional px values are valid CSS/SVG — use them verbatim, do not round.
- "**Keep the profile section grounded at the bottom. Don't let it float.**" — the profile row must be bottom-anchored in every sidebar state (with recents, without recents, rail, drawer, any viewport height), not dependent on sibling flex fillers.
- "**neither of the Last 5 Games or the Trends should be collapsed … do not have any of them collapsed**" — on `/trends` both panels render permanently expanded with no collapse affordance. Splits-surface (mobile) usage of the same components is byte-for-byte unchanged.
- "**Make each game a one row side by side**" — per game: matchup header, then Last 5 Games (left) and Trends (right) in one two-column row at all Trends-page widths (≥768px; the page doesn't exist below that).
- Dime brand law (`design-system/dime-ai/MASTER.md`): mint `#45E0A8` sole accent, Familjen Grotesk + IBM Plex Mono, 160ms motion curve, no gradients/purple/neon-green/gold. No new colors/fonts/motion.
- Frozen design-law tokens being changed (D/L:21, D/L:41, D:54, D:64, D:73, D:75) must keep their D/L reference comments and gain an "owner directive 2026-07-21: ×1.75 / ×1.25 scale" annotation — the law is amended, not silently broken.
- Display-only: no server/tRPC/schema changes. TypeScript strict: `npx tsc --noEmit` passes after every task. Vitest via `test:gated:local` (no DB in the container). Never weaken `e2e/splits-layout.spec.ts`.

## File Structure

| File | Role in this plan |
|---|---|
| `client/src/pages/TrendsPage.tsx` | Modify — gameUtils imports (Task 1), two-up grid + always-open props (Task 3) |
| `client/src/pages/TrendsPage.test.ts` | Create (verified absent) — source-contract tests (Tasks 1, 3) |
| `client/src/components/RecentSchedulePanel.tsx` | Modify — `collapsible` prop (Task 2) |
| `client/src/components/SituationalResultsPanel.tsx` | Modify — `collapsible` prop (Task 2) |
| `client/src/components/collapsiblePanels.test.ts` | Create (verified absent) — prop contract tests (Task 2) |
| `client/src/pages/dime-chat/DimeChatPage.tsx` | Modify — sidebar icon `size` props (Task 4) |
| `client/src/pages/dime-chat/frozen-tokens.css` | Modify — base font sizes + icon width + sidebar width (Task 4) |
| `client/src/pages/dime-chat/conversation.css` | Modify — ≥1024 profile sizes (Task 4), profile anchoring (Task 5) |
| `e2e/trends-layout.spec.ts` | Create (verified absent) — geometry/scale/anchoring harness (Task 6) |
| `docs/evidence/2026-07-21-trends-v2/` | Created by Task 6 (screenshots) |

Pre-flight fact (verified this session): `client/src/pages/TrendsPage.test.ts`, `client/src/components/collapsiblePanels.test.ts`, and `e2e/trends-layout.spec.ts` do NOT exist yet. If an implementer finds otherwise, STOP and report — do not overwrite (the Task-1-round-1 lesson).

---

### Task 1: TrendsPage adopts canonical gameUtils (fixes the AM/PM bug)

**Files:**
- Modify: `client/src/pages/TrendsPage.tsx:24-60` (delete local helpers), `:15` (imports), `:93,168,191` (call sites)
- Test: `client/src/pages/TrendsPage.test.ts` (new)

**Why (reproduced defect):** the owner's 2026-07-21 screenshot shows "MINNESOTA TWINS @ CLEVELAND GUARDIANS **6:40 AM ET**" while the splits card for the same game shows **6:40 PM ET**. Root cause confirmed by inspection: the DB serves `startTimeEst` in 12-hour form (e.g. `"6:40 PM"`) for these rows; `client/src/lib/gameUtils.ts:13-34` (`formatGameTime`) handles both military and 12-hour inputs (GameCard uses it — hence splits is correct), while TrendsPage's local `formatTimeEt` (`TrendsPage.tsx:25-36`) parses `"6"` → AM. The local `timeToMinutes` (`:38-46`) has the same blindness, so a mixed AM/PM slate would also SORT wrongly (1:05 PM would sort before 11:35 AM). `formatDateHeader` is also duplicated verbatim from gameUtils.

**Interfaces:**
- Consumes: `formatGameTime`, `timeToMinutes`, `formatDateHeader` from `@/lib/gameUtils` (exact existing signatures, all `(s: string | null | undefined)`-tolerant).
- Produces: TrendsPage with zero local time/date helpers. Tasks 3/6 rely on this file's structure.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/TrendsPage.test.ts` (source-contract pattern, per `DimeAppShell.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatGameTime, timeToMinutes } from "../lib/gameUtils";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "TrendsPage.tsx"),
  "utf8"
);

describe("TrendsPage uses canonical gameUtils time handling", () => {
  it("imports the shared formatters instead of redefining them", () => {
    expect(src).toMatch(
      /import \{[^}]*formatGameTime[^}]*\} from ["']@\/lib\/gameUtils["']/
    );
    expect(src).not.toMatch(/function formatTimeEt/);
    expect(src).not.toMatch(/function timeToMinutes/);
    expect(src).not.toMatch(/function formatDateHeader/);
  });

  it("renders game times through formatGameTime", () => {
    expect(src).toMatch(/formatGameTime\(game\.startTimeEst\)/);
  });
});

describe("gameUtils handles the 12-hour DB form (the 6:40 AM bug)", () => {
  it("formats '6:40 PM' as PM, not AM", () => {
    expect(formatGameTime("6:40 PM")).toBe("6:40 PM ET");
  });
  it("still formats military time", () => {
    expect(formatGameTime("18:40")).toBe("6:40 PM ET");
  });
  it("sorts 11:35 AM before 1:05 PM", () => {
    expect(timeToMinutes("11:35 AM")).toBeLessThan(timeToMinutes("1:05 PM"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/pages/TrendsPage.test.ts`
Expected: FAIL — the source-contract describes fail (local functions exist, no gameUtils import). The three gameUtils unit tests should already PASS (they pin the behavior we're adopting; if any fails, STOP — the util itself is broken, escalate).

- [ ] **Step 3: Implement**

In `TrendsPage.tsx`: delete the three local helper functions (`formatTimeEt` lines 24-36, `timeToMinutes` lines 38-46, `formatDateHeader` lines 48-60); add to imports:

```ts
import { formatGameTime, timeToMinutes, formatDateHeader } from "@/lib/gameUtils";
```

Change the one render call site `formatTimeEt(game.startTimeEst)` → `formatGameTime(game.startTimeEst)`. The `timeToMinutes` and `formatDateHeader` call sites keep their names (now resolved from the import). Update the docblock's helper mention if present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/src/pages/TrendsPage.test.ts` → PASS (5 tests).
Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TrendsPage.tsx client/src/pages/TrendsPage.test.ts
git commit -m "fix(trends): use canonical gameUtils time formatting — 12-hour DB times rendered PM correctly"
```

---

### Task 2: Panels gain a `collapsible` prop (default true — existing callers unchanged)

**Files:**
- Modify: `client/src/components/RecentSchedulePanel.tsx` (props interface ~line 80-95; state ~line 621; header ~line 690-700)
- Modify: `client/src/components/SituationalResultsPanel.tsx` (props interface lines 67-82; equivalent state + header — same pattern, locate by `setIsExpanded`)
- Test: `client/src/components/collapsiblePanels.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: both panels accept `collapsible?: boolean` (default `true`). When `false`: content always rendered (expanded), header is a non-interactive label row (no chevron, no onClick, not a `<button>` — a `<div>`), `defaultCollapsed` is ignored. When `true`/omitted: behavior byte-for-byte as today. Task 3 passes `collapsible={false}`.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/collapsiblePanels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (f: string) =>
  fs.readFileSync(path.join(import.meta.dirname, f), "utf8");
const recent = read("RecentSchedulePanel.tsx");
const situational = read("SituationalResultsPanel.tsx");

describe.each([
  ["RecentSchedulePanel", recent],
  ["SituationalResultsPanel", situational],
])("%s collapsible contract", (_name, src) => {
  it("declares collapsible?: boolean defaulting to true", () => {
    expect(src).toMatch(/collapsible\?: boolean/);
    expect(src).toMatch(/collapsible = true/);
  });
  it("forces expanded when collapsible is false", () => {
    // Derived expansion: non-collapsible panels are always open.
    expect(src).toMatch(/collapsible \? \w+ : true/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/components/collapsiblePanels.test.ts`
Expected: FAIL (no `collapsible` prop exists in either file).

- [ ] **Step 3: Implement — same shape in BOTH panels**

Add to each props interface (next to `defaultCollapsed`):

```ts
  /** When false, the panel renders permanently expanded with a static
   *  (non-interactive) header — no chevron, no toggle. Default true keeps
   *  the existing accordion behavior for the splits surface. */
  collapsible?: boolean;
```

Destructure with `collapsible = true`. Rename the state variable and derive the effective value (RecentSchedulePanel shown; mirror in SituationalResultsPanel):

```ts
  const [expandedState, setIsExpanded] = useState(!defaultCollapsed);
  const isExpanded = collapsible ? expandedState : true;
```

Header: keep the existing `<button …>` markup for `collapsible` true; when false render the same inner content in a `<div>` with the identical classes minus interactivity, chevron, and cursor. Pattern:

```tsx
      {collapsible ? (
        <button type="button" onClick={() => setIsExpanded(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 transition-colors">
          {/* existing header inner JSX, incl. chevron */}
        </button>
      ) : (
        <div className="w-full flex items-center justify-between px-3 py-2">
          {/* same inner JSX WITHOUT the ChevronDown/ChevronUp element */}
        </div>
      )}
```

Extract the shared header-label JSX into a local variable if that avoids duplicating it (both branches render the label + fetching spinner; only the chevron and interactivity differ). No visual change for the default path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/src/components/collapsiblePanels.test.ts` → PASS (4 tests).
Run: `npx vitest run client/src/components/GameCard.splitsAccordions.test.ts` → still PASS (splits callers untouched).
Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RecentSchedulePanel.tsx client/src/components/SituationalResultsPanel.tsx client/src/components/collapsiblePanels.test.ts
git commit -m "feat(panels): optional collapsible=false renders Last 5 / Trends permanently expanded"
```

---

### Task 3: TrendsPage two-up layout, panels always open

**Files:**
- Modify: `client/src/pages/TrendsPage.tsx` (`TrendsGameSection`, lines ~70-126 post-Task-1)
- Test: extend `client/src/pages/TrendsPage.test.ts`

**Interfaces:**
- Consumes: `collapsible` prop (Task 2).
- Produces: per-game DOM = header div + `<div data-trends-game-row>` grid with exactly two `min-w-0` columns (Last 5 left, Trends right). Task 6 asserts on `[data-trends-game-row]`.

- [ ] **Step 1: Extend the test (failing first)**

Append to `TrendsPage.test.ts`:

```ts
describe("Trends page layout: always-open, side-by-side", () => {
  it("renders both panels non-collapsible and expanded", () => {
    const collapsibleFalse = src.match(/collapsible=\{false\}/g) ?? [];
    expect(collapsibleFalse).toHaveLength(2);
    expect(src).not.toMatch(/defaultCollapsed=\{true\}/);
  });
  it("lays each game out as one two-column row", () => {
    expect(src).toMatch(/data-trends-game-row/);
    expect(src).toMatch(/gridTemplateColumns: ["']repeat\(2, minmax\(0,1fr\)\)["']/);
  });
});
```

Run: `npx vitest run client/src/pages/TrendsPage.test.ts` → the two new tests FAIL.

- [ ] **Step 2: Implement the layout**

Replace `TrendsGameSection`'s return (keep the ref, the mapping guard, and the header row exactly as-is) so the two panels sit in a grid:

```tsx
  return (
    <div ref={rowRef} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      {/* Matchup header row — unchanged */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        {/* …existing header spans… */}
      </div>
      {/* One row per game: Last 5 Games | Trends, side by side. min-w-0
          columns so the panels' internal tables shrink instead of forcing
          horizontal overflow. */}
      <div
        data-trends-game-row
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
          alignItems: "start",
        }}
      >
        <div className="min-w-0">
          <RecentSchedulePanel
            {…existing props…}
            defaultCollapsed={false}
            collapsible={false}
          />
        </div>
        <div className="min-w-0">
          <SituationalResultsPanel
            {…existing props…}
            defaultCollapsed={false}
            collapsible={false}
          />
        </div>
      </div>
    </div>
  );
```

(`{…existing props…}` = the prop lists already in the file, verbatim — only `defaultCollapsed` flips to `false` and `collapsible={false}` is added.)

- [ ] **Step 3: Run tests**

`npx vitest run client/src/pages/TrendsPage.test.ts` → PASS (7 tests). `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Visual sanity (stub-free)**

Dev server + Chromium at 1440×900 on `/trends`: without DB the panels render their error/empty internals, but the two-column row structure and static (chevron-free) headers must be visible. Screenshot to `.superpowers/sdd/task-3-smoke.png`. Honest note if vacuous beyond structure.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TrendsPage.tsx client/src/pages/TrendsPage.test.ts
git commit -m "feat(trends): per-game side-by-side Last 5 | Trends, permanently expanded"
```

---

### Task 4: Sidebar scale — icons ×1.25, text ×1.75

**Files:**
- Modify: `client/src/pages/dime-chat/DimeChatPage.tsx` (icon `size` props: lines 434, 444, 446, 456, 490, 512, 532, 570, 583 — locate by code, numbers may drift)
- Modify: `client/src/pages/dime-chat/frozen-tokens.css:73` (row font), `:110-111` (icon width), `:149` (sidebar width), `:159` (recents label), `:166` (profile row), `:174` (profile name), `:177` (profile tier)
- Modify: `client/src/pages/dime-chat/conversation.css:885-888` (≥1024 profile overrides)

**Exact value table (owner multipliers, no rounding):**

| Token | Current | New |
|---|---|---|
| Nav/header icons `size={18}` (TextSearch, PanelLeftOpen/Close, RowIcon ×2) | 18 | 22.5 |
| Row-menu icon `size={16}` (Ellipsis) | 16 | 20 |
| Small icons `size={14}` (search glass, Eraser, Trash2) | 14 | 17.5 |
| `.dc-sidebar-icon` width (frozen-tokens:111, D/L:41) | 14px | 17.5px |
| `.dc-sidebar-row` font-size (frozen-tokens:73, D/L:21) | 13px | 22.75px |
| `.dc-recents-label` (frozen-tokens:159, D:64) | 11px | 19.25px |
| `.dc-profile-row` font-size (frozen-tokens:166, D:73) | 13px | 22.75px |
| `.dc-profile-name` (frozen-tokens:174, D:75) | 12px | 21px |
| `.dc-profile-tier` (frozen-tokens:177) | 11px | 19.25px |
| ≥1024 `.dc-profile-name` (conversation.css:887) | 15px | 26.25px |
| ≥1024 `.dc-profile-tier` (conversation.css:888) | 12px | 21px |

Every changed frozen-tokens line keeps its `/* D/L:NN */` comment and gains ` — owner directive 2026-07-21: text ×1.75 / icons ×1.25`.

**Sidebar width:** `.dc-sidebar { width: 264px }` (frozen-tokens:149). At 22.75px, "Betting Splits + Odds History" will ellipsize (D/L:40 forces nowrap+ellipsis). Truncated labels defeat the request, so widen to fit:

- [ ] **Step 1: Apply the value table** (all CSS lines + all `size={}` props). Do NOT touch the settings gear rotation, avatar sizes, or the 68px rail width (icons at 22.5 still fit its 68px column).

- [ ] **Step 2: Measure and set the sidebar width**

Dev server + Chromium at 1440×900, `/trends`: measure `scrollWidth` of the longest nav label span (`.dc-sidebar-text` containing "Betting Splits + Odds History") plus the row's icon+gap+padding (22.5 + 10 + 20) and the sidebar's own 28px horizontal padding. Set `.dc-sidebar` width to the measured total rounded UP to the next multiple of 8 (expected landing zone ≈ 400-432px). Record the measurement and chosen value in the commit body. Update the frozen-tokens:149 comment the same way.

- [ ] **Step 3: Regression check on sibling suites**

Run: `npx vitest run client/src/pages/dime-shell/DimeAppShell.test.ts` and `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/chat-resize.spec.ts e2e/drawer-reduced-motion.spec.ts` — if any assertion pins the old 264px width / 13px font / 18px icons, update it to the new values preserving intent, and list every edit in the report. Never delete a test.

- [ ] **Step 4: Verify + commit**

`npx tsc --noEmit` → PASS. Screenshot sidebar at 1440×900 → `.superpowers/sdd/task-4-smoke.png` — all six nav labels fully rendered, no ellipsis, icons visibly larger.

```bash
git add client/src/pages/dime-chat/DimeChatPage.tsx client/src/pages/dime-chat/frozen-tokens.css client/src/pages/dime-chat/conversation.css
git commit -m "feat(sidebar): icons x1.25, text x1.75, width refit (owner directive 2026-07-21)"
```

---

### Task 5: Profile row hard-anchored to the sidebar bottom

**Files:**
- Modify: `client/src/pages/dime-chat/conversation.css` (app-adaptation layer — do NOT edit the frozen `.dc-profile-row` rule in frozen-tokens.css for this)

**Current mechanism (fragile):** pinning depends on siblings — `.dc-recent-list` flex-fill when recents exist, `.dc-sidebar-spacer { flex: 1 }` when they don't (conversation.css:32-33). Any state where neither fills (e.g. transitional render, drawer variant) lets the profile float up. The rail already uses the robust pattern: `.dc-sidebar--rail .dc-profile-row { margin-top: auto; }` (conversation.css:909-914).

- [ ] **Step 1: Generalize the rail's anchor**

Add to conversation.css (near the spacer comment block, with a comment noting it subsumes the spacer/flex-fill dependency):

```css
/* Owner directive 2026-07-21: the profile row is grounded to the sidebar
   foot in EVERY state — not dependent on .dc-recent-list flex-fill or
   .dc-sidebar-spacer being present. margin-top:auto on a flex-column child
   is state-independent; the spacer/flex-fill remain for scroll behavior. */
.dc-profile-row { margin-top: auto; }
```

Note: frozen-tokens:166 sets `margin-top: 8px` on the same selector — this override must WIN. It does: `conversation.css` is imported after `frozen-tokens.css` (`DimeChatPage.tsx:88-89`), same specificity, later wins. `margin-top: auto` replaces the `8px` entirely; the row's own `padding: 10px 8px` + `border-top` keep the visual separation.

- [ ] **Step 2: Verify across states**

Dev server + Chromium: (a) 1440×900 `/trends` no recents — profile bottom-flush; (b) same with a tall window (1440×1400) — still bottom-flush; (c) rail mode (collapse the sidebar via the PanelLeftClose control) — unchanged; (d) 800×600 short viewport — recents clip, profile stays visible at foot. Screenshots → `.superpowers/sdd/task-5-smoke-{a,b,c,d}.png`.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/dime-chat/conversation.css
git commit -m "fix(sidebar): ground profile row with margin-top:auto in every state"
```

---

### Task 6: Trends layout + sidebar harness (`e2e/trends-layout.spec.ts`)

**Files:**
- Create: `e2e/trends-layout.spec.ts` (verified absent)
- Evidence: `docs/evidence/2026-07-21-trends-v2/`

**Stubbing:** copy the envelope/batch pattern from `e2e/splits-layout.spec.ts` (same `stubApi` shape). Procedures to stub with fixtures: `appUsers.me` (STUB_USER), `games.getCurrentDate`, `games.getAvailableDates`, `games.list` (TWO games with 12-hour times `"11:35 AM"` and `"6:40 PM"` — this pins Task 1's sort+format fix at the UI level), `mlbSchedule.getLast5ForMatchup` (`{ awayLast5: [...], homeLast5: [...] }`), `mlbSchedule.getH2HGames` (`{ games: [...] }`), `mlbSchedule.getSituationalStats` (full `SituationalStats` shape from `SituationalResultsPanel.tsx:39-65` — `ml/spread/total` each with `overall/last10/home/away/favorite/underdog` records + `gamesAnalyzed`). Confirm exact response field shapes against the server routers (`server/routers/mlbSchedule.ts`) BEFORE finalizing fixtures; iterate until both panels render real content (a page that never renders is not a valid pass/fail — same rule as the splits harness).

**Contracts, at widths [768, 1024, 1440, 1920] on `/trends`:**
1. Every `[data-trends-game-row]` contains exactly 2 visible panel columns whose bounding boxes overlap vertically and do not overlap horizontally (left.right ≤ right.left), i.e. genuinely side-by-side.
2. Both panels expanded: each panel's content region (e.g. the Last-5 table rows / the Trends record bars) is visible; NO chevron toggle exists inside `[data-trends-game-row]` (assert `locator('[data-trends-game-row] svg.lucide-chevron-down, [data-trends-game-row] svg.lucide-chevron-up')` count = 0 — adjust selector to what lucide actually renders, verified in-browser).
3. Games render in true chronological order: the "11:35 AM" matchup's row appears above the "6:40 PM" one, and the rendered time strings contain "AM"/"PM" correctly.
4. No horizontal page overflow (`scrollWidth ≤ clientWidth + 1`) and no element right-edge past the viewport (reuse the splits-harness walk).
5. Sidebar (≥1024 where the persistent sidebar shows): computed `font-size` of a `.dc-sidebar-row` is `22.75px`; the "Trends" nav icon's bounding box width ≥ 22; the longest label ("Betting Splits + Odds History") is NOT truncated (`span.scrollWidth ≤ span.clientWidth`); the profile row's bottom edge is within 2px of the sidebar's bottom edge.
6. Screenshots per width → `docs/evidence/2026-07-21-trends-v2/trends-{width}.png` + one sidebar close-up.

- [ ] **Step 1: Write the spec** (structure mirrors `e2e/splits-layout.spec.ts`: `for (const width of WIDTHS) test(...)`, `stubApi`, evidence dir `fs.mkdirSync` in `beforeAll`).
- [ ] **Step 2: Run it** — `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/trends-layout.spec.ts`. Tasks 1-5 are already implemented, so this spec is written GREEN-expected; if any contract fails, that is a real defect in Tasks 1-5 — fix forward in the owning file (report which), never weaken the assertion.
- [ ] **Step 3: Full adjacent regression** — `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test` (all specs) + `npx vitest run client/src/pages/TrendsPage.test.ts client/src/components/collapsiblePanels.test.ts client/src/components/GameCard.splitsAccordions.test.ts client/src/pages/dime-shell/productRoute.test.ts` + `npx tsc --noEmit`.
- [ ] **Step 4: Commit**

```bash
git add e2e/trends-layout.spec.ts docs/evidence/2026-07-21-trends-v2
git commit -m "test(trends): layout harness — side-by-side rows, always-open panels, sidebar scale, grounded profile"
```

---

### Task 7: Full verification + visual pass + push

- [ ] **Step 1:** `npx tsc --noEmit`; `test:gated:local` flow (env-gate verdict must be ok); full `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test` (known pre-existing failure: mobile-floating-nav "owner-only Bet Tracker" — unchanged expectation; anything else red = stop and fix).
- [ ] **Step 2:** Brand-law visual pass on the Task 6 evidence + fresh 768/1024/1440 shots of `/trends` and the sidebar: mint-only accent; no new colors; half-width panel internals legible (tables not colliding — if a panel's internal table is unusably cramped at 768, capture it and REPORT as a checkpoint decision rather than silently changing the layout); `npm run build && npm run check:bundle` — within budget.
- [ ] **Step 3:** Push: `git push -u origin claude/load-skills-repo-urklt7` (retry w/ backoff per repo rules). PR creation only on explicit instruction (finishing-a-development-branch presents the options; note PR #156 is merged — any new PR is a NEW one).

---

## Risks / Unknowns

1. **Half-width panel internals at 768-1023px.** Both panels were designed full-width; at ~50% width their tables (GAME/OPP/RESULT/ATS/O/U; record bars) compress. `minmax(0,1fr)` + `min-w-0` prevents overflow, but legibility at 768px is unproven. The plan keeps side-by-side at ALL ≥768 widths per the owner's words; Task 7 Step 2 captures the 768px reality and escalates as a checkpoint if unusable (contingency if the owner agrees: stack below 1024px only).
2. **22.75px nav text needs a wider sidebar.** The 264px frozen width will ellipsize long labels; Task 4 widens by measurement (~400-432px expected). This shrinks the content pane at 1024-1279px — the splits harness (`e2e/splits-layout.spec.ts`) runs viewport-wide with its own stub and doesn't include the sidebar, so it stays green, but the REAL splits pane gets narrower at those widths; Task 7's visual pass must eyeball splits at 1024px with the new sidebar. If the market columns get too tight, that's a checkpoint report, not a silent revert.
3. **Frozen design law.** D/L tokens are being amended under owner directive; `e2e/chat-resize.spec.ts`, `drawer-reduced-motion.spec.ts`, and `DimeAppShell.test.ts` may pin old values — Task 4 Step 3 sweeps and updates with intent preserved.
4. **mlbSchedule fixture shapes** are read from panel/router sources during Task 6; response envelope quirks (superjson dates etc.) may need an iteration loop — same as the splits harness's authorized adaptation.
5. **Always-open panels multiply initial queries** (2 games visible ≈ 6 queries immediately; more as you scroll). `useVisibility` gating still defers offscreen games; accepted, same net load as a user expanding everything manually.
6. **`margin-top: auto` override vs frozen `margin-top: 8px`** relies on stylesheet order (frozen-tokens imported before conversation.css in `DimeChatPage.tsx:88-89` — verified). If a bundler reorders, the anchor silently loses; Task 6's contract 5 (profile-bottom assertion) is the net.

## Explicitly Out of Scope

- Any `<768px` change (mobile splits accordions keep `collapsible` default true; floating nav untouched).
- "Prop Projections" sidebar row (still frozen `href="#"`).
- Panel internal redesign beyond what the `collapsible` prop requires (no table restyling, no new columns).
- NBA/NHL trends; server/routers; schema (no `db-push.yml`).
- Chat surface, splits market-grid geometry (locked by the existing harness), light-theme reference pages.
- Avatar image sizes and the 68px rail width (icons scale inside them; the owner asked for icon/text scale, not chrome dimensions — except the sidebar width, which text scale forces).

## Execution Notes

- Task order: 1 → 2 → 3 are a dependency chain (page must compile against the new prop). 4 and 5 are independent of 1-3 and of each other; they may run as a parallel track (different files: dime-chat CSS/TSX vs components/pages), but land sequentially to keep review packages clean. 6 requires 1-5. 7 last.
- Sequential dispatch recommended (the two tracks share `conversation.css` risk-adjacency in Tasks 4/5 — same file; do NOT parallelize 4 and 5).
- Worktree/branch: already restarted from `origin/main` (`2a6d7da`); superpowers:using-git-worktrees satisfied by the container's isolated checkout.
- Per-task verification supervision + final whole-branch review per superpowers:subagent-driven-development; superpowers:verification-before-completion before any "done" claim.
