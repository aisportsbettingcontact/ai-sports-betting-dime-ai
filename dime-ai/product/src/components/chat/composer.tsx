"use client";

import { useEffect, useRef } from "react";
import { useDimeApp } from "@/lib/store";
import { PlusIcon, StopIcon, SendIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";

export function Composer({
  placeholder,
  maxWidth,
  minHeight = 52,
  radius = 24,
}: {
  placeholder: string;
  maxWidth?: number;
  minHeight?: number;
  radius?: number;
}) {
  const { state, dispatch, send, stopGen } = useDimeApp();
  const showToast = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isGenerating = state.messages.some(
    (m) => m.role === "ai" && (m.status === "thinking" || m.status === "streaming")
  );
  const hasText = state.composerText.trim().length > 0;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "23px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [state.composerText]);

  const submit = () => {
    if (!hasText || isGenerating) return;
    send(state.composerText);
  };

  return (
    <div
      className="flex items-center gap-2 border rounded-full box-border w-full"
      style={{
        maxWidth,
        minHeight,
        borderRadius: radius,
        borderColor: "var(--border-strong)",
        background: "var(--surface)",
        padding: "6px 6px 6px 10px",
      }}
    >
      <button
        type="button"
        aria-label="Add attachment"
        onClick={() => showToast("Attachments are coming soon")}
        className="flex-none w-9 h-9 rounded-full flex items-center justify-center text-text-3 active:bg-surface-2"
      >
        <PlusIcon />
      </button>
      <textarea
        ref={textareaRef}
        rows={1}
        value={state.composerText}
        onChange={(e) => dispatch({ type: "SET_COMPOSER_TEXT", text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label="Message Dime AI"
        className="flex-1 resize-none text-[15px] leading-snug text-text-1 bg-transparent py-2 max-h-[120px] overflow-y-auto"
        style={{ caretColor: "var(--mint)", height: 23 }}
      />
      {isGenerating ? (
        <button
          type="button"
          aria-label="Stop generating"
          onClick={stopGen}
          className="flex-none w-10 h-10 rounded-full bg-mint-strong flex items-center justify-center text-on-mint"
        >
          <StopIcon />
        </button>
      ) : hasText ? (
        <button
          type="button"
          aria-label="Send message"
          onClick={submit}
          className="flex-none w-10 h-10 rounded-full flex items-center justify-center border active:opacity-80"
          style={{ background: "var(--send-bg)", borderColor: "var(--send-border)" }}
        >
          <SendIcon caret="var(--send-caret)" plus="var(--send-plus)" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Send message (enter text first)"
          aria-disabled="true"
          className="flex-none w-10 h-10 rounded-full bg-surface-2 border border-border flex items-center justify-center"
          style={{ cursor: "default" }}
        >
          <SendIcon caret="var(--text-3)" plus="var(--text-3)" />
        </button>
      )}
    </div>
  );
}
