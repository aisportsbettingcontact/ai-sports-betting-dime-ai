import * as fs from 'node:fs';
import * as path from 'node:path';
import { AccessibilityFinding } from '@livelab/protocol';
import { DeviceSession } from '../browser/session';
import { Logger } from '../util/logger';

let axeSource: string | null = null;

function loadAxeSource(log: Logger): string | null {
  if (axeSource) return axeSource;
  const candidates = [
    // Bundled asset (VSIX / dist layout).
    path.join(__dirname, 'axe.min.js'),
    path.join(__dirname, '..', 'axe.min.js'),
  ];
  try {
    // Dev layout: resolve from node_modules.
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch {}
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        axeSource = fs.readFileSync(candidate, 'utf8');
        return axeSource;
      }
    } catch {}
  }
  log.warn('axe-core source not found; accessibility scan unavailable');
  return null;
}

/**
 * On-demand Axe scan. Axe is injected only for the duration of the scan
 * (test execution), never left running in live sessions, and findings are
 * reported — the application is never modified.
 */
export async function runAxeScan(
  session: DeviceSession,
  log: Logger,
  selector?: string,
): Promise<{ findings: AccessibilityFinding[]; ranRules: number } | { unavailable: string }> {
  const source = loadAxeSource(log);
  if (!source) return { unavailable: 'axe-core asset missing from this installation' };
  const page = session.currentPage;
  await page.evaluate(source);
  const raw = (await page.evaluate(
    `axe.run(${selector ? JSON.stringify(selector) : 'document'}, { resultTypes: ['violations'] })`,
  )) as {
    violations: Array<{
      id: string;
      impact?: 'minor' | 'moderate' | 'serious' | 'critical';
      help: string;
      helpUrl: string;
      nodes: Array<{ target: string[]; failureSummary?: string; html?: string }>;
    }>;
    passes?: unknown[];
  };
  const findings: AccessibilityFinding[] = [];
  for (const violation of raw.violations.slice(0, 50)) {
    for (const node of violation.nodes.slice(0, 5)) {
      findings.push({
        rule: violation.id,
        impact: violation.impact,
        locator: node.target.join(' '),
        explanation: violation.help,
        evidence: node.html?.slice(0, 300),
        suggestion: node.failureSummary?.slice(0, 500) ?? violation.helpUrl,
      });
    }
  }
  return { findings, ranRules: raw.violations.length };
}

/**
 * Lightweight continuous checks (no Axe injection): reuses the inspector's
 * layout facts for issues cheap enough to evaluate on every watch cycle.
 */
export async function quickAccessibilityFindings(session: DeviceSession): Promise<AccessibilityFinding[]> {
  const findings: AccessibilityFinding[] = [];
  try {
    const facts = await session.layoutFacts();
    for (const covered of facts.coveredControls) {
      findings.push({
        rule: 'control-covered',
        impact: 'serious',
        locator: covered,
        explanation: 'Interactive control is covered by a fixed/sticky element at this viewport',
        suggestion: 'Adjust z-index/spacing so the control is reachable',
      });
    }
    if (!facts.hasLandmark) {
      findings.push({
        rule: 'landmark-missing',
        impact: 'moderate',
        locator: 'document',
        explanation: 'No <main> or [role="main"] landmark found',
        suggestion: 'Wrap primary content in a <main> element',
      });
    }
  } catch {}
  return findings;
}
