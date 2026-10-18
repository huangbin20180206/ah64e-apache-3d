// ============================================================
// 16-valley.js — 峡谷地图（2026-10-12 玩法批 D：峡谷突防）
// ============================================================
// 出生点南侧一片台地被一条蜿蜒峡谷切开。直升机从峡谷南端谷底出发，沿谷底
// 低空贴地飞到北口，再去打基地。只在任务变体 canyon_run 下出现（70-app loop
// 每帧派生 setActive）。展示/训练/其他变体零变化。
//
//   地形：heightAt(x,z) 是唯一高度源，网格顶点、碰撞、视线、弹丸吸收都用它。
//        台地高 CANYON_H=10u（约 20m），谷底半宽 4~6u，岩壁中段有一道岩架。
//   碰撞：机体中心不能低于地面（落在台地上算着陆）。旋翼盘（半径 3u、比机体
//        高 1.7u）碰到岩壁就退回上一帧位置，扣 0.6 结构伤害，1s 冷却。
//   雷达：两座崖顶雷达站。飞到崖顶以上（y > CANYON_H-1.5）暴露度上升，
//        满格后每 2.4s 挨一发（走 P8 的 _heliDmg 链）。两座都打掉就解除。
//   伏兵：谷底 6 辆车挂进统一的 range.targets。岩壁会挡住视线：被挡住的
//        锁不上、也不开火；峡谷里只有 30u 内看得见你的车会开火。
//   掩体：弹丸打进岩体会被吃掉（返回 CANYON_ROCK，不计命中率、不亮命中标记）。
//
// 拓扑：文件名排在 16-targets 之后，只读 16-targets / 00-utils 的符号。
// FLY（45）由 70-app 当参数传进 collide()，不在这里直接引用。
// ============================================================

const CANYON_H = 10;            // 台地高度 u
const CANYON_RIM = CANYON_H - 1.5;   // 高于此 = 露头（雷达可见）
// 峡谷中线（南端起点 → 北口出口），世界坐标
const CANYON_PATH = [
  [36, -56], [38, -42], [22, -34], [4, -44], [-16, -50],
  [-36, -40], [-38, -26], [-20, -18], [-4, -14], [0, -6],
];
const CANYON_ROTOR_R = 3.0;     // 旋翼盘采样半径
const CANYON_ROTOR_Y = 1.7;     // 旋翼盘离机体原点高度
const CANYON_HOVER = 4.5;       // 峡谷内悬停高度（崖顶以下）
// 谷底伏兵：[类型, 路径进度 0~1, 横向偏移]
const CANYON_UNITS = [
  ['truck', 0.20, 1.6], ['tank', 0.32, -1.8], ['truck', 0.47, 1.2],
  ['tank', 0.60, -1.4], ['truck', 0.74, 1.8], ['tank', 0.86, -1.2],
];
const CANYON_RADARS = [0.36, 0.68];       // 崖顶雷达站的路径进度
const CANYON_RDMG = { 1: 0.34, 2: 1.5, 3: 4 };   // 雷达站受伤（机炮 9 发、火箭 2 发、地狱火 1 发）
const CANYON_ROCK = { type: 'rock', label: '岩壁' };   // 弹丸撞岩的哨兵返回值

// 预计算路径段长与累计弧长
const _cvSeg = [];
let _cvLen = 0;
for (let i = 0; i < CANYON_PATH.length - 1; i++) {
  const [ax, az] = CANYON_PATH[i], [bx, bz] = CANYON_PATH[i + 1];
  const l = Math.hypot(bx - ax, bz - az);
  _cvSeg.push({ ax, az, dx: bx - ax, dz: bz - az, l, s0: _cvLen });
  _cvLen += l;
}

// 到中线的最近距离 + 该点弧长（写入 out，免分配）
const _cvOut = { d: 0, s: 0 };
function canyonNearest(x, z, out = _cvOut) {
  let best = 1e9, bs = 0;
  for (const g of _cvSeg) {
    let u = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.l * g.l);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = g.ax + g.dx * u - x, pz = g.az + g.dz * u - z;
    const d = px * px + pz * pz;
    if (d < best) { best = d; bs = g.s0 + g.l * u; }
  }
  out.d = Math.sqrt(best); out.s = bs;
  return out;
}

// 沿中线取点：进度 f(0~1) → {x,z,dirx,dirz}
function canyonPointAt(f) {
  const s = Math.max(0, Math.min(1, f)) * _cvLen;
  for (const g of _cvSeg) {
    if (s <= g.s0 + g.l || g === _cvSeg[_cvSeg.length - 1]) {
      const u = Math.max(0, Math.min(1, (s - g.s0) / g.l));
      return { x: g.ax + g.dx * u, z: g.az + g.dz * u, dirx: g.dx / g.l, dirz: g.dz / g.l };
    }
  }
  return null;
}

// 台地覆盖范围：z<-11 起坡，到 -16.5 成台地（出生点和基地方向保持平地）
function canyonMask(z) { return smoothstep(-11, -16.5, z); }

// 唯一高度源
function canyonHeight(x, z) {
  const m = canyonMask(z);
  if (m <= 0) return 0;
  const n = canyonNearest(x, z);
  const fw = 5 + 1.0 * Math.sin(n.s * 0.21 + 0.6);          // 谷底半宽 4~6u，沿谷起伏
  // 岩壁分两级：下半壁陡 → 岩架 → 上半壁
  const carve = 0.5 * smoothstep(fw, fw + 2.5, n.d) + 0.5 * smoothstep(fw + 3.2, fw + 6, n.d);
  const top = CANYON_H * (1 + 0.05 * Math.sin(x * 0.19 + 1.1) * Math.sin(z * 0.23));
  return top * carve * m + 0.03 * m;
}

// 岩体分层色（按高度出红褐色岩层，谷底偏沙色，台地顶面浅）
function canyonColor(h, slope, out) {
  const band = 0.5 + 0.5 * Math.sin(h * 2.3) * Math.sin(h * 0.7 + 0.4);
  let r = 0.60 + 0.12 * band, g = 0.38 + 0.08 * band, b = 0.25 + 0.05 * band;
  if (h < 0.6) { r = 0.74; g = 0.62; b = 0.46; }                    // 谷底沙
  const flat = 1 - Math.min(1, slope * 1.6);
  if (h > CANYON_H * 0.9) { r += 0.10 * flat; g += 0.09 * flat; b += 0.07 * flat; }   // 台地顶
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}

class CanyonRun {
  constructor(scene, range) {
    this.scene = scene;
    this.range = range;
    this.active = false;
    this.units = [];
    this.radars = [];
    this.exposure = 0;            // 0~1 雷达暴露度
    this.hitPending = null;       // 雷达锁定命中事件（70-app 单槽消费，同 samwar）
    this.strikes = 0;             // 本局岩壁擦碰次数
    this.onRadarDown = null;      // 雷达站被毁回调（app 注入）
    this.onLock = null;           // 暴露度首次满格回调（app 注入）
    this.needSpawn = false;       // 复位后待把直升机放回峡谷南端
    this.spawn = (() => {
      const [ax, az] = CANYON_PATH[0], [bx, bz] = CANYON_PATH[1];
      return { x: ax, z: az, yaw: Math.atan2(bx - ax, bz - az) };
    })();
    this.mesh = null;
    this._built = false;
    this._lockT = 0;
    this._hitCd = 0;
    this._px = null; this._pz = null;
    this._locked = false;
  }

  heightAt(x, z) { return canyonHeight(x, z); }
  get pathLength() { return _cvLen; }
  pointAt(f) { return canyonPointAt(f); }
  // 是否在峡谷区（台地覆盖范围内）
  inZone(p) { return !!p && canyonMask(p.z) > 0.5 && Math.abs(p.x) < 62; }

  _build() {
    if (this._built) return;
    this._built = true;
    // —— 地形网格：x[-120,120] × z[-120,-8]，1u 一格 ——
    const W = 240, D = 112, SX = 240, SZ = 112;
    const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
    geo.rotateX(-PI / 2);
    geo.translate(0, 0, -8 - D / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = canyonHeight(x, z);
      pos.setY(i, h);
      const sl = Math.hypot(canyonHeight(x + 0.6, z) - h, canyonHeight(x, z + 0.6) - h) / 0.6;
      canyonColor(h, sl, c);
      // 细碎明暗（固定种子）
      // 色值按 sRGB 写的，顶点色走线性空间——转一次（不转整片发白）
      const k = 0.94 + rnd() * 0.1;
      col[i * 3] = Math.pow(c[0] * k, 2.2); col[i * 3 + 1] = Math.pow(c[1] * k, 2.2); col[i * 3 + 2] = Math.pow(c[2] * k, 2.2);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'canyon-terrain';
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.visible = false;
    this.scene.add(mesh);
    this.mesh = mesh;

    // —— 谷底伏兵 ——
    const varN = {};   // 2026-10-18：同类按序号轮换变体壳（同 16-targets）
    for (const [type, f, off] of CANYON_UNITS) {
      const mdl = pickVariant(type, (varN[type] = (varN[type] || 0) + 1) - 1, INSURGENT_VARIANTS);
      const p = canyonPointAt(f);
      const def = TARGET_TYPES[type];
      const { group, hp, radius, label } = def.make();
      const x = p.x - p.dirz * off, z = p.z + p.dirx * off;   // 右侧法向 = (-dirz, dirx)
      group.position.set(x, 0, z);
      group.rotation.y = Math.atan2(-p.dirx, -p.dirz);        // 车头朝峡谷南端（迎着来袭方向）
      group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      group.visible = false;
      this.scene.add(group);
      const t = {
        group, type, mdl, hp, hp0: hp, radius, label: '峡谷伏兵·' + (mdl ? VARIANT_LABEL[mdl] : label), mov: null,
        pos: group.position.clone(), alive: true, canyon: true, hidden: true,
        home: { x, z, ry: group.rotation.y, mov: null },
      };
      mergeTargetStatics(t);
      this.units.push(t);
    }
    loadTargetModels(this.scene).then(models => {
      for (const t of this.units) if (models[targetModelKey(t)]) applyModelToTarget(t, models[targetModelKey(t)]);
    });
    this._smokes = this.units.map(t => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.range._dmgSmoke.material.map, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; sp.renderOrder = 3;
      this.scene.add(sp);
      return { t, sp, ph: rnd(TAU), y: t.type === 'tank' ? 2.05 : 1.55, s0: t.type === 'tank' ? 3.0 : 2.4 };
    });

    // —— 崖顶雷达站 ——
    const baseMat = targetMat(0x5b5f52, 0.85, 0.15);
    const dishMat = targetMat(0xb9bcb2, 0.55, 0.35);
    CANYON_RADARS.forEach((f, i) => {
      const p = canyonPointAt(f);
      // 选法向两侧更平、更高的一边（崖顶台地）
      let best = null;
      for (const side of [1, -1]) {
        const x = p.x - p.dirz * 13 * side, z = p.z + p.dirx * 13 * side;
        const h = canyonHeight(x, z);
        if (!best || h > best.h) best = { x, z, h };
      }
      const g = new THREE.Group();
      g.name = 'canyon-radar-' + i;
      g.position.set(best.x, best.h, best.z);
      const bgs = [];
      const bx = (w, h, d, px, py, pz) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(px, py, pz); bgs.push(b); };
      bx(2.2, 0.9, 1.6, 0, 0.45, 0);       // 方舱
      bx(0.25, 1.6, 0.25, 0, 1.7, 0);      // 桅杆
      bx(0.5, 0.35, 0.5, 0.8, 1.1, 0.4);   // 发电机
      const base = new THREE.Mesh(mergeGeos(bgs), baseMat.clone());
      base.castShadow = true;
      g.add(base);
      const dish = new THREE.Group();
      dish.position.y = 2.5;
      const d1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.12), dishMat);
      d1.position.z = 0.2; d1.castShadow = true;
      dish.add(d1);
      g.add(dish);
      g.visible = false;
      this.scene.add(g);
      this.radars.push({ type: 'radar_site', label: '崖顶雷达站', idx: i, group: g, dish, base,
        x: best.x, y: best.h, z: best.z, w: 2.6, d: 2.0, h: 3.0, hp: 3, hp0: 3, alive: true });
    });
  }

  setActive(on) {
    on = !!on;
    if (on === this.active) return;
    if (on) this._build();
    this.active = on;
    const R = this.range;
    if (on) {
      for (const t of this.units) if (!R.targets.includes(t)) R.targets.push(t);
      if (R._tgtSmokes) for (const s of this._smokes) if (!R._tgtSmokes.includes(s)) R._tgtSmokes.push(s);
      this.reset();
    } else {
      for (let i = R.targets.length - 1; i >= 0; i--) if (R.targets[i].canyon) R.targets.splice(i, 1);
      if (R._tgtSmokes) for (let i = R._tgtSmokes.length - 1; i >= 0; i--) if (R._tgtSmokes[i].t.canyon) R._tgtSmokes.splice(i, 1);
      for (const t of this.units) {
        t.group.visible = false;
        if (t.wreck) { this.scene.remove(t.wreck); disposeObject3D(t.wreck); t.wreck = null; }
        t.burn = 0;
      }
      for (const s of this._smokes || []) s.sp.visible = false;
      for (const r of this.radars) r.group.visible = false;
      this.needSpawn = false;
    }
    if (this.mesh) this.mesh.visible = on;
  }

  reset() {
    if (!this._built) return;
    for (const t of this.units) {
      t.hp = t.hp0; t.alive = true; t._chain = false;
      t.group.position.set(t.home.x, 0, t.home.z);
      t.group.rotation.set(0, t.home.ry, 0);
      t.pos.copy(t.group.position);
      t.hidden = true;
      t.group.visible = this.active && this.range.enabled;
    }
    for (const r of this.radars) {
      r.hp = r.hp0; r.alive = true;
      r.group.visible = this.active;
      r.group.rotation.set(0, 0, 0);
      r.base.material.color.setHex(0x5b5f52);
    }
    this.exposure = 0; this.hitPending = null; this.strikes = 0;
    this._lockT = 0; this._hitCd = 0; this._locked = false;
    this._px = null; this._pz = null;
    this.needSpawn = this.active;
  }

  get radarsAlive() { return this.radars.reduce((n, r) => n + (r.alive ? 1 : 0), 0); }

  // 视线遮挡：a→b 线段是否钻进岩体（0.7u 步进，两端各让 0.6u）
  occluded(ax, ay, az, bx, by, bz) {
    if (!this.active) return false;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1.4) return false;
    const n = Math.ceil(L / 0.7);
    for (let i = 1; i < n; i++) {
      const u = i / n;
      if (u * L < 0.6 || (1 - u) * L < 0.6) continue;
      const x = ax + dx * u, y = ay + dy * u, z = az + dz * u;
      if (canyonMask(z) <= 0) continue;
      if (canyonHeight(x, z) > y + 0.05) return true;
    }
    return false;
  }

  // 弹丸命中：雷达站（包围盒）优先，其次岩体吸收。返回 radar / CANYON_ROCK / null
  hitStruct(p, power) {
    if (!this.active) return null;
    for (const r of this.radars) {
      if (!r.alive) continue;
      if (Math.abs(p.x - r.x) > r.w / 2 + 0.3 || Math.abs(p.z - r.z) > r.d / 2 + 0.3) continue;
      if (p.y < r.y - 0.2 || p.y > r.y + r.h + 0.3) continue;
      this.damageRadar(r, CANYON_RDMG[power] || power);
      return r;
    }
    const h = canyonHeight(p.x, p.z);
    if (h > 0.25 && p.y < h) return CANYON_ROCK;
    return null;
  }

  splash(x, z, R, power) {
    if (!this.active) return;
    for (const r of this.radars) {
      if (!r.alive) continue;
      const d = Math.max(0, Math.hypot(x - r.x, z - r.z) - 1.2);
      if (d > R) continue;
      this.damageRadar(r, power * 0.6 * (1 - 0.6 * d / R));
    }
  }

  damageRadar(r, n) {
    if (!r.alive) return;
    r.hp -= n;
    if (r.hp > 1e-9) return;
    r.alive = false;
    r.base.material.color.setHex(0x2a2824);
    r.group.rotation.z = 0.22;
    const fx = window.__rigFx;
    if (fx) fx.explosion(r.x, r.y + 1.2, r.z, 3);
    if (this.radarsAlive === 0) { this.exposure = 0; this._locked = false; }
    if (this.onRadarDown) this.onRadarDown(r, this.radarsAlive);
  }

  // 机体约束（70-app 每帧在写 root.position 前调用；F = FLY）。
  // 返回 'strike'（旋翼擦壁，已退回/抬升并计伤）或 null
  collide(F, dt) {
    if (!this.active) return null;
    let ev = null;
    if (this._hitCd > 0) this._hitCd -= dt;
    const ringMax = (x, z) => {
      let m = 0;
      for (let k = 0; k < 8; k++) {
        const a = k * PI / 4;
        const h = canyonHeight(x + Math.cos(a) * CANYON_ROTOR_R, z + Math.sin(a) * CANYON_ROTOR_R);
        if (h > m) m = h;
      }
      return m;
    };
    if (F.state !== 'ground') {
      const lim = F.alt + CANYON_ROTOR_Y;
      if (ringMax(F.x, F.z) > lim) {
        ev = 'strike';
        if (this._px != null && ringMax(this._px, this._pz) <= lim) {
          F.x = this._px; F.z = this._pz;         // 横向撞壁：退回上一帧
        } else {
          F.alt = ringMax(F.x, F.z) - CANYON_ROTOR_Y + 0.02;   // 垂直压进岩架：抬升
        }
        if (this._hitCd <= 0) {
          this._hitCd = 1.0;
          this.strikes++;
          this.range._heliDmg += 0.6;
        } else ev = 'scrape';
      }
    }
    const hc = canyonHeight(F.x, F.z);
    if (F.alt < hc) F.alt = hc;                   // 机体不进地面（台地上 = 着陆）
    this._px = F.x; this._pz = F.z;
    return ev;
  }

  // 批 E：第一人称峡谷飞行的地形读数（46-fpview HUD 每 0.15s 调一次；写入 out 免分配）。
  //   agl    离地高度 u（机体原点到脚下地形）
  //   rimGap 距露头线余量 u（正 = 仍在崖顶以下、雷达看不见；负 = 已露头）
  //   ahead  前方 3/6/9u 处旋翼盘最小净空 u（机头方向 + 左右各 3u 采样；负 = 会擦壁）
  //   warn   0 安全 / 1 注意（净空 <1.5u）/ 2 拉起（6u 内净空 <0.4u）
  probe(F, out) {
    out.agl = F.alt - canyonHeight(F.x, F.z);
    out.rimGap = CANYON_RIM - F.alt;
    const fx = Math.sin(F.yaw), fz = Math.cos(F.yaw);
    const top = F.alt + CANYON_ROTOR_Y;
    let minC = 99, near = 99;
    for (const d of [3, 6, 9]) {
      for (const lat of [-CANYON_ROTOR_R, 0, CANYON_ROTOR_R]) {
        const x = F.x + fx * d + fz * lat, z = F.z + fz * d - fx * lat;
        const c = top - canyonHeight(x, z);
        if (c < minC) minC = c;
        if (d <= 6 && c < near) near = c;
      }
    }
    out.ahead = minC;
    out.warn = near < 0.4 ? 2 : minC < 1.5 ? 1 : 0;
    return out;
  }

  // 每帧：伏兵视线 + 雷达旋转 + 暴露度
  update(dt, heliPos) {
    if (!this.active) return;
    const R = this.range;
    if (this.mesh) this.mesh.visible = true;
    for (const t of this.units) {
      if (!t.alive) continue;
      t.group.visible = R.enabled;
      t.hidden = heliPos ? this.occluded(heliPos.x, heliPos.y, heliPos.z, t.pos.x, 0.9, t.pos.z) : true;
    }
    for (const r of this.radars) if (r.alive) r.dish.rotation.y += dt * 1.6;
    if (!heliPos || !R.enabled) return;
    const exposed = this.radarsAlive > 0 && this.inZone(heliPos) && heliPos.y > CANYON_RIM;
    this.exposure = Math.max(0, Math.min(1, this.exposure + (exposed ? 0.4 : -0.3) * dt));
    if (this.exposure >= 1) {
      if (!this._locked) { this._locked = true; this._lockT = 1.2; if (this.onLock) this.onLock(); }
      this._lockT -= dt;
      if (this._lockT <= 0) {
        this._lockT = 2.4;
        // 基础 1.5；难度系数由 70-app 消费时乘（与 SAM 链同源）
        this.hitPending = { dmg: 1.5, x: heliPos.x, y: heliPos.y + 2, z: heliPos.z };
      }
    } else if (this.exposure < 0.6) this._locked = false;
  }
}
