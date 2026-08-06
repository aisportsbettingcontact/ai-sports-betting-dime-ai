import { getDimeEngineeringControlSummary } from "../_core/dimeEngineeringControl";
import { getDimeRuntimeReadiness } from "../_core/dimeRuntimeReadiness";
import { getDimeTraceObservabilityReadiness } from "../_core/dimeTraceObservability";
import { router } from "../_core/trpc";
import { ownerProcedure } from "./appUsers";

export const dimeRuntimeRouter = router({
  /**
   * Owner-only, secret-safe Dime Chat runtime diagnostics.
   *
   * This reports configuration presence and governed modes, never endpoint
   * URLs, credentials, prompt content, user content, or raw environment values.
   */
  readiness: ownerProcedure.query(() => getDimeRuntimeReadiness()),

  /**
   * Owner-only, immutable engineering-control contract.
   *
   * This exposes taxonomies, route-policy status, and non-authorizing gates.
   * It never starts training, changes a provider, promotes a model, or
   * returns user conversations or credentials.
   */
  engineeringControl: ownerProcedure.query(() =>
    getDimeEngineeringControlSummary()
  ),

  /**
   * Owner-only, enumeration-resistant Phase 1 observability readiness.
   *
   * This accepts no trace ID and returns no prompt, response, account,
   * credential, endpoint, environment value, or persisted trace record.
   */
  observability: ownerProcedure.query(() =>
    getDimeTraceObservabilityReadiness()
  ),
});
