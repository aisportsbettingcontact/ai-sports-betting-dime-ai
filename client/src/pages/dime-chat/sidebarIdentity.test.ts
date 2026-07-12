import { describe, expect, it } from "vitest";
import {
  deriveInitials,
  deriveTierLabel,
  displaySidebarName,
  formatExpiryLine,
  formatHandle,
  isPrezAccount,
  type SidebarUser,
} from "./sidebarIdentity";

const user = (overrides: Partial<SidebarUser> = {}): SidebarUser => ({
  username: "prez",
  role: "owner",
  hasAccess: true,
  expiryDate: null,
  discordUsername: null,
  stripePlanId: null,
  ...overrides,
});

describe("displaySidebarName / formatHandle", () => {
  it("caps the profile-row name like the frozen design", () => {
    expect(displaySidebarName("prez")).toBe("PREZ");
    expect(displaySidebarName("  Sippi ")).toBe("SIPPI");
  });

  it("handles are @-prefixed and untransformed", () => {
    expect(formatHandle("prez")).toBe("@prez");
    expect(formatHandle("BigWinner22")).toBe("@BigWinner22");
  });
});

describe("isPrezAccount — photo exclusivity (plan A2)", () => {
  it("matches only the prez account, case-insensitively", () => {
    expect(isPrezAccount("prez")).toBe(true);
    expect(isPrezAccount("Prez")).toBe(true);
    expect(isPrezAccount("sippi")).toBe(false);
    expect(isPrezAccount("prez2")).toBe(false);
    expect(isPrezAccount(null)).toBe(false);
  });
});

describe("deriveInitials", () => {
  it("uses the first two letters of a single-token username", () => {
    expect(deriveInitials("sippi")).toBe("SI");
  });

  it("uses first + last segment initials for separated usernames", () => {
    expect(deriveInitials("big.winner")).toBe("BW");
    expect(deriveInitials("big_time_bettor")).toBe("BB");
  });

  it("never returns an empty string", () => {
    expect(deriveInitials("")).toBe("?");
    expect(deriveInitials(undefined)).toBe("?");
  });
});

describe("deriveTierLabel", () => {
  it("owners are labeled Owner regardless of plan fields", () => {
    expect(deriveTierLabel(user())).toBe("Owner");
    expect(
      deriveTierLabel(user({ stripePlanId: "monthly", expiryDate: 1 }))
    ).toBe("Owner");
  });

  it("mirrors Profile.tsx plan labels for subscribers", () => {
    expect(
      deriveTierLabel(user({ role: "user", expiryDate: 1, stripePlanId: "annual" }))
    ).toBe("Annual");
    expect(
      deriveTierLabel(user({ role: "user", expiryDate: 1, stripePlanId: "monthly" }))
    ).toBe("Monthly");
    expect(
      deriveTierLabel(user({ role: "user", expiryDate: 1, stripePlanId: "pro" }))
    ).toBe("Pro");
    expect(deriveTierLabel(user({ role: "user" }))).toBe("Lifetime");
    expect(
      deriveTierLabel(user({ role: "user", expiryDate: 1, stripePlanId: null }))
    ).toBe("Active");
  });

  it("is empty for a missing user (neutral loading row)", () => {
    expect(deriveTierLabel(null)).toBe("");
  });
});

describe("formatExpiryLine — no placeholder dates, ever", () => {
  it("formats a real expiry timestamp", () => {
    // 2026-08-08T12:00:00Z — the real field, not the frozen sample string.
    expect(formatExpiryLine(Date.UTC(2026, 7, 8, 12))).toMatch(
      /^Expires August [78], 2026$/ // day depends on the runner's timezone
    );
  });

  it("returns null when the account has no expiry (row hidden)", () => {
    expect(formatExpiryLine(null)).toBeNull();
    expect(formatExpiryLine(undefined)).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(formatExpiryLine(Number.NaN)).toBeNull();
  });
});
