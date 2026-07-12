#!/usr/bin/env node
/** Executable entry for the bundled MCP server (`mcp-server.cjs`). */
import { mcpMain } from './server';

void mcpMain(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`[livelab-mcp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
