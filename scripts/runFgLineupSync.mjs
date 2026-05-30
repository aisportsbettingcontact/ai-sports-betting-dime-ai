/**
 * runFgLineupSync.mjs
 * One-shot script: delete stale tabs, populate 05-30-2026 LINEUPS and 05-31-2026 LINEUPS.
 * Run with: node scripts/runFgLineupSync.mjs
 */

import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
  console.log("[Script] [INPUT] .env loaded from", envPath);
} else {
  console.warn("[Script] [VERIFY] WARN — .env not found at", envPath, "— relying on process env");
}

// We need to compile and run the TypeScript sync function.
// Use tsx to execute the TypeScript directly.
const syncScript = path.join(__dirname, "..", "server", "fangraphsLineupSync.ts");
console.log("[Script] [STEP] Executing fangraphsLineupSync.ts via tsx...");

try {
  const result = execSync(
    `npx tsx --tsconfig tsconfig.json -e "
import { syncFangraphsLineupTabs } from '${syncScript.replace(/\\/g, "/")}';
syncFangraphsLineupTabs().then(r => {
  console.log('[Script] [OUTPUT] Sync result:', JSON.stringify(r, null, 2));
  process.exit(r.success ? 0 : 1);
}).catch(err => {
  console.error('[Script] [VERIFY] FAIL —', err.message);
  process.exit(1);
});
"`,
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: process.env,
      timeout: 120_000,
    }
  );
} catch (err) {
  console.error("[Script] [VERIFY] FAIL — execSync threw:", err.message);
  process.exit(1);
}
