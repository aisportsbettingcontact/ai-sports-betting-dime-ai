import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DIME_CHAT_FROZEN_NOTICE,
  DIME_CHAT_LLM_PROVIDER,
} from "./_core/dimeChatModel";

/**
 * Dime Chat provider contract tests.
 *
 * History: frozen 2026-07-12 ("no Anthropic API use, keep all Claude wiring
 * intact"); unfrozen 2026-08-01 by explicit owner direction back onto the
 * preserved "anthropic" streaming path — the exact restore the freeze was
 * designed for, requiring zero route changes (the route file is hash-pinned
 * by ml/dime-1.0 evaluation evidence). The "pi" embedded-runtime provider is
 * reserved and gated on that evidence being re-frozen (see dimeChatModel.ts).
 *
 * These tests pin the CURRENT contract with the same rigor the freeze tests
 * pinned the old one:
 *   1. the active provider is exactly "anthropic" — any silent change fails CI;
 *   2. the frozen short-circuit machinery is preserved unchanged, so
 *      re-freezing remains a one-constant revert;
 *   3. the full Claude streaming path is live and precedes nothing it
 *      shouldn't (freeze branch still guards non-live providers first).
 * Scope is the Dime Chat interface only — other Claude surfaces (wc2026,
 * claudeRouter) are intentionally not governed by this switch.
 */

const routeSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const wc2026Src = fs.readFileSync(
  path.join(import.meta.dirname, "dime-wc2026.route.ts"),
  "utf8"
);
const claudeRouterSrc = fs.readFileSync(
  path.join(import.meta.dirname, "claudeRouter.ts"),
  "utf8"
);

describe("provider switch — anthropic live state (owner-authorized unfreeze, 2026-08-01)", () => {
  it('the Dime Chat provider is exactly "anthropic"', () => {
    expect(DIME_CHAT_LLM_PROVIDER).toBe("anthropic");
  });

  it("retains the hardcoded frozen notice for any future re-freeze", () => {
    expect(DIME_CHAT_FROZEN_NOTICE.length).toBeGreaterThan(0);
    expect(DIME_CHAT_FROZEN_NOTICE).toContain("temporarily offline");
  });
});

describe("POST /api/dime/chat — frozen machinery preserved ahead of the live path", () => {
  const freezeIdx = routeSrc.indexOf(
    'if (DIME_CHAT_LLM_PROVIDER !== "anthropic")'
  );
  const contextIdx = routeSrc.indexOf("getDimeChatContext(", freezeIdx);
  const clientIdx = routeSrc.indexOf(
    "const anthropic = createAnthropicClient()"
  );
  const streamIdx = routeSrc.indexOf("anthropic.messages.stream");

  it("the frozen branch exists and precedes context building and every Anthropic call", () => {
    expect(freezeIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(freezeIdx);
    expect(clientIdx).toBeGreaterThan(freezeIdx);
    expect(streamIdx).toBeGreaterThan(freezeIdx);
  });

  it("the frozen branch streams the hardcoded notice and terminates the response", () => {
    const branch = routeSrc.slice(freezeIdx, contextIdx);
    expect(branch).toContain('type: "meta"');
    expect(branch).toContain('dataFreshness: "none"');
    expect(branch).toContain(
      'sendFrozen({ type: "delta", text: DIME_CHAT_FROZEN_NOTICE })'
    );
    expect(branch).toContain('type: "done"');
    expect(branch).toContain('stopReason: "end_turn"');
    expect(branch).toMatch(/res\.end\(\);\s*return;/);
    // No Anthropic call sites inside the frozen branch itself (the guard's
    // "anthropic" string literal is the provider name, not a call).
    expect(branch).not.toMatch(
      /createAnthropicClient|hasAnthropicCredentials|messages\.stream|Anthropic\./
    );
  });

  it("demands Anthropic credentials on the live path", () => {
    expect(routeSrc).toContain(
      'DIME_CHAT_LLM_PROVIDER === "anthropic" && !hasAnthropicCredentials()'
    );
  });
});

describe("Claude wiring is live, complete, and scoped", () => {
  it("the full Anthropic streaming path is present in the route", () => {
    expect(routeSrc).toMatch(
      /import \{[\s\S]*?createAnthropicClient,[\s\S]*?hasAnthropicCredentials,[\s\S]*?\} from "\.\/_core\/anthropicClient"/
    );
    expect(routeSrc).toContain("const anthropic = createAnthropicClient()");
    expect(routeSrc).toContain("anthropic.messages.stream");
    expect(routeSrc).toContain("model: DIME_CHAT_MODEL");
    expect(routeSrc).toContain(
      "requestProviderMetadata.systemPrompt ?? DIME_CHAT_SYSTEM_PROMPT"
    );
    expect(routeSrc).toContain(
      "applyDimeAnswerRoute(DIME_CHAT_SYSTEM_PROMPT, answerRoute)"
    );
  });

  it("the provider switch is scoped to the Dime Chat interface only", () => {
    expect(wc2026Src).not.toContain("DIME_CHAT_LLM_PROVIDER");
    expect(claudeRouterSrc).not.toContain("DIME_CHAT_LLM_PROVIDER");
  });
});
