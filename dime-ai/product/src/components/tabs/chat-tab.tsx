"use client";

import { useEffect, useRef } from "react";
import { useDimeApp } from "@/lib/store";
import { HOME_PROMPTS } from "@/lib/data/seed";
import { MessageList } from "@/components/chat/message-list";
import { Composer } from "@/components/chat/composer";
import { SendIcon, ScrollDownIcon } from "@/components/icons";

const PP_STYLE = [
  { bg: "var(--pp1-bg)", border: "var(--pp1-border)", fg: "var(--pp1-fg)" },
  { bg: "var(--pp2-bg)", border: "var(--pp2-border)", fg: "var(--pp2-fg)" },
  { bg: "var(--pp3-bg)", border: "var(--pp3-border)", fg: "var(--pp3-fg)" },
];

export function ChatTab() {
  const { state, dispatch, send, scrollRef } = useDimeApp();
  const identityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMessages = state.messages.length > 0;

  // Identity screen fade: typing fades it (once), clearing the composer restores it —
  // but only before the first message is ever sent (identityGone locks it permanently).
  useEffect(() => {
    if (state.identityGone) return;
    if (identityTimer.current) clearTimeout(identityTimer.current);
    const nonEmpty = state.composerText.trim().length > 0;
    identityTimer.current = setTimeout(
      () => dispatch({ type: "SET_IDENTITY", faded: nonEmpty }),
      nonEmpty ? 150 : 350
    );
    return () => {
      if (identityTimer.current) clearTimeout(identityTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.composerText, state.identityGone]);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <main
        ref={(el) => {
          scrollRef.current = el;
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const up = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
          if (up !== state.scrolledUp) dispatch({ type: "SET_SCROLLED_UP", value: up });
        }}
        aria-label="Conversation"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col relative"
      >
        {!hasMessages && (
          <div className="flex md:hidden flex-1 flex-col items-center justify-center px-6 pb-14">
            <div className="flex flex-col items-center gap-2.5">
              <h1 className="text-[27px] font-bold leading-tight tracking-tight text-text-1 text-center m-0">
                AI Sports Betting
              </h1>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13.5px] text-text-2">powered by</span>
                <Wordmark size={16} dotSize={4.5} />
              </div>
            </div>
          </div>
        )}

        {!hasMessages && (
          <div className="hidden md:flex flex-1 flex-col items-center justify-center px-8" style={{ paddingBottom: "7vh" }}>
            <div className="w-full flex flex-col items-center gap-5">
              <h1 className="m-0 flex items-baseline gap-2.5 text-[30px] font-bold leading-tight tracking-tight text-text-1 text-center">
                Ask <Wordmark size={30} dotSize={7} /> a question
              </h1>
              <Composer placeholder="Which MLB game has the biggest edge today..." maxWidth={650} minHeight={56} radius={28} />
              <div className="flex flex-wrap justify-center gap-2.5" role="group" aria-label="Suggested prompts">
                {HOME_PROMPTS.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => send(label)}
                    className="flex items-center gap-2.5 pl-4 pr-2 py-2 rounded-full border min-h-10 active:opacity-85"
                    style={{ background: PP_STYLE[i].bg, borderColor: PP_STYLE[i].border }}
                  >
                    <span className="text-[13px] font-semibold whitespace-nowrap" style={{ color: PP_STYLE[i].fg }}>
                      {label}
                    </span>
                    <span
                      aria-hidden
                      className="flex-none w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: "#0B0B0F" }}
                    >
                      <SendIcon size={12} caret="#EDEDF2" plus="#45E0A8" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {hasMessages && <MessageList messages={state.messages} />}
      </main>

      {state.scrolledUp && hasMessages && (
        <button
          type="button"
          aria-label="Scroll to latest message"
          onClick={() => {
            dispatch({ type: "SET_SCROLLED_UP", value: false });
            const el = scrollRef.current;
            el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-elev shadow-lg flex items-center justify-center text-text-2"
          style={{ bottom: 158, width: 38, height: 38 }}
        >
          <ScrollDownIcon />
        </button>
      )}

      <div className={`px-4 pb-2.5 w-full max-w-[680px] mx-auto box-border ${hasMessages ? "flex" : "flex md:hidden"}`}>
        <Composer placeholder="Ask dime anything..." />
      </div>
    </div>
  );
}

function Wordmark({ size, dotSize }: { size: number; dotSize: number }) {
  return (
    <span
      className="font-bold tracking-tight text-text-1 inline-flex"
      style={{ fontSize: size }}
    >
      d
      <span className="relative inline-block">
        ı
        <span
          aria-hidden
          className="absolute rounded-full bg-mint"
          style={{
            top: 1,
            left: "50%",
            transform: "translateX(-50%)",
            width: dotSize,
            height: dotSize,
          }}
        />
      </span>
      me
    </span>
  );
}
