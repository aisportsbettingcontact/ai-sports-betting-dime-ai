import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ArtifactMetadata,
  ArtifactType,
  LiveLabError,
  ERROR_CODES,
} from '@livelab/protocol';
import { newId } from '../util/ids';
import { canonicalWorkspaceRoot, ensureDir, resolveInside } from '../util/paths';
import { Logger } from '../util/logger';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.har': 'application/json',
};

/**
 * Artifact store rooted at `.livelab/` inside the workspace. Persists only
 * explicitly requested artifacts, tracks metadata, enforces a total size
 * budget by pruning oldest artifacts, and never serves paths outside its root.
 */
export class ArtifactStore {
  private readonly index = new Map<string, ArtifactMetadata>();
  private readonly root: string;
  private readonly workspaceRoot: string;

  constructor(
    workspaceRoot: string,
    private readonly maxTotalBytes: number,
    private readonly log: Logger,
  ) {
    // Canonical root: resolveInside() realpaths its results, so relative paths
    // must be computed against the same canonical namespace (macOS /var/folders
    // is a symlink to /private/var/folders).
    this.workspaceRoot = canonicalWorkspaceRoot(workspaceRoot);
    this.root = path.join(this.workspaceRoot, '.livelab');
    ensureDir(path.join(this.root, 'artifacts'));
    ensureDir(path.join(this.root, 'reports'));
    this.loadIndex();
  }

  get artifactsDir(): string {
    return path.join(this.root, 'artifacts');
  }
  get reportsDir(): string {
    return path.join(this.root, 'reports');
  }
  get baselinesDir(): string {
    return path.join(this.root, 'baselines');
  }

  private get indexFile(): string {
    return path.join(this.root, 'artifacts-index.json');
  }

  private loadIndex(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as ArtifactMetadata[];
      for (const meta of raw) {
        if (fs.existsSync(path.join(this.workspaceRoot, meta.path))) {
          this.index.set(meta.artifactId, meta);
        }
      }
    } catch {
      // Fresh store.
    }
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(this.indexFile, JSON.stringify([...this.index.values()], null, 2));
    } catch (err) {
      this.log.warn(`Failed to persist artifact index: ${String(err)}`);
    }
  }

  /** Reserve a new artifact path. Caller writes the file then calls commit(). */
  reserve(
    type: ArtifactType,
    extension: string,
    opts: { sessionId?: string; reportId?: string; label?: string; subdir?: string } = {},
  ): { artifactId: string; absolutePath: string; relativePath: string } {
    const artifactId = newId('art');
    const dir = opts.subdir
      ? resolveInside(this.root, path.join('artifacts', opts.subdir))
      : this.artifactsDir;
    ensureDir(dir);
    const filename = `${Date.now()}-${type}-${artifactId}${extension}`;
    const absolutePath = path.join(dir, filename);
    const relativePath = path.relative(this.workspaceRoot, absolutePath);
    return { artifactId, absolutePath, relativePath };
  }

  commit(
    reserved: { artifactId: string; absolutePath: string; relativePath: string },
    type: ArtifactType,
    opts: {
      sessionId?: string;
      reportId?: string;
      url?: string;
      device?: string;
      engine?: string;
      label?: string;
    } = {},
  ): ArtifactMetadata {
    const stat = fs.statSync(reserved.absolutePath);
    const ext = path.extname(reserved.absolutePath).toLowerCase();
    const meta: ArtifactMetadata = {
      artifactId: reserved.artifactId,
      type,
      path: reserved.relativePath.split(path.sep).join('/'),
      sessionId: opts.sessionId,
      reportId: opts.reportId,
      url: opts.url,
      device: opts.device,
      engine: opts.engine,
      createdAt: Date.now(),
      bytes: stat.size,
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      label: opts.label,
    };
    this.index.set(meta.artifactId, meta);
    this.enforceBudget();
    this.saveIndex();
    return meta;
  }

  get(artifactId: string): ArtifactMetadata {
    const meta = this.index.get(artifactId);
    if (!meta) {
      throw new LiveLabError(ERROR_CODES.ARTIFACT_NOT_FOUND, `Unknown artifact: ${artifactId}`);
    }
    return meta;
  }

  list(filter?: { sessionId?: string; reportId?: string; type?: ArtifactType }): ArtifactMetadata[] {
    let all = [...this.index.values()];
    if (filter?.sessionId) all = all.filter((a) => a.sessionId === filter.sessionId);
    if (filter?.reportId) all = all.filter((a) => a.reportId === filter.reportId);
    if (filter?.type) all = all.filter((a) => a.type === filter.type);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Absolute path for reading; confined to the `.livelab` root. */
  absolutePathFor(meta: ArtifactMetadata): string {
    return resolveInside(this.root, path.join(this.workspaceRoot, meta.path));
  }

  private enforceBudget(): void {
    let total = 0;
    const byAge = [...this.index.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const meta of byAge) total += meta.bytes;
    while (total > this.maxTotalBytes && byAge.length > 0) {
      const victim = byAge.shift()!;
      total -= victim.bytes;
      this.index.delete(victim.artifactId);
      try {
        fs.unlinkSync(path.join(this.workspaceRoot, victim.path));
        this.log.info(`Pruned artifact ${victim.artifactId} to stay under size budget`);
      } catch {}
    }
  }
}
