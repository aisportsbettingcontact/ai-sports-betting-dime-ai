#!/bin/bash
# Download all 90 tarballs from a second mirror and record sha256 + http status.
# $1 = tag (mirror2|osuosl)   $2 = base URL
set -u
ROOT=/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
TAG="$1"; BASE="$2"
OUT="$ROOT/mirror2/$TAG"
mkdir -p "$OUT"
LOG="$ROOT/tmp/ws-b/dl.$TAG.csv"
echo "package,version,http_status,bytes,url_effective,sha256" > "$LOG"

fetch_one() {
  pkg="$1"; ver="$2"; base="$3"; out="$4"
  f="${pkg}_${ver}.tar.gz"
  url="${base}/src/contrib/${f}"
  # retry once on failure, per evidence-first rule
  st=$(curl -sS -L --max-time 600 -o "$out/$f" -w "%{http_code}|%{size_download}|%{url_effective}" "$url" 2>/dev/null)
  code="${st%%|*}"
  if [ "$code" != "200" ]; then
    st=$(curl -sS -L --max-time 600 -o "$out/$f" -w "%{http_code}|%{size_download}|%{url_effective}" "$url" 2>/dev/null)
    code="${st%%|*}"
  fi
  rest="${st#*|}"; bytes="${rest%%|*}"; ueff="${rest#*|}"
  if [ "$code" = "200" ]; then
    sha=$(shasum -a 256 "$out/$f" | awk '{print $1}')
  else
    sha="NA"
  fi
  printf '%s,%s,%s,%s,%s,%s\n' "$pkg" "$ver" "$code" "$bytes" "$ueff" "$sha"
}
export -f fetch_one

tail -n +2 "$ROOT/evidence/acquisition-log.csv" | awk -F, '{print $1" "$2}' \
  | xargs -P 4 -n 2 bash -c 'fetch_one "$0" "$1" "'"$BASE"'" "'"$OUT"'"' >> "$LOG"

echo "TAG=$TAG rows=$(($(wc -l < "$LOG") - 1)) non200=$(awk -F, 'NR>1 && $3!=200' "$LOG" | wc -l)"
