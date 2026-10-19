# CHANGES polish1 2026-10-19 — 细节打磨第一批

## 改动
- 16-targetprops：抽油机曲柄节点原点偏离配重（模型问题，转起来整块甩飞）→ 套转轴组、轴心放在配重包围盒中心；游梁原点本在支点，保持。
- 16-targetprops：椰枣树 v2 叶片由半透明改镂空裁切（alphaTest 0.5，不再有远近叠放闪烁/排序错误），叶色压成灰土橄榄绿（PROP_DEFS.palm.cutout）。
- 27-life：牲口受惊奔跑拴在出生点 4u 内（跑出圈就拐回，不再冲进房子/跑出镇）；奔跑时蹄下扬尘。
- 27-life：民用车也给牲口/驴车让路；驴车在路口外遇到外环来车会停下等，已上路口不停（避免互等）。

## 状态
- 代码已入 src；构建通过（Exit 0，dist/index.html 2046 KB）。
- tests_pure 91 passed；check_dom_ids 通过；拓扑自检 8/8。
- 截图：cmp/vis/shot_a6s.py town（pump/pump2/palm/donkey）。

# polish2（同日，用户指出两处不合理）
- 椰枣树：原模型树干顶高过叶冠、且微斜偏离叶冠中心 → 加载后把树干顶压到叶冠内并收拢到中心；叶片绕树冠中心再复制两圈（三层，更密）；叶色再压暗（cutout [0.6,0.58,0.4]）。16-targetprops `_fixPalm`，PROP_DEFS 新增 `fix` 钩子；module-contracts 16-targetprops depends 增 mergeGeos。
- 驴车：原生成模型车轮埋地下、只剩麻袋贴地拖 → 27-life 按驴身高程序化搭两轮木板车（车板/侧栏/尾板、带 6 辐条铁箍木轮、车轴、两根车辕接到驴肩两侧），原麻袋缩放后放在车板上；车轮随行驶滚动。倒地变暗改为按原色比例（不再把木头刷白）。
- 构建通过（dist 2051 KB）；tests_pure 91 passed；拓扑自检 8/8；DOM id 检查通过。截图 cmp/vis/shot_pd.py town。
- 黑鹰残骸：加坠毁现场——沿机身拉长的焦痕 + 6 块散落碎片（2 段断旋翼、4 块蒙皮），固定伪随机摆放（16-targetprops `_crashSite`，PROP_DEFS `scorch/debris`；契约增 scorchTexture）。构建 2053 KB。

## polish3（展示线）
状态：代码已入 src / 构建通过（Exit0，dist/index.html 2055 KB，bundle_sha256 2caeca95…3516）；tests_pure 91 passed；topology selftest 8/8；dom_ids 通过。
- `31-scenery.js` 停机坪：方块机库/油车改为真模型——铁皮仓库 GLB（转 90° 门朝停机坪、宽 16u、乘军用灰绿（线性 0.3,0.36,0.3）去掉民用锈棚感）+ M978 HEMTT 油罐车 GLB（长 4.3u ≈10.2m，沿原引导线角度）。方块版保留为加载前/失败时的占位（scn-apron-fb），两个模型都到位才隐藏。
- `75-routes.js` 航线展示：播放时收起右侧面板、左下参数框、操作提示、机位条、顶栏（body.route-mode），退出时按进入前状态恢复面板；“退出航线”按钮从底部居中移到右下角，不再和居中字幕叠在一起。
- `71-armory.js` 装备图鉴：横屏转盘选中项放大后长名字（串列双座座舱 / 机身与生存性）冲出扇区外沿 → 按扇区宽度封顶缩放。
- 近景审查：12 个机位、停机坪机库/油车/全景、城镇航线播放与退出、图鉴 3 项（脚本 cmp/vis/sv_views.py / sv_apron.py / sv_rt2.py / sv_rt3.py / sv_arm.py）。
- 未改：航线里城镇上空的训练热气球（靶标原设计）。
