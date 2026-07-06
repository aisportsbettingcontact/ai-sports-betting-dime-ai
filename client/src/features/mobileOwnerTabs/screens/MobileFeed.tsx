/**
 * MobileFeed — Shell Screen
 * ═════════════════════════
 * Displays the model projections feed in mobile-optimized layout.
 * This is a shell that wraps the existing ModelProjections component.
 */

import { useEffect } from "react";
import { mobileOwnerTabLogger } from "../logger";

export function MobileFeed() {
  useEffect(() => {
    mobileOwnerTabLogger.log("shell_mounted", "feed", { screen: "MobileFeed" });
    return () => mobileOwnerTabLogger.log("shell_unmounted", "feed");
  }, []);

  return (
    <div className="min-h-full bg-[#0f0f1a]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white tracking-tight">Model Feed</h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20">
              LIVE
            </span>
          </div>
        </div>
      </header>

      {/* Content placeholder — will integrate existing ModelProjections */}
      <div className="px-4 py-6">
        <div className="space-y-3">
          {/* Placeholder cards showing the feed will load here */}
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl bg-white/5 border border-white/10 p-4 animate-pulse"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-white/10" />
                <div className="flex-1">
                  <div className="h-3 w-24 bg-white/10 rounded" />
                  <div className="h-2 w-16 bg-white/5 rounded mt-1" />
                </div>
                <div className="h-6 w-12 bg-white/10 rounded" />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10" />
                <div className="flex-1">
                  <div className="h-3 w-28 bg-white/10 rounded" />
                  <div className="h-2 w-20 bg-white/5 rounded mt-1" />
                </div>
                <div className="h-6 w-12 bg-white/10 rounded" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-gray-500 text-xs mt-6">
          Feed integration pending — shell ready
        </p>
      </div>
    </div>
  );
}
