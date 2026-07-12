import * as fs from 'node:fs';
import * as path from 'node:path';
import { LiveLabError, ERROR_CODES } from '@livelab/protocol';

/**
 * Path confinement. Every user- or agent-supplied path that will be read or
 * written must resolve inside an allowed root after symlink resolution —
 * rejects `..` traversal and symlink escape.
 */
export function resolveInside(root: string, candidate: string): string {
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(rootReal, candidate);

  // Resolve symlinks on the deepest existing ancestor to prevent symlink escape.
  let probe = absolute;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const probeReal = fs.realpathSync(probe);
  const resolved = probeReal + absolute.slice(probe.length);

  const rel = path.relative(rootReal, resolved);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return resolved;
  }
  throw new LiveLabError(
    ERROR_CODES.PATH_NOT_ALLOWED,
    `Path escapes allowed root: ${candidate}`,
  );
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Canonicalize a workspace root: absolute + symlinks resolved. Every boundary
 * that accepts a workspace path must call this so all derived paths (artifact
 * relatives, discovery records, watch events) live in one canonical namespace.
 * Without it, macOS tmpdir workspaces (/var/folders → /private/var/folders)
 * produce `../private/...` artifact paths and cross-client identity mismatches.
 */
export function canonicalWorkspaceRoot(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** Write a file with owner-only permissions where the platform supports it. */
export function writeFileOwnerOnly(file: string, data: string | Buffer): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, data, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: ACLs differ; best effort.
  }
}
