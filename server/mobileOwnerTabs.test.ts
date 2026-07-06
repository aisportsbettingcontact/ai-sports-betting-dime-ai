/**
 * Mobile Owner Tabs — Test Suite
 * ═══════════════════════════════
 * Tests feature flags, access decisions, config, and logger.
 * Run: pnpm test -- mobileOwnerTabs
 */

import { describe, it, expect, beforeEach } from "vitest";

// We test the pure logic modules (config + logger) which are framework-agnostic
// and can be imported directly without React/DOM dependencies.

// ─── Import the config module directly ───────────────────────────────────────
// Note: We import the source TS files — vitest handles TS natively.
import {
  MOBILE_OWNER_TABS,
  MOBILE_OWNER_TABS_ENABLED,
  decideMobileOwnerAccess,
} from "../client/src/features/mobileOwnerTabs/config";

import { mobileOwnerTabLogger } from "../client/src/features/mobileOwnerTabs/logger";

describe("Mobile Owner Tabs — Config & Feature Flags", () => {
  it("should have exactly 5 tabs defined", () => {
    expect(MOBILE_OWNER_TABS).toHaveLength(5);
  });

  it("should have correct tab IDs", () => {
    const ids = MOBILE_OWNER_TABS.map(t => t.id);
    expect(ids).toEqual(["feed", "splits", "chat", "bet-tracker", "profile"]);
  });

  it("should have correct paths starting with /m/", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.path).toMatch(/^\/m\//);
    }
  });

  it("should have non-empty labels for all tabs", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it("should have valid lucide icon names", () => {
    const validIcons = ["Newspaper", "BarChart3", "MessageSquare", "Receipt", "User"];
    for (const tab of MOBILE_OWNER_TABS) {
      expect(validIcons).toContain(tab.iconName);
    }
  });

  it("feature flag MOBILE_OWNER_TABS_ENABLED should be true", () => {
    expect(MOBILE_OWNER_TABS_ENABLED).toBe(true);
  });
});

describe("Mobile Owner Tabs — Access Decision Logic", () => {
  it("should grant access to owner role", () => {
    const result = decideMobileOwnerAccess("owner", true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("owner");
  });

  it("should deny access to regular user role", () => {
    const result = decideMobileOwnerAccess("user", true, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_owner");
  });

  it("should deny access to admin role (not owner)", () => {
    const result = decideMobileOwnerAccess("admin", true, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_owner");
  });

  it("should deny access to unauthenticated users", () => {
    const result = decideMobileOwnerAccess(null, false, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_authenticated");
  });

  it("should deny access when user role is undefined", () => {
    const result = decideMobileOwnerAccess(undefined, true, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_owner");
  });

  it("should deny access to handicapper role", () => {
    const result = decideMobileOwnerAccess("handicapper", true, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_owner");
  });
});

describe("Mobile Owner Tabs — Logger", () => {
  beforeEach(() => {
    mobileOwnerTabLogger.clear();
  });

  it("should start with zero entries after clear", () => {
    expect(mobileOwnerTabLogger.getEntries()).toHaveLength(0);
  });

  it("should log events with correct structure", () => {
    mobileOwnerTabLogger.log("tabs_rendered", "feed", { test: true });
    const entries = mobileOwnerTabLogger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("tabs_rendered");
    expect(entries[0].tabId).toBe("feed");
    expect(entries[0].metadata).toEqual({ test: true });
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it("should track multiple events in order", () => {
    mobileOwnerTabLogger.log("tab_tapped", "feed");
    mobileOwnerTabLogger.log("tab_changed", "splits");
    mobileOwnerTabLogger.log("route_navigated", "splits");
    const entries = mobileOwnerTabLogger.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0].event).toBe("tab_tapped");
    expect(entries[1].event).toBe("tab_changed");
    expect(entries[2].event).toBe("route_navigated");
  });

  it("should generate unique session IDs", () => {
    const id1 = mobileOwnerTabLogger.getSessionId();
    mobileOwnerTabLogger.clear();
    const id2 = mobileOwnerTabLogger.getSessionId();
    expect(id1).not.toBe(id2);
  });

  it("should track session duration", () => {
    const duration = mobileOwnerTabLogger.getSessionDuration();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("should count events by type", () => {
    mobileOwnerTabLogger.log("tab_tapped", "feed");
    mobileOwnerTabLogger.log("tab_tapped", "splits");
    mobileOwnerTabLogger.log("tab_changed", "chat");
    expect(mobileOwnerTabLogger.getEventCount("tab_tapped")).toBe(2);
    expect(mobileOwnerTabLogger.getEventCount("tab_changed")).toBe(1);
    expect(mobileOwnerTabLogger.getEventCount()).toBe(3);
  });

  it("should get last event", () => {
    mobileOwnerTabLogger.log("tab_tapped", "feed");
    mobileOwnerTabLogger.log("tab_changed", "splits");
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("tab_changed");
    expect(last?.tabId).toBe("splits");
  });

  it("should export valid JSON", () => {
    mobileOwnerTabLogger.log("tabs_rendered");
    const json = mobileOwnerTabLogger.exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.totalEvents).toBe(1);
  });

  it("should cap entries at MAX_LOG_ENTRIES (500)", () => {
    for (let i = 0; i < 550; i++) {
      mobileOwnerTabLogger.log("tab_tapped", "feed");
    }
    expect(mobileOwnerTabLogger.getEntries().length).toBeLessThanOrEqual(500);
  });
});

describe("Mobile Owner Tabs — Tab Configuration Integrity", () => {
  it("all tabs should have unique IDs", () => {
    const ids = MOBILE_OWNER_TABS.map(t => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all tabs should have unique paths", () => {
    const paths = MOBILE_OWNER_TABS.map(t => t.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("all tabs should have unique icon names", () => {
    const icons = MOBILE_OWNER_TABS.map(t => t.iconName);
    const unique = new Set(icons);
    expect(unique.size).toBe(icons.length);
  });

  it("no tabs should be disabled by default", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.disabled).toBeFalsy();
    }
  });

  it("feed tab should be first", () => {
    expect(MOBILE_OWNER_TABS[0].id).toBe("feed");
  });

  it("profile tab should be last", () => {
    expect(MOBILE_OWNER_TABS[MOBILE_OWNER_TABS.length - 1].id).toBe("profile");
  });
});
