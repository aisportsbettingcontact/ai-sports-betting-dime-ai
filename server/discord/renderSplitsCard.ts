/**
 * renderSplitsCard.ts
 *
 * Uses Playwright (headless Chromium) to render the splits_card.html template
 * with injected game data and screenshot it to a PNG buffer.
 *
 * Performance architecture:
 *  - Browser is launched ONCE at startup via warmUpRenderer() and kept alive
 *    (singleton). Cold-start (~8-9s) is paid once on boot, never on a command.
 *  - Template HTML is read from disk ONCE at module load and cached in memory.
 *  - Logos are fetched and cached as base64 data URIs (in-memory, per-process).
 *  - Away and home logos are fetched in PARALLEL (Promise.all).
 *  - A pool of pre-warmed blank pages is maintained so setContent() starts
 *    from a warm page rather than a cold about:blank.
 */

import { chromium, type Browser, type Page } from "playwright";
import { exec as execCb } from "child_process";
import { promisify } from "util";
const execAsync = promisify(execCb);
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "splits_card.html");

// ─── Template cache: read once at module load ─────────────────────────────────
// Reading splits_card.html (1.1 MB with embedded fonts) on every render adds
// unnecessary I/O. Cache it in memory at module load time.
// Template cache: reset on server restart. HTML updated: logo circle bg fix (2026-03-25)
let _templateHtml: string | null = null;

function getTemplateHtml(): string {
  if (_templateHtml) return _templateHtml;
  const t0 = Date.now();
  _templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  console.log(`[SplitsRenderer] Template loaded from disk: ${(_templateHtml.length / 1024).toFixed(0)} KB in ${Date.now() - t0}ms`);
  return _templateHtml;
}

// ─── Logo cache: URL → base64 data URI ───────────────────────────────────────
const _logoCache = new Map<string, string>();

/**
 * Fetches a logo URL and returns a base64 data URI.
 * Results are cached in memory so each logo is only fetched once per process.
 */
async function fetchLogoAsDataUri(url: string): Promise<string | null> {
  if (_logoCache.has(url)) return _logoCache.get(url)!;
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        console.warn(`[SplitsRenderer] Logo fetch failed (${res.statusCode}): ${url}`);
        resolve(null);
        return;
      }
      const contentType = res.headers["content-type"] || "image/svg+xml";
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const b64 = Buffer.concat(chunks).toString("base64");
        const dataUri = `data:${contentType};base64,${b64}`;
        _logoCache.set(url, dataUri);
        console.log(`[SplitsRenderer] Logo cached: ${url.split("/").slice(-3).join("/")} (${b64.length} chars)`);
        resolve(dataUri);
      });
    });
    req.on("error", (err: Error) => {
      console.warn(`[SplitsRenderer] Logo fetch error: ${url} — ${err.message}`);
      resolve(null);
    });
    req.on("timeout", () => {
      req.destroy();
      console.warn(`[SplitsRenderer] Logo fetch timeout: ${url}`);
      resolve(null);
    });
  });
}

// ─── Singleton browser instance ───────────────────────────────────────────────
let _browser: Browser | null = null;
let _warmUpPromise: Promise<void> | null = null;

/**
 * Returns the singleton browser, launching it if necessary.
 * In normal operation this should never launch (warmUpRenderer() does it at
 * startup), but it acts as a safety net for the first call.
 */
async function ensurePlaywrightBrowsers(): Promise<void> {
  const execPath = chromium.executablePath();
  console.log(`[SplitsRenderer] Checking Chromium binary at: ${execPath}`);
  if (!fs.existsSync(execPath)) {
    console.warn(`[SplitsRenderer] ⚠️  Chromium binary NOT found — running playwright install (async, non-blocking)...`);
    try {
      // CRITICAL: Use async exec (not execSync) to avoid blocking the Node.js event loop.
      // execSync with a 120s timeout would freeze ALL incoming HTTP requests (including
      // Discord login /connect) for up to 2 minutes on every cold start after deployment.
      const cliPath = require.resolve("playwright/cli");
      const { stdout, stderr } = await execAsync(
        `node ${cliPath} install chromium`,
        { timeout: 180_000 }
      );
      if (stdout) console.log(`[SplitsRenderer] playwright install stdout: ${stdout.slice(0, 500)}`);
      if (stderr) console.log(`[SplitsRenderer] playwright install stderr: ${stderr.slice(0, 500)}`);
      console.log(`[SplitsRenderer] ✅ Chromium installed successfully`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SplitsRenderer] ❌ playwright install FAILED: ${msg}`);
      throw new Error(`Playwright Chromium install failed: ${msg}`);
    }
  } else {
    console.log(`[SplitsRenderer] ✅ Chromium binary exists (${(fs.statSync(execPath).size / 1024 / 1024).toFixed(0)} MB)`);
  }
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  console.log("[SplitsRenderer] Launching headless Chromium...");
  const t0 = Date.now();
  // Auto-install browser if missing (e.g. after deployment to a new host)
  await ensurePlaywrightBrowsers();
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--force-device-scale-factor=2",
    ],
  });
  console.log(`[SplitsRenderer] Chromium ready in ${Date.now() - t0}ms`);
  return _browser;
}

// ─── Warm-page pool ───────────────────────────────────────────────────────────
// We keep a small pool of pre-opened blank pages. When a render starts, it
// claims a page from the pool (or opens a new one if the pool is empty).
// After rendering, the page is closed (not returned to the pool) to avoid
// stale state. The pool is refilled asynchronously after each render.
const PAGE_POOL_SIZE = 2;
const _pagePool: Page[] = [];

async function refillPagePool(): Promise<void> {
  try {
    const browser = await getBrowser();
    while (_pagePool.length < PAGE_POOL_SIZE) {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1160, height: 700 });
      // Pre-navigate to about:blank so the page is fully initialised
      await page.goto("about:blank");
      _pagePool.push(page);
    }
  } catch {
    // Non-fatal — pool will be empty and renderSplitsCard will open a fresh page
  }
}

async function claimPage(): Promise<Page> {
  if (_pagePool.length > 0) {
    const page = _pagePool.pop()!;
    // Verify the page is still usable
    try {
      await page.evaluate(() => true);
      return page;
    } catch {
      // Page is stale — fall through to open a new one
    }
  }
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1160, height: 700 });
  return page;
}

/**
 * Warm up the renderer: launch Chromium, pre-load the template, and fill the
 * page pool. Call this once at bot startup so the first /splits command is fast.
 */
export async function warmUpRenderer(): Promise<void> {
  if (_warmUpPromise) return _warmUpPromise;
  _warmUpPromise = (async () => {
    const t0 = Date.now();
    console.log("[SplitsRenderer] Warming up — launching Chromium and pre-loading template...");
    try {
      // 1. Launch browser
      await getBrowser();
      // 2. Cache template HTML from disk
      getTemplateHtml();
      // 3. Fill page pool
      await refillPagePool();
      console.log(`[SplitsRenderer] ✅ Warm-up complete in ${Date.now() - t0}ms — browser ready, ${_pagePool.length} page(s) pooled`);
    } catch (err) {
      console.error("[SplitsRenderer] Warm-up failed:", err);
      _warmUpPromise = null; // Allow retry
    }
  })();
  return _warmUpPromise;
}

/** Call this on bot shutdown to cleanly close the browser */
export async function closeSplitsRenderer(): Promise<void> {
  // Drain and close pooled pages
  while (_pagePool.length > 0) {
    const p = _pagePool.pop()!;
    await p.close().catch(() => {});
  }
  if (_browser) {
    await _browser.close();
    _browser = null;
    _warmUpPromise = null;
    console.log("[SplitsRenderer] Browser closed");
  }
}

// ─── Data types ──────────────────────────────────────────────────────────────

export interface SplitsCardTeam {
  city: string;       // e.g. "Oklahoma City"
  name: string;       // e.g. "Thunder"
  abbr: string;       // e.g. "OKC"
  primary: string;    // hex
  secondary: string;  // hex
  dark: string;       // hex (darkest shade for logo gradient)
  logoBg: string;     // hex (circle background — highest contrast against logo SVG)
  logoBgDark: string; // hex (circle gradient edge — slightly darker than logoBg)
  logoText: string;   // hex (text color inside logo circle)
  logoUrl?: string;   // CDN URL for team logo image (optional)
  logoSize?: string;  // font-size for abbr fallback, e.g. "17px"
}

export interface SplitsCardData {
  away: SplitsCardTeam;
  home: SplitsCardTeam;
  league: string;     // "NBA" | "NHL" | "NCAAM"
  time: string;       // "7:30 PM ET"
  date: string;       // "March 23, 2026"
  liveSplits: boolean;

  spread: {
    awayLine: string | null;  // e.g. "-1.5"
    homeLine: string | null;  // e.g. "+1.5"
    tickets: { away: number; home: number };
    money:   { away: number; home: number };
  };
  total: {
    line: string | null;      // e.g. "5.5"
    tickets: { over: number; under: number };
    money:   { over: number; under: number };
  };
  moneyline: {
    awayLine: string | null;  // e.g. "-192"
    homeLine: string | null;  // e.g. "+160"
    tickets: { away: number; home: number };
    money:   { away: number; home: number };
  };
}

// ─── Main render function ─────────────────────────────────────────────────────

/**
 * Renders a splits card for one game and returns a PNG buffer.
 *
 * @param data - Fully populated SplitsCardData for the game
 * @returns PNG buffer ready to attach to a Discord message
 */
export async function renderSplitsCard(data: SplitsCardData): Promise<Buffer> {
  const t0 = Date.now();
  const matchup = `${data.away.abbr} @ ${data.home.abbr}`;
  console.log(`[SplitsRenderer] Rendering: ${matchup} (${data.league})`);

  // ── Phase 1: Parallel logo fetch + template read ──────────────────────────
  // Fetch both logos concurrently and read the template from cache.
  const tFetch0 = Date.now();
  const [awayDataUri, homeDataUri, templateHtml] = await Promise.all([
    data.away.logoUrl ? fetchLogoAsDataUri(data.away.logoUrl) : Promise.resolve(null),
    data.home.logoUrl ? fetchLogoAsDataUri(data.home.logoUrl) : Promise.resolve(null),
    Promise.resolve(getTemplateHtml()),
  ]);
  console.log(`[SplitsRenderer] ${matchup} — logos+template ready in ${Date.now() - tFetch0}ms`);

  const enrichedData = {
    ...data,
    away: { ...data.away },
    home: { ...data.home },
  };

  if (awayDataUri) {
    enrichedData.away.logoUrl = awayDataUri;
    console.log(`[SplitsRenderer] Away logo embedded: ${data.away.abbr}`);
  } else if (data.away.logoUrl) {
    console.warn(`[SplitsRenderer] Away logo unavailable, using abbr fallback: ${data.away.abbr}`);
    enrichedData.away.logoUrl = undefined;
  }

  if (homeDataUri) {
    enrichedData.home.logoUrl = homeDataUri;
    console.log(`[SplitsRenderer] Home logo embedded: ${data.home.abbr}`);
  } else if (data.home.logoUrl) {
    console.warn(`[SplitsRenderer] Home logo unavailable, using abbr fallback: ${data.home.abbr}`);
    enrichedData.home.logoUrl = undefined;
  }

  // ── Phase 2: Inject data into template ───────────────────────────────────
  const gameJson = JSON.stringify(enrichedData);
  const html = templateHtml.replace("__GAME_JSON__", gameJson.replace(/</g, "\\u003c"));

  // ── Phase 3: Claim a page and render ─────────────────────────────────────
  const tPage0 = Date.now();
  const page = await claimPage();
  console.log(`[SplitsRenderer] ${matchup} — page claimed in ${Date.now() - tPage0}ms`);

  // Capture browser console messages for debugging
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[SplitsRenderer][BrowserConsole] ${msg.text()}`);
    } else if (msg.type() !== "log") {
      console.log(`[SplitsRenderer][BrowserConsole] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.error(`[SplitsRenderer][PageError] ${err.message}`);
  });

  try {
    // Load HTML — logos are embedded as data URIs, no external requests needed
    const tContent0 = Date.now();
    await page.setContent(html, { waitUntil: "networkidle" });
    console.log(`[SplitsRenderer] ${matchup} — setContent in ${Date.now() - tContent0}ms`);

    // Wait for fonts to be ready
    await page.evaluate(() => document.fonts.ready);

    // Debug: check if card has content
    const cardHtml = await page.evaluate(() => {
      const el = document.getElementById("splits-card");
      return el
        ? `height=${el.offsetHeight} children=${el.children.length} innerHTML_len=${el.innerHTML.length}`
        : "NOT FOUND";
    });
    console.log(`[SplitsRenderer]   Card state: ${cardHtml}`);

    // Find the card element and screenshot just that
    const card = page.locator("#splits-card");
    const bbox = await card.boundingBox();
    if (!bbox) throw new Error("[SplitsRenderer] Could not locate #splits-card element");

    console.log(`[SplitsRenderer]   Card bbox: ${JSON.stringify(bbox)}`);

    const tShot0 = Date.now();
    const pngBuffer = await card.screenshot({
      type: "png",
      animations: "disabled",
      scale: "device",
    });
    console.log(`[SplitsRenderer] ${matchup} — screenshot in ${Date.now() - tShot0}ms`);

    console.log(`[SplitsRenderer] ✅ Done in ${Date.now() - t0}ms — ${pngBuffer.length} bytes`);
    return pngBuffer as Buffer;
  } finally {
    await page.close();
    // Refill the pool asynchronously — don't block the caller
    refillPagePool().catch(() => {});
  }
}
