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
      <div className="min-h-full bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-[#45E0A8] border-t-[#45E0A8] animate-spin" />
          <span className="text-xs text-white">Loading profile...</span>
        </div>
      </div>
    );
  }

  if (!appUser) {
    return (
      <div className="min-h-full bg-black flex items-center justify-center px-6">
        <div className="text-center">
          <User className="w-10 h-10 text-white mx-auto mb-3" />
          <p className="text-sm text-white">Not authenticated</p>
        </div>
      </div>
    );
  }

  const planLabel = appUser.stripePlanId === "monthly" ? "Monthly" :
                    appUser.stripePlanId === "annual" ? "Annual" :
                    appUser.stripePlanId ? appUser.stripePlanId : "No Plan";

  const roleColor = appUser.role === "owner" ? "text-white" :
                    appUser.role === "admin" ? "text-white" :
                    appUser.role === "handicapper" ? "text-[#45E0A8]" :
                    "text-white";

  const roleBg = appUser.role === "owner" ? "bg-black border-white" :
                 appUser.role === "admin" ? "bg-black border-white" :
                 appUser.role === "handicapper" ? "bg-[#45E0A8] border-[#45E0A8]" :
                 "bg-black border-white";

  return (
    <div className="min-h-full bg-black">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black backdrop-blur-sm border-b border-white px-4 py-3">
        <h1 className="text-lg font-bold text-white tracking-tight">Profile</h1>
      </header>

      {/* User Card */}
      <div className="px-4 pt-5">
        <div className="rounded-2xl bg-black border border-white p-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#45E0A8] border border-[#45E0A8] flex items-center justify-center">
              <Crown className="w-6 h-6 text-[#45E0A8]" />
            </div>
            <div className="flex-1">
              <h2 className="text-white font-bold text-base">{appUser.username || appUser.email}</h2>
              <p className="text-white text-xs mt-0.5">{appUser.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleBg} ${roleColor} uppercase`}>
                  {appUser.role}
                </span>
                {appUser.discordUsername && (
                  <span className="text-[10px] text-white bg-black border border-white px-2 py-0.5 rounded-full">
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
        <div className="rounded-xl bg-black border border-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-white" />
              <span className="text-xs text-white font-medium">Subscription</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
              appUser.stripePlanId ? "text-[#45E0A8] bg-[#45E0A8]" : "text-white bg-black"
            }`}>
              {appUser.stripePlanId ? "ACTIVE" : "NONE"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] text-white uppercase">Plan</p>
              <p className="text-sm text-white font-medium">{planLabel}</p>
            </div>
            <div>
              <p className="text-[9px] text-white uppercase">Auto-Renew</p>
              <p className={`text-sm font-medium ${appUser.cancelAtPeriodEnd ? "text-white" : "text-[#45E0A8]"}`}>
                {appUser.cancelAtPeriodEnd ? "Cancelling" : appUser.stripePlanId ? "Active" : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Credit Preview */}
      <div className="px-4 mt-4">
        <div className="rounded-xl bg-[#45E0A8] border border-[#45E0A8] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white font-medium">Model Credits</span>
            <span className="text-[10px] text-[#45E0A8] font-medium px-2 py-0.5 rounded-full bg-[#45E0A8]">
              UNLIMITED
            </span>
          </div>
          <div className="text-2xl font-bold text-white">∞</div>
          <p className="text-[10px] text-white mt-1">Owner account — no credit limits</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-4 mt-6">
        <p className="text-[10px] text-white uppercase tracking-wider mb-3">Quick Actions</p>
        <div className="space-y-2">
          {[
            { icon: Shield, label: "Admin Panel", desc: "Manage users & data", color: "text-white", href: "/admin/users" },
            { icon: Settings, label: "Settings", desc: "App preferences", color: "text-white", href: "/account" },
            { icon: LogOut, label: "Sign Out", desc: "End session", color: "text-white", href: null },
          ].map((action) => (
            <button
              key={action.label}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-black border border-white transition-all active:scale-[0.98]"
              onClick={() => {
                mobileOwnerTabLogger.log("profile_action", "profile", { action: action.label });
                // [LOGIN FIX 2026-07-12] These were log-only dead buttons.
                if (action.label === "Sign Out") logoutMutation.mutate();
                else if (action.href) window.location.assign(action.href);
              }}
            >
              <action.icon className={`w-4 h-4 ${action.color}`} />
              <div className="flex-1 text-left">
                <p className="text-[11px] text-white font-medium">{action.label}</p>
                <p className="text-[9px] text-white">{action.desc}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-white" />
            </button>
          ))}
        </div>
      </div>

      {/* Session Info */}
      <div className="px-4 mt-6 pb-24">
        <div className="rounded-lg bg-black border border-white p-3">
          <p className="text-[9px] text-white font-mono">
            uid: {appUser.id} • access: {appUser.hasAccess ? "granted" : "denied"} • discord: {appUser.discordId ? "linked" : "none"}
          </p>
        </div>
      </div>
    </div>
  );
}
