/**
 * MobileBetTracker — Shell Screen
 * ═══════════════════════════════
 * Mobile-optimized bet tracking interface.
 */

import { useEffect } from "react";
import { Plus, TrendingUp } from "lucide-react";
import { mobileOwnerTabLogger } from "../logger";

export function MobileBetTracker() {
  useEffect(() => {
    mobileOwnerTabLogger.log("shell_mounted", "bet-tracker", { screen: "MobileBetTracker" });
    return () => mobileOwnerTabLogger.log("shell_unmounted", "bet-tracker");
  }, []);

  return (
    <div className="min-h-full bg-[#0f0f1a]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white tracking-tight">Bet Tracker</h1>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 transition-all active:scale-95">
            <Plus className="w-3.5 h-3.5 text-white" />
            <span className="text-xs font-semibold text-white">New Bet</span>
          </button>
        </div>
      </header>

      {/* Stats summary */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
            <div className="text-emerald-400 text-lg font-bold">--</div>
            <div className="text-gray-400 text-[10px] font-medium">Win Rate</div>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
            <div className="text-white text-lg font-bold">--</div>
            <div className="text-gray-400 text-[10px] font-medium">Units</div>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
            <div className="text-blue-400 text-lg font-bold">--</div>
            <div className="text-gray-400 text-[10px] font-medium">ROI</div>
          </div>
        </div>
      </div>

      {/* Recent bets placeholder */}
      <div className="px-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Recent Bets</h2>
          <TrendingUp className="w-4 h-4 text-gray-500" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl bg-white/5 border border-white/10 p-3 animate-pulse"
            >
              <div className="flex justify-between items-center">
                <div className="h-3 w-32 bg-white/10 rounded" />
                <div className="h-3 w-16 bg-white/10 rounded" />
              </div>
              <div className="flex justify-between items-center mt-2">
                <div className="h-2 w-20 bg-white/5 rounded" />
                <div className="h-2 w-12 bg-white/5 rounded" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-gray-500 text-xs mt-6">
          Bet tracker integration pending — shell ready
        </p>
      </div>
    </div>
  );
}
