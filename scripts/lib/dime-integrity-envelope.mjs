import {
  createHash,
  createPublicKey,
  sign as signPayload,
  verify as verifySignature,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const INTEGRITY_TRUST_DIRECTORY =
  "/Library/Application Support/DimeAI/trust/cache";
export const INTEGRITY_PUBLIC_KEY = resolve(
  INTEGRITY_TRUST_DIRECTORY,
  "cache-ed25519-public.pem"
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactMode(state, mode) {
  return (state.mode & 0o7777) === mode;
}

function canonicalPayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function asPublicKey(key) {
  return key?.type === "public" ? key : createPublicKey(key);
}

function keyId(publicKey) {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

export function createIntegrityEnvelopeForTest(payload, privateKey, publicKey) {
  const canonical = canonicalPayload(payload);
  return {
    schemaVersion: 1,
    kind: "dime-integrity-envelope",
    keyId: keyId(asPublicKey(publicKey)),
    payload,
    signature: signPayload(null, canonical, privateKey).toString("base64"),
  };
}

export function verifyIntegrityEnvelope(envelope, publicKeyInput) {
  invariant(
    envelope?.schemaVersion === 1 &&
      envelope?.kind === "dime-integrity-envelope" &&
      typeof envelope.keyId === "string" &&
      envelope.keyId.length === 64 &&
      envelope.payload &&
      typeof envelope.payload === "object" &&
      typeof envelope.signature === "string",
    "integrity envelope shape is invalid"
  );
  const publicKey = asPublicKey(publicKeyInput);
  invariant(
    envelope.keyId === keyId(publicKey),
    "integrity envelope key identity mismatch"
  );
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64");
  } catch {
    throw new Error("integrity envelope signature encoding is invalid");
  }
  invariant(
    signature.length > 0 &&
      verifySignature(
        null,
        canonicalPayload(envelope.payload),
        publicKey,
        signature
      ),
    "integrity envelope signature verification failed"
  );
  return envelope.payload;
}

async function loadPublicTrust() {
  const [directory, publicKeyState, publicKeyPem] = await Promise.all([
    lstat(INTEGRITY_TRUST_DIRECTORY),
    lstat(INTEGRITY_PUBLIC_KEY),
    readFile(INTEGRITY_PUBLIC_KEY, "utf8"),
  ]).catch(() => {
    throw new Error(
      "cache integrity trust is unavailable; unsigned cache use is blocked"
    );
  });
  invariant(
    directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      directory.uid === 0 &&
      exactMode(directory, 0o755),
    "cache trust directory must be root-owned mode 0755"
  );
  invariant(
    publicKeyState.isFile() &&
      !publicKeyState.isSymbolicLink() &&
      publicKeyState.uid === 0 &&
      exactMode(publicKeyState, 0o444),
    "cache public key must be root-owned mode 0444"
  );
  return publicKeyPem;
}

export async function readIntegrityProtectedJson(path) {
  const [state, bytes, publicKeyPem] = await Promise.all([
    lstat(path),
    readFile(path, "utf8"),
    loadPublicTrust(),
  ]);
  invariant(
    state.isFile() &&
      !state.isSymbolicLink() &&
      state.uid === process.getuid() &&
      exactMode(state, 0o600),
    "integrity-protected cache must be an owned mode-0600 regular file"
  );
  return verifyIntegrityEnvelope(JSON.parse(bytes), publicKeyPem);
}

export async function writeIntegrityProtectedJson(path, payload) {
  void path;
  void payload;
  throw new Error(
    "cache persistence is blocked until an independently attested writer is provisioned"
  );
}

export async function tryWriteIntegrityProtectedJson(path, payload) {
  try {
    await writeIntegrityProtectedJson(path, payload);
    return true;
  } catch {
    return false;
  }
}
