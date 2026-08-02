/**
 * pi harness audit — deterministic verification that the pi foundation is
 * intact and maximized. Run via `pnpm pi:audit` (tsx). Exits non-zero on any
 * failure, so it can gate CI.
 *
 * Layers audited (no network, no model calls):
 *   1. context-file suite present and cross-linked
 *   2. .pi/ project config: settings paths resolve, guard/theme/prompts/append
 *   3. Claude Code hooks: registered, scripts executable, capsule emits
 *   4. pi-harness skill present
 *   5. package.json entry points + runtime deps
 *   6. embedded-runtime model policy (LLM.md law) enforced in code
 *   7. gitignore hygiene (local installs ignored, real skill tracked)
 *   8. pi CLI resource loader (skipped with the attempted path printed when
 *      no global pi install exists, e.g. CI) — full skill/prompt census
 *
 * Contract: run everything, report everything — a malformed input turns into
 * a FAIL for its layer, never an uncaught crash that hides later checks.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PI_AGENT_APPROVED_MODELS, resolvePiAgentModel } from "../server/_core/piAgent";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failures += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Run a layer; any uncaught throw becomes a FAIL instead of aborting the audit. */
async function layer(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    check(`${name} (layer crashed)`, false, err instanceof Error ? err.message : String(err));
  }
}

function fileHas(rel: string, needle: string): boolean {
  const p = path.join(root, rel);
  return existsSync(p) && readFileSync(p, "utf8").includes(needle);
}

// 1. Context-file suite
await layer("context", () => {
  for (const f of ["CLAUDE.md", "AGENTS.md", "SKILLS.md", "HARNESS.md", "LLM.md", "CODEX.md", "references/pi-harness.md"]) {
    check(`context:${f}`, existsSync(path.join(root, f)));
  }
  check("context:CLAUDE links companions", fileHas("CLAUDE.md", "HARNESS.md") && fileHas("CLAUDE.md", "LLM.md"));
  check("context:AGENTS carries laws inline", fileHas("AGENTS.md", "design-system/dime-ai/MASTER.md") && fileHas("AGENTS.md", "db-push.yml"));
  check("context:LLM subscription-first law", fileHas("LLM.md", "subscription-first"));
});

// 2. .pi project config
await layer(".pi", () => {
  const settingsPath = path.join(root, ".pi/settings.json");
  let settings: {
    defaultModel?: string;
    enabledModels?: string[];
    skills?: string[];
    prompts?: string[];
    packages?: string[];
    theme?: string;
  } = {};
  let parsed = false;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    parsed = true;
  } catch (err) {
    parsed = false;
  }
  check(".pi:settings.json parses", parsed);
  if (!parsed) return;

  check(".pi:defaultModel is claude-fable-5", settings.defaultModel === "claude-fable-5");
  check(
    ".pi:enabledModels match LLM.md",
    JSON.stringify(settings.enabledModels) === JSON.stringify(["claude-fable-5", "claude-opus-5", "gpt-5.6-sol"]),
  );
  check(".pi:theme dime selected", settings.theme === "dime");
  const entries = [...(settings.skills ?? []), ...(settings.prompts ?? [])];
  const plainEntries = entries.filter((e) => !e.startsWith("!"));
  const negatedEntries = entries.filter((e) => e.startsWith("!")).map((e) => e.slice(1));
  const missing = plainEntries.filter((e) => !existsSync(path.resolve(root, ".pi", e)));
  check(".pi:all skill/prompt paths resolve", missing.length === 0, missing.join(", ") || `${plainEntries.length} paths`);
  // A dead negation means a superseded skill silently re-enters the corpus.
  const deadNegations = negatedEntries.filter((e) => !existsSync(path.resolve(root, ".pi", e)));
  check(".pi:all negation targets exist", deadNegations.length === 0, deadNegations.join(", ") || `${negatedEntries.length} negations`);
  check(".pi:packages recorded", (settings.packages ?? []).length >= 2, (settings.packages ?? []).join(", "));
  check(".pi:dime-guard extension", fileHas(".pi/extensions/dime-guard.ts", "tool_call"));
  check(".pi:APPEND_SYSTEM injects laws", fileHas(".pi/APPEND_SYSTEM.md", "db-push.yml"));
  const theme = JSON.parse(readFileSync(path.join(root, ".pi/themes/dime.json"), "utf8")) as {
    name: string;
    vars: Record<string, unknown>;
  };
  check(".pi:theme brand accent", theme.name === "dime" && theme.vars.accent === "#45E0A8");
});

// 3. Claude Code hooks
await layer("hooks", () => {
  const claudeSettings = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8")) as {
    hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  const hookCommands = Object.values(claudeSettings.hooks ?? {})
    .flat()
    .flatMap((h) => h.hooks.map((x) => x.command));
  check("hooks:UserPromptSubmit capsule registered", hookCommands.some((c) => c.includes("prompt-capsule.sh")));
  check("hooks:SessionStart bootstrap registered", hookCommands.some((c) => c.includes("bootstrap-plugins.sh")));
  for (const script of [".claude/scripts/prompt-capsule.sh", ".claude/scripts/bootstrap-plugins.sh"]) {
    const p = path.join(root, script);
    const executable = existsSync(p) && (statSync(p).mode & 0o111) !== 0;
    check(`hooks:${path.basename(script)} executable`, executable);
  }
  const capsule = execFileSync(path.join(root, ".claude/scripts/prompt-capsule.sh"), { encoding: "utf8" });
  check("hooks:capsule emits execution law", capsule.includes("LLM.md") && capsule.includes("pi:ship"));
});

// 4. pi-harness skill
await layer("skill", () => {
  check("skill:pi-harness present", fileHas(".claude/skills/pi-harness/SKILL.md", "name: pi-harness"));
});

// 5. package.json entry points
await layer("pkg", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  for (const s of ["pi", "pi:ship", "pi:review", "pi:rpc", "pi:json", "pi:audit"]) {
    check(`pkg:script ${s}`, typeof pkg.scripts[s] === "string");
  }
  for (const d of ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"]) {
    check(`pkg:dep ${d}`, typeof pkg.dependencies[d] === "string", pkg.dependencies[d]);
  }
});

// 6. Embedded-runtime model policy
await layer("policy", () => {
  check(
    "policy:approved set matches LLM.md",
    JSON.stringify([...PI_AGENT_APPROVED_MODELS]) ===
      JSON.stringify(["anthropic/claude-fable-5", "anthropic/claude-opus-5", "openai-codex/gpt-5.6-sol"]),
  );
  for (const ref of PI_AGENT_APPROVED_MODELS) {
    let ok = false;
    try {
      const m = resolvePiAgentModel(ref);
      ok = `${m.provider}/${m.id}` === ref;
    } catch {
      ok = false;
    }
    check(`policy:resolves ${ref}`, ok);
  }
  const prior = process.env.DIME_ALLOW_LEGACY_MODELS;
  delete process.env.DIME_ALLOW_LEGACY_MODELS;
  let threw = false;
  try {
    resolvePiAgentModel("claude-haiku-4-5");
  } catch {
    threw = true;
  }
  if (prior !== undefined) process.env.DIME_ALLOW_LEGACY_MODELS = prior;
  check("policy:legacy model rejected", threw);
});

// 7. gitignore hygiene
await layer("git", () => {
  function ignored(rel: string): boolean {
    try {
      execFileSync("git", ["check-ignore", "-q", rel], { cwd: root });
      return true;
    } catch {
      return false;
    }
  }
  check("git:.pi/npm ignored", ignored(".pi/npm/x"));
  check("git:.pi/git ignored", ignored(".pi/git/x"));
  check("git:.pi/hf-sessions ignored", ignored(".pi/hf-sessions/x"));
  check("git:pi-harness skill tracked", !ignored(".claude/skills/pi-harness/SKILL.md"));
});

// 8. pi CLI resource loader (skipped when no global pi install exists, e.g. CI)
function findPiCliDir(): { dir?: string; attempted: string[] } {
  const attempted: string[] = [];
  // Primary: wherever the global npm root actually is (nvm, hostedtoolcache, brew…).
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const candidate = path.join(globalRoot, "@earendil-works/pi-coding-agent");
    attempted.push(candidate);
    if (existsSync(candidate)) return { dir: candidate, attempted };
  } catch {
    attempted.push("npm root -g (failed)");
  }
  // Fallback: resolve through the pi binary's realpath.
  try {
    const bin = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    if (bin) {
      const candidate = path.resolve(path.dirname(bin), "../lib/node_modules/@earendil-works/pi-coding-agent");
      attempted.push(candidate);
      if (existsSync(candidate)) return { dir: candidate, attempted };
    }
  } catch {
    attempted.push("which pi (not found)");
  }
  return { attempted };
}

const { dir: piDir, attempted } = findPiCliDir();
if (piDir) {
  await layer("loader", async () => {
    const { DefaultResourceLoader } = await import(path.join(piDir, "dist/core/resource-loader.js"));
    const { SettingsManager } = await import(path.join(piDir, "dist/core/settings-manager.js"));
    const settingsManager = SettingsManager.create(root, path.join(os.homedir(), ".pi/agent"));
    settingsManager.setProjectTrusted(true);
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: path.join(os.homedir(), ".pi/agent"), settingsManager });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    const prompts = loader.getPrompts().prompts;
    const themes = loader.getThemes().themes as Array<{ name: string }>;
    const ext = loader.getExtensions();
    const names = skills.map((s: { name: string }) => s.name);
    check("loader:skill corpus ≥ 200", skills.length >= 200, `${skills.length} skills`);
    check("loader:prompt templates ≥ 30", prompts.length >= 30, `${prompts.length} templates`);
    check("loader:no duplicate skill names", new Set(names).size === names.length);
    check("loader:no diagnostics errors", diagnostics.filter((d: { type: string }) => d.type === "error").length === 0);
    check("loader:dime theme loads", themes.some((t) => t.name === "dime"));
    check("loader:dime-guard loads with 0 errors", ext.extensions.length >= 1 && ext.errors.length === 0);
    check("loader:APPEND_SYSTEM injected", loader.getAppendSystemPrompt().join("\n").includes("db-push.yml"));
  });
} else {
  console.log(`SKIP loader:* — global pi CLI not found (attempted: ${attempted.join(" | ")})`);
}

console.log(failures === 0 ? "\npi harness audit: ALL PASS" : `\npi harness audit: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
