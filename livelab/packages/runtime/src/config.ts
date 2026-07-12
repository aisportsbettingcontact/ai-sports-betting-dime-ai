import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  WorkspaceConfig,
  WorkspaceConfigSchema,
  RuntimeOptions,
  RuntimeOptionsSchema,
} from '@livelab/protocol';
import { Logger } from './util/logger';

/** Load and validate `.livelab/config.json`; invalid files fall back to defaults with a logged warning. */
export function loadWorkspaceConfig(workspaceRoot: string, log: Logger): WorkspaceConfig {
  const file = path.join(workspaceRoot, '.livelab', 'config.json');
  let raw: unknown = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      log.warn(`Invalid JSON in .livelab/config.json (${String(err)}); using defaults`);
    }
  }
  const parsed = WorkspaceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn(
      `.livelab/config.json failed validation; using defaults. Issues: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
    return WorkspaceConfigSchema.parse({});
  }
  return parsed.data;
}

export function resolveRuntimeOptions(partial: Partial<RuntimeOptions> & { workspaceRoot: string }): RuntimeOptions {
  return RuntimeOptionsSchema.parse(partial);
}

/** Ensure `.livelab/` internals never get committed. */
export function ensureGitignore(workspaceRoot: string): void {
  const dir = path.join(workspaceRoot, '.livelab');
  fs.mkdirSync(dir, { recursive: true });
  const ignoreFile = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignoreFile)) {
    fs.writeFileSync(
      ignoreFile,
      [
        '# LiveLab-generated. Evidence, logs, and the runtime token stay local.',
        'runtime.json',
        'runtime.lock',
        'artifacts/',
        'reports/',
        'logs/',
        'artifacts-index.json',
        '# Baselines are intentionally committable; remove the next line to track them.',
        'baselines/',
        '',
      ].join('\n'),
    );
  }
}
