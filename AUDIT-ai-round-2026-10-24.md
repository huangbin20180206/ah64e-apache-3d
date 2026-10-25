# 代码审核报告 · 另一个 AI 的第二轮改动（roundA/B/C + phys + sfx + asset）

> ## 🔧 修复状态（2026-10-25 追加）
>
> 本报告的 4 个 bug 已于同日**全部修复并通过反向验证**（逐个回退确认测试变红）。
> 详见 **`CHANGES-auditfix-2026-10-25.md`**（含"怎么发现 / 怎么改 / 改完是否真解决"的完整记录）。
>
> | 问题 | 状态 | 验证 |
> |---|---|---|
> | 🔴 BUG-1 FPV 倾斜残留 | ✅ 已修 | 反向验证通过 + 数值仿真（6.9° → 0.5s 内 0.29°） |
> | 🔴 BUG-2 分享卡复制必失败 | ✅ 已修 | 反向验证通过；**真实点击待你有头实测** |
> | 🟡 BUG-3 compileAsync 白等 12 秒 | ✅ 已修 | 反向验证通过（省 9 秒 + 约 900 次轮询） |
> | 🟡 4.2 `_tmByUrl` 永久缓存 null | ✅ 已修 | 反向验证通过 |
> | 🟡 BUG-4 `_turretAir` 方位角 | ⏸ **未改**（需目视验证，见正文） |
>
> 回归守护：`tools/tests_pure/test_audit_2026_10_25_fixes.py`（15 项）
> 全量测试：112 passed（97 既有 + 15 新增）

- **审核对象**：GitHub `huangbin20180206/ah64e-apache-3d` 远端 main
- **基线**：本地 `1956a64`（2026-10-20）
- **审核目标**：`5879f5c`（2026-10-24），远端领先 **13 个提交**
- **改动规模**：113 个文件 / +1096 −156 行（其中 65 个 `.glb` 为二进制资产，代码约 20 个 JS + 3 个工具脚本 + 2 个测试）
- **审核方式**：只读审查（git diff + 逐文件精读），未修改任何被审代码
- **审核日期**：2026-10-25

---

## 一、总体结论

**结论：整体质量中上，方向正确，可以合入；但有 2 个必须先修的问题，另有 5 处需要评估。**

这轮改动的主线是把"玩具感"往"真实感"推：统一真实重力、弹速按实弹量级、
声音按距离衰减、地面加细节纹理、首屏加载优化、新手按键图。**方向是对的，代码组织也守住了这个仓库的架构纪律**
（低编号不直接引用高编号模块，通过 `HOST.*` 挂载点通信；新增的 `73-keycard.js` 命名编号也守规矩）。

但有几个地方是"想当然"式的实现，**测试全绿也测不出来**——因为 97 项纯逻辑测试没有一条覆盖这些路径。

### 验证记录（真实执行结果）

| 项目 | 命令 | 结果 |
|---|---|---|
| 构建 | `node build.mjs` | ✅ 通过。死引用 0，id 契约 195/170 干净，产物 2114 KB |
| 语法体检 | `node --check dist/app-check.mjs` | ✅ Exit 0 |
| 纯逻辑测试 | `pytest tools/tests_pure/ -q` | ✅ **97 passed in 18.12s** |
| 浏览器回归 | （未跑） | ⏸ 需 GPU 有头环境，会抢鼠标焦点，待你点头 |
| buildId | — | `git_sha=5879f5c...` / `bundle_sha256=3db8f645...` |

> 说明：`tools/tests_pure` 是纯逻辑无头测试，能全绿说明**纯算法层没退化**，
> 但下面 4 个 bug 全部位于"渲染时序 / 状态耦合 / 浏览器 API 边界"，属于测试盲区。

---

## 二、Bug 清单（按严重度）

### 🔴 BUG-1 · `S._leanP/_leanR` 在 FPV 模式下残留，机体姿态会短暂歪掉

**位置**：`src/app/46-fpview.js:413-414`（写入） × `src/app/70-loop.js:177-187`（复位）

**证据链**：

```js
// 46-fpview.js —— 每帧都写，无论什么模式
S_._leanP = (S_._leanP || 0) + (clamp(aF * 0.012, -0.12, 0.12) - (S_._leanP || 0)) * kL;
S_._leanR = (S_._leanR || 0) + (clamp(-aS * 0.012, -0.12, 0.12) - (S_._leanR || 0)) * kL;

// 70-loop.js —— 复位逻辑被整个包在"非 FPV"条件里
if ((!fp || !fp.active) && S.running && FLY.state !== 'ground') {
  ...
  S._leanP = lerp(S._leanP || 0, 0, damp(0.10, dt));   // ← 只有非 FPV 才执行
  S._leanR = lerp(S._leanR || 0, 0, damp(0.10, dt));
}
// 而姿态叠加是无条件的：
apache.root.rotation.x = FLY.pitch + rx + (S._leanP || 0);
apache.root.rotation.z = FLY.roll + rz + (S._leanR || 0) + (S._bankR || 0);
```

**后果（说人话）**：进第一人称（C 键）飞行时，`46-fpview` 会按加速度写倾斜值来模拟"低头加速 / 压坡度"。
这本来没问题——它自己会收敛回 0。但**从 FPV 切回环绕视角的瞬间**，那个残留值不会被清理，
直接叠到机体姿态上，党群最多歪 0.12 rad（≈**6.9°**）。然后自然衰减掉。

**实际影响**：轻微，但是可见的"切换视角时机身抽一下"。方向性上属于状态耦合设计不洁。

**建议修法**（2 行）：
```js
// 70-loop.js，姿态叠加前无条件收敛一下 FPV 写入的倾斜槽
if (fp && fp.active) { /* 46-fpview 自己管 */ }
else { S._leanP = lerp(S._leanP || 0, 0, damp(0.10, dt)); S._leanR = lerp(S._leanR || 0, 0, damp(0.10, dt)); }
```
或者更干净：把 `_leanP/_leanR` 的**所有权明确给一个模式**，另一个只读不写。

---

### 🔴 BUG-2 · 分享卡的"复制图片"在 Chrome 上必然失败

**位置**：`src/app/70-mission.js:529`

```js
const cpBtn = mk('复制战绩图', () => { draw().toBlob(async b => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); cpBtn.textContent = '已复制'; }
  catch (e) { cpBtn.textContent = '复制不了，请用保存'; }
}); });
```

**问题**：`navigator.clipboard.write()` 带图片时，要求**剪贴板写入处于用户手势的同步调用栈内**。
这里 `await` 了一下 `toBlob` 的**异步回调**（`toBlob` 本身是异步的，回调跑在另一个微/宏任务里），
已经脱离手势上下文 → Chrome 抛 `NotAllowedError: Document is not focused` 或直接拒绝。

**"但代码里有 try/catch，不会崩啊"** ——对，不会崩。但**这个按钮点了永远只会显示"复制不了，请用保存"**，
等于一个摆设。而你自己在 `CHANGES-roundC-2026-10-23.md` 里写的是"可复制/保存图片"。

**建议修法**（3 个选项，按推荐排序）：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | 把 canvas 预先画好（复用同一个离屏 canvas，不每次 `toBlob`），点击时**同步** `canvas.toBlob` → 不行，`toBlob` 天生异步。**改用 `toDataURL` + `fetch` 转 Blob** 仍是异步。真正可行的是：**预先在页面加载/结算时就把 Blob 备好**，点击时直接 `clipboard.write([new ClipboardItem({'image/png': readyBlob})])` | 需要提前生成，多一次 canvas 绘制 |
| **B** | 只保留"保存战绩图"（下载），删掉复制按钮 | 少一个功能，但 100% 可用 |
| **C** | 保留按钮，但文案改成"复制（需浏览器支持）"，并明确提示失败原因 | 用户仍会点，体验差 |

**我的判断**：如果"复制"是为了发到聊天软件，方案 A 值得做；否则**方案 B 最省事**——
`download` 出来的 PNG 拖进微信/QQ 一样能发。

---

### 🟡 BUG-3 · `compileAsync` 失败时仍要干等满 12 秒

**位置**：`src/app/70-start.js:255-266`

```js
let _go = false;
const _start = () => { if (_go) return; _go = true; requestAnimationFrame(loop); ... };
setTimeout(_start, 12000);                                    // 兜底
try {
  if (renderer.compileAsync) renderer.compileAsync(W.scene, W.camera).then(_start, _start);
  else _start();
} catch (e) { _start(); }
```

**我查了 three 源码**（本项目用的是 **r160**，`src/three.module.min.js`），`compileAsync` 的实现是：

```js
compileAsync = function(t, e, n = null) {
  const i = this.compile(t, e, n);
  return new Promise((e) => {
    function n() {
      i.forEach((t) => { et.get(t).currentProgram.isReady() && i.delete(t) });
      0 !== i.size ? setTimeout(n, 10) : e(t);      // ← 每 10ms 轮询，永不 reject、无超时
    }
    null !== J.get('KHR_parallel_shader_compile') ? n() : setTimeout(n, 10)
  })
};
```

**关键点**：如果驱动不支持 `KHR_parallel_shader_compile`，或者某些 program 因为某种原因**永远不就绪**
（软渲染 SwiftShader、某些老 Intel 驱动是典型场景），这个 Promise **永远不 resolve、也永远不 reject**。
`setTimeout(_start, 12000)` 兜底确实救了命——**不会卡死**。但代价是：

1. 白白多等满 **12 秒**（而不是判定"编译没戏了，赶紧开画"）
2. 这 12 秒里 `setTimeout(n, 10)` **每秒跑 100 次轮询**，每次都遍历整个 program 集合 → 白白烧 CPU
3. 加载条一直显示"准备画面…"，**用户不知道是在编译还是卡死了**

**建议修法**：加一个短的探测超时（比如 3 秒），到点直接 `_start()`，别等满 12 秒：

```js
let _go = false;
const _start = () => { if (_go) return; _go = true; requestAnimationFrame(loop); ... };
const _again = setTimeout(_start, 12000);
const _probe = setTimeout(_start, 3000);   // 新增：3 秒还没编完就先开画
// 成功路径：
try {
  if (renderer.compileAsync) renderer.compileAsync(W.scene, W.camera).then(
    () => { clearTimeout(_probe); _start(); },
    () => { clearTimeout(_probe); _start(); });
  else _start();
} catch (e) { _start(); }
```

> ⚠️ 注意：真要减少软渲染下的等待，得先确认 `renderer.compile`（同步版）在目标机器上的实际耗时。
> 我这次**没跑有头测试**，所以"12 秒"是代码注释里写的软渲染实测值，不是我这轮跑出来的。

---

### 🟡 BUG-4 · `_turretAir` 的 `az` 计算把 `x/z` 当成"相对机头"，但 `worldToLocal` 后的轴序需要核实

**位置**：`src/app/65-weapons.js:442-455`

```js
const v = _W_TUR.copy(t.pos);
root.worldToLocal(v);
const m = _W_TUR2.copy(this.muzzle);
v.sub(m);
const h = Math.hypot(v.x, v.z), d = v.length();
const el = Math.atan2(v.y, h) * 57.2958, az = Math.atan2(v.x, v.z) * 57.2958;
if (Math.abs(az) > 86 || el > 11 || el < -60 || d > 150) continue;
```

**疑点**：`az = atan2(x, z)` 假设**机体坐标系里机头指向 +Z**（因为 z 分量作为"正前方"）。
注释里写的"方位 ±86°"和 M230 的真实射界（±86°/±100°，不同型号）对得上，说明作者**是知道机头是 +Z 的**。

**但**：这段代码只在 `HOST.S.app === 'show'`（展示模式）下走。我**没有真跑展示模式验证**，
所以这条我**只能标为"待验证"而非"确认的 bug"**。请在有头环境里用这个命令核一下：

```js
// 展示模式，飞机停在地面，机头朝 +Z，把一个无人机放在机头正右方（x>0）
// 期望：az ≈ +90° 时应该打不到（超过 86°）；放在 (0, 高, 50) 应该能打到（el 小）
__dbg.S.app        // 期望 'show'
__dbg.rig._turretAir({...})   // 传个假 from 看返回
```

**我的判断**：逻辑大概率是对的（`atan2(x,z)` 配 `+Z` 机头是标准写法），
但**"±86° 在游戏里对应的视觉方位"和玩家直觉是否一致，需要目视确认**——
特别是"下俯 60° 能打到底下的无人机"这条，是改动的核心卖点，**值得专门验一次**。

---

## 三、需要注意但不算 bug 的 5 处

### 3.1 `_KC_MAP` 里 `b` 键标注为"重来"，但第一屏卡片上会误导新手

`73-keycard.js` 把 `b` 标成 `['cam', '重来']`。实际实现（`72-uibind.js:467`）是
"游戏关卡里 B = 重打本关"。**功能没错**，但一个第一次玩的人看到键盘上 `B` 下写着"重来"，
**很可能在没搞清怎么起飞之前就按了**——然后关卡重载，他更懵。

**建议**：第一屏卡片上**不要高亮 `b`**（或者把文字改成"重开本关"并放到最不显眼的位置）。

### 3.2 `keycardGoal` 的 `innerHTML` 用法有个隐患（当前无害）

```js
box.querySelector('.kc-goal').innerHTML = '目标：<b></b>';
box.querySelector('.kc-goal b').textContent = keycardGoal(L) || '清掉全部目标';
```

这里 `innerHTML` 只用了**静态字符串字面量**，目标文本走的是 `textContent`，**当前没有 XSS 风险**。
但如果以后有人图省事改成 `innerHTML = '目标：<b>' + keycardGoal(L) + '</b>'`，关卡表里的
label 就直接进 DOM 了。**建议现在就在注释里钉一句"目标文本必须走 textContent"**。

### 3.3 `73-keycard.js` 吞事件用的是 `pointerdown` 捕获 + `stopImmediatePropagation`

卡片打开时用一个**全局捕获阶段**的 `keydown`/`pointerdown` 处理器，`preventDefault` +
`stopImmediatePropagation` 掉第一下输入。这个做法**意图正确**（避免"关卡片那一下同时启动旋翼"），
但要注意：它把**所有** pointerdown 都吞了，包括**移动端的触摸**。

代码里用 `matchMedia('(pointer:coarse)')` 挡掉了触屏自动弹出——**所以移动端不会遇到**。
但如果哪天移动端也要弹卡片，这段会连带吞掉摇杆输入。**留个注释钉住这个前提**。

### 3.4 `18-audio.js` 的 `_playSfxAt` 有 12 秒的 `setTimeout` 清理

```js
setTimeout(() => { try { gd.disconnect(); gw.disconnect(); lp.disconnect(); } catch (e) {} }, 12000);
```

每个远距离音效都挂一个 12 秒定时器。**密集交火 + 大量爆炸**时，这些定时器会堆积
（虽然每个只占很少内存，且 12 秒后自动清）。当前规模下**不是问题**，
但如果以后爆炸频率再翻几倍，建议改成"用引用计数 / 到点由音效自身生命周期回收"。

### 3.5 `build.mjs` 的下载队列 `_GQ.MAX = 4` 是硬编码

```js
const _GQ = { open: false, active: 0, q: [], MAX: 4 };
```

"最多 4 个同时下载"是个经验值。**在慢速网络（4G / 弱 WiFi）上，4 并发可能仍然拖慢首屏**；
在千兆网内又浪费。**建议**：按 `navigator.connection.effectiveType` 或至少 `deviceMemory` 分档，
或者干脆**从 4 降到 6**——HTTP/1.1 的浏览器默认并发上限是 6，卡在 4 也吃不满。

> 顺带：`build.mjs` 里这段队列逻辑是**以字符串拼接形式注入到 loaderJs** 的，
> 变量名 `_GQ`/`_gqPump` 前缀下划线避免污染——这个做法对，但**注入的字符串没有语法检查**。
> `node --check dist/app-check.mjs` 能覆盖到（因为它检查整个 bundle），算是门禁兜住了。

---

## 四、结构与效率优化建议

### 4.1 重力常量 `G_U` 的位置（小问题，但值得提）

`G_U = 4.32`（真实 9.8 m/s² ÷ 2.27 m/u）定义在 `05-config.js`，这个位置**是对的**。
但 `phys1` 同时在 `65-weapons.js` 里**硬编码了另一批物理量**：
`355`（机炮初速）、`160`（火箭 VMAX）、`150`（地狱火巡航）、`1.4`（尾烟间距）、`1.5`（分段步长）。

**这些数字全部在注释里标注了真实来源**（M230 805m/s、Hydra 739m/s、AGM-114 425m/s），
**注释质量很好**。但散落在函数体里，**调参时要满文件找**。

**建议**：抽成一个 `PHYS = { GUN_V: 355, ROCKET_VMAX: 160, HF_CRUISE: 150, SUBSTEP: 1.5, SMOKE_STEP: 1.4 }`
放在 `05-config.js` 的 `G_U` 旁边。**收益**：①改弹速不用翻武器文件 ②单元测试可以直接 import 断言数值

### 4.2 `16-targetmodels.js` 的懒加载改造——这轮最漂亮的改动

```js
const _tmByUrl = {};
function _loadTargetModel(key) {
  if (!_tmByUrl[def.url]) { ... _tmByUrl[def.url] = new Promise(...); }
  return _tmByUrl[def.url];      // 同一 url 只下载一次
}
```

**按 url 去重 + Promise 缓存 + `priority` 插队**——三件事一起做对了。
比旧版"启动时 10 个载具全部并发拉取"好太多。

**唯一可改进**：`_tmByUrl` 是**永不过期的**。如果某个模型加载失败（`res(null)`），
那个 `null` 会被**永久缓存**——后续所有请求都拿到 `null`，**再也没有重试机会**。

**建议**：失败时不缓存（或缓存一个可重试的标记）：
```js
_tmByUrl[def.url] = new Promise((res) => L.load(def.url,
  (gltf) => { ...; res(m); },
  undefined,
  () => { delete _tmByUrl[def.url]; res(null); }   // ← 失败则删缓存，允许下次重试
));
```

> 这不一定是 bug（首次失败后场景里那个目标就是缺模型，重试大概率也失败），
> 但**"永久缓存 null"是个容易被忽略的语义陷阱**，值得钉一下。

### 4.3 `70-mission.js` 的分享卡代码 30 行挤在 `completeMission` 里

`completeMission()` 本身已经很长了，又塞进 30 行 canvas 绘图 + 按钮 + 事件。
**建议**抽成 `73-scorecard.js`（编号正好空着），导出 `HOST.drawScoreCard(card)` 和
`HOST.mountShareButtons(el, card)`。

**收益**：①`completeMission` 回归"结算流程"单一职责 ②canvas 绘制可以单独测
③符合这个仓库"低编号模块通过 HOST 挂载点通信"的既有架构

### 4.4 效率：`_turretAir` 每发机炮都遍历全部空中目标

`shoot()` 在**每次开火**时调用 `_turretAir`，内部 `for (const t of this.airTargets.list)` 全遍历。
机炮 625 发/分 ≈ **每秒 10 次**，目标数通常 <20，**当前完全不是瓶颈**。

**但**如果以后空中目标增加到上百个（比如加入蜂群无人机），这里会变成每秒 1000 次遍历。
**现在不用改**，**值得记一笔**：真到瓶颈时改成"按距离预排序 + 只查前 N 个"。

### 4.5 `31-scenery.js` 的草地细节图——512×512 canvas 程序化生成

这是一个**很好的做法**（零外部资源 + 自带种子不打乱全局 `rnd()` + 着色器里按均值归一保持明暗）。
代码注释也解释了"20~80u 外渐隐回纯顶点色"的原因。

**唯一担心**：`for (let i = 0; i < 9000; i++)` 画 9000 条草叶线 —— 这是**启动时的同步阻塞**。
512×512 上 9000 次 `beginPath`/`stroke`，在低端机上可能**吃掉 50~200ms**。

**建议**：把这个 canvas 生成移到 `requestIdleCallback` 或至少**跟首屏加载并行**（现在看起来是在
`buildWorldScenery` 里同步跑的）。如果实测启动时间没影响，就当我没说。

---

## 五、方向性决策（需要你拍板，不是 bug）

以下 4 条**不是技术对错问题，是产品取向问题**。我列出来，判断归你。

### 决策 1 · 物理真实感 vs 可玩性：`G_U = 4.32` 这个"重力"到底要不要

**现状**：`phys1` 把重力统一成真实 9.8 m/s²（= 4.32 u/s²），碎块寿命从 1.6~2.4s 拉长到 3.2~4.0s，
碎片池从 14 扩到 24。

**好处**：碎片落地更真实，不再"半空缩没"。
**代价**：**同时活跃的碎片数翻了近一倍**，每块都是独立 Mesh（虽然共用几何和材质）。
在低端机上，`draw call` 和顶点量都会上去。

**我的判断**：**先跑一次 `tools/bench_perf.py` 对比改动前后的 p95/maxMs**（这个工具本轮已经升级成
能看长尾了，正好用上）。如果低画质档的 p95 恶化超过 20%，就该考虑**按画质档降碎片池大小**：
```js
const _FRAG_MAX = quality >= 2 ? 24 : quality >= 1 ? 16 : 10;
```

### 决策 2 · RPG 提前量按难度缩放，新手会不会觉得"变难了"

```js
const lead = Math.min(0.7, Math.max(0, ((env.rate || 1) - 0.35) / 1.15 * 0.7));
```

`env.rate` 是难度系数。在 `threat: 1.6` 的 4-2/4-3 关，`lead ≈ 0.7`（70% 提前量），
**意味着"直线匀速飞会被打中，必须变向/变速"**。

**意图是好的**（前面的注释也写了"要变向/变速才躲得开"），但**这改变了游戏的解题方式**：
以前"移动就能躲"，现在"必须机动才能躲"。

**我已核实的映射链（通了）**：`91-levels.threat` → `83-arcade.js:130` 读 `L.threat` →
只乘到 `aaRate` 上（`{ aaRate: base.aaRate * th }`）→ `70-loop.js:297` 写 `IE.rate = cd.aaRate`
→ `27-infantry.js` 的 `env.rate` → `lead` 公式。**链路是通的，不是死字段。**

**但这里有个数值区间陷阱**，需要你确认是不是有意设计：

```
lead = Math.min(0.7, Math.max(0, ((env.rate || 1) - 0.35) / 1.15 * 0.7))

threat = 0.9（2-3 / 3-3 关）→ rate ≈ 0.9（× standard 的 aaRate）
  → (0.9 - 0.35) / 1.15 * 0.7 ≈ 0.335  ← 有提前量
```

看起来没问题。但**如果玩家选"新手"难度**（`DIFFICULTIES.easy` 的 `aaRate` 本身就低，假设 0.7）：
```
rate = 0.7 × 0.9 = 0.63 → (0.63 - 0.35) / 1.15 * 0.7 ≈ 0.17  ← 提前量很小
```
而 **`aaRate` 若 ≤ 0.35，`lead` 直接被夹成 0（完全不打提前量）**。这个"±0.35/1.15"的
归一化区间**是照着什么定的？** 我推断作者是想"标准难度 ≈ 35% 提前量、老兵 ≈ 70%"，
这个意图合理，但**依赖 `aaRate` 的取值范围**。**建议把这段公式的推导写进注释**，
否则下次调难度参数时，`lead` 会跟着 `aaRate` 一起漂，看不出联动。

**总结**：`threat` 链路通了，但我上一条的担心**换了个形式依然成立**——
`lead` 和 `aaRate` **隐式耦合**，改任一方的数值都会影响另一方的表现，**目前没有任何注释说明这一点**。

### 决策 3 · 首屏预加载 `preload` 两个文件，是有利还是有弊

```html
<link rel="preload" href="assets/apache_v2.glb" as="fetch" type="model/gltf-binary" crossorigin>
<link rel="preload" href="assets/skin_army.jpg" as="image" crossorigin>
```

**好处**：模型在浏览器解析那 2MB 内联脚本的同时就开始下载，**首屏更快**。
**风险**：`preload` 的 `as="fetch"` + `crossorigin` 组合，在某些浏览器上会因为
**CORS 模式不匹配**而**下载两次**（preload 一次、真正 `fetch` 时又一次，浪费一倍带宽）。

`as="fetch"` 配 `crossorigin`（无 `use-credentials`）意味着以 `cors` 模式预加载。
如果实际代码里用的 `GLTFLoader` 走的是**同源的普通 fetch**（不带 `crossorigin`），
**缓存 key 不匹配 → 预加载白做**。

**验证方法**：DevTools → Network → 看 `apache_v2.glb` **是不是出现了两次**（一次 preload、一次 fetch）。
如果两次都有实际下载，就该去掉 `crossorigin` 或改成 `as="fetch"` 不加 CORS。

> 顺带：你 `CHANGES-roundA2` 里写的"修蒙皮重复下载"——这个 `preload` 要是配错了，
> **反而是新引入的重复下载**，值得一查。

### 决策 4 · 第一次进关卡弹按键图——拦不拦"老玩家"

```js
if (localStorage.getItem(_KC_KEY)) return false;   // 弹过一次就不弹
```

**一次性弹出、之后不再弹**，对新手友好。但：
- **换浏览器 / 清缓存 / 隐私模式** → 又弹一次（隐私模式下 `localStorage` 每次都是空的）
- 代码里对隐私模式的处理是 `catch (e) { return false; }`（读不到就不弹）——**这个处理是对的**

**需要你判断**：要不要加个"在设置里能重新打开按键图"的入口？
现在它只弹一次，之后**只能靠 `H` 帮助面板**——那个面板信息密度更高（是给老手的），
纯新手错过了第一屏，可能就只记得找 `H` 了。

**我的建议**：在 H 帮助面板顶部加一个"重新播放按键图"的按钮（复用 `HOST.showKeycard(id, true)`）。
`force` 参数已经支持了（`?keycard=1` 用的就是它），**接一个按钮就行，成本 5 行**。

---

## 六、兼容性风险清单

| 风险点 | 位置 | 说明 | 严重度 |
|---|---|---|---|
| `renderer.compileAsync` (r160) | `70-start.js:265` | 无超时、软渲染可能永不 resolve（已被 12s 兜底掩盖） | 🟡 中 |
| `ClipboardItem` / `navigator.clipboard.write` | `70-mission.js:529` | Firefox 早期版本不支持图片写入；HTTP 非安全上下文下 `navigator.clipboard` **是 undefined** → 抛异常被 catch，按钮显示"复制不了" | 🟡 中 |
| `matchMedia('(pointer:coarse)')` | `73-keycard.js:78` | 老 Edge/IE 无 `matchMedia` → 已有 `typeof matchMedia === 'function'` 守卫，**安全** | 🟢 低 |
| `backdrop-filter: blur(2px)` | `73-keycard.js` CSS | Safari 需要 `-webkit-` 前缀；不支持时**只是没有模糊效果**，不影响功能 | 🟢 低 |
| `renderer.onBeforeCompile` 字符串替换 `#include <map_fragment>` | `31-scenery.js` | **依赖 three 内部 shader chunk 名**。three 升级时这个 `#include` 若改名，**静默失效**（不报错，只是细节纹理不显示） | 🟡 中 |
| `performance.memory` | `tools/bench_perf.py` | 仅 Chromium 有，代码已判空 `if(performance.memory)`，**安全** | 🟢 低 |
| WebGL2 `KHR_parallel_shader_compile` | three 内部 | 不支持的平台走同步轮询路径（见 BUG-3） | 🟡 中 |

---

## 七、我建议的动作顺序

**必须做（合入前）**

1. ~~核对 `threat` 字段是否真的有人读~~ → ✅ **已核实：链路通了**（`83-arcade.coeffs` 读取并乘到 `aaRate`）。
   但发现 `lead` 与 `aaRate` **隐式耦合**，建议补注释（见决策 2）
2. 修 BUG-2（分享卡复制按钮）—— 要么改实现，要么删掉按钮，别留着当摆设
3. 修 BUG-1（FPV 倾斜残留）—— 2 行的事

**建议做**

4. BUG-3 加 3 秒探测超时（省 9 秒等待 + 停掉无谓轮询）
5. 查首屏 GLB **是不是下载了两次**
6. 跑一次 `python tools/bench_perf.py`，对比改动前后的 p95/maxMs

**有空再说**

7. 抽 `PHYS` 常量表（4.1）
8. 抽 `73-scorecard.js`（4.3）
9. `_tmByUrl` 失败不缓存（4.2）

---

## 八、审核元信息（可核对）

```
基线 HEAD（本地 main，已 fetch 但未 push）：5879f5c7afb482f9e59798bd32f67eb0c86f1be2
被审远端：origin/main = 5879f5c（13 commits ahead of 1956a64）
工作树状态：git status --short → 空（干净）
构建产物：dist/index.html 2114 KB
  three 654 KB / loader 166 KB / app 1227 KB
buildId：git_sha=5879f5c7afb482f9e59798bd32f67eb0c86f1be2
         bundle_sha256=3db8f6451d25445ec110684572db907b7a17a2e2960a272af771b42266e9b0c4
纯逻辑测试：97 passed in 18.12s（tools/tests_pure/）
语法体检：node --check dist/app-check.mjs → Exit 0
未执行：浏览器回归（需有头 GPU 环境 + 会抢鼠标焦点）、有头截图验证
```

**审核者声明**：本轮为**纯静态审查 + 构建/纯逻辑测试验证**。
所有标注为"确认"的 bug 都有代码级证据链；
标注"待验证"的（BUG-4 方位角、threat 映射、GLB 重复下载）**需要你在有头环境核一遍**，我如实标注。
