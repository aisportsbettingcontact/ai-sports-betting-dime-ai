# Trends Tab + Splits Layout Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Create the working branch/worktree via superpowers:using-git-worktrees before Task 1.

**Goal:** On desktop and tablet (≥768px), move the per-game "Last 5 Games" and "Trends" accordions off the Betting Splits surface into a real sidebar **Trends** tab, and fix the splits table layout so populated data always fits the viewport and never paints across the SPREAD | TOTAL | MONEYLINE section dividers.

**Architecture:** The Dime shell (`DimeAppShell`) owns four panes today (`chat | feed | splits | tracker`); the sidebar "Trends" row is a frozen dead link (`href="#"`, `DimeChatPage.tsx:111`). We add a fifth pane `trends` with a new `TrendsPage` that lists the day's MLB games and hosts the two existing panels (`RecentSchedulePanel` = "LAST 5 GAMES", `SituationalResultsPanel` = "TRENDS") unchanged. `GameCard` stops rendering those two panels in splits mode at ≥768px (mobile keeps them). The splits layout bugs are fixed in `BettingSplitsPanel`'s ≥md branch by replacing the flex row + 1px divider *children* with a 5-track CSS grid (`minmax(0,1fr) 1px minmax(0,1fr) 1px minmax(0,1fr)`) so no content can cross a divider track, plus gutter floors and min-width guards; a Playwright harness with stubbed tRPC reproduces the cut-off first and becomes the permanent regression net.

**Tech Stack:** React 18 + wouter + tRPC + Tailwind/inline styles, Vitest (source-contract + unit tests), Playwright e2e (vite dev server, network-stubbed tRPC, Chromium at `PW_CHROMIUM_PATH`).

## Global Constraints

- **"DESKTOP AND TABLET ONLY"** — every behavior change in this plan is gated to ≥768px (`DIME_SHELL_MIN_WIDTH_PX`, the Dime shell boundary). Mobile (<768px) behavior is byte-for-byte unchanged: accordions stay on the splits cards, the bottom floating nav is untouched.
- **"make sure that the splits tables are not cutting over the sections"** — no label, bar, or pill may paint across a SPREAD/TOTAL/MONEYLINE divider; enforced by the Task 5 harness.
- **"fit the screen to scale"** — the splits surface must produce zero horizontal page overflow at every supported width ≥768px; the rightmost moneyline label (e.g. `CLE (-150)`) must render fully.
- Dime brand law (`design-system/dime-ai/MASTER.md`) beats all skill suggestions: one-accent mint `#45E0A8`, Familjen Grotesk + IBM Plex Mono, 160ms motion, no gradients/purple/neon-green/gold. This plan adds **no** new colors, fonts, or motion.
- Backend data contracts (`design-system/dime-ai/pages/ai-model-projections.md`, `dime-ai/DIME-FEED-MIGRATION-DRAFT.md`) are untouched — every change here is display-only; no server/tRPC/schema edits.
- TypeScript strict: `npx tsc --noEmit` must pass after every task.
- Vitest DB-dependent tests fail without secrets — use `pnpm test:gated:local` locally; only the tests this plan adds/edits must be green.
- Never commit secrets. No changes to marketing surfaces (responsible-gaming language not in scope of any touched file).

## File Structure

| File | Role in this plan |
|---|---|
| `client/src/pages/dime-shell/productRoute.ts` | Modify — add `trends` pane + `/trends` classification |
| `client/src/pages/dime-shell/productRoute.test.ts` | Create — unit tests for the new route |
| `client/src/pages/TrendsPage.tsx` | Create — the new pane surface (game list + the two panels) |
| `client/src/pages/dime-shell/DimeAppShell.tsx` | Modify — lazy import, `PANE_HEADINGS`, `paneContent` branch |
| `client/src/pages/dime-chat/DimeChatPage.tsx` | Modify — `NAV_ROWS` Trends row gets `pane`+`href` |
| `client/src/App.tsx` | Modify — `<768px` fallback: `/trends` → redirect to splits |
| `client/src/components/GameCard.tsx` | Modify — gate the two accordions to `<768px` in splits mode |
| `client/src/components/GameCard.splitsAccordions.test.ts` | Create — source-contract test for the gating |
| `client/src/components/BettingSplitsPanel.tsx` | Modify — ≥md layout: grid tracks, gutters, divider attributes |
| `e2e/splits-layout.spec.ts` | Create — overflow/divider regression harness + evidence screenshots |
| `docs/evidence/2026-07-21-splits-layout/` | Created by the e2e spec (screenshots) |

---

### Task 1: `trends` pane in the product route classifier

**Files:**
- Modify: `client/src/pages/dime-shell/productRoute.ts:1-50`
- Test: `client/src/pages/dime-shell/productRoute.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DimeProductPane` union now includes `"trends"`; `parseDimeProductRoute("/trends")` returns `{ pane: "trends" }`. Tasks 2–4 rely on the exact string `"trends"`.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/dime-shell/productRoute.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isChatLocation,
  isDimeProductLocation,
  parseDimeProductRoute,
} from "./productRoute";

describe("trends pane routing", () => {
  it("classifies /trends as the trends pane", () => {
    expect(parseDimeProductRoute("/trends")).toEqual({ pane: "trends" });
  });

  it("strips query and hash before classifying", () => {
    expect(parseDimeProductRoute("/trends?x=1#frag")).toEqual({
      pane: "trends",
    });
  });

  it("is shell-owned but never chat", () => {
    expect(isDimeProductLocation("/trends")).toBe(true);
    expect(isChatLocation("/trends")).toBe(false);
  });

  it("does not classify sub-paths — /trends has no sport/date segments", () => {
    expect(parseDimeProductRoute("/trends/mlb")).toBeNull();
  });

  it("leaves the existing panes untouched", () => {
    expect(parseDimeProductRoute("/chat")).toEqual({ pane: "chat" });
    expect(parseDimeProductRoute("/bet-tracker")).toEqual({ pane: "tracker" });
    expect(parseDimeProductRoute("/betting-splits")).toEqual({
      pane: "splits",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/pages/dime-shell/productRoute.test.ts`
Expected: FAIL — `parseDimeProductRoute("/trends")` returns `null`, not `{ pane: "trends" }`.

- [ ] **Step 3: Implement the route**

In `client/src/pages/dime-shell/productRoute.ts`, change the union types and add one classification line:

```ts
export type DimeProductPane = "chat" | "feed" | "splits" | "trends" | "tracker";

export type DimeProductRoute =
  | { pane: "chat" }
  | { pane: "trends" }
  | { pane: "tracker" }
  | { pane: "feed"; sportSegment: string; dateSegment?: string }
  | { pane: "splits"; sportSegment?: string; dateSegment?: string };
```

Inside `parseDimeProductRoute`, directly after the `/bet-tracker` line:

```ts
  if (pathname === "/bet-tracker") return { pane: "tracker" };
  if (pathname === "/trends") return { pane: "trends" };
```

Also update the doc comment above `parseDimeProductRoute` ("Classifies only the four authenticated product surfaces" → "five").

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/pages/dime-shell/productRoute.test.ts`
Expected: PASS (5 tests).

Run: `npx tsc --noEmit`
Expected: **errors** in `DimeAppShell.tsx` — `PANE_HEADINGS` is `Record<DimeProductPane, string>` and now misses `trends`. That is the exhaustiveness check working; Task 3 clears it. Do NOT commit yet if you want a green tree per commit — instead add the one-line heading now as part of this task's commit:

In `client/src/pages/dime-shell/DimeAppShell.tsx`:

```ts
const PANE_HEADINGS: Record<DimeProductPane, string> = {
  chat: "Dime Chat",
  feed: "AI Model Projections",
  splits: "Betting Splits and Odds History",
  trends: "Trends",
  tracker: "Bet Tracker",
};
```

Re-run: `npx tsc --noEmit` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dime-shell/productRoute.ts client/src/pages/dime-shell/productRoute.test.ts client/src/pages/dime-shell/DimeAppShell.tsx
git commit -m "feat(shell): classify /trends as a fifth product pane"
```

---

### Task 2: TrendsPage component

**Files:**
- Create: `client/src/pages/TrendsPage.tsx`

**Interfaces:**
- Consumes: `trpc.games.list` / `trpc.games.getAvailableDates` / `trpc.games.getCurrentDate` (existing public procedures, same as `BettingSplits.tsx`); `RecentSchedulePanel` and `SituationalResultsPanel` with their existing props (`sport, enabled, awaySlug, homeSlug, awayAbbr, homeAbbr, awayName, homeName, awayLogoUrl, homeLogoUrl, borderColor, defaultCollapsed`); `MLB_BY_ABBREV` from `@shared/mlbTeams` (fields used: `anSlug, abbrev, name, logoUrl` — same fields GameCard already reads); `useVisibility` hook (`const [ref, isVisible] = useVisibility({ rootMargin: "200px" })`).
- Produces: `export default function TrendsPage(): JSX.Element` — no props. Task 3 lazy-imports it.

- [ ] **Step 1: Write the component**

Create `client/src/pages/TrendsPage.tsx`:

```tsx
/**
 * TrendsPage — desktop/tablet shell pane for per-game research panels.
 *
 * Hosts LAST 5 GAMES (RecentSchedulePanel) and TRENDS
 * (SituationalResultsPanel) — the two accordions that used to render under
 * every Betting Splits card at ≥768px. Mobile (<768px) keeps those accordions
 * on the splits surface; App.tsx redirects /trends to /betting-splits below
 * the shell boundary.
 *
 * MLB only: the NBA/NHL schedule DBs are not backfilled — the same gate
 * GameCard applied to these panels (game.sport === 'MLB' && anSlug present).
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import { RecentSchedulePanel } from "@/components/RecentSchedulePanel";
import { SituationalResultsPanel } from "@/components/SituationalResultsPanel";
import { useVisibility } from "@/hooks/useVisibility";
import { trpc } from "@/lib/trpc";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

/** Same display form the splits surface uses ("7:07 PM ET"). */
function formatTimeEt(time: string | null | undefined): string {
  if (!time) return "TBD";
  const upper = time.trim().toUpperCase();
  if (upper === "TBD" || upper === "TBA" || upper === "") return "TBD";
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return "TBD";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix} ET`;
}

function timeToMinutes(time: string | null | undefined): number {
  if (!time || time.toUpperCase() === "TBD" || time.toUpperCase() === "TBA")
    return 9999;
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return 9999;
  return h * 60 + m;
}

function formatDateHeader(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Minimal structural slice of a games.list row this page reads. */
interface TrendsGameRow {
  id: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
}

function TrendsGameSection({ game }: { game: TrendsGameRow }) {
  const [rowRef, isVisible] = useVisibility({ rootMargin: "200px" });
  const awayMlb = MLB_BY_ABBREV.get(game.awayTeam) ?? null;
  const homeMlb = MLB_BY_ABBREV.get(game.homeTeam) ?? null;
  if (!awayMlb?.anSlug || !homeMlb?.anSlug) return null;
  return (
    <div ref={rowRef} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      {/* Matchup header row */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span
          className="font-bold uppercase"
          style={{ fontSize: 13, color: "#FFFFFF", letterSpacing: "0.08em" }}
        >
          {awayMlb.name} @ {homeMlb.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#FFFFFF",
            fontFamily: "var(--dime-font-mono)",
            letterSpacing: "0.08em",
          }}
        >
          {formatTimeEt(game.startTimeEst)}
        </span>
      </div>
      <RecentSchedulePanel
        sport="MLB"
        enabled={isVisible}
        awaySlug={awayMlb.anSlug}
        homeSlug={homeMlb.anSlug}
        awayAbbr={awayMlb.abbrev}
        homeAbbr={homeMlb.abbrev}
        awayName={awayMlb.name}
        homeName={homeMlb.name}
        awayLogoUrl={awayMlb.logoUrl}
        homeLogoUrl={homeMlb.logoUrl}
        borderColor="hsl(var(--border))"
        defaultCollapsed={true}
      />
      <SituationalResultsPanel
        sport="MLB"
        enabled={isVisible}
        awaySlug={awayMlb.anSlug}
        homeSlug={homeMlb.anSlug}
        awayAbbr={awayMlb.abbrev}
        homeAbbr={homeMlb.abbrev}
        awayName={awayMlb.name}
        homeName={homeMlb.name}
        awayLogoUrl={awayMlb.logoUrl}
        homeLogoUrl={homeMlb.logoUrl}
        borderColor="hsl(var(--border))"
        defaultCollapsed={true}
      />
    </div>
  );
}

export default function TrendsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(todayUTC());

  const { data: serverDateData } = trpc.games.getCurrentDate.useQuery(
    undefined,
    { refetchInterval: 60 * 1000, staleTime: 30 * 1000 }
  );
  const { data: availableDatesData } = trpc.games.getAvailableDates.useQuery(
    { sport: "MLB" },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const { data: games, isLoading } = trpc.games.list.useQuery(
    { sport: "MLB", gameDate: selectedDate },
    { refetchOnWindowFocus: false, staleTime: 60 * 1000 }
  );

  const sortedGames = useMemo(
    () =>
      [...(games ?? [])]
        .filter((g): g is NonNullable<typeof g> => g != null)
        .sort(
          (a, b) =>
            timeToMinutes(a.startTimeEst) - timeToMinutes(b.startTimeEst)
        ),
    [games]
  );

  return (
    <div className="bg-background">
      <header className="sticky top-0 z-40 bg-background">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <CalendarPicker
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            availableDates={new Set(availableDatesData?.dates ?? [])}
          />
        </div>
        <div className="flex items-center justify-center px-4 py-1 border-b border-border">
          <span
            className="font-bold tracking-widest uppercase"
            style={{ fontSize: "clamp(11px, 1.2vw, 19px)", color: "#FFFFFF" }}
          >
            {formatDateHeader(serverDateData?.effectiveDate ?? selectedDate)}
            {" · MLB TRENDS"}
          </span>
        </div>
      </header>
      <main className="w-full pb-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: "#45E0A8" }}
            />
            <p className="text-sm text-muted-foreground">Loading trends…</p>
          </div>
        ) : sortedGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <p className="text-sm font-semibold text-foreground mb-1">
              No MLB games found
            </p>
            <p className="text-xs text-muted-foreground">
              Last 5 Games and Trends cover MLB matchups. Pick another date.
            </p>
          </div>
        ) : (
          sortedGames.map(g => <TrendsGameSection key={g.id} game={g} />)
        )}
      </main>
    </div>
  );
}
```

**Adjustment rule while implementing:** the exact prop names on `CalendarPicker` (`selectedDate/onSelect/availableDates`) and the `MLB_BY_ABBREV` entry fields (`anSlug/abbrev/name/logoUrl`) must be confirmed against their source files (`client/src/components/CalendarPicker.tsx`, `shared/mlbTeams.ts`) — they are used exactly as `BettingSplits.tsx:816-821` and `GameCard.tsx:2302,3554-3583` use them today. If a name differs, follow the existing call sites; do not invent new props.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If `RecentSchedulePanel`/`SituationalResultsPanel` are default exports instead of named, fix the import form to match `GameCard.tsx`'s imports of the same components.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/TrendsPage.tsx
git commit -m "feat(trends): add TrendsPage pane surface (MLB Last 5 Games + Trends per game)"
```

---

### Task 3: Wire the pane — shell, sidebar, mobile fallback

**Files:**
- Modify: `client/src/pages/dime-shell/DimeAppShell.tsx:23-25,139-169`
- Modify: `client/src/pages/dime-chat/DimeChatPage.tsx:111`
- Modify: `client/src/App.tsx` (legacy `<Switch>` block, near the `/betting-splits` routes at lines ~304-315)

**Interfaces:**
- Consumes: `TrendsPage` default export (Task 2), pane string `"trends"` (Task 1).
- Produces: sidebar navigation to `/trends`; shell renders `<TrendsPage />`; `<768px` `/trends` redirects to `bettingSplitsPath()`.

- [ ] **Step 1: Shell — lazy import + pane branch**

In `DimeAppShell.tsx`, next to the other lazy panes:

```ts
const DimeModelFeed = lazy(() => import("../DimeModelFeed"));
const BettingSplits = lazy(() => import("../BettingSplits"));
const BetTracker = lazy(() => import("../BetTracker"));
const TrendsPage = lazy(() => import("../TrendsPage"));
```

In the `paneContent` chain, before the `tracker` branch:

```tsx
    } else if (renderedRoute.pane === "trends") {
      paneContent = <TrendsPage />;
    } else if (renderedRoute.pane === "tracker") {
      paneContent = <BetTracker previewMode={previewMode} />;
    }
```

- [ ] **Step 2: Sidebar — activate the frozen row**

In `DimeChatPage.tsx` `NAV_ROWS`, replace line 111:

```ts
  { label: "Trends", pane: "trends", href: () => "/trends", icon: ChartSpline }, // D/L:60 — route live 2026-07-21 (owner directive): hosts Last 5 Games + Trends at ≥768px
```

Leave "Prop Projections" (line 112) frozen — out of scope.

- [ ] **Step 3: Mobile fallback route**

In `App.tsx`, inside the legacy `<Switch>` (place next to the `/betting-splits` routes). At ≥768px the shell claims `/trends` before the Switch is reached (`chatShellOwnsRoute`); below 768px this route renders:

```tsx
        {/* /trends is a shell-owned (≥768px) surface. Below the shell
            boundary there is no Trends pane — the accordions still live on
            the splits cards — so land mobile visitors there. */}
        <Route path="/trends">{() => <Redirect to={bettingSplitsPath()} />}</Route>
```

`Redirect` and `bettingSplitsPath` are already imported in `App.tsx` (used by the `/splits` legacy redirects); if not, extend the existing `wouter` / `@/lib/feedRoutes` import lines.

- [ ] **Step 4: Check the source-contract suite**

Run: `npx vitest run client/src/pages/dime-shell/DimeAppShell.test.ts`
Expected: PASS. This suite regex-asserts shell ownership shapes, not the pane list — but read any failure carefully: if an assertion enumerates panes or NAV rows, update the assertion to include `trends` *and* keep its original intent (the frozen-copy law for D/L rows 57-62 changes only for row 60, by owner directive in this task's spec).

Also run: `npx vitest run client/src/lib/feedRoutes.test.ts` → Expected: PASS (untouched).

- [ ] **Step 5: Manual smoke (dev server)**

Run: `node node_modules/vite/bin/vite.js dev --port 5199 --strictPort` (background), then with Playwright/Chromium or a browser:
- At 1280×800, `http://localhost:5199/trends` → shell renders, sidebar "Trends" row highlighted (`is-active`), heading "Trends", MLB game list (or empty state without DB).
- At 500×900, `http://localhost:5199/trends` → redirected to `/betting-splits/mlb-…`.

Expected: both behaviors observed. Kill the dev server.

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → Expected: PASS.

```bash
git add client/src/pages/dime-shell/DimeAppShell.tsx client/src/pages/dime-chat/DimeChatPage.tsx client/src/App.tsx
git commit -m "feat(trends): wire Trends pane — sidebar row, shell branch, <768px redirect"
```

---

### Task 4: Splits surface — accordions move out at ≥768px

**Files:**
- Modify: `client/src/components/GameCard.tsx:36 (imports), ~2216 (hooks), 3554 (gating)`
- Test: `client/src/components/GameCard.splitsAccordions.test.ts` (new)

**Interfaces:**
- Consumes: `useIsMdUp()` from `@/hooks/useIsMdUp` (existing singleton hook, returns `boolean`, ≥768px).
- Produces: in splits mode, `RecentSchedulePanel` + `SituationalResultsPanel` render only below 768px. The `OddsHistoryPanel` block (`GameCard.tsx:3528`) is **not** touched — "ODDS & SPLITS HISTORY" stays on the splits surface at every width.

- [ ] **Step 1: Write the failing source-contract test**

Create `client/src/components/GameCard.splitsAccordions.test.ts` (same pattern as `DimeAppShell.test.ts` — reads source, no DOM):

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "GameCard.tsx"),
  "utf8"
);

describe("splits-surface accordion gating (moved to Trends tab at ≥768px)", () => {
  it("imports the shared shell-boundary hook", () => {
    expect(src).toMatch(
      /import \{ useIsMdUp \} from ["']@\/hooks\/useIsMdUp["']/
    );
  });

  it("renders Last 5 Games + Trends only below the shell boundary in splits mode", () => {
    // The gate: (mode === 'splits' && !isMdUp) || mobileTab === 'splits'
    expect(src).toMatch(
      /\(\(mode === 'splits' && !isMdUp\) \|\| mobileTab === 'splits'\)[\s\S]{0,160}game\.sport === 'MLB'/
    );
  });

  it("keeps ODDS & SPLITS HISTORY on the splits surface at every width", () => {
    expect(src).toMatch(
      /\(mode === 'splits' \|\| mobileTab === 'splits'\) && isCardVisible && game\.id != null/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/components/GameCard.splitsAccordions.test.ts`
Expected: FAIL on the first two assertions (no `useIsMdUp` import, old gate).

- [ ] **Step 3: Implement the gate**

In `GameCard.tsx`:

Add the import next to `useVisibility` (line ~36):

```ts
import { useIsMdUp } from "@/hooks/useIsMdUp";
```

In `GameCardInner`, with the other hooks (directly after `const [cardRef, isCardVisible] = useVisibility({ rootMargin: "200px" });` at ~2216 — unconditional, Rules of Hooks):

```ts
  // ≥768px: Last 5 Games + Trends live on the Trends pane, not under each
  // splits card. <768px keeps the accordions (mobile has no Trends surface).
  const isMdUp = useIsMdUp();
```

Change line 3554's condition **only** (the `RecentSchedulePanel`/`SituationalResultsPanel` block; do not touch line 3528's `OddsHistoryPanel` condition):

```tsx
      {((mode === 'splits' && !isMdUp) || mobileTab === 'splits') && isCardVisible && game.sport === 'MLB' && awayMlb?.anSlug && homeMlb?.anSlug && (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/src/components/GameCard.splitsAccordions.test.ts`
Expected: PASS (3 tests).

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Visual smoke**

Dev server + Chromium at 1280×800 on `/betting-splits/mlb-<today>`: each card shows only the "ODDS & SPLITS HISTORY" accordion below the body — no "LAST 5 GAMES", no "TRENDS". At 500×900 all three accordions still render.
Expected: exactly that.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/GameCard.tsx client/src/components/GameCard.splitsAccordions.test.ts
git commit -m "feat(splits): move Last 5 Games + Trends off splits cards at >=768px"
```

---

### Task 5: Splits layout regression harness (write it failing)

**Files:**
- Modify: `client/src/components/BettingSplitsPanel.tsx:749,757` (instrument dividers only)
- Create: `e2e/splits-layout.spec.ts`

**Interfaces:**
- Consumes: the e2e stubbing pattern from `e2e/mobile-floating-nav.spec.ts` (vite dev server on 5199, `page.route("**/api/trpc/**")`, batch-aware responses `{ result: { data: { json: X } } }`); `[data-market-col]` already emitted by `MarketBlock` (`BettingSplitsPanel.tsx:557`).
- Produces: `[data-splits-divider]` attributes on the two section dividers (Task 6 keeps them on the replacement grid tracks); evidence screenshots in `docs/evidence/2026-07-21-splits-layout/`.

- [ ] **Step 1: Instrument the dividers (attribute-only, no behavior change)**

In `BettingSplitsPanel.tsx`, both ≥md divider divs (lines 749 and 757) get a data attribute:

```tsx
        <div data-splits-divider style={{ width: 1, background: "#ffffff", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
```

- [ ] **Step 2: Write the spec**

Create `e2e/splits-layout.spec.ts`:

```ts
/**
 * Splits layout — desktop/tablet overflow + divider-crossing contract
 * ═══════════════════════════════════════════════════════════════════
 * Reproduces the 2026-07-21 owner report: at wide viewports the moneyline
 * labels ("CLE (-150)", "TOR (-108)") were cut at the right screen edge and
 * splits content sat flush against / across the SPREAD|TOTAL|MONEYLINE
 * dividers. Runs against the vite dev server with every tRPC procedure
 * stubbed (no DB) — one fixture game with worst-case-width labels.
 *
 * Contracts, at each width in WIDTHS:
 *   1. Zero horizontal page overflow (scrollWidth ≤ clientWidth + 1).
 *   2. Every splits label's right edge ≤ viewport right edge.
 *   3. Every splits label keeps ≥8px clearance from both dividers.
 * Screenshots land in docs/evidence/2026-07-21-splits-layout/.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const EVIDENCE_DIR = "docs/evidence/2026-07-21-splits-layout";
const WIDTHS = [768, 834, 1024, 1280, 1440, 1920] as const;

const TODAY_ISO = "2026-07-21";
const SLUG = "mlb-07-21-2026";

const STUB_USER = {
  id: 1,
  email: "prez@aisportsbettingmodels.com",
  username: "prez",
  role: "user",
  hasAccess: true,
  expiryDate: null,
  termsAccepted: true,
  discordId: null,
  discordUsername: null,
  discordAvatar: null,
  discordConnectedAt: null,
  sessionExpiresAt: null,
  stripePlanId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  cancelAtPeriodEnd: false,
};

// Worst-case-width labels from the owner's screenshots: TB @ TOR, -111/-108
// moneylines, lopsided 92/8 and 99/1 splits (single-digit segments trigger
// the minWidth floors).
const GAME = {
  id: 9101,
  sport: "MLB",
  awayTeam: "TB",
  homeTeam: "TOR",
  gameDate: TODAY_ISO,
  startTimeEst: "19:07",
  gameStatus: "upcoming",
  gameClock: null,
  awayScore: null,
  homeScore: null,
  awayBookSpread: "-1.5",
  homeBookSpread: "+1.5",
  bookTotal: "7.5",
  awayML: "-111",
  homeML: "-108",
  spreadAwayBetsPct: 39,
  spreadAwayMoneyPct: 92,
  totalOverBetsPct: 84,
  totalOverMoneyPct: 99,
  mlAwayBetsPct: 79,
  mlAwayMoneyPct: 95,
  modelRunAt: null,
};
// NOTE while implementing: run the spec once and read the browser console /
// error boundary — if BettingSplits or GameCard destructures additional
// fields at render time, add them to GAME as null. The authoritative field
// list is the games.list row type consumed in GameCard.tsx (interface GameRow).

async function stubApi(page: Page) {
  await page.route("**/api/trpc/**", route => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(
      url.pathname.replace(/^.*\/api\/trpc\//, "")
    ).split(",");
    const body = ops.map(op => {
      if (op === "appUsers.me") return { result: { data: { json: STUB_USER } } };
      if (op === "games.list") return { result: { data: { json: [GAME] } } };
      if (op === "games.getCurrentDate")
        return {
          result: {
            data: {
              json: { effectiveDate: TODAY_ISO, utcHour: 18, isBeforeCutoff: false },
            },
          },
        };
      if (op === "games.getAvailableDates")
        return { result: { data: { json: { dates: [TODAY_ISO] } } } };
      if (op === "games.lastRefresh")
        return {
          result: { data: { json: { refreshedAt: `${TODAY_ISO}T18:00:00Z` } } },
        };
      return {
        error: {
          json: {
            message: "stubbed",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

for (const width of WIDTHS) {
  test(`splits surface fits and respects section dividers at ${width}px`, async ({
    page,
  }) => {
    await stubApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/betting-splits/${SLUG}`);
    await page.waitForSelector("[data-market-col]");

    await page.screenshot({
      path: `${EVIDENCE_DIR}/splits-${width}.png`,
      fullPage: false,
    });

    // 1. No horizontal page overflow (the "CLE (-150" cutoff class of bug).
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, "horizontal page overflow px").toBeLessThanOrEqual(1);

    // 2 + 3. Label geometry vs viewport edge and divider tracks.
    const violations = await page.evaluate(() => {
      const bad: string[] = [];
      const dividers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-splits-divider]")
      ).map(d => d.getBoundingClientRect());
      document
        .querySelectorAll<HTMLElement>("[data-market-col] span")
        .forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0) return;
          if (r.right > window.innerWidth + 1)
            bad.push(`viewport-cut: "${el.textContent}" right=${r.right}`);
          for (const d of dividers) {
            const overlapsVertically = r.bottom > d.top && r.top < d.bottom;
            if (!overlapsVertically) continue;
            const gapLeft = d.left - r.right; // label left of divider
            const gapRight = r.left - d.right; // label right of divider
            const crosses = r.left < d.right && r.right > d.left;
            if (crosses)
              bad.push(`divider-cross: "${el.textContent}"`);
            else if (Math.max(gapLeft, gapRight) < 8 && Math.min(gapLeft, gapRight) > -9999)
              bad.push(
                `divider-clearance<8px: "${el.textContent}" gap=${Math.max(gapLeft, gapRight).toFixed(1)}`
              );
          }
        });
      return bad;
    });
    expect(violations, violations.join("\n")).toEqual([]);
  });
}
```

- [ ] **Step 3: Run the spec — expect it to reproduce the bug**

Run: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/splits-layout.spec.ts`
Expected: **FAIL at one or more widths**, with violation strings naming the exact clipped/crossing labels — this is the reproduction of the owner's screenshots. Inspect `docs/evidence/2026-07-21-splits-layout/*.png` to confirm they match the report.

**Contingency (record the outcome either way):** if the spec passes at every width on this branch, current `main` already fixed the geometry and the deployed build is stale — capture the evidence screenshots, note it in the PR/summary, keep the spec as the regression net, and in Task 6 do only Step 5 (divider-track hardening) if the screenshots still show labels flush against dividers; otherwise skip to Task 7.

- [ ] **Step 4: Diagnose the overflowing ancestor (for Task 6's targeted fix)**

With the dev server still up, at the failing width run in the page console (or via `page.evaluate`):

```js
[...document.querySelectorAll("*")]
  .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
  .map(el => `${el.tagName}.${el.className}`.slice(0, 120))
  .slice(0, 20);
```

Record the innermost offender(s) in the commit message of Task 6. Known suspects, in order: (a) the ≥md flex row in `BettingSplitsPanel.tsx:742` whose min-content (nowrap labels + `desktopSegMinPx` floors + `MarketBlock` padding) exceeds its share; (b) the splits-mode score rail `clamp(205px,18vw,320px)` (`GameCard.tsx:3152`) squeezing the three columns in the 768–1023 band; (c) a nowrap span outside `[data-market-col]` (ScorePanel venue/SP line).

- [ ] **Step 5: Commit the harness (red is expected and documented)**

```bash
git add e2e/splits-layout.spec.ts client/src/components/BettingSplitsPanel.tsx docs/evidence/2026-07-21-splits-layout
git commit -m "test(splits): e2e harness reproducing right-edge cutoff and divider crossings"
```

---

### Task 6: Fix the splits geometry — grid tracks, gutters, min-width guards

**Files:**
- Modify: `client/src/components/BettingSplitsPanel.tsx:553-584 (MarketBlock), 740-764 (≥md layout)`
- Modify: `client/src/components/GameCard.tsx:3150-3155` (splits-mode score rail clamp — only if Task 5 Step 4 implicated it)

**Interfaces:**
- Consumes: `[data-splits-divider]` (Task 5), `MarketBlock`/`SplitBar` internals (this file).
- Produces: the ≥md splits layout that Task 5's spec asserts. No prop changes — `BettingSplitsPanel`'s public interface is untouched.

- [ ] **Step 1: Replace the flex row with divider-proof grid tracks**

In `BettingSplitsPanel.tsx`, replace the ≥md block (lines 740-764) with:

```tsx
      {/* ── Tablet + desktop (≥ md): three equal minmax(0,1fr) tracks with the
           1px dividers as their own grid tracks. A divider that owns a track
           cannot be painted over by neighboring content, and minmax(0,1fr)
           makes each column shrinkable so nowrap labels ellipsize instead of
           pushing the row past the viewport. ── */}
      {isMdUp && <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1fr) 1px minmax(0,1fr)',
          alignItems: 'stretch',
          width: '100%',
          minWidth: 0,
        }}
      >
        {/* Spread column — always rendered */}
        <div className="min-w-0">
          <MarketBlock title="Spread" awayLabel={awaySpreadLabel} homeLabel={homeSpreadLabel}
            ticketsPct={game.spreadAwayBetsPct} handlePct={game.spreadAwayMoneyPct}
            awayColor={awayColor} homeColor={homeColor} />
        </div>
        <div data-splits-divider style={{ background: "#ffffff", margin: "8px 0" }} />
        {/* Total column — always rendered */}
        <div className="min-w-0">
          <MarketBlock title="Total" awayLabel="" homeLabel=""
            totalValue={isNaN(bookTotal) ? undefined : bookTotal}
            ticketsPct={game.totalOverBetsPct} handlePct={game.totalOverMoneyPct}
            awayColor={awayColor} homeColor={homeColor} />
        </div>
        <div data-splits-divider style={{ background: "#ffffff", margin: "8px 0" }} />
        {/* Moneyline column — always rendered */}
        <div className="min-w-0">
          <MarketBlock title="Moneyline" awayLabel={awayMlLabel} homeLabel={homeMlLabel}
            ticketsPct={game.mlAwayBetsPct} handlePct={game.mlAwayMoneyPct}
            awayColor={awayColor} homeColor={homeColor} />
        </div>
      </div>}
```

- [ ] **Step 2: Raise the MarketBlock gutter floor to guarantee divider clearance**

In `MarketBlock` (line 557), the horizontal padding floor becomes ≥14px so labels always sit ≥14px off a divider (spec demands ≥8px):

```tsx
    <div className="flex flex-col w-full" data-market-col style={{ gap: 10, padding: "12px clamp(14px, 1.5vw, 20px)" }}>
```

- [ ] **Step 3: Guard the TOTAL header branch like the spread/ML branch**

The `isTotalMarket` header row (lines 566-571) has nowrap-free short spans, but give the row the same containment so a wide `totalValue` can never push out:

```tsx
        <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2, gap: 8, minHeight: 'clamp(21px, 1.8vw, 30px)', minWidth: 0 }}>
```

(the three child spans keep their styles).

- [ ] **Step 4: Score rail — only if implicated by Task 5 Step 4**

If the 768–1023 band still overflows or ellipsizes team-abbrev labels, narrow the splits-mode rail in `GameCard.tsx:3152-3153` from `clamp(205px,18vw,320px)` to:

```tsx
              flex: mode === "splits" ? "0 0 clamp(180px,16vw,300px)" : "0 0 clamp(170px,22vw,260px)",
              width: mode === "splits" ? 'clamp(180px,16vw,300px)' : 'clamp(170px,22vw,260px)',
```

If Step 4's diagnosis named a different offender (e.g. a ScorePanel nowrap line), apply the same treatment there instead: `minWidth: 0` on the flex ancestor + `overflow: hidden; textOverflow: ellipsis` on the nowrap span. Record what was actually changed and why in the commit body.

- [ ] **Step 5: Run the harness to green**

Run: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/splits-layout.spec.ts`
Expected: PASS at all six widths. Re-inspect `docs/evidence/2026-07-21-splits-layout/*.png` — bars centered in their tracks, visible air on both sides of each divider, `TOR (-108)` fully rendered at the right edge.

Run: `npx tsc --noEmit` → Expected: PASS.
Run: `npx vitest run client/src/components/GameCard.splitsAccordions.test.ts client/src/pages/dime-shell/productRoute.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/BettingSplitsPanel.tsx client/src/components/GameCard.tsx docs/evidence/2026-07-21-splits-layout
git commit -m "fix(splits): grid-track dividers + gutter floors — no viewport cutoff, no section crossings

Root cause (from e2e diagnosis): <recorded offender from Task 5 Step 4>"
```

---

### Task 7: Full verification, visual pass, push

**Files:** none new.

- [ ] **Step 1: Full local gates**

```bash
npx tsc --noEmit
pnpm test:gated:local
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test
```

Expected: tsc clean; vitest gated run green for non-DB tests (the gate script tolerates known environment-dependent failures); all three existing e2e specs + the new one green.

- [ ] **Step 2: Visual design pass (brand law is the referee)**

Dev server up; Chromium screenshots of `/trends` and `/betting-splits/mlb-<today>` at 768, 1024, 1440 (dark theme). Checklist against `design-system/dime-ai/MASTER.md`:
- mint `#45E0A8` is the only accent (loader, active states) — no new colors introduced;
- labels remain Familjen Grotesk / IBM Plex Mono per existing token classes;
- motion unchanged (existing 700ms bar transitions and 160ms interactions were not modified);
- Trends pane: sidebar row active state, heading focus behavior (shell handles it), scroll restoration works when switching panes (shell `scrollPositionsRef` covers any pane ≠ chat automatically).
- Splits cards at ≥768px show exactly one accordion (ODDS & SPLITS HISTORY); at <768px all three.

Expected: all pass; save the `/trends` screenshots into `docs/evidence/2026-07-21-splits-layout/` alongside the harness output.

- [ ] **Step 3: Push**

```bash
git push -u origin claude/load-skills-repo-urklt7
```

(Retry per repo git rules on network failure: 2s/4s/8s/16s backoff.)

---

## Risks / Unknowns

1. **Exact overflow root cause is unconfirmed statically.** The labels already carry `ellipsis` guards in HEAD, yet the owner's screenshots show raw mid-character cuts — which implies an ancestor min-content overflow, or the deployed build predates PR #155's label guards. Task 5 measures ground truth on HEAD and has an explicit contingency for "already fixed on main, prod is stale."
2. **Frozen design-law copy.** `NAV_ROWS` row 60 is annotated as frozen ("no route exists; frozen href='#'"). This plan changes it under explicit owner directive (this spec). Any extraction-mapping doc or test that asserts the dead-link state must be updated in the same commit — search `rg "D/L:60"` before Task 3's commit.
3. **Trends is MLB-only.** `RecentSchedulePanel`/`SituationalResultsPanel` only have MLB data (NBA/NHL DBs not backfilled — `GameCard.tsx:3548-3551`). The Trends pane ships MLB-only with an honest empty state; league pills are deliberately absent until other sports have data.
4. **tRPC stub fidelity.** The e2e fixture's `games.list` row is a best-effort slice; if `BettingSplits`/`GameCard` render-time destructuring needs more fields, the spec's NOTE says to null-fill from `interface GameRow` in `GameCard.tsx`. Budget one iteration loop for this.
5. **N+1 queries on the Trends pane.** Each game section can fire up to 3 queries when expanded. Mitigated: `useVisibility` gating + `defaultCollapsed={true}` (identical to today's splits-page behavior, so net load moves, not grows).
6. **`DimeAppShell.test.ts` breadth.** Only the first ~80 lines were reviewed; later assertions may enumerate panes. Task 3 Step 4 runs the suite and amends assertions with intent preserved.

## Explicitly Out of Scope

- Any `<768px` change: mobile accordions, `MobileFloatingNav`, `features/mobileNav/*` screens and config.
- "Prop Projections" sidebar row (stays frozen `href="#"`).
- NBA/NHL trends data backfill; server routers; DB schema (`db-push.yml` never needed — no schema change).
- Odds & Splits History panel internals (`OddsHistoryPanel.tsx`) and the projections-page `DesktopMergedPanel` layout.
- URL canonicalization for `/trends` (no sport/date slugs — plain route; add later if deep links are wanted).
- Light-theme reference pages, landing page, chat surfaces.
- Deployment config (Railway auto-deploys `main` on merge; nothing manual).

## Execution Notes

- Worktree isolation: superpowers:using-git-worktrees (`/sp-worktree`) before Task 1; the designated branch is `claude/load-skills-repo-urklt7`.
- Task order is strict: 1 → 2 → 3 → 4 are the feature chain; 5 → 6 the layout chain. Tasks (1-4) and (5-6) are independent of each other and may run as parallel subagent tracks (`/sp-parallel` / superpowers:dispatching-parallel-agents) — they touch `GameCard.tsx` in different regions (3554 vs 3150) and `BettingSplitsPanel.tsx` only in track 2; if run in parallel, land track 1 first and rebase track 2 to keep the Task 5 instrumentation clean.
- Verification before completion (superpowers:verification-before-completion): no "done" claims without the Task 7 command outputs.
