/**
 * MobileChat — AI Betting Analyst Preview (Phase 2)
 * ═══════════════════════════════════════════════════
 * Preview-only. No OpenAI calls. No credit deductions.
 * Shows credit state preview and action pricing.
 * Click behavior: toast "Coming soon in test mode" + log.
 */
import { useEffect, useState } from "react";
import { MessageSquare, Zap, TrendingUp, BarChart3, Brain, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { mobileOwnerTabLogger } from "../logger";

// ─── AI Action Pricing (Blueprint-defined) ──────────────────────────────────
const AI_ACTIONS = [
  { id: "explain_edge", label: "Explain This Edge", credits: 250, icon: Zap },
  { id: "find_price", label: "Find Playable Price", credits: 350, icon: TrendingUp },
  { id: "analyze_movement", label: "Analyze Line Movement", credits: 400, icon: BarChart3 },
  { id: "break_down_game", label: "Break Down This Game", credits: 750, icon: Brain },
  { id: "summarize_slate", label: "Summarize Today's Slate", credits: 2500, icon: Sparkles },
] as const;

export function MobileChat() {
  const [creditState] = useState<"owner_unlimited" | "not_initialized">("owner_unlimited");

  useEffect(() => {
    mobileOwnerTabLogger.log("mobile_chat_state_loaded", "chat", {
      credit_state: creditState,
      actions_available: AI_ACTIONS.length,
      openai_calls_enabled: false,
      credit_deduction_enabled: false,
    });
  }, []);

  const handleActionClick = (actionId: string, actionLabel: string) => {
    // Log the click
    mobileOwnerTabLogger.log("mobile_chat_preview_action_clicked", "chat", {
      action_id: actionId,
      action_label: actionLabel,
      blocked: true,
      reason: "preview_mode",
    });

    // Show toast — no OpenAI call, no credit deduction
    toast.info(`"${actionLabel}" will be available when AI Analyst is activated.`, {
      description: "Coming soon in test mode",
    });

    // Log the block
    mobileOwnerTabLogger.log("mobile_chat_preview_action_blocked", "chat", {
      action_id: actionId,
      reason: "no_openai_in_phase_2",
    });
  };

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
              <p className="text-[10px] text-zinc-500">Preview Mode — No active calls</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-zinc-800/50 px-2 py-1 rounded">
            <span className="text-[10px] text-zinc-400 font-medium">Preview</span>
          </div>
        </div>
      </header>

      {/* Credit State Banner */}
      <div className="mx-4 mt-4 rounded-xl bg-zinc-900/80 border border-zinc-800 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">AI Analyst Credits</p>
            {creditState === "owner_unlimited" ? (
              <p className="text-sm text-emerald-400 font-semibold mt-0.5">
                20,000 monthly AI Analyst Credits planned
              </p>
            ) : (
              <p className="text-sm text-amber-400 font-semibold mt-0.5">
                Credit balance not initialized.
              </p>
            )}
          </div>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">
          Credits are consumed per action. Owner accounts receive 20,000 monthly credits.
        </p>
      </div>

      {/* Action Pricing List */}
      <div className="flex-1 px-4 mt-5 overflow-y-auto">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3">Available Actions</p>
        <div className="space-y-2">
          {AI_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => handleActionClick(action.id, action.label)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 transition-all active:scale-[0.98]"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-white">{action.label}</p>
                </div>
                <div className="text-xs text-zinc-400 font-mono bg-zinc-800/50 px-2 py-0.5 rounded">
                  {action.credits.toLocaleString()}
                </div>
              </button>
            );
          })}
        </div>

        {/* Info Footer */}
        <div className="mt-4 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/50">
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Actions will be activated in a future phase. No OpenAI calls are made in preview mode.
            No credits are deducted.
          </p>
        </div>
      </div>

      {/* Input Bar (Disabled Preview) */}
      <div className="px-4 py-3 border-t border-zinc-800/50">
        <div className="flex items-center gap-2 bg-zinc-900 rounded-xl px-3 py-2.5 border border-zinc-800">
          <input
            type="text"
            placeholder="Ask the AI Analyst..."
            disabled
            className="flex-1 bg-transparent text-sm text-zinc-500 placeholder-zinc-600 outline-none cursor-not-allowed"
          />
          <button
            disabled
            className="w-7 h-7 rounded-md bg-zinc-800 flex items-center justify-center cursor-not-allowed"
          >
            <MessageSquare className="w-3.5 h-3.5 text-zinc-600" />
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 text-center mt-1.5">
          Chat disabled in preview mode
        </p>
      </div>
    </div>
  );
}
