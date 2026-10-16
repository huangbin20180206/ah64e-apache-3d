# Standing operating procedures (WSL)

## Web search (in order, stop at first that works)
1. Built-in `websearch` tool.
2. `tools/tinyfish-search.sh "query" [news|web]` — FREE (12k/day). Prefer over paid APIs.
3. `tools/tavily-search.sh "query"` / `tools/brave-search.sh "query"` — paid, use when TinyFish 429/402.
4. `webfetch` / `firecrawl scrape` for page content. Keys live in `~/.search_env`
   (auto-sourced by scripts); never print key values, only lengths/hashes.

## Merge gate（完工三件套，全绿才算完）
1. `node build.mjs` 通过（含 UI id 契约检查）。
2. `node --check dist/app-check.mjs` 语法体检通过。
3. 页面截图验证（起飞/开火/改动点），截图留档。
4. 动了 `src/app/` 必须跑 `tools/tests` 浏览器回归。
5. 每个功能在 `CHANGES-*.md` 记一笔；注释/UI文案/文档一律中文。

## Browser automation (logged-in sites: xiaohongshu/bilibili/zhihu/...)
- Before ANY `opencli` browser/adapter command, run `tools/opencli-chrome-ensure.sh`
  first: it starts Windows Chrome via interop if needed and waits for the
  Browser Bridge profile. Only proceed on `READY`.
- Skills: `.agents/skills/opencli-browser`, `.agents/skills/opencli-usage`.
- Lesson 2026-10-16: `opencli twitter tweets` returns raw firehose (RTs included,
  occasional ~2min ordering glitches). For "latest N posts" queries always pull
  `--limit 25`, re-sort by `created_at` yourself, and label 原创 vs 转推.
  Pure RTs do NOT match what the profile UI shows. Verify against ground truth.
