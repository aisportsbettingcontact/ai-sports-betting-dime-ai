import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Browser, BrowserType } from 'playwright-core';
import { chromium, webkit, firefox } from 'playwright-core';
import { BrowserEngine, LiveLabError, ERROR_CODES } from '@livelab/protocol';
import { Logger } from '../util/logger';

/**
 * Lazily launches one shared browser instance per engine. Contexts (one per
 * device session) provide isolation; a single browser process keeps memory
 * bounded. No browser is launched until the first session is created.
 */
export class EngineManager {
  private browsers = new Map<BrowserEngine, Browser>();
  private launching = new Map<BrowserEngine, Promise<Browser>>();

  constructor(private readonly log: Logger) {}

  private typeFor(engine: BrowserEngine): BrowserType {
    switch (engine) {
      case 'chromium':
        return chromium;
      case 'webkit':
        return webkit;
      case 'firefox':
        return firefox;
    }
  }

  /** Fallback Chromium executable discovery for containers with pre-installed browsers. */
  private chromiumExecutableFallback(): string | undefined {
    if (process.env.LIVELAB_CHROMIUM_PATH && fs.existsSync(process.env.LIVELAB_CHROMIUM_PATH)) {
      return process.env.LIVELAB_CHROMIUM_PATH;
    }
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (root && fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root)) {
        if (entry.startsWith('chromium-')) {
          for (const candidate of [
            path.join(root, entry, 'chrome-linux', 'chrome'),
            path.join(root, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            path.join(root, entry, 'chrome-win', 'chrome.exe'),
          ]) {
            if (fs.existsSync(candidate)) return candidate;
          }
        }
      }
    }
    return undefined;
  }

  isInstalled(engine: BrowserEngine): boolean {
    try {
      const exe = this.typeFor(engine).executablePath();
      if (exe && fs.existsSync(exe)) return true;
    } catch {}
    // Version-mismatched but present Chromium (e.g. pre-provisioned containers).
    return engine === 'chromium' ? !!this.chromiumExecutableFallback() : false;
  }

  async get(engine: BrowserEngine): Promise<Browser> {
    const existing = this.browsers.get(engine);
    if (existing && existing.isConnected()) return existing;
    const inflight = this.launching.get(engine);
    if (inflight) return inflight;

    const promise = (async () => {
      const type = this.typeFor(engine);
      const launchOpts: Parameters<BrowserType['launch']>[0] = {
        headless: true,
        args: engine === 'chromium' ? ['--disable-dev-shm-usage'] : undefined,
      };
      // Pre-resolve a fallback executable when the default one is absent.
      if (engine === 'chromium') {
        try {
          const exe = type.executablePath();
          if (!exe || !fs.existsSync(exe)) {
            const fallback = this.chromiumExecutableFallback();
            if (fallback) launchOpts.executablePath = fallback;
          }
        } catch {
          const fallback = this.chromiumExecutableFallback();
          if (fallback) launchOpts.executablePath = fallback;
        }
      }
      try {
        const browser = await type.launch(launchOpts);
        this.log.info(`Launched ${engine} ${browser.version()}`);
        return browser;
      } catch (err) {
        if (engine === 'chromium') {
          const fallback = this.chromiumExecutableFallback();
          if (fallback) {
            this.log.warn(`Default chromium launch failed; retrying with ${fallback}`);
            const browser = await type.launch({ ...launchOpts, executablePath: fallback });
            return browser;
          }
        }
        const message = String(err);
        if (/executable doesn't exist|Please run the following command/i.test(message)) {
          throw new LiveLabError(
            ERROR_CODES.BROWSER_NOT_INSTALLED,
            `${engine} is not installed. Run: npx playwright install ${engine}`,
          );
        }
        throw new LiveLabError(
          ERROR_CODES.BROWSER_LAUNCH_FAILED,
          `Failed to launch ${engine}: ${message}`,
        );
      }
    })();

    this.launching.set(engine, promise);
    try {
      const browser = await promise;
      this.browsers.set(engine, browser);
      browser.on('disconnected', () => {
        if (this.browsers.get(engine) === browser) this.browsers.delete(engine);
      });
      return browser;
    } finally {
      this.launching.delete(engine);
    }
  }

  async closeAll(): Promise<void> {
    for (const [engine, browser] of this.browsers) {
      try {
        await browser.close();
      } catch (err) {
        this.log.warn(`Error closing ${engine}: ${String(err)}`);
      }
    }
    this.browsers.clear();
  }
}
