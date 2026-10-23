// ============================================================
// 65-weapons.js — 武器系统：M230 机炮曳光 / 地狱火 / 火箭 / 弹药装填
// 地面下洗特效不在这里，统一由 17-washfx.js 的 WashFX 负责
// ============================================================

// 柔光径向渐变贴图（炮口焰 / 尾烟共用）
function makeGlowTex(N = 64) {
  const { c, x } = canvas2d(N);
  const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.30, 'rgba(255,255,255,.50)');
  g.addColorStop(0.65, 'rgba(255,255,255,.16)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

// 弹体几何长轴方向（弹身沿 +Z：body.rotation.x=PI/2 后的朝向）。
// 发射/飞行时用 setFromUnitVectors(HF_FWD, dir) 把弹体对齐飞行方向——
// 复用一个模块级向量，避免每帧 new（对象池纪律：逐帧短命对象会喂 GC）
const HF_FWD = new THREE.Vector3(0, 0, 1);
// Phase 19 性能审计 A2/A3/A4：发射与飞行热路径的 scratch 向量池——
// 曳光散布/炮口与巢口起点/导引目标点等全部复用模块级向量，单线程同步
// 顺序使用无重入（同一帧内后写覆盖前写，用完即弃）。
const _W_SPREAD = new THREE.Vector3();    // 曳光散布项
const _W_MZL = new THREE.Vector3();       // 机炮/火箭发射起点（局部→世界）
const _W_DIR = new THREE.Vector3();       // 机炮方向（机头四元数应用）
const _W_AIM = new THREE.Vector3();       // 瞄准点（发射时构造）
const _W_TUR = new THREE.Vector3(), _W_TUR2 = new THREE.Vector3();   // 炮塔射界 scratch
const _W_TO = new THREE.Vector3();       // 火箭半瞄准修正向量
const _HF_TO = new THREE.Vector3();       // 地狱火导引目标点（每弹每帧）

// Q3：各时段烟尘受光系数（乘到烟尘颜色上；与 32-envpreset 的环境键一致）
const SMOKE_TINT = { day: [1, 1, 1], afternoon: [1, 0.96, 0.9], dawn: [0.92, 0.8, 0.74],
  dusk: [0.9, 0.68, 0.5], night: [0.24, 0.26, 0.32], studio: [1, 1, 1] };
const _SMOKE_C = new THREE.Color();

// E3：团状烟贴图——固定种子的多个软圆叠加（不用 Math.random，不占视觉 PRNG 流）
function makeSmokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = mulberry32(0x5A0E3);
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, d = r() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, R = 26 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class WeaponRig {
  constructor(scene, apache) {
    this.apache = apache;
    this.scene = scene;
    this._initImpactFx();
    this.gunAmmo = GUN.AMMO;
    this.hfAmmo = 8;
    this.rocketAmmo = ROCKET.AMMO;
    this.gunOn = false;            // 扳机（按住连发）
    this.rocketOn = false;         // 火箭扳机（按住连发，左右巢交替）
    this.launched = new Set();     // 已离架的地狱火节点
    this.onToast = null;           // 提示回调（由 app 注入）
    this.onSfx = null;             // 武器/命中音效回调（由 app 注入 → RotorAudio.playSfx）
    this.onHitMark = null;         // 命中标记回调（FPV 十字线收缩闪白）
    this.onAmmo = null;            // 弹药变化回调

    this._gt = 0;                  // 机炮发射计时
    this._kick = 0;                // 炮管后坐量
    this.glow = makeGlowTex();
    this.smokeTex = makeSmokeTex();   // E3 浓烟柱专用：宽而软的团状烟（glow 贴图核心太集中，暗烟几乎看不见）
    this.targets = null;           // TargetRange 引用（app 注入，null=无靶场）

    // 炮口（机体局部坐标；机头朝 +Z，模型 1u ≈ 2m）
    this.muzzle = new THREE.Vector3(0.04, 0.46, 3.70);
    // 炮管节点（后坐动画）
    this.barrel = apache.get('Cylinder.014');
    // 8 枚地狱火挂架节点（按挂位顺序轮流发射）
    this.hfList = apache.hellfire.slice();
    // 火箭巢 ×2（左右各一；坐标为已含 MODEL_LIFT 的世界系，
    // 实测 Cube007_1：X ±1.15~1.556，Y 0.65~0.94，Z 前脸 2.06）
    this.pod = apache.rocketPods[0] || null;
    this.rkMuzzles = [new THREE.Vector3(-1.31, 0.79, 2.06), new THREE.Vector3(1.31, 0.79, 2.06)];

    // ---- 曳光弹池（建模实体：铜壳弹身 + 风帽 + 尾部燃烧的曳光管）----
    // 旧实现是一张贴地加色平面；30mm HEI 弹改为真实几何——
    // 弹体沿 +Z（风帽朝前），尾部曳光管用不受光照的亮橙色表现燃烧
    this.tracers = [];
    const tg = {
      body: new THREE.CylinderGeometry(0.020, 0.020, 0.46, 6),
      tip: new THREE.ConeGeometry(0.020, 0.10, 6),
      burn: new THREE.CylinderGeometry(0.027, 0.032, 0.30, 6),   // 曳光管略粗（燃烧辉光感）
    };
    const tmat = {
      body: new THREE.MeshStandardMaterial({ color: 0x8a6a35, roughness: 0.35, metalness: 0.6 }),
      tip: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.3, metalness: 0.4 }),
      burn: new THREE.MeshBasicMaterial({ color: 0xffb043 }),     // 曳光火焰不受光照
    };
    for (let i = 0; i < 20; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(tg.body, tmat.body);
      body.rotation.x = PI / 2;
      const tip = new THREE.Mesh(tg.tip, tmat.tip);
      tip.rotation.x = PI / 2;
      tip.position.z = 0.28;
      const burn = new THREE.Mesh(tg.burn, tmat.burn);
      burn.rotation.x = PI / 2;
      burn.position.z = -0.30;
      g.add(body, tip, burn);
      g.visible = false; g.renderOrder = 8;
      this.scene.add(g);
      this.tracers.push({ m: g, life: 0, dir: new THREE.Vector3(), vel: 0 });
    }

    // ---- 炮口焰池（两张十字交叉的柔光片）----
    this.flashes = [];
    const fg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
        map: this.glow, color: 0xffc27a, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 9;
      this.scene.add(m);
      this.flashes.push({ m, life: 0, len: 0.5 });
    }

    // ---- 烟尘池（尾烟 / 加力焰 / 起飞扬尘）----
    this.puffs = [];
    const pg = new THREE.PlaneGeometry(1, 1);
    // E3：48→112，残骸烟柱燃烧拉长后不挤占爆炸/尾烟粒子
    for (let i = 0; i < 112; i++) {
      const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({
        map: this.glow, color: 0x8b949c, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.NormalBlending }));
      m.visible = false; m.renderOrder = 7;
      this.scene.add(m);
      this.puffs.push({ m, life: 0, life0: 1, base: 0, s0: 0.1, s1: 1, rise: 0 });
    }

    // ---- 飞行中的地狱火 ----
    this.flying = [];

    // ---- 飞行中的 Hydra 70 火箭 ----
    // 弹体小、速度快、带轻微弹道下坠，用对象池循环复用
    this.rockets = [];
    const rkGeo = {
      body: new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8),
      nose: new THREE.ConeGeometry(0.035, 0.12, 8),
      fin: new THREE.BoxGeometry(0.14, 0.008, 0.16),
    };
    const rkMat = {
      body: new THREE.MeshStandardMaterial({ color: 0x9aa08f, roughness: 0.55, metalness: 0.1 }),
      nose: new THREE.MeshStandardMaterial({ color: 0x4c5148, roughness: 0.4 }),
      fin: new THREE.MeshStandardMaterial({ color: 0x4c5148, roughness: 0.5 }),
    };
    for (let i = 0; i < 24; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(rkGeo.body, rkMat.body);
      body.rotation.x = PI / 2;
      const nose = new THREE.Mesh(rkGeo.nose, rkMat.nose);
      nose.rotation.x = PI / 2;
      nose.position.z = 0.34;
      // 尾翼十字
      const f1 = new THREE.Mesh(rkGeo.fin, rkMat.fin);
      const f2 = new THREE.Mesh(rkGeo.fin, rkMat.fin);
      f2.rotation.z = PI / 2;
      f1.position.z = f2.position.z = -0.18;
      g.add(body, nose, f1, f2);
      g.visible = false;
      this.scene.add(g);
      this.rockets.push({ g, life: 0, vel: 0, dir: new THREE.Vector3(), spin: 0, smoke: 0 });
    }
    this._rkT = 0;
    this._rkSide = 0;

    // ---- 地狱火弹体共享模板（避免每次发射都建/销毁几何与材质）----
    this.hfGeo = {
      body: new THREE.CylinderGeometry(0.062, 0.062, 0.92, 10),
      nose: new THREE.ConeGeometry(0.062, 0.22, 10),
      fin: new THREE.BoxGeometry(0.005, 0.20, 0.26),    // 尾部舵翼（X 形布局）
      wing: new THREE.BoxGeometry(0.004, 0.34, 0.15),   // 中段弹翼（离架展开）
    };
    this.hfMat = {
      body: new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.45, metalness: 0.15 }),
      nose: new THREE.MeshStandardMaterial({ color: 0x565b60, roughness: 0.3 }),
      fin: new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.4 }),
      wing: new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.4 }),
    };

    // ---- 破片池（爆炸抛射的实体碎块，落地停留片刻再消隐）----
    this.frags = [];
    const frGeo = new THREE.BoxGeometry(0.14, 0.10, 0.18);
    const frMat = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.9 });
    // phys2：真实重力下碎块滞空更久（4~16 米/秒抛出要 1~3 秒才落地），寿命加长 → 池 14→24 防连发火箭时抢光
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(frGeo, frMat);
      m.visible = false;
      this.scene.add(m);
      this.frags.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0, life: 0 });
    }

    // ---- 冲击波环池（大威力爆炸的贴地扩张气浪圈）----
    this.shocks = [];
    // vis1 2026-10-23：旧版是实心奶白细环（近看像画上去的白圈）。改为软边尘土环：
    // 径向渐变贴图（内淡→外缘最浓→外沿消散）+ 土黄色，读作冲击波掀起的一圈尘土。
    const shCv = document.createElement('canvas'); shCv.width = shCv.height = 128;
    {
      const c2 = shCv.getContext('2d'), gr = c2.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.10)');
      gr.addColorStop(0.82, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = gr; c2.fillRect(0, 0, 128, 128);
    }
    const shTex = new THREE.CanvasTexture(shCv);
    const shGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex,
        color: 0xb8a483, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -PI / 2;
      m.visible = false; m.renderOrder = 9;
      this.scene.add(m);
      this.shocks.push({ m, t: 0 });
    }

    // ---- 空中打击目标（由 70-app 注入 AirTargets 实例）----
    this.airTargets = null;
  }

  // 取一个可用烟尘对象
  _puff(x, y, z, opt) {
    for (const p of this.puffs) {
      if (p.m.visible) continue;
      p.m.visible = true;
      p.m.position.set(x, y, z);
      p.base = opt.base ?? 0.5;
      p.life0 = p.life = opt.life ?? 0.5;
      p.s0 = opt.s0 ?? 0.2; p.s1 = opt.s1 ?? 0.9; p.rise = opt.rise ?? 0.4;
      p.lin = !!opt.lin;
      p.m.material.map = p.lin ? this.smokeTex : this.glow;   // E3：烟柱用线性淡出（默认平方淡出太快，浓烟看不见）
      p.m.material.color.setHex(opt.color ?? 0x8b949c);
      // Q3 烟尘受环境光：烟/尘是不发光的材质，黄昏偏暖、夜里压暗，
      // 不再在夜空里发灰白光（火光/闪光这类叠加发光的不受影响）
      if (!opt.add) { const k = SMOKE_TINT[(HOST.S && HOST.S.env) || 'day'] || SMOKE_TINT.day; p.m.material.color.multiply(_SMOKE_C.setRGB(k[0], k[1], k[2])); }
      p.m.material.blending = opt.add ? THREE.AdditiveBlending : THREE.NormalBlending;
      p.m.material.opacity = p.base;
      return p;
    }
    return null;
  }

  // 曳光：从炮口飞出的建模弹体。precise=对空精确射击（散布减半）
  // P7+P8：散布 = 基础 × 稳定度放大 × 受损惩罚——悬停射击（_stability=1）用基础散布，
  // 高速/机动中放大至 ~2.9×；机体受损（_dmgPenalty，70-app 由 _heliDmg 派生）再叠加
  // 至 +50% 上限。移动射击 vs 悬停射击、健康 vs 受损的可解释差异。
  _tracer(from, dir, precise) {
    const stab = this._stability ?? 1;
    const dmg = this._dmgPenalty ?? 0;
    const base = precise ? 0.012 : 0.03;
    const sp = base * (1 + (1 - stab) * 2.5) * (1 + dmg);
    for (const t of this.tracers) {
      if (t.m.visible) continue;
      t.m.visible = true;
      t.m.position.copy(from);
      t.dir.copy(dir)
        .add(_W_SPREAD.set((rnd() - 0.5) * sp, (rnd() - 0.5) * sp, 0))
        .normalize();
      t.vel = 355;   // phys1：M230 炮口初速 805m/s ≈ 355u/s（旧 260 偏慢）；射程 213u
      // 【射程修正（2026-09-15，用户反馈"空中飞行目标永远打不到"）】
      // 旧值 vel=95 / life=0.55 ⇒ 射程硬上限 ≈52u，曳光到点即消失——
      // 实测（精确瞄准、3s 连发）：30u 与 45u 稳定击落；60u 与 75u **0 命中**。
      // 现 vel=260 / life=0.60 ⇒ 射程 ≈156u，覆盖全部交战距离；因为 life 基本
      // 没变，并发中的曳光数量不变（不增加 draw call 压力）。
      // 代价：单帧位移从 ~1.6u 涨到 ~4.3u，逐帧"点测"会直接穿过无人机
      // （命中半径 0.85+1）——故 update 里改为按 ≤0.8u 分段推进判定。
      t.life = 0.60;
      t.m.quaternion.setFromUnitVectors(HF_FWD, t.dir);
      return;
    }
  }

  // 炮口焰：十字两片 + 随机闪烁
  _flash(pos) {
    let used = 0;
    for (const f of this.flashes) {
      if (f.m.visible) continue;
      f.m.visible = true;
      f.m.position.copy(pos);
      f.m.quaternion.copy(this._camQuat);
      f.m.rotateZ(rnd(TAU));
      const s = 0.45 + rnd(0.5);
      f.m.scale.set(s * 0.8, s, 1);
      f.life = 0.055;
      f.m.material.opacity = 0.95;
      if (++used >= 2) break;
    }
  }

  // 击毁特效：按武器威力分档 —— tier 1 机炮击毁 / 2 火箭 / 3 地狱火·殉爆
  // （倍率缩放爆闪与烟柱；地狱火级追加冲击波环 + 实体破片抛射）
  // ---- P5-G1 爆炸照亮 + 地面弹坑（2026-10-16）----
  // 一盏常驻橙色点光源（空闲时亮度 0，常驻不增删 → 不触发材质重编；不投影 → 不加
  // 阴影绘制）。每次爆炸把它挪到爆心，按威力闪一下再快速熄灭：地面、房子、树、机身
  // 都会被照亮一瞬，夜间关最明显。同时有多个爆炸时取更亮的那个。
  // 弹坑：48 块焦痕贴花环形复用（最旧的被新的顶掉），贴地爆炸（y<1.6）才留，整关保留，
  // 换场地/新任务清空。水面不留。
  _initImpactFx() {
    this._xLight = new THREE.PointLight(0xff9440, 0, 34, 2);
    this._xLight.castShadow = false;
    this.scene.add(this._xLight);
    this._xl = { t: 1, life: 1, peak: 0 };
    this._craters = [];
    this._craterI = 0;
    this._craterTerr = null;
    const mat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -PI / 2;
      m.visible = false; m.renderOrder = 2;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
      this._craters.push(m);
    }
  }
  _groundH(x, z) {
    const cv = this.targets && this.targets.canyon;
    if (cv && cv.active && cv.inZone({ x, z })) return cv.heightAt(x, z);
    if (this.terrainKey === 'desert') return Math.max(0, duneFarH(x, z));
    return 0;
  }
  _crater(x, z, size) {
    if (this.terrainKey === 'water') return;
    const m = this._craters[this._craterI];
    this._craterI = (this._craterI + 1) % this._craters.length;
    m.position.set(x, this._groundH(x, z) + 0.025, z);
    m.rotation.z = rnd(TAU);
    m.scale.set(size, size, 1);
    m.updateMatrix();
    m.visible = true;
  }
  clearImpacts() {
    for (const m of this._craters) m.visible = false;
    this._xl.t = this._xl.life; this._xLight.intensity = 0;
  }
  _updateImpactFx(dt) {
    const tk = this.terrainKey || null;   // 70-loop 每帧写入（避免反向引用 W）
    if (tk !== this._craterTerr) { this._craterTerr = tk; for (const m of this._craters) m.visible = false; }
    const L = this._xl;
    if (L.t < L.life) {
      L.t += dt;
      const k = Math.max(0, 1 - L.t / L.life);
      this._xLight.intensity = L.peak * k * k * (0.85 + rnd() * 0.3);
    } else {
      // P5-G3 火光：没有爆炸时，这盏灯挪到最近一处正在燃烧的残骸上微弱闪烁（夜里看得见火光映地）
      let best = null, bd = 1e9;
      const T = this.targets, cam = this._cam;
      if (T && T.enabled && cam) for (const t of T.targets) {
        if (t.alive || !(t.burn > 1) || !t.wreck) continue;
        const d = cam.position.distanceToSquared(t.wreck.position);
        if (d < bd) { bd = d; best = t; }
      }
      if (best) {
        const w = best.wreck.position;
        this._xLight.position.set(w.x, w.y + 1.1, w.z);
        this._xLight.intensity = 26 * Math.min(1, best.burn / 4) * (0.7 + rnd() * 0.5);
      } else if (this._xLight.intensity !== 0) this._xLight.intensity = 0;
    }
  }

  explosion(x, y, z, tier = 2) {
    if (this.onSfx) this.onSfx('explo', tier, { x, y, z });   // sfx3：带位置 → 远处爆炸声音晚到、变闷
    {
      const peak = tier >= 3 ? 260 : tier <= 1 ? 70 : 150;
      const L = this._xl;
      const cur = L.t < L.life ? L.peak * Math.pow(1 - L.t / L.life, 2) : 0;
      if (peak >= cur) {
        L.peak = peak; L.t = 0; L.life = tier >= 3 ? 0.55 : tier <= 1 ? 0.25 : 0.4;
        this._xLight.position.set(x, y + 1.4, z);
      }
      if (y < 1.6) this._crater(x, z, tier >= 3 ? 3.4 : tier <= 1 ? 1.1 : 2.3);
    }
    if (this.onBlast) this.onBlast(x, y, z, tier);   // 31-scenery：附近树木摇晃/折倒/起火
    const T = tier >= 3 ? 1.45 : tier <= 1 ? 0.55 : 1.0;
    // 三层爆闪
    this._puff(x, y, z, { color: 0xffffff, s0: 0.6 * T, s1: 2.6 * T, life: 0.18, base: 0.95, add: true });
    this._puff(x, y, z, { color: 0xffb054, s0: 0.8 * T, s1: 3.4 * T, life: 0.4, base: 0.85, add: true });
    this._puff(x, y + 0.3 * T, z, { color: 0xd8651e, s0: 1.0 * T, s1: 4.2 * T, life: 0.65, base: 0.55, rise: 0.8 });
    // 黑烟柱（威力越大越厚越长）
    const col = tier >= 3 ? 8 : tier <= 1 ? 2 : 5;
    for (let i = 0; i < col; i++) {
      this._puff(x + (rnd() - 0.5) * 1.2 * T, y + 0.4 + i * 0.5 * T, z + (rnd() - 0.5) * 1.2 * T,
        { color: 0x2b2620, s0: 0.7 * T, s1: (2.6 + i * 0.5) * T, life: 1.4 + i * 0.25, base: 0.5, rise: 1.1 });
    }
    // 飞溅碎片烟
    const spl = tier >= 3 ? 10 : tier <= 1 ? 4 : 8;
    for (let i = 0; i < spl; i++) {
      const a = rnd(TAU), r = rnd(1.2, 3.5);
      this._puff(x + Math.cos(a) * r, 0.15, z + Math.sin(a) * r,
        { color: 0x8a8175, s0: 0.2, s1: 0.9, life: 0.6, base: 0.4, rise: 0.3 });
    }
    // 实体破片 + 冲击波环（火箭以上）
    this.spawnFrags(x, y, z, tier >= 3 ? 10 : tier <= 1 ? 2 : 5);
    if (tier >= 3) this._shock(x, Math.max(0.06, y * 0.25), z);
  }

  // 抛射 n 块实体破片（径向散开 + 重力 + 翻滚，落地停留至寿命结束）
  spawnFrags(x, y, z, n) {
    for (const f of this.frags) {
      if (n <= 0) break;
      if (f.m.visible) continue;
      f.m.visible = true;
      f.m.position.set(x, y, z);
      const a = rnd(TAU);
      f.v.set(Math.cos(a) * rnd(2, 7), rnd(2.5, 6.5), Math.sin(a) * rnd(2, 7));
      f.w.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
      f.t = 0; f.rest = false;
      f.life = rnd(3.2, 4.0);   // phys2：旧 1.6~2.4 秒，真实重力下会在半空缩没
      n--;
    }
  }

  // 大威力爆炸的贴地冲击波环
  _shock(x, y, z) {
    for (const s of this.shocks) {
      if (s.m.visible) continue;
      s.m.visible = true;
      s.m.position.set(x, y, z);
      s.t = 0;
      s.m.scale.setScalar(0.5);
      s.m.material.opacity = 0.6;
      return;
    }
  }

  // 机炮单发：弹药递减 + 后坐 + 曳光 + 炮口焰
  // M230 为可转向炮塔（±110°方位），演示模式下自动追踪机头锥角内最近靶标
  // M230 炮塔射界内最近的空中目标（机体坐标系：方位 ±86°，俯仰 -60°..+11°）
  _turretAir(from) {
    const root = this.apache.root;
    let best = null, bestD = 1e9;
    for (const t of this.airTargets.list) {
      if (!t.alive || t.off) continue;
      const v = _W_TUR.copy(t.pos);
      root.worldToLocal(v);
      const m = _W_TUR2.copy(this.muzzle);
      v.sub(m);
      const h = Math.hypot(v.x, v.z), d = v.length();
      const el = Math.atan2(v.y, h) * 57.2958, az = Math.atan2(v.x, v.z) * 57.2958;   // 弧度→度
      if (Math.abs(az) > 86 || el > 11 || el < -60 || d > 150) continue;
      if (d < bestD) { best = t; bestD = d; }
    }
    return best ? { t: best, d: bestD } : null;
  }

  shoot() {
    const a = this.apache;
    if (this.gunAmmo <= 0) return;
    if (this._jam) return;   // Phase 19：武器卡壳（86-damage 状态机经 70-app 写入；undefined=falsy 零变化）
    this.gunAmmo--;
    a.root.updateMatrixWorld(true);
    const from = _W_MZL.copy(this.muzzle);
    from.x += (rnd() - 0.5) * 0.03;
    a.root.localToWorld(from);
    let dir = _W_DIR.set(0, 0, 1).applyQuaternion(a.root.quaternion);
    // 炮塔瞄准：机头锥角内取"最近的"目标——地面软目标与空中目标（无人机/
    // 靶机/气球）同台竞争，谁近打谁（M230 炮塔可上仰，对空射击符合实装）。
    // 对空散布减半、收敛更快（空中目标小且机动，精度要求高）
    let aim = null, aimD = 1e9, aimAir = false;
    // 空中目标优先软锁：机头 10° 内有飞行目标就死咬它——FPV 十字线指着谁
    // 就打谁。此前炮塔会被 45° 大锥角内的地面目标拽走，十字线明明压着
    // 无人机、曳光却飞向别处，是"对空瞄准难控制"的手感根因（用户实测）。
    // #6 鼠标容错③：自瞄锥角整体放宽（对空 10→14° / 敌机 25→30° / 地面 45→60°），
    // 十字线离目标更远也能咬住——补偿指针锁定瞄准的抖动与低容错。
    if (this.airTargets && this.airTargets.enabled) {
      // 2026-10-20 展示线：展示模式飞机不能转向/抬头，只靠十字线 14° 锥永远打不到
      // 机头外的无人机/气球。展示模式改按 M230 炮塔真实射界自动找目标：左右各 86°，
      // 上仰最多 11°、下俯最多 60°。所以停在地面打不到高处的无人机（真机也打不到），
      // 起飞悬停后无人机在下方，炮塔下俯即可打。游戏关卡仍是 14° 十字线软锁，不变。
      const at = (HOST.S && HOST.S.app === 'show')
        ? this._turretAir(from) : this.airTargets.nearest(from, dir, 14);
      if (at) { aim = _W_AIM.copy(at.t.pos); aimD = at.d; aimAir = true; }
    }
    // Phase 20-A：A2A 敌机同台竞争软锁（锥角放宽到 30°——敌机更远更大，
    // 与无人机同优先级取近；airTargets 未命中时才轮到它）
    if (!aimAir && this.enemyAir && this.enemyAir.enabled) {
      const et = this.enemyAir.nearest(from, dir, 30);
      if (et) { aim = _W_AIM.copy(et.t.pos); aimD = et.d; aimAir = true; }
    }
    if (!aimAir && this.targets && this.targets.enabled) {
      // P16 验收修复：地面导引从 ['truck','barrel'] 扩入 'tank'——悬停平射时
      // 曳光沿机头水平飞行，飞越地面目标上方 13.7u（hitTest 判定半径 2.05u
      // 必 miss），坦克被排除在导引外导致"剩余目标用任何武器都无法攻击"
      //（用户验收实测）。命中表现保持钢芯弹跳弹火花（未穿甲观感），伤害
      // 1/发（现有数值模型不变，坦克 hp2 两发击毁）。
      const tgt = this.targets.nearestAhead(a.root.position, dir, 60, ['truck', 'barrel', 'tank']);
      if (tgt) { aim = _W_AIM.set(tgt.pos.x, 0.9, tgt.pos.z); aimD = aim.distanceTo(from); }
    }
    if (aim) {
      const to = aim.sub(from).normalize();
      // #6 鼠标容错③·接近吸附：十字线已贴近目标（夹角 ≤10°，cos≥0.985）时，
      // 把地面软锁 lerp 从 0.92 提到 1.0（满吸附）——最后一点角差自动咬合，
      // 玩家只需大致压住目标即命中，无需像素级微调。对空本就 1.0，不变。
      const snap = to.dot(dir) >= 0.985;
      dir = dir.lerp(to, aimAir ? 1.0 : (snap ? 1.0 : 0.92)).normalize();
    }
    this._tracer(from, dir, aimAir);
    this._flash(from);
    this._kick = 0.10;
    if (this.onSfx) this.onSfx('gun');
    if (this.onAmmo) this.onAmmo('gun');
  }

  // 发射一枚地狱火（下一枚挂架位），弹体离架后直线飞出
  launchHf() {
    if (this.hfAmmo <= 0) return false;
    if (this._hfOff) return false;   // Phase 19：武器系统失效（weapons lvl4，经 70-app 写入）
    const a = this.apache;
    let node = null;
    for (let i = 0; i < this.hfList.length; i++) {
      const o = this.hfList[(this._hfIdx ?? 0) % this.hfList.length];
      this._hfIdx = (this._hfIdx ?? 0) + 1;
      if (o.visible && !this.launched.has(o)) { node = o; break; }
    }
    if (!node) return false;
    this.launched.add(node);
    node.visible = false;
    this.hfAmmo--;
    if (this.onSfx) this.onSfx('hf');

    node.updateWorldMatrix(true, false);
    const c = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    let dir = new THREE.Vector3(0, 0, 1).applyQuaternion(a.root.quaternion);
    // 制导武器锁定：收窄锥角（地面 75°→30°、空中 60°→25°）。
    // 此前 75°/60° 的宽锥把完全不在画面里的目标也锁进来，比例导引再保证
    // 必中——这就是用户实测的"空中发射导弹击中视线外目标"盲狙 bug。
    // FPV 下机头=视线，"指着哪儿打哪儿"语义成立；环绕模式沿用"沿机头发射"
    // 的既有语义（曾试过用相机朝向做锁定轴，但环绕相机永远正对机体，
    // 投影轴会退化成零向量——谁也锁不上，已回退）。
    // 空中优先判优仍保留离地高度逻辑（贴地打装甲、升空打飞行目标）。
    const airborne = a.root.position.y > 4;
    const lockDir = dir;
    // 角偏移竞争锁定：谁更贴近锁定轴谁赢——而不是"空中无条件优先"。
    // 旧规则会在机头明确指向地面装甲时，被 25° 锥内任意飞行目标劫持，
    // 弹道看着"匪夷所思"（用户实测）。贴地无地面候选时空中目标仍可锁。
    let tgtRef = null, tgtAir = false, aimP = null, bestAng = 1e9;
    if (this.targets && this.targets.enabled) {
      const tgt = this.targets.nearestAhead(a.root.position, lockDir, 30, ['tank']);
      if (tgt) {
        aimP = new THREE.Vector3(tgt.pos.x, 0.9, tgt.pos.z);
        tgtRef = tgt;
        const to = aimP.clone().sub(a.root.position).normalize();
        bestAng = Math.acos(Math.max(-1, Math.min(1, to.dot(lockDir))));
      }
    }
    if (this.airTargets && this.airTargets.enabled && (airborne || !tgtRef)) {
      const at = this.airTargets.nearest(c, lockDir, 25);
      if (at) {
        const to = at.t.pos.clone().sub(c).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, to.dot(lockDir))));
        if (ang < bestAng) {          // 更贴轴才接管，否则不劫持地面锁定
          aimP = at.t.pos.clone();
          tgtRef = at.t;
          tgtAir = true;
        }
      }
    }
    // Phase 20-A：A2A 敌机参与角偏移竞争（与无人机同规则——谁贴轴谁赢，
    // 不无条件劫持地面锁定；敌机可被地狱火锁定，其规避状态机随之触发）
    if (this.enemyAir && this.enemyAir.enabled && (airborne || !tgtRef)) {
      const et = this.enemyAir.nearest(c, lockDir, 25);
      if (et) {
        const to = et.t.pos.clone().sub(c).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, to.dot(lockDir))));
        if (ang < bestAng) {
          aimP = et.t.pos.clone();
          tgtRef = et.t;
          tgtAir = true;
        }
      }
    }
    if (aimP) {
      dir = dir.lerp(aimP.sub(c).normalize(), 0.95).normalize();
      // 锁定播报：玩家必须知道这一发去打谁，否则"弹体飞出画面"永远像 bug
      if (this.onToast) this.onToast(`地狱火锁定：${tgtRef.label}`);
    }

    // 弹体替身：深灰弹身 + 白弹头 + X 形尾舵 + 中段弹翼（AGM-114 实弹布局），
    // 从挂架位置起飞（几何/材质为共享模板，回收不 dispose）
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.hfGeo.body, this.hfMat.body);
    body.rotation.x = PI / 2;
    const nose = new THREE.Mesh(this.hfGeo.nose, this.hfMat.nose);
    nose.rotation.x = PI / 2;
    nose.position.z = 0.57;
    g.add(body, nose);
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 + PI / 4;                    // 尾舵 X 形（滚转稳定布局）
      const fin = new THREE.Mesh(this.hfGeo.fin, this.hfMat.fin);
      fin.position.set(Math.cos(a) * 0.078, Math.sin(a) * 0.078, -0.38);
      fin.rotation.z = a;
      const wing = new THREE.Mesh(this.hfGeo.wing, this.hfMat.wing);
      wing.position.set(Math.cos(a) * 0.135, Math.sin(a) * 0.135, -0.02);
      wing.rotation.z = a;
      g.add(fin, wing);
    }
    g.position.copy(c).addScaledVector(dir, 0.5);
    // 弹体朝向对齐飞行方向（用户反馈：导弹飞出与发射方向垂直——弹体几何
    // 沿 +Z 但 Group 未旋转，机头转向后弹体外观横飞；与火箭发射同法：
    // 把几何长轴 Z 对齐到 dir，比例导引变向时飞行循环里再逐帧跟随）
    g.quaternion.setFromUnitVectors(HF_FWD, dir);
    // 激光/雷达持续制导：飞行中向锁定目标比例导引（存目标引用，
    // 目标被其他火力摧毁则转入直线飞行）
    this.scene.add(g);
    this.flying.push({ g, dir, v: 0, t: 0, smoke: 0, tgt: tgtRef, air: tgtAir });
    // 离架烟雾
    this._puff(c.x, c.y, c.z, { color: 0x9aa4ac, s0: 0.3, s1: 1.4, life: 0.7, base: 0.55, rise: 0.2 });
    this._puff(c.x, c.y, c.z, { color: 0xffa04d, s0: 0.2, s1: 0.5, life: 0.3, base: 0.8, add: true });
    return true;
  }

  // 发射一枚 Hydra 70 火箭（左右巢交替），出巢即加速、带轻微下坠
  launchRocket() {
    if (this.rocketAmmo <= 0) return false;
    for (const r of this.rockets) {
      if (r.g.visible) continue;
      const a = this.apache;
      a.root.updateMatrixWorld(true);
      // 巢口起点：左右交替 + 孔位微散布
      const m = _W_MZL.copy(this.rkMuzzles[this._rkSide]);
      this._rkSide = 1 - this._rkSide;
      m.y += (rnd() - 0.5) * 0.18;
      m.x += (rnd() - 0.5) * 0.1;
      a.root.localToWorld(m);
      // 方向 = 机头朝向 + 轻微垂直散布；火箭为直射武器，
      // 演示模式下向靶区半瞄准（模拟飞行员压坡度进入射击航线）。
      // 高空不做对地半瞄准：地面靶标全在机腹下方，半瞄准会把整巢火箭拽成
      // 向下扎的弹雨（与地狱火同一类问题），高空按机头直射更符合观感。
      let dir0 = new THREE.Vector3((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.015, 1)
        .applyQuaternion(a.root.quaternion).normalize();
      // 对地半瞄准门（2026-09-19 #6 修复）：旧门 `y<=4` 在悬停高度（14）永远
      // 为假——火箭只会沿机头水平飞出、从地面目标头顶掠过，"火箭对地打不着"。
      // 改为「低空 或 机头已下俯」：dir0 是机头朝向单位向量，下俯时 dir0.y<0。
      // 阈值 -0.12（约下俯 7°）——悬停平飞（dir0.y≈0）不误触向下扎，压机头
      // 进入攻击航线时火箭才咬地面目标（符合"压坡度进入射击航线"观感）。
      if (this.targets && this.targets.enabled && (a.root.position.y <= 4 || dir0.y < -0.12)) {
        const tgt = this.targets.nearestAhead(a.root.position, dir0, 45, ['barrel', 'truck']);
        if (tgt) {
          const to = _W_TO.set(tgt.pos.x, 0.9, tgt.pos.z).sub(m).normalize();
          dir0 = dir0.lerp(to, 0.6).normalize();
        }
      }
      const dir = dir0;

      r.g.visible = true;
      r.g.position.copy(m);
      r.g.quaternion.setFromUnitVectors(HF_FWD, dir);
      r.dir.copy(dir);
      r.vel = ROCKET.V0;
      r.life = 3.0;
      r.spin = rnd(TAU);
      r.smoke = 0;
      this.rocketAmmo--;
      if (this.onSfx) this.onSfx('rocket');
      if (this.onAmmo) this.onAmmo('rk');

      // 出巢特效：巢口焰 + 烟
      this._puff(m.x, m.y, m.z, { color: 0xffc27a, s0: 0.22, s1: 0.6, life: 0.22, base: 0.85, add: true });
      this._puff(m.x, m.y, m.z, { color: 0x9aa4ac, s0: 0.25, s1: 1.1, life: 0.55, base: 0.5, rise: 0.15 });
      return true;
    }
    return false;
  }

  // 装填：机炮满弹 + 地狱火全数挂回 + 火箭巢满载
  reload(mountOn) {
    this.gunAmmo = GUN.AMMO;
    this.hfAmmo = 8;
    this.rocketAmmo = ROCKET.AMMO;
    for (const o of this.hfList) { this.launched.delete(o); o.visible = Boolean(mountOn); }
    if (this.onAmmo) { this.onAmmo('gun'); this.onAmmo('hf'); this.onAmmo('rk'); }
  }

  // P5-C：场地切换时清空全部瞬时武器视觉（对象池置 invisible，不销毁）。
  // 飞行中的火箭/曳光/地狱火/烟尘/破片/炮口焰/冲击波不得横跨进入新场地
  // （湖面下可见上一战场沙尘/弹体 = 验收点 4.2"切换场地后无残留"违反）。
  // 只清表现层：弹药、扳机、挂载可见性、launched 集合都不动——清理不破坏
  // 复用池与装填状态（G3 回归断言：清理后可直接再发射）。
  clearTransient() {
    for (const t of this.tracers) t.m.visible = false;
    for (const f of this.flashes) f.m.visible = false;
    for (const p of this.puffs) p.m.visible = false;
    for (const r of this.rockets) r.g.visible = false;
    for (const f of this.frags) f.m.visible = false;
    for (const s of this.shocks) s.m.visible = false;
    for (const f of this.flying) { this.scene.remove(f.g); }
    this.flying.length = 0;
  }

  update(dt, cam, time, spinRatio) {
    const a = this.apache;
    this._updateImpactFx(dt);
    this._camQuat = cam.quaternion;
    this._cam = cam;   // 锁定轴 = 玩家视线（环绕模式下机头与视线可差 90°）

    // ---- 机炮连发（625 发/分）----
    const mounted = this.barrel && this.barrel.visible;
    if (this.gunOn && mounted && this.gunAmmo > 0) {
      this._gt -= dt;
      while (this._gt <= 0) {
        this.shoot();
        this._gt += 60 / GUN.RPM;
        if (this.gunAmmo <= 0) break;
      }
      if (this.gunAmmo <= 0 && this.onToast) this.onToast('M230 弹药耗尽，按 V 装填');
    } else if (this.gunOn && this.gunAmmo <= 0) {
      this.gunOn = false;
    } else {
      this._gt = Math.min(this._gt, 0);
    }

    // ---- 火箭连发（左右巢交替，齐射间隔 RIPPLE_SEC）----
    const rkMounted = this.pod && this.pod.visible;
    if (this.rocketOn && rkMounted && this.rocketAmmo > 0) {
      this._rkT -= dt;
      while (this._rkT <= 0) {
        this.launchRocket();
        this._rkT += ROCKET.RIPPLE_SEC;
        if (this.rocketAmmo <= 0) break;
      }
      if (this.rocketAmmo <= 0 && this.onToast) this.onToast('火箭耗尽，按 V 装填');
    } else if (this.rocketOn && this.rocketAmmo <= 0) {
      this.rocketOn = false;
    } else {
      this._rkT = Math.min(this._rkT, 0);
    }

    // ---- 火箭弹体运动：加速 + 轻微弹道下坠 + 尾烟 + 自旋 + 触地起尘 ----
    for (const r of this.rockets) {
      if (!r.g.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.g.visible = false; continue; }
      if (r.vel < ROCKET.VMAX) r.vel += ROCKET.ACC * dt;
      // phys1 无控弹道重力下坠：航向每秒下压 g·cosθ/v 弧度（越快越平直，同真实弹道）
      r.dir.y -= G_U * Math.sqrt(Math.max(0, 1 - r.dir.y * r.dir.y)) / Math.max(1, r.vel) * dt;
      r.dir.normalize();
      // phys1 分段推进：提速后单帧位移可达 ~2.7u，按 ≤1.5u 小步走并逐步判定，防止穿过目标
      const _rkLen = r.vel * dt, _rkN = Math.max(1, Math.ceil(_rkLen / 1.5));
      let _rkHit = false;
      for (let _k = 0; _k < _rkN && !_rkHit; _k++) {
      r.g.position.addScaledVector(r.dir, _rkLen / _rkN);
      // 命中检测：火箭威力中（卡车/油桶一发，装甲车两发）
      if (this.targets && this.targets.hitTest(r.g.position, 2)) {
        this.explosion(r.g.position.x, Math.max(0.4, r.g.position.y), r.g.position.z, 2);
        r.g.visible = false; _rkHit = true; break;
      }
      // 空中目标掠过命中（无控弹道碰上气球/靶机也算）
      if (this.airTargets && this.airTargets.enabled && this.airTargets.hitTest(r.g.position, 2)) {
        this._puff(r.g.position.x, r.g.position.y, r.g.position.z,
          { color: 0xffe9a8, s0: 0.2, s1: 0.8, life: 0.2, base: 0.9, add: true });
        r.g.visible = false; _rkHit = true; break;
      }
      // Phase 20-A：敌机掠过命中（无控火箭碰上也算——威力 2 足以重创）
      if (this.enemyAir && this.enemyAir.enabled && this.enemyAir.hitTest(r.g.position, 2)) {
        this._puff(r.g.position.x, r.g.position.y, r.g.position.z,
          { color: 0xffe9a8, s0: 0.25, s1: 0.9, life: 0.22, base: 0.9, add: true });
        r.g.visible = false; _rkHit = true; break;
      }
      // Phase 21：基地设施命中（雷达/防空车/弹药库；hitTest 内按 radius 限域，只在基地扇区生效）
      if (this.narrative && this.narrative.enabled && this.narrative.hitTest(r.g.position, 2)) {
        this._puff(r.g.position.x, r.g.position.y, r.g.position.z,
          { color: 0xffe9a8, s0: 0.25, s1: 0.9, life: 0.22, base: 0.9, add: true });
        r.g.visible = false; _rkHit = true; break;
      }
      // 触地：扬起尘土后消失（不用等到 life 耗尽）
      if (r.g.position.y <= 0.03) {
        const p = r.g.position;
        this._puff(p.x, 0.05, p.z, { color: 0x9a8f7c, s0: 0.3, s1: 1.7, life: 0.8, base: 0.55, rise: 0.6 });
        this._puff(p.x, 0.05, p.z, { color: 0xc9b896, s0: 0.15, s1: 0.6, life: 0.4, base: 0.5, rise: 0.8 });
        r.g.visible = false; _rkHit = true; break;
      }
      }
      if (_rkHit) continue;
      r.g.quaternion.setFromUnitVectors(HF_FWD, r.dir);
      // 自旋（Hydra 出巢后高速旋转稳定）
      r.spin += dt * 30;
      r.g.rotateZ(r.spin);
      // 尾烟：白灰烟 + 火焰核心
      // phys1：按飞行距离吐烟——每 1.4u 一团，一帧最多 3 团沿弹道往回补（提速后尾烟不断成虚线）
      r.smoke -= r.vel * dt;
      for (let _s = 0; r.smoke <= 0 && _s < 3; _s++) {
        const back = -r.smoke, p = r.g.position;
        r.smoke += 1.4;
        const px = p.x - r.dir.x * back, py = p.y - r.dir.y * back, pz = p.z - r.dir.z * back;
        this._puff(px, py, pz, { color: 0xd8dde0, s0: 0.06, s1: 0.55, life: 0.55, base: 0.38 });
        if (_s === 0) this._puff(p.x, p.y, p.z, { color: 0xffb15a, s0: 0.06, s1: 0.2, life: 0.12, base: 0.8, add: true });
      }
      if (r.smoke < 0) r.smoke = 0;
    }

    // ---- 炮管后坐恢复 ----
    if (this.barrel) {
      this.barrel.position.z = -this._kick;
      if (this._kick > 1e-4) this._kick *= Math.exp(-17 * dt);
      else if (this.barrel.position.z !== 0) this.barrel.position.z = 0;
    }

    // ---- 曳光运动/衰减 + 靶标命中 ----
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.life -= dt;
      if (t.life <= 0) { t.m.visible = false; continue; }
      // 【分段推进（2026-09-15）：vel=260 后单帧位移 ~4.3u，逐帧"点测"会
      // 直接穿过小目标（无人机命中半径 0.85+1 → 直径 3.7u < 单帧步长）。
      // 按 ≤0.8u 切片、逐段判定、命中即止——每帧最多结算一次伤害，与旧语义一致。
      const stepLen = t.vel * dt;
      const segN = Math.min(12, Math.max(1, Math.ceil(stepLen / 0.8)));
      let consumed = false;
      for (let si = 0; si < segN && !consumed; si++) {
        t.m.position.addScaledVector(t.dir, stepLen / segN);
        // 空中目标命中（机炮对空：无人机/靶机/气球气球皮）
        if (this.airTargets && this.airTargets.enabled) {
          const ah = this.airTargets.hitTest(t.m.position, 1);
          if (ah) {
            t.m.visible = false;
            if (this.onHitMark) this.onHitMark();
            this._puff(t.m.position.x, t.m.position.y, t.m.position.z,
              { color: 0xffe9a8, s0: 0.12, s1: 0.5, life: 0.16, base: 0.85, add: true });
            consumed = true;
            break;
          }
        }
        // Phase 20-A：敌机命中（机炮 1/发——HP 8 需 8 发；对空曳光分段推进
        // 天然防穿隧，敌机 HIT_R 2.2 余量内必判）
        if (this.enemyAir && this.enemyAir.enabled) {
          const eh = this.enemyAir.hitTest(t.m.position, 1);
          if (eh) {
            t.m.visible = false;
            if (this.onHitMark) this.onHitMark();
            this._puff(t.m.position.x, t.m.position.y, t.m.position.z,
              { color: 0xffe9a8, s0: 0.14, s1: 0.55, life: 0.16, base: 0.85, add: true });
            consumed = true;
            break;
          }
        }
        // Phase 21：基地设施命中（机炮 1/发——雷达 hp2/防空车 hp3/弹药库 hp1；
        // hitTest 内按 radius 限域，只在基地扇区生效）
        if (this.narrative && this.narrative.enabled) {
          const nh = this.narrative.hitTest(t.m.position, 1);
          if (nh) {
            t.m.visible = false;
            if (this.onHitMark) this.onHitMark();
            this._puff(t.m.position.x, t.m.position.y, t.m.position.z,
              { color: 0xffe9a8, s0: 0.14, s1: 0.55, life: 0.16, base: 0.85, add: true });
            consumed = true;
            break;
          }
        }
        // 命中检测：按目标材质分型表现 ——
        //   装甲（坦克）:钢芯弹跳飞，火花四溅+尘圈（未穿甲观感）
        //   油桶:每次命中都窜起火光（燃料易燃）
        //   卡车:尘土+金属闪
        if (this.targets && this.targets.enabled) {
          const hitT = this.targets.hitTest(t.m.position, 1);
          if (hitT) {
            t.m.visible = false;
            // 玩法批 C/D：打在城镇建筑/峡谷岩壁上不亮命中标记（那是掩体，不是目标）
            if (this.onHitMark && hitT.type !== 'building' && hitT.type !== 'rock') this.onHitMark();
            const p = t.m.position;
            if (hitT.type === 'tank') {
              this._puff(p.x, p.y, p.z, { color: 0xffe9a8, s0: 0.10, s1: 0.45, life: 0.14, base: 0.9, add: true });
              this._puff(p.x, p.y, p.z, { color: 0xd8d2c4, s0: 0.10, s1: 0.35, life: 0.22, base: 0.45 });
            } else if (hitT.type === 'barrel') {
              this._puff(p.x, p.y, p.z, { color: 0xffb054, s0: 0.20, s1: 0.8, life: 0.20, base: 0.85, add: true });
            } else {
              this._puff(p.x, p.y, p.z, { color: 0xffd28a, s0: 0.12, s1: 0.5, life: 0.16, base: 0.8, add: true });
              this._puff(p.x, p.y, p.z, { color: 0x9a8f7c, s0: 0.12, s1: 0.45, life: 0.25, base: 0.4 });
            }
            consumed = true;
            break;
          }
        }
        // P5-G2 敌方步兵（27-infantry）：30mm 一发倒地
        if (this.onInfantryHit && this.onInfantryHit(t.m.position)) {
          t.m.visible = false;
          if (this.onHitMark) this.onHitMark();
          consumed = true;
          break;
        }
        // 打进远景树林（31-scenery）：飞叶 + 摇晃，挨够子弹倒下
        if (this.onTreeHit && this.onTreeHit(t.m.position, t.dir)) {
          t.m.visible = false;
          consumed = true;
          break;
        }
        // 触地
        if (t.m.position.y <= 0.05) {
          this._puff(t.m.position.x, 0.08, t.m.position.z,
            { color: 0x9a8f7c, s0: 0.12, s1: 0.5, life: 0.3, base: 0.35, rise: 0.25 });
          t.m.visible = false;
          consumed = true;
          break;
        }
      }
      // 曳光管全程燃烧（材质为池内共享，不做逐弹淡出）
    }

    // ---- 炮口焰衰减 ----
    for (const f of this.flashes) {
      if (!f.m.visible) continue;
      f.life -= dt;
      if (f.life <= 0) { f.m.visible = false; continue; }
      f.m.material.opacity = f.life / 0.055 * 0.95;
    }

    // ---- 地狱火飞行 ----
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      // 比例导引：激光/雷达持续修正航向（目标存活时每秒收敛 ~90%，
      // 弹道先直飞后弧线追目标——被其他火力击毁的目标自动转入直飞）
      if (f.tgt && f.tgt.alive) {
        // 地面靶标的 pos.y 是底座（0），要抬到车体中线 0.9；空中目标的 pos
        // 本身就是实时世界坐标，直接用——照抄 0.9 会把导弹一路压向地面。
        const p = f.tgt.pos;
        const to = (f.air ? _HF_TO.set(p.x, p.y, p.z)
                          : _HF_TO.set(p.x, 0.9, p.z)).sub(f.g.position).normalize();
        f.dir.lerp(to, Math.min(1, dt * 4.5)).normalize();   // phys1：弹速提高后导引加快，转弯半径不变大
      }
      // phys1：AGM-114 实弹约 425m/s（1.3 倍音速）≈187u/s；取 150u/s（约 340m/s），
      // 离轨后约 1 秒加到巡航。旧值 34u/s（77m/s）像慢悠悠的无人机
      f.v += (150 - f.v) * dt * 2.6;
      const _hfLen = f.v * dt, _hfN = Math.max(1, Math.ceil(_hfLen / 1.5));
      let _hfHit = false;
      for (let _k = 0; _k < _hfN && !_hfHit; _k++) {
      f.g.position.addScaledVector(f.dir, _hfLen / _hfN);
      // 命中检测：地狱火威力大（一发毁任何地面靶标）
      if (this.targets && this.targets.hitTest(f.g.position, 3)) {
        this.explosion(f.g.position.x, f.g.position.y, f.g.position.z, 3);
        this.scene.remove(f.g);
        this.flying.splice(i, 1);
        _hfHit = true; break;
      }
      // 空中目标掠过命中（大威力对气球/靶机同样是毁灭性的一击）。
      // 余量 0.6：弹速 34u/s，逐帧步进 ~0.55u，零余量会在两帧间穿过小目标。
      if (this.airTargets && this.airTargets.enabled && this.airTargets.hitTest(f.g.position, 3, 0.6)) {
        this.explosion(f.g.position.x, f.g.position.y, f.g.position.z, 3);
        this.scene.remove(f.g);
        this.flying.splice(i, 1);
        _hfHit = true; break;
      }
      // Phase 20-A：敌机命中（地狱火 3 伤——标准 3 发击落；比例导引对规避
      // 机动敌机同样有效——导引转向率 0.95 远高于敌机机动率）
      if (this.enemyAir && this.enemyAir.enabled && this.enemyAir.hitTest(f.g.position, 3, 0.6)) {
        this.explosion(f.g.position.x, f.g.position.y, f.g.position.z, 3);
        this.scene.remove(f.g);
        this.flying.splice(i, 1);
        _hfHit = true; break;
      }
      // Phase 21：基地设施命中（地狱火 3 伤——雷达/弹药库一发毁、防空车一发毁；
      // hitTest 内按 radius 限域，只在基地扇区生效）
      if (this.narrative && this.narrative.enabled && this.narrative.hitTest(f.g.position, 3)) {
        this.explosion(f.g.position.x, f.g.position.y, f.g.position.z, 3);
        this.scene.remove(f.g);
        this.flying.splice(i, 1);
        _hfHit = true; break;
      }
      }
      if (_hfHit) continue;
      // 弹体朝向逐帧对齐飞行方向（比例导引会让 dir 转向，弹体外观必须跟随）
      f.g.quaternion.setFromUnitVectors(HF_FWD, f.dir);
      f.smoke -= dt * Math.max(1, f.v / 34);   // phys1：按飞行距离吐烟
      if (f.smoke <= 0 && f.t < 2.6) {
        f.smoke = 0.028;
        const r = f.g.position;
        this._puff(r.x, r.y, r.z, { color: 0xcfd6da, s0: 0.06, s1: 0.5, life: 0.6, base: 0.30 });
        this._puff(r.x - f.dir.x * 0.4, r.y - f.dir.y * 0.4, r.z - f.dir.z * 0.4,
          { color: 0xffb15a, s0: 0.10, s1: 0.28, life: 0.18, base: 0.85, add: true });
      }
      if (f.t > 5.2) {                         // 飞出视界后回收（模板复用，只移除不销毁）
        // 【射程修正（2026-09-15）】原上限 3.2s、巡航 34u/s ⇒ 航程 ≈100u，
        // 实测 120u 处的空中目标"锁得上但永远打不到"（导弹半途回收）。
        // 现 5.2s ⇒ 航程 ≈150u，与机炮曳光（156u）同一交战包线。
        // 并发上限由挂载数决定（hfAmmo ≤ 8），不构成性能负担。
        this.scene.remove(f.g);
        this.flying.splice(i, 1);
      }
    }

    // ---- 破片：抛射 + 重力 + 翻滚，落地停留至寿命结束 ----
    for (const f of this.frags) {
      if (!f.m.visible) continue;
      f.t += dt;
      if (f.t >= f.life) { f.m.visible = false; continue; }
      if (!f.rest) {
        f.v.y -= G_U * dt;   // phys1 统一真实重力
        f.m.position.addScaledVector(f.v, dt);
        // phys2 落地：按实际地面高度（沙丘/峡谷不再悬空或埋进地里）；
        //   砸地快的弹一下（保留 25% 竖直速度、水平摩擦掉一半、翻滚减慢），慢了就停住
        const gy = this._groundH(f.m.position.x, f.m.position.z) + 0.05;
        if (f.m.position.y <= gy) {
          f.m.position.y = gy;
          if (f.v.y < -1.6) { f.v.y *= -0.25; f.v.x *= 0.5; f.v.z *= 0.5; f.w.multiplyScalar(0.5); }
          else { f.v.set(0, 0, 0); f.w.multiplyScalar(0.1); f.rest = true; }
        }
      }
      f.m.rotation.x += f.w.x * dt;
      f.m.rotation.y += f.w.y * dt;
      f.m.rotation.z += f.w.z * dt;
      // 寿命尾段缩小消隐
      const tail = f.t / f.life;
      if (tail > 0.75) f.m.scale.setScalar(Math.max(0.01, (1 - tail) / 0.25));
    }

    // ---- 冲击波环：快速扩张 + 淡出 ----
    for (const s of this.shocks) {
      if (!s.m.visible) continue;
      s.t += dt;
      const k = s.t / 0.5;
      if (k >= 1) { s.m.visible = false; continue; }
      s.m.scale.setScalar(0.5 + (1 - (1 - k) * (1 - k)) * 7.5);   // 先快后慢（气浪减速）
      s.m.material.opacity = 0.6 * (1 - k) * (1 - k);
    }

    // ---- 烟尘 ----
    for (const p of this.puffs) {
      if (!p.m.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      const k = p.life / p.life0;
      p.m.position.y += p.rise * dt;
      const s = p.s0 + (p.s1 - p.s0) * (1 - k);
      p.m.scale.setScalar(s);
      p.m.material.opacity = p.base * (p.lin ? k * Math.min(1, (1 - k) * 6) : k * k);   // lin：先快速浮现再线性淡出
      p.m.quaternion.copy(cam.quaternion);
    }
  }
}
