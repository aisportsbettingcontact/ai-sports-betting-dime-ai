import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERROR_CODES, LiveLabError, Report, ReportSchema } from '@livelab/protocol';
import { ArtifactStore } from '../artifacts/store';
import { Logger } from '../util/logger';

/** Persists reports as JSON under `.livelab/reports/` and serves them by id. */
export class ReportStore {
  private readonly order: string[] = [];
  private readonly cache = new Map<string, Report>();

  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly log: Logger,
  ) {
    try {
      const files = fs
        .readdirSync(artifacts.reportsDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
      for (const file of files) {
        try {
          const parsed = ReportSchema.safeParse(
            JSON.parse(fs.readFileSync(path.join(artifacts.reportsDir, file), 'utf8')),
          );
          if (parsed.success) {
            this.cache.set(parsed.data.reportId, parsed.data);
            this.order.push(parsed.data.reportId);
          }
        } catch {}
      }
    } catch {}
  }

  save(report: Report): void {
    const file = path.join(this.artifacts.reportsDir, `${report.reportId}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    this.cache.set(report.reportId, report);
    this.order.push(report.reportId);
    // Bound in-memory + on-disk report count.
    while (this.order.length > 200) {
      const victim = this.order.shift()!;
      this.cache.delete(victim);
      try {
        fs.unlinkSync(path.join(this.artifacts.reportsDir, `${victim}.json`));
      } catch {}
    }
    this.log.info(`Report saved: ${report.reportId} (${report.kind}, ${report.status})`, {
      reportId: report.reportId,
    });
  }

  get(reportId: string): Report {
    const report = this.cache.get(reportId);
    if (!report) throw new LiveLabError(ERROR_CODES.REPORT_NOT_FOUND, `Unknown report: ${reportId}`);
    return report;
  }

  latest(kind?: Report['kind']): Report | undefined {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const report = this.cache.get(this.order[i]!);
      if (report && (!kind || report.kind === kind)) return report;
    }
    return undefined;
  }

  list(opts: { sinceReportId?: string; limit: number; kind?: Report['kind'] }): Report[] {
    let ids = [...this.order];
    if (opts.sinceReportId) {
      const idx = ids.indexOf(opts.sinceReportId);
      ids = idx >= 0 ? ids.slice(idx + 1) : ids;
    }
    const reports = ids
      .map((id) => this.cache.get(id))
      .filter((r): r is Report => !!r && (!opts.kind || r.kind === opts.kind));
    return reports.slice(-opts.limit);
  }

  get count(): number {
    return this.order.length;
  }
}
