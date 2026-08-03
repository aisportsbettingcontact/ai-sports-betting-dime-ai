import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DIME_RUNTIME_READINESS_VERSION,
  formatDimeRuntimeReadinessLog,
  getDimeRuntimeReadiness,
} from "./dimeRuntimeReadiness";
import { DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT } from "./dimeResearchAlpha";
import {
  DIME_RESEARCH_ALPHA_BASE_MODEL,
  DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
} from "./dime1Model";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const routerSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "routers", "dimeRuntime.ts"),
  "utf8"
);

const COMPLETE_ALPHA_ENV = {
  DIME_RESEARCH_ALPHA_ENABLED: "true",
  DIME_RESEARCH_ALPHA_KILL_SWITCH: "false",
  DIME_RESEARCH_ALPHA_ACKNOWLEDGEMENT,
  DIME_RESEARCH_ALPHA_MODEL_REVISION: DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
  DIME_CHAT_TRACE_V1_ENABLED: "true",
  DIME_ANSWER_ROUTING_V1_ENABLED: "true",
  RUNPOD_ENDPOINT_ID: "alpha-endpoint",
  RUNPOD_API_KEY: "private-endpoint-key",
  DIME_MODEL_VERSION: DIME_RESEARCH_ALPHA_BASE_MODEL,
};

describe("Dime Chat Runtime Readiness v1", () => {
  it("exposes readiness through the DB-authoritative owner procedure only", () => {
    expect(routerSource).toMatch(
      /readiness:\s*ownerProcedure\.query\(\(\) => getDimeRuntimeReadiness\(\)\)/
    );
    expect(routerSource).not.toContain("publicProcedure");
    expect(routerSource).not.toContain("appUserProcedure");
  });

  it("reports the default pi runtime without credentials as deterministic-only and limited", () => {
    const readiness = getDimeRuntimeReadiness({ env: {}, now: NOW });

    expect(readiness).toMatchObject({
      version: DIME_RUNTIME_READINESS_VERSION,
      generatedAt: NOW.toISOString(),
      state: "limited",
      mode: "anthropic",
      capabilities: {
        generativeLaneConfigured: false,
        deterministicResponsesConfigured: true,
        serverAuthoritativeTraceConfigured: false,
      },
      answerRouting: {
        enabled: true,
        source: "default",
        configuredValueValid: true,
        defaultWhenUnset: true,
      },
      trace: {
        enabled: false,
        source: "default",
      },
      researchAlpha: {
        active: false,
        requested: false,
        killSwitchEngaged: true,
        reason: "kill_switch_engaged_or_unset",
      },
    });
    expect(readiness.issues).toEqual([
      "trace_disabled",
      "anthropic_credentials_missing",
    ]);
  });

  it("reports offline when both provider generation and deterministic routing are off", () => {
    const readiness = getDimeRuntimeReadiness({
      env: { DIME_ANSWER_ROUTING_V1_ENABLED: "false" },
      now: NOW,
    });

    expect(readiness.state).toBe("offline");
    expect(readiness.capabilities).toMatchObject({
      generativeLaneConfigured: false,
      deterministicResponsesConfigured: false,
    });
    expect(readiness.issues).toContain("answer_routing_disabled");
  });

  it("preserves the existing routing behavior while surfacing malformed configuration", () => {
    const readiness = getDimeRuntimeReadiness({
      env: { DIME_ANSWER_ROUTING_V1_ENABLED: "flase" },
      now: NOW,
    });

    expect(readiness.answerRouting.enabled).toBe(true);
    expect(readiness.answerRouting.configuredValueValid).toBe(false);
    expect(readiness.issues).toContain("answer_routing_config_invalid");
  });

  it("reports a fully configured Research Alpha lane only with routing and Trace enabled", () => {
    const readiness = getDimeRuntimeReadiness({
      env: COMPLETE_ALPHA_ENV,
      now: NOW,
    });

    expect(readiness).toMatchObject({
      state: "configured",
      mode: "research-alpha",
      capabilities: {
        generativeLaneConfigured: true,
        deterministicResponsesConfigured: true,
        serverAuthoritativeTraceConfigured: true,
      },
      researchAlpha: {
        active: true,
        requested: true,
        killSwitchEngaged: false,
      },
      endpoint: {
        configured: true,
        credentialConfigured: true,
        explicitModelConfigured: true,
        source: "runpod",
      },
      issues: [],
    });
  });

  it("reports incomplete alpha intent without exposing endpoint or credential values", () => {
    const secret = "do-not-return-this-token";
    const endpoint = "https://private.example/v1";
    const readiness = getDimeRuntimeReadiness({
      env: {
        DIME_RESEARCH_ALPHA_ENABLED: "true",
        DIME_RESEARCH_ALPHA_KILL_SWITCH: "false",
        DIME_MODEL_BASE_URL: endpoint,
        DIME_MODEL_API_SECRET: secret,
      },
      now: NOW,
    });
    const serialized = JSON.stringify(readiness);

    expect(readiness.state).toBe("limited");
    expect(readiness.issues).toContain("research_alpha_config_incomplete");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(endpoint);
  });

  it("does not call a future Dime provider configured until endpoint credentials exist", () => {
    const missing = getDimeRuntimeReadiness({
      env: {
        DIME_CHAT_TRACE_V1_ENABLED: "true",
      },
      provider: "dime1",
      now: NOW,
    });
    const complete = getDimeRuntimeReadiness({
      env: {
        DIME_CHAT_TRACE_V1_ENABLED: "true",
        DIME_MODEL_BASE_URL: "https://private.example/v1",
        DIME_MODEL_API_SECRET: "private-secret",
      },
      provider: "dime1",
      now: NOW,
    });

    expect(missing.state).toBe("limited");
    expect(missing.capabilities.generativeLaneConfigured).toBe(false);
    expect(missing.issues).toContain("dime_endpoint_missing");
    expect(complete.state).toBe("configured");
    expect(complete.capabilities.generativeLaneConfigured).toBe(true);
  });

  it("formats bounded startup telemetry without raw configuration", () => {
    const readiness = getDimeRuntimeReadiness({ env: {}, now: NOW });
    expect(formatDimeRuntimeReadinessLog(readiness)).toBe(
      "[DIME_RUNTIME] version=dime-chat-runtime-readiness-v1 state=limited mode=anthropic routing=on trace=off issues=trace_disabled,anthropic_credentials_missing"
    );
  });
});
