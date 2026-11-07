# CHANGES-2026-11-07 · 门禁加固、遗留代码入库与低风险性能优化

> 依据 `docs/OPTIMIZATION-PLAN-2026-11-07.md` 执行方案 A，并追加落实其中 P1 全部
> 低风险优化项与 P2-3 文档基线。所有改动均为「同画面少做事」或门禁/可观测性，
> 未改渲染可见面，未改玩法逻辑。

## 一、修复与入库

| 项 | 改了什么 | 证据 |
|---|---|---|
| 资产压缩红灯 | `assets/targets/mq1_predator.glb` 由 6.73 MB 压到 **2.41 MB**（−64%），带 `EXT_meshopt_compression`、法线保持 FLOAT、网格名 2/2 保留；纳入 git | `tools/compress_glb.sh` + `tools/restore_mesh_names.py`；纯测试由 `1 failed/139 passed` → **`140 passed`** |
| 遗留代码入库 | 10-30～11-02 工作树遗留改动（45 文件 +3666/−428）分两批提交：功能实现 + 8 份 CHANGES 账本 + 7 张验收截图 | `6e1b804` / `cc0ad8c`；`scratch/` 临时脚本不入库 |
| 压缩脚本 Windows 坑 | `tools/compress_glb.sh` 把输入 `cp` 成 `*.orig`，gltfpack 0.21 按扩展名识别格式会报 `unknown extension`。本次改用 `scratch/*.src.glb` 作中转完成；脚本本体未改，留待后续修 | 实测 `GLTFPACK_EXIT=1` → 换后缀后 `=0` |

## 二、三道门禁加固

1. **构建期资源引用存在性检查**（`build.mjs` 新增 `assertAssetRefs()`）
   - 扫 `src/app/*.js` + `src/template.html` 里带引号的 `assets/...` 字面量，跳过整行注释
     （`62-detailparts.js` 注释里的 `nose.glb` 不会被误报），确认文件真的进了 `dist`。
   - 动态拼接路径（`18-audio.js` / `70-radio.js` / `71-armory.js`）由复制段 `readdirSync` 隐式兜底。
   - 实测：**66 个静态引用全覆盖**；反向验证藏掉 `assets/scenery/trees.webp` → `node build.mjs` `Exit 1`
     并精确报出缺失路径，恢复后 `Exit 0`。
   - CI 只 checkout 已跟踪文件，故「本地有、没 `git add`」的资源会在 CI 构建阶段直接拦下。
2. **undefined-global 影子检查器接入 CI**（`.github/workflows/browser-regression.yml`）
   - 新增非阻断步骤：`--json` 报告归档到 artifact，日志输出 `::notice::` 摘要。
   - 保持影子模式（检查器永不非零退出）：当前基线 **63 个嫌疑符号 / 431 处命中**，
     大量是 `x/z/w/Q` 等短名解构假阳性，远未达「假阳性率 <5% 转硬门禁」门槛，**不硬拦**。
   - 验证：YAML 解析通过、`check_undefined_selftest.mjs` `7/7 PASS`、
     故意注入 `typoProbeSymbol_2026` 被报告检出（`PROBE_DETECTED=true`），临时探针文件已清理。
3. **Pages 部署等待回归**（`.github/workflows/pages.yml`）
   - 由 `on: push: [main]` 改为 `workflow_run: ["browser-regression"] / completed / branches: [main]`；
     build job 加 `conclusion == 'success' && event == 'push' && head_branch == 'main'` 条件。
   - checkout 显式 `ref: workflow_run.head_sha || github.sha`，避免 workflow_run 默认取默认分支
     最新提交而部署错版本。保留 `workflow_dispatch` 作应急发布通道。
   - 注：GitHub 规定 `workflow_run` 只在默认分支上的 workflow 定义生效，
     **该改动合入 main 后才实际生效**；本次未合 main、未触发 Pages。

## 三、P1 低风险性能优化（零视觉变化）

| 项 | 文件:行号（改前） | 改法 |
|---|---|---|
| FARP HUD 每帧裸写 DOM | `70-hud.js:588/590/613`（`70-loop.js:412` 每帧调） | 新增 `_farpCache` + `_farpWrite()`，文本与 `style.width` 只在值变化时写 |
| 战术雷达每目标分配 + 裸写读数 | `70-hud.js:419/430/550/556/560` | 标绘点复用模块级 `_radarPt` scratch（所有调用点均为用完即弃，已逐个核对）；`_radarDom` 缓存文本与颜色 |
| 导览/航线步骤异常被静默吞掉 | `74-tour.js:85`、`75-routes.js:119` | 空 catch 改 `console.warn` 并带步骤/事件索引 |
| GLB 加载失败静默 | `48-rescue.js:102` 等 10+ 处 `onError` 空回调 | 在 `build.mjs` 的 `THREE.GLTFLoader` 子类注入统一 `_fail`：打印带 URL 的告警后**照常执行原回调**，app 代码零改动，主 GLB 的 `_gqOpen()` 与未传 onError 时的 `console.error` 语义保留 |

## 四、文档基线

- `NEXT-STEPS.md` 的纯测试基线与命令更新为 `uv run --with pytest pytest -q tools/tests_pure` / ≥140 passed
  （本机 `python` 不在 PATH，旧命令照抄会失败）。
- `docs/OPTIMIZATION-PLAN-2026-11-07.md` 追加执行状态，标注已完成 / 未做项。

## 五、门禁实测（改后）

```
node build.mjs                      → Exit 0（拓扑无反向引用 / id 契约 235 定义·208 引用·0 死引用 / 资源引用 66 全覆盖）
node --check dist/app-check.mjs     → Exit 0
uv run --with pytest pytest -q tools/tests_pure → 140 passed
node tools/check_undefined.mjs --json → 63 嫌疑符号 / 431 命中（与改前一致，新增缓存符号无误报）
无头 CI 冒烟 → **RESULT PASS / ERRORS: none / 全章通过（含 B4）**，见第七节
dist/index.html 2254 KB（three 654 + loader 167 + app 1351）  appBundle sha256=3b105ca0…
```

## 六、未做与遗留（需老黄拍板 / 需真机）

- **无头 CI 冒烟 B4 暂停状态断言**：初次跑 `RESULT FAIL`（页面 `ERRORS: none`），
  A/B 排除本轮改动后定位为 10-30 遗留的**符号撞名回归**，当晚已修复并全章 PASS，见第七节。
- **有头全量浏览器回归未跑**：会抢鼠标焦点，需人在场；本机 `uv run --with playwright`
  因拉包超时改用了已装好的本地 Python Playwright 跑无头冒烟。
  改后由 build / node --check / 纯测试三道门禁 + 无头冒烟（至 B4 前全绿、零运行时错误）覆盖，
  视觉等价性由代码等价分析保证，未做像素 diff。
- **P1-5 材质/几何 dispose**：需 GPU 实测 `renderer.info.memory` 且要确认无共享材质误释放，未动。
- **P2-1 包体 2254 KB**：仅记录，未做构建期 minify（会威胁 shader 字符串与 `</script>`，需 A/B 像素 diff 立项）；
  部署侧 gzip/brotli 属配置，未改代码。
- **P2-2 巨型文件与 16-* 重复逻辑**：代码漂移刚收敛，不在本轮重构。
- `main` 与 Pages 未动：本次全部推到 `feat-visuals-aerodynamics`；合 main 等于发布未经 GPU 全量门禁的功能。
- CHANGES 文档引用的 `shot_tactical_radar.png` / `shot_predator_patrol.png` / `shot_patrol_destroyed.png`
  在磁盘上不存在（历史账本承诺的证据缺失），未擅自补图或改他人文档。

---

## 七、续：B4 哑故障根因与修复（当晚「继续执行」）

### 根因【已核实，运行时探针逐项取证】

`src/app/*.js` 按文件名数字前缀拼进**同一个 IIFE**：

- `74-tour.js:157` 定义 `function tourTogglePause()` —— 操作 `tour.paused`，
  供 `74-tour.js:215` 的「一键导览（60 秒演示）」暂停按钮使用；
- 10-30 批次在 `82-cutscene.js:574` 又定义了**同名**函数 —— 操作
  `cutscene.tourPaused`，是「任务开场战术目标导览」的暂停。

同一作用域里后拼入的函数声明生效，于是 74 的按钮点击实际调用了 82 的版本，
`tour.paused` 永远不变；而且**不抛错、不告警、构建 / 语法 / 纯测试全绿**，
只在运行期表现为「按钮点了没反应」。这也解释了为何 10-27 的 CI 是绿的。

独立探针（`scratch/probe_b4.py`）复现 smoke 前序后的运行时读数：
`on:true / pbtnSame:true / nPause:1 / errors:none`，点暂停后
`paused` 仍 false、按钮文字仍「Ⅱ 暂停」—— 依次排除了
「导览没启动」「拿错按钮」「重复 id」「事件被拦截」「JS 异常」。
此前 A/B 已排除本轮改动，至此定位为 10-30 遗留的符号撞名回归。

### 修法（3 行改名，精准修改）

`82-cutscene.js` 的 `tourTogglePause` → `missionTourTogglePause`：
定义 `:574` + 调用 `:755`（暂停按钮）、`:1091`（P 键），共 3 处。
改名后只在本文件内引用，不跨文件 → `docs/module-contracts.md` 无需改动
（`node build.mjs` 拓扑检查通过）。74 的老函数名保持不变。

### 顺手补的护栏（防止再犯）

`build.mjs` 新增 `assertNoDuplicateFunctions()`：扫全部 app 文件的行首
`function NAME` 声明，跨文件重名直接构建失败并列出两个文件名。
只查函数声明的理由：`const / let / class` 重名本身就会 SyntaxError，
**只有函数声明会静默覆盖**。

- 全库基线：修复前扫描 **295 个顶层函数 / 1 处重名**（正是 B4）；
  修复后 **296 个 / 0 重名**。
- 反向验证：临时造 `99-dup-probe.js` 定义 `syncFlyText` →
  `node build.mjs` `Exit 1` 并精确报 `syncFlyText: 70-hud.js / 99-dup-probe.js`；
  删除探针后重建 `Exit 0`。探针文件已清理。

### 验证（修复后）

```
py -3 tools/tests/test_ci_smoke.py   → RESULT PASS / ERRORS: none
   全章通过，含「ci smoke OK: B2 toast / B3 解说牌 / B4 tour 暂停状态机」
node build.mjs                      → Exit 0（296 顶层函数 0 重名 / 资源引用 66 全覆盖）
node --check dist/app-check.mjs     → Exit 0
uv run --with pytest pytest -q tools/tests_pure → 140 passed
node tools/check_undefined.mjs --json → 63 嫌疑符号 / 431 命中（与改前一致）
dist/index.html 2254 KB，bundle sha256=c27c5690…
```

> 有头全量浏览器回归仍未跑（会抢鼠标焦点，需人在场）。
> 但无头冒烟已全绿，**合 main 的冒烟阻塞项已解除**；`main` / Pages 依旧未动。
