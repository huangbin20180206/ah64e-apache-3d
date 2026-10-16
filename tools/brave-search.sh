#!/usr/bin/env bash
# Brave Search fallback (shell-side, independent of opencode server env).
# Brave is NOT a built-in opencode websearch provider; use this script instead.
# Usage: tools/brave-search.sh "query" [count] [--raw]
set -u
[ -f "$HOME/.search_env" ] && . "$HOME/.search_env"
: "${BRAVE_API_KEY:?BRAVE_API_KEY not set (see ~/.search_env)}"
q="${1:?usage: brave-search.sh \"query\" [count] [--raw]}"
count="${2:-5}"
raw=0; [ "${3:-}" = "--raw" ] && raw=1
resp=$(curl -s -m 30 -G "https://api.search.brave.com/res/v1/web/search" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_API_KEY" \
  --data-urlencode "q=$q" --data-urlencode "count=$count")
if [ "$raw" -eq 1 ]; then printf '%s\n' "$resp"; exit 0; fi
printf '%s' "$resp" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE_ERROR', e); sys.exit(1)
web = d.get('web', {})
for r in web.get('results', []):
    print('-', (r.get('title') or '')[:100])
    print(' ', (r.get('url') or '')[:120])
    print(' ', (r.get('description') or '')[:300].replace(chr(10),' '))
    print()
"
