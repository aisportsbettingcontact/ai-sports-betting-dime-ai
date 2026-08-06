# Escalation review — tinytex 0.60

**Escalation:** E3 (downloads and executes a TeX Live installer; shells out to a package manager)
**Verdict:** **ACCEPTED-RISK — Low**
**Executes when:** call time, only on an explicit `tinytex::install_tinytex()` /
`tlmgr_install()` call
**Ran on this machine:** **NO** — no TeX Live exists on this host

## Files read

`sources/tinytex/R/install.R:180-195, 197-260, 285-360, 500-620`, `sources/tinytex/R/tlmgr.R:40-60,
118-135`, plus a full URL census of `R/*.R`.

## What executes, when, under whose control

**The normal installer path** (`install_tinytex()` → `install_prebuilt()`):
- `install.R:607` — `u = sprintf('https://github.com/rstudio/tinytex-releases/releases/download/%s/%s', v, file)`
  — HTTPS, versioned release asset, vendor-controlled (`rstudio`).
- `install.R:561` — `if (!file.exists(pkg)) download_installer(pkg, version)`
- `install.R:568` — `system2(pkg, args = c('-y', paste0('-o', path.expand(target))))` for a `.exe`
  (Windows self-extractor); on Unix `:569-570` uses `unzip`/`untar` instead. So on macOS the
  downloaded artefact is *extracted*, not executed.
- **No checksum or signature verification anywhere in this path.** Integrity rests on TLS + GitHub.

**The source path** (`install_tinytex(version = 'daily')` on unsupported platforms,
`install_tinytex_source()` at `install.R:339`):
- `install.R:348` — `download_file('https://tinytex.yihui.org/install-unx.sh')`
- `install.R:349-351` — `res = system2('sh', c('install-unx.sh', ...))`
  → download-and-run-a-shell-script, unpinned, unchecksummed, on a personal domain. This is the
  sharpest item in E3, but it is gated on `version == 'daily'` (`:340-343`).

**Privilege escalation** — `osascript()` at `install.R:300-310`:
```
301   message("Requesting admin privilege to run: sudo ", cmd)
302   escaped = gsub('"', '\\"', cmd, fixed = TRUE)
303   ret = system(sprintf("/usr/bin/osascript -e 'do shell script \"%s\" with administrator privileges'", escaped))
```
Used by `macos_path()` (`:320-337`) to write `/etc/paths.d/TinyTeX`. It pops a macOS admin password
prompt and runs the command as root. The escaping at `:302` handles `"` only; `cmd` is composed
from package-internal paths (`:330`, `:332`), not from user data, so this is not an injection sink —
but it is a root-privilege request originating from an R function call.

**Package-manager shell-out** — `tlmgr.R:128`:
```
125   if ('epstopdf' %in% pkgs && is_unix() && Sys.which('gs') == '') {
126     if (is_macos() && Sys.which('brew') != '') {
128       system('brew install ghostscript')
```
This fires **automatically** inside `tlmgr_install()` whenever the `epstopdf` TeX package is
installed and Ghostscript is missing. A user asking for a LaTeX package silently gets a Homebrew
install. Surprising, but the command string is a constant.

**Other network reads** (all HTTPS, all read-only, all inside explicit calls):
`install.R:135-136` `https://tinytex.yihui.org/pkgs-custom.txt` / `pkgs-yihui.txt`;
`:222` `https://tlnet.yihui.org`; `:227` `https://mirror.ctan.org/systems/texlive/tlnet`;
`:237` `https://ctan.org/mirrors/`; `:157` `tlmgr --repository https://www.preining.info/tlgpg/`.
`install.R:98` explicitly checks `grepl('^https://', repository)`. The documentation at `:29`
mentions an `http://` CTAN mirror as a *user-supplied* example, not a default.

`install.R:188` `system2('ldd', '--version', ...)` is a Linux musl probe — inert here.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"tinytex","0.60",...,"no","R 4.6.1; ; 2026-07-27 04:23:19 UTC; unix"` — pure R, installed as a `rmarkdown` dependency |
| install log `bznitqj7o.output:11` | `trying URL '.../tinytex_0.60.tar.gz'` — ordinary CRAN source install |
| `~/Library/TinyTeX`, `~/.TinyTeX`, `/usr/local/texlive` | **all absent** |
| `which tlmgr`, `which pdflatex` | **not found** |

`tinytex` has been installed but **never invoked**. No TeX Live installer was downloaded, no
`osascript` prompt was raised, no `brew install ghostscript` ran.

## Verdict and rationale

**ACCEPTED-RISK — Low.** "Download an installer from the internet and run it" is the package's
advertised job, every path requires an explicit user call, and none of them has been taken here. It
is accepted rather than a finding because the risk is inherent and disclosed, and because the
default macOS path extracts an archive rather than executing a downloaded script. Two items keep it
from being dismissed entirely: the `version='daily'` source path is a genuine
curl-pipe-to-shell (`install.R:348-351`) with no integrity check on a personal domain, and
`system('brew install ghostscript')` (`tlmgr.R:128`) mutates system state as a side effect of a
LaTeX package request. Severity is Low because tinytex is present only as a transitive `rmarkdown`
dependency for optional PDF output that this project does not use.

## Defender action

1. Leave it uninvoked. `tinytex` inert on disk is pure R with no load-time behaviour — it is one of
   the safest packages in the closure until called.
2. If PDF output is ever needed, prefer a system TeX Live installed and patched through the OS
   package manager, and set `options(tinytex.tlmgr.path=)` at it, rather than calling
   `install_tinytex()`.
3. Never pass `version = 'daily'` — that is the only path that downloads and `sh`-executes a script
   (`install.R:348-351`).
4. Pre-install Ghostscript deliberately (`brew install ghostscript`) if `epstopdf` will be used, so
   `tlmgr.R:125-128` never fires unattended.
5. Treat any unexpected macOS admin-password prompt during an R session as an incident and correlate
   with `install.R:301`'s `"Requesting admin privilege to run: sudo "` message.
