# 模块契约（module contracts）

> Phase 1 产物。本文档是 `tools/check_topology.mjs` 的**输入**（不是摆设）：
> 构建时（`node build.mjs`）强制三项检查——
> ① 无反向引用（低编号文件不得读高编号文件的顶层符号）；
> ② 每个文件的跨文件依赖 ≤ 下述契约块中该文件 `depends` 声明的清单；
> ③ 被跨文件引用的顶层符号必须出现在提供方文件的 `provides` 里。
> **改依赖先改这张表**，否则构建直接失败。
>
> 机读契约块（```json-contracts）由分析器导出（符号级边 490 条，
> 文件级 172 条，2026-10-12 拆 70-app 后重导）；人读段落说明每文件的
> 提供/依赖/调用时机。宿主注册（HOST.*）的语义见 01-host.js。

```json-contracts
{
 "00-utils.js": {
  "provides": [
   "DEG",
   "PI",
   "STATS",
   "TAU",
   "_rnd",
   "canvas2d",
   "clamp",
   "countScene",
   "damp",
   "disposeObject3D",
   "easeInOut",
   "easeOut",
   "fbmCanvas",
   "fbmInto",
   "fmtK",
   "heightToNormal",
   "invLerp",
   "lerp",
   "mergeGeos",
   "mulberry32",
   "noiseCanvas",
   "rnd",
   "rpick",
   "rrect",
   "rsign",
   "smin",
   "smoothstep",
   "tex",
   "vcKit",
   "vcMat"
  ],
  "depends": {}
 },
 "01-host.js": {
  "provides": [
   "HOST",
   "UI",
   "toast",
   "toastT"
  ],
  "depends": {}
 },
 "05-config.js": {
  "provides": [
   "AC",
   "BASE_C",
   "FLY_BOUND",
   "GROUND_PITCH",
   "GROUND_PITCH_COMP",
   "GROUND_Y",
   "GUN",
   "MODEL_LIFT",
   "MODEL_MIN_Y",
   "PART_GROUPS",
   "QUALITY_PRESETS",
   "ROCKET",
   "RPM_NOMINAL",
   "SPIN_DOWN_SEC",
   "SPIN_UP_SEC",
   "TAIL_RATIO",
   "WATER_Y",
   "WIND",
   "qualityPreset",
   "windVec"
  ],
  "depends": {
   "00-utils.js": [
    "TAU"
   ]
  }
 },
 "06-paint.js": {
  "provides": [
   "ARMY_OVERRIDE",
   "applyDecalTex",
   "grabSource",
   "makeDecalText",
   "makeExhaustCrust",
   "makeLensFace",
   "makeSkinDetail",
   "subduedFromTexture"
  ],
  "depends": {
   "00-utils.js": [
    "TAU",
    "canvas2d",
    "fbmInto",
    "noiseCanvas",
    "rnd"
   ]
  }
 },
 "10-tex.js": {
  "provides": [
   "makeContactShadow",
   "makeFarGround",
   "makeHelipad"
  ],
  "depends": {
   "00-utils.js": [
    "TAU",
    "canvas2d",
    "clamp",
    "fbmCanvas",
    "fbmInto",
    "heightToNormal",
    "noiseCanvas",
    "rnd",
    "tex"
   ]
  }
 },
 "15-terrain.js": {
  "provides": [
   "DFAR_LAM",
   "DUNE_BASE",
   "DUNE_H",
   "DUNE_KC",
   "DUNE_LAM",
   "DUNE_R2",
   "DUNE_SR",
   "DUNE_STOSS",
   "DUNE_SW",
   "DUNE_T0",
   "DUNE_WX",
   "TERRAINS",
   "desertEnvDim",
   "duneFarH",
   "duneH",
   "makeDesertGround",
   "makeGrassGround",
   "makeWaterGround",
   "terrainFog"
  ],
  "depends": {
   "00-utils.js": [
    "TAU",
    "canvas2d",
    "clamp",
    "fbmCanvas",
    "fbmInto",
    "heightToNormal",
    "rnd",
    "smin",
    "smoothstep",
    "tex"
   ],
   "05-config.js": [
    "WIND"
   ]
  }
 },
 "16-course.js": {
  "provides": [
   "FlightCourse"
  ],
  "depends": {}
 },
 "16-targetmodels.js": {
  "provides": [
   "TARGET_TYPES",
   "addBox",
   "applyModelToTarget",
   "loadTargetModels",
   "mergeTargetStatics",
   "targetMat"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "mergeGeos"
   ]
  }
 },
 "16-targets.js": {
  "provides": [
   "TargetRange",
   "_naTo"
  ],
  "depends": {
   "00-utils.js": [
    "DEG",
    "PI",
    "TAU",
    "disposeObject3D",
    "mergeGeos",
    "rnd"
   ],
   "01-host.js": [
    "HOST"
   ],
   "16-targetmodels.js": [
    "TARGET_TYPES",
    "applyModelToTarget",
    "loadTargetModels",
    "mergeTargetStatics"
   ],
   "16-targetscenery.js": [
    "buildRangeScenery"
   ],
   "31-scenery.js": [
    "buildScenery"
   ],
   "05-config.js": [
    "BASE_C"
   ]
  }
 },
 "16-targetscenery.js": {
  "provides": [
   "buildRangeScenery"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "disposeObject3D",
    "mergeGeos",
    "vcKit",
    "vcMat"
   ],
   "16-targetmodels.js": [
    "targetMat"
   ]
  }
 },
 "16-town.js": {
  "provides": [
   "TOWN_AMBUSH",
   "TOWN_BDMG",
   "TOWN_BUILDINGS",
   "TOWN_CENTER",
   "TOWN_COLLAPSE_T",
   "TOWN_PEEK_R",
   "TownDistrict",
   "_townWallTex",
   "townBodyGeo",
   "townSegBox",
   "townWallTex"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "TAU",
    "disposeObject3D",
    "mergeGeos",
    "rnd"
   ],
   "16-targetmodels.js": [
    "TARGET_TYPES",
    "applyModelToTarget",
    "loadTargetModels",
    "mergeTargetStatics",
    "targetMat"
   ],
   "05-config.js": [
    "BASE_C"
   ]
  }
 },
 "16-valley.js": {
  "provides": [
   "CANYON_H",
   "CANYON_HOVER",
   "CANYON_PATH",
   "CANYON_RADARS",
   "CANYON_RDMG",
   "CANYON_RIM",
   "CANYON_ROCK",
   "CANYON_ROTOR_R",
   "CANYON_ROTOR_Y",
   "CANYON_UNITS",
   "CanyonRun",
   "_cvLen",
   "_cvOut",
   "_cvSeg",
   "canyonColor",
   "canyonHeight",
   "canyonMask",
   "canyonNearest",
   "canyonPointAt"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "TAU",
    "disposeObject3D",
    "mergeGeos",
    "rnd",
    "smoothstep"
   ],
   "16-targetmodels.js": [
    "TARGET_TYPES",
    "applyModelToTarget",
    "loadTargetModels",
    "mergeTargetStatics",
    "targetMat"
   ]
  }
 },
 "17-washfx.js": {
  "provides": [
   "WASH",
   "WashParticles",
   "makeWashSprite"
  ],
  "depends": {
   "00-utils.js": [
    "TAU",
    "canvas2d",
    "clamp",
    "rnd",
    "tex"
   ]
  }
 },
 "18-audio.js": {
  "provides": [
   "RotorAudio"
  ],
  "depends": {
   "00-utils.js": [
    "mulberry32"
   ]
  }
 },
 "19-reflect.js": {
  "provides": [
   "WaterReflection"
  ],
  "depends": {
   "00-utils.js": [
    "mergeGeos"
   ],
   "05-config.js": [
    "PART_GROUPS"
   ]
  }
 },
 "20-scene.js": {
  "provides": [
   "ENV_PRESETS",
   "FSQuad",
   "skyMaterial",
   "sunVector"
  ],
  "depends": {
   "00-utils.js": [
    "DEG"
   ]
  }
 },
 "21-washground.js": {
  "provides": [
   "DuneSandFX",
   "GrassDebrisFX",
   "GrassImprint",
   "WashTracks"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "TAU",
    "canvas2d",
    "clamp",
    "rnd",
    "tex"
   ],
   "15-terrain.js": [
    "duneH"
   ]
  }
 },
 "22-washdecal.js": {
  "provides": [
   "WashDecal"
  ],
  "depends": {
   "00-utils.js": [
    "PI"
   ],
   "15-terrain.js": [
    "duneH"
   ]
  }
 },
 "23-washmedia.js": {
  "provides": [
   "GrassField",
   "SpraySurfaceFX",
   "WaterRipples"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "TAU",
    "canvas2d",
    "clamp",
    "rnd",
    "smoothstep",
    "tex"
   ],
   "05-config.js": [
    "WATER_Y"
   ]
  }
 },
 "24-navlights.js": {
  "provides": [
   "NightLights",
   "nlGlowTex",
   "nlPulse"
  ],
  "depends": {}
 },
 "26-airtargets.js": {
  "provides": [
   "AirTargets",
   "makeStripeTex"
  ],
  "depends": {
   "00-utils.js": [
    "DEG",
    "PI",
    "TAU",
    "canvas2d",
    "disposeObject3D",
    "mergeGeos",
    "rnd",
    "tex"
   ],
   "15-terrain.js": [
    "duneH"
   ],
   "16-targetmodels.js": [
    "addBox",
    "mergeTargetStatics"
   ]
  }
 },
 "28-washfx.js": {
  "provides": [
   "WashFX"
  ],
  "depends": {
   "00-utils.js": [
    "clamp",
    "damp",
    "lerp",
    "rnd",
    "smoothstep"
   ],
   "05-config.js": [
    "windVec"
   ],
   "17-washfx.js": [
    "WASH",
    "WashParticles",
    "makeWashSprite"
   ],
   "20-scene.js": [
    "ENV_PRESETS"
   ],
   "21-washground.js": [
    "DuneSandFX",
    "GrassDebrisFX",
    "GrassImprint",
    "WashTracks"
   ],
   "22-washdecal.js": [
    "WashDecal"
   ],
   "23-washmedia.js": [
    "GrassField",
    "SpraySurfaceFX",
    "WaterRipples"
   ]
  }
 },
 "30-world.js": {
  "provides": [
   "buildWorld"
  ],
  "depends": {
   "00-utils.js": [
    "PI"
   ],
   "01-host.js": [
    "HOST"
   ],
   "05-config.js": [
    "GROUND_Y",
    "WATER_Y"
   ],
   "10-tex.js": [
    "makeContactShadow",
    "makeFarGround",
    "makeHelipad"
   ],
   "15-terrain.js": [
    "DUNE_BASE",
    "TERRAINS",
    "desertEnvDim",
    "duneFarH",
    "duneH",
    "terrainFog"
   ],
   "16-targetmodels.js": [
    "addBox"
   ],
   "20-scene.js": [
    "ENV_PRESETS",
    "skyMaterial"
   ]
  }
 },
 "31-scenery.js": {
  "provides": [
   "_scnWarm",
   "buildScenery",
   "buildWorldScenery"
  ],
  "depends": {
   "00-utils.js": [
    "clamp",
    "lerp"
   ],
   "05-config.js": [
    "GROUND_Y"
   ],
   "20-scene.js": [
    "ENV_PRESETS"
   ]
  }
 },
 "32-envpreset.js": {
  "provides": [
   "applyPreset",
   "scene_fog"
  ],
  "depends": {
   "00-utils.js": [
    "clamp"
   ],
   "15-terrain.js": [
    "DUNE_BASE",
    "TERRAINS",
    "desertEnvDim",
    "terrainFog"
   ],
   "20-scene.js": [
    "ENV_PRESETS",
    "sunVector"
   ]
  }
 },
 "33-knowcards.js": {
  "provides": [
   "KNOW_CARDS"
  ],
  "depends": {}
 },
 "34-routes.js": {
  "provides": [
   "ROUTES",
   "routeSample",
   "routeShot",
   "routeVel"
  ],
  "depends": {
   "16-valley.js": [
    "CANYON_PATH"
   ]
  }
 },
 "40-post.js": {
  "provides": [
   "BLUR_W",
   "Composer"
  ],
  "depends": {
   "00-utils.js": [
    "clamp"
   ],
   "05-config.js": [
    "qualityPreset"
   ],
   "20-scene.js": [
    "FSQuad"
   ]
  }
 },
 "45-flight.js": {
  "provides": [
   "FLY",
   "flyUpdate"
  ],
  "depends": {
   "00-utils.js": [
    "lerp"
   ],
   "01-host.js": [
    "HOST"
   ],
   "05-config.js": [
    "GROUND_PITCH",
    "GROUND_PITCH_COMP"
   ]
  }
 },
 "46-fpview.js": {
  "provides": [
   "FPView",
   "keys",
   "shortestAngle"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "clamp"
   ],
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "05-config.js": [
    "FLY_BOUND"
   ]
  }
 },
 "47-betty.js": {
  "provides": [
   "Betty",
   "betty"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ],
   "45-flight.js": [
    "FLY"
   ]
  }
 },
 "48-rescue.js": {
  "provides": [
   "Rescue"
  ],
  "depends": {}
 },
 "50-controls.js": {
  "provides": [
   "Orbit",
   "VIEWS"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "TAU",
    "clamp",
    "damp",
    "easeInOut",
    "lerp"
   ],
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "60-model.js": {
  "provides": [
   "Apache",
   "makeRotorDisc",
   "saneName"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "clamp",
    "mergeGeos"
   ],
   "05-config.js": [
    "MODEL_LIFT",
    "PART_GROUPS"
   ],
   "06-paint.js": [
    "ARMY_OVERRIDE",
    "applyDecalTex",
    "grabSource",
    "makeDecalText",
    "makeExhaustCrust",
    "makeLensFace",
    "makeSkinDetail",
    "subduedFromTexture"
   ]
  }
 },
 "62-detailparts.js": {
  "provides": [
   "DETAIL_MANIFEST",
   "DetailParts"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ],
   "20-scene.js": [
    "ENV_PRESETS"
   ]
  }
 },
 "65-weapons.js": {
  "provides": [
   "WeaponRig",
   "makeGlowTex"
  ],
  "depends": {
   "00-utils.js": [
    "PI",
    "TAU",
    "canvas2d",
    "rnd",
    "tex"
   ],
   "05-config.js": [
    "GUN",
    "ROCKET"
   ]
  }
 },
 "70-app.js": {
  "provides": [
   "S",
   "W",
   "_ctxLost",
   "_kills",
   "air",
   "apache",
   "applyQuality",
   "arcade",
   "audio",
   "campaign",
   "canvas",
   "composer",
   "course",
   "damageSys",
   "disc",
   "discMat",
   "dp",
   "enemyAir",
   "enemyVis",
   "fp",
   "hitMark",
   "killFeed",
   "music",
   "narrative",
   "nlights",
   "orbit",
   "progress",
   "refl",
   "renderer",
   "rescue",
   "resize",
   "resources",
   "rig",
   "samvis",
   "samwar",
   "scenery",
   "shotPending",
   "targets",
   "updateTargetHUD",
   "washfx",
   "weather"
  ],
  "depends": {
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "05-config.js": [
    "qualityPreset"
   ],
   "30-world.js": [
    "buildWorld"
   ],
   "31-scenery.js": [
    "buildScenery",
    "buildWorldScenery"
   ],
   "40-post.js": [
    "Composer"
   ],
   "50-controls.js": [
    "Orbit"
   ]
  }
 },
 "70-appmode.js": {
  "provides": [
   "appModeInit",
   "appState",
   "setShowTab"
  ],
  "depends": {
   "01-host.js": [
    "HOST",
    "UI"
   ],
   "33-knowcards.js": [
    "KNOW_CARDS"
   ],
   "70-app.js": [
    "S",
    "apache",
    "campaign",
    "fp",
    "orbit",
    "progress"
   ],
   "70-labels.js": [
    "LABELS",
    "labelInfo"
   ],
   "70-play.js": [
    "bindPlayUI",
    "hideLevelMap",
    "playState",
    "showLevelMap",
    "startLevel"
   ]
  }
 },
 "70-camera.js": {
  "provides": [
   "buildViewBar",
   "saveShot",
   "setView"
  ],
  "depends": {
   "01-host.js": [
    "UI"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "50-controls.js": [
    "VIEWS"
   ],
   "70-app.js": [
    "S",
    "apache",
    "canvas",
    "orbit"
   ]
  }
 },
 "70-combat.js": {
  "provides": [
   "_dmgApply",
   "_tickDamage",
   "_tickEnemyAir",
   "_tickResources",
   "_tickSamwar"
  ],
  "depends": {
   "01-host.js": [
    "toast"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "46-fpview.js": [
    "keys"
   ],
   "47-betty.js": [
    "betty"
   ],
   "70-app.js": [
    "S",
    "_kills",
    "apache",
    "arcade",
    "damageSys",
    "enemyAir",
    "enemyVis",
    "fp",
    "killFeed",
    "music",
    "narrative",
    "resources",
    "rig",
    "samwar",
    "targets",
    "updateTargetHUD"
   ],
   "70-mission.js": [
    "applyVariantAmmo",
    "failMission"
   ]
  }
 },
 "70-hud.js": {
  "provides": [
   "_tickHud",
   "_tickModeChip",
   "_tickPostFx",
   "syncFlyText"
  ],
  "depends": {
   "00-utils.js": [
    "clamp"
   ],
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "20-scene.js": [
    "ENV_PRESETS"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "70-app.js": [
    "S",
    "W",
    "apache",
    "applyQuality",
    "arcade",
    "composer",
    "damageSys",
    "fp",
    "narrative",
    "resources",
    "rig",
    "samwar",
    "targets"
   ],
   "70-appmode.js": [
    "appState"
   ],
   "70-labels.js": [
    "_v"
   ],
   "70-mission.js": [
    "TRAIN_NUM",
    "TRAIN_STEPS"
   ]
  }
 },
 "70-labels.js": {
  "provides": [
   "LABELS",
   "_v",
   "buildLabels",
   "hideLabelInfo",
   "labelBox",
   "labelInfo",
   "labelNodes",
   "updateLabels"
  ],
  "depends": {
   "01-host.js": [
    "UI"
   ],
   "70-app.js": [
    "S",
    "W",
    "apache"
   ]
  }
 },
 "70-loop.js": {
  "provides": [
   "clock",
   "loop",
   "stepFrames"
  ],
  "depends": {
   "00-utils.js": [
    "DEG",
    "TAU",
    "clamp",
    "damp",
    "easeInOut",
    "lerp",
    "smoothstep"
   ],
   "01-host.js": [
    "HOST",
    "toast"
   ],
   "05-config.js": [
    "FLY_BOUND",
    "RPM_NOMINAL",
    "SPIN_DOWN_SEC",
    "SPIN_UP_SEC",
    "TAIL_RATIO"
   ],
   "15-terrain.js": [
    "DUNE_BASE",
    "desertEnvDim"
   ],
   "20-scene.js": [
    "ENV_PRESETS"
   ],
   "31-scenery.js": [
    "_scnWarm"
   ],
   "45-flight.js": [
    "FLY",
    "flyUpdate"
   ],
   "46-fpview.js": [
    "keys"
   ],
   "47-betty.js": [
    "betty"
   ],
   "70-app.js": [
    "S",
    "W",
    "_ctxLost",
    "_kills",
    "air",
    "apache",
    "arcade",
    "audio",
    "composer",
    "disc",
    "discMat",
    "fp",
    "killFeed",
    "music",
    "narrative",
    "nlights",
    "orbit",
    "refl",
    "rescue",
    "rig",
    "samvis",
    "scenery",
    "shotPending",
    "targets",
    "washfx",
    "weather"
   ],
   "70-camera.js": [
    "saveShot"
   ],
   "70-combat.js": [
    "_tickDamage",
    "_tickEnemyAir",
    "_tickResources",
    "_tickSamwar"
   ],
   "70-hud.js": [
    "_tickHud",
    "_tickModeChip",
    "_tickPostFx"
   ],
   "70-labels.js": [
    "updateLabels"
   ],
   "70-mission.js": [
    "_tickMission",
    "_tickMissionMaps"
   ]
  }
 },
 "70-mission.js": {
  "provides": [
   "MISSION_VARIANTS",
   "TRAIN_NUM",
   "TRAIN_STEPS",
   "_tickMission",
   "_tickMissionMaps",
   "applyVariantAmmo",
   "beginMission",
   "completeMission",
   "failMission",
   "fmtMissionTime",
   "missionRating",
   "missionTimeout",
   "missionVariant",
   "renderBriefing",
   "renderCampaignChips",
   "renderDiffChips",
   "renderVariantChips",
   "retryMission",
   "setMissionDifficulty",
   "setMissionVariant",
   "showMissionBriefing",
   "startCampaign",
   "startMission",
   "trainAdvance",
   "trainFinish",
   "trainToastMs",
   "updateMissionPanel"
  ],
  "depends": {
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "05-config.js": [
    "BASE_C",
    "GUN",
    "ROCKET"
   ],
   "16-valley.js": [
    "CANYON_HOVER"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "47-betty.js": [
    "betty"
   ],
   "70-app.js": [
    "S",
    "W",
    "_kills",
    "air",
    "apache",
    "arcade",
    "audio",
    "campaign",
    "course",
    "damageSys",
    "enemyAir",
    "enemyVis",
    "fp",
    "music",
    "narrative",
    "progress",
    "rescue",
    "resources",
    "rig",
    "samwar",
    "targets",
    "updateTargetHUD",
    "washfx"
   ]
  }
 },
 "70-play.js": {
  "provides": [
   "bindPlayUI",
   "hideLevelMap",
   "playState",
   "showLevelMap",
   "startLevel"
  ],
  "depends": {
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "70-app.js": [
    "S",
    "arcade",
    "progress"
   ],
   "70-mission.js": [
    "startMission"
   ]
  }
 },
 "70-start.js": {
  "provides": [
   "boot",
   "finish",
   "loadFill",
   "prog"
  ],
  "depends": {
   "00-utils.js": [
    "STATS",
    "clamp",
    "countScene",
    "fmtK"
   ],
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "05-config.js": [
    "AC",
    "WATER_Y",
    "qualityPreset"
   ],
   "16-course.js": [
    "FlightCourse"
   ],
   "16-targets.js": [
    "TargetRange"
   ],
   "16-town.js": [
    "TownDistrict"
   ],
   "16-valley.js": [
    "CanyonRun"
   ],
   "18-audio.js": [
    "RotorAudio"
   ],
   "19-reflect.js": [
    "WaterReflection"
   ],
   "20-scene.js": [
    "ENV_PRESETS"
   ],
   "24-navlights.js": [
    "NightLights"
   ],
   "26-airtargets.js": [
    "AirTargets"
   ],
   "28-washfx.js": [
    "WashFX"
   ],
   "32-envpreset.js": [
    "applyPreset"
   ],
   "46-fpview.js": [
    "FPView"
   ],
   "47-betty.js": [
    "betty"
   ],
   "48-rescue.js": [
    "Rescue"
   ],
   "50-controls.js": [
    "VIEWS"
   ],
   "60-model.js": [
    "Apache",
    "makeRotorDisc"
   ],
   "62-detailparts.js": [
    "DetailParts"
   ],
   "65-weapons.js": [
    "WeaponRig"
   ],
   "70-app.js": [
    "S",
    "W",
    "_kills",
    "air",
    "apache",
    "applyQuality",
    "arcade",
    "audio",
    "campaign",
    "canvas",
    "course",
    "damageSys",
    "disc",
    "discMat",
    "dp",
    "enemyAir",
    "enemyVis",
    "fp",
    "hitMark",
    "killFeed",
    "music",
    "narrative",
    "nlights",
    "orbit",
    "progress",
    "refl",
    "renderer",
    "rescue",
    "resources",
    "rig",
    "samvis",
    "samwar",
    "targets",
    "updateTargetHUD",
    "washfx",
    "weather"
   ],
   "70-appmode.js": [
    "appModeInit"
   ],
   "70-camera.js": [
    "buildViewBar"
   ],
   "70-combat.js": [
    "_dmgApply"
   ],
   "70-loop.js": [
    "loop"
   ]
  }
 },
 "72-uibind.js": {
  "provides": [
   "bindUI",
   "enhanceA11y"
  ],
  "depends": {
   "01-host.js": [
    "HOST",
    "UI",
    "toast"
   ],
   "15-terrain.js": [
    "TERRAINS"
   ],
   "32-envpreset.js": [
    "applyPreset"
   ],
   "45-flight.js": [
    "FLY",
    "flyUpdate"
   ],
   "46-fpview.js": [
    "keys"
   ],
   "47-betty.js": [
    "betty"
   ],
   "50-controls.js": [
    "VIEWS"
   ],
   "70-app.js": [
    "S",
    "W",
    "_kills",
    "air",
    "apache",
    "applyQuality",
    "arcade",
    "audio",
    "campaign",
    "canvas",
    "composer",
    "course",
    "damageSys",
    "dp",
    "enemyAir",
    "enemyVis",
    "fp",
    "music",
    "narrative",
    "nlights",
    "orbit",
    "progress",
    "refl",
    "renderer",
    "rescue",
    "resources",
    "rig",
    "samvis",
    "samwar",
    "shotPending",
    "targets",
    "updateTargetHUD",
    "washfx",
    "weather"
   ],
   "70-camera.js": [
    "setView"
   ],
   "70-hud.js": [
    "syncFlyText"
   ],
   "70-labels.js": [
    "LABELS",
    "buildLabels",
    "hideLabelInfo",
    "labelBox",
    "updateLabels"
   ],
   "70-loop.js": [
    "stepFrames"
   ],
   "70-mission.js": [
    "TRAIN_NUM",
    "TRAIN_STEPS",
    "beginMission",
    "missionTimeout",
    "missionVariant",
    "renderDiffChips",
    "retryMission",
    "setMissionDifficulty",
    "setMissionVariant",
    "startCampaign",
    "startMission",
    "trainToastMs",
    "updateMissionPanel"
   ],
   "70-play.js": [
    "startLevel"
   ]
  }
 },
 "74-tour.js": {
  "provides": [
   "clickEnv",
   "clickTerrain",
   "syncTourCtl",
   "tour",
   "tourCap",
   "tourGo",
   "tourKey",
   "tourNext",
   "tourStart",
   "tourSteps",
   "tourStop",
   "tourTick",
   "tourTogglePause"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "70-app.js": [
    "S",
    "apache",
    "orbit"
   ]
  }
 },
 "75-routes.js": {
  "provides": [],
  "depends": {
   "00-utils.js": [
    "clamp",
    "lerp"
   ],
   "01-host.js": [
    "HOST",
    "toast"
   ],
   "34-routes.js": [
    "ROUTES",
    "routeSample",
    "routeShot",
    "routeVel"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "46-fpview.js": [
    "shortestAngle"
   ],
   "70-app.js": [
    "S",
    "apache",
    "fp",
    "orbit",
    "targets"
   ],
   "70-appmode.js": [
    "setShowTab"
   ],
   "74-tour.js": [
    "clickEnv",
    "clickTerrain",
    "tourCap",
    "tourKey",
    "tourStart",
    "tourStop"
   ]
  }
 },
 "76-mobile.js": {
  "provides": [
   "MobileSticks",
   "mobileSticks"
  ],
  "depends": {
   "00-utils.js": [
    "clamp"
   ],
   "01-host.js": [
    "UI"
   ],
   "45-flight.js": [
    "FLY"
   ],
   "46-fpview.js": [
    "keys"
   ]
  }
 },
 "78-cinematic.js": {
  "provides": [
   "CINE_KF",
   "CINE_SUB",
   "cineEnd",
   "cineStart",
   "cineTick",
   "cinema"
  ],
  "depends": {
   "00-utils.js": [
    "clamp",
    "easeInOut"
   ],
   "01-host.js": [
    "HOST",
    "toast"
   ],
   "70-app.js": [
    "S",
    "orbit"
   ],
   "70-camera.js": [
    "setView"
   ]
  }
 },
 "79-weather.js": {
  "provides": [
   "WeatherFX"
  ],
  "depends": {
   "00-utils.js": [
    "TAU",
    "clamp",
    "damp",
    "lerp",
    "rnd"
   ],
   "01-host.js": [
    "HOST"
   ],
   "05-config.js": [
    "windVec"
   ]
  }
 },
 "80-music.js": {
  "provides": [
   "FilmMusic"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "81-narrative.js": {
  "provides": [
   "NarrativeFX"
  ],
  "depends": {
   "00-utils.js": [
    "TAU",
    "rnd",
    "vcKit",
    "vcMat"
   ],
   "01-host.js": [
    "HOST"
   ],
   "05-config.js": [
    "BASE_C"
   ]
  }
 },
 "82-cutscene.js": {
  "provides": [
   "CUT_PRESETS",
   "cutscene"
  ],
  "depends": {
   "00-utils.js": [
    "clamp",
    "easeInOut"
   ],
   "01-host.js": [
    "HOST"
   ],
   "70-app.js": [
    "S",
    "orbit"
   ],
   "70-camera.js": [
    "setView"
   ],
   "05-config.js": [
    "BASE_C"
   ]
  }
 },
 "83-arcade.js": {
  "provides": [
   "ACHIEVEMENTS",
   "ArcadeModule",
   "COMBO_CAP",
   "COMBO_STEP",
   "COMBO_WINDOW",
   "DIFFICULTIES",
   "MISSION_VARIANT_KEYS",
   "TARGET_SCORES"
  ],
  "depends": {
   "01-host.js": [
    "HOST",
    "toast"
   ]
  }
 },
 "84-samwar.js": {
  "provides": [
   "SAMCFG",
   "SAM_PENALTY_TABLE",
   "SamWarModule",
   "_swMissile",
   "_swMulberry32"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "85-samvis.js": {
  "provides": [
   "SamVis",
   "_svDir",
   "_svFwd",
   "_svGlowTex",
   "_svQ"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "86-damage.js": {
  "provides": [
   "DMGCFG",
   "DMG_SECTORS",
   "DMG_SYS_KEYS",
   "DamageSystem"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ],
   "84-samwar.js": [
    "_swMulberry32"
   ]
  }
 },
 "87-enemyair.js": {
  "provides": [
   "ENEMYCFG",
   "EnemyAirModule",
   "_enemyUnit"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ],
   "84-samwar.js": [
    "_swMulberry32"
   ]
  }
 },
 "88-enemyvis.js": {
  "provides": [
   "EnemyVis",
   "_evF",
   "_evPartsBody",
   "_evPartsRotor",
   "_evV"
  ],
  "depends": {
   "00-utils.js": [
    "DEG",
    "PI",
    "mergeGeos",
    "rnd",
    "vcKit",
    "vcMat"
   ],
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "89-resources.js": {
  "provides": [
   "RESCFG",
   "ResourcesModule"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "90-campaign.js": {
  "provides": [
   "CAMPAIGN_KEY",
   "CAMPAIGN_LEVELS",
   "CAMPAIGN_SCHEMA",
   "CampaignModule",
   "GRADECFG",
   "GRADE_BASE",
   "GRADE_ORDER",
   "_gradeIdx"
  ],
  "depends": {
   "01-host.js": [
    "HOST"
   ]
  }
 },
 "91-levels.js": {
  "provides": [],
  "depends": {
   "01-host.js": [
    "HOST"
   ],
   "70-start.js": [
    "prog"
   ]
  }
 },
 "92-progress.js": {
  "provides": [],
  "depends": {
   "01-host.js": [
    "HOST"
   ]
  }
 }
}
```

## 00-utils.js

- **提供**: DEG, PI, STATS, TAU, _rnd, canvas2d, clamp, countScene, damp, disposeObject3D, easeInOut, easeOut, fbmCanvas, fbmInto, fmtK, heightToNormal, invLerp, lerp, mulberry32, noiseCanvas, rnd, rpick, rrect, rsign, smin, smoothstep, tex
- **依赖**: 无
- **调用时机**: 纯工具层（数学/种子随机/画布/噪声/法线/贴图），无生命周期，被所有后续文件随时调用。

## 01-host.js

- **提供**: HOST, UI, toast, toastT
- **依赖**: 无
- **调用时机**: 宿主层：UI/toast 声明即用；HOST 槽位由 70-app 顶部（renderer/orbit/S）与 finish（rig）、72-uibind（bindUI）注册，30/45/46/47 在运行期取用。

## 05-config.js

- **提供**: AC, GROUND_PITCH, GROUND_PITCH_COMP, GROUND_Y, GUN, MODEL_LIFT, MODEL_MIN_Y, PART_GROUPS, QUALITY_PRESETS, ROCKET, RPM_NOMINAL, SPIN_DOWN_SEC, SPIN_UP_SEC, TAIL_RATIO, WATER_Y, WIND, qualityPreset, windVec
- **依赖**: 00-utils.js（TAU）
- **调用时机**: 纯常量表（包围盒/部件绑定/武器参数/画质预设/风场），构建期静态读取，无生命周期。

## 06-paint.js

- **提供**: ARMY_OVERRIDE, applyDecalTex, grabSource, makeDecalText, makeExhaustCrust, makeLensFace, makeSkinDetail, subduedFromTexture
- **依赖**: 00-utils.js（TAU, canvas2d, fbmInto, noiseCanvas, rnd）
- **调用时机**: 涂装绘制：60-model 载入 GLB 后 setScheme/army 换装时调用；P9 补强批细节贴图（makeSkinDetail 蒙皮合成、makeExhaustCrust 排气积碳、makeLensFace 光电塔镜片）由 60-model _applyVisualDetail 一次性生成。

## 10-tex.js

- **提供**: makeContactShadow, makeFarGround, makeHelipad
- **依赖**: 00-utils.js（TAU, canvas2d, clamp, fbmCanvas, fbmInto, heightToNormal, noiseCanvas, rnd, tex）
- **调用时机**: 程序化地面贴图：30-world buildWorld 构建时一次性调用。

## 15-terrain.js

- **提供**: DFAR_LAM, DUNE_BASE, DUNE_H, DUNE_KC, DUNE_LAM, DUNE_R2, DUNE_SR, DUNE_STOSS, DUNE_SW, DUNE_T0, DUNE_WX, TERRAINS, desertEnvDim, duneFarH, duneH, makeDesertGround, makeGrassGround, makeWaterGround, terrainFog
- **依赖**: 00-utils.js（TAU, canvas2d, clamp, fbmCanvas, fbmInto, heightToNormal, rnd, smin, smoothstep, tex）；05-config.js（WIND）
- **调用时机**: 场地系统：TERRAINS 表 + 地面工厂被 30-world setTerrain 调用；duneH/duneFarH 被 17/21/22/26 采样；terrainFog 被 30-world/32-envpreset 两入口共用（P5-A(D) 场地雾色×环境协调，密度保持场地值）。desertEnvDim/DUNE_BASE 为沙漠远景沙丘色基（P5-B(B)：沙漠 farTint 沙色系×环境明度，替代停机坪 padTint 蓝紫断层）。

## 16-targets.js

- **提供**: TARGET_MODELS, TARGET_TYPES, TargetRange, _targetModelCache, addBox, applyModelToTarget, loadTargetModels, makeBarrelTarget, makeTankTarget, makeTruckTarget, targetMat
- **依赖**: 00-utils.js（DEG, PI, TAU, disposeObject3D, rnd）；01-host.js（HOST——P18 经 HOST.arcade 读难度系数）
- **调用时机**: 地面靶标：70-app finish 创建 TargetRange 实例；addBox 被 26/30 复用作几何工具。P8：补全敌方反击链路——AA 曳光飞行/命中结算（tr.hit 消费累加 _heliDmg）、威胁状态 _threat（0-3，由反击活跃/命中派生）、onHeliHit 回调（70-app 注入：受损 toast + rig._dmgPenalty）；reset 清威胁字段。Phase 18：AA 开火间隔/单发伤害经 HOST.arcade 系数表派生（standard=全 1.0 原值不变；命中概率保持标准公式不随难度缩放——S4）；_aaDmgMul 缓存命中结算，reset 复位；hitTest 对目标 HP 扣减经 _effDamage = power / targetResMul（S1 目标抗打击，veteran 更耐打；爆炸特效仍按原始 power 分档）。

## 17-washfx.js

- **提供**: WASH, WashParticles, makeWashSprite
- **依赖**: 00-utils.js（TAU, canvas2d, clamp, rnd, tex）
- **调用时机**: 下洗核心涡环粒子层（WashParticles + WASH 表 + makeWashSprite）：28-washfx 总装时实例化。

## 18-audio.js

- **提供**: RotorAudio
- **依赖**: 00-utils.js（mulberry32）
- **调用时机**: 程序化音效：70-app finish 创建 RotorAudio；audioKick 首手势启动 AudioContext。

## 19-reflect.js

- **提供**: WaterReflection
- **依赖**: 无
- **调用时机**: 湖面倒影：70-app finish 创建 WaterReflection，仅 water 场地启用，loop 每帧同步。

## 20-scene.js

- **提供**: ENV_PRESETS, FSQuad, skyMaterial, sunVector
- **依赖**: 00-utils.js（DEG）
- **调用时机**: 环境/天空/FSQuad：ENV_PRESETS 被 32-envpreset applyPreset 与 28-washfx setLighting 读取；FSQuad 被 40-post 复用。

## 21-washground.js

- **提供**: DuneSandFX, GrassDebrisFX, GrassImprint, WashTracks
- **依赖**: 00-utils.js（PI, TAU, canvas2d, clamp, rnd, tex）；15-terrain.js（duneH）
- **调用时机**: 地面痕迹类（沙雾/草屑/压痕/沙漠痕迹留存）：28-washfx 总装时实例化。

## 22-washdecal.js

- **提供**: WashDecal
- **依赖**: 15-terrain.js（duneH）；00-utils.js（PI）
- **调用时机**: 下洗地面刷痕层（P1-D 自 17-washfx 拆出）：28-washfx 总装时实例化，随 loop 每帧 update。

## 23-washmedia.js

- **提供**: GrassField, SpraySurfaceFX, WaterRipples
- **依赖**: 00-utils.js（PI, TAU, canvas2d, clamp, rnd, smoothstep, tex）；05-config.js（WATER_Y）
- **调用时机**: 介质表现类（草场/水花泡沫/悬停涟漪）：28-washfx 总装时实例化。

## 24-navlights.js

- **提供**: NightLights, nlGlowTex, nlPulse
- **依赖**: 无
- **调用时机**: 夜航灯组：70-app finish 创建 NightLights，loop 每帧 update。

## 26-airtargets.js

- **提供**: AirTargets, makeStripeTex
- **依赖**: 16-targets.js（addBox）；00-utils.js（DEG, PI, TAU, canvas2d, disposeObject3D, rnd, tex）；15-terrain.js（duneH）
- **调用时机**: 空中打击目标（无人机/热气球/靶机）：70-app finish 创建，loop 每帧 update；P6 新增 reset()（任务重试/靶场重置时复活全部空中目标+清残骸）。

## 28-washfx.js

- **提供**: WashFX
- **依赖**: 00-utils.js（clamp, damp, lerp, rnd, smoothstep）；21-washground.js（DuneSandFX, GrassDebrisFX, GrassImprint, WashTracks）；20-scene.js（ENV_PRESETS）；23-washmedia.js（GrassField, SpraySurfaceFX, WaterRipples）；17-washfx.js（WASH, WashParticles, makeWashSprite）；22-washdecal.js（WashDecal）；05-config.js（windVec）
- **调用时机**: 下洗总装（P1-A 自 17-washfx 尾部迁出）：70-app finish 创建 WashFX，loop 每帧 update。

## 30-world.js

- **提供**: buildWorld
- **依赖**: 16-targets.js（addBox）；15-terrain.js（DUNE_BASE, TERRAINS, desertEnvDim, duneFarH, duneH, terrainFog）；20-scene.js（ENV_PRESETS, skyMaterial）；05-config.js（GROUND_Y, WATER_Y）；01-host.js（HOST）；10-tex.js（makeContactShadow, makeFarGround, makeHelipad）；00-utils.js（PI）
- **调用时机**: 场景搭建（P1-D 后仅保留 buildWorld 构建期）：70-app 顶部一次性调用，构建天空/灯光/停机坪/远景/平台。setTerrain 内 fog 经 terrainFog 与环境预设协调、duneFar 色基=沙漠 farTint×环境明度×0.78（P5-B(B)）。

## 32-envpreset.js

- **提供**: applyPreset, scene_fog
- **依赖**: 00-utils.js（clamp）；20-scene.js（ENV_PRESETS, sunVector）；15-terrain.js（DUNE_BASE, TERRAINS, desertEnvDim, terrainFog）
- **调用时机**: 环境预设切换（P1-D 自 30-world 拆出）：applyPreset 由 72-uibind 环境切换与 70-app 场地切换调用；scene_fog 设场地雾基准。非 pad 场地雾色经 terrainFog 混入预设雾色（P5-B(A) 权重 0.6）、沙漠 duneFar 色基=沙漠 farTint×环境明度×0.78（P5-B(B)）。

## 40-post.js

- **提供**: BLUR_W, Composer
- **依赖**: 00-utils.js（clamp）；20-scene.js（FSQuad）；05-config.js（qualityPreset）
- **调用时机**: 后处理 Composer：70-app 顶部创建，loop 每帧 render；画质档位切换时 activeLevels 调整。

## 45-flight.js

- **提供**: FLY, flyUpdate
- **依赖**: 05-config.js（GROUND_PITCH, GROUND_PITCH_COMP）；01-host.js（HOST）；00-utils.js（lerp）
- **调用时机**: 起降状态机 FLY + flyUpdate：70-app loop 每帧调用；FLY 是全链路唯一飞行状态源。

## 46-fpview.js

- **提供**: FPView, keys, shortestAngle
- **依赖**: 00-utils.js（PI, clamp）；45-flight.js（FLY）；01-host.js（HOST, UI, toast）
- **调用时机**: 第一人称视角：70-app finish 创建 FPView；loop 每帧 update；keydown 路由经 72-uibind。P7：HUD 稳定度读数 fp-stab 经 HOST.S._stability 派生（悬停 100%，机动下降）。

## 47-betty.js

- **提供**: Betty, betty
- **依赖**: 45-flight.js（FLY）；01-host.js（HOST）
- **调用时机**: Betty 语音警告：模块尾部自实例化 const betty，70-app loop 每帧 betty.update 自查（S/rig 经 HOST 取用）。

## 48-rescue.js

- **提供**: Rescue
- **依赖**: 无
- **调用时机**: 绞车救援：70-app finish 创建 Rescue，loop 每帧 update；K 键 toggle 由 72-uibind 路由。P7：低速作业窗口——rescue.speed 由 70-app loop 派生（FPV 前向/侧飞合成、环绕平移 7u/s），toggle 中 speed>3u/s 拒绝部署并 toast（低空 2~30u 高度窗口既有）。

## 50-controls.js

- **提供**: Orbit, VIEWS
- **依赖**: 00-utils.js（PI, TAU, clamp, damp, easeInOut, lerp）
- **调用时机**: 环绕轨道控制器 Orbit + 12 机位预设 VIEWS：70-app 顶部创建，loop 每帧 update。

## 60-model.js

- **提供**: Apache, makeRotorDisc, saneName
- **依赖**: 06-paint.js（ARMY_OVERRIDE, applyDecalTex, grabSource, makeDecalText, makeExhaustCrust, makeLensFace, makeSkinDetail, subduedFromTexture）；05-config.js（MODEL_LIFT, PART_GROUPS）；00-utils.js（PI, clamp）
- **调用时机**: Apache 模型：70-app boot 载入 GLB 后创建；部件绑定/涂装/爆炸视图随实例方法。setEnvIntensity 由 70-app finish（初始化）与 72-uibind setEnv（切换事件）调用——机体环境反射随预设 hemi 联动（P5-A(C)），无逐帧材质扫描。P9：_applyVisualTokens（bind 尾部分区 PBR 微调，同步 lv 基线）、_envBoost 倍率表（Glass/Radome/RadarHousing/Exhaust 高反射件 envI 乘倍率随环境联动，Body/Metal boost=1 保持 P5-A/C 语义）、visualTokens() 材质诊断值（__dbg.apache.visualTokens 供测试）。P9 补强批：_applyVisualDetail（bind 尾随调用——蒙皮材质合成面板接缝/铆钉/磨损/污渍贴图、Exhaust 挂积碳贴图、lens 挂镜片渐变贴图；SKIN_DETAIL_MATS 表决定哪些材质合成；合成贴图存 userData.detailMap，setScheme 恢复 lowvis 时优先 detailMap；visualTokens().detail 暴露只读诊断含画布哈希）。

## 65-weapons.js

- **提供**: WeaponRig, makeGlowTex
- **依赖**: 00-utils.js（PI, TAU, canvas2d, rnd, tex）；05-config.js（GUN, ROCKET）
- **调用时机**: 武器系统 WeaponRig（P1-D 评估不拆——方法全部共享实例池状态，无独立生命周期边界）：70-app finish 创建，loop 每帧 update。P7：机炮散布随飞行稳定度——rig._stability（0.25~1）由 70-app loop 派生（FPV 速度/俯仰或环绕平移），_tracer 散布 base×(1+(1-stab)×2.5)（悬停=基础，机动≈2.9×）。P8：散布再乘受损惩罚 rig._dmgPenalty（70-app 由 _heliDmg 派生，上限 +50%）——散布 = base×(1+(1-stab)×2.5)×(1+dmg)。

> 2026-10-12：原 70-app.js（110KB）按职责拆成同前缀 70-* 八个文件。同前缀在拓扑检查中同级（parseInt 相同，互引不判反向）；build.mjs 按文件名字典序拼接，故 70-app.js 在前、70-start.js 在后。

## 70-app.js

- **提供**: S, W, _ctxLost, _kills, air, apache, applyQuality, arcade, audio, campaign, canvas, composer, damageSys, disc, discMat, dp, enemyAir, enemyVis, fp, hitMark, killFeed, music, narrative, nlights, orbit, refl, renderer, rescue, resize, resources, rig, samvis, samwar, shotPending, targets, updateTargetHUD, washfx, weather
- **依赖**: 01-host.js（HOST, UI, toast）；05-config.js（qualityPreset）；30-world.js（buildWorld）；40-post.js（Composer）；50-controls.js（Orbit）
- **调用时机**: 入口核心（2026-10-12 拆分后）：顶部创建 renderer/W/composer/orbit/S 并注册 HOST；子系统槽位 let（apache/rig/targets…）；靶场 HUD（updateTargetHUD/killFeed/连杀播报/hitMark）；resize/applyQuality。原入口编排的历史语义（P6 任务状态机、P7 稳定度派生、P8 威胁闭环、Phase 11 变体/训练）现分布在下列 70-* 文件，行为不变。

## 70-camera.js

- **提供**: buildViewBar, saveShot, setView
- **依赖**: 01-host.js（UI）；45-flight.js（FLY）；50-controls.js（VIEWS）；70-app.js（S, apache, canvas, orbit）
- **调用时机**: 机位条 buildViewBar / setView（以机体位置与航向为参照）/ saveShot（render 后同帧取像素，由 loop 末尾 shotPending 触发）。

## 70-combat.js

- **提供**: _dmgApply, _tickDamage, _tickEnemyAir, _tickResources, _tickSamwar
- **依赖**: 01-host.js（toast）；45-flight.js（FLY）；46-fpview.js（keys）；47-betty.js（betty）；70-app.js（S, _kills, apache, arcade, damageSys, enemyAir, enemyVis, fp, killFeed, music, narrative, resources, rig, samwar, targets, updateTargetHUD）；70-mission.js（applyVariantAmmo, failMission）
- **调用时机**: 作战子系统帧逻辑：_tickSamwar（Phase 19 SAM scratch 环境组装+事件消费）、_tickDamage（86-damage 演化与派生量下发）、_tickEnemyAir（Phase 20 A2A）、_tickResources（Phase 20 燃油/补给）；scratch 对象 _swEnv/_swPrev/_eaEnv/_eaF/_rsEnv（零每帧分配）；_dmgApply 命中方位换算（finish 注入的 onHeliHit 使用）。均由 70-loop 在 if (apache) 段内按原顺序调用。

## 70-hud.js

- **提供**: _tickHud, _tickModeChip, _tickPostFx, syncFlyText
- **依赖**: 00-utils.js（clamp）；01-host.js（HOST, UI, toast）；20-scene.js（ENV_PRESETS）；45-flight.js（FLY）；70-app.js（S, W, applyQuality, arcade, composer, damageSys, fp, narrative, resources, rig, samwar, targets）；70-labels.js（_v）；70-mission.js（TRAIN_NUM, TRAIN_STEPS）
- **调用时机**: HUD/后处理帧逻辑：_tickPostFx（光晕/体积光/景深/白闪/震屏，返回慢动作 timeScale，loop 以 dt *= 返回值缩放）、_tickModeChip（P14 模式徽标，翻转才写 DOM）、_tickHud（RPM/弹药/FPS/自动降档/首访引导）；syncFlyText。

## 70-labels.js

- **提供**: LABELS, _v, buildLabels, hideLabelInfo, labelBox, labelInfo, labelNodes, updateLabels
- **依赖**: 01-host.js（UI）；70-app.js（S, W, apache）
- **调用时机**: 部件标签：LABELS 表、buildLabels（finish 调用）、解说牌、updateLabels（每帧，量化后变化才写 style）；共享 scratch _v。

## 70-loop.js

- **提供**: clock, loop
- **依赖**: 00-utils.js（DEG, TAU, clamp, damp, easeInOut, lerp, smoothstep）；01-host.js（HOST, toast）；05-config.js（RPM_NOMINAL, SPIN_DOWN_SEC, SPIN_UP_SEC, TAIL_RATIO）；45-flight.js（FLY, flyUpdate）；46-fpview.js（keys）；47-betty.js（betty）；70-app.js（S, W, _ctxLost, _kills, air, apache, arcade, audio, composer, disc, discMat, fp, killFeed, music, narrative, nlights, orbit, refl, rescue, rig, samvis, shotPending, targets, washfx, weather）；70-camera.js（saveShot）；70-combat.js（_tickDamage, _tickEnemyAir, _tickResources, _tickSamwar）；70-hud.js（_tickHud, _tickModeChip, _tickPostFx）；70-labels.js（updateLabels）；70-mission.js（_tickMission, _tickMissionMaps）
- **调用时机**: 动画循环 loop()：旋翼/雷达/姿态/蹬舵/峡谷碰撞/稳定度派生/救援，然后依次调用 _tickMission → _tickMissionMaps → targets.update → _tickSamwar → _tickDamage → _tickEnemyAir → _tickResources → 其余子系统 update → 渲染 → _tickModeChip → _tickHud → NaN 兜底 → 截图。

## 70-mission.js

- **提供**: MISSION_VARIANTS, TRAIN_NUM, TRAIN_STEPS, _tickMission, _tickMissionMaps, applyVariantAmmo, beginMission, completeMission, failMission, fmtMissionTime, missionRating, missionTimeout, missionVariant, renderBriefing, renderCampaignChips, renderDiffChips, renderVariantChips, retryMission, setMissionDifficulty, setMissionVariant, showMissionBriefing, startCampaign, startMission, trainAdvance, trainFinish, trainToastMs, updateMissionPanel
- **依赖**: 01-host.js（HOST, UI, toast）；05-config.js（GUN, ROCKET）；16-valley.js（CANYON_HOVER）；45-flight.js（FLY）；47-betty.js（betty）；70-app.js（S, W, _kills, air, apache, arcade, audio, campaign, damageSys, enemyAir, enemyVis, fp, music, narrative, rescue, resources, rig, samwar, targets, updateTargetHUD, washfx）
- **调用时机**: 任务系统：MISSION_VARIANTS/难度/战役 chip、简报 renderBriefing、面板 updateMissionPanel、completeMission/failMission/startMission/retryMission/beginMission、训练 TRAIN_STEPS/trainAdvance；帧逻辑 _tickMission（过场重试、接近基地触发、0.5s 面板刷新与胜负判定、训练推进）与 _tickMissionMaps（城镇/峡谷随变体派生）。

## 70-start.js

- **提供**: boot, finish, loadFill, prog
- **依赖**: 00-utils.js（STATS, clamp, countScene, fmtK）；01-host.js（HOST, UI, toast）；05-config.js（AC, WATER_Y, qualityPreset）；16-targets.js（TargetRange）；16-town.js（TownDistrict）；16-valley.js（CanyonRun）；18-audio.js（RotorAudio）；19-reflect.js（WaterReflection）；20-scene.js（ENV_PRESETS）；24-navlights.js（NightLights）；26-airtargets.js（AirTargets）；28-washfx.js（WashFX）；32-envpreset.js（applyPreset）；46-fpview.js（FPView）；47-betty.js（betty）；48-rescue.js（Rescue）；50-controls.js（VIEWS）；60-model.js（Apache, makeRotorDisc）；62-detailparts.js（DetailParts）；65-weapons.js（WeaponRig）；70-app.js（S, W, _kills, air, apache, applyQuality, arcade, audio, campaign, canvas, damageSys, disc, discMat, dp, enemyAir, enemyVis, fp, hitMark, killFeed, music, narrative, nlights, orbit, refl, renderer, rescue, resources, rig, samvis, samwar, targets, updateTargetHUD, washfx, weather）；70-camera.js（buildViewBar）；70-combat.js（_dmgApply）；70-loop.js（loop）
- **调用时机**: 载入与装配：prog 进度条、boot 载 GLB、finish 装配子系统并注册 HOST.rig；文件末尾调用 boot()——必须是 70-* 组按文件名排序的最后一个（boot 同步段要求 70-* 顶层 const 已初始化）。

## 72-uibind.js

- **提供**: bindUI, enhanceA11y
- **依赖**: 70-app.js（LABELS, S, W, _kills, air, apache, applyQuality, audio, beginMission, buildLabels, canvas, composer, fp, hideLabelInfo, labelBox, nlights, orbit, refl, renderer, rescue, retryMission, rig, setView, shotPending, startMission, syncFlyText, targets, updateLabels, updateMissionPanel, updateTargetHUD, washfx）；32-envpreset.js（applyPreset）；47-betty.js（betty）；45-flight.js（FLY, flyUpdate）；01-host.js（HOST, UI, toast）；46-fpview.js（keys）；15-terrain.js（TERRAINS）；50-controls.js（VIEWS）
- **调用时机**: UI 绑定与事件路由：70-app finish 经 HOST.bindUI() 调用；尾部注册 HOST.bindUI 供其取用。P6 新增三模式 chip（show/train/mission）+ 开始/重试任务按钮；resetRange 统一靶场/空中目标/救援/任务/瞬态全清理（键盘 B 与按钮同语义）。Phase 11：训练引导入口（setMode train 分支启动 S._train、Esc/点击画面跳过、拖拽环绕=第③步观察完成）；模式/变体 chip aria-pressed（enhanceA11y 扩展 data-mode/data-variant）；变体 chip 方向键切换（#mission-variants keydown）；__dbg 暴露 setMissionVariant。

## 74-tour.js

- **提供**: clickEnv, clickTerrain, syncTourCtl, tour, tourCap, tourGo, tourKey, tourNext, tourStart, tourSteps, tourStop, tourTick, tourTogglePause
- **依赖**: 70-app.js（S, apache, orbit）；45-flight.js（FLY）；01-host.js（HOST）
- **调用时机**: 一键导览：72-uibind 导览按钮/合成键 tourKey 启动，rAF 驱动 tourTick，Esc/点按交还控制权；暂停/跳段按钮（P2-B4）与状态经 HOST.tourState 供 __dbg 读取。

## 76-mobile.js

- **提供**: MobileSticks, mobileSticks
- **依赖**: 00-utils.js（clamp）；01-host.js（UI）；45-flight.js（FLY）；46-fpview.js（keys）
- **调用时机**: P4-A 移动端虚拟驾驶摇杆（环绕模式）：构造于脚本求值期（DOM 已就绪，静态绑定 Pointer Events）；左摇杆写 keys 表 arrowup/down/left/right（与键盘方向键同通路）、右摇杆 X 写 keys a/d（与 A/D 蹬舵同通路）、Y 事件驱动写 FLY.userAlt（仅 hover 且非 fp）；FPV 态经 body.fp-mode 由 CSS 隐藏（FPV 内由 #fp-touch 接管）；启旋/起降/FPV/武器复用面板按钮，本模块零新增按钮；遥测经 __dbg.mobile 供测试读取（250ms 轮询挂上后自清）。

## 79-weather.js

- **提供**: WeatherFX
- **依赖**: 00-utils.js（TAU, clamp, damp, lerp, rnd）；05-config.js（windVec）
- **调用时机**: Phase 13-M4 动态天气（沙暴/夜雷暴）：70-app finish 创建（constructor 收 renderer/W/audio），loop 每帧 update(dt, S.time)；72-uibind weather-row chip 调 setWeather（S.weather 为状态源）。沙暴=fog 密度 ×3.2 缓变 + 沙尘 InstancedMesh（1 draw，相机周围 60u 盒沿 windVec 强放大漂移）+ sky uSand 橙化 + audio.setWind 风声层；雷暴=闪电随机调度（sky uLflash 白闪+二次小闪）+ 延迟雷声（audio.playSfx('thunder')）；state() 遥测供测试。

## 80-music.js

- **提供**: FilmMusic
- **依赖**: 无（audio 经构造器注入；调度全部 Web Audio 程序化 + audio 样本层 brass/pad）
- **调用时机**: Phase 13-S4 电影配乐：70-app finish 创建（constructor 收 audio），audioKick 首手势后 start()（幂等）+ 默认 ambient；模式状态机 idle/ambient/battle/victory——startMission→battle（132BPM 鼓机+贝斯，100ms 前瞻调度）、completeMission→victory（五声音阶旋律，1.6s 后自动回落 ambient）、failMission/resetRange→ambient、updateTargetHUD 击毁→brass()（A1 brass 样本）；state() 遥测供测试。

## 81-narrative.js

- **提供**: NarrativeFX
- **依赖**: 00-utils.js（TAU, rnd）；01-host.js（HOST）
- **调用时机**: Phase 13-M5 环境叙事：70-app finish 经 HOST.makeNarrative 创建（constructor 收 scene/W），loop 每帧 syncEnabled（随 targets.enabled——湖面禁用靶场时叙事一并隐藏）+ update(dt, S.time, S.env)；基地（0,0,42）静态造型一次性构建（旋转雷达/防空车/探照灯/弹药堆）+ 每帧驱动（雷达盘慢转/灯组摇摆/2 机巡逻编队环形轨道/2 处远烟柱呼吸）；state() 遥测供测试。性能：程序化静态几何，draws 增量 ≤8。

## 82-cutscene.js

- **提供**: CUT_PRESETS, cutscene
- **依赖**: 00-utils.js（clamp, easeInOut）；01-host.js（HOST）；70-app.js（S, orbit, setView）
- **调用时机**: Phase 13-M6 过场叙事：复用 78-cinematic 的 orbit 参数直写 + letterbox + 字幕框架（独立 id cut-bar-*/cut-sub）。触发点由 70-app 经 HOST.cutsceneState.maybe 调用——startMission→mission（基地远景→目标推近→回机体+简报字幕，每局一次）、rescue delivered→rescue replay（机体侧上→绞车区→定格）；Esc/点击/任意键跳过；?nocut=1 全集跳过（自动化默认通道）；HOST 槽名 cutsceneState 避开顶层符号 cutscene（P2-B4 教训）。

## 83-arcade.js

- **提供**: ACHIEVEMENTS, ArcadeModule, COMBO_CAP, COMBO_STEP, COMBO_WINDOW, DIFFICULTIES, MISSION_VARIANT_KEYS, TARGET_SCORES
- **依赖**: 01-host.js（HOST, toast）
- **调用时机**: Phase 18 轻街机层（难度/分数/成就）：纯逻辑模块，70-app finish 经 HOST.makeArcade() 工厂槽注册实例并赋 `HOST.arcade = arcade`（79/80/81 先例；P0-1 教训——槽位必须真正装配，16-targets 依赖它）；难度系数表 DIFFICULTIES 为唯一数值源，coeffs(m) 缺省读 `HOST.S._mission.difficulty` 快照（startMission 冻结本局；16-targets/70-app 计分/AA/最高分归属统一由此派生）；16-targets 经 HOST.arcade 读 aaRate（开火间隔）/aaDmg（单发伤害）/targetResMul（目标抗打击系数 S1）/coeffs（命中概率**不**随难度缩放——S4 边界），70-app missionTimeout 读 timeoutMul；生命周期钩子 onMissionStart（本局清零）/onKill（击毁计分+连击窗口+击杀类即时授予 first_blood/combo5/wipeout S2）/onMissionDone（结算奖励+结果判定类成就+最高分持久化）/onMissionFailed；loop 每帧 update(S.time) 驱动连击衰减；state() 只读遥测经 72-uibind __dbg.arcade/__dbg.arcSlot 供测试；成就抽屉与难度 chips 由 70/72 经 achList()/diffKeys()/diffName() 读取口渲染（低编号不反向引用 83 顶层符号）；持久化 localStorage ah64_arcade_hi_<难度>/ah64_arcade_achv/ah64_arcade_achv_persist（隐私模式静默降级内存）。

