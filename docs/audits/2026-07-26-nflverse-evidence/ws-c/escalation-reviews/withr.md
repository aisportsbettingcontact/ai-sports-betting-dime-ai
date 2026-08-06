# Escalation review — withr 3.0.3

**Escalation:** E12 (monkey-patches `rlang`'s namespace at load)
**Verdict:** **BENIGN**
**Executes when:** load time, when `rlang` is (or becomes) loaded
**Ran on this machine:** the hook would run in any session loading both — but nothing beyond
`defer` is injected

## Files read

`sources/withr/R/with.R:60-80` in full (the entire `.onLoad`).

## What executes, when, under whose control

The complete hook, read end to end — WS-C's request was to "confirm nothing else is injected":

```r
with.R:63   .onLoad <- function(...) {
with.R:64     # Augment rlang with withr features such as knitr support
with.R:65     on_package_load(
with.R:66       "rlang",
with.R:67       local({
with.R:68         if (is.null(getOption("withr:::inject_defer_override"))) {
with.R:69           ns <- asNamespace("rlang")
with.R:71           do.call("unlockBinding", list("defer", ns))
with.R:72           defer(lockBinding("defer", ns))
with.R:74           ns$defer <- defer
with.R:75         }
with.R:76       })
with.R:77     )
with.R:78   }
```

**Confirmed: exactly one binding is touched.** `rlang::defer` is replaced with `withr::defer`, and
nothing else in the `rlang` namespace is read, written or wrapped. The hook is 16 lines and there is
no second `on_package_load()`, no loop over bindings, no `assign()` beyond `:74`.

Four properties make this well-behaved rather than merely small:

1. **It re-locks.** `:72` registers `lockBinding("defer", ns)` on the deferred-exit stack *before*
   the assignment at `:74`, so the binding is unlocked, replaced, and locked again — it does not
   leave `rlang`'s namespace mutable.
2. **It is opt-out-able.** `:68` skips the whole block if `getOption("withr:::inject_defer_override")`
   is set.
3. **It is lazy.** `on_package_load("rlang", ...)` defers until rlang actually loads, rather than
   forcing it.
4. **The replacement is a superset, not a redefinition of semantics** — the comment at `:64` states
   the purpose (knitr support in `defer`), and `withr::defer` is the canonical implementation that
   `rlang::defer` mirrors. This is the documented interop WS-C suspected it was.

Cross-package namespace mutation in a load hook is still a pattern worth flagging in principle: it
means the behaviour of `rlang::defer` depends on whether `withr` happens to be loaded. But the scope
here is a single, named, documented function.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"withr","3.0.3","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:22:54 UTC; unix","2026-07-26T21:22:54"` — pure R, no `src/` |
| install log `bznitqj7o.output:39` | `trying URL '.../withr_3.0.3.tar.gz'`; source install, no `configure` |
| Why present | dependency of `ggplot2`/`gt`; `Suggests` of nfl4th |
| Other hooks | none — `.onLoad` is the only hook withr defines (`hooks-inventory.md`) |

## Verdict and rationale

**BENIGN.** Read in full, the hook does precisely what its comment says and nothing more: one
binding, unlocked, replaced with the package's own `defer`, re-locked, behind an option guard, lazy
on rlang's load. WS-C's instinct ("almost certainly the documented `defer()` interop") was correct
and is now verified rather than assumed. No further namespace surface is touched.

## Defender action

None. If an environment wanted to forbid cross-package namespace mutation on principle, setting
`options("withr:::inject_defer_override" = TRUE)` before withr loads disables the injection
(`with.R:68`) — but doing so would degrade `rlang::defer` behaviour inside knitr, and there is no
security reason to.
