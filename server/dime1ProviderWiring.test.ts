import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DIME_CHAT_LLM_PROVIDER, type DimeChatLlmProvider } from "./_core/dimeChatModel";

/**
 * Dime 1.0 provider wiring — contract tests (2026-07-12).
 *
 * v1 architecture: Railway is the control plane; the GPU execution plane is
 * a private RunPod Serverless endpoint serving the 4-bit Dime 1.0 checkpoint
 * via vLLM. These tests pin:
 *   1. "dime1" is a registered provider, but the shipped default remains
 *      "frozen" until the checkpoint is deployed and the eval gates in
 *      ml/dime-1.0/README.md pass;
 *   2. the route branch sits ABOVE the frozen guard and delegates to the
 *      handler module, so the provider-freeze contract tests keep pinning
 *      the frozen branch as the single barrier before the Claude path;
 *   3. the Dime 1.0 path keeps control-plane parity: grounding, SSE contract,
 *      and post-generation validation identical to the Claude path;
 *   4. the execution plane is isolated — no Anthropic SDK/client imports.
 */

const routeSrc = fs.readFileSync(path.join(import.meta.dirname, "dime-chat.route.ts"), "utf8");
const handlerSrc = fs.readFileSync(
  path.join(import.meta.dirname, "_core", "dime1ChatHandler.ts"),
  "utf8",
);
const clientSrc = fs.readFileSync(path.join(import.meta.dirname, "_core", "dime1Client.ts"), "utf8");

describe("provider registry", () => {
  it('accepts "dime1" as a provider value', () => {
    const dime1: DimeChatLlmProvider = "dime1";
    expect(dime1).toBe("dime1");
  });

  it("ships frozen until the Dime 1.0 checkpoint is deployed and eval gates pass", () => {
    expect(DIME_CHAT_LLM_PROVIDER).toBe("frozen");
  });
});

describe("POST /api/dime/chat — dime1 branch wiring", () => {
  const dime1Idx = routeSrc.indexOf('if (DIME_CHAT_LLM_PROVIDER === "dime1")');
  const freezeIdx = routeSrc.indexOf('if (DIME_CHAT_LLM_PROVIDER !== "anthropic")');

  it("exists and sits above the frozen guard", () => {
    expect(dime1Idx).toBeGreaterThan(-1);
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
      /createAnthropicClient|hasAnthropicCredentials|messages\.stream|Anthropic\.|getDimeChatContext\(/,
    );
  });
});

describe("dime1 handler — control-plane parity with the Claude path", () => {
  it("grounds from the platform context builder with the same ack framing", () => {
    expect(handlerSrc).toContain("getDimeChatContext()");
    expect(handlerSrc).toContain("ground Dime answers in this platform context");
  });

  it("applies the same post-generation validation gates and withholds blocked answers", () => {
    expect(handlerSrc).toContain("validateDimeResponseText(");
    expect(handlerSrc).toContain("containsProhibitedBettingCertainty(");
    expect(handlerSrc).toContain('send({ type: "done", stopReason: "validation_blocked" })');
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

describe("dime1 execution plane is isolated from Claude wiring", () => {
  it("client and handler never import the Anthropic SDK or client factory", () => {
    for (const src of [handlerSrc, clientSrc]) {
      expect(src).not.toMatch(/@anthropic-ai\/sdk|anthropicClient|ANTHROPIC_/);
    }
  });
});
