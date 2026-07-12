import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deriveThreadTitle } from "./routers/dimeChats";

/**
 * Persistent Dime Chat history — contract tests (2026-07-12).
 *
 * Locks the security and product shape of the dimeChats router:
 *   - every procedure runs on appUserProcedure (authenticated app user)
 *   - every thread read/write goes through the ownership check
 *   - delete is SOFT (deletedAt) — rows stay in the database
 * and the client wiring in DimeChatPage:
 *   - non-owners get the coming-soon state (no composer, no pills)
 *   - the sidebar identity comes from the live session, not sample copy
 *   - the "⋯" menu wires Star / Archive / Delete to the router mutations
 */

const routerSrc = fs.readFileSync(
  path.join(import.meta.dirname, "routers", "dimeChats.ts"),
  "utf8"
);
const pageSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "client", "src", "pages", "dime-chat", "DimeChatPage.tsx"),
  "utf8"
);
const chatRouteSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const schemaSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "drizzle", "schema.ts"),
  "utf8"
);

describe("deriveThreadTitle", () => {
  it("collapses whitespace and passes short titles through", () => {
    expect(deriveThreadTitle("  best   MLB\nedges today ")).toBe("best MLB edges today");
  });
  it("truncates long titles with an ellipsis at the cap", () => {
    const long = "x".repeat(200);
    const title = deriveThreadTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("dimeChats router — security contract", () => {
  it("every procedure is built on appUserProcedure", () => {
    expect(routerSrc.match(/appUserProcedure/g)?.length).toBeGreaterThanOrEqual(8);
    expect(routerSrc).not.toMatch(/publicProcedure/);
  });

  it("list scopes to the session user and hides deleted threads", () => {
    expect(routerSrc).toContain("eq(dimeChatThreads.userId, ctx.appUser.id)");
    expect(routerSrc).toContain("isNull(dimeChatThreads.deletedAt)");
  });

  it("every mutating/reading procedure on a thread goes through getOwnedThread", () => {
    // get, appendMessages, setStarred, setArchived, softDelete
    expect(routerSrc.match(/getOwnedThread\(db, input\.threadId, ctx\.appUser\.id\)/g)?.length).toBe(5);
  });

  it("delete is SOFT — sets deletedAt, never removes rows", () => {
    expect(routerSrc).toMatch(/set\(\{ deletedAt: new Date\(\) \}\)/);
    expect(routerSrc).not.toMatch(/\.delete\(dimeChat/);
  });

  it("schema defines the two history tables with soft-delete support", () => {
    expect(schemaSrc).toContain('mysqlTable(\n  "dime_chat_threads"');
    expect(schemaSrc).toContain('mysqlTable(\n  "dime_chat_messages"');
    expect(schemaSrc).toMatch(/deletedAt: timestamp\("deletedAt"\)/);
  });
});

describe("Dime chat page — owner gate + live identity + ⋯ menu", () => {
  it("non-owners get the coming-soon state and never the composer", () => {
    expect(pageSrc).toContain('const CHAT_COMING_SOON_COPY = "AI MODEL CHAT COMING SOON"');
    expect(pageSrc).toMatch(/\{!chatUiReady && !authLoading && <ChatComingSoon theme=\{theme\} \/>\}/);
    // Composer zone, hero and pills all gate on chatUiReady.
    expect(pageSrc).toMatch(/\{chatUiReady && \(\s*<div className="dc-composer-zone">/);
    expect(pageSrc).toMatch(/\{chatUiReady && !conversation && <BrandHero/);
    expect(pageSrc).toMatch(/\{chatUiReady && !conversation && \(\s*<PromptPills/);
  });

  it("the server refuses non-owners before any model or context work", () => {
    expect(chatRouteSrc).toMatch(/user\.hasAccess && user\.role === "owner"/);
    expect(chatRouteSrc).toContain('res.status(403).json({ error: "AI Model chat is coming soon." })');
  });

  it("sidebar identity is the live session user — no frozen sample copy", () => {
    expect(pageSrc).not.toContain("PREZ BETS");
    expect(pageSrc).not.toContain("Expires August 8, 2026");
    expect(pageSrc).not.toContain("FROZEN SAMPLE IDENTITY");
    expect(pageSrc).toContain("resolveAvatarSrc");
    expect(pageSrc).toMatch(/@\{appUser\.username\}/);
    // Discord avatar CDN + blank silhouette fallback.
    expect(pageSrc).toContain("cdn.discordapp.com/avatars/");
    expect(pageSrc).toContain("BLANK_AVATAR_URI");
  });

  it("lifetime members see no Upgrade/Cancel; the menu buttons act", () => {
    expect(pageSrc).toMatch(/\{!lifetime && \(\s*<div className="dc-menu-cta-row">/);
    expect(pageSrc).toContain('goTo("/checkout")');
    expect(pageSrc).toContain('goTo("/account")');
    expect(pageSrc).toContain('goTo("/profile")');
    expect(pageSrc).toContain("logoutMutation.mutate()");
  });

  it("the ⋯ menu wires Star, Archive and Delete to the history mutations", () => {
    expect(pageSrc).toMatch(/aria-label="Chat settings"/);
    expect(pageSrc).toContain("setStarredMut.mutate(");
    expect(pageSrc).toContain("setArchivedMut.mutate(");
    expect(pageSrc).toContain("softDeleteMut.mutate(");
    expect(pageSrc).toMatch(/window\.confirm\("Delete this chat\?/);
  });

  it("turns persist to history after the stream settles", () => {
    expect(pageSrc).toContain("createThreadMut.mutate(");
    expect(pageSrc).toContain("appendMut.mutate(");
    expect(pageSrc).toMatch(/utils\.dimeChats\.list\.invalidate\(\)/);
    expect(pageSrc).toMatch(/utils\.dimeChats\.get\.fetch\(\{ threadId: id \}\)/);
  });
});
