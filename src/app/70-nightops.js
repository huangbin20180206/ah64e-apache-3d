// ============================================================
// 70-nightops.js — 夜战工具：热成像 FLIR（O 键）+ 照明弹（Y 键）（P5-G3，2026-10-16）
// ============================================================
// 热成像：后期合成里把画面转成单色"白热"图像（40-post uThermal），同时给"有热量"
// 的东西临时加白色自发光——活着的车辆（发动机热）、敌方步兵（人体）、空中目标、
// 敌机、基地设施；于是背景发灰发暗，热目标发白发亮，夜里也一眼能找到人和车。
// 关闭时把改过的材质原样还原。每 0.5 秒重新扫描一次（被击毁的车辆自然"变冷"）。
// 照明弹：从机头前上方射出，升到顶点点燃，挂伞缓慢下落约 25 秒，用一盏常驻点光源
// （空闲亮度 0，不增删 → 不重编材质）照亮周围几十米。每局 4 发，新任务补满。
// 同前缀 70-* 互为同级，可直接用 70-app 的 composer/targets/infantry/air/enemyVis/narrative。
// ============================================================

const NIGHT = { flir: false, scan: 0, mats: new Map(), flares: 4, fl: null };

function _flirCss() {
  if (document.getElementById('p5-flir-css')) return;
  const st = document.createElement('style');
  st.id = 'p5-flir-css';
  st.textContent = 'body.p5-flir::after{content:"FLIR  ·  WHT";position:fixed;top:64px;left:50%;transform:translateX(-50%);' +
    'font:600 13px/1 monospace;letter-spacing:3px;color:#d8ffd8;text-shadow:0 0 6px #6f6;pointer-events:none;z-index:39;opacity:.85}';
  document.head.appendChild(st);
}

function setFlir(on) {
  NIGHT.flir = !!on;
  _flirCss();
  document.body.classList.toggle('p5-flir', NIGHT.flir);
  if (composer) composer.thermal = NIGHT.flir ? 1 : 0;
  NIGHT.scan = 0;
  if (!NIGHT.flir) _flirRestore();
  toast(NIGHT.flir ? '热成像开启（白色 = 热：人、车、发动机）—— 再按 O 关闭' : '热成像关闭');
}

function _flirHeat(obj, heat, seen) {
  if (!obj) return;
  obj.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m || !m.emissive || seen.has(m)) continue;
      seen.add(m);
      if (m.userData._bk === undefined) m.userData._bk = m.emissive.getHex();   // 16-targets flashHit 的还原值先记原色
      if (!NIGHT.mats.has(m)) NIGHT.mats.set(m, { e: m.emissive.getHex(), i: m.emissiveIntensity, map: m.emissiveMap || null });
      m.emissive.setRGB(1, 1, 1);
      m.emissiveMap = null;
      m.emissiveIntensity = heat;
    }
  });
}

function _flirRestore(keep) {
  for (const [m, b] of NIGHT.mats) {
    if (keep && keep.has(m)) continue;
    m.emissive.setHex(b.e); m.emissiveIntensity = b.i; m.emissiveMap = b.map;
    NIGHT.mats.delete(m);
  }
}

function _flirScan() {
  const seen = new Set();
  if (targets) for (const t of targets.targets) if (t.alive && t.group.visible) _flirHeat(t.group, 1.6, seen);
  if (infantry && infantry.meshes) for (const k in infantry.meshes) {
    const im = infantry.meshes[k];
    if (im.visible) _flirHeat(im, k === 'dead' ? 1.2 : 2.2, seen);
  }
  if (air) for (const a of air.list) if (a.alive && a.g.visible) _flirHeat(a.g, 1.8, seen);
  if (enemyVis && enemyVis.units) for (const u of enemyVis.units) if (u.g.visible) _flirHeat(u.g, 2.0, seen);
  if (narrative && narrative.group && narrative.group.visible) _flirHeat(narrative.group, 0.45, seen);
  _flirRestore(seen);    // 本轮不再"热"的（被击毁/隐藏）还原
}

// 照明弹
function _flareInit() {
  if (NIGHT.fl || !W || !W.scene) return;
  const light = new THREE.PointLight(0xfff1d6, 0, 85, 2);
  light.castShadow = false;
  W.scene.add(light);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff6e0, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false, map: scorchGlowTex() }));
  sp.scale.set(2.2, 2.2, 1); sp.visible = false;
  W.scene.add(sp);
  const chute = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 4, 0, TAU, 0, PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.9, side: THREE.DoubleSide }));
  chute.visible = false;
  W.scene.add(chute);
  NIGHT.fl = { light, sp, chute, on: false, ph: 'up', p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, smk: 0 };
}

let _glowTex = null;
function scorchGlowTex() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.8)');
  gr.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function launchFlare() {
  _flareInit();
  const F = NIGHT.fl;
  if (!F || !apache) return;
  if (F.on) { toast('上一发照明弹还在燃烧'); return; }
  if (NIGHT.flares <= 0) { toast('照明弹已用完（新任务补满）'); return; }
  NIGHT.flares--;
  const hp = apache.root.position;
  const fx = Math.sin(FLY.yaw), fz = Math.cos(FLY.yaw);
  F.p.set(hp.x + fx * 2, hp.y + 0.8, hp.z + fz * 2);
  F.v.set(fx * 9, 13, fz * 9);
  F.ph = 'up'; F.t = 0; F.on = true; F.smk = 0;
  F.sp.visible = false; F.chute.visible = false;
  if (audio) audio.playSfx('rocket', 1);
  toast('照明弹发射——剩余 ' + NIGHT.flares + ' 发');
}

function _tickNightOps(dt) {
  if (NIGHT.flir) {
    NIGHT.scan -= dt;
    if (NIGHT.scan <= 0) { NIGHT.scan = 0.5; _flirScan(); }
  }
  const F = NIGHT.fl;
  if (!F || !F.on) return;
  F.t += dt;
  if (F.ph === 'up') {
    F.v.y -= G_U * dt;   // phys1：旧值 9.8 是按"米"算的，本项目 1 单位=2.27 米 → 重了 2.3 倍
    F.v.x *= 1 - dt * 0.6; F.v.z *= 1 - dt * 0.6;
    F.p.addScaledVector(F.v, dt);
    F.smk -= dt;
    if (F.smk <= 0 && rig) { F.smk = 0.06; rig._puff(F.p.x, F.p.y, F.p.z, { color: 0xd0c8bc, s0: 0.12, s1: 0.5, life: 0.9, base: 0.35, rise: 0.05 }); }
    if (F.v.y <= 0) { F.ph = 'burn'; F.t = 0; F.sp.visible = true; F.chute.visible = true; }
  } else {
    // 挂伞下落 0.55u/s，随风轻飘；最后 3 秒熄灭
    F.p.y -= 0.55 * dt;
    F.p.x += Math.sin(F.t * 0.4) * 0.12 * dt;
    const life = 25, fade = Math.max(0, Math.min(1, (life - F.t) / 3)), ign = Math.min(1, F.t / 0.4);
    const k = fade * ign * (0.88 + rnd() * 0.24);
    F.light.intensity = 900 * k;
    F.sp.material.opacity = k;
    F.sp.scale.setScalar(1.6 + 0.8 * k);
    F.smk -= dt;
    if (F.smk <= 0 && rig) { F.smk = 0.35; rig._puff(F.p.x, F.p.y + 0.2, F.p.z, { color: 0xb8b2a8, s0: 0.25, s1: 1.1, life: 3.5, base: 0.25, rise: 0.15 }); }
    if (F.t > life || F.p.y < 0.5) {
      F.on = false; F.light.intensity = 0; F.sp.visible = false; F.chute.visible = false;
    }
  }
  F.light.position.copy(F.p);
  F.sp.position.copy(F.p);
  F.chute.position.set(F.p.x, F.p.y + 0.9, F.p.z);
}

function resetNightOps() {
  NIGHT.flares = 4;
  const F = NIGHT.fl;
  if (F) { F.on = false; F.light.intensity = 0; F.sp.visible = false; F.chute.visible = false; }
}
