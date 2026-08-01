# Users, roles & entitlement

Reference for who holds elevated access, how entitlement is modelled, and how to
answer membership questions from live data.

**Last verified against production: 2026-07-31.**

---

## Why there is no member roster in this file

This documents the role *model* and the *privileged* accounts — deliberately not
the 81 member usernames.

A customer roster committed to git is permanent: it survives in history after
deletion, ships to every clone, and is exactly the class of exposure the SEC-006
audit flagged. It would also be wrong within a day — a member joined on
2026-07-31 while this was being written.

Membership is a **query**, not a document. The queries are at the bottom.

---

## Roles

`app_users.role` is a MySQL enum: `owner | admin | handicapper | user`.
Role is always read from the **database**, never from a JWT claim — a JWT bakes
the role at login, so a demoted account would otherwise keep its powers until
the token expired (`server/routers/appUsers.ts`, `resolveOwnerIdentity`).

| Role | Grants |
| --- | --- |
| `owner` | Everything. `ownerProcedure` re-reads the row fresh (no cache) before allowing admin mutations: plan CRUD, user management, cron/debug endpoints. Also the only role that reaches the Dime AI model (`canAccessDimeModel`). |
| `admin` | Staff tooling via `handicapperProcedure`-class gates. **Not** the owner surfaces — `subscriptionPlans.*` and user management remain owner-only. Does **not** grant Dime AI model access. |
| `handicapper` | Content/handicapping surfaces only. Currently unused. |
| `user` | Paying member. Product access is governed by entitlement (below), not by role. |

### Privileged accounts

| Account | Role |
| --- | --- |
| `@prez` | `owner` |
| `@ghosty` | `admin` |
| `@sippi` | `admin` |
| `@offdutylocks` | `admin` |

Everyone else is `user`. Verify with the role-count query below rather than
trusting this table — it is a snapshot.

---

## Entitlement model

Entitlement is **separate from role**. Four columns on `app_users` decide it:

| Column | Meaning |
| --- | --- |
| `hasAccess` | Master switch. `false` denies regardless of anything else. |
| `expiryDate` | UTC ms. **`NULL` means lifetime access** — the schema's documented contract (`drizzle/schema.ts`). A non-null value in the past denies. |
| `stripePlanId` | The plan **slug**, a foreign key *by value*. |
| `planPriceId` | The `plan_prices.id` (billing interval) the member is on. |

Enforcement is per request in `stripeAppUserProcedure` / `appUserProcedure`:
`hasAccess && (expiryDate === null || now <= expiryDate)`.

### `stripePlanId` resolves against two catalogs

1. **DB plans** — rows in `subscription_plans` (`dime-pro`, `dime-sharp`, `dime-max`).
2. **Legacy static plans** — defined in code in `server/stripe/products.ts`
   (`monthly`, `annual`, `pro`, `sharp`, `operator`).

A slug that matches no `subscription_plans` row is therefore **not necessarily
dangling** — check the static list before treating it as an orphan.

### Why `planPriceId` stores an id, not an interval string

Stripe Prices are immutable, so changing an amount mints a *new* price row and
retires the old one. Storing the id pins exactly what a member is billed at,
across repricings. Indexed by `app_users_plan_price_idx`, so "who is on this
interval?" is an index seek.

### The `hasAccess` default fails closed (2026-08-01)

The column default was `'1'` — vestigial from the invite-only era — which,
combined with `expiryDate NULL = lifetime`, made any bare `INSERT` into
`app_users` a silent lifetime grant. There is **no public self-signup**: the
only two insert paths are the owner-gated `createUser` mutation and the
post-payment Stripe webhook, and both set `hasAccess` explicitly. The default
was therefore flipped to `'0'` (`db-subscription-events.yml`), so a future
insert path that forgets the column denies access instead of granting it.

An account CAN legitimately hold `hasAccess=1` with no plan (staff, or a
comped member mid-provisioning) — but for `role='user'` that state should be
transient. The **"Access, No Plan"** tile in User Management counts it and
should read 0; every manual grant/revoke now writes an `entitlement_events`
row (`actor='owner'`), so "why does this user have access?" is a query, not
an archaeology dig.

### No-grace billing law (owner directive, 2026-08-01)

**A declined subscription payment ends the membership at the moment of
failure.** No Smart-Retry ride-out, no buffer. `invoice.payment_failed`
revokes access and cancels the subscription at Stripe; `past_due` / `unpaid`
/ `paused` status moves are the belt-and-braces mirror. The revoke is guarded
by subscription identity — a lifetime (one-off) member never loses their
entitlement to a different subscription's decline.

**Trials — including free day passes — always auto-renew.** Checkout collects
the card up front (`payment_method_collection: "always"`); at trial end
Stripe charges the plan+interval price automatically. A declined conversion
revokes at the decline; a trial that reaches its end with auto-renew off or
no payment method cancels at trial expiry
(`trial_settings.end_behavior.missing_payment_method: "cancel"`).
`plan_prices.trialPeriodDays` is the authority on which SKU carries a trial.

**There is no buffer anywhere.** `RENEWAL_GRACE_MS` is repealed (owner:
"No grace periods allowed. Period."): a renewal's expiry is the exact instant
Stripe billed to, and the legacy static plan windows are exact (monthly 30d,
annual 365d — matching the DB plans' 1d/7d/30d/365d spec). If the next
invoice has not been PAID by period end, access lapses at period end and
returns only when `invoice.paid` arrives; that boundary lapse is product
intent, not a defect.

### Slug renames

`subscription_plans.slug` is referenced by value from `app_users.stripePlanId`,
so renaming a plan without repointing referrers silently breaks entitlement.
`syncPlanSlug` (`server/stripe/planProvisioning.ts`) moves the plan row and every
referrer together and rolls back the slug if the referrer update fails. It runs
automatically whenever a plan is renamed in the admin Edit dialog. Do not
`UPDATE subscription_plans SET slug = …` by hand.

---

## Current state (2026-07-31)

- 85 accounts: 81 `user`, 3 `admin`, 1 `owner`.
- All 81 `user` accounts hold **Dime Sharp — Lifetime**
  (`stripePlanId='dime-sharp'`, `planPriceId=120005`, `expiryDate=NULL`).
- Staff accounts (3 admin + 1 owner) are not on a member plan; they carry
  `hasAccess=1` with `expiryDate=NULL`.
- Zero Stripe *subscriptions* are attached to catalog prices — lifetime grants
  are entitlement rows, not recurring Stripe subscriptions.

---

## Queries

```sql
-- Role distribution
SELECT role, COUNT(*) FROM app_users GROUP BY role;

-- Who holds elevated access
SELECT id, username, role FROM app_users WHERE role <> 'user' ORDER BY role, username;

-- Membership by plan and interval (uses app_users_plan_price_idx)
SELECT p.name, r.amountCents, r.billingInterval, COUNT(u.id) AS members
FROM app_users u
JOIN plan_prices r         ON r.id = u.planPriceId
JOIN subscription_plans p  ON p.id = r.planId
GROUP BY p.name, r.amountCents, r.billingInterval;

-- Entitled right now
SELECT COUNT(*) FROM app_users
WHERE hasAccess = 1 AND (expiryDate IS NULL OR expiryDate > UNIX_TIMESTAMP() * 1000);

-- Integrity: a price that belongs to a different plan than the user's slug
SELECT u.id, u.username FROM app_users u
JOIN plan_prices r        ON r.id = u.planPriceId
JOIN subscription_plans p ON p.id = r.planId
WHERE p.slug <> u.stripePlanId;

-- Integrity: slug matching no DB plan (check server/stripe/products.ts before acting)
SELECT u.username, u.stripePlanId FROM app_users u
LEFT JOIN subscription_plans p ON p.slug = u.stripePlanId
WHERE u.stripePlanId IS NOT NULL AND p.id IS NULL;
```

---

## Changing entitlement

Prefer the admin UI. It routes through the tested paths, keeps Stripe in sync,
and cannot leave a plan without a default price.

For a bulk change, write to `app_users` in a **single transaction**, and repair
plan slugs *before* assigning members — otherwise rows are written against a
slug that is about to move. Set `expiryDate = NULL` for lifetime; do not invent
a far-future sentinel, which would read as "expires in 2100" to some surfaces
and "lifetime" to others.
