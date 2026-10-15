// ============================================================
// 85-samvis.js — SAM 导弹/干扰弹 渲染薄层（Phase 19）
// ============================================================
// 只做视觉：导弹池（弹身+弹头+尾焰）与单发干扰弹（亮珠+辉光），每帧从
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
    for (let i = 0; i < this.missiles.length; i++) {
      const m = sw.missiles[i];
      const g = this.missiles[i];
      if (!m || !m.on) { if (g.visible) g.visible = false; continue; }
      g.visible = true;
      g.position.set(m.x, m.y, m.z);
      _svDir.set(m.dx, m.dy, m.dz);
      _svQ.setFromUnitVectors(_svFwd, _svDir);
      g.quaternion.copy(_svQ);
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
