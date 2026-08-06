# Escalation review — curl 7.1.0

**Escalation:** E1 (install-time remote code execution)
**Verdict:** **FINDING — High**
**Executes when:** `R CMD INSTALL` from source, macOS, when pkg-config cannot supply libcurl >= 8.8.0
**Ran on this machine:** **YES — confirmed, with the fetched bundle linked into the installed `.so`**

## Files read in full

- `sources/curl/configure` (106 lines)
- `sources/curl/cleanup`
- Fetched for reading only (never executed): `https://autobrew.github.io/scripts/libcurl-macos`
  — 26 lines, sha256 `8c8b4874c9ec76af535d270431421b93877d98ff995fa187f48ac4e2d356c4bc`,
  fetched 2026-07-26 into `scratchpad/task7-tmp/libcurl-macos.sh` (outside `$ROOT`).

## What executes, when, under whose control

`configure:21-23` forces `MINVERSION="--atleast-version=8.8.0"` on Darwin, because macOS ships a
libcurl the maintainer considers buggy (`configure:19-20`, referencing jeroen/curl#376). Homebrew's
`curl` is keg-only and its `.pc` file is deliberately **not** on the default `PKG_CONFIG_PATH`
(`configure:17` shows the export commented out), so on a stock Homebrew macOS box the pkg-config
branch at `configure:44-47` cannot fire. Control therefore falls through to:

```
configure:50   curl -sfL "https://autobrew.github.io/scripts/libcurl-macos" > autobrew
configure:51   . ./autobrew
```

A shell script is downloaded over the network and **dot-sourced into the running configure shell**.
There is no hash, no signature, no version pin — the URL is a mutable path on a GitHub Pages site.
Whatever that URL serves at install time runs with the invoking user's privileges.

What it served on 2026-07-26 (read from the fetched copy):

- `libcurl-macos.sh:7` — `bottle="https://github.com/autobrew/bundler/releases/download/curl-macos-8.14.1/curl-macos-8.14.1-universal.tar.xz"`
- `:15-17` — `curl -sSL $bottle -o libs.tar.xz` → `tar -xf libs.tar.xz --strip 1 -C $PWD/.deps` → `rm -f libs.tar.xz`
- `:18` — renames `.deps/lib/libcurl.a` to `.deps/libcurl`
- `:23` — hardcodes `PKG_LIBS` to link that static archive plus macOS system frameworks
- `:4` — honours `DISABLE_AUTOBREW` (an opt-out exists)

So the chain is: unpinned script URL → unpinned, unchecksummed **binary** tarball → statically
linked into `curl.so`. Then `cleanup:2-3` runs
`rm -f src/Makevars configure.log get-curl-linux.sh` and **`rm -Rf .deps autobrew`** — destroying
both the fetched script and the extracted binary. Neither artefact survives for inspection; the
only durable evidence of what happened is the linker fingerprint in `curl.so` itself.

`configure:91` is the Linux-only sibling (`get-curl-linux.sh` from a jeroen/curl release tag). It
sits inside `if [ \`uname\` = "Linux" ]` at `configure:88`; `uname` is `Darwin` here, so it is
unreachable on this platform and is **not** a live row.

## Provenance on this machine

| Evidence | Value |
|---|---|
| `installed-manifest.csv` | `"curl","7.1.0",...,"yes","R 4.6.1; aarch64-apple-darwin25.4.0; 2026-07-27 04:23:08 UTC; unix","2026-07-26T21:23:08"` — compiled from source |
| install log `bznitqj7o.output:58` | `trying URL 'https://cloud.r-project.org/src/contrib/curl_7.1.0.tar.gz'` |
| install log `:781` | `* installing *source* package 'curl' ...` |
| install log `:784` | **`Using autobrew bundle: curl-macos-8.14.1-universal.tar.xz`** — this string exists only at `libcurl-macos.sh:8`, i.e. the fetched script *ran* |
| install log `:785-786` | `PKG_CFLAGS`/`PKG_LIBS` pointing at `.../R.INSTALL4eec4f46d845/curl/.deps/...` |
| `grep -c 'Found pkg-config cflags' bznitqj7o.output` | **0** — the pkg-config branch was never taken by any package |
| `otool -L /opt/homebrew/lib/R/4.6/site-library/curl/libs/curl.so` | `/usr/lib/libapple_nghttp2.dylib`, `/usr/lib/libssl.48.dylib`, `/usr/lib/libcrypto.46.dylib`, LDAP/Kerberos/Security frameworks, **no `libcurl` dylib at all** — exactly the flag set at `libcurl-macos.sh:23`; the static libcurl is baked into the 838 KB `curl.so` |

This is not inference. The autobrew path ran, and its output is in the binary that is loaded on
every `library(nflreadr)`.

## Verdict and rationale

**FINDING — High.** This is install-time arbitrary code execution from an unpinned URL, and it was
*exercised on this host*. It is not evidence of compromise: the script fetched today is a plain
7-line bottle downloader, the bundle is a versioned GitHub release asset under the `autobrew`
organisation, everything moved over TLS, and this is a long-standing, publicly documented Anticonf
pattern from a well-known R maintainer. But the trust model has no floor other than "GitHub Pages
and the autobrew GitHub org were not compromised at 21:23 on 2026-07-26, and TLS held". A
compromise of either would have yielded code execution as this user plus a poisoned static libcurl
inside the exact package the nflverse stack uses for **all** of its HTTPS traffic — the highest-
value position in this closure. The severity is driven by blast radius and the absence of any
integrity control, not by any observed anomaly.

The finding that outlives the install, and the one to act on, is stronger than "install-time RCE":
**libcurl 8.14.1 of unverified provenance is statically resident in `curl.so` right now**, and it
`dyn.load`s into every R session that calls `library(nflreadr)`. WS-B's clean CRAN/mirror hash
verification does not cover it — WS-B verified `curl_7.1.0.tar.gz` (PASS, 3 sources), and the
autobrew content was fetched *by* that tarball at install time, entirely outside CRAN's chain of
custody. With `cleanup` having destroyed the script and the archive, no artefact remains that could
be hashed against upstream even retrospectively. See `STRUCTURAL-LIMITATIONS.md` §L4 for the
closure-wide statement.

## Defender action

1. **Preferred:** install binaries. `options(repos = c(CRAN = "https://p3m.dev/cran/latest"))` and
   `install.packages(..., type = "binary")` — `configure` never runs, no network fetch, and the
   artefact is one CRAN-checksummed object.
2. If building from source is required, set `DISABLE_AUTOBREW=1` (honoured at
   `libcurl-macos.sh:4`) and provide libcurl yourself:
   `PKG_CONFIG_PATH=/opt/homebrew/opt/curl/lib/pkgconfig R CMD INSTALL curl_7.1.0.tar.gz`.
   Verify with `otool -L` that `curl.so` links `/opt/homebrew/opt/curl/lib/libcurl.4.dylib`.
3. Network-isolate build hosts, or run source installs behind an egress allowlist that does not
   include `autobrew.github.io` — the install then fails loudly instead of silently fetching.
4. Record `otool -L` output for `curl.so`, `fs.so`, `V8.so`, `xml2.so` as a build-provenance
   artefact; it is the only durable evidence of which path was taken, since `cleanup` removes the
   script.
5. A statically linked libcurl does **not** receive `brew upgrade curl`. Track libcurl CVEs against
   version 8.14.1 and rebuild the package to patch, rather than assuming the OS handles it.
