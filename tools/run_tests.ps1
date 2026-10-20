# tools/run_tests.ps1 — Phase 0 唯一发布门禁入口（复核二轮加固）
# 职责：定位项目根 → 立即进入项目根 → 验证 git toplevel → 强制 expected SHA →
#       构建 → 静态检查 → 启动服务 → 等待就绪 → 按 test-manifest.json 串行运行
#       全部浏览器测试 → 汇总退出码 → 运行后一致性复验 → evidence JSON 落盘 →
#       无论成败/中断都可靠关闭服务。
# 测试清单来源：tools/tests/test-manifest.json。
# 输出目录：APACHE_TEST_OUT（未设置时默认 %TEMP%\apache_pw\<时间戳>）。
# 发布门禁必须设 GATE_EXPECT_SHA=<40位 HEAD>；缺失立即失败（不得可选）。
$ErrorActionPreference = 'Continue'

# 输出编码：本机 Windows 控制台默认 ANSI（GBK），子进程 stdout 含中文时会触发
# UnicodeEncodeError 把测试炸成 FAIL（test_gate_harness 的 [dbg] 打印曾因此挂掉），
# 且日志里的中文全部变成"����"。强制 Python 用 UTF-8 写 stdout，mintty 可正常显示。
$env:PYTHONIOENCODING = 'utf-8'

# ---- 定位项目根（以本脚本位置为锚：<root>\tools\run_tests.ps1 → 上跳一层） ----
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
if (-not (Test-Path (Join-Path $root 'build.mjs'))) {
  Write-Host "FATAL: build.mjs not found at '$root' —— 根目录推导失败"
  exit 1
}

# ---- 第一项有效操作：进入项目根（复核修复：此前 git 命令在 Push-Location
#      之前执行，从其他 Git 仓库调用会绑定错误 SHA/工作树） ----
Push-Location $root

# git 封装：所有 git 命令检查退出码（复核修复）
function Invoke-GitCheck([string]$argsLine) {
  $out = & git $argsLine.Split(' ') 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FATAL: git $argsLine 失败 (exit $LASTEXITCODE): $out"
    Pop-Location
    exit 1
  }
  return ($out -join "`n")
}

# ---- 输出目录（可被外部 APACHE_TEST_OUT 覆盖） ----
if (-not $env:APACHE_TEST_OUT) {
  $env:APACHE_TEST_OUT = Join-Path $env:TEMP ("apache_pw\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
New-Item -ItemType Directory -Force -Path $env:APACHE_TEST_OUT | Out-Null
# Phase 1 归档卫生：证据测试（test_phase0_evidence）默认写 phase-0 封板目录，
# 门禁运行改写临时目录——已封板归档不因每次回归被覆写
$env:PHASE0_EVIDENCE_DIR = Join-Path $env:APACHE_TEST_OUT 'evidence'

# ---- run_id（evidence JSON 绑定；成功日志不得复用旧 id） ----
$env:GATE_RUN_ID = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + (Get-Random -Minimum 1000 -Maximum 9999)
$env:GATE_STARTED_AT = Get-Date -Format o

# ---- git toplevel 验证：规范化路径必须精确等于项目根（复核修复） ----
$top = (Invoke-GitCheck 'rev-parse --show-toplevel').Trim().Replace('\', '/')
$rootNorm = $root.Replace('\', '/').TrimEnd('/')
if ($top -ne $rootNorm) {
  Write-Host "FATAL: git toplevel '$top' != project root '$rootNorm' —— 当前不在 apache_web 仓库"
  Pop-Location
  exit 1
}

# ---- 强制 expected SHA（40 位；缺失/不匹配立即失败，不得可选） ----
$env:GATE_HEAD_SHA = (Invoke-GitCheck 'rev-parse HEAD').Trim()
if (-not $env:GATE_EXPECT_SHA -or $env:GATE_EXPECT_SHA.Length -ne 40) {
  Write-Host "FATAL: GATE_EXPECT_SHA 必须提供 40 位完整 HEAD SHA（发布门禁强制）"
  Pop-Location
  exit 1
}
if ($env:GATE_EXPECT_SHA -ne $env:GATE_HEAD_SHA) {
  Write-Host "FATAL: expected SHA $env:GATE_EXPECT_SHA != HEAD $env:GATE_HEAD_SHA"
  Pop-Location
  exit 1
}

# ---- 运行前一致性基线（HEAD/工作树含未跟踪/manifest/source-set/dist-tree） ----
function Get-DirtyTree {
  $d = Invoke-GitCheck 'status --porcelain'
  return ($d -join "`n")
}
# 被认证集合 = 指纹覆盖的范围（src/ build.mjs tools/ dist/）。只有这些路径上的
# 脏/改动才可能让测试结果失效。范围外的文档（README/CODELY.md/归档 md）在运行期间
# 被改动**不能**让一轮测试作废——实测事故：CODELY.md 是外部工具（CODely 记忆系统）
# 的活文件，它在门禁跑完前 17 秒追加了记忆条目，把一轮 71/71 全绿的轮次判成
# post consistency False。范围外的脏状态仍旧记录进 evidence（不隐瞒），只是不判失败。
$CERT_PATHS = 'src build.mjs tools dist'
function Get-CertDirtyTree {
  $d = Invoke-GitCheck "status --porcelain -- $CERT_PATHS"
  return ($d -join "`n")
}
# ---- 运行模式判定（2026-09-17 D2/D3/D5：快速迭代通道）----
# 两种模式：
#   认证模式（默认，不设任何覆盖变量）：走权威清单全量串行，要求干净工作树，
#     打印 success_log_run_id。这是"正式跑一遍确认可用"的路径。
#   快速模式（APACHE_TEST_ONLY 子集 / APACHE_TEST_MANIFEST 覆盖清单）：
#     允许脏树（意义就在于"提交之前先验一把"），只跑指定测试，不打印
#     success_log_run_id——避免"只跑了 3 条的绿"被误当成整轮全绿。
# 端口一律走 APACHE_TEST_PORT（默认 8642）。测试脚本用 pw_harness.BASE 拼 URL；
# 嵌套门禁自测换端口，否则子门禁启动前"按端口杀残留监听"会拔掉外层正在用的服务。
$port = if ($env:APACHE_TEST_PORT) { [int]$env:APACHE_TEST_PORT } else { 8642 }
$env:APACHE_TEST_PORT = "$port"     # 显式导出，保证子进程与门禁用同一端口
# 端口锁在 SERVE 段紧贴"杀残留监听"之前获取——见那里注释（放这里会在早期 FATAL
# 路径上泄漏锁文件：实测嵌套门禁自测的检查 4 是故意 FATAL，每次都留下一把死锁）。
$lockFile = Join-Path $env:TEMP ("apache_gate_$port.lock")
$lockHeld = $false
$manifestPath = if ($env:APACHE_TEST_MANIFEST) { $env:APACHE_TEST_MANIFEST }
                else { Join-Path $root 'tools/tests/test-manifest.json' }
$onlyNames = @()
if ($env:APACHE_TEST_ONLY) {
  $onlyNames = @($env:APACHE_TEST_ONLY.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
$certValid = (-not $env:APACHE_TEST_MANIFEST) -and ($onlyNames.Count -eq 0)
# 只有**显式子集**才算"开发快跑"、才放宽脏树要求。清单覆盖不算——它换的是测试
# 集合（test_gate_harness 的嵌套自测就靠它），仍须保持"脏树必失败"这条契约，
# 否则那条自测（检查 4：脏树必须打回）会失去意义。
$fastMode = ($onlyNames.Count -gt 0)

# 复核一轮项五：dirty_before 必须用脚本作用域变量（$script:）在测试启动前捕获，
# 不用可被后续流程覆盖的环境变量（$env:）——test_gate_harness 等子进程会执行
# git 操作/制造脏树，若 evidence 序列化时读 $env:GATE_DIRTY_BEFORE 可能读到被
# 改写的值（曾出现 evidence dirty_before=true 但运行前干净的矛盾）。$script: 变量
# 在证据构造时保持测试启动前的捕获值，不可变。
$script:GateDirtyBefore = Get-CertDirtyTree          # 认证集合内的脏（判失败用）
$script:GateDirtyOutOfScope = -join ((Get-DirtyTree -split "`n") |
  Where-Object { $_ -and ($_ -notmatch '\s(src/|build\.mjs|tools/|dist/)') })
# 上面这条把范围外的脏单独记下来（CODELY.md 之类的活文档），只记录不判失败
if ($script:GateDirtyBefore) {
  if (-not $fastMode) {
    Write-Host "FATAL: working tree not clean (untracked/modified present):"
    Write-Host $script:GateDirtyBefore
    Write-Host "Refusing to generate publish evidence on dirty tree. Clean or commit first."
    Pop-Location
    exit 1
  }
  Write-Host "WARN: 工作树不干净（APACHE_TEST_ONLY 快跑模式允许）——产物不构成整轮全绿："
  Write-Host $script:GateDirtyBefore
}
$env:GATE_MANIFEST_SHA256 = (Get-FileHash "$root/tools/tests/test-manifest.json" -Algorithm SHA256).Hash.ToLower()
# 指纹 manifest_sha256 / manifest_count 始终描述仓库里的权威清单本身（描述仓库
# 状态，不是这次跑了多少条），因此子集运行不会污染指纹的可比性。
# source-set SHA-256：受控源文件（src/ build.mjs tools/）哈希拼接后整体哈希
$srcFiles = git ls-files src/ build.mjs tools/ 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host 'FATAL: git ls-files 失败'; Pop-Location; exit 1 }
$srcHashBuilder = [System.Text.StringBuilder]::new()
foreach ($sf in $srcFiles) {
  $h = (Get-FileHash (Join-Path $root $sf) -Algorithm SHA256).Hash.ToLower()
  [void]$srcHashBuilder.Append($h)
}
$env:GATE_SRC_SET_SHA256 = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($srcHashBuilder.ToString()))) -Algorithm SHA256).Hash.ToLower()
# dist-tree SHA-256：整个 dist/ 目录（构建后计算；此处占位=构建前无 dist 基准）
$env:GATE_DIST_TREE_SHA256 = ''
$env:GATE_SRC_FILE_COUNT = $srcFiles.Count

Write-Host "===== ENV ====="
Write-Host "run_id        : $env:GATE_RUN_ID"
Write-Host "started_at    : $env:GATE_STARTED_AT"
Write-Host "os            : $([System.Environment]::OSVersion.VersionString)"
Write-Host "cwd           : $root"
Write-Host "node          : $(node --version)"
Write-Host "uv            : $(uv --version)"
Write-Host "APACHE_TEST_OUT : $env:APACHE_TEST_OUT"
Write-Host "git_toplevel  : $top"
Write-Host "head_sha      : $env:GATE_HEAD_SHA"
Write-Host "expected_sha  : $env:GATE_EXPECT_SHA"
Write-Host "manifest_sha256 : $env:GATE_MANIFEST_SHA256"
Write-Host "src_set_sha256  : $env:GATE_SRC_SET_SHA256"
Write-Host "src_file_count  : $env:GATE_SRC_FILE_COUNT"

# ---- 1. 生产构建 + 静态检查 ----
Write-Host "===== [1/4] BUILD ====="
$results = @()
$failCount = 0
try {
  node build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'BUILD FAILED' }
  node --check build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'BUILD SYNTAX CHECK FAILED' }
  node --check dist/app-check.mjs
  if ($LASTEXITCODE -ne 0) { throw 'APP SYNTAX CHECK FAILED' }
  node tools/check_dom_ids.mjs
  if ($LASTEXITCODE -ne 0) { throw 'DOM ID CONTRACT FAILED' }
  # Phase 1-B：拓扑检查器自测（构建内已含 assertTopology 检查真实源码；
  # 此处验证检查器本身能抓已知违规样本，防其退化成永远绿灯）
  node tools/check_topology_selftest.mjs
  if ($LASTEXITCODE -ne 0) { throw 'TOPOLOGY CHECKER SELFTEST FAILED' }
  # opt1（2026-10-20）：纯逻辑 pytest 进本地门禁（此前只在 CI 跑，本地门禁零引用——孤儿测试）
  python -m pytest -q tools/tests_pure
  if ($LASTEXITCODE -ne 0) { throw 'PURE LOGIC TESTS FAILED' }
} catch {
  Write-Host "FATAL: $_"
  Pop-Location
  exit 1
}
Write-Host "BUILD + STATIC CHECKS OK"

# ---- 构建后指纹：manifest 测试数 + dist 全树 SHA-256（复核修复：不只 app-check.mjs） ----
$env:GATE_MANIFEST_COUNT = (Get-Content "$root/tools/tests/test-manifest.json" -Raw | ConvertFrom-Json).tests.Count
$distFiles = Get-ChildItem "$root/dist" -Recurse -File
$distHashBuilder = [System.Text.StringBuilder]::new()
foreach ($df in $distFiles) {
  $rel = $df.FullName.Substring((Join-Path $root 'dist').Length).Replace('\', '/')
  $h = (Get-FileHash $df.FullName -Algorithm SHA256).Hash.ToLower()
  [void]$distHashBuilder.Append($rel).Append(':').Append($h).Append(';')
}
$env:GATE_DIST_TREE_SHA256 = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($distHashBuilder.ToString()))) -Algorithm SHA256).Hash.ToLower()
Write-Host "manifest_tests  : $env:GATE_MANIFEST_COUNT"
Write-Host "dist_tree_sha256 : $env:GATE_DIST_TREE_SHA256"

# ---- 2. 启动静态服务（服务生命周期全部包进 try/finally） ----
Write-Host "===== [2/4] SERVE ====="
# 端口来自上面的 $port（APACHE_TEST_PORT 可覆盖，默认 8642）
# ---- 端口互锁（2026-09-18）----
# 动机（我自己实测踩了两次）：两个门禁/子集并发跑同一端口时，后启动者会在下面
# "按端口杀残留监听"那步把先启动那轮正在用的服务连根拔掉 → 先启动那轮后续测试全部
# ERR_CONNECTION_REFUSED 假失败（实测：一轮 76 项里 test_campaign 因此报连接被拒）。
# 互锁用锁文件 + 活进程校验，**拒绝启动**而不是杀掉对方——要并发跑就换端口。
# 位置讲究：必须紧贴它保护的那一步获取。放在更早的位置会在"早期 FATAL"路径上泄漏
# 锁文件（实测嵌套门禁自测的检查 4 是故意 FATAL，每次都留下一把死锁，虽能自愈但不干净）。
if (Test-Path $lockFile) {
  $holder = (Get-Content $lockFile -Raw -ErrorAction SilentlyContinue)
  $holderPid = 0
  if ("$holder" -match 'pid=(\d+)') { $holderPid = [int]$Matches[1] }
  $alive = $false
  if ($holderPid -gt 0) {
    $hp = Get-CimInstance Win32_Process -Filter "ProcessId=$holderPid" -ErrorAction SilentlyContinue
    # 校验命令行含 run_tests：防 PID 被复用后误判"还活着"
    if ($hp -and ("$($hp.CommandLine)" -like '*run_tests*')) { $alive = $true }
  }
  if ($alive) {
    Write-Host "FATAL: 端口 $port 上已有门禁在运行 —— $holder"
    Write-Host "要并发运行（快跑通道/子集测试），请显式换端口，例如："
    Write-Host "  APACHE_TEST_PORT=8652 <同样命令行>"
    Pop-Location
    exit 1
  }
  Write-Host "清理过期锁文件（持有进程已不存在）: $lockFile"
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}
"pid=$PID run_id=$env:GATE_RUN_ID port=$port started=$env:GATE_STARTED_AT" |
  Set-Content -Path $lockFile -Encoding UTF8
$lockHeld = $true
Write-Host "端口锁已获取: $lockFile"

# 先清掉残留监听（僵尸服务——uv 父进程死后 python 子进程常残留占端口）
$stale = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $stale) {
  Write-Host "Killing stale listener pid=$p"
  taskkill /F /T /PID $p 2>$null | Out-Null
}
Start-Sleep -Milliseconds 500

$serverProc = Start-Process -FilePath "uv" -ArgumentList "run","python","-m","http.server","$port","--directory","dist" `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru
Write-Host "server pid=$($serverProc.Id)"

try {
  # 网络策略：本机 VPN 环境下 pypi 连接不稳定会让 uv 解析重试 30s 后失败，
  # 而依赖缓存其实完整——先探测离线缓存，可用则全程 UV_OFFLINE
  # R2-3 锁版本：playwright 固定 1.62.0（本机浏览器内核 chromium-1234；uv 不固定会
  # 漂移到 1.63.0 找 chromium-1243 使全部测试"浏览器不存在"假失败）——离线可复现
  & uv run --with playwright==1.62.0 --with pillow --offline python -c "pass" *> $null
  if ($LASTEXITCODE -eq 0) {
    $env:UV_OFFLINE = '1'
    Write-Host "uv offline cache OK -> tests run in offline mode"
  } else {
    Write-Host "uv offline cache incomplete -> tests run online"
  }

  # 等待就绪（最多 15s）。用 curl --noproxy：本机 VPN 代理会拦 localhost
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $code = & curl.exe --noproxy "*" -s -o NUL -w "%{http_code}" "http://localhost:$port/index.html" 2>$null
    if ($code -eq '200') { $ready = $true; break }
  }
  if (-not $ready) { throw 'SERVER NOT READY' }
  Write-Host "SERVER READY (http://localhost:$port)"

  # ---- 3. 按 test-manifest.json 串行运行全部浏览器测试 ----
  Write-Host "===== [3/4] BROWSER REGRESSION ====="
  # 起测前唯一一次全局清场（2026-09-17 D1）：只杀命令行含 ms-playwright 的
  # chromium 孤儿。此前 pw_harness 每起一测都做这件事，于是并发运行的其它
  # playwright 脚本会与门禁互杀浏览器（GATE-R6 实测 4 个测试假失败）。
  # 现在清场只在这里做一次，测试自身不再碰全局进程。
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='chromium.exe' or Name='headless_shell.exe'" |
    Where-Object { $_.CommandLine -like '*ms-playwright*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $testsRoot = Join-Path $scriptDir "tests"
  if (-not $certValid) {
    if ($onlyNames.Count -gt 0) { Write-Host "SUBSET RUN: 只跑 $($onlyNames -join ', ') —— 不构成发布认证" }
    else { Write-Host "MANIFEST OVERRIDE: $manifestPath —— 不构成发布认证" }
  }
  $ranCount = 0
  # 子集模式下清单里没有的名字属于笔误，必须先拦——静默跳过会让"跑了 0 条"看起来像全绿
  foreach ($n in $onlyNames) {
    if (-not ($manifest.tests | Where-Object { $_.name -eq $n })) {
      Write-Host "FATAL: APACHE_TEST_ONLY 指定的 $n 不在清单里"
      Pop-Location; exit 1
    }
  }
  foreach ($t in $manifest.tests) {
    $name = $t.name
    if ($onlyNames.Count -gt 0 -and ($onlyNames -notcontains $name)) { continue }
    $ranCount++
    # R2-3 锁版本：与离线探测同款 playwright==1.62.0（本机 chromium-1234；勿取消固定）
    $uvArgs = @('run','--with','playwright==1.62.0')
    if ($t.pillow) { $uvArgs += '--with','pillow' }
    $uvArgs += 'python', (Join-Path $testsRoot "$name.py")
    Write-Host "--- $name ---"
    & uv @uvArgs 2>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
    $status = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    $results += [PSCustomObject]@{ name=$name; exit_code=$code; status=$status }
    if ($code -ne 0) { $failCount++ }
    Write-Host "--- $name -> $status (exit $code) ---"
  }
  # 子集模式下清单里没有的名字属于笔误，静默跳过会让"跑了 0 条"看起来像全绿
  Write-Host "ran: $ranCount 条（清单共 $($manifest.tests.Count) 条）"
} finally {
  # ---- 4. 关闭服务（无论成功、失败、异常或中断） ----
  Write-Host "===== [4/4] CLEANUP ====="
  if ($lockHeld) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue; Write-Host "端口锁已释放" }
  try { if ($serverProc -and -not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue } } catch {}
  $stale2 = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $stale2) { taskkill /F /T /PID $p 2>$null | Out-Null }
}

# ---- 运行后一致性复验（复核修复：运行期间 HEAD/源/manifest/dist 非预期改变立即失败） ----
Write-Host "===== [POST] CONSISTENCY RE-CHECK ====="
$headAfter = (Invoke-GitCheck 'rev-parse HEAD').Trim()
$dirtyAfter = Get-CertDirtyTree
$manifestAfter = (Get-FileHash "$root/tools/tests/test-manifest.json" -Algorithm SHA256).Hash.ToLower()
$srcHashBuilder2 = [System.Text.StringBuilder]::new()
$srcFiles2 = git ls-files src/ build.mjs tools/ 2>$null
foreach ($sf in $srcFiles2) {
  [void]$srcHashBuilder2.Append((Get-FileHash (Join-Path $root $sf) -Algorithm SHA256).Hash.ToLower())
}
$srcAfter = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($srcHashBuilder2.ToString()))) -Algorithm SHA256).Hash.ToLower()
$distAfter = $env:GATE_DIST_TREE_SHA256
$distHashBuilder2 = [System.Text.StringBuilder]::new()
foreach ($df in (Get-ChildItem "$root/dist" -Recurse -File)) {
  $rel = $df.FullName.Substring((Join-Path $root 'dist').Length).Replace('\', '/')
  [void]$distHashBuilder2.Append($rel).Append(':').Append((Get-FileHash $df.FullName -Algorithm SHA256).Hash.ToLower()).Append(';')
}
$distTreeAfter = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($distHashBuilder2.ToString()))) -Algorithm SHA256).Hash.ToLower()

$postOk = $true
if ($headAfter -ne $env:GATE_HEAD_SHA) { Write-Host "FATAL: HEAD 运行期间改变 ($headAfter != $env:GATE_HEAD_SHA)"; $postOk = $false }
# 不变量是"运行期间工作树不得改变"，而不是"必须干净"——快速模式允许带着未提交
# 改动跑子集（提交前先验一把），但跑的过程中源码/manifest/dist 被改掉仍必须失败。
# 认证模式下 dirtyBefore 恒为空，本式退化成原来的"结束后必须干净"。
if ($dirtyAfter -ne $script:GateDirtyBefore) { Write-Host "FATAL: 认证集合内文件运行期间改变:`nBEFORE:$script:GateDirtyBefore`nAFTER:$dirtyAfter"; $postOk = $false }
if ($manifestAfter -ne $env:GATE_MANIFEST_SHA256) { Write-Host "FATAL: manifest 运行期间改变"; $postOk = $false }
if ($srcAfter -ne $env:GATE_SRC_SET_SHA256) { Write-Host "FATAL: source-set 运行期间改变"; $postOk = $false }
if ($distTreeAfter -ne $distAfter) { Write-Host "FATAL: dist 运行期间改变"; $postOk = $false }
Write-Host "post consistency: $postOk (head/manifest/src/dist verified)"

# ---- 汇总 + evidence JSON ----
Write-Host "`n===== REGRESSION SUMMARY ====="
foreach ($r in $results) { Write-Host ("{0,-28} {1} (exit {2})" -f $r.name, $r.status, $r.exit_code) }
$total = $results.Count
# @() 强制数组：PS 5.1 下"恰好一个匹配"时 Where-Object 返回单个对象，
# (单对象).Count 是 $null 而不是 1——全量 71 条时永远看不出来（70 个匹配是数组），
# 子集模式跑出"1/1 全绿"时就会打印成 "/1 PASS"。D5 引入快跑通道时实测暴露。
$passed = @($results | Where-Object { $_.status -eq 'PASS' }).Count
Write-Host "TOTAL: $passed/$total PASS"
Write-Host "finished_at   : $(Get-Date -Format o)"

$evidence = [ordered]@{
  run_id = $env:GATE_RUN_ID
  started_at = $env:GATE_STARTED_AT
  finished_at = (Get-Date -Format o)
  head_sha = $env:GATE_HEAD_SHA
  expected_sha = $env:GATE_EXPECT_SHA
  manifest_sha256 = $env:GATE_MANIFEST_SHA256
  src_set_sha256 = $env:GATE_SRC_SET_SHA256
  dist_tree_sha256 = $env:GATE_DIST_TREE_SHA256
  manifest_count = $env:GATE_MANIFEST_COUNT
  # 复核一轮项五：dirty_before 直接引用测试启动前 $script: 捕获值（不可变，
  # 子进程/环境变量不可能改写）；same_string_snapshot 证明这是字符串快照。
  dirty_before = ($script:GateDirtyBefore -ne '')
  dirty_before_snapshot = $script:GateDirtyBefore
  dirty_capture_method = 'script-scope immutable snapshot taken before any test process starts ($script:GateDirtyBefore); env-var override impossible'
  dirty_scope = $CERT_PATHS
  dirty_out_of_scope_snapshot = $script:GateDirtyOutOfScope
  post_consistency_ok = $postOk
  # 认证有效性（2026-09-17 D5）：只有"权威清单 + 全量"这一种运行才构得上发布认证。
  # 子集 / 覆盖清单的运行明确标 false，并且不打印 success_log_run_id——归档与 CI
  # 用该串识别成功轮，绝不能让"只跑了 3 条的绿"冒充整轮认证。
  certification_valid = $certValid
  subset_only = (-not $certValid)
  subset_requested = @($onlyNames)
  manifest_used = $manifestPath
  tests = @($results | ForEach-Object { [ordered]@{ name=$_.name; status=$_.status; exit_code=$_.exit_code } })
  summary = [ordered]@{ passed=$passed; total=$total; all_pass = ($passed -eq $total) }
  gate_exit_code = if ($failCount -gt 0 -or -not $postOk) { 1 } else { 0 }
}
$evidencePath = Join-Path $env:APACHE_TEST_OUT ("evidence-" + $env:GATE_RUN_ID + ".json")
$evidence | ConvertTo-Json -Depth 5 | Set-Content -Path $evidencePath -Encoding UTF8
Write-Host "evidence      : $evidencePath"
if ($certValid) {
  Write-Host "success_log_run_id : $env:GATE_RUN_ID"
} else {
  Write-Host "subset_log_run_id : $env:GATE_RUN_ID (非认证运行：certification_valid=false)"
}

Pop-Location
if ($lockHeld) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }   # 兜底：正常路径已在 CLEANUP 释放
if ($failCount -gt 0 -or -not $postOk) { exit 1 }
exit 0
