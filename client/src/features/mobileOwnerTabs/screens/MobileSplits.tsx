/**
 * MobileSplits — Shell Screen
 * ═══════════════════════════
 * Displays betting splits data in mobile-optimized layout.
 */

import { useEffect } from "react";
import { mobileOwnerTabLogger } from "../logger";

export function MobileSplits() {
  useEffect(() => {
    mobileOwnerTabLogger.log("shell_mounted", "splits", { screen: "MobileSplits" });
    return () => mobileOwnerTabLogger.log("shell_unmounted", "splits");
  }, []);

  return (
    <div className="min-h-full bg-[#0f0f1a]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white tracking-tight">Betting Splits</h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-blue-400 font-medium px-2 py-0.5 rounded-full bg-blue-400/10 border border-blue-400/20">
              SHARP
            </span>
          </div>
        </div>
      </header>

      {/* Content placeholder */}
      <div className="px-4 py-6">
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl bg-white/5 border border-white/10 p-4 animate-pulse"
            >
              <div className="flex justify-between items-center mb-2">
                <div className="h-3 w-20 bg-white/10 rounded" />
                <div className="h-3 w-12 bg-white/10 rounded" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="h-8 bg-white/5 rounded" />
                <div className="h-8 bg-white/5 rounded" />
                <div className="h-8 bg-white/5 rounded" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-gray-500 text-xs mt-6">
          Splits integration pending — shell ready
        </p>
      </div>
    </div>
  );
}
