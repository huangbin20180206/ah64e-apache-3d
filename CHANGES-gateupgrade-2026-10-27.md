# 拓扑门禁升级 + 文件职责地图（2026-10-27，豆子）

> 对应 `docs/UPGRADE-PLAN-2026-10-26.md` §3.3（tokenizer 升级，承接 10-25 撤回的 P1-4）
> 与新立文档任务（76 文件职责地图）。老黄指派："③门禁升级 + ④文件地图直接处理掉"。

## 交付一：`docs/FILE-MAP.md`（新增）

76 个源文件的职责地图：快速索引表（"我想改 X 去哪个文件"）+ 下洗特效 17/21/22/23/28
五文件拓扑拆迁说明 + 纯逻辑/渲染薄层分离纪律（84/85、87/88 同款）+ 编号分区速查。
`NEXT-STEPS.md` §三已加引用（读文件顺序第 4 项）。

## 交付二：影子检查器 `tools/check_undefined.mjs`（新增）+ 拓扑修正三处

### 新增
- `tools/check_undefined.mjs` —— 自由标识符（undefined-global）影子检查器：
  复用 `check_topology.mjs` 的 `analyze()` 输出（76 文件 / 636 顶层符号 / 7705 引用点），
  过滤「本文件顶层 + 跨文件合法符号 + 浏览器/JS 内建白名单 + 拼接前预打包全局」后，
  剩余即嫌疑笔误。**影子模式退出码恒 0**（只警告不失败），转硬门禁条件写在文件头
  （连续一周假阳性率 <5%）。支持 `--json`（脚本聚合）/`--strict`（嫌疑高亮）。
- `tools/check_undefined_selftest.mjs` —— 7 用例自测（真笔误抓取 / this 方法链 /
  `}` 后方法定义 / getter 键 / 多声明第 2 目标 / 箭头参数逗号 / 白名单命中），7/7 过。

### check_topology.mjs 三处修正（每处单独验证边数与假阳性双指标）
| # | 修正 | 证据链 |
|---|---|---|
| 1 | 方法名前驱白名单补 `}`——`} _advance(u, dt) {`（Hark 多方法挤一行）曾被当引用 | 嫌疑 503→241；配对 `)` 后必跟 `{` 才吞，调用语句不满足，无假阳 |
| 2 | 同上补 `get`/`set` 前驱——`get arcSlot() {...}` 键名漏判 | 嫌疑 241→213；__dbg 全部 getter 撞此缺口 |
| 3 | `)` 不再强制清 `declMode`——`const a = f(1), b = f(2)` 第 2+ 目标漏登记 | 91-levels `prog` 假边（把局部声明当 70-start 顶层引用）消失；`declareTop` 原有 `atTop()` 守卫防括号内伪顶层 |

另：`afterComma` 去掉 `parenDepth===0` 门槛（多声明逗号在括号平衡表达式后被卡）。

### 边数变化审计（730 → 723，逐条核对无损）
- 3 条行号位移（PI/TAU/BASE_C、renderer 同符号换行，边仍在）
- 1 条假边清除：`91-levels.js --prog--> 70-start.js`——`prog` 实为 L221 局部声明，
  旧 tokenizer 漏登导致误判跨文件引用（**真 bug 被这次修 tokenizer 顺手消灭**）
- 3 条假边合法化：`loadTxt/loading`（70-start 顶层符号，此前漏登记被当跨文件引用，
  本批同步补进 `docs/module-contracts.md` JSON 契约与速查段——**契约此前缺报**，
  旧版 `parenDepth===0` 门槛 + `)` 清 declMode 双重漏登反而让契约检查拿不到这条边）

### 影子基线（2026-10-27 定格）
**62 符号 / 427 处嫌疑**，全部定性为已知 tokenizer 盲区（x/y/z 短名解构残留、嵌套
作用域多声明）——无一真符号笔误。转硬门禁前尚需：作用域栈补解构目标登记。

### 调试期踩坑（记入防再犯）
1. `findUndefined` 默认参数写成 `opts=[]`——`Array.isArray([])` 真 → `files=[]` →
   空分析 → **影子报告假 0**，误导排查近一小时。教训：带 `Array.isArray` 分流的
   函数默认值必须 `{}`；长江后浪注意。
2. bash 单行 `node -e` 在 PowerShell 转义下反斜杠/引号不可靠，写 `.cjs` 临时脚本
   跑完删（本批共 4 个探针，已清）。
3. 多补丁并发修改同一文件时，必须每步 git checkout 回基线再单补丁验证；
   cp 备份 + git stash 组合易产生"混合态"（本批曾被混合态骗过两轮）。

## 门禁终态（2026-10-27 实测）
- `node build.mjs` ✅（拓扑 723 边 / 0 反向违规 / 契约含新增 loadTxt、loading）
- `node --check dist/app-check.mjs` ✅
- `pytest tools/tests_pure` ✅ 139 passed
- `check_topology_selftest` ✅ 8/8
- `check_undefined_selftest` ✅ 7/7
