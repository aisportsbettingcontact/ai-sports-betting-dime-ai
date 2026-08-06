# Stripe end-to-end money-path harness

`scripts/stripe-e2e.mjs` · `pnpm run test:stripe-e2e` · `.github/workflows/stripe-e2e.yml`

## What it caught on its first run

Two live defects, both invisible to the unit suite because both live in the gap
between drizzle and the mysql2 driver:

1. **Duplicate webhook deliveries were answered `500`.** `claimStripeEvent()`
   detected a duplicate with `err.code === "ER_DUP_ENTRY" || /duplicate/i` — but
   drizzle raises `DrizzleQueryError`, whose own `.code` is `undefined` and whose
   message is `"Failed query: insert into …"`. Neither test matched, so the
   duplicate was rethrown as a processing failure. Because the handler answers
   5xx to invite redelivery, this was self-sustaining: duplicate → 500 → Stripe
   redelivers → duplicate → 500, one billing alert per cycle, until Stripe
   disables the endpoint. Entitlement data stayed correct throughout; only the
   signalling was wrong, which is exactly the class of bug a unit test on a
   hand-built error object cannot see.
2. **`isSchemaError()` could never fire.** Same root cause, so the fail-loud
   schema-drift detection added after the login outage would not have caught the
   outage it was written for.

Both are fixed by `driverErrorCode()` in `server/db.ts`, which walks the `cause`
chain instead of reading `.code`. `server/driverErrorClassification.test.ts`
pins the wrapper shape captured from drizzle-orm 0.45.2, so a future upgrade
that changes it fails loudly rather than silently reopening either hole.

## What it proves

Billing had unit tests and no proof. `server/stripeWebhook.ts` returned early on
every `livemode:false` event — before the idempotency claim, before any
fulfilment — so the sequence that actually moves money had never run against a
real database anywhere. This harness runs it.

Each run builds everything from nothing: a throwaway MySQL 8 container, the full
reconciled migration chain replayed onto it (asserted against the newest journal
tag, not the migrator's own success message), a seeded plan + recurring price +
subscriber, `stripe listen`, and the server booted from source. Every assertion
reads database state.

Three layers, and the summary labels which one each check belongs to:

| Layer | What it establishes |
|---|---|
| **negative** | A forged signature and a missing `Stripe-Signature` header are both 400, and neither writes a row to `stripe_webhook_events`. Rejection is proven by the ledger, not by the status code alone. |
| **plumbing** (`stripe trigger`) | Real Stripe events travel Stripe → CLI → our endpoint, verify, and are claimed exactly once. Replaying one (`stripe events resend`, plus a deterministic locally re-signed POST of the same event body) leaves the ledger, the audit trail and the subscriber row untouched. |
| **fulfilment** (synthetic) | Grant, exactly-once redelivery, revoke and refund asserted as `app_users` and `entitlement_events` state. |

The single most important assertion is in the fulfilment layer: an identical
redelivery of a `checkout.session.completed` adds no ledger row, writes no
second `entitlement_events` row, and — the one that costs real money —
**does not re-extend `expiryDate`**. Stripe delivers at least once and this
handler answers 5xx to invite redelivery, so everything downstream depends on
the second delivery changing nothing.

### Why some checks are reported PARTIAL

Stripe's canned `stripe trigger` fixtures carry none of this application's
metadata: no `client_reference_id`, no `metadata.price_id`, and a customer id
that belongs to a customer the fixture just invented. There is no way to make
such an event map to the seeded subscriber. Those checks therefore assert only
what they can prove — the event was delivered, verified, claimed exactly once,
and answered 200 — and are printed **PARTIAL**, with the reason on the row. They
are not dressed up as entitlement proof.

The entitlement transitions are proven instead by **synthetic** events: bodies
this script composes and signs with the same `whsec_` the CLI handed us, POSTed
to the same endpoint. The HMAC, the handler, the SQL and the audit trail are all
real; only the origin is this script rather than Stripe's servers. That is the
only way to bind an event to a known user and a known `plan_prices` row, which is
what turns "the revoke path ran" into "this user's `hasAccess` went 1 → 0 and the
audit row says `SUBSCRIPTION_DELETED`".

Read the coverage line on each row, not the pass count.

## Running it locally

```bash
stripe login                    # once — writes ~/.config/stripe/config.toml
docker info                     # the daemon must be up
pnpm run test:stripe-e2e
```

Options:

```bash
node scripts/stripe-e2e.mjs --port 4100 --mysql-port 33500
node scripts/stripe-e2e.mjs --keep      # skip teardown, leave everything running
```

`--keep` prints the server pid, the `stripe listen` pid, the `DATABASE_URL` and
the exact command to tear it all down by hand.

The key is resolved from `STRIPE_TEST_SECRET_KEY`, then `stripe config --list`,
then `~/.config/stripe/config.toml`. It is never printed — only an 8-character
prefix and a length. Every child-process stream (including `stripe listen`,
which announces the signing secret on its first line) passes through a redactor
before it can reach the console.

Teardown runs in a `finally`, on success, on assertion failure and on a thrown
exception: the server and `stripe listen` are signalled by process **group** (both
fork, so killing only the direct child orphans the listener and leaves the port
bound), and the container is `docker rm -f`'d. Exit code is non-zero if any check
failed.

## In CI

`.github/workflows/stripe-e2e.yml` — `workflow_dispatch` plus a 04:41 UTC nightly
schedule. It installs the Stripe CLI and lets the script manage its own Docker
container rather than using a `services:` block, so the CI path and the laptop
path are the same code (see the comment at the top of the workflow).

When the `STRIPE_TEST_SECRET_KEY` repository secret is absent — forks, secretless
runs — the guard step emits a notice and every later step is skipped. The job is
green. A missing test credential is not a broken build.

## What it cannot prove

- **Stripe-hosted Checkout.** No browser drives a real card through a real
  Checkout Session, so the checkout → session → redirect leg is untested here.
  The plumbing layer proves the webhook leg of it.
- **Production configuration.** It proves the code path, not that the live
  webhook endpoint is subscribed to the right events, nor that the live price ids
  resolve to the right plans. `cron-stripe-reconcile.yml` is the drift detector
  for that; this is not.
- **Stripe's delivery of the synthetic events.** By construction those bodies did
  not come from Stripe. Delivery is what the plumbing layer is for; the two
  layers are complementary and neither substitutes for the other.
- **Concurrency.** The exactly-once claim is proven against sequential
  redelivery. Two simultaneous deliveries of the same event race on the unique
  index — the design is correct, but this harness does not fire them in parallel.
- **Live-mode behaviour.** Everything runs with `livemode:false`, by design; see
  below.

## Why it can never touch production

Four independent conditions, each of which fails closed on its own:

1. **The harness refuses a live key.** It resolves a Stripe key before doing
   anything else and aborts if it does not match `/^(sk|rk)_test_/`, naming the
   prefix. A live key never gets as far as starting a container.
2. **The database is one this process created.** `DATABASE_URL` is always
   `mysql://root@127.0.0.1:<port>/dime_stripe_e2e`, pointing at a container the
   script started seconds earlier and destroys in its `finally`. It is never read
   from the environment, so an inherited production DSN cannot be picked up.
3. **The server re-checks, independently.** `server/_core/testModeFulfillment.ts`
   is the gate that lets a `livemode:false` event reach fulfilment at all, and it
   requires ALL of `ALLOW_TEST_MODE_FULFILLMENT=1`, a `sk_test_`/`rk_test_` key,
   and a local/non-managed `DATABASE_URL`. The load-bearing one is the key: with a
   test-mode key the handler physically cannot read or mutate a live Stripe
   object, because live and test objects live in disjoint namespaces. A
   production process — which necessarily holds a live key — cannot be made to
   fulfil a test-mode event no matter what is sent to it.
4. **Live events are unaffected.** The gate only ever widens what happens to
   `livemode:false` events. Nothing in this harness, and nothing it depends on,
   changes the handling of a `livemode:true` event.

The CI job declares `environment: Production`. That is an access-control
declaration required by the repository's uniform Actions secret contract
(`scripts/check-github-actions-security.mjs` routes every non-`GITHUB_TOKEN`
secret through the protected environment, deliberately without carving out
"test" secrets it cannot verify as such). It is not a statement that the job
touches production: it runs entirely against a container it creates and
destroys.
