/**
 * discordRoleSync.ts
 *
 * Single source of truth for Discord subscriber role assignment and revocation.
 *
 * This module is the ONLY place that calls the Discord REST API to grant or revoke
 * the AI_MODEL_SUB role. All other code paths (webhook fulfillment, Discord OAuth
 * callback, admin updateUser, subscription cancellation) MUST call syncDiscordRole()
 * from here — never duplicate the role assignment logic.
 *
 * ── Role assignment rules ─────────────────────────────────────────────────────
 * 1. Role is granted ONLY when:
 *    - user.hasAccess === true AND
 *    - user.discordId is set (Discord account linked) AND
 *    - user.pendingSetup === false (account is fully set up, password has been set)
 *
 * 2. Role is revoked when:
 *    - user.hasAccess === false OR
 *    - subscription is cancelled/expired
 *
 * 3. Role is NOT assigned when:
 *    - pendingSetup === true (user paid but hasn't set up their account yet)
 *    - discordId is null (Discord not linked)
 *
 * ── Discord REST API ──────────────────────────────────────────────────────────
 * PUT  /guilds/{guildId}/members/{userId}/roles/{roleId}  → grant role (204)
 * DELETE /guilds/{guildId}/members/{userId}/roles/{roleId} → revoke role (204)
 *
 * Both endpoints require Authorization: Bot {DISCORD_BOT_TOKEN}
 * and return 204 No Content on success.
 */

import { ENV } from "../_core/env";
import { getAppUserById } from "../db";

const TAG = "[DiscordRoleSync]";
const DISCORD_API_BASE = "https://discord.com/api/v10";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncResult =
  | { success: true; action: "granted" | "revoked" | "skipped"; reason: string }
  | { success: false; action: "error"; reason: string; statusCode?: number };

// ─── Core utility ─────────────────────────────────────────────────────────────

/**
 * syncDiscordRole
 *
 * Grants or revokes the AI_MODEL_SUB Discord role for a user.
 *
 * @param userId - Internal app_users.id
 * @param shouldHaveRole - true = grant role, false = revoke role
 * @returns SyncResult with action taken and reason
 *
 * Skips silently (returns success: true, action: "skipped") when:
 * - ENV.discordBotToken is not set
 * - ENV.discordGuildId is not set
 * - ENV.discordRoleAiModelSub is not set
 * - user.discordId is null (Discord not linked)
 * - shouldHaveRole=true but user.pendingSetup=true (account not fully set up)
 */
export async function syncDiscordRole(
  userId: number,
  shouldHaveRole: boolean
): Promise<SyncResult> {
  const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

  console.log(
    `${TAG}[syncDiscordRole] [INPUT] requestId=${requestId}` +
    ` userId=${userId} shouldHaveRole=${shouldHaveRole}`
  );

  // ── [STEP 1] Validate environment ─────────────────────────────────────────
  const botToken = ENV.discordBotToken;
  const guildId = ENV.discordGuildId;
  const roleId = ENV.discordRoleAiModelSub;

  if (!botToken || !guildId || !roleId) {
    const missing = [
      !botToken && "DISCORD_BOT_TOKEN",
      !guildId && "DISCORD_GUILD_ID",
      !roleId && "DISCORD_ROLE_AI_MODEL_SUB",
    ].filter(Boolean).join(", ");
    console.warn(
      `${TAG}[syncDiscordRole] [STATE] requestId=${requestId}` +
      ` SKIPPED — missing env vars: ${missing}`
    );
    return {
      success: true,
      action: "skipped",
      reason: `Missing env vars: ${missing}`,
    };
  }

  // ── [STEP 2] Fetch user from DB ────────────────────────────────────────────
  let user;
  try {
    user = await getAppUserById(userId);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(
      `${TAG}[syncDiscordRole] [VERIFY] FAIL requestId=${requestId}` +
      ` userId=${userId} DB fetch error: ${msg}`
    );
    return { success: false, action: "error", reason: `DB fetch error: ${msg}` };
  }

  if (!user) {
    console.error(
      `${TAG}[syncDiscordRole] [VERIFY] FAIL requestId=${requestId}` +
      ` userId=${userId} user not found in DB`
    );
    return { success: false, action: "error", reason: `User ${userId} not found` };
  }

  console.log(
    `${TAG}[syncDiscordRole] [STATE] requestId=${requestId}` +
    ` userId=${userId} username=${user.username}` +
    ` discordId=${user.discordId ?? "null"}` +
    ` hasAccess=${user.hasAccess}` +
    ` pendingSetup=${(user as any).pendingSetup ?? false}`
  );

  // ── [STEP 3] Check if Discord is linked ───────────────────────────────────
  if (!user.discordId) {
    console.log(
      `${TAG}[syncDiscordRole] [STATE] requestId=${requestId}` +
      ` userId=${userId} SKIPPED — discordId is null (Discord not linked yet)`
    );
    return {
      success: true,
      action: "skipped",
      reason: "Discord not linked",
    };
  }

  // ── [STEP 4] Check pendingSetup guard (role only after account is fully set up) ──
  if (shouldHaveRole && (user as any).pendingSetup === true) {
    console.log(
      `${TAG}[syncDiscordRole] [STATE] requestId=${requestId}` +
      ` userId=${userId} SKIPPED — pendingSetup=true, account not fully set up yet`
    );
    return {
      success: true,
      action: "skipped",
      reason: "Account pending setup — role will be assigned after password is set",
    };
  }

  // ── [STEP 5] Call Discord REST API ────────────────────────────────────────
  const method = shouldHaveRole ? "PUT" : "DELETE";
  const action = shouldHaveRole ? "granted" : "revoked";
  const url = `${DISCORD_API_BASE}/guilds/${guildId}/members/${user.discordId}/roles/${roleId}`;

  console.log(
    `${TAG}[syncDiscordRole] [STEP] requestId=${requestId}` +
    ` Calling Discord API: ${method} ${url}` +
    ` discordId=${user.discordId} roleId=${roleId}`
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": shouldHaveRole
          ? `AI Sports Betting: subscription activated for @${user.username}`
          : `AI Sports Betting: subscription cancelled/expired for @${user.username}`,
      },
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(
      `${TAG}[syncDiscordRole] [VERIFY] FAIL requestId=${requestId}` +
      ` userId=${userId} Discord API network error: ${msg}`
    );
    return { success: false, action: "error", reason: `Discord API network error: ${msg}` };
  }

  // ── [STEP 6] Validate response ─────────────────────────────────────────────
  // Discord returns 204 No Content on success for both PUT and DELETE
  // 404 = user not in guild (acceptable — they may not have joined yet)
  // 403 = bot lacks Manage Roles permission
  if (res.status === 204) {
    console.log(
      `${TAG}[syncDiscordRole] [OUTPUT] requestId=${requestId}` +
      ` userId=${userId} discordId=${user.discordId}` +
      ` role ${action} successfully (HTTP 204)`
    );
    console.log(
      `${TAG}[syncDiscordRole] [VERIFY] PASS requestId=${requestId}` +
      ` userId=${userId} action=${action}`
    );
    return { success: true, action, reason: `Role ${action} via Discord API (HTTP 204)` };
  }

  if (res.status === 404) {
    // User is not in the guild — not an error, just not a member yet
    console.warn(
      `${TAG}[syncDiscordRole] [STATE] requestId=${requestId}` +
      ` userId=${userId} discordId=${user.discordId}` +
      ` SKIPPED — user not in guild (HTTP 404). They must join the Discord server first.`
    );
    return {
      success: true,
      action: "skipped",
      reason: "User not in Discord guild (HTTP 404) — they must join the server first",
    };
  }

  // Any other status is an error
  let body = "";
  try { body = await res.text(); } catch { /* ignore */ }
  console.error(
    `${TAG}[syncDiscordRole] [VERIFY] FAIL requestId=${requestId}` +
    ` userId=${userId} Discord API error HTTP ${res.status}: ${body}`
  );
  return {
    success: false,
    action: "error",
    reason: `Discord API error HTTP ${res.status}: ${body}`,
    statusCode: res.status,
  };
}

/**
 * syncDiscordRoleForUser
 *
 * Convenience wrapper that takes a user object directly (avoids a second DB fetch).
 * Used when the caller already has the full user object.
 *
 * @param user - Full user object with discordId, hasAccess, pendingSetup
 * @param shouldHaveRole - true = grant role, false = revoke role
 */
export async function syncDiscordRoleForUser(
  user: {
    id: number;
    username: string;
    discordId: string | null;
    hasAccess: boolean;
    pendingSetup?: boolean;
  },
  shouldHaveRole: boolean
): Promise<SyncResult> {
  const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

  console.log(
    `${TAG}[syncDiscordRoleForUser] [INPUT] requestId=${requestId}` +
    ` userId=${user.id} username=${user.username}` +
    ` shouldHaveRole=${shouldHaveRole}` +
    ` discordId=${user.discordId ?? "null"}` +
    ` pendingSetup=${user.pendingSetup ?? false}`
  );

  const botToken = ENV.discordBotToken;
  const guildId = ENV.discordGuildId;
  const roleId = ENV.discordRoleAiModelSub;

  if (!botToken || !guildId || !roleId) {
    const missing = [
      !botToken && "DISCORD_BOT_TOKEN",
      !guildId && "DISCORD_GUILD_ID",
      !roleId && "DISCORD_ROLE_AI_MODEL_SUB",
    ].filter(Boolean).join(", ");
    console.warn(
      `${TAG}[syncDiscordRoleForUser] [STATE] requestId=${requestId}` +
      ` SKIPPED — missing env vars: ${missing}`
    );
    return { success: true, action: "skipped", reason: `Missing env vars: ${missing}` };
  }

  if (!user.discordId) {
    console.log(
      `${TAG}[syncDiscordRoleForUser] [STATE] requestId=${requestId}` +
      ` userId=${user.id} SKIPPED — discordId is null`
    );
    return { success: true, action: "skipped", reason: "Discord not linked" };
  }

  if (shouldHaveRole && user.pendingSetup === true) {
    console.log(
      `${TAG}[syncDiscordRoleForUser] [STATE] requestId=${requestId}` +
      ` userId=${user.id} SKIPPED — pendingSetup=true`
    );
    return { success: true, action: "skipped", reason: "Account pending setup" };
  }

  const method = shouldHaveRole ? "PUT" : "DELETE";
  const action = shouldHaveRole ? "granted" : "revoked";
  const url = `${DISCORD_API_BASE}/guilds/${guildId}/members/${user.discordId}/roles/${roleId}`;

  console.log(
    `${TAG}[syncDiscordRoleForUser] [STEP] requestId=${requestId}` +
    ` ${method} ${url}`
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": shouldHaveRole
          ? `AI Sports Betting: subscription activated for @${user.username}`
          : `AI Sports Betting: subscription cancelled/expired for @${user.username}`,
      },
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(
      `${TAG}[syncDiscordRoleForUser] [VERIFY] FAIL requestId=${requestId}` +
      ` userId=${user.id} network error: ${msg}`
    );
    return { success: false, action: "error", reason: `Network error: ${msg}` };
  }

  if (res.status === 204) {
    console.log(
      `${TAG}[syncDiscordRoleForUser] [OUTPUT] requestId=${requestId}` +
      ` userId=${user.id} role ${action} (HTTP 204)`
    );
    console.log(`${TAG}[syncDiscordRoleForUser] [VERIFY] PASS requestId=${requestId}`);
    return { success: true, action, reason: `Role ${action} (HTTP 204)` };
  }

  if (res.status === 404) {
    console.warn(
      `${TAG}[syncDiscordRoleForUser] [STATE] requestId=${requestId}` +
      ` userId=${user.id} SKIPPED — not in guild (HTTP 404)`
    );
    return { success: true, action: "skipped", reason: "User not in Discord guild" };
  }

  let body = "";
  try { body = await res.text(); } catch { /* ignore */ }
  console.error(
    `${TAG}[syncDiscordRoleForUser] [VERIFY] FAIL requestId=${requestId}` +
    ` userId=${user.id} HTTP ${res.status}: ${body}`
  );
  return {
    success: false,
    action: "error",
    reason: `Discord API HTTP ${res.status}: ${body}`,
    statusCode: res.status,
  };
}
