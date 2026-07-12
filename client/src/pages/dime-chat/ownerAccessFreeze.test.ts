import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Owner-only send freeze — client contract (2026-07-12).
 *
 * Requirement: only owner accounts (@prez, @sippi) may message the Dime Chat
 * model. For everyone else the send button is frozen on every device and
 * page: a send attempt shows the hardcoded notice "AI Model access will be
 * available soon" directly below the composer pill — black text in light
 * mode, white text in dark mode — and no request ever leaves the client.
 *
 * DimeChatPage funnels EVERY send path (send button click, Enter key via form
 * submit, prompt pill click, error-card retry) through submit()/retry(), so
 * gating those two callbacks freezes all entry points at once. These
 * source-contract tests (same pattern as DimeAppShell.test.ts) lock that
 * structure.
 */

const chatSource = fs.readFileSync(
  path.join(import.meta.dirname, "DimeChatPage.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(import.meta.dirname, "conversation.css"),
  "utf8"
);
const serverPolicySource = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "server",
    "dimeModelAccess.ts"
  ),
  "utf8"
);

describe("owner-only send freeze — DimeChatPage", () => {
  it("derives owner status from useAppAuth (fails closed while auth resolves)", () => {
    expect(chatSource).toMatch(
      /import \{ useAppAuth \} from "@\/_core\/hooks\/useAppAuth"/
    );
    expect(chatSource).toMatch(/const \{ isOwner \} = useAppAuth\(\)/);
  });

  it("gates submit() before any message dispatch or network call", () => {
    const submitStart = chatSource.indexOf(
      "const submit = useCallback(\n    (text: string) => {"
    );
    expect(submitStart).toBeGreaterThan(-1);
    const gateIdx = chatSource.indexOf("if (!isOwner) {", submitStart);
    const noticeIdx = chatSource.indexOf("setAccessNotice(true);", submitStart);
    const dispatchIdx = chatSource.indexOf(
      'dispatch({ type: "append_user"',
      submitStart
    );
    const streamIdx = chatSource.indexOf("void runStream(", submitStart);
    expect(gateIdx).toBeGreaterThan(submitStart);
    expect(noticeIdx).toBeGreaterThan(gateIdx);
    // The freeze fires before any state mutation or stream start.
    expect(dispatchIdx).toBeGreaterThan(noticeIdx);
    expect(streamIdx).toBeGreaterThan(noticeIdx);
  });

  it("gates retry() the same way", () => {
    const retryStart = chatSource.indexOf("const retry = useCallback(() => {");
    expect(retryStart).toBeGreaterThan(-1);
    const gateIdx = chatSource.indexOf("if (!isOwner) {", retryStart);
    const streamIdx = chatSource.indexOf("void runStream(", retryStart);
    expect(gateIdx).toBeGreaterThan(retryStart);
    expect(streamIdx).toBeGreaterThan(gateIdx);
  });

  it("every send entry point funnels through the gated submit()", () => {
    // Form submit (send button + Enter key both fire onSubmit).
    expect(chatSource).toMatch(/const onSubmit = \(e: FormEvent\) => \{\s*e\.preventDefault\(\);\s*submit\(input\);/);
    // Prompt pills pass submit as their onPick handler.
    expect(chatSource).toMatch(/<PromptPills[\s\S]*?onPick=\{submit\}/);
    // Exactly one fetch to the chat API exists, inside runStream (reached only
    // after the owner gate in submit/retry).
    expect(chatSource.match(/fetch\("\/api\/dime\/chat"/g)).toHaveLength(1);
  });

  it("renders the hardcoded notice directly below the composer pill", () => {
    expect(chatSource).toMatch(
      /const ACCESS_NOTICE = "AI Model access will be available soon"/
    );
    // The notice block sits immediately after the composer </form> inside the
    // composer zone, so it lands right under the input pill in home and
    // conversation states, on desktop and mobile alike.
    expect(chatSource).toMatch(
      /<\/form>\s*\{accessNotice && \(\s*<div className="dc-access-notice" role="status">\s*\{ACCESS_NOTICE\}/
    );
  });

  it("marks the send button frozen for non-owners", () => {
    expect(chatSource).toMatch(/aria-disabled=\{!isOwner \|\| undefined\}/);
  });

  it("clears the notice only when auth resolves to an owner", () => {
    expect(chatSource).toMatch(
      /if \(isOwner\) setAccessNotice\(false\);/
    );
  });
});

describe("owner-only send freeze — notice styling", () => {
  it("uses white text in dark mode and black text in light mode", () => {
    expect(cssSource).toMatch(
      /\.theme-dark \.dc-access-notice \{\s*color: #ffffff;\s*\}/
    );
    expect(cssSource).toMatch(
      /\.theme-light \.dc-access-notice \{\s*color: #000000;\s*\}/
    );
  });

  it("wraps the full-width notice onto its own line under the pill in flex zones", () => {
    expect(cssSource).toMatch(/\.dc-composer-zone \{\s*flex-wrap: wrap;\s*\}/);
    expect(cssSource).toMatch(
      /\.dc-access-notice \{[\s\S]*?width: 100%;[\s\S]*?\}/
    );
  });
});

describe("owner-only send freeze — client/server copy stays in sync", () => {
  it("client ACCESS_NOTICE matches server DIME_MODEL_ACCESS_MESSAGE", () => {
    const clientCopy = chatSource.match(
      /const ACCESS_NOTICE = "([^"]+)"/
    )?.[1];
    const serverCopy = serverPolicySource.match(
      /export const DIME_MODEL_ACCESS_MESSAGE = "([^"]+)"/
    )?.[1];
    expect(clientCopy).toBe("AI Model access will be available soon");
    expect(serverCopy).toBe(clientCopy);
  });
});
