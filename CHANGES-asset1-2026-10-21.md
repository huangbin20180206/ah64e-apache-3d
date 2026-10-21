# CHANGES asset1 2026-10-21 — 外部评估建议落地：资产瘦身 + 首屏优先 + 卡顿统计

## 采纳了什么
1. **目标模型压缩**：assets/targets 里 53 个未压缩 GLB 用 gltfpack 做 meshopt 压缩
   （位置/UV/法线都保持浮点，只有顶点色等小属性量化；节点名、材质、网格名全保留）。
   assets/targets 63MB → 约 32MB。
   - 坑：第一版法线量化成 8 位整数，在软渲染下 3-3 / 4-1 会"显卡上下文丢失"，改成浮点法线后消失（体积只多 2MB）。
   - gltfpack 会丢网格名，村落楼/摩托是按网格名挑的 → `tools/restore_mesh_names.py` 补回。
   - 以后新模型：`bash tools/compress_glb.sh assets/targets/xxx.glb`。
   - 守护测试 `tools/tests_pure/test_assets_compressed.py`：没压缩或出现整数法线直接红。
2. **按需下载**：
   - `16-targetmodels.js` loadTargetModels 改成按 key 逐个下载（基地/城镇/峡谷各自只要自己用到的载具），同一文件只下一次。
   - `16-targetprops.js` 道具/城镇楼改成用到哪个下哪个（旧版第一次调用就把清真寺、商铺等全拉下来，展示线也下）。
3. **首屏优先**（build.mjs 的 GLTFLoader 包装）：机体 GLB 先下，其余 GLB 等机体就位后排队，最多 4 个同时下载（8 秒兜底放行）。
   template.html 加机体 GLB 的 `<link rel=preload>`，在浏览器解析 2MB 脚本时就开始下载。
4. **卡顿统计**：`tools/bench_perf.py` 除平均帧率外输出 p50/p95/p99 帧时长、最长单帧、JS 堆峰值；perf.json 保留最近 20 次历史；p95>33ms 或单帧>100ms 告警。
5. **U.S. ARMY / 机号贴花**：字后面的深色底板去掉（材质按透明度裁切），真机是字直接喷在机身上。

## 实测（展示线 #show，本地服务器）
| | 改前 | 改后 |
|---|---|---|
| 开页 12 秒内下载 | ≈8MB（机体与几十个模型抢带宽） | 5.9MB（机体+页面） |
| 停留 70–90 秒总下载 | 70.7MB / 67 个文件 | 28MB / 49 个文件（城镇楼等不再下载） |
关卡 2-1 / 3-2 / 3-3 / 4-1 / 4-3 起飞-开火-移动截图与改前一致，无页面报错；`bash tools/run_tests.sh` 通过。

## 没采纳（理由）
- 纹理转 KTX2：纹理只占模型体积约 1/4，还要引入 Basis 解码器（约 200KB+wasm），收益小。
- manifest.json + Cache-Control immutable：GitHub Pages 不能自定义缓存头，做了也不生效。
- CI 性能门禁：CI 是软渲染，帧率波动大，阈值门禁只会误报；统计先在本机跑。
- HUD 预算条：HUD 已有 FPS 与 draw 读数。
- 3 分钟主线：展示线已有导览路线；等朋友真实反馈再决定。
- 本地漏斗统计、确定性回放、PWA 离线、ESM 开发构建、3 级 LOD、资产契约校验器、测试三层拆分/自动开 issue：
  对"做给朋友玩"的项目投入大、玩家看不出差别，暂不做。
- 30 秒视频导出：有意思，但不在这批"加载/性能"范围，列入候选。
