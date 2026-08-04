# Stake Denomination Write Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every write path that touches the stake quad (`risk`, `toWin`, `riskUnits`, `toWinUnits`) enforces the role law (owner/admin: $ or U; everyone else: units only) and keeps the quad mathematically coherent — one shared reconciliation core, no path-local math.

**Architecture:** Two pure functions in `server/betTrackerCore.ts` own all pair math: `deriveToWinUnits` (the proportionality law `toWinUnits = toWin × riskUnits / risk` @ 4dp) and `resolveStakePatch` (role gate + unit-size-held-constant reconciliation for updates). The router (`create`, `update`, `reviewEditRequest`) and `parlayGrader` call them; nothing else computes unit figures.

**Tech Stack:** TypeScript strict, Drizzle/MySQL (DECIMAL(10,2) dollars, DECIMAL(12,4) units), tRPC v11, Vitest.

## Global Constraints

- Role law: `decideStakeDenomination(role)` is the single source — owner/admin `unitsOnly:false`, every other role `unitsOnly:true` (fail closed).
- Dollars stored at 2dp (`.toFixed(2)`), units at 4dp (`.toFixed(4)`). Schema scale-4 exists because scale-2 lost real money (drizzle/schema.ts docstring, migration 0132).
- The pair law: whenever `riskUnits > 0` and `risk > 0` and `toWin` is set, `toWinUnits = toWin × riskUnits / risk` (4dp). No stale unit figure may survive a dollar/odds change.
- A row's implied unit size (`risk / riskUnits`) is held constant across its life unless the caller restates the basis (sends `risk` and `riskUnits` together).
- Whichever denomination the caller states is stored verbatim; the other side is derived. Units-only roles may state only units.
- The shipped UI edit dialog sends only `notes`/`result` — no client change is required; the server contract is being hardened for direct API callers.
- Merge to main IS a production deploy. No schema changes in this plan (columns already exist).

## Defects being closed (evidence from the 2026-08-04 audit)

| # | Path | Defect |
|---|------|--------|
| 1 | `update` (routers/betTracker.ts:447) | No denomination gate; accepts dollar `risk`/`toWin` from units-only roles; recomputes `toWin` on odds/risk change but never `riskUnits`/`toWinUnits` → pair de-sync |
| 2 | `create` straight (routers/betTracker.ts:399) | Stores `toWinUnits: input ?? null` — never derives, unlike `createParlay` (:763) → subscriber rows with `riskUnits` set but `toWinUnits` NULL read back mixed-basis (stored units for risk, viewer-unit-size dollars for toWin) |
| 3 | `parlayGrader.ts:427` | Reprice recomputes `toWinUnits` at `.toFixed(2)` — reintroduces the scale-2 rounding loss migration 0132 fixed |
| 4 | `reviewEditRequest` (routers/betTracker.ts:1008-1019) | Applies `odds`/`risk`/`toWin` raw from parsed JSON: no type validation, no `calcToWin` recompute, no unit-pair handling |

## Out of scope

- `reviewEditRequest` pick-label/betType re-derivation on market/pickSide change (pre-existing, orthogonal — noted in PR body).
- Book-sync import paths (do not exist yet; "dollar amounts return for book-synced bets" is future work).
- Any UI change beyond none-needed (edit dialog already sends only notes/result).
- Migration/backfill of existing NULL-`toWinUnits` rows (read path's dollars÷unitSize fallback remains the documented degraded mode).

---

### Task 1: `deriveToWinUnits` — the pair law as one pure function

**Files:**
- Modify: `server/betTrackerCore.ts` (add export after `toUnits`)
- Test: `server/stakeReconciliation.test.ts` (create)

**Interfaces:**
- Produces: `deriveToWinUnits(risk: number, toWin: number, riskUnits: number | string | null | undefined): string | null` — returns 4dp string or null when there is no usable unit basis.

- [ ] **Step 1: Write failing tests**

```ts
// server/stakeReconciliation.test.ts
import { describe, it, expect } from "vitest";
import { deriveToWinUnits } from "./betTrackerCore";

describe("deriveToWinUnits — the pair law", () => {
  it("toWinUnits = toWin × riskUnits / risk at 4dp", () => {
    expect(deriveToWinUnits(100, 91.0, 1)).toBe("0.9100");
    expect(deriveToWinUnits(25, 68.5, 0.25)).toBe("0.6850"); // the 0132 case: NOT 0.69
    expect(deriveToWinUnits(50, 200, 0.5)).toBe("2.0000");
  });
  it("null when the basis is unusable", () => {
    expect(deriveToWinUnits(100, 91, null)).toBeNull();
    expect(deriveToWinUnits(100, 91, undefined)).toBeNull();
    expect(deriveToWinUnits(100, 91, 0)).toBeNull();
    expect(deriveToWinUnits(100, 91, -1)).toBeNull();
    expect(deriveToWinUnits(0, 91, 1)).toBeNull();
  });
  it("accepts DECIMAL strings as they come off the driver", () => {
    expect(deriveToWinUnits(25, 68.5, "0.2500")).toBe("0.6850");
  });
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run server/stakeReconciliation.test.ts` → FAIL (`deriveToWinUnits` not exported)
- [ ] **Step 3: Implement in betTrackerCore.ts**

```ts
/**
 * The pair law: a row's unit payout is its dollar payout scaled by the same
 * ratio as its stake — toWinUnits = toWin × riskUnits / risk — so the payout
 * multiple is identical in both denominations. 4dp because the schema is
 * DECIMAL(12,4); scale 2 lost real money (see drizzle/schema.ts, migration 0132).
 * Null when there is no unit basis (or a degenerate one) — the read path then
 * falls back to dollars ÷ the viewer's unit size, which is honest about being
 * derived, whereas a stale or 2dp figure is silently wrong.
 */
export function deriveToWinUnits(
  risk: number,
  toWin: number,
  riskUnits: number | string | null | undefined,
): string | null {
  const units = typeof riskUnits === "string" ? parseFloat(riskUnits) : riskUnits;
  if (units == null || !Number.isFinite(units) || units <= 0) return null;
  if (!Number.isFinite(risk) || risk <= 0 || !Number.isFinite(toWin)) return null;
  return ((toWin * units) / risk).toFixed(4);
}
```

- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** `feat(bet-tracker): deriveToWinUnits — the pair law as one shared function`

### Task 2: `resolveStakePatch` — role gate + reconciliation for updates

**Files:**
- Modify: `server/betTrackerCore.ts` (add after `deriveToWinUnits`)
- Test: `server/stakeReconciliation.test.ts` (extend)

**Interfaces:**
- Consumes: `decideStakeDenomination(role)`, `calcToWin(odds, risk)`, `deriveToWinUnits(...)` from Task 1.
- Produces:

```ts
export interface StakePatchInput {
  actorRole: string;
  existing: { risk: string; toWin: string; riskUnits: string | null; toWinUnits: string | null };
  odds: number;              // FINAL odds (input.odds ?? existing.odds)
  oddsChanged: boolean;
  risk?: number;             // dollar restatement
  toWin?: number;            // dollar payout restatement (boosted price)
  riskUnits?: number;        // unit restatement
  toWinUnits?: number;       // unit payout restatement
}
export type StakePatchResult =
  | { ok: true; fields: { risk?: string; toWin?: string; riskUnits?: string; toWinUnits?: string | null } }
  | { ok: false; message: string };
export function resolveStakePatch(input: StakePatchInput): StakePatchResult;
```

Semantics (each is a test):
1. Units-only actor sending `risk` or `toWin` → `{ok:false}` with `decideStakeDenomination(role).reason`.
2. Units-only actor sending `riskUnits` on a row with a pair → riskUnits stored verbatim (4dp), `risk` re-derived at the row's held unit size (2dp), `toWin` recomputed via `calcToWin`, `toWinUnits` via the pair law.
3. Units-only actor sending `toWinUnits` on a paired row → `toWin` re-derived at held size (2dp), `toWinUnits` stored verbatim.
4. Privileged actor sending `risk` on a paired row → risk verbatim (2dp), `riskUnits` re-derived at held size (4dp), `toWin`/`toWinUnits` recomputed.
5. Privileged actor sending `risk` on an unpaired row → dollars move, units stay null.
6. Privileged actor sending `risk` AND `riskUnits` → both verbatim (new basis), `toWin`/`toWinUnits` recomputed.
7. `oddsChanged` alone → `toWin = calcToWin(odds, risk)`, `toWinUnits` via pair law (null-safe on unpaired rows).
8. Explicit `toWin` (boost) → verbatim, `toWinUnits` follows via pair law.
9. `riskUnits` patch on an unpaired row → creates the pair anchored to current dollars (risk unchanged), `toWinUnits` derived.
10. `toWinUnits` patch on an unpaired row → `{ok:false, message: "…no unit basis…"}` (nothing to anchor the dollar derivation).
11. No stake inputs and `oddsChanged=false` → `{ok:true, fields:{}}`.

- [ ] **Step 1: Write the failing tests** — one `it` per numbered semantic above, with exact literals, e.g.:

```ts
import { resolveStakePatch } from "./betTrackerCore";
const paired = { risk: "100.00", toWin: "91.00", riskUnits: "1.0000", toWinUnits: "0.9100" };
const unpaired = { risk: "100.00", toWin: "91.00", riskUnits: null, toWinUnits: null };

it("[1] units-only actor may not state dollars", () => {
  const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: -110, oddsChanged: false, risk: 250 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toMatch(/units/i);
});
it("[2] units-first restatement: dollars follow at the held unit size", () => {
  const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: -110, oddsChanged: false, riskUnits: 2.5 });
  expect(r).toEqual({ ok: true, fields: { riskUnits: "2.5000", risk: "250.00", toWin: "227.27", toWinUnits: "2.2727" } });
});
it("[4] dollar-first restatement (privileged): units follow at the held size", () => {
  const r = resolveStakePatch({ actorRole: "owner", existing: paired, odds: -110, oddsChanged: false, risk: 250 });
  expect(r).toEqual({ ok: true, fields: { risk: "250.00", riskUnits: "2.5000", toWin: "227.27", toWinUnits: "2.2727" } });
});
it("[7] odds change moves BOTH payout figures", () => {
  const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: +120, oddsChanged: true });
  expect(r).toEqual({ ok: true, fields: { toWin: "120.00", toWinUnits: "1.2000" } });
});
```

(…and the rest of the matrix, including the `{ok:false}` cases and the unpaired-row cases.)

- [ ] **Step 2: Run** → FAIL (`resolveStakePatch` not exported)
- [ ] **Step 3: Implement**

```ts
/**
 * One reconciliation for every stake-touching UPDATE.
 *
 * Directionality: whichever denomination the caller states is stored verbatim;
 * the other side is derived so the quad stays coherent. Units-only roles may
 * state only units (decideStakeDenomination is the gate). The row's implied
 * unit size (risk / riskUnits) is held constant unless the caller restates the
 * basis by sending risk and riskUnits together.
 */
export function resolveStakePatch(input: StakePatchInput): StakePatchResult {
  const rule = decideStakeDenomination(input.actorRole);
  if (rule.unitsOnly && (input.risk !== undefined || input.toWin !== undefined)) {
    return { ok: false, message: rule.reason };
  }

  const curRisk  = parseFloat(input.existing.risk);
  const curUnits = input.existing.riskUnits != null ? parseFloat(input.existing.riskUnits) : null;
  const heldSize = curUnits != null && curUnits > 0 && curRisk > 0 ? curRisk / curUnits : null;

  // ── Risk side ──────────────────────────────────────────────────────────────
  let nextRisk  = curRisk;
  let nextUnits = curUnits;
  let riskTouched = false;
  if (input.risk !== undefined && input.riskUnits !== undefined) {
    nextRisk = input.risk; nextUnits = input.riskUnits; riskTouched = true;      // new basis
  } else if (input.riskUnits !== undefined) {
    nextUnits = input.riskUnits; riskTouched = true;
    if (heldSize != null) nextRisk = input.riskUnits * heldSize;                  // dollars follow
  } else if (input.risk !== undefined) {
    nextRisk = input.risk; riskTouched = true;
    if (heldSize != null) nextUnits = input.risk / heldSize;                      // units follow
  }

  // ── Payout side ────────────────────────────────────────────────────────────
  const sizeAfter = nextUnits != null && nextUnits > 0 && nextRisk > 0 ? nextRisk / nextUnits : null;
  let nextToWin: number | null = null;
  if (input.toWin !== undefined) {
    nextToWin = input.toWin;                                                      // boosted price, verbatim
  } else if (input.toWinUnits !== undefined) {
    if (sizeAfter == null) return { ok: false, message: "This bet has no unit basis to derive a dollar payout from — restate riskUnits first." };
    nextToWin = input.toWinUnits * sizeAfter;                                     // dollars follow units
  } else if (riskTouched || input.oddsChanged) {
    nextToWin = calcToWin(input.odds, nextRisk);                                  // arithmetic price
  }

  if (!riskTouched && nextToWin == null) return { ok: true, fields: {} };

  const fields: { risk?: string; toWin?: string; riskUnits?: string; toWinUnits?: string | null } = {};
  if (riskTouched) {
    fields.risk = nextRisk.toFixed(2);
    if (nextUnits != null) fields.riskUnits = nextUnits.toFixed(4);
  }
  if (nextToWin != null) {
    fields.toWin = nextToWin.toFixed(2);
    fields.toWinUnits = input.toWinUnits !== undefined
      ? input.toWinUnits.toFixed(4)                                               // stated verbatim
      : deriveToWinUnits(parseFloat(fields.risk ?? input.existing.risk), nextToWin, nextUnits);
  }
  return { ok: true, fields };
}
```

- [ ] **Step 4: Run the full matrix** → PASS. Recheck literals by hand: `calcToWin(-110, 250) = 227.27`; `227.27 × 2.5 / 250 = 2.2727`.
- [ ] **Step 5: Commit** `feat(bet-tracker): resolveStakePatch — role-gated, size-held stake reconciliation`

### Task 3: Wire `update` through the core

**Files:**
- Modify: `server/routers/betTracker.ts` (input schema ~:448-461; stake block :560-569)
- Test: `server/stakeDenomination.test.ts` (source-scan regressions)

**Interfaces:**
- Consumes: `resolveStakePatch` (Task 2). Import it alongside the existing betTrackerCore imports.

- [ ] **Step 1: Failing source-scan tests** in `stakeDenomination.test.ts` (`router` fixture already loads the file):

```ts
it("REGRESSION: update routes stake fields through resolveStakePatch", () => {
  expect(router).toMatch(/resolveStakePatch\(\{/);
  // The old inline recompute must be gone: nothing outside the core derives toWin here.
  expect(router).not.toMatch(/patch\.toWin = String\(calcToWin/);
});
it("REGRESSION: update accepts unit restatements", () => {
  const updateInput = router.slice(router.indexOf("update: appUserProcedure"), router.indexOf("delete:"));
  expect(updateInput).toMatch(/riskUnits:\s*z\.number\(\)\.positive\(\)\.optional\(\)/);
  expect(updateInput).toMatch(/toWinUnits:\s*z\.number\(\)\.positive\(\)\.optional\(\)/);
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement.** Add `riskUnits`/`toWinUnits` to the update input zod object. Replace lines 560-569 with:

```ts
      // ── Stake reconciliation (single implementation: betTrackerCore) ──────────
      const newOdds = input.odds ?? existing.odds;
      const stake = resolveStakePatch({
        actorRole: role,
        existing: { risk: existing.risk, toWin: existing.toWin, riskUnits: existing.riskUnits, toWinUnits: existing.toWinUnits },
        odds: newOdds,
        oddsChanged: input.odds !== undefined && input.odds !== existing.odds,
        risk: input.risk,
        toWin: input.toWin,
        riskUnits: input.riskUnits,
        toWinUnits: input.toWinUnits,
      });
      if (!stake.ok) {
        console.log(`[BetTracker][ERROR] update: betId=${input.id} role=${role} stake refused — ${stake.message}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: stake.message });
      }
      Object.assign(patch, stake.fields);
```

Keep the existing `input.odds` block (odds/originalOdds) unchanged after it.

- [ ] **Step 4: Run** `pnpm exec vitest run server/stakeDenomination.test.ts server/stakeReconciliation.test.ts` → PASS
- [ ] **Step 5: Commit** `fix(bet-tracker): update enforces the denomination gate and keeps the stake quad coherent`

### Task 4: Straight `create` derives `toWinUnits` (parity with `createParlay`)

**Files:**
- Modify: `server/routers/betTracker.ts:399`
- Test: `server/stakeDenomination.test.ts`

- [ ] **Step 1: Failing source-scan test**

```ts
it("REGRESSION: straight create derives toWinUnits like createParlay does", () => {
  const createBlock = router.slice(router.indexOf("create: appUserProcedure"), router.indexOf("update: appUserProcedure"));
  expect(createBlock).toMatch(/toWinUnits: resolveToWinUnits\(input\.riskUnits, input\.toWinUnits, input\.risk, toWin\)/);
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** — replace line 399 with `toWinUnits: resolveToWinUnits(input.riskUnits, input.toWinUnits, input.risk, toWin),`
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `fix(bet-tracker): straight create derives toWinUnits — no more mixed-basis rows`

### Task 5: `parlayGrader` reprice uses the shared law at 4dp

**Files:**
- Modify: `server/parlayGrader.ts:424-427`
- Test: `server/stakeDenomination.test.ts`

- [ ] **Step 1: Failing source-scan test**

```ts
it("REGRESSION: the grader's reprice keeps unit precision (0132) and uses the shared law", () => {
  const grader = code("parlayGrader.ts");
  expect(grader).toMatch(/deriveToWinUnits\(/);
  expect(grader).not.toMatch(/toWinUnits[\s\S]{0,120}?toFixed\(2\)/);
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** — replace the inline unitSize block with:

```ts
        patch.toWinUnits = deriveToWinUnits(risk, toWin, ticket.riskUnits);
```

(import `deriveToWinUnits` from `./betTrackerCore`; delete the local `units`/`unitSize` lines).

- [ ] **Step 4: Run scan + existing grader-adjacent suites** (`server/parlayGrading.test.ts` if present, else the scan) → PASS
- [ ] **Step 5: Commit** `fix(bet-tracker): parlay reprice derives toWinUnits at scale 4 via the shared law`

### Task 6: `reviewEditRequest` applies stake changes through the core

**Files:**
- Modify: `server/routers/betTracker.ts:1008-1019`
- Test: `server/stakeDenomination.test.ts`

- [ ] **Step 1: Failing source-scan test**

```ts
it("REGRESSION: approved edit requests cannot write raw stake fields", () => {
  const block = router.slice(router.indexOf("reviewEditRequest"), router.indexOf("getLogs"));
  expect(block).toMatch(/resolveStakePatch\(/);
  expect(block).toMatch(/Number\.isFinite/);
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** — inside the `if (Object.keys(changes).length > 0)` branch, split stake keys from passthrough keys:

```ts
            // Sanitize: only allow safe fields. Stake fields go through the
            // SAME reconciliation as betTracker.update — an approved request is
            // still a write, and raw JSON was reaching SQL untyped here.
            const passthrough = ["notes", "result", "wagerType", "customLine", "line", "timeframe", "market", "pickSide"];
            const safe: Record<string, unknown> = {};
            for (const k of passthrough) {
              if (k in changes) safe[k] = changes[k];
            }
            const num = (v: unknown): number | undefined => {
              if (v === undefined || v === null) return undefined;
              const n = typeof v === "number" ? v : parseFloat(String(v));
              return Number.isFinite(n) && n > 0 ? n : undefined;
            };
            const reqOdds = (() => {
              const v = changes["odds"];
              const n = typeof v === "number" ? v : v != null ? parseFloat(String(v)) : NaN;
              return Number.isFinite(n) ? Math.trunc(n) : undefined;
            })();
            const stake = resolveStakePatch({
              actorRole: role, // reviewer is owner/admin — dollar fields permitted
              existing: { risk: bet.risk, toWin: bet.toWin, riskUnits: bet.riskUnits, toWinUnits: bet.toWinUnits },
              odds: reqOdds ?? bet.odds,
              oddsChanged: reqOdds !== undefined && reqOdds !== bet.odds,
              risk: num(changes["risk"]),
              toWin: num(changes["toWin"]),
              riskUnits: num(changes["riskUnits"]),
              toWinUnits: num(changes["toWinUnits"]),
            });
            if (!stake.ok) {
              console.log(`[BetTracker][ERROR] reviewEditRequest: stake changes refused for betId=${req.betId} — ${stake.message}`);
              throw new TRPCError({ code: "BAD_REQUEST", message: stake.message });
            }
            Object.assign(safe, stake.fields);
            if (reqOdds !== undefined) {
              safe["odds"] = reqOdds;
              if ((bet.legCount ?? 0) > 0) safe["originalOdds"] = reqOdds; // same basis rule as update
            }
```

(`bet` is already loaded earlier in the procedure; confirm its select includes the stake columns — extend the select if not.)

- [ ] **Step 4: Run scans** → PASS
- [ ] **Step 5: Commit** `fix(bet-tracker): reviewEditRequest validates and reconciles stake fields`

### Task 7: DB behavior tests (real MySQL, CI parity)

**Files:**
- Test: `server/betTrackerLifecycle.db.test.ts` (extend — the suite already builds tRPC callers per role)

- [ ] **Step 1: Add failing DB tests** in a new `describe` block, using the suite's `callerFor` helper and fixture IDs in its user namespace:

```ts
  it("[DEN-1] a subscriber cannot restate a bet in dollars", async () => {
    const caller = await callerFor(U_FILTER, "user");
    const bet = await caller.betTracker.create({
      anGameId: 8802801, sport: "MLB", gameDate: D_FILTER,
      awayTeam: "NYM", homeTeam: "ATL", market: "ML", pickSide: "AWAY",
      odds: -110, risk: 100, riskUnits: 1,
    });
    createdBetIds.add((bet as { id: number }).id);
    await expect(
      caller.betTracker.update({ id: (bet as { id: number }).id, risk: 5000 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("[DEN-2] a unit restatement moves the dollars at the row's own unit size", async () => {
    const caller = await callerFor(U_FILTER, "user");
    const bet = await caller.betTracker.create({
      anGameId: 8802802, sport: "MLB", gameDate: D_FILTER,
      awayTeam: "NYM", homeTeam: "ATL", market: "ML", pickSide: "AWAY",
      odds: -110, risk: 100, riskUnits: 1,   // unit size $100
    });
    const id = (bet as { id: number }).id; createdBetIds.add(id);
    const updated = await caller.betTracker.update({ id, riskUnits: 2.5 });
    expect(updated).toMatchObject({ risk: "250.00", riskUnits: "2.5000", toWin: "227.27", toWinUnits: "2.2727" });
  });

  it("[DEN-3] an odds edit moves BOTH payout figures (no stale toWinUnits)", async () => {
    const caller = await callerFor(U_FILTER, "user");
    const bet = await caller.betTracker.create({
      anGameId: 8802803, sport: "MLB", gameDate: D_FILTER,
      awayTeam: "NYM", homeTeam: "ATL", market: "ML", pickSide: "AWAY",
      odds: -110, risk: 100, riskUnits: 1,
    });
    const id = (bet as { id: number }).id; createdBetIds.add(id);
    const updated = await caller.betTracker.update({ id, odds: +120 });
    expect(updated).toMatchObject({ toWin: "120.00", toWinUnits: "1.2000" });
  });

  it("[DEN-4] straight create derives toWinUnits when the client omits it", async () => {
    const caller = await callerFor(U_FILTER, "user");
    const bet = await caller.betTracker.create({
      anGameId: 8802804, sport: "MLB", gameDate: D_FILTER,
      awayTeam: "NYM", homeTeam: "ATL", market: "ML", pickSide: "AWAY",
      odds: -110, risk: 100, riskUnits: 2,   // no toWinUnits sent
    });
    createdBetIds.add((bet as { id: number }).id);
    expect((bet as { toWinUnits: string | null }).toWinUnits).toBe("1.8182"); // 90.91 × 2 / 100
  });

  it("[DEN-5] an owner dollar restatement keeps the pair coherent", async () => {
    const caller = await callerFor(U_OWNERBET, "owner");
    const bet = await caller.betTracker.create({
      anGameId: 8802805, sport: "MLB", gameDate: D_FILTER,
      awayTeam: "NYM", homeTeam: "ATL", market: "ML", pickSide: "AWAY",
      odds: -110, risk: 100, riskUnits: 1,
    });
    const id = (bet as { id: number }).id; createdBetIds.add(id);
    const updated = await caller.betTracker.update({ id, risk: 250 });
    expect(updated).toMatchObject({ risk: "250.00", riskUnits: "2.5000", toWin: "227.27", toWinUnits: "2.2727" });
  });
```

(Reuse existing user constants if suitable or add one fixture user in the suite's `beforeAll`/`insertUser` pattern; keep IDs inside the suite's cleanup namespace.)

- [ ] **Step 2: Run against local mysql:8** (CI recipe):

```sh
docker run -d --name dime-test-mysql -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_DATABASE=dime_test -p 3306:3306 mysql:8
until mysqladmin ping -h 127.0.0.1 --silent 2>/dev/null; do sleep 2; done
DATABASE_URL='mysql://root@127.0.0.1:3306/dime_test' pnpm db:migrate:reconciled
DATABASE_URL='mysql://root@127.0.0.1:3306/dime_test' DB_TESTS=1 NODE_ENV=test \
  pnpm exec vitest run --no-file-parallelism server/betTrackerLifecycle.db.test.ts --reporter=verbose
```

Expected: the DEN tests FAIL before Tasks 3-4 land, PASS after (order the run after implementation; the failing-first evidence comes from running this task's tests against a stashed pre-fix checkout or accepting the source-scan failures as the red step).

- [ ] **Step 3: Commit** `test(bet-tracker): DB proof — denomination gate and pair coherence under update`

### Task 8: Full verification (CI parity) + plan file

- [ ] `pnpm exec tsc --noEmit` (expect clean; CI uses `NODE_OPTIONS=--max-old-space-size=6144`)
- [ ] `env -u DATABASE_URL pnpm exec vitest run` (non-DB suite, full)
- [ ] All ten DB suites against the docker MySQL: the CI command verbatim (`appUsers.login`, `appUsers.register`, `completeAccountSetup`, `passwordReset`, `tokenVersion`, `mlbDoubleheader`, `betTrackerParlay`, `betTrackerParlayRecovery`, `betTrackerLifecycle`, `betTrackerStats`)
- [ ] `pnpm run build` (production build sanity)
- [ ] Commit the plan file; push branch; PR with the audit table in the body

**Risks / unknowns:**
- `reviewEditRequest`'s earlier `bet` select must expose `risk/toWin/riskUnits/toWinUnits/legCount` — verify and extend the select if it's a narrow projection.
- `betTrackerParlay.db.test.ts` fixtures may send explicit `toWinUnits` that the unchanged `resolveToWinUnits` precedence still honors — create-path behavior is intentionally byte-compatible, so no drift expected; the full DB run proves it.
- `stakeDenomination.test.ts`'s existing scan `expect(fn).toMatch(...)` patterns must keep passing — the update rewrite must not rename `assertUnitDenomination` or `decideStakeDenomination`.
