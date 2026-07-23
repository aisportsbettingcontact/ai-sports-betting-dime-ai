import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shouldHeartbeat, IDLE_THRESHOLD_MS } from "./useSessionTracking";

/** Pure engagement rule — foreground + not idle + leader. */
describe("shouldHeartbeat", () => {
  it("beats when leader + visible + active", () => {
    expect(shouldHeartbeat({ isLeader: true, visible: true, msSinceInput: 0 })).toBe(true);
  });
  it("does not beat when this tab is not the leader (duplicate-tab protection)", () => {
    expect(shouldHeartbeat({ isLeader: false, visible: true, msSinceInput: 0 })).toBe(false);
  });
  it("does not beat when the tab is hidden/backgrounded", () => {
    expect(shouldHeartbeat({ isLeader: true, visible: false, msSinceInput: 0 })).toBe(false);
  });
  it("does not beat once idle beyond the threshold", () => {
    expect(shouldHeartbeat({ isLeader: true, visible: true, msSinceInput: IDLE_THRESHOLD_MS + 1 })).toBe(false);
  });
  it("still beats just under the idle threshold", () => {
    expect(shouldHeartbeat({ isLeader: true, visible: true, msSinceInput: IDLE_THRESHOLD_MS - 1 })).toBe(true);
  });
});

/**
 * Source-contract for the hook wiring (the repo's client vitest runs in node
 * env, so DOM behavior is pinned by source shape rather than a jsdom mount).
 */
const src = fs.readFileSync(path.join(import.meta.dirname, "useSessionTracking.ts"), "utf8");

describe("useSessionTracking wiring (source contract)", () => {
  it("drives the full session lifecycle via the metrics procedures", () => {
    expect(src).toMatch(/trpc\.metrics\.openSession\.useMutation/);
    expect(src).toMatch(/trpc\.metrics\.sessionHeartbeat\.useMutation/);
    expect(src).toMatch(/trpc\.metrics\.closeSession\.useMutation/);
  });
  it("elects a single leader tab (Web Locks) for duplicate-tab protection", () => {
    expect(src).toMatch(/\.locks/);
    expect(src).toMatch(/mode: "exclusive"/);
  });
  it("closes the session on pagehide and on unmount/logout", () => {
    expect(src).toMatch(/addEventListener\("pagehide"/);
    expect(src).toMatch(/close\(\); \/\/ logout/);
  });
  it("gates heartbeats behind the pure foreground/idle rule", () => {
    expect(src).toMatch(/shouldHeartbeat\(/);
  });
  it("no-ops for signed-out viewers (openSession is auth-only)", () => {
    expect(src).toMatch(/if \(!enabled\) return;/);
  });
  it("re-opens the session after a bfcache restore (pageshow persisted)", () => {
    expect(src).toMatch(/addEventListener\("pageshow"/);
    expect(src).toMatch(/e\.persisted/);
  });
  it("falls back to a localStorage leader claim on browsers without Web Locks", () => {
    expect(src).toMatch(/localStorage/);
  });
});
