import { describe, expect, it } from "vitest";
import { PI_AGENT_APPROVED_MODELS, resolvePiAgentModel, runPiChat } from "./piAgent";

describe("piAgent model policy (LLM.md)", () => {
  it("resolves every approved current-generation model", () => {
    for (const ref of PI_AGENT_APPROVED_MODELS) {
      const model = resolvePiAgentModel(ref);
      expect(`${model.provider}/${model.id}`).toBe(ref);
    }
  });

  it("defaults to claude-fable-5", () => {
    expect(resolvePiAgentModel().id).toBe("claude-fable-5");
  });

  it("rejects older models unless DIME_ALLOW_LEGACY_MODELS=1", () => {
    const prior = process.env.DIME_ALLOW_LEGACY_MODELS;
    delete process.env.DIME_ALLOW_LEGACY_MODELS;
    try {
      expect(() => resolvePiAgentModel("claude-haiku-4-5")).toThrow(/current-generation policy/);
      process.env.DIME_ALLOW_LEGACY_MODELS = "1";
      expect(resolvePiAgentModel("claude-haiku-4-5").id).toBe("claude-haiku-4-5");
    } finally {
      if (prior === undefined) delete process.env.DIME_ALLOW_LEGACY_MODELS;
      else process.env.DIME_ALLOW_LEGACY_MODELS = prior;
    }
  });
});

describe("runPiChat contract", () => {
  it("rejects a history that does not end with a user message", async () => {
    await expect(
      runPiChat({
        systemPrompt: "test",
        history: [{ role: "assistant", content: "hello" }],
      }),
    ).rejects.toThrow(/must end with a user message/);
  });

  it("rejects an empty history", async () => {
    await expect(runPiChat({ systemPrompt: "test", history: [] })).rejects.toThrow(
      /must end with a user message/,
    );
  });
});
