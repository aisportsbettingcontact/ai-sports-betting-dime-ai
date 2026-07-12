import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "dist/public");
const forbidden = [
  "allowsLocalChatPreview",
  "allowsLocalDimePreview",
  "preview=1",
  'get("preview")',
  "get('preview')",
];
const extensions = new Set([".css", ".html", ".js"]);

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath);
    return extensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

if (!fs.existsSync(outputRoot)) {
  console.error(`[preview-production] build output not found: ${outputRoot}`);
  process.exit(1);
}

const files = collectFiles(outputRoot);
let failed = false;

for (const token of forbidden) {
  const matches = files.filter(file => fs.readFileSync(file, "utf8").includes(token));
  console.log(`[preview-production] ${JSON.stringify(token)}: ${matches.length} matches`);
  for (const match of matches) console.log(`  ${path.relative(outputRoot, match)}`);
  failed ||= matches.length > 0;
}

if (failed) {
  console.error("[preview-production] FAIL: development preview capability reached production output");
  process.exit(1);
}

console.log("[preview-production] PASS: production output contains no preview-gate tokens");
