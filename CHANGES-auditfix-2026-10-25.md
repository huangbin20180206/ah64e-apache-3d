# CHANGES-auditfix-2026-10-25

**主题**：审核「另一个 AI」第二轮改动（`5879f5c`）时发现的问题，本轮全部修复 + 回归守护落地
**基线**：`5879f5c`（远端 main，已 fetch 到本地，**未 push**）
**改动文件**：5 个源文件 + 1 个新测试 + 1 份审核报告

---

## 一、修复清单

| # | 问题 | 文件 | 严重度 | 反向验证 |
|---|---|---|---|---|
| BUG-1 | FPV 退出后 `S._leanP/_leanR` 残留，切回环绕视角机身抽一下（最多 6.9°） | `70-loop.js` / `46-fpview.js` | 🔴 | ✅ 回退即变红 |
| BUG-2 | 分享卡"复制战绩图"因脱离用户手势必失败，永远只显示"复制不了" | `70-mission.js` | 🔴 | ✅ 回退即变红 |
| BUG-3 | three r160 `compileAsync` 无超时，软渲染下白等满 12 秒 + 每 10ms 轮询烧 CPU | `70-start.js` | 🟡 | ✅ 回退即变红 |
| 4.2 | `_tmByUrl` 失败时永久缓存 `null`，后续无重试机会 | `16-targetmodels.js` | 🟡 | ✅ 回退即变红 |

---

## 二、BUG-1 · FPV 倾斜槽残留

### 怎么发现的

审查 `46-fpview.js` 的 diff 时注意到它新增了每帧写 `HOST.S._leanP/_leanR` 的逻辑（phys2"姿态跟加速度"）。
顺着这个槽位去找它的读取方和清理方，在 `70-loop.js` 读到：

```js
S._leanP = lerp(S._leanP || 0, 0, damp(0.10, dt));   // 复位
```

但**这行被整个包在**：

```js
if ((!fp || !fp.active) && S.running && FLY.state !== 'ground') {
```

而姿态叠加是无条件的：

```js
apache.root.rotation.x = FLY.pitch + rx + (S._leanP || 0);
apache.root.rotation.z = FLY.roll + rz + (S._leanR || 0) + (S._bankR || 0);
```

→ 结论：**FPV 活跃时 46-fpview 写，FPV 退出后没人清**，残留值直接叠到机体姿态。

### 怎么改的

在 70-loop 的按键分支**之前**加一段独立的、条件更宽的复位块（`src/app/70-loop.js`）：

```js
if (!fp || !fp.active) {
  S._leanP = lerp(S._leanP || 0, 0, damp(0.10, dt));
  S._leanR = lerp(S._leanR || 0, 0, damp(0.10, dt));
}
```

**为什么不在 46-fpview 里自己清零**：那会让两个模块都拥有"清零"职责，任何一方漏掉就复现 bug。
修法遵循单一职责——**46-fpview 只写（活跃时），70-loop 只清（非活跃时）**，归属判据统一为 `fp.active`。

`46-fpview.js` 侧只补了注释说明这个约定，业务代码未动。

### 改完是不是真解决了

**逻辑仿真**（`test_audit_2026_10_25_fixes.py::_sim_lean`，复刻真实 `lerp`/`damp` 公式，60fps）：

| 时刻 | 残留 | 折算角度 | 肉眼可见 |
|---|---|---|---|
| FPV 阶段峰值 | 0.12 rad | 6.9° | 明显 |
| 退出后 0.5 秒 | 0.0051 rad | 0.29° | 不可见 |
| 退出后 1.0 秒 | 0.00022 rad | 0.013° | 不可见 |

**旧行为对照**：条件不满足时**完全不复位**，6.9° 永久挂着直到玩家再按方向键。
**反向验证**：删掉复位块 → `test_bug1_loop_resets_lean_slots_outside_guard` 立刻 FAILED。恢复 → 绿。

> 遗留：这个"是否真的看得见抖动"仍需有头目视确认。仿真证明的是**数值收敛**，
> 不是**视觉观感**。建议在有头环境按 C 进 FPV、加速、再按 C 退出，看机身有没有顿挫。

---

## 三、BUG-2 · 分享卡复制必失败

### 怎么发现的

读 `70-mission.js` 新增的分享卡代码，看到：

```js
const cpBtn = mk('复制战绩图', () => { draw().toBlob(async b => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); ... }
```

`canvas.toBlob` 是**异步**的，它的回调已经脱离 `onclick` 的同步调用栈；
而 `navigator.clipboard.write()` 要求处于**用户手势的同步栈内**。
→ 必被 Chrome 拒绝（`NotAllowedError: Document is not focused`）。

作者写了 try/catch 所以不崩，但**这个按钮点了永远只显示"复制不了，请用保存"**，是个摆设。

### 怎么改的

三处改动（`src/app/70-mission.js`）：

1. **预生成 Blob**：`_mkBlob()` 用 `toDataURL` → `atob` → `Uint8Array` → `Blob` 的同步路径，
   在**结算时**就调一次，结果缓存进 `_cardBlob`。
2. **点击时同步写**：`onclick` 里先取已就绪的 Blob，然后**直接** `navigator.clipboard.write(...)`，
   中间**没有任何 await**，手势上下文完整保留。
3. **能力检测**：`_canCopyImg = ClipboardItem 存在 && navigator.clipboard.write 存在`。
   非安全上下文（http / `file://`）下 `navigator.clipboard` 是 `undefined`——
   这种情况**干脆不出"复制"按钮**，而不是给一个点了必失败的按钮。

顺带把"保存战绩图"也改成复用 `_mkBlob()`（原先它也用 `toBlob` 异步回调，
虽然下载场景不受手势限制，但统一路径更简单）。

### 改完是不是真解决了

- **静态断言**（4 项）：预生成存在 / 点击路径无 `await` / 有能力检测守卫 / 保存路径也复用预生成
- **反向验证**：把 `() =>` 改回 `async () => { await ... }` → `test_bug2_copy_path_is_synchronous` 立刻 FAILED。恢复 → 绿。

> **必须诚实说明**：我只能证明"代码结构上已满足剪贴板写入的前提条件"。
> **真实点击是否成功，需要你在 Chrome 里实测一次**（HTTPS 环境下进关卡 → 通关 → 点"复制战绩图" → 粘贴到画图/微信看有没有图）。
> 这是浏览器 API 的硬边界，离线测试无法替代。

---

## 四、BUG-3 · 首屏编译白等 12 秒

### 怎么发现的

读 `70-start.js` 的 `roundA2` 改动，看到 `compileAsync(...).then(_start, _start)` + `setTimeout(_start, 12000)` 兜底。
为了判断这个兜底是"必要保险"还是"经常被触发"，我去读了 **three r160 的实际实现**
（`src/three.module.min.js`，从压缩产物里抠出）：

```js
compileAsync = function (t, e, n = null) {
  const i = this.compile(t, e, n);
  return new Promise((e) => {
    function n() {
      i.forEach((t) => { et.get(t).currentProgram.isReady() && i.delete(t) });
      0 !== i.size ? setTimeout(n, 10) : e(t);   // ← 每 10ms 轮询，无超时，永不 reject
    }
    null !== J.get('KHR_parallel_shader_compile') ? n() : setTimeout(n, 10)
  })
};
```

**关键**：不支持的平台上（SwiftShader / 老 Intel 驱动），若某些 program 永远不就绪，
这个 Promise **既不 resolve 也不 reject**。12 秒兜底确实救了命，但代价是：
① 白等满 12 秒 ② 这 12 秒里每 10ms 轮询一次全量 program 集合，纯烧 CPU ③ 用户看着"准备画面…"不知死活。

### 怎么改的

加一条 **3 秒软探测线**（`src/app/70-start.js`），保留 12 秒硬兜底：

```js
let _probeTimer = 0, _hardTimer = 0;      // 先声明，避免 _start 引用时的 TDZ
const _start = () => {
  if (_go) return; _go = true;            // 幂等哨兵
  clearTimeout(_probeTimer);              // 成功路径清掉两条定时器
  clearTimeout(_hardTimer);
  ...
};
_hardTimer = setTimeout(_start, 12000);
_probeTimer = setTimeout(_start, 3000);   // 编译迟迟不就绪就别干等
```

**踩到的坑（已在测试里钉住）**：初版把 `const _probeTimer = setTimeout(...)` 写在 `_start` **之后**，
`_start` 里引用它就构成 TDZ 风险（若 `compileAsync` 同步 resolve 会抛
`Cannot access before initialization`）。改成 `let` 前置声明 + 后赋值。
新增 `test_bug3_no_tdz_on_timers` 断言"声明位置必须早于使用位置"。

### 改完是不是真解决了

- **静态断言**（4 项）：探测线存在且时长在 1~6 秒合理区间 / 硬兜底仍为 12 秒 / `_start` 幂等且清两条定时器 / 无 TDZ
- **反向验证**：删掉探测线 → `test_bug3_has_probe_timeout` 立刻 FAILED。恢复 → 绿。

**量化收益**：支持并行编译的快机（多数 Windows Chrome/Edge）→ 无影响（3 秒内就编完，探测线被清掉）。
不支持的机器 → 从"干等 12 秒"变成"最多等 3 秒"，**省 9 秒**，同时省掉约 900 次无谓轮询。

> 待有头实测：3 秒这个数字是**推断值**（依据是注释里"软渲染实测 15 秒同步编译"的记录）。
> 建议在有头环境用 Performance 面板看一眼 `准备画面…` 实际停留多久，必要时调这个数。

---

## 五、4.2 · 模型加载失败永久缓存 null

### 怎么发现的

审查 `16-targetmodels.js` 的懒加载改造（这轮改得最漂亮的一处），注意到缓存是永久的：

```js
_tmByUrl[def.url] = new Promise((res) => L.load(def.url,
  (gltf) => { ...; res(m); },
  undefined,
  () => res(null)));     // ← 失败也留在缓存里，值为 null
```

→ 一次网络抖动/超时，该模型在**整个会话里永远拿不到**，后续所有请求命中那个已 resolve(null) 的 Promise。

### 怎么改的

```js
const self = new Promise((res) => {
  const drop = () => { if (_tmByUrl[def.url] === self) delete _tmByUrl[def.url]; };
  L.load(def.url, (gltf) => { ...; res(m); },
    undefined, () => { drop(); res(null); });   // drop 必须在 res(null) 之前
});
_tmByUrl[def.url] = self;
```

两个细节：
1. **`drop()` 在 `res(null)` 之前调**——顺序反了的话，调用方拿到 null 的同时缓存还没清，
   紧接着的重试仍会命中旧缓存。
2. **身份比对 `_tmByUrl[def.url] === self`**——并发重入时，A 失败清理缓存的同时 B 可能已建立新条目，
   不比对就可能误删 B 的条目。

### 改完是不是真解决了

- **静态断言**（3 项）：`drop()` 存在且含 `delete _tmByUrl` / 含身份比对 / `drop()` 调用位置早于 `res(null)` / `const self = new Promise` 形式
- **反向验证**：把 `{ drop(); res(null); }` 改回 `{ res(null); }` → `test_retry_calls_drop_before_resolve_null` 立刻 FAILED。恢复 → 绿。

---

## 六、验证记录（全部真实执行）

```
全量纯逻辑测试：112 passed in 20.53s
  ├─ 既有 97 项（新增测试前：97 passed）——无回归
  └─ 新增 15 项（test_audit_2026_10_25_fixes.py）——全绿

反向验证（逐个回退修复，确认测试变红）：
  BUG-1 回退 → test_bug1_loop_resets_lean_slots_outside_guard  FAILED ✅
  BUG-2 回退 → test_bug2_copy_path_is_synchronous              FAILED ✅
  BUG-3 回退 → test_bug3_has_probe_timeout                     FAILED ✅
  4.2   回退 → test_retry_calls_drop_before_resolve_null        FAILED ✅

构建：node build.mjs → 通过（死引用 0，id 契约 195/170）
      bundle_sha256 3db8f645…（改前）→ e64c6693…（改后）——证明改动确实进了产物
      app 1227 KB → 1232 KB（+5 KB，新增代码与注释）
语法：node --check dist/app-check.mjs → Exit 0

未执行（需你的环境）：
  · 有头浏览器回归（会抢鼠标焦点）
  · FPV 切回视角的目视验证（BUG-1 的视觉观感）
  · Chrome 里真实点击"复制战绩图"（BUG-2 的浏览器 API 实况）
  · Performance 面板看"准备画面…"实际停留时长（校准 BUG-3 的 3 秒）
```

---

## 七、为什么这些 bug 原来的测试测不出来

原有 97 项测试**全部是纯逻辑无头测试**（`tools/tests_pure/`，测算法/数值/数据结构）。
本轮 4 个 bug 全在另外三个层面：

| Bug | 层面 | 为什么测不到 |
|---|---|---|
| BUG-1 | 跨模块状态耦合 | 需要"FPV 活跃 → 退出"这个时序，纯函数测不到 |
| BUG-2 | 浏览器 API 手势语义 | 需要真实浏览器 + 真实点击手势 |
| BUG-3 | 渲染后端时序 | 需要真实 GPU 驱动行为 |
| 4.2 | 失败路径 + 缓存语义 | 需要模拟网络失败并观察后续重试 |

→ 本轮新增的 15 项测试，用的方法是**源码结构断言 + 逻辑行为仿真 + 反向验证**，
在无 GPU 的 CI 上可执行，专门补这块盲区。**反向验证是关键**：
只写"断言修复存在"的测试，无法证明它真的抓得住问题；
逐个回退看变红，才能证明测试有效。
