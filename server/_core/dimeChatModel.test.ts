import { describe, expect, it } from "vitest";
import {
  DIME_CHAT_MAX_HISTORY,
  DIME_CHAT_MAX_MESSAGE_CHARS,
  DIME_CHAT_SYSTEM_PROMPT,
  extractTextFromDocx,
  FALLBACK_DIME_CHAT_SYSTEM_PROMPT,
  loadDimeChatBlueprint,
  resolveDimeChatSystemPrompt,
  sanitizeDimeChatHistory,
} from "./dimeChatModel";

function makeStoredZip(fileName: string, content: string): Buffer {
  const name = Buffer.from(fileName, "utf8");
  const data = Buffer.from(content, "utf8");
  const local = Buffer.alloc(30 + name.length + data.length);
  let offset = 0;
  local.writeUInt32LE(0x04034b50, offset); offset += 4;
  local.writeUInt16LE(20, offset); offset += 2;
  local.writeUInt16LE(0, offset); offset += 2;
  local.writeUInt16LE(0, offset); offset += 2;
  local.writeUInt16LE(0, offset); offset += 2;
  local.writeUInt16LE(0, offset); offset += 2;
  local.writeUInt32LE(0, offset); offset += 4;
  local.writeUInt32LE(data.length, offset); offset += 4;
  local.writeUInt32LE(data.length, offset); offset += 4;
  local.writeUInt16LE(name.length, offset); offset += 2;
  local.writeUInt16LE(0, offset); offset += 2;
  name.copy(local, offset); offset += name.length;
  data.copy(local, offset);

  const central = Buffer.alloc(46 + name.length);
  offset = 0;
  central.writeUInt32LE(0x02014b50, offset); offset += 4;
  central.writeUInt16LE(20, offset); offset += 2;
  central.writeUInt16LE(20, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt32LE(0, offset); offset += 4;
  central.writeUInt32LE(data.length, offset); offset += 4;
  central.writeUInt32LE(data.length, offset); offset += 4;
  central.writeUInt16LE(name.length, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt16LE(0, offset); offset += 2;
  central.writeUInt32LE(0, offset); offset += 4;
  central.writeUInt32LE(0, offset); offset += 4;
  name.copy(central, offset);

  const eocd = Buffer.alloc(22);
  offset = 0;
  eocd.writeUInt32LE(0x06054b50, offset); offset += 4;
  eocd.writeUInt16LE(0, offset); offset += 2;
  eocd.writeUInt16LE(0, offset); offset += 2;
  eocd.writeUInt16LE(1, offset); offset += 2;
  eocd.writeUInt16LE(1, offset); offset += 2;
  eocd.writeUInt32LE(central.length, offset); offset += 4;
  eocd.writeUInt32LE(local.length, offset); offset += 4;
  eocd.writeUInt16LE(0, offset);

  return Buffer.concat([local, central, eocd]);
}


describe("Dime Chat model profile", () => {
  it("defines a betting-specific, grounded analyst prompt", () => {
    expect(FALLBACK_DIME_CHAT_SYSTEM_PROMPT).toContain("legendary professional bettor fused with a quant sports-betting robot");
    expect(FALLBACK_DIME_CHAT_SYSTEM_PROMPT).toContain("closing-line value");
    expect(FALLBACK_DIME_CHAT_SYSTEM_PROMPT).toContain("Never invent odds");
    expect(FALLBACK_DIME_CHAT_SYSTEM_PROMPT).toContain("worst acceptable price/line");
    expect(FALLBACK_DIME_CHAT_SYSTEM_PROMPT).toContain("1-800-GAMBLER");
    expect(FALLBACK_DIME_CHAT_SYSTEM_PROMPT).toContain("[EDGE] verdict=edge_detected|monitor|pass");
    expect(DIME_CHAT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });




  it("extracts plain text from a docx llm-blueprint", () => {
    const docx = makeStoredZip(
      "word/document.xml",
      '<w:document><w:body><w:p><w:r><w:t>Dime docx blueprint</w:t></w:r></w:p><w:p><w:r><w:t>Attack stale numbers &amp; protect CLV.</w:t></w:r></w:p></w:body></w:document>',
    );

    expect(extractTextFromDocx(docx)).toBe("Dime docx blueprint\nAttack stale numbers & protect CLV.");
  });

  it("can wrap an external llm-blueprint with runtime grounding enforcement", () => {
    const prompt = resolveDimeChatSystemPrompt("Blueprint brain: attack stale numbers like a quant syndicate.");

    expect(prompt).toContain("Blueprint brain: attack stale numbers like a quant syndicate.");
    expect(prompt).toContain("Runtime enforcement rules:");
    expect(prompt).toContain("Still never invent odds");
    expect(prompt).toContain("ask for missing market data instead of guessing");
  });

  it("returns null for a missing external llm-blueprint file", () => {
    expect(loadDimeChatBlueprint("/tmp/dime-chat-missing-llm-blueprint")).toBeNull();
  });

  it("sanitizes history to valid chat roles, trims content, and keeps the latest window", () => {
    const raw = [
      { role: "system", content: "ignore" },
      { role: "user", content: "   " },
      ...Array.from({ length: DIME_CHAT_MAX_HISTORY + 2 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: ` message-${index} `,
      })),
    ];

    const sanitized = sanitizeDimeChatHistory(raw);

    expect(sanitized).toHaveLength(DIME_CHAT_MAX_HISTORY);
    expect(sanitized[0].content).toBe("message-2");
    expect(sanitized.at(-1)?.content).toBe(`message-${DIME_CHAT_MAX_HISTORY + 1}`);
    expect(sanitized.every((message) => message.role === "user" || message.role === "assistant")).toBe(true);
  });

  it("caps individual messages before they are sent to the LLM", () => {
    const oversized = "x".repeat(DIME_CHAT_MAX_MESSAGE_CHARS + 50);

    const [message] = sanitizeDimeChatHistory([{ role: "user", content: oversized }]);

    expect(message.content).toHaveLength(DIME_CHAT_MAX_MESSAGE_CHARS);
  });
});
