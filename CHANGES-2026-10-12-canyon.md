# 玩法批 D：峡谷突防（2026-10-12）

入口：任务模式 → 开始任务 → 简报里选「峡谷突防」（第 7 个变体）。时限 480s。

## 玩法
- 出生点南侧多了一片台地（高 10u，约 20m），一条约 155u 长的蜿蜒峡谷把它切开。选中这个变体后，直升机停在峡谷南端的谷底，从这里出发。
- 谷底有 6 辆伏兵（卡车 3、坦克 3），完成条件是打掉这 6 辆加上基地的 10 个目标（共 16 个）。
- 岩壁会挡视线：弯道后面的车锁不上，它也不会向你开火。峡谷里只有 30u 内、看得见你的车会开火。
- 崖顶雷达：只要还有雷达站活着，飞到崖顶以上（y > 8.5u）暴露度就会上涨，2.5s 满格，之后每 2.4s 挨一发。贴着谷底飞就不会暴露。两座崖顶雷达站用机炮（9 发）、火箭（2 发）都能打掉，全部打掉后暴露解除。
- 地形碰撞：机体不会钻进岩体，落在台地上就算着陆。旋翼盘（半径 3u）一碰岩壁就退回上一帧位置，扣 0.6 结构伤害，有 1s 冷却，并伴随震屏和提示。第一人称下碰壁会把速度反弹回去。
- 高度：峡谷里悬停高度从 14 降到 4.5（崖顶以下）。环绕模式下新增 PageUp/PageDown 调高度（只在峡谷局生效）。第一人称照旧用 R 升、Q 降。
- 弹丸打进岩体会被吃掉：不计命中率，也不亮命中标记。火箭和地狱火会在岩面上爆炸。
- HUD：屏幕上方中间有一条雷达暴露条，旁边显示剩余雷达数。任务面板里显示「崖顶雷达站 x/2」和「岩壁擦碰 n 次」。
- 峡谷局里远景沙丘环自动隐藏，换回其他变体后恢复。出生点到基地方向（z>-11）保持平地，其他变体完全不受影响。

## 代码
- 新增 `src/app/16-valley.js`（`CanyonRun`）。`heightAt` 是唯一的高度来源，网格、碰撞、视线和弹丸吸收都用它。地形网格 240×112，顶点色按高度分出岩层。
- `16-targets.js`：给 `this.canyon` 加了鸭子类型钩子，覆盖 nearestAhead 遮挡、hitTest（雷达站/岩体）、splash、reset、update；AA 在峡谷区改由峡谷伏兵开火，命中率 25%。canyon 为 null 或未激活时全部短路。
- `65-weapons.js`：打到岩壁不亮命中标记。
- `70-app.js`：构造 CanyonRun；变体派生（setActive、悬停高度、出生点、远景沙丘）；在写 root.position 之前做碰撞；雷达锁定命中接到 P8 损伤链，并乘上难度系数；新增 HUD、简报、任务面板。
- `template.html`：新增 `#canyon-hud` 及其样式。
- `docs/module-contracts.md`：登记 16-valley 的契约，以及 70-app 对它的依赖。

## 测试
- 新增 `tools/tests/test_canyon.py`（manifest 现在 84 项）：覆盖 D0 变体切换和出生点、D1 地形、D2 碰撞、D3 视线和岩体吸收、D4 雷达暴露和致盲、D5 reset、D6 撤场。
- test_town、test_challenge_variants、test_air_superiority 的变体 chip 数从 6 改为 7。
- 沙盒结果：build、node --check、check_dom_ids、topology selftest 8/8、tests_pure 71 passed、test_canyon PASS、test_town PASS、test_gameplay_b PASS。
- test_challenge_variants、test_air_superiority 依赖实时 rAF，在沙盒里跑不了，请在本机跑：
  `$env:GATE_EXPECT_SHA = git rev-parse HEAD; powershell -File tools/run_tests.ps1`
