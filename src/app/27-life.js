// ============================================================
// 27-life.js — 战场活物：城镇平民 + 摩托侦察兵（2026-10-18 ASSETS4）
// ============================================================
// 模型（团结 AI 生成，AIGC，见 CREDITS.md）：
//   assets/targets/civilian.glb   长袍头巾平民（带骨骼 Idle/Walk/Run，用 27-infantry 的 bakeClipPoses 烘成静态帧）
//   assets/targets/moto_scout.glb 越野摩托 + 骑手（整体一个模型，车头 +Z）
// ASSETS5（2026-10-19）：平民 3 种外观（长袍男 civilian / 黑袍女 civilian_woman / 拄拐老人 civilian_old，老人走得慢），
//   城镇 9 人；城镇外环加 3 辆民用车（旧轿车 civ_sedan / 小巴 civ_minibus / 货车 civ_cargo），与摩托反向行驶，
//   直升机低空逼近时加速逃离；机炮 3 发或爆炸 → 起火烧黑，**算误伤**（同平民 −150 分）。
// 平民（只在城镇关 urban_strike 出现）：6 人沿人行道来回散步；直升机低空逼近（<18u 且离地 <12u）、
//   附近爆炸或机炮打到身边 → 朝远离方向奔逃 4–6 秒，再原地蹲守（站立帧）。
//   **误伤扣分**：机炮/爆炸打死平民 → 本局 −150 分 + 提示（arcade.addBonus 负分）。平民不进 targets，
//   不影响通关条件、锁定框、自动瞄准。
// 摩托侦察兵：基地进场土路 2 辆来回疾驰（与步兵同条件出现）+ 城镇环路 1 辆（城镇关）。
//   平时 5u/s（≈40km/h），直升机 35u 内加速到 7.5u/s 并蛇形躲闪；机炮一发或爆炸波及即翻倒冒烟，
//   计分 arcade 'moto'。不开火（侦察兵）。
// ASSETS6（2026-10-19）：城镇牲口——西郊巷子 4 只山羊、2 头骆驼，主街 1 辆驴车（团结 AI 生成，带骨骼 Idle/Walk/Run）。
//   平时低头吃草、隔几秒踱到附近另一处；直升机低空逼近或子弹/爆炸落在身边 → 跑开 3–5 秒，在新地方接着吃草。
//   驴车沿主街慢慢来回（车轮跟着转），受惊时小跑。打死只侧倒（不扣分不加分，纯氛围）。
// 依赖（运行时注入）：fx = WeaponRig（65-weapons）。确定性：只用 rnd()。
// 自动化测试（webdriver）默认不出现（同 27-infantry），截图脚本可置 allow=true。
// ============================================================

const CIV_H = 0.774;                 // 1.70m（与步兵 1.78m=0.81u 同比例）
// 平民外观：c=长袍男 w=黑袍女(1.62m) e=拄拐老人(1.68m，走/跑速度 ×0.7)
const CIV_KINDS = ['c', 'w', 'e'];
const CIV_URL = { c: 'assets/targets/civilian.glb', w: 'assets/targets/civilian_woman.glb', e: 'assets/targets/civilian_old.glb' };
// ASSETS6：平民 Cower（蹲下抱头发抖，c0..c3）+ Death（倒地，d0..d5）；缺动作的模型（老人）回退旧帧
const CIV_EXTRA = [0, 0.25, 0.5, 0.75].map((t, i) => ['c' + i, 'Cower', t]).concat([0, 0.2, 0.4, 0.6, 0.8, 1].map((t, i) => ['d' + i, 'Death', t]));
const CIV_HK = { c: CIV_H, w: CIV_H * 1.62 / 1.70, e: CIV_H * 1.68 / 1.70 };
// 民用车（城镇外环，反向车道）：车长 = 真车长 / 2.27m
const CIV_CARS = { sedan: { url: 'assets/targets/civ_sedan.glb', len: 1.94 }, minibus: { url: 'assets/targets/civ_minibus.glb', len: 2.2 },
  cargo: { url: 'assets/targets/civ_cargo.glb', len: 2.86 } };
// 牲口：模型本身是真实米制 → 统一比例 1/2.27；走/跑速度 u/s；hw=侧倒时抬高（半个身宽）
const ANIMAL_DEF = {
  g: { url: 'assets/targets/goat.glb', walk: 0.3, run: 1.5, hw: 0.07, hit: 0.3 },
  m: { url: 'assets/targets/camel.glb', walk: 0.35, run: 1.3, hw: 0.13, hit: 0.5 },
  d: { url: 'assets/targets/donkey_cart.glb', walk: 0.5, run: 1.2, hw: 0.1, hit: 0.55 },
};
const ANIMAL_K = U2M_INV;
const ANIMAL_IDLE = [0, 0.25, 0.5, 0.75].map((t, i) => ['i' + i, 'Idle', t]);
const MOTO_LEN = 0.95;               // 2.1m
const CIV_PENALTY = 150;
const _lfV = new THREE.Vector3(), _lfV2 = new THREE.Vector3(), _lfM = new THREE.Matrix4(), _lfQ = new THREE.Quaternion(),
  _lfS = new THREE.Vector3(1, 1, 1), _lfE = new THREE.Euler();

class BattleLife {
  constructor(scene) {
    this.scene = scene;
    this.fx = null;
    this.onKill = null;            // (label, key) 击毁摩托（计分）
    this.onCivilian = null;        // () 误伤平民
    this.allow = !(typeof navigator !== 'undefined' && navigator.webdriver);
    this.civs = [];
    this.motos = [];
    this.civMeshes = null;
    this.baseOn = false; this.townOn = false;
    this._layout();
    const L = new THREE.GLTFLoader(), got = {};
    const done = (k, g) => { got[k] = g; if (CIV_KINDS.every(q => q in got)) this._buildCiv(got); };
    for (const k of CIV_KINDS) L.load(CIV_URL[k], (g) => done(k, g), undefined, () => done(k, null));
    L.load('assets/targets/moto_scout.glb', (g) => this._buildMoto(g), undefined, () => {});
    for (const [key, d] of Object.entries(CIV_CARS)) L.load(d.url, (g) => this._buildCar(key, g), undefined, () => {});
    this.animMeshes = {}; this.carts = [];
    for (const [k, d] of Object.entries(ANIMAL_DEF)) L.load(d.url, (g) => this._buildAnimal(k, g), undefined, () => {});
  }

  _layout() {
    const C = TOWN_CENTER, BC = BASE_C;
    // 平民散步线（TOWN_CENTER 相对）：横街两侧、主街两侧、北巷
    const walks = [[-14, 1.85, -3, 1.85], [3, -1.85, 14, -1.85], [-2.0, -8.0, -2.0, -2.3],
      [2.0, 2.3, 2.0, 8.4], [-12, 9.0, -2.2, 9.0], [3, 10.4, 13, 10.4],
      [-13, -1.85, -4, -1.85], [4, 1.85, 13, 1.85], [-2.0, 2.4, -2.0, 8.2]];
    walks.forEach(([ax, az, bx, bz], i) => {
      const s = rnd();
      this.civs.push({
        k: CIV_KINDS[i % 3], a: [C.x + ax, C.z + az], b: [C.x + bx, C.z + bz], s0: s,
        x: 0, z: 0, ry: 0, alive: true, st: 'walk', t: 0, pk: 1, pw: 0, fx: 0, fz: 0, flee: 0, ph: rnd(TAU),
      });
    });
    // 摩托路线：基地进场土路（南门外 → 西远处，来回）2 辆；城镇外环（闭合）1 辆
    const road = [[0, -24], [-4, -27], [-12, -28.5], [-58, -29]].map(([x, z]) => [BC.x + x, BC.z + z]);
    const ring = [[-17, 0], [17, 0], [17, 9.7], [-17, 9.7]].map(([x, z]) => [C.x + x, C.z + z]);
    this.motos.push(this._mkMoto(road, false, 0.0, 0.45, 'base'));
    this.motos.push(this._mkMoto(road, false, 0.55, -0.45, 'base'));
    this.motos.push(this._mkMoto(ring, true, 0.3, 0.6, 'town'));
    // 民用车：同一外环，逆向（dir=-1 → 车道偏移落在另一侧），彼此等距不会追尾
    this.cars = [['sedan', 0.05], ['minibus', 0.4], ['cargo', 0.72]].map(([key, f0]) => {
      const c = this._mkMoto(ring, true, f0, 0.62, 'town');
      c.car = key; c.hp = 3; c.dir0 = -1; c.dir = -1;
      return c;
    });
    // 牲口（TOWN_CENTER 相对）：[种类, x, z, 游荡半径]；驴车 = 主街 z −9 → 7.5 来回
    this.animals = [['g', -24, 0.5, 1.4], ['g', -26, -0.4, 1.4], ['g', -28.5, 0.6, 1.4], ['g', -30, -0.2, 1.4],
      ['m', -20, 12.5, 1.6], ['m', 22, -10.5, 1.6], ['d', 0, -9, 0]].map(([k, x, z, r]) => ({
      k, hx: C.x + x, hz: C.z + z, r, x: 0, z: 0, ry: 0, alive: true, st: 'graze', t: 0, wait: 0, tx: 0, tz: 0,
      flee: 0, fx: 0, fz: 0, ph: rnd(TAU), wheel: 0, dir: 1,
      a: k === 'd' ? [C.x, C.z - 9] : null, b: k === 'd' ? [C.x, C.z + 7.5] : null,
    }));
    this.reset();
  }

  // 牲口：烘焙动作帧（Idle 4 帧吃草循环 + 走/跑），每种一组 InstancedMesh；
  // 驴车另把车厢 + 两个车轮（静态件，原样在模型里）按烘焙同一比例装进一个组，跟着驴走
  _buildAnimal(k, gltf) {
    let B;
    try { B = bakeClipPoses(gltf, -ANIMAL_K, ANIMAL_IDLE); } catch (e) { console.warn('[life] animal bake', e); return; }
    if (!B) return;
    const list = this.animals.filter(a => a.k === k);
    for (const key of Object.keys(B)) {
      if (!B[key] || !B[key].isBufferGeometry) continue;
      const im = new THREE.InstancedMesh(B[key], B.mat, list.length);
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.visible = false;
      this.scene.add(im);
      this.animMeshes[k + key] = im;
    }
    this['_dur' + k] = B.dur;
    if (k !== 'd') return;
    // polish2（2026-10-19 用户指出"驴车不像车、货拖在地上、没轮子"）：原生成模型里车架/车轮
    // 比例和位置都不对（车轮埋在地下、只剩一摞麻袋贴地拖）。改为按驴的实际身高程序化搭一辆
    // 两轮木板车：车板 + 侧栏 + 两个带辐条的木轮（铁箍）+ 两根车辕前伸到驴肩两侧 + 横担；
    // 原模型的麻袋作为货物放在车板上。驴头朝 +z，车在驴身后。
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const hb = new THREE.Box3();
    root.traverse(o => { if (o.isSkinnedMesh) hb.expandByObject(o); });
    const H = Math.max(0.2, (hb.max.y - hb.min.y) * B.sc);       // 驴身高（u）
    const zr = hb.min.z * B.sc, xc = (hb.min.x + hb.max.x) / 2 * B.sc;   // 驴屁股 z、驴身中线 x
    const sack = root.getObjectByName('cart');
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e4c30, roughness: 0.92 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.95 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6, metalness: 0.5 });
    const r = 0.29 * H, W = 0.86 * H, Lb = 1.15 * H, z1 = zr - 0.3 * H, z0 = z1 - Lb, yb = r + 0.04 * H, th = 0.05 * H;
    const zA = (z0 + z1) / 2 - 0.05 * H, xw = W / 2 + 0.07 * H;
    const box = (w, h, d, m) => { const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); q.castShadow = q.receiveShadow = true; return q; };
    for (const a of list) {
      const g = new THREE.Group();
      a.mats = [wood, dark, iron]; a.wheels = [];
      const bed = box(W, th, Lb, wood); bed.position.set(xc, yb, (z0 + z1) / 2); g.add(bed);
      for (const sx of [-1, 1]) {
        const rail = box(0.04 * H, 0.16 * H, Lb, dark); rail.position.set(xc + sx * (W / 2 - 0.02 * H), yb + 0.1 * H, (z0 + z1) / 2); g.add(rail);
        // 车辕：车板前角 → 驴肩侧（驴身外侧一点、肩高约 0.55H）
        const p0 = new THREE.Vector3(xc + sx * 0.3 * H, yb, z1 - 0.15 * H), p1 = new THREE.Vector3(xc + sx * 0.24 * H, 0.52 * H, zr + 0.75 * H);
        const len = p0.distanceTo(p1), sh = box(0.035 * H, 0.035 * H, len, dark);
        sh.position.copy(p0).lerp(p1, 0.5); sh.lookAt(p1); g.add(sh);
      }
      const tail = box(W, 0.16 * H, 0.04 * H, dark); tail.position.set(xc, yb + 0.1 * H, z0 + 0.02 * H); g.add(tail);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * H, 0.03 * H, W + 0.2 * H, 6), iron);
      axle.rotation.z = PI / 2; axle.position.set(xc, r, zA); g.add(axle);
      for (const sx of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(xc + sx * xw, r, zA);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.94, r * 0.07, 6, 18), iron);
        rim.rotation.y = PI / 2; w.add(rim);
        const fel = new THREE.Mesh(new THREE.TorusGeometry(r * 0.84, r * 0.08, 5, 18), wood);
        fel.rotation.y = PI / 2; w.add(fel);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.1 * H, 8), dark);
        hub.rotation.z = PI / 2; w.add(hub);
        for (let i = 0; i < 6; i++) {                       // 6 根辐条：车轮滚动看得出来
          const sp = box(0.025 * H, r * 1.66, 0.03 * H, wood); sp.rotation.x = i * PI / 6; w.add(sp);
        }
        w.traverse(o => { if (o.isMesh) o.castShadow = true; });
        w.userData.q0 = w.quaternion.clone();
        g.add(w); a.wheels.push(w);
      }
      a.wr = r;
      if (sack) {                                           // 货：原模型麻袋，缩放到车板内放上去
        const n = sack.clone(true);
        n.position.set(0, 0, 0); n.quaternion.identity(); n.scale.set(1, 1, 1);
        n.updateMatrixWorld(true);
        const sb = new THREE.Box3().setFromObject(n), ss = sb.getSize(new THREE.Vector3());
        const k = Math.min(W * 0.8 / Math.max(ss.x, 1e-4), Lb * 0.75 / Math.max(ss.z, 1e-4), 0.45 * H / Math.max(ss.y, 1e-4));
        n.scale.setScalar(k);
        const c = sb.getCenter(new THREE.Vector3());
        n.position.set(xc - c.x * k, yb + th / 2 - sb.min.y * k, (z0 + z1) / 2 - c.z * k);
        n.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); a.mats.push(o.material); } });
        g.add(n);
      }
      g.visible = false;
      this.scene.add(g);
      a.g = g;
    }
  }

  _mkMoto(pts, loop, f0, lane, zone) {
    const seg = [];
    let L = 0;
    const n = loop ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      seg.push({ a, b, l, s: L });
      L += l;
    }
    return { seg, L, loop, f0, lane, zone, s: 0, dir: 1, x: 0, z: 0, ry: 0, alive: true, g: null, mats: [],
      wait: 0, dust: 0, ph: rnd(TAU), t: 0, smk: 0, roll: 0 };
  }

  _buildCiv(got) {
    const B = {};
    try { for (const k of CIV_KINDS) if (got[k]) B[k] = bakeClipPoses(got[k], CIV_HK[k], CIV_EXTRA); } catch (e) { console.warn('[life] bake', e); return; }
    if (!B.c) return;
    for (const p of this.civs) if (!B[p.k]) p.k = 'c';     // 缺模型 → 用长袍男外观
    const cap = {};
    for (const p of this.civs) cap[p.k] = (cap[p.k] || 0) + 1;
    this.civMeshes = {};
    for (const t of Object.keys(cap)) for (const k of Object.keys(B[t])) {
      if (k === 'mat') continue;
      const im = new THREE.InstancedMesh(B[t][k], B[t].mat, cap[t]);
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.visible = false;
      this.scene.add(im);
      this.civMeshes[t + k] = im;
    }
  }

  // 民用车壳：等比缩放到车长，车头 +Z，底贴地；材质克隆（烧黑用）
  _buildCar(key, gltf) {
    const src = gltf.scene;
    const box = new THREE.Box3().setFromObject(src, true), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = CIV_CARS[key].len / Math.max(sz.z, 1e-4);
    for (const m of this.cars) {
      if (m.car !== key) continue;
      const inst = src.clone(true);
      inst.scale.setScalar(k);
      inst.position.set(-c.x * k, -box.min.y * k, -c.z * k);
      const g = new THREE.Group();
      g.add(inst);
      m.mats = [];
      g.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        o.material = o.material.clone(); m.mats.push(o.material);
      });
      g.visible = false;
      this.scene.add(g);
      m.g = g;
      m.half = CIV_CARS[key].len / 2;
    }
  }

  _buildMoto(gltf) {
    const src = gltf.scene;
    const box = new THREE.Box3().setFromObject(src), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = MOTO_LEN / Math.max(sz.z, 1e-4);
    for (const m of this.motos) {
      const inst = src.clone(true);
      inst.scale.setScalar(k);
      inst.position.set(-c.x * k, -box.min.y * k, -c.z * k);
      const g = new THREE.Group();
      g.add(inst);
      m.mats = [];
      g.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        o.material = o.material.clone(); m.mats.push(o.material);
      });
      g.visible = false;
      this.scene.add(g);
      m.g = g;
    }
  }

  reset() {
    for (const p of this.civs) {
      p.x = p.a[0] + (p.b[0] - p.a[0]) * p.s0; p.z = p.a[1] + (p.b[1] - p.a[1]) * p.s0;
      p.ry = Math.atan2(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      p.alive = true; p.st = 'walk'; p.t = 0; p.pk = 1; p.pw = 0; p.flee = 0;
    }
    for (const m of this.motos) {
      m.s = m.f0 * m.L; m.dir = 1; m.alive = true; m.wait = 0; m.t = 0; m.roll = 0;
      for (const mt of m.mats) mt.color.setScalar(1);
      if (m.g) m.g.rotation.set(0, 0, 0);
    }
    for (const c of this.cars) {
      c.s = c.f0 * c.L; c.dir = c.dir0; c.alive = true; c.t = 0; c.hp = 3; c.roll = 0;
      for (const mt of c.mats) mt.color.setScalar(1);
    }
    for (const a of this.animals) {
      if (a.k === 'd') { a.x = a.a[0]; a.z = a.a[1]; a.ry = 0; a.dir = 1; }
      else {
        if (a.x0 === undefined) { a.x0 = a.hx; a.z0 = a.hz; }
        a.hx = a.x0; a.hz = a.z0;
        a.x = a.hx + Math.sin(a.ph) * a.r * 0.5; a.z = a.hz + Math.cos(a.ph) * a.r * 0.5; a.ry = a.ph;
      }
      a.alive = true; a.st = a.k === 'd' ? 'walk' : 'graze'; a.t = 0; a.wait = 1 + (a.ph % 3); a.flee = 0; a.wheel = 0;
      if (a.mats) for (const mt of a.mats) mt.color.copy(mt.userData.c0 || (mt.userData.c0 = mt.color.clone()));
    }
    this.civKills = 0; this.motoKills = 0;
  }

  // 机炮弹逐弹检测（65-weapons 经 rig.onInfantryHit 调用）
  bulletHit(pos) {
    if (pos.y > 1.0) return false;
    if (this.townOn) for (const p of this.civs) {
      if (!p.alive) continue;
      const dx = pos.x - p.x, dz = pos.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.36 * 0.36 && pos.y < CIV_H + 0.1) { this._killCiv(p); return true; }
      if (d2 < 3 * 3) this._scare(p, pos.x, pos.z);      // 子弹打在身边 → 吓跑
    }
    for (const m of this.motos) {
      if (!m.alive || !this._motoOn(m)) continue;
      const dx = pos.x - m.x, dz = pos.z - m.z;
      if (dx * dx + dz * dz < 0.5 * 0.5) { this._killMoto(m); return true; }
    }
    if (this.townOn) for (const a of this.animals) {
      if (!a.alive) continue;
      const d = Math.hypot(pos.x - a.x, pos.z - a.z);
      if (d < ANIMAL_DEF[a.k].hit) { this._killAnimal(a); return true; }
      if (d < 3) this._scareAnimal(a, pos.x, pos.z);
    }
    if (this.townOn) for (const c of this.cars) {
      if (!c.alive || !c.g || pos.y > 1.4) continue;
      // 车身近似：沿车头方向的线段（半长 half）+ 半宽 0.45
      const fx = Math.sin(c.ry), fz = Math.cos(c.ry), dx = pos.x - c.x, dz = pos.z - c.z;
      const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
      if (Math.abs(along) < c.half && Math.abs(side) < 0.45) {
        c.fear = 6;
        if (--c.hp <= 0) this._killCar(c);
        return true;
      }
    }
    return false;
  }

  blast(x, y, z, tier) {
    if (y > 6) return;
    const R = tier >= 3 ? 5 : tier <= 1 ? 1.6 : 3.5;
    if (this.townOn) for (const p of this.civs) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < R * 0.8) this._killCiv(p);
      else if (d < R * 2.5) this._scare(p, x, z);
    }
    for (const m of this.motos) {
      if (!m.alive || !this._motoOn(m)) continue;
      if (Math.hypot(m.x - x, m.z - z) < R * 0.9) this._killMoto(m);
    }
    if (this.townOn) for (const a of this.animals) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < R * 0.8) this._killAnimal(a);
      else if (d < R * 3) this._scareAnimal(a, x, z);
    }
    if (this.townOn) for (const c of this.cars) {
      if (!c.alive || !c.g) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < R * 0.9 + 0.4) this._killCar(c);
      else if (d < R * 3) c.fear = 6;
    }
  }

  _motoOn(m) { return m.zone === 'base' ? this.baseOn : this.townOn; }

  _scare(p, sx, sz) {
    const dx = p.x - sx, dz = p.z - sz, d = Math.hypot(dx, dz) || 1;
    p.st = 'flee'; p.flee = rnd(4, 6); p.fx = dx / d; p.fz = dz / d;
  }

  _killCiv(p) {
    p.alive = false; p.st = 'dead'; p.t = 0;
    if (this.fx) this.fx._puff(p.x, 0.15, p.z, { color: 0x9a8f7c, s0: 0.15, s1: 0.6, life: 0.5, base: 0.4, rise: 0.2 });
    this.civKills++;
    if (this.onCivilian) this.onCivilian('平民');
  }

  _scareAnimal(a, sx, sz) {
    if (a.k === 'd') { a.flee = 4; return; }          // 驴车：沿主街小跑 4 秒
    const dx = a.x - sx, dz = a.z - sz, d = Math.hypot(dx, dz) || 1;
    a.st = 'flee'; a.flee = rnd(3, 5); a.fx = dx / d; a.fz = dz / d;
  }

  _killAnimal(a) {
    a.alive = false; a.t = 0;
    if (a.mats) for (const mt of a.mats) mt.color.copy(mt.userData.c0 || (mt.userData.c0 = mt.color.clone())).multiplyScalar(0.55);
    if (this.fx) this.fx._puff(a.x, 0.15, a.z, { color: 0x9a8f7c, s0: 0.15, s1: 0.7, life: 0.5, base: 0.4, rise: 0.2 });
  }

  // 牲口：吃草（Idle 循环）↔ 踱步到游荡圈内另一点；受惊奔跑后以落脚点为新圈心；驴车沿主街来回
  _updateAnimals(dt, H, env, town) {
    for (const k in this.animMeshes) this.animMeshes[k].visible = town;
    for (const a of this.animals) if (a.g) a.g.visible = town;
    if (!town) return;
    for (const a of this.animals) {
      a.t += dt;
      if (!a.alive) continue;
      const D = ANIMAL_DEF[a.k];
      if (Math.hypot(H.x - a.x, H.z - a.z) < 14 && env.alt < 10 && env.alt > 0.5) this._scareAnimal(a, H.x, H.z);
      if (a.k === 'd') {
        const tg = a.dir > 0 ? a.b : a.a, ex = tg[0] - a.x, ez = tg[1] - a.z, ed = Math.hypot(ex, ez);
        if (a.flee > 0) a.flee -= dt;
        if (a.wait > 0) { a.wait -= dt; a.st = 'graze'; }
        else if (ed < 0.05) { a.dir = -a.dir; a.wait = 3; }
        // 外环有车正开过路口 → 驴车在路口外停下等；已经上了路口（横街 ±1.4u）就不停，免得和让路的车互相干等
        else if (Math.abs(a.z - TOWN_CENTER.z) > 1.4 && this._carNear(a)) a.st = 'graze';
        else {
          const v = Math.min(ed, (a.flee > 0 ? D.run : D.walk) * dt);
          a.x += ex / ed * v; a.z += ez / ed * v; a.wheel += v;
          a.st = a.flee > 0 ? 'flee' : 'walk';
          let dd = Math.atan2(ex, ez) - a.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
          a.ry += dd * Math.min(1, dt * 1.5);
        }
        continue;
      }
      if (a.st === 'flee') {
        a.flee -= dt;
        // 拴在出生点 4u 内：跑出圈 → 方向往回拐（不会一路冲进房子或跑出镇子）
        const ox = a.x - a.x0, oz = a.z - a.z0, od = Math.hypot(ox, oz);
        if (od > 4) {
          const bx = -ox / od, bz = -oz / od, k = Math.min(1, dt * 3);
          a.fx += (bx - a.fx) * k; a.fz += (bz - a.fz) * k;
          const l = Math.hypot(a.fx, a.fz) || 1; a.fx /= l; a.fz /= l;
        }
        a.x += a.fx * D.run * dt; a.z += a.fz * D.run * dt;
        if (this.fx && (a.dust = (a.dust || 0) - dt) <= 0) {      // 蹄下扬尘
          a.dust = 0.3;
          const free = this.fx.puffs.reduce((n, q) => n + (q.m.visible ? 0 : 1), 0);
          if (free > 24) this.fx._puff(a.x - a.fx * 0.3, 0.06, a.z - a.fz * 0.3,
            { color: 0xbcae92, s0: 0.12, s1: 0.6, life: 0.7, base: 0.3, rise: 0.15 });
        }
        a.ry = Math.atan2(a.fx, a.fz);
        if (a.flee <= 0) { a.st = 'graze'; a.wait = rnd(3, 6); a.hx = a.x; a.hz = a.z; }
        continue;
      }
      if (a.st === 'graze') {
        if ((a.wait -= dt) <= 0) {
          const ang = rnd(TAU), rr = rnd(0.4, 1) * a.r;
          a.tx = a.hx + Math.sin(ang) * rr; a.tz = a.hz + Math.cos(ang) * rr; a.st = 'walk';
        }
        continue;
      }
      const ex = a.tx - a.x, ez = a.tz - a.z, ed = Math.hypot(ex, ez);
      if (ed < 0.05) { a.st = 'graze'; a.wait = rnd(4, 9); continue; }
      const v = Math.min(ed, D.walk * dt);
      a.x += ex / ed * v; a.z += ez / ed * v;
      let dd = Math.atan2(ex, ez) - a.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      a.ry += dd * Math.min(1, dt * 3);
    }
    this._drawAnimals();
  }

  // 驴车前方 2.4u、左右 1u 内有行驶中的民用车/摩托
  _carNear(a) {
    const hx = Math.sin(a.ry), hz = Math.cos(a.ry);
    for (const c of this.cars.concat(this.motos)) {
      if (!c.alive || !c.g || c.zone !== 'town') continue;
      const dx = c.x - a.x, dz = c.z - a.z, al = dx * hx + dz * hz;
      if (al > 0 && al < 2.4 && Math.abs(dx * hz - dz * hx) < 1.0) return true;
    }
    return false;
  }

  _drawAnimals() {
    const cnt = {};
    for (const k in this.animMeshes) cnt[k] = 0;
    for (const a of this.animals) {
      const dur = this['_dur' + a.k];
      if (!dur) continue;
      let f = 'idle';
      if (a.alive && a.st === 'flee') f = 'r' + (Math.floor(a.t / dur.r * INF_RUN_N + a.ph * 3) % INF_RUN_N);
      else if (a.alive && a.st === 'walk') f = 'w' + (Math.floor(a.t / dur.w * INF_WALK_N + a.ph * 3) % INF_WALK_N);
      else if (a.alive && this.animMeshes[a.k + 'i0']) f = 'i' + (Math.floor(a.t / Math.max(1, dur.i) * 4 + a.ph) % 4);
      const im = this.animMeshes[a.k + f];
      if (!im) continue;
      if (a.alive) { _lfQ.setFromAxisAngle(_lfV2.set(0, 1, 0), a.ry); _lfV.set(a.x, 0, a.z); }
      else { _lfE.set(0, a.ry, Math.min(1, a.t * 2.5) * PI / 2, 'YXZ'); _lfQ.setFromEuler(_lfE); _lfV.set(a.x, ANIMAL_DEF[a.k].hw * Math.min(1, a.t * 2.5), a.z); }
      _lfM.compose(_lfV, _lfQ, _lfS);
      im.setMatrixAt(cnt[a.k + f]++, _lfM);
      if (a.g) {                                         // 驴车车厢：驴倒下时车停在原地不翻
        if (a.alive) { a.g.position.set(a.x, 0, a.z); a.g.rotation.set(0, a.ry, 0); }
        for (const w of a.wheels) w.quaternion.copy(w.userData.q0).premultiply(_lfQ.setFromAxisAngle(_lfV2.set(1, 0, 0), a.wheel / a.wr));
      }
    }
    for (const k in this.animMeshes) {
      const im = this.animMeshes[k];
      im.count = cnt[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }

  _killCar(c) {
    c.alive = false; c.t = 0; c.smk = 0;
    for (const mt of c.mats) mt.color.setScalar(0.22);
    if (this.fx) this.fx.explosion(c.x, 0.5, c.z, 2);
    this.civKills++;
    if (this.onCivilian) this.onCivilian('平民车辆');
  }

  _killMoto(m) {
    m.alive = false; m.t = 0; m.smk = 0;
    for (const mt of m.mats) mt.color.setScalar(0.28);          // 烧黑
    if (this.fx) this.fx.explosion(m.x, 0.35, m.z, 1);
    this.motoKills++;
    if (this.onKill) this.onKill('摩托侦察兵', 'moto');
  }

  // 路线弧长 s → 位置 + 切向
  _at(m, s) {
    let sg = m.seg[m.seg.length - 1];
    for (const q of m.seg) if (s <= q.s + q.l) { sg = q; break; }
    const u = Math.min(1, Math.max(0, (s - sg.s) / sg.l));
    const tx = (sg.b[0] - sg.a[0]) / sg.l, tz = (sg.b[1] - sg.a[1]) / sg.l;
    return { x: sg.a[0] + (sg.b[0] - sg.a[0]) * u, z: sg.a[1] + (sg.b[1] - sg.a[1]) * u, tx, tz };
  }

  // env = { dt, heli: Vector3, alt, base: 基地步兵同条件, town: 城镇关激活 }
  update(env) {
    const base = !!(env.base && this.allow), town = !!(env.town && this.allow);
    this.baseOn = base; this.townOn = town;
    const dt = env.dt, H = env.heli;
    // —— 平民 ——
    if (this.civMeshes) {
      for (const k in this.civMeshes) this.civMeshes[k].visible = town;
      if (town) {
        for (const p of this.civs) {
          p.t += dt;
          if (!p.alive) continue;
          const hd = Math.hypot(H.x - p.x, H.z - p.z);
          if (p.st === 'walk' && hd < 18 && env.alt < 12 && env.alt > 0.5) this._scare(p, H.x, H.z);
          if (p.st === 'flee') {
            p.flee -= dt;
            const sp = p.k === 'e' ? 0.9 : 1.3;
            p.x += p.fx * sp * dt; p.z += p.fz * sp * dt;   // 1.3u/s ≈ 3m/s 奔跑（老人 0.9）
            p.ry = Math.atan2(p.fx, p.fz);
            if (p.flee <= 0) p.st = 'cower';
            continue;
          }
          if (p.st === 'cower') continue;
          // 散步：去往端点 pk（0=a / 1=b），到了停 1–3 秒折返
          const tg = p.pk ? p.b : p.a, ex = tg[0] - p.x, ez = tg[1] - p.z, ed = Math.hypot(ex, ez);
          if (ed > 0.05) {
            const v = Math.min(ed, (p.k === 'e' ? 0.3 : 0.45) * dt);
            p.x += ex / ed * v; p.z += ez / ed * v;
            const want = Math.atan2(ex, ez);
            let dd = want - p.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
            p.ry += dd * Math.min(1, dt * 4);
            p.pw = 0;
          } else if ((p.pw += dt) > 1 + (p.ph % 2)) { p.pk ^= 1; }
        }
        this._drawCivs();
      }
    }
    // —— 摩托 ——
    const fx = this.fx;
    for (const m of this.motos) {
      if (!m.g) continue;
      const on = this._motoOn(m);
      m.g.visible = on;
      if (!on) continue;
      m.t += dt;
      if (!m.alive) {
        // 残骸：侧翻，前 6 秒冒烟
        m.roll += (1.35 - m.roll) * Math.min(1, dt * 6);
        if (fx && m.t < 6 && (m.smk -= dt) <= 0) {
          m.smk = 0.35;
          fx._puff(m.x, 0.3, m.z, { color: 0x2f2a24, s0: 0.2, s1: 1.2, life: 1.4, base: 0.45, rise: 0.8 });
        }
      } else {
        const near = Math.hypot(H.x - m.x, H.z - m.z) < 35 && env.alt > 1;
        const v = near ? 7.5 : 5;
        if (m.wait > 0) m.wait -= dt;
        else {
          m.s += m.dir * v * dt;
          if (m.loop) m.s = ((m.s % m.L) + m.L) % m.L;
          else if (m.s > m.L || m.s < 0) {      // 土路尽头：掉头，停 0.8 秒
            m.s = Math.min(m.L, Math.max(0, m.s)); m.dir = -m.dir; m.wait = 0.8;
          }
        }
        const P = this._at(m, m.s);
        const tx = P.tx * m.dir, tz = P.tz * m.dir;
        // 车道偏移（靠右行）+ 被盯上时蛇形
        const weave = near ? Math.sin(m.t * 2.6 + m.ph) * 0.8 : 0;
        const off = m.lane * m.dir + weave;
        m.x = P.x - tz * off; m.z = P.z + tx * off;
        const want = Math.atan2(tx, tz) + (near ? Math.cos(m.t * 2.6 + m.ph) * 0.35 : 0);
        let dd = want - m.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        m.ry += dd * Math.min(1, dt * 8);
        m.roll = near ? -Math.cos(m.t * 2.6 + m.ph) * 0.22 : m.roll * 0.9;   // 压弯侧倾
        // 尾部扬尘（粒子池富余时）
        if (fx && m.wait <= 0 && (m.dust -= dt) <= 0) {
          m.dust = 0.22;
          const free = fx.puffs.reduce((n, q) => n + (q.m.visible ? 0 : 1), 0);
          if (free > 20) fx._puff(m.x - tx * 0.5, 0.12, m.z - tz * 0.5,
            { color: 0xbcae92, s0: 0.25, s1: 1.1, life: 0.9, base: 0.35, rise: 0.25 });
        }
      }
      m.g.position.set(m.x, 0, m.z);
      m.g.rotation.set(0, m.ry, m.roll, 'YXZ');
    }
    this._updateCars(dt, H, env);
    this._updateAnimals(dt, H, env, town);
  }

  // 民用车：外环匀速 3u/s（≈25km/h）；受惊（直升机低空逼近 / 附近中弹爆炸）→ 6u/s 逃离 6 秒
  _updateCars(dt, H, env) {
    const on = this.townOn, fx = this.fx;
    for (const c of this.cars) {
      if (!c.g) continue;
      c.g.visible = on;
      if (!on) continue;
      c.t += dt;
      if (!c.alive) {
        if (fx && c.t < 10 && (c.smk -= dt) <= 0) {
          c.smk = 0.3;
          fx._puff(c.x, 0.6, c.z, { color: 0x24201c, s0: 0.3, s1: 1.8, life: 1.8, base: 0.5, rise: 1.1 });
        }
        continue;
      }
      if (Math.hypot(H.x - c.x, H.z - c.z) < 20 && env.alt < 14 && env.alt > 0.5) c.fear = Math.max(c.fear || 0, 3);
      c.fear = Math.max(0, (c.fear || 0) - dt);
      let v = c.fear > 0 ? 6 : 3;
      // 让行人：车头前方 1.8u、车道宽内有活着的平民 → 停车等
      const hx = Math.sin(c.ry), hz = Math.cos(c.ry);
      for (const p of this.civs) {
        if (!p.alive) continue;
        const dx = p.x - c.x, dz = p.z - c.z, al = dx * hx + dz * hz;
        if (al > 0 && al < c.half + 1.8 && Math.abs(dx * hz - dz * hx) < 0.7) { v = 0; break; }
      }
      // ASSETS6：也给牲口/驴车让路（驴车车身更宽）
      if (v > 0) for (const a of this.animals) {
        if (!a.alive) continue;
        const dx = a.x - c.x, dz = a.z - c.z, al = dx * hx + dz * hz;
        if (al > 0 && al < c.half + 1.8 && Math.abs(dx * hz - dz * hx) < (a.k === 'd' ? 1.0 : 0.7)) { v = 0; break; }
      }
      c.s = (((c.s + c.dir * v * dt) % c.L) + c.L) % c.L;
      const P = this._at(c, c.s);
      const tx = P.tx * c.dir, tz = P.tz * c.dir;
      c.x = P.x - tz * c.lane * c.dir; c.z = P.z + tx * c.lane * c.dir;
      const want = Math.atan2(tx, tz);
      let dd = want - c.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      c.ry += dd * Math.min(1, dt * 5);
      c.g.position.set(c.x, 0, c.z);
      c.g.rotation.set(0, c.ry, 0);
      if (fx && (c.dust = (c.dust || 0) - dt) <= 0) {
        c.dust = c.fear > 0 ? 0.18 : 0.4;
        const free = fx.puffs.reduce((n, q) => n + (q.m.visible ? 0 : 1), 0);
        if (free > 24) fx._puff(c.x - tx * c.half, 0.12, c.z - tz * c.half,
          { color: 0xbcae92, s0: 0.3, s1: 1.3, life: 0.9, base: 0.3, rise: 0.25 });
      }
    }
  }

  _drawCivs() {
    const cnt = {};
    for (const k in this.civMeshes) cnt[k] = 0;
    for (const p of this.civs) {
      let f = 'idle';
      if (p.alive && p.st === 'flee') f = 'r' + (Math.floor(p.t / 0.88 * INF_RUN_N + p.ph * 3) % INF_RUN_N);
      else if (p.alive && p.st === 'walk' && p.pw === 0) f = 'w' + (Math.floor(p.t / 1.29 * INF_WALK_N + p.ph * 3) % INF_WALK_N);
      else if (p.alive && p.st === 'cower' && this.civMeshes[p.k + 'c0']) f = 'c' + (Math.floor(p.t * 6 + p.ph * 3) % 4);
      else if (!p.alive && this.civMeshes[p.k + 'd0']) f = 'd' + Math.min(5, Math.floor(p.t / 0.9 * 6));
      const im = this.civMeshes[p.k + f];
      if (!p.alive && f[0] !== 'd') { _lfE.set(-PI / 2, p.ry, 0, 'YXZ'); _lfQ.setFromEuler(_lfE); _lfV.set(p.x, 0.07, p.z); }
      else { _lfQ.setFromAxisAngle(_lfV2.set(0, 1, 0), p.ry); _lfV.set(p.x, 0, p.z); }
      _lfM.compose(_lfV, _lfQ, _lfS);
      im.setMatrixAt(cnt[p.k + f]++, _lfM);
    }
    for (const k in this.civMeshes) {
      const im = this.civMeshes[k];
      im.count = cnt[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
