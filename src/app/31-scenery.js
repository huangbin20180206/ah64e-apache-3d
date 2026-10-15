// ============================================================
// 31-scenery.js — P4c 场景视觉提升（远山 / 树线 / 湖岸 / 停机坪设施）
// ============================================================
// 设计文档 §4.4。全部为静态合并几何，按场地/时段切显隐与配色：
//   hills  远山剪影环（两层，近深远浅；山脚混入地平线色 = 高度雾感）  1 draw，棚拍隐藏
//   trees  远景树线（InstancedMesh，半径 96~170）                     1 draw，停机坪/草地/湖面
//   shore  湖岸（沙滩 → 草地，半径 92~620，把无边水面收成湖）          1 draw，仅湖面
//   meadow 草地远景起伏（r 85~330，共用远景材质）                   1 draw，仅草地（P4d）
//   padGrass 停机坪外缘向草地过渡（r 40→75 渐显）                    1 draw，仅停机坪（P4d）
//   apron  停机坪设施（机库/照明桅杆/油车/滑行线/系留点）              1 draw，仅停机坪且非任务
//   lamps  照明桅杆灯头（黄昏/清晨/夜间点亮）                          1 draw，同 apron
// 不投影（太阳阴影相机只罩 ±8u），不进碰撞；地形、关卡坐标、航线全部不变。
// 拓扑：只读 05-config / 00-utils / 20-scene（ENV_PRESETS）。70-app 构造，70-loop 每帧 update。
// ============================================================

// 合并若干 {geo, col:[r,g,b]} 为一个带顶点色的非索引几何
function scnMerge(parts) {
  let n = 0;
  const gs = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; n += g.attributes.position.count; return g; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  gs.forEach((g, i) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = parts[i].col, m = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < m; k++) { col[(o + k) * 3] = c[0]; col[(o + k) * 3 + 1] = c[1]; col[(o + k) * 3 + 2] = c[2]; }
    o += m;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function _scnBox(w, h, d, x, y, z, ry) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function _scnCyl(rt, rb, h, x, y, z, seg) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg || 8);
  g.translate(x, y, z);
  return g;
}

// 远山高度剖面（确定性多频正弦，无随机 → 每次加载一致）
function scnHillH(a, layer) {
  const s = layer ? 1.7 : 1.0;
  return Math.max(0, 0.55 + 0.25 * Math.sin(a * 3 + layer) + 0.16 * Math.sin(a * 7.3 + 1.1 * layer)
    + 0.09 * Math.sin(a * 17.1 + 2.0) + 0.05 * Math.sin(a * 41.0)) * s;
}

// P4d 草地远景起伏：r≤85 贴地（飞行/靶场/碰撞区不变），85~200 渐起，260~330 回落到 0
function scnMeadowH(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(x, z);
  const rise = scnSmooth(85, 200, r) * (1 - scnSmooth(250, 330, r));
  const n = 4.2 + 2.6 * Math.sin(a * 4 + r * 0.021) + 1.6 * Math.sin(a * 9 - r * 0.043) + 0.9 * Math.sin(r * 0.11 + a * 2);
  return 0.06 + rise * Math.max(0, n);
}
function scnSmooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

const SCN_HILLS = [
  { R: 330, H: 34, haze0: 0.38, haze1: 0.16 },   // 近层：深
  { R: 520, H: 46, haze0: 0.66, haze1: 0.42 },   // 远层：浅（大气透视）
];

const _scnWarm = new THREE.Color(1.12, 0.94, 0.80);

function buildWorldScenery(W) {
  const scene = W.scene;
  const S = { hills: null, trees: null, shore: null, apron: null, lamps: null, _key: '' };

  // ---- 远山 ----
  {
    const SEG = 160, pos = [], haze = [];
    SCN_HILLS.forEach((L, li) => {
      for (let i = 0; i < SEG; i++) {
        const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
        const h0 = 4 + scnHillH(a0, li) * L.H, h1 = 4 + scnHillH(a1, li) * L.H;
        const p = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
        const A = p(a0, L.R, -3), B = p(a1, L.R, -3), C = p(a1, L.R, h1), D = p(a0, L.R, h0);
        pos.push(...A, ...B, ...C, ...A, ...C, ...D);
        haze.push(L.haze0, L.haze0, L.haze1, L.haze0, L.haze1, L.haze1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.userData.haze = haze;
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
    S.hills = new THREE.Mesh(g, m);
    S.hills.name = 'scn-hills';
    S.hills.frustumCulled = false;
    S.hills.renderOrder = -50;
    scene.add(S.hills);
  }

  // ---- 树线（InstancedMesh：锥形树冠 + 树干，一个几何） ----
  {
    const tree = scnMerge([
      { geo: _scnCyl(0.18, 0.26, 1.6, 0, 0.8, 0, 5), col: [0.30, 0.22, 0.15] },
      { geo: _scnCyl(0.0, 1.9, 4.2, 0, 3.4, 0, 7), col: [0.20, 0.33, 0.18] },
      { geo: _scnCyl(0.0, 1.4, 3.0, 0, 5.2, 0, 7), col: [0.24, 0.38, 0.20] },
    ]);
    const N = 460;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    const im = new THREE.InstancedMesh(tree, m, N);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const layout = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 96 + Math.pow(rnd(), 0.7) * 74;
      const s = 0.8 + rnd() * 0.9;
      p.set(Math.sin(a) * r, GROUND_Y, Math.cos(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      sc.set(s, s * (0.85 + rnd() * 0.4), s);
      M.compose(p, q, sc);
      im.setMatrixAt(i, M);
      layout.push({ p: p.clone(), q: q.clone(), s: sc.clone() });
    }
    // 草地起伏时树要落在坡面上；其它场地贴平地（换场地时重写 460 个矩阵）
    im.userData.place = (meadow) => {
      for (let i = 0; i < N; i++) {
        const L = layout[i];
        p.copy(L.p); p.y = GROUND_Y + (meadow ? scnMeadowH(L.p.x, L.p.z) - 0.2 : 0);
        M.compose(p, L.q, L.s);
        im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    im.name = 'scn-trees';
    im.frustumCulled = false;
    scene.add(im);
    S.trees = im;
  }

  // ---- 湖岸（沙滩 → 草地；只在湖面显示） ----
  {
    const g = new THREE.RingGeometry(92, 620, 96, 6);
    g.rotateX(-Math.PI / 2);
    const P = g.attributes.position, c = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const r = Math.hypot(P.getX(i), P.getZ(i));
      const k = clamp((r - 92) / 26, 0, 1);              // 沙滩 92~118 → 草地
      c[i * 3] = lerp(0.62, 0.26, k); c[i * 3 + 1] = lerp(0.55, 0.34, k); c[i * 3 + 2] = lerp(0.42, 0.18, k);
      P.setY(i, (k > 0.5 ? 0.25 : k * 0.5) + 0.05);         // 岸坡略高出水面
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 });
    S.shore = new THREE.Mesh(g, m);
    S.shore.name = 'scn-shore';
    S.shore.position.y = GROUND_Y;
    S.shore.visible = false;
    scene.add(S.shore);
  }

  // ---- P4d 草地远景起伏（共用 farMat；UV 按远景盘 CircleGeometry(600) 同式重写 → 贴图无缝）----
  // 外径只到 330（起伏回落为 0 处），外侧仍是远景盘本身——避免两层共面远处 z-fighting
  {
    const g = new THREE.RingGeometry(85, 330, 140, 30);
    const P = g.attributes.position, UV = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      P.setZ(i, scnMeadowH(x, -y));       // 本地 z → 旋转后世界 y；本地 y → 世界 -z
      UV.setXY(i, x / 1200 + 0.5, y / 1200 + 0.5);
    }
    g.computeVertexNormals();
    S.meadow = new THREE.Mesh(g, W.farMat);
    S.meadow.name = 'scn-meadow';
    S.meadow.rotation.x = -Math.PI / 2;
    S.meadow.position.y = GROUND_Y - 0.012;
    S.meadow.receiveShadow = false;
    S.meadow.visible = false;
    scene.add(S.meadow);
  }

  // ---- P4d 停机坪外缘向草地过渡（r 40→75 由透明渐到草色；alphaMap 径向渐变） ----
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
    const R0 = 40 / 600, R1 = 75 / 600;
    gr.addColorStop(0, '#000'); gr.addColorStop(R0, '#000'); gr.addColorStop(R1, '#fff'); gr.addColorStop(1, '#fff');
    cx.fillStyle = gr; cx.fillRect(0, 0, 256, 256);
    const am = new THREE.CanvasTexture(cv);
    const g = new THREE.RingGeometry(40, 600, 128, 12);
    // 顶点色：草色带低频斑驳（远景读作草地而非色块）
    const P = g.attributes.position, c = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      const v = 0.85 + 0.15 * Math.sin(x * 0.07) * Math.sin(y * 0.05) + 0.08 * Math.sin((x + y) * 0.19);
      c[i * 3] = 0.27 * v; c[i * 3 + 1] = 0.34 * v; c[i * 3 + 2] = 0.19 * v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, alphaMap: am, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1 });
    S.padGrass = new THREE.Mesh(g, m);
    S.padGrass.name = 'scn-padgrass';
    S.padGrass.rotation.x = -Math.PI / 2;
    S.padGrass.position.y = GROUND_Y + 0.01;
    S.padGrass.renderOrder = -10;
    S.padGrass.visible = false;
    scene.add(S.padGrass);
  }

  // ---- 停机坪设施 ----
  {
    const parts = [];
    const GRAY = [0.46, 0.48, 0.47], DARK = [0.16, 0.17, 0.18], ROOF = [0.36, 0.40, 0.38];
    const YEL = [0.85, 0.68, 0.12], OLIVE = [0.30, 0.33, 0.22];
    // 机库：西北（-38, 20），门朝 +x
    const hx = -38, hz = 20;
    parts.push({ geo: _scnBox(12, 6, 16, hx, 3, hz), col: GRAY });
    // 半圆柱拱顶：θ∈[-90°,90°] 的半圈在 +z 侧，绕 X 转 -90° 后朝上，轴沿 z
    const rf = new THREE.CylinderGeometry(6, 6, 16, 14, 1, false, -Math.PI / 2, Math.PI);
    rf.rotateX(-Math.PI / 2);
    rf.translate(hx, 6, hz);
    parts.push({ geo: rf, col: ROOF });
    parts.push({ geo: _scnBox(0.2, 5.2, 11, hx + 6.05, 2.6, hz), col: DARK });       // 大门
    // 滑行线：停机坪边缘 → 机库门
    const line = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
      parts.push({ geo: _scnBox(0.28, 0.02, L, (x0 + x1) / 2, 0.012, (z0 + z1) / 2, a), col: YEL });
    };
    line(-13, 7, -24, 20); line(-24, 20, -31.8, 20);
    line(13, -7, 22, -16);                                                           // 油车位引导线
    // 照明桅杆 ×4（避开航线）
    // 半径 ≥20 且偏离默认英雄机位方向（θ≈0.78），与晨间出勤航线水平间距 ≥7u
    const masts = [[22, -4], [-6, 24], [6, -20], [-24, -30]];
    const lampGeos = [];
    for (const [x, z] of masts) {
      parts.push({ geo: _scnCyl(0.12, 0.2, 9, x, 4.5, z, 6), col: GRAY });
      parts.push({ geo: _scnBox(1.2, 0.35, 0.6, x, 9.1, z), col: DARK });
      lampGeos.push({ geo: _scnBox(1.0, 0.12, 0.45, x, 8.88, z), col: [1, 1, 1] });
    }
    // 油车（东南 23, -17）：驾驶室 + 罐体 + 车轮
    const tx = 23, tz = -17, ta = 0.7;
    const tr = (g) => { g.rotateY(ta); g.translate(tx, 0, tz); return g; };
    parts.push({ geo: tr(_scnBox(1.9, 1.5, 1.6, 0, 1.15, 2.1)), col: OLIVE });
    const tank = new THREE.CylinderGeometry(0.9, 0.9, 4.0, 12); tank.rotateX(Math.PI / 2); tank.translate(0, 1.35, -0.6);
    parts.push({ geo: tr(tank), col: [0.55, 0.57, 0.50] });
    parts.push({ geo: tr(_scnBox(2.0, 0.3, 6.0, 0, 0.45, 0.3)), col: DARK });
    for (const [wx, wz] of [[-0.95, 2.0], [0.95, 2.0], [-0.95, -1.6], [0.95, -1.6]]) {
      const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10); w.rotateZ(Math.PI / 2); w.translate(wx, 0.42, wz);
      parts.push({ geo: tr(w), col: [0.08, 0.08, 0.08] });
    }
    // 系留点 ×6（坪内 r=11，暗色圆环桩）
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3;
      parts.push({ geo: _scnCyl(0.22, 0.22, 0.05, Math.sin(a) * 11, 0.025, Math.cos(a) * 11, 10), col: [0.85, 0.75, 0.2] });
    }
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.15 });
    S.apron = new THREE.Mesh(scnMerge(parts), m);
    S.apron.name = 'scn-apron';
    S.apron.position.y = GROUND_Y;
    S.apron.receiveShadow = true;
    scene.add(S.apron);
    const lm = new THREE.MeshBasicMaterial({ color: 0x8a8f94 });
    S.lamps = new THREE.Mesh(scnMerge(lampGeos), lm);
    S.lamps.name = 'scn-lamps';
    S.lamps.position.y = GROUND_Y;
    scene.add(S.lamps);
  }

  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
  // 配色随场地/时段（只在键变化时写）
  S.sync = function (terrain, env, mission) {
    const key = terrain + '|' + env + '|' + (mission ? 1 : 0);
    if (key === S._key) return false;
    S._key = key;
    const P = ENV_PRESETS[env] || ENV_PRESETS.day;
    const studio = env === 'studio';
    S.hills.visible = !studio;
    S.trees.visible = !studio && terrain !== 'desert';
    S.shore.visible = !studio && terrain === 'water';
    S.apron.visible = S.lamps.visible = terrain === 'pad' && !mission;
    S.padGrass.visible = !studio && terrain === 'pad';
    const meadow = terrain === 'grass';
    if (S.meadow.visible !== meadow || S._treesMeadow === undefined) {
      S.meadow.visible = meadow;
      S.trees.userData.place(meadow);
      S._treesMeadow = meadow;
    }
    // 远山：剪影色 = 地面色向场地色偏（沙漠偏沙色），再按 haze 混向地平线色
    _c1.setHex(P.ground).lerp(_c3.setHex(terrain === 'desert' ? 0x8a6a48 : 0x34443a), 0.55)
       .multiplyScalar(clamp(0.45 + P.hemi * 1.1, 0.25, 1.15));
    _c2.setHex(P.horizon);
    const col = S.hills.geometry.attributes.color, hz = S.hills.geometry.userData.haze;
    for (let i = 0; i < hz.length; i++) {
      _c3.copy(_c1).lerp(_c2, hz[i]);
      col.setXYZ(i, _c3.r, _c3.g, _c3.b);
    }
    col.needsUpdate = true;
    // 树/岸/设施：环境明度
    const lum = clamp(0.35 + P.hemi * 1.0 + P.sunI * 0.08, 0.2, 1.1);
    S.trees.material.color.setScalar(lum);
    S.shore.material.color.setScalar(lum);
    S.padGrass.material.color.setScalar(lum);
    // 灯头：清晨/黄昏/夜间点亮
    const lit = env === 'night' ? 1 : (env === 'dusk' || env === 'dawn') ? 0.7 : 0;
    S.lamps.material.color.setRGB(0.54 + lit * 0.46 * 2.2, 0.56 + lit * 0.44 * 2.0, 0.58 + lit * 0.3 * 1.6);
    return true;
  };
  return S;
}
