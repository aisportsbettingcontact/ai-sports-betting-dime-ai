/**
 * MobileChat — AI Betting Analyst chat preview.
 * Shows credit state, quick-action chips, and conversation preview.
 * No actual OpenAI calls — this is a preview/entry-point screen.
 * Phase 3 will wire LLM calls.
 */
import { useEffect, useState } from "react";
import { MessageSquare, Send, Sparkles, Zap, Brain, ChevronRight } from "lucide-react";
import { mobileOwnerTabLogger } from "../logger";

const QUICK_CHIPS = [
  { id: "edges", label: "Today's Top Edges", icon: Zap, color: "emerald" as const },
  { id: "steam", label: "Steam Moves", icon: Sparkles, color: "amber" as const },
  { id: "model", label: "Model vs Book", icon: Brain, color: "blue" as const },
  { id: "review", label: "Bet Slip Review", icon: MessageSquare, color: "purple" as const },
] as const;

const colorMap = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  purple: "border-purple-500/30 bg-purple-500/10 text-purple-400",
};

export function MobileChat() {
  const [inputValue, setInputValue] = useState("");
  const [selectedChip, setSelectedChip] = useState<string | null>(null);

  useEffect(() => {
    mobileOwnerTabLogger.log("mobile_chat_state_loaded", "chat", { creditsAvailable: "unlimited_owner" });
  }, []);

  function handleChipTap(chipId: string) {
    setSelectedChip(chipId);
    mobileOwnerTabLogger.log("chat_chip_tapped", "chat", { chip: chipId });
    setTimeout(() => setSelectedChip(null), 1500);
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">AI Analyst</h1>
              <p className="text-[10px] text-zinc-500">Dixon-Coles + Monte Carlo</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-400 font-medium">Online</span>
          </div>
        </div>
      </header>

      {/* Credit State Banner */}
      <div className="mx-4 mt-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-zinc-200 font-medium">Owner Access</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-mono">∞ credits</span>
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">Unlimited queries • All models • Priority routing</p>
      </div>

      {/* Quick Action Chips */}
      <div className="px-4 mt-6">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Quick Actions</p>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_CHIPS.map((chip) => {
            const isActive = selectedChip === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => handleChipTap(chip.id)}
                className={`flex items-center gap-2 p-3 rounded-xl border transition-all active:scale-95 ${
                  isActive
                    ? `${colorMap[chip.color]} scale-95`
                    : "border-zinc-800/50 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <chip.icon className="w-4 h-4" />
                <span className="text-[11px] font-medium text-left flex-1">{chip.label}</span>
                <ChevronRight className="w-3 h-3 opacity-50" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation Preview Area */}
      <div className="flex-1 px-4 mt-6">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Recent</p>
        <div className="space-y-2">
          {[
            { q: "What's the top edge today?", time: "2m ago" },
            { q: "BRA vs NOR model breakdown", time: "15m ago" },
            { q: "Steam moves on MLB slate", time: "1h ago" },
          ].map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-zinc-600" />
                <span className="text-[11px] text-zinc-300">{item.q}</span>
              </div>
              <span className="text-[9px] text-zinc-600">{item.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="sticky bottom-20 px-4 pb-4 pt-2">
        <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-700/50 rounded-xl px-3 py-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask the AI Analyst anything..."
            className="flex-1 bg-transparent text-white text-sm placeholder:text-zinc-600 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="w-7 h-7 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/40 disabled:bg-zinc-800 disabled:text-zinc-600 flex items-center justify-center transition-all"
          >
            <Send className="w-3.5 h-3.5 text-emerald-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
