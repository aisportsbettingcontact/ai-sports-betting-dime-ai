/**
 * discordRoleSync.ts
 *
 * Single source of truth for Discord role assignment and revocation.
 *
 * Desired-state engine since 2026-08-03: server/discord/roleMap.ts computes the
 * full set of roles a member should hold (baseline DIME_AI_SUB + legacy
 * AI_MODEL_SUB, the plan role for their stripePlanId, DIME_AI_TEAM for
 * owners/admins), this module diffs that against the member's actual guild
 * roles and applies ONLY the difference — and ONLY within the registry's
 * managed set, so hand-granted Discord roles are never touched.
 *
 * All code paths (webhook fulfillment, Discord OAuth callback, admin
 * updateUser/syncDiscordRole, account-setup completion) MUST call
 * syncDiscordRole()/syncDiscordRoleForUser() from here — never duplicate role
 * logic elsewhere.
 *
 * ── Entitlement rules (roleMap.computeDesiredRoleIds) ────────────────────────
 * Roles are held ONLY while: hasAccess === true AND (expiryDate NULL or in the
 * future) AND pendingSetup !== true AND discordId is linked. A caller passing
 * shouldHaveRole=false forces full revocation of managed roles (the webhook
 * revoke path syncs with a row read before its own DB update).
 *
 * ── Discord REST API ─────────────────────────────────────────────────────────
 * GET    /guilds/{g}/members/{uid}            → current roles
 * PUT    /guilds/{g}/members/{uid}/roles/{r}  → grant   (204)
 * DELETE /guilds/{g}/members/{uid}/roles/{r}  → revoke  (204)
 * 404 on the member GET = not in guild (skip, not an error).
 */

import { ENV } from "../_core/env";
import { getAppUserById } from "../db";
import {
  computeDesiredRoleIds,
  managedRoleIds,
  parseRoleRegistry,
  type RoleMapUser,
  type RoleRegistry,
} from "./roleMap";

const TAG = "[DiscordRoleSync]";
const DISCORD_API_BASE = "https://discord.com/api/v10";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncResult =
  | {
      success: true;
      action: "granted" | "revoked" | "skipped";
      reason: string;
      /** Role IDs actually added / removed this call (multi-role engine). */
      grantedRoleIds?: string[];
      revokedRoleIds?: string[];
    }
  | { success: false; action: "error"; reason: string; statusCode?: number };

/** Registry is env-derived; read lazily so tests can stub process.env. */
function loadRegistry(): RoleRegistry {
  return parseRoleRegistry(process.env as Record<string, string | undefined>);
}

// ─── Core engine ──────────────────────────────────────────────────────────────

interface SyncUser extends RoleMapUser {
  id: number;
  username: string;
  discordId: string | null;
}

async function discordApi(path: string, init: RequestInit = {}): Promise<Response> {
  // Headers are merged LAST so an init.headers entry (audit-log reason) can
  // never displace Authorization — the exact bug class that 401'd the
  // 2026-08-03 rollout script.
  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${ENV.discordBotToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function reconcileRoles(
  user: SyncUser,
  shouldHaveRole: boolean,
  requestId: string,
): Promise<SyncResult> {
  const botToken = ENV.discordBotToken;
  const guildId = ENV.discordGuildId;

  if (!botToken || !guildId) {
    const missing = [!botToken && "DISCORD_BOT_TOKEN", !guildId && "DISCORD_GUILD_ID"]
      .filter(Boolean)
      .join(", ");
    console.warn(`${TAG}[reconcile] [STATE] requestId=${requestId} SKIPPED — missing env: ${missing}`);
    return { success: true, action: "skipped", reason: `Missing env vars: ${missing}` };
  }

  const registry = loadRegistry();
  const managed = managedRoleIds(registry);
  if (managed.size === 0) {
    console.warn(`${TAG}[reconcile] [STATE] requestId=${requestId} SKIPPED — role registry empty (no DIME_AI_*/DISCORD_ROLE_AI_MODEL_SUB set)`);
    return { success: true, action: "skipped", reason: "Role registry empty" };
  }

  if (!user.discordId) {
    console.log(`${TAG}[reconcile] [STATE] requestId=${requestId} userId=${user.id} SKIPPED — discordId is null`);
    return { success: true, action: "skipped", reason: "Discord not linked" };
  }

  // shouldHaveRole=false forces revocation (stale-row callers); true defers to
  // the row's own guards (pendingSetup, expiry) inside computeDesiredRoleIds.
  const desired = computeDesiredRoleIds(user, registry, Date.now(), shouldHaveRole ? undefined : false);

  if (desired.size > 0 && user.pendingSetup === true) {
    // Unreachable (computeDesiredRoleIds guards it) — belt-and-braces logging
    // parity with the pre-engine behaviour.
    return { success: true, action: "skipped", reason: "Account pending setup" };
  }

  // ── Current state ───────────────────────────────────────────────────────────
  const memberRes = await discordApi(`/guilds/${guildId}/members/${user.discordId}`).catch((err: unknown) => {
    console.error(`${TAG}[reconcile] [VERIFY] FAIL requestId=${requestId} network error: ${(err as Error)?.message ?? String(err)}`);
    return null;
  });
  if (!memberRes) return { success: false, action: "error", reason: "Discord API network error" };
  if (memberRes.status === 404) {
    console.warn(`${TAG}[reconcile] [STATE] requestId=${requestId} userId=${user.id} SKIPPED — not in guild (HTTP 404)`);
    return { success: true, action: "skipped", reason: "User not in Discord guild (HTTP 404) — they must join the server first" };
  }
  if (!memberRes.ok) {
    const body = await memberRes.text().catch(() => "");
    console.error(`${TAG}[reconcile] [VERIFY] FAIL requestId=${requestId} member fetch HTTP ${memberRes.status}: ${body.slice(0, 200)}`);
    return { success: false, action: "error", reason: `Discord API error HTTP ${memberRes.status}`, statusCode: memberRes.status };
  }
  const member = (await memberRes.json()) as { roles?: string[] };
  const have = new Set(member.roles ?? []);

  // ── Diff, restricted to the managed set ────────────────────────────────────
  const toGrant = Array.from(desired).filter((r) => !have.has(r));
  const toRevoke = Array.from(have).filter((r) => managed.has(r) && !desired.has(r));

  console.log(
    `${TAG}[reconcile] [STATE] requestId=${requestId} userId=${user.id} username=${user.username}` +
    ` plan=${user.stripePlanId ?? "none"} role=${user.role} shouldHaveRole=${shouldHaveRole}` +
    ` desired=${desired.size} have=${have.size} toGrant=${toGrant.length} toRevoke=${toRevoke.length}`
  );

  if (toGrant.length === 0 && toRevoke.length === 0) {
    return { success: true, action: "skipped", reason: "Already in desired state", grantedRoleIds: [], revokedRoleIds: [] };
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  const grantedRoleIds: string[] = [];
  const revokedRoleIds: string[] = [];
  const failures: string[] = [];

  const applyOne = async (roleId: string, method: "PUT" | "DELETE") => {
    const reason = method === "PUT"
      ? `Dime AI: entitlement grant for @${user.username}`
      : `Dime AI: entitlement revoke for @${user.username}`;
    let res = await discordApi(`/guilds/${guildId}/members/${user.discordId}/roles/${roleId}`, {
      method,
      headers: { "X-Audit-Log-Reason": reason },
    }).catch(() => null);
    if (res?.status === 429) {
      const retryAfter = Number((await res.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, retryAfter * 1000 + 100));
      res = await discordApi(`/guilds/${guildId}/members/${user.discordId}/roles/${roleId}`, { method }).catch(() => null);
    }
    if (res?.status === 204) {
      (method === "PUT" ? grantedRoleIds : revokedRoleIds).push(roleId);
    } else {
      const status = res?.status ?? "network";
      failures.push(`${method} ${roleId} → ${status}`);
      console.error(`${TAG}[reconcile] [VERIFY] FAIL requestId=${requestId} userId=${user.id} ${method} role=${roleId} HTTP ${status}`);
    }
  };

  for (const roleId of toGrant) await applyOne(roleId, "PUT");
  for (const roleId of toRevoke) await applyOne(roleId, "DELETE");

  if (failures.length > 0) {
    return {
      success: false,
      action: "error",
      reason: `Partial role sync: ${grantedRoleIds.length} granted, ${revokedRoleIds.length} revoked, failed: ${failures.join("; ")}`,
    };
  }

  const action = grantedRoleIds.length > 0 ? "granted" : "revoked";
  const reason =
    `Roles reconciled: +${grantedRoleIds.length} / -${revokedRoleIds.length} (HTTP 204)`;
  console.log(`${TAG}[reconcile] [OUTPUT] requestId=${requestId} userId=${user.id} ${reason}`);
  console.log(`${TAG}[reconcile] [VERIFY] PASS requestId=${requestId} userId=${user.id} action=${action}`);
  return { success: true, action, reason, grantedRoleIds, revokedRoleIds };
}

// ─── Public API (signatures unchanged since the single-role era) ─────────────

/**
 * syncDiscordRole — by app_users.id (fresh row read).
 * @param shouldHaveRole true = reconcile to entitled state, false = force-revoke managed roles
 */
export async function syncDiscordRole(userId: number, shouldHaveRole: boolean): Promise<SyncResult> {
  const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.log(`${TAG}[syncDiscordRole] [INPUT] requestId=${requestId} userId=${userId} shouldHaveRole=${shouldHaveRole}`);

  let user;
  try {
    user = await getAppUserById(userId);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`${TAG}[syncDiscordRole] [VERIFY] FAIL requestId=${requestId} userId=${userId} DB fetch error: ${msg}`);
    return { success: false, action: "error", reason: `DB fetch error: ${msg}` };
  }
  if (!user) {
    console.error(`${TAG}[syncDiscordRole] [VERIFY] FAIL requestId=${requestId} userId=${userId} user not found`);
    return { success: false, action: "error", reason: `User ${userId} not found` };
  }

  return reconcileRoles(
    {
      id: user.id,
      username: user.username,
      discordId: user.discordId ?? null,
      role: user.role,
      hasAccess: user.hasAccess === true,
      expiryDate: user.expiryDate ?? null,
      pendingSetup: (user as { pendingSetup?: boolean }).pendingSetup ?? false,
      stripePlanId: user.stripePlanId ?? null,
    },
    shouldHaveRole,
    requestId,
  );
}

/**
 * syncDiscordRoleForUser — caller already holds the user row (avoids a second
 * DB fetch). NOTE: the webhook revoke path passes a row read BEFORE its DB
 * update — shouldHaveRole=false is authoritative there.
 */
export async function syncDiscordRoleForUser(
  user: {
    id: number;
    username: string;
    discordId: string | null;
    hasAccess: boolean;
    pendingSetup?: boolean;
    role?: string;
    expiryDate?: number | null;
    stripePlanId?: string | null;
  },
  shouldHaveRole: boolean,
): Promise<SyncResult> {
  const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.log(
    `${TAG}[syncDiscordRoleForUser] [INPUT] requestId=${requestId} userId=${user.id}` +
    ` username=${user.username} shouldHaveRole=${shouldHaveRole} discordId=${user.discordId ?? "null"}`
  );
  return reconcileRoles(
    {
      id: user.id,
      username: user.username,
      discordId: user.discordId,
      role: user.role ?? "user",
      hasAccess: user.hasAccess,
      expiryDate: user.expiryDate ?? null,
      pendingSetup: user.pendingSetup ?? false,
      stripePlanId: user.stripePlanId ?? null,
    },
    shouldHaveRole,
    requestId,
  );
}
