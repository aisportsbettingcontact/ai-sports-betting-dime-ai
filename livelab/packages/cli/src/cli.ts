import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEVICE_PRESETS, LiveLabError, RuntimeStatus, SessionInfo } from '@livelab/protocol';
import { RuntimeClient, resolveDaemonPath } from '@livelab/mcp-server';
import { installClaude, installCodex } from './installMcp';

interface GlobalOpts {
  json: boolean;
  workspace: string;
}

function output(opts: GlobalOpts, human: string, data: unknown): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(human.endsWith('\n') ? human : human + '\n');
  }
}

function failOut(opts: GlobalOpts, err: unknown): never {
  const shaped =
    err instanceof LiveLabError
      ? err.toJSON()
      : { code: 'INTERNAL', kind: 'infrastructure', message: String((err as Error)?.message ?? err) };
  if (opts.json) {
    process.stdout.write(JSON.stringify({ error: shaped }, null, 2) + '\n');
  } else {
    process.stderr.write(`error [${shaped.code}]: ${shaped.message}\n`);
  }
  process.exit(shaped.kind === 'validation' ? 2 : 1);
}

function globalOpts(cmd: Command): GlobalOpts {
  const opts = cmd.optsWithGlobals();
  const workspace = path.resolve(opts.workspace ?? process.cwd());
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    process.stderr.write(`error: workspace is not a directory: ${workspace}\n`);
    process.exit(2);
  }
  return { json: !!opts.json, workspace };
}

async function ensureSession(client: RuntimeClient, device = 'desktop-1440'): Promise<SessionInfo> {
  const { sessions } = await client.request<{ sessions: SessionInfo[] }>('GET', '/sessions');
  if (sessions.length > 0) return sessions[0]!;
  const res = await client.request<{ session: SessionInfo }>('POST', '/sessions', {
    device,
    engine: 'chromium',
  });
  return res.session;
}

export function buildCli(): Command {
  const program = new Command('livelab')
    .description('LiveLab: live multi-device browser laboratory (runtime CLI)')
    .option('--json', 'machine-readable JSON output', false)
    .option('--workspace <dir>', 'workspace root (default: cwd)')
    .exitOverride((err) => process.exit(err.exitCode === 0 ? 0 : 2));

  program
    .command('start')
    .description('Start the LiveLab runtime for this workspace (headless)')
    .option('--url <url>', 'attach to a running dev server URL')
    .action(async function (this: Command, cmdOpts: { url?: string }) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        const disc = await client.ensure(true);
        let serverLine = '';
        if (cmdOpts.url) {
          const server = await client.request<{ url?: string; state: string }>('POST', '/server/attach', { url: cmdOpts.url });
          serverLine = `\nattached: ${server.url}`;
        }
        output(opts, `runtime running · pid ${disc.pid} · 127.0.0.1:${disc.port}${serverLine}`, {
          pid: disc.pid,
          port: disc.port,
          runtimeId: disc.runtimeId,
          owner: disc.owner,
        });
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('stop')
    .description('Stop the LiveLab runtime for this workspace')
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        if (!(await client.connected())) {
          output(opts, 'runtime already stopped', { stopped: false, reason: 'not running' });
          return;
        }
        await client.request('POST', '/shutdown');
        output(opts, 'runtime stopped', { stopped: true });
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('status')
    .description('Runtime status, sessions, dev server, capabilities')
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        if (!(await client.connected())) {
          output(opts, 'runtime: not running\nstart it with: livelab start', { running: false });
          return;
        }
        const status = await client.request<RuntimeStatus>('GET', '/status');
        const human = [
          `runtime:    ${status.runtimeId} (pid owner: ${status.owner}, up ${Math.round(status.uptimeMs / 1000)}s)`,
          `sessions:   ${status.sessions}`,
          `dev server: ${status.devServer.state}${status.devServer.url ? ` @ ${status.devServer.url}` : ''}`,
          `watch:      ${status.watch.active ? 'active' : 'off'} (${status.watch.reports} reports)`,
          `engines:    ${status.capabilities.engines.join(', ') || 'none installed'}`,
          `memory:     ${Math.round(status.diagnostics.rssBytes / 1024 / 1024)}MB rss, ${status.diagnostics.activePages} page(s)`,
        ].join('\n');
        output(opts, human, status);
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('open <url>')
    .description('Open a URL in device sessions (creates iphone-16 + desktop-1440 when none exist)')
    .option('--device <ids>', 'comma-separated device presets', 'iphone-16,desktop-1440')
    .action(async function (this: Command, url: string, cmdOpts: { device: string }) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        await client.ensure(true);
        await client.request('POST', '/server/attach', { url });
        const { sessions } = await client.request<{ sessions: SessionInfo[] }>('GET', '/sessions');
        const targets: SessionInfo[] = [...sessions];
        if (targets.length === 0) {
          for (const device of cmdOpts.device.split(',').map((d) => d.trim()).filter(Boolean)) {
            const res = await client.request<{ session: SessionInfo }>('POST', '/sessions', { device, engine: 'chromium' });
            targets.push(res.session);
          }
        }
        for (const session of targets) {
          await client.request('POST', `/sessions/${session.sessionId}/navigate`, { url });
        }
        output(
          opts,
          targets.map((s) => `${s.sessionId} · ${s.device.label} → ${url}`).join('\n'),
          { url, sessions: targets.map((s) => s.sessionId) },
        );
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('devices')
    .description('List device presets')
    .action(function (this: Command) {
      const opts = globalOpts(this);
      const human = DEVICE_PRESETS.map(
        (d) => `${d.id.padEnd(20)} ${String(d.width).padStart(4)}×${String(d.height).padEnd(5)} ${d.kind}${d.simulationFidelity === 'descriptor' ? ' (playwright descriptor)' : ''}`,
      ).join('\n');
      output(opts, human, { devices: DEVICE_PRESETS });
    });

  program
    .command('screenshot')
    .description('Capture a screenshot from a session')
    .option('--session <id>', 'session id (default: first session, created if none)')
    .option('--url <url>', 'navigate before capturing')
    .option('--full-page', 'capture the full page', false)
    .action(async function (this: Command, cmdOpts: { session?: string; url?: string; fullPage: boolean }) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        await client.ensure(true);
        const session = cmdOpts.session
          ? { sessionId: cmdOpts.session }
          : await ensureSession(client);
        if (cmdOpts.url) {
          await client.request('POST', `/sessions/${session.sessionId}/navigate`, { url: cmdOpts.url });
          await client.request('POST', `/sessions/${session.sessionId}/settle`, {});
        }
        const res = await client.request<{ artifact: { path: string; bytes: number } }>(
          'POST',
          `/sessions/${session.sessionId}/screenshot`,
          { fullPage: cmdOpts.fullPage, format: 'png' },
        );
        output(opts, `saved: ${res.artifact.path} (${Math.round(res.artifact.bytes / 1024)}KB)`, res);
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('smoke')
    .description('Run the responsive smoke suite')
    .option('--url <url>', 'base URL (defaults to attached dev server)')
    .option('--routes <routes>', 'comma-separated routes', '')
    .option('--devices <ids>', 'comma-separated device presets')
    .action(async function (this: Command, cmdOpts: { url?: string; routes: string; devices?: string }) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        await client.ensure(true);
        const report = await client.request<{
          reportId: string;
          status: string;
          results: Array<{ route: string; device: string; status: string; checks: Array<{ id: string; title: string; status: string; detail?: string }> }>;
        }>('POST', '/smoke', {
          baseUrl: cmdOpts.url,
          routes: cmdOpts.routes ? cmdOpts.routes.split(',').map((r) => r.trim()) : undefined,
          devices: cmdOpts.devices ? cmdOpts.devices.split(',').map((d) => d.trim()) : undefined,
        });
        const lines = [`smoke ${report.status.toUpperCase()} (${report.reportId})`];
        for (const result of report.results) {
          lines.push(`  ${result.route} @ ${result.device}: ${result.status}`);
          for (const check of result.checks.filter((c) => c.status === 'fail' || c.status === 'warn')) {
            lines.push(`    ${check.status === 'fail' ? '✗' : '⚠'} ${check.title}${check.detail ? ` — ${check.detail}` : ''}`);
          }
        }
        output(opts, lines.join('\n'), report);
        if (report.status === 'fail') process.exit(1);
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('report')
    .description('Show the latest report (or a specific one with --id)')
    .option('--id <reportId>')
    .action(async function (this: Command, cmdOpts: { id?: string }) {
      const opts = globalOpts(this);
      const client = new RuntimeClient(opts.workspace);
      try {
        const res = cmdOpts.id
          ? await client.request<{ report: unknown }>('GET', `/reports/${cmdOpts.id}`)
          : await client.request<{ report: unknown }>('GET', '/reports/latest');
        output(opts, JSON.stringify(res.report, null, 2), res);
      } catch (err) {
        failOut(opts, err);
      }
    });

  program
    .command('doctor')
    .description('Diagnose the LiveLab installation and workspace')
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
      const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

      const nodeMajor = Number(process.versions.node.split('.')[0]);
      add('node', nodeMajor >= 20, `v${process.versions.node} (need >= 20)`);
      add('workspace', fs.existsSync(opts.workspace), opts.workspace);

      const daemonPath = resolveDaemonPath();
      add('runtime bundle', !!daemonPath, daemonPath ?? 'daemon.cjs not found — run npm run build');

      let chromium = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pw = require('playwright-core') as typeof import('playwright-core');
        const exe = pw.chromium.executablePath();
        const exeExists = !!exe && fs.existsSync(exe);
        let viaBrowsersPath = false;
        if (!exeExists && process.env.PLAYWRIGHT_BROWSERS_PATH) {
          viaBrowsersPath = fs
            .readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH)
            .some((entry) => entry.startsWith('chromium-'));
        }
        chromium = exeExists || viaBrowsersPath;
        add(
          'chromium',
          chromium,
          exeExists
            ? exe
            : viaBrowsersPath
              ? `fallback via PLAYWRIGHT_BROWSERS_PATH (${process.env.PLAYWRIGHT_BROWSERS_PATH})`
              : 'missing — run: npx playwright install chromium',
        );
      } catch (err) {
        add('chromium', false, `playwright-core unavailable: ${String(err)}`);
      }

      const client = new RuntimeClient(opts.workspace);
      const running = await client.connected();
      add('runtime', true, running ? 'running' : 'not running (will start on demand)');
      if (running) {
        try {
          const status = await client.request<RuntimeStatus>('GET', '/status');
          add('runtime protocol', true, status.protocolVersion);
          add('artifacts dir', true, path.join(opts.workspace, '.livelab', 'artifacts'));
        } catch (err) {
          add('runtime protocol', false, String(err));
        }
        try {
          const url = (await client.request<{ url?: string }>('GET', '/server/status')).url;
          add('dev server', true, url ?? 'none attached');
        } catch {
          add('dev server', true, 'none attached');
        }
      }

      try {
        fs.mkdirSync(path.join(opts.workspace, '.livelab'), { recursive: true });
        const probe = path.join(opts.workspace, '.livelab', '.doctor-probe');
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        add('artifact permissions', true, '.livelab writable');
      } catch (err) {
        add('artifact permissions', false, String(err));
      }

      const mcpJson = path.join(opts.workspace, '.mcp.json');
      if (fs.existsSync(mcpJson)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
          add('claude config', !!parsed.mcpServers?.livelab, parsed.mcpServers?.livelab ? '.mcp.json has livelab entry' : '.mcp.json present, no livelab entry (run: livelab install-mcp --claude)');
        } catch {
          add('claude config', false, '.mcp.json is invalid JSON');
        }
      } else {
        add('claude config', true, 'not configured (optional — run: livelab install-mcp --claude)');
      }
      const codexToml = path.join(opts.workspace, '.codex', 'config.toml');
      add(
        'codex config',
        true,
        fs.existsSync(codexToml)
          ? /mcp_servers\.livelab/.test(fs.readFileSync(codexToml, 'utf8'))
            ? '.codex/config.toml has livelab entry'
            : '.codex/config.toml present, no livelab entry'
          : 'not configured (optional — run: livelab install-mcp --codex)',
      );

      const failed = checks.filter((c) => !c.ok);
      const human = checks
        .map((c) => `${c.ok ? '✓' : '✗'} ${c.name.padEnd(22)} ${c.detail}`)
        .join('\n');
      output(opts, human + `\n\n${failed.length === 0 ? 'all checks passed' : `${failed.length} check(s) failed`}`, {
        checks,
        ok: failed.length === 0,
      });
      if (failed.length > 0) process.exit(1);
    });

  program
    .command('install-mcp')
    .description('Write project-scoped MCP configuration for Claude Code and/or Codex')
    .option('--claude', 'configure Claude Code (.mcp.json)', false)
    .option('--codex', 'configure Codex (.codex/config.toml)', false)
    .option('--all', 'configure both', false)
    .action(function (this: Command, cmdOpts: { claude: boolean; codex: boolean; all: boolean }) {
      const opts = globalOpts(this);
      if (!cmdOpts.claude && !cmdOpts.codex && !cmdOpts.all) {
        process.stderr.write('specify --claude, --codex, or --all\n');
        process.exit(2);
      }
      try {
        const results = [];
        if (cmdOpts.claude || cmdOpts.all) results.push(installClaude(opts.workspace));
        if (cmdOpts.codex || cmdOpts.all) results.push(installCodex(opts.workspace));
        const human = results
          .map((r) => `${r.target}: ${r.action} ${r.file}\n  manual alternative: ${r.manualCommand}`)
          .join('\n');
        output(opts, human, { results });
      } catch (err) {
        failOut(opts, err);
      }
    });

  return program;
}

export async function cliMain(argv: string[]): Promise<void> {
  await buildCli().parseAsync(argv);
}
