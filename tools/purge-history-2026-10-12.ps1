# ============================================================
# purge-history-2026-10-12.ps1 — 从 Git 全部历史里彻底移除大文件（批 E）
# ============================================================
# 移除对象：
#   - 仓库根目录的 *.jpg / *.png（约 79 张截图，~12MB；子目录里的图片不动）
#   - docs/ai-reviews/ 整个目录（~46MB）
#
# ⚠ 这是改写历史的操作：
#   - 所有 commit 的 SHA 都会变，tag 也会被改写（包括 archive/pre-cleanup-2026-10-12）。
#   - 推到 GitHub 需要 force-push；别人手里的旧克隆必须重新 clone，不能再 pull。
#   - 已开的 PR / 引用旧 SHA 的 CI 记录会对不上。
#   所以脚本先做一份完整的镜像备份（真正的"回退点"），并且默认不推送。
#
# 前置：
#   1) 先跑过 tools/cleanup-2026-10-12.ps1 并提交（工作区里已经没有这些文件）
#   2) pip install git-filter-repo
#   3) 工作区干净（git status 无改动）
#
# 用法（在仓库根目录）：
#   powershell -File tools/purge-history-2026-10-12.ps1            # 只改写本地，不推送
#   powershell -File tools/purge-history-2026-10-12.ps1 -DryRun    # 只统计会删多少，不改任何东西
# 改写完成、本地测试通过后，手动推送：
#   git remote add origin <原地址>      # filter-repo 会移除 origin，防止误推
#   git push --force --all origin
#   git push --force --tags origin
# ============================================================
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

function Fail($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path .git)) { Fail '请在仓库根目录运行（找不到 .git）' }
$null = git filter-repo --version 2>$null
if ($LASTEXITCODE -ne 0) { Fail '没有 git-filter-repo：先运行  pip install git-filter-repo' }
if (git status --porcelain) { Fail '工作区有未提交改动，先提交或 stash' }

$tracked = git ls-files -- 'docs/ai-reviews' | Measure-Object | Select-Object -ExpandProperty Count
$rootImg = (git ls-files | Where-Object { $_ -match '^[^/]+\.(jpg|png)$' }).Count
if ($tracked -gt 0 -or $rootImg -gt 0) {
  Fail "当前 HEAD 还跟踪着 docs/ai-reviews（$tracked 个）或根目录图片（$rootImg 个）——先跑 tools/cleanup-2026-10-12.ps1 并提交"
}

$before = (git count-objects -vH | Select-String 'size-pack').ToString()
Write-Host "当前打包体积：$before"

# 统计历史里会被删掉的对象
$hist = git log --all --name-only --pretty=format: |
  Where-Object { $_ -match '^docs/ai-reviews/' -or $_ -match '^[^/]+\.(jpg|png)$' } |
  Sort-Object -Unique
Write-Host "历史中命中的文件路径：$($hist.Count) 个"
if ($DryRun) { $hist | Select-Object -First 30 | ForEach-Object { "  $_" }; Write-Host '(DryRun：未做任何改动)'; exit 0 }

# 完整镜像备份 = 真正的回退点（tag 也会被改写，不能指望 tag）
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path (Split-Path (Get-Location) -Parent) "apache_web-backup-$stamp.git"
Write-Host "备份完整镜像到 $backup ..."
git clone --mirror . $backup
if ($LASTEXITCODE -ne 0) { Fail '镜像备份失败，已中止（什么都没改）' }

$origin = git remote get-url origin 2>$null
Write-Host ''
Write-Host '即将改写全部历史。所有 SHA 会变，推送需 force-push。' -ForegroundColor Yellow
$ans = Read-Host '确认请输入 PURGE（其他任意输入取消）'
if ($ans -ne 'PURGE') { Write-Host '已取消，什么都没改。'; exit 0 }

git filter-repo --force --invert-paths `
  --path docs/ai-reviews/ `
  --path-regex '^[^/]+\.(jpg|png)$'
if ($LASTEXITCODE -ne 0) { Fail "filter-repo 失败；备份在 $backup" }

git reflog expire --expire=now --all
git gc --prune=now --aggressive
$after = (git count-objects -vH | Select-String 'size-pack').ToString()

Write-Host ''
Write-Host "✓ 完成。打包体积：$before  →  $after" -ForegroundColor Green
Write-Host "  备份镜像：$backup（确认无误前不要删）"
Write-Host '  下一步：'
Write-Host '    1) node build.mjs; powershell -File tools/run_tests.ps1   （GATE_EXPECT_SHA 要换成新的 git rev-parse HEAD）'
if ($origin) { Write-Host "    2) git remote add origin $origin" } else { Write-Host '    2) git remote add origin <原地址>' }
Write-Host '    3) git push --force --all origin; git push --force --tags origin'
Write-Host '    4) 其他机器上的旧克隆：删掉重新 clone'
