/**
 * dime-guard — repo-law enforcement at the tool-call layer.
 *
 * Enforces AGENTS.md/CLAUDE.md laws mechanically, regardless of what the
 * model decides:
 *  - blocks destructive git (force push, reset --hard, clean -fd, checkout .)
 *  - blocks writes to personal reference material (dime-ai/design-bundle/uploads/)
 *  - blocks writes to env/secret files
 *  - reminds about the schema law (db-push before deploy) on drizzle/** edits
 *
 * Runs in every pi mode; in headless (-p/json/rpc) blocks are unconditional
 * since no one can confirm.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DESTRUCTIVE_GIT = [
  // --force-with-lease is blocked too: intentionally strict — no agent
  // force-pushes of any variant in this repo (AGENTS.md).
  /git\s+push\b[^\n]*(--force\b|-f\b)/,
  /git\s+push\b[^\n]*\s\+\S+/, // refspec force-push: git push origin +main
  /git\s+reset\s+--hard\b/,
  /git\s+clean\s+-[a-z]*f/,
  /git\s+checkout\s+(--\s+)?\.(\s|$)/,
  /git\s+restore\b(?![^\n]*--staged)[^\n]*\s\.(\s|$)/, // git restore [--source=...] .
  /git\s+commit\b[^\n]*--no-verify\b/,
];

const PROTECTED_WRITE_PATTERNS = [
  { re: /dime-ai\/design-bundle\/uploads\//, why: "personal reference material — never modify or redistribute (CLAUDE.md)" },
  { re: /(^|\/)\.env(rc)?(\.|$)|\.env$/, why: "environment/secret files are managed by hand, never by agents" },
];

const SCHEMA_RE = /(^|\/)drizzle\//;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command = String((event.input as { command?: unknown }).command ?? "");
      for (const re of DESTRUCTIVE_GIT) {
        if (re.test(command)) {
          return {
            block: true,
            reason: `dime-guard: "${command.slice(0, 80)}" is a destructive git operation banned by repo law (AGENTS.md). Not allowed in any mode.`,
          };
        }
      }
      return;
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as { path?: unknown; file_path?: unknown };
      const path = String(input.path ?? input.file_path ?? "");
      for (const { re, why } of PROTECTED_WRITE_PATTERNS) {
        if (re.test(path)) {
          return { block: true, reason: `dime-guard: writes to "${path}" are blocked — ${why}.` };
        }
      }
      if (SCHEMA_RE.test(path)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "dime-guard: drizzle schema change — remember: manual db-push.yml must succeed BEFORE any dependent code deploys (merge to main = production deploy).",
            "warning",
          );
        }
        // Allowed — the law governs deploy order, not the edit itself.
      }
    }
  });
}
