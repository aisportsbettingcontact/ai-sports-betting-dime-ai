import { describe, expect, it } from "vitest";
import {
  DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT,
  resolveDimeResearchAlphaGate,
} from "./dimeResearchAlpha";
import {
  DIME_RESEARCH_ALPHA_BASE_MODEL,
  DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
} from "./dime1Model";

const COMPLETE_ALPHA_ENV = {
  DIME_RESEARCH_ALPHA_ENABLED: "true",
  DIME_RESEARCH_ALPHA_KILL_SWITCH: "false",
  DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT,
  DIME_RESEARCH_ALPHA_MODEL_REVISION: DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
  RUNPOD_ENDPOINT_ID: "alpha-endpoint",
  RUNPOD_API_KEY: "private-endpoint-key",
  DIME_MODEL_VERSION: DIME_RESEARCH_ALPHA_BASE_MODEL,
};

describe("Dime Research Alpha gate", () => {
  it("defaults closed when no configuration is present", () => {
    expect(resolveDimeResearchAlphaGate({})).toEqual({
      active: false,
      reason: "kill_switch_engaged_or_unset",
    });
  });

  it.each([
    ["missing kill switch", "DIME_RESEARCH_ALPHA_KILL_SWITCH"],
    ["missing enable flag", "DIME_RESEARCH_ALPHA_ENABLED"],
    ["missing acknowledgement", "DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT"],
    ["missing pinned revision", "DIME_RESEARCH_ALPHA_MODEL_REVISION"],
    ["missing endpoint", "RUNPOD_ENDPOINT_ID"],
    ["missing bearer token", "RUNPOD_API_KEY"],
    ["missing explicit model", "DIME_MODEL_VERSION"],
  ])("stays closed with %s", (_label, key) => {
    const env = { ...COMPLETE_ALPHA_ENV };
    delete env[key as keyof typeof env];
    expect(resolveDimeResearchAlphaGate(env).active).toBe(false);
  });

  it("keeps the kill switch authoritative even when every other value is valid", () => {
    expect(
      resolveDimeResearchAlphaGate({
        ...COMPLETE_ALPHA_ENV,
        DIME_RESEARCH_ALPHA_KILL_SWITCH: "true",
      })
    ).toEqual({
      active: false,
      reason: "kill_switch_engaged_or_unset",
    });
  });

  it.each([
    ["enable flag", { DIME_RESEARCH_ALPHA_ENABLED: "1" }],
    ["kill switch", { DIME_RESEARCH_ALPHA_KILL_SWITCH: "FALSE" }],
    ["acknowledgement", { DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT: "approved" }],
    ["model", { DIME_MODEL_VERSION: "dime-1.0" }],
    ["revision", { DIME_RESEARCH_ALPHA_MODEL_REVISION: "main" }],
  ])("rejects an invalid %s value", (_label, override) => {
    expect(
      resolveDimeResearchAlphaGate({
        ...COMPLETE_ALPHA_ENV,
        ...override,
      }).active
    ).toBe(false);
  });

  it("activates only for the exact complete private control-model configuration", () => {
    expect(resolveDimeResearchAlphaGate(COMPLETE_ALPHA_ENV)).toEqual({
      active: true,
      deploymentTier: "research-alpha",
      model: DIME_RESEARCH_ALPHA_BASE_MODEL,
      revision: DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
      endpointSource: "runpod",
    });
  });

  it("also accepts a private explicit endpoint with its dedicated bearer secret", () => {
    const {
      RUNPOD_ENDPOINT_ID: _endpointId,
      RUNPOD_API_KEY: _runpodKey,
      ...rest
    } = COMPLETE_ALPHA_ENV;
    expect(
      resolveDimeResearchAlphaGate({
        ...rest,
        DIME_MODEL_BASE_URL: "https://private.example/v1",
        DIME_MODEL_API_SECRET: "dedicated-secret",
      })
    ).toMatchObject({
      active: true,
      endpointSource: "explicit",
    });
  });
});
