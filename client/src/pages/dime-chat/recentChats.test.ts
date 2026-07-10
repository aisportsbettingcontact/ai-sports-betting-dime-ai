/**
 * Tests for the session-only recent-chats derivation (Ph1 — honesty):
 * titles come ONLY from the first user message of conversations started this
 * session; no backend, no persistence, no invented data.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  addSessionRecent,
  clearSessionRecents,
  deriveChatTitle,
  getSessionRecents,
} from "./recentChats";

describe("deriveChatTitle", () => {
  it("returns short prompts unchanged", () => {
    expect(deriveChatTitle("Any NRFI angles today?")).toBe("Any NRFI angles today?");
  });

  it("collapses internal whitespace and trims the ends", () => {
    expect(deriveChatTitle("  Will Messi   score\n\ntonight?  ")).toBe(
      "Will Messi score tonight?",
    );
  });

  it("keeps exactly-40-char prompts untruncated", () => {
    const forty = "a".repeat(40);
    expect(deriveChatTitle(forty)).toBe(forty);
    expect(deriveChatTitle(forty)).toHaveLength(40);
  });

  it("truncates longer prompts to 40 chars ending in an ellipsis", () => {
    const long =
      "Explain the top ROI play on tonight's card and how the model graded it";
    const title = deriveChatTitle(long);
    expect(title).toHaveLength(40);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });

  it("never leaves whitespace hanging before the ellipsis", () => {
    const title = deriveChatTitle(`${"x".repeat(38)} yyyyy`);
    expect(title).not.toContain(" …");
  });

  it("is deterministic", () => {
    const input = "Ohtani strikeout total projection for the July slate";
    expect(deriveChatTitle(input)).toBe(deriveChatTitle(input));
  });
});

describe("session recents store", () => {
  beforeEach(() => clearSessionRecents());

  it("starts empty (nothing rendered until a conversation starts)", () => {
    expect(getSessionRecents()).toEqual([]);
  });

  it("adds newest-first with unique ids, titles derived from the prompt", () => {
    addSessionRecent("first question about the slate");
    addSessionRecent("second question about player props");
    const recents = getSessionRecents();
    expect(recents.map((r) => r.title)).toEqual([
      "second question about player props",
      "first question about the slate",
    ]);
    expect(recents[0].id).not.toBe(recents[1].id);
  });

  it("allows duplicate titles as distinct entries (two chats, same opener)", () => {
    addSessionRecent("same opener");
    addSessionRecent("same opener");
    expect(getSessionRecents()).toHaveLength(2);
  });

  it("returns a copy — callers cannot mutate the store", () => {
    addSessionRecent("immutable?");
    const snapshot = getSessionRecents();
    snapshot.pop();
    expect(getSessionRecents()).toHaveLength(1);
  });
});
