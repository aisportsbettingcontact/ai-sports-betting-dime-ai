/**
 * MobileChat — AI Betting Analyst Shell Screen
 * ═════════════════════════════════════════════
 * ChatGPT-inspired interface with preview action chips.
 * Ready for LLM integration.
 */

import { useEffect, useState } from "react";
import { MessageSquare, Send, Sparkles } from "lucide-react";
import { mobileOwnerTabLogger } from "../logger";

const ACTION_CHIPS = [
  { id: "edges", label: "Find today's edges", icon: "⚡" },
  { id: "model", label: "Run model analysis", icon: "🧮" },
  { id: "splits", label: "Check sharp action", icon: "📊" },
  { id: "bankroll", label: "Bankroll strategy", icon: "💰" },
];

export function MobileChat() {
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    mobileOwnerTabLogger.log("shell_mounted", "chat", { screen: "MobileChat" });
    return () => mobileOwnerTabLogger.log("shell_unmounted", "chat");
  }, []);

  function handleChipTap(chipId: string) {
    mobileOwnerTabLogger.log("chat_chip_tapped", "chat", { chipId });
    // Future: send chip action to LLM
  }

  function handleSend() {
    if (!inputValue.trim()) return;
    mobileOwnerTabLogger.log("chat_chip_tapped", "chat", { type: "manual", length: inputValue.length });
    setInputValue("");
  }

  return (
    <div className="min-h-full bg-[#0f0f1a] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">AI Betting Analyst</h1>
            <p className="text-[10px] text-gray-400">Powered by your model engine</p>
          </div>
        </div>
      </header>

      {/* Chat area — empty state with action chips */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-blue-500/20 border border-emerald-400/30 flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8 text-emerald-400" />
        </div>
        <h2 className="text-white font-semibold text-base mb-1">Ask anything about today's slate</h2>
        <p className="text-gray-400 text-xs text-center mb-6 max-w-[240px]">
          Get model-driven insights, edge analysis, and bankroll recommendations
        </p>

        {/* Action chips */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-[300px]">
          {ACTION_CHIPS.map((chip) => (
            <button
              key={chip.id}
              onClick={() => handleChipTap(chip.id)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all active:scale-95"
            >
              <span className="text-sm">{chip.icon}</span>
              <span className="text-xs text-gray-300 font-medium text-left leading-tight">{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="px-4 pb-3 pt-2 border-t border-white/5">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask AI Betting Analyst..."
            className="flex-1 bg-transparent text-white text-sm placeholder:text-gray-500 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-gray-600 flex items-center justify-center transition-all"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
