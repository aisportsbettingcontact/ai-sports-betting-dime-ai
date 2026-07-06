/**
 * MobileProfile — Shell Screen
 * ════════════════════════════
 * Owner profile with credit preview, account info, and quick actions.
 */

import { useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Settings, Shield, LogOut, ChevronRight, Crown } from "lucide-react";
import { mobileOwnerTabLogger } from "../logger";

export function MobileProfile() {
  const { user, logout } = useAuth();

  useEffect(() => {
    mobileOwnerTabLogger.log("shell_mounted", "profile", { screen: "MobileProfile", role: user?.role });
    return () => mobileOwnerTabLogger.log("shell_unmounted", "profile");
  }, [user?.role]);

  function handleAction(action: string) {
    mobileOwnerTabLogger.log("profile_action", "profile", { action });
  }

  return (
    <div className="min-h-full bg-[#0f0f1a]">
      {/* Header */}
      <header className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center">
            <Crown className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">{user?.name ?? "Owner"}</h1>
            <p className="text-xs text-gray-400">{user?.email ?? ""}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Shield className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
                {user?.role ?? "owner"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Credit preview card */}
      <div className="px-4 mb-4">
        <div className="rounded-xl bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-400/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 font-medium">Model Credits</span>
            <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-400/10">
              UNLIMITED
            </span>
          </div>
          <div className="text-2xl font-bold text-white">∞</div>
          <p className="text-[10px] text-gray-500 mt-1">Owner account — no credit limits</p>
        </div>
      </div>

      {/* Menu items */}
      <div className="px-4 space-y-1">
        <ProfileMenuItem
          icon={<Settings className="w-4 h-4" />}
          label="Account Settings"
          onClick={() => handleAction("settings")}
        />
        <ProfileMenuItem
          icon={<Shield className="w-4 h-4" />}
          label="Admin Panel"
          onClick={() => handleAction("admin")}
        />
        <ProfileMenuItem
          icon={<LogOut className="w-4 h-4 text-red-400" />}
          label="Sign Out"
          labelClass="text-red-400"
          onClick={() => {
            handleAction("logout");
            logout();
          }}
        />
      </div>

      {/* Version info */}
      <div className="px-4 mt-8 text-center">
        <p className="text-[10px] text-gray-600">
          AI Sports Betting v19.0 • Mobile Owner Tabs v1.0
        </p>
      </div>
    </div>
  );
}

// ─── Sub-component ───────────────────────────────────────────────────────────
function ProfileMenuItem({
  icon,
  label,
  labelClass = "text-gray-200",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  labelClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all active:scale-[0.98]"
    >
      <span className="text-gray-400">{icon}</span>
      <span className={`flex-1 text-sm font-medium text-left ${labelClass}`}>{label}</span>
      <ChevronRight className="w-4 h-4 text-gray-600" />
    </button>
  );
}
