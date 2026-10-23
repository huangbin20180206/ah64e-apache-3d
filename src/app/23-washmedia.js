// ============================================================
// 23-washmedia.js — 介质表现类：草地 / 水面 spray / 涟漪
// ============================================================
// 从 17-washfx.js 拆出（P0 重构）：这三个类负责"介质长什么样"——
// 草叶实例场（GrassField）、湖面泡沫/水花/凹陷（SpraySurfaceFX）、
// 悬停涟漪波环（WaterRipples）。总装在 17-washfx 的 WashFX，
// 依赖 00-utils（canvas2d/tex/rnd）与 15-terrain（duneH）。
// ============================================================

// ============================================================
// GrassField — 草地专属：草叶实例场
// 每片草叶 4 段弯曲（根不动、尖挠度最大），下洗按"离飞机的径向"压倒，
// 叠加外传草浪 + 环境风。倒伏的草混入干黄色，低角度也读得出来。
//
// 两条硬约束（都是踩过的坑）：
//   1. 必须有光照与雾。无光照的固定暗色 + 上千支重叠 = 一堵黑墙，
//      远处草地不会融进地平线，而是拍出一道硬边（曾整片画面变黑）。
//   2. 密度与高度要压住。低视角下草叶互相遮挡是平方级的，
//      6000 支 / 半径 10u / 高 0.16~0.32u 是实测能保住通透感的上限。
// ============================================================
class GrassField {
  constructor(scene) {
    // 全域均匀加密（2026-09-02 用户需求）：草原没有"内外圈"之分——
    // P29 再加密 68000→78000（+15%，同一 InstancedMesh 1 draw），
    // 画质档位仍按 particles 系数缩放（0.75 档 ≈ 5.85 万支保帧率）
    const COUNT = 78000;
    // 5 段细分：段数决定弯曲曲线的平滑度
    const blade = new THREE.PlaneGeometry(1, 1, 1, 5);
    blade.translate(0, 0.5, 0);           // 底部对齐原点，便于按高度加权

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.setAttribute('position', blade.attributes.position);
    geo.setAttribute('uv', blade.attributes.uv);

    const off = new Float32Array(COUNT * 4);   // [x, z, 高度, 朝向]
    const tint = new Float32Array(COUNT);      // 色相扰动（第一轴）
    const aux = new Float32Array(COUNT * 2);   // P29：[第二色相随机, 野花标记]
    for (let i = 0; i < COUNT; i++) {
      // 面积均匀分布（纯 √u → 密度全域严格一致）。
      // 坑：旧写法 √u·R·(1−k·u) 的线性收缩让 dr/du 越靠外越小，
      // 外圈密度反超内圈 ~60%（用户实测"内芯比外圈稀"的数学根源）。
      // 羽化改用拒绝采样：只接受概率上削薄最外 18%，不碰分布形状。
      let rr;
      for (;;) {
        const u = rnd();
        rr = 0.35 + Math.sqrt(u) * 20.0;
        if (u > 0.82 && rnd() < (u - 0.82) / 0.18 * 0.8) continue;
        break;
      }
      const a = rnd(TAU);
      const gx = Math.cos(a) * rr, gz = Math.sin(a) * rr;
      off[i * 4 + 0] = gx;
      off[i * 4 + 1] = gz;
      // —— P30 成簇高草：低频交叉耦合噪声只写高度与色相，与 test_grass 读的
      // aOff.xy 密度分箱严格正交——高丛/矮丛交替；俯视靠"高丛葱绿、矮丛偏
      // 枯黄"的色相联动读出"一团团"，不再是均匀绿毯。噪声波长 5~7u（簇尺度），
      // x/z 相位互锁——sin·sin 可分离积会排成网点阵（P29 泡沫颗粒的教训）。
      const clN = 0.5 + 0.5 * Math.sin(gx * 1.05 + Math.sin(gz * 0.42) * 1.6)
                        * Math.sin(gz * 0.88 - Math.sin(gx * 0.31) * 1.3);
      // —— P30 边界消隐：外圈 15→20.2u 草高软消到贴地短茬。平视消融帧坐实
      // 草岛终止线"露底"（第二处可见纹路）——密度分布不动（羽化拒绝采样
      // 保持原样），只在高度维度消隐：边缘读作草渐矮的自然收边。
      const fall = 1 - 0.94 * smoothstep(15.0, 20.2, rr);
      // —— P30 野花：密度 1.2%→0.4%（用户实测 1.2% 泛白点读成"碎草"）——
      // 强制长在高草档让花头探出草层
      const isFlower = rnd() < 0.004;
      off[i * 4 + 2] = (isFlower ? 0.24 + rnd(0.12) : 0.10 + rnd(0.26))
                      * fall * (0.56 + 0.78 * clN);
      off[i * 4 + 3] = rnd(TAU);
      tint[i] = rnd();
      // 第二色相轴 P30：与簇联动（高丛→低值→葱绿；矮丛→高值→枯黄倾向），
      // rnd()*0.38 保留每叶随机底噪——簇色是倾向不是硬分区（对比度按
      // 验收反馈拉满：联动权重 0.45→0.62，"一团团"要肉眼可辨）
      aux[i * 2 + 0] = rnd() * 0.38 + (1 - clN) * 0.62;
      aux[i * 2 + 1] = isFlower ? 1 : 0;
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
    geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(aux, 2));
    geo.instanceCount = COUNT;
    this.MAX_COUNT = COUNT;
    this._quality = 1;

    this.uniforms = {
      uTime: { value: 0 }, uWash: { value: 0 }, uAlt: { value: 0 },
      uHeli: { value: new THREE.Vector2(0, 0) },
      uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunCol: { value: new THREE.Color(0xffffff) },
      uSunI: { value: 1.0 },
      uSky: { value: new THREE.Color(0xbcd2e8) },
      uFogCol: { value: new THREE.Color(0x9db7a0) },
      uFogD: { value: 0.005 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWindI: { value: 0 },
    };

    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        precision highp float;
        attribute vec4 aOff;
        attribute float aTint;
        attribute vec2 aVar;                    // P29：[第二色相随机, 野花标记]
        uniform float uTime, uWash, uAlt;
        uniform vec2 uHeli;
        uniform vec2 uWindDir;
        uniform float uWindI;
        varying float vH;
        varying float vBend;
        varying float vTint;
        varying vec2 vVar;
        varying float vG;                       // P30：阵风行波包络（明暗条带）
        varying vec3 vN;
        varying float vFogDepth;
        void main(){
          vec2 gp = aOff.xy;                    // 草叶根部（世界 XZ，草场以原点为中心）
          float hgt = aOff.z;
          float dirA = aOff.w;
          float t = uv.y;                       // 沿草叶从根(0)到尖(1)
          vH = t; vTint = aTint; vVar = aVar; vG = 0.0;

          // —— 下洗压倒：按离飞机的径向向外倒 ——
          vec2 d = gp - uHeli;
          float r = length(d);
          vec2 rad = r > 0.001 ? d / r : vec2(1.0, 0.0);
          // 离地越高作用圈越大越弱
          float altK = 1.0 + uAlt * 0.15;
          float reach = smoothstep(13.0 * altK, 1.2, r);
          // 中心滞止：正下方的草被垂直压住而不是向外倒
          float stag = smoothstep(0.0, 1.6, r);
          float bend = uWash * reach;
          // 外传草浪：环形波让倒伏此起彼伏（实拍里最显眼的动态）
          float wave = sin(r * 1.9 - uTime * 5.2) * 0.5 + 0.5;
          bend *= 0.52 + 0.48 * wave;
          // 下风侧压得更平、上风侧立得直（P3-⑧）
          bend *= 0.78 + 0.44 * uWindI * dot(rad, uWindDir);
          bend = clamp(bend, 0.0, 1.0);
          vBend = bend;

          // —— 环境风（P3-⑧）：盛行风向持续侧压 + 高频抖动；下洗时加剧 ——
          // P29：相位混入 aTint 去邻叶相干——旧相位纯由位置决定，相邻草叶
          // 同步摆动像一整块布；掺每叶随机后近看是"各摆各的"
          float ph = gp.x * 1.7 + gp.y * 1.3 + aTint * 4.7;
          float windAmp = 0.045 + uWash * 0.10;
          // —— P30 大尺度统一阵风：沿风向缓慢平移的低频行波 ——
          // 波长 ~9u、相速 ~1.5u/s：风以连贯波前扫过整片草场（用户要
          // "连贯不要杂乱"——这是一道全场行波，叠加而非替换上面的每叶
          // 抖动）。横向低频弯曲避免完全平直的"扫描线"感；无风（uWindI→0）
          // 时阵风同步收敛归零。
          float gustW = sin(dot(gp, uWindDir) * 0.70 - uTime * 1.05
                        + sin(dot(gp, vec2(-uWindDir.y, uWindDir.x)) * 0.21) * 0.85);
          float gustN = 0.5 + 0.5 * gustW;           // 行波包络 0..1
          vG = gustN;
          float gust = (0.09 + uWash * 0.11) * (0.35 + 0.65 * uWindI) * gustN;
          vec2 wind = uWindDir * (windAmp * (0.85 + 0.35 * sin(uTime * 0.9 + ph * 0.3)) + gust)
                    + vec2(sin(uTime * 1.7 + ph), cos(uTime * 1.35 + ph * 1.4)) * windAmp * 0.45;

          // —— 弯曲：尖端位移 ∝ t^1.6（悬臂梁挠度形状），根部完全不动 ——
          float k = pow(max(t, 1e-4), 1.6);
          vec2 push = rad * bend * stag * 1.5 + wind;
          vec2 side = vec2(cos(dirA), sin(dirA));
          // 叶宽向尖端收细（真草是尖的；矩形条会显得像塑料片）。
          // P29 野花：顶部渐宽成小色点（花头），茎部保持草宽。
          // P30 形态修正：宽度系数 0.058→0.10（花头宽/高比≈0.8 ≥ 0.6），
          // 游玩视距读作团块色点，不再是竖直细条
          float flw = aVar.y * smoothstep(0.35, 0.65, t);
          float wid = 0.030 * (1.0 - 0.78 * t) + flw * 0.10;

          vec3 wp;
          wp.xz = gp + side * (position.x * wid) + push * k * hgt / 0.3;
          // 压倒后高度按挠度缩减（弯而不是缩），再叠中心垂直压制
          float horiz = length(push) * k;
          float vShrink = 1.0 - min(0.82, horiz * 0.42 + bend * (1.0 - stag) * 0.7);
          wp.y = t * hgt * vShrink;

          // 法线：整体朝上并随倒伏方向倾斜。草丛作为"一片地表"来打光，
          // 比按单叶平面法线更稳（单叶法线会让相邻叶明暗乱跳、糊成噪点）
          vec2 tilt = push * 0.9;
          vN = normalize(vec3(tilt.x, 1.0, tilt.y));

          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying float vH;
        varying float vBend;
        varying float vTint;
        varying vec2 vVar;
        varying float vG;
        varying vec3 vN;
        varying float vFogDepth;
        uniform vec3 uSun, uSunCol, uSky, uFogCol;
        uniform float uSunI, uFogD;
        void main(){
          // 基色：根深尖浅（草丛底部本就受遮挡）
          // pow 底数一律夹到 >0：pow(0.0, y) 在部分驱动上返回 NaN，
          // 而 NaN 顺着颜色链传到 gl_FragColor 会画成纯黑（曾整片草地变黑块）
          vec3 deep = vec3(0.085, 0.125, 0.055);
          vec3 tipc = vec3(0.300, 0.375, 0.150);
          vec3 alb = mix(deep, tipc, pow(max(vH, 1e-4), 0.8));
          // 个体色差：偏黄绿 / 偏青绿（第一轴）
          alb *= 0.80 + 0.40 * vTint;
          alb = mix(alb, alb * vec3(1.18, 1.06, 0.70), vTint * 0.55);
          // P29 第二色相轴：少数草明显偏枯黄（dryK 高次幂 → 只有少数浓），
          // 其余在冷青方向微扰动——草场远看是"有杂色的一整片"，不是绿毯
          float dryK = pow(vVar.x, 2.6);
          alb = mix(alb, alb * vec3(1.34, 1.14, 0.50), dryK * 0.55);
          alb = mix(alb, alb * vec3(0.90, 1.03, 0.90), (1.0 - dryK) * vVar.x * 0.35);
          // 倒伏处混入被吹起的干土黄（关键：让"倒了"这件事看得见）
          alb = mix(alb, vec3(0.34, 0.29, 0.185), vBend * 0.5);
          // P30 花色修正：P29 近白花瓣(0.93,0.91,0.80)在游玩视距读成
          // "泛白碎草"（用户原话）——换饱和黄/橙黄伞形花色；夜间随同一套
          // 光照压暗（月色乘饱和黄≈暗土色），不会发白点
          if (vVar.y > 0.5) {
            vec3 petal = mix(vec3(0.99, 0.84, 0.20), vec3(0.98, 0.66, 0.10),
                             smoothstep(0.25, 0.75, vVar.x));
            alb = mix(alb, petal, smoothstep(0.45, 0.80, vH));
          }

          // P30 阵风条带：波前经过处草叶整体侧倾+受光面变化，读作明暗
          // 起伏带（麦田风浪的主视觉信号——静止帧可见波带，动起来即
          // 连贯扫过整片草场）
          alb *= 0.93 + 0.07 * vG;

          // 光照：太阳漫反射 + 天光半球项 + 按高度的自遮挡 AO
          vec3 N = normalize(vN);
          float ndl = max(dot(N, normalize(uSun)), 0.0);
          float ao = 0.30 + 0.70 * pow(max(vH, 1e-4), 0.7);
          vec3 col = alb * (uSunCol * uSunI * ndl * 0.85 + uSky * 0.42) * ao;

          // 雾（FogExp2 同式）：远处草必须融进地平线，否则草场边缘会拍出硬边
          float f = 1.0 - exp(-uFogD * uFogD * vFogDepth * vFogDepth);
          col = mix(col, uFogCol, clamp(f, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setQuality(scale = 1) {
    this._quality = clamp(scale, 0.25, 1);
    this.mesh.geometry.instanceCount = Math.floor(this.MAX_COUNT * this._quality);
  }

  // 从世界光照/雾同步参数（切环境预设或场地后调用）
  syncLighting(W) {
    const u = this.uniforms;
    u.uSun.value.copy(W.sun.position).normalize();
    u.uSunCol.value.copy(W.sun.color);
    u.uSunI.value = W.sun.intensity * 0.34;      // 定向光强度是给 PBR 用的，这里换算成直观量级
    u.uSky.value.copy(W.hemi.color).multiplyScalar(W.hemi.intensity);
    if (W.scene.fog) {
      u.uFogCol.value.copy(W.scene.fog.color);
      u.uFogD.value = W.fogBase ? W.fogBase.d : W.scene.fog.density;
    }
  }

  update(time, wash, alt, hx, hz, wx, wz) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uWash.value = wash;
    u.uAlt.value = alt;
    u.uHeli.value.set(hx, hz);
    // 环境风向/强度（P3-⑧）：单位方向 + 归一化强度
    const wl = Math.hypot(wx, wz) || 1;
    u.uWindDir.value.set(wx / wl, wz / wl);
    u.uWindI.value = Math.min(1, wl / 0.9);
  }
}

// ============================================================
// SpraySurfaceFX — 湖面专属：泡沫残留 / 水花飞溅 / 水面凹陷
// 只在 spray 场地启用，随下洗强度渐入渐出
// ============================================================
class SpraySurfaceFX {
  constructor(scene) {
    this.scene = scene;

    // —— 1. 平台边缘泡沫碎片：只在平台外缘生成，细长、不规则、低透明度 ——
    // 泡沫应该附着在平台外缘/波峰上，而不是随机漂在机腹正下方。
    const foamTex = (() => {
      const N = 192;
      const { c, x } = canvas2d(N);
      x.clearRect(0, 0, N, N);
      for (let i = 0; i < 13; i++) {
        const px = rnd(N * 0.22, N * 0.78);
        const py = rnd(N * 0.36, N * 0.64);
        const w = rnd(N * 0.10, N * 0.28);
        const h = rnd(N * 0.018, N * 0.055);
        x.save();
        x.translate(px, py); x.rotate(rnd(-0.35, 0.35));
        const g = x.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
        g.addColorStop(0, 'rgba(236,249,250,0.55)');
        g.addColorStop(0.55, 'rgba(203,232,236,0.25)');
        g.addColorStop(1, 'rgba(180,220,228,0)');
        x.fillStyle = g;
        x.beginPath(); x.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, TAU); x.fill();
        x.restore();
      }
      return tex(c, { wrap: THREE.ClampToEdgeWrapping });
    })();
    this.spots = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: foamTex, transparent: true, opacity: 0, depthWrite: false,
        }));
      m.rotation.x = -PI / 2;
      m.position.y = WATER_Y + 0.018;
      m.renderOrder = 4;
      m.visible = false;
      scene.add(m);
      this.spots.push({ m, life: 0, life0: 4, base: 0.22 });
    }

    // —— 2. 水花实体粒子：小白滴抛物线起落，落水点再触发一次小泡沫斑 ——
    // InstancedMesh 一次 draw call，CPU 每帧只更新存活实例的矩阵
    const dropGeo = new THREE.SphereGeometry(0.035, 6, 5);
    this.dropMat = new THREE.MeshBasicMaterial({ color: 0xb8dce2, transparent: true, opacity: 0.62 });
    this.MAX_DROPS = 140;
    this._quality = 1;
    this._activeMax = this.MAX_DROPS;
    this.drops = new THREE.InstancedMesh(dropGeo, this.dropMat, this.MAX_DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    scene.add(this.drops);
    this.dropP = [];               // 粒子状态池
    for (let i = 0; i < this.MAX_DROPS; i++) {
      this.dropP.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, size: 1 });
    }
    this._dummy = new THREE.Object3D();
    this._spawnAcc = 0;
    // 落水点回收队列 → 生成二次小泡沫
    this._impactQ = [];

        // —— 水压凹陷：低透明度暗环，只在中心下洗最强时出现 ——
    const depTex = (() => {
      const N = 256;
      const { c, x } = canvas2d(N);
      const R = N / 2;
      const g = x.createRadialGradient(R, R, R * 0.22, R, R, R);
      g.addColorStop(0.00, 'rgba(12,42,50,0)');
      g.addColorStop(0.46, 'rgba(17,58,66,0.12)');
      g.addColorStop(0.60, 'rgba(177,220,226,0.10)');
      g.addColorStop(0.72, 'rgba(177,220,226,0.04)');
      g.addColorStop(1.00, 'rgba(177,220,226,0)');
      x.fillStyle = g; x.fillRect(0, 0, N, N);
      return tex(c, { wrap: THREE.ClampToEdgeWrapping });
    })();
    this.depress = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshBasicMaterial({
        map: depTex, transparent: true, opacity: 0, depthWrite: false,
      }));
    this.depress.rotation.x = -PI / 2;
    this.depress.position.y = 0.028;
    this.depress.renderOrder = 3;
    this.depress.visible = false;
    scene.add(this.depress);
  }

  // 画质降档：缩小水花粒子的可用池上限（与 GrassDebrisFX 同约定）。
  // InstancedMesh 容量不变，只压活跃上限——避免重建 buffer。
  setQuality(scale = 1) {
    this._quality = clamp(scale, 0.25, 1);
    this._activeMax = Math.max(1, Math.floor(this.MAX_DROPS * this._quality));
    // 超出新上限的存活粒子立即回收，否则降档后要等它们自然消亡
    for (let i = this._activeMax; i < this.dropP.length; i++) this.dropP[i].alive = false;
  }

  update(dt, s, alt, hx, hz, time, wx, wz) {
    const active = s > 0.03 && alt < 7.5;
    const fade = active ? (1 - smoothstep(4.0, 7.5, alt)) : 0;

    // ---------- 泡沫残留斑 ----------
    for (const sp of this.spots) {
      if (sp.life > 0) {
        sp.life -= dt;
        // 泡沫随风吹向下风（P3-⑧）
        sp.m.position.x += wx * dt * 0.22;
        sp.m.position.z += wz * dt * 0.22;
        const k = Math.max(sp.life / sp.life0, 0);
        // 泡沫沿风向缓慢漂移，透明度克制，避免形成白色云团
        sp.m.material.opacity = sp.base * Math.min(1, (1 - k) * 8) * (k < 0.35 ? k / 0.35 : 1) * fade;
        sp.m.visible = sp.m.material.opacity > 0.01;
        if (sp.life <= 0) sp.m.visible = false;
      } else if (active && rnd() < s * dt * 1.2) {
        // 泡沫沿平台边缘外侧生成；中心留给下洗水柱和平台本体
        const a = rnd(TAU), rr = 7.25 + rnd(1.7);
        sp.m.position.set(hx + Math.cos(a) * rr + wx * 0.45, WATER_Y + 0.025, hz + Math.sin(a) * rr + wz * 0.45);
        const sc = 0.35 + rnd(0.65);
        sp.m.scale.setScalar(sc);
        sp.life = sp.life0 = 3.2 + rnd(1.8);
        sp.base = 0.16 + rnd(0.10);
        sp.m.rotation.z = rnd(TAU);
        sp.m.visible = true;
      }
    }

    // ---------- 水花实体粒子 ----------
    if (active) {
      // 发射：速率 ∝ 强度
      this._spawnAcc += dt * s * 46;
      while (this._spawnAcc >= 1) {
        this._spawnAcc -= 1;
        const slot = this.dropP.find((d, i) => i < this._activeMax && !d.alive);
        if (!slot) break;
        const a = rnd(TAU), rr = 6.7 + rnd(1.4);
        slot.alive = true;
        slot.x = hx + Math.cos(a) * rr;
        slot.z = hz + Math.sin(a) * rr;
        slot.y = 0.08;
        slot.vx = Math.cos(a) * rnd(1.2, 3.0);
        slot.vz = Math.sin(a) * rnd(1.2, 3.0);
        slot.vy = rnd(1.2, 2.8);
        slot.t = 0;
        slot.life = rnd(0.55, 0.95);
        slot.size = 0.45 + rnd(0.55);
      }
    }
    const dummy = this._dummy;
    let n = 0;
    for (const d of this.dropP) {
      if (!d.alive) continue;
      d.t += dt;
      d.vy -= G_U * dt;                 // 重力（phys1 统一：9.8m/s² ÷ 2.27）
      d.vx += wx * 1.1 * dt; d.vz += wz * 1.1 * dt;   // 风推（P3-⑧）
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y <= 0.02 || d.t > d.life) {
        // 落水：入队二次小泡沫
        d.alive = false;
        if (this._impactQ.length < 24) this._impactQ.push([d.x, d.z]);
        continue;
      }
      dummy.position.set(d.x, d.y, d.z);
      const k = 1 - d.t / d.life;
      dummy.scale.setScalar(d.size * (0.5 + 0.5 * k));
      dummy.updateMatrix();
      this.drops.setMatrixAt(n++, dummy.matrix);
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
    this.drops.visible = n > 0;

    // 落水点 → 生成二次小泡沫斑（借用泡沫斑槽位）
    while (this._impactQ.length) {
      const [ix, iz] = this._impactQ.shift();
      const slot = this.spots.find(sp => sp.life <= 0);
      if (!slot) break;
      slot.m.position.set(ix, 0.035, iz);
      slot.m.scale.setScalar(0.5 + rnd(0.5));
      slot.life = slot.life0 = 1.6 + rnd(0.8);
      slot.base = 0.3;
      slot.m.rotation.z = rnd(TAU);
      slot.m.visible = true;
    }

    // ---------- 水面凹陷盘 ----------
    this.depress.position.set(hx, 0.028, hz);
    this.depress.material.opacity = fade * s * 0.08;
    this.depress.scale.setScalar(1 + Math.sin(time * 5.1) * 0.04);
    this.depress.visible =     this.depress.material.opacity > 0.02;
  }
}

// ============================================================
// WaterRipples — 湖面专属：下洗同心圆涟漪（起飞/降落/悬停与水面联动）
// 关键几何：湖面场地的直升机停在混凝土浮筒平台上（甲板顶半径 6.8u，
// 30-world.js），飞行纯垂直起降——下洗柱先打在甲板上，壁面射流沿甲板
// 向外跑，冲出甲板边界才激振水面。所以涟漪不是从机腹正下方生成，
// 而是从甲板边缘外一圈开始向外辐射——这才是"与水面联动"的读感：
// 平台四周的水面持续泛出外传的同心波环，波前起步快、随能量耗散减速。
// 与 WashDecal 里"原地脉动"的波纹不同，这里是真正的外传波前。
// 环剖面：内半环波谷压暗 + 外缘波峰提亮（受光）。
// ============================================================
class WaterRipples {
  constructor(scene) {
    this.pool = [];
    this._spawned = 0;               // 调试/验证出口
    this.DECK_R = 7.1;               // 平台边缘；下洗柱越过边缘后才激起湖面波纹
    const geo = new THREE.RingGeometry(0.992, 1.0, 128, 1);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          uK: { value: 0 },
          uSeed: { value: i * 1.73 },
          uCrest: { value: new THREE.Color(0xb9dce4) },
          uTrough: { value: new THREE.Color(0x315d67) },
        },
        vertexShader: /* glsl */`
          uniform float uSeed;
          varying float vW;
          varying float vA;
          void main(){
            // 环带内归一化半径 0.992..1.0，只保留极窄波峰
            vW = clamp((length(position.xy) - 0.992) / 0.008, 0.0, 1.0);
            // 用不规则方位噪声打断圆环，波峰不是工程制图圆线
            vA = 0.35 + 0.65 * sin(atan(position.y, position.x) * 5.0 + uSeed
              + sin(atan(position.y, position.x) * 13.0 + uSeed * 1.7) * 1.1);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */`
          precision highp float;
          varying float vW;
          varying float vA;
          uniform float uK, uSeed;
          uniform vec3 uCrest, uTrough;
          void main(){
            float crest = smoothstep(0.20, 0.78, vW);
            float mask = smoothstep(0.05, 0.42, vA) * smoothstep(1.0, 0.60, vA);
            vec3 col = mix(uTrough, uCrest, crest);
            float a = (0.06 + 0.18 * crest) * mask * uK;
            if (!(a > 0.006)) discard;
            gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
          }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -PI / 2;
      m.renderOrder = 3;
      m.visible = false;
      scene.add(m);
      this.pool.push({ m, t: 0, life: 0, life0: 1, k0: 0, x: 0, z: 0 });
    }
    this._acc = 0;
  }

  clear() {
    for (const r of this.pool) { r.life = 0; r.m.visible = false; }
    this._acc = 0;
  }

  get alive() {
    return this.pool.reduce((n, r) => n + (r.life > 0 ? 1 : 0), 0);
  }

  update(dt, s, alt, hx, hz, wx, wz) {
    const active = s > 0.12 && alt < 9.0;
    if (active) {
      this._acc += dt * (0.55 + s * 1.3);      // 强时 ~1.8 枚/s，弱时 ~0.6 枚/s
      while (this._acc >= 1) {
        this._acc -= 1;
        const slot = this.pool.find(r => r.life <= 0);
        if (!slot) break;
        slot.life = slot.life0 = 3.4;
        slot.t = 0;
        slot.k0 = 0.4 + s * 0.5;               // 出生强度随下洗（克制：白环压白甲板易眩）
        slot.x = hx; slot.z = hz;
        slot.m.visible = true;
        this._spawned++;
      }
    } else {
      this._acc = 0;
    }
    // 重力波色散：从甲板边缘起步 ~4.6u/s，随能量耗散指数减速（τ≈1.1s）
    for (const r of this.pool) {
      if (r.life <= 0) continue;
      r.t += dt; r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const rad = this.DECK_R + 5.6 * (1 - Math.exp(-r.t / 1.1));
      // 波环微随风漂（波峰被风推着走一点）
      r.m.position.set(r.x + wx * r.t * 0.25, 0.022, r.z + wz * r.t * 0.25);
      r.m.scale.setScalar(rad);
      const k = Math.max(0, r.life / r.life0);
      r.m.material.uniforms.uK.value = r.k0 * k * (0.4 + 0.6 * k);
    }
  }
}

