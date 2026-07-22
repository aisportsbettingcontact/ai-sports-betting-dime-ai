import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Settings modal Billing pane — client contract (Round 3 Step 4, owner
 * directive 2026-07-22).
 *
 * Same constraint as SettingsModal.test.ts / sidebarIdentity.test.ts: this
 * suite runs under vitest's `environment: "node"` (no jsdom), so it pins the
 * pane's contract as a source contract (string/regex matches on the real
 * .tsx/.css text) rather than a rendered-DOM test.
 *
 * Requirements under test (task-4-brief.md + round3-constraints.md):
 *  1. Consumes Step 3's four read-only procedures by their exact names.
 *  2. Queries are gated so an owner (no billing plan) never fetches.
 *  3. Reuses the pre-existing checkout/portal/cancel/reactivate contracts.
 *  4. Plan card is state-driven: active/cancel_scheduled/expired/none, each
 *     with the owner's literal template text.
 *  5. Cancel confirm: the owner's copy pinned VERBATIM, a neutral "Keep
 *     plan", and a destructive --dime-danger token used on ONLY that one
 *     button anywhere in conversation.css.
 *  6. Cancel success invalidates getPlanStatus (+ getSubscription) so the
 *     card re-derives.
 *  7. Billing history receipt links open hostedInvoiceUrl safely in a new
 *     tab.
 *  8. Payment methods show brand/last4/expiry/default; billing info shows
 *     name/email/address.
 *  9. Every query branch has a loading, error, and (where applicable) empty
 *     state with honest, non-fabricated copy.
 * 10. Apple discipline: one 160ms curve for the cancel-confirm entrance,
 *     collapsed under reduced motion, and reserved space on every card so
 *     loading → loaded never jumps the dialog around it.
 */

const source = fs.readFileSync(
  path.join(import.meta.dirname, "BillingSection.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(import.meta.dirname, "conversation.css"),
  "utf8"
);

describe("data layer — Step 3's four procedures, consumed verbatim", () => {
  it("calls getPlanStatus / getInvoices / getPaymentMethods / getBillingInfo by their exact names", () => {
    expect(source).toMatch(/trpc\.stripe\.getPlanStatus\.useQuery\(\)/);
    expect(source).toMatch(/trpc\.stripe\.getInvoices\.useQuery\(\)/);
    expect(source).toMatch(/trpc\.stripe\.getPaymentMethods\.useQuery\(\)/);
    expect(source).toMatch(/trpc\.stripe\.getBillingInfo\.useQuery\(\)/);
  });

  it("each query lives inside its own card component (PlanCard/BillingHistoryTable/PaymentMethodsList/BillingInfoCard), not the top-level BillingSection", () => {
    // Each function owns exactly its query — confirms the four data calls
    // aren't hoisted into BillingSection (see the next test for why that
    // matters for the owner gate).
    const planCardIdx = source.indexOf("function PlanCard(");
    const tableIdx = source.indexOf("function BillingHistoryTable(");
    const pmIdx = source.indexOf("function PaymentMethodsList(");
    const infoIdx = source.indexOf("function BillingInfoCard(");
    expect(planCardIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeGreaterThan(planCardIdx);
    expect(pmIdx).toBeGreaterThan(tableIdx);
    expect(infoIdx).toBeGreaterThan(pmIdx);
    expect(source.indexOf("getPlanStatus.useQuery()", planCardIdx)).toBeGreaterThan(planCardIdx);
    expect(source.indexOf("getInvoices.useQuery()", tableIdx)).toBeGreaterThan(tableIdx);
    expect(source.indexOf("getPaymentMethods.useQuery()", pmIdx)).toBeGreaterThan(pmIdx);
    expect(source.indexOf("getBillingInfo.useQuery()", infoIdx)).toBeGreaterThan(infoIdx);
  });

  it("owner accounts never even mount the four data-query components — BillingSection early-returns the owner stub before rendering any of them", () => {
    const ownerReturnIdx = source.indexOf("if (isOwner) {");
    const planCardMountIdx = source.indexOf("<PlanCard");
    expect(ownerReturnIdx).toBeGreaterThan(-1);
    expect(planCardMountIdx).toBeGreaterThan(ownerReturnIdx);
  });
});

describe("reuses the existing checkout / portal / cancel / reactivate contracts", () => {
  it("Upgrade routes through the app's existing checkout flow", () => {
    expect(source).toMatch(/navigate\("\/checkout"\)/);
  });

  it("'Manage in Stripe' is the createPortalSession escape hatch", () => {
    expect(source).toMatch(
      /trpc\.stripe\.createPortalSession\.useMutation/
    );
    expect(source).toContain("Manage in Stripe");
  });

  it("Cancel confirm calls cancelSubscription; Renew calls reactivateSubscription", () => {
    expect(source).toMatch(/trpc\.stripe\.cancelSubscription\.useMutation/);
    expect(source).toMatch(/trpc\.stripe\.reactivateSubscription\.useMutation/);
  });
});

describe("plan card — state-driven branches (owner's literal templates)", () => {
  it("active: 'Current Plan — {planLabel} · Renews {date}'", () => {
    expect(source).toContain("`Current Plan — ${status.planLabel} · Renews ${dateStr}`");
  });

  it("cancel_scheduled: 'Access until {date}'", () => {
    expect(source).toContain("`Access until ${dateStr}`");
  });

  it("expired: 'Expired {date}'", () => {
    expect(source).toContain("`Expired ${dateStr}`");
  });

  it("none: an honest, non-fabricated no-plan state (no invented date/plan)", () => {
    const noneCaseIdx = source.indexOf('case "none":');
    expect(noneCaseIdx).toBeGreaterThan(-1);
    expect(source).toContain("No plan on file");
    expect(source).toContain("You don't have a plan on file. Subscribe to unlock full access.");
  });

  it("Renew shows for cancel_scheduled/expired; Cancel shows only for active", () => {
    expect(source).toMatch(
      /status\.state === "cancel_scheduled" \|\| status\.state === "expired"/
    );
    expect(source).toMatch(/status\.state === "active" && \(/);
  });
});

describe("cancel flow — verbatim owner copy + the app's one destructive-red exception", () => {
  it("pins the cancel confirm copy VERBATIM", () => {
    expect(source).toContain(
      "If you cancel, you'll keep full access to your plan features until the end of your billing period."
    );
  });

  it("has a neutral 'Keep plan' beside the destructive confirm", () => {
    expect(source).toMatch(/>\s*Keep plan\s*</);
  });

  it("cancel success invalidates getPlanStatus and getSubscription so the card re-derives", () => {
    const successIdx = source.indexOf("cancelSubscription.useMutation({");
    expect(successIdx).toBeGreaterThan(-1);
    const invalidateCallIdx = source.indexOf("invalidatePlan()", successIdx);
    expect(invalidateCallIdx).toBeGreaterThan(successIdx);
    expect(source).toMatch(/utils\.stripe\.getPlanStatus\.invalidate\(\)/);
    expect(source).toMatch(/utils\.stripe\.getSubscription\.invalidate\(\)/);
  });

  it("defines --dime-danger once and uses it on exactly one rule: the cancel-plan confirm button", () => {
    expect(cssSource).toMatch(/--dime-danger:\s*#E5484D/);
    const usages = cssSource.match(/var\(--dime-danger\)/g) ?? [];
    expect(usages.length).toBe(1);
    const usageIdx = cssSource.indexOf("var(--dime-danger)");
    const rulePreamble = cssSource.slice(Math.max(0, usageIdx - 60), usageIdx);
    expect(rulePreamble).toContain(".dc-sm-pill--danger");
  });

  it("documents the destructive-only, owner-directed exception to the no-red rule", () => {
    const tokenDeclIdx = cssSource.indexOf("--dime-danger: #E5484D");
    expect(tokenDeclIdx).toBeGreaterThan(-1);
    const nearbyComment = cssSource.slice(Math.max(0, tokenDeclIdx - 900), tokenDeclIdx);
    expect(nearbyComment).toMatch(/owner-directed/i);
    expect(nearbyComment).toMatch(/destructive/i);
  });

  it("the confirm button's own class carries no other color token (danger is scoped to background only)", () => {
    const ruleMatch = cssSource.match(/\.dc-sm-pill--danger \{[^}]*\}/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch![0]).toContain("var(--dime-danger)");
  });
});

describe("billing history — receipt links open safely in a new tab", () => {
  it("uses hostedInvoiceUrl with target=_blank and rel=noopener noreferrer", () => {
    expect(source).toMatch(/href=\{inv\.hostedInvoiceUrl\}/);
    expect(source).toMatch(/target="_blank"/);
    expect(source).toMatch(/rel="noopener noreferrer"/);
  });

  it("shows date, amount, status, and a receipt column", () => {
    expect(source).toContain("formatShortDate(inv.date)");
    expect(source).toContain("formatCents(inv.amountCents, inv.currency)");
    expect(source).toContain("capitalize(inv.status)");
  });
});

describe("payment methods — brand + masked digits + expiry + default badge", () => {
  it("renders every field of BillingPaymentMethod", () => {
    expect(source).toMatch(/capitalize\(pm\.brand\)/);
    expect(source).toMatch(/•••• \{pm\.last4\}/);
    expect(source).toMatch(/pm\.expMonth/);
    expect(source).toMatch(/pm\.expYear/);
    expect(source).toMatch(/pm\.isDefault && <span className="dc-sm-pm-default">Default<\/span>/);
  });
});

describe("billing information — name / email / address", () => {
  it("renders all three BillingInfo fields when present", () => {
    expect(source).toMatch(/const name = info\?\.name/);
    expect(source).toMatch(/const email = info\?\.email/);
    expect(source).toMatch(/info\?\.address/);
    expect(source).toMatch(/address\.line1/);
    expect(source).toMatch(/address\.country/);
  });
});

describe("loading / error / empty — honest, no fabricated values", () => {
  it("every section handles isLoading and isError before touching query.data", () => {
    const loadingCount = (source.match(/query\.isLoading\)/g) ?? []).length;
    const errorCount = (source.match(/query\.isError\)/g) ?? []).length;
    expect(loadingCount).toBe(4);
    expect(errorCount).toBe(4);
  });

  it("carries honest empty-state copy for history / payment methods / billing info", () => {
    expect(source).toContain("No billing history yet.");
    expect(source).toContain("No payment method on file.");
    expect(source).toContain("No billing information on file.");
  });

  it("error copy surfaces the real server message, never a fabricated one", () => {
    expect(source).toMatch(
      /Couldn't load your plan\. \{query\.error\?\.message \|\| "Please try again\."\}/
    );
  });
});

describe("Apple discipline — restrained motion, no layout jumps", () => {
  it("the cancel-confirm panel enters on MASTER.md's ONE 160ms curve, not a bespoke one", () => {
    expect(cssSource).toMatch(
      /\.dc-sm-cancel-confirm--enter \{ animation: dcBillingPanelIn 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\); \}/
    );
  });

  it("collapses under prefers-reduced-motion alongside the dialog's own enter beat", () => {
    expect(cssSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.dc-sm-dialog--enter \{ animation: none; \}[^}]*\.dc-sm-cancel-confirm--enter \{ animation: none; \}[^}]*\}/
    );
  });

  it("has no exit animation (matches the dialog's own established precedent — Keep Plan just unmounts it)", () => {
    expect(source).not.toMatch(/dc-sm-cancel-confirm--exit/);
  });

  it("reserves space on every card so a resolving query never shrink-wraps the dialog", () => {
    expect(cssSource).toMatch(/\.dc-sm-plan-card \{[^}]*min-height: 92px/);
  });

  it("wide table content scrolls in its own container, never the page", () => {
    expect(cssSource).toMatch(/\.dc-sm-bill-table-wrap \{[^}]*overflow-x: auto/);
  });

  it("no shimmer/pulse animation on the loading skeleton (motion dial 2/10 reserves motion for live/typing only)", () => {
    expect(cssSource).not.toMatch(/dc-sm-skel-line[^{]*\{[^}]*animation/);
  });
});
