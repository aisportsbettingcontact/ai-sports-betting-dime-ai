/**
 * Mobile Nav — Public API
 * ═══════════════════════════════
 * Barrel export for all mobile nav components.
 */

// Config & types
export {
  MOBILE_NAV_TABS,
  MOBILE_NAV_ENABLED,
  MOBILE_NAV_DEBUG_PANEL,
  CHAT_TAB_INDEX,
  decideMobileNavAccess,
} from "./config";
export type {
  MobileNavTabId,
  MobileNavTabConfig,
  MobileNavAccessDecision,
  MobileNavEvent,
  MobileNavLogEntry,
} from "./config";

// Logger
export { mobileNavLogger } from "./logger";

// Components
export { MobileNavAuthGate } from "./MobileNavAuthGate";
export { MobileFloatingNav } from "./MobileFloatingNav";
export { MobileNavShell } from "./MobileNavShell";
export { GlobalMobileNav } from "./GlobalMobileNav";
export { getActiveTabId } from "./activeTab";

// Screens
export { MobileFeed } from "./screens/MobileFeed";
export { MobileSplits } from "./screens/MobileSplits";
export { MobileChat } from "./screens/MobileChat";
export { MobileBetTracker } from "./screens/MobileBetTracker";
export { MobileProfile } from "./screens/MobileProfile";
