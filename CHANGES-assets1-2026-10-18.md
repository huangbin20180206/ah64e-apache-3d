# CHANGES assets1 — 2026-10-18：首批真人制作免费模型（BMP-2 + Mi-24）+ 坦克朝向修正

状态：代码已入 src / 构建通过（node build.mjs Exit 0，dist/index.html 1971 KB，bundle_sha256=44cc5bef…c41d）

## 改动
1. **BMP-2 步战车**（assets/targets/bmp2.glb，2.0 MB，3.4 万三角面，CC BY 4.0 KojfDiscord）
   - 16-targetmodels：TARGET_MODELS.ifv（len 2.96u = 6.72m，yaw 0）+ `targetModelKey(t)`（t.mdl 变体优先）。
   - 16-targets / 16-town / 16-valley：坦克池奇数号 `mdl='ifv'`、名称"BMP-2 步战车"；命中/血量/移动仍走 tank 逻辑。
   - 截图核验：车头炮管朝行驶方向、后舱门朝车尾；击毁后烧焦残骸正常。
2. **Mi-24 敌机**（assets/targets/mi24.glb，0.4 MB，4237 三角面，CC BY 4.0 duanesmind）
   - 88-enemyvis：异步加载换壳，机身长 7.7u（17.5m），Top_Rotor 主旋翼 / Tail_Rotor 尾桨程序旋转；加载前/失败保留程序化机体。
3. **坦克横着开（旧 bug）修正**：实测 tank.glb 车长沿模型 Z、炮管朝 +X，旧 yaw=π/2 让坦克与履带印/行驶方向垂直 → yaw 0。
4. **00-utils mergeGeos**：交错/量化属性逐分量拷贝（Sketchfab GLB 为交错存储，原整块 set 越界抛错导致整批换壳中断）。
5. **署名**：CREDITS.md（全部第三方素材）、assets/targets/{bmp2,mi24}-LICENSE.txt、主菜单底部 #ln-credit 一行致谢。
6. tools/tests/test_target_len_yaw.py：按 mdl 分组 + 新增 A3 BMP-2 车长断言；顶点读取改 fromBufferAttribute。
7. docs/module-contracts.md：targetModelKey 契约同步。

## 验证
- pytest tools/tests_pure：91 passed；check_dom_ids ✓；check_topology_selftest 8/8。
- 浏览器：test_target_len_yaw PASS（tank 4.3 / truck 3.1 / ifv 2.96），test_enemyair PASS。test_targets_mov = 已知沙箱实时帧 env-fail。
- 截图：cmp/vis/shot_bmp.py、shot_bmpw.py、shot_mi24.py。

## 素材处理
gltf-transform 4.5.1 weld+simplify（BMP-2）；贴图 ≤1024 转 JPEG（/workspace/work/sf/rejpg.py）。未用 meshopt：新导出件 meshopt 后在本项目加载显示异常，待查。
