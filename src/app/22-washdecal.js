// ============================================================
// 22-washdecal.js — WashDecal 地面刷痕层（P1-D 拆迁）
// ============================================================
// [P1-D] 原 17-washfx.js 第三段。放射状条纹 + 外传波环 + 旋流，
// 远景主视觉。与 WashParticles（涡环粒子，留在 17）零互相引用，
// 仅被 28-washfx 总装实例化。逻辑零改动。
// ============================================================

class WashDecal {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 }, uWash: { value: 0 }, uAlt: { value: 0 },
      uAmp: { value: 0.4 }, uWave: { value: 6.0 }, uSpin: { value: 0.6 },
      uColA: { value: new THREE.Color(0x8f969c) },
      uColB: { value: new THREE.Color(0x6b7278) },
      uWater: { value: 0 },
      uWind: { value: new THREE.Vector2() },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec2 vP;
        void main(){
          vP = position.xy;                 // 盘面局部坐标（未旋转前的 XY）
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vP;
        uniform float uTime, uWash, uAlt, uAmp, uWave, uSpin, uWater;
        uniform vec3 uColA, uColB;
        uniform vec2 uWind;

        // 2D 值噪声：地面痕迹要的是湍流团块，不是一维条纹
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise2(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x),
                     mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main(){
          // 风偏变形（P3-⑧）：痕迹沿风向拉长并整体向下风偏移——下洗柱被风吹斜。
          // uWind 已在 JS 侧换算到盘面局部坐标（局部 y = -世界 z）
          float wm = length(uWind);
          vec2 wdn = wm > 1e-4 ? uWind / wm : vec2(1.0, 0.0);
          float along = dot(vP, wdn);
          vec2 q = vP - wdn * (along * wm * 0.12 + wm * 0.075);
          float r = length(q);
          float ang = atan(q.y, q.x);

          // 离地越高，作用半径越大、强度越低
          float altK = 1.0 + uAlt * 0.16;
          float reach = 1.0 / altK;

          // 中心留空（机腹正下方是滞止区，介质被压住不动）
          float core = smoothstep(0.05, 0.26, r * altK);
          // 外缘衰减
          float fall = 1.0 - smoothstep(0.32, 1.0, r * reach);
          float base = core * fall;

          // —— 采样坐标：风向世界坐标系（根治同心环的根处，2026-09-15）——
          // 历史三版都栽在"极性相位"（以机腹为圆心的相位）上：
          //   ① 直接用 ang         → 特征宽度随半径线性张开（风扇罩观感）
          //   ② 弧长 s = r·ang     → 世界尺度等宽了，但相位含 r×ang 交叉项
          //                          ⇒ 螺旋带，任何一瞬都读作"同心环"
          //   ③ 再叠 r×5.5/11/22   → 径向周期仅 1.14/0.57/0.29u ⇒ 十几~几十圈
          // 探针实证链（同机位消融）：关 WashDecal → 环全消；uWave=0 → 环全消；
          // 关其余 8 层 → 环不变；删掉 ③ 的周期项后沙漠明显好转、停机坪仍见 3~4 圈宽带
          // ⇒ 残留即 ② 的螺旋相位。物理上贴地下洗扫过地面留下的是【不规则冲蚀斑 +
          // 顺风条痕】，不存在以机腹为圆心的等间距环。
          // 现在在【风向坐标系】里采样二维噪声：径向相位彻底消失，各向异性只表现为
          // "沿风向略拉长"；整体缓慢旋转保留"下洗在转"的观感。
          vec2 wside = vec2(-wdn.y, wdn.x);
          vec2 nq = vec2(dot(vP, wdn) * 0.80, dot(vP, wside) * 1.45);
          float nca = cos(uTime * uSpin * 0.35), nsa = sin(uTime * uSpin * 0.35);
          nq = mat2(nca, nsa, -nsa, nca) * nq;
          float t1 = vnoise2(nq * 0.90);
          float t2 = vnoise2(nq * 1.90 + 17.0);
          float t3 = vnoise2(nq * 3.70 + 41.0);
          float turb = t1 * 0.50 + t2 * 0.32 + t3 * 0.18;
          turb = smoothstep(0.34, 0.68, turb);
          // 痕迹集中在分离半径附近（中心滞止、远端已衰减）
          turb *= smoothstep(0.06, 0.30, r * altK) * (1.0 - smoothstep(0.42, 0.95, r * reach));

          // —— 外传波环 ——
          // 原始环（水面用）：水没有干辐条，整圆波环就是水面的主视觉
          float wv = sin(r * uWave * reach - uTime * 4.2) * 0.5 + 0.5;
          wv = pow(max(wv, 1e-4), 2.2);
          float wv2 = sin(r * uWave * 0.45 * reach - uTime * 2.1 + 1.7) * 0.5 + 0.5;

          // —— 陆地波环：整项删除（2026-09-15 根治，用户第三次反馈"地面同心圆"）——
          // 探针实证（同机位逐层关闭 + uniform 对照，四场地正俯网格图）：
          //   ① 关 WashDecal 刷痕盘        → 地面同心环【完全消失】（其余 8 层均无关）
          //   ② uWave=0（令所有 sin(r·…) 在径向上恒定）→ 环【完全消失】
          //   ③ uSpin=0 / DuneSandFX / WashTracks / W.pad / W.far / W.duneFar / W.contact → 环无变化
          // 即环来自本段 sin(r * uWave * 1.9 * reach - …) 这类【径向周期项】：
          // sand 配置 wave=4.5 ⇒ 径向频率 8.55 rad/u ⇒ 环间距仅 ~0.73u（约 1.5m），
          // 在 2.0~10.7u 的包络带内排出十余圈规则同心环，俯视/低视角即"雷达靶标"。
          // 物理上旋翼吹蚀是【宽带湍流 + 分离带环形涡】，不会按固定波长排列成环；
          // 前两轮只压权重（wl 0.30→0.16、w2L 0.06→0.03）属治标，故整项删除。
          // 强度按原均值重标定：原 turb*(0.70+0.16*wl)*0.80 ≈ turb*0.576（wl 均值≈0.1），
          // 取 turb*0.58 + 0.285（并入原 w2L 的常数均值 ≈0.015），保持"吹痕可见但不抢眼"。
          float pat = turb * 0.58 + 0.285;

          // 关键：alpha 由"图案对基准的偏离量"驱动，而不是图案强度本身。
          // 若直接用 pat 当 alpha，pat 小的地方连暗色一起淡掉，整体只剩一层
          // 均匀压暗，俯视读不出任何形状（曾表现为地面只有一个模糊暗盘）。
          float dev = pat - 0.46;
          float a = base * abs(dev) * 2.8 * uWash * uAmp;

          // 水面：波环占主导（水不会有干辐条）
          float wpat = wv * 0.75 + wv2 * 0.45;
          float wdev = wpat - 0.40;
          a = mix(a, base * abs(wdev) * 3.2 * uWash * uAmp, uWater);
          dev = mix(dev, wdev, uWater);

          // NaN 防护：与 NaN 的比较恒假，漏网的 NaN 会画成纯黑实心块
          if (!(a > 0.004)) discard;
          // 亮=被吹起的介质，暗=露出的底层，按偏离方向二选一
          gl_FragColor = vec4(dev > 0.0 ? uColA : uColB, clamp(a, 0.0, 1.0));
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.02, 1, 96, 8), this.mat);
    this.mesh.rotation.x = -PI / 2;
    this.mesh.position.y = 0.018;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._dune = false;                 // 沙漠模式：贴花逐顶点贴合沙丘起伏
  }

  // 沙漠模式开关：开启后刷痕圆盘顶点随 duneH 高度场起伏——痕迹"铺"
  // 在沙丘上，而不是平盘被 r>7 的沙丘整个埋掉（旧实现只露中心平地）
  setDune(on) {
    this._dune = on;
    if (!on) {
      const posA = this.mesh.geometry.attributes.position;
      for (let i = 0; i < posA.count; i++) posA.setZ(i, 0);
      posA.needsUpdate = true;
      this.mesh.geometry.computeVertexNormals();
    }
  }

  apply(p, water) {
    const u = this.uniforms;
    u.uAmp.value = p.amp;
    u.uWave.value = p.wave;
    u.uSpin.value = p.spin;
    u.uColA.value.setHex(p.colA);
    u.uColB.value.setHex(p.colB);
    u.uWater.value = water ? 1 : 0;
    this._water = water;
    this._rad = p.rad;
    this.mat.blending = water ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mat.needsUpdate = true;
  }

  update(time, wash, alt, hx, hz, wx, wz) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uWash.value = wash;
    u.uAlt.value = alt;
    // 盘面局部 y = -世界 z（盘面绕 x 轴 -90° 后局部 +Y 指向世界 -Z）
    u.uWind.value.set(wx, -wz);
    this.mesh.position.set(hx, 0.018, hz);
    this.mesh.scale.setScalar(this._rad || 10);
    // 湖面已由连续水体 + 水花/涟漪专属层表现；这张陆地刷痕盘会把水面盖成白色椭圆，禁用。
    this.mesh.visible = wash > 0.004 && !this._water;
    // 沙漠：贴花顶点贴合沙丘高度（局部 z = 世界高度；每帧 873 顶点 × 解析式，开销可忽略）
    if (this._dune && this.mesh.visible) {
      const rad = this._rad || 10;
      const posA = this.mesh.geometry.attributes.position;
      for (let i = 0; i < posA.count; i++) {
        const lx = posA.getX(i), ly = posA.getY(i);
        // 关键：mesh.scale 是 rad，所以写回的必须是【局部】高度 = 世界高度 / rad。
        // 直接写世界高度会被整体缩放放大 rad 倍（沙漠 rad=12.5，duneH 峰值
        // 1.5u → 19u），圆盘被拉成几十米高的沙色幕布糊满全屏，
        // 表现为"降落时画面被沙尘条纹吞掉、机体半透明"。
        posA.setZ(i, duneH(hx + lx * rad, hz - ly * rad) / rad);
      }
      posA.needsUpdate = true;
      // 不再 computeVertexNormals：本材质是自定义 ShaderMaterial，只用 position，
      // 法线从未参与着色，每帧对 873 顶点重算纯属浪费。
    }
  }
}
