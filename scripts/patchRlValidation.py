#!/usr/bin/env python3
"""Patch the RL validation check in mlbModelRunner.ts to accept '1.5' (no sign) from MySQL decimal columns."""

filepath = "server/mlbModelRunner.ts"
content = open(filepath).read()  # noqa: SIM115

# Find the exact lines to replace
old_lines = [
    "    // 2. RL spread must be exactly \u00b11.5 \u2014 MLB run lines are NEVER 0 or pick'em",
    '    const awayRL = String(g.awayModelSpread ?? "");',
    '    const validRL = awayRL === "+1.5" || awayRL === "-1.5";',
    "    if (!validRL) {",
]

# Verify they exist
for line in old_lines:
    if line not in content:
        print(f"NOT FOUND: {line!r}")
    else:
        print(f"FOUND: {line[:60]!r}")

old_block = """    // 2. RL spread must be exactly \u00b11.5 \u2014 MLB run lines are NEVER 0 or pick'em
    const awayRL = String(g.awayModelSpread ?? "");
    const validRL = awayRL === "+1.5" || awayRL === "-1.5";
    if (!validRL) {
      issues.push(`${label}: awayModelSpread="${awayRL}" \u2014 expected exactly +1.5 or -1.5 (MLB RL is never 0/pick'em)`);
    }"""

new_block = """    // 2. RL spread must be exactly \u00b11.5 \u2014 MLB run lines are NEVER 0 or pick'em
    // Note: MySQL decimal columns strip the '+' prefix, so "1.5" == "+1.5" and "-1.5" == "-1.5"
    const awayRLRaw = String(g.awayModelSpread ?? "");
    const awayRLNum = parseFloat(awayRLRaw);
    const validRL = !isNaN(awayRLNum) && Math.abs(Math.abs(awayRLNum) - 1.5) < 0.01;
    if (!validRL) {
      issues.push(`${label}: awayModelSpread="${awayRLRaw}" \u2014 expected \u00b11.5 (MLB RL is never 0/pick'em), got ${awayRLNum}`);
    }"""

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    open(filepath, "w").write(content)  # noqa: SIM115
    print("PATCHED OK")
else:
    print("ERROR: old_block not found in file")
    # Show context around line 1027
    lines = content.split("\n")
    for i in range(1024, 1035):
        print(f"  L{i + 1}: {lines[i]!r}")
