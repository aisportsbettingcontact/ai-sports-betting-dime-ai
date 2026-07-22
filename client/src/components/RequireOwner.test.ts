import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * RequireOwner — owner-only route guard (Round 3 Step 5, owner directive
 * 2026-07-22). Admin Dashboard lockdown, client half.
 *
 * Source-contract pattern (same as DimeAppShell.test.ts / comingSoonGate.test.ts
 * — this repo's vitest config runs client tests under `environment: "node"`,
 * no DOM, so component behavior is verified by pinning the exact source
 * shape rather than mounting/rendering).
 *
 * Requirements under test:
 *  1. No flash of admin content: renders null while auth is loading AND
 *     while a non-owner's redirect is pending — `children` is reachable
 *     from exactly one branch (loading === false && isOwner === true).
 *  2. Redirect target is /chat, using `{ replace: true }` so Back never
 *     re-lands on the admin URL.
 *  3. Ownership is read from useAppAuth().isOwner — the server-verified
 *     role check — never a client-side email/username string comparison.
 */

const source = fs.readFileSync(
  path.join(import.meta.dirname, "RequireOwner.tsx"),
  "utf8"
);

describe("RequireOwner — no-flash gate", () => {
  it("reads ownership from useAppAuth().isOwner (server-verified role), never a username/email check", () => {
    expect(source).toMatch(
      /const \{ appUser, loading, isOwner \} = useAppAuth\(\)/
    );
    // No client-side "@prez" / email-string gate anywhere in this file.
    expect(source).not.toMatch(/appUser\?\.\s*username\s*===/);
    expect(source).not.toMatch(/appUser\?\.\s*email\s*===/);
    expect(source).not.toContain('"@prez"');
    expect(source).not.toContain("isPrezAccount");
  });

  it("renders null whenever loading, or once resolved and not an owner — children reachable from exactly one condition", () => {
    // The render guard is the single source of truth for "no flash": it must
    // fire on loading OR !isOwner, with no other branch that could slip
    // `children` past it before ownership is confirmed.
    expect(source).toMatch(
      /if \(loading \|\| !isOwner\) \{\s*return null;\s*\}/
    );
    expect(source).toMatch(/return <>\{children\}<\/>;/);
    // The null-render check must come before the children render in source
    // order (the actual early-return path).
    const guardIdx = source.indexOf("if (loading || !isOwner)");
    const childrenIdx = source.indexOf("return <>{children}</>;");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(childrenIdx).toBeGreaterThan(guardIdx);
  });

  it("never redirects while loading — only after auth has resolved", () => {
    const effectStart = source.indexOf("useEffect(() => {");
    const effectEnd = source.indexOf("}, [loading, isOwner, appUser, navigate]);");
    const effectBody = source.slice(effectStart, effectEnd);
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    // First line of the effect must bail out on loading before anything else.
    expect(effectBody).toMatch(/if \(loading\) return;[\s\S]*if \(isOwner\) return;/);
  });

  it("redirects non-owners to /chat with replace (never push), so Back cannot re-land on the admin URL", () => {
    expect(source).toMatch(/navigate\("\/chat", \{ replace: true \}\)/);
  });

  it("is a pure client-side convenience gate — doc comment states the server owns the real boundary", () => {
    expect(source).toMatch(/ownerProcedure/);
    expect(source).toMatch(/not the security boundary/i);
  });
});
