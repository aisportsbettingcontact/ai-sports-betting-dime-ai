import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { VisualCompareResult, WorkspaceConfig } from '@livelab/protocol';

// pixelmatch v7 is ESM-only; load it dynamically from this CJS module.
type PixelmatchFn = (
  img1: Uint8Array,
  img2: Uint8Array,
  output: Uint8Array | null,
  width: number,
  height: number,
  options?: { threshold?: number },
) => number;
let pixelmatchCached: PixelmatchFn | null = null;
async function getPixelmatch(): Promise<PixelmatchFn> {
  if (!pixelmatchCached) {
    const mod = await import('pixelmatch');
    pixelmatchCached = (mod.default ?? mod) as unknown as PixelmatchFn;
  }
  return pixelmatchCached;
}
import { DeviceSession } from '../browser/session';
import { ArtifactStore } from '../artifacts/store';
import { ensureDir } from '../util/paths';
import { Logger } from '../util/logger';

interface BaselineMeta {
  route: string;
  device: string;
  engine: string;
  platform: string;
  browserVersion: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  approvedAt: number;
}

function slugFor(route: string): string {
  return route.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
}

function baselinePaths(store: ArtifactStore, route: string, device: string, engine: string) {
  const dir = path.join(store.baselinesDir, engine, device);
  const slug = slugFor(route);
  return {
    dir,
    image: path.join(dir, `${slug}.png`),
    meta: path.join(dir, `${slug}.meta.json`),
  };
}

/**
 * Visual baseline management. Baselines are created only by explicit approval,
 * carry browser/platform/viewport metadata, are invalidated when any of it
 * changes, and are never replaced automatically after a failure.
 */
export class VisualBaselines {
  constructor(
    private readonly store: ArtifactStore,
    private readonly workspaceRoot: string,
    private readonly log: Logger,
  ) {}

  async approve(session: DeviceSession, route: string): Promise<{ baselinePath: string }> {
    const { dir, image, meta } = baselinePaths(this.store, route, session.device.id, session.engine);
    ensureDir(dir);
    const buf = await session.screenshot({ format: 'png' });
    fs.writeFileSync(image, buf);
    const metaRecord: BaselineMeta = {
      route,
      device: session.device.id,
      engine: session.engine,
      platform: process.platform,
      browserVersion: 'playwright-1.58',
      viewport: {
        width: session.device.width,
        height: session.device.height,
        deviceScaleFactor: session.device.deviceScaleFactor,
      },
      approvedAt: Date.now(),
    };
    fs.writeFileSync(meta, JSON.stringify(metaRecord, null, 2));
    this.log.info(`Approved visual baseline for ${route} @ ${session.device.id}`);
    return { baselinePath: path.relative(this.workspaceRoot, image).split(path.sep).join('/') };
  }

  async compare(
    session: DeviceSession,
    route: string,
    config: WorkspaceConfig,
    reportId?: string,
  ): Promise<VisualCompareResult> {
    const { image, meta } = baselinePaths(this.store, route, session.device.id, session.engine);
    const base: VisualCompareResult = {
      route,
      device: session.device.id,
      engine: session.engine,
      status: 'baseline-missing',
      threshold: config.visual.threshold,
      maxDiffPixelRatio: config.visual.maxDiffPixelRatio,
    };
    if (!fs.existsSync(image) || !fs.existsSync(meta)) {
      return { ...base, reason: 'No approved baseline. Run "Approve Visual Baseline" first.' };
    }
    let metaRecord: BaselineMeta;
    try {
      metaRecord = JSON.parse(fs.readFileSync(meta, 'utf8'));
    } catch {
      return { ...base, reason: 'Baseline metadata unreadable; re-approve the baseline.' };
    }
    if (
      metaRecord.viewport.width !== session.device.width ||
      metaRecord.viewport.height !== session.device.height ||
      metaRecord.viewport.deviceScaleFactor !== session.device.deviceScaleFactor ||
      metaRecord.engine !== session.engine
    ) {
      return {
        ...base,
        status: 'baseline-invalidated',
        baselinePath: path.relative(this.workspaceRoot, image).split(path.sep).join('/'),
        reason: `Baseline was approved for ${metaRecord.engine} ${metaRecord.viewport.width}x${metaRecord.viewport.height}@${metaRecord.viewport.deviceScaleFactor}; current session is ${session.engine} ${session.device.width}x${session.device.height}@${session.device.deviceScaleFactor}. Re-approve to update.`,
      };
    }

    const actualBuf = await session.screenshot({ format: 'png' });
    const expected = PNG.sync.read(fs.readFileSync(image));
    const actual = PNG.sync.read(actualBuf);

    // Persist the actual capture as evidence regardless of outcome.
    const actualReserved = this.store.reserve('visual-actual', '.png', {
      sessionId: session.sessionId,
      subdir: path.join('visual', slugFor(route)),
    });
    fs.writeFileSync(actualReserved.absolutePath, actualBuf);
    const actualMeta = this.store.commit(actualReserved, 'visual-actual', {
      sessionId: session.sessionId,
      reportId,
      device: session.device.id,
      engine: session.engine,
      label: `visual actual ${route}`,
    });

    if (expected.width !== actual.width || expected.height !== actual.height) {
      return {
        ...base,
        status: 'baseline-invalidated',
        baselinePath: path.relative(this.workspaceRoot, image).split(path.sep).join('/'),
        actualPath: actualMeta.path,
        reason: `Baseline is ${expected.width}x${expected.height}px but capture is ${actual.width}x${actual.height}px.`,
      };
    }

    const diff = new PNG({ width: expected.width, height: expected.height });
    const pixelmatch = await getPixelmatch();
    const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
      threshold: config.visual.threshold,
    });
    const totalPixels = expected.width * expected.height;
    const diffRatio = diffPixels / totalPixels;
    const pass = diffRatio <= config.visual.maxDiffPixelRatio;

    let diffPath: string | undefined;
    if (!pass) {
      const diffReserved = this.store.reserve('visual-diff', '.png', {
        sessionId: session.sessionId,
        subdir: path.join('visual', slugFor(route)),
      });
      fs.writeFileSync(diffReserved.absolutePath, PNG.sync.write(diff));
      diffPath = this.store.commit(diffReserved, 'visual-diff', {
        sessionId: session.sessionId,
        reportId,
        device: session.device.id,
        engine: session.engine,
        label: `visual diff ${route}`,
      }).path;
    }

    return {
      ...base,
      status: pass ? 'pass' : 'fail',
      diffPixels,
      totalPixels,
      diffRatio,
      baselinePath: path.relative(this.workspaceRoot, image).split(path.sep).join('/'),
      actualPath: actualMeta.path,
      diffPath,
    };
  }
}
