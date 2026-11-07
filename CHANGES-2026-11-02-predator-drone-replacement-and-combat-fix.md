# 变更记录：MQ-1 捕食者开源 3D 模型替换与空战打击链路全贯通

日期：2026-11-02
状态：已完成，全门禁（构建/拓扑/语法/CDP实测/截图留档）全绿通过

---

## 1. 背景与问题描述

- **用户反馈**：
  在战役关卡（如 `2-1 · 初次出击`）中，天空中有两架飞机一直在基地上空环形盘旋，不仅打不掉、打不到（子弹与导弹穿透、血量不扣、雷达无法有效识别），而且机身还是粗糙的几何柱体/方块拼接。
- **根因分析**：
  1. `src/app/81-narrative.js` 中的两架巡逻机（`narrative.patrol`）最初仅作为“纯环境叙事”背景存在，机身由 `vcKit` 几何图元拼接而成。
  2. `81-narrative.js` 的 `this.strikes` 打击层仅登记了雷达站、防空车、弹药库，**未包含 `patrol` 巡逻机**。
  3. `hitTest` 未包含对巡逻机的距离判定，也未暴露 `nearest` 火控接口；
  4. 武器系统（`65-weapons.js`）的机炮自动对空（`_turretAir`）与地狱火导弹空战锁定、第一人称火控 HUD（`46-fpview.js`）均未接入巡逻机，导致全武器无法锁定、穿透不伤、永远打不掉。

---

## 2. 解决方案与修改落地

### 2.1 免费开源高质量 3D 模型替换
- 引入开源飞行仿真项目的标准 glTF 2.0 格式高精度 3D 资产：`assets/targets/mq1_predator.glb`（7.05MB）。
- 在 `81-narrative.js` 中通过 `THREE.GLTFLoader` 异步载入，将模型规范化至约 4.6u 翼展（与 12u 巡逻高度尺度真实匹配），并开启投射阴影。
- 载入成功后挂载至巡逻机节点，并隐藏旧的几何体图元，实现无缝升级。

### 2.2 打击判定与战斗生命周期闭环
- **战斗属性注入**：巡逻机对象赋予 `id: 'patrol-0'/'patrol-1'`, `label: 'MQ-1 察打无人机'`, `type: 'plane'`, `hp: 2`, `hp0: 2`, `radius: 1.8`, `pos`, `crashed`, `vy`, `vr`。
- **碰撞受击判定**：`81-narrative.js` 的 `hitTest(worldPos, power)` 接入巡逻机命中测试。受击时触发机身闪白，血量归零时触发 `_destroyPatrol`：
  - 凌空产生黄色高亮爆风与粒子碎片；
  - 生产击杀事件 `killEvent = { key: p.id, type: 'plane', label: p.label, x, z }`，交由主循环派发计分与结算；
  - 机身进入下坠翻滚状态（`vy = -0.5`, `vr = 1.8`），拖曳浓烈黑烟，触地后触发二次爆炸并在地面留下残骸。
- **火控检索接口**：`81-narrative.js` 实现 `nearest(from, dir, coneDeg)` 方法，支持视锥角与距离最近威胁解算。
- **状态复位**：`resetStrikes()` 中重置巡逻机的生命值、物理状态、可见度与位置。

### 2.3 火控系统与 HUD 雷达全链路接入
- **`src/app/65-weapons.js`**：
  - 机炮对空软锁（`_turretAir`）接入 `this.narrative.nearest`，准星扫过时炮管自动抬角对准巡逻机；
  - 地狱火空对空锁定竞争中接入 `this.narrative.nearest`，允许锁定并引导打击巡逻机。
- **`src/app/46-fpview.js` & `src/app/70-start.js`**：
  - 第一人称火控（`updateLockHud`）接入 `narrative.nearest`，准星对准时显示空对空绿色瞄准方框与实时测距。
- **`src/app/70-hud.js`**：
  - 长弓 AN/APG-78 毫米波雷达（`#tac-radar`）实时标绘存活的巡逻机，并在状态栏更新威胁计数与 12 点钟时钟方位测距。

### 2.4 架构规范与契约维护
- **`docs/module-contracts.md`**：在 `81-narrative.js` 契约中声明对 `00-utils.js` 的 `DEG` 依赖，确保单向引用拓扑合规。
- **构建同步**：同步复制 `assets/targets/mq1_predator.glb` 至 `dist/assets/targets/`，并在 `build.mjs` 打包流中确保 61 个 target glb 完整集成。

---

## 3. 门禁验证结果

1. **`node build.mjs`**：通过（无反向引用，契约声明完备，233 UI id 0 死引用，dist 单文件 2240KB 打包成功）。
2. **`node --check dist/app-check.mjs`**：语法体检通过，0 错误。
3. **`node tools/check_topology.mjs`**：743 条跨文件依赖边 0 违规。
4. **`node tools/check_dom_ids.mjs`**：DOM ID 引用 100% 匹配。
5. **真实 Chrome CDP 自动化验证（`scratch/test_patrol_drone.mjs`）**：
   - 关卡 2-1 启动成功（`ok: true, mode: 'mission'`）；
   - MQ-1 模型异步加载就绪（`_hasGlb === true`）；
   - 机炮第 1 发命中：`hpAfter1: 0.82`；
   - 机炮第 2 发命中：`aliveAfter2: false, crashedAfter2: true`；
   - 击毁事件产出：`killEvent: { key: 'patrol-0', type: 'plane', label: 'MQ-1 察打无人机' }`；
   - 雷达威胁实时刷新；
   - 运行时捕获异常数：0。
6. **视觉验收截图留档**：
   - `shot_predator_patrol.png`：MQ-1 捕食者无人机真实 3D 外观与双机编队巡航近景。
   - `shot_patrol_destroyed.png`：巡逻机击落瞬间，顶部横幅显示 `已摧毁: MQ-1 察打无人机`，右上角角标打勾，战术雷达威胁数自 12 降至 11。
