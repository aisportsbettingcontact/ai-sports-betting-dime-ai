/**
 * Dime AI — Chat page
 * ---------------------------------------------------------------
 * Mobile-first chat interface for the Chat tab.
 * Streams from POST /api/dime/chat (SSE).
 *
 * Renders inside the existing app shell (top header + bottom nav).
 * Styles in dime-chat.css.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import "./dime-chat.css";

type Msg = { id: string; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  { icon: "◆", label: "What's tonight's best edge?" },
  { icon: "％", label: "Explain the top ROI play on the card" },
  { icon: "▤", label: "How did the model grade out this week?" },
  { icon: "◎", label: "Any NRFI angles today?" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

// Client-side diagnostics behind localStorage.DIME_DEBUG === "1"
const DEBUG = typeof window !== "undefined" && localStorage.getItem("DIME_DEBUG") === "1";
function dimeDebug(event: string, data?: Record<string, unknown>) {
  if (!DEBUG) return;
  console.log(`[DimeChat:DEBUG] ${event}`, data ?? "");
}

export default function DimeChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Pin to bottom as tokens stream in
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      setError(null);
      setInput("");

      const userMsg: Msg = { id: uid(), role: "user", content: trimmed };
      const assistantId = uid();
      const history = [...messages, userMsg];

      setMessages([
        ...history,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const appendDelta = (delta: string) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m,
          ),
        );

      const streamStart = Date.now();
      let frameCount = 0;
      dimeDebug("stream.open", { historyLength: history.length });

      try {
        const res = await fetch("/api/dime/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(6));
              frameCount++;
              if (event.type === "delta") appendDelta(event.text);
              if (event.type === "error") setError(event.message);
            } catch (parseErr) {
              dimeDebug("frame.parse_failure", { raw: line.slice(0, 100) });
            }
          }
        }

        const latency = Date.now() - streamStart;
        const fps = frameCount / (latency / 1000);
        dimeDebug("stream.done", { frameCount, latencyMs: latency, fps: fps.toFixed(1) });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError("Dime couldn't connect. Try again.");
          // Remove the empty assistant bubble on hard failure
          setMessages((prev) =>
            prev.filter((m) => !(m.id === assistantId && m.content === "")),
          );
          dimeDebug("stream.error", { error: (err as Error).message });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
  );

  const stop = () => abortRef.current?.abort();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="dime-page">
      {/* Header */}
      <header className="dime-header">
        <div className="dime-mark" aria-hidden="true">
          D
        </div>
        <div className="dime-header-text">
          <span className="dime-name">DIME</span>
          <span className="dime-sub">The engine behind Prez Bets</span>
        </div>
        <span className={`dime-status ${streaming ? "is-live" : ""}`}>
          {streaming ? "RUNNING" : "READY"}
        </span>
      </header>

      {/* Transcript */}
      <div className="dime-scroll" ref={scrollRef}>
        {empty ? (
          <div className="dime-empty">
            <div className="dime-empty-mark" aria-hidden="true">
              D
            </div>
            <h1 className="dime-empty-title">Ask Dime.</h1>
            <p className="dime-empty-copy">
              Edges, picks, model performance, bankroll. Straight answers from
              the sims.
            </p>
            <div className="dime-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  className="dime-chip"
                  onClick={() => send(s.label)}
                >
                  <span className="dime-chip-icon" aria-hidden="true">
                    {s.icon}
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="dime-thread">
            {messages.map((m) => (
              <div key={m.id} className={`dime-row dime-row--${m.role}`}>
                {m.role === "assistant" && (
                  <div className="dime-avatar" aria-hidden="true">
                    D
                  </div>
                )}
                <div className={`dime-bubble dime-bubble--${m.role}`}>
                  {m.content ||
                    (streaming && (
                      <span className="dime-typing" aria-label="Dime is thinking">
                        <i />
                        <i />
                        <i />
                      </span>
                    ))}
                </div>
              </div>
            ))}
            {error && <div className="dime-error">{error}</div>}
          </div>
        )}
      </div>

      {/* Composer */}
      <form className="dime-composer" onSubmit={onSubmit}>
        <textarea
          className="dime-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Dime…"
          rows={1}
          enterKeyHint="send"
        />
        {streaming ? (
          <button
            type="button"
            className="dime-send dime-send--stop"
            onClick={stop}
            aria-label="Stop response"
          >
            ■
          </button>
        ) : (
          <button
            type="submit"
            className="dime-send"
            disabled={!input.trim()}
            aria-label="Send message"
          >
            ↑
          </button>
        )}
      </form>
    </div>
  );
}
