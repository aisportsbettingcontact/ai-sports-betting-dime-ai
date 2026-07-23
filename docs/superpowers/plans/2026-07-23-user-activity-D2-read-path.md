# User Activity — D2 Read Path (device-aware overview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the device-aware analytics collected in `MySQL: Dime AI` on the admin **User Activity** page — value-based DAU/WAU/MAU + a **device mix** cut — through the same role-gated proxy the write path uses, shipping **inert** (honest `not_measured` until the pipeline is enabled and data exists).

**Architecture:** Mirrors the write path. The **store** instance (`ai-sports-betting-backend`, `ANALYTICS_ROLE=store`) queries `analytics_events` in the dedicated MySQL and returns an `AnalyticsOverview` with honest per-metric states. The **web** instance (forwarder) exposes an owner-only tRPC query `analytics.overview` that fetches the overview from the backend over the private line (`USER_ACTIVITY_BACKEND_URL` + shared secret); when the pipeline is `disabled` it returns `not_measured` without touching any DB. A new owner-only `DeviceActivityPanel` renders it on `/admin/activity` below the existing `MetricsPanel`.

**Tech Stack:** TypeScript (strict), tRPC + Drizzle/mysql2 + Zod (server), React + wouter (client), Vitest, Node v22 (global `fetch`).

## Global Constraints

- **TypeScript strict; `npx tsc --noEmit` must pass** (`NODE_OPTIONS=--max-old-space-size=6144`).
- **Bundle budget `npm run check:bundle`** — chat-critical-path ceiling 215,882 B gzip. The admin page + panel are NOT on the chat critical path (admin routes are separate), but re-verify after UI changes.
- **Server-gated / inert:** reads return honest `not_measured` when the pipeline is `disabled` (web never queries TiDB; `getAnalyticsRole()` default `"disabled"`). The read path must ship dormant and safe with zero backend/DB configured.
- **Honest data-states (owner directive):** never a fabricated `0`. Reuse the existing `MetricPoint` vocabulary from `server/analytics/metricDefinitions.ts` (`ok` / `not_measured` / `incomplete` / `unknown`) — `0` only for a genuine measured zero over complete coverage.
- **Store-role hard guard:** every DB-reading entry point calls `guard()`/`isAnalyticsStore()` and throws otherwise, so read code can never touch the product TiDB. Never throws to the product: read failures degrade to `not_measured`, not exceptions.
- **Owner-only:** the browser-facing query is `ownerProcedure` (server-verified), same boundary as `metrics.*`. The backend internal route requires the shared secret (constant-time compare) and 404s unless store role.
- **Guardrails:** reads expose only aggregates (counts, distinct-user counts, device buckets) — never per-user rows, wager/PII, chat text, or raw props. `is_test=1` events are excluded from every number.
- **Active = value events only:** DAU/WAU/MAU count DISTINCT users with ≥1 qualifying (`QUALIFYING_EVENTS`) event in the window. Sessions/screen/device are diagnostics, never the active numerator.

---

## File Structure

**Create:**
- `server/analytics/read.ts` — `getAnalyticsOverview()` (store-guarded MySQL query) + pure window/shape helpers + `AnalyticsOverview` type.
- `server/analytics/read.test.ts`
- `server/analytics/readRoute.ts` — `registerAnalyticsReadRoute(app)` → `GET /api/internal/analytics/overview`.
- `server/analytics/readRoute.test.ts`
- `server/analytics/readForward.ts` — `forwardOverviewRead()` (web → backend GET, secret-authed, never throws).
- `server/analytics/readForward.test.ts`
- `client/src/pages/admin/DeviceActivityPanel.tsx` — owner-only device-aware panel.
- `client/src/pages/admin/DeviceActivityPanel.test.tsx`

**Modify:**
- `server/routers/analytics.ts` — add `overview` ownerProcedure (role-routes forwarder/store/disabled).
- `server/analytics/analytics.test.ts` — assert the overview procedure contract.
- `server/_core/index.ts` — `registerAnalyticsReadRoute(app);` next to the ingest route registration.
- `client/src/pages/UserActivity.tsx` — render `<DeviceActivityPanel />` below `<MetricsPanel />`.

---

## Shared types (defined in `read.ts`, consumed everywhere)

```ts
import type { MetricPoint } from "./metricDefinitions";

/** One device_type row of the mix (coarse buckets only — no PII). */
export interface DeviceSlice {
  deviceType: string;   // 'mobile' | 'tablet' | 'desktop' | 'unknown'
  users: number;        // distinct source_user_id (is_test=0)
  valueEvents: number;  // qualifying events on this device
}

/** The admin overview payload. Every numeric metric is an honest MetricPoint. */
export interface AnalyticsOverview {
  state: "ok" | "not_measured" | "error";
  reason: string | null;
  asOf: number;                 // server clock at query time (UTC ms)
  dau: MetricPoint;             // distinct value-users [asOf-24h, asOf)
  wau: MetricPoint;             // distinct value-users [asOf-7d, asOf)
  mau: MetricPoint;             // distinct value-users [asOf-30d, asOf)
  valueEventsTotal: MetricPoint;// all qualifying events ever (is_test=0)
  lastEventAt: number | null;   // max(occurred_at_utc) — freshness; null if none
  deviceMix: DeviceSlice[];     // by device_type (may be empty ⇒ not_measured)
}
```

---

## Task 1: Backend read query (`read.ts`) — store-guarded overview

**Files:** Create `server/analytics/read.ts`, `server/analytics/read.test.ts`.

**Interfaces:**
- Consumes: `getDb` (`../db`), `isAnalyticsStore` (`./config`), `QUALIFYING_EVENTS` (`./events`), `MetricPoint`/`ok`/`notMeasured` (`./metricDefinitions`).
- Produces: `overviewWindows(asOf: number): { dayFrom: number; weekFrom: number; monthFrom: number }`; `disabledOverview(reason: string): AnalyticsOverview`; `getAnalyticsOverview(): Promise<AnalyticsOverview>`; the `DeviceSlice`/`AnalyticsOverview` types.

- [ ] **Step 1: Write the failing test**

```ts
// server/analytics/read.test.ts
import { describe, it, expect } from "vitest";
import { overviewWindows, disabledOverview } from "./read";

describe("overviewWindows", () => {
  it("computes half-open UTC windows from asOf", () => {
    const asOf = 1_000_000_000_000;
    const w = overviewWindows(asOf);
    expect(asOf - w.dayFrom).toBe(24 * 60 * 60 * 1000);
    expect(asOf - w.weekFrom).toBe(7 * 24 * 60 * 60 * 1000);
    expect(asOf - w.monthFrom).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("disabledOverview", () => {
  it("is an honest not_measured payload with no fabricated zeros", () => {
    const o = disabledOverview("analytics pipeline disabled");
    expect(o.state).toBe("not_measured");
    expect(o.dau.state).toBe("not_measured");
    expect(o.dau.value).toBeNull();
    expect(o.deviceMix).toEqual([]);
    expect(o.reason).toMatch(/disabled/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run server/analytics/read.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// server/analytics/read.ts
/**
 * read.ts — device-aware admin overview from the DEDICATED MySQL: Dime AI.
 * Store-role only (guard()); never touches TiDB. Read failures degrade to an
 * honest not_measured payload — never throws to the product. Aggregates only
 * (counts / distinct users / device buckets) — no per-user rows, no PII.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { isAnalyticsStore } from "./config";
import { QUALIFYING_EVENTS } from "./events";
import { ok, notMeasured, type MetricPoint } from "./metricDefinitions";

const TAG = "[analytics][read]";
const DAY = 24 * 60 * 60 * 1000;

export interface DeviceSlice { deviceType: string; users: number; valueEvents: number; }
export interface AnalyticsOverview {
  state: "ok" | "not_measured" | "error";
  reason: string | null;
  asOf: number;
  dau: MetricPoint; wau: MetricPoint; mau: MetricPoint;
  valueEventsTotal: MetricPoint;
  lastEventAt: number | null;
  deviceMix: DeviceSlice[];
}

export function overviewWindows(asOf: number) {
  return { dayFrom: asOf - DAY, weekFrom: asOf - 7 * DAY, monthFrom: asOf - 30 * DAY };
}

const NO_DATA = "No analytics events recorded yet — the pipeline is enabled but no qualifying events have arrived.";

export function disabledOverview(reason: string): AnalyticsOverview {
  const asOf = Date.now();
  return {
    state: "not_measured", reason, asOf,
    dau: notMeasured(reason), wau: notMeasured(reason), mau: notMeasured(reason),
    valueEventsTotal: notMeasured(reason), lastEventAt: null, deviceMix: [],
  };
}

function numAt(rows: unknown, key = "n"): number {
  const arr = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] })?.rows;
  const first = Array.isArray(arr) ? (arr[0] as Record<string, unknown>) : undefined;
  const v = first?.[key];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

/** Owner-directive honest overview. Store-role only. Never throws. */
export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  if (!isAnalyticsStore()) return disabledOverview("analytics store not configured on this instance");
  const asOf = Date.now();
  const { dayFrom, weekFrom, monthFrom } = overviewWindows(asOf);
  try {
    const db = await getDb();
    if (!db) return disabledOverview("analytics database unavailable");
    const names = QUALIFYING_EVENTS as readonly string[];

    const distinct = async (from: number): Promise<number> => {
      const r = await db.execute(sql`
        SELECT COUNT(DISTINCT source_user_id) AS n FROM analytics_events
        WHERE is_test = 0 AND event_name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
          AND occurred_at_utc >= ${from} AND occurred_at_utc < ${asOf}`);
      return numAt(r);
    };
    const dauN = await distinct(dayFrom);
    const wauN = await distinct(weekFrom);
    const mauN = await distinct(monthFrom);

    const totalR = await db.execute(sql`
      SELECT COUNT(*) AS n FROM analytics_events
      WHERE is_test = 0 AND event_name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`);
    const total = numAt(totalR);

    const freshR = await db.execute(sql`SELECT MAX(occurred_at_utc) AS n FROM analytics_events WHERE is_test = 0`);
    const lastEventAt = numAt(freshR) || null;

    const mixR = await db.execute(sql`
      SELECT COALESCE(device_type,'unknown') AS device_type,
             COUNT(DISTINCT source_user_id) AS users,
             SUM(CASE WHEN event_name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)}) THEN 1 ELSE 0 END) AS value_events
      FROM analytics_events WHERE is_test = 0 GROUP BY COALESCE(device_type,'unknown')`);
    const mixRows = (Array.isArray(mixR) ? mixR : (mixR as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
    const deviceMix: DeviceSlice[] = mixRows.map((r) => ({
      deviceType: String(r.device_type ?? "unknown"),
      users: Number(r.users ?? 0) || 0,
      valueEvents: Number(r.value_events ?? 0) || 0,
    }));

    // No events at all ⇒ honest not_measured (nothing instrumented yet).
    if (lastEventAt === null && total === 0) return disabledOverview(NO_DATA);

    return {
      state: "ok", reason: null, asOf,
      dau: ok(dauN), wau: ok(wauN), mau: ok(mauN),
      valueEventsTotal: ok(total), lastEventAt, deviceMix,
    };
  } catch (err) {
    console.warn(`${TAG} overview failed: ${(err as Error).message}`);
    return { ...disabledOverview("analytics overview query failed"), state: "error" };
  }
}
```

- [ ] **Step 4: Run test** — `npx vitest run server/analytics/read.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add server/analytics/read.ts server/analytics/read.test.ts && git commit -m "feat(analytics): D2 store-guarded device-aware overview query"`

---

## Task 2: Backend read route (`readRoute.ts`)

**Files:** Create `server/analytics/readRoute.ts`, `server/analytics/readRoute.test.ts`. Modify `server/_core/index.ts`.

**Interfaces:**
- Consumes: `isAnalyticsStore`, `getIngestSecret`, `secretsMatch` (`./config`); `getAnalyticsOverview` (Task 1); an Express `app`.
- Produces: `registerAnalyticsReadRoute(app: import("express").Express): void` → `GET /api/internal/analytics/overview`.

- [ ] **Step 1: Write the failing test** (source-contract, mirrors `ingestRoute` testing style)

```ts
// server/analytics/readRoute.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.join(import.meta.dirname, "readRoute.ts"), "utf8");
describe("analytics read route", () => {
  it("serves GET /api/internal/analytics/overview", () => {
    expect(src).toMatch(/app\.get\(\s*["'`]\/api\/internal\/analytics\/overview/);
  });
  it("404s unless store role and 401s on secret mismatch", () => {
    expect(src).toMatch(/isAnalyticsStore/);
    expect(src).toMatch(/secretsMatch/);
    expect(src).toMatch(/x-analytics-secret/);
  });
  it("never leaks the private host in a browser-facing way (internal only)", () => {
    expect(src).not.toMatch(/railway\.internal/);
  });
});
```

- [ ] **Step 2: Run test** — FAIL (module missing).
- [ ] **Step 3: Write minimal implementation**

```ts
// server/analytics/readRoute.ts
/**
 * readRoute.ts — PRIVATE backend read endpoint for the admin overview. Called
 * only by the web instance's owner-gated proxy over the private line. 404s
 * unless this instance is the store; 401s unless the shared secret matches.
 */
import type { Express, Request, Response } from "express";
import { isAnalyticsStore, getIngestSecret, secretsMatch } from "./config";
import { getAnalyticsOverview } from "./read";

const TAG = "[analytics][readRoute]";

export function registerAnalyticsReadRoute(app: Express): void {
  app.get("/api/internal/analytics/overview", async (req: Request, res: Response) => {
    if (!isAnalyticsStore()) return res.status(404).json({ error: "not_found" });
    const secret = getIngestSecret();
    if (!secret || !secretsMatch(req.header("x-analytics-secret"), secret)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const overview = await getAnalyticsOverview();
      return res.status(200).json(overview);
    } catch (err) {
      console.warn(`${TAG} failed: ${(err as Error).message}`);
      return res.status(200).json({ state: "error", reason: "overview failed", asOf: Date.now(), deviceMix: [] });
    }
  });
}
```

- [ ] **Step 4: Register it** — in `server/_core/index.ts`, next to `registerAnalyticsIngestRoute(app);` add:

```ts
import { registerAnalyticsReadRoute } from "../analytics/readRoute";
// ... beside the ingest registration:
registerAnalyticsReadRoute(app);
```

- [ ] **Step 5: Run test + typecheck** — `npx vitest run server/analytics/readRoute.test.ts && npx tsc --noEmit` → PASS / clean.
- [ ] **Step 6: Commit** — `git add server/analytics/readRoute.ts server/analytics/readRoute.test.ts server/_core/index.ts && git commit -m "feat(analytics): D2 private backend read route (store-gated + secret)"`

---

## Task 3: Web read-forward (`readForward.ts`)

**Files:** Create `server/analytics/readForward.ts`, `server/analytics/readForward.test.ts`.

**Interfaces:**
- Consumes: `getBackendUrl`, `getIngestSecret` (`./config`); `AnalyticsOverview`, `disabledOverview` (Task 1).
- Produces: `forwardOverviewRead(fetchImpl?: typeof fetch): Promise<AnalyticsOverview>` — GETs the backend overview with the secret; on any failure returns `disabledOverview(...)`. Never throws.

- [ ] **Step 1: Write the failing test**

```ts
// server/analytics/readForward.test.ts
import { describe, it, expect } from "vitest";
import { forwardOverviewRead } from "./readForward";

describe("forwardOverviewRead", () => {
  it("returns not_measured when not configured (no backend URL/secret)", async () => {
    const o = await forwardOverviewRead(async () => new Response("{}", { status: 200 }));
    expect(o.state).toBe("not_measured");
  });
  it("never throws on a network error", async () => {
    const o = await forwardOverviewRead(async () => { throw new Error("boom"); });
    expect(["not_measured", "error"]).toContain(o.state);
  });
});
```

- [ ] **Step 2: Run test** — FAIL (module missing).
- [ ] **Step 3: Write minimal implementation**

```ts
// server/analytics/readForward.ts
/**
 * readForward.ts — the web (forwarder) fetches the admin overview from the back
 * office over the PRIVATE line, authenticated with the shared secret. Server-to-
 * server only; never throws — a failed read degrades to an honest not_measured.
 */
import { getBackendUrl, getIngestSecret } from "./config";
import { disabledOverview, type AnalyticsOverview } from "./read";

const TAG = "[analytics][readForward]";

export async function forwardOverviewRead(fetchImpl: typeof fetch = fetch): Promise<AnalyticsOverview> {
  const base = getBackendUrl();
  const secret = getIngestSecret();
  if (!base || !secret) return disabledOverview("analytics backend not configured");
  try {
    const res = await fetchImpl(`${base}/api/internal/analytics/overview`, {
      method: "GET",
      headers: { "x-analytics-secret": secret },
    });
    if (!res.ok) {
      console.warn(`${TAG} back office returned ${res.status}`);
      return disabledOverview(`analytics backend returned ${res.status}`);
    }
    return (await res.json()) as AnalyticsOverview;
  } catch (err) {
    console.warn(`${TAG} read failed: ${(err as Error).message}`);
    return { ...disabledOverview("analytics backend unreachable"), state: "error" };
  }
}
```

- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** — `git add server/analytics/readForward.ts server/analytics/readForward.test.ts && git commit -m "feat(analytics): D2 web read-forward (private, secret-authed, never throws)"`

---

## Task 4: tRPC `analytics.overview` owner query

**Files:** Modify `server/routers/analytics.ts`, `server/analytics/analytics.test.ts`.

**Interfaces:**
- Consumes: `ownerProcedure` (`./appUsers`); `getAnalyticsRole` (`../analytics/config`); `getAnalyticsOverview` (Task 1); `forwardOverviewRead` (Task 3); `disabledOverview` (Task 1).
- Produces: `analyticsRouter.overview` — owner-only query returning `AnalyticsOverview` (forwarder → forwardOverviewRead; store → getAnalyticsOverview; disabled → disabledOverview). Never throws.

- [ ] **Step 1: Add the procedure** — in `server/routers/analytics.ts`, add imports and a second procedure alongside `track`:

```ts
import { appUserProcedure, ownerProcedure } from "./appUsers";
// ...existing imports plus:
import { getAnalyticsRole } from "../analytics/config";
import { getAnalyticsOverview, forwardOverviewRead, disabledOverview } from "../analytics/read"; // forwardOverviewRead re-exported? No — import from readForward:
```

Actual imports to add:
```ts
import { ownerProcedure } from "./appUsers";
import { getAnalyticsRole } from "../analytics/config";
import { getAnalyticsOverview, disabledOverview } from "../analytics/read";
import { forwardOverviewRead } from "../analytics/readForward";
```

Add to the `router({ ... })` object (after `track`):
```ts
  overview: ownerProcedure.query(async () => {
    const role = getAnalyticsRole();
    try {
      if (role === "forwarder") return await forwardOverviewRead();
      if (role === "store") return await getAnalyticsOverview();
      return disabledOverview("analytics pipeline disabled");
    } catch {
      return disabledOverview("analytics overview unavailable");
    }
  }),
```

- [ ] **Step 2: Add the contract test** — append to `server/analytics/analytics.test.ts`:

```ts
describe("analytics router exposes an owner-gated overview", () => {
  it("routes overview by role and never queries TiDB from the web", () => {
    expect(src).toMatch(/overview:\s*ownerProcedure\.query/);
    expect(src).toMatch(/forwardOverviewRead/);
    expect(src).toMatch(/getAnalyticsOverview/);
  });
});
```

- [ ] **Step 3: Run tests + typecheck** — `npx vitest run server/analytics/ && npx tsc --noEmit` → PASS / clean.
- [ ] **Step 4: Commit** — `git add server/routers/analytics.ts server/analytics/analytics.test.ts && git commit -m "feat(analytics): D2 owner-gated analytics.overview query (role-routed)"`

---

## Task 5: `DeviceActivityPanel` UI + mount

**Files:** Create `client/src/pages/admin/DeviceActivityPanel.tsx`, `client/src/pages/admin/DeviceActivityPanel.test.tsx`. Modify `client/src/pages/UserActivity.tsx`.

**Interfaces:**
- Consumes: `trpc.analytics.overview` (Task 4). Mirrors `MetricsPanel`'s `PointLike` honest-state rendering.
- Produces: default-exported `DeviceActivityPanel`.

- [ ] **Step 1: Write the failing test** (pure render-shape contract — no network)

```tsx
// client/src/pages/admin/DeviceActivityPanel.test.tsx
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.join(import.meta.dirname, "DeviceActivityPanel.tsx"), "utf8");
describe("DeviceActivityPanel", () => {
  it("reads the owner-gated overview query", () => {
    expect(src).toMatch(/trpc\.analytics\.overview\.useQuery/);
  });
  it("renders honest states, never a fabricated zero", () => {
    expect(src).toMatch(/Not measured|not_measured/);
    expect(src).toMatch(/deviceMix/);
  });
});
```

- [ ] **Step 2: Run test** — FAIL (module missing).
- [ ] **Step 3: Write minimal implementation**

```tsx
// client/src/pages/admin/DeviceActivityPanel.tsx
/**
 * DeviceActivityPanel — device-aware slice of the admin User Activity page,
 * fed by the dedicated MySQL: Dime AI via the owner-gated analytics.overview
 * proxy. Honest states (owner directive): renders "Not measured" with the exact
 * reason when the pipeline is disabled or no qualifying events exist yet — never
 * a fabricated 0. Ships inert: shows a clear "pipeline not enabled" state until
 * the Railway vars are set. Owner-only (query is ownerProcedure).
 */
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";

type PointLike = { state: string; value: number | null; reason: string | null };
const STATE_LABEL: Record<string, string> = { not_measured: "Not measured", incomplete: "Incomplete", stale: "Stale", unknown: "Unknown", error: "Unavailable" };

function Point({ point, loading }: { point: PointLike | undefined; loading: boolean }) {
  if (loading || !point) return <span className="text-muted-foreground">—</span>;
  if (point.state === "ok" && point.value !== null) return <span className="text-primary">{point.value}</span>;
  return <span className="text-muted-foreground" title={point.reason ?? undefined}>{STATE_LABEL[point.state] ?? "—"}</span>;
}

export default function DeviceActivityPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, { refetchInterval: 60_000 });
  const kpis: Array<{ label: string; sub: string; point: PointLike | undefined }> = [
    { label: "DAILY VALUE USERS", sub: "≥1 value event · last 24h", point: data?.dau },
    { label: "WEEKLY VALUE USERS", sub: "≥1 value event · last 7d", point: data?.wau },
    { label: "MONTHLY VALUE USERS", sub: "≥1 value event · last 30d", point: data?.mau },
    { label: "VALUE EVENTS", sub: "Qualifying events · all time", point: data?.valueEventsTotal },
  ];
  const notOk = data && data.state !== "ok";
  const mix = data?.deviceMix ?? [];
  const maxUsers = Math.max(...mix.map((m) => m.users), 1);

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.15em] text-foreground uppercase">Device-Aware Activity</span>
        <div className="flex-1 h-px bg-card" />
        {isLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin" />}
      </div>

      {notOk && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 text-center">
          <div className="text-sm font-semibold text-muted-foreground">{STATE_LABEL[data!.state] ?? "Not measured"}</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
            {data!.reason ?? "The device-aware analytics pipeline has produced no data yet."}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden">
            <div className="text-base sm:text-xl font-bold font-mono truncate"><Point point={k.point} loading={isLoading} /></div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Device mix — the D2 cut. Renders only when there is measured data. */}
      {!notOk && mix.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase mb-2">Device Mix · distinct users</div>
          <div className="space-y-1.5">
            {mix.map((m) => (
              <div key={m.deviceType} className="flex items-center gap-2">
                <span className="text-[10px] sm:text-xs font-mono w-16 shrink-0 text-foreground capitalize">{m.deviceType}</span>
                <div className="flex-1 h-3 rounded bg-muted/60 overflow-hidden">
                  <div className="h-full rounded bg-primary transition-all duration-500" style={{ width: `${Math.max((m.users / maxUsers) * 100, m.users > 0 ? 4 : 0)}%` }} title={`${m.deviceType}: ${m.users} users, ${m.valueEvents} value events`} />
                </div>
                <span className="text-[10px] sm:text-xs font-mono w-8 text-right text-foreground">{m.users}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount it** — in `client/src/pages/UserActivity.tsx`, import and render below `<MetricsPanel />`:

```tsx
import DeviceActivityPanel from "@/pages/admin/DeviceActivityPanel";
// ...inside the content div, after <MetricsPanel />:
          <DeviceActivityPanel />
```

- [ ] **Step 5: Run tests + typecheck + bundle** — `npx vitest run client/src/pages/admin/DeviceActivityPanel.test.tsx && npx tsc --noEmit && npm run check:bundle` → PASS / clean / under budget.
- [ ] **Step 6: Commit** — `git add client/src/pages/admin/DeviceActivityPanel.tsx client/src/pages/admin/DeviceActivityPanel.test.tsx client/src/pages/UserActivity.tsx && git commit -m "feat(analytics): D2 device-aware activity panel on /admin/activity"`

---

## Phase Verification
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run server/analytics/ client/src/pages/admin/` green.
- [ ] `npm run check:bundle` under 215,882 B.
- [ ] Inert proof: with no `ANALYTICS_ROLE`/`USER_ACTIVITY_BACKEND_URL`, `analytics.overview` returns `disabledOverview` (`state: "not_measured"`) — no TiDB read, panel shows the honest not-enabled state.
- [ ] Guardrail scan: overview exposes only aggregate counts + device buckets; `is_test=0` filter present; no per-user rows/PII.

## Risks / Unknowns
- **mysql2 result shape** — `db.execute(sql\`\`)` returns a driver-specific shape; `numAt`/row extraction defends across `[rows]` vs `{rows}` like the existing `store.ts`. Verify against the store's existing extraction idiom.
- **Empty-table read** — if `analytics_events` was never created (no ingest yet), the query throws; caught → `not_measured` (state error/not_measured), never a crash. The `lastEventAt === null && total === 0` branch also yields honest `not_measured`.
- **Bundle** — admin route is off the chat critical path; still gate on `check:bundle`.

## Out of Scope (D2 slice)
- `analytics_device_day` rollup materialization (add only if query evidence needs it; on-read aggregation suffices at current scale).
- Per-page screen-time, retention curves, power-user score, research/founder queues (D4/D5).
- Trends/time-series endpoints, pagination, CSV export.

## Execution dispatch (subagent waves)
- **Wave A (parallel):** Task 1 (read query), Task 3 (read-forward) — disjoint files. (Task 3 imports types from Task 1 but only `disabledOverview`/`AnalyticsOverview`; run Task 1 first or hand Task 3 the type signatures.)
- **Wave B:** Task 2 (read route — needs Task 1).
- **Wave C:** Task 4 (tRPC overview — needs Tasks 1 + 3).
- **Wave D:** Task 5 (UI panel — needs Task 4 shape).
- **Wave E:** Phase verification + whole-branch review.
