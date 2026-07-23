# User Activity — Device Resolver (D0) + P0 Emitters (D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a device/platform block (mobile·tablet·desktop + os/browser/shell/viewport signals) on every User-Activity analytics event, then wire the P0 device-tagged emitters (screen_viewed, session_started, login, chat_response_completed, projection_evaluation_viewed).

**Architecture:** The client attaches a coarse, dependency-free device block (`client/src/lib/deviceContext.ts`) plus a low-cardinality `route` pattern to every envelope. The server derives the authoritative `device_type/os_family/browser_family` from the request User-Agent (`server/analytics/device.ts`), reconciles it against the client's viewport/pointer signals, and persists the merged block. Event routing (forward→backend / store→MySQL: Dime AI / disabled) is centralised in one `dispatchStoredEvent()` used by both the browser-facing tRPC mutation and a new server-side emitter (for `login`). Everything ships **inert** — the pipeline stays `disabled` until the Railway vars are set — and stays off chat's critical-path bundle where required.

**Tech Stack:** TypeScript (strict), React + wouter (client), tRPC + Drizzle/mysql2 + Zod (server), Vitest, Node v22 (global `fetch`, `crypto.randomUUID`).

## Global Constraints

- **TypeScript strict; `npx tsc --noEmit` must pass** (CI runs it with `NODE_OPTIONS=--max-old-space-size=6144`).
- **Bundle budget gate `npm run check:bundle`** — chat-critical-path ceiling 215,882 B gzip. `DimeChatPage` is direct-imported (critical-path); anything it imports counts. `DimeModelFeed`, `BetTracker`, `SessionTracker`, and any new island must stay **lazy-loaded**.
- **Server-gated / inert:** emitters must be no-ops in production until `ANALYTICS_ROLE=store` (backend) or `USER_ACTIVITY_BACKEND_URL` (web) is set. No client rebuild required to enable.
- **Analytics never breaks the product:** every emit path is fire-and-forget and swallows all errors.
- **Guardrails (enforced):** no wager amounts/odds/stakes/losses, no chat/search text or prompts, no raw URLs-with-ids, no PII, no credentials. Props are allowlisted scalars (≤20 keys / ≤256 chars). Device fields are **coarse buckets/families only — never fingerprints**. `qualifies_active` stays **value-events-only**; session/screen/device signals are engagement diagnostics that never inflate the active numerator. Power-user ranking never uses betting signals.
- **Identity is server-derived:** `source_user_id = ctx.appUser.id` (tRPC) or the authenticated `user.id` (server emit). Client identity claims are ignored.
- **`route` is always a path *pattern*** (`/feed/model/:sport`, `/mlb/team/:slug`) — never a concrete URL with ids/slugs/dates.
- **`server/analytics/*` runs the SAME build on both Railway services** — role is resolved per-instance; store code hard-guards on `isAnalyticsStore()`.

---

## File Structure

**Create:**
- `client/src/lib/deviceContext.ts` — pure client device-signal helpers + `buildClientDeviceContext()`.
- `client/src/lib/deviceContext.test.ts`
- `client/src/lib/routePattern.ts` — `toRoutePattern(pathname)`.
- `client/src/lib/routePattern.test.ts`
- `client/src/components/ScreenViewTracker.tsx` — lazy render-null island emitting `screen_viewed` on route change.
- `server/analytics/device.ts` — `deriveDeviceFromUA()` + `reconcileDeviceType()`.
- `server/analytics/device.test.ts`
- `server/analytics/dispatch.ts` — `dispatchStoredEvent()` (DRY role routing).
- `server/analytics/dispatch.test.ts`
- `server/analytics/emitServer.ts` — `emitServerEvent()` (server-side, UA-only device).
- `server/analytics/emitServer.test.ts`

**Modify:**
- `server/analytics/events.ts` — broaden event allowlist (`ALL_EVENTS`), add `qualifiesActive()`, add device/route fields to `trackInputSchema`.
- `server/analytics/events.test.ts` — cover the new names + fields.
- `server/analytics/store.ts` — extend `StoredEvent`, CREATE-TABLE DDL, and INSERT with device/route columns.
- `server/analytics/store.test.ts` — assert the DDL/INSERT contract.
- `server/routers/analytics.ts` — use `dispatchStoredEvent`; derive+reconcile device from `ctx.req` UA; populate device/route.
- `server/analytics/analytics.test.ts` (router source-contract) — assert device derivation.
- `client/src/lib/analytics.ts` — broaden event union to `AnalyticsEventName`; attach device block + route in `buildClientEnvelope`.
- `client/src/lib/analytics.test.ts` — assert envelope carries the device block.
- `client/src/hooks/useSessionTracking.ts` — optional `onSessionOpen` callback.
- `client/src/hooks/useSessionTracking.test.ts` (if present; else add) — cover the callback.
- `client/src/components/SessionTracker.tsx` — fire `session_started` via `useAnalytics`.
- `client/src/pages/dime-shell/DimeAppShell.tsx` — mount lazy `ScreenViewTracker`.
- `client/src/pages/dime-chat/DimeChatPage.tsx` — emit `chat_response_completed` at `stream_done`.
- `client/src/pages/DimeModelFeed.tsx` — emit `projection_evaluation_viewed` on complete/fresh/non-empty render.
- `server/routers/appUsers.ts` — emit server-side `login` after `updateAppUserLastSignedIn`.
- `analytics-backend/migrations/0001_user_activity_init.sql` — mirror device/route columns for doc parity (not applied from here).

---

## Phase D0 — Device foundation

### Task 1: Client device-signal helpers (independent)

**Files:**
- Create: `client/src/lib/deviceContext.ts`
- Test: `client/src/lib/deviceContext.test.ts`

**Interfaces:**
- Produces: `type ViewportClass = "xs"|"sm"|"md"|"lg"|"xl"`; `interface ClientDeviceContext { viewportClass: ViewportClass; orientation: "portrait"|"landscape"; isTouch: boolean; pointerType: "fine"|"coarse"|"none"; isStandalone: boolean; connectionClass: "slow-2g"|"2g"|"3g"|"4g"|"unknown"; appSurface: "web-desktop-shell"|"web-mobile-shell"|"web-responsive" }`; `getViewportClass(width?: number): ViewportClass`; `getAppSurface(pathname: string, vc: ViewportClass): ClientDeviceContext["appSurface"]`; `buildClientDeviceContext(): ClientDeviceContext`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/lib/deviceContext.test.ts
import { describe, it, expect } from "vitest";
import { getViewportClass, getAppSurface, buildClientDeviceContext } from "./deviceContext";

describe("getViewportClass", () => {
  it("buckets width at the 480/768/1024/1440 boundaries", () => {
    expect(getViewportClass(320)).toBe("xs");
    expect(getViewportClass(600)).toBe("sm");
    expect(getViewportClass(800)).toBe("md");   // the 768 device boundary
    expect(getViewportClass(1200)).toBe("lg");
    expect(getViewportClass(1600)).toBe("xl");
  });
});

describe("getAppSurface", () => {
  it("maps /m/* to the mobile shell", () => {
    expect(getAppSurface("/m/feed", "sm")).toBe("web-mobile-shell");
  });
  it("maps a small viewport on a desktop route to responsive", () => {
    expect(getAppSurface("/feed/model/mlb", "xs")).toBe("web-responsive");
  });
  it("maps a wide viewport to the desktop shell", () => {
    expect(getAppSurface("/chat", "lg")).toBe("web-desktop-shell");
  });
});

describe("buildClientDeviceContext", () => {
  it("never throws and returns coarse buckets only (jsdom)", () => {
    const c = buildClientDeviceContext();
    expect(["xs","sm","md","lg","xl"]).toContain(c.viewportClass);
    expect(["portrait","landscape"]).toContain(c.orientation);
    expect(typeof c.isTouch).toBe("boolean");
    // No raw pixels / fingerprints leak through the public shape.
    expect(c).not.toHaveProperty("width");
    expect(c).not.toHaveProperty("userAgent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/lib/deviceContext.test.ts`
Expected: FAIL — cannot find module `./deviceContext`.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/lib/deviceContext.ts
/**
 * deviceContext.ts — coarse, dependency-free client device signals attached to
 * every analytics envelope. Buckets/families ONLY (never raw px, UA strings, or
 * fingerprints). SSR/jsdom-safe: every reader defends against missing globals.
 * The server derives the authoritative device_type/os/browser from the UA and
 * reconciles it with these signals.
 */
export type ViewportClass = "xs" | "sm" | "md" | "lg" | "xl";

export interface ClientDeviceContext {
  viewportClass: ViewportClass;
  orientation: "portrait" | "landscape";
  isTouch: boolean;
  pointerType: "fine" | "coarse" | "none";
  isStandalone: boolean;
  connectionClass: "slow-2g" | "2g" | "3g" | "4g" | "unknown";
  appSurface: "web-desktop-shell" | "web-mobile-shell" | "web-responsive";
}

/** Bucket a viewport width at the product's real breakpoints (768 = device boundary). */
export function getViewportClass(width?: number): ViewportClass {
  const w = typeof width === "number" ? width : (typeof window !== "undefined" ? window.innerWidth : 1024);
  if (w < 480) return "xs";
  if (w < 768) return "sm";
  if (w < 1024) return "md";
  if (w < 1440) return "lg";
  return "xl";
}

function mm(query: string): boolean {
  try { return typeof window !== "undefined" && !!window.matchMedia?.(query).matches; }
  catch { return false; }
}

function getOrientation(): "portrait" | "landscape" {
  return mm("(orientation: portrait)") ? "portrait" : "landscape";
}

function getPointerType(): "fine" | "coarse" | "none" {
  if (mm("(pointer: coarse)")) return "coarse";
  if (mm("(pointer: fine)")) return "fine";
  return "none";
}

function getIsTouch(): boolean {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number") {
      return navigator.maxTouchPoints > 0;
    }
  } catch { /* ignore */ }
  return mm("(pointer: coarse)");
}

function getIsStandalone(): boolean {
  return mm("(display-mode: standalone)");
}

function getConnectionClass(): ClientDeviceContext["connectionClass"] {
  try {
    const eff = (navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType;
    if (eff === "slow-2g" || eff === "2g" || eff === "3g" || eff === "4g") return eff;
  } catch { /* ignore */ }
  return "unknown";
}

/** /m/* ⇒ mobile shell; small viewport on a desktop route ⇒ responsive; else desktop shell. */
export function getAppSurface(pathname: string, vc: ViewportClass): ClientDeviceContext["appSurface"] {
  if (pathname.startsWith("/m/") || pathname === "/m") return "web-mobile-shell";
  if (vc === "xs" || vc === "sm") return "web-responsive";
  return "web-desktop-shell";
}

/** Build the full client device block. Never throws. */
export function buildClientDeviceContext(): ClientDeviceContext {
  const viewportClass = getViewportClass();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  return {
    viewportClass,
    orientation: getOrientation(),
    isTouch: getIsTouch(),
    pointerType: getPointerType(),
    isStandalone: getIsStandalone(),
    connectionClass: getConnectionClass(),
    appSurface: getAppSurface(pathname, viewportClass),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/lib/deviceContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/deviceContext.ts client/src/lib/deviceContext.test.ts
git commit -m "feat(analytics): D0 client device-context signals (coarse, dep-free)"
```

---

### Task 2: Server UA parser + reconciliation (independent)

**Files:**
- Create: `server/analytics/device.ts`
- Test: `server/analytics/device.test.ts`

**Interfaces:**
- Produces: `type DeviceType = "mobile"|"tablet"|"desktop"`; `interface UaDevice { deviceType: DeviceType; osFamily: string; browserFamily: string }`; `deriveDeviceFromUA(ua: string | undefined | null): UaDevice`; `reconcileDeviceType(uaDevice: DeviceType, clientPointerType?: string | null, clientViewportClass?: string | null): { deviceType: DeviceType; conflict: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// server/analytics/device.test.ts
import { describe, it, expect } from "vitest";
import { deriveDeviceFromUA, reconcileDeviceType } from "./device";

describe("deriveDeviceFromUA", () => {
  it("classifies an iPhone as mobile/ios/safari", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "mobile", osFamily: "ios", browserFamily: "safari" });
  });
  it("classifies an Android phone as mobile/android/chrome", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "mobile", osFamily: "android", browserFamily: "chrome" });
  });
  it("classifies an iPad as tablet/ipados/safari", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "tablet", osFamily: "ipados", browserFamily: "safari" });
  });
  it("classifies an Android tablet (no 'Mobile' token) as tablet", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    expect(deriveDeviceFromUA(ua).deviceType).toBe("tablet");
  });
  it("classifies a Windows desktop as desktop/windows/edge", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "desktop", osFamily: "windows", browserFamily: "edge" });
  });
  it("is safe on empty/undefined UA", () => {
    expect(deriveDeviceFromUA(undefined)).toEqual({ deviceType: "desktop", osFamily: "other", browserFamily: "other" });
  });
});

describe("reconcileDeviceType", () => {
  it("upgrades a desktop-UA touch device (iPadOS-as-Mac) to tablet", () => {
    expect(reconcileDeviceType("desktop", "coarse", "md")).toEqual({ deviceType: "tablet", conflict: true });
  });
  it("upgrades a desktop-UA touch device with a phone viewport to mobile", () => {
    expect(reconcileDeviceType("desktop", "coarse", "xs")).toEqual({ deviceType: "mobile", conflict: true });
  });
  it("leaves a mouse desktop unchanged", () => {
    expect(reconcileDeviceType("desktop", "fine", "xl")).toEqual({ deviceType: "desktop", conflict: false });
  });
  it("trusts the UA for an already-mobile classification", () => {
    expect(reconcileDeviceType("mobile", "fine", "xl")).toEqual({ deviceType: "mobile", conflict: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/analytics/device.test.ts`
Expected: FAIL — cannot find module `./device`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/analytics/device.ts
/**
 * device.ts — server-authoritative device classification from the request
 * User-Agent, plus reconciliation with the client's coarse pointer/viewport
 * signals (resolves the iPadOS-reports-as-Mac case). Coarse FAMILIES only — no
 * version fingerprinting, no PII. Dependency-free (no ua-parser lib).
 */
export type DeviceType = "mobile" | "tablet" | "desktop";

export interface UaDevice {
  deviceType: DeviceType;
  osFamily: string;
  browserFamily: string;
}

function osOf(ua: string): string {
  if (/iPad/.test(ua)) return "ipados";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return "edge";
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/Firefox|FxiOS/.test(ua)) return "firefox";
  if (/Chrome|CriOS|Chromium/.test(ua)) return "chrome";
  if (/Safari/.test(ua)) return "safari";
  return "other";
}

function deviceOf(ua: string): DeviceType {
  if (/iPad/.test(ua)) return "tablet";
  if (/Tablet/.test(ua)) return "tablet";
  // Android: "Mobile" token ⇒ phone, its absence ⇒ tablet.
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "mobile" : "tablet";
  if (/iPhone|iPod/.test(ua)) return "mobile";
  if (/Mobile/.test(ua)) return "mobile";
  return "desktop";
}

/** Coarse device/os/browser families from the UA. Never throws. */
export function deriveDeviceFromUA(ua: string | undefined | null): UaDevice {
  const s = (ua ?? "").toString();
  if (!s) return { deviceType: "desktop", osFamily: "other", browserFamily: "other" };
  return { deviceType: deviceOf(s), osFamily: osOf(s), browserFamily: browserOf(s) };
}

/**
 * Reconcile the UA verdict with client signals. The UA is authoritative EXCEPT
 * the well-known desktop-UA-but-touch case (iPadOS ≥13 reports as Macintosh):
 * a coarse pointer upgrades "desktop" to tablet (or mobile for a phone
 * viewport), and flags the disagreement for data-quality review.
 */
export function reconcileDeviceType(
  uaDevice: DeviceType,
  clientPointerType?: string | null,
  clientViewportClass?: string | null,
): { deviceType: DeviceType; conflict: boolean } {
  if (uaDevice === "desktop" && clientPointerType === "coarse") {
    const phone = clientViewportClass === "xs" || clientViewportClass === "sm";
    return { deviceType: phone ? "mobile" : "tablet", conflict: true };
  }
  return { deviceType: uaDevice, conflict: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/analytics/device.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/analytics/device.ts server/analytics/device.test.ts
git commit -m "feat(analytics): D0 server UA device classifier + reconciliation"
```

---

### Task 3: Broaden the event allowlist + device/route input contract

**Files:**
- Modify: `server/analytics/events.ts`
- Test: `server/analytics/events.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `QUALIFYING_EVENTS` (unchanged 3); `ENGAGEMENT_EVENTS = ["session_started","screen_viewed","login"]`; `ALL_EVENTS` (union) ; `qualifiesActive(name: string): boolean`; `trackInputSchema` gains `route` + the device block fields (all client-supplied, nullish); `TrackInput` type reflects them.

- [ ] **Step 1: Write the failing test** (append to `server/analytics/events.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { trackInputSchema, qualifiesActive, ALL_EVENTS } from "./events";

describe("event allowlist (broadened)", () => {
  it("accepts engagement + value event names", () => {
    for (const n of ["session_started","screen_viewed","login","chat_response_completed","tracker_entry_saved","projection_evaluation_viewed"]) {
      expect(ALL_EVENTS).toContain(n);
    }
  });
  it("qualifies only value events as active", () => {
    expect(qualifiesActive("chat_response_completed")).toBe(true);
    expect(qualifiesActive("tracker_entry_saved")).toBe(true);
    expect(qualifiesActive("screen_viewed")).toBe(false);
    expect(qualifiesActive("session_started")).toBe(false);
    expect(qualifiesActive("login")).toBe(false);
  });
  it("rejects an unknown event name", () => {
    const r = trackInputSchema.safeParse({ eventId: "abc123xyz", eventName: "totally_made_up", schemaVersion: 1, occurredAtUtc: 1 });
    expect(r.success).toBe(false);
  });
});

describe("device/route fields on the input contract", () => {
  it("accepts the coarse device block + route pattern", () => {
    const r = trackInputSchema.safeParse({
      eventId: "abcd1234efgh", eventName: "screen_viewed", schemaVersion: 1, occurredAtUtc: 2,
      route: "/feed/model/:sport", viewportClass: "md", orientation: "portrait",
      isTouch: true, pointerType: "coarse", isStandalone: false, connectionClass: "4g",
      appSurface: "web-mobile-shell",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an out-of-vocabulary viewportClass", () => {
    const r = trackInputSchema.safeParse({
      eventId: "abcd1234efgh", eventName: "screen_viewed", schemaVersion: 1, occurredAtUtc: 2, viewportClass: "huge",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/analytics/events.test.ts`
Expected: FAIL — `qualifiesActive`/`ALL_EVENTS` not exported; new fields not accepted.

- [ ] **Step 3: Write minimal implementation** (edit `server/analytics/events.ts`)

Replace the `QUALIFYING_EVENTS`/`trackInputSchema` region with:

```ts
/** Value-bearing events that qualify a user as "active". */
export const QUALIFYING_EVENTS = [
  "projection_evaluation_viewed",
  "chat_response_completed",
  "tracker_entry_saved",
] as const;
export type QualifyingEvent = (typeof QUALIFYING_EVENTS)[number];

/** Engagement/diagnostic events — NEVER qualify a user as active (P0 set). */
export const ENGAGEMENT_EVENTS = ["session_started", "screen_viewed", "login"] as const;
export type EngagementEvent = (typeof ENGAGEMENT_EVENTS)[number];

/** Every accepted event name. */
export const ALL_EVENTS = [...QUALIFYING_EVENTS, ...ENGAGEMENT_EVENTS] as const;
export type AnalyticsEventName = (typeof ALL_EVENTS)[number];

const QUALIFYING_SET: ReadonlySet<string> = new Set(QUALIFYING_EVENTS);
/** Server-authoritative: does this event count toward the value-based active metric? */
export function qualifiesActive(name: string): boolean {
  return QUALIFYING_SET.has(name);
}

/** Client-supplied envelope (non-authoritative). Server adds/overrides the rest. */
export const trackInputSchema = z.object({
  eventId: z.string().min(8).max(64),
  eventName: z.enum(ALL_EVENTS),
  schemaVersion: z.number().int().min(1).max(1000),
  occurredAtUtc: z.number().int().positive(),
  sessionId: z.string().max(64).nullish(),
  tabId: z.string().max(64).nullish(),
  featureId: z.string().max(64).nullish(),
  surface: z.string().max(32).default("web"),
  outcome: z.string().max(32).nullish(),
  // Low-cardinality route PATTERN only — never a concrete URL with ids.
  route: z.string().max(96).nullish(),
  // Coarse client device block (server derives the authoritative device_type).
  viewportClass: z.enum(["xs", "sm", "md", "lg", "xl"]).nullish(),
  orientation: z.enum(["portrait", "landscape"]).nullish(),
  isTouch: z.boolean().nullish(),
  pointerType: z.enum(["fine", "coarse", "none"]).nullish(),
  isStandalone: z.boolean().nullish(),
  connectionClass: z.enum(["slow-2g", "2g", "3g", "4g", "unknown"]).nullish(),
  appSurface: z.enum(["web-desktop-shell", "web-mobile-shell", "web-responsive"]).nullish(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
});
export type TrackInput = z.infer<typeof trackInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/analytics/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/analytics/events.ts server/analytics/events.test.ts
git commit -m "feat(analytics): D0 broaden event allowlist + device/route input contract"
```

---

### Task 4: Persist device/route columns (store)

**Files:**
- Modify: `server/analytics/store.ts`
- Test: `server/analytics/store.test.ts`
- Modify (doc parity): `analytics-backend/migrations/0001_user_activity_init.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StoredEvent` gains `route?, actionName?, deviceType?, osFamily?, browserFamily?, appSurface?, viewportClass?, orientation?, isTouch?, isStandalone?, connectionClass?` (all `string|null` except the two booleans `boolean|null`). DDL + INSERT carry these columns.

- [ ] **Step 1: Write the failing test** (append to `server/analytics/store.test.ts` — a source-contract test, no live DB)

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "store.ts"), "utf8");
describe("store schema carries the device/route columns", () => {
  for (const col of ["device_type","os_family","browser_family","app_surface","viewport_class","orientation","is_touch","is_standalone","connection_class","route","action_name"]) {
    it(`DDL declares ${col}`, () => expect(src).toContain(col));
  }
  it("INSERT lists device_type and route", () => {
    expect(src).toMatch(/INSERT IGNORE INTO analytics_events[\s\S]*device_type[\s\S]*route/);
  });
  it("indexes device_type and route for slicing", () => {
    expect(src).toContain("idx_device_time");
    expect(src).toContain("idx_route_time");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/analytics/store.test.ts`
Expected: FAIL — columns/indexes absent.

- [ ] **Step 3: Write minimal implementation** (edit `server/analytics/store.ts`)

In the `CREATE TABLE` DDL, after `feature_id VARCHAR(64) NULL,` add:

```sql
     action_name VARCHAR(64) NULL,
     route VARCHAR(96) NULL,
     device_type VARCHAR(12) NULL,
     os_family VARCHAR(16) NULL,
     browser_family VARCHAR(16) NULL,
     app_surface VARCHAR(24) NULL,
     viewport_class VARCHAR(8) NULL,
     orientation VARCHAR(10) NULL,
     is_touch TINYINT(1) NULL,
     is_standalone TINYINT(1) NULL,
     connection_class VARCHAR(12) NULL,
```

and after the existing `KEY idx_env_test (environment, is_test),` add:

```sql
     KEY idx_device_time (device_type, occurred_at_utc),
     KEY idx_route_time (route, occurred_at_utc),
```

Extend the `StoredEvent` interface (after `featureId?`):

```ts
  route?: string | null;
  actionName?: string | null;
  deviceType?: string | null;
  osFamily?: string | null;
  browserFamily?: string | null;
  appSurface?: string | null;
  viewportClass?: string | null;
  orientation?: string | null;
  isTouch?: boolean | null;
  isStandalone?: boolean | null;
  connectionClass?: string | null;
```

Rewrite the INSERT column list + VALUES to include them:

```ts
  const result = await db.execute(sql`
    INSERT IGNORE INTO analytics_events
      (event_id, event_name, schema_version, definition_version, source_user_id,
       session_id, tab_id, feature_id, action_name, route, surface, outcome,
       device_type, os_family, browser_family, app_surface, viewport_class,
       orientation, is_touch, is_standalone, connection_class,
       occurred_at_utc, received_at_utc, environment, app_version, is_test, props_json)
    VALUES
      (${e.eventId}, ${e.eventName}, ${e.schemaVersion}, ${e.definitionVersion ?? 1}, ${e.sourceUserId},
       ${e.sessionId ?? null}, ${e.tabId ?? null}, ${e.featureId ?? null}, ${e.actionName ?? null}, ${e.route ?? null}, ${e.surface}, ${e.outcome ?? null},
       ${e.deviceType ?? null}, ${e.osFamily ?? null}, ${e.browserFamily ?? null}, ${e.appSurface ?? null}, ${e.viewportClass ?? null},
       ${e.orientation ?? null}, ${e.isTouch == null ? null : e.isTouch ? 1 : 0}, ${e.isStandalone == null ? null : e.isStandalone ? 1 : 0}, ${e.connectionClass ?? null},
       ${e.occurredAtUtc}, ${receivedAt}, ${e.environment}, ${e.appVersion ?? null}, ${e.isTest ? 1 : 0}, ${propsJson})
  `);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/analytics/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror the columns into the reference migration** — in `analytics-backend/migrations/0001_user_activity_init.sql`, add the same columns/indexes to the `analytics_events` CREATE TABLE (doc parity; not applied from here). Then commit.

```bash
git add server/analytics/store.ts server/analytics/store.test.ts analytics-backend/migrations/0001_user_activity_init.sql
git commit -m "feat(analytics): D0 persist device/route columns in the store schema"
```

---

### Task 5: Central dispatch + device derivation in the tRPC router

**Files:**
- Create: `server/analytics/dispatch.ts`
- Test: `server/analytics/dispatch.test.ts`
- Modify: `server/routers/analytics.ts`
- Test: `server/analytics/analytics.test.ts`

**Interfaces:**
- Consumes: `deriveDeviceFromUA`, `reconcileDeviceType` (Task 2); `StoredEvent` (Task 4); `getAnalyticsRole`, `forwardEvent`, `insertAnalyticsEvent` (existing).
- Produces: `dispatchStoredEvent(event: StoredEvent): Promise<{ routed: "forwarded"|"stored"|"disabled"|"error" }>`.

- [ ] **Step 1: Write the failing test**

```ts
// server/analytics/dispatch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchStoredEvent } from "./dispatch";
import type { StoredEvent } from "./store";

const base: StoredEvent = {
  eventId: "e1abc234", eventName: "login", schemaVersion: 1, sourceUserId: 7,
  surface: "server", occurredAtUtc: 1, environment: "test",
};

describe("dispatchStoredEvent", () => {
  const OLD = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...OLD }; });

  it("is a no-op when disabled", async () => {
    delete process.env.ANALYTICS_ROLE; delete process.env.USER_ACTIVITY_BACKEND_URL;
    await expect(dispatchStoredEvent(base)).resolves.toEqual({ routed: "disabled" });
  });
  it("never throws even if a sink fails", async () => {
    process.env.ANALYTICS_ROLE = "store"; // store path will throw without a DB
    const r = await dispatchStoredEvent(base);
    expect(["stored", "error"]).toContain(r.routed);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/analytics/dispatch.test.ts`
Expected: FAIL — cannot find module `./dispatch`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/analytics/dispatch.ts
/**
 * dispatch.ts — the single place that routes a fully server-derived analytics
 * event by instance role: forward to the back office, store in MySQL: Dime AI,
 * or no-op. Used by BOTH the browser-facing tRPC mutation and server-side
 * emitters (login). Never throws — analytics must not break the product.
 */
import { getAnalyticsRole } from "./config";
import { forwardEvent } from "./forward";
import { insertAnalyticsEvent, type StoredEvent } from "./store";

const TAG = "[analytics][dispatch]";

export async function dispatchStoredEvent(
  event: StoredEvent,
): Promise<{ routed: "forwarded" | "stored" | "disabled" | "error" }> {
  const role = getAnalyticsRole();
  try {
    if (role === "forwarder") { await forwardEvent(event); return { routed: "forwarded" }; }
    if (role === "store") { await insertAnalyticsEvent(event); return { routed: "stored" }; }
    return { routed: "disabled" };
  } catch (err) {
    console.warn(`${TAG} suppressed: ${(err as Error).message}`);
    return { routed: "error" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/analytics/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire device derivation into the router** — edit `server/routers/analytics.ts`. Add imports and rebuild the mutation body:

```ts
import { appUserProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import { trackInputSchema, sanitizeProps } from "../analytics/events";
import { isTestUser } from "../analytics/config";
import { deriveDeviceFromUA, reconcileDeviceType } from "../analytics/device";
import { dispatchStoredEvent } from "../analytics/dispatch";
import type { StoredEvent } from "../analytics/store";

export const analyticsRouter = router({
  track: appUserProcedure.input(trackInputSchema).mutation(async ({ ctx, input }) => {
    const ua = ctx.req?.headers?.["user-agent"];
    const uaDevice = deriveDeviceFromUA(Array.isArray(ua) ? ua[0] : ua);
    const reconciled = reconcileDeviceType(uaDevice.deviceType, input.pointerType, input.viewportClass);
    const event: StoredEvent = {
      eventId: input.eventId,
      eventName: input.eventName,
      schemaVersion: input.schemaVersion,
      definitionVersion: 1,
      sourceUserId: ctx.appUser.id,
      sessionId: input.sessionId ?? null,
      tabId: input.tabId ?? null,
      featureId: input.featureId ?? null,
      route: input.route ?? null,
      surface: input.surface,
      outcome: input.outcome ?? null,
      deviceType: reconciled.deviceType,
      osFamily: uaDevice.osFamily,
      browserFamily: uaDevice.browserFamily,
      appSurface: input.appSurface ?? null,
      viewportClass: input.viewportClass ?? null,
      orientation: input.orientation ?? null,
      isTouch: input.isTouch ?? null,
      isStandalone: input.isStandalone ?? null,
      connectionClass: input.connectionClass ?? null,
      occurredAtUtc: input.occurredAtUtc,
      environment: process.env.NODE_ENV ?? "production",
      appVersion: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      isTest: isTestUser(ctx.appUser.id),
      props: reconciled.conflict
        ? { ...(sanitizeProps(input.props) ?? {}), device_conflict: true }
        : sanitizeProps(input.props),
    };
    const r = await dispatchStoredEvent(event);
    return { ok: true as const, routed: r.routed };
  }),
});
```

- [ ] **Step 6: Add a router source-contract test** to `server/analytics/analytics.test.ts` (create if absent):

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.join(import.meta.dirname, "..", "routers", "analytics.ts"), "utf8");
describe("analytics router derives device server-side", () => {
  it("reads the UA and reconciles device_type", () => {
    expect(src).toMatch(/deriveDeviceFromUA/);
    expect(src).toMatch(/reconcileDeviceType/);
    expect(src).toMatch(/user-agent/);
  });
  it("routes through the shared dispatcher (no inline TiDB write)", () => {
    expect(src).toMatch(/dispatchStoredEvent/);
    expect(src).not.toMatch(/railway\.internal/);
  });
});
```

- [ ] **Step 7: Run the analytics suite + typecheck**

Run: `npx vitest run server/analytics/ && npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 8: Commit**

```bash
git add server/analytics/dispatch.ts server/analytics/dispatch.test.ts server/routers/analytics.ts server/analytics/analytics.test.ts
git commit -m "feat(analytics): D0 central dispatch + server-derived device in router"
```

---

### Task 6: Attach the device block + route on every client envelope

**Files:**
- Modify: `client/src/lib/analytics.ts`
- Test: `client/src/lib/analytics.test.ts`

**Interfaces:**
- Consumes: `buildClientDeviceContext` (Task 1); `toRoutePattern` (Task 7 — but only referenced; if Task 7 runs later, temporarily inline `window.location.pathname`). **Ordering note:** run Task 7's `routePattern.ts` before this task, or have this task import it. The dispatch plan sequences `routePattern.ts` (start of Task 7) ahead of this.
- Produces: `type AnalyticsEventName` (broadened); `ClientEnvelope` gains the device block + `route`; `useAnalytics()` unchanged signature but now emits device-tagged envelopes.

- [ ] **Step 1: Write the failing test** (append to `client/src/lib/analytics.test.ts`)

```ts
import { buildClientEnvelope } from "./analytics";
describe("device block on the envelope", () => {
  it("attaches coarse device signals + a route pattern to every event", () => {
    const e = buildClientEnvelope("screen_viewed");
    expect(["xs","sm","md","lg","xl"]).toContain(e.viewportClass);
    expect(typeof e.isTouch).toBe("boolean");
    expect(["web-desktop-shell","web-mobile-shell","web-responsive"]).toContain(e.appSurface);
    expect(typeof e.route).toBe("string");
    // Never a fingerprint / raw UA.
    expect(e).not.toHaveProperty("userAgent");
  });
  it("still supports the value events", () => {
    expect(buildClientEnvelope("chat_response_completed").eventName).toBe("chat_response_completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/lib/analytics.test.ts`
Expected: FAIL — `viewportClass`/`route` absent on the envelope; `screen_viewed` not assignable.

- [ ] **Step 3: Write minimal implementation** (edit `client/src/lib/analytics.ts`)

- Add imports at top:

```ts
import { buildClientDeviceContext, type ClientDeviceContext } from "@/lib/deviceContext";
import { toRoutePattern } from "@/lib/routePattern";
```

- Broaden the event type:

```ts
export type QualifyingEventName =
  | "projection_evaluation_viewed"
  | "chat_response_completed"
  | "tracker_entry_saved";
export type AnalyticsEventName = QualifyingEventName | "session_started" | "screen_viewed";
```

- Change `TrackOptions` and the `track()` signatures from `QualifyingEventName` to `AnalyticsEventName`. Add `route?: string` to `TrackOptions`.

- Extend `ClientEnvelope` with the device block + route:

```ts
export interface ClientEnvelope extends ClientDeviceContext {
  eventId: string;
  eventName: AnalyticsEventName;
  schemaVersion: number;
  occurredAtUtc: number;
  tabId: string;
  sessionId?: string | null;
  featureId?: string;
  outcome?: string;
  surface: string;
  route: string;
  props?: Record<string, string | number | boolean>;
}
```

- In `buildClientEnvelope`, attach the block + route:

```ts
export function buildClientEnvelope(eventName: AnalyticsEventName, opts: TrackOptions = {}): ClientEnvelope {
  const device = buildClientDeviceContext();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  return {
    ...device,
    eventId: newEventId(),
    eventName,
    schemaVersion: 1,
    occurredAtUtc: opts.occurredAt ?? Date.now(),
    tabId: getTabId(),
    sessionId: opts.sessionId ?? null,
    surface: "web",
    route: opts.route ?? toRoutePattern(pathname),
    ...(opts.featureId ? { featureId: opts.featureId } : {}),
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
    ...(opts.props ? { props: opts.props } : {}),
  };
}
```

- Update `useAnalytics()`'s return type + `useCallback` generic to `AnalyticsEventName`.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run client/src/lib/analytics.test.ts && npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/analytics.ts client/src/lib/analytics.test.ts
git commit -m "feat(analytics): D0 attach device block + route to every client envelope"
```

---

## Phase D1 — P0 emitters (device auto-tagged). All depend on D0.

### Task 7: `screen_viewed` — route pattern + lazy tracker island

**Files:**
- Create: `client/src/lib/routePattern.ts`
- Test: `client/src/lib/routePattern.test.ts`
- Create: `client/src/components/ScreenViewTracker.tsx`
- Modify: `client/src/pages/dime-shell/DimeAppShell.tsx`

**Interfaces:**
- Produces: `toRoutePattern(pathname: string): string`; default-exported `ScreenViewTracker` (render-null island).

- [ ] **Step 1: Write the failing test**

```ts
// client/src/lib/routePattern.test.ts
import { describe, it, expect } from "vitest";
import { toRoutePattern } from "./routePattern";

describe("toRoutePattern (low-cardinality, no ids/PII)", () => {
  it("keeps static routes verbatim", () => {
    expect(toRoutePattern("/chat")).toBe("/chat");
    expect(toRoutePattern("/bet-tracker")).toBe("/bet-tracker");
    expect(toRoutePattern("/betting-splits")).toBe("/betting-splits");
  });
  it("collapses sport + date segments", () => {
    expect(toRoutePattern("/feed/model/mlb/2026-07-23")).toBe("/feed/model/:sport/:date");
    expect(toRoutePattern("/feed/model/nba")).toBe("/feed/model/:sport");
    expect(toRoutePattern("/betting-splits/MLB/2026-07-23")).toBe("/betting-splits/:sport/:date");
  });
  it("collapses team slugs and mobile routes", () => {
    expect(toRoutePattern("/mlb/team/new-york-yankees")).toBe("/mlb/team/:slug");
    expect(toRoutePattern("/m/feed")).toBe("/m/feed");
  });
  it("collapses unknown trailing dynamic segments to :id", () => {
    expect(toRoutePattern("/account/98217")).toBe("/account/:id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/lib/routePattern.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/lib/routePattern.ts
/**
 * routePattern.ts — collapse a concrete pathname to a low-cardinality route
 * PATTERN for analytics. Strips ids/slugs/dates so `route` is safe (no PII, no
 * unbounded cardinality). Grounded in client/src/App.tsx's real routes.
 */
const SPORTS = new Set(["mlb", "nba", "nhl", "wc", "wc2026"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toRoutePattern(pathname: string): string {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    const prev = out[out.length - 1];
    if (DATE_RE.test(seg)) { out.push(":date"); continue; }
    if (SPORTS.has(seg.toLowerCase()) && (prev === "model" || prev === "betting-splits")) { out.push(":sport"); continue; }
    if (prev === "team") { out.push(":slug"); continue; }
    // Bare numeric / long opaque trailing segment ⇒ :id.
    if (/^\d+$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg)) { out.push(":id"); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/lib/routePattern.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the lazy island**

```tsx
// client/src/components/ScreenViewTracker.tsx
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useAnalytics } from "@/lib/analytics";
import { toRoutePattern } from "@/lib/routePattern";

/**
 * ScreenViewTracker — render-null island that emits one device-tagged
 * `screen_viewed` per route change for authenticated users. Lazy-loaded by
 * DimeAppShell so it stays OFF chat's critical-path bundle. Fire-and-forget;
 * server-gated; sends only a low-cardinality route PATTERN (never a raw URL).
 */
export default function ScreenViewTracker() {
  const [location] = useLocation();
  const { appUser } = useAppAuth();
  const track = useAnalytics();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (!appUser) return;
    const route = toRoutePattern(location);
    if (prev.current === route) return;
    const from = prev.current;
    prev.current = route;
    track("screen_viewed", { route, ...(from ? { props: { from_route: from } } : {}) });
  }, [location, appUser, track]);

  return null;
}
```

- [ ] **Step 6: Mount it lazily in the shell** — in `client/src/pages/dime-shell/DimeAppShell.tsx`, next to the existing `SessionTracker` lazy import (line ~30):

```tsx
const ScreenViewTracker = lazy(() => import("@/components/ScreenViewTracker"));
```

and beside `<SessionTracker />` (line ~191):

```tsx
        <ScreenViewTracker />
```

- [ ] **Step 7: Verify typecheck + bundle budget** (the island is lazy — must not move the critical path)

Run: `npx tsc --noEmit && npm run check:bundle`
Expected: no errors; bundle under 215,882 B.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/routePattern.ts client/src/lib/routePattern.test.ts client/src/components/ScreenViewTracker.tsx client/src/pages/dime-shell/DimeAppShell.tsx
git commit -m "feat(analytics): D1 screen_viewed island + route-pattern derivation"
```

---

### Task 8: `session_started` — device-tagged, once per foreground open

**Files:**
- Modify: `client/src/hooks/useSessionTracking.ts`
- Modify: `client/src/components/SessionTracker.tsx`
- Test: `client/src/hooks/useSessionTracking.test.ts` (create if absent)

**Interfaces:**
- Consumes: `useAnalytics` (Task 6).
- Produces: `useSessionTracking(enabled: boolean, onSessionOpen?: () => void): void` — the callback fires inside `open()` on each real foreground open.

- [ ] **Step 1: Write the failing test** (pure — exercises the callback wiring intent via a small contract test)

```ts
// client/src/hooks/useSessionTracking.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const hook = fs.readFileSync(path.join(import.meta.dirname, "useSessionTracking.ts"), "utf8");
const tracker = fs.readFileSync(path.join(import.meta.dirname, "..", "components", "SessionTracker.tsx"), "utf8");

describe("session_started wiring", () => {
  it("useSessionTracking accepts an onSessionOpen callback fired in open()", () => {
    expect(hook).toMatch(/onSessionOpen/);
    expect(hook).toMatch(/onSessionOpen\?\.\(\)/);
  });
  it("SessionTracker emits session_started via useAnalytics", () => {
    expect(tracker).toMatch(/useAnalytics/);
    expect(tracker).toMatch(/session_started/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/hooks/useSessionTracking.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the callback to the hook** — change the signature and `open()`:

```ts
export function useSessionTracking(enabled: boolean, onSessionOpen?: () => void): void {
```

and add a ref beside the others:

```ts
  const onOpenRef = useRef(onSessionOpen);
  onOpenRef.current = onSessionOpen;
```

and in `open()`:

```ts
    const open = () => { if (!started) { started = true; openRef.current(); onOpenRef.current?.(); } };
```

Add `onSessionOpen` to the effect deps array (replace `[enabled]` with `[enabled]` — the ref keeps it stable, so no dep change needed; the ref pattern is why deps stay `[enabled]`).

- [ ] **Step 4: Emit from SessionTracker** — rewrite `client/src/components/SessionTracker.tsx`:

```tsx
import { useCallback } from "react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useSessionTracking } from "@/hooks/useSessionTracking";
import { useAnalytics } from "@/lib/analytics";

/**
 * SessionTracker — lazy render-null island. Drives foreground engagement
 * sessions (useSessionTracking) AND emits one device-tagged `session_started`
 * analytics event per foreground open. Lazy so it stays off chat's critical
 * path. No-ops for signed-out viewers.
 */
export default function SessionTracker() {
  const { appUser } = useAppAuth();
  const track = useAnalytics();
  const onOpen = useCallback(() => track("session_started"), [track]);
  useSessionTracking(!!appUser, onOpen);
  return null;
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run client/src/hooks/useSessionTracking.test.ts && npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useSessionTracking.ts client/src/components/SessionTracker.tsx client/src/hooks/useSessionTracking.test.ts
git commit -m "feat(analytics): D1 session_started device-tagged emit (once per open)"
```

---

### Task 9: `login` — server-side emit (authoritative last-sign-in)

**Files:**
- Create: `server/analytics/emitServer.ts`
- Test: `server/analytics/emitServer.test.ts`
- Modify: `server/routers/appUsers.ts`

**Interfaces:**
- Consumes: `deriveDeviceFromUA` (Task 2); `dispatchStoredEvent` (Task 5); `isTestUser` (existing).
- Produces: `emitServerEvent(opts: { eventName: string; userId: number; userAgent?: string | null; sessionId?: string | null; props?: Record<string, string|number|boolean> | null }): Promise<void>` — builds a server-authoritative `StoredEvent` (UA-only device, `surface: "server"`) and dispatches by role. Never throws.

- [ ] **Step 1: Write the failing test**

```ts
// server/analytics/emitServer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emitServerEvent } from "./emitServer";

describe("emitServerEvent", () => {
  const OLD = { ...process.env };
  beforeEach(() => { delete process.env.ANALYTICS_ROLE; delete process.env.USER_ACTIVITY_BACKEND_URL; });
  afterEach(() => { process.env = { ...OLD }; });

  it("resolves (no-op) when the pipeline is disabled and never throws", async () => {
    await expect(emitServerEvent({
      eventName: "login", userId: 42,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/604.1",
    })).resolves.toBeUndefined();
  });
  it("swallows a bad userId without throwing", async () => {
    await expect(emitServerEvent({ eventName: "login", userId: NaN })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/analytics/emitServer.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/analytics/emitServer.ts
/**
 * emitServer.ts — emit an analytics event from SERVER code (no browser round
 * trip), e.g. the authoritative `login`. Device is derived from the request UA
 * only (no client viewport). Server-derives identity/received_at/environment.
 * Routes by role via dispatchStoredEvent. Fire-and-forget; never throws.
 */
import { randomUUID } from "node:crypto";
import { deriveDeviceFromUA } from "./device";
import { dispatchStoredEvent } from "./dispatch";
import { isTestUser } from "./config";
import type { StoredEvent } from "./store";

export async function emitServerEvent(opts: {
  eventName: string;
  userId: number;
  userAgent?: string | null;
  sessionId?: string | null;
  props?: Record<string, string | number | boolean> | null;
}): Promise<void> {
  try {
    if (!Number.isFinite(opts.userId)) return;
    const ua = deriveDeviceFromUA(opts.userAgent);
    const event: StoredEvent = {
      eventId: randomUUID(),
      eventName: opts.eventName,
      schemaVersion: 1,
      definitionVersion: 1,
      sourceUserId: opts.userId,
      sessionId: opts.sessionId ?? null,
      surface: "server",
      deviceType: ua.deviceType,
      osFamily: ua.osFamily,
      browserFamily: ua.browserFamily,
      occurredAtUtc: Date.now(),
      environment: process.env.NODE_ENV ?? "production",
      appVersion: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      isTest: isTestUser(opts.userId),
      props: opts.props ?? null,
    };
    await dispatchStoredEvent(event);
  } catch {
    /* analytics must never break auth */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/analytics/emitServer.test.ts`
Expected: PASS.

- [ ] **Step 5: Call it from login** — in `server/routers/appUsers.ts`, right after `await updateAppUserLastSignedIn(user.id);` (≈ line 403), add a non-awaited emit (fire-and-forget):

```ts
      // Device-tagged authoritative "last sign in" (server-derived; inert until
      // the analytics pipeline is enabled). Never blocks or breaks login.
      void emitServerEvent({
        eventName: "login",
        userId: user.id,
        userAgent: ctx.req?.headers?.["user-agent"] as string | undefined,
        props: { is_returning: true },
      });
```

Add the import at the top of `appUsers.ts`:

```ts
import { emitServerEvent } from "../analytics/emitServer";
```

- [ ] **Step 6: Run the analytics + login suites + typecheck**

Run: `npx vitest run server/analytics/ server/appUsers.login.test.ts && npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add server/analytics/emitServer.ts server/analytics/emitServer.test.ts server/routers/appUsers.ts
git commit -m "feat(analytics): D1 server-side login emit (authoritative last sign in)"
```

---

### Task 10: `chat_response_completed` — value event (critical-path, bundle-safe)

**Files:**
- Modify: `client/src/pages/dime-chat/DimeChatPage.tsx`

**Interfaces:**
- Consumes: `useAnalytics` (Task 6).

- [ ] **Step 1: Add the emitter** — near the top of the `DimeChatPage` component add the hook, and a per-send start-time ref:

```tsx
import { useAnalytics } from "@/lib/analytics";
// inside the component:
const track = useAnalytics();
const chatStartRef = useRef<number | null>(null);
```

Set `chatStartRef.current = Date.now();` at the point the send/stream begins (just before `const reader = res.body.getReader();` at ≈ line 1717).

In the `stream_done` completion branch (the `event.type === "done"` case at ≈ line 1757, after the existing `dispatch({ type: "stream_done", id: assistantId })`), add:

```tsx
                track("chat_response_completed", {
                  featureId: "dime_chat",
                  outcome: "success",
                  ...(chatStartRef.current
                    ? { props: { latency_ms: Math.max(0, Date.now() - chatStartRef.current) } }
                    : {}),
                });
                chatStartRef.current = null;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the bundle budget did NOT regress** (this file is critical-path)

Run: `npm run check:bundle`
Expected: PASS — under 215,882 B gzip. If it fails, STOP: the `useAnalytics`/device imports must be split behind a tiny critical-path-safe shim; report the delta before proceeding.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/dime-chat/DimeChatPage.tsx
git commit -m "feat(analytics): D1 chat_response_completed value event (bundle-verified)"
```

---

### Task 11: `projection_evaluation_viewed` — value event (feed; lazy)

**Files:**
- Modify: `client/src/pages/DimeModelFeed.tsx`

**Interfaces:**
- Consumes: `useAnalytics` (Task 6). Uses the existing `useFeedCards(isoDate)` result `{ isLoading, isStale, gamesCount }` and the resolved `isoDate`/sport.

- [ ] **Step 1: Add the emitter** — in the component that consumes `useFeedCards` (≈ line 380, `const { sections, isLoading, isStale, gamesCount } = useFeedCards(isoDate);`), add the hook and a fire-once-per-render-signature effect:

```tsx
import { useAnalytics } from "@/lib/analytics";
// inside the component, after the useFeedCards line:
const track = useAnalytics();
const firedRef = useRef<string | null>(null);
useEffect(() => {
  // A complete, trustworthy projection set: loaded, fresh (not stale), non-empty.
  if (isLoading || isStale || gamesCount <= 0) return;
  const sig = `${isoDate}:${gamesCount}`;
  if (firedRef.current === sig) return;
  firedRef.current = sig;
  track("projection_evaluation_viewed", {
    featureId: "model_feed",
    outcome: "success",
    props: { sport: "mlb", data_freshness_state: "fresh" },
  });
}, [isLoading, isStale, gamesCount, isoDate, track]);
```

(Ensure `useEffect`/`useRef` are imported — they are already used in this file; if `sport` is available as a variable in scope, pass it instead of the literal `"mlb"`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify bundle** (DimeModelFeed is lazy — should not touch the critical path)

Run: `npm run check:bundle`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/DimeModelFeed.tsx
git commit -m "feat(analytics): D1 projection_evaluation_viewed value event (feed)"
```

---

## Phase Verification (after all tasks)

- [ ] **Full typecheck:** `npx tsc --noEmit` → clean.
- [ ] **Full analytics + client suites:** `npx vitest run server/analytics/ client/src/lib/ client/src/hooks/ client/src/components/` → green.
- [ ] **Bundle budget:** `npm run check:bundle` → under 215,882 B gzip (proves chat critical-path unaffected).
- [ ] **Inert-by-default proof:** with no `ANALYTICS_ROLE` / `USER_ACTIVITY_BACKEND_URL`, `dispatchStoredEvent` returns `{ routed: "disabled" }` (dispatch.test.ts) — nothing is stored; product unaffected.
- [ ] **Guardrail scan:** grep the diff for forbidden data — no wager/odds/stakes, no chat/search text, no raw URLs-with-ids, no PII; device fields are coarse buckets only.

---

## Risks / Unknowns

- **Bundle budget on Task 10** — `DimeChatPage` is critical-path. `useAnalytics`→`deviceContext`+`routePattern` are dependency-free and tiny, but the delta must be **measured**, not assumed. Mitigation: Task 10 Step 3 gates on `check:bundle`; if it regresses, split the emit behind a lazy shim.
- **`projection_evaluation_viewed` placement (Task 11)** — the "complete + fresh + non-empty" gate uses `useFeedCards`'s existing `{isLoading,isStale,gamesCount}`. If a per-card "trustworthy" signal is later required, tighten the gate; the current gate is honest (never fires on a bare/loading/stale feed) and dedupes per (date, count).
- **iPadOS-as-Mac** — handled by `reconcileDeviceType` (coarse pointer upgrades desktop→tablet/mobile + `device_conflict` flag). Pure and unit-tested.
- **Store DDL vs. existing table** — `analytics_events` has never been created in any live DB (the store role is undeployed), so the extended `CREATE TABLE IF NOT EXISTS` is sufficient; no `ALTER` migration is needed yet. The reference `0001` SQL is updated for parity when the formal migration runs.

## Out of Scope (explicitly not in D0/D1)

- The `action_performed` allowlist + feature-lifecycle events (D3/P1) — the `action_name` column is added now but no emitters yet.
- Monetization funnel, power-user score, research/founder queues (D5/P2).
- The read path / dashboard device cuts + `analytics_device_day` rollup (D2) — schema deltas here are write-path only.
- `session_heartbeat`/`session_ended` as analytics events — engaged screen-time continues on the existing `user_sessions` substrate until D2 migrates it; D1 adds only device-tagged `session_started`.
- Any Railway deploy / variable changes — owner-owned; emitters ship inert.

---

## Execution dispatch (subagents in parallel where independent)

Dependency waves (each subagent = one task; review between waves):

- **Wave A (parallel):** Task 1 (client device), Task 2 (server UA), Task 7's `routePattern.ts`+test (pure, no deps). — no shared state.
- **Wave B (parallel):** Task 3 (event contract), Task 4 (store columns). — both depend only on their own files.
- **Wave C (sequential):** Task 5 (dispatch + router — needs 2, 3, 4), then Task 6 (client envelope — needs 1, 3, and routePattern from Wave A).
- **Wave D (parallel):** Task 7 island+shell mount (needs 6), Task 8 (session_started — needs 6), Task 9 (login — needs 5), Task 10 (chat — needs 6), Task 11 (feed — needs 6). — different files, no ordering between them.
- **Wave E:** Phase Verification (single reviewer): tsc + vitest + check:bundle + guardrail scan.

Bundle-sensitive tasks (10) are verified individually AND in Wave E.
