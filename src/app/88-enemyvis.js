// ============================================================
// 88-enemyvis.js — 敌方武装直升机渲染薄层（Phase 20-A）
// ============================================================
// 85-samvis 同款纪律：只读 87-enemyair 纯逻辑状态做视觉镜像，零每帧分配
// （scratch/池全构造期建立）。程序化建机（26-airtargets 先例风格）——
// **零新增 mesh 类别**：仅程序化 MeshStandardMaterial/Box/Cylinder 几何，
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

// 程序化敌机部件 → 合并几何（部件各自 applyMatrix4 定位后 mergeGeos）
function _evPartsBody() {
  const parts = [];
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    parts.push(g);
  };
  const cyl = (rt, rb, h, x, y, z, alongZ) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 10);
    if (alongZ) g.applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    parts.push(g);
  };
  box(0.55, 0.62, 2.6, 0, 0, 0);            // 机身
  cyl(0.30, 0.42, 0.7, 0, -0.06, 1.6, true); // 机头传感器舱
  box(0.50, 0.42, 1.0, 0, 0.26, 0.8);        // 座舱（深色一体成型）
  box(2.6, 0.08, 0.5, 0, 0.02, 0.2);         // 短翼
  cyl(0.11, 0.11, 0.8, 1.15, -0.08, 0.2);    // 火箭巢 ×2（竖轴放置即横置视效）
  cyl(0.11, 0.11, 0.8, -1.15, -0.08, 0.2);
  cyl(0.13, 0.16, 2.2, 0, 0.10, -2.2, true); // 尾梁
  box(0.08, 0.75, 0.55, 0, 0.52, -3.05);      // 垂尾
  box(1.1, 0.05, 0.35, 0, 0.34, -2.95);      // 水平尾翼
  box(0.06, 0.05, 1.6, 0.44, -0.46, 0.1);    // 滑橇 ×2
  box(0.06, 0.05, 1.6, -0.44, -0.46, 0.1);
  box(0.05, 0.34, 0.05, 0.34, -0.28, 0.35); // 滑橇竖杆
  box(0.05, 0.34, 0.05, -0.34, -0.28, 0.35);
  box(0.02, 0.85, 0.06, 0.12, 0.55, -3.05); // 尾桨（静态十字竖片）
  box(0.85, 0.02, 0.06, 0.12, 0.55, -3.05);
  return mergeGeos(parts);
}
function _evPartsRotor() {
  const parts = [];
  const b1 = new THREE.BoxGeometry(0.10, 0.02, 4.6);
  b1.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0));
  const b2 = new THREE.BoxGeometry(4.6, 0.02, 0.10);
  b2.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0));
  parts.push(b1, b2);
  const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.16, 8);
  parts.push(hub);
  return mergeGeos(parts);
}

class EnemyVis {
  constructor(scene, enemyAir, fx) {
    this.scene = scene;
    this.enemyAir = enemyAir;
    this.fx = fx || null;          // WeaponRig（爆炸/烟尘池复用；击落触地爆）
    this._live = 0;                // enabled 缓存（update 刷新——getter 零分配）
    // 共享材质（程序化先例：MeshStandardMaterial 两枚，零新增类别）
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c3328, roughness: 0.72, metalness: 0.28 });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x1a1d1a, roughness: 0.55, metalness: 0.40 });
    const bodyGeo = _evPartsBody(), rotorGeo = _evPartsRotor();
    this.units = [];
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(0, 0.48, 0.1);
      g.add(body, rotor);
      g.visible = false;
      g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      scene.add(g);
      this.units.push({ g, rotor, spin: i * 1.7 });
    }
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
        ud.rotor.rotation.y = ud.spin;
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
