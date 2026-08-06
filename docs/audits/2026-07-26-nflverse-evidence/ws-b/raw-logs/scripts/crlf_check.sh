#!/bin/bash
# For every differing file (tarball vs github tree), determine whether the
# difference is EXCLUSIVELY line-endings (CRLF vs LF) or real content.
set -u
ROOT=/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
W="$ROOT/tmp/ws-b"

ghdir() {
  case "$1" in
    nflverse) echo "$ROOT/tmp/gh/nflverse_rel" ;;
    *) echo "$ROOT/tmp/gh/$1" ;;
  esac
}

for p in nflverse nflreadr nflfastR nflseedR nfl4th nflplotR; do
  A="$ROOT/sources/$p"; B="$(ghdir "$p")"
  echo "########## $p ##########"
  : > "$W/crlf.$p.txt"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if cmp -s <(tr -d '\r' < "$A/$f") <(tr -d '\r' < "$B/$f"); then
      cr_a=$(grep -c $'\r' "$A/$f" 2>/dev/null); cr_b=$(grep -c $'\r' "$B/$f" 2>/dev/null)
      printf '  CRLF-ONLY   %-40s (CR lines tarball=%s github=%s)\n' "$f" "${cr_a:-0}" "${cr_b:-0}" >> "$W/crlf.$p.txt"
    else
      nl=$(diff <(tr -d '\r' < "$A/$f") <(tr -d '\r' < "$B/$f") | grep -c '^[<>]')
      printf '  REAL-DIFF   %-40s (%s differing lines after LF-normalization)\n' "$f" "${nl:-?}" >> "$W/crlf.$p.txt"
    fi
  done < "$W/ghdiff.$p.differ.txt"
  cat "$W/crlf.$p.txt"
  c=$(grep -c 'CRLF-ONLY' "$W/crlf.$p.txt"); r=$(grep -c 'REAL-DIFF' "$W/crlf.$p.txt")
  echo "   -> CRLF-only: ${c:-0}   REAL: ${r:-0}"
done
