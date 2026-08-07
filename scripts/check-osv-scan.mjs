/**
 * check-osv-scan.mjs — dependency security gate, replacing `pnpm audit`.
 *
 * Consumes osv-scanner's JSON output (scripts/../osv-scanner.toml already
 * strips ignore-listed findings out of that JSON via [[IgnoredVulns]]) and
 * decides pass/fail: any remaining HIGH or CRITICAL vulnerability fails the
 * gate, as does any finding the scanner could not rate at all (UNKNOWN).
 * MODERATE and LOW are reported but do not fail the build.
 *
 * Why osv-scanner instead of `pnpm audit` or `npm audit`: see the comment
 * block at the top of osv-scanner.toml for the full history (npm endpoint
 * retirement, pnpm v11 migration risk, npm's Yarn patch: protocol failure).
 * osv-scanner reads pnpm-lock.yaml directly — no install, no dependency
 * resolution — so it audits the *actual* pinned versions.
 *
 * Usage:
 *   osv-scanner scan source --lockfile=pnpm-lock.yaml --config=osv-scanner.toml \
 *     --format=json --output-file=osv-report.json
 *   node scripts/check-osv-scan.mjs --input=osv-report.json
 *
 * Exit codes: 0 gate passes; 1 new HIGH/CRITICAL/UNKNOWN finding; 2 usage/malformed-report error.
 */

import { readFileSync } from "node:fs";

// UNKNOWN blocks. An advisory that carries neither a GHSA-reviewed severity nor
// a CVSS rollup used to fall through to the non-blocking bucket, so a finding
// the scanner could not rate passed the gate silently — the gate failing open on
// exactly the advisories it understood least. Unrateable is not the same as
// harmless, and the cost of the two mistakes is not symmetric: a false block
// costs one triage, a false pass ships the vulnerability. Every finding is now
// rated or it stops the build.
const FAILING_SEVERITIES = new Set(["HIGH", "CRITICAL", "UNKNOWN"]);

function parseArgs(argv) {
  const args = { input: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
  }
  return args;
}

function severityFromCvssScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s >= 9.0) return "CRITICAL";
  if (s >= 7.0) return "HIGH";
  if (s >= 4.0) return "MEDIUM";
  if (s > 0) return "LOW";
  return null;
}

function vulnSeverity(vuln, groupMaxSeverity) {
  const declared = vuln.database_specific?.severity;
  if (declared) return declared.toUpperCase();
  // Fallback for advisories with no GHSA-reviewed severity field: derive
  // from the package group's CVSS score (osv-scanner's own rollup).
  return severityFromCvssScore(groupMaxSeverity);
}

export function evaluateScan(report) {
  if (!Array.isArray(report.results)) {
    throw new Error(
      'Malformed osv-scanner report: missing or non-array "results" field'
    );
  }

  const flagged = [];
  const other = [];

  for (const result of report.results) {
    for (const pkg of result.packages ?? []) {
      const name = pkg.package?.name ?? "<unknown>";
      const version = pkg.package?.version ?? "<unknown>";
      const maxSeverityById = new Map();
      for (const group of pkg.groups ?? []) {
        for (const id of group.ids ?? [])
          maxSeverityById.set(id, group.max_severity);
      }
      for (const vuln of pkg.vulnerabilities ?? []) {
        // `?? "UNKNOWN"` is the fail-closed step: an unrateable finding gets a
        // name instead of a null that silently sorted into `other`.
        const severity =
          vulnSeverity(vuln, maxSeverityById.get(vuln.id)) ?? "UNKNOWN";
        const entry = { pkg: name, version, id: vuln.id, severity };
        if (FAILING_SEVERITIES.has(severity)) {
          flagged.push(entry);
        } else {
          other.push(entry);
        }
      }
    }
  }

  return { flagged, other };
}

function main() {
  const { input } = parseArgs(process.argv);
  if (!input) {
    console.error(
      "[USAGE] node scripts/check-osv-scan.mjs --input=<osv-report.json>"
    );
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(input, "utf8"));
  } catch (err) {
    console.error(`[ERROR] Failed to read/parse ${input}: ${err.message}`);
    console.error(
      "[VERIFY] A missing or unparseable report means the scan itself failed — this must not be treated as a pass."
    );
    process.exit(2);
  }

  let flagged, other;
  try {
    ({ flagged, other } = evaluateScan(report));
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exit(2);
  }

  console.log(
    `[STATE] ${other.length} non-blocking finding(s) (MODERATE/LOW, or below the severity threshold), ${flagged.length} blocking (HIGH/CRITICAL/UNKNOWN).`
  );

  if (flagged.length > 0) {
    const unknown = flagged.filter(f => f.severity === "UNKNOWN");
    console.error(
      "[OUTPUT] FAIL — new HIGH/CRITICAL or unrateable vulnerability not covered by osv-scanner.toml's ignore list:"
    );
    for (const { pkg, version, id, severity } of flagged) {
      console.error(`  [FLAGGED] ${pkg}@${version} (${severity}) — ${id}`);
    }
    if (unknown.length > 0) {
      console.error(
        `[VERIFY] ${unknown.length} finding(s) carry NO severity — neither database_specific.severity nor a CVSS rollup. They block by design: the scanner could not rate them, so a human must. Rate each one against its advisory, then fix it or ignore-list it with the rating written down.`
      );
    }
    console.error(
      "[VERIFY] Review the finding — add an [[IgnoredVulns]] entry in osv-scanner.toml only after confirming no fix exists, with a documented reason."
    );
    process.exit(1);
  }

  console.log("[OUTPUT] PASS — no new HIGH or CRITICAL vulnerabilities found.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
