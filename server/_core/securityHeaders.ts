import type { Request, Response, NextFunction } from "express";

/**
 * Permissions-Policy (formerly Feature-Policy).
 *
 * helmet stopped emitting this header in v5+ (the spec churned and it was
 * dropped from the default set), so we set it explicitly on top of the helmet
 * middleware. It is the last line that keeps a *successful* XSS from reaching
 * powerful device capabilities: an injected script still cannot open the camera,
 * mic, geolocation, USB/serial/Bluetooth/HID, MIDI, or motion sensors, because
 * the top-level document has disabled those features for every origin (`=()`).
 *
 * `payment` is the one capability we deliberately DELEGATE rather than deny:
 * Stripe Embedded Checkout mounts an iframe from checkout.stripe.com / js.stripe
 * .com (see the CSP frame-src in index.ts), and Apple Pay / Google Pay inside it
 * use the Payment Request API, which requires the top-level Permissions-Policy to
 * allow `payment` for those origins. We mirror the CSP's Stripe origins exactly.
 * This is strictly >= the browser default (`self`), so it cannot break checkout.
 *
 * `interest-cohort` (FLoC) and `browsing-topics` (Topics API) are disabled to opt
 * the site out of interest-based ad tracking — a privacy hardening with no
 * functional cost.
 *
 * Only unambiguously-unused capabilities are denied. UX features the app may use
 * (fullscreen, clipboard, autoplay) are intentionally omitted so they stay at the
 * browser default and this header can never regress behavior. A malformed
 * directive is ignored per-directive by the browser (never voids the header),
 * so the forward-looking entries are safe.
 */
const STRIPE_PAYMENT_ORIGINS = [
  "self",
  '"https://js.stripe.com"',
  '"https://checkout.stripe.com"',
].join(" ");

export const PERMISSIONS_POLICY: string = [
  "accelerometer=()",
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "hid=()",
  "midi=()",
  `payment=(${STRIPE_PAYMENT_ORIGINS})`,
  "interest-cohort=()",
  "browsing-topics=()",
].join(", ");

/**
 * Express middleware that stamps the Permissions-Policy header on every response.
 * Registered right after helmet so it composes with the rest of the security
 * header set. Never throws; sets one static header.
 */
export function permissionsPolicy() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
  };
}
