/**
 * Guards the post-deploy recovery path. The production incident this fixes was
 * invisible in tests because the server answered a missing chunk with 200 HTML,
 * so nothing ever threw server-side — the failure only appeared in the browser.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { isStaleChunkError, reloadAlreadyAttempted } from "./staleChunkReload";

describe("isStaleChunkError", () => {
  it("[SC-1] recognises the exact production error", () => {
    expect(
      isStaleChunkError(
        new Error(
          "Failed to fetch dynamically imported module: https://aisportsbettingmodels.com/assets/Home-BjN98xuQ.js"
        )
      )
    ).toBe(true);
  });

  it("[SC-2] recognises the other browsers' phrasings", () => {
    for (const m of [
      "error loading dynamically imported module: /assets/x.js",
      "Importing a module script failed.", // Safari
      'Expected a JavaScript module script but the server responded with a MIME type of "text/html"',
      "Unexpected token '<'", // HTML parsed as JS
    ])
      expect(isStaleChunkError(new Error(m)), m).toBe(true);
  });

  it("[SC-3] accepts strings and error-like objects, not just Error", () => {
    expect(
      isStaleChunkError("Failed to fetch dynamically imported module: /a.js")
    ).toBe(true);
    expect(
      isStaleChunkError({
        message: "Failed to fetch dynamically imported module: /a.js",
      })
    ).toBe(true);
  });

  it("[SC-4] does NOT swallow ordinary application errors", () => {
    for (const m of [
      "Cannot read properties of undefined (reading 'map')",
      "Network request failed",
      "UNAUTHORIZED",
      "",
    ])
      expect(isStaleChunkError(new Error(m)), m).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe("reload loop guard", () => {
  let store: Record<string, string>;
  const storage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    length: 0,
  } as unknown as Storage;

  beforeEach(() => {
    store = {};
  });
  afterEach(() => vi.restoreAllMocks());

  it("[RG-1] permits the first recovery", () => {
    expect(reloadAlreadyAttempted(1_000_000, storage)).toBe(false);
  });

  it("[RG-2] suppresses a second reload inside the window — this is what stops an infinite loop", () => {
    store["dime:staleChunkReloadAt"] = String(1_000_000);
    expect(reloadAlreadyAttempted(1_000_000 + 5_000, storage)).toBe(true);
  });

  it("[RG-3] permits recovery again after the window expires (a later, unrelated deploy)", () => {
    store["dime:staleChunkReloadAt"] = String(1_000_000);
    expect(reloadAlreadyAttempted(1_000_000 + 60_000, storage)).toBe(false);
  });

  it("[RG-4] treats a corrupt marker as no attempt rather than blocking recovery", () => {
    store["dime:staleChunkReloadAt"] = "not-a-number";
    expect(reloadAlreadyAttempted(1_000_000, storage)).toBe(false);
  });

  it("[RG-5] tolerates storage being unavailable (Safari private mode)", () => {
    expect(reloadAlreadyAttempted(1_000_000, undefined)).toBe(false);
  });
});
