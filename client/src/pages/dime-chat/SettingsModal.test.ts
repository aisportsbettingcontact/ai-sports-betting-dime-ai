import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Settings modal shell — client contract (Round 3 Step 2, owner directive
 * 2026-07-22).
 *
 * This suite runs under vitest's `environment: "node"` (no jsdom — see
 * client/src/contexts/ThemeContext.test.ts and comingSoonGate.test.ts for
 * the same constraint elsewhere in this codebase), so it pins the dialog's
 * accessibility/behavior contract as a source contract (string/regex
 * matches on the real .tsx/.css text) rather than a rendered-DOM test.
 *
 * Requirements under test (task-2-brief.md):
 *  1. Centered dialog: role="dialog" aria-modal, scrim click + Esc close,
 *     focus trap, focus returns to the trigger on close, body scroll lock.
 *  2. Left nav: Account, Billing, bottom Log Out row — in that order.
 *  3. Billing pane carries a clearly-marked TODO(step-4) stub region.
 *  4. 160ms cubic-bezier(0.16,1,0.3,1) enter beat (MASTER.md's one curve),
 *     collapsed by prefers-reduced-motion.
 *  5. DimeChatPage.tsx actually mounts the modal and wires the Step 1
 *     onOpenSettings hook to open it — without disturbing that hook's own
 *     TODO(step-2) contract (comingSoonGate.test.ts still owns that pin).
 */

const modalSource = fs.readFileSync(
  path.join(import.meta.dirname, "SettingsModal.tsx"),
  "utf8"
);
const chatSource = fs.readFileSync(
  path.join(import.meta.dirname, "DimeChatPage.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(import.meta.dirname, "conversation.css"),
  "utf8"
);

describe("dialog semantics", () => {
  it("is a real ARIA dialog: role, aria-modal, labelled", () => {
    expect(modalSource).toMatch(/role="dialog"/);
    expect(modalSource).toMatch(/aria-modal="true"/);
    expect(modalSource).toMatch(/aria-labelledby="dc-sm-title"/);
    expect(modalSource).toMatch(/id="dc-sm-title"/);
  });

  it("closes on scrim click but not on a click inside the dialog", () => {
    const scrimIdx = modalSource.indexOf('className="dc-sm-scrim"');
    expect(scrimIdx).toBeGreaterThan(-1);
    const scrimOnMouseDown = modalSource.indexOf("onMouseDown={onClose}", scrimIdx);
    expect(scrimOnMouseDown).toBeGreaterThan(scrimIdx);

    const dialogIdx = modalSource.indexOf('className="dc-sm-dialog', scrimIdx);
    expect(dialogIdx).toBeGreaterThan(scrimOnMouseDown);
    const stopPropagationIdx = modalSource.indexOf(
      "event.stopPropagation()",
      dialogIdx
    );
    expect(stopPropagationIdx).toBeGreaterThan(dialogIdx);
  });

  it("closes on Escape", () => {
    expect(modalSource).toMatch(/event\.key === "Escape"/);
    const escIdx = modalSource.indexOf('event.key === "Escape"');
    const onCloseCallIdx = modalSource.indexOf("onCloseRef.current()", escIdx);
    expect(onCloseCallIdx).toBeGreaterThan(escIdx);
    expect(onCloseCallIdx - escIdx).toBeLessThan(200);
  });

  it("traps Tab focus inside the dialog (wraps first <-> last focusable)", () => {
    expect(modalSource).toMatch(/event\.key !== "Tab"/);
    expect(modalSource).toMatch(/FOCUSABLE_SELECTOR/);
    expect(modalSource).toMatch(/document\.activeElement === first/);
    expect(modalSource).toMatch(/document\.activeElement === last/);
    expect(modalSource).toMatch(/event\.preventDefault\(\)/);
  });

  it("locks body scroll while open and restores it on close", () => {
    expect(modalSource).toMatch(
      /document\.body\.style\.overflow = "hidden"/
    );
    expect(modalSource).toMatch(
      /document\.body\.style\.overflow = previousOverflow/
    );
  });

  it("returns focus to a real sidebar trigger on close, never leaves it stranded", () => {
    // Two live candidates: the persistent gear trigger, and the avatar
    // button that remains the ONLY trigger when the desktop sidebar is
    // collapsed to a rail (.dc-sidebar--rail hides .dc-settings-trigger —
    // conversation.css:1007). Falling back to whichever is on-screen keeps
    // focus from vanishing into document.body when the rail is collapsed.
    expect(modalSource).toMatch(/\.dc-settings-trigger/);
    expect(modalSource).toMatch(/\.dc-avatar-btn/);
    expect(modalSource).toMatch(/\.focus\(\)/);
  });

  it("only mounts hooks/logic while `open` — returns null otherwise", () => {
    expect(modalSource).toMatch(/if \(!open \|\| !appUser\) return null;/);
  });
});

describe("left nav — sections + Log Out", () => {
  it("renders Account, Billing, then Log Out in that order", () => {
    const navIdx = modalSource.indexOf('className="dc-sm-nav"');
    const accountTabIdx = modalSource.indexOf(
      'onClick={() => setSection("account")}',
      navIdx
    );
    const billingTabIdx = modalSource.indexOf(
      'onClick={() => setSection("billing")}',
      navIdx
    );
    const logOutIdx = modalSource.indexOf("dc-sm-nav-logout", navIdx);
    expect(navIdx).toBeGreaterThan(-1);
    expect(accountTabIdx).toBeGreaterThan(navIdx);
    expect(billingTabIdx).toBeGreaterThan(accountTabIdx);
    expect(logOutIdx).toBeGreaterThan(billingTabIdx);
  });

  it("Log Out reuses the app's own logout mutation + hard redirect (same contract as the popover's onLogout)", () => {
    expect(modalSource).toMatch(
      /const logoutMutation = trpc\.appUsers\.logout\.useMutation\(\)/
    );
    expect(modalSource).toMatch(/await logoutMutation\.mutateAsync\(\)/);
    expect(modalSource).toMatch(/window\.location\.assign\("\/"\)/);
  });

  it("switching sections never mutates outside the nav's own state", () => {
    expect(modalSource).toMatch(/const \[section, setSection\] = useState<SettingsSection>\("account"\)/);
    expect(modalSource).toMatch(/onClick=\{\(\) => setSection\("account"\)\}/);
    expect(modalSource).toMatch(/onClick=\{\(\) => setSection\("billing"\)\}/);
  });

  it("always opens on Account, never resumes a stale section from a prior open", () => {
    const effectIdx = modalSource.indexOf('if (open) setSection("account");');
    expect(effectIdx).toBeGreaterThan(-1);
  });
});

describe("Account section — relocated edit-profile + Discord + reset password", () => {
  it("Username row is display-only (no rename mutation exists in this codebase)", () => {
    expect(modalSource).toMatch(/formatHandle\(appUser\.username\)/);
    expect(modalSource).toContain("Cannot be changed");
  });

  it("Discord row mirrors the app's existing connected/not-connected pattern", () => {
    expect(modalSource).toMatch(/appUser\.discordId/);
    expect(modalSource).toMatch(/href="\/api\/auth\/discord\/connect"/);
    expect(modalSource).toContain("Connect Discord");
    expect(modalSource).toContain("Cannot be disconnected");
  });

  it("Reset Password reuses the existing requestPasswordReset mutation contract", () => {
    expect(modalSource).toMatch(
      /trpc\.appUsers\.requestPasswordReset\.useMutation/
    );
    expect(modalSource).toMatch(
      /emailOrUsername: appUser\.email,\s*origin: window\.location\.origin,/
    );
  });
});

describe("Billing pane — real implementation (Round 3 Step 4)", () => {
  // Step 2 shipped a placeholder here (a `function BillingSection` defined
  // inline in this file, with a TODO(step-4) comment and a guardrail
  // asserting it made zero trpc.stripe.* calls). Step 4 replaces that stub
  // with the real pane, extracted to its own file (BillingSection.tsx,
  // >250 lines of JSX — the task's explicit extraction allowance) since the
  // full plan-card/history/payment-methods/billing-info/cancel-confirm
  // contract has its own dedicated source-contract suite there
  // (BillingSection.test.ts). What's left to assert here is intent-
  // preserving: the stub and its TODO are gone, and SettingsModal.tsx wires
  // the real component in at the same call site Step 2 documented as the
  // insertion point (r3-task-2-report.md).
  it("no longer carries the Step 2 TODO(step-4) stub or an inline BillingSection", () => {
    expect(modalSource).not.toMatch(/TODO\(step-4\)/);
    expect(modalSource).not.toMatch(/function BillingSection/);
  });

  it("imports the extracted BillingSection and mounts it with isOwner", () => {
    expect(modalSource).toMatch(
      /import BillingSection from "\.\/BillingSection";/
    );
    expect(modalSource).toMatch(/<BillingSection isOwner=\{isOwner\} \/>/);
  });

  it("Billing only ever mounts while its own tab is active — the same section-switcher ternary that already gates Account, which is also what satisfies 'gate every billing query on modal-open + billing-section-active': BillingSection cannot exist in the tree unless open && section === 'billing'", () => {
    const contentIdx = modalSource.indexOf('className="dc-sm-content"');
    expect(contentIdx).toBeGreaterThan(-1);
    const ternaryIdx = modalSource.indexOf(
      'section === "account" ? (',
      contentIdx
    );
    expect(ternaryIdx).toBeGreaterThan(contentIdx);
    const accountIdx = modalSource.indexOf("<AccountSection", ternaryIdx);
    const billingIdx = modalSource.indexOf("<BillingSection", ternaryIdx);
    expect(accountIdx).toBeGreaterThan(ternaryIdx);
    expect(billingIdx).toBeGreaterThan(accountIdx);
  });
});

describe("motion — the one frozen 160ms curve", () => {
  it("enters with a 160ms scale/fade on the brand curve, not a keyframe slide", () => {
    expect(cssSource).toMatch(
      /\.dc-sm-dialog--enter \{ animation: dcSettingsModalIn 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\); \}/
    );
    expect(cssSource).toMatch(
      /@keyframes dcSettingsModalIn \{[\s\S]*?transform: scale\(0\.96\)[\s\S]*?\}/
    );
  });

  it("reduced motion collapses the enter beat to an instant frame", () => {
    expect(cssSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.dc-sm-dialog--enter \{ animation: none; \}[^}]*\}/
    );
  });

  it("stacks to a single column at narrow widths", () => {
    expect(cssSource).toMatch(/@media \(max-width: 600px\)/);
    const narrowBlockIdx = cssSource.indexOf("@media (max-width: 600px)");
    const flexColumnIdx = cssSource.indexOf(
      ".dc-sm-body { flex-direction: column; }",
      narrowBlockIdx
    );
    expect(flexColumnIdx).toBeGreaterThan(narrowBlockIdx);
  });
});

describe("DimeChatPage.tsx — mounts the modal and wires Step 1's hook", () => {
  it("imports SettingsModal", () => {
    expect(chatSource).toMatch(
      /import SettingsModal from "\.\/SettingsModal"/
    );
  });

  it("Settings row's onOpenSettings now actually opens the modal", () => {
    // Step 1 left onOpenSettings unwired (comingSoonGate.test.ts pins the
    // TODO(step-2) comment + the no-goTo contract on the popover's own
    // button — untouched here). This step supplies the real handler at the
    // <DimeSidebar> call site.
    expect(chatSource).toMatch(
      /onOpenSettings=\{\(\) => setSettingsOpen\(true\)\}/
    );
    expect(chatSource).toMatch(
      /const \[settingsOpen, setSettingsOpen\] = useState\(false\)/
    );
  });

  it("still carries Step 1's TODO(step-2) marker on the popover's own Settings row — this step didn't touch that hook's call site", () => {
    expect(chatSource).toMatch(/TODO\(step-2\)/);
    expect(chatSource).toMatch(/onOpenSettings\?\.\(\)/);
  });

  it("mounts <SettingsModal> wired to appUser/isOwner and the shared sidebarRef", () => {
    const mountIdx = chatSource.indexOf("<SettingsModal");
    expect(mountIdx).toBeGreaterThan(-1);
    const mountEnd = chatSource.indexOf("/>", mountIdx);
    const mountProps = chatSource.slice(mountIdx, mountEnd);
    expect(mountProps).toMatch(/open=\{settingsOpen\}/);
    expect(mountProps).toMatch(/onClose=\{\(\) => setSettingsOpen\(false\)\}/);
    expect(mountProps).toMatch(/appUser=\{appUser\}/);
    expect(mountProps).toMatch(/isOwner=\{isOwner\}/);
    expect(mountProps).toMatch(/sidebarRef=\{sidebarRef\}/);
  });
});
