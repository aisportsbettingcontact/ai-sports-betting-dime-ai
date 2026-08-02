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
 * History: frozen 2026-07-12 ("no Anthropic API use, keep all Claude wiring"),
 * unfrozen 2026-08-01 by explicit owner direction onto the embedded
 * pi-agent-core runtime (provider "pi"). These tests pin the CURRENT
 * contract with the same rigor the freeze tests pinned the old one:
 *   1. the active provider is exactly "pi" — any silent change fails CI;
 *   2. the frozen short-circuit machinery is preserved (switching back to
 *      "frozen" restores the no-provider-call notice unchanged);
 *   3. the pi serving path exists and shares the anthropic path's
 *      credential guard, budget, and system prompt;
 *   4. the full direct-SDK Claude streaming path remains present so
 *      flipping to "anthropic" restores it unchanged.
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

describe("provider switch — pi state (owner-authorized unfreeze, 2026-08-01)", () => {
  it('the Dime Chat provider is exactly "pi"', () => {
    expect(DIME_CHAT_LLM_PROVIDER).toBe("pi");
  });

  it("retains the hardcoded frozen notice for any future re-freeze", () => {
    expect(DIME_CHAT_FROZEN_NOTICE.length).toBeGreaterThan(0);
    expect(DIME_CHAT_FROZEN_NOTICE).toContain("temporarily offline");
  });
});

describe("POST /api/dime/chat — frozen short-circuit preserved ahead of live paths", () => {
  const freezeIdx = routeSrc.indexOf(
    'if (DIME_CHAT_LLM_PROVIDER !== "anthropic" && DIME_CHAT_LLM_PROVIDER !== "pi")'
  );
  const contextIdx = routeSrc.indexOf("getDimeChatContext(", freezeIdx);
  const clientIdx = routeSrc.indexOf(
    "const anthropic = createAnthropicClient()"
  );
  const streamIdx = routeSrc.indexOf("anthropic.messages.stream");
  const piCallIdx = routeSrc.indexOf("await runPiChat({");

  it("the frozen branch exists and precedes context building and every provider call", () => {
    expect(freezeIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(freezeIdx);
    expect(clientIdx).toBeGreaterThan(freezeIdx);
    expect(streamIdx).toBeGreaterThan(freezeIdx);
    expect(piCallIdx).toBeGreaterThan(freezeIdx);
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
    // No provider call sites inside the frozen branch itself.
    expect(branch).not.toMatch(
      /createAnthropicClient|hasAnthropicCredentials|messages\.stream|Anthropic\.|runPiChat/
    );
  });

  it("demands Anthropic credentials for both live providers, not while frozen", () => {
    expect(routeSrc).toContain(
      '(DIME_CHAT_LLM_PROVIDER === "anthropic" || DIME_CHAT_LLM_PROVIDER === "pi") && !hasAnthropicCredentials()'
    );
  });
});

describe("pi serving path — embedded runtime wired with parity", () => {
  it("imports and calls runPiChat from the embedded pi runtime", () => {
    expect(routeSrc).toContain(
      'import { runPiChat } from "./_core/piAgent"'
    );
    expect(routeSrc).toContain("await runPiChat({");
  });

  it("the pi path shares the anthropic path's prompt, budget, and abort wiring", () => {
    const piBlock = routeSrc.slice(
      routeSrc.indexOf("await runPiChat({"),
      routeSrc.indexOf("} else {", routeSrc.indexOf("await runPiChat({"))
    );
    expect(piBlock).toContain(
      "requestProviderMetadata.systemPrompt ?? DIME_CHAT_SYSTEM_PROMPT"
    );
    expect(piBlock).toContain("history: providerMessages");
    expect(piBlock).toContain("model: DIME_CHAT_MODEL");
    expect(piBlock).toContain("maxTokens: responseBudget");
    expect(piBlock).toContain("signal: abort.signal");
  });
});

describe("Claude wiring is preserved, not removed", () => {
  it("the full Anthropic streaming path is still present in the route", () => {
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
