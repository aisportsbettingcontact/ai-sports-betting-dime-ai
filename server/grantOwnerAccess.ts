/**
 * grantOwnerAccess.ts — single-target grant of OWNER access to @prez.
 *
 * Restores the documented platform owner (@prez — see dimeModelAccess.ts and
 * betTracker.ts, which both treat "prez (owner)" as canonical) to
 * role="owner" + hasAccess=true so he can reach the User Management admin page
 * (/admin/users). That page is gated by role==="owner" both client-side
 * (redirect in UserManagement.tsx) and server-side (appUsers.* = ownerProcedure).
 *
 * Runs server-side (Railway) against the SAME production DB the app
 * authenticates prez against. Because ownerProcedure and appUsers.me both read
 * `role` from the DB fresh (the JWT `role` claim is logged for audit but NOT
 * used for the decision — see appUsers.ts), flipping his DB role to "owner"
 * grants his LIVE session access with no forced re-login. updateAppUser
 * invalidates both user caches, so the change propagates on his next request.
 *
 * ── SCOPE GUARANTEE ─────────────────────────────────────────────────────────
 * The target is HARDCODED to @prez (PREZ_EMAIL / PREZ_USERNAME below). There is
 * NO caller-supplied id/email/username anywhere in this path — the only input is
 * a boolean `dryRun`. This endpoint can therefore ONLY ever touch prez's record;
 * it cannot be used to escalate any other account. (The owner explicitly scoped
 * this to "only @prez".)
 *
 * Wired to POST /api/cron/grant-owner (CRON_SECRET) in cron/cronRoutes.ts and
 * driven by the grant-owner-prez.yml GitHub Actions workflow.
 *
 *   dryRun=true  → look up prez, report his current record + pending changes, write nothing
 *   dryRun=false → set role="owner" + hasAccess=true (clear a past expiry), re-read, audit
 */
import {
  getAppUserByEmail,
  getAppUserByUsername,
  getAppUserById,
  updateAppUser,
} from "./db";

const TAG = "[GrantOwner:prez]";

/**
 * HARDCODED, single-target scope. These are the ONLY selectors this module ever
 * uses to locate a user — no value flows in from the request. The email is the
 * owner's account email (CLAUDE.md userEmail); the username is the "@prez" handle
 * documented throughout the codebase as the owner.
 */
export const PREZ_EMAIL = "prez@aisportsbettingmodels.com";
export const PREZ_USERNAME = "prez";

export interface GrantOwnerCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Redacted, safe-to-log snapshot of prez's record (no password hash, no tokens). */
export interface PrezSnapshot {
  id: number;
  email: string;
  username: string;
  role: string;
  hasAccess: boolean;
  expiryDate: number | null;
  tokenVersion: number | null;
  lastSignedIn: string | null;
}

export interface GrantOwnerResult {
  dryRun: boolean;
  wrote: boolean;
  found: boolean;
  /** "email+username" | "email" | "username" | "none" | "ambiguous" */
  matchedBy: string;
  before: PrezSnapshot | null;
  after: PrezSnapshot | null;
  /** Field names that changed (real run) or would change (dry run). */
  changes: string[];
  audit: { pass: boolean; checks: GrantOwnerCheck[] };
  tail: string;
}

type AppUserRecord = NonNullable<Awaited<ReturnType<typeof getAppUserById>>>;

function snap(u: AppUserRecord): PrezSnapshot {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    hasAccess: !!u.hasAccess,
    expiryDate: u.expiryDate ?? null,
    tokenVersion: u.tokenVersion ?? null,
    lastSignedIn: u.lastSignedIn ? new Date(u.lastSignedIn).toISOString() : null,
  };
}

/** True when an expiry would actually BLOCK access (set and already in the past). */
function expiryBlocks(expiryDate: number | null, now: number): boolean {
  return expiryDate != null && now > expiryDate;
}

/** Compute the minimal field changes needed to give prez durable owner access. */
function planChanges(s: PrezSnapshot, now: number): { updateData: Record<string, unknown>; changes: string[] } {
  const updateData: Record<string, unknown> = {};
  const changes: string[] = [];
  if (s.role !== "owner") {
    updateData.role = "owner";
    changes.push(`role: ${s.role} → owner`);
  }
  if (s.hasAccess !== true) {
    updateData.hasAccess = true;
    changes.push(`hasAccess: ${s.hasAccess} → true`);
  }
  // Only clear an expiry that would actually block him (past). A future expiry
  // doesn't gate access, so leave it untouched (minimal change).
  if (expiryBlocks(s.expiryDate, now)) {
    updateData.expiryDate = null;
    changes.push(`expiryDate: ${new Date(s.expiryDate as number).toISOString()} (expired) → lifetime`);
  }
  return { updateData, changes };
}

function buildTail(r: Omit<GrantOwnerResult, "tail">): string {
  const lines: string[] = [];
  lines.push(`Grant OWNER → @prez  (${r.dryRun ? "DRY RUN — nothing written" : r.wrote ? "APPLIED" : "no change needed"})`);
  lines.push(`  matchedBy=${r.matchedBy} found=${r.found}`);
  if (r.before) {
    const b = r.before;
    lines.push(`  BEFORE: id=${b.id} @${b.username} <${b.email}> role=${b.role} hasAccess=${b.hasAccess} expiry=${b.expiryDate ?? "lifetime"}`);
  }
  if (r.changes.length) {
    lines.push(`  CHANGES: ${r.changes.join("  |  ")}`);
  } else if (r.found) {
    lines.push(`  CHANGES: none — already role=owner + hasAccess=true (access issue is not a role problem)`);
  }
  if (r.after) {
    const a = r.after;
    lines.push(`  AFTER:  id=${a.id} @${a.username} <${a.email}> role=${a.role} hasAccess=${a.hasAccess} expiry=${a.expiryDate ?? "lifetime"}`);
  }
  return lines.join("\n");
}

/**
 * Locate prez by the two hardcoded selectors and grant owner access.
 *
 * Ambiguity guard: if email and username resolve to DIFFERENT records, we STOP
 * and report both — never guess which one is the real owner.
 */
export async function runGrantOwnerPrez(opts: { dryRun: boolean }): Promise<GrantOwnerResult> {
  const say = (s: string) => console.log(`${TAG} ${s}`);
  const now = Date.now();

  // 1. Locate prez via the two hardcoded selectors (no caller input involved).
  const [byEmail, byUsername] = await Promise.all([
    getAppUserByEmail(PREZ_EMAIL),
    getAppUserByUsername(PREZ_USERNAME),
  ]);

  // Dedupe by id — the two lookups usually point at the same record.
  const candidates = [byEmail, byUsername].filter(Boolean) as AppUserRecord[];
  const uniqueById = new Map<number, AppUserRecord>();
  for (const c of candidates) uniqueById.set(c.id, c);

  // ── Not found ───────────────────────────────────────────────────────────────
  if (uniqueById.size === 0) {
    const base = {
      dryRun: opts.dryRun, wrote: false, found: false, matchedBy: "none",
      before: null, after: null, changes: [] as string[],
      audit: { pass: false, checks: [{ name: "prez record located", ok: false, detail: `no user with email=${PREZ_EMAIL} or username=${PREZ_USERNAME}` }] },
    };
    const tail = buildTail(base);
    say(`NOT FOUND — no record for email=${PREZ_EMAIL} or username=${PREZ_USERNAME}. Cannot grant.`);
    return { ...base, tail };
  }

  // ── Ambiguous: email and username resolve to two different records ────────────
  if (uniqueById.size > 1) {
    const both = Array.from(uniqueById.values()).map(snap);
    const base = {
      dryRun: opts.dryRun, wrote: false, found: false, matchedBy: "ambiguous",
      before: null, after: null, changes: [] as string[],
      audit: {
        pass: false,
        checks: [{
          name: "prez record unambiguous",
          ok: false,
          detail: `email → id=${both.map((b) => b.id).join(", ")} differ; refusing to guess`,
        }],
      },
    };
    const tail = [
      buildTail(base),
      ...both.map((b) => `  candidate: id=${b.id} @${b.username} <${b.email}> role=${b.role} hasAccess=${b.hasAccess}`),
    ].join("\n");
    say(`AMBIGUOUS — email and username resolve to different records; refusing to write.`);
    return { ...base, tail };
  }

  // ── Exactly one record ────────────────────────────────────────────────────────
  const user = Array.from(uniqueById.values())[0];
  const matchedBy =
    byEmail && byUsername ? "email+username" : byEmail ? "email" : "username";
  const before = snap(user);
  const { updateData, changes } = planChanges(before, now);
  say(`located id=${before.id} @${before.username} <${before.email}> role=${before.role} hasAccess=${before.hasAccess} expiry=${before.expiryDate ?? "lifetime"} (matchedBy=${matchedBy})`);

  // ── Dry run: report, write nothing. Pass = we found a single record. ─────────
  if (opts.dryRun) {
    const base = {
      dryRun: true, wrote: false, found: true, matchedBy,
      before, after: null, changes,
      audit: {
        pass: true,
        checks: [
          { name: "prez record located (single)", ok: true, detail: `id=${before.id} @${before.username}` },
          { name: "role already owner", ok: before.role === "owner", detail: before.role },
          { name: "hasAccess already true", ok: before.hasAccess === true, detail: String(before.hasAccess) },
          { name: "expiry not blocking", ok: !expiryBlocks(before.expiryDate, now), detail: before.expiryDate ? new Date(before.expiryDate).toISOString() : "lifetime" },
        ],
      },
    };
    const tail = buildTail(base);
    say(`DRY RUN — pending changes: ${changes.length ? changes.join("; ") : "none (already owner + access)"}`);
    return { ...base, tail };
  }

  // ── Real run: apply the minimal change (if any), re-read, audit. ─────────────
  let wrote = false;
  if (Object.keys(updateData).length > 0) {
    await updateAppUser(before.id, updateData as Parameters<typeof updateAppUser>[1]);
    wrote = true;
    say(`WROTE id=${before.id} fields=${JSON.stringify(Object.keys(updateData))}`);
  } else {
    say(`no write — @${before.username} is already role=owner + hasAccess=true and not expired`);
  }

  // Re-read (getAppUserByEmail bypasses the id cache entirely; updateAppUser also
  // invalidated both caches) so the audit reflects committed DB state.
  const reread = (await getAppUserByEmail(before.email)) ?? (await getAppUserById(before.id));
  const after = reread ? snap(reread) : null;

  const checks: GrantOwnerCheck[] = [
    { name: "same record (id unchanged)", ok: after?.id === before.id, detail: `${before.id} → ${after?.id ?? "?"}` },
    { name: "role === owner", ok: after?.role === "owner", detail: after?.role ?? "?" },
    { name: "hasAccess === true", ok: after?.hasAccess === true, detail: String(after?.hasAccess) },
    { name: "expiry not blocking", ok: after ? !expiryBlocks(after.expiryDate, now) : false, detail: after?.expiryDate ? new Date(after.expiryDate).toISOString() : "lifetime" },
  ];
  const audit = { pass: checks.every((c) => c.ok), checks };

  const base = { dryRun: false, wrote, found: true, matchedBy, before, after, changes };
  const tail = buildTail({ ...base, audit });
  say(`AUDIT ${audit.pass ? "PASS" : "FAIL"} — ${checks.filter((c) => c.ok).length}/${checks.length} ok`);
  if (!audit.pass) for (const c of checks.filter((c) => !c.ok)) say(`  ✗ ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  say(`\n${tail}`);

  return { ...base, audit, tail };
}
