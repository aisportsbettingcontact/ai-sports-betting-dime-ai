"use client";

import type { AiChatMessage, ChatMessage } from "@/lib/types";
import { useDimeApp } from "@/lib/store";
import { useToast } from "@/components/ui/toast";
import { MatchCard } from "@/components/chat/match-card";
import { PropRow } from "@/components/chat/prop-row";
import { CopyIcon, BookmarkIcon, RefreshIcon } from "@/components/icons";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex flex-col gap-[18px] px-4 pt-3 pb-5 w-full max-w-[680px] mx-auto box-border">
      {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.text} /> : <AiResponse key={m.id} message={m} />))}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-bubble border border-border rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] leading-snug text-text-1 whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}

function AiResponse({ message }: { message: AiChatMessage }) {
  const { dispatch, regenerate } = useDimeApp();
  const showToast = useToast();

  const hasText = message.shownText.length > 0;

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Dime AI response">
      {message.status === "thinking" && (
        <div className="flex items-center gap-2 py-0.5">
          <span aria-hidden className="rounded-full bg-mint animate-caret" style={{ width: 7, height: 7 }} />
          <span className="text-[13px] text-text-2">Running the model…</span>
        </div>
      )}

      {hasText && (
        <div className="text-[15px] leading-relaxed text-text-1" style={{ maxWidth: "60ch" }}>
          {message.shownText}
          {message.status === "streaming" && (
            <span
              aria-hidden
              className="inline-block ml-0.5 rounded-sm bg-mint animate-caret-fast align-[-2px]"
              style={{ width: 7, height: 14 }}
            />
          )}
        </div>
      )}

      {message.status === "done" && message.match && (
        <MatchCard
          match={message.match}
          evidenceOpen={message.evidenceOpen}
          onToggleEvidence={() => dispatch({ type: "TOGGLE_EVIDENCE", id: message.id })}
        />
      )}

      {message.status === "done" && message.props && (
        <section
          aria-label="Ranked player prop projections"
          className="rounded-2xl border border-border bg-surface overflow-hidden animate-fade-in"
        >
          {message.props.map((p, i) => (
            <PropRow
              key={p.player}
              prop={p}
              rank={i + 1}
              whyOpen={!!message.whyOpen[i]}
              onToggleWhy={() => dispatch({ type: "TOGGLE_MSG_WHY", id: message.id, index: i })}
            />
          ))}
          {message.propsMeta && (
            <div className="px-4 py-2.5 bg-surface-2 text-[11px] text-text-3 tabular-nums-font">{message.propsMeta}</div>
          )}
        </section>
      )}

      {message.status === "stopped" && (
        <div className="text-[12.5px] text-text-3">Generation stopped.</div>
      )}

      {message.status === "done" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Copy response"
              onClick={() => {
                navigator.clipboard?.writeText(message.text).catch(() => {});
                showToast("Copied to clipboard");
              }}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-text-3 active:bg-surface-2"
            >
              <CopyIcon />
            </button>
            <button
              type="button"
              aria-label={message.saved ? "Remove from saved" : "Save response"}
              onClick={() => {
                dispatch({ type: "TOGGLE_SAVE", id: message.id });
                showToast(message.saved ? "Removed from saved" : "Saved to your analysis");
              }}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center active:bg-surface-2"
              style={{ color: message.saved ? "var(--mint)" : "var(--text-3)" }}
            >
              <BookmarkIcon filled={message.saved} />
            </button>
            <button
              type="button"
              aria-label="Regenerate response"
              onClick={() => regenerate(message.id)}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-text-3 active:bg-surface-2"
            >
              <RefreshIcon />
            </button>
            <span className="flex-1" />
            <span className="text-[11px] text-text-3 tabular-nums-font">{message.cost} credits</span>
          </div>

          {message.followups && message.followups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.followups.map((f) => (
                <FollowupChip key={f} label={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FollowupChip({ label }: { label: string }) {
  const { send } = useDimeApp();
  return (
    <button
      type="button"
      onClick={() => send(label)}
      className="px-3.5 py-2 rounded-full border border-border bg-surface text-[13px] font-medium text-text-2 min-h-9 active:bg-surface-2 active:text-text-1"
    >
      {label}
    </button>
  );
}
