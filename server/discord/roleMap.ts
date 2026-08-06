/**
 * server/discord/roleMap.ts
 *
 * Pure plan→Discord-role mapping. The single authority on WHICH roles a member
 * should hold; discordRoleSync.ts is the only caller that applies it.
 *
 * Registry sources (all env, set in Railway):
 *   DIME_AI_SUB              — baseline member role, every entitled member
 *   DIME_AI_TEAM             — owners + admins
 *   DIME_AI_<PLAN>           — plan roles by convention: slug `dime-sharp` ↔
 *                              env `DIME_AI_SHARP` (strip `dime-`, uppercase,
 *                              `-`→`_`). New plans need only a new env var.
 *   DISCORD_ROLE_AI_MODEL_SUB — legacy baseline role, kept granted alongside
 *                              DIME_AI_SUB so history doesn't fork.
 *
 * Every env value is validated as a Discord snowflake — non-role values that
 * share the prefix (e.g. DIME_AI_URL) can never enter the registry.
 *
 * The registry's values are the engine's MANAGED set: sync may add or remove
 * ONLY these role IDs. Roles granted by hand in Discord are never touched.
 *
 * Dependency-free (env passed in, no I/O) — see roleMap.test.ts.
 */

const SNOWFLAKE_RE = /^\d{17,20}$/;
/** Registry keys that are NOT plan roles. */
const NON_PLAN_KEYS = new Set(["DIME_AI_SUB", "DIME_AI_TEAM"]);

export interface RoleRegistry {
  /** Baseline roles every entitled member holds (DIME_AI_SUB + legacy). */
  baselineRoleIds: string[];
  /** Owner/admin role (DIME_AI_TEAM), or null when unset. */
  teamRoleId: string | null;
  /** plan slug (e.g. "dime-sharp") → role id. */
  planRoleIds: Record<string, string>;
}

/** env key DIME_AI_SHARP → plan slug "dime-sharp". */
export function planSlugForEnvKey(envKey: string): string {
  return `dime-${envKey
    .replace(/^DIME_AI_/, "")
    .toLowerCase()
    .replace(/_/g, "-")}`;
}

export function parseRoleRegistry(
  env: Record<string, string | undefined>
): RoleRegistry {
  const snowflake = (v: string | undefined): string | null =>
    v && SNOWFLAKE_RE.test(v.trim()) ? v.trim() : null;

  const baselineRoleIds = [
    snowflake(env.DIME_AI_SUB),
    snowflake(env.DISCORD_ROLE_AI_MODEL_SUB),
  ].filter((v): v is string => v !== null);

  const planRoleIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("DIME_AI_") || NON_PLAN_KEYS.has(key)) continue;
    const id = snowflake(value);
    if (id) planRoleIds[planSlugForEnvKey(key)] = id;
  }

  return {
    baselineRoleIds,
    teamRoleId: snowflake(env.DIME_AI_TEAM),
    planRoleIds,
  };
}

/** The only role IDs sync is allowed to add or remove. */
export function managedRoleIds(registry: RoleRegistry): Set<string> {
  return new Set([
    ...registry.baselineRoleIds,
    ...(registry.teamRoleId ? [registry.teamRoleId] : []),
    ...Object.values(registry.planRoleIds),
  ]);
}

export interface RoleMapUser {
  role: string;
  hasAccess: boolean;
  /** UTC ms; NULL = lifetime. */
  expiryDate?: number | null;
  pendingSetup?: boolean;
  stripePlanId?: string | null;
}

/**
 * The role IDs this member SHOULD hold right now.
 *
 * `entitledOverride` carries the caller's verdict when the row is known-stale:
 * the Stripe webhook revoke path updates the DB and then syncs with the row it
 * read BEFORE the update, passing shouldHaveRole=false. false forces
 * revocation; true defers to the row's own guards; undefined = derive fully
 * from the row.
 */
export function computeDesiredRoleIds(
  user: RoleMapUser,
  registry: RoleRegistry,
  nowMs: number,
  entitledOverride?: boolean
): Set<string> {
  const rowEntitled =
    user.hasAccess === true &&
    (user.expiryDate == null || nowMs <= user.expiryDate) &&
    user.pendingSetup !== true;

  const entitled = entitledOverride === false ? false : rowEntitled;
  if (!entitled) return new Set();

  const desired = new Set(registry.baselineRoleIds);
  const planRole = user.stripePlanId
    ? registry.planRoleIds[user.stripePlanId]
    : undefined;
  if (planRole) desired.add(planRole);
  if ((user.role === "owner" || user.role === "admin") && registry.teamRoleId) {
    desired.add(registry.teamRoleId);
  }
  return desired;
}
