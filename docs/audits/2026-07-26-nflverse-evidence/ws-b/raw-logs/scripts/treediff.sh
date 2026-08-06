#!/bin/bash
# Step 4: compare $LIB/<pkg> (live install) vs $ROOT/tmp/cleanlib/<pkg> (clean reinstall)
# File-list diff both directions + per-file SHA-256.
set -u
ROOT=/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
LIB=/opt/homebrew/lib/R/4.6/site-library
W="$ROOT/tmp/ws-b"

for p in "$@"; do
  A="$LIB/$p"          # live
  B="$ROOT/tmp/cleanlib/$p"  # rebuilt
  ( cd "$A" && find . -type f | sort ) > "$W/tree.$p.live.txt"
  ( cd "$B" && find . -type f | sort ) > "$W/tree.$p.new.txt"
  ( cd "$A" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 ) | awk '{print $1, substr($0, index($0,$2))}' > "$W/hash.$p.live.txt"
  ( cd "$B" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 ) | awk '{print $1, substr($0, index($0,$2))}' > "$W/hash.$p.new.txt"

  only_live=$(comm -23 "$W/tree.$p.live.txt" "$W/tree.$p.new.txt")
  only_new=$(comm -13  "$W/tree.$p.live.txt" "$W/tree.$p.new.txt")
  both=$(comm -12 "$W/tree.$p.live.txt" "$W/tree.$p.new.txt")

  : > "$W/differ.$p.txt"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    ha=$(grep -F -m1 " $f" "$W/hash.$p.live.txt" | awk '{print $1}')
    hb=$(grep -F -m1 " $f" "$W/hash.$p.new.txt"  | awk '{print $1}')
    if [ "$ha" != "$hb" ]; then printf '%s\n' "$f" >> "$W/differ.$p.txt"; fi
  done <<< "$both"

  echo "=== $p : files_live=$(wc -l < "$W/tree.$p.live.txt" | tr -d ' ') files_new=$(wc -l < "$W/tree.$p.new.txt" | tr -d ' ') only_live=$(printf '%s' "$only_live" | grep -c . ) only_new=$(printf '%s' "$only_new" | grep -c .) differ=$(grep -c . "$W/differ.$p.txt")"
  printf '%s' "$only_live" | grep . | sed 's/^/    ONLY-LIVE: /'
  printf '%s' "$only_new"  | grep . | sed 's/^/    ONLY-NEW : /'
  sed 's/^/    DIFFER   : /' "$W/differ.$p.txt"
done
