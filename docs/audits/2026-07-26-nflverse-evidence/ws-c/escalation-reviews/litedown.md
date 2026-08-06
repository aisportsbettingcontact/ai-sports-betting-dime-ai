# Escalation review — litedown 0.10

**Escalation:** E8 (document rendering executes code — 12 note rows; explicit `exec` engine)
**Verdict:** **ACCEPTED-RISK — Info**
**Executes when:** call time, on `fuse()` — and the `exec` engine only for chunks that ask for it
**Ran on this machine:** **NO** — no rendering has occurred

## Files read

`sources/litedown/R/fuse.R:670-690, 1280-1300`, `sources/litedown/R/site.R:245-260`,
`sources/litedown/R/utils.R:1155-1190`.

## What executes, when, under whose control

**The `exec` engine** (`fuse.R:1283-1298`) — WS-C called this "an explicit `exec` engine that runs
arbitrary commands". Read in full, that is accurate and also the point:

```r
fuse.R:1285   f = if (is.null(ext)) tempfile() else with_ext(tempfile(), ext)
fuse.R:1286   on.exit(unlink(f), add = TRUE)
fuse.R:1287   write_utf8(x$source, f)
fuse.R:1289   default_args = if (cmd == 'powershell') c('-File', f) else f
fuse.R:1290   a = c(opts$args1, default_args, opts$args2)
fuse.R:1292   out = tryCatch(system2(cmd, shQuote(a), stdout = TRUE, stderr = TRUE), error = ...)
```

The chunk's own source is written to a temp file and handed to a command the **chunk header names**
(`cmd`). So a document can declare `` ```{exec, cmd='sh'} `` and run shell. That is a documented
engine, opted into per chunk, and structurally no different from knitr's foreign-language engines
(`knitr/R/engine.R:150`). Arguments are `shQuote()`d at `:1292`; the temp file is unlinked at
`:1286`. Errors are contained by `tryCatch` and by the chunk's `error` option (`:1293-1297`).

**Cache deserialisation** — `fuse.R:679` `d2 = readRDS(path)` (timing data), `site.R:250`
`d = readRDS(p)` (book-wide timing index), `utils.R:1163, 1181` `readRDS()` of cache files. These
read files litedown itself wrote, under paths derived from `timing_path()` and the site's own
cache directory. Same class as every other build-cache in the closure: a deserialisation primitive
whose exposure depends on who can write the cache directory, not on remote input. `site.R:251-253`
even filters and rewrites the index after reading, so the data is treated as untrusted *data* —
though `readRDS` itself has already run by then.

Nothing fires at load: `.onLoad` does package-local initialisation only (`hooks-inventory.md`).

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"litedown","0.10","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:23:21 UTC; unix","2026-07-26T21:23:21"` — pure R |
| install log `bznitqj7o.output:19, 1245-1250` | `trying URL '.../litedown_0.10.tar.gz'`; source install, no `configure` |
| Rendering evidence | no litedown output, no timing/cache `.rds` files on the host |
| Why present | `markdown`/`xfun`-adjacent dependency pulled in by the rendering stack; not used by any nflverse target |

## Verdict and rationale

**ACCEPTED-RISK — Info.** litedown is a lightweight knitr alternative and carries the same
irreducible property: rendering a document runs the document's code. Its `exec` engine is the most
explicit form of that in the closure — a chunk names a command and litedown runs it — but it is
opt-in per chunk, `shQuote()`d, and no more powerful than knitr's engine set. The cache `readRDS`
calls are self-written build state. There is nothing here that a defender should treat differently
from knitr; the correct control is the same one: **do not render untrusted documents.**

## Defender action

1. Same as `knitr.md` — treat any renderable document as executable content.
2. When reviewing an unfamiliar litedown document, grep chunk headers for `exec` and for a `cmd=`
   option; those chunks run external programs (`fuse.R:1290-1292`).
3. No action needed for the cache `readRDS` sites beyond ordinary filesystem hygiene on the project
   directory.
