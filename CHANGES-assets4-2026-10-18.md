# CHANGES assets4 — 2026-10-18：团结 AI 生成的 7 个模型接入（真人步兵、平民、武装皮卡、摩托侦察兵、仓库、两层民房）

状态：代码已入 src / 构建通过（node build.mjs Exit 0，dist/index.html 1999 KB（+15 KB），73 模块（+1：27-life.js），bundle_sha256=f3f34676…3faf）

## 资产（assets/targets，AIGC，见 CREDITS.md「AI 生成模型」+ AIGC-NOTICE.txt）
- 用户在 Codely 生成（Rodin 出模 + UniRig 绑骨），Hark 只压贴图：人物 512px（gt/proc_char.mjs，保留骨骼/动画并写 AIGC 标识）、车辆/建筑 1024px（gt/proc.mjs，不减面）。
- 体积：soldier_rifle 1.1 MB、soldier_rpg 1.4 MB、civilian 0.7 MB、technical 1.2 MB、moto_scout 1.1 MB、warehouse 0.8 MB、house_2f 0.7 MB。
- 授权：Tuanjie Codely 条款 §8.4 生成内容版权由使用者维护；§4 对外发布需声明 AI 生成 → CREDITS.md 与菜单署名行已声明；§3.1g 不得删 AIGC 标识 → asset.extras 保留。

## 改动
1. **步兵换真人动画模型**（27-infantry）
   - 新 `bakeClipPoses(gltf, H)`：AnimationMixer 采样 Idle 1 帧 + Walk 6 帧 + Run 6 帧，每帧 CPU 蒙皮成静态几何（扣髋骨水平位移=原地动作；最低点贴地）。每种(兵种×帧)一个 InstancedMesh（26 个，空帧不绘制）。武器为模型自带，删除旧的程序化枪管/火箭筒拼接与 survivor.glb 姿势表。
   - 新增巡逻：每队第 2、3 人沿 1.8u 岗线来回走（0.55u/s，端点停 2–3 秒）；奔逃用跑步帧。倒地 = 站立帧放倒。
   - 兼容：旧版 three 无 BufferAttribute.getComponent → 骨骼索引/权重先解平铺数组。
2. **新模块 27-life.js：平民 + 摩托侦察兵**（BattleLife）
   - 平民 6 人（仅城镇关 3-3）：人行道散步；直升机低空逼近 / 爆炸 / 子弹打在身边 → 奔逃 4–6 秒后原地蹲守。误伤：−150 分（arcade.addBonus 负分）+ 提示 + 战报"来源"行显示扣分（m.civKills）。不进 targets，不影响通关/锁定/自动瞄准。
   - 摩托侦察兵：基地进场土路 2 辆来回（与步兵同条件出现）、城镇外环 1 辆（城镇关）。5u/s，直升机 35u 内 7.5u/s + 蛇形 + 侧倾；尾部扬尘（粒子池富余时）。机炮一发/爆炸波及 → 爆炸、侧翻、烧黑、冒烟 6 秒。计分 arcade 'moto' 120 分，战报名"摩托侦察兵"。
   - 接线：70-app `life`；70-start 构造 + rig.onInfantryHit / onBlast 联动；70-loop 每帧 update；70-mission reset；72-uibind `__dbg.life`。webdriver 默认不出现（同步兵，老测试不受影响）。
3. **武装皮卡**（16-targetmodels）：TARGET_MODELS.technical（len 2.33u，wNarrow 1.9/2.35 只压车宽）；新增 INSURGENT_VARIANTS（卡车池 technical / ural / technical），只给城镇伏兵（16-town）与峡谷伏兵（16-valley）用；基地正规军停放线不变。`pickVariant(type, n, pool)` 加可选池参数。
4. **城镇楼换真模型外壳**（16-targetprops `skinTownBuilding` + 16-town）：仓库(idx2)→warehouse（门朝主街），民居(idx5)、原"车库"(idx8，改名"民房")→house_2f（阳台朝横街）。分轴缩放到原楼尺寸（命中盒/遮挡/塌方不变），隐藏程序化墙体；半毁变暗、重置还原同步到外壳材质。
5. 署名/文档：CREDITS.md 新增 AIGC 节、#ln-credit 加 AI 生成声明、assets/targets/AIGC-NOTICE.txt、module-contracts 同步。

## 验证
- pytest tools/tests_pure 91 passed；check_dom_ids ✓；check_topology_selftest 8/8。
- 浏览器：test_target_len_yaw PASS（基地变体不变）；test_town PASS（建筑命中/塌方/伏兵/重置）。
- 截图：/workspace/work/cmp/vis/shot_a4.py base|town → assets4_preview.jpg（城镇俯瞰、巡逻小队、平民、武装皮卡、摩托、爆炸后倒地/奔逃）。

## 未做
- 皮卡机枪/车轮可转：模型是整体一块；需要时用几何切分（同坦克炮塔做法）。
- 人物举枪瞄准/蹲下动作：生成模型只带 Idle/Walk/Run，瞄准时用站立帧。
