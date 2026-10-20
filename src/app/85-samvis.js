// ============================================================
// 85-samvis.js — SAM 导弹/干扰弹 渲染薄层（Phase 19）
// ============================================================
// 只做视觉：导弹池（弹身+弹头+尾焰+尾烟）与单发干扰弹（亮珠+辉光），每帧从
// 84-samwar 的 plain 状态直接镜像到网格——不持有任何逻辑。对象池预分配，
// 全程零每帧分配（模块级 _svFwd/_svDir/_svQ 复用）；不投影（贴身小件，
// P10 教训：小件 castShadow 只喂阴影 pass）。
// 拓扑：本文件（85）不引用低编号符号（自包含，含自制辉光贴图）；
// 70-app 经宿主工厂槽 HOST.makeSamVis() 取用。
// ============================================================

// 自制径向辉光贴图（不借用 65-weapons 的 makeGlowTex——避免新增跨文件边）
function _svGlowTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,210,150,0.55)');
  g.addColorStop(1, 'rgba(255,180,90,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// opt1（2026-10-20）：导弹灰白尾烟——自带预分配烟团池（不借 65-weapons 的 _puff 池，
// 守"零每帧分配"纪律）。每发导弹 0.06s 落一团，1.5s 内放大变淡；池满按环形覆盖最旧的。
function _svSmokeTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(235,235,232,0.85)');
  g.addColorStop(0.55, 'rgba(210,210,206,0.35)');
  g.addColorStop(1, 'rgba(200,200,196,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SV_SMOKE_N = 72, SV_SMOKE_LIFE = 1.5, SV_SMOKE_DT = 0.06;

const _svFwd = new THREE.Vector3(0, 0, 1);
const _svDir = new THREE.Vector3();
const _svQ = new THREE.Quaternion();

class SamVis {
  constructor(scene, samwar) {
    this.samwar = samwar;
    this.glow = _svGlowTex();

    // ---- 导弹池 ×3（与 84 的导弹池等长；弹身沿 +Z，quaternion 对齐飞行向）----
    const bodyGeo = new THREE.CylinderGeometry(0.075, 0.075, 1.35, 8);
    const noseGeo = new THREE.ConeGeometry(0.075, 0.22, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.5, metalness: 0.3 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x8c9298, roughness: 0.3, metalness: 0.4 });
    const flameMat = new THREE.SpriteMaterial({ map: this.glow, color: 0xffc27a,
      transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.missiles = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(noseGeo, noseMat);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.78;
      const flame = new THREE.Sprite(flameMat);
      flame.position.z = -0.85;
      flame.scale.set(0.85, 0.55, 1);
      g.add(body, nose, flame);
      g.visible = false;
      g.renderOrder = 8;
      scene.add(g);
      this.missiles.push(g);
    }

    // ---- 尾烟池（opt1）：每团独立材质才能各自变淡；全部构造期建好 ----
    const smokeTex = _svSmokeTex();
    this.smoke = [];
    for (let i = 0; i < SV_SMOKE_N; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdedcd6,
        transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false; sp.renderOrder = 7; sp.userData.t = 0;
      scene.add(sp);
      this.smoke.push(sp);
    }
    this._smkIdx = 0; this._smkAcc = [0, 0, 0]; this._lastT = null;

    // ---- 干扰弹（84 同一时间只有一发在空中）：亮珠 + 辉光，脉动衰减 ----
    const flareMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, fog: false });
    this.flare = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), flareMat);
    this.flareGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffd9a0,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.flareGlow.scale.set(1.1, 1.1, 1);
    const fg = new THREE.Group();
    fg.add(this.flare, this.flareGlow);
    fg.visible = false;
    fg.renderOrder = 9;
    scene.add(fg);
    this.flareG = fg;
  }

  // 每帧：镜像 84 的 plain 状态（位置/朝向/可见性）——零分配
  update(time) {
    const sw = this.samwar;
    if (!sw) return;
    // 由游戏时间推 dt（上限 0.1s，防切后台回来一帧落满烟）
    const dt = this._lastT == null ? 0 : Math.min(0.1, Math.max(0, time - this._lastT));
    this._lastT = time;
    for (let i = 0; i < this.missiles.length; i++) {
      const m = sw.missiles[i];
      const g = this.missiles[i];
      if (!m || !m.on) { if (g.visible) g.visible = false; this._smkAcc[i] = 0; continue; }
      g.visible = true;
      g.position.set(m.x, m.y, m.z);
      _svDir.set(m.dx, m.dy, m.dz);
      _svQ.setFromUnitVectors(_svFwd, _svDir);
      g.quaternion.copy(_svQ);
      // 尾烟：弹尾后方 0.9u 处落烟团（按游戏时间节拍，帧率无关）
      this._smkAcc[i] += dt;
      while (this._smkAcc[i] >= SV_SMOKE_DT) {
        this._smkAcc[i] -= SV_SMOKE_DT;
        const sp = this.smoke[this._smkIdx];
        this._smkIdx = (this._smkIdx + 1) % SV_SMOKE_N;
        sp.position.set(m.x - m.dx * 0.9, m.y - m.dy * 0.9, m.z - m.dz * 0.9);
        sp.userData.t = 0; sp.visible = true;
      }
    }
    // 烟团老化：放大 + 变淡，寿命到即隐藏
    for (let k = 0; k < SV_SMOKE_N; k++) {
      const sp = this.smoke[k];
      if (!sp.visible) continue;
      const t = (sp.userData.t += dt);
      if (t >= SV_SMOKE_LIFE) { sp.visible = false; continue; }
      const u = t / SV_SMOKE_LIFE;
      const sc = 0.45 + u * 1.5;
      sp.scale.set(sc, sc, 1);
      sp.material.opacity = 0.7 * (1 - u) * (1 - u);
    }
    const fl = sw._flare;
    const on = !!(fl && fl.on);
    this.flareG.visible = on;
    if (on) {
      this.flareG.position.set(fl.x, fl.y, fl.z);
      // 尾段脉动衰减（生命尾 20% 闪灭，视觉上"烧完"）
      const k = 1 - fl.t / 2.2;
      const pulse = k < 0.2 ? (Math.sin(time * 40) > 0 ? 1 : 0.2) : 1;
      const s = (0.7 + 0.5 * k) * pulse;
      this.flareGlow.scale.set(1.1 * s, 1.1 * s, 1);
    }
  }

  // 场地切换/重置时隐藏全部视觉（状态由 84 清，这里只兜底隐藏网格）
  clearVisual() {
    for (const g of this.missiles) g.visible = false;
    this.flareG.visible = false;
    for (const sp of this.smoke) sp.visible = false;
    this._smkAcc[0] = this._smkAcc[1] = this._smkAcc[2] = 0;
  }

  // 只读遥测（__dbg.samvis.state()）
  state() {
    return {
      missiles: this.missiles.reduce((n, g) => n + (g.visible ? 1 : 0), 0),
      flare: this.flareG.visible,
    };
  }
}

HOST.makeSamVis = (scene, samwar) => new SamVis(scene, samwar);
