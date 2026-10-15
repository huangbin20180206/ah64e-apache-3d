# ============================================================
# tools/cleanup-2026-10-12.ps1 — 仓库瘦身 + 70-app 拆分落地（一次性脚本）
# 用法（仓库根目录，工作树干净时）：
#   powershell -File tools/cleanup-2026-10-12.ps1
# 做三件事：
#   1. 在当前 HEAD 打 tag archive/pre-cleanup-2026-10-12（旧截图/验收存档永久可找回）
#   2. git rm 根目录 79 张调试截图 + docs/ai-reviews/ 全目录（约 46MB）
#   3. git add 拆分后的 src/app/70-*.js（zip 已覆盖进来）与改过的文档
# 之后自己检查 git status，跑门禁，再提交。
# ============================================================
$ErrorActionPreference = 'Stop'
if (git status --porcelain -- docs/ai-reviews) { throw 'docs/ai-reviews 有未提交改动，先处理' }

git tag -f archive/pre-cleanup-2026-10-12 HEAD
Write-Host 'tag archive/pre-cleanup-2026-10-12 -> ' (git rev-parse --short HEAD)

$jpgs = git ls-files -- '*.jpg' | Where-Object { $_ -notmatch '/' }
if ($jpgs) { git rm -q -- $jpgs; Write-Host ('removed root jpg: ' + @($jpgs).Count) }
$pngs = git ls-files -- '*.png' | Where-Object { $_ -notmatch '/' }
if ($pngs) { git rm -q -- $pngs; Write-Host ('removed root png: ' + @($pngs).Count) }
if (git ls-files -- docs/ai-reviews) { git rm -r -q -- docs/ai-reviews; Write-Host 'removed docs/ai-reviews/' }

git add -A -- src/app .gitignore docs/module-contracts.md README.md CODELY.md tools/cleanup-2026-10-12.ps1
Write-Host ''
Write-Host '下一步：git status 确认 -> 门禁 -> 提交，例如：'
Write-Host '  git commit -m "chore: 仓库瘦身（移除根截图与 docs/ai-reviews）+ 拆分 70-app.js 为 70-* 八个模块"'
Write-Host '  $env:GATE_EXPECT_SHA = git rev-parse HEAD; powershell -File tools/run_tests.ps1'
Write-Host '注意：git 历史里仍有这 46MB，clone 体积不变；要真正缩小需改写历史（git filter-repo），会改所有提交 SHA，需单独决定。'
