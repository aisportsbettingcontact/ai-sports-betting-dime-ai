/**
 * Mobile Owner Tabs — Public API
 * ═══════════════════════════════
 * Barrel export for all mobile owner tab components.
 */

// Config & types
export {
  MOBILE_OWNER_TABS,
  MOBILE_OWNER_TABS_ENABLED,
  MOBILE_OWNER_TABS_TEST_MODE,
  MOBILE_OWNER_TABS_PUBLIC_ENABLED,
  MOBILE_OWNER_TABS_DEBUG_PANEL,
  decideMobileOwnerAccess,
} from "./config";
export type {
  MobileOwnerTabId,
  MobileOwnerTabConfig,
  MobileOwnerAccessDecision,
  MobileOwnerTabEvent,
  MobileOwnerTabLogEntry,
} from "./config";

// Logger
export { mobileOwnerTabLogger } from "./logger";

// Components
export { MobileOwnerAccessGate } from "./MobileOwnerAccessGate";
export { MobileOwnerBottomTabs } from "./MobileOwnerBottomTabs";
export { MobileOwnerTabsShell } from "./MobileOwnerTabsShell";
export { GlobalMobileOwnerTabs } from "./GlobalMobileOwnerTabs";

// Screens
export { MobileFeed } from "./screens/MobileFeed";
export { MobileSplits } from "./screens/MobileSplits";
export { MobileChat } from "./screens/MobileChat";
export { MobileBetTracker } from "./screens/MobileBetTracker";
export { MobileProfile } from "./screens/MobileProfile";
