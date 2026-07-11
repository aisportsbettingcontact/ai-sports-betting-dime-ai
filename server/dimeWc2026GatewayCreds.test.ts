import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guard for the WC2026 route's Anthropic credential resolution.
 *
 * Defect (P2): dime-wc2026.route.ts read only process.env.ANTHROPIC_API_KEY and
 * constructed `new Anthropic({ apiKey })` directly, bypassing
 * createAnthropicClient(). A gateway-only deployment (ANTHROPIC_AUTH_TOKEN +
 * ANTHROPIC_BASE_URL, no ANTHROPIC_API_KEY) therefore 500'd on WC2026 while the
 * sibling chat route worked. The fix routes both credential modes through
 * createAnthropicClient()/hasAnthropicCredentials(). This source-level check
 * (same pattern as mlbRunLineOdds.test.ts) locks the wiring.
 */

const routeSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-wc2026.route.ts"),
  "utf8",
);

describe("WC2026 route Anthropic credentials", () => {
  it("uses the shared createAnthropicClient factory", () => {
    expect(routeSrc).toMatch(/createAnthropicClient\s*\(\s*\)/);
    expect(routeSrc).toMatch(/from "\.\/_core\/anthropicClient"/);
  });

  it("gates on hasAnthropicCredentials rather than ANTHROPIC_API_KEY alone", () => {
    expect(routeSrc).toMatch(/hasAnthropicCredentials\s*\(\s*\)/);
  });

  it("does not construct the SDK client from a bare apiKey env read", () => {
    expect(routeSrc).not.toMatch(/new Anthropic\(\s*\{\s*apiKey\s*\}\s*\)/);
  });
});
