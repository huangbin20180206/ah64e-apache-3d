# 文件职责地图 · src/app/ 76 文件

> 给新接手的 AI / 人：本项目 = `src/app/*.js` **按文件名数字升序拼接进单个 IIFE**（`build.mjs` 拼接），
> HTML 外壳在 `src/template.html`。两大硬规矩：①低编号文件不得读高编号**顶层符号**（反向引用禁止，
> `tools/check_topology.mjs` 把关）——跨运行期实例一律走 `01-host.js` 的 `HOST.*` 槽位；
> ②新增跨文件顶层符号必须同步 `docs/module-contracts.md`，否则 build 红。
> 本文件回答"76 个文件各自管什么、为什么有些功能拆成好几个文件"。

---

## 快速索引：我想改 X，去哪个文件

| 我想改… | 去这里 |
|---|---|
| 数学/工具函数 | 00-utils（damp/lerp/clamp）、05-config（U2M/画质档/常量） |
| 机体外观/涂装 | 06-paint（涂装）、60-model（载入/爆炸视图/线框）、62-detailparts（细节件） |
| 地面/场地 | 15-terrain（四场地）、10-tex（停机坪贴图）、31-scenery（远山树线湖岸）、16-targetscenery（阵地工事） |
| 地图 | 16-town（城镇）、16-valley（峡谷） |
| 靶标/敌人 | 16-targets（总控）、16-targetmodels（建模/换壳）、16-targetprops（装饰道具）、26-airtargets（空中目标）、27-infantry（步兵）、27-life（平民/摩托）、87-enemyair（A2A 敌机 AI）+ 88-enemyvis（渲染） |
| 旋翼下洗 | 17-washfx（核心）+ 21/22/23 + 28-washfx（总装）——见下"为什么拆四个" |
| 声音 | 18-audio（程序合成音效）、47-betty（女声警告）、70-radio（无线电喊话）、80-music（配乐） |
| 武器/弹道 | 65-weapons（机炮/地狱火/火箭唯一实现） |
| 视角/操作 | 50-controls（轨道相机）、46-fpview（第一人称座舱）、76-mobile / 77-mobilefire（触屏） |
| 任务/难度/存档 | 70-mission（任务状态机）、83-arcade（难度/分数/成就）、91-levels（关卡表）、92-progress（关卡存档）、90-campaign（评级+战役存档）、89-resources（燃油） |
| 敌方威胁 | 84-samwar（SAM/干扰弹逻辑）+ 85-samvis（渲染）、86-damage（机务损伤）、87/88（敌机） |
| 相机演出 | 78-cinematic（开场）、70-killcam（击毁特写）、82-cutscene（过场）、74-tour（一键导览）、75-routes（展示航线运行时）+ 34-routes（航线数据） |
| 天气/夜战 | 79-weather、70-nightops（FLIR+照明弹）、24-navlights（航行灯） |
| UI/界面 | 72-uibind（事件绑定唯一入口）、70-play（战役地图）、71-armory（装备图鉴）、70-appmode（三模式）、73-keycard（首次按键图）、73-coach（训练教练）、33-knowcards（知识卡数据）、35-armorydata（图鉴数据） |
| 启动/帧循环 | 70-start（载入装配）、70-loop（每帧驱动）、70-app（入口核心） |

## 为什么下洗特效拆成 17/21/22/23/28 五个文件

不是功能重复，是**拓扑契约逼出来的正向拆分**（当时 `17-washfx.js` 一个文件长到
低编号读高编号、反向引用检查过不去）：

```
17-washfx.js  下洗粒子核心（WashParticles 涡环）
21-washground.js 地面痕迹类（沙脊/草屑）——自 17 拆出（P0 重构）
22-washdecal.js  刷痕贴片层 ——自 17 拆出（P1-D）
23-washmedia.js  介质类（草/水花/涟漪）——自 17 拆出（P0）
28-washfx.js  WashFX 总装（三层协同 + brownout 雾）——自 17 尾部拆迁（P1-A，
              拆到 28 后才合法引用 20-scene 的 ENV_PRESETS）
```

**改下洗手感的入口是 28-washfx（总装层）**；改单一介质表现才下到 21/22/23。

## 同款"逻辑层/渲染层分离"纪律（Phase 19+ 起的新模块都照此办理）

```
84-samwar（SAM 纯逻辑）  → 85-samvis（渲染薄层）
87-enemyair（敌机纯逻辑）→ 88-enemyvis（渲染薄层）
91-levels / 92-progress / 90-campaign / 89-resources / 86-damage：零 THREE 零 DOM 纯逻辑，
  可被 Node 直跑（tools/tests_pure 的 *_drive.js 驱动就是这么测它们的）
```

**新功能照抄这套**：算法进纯逻辑层（可 pytest），画面进渲染薄层；别把两者糅在一个文件里。

## 编号分区速查

| 段 | 职责 |
|---|---|
| 0x | 工具/宿主契约/常量/涂装 |
| 1x | 场景内容：地形、靶标家族、下洗、声音、灯光、活物 |
| 3x | 纯数据：知识卡、航线、图鉴 |
| 4x | 渲染管线与体验子系统：后处理、飞行状态机、座舱、警告、救援 |
| 5x-6x | 相机控制、模型载入、细节件、武器 |
| 7x | 产品层中枢：入口/循环/任务/UI/模式/演出/移动端 |
| 8x-9x | 游戏系统：街机层、SAM、损伤、敌机、资源、存档、关卡（越往后越"纯逻辑可测"） |

## 改动前必读三件套

1. `docs/module-contracts.md` —— 符号契约，build 强校验
2. `NEXT-STEPS.md` —— 接手操作与基线
3. `AGENTS.md` —— 仓库纪律（完工三件套/截图留档/CHANGES 记账）
