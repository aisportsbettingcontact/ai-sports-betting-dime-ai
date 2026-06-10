import re

with open("dist/public/index.html") as f:
    c = f.read()

scripts = re.findall(r"<script(?:[^>]*)>(.*?)</script>", c, re.DOTALL)
for i, s in enumerate(scripts):
    s = s.strip()
    if len(s) > 100:
        print(f"Script {i + 1} ({len(s)} chars):")
        print(s[:800])
        print("...")
        print()
