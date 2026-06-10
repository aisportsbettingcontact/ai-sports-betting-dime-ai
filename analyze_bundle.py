#!/usr/bin/env python3
"""
Bundle analysis script — pinpoints what makes index.html 370KB
and identifies all large JS chunks.
"""

import os
import re

html_path = "dist/public/index.html"
with open(html_path, "rb") as f:
    raw = f.read()

content = raw.decode("utf-8", errors="replace")
print(f"[INPUT] index.html total size: {len(raw):,} bytes ({len(raw) / 1024:.1f} KB)")

# --- Base64 blocks ---
b64_matches = re.findall(r"base64,([A-Za-z0-9+/=]{50,})", content)
print(f"\n[STEP] Base64 encoded data blocks: {len(b64_matches)}")
for i, m in enumerate(b64_matches[:10]):
    print(
        f"  Block {i + 1}: {len(m):,} chars (~{len(m) * 3 // 4 / 1024:.1f} KB decoded)"
    )

# --- Style blocks ---
style_matches = re.findall(r"<style[^>]*>(.*?)</style>", content, re.DOTALL)
print(f"\n[STEP] <style> blocks: {len(style_matches)}")
for i, s in enumerate(style_matches):
    print(f"  Style {i + 1}: {len(s):,} chars ({len(s) / 1024:.1f} KB)")
    print(f"    Preview: {s[:200].strip()[:100]!r}")

# --- Script blocks (inline) ---
script_matches = re.findall(r"<script(?:[^>]*)>(.*?)</script>", content, re.DOTALL)
print(f"\n[STEP] Inline <script> blocks: {len(script_matches)}")
for i, s in enumerate(script_matches):
    stripped = s.strip()
    if stripped:
        print(
            f"  Script {i + 1}: {len(stripped):,} chars ({len(stripped) / 1024:.1f} KB)"
        )
        print(f"    Preview: {stripped[:200]!r}")

# --- External script tags ---
ext_scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', content)
print(f"\n[STEP] External <script src> references: {len(ext_scripts)}")
for s in ext_scripts:
    print(f"  {s}")

# --- External link tags ---
ext_links = re.findall(r'<link[^>]+href=["\']([^"\']+)["\']', content)
print(f"\n[STEP] External <link href> references: {len(ext_links)}")
for link_href in ext_links:
    print(f"  {link_href}")

# --- Identify what is taking up space ---
# Remove all tags, measure remaining text
no_tags = re.sub(r"<[^>]+>", "", content)
print(
    f"\n[STATE] Content outside tags: {len(no_tags):,} chars ({len(no_tags) / 1024:.1f} KB)"
)
print(f"[STATE] Content inside tags (markup): {len(content) - len(no_tags):,} chars")

# --- Largest text segments ---
segments = re.split(r"<[^>]+>", content)
large_segs = [(len(s), s) for s in segments if len(s) > 1000]
large_segs.sort(reverse=True)
print(f"\n[STATE] Text segments >1KB: {len(large_segs)}")
for size, seg in large_segs[:5]:
    print(f"  {size:,} chars: {seg[:200].strip()!r}")

# --- Check all JS chunk sizes ---
print("\n[STEP] All JS chunks in dist/public/assets/:")
assets_dir = "dist/public/assets"
if os.path.exists(assets_dir):
    js_files = [
        (os.path.getsize(os.path.join(assets_dir, f)), f)
        for f in os.listdir(assets_dir)
        if f.endswith(".js")
    ]
    js_files.sort(reverse=True)
    total_js = sum(s for s, _ in js_files)
    print(f"  Total JS: {total_js / 1024:.1f} KB across {len(js_files)} files")
    for size, name in js_files:
        print(f"  {size / 1024:8.1f} KB  {name}")

print("\n[OUTPUT] Analysis complete.")
