// ============================================================
// 50-controls.js — 球面轨道控制器 + 机位预设
// ============================================================

// Phase 19 性能审计 A7：_pan 拖拽路径 scratch（pointermove 事件率 60-120/s，
// 原每次事件 new 2 个 Vector3）——单线程同步顺序使用无重入
const _panR = new THREE.Vector3();
const _panU = new THREE.Vector3();

class Orbit {
  constructor(cam, dom) {
    this.cam = cam;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 1.1, 0);
    this.tTarget = this.target.clone();
    this.theta = 0.72; this.tTheta = 0.72;   // 方位角
    this.phi = 1.16; this.tPhi = 1.16;       // 极角（从 +Y 起算）
    this.dist = 13.5; this.tDist = 13.5;
    this.damping = 0.12;
    this.minDist = 2.4; this.maxDist = 90;
    this.minPhi = 0.08; this.maxPhi = 1.545;
    this.auto = false;
    this.autoSpeed = 0.055;
    this.fly = null;
    this._ptr = new Map();
    this._last = null;
    this._pinch = 0;
    this.enabled = true;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      d.setPointerCapture(e.pointerId);
      this._ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button });
      this._last = { x: e.clientX, y: e.clientY };
      if (this._ptr.size === 2) this._pinch = this._pinchDist();
      this.auto = false;
      this.fly = null;
    });
    d.addEventListener('pointermove', e => {
      if (!this._ptr.has(e.pointerId)) return;
      const p = this._ptr.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;

      if (this._ptr.size === 2) {
        const nd = this._pinchDist();
        if (this._pinch > 0) this.zoom(this._pinch / Math.max(nd, 1));
        this._pinch = nd;
        return;
      }
      const shift = e.shiftKey || p.btn === 1 || p.btn === 2;
      if (shift) this._pan(dx, dy);
      else {
        this.tTheta -= dx * 0.0062;
        this.tPhi = clamp(this.tPhi - dy * 0.0062, this.minPhi, this.maxPhi);
      }
    });
    const up = e => {
      this._ptr.delete(e.pointerId);
      if (this._ptr.size < 2) this._pinch = 0;
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('lostpointercapture', up);
    d.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0011));
      this.auto = false;
      this.fly = null;
    }, { passive: false });
    d.addEventListener('contextmenu', e => e.preventDefault());
  }

  _pinchDist() {
    const v = [...this._ptr.values()];
    return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
  }

  zoom(f) { this.tDist = clamp(this.tDist * f, this.minDist, this.maxDist); }

  // 沿相机右向量与上向量平移观察点
  _pan(dx, dy) {
    const k = this.tDist * 0.0016;
    const m = this.cam.matrixWorld.elements;
    const right = _panR.set(m[0], m[1], m[2]);
    const up = _panU.set(m[4], m[5], m[6]);
    this.tTarget.addScaledVector(right, -dx * k);
    this.tTarget.addScaledVector(up, dy * k);
    this.tTarget.y = clamp(this.tTarget.y, 0.1, 12);
  }

  // 缓动飞向机位预设
  flyTo(v, dur = 1.15) {
    const norm = a => {
      let d = (a - this.theta) % TAU;
      if (d > PI) d -= TAU;
      if (d < -PI) d += TAU;
      return this.theta + d;
    };
    this.fly = {
      t: 0, dur,
      f: {
        tgt: this.target.clone(), theta: this.theta, phi: this.phi, dist: this.dist,
        fov: this.cam.fov,
      },
      t2: {
        tgt: new THREE.Vector3(...v.target), theta: norm(v.theta),
        phi: clamp(v.phi, this.minPhi, this.maxPhi),
        dist: clamp(v.dist, this.minDist, this.maxDist),
        fov: v.fov || 34,
      },
    };
    this.auto = false;
  }

  update(dt) {
    if (this.fly) {
      const F = this.fly;
      F.t = Math.min(1, F.t + dt / F.dur);
      const e = easeInOut(F.t);
      this.tTarget.lerpVectors(F.f.tgt, F.t2.tgt, e);
      this.tTheta = lerp(F.f.theta, F.t2.theta, e);
      this.tPhi = lerp(F.f.phi, F.t2.phi, e);
      this.tDist = lerp(F.f.dist, F.t2.dist, e);
      const fov = lerp(F.f.fov, F.t2.fov, e);
      if (Math.abs(this.cam.fov - fov) > 1e-4) {
        this.cam.fov = fov;
        this.cam.updateProjectionMatrix();
      }
      // 飞行中直接同步，避免阻尼把缓动拖慢
      this.target.copy(this.tTarget);
      this.theta = this.tTheta; this.phi = this.tPhi; this.dist = this.tDist;
      if (F.t >= 1) this.fly = null;
    } else {
      if (this.auto) this.tTheta += this.autoSpeed * dt;
      const k = damp(this.damping, dt);
      this.target.lerp(this.tTarget, k);
      this.theta = lerp(this.theta, this.tTheta, k);
      this.phi = lerp(this.phi, this.tPhi, k);
      this.dist = lerp(this.dist, this.tDist, k);
    }

    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    this.cam.position.set(
      this.target.x + this.dist * sp * Math.sin(this.theta),
      this.target.y + this.dist * cp,
      this.target.z + this.dist * sp * Math.cos(this.theta)
    );
    // 别钻到地面下面去
    if (this.cam.position.y < 0.35) this.cam.position.y = 0.35;
    this.cam.lookAt(this.target);
  }
}

// 12 个机位。模型 +Z 是机头方向，theta 以 +Z 为 0 逆时针增大
const VIEWS = [
  { key: '1', name: '英雄视角', target: [0, 1.25, 0.2], theta: 0.78, phi: 1.19, dist: 12.6, fov: 34 },
  { key: '2', name: '正侧', target: [0, 1.15, 0.1], theta: PI / 2, phi: 1.50, dist: 12.0, fov: 30 },
  { key: '3', name: '正前', target: [0, 1.05, 1.6], theta: 0.02, phi: 1.47, dist: 10.4, fov: 32 },
  { key: '4', name: '顶视', target: [0, 1.0, 0.1], theta: 0.30, phi: 0.14, dist: 13.6, fov: 34 },
  { key: '5', name: '尾后', target: [0, 1.30, -3.0], theta: PI, phi: 1.36, dist: 8.6, fov: 34 },
  { key: '6', name: '座舱', target: [0, 1.35, 2.55], theta: 0.95, phi: 1.34, dist: 3.5, fov: 40 },
  { key: '7', name: '机炮', target: [0.05, 0.55, 3.15], theta: 0.55, phi: 1.50, dist: 2.2, fov: 40 },   // polish3：压低到炮口水平视线，炮管衬在亮地面上（原俯视一半画面是地砖）
  { key: '8', name: '桨毂', target: [0, 2.30, 1.56], theta: 1.05, phi: 1.02, dist: 3.2, fov: 38 },
  { key: '9', name: '龙弓雷达', target: [0, 2.75, 1.56], theta: 2.30, phi: 1.10, dist: 2.6, fov: 36 },
  { key: '0', name: '尾桨', target: [0.36, 2.30, -3.62], theta: 1.62, phi: 1.24, dist: 3.0, fov: 38 },
  { key: '-', name: '挂架', target: [1.35, 0.60, 1.70], theta: 1.15, phi: 1.32, dist: 3.9, fov: 38 },
  { key: '=', name: '起落架', target: [1.02, 0.35, 1.72], theta: 0.85, phi: 1.42, dist: 3.1, fov: 40 },
];

// P14-C：机位预设表注册进 HOST（46-fpview exit 平滑过渡经槽位取用——避免低编号
// 反向引用 50 的顶层符号，拓扑检查从 module-contracts 强制）
HOST.VIEWS = VIEWS;
