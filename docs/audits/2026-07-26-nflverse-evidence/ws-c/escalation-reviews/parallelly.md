# Escalation review — parallelly 1.48.0

**Escalation:** E4 (launches processes, including over SSH — 47 note rows)
**Verdict:** **ACCEPTED-RISK — Low**
**Executes when:** call time, on an explicit `makeClusterPSOCK()` / `makeNodePSOCK()` call
**Ran on this machine:** **NO** — installed from source, but no cluster has been created (the
package has never been loaded outside the install-time load test)

## Files read

`sources/parallelly/R/launchNodePSOCK.R:1-80`, `sources/parallelly/R/makeClusterPSOCK.R:330-370`,
`sources/parallelly/R/makeNodePSOCK.R` (argument contract and quoting documentation, lines 100-270,
380-500), `sources/parallelly/R/utils,cluster.R:340-360`, `zzz.R` `.onLoad` (via
`hooks-inventory.md`).

## What executes, when, under whose control

Three `system()` sites, all reached only from an explicit cluster-creation call:

| Site | Code |
|---|---|
| `launchNodePSOCK.R:61` | `res <- system(local_cmd, wait = FALSE, input = input)` |
| `makeClusterPSOCK.R:352` | `system(cmd, wait = FALSE, input = "")` (Windows branch) |
| `makeClusterPSOCK.R:357` | `system(cmd, wait = FALSE)` after `cmd <- paste(rep(cmd, times = length(cl)), collapse = " & ")` |
| `utils,cluster.R:351` | `system(test_cmd, intern = TRUE, input = input)` — a connectivity probe |

**Where the command string comes from.** `local_cmd` / `cmd` are built by `makeNodePSOCK()` from its
own arguments — `worker`, `rscript`, `rscript_args`, `rshcmd`, `rshopts`, `user`, `port`. These are
*parameters supplied by the caller*, not values read from data. WS-C's specific question — "whether
any code path lets a data value reach the command string" — resolves **no**: there is no path in
this package where a value parsed from a file, a network response, or a data frame is interpolated
into the command. The inputs are function arguments and R options
(`getOption2("parallelly.makeNodePSOCK.rshcmd", ...)`, `makeNodePSOCK.R:394`).

**Quoting.** The contract is documented and consistent:
- `makeNodePSOCK.R:186-187` — "all elements of `rshcmd` are individually 'shell' quoted and element
  `rshcmd[1]` must be on the system `PATH`"
- `makeNodePSOCK.R:269` — "All elements are automatically shell quoted using `base::shQuote()`,
  except …"
- `makeNodePSOCK.R:212` — **"Contrary to `rshcmd`, elements of `rshopts` are not quoted."**

That last one is the only sharp edge: `rshopts` is passed through unquoted by design (it has to be,
so users can pass `-i ~/.ssh/key` or `-o Option=value`). A caller who builds `rshopts` from
untrusted input creates a command-injection sink — but that is the caller's defect, and the
behaviour is documented in the argument's own help text. The package does not do this anywhere
itself. `makeNodePSOCK.R:220` even warns against embedding passwords in `rshopts`.

**Manual/dry-run mode.** `launchNodePSOCK.R:36-53` prints the exact command instead of running it
when `manual = TRUE` or `dryrun = TRUE`, and `:54` is the `else` that executes. A defender can see
precisely what would run before it runs — a genuine, and unusual, safety affordance.

**Other probes.** `system2("ps"/"tasklist"/"id")` and `shell("ver")` are platform/pid detection with
constant argument vectors.

**Load hook.** `zzz.R:4-73` sets six `R_PARALLELLY_*` env vars plus `_R_CHECK_LIMIT_CORES_` **only**
under `R CMD check`/vignette build; otherwise it reads options and registers cluster types. Nothing
network- or filesystem-touching at load.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"parallelly","1.48.0","LGPL (>= 2.1)","yes","R 4.6.1; aarch64-apple-darwin25.4.0; …","2026-07-26T21:22:54"` |
| install log `bznitqj7o.output:35` | `trying URL '.../parallelly_1.48.0.tar.gz'` |
| Native code | 181 lines of C (`native-code-inventory.md`) — pid/socket probes only; no `exec*`/`fork` primitives anywhere in the closure |
| Runtime evidence | no cluster artefacts, no `parallelly` cache or log dirs on the host |

`parallelly` is present because `furrr`/`future` list it; nothing here has created a cluster.

## Verdict and rationale

**ACCEPTED-RISK — Low.** Launching processes, including over SSH, is the package's stated purpose;
it cannot be implemented without `system()`. The review found the property that actually matters:
the command string is assembled exclusively from caller-supplied arguments and options, `rshcmd`
elements are individually `shQuote()`d, and no data-derived value reaches the shell. The one
unquoted surface (`rshopts`) is explicitly documented as unquoted and is not populated by this
package or by anything in the nflverse closure. In practice the nflverse use of `future` is
`plan(multisession)`, which launches *local* workers with no `rshcmd` at all.

## Defender action

1. Do not build `rshopts` (or `rscript_args`) from untrusted input — it is passed through unquoted
   by design (`makeNodePSOCK.R:212`).
2. Use `dryrun = TRUE` or `manual = TRUE` (`launchNodePSOCK.R:36-53`) when first configuring a
   remote cluster; the exact command is printed and nothing executes.
3. If remote workers are never needed, pin `options(parallelly.makeNodePSOCK.rshcmd = "")` — it is
   normalised to `NULL` at `makeNodePSOCK.R:486` and the SSH branch becomes unreachable.
4. Never put credentials in `rshopts`; use SSH keys (`makeNodePSOCK.R:207-220`).
