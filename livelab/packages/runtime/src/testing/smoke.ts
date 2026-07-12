import {
  SmokeCheckResult,
  SmokeReport,
  SmokeRouteResult,
  WorkspaceConfig,
} from '@livelab/protocol';
import { DeviceSession } from '../browser/session';
import { ArtifactStore } from '../artifacts/store';
import { resolveLocator } from '../browser/locators';
import { newId } from '../util/ids';
import { Logger } from '../util/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SmokeRunOptions {
  baseUrl: string;
  routes?: string[];
  sessions: DeviceSession[];
  config: WorkspaceConfig;
  quietWindowMs?: number;
  maxSettleMs?: number;
}

function check(
  id: string,
  title: string,
  ok: boolean | 'warn' | 'skip',
  detail?: string,
  evidence: string[] = [],
): SmokeCheckResult {
  return {
    id,
    title,
    status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : ok === 'skip' ? 'skipped' : 'fail',
    detail,
    evidence,
  };
}

/**
 * The default responsive smoke suite (spec §10), executed against live
 * sessions. Every check is real evidence from the page — no fabricated passes.
 */
export async function runSmoke(
  opts: SmokeRunOptions,
  artifacts: ArtifactStore,
  log: Logger,
): Promise<SmokeReport> {
  const reportId = newId('smoke');
  const startedAt = Date.now();
  const routes = opts.routes && opts.routes.length > 0 ? opts.routes : opts.config.routes;
  const results: SmokeRouteResult[] = [];
  const reportArtifacts: SmokeReport['artifacts'] = [];

  for (const route of routes) {
    const url = new URL(route, opts.baseUrl).toString();
    for (const session of opts.sessions) {
      const routeStart = Date.now();
      const checks: SmokeCheckResult[] = [];
      const beforeCursor = session.cursor;

      // 1. Page loads.
      let loaded = true;
      try {
        await session.navigate(url);
      } catch (err) {
        loaded = false;
        checks.push(check('load', 'Page loads successfully', false, String(err)));
      }
      if (loaded) {
        const settle = await session.waitForSettle(
          opts.quietWindowMs ?? opts.config.watch.quietWindowMs,
          opts.maxSettleMs ?? opts.config.watch.maxSettleMs,
        );
        checks.push(
          check(
            'load',
            'Page loads successfully',
            true,
            settle.settled ? `settled in ${settle.waitedMs}ms` : `settle timeout: ${settle.unresolvedActivity.join('; ')}`,
          ),
        );

        // 2. No uncaught page errors.
        const pageErrors = session.queryPageErrors({ since: beforeCursor, limit: 50 });
        checks.push(
          check(
            'page-errors',
            'No uncaught page error',
            pageErrors.items.length === 0,
            pageErrors.items.map((e) => e.message.slice(0, 200)).join(' | ') || undefined,
          ),
        );

        // 3. No console errors (with configured ignores).
        const consoleErrors = session
          .queryConsole({ since: beforeCursor, limit: 100, levels: ['error'] })
          .items.filter(
            (item) =>
              item.type === 'console' &&
              !opts.config.smoke.ignoreConsole.some((ig) => item.text.includes(ig)),
          );
        checks.push(
          check(
            'console-errors',
            'No console error',
            consoleErrors.length === 0,
            consoleErrors
              .map((e) => (e.type === 'console' ? e.text.slice(0, 200) : ''))
              .join(' | ') || undefined,
          ),
        );

        // 4. No critical resource request fails.
        const failed = session
          .queryNetwork({ since: beforeCursor, limit: 200, failedOnly: true })
          .items.filter(
            (item) =>
              item.type === 'network' &&
              ['document', 'script', 'stylesheet', 'fetch', 'xhr', 'font'].includes(item.resourceType ?? '') &&
              !opts.config.smoke.ignoreRequests.some((ig) => item.url.includes(ig)),
          );
        checks.push(
          check(
            'network',
            'No critical resource request fails',
            failed.length === 0,
            failed
              .map((f) => (f.type === 'network' ? `${f.method} ${f.url} → ${f.status ?? f.failureText}` : ''))
              .slice(0, 5)
              .join(' | ') || undefined,
          ),
        );

        // 5–7. Layout facts: landmark, overflow, interactive controls.
        try {
          const facts = await session.layoutFacts();
          checks.push(
            check(
              'landmark',
              'Primary landmark is visible',
              facts.hasLandmark ? facts.landmarkVisible : 'warn',
              facts.hasLandmark ? undefined : 'no <main> or [role="main"] found',
            ),
          );
          checks.push(
            check(
              'overflow',
              'No horizontal overflow beyond tolerance',
              facts.overflowX <= opts.config.smoke.overflowTolerancePx,
              facts.overflowX > 0 ? `${facts.overflowX}px horizontal overflow at ${session.device.width}px viewport` : undefined,
            ),
          );
          checks.push(
            check(
              'interactive',
              'Major interactive controls are reachable',
              facts.interactiveCount === 0 ? 'warn' : facts.visibleInteractive > 0,
              `${facts.visibleInteractive}/${facts.interactiveCount} interactive elements visible`,
            ),
          );
          // 9. Fixed/sticky coverage of controls.
          checks.push(
            check(
              'sticky-coverage',
              'Fixed/sticky elements do not cover primary controls',
              facts.coveredControls.length === 0,
              facts.coveredControls.join(' | ') || undefined,
            ),
          );
        } catch (err) {
          checks.push(check('layout', 'Layout facts', false, `evaluation failed: ${String(err)}`));
        }

        // 8. Focus indicators present.
        try {
          const focus = await session.focusIndicatorCheck();
          checks.push(
            check(
              'focus',
              'Focus indicators are not removed',
              focus.checked ? (focus.hasIndicator ? true : 'warn') : 'skip',
              focus.checked ? `first focusable: <${focus.tag}>` : focus.reason,
            ),
          );
        } catch {
          checks.push(check('focus', 'Focus indicators are not removed', 'skip', 'check failed to run'));
        }

        // 11. User-configured assertions.
        for (const assertion of opts.config.smoke.assertions) {
          try {
            let ok = false;
            let detail: string | undefined;
            const page = session.currentPage;
            switch (assertion.kind) {
              case 'elementVisible': {
                const loc = assertion.selector
                  ? page.locator(assertion.selector)
                  : resolveLocator(page, { strategy: 'text', value: assertion.text ?? '' });
                ok = await loc.first().isVisible({ timeout: 5000 }).catch(() => false);
                break;
              }
              case 'elementText': {
                const loc = page.locator(assertion.selector ?? 'body');
                const text = await loc.first().textContent({ timeout: 5000 }).catch(() => null);
                ok = !!text && !!assertion.text && text.includes(assertion.text);
                detail = ok ? undefined : `text ${JSON.stringify(assertion.text)} not found`;
                break;
              }
              case 'urlMatches': {
                ok = !!assertion.pattern && new RegExp(assertion.pattern).test(page.url());
                break;
              }
              case 'noSelector': {
                const count = await page.locator(assertion.selector ?? '__none__').count();
                ok = count === 0;
                detail = ok ? undefined : `${count} matching element(s) present`;
                break;
              }
            }
            checks.push(check(`assert:${assertion.id}`, assertion.description ?? assertion.id, ok, detail));
          } catch (err) {
            checks.push(check(`assert:${assertion.id}`, assertion.description ?? assertion.id, false, String(err)));
          }
        }

        // 10. Screenshot capture works.
        try {
          const buf = await session.screenshot({ format: 'png' });
          const reserved = artifacts.reserve('screenshot', '.png', {
            sessionId: session.sessionId,
            subdir: path.join('smoke', reportId),
          });
          fs.writeFileSync(reserved.absolutePath, buf);
          const meta = artifacts.commit(reserved, 'screenshot', {
            sessionId: session.sessionId,
            reportId,
            url,
            device: session.device.id,
            engine: session.engine,
            label: `smoke ${route} @ ${session.device.label}`,
          });
          reportArtifacts.push(meta);
          checks.push(check('screenshot', 'Screenshot can be captured', true, meta.path, [meta.path]));
        } catch (err) {
          checks.push(check('screenshot', 'Screenshot can be captured', false, String(err)));
        }
      }

      const status: SmokeRouteResult['status'] = checks.some((c) => c.status === 'fail')
        ? 'fail'
        : checks.some((c) => c.status === 'warn')
          ? 'warn'
          : 'pass';
      const screenshotCheck = checks.find((c) => c.id === 'screenshot');
      results.push({
        route,
        url,
        sessionId: session.sessionId,
        device: session.device.id,
        engine: session.engine,
        status,
        checks,
        screenshot: screenshotCheck?.evidence[0],
        durationMs: Date.now() - routeStart,
      });
      log.info(`Smoke ${route} @ ${session.device.label}: ${status}`, { reportId, sessionId: session.sessionId });
    }
  }

  const report: SmokeReport = {
    reportId,
    kind: 'smoke',
    startedAt,
    completedAt: Date.now(),
    status: results.some((r) => r.status === 'fail') ? 'fail' : results.some((r) => r.status === 'warn') ? 'warn' : 'pass',
    results,
    artifacts: reportArtifacts,
  };
  return report;
}
