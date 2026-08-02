/**
 * qm-pack-verify — validates the skill corpus against qm.pack.json, the
 * canonical QM skill-pack configuration for this repo.
 *
 * One corpus, two consumers: pi ingests these skills through
 * .pi/settings.json; QM ingests them as a git skill pack scanned for
 * Agent Skills–standard SKILL.md files. This verifier makes the QM side as
 * bulletproof as pi:audit makes the pi side, deterministically and offline:
 *
 *   1. qm.pack.json parses, points at this repo, and its globs/excludes are
 *      well-formed;
 *   2. every SKILL.md selected by the pack config carries parseable
 *      frontmatter with non-empty `name` and `description` (what QM's
 *      normalize step requires — a malformed skill is silently skipped at
 *      ingest, which is exactly the kind of quiet loss this catches);
 *   3. no two selected skills share a normalized name (QM detects collisions
 *      at ingest; we fail here first so the pack always imports whole).
 *
 * Run standalone via `pnpm qm:pack:verify`; pi:audit runs it as its qm-pack
 * layer. Exits non-zero on any failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface QmPackFile {
  url: string;
  config: { skillGlobs: string[]; exclude?: string[] };
}

export interface QmPackReport {
  failures: string[];
  skillCount: number;
  names: string[];
}

function globToPrefix(glob: string): string {
  return glob.endsWith("/**") ? glob.slice(0, -3) : glob;
}

/**
 * QM's glob semantics, ported verbatim from yc-software/qm
 * src/skills/ingest.ts (globToRegExp/matchesAny): patterns match the skill
 * DIRECTORY path, not the SKILL.md file path. Cross-validated against QM's
 * own planIngest — keep this in lockstep with upstream.
 */
function qmGlobToRegExp(glob: string): RegExp {
  const re = glob
    .split("**")
    .map(seg =>
      seg
        .split("*")
        .map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*")
    )
    .join(".*");
  return new RegExp(`^${re}$`);
}

function qmMatchesAny(dirPath: string, globs: string[] | undefined): boolean {
  return !!globs && globs.some(g => qmGlobToRegExp(g).test(dirPath));
}

function walkSkillFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSkillFiles(full, out);
    else if (entry.name === "SKILL.md") out.push(full);
  }
}

function parseFrontmatter(
  raw: string
): { name?: string; description?: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || match[1] === undefined) return null;
  const attrs: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv && kv[1] !== undefined && kv[2] !== undefined) {
      attrs[kv[1]] = kv[2].trim();
    }
  }
  return attrs;
}

export function verifyQmPack(repoRoot: string = root): QmPackReport {
  const failures: string[] = [];
  const packPath = path.join(repoRoot, "qm.pack.json");

  let pack: QmPackFile;
  try {
    pack = JSON.parse(readFileSync(packPath, "utf8")) as QmPackFile;
  } catch (err) {
    return {
      failures: [
        `qm.pack.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      ],
      skillCount: 0,
      names: [],
    };
  }

  if (!pack.url?.includes("ai-sports-betting-dime-ai")) {
    failures.push("qm.pack.json url does not point at this repository");
  }
  const globs = pack.config?.skillGlobs ?? [];
  if (globs.length === 0) failures.push("qm.pack.json has no skillGlobs");
  const excludeGlobs = pack.config?.exclude ?? [];
  for (const glob of globs) {
    if (!glob.endsWith("/**")) {
      failures.push(
        `skillGlob "${glob}" must be a directory-prefix glob (dir/**)`
      );
    }
  }
  // Exclude liveness: every exclude must reference an existing directory
  // (dead excludes silently re-include superseded skills).
  for (const prefix of new Set(excludeGlobs.map(globToPrefix))) {
    if (!existsSync(path.join(repoRoot, prefix))) {
      failures.push(`pack exclude "${prefix}" points at a missing directory`);
    }
  }
  // QM matches globs against the skill DIRECTORY (verified against qm's
  // planIngest): an exclude written only as "dir/**" never matches the dir
  // itself. Require the exact-dir form for every excluded skill root.
  for (const prefix of new Set(excludeGlobs.map(globToPrefix))) {
    if (!excludeGlobs.includes(prefix)) {
      failures.push(
        `exclude "${prefix}/**" needs its exact-dir companion "${prefix}" (QM matches skill dirs, not file paths)`
      );
    }
  }

  const files: string[] = [];
  for (const glob of globs) {
    walkSkillFiles(path.join(repoRoot, globToPrefix(glob)), files);
  }
  // Selection mirrors QM's planIngest exactly: match the skill dir against
  // skillGlobs and exclude with QM's own glob semantics.
  const selected = files.filter(file => {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const skillDir = rel.slice(0, rel.lastIndexOf("/"));
    return (
      qmMatchesAny(skillDir, globs) && !qmMatchesAny(skillDir, excludeGlobs)
    );
  });

  if (selected.length < 90) {
    failures.push(
      `pack selects only ${selected.length} skills — expected the full corpus (≥ 90)`
    );
  }

  const byName = new Map<string, string>();
  for (const file of selected) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const attrs = parseFrontmatter(readFileSync(file, "utf8"));
    if (!attrs) {
      failures.push(
        `${rel}: missing or malformed frontmatter (QM would skip it)`
      );
      continue;
    }
    const name = (
      attrs.name ?? path.basename(path.dirname(file))
    ).toLowerCase();
    if (!attrs.description) {
      failures.push(`${rel}: empty description (QM auto-trigger needs one)`);
    }
    const prior = byName.get(name);
    if (prior) {
      failures.push(
        `name collision "${name}": ${prior} vs ${rel} (QM refuses colliding packs — extend qm.pack.json excludes)`
      );
    } else {
      byName.set(name, rel);
    }
  }

  return {
    failures,
    skillCount: selected.length,
    names: [...byName.keys()].sort(),
  };
}

// Standalone entry point (pnpm qm:pack:verify).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const report = verifyQmPack();
  for (const failure of report.failures)
    console.error(`FAIL qm-pack: ${failure}`);
  console.log(
    report.failures.length === 0
      ? `qm pack verify: ALL PASS — ${report.skillCount} skills, ${report.names.length} unique names`
      : `qm pack verify: ${report.failures.length} FAILURE(S)`
  );
  process.exit(report.failures.length === 0 ? 0 : 1);
}
