import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "vitest";

import {
  createIntegrityEnvelopeForTest,
  verifyIntegrityEnvelope,
  writeIntegrityProtectedJson,
} from "./lib/dime-integrity-envelope.mjs";

test("forged context cache payloads are rejected", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = createIntegrityEnvelopeForTest(
    {
      kind: "dime-control-plane-status",
      summary: { connection: "PASS" },
    },
    privateKey,
    publicKey
  );
  assert.equal(
    verifyIntegrityEnvelope(envelope, publicKey).summary.connection,
    "PASS"
  );
  const forged = structuredClone(envelope);
  forged.payload.summary.connection = "FORGED";
  assert.throws(
    () => verifyIntegrityEnvelope(forged, publicKey),
    /signature verification failed/
  );
});

test("same-user code cannot obtain a cache-signing oracle", async () => {
  await assert.rejects(
    writeIntegrityProtectedJson("/tmp/forbidden-dime-cache.json", {
      forged: true,
    }),
    /independently attested writer/
  );
});
