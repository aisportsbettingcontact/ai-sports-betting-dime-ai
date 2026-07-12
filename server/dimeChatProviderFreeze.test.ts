import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DIME_CHAT_FROZEN_NOTICE,
  DIME_CHAT_LLM_PROVIDER,
} from "./_core/dimeChatModel";

/**
 * Dime Chat provider freeze — contract tests (2026-07-12).
 *
 * Requirement: the Dime Chat interface (POST /api/dime/chat) must not use the
 * Anthropic API when responding, WITHOUT removing any routing or wiring to
 * the Claude models. These tests pin both halves:
 *   1. the route short-circuits before any Anthropic client/stream call while
 *      DIME_CHAT_LLM_PROVIDER is "frozen", and
 *   2. the full Claude streaming path remains present in the source so
 *      flipping the provider back to "anthropic" restores it unchanged.
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

describe("provider switch — frozen state", () => {
  it("the Dime Chat provider is frozen (no LLM in use)", () => {
    expect(DIME_CHAT_LLM_PROVIDER).toBe("frozen");
  });

  it("exposes a non-empty hardcoded notice for frozen responses", () => {
    expect(DIME_CHAT_FROZEN_NOTICE.length).toBeGreaterThan(0);
    expect(DIME_CHAT_FROZEN_NOTICE).toContain("temporarily offline");
  });
});

describe("POST /api/dime/chat — freeze short-circuits before Anthropic", () => {
  const freezeIdx = routeSrc.indexOf('if (DIME_CHAT_LLM_PROVIDER !== "anthropic")');
  const contextIdx = routeSrc.indexOf("getDimeChatContext()");
  const clientIdx = routeSrc.indexOf("const anthropic = createAnthropicClient()");
  const streamIdx = routeSrc.indexOf("anthropic.messages.stream");

  it("the frozen branch exists and precedes context building and every Anthropic call", () => {
    expect(freezeIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(freezeIdx);
    expect(clientIdx).toBeGreaterThan(freezeIdx);
    expect(streamIdx).toBeGreaterThan(freezeIdx);
  });

  it("the frozen branch streams the hardcoded notice and terminates the response", () => {
    const branch = routeSrc.slice(freezeIdx, contextIdx);
    expect(branch).toContain('sendFrozen({ type: "meta", dataFreshness: "none" })');
    expect(branch).toContain(
      'sendFrozen({ type: "delta", text: DIME_CHAT_FROZEN_NOTICE })'
    );
    expect(branch).toContain('sendFrozen({ type: "done", stopReason: "end_turn" })');
    expect(branch).toMatch(/res\.end\(\);\s*return;/);
    // No Anthropic call sites inside the frozen branch itself (the guard's
    // "anthropic" string literal is the provider name, not a call).
    expect(branch).not.toMatch(
      /createAnthropicClient|hasAnthropicCredentials|messages\.stream|Anthropic\./
    );
  });

  it("does not demand Anthropic credentials while frozen", () => {
    expect(routeSrc).toContain(
      'DIME_CHAT_LLM_PROVIDER === "anthropic" && !hasAnthropicCredentials()'
    );
  });
});

describe("Claude wiring is preserved, not removed", () => {
  it("the full Anthropic streaming path is still present in the route", () => {
    expect(routeSrc).toMatch(
      /import \{ createAnthropicClient, hasAnthropicCredentials \} from "\.\/_core\/anthropicClient"/
    );
    expect(routeSrc).toContain("const anthropic = createAnthropicClient()");
    expect(routeSrc).toContain("anthropic.messages.stream");
    expect(routeSrc).toContain("model: DIME_CHAT_MODEL");
    expect(routeSrc).toContain("system: DIME_CHAT_SYSTEM_PROMPT");
  });

  it("the freeze is scoped to the Dime Chat interface only", () => {
    expect(wc2026Src).not.toContain("DIME_CHAT_LLM_PROVIDER");
    expect(claudeRouterSrc).not.toContain("DIME_CHAT_LLM_PROVIDER");
  });
});
