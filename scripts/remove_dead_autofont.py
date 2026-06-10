"""
Remove dead useAutoFontSize code from GameCard.tsx.
The hook is defined but never called — it's dead code from Fix #6.
Removes lines 199-309 (the full block from the comment header to the closing brace).
"""

path = "client/src/components/GameCard.tsx"
with open(path) as f:
    content = f.read()

# The dead code block starts at the comment and ends at the MobileTeamNameBlock comment
DEAD_CODE_START = (
    "// ── useAutoFontSize ─────────────────────────────────────────────────────────\n"
)
DEAD_CODE_END = (
    "// ── MobileTeamNameBlock ─────────────────────────────────────────────────────\n"
)

start_idx = content.find(DEAD_CODE_START)
end_idx = content.find(DEAD_CODE_END)

if start_idx == -1:
    print("[ERROR] Could not find useAutoFontSize block start")
    exit(1)
if end_idx == -1:
    print("[ERROR] Could not find MobileTeamNameBlock comment")
    exit(1)

print(f"[INPUT] Found dead code block at chars {start_idx}–{end_idx}")
print(f"[INPUT] Dead code length: {end_idx - start_idx} chars")

# Count lines being removed
dead_block = content[start_idx:end_idx]
lines_removed = dead_block.count("\n")
print(f"[INPUT] Lines to remove: {lines_removed}")
print(f"[INPUT] First 100 chars of dead block: {dead_block[:100]!r}")
print(f"[INPUT] Last 100 chars of dead block: {dead_block[-100:]!r}")

# Remove the dead code block
new_content = content[:start_idx] + content[end_idx:]

# Verify the removal didn't break anything
if "useAutoFontSize(" in new_content and "function useAutoFontSize" not in new_content:
    print("[ERROR] useAutoFontSize is still called somewhere — cannot remove safely")
    # Find the call sites
    for i, line in enumerate(new_content.split("\n"), 1):
        if "useAutoFontSize(" in line:
            print(f"  Line {i}: {line.strip()}")
    exit(1)

# Check that MobileTeamNameBlock is still present
if DEAD_CODE_END not in new_content:
    print("[ERROR] MobileTeamNameBlock comment not found in new content")
    exit(1)

# Write the cleaned file
with open(path, "w") as f:
    f.write(new_content)

new_lines = new_content.count("\n")
print(f"[OUTPUT] GameCard.tsx: {lines_removed} lines removed")
print(f"[OUTPUT] New file size: {new_lines} lines")
print("[VERIFY] PASS — dead code removed, MobileTeamNameBlock preserved")
