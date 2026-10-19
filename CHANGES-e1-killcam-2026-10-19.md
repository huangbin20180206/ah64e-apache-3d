# E1 击毁特写镜头 + 慢动作修复（2026-10-19）

## 内容
- 新增 `src/app/70-killcam.js`：游戏模式任务进行中击毁车辆（坦克/卡车类，不含油桶）时，镜头切到目标侧面低机位，绕爆炸点缓慢环绕并轻微推近（约 29°），上下黑边 + 右下角“击毁特写 · 按任意键跳过”，同时对焦爆炸点。
  - 时长：普通 1.6s（真实时间）；最后一个目标 2.4s。
  - 频率：最后一个目标必触发；其余至少间隔 14s，连锁殉爆不触发。
  - 任意键/点击（开始 0.25s 后）提前跳过；特写期间隐藏 HUD、任务面板、准星。
  - 只覆盖本帧相机位姿，不改 orbit/FPView 状态；结束后自动回到原视角，FOV 还原。
  - 关闭：`localStorage.ah64_killcam = '0'`。
- 修复：原“击毁慢动作”的时间缩放在帧末才乘到 dt，只影响 HUD，世界并没有变慢。现在帧首缩放整帧模拟（×0.25）；FPS 读数/自动降档改用真实时钟，慢动作期间不误判。
- webdriver（自动化测试）下特写与世界慢动作均不生效，旧测试时间推进不变。

## 改动文件
- 新增 70-killcam.js；70-app.js（updateTargetHUD 调 killcamTry）；70-loop.js（帧首慢动作、相机后 killcamUpdate、_tickPostFx 不再乘 dt、_tickHud 用 rawDt）；70-hud.js（特写景深分支）；docs/module-contracts.md（契约同步）。

## 状态
- 代码已入 src；构建通过（Exit 0，dist/index.html 2016 KB，+5 KB；74 个模块；bundle_sha256 8cfa4081ce162c1a0ab6444f55d56426587424ea2df08d2a0b87f84c1398aa51）。
- tests_pure 91 passed；DOM ID 检查通过；拓扑自测 8/8。
- 截图验证：/workspace/work/cmp/vis/shot_kc.py（特写开始→环绕→结束后 FOV 34 还原）。
- 全量回归未跑（非大版本）。
