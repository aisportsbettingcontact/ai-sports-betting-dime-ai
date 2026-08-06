# Escalation review — fs 2.1.0

**Escalation:** E1 (install-time remote code execution)
**Verdict:** **FINDING — High**
**Executes when:** `R CMD INSTALL` from source, macOS, when pkg-config cannot find libuv
**Ran on this machine:** **YES — confirmed, static libuv linked into the installed `.so`**

## Files read in full

- `sources/fs/configure` (71 lines)
- `sources/fs/cleanup`
- Fetched for reading only (never executed): `https://autobrew.github.io/scripts/libuv` — 22 lines,
  sha256 `fb005c932fe69b3171455fcf94629e9ea5ef319d8cb0283a46e5d131ac11fee2`, saved to
  `scratchpad/task7-tmp/libuv.sh` (outside `$ROOT`).

## What executes, when, under whose control

`configure:15-18` tries pkg-config for `libuv`. Homebrew does not install `libuv` unless something
asked for it, so on a stock macOS box `PKGCONFIG_CFLAGS`/`PKGCONFIG_LIBS` are empty and control
reaches:

```
configure:25   elif [ "$(uname)" = "Darwin" ] && [ -z "$USE_BUNDLED_LIBUV" ]; then
configure:26     curl -sfL "https://autobrew.github.io/scripts/$PKG_BREW_NAME" > autobrew
configure:27     . ./autobrew
```

`PKG_BREW_NAME` is the literal `"libuv"` (`configure:10`), so the URL is
`https://autobrew.github.io/scripts/libuv`. Unpinned, unchecksummed, dot-sourced into the configure
shell.

Note the ordering: **`fs` ships a vendored static libuv in its own tarball** and will use it if
`USE_BUNDLED_LIBUV` is set (`configure:28-37`, `src/Makevars.vendor`), but on macOS the *network
fetch is preferred over the code already on disk*. That inversion is what makes this worth a
finding rather than a note.

What the fetched script does (read from the saved copy):

- `libuv.sh:3` — `bottle="https://github.com/autobrew/bundler/releases/download/libuv-1.52.0/libuv-1.52.0-sonoma-universal.tar.xz"`
- `:9-11` — `curl -sSL $bottle -o libs.tar.xz` → `tar -xf ... -C $PWD/.deps` → `rm -f libs.tar.xz`
- `:19-22` — copies `libuv.a` to `.deps/libuv`, deletes `.deps/lib`, hardcodes `PKG_LIBS`/`PKG_CFLAGS`
- `:2` — honours `DISABLE_AUTOBREW`

`cleanup:2` then runs `rm -f src/Makevars configure.log autobrew .deps`, removing the fetched
script. (Note the missing `-Rf`: `fs`'s cleanup is the one that cannot actually delete the `.deps`
*directory*, only a file of that name — a trivial upstream bug, and irrelevant because `R CMD
INSTALL` discards the whole staging tree anyway. Either way nothing is retained in the installed
package.)

## Provenance on this machine

| Evidence | Value |
|---|---|
| `installed-manifest.csv` | `"fs","2.1.0",...,"yes","R 4.6.1; aarch64-apple-darwin25.4.0; 2026-07-27 04:23:02 UTC; unix","2026-07-26T21:23:02"` |
| install log `bznitqj7o.output:44` | `trying URL 'https://cloud.r-project.org/src/contrib/fs_2.1.0.tar.gz'` |
| install log `:717` | `* installing *source* package 'fs' ...` |
| install log `:721` | **`Using autobrew bundle: libuv-1.52.0-sonoma-universal.tar.xz`** — string is unique to `libuv.sh:4` |
| install log `:722-723` | `PKG_CFLAGS=-I.../fs/.deps/include`, `PKG_LIBS=.../fs/.deps/libuv -lpthread -lm` — byte-for-byte the assignment at `libuv.sh:21-22` |
| `otool -L .../site-library/fs/libs/fs.so` | `/usr/lib/libSystem.B.dylib`, `libR.dylib`, `/usr/lib/libc++.1.dylib` only — **no libuv dylib**, i.e. the downloaded `libuv.a` is statically inside the 220 KB `fs.so` |

## Verdict and rationale

**FINDING — High**, for the same structural reason as `curl`: unpinned remote script dot-sourced at
install time, then an unverified prebuilt binary archive linked into a shared object that the R
process loads. The durable half of that is what matters — **`libuv` 1.52.0 of unverified provenance
is resident inside `fs.so` right now**, and WS-B's integrity work does not reach it: WS-B verified
`fs_2.1.0.tar.gz` against CRAN and two mirrors (PASS), but the autobrew bundle was fetched *by* that
tarball at install time, entirely outside CRAN's chain of custody. See
`STRUCTURAL-LIMITATIONS.md` §L4 for the closure-wide statement. `fs` is a lower-value target than `curl` (it is a filesystem-path library, not the
HTTPS transport), which argues for a lower severity — but it is loaded by a large fraction of the
tidyverse-adjacent closure and runs in-process, so a poisoned `libuv.a` would still be arbitrary
native code in every R session that touches `fs`. The aggravating detail specific to `fs` is that a
vendored libuv is already present in the tarball and the macOS branch prefers the network anyway;
`USE_BUNDLED_LIBUV=1` is a fully supported, zero-network alternative that the default path declines
to take. Nothing observed suggests the fetched content was hostile.

## Defender action

1. Install binaries (Posit Package Manager / CRAN macOS binaries) — `configure` never runs.
2. If building from source, set **`USE_BUNDLED_LIBUV=1`**. This is the cleanest fix in the whole E1
   group: it is an in-tarball static build with no network access at all (`configure:33-37`).
   `DISABLE_AUTOBREW=1` also works but leaves you needing a system libuv.
3. Verify afterwards with `otool -L fs.so` and by confirming `Building static libuv` appears in the
   install log instead of `Using autobrew bundle:`.
4. Egress-restrict build hosts so `autobrew.github.io` is unreachable and the install fails loudly.
