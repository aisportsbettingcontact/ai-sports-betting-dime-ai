/**
 * Mobile Floating Nav (mobileOwnerTabs feature) — Test Suite
 * ═══════════════════════════════════════════════════════════
 * Tests feature flags, access decisions, destination config, active-route
 * matching, and logger. The feature directory keeps its historical
 * "mobileOwnerTabs" name; the rendered surface is the top floating nav
 * (docs/plans/2026-07-18-mobile-floating-nav.md).
 * Run: pnpm test -- mobileOwnerTabs
 */

import { describe, it, expect, beforeEach } from "vitest";

// We test the pure logic modules (config + activeTab + logger) which are
// framework-agnostic and can be imported directly without React/DOM.

import {
  MOBILE_OWNER_TABS,
  MOBILE_OWNER_TABS_ENABLED,
  MOBILE_OWNER_TABS_PUBLIC_ENABLED,
  MOBILE_OWNER_TABS_DEBUG_PANEL,
  CHAT_TAB_INDEX,
  decideMobileOwnerAccess,
} from "../client/src/features/mobileOwnerTabs/config";

import { getActiveTabId } from "../client/src/features/mobileOwnerTabs/activeTab";
import { mobileOwnerTabLogger } from "../client/src/features/mobileOwnerTabs/logger";

describe("Mobile Floating Nav — Config & Feature Flags", () => {
  it("should have exactly 5 destinations defined", () => {
    expect(MOBILE_OWNER_TABS).toHaveLength(5);
  });

  it("should have the mandated order: Feed, Tools, Chat, Bet Tracker, Profile", () => {
    expect(MOBILE_OWNER_TABS.map(t => t.id)).toEqual([
      "feed",
      "tools",
      "chat",
      "tracker",
      "profile",
    ]);
    expect(MOBILE_OWNER_TABS.map(t => t.label)).toEqual([
      "Feed",
      "Tools",
      "Chat",
      "Bet Tracker",
      "Profile",
    ]);
  });

  it("Chat occupies the exact center of the five destinations", () => {
    expect(CHAT_TAB_INDEX).toBe(2);
    expect(MOBILE_OWNER_TABS[2].id).toBe("chat");
  });

  it("should have correct canonical paths for each destination (no query hooks)", () => {
    const paths = MOBILE_OWNER_TABS.map(t => t.path);
    expect(paths).toEqual([
      "/feed/model/mlb",
      "/betting-splits/MLB",
      "/chat",
      "/bet-tracker",
      "/profile",
    ]);
  });

  it("no destination path may carry a legacy query-string hook", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.path).not.toContain("?");
      expect(tab.path).not.toMatch(/^\/feed$|^\/feed\?|^\/splits/);
    }
  });

  it("should have non-empty labels for all destinations", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it("feature flag MOBILE_OWNER_TABS_ENABLED should be true", () => {
    expect(MOBILE_OWNER_TABS_ENABLED).toBe(true);
  });
});

describe("Mobile Floating Nav — Active-route matcher", () => {
  it("feed stays active across dated/sport variants", () => {
    expect(getActiveTabId("/feed/model/mlb")).toBe("feed");
    expect(getActiveTabId("/feed/model/mlb-07-18-2026")).toBe("feed");
    expect(getActiveTabId("/feed/model/wc-07-18-2026")).toBe("feed");
    expect(getActiveTabId("/feed/model/mlb/07-18-2026")).toBe("feed");
  });

  it("tools activates on the betting-splits surface (any sport/date)", () => {
    expect(getActiveTabId("/betting-splits")).toBe("tools");
    expect(getActiveTabId("/betting-splits/MLB")).toBe("tools");
    expect(getActiveTabId("/betting-splits/mlb-07-18-2026")).toBe("tools");
    expect(getActiveTabId("/betting-splits/NBA/07-18-2026")).toBe("tools");
  });

  it("chat, tracker, and profile match their exact routes and nested paths", () => {
    expect(getActiveTabId("/chat")).toBe("chat");
    expect(getActiveTabId("/bet-tracker")).toBe("tracker");
    expect(getActiveTabId("/profile")).toBe("profile");
  });

  it("query strings and hashes never change activation", () => {
    expect(getActiveTabId("/chat?preview=1")).toBe("chat");
    expect(getActiveTabId("/betting-splits/MLB?x=1#top")).toBe("tools");
  });

  it("orphaned /m/* screens highlight their owning destinations", () => {
    expect(getActiveTabId("/m/feed")).toBe("feed");
    expect(getActiveTabId("/m/splits")).toBe("tools");
    expect(getActiveTabId("/m/chat")).toBe("chat");
    expect(getActiveTabId("/m/profile")).toBe("profile");
  });

  it("returns null (NO default) when no destination is active", () => {
    // aria-current="page" belongs only to a genuinely active destination —
    // the retired bottom bar's default-to-feed behavior was a semantics bug.
    expect(getActiveTabId("/")).toBeNull();
    expect(getActiveTabId("/wc2026")).toBeNull();
    expect(getActiveTabId("/account")).toBeNull();
    expect(getActiveTabId("/admin/users")).toBeNull();
    expect(getActiveTabId("/m/props")).toBeNull();
    expect(getActiveTabId("/login")).toBeNull();
    // /mlb/team/:slug merely starts with "/m" — must not match anything
    expect(getActiveTabId("/mlb/team/yankees")).toBeNull();
  });
});

// ─── Public rollout (2026-07-12) ─────────────────────────────────────────────
// The nav ships to EVERY authenticated mobile user, so
// MOBILE_OWNER_TABS_PUBLIC_ENABLED is the deliberate steady state and the
// public grant fires before the owner check. Authentication is still required,
// and the debug overlay must stay off for public users.
describe("Mobile Floating Nav — Access Decision Logic (public rollout)", () => {
  it("pins the public flag on and the debug panel off", () => {
    expect(MOBILE_OWNER_TABS_PUBLIC_ENABLED).toBe(true);
    expect(MOBILE_OWNER_TABS_DEBUG_PANEL).toBe(false);
  });

  it("grants the owner role via the public rule", () => {
    const result = decideMobileOwnerAccess("owner", true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("public");
  });

  it("grants regular authenticated users", () => {
    const result = decideMobileOwnerAccess("user", true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("public");
  });

  it("grants admin users", () => {
    const result = decideMobileOwnerAccess("admin", true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("public");
  });

  it("should deny access to unauthenticated users", () => {
    const result = decideMobileOwnerAccess(null, false, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_authenticated");
  });

  it("grants authenticated users even when the role is undefined", () => {
    const result = decideMobileOwnerAccess(undefined, true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("public");
  });

  it("grants handicapper users", () => {
    const result = decideMobileOwnerAccess("handicapper", true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("public");
  });

  it("owner on desktop should still get granted (viewport check is separate)", () => {
    // decideMobileOwnerAccess doesn't check viewport — that's in the component
    const result = decideMobileOwnerAccess("owner", true, false);
    expect(result.granted).toBe(true);
  });
});

describe("Mobile Floating Nav — Logger", () => {
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
    mobileOwnerTabLogger.log("tab_changed", "tools");
    mobileOwnerTabLogger.log("route_navigated", "tools");
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
    mobileOwnerTabLogger.log("tab_tapped", "tools");
    mobileOwnerTabLogger.log("tab_changed", "chat");
    expect(mobileOwnerTabLogger.getEventCount("tab_tapped")).toBe(2);
    expect(mobileOwnerTabLogger.getEventCount("tab_changed")).toBe(1);
    expect(mobileOwnerTabLogger.getEventCount()).toBe(3);
  });

  it("should get last event", () => {
    mobileOwnerTabLogger.log("tab_tapped", "feed");
    mobileOwnerTabLogger.log("tab_changed", "tools");
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("tab_changed");
    expect(last?.tabId).toBe("tools");
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

describe("Mobile Floating Nav — Destination Configuration Integrity", () => {
  it("all destinations should have unique IDs", () => {
    const ids = MOBILE_OWNER_TABS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all destinations should have unique paths", () => {
    const paths = MOBILE_OWNER_TABS.map(t => t.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("no destinations should be disabled by default", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.disabled).toBeFalsy();
    }
  });

  it("feed destination should be first", () => {
    expect(MOBILE_OWNER_TABS[0].id).toBe("feed");
  });

  it("profile destination should be last", () => {
    expect(MOBILE_OWNER_TABS[MOBILE_OWNER_TABS.length - 1].id).toBe("profile");
  });
});

describe("Mobile Floating Nav — New Event Types Validity", () => {
  beforeEach(() => {
    mobileOwnerTabLogger.clear();
  });

  const structuralEvents = [
    "mount_attempted",
    "mount_success",
    "mount_skipped",
    "mount_skipped_non_owner",
    "mount_skipped_feature_disabled",
    "mount_skipped_not_mobile",
    "global_layout_mount_enabled",
    "role_resolution",
    "feature_flags_detected",
    "css_visibility_checked",
    "route_render_verified",
  ] as const;

  for (const event of structuralEvents) {
    it(`should accept ${event} event`, () => {
      mobileOwnerTabLogger.log(event, undefined, { test: true });
      expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe(event);
    });
  }
});

describe("Mobile Floating Nav — Destinations Map Onto Existing Routes", () => {
  it("Feed/Tools/Tracker destinations route to their canonical path-based surfaces", () => {
    const byId = new Map(MOBILE_OWNER_TABS.map(t => [t.id, t.path]));
    expect(byId.get("feed")).toBe("/feed/model/mlb");
    expect(byId.get("tools")).toBe("/betting-splits/MLB");
    expect(byId.get("tracker")).toBe("/bet-tracker");
  });

  it("Chat and Profile destinations should route to their dedicated paths", () => {
    const chatTab = MOBILE_OWNER_TABS.find(t => t.id === "chat");
    const profileTab = MOBILE_OWNER_TABS.find(t => t.id === "profile");
    expect(chatTab?.path).toBe("/chat");
    expect(profileTab?.path).toBe("/profile");
  });

  it("only the Tools destination targets /betting-splits, at its canonical sport path", () => {
    const splitsTabs = MOBILE_OWNER_TABS.filter(t =>
      t.path.startsWith("/betting-splits")
    );
    expect(splitsTabs.map(t => t.id)).toEqual(["tools"]);
    expect(splitsTabs[0]?.path).toBe("/betting-splits/MLB");
  });

  it("no destination targets an /m/* screen (the bar left /m/props behind)", () => {
    // /m/props stays routed and deep-linkable; it just isn't primary nav.
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.path.startsWith("/m/")).toBe(false);
    }
  });
});

describe("Mobile Floating Nav — User-Specified Logging Events (Phase 2.5b)", () => {
  beforeEach(() => {
    mobileOwnerTabLogger.clear();
  });

  it("should accept mobile_owner_tab_clicked event with full metadata", () => {
    mobileOwnerTabLogger.log("mobile_owner_tab_clicked", "feed", {
      current_path: "/chat",
      target_path: "/feed/model/mlb",
      tab_name: "feed",
      user_role: "owner",
      is_owner: true,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_tab_clicked");
    expect(last?.tabId).toBe("feed");
    expect(last?.metadata?.current_path).toBe("/chat");
    expect(last?.metadata?.target_path).toBe("/feed/model/mlb");
    expect(last?.metadata?.is_owner).toBe(true);
  });

  it("should accept mobile_owner_tab_navigated_to_m_route event", () => {
    mobileOwnerTabLogger.log("mobile_owner_tab_navigated_to_m_route", "tools", {
      current_path: "/feed/model/mlb",
      target_path: "/betting-splits/MLB",
      tab_name: "tools",
      is_owner: true,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_tab_navigated_to_m_route");
    expect(last?.tabId).toBe("tools");
    expect(last?.metadata?.target_path).toBe("/betting-splits/MLB");
  });

  it("should accept mobile_owner_existing_page_tabs_rendered event", () => {
    mobileOwnerTabLogger.log(
      "mobile_owner_existing_page_tabs_rendered",
      undefined,
      {
        current_path: "/betting-splits",
        target_path: null,
        tab_name: null,
        user_role: "owner",
        is_owner: true,
        is_mobile: true,
        test_mode: false,
        timestamp: Date.now(),
      }
    );
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_existing_page_tabs_rendered");
    expect(last?.metadata?.current_path).toBe("/betting-splits");
    expect(last?.metadata?.is_owner).toBe(true);
  });

  it("should accept mobile_owner_m_route_rendered event", () => {
    mobileOwnerTabLogger.log("mobile_owner_m_route_rendered", undefined, {
      current_path: "/chat",
      target_path: "/chat",
      tab_name: "chat",
      is_owner: true,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_m_route_rendered");
    expect(last?.metadata?.tab_name).toBe("chat");
  });

  it("should accept mobile_owner_non_owner_m_route_denied event", () => {
    mobileOwnerTabLogger.log(
      "mobile_owner_non_owner_m_route_denied",
      undefined,
      {
        current_path: "/feed/model/mlb",
        target_path: null,
        tab_name: null,
        user_role: "user",
        is_owner: false,
        is_mobile: true,
        test_mode: false,
        timestamp: Date.now(),
      }
    );
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_non_owner_m_route_denied");
    expect(last?.metadata?.is_owner).toBe(false);
    expect(last?.metadata?.user_role).toBe("user");
  });

  it("all 5 user-specified events should carry the required metadata fields", () => {
    const events = [
      "mobile_owner_tab_clicked",
      "mobile_owner_tab_navigated_to_m_route",
      "mobile_owner_existing_page_tabs_rendered",
      "mobile_owner_m_route_rendered",
      "mobile_owner_non_owner_m_route_denied",
    ] as const;

    for (const event of events) {
      mobileOwnerTabLogger.log(event, undefined, {
        current_path: "/test",
        target_path: "/m/test",
        tab_name: "feed",
        user_role: "owner",
        is_owner: true,
        is_mobile: true,
        test_mode: false,
        timestamp: Date.now(),
      });
    }

    const entries = mobileOwnerTabLogger.getEntries();
    expect(entries).toHaveLength(5);

    for (const entry of entries) {
      expect(entry.metadata).toBeDefined();
      expect(entry.metadata?.current_path).toBeDefined();
      expect(entry.metadata?.target_path).toBeDefined();
      expect(entry.metadata?.tab_name).toBeDefined();
      expect(entry.metadata?.is_owner).toBeDefined();
      expect(entry.metadata?.is_mobile).toBeDefined();
      expect(entry.metadata?.test_mode).toBeDefined();
      expect(entry.metadata?.timestamp).toBeDefined();
    }
  });
});
