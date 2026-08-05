# Federation registry — pins, licenses, scopes, authority

Treat entries like dependencies: pinned, licensed, scoped. Update the pin fields
deliberately (inspect diffs, especially scripts) — never by silently re-vendoring.

| System | Source / pin | License | Role | Scope (include) | Scope (exclude) | Maturity |
| --- | --- | --- | --- | --- | --- | --- |
| ui-ux-pro-max | plugin v2.11.0 vendored at `.claude/plugins-vendored/ui-ux-pro-max-skill/`; flat copy in `.claude/skills/` (data CSVs synced to the same 84/192/74; only its SKILL.md self-description and scripts are older — no `--force`/`--full`) | MIT (upstream relicensed from CC-BY-NC-4.0 on 2025-12-05, pre-v2.11.0). Residual upstream inconsistency: `ui-styling` ships an Apache-2.0 `LICENSE.txt` beside `license: MIT` frontmatter | Research librarian, design-system generator | Any surface, as evidence | Authority over locked tokens; persisting over governed surfaces | Stable |
| frontend-design | anthropics/skills @ `9d2f1ae`; hash in `skills-lock.json`; mirrors in `.claude/skills/` + `.agents/skills/` (byte-identical) | See its `LICENSE.txt` | Default art director | New/reshaped UI, marketing surfaces | Overriding brand tokens (treat MASTER.md as the brief) | Stable |
| taste family (9 skills) | leonxlnx/taste-skill @ `b177427`; flat copies + `taste-skill` plugin marketplace | MIT | Routed expressive specialist | Landing, portfolio, redesigns (v2's own scope) | Dashboards, data tables, multi-step product UI (v2 Section 13); soft-skill's glass/gradient vocabulary mostly banned by Dime law | v2 self-labeled **experimental**; v1 preserved for compatibility |
| emil skills (4) | emilkowalski/skills, vendored flat (no upstream pin recorded — record one on next update) | MIT — upstream root LICENSE (© 2026 Emil Kowalski), copied into each vendored dir 2026-08-05 to meet the notice condition | Motion specialist + motion audit gate | Motion build (`emil-design-eng`, `apple-design`), naming (`animation-vocabulary`), audit (`review-animations`, Read-only invocation) | Overriding the 160ms one-curve law with its generic budgets | Stable |
| impeccable | pbakaus/impeccable @ `ae5e951` (2026-08-04), vendored at `.claude/skills/impeccable/` — full provenance in its `VENDOR.md` | Apache-2.0 (LICENSE + NOTICE.md preserved) | Design ops: workflow vocabulary (23 commands), deterministic detector (59 rules), audit/critique | Product UI lead; audit/polish on any surface | Hook auto-wiring (owner opt-in); replacing brand law with its own aesthetics ("go all out" is capped by the law) | Stable upstream (v4.0.4); tip churns via CI bot — pin deliberately |
| Dime brand law | `design-system/dime-ai/` + `dime-ai/THREE-COLOR-LAW.md` (owner-authored, dated directives) | n/a (first-party) | **Final authority** | Everything visual | — | Law |

## Authority rules

- Every system above **advises**; brand law and the brief **decide**; the Lead
  (declared in the brief) executes.
- No system may modify `design-system/dime-ai/**`, `dime-ai/THREE-COLOR-LAW.md`,
  or this registry as a side effect of a build. Changes ride their own PR with a
  decision note.
- Conflicts between systems are resolved by the SKILL.md routing table and
  conditionals, not by merging both opinions into the artifact.

## Known upstream defects / drift

- uipro flat copy: `--persist` help text says `design-system/MASTER.md` but code
  writes `design-system/<project-slug>/` — trust the code path.
- uipro flat copy lacks `--force`/`--full` (plugin-only flags).
- emil `review-animations` and `frontend-design` are invisible to the Skill tool
  (by design / by roster) — Read-path invocation only.
- MASTER.md ↔ 2026-07-24 audit note disagree on IBM Plex Mono (retired in shipped
  code). Owner-resolvable; flag, don't fix.
