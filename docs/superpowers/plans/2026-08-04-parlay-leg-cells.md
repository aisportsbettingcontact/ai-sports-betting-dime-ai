# Parlay Leg Cells + Live/Pregame Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesigned per-leg cells (view/edit/delete, logos), slop captions removed, a hard live/pregame separation for both straights and parlays, STRAIGHT terminology, and a bounded review block as the final submit step.

**Architecture:** A new pure module `client/src/pages/betTrackerEntry.ts` owns the three entry-time decisions (odds-autofill matrix, leg wager coherence, ticket wagerType derivation) with unit tests; `ParlayBuilder.tsx` gets the visual redesign and new `onEditLeg` callback; `BetTracker.tsx` wires the matrix into its autofill effects and the toggle, stamps `wagerType` per DraftLeg, and renames SINGLE→STRAIGHT.

**Tech Stack:** React 18, Tailwind + Dime `bt-*`/`--dime-*` tokens, Vitest, Playwright (screenshots).

## Global Constraints

- Brand law `design-system/dime-ai/MASTER.md`: one mint accent `#45E0A8`; LIVE indicator may be mint; negative states grey; tokens only; no gradients; 160ms motion; micro-labels 10–11px caps 0.08em; numeric values Familjen 700 15–20px.
- Stop-slop: removed captions get no replacement prose; new copy is placeholder/error text only, specific and short.
- Server contract unchanged: `createParlay`/`create` inputs untouched (ticket-level `wagerType` already exists). No schema change.
- The DEN/units rules from PR #347 stay untouched.

## Defects/gaps being closed

| # | Where | Gap |
|---|-------|-----|
| 1 | ParlayBuilder legs | Thin rows: no logos, no edit, 13px/11px type, small hit targets |
| 2 | ParlayBuilder captions | Two standing slop captions (ticket odds :198-204, risk :224-226) |
| 3 | BetTracker autofill | Slate odds autofill ignores game status × wagerType — live lines fill pregame wagers on in-progress games |
| 4 | DraftLeg | No wagerType stamp; ticket submits whatever the toggle reads at submit time — legs added earlier can be mislabeled |
| 5 | Toggle | LIVE selectable on games that have not started |
| 6 | entryMode | User-facing "SINGLE"; the product term is STRAIGHT |

---

### Task 1: `betTrackerEntry.ts` — the three pure decisions

**Files:**
- Create: `client/src/pages/betTrackerEntry.ts`
- Test: `client/src/pages/betTrackerEntry.test.ts`

**Interfaces (produced):**

```ts
export type WagerType = "PREGAME" | "LIVE";
export type GameStatus = "scheduled" | "in_progress" | "complete" | string;

/** The autofill matrix. UNKNOWN statuses are treated as scheduled (fail safe: pregame). */
export function decideEntrySource(status: GameStatus, wagerType: WagerType): {
  autofill: boolean;          // may odds/lines fill from the slate?
  liveSelectable: boolean;    // may the LIVE toggle be chosen for this game?
  sourceLabel: "PRE" | "LIVE" | null; // chip shown on autofilled odds; null when manual
}

/** Auto-set the toggle from the picked game's status. */
export function defaultWagerType(status: GameStatus): WagerType;

/** One ticket, one moment: legs of both kinds cannot share it. */
export function checkLegCoherence(existing: WagerType[], adding: WagerType):
  { ok: true } | { ok: false; message: string };

/** The submitted ticket's wagerType comes from its legs, not the toggle. */
export function deriveTicketWagerType(legs: WagerType[]): WagerType;
```

- [ ] **Step 1: failing tests** — the full matrix plus edges:

```ts
import { describe, it, expect } from "vitest";
import { decideEntrySource, defaultWagerType, checkLegCoherence, deriveTicketWagerType } from "./betTrackerEntry";

describe("decideEntrySource — the live/pregame matrix", () => {
  it("scheduled + PREGAME: autofill, chip PRE", () =>
    expect(decideEntrySource("scheduled", "PREGAME")).toEqual({ autofill: true, liveSelectable: false, sourceLabel: "PRE" }));
  it("scheduled + LIVE is not a real state: LIVE not selectable", () =>
    expect(decideEntrySource("scheduled", "LIVE").liveSelectable).toBe(false));
  it("in_progress + LIVE: autofill, chip LIVE", () =>
    expect(decideEntrySource("in_progress", "LIVE")).toEqual({ autofill: true, liveSelectable: true, sourceLabel: "LIVE" }));
  it("REGRESSION (the mixing hole): in_progress + PREGAME never autofills", () =>
    expect(decideEntrySource("in_progress", "PREGAME")).toEqual({ autofill: false, liveSelectable: true, sourceLabel: null }));
  it("complete + PREGAME: autofill closing lines for backfill", () =>
    expect(decideEntrySource("complete", "PREGAME")).toEqual({ autofill: true, liveSelectable: true, sourceLabel: "PRE" }));
  it("complete + LIVE: manual only (the feed has no live line anymore)", () =>
    expect(decideEntrySource("complete", "LIVE")).toEqual({ autofill: false, liveSelectable: true, sourceLabel: null }));
  it("unknown status fails safe as scheduled", () =>
    expect(decideEntrySource("weird", "PREGAME")).toEqual({ autofill: true, liveSelectable: false, sourceLabel: "PRE" }));
});

describe("defaultWagerType", () => {
  it("in_progress → LIVE, anything else → PREGAME", () => {
    expect(defaultWagerType("in_progress")).toBe("LIVE");
    expect(defaultWagerType("scheduled")).toBe("PREGAME");
    expect(defaultWagerType("complete")).toBe("PREGAME");
  });
});

describe("checkLegCoherence — one ticket, one moment", () => {
  it("first leg always coheres", () => expect(checkLegCoherence([], "LIVE").ok).toBe(true));
  it("same kind coheres", () => expect(checkLegCoherence(["LIVE"], "LIVE").ok).toBe(true));
  it("REGRESSION: mixing is rejected with a specific message", () => {
    const r = checkLegCoherence(["PREGAME"], "LIVE");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/pregame/i);
  });
});

describe("deriveTicketWagerType", () => {
  it("comes from the legs, PREGAME when empty", () => {
    expect(deriveTicketWagerType(["LIVE", "LIVE"])).toBe("LIVE");
    expect(deriveTicketWagerType([])).toBe("PREGAME");
  });
});
```

- [ ] **Step 2: run red** — `pnpm exec vitest run client/src/pages/betTrackerEntry.test.ts` (module missing)
- [ ] **Step 3: implement** (complete file):

```ts
/**
 * betTrackerEntry.ts — entry-time decisions for the add-bet form.
 *
 * The Action Network slate serves ONE odds snapshot per game: pregame lines
 * before first pitch, the book's CURRENT (live) lines while in progress,
 * closing lines after. The form must never present one as the other, so the
 * autofill decision lives here as a pure function of (game status, wager
 * type) — testable, and shared by the straight path and the leg path.
 */

export type WagerType = "PREGAME" | "LIVE";
export type GameStatus = "scheduled" | "in_progress" | "complete" | string;

export function decideEntrySource(status: GameStatus, wagerType: WagerType): {
  autofill: boolean;
  liveSelectable: boolean;
  sourceLabel: "PRE" | "LIVE" | null;
} {
  if (status === "in_progress") {
    return wagerType === "LIVE"
      ? { autofill: true, liveSelectable: true, sourceLabel: "LIVE" }
      : { autofill: false, liveSelectable: true, sourceLabel: null };
  }
  if (status === "complete") {
    return wagerType === "PREGAME"
      ? { autofill: true, liveSelectable: true, sourceLabel: "PRE" }
      : { autofill: false, liveSelectable: true, sourceLabel: null };
  }
  // scheduled — and any status this code does not recognize, which must fail
  // safe as "not started": pregame lines, no live wagers yet.
  return wagerType === "PREGAME"
    ? { autofill: true, liveSelectable: false, sourceLabel: "PRE" }
    : { autofill: false, liveSelectable: false, sourceLabel: null };
}

export function defaultWagerType(status: GameStatus): WagerType {
  return status === "in_progress" ? "LIVE" : "PREGAME";
}

export function checkLegCoherence(existing: WagerType[], adding: WagerType):
  { ok: true } | { ok: false; message: string } {
  if (existing.length === 0 || existing.every(w => w === adding)) return { ok: true };
  return {
    ok: false,
    message: adding === "LIVE"
      ? "This ticket has pregame legs. A live leg goes on its own ticket."
      : "This ticket has live legs. A pregame leg goes on its own ticket.",
  };
}

export function deriveTicketWagerType(legs: WagerType[]): WagerType {
  return legs.length > 0 && legs.every(w => w === "LIVE") ? "LIVE" : "PREGAME";
}
```

- [ ] **Step 4: run green**
- [ ] **Step 5: commit** `feat(bet-tracker): entry-time live/pregame decisions as a pure module`

### Task 2: ParlayBuilder redesign — cells, copy, review block

**Files:**
- Modify: `client/src/components/ParlayBuilder.tsx`
- Test: `client/src/pages/betTrackerEntry.test.ts` (append source scans)

**Interfaces:**
- `DraftLeg` gains `wagerType: "PREGAME" | "LIVE"`, `awayLogo: string | null`, `homeLogo: string | null`.
- New prop `onEditLeg: (index: number) => void`.
- Review block props stay derivable from existing props (legs, ticketOdds, risk, stakeMode, unitSize).

- [ ] **Step 1: failing scans** (append to betTrackerEntry.test.ts):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
const builder = readFileSync(join(__dirname, "../components/ParlayBuilder.tsx"), "utf8");
const page = readFileSync(join(__dirname, "BetTracker.tsx"), "utf8");

describe("the builder's copy and cells", () => {
  it("REGRESSION: the two standing captions are gone", () => {
    expect(builder).not.toMatch(/Calculated from .* legs/);
    expect(builder).not.toMatch(/One stake on the whole ticket/);
    expect(builder).not.toMatch(/that price is what settles/);
  });
  it("legs are editable and deletable", () => {
    expect(builder).toMatch(/onEditLeg/);
    expect(builder).toMatch(/onRemoveLeg/);
  });
  it("cells carry logos and a wager chip", () => {
    expect(builder).toMatch(/awayLogo/);
    expect(builder).toMatch(/wagerType/);
  });
  it("STRAIGHT is the term the toggle uses", () => {
    expect(page).toMatch(/"STRAIGHT"/);
    expect(page).not.toMatch(/entryMode === "SINGLE"/);
  });
});
```

- [ ] **Step 2: run red**
- [ ] **Step 3: implement** — in ParlayBuilder.tsx:
  - `DraftLeg` interface: add the three fields.
  - Leg cell layout (replacing the current `<li>` body): index (mint 11px), logo pair (20px, `rounded-full`, second overlapping `-ml-2`, hidden when `leg.market === "TOTAL"`), pick 15px/600 primary + matchup/date 12px secondary below, PRE/LIVE chip (10px caps tracking; LIVE mint, PRE `--text-muted`), odds 16px/700 `bt-num`, edit button (Pencil icon, `aria-label`), delete X (p-2 hit target).
  - Remove both caption `<span>`s. Keep placeholder "add two legs" on the odds input; keep the "use calculated" button and validation errors.
  - Replace the payout row with the review block: left `${legs.length} legs · ${ticketWagerLabel}`; center `+odds`; primary line `Risking X to win` + mint to-win. `ticketWagerLabel` from `deriveTicketWagerType(legs.map(l => l.wagerType))`.
  - Button unchanged: `TRACK ${legs.length}-LEG PARLAY`.
- [ ] **Step 4: run scans green; `pnpm exec tsc --noEmit`** (expect BetTracker.tsx errors — DraftLeg construction misses new fields — fixed in Task 3; run tsc only at end of Task 3)
- [ ] **Step 5: commit** `feat(bet-tracker): parlay leg cells — logos, edit, delete, review block; captions removed`

### Task 3: BetTracker wiring — matrix, stamps, STRAIGHT

**Files:**
- Modify: `client/src/pages/BetTracker.tsx`

Steps:
- [ ] Import `decideEntrySource, defaultWagerType, checkLegCoherence, deriveTicketWagerType` from `./betTrackerEntry`.
- [ ] `entryMode` state + toggle array + all `=== "SINGLE"` sites → `"STRAIGHT"` (mechanical rename, 7 sites found by grep).
- [ ] On game select (`setFormGame` call sites that pick a game): `setFormWagerType(defaultWagerType(game.status))`.
- [ ] Compute `entrySource = decideEntrySource(formGame?.status ?? "scheduled", formWagerType)` near the form state. Gate BOTH autofill effects (`getPickOdds`/`getPickLine` sites at 2553, 2562, 3413, 3424, and the leg-line derivation at 3124, 3590) on `entrySource.autofill`; when false, clear odds/line to "" once on transition (an effect keyed on `[formGame?.id, formWagerType]`).
- [ ] LIVE toggle button: `disabled={!entrySource.liveSelectable && formWagerType !== "LIVE"}` — precisely: disable choosing LIVE when `decideEntrySource(status, "LIVE").liveSelectable` is false; title attr "Game has not started".
- [ ] Odds input chip: when `entrySource.sourceLabel` is non-null and the current odds value came from autofill, render the chip next to the odds label (10px caps; LIVE mint / PRE muted).
- [ ] `handleAddLeg`: stamp `wagerType: formWagerType`, `awayLogo: formGame.awayLogo`, `homeLogo: formGame.homeLogo`; before pushing, `checkLegCoherence(draftLegs.map(l => l.wagerType), formWagerType)` — on failure `setParlayError(message)` and return.
- [ ] `handleEditLeg(index)`: from `draftLegs[index]`, find the slate game by `anGameId`+`gameNumber` (fall back to matching `awayTeam/homeTeam/gameDate`); set formGame, formMarket, formPickSide, formTimeframe, formOdds=String(leg.odds), formCustomLine=leg.line != null ? String(leg.line) : "", formWagerType=leg.wagerType; then remove the leg (`setDraftLegs(l => l.filter((_, i) => i !== index))`); pass down as `onEditLeg`.
- [ ] Parlay submit: `wagerType: deriveTicketWagerType(draftLegs.map(l => l.wagerType))` instead of `formWagerType`.
- [ ] **Verify:** `pnpm exec tsc --noEmit` exit 0; `pnpm exec vitest run client/src/pages/betTrackerEntry.test.ts client/src/pages/betTrackerDisplay.test.ts server/stakeDenomination.test.ts` green (the stakeDenomination client-half scans must keep passing).
- [ ] **Commit** `feat(bet-tracker): live/pregame separation wired — matrix-gated autofill, leg stamps, STRAIGHT`

### Task 4: Full verification

- [ ] `pnpm exec tsc --noEmit` (fresh)
- [ ] `env -u DATABASE_URL pnpm exec vitest run` — failure set must equal the origin/main env-only baseline
- [ ] `pnpm run build` exit 0
- [ ] Playwright: boot the built server locally (per verify skill), screenshot the Bet Tracker parlay panel dark+light, 1440×900 and 390×844. Requires an authenticated session — if login cannot be scripted with test credentials locally, screenshot the component in the Vite dev page instead; attach whatever was captured to the PR.
- [ ] Commit docs (spec + this plan) if not already committed.

### Task 5: Finish

- [ ] Push `feat/parlay-leg-cells`, open PR with before/after screenshots, the matrix table, and the coherence rule; CI watcher.

**Risks / unknowns:**
- The autofill effects in BetTracker are spread across handlers (side-flip, market change, game select) — gating must cover every `getPickOdds`/`getPickLine` write into form state; the grep list is the checklist.
- `stakeDenomination.test.ts` scans reference BetTracker source patterns (`effectiveStakeMode`, submit conversion) — the rename and edits must not disturb those lines.
- Editing a leg while the form holds unsaved input overwrites it — accepted (adding a leg already clears the form; the model is "the form holds one leg at a time").
- Playwright auth locally may not be scriptable without secrets — degrade to dev-page screenshots.
