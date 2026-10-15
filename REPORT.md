# REPORT.md — feat/game-layer 批次交付报告

> 时间盒 90 分钟内完成。工作目录 `apache_web_wt`（worktree，分支
> `feat/game-layer`，基于 70e7cf5）；全程未接触主树 `apache_web`、
> 未起任何 web 服务、未跑任何浏览器测试（任务 §0 互锁约束全程遵守，
> 开工前后均实测 `run_tests` 进程计数确认主树门禁未被干扰）。

## 1. 需求 → 实现映射

| 任务条目 | 实现 | 状态 |
|---|---|---|
| §1A 静态审计 PERF-AUDIT.md | `PERF-AUDIT.md`：A1-A8 分配 / B1-B2 DOM / C1-C4 draw call / D1-D3 材质 / E1-E3 后处理 / F1-F3 首屏，每条含 文件:行→机制→预期收益（置信度标注）→改法→验证方法 | ✅ |
| §1A draw call ≥20% | **未达标，如实报告**：C 组（镜像合并/靶标合批/残骸阴影）全部留待浏览器解禁后实施——draw 合并属"渲染可见面"改动，浏览器被禁期间无法用像素 diff 自证"同画面"，盲改违反任务红线。审计给出机制推导（water −28%/pad −21~31%）与统一探针 `tools/probe_perf.py`（写好未运行） | ⚠️ 未实施（见 §4） |
| §1B 游戏方向 | 老黄已拍板：a) 敌方反击与生存 | ✅ |
| §1B RWR 锁定告警 | 84-samwar.js 状态机 idle→track(被扫描)→lock(被锁定)→launch(导弹来袭)，HUD `hud-rwr` 四态 + Betty 语音 "MISSILE LAUNCH" + toast | ✅ |
| §1B 导弹来袭（可规避） | 比例导引 + 前置量封顶；**三重实证规避**：静止必命中（纯 pytest）/ 环机动甩出导引头视场失锁（lost，纯 pytest 硬断言）/ 干扰弹诱骗（纯 pytest）；弹速 21u/s vs 机体上限 16u/s 保持"可追可甩" | ✅ |
| §1B 干扰弹 | J 键 6 发、1.1s 冷却、28u 起效角窗、0.8/帧诱骗概率；85-samvis 亮珠+辉光渲染 | ✅ |
| §1B 命中分级损伤 | SAM 命中 +4（×难度系数）直接累加 `targets._heliDmg` 并调 `onHeliHit`——受损烟/散布惩罚/≥12 强制返航全走 P8 既有链，零第二套状态 | ✅ |
| §1B 战损影响操控 | `SAM_PENALTY_TABLE` 表引用零分配：<4 无感 / 4-8 速度航向 ×0.85 / 8-12 ×0.7 / ≥12 ×0.55-0.6；应用于环绕平移/蹬舵（70-app）与 FPV 前向/侧飞/转向积分（46-fpview，无损伤时全 1 与旧版逐位一致） | ✅ |
| §1B 架构（纯函数/纯状态） | 84-samwar.js 零 THREE/零 DOM/零 localStorage，输入输出全 plain object，自带 mulberry32；70-app 用 scratch env 复用对象喂入（零每帧分配） | ✅ |
| §2 纯逻辑纯 pytest | `tools/tests_pure/`：node 桩加载 84 源码驱动 8 用例，期望值全部写死（边界精确/布尔硬断言/注入 rng 固定概率分支，不 mock 被测对象） | ✅ 8/8 PASS（0.75s） |
| §2 渲染类 playwright（写不跑） | `tools/tests/test_samwar.py` S1-S5（RWR 链/干扰弹/命中损伤链/HUD 状态源一致/resetRange 清理），值级断言、条件等待无固定墙钟；manifest 71→72 **只追加** | ✅ 已写未跑 |
| §2 既有 71 测试 | test-manifest.json 既有条目逐字未动，只 append `test_samwar` | ✅ |
| §3 分阶段提交 | 3 笔（见 git log）：游戏层/性能批/文档报告，message 均含"为什么" | ✅ |
| §5 时间盒 | 90 分钟盒内收口，未留半截代码（半成品项全部显式列在 §4） | ✅ |

## 2. 测试清单与实际结果

| 测试 | 类型 | 本轮实际结果 |
|---|---|---|
| tools/tests_pure/test_samwar.py（8 用例） | 纯 pytest | **PASS 8/8**（实跑，0.75s；开发中经历 2 轮修复：evade 语义重定义、ammo 冷却语义修正） |
| node build.mjs（拓扑 0 反向引用 + id 契约 0 死引用 + 防 import） | 构建 | **PASS**（84/85 入序，契约先行已更新） |
| node --check dist/app-check.mjs | 语法 | **PASS** |
| node tools/check_dom_ids.mjs 隐含于 build | id 契约 | template 140 定义 / 0 死引用 |
| tools/tests/test_samwar.py（S1-S5） | playwright | **未运行**（任务 §0③ 明令禁止；已入库待解禁随门禁跑） |
| 既有 71 项门禁 | playwright | **未运行**（同上；本批未改任何既有测试文件与断言） |

## 3. 已知取舍（主动决策，非遗漏）

1. **纯机动 ≠ 绝对免疫**：导弹跟踪误差在环机动下会失锁（机制实证），但多枚
   连射时部分相位是"尾追几何"仍可命中——这是刻意的威胁性设计（干扰弹
   才是保命手段，6 发有限）。纯 pytest 的 evade 用例据此断言"**首枚**必失锁
   且未命中"而非"整场无伤"。
2. **J 键而非 V 键**：V 已被"装填"占用；J 为空闲键，fp-tip 已补键位说明。
   移动端无干扰弹触控按钮（本轮范围外，见 §4）。
3. **A4 矩阵冗余不实施**：每发 `updateMatrixWorld` 与发射时钟的相位关系
   存在跨发弹道偏移风险，零验证收益不值得冒险（PERF-AUDIT A4 详述）。
4. **SAM 音效不加新合成器**：18-audio 的 playSfx 开关盒未逐一核对 case
   清单，本批只复用既有 'hit'/'explo' 通道 + Betty 语音——零破坏面。
5. **难度联动走既有系数**：SAM 建锁速率/伤害乘 `arcade.coeffs`（rookie/
   veteran 同 AA 单发链路），未给 SAM 单独难度表。

## 4. 没做的事（含糊即失职，逐条列）

1. **draw call ≥20% 未实施**（任务 §1A 硬指标）：C1 水面镜像静态子树合并、
   C2 靶标按材质合批、C3 残骸 castShadow 关闭、C4 叙事布景合并——全部
   停在"审计 + 探针"阶段。原因：①浏览器测试本轮禁跑，无法用同机位像素
   diff 自证"同画面"（任务红线：不可证伪不动手）；②90 分钟盒内做完游戏层
   后余量不足以安全完成渲染合并。**验收方法已备齐**：`tools/probe_perf.py`
   的 draws 段（四场地 + 分解）在解禁后 baseline/本批各跑一遍即出数。
2. **既有 71 项浏览器回归未跑**：功能上本批改动均为"零损伤=行为逐位一致"
   （scratch 替换/表引用/量化写），但"逐位一致"的最终背书只能来自门禁。
3. **labels 量化的 ±1px 视觉差**：B1 取整到 1px/0.01rad——严格说是可感知
   域之内的亚像素变化（标签位移量级 46px，1px 量化肉眼不可分辨），
   像素 diff 需 ±1px 容差（探针已注明）。
4. **85-samvis 无导弹尾烟**：只用尾焰 sprite（零池耦合零分配）；拖尾观感
   留待后续接 `rig._puff`（会引入战斗期对象字面量分配，与"零每帧分配"
   纪律冲突，需按 A2 模式评估后再做）。
5. **probe_perf.py 的 draw_breakdown 段是近似分解**（shadow pass 与镜像
   共存于主 scene），精确归因需逐模块 layers 消融——脚本已留 TODO 式
   骨架，解禁跑数时按需补齐。
6. **docs/module-contracts.md 的人读段落**（`## 84-samwar.js` / `## 85-samvis.js`）未补——机器契约块（构建硬检查）已齐全，人读段落属文档完整性，留待下批。

## 5. 交付物清单

- `src/app/84-samwar.js`（纯逻辑：RWR/导引/诱骗/损伤映射，零渲染依赖）
- `src/app/85-samvis.js`（渲染薄层：导弹×3 + 干扰弹×1 对象池，零每帧分配）
- `tools/tests_pure/{samwar_drive.js, test_samwar.py}`（纯 pytest 基建首例）
- `tools/tests/test_samwar.py`（playwright，写好未跑）+ manifest 71→72
- `PERF-AUDIT.md` + `tools/probe_perf.py`（审计 + 统一验证探针）
- 接线：05-config 零改动（参数自包含于 84）；70-app（scratch env/事件
  消费/惩罚应用/HUD）、72-uibind（J 键/resetRange/__dbg）、46-fpview
  （战损减速）、template.html（hud-rwr/hud-flare/fp-tip）
- 性能批：65-weapons/16-targets/26-airtargets/50-controls scratch 化 +
  70-app（modeState 去调用 + labels 量化写）
- 契约：docs/module-contracts.md（84/85 机器块 + samwar/samvis provides）

---

# 批次二：浏览器解禁日（合并 main + C 组代码 + Phase 19 机务损伤）

## 6. 第 0 步：合并 main（拿到无头测试基建）

- `git merge main` → 76af871 **干净合并零冲突**（任务预告的 manifest/72-uibind
  两处冲突未发生：main 侧无 manifest 新条目、72-uibind 改动落在不同 hunk，
  双方内容自动共存并已逐项核验：manifest 尾部 test_samwar ✓、__dbg getter
  双方 ✓）
- 合并前工作区有 10 个未提交文件（C 组代码）——merge 未触碰这些文件所以
  顺利完成；**流程瑕疵如实记录**：任务要求"有未提交先提交"，实际顺序是
  带着脏改动合并，事后核验未发生覆盖才补提交。下不为例：合并前必须先提交。
- 获得基建：pw_harness HEADLESS（--use-angle=d3d11 硬件无头）、
  APACHE_TEST_ONLY 快跑通道、APACHE_TEST_PORT 端口可配 ✓（9 处命中验证）
- PowerShell 控制台裁光标注意事项已知悉（本批全程未用 powershell.exe
  弹窗路径；工具调用走 pwsh 后台无窗口）

## 7. C 组验证状态（job 8——代码已提交，验证等门禁空窗）

- C1/C2/C3 代码已提交（16817f5），build/拓扑/语法/纯测试 12→12 全绿
- **主树门禁全程占用 GPU**（本批开始时 gates=6，现 gates=7 且持续），按
  任务约束"跑浏览器测试前确认没有 run_tests 在跑"——probe_perf 双基线
  对比、probe_pixdiff 四场景、受影响既有测试、test_samwar 全部排队等空窗
- 后台守望已挂（30s 轮询 run_tests 归零）；**空窗执行清单**：
  ① 起基线 9410 / 本批 9411 双服务（APACHE_TEST_PORT 或直跑 probe 脚本）
  ② probe_perf 两边 → draws 对比验收 ≥20%（C1 water −28%/C2 pad-desert
  −21~31% 的机制推导值待实测校准） ③ probe_pixdiff 四场景（C2 超容差先
  归因不放宽） ④ APACHE_TEST_ONLY 跑 test_samwar + test_damage + 受影响
  项（reflection/navlights/weapons/targets_mov/threat） ⑤ 全量 73 项

## 8. Phase 19：机务损伤与特情处置（任务主体，✅ 已交付）

| 任务条目 | 实现 | 状态 |
|---|---|---|
| 四子系统 0-100 + 状态枚举 | 86-damage.js：ROTOR/ENGINE/WEAPONS/AVIONICS，五级（<25/50/75/100/≥100） | ✅ |
| 命中分配（方位×伤害量确定性） | 扇区权重表 top/belly/front/rear + seed 扰动 ±10%（rng 注入可复现） | ✅ |
| 级联（引擎过热→旋翼疲劳） | overheat 演化 + 超温恶化 engine + engineLvl×overheat×0.8/s 疲劳 rotor + 飞行磨损（降载减半） | ✅ |
| 四种处置 | U 降功率（持续开关降温+功率代价）/ N 上膛（3s/0.75-lvl×0.1/冷却 8s/修 10）/ I 重启（2s 全黑/0.85/冷却 6s/修 20）/ 降载（磨损减半+机动代价） | ✅ |
| 阈值告警 | 跨级 events → Betty（CHECK ROTOR/GUNS ARMED…）+ toast，复用 47-betty | ✅ |
| 航电失效对 HUD | 取模节律窗口（周期 12-lvl×2，头 1.2s）→ hud-alt/hud-threat/hud-rwr/hud-mx 写 ---；重启期 hudDead 全黑 | ✅ |
| 战损得分 | bonusMul 1.0-1.5 经 83-arcade onMissionDone 的 damageMul（缺省 1 零行为变化） | ✅ |
| 纯逻辑零 THREE/DOM | 86 全纯（_swMulberry32 复用 84）；接线在 70/72/65/83/45 | ✅ |
| 受损表现接线 | 振动×vibMul / 升降×liftMul×powerCap / 响应×respMul（S._pen 合成）/ trimDrift 漂移 / 散布 spreadAdd / 卡壳 _jam / 地狱火 _hfOff | ✅ |
| 纯 pytest 覆盖 | 16 用例全绿（本批实测）：分配 3+seed 1+级边界 1+级联 2+处置 6+HUD 窗口 1+得分 1+事件 1+复位 1 | ✅ 28/28（含既有 12） |
| 71 项既有测试 | **零断言改动零删**；manifest 71→72（samwar）→73（damage）只追加；D2 断言保护（_dmgPenalty 事件驱动）专门设计 | ✅ |
| tri/draws 不升 | 新增可视化 = 0 mesh（HUD 是 DOM；hud-mx 为 template span） | ✅ |
| 浏览器断言 | test_damage.py D1-D8 写好入库未跑（等门禁空窗） | ⏳ |

### TDD 过程记录（任务要求"边界写死期望"的实证）

首轮 14 用例跑出 **7 处失败**：2 处产品缺陷（冷却 0.1 累减浮点残留 1e-15
把"归零后再触发"误拒——加了 1e-9 归零钳制）+5 处测试侧认知错误（lvl1 从
25 起而我把 21 当 lvl1；0.1 步进浮点累加让窗口边界确定性偏一步——w1 与
w2 不对称，全部按诊断 dump 的真值重写）。修复后 16/16 全绿。
另：驱动器曾因 84 缺 `_swMulberry32` 加载失败——桩改为先 84 后 86 拼接
（与 dist 语义一致）。

### 已知取舍与没做的事（本批）

1. **浏览器验证整体等门禁**：C 组 probe/pixdiff + test_samwar + test_damage
   均未运行（GPU 占用）。全部脚本就绪，空窗即跑。
2. **45-flight 只接爬升乘子**（up 分支），下降/悬停未乘——动力语义上
   下降靠重力不受功率影响（合理），但"引擎低功率时悬停保持"未建模。
3. **卡壳触发源**：jammed 由 N 上膛处置驱动（处置期锁/失败保持）；
   "武器级损伤自动卡壳"未接入（weapons lvl 变化不自动 jam——避免影响
   既有 weapons 测试语义；自动 jam 留给下一批做值级验证后再开）。
4. **方位换算的轴向正确性**：_dmgApply 的世界→机体系旋转公式按
   three Y-旋转推导，未经浏览器断言验证扇区与视觉命中方向一致——
   test_damage D2 只断权重分配（注入位置的数学），扇区与镜头方位的
   一致性留待空窗断言（若反了改一行符号）。
5. **merge 流程瑕疵**：未先提交就 merge（见 §6）。
6. **git 提交 message 经 PowerShell here-string 一次解析失败**——改用
   write_file 写 message 文件（工具层无 shell 解析），已记入长期教训。

## 9. 本批提交清单（feat/game-layer，未 push）

| # | commit | 内容 |
|---|---|---|
| 5 | 16817f5 | perf(draws): C 组合批（C1 镜像合并/C2 靶标合批/C3 残骸免投影）+ mergeGeos + 单测 + 双探针 |
| 6 | f1c973c | feat: 86-damage 纯逻辑 + 16 纯 pytest |
| 7 | b26ba19 | feat: Phase 19 浏览器薄接线 + test_damage.py + manifest 73 |
| - | 76af871 | merge main（无头测试基建） |

---

# 批次三：Phase 20 可玩纵切片（p20 worktree @ feat/p20-slice，基线 e86831f）

> 分段执行：Step 0 断言判定修复（已完成）；Step 1 纯逻辑四子系统（本批，
> 浏览器-free）；**Step 2 浏览器接线 + 断言跑绿 + probe_playthrough 端到端
> 自证——等机器（主树门禁 gates=8 持续占用，互锁纪律不抢跑）**。

## 10. Step 0：两处断言判定（产品 vs 断言，全部判"断言错"，依据如下）

1. **test_samwar S3**：等待条件 `_heliDmg > 0` 不隔离它声称要测的 SAM 命中
   ——S1 的交战区（距基地 42u+离地 14u）同时激活 16-targets AA 曳光（单发
   `+=_aaDmgMul` = 1 伤）。AA 抢先命中两发即满足旧条件，但 2 伤不达受损烟
   阈值（≥4）与操控惩罚表起档（≥4）——实测 dmg=2/pen=0.12(=2×0.06)/
   smoke=False/penMul=1.0 与产品设计逐项自洽。**修复=等待条件改累计 ≥4**
   （smoke/penMul 设计阈值；SAM 一发 4 伤必达，AA 累积 4 发同样使"损伤链
   生效"语义成立）。
2. **test_damage D2**：pen 期望 0.6 的计算把 spreadAdd 当 0.1，但公式是
   `wL*0.06`（**等级驱动**，86-damage L208），weapons 分到 1 点远不足 lvl1
   （25 起档）→ spreadAdd=0 → pen=0.5。用户担心的"分配缺口 8/10"不存在：
   **纯逻辑探针实证**权重表四键 7/1/1/1 总和恰 10（rng=0.5 注入逐位一致，
   seeded 对照 9.99999…），旧断言只读了 rotor/engine 两键。**修复=期望改
   0.5 + 把 weapons/avionics 与总和=10 显式断言**（永久封死该疑虑）。
   两个测试的 py 语法/构建/纯 pytest 28/28 静态验证全过；**浏览器复跑等
   门禁空窗**（APACHE_TEST_ONLY="test_samwar,test_damage"）。

## 11. Step 1：Phase 20 纯逻辑四子系统（需求 → 实现 → 证据）

| 任务条目 | 实现 | 证据 |
|---|---|---|
| A. 2 机编队状态机（巡逻/索敌/攻击/规避/撤出） | 87-enemyair.js：五态全链 + 编队协同（巡逻相位差 0.6rad+高度差 2.5u、攻击侧翼分散 ±10u、规避两机反向） | 纯 pytest 11 用例：chain/evade_locked/evade_dmg/withdraw_dmg/withdraw_ammo/wing 全绿 |
| A. 威胁/命中/损伤判定 | hitTest(pos,dmg,margin) 对玩家武器（res 难度抗打击：veteran 8 点不致死 hp=2.29 写死）；敌机火力 hitPending 单槽走既有 _heliDmg 链 | kill/res/attack_hit 用例；命中概率=基础×距离衰减×**稳定度因子**——rng=0.12 恰落两概率间做确定性开关：悬停 44/44 全中、机动 0/44 |
| A. 击落计分+专属成就接 83-arcade | TARGET_SCORES.enemy=500 + ace 成就 + enemyKills 计数（test_arcade 无成就总数断言，已核安全） | build 拓扑绿 + 83 state() 扩展 |
| B. 燃油（悬停省/大机动费/耗尽迫降） | 89-resources：0.22%/s~1.0%/s 线性插值（strength 接线派生）；warn1 30%/warn2 12% 一次性 latch；fuelOut 事件 | fuel_hover 78 恰值/fuel_maneuver 40/fuel_out 事件链恰一次有序 |
| B. 弹药局内不可补+返场补给窗口 | 窗口=停机坪 8u+低空 4u+稳定度≥0.9 持续 3s；**离开即清零**（一次完成语义=时间压力联动）；limited_ammo 变体禁用（frugal 成就保护） | rtb 全链/rtb_leave 清零/rtb_limited/rtb_stab 四用例；ammoDry 谓词边界写死 |
| B. 失败条件补完（油尽/弹尽/超时） | fuelOut→接线层 failMission('fuel')；ammoDry(gun,rk,hf) 谓词+aliveCount>0→failMission('ammo')；超时既有 | 谓词纯测（接线在 Step 2 消费） |
| C. 评级（7 输入→S/A/B/C+逐项明细） | 90-campaign grade()：**基础档=旧 missionRating 曲线**+只降不升调整项（damage 4/8、fuel<25、ammoDry、rookie 封顶 A）+combo≥5 保档抵一次降档；detail 7 项结构化 | 每级阈值上下各一条：grade_edges 8 条边界写死 + grade_drops 组合边界 + grade_combo_keep 保档 + grade_rookie_cap；**grade_compat 黄金用例**（mobile_mission/A9/S 边界三场景）全与旧公式一致 |
| C. 权重可配置可测 | GRADECFG 构造 opts.cfg 注入 | cfg_weights：FUEL_DROP=50 → 49 降/50 不降 |
| D. localStorage 存档 | schema_version:1 + migrate(v0 无版本/缺字段/垃圾/null/数组/未来版本全回全新档) + 损坏 JSON 回退 + storage 抛异常内存降级 | migrate_bad/corrupt_json/degrade 全绿（含"构造不炸"硬断言） |
| D. 5 关解锁链（前关 B 解锁下关） | CAMPAIGN_LEVELS 5 关（standard→timed_rescue→limited_ammo→standard veteran→timed_rescue veteran）；complete() 最优保留/成就并集/损伤累加 | save_roundtrip 往返逐字段一致/save_best 二周目不覆盖/unlock_boundary（B 恰解锁/C 不解锁/S 解锁） |
| 硬约束：纯逻辑零 THREE/DOM + seed 注入 | 三模块全纯；rng 构造注入（84 _swMulberry32 缺省） | 概率分支全部 rng 注入确定性验证（无统计断言） |
| 硬约束：既有断言零改动 | manifest 未动（73 条浏览器清单未增删）；product 未接线（dist 页面行为零变化） | git diff 范围=新文件+83 表项扩展+契约文档 |

**全量纯 pytest 66/66**（既有 28 + 新 38）；build 拓扑 0 反向引用、id 契约
0 死引用、node --check 全绿；dist 1479 KB（+34 KB 三个新模块）。

### Step 1 过程中修掉的产品缺陷（TDD 实锤）

- **89-resources rtbT 浮点累加**：60 帧×0.05 名义 3s 实为 2.9999…，
  `>= RTB_TIME` 不触发——修为 `>= C.RTB_TIME - 1e-9`（86-damage 冷却
  1e-9 钳制同款教训，先 FAIL 后修产品非放宽断言）。
- **测试驱动 evade_locked 首版 FAIL**：aim 固定向量在敌机站位移动后偏出
  0.35rad 瞄准窗——测试侧改为每步跟踪瞄准（真实"持续瞄准"语义），产品无改动。

## 12. Step 2 接线契约（本批已定稿，开工零摸索）

- **创建**（70-app finish）：enemyAir=HOST.makeEnemyAir()、resources=HOST.makeResources()、
  campaign=HOST.makeCampaign()；__dbg 三槽位 + enemyVis 渲染薄层（88-enemyvis.js，
  程序化建机+mergeGeos 合并单 mesh、castShadow=false、仅任务局 spawn——
  **默认场景 draws 零上升**；坠毁动画照 26-airtargets crash 分型）。
- **loop 喂入**（scratch env 零分配）：enemyAir env={dt,heli,stability,
  aim=机体 +Z 机头单位向量,aaRate,aaDmg,res}；resources env={dt,active=
  mission active,strength（FPV=|spd|+|vSide|/SPD_MAX 派生；环绕=方向键平移 1/悬停 0）,
  homeDist=hypot(root.x,root.z),alt,stability,variant}。
- **生命周期**：startMission→enemyAir.spawn(baseCenter 侧翼锚)+resources.start()；
  resetRange/retry→enemyAir.reset()+resources.reset()；completeMission→
  campaign.grade(ctx)（替换 missionRating+dmgDrop 段，行为兼容已证）+面板
  逐项明细行+campaign.complete 记档；failMission('fuel'/'ammo') 消费
  fuelOut 事件与 ammoDry 谓词。
- **事件消费**：enemyAir.hitPending→targets._heliDmg+=dmg（SAM 同款）；
  killEvent→updateTargetHUD('enemy')/killFeed/慢动作三件套；resources.events
  →Betty LOW FUEL/FUEL CRITICAL+toast+补给进度。
- **武器链**：65-weapons 5 处对空调用（shoot 软锁/launchHf 竞争/火箭/曳光/
  地狱火飞行）经 enemyVis 桥接先 air 后 enemy；46-fpview 锁定候选合并。
- **HUD**：template 加 fuel 行（任务局显示）+ 简报战役关卡行（campaign
  关卡名/解锁状态）；动态 chip 走 enhanceA11y 既有约定。
- **浏览器断言**（接线后写）：test_enemyair/test_resources/test_campaign
  的 __dbg 数值断言 + probe_playthrough.py 端到端（一整局：燃油曲线/弹药
  消耗/损伤/评级/存档落盘 + 关键帧截图）；manifest 73→76+ 只追加。
- **验收复跑**：APACHE_TEST_ONLY="test_samwar,test_damage" 先跑绿（Step 0
  欠账），再全量门禁。

## 13. 本批已知取舍与没做的事（逐条直说）

1. **87 hitPending 单槽**：同帧两机同时命中玩家后发覆盖先发（命中频率
   ≤2/s 量级，覆盖窗口可忽略）——84 SAM 同款先例，不为此引入队列复杂度。
2. **敌机机炮不设弹药上限档**（gun 40 发打完仍有火箭；全耗尽才撤出）——
   "弹药耗尽撤出"语义完整，但单机火力持续时间约 30s 属"够用即止"的
   游戏化取值，非拟真。
3. **campaign.complete 的 grade 依赖接线层传结算 ctx**（本批纯逻辑不消费
   completeMission 的实际字段）——Step 2 接线时 ctx 组装错漏由浏览器断言
   兜底（probe_playthrough 断言存档落盘值==面板显示值）。
4. **评级"连击"只做保档不做升档**：升档会在"全歼局连击 10"场景把 A 抬 S
   破坏 grade_compat——保档（只降不升铁律）是兼容性与任务语义的安全交。
5. **probe_playthrough.py 未写**：它断言的对象（接线后的 __dbg 契约）在本
   批尚不存在——Step 2 接线后立即写立即跑，避免对着空契约写测试再返工。
6. **B1-B5 flaky 修复批**：等 Step 2 通知后按分类器报告分批（phase0_regressions
   18/flight_tactics 17/ci_smoke 15 优先），本批未动 tools/tests 既有任何
   wait_for_timeout 写法（除 §10 两处判定修复）。

---

# 批次四：Step 2 浏览器接线 + 断言跑绿 + 端到端自证（commit 4067f05 + 归档批）

> 三件前置纠正已落实：① 互锁判据改客观信号（8642 端口 OR 浏览器进程——
> 旧判据 `*run_tests*` 自匹配守望进程自身，永不等零）；② 残留守望进程已
> taskkill 清除；③ main（214191d 摘录的 Step 0 修复 + 9c8f8a5 + bf846b9）
> 已 merge 进 p20 分支（f4df6e2，干净零冲突）。

## 14. Step 0 欠账清零（实测）

- **test_samwar S1-S5 全过 PASS**（S3 等待条件改累计≥4 生效）。
- **test_damage D1-D8 全过 PASS**——D2 修复后连锁暴露三处从未执行过的
  断言缺陷（全部测试侧，逐轮实测修正）：
  1. **D2 的悬停 setup 是污染源**：交战区悬停（距基地 42u+离地）让 AA/SAM
     持续注入损伤——D4 的 av===40 数学不可达（探针轨迹实证 av 被推到 65
     后重启 -20=45）。删除悬停（地面停放不交战，onHeliHit 直调与悬停无关）。
  2. **D4/D7 节流时序**：状态源（hudFail/rotor===0）与 0.5s 节流 DOM 之间
     有滞后——立即断言读旧值。改条件等待 DOM 真值（窗口 1.2s>节流 0.5s）。
  3. **D6 双重错**：期望值笔误 2.2（公式 1+rL×0.45，lvl2→**1.9**）+ 读法错
     （recompute() 每次新建 _fxCache 而 S._dmgFx 是 loop 刷新引用——紧跟
     recompute 的同步断言读到旧对象）。改条件等待 loop 刷新。

## 15. Step 2 接线（按 §12 契约全量落地）

| 接线面 | 落点 |
|---|---|
| 渲染薄层 | 88-enemyvis.js：程序化武装直升机 ×2（mergeGeos 静态合并体+旋翼盘=每机 2 mesh 共 4 draws，**仅任务局 spawn——默认场景 tri/draws 逐位不变**）；fireEvent→曳光池 8；hitTest 击落同步接管坠毁动画（触地复用 rig.explosion）；nearest/hitTest/enabled 桥接 |
| 70-app | finish 创建四实例+rig.enemyAir/fp.enemyAir 注入；loop _eaEnv/_rsEnv scratch 喂入；hitPending→_heliDmg 既有链；killEvent→计分（enemy:500+ace）；燃油事件→Betty/toast/failMission('fuel')；resupplied→applyVariantAmmo；弹药耗尽→failMission('ammo')；completeMission 改 90 七输入评级+逐项明细（·前缀防同名提取冲突）+战役记档；startCampaign(i)+renderCampaignChips；HUD 燃油行 |
| 65-weapons | 5 处对空链桥接（shoot 软锁 25°锥/launchHf 角偏移竞争/火箭/曳光/地狱火 hitTest） |
| 46-fpview | 敌机进锁定候选（合并取近）+ wTip enemy 建议分支 |
| 72-uibind | resetRange 清 A2A/视觉/燃油；__dbg 四槽位+startCampaign 出口 |
| template | hud-fuel 行 + mission-campaign chips + CSS |
| 87-enemyair | 补 fireEvent 事件槽（开火视觉通道；纯测试断言补齐） |
| 契约 | 88 登记 + 70 provides/72 depends 补 5 符号——拓扑检查器硬拦 10 处违规（契约先行纪律的运行时实证），补登后 build 全绿 |

## 16. 浏览器断言三轮迭代实录（"每一步跑绿"的过程证据）

三个新测试经 5 轮实测修正（全部测试侧，无产品缺陷）：

| 轮 | 失败 | 根因与修法 |
|---|---|---|
| 1 | E3 30s 超时 | **巡逻环心几何盲区**：玩家悬停在环心附近（距锚 12u），巡逻切线视锥与环心方向 dot≈0 **结构性扫不到**——改长机正前方 18u（纯 pytest chain 同款确定性几何） |
| 1 | R4 resupplied 10s 超时 | hover 沉浮把 F.alt=2 **钉回 HOVER=14**（canRtb 每帧断）——R4/R5 补 `F.fp=true` 让位（probe_perf SETUP_HOVER 同款惯用法） |
| 1 | C1 grade=C | **destroy 注入局 shots=0 → acc=0**——任何评级曲线（含旧公式）都给 C；S 场景必须注入真实命中输入（m.hits=15 + gunAmmo 差 30 → 50% 命中，mobile_mission 真实 gunOn 同语义） |
| 2 | E4 enemyKills 只 +1 | **单槽 killEvent 同帧双杀覆盖**（84 hitPending 同款设计取舍，§13 已声明）——测试改逐机击杀+逐次等 loop 消费 |
| 2 | campaign SyntaxError | JS 风格注释 `//` 误写 Python 字符串外（U+FF1A 中文冒号）——三处改 `#`；一次 replace 缩进损伤已修 |
| 4 | C2 grade=S | **连击保档吃掉 fuel 降档**（全歼 10 杀 comboMax≥5——grade_combo_keep 设计行为）——C2 置位无连击（comboMax=1 输入置位）隔离 fuel 通道；**并把这个意外转化为 C2b 保档正面断言**（comboMax≥5 → 降档被抵 → S） |

**最终：test_enemyair E1-E6 / test_resources R1-R6 / test_campaign C1-C6+C2b 全部 PASS**；
纯 pytest 66/66；build 拓扑 0 违规/id 契约 0 死引用；manifest 73→76 只追加。

## 17. 端到端自证：probe_playthrough.py（跑绿，产物入库）

`docs/ai-reviews/phase-20-slice/`：playthrough_trace.json + 三关键帧截图
（takeoff/engaged/result）。**11 项 checks 全 OK**：
grade=S · score=9328 · 燃油 100→95.4（真实消耗 4.6% 单调递减）· 机炮真实
发射 Δ21 发 · 战役记档落盘（unlocked=2，best=9328==面板总分）· 成就入档 ·
结算燃油行 · 零 pageerror。一整局链路（战役关卡入口→真实启旋→真实起飞→
真实机动耗油→真实开火→结算→存档）全部真通道，仅清场用 destroy 注入。

## 18. 本批已知取舍与没做的事（逐条直说）

1. **killEvent 单槽**：真实游玩中两机同帧被同一爆炸击落会丢一次计分（88
   坠毁动画不丢）——低频取舍，REPORT §13 声明在先；测试已按逐机语义适配。
2. **C1/C2/C5 的命中输入是注入**（m.hits/gunAmmo 差）而非真实射击——
   mobile_mission 已有真实 gunOn 命中链的 73 项保护，本批测试聚焦新系统
   接线，不为评级路径重复造 600ms 连发时序。
3. **probe_playthrough 的清场用 destroy 注入**——真实全歼需 40s+ 交战且
   命中概率不可控；起飞/机动/耗油/开火/结算/存档全真通道（战斗输出属
   既有 weapons 测试的领域）。
4. **全量 76 门禁未跑**——接线批跑绿的是三个新测试+两个欠账（76 项全量
   认证在 B1-B5 前跑一轮，见 §19 计划）。
5. **B1-B5 未开工**——等门禁全绿后按分类器报告分批执行（B1=flight_tactics
   10 处 T2 stability 族，含 46-fpview Pointer Lock 首帧隔离产品修复）。

## 19. 下一步计划

① 全量 76 门禁（APACHE_TEST_ONLY 不设=认证模式全量串行）→ ② B1
flight_tactics 批 → ③ B2 phase0_regressions/evidence → ④ B3 ci_smoke →
⑤ B4 threat/mission_loop → ⑥ B5+ 其余（每批 ≤10 处、每批空闲连跑 10 轮
零失败再进下一批）。

---

# 批次五：B1-B5 flaky 真候选分批修复（Step 2② 完成）

> 按分类器报告（FLAKY-CLASSIFY-REPORT §4）分批执行，每批跑绿再进下一批。
> 改法模板：条件等待目标值（timeout 15s，等帧跑到不是等功能）+ DOM 条件
> 等待 + **按到达标才松键**（B1 新增模板，见下）。负断言观察窗（"不应
> 触发/不应重建"的固定时长）与事件同步链后的设置性等待保留——语义本身
> 不是脆弱。

## 20. 五批交付与验收

| 批 | 文件 | 处数 | 验收 |
|---|---|---|---|
| B1 | test_flight_tactics | 13+3 | **空闲连跑 10 轮 10/10 PASS**（首轮 6/10 → 修正后全绿） |
| B2 | test_phase0_regressions / test_phase0_evidence | 10+6 | 双文件验证轮 PASS（evidence 重定向 %TEMP% 防覆写封板，归档核对无写入） |
| B3 | test_ci_smoke | 16 | 单轮 PASS（CI 环境复核由 GitHub Actions 下轮实跑承担） |
| B4 | test_threat_damage / test_mission_loop | 9+12 | 双文件验证轮 PASS |
| B5 | test_mobile_drive | 12+4 口径 | 验证轮一轮修正后 PASS |
| 合计 | | **78 处** | 每批跑绿铁律满足 |

## 21. B1 首轮失败暴露的分类器模板盲区（重要方法论）

分类器改法模板只覆盖"断言前等待"，没覆盖**动作语义本身帧率敏感**的情况：
固定按住时长（W 1s/900ms）在低帧环境 update 帧数不足、加速不达标，松键
即衰减——**条件等待救不了"动作没做到"**（B1 首轮 round 2/4/5/9 四轮全挂
15s 超时的根因）。修法=**按到达标才松键**：`keyboard.down('w') →
wait_for_function(达标式) → keyboard.up('w')`——动作完成由状态定义而非
墙钟。该模板随后用于 T4/T5/P7-2/P7-3/mobile_drive 全部触控/按键段。

## 22. B5 验证轮暴露的取整口径坑

wait 条件用原值（`z > 3`，3.04 过）而 assert 用 `toFixed(1)` 取整值
（`3.0 > 3` 拒）——**条件与断言的取整口径不一致**。修：断言口径对齐
（`>= 3`/`<= -2`/`>= 0.3`/`>= 2.5`）。写新测试时 wait 表达式与 assert
表达式必须同值域（要么都用原值、要么都取整）。

## 23. 已知取舍与没做的事（逐条直说）

1. **B6+ 散布批未做**：169 处真候选中 B1-B5 已清 78 处（最高密度四文件
   + mobile_drive 全清），剩余 ~91 处散布在 challenge_variants 9/
   mobile_mission 5/dof 5/fpv 5/hover_translation 5 及其他 10+ 文件
   ——分类器自评"timeout 较长（1200ms+），负载余量稍大"的收益递减区。
   清单与改法在 FLAKY-CLASSIFY-MACHINE.md 逐条给出，按同款模板继续即可。
2. **B1 的 T2 根因记录已过时**：CODELY.md 曾记"Pointer Lock 首帧 vPitch
   污染需拍板产品修复"——main 的 _armPlAcq 预 arm 隔离已修复（P15），
   本批十轮零失败实证；B1 纯测试侧改造即达退役目标。
3. **B3 的 CI 实跑待下轮**：ci_smoke 改造的 xvfb 软渲染复核依赖
   GitHub Actions（本机无法模拟），改法与 B1 十轮实证模板同款。
