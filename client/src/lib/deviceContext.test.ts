import { describe, it, expect } from "vitest";
import { getViewportClass, getAppSurface, buildClientDeviceContext } from "./deviceContext";

describe("getViewportClass", () => {
  it("buckets width at the 480/768/1024/1440 boundaries", () => {
    expect(getViewportClass(320)).toBe("xs");
    expect(getViewportClass(600)).toBe("sm");
    expect(getViewportClass(800)).toBe("md");   // the 768 device boundary
    expect(getViewportClass(1200)).toBe("lg");
    expect(getViewportClass(1600)).toBe("xl");
  });
});

describe("getAppSurface", () => {
  it("maps /m/* to the mobile shell", () => {
    expect(getAppSurface("/m/feed", "sm")).toBe("web-mobile-shell");
  });
  it("maps a small viewport on a desktop route to responsive", () => {
    expect(getAppSurface("/feed/model/mlb", "xs")).toBe("web-responsive");
  });
  it("maps a wide viewport to the desktop shell", () => {
    expect(getAppSurface("/chat", "lg")).toBe("web-desktop-shell");
  });
});

describe("buildClientDeviceContext", () => {
  it("never throws and returns coarse buckets only (jsdom)", () => {
    const c = buildClientDeviceContext();
    expect(["xs","sm","md","lg","xl"]).toContain(c.viewportClass);
    expect(["portrait","landscape"]).toContain(c.orientation);
    expect(typeof c.isTouch).toBe("boolean");
    // No raw pixels / fingerprints leak through the public shape.
    expect(c).not.toHaveProperty("width");
    expect(c).not.toHaveProperty("userAgent");
  });
});
