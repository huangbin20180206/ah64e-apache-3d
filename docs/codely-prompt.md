你是 3D 资产生成助手。请用 Tuanjie AI Generator 为一款网页 3D 直升机射击游戏（three.js，浏览器运行，手机也要能玩）生成下面 7 个资产。玩家驾驶 AH-64E 阿帕奇在中东沙漠地区作战，镜头多数在 50–300 米外俯视，偶尔低空掠过到 20 米内。

【统一风格】写实、现代军事、中东沙漠、旧、有灰尘和磨损；颜色以沙黄、橄榄绿、褪色白、锈色为主。不要卡通、不要低多边形风格化、不要科幻。

【统一技术要求（每个都必须满足）】
1. 格式 GLB，贴图打包在文件里。导不了 GLB 就给 FBX + 贴图文件夹。
2. 每个文件只放一个物体：不要地面、底座、展示台、背景。
3. 面数上限：人物 ≤ 15,000 三角面；车辆 ≤ 20,000；建筑 ≤ 10,000。超了用自带的模型优化减面。
4. 贴图 ≤ 2048×2048，PBR（颜色/法线/粗糙度金属度）。不要把光照和阴影烘焙进颜色贴图（游戏有白天、黄昏、夜战）。
5. 朝向：车头、人脸朝 +Z，Y 轴朝上，底部贴 Y=0，原点在底部中心。
6. 按真实米制尺寸（每项写了）。
7. 能用参考图就用图生 3D / 多视图生成；有可动部件的用「拆件模型」，部件做成独立命名的节点（名字见每项）。做不到拆件就整体一个模型。
8. 人物用「带动画 3D 角色」功能：要人形骨骼，尽量附带动作 idle、walk、run、aim、crouch、die（有几个给几个，最少给带骨骼的 T-pose/A-pose）。
9. 生成工具的条款必须允许免费公开使用（放 GitHub 公开仓库、发给朋友玩）。如果某个底层模型的条款不允许，换一个。
10. 每项先生成 1 个，截图检查外形（轮子数、枪的位置、人体比例），不对就重来。好的可以多给一个 _v2 版本。

【要生成的资产（按优先级）】

1. soldier_rifle.glb — 步枪兵（带骨骼+动作）
   身高 1.78 m，≤ 15k 面。
   提示词：insurgent soldier, middle eastern militia fighter, wearing shemagh scarf, worn desert camouflage jacket and cargo pants, chest rig, holding AK-47 rifle, realistic human proportions, full body, A-pose, PBR textures, no baked lighting, rigged humanoid, game-ready character

2. soldier_rpg.glb — 火箭筒兵（带骨骼+动作）
   身高 1.78 m，≤ 15k 面。
   提示词：insurgent soldier carrying RPG-7 rocket launcher, middle eastern militia fighter, balaclava, worn khaki clothing, ammunition bag with spare rockets on back, realistic human proportions, full body, A-pose, PBR textures, no baked lighting, rigged humanoid, game-ready character

3. technical.glb — 武装皮卡
   长 5.3 × 宽 1.9 × 高 2.6 m（含机枪），≤ 20k 面。车上不要人。
   拆件节点：gun（车斗机枪，能水平转），wheel_FL、wheel_FR、wheel_RL、wheel_RR。
   提示词：armed pickup truck technical, white Toyota Hilux style double cab, heavy machine gun DShK mounted on the bed, dented body, rust, dust and dirt, desert insurgent vehicle, realistic, PBR textures, no baked lighting, no ground, no people, single object, game-ready

4. moto_scout.glb — 摩托车 + 骑手（一个整体）
   长 2.1 m，高 1.7 m（含人），≤ 12k 面。骑手是摆好骑车姿势的静态人即可，不用骨骼。
   拆件节点：wheel_F、wheel_R。
   提示词：dirt motorcycle with an insurgent rider sitting on it in riding pose, rider wears shemagh and desert clothing, rifle slung on back, dusty off-road bike, realistic, PBR textures, no baked lighting, no ground, single object, game-ready

5. warehouse.glb — 铁皮仓库
   长 20 × 宽 12 × 高 7 m，≤ 10k 面。
   提示词：corrugated metal warehouse with large sliding door, rusty roof panels, desert industrial building, faded, realistic, PBR textures, no baked lighting, no ground, single building, game-ready

6. civilian.glb — 平民（带骨骼，至少 walk、run 动作）
   身高 1.7 m，≤ 12k 面。
   提示词：middle eastern civilian man in long traditional robe and head scarf, realistic human proportions, full body, A-pose, PBR textures, no baked lighting, rigged humanoid, game-ready character

7. house_2f.glb — 两层小楼
   长 10 × 宽 8 × 高 7 m，≤ 10k 面。
   提示词：two-story middle eastern concrete house with balcony and outdoor staircase, flat roof with low parapet, satellite dish, faded beige paint, cracks and stains, realistic, PBR textures, no baked lighting, no ground, single building, game-ready

【交付】
- 全部 GLB 放进一个文件夹 apache_assets，打成一个 zip。
- 文件夹里附 list.txt，每行：文件名 | 用的底层模型（Tripo/混元/Meshy/Rodin） | 有没有拆件/骨骼/动作（列出动作名） | 三角面数 | 备注。
- 每个资产附一张截图（同名 .png）。
