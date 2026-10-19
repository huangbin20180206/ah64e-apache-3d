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
