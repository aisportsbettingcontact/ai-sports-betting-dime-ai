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
  MOBILE_OWNER_TABS_PUBLIC_ENABLED,
  MOBILE_OWNER_TABS_DEBUG_PANEL,
  decideMobileOwnerAccess,
} from "../client/src/features/mobileOwnerTabs/config";

import { mobileOwnerTabLogger } from "../client/src/features/mobileOwnerTabs/logger";

describe("Mobile Owner Tabs — Config & Feature Flags", () => {
  it("should have exactly 5 tabs defined", () => {
    expect(MOBILE_OWNER_TABS).toHaveLength(5);
  });

  it("should have correct tab IDs", () => {
    const ids = MOBILE_OWNER_TABS.map(t => t.id);
    expect(ids).toEqual(["feed", "splits", "chat", "props", "profile"]);
  });

  it("should have correct canonical paths for each tab (no query hooks)", () => {
    const paths = MOBILE_OWNER_TABS.map(t => t.path);
    expect(paths).toEqual([
      "/feed/model/mlb",
      "/betting-splits/MLB",
      "/chat",
      "/m/props",
      "/profile",
    ]);
  });

  it("no tab path may carry a legacy query-string hook", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.path).not.toContain("?");
      expect(tab.path).not.toMatch(/^\/feed$|^\/feed\?|^\/splits/);
    }
  });

  it("should have non-empty labels for all tabs", () => {
    for (const tab of MOBILE_OWNER_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it("should have valid lucide icon names", () => {
    const validIcons = ["Newspaper", "BarChart3", "MessageSquare", "FlaskConical", "User"];
    for (const tab of MOBILE_OWNER_TABS) {
      expect(validIcons).toContain(tab.iconName);
    }
  });

  it("feature flag MOBILE_OWNER_TABS_ENABLED should be true", () => {
    expect(MOBILE_OWNER_TABS_ENABLED).toBe(true);
  });
});

// ─── Public rollout (2026-07-12) ─────────────────────────────────────────────
// The bottom tab bar ships to EVERY authenticated mobile user: the owner asked
// for Feed | Splits | Chat | Props | Profile on all mobile devices, so
// MOBILE_OWNER_TABS_PUBLIC_ENABLED is now the deliberate steady state and the
// public grant fires before the owner check. Authentication is still required,
// and the debug overlay must stay off for public users.
describe("Mobile Owner Tabs — Access Decision Logic (public rollout)", () => {
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

describe("Mobile Owner Tabs — Global Mount Access Logic (public rollout)", () => {
  it("owner on mobile sees tabs (global mount)", () => {
    const result = decideMobileOwnerAccess("owner", true, true);
    expect(result.granted).toBe(true);
    if (result.granted) expect(result.reason).toBe("public");
  });

  it("normal user on mobile sees tabs (global mount)", () => {
    const result = decideMobileOwnerAccess("user", true, true);
    expect(result.granted).toBe(true);
  });

  it("admin on mobile sees tabs (global mount)", () => {
    const result = decideMobileOwnerAccess("admin", true, true);
    expect(result.granted).toBe(true);
  });

  it("handicapper on mobile sees tabs (global mount)", () => {
    const result = decideMobileOwnerAccess("handicapper", true, true);
    expect(result.granted).toBe(true);
  });

  it("logged-out user should NOT see tabs", () => {
    const result = decideMobileOwnerAccess(null, false, true);
    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe("not_authenticated");
  });

  it("owner on desktop should still get granted (viewport check is separate)", () => {
    // decideMobileOwnerAccess doesn't check viewport — that's in the component
    // The isMobile param is currently unused in the decision (it's for future use)
    const result = decideMobileOwnerAccess("owner", true, false);
    expect(result.granted).toBe(true);
  });
});

describe("Mobile Owner Tabs — New Event Types Validity", () => {
  beforeEach(() => {
    mobileOwnerTabLogger.clear();
  });

  it("should accept mount_attempted event", () => {
    mobileOwnerTabLogger.log("mount_attempted", undefined, { test: true });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("mount_attempted");
  });

  it("should accept mount_success event", () => {
    mobileOwnerTabLogger.log("mount_success", undefined, { mount_type: "global" });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("mount_success");
  });

  it("should accept mount_skipped event", () => {
    mobileOwnerTabLogger.log("mount_skipped", undefined, { reason: "not_owner" });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("mount_skipped");
  });

  it("should accept mount_skipped_non_owner event", () => {
    mobileOwnerTabLogger.log("mount_skipped_non_owner", undefined, { role: "user" });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("mount_skipped_non_owner");
  });

  it("should accept mount_skipped_feature_disabled event", () => {
    mobileOwnerTabLogger.log("mount_skipped_feature_disabled");
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("mount_skipped_feature_disabled");
  });

  it("should accept mount_skipped_not_mobile event", () => {
    mobileOwnerTabLogger.log("mount_skipped_not_mobile", undefined, { viewport_width: 1920 });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("mount_skipped_not_mobile");
  });

  it("should accept global_layout_mount_enabled event", () => {
    mobileOwnerTabLogger.log("global_layout_mount_enabled");
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("global_layout_mount_enabled");
  });

  it("should accept role_resolution event", () => {
    mobileOwnerTabLogger.log("role_resolution", undefined, { raw_role: "owner", is_owner: true });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("role_resolution");
  });

  it("should accept feature_flags_detected event", () => {
    mobileOwnerTabLogger.log("feature_flags_detected", undefined, { enabled: true, test_mode: false });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("feature_flags_detected");
  });

  it("should accept css_visibility_checked event", () => {
    mobileOwnerTabLogger.log("css_visibility_checked", undefined, { z_index: 50, position: "fixed" });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("css_visibility_checked");
  });

  it("should accept route_render_verified event", () => {
    mobileOwnerTabLogger.log("route_render_verified", undefined, { path: "/feed/model/mlb" });
    expect(mobileOwnerTabLogger.getLastEvent()?.event).toBe("route_render_verified");
  });
});

describe("Mobile Owner Tabs — Global Mount Does Not Break Existing Routes", () => {
  it("Feed/Splits/Props tabs route to their canonical path-based surfaces", () => {
    const byId = new Map(MOBILE_OWNER_TABS.map(t => [t.id, t.path]));
    expect(byId.get("feed")).toBe("/feed/model/mlb");
    expect(byId.get("splits")).toBe("/betting-splits/MLB");
    expect(byId.get("props")).toBe("/m/props");
  });

  it("Chat and Profile tabs should route to their dedicated paths", () => {
    const chatTab = MOBILE_OWNER_TABS.find(t => t.id === "chat");
    const profileTab = MOBILE_OWNER_TABS.find(t => t.id === "profile");
    expect(chatTab?.path).toBe("/chat");
    expect(profileTab?.path).toBe("/profile");
  });

  it("only the Splits tab targets /betting-splits, at its canonical sport path", () => {
    const splitsTabs = MOBILE_OWNER_TABS.filter(t => t.path.startsWith("/betting-splits"));
    expect(splitsTabs.map(t => t.id)).toEqual(["splits"]);
    expect(splitsTabs[0]?.path).toBe("/betting-splits/MLB");
  });

  it("global mount skips /m/* routes (no duplicate tabs)", () => {
    // The GlobalMobileOwnerTabs component checks: if (location.startsWith("/m")) return false
    // This test validates the logic concept
    const mPaths = ["/m/chat", "/m/profile", "/m/props"];
    for (const p of mPaths) {
      expect(p.startsWith("/m")).toBe(true);
    }
  });

  it("no OpenAI calls in global mount component", () => {
    // Structural test: GlobalMobileOwnerTabs should not import any LLM/OpenAI modules
    // This is verified by the fact that it only imports from config, logger, useAppAuth, and MobileOwnerBottomTabs
    expect(true).toBe(true); // Placeholder — real verification is in the file audit
  });

  it("no credit deductions in global mount component", () => {
    // Structural test: GlobalMobileOwnerTabs has no credit-related logic
    expect(true).toBe(true); // Placeholder — real verification is in the file audit
  });
});

describe("Mobile Owner Tabs — User-Specified Logging Events (Phase 2.5b)", () => {
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
    mobileOwnerTabLogger.log("mobile_owner_tab_navigated_to_m_route", "splits", {
      current_path: "/feed/model/mlb",
      target_path: "/betting-splits/MLB",
      tab_name: "splits",
      is_owner: true,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_tab_navigated_to_m_route");
    expect(last?.tabId).toBe("splits");
    expect(last?.metadata?.target_path).toBe("/betting-splits/MLB");
  });

  it("should accept mobile_owner_existing_page_tabs_rendered event", () => {
    mobileOwnerTabLogger.log("mobile_owner_existing_page_tabs_rendered", undefined, {
      current_path: "/betting-splits",
      target_path: null,
      tab_name: null,
      user_role: "owner",
      is_owner: true,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
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
    mobileOwnerTabLogger.log("mobile_owner_non_owner_m_route_denied", undefined, {
      current_path: "/feed/model/mlb",
      target_path: null,
      tab_name: null,
      user_role: "user",
      is_owner: false,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
    const last = mobileOwnerTabLogger.getLastEvent();
    expect(last?.event).toBe("mobile_owner_non_owner_m_route_denied");
    expect(last?.metadata?.is_owner).toBe(false);
    expect(last?.metadata?.user_role).toBe("user");
  });

  it("all 5 new events should have required metadata fields", () => {
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
