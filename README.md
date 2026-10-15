# AH-64E 阿帕奇 · 交互式 3D 展示页

零依赖单文件 HTML 产品：three.js + GLTFLoader + 全部应用代码打进一个 `dist/index.html`，
无打包器、无 npm 依赖、无外部 CDN 请求（GLB/蒙皮保持外部文件流式下载）。

**资源压缩（2026-10）**：所有 GLB 做了 `EXT_meshopt_compression` **无损**压缩（不量化：
顶点属性逐字节一致、三角形顺序与绕向一致，仅起始顶点轮换），靶标贴图 PNG→JPEG q95 4:4:4
（PSNR ≥36 dB）。模型合计 14.5MB → 6.6MB。meshopt 解码器（`vendor/meshopt_decoder.js`，
MIT，内嵌 wasm ~29KB）由 build.mjs 内联并统一注入 `THREE.GLTFLoader`，app 代码无需改动。
⚠ `tools/` 下直接读 GLB 二进制的 Python 离线脚本（exact_bounds/dump_tree/inspect_glb 等）
需先解压：`npx @gltf-transform/cli copy in.glb out.glb`（输出为未压缩副本）。

## 快速开始

```bash
# 构建（src/app/*.js 按数字前缀排序拼接 → dist/index.html）
node build.mjs

# 语法体检（build 特意输出 app-check.mjs 供此命令）
node --check dist/app-check.mjs

# 本地服务（必须走 HTTP，GLB 由 fetch 相对路径加载）
uv run python -m http.server 8642 --directory dist
# 浏览器打开 http://localhost:8642
```

## 自动化测试

测试走 Playwright 有头模式（headless 走 SwiftShader 仅 ~2FPS，游戏时间失真），
由 `tools/tests/pw_harness.py` 护具统一托管（看门狗硬超时 / 全路径关浏览器 /
起测前清 ms-playwright 孤儿内核 / 结果落盘 last_result.json）：

```bash
# 唯一发布门禁入口（本地全量回归）：构建 → 静态检查 → 清残留端口 → 起服务 →
# 等就绪 → 按清单串行跑全部测试 → 汇总退出码 → 无论成败都清服务（约 7 分钟）
powershell -File tools/run_tests.ps1

# 单项示例（navlights/grass/desert 需要 pillow 做像素统计）
uv run --with playwright --with pillow python tools/tests/test_navlights.py

# 性能基准（产出 docs/perf.json）
uv run --with playwright python tools/bench_perf.py
```

回归清单的唯一来源是 `tools/tests/test-manifest.json`（数量以该文件实时为准——最终闭环修复
起 run_tests.ps1 会在输出中打印 `manifest_tests` 真实数量，避免文档数字再次过期；与磁盘
`test_*.py` 双向核对一致，新增测试文件必须同步入清单，全过才算绿）。覆盖：
test_ci_smoke（CI 冒烟，帧率无关结构断言）/ test_fpv（FPV 驾驶+武器）/
test_navlights（夜灯）/ test_weapons_air（空中目标）/ test_water_ripple（涟漪）/
test_edge_cases（画质·A11y·上下文丢失·降档冷却·引导·reduced-motion）/
test_grass（草密度+压痕）/ test_desert（远景沙丘+brownout）/
test_desert_sink（沙地陷轮+扬沙）/ test_targets_mov（动目标巡逻）/
test_tour + test_tour_full（导览与全程）/ test_view_anchor（机位锚定）/
test_hover_translation（悬停平移+侧飞）/ test_orbit_yaw（蹬舵转向）/
test_dive（俯冲攻击）/ test_betty（语音警告）/ test_mission（任务系统）/
test_rescue（绞车救援）/ test_phase0_regressions（Phase 0 核心：FPV 鼠标 dx/dy
各自单次累加、任务双路径重置、救援跨地形全状态矩阵）/ test_phase0_evidence
（验收证据截图生成）/ test_mobile（移动端触控，390×844 竖屏仿真）/
test_fail_paths（失败路径：WebGL 不可用 / context lost / GLB 载入失败）。

CI（GitHub Actions，Linux 无 GPU）：SwiftShader 软渲染下游戏时间约 1/50 实速，
实时 WebGL 断言不可行——CI 门禁为 build + 静态检查 + test_ci_smoke（帧率无关
断言）；完整清单在 CI 用同一 manifest 照跑（手动触发/每周，标注环境阻塞，
仅归档输出不计红）。**全量权威门禁在本地** `tools/run_tests.ps1`。

参赛评审材料：`docs/TECH.html`（自包含技术文档页）。演示视频待补录。

验证方法论（重要，踩坑总结见 CODELY.md 结构化记忆）：
- **像素断言用主色占优**（`g > 1.8*r`）：ACES 色调映射会把灯芯白热化，纯通道阈值漏判
- **闪烁效果用峰值保持轮询**（`state().peak`，1.2/s 衰减）：截图连拍 ~700ms 间隔必然错过 ~100ms 窄脉冲
- **单侧航行灯分机位验证**：默认机位看右舷，左舷灯被机身遮挡是物理正确

## 架构

```
src/app/*.js 按两位数字前缀排序拼接进单 IIFE（顺序即依赖顺序）：

  00-utils      数学/种子随机/画布/噪声/法线/贴图 工具
  05-config     AC 包围盒常量、PART_GROUPS 绑定表、GUN 参数
  06-paint      机体涂装程序化绘制
  10-tex        停机坪/接触阴影贴图
  15-terrain    起降场地系统（pad/grass/water/desert 四介质）
  16-targetmodels 靶标程序化建模 + AI 高模换壳 + 按材质合批（mergeTargetStatics）
  16-targets    TargetRange：布阵/命中接口/摧毁动画/AA 反击/警报撤离
  16-targetscenery 靶场阵地布景（掩体/沙袋/围堰/警戒桩/车辙）
  16-town       城镇地图（可摧毁建筑/伏击车/视线遮挡，urban_strike）
  16-valley     峡谷地图（heightAt 地形/旋翼碰撞/崖顶雷达/FPV 地形读数，canyon_run）
  17-washfx     下洗核心：WASH 表 + 涡环粒子 + 地面贴花 + WashFX 总装
  18-audio      程序化音效（桨叶拍击/涡流嘶声/卷积混响）
  19-reflect    湖面倒影（镜像克隆体 + 灯珠材质恢复）
  20-scene      天空/环境预设/灯光/PMREM
  21-washground 地面痕迹：沙漠盖章/沙脊沙雾/草屑碎片
  23-washmedia  介质表现：草叶实例场/水花泡沫/悬停涟漪
  24-navlights  机体夜间灯光（航行灯/信标/频闪/搜索灯/编队灯/仪表绿光）
  26-airtargets 空中打击目标（无人机/热气球/靶机）
  30-world      场景搭建（天空球/停机坪/远景盘/浮筒平台）
  40-post       后处理（亮部提取→mip 链→叠加→ACES+色散+暗角）
  45-flight     起降状态机（FLY：ground/up/hover/down + FP 平移通道 x/z）
  46-fpview     第一人称座舱视角（指针锁定/WASD 驾驶/扳机转发）
  50-controls   环绕轨道控制器 + 12 机位预设
  60-model      Apache 类：GLB 载入/部件绑定/涂装/爆炸视图/阴影代理（批 E）
  65-weapons    武器系统（M230 曳光/地狱火/火箭，对象池+自动追踪）
  70-app        入口核心：渲染器/世界/状态 S/子系统槽/靶场 HUD/画质
  70-camera     机位条/setView/截图
  70-combat     SAM/机务损伤/A2A/资源 的逐帧 _tick*
  70-hud        后处理参数/模式徽标/HUD 读数 的逐帧 _tick*
  70-labels     部件标签与解说牌
  70-loop       动画循环 loop()（按序调用各 _tick*）
  70-mission    任务系统（变体/简报/面板/结算/训练）+ _tickMission
  70-start      载入装配 boot/finish，文件末尾启动（须为 70-* 最后一个）
  72-uibind     UI 绑定与事件路由（bindUI 唯一入口）
  74-tour       一键智能导览（60 秒自动巡航+中文字幕，Esc/点按即接管；
                停止只交还控制权，场景保留当前状态——刻意的产品行为）

vendor/        three.module.min.js + BufferGeometryUtils + GLTFLoader + meshopt_decoder（剥壳内联）
tools/         离线分析脚本（GLB 节点树/包围盒实测）
tools/tests/   Playwright 验证脚本 + pw_harness 护具
```

## 键位

| 键 | 功能 | 键 | 功能 |
|---|---|---|---|
| 拖拽/滚轮 | 环绕/缩放 | 空格 | 启动/关停旋翼 |
| T | 起飞/降落 | C | 第一人称驾驶（悬停时） |
| FP·鼠标 | 瞄准（十字线=机头） | FP·W/S/A/D | 前后/转向 |
| FP·R/Q | 升/降 | FP·左/右键 | 机炮/火箭 |
| FP·Z/X | 侧飞（左/右） | ↑↓←→ | 悬停平移（环绕模式） |
| A / D | 悬停原地转向（离地后） | — | — |
| G(按住) | 机炮 | X(按住) | 火箭 |
| F | 地狱火 | V | 装填弹药 |
| B | 重置靶场 | 1-9 0 - = | 12 机位 |
| L / W / E | 标签/线框/涂装 | P / H | 截图/帮助 |

## 约定（改代码前必读）

- **模块按数字前缀排序拼接**：新文件选好前缀即声明了依赖顺序；app 代码禁用
  `import`（单 IIFE 共享顶层作用域），跨模块符号直接引用
- **可复现随机**：一切视觉噪声用 `rnd()`（固定种子 mulberry32），禁 `Math.random`
- **渲染管线色彩只转换一次**：renderer 保持 Linear，sRGB 由 40-post 末端统一
- **模型常量以实测为准**：换模型后重跑 tools/exact_bounds.py 核对包围盒
- **节点名契约**：PART_GROUPS/LABELS 的 Blender 原始名重命名需三处同步
- **每帧重建 root.position**：外部系统的平移累积必须走状态通道（如 FLY.x/z），
  直接写 root.position 会被 loop 的振动重置冲掉
