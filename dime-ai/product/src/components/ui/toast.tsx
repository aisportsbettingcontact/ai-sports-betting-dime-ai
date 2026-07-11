"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastContextValue = (text: string) => void;

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 2400;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setText(message);
    timerRef.current = setTimeout(() => setText(null), TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
        style={{ bottom: 112 }}
      >
        {text && (
          <div
            className="animate-sheet-up pointer-events-auto max-w-[88%] truncate rounded-full bg-text-1 px-4 py-2.5 text-[13px] font-medium text-canvas"
          >
            {text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
