/**
 * MobileNavDebugPanel
 * ═════════════════════
 * Floating debug overlay (flag-gated, off in production).
 * Shows event log, session info, feature flags, and performance metrics.
 * Toggle with triple-tap on the bottom tab bar area.
 */

import { useEffect, useState } from "react";
import { X, Bug, Download, Trash2 } from "lucide-react";
import { MOBILE_NAV_ENABLED, MOBILE_NAV_DEBUG_PANEL } from "./config";
import { mobileNavLogger } from "./logger";

export function MobileNavDebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState(mobileNavLogger.getEntries());

  // Refresh entries when panel opens
  useEffect(() => {
    if (isOpen) {
      setEntries(mobileNavLogger.getEntries());
      mobileNavLogger.log("debug_panel_opened");
      const interval = setInterval(() => {
        setEntries(mobileNavLogger.getEntries());
      }, 1000);
      return () => clearInterval(interval);
    } else {
      mobileNavLogger.log("debug_panel_closed");
    }
  }, [isOpen]);

  if (!MOBILE_NAV_DEBUG_PANEL) return null;

  function handleExport() {
    const json = mobileNavLogger.exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mobile-nav-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    mobileNavLogger.clear();
    setEntries([]);
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-[100] w-8 h-8 rounded-full border flex items-center justify-center active:scale-90 transition-transform"
        style={{
          background: "var(--dime-surface-raised)",
          borderColor: "var(--dime-border-strong)",
          color: "var(--dime-text-secondary)",
        }}
        aria-label="Toggle debug panel"
      >
        <Bug className="w-4 h-4" />
      </button>

      {/* Debug panel overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-[99] bg-black backdrop-blur-sm flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white">
            <div className="flex items-center gap-2">
              <Bug
                className="w-4 h-4"
                style={{ color: "var(--dime-mint-text)" }}
              />
              <span className="text-sm font-bold text-white">Debug Panel</span>
              <span className="text-[10px] text-white">
                {entries.length} events
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExport} className="p-1.5 rounded bg-black">
                <Download className="w-3.5 h-3.5 text-white" />
              </button>
              <button onClick={handleClear} className="p-1.5 rounded bg-black">
                <Trash2 className="w-3.5 h-3.5 text-white" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded bg-black"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>

          {/* Feature flags */}
          <div className="px-4 py-2 border-b border-white">
            <div className="text-[10px] text-white font-semibold uppercase tracking-wider mb-1">
              Feature Flags
            </div>
            <div className="flex flex-wrap gap-1.5">
              <FlagBadge label="ENABLED" active={MOBILE_NAV_ENABLED} />
              <FlagBadge label="DEBUG" active={MOBILE_NAV_DEBUG_PANEL} />
            </div>
          </div>

          {/* Session info */}
          <div className="px-4 py-2 border-b border-white">
            <div className="text-[10px] text-white font-semibold uppercase tracking-wider mb-1">
              Session
            </div>
            <div className="text-[10px] text-white font-mono">
              ID: {mobileNavLogger.getSessionId()} | Duration:{" "}
              {(mobileNavLogger.getSessionDuration() / 1000).toFixed(1)}s
            </div>
          </div>

          {/* Event log */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <div className="text-[10px] text-white font-semibold uppercase tracking-wider mb-2">
              Event Log (newest first)
            </div>
            <div className="space-y-0.5">
              {[...entries]
                .reverse()
                .slice(0, 100)
                .map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5">
                    <span className="text-[9px] text-white font-mono shrink-0 w-16">
                      {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                        hour12: false,
                      })}
                    </span>
                    <span
                      className={`text-[9px] font-mono shrink-0 w-6 ${
                        entry.tabId ? "text-[#45E0A8]" : "text-white"
                      }`}
                    >
                      {entry.tabId ? entry.tabId.slice(0, 4) : "sys"}
                    </span>
                    <span className="text-[9px] text-white font-mono">
                      {entry.event}
                    </span>
                    {entry.metadata && (
                      <span className="text-[9px] text-white font-mono truncate">
                        {JSON.stringify(entry.metadata)}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-component ───────────────────────────────────────────────────────────
function FlagBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
        active
          ? "bg-transparent text-[#45E0A8] border border-[#45E0A8]"
          : "bg-transparent text-white border border-white"
      }`}
    >
      {label}: {active ? "ON" : "OFF"}
    </span>
  );
}
