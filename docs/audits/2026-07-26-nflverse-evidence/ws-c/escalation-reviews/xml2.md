# Escalation review — xml2 1.6.0

**Escalation:** E1 (install-time remote code execution)
**Verdict:** **FINDING — High**
**Executes when:** `R CMD INSTALL` from source, macOS, whenever `xml2-config` resolves to the
system (SDK) libxml2 — i.e. the *default* on macOS
**Ran on this machine:** **YES — and it ran silently; the fetched script prints nothing**

## Files read in full

- `sources/xml2/configure` (86 lines)
- `sources/xml2/cleanup`
- Fetched for reading only (never executed): `https://autobrew.github.io/scripts/libxml2` —
  17 lines, sha256 `8a770649804d801c09ca7a689e5bb9e976602773d8f30b278f10c50e5cf62483`, saved to
  `scratchpad/task7-tmp/libxml2.sh` (outside `$ROOT`).

## What executes, when, under whose control

macOS ships `xml2-config`, so `configure:23-26` succeeds and populates `PKGCONFIG_CFLAGS` from it.
The maintainer then *rejects* that answer:

```
configure:30   if [ `uname` = "Darwin" ] && echo "${PKGCONFIG_CFLAGS}" | grep -sq "/usr/include$"; then
configure:31     unset PKGCONFIG_CFLAGS
configure:32     unset PKGCONFIG_LIBS
configure:33     curl -sfL "https://autobrew.github.io/scripts/libxml2" > autobrew
configure:34     . ./autobrew
```

The stated reason is r-lib/xml2#471 (shared libxml2 exposes bugs in R.app). The effect is that on a
default macOS host the *normal, successful* configuration is discarded in favour of a network
fetch. Unpinned URL, no checksum, dot-sourced into the configure shell.

The fetched script:

- `libxml2.sh:3` — `bottle="https://github.com/autobrew/bundler/releases/download/libxml2-2.14.4/libxml2-2.14.4-universal.tar.xz"`
- `:10-13` — download, `tar -xf`, `rm`, rename `libxml2.a` → `.deps/libxml2`
- `:16-17` — `PKG_CFLAGS="-I${BREWDIR}/include/libxml2 -I${BREWDIR}/include"`,
  `PKG_LIBS="${BREWDIR}/libxml2 -lz -lpthread -licucore -lm"`
- `:2` — honours `DISABLE_AUTOBREW`
- **It contains no `echo`.** Unlike the curl/libuv/v8 scripts it announces nothing, so an install
  log shows no evidence that a remote script ran. This is the single most important operational
  detail in the E1 group: *absence of an "autobrew" line in a log does not mean autobrew did not
  run.*

## Provenance on this machine

| Evidence | Value |
|---|---|
| `installed-manifest.csv` | `"xml2","1.6.0",...,"yes","R 4.6.1; aarch64-apple-darwin25.4.0; 2026-07-27 04:23:38 UTC; unix","2026-07-26T21:23:38"` |
| install log `bznitqj7o.output:51` | `trying URL 'https://cloud.r-project.org/src/contrib/xml2_1.6.0.tar.gz'` |
| install log `:1552-1555` | `* installing *source* package 'xml2' ...` → `** using staged installation` → straight to `Using PKG_CFLAGS=`. **No `Found pkg-config cflags and libs!` line** (that string appears 0 times in the whole log), so `configure:45-49` was not reached |
| install log `:1556` | `Using PKG_CFLAGS=-I/…/xml2/.deps/include/libxml2 -I…` — matches `libxml2.sh:16` exactly, including the `.deps` directory name the script creates at `:6` |
| install log `:1557` | `Using PKG_LIBS=/…/xml2/.deps/libxml2 -lz -lpthread -licucore -lm` — matches `libxml2.sh:17` **token for token**, including the unusual `-licucore` |
| `otool -L .../site-library/xml2/libs/xml2.so` | `/usr/lib/libz.1.dylib`, `/usr/lib/libSystem.B.dylib`, `/usr/lib/libicucore.A.dylib`, `libR.dylib`, `libc++.1.dylib` — **no libxml2 dylib**; static libxml2 2.14.4 is inside the 1.07 MB `xml2.so` |

The `PKG_LIBS` string is a fingerprint: nothing else in the R ecosystem produces
`.deps/libxml2 -lz -lpthread -licucore -lm`. Independently, `.deps` appears nowhere in xml2's own
`configure` or `src/Makevars.in` — the only other mention is `cleanup:2`, which deletes it. The
directory can only have been created by the fetched script (`libxml2.sh:6-7`). The autobrew path
ran; the conclusion holds by both fingerprint and elimination.

`cleanup:2` then runs `rm -Rf src/Makevars configure.log autobrew .deps` — the fetched script and
the extracted static library are both destroyed, leaving `xml2.so` as the only witness.

## Verdict and rationale

**FINDING — High.** Structurally identical to `curl` and `fs`, with two aggravating factors.
First, the macOS branch fires on the *success* path, not a fallback — a correctly configured host
still reaches the network, so "we have the library installed" is not a mitigation. Second, the
script is silent, so the standard forensic method (grep the install log for `autobrew`) produces a
false negative; this audit only resolved it by fingerprinting the linker flags. The payload is an
XML parser, which is a classic memory-safety target and is invoked on remote content wherever the
closure parses HTML/XML. As with the rest of E1, nothing observed indicates the fetched content was
anything other than the legitimate autobrew bundle — but **libxml2 2.14.4 of unverified provenance
is resident in `xml2.so` today**, and WS-B's PASS on `xml2_1.6.0.tar.gz` does not cover it: the
bundle was fetched by that tarball at install time, outside CRAN's chain of custody. See
`STRUCTURAL-LIMITATIONS.md` §L4.

## Defender action

1. Install binaries; `configure` never runs.
2. Source builds: `DISABLE_AUTOBREW=1` (`libxml2.sh:2`) plus a real libxml2
   (`brew install libxml2` and set `PKG_CONFIG_PATH`), or accept the system libxml2 by patching out
   the `configure:30-35` branch in a vendored tarball.
3. **Do not use "no `autobrew` string in the log" as evidence.** Fingerprint instead: look for
   `.deps/` in `PKG_CFLAGS`/`PKG_LIBS`, and run `otool -L` on the built `.so`. Add this check to any
   build-provenance tooling covering the other four E1 packages too.
4. Egress-restrict the build host.
5. Static libxml2 2.14.4 is frozen at build time; track libxml2 CVEs and rebuild to patch.
