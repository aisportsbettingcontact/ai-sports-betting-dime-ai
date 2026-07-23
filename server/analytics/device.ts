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
 * the well-known desktop-UA-but-touch case: iPadOS ≥13 Safari in desktop mode
 * reports as **Macintosh** (osFamily "macos") yet is a touch tablet. ONLY that
 * signature — `osFamily === "macos"` + a coarse pointer — upgrades "desktop"
 * to tablet (or mobile for a phone viewport), flagged for data-quality.
 *
 * Deliberately NOT upgraded: Windows touchscreen laptops and ChromeOS
 * convertibles (osFamily "windows"/"linux") report a coarse pointer but are
 * genuine desktops — upgrading them would pollute the "tablet" category. Their
 * disagreement is still flagged via `conflict` for data-quality review without
 * changing the classification.
 */
export function reconcileDeviceType(
  uaDevice: DeviceType,
  osFamily: string,
  clientPointerType?: string | null,
  clientViewportClass?: string | null,
): { deviceType: DeviceType; conflict: boolean } {
  if (uaDevice === "desktop" && clientPointerType === "coarse") {
    // iPadOS-as-Mac: reclassify. Other desktop-UA touch devices: flag only.
    if (osFamily === "macos") {
      const phone = clientViewportClass === "xs" || clientViewportClass === "sm";
      return { deviceType: phone ? "mobile" : "tablet", conflict: true };
    }
    return { deviceType: uaDevice, conflict: true };
  }
  return { deviceType: uaDevice, conflict: false };
}
