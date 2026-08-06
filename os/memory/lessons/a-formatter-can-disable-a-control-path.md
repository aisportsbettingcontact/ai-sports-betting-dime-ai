# A formatter can disable a control path, and everything will still report success

**Origin:** ISSUE-012 Phase 1, Incident 63 · 2026-08-06

Dime's MLB auto-recalibration rewrites model constants in `MLBAIModel.py` by regex. The regex
requires single-quoted keys:

```
new RegExp(`('${key}':\s*)([-\d.]+)(,\s*#[^\n]*)`)
```

On 2026-05-09 a commit titled *"Enterprise modernization"* reformatted the file to double quotes.
Nothing else changed — the constants, the comments, the values were identical. From that moment the
patcher matched **0 of 9** constants, and it stayed that way for **89 days**.

Every scheduled run still: executed, logged nine `Could not find constant` warnings, rewrote the
file with only its header comment changed, wrote a row to `mlb_model_learning_log`, and returned
normally. **Nothing was red. Nothing was even yellow.**

**Why it mattered:** the coupling was invisible from both sides. Nothing in `MLBAIModel.py` says
"a TypeScript regex parses this file"; nothing in the detector says "this depends on the exact
quoting style of a Python literal". A formatter is *supposed* to be semantically neutral, and for
Python it was — the neutrality just didn't extend to the thing reading the file as text.

The failure then hid inside a second one: the recalibration writes a learning-log row saying what
the new accuracy *would be*, so the artifact reads like the model learned. Record and runtime
disagreed for three months with no contradiction visible anywhere.

**How to apply:**

1. **Any code that parses another file by regex has an undeclared coupling.** Write it down in both
   files, or better, have the parse fail loudly instead of returning zero matches. `patched: 0`
   should have been an error, not a return value.
2. **"Found 0 of N expected things" is a failure, not a result.** The patcher warned per key and
   then reported success overall. A search for known-present keys that finds none of them is a
   broken search.
3. **Formatting passes are not risk-free on files other code reads as text.** Config, fixtures,
   generated sources, and anything scraped by regex all qualify.
4. **When you find a dormant dangerous automation, gate it before you repair it.** The instinct on
   discovering "the regex doesn't match" is to fix the regex. That would have taken an ungated
   writer that had been inert for 89 days and made it live against customer-facing model
   constants. The gate goes first; the repair becomes a reviewed change afterwards. Incident 63's
   test now fails *on purpose* if the regex starts matching again.

Related: [[a-green-cron-is-not-a-run]] and [[an-observer-can-manufacture-its-own-findings]] — the
same family. Something ran, something was logged, and neither described what actually happened.
