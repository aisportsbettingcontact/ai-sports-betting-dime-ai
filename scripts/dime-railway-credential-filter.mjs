#!/usr/bin/env node

/**
 * Ephemeral Railway variable-map filter.
 *
 * The Railway CLI's raw JSON stdout is piped directly into this process. This
 * process validates one reviewed role triple, emits only those three values,
 * retains nothing, and exits. It never writes the raw map or errors containing
 * values.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const REVIEWED_TRIPLES = [
  [
    "DIME_PROD_OWNER_EMAIL",
    "DIME_PROD_OWNER_PASSWORD",
    "DIME_PROD_OWNER_USERNAME",
  ],
  [
    "DIME_PROD_USER_EMAIL",
    "DIME_PROD_USER_PASSWORD",
    "DIME_PROD_USER_USERNAME",
  ],
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sameNames(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

export function filterRailwayVariableMap(payload, names) {
  invariant(
    Array.isArray(names) &&
      REVIEWED_TRIPLES.some(triple => sameNames(names, triple)),
    "requested names are not one reviewed platform role triple"
  );
  invariant(
    payload && typeof payload === "object" && !Array.isArray(payload),
    "Railway variable response must be an object"
  );
  const selected = Object.fromEntries(
    names.map(name => [
      name,
      Object.hasOwn(payload, name) ? payload[name] : null,
    ])
  );
  for (const name of Object.keys(payload)) payload[name] = null;
  return selected;
}

async function main() {
  const names = JSON.parse(process.argv[2] ?? "null");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    invariant(bytes <= MAX_RAW_BYTES, "Railway variable response is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks, bytes);
  chunks.length = 0;
  const payload = JSON.parse(raw.toString("utf8"));
  raw.fill(0);
  const selected = filterRailwayVariableMap(payload, names);
  process.stdout.write(JSON.stringify(selected));
  for (const name of Object.keys(selected)) selected[name] = null;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(() => {
    process.stderr.write("Railway credential filter failed closed.\n");
    process.exitCode = 1;
  });
}
