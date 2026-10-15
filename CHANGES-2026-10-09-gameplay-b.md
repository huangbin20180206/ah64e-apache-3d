# 玩法批 B：战场活起来 + 打击感（2026-10-09）

用法：解压到仓库根目录覆盖，`node build.mjs`。只看代码：`code.patch`。

## B1 连锁殉爆 / 溅射（16-targets.js）
- 油桶殉爆从单槽 `_fuelBoom` 改为队列 `_fuelBooms`（旧实现同帧多桶会互相覆盖）。
- 每次殉爆波及 4.2u（威力 2.5，按距离衰减，边缘保底 40%）→ 油料区一发入魂、整片连锁。
- 地狱火直接命中后近炸溅射 2.8u（威力 1.5）。
- 新增 `TargetRange.splash(x, z, R, power, exclude)`；溅射**不计命中率**（不触发 onHitFx）。
- 连锁击毁打 `_chain` 标记，击杀流显示橙色“✹ 连锁殉爆”。

## B2 基地警报 + 车辆疏散（16-targets.js / 70-app.js）
- 仅任务进行中触发：基地首次受创 1.6s 后拉响警报（展示/训练模式靶场保持静态，既有用例零变化）。
- 静止卡车按由东到西的顺序间隔 1.1s 发车，驶上环绕基地的疏散环路（加速→匀速，拐点阻尼转向），车尾扬尘。
- 环路避开防空车、探照灯、坦克掩体、折返坦克扫掠区，全程在远景沙丘平地走廊内（方位角 <0.62）。
- 扬尘与爆炸共用 48 格 puff 池：空闲 <24 格时扬尘让路，不和爆炸抢粒子。
- 警报时 toast 提示，敌方 AA 立即开火一次（冷却压到 ≤0.6s）。
- `reset()` 解除警报，疏散车辆归位，原巡逻目标（circle/line）保留。

## B3 多杀播报 + 终结镜头（70-app.js / template.html）
- 2.2s 窗口内连续击毁：屏幕上方弹出“双杀 / 三杀 / 四杀 / 暴风扫荡”横幅（新 DOM `#streak`，支持 reduced-motion）。
- 任务局击毁最后一个地面目标：慢动作 0.55s→1.3s，白闪/震屏加重。

## 测试
- 新增 `tools/tests/test_gameplay_b.py`（已入 manifest，共 82 项）。时间推进全走 `targets.update(dt)` 手动步进，与帧率无关，SwiftShader 下也能确定性复现。
- 本地沙盒（Linux arm64 + Chromium 154 + SwiftShader）：test_gameplay_b / test_campaign / test_arcade / test_arcade_settle 通过。
- test_targets_mov / test_mission 等依赖实时 rAF 的用例在沙盒里失败，但**原版代码同样失败、失败信息完全一致**，属于环境问题。全量门禁仍以本机 `tools/run_tests.ps1` 为准。
- build / node --check / check_dom_ids / topology selftest 8/8 / tests_pure 71/71 通过。
