/**
 * Discord bot availability contract + the dependency fault that killed it.
 *
 * ── What actually happened (2026-08-01) ──────────────────────────────────────
 * A blanket pnpm override, `"undici": ">=8.5.0 <9.0.0"`, was added to patch
 * CVEs. It overrode the EXACT pin (`undici: 6.24.1`) declared by both
 * discord.js and @discordjs/rest, installing undici 8.7.0 instead.
 *
 * undici 8 contradicts itself: `request()` returns a response-headers object
 * carrying `Symbol(sensitiveHeaders)`, while its own `Headers` constructor
 * rejects symbol keys. @discordjs/rest does exactly `new Headers(res.headers)`,
 * so EVERY Discord REST call threw:
 *
 *   TypeError: Headers constructor: Key Symbol(sensitiveHeaders) in init is a
 *   symbol, which cannot be converted to a ByteString.
 *
 * Verified across versions: 6.28.0 OK · 7.29.0 OK · 8.5.0/8.7.0/8.9.0 BROKEN.
 * The whole 8.x line is unusable here, including the latest — so "bump undici"
 * is not a fix, and the resolution must stay on a working major.
 *
 * These tests guard the two independent failures. Either one alone takes the
 * bot down; both had to be fixed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const overrides: Record<string, string> = pkg.pnpm?.overrides ?? {};
const botSrc = readFileSync(resolve(repoRoot, "server/discord/bot.ts"), "utf8");

/**
 * bot.ts with comments removed.
 *
 * The "no terminal state" assertions are about behaviour, and the file's own
 * docblock quotes the old halt message to explain the outage. Matching raw
 * source would fail on that documentation — which is exactly what happened when
 * these tests were first written. Assert against code.
 */
const botCode = botSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Majors proven to round-trip their own response headers through Headers(). */
const WORKING_UNDICI_MAJORS = [6, 7];

function majorOf(spec: string): number {
  const m = /(\d+)\./.exec(spec);
  return m ? Number(m[1]) : NaN;
}

describe("undici resolution — the root cause", () => {
  it("does NOT reinstate a blanket undici override", () => {
    // A bare "undici" key overrides every consumer at once, including the two
    // Discord packages that pin an exact version. That is what broke the bot.
    expect(Object.keys(overrides)).not.toContain("undici");
  });

  it("pins discord.js and @discordjs/rest to a major that actually works", () => {
    for (const key of ["discord.js>undici", "@discordjs/rest>undici"]) {
      expect(overrides[key], `${key} must be pinned`).toBeTruthy();
      expect(
        WORKING_UNDICI_MAJORS,
        `${key}=${overrides[key]} — undici 8.x cannot consume its own response headers`
      ).toContain(majorOf(overrides[key]));
    }
  });

  it("keeps those pins at or above 6.27.0, where the HIGH-severity CVE is fixed", () => {
    // GHSA-vxpw-j846-p89q (WebSocket DoS) is fixed in 6.27.0 / 7.28.0 / 8.5.0.
    // Reverting to the previously-pinned 6.24.1 would trade an outage for a CVE.
    for (const key of ["discord.js>undici", "@discordjs/rest>undici"]) {
      const [maj, min] = overrides[key].split(".").map(Number);
      expect(maj === 6 ? min >= 27 : min >= 28, `${key}=${overrides[key]} is below the patched floor`).toBe(true);
    }
  });

  it("leaves non-Discord consumers on their own declared major", () => {
    // cheerio declares ^7.19.0 and is unaffected by the Headers round-trip,
    // so it must not be dragged onto the Discord packages' major.
    expect(majorOf(overrides["cheerio>undici"])).toBe(7);
  });
});

describe("bot supervisor — no terminal state", () => {
  it("has no max-attempt cap that can permanently halt the bot", () => {
    // The original halted after 10 consecutive failures and told the operator to
    // restart the server. That is precisely why an hours-long outage needed a
    // redeploy to clear.
    expect(botCode).not.toMatch(/MAX_RECONNECT_ATTEMPTS/);
    expect(botCode).not.toMatch(/Halting bot/i);
    expect(botCode).not.toMatch(/Restart the server to try again/i);
  });

  it("retries auth/config faults instead of giving up, so a token fix self-heals", () => {
    expect(botCode).toMatch(/AUTH_RETRY_MS/);
    // The config-fault branch must schedule another attempt, not return dead.
    expect(botCode).toMatch(/scheduleReconnect\(AUTH_RETRY_MS/);
  });

  it("destroys the previous client before building a new one", () => {
    // Every retry previously abandoned its Client, leaking sockets and listeners.
    expect(botCode).toMatch(/teardownClient\("rebuilding"\)/);
    expect(botCode).toMatch(/removeAllListeners\(\)/);
  });

  it("collapses concurrent reconnect signals into a single pending timer", () => {
    // Login rejection, shard disconnect and the watchdog can all fire for one
    // outage; without this guard they multiply into parallel reconnect storms.
    expect(botCode).toMatch(/if \(retryTimer\) return;/);
  });

  it("runs a watchdog for failures that emit no event at all", () => {
    expect(botCode).toMatch(/WATCHDOG_INTERVAL_MS/);
    expect(botCode).toMatch(/\[WATCHDOG\]/);
  });

  it("exposes real connection state rather than assuming health", () => {
    expect(botCode).toMatch(/export function getDiscordBotHealth/);
  });

  it("does not hand callers a client whose gateway is down", () => {
    expect(botCode).toMatch(/return isConnected\(\) \? botClient : null;/);
  });
});

describe("backoff", () => {
  it("grows exponentially and stays within the 5-minute ceiling", async () => {
    const { calcBackoffMs } = await import("./bot");
    // Jitter is ±30%, so assert against bounds rather than exact values.
    expect(calcBackoffMs(1)).toBeLessThanOrEqual(2_000 * 1.3);
    expect(calcBackoffMs(1)).toBeGreaterThanOrEqual(1_000);
    for (const n of [1, 5, 10, 50, 1000]) {
      const d = calcBackoffMs(n);
      expect(d).toBeGreaterThanOrEqual(1_000);
      expect(d, `attempt ${n} exceeded the ceiling`).toBeLessThanOrEqual(300_000 * 1.3);
    }
  });

  it("never returns a non-positive delay, which would busy-loop", () => {
    // Guards the Math.max(1_000, …) floor against a negative jitter draw.
    return import("./bot").then(({ calcBackoffMs }) => {
      for (let i = 0; i < 500; i++) expect(calcBackoffMs(1)).toBeGreaterThan(0);
    });
  });
});
