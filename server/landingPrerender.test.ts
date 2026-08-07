/**
 * landingPrerender.test.ts
 *
 * The bot-facing prerender of "/" must be a content-parity snapshot of the
 * CURRENT landing page (Dime landing v2) — same positioning, same pricing,
 * same brand law — or crawlers index a page that no longer exists.
 *
 * Brand law (design-system/dime-ai/MASTER.md): mint #45E0A8 only; neon green
 * #39FF14 is forbidden. Compliance: RG language (21+, 1-800-GAMBLER) required.
 */
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { landingPrerenderMiddleware } from "./landingPrerender";

function runMiddleware(path: string, ua: string, method = "GET") {
  const req = {
    method,
    path,
    headers: { "user-agent": ua },
  } as unknown as Request;
  const sent: {
    html?: string;
    status?: number;
    headers: Record<string, string>;
  } = { headers: {} };
  const res = {
    setHeader: (k: string, v: string) => {
      sent.headers[k.toLowerCase()] = v;
    },
    status: (code: number) => {
      sent.status = code;
      return res;
    },
    send: (body: string) => {
      sent.html = body;
      return res;
    },
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  landingPrerenderMiddleware(req, res, next);
  return { sent, next };
}

const BOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

describe("landing prerender — Dime landing v2 parity", () => {
  it("serves v2 positioning to bots on /", () => {
    const { sent, next } = runMiddleware("/", BOT_UA);
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(200);
    const html = sent.html ?? "";
    // v2 core promise + classification vocabulary
    expect(html).toContain("See where price and probability");
    expect(html).toContain("disagree");
    expect(html).toContain("Edge Detected");
    expect(html).toContain("Monitor");
    expect(html).toContain("Pass");
    // Money mapping — the CANONICAL catalog (the plans the landing page shows
    // and admin manages: dime-pro / dime-sharp / dime-max), not the legacy
    // $99/$249/$499 ladder that `PLANS` in server/stripe/products.ts still
    // holds for existing subscribers.
    expect(html).toContain("$49.99");
    expect(html).toContain("$99.99");
    expect(html).toContain("$199.99");
    expect(html).toContain("/checkout?plan=dime-pro");
    expect(html).toContain("/checkout?plan=dime-sharp");
    expect(html).toContain("/checkout?plan=dime-max");

    // The legacy ladder must not reappear. Asserted on the FULL card strings,
    // never on the bare numbers: `"$99.99".includes("$99")` is true, so a
    // `not.toContain("$99")` here would fail against the CORRECT price — the
    // exact trap the previous version of this block set for itself.
    expect(html).not.toContain(">$99<");
    expect(html).not.toContain(">$249<");
    expect(html).not.toContain(">$499<");
    expect(html).not.toContain("Operator");
    expect(html).not.toContain("plan=operator");
    expect(html).not.toContain("Join the Waitlist");
    expect(html).not.toContain("Be First to Access");
  });

  // The drift this file previously cemented: the prerender hardcoded one price
  // ladder while the app served another, and the assertions above pinned the
  // WRONG one, so the contradiction was CI-green for as long as it existed.
  // Hardcoding the corrected numbers here would only reset that trap, so the
  // prices are asserted against TIERS — the single place the landing page
  // declares them.
  //
  // TIERS is itself the *fallback* for the live catalog: components/Pricing.tsx
  // reads real prices from the database and falls back to `tier.price`. So this
  // test proves prerender == TIERS; keeping TIERS in step with the admin
  // catalog is a separate obligation and cannot be asserted from a static
  // snapshot that never queries the database.
  it("prerender pricing matches TIERS — the landing page's own declaration", async () => {
    const { TIERS } =
      await import("../client/src/pages/dime/landing/landing-content");
    const { sent } = runMiddleware("/", BOT_UA);
    const html = sent.html ?? "";

    const paid = TIERS.filter(
      (t: { price: string }) => t.price !== "By application" && t.price !== "$0"
    );
    expect(paid.length).toBeGreaterThanOrEqual(3);

    for (const tier of paid) {
      expect(
        html,
        `prerender is missing TIERS price ${tier.price} for "${tier.name}" — the bot-facing page and the landing page disagree`
      ).toContain(tier.price);
      expect(
        html,
        `prerender is missing the checkout slug for "${tier.name}"`
      ).toContain(`/checkout?plan=${tier.action.plan}`);
    }
  });

  it("obeys brand law: mint #45E0A8, no neon #39FF14, Familjen Grotesk stack", () => {
    const { sent } = runMiddleware("/", BOT_UA);
    const html = sent.html ?? "";
    expect(html).toContain("#45E0A8");
    expect(html).not.toMatch(/#39FF14/i);
    expect(html).toContain("Familjen Grotesk");
  });

  it("keeps responsible-gaming language (21+, 1-800-GAMBLER)", () => {
    const { sent } = runMiddleware("/", BOT_UA);
    const html = sent.html ?? "";
    expect(html).toContain("1-800-GAMBLER");
    expect(html).toContain("21+");
  });

  it("keeps honesty law: no guarantees language, PASS is first-class", () => {
    const { sent } = runMiddleware("/", BOT_UA);
    const html = sent.html ?? "";
    expect(html.toLowerCase()).not.toContain("guaranteed win");
    expect(html).toContain("No guaranteed outcomes");
  });

  it("real browsers on / fall through to the SPA", () => {
    const { sent, next } = runMiddleware("/", BROWSER_UA);
    expect(next).toHaveBeenCalledOnce();
    expect(sent.html).toBeUndefined();
  });

  it("legal pages still serve to all user agents", () => {
    for (const path of ["/privacy", "/terms"]) {
      const { sent, next } = runMiddleware(path, BROWSER_UA);
      expect(next).not.toHaveBeenCalled();
      expect(sent.status).toBe(200);
      expect(sent.html).toContain("1-800-GAMBLER");
    }
  });

  it("non-GET requests pass through untouched", () => {
    const { next, sent } = runMiddleware("/", BOT_UA, "POST");
    expect(next).toHaveBeenCalledOnce();
    expect(sent.html).toBeUndefined();
  });
});
