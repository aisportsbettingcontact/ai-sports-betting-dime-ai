import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DIME_CHAT_LLM_PROVIDER,
  type DimeChatLlmProvider,
} from "./_core/dimeChatModel";
import {
  DIME1_BASE_MODEL,
  DIME1_BASE_MODEL_REVISION,
} from "./_core/dime1Model";

/**
 * Dime 1.0 provider wiring — frozen integration contract.
 *
 * The Dime 1.0 client, handler, and route branch remain reserved future
 * scaffolding. No production checkpoint, merged or quantized artifact,
 * endpoint, or provider activation is approved. These tests pin:
 *   1. "dime1" is a registered provider, but the shipped default remains
 *      "frozen";
 *   2. the governed foundation identity and revision are exact, and the
 *      canonical runbook and release gates exist;
 *   3. the route branch sits ABOVE the frozen guard and delegates to the
 *      handler module, so the provider-freeze contract tests keep pinning
 *      the frozen branch as the single barrier before the Claude path;
 *   4. the Dime 1.0 path keeps control-plane parity: grounding, SSE contract,
 *      and post-generation validation identical to the Claude path;
 *   5. the reserved execution path is isolated — no Anthropic SDK/client
 *      imports.
 */

const routeSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const handlerSrc = fs.readFileSync(
  path.join(import.meta.dirname, "_core", "dime1ChatHandler.ts"),
  "utf8"
);
const clientSrc = fs.readFileSync(
  path.join(import.meta.dirname, "_core", "dime1Client.ts"),
  "utf8"
);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("provider registry", () => {
  it('accepts "dime1" as a provider value', () => {
    const dime1: DimeChatLlmProvider = "dime1";
    expect(dime1).toBe("dime1");
  });

  it("ships frozen while the Dime 1.0 foundation remains non-release work", () => {
    expect(DIME_CHAT_LLM_PROVIDER).toBe("frozen");
  });

  it("pins the exact Llama 3.1 Base foundation identity", () => {
    expect(DIME1_BASE_MODEL).toBe("meta-llama/Llama-3.1-8B");
    expect(DIME1_BASE_MODEL_REVISION).toBe(
      "d04e592bb4f6aa9cfee91e2e20afa771667e1d4b"
    );
  });

  it("tracks the canonical runbook and release gates", () => {
    expect(
      fs.existsSync(path.join(repositoryRoot, "ml", "dime-1.0", "README.md"))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(repositoryRoot, "ml", "dime-1.0", "docs", "RELEASE_GATES.md")
      )
    ).toBe(true);
  });
});

describe("POST /api/dime/chat — dime1 branch wiring", () => {
  const routeStart = routeSrc.indexOf('dimeChatRouter.post("/chat"');
  const alphaIdx = routeSrc.indexOf(
    "if (researchAlphaGate.active)",
    routeStart
  );
  const dime1Idx = routeSrc.indexOf(
    'if (DIME_CHAT_LLM_PROVIDER === "dime1")',
    alphaIdx
  );
  const freezeIdx = routeSrc.indexOf(
    'if (DIME_CHAT_LLM_PROVIDER !== "anthropic")',
    dime1Idx
  );

  it("exists and sits above the frozen guard", () => {
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(dime1Idx).toBeGreaterThan(-1);
    expect(dime1Idx).toBeGreaterThan(alphaIdx);
    expect(freezeIdx).toBeGreaterThan(dime1Idx);
  });

  it("delegates to the handler and returns, with no inline Anthropic or context calls", () => {
    // End the slice at the PROVIDER FREEZE comment — the comment's prose
    // names Anthropic call sites and would false-positive the regex below.
    const branchEnd = routeSrc.indexOf("// --- PROVIDER FREEZE");
    expect(branchEnd).toBeGreaterThan(dime1Idx);
    const branch = routeSrc.slice(dime1Idx, branchEnd);
    expect(branch).toContain("await handleDime1ChatRequest(");
    expect(branch).toMatch(/return;/);
    expect(branch).not.toMatch(
      /createAnthropicClient|hasAnthropicCredentials|messages\.stream|Anthropic\.|getDimeChatContext\(/
    );
  });

  it("labels the isolated control lane as research-alpha and never calls Anthropic", () => {
    const branch = routeSrc.slice(alphaIdx, dime1Idx);
    expect(branch).toContain("await handleDime1ChatRequest({");
    expect(branch).toContain('deploymentTier: "research-alpha"');
    expect(branch).toMatch(/return;/);
    expect(branch).not.toMatch(
      /createAnthropicClient|hasAnthropicCredentials|messages\.stream|Anthropic\./
    );
    expect(handlerSrc).toContain('deploymentTier = "production"');
    expect(handlerSrc).toContain('"dime1-research-alpha"');
    expect(branch).toContain("requestProviderMetadata.systemPrompt");
    expect(branch).toContain("DIME_RESEARCH_ALPHA_SYSTEM_PROMPT");
    expect(handlerSrc).toContain("system: systemPrompt");
  });
});

describe("dime1 handler — control-plane parity with the Claude path", () => {
  it("grounds from the platform context builder with the same ack framing", () => {
    expect(handlerSrc).toContain("getDimeChatContext(");
    expect(handlerSrc).toContain("messages.at(-1)?.content");
    expect(handlerSrc).toContain(
      "ground Dime answers in this platform context"
    );
  });

  it("applies the same post-generation validation gates and withholds blocked answers", () => {
    expect(handlerSrc).toContain("validateDimeResponseText(");
    expect(handlerSrc).toContain("containsProhibitedBettingCertainty(");
    expect(handlerSrc).toContain("validateDimeResponseCompleteness(");
    expect(handlerSrc).toContain("stopReason: blockedFinishReason");
    expect(handlerSrc).toContain('"validation_blocked"');
    expect(handlerSrc).toContain('"runtime_answer_fallback"');
    expect(handlerSrc).toContain('type: "done"');
  });

  it("streams the meta → delta → done SSE contract the client already parses", () => {
    expect(handlerSrc).toContain('"text/event-stream"');
    expect(handlerSrc).toContain('type: "meta"');
    expect(handlerSrc).toContain('type: "delta"');
    expect(handlerSrc).toContain('type: "done"');
  });

  it("fails as clean HTTP 500 when unconfigured, before any SSE flush", () => {
    const configIdx = handlerSrc.indexOf("resolveDime1Config()");
    const sseIdx = handlerSrc.indexOf('"text/event-stream"');
    expect(configIdx).toBeGreaterThan(-1);
    expect(configIdx).toBeLessThan(sseIdx);
    expect(handlerSrc).toMatch(/res\.status\(500\)\.json/);
  });
});

describe("reserved dime1 execution path is isolated from Claude wiring", () => {
  it("client and handler never import the Anthropic SDK or client factory", () => {
    for (const src of [handlerSrc, clientSrc]) {
      expect(src).not.toMatch(/@anthropic-ai\/sdk|anthropicClient|ANTHROPIC_/);
    }
  });
});
