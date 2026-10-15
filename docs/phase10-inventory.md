# Phase 10 — 源资产/工具链盘点与判定（P10-INVENTORY）
记录时间：2026-09-08（Phase 10 开工盘点，编辑任何文件前重新核对）

## 1. 基线核对
- HEAD == origin/main == 9b4304b（0/0 同步）；工作区曾有未提交的正式派工文档修改（架构方放置），已固化提交 42c69f5（docs: Phase 10 正式派工指令），此后工作区 clean。
- 后续所有范围计算以 `9b4304b..HEAD` 对比（派工文档 42c69f5 属架构方放置，与 P9 同例——不入 Phase 10 业务交付范围判定，另行说明）。

## 2. assets/ Apache 相关文件 SHA-256（本批基线）
| 文件 | 大小 | SHA-256（前16） |
|---|---|---|
| assets/apache_v2.glb | 4,748,432B | 6A451ED7157F7556 |
| assets/skin_army.jpg | 229,308B | DF521C008496C294 |
| assets/targets/plane.glb | 3,170,236B | CAE3A310D6F65317 |
| assets/targets/tank.glb | 3,260,944B | A642622C488CF9E8 |
| assets/targets/truck.glb | 3,261,596B | 27684FA8A063C256 |
（_raw FBX/CC0 原始件不入 dist，仅存档）

## 3. apache_v2.glb 运行时几何盘点（页面内探针实证，总 177,879 tri）
- 节点树：AC_Root → 37 子（MainRotor_Pivot / TailRotor_Pivot / Radar_Pivot / 9×地狱火 Cylinder group / 3× 轮组 group / BODY / BODY001 / 链炮 Cylinder014.css 等）
- 优先部件几何/UV/法线现状：
  - 机首光电塔：Cube001_5 (lens) 356tri，有 N/UV；TADS/PNVS 附近无独立外框/护圈细节小件
  - 座舱框：Cube001_6 (CanopyFrame) 704tri；座舱玻璃 Cube001_2 (Glass) 600tri——近景玻璃有 P9 反射，框体无厚度/铰链层次
  - 30mm 链炮：Cylinder014 (Material.002) 2758tri + 炮管 BezierCurve (Material) 5712tri——有基础轮廓，无弹箱/供弹管/炮口层次
  - 旋翼头：Cylinder038_2/020_2 (RotorHub) 7352+4456tri + RotorLink——近景已是中等密度，可控
  - 发动机/排气：Cube001_9 (Exhaust) 1330tri——P9 已加积碳材质细节；几何无排气口环/散热鳍
  - 起落架轮组：wheel 320tri/轮 + Rim 1404tri ×3，**无 UV**（纯色塑料感，P9 无法贴图表达）——近景最弱
  - 挂架：Cube007_1 (Gun) 6872tri / Cube007 (Body) 7448tri
- 材质契约：USMC_LowVis_* 命名；P9 强耦合点=材质名（ARMY_OVERRIDE/_envBoost/_visualTokens/SKIN_DETAIL_MATS/detailMap/setScheme 全按名匹配）+ Body/Tail UV 大区（detailMap 合成）

## 4. build.mjs 资产复制规则
- dist 硬编码复制：apache_v2.glb、skin_army.jpg；assets/targets/*.glb（排除 *_raw）
- 新增运行时资产必须同步改 build.mjs（P9 教训：TARGET_MODELS 曾与 dist 不同步致 404）

## 5. Blender 工具链
- Blender 5.2.0 LTS CLI：`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` 可执行（--version 正常）
- tools/fbx2glb.py 存在（P8 已验证归一化管道：Blender 无头 -b -P）
- 无 blender-mcp（仅 CLI——指令允许"已有可验证资产和可复现本地流程下继续"，CLI -b -P 脚本即可复现）

## 6. 判定（P10 §3 硬门）
**受限执行**：
- 源：仅 apache_v2.glb（无 .blend/.fbx 源）。主 GLB 被 P9 材质名契约强耦合（setScheme/_envBoost/ARMY_OVERRIDE/SKIN_DETAIL_MATS 全按材质名），任何"导入→改模→导出覆盖主 GLB"的 Blender 往返都会冒破坏材质名/UV 布局/贴图引用的高风险（GLTF 导入导出不保证保留全部命名与 UV 细节），且指令 §6 要求保留 P9 基线可回退副本。
- 路线：**独立小件 GLB 资产**（Blender 5.2 CLI 程序化建模重点区域细节件→导出小 GLB→运行时挂到现有锚节点），主 GLB 零改动、P9 材质契约零风险、来源/导出/哈希全可复现、tri/draw/体积预算精确可控。≤3 个重点区域完成几何级增量，未完成区域如实列出原因。
- 硬门满足：不下载未知资产；Blender CLI 可复现；主 GLB 不被覆盖；高模不进入 dist（小件即网页低模，建模期无高模烘焙额外资产）。
- 未完成/受限原因：座舱内部舱壁、传动轴内部细节、变速箱内构等（受制于 GLB 无源文件、近景不可见或需高模烘焙才有效）——如实列于 SUMMARY，不静默移交 Phase 11/12。

## 7. 运行时预算基线（9b4304b 实测，待 P10 全量采样复核）
- tri：模型 177,879（场景总 tri 随地形：pad 406,649 / grass 1,086,651 / desert 518,937 / water 577,694 @q1）
- draw：pad 185 / grass 187 / desert 187 / water 274 @q1
- 体积：apache_v2.glb 4.7MB + skin_army + targets
- P10 硬上限：tri +≤15%（≤约26k 模型增量）、draw +≤8、加载体积 +≤15%