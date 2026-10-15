// ============================================================
// 16-course.js — 1-1 首飞：航点圈 + 悬停区 + 降落标（P3，2026-10-13）
// ============================================================
// FlightCourse(scene)：3 个立式航点圈（悬停高度 14u 上）→ 地面悬停区（圈内
// 稳住 10s）→ 回停机坪降落。只在 train_flight 关卡局激活（70-mission
// _tickMissionMaps 纯派生 setActive）；未激活时零 draw、update 早退。
// 判定只读传入的 heli 位置与飞行状态（不碰 FLY/S），纯逻辑部分可 node 驱动。
//   stage 0..2 = 待穿第 n 个圈；3 = 悬停区；4 = 回场降落；5 = 完成
// ============================================================

const COURSE = {
  RINGS: [[0, 14, 22], [-20, 14, 38], [16, 14, 52]],  // 飞行边界 ±58u 内   // 圈心（x, y, z）——机头 +Z 起飞，一左一右蛇形
  RING_R: 3.4,                                         // 穿圈判定半径（3D 距离）
  HOVER_ZONE: { x: -12, z: 22, r: 5.5, alt0: 7, alt1: 22, need: 10 },
  PAD: { x: 0, z: 0, r: 6 },
};

class FlightCourse {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.rings = COURSE.RINGS.map(([x, y, z], i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xf0c46a, transparent: true, opacity: 0.85, depthWrite: false });
      const tor = new THREE.Mesh(new THREE.TorusGeometry(COURSE.RING_R, 0.14, 8, 48), mat);
      g.add(tor);
      // 四角刻线（MFD 风格瞄准框味道）
      const tickMat = new THREE.MeshBasicMaterial({ color: 0xf0c46a, transparent: true, opacity: 0.85, depthWrite: false });
      for (let k = 0; k < 4; k++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), tickMat);
        const a = k * Math.PI / 2;
        t.position.set(Math.cos(a) * (COURSE.RING_R + 0.6), Math.sin(a) * (COURSE.RING_R + 0.6), 0);
        t.rotation.z = a + Math.PI / 2;
        g.add(t);
      }
      // 竖直引导光柱（远处也能看见下一个圈在哪）
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, y, 6),
        new THREE.MeshBasicMaterial({ color: 0xf0c46a, transparent: true, opacity: 0.25, depthWrite: false }));
      beam.position.y = -y / 2;
      g.add(beam);
      g.position.set(x, y, z);
      // 圈面朝向：对准上一个点（第一个圈对准原点）
      const prev = i === 0 ? [0, y, 0] : COURSE.RINGS[i - 1];
      g.rotation.y = Math.atan2(x - prev[0], z - prev[2]);
      this.root.add(g);
      return { g, mat, tickMat, beam, x, y, z };
    });
    // 悬停区：地面圆环 + 半透明柱体
    const HZ = COURSE.HOVER_ZONE;
    this.zoneMat = new THREE.MeshBasicMaterial({ color: 0x9fd4b8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    this.zone = new THREE.Mesh(new THREE.CylinderGeometry(HZ.r, HZ.r, HZ.alt1 - HZ.alt0, 32, 1, true), this.zoneMat);
    this.zone.position.set(HZ.x, (HZ.alt0 + HZ.alt1) / 2, HZ.z);
    this.root.add(this.zone);
    this.zoneRing = new THREE.Mesh(new THREE.RingGeometry(HZ.r - 0.25, HZ.r, 48),
      new THREE.MeshBasicMaterial({ color: 0x9fd4b8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.zoneRing.rotation.x = -Math.PI / 2;
    this.zoneRing.position.set(HZ.x, 0.05, HZ.z);
    this.root.add(this.zoneRing);
    // 降落标：停机坪 H 圈
    this.padRing = new THREE.Mesh(new THREE.RingGeometry(COURSE.PAD.r - 0.3, COURSE.PAD.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xf0c46a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.padRing.rotation.x = -Math.PI / 2;
    this.padRing.position.set(COURSE.PAD.x, 0.06, COURSE.PAD.z);
    this.root.add(this.padRing);
    this.onStage = null;          // 阶段切换回调（app 注入：toast/播报）
    this.reset();
  }
  reset() {
    this.stage = 0; this.hoverT = 0; this.done = false; this._pulse = 0;
    this._sync();
  }
  setActive(on) {
    this.active = !!on;
    this.root.visible = this.active;
    if (on) this.reset();
  }
  get ringsPassed() { return Math.min(3, this.stage); }
  // 纯判定：heli = {x,y,z}，state = FLY.state
  step(dt, heli, state) {
    if (!this.active || this.done) return;
    const prev = this.stage;
    if (this.stage < 3) {
      const r = this.rings[this.stage];
      if (Math.hypot(heli.x - r.x, heli.y - r.y, heli.z - r.z) < COURSE.RING_R) this.stage++;
    } else if (this.stage === 3) {
      const HZ = COURSE.HOVER_ZONE;
      const inZ = Math.hypot(heli.x - HZ.x, heli.z - HZ.z) < HZ.r && heli.y > HZ.alt0 && heli.y < HZ.alt1;
      this.hoverT = inZ ? this.hoverT + dt : 0;          // 出圈清零：必须连续稳住
      if (this.hoverT >= HZ.need) this.stage = 4;
    } else if (this.stage === 4) {
      if (state === 'ground' && Math.hypot(heli.x - COURSE.PAD.x, heli.z - COURSE.PAD.z) < COURSE.PAD.r) {
        this.stage = 5; this.done = true;
      }
    }
    if (this.stage !== prev) { this._sync(); if (this.onStage) this.onStage(this.stage); }
  }
  // 视觉：当前目标高亮脉冲，已过/未到的变暗
  update(dt) {
    if (!this.active) return;
    this._pulse += dt;
    const p = 0.65 + 0.35 * Math.sin(this._pulse * 4);
    this.rings.forEach((r, i) => {
      if (i === this.stage) { r.mat.opacity = p; r.tickMat.opacity = p; r.g.scale.setScalar(1 + 0.04 * Math.sin(this._pulse * 4)); }
    });
    if (this.stage === 3) this.zoneMat.opacity = 0.10 + 0.08 * p;
    if (this.stage === 4) this.padRing.material.opacity = p;
  }
  _sync() {
    this.rings.forEach((r, i) => {
      const passed = i < this.stage, cur = i === this.stage;
      r.g.visible = !passed;
      r.mat.color.setHex(cur ? 0xf0c46a : 0x8a9a92);
      r.tickMat.color.setHex(cur ? 0xf0c46a : 0x8a9a92);
      r.mat.opacity = r.tickMat.opacity = cur ? 0.9 : 0.35;
      r.beam.visible = cur;
      r.g.scale.setScalar(1);
    });
    this.zone.visible = this.zoneRing.visible = this.stage === 3;
    this.zoneMat.opacity = 0.12;
    this.padRing.visible = this.stage >= 4;
  }
  // 当前引导点（HUD 箭头/面板用）
  target() {
    if (this.stage < 3) { const r = this.rings[this.stage]; return { x: r.x, y: r.y, z: r.z, label: '航点 ' + (this.stage + 1) }; }
    if (this.stage === 3) return { x: COURSE.HOVER_ZONE.x, y: 14, z: COURSE.HOVER_ZONE.z, label: '悬停区' };
    return { x: COURSE.PAD.x, y: 0, z: COURSE.PAD.z, label: '停机坪' };
  }
}
