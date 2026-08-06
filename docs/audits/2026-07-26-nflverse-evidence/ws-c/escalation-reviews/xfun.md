# Escalation review — xfun 0.60

**Escalation:** E6 (shells out extensively and uploads files over the network — 112 note rows, the
largest single concentration in the closure)
**Verdict:** **ACCEPTED-RISK — Low**, with one **Low finding** carried into E14 (persistent cache
deserialisation)
**Executes when:** every flagged shell/upload path is inside an explicitly-called, exported
developer function. Two `readRDS` paths fire automatically during document rendering.
**Ran on this machine:** **NO** — `tools::R_user_dir("xfun","cache")` does not exist

## Files read

`sources/xfun/R/command.R:150-360`, `sources/xfun/R/cran.R:120-160`,
`sources/xfun/R/cache.R:210-245, 465-495, 550-632`, `sources/xfun/R/base64.R:105-130`,
`sources/xfun/R/zzz.R`.

## What executes, when, under whose control

WS-C asked the right question — *which of these paths are reachable without an explicit user call?*
The answer separates cleanly into two groups.

### Group 1 — explicit developer functions (not reachable from rendering)

| Site | Function | Reachability |
|---|---|---|
| `command.R:307` `system2('curl', shQuote(c('-T', file, server)))` | `upload_ftp()` — exported | user must call it with a server |
| `command.R:348` second `system2('curl', ...)` | `upload_win_builder()` — exported | uploads a built package to win-builder |
| `cran.R:142-155` `curl::handle_setform()` + `curl::curl_fetch_memory(server, h)` | `submit_cran()` | POSTs a tarball to `https://xmpalantir.wu.ac.at/cransubmit/index2.php` (`cran.R:138`) |
| `command.R:318` `system2('git', 'pull')` | inside `upload_win_builder()` | only after a `git status` success check |
| `command.R:172` `system2('powershell', c('-Command', shQuote(command)))` | `powershell()` | Windows-only; `Sys.which('powershell') == ''` returns early on macOS |
| `command.R:277` `system2('sh', c('-c', shQuote(code)))` | `bg_process()` | `code` is assembled at `:271-274` from `shQuote(c(command, args))` — the caller's own command, already quoted; it is a backgrounding idiom, not an arbitrary-string evaluator |
| `command.R:165` `system2('sh', shQuote(c(pkg_file('scripts','child-pids.sh'), id)))` | `child_pids()` | runs a script shipped inside the installed package |

None of these is called by `knitr`, `rmarkdown`, or `litedown` during a render. They are the
maintainer's own package-development tooling, exported for convenience. The `__VIEWSTATE`
constants hardcoded at `command.R:336-338` are ASP.NET form tokens for win-builder, not secrets.

### Group 2 — automatic during rendering (the part that matters)

```
cache.R:622   cache_dir = if (getRversion() >= '4.0.0') function() {
cache.R:623     getOption('xfun.cache.dir', tools::R_user_dir('xfun', 'cache'))
```

On R 4.6.1 the cache directory is **persistent** (`~/Library/Caches/org.R-project.R/R/xfun` on
macOS), not `tempdir()`. Two paths read from it without an explicit user call:

- `base64.R:119-120` — `p = file.path(cache_dir(), 'mime.rds')` … `if (file_exists(p)) db = readRDS(p)`
  inside `mime_type()`, which backs `base64_uri()` — i.e. it fires whenever a document embeds an
  image with an extension not already in the built-in `mimemap`.
- `cache.R:558-563, 601` — `download_cache$read()` / `$summary()` do `readRDS(f)` on
  `url_<type>_<md5(url)>.rds` files keyed by URL.

Both deserialise an on-disk file with no validation. This is the same class as E14 (memoise
filesystem caches) and is reported there as the shared mechanism.

The remaining `note` rows are ordinary: `cache.R:226` `unserialize(read_bin(...))` and `:234`
`readRDS(...)` are the `io_methods` table — pluggable save/load backends for `xfun::cache_exec()`,
operating on files that function wrote; `cache.R:477-483` `eval(parse2(...))` is inside
`find_globals()`, which builds a function body from *code the caller passed in* to run
`codetools::findGlobals()` on it — static analysis, and it is the caller's own code.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"xfun","0.60","MIT + file LICENSE","yes","R 4.6.1; aarch64-apple-darwin25.4.0; …","2026-07-26T21:22:49"` |
| install log `bznitqj7o.output:18` | `trying URL '.../xfun_0.60.tar.gz'`; 281 lines of C, no `configure` |
| `~/Library/Caches/org.R-project.R/R/xfun` | **absent** — the cache has never been created, so nothing has been written or read |
| `.onLoad`/`.onUnload` (`zzz.R:24-33`) | registers a finalizer that kills a background proxy app at session exit — no network, no filesystem |

## Verdict and rationale

**ACCEPTED-RISK — Low.** The 112 pattern rows overstate the exposure: read in context, the shell-out
and upload machinery is a package-development toolkit (`upload_ftp`, `upload_win_builder`,
`submit_cran`, `bg_process`) that a rendering pipeline never touches, and every command string is
`shQuote()`d from caller-supplied arguments rather than from data. The `system2('sh', '-c', ...)` at
`command.R:277` — the row that reads worst in isolation — is a backgrounding wrapper around the
caller's own already-quoted command, not an arbitrary-shell evaluator. What survives review is
narrower and more real: `xfun` keeps a **persistent** cache under `R_user_dir` and `readRDS`es from
it automatically during rendering (`base64.R:119`, `cache.R:558-563`). That is a genuine
deserialisation-on-untrusted-file surface, but it requires an attacker who can already write to the
user's cache directory, and it is unexercised here.

## Defender action

1. Treat `~/Library/Caches/org.R-project.R/R/xfun` as security-relevant state: it holds `.rds`
   files that are `readRDS`ed automatically. Same guidance as E14 — restrictive permissions, and
   purge it (`xfun::download_cache$purge()`, `cache.R:608+`) if the machine is ever suspected.
2. Set `options(xfun.cache.dir = file.path(tempdir(), 'xfun'))` if you want the pre-4.0 ephemeral
   behaviour back (`cache.R:622-626`); this closure gains nothing from a persistent xfun cache.
3. Never call `upload_ftp()`, `upload_win_builder()` or `submit_cran()` from automated code — they
   transmit local files to third-party servers.
4. No action needed for the shell-out rows; they are unreachable from `render()`.
