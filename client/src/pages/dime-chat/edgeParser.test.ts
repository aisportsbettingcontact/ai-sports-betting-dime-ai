/**
 * Tests for the deterministic, prefix-stable [EDGE] verdict-block parser.
 * Grammar (product blueprint §11):
 *   [EDGE] verdict=edge_detected|monitor|pass market=<market> model_line=<x>
 *          market_line=<y> edge_pct=<z> confidence=low|medium|high [/EDGE]
 * Rules under test:
 *  - parse ONLY the fenced block, never prose
 *  - mid-stream partial "[EDGE" must never surface as visible text (buffered
 *    until the block closes or the stream ends)
 *  - deterministic: same input + doneness => same segmentation
 */
import { describe, expect, it } from "vitest";
import {
  parseAssistantContent,
  segmentNumerals,
  type Segment,
} from "./edgeParser";

const BLOCK =
  "[EDGE] verdict=edge_detected market=ATH -1.5 model_line=-1.2 market_line=-1.5 edge_pct=4.1 confidence=medium [/EDGE]";

/** Concatenate everything a renderer would show as plain copy. */
function visibleText(segments: Segment[]): string {
  return segments
    .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("");
}

describe("parseAssistantContent", () => {
  it("returns a single text segment for prose without markers", () => {
    const out = parseAssistantContent("No edge on the ATH runline tonight.", true);
    expect(out).toEqual([
      { kind: "text", text: "No edge on the ATH runline tonight." },
    ]);
  });

  it("parses a complete valid block into an edge segment", () => {
    const out = parseAssistantContent(BLOCK, true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "edge",
      block: {
        verdict: "edge_detected",
        market: "ATH -1.5",
        modelLine: "-1.2",
        marketLine: "-1.5",
        edgePct: "4.1",
        confidence: "medium",
      },
    });
  });

  it("keeps prose before and after the block as text segments", () => {
    const out = parseAssistantContent(`Lead-in. ${BLOCK} Tail.`, true);
    expect(out.map((s) => s.kind)).toEqual(["text", "edge", "text"]);
    expect(visibleText(out)).toBe("Lead-in.  Tail.");
  });

  it("parses market values containing spaces", () => {
    const out = parseAssistantContent(
      "[EDGE] verdict=monitor market=Ohtani strikeouts o8.5 model_line=8.9 market_line=8.5 edge_pct=2.0 confidence=low [/EDGE]",
      true,
    );
    expect(out[0].kind).toBe("edge");
    if (out[0].kind === "edge") {
      expect(out[0].block.market).toBe("Ohtani strikeouts o8.5");
      expect(out[0].block.verdict).toBe("monitor");
      expect(out[0].block.confidence).toBe("low");
    }
  });

  it("falls back to raw text for a closed but malformed block (never a broken card)", () => {
    const raw =
      "[EDGE] verdict=slam_dunk market=X model_line=1 market_line=2 edge_pct=3 confidence=high [/EDGE]";
    const out = parseAssistantContent(raw, true);
    expect(out).toEqual([{ kind: "text", text: raw }]);
  });

  it("buffers an unclosed block while streaming (hidden pending segment)", () => {
    const out = parseAssistantContent(
      "Here is the read. [EDGE] verdict=pass market=COL ML model_line=",
      false,
    );
    expect(out.map((s) => s.kind)).toEqual(["text", "pending"]);
    expect(visibleText(out)).toBe("Here is the read. ");
    expect(visibleText(out)).not.toContain("[EDGE");
  });

  it("renders an unclosed block as plain text once the stream is done", () => {
    const raw = "Here is the read. [EDGE] verdict=pass market=COL ML";
    const out = parseAssistantContent(raw, true);
    expect(visibleText(out)).toBe(raw);
  });

  it("buffers a partial opening marker at the tail while streaming", () => {
    for (const partial of ["[", "[E", "[ED", "[EDG", "[EDGE"]) {
      const out = parseAssistantContent(`Verdict incoming ${partial}`, false);
      expect(visibleText(out)).toBe("Verdict incoming ");
    }
  });

  it("shows a partial opening marker as text once the stream is done", () => {
    const out = parseAssistantContent("Bracket [EDG", true);
    expect(visibleText(out)).toBe("Bracket [EDG");
  });

  it("parses multiple blocks in one message", () => {
    const second = BLOCK.replace("edge_detected", "pass");
    const out = parseAssistantContent(`${BLOCK}\n${second}`, true);
    expect(out.map((s) => s.kind)).toEqual(["edge", "text", "edge"]);
  });

  it("is prefix-stable: no streamed prefix ever surfaces a partial marker", () => {
    const full = `Model likes it. ${BLOCK} Manage your bankroll.`;
    for (let i = 0; i <= full.length; i++) {
      const vis = visibleText(parseAssistantContent(full.slice(0, i), false));
      expect(vis).not.toContain("[EDGE");
      expect(vis).not.toContain("[/EDGE");
    }
  });

  it("is deterministic: identical input yields identical segmentation", () => {
    const input = `Lead ${BLOCK} tail [ED`;
    expect(parseAssistantContent(input, false)).toEqual(
      parseAssistantContent(input, false),
    );
    expect(parseAssistantContent(input, true)).toEqual(
      parseAssistantContent(input, true),
    );
  });
});

describe("segmentNumerals", () => {
  const nums = (text: string) =>
    segmentNumerals(text)
      .filter((p) => p.kind === "num")
      .map((p) => p.text);

  it("wraps percentages, signed odds/lines, prices and records", () => {
    expect(nums("anytime probability at 54.2% vs +115 (implied 46.5%)")).toEqual([
      "54.2%",
      "+115",
      "46.5%",
    ]);
    expect(nums("laying -1.5 at -110 for $50")).toEqual(["-1.5", "-110", "$50"]);
    expect(nums("the model is 12-4 on these")).toEqual(["12-4"]);
  });

  it("leaves bare integers and dates alone", () => {
    expect(nums("Best Trends for MLB July 7, 2026")).toEqual([]);
    expect(nums("Ran 10000 sims across 30 teams")).toEqual([]);
  });

  it("reassembles to the original text", () => {
    const text = "0.68 xG puts him at 54.2% against +115, a 7.7% edge.";
    expect(segmentNumerals(text).map((p) => p.text).join("")).toBe(text);
  });
});
