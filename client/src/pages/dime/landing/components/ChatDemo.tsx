/**
 * Dime Chat demo — the REAL product interface, driven by scripted exchanges.
 *
 * Owner directive 2026-07-31: "use the actual Dime Chat AI interface … display
 * it as a demo". So the thread below is not a lookalike: it renders the
 * product's own <Turn> (dc-turn--user / dc-user-capsule / dc-turn--assistant,
 * dc-prose, [EDGE] blocks, the dimeTyping dots) under the product's own
 * conversation.css. If chat rendering changes, this section changes with it —
 * there is no second copy to drift.
 *
 * What is simulated, and why: the live thread streams from POST /api/dime/chat,
 * which is auth-gated and model-backed. A public landing page cannot call it
 * (401 by design, and every message costs real credits), so the exchanges are
 * pre-written product copy replayed through the real streaming STATES —
 * user turn → typing dots → delta-by-delta reveal → done. The bar stays
 * labelled "Demo · sample markets", and the CTA points at the real thing.
 *
 * Motion (apple-design): the reveal is a timer-driven text stream that
 * collapses to the final state under prefers-reduced-motion — no movement,
 * no partial text, just the answer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAT_EXCHANGES, CHAT_SIDE } from "../landing-content";
import { SectionHead, CtaRow } from "./shared";
import { Turn } from "@/pages/dime-chat/DimeChatPage";
import type { ChatMessage } from "@/pages/dime-chat/chatReducer";
import { useReducedMotionPreference } from "@/pages/dime-chat/useReducedMotionPreference";
import "@/pages/dime-chat/conversation.css";

/** Streaming cadence — fast enough to feel live, slow enough to read as typing. */
const STREAM_MS_PER_CHUNK = 26;
const STREAM_CHUNK_CHARS = 3;
const TYPING_DOTS_MS = 620;

export default function ChatDemo() {
  const [activeId, setActiveId] = useState(CHAT_EXCHANGES[0].id);
  const [creditsUsed, setCreditsUsed] = useState(1);
  const [revealed, setRevealed] = useState<string>(CHAT_EXCHANGES[0].dime);
  const [phase, setPhase] = useState<"typing" | "streaming" | "done">("done");
  const reduceMotion = useReducedMotionPreference();

  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(id => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const exchange = useMemo(
    () => CHAT_EXCHANGES.find(e => e.id === activeId) ?? CHAT_EXCHANGES[0],
    [activeId]
  );

  /** Replay one exchange through the product's real streaming states. */
  const play = useCallback(
    (text: string) => {
      clearTimers();
      if (reduceMotion) {
        setPhase("done");
        setRevealed(text);
        return;
      }
      setPhase("typing");
      setRevealed("");
      timers.current.push(
        window.setTimeout(() => {
          setPhase("streaming");
          let cursor = 0;
          const tick = () => {
            cursor = Math.min(text.length, cursor + STREAM_CHUNK_CHARS);
            setRevealed(text.slice(0, cursor));
            if (cursor < text.length) {
              timers.current.push(window.setTimeout(tick, STREAM_MS_PER_CHUNK));
            } else {
              setPhase("done");
            }
          };
          tick();
        }, TYPING_DOTS_MS)
      );
    },
    [clearTimers, reduceMotion]
  );

  // Timers must never outlive the section (or a fast unmount mid-stream).
  useEffect(() => clearTimers, [clearTimers]);

  const pick = (id: string) => {
    if (id === activeId) return;
    const next = CHAT_EXCHANGES.find(e => e.id === id);
    if (!next) return;
    setActiveId(id);
    setCreditsUsed(c => Math.min(CHAT_SIDE.creditsTotal, c + 1));
    play(next.dime);
  };

  // The exact message shape the product's reducer produces, so <Turn> takes
  // the same branches here as it does in a live thread.
  const userMsg: ChatMessage = {
    id: `${exchange.id}-user`,
    role: "user",
    content: exchange.user,
    status: "done",
  };
  const assistantMsg: ChatMessage = {
    id: `${exchange.id}-assistant`,
    role: "assistant",
    content: phase === "typing" ? "" : revealed,
    status: phase === "done" ? "done" : "open",
  };

  return (
    <section className="sec" id="chat-demo" aria-label="Dime Chat demo">
      <div className="wrap">
        <div className="sec-body">
          <SectionHead
            eyebrow="Dime Chat"
            headline={{
              before: "Interrogate the number, ",
              em: "not the narrative",
              after: ".",
            }}
            sub="This is the product's own chat surface. Pick a question — the answers are real product tone on sample markets."
          />

          <div
            className="chat-grid"
            style={{ marginTop: "clamp(28px, 4vw, 44px)" }}
          >
            {/* Left: prompts, filters, credits */}
            <div className="chat-side">
              <div>
                <span
                  className="mono"
                  style={{ display: "block", marginBottom: 10 }}
                >
                  Suggested questions
                </span>
                <div className="chip-group">
                  {CHAT_EXCHANGES.map(e => (
                    <button
                      key={e.id}
                      type="button"
                      className="chip"
                      aria-pressed={e.id === activeId}
                      onClick={() => pick(e.id)}
                    >
                      {e.chip}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span
                  className="mono"
                  style={{ display: "block", marginBottom: 10 }}
                >
                  Market filters
                </span>
                <div className="filter-row">
                  {CHAT_SIDE.filters.map(f => (
                    <span key={f} className="filter-chip">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div className="credit-meter">
                <span className="mono num">
                  {CHAT_SIDE.creditsLabel} · {creditsUsed}/
                  {CHAT_SIDE.creditsTotal}
                </span>
                <span className="bar">
                  <b
                    style={{
                      width: `${(creditsUsed / CHAT_SIDE.creditsTotal) * 100}%`,
                    }}
                  />
                </span>
              </div>
            </div>

            {/* Right: the product's own thread surface */}
            <div className="chat-window">
              <div className="chat-bar">
                <span className="pulse" aria-hidden="true" />
                <span>dime.chat</span>
                <span className="right">Demo · sample markets</span>
              </div>
              {/* theme-dark scopes the product's chat tokens to this panel —
                  the landing is a black-fixed surface in both themes. */}
              <div
                className="chat-body theme-dark dc-demo-thread"
                role="log"
                aria-live="polite"
              >
                <Turn msg={userMsg} freshness="none" fx={false} />
                <Turn msg={assistantMsg} freshness="none" fx={false} />
              </div>
            </div>
          </div>

          <CtaRow
            label="The full chat runs on tonight's real slate"
            cta="Open the full chat"
            href="#pricing"
            ctaId="chat-demo-open-full-chat"
            location="chat-demo"
          />
        </div>
      </div>
    </section>
  );
}
