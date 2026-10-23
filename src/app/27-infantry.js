// ============================================================
// 27-infantry.js — 敌方步兵小队（P5-G2，2026-10-16；2026-10-18 ASSETS4 换真人动画模型）
// ============================================================
// 模型：团结 AI 生成的两个带骨骼角色（AIGC，见 CREDITS.md）——
//   assets/targets/soldier_rifle.glb 步枪兵（AK）/ soldier_rpg.glb 火箭筒兵（RPG-7 扛肩）/
//   soldier_pkm.glb 机枪手（PKM，3 发连射）/ soldier_officer.glb 指挥官（ASSETS5），
//   各带 Idle / Walk / Run 三段循环动作。武器是模型自带的，不再程序化拼接。
// 烘焙：加载时用 AnimationMixer 把动作采样成静态帧（站立 1 帧 + 走路 6 帧 + 奔跑 6 帧），
//   每帧做一次 CPU 蒙皮（运行时不算骨骼——GPU 蒙皮在部分显卡/软件渲染下会丢失 WebGL 上下文），
//   每种(兵种×帧)一个 InstancedMesh：同帧所有人一次绘制，空帧 count=0 不绘制。
//   倒地 = 站立帧放倒（实例矩阵旋转），不占额外几何。bakeClipPoses 也给 27-life（平民）用。
// 行为（仅游戏关卡、基地靶场启用、非训练/航线时出现）：
//   · 平时：哨兵持枪站岗；每队 2 名巡逻兵在 1.8u 长的岗线上来回走（走路动画，两端停 2–3 秒）
//   · 直升机进入 42u 内且离地 → 转身面向直升机，步枪曳光点射（低伤害）
//   · RPG 兵瞄准，冷却 9–14 秒发射一枚火箭弹（带尾烟、可看见、可躲），近炸伤害
//   · 附近爆炸 → 幸存者朝远离爆点方向奔跑 2.5–4 秒（奔跑动画）再恢复射击
//   · 机炮一发命中即倒地；爆炸半径内倒地；击毙计分（arcade 'infantry'）
// 伤害走 16-targets 的既有受损链（_heliDmg / onHeliHit → 受击反馈/损伤系统）。
// 依赖（运行时注入）：range = BaseRange（16-targets），fx = WeaponRig（65-weapons）
// ============================================================

const INF_H = 0.81;                 // 人高（1.78m，1u≈2.2m）
const INF_WALK_N = 6, INF_RUN_N = 6;
// 帧键：idle / w0..w5（走）/ r0..r5（跑）
// ASSETS5（2026-10-19）：四个兵种。每队 = 队长（1 队指挥官、其余机枪手）+ 2 名巡逻步枪兵 + 1 名火箭筒兵
const INF_KINDS = ['s', 'g', 'm', 'o'];
const INF_URL = { s: 'assets/targets/soldier_rifle.glb', g: 'assets/targets/soldier_rpg.glb', m: 'assets/targets/soldier_pkm.glb', o: 'assets/targets/soldier_officer.glb' };
const INF_LABEL = { s: '步兵', g: '火箭筒兵', m: '机枪手', o: '指挥官' };
// ASSETS6（2026-10-19 第三批）战斗动作帧：a=瞄准静帧、f0..f3=开火循环、c0..c3=备用战斗循环
//（步枪兵蹲射 / 机枪手趴射 / 指挥官对讲机）、d0..d5=中弹倒地（末帧躺平）。模型缺该动作就不烘，_draw 回退旧帧。
const _q4 = nm => [0, 0.25, 0.5, 0.75].map((t, i) => [null, nm, t, i]);
const _dth = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t, i) => ['d' + i, 'Death', t]);
const INF_EXTRA = {
  s: [['a', 'Aim', 0]].concat(_q4('Fire').map(e => ['f' + e[3], e[1], e[2]]), _q4('CrouchFire').map(e => ['c' + e[3], e[1], e[2]]), _dth),
  g: [['a', 'KneelAim', 0]].concat(_q4('Fire').map(e => ['f' + e[3], e[1], e[2]]), _dth),
  m: [['a', 'Fire', 0]].concat(_q4('Fire').map(e => ['f' + e[3], e[1], e[2]]), _q4('ProneFire').map(e => ['c' + e[3], e[1], e[2]]), _dth),
  o: [['a', 'Radio', 0]].concat(_q4('Point').map(e => ['f' + e[3], e[1], 0.2 + e[2] * 0.8]), _q4('Radio').map(e => ['c' + e[3], e[1], e[2]]), _dth),
};
const INF_FRAMES = ['idle'].concat([...Array(INF_WALK_N)].map((_, i) => 'w' + i), [...Array(INF_RUN_N)].map((_, i) => 'r' + i));
const _ifV = new THREE.Vector3(), _ifV2 = new THREE.Vector3(), _ifM = new THREE.Matrix4(),
  _ifQ = new THREE.Quaternion(), _ifS = new THREE.Vector3(), _ifE = new THREE.Euler();

// 动作采样烘焙：gltf（带 Idle/Walk/Run 动画的人形骨骼模型，正面 +Z、Y 上）→
// { idle, w0.., r0.. : BufferGeometry, mat }。人高按 Idle 首帧缩放到 H；
// 每帧扣掉髋骨水平位移（原地动作）、最低点贴 y=0。失败返回 null。
// extra（ASSETS6 可选）：[[帧键, 动作名, 时间比例 0..1], ...]，动作不存在的帧跳过（调用方回退）。
function bakeClipPoses(gltf, H, extra) {
  const root = gltf.scene;
  let sm = null;
  root.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (!sm || !gltf.animations || !gltf.animations.length) return null;
  const clip = nm => gltf.animations.find(a => a.name.toLowerCase() === nm) || null;
  const cIdle = clip('idle'), cWalk = clip('walk') || cIdle, cRun = clip('run') || cWalk;
  if (!cIdle) return null;
  const mixer = new THREE.AnimationMixer(root);
  // 髋骨（人形）；四足动物没有 Hips → 用骨架根骨（父节点不是骨头的那根）
  const sk = sm.skeleton, hips = sk.bones.find(b => /hips/i.test(b.name)) || sk.bones.find(b => !(b.parent && b.parent.isBone)) || sk.bones[0];
  const sg = sm.geometry, pa = sg.attributes.position, na = sg.attributes.normal,
    ja = sg.attributes.skinIndex, wa = sg.attributes.skinWeight, ua = sg.attributes.uv, n = pa.count;
  const BM = sk.bones.map(() => new THREE.Matrix4()), rInv = new THREE.Matrix4(), hp = new THREE.Vector3();
  const pose = (c, t) => {
    mixer.stopAllAction();
    const a = mixer.clipAction(c);
    a.reset(); a.play(); a.time = t;
    mixer.update(0);
    root.updateMatrixWorld(true);
    rInv.copy(root.matrixWorld).invert();
    return hp.setFromMatrixPosition(hips.matrixWorld).applyMatrix4(rInv).clone();
  };
  const h0 = pose(cIdle, 0);
  let sc = 1, UV = null;
  if (ua) { UV = new Float32Array(n * 2); for (let i = 0; i < n; i++) { UV[i * 2] = ua.getX(i); UV[i * 2 + 1] = ua.getY(i); } }
  const IDX = sg.index ? Uint32Array.from(sg.index.array) : null;
  // 骨骼索引/权重解成平铺数组（兼容量化/交错属性；旧版 three 无 getComponent）
  const JS = new Uint16Array(n * 4), WS = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    JS[i * 4] = ja.getX(i); JS[i * 4 + 1] = ja.getY(i); JS[i * 4 + 2] = ja.getZ(i); JS[i * 4 + 3] = ja.getW(i);
    WS[i * 4] = wa.getX(i); WS[i * 4 + 1] = wa.getY(i); WS[i * 4 + 2] = wa.getZ(i); WS[i * 4 + 3] = wa.getW(i);
  }
  const skin = (c, t) => {
    const hx = pose(c, t);
    for (let b = 0; b < sk.bones.length; b++) {
      BM[b].multiplyMatrices(rInv, sk.bones[b].matrixWorld).multiply(sk.boneInverses[b]).multiply(sm.bindMatrix);
    }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
      let ox = 0, oy = 0, oz = 0, qx = 0, qy = 0, qz = 0;
      for (let j = 0; j < 4; j++) {
        const w = WS[i * 4 + j];
        if (w === 0) continue;
        const e = BM[JS[i * 4 + j]].elements;
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
        qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
        qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
        qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
      }
      const l = Math.hypot(qx, qy, qz) || 1;
      P[i * 3] = ox - (hx.x - h0.x); P[i * 3 + 1] = oy; P[i * 3 + 2] = oz - (hx.z - h0.z);
      N[i * 3] = qx / l; N[i * 3 + 1] = qy / l; N[i * 3 + 2] = qz / l;
      if (oy < minY) minY = oy; if (oy > maxY) maxY = oy;
    }
    return { P, N, minY, maxY };
  };
  const out = {}, meta = {};
  const mk = (key, c, t) => {
    const r = skin(c, t);
    // H>0：按 Idle 首帧身高缩放到 H；H<0：固定比例 -H（ASSETS6 动物/驴车：模型本身是真实米制）
    if (key === 'idle') { sc = H < 0 ? -H : H / Math.max(1e-3, r.maxY - r.minY); meta.sc = sc; meta.y0 = r.minY; }
    for (let i = 0; i < n; i++) {
      r.P[i * 3] *= sc; r.P[i * 3 + 1] = (r.P[i * 3 + 1] - r.minY) * sc; r.P[i * 3 + 2] *= sc;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(r.N, 3));
    if (UV) g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    if (IDX) g.setIndex(new THREE.BufferAttribute(IDX, 1));
    g.computeBoundingSphere();
    out[key] = g;
  };
  mk('idle', cIdle, 0);
  for (let i = 0; i < INF_WALK_N; i++) mk('w' + i, cWalk, cWalk.duration * i / INF_WALK_N);
  for (let i = 0; i < INF_RUN_N; i++) mk('r' + i, cRun, cRun.duration * i / INF_RUN_N);
  if (extra) for (const [key, nm, fr] of extra) {
    const c = clip(nm.toLowerCase());
    if (c) mk(key, c, Math.min(c.duration * fr, Math.max(0, c.duration - 1e-3)));
  }
  mixer.stopAllAction();
  out.mat = sm.material;
  meta.dur = { w: cWalk.duration, r: cRun.duration, i: cIdle.duration };
  // 比例/时长等元数据设为不可枚举：调用方用 Object.keys 遍历帧几何，不会把它们当帧
  for (const k in meta) Object.defineProperty(out, k, { value: meta[k], enumerable: false });
  return out;
}

class Infantry {
  constructor(scene) {
    this.scene = scene;
    this.range = null;            // BaseRange（16-targets）
    this.fx = null;               // WeaponRig
    this.onKill = null;           // (label) 击毙回调（计分/信息流）
    this.onToast = null;
    this.active = false;
    this.men = [];
    this.meshes = null;
    this.ready = false;
    this._rpgWarned = false;
    this._tracers = [];
    this._rpgs = [];
    // 自动化测试（webdriver）默认不出现，保老测试不被步兵挡子弹/打伤；截图脚本可置 allow=true
    this.allow = !(typeof navigator !== 'undefined' && navigator.webdriver);
    this._layout();
    // 兵种模型：s=步枪 g=火箭筒（必需，任一失败 → 不出现步兵）；m=机枪手 o=指挥官（ASSETS5，可缺省→用步枪兵外观）
    const L = new THREE.GLTFLoader(), got = {};
    const done = (k, g) => { got[k] = g; if (INF_KINDS.every(q => q in got) && got.s && got.g) this._build(got); };
    for (const k of INF_KINDS) L.load(INF_URL[k], (g) => done(k, g), undefined, () => done(k, null));
  }

  // 3 个小队 × 4 人（每队 1 名 RPG 兵），位置相对基地中心 BASE_C，靠沙袋/工事
  _layout() {
    const BC = BASE_C;
    const squads = [
      { c: [-3, -12.5], face: PI },          // 南门内侧前沿
      { c: [15, 11.5], face: PI * 0.75 },    // 东北营区
      { c: [-19, -6], face: PI * 1.15 },     // 西侧雷达站外
    ];
    const offs = [[0, 0], [1.2, 0.5], [-1.1, 0.7], [0.3, 1.5]];
    squads.forEach((sq, qi) => {
      offs.forEach(([ox, oz], i) => {
        const x = BC.x + sq.c[0] + ox, z = BC.z + sq.c[1] + oz;
        this.men.push({
          home: { x, z, ry: sq.face + (rnd() - 0.5) * 0.6 }, x, z, ry: 0,
          rpg: i === 3, k: i === 3 ? 'g' : i === 0 ? (qi === 0 ? 'o' : 'm') : 's', burst: 0, alive: true, st: 'idle', t: 0, cd: rnd(2, 6), flee: 0, fx: 0, fz: 0, ph: rnd(TAU),
          // 巡逻兵（每队第 2、3 人）：沿垂直于朝向的 1.8u 岗线来回走；pk=当前去往端点(0/1)，pw=端点停留
          patrol: i === 1 || i === 2, pk: i & 1, pw: rnd(0.5, 2.5), walk: false, shotT: 0,
        });
      });
    });
    this.reset();
  }

  _build(got) {
    const B = {};
    try { for (const k of INF_KINDS) if (got[k]) B[k] = bakeClipPoses(got[k], INF_H, INF_EXTRA[k]); } catch (e) { console.warn('[infantry] bake', e); return; }
    if (!B.s || !B.g) return;
    // 可缺省兵种模型没到 → 该兵种用步枪兵外观
    for (const p of this.men) if (!B[p.k]) p.k = 's';
    // 每种(兵种 × 帧)一个 InstancedMesh；容量按该兵种人数
    this.meshes = {};
    const cap = {};
    for (const p of this.men) cap[p.k] = (cap[p.k] || 0) + 1;
    for (const t of Object.keys(cap)) {
      const Bt = B[t];
      for (const k of Object.keys(Bt)) {
        if (k === 'mat') continue;
        const im = new THREE.InstancedMesh(Bt[k], Bt.mat, Math.max(1, cap[t]));
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = true;
        im.visible = false;
        this.scene.add(im);
        this.meshes[t + k] = im;
      }
    }
    // 步枪曳光（细长发光条，8 枚池）
    const tg = new THREE.BoxGeometry(0.025, 0.025, 0.7);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(tg, tm); m.visible = false; this.scene.add(m);
      this._tracers.push({ m, v: new THREE.Vector3(), t: 0, life: 0 });
    }
    // RPG 火箭弹（弹体 + 尾焰）
    const rg = new THREE.CylinderGeometry(0.03, 0.03, 0.28, 6).rotateX(PI / 2);
    const rm = new THREE.MeshStandardMaterial({ color: 0x3d4033, roughness: 0.7 });
    const fg = new THREE.SphereGeometry(0.07, 6, 4);
    const fm = new THREE.MeshBasicMaterial({ color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(rg, rm));
      const fl = new THREE.Mesh(fg, fm); fl.position.z = -0.17; g.add(fl);
      g.visible = false; this.scene.add(g);
      this._rpgs.push({ g, v: new THREE.Vector3(), t: 0, smk: 0 });
    }
    this.ready = true;
  }

  reset() {
    for (const p of this.men) {
      p.x = p.home.x; p.z = p.home.z; p.ry = p.home.ry;
      p.alive = true; p.st = 'idle'; p.t = 0; p.cd = rnd(3, 7); p.flee = 0; p.walk = false; p.burst = 0;
    }
    for (const r of this._rpgs) r.g.visible = false;
    for (const t of this._tracers) t.m.visible = false;
    this.kills = 0;
  }

  aliveCount() { return this.men.filter(p => p.alive).length; }

  // 机炮弹命中检测（65-weapons 逐弹调用）：命中即倒地
  bulletHit(pos) {
    if (!this.active) return false;
    if (pos.y > INF_H + 0.15) return false;
    for (const p of this.men) {
      if (!p.alive) continue;
      const dx = pos.x - p.x, dz = pos.z - p.z;
      if (dx * dx + dz * dz < 0.42 * 0.42) { this._kill(p, pos); return true; }
    }
    return false;
  }

  // 爆炸：半径内倒地，2 倍半径内奔逃
  blast(x, y, z, tier) {
    if (!this.active || y > 6) return;
    const R = tier >= 3 ? 5 : tier <= 1 ? 1.6 : 3.5;
    for (const p of this.men) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < R) this._kill(p, null);
      else if (d < R * 2.2) {
        p.st = 'flee'; p.flee = rnd(2.5, 4);
        const k = 1 / (d || 1);
        p.fx = (p.x - x) * k; p.fz = (p.z - z) * k;
      }
    }
  }

  _kill(p, pos) {
    p.alive = false; p.st = 'dead'; p.t = 0;
    if (this.fx) {
      this.fx._puff(p.x, 0.15, p.z, { color: 0x9a8f7c, s0: 0.15, s1: 0.6, life: 0.5, base: 0.4, rise: 0.2 });
    }
    this.kills++;
    if (this.onKill) this.onKill(INF_LABEL[p.k] || '步兵');
  }

  // 每帧：env = { dt, heli: Vector3, alt, can: 是否允许出现, fire: 是否允许开火, rate, dmg }
  update(env) {
    const want = !!(this.ready && env.can && this.allow);
    if (want !== this.active) {
      this.active = want;
      for (const k in this.meshes) this.meshes[k].visible = want;
      if (!want) { for (const r of this._rpgs) r.g.visible = false; for (const t of this._tracers) t.m.visible = false; }
    }
    if (!this.active) return;
    const dt = env.dt, H = env.heli;
    const R = this.range;
    for (const p of this.men) {
      p.t += dt;
      if (!p.alive) continue;
      if (p.shotT > 0) p.shotT -= dt;
      const dx = H.x - p.x, dz = H.z - p.z, dist = Math.hypot(dx, dz);
      const threat = env.fire && env.alt > 1.5 && dist < 42;
      if (p.st === 'flee') {
        p.flee -= dt;
        p.x += p.fx * 2.2 * dt; p.z += p.fz * 2.2 * dt;
        p.ry = Math.atan2(p.fx, p.fz);
        if (p.flee <= 0) p.st = threat ? 'aim' : 'idle';
        continue;
      }
      if (threat) {
        p.st = p.rpg ? 'kneel' : 'aim';
        // 转身朝向直升机（平滑）
        const want = Math.atan2(dx, dz);
        let dd = want - p.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        p.ry += dd * Math.min(1, dt * 3);
        p.cd -= dt * (env.rate || 1);
        if (p.cd <= 0) {
          if (p.rpg) { this._fireRpg(p, H, env); p.cd = rnd(9, 14); p.shotT = 0.7; }
          else if (p.k === 'm') {
            // 机枪手：3 发连射（间隔 0.12s），打完一串停 2.4–3.6s
            this._fireRifle(p, H, env, dist); p.shotT = 0.3;
            if (p.burst <= 0) p.burst = 3;
            p.burst--; p.cd = p.burst > 0 ? 0.12 : rnd(2.4, 3.6);
          } else { this._fireRifle(p, H, env, dist); p.shotT = p.k === 'o' ? 0.9 : 0.3; p.cd = p.k === 'o' ? rnd(2.6, 4) : rnd(1.6, 3.2); }
        }
      } else {
        p.st = 'idle';
        p.walk = false;
        let face = p.home.ry;
        if (p.patrol) {
          // 岗线端点：home ± 0.9u（垂直于站岗朝向）。走到端点 → 停 2–3 秒朝外警戒 → 折返
          const px = Math.cos(p.home.ry), pz = -Math.sin(p.home.ry), side = p.pk ? 0.9 : -0.9;
          const tx = p.home.x + px * side, tz = p.home.z + pz * side;
          const ex = tx - p.x, ez = tz - p.z, ed = Math.hypot(ex, ez);
          if (ed > 0.04) {
            const v = Math.min(ed, 0.55 * dt);       // 0.55u/s ≈ 1.2m/s 步行
            p.x += ex / ed * v; p.z += ez / ed * v;
            face = Math.atan2(ex, ez);
            p.walk = true;
          } else if ((p.pw -= dt) <= 0) { p.pk ^= 1; p.pw = rnd(2, 3); }
        }
        let dd = face - p.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        p.ry += dd * Math.min(1, dt * (p.walk ? 4 : 1.5));
      }
    }
    this._updateProjectiles(dt, H, env);
    this._draw();
    void R;
  }

  _fireRifle(p, H, env, dist) {
    // 一次点射 = 1 枚可见曳光；命中概率随距离降低（近 0.3 → 远 0.08）
    const tr = this._tracers.find(t => !t.m.visible);
    const hitP = Math.max(0.08, 0.3 - dist * 0.006);
    const hit = rnd() < hitP;
    const sx = p.x, sy = INF_H * 0.8, sz = p.z;
    _ifV.set(H.x + (hit ? 0 : (rnd() - 0.5) * 3), H.y + (hit ? 0 : (rnd() - 0.3) * 2.5), H.z + (hit ? 0 : (rnd() - 0.5) * 3));
    if (tr) {
      tr.m.position.set(sx, sy, sz);
      tr.v.copy(_ifV).sub(tr.m.position);
      const L = tr.v.length();
      tr.v.multiplyScalar(60 / (L || 1));
      tr.life = L / 60; tr.t = 0;
      tr.m.lookAt(_ifV);
      tr.m.visible = true;
    }
    if (this.fx) this.fx._puff(sx, sy, sz, { color: 0xffd28a, s0: 0.05, s1: 0.18, life: 0.08, base: 0.9, add: true });
    if (hit) this._damage(0.25 * (env.dmg || 1), sx, sy, sz, H);
  }

  _fireRpg(p, H, env) {
    const r = this._rpgs.find(q => !q.g.visible);
    if (!r) return;
    const sx = p.x, sy = INF_H * 0.75, sz = p.z;
    r.g.position.set(sx, sy, sz);
    // 瞄直升机当前位置（不提前量）：直升机一直在动就能躲开
    r.v.set(H.x - sx, H.y - sy, H.z - sz).normalize().multiplyScalar(24);
    r.t = 0; r.smk = 0; r.dmg = 1.6 * (env.dmg || 1); r.from = { x: sx, y: sy, z: sz };
    _ifV.copy(r.g.position).add(r.v);
    r.g.lookAt(_ifV);
    r.g.visible = true;
    if (this.fx) {
      this.fx._puff(sx, sy, sz, { color: 0xd8cfc0, s0: 0.3, s1: 1.4, life: 0.9, base: 0.45, rise: 0.3 });   // 后喷烟
      if (this.fx.onSfx) this.fx.onSfx('rocket', 1, { x: sx, y: sy, z: sz });   // sfx3：敌方火箭弹从远处传来
    }
    if (!this._rpgWarned && this.onToast) { this._rpgWarned = true; this.onToast('⚠ 火箭弹来袭！保持机动，别悬停'); }
  }

  _updateProjectiles(dt, H, env) {
    for (const t of this._tracers) {
      if (!t.m.visible) continue;
      t.t += dt;
      t.m.position.addScaledVector(t.v, dt);
      if (t.t >= t.life) t.m.visible = false;
    }
    for (const r of this._rpgs) {
      if (!r.g.visible) continue;
      r.t += dt;
      r.g.position.addScaledVector(r.v, dt);
      r.smk -= dt;
      if (r.smk <= 0 && this.fx) {
        r.smk = 0.05;
        this.fx._puff(r.g.position.x, r.g.position.y, r.g.position.z, { color: 0xcfc6b8, s0: 0.12, s1: 0.6, life: 0.8, base: 0.4, rise: 0.15 });
      }
      const d = r.g.position.distanceTo(H);
      if (d < 1.3) {
        r.g.visible = false;
        if (this.fx) this.fx.explosion(r.g.position.x, r.g.position.y, r.g.position.z, 1);
        this._damage(r.dmg, r.from.x, r.from.y, r.from.z, H);
      } else if (r.t > 2.6 || r.g.position.y < 0.05) {
        r.g.visible = false;     // 射空：空中自毁（近炸）
        if (this.fx) this.fx.explosion(r.g.position.x, Math.max(0.3, r.g.position.y), r.g.position.z, 1);
      }
    }
  }

  _damage(dmg, fx, fy, fz, H) {
    const R = this.range;
    if (!R) return;
    R._heliDmg += dmg;
    R._threatHitFlash = 3;
    R._lastHitFrom = new THREE.Vector3(fx, fy, fz);
    if (R.onHeliHit) R.onHeliHit(R._heliDmg, H);
  }

  _draw() {
    const cnt = {};
    for (const k in this.meshes) cnt[k] = 0;
    for (const p of this.men) {
      // 帧选择：奔逃 → 跑步 6 帧（0.88s 一个循环）；巡逻走动 → 走路 6 帧（1.29s）；其余站立帧
      let f = 'idle';
      const has = x => !!this.meshes[p.k + x];
      const fc = Math.floor(p.t * 10 + p.ph * 3) % 4;
      if (p.alive && p.st === 'flee') f = 'r' + (Math.floor(p.t / 0.88 * INF_RUN_N + p.ph * 3) % INF_RUN_N);
      else if (p.alive && p.walk) f = 'w' + (Math.floor(p.t / 1.29 * INF_WALK_N + p.ph * 3) % INF_WALK_N);
      else if (p.alive && (p.st === 'aim' || p.st === 'kneel')) {
        // ASSETS6 战斗姿态：机枪手趴射、巡逻步枪兵蹲射（循环）；指挥官平时对讲机、开火时抬手指挥；
        // 其余：开火瞬间播开火循环（后坐抖动），平时举枪瞄准静帧
        const alt = p.k === 'm' || (p.k === 's' && p.patrol);
        if (p.k === 'o') f = p.shotT > 0 && has('f0') ? 'f' + Math.min(3, Math.floor((0.9 - p.shotT) / 0.9 * 4)) : has('c0') ? 'c' + (Math.floor(p.t * 2.5 + p.ph) % 4) : f;
        else if (alt && has('c0')) f = 'c' + fc;
        else if (p.shotT > 0 && has('f0')) f = 'f' + fc;
        else if (has('a')) f = 'a';
      } else if (!p.alive && has('d0')) f = 'd' + Math.min(5, Math.floor(p.t / 0.9 * 6));
      const k = p.k + f;
      const im = this.meshes[k];
      const fallen = !p.alive && f[0] !== 'd';   // 有倒地动作的不再整体放倒
      if (fallen) {
        // 倒地：站立帧仰面放倒（绕 X 轴 -90°，头朝身后）
        _ifE.set(-PI / 2, p.ry, 0, 'YXZ');
        _ifQ.setFromEuler(_ifE);
        _ifV.set(p.x, 0.07, p.z);
      } else {
        _ifQ.setFromAxisAngle(_ifV2.set(0, 1, 0), p.ry);
        _ifV.set(p.x, 0, p.z);
      }
      _ifS.set(1, 1, 1);
      _ifM.compose(_ifV, _ifQ, _ifS);
      im.setMatrixAt(cnt[k]++, _ifM);
    }
    for (const k in this.meshes) {
      const im = this.meshes[k];
      im.count = cnt[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
