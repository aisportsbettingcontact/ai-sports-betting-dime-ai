/**
 * Active-destination matcher for the mobile floating nav.
 * ═══════════════════════════════════════════════════════
 * Pure pathname → tab-id resolution so it can be unit-tested without a DOM
 * (repo convention: routing logic lives in pure modules — see
 * dime-shell/productRoute.ts). Query strings and hashes never affect
 * activation.
 *
 * Contract (docs/plans/2026-07-18-mobile-floating-nav.md):
 * - Any dated/sport variant of a surface keeps its tab active
 *   (/feed/model/wc-07-18-2026 is still "feed").
 * - The orphaned /m/* screens map onto their owning tabs so deep links still
 *   highlight correctly; /m/props has no tab anymore and returns null.
 * - No default: aria-current belongs ONLY to a genuinely active destination,
 *   so unmatched paths (e.g. /wc2026, /account, /admin/*) return null.
 *   (The retired bottom bar defaulted to "feed" — that was a semantics bug.)
 */

import type { MobileOwnerTabId } from "./config";

export function getActiveTabId(location: string): MobileOwnerTabId | null {
  const path = location.split(/[?#]/, 1)[0] || "/";

  if (path.startsWith("/feed/model") || path === "/m/feed") return "feed";
  if (path.startsWith("/betting-splits") || path === "/m/splits")
    return "tools";
  if (path === "/chat" || path.startsWith("/chat/") || path === "/m/chat")
    return "chat";
  if (path === "/bet-tracker" || path.startsWith("/bet-tracker/"))
    return "tracker";
  if (
    path === "/profile" ||
    path.startsWith("/profile/") ||
    path === "/m/profile"
  )
    return "profile";

  return null;
}
