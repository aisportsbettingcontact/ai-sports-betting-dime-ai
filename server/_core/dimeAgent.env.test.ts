/**
 * agentEnv() allowlist contract
 * ---------------------------------------------------------------
 * The Claude Code subprocess spawned by the Agent SDK can be granted
 * Bash via allowedTools, so every var in its env is readable from
 * inside the agent. agentEnv() must therefore be an explicit
 * allowlist — process basics + Anthropic routing — and NEVER a
 * process.env spread that leaks server secrets (DATABASE_URL,
 * Stripe, Discord, VSIN/KenPom, session/JWT, cron tokens, …).
 *
 * Regression guard for the original bug: `const env = { ...process.env }`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { agentEnv } from "./dimeAgent";

/** Every one of these must be absent from the subprocess env. */
const HARD_DENY = {
  DATABASE_URL: "mysql://user:pw@prod-host/db",
  APP_SESSION_SECRET: "session-secret",
  JWT_SECRET: "jwt-secret",
  STRIPE_SECRET_KEY: "sk_live_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_fake",
  DISCORD_BOT_TOKEN: "discord-bot-token",
  DISCORD_CLIENT_SECRET: "discord-client-secret",
  GMAIL_APP_PASSWORD: "gmail-app-pw",
  VSIN_EMAIL: "vsin@example.com",
  VSIN_PASSWORD: "vsin-pw",
  KENPOM_EMAIL: "kenpom@example.com",
  KENPOM_PASSWORD: "kenpom-pw",
  METABET_API_KEY: "metabet-key",
  CRON_SECRET: "cron-secret",
  HEARTBEAT_TOKEN: "heartbeat-token",
  ANALYTICS_INGEST_SECRET: "analytics-secret",
  AWS_ACCESS_KEY_ID: "AKIAFAKE",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  HF_TOKEN: "hf_fake",
  RUNPOD_API_KEY: "runpod-key",
  RAILWAY_TOKEN: "railway-token",
  SOME_RANDOM_VAR: "not-allowlisted-either",
} as const;

const ANTHROPIC_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  // Deterministic Anthropic state per test; each test sets what it needs.
  for (const k of ANTHROPIC_KEYS) delete process.env[k];
  Object.assign(process.env, HARD_DENY);
});

afterEach(() => {
  // Full restore: drop anything a test added, put back exactly what was there.
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe("agentEnv allowlist", () => {
  it("never leaks secrets or non-allowlisted vars into the subprocess env", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "gw-token";
    const env = agentEnv();
    for (const key of Object.keys(HARD_DENY)) {
      expect(env, `${key} must not reach the Claude Code subprocess`).not.toHaveProperty(key);
    }
  });

  it("uses gateway routing when the auth token is set: token + base URL + EMPTY api key", () => {
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example.com";
    process.env.ANTHROPIC_AUTH_TOKEN = "gw-token";
    process.env.ANTHROPIC_API_KEY = "sk-ant-direct"; // must lose to the token
    const env = agentEnv();
    expect(env.ANTHROPIC_BASE_URL).toBe("https://gateway.example.com");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("gw-token");
    // Empty string, not unset — Claude Code checks ANTHROPIC_API_KEY first.
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("falls back to the direct api key when no auth token is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-direct";
    const env = agentEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-direct");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
  });

  it("carries process basics through, but only when set in the parent", () => {
    process.env.TZ = "America/Los_Angeles";
    process.env.NODE_ENV = "test";
    process.env.DIME_AGENT_MODEL = "claude-fable-5";
    delete process.env.LC_ALL;
    const env = agentEnv();
    expect(env.PATH).toBe(process.env.PATH); // always present in practice
    expect(env.TZ).toBe("America/Los_Angeles");
    expect(env.NODE_ENV).toBe("test");
    expect(env.DIME_AGENT_MODEL).toBe("claude-fable-5");
    expect(env).not.toHaveProperty("LC_ALL"); // unset in parent → not created
  });

  it("is not a process.env spread: output size stays bounded by the allowlist", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "gw-token";
    const env = agentEnv();
    // 11 allowlisted basics + 3 Anthropic routing vars is the ceiling.
    expect(Object.keys(env).length).toBeLessThanOrEqual(14);
  });
});
