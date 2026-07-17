/**
 * renderLineupCard.ts
 *
 * Renders an MLB lineup card to a PNG buffer with a dedicated Playwright
 * (headless Chromium) browser singleton, launched once at bot startup via
 * warmUpLineupRenderer() and closed on shutdown via closeLineupRenderer().
 *
 * The lineup_card.html template is loaded once from disk and cached.
 * Data is injected via window.LINEUP_DATA before the script runs.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { chromium, type Browser, type Page } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "lineup_card.html");

// ─── Chromium executable path resolution ──────────────────────────────────────
// Same convention as server/wc2026/espnPageScraper.ts's CHROMIUM_PATH: prefer
// PLAYWRIGHT_CHROMIUM_PATH (set in the Dockerfile to the apt-installed
// /usr/bin/chromium), then fall back through the same candidate list. Every
// candidate — including the env var — is verified with fs.existsSync before
// use; if none exist this resolves to `undefined`, which is the signal to omit
// `executablePath` entirely so Playwright falls back to its own self-managed
// browser resolution (local dev with `playwright install` already run).
function resolveChromiumExecutablePath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "/home/ubuntu/.cache/ms-playwright/chromium-1161/chrome-linux/chrome",
    "/home/ubuntu/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/home/ubuntu/.cache/ms-playwright/chromium-1169/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

const CHROMIUM_EXECUTABLE_PATH: string | undefined = resolveChromiumExecutablePath();

// ─── Template cache ───────────────────────────────────────────────────────────
let _templateHtml: string | null = null;
function getTemplateHtml(): string {
  if (_templateHtml) return _templateHtml;
  const t0 = Date.now();
  _templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  console.log(`[LineupRenderer] Template loaded: ${(_templateHtml.length / 1024).toFixed(0)} KB in ${Date.now() - t0}ms`);
  return _templateHtml;
}

// ─── Browser singleton ────────────────────────────────────────────────────────
// Launched once (warmUpLineupRenderer() at bot startup, or lazily on the first
// render) and kept alive for the life of the process.
let _browser: Browser | null = null;
let _warmUpPromise: Promise<void> | null = null;

// ─── Quality constants ────────────────────────────────────────────────────────
// DPR=8 means every CSS pixel maps to 8×8 physical pixels.
// At 680px card width → 5440px physical output width → ultra-crisp on any display.
// This is a ~4x increase in linear resolution (16x pixel density) over DPR=4.
const DEVICE_SCALE = 8;
const VIEWPORT_WIDTH = 1360; // 2× card width so card never clips
const VIEWPORT_HEIGHT = 2400; // tall enough for 9-player lineups

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  console.log(`[LineupRenderer] Launching headless Chromium (DPR=${DEVICE_SCALE})...`);
  const t0 = Date.now();
  _browser = await chromium.launch({
    headless: true,
    // In the container this is the apt-installed /usr/bin/chromium (via
    // PLAYWRIGHT_CHROMIUM_PATH); undefined in local dev, so Playwright
    // resolves its own bundled browser.
    ...(CHROMIUM_EXECUTABLE_PATH ? { executablePath: CHROMIUM_EXECUTABLE_PATH } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      // Font quality — maximum subpixel rendering
      "--disable-lcd-text",
      "--enable-font-antialiasing",
      "--font-render-hinting=full",
      // Image quality — maximum fidelity
      "--force-color-profile=srgb",
    ],
  });
  console.log(`[LineupRenderer] Chromium ready in ${Date.now() - t0}ms`);
  return _browser;
}

// ─── Data types ───────────────────────────────────────────────────────────────

export interface LineupCardTeam {
  city: string;
  nickname: string;
  abbrev: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  darkColor: string;
  logoUrl: string;
}

export interface LineupCardPlayer {
  battingOrder: number;
  position: string;
  name: string;
  bats: string;
  mlbamId: number | null;
}

export interface LineupCardPitcher {
  name: string | null;
  hand: string | null;
  era: string | null;
  mlbamId: number | null;
  confirmed: boolean;
}

export interface LineupCardWeather {
  icon: string | null;
  temp: string | null;
  wind: string | null;
  precip: number | null;
  dome: boolean;
}

export interface LineupCardData {
  away: LineupCardTeam;
  home: LineupCardTeam;
  startTime: string;
  /** Game date in YYYY-MM-DD format, rendered inside the card above the start time */
  gameDate: string;
  lineup: {
    awayPitcher: LineupCardPitcher;
    homePitcher: LineupCardPitcher;
    awayPlayers: LineupCardPlayer[];
    homePlayers: LineupCardPlayer[];
    /** Whether the away batting lineup is confirmed (true) or expected (false) */
    awayLineupConfirmed: boolean;
    /** Whether the home batting lineup is confirmed (true) or expected (false) */
    homeLineupConfirmed: boolean;
    weather: LineupCardWeather | null;
  };
}

// ─── Main render function ─────────────────────────────────────────────────────

/**
 * Renders an MLB lineup card to a PNG buffer.
 * The card is 680px wide × auto height at 2x device pixel ratio.
 */
export async function renderLineupCard(data: LineupCardData): Promise<Buffer> {
  const t0 = Date.now();
  const matchup = `${data.away.abbrev} @ ${data.home.abbrev}`;
  console.log(`[LineupRenderer] Rendering: ${matchup}`);

  const templateHtml = getTemplateHtml();

  // Inject data into the template via script tag replacement
  const injectedHtml = templateHtml.replace(
    "// window.LINEUP_DATA is injected by renderLineupCard.ts before this script runs",
    `window.LINEUP_DATA = ${JSON.stringify(data)};`
  );

  const browser = await getBrowser();
  // Use browser context with deviceScaleFactor — this is the correct Playwright API
  // for controlling DPR. The --force-device-scale-factor flag is ignored in headless mode.
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DEVICE_SCALE,
  });
  const page: Page = await context.newPage();

  try {
    console.log(`[LineupRenderer] ${matchup} — viewport ${VIEWPORT_WIDTH}×${VIEWPORT_HEIGHT} DPR=${DEVICE_SCALE} (context-level)`);

    // Load the template HTML
    // Set transparent page background BEFORE setContent so the browser
    // renders the page with a transparent background, not white.
    // This eliminates the white corner pixels that appear outside the
    // card's border-radius when Playwright captures the bounding box.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setContent(injectedHtml, { waitUntil: "networkidle", timeout: 30_000 });
    // Override any residual white background on the page root
    await page.evaluate(() => {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
    });

    // Wait for images to load (player headshots)
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return imgs.every(img => img.complete);
    }, { timeout: 15_000 }).catch(() => {
      console.warn(`[LineupRenderer] ${matchup} — some images did not load in time (non-fatal)`);
    });

    // Screenshot just the card element
    const cardEl = await page.$("#card > div");
    if (!cardEl) {
      throw new Error("Card element not found in rendered HTML");
    }

    // scale: "device" captures at full DPR (8x) so output is 8× the CSS dimensions
    // omitBackground: true makes the Playwright screenshot use a transparent
    // background instead of white, so the rounded card corners are transparent
    // in the PNG rather than filled with white pixels.
    const buffer = await cardEl.screenshot({ type: "png", scale: "device", omitBackground: true });
    const sizeKb = (buffer.length / 1024).toFixed(0);
    const physW = Math.round(680 * DEVICE_SCALE);
    const physH = Math.round(buffer.length / (physW * 4)); // rough estimate
    console.log(`[LineupRenderer] ${matchup} — rendered in ${Date.now() - t0}ms | PNG size: ${sizeKb} KB | DPR: ${DEVICE_SCALE}x | ~${physW}px wide`);
    return buffer as Buffer;
  } finally {
    await page.close();
    await context.close();
  }
}

// Template cache version: v5 (8x DPR, w_360 headshots, larger fonts, ultra-crisp output)

/**
 * Warm up the renderer: launch Chromium and pre-load the template so the
 * first /lineups command doesn't pay the cold-start cost.
 */
export async function warmUpLineupRenderer(): Promise<void> {
  if (_warmUpPromise) return _warmUpPromise;
  _warmUpPromise = (async () => {
    const t0 = Date.now();
    console.log("[LineupRenderer] Warming up — launching Chromium and pre-loading template...");
    try {
      await getBrowser();
      getTemplateHtml();
      console.log(`[LineupRenderer] ✅ Warm-up complete in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error("[LineupRenderer] Warm-up failed:", err);
      _warmUpPromise = null; // allow retry
    }
  })();
  return _warmUpPromise;
}

/** Call this on bot shutdown to cleanly close the browser. */
export async function closeLineupRenderer(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _warmUpPromise = null;
    console.log("[LineupRenderer] Browser closed");
  }
}
