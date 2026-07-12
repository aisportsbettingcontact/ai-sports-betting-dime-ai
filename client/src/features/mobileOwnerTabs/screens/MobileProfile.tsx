/**
 * MobileProfile — Owner-only profile screen.
 * Shows real user data, subscription state, and quick actions.
 * Connected to appUsers.me via useAppAuth().
 */
import { useEffect } from "react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { mobileOwnerTabLogger } from "../logger";
import { User, Crown, Shield, CreditCard, LogOut, Settings, ChevronRight } from "lucide-react";

export function MobileProfile() {
  const { appUser, loading } = useAppAuth();
  const logoutMutation = trpc.appUsers.logout.useMutation({
    onSettled: () => {
      window.location.href = "/";
    },
  });

  useEffect(() => {
    if (!loading && appUser) {
      mobileOwnerTabLogger.log("mobile_profile_data_loaded", "profile", {
        userId: appUser.id,
        role: appUser.role,
        hasPlan: !!appUser.stripePlanId,
      });
    }
  }, [loading, appUser]);

  if (loading) {
    return (
      <div className="min-h-full bg-[#0f0f1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
          <span className="text-xs text-zinc-500">Loading profile...</span>
        </div>
      </div>
    );
  }

  if (!appUser) {
    return (
      <div className="min-h-full bg-[#0f0f1a] flex items-center justify-center px-6">
        <div className="text-center">
          <User className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Not authenticated</p>
        </div>
      </div>
    );
  }

  const planLabel = appUser.stripePlanId === "monthly" ? "Monthly" :
                    appUser.stripePlanId === "annual" ? "Annual" :
                    appUser.stripePlanId ? appUser.stripePlanId : "No Plan";

  const roleColor = appUser.role === "owner" ? "text-amber-400" :
                    appUser.role === "admin" ? "text-purple-400" :
                    appUser.role === "handicapper" ? "text-emerald-400" :
                    "text-zinc-400";

  const roleBg = appUser.role === "owner" ? "bg-amber-400/10 border-amber-400/20" :
                 appUser.role === "admin" ? "bg-purple-400/10 border-purple-400/20" :
                 appUser.role === "handicapper" ? "bg-emerald-400/10 border-emerald-400/20" :
                 "bg-zinc-400/10 border-zinc-400/20";

  return (
    <div className="min-h-full bg-[#0f0f1a]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <h1 className="text-lg font-bold text-white tracking-tight">Profile</h1>
      </header>

      {/* User Card */}
      <div className="px-4 pt-5">
        <div className="rounded-2xl bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 border border-zinc-800/50 p-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400/20 to-blue-500/20 border border-emerald-400/30 flex items-center justify-center">
              <Crown className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-white font-bold text-base">{appUser.username || appUser.email}</h2>
              <p className="text-zinc-500 text-xs mt-0.5">{appUser.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleBg} ${roleColor} uppercase`}>
                  {appUser.role}
                </span>
                {appUser.discordUsername && (
                  <span className="text-[10px] text-indigo-400 bg-indigo-400/10 border border-indigo-400/20 px-2 py-0.5 rounded-full">
                    {appUser.discordUsername}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Card */}
      <div className="px-4 mt-4">
        <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-zinc-200 font-medium">Subscription</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
              appUser.stripePlanId ? "text-emerald-400 bg-emerald-400/10" : "text-zinc-500 bg-zinc-800"
            }`}>
              {appUser.stripePlanId ? "ACTIVE" : "NONE"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] text-zinc-600 uppercase">Plan</p>
              <p className="text-sm text-white font-medium">{planLabel}</p>
            </div>
            <div>
              <p className="text-[9px] text-zinc-600 uppercase">Auto-Renew</p>
              <p className={`text-sm font-medium ${appUser.cancelAtPeriodEnd ? "text-amber-400" : "text-emerald-400"}`}>
                {appUser.cancelAtPeriodEnd ? "Cancelling" : appUser.stripePlanId ? "Active" : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Credit Preview */}
      <div className="px-4 mt-4">
        <div className="rounded-xl bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400 font-medium">Model Credits</span>
            <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-400/10">
              UNLIMITED
            </span>
          </div>
          <div className="text-2xl font-bold text-white">∞</div>
          <p className="text-[10px] text-zinc-500 mt-1">Owner account — no credit limits</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-4 mt-6">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Quick Actions</p>
        <div className="space-y-2">
          {[
            { icon: Shield, label: "Admin Panel", desc: "Manage users & data", color: "text-purple-400", href: "/admin/users" },
            { icon: Settings, label: "Settings", desc: "App preferences", color: "text-zinc-400", href: "/account" },
            { icon: LogOut, label: "Sign Out", desc: "End session", color: "text-red-400", href: null },
          ].map((action) => (
            <button
              key={action.label}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/30 hover:border-zinc-700 transition-all active:scale-[0.98]"
              onClick={() => {
                mobileOwnerTabLogger.log("profile_action", "profile", { action: action.label });
                // [LOGIN FIX 2026-07-12] These were log-only dead buttons.
                if (action.label === "Sign Out") logoutMutation.mutate();
                else if (action.href) window.location.assign(action.href);
              }}
            >
              <action.icon className={`w-4 h-4 ${action.color}`} />
              <div className="flex-1 text-left">
                <p className="text-[11px] text-zinc-200 font-medium">{action.label}</p>
                <p className="text-[9px] text-zinc-600">{action.desc}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
            </button>
          ))}
        </div>
      </div>

      {/* Session Info */}
      <div className="px-4 mt-6 pb-24">
        <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/20 p-3">
          <p className="text-[9px] text-zinc-600 font-mono">
            uid: {appUser.id} • access: {appUser.hasAccess ? "granted" : "denied"} • discord: {appUser.discordId ? "linked" : "none"}
          </p>
        </div>
      </div>
    </div>
  );
}
