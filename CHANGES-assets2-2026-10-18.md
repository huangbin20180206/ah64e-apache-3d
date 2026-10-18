# CHANGES assets2 — 2026-10-18：第二批真人制作免费模型（军车/直升机/无人机/布景道具）

状态：代码已入 src / 构建通过（node build.mjs Exit 0，dist/index.html 1980 KB（+2 KB），71 模块，bundle_sha256=9d0c28eb…625e）

许可原则（用户 2026-10-18）：仓库公开，只用 CC0 / CC BY；全部作者见 CREDITS.md、各 `*-LICENSE.txt`、主菜单底部 #ln-credit。

## 改动
1. **目标变体轮换**（16-targetmodels）：新增 `TARGET_VARIANTS` / `VARIANT_LABEL` / `pickVariant(type, n)`；
   16-targets / 16-town / 16-valley 统一按同类序号轮换壳（只换外观与名称，命中/血量/移动仍按 type）。
   - 坦克池：原版坦克 → BMP-2 → **BTR-80 装甲车**（apc，yaw −90°，车长 3.37u=7.65m，42manako）
   - 卡车池：原版卡车 → **乌拉尔-4320 军卡**（ural，3.26u，davidbroutian）→ **M978 HEMTT 油罐车**（fuel，4.2u，42manako）
2. **靶机 → 沙赫德-136 无人机**（26-airtargets，shahed.glb，faintastic18）：机头 +Z→+X，机身长 1.9u，加载失败保留程序化靶机；plane.glb 不再加载。
3. **2 号敌机 → Mi-8**（88-enemyvis，mi8.glb，jeandiz）：两架敌机分别 Mi-24 / Mi-8；换壳逻辑改成 shells 表；Mi-8 主旋翼 Rotor_Hub 绕自身 Z 转（`ud.axis='z'`），尾桨 rotor_q 绕 X。
4. **新模块 16-targetprops.js**：不可破坏布景道具（不进 targets、不挡子弹），异步挂入父组、显隐随父组：
   - 基地：储油罐 ×2（强制实心材质）、油桶 ×2 组、弹药箱 ×3、进场土路道闸 + 岗亭检查站
   - 城镇：东口加油站、西郊 6 栋混凝土民房（从套件 GLB 按节点名逐栋取出，three 节点名空格→下划线）、废弃轿车、旧厢式货车、油桶
   - 入口：buildRangeScenery 末尾 `placeRangeProps(g, BC)`；TownRange._build `placeTownProps(g, C)`
5. **模型处理**：gltf-transform 4 去重焊接 + meshoptimizer 减面 + 贴图缩到 512/1024 转 JPEG（/workspace/work/gt/proc.mjs）；
   BTR-80 / 乌拉尔 / HEMTT 原点偏离几何中心（BTR 偏 1400+ 单位，导致换壳后车体不见）→ recenter.mjs 烘焙居中、底面 y=0。
6. 署名：CREDITS.md +14 行、assets/targets/*-LICENSE.txt ×14、#ln-credit 改为作者名单。
7. docs/module-contracts.md 同步（contract_sync）；tools/tests/test_target_len_yaw.py：新增 ural/fuel/apc 车长断言，yaw 无关性改由卡车池承担（坦克池只剩 1 辆原版）。

## 未做（原因）
- ZSU-23-4：唯一可用模型无贴图、颜色像玩具；SA-8 Osa：减面后仍 18 万面、19 MB，太重 → 留给 Codely 或另找。
- 巡逻艇（已下载，场景无水域航线）、摩托（文件是 7 辆一排的合集，需拆）→ 下一批。
- 燃烧车残骸合集加载报错、Desert Houses 合集包围盒异常、迷彩帐篷与沙漠不搭 → 未用。

## 验证
- pytest tools/tests_pure：91 passed；check_dom_ids ✓；check_topology_selftest 8/8；拓扑违规 0。
- 浏览器：test_target_len_yaw PASS、test_enemyair PASS、test_town PASS。
- 截图：/workspace/work/cmp/vis/shot_a2.py（a2_*、t_*）、shot_air2.py。
- GPU 门禁仍需用户电脑：`powershell -File tools/run_tests.ps1`
