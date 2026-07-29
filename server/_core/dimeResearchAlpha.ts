/**
 * Dime Research Alpha — temporary, owner/admin-only control-model gate.
 * --------------------------------------------------------------------
 * This gate is intentionally separate from DIME_CHAT_LLM_PROVIDER, which
 * remains hardcoded "frozen" until the governed Dime 1.0 release gates pass.
 *
 * The alpha is fail-closed. Every condition below must be present and exact:
 *   - explicit enable flag
 *   - disengaged kill switch
 *   - explicit acknowledgement that this is not Dime 1.0
 *   - a private endpoint plus bearer token
 *   - the exact approved control model and pinned revision
 *
 * Missing, malformed, contradictory, or future-model values keep the lane
 * inactive. No secret or endpoint URL is returned from this resolver.
 */

import { resolveDime1Config, type Dime1Env } from "./dime1Client";
import {
  DIME_RESEARCH_ALPHA_BASE_MODEL,
  DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
} from "./dime1Model";

export const DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT =
  "temporary-control-not-dime-v1";

export type DimeResearchAlphaInactiveReason =
  | "kill_switch_engaged_or_unset"
  | "not_enabled"
  | "acknowledgement_missing_or_invalid"
  | "endpoint_missing"
  | "bearer_token_missing"
  | "model_missing_or_invalid"
  | "revision_missing_or_invalid";

export type DimeResearchAlphaGate =
  | {
      active: true;
      deploymentTier: "research-alpha";
      model: typeof DIME_RESEARCH_ALPHA_BASE_MODEL;
      revision: typeof DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION;
      endpointSource: "explicit" | "runpod";
    }
  | {
      active: false;
      reason: DimeResearchAlphaInactiveReason;
    };

function readEnv(env: Dime1Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function resolveDimeResearchAlphaGate(
  env: Dime1Env = process.env
): DimeResearchAlphaGate {
  // The kill switch is checked first and defaults to engaged. It wins over
  // every other setting, including a valid endpoint configuration.
  if (readEnv(env, "DIME_RESEARCH_ALPHA_KILL_SWITCH") !== "false") {
    return { active: false, reason: "kill_switch_engaged_or_unset" };
  }

  if (readEnv(env, "DIME_RESEARCH_ALPHA_ENABLED") !== "true") {
    return { active: false, reason: "not_enabled" };
  }

  if (
    readEnv(env, "DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT") !==
    DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT
  ) {
    return { active: false, reason: "acknowledgement_missing_or_invalid" };
  }

  const config = resolveDime1Config(env);
  if (!config) {
    return { active: false, reason: "endpoint_missing" };
  }
  if (!config.bearerToken) {
    return { active: false, reason: "bearer_token_missing" };
  }
  if (config.model !== DIME_RESEARCH_ALPHA_BASE_MODEL) {
    return { active: false, reason: "model_missing_or_invalid" };
  }
  if (
    readEnv(env, "DIME_RESEARCH_ALPHA_MODEL_REVISION") !==
    DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION
  ) {
    return { active: false, reason: "revision_missing_or_invalid" };
  }

  return {
    active: true,
    deploymentTier: "research-alpha",
    model: DIME_RESEARCH_ALPHA_BASE_MODEL,
    revision: DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
    endpointSource: config.source,
  };
}
