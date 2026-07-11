"use client";

import { useDimeApp } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { MobileHeader } from "@/components/mobile-header";
import { BottomNav } from "@/components/bottom-nav";
import { ChatTab } from "@/components/tabs/chat-tab";
import { FeedTab } from "@/components/tabs/feed-tab";
import { SplitsTab } from "@/components/tabs/splits-tab";
import { PropsTab } from "@/components/tabs/props-tab";
import { ProfileTab } from "@/components/tabs/profile-tab";
import { HistorySheet } from "@/components/sheets/history-sheet";
import { CreditsSheet } from "@/components/sheets/credits-sheet";
import { MembershipSheet } from "@/components/sheets/membership-sheet";
import { EditProfileSheet } from "@/components/sheets/edit-profile-sheet";
import { LogoutSheet } from "@/components/sheets/logout-sheet";

export function AppShell() {
  const { state } = useDimeApp();

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas md:bg-work-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader />
        {state.tab === "chat" && <ChatTab />}
        {state.tab === "feed" && <FeedTab />}
        {state.tab === "splits" && <SplitsTab />}
        {state.tab === "props" && <PropsTab />}
        {state.tab === "profile" && <ProfileTab />}
        <BottomNav />
      </div>

      <HistorySheet />
      <CreditsSheet />
      <MembershipSheet />
      <EditProfileSheet />
      <LogoutSheet />
    </div>
  );
}
