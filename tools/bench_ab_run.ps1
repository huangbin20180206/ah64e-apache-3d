# tools/bench_ab_run.ps1 - Phase 13 evidence-loop A/B outer runner (review item 2)
# Self-contained: creates TWO clean worktrees (fixed baseline SHA and candidate
# terminal SHA), builds each dist, starts two static servers on dynamic free
# ports, then runs impl-1 -> base-1 -> ... -> impl-3 -> base-3 via bench_ab.py.
# Identity binding: every build embeds window.__BUILD_ID {git_sha, bundle_sha256}
# (bundle_sha256 = sha256 of dist/app-check.mjs, no self-reference); bench_ab.py
# reads it from the browser and compares with AB_EXPECT_SHA + the worktree's own
# app-check hash. runner never writes local ROOT/dist hash as served identity.
#
# Usage (PowerShell 5.1 safe: ASCII only, CRLF+BOM handled by git):
#   powershell -File tools/bench_ab_run.ps1 -BaselineSha <40hex> -ImplSha <40hex>
# Env override: AB_GROUPS (default 3)
param(
  [string]$BaselineSha = '',
  [string]$ImplSha = ''
)
$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Push-Location $root

function Assert-NotNull([string]$name, [string]$val) {
  if (-not $val -or $val.Length -ne 40) { Write-Host "FATAL: $name must be 40-hex (got '$val')"; Pop-Location; exit 1 }
}
Assert-NotNull 'BaselineSha' $BaselineSha
Assert-NotNull 'ImplSha' $ImplSha

$groups = if ($env:AB_GROUPS) { [int]$env:AB_GROUPS } else { 3 }

# ---- local worktree area (temp) ----
$wtRoot = Join-Path $env:TEMP ("apache_pw_ab_" + (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Force -Path $wtRoot | Out-Null
$wtBase = Join-Path $wtRoot 'base'
$wtImpl = Join-Path $wtRoot 'impl'
$toolSha = (git rev-parse HEAD).Trim()   # test tooling SHA (runner itself)

$servers = @()
try {
  # ---- create clean worktrees ----
  git worktree add $wtBase $BaselineSha | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git worktree add base failed" }
  git worktree add $wtImpl $ImplSha | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git worktree add impl failed" }

  # ---- build both dists (identity embedded by build.mjs) ----
  Push-Location $wtBase
  node build.mjs 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "[base build] $_" }
  if ($LASTEXITCODE -ne 0) { throw 'base build failed' }
  Pop-Location
  Push-Location $wtImpl
  node build.mjs 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "[impl build] $_" }
  if ($LASTEXITCODE -ne 0) { throw 'impl build failed' }
  Pop-Location
  $buildTime = (Get-Date -Format o)

  # ---- pick two free ports ----
  $portBase = Get-Random -Minimum 9000 -Maximum 9999
  $portImpl = Get-Random -Minimum 10000 -Maximum 10999

  # ---- start servers (uv http.server, hidden) ----
  $sBase = Start-Process -FilePath 'uv' -ArgumentList "run","python","-m","http.server","$portBase","--directory","dist" -WorkingDirectory $wtBase -WindowStyle Hidden -PassThru
  $sImpl = Start-Process -FilePath 'uv' -ArgumentList "run","python","-m","http.server","$portImpl","--directory","dist" -WorkingDirectory $wtImpl -WindowStyle Hidden -PassThru
  $servers += @($sBase.Id, $sImpl.Id)
  Start-Sleep -Seconds 3
  $codeB = & curl.exe --noproxy '*' -s -o NUL -w '%{http_code}' ("http://localhost:" + $portBase + '/index.html')
  $codeI = & curl.exe --noproxy '*' -s -o NUL -w '%{http_code}' ("http://localhost:" + $portImpl + '/index.html')
  Write-Host "base @ $portBase (code $codeB)  impl @ $portImpl (code $codeI)"
  if ($codeB -ne '200' -or $codeI -ne '200') { throw 'server not ready' }

  # ---- alternating 3 groups ----
  $fail = 0
  $order = @()
  for ($g = 1; $g -le $groups; $g++) { $order += "impl-$g"; $order += "base-$g" }
  Write-Host ("A/B order: " + ($order -join ' -> '))
  foreach ($step in $order) {
    $parts = $step.Split('-')
    $o_tag = $parts[0]; $o_group = $parts[1]
    $port = if ($o_tag -eq 'impl') { $portImpl } else { $portBase }
    $wt = if ($o_tag -eq 'impl') { $wtImpl } else { $wtBase }
    $exp = if ($o_tag -eq 'impl') { $ImplSha } else { $BaselineSha }
    $env:AB_TAG = $o_tag; $env:AB_GROUP = $o_group
    $env:AB_RUN = (Get-Date -Format 'yyyyMMdd-HHmmss')
    $env:AB_URL = "http://localhost:$port/?nocine=1&nocut=1"
    $env:AB_WORKTREE = $wt; $env:AB_BUILD_TIME = $buildTime
    $env:AB_EXPECT_SHA = $exp; $env:AB_TEST_SCRIPT_SHA = $toolSha
    Write-Host "=== $step @ $($env:AB_URL) ==="
    & uv run --with playwright python tools/bench_ab.py 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: $step"; $fail++ }
  }
  if ($fail -gt 0) { Write-Host "A/B has $fail failed group(s) - incomplete"; Pop-Location; exit 1 }

  # ---- auto summary from raw JSON ----
  Write-Host '===== A/B SUMMARY (auto) ====='
  $rootFwd = $root.Replace('\', '/')
  $scriptDirFwd = $scriptDir.Replace('\', '/')
  & uv run python -c "import sys; sys.path.insert(0, '$scriptDirFwd'); import bench_ab_summary; bench_ab_summary.main('$rootFwd')" 2>&1 | ForEach-Object { Write-Host $_ }
} finally {
  foreach ($pid_ in $servers) {
    try { taskkill /F /T /PID $pid_ 2>$null | Out-Null } catch {}
  }
  try { git worktree remove $wtBase --force 2>$null | Out-Null } catch {}
  try { git worktree remove $wtImpl --force 2>$null | Out-Null } catch {}
  try { Remove-Item -Recurse -Force $wtRoot -ErrorAction SilentlyContinue } catch {}
}
Pop-Location
exit 0