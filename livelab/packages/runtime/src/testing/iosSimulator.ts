import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { ArtifactStore } from '../artifacts/store';
import { assertUrlAllowed } from '../security/allowlist';
import { Logger } from '../util/logger';

function exec(cmd: string, args: string[], timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as unknown as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

/**
 * Optional macOS-only iOS Simulator adapter (spec §11). Capability-gated:
 * on non-macOS platforms every method reports unavailable without breaking
 * builds. This uses a REAL Apple simulator via `xcrun simctl` — it is the
 * only true-WebKit-on-iOS path and is never a prerequisite for the core product.
 */
export class IosSimulatorAdapter {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly allowedHosts: () => string[],
    private readonly log: Logger,
  ) {}

  async available(): Promise<{ available: boolean; reason?: string }> {
    if (process.platform !== 'darwin') {
      return { available: false, reason: 'iOS Simulator requires macOS with Xcode command-line tools' };
    }
    const probe = await exec('xcrun', ['simctl', 'help'], 10_000);
    if (probe.code !== 0) {
      return { available: false, reason: 'xcrun simctl not available; install Xcode command-line tools' };
    }
    return { available: true };
  }

  async listSimulators(): Promise<Array<{ udid: string; name: string; state: string; runtime: string }>> {
    const check = await this.available();
    if (!check.available) return [];
    const res = await exec('xcrun', ['simctl', 'list', 'devices', '--json']);
    if (res.code !== 0) return [];
    try {
      const parsed = JSON.parse(res.stdout) as { devices: Record<string, Array<{ udid: string; name: string; state: string; isAvailable: boolean }>> };
      const out: Array<{ udid: string; name: string; state: string; runtime: string }> = [];
      for (const [runtime, devices] of Object.entries(parsed.devices)) {
        if (!runtime.includes('iOS')) continue;
        for (const device of devices) {
          if (device.isAvailable) out.push({ udid: device.udid, name: device.name, state: device.state, runtime });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async boot(udid: string): Promise<{ ok: boolean; detail: string }> {
    const check = await this.available();
    if (!check.available) return { ok: false, detail: check.reason! };
    const res = await exec('xcrun', ['simctl', 'boot', udid], 120_000);
    // "Unable to boot device in current state: Booted" is fine.
    const ok = res.code === 0 || /current state: Booted/.test(res.stderr);
    return { ok, detail: ok ? 'booted' : res.stderr.slice(0, 300) };
  }

  async openUrl(udid: string, rawUrl: string): Promise<{ ok: boolean; detail: string }> {
    const check = await this.available();
    if (!check.available) return { ok: false, detail: check.reason! };
    const url = assertUrlAllowed(rawUrl, this.allowedHosts());
    const res = await exec('xcrun', ['simctl', 'openurl', udid, url.toString()], 30_000);
    return { ok: res.code === 0, detail: res.code === 0 ? 'opened' : res.stderr.slice(0, 300) };
  }

  async screenshot(udid: string): Promise<{ ok: boolean; path?: string; detail: string }> {
    const check = await this.available();
    if (!check.available) return { ok: false, detail: check.reason! };
    const reserved = this.artifacts.reserve('ios-simulator-screenshot', '.png', {
      subdir: path.join('ios-simulator'),
    });
    const res = await exec('xcrun', ['simctl', 'io', udid, 'screenshot', reserved.absolutePath], 30_000);
    if (res.code !== 0) return { ok: false, detail: res.stderr.slice(0, 300) };
    const meta = this.artifacts.commit(reserved, 'ios-simulator-screenshot', {
      label: `iOS simulator ${udid}`,
    });
    this.log.info(`iOS simulator screenshot saved: ${meta.path}`);
    return { ok: true, path: meta.path, detail: 'captured' };
  }
}
