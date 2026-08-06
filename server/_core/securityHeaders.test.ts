import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS_POLICY, permissionsPolicy } from "./securityHeaders";

describe("PERMISSIONS_POLICY value", () => {
  const directives = new Map(
    PERMISSIONS_POLICY.split(", ").map(d => {
      const i = d.indexOf("=");
      return [d.slice(0, i), d.slice(i + 1)] as const;
    })
  );

  it("denies every powerful device/sensor capability the app never uses", () => {
    for (const feature of [
      "camera",
      "microphone",
      "geolocation",
      "usb",
      "serial",
      "bluetooth",
      "hid",
      "midi",
      "accelerometer",
      "gyroscope",
      "magnetometer",
    ]) {
      // `feature=()` = disabled for ALL origins (including self)
      expect(directives.get(feature)).toBe("()");
    }
  });

  it("delegates `payment` to self + Stripe Embedded Checkout origins (never denies it)", () => {
    const payment = directives.get("payment");
    expect(payment).toBeDefined();
    expect(payment).not.toBe("()"); // must NOT be denied — would break Apple/Google Pay
    expect(payment).toContain("self");
    expect(payment).toContain('"https://js.stripe.com"');
    expect(payment).toContain('"https://checkout.stripe.com"');
  });

  it("opts out of interest-based ad tracking (FLoC + Topics)", () => {
    expect(directives.get("interest-cohort")).toBe("()");
    expect(directives.get("browsing-topics")).toBe("()");
  });

  it("does NOT restrict UX features that could regress behavior (fullscreen/clipboard/autoplay)", () => {
    // Omitted → browser default; the header can only tighten, never these.
    expect(directives.has("fullscreen")).toBe(false);
    expect(directives.has("clipboard-write")).toBe(false);
    expect(directives.has("autoplay")).toBe(false);
  });

  it("is a well-formed single-line header (comma-space separated, no trailing separator)", () => {
    expect(PERMISSIONS_POLICY).not.toMatch(/,\s*$/);
    expect(PERMISSIONS_POLICY).not.toContain(",,");
    for (const [, value] of directives) {
      // every value is a parenthesized allowlist
      expect(value.startsWith("(") && value.endsWith(")")).toBe(true);
    }
  });
});

describe("permissionsPolicy() middleware", () => {
  it("stamps the Permissions-Policy header and calls next()", () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    permissionsPolicy()(
      {} as never,
      { setHeader } as never,
      next as never
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Permissions-Policy",
      PERMISSIONS_POLICY
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
