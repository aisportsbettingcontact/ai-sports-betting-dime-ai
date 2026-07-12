import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDaemonPath } from '@livelab/mcp-server';

export interface InstallResult {
  target: 'claude' | 'codex';
  file: string;
  action: 'created' | 'updated' | 'unchanged';
  manualCommand: string;
}

function resolveMcpServerPath(): string {
  const candidates = [
    process.env.LIVELAB_MCP_PATH,
    path.join(__dirname, 'mcp-server.cjs'), // packaged layout
    path.join(__dirname, '..', '..', 'mcp-server', 'dist', 'mcp-server.cjs'), // workspace layout
  ].filter((c): c is string => !!c);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('mcp-server.cjs not found — run the build first (npm run build)');
}

function relativeOrAbsolute(workspaceRoot: string, target: string): string {
  const rel = path.relative(workspaceRoot, target);
  return rel.startsWith('..') ? target : rel.split(path.sep).join('/');
}

/**
 * Project-scoped Claude Code registration: merge a `livelab` entry into
 * `.mcp.json` at the workspace root. Existing servers are preserved; an
 * existing livelab entry is updated in place.
 */
export function installClaude(workspaceRoot: string): InstallResult {
  const serverPath = resolveMcpServerPath();
  const serverArg = relativeOrAbsolute(workspaceRoot, serverPath);
  const file = path.join(workspaceRoot, '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`${file} exists but is not valid JSON — fix or remove it first`);
    }
  }
  config.mcpServers = config.mcpServers ?? {};
  const entry = {
    command: 'node',
    args: [serverArg],
    env: {},
  };
  const before = JSON.stringify(config.mcpServers['livelab'] ?? null);
  config.mcpServers['livelab'] = entry;
  const action: InstallResult['action'] = !fs.existsSync(file)
    ? 'created'
    : before === JSON.stringify(entry)
      ? 'unchanged'
      : 'updated';
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return {
    target: 'claude',
    file,
    action,
    manualCommand: `claude mcp add livelab --scope project -- node "${serverPath}"`,
  };
}

/**
 * Project-scoped Codex registration: merge an `[mcp_servers.livelab]` block
 * into `.codex/config.toml`. Codex's IDE extension and CLI share this config.
 */
export function installCodex(workspaceRoot: string): InstallResult {
  const serverPath = resolveMcpServerPath();
  const serverArg = relativeOrAbsolute(workspaceRoot, serverPath);
  const file = path.join(workspaceRoot, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const block = [
    '[mcp_servers.livelab]',
    'command = "node"',
    `args = [${JSON.stringify(serverArg)}]`,
    '',
  ].join('\n');

  let action: InstallResult['action'] = 'created';
  let content = '';
  if (fs.existsSync(file)) {
    content = fs.readFileSync(file, 'utf8');
    if (/^\[mcp_servers\.livelab\]/m.test(content)) {
      // Replace the existing livelab block (up to the next section header or EOF).
      const replaced = content.replace(
        /\[mcp_servers\.livelab\][\s\S]*?(?=\n\[|$)/,
        block.trimEnd() + '\n',
      );
      action = replaced === content ? 'unchanged' : 'updated';
      content = replaced;
    } else {
      content = content.trimEnd() + '\n\n' + block;
      action = 'updated';
    }
  } else {
    content = block;
  }
  fs.writeFileSync(file, content);
  return {
    target: 'codex',
    file,
    action,
    manualCommand: `codex mcp add livelab -- node "${serverPath}"`,
  };
}

export function daemonAvailable(): boolean {
  return resolveDaemonPath() !== null;
}
