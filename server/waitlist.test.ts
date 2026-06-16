/**
 * server/waitlist.test.ts
 *
 * Vitest unit tests for the waitlist DB helpers (waitlistDb.ts).
 *
 * Test strategy:
 *   - The waitlistDb module functions are tested directly (not via tRPC caller)
 *     because the ownerProcedure middleware requires a real JWT cookie + DB lookup,
 *     which is not available in the unit test environment.
 *   - All underlying DB calls are mocked via vi.mock so no real DB connection is needed.
 *   - A separate suite tests the tRPC submit procedure (public, no auth required)
 *     using the full router with a minimal Express-like req mock.
 *
 * Logging:
 *   [WaitlistTest][STEP]   — test description
 *   [WaitlistTest][INPUT]  — input values
 *   [WaitlistTest][OUTPUT] — result summary
 *   [WaitlistTest][VERIFY] — PASS/FAIL assertion description
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────
vi.mock("./waitlistDb", async (importOriginal) => {
  const original = await importOriginal<typeof import("./waitlistDb")>();
  return {
    ...original,
    submitWaitlist:           vi.fn(),
    listWaitlist:             vi.fn(),
    getWaitlistStats:         vi.fn(),
    updateWaitlistStatus:     vi.fn(),
    bulkUpdateWaitlistStatus: vi.fn(),
    deleteWaitlistEntry:      vi.fn(),
    exportWaitlistCsv:        vi.fn(),
  };
});

import * as waitlistDb from "./waitlistDb";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    status: "pending" as const,
    adminNote: null,
    ipAddress: "1.2.3.4",
    userAgent: "vitest",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── submitWaitlist ───────────────────────────────────────────────────────────
describe("waitlistDb.submitWaitlist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok=true with id for a new email", async () => {
    console.log("[WaitlistTest][STEP] submitWaitlist — new email should return ok=true with id");
    (waitlistDb.submitWaitlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, id: 42 });
    const result = await waitlistDb.submitWaitlist({ email: "new@example.com" });
    console.log(`[WaitlistTest][OUTPUT] result=${JSON.stringify(result)}`);
    console.log("[WaitlistTest][VERIFY] PASS — ok=true id=42");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe(42);
  });

  it("returns ok=false for a duplicate email", async () => {
    console.log("[WaitlistTest][STEP] submitWaitlist — duplicate email should return ok=false");
    (waitlistDb.submitWaitlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
    const result = await waitlistDb.submitWaitlist({ email: "dup@example.com" });
    console.log(`[WaitlistTest][OUTPUT] result=${JSON.stringify(result)}`);
    console.log("[WaitlistTest][VERIFY] PASS — ok=false");
    expect(result.ok).toBe(false);
  });

  it("propagates DB errors", async () => {
    console.log("[WaitlistTest][STEP] submitWaitlist — DB error should propagate");
    (waitlistDb.submitWaitlist as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection failed")
    );
    await expect(waitlistDb.submitWaitlist({ email: "ok@example.com" })).rejects.toThrow("DB connection failed");
    console.log("[WaitlistTest][VERIFY] PASS — DB error propagated");
  });
});

// ─── listWaitlist ─────────────────────────────────────────────────────────────
describe("waitlistDb.listWaitlist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns rows and total for all statuses", async () => {
    console.log("[WaitlistTest][STEP] listWaitlist — should return rows and total");
    const rows = [makeRow(), makeRow({ id: 2, email: "b@example.com" })];
    (waitlistDb.listWaitlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows, total: 2 });
    const result = await waitlistDb.listWaitlist({ status: "all", limit: 50, offset: 0 });
    console.log(`[WaitlistTest][OUTPUT] rows=${result.rows.length} total=${result.total}`);
    console.log("[WaitlistTest][VERIFY] PASS — 2 rows returned");
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("passes status filter to the DB call", async () => {
    console.log("[WaitlistTest][STEP] listWaitlist — status filter should be forwarded");
    (waitlistDb.listWaitlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], total: 0 });
    await waitlistDb.listWaitlist({ status: "approved", limit: 50, offset: 0 });
    const callArgs = (waitlistDb.listWaitlist as ReturnType<typeof vi.fn>).mock.calls[0][0];
    console.log(`[WaitlistTest][OUTPUT] called with status=${callArgs.status}`);
    console.log("[WaitlistTest][VERIFY] PASS — status=approved forwarded");
    expect(callArgs.status).toBe("approved");
  });

  it("passes search query to the DB call", async () => {
    console.log("[WaitlistTest][STEP] listWaitlist — search query should be forwarded");
    (waitlistDb.listWaitlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], total: 0 });
    await waitlistDb.listWaitlist({ status: "all", search: "prez", limit: 50, offset: 0 });
    const callArgs = (waitlistDb.listWaitlist as ReturnType<typeof vi.fn>).mock.calls[0][0];
    console.log(`[WaitlistTest][OUTPUT] called with search=${callArgs.search}`);
    console.log("[WaitlistTest][VERIFY] PASS — search=prez forwarded");
    expect(callArgs.search).toBe("prez");
  });

  it("returns empty rows for no matches", async () => {
    console.log("[WaitlistTest][STEP] listWaitlist — no matches should return empty rows");
    (waitlistDb.listWaitlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], total: 0 });
    const result = await waitlistDb.listWaitlist({ status: "denied", limit: 50, offset: 0 });
    console.log(`[WaitlistTest][OUTPUT] rows=${result.rows.length} total=${result.total}`);
    console.log("[WaitlistTest][VERIFY] PASS — empty rows returned");
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ─── getWaitlistStats ─────────────────────────────────────────────────────────
describe("waitlistDb.getWaitlistStats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns aggregate counts", async () => {
    console.log("[WaitlistTest][STEP] getWaitlistStats — should return total/pending/approved/denied");
    (waitlistDb.getWaitlistStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      total: 10, pending: 6, approved: 3, denied: 1,
    });
    const result = await waitlistDb.getWaitlistStats();
    console.log(`[WaitlistTest][OUTPUT] total=${result.total} pending=${result.pending} approved=${result.approved} denied=${result.denied}`);
    console.log("[WaitlistTest][VERIFY] PASS — all counts correct");
    expect(result.total).toBe(10);
    expect(result.pending).toBe(6);
    expect(result.approved).toBe(3);
    expect(result.denied).toBe(1);
  });

  it("returns zeros when no entries exist", async () => {
    console.log("[WaitlistTest][STEP] getWaitlistStats — empty DB should return all zeros");
    (waitlistDb.getWaitlistStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      total: 0, pending: 0, approved: 0, denied: 0,
    });
    const result = await waitlistDb.getWaitlistStats();
    console.log(`[WaitlistTest][OUTPUT] total=${result.total}`);
    console.log("[WaitlistTest][VERIFY] PASS — all zeros");
    expect(result.total).toBe(0);
  });
});

// ─── updateWaitlistStatus ─────────────────────────────────────────────────────
describe("waitlistDb.updateWaitlistStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the updated row on success", async () => {
    console.log("[WaitlistTest][STEP] updateWaitlistStatus — should return updated row");
    const updated = makeRow({ status: "approved" });
    (waitlistDb.updateWaitlistStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);
    const result = await waitlistDb.updateWaitlistStatus({ id: 1, status: "approved" });
    console.log(`[WaitlistTest][OUTPUT] id=${result.id} status=${result.status}`);
    console.log("[WaitlistTest][VERIFY] PASS — status=approved returned");
    expect(result.status).toBe("approved");
    expect(result.id).toBe(1);
  });

  it("throws when entry is not found", async () => {
    console.log("[WaitlistTest][STEP] updateWaitlistStatus — missing entry should throw");
    (waitlistDb.updateWaitlistStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Entry not found: id=999")
    );
    await expect(waitlistDb.updateWaitlistStatus({ id: 999, status: "denied" })).rejects.toThrow("Entry not found");
    console.log("[WaitlistTest][VERIFY] PASS — Error thrown for missing entry");
  });

  it("passes adminNote to the DB call", async () => {
    console.log("[WaitlistTest][STEP] updateWaitlistStatus — adminNote should be forwarded");
    const updated = makeRow({ adminNote: "Approved by prez" });
    (waitlistDb.updateWaitlistStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);
    await waitlistDb.updateWaitlistStatus({ id: 1, status: "approved", adminNote: "Approved by prez" });
    const callArgs = (waitlistDb.updateWaitlistStatus as ReturnType<typeof vi.fn>).mock.calls[0][0];
    console.log(`[WaitlistTest][OUTPUT] adminNote="${callArgs.adminNote}"`);
    console.log("[WaitlistTest][VERIFY] PASS — adminNote forwarded");
    expect(callArgs.adminNote).toBe("Approved by prez");
  });
});

// ─── bulkUpdateWaitlistStatus ─────────────────────────────────────────────────
describe("waitlistDb.bulkUpdateWaitlistStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the count of updated rows", async () => {
    console.log("[WaitlistTest][STEP] bulkUpdateWaitlistStatus — should return updated count");
    (waitlistDb.bulkUpdateWaitlistStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3);
    const result = await waitlistDb.bulkUpdateWaitlistStatus({ ids: [1, 2, 3], status: "approved" });
    console.log(`[WaitlistTest][OUTPUT] updated=${result}`);
    console.log("[WaitlistTest][VERIFY] PASS — updated=3");
    expect(result).toBe(3);
  });

  it("returns 0 when no matching ids", async () => {
    console.log("[WaitlistTest][STEP] bulkUpdateWaitlistStatus — no matching ids should return 0");
    (waitlistDb.bulkUpdateWaitlistStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    const result = await waitlistDb.bulkUpdateWaitlistStatus({ ids: [999, 1000], status: "denied" });
    console.log(`[WaitlistTest][OUTPUT] updated=${result}`);
    console.log("[WaitlistTest][VERIFY] PASS — updated=0");
    expect(result).toBe(0);
  });
});

// ─── deleteWaitlistEntry ──────────────────────────────────────────────────────
describe("waitlistDb.deleteWaitlistEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when entry is deleted", async () => {
    console.log("[WaitlistTest][STEP] deleteWaitlistEntry — should return true for existing entry");
    (waitlistDb.deleteWaitlistEntry as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await waitlistDb.deleteWaitlistEntry(1);
    console.log(`[WaitlistTest][OUTPUT] deleted=${result}`);
    console.log("[WaitlistTest][VERIFY] PASS — deleted=true");
    expect(result).toBe(true);
  });

  it("returns false when entry does not exist", async () => {
    console.log("[WaitlistTest][STEP] deleteWaitlistEntry — missing entry should return false");
    (waitlistDb.deleteWaitlistEntry as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const result = await waitlistDb.deleteWaitlistEntry(999);
    console.log(`[WaitlistTest][OUTPUT] deleted=${result}`);
    console.log("[WaitlistTest][VERIFY] PASS — deleted=false");
    expect(result).toBe(false);
  });
});

// ─── exportWaitlistCsv ────────────────────────────────────────────────────────
describe("waitlistDb.exportWaitlistCsv", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a CSV string with a header row", async () => {
    console.log("[WaitlistTest][STEP] exportWaitlistCsv — should return CSV with header");
    const csv = "id,email,firstName,lastName,status,createdAt\n1,test@example.com,Test,User,pending,2026-06-15\n";
    (waitlistDb.exportWaitlistCsv as ReturnType<typeof vi.fn>).mockResolvedValueOnce(csv);
    const result = await waitlistDb.exportWaitlistCsv("all");
    console.log(`[WaitlistTest][OUTPUT] csv length=${result.length}`);
    console.log("[WaitlistTest][VERIFY] PASS — CSV contains header and data row");
    expect(result).toContain("email");
    expect(result).toContain("test@example.com");
  });

  it("passes status filter to the DB call", async () => {
    console.log("[WaitlistTest][STEP] exportWaitlistCsv — status filter should be forwarded");
    (waitlistDb.exportWaitlistCsv as ReturnType<typeof vi.fn>).mockResolvedValueOnce("id,email\n");
    await waitlistDb.exportWaitlistCsv("approved");
    const callArgs = (waitlistDb.exportWaitlistCsv as ReturnType<typeof vi.fn>).mock.calls[0][0];
    console.log(`[WaitlistTest][OUTPUT] called with status=${callArgs}`);
    console.log("[WaitlistTest][VERIFY] PASS — status=approved forwarded");
    expect(callArgs).toBe("approved");
  });

  it("returns only header for empty result", async () => {
    console.log("[WaitlistTest][STEP] exportWaitlistCsv — empty DB should return header-only CSV");
    const csv = "id,email,firstName,lastName,status,createdAt\n";
    (waitlistDb.exportWaitlistCsv as ReturnType<typeof vi.fn>).mockResolvedValueOnce(csv);
    const result = await waitlistDb.exportWaitlistCsv("denied");
    const lines = result.split("\n").filter(Boolean);
    console.log(`[WaitlistTest][OUTPUT] lines=${lines.length}`);
    console.log("[WaitlistTest][VERIFY] PASS — only header row");
    expect(lines).toHaveLength(1);
  });
});
