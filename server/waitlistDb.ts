/**
 * waitlistDb.ts
 *
 * All database helpers for the `waitlist` table.
 *
 * Logging convention (noise-free, structured):
 *   [WaitlistDB][STEP]   — operation description
 *   [WaitlistDB][INPUT]  — validated input values
 *   [WaitlistDB][OUTPUT] — result summary
 *   [WaitlistDB][ERROR]  — error with context
 *   [WaitlistDB][VERIFY] — PASS/FAIL + reason
 */

import { and, asc, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { waitlist, type WaitlistRow, type InsertWaitlist } from "../drizzle/schema";
import { ENV } from "./_core/env";

// ─── DB connection (dedicated pool for waitlist module) ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
let _pool: mysql.Pool | null = null;

function getDb() {
  if (_db) return _db as ReturnType<typeof drizzle>;
  console.log("[WaitlistDB][STEP] Initialising MySQL pool for waitlist module");
  _pool = mysql.createPool(ENV.databaseUrl);
  _db = drizzle(_pool);
  console.log("[WaitlistDB][VERIFY] PASS — pool initialised");
  return _db as ReturnType<typeof drizzle>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type WaitlistStatus = "pending" | "approved" | "denied";

export interface WaitlistFilters {
  status?: WaitlistStatus | "all";
  search?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "email" | "status";
  sortDir?: "asc" | "desc";
}

export interface WaitlistListResult {
  rows: WaitlistRow[];
  total: number;
}

export interface WaitlistStats {
  total: number;
  pending: number;
  approved: number;
  denied: number;
}

// ─── submitWaitlist ───────────────────────────────────────────────────────────

export async function submitWaitlist(input: {
  email: string;
  firstName?: string;
  lastName?: string;
  ipAddress?: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "duplicate" }> {
  const db = getDb();
  const now = Date.now();
  const normalizedEmail = input.email.toLowerCase().trim();

  console.log(`[WaitlistDB][STEP] submitWaitlist — email=${normalizedEmail}`);
  console.log(`[WaitlistDB][INPUT] firstName=${input.firstName ?? "(none)"} lastName=${input.lastName ?? "(none)"} ip=${input.ipAddress ?? "(none)"} utmSource=${input.utmSource ?? "(none)"}`);

  // ── Duplicate check ──────────────────────────────────────────────────────
  const existing = await db
    .select({ id: waitlist.id, status: waitlist.status })
    .from(waitlist)
    .where(eq(waitlist.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    console.log(`[WaitlistDB][VERIFY] FAIL — duplicate email=${normalizedEmail} existingId=${existing[0].id} existingStatus=${existing[0].status}`);
    return { ok: false, reason: "duplicate" };
  }

  // ── Insert ───────────────────────────────────────────────────────────────
  const row: InsertWaitlist = {
    email:       normalizedEmail,
    firstName:   input.firstName?.trim() || null,
    lastName:    input.lastName?.trim() || null,
    status:      "pending",
    ipAddress:   input.ipAddress ?? null,
    userAgent:   input.userAgent?.slice(0, 512) ?? null,
    utmSource:   input.utmSource ?? null,
    utmMedium:   input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    createdAt:   now,
    updatedAt:   now,
  };

  const result = await db.insert(waitlist).values(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertId: number = (result[0] as any).insertId ?? 0;

  console.log(`[WaitlistDB][OUTPUT] submitWaitlist — INSERTED id=${insertId} email=${normalizedEmail} ts=${now}`);
  console.log(`[WaitlistDB][VERIFY] PASS — waitlist entry created id=${insertId}`);

  return { ok: true, id: insertId };
}

// ─── listWaitlist ─────────────────────────────────────────────────────────────

export async function listWaitlist(filters: WaitlistFilters = {}): Promise<WaitlistListResult> {
  const db = getDb();
  const {
    status = "all",
    search,
    fromTs,
    toTs,
    limit = 50,
    offset = 0,
    sortBy = "createdAt",
    sortDir = "desc",
  } = filters;

  console.log(`[WaitlistDB][STEP] listWaitlist — status=${status} search=${search ?? "(none)"} limit=${limit} offset=${offset} sortBy=${sortBy} sortDir=${sortDir}`);

  // ── Build WHERE conditions ───────────────────────────────────────────────
  const conditions: ReturnType<typeof eq>[] = [];

  if (status !== "all") {
    conditions.push(eq(waitlist.status, status));
  }

  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim()}%`;
    conditions.push(
      or(
        like(waitlist.email, pattern),
        like(waitlist.firstName, pattern),
        like(waitlist.lastName, pattern),
      ) as ReturnType<typeof eq>
    );
  }

  if (fromTs !== undefined) {
    conditions.push(gte(waitlist.createdAt, fromTs) as ReturnType<typeof eq>);
  }

  if (toTs !== undefined) {
    conditions.push(lte(waitlist.createdAt, toTs) as ReturnType<typeof eq>);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // ── Count query ──────────────────────────────────────────────────────────
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .where(whereClause);

  const total = Number(countResult[0]?.count ?? 0);

  // ── Data query ───────────────────────────────────────────────────────────
  const orderCol =
    sortBy === "email"  ? waitlist.email  :
    sortBy === "status" ? waitlist.status :
    waitlist.createdAt;

  const orderFn = sortDir === "asc" ? asc(orderCol) : desc(orderCol);

  const rows = await db
    .select()
    .from(waitlist)
    .where(whereClause)
    .orderBy(orderFn)
    .limit(limit)
    .offset(offset);

  console.log(`[WaitlistDB][OUTPUT] listWaitlist — total=${total} returned=${rows.length} offset=${offset}`);
  console.log(`[WaitlistDB][VERIFY] PASS — listWaitlist complete`);

  return { rows, total };
}

// ─── getWaitlistById ──────────────────────────────────────────────────────────

export async function getWaitlistById(id: number): Promise<WaitlistRow | null> {
  const db = getDb();
  console.log(`[WaitlistDB][STEP] getWaitlistById — id=${id}`);

  const rows = await db
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, id))
    .limit(1);

  if (rows.length === 0) {
    console.log(`[WaitlistDB][VERIFY] FAIL — id=${id} not found`);
    return null;
  }

  console.log(`[WaitlistDB][VERIFY] PASS — id=${id} found email=${rows[0].email}`);
  return rows[0];
}

// ─── updateWaitlistStatus ─────────────────────────────────────────────────────

export async function updateWaitlistStatus(input: {
  id: number;
  status: WaitlistStatus;
  adminNote?: string;
  reviewedBy: number;
}): Promise<WaitlistRow> {
  const db = getDb();
  const now = Date.now();

  console.log(`[WaitlistDB][STEP] updateWaitlistStatus — id=${input.id} newStatus=${input.status} reviewedBy=${input.reviewedBy}`);
  console.log(`[WaitlistDB][INPUT] adminNote=${input.adminNote ? `"${input.adminNote.slice(0, 80)}"` : "(none)"}`);

  const existing = await getWaitlistById(input.id);
  if (!existing) {
    console.log(`[WaitlistDB][ERROR] updateWaitlistStatus — id=${input.id} not found`);
    throw new Error(`Waitlist entry id=${input.id} not found`);
  }

  const prevStatus = existing.status;

  await db
    .update(waitlist)
    .set({
      status:     input.status,
      adminNote:  input.adminNote !== undefined ? input.adminNote.slice(0, 1024) : existing.adminNote,
      reviewedAt: now,
      reviewedBy: input.reviewedBy,
      updatedAt:  now,
    })
    .where(eq(waitlist.id, input.id));

  const updated = await getWaitlistById(input.id);
  if (!updated) throw new Error(`[WaitlistDB] Post-update fetch failed for id=${input.id}`);

  console.log(`[WaitlistDB][OUTPUT] updateWaitlistStatus — id=${input.id} email=${updated.email} ${prevStatus} → ${updated.status} reviewedAt=${now}`);
  console.log(`[WaitlistDB][VERIFY] PASS — status updated`);

  return updated;
}

// ─── bulkUpdateWaitlistStatus ─────────────────────────────────────────────────

export async function bulkUpdateWaitlistStatus(input: {
  ids: number[];
  status: WaitlistStatus;
  reviewedBy: number;
}): Promise<number> {
  const db = getDb();
  const now = Date.now();

  console.log(`[WaitlistDB][STEP] bulkUpdateWaitlistStatus — count=${input.ids.length} newStatus=${input.status} reviewedBy=${input.reviewedBy}`);

  if (input.ids.length === 0) {
    console.log(`[WaitlistDB][VERIFY] PASS — no ids provided, 0 rows updated`);
    return 0;
  }

  const validIds = input.ids.filter((id) => Number.isInteger(id) && id > 0);
  if (validIds.length !== input.ids.length) {
    console.log(`[WaitlistDB][ERROR] bulkUpdateWaitlistStatus — ${input.ids.length - validIds.length} invalid ids filtered out`);
  }

  let updated = 0;
  for (const id of validIds) {
    await db
      .update(waitlist)
      .set({ status: input.status, reviewedAt: now, reviewedBy: input.reviewedBy, updatedAt: now })
      .where(eq(waitlist.id, id));
    updated++;
  }

  console.log(`[WaitlistDB][OUTPUT] bulkUpdateWaitlistStatus — updated=${updated}/${validIds.length} status=${input.status}`);
  console.log(`[WaitlistDB][VERIFY] PASS — bulk update complete`);

  return updated;
}

// ─── deleteWaitlistEntry ──────────────────────────────────────────────────────

export async function deleteWaitlistEntry(id: number): Promise<boolean> {
  const db = getDb();
  console.log(`[WaitlistDB][STEP] deleteWaitlistEntry — id=${id}`);

  const existing = await getWaitlistById(id);
  if (!existing) {
    console.log(`[WaitlistDB][VERIFY] FAIL — id=${id} not found, nothing deleted`);
    return false;
  }

  await db.delete(waitlist).where(eq(waitlist.id, id));

  console.log(`[WaitlistDB][OUTPUT] deleteWaitlistEntry — DELETED id=${id} email=${existing.email}`);
  console.log(`[WaitlistDB][VERIFY] PASS — entry deleted`);

  return true;
}

// ─── getWaitlistStats ─────────────────────────────────────────────────────────

export async function getWaitlistStats(): Promise<WaitlistStats> {
  const db = getDb();
  console.log(`[WaitlistDB][STEP] getWaitlistStats`);

  const result = await db
    .select({ status: waitlist.status, count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .groupBy(waitlist.status);

  const stats: WaitlistStats = { total: 0, pending: 0, approved: 0, denied: 0 };

  for (const row of result) {
    const n = Number(row.count);
    stats.total += n;
    if (row.status === "pending")  stats.pending  = n;
    if (row.status === "approved") stats.approved = n;
    if (row.status === "denied")   stats.denied   = n;
  }

  console.log(`[WaitlistDB][OUTPUT] getWaitlistStats — total=${stats.total} pending=${stats.pending} approved=${stats.approved} denied=${stats.denied}`);
  console.log(`[WaitlistDB][VERIFY] PASS — stats computed`);

  return stats;
}

// ─── exportWaitlistCsv ────────────────────────────────────────────────────────

export async function exportWaitlistCsv(status?: WaitlistStatus | "all"): Promise<string> {
  const db = getDb();
  console.log(`[WaitlistDB][STEP] exportWaitlistCsv — status=${status ?? "all"}`);

  const whereClause =
    status && status !== "all" ? eq(waitlist.status, status) : undefined;

  const rows = await db
    .select()
    .from(waitlist)
    .where(whereClause)
    .orderBy(asc(waitlist.createdAt));

  const headers = [
    "id", "email", "firstName", "lastName", "status",
    "adminNote", "ipAddress", "utmSource", "utmMedium", "utmCampaign",
    "reviewedAt", "createdAt", "updatedAt",
  ];

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.id, r.email, r.firstName, r.lastName, r.status,
        r.adminNote, r.ipAddress, r.utmSource, r.utmMedium, r.utmCampaign,
        r.reviewedAt, r.createdAt, r.updatedAt,
      ]
        .map(escape)
        .join(",")
    ),
  ];

  const csv = "\uFEFF" + lines.join("\n");

  console.log(`[WaitlistDB][OUTPUT] exportWaitlistCsv — rows=${rows.length} bytes=${csv.length}`);
  console.log(`[WaitlistDB][VERIFY] PASS — CSV generated`);

  return csv;
}
