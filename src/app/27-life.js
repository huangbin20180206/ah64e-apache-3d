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
    this.reset();
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
