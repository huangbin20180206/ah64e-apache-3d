# CHANGES-upgrade-2026-10-25

**主题**：全库体检发现的第二批问题修复（在 `CHANGES-auditfix-2026-10-25.md` 之后）
**基线**：`5879f5c`（远端 main，**未 push**）
**方案出处**：`docs/UPGRADE-PLAN-2026-10-25.md`
**净改动**：14 个源文件 + 契约文档 + manifest；新增回归守护 23 项

---

## 一、修复清单

| # | 问题 | 严重度 | 状态 | 反向验证 |
|---|---|---|---|---|
| P0-1 | 结算评级 `ammoDry`/`damage` 被行尾注释吞掉，两条评级规则静默失效 | 🔴 | ✅ 已修 | ✅ 回退即变红 |
| P0-2 | 地狱火挂架用完重开任务不可恢复（显示 8 发却打不出去） | 🔴 | ✅ 已修 | ✅ 回退即变红 |
| P1-1 | 单位换算 1u=2m 与 2.27m 混用，HUD 读数互相矛盾 12% | 🟡 | ✅ 已修 | ✅ 回退即变红 |
| P1-2 | `resetRange` 与 `startMission` 清理范围不一致 | 🟡 | ✅ 已修 | ✅ 回退即变红 |
| P1-3 | 画质档 `aniso` 死配置（`particles` 与 `effects` 语义重复） | 🟡 | ✅ 已修 | ✅ 回退即变红 |
| P1-4 | 门禁漏检"引用不存在的全局符号" | 🟡 | ❌ **撤回** | 实测 591 假阳性，见 §7 |
| P1-5 | `_panelShift` 每帧强制重排 | 🟡 | ⏸ 未做 | — |
| P2-1 | 死常量 `MISSION_TIMEOUT` | 🟢 | ✅ 已删 | ✅ 有断言 |
| P2-2 | `_tickPostFx` 返回值注释与代码不符 | 🟢 | ✅ 已订正 | — |
| P2-3 | `damp()` 无 rate 上界守卫（rate≥1 → NaN） | 🟢 | ✅ 已加 | ✅ 回退即变红 |
| P2-4 | `test-manifest.json` 的 `test_desert.pillow` 标记错误 | 🟢 | ✅ 已修 | ✅ 有断言 |

---

## 二、P0-1 · 评级参数被行尾注释吞掉

### 怎么发现的

读 `70-mission.js` 时注意到这行（**逐字复制，注意 `//` 的位置**）：

```js
elapsed: el / ((MISSION_VARIANTS[m.variant] || {}).par || 1), acc: acc / 100, fuelPct,   // P3：长关按 par 折算用时 ammoDry, damage: dmgLv,
comboMax: arcade ? arcade.state().comboMax : 1, difficulty: m.difficulty,
```

`ammoDry, damage: dmgLv,` **在行尾注释里**——不是代码。

**确认链路**（去读消费方 `90-campaign.js:88-96`）：

```js
const dmg = ctx.damage || 0;        // ← 永远 undefined → 0
if (dmg >= C.DMG_T2) drops.push({ item: 'damage', n: 2 });
else if (dmg >= C.DMG_T1) drops.push({ item: 'damage', n: 1 });
if (ctx.ammoDry) drops.push({ item: 'ammoDry', n: 1 });   // ← 永远不成立
```

→ **「机体损伤降档」「弹药耗尽降档」两条规则从未生效**。连带下游 `dmgDrop`
（`70-mission.js:435`，依赖 `gr.drops` 含 `damage` 项）恒为 false，
结算面板那句"（评级-降档）"提示也永远不会出现。

### 怎么改的

把两个键移出注释、独立成行（`70-mission.js:443-452`）：

```js
const gr = campaign ? campaign.grade({
    // P3：长关按 par 折算用时
    elapsed: el / ((MISSION_VARIANTS[m.variant] || {}).par || 1), acc: acc / 100, fuelPct,
    // 审核 2026-10-25 修复：ammoDry / damage 此前被写在上一行的行尾注释里……
    ammoDry, damage: dmgLv,
    comboMax: arcade ? arcade.state().comboMax : 1, difficulty: m.difficulty,
  }) : { ... };
```

### 改完是不是真解决了

- **静态断言**：截取 `campaign.grade({...})` 实参体 → **逐行剥掉行尾注释** → 断言 `ammoDry` 与
  `damage: dmgLv` 仍在（**刻意复刻原 bug 的发现手法**）。
- **双向确认**：同时断言消费方 `90-campaign.js` 真的读 `ctx.damage` / `ctx.ammoDry`。
- **反向验证**：把两个键塞回注释 → `test_grade_receives_ammo_dry_and_damage` 立刻 FAILED。恢复 → 绿。

> 截取实参体时不能用正则非贪婪（实参里有对象字面量 `{...}` 会截断），改用**花括号配对计数**。

---

## 三、P0-2 · 地狱火挂架用完重开任务不可恢复

### 怎么发现的

追 `launchHf()` 的挂架挑选条件（`65-weapons.js:520-528`）：

```js
if (o.visible && !this.launched.has(o)) { node = o; break; }
if (!node) return false;              // ← 找不到可见节点 → 拒绝发射
```

8 发打完后：`hfList` 全部 `visible=false` 且全部进了 `launched`。
`clearTransient()`（`65-weapons.js:692-701`）的注释**明确写着「挂载可见性、launched 集合都不动」**，
所以清理不恢复挂架。再看 `applyVariantAmmo()`（`70-mission.js:284-293`）——**只写数字**：

```js
rig.gunAmmo = GUN.AMMO; rig.rocketAmmo = ROCKET.AMMO; rig.hfAmmo = 8;
```

→ 新任务 `hfAmmo=8`，但挂架全 invisible 且全在 `launched` 里 → **按 F 永远失败**，
且提示"地狱火已打完或未挂载"本身也是错的（明明显示 8 发）。
唯一恢复路径是玩家手动按 `V` 装填（`72-uibind.js:191/448` 调 `rig.reload()`，
**只有 `reload()` 会清 `launched` 并恢复 `visible`**）。

### 怎么改的

改走 `rig.reload()` 通道（`70-mission.js`）：

```js
function applyVariantAmmo() {
  if (!rig) return;
  // 判据 = 挂架里有节点 visible 且不在 launched 中（即"用户没手动关挂载"）
  const mountOn = (() => {
    if (!apache || !apache.hellfire || !apache.hellfire.length) return true;
    for (const o of apache.hellfire) if (o.visible && !rig.launched.has(o)) return true;
    return false;
  })();
  rig.reload(mountOn);                     // 清 launched + 恢复可见性 + 弹药回满
  const m = S._mission;
  if (m && m.variant === 'limited_ammo') {
    rig.gunAmmo = Math.floor(GUN.AMMO / 2);
    rig.rocketAmmo = Math.floor(ROCKET.AMMO / 2);
  }
  S._ga = -1; S._rk = -1; S._ha = -1;
}
```

`apache.hellfire` 与 `rig.hfList` 是**同一批 mesh 的浅拷贝**（`65-weapons.js:82`
`this.hfList = apache.hellfire.slice()`），所以能直接读挂架状态判断"用户是否关掉了地狱火"。

### 改完是不是真解决了

- **静态断言**：`applyVariantAmmo` 必须调 `rig.reload(`；`reload` 必须清 `launched` 且恢复 `visible`；
  另断言 `launchHf` 的挑选条件未变（否则本修复前提不成立）。
- **逻辑仿真**：用 `id()` 模拟 `launched` 集合（dict 不可哈希），跑「8 发打光 → 开新任务 → 再发射」：

  | 路径 | 结果 |
  |---|---|
  | 走 `reload` 通道（修复后） | ✅ 能发射 |
  | 只写 `hfAmmo`（旧行为） | ❌ 打不出去（**反证**：证明这个测试抓得住问题） |

- **反向验证**：`applyVariantAmmo` 改回只写数字 → `test_variant_ammo_goes_through_reload` 立刻 FAILED。

---

## 四、P1-1 · 单位换算统一到 `U2M`

### 怎么发现的

grep `2.27` 发现它散落各处；再 grep `* 2` 形式的换算，发现 **6 处仍在用旧的 1u=2m**：

| 文件:行 | 用途 | 原值 |
|---|---|---|
| `46-fpview.js:243` | 基地距离读数 | `* 2` |
| `46-fpview.js:270-271` | GPWS 离地/崖顶读数 | `* 2` |
| `46-fpview.js:563` | 锁定目标距离 | `* 2` |
| `05-config.js:72/93`、`17-washfx.js:20`、`45-flight.js:8`、`65-weapons.js:77`、`84-samwar.js:37` | 注释 | "1u≈2m" |

**影响**：同一块 HUD 上"离地高度"按 2.27 折算、"到目标距离"按 2 折算——**两把尺子差 12%**。

### 怎么改的

在 `05-config.js` 立唯一常量：

```js
const U2M = 2.27;
const U2M_INV = 1 / U2M;
```

然后全量替换：`46-fpview.js`（6 处）、`70-hud.js`、`18-audio.js`、`48-rescue.js`（6 处）、
`16-targetprops.js`（6 处 `1/2.27` → `U2M_INV`）、`27-life.js`。

**踩到的门禁**：改完构建立刻报 12 条违规——
`[undeclared-dep] … 引用 05-config.js 的 "U2M" 未在契约块 depends 声明` /
`[unlisted-provide] 05-config.js 的 "U2M" … 未出现在契约块 provides`。
**这正是门禁该干的事**。在 `docs/module-contracts.md` 补齐 6 个消费方的 depends 声明与
05-config 的 provides 后转绿。

### 改完是不是真解决了

- **静态断言**：`U2M`/`U2M_INV` 定义存在且形式正确；关键显示路径（46/70-hud/18）确实引用 `U2M`；
  **全库（除 05-config）不得再有 `2.27` 字面量**（剥掉注释后判定）。
- **反向验证**：把 `70-hud.js` 的 `* U2M` 改回 `* 2.27` → `test_no_raw_2_27_literals_outside_comments` 立刻 FAILED。

> 判定"旧的 `* 2`"时不能只匹配 `\*\s*2`——`(PI * 2)` 这类角度运算是合法的。
> 收紧为「与米制读数绑定的行」（含 `" m"` / `m ·` / `dist` / `alt` / `agl` / `rimGap` / `lockD` 等）。

---

## 五、P1-2 · 两条重开路径共用同一份场景清理

### 怎么发现的

对比 `startMission`（`70-mission.js`）与 `resetRange`（`72-uibind.js`）：

| 清理项 | `startMission` | `resetRange`（旧） |
|---|---|---|
| `targets.reset` / `air.reset` / `samwar.reset` / `damageSys.reset` / `enemyAir.reset` | ✅ | ✅ |
| **`scenery.resetTrees`** | ✅ | ❌ 漏 |
| **`infantry.reset`** | ✅ | ❌ 漏 |
| **`life.reset`** | ✅ | ❌ 漏 |
| **`resetNightOps`** | ✅ | ❌ 漏 |

**影响**：点"重置靶场"后，上一局炸倒的树、死亡/开火中的步兵、打光的照明弹**原地残留**。
按钮叫"重置"却只重置了一半。

### 怎么改的

把清理逻辑抽成 `resetScenarioState()`（`70-mission.js`），注册到 `HOST.resetScenario`；
`startMission` 与 `resetRange` 都改调它（`resetRange` 保留兜底分支防宿主槽位未注册）。

### 改完是不是真解决了

- **静态断言**（4 项）：公共函数存在且已注册到 `HOST`；**四项曾漏掉的清理必须在函数体内**；
  `startMission` 必须调它；`resetRange` 必须走 `HOST.resetScenario`。
- **反向验证**：`resetRange` 改回只调 `targets.reset()` → `test_reset_range_uses_host_slot` 立刻 FAILED。

---

## 六、P1-3 · `aniso` 真接入（**这里我修正了自己最初的判断**）

### 怎么发现的 —— 以及为什么结论要改

初判（体检报告）：`QUALITY_PRESETS` 里的 `particles` / `aniso` 都是"定义了但零消费"的死配置。

**动手前我核了一遍消费链，发现结论只对一半**：

```
applyQuality (70-app.js:176)
  → washfx.setQualityEffects(P.effects)          ← 用的是 effects，不是 particles
    → 28-washfx.js:49-55
      → parts/grass/sprayFx/debris/duneSand.setQuality(scale)
        → 17-washfx.js:266-269  _applyCount() → instanceCount
        → 21-washground.js:76-80  _activeMax  ← 真实收口粒子活跃上限
        → 23-washmedia.js:249     instanceCount
```

**所以 `particles` 想要的"降粒子量"效果其实已经通过 `effects` 实现了**——
`particles` 是个**语义重复、无人认领的字段**。

而 **`aniso` 才是真·死配置**：`P.aniso` 从未下发给任何贴图，各贴图硬编码
`anisotropy = 8`（`06-paint.js:93` / `60-model.js:195,524` / `31-scenery.js:482`，
树贴图是 4），`4/6/16` 三个值从未被读过。

> **为什么要专门写这段**：如果按原计划"把 `particles` 也接进去"，会变成
> **`effects` 与 `particles` 两套系数叠乘**，低画质档粒子量被压两次——**修 bug 修出新问题**。
> 体检结论必须复核实据，不能直接当施工图。

### 怎么改的

1. **删除 `particles` 字段**（与 `effects` 语义重复）。
2. **`aniso` 真接入**：`05-config.js` 新增 `applySceneAniso(renderer, scene, aniso)`——
   遍历场景给所有带 map 的材质贴图设置各向异性，**按 GPU 上限钳制**
   （`renderer.capabilities.getMaxAnisotropy()`），幂等可重复调用；`applyQuality` 里下发。
3. 订正 `05-config.js` 关于两字段的注释。

### 改完是不是真解决了

- **静态断言**（3 项）：`applyQuality` 确实调 `applySceneAniso`；`applySceneAniso` 存在且含
  `getMaxAnisotropy` 钳制与 `traverse` 遍历；**`QUALITY_PRESETS` 里不得再出现 `particles`**，且 `effects` 必须保留。
- **反向验证**：删掉 `applyQuality` 里的调用 → `test_aniso_is_actually_applied` 立刻 FAILED。

> 遗留：`aniso` 生效的**视觉差异需要目视确认**。静态断言只能证明"下发了"，不能证明"看起来对了"。

---

## 七、P1-4 · 门禁检查 —— ❌ 我实测后撤回了

这条要说清楚，因为它是个**反向结论**。

**原判**：`tools/check_topology.mjs:323-324` 的 `if (!target || target === pf.file) continue;`
会跳过"不属于任何文件"的引用名，于是手滑的全局名躲过全部静态检查。建议加 `undefined-global` 规则。

**我写了个探针脚本统计，然后发现路走不通**：

- 全库共有 **591 个**"不属于任何 src/app 文件声明"的引用名。
- 里面混着：真浏览器/three 全局（`Math` 69 处 / `THREE` 44 / `document` 35）**+ 大量明显是
  局部变量的名字**（`a` / `c` / `x` / `dt` / `i` / `dx` …）。
- 后者的规模说明：**tokenizer 在"单文件作用域分析"上有大量假阳性**——它没正确登记
  解构赋值（`const {a,b} = obj`）、`for (const [x,y] of z)`、回调形参等形态。

**结论（与原判相反）**：不是"该补检查"，而是**当前 tokenizer 精度不足以支撑这个检查**。
硬加会炸出几百条假违规、门禁报废。

**改为待办**：前置条件是先给 `check_topology.mjs` 的作用域分析补上解构/for-of/形参登记，
再引入白名单（浏览器 + three 全局表）。**本轮不做**——动它会牵动现有 730 条边的判定。

> 顺带一个好数据：`node tools/check_topology.mjs --dump` 显示
> **符号级边 730 条（合法正向 490 / 反向违规 0）**、文件级依赖边 275 条。
> 反向违规 0 说明现有契约纪律守得很好。

---

## 八、P2 批（纯清理）

| 项 | 改法 |
|---|---|
| `MISSION_TIMEOUT`（`70-mission.js:20`） | 删除（零引用；实际超时走 `MISSION_VARIANTS[].timeout`），留注释防止有人改回来 |
| `_tickPostFx` 返回值注释（`70-hud.js:96`） | 订正为如实描述——`70-loop` 调用处**丢弃返回值**，慢动作缩放在帧首完成 |
| `damp()` 守卫（`00-utils.js`） | `clamp(rate, 0, 0.999)`——rate≥1 会得负底数的非整数次幂 = NaN。**此前只靠注释口头约定** |
| `test-manifest.json` | `test_desert` 的 `pillow` 由 `true` 改 `false`（该测试不 import PIL） |

**`damp` 的仿真验证**：越界 rate（1.0 / 1.5 / 5.0 / -1.0）不再产生 NaN；
正常区间（0.05/0.10/0.22/0.30）结果**逐位不变**（确保修 bug 没改动既有调参手感）。

---

## 九、验证记录（全部真实执行）

```
全量纯逻辑测试：135 passed in 7.93s
  ├─ 既有 97 项 —— 无回归
  ├─ 第一批修复守护 15 项（test_audit_2026_10_25_fixes.py）
  └─ 本批修复守护 23 项（test_audit_2026_10_25_upgrade.py）

反向验证（逐个回退修复，确认测试变红，再恢复）：
  P0-1 回退 → test_grade_receives_ammo_dry_and_damage          FAILED ✅
  P0-2 回退 → test_variant_ammo_goes_through_reload            FAILED ✅
  P1-1 回退 → test_no_raw_2_27_literals_outside_comments       FAILED ✅
  P1-2 回退 → test_reset_range_uses_host_slot                  FAILED ✅
  P1-3 回退 → test_aniso_is_actually_applied                   FAILED ✅
  P2-3 回退 → test_damp_guards_rate                            FAILED ✅

构建：node build.mjs → 通过（拓扑无反向引用，id 契约 195/170，死引用 0）
      bundle_sha256 …→ 12fc1781…（改动确实进了产物）
      dist/index.html 2124 KB（+4 KB）
语法：node --check dist/app-check.mjs → Exit 0
门禁：多次捕获到"契约未声明"违规并据此补齐（说明门禁在真实起作用）

未执行（需你的环境）：
  · 有头浏览器回归（会抢鼠标焦点）
  · aniso 生效的目视确认
  · 结算评级的实际观感（打得差时该降档了没有）
  · 地狱火挂架在真实游戏里的恢复（仿真已过，实机待验）
```

---

## 十、过程中的两次失误（记档，避免重犯）

1. **反向验证时用 `git checkout` 恢复文件 → 丢了未提交的改动**。
   我的所有改动都在工作树、从未 commit，`git checkout src/app/70-app.js` 把文件退回了
   `5879f5c` 的状态，`applySceneAniso` 调用消失（后已重新加回，并确认最终只有 1 处、无重复）。
   **规则：反向验证期间用文件备份（`cp`）恢复，绝不用 `git checkout`。**

2. **改完 `70-app.js` 后重复插入了一行**（脚本幂等性不足），导致 `applySceneAniso` 出现两次。
   `grep -c` 发现并去重。**规则：批量脚本改完必须 grep 计数确认，不能只看"脚本没报错"。**
