import { describe, it, expect } from "vitest";
import { deriveDeviceFromUA, reconcileDeviceType } from "./device";

describe("deriveDeviceFromUA", () => {
  it("classifies an iPhone as mobile/ios/safari", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "mobile", osFamily: "ios", browserFamily: "safari" });
  });
  it("classifies an Android phone as mobile/android/chrome", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "mobile", osFamily: "android", browserFamily: "chrome" });
  });
  it("classifies an iPad as tablet/ipados/safari", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "tablet", osFamily: "ipados", browserFamily: "safari" });
  });
  it("classifies an Android tablet (no 'Mobile' token) as tablet", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    expect(deriveDeviceFromUA(ua).deviceType).toBe("tablet");
  });
  it("classifies a Windows desktop as desktop/windows/edge", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
    expect(deriveDeviceFromUA(ua)).toEqual({ deviceType: "desktop", osFamily: "windows", browserFamily: "edge" });
  });
  it("is safe on empty/undefined UA", () => {
    expect(deriveDeviceFromUA(undefined)).toEqual({ deviceType: "desktop", osFamily: "other", browserFamily: "other" });
  });
});

describe("reconcileDeviceType", () => {
  it("upgrades an iPadOS-as-Mac (macos + coarse) desktop to tablet", () => {
    expect(reconcileDeviceType("desktop", "macos", "coarse", "md")).toEqual({ deviceType: "tablet", conflict: true });
  });
  it("upgrades a macos coarse-pointer device with a phone viewport to mobile", () => {
    expect(reconcileDeviceType("desktop", "macos", "coarse", "xs")).toEqual({ deviceType: "mobile", conflict: true });
  });
  it("keeps a Windows touch laptop as desktop (flags the conflict only)", () => {
    expect(reconcileDeviceType("desktop", "windows", "coarse", "md")).toEqual({ deviceType: "desktop", conflict: true });
  });
  it("keeps a ChromeOS/Linux convertible as desktop (flags the conflict only)", () => {
    expect(reconcileDeviceType("desktop", "linux", "coarse", "lg")).toEqual({ deviceType: "desktop", conflict: true });
  });
  it("leaves a mouse desktop unchanged", () => {
    expect(reconcileDeviceType("desktop", "macos", "fine", "xl")).toEqual({ deviceType: "desktop", conflict: false });
  });
  it("trusts the UA for an already-mobile classification", () => {
    expect(reconcileDeviceType("mobile", "ios", "fine", "xl")).toEqual({ deviceType: "mobile", conflict: false });
  });
});
