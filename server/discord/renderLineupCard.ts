/**
 * renderLineupCard.ts
 *
 * Renders an MLB lineup card to a PNG buffer using the shared Playwright
 * browser singleton from renderSplitsCard.ts.
 *
 * The lineup_card.html template is loaded once from disk and cached.
 * Data is injected via window.LINEUP_DATA before the script runs.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { warmUpRenderer, closeSplitsRenderer, CHROMIUM_EXECUTABLE_PATH } from "./renderSplitsCard.js";
import { chromium, type Browser, type Page } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "lineup_card.html");

// ─── Template cache ───────────────────────────────────────────────────────────
let _templateHtml: string | null = null;
function getTemplateHtml(): string {
  if (_templateHtml) return _templateHtml;
  const t0 = Date.now();
  _templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  console.log(`[LineupRenderer] Template loaded: ${(_templateHtml.length / 1024).toFixed(0)} KB in ${Date.now() - t0}ms`);
  return _templateHtml;
}

// ─── Shared browser singleton (same as splits renderer) ───────────────────────
// We reuse the same Chromium process to avoid double memory usage.
// warmUpRenderer() from renderSplitsCard.ts already launches it at startup.
let _browser: Browser | null = null;

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
    // Same resolution as renderSplitsCard.ts's getBrowser(): in the container
    // this is the apt-installed /usr/bin/chromium (via PLAYWRIGHT_CHROMIUM_PATH);
    // undefined in local dev, so Playwright resolves its own bundled browser.
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
// Re-export warm-up and close from the shared renderer
export { warmUpRenderer, closeSplitsRenderer as closeLineupRenderer };
