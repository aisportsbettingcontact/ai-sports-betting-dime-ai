/**
 * Tests for the Dime chat message reducer — a behavior-preserving port of the
 * setState transitions in the previous DimeChat.tsx (append user msg, open
 * assistant msg, apply streamed deltas, close, error/abort semantics including
 * empty-assistant-row removal on hard failure).
 */
import { describe, expect, it } from "vitest";
import {
  chatReducer,
  initialChatState,
  type ChatState,
} from "./chatReducer";

function opened(text = "What's the edge tonight?"): ChatState {
  let s = chatReducer(initialChatState, {
    type: "append_user",
    id: "u1",
    text,
  });
  s = chatReducer(s, { type: "open_assistant", id: "a1" });
  return s;
}

describe("chatReducer", () => {
  it("starts empty, not streaming, no error, honest NO-LIVE-DATA default", () => {
    expect(initialChatState.messages).toEqual([]);
    expect(initialChatState.streaming).toBe(false);
    expect(initialChatState.error).toBeNull();
    expect(initialChatState.dataFreshness).toBe("none");
  });

  it("append_user appends the trimmed message and clears any prior error", () => {
    const errored: ChatState = { ...initialChatState, error: "boom" };
    const s = chatReducer(errored, {
      type: "append_user",
      id: "u1",
      text: "Will Messi score tonight?",
    });
    expect(s.messages).toEqual([
      {
        id: "u1",
        role: "user",
        content: "Will Messi score tonight?",
        status: "done",
      },
    ]);
    expect(s.error).toBeNull();
  });

  it("open_assistant appends an empty open assistant row and sets streaming", () => {
    const s = opened();
    expect(s.messages[1]).toEqual({
      id: "a1",
      role: "assistant",
      content: "",
      status: "open",
    });
    expect(s.streaming).toBe(true);
  });

  it("stream_delta appends text to the targeted assistant row only", () => {
    let s = opened();
    s = chatReducer(s, { type: "stream_delta", id: "a1", text: "54.2% " });
    s = chatReducer(s, { type: "stream_delta", id: "a1", text: "at +115" });
    expect(s.messages[1].content).toBe("54.2% at +115");
    expect(s.messages[0].content).toBe("What's the edge tonight?");
  });

  it("meta sets the data-freshness flag from the server frame", () => {
    const s = chatReducer(opened(), { type: "meta", dataFreshness: "none" });
    expect(s.dataFreshness).toBe("none");
    const live = chatReducer(opened(), { type: "meta", dataFreshness: "live" });
    expect(live.dataFreshness).toBe("live");
  });

  it("stream_done closes the row and stops streaming", () => {
    let s = opened();
    s = chatReducer(s, { type: "stream_delta", id: "a1", text: "No edge." });
    s = chatReducer(s, { type: "stream_done", id: "a1" });
    expect(s.messages[1].status).toBe("done");
    expect(s.streaming).toBe(false);
    expect(s.error).toBeNull();
  });

  it("stream_error on an empty row removes it and raises the error card", () => {
    const s = chatReducer(opened(), {
      type: "stream_error",
      id: "a1",
      message: "Dime couldn't reach the model. Your message is saved above.",
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("user");
    expect(s.error).toBe(
      "Dime couldn't reach the model. Your message is saved above.",
    );
    expect(s.streaming).toBe(false);
  });

  it("stream_error mid-stream keeps the partial text and marks it interrupted", () => {
    let s = opened();
    s = chatReducer(s, { type: "stream_delta", id: "a1", text: "Partial read" });
    s = chatReducer(s, { type: "stream_error", id: "a1", message: "Model error (529)." });
    expect(s.messages[1].content).toBe("Partial read");
    expect(s.messages[1].status).toBe("interrupted");
    expect(s.error).toBeNull(); // footnote notice, not the error card
    expect(s.streaming).toBe(false);
  });

  it("stream_abort on an empty row removes it without an error", () => {
    const s = chatReducer(opened(), { type: "stream_abort", id: "a1" });
    expect(s.messages).toHaveLength(1);
    expect(s.error).toBeNull();
    expect(s.streaming).toBe(false);
  });

  it("stream_abort mid-stream keeps the partial text and marks it stopped", () => {
    let s = opened();
    s = chatReducer(s, { type: "stream_delta", id: "a1", text: "Ran 10,000 sims" });
    s = chatReducer(s, { type: "stream_abort", id: "a1" });
    expect(s.messages[1].status).toBe("stopped");
    expect(s.messages[1].content).toBe("Ran 10,000 sims");
    expect(s.error).toBeNull();
  });

  it("reset returns to the initial (home) state from any state", () => {
    let s = opened();
    s = chatReducer(s, { type: "stream_delta", id: "a1", text: "x" });
    expect(chatReducer(s, { type: "reset" })).toEqual(initialChatState);
  });

  it("ignores deltas addressed to unknown rows (stale frames after reset)", () => {
    const s = chatReducer(initialChatState, {
      type: "stream_delta",
      id: "ghost",
      text: "zzz",
    });
    expect(s.messages).toEqual([]);
  });
});
