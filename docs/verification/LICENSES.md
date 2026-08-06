# Dependency license policy

Enforced by `06-dependency-review.yml` (`allow-licenses`) on every PR.

## Allowlist

MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense,
CC0-1.0, CC-BY-4.0, Python-2.0, BlueOak-1.0.0, Zlib.

## Explicitly forbidden (blocking)

GPL-2.0/3.0 (and AGPL, LGPL — static-linked server bundle makes weak-copyleft
risky), SSPL, BUSL, CC-BY-NC-*, proprietary/no-license.

## Known pre-existing exceptions

None identified at adoption. If dependency-review flags an existing transitive
dep, record it here with justification + replacement plan rather than widening
the allowlist silently.

## Rationale

The server bundle (esbuild, single-file) statically incorporates dependencies;
the client bundle ships to browsers. Both distribution modes make copyleft
obligations real, and the business (proprietary SaaS) cannot carry them.
