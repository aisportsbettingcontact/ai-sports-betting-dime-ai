# Escalation review — juicyjuice 0.1.0

**Escalation:** E7 (V8 consumer — `ctx$source(...)`)
**Verdict:** **BENIGN**
**Executes when:** call time, on `css_inline()`
**Ran on this machine:** NO — installed only; never called

## Files read

`sources/juicyjuice/R/css_inline.R` in full (27 lines). The package has exactly one exported
function.

## What executes, when, under whose control

```r
css_inline.R:19   js_file <- system.file("dist/bundle.js", package = "juicyjuice")
css_inline.R:21   ct <- V8::v8()
css_inline.R:22   ct$source(js_file)
css_inline.R:23   ct$assign("html_text", html)
css_inline.R:25   ct$eval("var inlined = juice(html_text, options);")
css_inline.R:26   ct$get("inlined")
```

WS-C asked Task 7 to "confirm every `ctx$source()` in the closure reads a bundled `system.file()`
path rather than a URL". For juicyjuice: **confirmed**. `:19` is a `system.file()` lookup inside the
installed package; there is no URL branch, no user-controllable path argument, and no other
`ctx$source()` call in the package.

The user's data (`html`) enters via `ct$assign()` at `:23` — assigned as a **JSON-serialised string
variable**, not concatenated into evaluated JS. The only `ct$eval()` (`:25`) is a constant string.
So untrusted HTML is data inside the VM, never code.

Two residual notes, both inherited rather than introduced:
- `V8::v8()` is called with defaults, so `console.r` is available inside that context
  (`V8/src/bindings.cpp:541-548`, `V8/R/V8.R:136`). That matters only if the JS bundle were
  malicious; it is a first-party asset shipped in the tarball WS-B verified.
- `inst/dist/bundle.js` is part of the ~30 MB of unreviewed bundled JS recorded as limitation L2.
  Unlike bslib/reactable assets, this one executes in the **R process** via V8, not in a browser —
  worth noting in the L2 characterisation.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"juicyjuice","0.1.0","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:23:40 UTC; unix","2026-07-26T21:23:40"` — pure R |
| install log `bznitqj7o.output:47` | `trying URL '.../juicyjuice_0.1.0.tar.gz'` |
| Why present | `gt` dependency (CSS inlining for HTML-email tables); reachable from nflplotR's `gt_*` helpers |
| Load hooks | none |

## Verdict and rationale

**BENIGN.** The package is a thin, single-function wrapper: a bundled JS asset, a constant `eval`,
and user content passed as data rather than code. It satisfies exactly the property WS-C asked to
be checked, and it introduces no execution surface of its own. Its risk is entirely inherited from
V8 (see `V8.md`) and from the unreviewed bundle (see `STRUCTURAL-LIMITATIONS.md` §L2).

## Defender action

None specific to juicyjuice. If the V8 `console.r` escape is being hardened closure-wide, the
one-line change is `V8::v8(console = FALSE)` at `css_inline.R:21` — but that is a defence against a
compromised first-party bundle, not against any input this function accepts.
