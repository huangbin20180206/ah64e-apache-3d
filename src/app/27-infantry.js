// ============================================================
// 27-infantry.js — 敌方步兵小队（P5-G2，2026-10-16）
// ============================================================
// 用救援同款 CC0 真人士兵模型（assets/targets/survivor.glb）烘焙 6 种静态姿势：
//   aim 举枪对空 / kneel 跪姿扛火箭筒 / runA·runB 奔跑两帧 / idle 持枪站立 / dead 倒地。
// 每种姿势在加载时做一次 CPU 蒙皮（骨骼只在烘焙时用，运行时不再算顶点），
// 步枪/火箭筒按烘焙后手的位置合进同一几何；每种姿势一个 InstancedMesh
// （同姿势所有人一次绘制），全队 16 人最多 6 次绘制。
// 行为（仅游戏关卡、基地靶场启用、非训练/航线时出现）：
//   · 平时持枪站岗；直升机进入 42u 内且离地 → 转身举枪，步枪曳光点射（低伤害）
//   · RPG 兵跪姿瞄准，冷却 9–14 秒发射一枚火箭弹（带尾烟、可看见、可躲），近炸伤害
//   · 附近爆炸 → 幸存者朝远离爆点方向奔跑 2.5–4 秒再恢复射击
//   · 机炮一发命中即倒地；爆炸半径内倒地；击毙计分（arcade 'infantry'）
// 伤害走 16-targets 的既有受损链（_heliDmg / onHeliHit → 受击反馈/损伤系统）。
// 依赖（运行时注入）：range = BaseRange（16-targets），fx = WeaponRig（65-weapons）
// ============================================================

const INF_H = 0.81;                 // 人高（与救援幸存者同比例，1u≈2.2m）
const INF_POSES = ['idle', 'aim', 'kneel', 'runA', 'runB', 'dead'];
const _ifV = new THREE.Vector3(), _ifV2 = new THREE.Vector3(), _ifM = new THREE.Matrix4(),
  _ifQ = new THREE.Quaternion(), _ifS = new THREE.Vector3(), _ifE = new THREE.Euler();

// 烘焙：gltf → { pose: BufferGeometry（含 groups：0 军装 / 1 武器）}
function bakeInfantryPoses(gltf) {
  const m = gltf.scene, B = {};
  m.traverse(o => { if (o.isBone) B[o.name] = o; });
  const need = ['Head', 'headfront', 'LeftHand', 'RightHand', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightShoulder'];
  if (need.some(n => !B[n])) return null;
  let sm = null;
  m.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (!sm) return null;
  const wrap = new THREE.Group();
  wrap.add(m);
  m.updateMatrixWorld(true);
  const wp = n => new THREE.Vector3().setFromMatrixPosition(B[n].matrixWorld);
  const f = wp('headfront').sub(wp('Head'));
  wrap.rotation.y = -Math.atan2(f.x, f.z);                 // 正面朝 +Z
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const sc = INF_H / Math.max(0.1, box.max.y - box.min.y);
  wrap.scale.setScalar(sc);
  wrap.position.y = -box.min.y * sc;
  wrap.updateMatrixWorld(true);
  const wInv = wrap.matrixWorld.clone().invert();
  const loc = n => wp(n).applyMatrix4(wInv);
  const R = Math.sign(loc('RightArm').x) || -1, L = -R;
  const names = Object.keys(B);
  const rest = names.map(n => B[n].quaternion.clone());
  const wq = new THREE.Quaternion(), pq = new THREE.Quaternion(), bq = new THREE.Quaternion(), dq = new THREE.Quaternion();
  const aim = (bn, cn, d) => {
    const bone = B[bn];
    wrap.updateMatrixWorld(true);
    wrap.getWorldQuaternion(wq);
    const cur = wp(cn).sub(wp(bn)).normalize();
    const tgt = new THREE.Vector3(d[0], d[1], d[2]).normalize().applyQuaternion(wq);
    dq.setFromUnitVectors(cur, tgt);
    bone.getWorldQuaternion(bq);
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.copy(pq.invert().multiply(dq.multiply(bq)));
    bone.updateMatrixWorld(true);
  };
  // 姿势表：[骨, 子骨, 方向]（方向在人物本地：+Z 前、+Y 上、R/L=右/左侧）
  const legs = (lu, ll, ru, rl) => [['LeftUpLeg', 'LeftLeg', lu], ['LeftLeg', 'LeftFoot', ll],
    ['RightUpLeg', 'RightLeg', ru], ['RightLeg', 'RightFoot', rl]];
  const arms = (la, lf, ra, rf) => [['LeftArm', 'LeftForeArm', la], ['LeftForeArm', 'LeftHand', lf],
    ['RightArm', 'RightForeArm', ra], ['RightForeArm', 'RightHand', rf]];
  const stand = legs([L * 0.12, -1, 0.02], [L * 0.04, -1, -0.04], [R * 0.12, -1, 0.02], [R * 0.04, -1, -0.04]);
  const POSE = {
    idle: stand.concat(arms([L * 0.25, -0.9, 0.3], [R * 0.55, 0.15, 0.82], [R * 0.25, -0.95, 0.15], [L * 0.35, -0.2, 0.9])),
    aim: legs([L * 0.2, -1, 0.15], [L * 0.05, -1, 0], [R * 0.15, -1, -0.2], [R * 0.05, -1, -0.05])
      .concat(arms([L * 0.05, 0.25, 0.97], [R * 0.12, 0.42, 0.9], [R * 0.45, -0.1, 0.5], [L * 0.45, 0.42, 0.78])),
    kneel: legs([L * 0.15, -0.12, 1], [L * 0.02, -1, 0.05], [R * 0.15, -1, 0.15], [R * 0.02, -0.08, -1])
      .concat(arms([L * 0.15, -0.15, 0.97], [R * 0.25, 0.25, 0.93], [R * 0.55, -0.35, 0.3], [L * 0.2, 0.75, 0.6])),
    runA: legs([L * 0.08, -0.8, 0.6], [L * 0.03, -0.95, -0.3], [R * 0.08, -0.88, -0.45], [R * 0.03, -0.55, -0.83])
      .concat(arms([L * 0.3, -0.75, 0.45], [R * 0.6, 0.25, 0.75], [R * 0.3, -0.85, 0.2], [L * 0.5, 0.1, 0.85])),
    runB: legs([L * 0.08, -0.88, -0.45], [L * 0.03, -0.55, -0.83], [R * 0.08, -0.8, 0.6], [R * 0.03, -0.95, -0.3])
      .concat(arms([L * 0.3, -0.75, 0.45], [R * 0.6, 0.25, 0.75], [R * 0.3, -0.85, 0.2], [L * 0.5, 0.1, 0.85])),
    dead: legs([L * 0.25, -1, 0.05], [L * 0.2, -1, 0], [R * 0.1, -1, 0.25], [R * 0.05, -1, 0.3])
      .concat(arms([L * 0.9, 0.3, 0.1], [L * 0.6, 0.7, 0.2], [R * 0.95, -0.25, 0.1], [R * 0.7, -0.6, 0.2])),
  };
  // 蒙皮所需原始数据
  const sg = sm.geometry, pa = sg.attributes.position, na = sg.attributes.normal,
    ja = sg.attributes.skinIndex, wa = sg.attributes.skinWeight, n = pa.count;
  const sk = sm.skeleton, BM = sk.bones.map(() => new THREE.Matrix4());
  const out = {};
  const gunMat = (len, rad) => new THREE.CylinderGeometry(rad, rad, len, 6).rotateX(PI / 2);
  for (const key of INF_POSES) {
    names.forEach((nm, i) => B[nm].quaternion.copy(rest[i]));
    for (const [b, c, d] of POSE[key]) aim(b, c, d);
    wrap.updateMatrixWorld(true);
    for (const b of sk.bones) b.updateMatrixWorld(true);
    // 合成矩阵 → 人物本地（wrap 父空间 = 世界，wInv 抵消）
    for (let b = 0; b < sk.bones.length; b++) {
      BM[b].multiplyMatrices(wInv, sk.bones[b].matrixWorld).multiply(sk.boneInverses[b]).multiply(sm.bindMatrix);
    }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
      let ox = 0, oy = 0, oz = 0, qx = 0, qy = 0, qz = 0;
      const js = [ja.getX(i), ja.getY(i), ja.getZ(i), ja.getW(i)], ws = [wa.getX(i), wa.getY(i), wa.getZ(i), wa.getW(i)];
      for (let j = 0; j < 4; j++) {
        const w = ws[j];
        if (w === 0) continue;
        const e = BM[js[j]].elements;
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
        qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
        qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
        qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
      }
      const l = Math.hypot(qx, qy, qz) || 1;
      P[i * 3] = ox; P[i * 3 + 1] = oy; P[i * 3 + 2] = oz;
      N[i * 3] = qx / l; N[i * 3 + 1] = qy / l; N[i * 3 + 2] = qz / l;
    }
    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.BufferAttribute(P, 3));
    body.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    const UV = new Float32Array(n * 2), ua = sg.attributes.uv;   // 压缩/交错 UV 统一解成 Float32
    if (ua) for (let i = 0; i < n; i++) { UV[i * 2] = ua.getX(i); UV[i * 2 + 1] = ua.getY(i); }
    body.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    if (sg.index) body.setIndex(new THREE.BufferAttribute(Uint32Array.from(sg.index.array), 1));
    // 落地：最低点贴 y=0（跪姿/奔跑骨盆下沉）
    body.computeBoundingBox();
    body.translate(0, -body.boundingBox.min.y, 0);
    const lift = -body.boundingBox.min.y;
    // 武器：按手的位置摆
    const rh = loc('RightHand'), lh = loc('LeftHand'), sh = loc('RightShoulder');
    rh.y += lift; lh.y += lift; sh.y += lift;
    let weap = null;
    if (key === 'kneel') {
      // 火箭筒：扛在右肩，指向前上方
      const dir = new THREE.Vector3(0, 0.28, 1).normalize();
      weap = gunMat(0.42, 0.028);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      weap.applyQuaternion(q);
      weap.translate(sh.x * 0.85, sh.y + 0.03, sh.z + 0.06);
      const head = new THREE.ConeGeometry(0.045, 0.1, 6).rotateX(PI / 2).applyQuaternion(q);
      const tip = dir.clone().multiplyScalar(0.25);
      head.translate(sh.x * 0.85 + tip.x, sh.y + 0.03 + tip.y, sh.z + 0.06 + tip.z);
      weap = mergeGeos([weap, head]);
    } else if (key !== 'dead') {
      // 步枪：从右手指向左手方向，前伸
      const dir = lh.clone().sub(rh);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize();
      const len = 0.36;
      weap = gunMat(len, 0.014);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      weap.applyQuaternion(q);
      const c = rh.clone().addScaledVector(dir, len * 0.4);
      weap.translate(c.x, c.y, c.z);
    }
    let geo = body;
    const bodyIdx = body.index ? body.index.count : 0;
    if (weap && body.index) {
      // 武器零 UV（纯色材质不用贴图）；合并后按索引区间分两组材质：0 军装 / 1 武器
      const wu = new Float32Array(weap.attributes.position.count * 2);
      weap.setAttribute('uv', new THREE.BufferAttribute(wu, 2));
      const mg = mergeGeos([body, weap]);
      if (mg) { geo = mg; geo.clearGroups(); geo.addGroup(0, bodyIdx, 0); geo.addGroup(bodyIdx, mg.index.count - bodyIdx, 1); }
    }
    if (!geo.groups.length) geo.addGroup(0, geo.index ? geo.index.count : geo.attributes.position.count, 0);
    geo.computeBoundingSphere();
    out[key] = { geo, mat: sm.material };
  }
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
    this._layout();
    new THREE.GLTFLoader().load('assets/targets/survivor.glb', (g) => this._build(g), undefined, () => {});
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
    for (const sq of squads) {
      offs.forEach(([ox, oz], i) => {
        const x = BC.x + sq.c[0] + ox, z = BC.z + sq.c[1] + oz;
        this.men.push({
          home: { x, z, ry: sq.face + (rnd() - 0.5) * 0.6 }, x, z, ry: 0,
          rpg: i === 3, alive: true, st: 'idle', t: 0, cd: rnd(2, 6), flee: 0, fx: 0, fz: 0, ph: rnd(TAU),
        });
      });
    }
    this.reset();
  }

  _build(gltf) {
    let baked = null;
    try { baked = bakeInfantryPoses(gltf); } catch (e) { baked = null; }
    if (!baked) return;
    // 敌军：军装整体压暗偏沙色（与救援的我方飞行员区分）
    const src = baked.idle.mat;
    const body = new THREE.MeshStandardMaterial({ map: src.map || null, color: 0xa8916a, roughness: 0.95, metalness: 0 });
    const gun = new THREE.MeshStandardMaterial({ color: 0x1e1d1b, roughness: 0.6, metalness: 0.4 });
    this.meshes = {};
    for (const k of INF_POSES) {
      const im = new THREE.InstancedMesh(baked[k].geo, [body, gun], this.men.length);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = true;
      im.visible = false;
      this.scene.add(im);
      this.meshes[k] = im;
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
      p.alive = true; p.st = 'idle'; p.t = 0; p.cd = rnd(3, 7); p.flee = 0;
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
    if (this.onKill) this.onKill(p.rpg ? '火箭筒兵' : '步兵');
  }

  // 每帧：env = { dt, heli: Vector3, alt, can: 是否允许出现, fire: 是否允许开火, rate, dmg }
  update(env) {
    const want = !!(this.ready && env.can);
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
          if (p.rpg) { this._fireRpg(p, H, env); p.cd = rnd(9, 14); }
          else { this._fireRifle(p, H, env, dist); p.cd = rnd(1.6, 3.2); }
        }
      } else {
        p.st = 'idle';
        let dd = p.home.ry - p.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        p.ry += dd * Math.min(1, dt * 1.5);
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
      if (this.fx.onSfx) this.fx.onSfx('rocket', 1);
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
    for (const k of INF_POSES) cnt[k] = 0;
    for (const p of this.men) {
      let k = p.st;
      if (k === 'flee') k = (Math.floor(p.t * 7 + p.ph) & 1) ? 'runA' : 'runB';
      const im = this.meshes[k];
      if (k === 'dead') {
        _ifE.set(-PI / 2, p.ry, 0, 'YXZ');
        _ifQ.setFromEuler(_ifE);
        _ifV.set(p.x, 0.06, p.z);
      } else {
        _ifQ.setFromAxisAngle(_ifV2.set(0, 1, 0), p.ry);
        _ifV.set(p.x, 0, p.z);
      }
      _ifS.set(1, 1, 1);
      _ifM.compose(_ifV, _ifQ, _ifS);
      im.setMatrixAt(cnt[k]++, _ifM);
    }
    for (const k of INF_POSES) {
      const im = this.meshes[k];
      im.count = cnt[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
