// ============================================================
// 40-post.js — 后处理：亮部提取 -> 高斯 mip 链 -> 叠加 -> ACES + 色散 + 暗角 + 颗粒
// ============================================================

const BLUR_W = [0.227027, 0.316216, 0.070270];   // 5-tap 可分离高斯

class Composer {
  constructor(renderer, W) {
    this.renderer = renderer;
    this.W = W;
    this.levels = 4;
    this.activeLevels = 4;
    this.enabled = true;
    this.uThresh = 1.42;
    this.uKnee = 0.60;
    this.strength = 0.55;
    this.exposure = 1.0;
    this.chroma = 1.0;
    this.grain = 1.0;
    this.vignette = 1.0;
    // 电影镜头包 S2/S3 状态（70-app 每帧驱动）
    this.sunPos = new THREE.Vector2(-2, -2);   // 太阳屏幕坐标（<-1 = 屏外）
    this.flare = 0.0;                          // 光晕强度
    this.flash = 0.0;                          // 击毁白闪
    this.shake = 0.0;                          // 震屏幅度
    // 电影镜头包第 2 阶段 M3：体积光 God Rays（70-app 每帧驱动）
    this.god = 0.0;                            // 体积光强度（沙暴加成由 70-app 算好传入）
    this.godOn = true;                         // 0.75 画质档关闭（setQuality 门控）
    this.godCol = new THREE.Vector3(1.0, 0.85, 0.6);  // 太阳光色（god 光柱着色）
    // 电影镜头包第 3 阶段 M2：景深 DOF（70-app 每帧驱动）
    this.dof = 0.0;                            // 景深强度 0..1（FPV/锁定目标启用）
    this.dofOn = true;                         // 0.75 画质档关闭（setQuality 门控）
    this.focus = 15;                           // 聚焦距离（相机空间，u）

    const opts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, samples: 4 });
    // M2 景深：可采样深度纹理（渲染场景时 renderer 自动写入，供 DOF pass 读取）
    this.sceneRT.depthTexture = new THREE.DepthTexture(2, 2);
    // 保存 RT 选项供低档释放后的惰性重建（修复七：原子重建/代 identity）
    this._rtOpts = opts;
    this._rtGen = 0;
    this.sceneRT.userData = { gen: 0 };
    this.sceneRT.depthTexture.userData = { gen: 0 };

    // 每级两张：A 存横向模糊结果，B 存纵向
    this.mips = [];
    for (let i = 0; i < this.levels; i++) {
      this.mips.push({
        a: new THREE.WebGLRenderTarget(2, 2, opts),
        b: new THREE.WebGLRenderTarget(2, 2, opts),
      });
    }

    // M3 体积光：低分辨率（1/4）径向光柱 RT
    this.godRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, samples: 0 });

    // M2 景深：半分辨率散焦 RT + pass（读 scene 彩色 + depth 深度，按
    // |focus-depth| 环形采样——光斑近似；仅 FPV/锁定目标启用，0.75 档关闭）
    this.dofRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, samples: 0 });
    this.dofPass = new FSQuad(new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        uFocus: { value: 45 },
        // 【2026-09-15 修正：原为 uDoF=2.0 的"硬半宽"——coc=(uFocus-vz)/2 在
        //  |Δ|≥2u 立刻饱和到 1，blurPx 打到 12（半分辨率像素）= 全分辨率 24px。
        //  后果：只要焦点与目标距离差 2u 以上，目标就糊成一团黑斑（用户实测
        //  "FPV 攻击目标全模糊、只能盲狙"）。改为【相对失焦】模型：
        //    rel = |vz-uFocus| / max(uFocus,1)
        //    k   = clamp((rel-uClear)/uFade, 0, 1);  blurPx = k*k*uMaxBlur
        //  uClear=0.30 ⇒ 焦点距离 ±30% 内基本清晰（45u 焦点 ⇒ 31.5~58.5u 全锐），
        //  uFade=0.60 过渡带，uMaxBlur=3.5（半分辨率像素 ≈ 全分辨率 7px）封顶。
        //  交战距离（35~48u 靶环）因此始终锐利，只有近景与远景才散焦。】
        uClear: { value: 0.30 },
        uFade: { value: 0.60 },
        uMaxBlur: { value: 3.5 },
        uNear: { value: 0.05 },
        uFar: { value: 2000 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: Composer.VS,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tScene, tDepth;
        uniform float uFocus, uClear, uFade, uMaxBlur, uNear, uFar;
        uniform vec2 uTexel;
        // 非线性 NDC 深度 -> 相机空间距离（相机到被摄物）
        float linZ(float ndc) { return uNear * uFar / (uFar - ndc * (uFar - uNear)); }
        void main(){
          float d = clamp(texture2D(tDepth, vUv).x, 0.0, 1.0);
          float vz = linZ(d);
          // 弥散圆 CoC（2026-09-15 重做，见 uniforms 注释）：相对失焦量按焦点
          // 距离归一——远景 20u 与近景 20u 的观感差本就不同；再经 uClear 清晰区
          // 与平方软启动，使"焦点附近一大段"保持锐利，只会把明显的前后景散焦。
          float rel = abs(vz - uFocus) / max(uFocus, 1.0);
          float k = clamp((rel - uClear) / max(uFade, 1e-3), 0.0, 1.0);
          float blurPx = k * k * uMaxBlur;
          vec3 col = texture2D(tScene, vUv).rgb;
          if (blurPx > 0.5) {
            // 8 方向 × 3 环同心采样，权重随环衰减（轻量 bokeh 近似，
            // 半分辨率下 24 采样/像素成本可控）
            vec3 acc = vec3(0.0);
            float wsum = 0.0;
            for (int i = 0; i < 8; i++) {
              float a = float(i) / 8.0 * 6.2831853;
              vec2 dir = vec2(cos(a), sin(a));
              for (int r = 1; r <= 3; r++) {
                vec2 off = dir * (blurPx * float(r) / 3.0) * uTexel;
                float w = 1.0 / float(r);
                acc += texture2D(tScene, vUv + off).rgb * w;
                wsum += w;
              }
            }
            col = (col * 0.45 + acc) / (0.45 + wsum);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));

    this.bright = new FSQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uThresh: { value: this.uThresh },
        uKnee: { value: this.uKnee },
      },
      vertexShader: Composer.VS,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uThresh, uKnee;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          // 软门限：knee 区间内平滑过渡，避免硬边
          float k = uKnee * uThresh + 1e-5;
          float soft = clamp(l - uThresh + k, 0.0, 2.0 * k);
          soft = soft * soft / (4.0 * k + 1e-5);
          float w = max(soft, l - uThresh) / max(l, 1e-5);
          gl_FragColor = vec4(c * w, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));

    this.blur = new FSQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: Composer.VS,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform vec2 uDir, uTexel;
        void main(){
          vec2 o = uDir * uTexel;
          vec3 s = texture2D(tDiffuse, vUv).rgb * ${BLUR_W[1].toFixed(6)};
          s += texture2D(tDiffuse, vUv + o).rgb * ${BLUR_W[0].toFixed(6)};
          s += texture2D(tDiffuse, vUv - o).rgb * ${BLUR_W[0].toFixed(6)};
          s += texture2D(tDiffuse, vUv + o * 2.0).rgb * ${BLUR_W[2].toFixed(6)};
          s += texture2D(tDiffuse, vUv - o * 2.0).rgb * ${BLUR_W[2].toFixed(6)};
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));

    this.copy = new FSQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uAmp: { value: 1.0 } },
      vertexShader: Composer.VS,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uAmp;
        void main(){ gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb * uAmp, 1.0); }`,
      blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, transparent: true,
    }));

    // M3 体积光：沿"像素→太阳"方向径向累积亮部亮度——太阳光被遮挡体
    //（机身/沙尘/云隙）切割，从太阳辐射出可见光柱。quarter 分辨率 + 20
    // 次采样控制成本；final pass 以太阳光色叠加（ACES 前，线性域）。
    this.godRays = new FSQuad(new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        uSunPos: { value: new THREE.Vector2(-2, -2) },
      },
      vertexShader: Composer.VS,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tScene;
        uniform vec2 uSunPos;
        void main(){
          vec2 d = vUv - uSunPos;
          float dist = clamp(length(d), 0.0, 0.95);
          vec2 dir = d / max(dist, 1e-5);
          float acc = 0.0;
          for (int i = 0; i < 20; i++) {
            float t = (float(i) + 0.5) / 20.0;
            vec3 c = texture2D(tScene, uSunPos + dir * t * dist).rgb;
            acc += dot(c, vec3(0.299, 0.587, 0.114));
          }
          acc /= 20.0;
          gl_FragColor = vec4(vec3(acc), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));

    this.final = new FSQuad(new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uExposure: { value: 1.0 },
        uBloom: { value: 0.55 },
        uChroma: { value: 1.0 },
        uGrain: { value: 1.0 },
        uVign: { value: 1.0 },
        uTime: { value: 0 },
        // 电影镜头包 S2/S3：镜头光晕 / 击毁白闪 / 震屏
        uSunPos: { value: new THREE.Vector2(-2, -2) },   // 太阳屏幕坐标（-2=屏外）
        uFlare: { value: 0.0 },                          // 光晕强度（太阳入屏才有）
        uFlash: { value: 0.0 },                          // 击毁白闪 0~1
        uShake: { value: 0.0 },                          // 震屏幅度（UV 偏移）
        // 电影镜头包 M3：体积光叠加（tGod 光柱图 + 强度 + 太阳光色）
        tGod: { value: null },
        uGod: { value: 0.0 },
        uGodCol: { value: new THREE.Vector3(1.0, 0.85, 0.6) },
      },
      vertexShader: Composer.VS,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tScene, tBloom, tGod;
        uniform float uExposure, uBloom, uChroma, uGrain, uVign, uTime;
        uniform vec2 uSunPos;
        uniform float uFlare, uFlash, uShake, uGod;
        uniform vec3 uGodCol;

        // ACES filmic 近似（Narkowicz）
        vec3 aces(vec3 x){
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main(){
          vec2 uv = vUv;
          // 震屏（电影镜头包 S3）：击毁冲击的 UV 随机偏移采样整幅画面
          if (uShake > 0.0005) {
            uv += (vec2(hash(vec2(uTime * 61.0, 3.7)), hash(vec2(uTime * 47.0, 9.2))) - 0.5) * uShake;
          }
          vec2 d = uv - 0.5;
          float r2 = dot(d, d);

          // 横向色散：R/B 通道按半径外扩
          float amt = uChroma * 0.0016 * (0.35 + r2);
          vec3 col;
          col.r = texture2D(tScene, uv + d * amt).r;
          col.g = texture2D(tScene, uv).g;
          col.b = texture2D(tScene, uv - d * amt).b;

          col += texture2D(tBloom, uv).rgb * uBloom;

          // 体积光（电影镜头包 M3）：径向光柱按太阳光色叠加在 ACES 前（线性域）。
          // 屏外太阳 / 0.75 画质档时 uGod=0 整段跳过，零开销
          if (uGod > 0.001) {
            col += texture2D(tGod, uv).rgb * uGod * uGodCol;
          }
          col *= uExposure;

          // 镜头光晕（电影镜头包 S2）：太阳入屏时的各向异性光条 + 光斑链。
          // 在 ACES 之前的线性域叠加（过曝过渡更真实）；太阳屏外 uFlare=0 整段跳过
          if (uFlare > 0.001) {
            vec2 sd = uv - uSunPos;
            float streak = exp(-abs(sd.y) * 90.0) * exp(-abs(sd.x) * 2.2);
            vec2 toC = (vec2(0.5) - uSunPos) * 1.55;
            float ghosts = 0.0;
            for (int i = 1; i <= 3; i++) {
              float fi = float(i);
              vec2 gp = uSunPos + toC * (0.34 * fi);
              float gd = length(uv - gp);
              float gr = 0.045 + 0.026 * fi;
              ghosts += smoothstep(gr, gr * 0.22, gd) * (0.32 / fi);
            }
            col += vec3(1.0, 0.87, 0.62) * (streak * 0.55 + ghosts * 0.5) * uFlare;
          }

          col = aces(col);

          // 击毁白闪（电影镜头包 S3）：ACES 之后叠加，保证"闪白"不被色调映射压暗
          if (uFlash > 0.002) {
            col = mix(col, vec3(1.0, 0.985, 0.95), clamp(uFlash, 0.0, 1.0) * 0.85);
          }

          // 暗角
          float v = smoothstep(0.86, 0.18, r2 * 1.55);
          col *= mix(1.0, v, uVign * 0.75);

          // 胶片颗粒
          float g = hash(uv * vec2(1024.0, 1024.0) + uTime) - 0.5;
          col += g * 0.022 * uGrain;

          // 手动 sRGB 编码（渲染器输出设为 Linear，避免二次转换）
          col = max(col, 0.0);
          vec3 srgb = mix(col * 12.92,
                          1.055 * pow(max(col, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055,
                          step(vec3(0.0031308), col));
          gl_FragColor = vec4(srgb, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
  }

  setQuality(q = 1) {
    this.quality = clamp(q, 0.5, 2);
    // 级数由 QUALITY_PRESETS 统一定义，避免这里和 05-config 各写一套阈值。
    this.activeLevels = clamp(qualityPreset(q).levels, 1, this.levels);
    // M3 体积光 / M2 景深（0.75 性能档关闭整类后处理）
    this.godOn = qualityPreset(q).levels >= 4;
    const wantDof = qualityPreset(q).levels >= 4;
    this.dofOn = wantDof;
    // 修复七（DOF GPU 资源生命周期闭环·原子重建）：depth 状态与目标不符时
    // 原子重建 sceneRT（旧含 depthTexture 附着的 render target 整体 dispose，
    // 新 RT 按档创建带/不带 depth）——JS 字段存在 ≠ framebuffer 已正确重绑；
    // 每代 identity 经 _rtGen 递增暴露（测试据引用变化/代号验证不引用旧对象）
    const hasDepth = !!(this.sceneRT && this.sceneRT.depthTexture);
    if (hasDepth !== wantDof) this._rebuildSceneRT(wantDof);
    if (wantDof) this._ensureDof();
    else this._releaseDof();
  }

  // 原子重建 sceneRT（修复七）：dispose 旧 RT（含 depthTexture 附着）后按档
  // 创建新场景 RT（带/不带 depth），并递增代 ID。mips/godRT 独立不受影响。
  _rebuildSceneRT(withDepth) {
    if (this.sceneRT) this.sceneRT.dispose();       // 旧 RT 连同 depth 附件整体释放
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, { ...this._rtOpts, samples: 4 });
    this._rtGen = (this._rtGen || 0) + 1;
    this.sceneRT.userData = { gen: this._rtGen };
    if (withDepth) {
      this.sceneRT.depthTexture = new THREE.DepthTexture(2, 2);
      this.sceneRT.depthTexture.userData = { gen: this._rtGen };
    }
    this._dofSized = false;
  }

  // 惰性重建 DOF 专属资源（首次或从 0.75 档切回时；depthTexture 已由重建场景带）
  _ensureDof() {
    if (this.dofRT) { this._dofSized = false; return; }
    this.dofRT = new THREE.WebGLRenderTarget(2, 2, { ...this._rtOpts, samples: 0 });
    this.dofRT.userData = { gen: this._rtGen || 0 };
    this._dofSized = false;
    if (this.w) this.setSize(this.w, this.h);   // 立即按当前尺寸重建分配
  }
  // 释放 DOF 专属资源（0.75 档：不执行 DOF pass，资源不持续存在；sceneRT 的
  // depth 分离由 _rebuildSceneRT 原子处理）
  _releaseDof() {
    if (this.dofRT) { this.dofRT.dispose(); this.dofRT = null; }
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    this.godRT.setSize(Math.max(1, Math.floor(w / 4)), Math.max(1, Math.floor(h / 4)));
    // DOF 资源只在存在时 resize（0.75 档已释放 → 跳过；恢复档 _ensureDof 重建）
    if (this.dofRT) {
      this.dofRT.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
    }
    if (this.sceneRT.depthTexture) {
      this.sceneRT.depthTexture.image.width = w;
      this.sceneRT.depthTexture.image.height = h;
    }
    for (let i = 0; i < this.levels; i++) {
      const s = 1 << (i + 1);
      const mw = Math.max(1, Math.floor(w / s)), mh = Math.max(1, Math.floor(h / s));
      this.mips[i].a.setSize(mw, mh);
      this.mips[i].b.setSize(mw, mh);
    }
  }

  dispose() {
    for (const m of this.mips) { m.a.dispose(); m.b.dispose(); }
    this.sceneRT.dispose();
    this.godRT.dispose();
    if (this.dofRT) this.dofRT.dispose();
    this.bright.dispose(); this.blur.dispose(); this.copy.dispose(); this.godRays.dispose(); this.dofPass.dispose(); this.final.dispose();
  }

  render(scene, camera, time) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    // renderer.info 每次 render 都会重置，主场景的绘制次数得在这里抓
    this.drawCalls = r.info.render.calls;

    // 修复七（合成顺序）：DOF 先于一切——若激活，先对 scene 做景深散焦生成
    // dofRT，后续 Bright（Bloom）与 God Rays 都从 dofRT 提取/采样，最终
    // tScene 直接用 dofRT。这保证景深处理"完整场景"，而 Bloom/God Rays 叠加
    // 在已景深的画面上——不再用 tDof 0.85 权重混回把光效压到 15%。
    // 未激活（非 FPV/0.75 档）时 tScene 仍用 sceneRT，零额外开销。
    this._dofActive = !!(this.dofOn && this.dof > 0.005 && this.dofRT);
    const sceneSrc = this._dofActive ? this.dofRT : this.sceneRT;
    if (this._dofActive) {
      const dp = this.dofPass.mat.uniforms;
      dp.tScene.value = this.sceneRT.texture;
      dp.tDepth.value = this.sceneRT.depthTexture;
      dp.uFocus.value = this.focus;
      dp.uTexel.value.set(1 / this.dofRT.width, 1 / this.dofRT.height);
      this.dofPass.render(r, this.dofRT);
    }

    if (this.enabled && this.strength > 0.001) {
      // 亮部提取 -> mip0 的 b，横向模糊再读它写 a，避免同一张 RT 既当输入又当输出
      this.bright.mat.uniforms.tDiffuse.value = sceneSrc.texture;
      this.bright.mat.uniforms.uThresh.value = this.uThresh;
      this.bright.mat.uniforms.uKnee.value = this.uKnee;
      this.bright.render(r, this.mips[0].b);

      // 逐级：横向 + 纵向模糊，并把上一级降采样喂给下一级
      for (let i = 0; i < this.activeLevels; i++) {
        const m = this.mips[i];
        const src = i === 0 ? m.b : this.mips[i - 1].b;
        const tw = m.a.width, th = m.a.height;
        const u = this.blur.mat.uniforms;

        u.tDiffuse.value = src.texture;
        u.uDir.value.set(1, 0);
        u.uTexel.value.set(1 / tw, 1 / th);
        this.blur.render(r, m.a);

        u.tDiffuse.value = m.a.texture;
        u.uDir.value.set(0, 1);
        this.blur.render(r, m.b);
      }

      // 加法上采样：把 1..n 级叠加到第 0 级。
      // 必须先关 autoClear——否则每渲染一级前 mips[0].b 都会被清屏色冲掉，
      // 最终只剩最后一级 bloom 生效，前 3 级中高频辉光全部丢失。
      r.autoClear = false;
      r.setRenderTarget(this.mips[0].b);
      r.clear();
      const cu = this.copy.mat.uniforms;
      // 低档位只模糊了 activeLevels 级，越界的 mip 里是上一次高档位的残留
      // （或未初始化内容），必须按 activeLevels 收口。同时把权重归一到
      // 满档位的总量，避免"性能档一开辉光就整体变暗"。
      const top = Math.max(2, this.activeLevels);
      let norm = 0;
      for (let i = 1; i < top; i++) norm += 1 / (i + 1);
      let full = 0;
      for (let i = 1; i < this.levels; i++) full += 1 / (i + 1);
      const gain = norm > 1e-6 ? full / norm : 1;
      for (let i = 1; i < top; i++) {
        cu.tDiffuse.value = this.mips[i].b.texture;
        cu.uAmp.value = gain / (i + 1);
        r.render(this.copy.scene, this.copy.cam);
      }
      r.autoClear = true;
    }

    const f = this.final.mat.uniforms;
    f.tScene.value = sceneSrc.texture;   // 修复七：DOF 激活时=已景深场景（后续光效在其上叠加）
    f.tBloom.value = this.mips[0].b.texture;
    f.uExposure.value = this.exposure;
    f.uBloom.value = this.enabled ? this.strength : 0.0;
    f.uChroma.value = this.chroma;
    f.uGrain.value = this.grain;
    f.uVign.value = this.vignette;
    f.uTime.value = time;
    // 电影镜头包 S2/S3：光晕 / 白闪 / 震屏（值由 70-app 每帧驱动）
    f.uSunPos.value.copy(this.sunPos);
    f.uFlare.value = this.flare;
    f.uFlash.value = this.flash;
    f.uShake.value = this.shake;
    // 电影镜头包 M3：体积光——太阳屏内 + 强度阈值 + 画质档门控三者同时满足才
    // 渲染光柱 pass（屏外/0.75 档/强度≈0 时跳过，uGod=0 让 final 零开销）
    const sunOn = this.sunPos.x > -0.15 && this.sunPos.x < 1.15
               && this.sunPos.y > -0.15 && this.sunPos.y < 1.15;   // 与 S2 flare 同余量（低角度太阳贴边仍算屏内）
    this._godActive = !!(this.godOn && this.god > 0.001 && sunOn);
    if (this._godActive) {
      const g = this.godRays.mat.uniforms;
      g.tScene.value = sceneSrc.texture;   // 修复七：God Rays 在已景深场景上提取
      g.uSunPos.value.copy(this.sunPos);
      this.godRays.render(r, this.godRT);
    }
    f.tGod.value = this.godRT.texture;
    f.uGod.value = this._godActive ? this.god : 0;
    f.uGodCol.value.copy(this.godCol);
    this.final.render(r, null);
  }
}

Composer.VS = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
