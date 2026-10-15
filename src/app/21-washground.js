// ============================================================
// 21-washground.js — 地面痕迹类：沙漠痕迹 / 沙脊吹雾 / 草屑碎片
// ============================================================
// 从 17-washfx.js 拆出（P0 重构）：这三个类负责"地面被吹了之后留下什么"——
// 沙漠吹蚀痕迹盖章（WashTracks）、沙脊贴地沙雾（DuneSandFX）、
// 草屑碎片实体（GrassDebrisFX）。依赖 00-utils 与 15-terrain（duneH）。
// 注意 setMedium 配对：离开所属场地必须清空粒子池（否则冻结残留）。
// ============================================================

// ============================================================
// DuneSandFX — 沙漠专属：贴地沙雾（实拍调研结论的实现）
// 风沙物理（Bagnold 跃移理论）：沙粒起动风速仅 ~5 m/s，旋翼下洗远超阈值；
// 沙丘脊线是迎风面沙粒翻越后滑落的松沙堆积处——气流一吹整片揭走。
// 旧版用纯色三角条带表现"成股的沙"——近景是硬边几何碎片，无雾感。
// 改为沿涡环粒子的柔和方法：小尺寸软精灵（复用 makeWashSprite 絮状贴图）
// 贴地浅层流动，远看是"沙被揭起一层雾"，近看无硬边。
// ============================================================
class DuneSandFX {
  constructor(scene, sprite) {
    this.scene = scene;
    this.MAX = 320;
    const geo = new THREE.BufferGeometry();
    this._pos = new Float32Array(this.MAX * 3);
    this._size = new Float32Array(this.MAX);
    this._alp = new Float32Array(this.MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this._size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlp', new THREE.BufferAttribute(this._alp, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: sprite },
        uCol: { value: new THREE.Color(0xd6bd92) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlp;
        varying float vA;
        void main(){
          vA = aAlp;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // 透视缩放：近处雾团大而柔，远处收成薄薄一层
          gl_PointSize = aSize * 340.0 / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uCol;
        varying float vA;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vA;
          if (!(a > 0.004)) discard;    // NaN 防护同涡环粒子
          gl_FragColor = vec4(uCol, a);
        }`,
    });
    this.mesh = new THREE.Points(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < this.MAX; i++) {
      this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, size: 1, a: 0 });
    }
    this._baseCol = new THREE.Color(0xd6bd92);   // 环境色调乘之前的本色
    this._acc = 0;
    this._quality = 1;
    this._activeMax = this.MAX;
  }

  setQuality(scale = 1) {
    this._quality = clamp(scale, 0.25, 1);
    this._activeMax = Math.max(1, Math.floor(this.MAX * this._quality));
    for (let i = this._activeMax; i < this.p.length; i++) this.p[i].alive = false;
  }

  // 环境联动：与涡环粒子同乘有效入射光（黄昏沙雾偏暖、夜间压暗）
  setLighting(light) {
    if (!light) return;
    this.mat.uniforms.uCol.value.copy(this._baseCol).multiply(light);
  }

  // 离开沙漠即清空（setMedium 配对逻辑；冻结粒子会残留原地）
  clear() {
    this.mesh.visible = false;
    this.geo.setDrawRange(0, 0);
    this._acc = 0;
    for (const d of this.p) d.alive = false;
  }

  update(dt, s, alt, hx, hz, wx, wz) {
    // 发射试探：雾粒比沙片更密（成雾靠数量），只在沙丘凸起处揭起
    // （平地的扬沙交给涡环粒子层）。实测 h>0.45 正峰太稀疏，阈值取 0.12
    if (s > 0.15 && alt < 9) {
      this._acc += dt * s * 55;
      while (this._acc >= 1) {
        this._acc -= 1;
        const a = rnd(TAU), rr = 7.2 + rnd(5.8);
        const px = hx + Math.cos(a) * rr, pz = hz + Math.sin(a) * rr;
        const h = duneH(px, pz);
        if (h < 0.12) continue;
        const slot = this.p.find((d, i) => i < this._activeMax && !d.alive);
        if (!slot) break;
        slot.alive = true;
        slot.x = px; slot.z = pz;
        slot.y = h + rnd(0.06, 0.45);
        // 浅层流动：外抛速度温和 + 风推，没有弹道抛物线（那是沙片时代的语言）
        const rd = 1 + h * 0.8;
        slot.vx = (px - hx) / rr * rnd(1.2, 2.8) * rd + wx * 1.2;
        slot.vz = (pz - hz) / rr * rnd(1.2, 2.8) * rd + wz * 1.2;
        slot.vy = rnd(0.15, 0.55);
        slot.t = 0;
        slot.life = rnd(1.6, 3.2);
        slot.size = rnd(0.55, 1.30);
      }
    }
    let n = 0;
    for (const d of this.p) {
      if (!d.alive) continue;
      d.t += dt;
      // 贴地浅层：升到 ~1.2u 就被涡顶压住，横向强阻力（雾贴着沙面淌）
      d.vy -= 0.9 * dt;
      if (d.y > duneH(d.x, d.z) + 1.2 && d.vy > 0) d.vy *= 1 - 3.0 * dt;
      d.vx *= 1 - 1.1 * dt; d.vz *= 1 - 1.1 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const floor = duneH(d.x, d.z);
      if (d.y < floor + 0.08) d.y = floor + 0.08;   // 雾贴地淌不钻地
      if (d.t >= d.life) { d.alive = false; continue; }
      const k = d.t / d.life;
      // 雾感：慢起慢收的正弦包络；体积随年龄缓慢膨胀（云团散开）
      d.a = Math.sin(k * PI) * 0.16;
      this._pos[n * 3] = d.x; this._pos[n * 3 + 1] = d.y; this._pos[n * 3 + 2] = d.z;
      this._size[n] = d.size * (0.8 + 0.7 * k);
      this._alp[n] = d.a;
      n++;
    }
    this.geo.setDrawRange(0, n);
    if (n > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlp.needsUpdate = true;
    }
    this.mesh.visible = n > 0;
  }
}

// ============================================================
// GrassDebrisFX — 草地专属：草屑碎片实体（细三角面片旋转翻滚抛物线落地）
// 下洗强时从旋翼投影圈外缘抛出，落地即消失（可留微小压痕）
// ============================================================
class GrassDebrisFX {
  constructor(scene) {
    this.scene = scene;
    // 割草机碎草（2026-09-02 用户需求）：细长草叶而非三角纸屑——
    // 根部宽 0.032 → 尖部收窄，长 0.30；顶点色根深尖浅，翻滚时
    // 双面同色才有"草"的体积感
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.016, 0, 0,    0.016, 0, 0,    0.011, 0.30, 0,   -0.011, 0.30, 0,
    ]), 3));
    tri.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    ]), 3));
    tri.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
      0.28, 0.34, 0.12,   0.28, 0.34, 0.12,   0.52, 0.58, 0.22,   0.52, 0.58, 0.22,
    ]), 3));
    tri.setIndex([0, 1, 2, 0, 2, 3]);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.MAX = 160;
    this.mesh = new THREE.InstancedMesh(tri, this.mat, this.MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.p = [];
    for (let i = 0; i < this.MAX; i++) {
      this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, t: 0, life: 1, size: 1 });
    }
    this._dummy = new THREE.Object3D();
    this._acc = 0;
    this._quality = 1;
    this._activeMax = this.MAX;
  }

  setQuality(scale = 1) {
    this._quality = clamp(scale, 0.25, 1);
    this._activeMax = Math.max(1, Math.floor(this.MAX * this._quality));
    for (let i = this._activeMax; i < this.p.length; i++) this.p[i].alive = false;
  }

  clear() {
    this._acc = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (const d of this.p) d.alive = false;
  }

  update(dt, s, hx, hz, wx, wz) {
    if (s > 0.2) {
      this._acc += dt * s * 26;
      while (this._acc >= 1) {
        this._acc -= 1;
        const slot = this.p.find((d, i) => i < this._activeMax && !d.alive);
        if (!slot) break;
        const a = rnd(TAU), rr = rnd(1.6, 4.4);
        slot.alive = true;
        slot.x = hx + Math.cos(a) * rr;
        slot.z = hz + Math.sin(a) * rr;
        slot.y = 0.1 + rnd(0.25);
        slot.vx = Math.cos(a) * rnd(2.0, 5.5) + wx * 1.6;   // 出生带风偏（P3-⑧）
        slot.vz = Math.sin(a) * rnd(2.0, 5.5) + wz * 1.6;
        slot.vy = rnd(2.8, 6.0);
        slot.rx = rnd(TAU); slot.ry = rnd(TAU); slot.rz = rnd(TAU);
        slot.wx = rnd(-9, 9); slot.wy = rnd(-12, 12); slot.wz = rnd(-9, 9);
        slot.t = 0;
        slot.life = rnd(0.8, 1.5);
        slot.size = 0.7 + rnd(1.1);
      }
    }
    let n = 0;
    for (const d of this.p) {
      if (!d.alive) continue;
      d.t += dt;
      d.vy -= 7.2 * dt;                      // 草屑轻，重力弱于水花（空气阻力大）
      d.vx += wx * 2.2 * dt; d.vz += wz * 2.2 * dt;   // 风推（P3-⑧）
      d.vx *= 1 - 0.9 * dt; d.vz *= 1 - 0.9 * dt;   // 空气阻力
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      if (d.y <= 0.02 || d.t > d.life) { d.alive = false; continue; }
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(d.rx, d.ry, d.rz);
      const k = 1 - d.t / d.life;
      this._dummy.scale.setScalar(d.size * (0.6 + 0.4 * k));
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(n++, this._dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

// ============================================================
// GrassImprint — 草地专属：停机压痕（压倒+碾碎的草，2026-09-02）
// 接地/低悬停时下洗把贴地草压倒折损：中心深色压溃斑 + 放射状断续
// 倒伏擦痕；随停留加深，离地后超慢消退（观感级，真草回弹要更久）。
// 画布 1024² 铺 30u，直升机活动范围全覆盖；切走草地即清空。
// 痕迹一律断续弧段，不得整圆径向渐变（防"靶心"观感，同 WashTracks）。
// ============================================================
class GrassImprint {
  constructor(scene) {
    this.cv = document.createElement('canvas');
    this.cv.width = this.cv.height = 1024;
    this.cx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.022;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._acc = 1;          // 进场先盖第一章
    this._idle = 99;        // 距最后一次盖章的秒数
    this._stamps = 0;
  }
  clear() {
    this.cx.clearRect(0, 0, 1024, 1024);
    this.tex.needsUpdate = true;
    this.mesh.visible = false;
    this._acc = 1; this._idle = 99; this._stamps = 0;
  }
  // 印章亮度随环境（夜间压痕不发亮）
  setLighting(lum) { this.mat.color.setScalar(clamp(lum * 1.5, 0.16, 1)); }
  stamp(hx, hz) {
    const cx = this.cx;
    const px = 512 + hx / 30 * 1024, pz = 512 - hz / 30 * 1024;
    cx.save(); cx.translate(px, pz);
    // 压溃底盘：暗橄榄压倒斑（低透明度多层叠加渐深）
    const g = cx.createRadialGradient(0, 0, 10, 0, 0, 150);
    g.addColorStop(0, 'rgba(40,44,22,0.16)');
    g.addColorStop(0.6, 'rgba(56,60,30,0.08)');
    g.addColorStop(1, 'rgba(56,60,30,0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(0, 0, 150, 0, TAU); cx.fill();
    // 放射倒伏擦痕：贴地草从桨盘下被推倒的断续浅色弧段
    cx.rotate(rnd(TAU));
    for (let i = 0; i < 18; i++) {
      const a0 = i / 18 * TAU + rnd(-0.16, 0.16);
      const r0 = 24 + rnd(105);
      cx.strokeStyle = 'rgba(' + (74 + rnd(34) | 0) + ',' + (78 + rnd(28) | 0) + ',40,0.09)';
      cx.lineWidth = 4 + rnd(6);
      cx.beginPath();
      cx.arc(0, 0, r0, a0, a0 + 0.5 + rnd(0.7));
      cx.stroke();
    }
    cx.restore();
    this.tex.needsUpdate = true;
    this._stamps++;
  }
  update(dt, s, alt, hx, hz) {
    const grounded = alt < 0.45;
    if (grounded && s > 0.05) {
      this._acc += dt;
      if (this._acc >= 0.45) { this._acc = 0; this.stamp(hx, hz); }
      this._idle = 0;
    } else {
      this._idle += dt;
      if (this._idle > 4) {           // 离地后超慢消退（草叶回弹观感）
        this.cx.globalCompositeOperation = 'destination-out';
        this.cx.fillStyle = 'rgba(0,0,0,0.014)';
        this.cx.fillRect(0, 0, 1024, 1024);
        this.cx.globalCompositeOperation = 'source-over';
        this.tex.needsUpdate = true;
      }
    }
    this.mesh.visible = true;         // 消退由画布透明度承担，层保持常开
  }
  state() { return { stamps: this._stamps, visible: this.mesh.visible }; }
}

// ============================================================
// 草叶回弹：GrassField 的 uWash 突降后叠加阻尼弹簧摆动
// 实现为 WashFX 层的"残留摆动量"——下洗强度骤降时，把差值灌入
// 弹簧状态，弹簧回摆通过 uWash 的回弹项继续驱动草叶
// ============================================================

// ============================================================
// WashTracks — 沙漠专属：起降吹蚀痕迹留存（P3-⑨）
// 一张 44u×44u 的持久画布铺在沙地上：下洗活跃且离地低时低频"盖章"——
// 壁面射流分离带被吹蚀露出深色粗砂、外侧堆积亮色浮沙、加放射吹痕。
// 印记跨帧累积（起降次数越多越深），超慢速消退；切走沙漠场地即清空。
// 直升机固定悬停在场地中心，痕迹自然聚成"常用起降位"的疤。
// 注意：盖章几何一律是【断续弧段 + 顺风椭圆化】，不得退回整圆径向渐变——
// 整圆会和地形叠成"靶心"同心环（用户实测反馈过的观感问题）。
// ============================================================
class WashTracks {
  constructor(scene) {
    this.SIZE = 44;               // 画布覆盖的世界范围（u）
    this.N = 1024;
    const { c, x } = canvas2d(this.N);
    this.cx = x;
    this.tex = tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
    // 痕迹贴沙丘高度场（P3-9）：44u 画布若固定在 y=0.013 平面，FPV 低飞到
    // 沙丘上方（duneH 脊高至 0.58u）时盖的章会被沙掩埋全部不可见。构造时按
    // duneH 逐顶点抬高一次（duneH 为纯函数，与几何/贴花/沙脊取样同源）：
    // 旋转 -90° 后局部 +Z → 世界 +Y、局部 +Y → 世界 -Z（与 _px 换算同源），
    // 故 setZ = duneH(局部x, -局部y)，配 mesh.position.y = 0.013 得
    // 世界 y = duneH + 0.013，痕迹始终贴沙面 1.3cm 上方。88 段 → 0.5u 步长，
    // 对 5u 波长沙丘的线性插值误差远小于偏移量。
    const geo = new THREE.PlaneGeometry(this.SIZE, this.SIZE, 88, 88);
    const posA = geo.attributes.position;
    for (let i = 0; i < posA.count; i++) {
      posA.setZ(i, duneH(posA.getX(i), -posA.getY(i)));
    }
    const m = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    m.rotation.x = -PI / 2;
    m.position.y = 0.013;
    m.renderOrder = 2;
    m.visible = false;
    scene.add(m);
    this.mesh = m;
    this._fadeT = 0;
    this._acc = 0;                // 累积强度（封顶防糊黑）
    this.stamps = 0;              // 已盖章数（调试/验证出口）
  }

  // 世界坐标 → 画布像素。平面绕 x 轴 -90°：局部 +Y 对应世界 -Z，
  // flipY 画布顶行是 v=1 —— 两个翻转正好抵消，画布 y 随世界 z 递增
  _px(wx, wz) {
    return [(wx / this.SIZE + 0.5) * this.N, (wz / this.SIZE + 0.5) * this.N];
  }

  // 盖一枚吹蚀痕。rWorld 为环带外半径（u），alpha 为本章强度
  //
  // 【按物理重做（同心环治理的第二处）】
  // 旧实现直接 createRadialGradient + arc 画整圆，等高线是标准同心圆，
  // 与 duneH 的径向对称叠在一起就是那圈"靶心"。真实的旋翼吹蚀痕不是圆：
  //   ① 下洗撞地形成壁面射流，在 ~1.2 倍旋翼半径处发生边界层分离，
  //      沙在分离带被掀走、在外侧堆积 —— 亮暗是【环带】而非整盘渐变；
  //   ② 环带被环境风拉成椭圆并整体向下风偏移（沙的净输运方向就是风向）；
  //   ③ 分离带不连续：湍流涡在环上离散着地，痕迹是断续弧段。
  // 于是改为：沿角度分段画短弧，半径随"与风向夹角"椭圆化 + 中心下风偏移，
  // 每段带自己的强度扰动。整圆再也拼不出来。
  stamp(wx, wz, rWorld, alpha, windX, windZ) {
    const N = this.N;
    const x = this.cx;
    const wl = Math.hypot(windX, windZ) || 1;
    const dx = windX / wl, dz = windZ / wl;   // 单位风向（画布 y 同向世界 z）
    // 中心随风下移：吹起的沙落在下风侧，痕迹重心不在机腹正下方
    const skew = Math.min(0.35, wl * 0.16);
    const [px, py] = this._px(wx + dx * rWorld * skew, wz + dz * rWorld * skew);
    const pr = Math.max(10, rWorld / this.SIZE * N);
    const ecc = 1 + Math.min(0.45, wl * 0.22);    // 顺风向拉长
    // 极径函数：顺风椭圆化
    const rAt = (a) => {
      const along = Math.cos(a) * dx + Math.sin(a) * dz;
      return pr * (1 + (ecc - 1) * along * along * Math.sign(along || 1) * 0.6);
    };
    // —— 断续分离带：24 段短弧，掀蚀（暗）在内、堆积（亮）在外 ——
    const SEG = 24, step = TAU / SEG;
    for (let i = 0; i < SEG; i++) {
      const a0 = i * step, a1 = a0 + step * 0.86;   // 留 14% 间隙，环不闭合
      const am = (a0 + a1) * 0.5;
      const along = Math.cos(am) * dx + Math.sin(am) * dz;
      // 下风侧掀蚀更强（气流已被风加速），上风侧弱
      const g = (0.55 + 0.45 * rnd()) * (0.75 + 0.45 * Math.max(0, along));
      if (g < 0.32) continue;                       // 部分段直接缺失
      const rm = rAt(am);
      // 掀蚀暗弧（分离带内缘）
      x.strokeStyle = `rgba(90,68,44,${(alpha * 0.9 * g).toFixed(3)})`;
      x.lineWidth = pr * (0.16 + rnd(0.10));
      x.beginPath(); x.arc(px, py, rm * (0.56 + rnd(0.10)), a0, a1); x.stroke();
      // 堆积亮弧（分离带外缘）
      x.strokeStyle = `rgba(238,218,178,${(alpha * 0.55 * g).toFixed(3)})`;
      x.lineWidth = pr * (0.12 + rnd(0.08));
      x.beginPath(); x.arc(px, py, rm * (0.86 + rnd(0.12)), a0, a1); x.stroke();
    }
    // —— 机腹正下方的滞止区：一小片轻微压暗，不带任何环 ——
    const core = x.createRadialGradient(px, py, 0, px, py, pr * 0.42);
    core.addColorStop(0, `rgba(104,82,54,${(alpha * 0.30).toFixed(3)})`);
    core.addColorStop(1, 'rgba(104,82,54,0)');
    x.fillStyle = core;
    x.beginPath(); x.arc(px, py, pr * 0.42, 0, TAU); x.fill();
    // —— 放射吹痕：下风向更长（风吹出的沙线）——
    x.lineWidth = Math.max(1.4, N / 800);
    for (let i = 0; i < 11; i++) {
      const a = rnd(TAU);
      const down = Math.cos(a) * dx + Math.sin(a) * dz;   // 与风向的点积
      const r0 = pr * (0.35 + rnd(0.15));
      const r1 = pr * (0.85 + rnd(0.45) + Math.max(0, down) * 0.5);
      x.strokeStyle = rnd() < 0.5
        ? `rgba(88,68,44,${(alpha * 0.5).toFixed(3)})`
        : `rgba(240,222,184,${(alpha * 0.4).toFixed(3)})`;
      x.beginPath();
      x.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0);
      x.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
      x.stroke();
    }
    this.tex.needsUpdate = true;
    this.stamps++;
  }

  // 慢速消退：痕迹以小时级半衰期缓慢恢复（沙地会被新沙覆盖）
  update(dt) {
    this._fadeT += dt;
    if (this._fadeT < 3) return;
    this._fadeT = 0;
    const x = this.cx;
    x.save();
    x.globalCompositeOperation = 'destination-out';
    x.globalAlpha = 0.02;
    // destination-out 只认源 alpha：必须显式设实色——stamp() 收尾留下的是
    // 透明渐变 fillStyle（源 alpha≈0），沿用会让消退静默变 no-op
    // （P3-9 测试实测 20 档零衰减抓出，GrassImprint 同款逻辑就是设了实色的）
    x.fillStyle = '#000';
    x.fillRect(0, 0, this.N, this.N);
    x.restore();
    this.tex.needsUpdate = true;
  }

  clear() {
    this.cx.clearRect(0, 0, this.N, this.N);
    this.tex.needsUpdate = true;
    this._acc = 0;
    this.stamps = 0;
  }
}




