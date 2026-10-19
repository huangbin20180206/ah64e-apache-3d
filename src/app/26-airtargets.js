// ============================================================
// 26-airtargets.js — 空中打击目标（P4）
// 直升机升空后的对空火力演练目标，三类：
//   四轴无人机 ×2 —— 悬停 + 慢漂移，机炮一发击落；
//   热气球 ×1    —— 缓慢漂移，多发击毁：蒙皮起火→泄气下沉→坠地爆炸；
//   靶机 ×1      —— 固定翼盘旋机动，击落后螺旋俯冲坠地。
// 武备逻辑：机炮（M230 炮塔可上仰）与地狱火都会自动竞争锥角内的空中目标，
// 空中目标优先于地面装甲（升空后玩家看到的就是它们；旧版地狱火只锁地面，
// 表现为"按 F 打了看不见的东西"）。火箭仍是无制导对地武器，只做半瞄准，
// 弹道掠过空中目标同样可命中。
// 击落坠毁全程分型动画（翻滚/燃烧泄气/螺旋俯冲），触地分级爆炸。
// ============================================================

// Phase 19 性能审计 A6：nearest() 每次调用复用模块级 scratch（原每次 new，
// 机炮对空连发时 ~10 次/s 短命对象）——单线程同步顺序使用无重入
const _atV = new THREE.Vector3();

// 热气球蒙皮条纹贴图（红黄竖条，球面 UV 沿经线展开）
function makeStripeTex() {
  const { c, x } = canvas2d(128, 64);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? '#c0483c' : '#e0a83c';
    x.fillRect(i * 16, 0, 16, 64);
  }
  return tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

// 批 E（PERF C 项补漏）：空中靶静态件按材质合批。四轴 26 mesh、热气球 15、
// 靶机 GLB 11——每个 mesh 主 pass + 阴影 pass 各一次 draw，三架同屏 ~120 draw。
// 动画/被引用节点打 noMerge 保留（桨毂、球囊 env、火焰 flame），其余复用
// 16-targets 的 mergeTargetStatics（同材质烘焙；属性不齐的桶保底不合）。
function mergeAirStatics(g, keep) {
  for (const k of keep) if (k) k.traverse(o => { o.userData.noMerge = true; });
  return mergeTargetStatics({ group: g });
}

// 四轴桨毂：两片交叉桨叶合成一个 mesh（毂整体旋转，内部相对变换不变）
function mergeHubBlades(hub) {
  const geos = [];
  for (const b of hub.children) { b.updateMatrix(); geos.push(b.geometry.clone().applyMatrix4(b.matrix)); }
  const mg = mergeGeos(geos);
  if (!mg) return;
  const mat = hub.children[0].material;
  while (hub.children.length) hub.remove(hub.children[0]);
  const m = new THREE.Mesh(mg, mat);
  m.castShadow = true;
  hub.add(m);
}

class AirTargets {
  constructor(scene, world = null) {
    this.scene = scene;
    this.world = world;            // 仅沙漠场地启用 duneH 地面高度
    this.enabled = true;
    this.fx = null;              // WeaponRig 引用（爆炸/烟尘复用）
    this.onToast = null;         // 击落提示回调
    this.onKill = null;          // 击杀确认回调（label，进统一计数与信息流）
    this.list = [];
    this.wrecks = [];            // 地面残骸（焦黑圆片+碎块，10s 淡出）
    this._build();
  }

  // ---------- 四轴无人机：机身 + 机臂 + 电机 + 双层桨叶 + 云台相机 + 状态灯 ----------
  _quad(base, phase) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x272d31, roughness: 0.58, metalness: 0.36 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x101416, roughness: 0.72, metalness: 0.22 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x162d34, roughness: 0.18, metalness: 0.42 });
    const led = new THREE.MeshBasicMaterial({ color: 0x42e0b0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.28), dark);
    body.position.y = 0.02; g.add(body);
    // 电池舱和两条碳纤机臂
    addBox(g, new THREE.BoxGeometry(0.20, 0.08, 0.22), carbon, [0, 0.10, -0.02]);
    const arms = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.055), carbon);
      arm.rotation.y = (sx * sz > 0 ? 1 : -1) * PI / 4;
      arm.position.set(0, 0.05, 0); g.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 10), dark);
      motor.position.set(sx * 0.25, 0.10, sz * 0.25); g.add(motor);
      const hub = new THREE.Group(); hub.position.copy(motor.position);
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.009, 0.025), carbon);
      const b2 = b1.clone(); b2.rotation.y = PI / 2;
      hub.add(b1, b2); g.add(hub); arms.push(hub);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), led);
      lamp.position.set(sx * 0.25, 0.04, sz * 0.25); g.add(lamp);
    }
    // 下视云台与镜头玻璃
    const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), dark);
    gimbal.position.set(0, -0.10, 0.10); g.add(gimbal);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glass);
    lens.position.set(0, -0.10, 0.16); g.add(lens);
    // 起落脚
    for (const sx of [-0.12, 0.12]) addBox(g, new THREE.BoxGeometry(0.025, 0.025, 0.28), carbon, [sx, -0.10, 0]);
    g.position.set(...base);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    for (const h of arms) mergeHubBlades(h);
    mergeAirStatics(g, arms);
    this.scene.add(g);
    return { type: 'drone', label: '四轴无人机', g, pos: g.position.clone(),
      base: new THREE.Vector3(...base), phase, hp: 1, hp0: 1, radius: 0.85,
      alive: true, mode: 'hover', vy: 0, t: 0, rotors: arms };
  }

  // ---------- 热气球：分片球囊 + 口部环带 + 吊篮/绳索/燃烧器 ----------
  _balloon(base) {
    const g = new THREE.Group();
    const stripe = new THREE.MeshStandardMaterial({ map: makeStripeTex(), roughness: 0.72, metalness: 0.04 });
    const seam = new THREE.MeshStandardMaterial({ color: 0x4f2925, roughness: 0.8, metalness: 0.10 });
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x765633, roughness: 0.86, metalness: 0.05 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xa47c39, roughness: 0.42, metalness: 0.55 });
    const glass = new THREE.MeshBasicMaterial({ color: 0xffb24d });

    const env = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), stripe);
    env.scale.set(1, 1.12, 1); g.add(env);
    // 球囊上下口与分割环，给球面真实的织物结构尺度
    for (const y of [-1.22, 1.10]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.045, 8, 24), seam);
      r.position.y = y; r.scale.x = 1.25; g.add(r);
    }
    for (const a of [0, PI / 2, PI, PI * 1.5]) {
      const seamLine = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.012, 5, 32), seam);
      seamLine.rotation.x = PI / 2; seamLine.rotation.z = a; seamLine.scale.y = 0.76;
      g.add(seamLine);
    }
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.45, 0.34, 12), seam);
    skirt.position.y = -1.62; g.add(skirt);
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.18, 10), brass);
    burner.position.y = -1.76; g.add(burner);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.28, 10), glass);
    flame.rotation.x = PI; flame.position.y = -1.54; g.add(flame);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.36, 0.52), basketMat);
    basket.position.y = -2.25; g.add(basket);
    // 吊篮四角绳索与横向框架
    const ropeM = new THREE.MeshBasicMaterial({ color: 0x3f3022 });
    for (const [rx, rz] of [[0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.58, 5), ropeM);
      rope.position.set(rx, -1.98, rz); g.add(rope);
    }
    g.position.set(...base);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    mergeAirStatics(g, [env, flame]);
    this.scene.add(g);
    return { type: 'balloon', label: '热气球', g, pos: g.position.clone(),
      base: new THREE.Vector3(...base), phase: rnd(TAU), hp: 3, hp0: 3, radius: 1.9,
      alive: true, mode: 'drift', vy: 0, t: 0, env, envMat: stripe, flame };
  }

  // ---------- 靶机：细长机身 + 尖鼻 + 翼面 + 尾翼 + 进气口/尾喷 ----------
  _plane(center) {
    const g = new THREE.Group();
    const orange = new THREE.MeshStandardMaterial({ color: 0xa64734, roughness: 0.62, metalness: 0.22 });
    const gray = new THREE.MeshStandardMaterial({ color: 0x737d83, roughness: 0.58, metalness: 0.38 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2224, roughness: 0.82, metalness: 0.35 });
    const warning = new THREE.MeshBasicMaterial({ color: 0xffb04e });

    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.65, 12), orange);
    fus.rotation.z = PI / 2; g.add(fus);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 12), gray);
    nose.rotation.z = -PI / 2; nose.position.x = 1.0; g.add(nose);
    // 机身背脊与腹部发动机舱
    addBox(g, new THREE.BoxGeometry(0.62, 0.12, 0.16), gray, [-0.10, 0.15, 0]);
    addBox(g, new THREE.BoxGeometry(0.62, 0.15, 0.22), dark, [-0.22, -0.13, 0]);
    // 后掠主翼 + 翼尖配重
    const wing = new THREE.Mesh(new THREE.BufferGeometry(), orange);
    const v = new Float32Array([0.48,0,0, -0.25,0,0.92, -0.58,0,0.72, -0.14,0,0]);
    wing.geometry.setAttribute('position', new THREE.BufferAttribute(v, 3));
    wing.geometry.computeVertexNormals(); g.add(wing);
    const wing2 = wing.clone(); wing2.scale.z = -1; g.add(wing2);
    // 水平尾翼和垂尾
    addBox(g, new THREE.BoxGeometry(0.42, 0.025, 0.62), orange, [-0.62, 0.06, 0]);
    addBox(g, new THREE.BoxGeometry(0.28, 0.46, 0.035), orange, [-0.64, 0.24, 0]);
    // 进气口、尾喷口、翼下小标记
    addBox(g, new THREE.BoxGeometry(0.16, 0.12, 0.20), dark, [-0.48, -0.08, 0]);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.07, 0.12, 10), dark);
    nozzle.rotation.z = PI / 2; nozzle.position.x = -0.91; g.add(nozzle);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), warning);
    beacon.position.set(0.22, 0.02, 0); g.add(beacon);
    g.position.set(...center);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    return { type: 'plane', label: '靶机', g, pos: g.position.clone(),
      center: new THREE.Vector3(...center), ang: rnd(TAU), hp: 2, hp0: 2, radius: 1.2,
      alive: true, mode: 'cruise', vy: 0, t: 0, r: 20 };
  }

  _build() {
    // 布在直升机前方有效射击扇区；距离收进 16~28u，进入 FPV 后能识别并实际命中
    this.list.push(this._quad([4.5, 7.2, 18], rnd(TAU)));
    this.list.push(this._quad([-5.0, 8.2, 21], rnd(TAU)));
    this.list.push(this._balloon([8.5, 10.5, 25]));
    this.list.push(this._plane([0, 14, 30]));
    // AI 高模替换靶机（GLB 就位前程序化模型兜底；动画/命中链路不变）
    // 2026-10-18 ASSETS2：靶机换"沙赫德-136"巡飞弹真模型（Sketchfab "Shahed 136" by faintastic18，
    // CC BY 4.0，见 CREDITS.md）。原模型机头朝 +Z → 绕 Y 转 +90° 对齐本模块机头 +X；
    // 按翼展外形等比缩到机身长 1.9u（与程序化靶机同量级，便于识别/命中），几何中心归零。
    // 加载失败保留程序化靶机（plane.glb 不再加载）。
    new THREE.GLTFLoader().load('assets/targets/shahed.glb', (gltf) => {
      const p = this.list.find(t => t.type === 'plane');
      if (!p) return;
      while (p.g.children.length) p.g.remove(p.g.children[0]);
      const m = gltf.scene;
      m.traverse(o => { if (o.isMesh) o.castShadow = true; });
      const box = new THREE.Box3().setFromObject(m, true), sz = box.getSize(new THREE.Vector3());
      const k = 1.9 / Math.max(sz.z, 1e-4), c = box.getCenter(new THREE.Vector3());
      m.position.set(-c.x * k, -c.y * k, -c.z * k);
      m.scale.setScalar(k);
      const wrap = new THREE.Group();
      wrap.rotation.y = PI / 2;
      wrap.add(m);
      p.g.add(wrap);
      p.label = '沙赫德-136 无人机';
      mergeAirStatics(p.g, []);
    }, undefined, () => {});
  }

  // 机炮瞄准：锥角内最近的空中目标（返回 {t, d} 或 null）
  nearest(from, dir, coneDeg = 42) {
    let best = null, bestD = 1e9;
    const v = _atV;
    for (const t of this.list) {
      if (!t.alive || t.off) continue;
      v.copy(t.pos).sub(from);
      const d = v.length();
      v.normalize();
      if (v.dot(dir) <= Math.cos(coneDeg * DEG)) continue;
      if (d < bestD) { best = t; bestD = d; }
    }
    return best ? { t: best, d: bestD } : null;
  }

  // 命中检测（球形判定，返回命中的目标或 null；击落转入坠毁状态）
  // margin：额外判定余量。制导武器每帧步进大（地狱火 34u/s ≈ 0.55u/帧），
  // 无人机半径只有 0.85，零余量时高速弹体常常在两帧之间"穿过"目标球。
  hitTest(pos, dmg, margin = 0) {
    for (const t of this.list) {
      if (!t.alive || t.off) continue;
      if (pos.distanceTo(t.pos) > t.radius + margin) continue;
      t.hp -= dmg;
      if (t.hp <= 0) this._kill(t);
      return t;
    }
    return null;
  }

  _kill(t) {
    t.alive = false;
    if (t.type === 'drone') { t.mode = 'fall'; t.vy = 0.5; }
    else if (t.type === 'balloon') { t.mode = 'burn'; t.vy = -0.6; t.t = 0; }
    else { t.mode = 'crash'; t.vy = 0; t.t = 0; }
    if (this.onToast) this.onToast(`已击落：${t.label}`);
    if (this.onKill) this.onKill(t.label, t.type);  // 统一击杀计数+信息流（label+type；P18 计分取 type）
  }

  update(dt, time) {
    // 2026-10-19 游戏线复查：红黄条纹热气球是靶场/训练道具，实战关卡里飘在敌方基地上空不合理。
    // 实战任务（非 train_* 变体）期间隐藏且不可锁定/命中；无人机与沙赫德巡飞弹保留（战场上合理）。
    const M = HOST.S && HOST.S._mission;
    const combat = !!(M && M.variant && !/^train/.test(M.variant));
    for (const t of this.list) {
      const g = t.g;
      if (t.type === 'balloon') {
        t.off = combat && t.alive;
        if (t.off) { g.visible = false; continue; }
        if (t.alive) g.visible = true;
      }
      if (t.alive) {
        // —— 常规机动 ——
        if (t.type === 'drone') {
          g.position.set(
            t.base.x + Math.cos(time * 0.15 + t.phase) * 1.2,
            t.base.y + Math.sin(time * 0.7 + t.phase) * 0.25,
            t.base.z + Math.sin(time * 0.12 + t.phase) * 1.2);
          for (const r of t.rotors) r.rotation.y += dt * 42;
        } else if (t.type === 'balloon') {
          g.position.set(
            t.base.x + Math.sin(time * 0.02) * 3,
            t.base.y + Math.sin(time * 0.3) * 0.3,
            t.base.z + Math.cos(time * 0.017) * 3);
          g.rotation.z = Math.sin(time * 0.4) * 0.04;
          if (t.flame) {
            const f = 0.75 + Math.abs(Math.sin(time * 7)) * 0.5;
            t.flame.scale.set(f, f * 1.2, f);
          }
        } else {
          t.ang += dt * 0.12;
          g.position.set(t.center.x + Math.cos(t.ang) * t.r, t.center.y, t.center.z + Math.sin(t.ang) * t.r);
          g.rotation.y = -t.ang - PI / 2;      // 机头沿切线方向
          g.rotation.z = 0.12;                 // 压坡度盘旋
        }
        t.pos.copy(g.position);
        continue;
      }
      if (t.mode === 'done') continue;

      // —— 击落后的坠毁动画 ——
      t.t += dt;
      const gy = this.world && this.world.terrainKey === 'desert'
        ? duneH(g.position.x, g.position.z) : 0;   // 仅沙漠沙丘贴地
      if (t.mode === 'fall') {
        // 无人机：翻滚坠落 + 断续黑烟
        t.vy -= 9.8 * 0.7 * dt;
        g.position.y += t.vy * dt;
        g.rotation.x += dt * 5.5;
        g.rotation.z += dt * 3.5;
        if (this.fx && rnd() < 0.25) {
          this.fx._puff(g.position.x, g.position.y, g.position.z,
            { color: 0x3a3f44, s0: 0.10, s1: 0.5, life: 0.4, base: 0.4 });
        }
      } else if (t.mode === 'burn') {
        // 热气球：蒙皮起火变焦 + 泄气下沉（1.6s 后进入 balloonFall）
        t.envMat.color.lerp(new THREE.Color(0x1c1512), Math.min(1, dt * 1.2));
        if (t.env) t.env.scale.y = Math.max(0.55, t.env.scale.y - dt * 0.35);
        g.position.y += t.vy * dt;
        t.vy = Math.max(t.vy, -1.2);
        if (this.fx) {
          this.fx._puff(g.position.x + rnd(-0.5, 0.5), g.position.y + 1, g.position.z + rnd(-0.5, 0.5),
            { color: 0xff8a3c, s0: 0.15, s1: 0.6, life: 0.3, base: 0.55, add: true });
        }
        if (t.t > 1.6) { t.mode = 'balloonFall'; t.vy = -1.0; }
      } else if (t.mode === 'balloonFall') {
        // 气球气囊烧穿后重力加速，保留滚转和燃烧尾迹
        t.vy = Math.max(t.vy - 9.8 * 0.35 * dt, -8);
        g.position.y += t.vy * dt;
        g.rotation.z += dt * 0.8;
        if (this.fx) {
          this.fx._puff(g.position.x + rnd(-0.8, 0.8), g.position.y + 0.5, g.position.z + rnd(-0.8, 0.8),
            { color: 0xff8a3c, s0: 0.18, s1: 0.7, life: 0.3, base: 0.5, add: true });
        }
      } else if (t.mode === 'crash') {
        // 靶机：坡度陡增 + 螺旋俯冲拖烟
        t.vy -= 9.8 * 0.6 * dt;
        g.position.y += t.vy * dt;
        g.rotation.z = Math.min(g.rotation.z + dt * 2.2, 1.2);
        g.rotation.y += dt * 1.4;
        g.translateX(dt * 9);
        if (this.fx && rnd() < 0.4) {
          this.fx._puff(g.position.x, g.position.y, g.position.z,
            { color: 0x2f2f2f, s0: 0.12, s1: 0.6, life: 0.5, base: 0.5 });
        }
      }
      // 触地：按目标类型分级爆炸 + 地面残骸留存
      if (g.position.y <= gy + 0.3) {
        t.mode = 'done';
        g.visible = false;
        const tier = t.type === 'balloon' ? 3 : t.type === 'plane' ? 2 : 1;
        if (this.fx) this.fx.explosion(g.position.x, gy + 0.5, g.position.z, tier);
        this._spawnWreck(g.position.x, gy, g.position.z, t.type);
      }
      t.pos.copy(g.position);
    }
    this._updateWrecks(dt);
  }

  // —— 地面残骸：焦黑贴地圆片 + 2~3 块暗色碎块，10s 停留后 2s 淡出 ——
  // 击落成果"看得见"：残骸留在原地直到自然淡出，而不是击落即凭空消失
  _spawnWreck(x, y, z, type) {
    const size = type === 'balloon' ? 1.5 : type === 'plane' ? 1.2 : 0.9;
    const g = new THREE.Group();
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(size, 14),
      new THREE.MeshBasicMaterial({ color: 0x0d0d0c, transparent: true, opacity: 0.85, depthWrite: false }));
    scorch.rotation.x = -PI / 2;
    scorch.position.y = 0.02;
    g.add(scorch);
    const chunkMat = new THREE.MeshStandardMaterial({
      color: 0x1f1d1a, roughness: 0.95, transparent: true, opacity: 1 });
    for (let i = 0; i < 3; i++) {
      const ck = new THREE.Mesh(new THREE.TetrahedronGeometry(size * (0.12 + rnd(0.10))), chunkMat);
      ck.position.set(rnd(-0.5, 0.5) * size, 0.08 + rnd(0.1), rnd(-0.5, 0.5) * size);
      ck.rotation.set(rnd(TAU), rnd(TAU), rnd(TAU));
      g.add(ck);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    g.position.set(x, y + 0.02, z);
    this.scene.add(g);
    this.wrecks.push({ g, mats: [scorch.material, chunkMat], t: 0 });
  }

  _updateWrecks(dt) {
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.t += dt;
      if (w.t > 12) {                          // 10s 停留 + 2s 淡出
        const k = Math.max(0, 1 - (w.t - 12) / 2);
        w.mats.forEach(m => m.opacity = k * 0.85);
        if (k <= 0) {
        this.scene.remove(w.g);
        disposeObject3D(w.g);
        this.wrecks.splice(i, 1);
        }
      }
    }
  }

  // P6：任务重试/靶场重置时把空中目标全部复位（既有 _build 的出厂位置与血量）。
  // 此前无 reset——击落残骸只靠自然淡出（12s），B 重置不会把已击落的无人机/气球/
  // 靶机复活，重试同一任务时空中目标缺失（验收点"重试清理目标状态"）。
  reset() {
    for (const t of this.list) {
      t.hp = t.hp0;
      t.alive = true;
      t.mode = t.type === 'drone' ? 'hover' : t.type === 'balloon' ? 'drift' : 'cruise';
      t.t = 0; t.vy = 0;
      t.g.visible = true;
      // 出厂位置：drone/balloon 存 base，plane 存 center（对象结构不同，分别复位）
      if (t.type === 'plane') { t.ang = rnd(TAU); t.g.position.copy(t.center); }
      else { t.g.position.copy(t.base); }
      if (t.type === 'balloon') { t.env.scale.set(1, 1.12, 1); t.envMat.color.setHex(0xffffff); }
      t.pos.copy(t.g.position);
    }
    for (const w of this.wrecks) { this.scene.remove(w.g); disposeObject3D(w.g); }
    this.wrecks.length = 0;
  }
}
