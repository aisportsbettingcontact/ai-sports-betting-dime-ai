/**
 * Dime chat message reducer.
 * Behavior-preserving port of the setState transitions in the previous
 * client/src/pages/DimeChat.tsx (uid-addressed rows, delta append via map,
 * empty-assistant-row removal on hard failure), lifted into a pure reducer so
 * the home→conversation swap is a state change, not a navigation.
 *
 * Error semantics (chat-derivation-spec.md §2.6/§2.8, chrome copy §4):
 *  - error before any delta  → row removed, error card + Retry
 *  - error mid-stream        → partial text stands, "interrupted" footnote
 *  - user stop before delta  → row removed, no error
 *  - user stop mid-stream    → partial text stands, "Stopped." footnote
 */

export type DataFreshness = "live" | "delayed" | "none";

export type MessageStatus = "open" | "done" | "interrupted" | "stopped";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
}

export interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  /** Non-null => the error card (with Retry) is shown at the end of the thread. */
  error: string | null;
  /** DataPill truth source — SSE `meta` frame; honest default is "none". */
  dataFreshness: DataFreshness;
}

export type ChatAction =
  | { type: "append_user"; id: string; text: string }
  | { type: "open_assistant"; id: string }
  | { type: "stream_delta"; id: string; text: string }
  | { type: "meta"; dataFreshness: DataFreshness }
  | { type: "stream_done"; id: string }
  | { type: "stream_error"; id: string; message: string }
  | { type: "stream_abort"; id: string }
  | { type: "reset" };

export const initialChatState: ChatState = {
  messages: [],
  streaming: false,
  error: null,
  dataFreshness: "none",
};

function closeRow(
  state: ChatState,
  id: string,
  status: MessageStatus,
  error: string | null,
): ChatState {
  const row = state.messages.find((m) => m.id === id);
  if (!row) return { ...state, streaming: false };
  if (row.content === "" && (status === "interrupted" || status === "stopped")) {
    // Pre-delta failure/stop: remove the empty assistant row
    // (previous DimeChat.tsx lines 134-137 behavior, extended to abort).
    return {
      ...state,
      messages: state.messages.filter((m) => m.id !== id),
      streaming: false,
      error: status === "interrupted" ? error : null,
    };
  }
  return {
    ...state,
    messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    streaming: false,
    // Mid-stream failure keeps the partial answer; the footnote (not the
    // error card) communicates the interruption.
    error: null,
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "append_user":
      return {
        ...state,
        error: null,
        messages: [
          ...state.messages,
          { id: action.id, role: "user", content: action.text, status: "done" },
        ],
      };

    case "open_assistant":
      return {
        ...state,
        streaming: true,
        error: null,
        messages: [
          ...state.messages,
          { id: action.id, role: "assistant", content: "", status: "open" },
        ],
      };

    case "stream_delta":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, content: m.content + action.text } : m,
        ),
      };

    case "meta":
      return { ...state, dataFreshness: action.dataFreshness };

    case "stream_done":
      return {
        ...state,
        streaming: false,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, status: "done" } : m,
        ),
      };

    case "stream_error":
      return closeRow(state, action.id, "interrupted", action.message);

    case "stream_abort":
      return closeRow(state, action.id, "stopped", null);

    case "reset":
      return initialChatState;

    default:
      return state;
  }
}
