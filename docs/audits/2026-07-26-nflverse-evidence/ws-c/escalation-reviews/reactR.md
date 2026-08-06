# Escalation review — reactR 0.6.1

**Escalation:** E7 (V8 consumer — `ctx$source(...)`)
**Verdict:** **BENIGN**
**Executes when:** call time, on `babel_transform()`
**Ran on this machine:** NO — installed only; never called

## Files read

`sources/reactR/R/babel.R` in full (28 lines).

## What executes, when, under whose control

```r
babel.R:19   ctx <- V8::v8()
babel.R:20-25 ctx$source(system.file("www/babel/babel.min.js", package = "reactR"))
babel.R:26   ctx$assign('code', code)
babel.R:27   ctx$get('Babel.transform(code,{ presets: [["es2015", {modules: false}],"react"] }).code')
```

**`ctx$source()` reads a bundled `system.file()` path — confirmed, no URL branch.** That answers
WS-C's question for this package.

`babel.R:17` `stopifnot(requireNamespace("V8"), is.character(code))` type-checks the input, and
`:26` passes it as an assigned JS variable, not as concatenated code. So JSX given to
`babel_transform()` is data.

One nuance worth stating precisely: `ctx$get()` at `:27` is handed a **JS expression string**, not a
variable name, and `V8`'s `get` implementation (`V8/R/V8.R:183-186`) does
`evaluate_js(name, serialize = TRUE)` — i.e. it evaluates it. That is fine here because the string
is a package constant, but it means `ctx$get()` should not be read as a safe accessor in general.

The transform itself is a JS-to-JS compilation of caller-supplied source. `babel_transform()` does
not *execute* the transformed code — it returns it as a character vector. Anyone who then evaluates
that output owns the consequence.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"reactR","0.6.1","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:23:39 UTC; unix","2026-07-26T21:23:39"` — pure R |
| install log `bznitqj7o.output:20` | `trying URL '.../reactR_0.6.1.tar.gz'` |
| Why present | `reactable` dependency (React htmlwidget scaffolding), which is a `gt` dependency |
| Load hooks | none (`hooks-inventory.md`) |
| `inst/www/babel/babel.min.js` | part of limitation L2 (unreviewed bundled JS); like juicyjuice's bundle it executes inside the **R process** via V8, not in a browser |

## Verdict and rationale

**BENIGN.** Bundled-asset source path, typed input passed as data, no URL fetch, no execution of the
transform output. The package satisfies the property WS-C asked to be verified and adds no
execution surface beyond what V8 already provides. `babel_transform()` is also a developer
convenience for building custom widgets — nothing in the nflverse path calls it.

## Defender action

None specific. Do not evaluate the string returned by `babel_transform()` unless the input JSX was
trusted; the function compiles, it does not sanitise.
