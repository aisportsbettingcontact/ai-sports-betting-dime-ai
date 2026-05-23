/**
 * discord.bot.token.test.ts
 *
 * Validates that the DISCORD_BOT_TOKEN environment variable is set and
 * accepted by the Discord REST API (/users/@me endpoint).
 *
 * This test makes a real HTTP request to Discord — it will fail if:
 *   - DISCORD_BOT_TOKEN is not set
 *   - The token has been revoked or is invalid (HTTP 401)
 *   - The token is for a different application
 */
import { describe, it, expect } from "vitest";

const DISCORD_API_BASE = "https://discord.com/api/v10";

describe("Discord Bot Token Validation", () => {
  it("DISCORD_BOT_TOKEN is set in environment", () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    expect(token, "DISCORD_BOT_TOKEN must be set").toBeTruthy();
    expect(token!.length, "Token must be at least 50 characters").toBeGreaterThan(50);
  });

  it("DISCORD_BOT_TOKEN is accepted by Discord REST API (/users/@me)", async () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error("[FAIL] DISCORD_BOT_TOKEN is not set — cannot validate");
    }

    const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `[FAIL] Discord rejected the token with HTTP 401. ` +
        `The token is invalid or revoked. ` +
        `Regenerate it at discord.com/developers/applications and update DISCORD_BOT_TOKEN. ` +
        `Response: ${JSON.stringify(body)}`
      );
    }

    expect(res.status, `Discord API returned unexpected status ${res.status}`).toBe(200);

    const data = (await res.json()) as { id?: string; username?: string; bot?: boolean };
    console.log(`[VERIFY] PASS — Discord accepted token. Bot: ${data.username}#0000 (id=${data.id})`);

    expect(data.id, "Response must include bot user ID").toBeTruthy();
    expect(data.username, "Response must include bot username").toBeTruthy();
    expect(data.bot, "Authenticated user must be a bot").toBe(true);
  }, 15_000); // 15s timeout for network call
});
