import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { promisify } from "node:util";

const EXECUTABLE_CANDIDATES = Object.freeze({
  git: ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"],
  gh: ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"],
  op: ["/opt/homebrew/bin/op", "/usr/local/bin/op", "/usr/bin/op"],
  aws: ["/opt/homebrew/bin/aws", "/usr/local/bin/aws", "/usr/bin/aws"],
  env: ["/usr/bin/env"],
});

export const FIXED_CHILD_PATH = "/usr/bin:/bin";
export const EXECUTABLE_TRUST_DIRECTORY =
  "/Library/Application Support/DimeAI/trust/executables";
const execFileAsync = promisify(execFile);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isWithin(path, root) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(normalizedRoot);
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => digest.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return digest.digest("hex");
}

function exactMode(state, mode) {
  return (state.mode & 0o7777) === mode;
}

async function verifyRootOwnedHashPin(name, executableSha256) {
  const pinPath = resolve(EXECUTABLE_TRUST_DIRECTORY, `${name}.sha256`);
  const [directory, pin, expected] = await Promise.all([
    lstat(EXECUTABLE_TRUST_DIRECTORY),
    lstat(pinPath),
    readFile(pinPath, "utf8"),
  ]).catch(() => {
    throw new Error(
      `${name} execution is blocked: independent root-owned provenance is unavailable`
    );
  });
  invariant(
    directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      directory.uid === 0 &&
      exactMode(directory, 0o755),
    `${name} executable trust directory must be root-owned mode 0755`
  );
  invariant(
    pin.isFile() &&
      !pin.isSymbolicLink() &&
      pin.uid === 0 &&
      exactMode(pin, 0o444),
    `${name} executable provenance must be root-owned mode 0444`
  );
  invariant(
    /^[0-9a-f]{64}\n?$/.test(expected) && expected.trim() === executableSha256,
    `${name} executable does not match independent provenance`
  );
  return "root-owned-immutable-sha256";
}

async function verifyOnePasswordSigningIdentity(path) {
  if (process.platform !== "darwin") {
    throw new Error(
      "op execution is blocked: the reviewed macOS signing identity cannot be verified"
    );
  }
  let output = "";
  try {
    const result = await execFileAsync(
      "/usr/bin/codesign",
      ["-dv", "--verbose=4", path],
      {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: fixedMinimalEnvironment(),
      }
    );
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  } catch (error) {
    output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
  }
  invariant(
    /^Identifier=com\.1password\.op$/m.test(output) &&
      /^TeamIdentifier=2BUA8C4S2C$/m.test(output),
    "op execution is blocked: signing identity mismatch"
  );
  return "developer-team-id:2BUA8C4S2C";
}

export async function verifyAbsoluteExecutable(
  path,
  {
    label = "executable",
    allowedRoots = [
      "/opt/homebrew",
      "/usr/local",
      "/usr/bin",
      "/bin",
      "/opt/hostedtoolcache",
      dirname(process.execPath),
    ],
    expectedSha256 = null,
  } = {}
) {
  invariant(
    typeof path === "string" && isAbsolute(path),
    `${label} path must be absolute`
  );
  const canonicalPath = await realpath(path);
  const canonicalRoots = await Promise.all(
    allowedRoots.map(async root => {
      try {
        return await realpath(root);
      } catch {
        return resolve(root);
      }
    })
  );
  invariant(
    canonicalRoots.some(root => isWithin(canonicalPath, root)),
    `${label} canonical path is outside trusted executable roots`
  );
  const state = await lstat(canonicalPath);
  invariant(state.isFile(), `${label} must be a regular file`);
  invariant(
    !state.isSymbolicLink(),
    `${label} canonical path must not be a symlink`
  );
  invariant(
    state.uid === 0 || state.uid === process.getuid(),
    `${label} ownership is untrusted`
  );
  invariant(
    (state.mode & 0o022) === 0,
    `${label} must not be group- or world-writable`
  );
  await access(canonicalPath, 1);
  const executableSha256 = await sha256File(canonicalPath);
  if (expectedSha256 !== null) {
    invariant(
      executableSha256 === expectedSha256,
      `${label} SHA-256 does not match its trusted provenance`
    );
  }
  return {
    path: canonicalPath,
    sha256: executableSha256,
    uid: state.uid,
    mode: state.mode & 0o7777,
  };
}

const resolvedExecutables = new Map();

export async function resolveTrustedExecutable(name, options = {}) {
  if (name === "node") {
    const executable = await verifyAbsoluteExecutable(process.execPath, {
      label: "node",
      ...options,
    });
    return {
      ...executable,
      trust: options.skipIndependentTrust
        ? "test-only-structural-verification"
        : await verifyRootOwnedHashPin("node", executable.sha256),
    };
  }
  invariant(
    Object.hasOwn(EXECUTABLE_CANDIDATES, name),
    `unknown trusted executable: ${name}`
  );
  const cacheKey = `${name}:${JSON.stringify(options)}`;
  if (!resolvedExecutables.has(cacheKey)) {
    resolvedExecutables.set(
      cacheKey,
      (async () => {
        const failures = [];
        for (const candidate of options.candidatePaths ??
          EXECUTABLE_CANDIDATES[name]) {
          try {
            const executable = await verifyAbsoluteExecutable(candidate, {
              label: name,
              ...options,
            });
            const trust = options.skipIndependentTrust
              ? "test-only-structural-verification"
              : name === "op"
                ? await verifyOnePasswordSigningIdentity(executable.path)
                : await verifyRootOwnedHashPin(name, executable.sha256);
            return { ...executable, trust };
          } catch (error) {
            failures.push(error?.message ?? String(error));
          }
        }
        throw new Error(
          `${name} trusted executable is unavailable: ${failures.join("; ")}`
        );
      })()
    );
  }
  return resolvedExecutables.get(cacheKey);
}

export function fixedMinimalEnvironment(extra = {}) {
  const allowed = [
    "HOME",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "SSH_AUTH_SOCK",
  ];
  return {
    ...Object.fromEntries(
      allowed
        .filter(name => process.env[name] !== undefined)
        .map(name => [name, process.env[name]])
    ),
    PATH: FIXED_CHILD_PATH,
    NO_COLOR: "1",
    PAGER: "cat",
    ...extra,
  };
}
