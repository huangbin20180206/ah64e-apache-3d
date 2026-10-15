# PERF-AUDIT.md — 静态性能审计（feat/game-layer 批次）

> **本批实施状态**（详见 REPORT.md）：已实施 = A1/A2/A3/A5/A6/A7/B1
> （零视觉变化的分配/DOM 项，build+纯测试回归全绿）；已分析不实施 = A4
> 矩阵部分（零验证收益不值得跨发射时序冒险）、E1（非严格等价）、F2
> （启动时序扰动风险）；待浏览器解禁实施 = C1/C2/C3/C4（draw call 合批，
> 需像素 diff 自证"同画面"）、D2（InstancedMesh 改池）。
>
> 依据任务 §1A 产出。**本轮浏览器测试被禁**（主树门禁并行中），故：
> ① 所有"预期收益"给出机制推导与静态计数的依据，并标注置信度；
> ② 数值验收统一由随文档入库的探针脚本 `tools/probe_perf.py`（playwright，
> **写好不运行**）在浏览器解禁后跑数闭环；
> ③ 硬纪律遵守：无任何"降画质换数字"项——所有改法都是"同画面少做事"。

基线（任务给定）：draw calls pad 188 / grass 190 / desert 190 / water 277；
dist/index.html 1387 KB（本批构建后 1415 KB，+28KB 来自 84/85 两模块与注释）。

---

## A. 每帧分配（GC 停顿来源）

### A1. 70-app.js L691 `HOST.modeState()` 每帧调用返回新对象
- **问题**：loop 每帧调 `HOST.modeState()`（01-host.js L44-72），函数内
  `return { owner, fp, cinematic, ... }` **每帧新建 1 个 10 字段对象**，且内部
  `cutscene.state()` 再返回 1 个对象 → **稳态 ~120 对象/s 进新生代**。
- **为什么慢**：V8 新生代默认 ~16MB，此速率单项占比小，但它是**无条件**
  分配——对象在 60fps 下活不过 1 帧，属"分配即垃圾"的纯 GC 压力模式。
- **预期收益**：消除 loop 内每帧 2 个短命对象（约 7200/min）。单帧耗时
  影响可忽略，收益在 GC pause 分布的长尾（置信度：机制确定，量级小）。
- **改法**：loop 的 mode-chip 块不经 modeState()——直接读
  `fp.active / HOST.cutsceneState?.on / S._mission?.phase / S.mode`
  拼 label（这些全是既有标量）；`modeState()` 保留给 __dbg/测试（P14 契约）。
- **验证**：probe_perf.py 的 `alloc` 段——`PerformanceObserver('gc')` 采样
  30s 悬停场景前后，对比 minor GC 次数与单帧最长停顿；同机位像素 diff=0。

### A2. 65-weapons.js 火箭飞行循环每帧 `new THREE.Vector3(0,0,1)`
- **问题**：L582 `r.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.dir)`
  在 `update()` 的火箭循环里——**每枚在飞火箭每帧 1 个 Vector3**。齐射 24 枚
  满池时 1440 对象/s；同款还有 L471（出巢一次性）、曳光 L228（每次发射）、
  `_tracer` L217 散布项（每次发射）。
- **为什么慢**：热路径上的短命三元素对象，喂新生代；曳光/火箭是战斗帧率
  敏感期（同帧还有烟雾/爆炸实例更新）。
- **预期收益**：齐射期分配速率 −1440/s（≈该场景 JS 分配的可见大头之一）。
- **改法**：模块级 `const _W_FWD = new THREE.Vector3(0, 0, 1)`（HF_FWD 同款
  先例，L21-22 注释明写"避免每帧 new"——火箭循环漏掉了）；`_tracer` 的
  散布向量改为模块 scratch `_spread.set(...)` 复用。
- **验证**：probe_perf.py `alloc` 段加"按住 G+X 齐射 3s"窗口，wrap
  `THREE.Vector3` 构造器计数（`window.__vec3Count` 探针），前后对比；
  弹着点/弹道像素 diff=0（同种子 rnd 下轨迹逐位一致）。

### A3. 65-weapons.js L681-682 地狱火导引每帧 2 个 `new Vector3`
- **问题**：飞行循环里 `new THREE.Vector3(p.x, p.y, p.z)` / `(p.x, 0.9, p.z)`
  **每弹每帧 2 个对象**（≤8 弹 → ≤960/s）。
- **改法**：模块级 `_hfTo` scratch（同文件 HF_FWD 先例）。
- **验证**：同 A2 探针窗口（发射 F 连按 8 枚）。

### A4. 65-weapons.js `shoot()` 每发 3 重分配 + 冗余全子树矩阵更新
- **问题**：L313-316 每发炮弹 `this.muzzle.clone()` + `new THREE.Vector3`
  （机头方向）+ `a.root.updateMatrixWorld(true)`。625 发/分 = **每秒 ~10.4
  次全机树矩阵重算**（机体 ~200 节点），而 loop 每帧稍后在 render 前本来
  就会更新同一批矩阵——连发期间这些重算绝大多数是**冗余功**（矩阵在两次
  发射之间没有变化，两次发射之间姿态有变的只有振动微颤项）。
- **为什么慢**：`updateMatrixWorld(true)` 是 O(节点数) 强制遍历；连发 3s
  即 ~31 次冗余全树遍历 + ~93 个短命对象。
- **预期收益**：连发期该路径分配 −31/s；矩阵重算收敛到"姿态变化帧一次"。
- **改法**：本批已实施分配部分（`_W_MZL/_W_DIR` scratch 复用）；矩阵部分
  保留每发刷新——`_gt` 发射时钟与 dt 的相位关系使"每帧一次"的重排存在
  跨发弹道偏移风险（P7 竞态族教训：发射瞬间姿态微颤恰好是 next 发的输入），
  不为零验证收益冒险，**如实列为"已分析、不实施"**。
- **验证**：已实施部分见 A2 探针；未实施部分无需验证。

### A5. 16-targets.js L268 `nearestAhead` 每次调用 `new THREE.Vector3`
- **问题**：每次调用新建 1 个 Vector3——被机炮**每发**（L~334）、火箭/地狱火
  发射路径调用 → 连发期 ~10/s。
- **改法**：模块级 `_naTo` scratch（同文件 AA 曳光 `dir` 字段已预分配先例）。
- **验证**：并入 A2 探针窗口。

### A6. 26-airtargets.js L177 `nearest()` 同款每调用 1 分配
- **改法**：模块 scratch `_atV`。验证并入 A2。

### A7. 50-controls.js L86-87 `_pan()` 每次拖拽事件 2 个 Vector3
- **问题**：pointermove 事件率 = 拖拽期 ~60-120/s → 120-240 对象/s。
- **改法**：模块级 `_panR/_panU` scratch（构造一次）。
- **验证**：probe_perf.py `drag` 段（脚本驱动 5s 拖拽，构造器计数前后）。

### A8. 已合规样本（不需要动）
46-fpview 每帧向量全部构造期预分配（L53-59，历史优化先例）；19-reflect
pairs 同步用 copy 不分配；17/21/22/23 下洗系 GPU 顶点驱动，CPU 零分配。

---

## B. DOM 写入（找漏网的"变化才写"违例）

### B1. 70-app.js L361-376 `updateLabels()` 每标签每帧 6 次 style 写
- **问题**：标签开启时 14 个标签 × (left/top ×2 元素 + width + transform)，
  含 2×`toFixed(1)` 字符串 + `Math.atan2` —— **每帧 ~84 次样式写 +
  ~56 个短命字符串**；其中 `left/top/width` 是布局属性（触发 style
  recalc dirty），仅 `transform` 是合成器属性。
- **为什么慢**：相机静止/微动时这些值几乎不变，但逐帧无条件写——正是项目
  "HUD 只在变化超过阈值时写 DOM"约定的漏网点（对照：46-fpview `_lk` 缓存
  L207-208 的既有先例把像素取整后才写）。
- **预期收益**：标签开启场景下 style 写次数 → 静止时 ~0、动态时 ≈值变化率；
  字符串分配同步消失。
- **改法**：沿用 `_lk` 模式——每标签缓存 `qx/qy/w/ang`（取整到 1px /
  0.01rad），变化才写；`display` 分支已由 `vis` 早退承担。
- **验证**：probe_perf.py `dom` 段：`MutationObserver` 盯 `#labels` 子树
  style 属性变更计数 10s（静止相机），前后对比 + 标签位置像素 diff=0
  （取整 1px 对 46px 位移量级的标签不可感知，diff 容差 ±1px）。

### B2. 已合规样本
- 70-app HUD：`_rpmShown`/`_ga/_rk/_ha`/threat/score/combo/mode-chip 全部
  dataset 缓存或 0.5s 节流（L716-813）；hud-alt/draw/fps 在 0.5s 块内。
- 46-fpview HUD：0.15s 节流（L383-385）。
- 74-tour/78-cinematic/82-cutscene 字幕：事件驱动写，非每帧。
- 本批新增（84/85/70 SAM HUD）按同一缓存纪律实现（hud-rwr/hud-flare
  dataset 缓存，0.5s 块内）。

---

## C. Draw call 合批（目标 ≥20%：pad 188→≤150.4 / grass 190→≤152 /
### desert 190→≤152 / water 277→≤221.6）

### C1. 19-reflect.js L59-88 整机镜像克隆 → water 场景 draw 近翻倍【主攻项】
- **问题**：`bind()` 把整机 `clone(true)` 全部网格换成单一倒影材质——
  每个网格仍是**独立 draw**。water 277 − 基础（water 隐藏靶标）≈ **镜像
  贡献 ~85+ draws**（整机网格数 + 细节件 + 夜灯）。
- **机制**：镜像材质是**统一 ShaderMaterial**（L51-84）——所有镜像网格
  材质相同，却因 Object3D 边界无法合批；其中绝大多数（机身蒙皮/短翼/
  尾梁/起落架……）在**静态子树**里，只有旋翼/尾桨/雷达/贴花等少数节点
  有独立局部动画。
- **预期收益**：静态子树按"世界变换烘焙 + mergeGeometries"合并为
  少数几个 mesh（BufferGeometryUtils 已 vendored，构建已内联），镜像
  draws 从 ~85 → **~6-10**（静态合并体 + 动画节点对）。单此一项
  water ≈ 277 → ~198（**−28.5%**，超 20% 目标；置信度：镜像网格数待
  探针实测，机制确定）。
- **改法**：`bind()` 后遍历 pairs，把"构造后局部变换从未改变"的节点
  （需在 60-model setExplode/武器离架路径打标）烘焙进合并几何；动画节点
  保留 pair 同步。**爆炸视图（setExplode 移动每个节点）与水面倒影的组合
  态**必须保留 per-node 或退化为"爆炸时镜像整体隐藏"（视觉取舍，需拍板，
  默认不做爆炸态镜像）。
- **验证**：probe_perf.py `draws` 段：water 场景同机位（悬停 14u、侧舷
  64u、phi 0.82）`renderer.info.render.calls`（autoReset=false 跨 400ms
  累积，bench_perf 既有法）前后对比 + 截图像素 diff（倒影区域容差内）。

### C2. 16-targets.js 程序化靶标每靶 26-35 个小 mesh【pad/grass/desert 主攻】
- **问题**：程序化模型按零件逐个建 Mesh（tank ~26 / truck ~27 / barrel 35
  ——L24-139 静态可数）；GLB 换壳后为 model.clone() 的多原语。10 靶全可见
  时地面目标贡献 **~100-290 draws**（还各进一次 shadow pass：
  L155/243 全 mesh `castShadow=true`）。
- **机制**：这些 mesh 共享少量材质（tank 5 种、truck 6 种、barrel 4 种）
  且**组内局部变换静态**（整组移动的 mov 目标也只动 group）——同材质
  可 `mergeGeometries` 烘焙成"每靶每材质 1 个 mesh"。
- **预期收益**：按 GLB 实际多原语数待实测；程序化兜底形态下 10 靶
  ~290 draws → **~50**（每靶 4-6 材质）。pad/desert 若靶标占 ~60-100
  draws，合并后总场景 ≈ −(40-60) draws → 188 → **~130-148（−21%~−31%）**。
  置信度：需探针按 layers 分解实测靶标实际占比（GLB 换壳后可能远小于
  程序化计数）。
- **改法**：`build()` 后（含 GLB 换壳 `applyModelToTarget` 完成回调）按
  材质合并每靶静态几何；`flashHit` 的 emissive 闪烁语义不受影响（材质
  实例引用不变）；命中/移动/隐藏全在 group 层。
- **验证**：同 C1 探针 + `#targets 分解`（逐 group `layers.disable` 差分
  计数）；四场地 draws 前后表 + 靶标特写像素 diff=0。

### C3. 残骸小件 castShadow（16-targets L351 `b.castShadow = true`）
- **问题**：每个残骸 4 块小箱体全投影——每残骸 +4 draws（shadow pass），
  10 残骸 = +40。残骸是烧毁静物，其阴影在 42u 外不可辨（P10 细节件
  同款结论：贴地小件投影穿帮大于观感收益）。
- **预期收益**：满场残骸态 −40 shadow draws。
- **改法**：`b.castShadow = false`（receiveShadow 保留）。
- **验证**：draws 探针（全歼后场景）+ 残骸特写像素 diff=0。

### C4. 81-narrative 静态布景（雷达/弹药堆/导弹车）
- 未实测 mesh 数；同 C2 机制可按材质合并（雷达盘是动画节点需保留）。
  探针 `#narrative 分解` 先量化再决定——**审计结论：待实测，不盲改**。

### 结论（诚实声明）
pad/grass/desert 的 −20% **可达**（C2+C3 机制收益即可覆盖，探针待跑数
标定实际占比）；water 的 −20% **依赖 C1 镜像合并**（机制上 −28%，但涉及
"爆炸视图×倒影"组合态的取舍需拍板）。**本批未实施任何 C 项**——draw
合并属渲染可见面变化风险类改动，浏览器被禁期间无法用像素 diff 自证
"同画面"，按任务红线（不可证伪不动手）留待解禁后实施。

---

## D. 材质与着色器

- D1. 程序化靶标每 build 重建 10×(4-6) 个 MeshStandardMaterial（L11-13
  `targetMat` 每次 new）——three 按参数哈希共享 program，不产生多余编译，
  仅材质对象与 uniform 上传开销；C2 合并后顺带收敛到每材质 1 实例。
  验证：`renderer.info.memory.programs` 前后一致 + calls 探针。
- D2. 65-weapons 烟/焰池逐实例独立材质（L120-129 等）——池语义需要逐实例
  opacity/颜色，属**必要开销**；潜在改法是 InstancedMesh + instanceColor
  + 每实例 alpha 打进顶点色，把 48 puff 从 48 draws → 1 draw——**视觉等价
  条件是逐实例混合模式一致**（池内 add/normal 两种混合并存，需拆两池）。
  预期：交战场景 −40+ draws（基线场景 puff 不可见不贡献）。置信度中，
  改动面大，列候选未实施。
- D3. 每帧 uniform 写入（skyMat.uTime、discMat.uOpacity 等）为数值 uniform，
  three 自动 diff，非瓶颈——**不列**（避免"看起来忙"的伪优化）。

## E. 后处理 pass 链与 RT

- 40-post.js 现状：sceneRT(MSAA×4, HalfFloat 全分辨率) → [dof 半分辨] →
  bright(半) → blur×2×4 级 → copy 叠加×3 → [god 1/4] → final。q=1 默认
  **~11-13 个全屏 pass**。
- E1. 唯一零观感损失候选：`bright` 与 mip0 横向 blur 合并（bright 内联
  5-tap 横向）省 1 个半分辨率 pass。**数学上非严格等价**（合并后采样的是
  全分辨率阈值图，输出与"先阈值后半分辨率横向"有 <1px 级差异）→ 违反
  "同画面"红线，**不实施**，如实记录。
- E2. `setSize` 在 resize 时对 mips×8 + godRT + dofRT 逐个 setSize——
  resize 是低频事件，**不列**。
- E3. 0.75 档已有 god/dof/reflect 三重降级门控（setQuality）——合规，不动。
- **结论**：后处理链架构上无"免费午餐"，全部维持现状（这正是硬纪律
  "禁止降画质"的正确答案——不为了数字砍 pass）。

## F. 首屏加载路径（dist/index.html 1415 KB）

- 构成（build 实测输出）：three 654KB(46%) + GLTFLoader 137KB + app 586KB
  + 模板/CSS ~38KB。**单文件产物是项目红线**（无框架无打包器，build.mjs
  纯 Node），代码分割不可行。
- F1. GLB 4.7MB 保持外置流式（P0 决策）✓；蒙皮 jpg 失败有兜底 ✓；
  细节件 GLB 低画质档不加载（62-detailparts setQuality）✓——加载路径
  已按"关键路径最小化"设计。
- F2. 可行候选：启动期程序化贴图合成（10-tex 停机坪 / 06-paint 蒙皮 /
  P9 细节层 2048² 同步画布）可拆到 `requestIdleCallback`/分帧——
  **收益**：首帧可交互提前（量级待 probe `paint` 段 longtask 采样）。
  风险：P9 曾因启动期同步工作后移放大既有测试竞态（setTimeout(0) 教训），
  动它需重跑全部启动类测试——**列候选未实施**。
- F3. HTTP 传输层 gzip/br（npx serve / python http.server 均支持）——
  1415KB 文本压缩后 ~350-400KB 线上量级；部署侧一行配置，**不属于代码
  改动**，写进 start-demo.bat 说明即可（未动）。
- **结论**：首屏路径在单文件约束下已接近合理下限；量化留给探针
  `paint` 段（PerformanceObserver longtask）。

---

## 验证探针（统一入口）

`tools/probe_perf.py`（playwright，**写好不运行**，浏览器解禁后跑）：
- `draws`：四场地同机位 `renderer.info.render.calls` 累积 + 逐模块
  layers.disable 差分分解（C1/C2/C4 归因）；
- `alloc`：wrap `THREE.Vector3/Quaternion/Color` 构造器计数（悬停 30s /
  连发 3s / 拖拽 5s 三窗口）；
- `dom`：MutationObserver 计 `#labels`/`#hud` style 变更 10s；
- `paint`：PerformanceObserver longtask + 加载瀑布（F2）。
输出 JSON 落盘，前后构建各跑一遍即成本审计每一项的"改之前 vs 改之后"。
