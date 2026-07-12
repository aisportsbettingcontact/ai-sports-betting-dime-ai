import * as fs from 'node:fs';
import { DeviceConfig, WorkspaceConfig } from '@livelab/protocol';
import { SessionManager } from '../browser/manager';
import { ArtifactStore } from '../artifacts/store';
import { runSmoke } from './smoke';
import { Logger } from '../util/logger';

/**
 * On-demand Playwright WebKit verification (spec §11). Explicitly labeled:
 * this is Playwright's WebKit build, not a real iPhone or Safari release.
 * It opens the same URL + viewport in WebKit, runs the smoke suite, captures
 * a screenshot + trace, and reports differences from the Chromium session.
 */
export async function runWebKitVerification(
  manager: SessionManager,
  artifacts: ArtifactStore,
  config: WorkspaceConfig,
  args: { url: string; device: string | DeviceConfig; route?: string },
  log: Logger,
): Promise<{
  engineLabel: string;
  available: boolean;
  reason?: string;
  smoke?: unknown;
  screenshot?: string;
  trace?: string;
  chromiumComparison?: { chromiumErrors: number; webkitErrors: number; notes: string[] };
}> {
  const engineLabel = 'Playwright WebKit verification (not a real iOS device or Safari release)';
  if (!manager.engines.isInstalled('webkit')) {
    return {
      engineLabel,
      available: false,
      reason: 'Playwright WebKit is not installed. Run: npx playwright install webkit',
    };
  }
  const session = await manager.createSession({
    device: args.device,
    engine: 'webkit',
    label: 'WebKit verification',
  } as never);
  try {
    await session.startTrace().catch((err) => log.warn(`WebKit trace unavailable: ${String(err)}`));
    await manager.navigate(session.sessionId, args.url, false);
    const smoke = await runSmoke(
      {
        baseUrl: args.url,
        routes: [args.route ?? '/'],
        sessions: [session],
        config,
      },
      artifacts,
      log,
    );
    const shotBuf = await session.screenshot({ format: 'png' });
    const reserved = artifacts.reserve('screenshot', '.png', {
      sessionId: session.sessionId,
      subdir: 'webkit-verification',
    });
    fs.writeFileSync(reserved.absolutePath, shotBuf);
    const shotMeta = artifacts.commit(reserved, 'screenshot', {
      sessionId: session.sessionId,
      device: session.device.id,
      engine: 'webkit',
      url: args.url,
      label: 'WebKit verification screenshot',
    });

    let tracePath: string | undefined;
    if (session.tracing) {
      const traceReserved = artifacts.reserve('trace', '.zip', {
        sessionId: session.sessionId,
        subdir: 'webkit-verification',
      });
      await session.stopTrace(traceReserved.absolutePath);
      tracePath = artifacts.commit(traceReserved, 'trace', {
        sessionId: session.sessionId,
        engine: 'webkit',
        label: 'WebKit verification trace',
      }).path;
    }

    // Compare error counts against any live Chromium session on the same URL.
    const chromiumPeer = manager
      .all()
      .find((s) => s.engine === 'chromium' && s.lastUrl && args.url.startsWith(new URL(s.lastUrl).origin));
    const notes: string[] = [];
    if (chromiumPeer) {
      const c = chromiumPeer.counters;
      const w = session.counters;
      if (w.pageErrors > c.pageErrors) notes.push(`WebKit raised ${w.pageErrors - c.pageErrors} more page error(s) than Chromium`);
      if (w.consoleErrors > c.consoleErrors) notes.push(`WebKit logged ${w.consoleErrors - c.consoleErrors} more console error(s)`);
      if (notes.length === 0) notes.push('No additional WebKit-only errors observed');
    }

    return {
      engineLabel,
      available: true,
      smoke,
      screenshot: shotMeta.path,
      trace: tracePath,
      chromiumComparison: chromiumPeer
        ? {
            chromiumErrors: chromiumPeer.counters.pageErrors + chromiumPeer.counters.consoleErrors,
            webkitErrors: session.counters.pageErrors + session.counters.consoleErrors,
            notes,
          }
        : undefined,
    };
  } finally {
    await manager.closeSession(session.sessionId).catch(() => {});
  }
}
