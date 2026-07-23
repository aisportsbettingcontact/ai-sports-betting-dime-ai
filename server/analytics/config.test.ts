import { describe, it, expect } from "vitest";
import {
  getAnalyticsRole,
  isAnalyticsStore,
  isAnalyticsForwarder,
  getBackendUrl,
  getIngestSecret,
} from "./config";

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

describe("analytics role resolution", () => {
  it("is 'store' ONLY with explicit ANALYTICS_ROLE=store", () => {
    expect(getAnalyticsRole(env({ ANALYTICS_ROLE: "store" }))).toBe("store");
    expect(isAnalyticsStore(env({ ANALYTICS_ROLE: "store" }))).toBe(true);
  });
  it("is 'forwarder' when a backend URL is set (and not store)", () => {
    expect(getAnalyticsRole(env({ USER_ACTIVITY_BACKEND_URL: "http://back.railway.internal:3000" }))).toBe("forwarder");
    expect(isAnalyticsForwarder(env({ USER_ACTIVITY_BACKEND_URL: "http://x" }))).toBe(true);
  });
  it("lets explicit store win if both signals somehow appear", () => {
    expect(getAnalyticsRole(env({ ANALYTICS_ROLE: "store", USER_ACTIVITY_BACKEND_URL: "http://x" }))).toBe("store");
  });
  it("defaults to 'disabled' with neither signal — cannot touch TiDB by accident", () => {
    expect(getAnalyticsRole(env({}))).toBe("disabled");
    // A web-like instance (TiDB DATABASE_URL, no analytics vars) is disabled, never store.
    expect(getAnalyticsRole(env({ DATABASE_URL: "mysql://root:x@gateway.tidbcloud.com:4000/app" }))).toBe("disabled");
    expect(isAnalyticsStore(env({ DATABASE_URL: "mysql://root:x@gateway.tidbcloud.com:4000/app" }))).toBe(false);
  });
  it("does not treat a blank backend URL as forwarder", () => {
    expect(getAnalyticsRole(env({ USER_ACTIVITY_BACKEND_URL: "   " }))).toBe("disabled");
  });
});

describe("config accessors", () => {
  it("trims and strips trailing slashes from the backend URL", () => {
    expect(getBackendUrl(env({ USER_ACTIVITY_BACKEND_URL: " http://b:3000/ " }))).toBe("http://b:3000");
    expect(getBackendUrl(env({}))).toBeNull();
  });
  it("reads the ingest secret (null when absent or blank)", () => {
    expect(getIngestSecret(env({ ANALYTICS_INGEST_SECRET: "s3cret" }))).toBe("s3cret");
    expect(getIngestSecret(env({ ANALYTICS_INGEST_SECRET: "  " }))).toBeNull();
    expect(getIngestSecret(env({}))).toBeNull();
  });
});
