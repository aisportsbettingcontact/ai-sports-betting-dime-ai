# Discord plan→role mapping — desired-state engine + seamless connect

**Date:** 2026-08-03 · Owner-directed: DIME_AI_* role vars added in Railway; TEAM for
owners/admins, SHARP for sharp members, SUB for everyone, and automatic role
assignment when a subscriber connects Discord.

## What shipped operationally first (one-off, already applied)

158 role grants against the live guild, verified 89/89 entitled Discord-linked
members hold their exact set: 𝗗𝗜𝗠𝗘 𝗔𝗜 (SUB) for all, 𝗗𝗜𝗠𝗘 𝗔𝗜 𝗦𝗛𝗔𝗥𝗣 for the 87
dime-sharp members, 𝗧𝗘𝗔𝗠 for prez/sippi/ghosty/offdutylocks. snipergav and
testuser have no Discord linked. Bot hierarchy verified (top role pos 19 > all
managed roles).

## The engine

### `server/discord/roleMap.ts` (pure, env-driven registry)

- `DIME_AI_SUB` + legacy `DISCORD_ROLE_AI_MODEL_SUB` → baseline roles, every
  entitled member.
- `DIME_AI_TEAM` → role owner/admin.
- `DIME_AI_<X>` → plan role for slug `dime-<x>` (SHARP↔dime-sharp, PRO↔dime-pro,
  MAX↔dime-max). **Adding a plan = adding one env var.** Every value is
  snowflake-validated, so `DIME_AI_URL` (or any future non-role key) can never
  enter the registry.
- `computeDesiredRoleIds(user, registry, now, entitledOverride?)`: entitled =
  hasAccess ∧ (expiry NULL or ≥ now) ∧ ¬pendingSetup. Entitled → baseline +
  plan role + TEAM (if staff). Not entitled → ∅. `entitledOverride=false` forces
  ∅ for the webhook revoke path, which syncs with a row read before its own DB
  update.
- `managedRoleIds(registry)`: the ONLY roles sync may add or remove — roles
  granted by hand in Discord are never touched.

### `server/discord/discordRoleSync.ts` (desired-state reconciler)

Same exported API (`syncDiscordRole`, `syncDiscordRoleForUser`, `SyncResult`),
new core: GET member → diff desired vs held → PUT missing / DELETE
managed-but-undesired, 429-aware, 404 = not-in-guild skip. Because the API is
unchanged, every existing path upgraded atomically: Stripe webhook grant &
revoke, checkout completion, Discord OAuth connect callback, admin
updateUser/syncDiscordRole button, and the Create-Account-v2 chain.
The Authorization header is merged last (regression-tested) — the header-clobber
bug that 401'd the first rollout sweep cannot recur.

## Seamless subscriber connect

`resetPassword` now auto-logs-in on success (same trust basis as
`completeAccountSetup`: possession of the single-use token), signing with the
post-increment tokenVersion so old sessions stay dead. The welcome claim screen
then offers **Connect Discord — get your member roles** (→ existing
`/api/auth/discord/connect` OAuth, whose callback already fires role sync → the
engine assigns SUB + plan role instantly) and **Enter the Platform**. Ordinary
password resets redirect straight into `/feed`, signed in.

Member journey: pay link → owner creates account (plan derived, invite link) →
member sets password → signed in → one click Connect Discord → correct roles
appear in the guild automatically. Plan changes/cancellations reconcile on the
next webhook or admin sync — additive and subtractive.

## Out of scope

`guilds.join` auto-join OAuth scope (everyone is already in the guild),
per-plan role config UI (env registry is the authority; `subscription_plans.
discordRoleId` column remains unused for now).
