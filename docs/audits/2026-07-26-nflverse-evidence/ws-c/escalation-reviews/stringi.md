# Escalation review — stringi 1.8.7

**Escalation:** E11 (icudt download during install)
**Verdict:** **BENIGN** — proven, not assumed
**Executes when:** `R CMD INSTALL` from source, **only if** the ICU data file is missing from the
tarball
**Ran on this machine:** **NO download occurred** — the shipped file was used, and its hash matches

## Files read

`sources/stringi/R/install.R:80-140`, `sources/stringi/configure:4030-4060`,
`sources/stringi/src/install.libs.R`, `sources/stringi/src/icu74/data/` (directory listing and
checksum files).

## What executes, when, under whose control

WS-C classified this a `note` rather than a finding and asked Task 7 only to "confirm the shipped
`icudt74l.dat.xz` was in fact used". **Confirmed, three independent ways.**

The code path (`R/install.R:85-110`), for completeness:

```r
install.R:91    commit_id <- "bbe75eca8f9ef4dc72dc5c6e36c8f8306a324b7e"
install.R:92-97 mirrors <- sprintf("%s://raw.githubusercontent.com/gagolews/stringi/%s/src/icu%d/data/",
                                   c("https", "http"), commit_id, icu_bundle_version)
install.R:101   xzpath <- sprintf("%s.xz", path)
install.R:103-106  if (file.exists(xzpath)) { message(sprintf("%s exists", xzpath)); return(xzpath) }
```

The short-circuit at `:103-106` is the first thing the function does — if the `.xz` is already
present, it returns immediately and no network call is possible. That contrast with the E1 group is
the whole point: stringi (a) **pins a commit SHA** (`:91`), (b) verifies any download against a
`.md5sum` shipped inside the tarball, and (c) ships the file so the download never happens on
little-endian platforms. The `http://` fallback mirror at `:92-93` is only reachable after HTTPS
fails, and its result is still md5-checked.

### Evidence 1 — the file is in the tarball

`sources/stringi/src/icu74/data/` contains `icudt74l.dat.xz` (7,490,620 bytes, dated Oct 5 2024)
alongside `icudt74l.dat.md5sum`, `icudt74l.dat.sha256sum`, the big-endian checksums, `LICENSE` and
`SOURCE`.

### Evidence 2 — the install log says the short-circuit fired

```
bznitqj7o.output:2181  checking whether the ICU data library is available... icu74/data/icudt74l.dat.xz exists
bznitqj7o.output:2189      ICUDT_DIR=icu74/data
bznitqj7o.output:2191      ICUDT_ENDIANNESS=little
bznitqj7o.output:2742  icu74/data/icudt74l.dat.xz exists
bznitqj7o.output:2743  decompressing icu74/data/icudt74l.dat.xz to: .../00LOCK-stringi/00new/stringi/libs
bznitqj7o.output:2744  icudt74l.dat installed successfully
```
`"icu74/data/icudt74l.dat.xz exists"` is the message emitted at `install.R:104`. There is no
`Downloading` line and no `raw.githubusercontent` string anywhere in either install log
(`grep -n 'raw.githubusercontent\|github.com' bznitqj7o.output` → **no matches**).

### Evidence 3 — the installed artefact hashes to the shipped value

| | |
|---|---|
| `icudt74l.dat.md5sum` (shipped in tarball) | `f009e2b79e9d4006411e43d893b122ff *icudt74l.dat` |
| `md5 -q /opt/homebrew/lib/R/4.6/site-library/stringi/libs/icudt74l.dat` | **`f009e2b79e9d4006411e43d893b122ff`** |

Exact match. The 30,783,664-byte ICU data file installed on this machine is the decompression of the
`.xz` that shipped inside the CRAN tarball WS-B verified (PASS across three sources). No bytes came
from the network.

`src/install.libs.R` copies the shared object and installs icudt with writes confined to
`R_PACKAGE_DIR` (`hooks-inventory.md`, re-verified).

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"stringi","1.8.7","file LICENSE","yes","R 4.6.1; aarch64-apple-darwin25.4.0; …","2026-07-26T21:23:05"` |
| install log `bznitqj7o.output:28, 130` | `trying URL '.../stringi_1.8.7.tar.gz'`; `begin installing package 'stringi'` |
| Installed `libs/` | `icudt74l.dat` (30,783,664 B) + `stringi.so` (6,799,448 B) |

## Verdict and rationale

**BENIGN.** This is the counter-example that makes the E1 findings meaningful. stringi has the same
underlying need — a large third-party dependency that some platforms cannot supply — and solves it
with a pinned commit, a checksum shipped in-band, and a bundled copy that makes the network path
dead code on every mainstream architecture. Three independent lines of evidence show no download
occurred here and the installed bytes match the shipped checksum. The residual `http://` fallback
(`install.R:92-93`) is worth a line in the report as a hardening opportunity, not a finding: it is
unreachable unless HTTPS fails, and the result is still md5-verified.

## Defender action

1. None required. If hardening for a fully offline build, note that no action is needed on
   little-endian platforms — the short-circuit at `install.R:103` handles it.
2. Worth adopting as the reference pattern when arguing upstream about the E1 packages: pin,
   checksum in-band, and ship the artefact.
3. Retain the `md5` check above as a reusable build-provenance assertion; it is cheap and it
   converts an assumption into evidence.
