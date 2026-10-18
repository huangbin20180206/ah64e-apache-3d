// ============================================================
// 88-enemyvis.js — 敌方武装直升机渲染薄层（Phase 20-A）
// ============================================================
// 85-samvis 同款纪律：只读 87-enemyair 纯逻辑状态做视觉镜像，零每帧分配
// （scratch/池全构造期建立）。程序化建机（26-airtargets 先例风格）——
// **零新增 mesh 类别**：仅程序化 MeshStandardMaterial（顶点色）/Box/Cylinder/Sphere 几何，
// 静态体 mergeGeos 合并 → 每机 2 mesh（合并体+旋翼盘），2 机 4 draws，
// 且仅任务局 spawn（默认场景 visible=false——基线 tri/draws 逐位不变）。
//
//   接口（65-weapons 对空链 / 46-fpview 锁定框经此桥接）：
//     enabled   —— 任务局且仍有活机（缓存，getter 零分配）
//     nearest(from, dir, coneDeg) —— 锥内最近敌机 {t, d}（t=包装对象，
//                   持久 pos:Vector3 供 65/46 直接用）
//     hitTest(pos, dmg, margin)   —— 转发 87（击落同步启动坠毁动画）
//     update(time) / clearVisual()
//   事件消费：fireEvent（曳光视觉：从敌机沿机头方向飞行的亮橙短段，命中
//   版飞抵后 puff 爆闪）；killEvent 由 70-app 消费计分（88 只做动画）。
// ============================================================

const _evV = new THREE.Vector3();   // 求解 scratch
const _evF = new THREE.Vector3();   // 曳光朝向 scratch（与 _evV 分开——同对象两用会互相覆盖）

// 程序化敌机部件 → 合并几何（2026-10-15 真实化，参照"雌鹿"系列重型武装直升机）
// 真实尺寸 1u≈2.27m：机身长 17.5m≈7.7u、旋翼直径 17.3m≈7.6u（旧版旋翼 4.6u，比阿帕奇
// 6.46u 还小，比例失调）。纵列双座气泡座舱、机背双发、下反短翼挂火箭巢、机头炮塔、
// 尾梁+垂尾+右侧尾桨。顶点色合批：机身 1 mesh + 旋翼 1 mesh（每机 2 draw 不变）。
function _evPartsBody() {
  const k = vcKit();
  const OL = 0x4d5838, TN = 0x86784f, DK = 0x1c201b, GL = 0x22363f, MG = 0x3a4230;
  const HP = Math.PI / 2;
  k.box(0.86, 0.92, 3.30, OL, 0, 0, 0.25);                   // 主机身
  k.box(0.70, 0.30, 2.60, OL, 0, -0.55, 0.35);               // 机腹
  k.cyl(0.26, 0.44, 1.05, 12, OL, 0, -0.08, 2.40, HP, 0, 0); // 机头收尖
  k.sph(0.34, GL, 0, 0.28, 2.25, 0.95, 0.80, 1.55);          // 前座（射手）气泡座舱
  k.sph(0.36, GL, 0, 0.55, 1.45, 0.95, 0.85, 1.45);          // 后座（驾驶）气泡座舱
  k.sph(0.15, DK, 0, -0.42, 2.80);                           // 机头炮塔
  k.box(0.04, 0.04, 0.45, DK, 0, -0.48, 3.02);               // 炮管
  for (const sx of [-0.30, 0.30]) {
    k.cyl(0.22, 0.24, 1.70, 12, MG, sx, 0.62, 0.20, HP, 0, 0);   // 机背双发
    k.cyl(0.18, 0.18, 0.06, 12, DK, sx, 0.62, 1.07, HP, 0, 0);   // 进气口
    k.cyl(0.15, 0.20, 0.35, 10, DK, sx * 1.35, 0.55, -0.75, HP, 0, sx > 0 ? -0.5 : 0.5);   // 排气口
  }
  k.box(0.50, 0.32, 0.90, OL, 0, 0.78, -0.15);               // 主减速器整流罩
  // 短翼（下反 ~11°）+ 4 个挂点火箭巢 + 翼尖导弹挂架
  for (const sx of [-1, 1]) {
    k.box(1.55, 0.09, 0.62, OL, sx * 1.15, -0.02, 0.05, 0, 0, -sx * 0.19);
    for (const r of [0.75, 1.35]) {
      const y = -0.05 - Math.sin(0.19) * r - 0.22;
      k.box(0.06, 0.18, 0.30, DK, sx * r, y + 0.13, 0.05);
      k.cyl(0.13, 0.13, 0.80, 10, MG, sx * r, y, 0.10, HP, 0, 0);
      k.cyl(0.10, 0.10, 0.02, 10, DK, sx * r, y, 0.51, HP, 0, 0);
    }
    k.box(0.10, 0.10, 0.85, DK, sx * 1.95, -0.30, 0.05);
    k.box(0.02, 0.30, 0.60, TN, sx * 0.44, 0.05, 0.6);       // 侧面迷彩块
    k.box(0.02, 0.24, 0.50, TN, sx * 0.44, -0.22, -0.7);
  }
  // 尾梁、垂尾、平尾、尾桨（右侧）
  k.cyl(0.14, 0.30, 3.30, 10, OL, 0, 0.22, -3.00, -HP, 0, 0);
  k.box(0.09, 1.10, 0.72, OL, 0, 0.75, -4.55, -0.32, 0, 0);
  k.box(1.40, 0.05, 0.36, OL, 0, 0.28, -4.15);
  k.box(0.02, 1.25, 0.10, DK, 0.13, 0.95, -4.65);
  k.box(0.02, 0.10, 1.25, DK, 0.13, 0.95, -4.65);
  // 起落架（收放式，放下态示意）
  for (const sx of [-0.46, 0.46]) {
    k.box(0.05, 0.35, 0.05, DK, sx, -0.75, 0.05);
    k.cyl(0.15, 0.15, 0.10, 10, DK, sx, -0.92, 0.05, 0, 0, HP);
  }
  k.cyl(0.11, 0.11, 0.18, 10, DK, 0, -0.85, 2.00, 0, 0, HP);
  return k.build();
}
function _evPartsRotor() {
  const k = vcKit();
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    k.box(0.20, 0.03, 3.65, 0x1a1d1a, Math.sin(a) * 1.95, 0, Math.cos(a) * 1.95, 0, a, 0);
  }
  k.cyl(0.22, 0.22, 0.20, 10, 0x2a2e29, 0, 0, 0);
  return k.build();
}

class EnemyVis {
  constructor(scene, enemyAir, fx) {
    this.scene = scene;
    this.enemyAir = enemyAir;
    this.fx = fx || null;          // WeaponRig（爆炸/烟尘池复用；击落触地爆）
    this._live = 0;                // enabled 缓存（update 刷新——getter 零分配）
    // 共享材质（程序化先例：MeshStandardMaterial 两枚，零新增类别）
    const bodyMat = vcMat(0.70, 0.28);
    const rotorMat = vcMat(0.55, 0.40);
    const bodyGeo = _evPartsBody(), rotorGeo = _evPartsRotor();
    this.units = [];
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(0, 1.0, -0.15);
      g.add(body, rotor);
      g.visible = false;
      g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      scene.add(g);
      this.units.push({ g, rotor, tail: null, spin: i * 1.7 });
    }
    // 2026-10-18：真实 Mi-24 模型换壳（Sketchfab "Mi-24 Hind" by duanesmind，CC BY 4.0，
    // 见 assets/targets/mi24-LICENSE.txt）。加载完成前/失败时保留上面的程序化机体兜底。
    // 机头 = 模型 +Z（与本文件朝向约定一致）；主旋翼 Top_Rotor、尾桨 Tail_Rotor 为独立节点。
    // 2026-10-18 ASSETS2：2 号机换 Mi-8 运输/武装直升机（Sketchfab "Russian Transport Heli" by
    // jeandiz，CC BY 4.0，见 CREDITS.md）——两架敌机外形不同更好认。Mi-8 内部节点带 -90°X 父旋转，
    // 主旋翼 Rotor_Hub 绕自身 Z 转（spinAxis 'z'），尾桨 rotor_q 绕 X 转；机身长 18.2m≈8.0u。
    const shells = [
      { url: 'assets/targets/mi24.glb', body: 'Body_lambert1_0', len: 7.7, rotor: 'Top_Rotor', tail: 'Tail_Rotor', axis: 'y', units: [0] },
      { url: 'assets/targets/mi8.glb', body: 'body', len: 8.0, rotor: 'Rotor_Hub', tail: 'rotor_q', axis: 'z', units: [1] },
    ];
    for (const sh of shells) new THREE.GLTFLoader().load(sh.url, (gltf) => {
      const src = gltf.scene;
      src.updateMatrixWorld(true);
      const bodyNode = src.getObjectByName(sh.body) || src;
      const bb = new THREE.Box3().setFromObject(bodyNode, true);
      const sz = bb.getSize(new THREE.Vector3());
      const k = sh.len / Math.max(sz.z, 1e-3);
      const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
      for (const ui of sh.units) {
        const ud = this.units[ui];
        if (!ud) continue;
        const m = src.clone(true);
        m.scale.setScalar(k);
        m.position.set(-cx * k, -cy * k, -cz * k);    // 机身中心对齐 group 原点（与程序化机体一致）
        m.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        for (const c of ud.g.children) c.visible = false;   // 藏程序化机体+旋翼
        ud.g.add(m);
        ud.rotor = m.getObjectByName(sh.rotor) || ud.rotor;
        ud.tail = m.getObjectByName(sh.tail);
        ud.axis = sh.axis;
      }
    }, undefined, () => {});
    // nearest/hitTest 桥接包装（持久对象——65/46 拿到 t.pos 直接可用）
    this.wraps = [0, 1].map(i => ({
      i, type: 'enemy', label: '敌方武装直升机',
      pos: new THREE.Vector3(), alive: true, hp: 0,
    }));
    // 敌机曳光池（8 条亮橙拉长段，MeshBasic 加色——65 曳光同观感）
    const trGeo = new THREE.BoxGeometry(0.07, 0.07, 1.1);
    const trMat = new THREE.MeshBasicMaterial({ color: 0xffb04e, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95 });
    this.tracers = [];
    for (let k = 0; k < 8; k++) {
      const m = new THREE.Mesh(trGeo, trMat);
      m.visible = false; m.renderOrder = 8;
      scene.add(m);
      this.tracers.push({ m, t: 0, hit: false });
    }
    // 坠毁动画槽 ×2（击落位置起螺旋下坠，触地 fx.explosion）
    this.crashes = [0, 1].map(() => ({ on: false, t: 0, x: 0, y: 0, z: 0, vy: 0, g: null }));
  }

  get enabled() { return this._live > 0; }

  // 锥内最近敌机（65-weapons 软锁/地狱火竞争、46-fpview 锁定框共用）
  nearest(from, dir, coneDeg) {
    if (!this.enabled) return null;
    let best = null, bestD = 1e9;
    for (const u of this.enemyAir.units) {
      if (!u.on || u.phase === 'down') continue;
      _evV.set(u.x, u.y, u.z).sub(from);
      const d = _evV.length();
      _evV.normalize();
      if (_evV.dot(dir) <= Math.cos(coneDeg * DEG)) continue;
      if (d < bestD) { best = u; bestD = d; }
    }
    if (!best) return null;
    const w = this.wraps[best.i];
    w.pos.set(best.x, best.y, best.z);
    w.hp = best.hp; w.alive = true;
    return { t: w, d: bestD };
  }

  // 玩家武器命中入口（曳光/火箭/地狱火转发 87；击落同步启动坠毁动画）
  hitTest(pos, dmg, margin = 0) {
    const u = this.enemyAir.hitTest(pos, dmg, margin);
    if (u && u.phase === 'down') this._startCrash(u);
    return u;
  }
  _startCrash(u) {
    const c = this.crashes[u.i];
    c.on = true; c.t = 0;
    c.x = u.x; c.y = u.y; c.z = u.z;
    c.vy = 0;
    if (c.g) { c.g.visible = true; c.g.position.set(u.x, u.y, u.z); }
    else {
      // 坠毁视觉体：借用该机 mesh 组（detached 驱动，落地后隐藏）
      const ud = this.units[u.i];
      c.g = ud.g;
      c.g.visible = true;
    }
  }

  // 每帧：镜像 87 状态 → mesh 位置/朝向/旋翼转速；曳光推进；坠毁动画
  update(dt) {
    const E = this.enemyAir;
    this._live = 0;
    for (const u of E.units) {
      const ud = this.units[u.i];
      const crashing = this.crashes[u.i].on;
      if (u.on) {
        this._live++;
        ud.g.visible = true;
        ud.g.position.set(u.x, u.y, u.z);
        ud.g.rotation.y = Math.atan2(u.hx, u.hz);
        ud.g.rotation.x = -Math.asin(Math.max(-1, Math.min(1, u.hy)));
        ud.spin += dt * 26;
        if (ud.axis === 'z') ud.rotor.rotation.z = ud.spin; else ud.rotor.rotation.y = ud.spin;
        if (ud.tail) ud.tail.rotation.x = ud.spin * 1.6;
      } else if (!crashing) {
        ud.g.visible = false;
      }
    }
    // fireEvent 消费 → 敌机曳光（沿机头方向飞；命中版更亮更长）
    if (E.fireEvent) {
      const e = E.fireEvent;
      E.fireEvent = null;
      const u = E.units[e.i];
      if (u) {
        for (const tr of this.tracers) {
          if (tr.m.visible) continue;
          tr.m.visible = true;
          tr.t = 0; tr.hit = !!e.hit;
          tr.m.position.set(e.x + u.hx * 1.4, e.y + u.hy * 1.4, e.z + u.hz * 1.4);
          tr.m.scale.set(e.big ? 2.2 : 1, e.big ? 2.2 : 1, e.big ? 3.0 : 1.6);
          _evF.set(u.hx, u.hy, u.hz).normalize();
          tr.m.quaternion.setFromUnitVectors(_evV.set(0, 0, 1), _evF);
          break;
        }
      }
    }
    // 曳光推进（0.45s 飞行；命中版飞抵即 puff 爆闪，脱靶版中途消散）
    for (const tr of this.tracers) {
      if (!tr.m.visible) continue;
      tr.t += dt;
      tr.m.translateZ(46 * dt);
      if (tr.hit && this.fx) {
        this.fx._puff(tr.m.position.x, tr.m.position.y, tr.m.position.z,
          { color: 0xffd28a, s0: 0.15, s1: 0.5, life: 0.18, base: 0.9, add: true });
      }
      if (tr.t >= (tr.hit ? 0.45 : 0.3)) tr.m.visible = false;
    }
    // 坠毁动画：螺旋下坠 + 拖烟，触地 fx 爆炸后隐藏
    for (const c of this.crashes) {
      if (!c.on) continue;
      c.t += dt;
      c.vy -= 9.8 * 0.55 * dt;
      c.g.position.y += c.vy * dt;
      c.g.rotation.z = Math.min(c.g.rotation.z + dt * 2.0, 1.1);
      c.g.rotation.y += dt * 1.6;
      c.g.translateX(dt * 7);
      if (this.fx && rnd() < 0.4) {
        this.fx._puff(c.g.position.x, c.g.position.y + 0.4, c.g.position.z,
          { color: 0x2f2f2f, s0: 0.14, s1: 0.6, life: 0.5, base: 0.5 });
      }
      if (c.g.position.y <= 0.35) {
        c.on = false;
        c.g.visible = false;
        if (this.fx) this.fx.explosion(c.g.position.x, 0.6, c.g.position.z, 2);
      }
    }
  }

  // resetRange 兜底：87.reset 由 72-uibind 调，这里只清视觉（mesh/曳光/动画）
  clearVisual() {
    this._live = 0;
    for (const ud of this.units) ud.g.visible = false;
    for (const tr of this.tracers) tr.m.visible = false;
    for (const c of this.crashes) { c.on = false; }
  }

  state() {
    let tr = 0;
    for (const t of this.tracers) if (t.m.visible) tr++;
    return { live: this._live, tracers: tr,
      crashes: this.crashes.filter(c => c.on).length };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 88 的构造器（拓扑硬规则）。
HOST.makeEnemyVis = (scene, enemyAir, fx) => new EnemyVis(scene, enemyAir, fx);
