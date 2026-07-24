/**
 * server/stripe/backfillPlans.ts
 *
 * Idempotently imports the 5 static PLANS (server/stripe/products.ts) into the
 * DB catalog (subscription_plans + plan_prices) so existing subscribers and
 * /checkout?plan=<slug> keep working after the migration to a DB-backed catalog.
 *
 * Idempotent by slug — re-running inserts nothing new. A v2 plan whose price env
 * var is unset is skipped (its priceId() throws by design, SEC-006); it can be
 * (re)created from the admin dashboard later. Run once from an owner mutation.
 */
import { getDb } from "../db";
import { withCircuitBreaker } from "../dbCircuitBreaker";
import { subscriptionPlans, planPrices } from "../../drizzle/schema";
import { PLANS, type PlanId } from "./products";
import { getPlanBySlug, invalidatePlanCache } from "./planStore";

const TAG = "[Stripe][Backfill]";

export async function backfillStaticPlans(): Promise<{ inserted: number; skipped: number }> {
  const db = await getDb();
  if (!db) {
    console.warn(`${TAG} no DB available — skipping`);
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  for (const [slug, def] of Object.entries(PLANS) as Array<[PlanId, (typeof PLANS)[PlanId]]>) {
    if (await getPlanBySlug(slug)) {
      skipped++;
      continue;
    }

    // Resolve the current Stripe price ID from env. v2 plans throw when unset.
    let priceId: string;
    try {
      priceId = def.priceId();
    } catch {
      console.warn(`${TAG} ${slug}: price env unset — skip (create it from the dashboard later)`);
      skipped++;
      continue;
    }

    try {
      await withCircuitBreaker(async () => {
        const result = await db.insert(subscriptionPlans).values({
          slug,
          name: def.name,
          planType: "recurring",
          active: true,
          sortOrder: 0,
        });
        const planId = Number(result?.[0]?.insertId ?? 0);
        if (!planId) throw new Error("no insertId for subscription_plans row");
        await db.insert(planPrices).values({
          planId,
          stripePriceId: priceId,
          label: def.priceDisplay,
          amountCents: def.amountCents,
          currency: "usd",
          interval: def.interval,
          intervalCount: 1,
          active: true,
          isDefault: true,
        });
      });
      inserted++;
      console.log(`${TAG} imported ${slug} → ${priceId}`);
    } catch (err) {
      console.warn(`${TAG} ${slug}: insert failed — ${(err as Error).message}`);
      skipped++;
    }
  }

  invalidatePlanCache();
  console.log(`${TAG} done: inserted=${inserted} skipped=${skipped}`);
  return { inserted, skipped };
}
