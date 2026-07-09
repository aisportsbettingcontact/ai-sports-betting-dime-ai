import { describe, it, expect, vi, beforeEach } from "vitest";
import { IS_CI } from "./_core/ciTestGuard";

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Mock Claude Fable 5 response" }],
  usage: { input_tokens: 150, output_tokens: 75 },
  model: "claude-fable-5",
});
async function* mockStream() {
  yield { type: "content_block_delta", delta: { type: "text_delta", text: "Mock " } };
  yield { type: "content_block_delta", delta: { type: "text_delta", text: "streaming " } };
  yield { type: "content_block_delta", delta: { type: "text_delta", text: "response" } };
}
vi.mock("@anthropic-ai/sdk", () => ({ default: vi.fn().mockImplementation(() => ({ messages: { create: mockCreate, stream: vi.fn().mockImplementation(mockStream) } })) }));

describe("Claude Fable 5 Integration", () => {
  // Presence-probe only — the rest of this suite is fully mocked and keeps running in CI.
  it.skipIf(IS_CI)("ANTHROPIC_API_KEY is set", () => { expect(process.env.ANTHROPIC_API_KEY?.length).toBeGreaterThan(0); });
  it("CLAUDE_MODEL is claude-fable-5", async () => { const { CLAUDE_MODEL } = await import("./_core/claude"); expect(CLAUDE_MODEL).toBe("claude-fable-5"); });
  describe("invokeClaude", () => {
    beforeEach(() => mockCreate.mockClear());
    it("returns valid ClaudeResponse", async () => {
      const { invokeClaude } = await import("./_core/claude");
      const r = await invokeClaude({ messages: [{ role: "user", content: "Test" }] });
      expect(r.content).toBe("Mock Claude Fable 5 response");
      expect(r.inputTokens).toBe(150); expect(r.outputTokens).toBe(75);
    });
    it("calls API with correct model", async () => {
      const { invokeClaude, CLAUDE_MODEL } = await import("./_core/claude");
      await invokeClaude({ messages: [{ role: "user", content: "Test" }] });
      expect(mockCreate.mock.calls[0]![0].model).toBe(CLAUDE_MODEL);
    });
    it("accepts custom system prompt", async () => {
      const { invokeClaude } = await import("./_core/claude");
      await invokeClaude({ messages: [{ role: "user", content: "Test" }], systemPrompt: "Custom" });
      expect(mockCreate.mock.calls[0]![0].system).toBe("Custom");
    });
    it("passes multi-turn history", async () => {
      const { invokeClaude } = await import("./_core/claude");
      await invokeClaude({ messages: [{ role: "user", content: "A" }, { role: "assistant", content: "B" }, { role: "user", content: "C" }] });
      expect(mockCreate.mock.calls[0]![0].messages).toHaveLength(3);
    });
  });
  describe("askClaude", () => {
    beforeEach(() => mockCreate.mockClear());
    it("returns string", async () => { const { askClaude } = await import("./_core/claude"); expect(await askClaude("Test")).toBe("Mock Claude Fable 5 response"); });
  });
  describe("streamClaude", () => {
    it("yields chunks", async () => {
      const { streamClaude } = await import("./_core/claude");
      const chunks: string[] = [];
      for await (const c of streamClaude({ messages: [{ role: "user", content: "Test" }] })) chunks.push(c);
      expect(chunks.join("")).toBe("Mock streaming response");
    });
  });
  describe("UIUX_SYSTEM_PROMPT", () => {
    it("contains platform context", async () => {
      const { UIUX_SYSTEM_PROMPT } = await import("./_core/claude");
      expect(UIUX_SYSTEM_PROMPT).toContain("AI Sports Betting");
      expect(UIUX_SYSTEM_PROMPT).toContain("Prez Bets");
      expect(UIUX_SYSTEM_PROMPT).toContain("#00ff41");
      expect(UIUX_SYSTEM_PROMPT).toContain("Barlow Condensed");
      expect(UIUX_SYSTEM_PROMPT).toContain("TypeScript");
    });
  });
});
