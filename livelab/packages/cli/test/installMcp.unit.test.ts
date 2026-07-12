import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { installClaude, installCodex } from '../src/installMcp';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-cli-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('installClaude (.mcp.json)', () => {
  it('creates a project-scoped config with a livelab server entry', () => {
    const result = installClaude(tmp);
    expect(result.action).toBe('created');
    const config = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf8'));
    expect(config.mcpServers.livelab.command).toBe('node');
    expect(config.mcpServers.livelab.args[0]).toMatch(/mcp-server\.cjs$/);
    expect(result.manualCommand).toContain('claude mcp add livelab');
  });
  it('merges into an existing .mcp.json without clobbering other servers', () => {
    fs.writeFileSync(
      path.join(tmp, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }),
    );
    installClaude(tmp);
    const config = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf8'));
    expect(config.mcpServers.other.command).toBe('x');
    expect(config.mcpServers.livelab).toBeDefined();
  });
  it('is idempotent', () => {
    installClaude(tmp);
    expect(installClaude(tmp).action).toBe('unchanged');
  });
  it('refuses to overwrite invalid JSON', () => {
    fs.writeFileSync(path.join(tmp, '.mcp.json'), '{broken');
    expect(() => installClaude(tmp)).toThrowError(/not valid JSON/);
  });
});

describe('installCodex (.codex/config.toml)', () => {
  it('creates the TOML block pointing at the same compiled server', () => {
    const claude = installClaude(tmp);
    const codex = installCodex(tmp);
    const toml = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.livelab]');
    expect(toml).toContain('command = "node"');
    // Same compiled MCP server for both agents (spec §14).
    const claudeConfig = JSON.parse(fs.readFileSync(claude.file, 'utf8'));
    const claudeTarget = path.resolve(tmp, claudeConfig.mcpServers.livelab.args[0]);
    expect(toml).toContain(path.basename(claudeTarget));
    expect(codex.manualCommand).toContain('codex mcp add livelab');
  });
  it('preserves unrelated TOML content and replaces its own block', () => {
    fs.mkdirSync(path.join(tmp, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.codex', 'config.toml'), '[model]\nname = "whatever"\n');
    installCodex(tmp);
    installCodex(tmp);
    const toml = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[model]');
    expect(toml.match(/\[mcp_servers\.livelab\]/g)).toHaveLength(1);
  });
});
