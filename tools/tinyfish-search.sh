#!/usr/bin/env bash
# TinyFish Search fallback — FREE (12,000 req/day, 30/min; resets 00:00 UTC).
# Shell-side, independent of opencode server env. Prefer this before paid APIs.
# Usage: tools/tinyfish-search.sh "query" [news|web|research_paper] [--raw]
# Docs: https://docs.tinyfish.ai/search-api/reference
set -u
[ -f "$HOME/.search_env" ] && . "$HOME/.search_env"
KEY="${TINYFISH_API_KEY:-${TFISHKEY:-}}"
[ -n "$KEY" ] || { echo "TINYFISH_API_KEY/TFISHKEY not set (see ~/.search_env)" >&2; exit 1; }
q="${1:?usage: tinyfish-search.sh \"query\" [news|web|research_paper] [--raw]}"
dtype="${2:-web}"; raw=0
[ "$dtype" = "--raw" ] && { dtype="web"; raw=1; }
[ "${3:-}" = "--raw" ] && raw=1
resp=$(curl -s -m 30 -G "https://api.search.tinyfish.ai" \
  -H "X-API-Key: $KEY" \
  --data-urlencode "query=$q" --data-urlencode "domain_type=$dtype")
if [ "$raw" -eq 1 ]; then printf '%s\n' "$resp"; exit 0; fi
printf '%s' "$resp" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE_ERROR', e); sys.exit(1)
if isinstance(d, dict) and 'results' not in d:
    print('API_ERROR:', d); sys.exit(2)
for r in d.get('results', []):
    print('-', (r.get('title') or '')[:100])
    print(' ', (r.get('url') or '')[:120])
    extra = r.get('publisher') or r.get('site_name') or ''
    date = r.get('date') or ''
    if extra or date: print(' ', extra, date)
    print(' ', ((r.get('snippet') or '').replace(chr(10),' '))[:300])
    print()
"
