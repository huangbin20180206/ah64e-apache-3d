# AH-64E 阿帕奇游戏 · 3D 资产需求文档

> 用途：交给文生 3D 的 AI Agent 批量生成模型。生成后把所有文件打包交回，由 Hark 检查后决定原样使用、压缩使用或修改后使用。
> 版本：2026-10-17 · 项目：huangbin20180206/ah64e-apache-3d

---

## 0. 给生成 Agent 的总说明（请先读）

### 0.1 游戏背景
网页 3D 直升机射击游戏（three.js，浏览器运行，也要能在手机上玩）。玩家驾驶 AH-64E 阿帕奇，在**中东沙漠地区**作战：沙漠、干河谷、小镇、敌方基地、夜战。镜头多数时候从 50–300 米外俯视，偶尔低空掠过到 20 米内。

### 0.2 统一风格（每个提示词都已包含，不要改）
写实、现代军事、中东沙漠、旧、有灰尘和磨损；颜色以沙黄、橄榄绿、褪色白、锈色为主；**不要卡通、不要低多边形风格化、不要科幻**。

### 0.3 硬性技术要求
| 项目 | 要求 | 为什么 |
|---|---|---|
| 格式 | **GLB**（贴图打包在文件里） | 游戏直接读取 |
| 每个文件 | **只放一个物体**，不带地面、底座、背景、展示台 | 要放进不同关卡 |
| 面数 | 小物件 ≤ 10,000 面；车辆/建筑 ≤ 30,000 面；人物 ≤ 15,000 面 | 面太多手机卡 |
| 贴图 | 2048×2048 以内（PBR：颜色/法线/粗糙度金属度） | 4K 只会变大，看不出区别 |
| 光照 | **不要烘焙光照和阴影**到贴图里（albedo 要干净） | 游戏有白天/黄昏/夜战，烘焙阴影会穿帮 |
| 朝向 | 车头/人脸朝 **+Z**，Y 轴朝上，底部贴着 Y=0 | 方便统一摆放 |
| 尺寸 | 按**真实米制尺寸**（每项都写了） | 游戏按比例缩放 |
| 原点 | 放在物体底部中心 | 方便贴地 |
| 文件名 | 用下表的英文文件名，如 `bmp2.glb` | 方便对应 |
| 版权 | 生成工具的条款必须允许**免费公开使用**（放 GitHub 公开、发给朋友玩） | 项目是公开仓库 |

### 0.4 可动部件（工具支持就做，不支持就整体一个模型也可以）
很多目标要"动起来"才有真实感。如果工具支持**分部件导出**，请按每项写的"可动部件"拆成**独立命名的节点**（同一个 GLB 内，节点名用英文，如 `turret`、`barrel`、`rotor_main`、`wheel_FL`）。做不到也没关系，Hark 会自己处理。

### 0.5 人物额外要求
人物要**带骨骼（humanoid rig）**，如果工具能附带动作，请附带：`idle`（站立）、`walk`（走）、`run`（跑）、`aim`（举枪瞄准）、`crouch`（蹲下）、`die`（倒地）。动作越全越好，没有也可以只给 T-pose 带骨骼。

### 0.6 交付
- 全部 GLB 放一个文件夹，压缩包交回。
- 附一个 `list.txt`：每行 `文件名 | 生成工具名 | 是否带部件/骨骼/动作 | 备注`。
- 同一项可多生成 1–2 个版本（文件名加 `_v2`），Hark 挑最好的。

---

## 1. 优先级说明

- **A 级 = 会动的打击目标**（本次重点，先做）
- **B 级 = 场景建筑和可炸物件**（让战场更像真的）
- **C 级 = 非打击目标**（平民车辆等，用于增加真实感和"不能乱打"的判断）

建议第一批先做 A1–A8 共 8 个试水，效果好再做其余。

---

## 2. A 级：会动的打击目标

> 每项都写了游戏里**怎么动**，让你知道为什么要它；生成 Agent 只需要看"提示词"和"要求"。

### A1 步兵战车 BMP-2 · `bmp2.glb`
- 真实尺寸：长 6.7 m × 宽 3.2 m × 高 2.5 m；面数 ≤ 30k
- 可动部件：`turret`（炮塔）、`barrel`（炮管）
- 游戏里怎么动：沿公路巡逻 → 发现直升机后离开公路、开到房屋或沙丘后面躲藏，炮塔转向直升机开火。
- 提示词：
  `BMP-2 infantry fighting vehicle, Soviet tracked armored vehicle with small turret and 30mm autocannon, desert sand camouflage paint faded and chipped, dust on tracks and lower hull, realistic military 3D model, PBR textures, no baked lighting, no ground, no base, single object, game-ready, medium poly`

### A2 八轮装甲运兵车 BTR-80 · `btr80.glb`
- 真实尺寸：长 7.7 m × 宽 2.9 m × 高 2.4 m；面数 ≤ 30k
- 可动部件：`turret`、`wheel_1`…`wheel_8`
- 怎么动：车队中间段，在公路上跑；遇袭后加速冲向最近的小镇。
- 提示词：
  `BTR-80 8x8 wheeled armored personnel carrier, small machine gun turret on top, faded olive and sand paint, mud and dust on wheels, realistic military vehicle, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A3 武装皮卡（技术车）· `technical.glb`
- 真实尺寸：长 5.3 m × 宽 1.9 m × 高 2.6 m（含机枪）；面数 ≤ 20k
- 可动部件：`gun`（车斗机枪，可转）、`wheel_FL/FR/RL/RR`
- 怎么动：速度快、走"之"字形、越野穿插；被打中一半会翻车或停下，枪手跳车逃跑。这类目标是"会动的打击目标"的主力，数量最多。
- 提示词：
  `armed pickup truck technical, white Toyota Hilux style double cab, heavy machine gun DShK mounted on the bed, dented body, rust, dust and dirt, desert insurgent vehicle, realistic, PBR textures, no baked lighting, no ground, no people, single object, game-ready, low-medium poly`

### A4 军用卡车（帆布篷）· `cargo_truck.glb`
- 真实尺寸：长 7.4 m × 宽 2.5 m × 高 2.9 m；面数 ≤ 25k
- 可动部件：`wheel_*`
- 怎么动：补给车队，基地 ↔ 弹药库来回跑；会在检查站停车装卸几秒。
- 提示词：
  `Ural-4320 military cargo truck with canvas covered cargo bed, 6x6, olive drab faded paint, dusty, realistic military truck, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A5 油罐车 · `fuel_truck.glb`
- 真实尺寸：长 8.0 m × 宽 2.5 m × 高 3.0 m；面数 ≤ 25k
- 可动部件：`wheel_*`
- 怎么动：车队里的高价值目标，被击中会大爆炸并引燃旁边车辆；会给 SAM 阵地送油。
- 提示词：
  `military fuel tanker truck, 6x6 cab with cylindrical fuel tank trailer body, faded sand paint, warning markings, oil stains and dust, realistic, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A6 自行高炮 ZSU-23-4 石勒喀 · `zsu234.glb`
- 真实尺寸：长 6.5 m × 宽 3.1 m × 高 2.6 m（不含雷达）；面数 ≤ 30k
- 可动部件：`turret`、`guns`（四联炮，可俯仰）、`radar_dish`（会转）
- 怎么动：在几个隐蔽点之间换位，停下后雷达转、炮塔指向直升机射击；打完一轮就挪窝。
- 提示词：
  `ZSU-23-4 Shilka self-propelled anti-aircraft gun, tracked vehicle with large flat turret, four 23mm autocannons, dish radar on rear of turret, desert camouflage faded, dusty, realistic military 3D model, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A7 机动防空导弹车 SA-8 · `sa8.glb`
- 真实尺寸：长 9.1 m × 宽 2.8 m × 高 4.2 m（雷达升起）；面数 ≤ 30k
- 可动部件：`turret`（导弹+雷达整体转）、`radar`
- 怎么动："打了就跑"：停下 → 雷达开机（玩家告警器响）→ 发射 → 立刻开走换位置。
- 提示词：
  `9K33 Osa SA-8 Gecko mobile surface-to-air missile system, 6x6 amphibious wheeled vehicle, rotating turret with radar and four missile launch rails, sand and green camouflage faded, dusty, realistic, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A8 步兵（步枪手）· `soldier_rifle.glb`
- 真实身高 1.78 m；面数 ≤ 15k；**带骨骼 + 动作（见 0.5）**
- 怎么动：成队巡逻、下车展开、跑向掩体、趴下射击；被打散后逃跑。
- 提示词：
  `insurgent soldier, middle eastern militia fighter, wearing shemagh scarf, worn desert camouflage jacket and cargo pants, chest rig, holding AK-47 rifle, realistic human proportions, full body, A-pose or T-pose, PBR textures, no baked lighting, rigged humanoid, game-ready character`

### A9 步兵（火箭筒手）· `soldier_rpg.glb`
- 同 A8 规格，带骨骼 + 动作
- 怎么动：躲在屋顶或墙后，起身扛 RPG 瞄准直升机发射，然后蹲回去。
- 提示词：
  `insurgent soldier carrying RPG-7 rocket launcher on shoulder, middle eastern militia fighter, balaclava, worn khaki clothing, ammunition bag with spare rockets on back, realistic human proportions, full body, A-pose, PBR textures, no baked lighting, rigged humanoid, game-ready character`

### A10 武装直升机 Mi-24 雌鹿 · `mi24.glb`
- 真实尺寸：长 17.5 m（不含旋翼）× 旋翼直径 17.3 m × 高 6.5 m；面数 ≤ 30k
- 可动部件：`rotor_main`、`rotor_tail`（**必须**拆开，旋翼要转）
- 怎么动：空战关卡的敌机，绕基地巡逻 → 发现玩家后转向对冲、射火箭，受伤冒烟后往回逃。
- 提示词：
  `Mi-24 Hind attack helicopter, tandem bubble canopies, stub wings with rocket pods, five-blade main rotor, desert camouflage brown and sand, faded, realistic military helicopter, separate main rotor and tail rotor objects, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A11 运输直升机 Mi-8 · `mi8.glb`
- 真实尺寸：长 18.2 m × 旋翼直径 21.3 m × 高 5.6 m；面数 ≤ 30k
- 可动部件：`rotor_main`、`rotor_tail`、`door`（侧门）
- 怎么动：飞来降落 → 放下一队步兵 → 起飞离开；在降落时打掉它得高分。
- 提示词：
  `Mi-8 Hip transport helicopter, large cabin with sliding side door, five-blade main rotor, faded olive green and sand camouflage, realistic military helicopter, separate main rotor and tail rotor, PBR textures, no baked lighting, no ground, single object, game-ready, medium poly`

### A12 自杀式无人机 · `drone_shahed.glb`
- 真实尺寸：长 3.5 m × 翼展 2.5 m；面数 ≤ 6k
- 可动部件：`prop`（尾部螺旋桨）
- 怎么动：成串低空直线飞向我方基地，玩家要在它们抵达前拦截。
- 提示词：
  `Shahed-136 style delta wing loitering munition drone, pusher propeller at rear, grey and tan paint, simple realistic, PBR textures, no baked lighting, single object, game-ready, low poly`

### A13 武装摩托车（含骑手）· `moto_scout.glb`
- 真实尺寸：长 2.1 m × 高 1.7 m（含人）；面数 ≤ 12k
- 可动部件：`wheel_F`、`wheel_R`
- 怎么动：侦察兵，两三辆一组高速穿越河谷，很难打中。
- 提示词：
  `dirt motorcycle with an insurgent rider in shemagh and desert clothing, rifle slung on back, dusty off-road bike, realistic, riding pose, PBR textures, no baked lighting, no ground, single object, game-ready, low-medium poly`

### A14 河道巡逻艇 · `patrol_boat.glb`
- 真实尺寸：长 9 m × 宽 2.8 m × 高 2.5 m；面数 ≤ 20k
- 可动部件：`gun`
- 怎么动：沿河岸和水边巡逻，船尾拖白浪；被打中后冲向岸边搁浅。
- 提示词：
  `small armed river patrol boat, open fiberglass hull, heavy machine gun on bow, outboard engines, faded grey and tan, weathered, realistic, waterline visible, PBR textures, no baked lighting, no water, single object, game-ready, medium poly`

---

## 3. B 级：场景建筑与可炸物件

| 编号 | 文件名 | 是什么 | 尺寸（长×宽×高 m） | 面数 | 提示词 |
|---|---|---|---|---|---|
| B1 | `house_1f.glb` | 单层平顶土坯/水泥房 | 8×6×3.5 | ≤ 10k | `single-story middle eastern flat roof house, plastered mud brick and concrete walls, small windows with metal grilles, wooden door, water tank on roof, sand colored, weathered and dusty, realistic, PBR textures, no baked lighting, no ground, single building, game-ready` |
| B2 | `house_2f.glb` | 两层带阳台小楼 | 10×8×7 | ≤ 15k | `two-story middle eastern concrete house with balcony and outdoor staircase, flat roof with low parapet, satellite dish, faded beige paint, cracks and stains, realistic, PBR textures, no baked lighting, no ground, single building, game-ready` |
| B3 | `warehouse.glb` | 铁皮仓库 | 20×12×7 | ≤ 10k | `corrugated metal warehouse with large sliding door, rusty roof panels, desert industrial building, faded, realistic, PBR textures, no baked lighting, no ground, single building, game-ready` |
| B4 | `fuel_tank.glb` | 储油罐 | 直径 8 × 高 6 | ≤ 8k | `cylindrical fuel storage tank with ladder and pipes, faded white paint with rust streaks, oil stains, realistic industrial, PBR textures, no baked lighting, no ground, single object, game-ready` |
| B5 | `gas_station.glb` | 小加油站（带棚） | 14×10×5 | ≤ 15k | `small rural middle eastern gas station with canopy and two fuel pumps, small shop building, faded signs, dusty, realistic, PBR textures, no baked lighting, no ground, single object, game-ready` |
| B6 | `command_tent.glb` | 指挥帐篷 | 8×5×3 | ≤ 6k | `military command tent, large canvas tent with antenna mast and camouflage net, sand color, realistic, PBR textures, no baked lighting, no ground, single object, game-ready` |
| B7 | `ammo_stack.glb` | 弹药箱堆 | 3×2×1.5 | ≤ 5k | `stack of olive green military ammunition crates with stencil markings, wooden and metal boxes, dusty, realistic, PBR textures, no baked lighting, no ground, single object, game-ready, low poly` |
| B8 | `oil_drums.glb` | 油桶一组（6–8 个） | 2.5×2×1 | ≤ 5k | `cluster of rusty 200 liter oil drums, some red some blue, dented, oil stains, realistic, PBR textures, no baked lighting, no ground, game-ready, low poly` |
| B9 | `car_wreck.glb` | 烧毁的轿车残骸（布景） | 4.5×1.8×1.3 | ≤ 8k | `burned out abandoned sedan car wreck, charred black and rust, no wheels, broken windows, desert, realistic, PBR textures, no baked lighting, no ground, single object, game-ready` |
| B10 | `checkpoint.glb` | 路障检查站（栏杆+岗亭+水泥墩） | 8×4×3 | ≤ 10k | `military road checkpoint, small guard booth, striped boom barrier, concrete jersey barriers and sandbags, desert, weathered, realistic, PBR textures, no baked lighting, no ground, single object, game-ready` |

---

## 4. C 级：非打击目标（增加真实感）

| 编号 | 文件名 | 是什么 | 尺寸 | 面数 | 提示词 |
|---|---|---|---|---|---|
| C1 | `civ_sedan.glb` | 平民旧轿车（会在路上跑，**误伤扣分**） | 4.5×1.8×1.5 | ≤ 10k | `old civilian sedan car, white or beige, dusty and dented, middle eastern street, realistic, PBR textures, no baked lighting, no ground, single object, game-ready, separate wheels` |
| C2 | `civ_van.glb` | 平民小货车 | 4.8×1.8×2.0 | ≤ 10k | `old civilian minivan delivery van, faded paint, roof rack with luggage, dusty, realistic, PBR textures, no baked lighting, no ground, single object, game-ready` |
| C3 | `civilian.glb` | 平民（带骨骼，走/跑动作） | 身高 1.7 | ≤ 12k | `middle eastern civilian man in long traditional robe and head scarf, realistic human proportions, full body, A-pose, PBR textures, no baked lighting, rigged humanoid, game-ready character` |

---

## 5. Hark 收到后会做什么（供参考，生成 Agent 不用管）
1. 检查每个模型：面数、贴图大小、比例、朝向、有没有烘焙阴影。
2. 太重的压缩瘦身；没拆部件的，炮塔/旋翼由 Hark 自己切出来。
3. 统一缩放到游戏比例，给每个打击目标配烧焦残骸版本。
4. 设计移动路线：公路车队、巡逻环线、遇袭后找掩体、"打了就跑"的防空车、直升机降落放兵、无人机来袭波次、河道巡逻；让目标沿道路和地形走，不穿墙、不开进水里。
5. 按关卡分配（训练营少量慢目标；基地防线车队+无人机；城镇突击技术车+步兵+平民车；压制防空 ZSU/SA-8；制空作战 Mi-24/Mi-8；终关全部混合）。
