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
  path.join(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "pages",
    "dime-chat",
    "DimeChatPage.tsx"
  ),
  "utf8"
);
const conversationCssSrc = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "pages",
    "dime-chat",
    "conversation.css"
  ),
  "utf8"
);
const chatRouteSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const modelAccessSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dimeModelAccess.ts"),
  "utf8"
);
const schemaSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "drizzle", "schema.ts"),
  "utf8"
);

describe("deriveThreadTitle", () => {
  // 2026-07-29 r3: new-thread titles route through the topic-detection engine
  // (server/dimeChatTitle.ts — its own test file carries the full matrix).
  it("collapses whitespace and composes a topic title", () => {
    expect(deriveThreadTitle("  best   MLB\nedges today ")).toBe(
      "MLB Edges — Today"
    );
  });
  it("truncates undetectable long input with an ellipsis under the cap", () => {
    const long = "z".repeat(200);
    const title = deriveThreadTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("dimeChats router — security contract", () => {
  it("every procedure is built on appUserProcedure", () => {
    expect(routerSrc.match(/appUserProcedure/g)?.length).toBeGreaterThanOrEqual(
      8
    );
    expect(routerSrc).not.toMatch(/publicProcedure/);
  });

  it("list scopes to the session user and hides deleted threads", () => {
    expect(routerSrc).toContain("eq(dimeChatThreads.userId, ctx.appUser.id)");
    expect(routerSrc).toContain("isNull(dimeChatThreads.deletedAt)");
  });

  it("every mutating/reading procedure on a thread goes through getOwnedThread", () => {
    // get, appendMessages, rename, setStarred, setArchived, softDelete
    expect(
      routerSrc.match(
        /getOwnedThread\(\s*(?:db|tx),\s*input\.threadId,\s*ctx\.appUser\.id\s*\)/g
      )?.length
    ).toBe(6);
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

  it("creates the thread and first settled turn atomically with a typed id", () => {
    expect(routerSrc).toContain("db.transaction(");
    expect(routerSrc).toContain(".$returningId()");
    expect(routerSrc).not.toContain(
      "inserted as unknown as { insertId: number }"
    );
  });
});

describe("Dime chat page — owner gate + live identity + ⋯ menu", () => {
  it("non-owners get the coming-soon state and never the composer", () => {
    expect(pageSrc).toContain("AI MODEL CHAT COMING SOON");
    expect(pageSrc).toMatch(/\{chatAccess === "denied" && \(/);
    // Composer zone and hero gate on the granted access state. (Suggested-
    // prompt pills retired 2026-07-31 — the empty state is composer-only, so
    // no pill block should exist to gate at all.)
    expect(pageSrc).toMatch(
      /\{chatAccess === "granted" && \(\s*<div className="dc-composer-zone">/
    );
    expect(pageSrc).toMatch(
      /\{chatAccess === "granted" && !conversation && \(\s*<BrandHero/
    );
    expect(pageSrc).not.toContain("PromptPills");
  });

  it("the server refuses non-owners before any model or context work", () => {
    expect(chatRouteSrc).toContain("canAccessDimeModel(user)");
    expect(chatRouteSrc).toContain(
      "res.status(403).json({ error: DIME_MODEL_ACCESS_MESSAGE })"
    );
    // The decision itself is the owner-only policy module.
    expect(modelAccessSrc).toMatch(/user\.role === "owner"/);
    expect(modelAccessSrc).toMatch(/if \(!user\.hasAccess\) return false/);
  });

  it("sidebar identity is the live session user — no frozen sample copy", () => {
    expect(pageSrc).not.toContain("PREZ BETS");
    expect(pageSrc).not.toContain("Expires August 8, 2026");
    expect(pageSrc).not.toContain("FROZEN SAMPLE IDENTITY");
    expect(pageSrc).toContain("resolveAvatarSrc");
    expect(pageSrc).toMatch(/formatHandle\(appUser\.username\)/);
    // Discord avatar CDN + blank silhouette fallback.
    expect(pageSrc).toContain("cdn.discordapp.com/avatars/");
    expect(pageSrc).toContain("BLANK_AVATAR_URI");
  });

  it("lifetime members see no Upgrade/Cancel; the menu buttons act", () => {
    expect(pageSrc).toMatch(
      /\{showPlanCtas && \(\s*<div className="dc-menu-cta-row">/
    );
    expect(pageSrc).toMatch(/!isLifetimeMember\(appUser\)/);
    expect(pageSrc).toContain('goTo("/checkout")');
    expect(pageSrc).toContain('goTo("/account")');
    // goTo("/profile") pinned no remaining call site as of Round 3 Step 1
    // (owner directive 2026-07-22, account popover v2): the popover's
    // "Edit Profile" row — the one thing that ever called goTo("/profile")
    // here — was cut; its content moved to the Settings modal's Account
    // section (SettingsModal.tsx). client/src/pages/dime-chat/
    // comingSoonGate.test.ts's sibling assertion was updated for this at the
    // time (`.not.toMatch(/goTo\("\/profile"\)/)`); this file's own copy of
    // the same pin was missed then and is corrected here, intent preserved
    // (Upgrade/Cancel/Log Out — the rows that are still real — stay pinned).
    expect(pageSrc).not.toContain('goTo("/profile")');
    expect(pageSrc).toContain("await logoutMutation.mutateAsync()");
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
    expect(pageSrc).toContain("firstAssistantMessage: assistantText");
    expect(pageSrc).toMatch(/utils\.dimeChats\.list\.invalidate\(\)/);
    expect(pageSrc).toMatch(
      /utils\.dimeChats\.get\.fetch\(\{ threadId: id \}\)/
    );
  });

  it("keeps the responsible-gaming notice out of the live log and in a muted page footer", () => {
    expect(pageSrc).not.toContain(
      '<div className="dc-footnote">{DISCLAIMER}</div>'
    );
    expect(pageSrc).toMatch(
      /<footer\s+className="dc-chat-footer"\s+aria-label="Responsible gaming notice"\s*>\s*\{DISCLAIMER\}\s*<\/footer>/
    );
    expect(pageSrc.match(/\{DISCLAIMER\}/g)).toHaveLength(1);
    expect(conversationCssSrc).toMatch(
      /\.dc-chat-footer\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/
    );
  });
});
