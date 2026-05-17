import re

CSS_FILE = "dist/public/assets/index-CJH5B5DK.css"

# Find the actual CSS file dynamically
import glob  # noqa: E402

css_files = glob.glob("dist/public/assets/*.css")
if css_files:
    CSS_FILE = css_files[0]

print(f"[INPUT] CSS file: {CSS_FILE}")

with open(CSS_FILE) as f:
    css = f.read()

print(f"[STATE] CSS size: {len(css):,} bytes")

# Find all @media queries with their min-width values
media_blocks = re.findall(r"@media[^{]+", css)
print("\n[STEP] All @media queries:")
for m in sorted(set(media_blocks)):
    print(f"  {m.strip()}")

# Check for md: utilities
print("\n[STEP] md: utility checks:")
for cls in ["md:hidden", r"md\:hidden", "md:flex", r"md\:flex", "md:block", r"md\:block"]:
    count = css.count(cls)
    print(f'  "{cls}" occurrences: {count}')

# Extract the 768px media block content
match_768 = re.search(r"@media\s*\(min-width:\s*768px\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}", css)
if match_768:
    block = match_768.group(1)
    print(f"\n[STEP] 768px media block found ({len(block)} chars)")
    # Find hidden/flex/display rules inside
    rules = re.findall(r"[^{]+\{[^}]+\}", block)
    for r in rules[:20]:
        print(f"  {r.strip()[:120]}")
else:
    print("\n[VERIFY] FAIL — No @media (min-width: 768px) block found in CSS")
    # Check what min-widths exist
    widths = re.findall(r"min-width:\s*(\d+px)", css)
    print(f"  All min-width values found: {sorted(set(widths))}")

print("\n[OUTPUT] Audit complete")
