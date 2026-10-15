// ============================================================
// 16-town.js — 城镇地图（2026-10-12 玩法批 C：城镇突击）
// ============================================================
// 基地北侧（远离来袭方向）一片小城镇：10 栋可摧毁建筑 + 5 辆伏击车辆。
// 只在任务变体 urban_strike 下出现（70-app loop 每帧派生 setActive），
// 展示/训练/其他变体零变化（targets 数组、布景、命中链全部逐位不变）。
//
//   掩体：建筑是实体——弹丸/导弹进入建筑包围盒即被建筑吃掉（hitBuilding），
//        躲在楼后的车辆拿不到视线：nearestAhead 跳过被遮挡目标（锁定框/
//        机炮半自动瞄准/地狱火锁定一致），敌方 AA 也不会从楼后开火。
//   伏兵：mov.kind='peek' 的车辆藏在楼后小巷，直升机进入 50u 后轮番
//        "倒车出巷→停在街口开火→退回掩体"；掩体楼塌了就藏不住（exposed）。
//   可摧毁：每栋楼有 hp（机炮 0.15 / 火箭 1.5 / 地狱火 4 / 溅射按距衰减）；
//        半毁冒烟变暗，归零后 1.6s 塌方下沉 + 扬尘 + 瓦砾堆，塌方波及
//        周边 2u（楼后伏兵会被砸伤并暴露）。
//
// 拓扑：本文件排在 16-targets 之后，只读取 16-targets / 00-utils 的符号；
// 16-targets 不引用本文件（TargetRange 经 this.town 鸭子类型调用，
// 由 70-app 构造注入）。
// ============================================================

// 城镇中心（基地 BC=05-config BASE_C 再往北 21u；r>48 处 duneFarH 恒为 0——全平地。
// 位于基地 HESCO 北墙（BC+12，正中留门）之外
const TOWN_CENTER = { x: BASE_C.x, z: BASE_C.z + 21 };
// 建筑：[cx, cz, w(沿 x), d(沿 z), h, hp, 名称]（TOWN_CENTER 相对坐标）。
// 主街 |x|<1.6 纵贯、横街 |z|<1.4 横贯；南排挡住横街，北排挡住北巷。
const TOWN_BUILDINGS = [
  [-9.0, -5.0, 5.0, 4.0, 3.2, 5, '民居'],
  [-4.0, -5.5, 3.5, 4.0, 4.6, 6, '商铺楼'],
  [5.0, -5.0, 5.0, 4.5, 3.0, 5, '仓库'],
  [10.5, -5.5, 4.0, 4.0, 5.8, 8, '水塔楼'],
  [-14.5, -5.5, 2.5, 3.0, 2.4, 3, '棚屋'],
  [-10.0, 5.0, 4.5, 5.0, 3.4, 5, '民居'],
  [-4.2, 4.5, 4.0, 4.0, 2.8, 4, '民居'],
  [4.5, 5.0, 4.5, 4.0, 4.0, 6, '指挥所'],
  [10.0, 5.5, 4.5, 5.0, 3.0, 5, '车库'],
  [14.5, 5.0, 2.5, 3.0, 2.4, 3, '棚屋'],
];
// 伏兵：[type, hx, hz(藏身点), ox, oz(街口探头点), 掩体楼索引]；ox==null = 静止伏兵
const TOWN_AMBUSH = [
  ['tank', 6.6, 0.2, 0.8, 0.2, 2],       // 仓库后横街 → 主街口
  ['truck', -6.6, -0.3, -0.8, -0.3, 1],  // 商铺楼后横街 → 主街口
  ['tank', 5.0, 9.6, 0.8, 9.6, 7],       // 指挥所后北巷 → 主街
  ['truck', -9.5, 9.8, -0.9, 9.8, 5],    // 民居后北巷 → 主街
  ['tank', 10.5, -1.9, null, null, 3],   // 水塔楼后静止（炸楼或绕飞）
];
// 武器威力 → 建筑伤害（机炮扫楼很慢、火箭中等、地狱火两发塌高楼）
const TOWN_BDMG = { 1: 0.15, 2: 1.5, 3: 4 };
const TOWN_PEEK_R = 50;        // 直升机进入此半径（距城镇中心）伏兵开始轮番探头
const TOWN_COLLAPSE_T = 1.6;   // 塌方时长 s

// 墙面贴图：灰泥底 + 一扇窗（UV 按楼层平铺；材质 color 负责色调）
let _townWallTex = null;
function townWallTex() {
  if (_townWallTex) return _townWallTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 64);
  // 灰泥斑驳（固定种子 rnd，可复现）
  for (let i = 0; i < 70; i++) {
    const g = 225 + ((rnd() * 30) | 0);
    c.fillStyle = `rgb(${g},${g},${g - 6})`;
    c.fillRect((rnd() * 64) | 0, (rnd() * 64) | 0, 2 + ((rnd() * 4) | 0), 2 + ((rnd() * 3) | 0));
  }
  c.fillStyle = '#6d6252'; c.fillRect(20, 16, 24, 28);   // 窗框
  c.fillStyle = '#1d2228'; c.fillRect(23, 19, 18, 22);   // 玻璃（暗）
  c.fillStyle = '#8b7f6c'; c.fillRect(18, 44, 28, 3);    // 窗台
  c.fillStyle = '#d9d2c4'; c.fillRect(0, 61, 64, 3);     // 楼层线
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _townWallTex = t;
  return t;
}

// 盒体 UV 改写：四个侧面按真实尺寸平铺（2.2u 一开间、1.5u 一层），
// 顶/底面压到贴图左上角纯墙色（不出窗）
function townBodyGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry 面序：+x, -x, +y, -y, +z, -z，每面 4 顶点
  const span = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (span[f] === 0) { uv.setXY(i, 0.04, 0.96); continue; }
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(span[f] / 2.2)), uv.getY(i) * Math.max(1, Math.round(h / 1.5)));
    }
  }
  uv.needsUpdate = true;
  g.translate(0, h / 2, 0);
  return g;
}

// 线段 a→b 与 AABB 相交（slab 法）；用于视线遮挡
function townSegBox(ax, ay, az, bx, by, bz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = 1;
  const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az];
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
    let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

class TownDistrict {
  constructor(scene, range) {
    this.scene = scene;
    this.range = range;            // TargetRange（伏兵车辆挂进 range.targets 统一走命中/击毁/计数链）
    this.active = false;
    this.center = new THREE.Vector3(TOWN_CENTER.x, 0, TOWN_CENTER.z);
    this.buildings = [];
    this.ambush = [];              // 伏兵 target 对象（与 range.targets 同构）
    this.onCollapse = null;        // 建筑塌方回调（app 注入：toast/震屏）
    this.group = null;
    this._built = false;
  }

  // 懒构建：首次激活才建几何（非城镇局零开销）
  _build() {
    if (this._built) return;
    this._built = true;
    const C = TOWN_CENTER;
    const g = new THREE.Group();
    g.name = 'town';
    // —— 地面：夯土广场 + 柏油街道（各 1 mesh）——
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(36, 21),
      new THREE.MeshStandardMaterial({ color: 0x8c7d63, roughness: 1, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    yard.rotation.x = -PI / 2;
    yard.position.set(C.x, 0.006, C.z + 2);    // BC+12.5~BC+33.5：南缘停在基地北墙(BC+12)外
    yard.receiveShadow = true;
    g.add(yard);
    const roadGeos = [];
    const road = (x, z, w, l) => {
      const p = new THREE.PlaneGeometry(w, l);
      p.rotateX(-PI / 2);
      p.translate(C.x + x, 0.012, C.z + z);
      roadGeos.push(p);
    };
    road(0, 0.5, 3.2, 23);            // 主街（南北）
    road(0, 0, 35, 2.8);              // 横街（东西）
    road(0, 9.7, 30, 2.2);            // 北巷
    road(0, -9, 3.2, 3);              // 南口：穿过基地北墙门洞
    const roads = new THREE.Mesh(mergeGeos(roadGeos),
      new THREE.MeshStandardMaterial({ color: 0x57524a, roughness: 0.95, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    roads.receiveShadow = true;
    g.add(roads);
    // —— 建筑 ——
    const wall = townWallTex();
    const roofMat = targetMat(0x8a7b66, 0.95, 0.02);
    const tints = [0xc4b496, 0xb8a37f, 0xb09b76, 0xc9bfa9, 0xbba07a];
    TOWN_BUILDINGS.forEach(([x, z, w, d, h, hp, label], i) => {
      const bg = new THREE.Group();
      bg.position.set(C.x + x, 0, C.z + z);
      const mat = new THREE.MeshStandardMaterial({ color: tints[i % tints.length], map: wall,
        roughness: 0.92, metalness: 0 });
      const body = new THREE.Mesh(townBodyGeo(w, h, d), mat);
      body.castShadow = true; body.receiveShadow = true;
      bg.add(body);
      // 屋顶板 + 女儿墙 + 屋顶杂件（水箱/空调箱）合 1 mesh
      const rg = [];
      const rb = (gw, gh, gd, px, py, pz) => { const b = new THREE.BoxGeometry(gw, gh, gd); b.translate(px, py, pz); rg.push(b); };
      rb(w + 0.16, 0.14, d + 0.16, 0, h + 0.07, 0);
      rb(w + 0.16, 0.28, 0.12, 0, h + 0.28, d / 2 + 0.02);
      rb(w + 0.16, 0.28, 0.12, 0, h + 0.28, -d / 2 - 0.02);
      rb(0.12, 0.28, d + 0.16, w / 2 + 0.02, h + 0.28, 0);
      rb(0.12, 0.28, d + 0.16, -w / 2 - 0.02, h + 0.28, 0);
      if (h >= 4) {
        const tk = new THREE.CylinderGeometry(0.45, 0.45, 0.8, 10);
        tk.translate(w * 0.22, h + 0.55, -d * 0.2); rg.push(tk);
      } else {
        rb(0.6, 0.35, 0.5, -w * 0.2, h + 0.31, d * 0.15);
      }
      // 门（南立面）
      rb(0.7, 1.1, 0.06, -w * 0.18, 0.55, -d / 2 - 0.02);
      const roof = new THREE.Mesh(mergeGeos(rg), roofMat);
      roof.castShadow = true; roof.receiveShadow = true;
      bg.add(roof);
      g.add(bg);
      this.buildings.push({
        type: 'building', label: label, idx: i, group: bg, mat, tint: tints[i % tints.length],
        x: C.x + x, z: C.z + z, w, d, h, hp, hp0: hp,
        alive: true, collapsing: 0, rubble: null, _smk: rnd(0.5), _dmgLook: false,
      });
    });
    g.visible = false;
    this.group = g;
    this.scene.add(g);
    // —— 伏兵车辆（复用 16-targets 的程序化模型 + GLB 换壳 + 合批）——
    for (const [type, hx, hz, ox, oz, cover] of TOWN_AMBUSH) {
      const def = TARGET_TYPES[type];
      const { group, hp, radius, label } = def.make();
      group.position.set(C.x + hx, 0, C.z + hz);
      const peek = ox != null;
      // 朝向：探头型车头指向街口（倒车回巷时保持朝外），静止型朝南（来袭方向）
      group.rotation.y = peek ? Math.atan2(ox - hx, oz - hz) : PI;
      group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      group.visible = false;
      this.scene.add(group);
      const mov = peek ? { kind: 'peek', hx: C.x + hx, hz: C.z + hz, ox: C.x + ox, oz: C.z + oz,
        st: 'hide', t: 0, v: 2.4 } : null;
      const t = {
        group, type, hp, hp0: hp, radius, label: '城镇伏兵·' + label, mov,
        pos: group.position.clone(), alive: true, town: true, cover,
        hidden: true, _peekOut: false,
        home: { x: group.position.x, z: group.position.z, ry: group.rotation.y, mov },
      };
      mergeTargetStatics(t);
      this.ambush.push(t);
    }
    this._resetAmbush();
    loadTargetModels(this.scene).then(models => {
      for (const t of this.ambush) if (models[t.type]) applyModelToTarget(t, models[t.type]);
    });
    // 损伤烟：与 range 同款 sprite（range._tgtSmokes 每帧纯派生，激活时挂入）
    this._smokes = this.ambush.map(t => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.range._dmgSmoke.material.map, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; sp.renderOrder = 3;
      this.scene.add(sp);
      return { t, sp, ph: rnd(TAU), y: t.type === 'tank' ? 2.05 : 1.55, s0: t.type === 'tank' ? 3.0 : 2.4 };
    });
  }

  // 开关城镇：伏兵挂入/摘出 range.targets（aliveCount/totalCount/命中/SAM 站点自动跟随）
  setActive(on) {
    on = !!on;
    if (on === this.active) return;
    if (on) this._build();
    this.active = on;
    const R = this.range;
    if (on) {
      for (const t of this.ambush) if (!R.targets.includes(t)) R.targets.push(t);
      if (R._tgtSmokes) for (const s of this._smokes) if (!R._tgtSmokes.includes(s)) R._tgtSmokes.push(s);
      this.reset();
    } else {
      // 原地摘除（rig/fpview 持有的是 range 引用，数组本体保持同一对象）
      for (let i = R.targets.length - 1; i >= 0; i--) if (R.targets[i].town) R.targets.splice(i, 1);
      if (R._tgtSmokes) for (let i = R._tgtSmokes.length - 1; i >= 0; i--) if (R._tgtSmokes[i].t.town) R._tgtSmokes.splice(i, 1);
      for (const t of this.ambush) {
        t.group.visible = false;
        if (t.wreck) { this.scene.remove(t.wreck); disposeObject3D(t.wreck); t.wreck = null; }
        t.burn = 0;
      }
      for (const s of this._smokes || []) s.sp.visible = false;
    }
    if (this.group) this.group.visible = on && R.enabled;
  }

  _resetAmbush() {
    let k = 0;
    for (const t of this.ambush) {
      t.hp = t.hp0; t.alive = true; t._chain = false;
      t.group.position.set(t.home.x, 0, t.home.z);
      t.group.rotation.set(0, t.home.ry, 0);
      t.pos.copy(t.group.position);
      t.hidden = true; t._peekOut = false;
      if (t.mov) {
        // 错峰：各伏兵首次探头间隔 1.7s（同时冲出会扎堆在主街口）
        t.mov.st = 'hide'; t.mov.t = 1.2 + k * 1.7 + rnd(0.8); k++;
      }
    }
  }

  // 全部复位：建筑复原（瓦砾移除）+ 伏兵回藏身点。残骸由 range.reset 统一清理
  reset() {
    if (!this._built) return;
    for (const b of this.buildings) {
      b.hp = b.hp0; b.alive = true; b.collapsing = 0; b._dmgLook = false;
      b.group.visible = true;
      b.group.position.y = 0;
      b.group.rotation.set(0, 0, 0);
      b.mat.color.setHex(b.tint);
      if (b.rubble) { this.scene.remove(b.rubble); disposeObject3D(b.rubble); b.rubble = null; }
    }
    this._resetAmbush();
    for (const t of this.ambush) t.group.visible = this.active && this.range.enabled;
  }

  // 建筑当前遮挡高度（塌方中按进度下沉；已塌 = 0 不遮挡）
  _bh(b) {
    if (!b.alive && !b.collapsing) return 0;
    if (b.collapsing) return b.h * (1 - Math.min(1, b.collapsing / TOWN_COLLAPSE_T) * 0.9);
    return b.h + 0.3;
  }

  // 弹丸命中建筑：点在包围盒内（含女儿墙）→ 建筑吃掉这发并扣血。返回 building 或 null
  hitBuilding(p, power) {
    if (!this.active) return null;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (Math.abs(p.x - b.x) > b.w / 2 + 0.08 || Math.abs(p.z - b.z) > b.d / 2 + 0.08) continue;
      if (p.y > this._bh(b) || p.y < -0.1) continue;
      this.damage(b, TOWN_BDMG[power] || power);
      return b;
    }
    return null;
  }

  // 爆炸溅射波及建筑（skip：已被直接命中的那栋，避免同一发重复计伤）
  splash(x, z, R, power, skip = null) {
    if (!this.active) return;
    for (const b of this.buildings) {
      if (!b.alive || b === skip) continue;
      const dx = Math.max(0, Math.abs(x - b.x) - b.w / 2), dz = Math.max(0, Math.abs(z - b.z) - b.d / 2);
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      this.damage(b, power * 0.6 * (1 - 0.6 * d / R));
    }
  }

  damage(b, n) {
    if (!b.alive) return;
    b.hp -= n;
    if (b.hp <= 1e-9) this._collapse(b);
  }

  _collapse(b) {
    b.alive = false;
    b.collapsing = 1e-4;
    b._dust = 0;
    b._tilt = { x: (rnd() - 0.5) * 0.16, z: (rnd() - 0.5) * 0.16 };
    // 瓦砾堆（楼体从中下沉"砸进"瓦砾）：随机碎块合 1 mesh
    const geos = [];
    const n = 10 + Math.round(b.w * b.d * 0.6);
    for (let i = 0; i < n; i++) {
      const s = 0.25 + rnd() * 0.75;
      const bx = new THREE.BoxGeometry(s * (0.8 + rnd()), s * 0.5, s * (0.8 + rnd()));
      bx.rotateY(rnd(TAU)); bx.rotateX((rnd() - 0.5) * 0.6);
      const rx = (rnd() - 0.5) * (b.w + 0.8), rz = (rnd() - 0.5) * (b.d + 0.8);
      const edge = Math.max(Math.abs(rx) / (b.w / 2 + 0.4), Math.abs(rz) / (b.d / 2 + 0.4));
      bx.translate(b.x + rx, Math.max(0.1, (1 - edge) * Math.min(1.4, b.h * 0.32)) + rnd() * 0.15, b.z + rz);
      geos.push(bx);
    }
    const rubble = new THREE.Mesh(mergeGeos(geos), targetMat(0x8f8270, 0.98, 0.02));
    rubble.castShadow = false; rubble.receiveShadow = true;
    this.scene.add(rubble);
    b.rubble = rubble;
    const fx = window.__rigFx;
    if (fx) fx.explosion(b.x, b.h * 0.5, b.z, 2);
    // 塌方波及：楼周 2u 内车辆被砸（楼后伏兵受伤并暴露）。走 range.splash——
    // 计连锁、不计命中率
    this.range.splash(b.x, b.z, Math.max(b.w, b.d) / 2 + 2, 1.2, null, true);
    for (const t of this.ambush) {
      if (t.cover === b.idx && t.alive && t.mov && t.mov.st !== 'exposed') t.mov.st = 'exposed';
    }
    if (this.onCollapse) this.onCollapse(b);
  }

  // 视线遮挡：a→b 线段是否穿过任一未塌建筑
  occluded(ax, ay, az, bx, by, bz) {
    if (!this.active) return false;
    for (const b of this.buildings) {
      const h = this._bh(b);
      if (h <= 0) continue;
      if (townSegBox(ax, ay, az, bx, by, bz, b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, h, b.z + b.d / 2)) return true;
    }
    return false;
  }

  // 每帧：伏兵状态机 + 视线派生 + 建筑塌方/冒烟动画
  update(dt, heliPos) {
    if (!this.active) return;
    const R = this.range;
    if (this.group) this.group.visible = R.enabled;
    if (!R.enabled) return;
    const near = heliPos && heliPos.y > 2 &&
      Math.hypot(heliPos.x - this.center.x, heliPos.z - this.center.z) < TOWN_PEEK_R;
    for (const t of this.ambush) {
      if (!t.alive) { t._peekOut = false; continue; }
      const mv = t.mov;
      if (mv) this._peek(t, mv, dt, near);
      t.pos.copy(t.group.position);
      t.hidden = heliPos ? this.occluded(heliPos.x, heliPos.y, heliPos.z, t.pos.x, 0.9, t.pos.z) : true;
    }
    const fx = window.__rigFx;
    let free = -1;
    const freePuffs = () => (free >= 0 ? free : (free = fx ? fx.puffs.reduce((k, q) => k + (q.m.visible ? 0 : 1), 0) : 0));
    for (const b of this.buildings) {
      if (b.collapsing) {
        b.collapsing += dt;
        const k = Math.min(1, b.collapsing / TOWN_COLLAPSE_T);
        const e = k * k * (3 - 2 * k);
        b.group.position.y = -b.h * 0.92 * e;
        b.group.rotation.x = b._tilt.x * e;
        b.group.rotation.z = b._tilt.z * e;
        if (fx && (b._dust -= dt) <= 0 && freePuffs() >= 16) {
          b._dust = 0.12; free--;
          const a = rnd(TAU), rr = Math.max(b.w, b.d) * 0.5;
          fx._puff(b.x + Math.cos(a) * rr, 0.3, b.z + Math.sin(a) * rr,
            { color: 0xbcae92, s0: 0.6, s1: 3.2, life: 1.8, base: 0.5, rise: 0.6 });
        }
        if (k >= 1) { b.collapsing = 0; b.group.visible = false; }
        continue;
      }
      if (!b.alive) continue;
      // 半毁：墙面变暗 + 屋顶冒黑烟
      if (b.hp < b.hp0 * 0.5) {
        if (!b._dmgLook) { b._dmgLook = true; b.mat.color.setHex(b.tint).multiplyScalar(0.62); }
        if (fx && (b._smk -= dt) <= 0 && freePuffs() >= 24) {
          b._smk = 0.45; free--;
          fx._puff(b.x + (rnd() - 0.5) * b.w * 0.5, b.h + 0.4, b.z + (rnd() - 0.5) * b.d * 0.5,
            { color: 0x2f2a24, s0: 0.4, s1: 1.8, life: 1.6, base: 0.4, rise: 1.0 });
        }
      }
    }
  }

  // 伏兵：hide(藏)→out(出巷)→stay(街口开火)→back(倒车回巷)；掩体塌了 → exposed 原地
  _peek(t, mv, dt, near) {
    const g = t.group.position;
    if (mv.st === 'exposed') { t._peekOut = true; return; }
    if (mv.st === 'hide') {
      t._peekOut = false;
      if (near && (mv.t -= dt) <= 0) mv.st = 'out';
      return;
    }
    if (mv.st === 'stay') {
      t._peekOut = true;
      if ((mv.t -= dt) <= 0) mv.st = 'back';
      return;
    }
    const out = mv.st === 'out';
    const tx = out ? mv.ox : mv.hx, tz = out ? mv.oz : mv.hz;
    const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
    const step = mv.v * dt;
    if (d <= step) {
      g.x = tx; g.z = tz;
      if (out) {
        mv.st = 'stay'; mv.t = 3.2 + rnd(1.5);
        t._peekOut = true;
        // 探头即开火：AA 冷却压到 ≤0.5s（range.update 的射手选择优先探头车）
        this.range._aaCool = Math.min(this.range._aaCool, 0.5);
      } else {
        mv.st = 'hide'; mv.t = 4 + rnd(3);
        t._peekOut = false;
      }
    } else {
      g.x += dx / d * step; g.z += dz / d * step;
      t._peekOut = out && d < 2.5;
    }
  }
}
