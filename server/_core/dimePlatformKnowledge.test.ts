import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDimePlatformKnowledge,
  DIME_PLATFORM_KNOWLEDGE,
  DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK,
  DIME_PLATFORM_KNOWLEDGE_SHA256,
  DIME_PLATFORM_KNOWLEDGE_VERSION,
  renderDimePlatformKnowledge,
} from "./dimePlatformKnowledge";
import {
  DIME1_PROMPT_SOURCE,
  DIME1_SYSTEM_PROMPT,
  DIME_RESEARCH_ALPHA_PROMPT_SOURCE,
  DIME_RESEARCH_ALPHA_SYSTEM_PROMPT,
} from "./dime1Model";
import { DIME_CHAT_SYSTEM_PROMPT } from "./dimeChatModel";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

describe("Dime Platform Knowledge v1", () => {
  it("has one deterministic identity shared with the canonical JSON contract", () => {
    const expected = createHash("sha256")
      .update(`${JSON.stringify(canonicalize(DIME_PLATFORM_KNOWLEDGE))}\n`)
      .digest("hex");

    expect(DIME_PLATFORM_KNOWLEDGE_VERSION).toBe("1.0.0");
    expect(DIME_PLATFORM_KNOWLEDGE_SHA256).toBe(expected);
    expect(DIME_PLATFORM_KNOWLEDGE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(renderDimePlatformKnowledge()).toBe(
      DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK
    );
  });

  it("states supported product facts and important unavailable boundaries", () => {
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain("Dime AI Chat");
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain(
      "Betting Splits and Odds History"
    );
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain(
      "Betting Splits and Odds History [id=betting_splits_odds_history; availability=live; access=authenticated"
    );
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain(
      "Trends [id=trends; availability=live; access=authenticated"
    );
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain("Bet Tracker");
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain(
      "Dime Chat does not currently receive the user's Bet Tracker history"
    );
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain(
      "Prop Projections [id=prop_projections; availability=not_available"
    );
    expect(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK).toContain(
      "Do not infer a user's plan, role, subscription, account state"
    );
  });

  it("injects byte-identical knowledge into Research Alpha and future Dime1", () => {
    expect(DIME1_SYSTEM_PROMPT).toContain(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK);
    expect(DIME_RESEARCH_ALPHA_SYSTEM_PROMPT).toContain(
      DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK
    );
    expect(
      DIME1_SYSTEM_PROMPT.endsWith(DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK)
    ).toBe(true);
    expect(
      DIME_RESEARCH_ALPHA_SYSTEM_PROMPT.endsWith(
        DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK
      )
    ).toBe(true);
    expect(DIME1_PROMPT_SOURCE).toContain("platform-v1.0.0");
    expect(DIME_RESEARCH_ALPHA_PROMPT_SOURCE).toContain("platform-v1.0.0");
    expect(DIME_CHAT_SYSTEM_PROMPT).toContain(
      DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK
    );
  });

  it("appends the catalog once without replacing the behavior prompt", () => {
    const prompt = appendDimePlatformKnowledge("Behavior contract.");
    expect(prompt.startsWith("Behavior contract.")).toBe(true);
    expect(prompt.match(/DIME_PLATFORM_KNOWLEDGE version=/g)).toHaveLength(1);
  });

  it("ships the canonical runtime catalog in the Railway Docker context and CI scope", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const dockerIgnore = fs.readFileSync(
      path.join(repositoryRoot, ".dockerignore"),
      "utf8"
    );
    const workflow = fs.readFileSync(
      path.join(repositoryRoot, ".github/workflows/dime-llm-validation.yml"),
      "utf8"
    );

    expect(
      fs.existsSync(
        path.join(repositoryRoot, "shared/dime/platform_knowledge_v1.json")
      )
    ).toBe(true);
    expect(dockerIgnore).not.toMatch(/^shared\/dime(?:\/|$)/m);
    expect(workflow).toContain('"shared/dime/**"');
  });
});
