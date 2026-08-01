/**
 * /health reports integration state.
 *
 * A deploy left the Discord bot's status genuinely unknowable: it logged
 * "Connecting (attempt 1)" and then nothing, because an MLB schedule backfill
 * flooded the boot window with thousands of lines. Whether the bot was up had
 * to be INFERRED from the absence of a watchdog line — which is exactly the
 * observability failure the supervisor was built to end.
 *
 * getDiscordBotHealth() already existed and was wired to nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
const health = src.slice(src.indexOf('app.get("/health"'), src.indexOf('app.get("/api/db-status"'));

describe("/health exposes integration state", () => {
  it("reports the Discord bot", () => {
    expect(health).toMatch(/getDiscordBotHealth\(\)/);
    for (const f of ["connected", "consecutiveFailures", "totalReconnects", "lastReadyAt", "retryQueued"]) {
      expect(health, `${f} missing`).toContain(f);
    }
  });

  it("reports whether billing alerts can reach a human", () => {
    expect(health).toMatch(/billingAlerts/);
    expect(health).toMatch(/configured: Boolean\(/);
  });

  it("exposes uptime so a flapping bot is distinguishable from a stable one", () => {
    // connected=true tells you it is up now; uptimeMs tells you whether it has
    // been up for an hour or reconnected four seconds ago.
    expect(health).toMatch(/uptimeMs/);
  });
});

describe("integration state must NOT drive the status code", () => {
  it("only the database decides 200 vs 503", () => {
    // Railway probes /health. Returning 503 while Discord's gateway reconnects
    // would restart the container and kill the supervisor that recovers it —
    // an outage manufactured by its own monitor.
    expect(health).toMatch(/res\.status\(dbOk \? 200 : 503\)/);
    const statusLine = /res\.status\(([^)]*)\)/.exec(health);
    expect(statusLine, "status expression not found").toBeTruthy();
    expect(statusLine![1]).not.toMatch(/discord|bot|connected/i);
  });

  it("status string is likewise db-only", () => {
    expect(health).toMatch(/status: dbOk \? "ok" : "degraded"/);
  });
});

describe("the public probe leaks nothing", () => {
  it("never returns the billing webhook URL, only whether it is set", () => {
    // /health is unauthenticated. A Discord webhook URL is a write capability.
    expect(health).not.toMatch(/BILLING_ALERT_DISCORD_WEBHOOK_URL\s*[,}]/);
    expect(health).toMatch(/configured: Boolean\(/);
  });

  it("caps the failure reason rather than echoing it unbounded", () => {
    expect(health).toMatch(/lastFailureReason.*slice\(0, 120\)/s);
  });

  it("does not expose the bot token or guild internals", () => {
    expect(health).not.toMatch(/discordBotToken|DISCORD_BOT_TOKEN/);
  });
});
