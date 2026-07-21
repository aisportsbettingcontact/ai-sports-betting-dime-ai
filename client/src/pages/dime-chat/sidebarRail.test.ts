import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guards for the desktop sidebar rail + chat management pass
 * (owner directive 2026-07-21):
 *
 *   1. COLLAPSE-TO-RAIL — desktop-only (drawer ignores it), persisted in
 *      localStorage, 160ms brand-curve width motion, 68px icon rail.
 *   2. ICON VOCABULARY — one distinctive Lucide set (TextSearch/PanelLeft*
 *      header pair, per-destination nav marks, Ellipsis/Trash2/Eraser).
 *   3. CHAT MANAGEMENT — per-row "…" delete for ANY recent chat (active
 *      thread resets to new chat), owner-only clearAllForEveryone sweep
 *      behind ownerProcedure, both destructive paths behind window.confirm.
 *   4. PROFILE — enlarged on desktop (48px avatar), avatar-only in the rail,
 *      avatar doubles as the account-menu trigger.
 */

const chatSource = fs.readFileSync(
  path.join(import.meta.dirname, "DimeChatPage.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(import.meta.dirname, "conversation.css"),
  "utf8"
);
const routerSource = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "server",
    "routers",
    "dimeChats.ts"
  ),
  "utf8"
);

describe("sidebar rail — collapse state", () => {
  it("persists the rail preference and never rails the compact drawer", () => {
    expect(chatSource).toMatch(/const RAIL_STORAGE_KEY = "dime\.sidebar\.rail"/);
    expect(chatSource).toMatch(/localStorage\.getItem\(RAIL_STORAGE_KEY\)/);
    expect(chatSource).toMatch(/localStorage\.setItem\(RAIL_STORAGE_KEY/);
    expect(chatSource).toMatch(/const rail = railCollapsed && !compact/);
    expect(chatSource).toMatch(/\$\{rail \? " dc-sidebar--rail" : ""\}/);
  });

  it("uses the PanelLeft pair with state-dependent labels", () => {
    expect(chatSource).toMatch(/rail \? "Expand sidebar" : "Collapse sidebar"/);
    expect(chatSource).toMatch(/<PanelLeftOpen /);
    expect(chatSource).toMatch(/<PanelLeftClose /);
  });

  it("rail search first re-expands, then opens the field", () => {
    expect(chatSource).toMatch(
      /if \(rail\) \{\s*setRail\(false\);\s*setSearchOpen\(true\);/
    );
    expect(chatSource).toMatch(/\{!compact && !rail && searchOpen && \(/);
  });

  it("CSS: 68px rail, 160ms brand-curve width motion, desktop-scoped", () => {
    expect(cssSource).toMatch(
      /\.dc-sidebar \{\s*transition: width 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/
    );
    expect(cssSource).toMatch(/\.dc-sidebar--rail \{ width: 68px/);
    // Rail rules live inside the >=1024px block only.
    const desktopBlock = cssSource.slice(cssSource.indexOf("@media (min-width: 1024px)"));
    expect(desktopBlock).toContain(".dc-sidebar--rail");
    // Reduced motion kills the width transition.
    expect(cssSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.dc-sidebar \{ transition: none; \}/
    );
  });
});

describe("sidebar rail — nav icon vocabulary", () => {
  it("every nav row declares a Lucide icon (no emoji, ＋ glyph retired)", () => {
    expect(chatSource).toMatch(/icon: MessageSquarePlus/);
    expect(chatSource).toMatch(/icon: BrainCircuit/);
    expect(chatSource).toMatch(/icon: ChartCandlestick/);
    expect(chatSource).toMatch(/icon: ChartSpline/);
    expect(chatSource).toMatch(/icon: Target/);
    expect(chatSource).toMatch(/icon: NotebookPen/);
    expect(chatSource).not.toMatch(/dc-sidebar-icon">＋/);
  });

  it("active rows tint their mark mint (D/L:27 parity)", () => {
    expect(cssSource).toMatch(
      /\.dc-sidebar-row\.is-active \.dc-nav-ico,\s*\.dc-sidebar-row\[aria-current="page"\] \.dc-nav-ico \{ color: var\(--accent\); \}/
    );
  });
});

describe("recent chats — management", () => {
  it("per-row '…' menu deletes ANY chat; deleting the open one resets", () => {
    expect(chatSource).toMatch(/onDeleteChat: \(threadId: number\) => void/);
    expect(chatSource).toMatch(/aria-label=\{`Chat options: \$\{rc\.title\}`\}/);
    expect(chatSource).toMatch(/<Ellipsis /);
    expect(chatSource).toMatch(
      /softDeleteMut\.mutate\(\s*\{ threadId: id \},[\s\S]*?if \(id === threadId\) newChat\(\);/
    );
  });

  it("both destructive paths are confirm-guarded", () => {
    expect(chatSource).toMatch(
      /window\.confirm\(\s*"Delete this chat\? It will be removed from your history\."\s*\)/
    );
    expect(chatSource).toMatch(/window\.confirm\(\s*"Clear recent chats for ALL users\?/);
  });

  it("clear-all is owner-gated end to end", () => {
    // Client: prop passed only for owners; button renders only with the prop.
    expect(chatSource).toMatch(/onClearAllChats=\{isOwner \? clearAllRecentChats : undefined\}/);
    expect(chatSource).toMatch(/\{onClearAllChats && isOwner && \(/);
    // Server: ownerProcedure sweep that only stamps deletedAt on live rows.
    expect(routerSource).toMatch(/clearAllForEveryone: ownerProcedure\.mutation/);
    expect(routerSource).toMatch(
      /set\(\{ deletedAt: new Date\(\) \}\)\s*\.where\(isNull\(dimeChatThreads\.deletedAt\)\)/
    );
  });

  it("recents scroll on desktop with fade edges (no more hidden clip)", () => {
    const desktopBlock = cssSource.slice(cssSource.indexOf("@media (min-width: 1024px)"));
    expect(desktopBlock).toMatch(/\.dc-recent-list \{\s*overflow-y: auto/);
    expect(desktopBlock).toMatch(/mask-image: linear-gradient\(to bottom, transparent 0/);
  });

  it("search filters stored threads by title, case-insensitively", () => {
    expect(chatSource).toMatch(/const chatQuery = searchQuery\.trim\(\)\.toLowerCase\(\)/);
    expect(chatSource).toMatch(
      /recentChats\.filter\(rc => rc\.title\.toLowerCase\(\)\.includes\(chatQuery\)\)/
    );
  });
});

describe("profile row — enlarged, avatar-only rail", () => {
  it("desktop enlarges the row and avatar; rail keeps only the picture", () => {
    const desktopBlock = cssSource.slice(cssSource.indexOf("@media (min-width: 1024px)"));
    expect(desktopBlock).toMatch(/\.dc-profile-row \{ min-height: 76px/);
    expect(desktopBlock).toMatch(/\.dc-profile-row \.dc-avatar \{ width: 48px; height: 48px; \}/);
    expect(desktopBlock).toMatch(/\.dc-sidebar--rail \.dc-profile-id,\s*\.dc-sidebar--rail \.dc-settings-trigger \{ display: none; \}/);
  });

  it("the avatar is a menu trigger; the rail menu opens beside the rail", () => {
    expect(chatSource).toMatch(/className="dc-avatar-btn dc-pressable dc-focusable"/);
    expect(chatSource).toMatch(
      /dc-avatar-btn[\s\S]{0,400}onClick=\{\(\) => setMenuOpen\(open => !open\)\}[\s\S]{0,200}<IdentityAvatar user=\{appUser\} \/>/
    );
    expect(cssSource).toMatch(
      /\.dc-sidebar--rail \.dc-settings-menu \{ left: calc\(100% \+ 10px\); right: auto; bottom: 4px; \}/
    );
  });
});
