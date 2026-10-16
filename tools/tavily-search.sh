#!/usr/bin/env bash
# Tavily search fallback (shell-side, independent of opencode server env).
# Usage: tools/tavily-search.sh "query" [max_results] [--raw]
# Reads key from ~/.search_env (preferred) or $TAVILY_API_KEY.
set -u
[ -f "$HOME/.search_env" ] && . "$HOME/.search_env"
: "${TAVILY_API_KEY:?TAVILY_API_KEY not set (see ~/.search_env)}"
q="${1:?usage: tavily-search.sh \"query\" [max_results] [--raw]}"
max="${2:-5}"
raw=0; [ "${3:-}" = "--raw" ] && raw=1
resp=$(curl -s -m 30 https://api.tavily.com/search \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "import json,sys; print(json.dumps({'api_key': sys.argv[1], 'query': sys.argv[2], 'max_results': int(sys.argv[3]), 'include_answer': False}))" "$TAVILY_API_KEY" "$q" "$max")")
if [ "$raw" -eq 1 ]; then printf '%s\n' "$resp"; exit 0; fi
printf '%s' "$resp" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE_ERROR', e); sys.exit(1)
if 'detail' in d and 'results' not in d:
    print('API_ERROR:', d.get('detail')); sys.exit(2)
for r in d.get('results', []):
    print('-', (r.get('title') or '')[:100])
    print(' ', (r.get('url') or '')[:120])
    print(' ', (r.get('content') or '')[:300].replace(chr(10),' '))
    print()
"
