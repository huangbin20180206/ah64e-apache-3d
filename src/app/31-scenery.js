// ============================================================
// 31-scenery.js — P4c 场景视觉提升（远山 / 树线 / 湖岸 / 停机坪设施）
// ============================================================
// 设计文档 §4.4。全部为静态合并几何，按场地/时段切显隐与配色：
//   hills  远山剪影环（两层，近深远浅；山脚混入地平线色 = 高度雾感）  1 draw，棚拍隐藏
//   trees  远景树线（CC0 树木图集十字面片 8 种 1360 棵，半径 90~170；贴图未到前为锥形兜底）1 draw，停机坪/草地/湖面
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
  const S = { hills: null, trees: null, shore: null, apron: null, lamps: null, _key: '',
    blast: () => 0, bulletHit: () => false, updateTrees: () => {}, resetTrees: () => {} };   // 真实树线加载后替换

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

  // ---- 真实树线（2026-10-16）：Poly Haven CC0 树木渲染图做"十字交叉面片"（每棵 3 片 60° 交叉），
  // 8 种树：冷杉/云杉/松（针叶林成片）+ 阔叶树/蓝花楹/老橄榄树（阔叶林成片）+ 林缘灌木。
  // 全部合并成一个网格（1 次绘制）；贴图加载成功即替换上面的锥形兜底树，失败则保留兜底。
  {
    // 图集单元：[u0, v0, u1, v1, 宽高比]（assets/scenery/trees.webp，2048×1024，4×2 格，底对齐）
    const CELLS = [[0.0459, 0.5, 0.2041, 0.9961, 0.638], [0.3037, 0.5, 0.4458, 0.9961, 0.573],
      [0.5586, 0.5, 0.6909, 0.9961, 0.533], [0.8179, 0.5, 0.9321, 0.9961, 0.461],
      [0.041, 0.0, 0.209, 0.4961, 0.677], [0.252, 0.0, 0.498, 0.3701, 1.33],
      [0.5093, 0.0, 0.7402, 0.4961, 0.931], [0.752, 0.0, 0.998, 0.3193, 1.541]];
    // 树种：[图集格, 高度下限, 高度上限（u，1u≈2.27m）]
    const CONIFER = [[0, 9, 12.5, 0.5], [1, 6, 9, 0.17], [2, 6, 8.5, 0.17], [3, 7, 10, 0.16]];   // 冷杉 20~28m 等
    const BROAD = [[4, 4.5, 7, 0.4], [5, 4, 6, 0.3], [6, 4, 6.5, 0.3]];                       // 阔叶 9~16m
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = (L) => { let r = rnd(), i = 0; for (; i < L.length - 1; i++) { r -= L[i][3]; if (r <= 0) break; } return L[i]; };
    const trees = [];   // {x, z, cell, h, rot, tint:[r,g,b]}
    for (let i = 0; i < 1250; i++) {
      const a = rnd() * Math.PI * 2, r = 96 + Math.pow(rnd(), 0.7) * 74;
      // 林分：按方位角起伏分出针叶林片区和阔叶林片区（不是均匀撒混）
      const stand = 0.5 + 0.5 * Math.sin(a * 5 + 1.3) * Math.cos(a * 2.1 + 0.4);
      const con = rnd() < 0.15 + 0.7 * stand;
      const sp = pick(con ? CONIFER : BROAD);
      const h = sp[1] + rnd() * (sp[2] - sp[1]);
      const k = 0.78 + rnd() * 0.3;                         // 明暗
      const tint = con ? [k * 0.95, k, k * 0.95] : [k * (1 + rnd() * 0.12), k * (1 + rnd() * 0.05), k * (0.82 + rnd() * 0.12)];
      trees.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, cell: sp[0], h, rot: rnd() * Math.PI, tint });
    }
    for (let i = 0; i < 110; i++) {                         // 林缘灌木（内圈 90~100）
      const a = rnd() * Math.PI * 2, r = 90 + rnd() * 10, k = 1.0 + rnd() * 0.25;
      trees.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, cell: 7, h: 1.4 + rnd() * 1.2, rot: rnd() * Math.PI, tint: [k, k, k * 0.9] });
    }
    const NV = trees.length * 12;
    const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), uv = new Float32Array(NV * 2),
      col = new Float32Array(NV * 3), idx = new Uint32Array(trees.length * 18), root = new Uint16Array(NV);
    let v = 0, t = 0;
    trees.forEach((T, ti) => {
      const C = CELLS[T.cell], w = T.h * C[4] / 2;
      for (let q = 0; q < 3; q++) {
        const ang = T.rot + q * Math.PI / 3, dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
        const base = v;
        [[-1, 0, C[0], C[1]], [1, 0, C[2], C[1]], [1, 1, C[2], C[3]], [-1, 1, C[0], C[3]]].forEach(([sx, sy, u, vv]) => {
          pos[v * 3] = T.x + dx * sx; pos[v * 3 + 1] = sy * T.h - (T.cell === 7 ? 0.1 : 0.05); pos[v * 3 + 2] = T.z + dz * sx;
          nor[v * 3 + 1] = 1;                               // 法线朝上：任何角度看过去明暗一致，不会侧面发黑
          uv[v * 2] = u; uv[v * 2 + 1] = vv;
          col[v * 3] = T.tint[0]; col[v * 3 + 1] = T.tint[1]; col[v * 3 + 2] = T.tint[2];
          root[v] = ti; v++;
        });
        idx.set([base, base + 1, base + 2, base, base + 2, base + 3], t); t += 6;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    // ---- 树木受爆炸影响（2026-10-16）：冲击波摇晃 / 近爆折倒 / 烧焦起火冒烟 ----
    // 每棵树的 12 个顶点 = 树根 + 局部偏移；倾倒 = 绕树根、沿"背离爆心"方向旋转
    const LOC = new Float32Array(NV * 3);
    for (let i = 0; i < NV; i++) {
      const T = trees[root[i]];
      LOC[i * 3] = pos[i * 3] - T.x; LOC[i * 3 + 1] = pos[i * 3 + 1]; LOC[i * 3 + 2] = pos[i * 3 + 2] - T.z;
    }
    trees.forEach(T => { T.yoff = 0; T.lx = 1; T.lz = 0; T.ang = 0; T.fall = 0; T.fallV = 0; T.sway = 0; T.swayT = 0; T.burn = 0; T.fire = 0; T.char = 0; });
    function _writeTree(ti) {
      const T = trees[ti], a = T.fall + T.sway, c = Math.cos(a), sn = Math.sin(a), pa = pos;
      const k = 1 - T.char;
      for (let v = ti * 12; v < ti * 12 + 12; v++) {
        const ox = LOC[v * 3], oy = LOC[v * 3 + 1], oz = LOC[v * 3 + 2];
        const d = ox * T.lx + oz * T.lz, px = ox - d * T.lx, pz = oz - d * T.lz;   // 沿倒向分量 / 垂直分量
        const d2 = d * c + oy * sn, y2 = -d * sn + oy * c;
        pa[v * 3] = T.x + px + d2 * T.lx; pa[v * 3 + 1] = GROUND_Y + T.yoff + Math.max(y2, -0.05); pa[v * 3 + 2] = T.z + pz + d2 * T.lz;
        // 烧焦：颜色压向炭黑
        col[v * 3] = T.tint[0] * k + 0.16 * T.char; col[v * 3 + 1] = T.tint[1] * k + 0.13 * T.char; col[v * 3 + 2] = T.tint[2] * k + 0.11 * T.char;
      }
    }
    const _active = new Set();
    // 爆炸：tier 1 机炮击毁 / 2 火箭 / 3 地狱火（半径单位 u，1u≈2.27m）
    S.blast = function (x, y, z, tier) {
      if (y > 9) return 0;                               // 空中爆炸（打无人机/直升机）不波及树
      if (!S.trees || S.trees.name !== 'scn-trees' || !S.trees.isMesh || S.trees.isInstancedMesh || !S.trees.visible) return 0;
      const R = tier >= 3 ? [3.6, 6.5, 11] : tier <= 1 ? [0, 1.2, 3.5] : [2.2, 4.2, 7.5];   // 折倒 / 烧焦起火 / 摇晃
      let n = 0;
      for (let i = 0; i < trees.length; i++) {
        const T = trees[i], dx = T.x - x, dz = T.z - z;
        if (Math.abs(dx) > R[2] || Math.abs(dz) > R[2]) continue;
        const d = Math.hypot(dx, dz);
        if (d > R[2]) continue;
        const L = d > 0.01 ? d : 1;
        if (T.fall === 0) { T.lx = d > 0.01 ? dx / L : 1; T.lz = d > 0.01 ? dz / L : 0; }
        if (d < R[0] && T.fall === 0) {                  // 折倒：先被推一下，再在重力下倒地
          T.fallV = 0.6 + (1 - d / R[0]) * 1.4; T.fall = 0.001;
        } else if (T.fall === 0) {                       // 摇晃：越近幅度越大
          T.sway = Math.max(T.sway, (1 - d / R[2]) * (tier >= 3 ? 0.35 : 0.22)); T.swayT = 0;
        }
        if (d < R[1]) {                                  // 烧焦 + 起火（灌木/阔叶更易着）
          T.char = Math.min(0.85, T.char + (1 - d / R[1]) * 0.9 + 0.25);
          if (rnd() < 0.75) T.fire = Math.max(T.fire, 6 + rnd() * 8);
          T.burn = Math.max(T.burn, 16 + rnd() * 10);
        }
        _active.add(i); n++;
      }
      return n;
    };
    // 火焰/烟：独立小池子，不占武器烟尘池
    const _fx = [];
    {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const tx = new THREE.CanvasTexture(cv);
      for (let i = 0; i < 96; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, opacity: 0 }));
        sp.visible = false; sp.renderOrder = 6; scene.add(sp);
        _fx.push({ sp, t: 0, life: 1, s0: 1, s1: 2, rise: 1, base: 1 });
      }
    }
    function _emit(x, y, z, fire, leaf) {
      for (const f of _fx) {
        if (f.sp.visible) continue;
        f.sp.visible = true; f.sp.position.set(x, y, z); f.t = 0; f.vx = f.vz = 0;
        const m = f.sp.material;
        if (leaf) { m.color.setHex(leaf); m.blending = THREE.NormalBlending; f.life = 1.6 + rnd() * 1.2; f.s0 = 0.4; f.s1 = 0.55; f.rise = -0.9 - rnd() * 0.6; f.base = 0.95;
          f.vx = (rnd() - 0.5) * 1.6; f.vz = (rnd() - 0.5) * 1.6; }
        else if (fire) { m.color.setHex(rnd() < 0.5 ? 0xff6a1c : 0xffa040); m.blending = THREE.AdditiveBlending; f.life = 0.5 + rnd() * 0.4; f.s0 = 1.0; f.s1 = 2.2; f.rise = 2.2; f.base = 1.0; }
        else { m.color.setHex(0x34302b); m.blending = THREE.NormalBlending; f.life = 4 + rnd() * 2; f.s0 = 1.4; f.s1 = 6.5; f.rise = 1.6; f.base = 0.7; }
        return;
      }
    }
    S.updateTrees = function (dt) {
      for (const f of _fx) {
        if (!f.sp.visible) continue;
        f.t += dt; const k = f.t / f.life;
        if (k >= 1) { f.sp.visible = false; continue; }
        f.sp.position.y += f.rise * dt; f.sp.position.x += f.vx * dt; f.sp.position.z += f.vz * dt;
        if (f.sp.position.y < 0.05) f.sp.position.y = 0.05;
        f.sp.scale.setScalar(f.s0 + (f.s1 - f.s0) * k);
        f.sp.material.opacity = f.base * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      }
      if (!_active.size) return;
      let dirty = false;
      for (const i of _active) {
        const T = trees[i];
        if (T.fall > 0 && T.fall < 1.45) {             // 倒下：角速度随倾角增大（重力），着地轻弹一下停住
          T.fallV += Math.sin(T.fall + 0.15) * 3.2 * dt; T.fall = Math.min(1.45, T.fall + T.fallV * dt);
          if (T.fall >= 1.45) T.fallV = 0;
        }
        if (T.sway > 0.002) { T.swayT += dt; T.sway *= Math.exp(-2.2 * dt); }
        else T.sway = 0;
        const sw = T.sway ? T.sway * Math.cos(T.swayT * 7) : 0;
        const keep = T.sway; T.sway = sw; _writeTree(i); T.sway = keep;
        dirty = true;
        if (T.fire > 0) {
          T.fire -= dt;
          const top = T.fall > 0.6 ? 0.8 : T.h * 0.55;
          if (rnd() < dt * 9) _emit(T.x + T.lx * (T.fall > 0.6 ? T.h * 0.4 : 0) + (rnd() - 0.5), GROUND_Y + T.yoff + top * rnd(0.3, 1), T.z + T.lz * (T.fall > 0.6 ? T.h * 0.4 : 0) + (rnd() - 0.5), true);
        }
        if (T.burn > 0) {
          T.burn -= dt;
          if (rnd() < dt * 2.2) _emit(T.x + (rnd() - 0.5), GROUND_Y + T.yoff + (T.fall > 0.6 ? 1 : T.h * 0.35), T.z + (rnd() - 0.5), false);
        }
        if (!(T.fall > 0 && T.fall < 1.45) && T.sway === 0 && T.fire <= 0 && T.burn <= 0) _active.delete(i);
      }
      if (dirty) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
    };
    // ---- 机炮子弹打进树林：飞叶/树皮屑 + 小幅摇晃；同一棵树挨够子弹会被打断倒下 ----
    // 空间网格（4u 一格）加速：子弹每帧分段判定，只查所在格及邻格
    const _grid = new Map(), GS = 4;
    trees.forEach((T, i) => {
      T.hp = T.cell === 7 ? 6 : T.cell >= 4 ? 26 : 34;
      const k = Math.floor(T.x / GS) + ',' + Math.floor(T.z / GS);
      (_grid.get(k) || _grid.set(k, []).get(k)).push(i);
    });
    const LEAF = [0x3f5a2a, 0x56702f, 0x6b6a33, 0x4a3b28];
    S.bulletHit = function (p, dir) {
      if (!S.trees || !S.trees.visible || S.trees.isInstancedMesh) return false;
      const r2 = p.x * p.x + p.z * p.z;
      if (r2 < 80 * 80 || r2 > 176 * 176 || p.y > 32) return false;
      const gx = Math.floor(p.x / GS), gz = Math.floor(p.z / GS);
      for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const L = _grid.get(ix + ',' + iz);
        if (!L) continue;
        for (const i of L) {
          const T = trees[i];
          if (T.fall > 0.6) continue;
          const y = p.y - GROUND_Y - T.yoff;
          if (y < 0 || y > T.h) continue;
          const d = Math.hypot(p.x - T.x, p.z - T.z), w = T.h * CELLS[T.cell][4] / 2;
          const inCanopy = y > T.h * 0.3 && d < w * 0.55, inTrunk = d < 0.35;
          if (!inCanopy && !inTrunk) continue;
          for (let n = 0; n < 6; n++) _emit(p.x + (rnd() - 0.5) * 0.9, p.y + (rnd() - 0.5) * 0.6, p.z + (rnd() - 0.5) * 0.6, false, inTrunk && !inCanopy && n > 1 ? 0x6a5640 : LEAF[(rnd() * 4) | 0]);
          T.hp--;
          if (T.fall === 0) {
            const l = Math.hypot(dir.x, dir.z) || 1; T.lx = dir.x / l; T.lz = dir.z / l;
            if (T.hp <= 0) { T.fall = 0.001; T.fallV = 0.5; }
            else { T.sway = Math.max(T.sway, T.cell === 7 ? 0.12 : 0.04); T.swayT = 0; }
          }
          _active.add(i);
          return true;
        }
      }
      return false;
    };
    // 换场地/重开任务：树全部复原
    S.resetTrees = function () {
      trees.forEach((T, i) => { T.fall = T.fallV = T.sway = T.fire = T.burn = T.char = 0; T.hp = T.cell === 7 ? 6 : T.cell >= 4 ? 26 : 34; _writeTree(i); });
      _active.clear();
      for (const f of _fx) f.sp.visible = false;
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    };
    new THREE.TextureLoader().load('assets/scenery/trees.webp', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
      // 双面材质默认把背面法线翻到朝下 → 一半面片发黑；这里去掉翻转，正反面同样受光
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      };
      const bb = new THREE.Mesh(geo, mat);
      bb.name = 'scn-trees';
      bb.frustumCulled = false;
      // 与兜底树同一接口：place(meadow) 让树落在草地坡面上
      bb.userData.place = (meadow) => {
        for (let i = 0; i < trees.length; i++) { trees[i].yoff = meadow ? scnMeadowH(trees[i].x, trees[i].z) - 0.2 : 0; _writeTree(i); }
        geo.attributes.position.needsUpdate = true;
      };
      const old = S.trees;
      bb.visible = old.visible;
      mat.color.copy(old.material.color);
      bb.userData.place(!!S._treesMeadow);
      scene.remove(old);
      scene.add(bb);
      S.trees = bb;
    });
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
    // polish3：机库/油车先用方块占位（fb），真模型（铁皮仓库 + M978 油罐车 GLB）加载完就替换
    const fb = [];
    fb.push({ geo: _scnBox(12, 6, 16, hx, 3, hz), col: GRAY });
    // 半圆柱拱顶：θ∈[-90°,90°] 的半圈在 +z 侧，绕 X 转 -90° 后朝上，轴沿 z
    const rf = new THREE.CylinderGeometry(6, 6, 16, 14, 1, false, -Math.PI / 2, Math.PI);
    rf.rotateX(-Math.PI / 2);
    rf.translate(hx, 6, hz);
    fb.push({ geo: rf, col: ROOF });
    fb.push({ geo: _scnBox(0.2, 5.2, 11, hx + 6.05, 2.6, hz), col: DARK });       // 大门
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
    fb.push({ geo: tr(_scnBox(1.9, 1.5, 1.6, 0, 1.15, 2.1)), col: OLIVE });
    const tank = new THREE.CylinderGeometry(0.9, 0.9, 4.0, 12); tank.rotateX(Math.PI / 2); tank.translate(0, 1.35, -0.6);
    fb.push({ geo: tr(tank), col: [0.55, 0.57, 0.50] });
    fb.push({ geo: tr(_scnBox(2.0, 0.3, 6.0, 0, 0.45, 0.3)), col: DARK });
    for (const [wx, wz] of [[-0.95, 2.0], [0.95, 2.0], [-0.95, -1.6], [0.95, -1.6]]) {
      const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10); w.rotateZ(Math.PI / 2); w.translate(wx, 0.42, wz);
      fb.push({ geo: tr(w), col: [0.08, 0.08, 0.08] });
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
    const fbm = new THREE.Mesh(scnMerge(fb), m);
    fbm.name = 'scn-apron-fb';
    S.apron.add(fbm);
    // 真模型：铁皮仓库当机库（卷帘门朝模型 +Z → 转 90° 朝停机坪 +x，宽 16 沿 z），
    // M978 HEMTT 油罐车（真车长 10.2m ≈ 4.3u，车头朝模型 +Z，沿原引导线角度 0.7）
    const real = new THREE.Group();
    real.name = 'scn-apron-real';
    S.apron.add(real);
    let got = 0;
    const fit = (url, ry, size, axis, x, z, done) => new THREE.GLTFLoader().load(url, (gl) => {
      const o = gl.scene;
      o.traverse(q => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } });
      const b = new THREE.Box3().setFromObject(o, true), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const k = size / Math.max(axis === 'x' ? sz.x : sz.z, 1e-4);
      o.scale.multiplyScalar(k);
      o.position.set((o.position.x - c.x) * k, (o.position.y - b.min.y) * k, (o.position.z - c.z) * k);
      const g = new THREE.Group(); g.add(o); g.rotation.y = ry; g.position.set(x, 0, z);
      real.add(g);
      if (done) done(g, sz.clone().multiplyScalar(k));
      if (++got === 2) fbm.visible = false;
    }, undefined, () => {});
    // 仓库原贴图是锈透的民用铁皮棚，放在军用停机坪旁不合理 → 材质乘一层军用灰绿，锈迹变成旧漆斑
    fit('assets/targets/warehouse.glb', Math.PI / 2, 16, 'x', hx, hz, (g) => g.traverse(q => {
      if (q.isMesh) { q.material = q.material.clone(); q.material.color.setRGB(0.6, 0.66, 0.6); }
    }));
    fit('assets/targets/fuel.glb', ta, 4.3, 'z', tx, tz);
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
    S.resetTrees();
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
