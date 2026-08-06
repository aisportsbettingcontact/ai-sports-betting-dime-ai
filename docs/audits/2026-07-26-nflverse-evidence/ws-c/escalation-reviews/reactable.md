# Escalation review — reactable 0.4.5

**Escalation:** E7 (V8 consumer — `ctx$source(...)`)
**Verdict:** **BENIGN**
**Executes when:** call time, during server-side rendering of a reactable to static HTML
**Ran on this machine:** NO — installed only; never called

## Files read

`sources/reactable/R/reactable.R:838-862`, plus the `htmlwidgets::JSEvals` call site.

## What executes, when, under whose control

```r
reactable.R:841-844  input_json <- toJSON(list(props = attribs, evals = htmlwidgets::JSEvals(attribs)))
reactable.R:849      ctx <- V8::v8()
reactable.R:850      ctx$source(system.file("htmlwidgets/reactable.server.js", package = "reactable", mustWork = TRUE))
reactable.R:851      output <- ctx$call("Reactable.renderToHTML", input_json)
reactable.R:852-854  }, error = function(e) { warning("Failed to render table to static HTML:\n", ...) })
```

**`ctx$source()` reads a bundled `system.file()` path with `mustWork = TRUE` — confirmed, no URL
branch.** That completes WS-C's requested check across all three V8 consumers in the closure
(juicyjuice, reactR, reactable): **none of them fetches JS over the network.**

The table's props are serialised to JSON at `:841` and passed as an argument through
`ctx$call()`, which wraps them in `toJSON()` again (`V8/R/V8.R:154-173`) — data, not code.

The one item that deserves naming: `htmlwidgets::JSEvals(attribs)` at `:843` collects the paths of
any values the caller marked with `htmlwidgets::JS()`, i.e. **caller-supplied JavaScript** (custom
cell renderers, formatters, style functions). Those strings are evaluated inside the V8 context
during server-side rendering. That is the documented purpose of `JS()`, and the JS comes from the R
author of the table, not from the data being tabulated — but it means a reactable definition
assembled from an untrusted source is executable content. Combined with `console.r` being enabled by
default (`V8.md` Part 2), such JS could reach back into R.

Failure is contained: the whole block is wrapped in `tryCatch` (`:848-855`) and a rendering failure
degrades to a `warning()` and the client-side path.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"reactable","0.4.5","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:24:37 UTC; unix","2026-07-26T21:24:37"` — pure R |
| install log `bznitqj7o.output:49` | `trying URL '.../reactable_0.4.5.tar.gz'` |
| Why present | `gt` dependency; reachable from nflplotR's `gt_*` helpers |
| Load hooks | registers a `knitr::knit_print` method only (`hooks-inventory.md`) |
| `inst/htmlwidgets/*.js` | part of limitation L2; `reactable.server.js` runs in the **R process** via V8, the client bundle in a browser |

## Verdict and rationale

**BENIGN.** The escalated pattern — `ctx$source()` — resolves to a bundled, `mustWork = TRUE`
package asset, and table data flows in as JSON. The package introduces no network fetch and no
`eval` of data. The residual exposure is `htmlwidgets::JS()` values, which are R-author-supplied
JavaScript by design; that is a property of the htmlwidgets contract rather than a reactable defect,
and it is only dangerous if table definitions are built from untrusted input.

## Defender action

1. Do not construct `reactable()` column definitions (`cell`, `style`, `footer` renderers) from
   untrusted strings — anything wrapped in `htmlwidgets::JS()` is executed.
2. If server-side rendering is not needed, it can simply not be triggered; the client-side path
   never instantiates V8 in the R process.
3. Closure-wide V8 hardening (`console = FALSE`) would need to be applied upstream at
   `reactable.R:849`; there is no option exposed for it today.
