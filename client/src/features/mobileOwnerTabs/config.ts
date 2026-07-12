/**
 * Mobile Owner Tabs — Feature Flags & Configuration
 * ═══════════════════════════════════════════════════
 * Mobile bottom tab navigation for ALL authenticated users (<768px).
 * ("Owner" in the module name is historical — the bar launched owner-only
 * and went public 2026-07-12 via MOBILE_OWNER_TABS_PUBLIC_ENABLED.)
 * All flags are compile-time constants for tree-shaking.
 */

// ─── Feature Flags ───────────────────────────────────────────────────────────
export const MOBILE_OWNER_TABS_ENABLED = true;
export const MOBILE_OWNER_TABS_TEST_MODE = false; // Superseded by PUBLIC_ENABLED (kept for rollback)
// All authenticated mobile users see the tabs. Authentication is still
// required — decideMobileOwnerAccess checks isAuthenticated before this flag.
export const MOBILE_OWNER_TABS_PUBLIC_ENABLED = true;
// Debug overlay must stay off now that the tabs are public — it renders for
// everyone who can reach /m/* (MobileOwnerDebugPanel gates on this flag only).
export const MOBILE_OWNER_TABS_DEBUG_PANEL = false;

// ─── Tab Definitions ─────────────────────────────────────────────────────────
export type MobileOwnerTabId = "feed" | "splits" | "chat" | "props" | "profile";

export interface MobileOwnerTabConfig {
  id: MobileOwnerTabId;
  label: string;
  path: string;
  iconName: string; // lucide-react icon name
  badge?: number | null;
  disabled?: boolean;
}

// [NAV RECONSTRUCTION 2026-07-11] Legacy query-string hooks are eradicated —
// tabs target the canonical path-based routes only.
// /feed/model/mlb canonicalizes to today's dated URL inside DimeModelFeed.
export const MOBILE_OWNER_TABS: MobileOwnerTabConfig[] = [
  { id: "feed", label: "Feed", path: "/feed/model/mlb", iconName: "Newspaper" },
  { id: "splits", label: "Splits", path: "/betting-splits/MLB", iconName: "BarChart3" },
  { id: "chat", label: "Chat", path: "/chat", iconName: "MessageSquare" },
  { id: "props", label: "Props", path: "/m/props", iconName: "FlaskConical" },
  { id: "profile", label: "Profile", path: "/profile", iconName: "User" },
];

// ─── Access Decision Type ────────────────────────────────────────────────────
export type MobileOwnerAccessDecision =
  | { granted: true; reason: "owner" | "test_mode" | "public" }
  | { granted: false; reason: "feature_disabled" | "not_authenticated" | "not_owner" | "not_mobile" };

// ─── Access Logic ────────────────────────────────────────────────────────────
export function decideMobileOwnerAccess(
  userRole: string | null | undefined,
  isAuthenticated: boolean,
  isMobile: boolean
): MobileOwnerAccessDecision {
  if (!MOBILE_OWNER_TABS_ENABLED) {
    return { granted: false, reason: "feature_disabled" };
  }
  if (!isAuthenticated) {
    return { granted: false, reason: "not_authenticated" };
  }
  if (MOBILE_OWNER_TABS_PUBLIC_ENABLED) {
    return { granted: true, reason: "public" };
  }
  if (MOBILE_OWNER_TABS_TEST_MODE) {
    return { granted: true, reason: "test_mode" };
  }
  if (userRole === "owner") {
    return { granted: true, reason: "owner" };
  }
  return { granted: false, reason: "not_owner" };
}

// ─── Logging Event Types ─────────────────────────────────────────────────────
export type MobileOwnerTabEvent =
  | "tabs_rendered"
  | "tab_tapped"
  | "tab_changed"
  | "access_granted"
  | "access_denied"
  | "shell_mounted"
  | "shell_unmounted"
  | "debug_panel_opened"
  | "debug_panel_closed"
  | "feature_flag_checked"
  | "route_navigated"
  | "haptic_triggered"
  | "animation_started"
  | "animation_completed"
  | "error_boundary_caught"
  | "chat_chip_tapped"
  | "bet_tracker_action"
  | "profile_action"
  | "scroll_position_saved"
  | "scroll_position_restored"
  | "viewport_resized"
  | "safe_area_detected"
  | "theme_applied"
  // Phase 2: Data connection events
  | "mobile_feed_data_fetch_started"
  | "mobile_feed_data_fetch_completed"
  | "mobile_feed_data_fetch_failed"
  | "mobile_feed_empty_state_rendered"
  | "mobile_splits_data_fetch_started"
  | "mobile_splits_data_fetch_completed"
  | "mobile_splits_data_fetch_failed"
  | "mobile_splits_empty_state_rendered"
  | "mobile_chat_state_loaded"
  | "mobile_chat_preview_action_clicked"
  | "mobile_chat_preview_action_blocked"
  | "mobile_bet_tracker_data_fetch_started"
  | "mobile_bet_tracker_data_fetch_completed"
  | "mobile_bet_tracker_data_fetch_failed"
  | "mobile_bet_tracker_empty_state_rendered"
  | "mobile_profile_data_loaded"
  | "mobile_profile_data_failed"
  // Phase 2.5: Global mount events
  | "mount_attempted"
  | "mount_success"
  | "mount_skipped"
  | "mount_skipped_non_owner"
  | "mount_skipped_feature_disabled"
  | "mount_skipped_not_mobile"
  | "global_layout_mount_enabled"
  | "role_resolution"
  | "feature_flags_detected"
  | "css_visibility_checked"
  | "route_render_verified"
  // Phase 2.5b: User-specified global tab interaction events
  | "mobile_owner_tab_clicked"
  | "mobile_owner_tab_navigated_to_m_route"
  | "mobile_owner_existing_page_tabs_rendered"
  | "mobile_owner_m_route_rendered"
  | "mobile_owner_non_owner_m_route_denied"
  // Phase 2.5c: Visual refinement events
  | "mobile_owner_tabs_visual_refinement_loaded"
  | "mobile_owner_tabs_visual_refinement_active_state_verified"
  | "mobile_owner_tabs_visual_refinement_safe_area_verified";

export interface MobileOwnerTabLogEntry {
  timestamp: number;
  event: MobileOwnerTabEvent;
  tabId?: MobileOwnerTabId;
  metadata?: Record<string, unknown>;
}
