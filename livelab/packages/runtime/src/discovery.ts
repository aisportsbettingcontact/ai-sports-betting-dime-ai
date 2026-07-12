import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  RuntimeDiscovery,
  RuntimeDiscoverySchema,
  isCompatibleProtocol,
} from '@livelab/protocol';
import { writeFileOwnerOnly } from './util/paths';

/**
 * Per-workspace runtime discovery + lock. `.livelab/runtime.json` (0600) holds
 * host/port/token; `.livelab/runtime.lock` provides mutual exclusion so only
 * one compatible runtime exists per workspace.
 */
export function discoveryPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.livelab', 'runtime.json');
}

function lockPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.livelab', 'runtime.lock');
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** Read and validate the discovery record; returns null if absent/invalid/stale. */
export function readDiscovery(workspaceRoot: string): RuntimeDiscovery | null {
  try {
    const raw = JSON.parse(fs.readFileSync(discoveryPath(workspaceRoot), 'utf8'));
    const parsed = RuntimeDiscoverySchema.safeParse(raw);
    if (!parsed.success) return null;
    const disc = parsed.data;
    if (!isCompatibleProtocol(disc.protocolVersion)) return null;
    if (!pidAlive(disc.pid)) return null;
    return disc;
  } catch {
    return null;
  }
}

/**
 * Acquire the per-workspace runtime lock. Returns a release function, or null
 * if another live runtime already holds it.
 */
export function acquireLock(workspaceRoot: string): (() => void) | null {
  const lock = lockPath(workspaceRoot);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lock, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock);
        } catch {}
      };
    } catch {
      // Lock exists — is the holder alive?
      try {
        const holder = Number(fs.readFileSync(lock, 'utf8'));
        if (Number.isFinite(holder) && holder > 0 && pidAlive(holder)) return null;
        fs.unlinkSync(lock); // stale lock
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function writeDiscovery(record: RuntimeDiscovery): void {
  writeFileOwnerOnly(
    discoveryPath(record.workspaceRoot),
    JSON.stringify(record, null, 2),
  );
}

export function removeDiscovery(workspaceRoot: string): void {
  try {
    fs.unlinkSync(discoveryPath(workspaceRoot));
  } catch {}
}
