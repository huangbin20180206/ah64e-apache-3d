# 升级方案与计划 · 2026-10-25

> 前置：本轮先完成了「另一个 AI 第二轮改动」的审核（`AUDIT-ai-round-2026-10-24.md`）与 4 个 bug 修复
> （`CHANGES-auditfix-2026-10-25.md`）。本文是**在此基础上的一次全库体检 + 升级计划**。
>
> 体检范围：`src/app/*.js`（76 文件 / 23864 行）、`build.mjs`、`tools/`、`src/template.html`
> 所有结论均带 `文件:行号` 证据，并对**最严重的两条做了人工复核**。

---

> ## 📌 执行结果（2026-10-25 同日完成）
>
> 全部实施完毕，详见 **`CHANGES-upgrade-2026-10-25.md`**（含"怎么发现/怎么改/是否真解决"）。
>
> | 项 | 状态 |
> |---|---|
> | 🔴 P0-1 评级参数被注释吞掉 | ✅ 已修（反向验证通过） |
> | 🔴 P0-2 地狱火挂架不可恢复 | ✅ 已修（仿真：旧路径打不出去/新路径可发射） |
> | 🟡 P1-1 单位换算统一 U2M | ✅ 已修（全库无 2.27 字面量残留） |
> | 🟡 P1-2 重置语义统一 | ✅ 已修（抽 resetScenarioState 共用） |
> | 🟡 P1-3 aniso 真接入 | ✅ 已修（**并修正了我最初的误判**：particles 效果已由 effects 实现） |
> | 🟡 P1-4 门禁 undefined-global | ❌ **撤回**（实测 591 假阳性，前置需先升级 tokenizer） |
> | 🟡 P1-5 `_panelShift` 降频 | ⏸ 未做 |
> | 🟢 P2 批（4 项清理） | ✅ 全做 |
>
> 回归守护：`tools/tests_pure/test_audit_2026_10_25_upgrade.py`（23 项）
> 全量测试：**135 passed**（97 既有 + 15 第一批 + 23 本批）
> 六个修复逐个通过反向验证（回退即变红）。

## 〇、先说结论：这次最值得干的三件事

| 优先级 | 事项 | 为什么 |
|---|---|---|
| **P0** | 结算评级参数被行尾注释吞掉（`70-mission.js:431`） | **真 bug，且是"沉默降级"**——玩家打得再好/再差，都少一项评级考量 |
| **P0** | 地狱火挂架用完重开任务不可恢复（`65-weapons.js` + `70-mission.js`） | **真 bug**——第二局 HUD 显示 8 发却打不出去，且提示误导 |
| **P1** | 单位换算 1u=2m 与 2.27m 混用（≥6 处） | 同一块 HUD 上"高度"与"距离"读数互相矛盾，差 12% |

其余 7 条按档次排后面。**我会先做 P0，再做 P1，P2 视时间。**

---

## 一、问题清单（分级）

### 🔴 P0-1 · 结算评级参数被行尾注释吞掉

**证据**（`src/app/70-mission.js:430-432`，逐字复制）：

```js
const gr = campaign ? campaign.grade({
    elapsed: el / ((MISSION_VARIANTS[m.variant] || {}).par || 1), acc: acc / 100, fuelPct,   // P3：长关按 par 折算用时 ammoDry, damage: dmgLv,
    comboMax: arcade ? arcade.state().comboMax : 1, difficulty: m.difficulty,
  }) : { grade: missionRating(el, acc / 100), drops: [], kept: null, detail: [] };
```

注意第 431 行：`// P3：长关按 par 折算用时` 之后的 **`ammoDry, damage: dmgLv,` 整段被 `//` 吃掉了**——
它在**行尾注释里**，不是代码。看起来像"有人把参数写在了注释后面"。

**消费方**（`src/app/90-campaign.js:88-96`）：

```js
const dmg = ctx.damage || 0;        // ← 永远拿到 undefined → 0
if (dmg >= C.DMG_T2) drops.push({ item: 'damage', n: 2 });
else if (dmg >= C.DMG_T1) drops.push({ item: 'damage', n: 1 });
if ((ctx.fuelPct == null ? 100 : ctx.fuelPct) < C.FUEL_DROP) drops.push({ item: 'fuel', n: 1 });
if (ctx.ammoDry) drops.push({ item: 'ammoDry', n: 1 });   // ← 永远拿到 undefined → 不降档
```

**影响（说人话）**：战役模式的结算评级里，**"机体损伤"和"弹药打光"这两项降档条件完全失效**。
玩家把飞机打成筛子、把弹药打光，评级照旧给高分。这不是崩溃，是**规则静默失效**——比崩溃更阴，
因为没人会发现，直到有人觉得"评级怎么这么松"。

**注意**：`dmgDrop` 变量（`70-mission.js:433`）依赖 `gr.drops` 里有没有 `damage` 项，
所以它也恒为 false——**连带第二个功能也失效了**。

**修法**（1 行）：
```js
    elapsed: el / ((MISSION_VARIANTS[m.variant] || {}).par || 1), acc: acc / 100, fuelPct,
    ammoDry, damage: dmgLv,   // ← 移出注释，独立成行
```

**反向验证**：写测试断言 `campaign.grade` 的调用参数对象里包含 `damage` 与 `ammoDry` 键。

---

### 🔴 P0-2 · 地狱火挂架用完重开任务不可恢复

**证据链**：

1. 发射时挑选可见且在架节点（`src/app/65-weapons.js:522-528`）：
```js
for (let i = 0; i < this.hfList.length; i++) {
  const o = this.hfList[(this._hfIdx ?? 0) % this.hfList.length];
  this._hfIdx = (this._hfIdx ?? 0) + 1;
  if (o.visible && !this.launched.has(o)) { node = o; break; }
}
if (!node) return false;              // ← 找不到可见节点 → 拒绝发射
```
2. 8 发打完后，`hfList` 全部 `visible=false` 且全部进 `launched` 集合。
3. `clearTransient()`（`65-weapons.js:692-701`）**明确不动** `launched` 与挂架可见性（注释自述：
   "弹药、扳机、挂载可见性、launched 集合都不动"）。
4. `startMission` 走 `applyVariantAmmo()`（`70-mission.js:285-287`），**只写数字**：
```js
rig.gunAmmo = GUN.AMMO; rig.rocketAmmo = ROCKET.AMMO; rig.hfAmmo = 8;
```
5. 于是新任务 `hfAmmo=8`，但 `hfList` 全 invisible + 全在 `launched` → `launchHf()` 返回 false。
6. 唯一恢复路径是玩家手动按 `V` / 点装填（`72-uibind.js:191/448` 调 `rig.reload(...)`
   —— 只有 `reload()` 会清 `launched` 并恢复 `visible`）。

**影响（说人话）**：打完一局（把 8 发地狱火用光）后开第二局，HUD 显示地狱火 8 发，
**按 F 永远提示"地狱火已打完或未挂载"**——主力反坦克武器直接失效，而且提示是错的（明明显示 8 发）。
玩家只能自己猜到要按 V 装填。

**修法**（推荐）：把 `applyVariantAmmo()` 里的三行赋值改成走 `rig.reload()` 通道，
保留变体减半逻辑：

```js
function applyVariantAmmo() {
  if (!rig) return;
  // 走 reload 通道：不只恢复数字，还要清 launched 集合并恢复挂架可见性
  // （旧实现只写 hfAmmo=8，挂架仍 invisible/在 launched 里 → launchHf 永远 false）
  const mountOn = apache ? apache.hellfireVisible !== false : true;
  rig.reload(true);   // 挂架先全部挂上，再按变体裁剪
  const m = S._mission;
  if (m && m.variant === 'limited_ammo') {
    rig.gunAmmo = Math.floor(GUN.AMMO / 2);
    rig.rocketAmmo = Math.floor(ROCKET.AMMO / 2);
  }
  S._ga = -1; S._rk = -1; S._ha = -1;
}
```

> ⚠️ 上面 `apache.hellfireVisible` 是我编的——`60-model.js` 的 `setWeapons` 直接操作 DOM 节点，
> 不复读状态。**实施时要先确认"用户关掉了地狱火挂载"这个状态能否被读到**；
> 读不到就简单点：`rig.reload(true)` 后由 `72-uibind` 的 `wp()` 在下次开关变化时纠正。
> **这一条要按实际代码定，不能照抄我的草稿。**

**反向验证**：纯逻辑仿真——模拟"8 发打光 → 调 applyVariantAmmo → 断言 `launchHf()` 能成功"。

---

### 🟡 P1-1 · 单位换算 1u=2m 与 1u=2.27m 混用

**证据**：

| 用 **2.27**（正确） | 用 **2**（过时） |
|---|---|
| `70-hud.js:185` `FLY.alt * 2.27` | `46-fpview.js:243` `Math.hypot(dx,dz) * 2`（基地距离） |
| `46-fpview.js:470-471` `this.spd * 2.27 * 3.6` / `FLY.alt * 2.27` | `46-fpview.js:270-271` `p.rimGap * 2` / `p.agl * 2`（GPWS） |
| `48-rescue.js:76` | `46-fpview.js:563` `lockD * 2`（锁定距离） |
| `05-config.js:54/107`、`18-audio.js:410` | `17-washfx.js:20`、`45-flight.js:8`、`65-weapons.js:77`（注释） |
| `16-targetmodels.js`（全套）、`16-targetprops.js`、`27-life.js` | `84-samwar.js:37`（注释） |

**影响（说人话）**：同一块 HUD 上，**"离地高度"按 2.27 折算，"到目标距离"按 2 折算**——
两个读数的物理基准不一致，差 12%。玩家看到"离地 14m"和"目标 13m"，其实不是同一把尺子量出来的。
这不是崩溃，是**数据自相矛盾**。

**修法**：抽常量 `U2M = 2.27` 到 `05-config.js`，全量替换那 6 处计算 + 修正过时注释。

**验证**：构建通过 + 静态断言"不再存在 `* 2` 形式的单位换算"。

---

### 🟡 P1-2 · `resetRange` 与 `startMission` 清理范围不一致

**证据**：
- `startMission`（`70-mission.js:712-717`）会复位：`scenery.resetTrees()` / `infantry.reset()` /
  `life.reset()` / `resetNightOps()`
- `resetRange`（`72-uibind.js:203-220`）**没有**这四项

**影响（说人话）**：点"重置靶场"后，上一局炸倒的树、死亡/开火中的步兵、打光的照明弹**原地留着**。
按钮叫"重置"，实际只重置了一半——与 `startMission` 的行为不一致，用户会困惑。

**修法**：抽 `_resetScenario()` 公共函数，两条路径都调用。

---

### 🟡 P1-3 · 画质档的 `particles` / `aniso` 是死配置 —— ⚠️ 复核后修正结论

**原判**（体检报告）：`05-config.js:74-77` 定义的 `particles` / `aniso` 全库零消费。

**复核后的事实**（我逐行读了消费链，结论要修正）：

- **`particles` 的"性能效果"其实已经生效了**，只是走的不是这个名字：
  `applyQuality`（`70-app.js:176`）→ `washfx.setQualityEffects(P.effects)` →
  `28-washfx.js:49-55` → 逐个 `parts/grass/sprayFx/debris/duneSand.setQuality(scale)` →
  各实现真实收口粒子活跃上限（如 `17-washfx.js:266-269` 用 `_applyCount()` 调 `instanceCount`、
  `21-washground.js:76-80` 压 `_activeMax`、`23-washmedia.js:249` 调 `instanceCount`）。
  **所以低画质档确实降了粒子量**——用的是 `effects` 这个系数，`particles` 是个**重复定义、无人认领的字段**。

- **`aniso` 才是真·死配置**：`P.aniso` 从未下发给任何贴图。
  各贴图在创建时硬编码各向异性（且多档位都是 8），`aniso: 4/6/16` 三个值从未被读过。

- 同时 `05-config.js:72` 的注释把两个字段都写成"已生效"，与事实不符。

**修正后的修法**（比原计划更精准）：
1. **删掉 `particles` 字段**（与 `effects` 语义重复，留着只会误导后来者以为要改它）。
2. **`aniso` 真接入**：在 `applyQuality` 里下发到场景主要贴图（地面/树/模型），
   让 `4/6/8/16` 真正生效；或在无法统一下发时删除字段并订正注释。
3. 订正 `05-config.js:72` 的注释，如实描述"粒子量由 `effects` 控制"。

> **为什么要写这一段**：我一开始采纳了体检报告"两个都是死配置"的说法，
> 准备照搬去改。动手前核了一遍消费链，发现 `particles` 的效果**已经通过 `effects` 实现了**——
> 如果按原计划"把 particles 接进去"，会变成**两套系数叠乘**，低画质档粒子量被压两次，
> 反而引入新问题。**这说明体检结论必须复核，不能直接当施工图用。**

---

### 🟡 P1-4 · 门禁漏检"引用不存在的全局符号" —— ❌ **实测后撤回，改为条待办**

**原判**（体检报告）：`tools/check_topology.mjs:323-324` 的
`if (!target || target === pf.file) continue;` 会跳过"不属于任何文件"的引用名，
于是手滑的全局名（`sclae()`）躲过全部静态检查。

**我按这个思路动手了，然后发现路走不通。** 实测（写了探针脚本统计）：

- 全库共有 **591 个**"不属于任何 src/app 文件声明"的引用名。
- 里面混着三类：① 真浏览器/three 全局（`Math`(69 处) / `document`(35) / `THREE`(44)）——
  这些该进白名单；② **大量明显是局部变量的名字**（`a` / `c` / `x` / `dt` / `i` / `dx` …）——
  这些**本来就不该出现在这个名单里**；③ 真正值得查的可疑名。
- 第 ② 类的规模说明：**`check_topology.mjs` 的 tokenizer 在"单文件作用域分析"上有大量假阳性**——
  它没正确登记解构赋值（`const {a, b} = obj`）、`for (const [x, y] of z)`、
  回调形参等形态，于是把它们当成了"外部引用"。

**结论（与原判相反）**：不是"该补一个 `undefined-global` 检查"，
而是**当前 tokenizer 的精度不足以支撑这个检查**。硬加只会炸出几百条假违规，门禁报废。

**改为待办**：若要落地这个检查，前置条件是先给 `check_topology.mjs` 的作用域分析补上
解构/for-of/形参的登记，再引入白名单（浏览器 + three 全局表）。
**本轮不做**——这是个独立议题，动它会牵动现有 730 条边的判定，风险大于收益。

> 顺带一个好数据：`node tools/check_topology.mjs --dump` 显示
> **符号级边 730 条（合法正向 490 / 反向违规 0）**、文件级依赖边 275 条。
> 反向违规 0 说明现有契约纪律守得很好。

---

### 🟡 P1-5 · 每帧强制重排：`_panelShift`

**证据**：`70-loop.js:388` 在 `_frame` 内**每帧无节流**调 `_panelShift(rawDt)`；函数体
（`70-loop.js:48-58`）每帧 `getElementById` ×2 + 面板可见时 `getBoundingClientRect()`（强制同步布局）。

**影响（说人话）**：每帧一次强制重排，是掉帧来源之一。展示模式下尤其浪费。

**修法**：缓存 DOM 引用与 rect（按 resize / 面板开合事件失效），或把该逻辑降到 10Hz。

---

### 🟢 P2-1 · 死代码

- `70-mission.js:20` `MISSION_TIMEOUT = 360` —— 零引用（实际超时走 `MISSION_VARIANTS[].timeout`），
  维护者会误以为改这里有效
- `00-utils.js:8/16/31/32` `invLerp` / `easeOut` / `rsign` / `rpick` —— 零引用
- `70-app.js:55` `_qAuto` —— 只写不读

**修法**：删除，或接入。

---

### 🟢 P2-2 · 注释与代码不符

- `70-hud.js:96` 注释称"调用方 `dt *= 返回值`"，而唯一调用方 `70-loop.js:395` **丢弃返回值**
- `run_tests.ps1:82/365` 注释写"71 条全绿"，实际 manifest 已 **93 条**
- `test_campaign.py:22`"73 项保护"、`test_damage.py:127`"76 项测试" —— 均过时

**修法**：改注释或删具体数字（改为动态读 manifest 计数）。

---

### 🟢 P2-3 · `damp()` 无 rate 上界守卫

**证据**：`00-utils.js:18` `const damp = (rate, dt) => 1 - Math.pow(1 - rate, dt * 60);`
注释在 `70-loop.js:153-154` 明确警告"传 ≥1 会得负底数的非整数幂 = NaN"，但**无任何守卫**。

**修法**：`const damp = (rate, dt) => 1 - Math.pow(1 - clamp(rate, 0, 0.999), dt * 60);`

---

### 🟢 P2-4 · `test-manifest.json` 标记错误

`test_desert` 标 `pillow: true`，但 `tools/tests/test_desert.py` 不 import PIL。

**修法**：改 `false`。

---

## 二、实施计划

### 阶段 1（P0，本轮必做）

| # | 事项 | 文件 | 验证 |
|---|---|---|---|
| 1.1 | 修 `ammoDry, damage: dmgLv` 被注释吞掉 | `70-mission.js:431` | 静态断言 + 反向验证 |
| 1.2 | 修地狱火挂架不可恢复 | `70-mission.js` `applyVariantAmmo` | 逻辑仿真 + 反向验证 |

### 阶段 2（P1，本轮做）

| # | 事项 | 状态 | 验证 |
|---|---|---|---|
| 2.1 | 抽 `U2M = 2.27` 全量替换 | ✅ 完成 | 构建 + 门禁（契约补声明） |
| 2.2 | 抽 `_resetScenario()` 统一两条重置路径 | ✅ 完成 | 构建 + 门禁 |
| 2.3 | `aniso` 真接入 + 删 `particles` 冗余字段 | ✅ 完成 | 构建 + 门禁 |
| 2.4 | 门禁补 `undefined-global` 检查 | ❌ **撤回** | 实测 591 假阳性 → 前置需先升级 tokenizer，见 P1-4 |
| 2.5 | `_panelShift` 降频/缓存 | ⏸ 未做 | — |

### 阶段 3（P2，有空做）

死代码清理 / 注释订正 / `damp` 守卫 / manifest 标记。

---

## 三、明确不做的事（以及为什么）

| 事项 | 为什么不做 |
|---|---|
| 给 68 处 `addEventListener` 补 `removeEventListener` | 单页应用无"重开页面"路径，**当前零风险**，加了反而是无意义改动（违反"精准修改"） |
| `26-airtargets.js:312` 每帧 `new THREE.Color` | 只在热气球燃烧期触发、对象极小，**收益低于改动风险** |
| `16-targets.js:568` 等 `reduce` 扫描粒子池 | 112 个元素、0.22 秒一次，**不构成瓶颈** |
| 重构 `70-mission.js`（987 行）拆文件 | **收益是"好看"，风险是动到核心结算流程**。本轮不做，留作独立议题 |
| 改 `_turretAir` 方位角 | **需有头目视验证才能判断对错**，盲改可能越改越错 |

---

## 四、需要你拍板的两件事（我无法替你决定）

1. **P1-3 选 A 还是 B**：真接入 `aniso`/`particles`（改动涉及贴图与粒子池，有回归风险）
   还是删掉字段（干净但"少了个可调项"）？**我倾向 A**——既然画质档已经存在，让它名副其实。
2. **P1-2 的 `resetRange` 语义**：它是否**故意**不重置步兵/树/照明弹？
   （"重置靶场"只想清靶车，不想动战场环境？）如果是故意的，那就该**改文档说明**而不是改代码。

---

_计划制定：2026-10-25 · 体检方法：全库 Explore 扫描 + 关键结论人工复核_
