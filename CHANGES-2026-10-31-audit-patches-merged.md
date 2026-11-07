# 变更记录：审计 15 项修补合流与全套功能整合（2026-10-31）

> 关联任务：将交付包 `ah64e-modified-src.zip`（含交接文档 `ah64e-handover-2026-10-30.md`）中的 15 项核心修补，与本地已实现的「全关卡战术目标导览 + 基地起飞进场运镜 + FPV 锁敌增强」进行无缝合流。

---

## 一、合流与修补清单

### 1. 致命级问题修复合入
- **无尽模式波次推进清场崩溃修复**（`70-mission.js`）：将 `arcade.addScore` 替换为 `arcade.addBonus`（Patch 1）。
- **无尽模式只清地面误判任务完成修复**（`70-mission.js`）：全歼分支排除 `air_superiority` 与 `endless`（Patch 3）。
- **敌机带伤撤离后波次永久卡死修复**（`70-mission.js`）：`_airWaveCleared(countWithdrawn)` 在 endless 下传 `true`，敌机耗尽弹药撤离出界（`phase: withdraw`）亦算波次肃清，并广播提示「敌机弹药耗尽已脱离交战区」，波次顺畅推进且新波重置满血（Patch 4）。
- **无尽模式波次装甲缩放生效**（`70-mission.js`）：将死代码 `t.hpMax` 修正为以真实血量字段 `t.hp0` 进行波次加成（Patch 6）。

### 2. 高危与中危逻辑修复合入
- **胜负判断双重结算风险与逻辑孤立**（`70-mission.js`）：超时/损毁/弹药耗尽判断从 else-if 链尾拆成独立块，增加 `S._mission.phase === 'active'` 相位守卫（Patch 5）。
- **敌机命中率随距离反向增大纠正**（`87-enemyair.js`）：原式修正为距离衰减 `1 - 0.5 * Math.min(1, dist / C.P_DIST0)`，测试驱动稳定性单测阈值同步标定为 0.185（Patch 7）。
- **FPV 退出视角瞬间砸地修复**（`46-fpview.js`）：退出时将 `FLY.userAlt` 置为 `null`（解除接管），彻底消除爬升悬停时高度被重置为 0 的问题（Patch 8）。
- **键位冲突解决**（`46-fpview.js` / `72-uibind.js`）：FPV 侧飞右键改用 `E`（`Z/E` 侧飞），释放 `X` 给火箭发射；飞行过程中按 `A` 键增加待机守卫，不再误弹出成就面板（Patch 9）。
- **过场跳过在部分 WebView 下捕获异常修复**（`78-cinematic.js`）：对 `new Error().stack` 增加空值守卫，防止因 stack 为 undefined 导致键盘鼠标输入被永久拦截（Patch 10）。
- **知识卡原色高光污染与 360 环视按钮失真修复**（`70-appmode.js`）：首次将原色存入 `__kcOrig` 防高光残留；重新进入时同步 `orbit.auto` 状态（Patch 11）。
- **无尽模式中"下一关"残留与跳关修复**（`70-play.js` / `70-mission.js`）：无尽模式与重试时调用 `syncPlayActions()`，增加 `_missionBusy()` 守卫（Patch 12）。

### 3. 性能优化与包体瘦身合入
- **后处理渲染目标无用深度通道摘除**（`40-post.js`）：mips 模糊链、godRT、dofRT 均改为 `depthBuffer: false`，大幅减少显存与带宽消耗（Patch 13）。
- **HUD 热路径零分配**（`70-hud.js` / `82-cutscene.js` / `86-damage.js` / `89-resources.js`）：全面使用 `isOn()`、`fx()`、`levels()` 与 `fast()` 持久缓存通道（Patch 13）。
- **错误提示遮罩补「重新载入」按钮**（`src/template.html`）（Patch 14）。
- **死素材移除**：彻底删除零引用的 `plane.glb` 与 `palm_tree.glb`，产物瘦身约 980KB（Patch 15）。

### 4. 完整保留的本地全新特性
- **全关卡开场战术目标特写导览**（`Objective Tour`）：所有战役与训练关卡在开场时平滑运镜掠视每个任务目标，展示战术铭牌、代号与任务说明。
- **导览结束交互弹窗**：提供【↺ 再看一次 (R)】与【▶ 开始任务 (空格/Enter)】按键交互，支持全程 `Esc` 一键跳过。
- **基地起飞与高速低空掠地转场进场**（`Transit Ingress`）：点击开始后直升机从后方基地离地起飞，经过 2 段高速掠地与战术掠景运镜抵达战区防区外（AO）平稳交接操作。
- **空中无人机/靶机命中容差与火花黑烟反馈**（`26-airtargets.js` / `65-weapons.js`）：机炮/火箭攻击空中小靶机时具备有效命中容差，并伴随真实弹着火花与黑烟拖尾，击毁时凌空爆破解体。
- **平显分级瞄准锁敌框**（`46-fpview.js` / `template.html`）：32° 火控锥内显示实线绿色锁敌框并触发蜂鸣锁定音；32° 外显示黄色虚线并提示「转向捕获 / 未锁定」。
- **地面/过场期间战斗安全门控**（`70-combat.js` / `87-enemyair.js`）：停机坪待机与过场期间敌机保持高空巡逻，不主动攻击、不开火、不耗弹。

---

## 二、门禁验证汇总

1. `node build.mjs`：
   - 模板 ID：210 个 / 代码引用：183 个 / 死引用：0。
   - 产物：`dist/index.html` 2175 KB，资源清单 targets 为 60 个 glb。
2. `node --check dist/app-check.mjs`：通过，0 语法警告。
3. `node tools/check_topology_selftest.mjs`：8/8 通过。
4. `node tools/check_undefined_selftest.mjs`：7/7 通过。
5. `node tools/check_dom_ids.mjs`：通过。
6. `node tools/check_topology.mjs`：733 条跨文件依赖全部合规，0 违规。
7. `tools/tests_pure/` 驱动单测：73/73 全部通过，0 失败。
8. 预览服务：已通过非沙盒模式在 `http://localhost:8642` 启动并成功验证 HTTP 200。
