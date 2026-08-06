#!/usr/bin/env node

const MAX_RAW_BYTES = 8 * 1024 * 1024;
const chunks = [];
let bytes = 0;

try {
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_RAW_BYTES) throw new Error("response too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks, bytes);
  chunks.length = 0;
  const payload = JSON.parse(raw.toString("utf8"));
  raw.fill(0);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid Railway variable response");
  }
  const credential = payload.RAILWAY_API_TOKEN;
  for (const name of Object.keys(payload)) payload[name] = null;
  if (
    typeof credential !== "string" ||
    credential.length < 20 ||
    credential.length > 16 * 1024 ||
    /\s/.test(credential)
  ) {
    throw new Error("Railway API credential is unavailable");
  }
  process.stdout.write(credential);
} catch {
  process.stderr.write("Railway Keychain import filter failed closed.\n");
  process.exitCode = 1;
} finally {
  for (const chunk of chunks) chunk.fill(0);
}
