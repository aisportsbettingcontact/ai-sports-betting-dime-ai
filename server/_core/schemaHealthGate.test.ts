import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSchemaGateForTest,
  currentSchemaVerdict,
  hasSchemaProbed,
  runSchemaProbe,
  schemaGateEnabled,
  shouldFailHealthForSchema,
} from "./schemaHealthGate";

describe("schemaHealthGate", () => {
  const orig = process.env.SCHEMA_HEALTHGATE;
  beforeEach(() => {
    delete process.env.SCHEMA_HEALTHGATE;
    __resetSchemaGateForTest();
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.SCHEMA_HEALTHGATE;
    else process.env.SCHEMA_HEALTHGATE = orig;
    __resetSchemaGateForTest();
  });

  it("starts unknown / unprobed and does not fail health", () => {
    expect(currentSchemaVerdict()).toBe("unknown");
    expect(hasSchemaProbed()).toBe(false);
    expect(shouldFailHealthForSchema()).toBe(false);
  });

  it("enabled by default; disabled only via SCHEMA_HEALTHGATE=off", () => {
    expect(schemaGateEnabled()).toBe(true);
    process.env.SCHEMA_HEALTHGATE = "off";
    expect(schemaGateEnabled()).toBe(false);
    process.env.SCHEMA_HEALTHGATE = "OFF";
    expect(schemaGateEnabled()).toBe(false);
    process.env.SCHEMA_HEALTHGATE = "on";
    expect(schemaGateEnabled()).toBe(true);
  });

  it("a confirmed mismatch fails health", async () => {
    await runSchemaProbe(async () => "schema_mismatch");
    expect(currentSchemaVerdict()).toBe("schema_mismatch");
    expect(hasSchemaProbed()).toBe(true);
    expect(shouldFailHealthForSchema()).toBe(true);
  });

  it("ok and unknown NEVER fail health (a DB blip must not freeze deploys)", async () => {
    await runSchemaProbe(async () => "ok");
    expect(shouldFailHealthForSchema()).toBe(false);
    await runSchemaProbe(async () => "unknown");
    expect(currentSchemaVerdict()).toBe("unknown");
    expect(shouldFailHealthForSchema()).toBe(false);
  });

  it("a throwing probe resolves to unknown, never a false mismatch", async () => {
    await runSchemaProbe(async () => {
      throw new Error("boom");
    });
    expect(currentSchemaVerdict()).toBe("unknown");
    expect(shouldFailHealthForSchema()).toBe(false);
  });

  it("SCHEMA_HEALTHGATE=off suppresses the 503 even on a real mismatch (emergency escape hatch)", async () => {
    await runSchemaProbe(async () => "schema_mismatch");
    expect(shouldFailHealthForSchema()).toBe(true);
    process.env.SCHEMA_HEALTHGATE = "off";
    expect(shouldFailHealthForSchema()).toBe(false);
    // Verdict is still recorded for observability even when the gate is off.
    expect(currentSchemaVerdict()).toBe("schema_mismatch");
  });
});
