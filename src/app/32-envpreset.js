// ============================================================
// 32-envpreset.js — 环境预设切换（P1-D 拆迁）
// ============================================================
// [P1-D] 原 30-world.js 尾段。applyPreset 把 ENV_PRESETS 应用到
// 世界（天空 uniforms/灯光/雾/面板反光）与渲染器；scene_fog 设场地雾
// 基准密度（WashFX brownout 在此之上叠加）。与 buildWorld（构建期，
// 留在 30）是两个清晰生命周期。逻辑零改动。
// ============================================================

// 应用环境预设到世界与渲染器
function applyPreset(W, renderer, key) {
  const P = ENV_PRESETS[key];
  if (!P) return null;
  W.envKeyRef.v = key;
  const u = W.skyMat.uniforms;
  u.uZenith.value.setHex(P.zenith);
  u.uHorizon.value.setHex(P.horizon);
  u.uGround.value.setHex(P.ground);
  u.uSunCol.value.setHex(P.sunCol);
  u.uSunI.value = P.skySunI;
  u.uHaze.value = P.haze;
  u.uCloud.value = P.cloud;
  u.uStars.value = P.stars || 0;   // 电影镜头包 M1：夜空星星（预设驱动）

  const dir = sunVector(P.sunEl, P.sunAz);
  u.uSunDir.value.copy(dir);
  W.sun.position.copy(dir).multiplyScalar(18);
  W.sun.target.position.set(0, 0.6, 0);
  W.sun.color.setHex(P.sunCol);
  W.sun.intensity = P.sunI;

  W.fill.intensity = P.fill;
  W.rim.intensity = P.fill * 1.1;
  W.rim.color.setHex(P.sunCol);
  W.hemi.intensity = P.hemi;
  W.hemi.color.setHex(P.horizon);
  W.hemi.groundColor.setHex(P.ground);

  // 环境预设的地面色调只在"停机坪"场景直接生效；其它场地保留各自地面色调
  if (W.terrainKey === 'pad') {
    W.padMat.color.setHex(P.padTint);
    W.padMat.roughness = clamp(1.0 + P.padRough, 0.4, 1.0);
    W.farMat.color.setHex(P.padTint);
    if (W.duneFar) {
      W.duneFar.material.color.copy(W.farMat.color).multiplyScalar(0.78); // 沙丘深一档同步环境
    }
    scene_fog(W, P);
    W.envGround.material.color.setHex(P.padTint).multiplyScalar(0.55);
  } else {
    // 场地雾优先于环境雾（密度取场地值，距离语义不变）；颜色经 terrainFog
    // 混入环境预设雾色（P5-A(D)：夜间沙漠雾转暗、黄昏转暖——不再恒为日间场地色）
    const T = TERRAINS[W.terrainKey];
    const fg = terrainFog(T, P);
    if (fg) scene_fog(W, { fog: fg });
    // 沙漠远景沙丘环随预设协调：基色固定沙漠 farTint（沙色系）× 环境明度 ×
    // "深一档"0.78（与 30-world setTerrain 同一约定；P5-B(B)：不用停机坪
    // padTint——夜间 padTint 的蓝紫会与环外沙地断层。dusk 略暗/night 压暗，
    // 只调明度不换色相，沙丘环读作"背光沙坡"而非色块断层）。
    if (W.terrainKey === 'desert' && W.duneFar) {
      W.duneFar.material.color.setHex(DUNE_BASE).multiplyScalar(desertEnvDim(P) * 0.78);
    }
  }
  for (const p of W.panels) {
    p.material.color.copy(p.userData.baseColor).multiplyScalar(
      p.userData.baseI * (0.35 + P.hemi * 0.9 + P.fill * 0.5));
  }
  W.bakeEnv();
  return P;
}

function scene_fog(W, P) {
  const [c, d] = P.fog;
  W.scene.fog = new THREE.FogExp2(c, d);
  // 记下基准密度：WashFX 的 brownout 在此之上叠加，避免逐帧累积漂移
  W.fogBase.c = c;
  W.fogBase.d = d;
}
