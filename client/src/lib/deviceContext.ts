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
