# 代码优化与提升计划 · 2026-11-07

## 执行状态（2026-11-07 当晚更新）

方案 A 已执行完毕，并追加落实 P1 全部四项与 P2-3 文档基线，逐项证据见
`CHANGES-2026-11-07-gate-hardening-and-perf.md`：

- ✅ **P0-1** 遗留代码分两批入库（`6e1b804` 功能+资产 / `cc0ad8c` 账本+截图）；
  **P0-2** 资产压缩（6.73 MB → 2.41 MB，纯测试 `1 failed` → **`140 passed`**）；
  **P0-3** 影子检查器接入 CI 告警（63 符号/431 命中，非阻断）；
  **P0-4** Pages 改为等回归成功；**P0-5** 构建期资源存在性检查（66 引用，含反向验证）。
- ✅ **P1-1 ~ P1-4**：FARP/雷达 DOM 写缓存与 scratch 复用、空 catch 加日志、
  GLB 加载失败统一告警（loader 一处注入，app 零改动）；**P2-3** 文档基线更新。
- ⏸ **未做**：P1-5 dispose（需 GPU 实测）、P2-1 包体（需像素 diff 立项）、
  P2-2 巨型文件重构（代码漂移刚收敛，不在本轮动）。
- ✅ **B4 遗留红灯已修复**：根因是 `74-tour.js` 与 `82-cutscene.js` 同名顶层函数
  `tourTogglePause` 在单 IIFE 里静默覆盖（10-30 批次引入）；82 改名让路，并新增
  `build.mjs` 顶层函数重名硬门禁（296 个函数 / 0 重名，含反向验证）。
  无头 CI 冒烟 **RESULT PASS / ERRORS: none**。详见 CHANGES 第七节。
- `main` 与 Pages 未动，全部改动推在 `feat-visuals-aerodynamics`。

> 以下为改动前的核查结论与计划正文。

---
> 核查基线：远端 `origin/main` = `01d4c970a4099087248f901bfbaba7df9812a6a3`（2026-10-27 提交），
> 本地工作树（含未提交改动），以及当前分支 `feat-visuals-aerodynamics`（HEAD `7f59380`）。
> 所有结论标注【已核实】或【需实测】；逐条附 文件:行号，防止后续 AI 照单全收。

---

## 〇、一句话结论

**当前最该做的不是优化算法，是「让线上追上本地 + 让门禁真的拦得住问题」**。
线上 Pages 跑的是 10-27 的代码，本地躺着 10-30～11-02 共 50 个文件、+3985/−447 行的未提交改动，
且这批改动**现在纯逻辑门禁就是红的**（`1 failed, 139 passed`）。在此状态下谈重构、谈合批、谈包体优化，
等于给一间还没验收的房子挑窗帘颜色。

---

## 一、核查基线（可复现命令 + 实测数字）

| 项 | 实测结果 | 复现命令 |
|---|---|---|
| 远端最新 main | `01d4c97`，`origin/HEAD` 也指向 main | `git ls-remote origin HEAD refs/heads/main` |
| 本地分支 | `feat-visuals-aerodynamics` HEAD `7f59380`，比 `origin/feat-visuals-aerodynamics` ahead 1 | `git branch -vv` |
| 与远端 main 的漂移 | **50 files changed, +3985 / −447**；其中 `src/app` 37 文件、+3087 行 | `git diff --stat origin/main` |
| 未跟踪产物 | 8 份 `CHANGES-2026-10-30 ~ 11-02`、6 张测试截图、`scratch/`、`assets/targets/mq1_predator.glb` | `git status --short` |
| 已删除资源 | `assets/targets/palm_tree.glb`、`plane.glb`（代码已改用 `palm_tree_v2.glb` / `shahed.glb`，属合理清理） | `16-targetprops.js:44`、`26-airtargets.js:197-198` |
| 构建门禁 | **绿**：`node build.mjs` Exit 0；拓扑无反向引用；id 契约 template 235 / 代码引用 208 / 死引用 0 | `node build.mjs` |
| 语法体检 | **绿**：`node --check dist/app-check.mjs` Exit 0 | 同上 |
| 纯逻辑门禁 | **红**：`1 failed, 139 passed`（8.87s） | `uv run --with pytest pytest -q tools/tests_pure` |
| 产物体积 | `dist/index.html` **2252 KB**（three 654 + loader 167 + app **1350** + 模板/CSS）；`dist/assets` **45.58 MB** | `node build.mjs` 输出 |
| 体积对比 | `PERF-AUDIT.md:16` 记录旧基线 1415 KB（app 586 KB）→ 现 app **+130%**、总 **+59%** | 同上 |
| 源文件规模 | 79 个 `src/app/*.js`；最大 70-mission 1138 行 / 82-cutscene 1112 / 65-weapons 1111 / 81-narrative 914 | 行数统计 |

---

## 二、P0 · 止血（不做完，后面全白干）

### P0-1 【已核实】代码漂移：线上和本地是两个项目

- **证据**：`origin/main` = `01d4c97`；工作树 50 文件 +3985/−447 未提交；8 份 10-30～11-02 的 CHANGES 全是 `??`；
  当前分支还有 1 个未推提交 `7f59380`。Pages（`pages.yml` on push main）最后一次构建的是 01d4c97。
- **影响**：别人从 GitHub 拉到的代码没有这批功能；`CHANGES` 记了账但仓库里查无此账；
  线上 Pages 与本地 2252 KB 产物不是同一份东西。
- **改法**：先**盘点归属**（这批改动疑似多个 AI 分批产出，不要替别人打包），按功能分批 commit + push；
  每批单独跑 `node build.mjs` + `node --check` + 纯测试；推 main 前必须确认 P0-2 的红灯已修。
- **验收**：`git status` 干净或仅剩明确标注的待办；Pages 页面 `__BUILD_ID.git_sha` == 新 main HEAD。
- **代价/风险**：**不要 `git add -A`**（会把别人的半成品、截图、`scratch/` 一起提交）。
  推 main 等于发布未经 GPU 全量门禁验证的功能 —— 需老黄拍板是「先推 feature 分支」还是「直接进 main」。

### P0-2 【已核实】新资产让 CI 当场变红（当前唯一硬失败）

- **证据**：`uv run --with pytest pytest -q tools/tests_pure` → `1 failed, 139 passed`；
  失败项 `tools/tests_pure/test_assets_compressed.py:23`：`test_all_target_glbs_meshopt` 报
  `mq1_predator.glb` 缺 `EXT_meshopt_compression`。
  该 GLB **6.73 MB 未压缩**（`assets/targets` 61 个共 39.17 MB），且 `git status` 显示 `??`（未纳入版本控制），
  同时被 `81-narrative.js:297` 加载，`26-airtargets.js:198` 一类调用点的 `onError` 是空函数 → 线上 404 会静默丢模型。
- **影响**：这批代码原样提交，CI 的 `Pure logic tests` 步骤立刻红；即使绕过 CI，线上也会缺模型。
- **改法**：① 跑 `tools/compress_glb.sh` 压缩（脚本存在；压缩会保留法线为 FLOAT，见 `test_no_integer_normals`）；
  ② `git add` 该 GLB；③ 复跑纯测试到 `140 passed`。
- **验收**：纯测试 0 failed；`build.mjs` 复制清单把它带进 `dist/assets/targets/`；
  DevTools Network 无 404。
- **代价**：压缩属资产处理，不动 JS；体积预计显著下降（无实测数字，【需实测】）。

### P0-3 【已核实】`check_undefined` 影子检查器从未接入任何门禁

- **证据**：`tools/check_undefined.mjs:12-15` 自述「影子模式、**永不非零退出**」「观察一周再转硬门禁」；
  全库 grep `check_undefined|assertUndefined` 只命中它自身和 `check_undefined_selftest.mjs`，
  `build.mjs` 无 import，`.github/workflows/browser-regression.yml:25-30` 的 Syntax checks 只跑
  `check_dom_ids.mjs` 与 `check_topology_selftest.mjs`。10-27 落地至今 11 天，转硬门禁条件已过期未执行。
- **影响**：拼写笔误（`S._leannP` 之类）在本地和 CI 都不会被拦；「门禁升级」实际没进门禁。
- **改法**：① 先跑 `node tools/check_undefined.mjs --json` 看 62/427 基线嫌疑是否全为白名单/已审；
  ② 接进 CI 作为独立步骤（先 warning）；③ 假阳性率确认 <5% 后接进 `build.mjs` 允许非零退出。
- **验收**：故意写入一个未定义符号 → CI 步骤报出该符号（阶段②）；接入硬门禁后构建变红（阶段③）。
- **代价**：约 20 行配置；**风险**：假阳性会卡住所有人的构建，所以必须分「影子 → 警告 → 硬门禁」三步。

### P0-4 【已核实】Pages 部署不等回归结果

- **证据**：`.github/workflows/pages.yml:5-7` 与 `.github/workflows/browser-regression.yml:3-8`
  是两个独立 workflow，都 `on: push: branches: [main]`；`pages.yml` 的 `deploy` job 只有 `needs: build`，
  没有任何等待/依赖回归结论的判断。
- **影响**：回归门禁红了（比如现在的纯测试失败），同一 push 仍会把产物部署上线。
- **改法**：把「build + 门禁」与「deploy」合并为一个 workflow，或用 `workflow_run` 让部署只在
  `browser-regression` 成功后触发；`concurrency` 保持 `cancel-in-progress: false`。
- **验收**：造一个故意失败的测试 push，验证 Pages 产物未更新；再修好 push，验证正常部署。
- **代价**：部署链路变长；收益是坏构建上不了线。

### P0-5 【建议随 P0-2 一起做】加「代码引用资源存在性」构建期检查

- **证据**：本次手工比对 68 个去重 `assets/...` 引用，全部在 `dist` 存在；唯一"缺失"
  `assets/details/nose.glb` 是 `62-detailparts.js:15` **注释文字**被正则误抓（非加载），已排除。
  但 `mq1_predator.glb` 这类「代码引了、文件没进 git」的情况，现有门禁无任何检查。
- **改法**：`build.mjs` 里遍历 `src/app/*.js` + `template.html` 抽 `assets/...` 字面量，
  对每项 `fs.existsSync` + 确认被复制进 `dist`；缺失即构建失败。动态拼接路径
  （`18-audio.js:164/190`、`70-radio.js:44`、`71-armory.js:20/383/414`）走目录级存在性检查。
- **验收**：故意删一个被引用的 GLB → `node build.mjs` 报错；恢复 → 绿。
- **代价**：约 15 行；几乎零风险。

---

## 三、P1 · 低风险性能与健壮性（零视觉变化，可单独发）

| # | 问题【已核实】 | 证据 | 改法 | 验证 | 代价 |
|---|---|---|---|---|---|
| P1-1 | `updateFarpHud()` 每帧裸写 `textContent` / `style.width`，无缓存无节流；同文件其它 HUD 都用 dataset 缓存，这是 B1 纪律的漏网点 | `70-hud.js:588`、`:590`、`:613`；`70-loop.js:412` 每帧无条件调用 | 缓存上次文本与百分比，变化才写 | MutationObserver 计 `#farp-hud` 属性变更；像素 diff=0 | ~15 行 |
| P1-2 | 战术雷达 0.08s 刷新里，`toRadar` 每次新建局部函数、每目标返回新对象，`cntEl/infoEl` 裸写 | `70-hud.js:419`、`:430`、`:550`、`:556`、`:560`；`70-loop.js:411` | 局部函数提模块级、复用 scratch 对象、DOM 加值比较缓存 | 构造器计数 + 雷达画面像素 diff=0 | ~25 行 |
| P1-3 | 导览/航线的**步骤函数**异常被空 catch 吞掉，少一幕且无日志 | `74-tour.js:85` `try { s.fn(); } catch (e) {}`、`75-routes.js:119` 同款 | catch 内至少 `console.warn`（可带步骤索引） | 故意让某步抛错 → 控制台可见 | 2 行 |
| P1-4 | 多处 GLB `onError` 为空函数，404/解码失败静默降级，玩家只看到模型缺失 | `48-rescue.js:102`、`26-airtargets.js:198-214` 等（全量待逐条核） | 统一 `loadGlbOrWarn()` 包装：失败 `console.warn` + 保留程序化兜底 | 阻断单个 GLB 请求 → 有日志且场景不崩 | ~20 行 + 替换调用点 |
| P1-5 | 换壳克隆材质 / 合并临时几何只 `remove()` 不 `dispose()` | `16-targetmodels.js:244-249`（`material.clone()`）、`00-utils.js:229` `mergeGeos` 不释放入参、`19-reflect.js:142` / `16-targetmodels.js:385` 的 `geometry.clone().applyMatrix4()` | remove 前遍历 dispose 克隆材质；合并后 dispose 临时几何 | **需 GPU 实测** `renderer.info.memory` 反复换场不增长；确认无共享材质被误释放 | ~20 行，中等风险 |

> P1 全部遵守「同画面少做事」：`node build.mjs` + `node --check` + 纯测试三绿，
> 且不动渲染可见面。**有头 Playwright 全量门禁会抢鼠标焦点，需老黄在场才能跑**。

---

## 四、P2 · 结构与体积（收益大、动静大，排最后）

### P2-1 包体膨胀（2252 KB，app 单包 1350 KB）

单文件 HTML 是项目红线（`build.mjs` 纯 Node 拼接、禁 import、单 IIFE），**代码分割不可行**。可行项按风险排序：

| 选项 | 做法 | 收益 | 代价 / 风险 |
|---|---|---|---|
| A（推荐先做） | 部署侧开 gzip / brotli（`start-demo.bat` 与 Pages 说明写一行） | 线上文本量级 ~350-400 KB | 0 代码改动；`PERF-AUDIT.md:228-230` 已提过但未落地 |
| B | 构建期对内联网 JS 做压缩（去注释/空白） | app 体积可显著下降 | 必须防破坏 shader 字符串、`</script>`、`onBeforeCompile` 的 `#include <...>` 字面量；要 A/B 像素 diff 自证，单独立项 |
| C | 模块懒加载 / 拆分 | 理论收益最大 | 违反单 IIFE + 拓扑契约架构，**不建议** |

### P2-2 巨型文件与重复逻辑（可维护性，非 bug）

- `70-mission.js` 1138 行、`82-cutscene.js` 1112、`65-weapons.js` 1111、`81-narrative.js` 914。
- 三份同构「建靶」与「损伤烟 Sprite」：`16-targets.js:139/167`、`16-town.js:222/237`、`16-valley.js:180/192`。
- 两处同构 `clone().applyMatrix4(rel)` → 分桶 → `mergeGeos` → remove 重建：`16-targetmodels.js:385`、`19-reflect.js:142`。
- `70-mission.js:411/419/430/437` 四个变体分支重复拼 `<div class="mrow">` 行模板（**0.5s 节流触发，非每帧**，优先级低）。
- **改法**：抽公共工厂到 `16-*` 系列同级文件；**红线**：新增跨文件顶层符号必须同步
  `docs/module-contracts.md` 的 `provides` / `depends`，否则 `node build.mjs` 拓扑检查直接红。
- **建议**：等 P0 代码上云、工作树稳定后再动，别在 3985 行漂移期做重构。

### P2-3 文档基线漂移

`NEXT-STEPS.md:17` 仍以 `305dc4f` 举例「最新提交」；`PERF-AUDIT.md:15-16` 的 1415 KB / 188~277 draws
是旧基线；10-30～11-02 的 8 份 CHANGES 未入库。建议补一份「当前基线快照」，把旧数字标为历史值，
避免下一个 AI 拿过期数字当验收标准。

---

## 五、明确排除的「伪问题」（本次逐条复核后判不成立）

1. **`assets/details/nose.glb` 缺失** —— `62-detailparts.js:15` 是注释文字「未入库」，非加载路径，正则误报。
2. **dist 中 48 个"孤儿资源"** —— `18-audio.js:164/190`、`70-radio.js:44`、`71-armory.js:20/383/414`
   是字符串动态拼接（`ARM_DIR + it.img + '.webp'` 等），静态正则扫不到，不是未使用资源。
3. **`palm_tree.glb` / `plane.glb` 被删** —— 代码已切到 `palm_tree_v2.glb` / `shahed.glb`，属清理而非漏文件。
4. **`_panelShift` 每帧 `getBoundingClientRect`** —— `70-loop.js:42-48` 已做 10Hz 节流（NEXT-STEPS 4.3 第 1 条已修）。
5. **`_GQ.MAX` 硬编码 4** —— `build.mjs:118-121` 已按 `navigator.connection` 分档且监听 change。
6. **`31-scenery` shader chunk 名断言** —— `31-scenery.js:490` 已有 `indexOf('#include <map_fragment>') < 0` 告警。
7. **`updateLabels()` 每帧写 DOM / 各 `Vector3` 每帧分配** —— `PERF-AUDIT.md` A1-A7、B1 已实施。
8. **`S.radarPhase` 无界累加**（`70-loop.js:119` 递增不取模，`70-hud.js:398` 却 `% 2π`）——
   机制上长时挂机后大参数 `Math.sin` 精度会退化，但量级**未实测**，列为观察项，不排期。
9. **PERF-AUDIT 的 C 类 draw call 合批 / E1 后处理 pass 合并** —— 前者需 GPU 像素 diff 自证「同画面」，
   后者数学上非严格等价（文档自述），本项目红线禁止降画质换数字，**不列入本轮**。
10. **历史 `CHANGES-*.md`（40+ 份）** —— 是账本，不删不合并。

---

## 六、执行顺序与验收清单

| 步 | 内容 | 成功标准 |
|---|---|---|
| 1 | P0-2 压缩并纳入 `mq1_predator.glb` | 纯测试 `140 passed` / 0 failed |
| 2 | P0-5 资源存在性检查接入 build | 故意删文件 → build 红；恢复 → 绿 |
| 3 | P0-3 影子检查器接入 CI（先警告） | CI 输出嫌疑清单，不阻断 |
| 4 | P0-4 部署等回归 | 模拟失败 push，Pages 未更新 |
| 5 | P0-1 分批提交 + push（**逐批跑三道门禁**） | `git status` 收敛；Pages `__BUILD_ID.git_sha` == 新 HEAD |
| 6 | P1-1 ~ P1-4（可合并为一个提交） | build / node --check / 纯测试三绿 + 有头回归（需人在场） |
| 7 | P1-5 / P2 单独立项 | 需 GPU 实测与像素 diff 后再排 |

**红线**：不 `git add -A`；`dist/` 绝不入库；不动 `docs/module-contracts.md` 之外的契约文件；
新增跨文件符号必须同步契约；注释 / UI 文案 / 文档一律中文；每个功能在 `CHANGES-*.md` 记一笔；
有头 Playwright 门禁运行前先跟老黄打招呼。

---

## 七、给老黄的三个选择（各自带代价）

| 方案 | 包含 | 好处 | 代价 |
|---|---|---|---|
| **A · 止血（推荐先做）** | P0-1 ~ P0-5 | 线上追上本地、CI 恢复绿、坏构建上不了线；改动基本是配置与资产，业务代码零风险 | 需要分批梳理 3985 行未提交改动的归属，得确认哪些能进 main |
| **B · 止血 + 打磨** | A + P1-1 ~ P1-4 | 顺手修掉每帧 DOM 裸写、静默失败、无日志异常，帧率与排障体验改善 | 多约 60 行改动，需跑有头回归（抢鼠标，需人在场） |
| **C · 全线** | B + P1-5 + P2 | 包体、可维护性一并整治 | 涉及 dispose 与重构，必须先补 GPU 全量门禁；在代码漂移期做等于边开车边换发动机 |

**推荐 A**，理由：当前唯一的红灯是资产压缩，唯一的系统性风险是「本地 ≠ 线上」和「门禁不拦」；
这两件事不解决，B/C 的改动写完也没人验得了、也没地方发。
