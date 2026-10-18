# ASSETS5 — 团结 AI 第二批 25 个模型接入（2026-10-19）

状态：代码已入 src / 构建通过（node build.mjs Exit 0，dist/index.html 2011 KB，71 模块，bundle_sha256 e6bd7f54…9c89）。
完整 GPU 回归仍需在用户电脑跑 `powershell -File tools/run_tests.ps1`。

## 资产处理
- 来源：用户 Codely 生成包 apache_assets_2.zip（25 GLB，原始 ≈280 MB）。
- 非角色：去重/焊接/按目标面数减面（车辆 ≤25k、建筑 ≤16k、道具 6–10k），贴图 1024/512 → 合计 ≈25 MB。
- 角色：保留骨骼与 Idle/Walk/Run 动画，仅压贴图 512。
- 全部写回 asset.extras AIGC 标识（author=unity / copyright=tjai / aigc=…）；CREDITS.md 与 AIGC-NOTICE.txt 已补第二批清单。

## 玩法接入
- 27-infantry：兵种 4 种（INF_KINDS s/g/m/o）。每队队长：1 队指挥官、2/3 队 PKM 机枪手（3 发连射，间隔 0.12s，串间 2.4–3.6s）；击毙信息流显示兵种名。机枪手/指挥官模型缺失时退回步枪兵外观。
- 27-life：平民 3 种外观（长袍男/黑袍女/拄拐老人，老人走跑 ×0.7），城镇 6→9 人。城镇外环新增 3 辆民用车（轿车/小巴/货车），逆向车道 3u/s，受惊 6u/s；会为前方行人停车；机炮 3 发或爆炸 → 起火烧黑，算误伤（同平民 −150，提示"误伤平民车辆"）。
- 16-targetmodels：新壳 zsu（石勒喀 2.86u）、bm21（3.24u）、technical2（高炮皮卡 2.29u）。叛军池（城镇/峡谷）：tank [zsu, ifv, apc]，truck [technical, bm21, technical2]。基地正规军池不变（test_target_len_yaw 依赖）。
- 16-targetprops（装饰，不参与命中）：
  - 基地：3 顶真帐篷（替换程序化帐篷）、发电机、南门两侧 DShK 掩体、门外碉堡、东侧 ZU-23 阵地、西侧迫击炮阵地、集装箱、墙外通信铁塔（25m）、土路边烧毁轿车、门口两棵椰枣树。
  - 城镇：北巷以北清真寺（地标）、三间铺面、3 个集市摊、集装箱、废车、8 棵椰枣树。
- 16-town：水塔楼换高架水塔外壳；北排民居（idx6）换一层院落房外壳，楼高 2.8→2.3（≈5.2m，免外壳拉伸）。命中盒/塌方逻辑不变。
- 16-targetscenery：程序化帐篷停用。

## 已知限制
- 车辆为整体单网格：石勒喀炮塔转动依赖 splitTurretGeo 自动切分，效果待实机看；BM-21 发射架不能单独动。
- 清真寺宣礼塔偏矮（14m）；集装箱模型接近 15 尺箱，已按 20 尺长度摆放。
- 椰枣树为实体叶片（无透明裁切），远看可，近看偏硬。

## 测试
- tests_pure 91 passed；check_dom_ids ✓；check_topology_selftest 8/8。
- 截图核验：/workspace/work/cmp/vis/shot_a5.py base|town（基地全景/帐篷/门岗/高炮阵地/铁塔/混编小队；城镇全景/清真寺/水塔/民用车/平民）。
