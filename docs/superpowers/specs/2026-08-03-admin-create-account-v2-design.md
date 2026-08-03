# Admin Create Account v2 — plan-aware creation, Discord connect, claim link

**Date:** 2026-08-03 · **Owner approval:** claim-link semantics chosen over magic-login and prefilled-login in session.

## Why

Members now pay through Stripe payment links (e.g. the Sharp Lifetime link
`plink_1TxAEPPa3TFEAkkY8XoszaBk`) whose checkouts create no Stripe customer and
often use a different payer email, so the owner hand-creates their accounts.
The Create Account modal only captures email/username/password/role/access/expiry —
plan assignment, Discord connection, and getting login credentials to the member
were all separate manual steps.

## Design

### Server — `appUsers.createUser` (extended, backward compatible)

New optional inputs:

- `planPriceId` (already existed) now triggers **server-side derivation**: the
  price is resolved from the live catalog (`planStore.getCachedPlans`); the plan
  slug and expiry are derived on the server and any client-sent
  `stripePlanId`/`expiryDate` are ignored in that case. Expiry uses
  `computeExpiryMsForPrice` — the identical function the Stripe webhook uses —
  with `LIFETIME_ACCESS_UNTIL_MS` mapped to `NULL` to match the existing 86
  lifetime rows (`expiryDate NULL` = lifetime, per schema doc). Unknown/inactive
  price → `BAD_REQUEST`; UI and DB cannot drift.
- `discordId` (17–20 digit snowflake): after insert, connected through the same
  validated flow as `setManualDiscordId` (extracted shared helper): format check,
  Bot-API username resolution, uniqueness/takeover guard, write of
  `discordId`/`discordUsername`/`discordAvatar`/`discordConnectedAt`. Discord
  failure does NOT roll back the account — the mutation reports
  `{ discord: { connected: false, error } }` and the owner can retry from the
  table row as today. On success + `hasAccess`, the Discord role sync fires
  (same `syncDiscordRoleForUser` used by the webhook).
- `generateClaimLink` + `origin`: mints a single-use claim token using the
  password-reset columns (`passwordResetToken` = sha256 of a 32-byte CSPRNG
  token, `passwordResetExpiresAt` = now + **7 days**) and returns
  `claimUrl = {origin}/reset-password?token=…&uid=…&welcome=1`. Consumed by the
  existing `resetPassword` mutation — single-use, expiring, hash-at-rest. No
  schema change.
- `password` becomes optional **only when** `generateClaimLink` is true (a
  random throwaway is hashed until the member claims); with no claim link a
  password is still required.

Return value grows to
`{ success, userId, claimUrl?, discord: { connected, username?, error? } }`.
Entitlement ledger (`admin.create_user` / `manual_create`, actor `owner`)
unchanged, now carrying the derived plan.

### Client — Create Account modal (`UserManagement.tsx`)

- **Plan** dropdown fed by `subscriptionPlans.list` (owner-only, live catalog),
  plus "No plan". Selecting a plan swaps the EXPIRY DATE control for an
  **interval** dropdown listing only that plan's prices
  ("Lifetime — $999.99", "Monthly — $99.99", …); no plan keeps today's
  Lifetime/custom picker.
- **Discord User ID** field (optional, snowflake hint).
- **Invite link** toggle (default on). Password field marked optional while on.
- Success: persistent toast with the claim URL and a Copy button; separate
  warning toast if Discord connect failed (account still created).

### Tests

`server/adminCreateAccount.test.ts`, following the repo's pure-logic +
source-contract pattern (`entitlementAssignment.test.ts`):
derivation (each interval, lifetime→NULL, unknown price rejected), claim-token
shape/TTL/hash, password-optionality rule, and wiring contracts (derived values
reach the INSERT; discord failure path returns instead of throwing).

## Out of scope

Magic auto-login links, emailing the member directly, schema changes, and any
change to the Stripe webhook path.
