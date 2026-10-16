# Standing operating procedures (WSL)

## Web search (in order, stop at first that works)
1. Built-in `websearch` tool.
2. `tools/tinyfish-search.sh "query" [news|web]` — FREE (12k/day). Prefer over paid APIs.
3. `tools/tavily-search.sh "query"` / `tools/brave-search.sh "query"` — paid, use when TinyFish 429/402.
4. `webfetch` / `firecrawl scrape` for page content. Keys live in `~/.search_env`
   (auto-sourced by scripts); never print key values, only lengths/hashes.

## Browser automation (logged-in sites: xiaohongshu/bilibili/zhihu/...)
- Before ANY `opencli` browser/adapter command, run `tools/opencli-chrome-ensure.sh`
  first: it starts Windows Chrome via interop if needed and waits for the
  Browser Bridge profile. Only proceed on `READY`.
- Skills: `.agents/skills/opencli-browser`, `.agents/skills/opencli-usage`.
- Lesson 2026-10-16: `opencli twitter tweets` returns raw firehose (RTs included,
  occasional ~2min ordering glitches). For "latest N posts" queries always pull
  `--limit 25`, re-sort by `created_at` yourself, and label 原创 vs 转推.
  Pure RTs do NOT match what the profile UI shows. Verify against ground truth.
