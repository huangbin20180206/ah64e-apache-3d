// ============================================================
// 17-washfx.js — 下洗核心（WashParticles 涡环粒子；WashDecal 刷痕→22-washdecal.js；总装→28-washfx.js）
// [P0 拆分] 介质类→23-washmedia.js，地面痕迹类→21-washground.js — 旋翼下洗地面效应（写实版）
//
// 物理依据（实拍与 NASA/AHS 地面效应文献的共识形态）：
//   1. 下洗撞地后沿地面向外成"壁面射流"，速度先快后衰减；
//   2. 在约 1.5~2 倍旋翼半径处气流分离、卷成环形涡（ground vortex），
//      介质被抬升、到涡顶又被向内吸回 —— 这就是实拍里的"甜甜圈"云环；
//   3. 外流带旋翼转向的切向分量，颗粒沿螺旋线外抛而非直线；
//   4. 离地越高，涡环半径越大、强度越弱，超过约 2 倍旋翼直径基本消失；
//   5. 沙地会 brownout：云团抬到桨盘高度包住整机，能见度骤降；
//   6. 停转后云团靠自身惯性滞留数秒才散。
//
// 实现分三层：
//   WashParticles — 涡环粒子，运动全在顶点着色器里解析求解（CPU 零开销）
//   WashDecal     — 地面刷痕：放射状条纹 + 外传波环 + 旋流，远景主视觉
//   GrassField    — 草叶实例场（仅草地），近景细节
// ============================================================

// 各介质参数。r/rise 单位为模型单位（1u ≈ 2m），旋翼半径 3.23u
// opacity 要克制：粒子沿视线大量重叠，单粒 0.3 的透明度叠十几层就是一堵白墙。
// 实测 0.06~0.13 才能保住"半透气团"的观感（曾用 0.26 把整机糊没）。
const WASH = {
  // 停机坪：水泥地只有薄薄一层浮尘，涡环细而淡
  dust: {
    count: 900, colA: 0x9ba3a9, colB: 0x767e85,
    life: 1.9, r0: 0.8, rMax: 7.0, riseH: 2.2, roll: 0.36,
    swirl: 2.0, inward: 0.28, s0: 0.4, s1: 2.0, opacity: 0.060, add: false,
    dec: { colA: 0x8f969c, colB: 0x6b7278, amp: 0.30, wave: 5.5, spin: 0.55, rad: 9.5 },
    fog: 0.0,
  },
  // 草地：主视觉是倒伏放射纹 + 外传草浪，颗粒少（只有碎草屑与薄土雾）
  grass: {
    count: 520, colA: 0x93a06a, colB: 0x6a7548,
    life: 1.5, r0: 1.0, rMax: 6.2, riseH: 1.7, roll: 0.42,
    swirl: 2.4, inward: 0.22, s0: 0.26, s1: 1.3, opacity: 0.075, add: false,
    dec: { colA: 0x9aa46a, colB: 0x55613a, amp: 0.50, wave: 7.0, spin: 0.7, rad: 11.0 },
    fog: 0.0,
  },
  // 沙漠：brownout。粒子多、抬得高、寿命长，云团半吞整机。
  // 2026-09-02 拉满：真实 brownout 是"伸手不见五指"（下洗涡卷扬 + 地效
  // 再循环 + 桨尖涡扬沙，悬浮尘墙遮蔽全向视野）。雾峰按"机体 15u 距离
  // 仍留 ~79% 透射、40u 背景基本吞没"标定——遮蔽背景、保留主体轮廓。
  sand: {
    count: 3200, colA: 0xd9c298, colB: 0xb59a71,
    life: 3.6, r0: 0.7, rMax: 10.5, riseH: 9.0, roll: 0.26,
    swirl: 2.8, inward: 0.42, s0: 0.55, s1: 3.8, opacity: 0.13, add: false,
    // 手动反馈第 2 批：沙漠下洗盘 amp 0.80→0.50——用户持续反馈地面"很多同心圆"，
    // 沙漠 amp 全介质最高（0.80），波环 alpha 放大最明显；降档后仍可读但不抢眼
    dec: { colA: 0xf0dfba, colB: 0x8a7048, amp: 0.50, wave: 4.5, spin: 0.5, rad: 12.5 },
    fog: 3.8,
  },
  // 湖面：低矮水汽带 + 细小水滴。主要读感交给动态水面和波峰，
  // 粒子不能再做成覆盖整片画面的白云。
  spray: {
    count: 420, colA: 0xc9e4e8, colB: 0x6f9da5,
    life: 1.0, r0: 1.8, rMax: 5.8, riseH: 0.75, roll: 0.12,
    swirl: 1.6, inward: 0.18, s0: 0.18, s1: 0.75, opacity: 0.028, add: false,
    dec: { colA: 0xdff0f6, colB: 0x16323a, amp: 0.20, wave: 7.5, spin: 0.62, rad: 8.5 },
    fog: 0.10,
  },
};

// 下洗颗粒精灵：柔边团絮 + 内部噪声破形（纯高斯球会糊成一团光斑）
function makeWashSprite(N = 128) {
  const { c, x } = canvas2d(N);
  const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,.62)');
  g.addColorStop(0.74, 'rgba(255,255,255,.20)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  // 絮状破形：叠几团偏心的小亮斑，让轮廓不规则
  x.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 26; i++) {
    const a = rnd(TAU), d = rnd(N * 0.30);
    const px = N / 2 + Math.cos(a) * d, py = N / 2 + Math.sin(a) * d;
    const rr = rnd(N * 0.06, N * 0.20);
    const bg = x.createRadialGradient(px, py, 0, px, py, rr);
    bg.addColorStop(0, `rgba(255,255,255,${rnd(0.10, 0.26).toFixed(3)})`);
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = bg;
    x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

// ============================================================
// WashParticles — 涡环颗粒层
// 每颗粒子的整条轨迹在顶点着色器里按解析式求出，CPU 每帧只更新 4 个 uniform。
// 轨迹 = 壁面射流外扩（先快后慢） + 分离后抬升 + 涡顶回吸 + 切向螺旋。
// ============================================================
class WashParticles {
  constructor(scene, sprite) {
    this.scene = scene;
    const MAX = 1600;                    // 各介质用量的上限，切换时只改 instanceCount

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    // aSeed = [方位角 0..1, 半径/尺寸系数, 生命相位, 存活阈值]
    const seed = new Float32Array(MAX * 4);
    for (let i = 0; i < MAX; i++) {
      seed[i * 4 + 0] = rnd();
      seed[i * 4 + 1] = rnd();
      seed[i * 4 + 2] = rnd();
      // 阈值分布偏低次幂：弱下洗时也先有少量粒子，避免"开关式"突现
      seed[i * 4 + 3] = Math.pow(rnd(), 0.7);
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = MAX;
    this.geo = geo;
    this.MAX = MAX;
    this._quality = 1;
    this._count = MAX;

    this.uniforms = {
      uTime: { value: 0 }, uWash: { value: 0 }, uAlt: { value: 0 },
      uHeli: { value: new THREE.Vector2(0, 0) },
      uLife: { value: 2 }, uR0: { value: 0.8 }, uRMax: { value: 7 },
      uRiseH: { value: 2.4 }, uRoll: { value: 0.35 },
      uSwirl: { value: 2.2 }, uInward: { value: 0.3 },
      uS0: { value: 0.45 }, uS1: { value: 2.4 },
      uOpacity: { value: 0.18 },
      uColA: { value: new THREE.Color(0x9ba3a9) },
      uColB: { value: new THREE.Color(0x767e85) },
      uMap: { value: sprite },
      uWind: { value: new THREE.Vector2() },
    };

    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        precision highp float;
        attribute vec4 aSeed;
        uniform float uTime, uWash, uAlt, uLife, uR0, uRMax, uRiseH, uRoll;
        uniform float uSwirl, uInward, uS0, uS1;
        uniform vec2 uHeli;
        uniform vec2 uWind;
        varying vec2 vUv;
        varying float vA;
        varying float vMix;
        void main(){
          vUv = uv;
          float t = fract(uTime / uLife + aSeed.z);
          // 下洗弱时只有阈值低的粒子存活（渐进出现，不是整片突现）
          float alive = step(aSeed.w, uWash * 1.15);
          float kR = 0.55 + 0.9 * aSeed.y;

          // 地面效应：离地越高，涡环越大越散（超过 ~2 倍旋翼直径基本消失）
          float altK = 1.0 + uAlt * 0.14;
          float rMax = uRMax * kR * altK;
          // 壁面射流：出发快、外缘慢
          // 注意：pow 的底数一律夹到 >0。部分驱动把 pow(0.0, y) 算成 NaN，
          // NaN 会让片元里的 a < 0.004 判断恒假（NaN 的比较总是 false），
          // 于是本该 discard 的粒子以纯黑实心画出来 —— 曾整片画面出现阶梯状黑块。
          // 湍流撕环（2026-09-02 用户实测"同心圆沙环"）：同年龄粒子不再同步
          // 外扩——对【仅半径映射】的有效年龄做每粒子扰动 + 时变扰动，
          // 同年龄的密度壳被撕得不齐（真实沙暴的径向质量流是湍流团块，
          // 不是干净同心环；环是解析轨迹太整齐的产物）
          float tj = t + (aSeed.y - 0.5) * 0.30
                   + sin(aSeed.x * 23.7 + uTime * 0.9) * 0.09;
          // 三频正弦伪湍流（方位×年龄）：半径/高度/透明度三重相干一起撕——
          // 只撕半径不够：高度 y 与透明度 vA 仍是纯 t 函数时，同年龄粒子
          // 一起抬升、均匀透明，低视角下照样读成一圈圈横带（停机坪夜间
          // 扬尘复现的教训）。真实湍流同时打破三者。
          float turb = sin(aSeed.x * 61.7 + t * 9.2)
                     + sin(aSeed.x * 17.3 - t * 7.1 + 2.4)
                     + sin(aSeed.x * 43.9 + t * 11.7 + 4.9);
          turb *= 0.333;
          float rr = uR0 + (rMax - uR0) * (1.0 - pow(max(1.0 - tj, 1e-4), 2.3));
          rr *= 1.0 + turb * 0.42;
          // 涡环回吸：越过分离点后颗粒被卷回内侧，形成"甜甜圈"闭合感
          float sep = smoothstep(0.45, 1.0, t);
          rr -= rMax * uInward * sep * sep;

          // 切向螺旋（跟旋翼转向）
          float th = aSeed.x * 6.2831853 + uSwirl * t * (0.7 + 0.6 * aSeed.y);
          // 抬升：撞地后先贴地跑一段才被涡卷起来
          float y = uRiseH * kR * pow(max(t, 1e-4), 1.25) * smoothstep(0.05, 0.42, t);
          y += sin(t * 7.5 + aSeed.x * 21.0) * uRoll * t;   // 翻滚起伏
          y *= 1.0 + turb * 0.55;                           // 高度相干也撕（大辐度）
          y = max(y, 0.03);

          vec3 wp = vec3(uHeli.x + cos(th) * rr, y, uHeli.y + sin(th) * rr);

          // 风致漂移（P3-⑧）：颗粒滞空越久被吹向下风越远（云团被风整体搬运）
          wp.xz += uWind * t * uLife * 0.6;

          // 尺寸：随扩散膨胀（湍流卷吸），并随下洗强度略增
          float sz = mix(uS0, uS1, t) * (0.65 + 0.7 * aSeed.y) * (0.55 + 0.45 * uWash);
          sz *= alive;

          // 生命淡入淡出
          vA = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.52, 1.0, t)) * uWash * alive;
          vA *= 0.38 + 0.62 * (0.5 + 0.5 * turb);   // 方位疏密不均：整圆撕成弧段/团块
          vMix = aSeed.y;

          // 视空间billboard + 每粒自转
          float rot = aSeed.x * 6.2831853 + t * 2.4 * (aSeed.y - 0.5);
          float cs = cos(rot), sn = sin(rot);
          vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          mv.xy += q * sz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uColA, uColB;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vA;
        varying float vMix;
        void main(){
          float a = texture2D(uMap, vUv).a * vA * uOpacity;
          // NaN 防护：与 NaN 的比较恒假，漏网的 NaN 会画成纯黑实心块
          if (!(a > 0.004)) discard;
          gl_FragColor = vec4(mix(uColA, uColB, vMix), a);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;      // 位置在着色器里算，包围盒不可信
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // 按介质套用参数；count 决定实际绘制的实例数
  apply(p) {
    const u = this.uniforms;
    u.uLife.value = p.life;
    u.uR0.value = p.r0;
    u.uRMax.value = p.rMax;
    u.uRiseH.value = p.riseH;
    u.uRoll.value = p.roll;
    u.uSwirl.value = p.swirl;
    u.uInward.value = p.inward;
    u.uS0.value = p.s0;
    u.uS1.value = p.s1;
    u.uOpacity.value = p.opacity;
    u.uColA.value.setHex(p.colA);
    u.uColB.value.setHex(p.colB);
    this.mat.blending = p.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mat.needsUpdate = true;
    this._count = Math.min(p.count, this.MAX);   // 介质基准用量
    this._applyCount();
  }

  // 实际实例数 = 介质基准用量 × 画质系数。两者分别记录，
  // 否则"切介质"会冲掉画质降档、"降画质"又会冲掉介质用量。
  _applyCount() {
    const base = this._count || this.MAX;
    this.geo.instanceCount = Math.max(1, Math.floor(base * this._quality));
  }

  setQuality(scale = 1) {
    this._quality = clamp(scale, 0.25, 1);
    this._applyCount();
  }

  update(time, wash, alt, hx, hz, wx, wz) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uWash.value = wash;
    u.uAlt.value = alt;
    u.uHeli.value.set(hx, hz);
    u.uWind.value.set(wx, wz);
    this.mesh.visible = wash > 0.004;
  }
}

// ============================================================
// WashDecal — 地面刷痕层
// 一张贴地圆盘，全部图案在片元着色器里程序化生成：
//   放射状条纹（气流把介质刷成扇形辐条）+ 外传波环（脉动扩散）+ 整体旋流偏转
// 这是俯视/中远景的主视觉，比任何粒子都更能读出"地面被吹了"。
// ============================================================
