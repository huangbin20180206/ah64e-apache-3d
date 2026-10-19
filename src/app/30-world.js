// ============================================================
// 30-world.js — 搭建场景对象：天空球 / 灯光 / 停机坪 / 远景 / PMREM（环境切换→32-envpreset.js）
// ============================================================

function buildWorld(renderer) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 2000);
  camera.position.set(7.5, 3.4, 9.5);

  // ---- 天空球：半径 900，永远最先画，不写深度 ----
  const skyMat = skyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), skyMat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- 灯光 ----
  const sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8;
  sc.near = 0.5; sc.far = 42;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 1.6;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xbcd0e8, 0.3);
  fill.position.set(-6, 4.5, -7);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffe6c4, 0.35);
  rim.position.set(2, 1.6, -9);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight(0xbcd2e8, 0x3a3a34, 0.55);
  scene.add(hemi);

  // ---- 停机坪 ----
  const padMaps = makeHelipad(1536);
  const padMat = new THREE.MeshStandardMaterial({
    map: padMaps.map,
    normalMap: padMaps.normalMap,
    roughnessMap: padMaps.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  // 盘面用 RingGeometry(内半径 0) 而不是 CircleGeometry：后者是单个三角扇，
  // 除圆心外只有一圈边缘顶点——沙漠的 duneH 顶点变形无处落脚，只能把【盘缘】
  // 抬成波浪，盘内始终是绝对平面。表现就是"沙丘看不见，只有边上一圈起伏环"。
  // 24 圈径向细分（径向间距 0.62u，沙丘脊距 7.5u → 每道脊约 12 个采样）后
  // 沙丘才真的是立体的；三角数约 6k，可忽略。
  const pad = new THREE.Mesh(new THREE.RingGeometry(0, 15, 128, 24), padMat);
  pad.rotation.x = -PI / 2;
  pad.position.y = GROUND_Y;
  pad.receiveShadow = true;
  scene.add(pad);

  // 湖面专用材质：不是一张会发亮的贴图，而是有微幅几何起伏、双尺度波向、
  // 视角 Fresnel 高光和浮台边缘泡沫的动态水面。停机坪仍使用原 PBR 材质。
  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(0xffffff) },
    uSunI: { value: 1.0 },
    uSky: { value: new THREE.Color(0x8fb2bc) },
    uFogCol: { value: new THREE.Color(0x8fb2bc) },
    uFogD: { value: 0.006 },
    uWash: { value: 0 },                     // 下洗强度（吹平小波+白沫）
    uHeli: { value: new THREE.Vector2(0, 0) },
    // 湖面不透明度（P3-⑦）：0.62 让镜像机体从水下透出——9 月水面重写时
    // shader 硬编码 alpha=1.0 且 transparent:false，倒影被整片湖水盖死
    uAlpha: { value: 0.62 },
    // 夜度系数（P29）：沿用环境预设 stars 值（night 1.0 / dusk 0.25 / day 0），
    // 驱动夜间月光碎金光路与边缘泡沫的冷光感
    uNight: { value: 0 },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDepth;

      float wave(vec2 p) {
        float a = sin(dot(p, vec2(0.72, 0.31)) * 1.55 + uTime * 0.72);
        float b = sin(dot(p, vec2(-0.28, 0.91)) * 2.75 - uTime * 0.51 + 1.7);
        float c = sin(dot(p, vec2(0.96, -0.18)) * 6.6 + uTime * 1.25);
        // 近浮台处叠一圈衰减波：下洗能量传到水面后才形成局部波纹。
        float r = length(p);
        float wake = sin((r - 7.15) * 7.5 - uTime * 2.4) * exp(-max(r - 7.15, 0.0) * 0.32);
        float h = a * 0.030 + b * 0.018 + c * 0.006 + wake * 0.012;
        // 平台甲板（顶面 y=0.005）不可被浪峰淹没：近台（r<9）浪峰钳到
        // -0.006 以下。波浪总幅 ±0.066 + 基面 -0.015 → 波峰最高 +0.051，
        // 会周期性漫过甲板 4.6cm——不透明水面盖住甲板又退开，就是用户
        // 实测的"平台一会儿消失一会儿出现"（可见性标志全程未翻转）。
        h = mix(h, min(h, -0.006), smoothstep(9.0, 6.5, r));
        return h;
      }

      void main() {
        vec3 p = position;
        vec2 q = p.xy;
        float h = wave(q);
        p.z += h;
        vec2 e = vec2(0.035, 0.0);
        float dx = (wave(q + e.xy) - wave(q - e.xy)) / (2.0 * e.x);
        float dy = (wave(q + e.yx) - wave(q - e.yx)) / (2.0 * e.x);
        vNormal = normalize(normalMatrix * vec3(-dx, -dy, 1.0));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform float uTime, uSunI, uFogD, uWash, uAlpha, uNight;
      uniform vec3 uSunDir, uSunCol, uSky, uFogCol;
      uniform vec2 uHeli;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDepth;

      void main() {
        vec2 p = vWorld.xz;
        float r = length(p);
        vec3 n = normalize(vNormal);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float ndv = max(dot(n, viewDir), 0.0);
        float fresnel = pow(1.0 - ndv, 3.0);

        // 两组交叉风浪 + 局部平台尾流：方向性必须能在低空镜头读出。
        float w1 = sin(dot(p, vec2(0.76, 0.27)) * 5.0 + uTime * 1.25);
        float w2 = sin(dot(p, vec2(-0.22, 0.91)) * 8.5 - uTime * 0.82 + 1.4);
        float w3 = sin(dot(p, vec2(0.97, -0.12)) * 5.0 + uTime * 0.55);
        float chop = w1 * 0.55 + w2 * 0.35 + w3 * 0.10;
        // 下洗交互（2026-09-02）：桨盘风把作用圈内的小波吹平、浪尖刮出白沫
        // P29：作用半径 10.5→14.5u——悬停 4u 时壁面射流到平台边缘（r≈7u）
        // 仍有 0.5+ 强度，旧半径在此只剩 0.27，"吹平+白沫"弱到读不出来
        float washD = length(p - uHeli);
        float washK = uWash * smoothstep(14.5, 1.5, washD);
        chop *= 1.0 - washK * 0.85;
        // —— 深浅色渐变（P29）：径向带 + 方位/低频噪声调制 ——
        // 纯径向 smoothstep 的等色线是完美圆，俯视读成靶环（沙漠沙丘边界
        // 的教训）；方位谐波 + 缓漂移让浅水带呈不规则"海湾状"，近平台仍
        // 偏浅亮（浅水托底给浮台尺度感）。
        float ang = atan(p.y, p.x);
        float shoreNz = 0.5 * sin(ang * 3.0 + p.x * 0.11 + uTime * 0.05)
                      + 0.5 * sin(ang * 5.0 - p.y * 0.13 + 1.7);
        float shallow = smoothstep(12.0 + shoreNz * 2.8, 0.0, r);
        vec3 deep = vec3(0.016, 0.095, 0.130);
        vec3 shallowCol = vec3(0.055, 0.245, 0.285);
        vec3 col = mix(deep, shallowCol, shallow * 0.65);
        col *= 0.96 + chop * 0.045;
        // 水体明暗（P29）：大尺度缓动斑块——湖是活水不是匀色塑料；
        // 幅度压到 2.5% 防止读成第二套条纹
        col *= 0.975 + 0.025 * sin(p.x * 0.33 + uTime * 0.11)
                            * sin(p.y * 0.29 - uTime * 0.09);

        // 方向性波峰不单独叠加规则亮线：低频 chop 已经提供连续风浪，
        // 额外正弦波会在大水面投影成整齐条纹，反而像程序网格。

        // 太阳镜面高光 + 天空反射；Fresnel 让斜视角的水面边缘更亮。
        vec3 sunDir = normalize(uSunDir);
        // 碎金光路（2026-09-02）：高频微法线扰动镜面方向，太阳在水面
        // 拉出一条随风闪烁的碎光带——平静水面的"真实感"主要来自它
        vec2 rp = p * 2.4;
        float g1 = sin(rp.x * 2.3 + uTime * 3.4) + sin(rp.y * 1.9 - uTime * 2.6);
        float g2 = sin((rp.x - rp.y) * 1.4 + uTime * 1.9);
        vec3 microN = normalize(n + vec3(g1 * 0.034, 0.0, g2 * 0.034));
        vec3 refl = reflect(-sunDir, microN);
        // P29：日间高光/碎金加密提亮；夜间 uNight≈1 抬月亮碎金光路
        //（uSunCol 夜间即月光冷蓝 0x9fc4ff），bloom 把峰值推成水面银光带
        float spec = pow(max(dot(refl, viewDir), 0.0), 46.0) * uSunI * 2.1;
        float glitter = pow(max(dot(refl, viewDir), 0.0), 140.0)
                      * uSunI * (3.9 + uNight * 5.2);
        col += uSunCol * (spec * (0.25 + fresnel * 0.9) + glitter * (0.85 + 0.15 * uNight));
        col += uSky * (0.08 + fresnel * 0.34);
        col += vec3(0.92, 0.96, 1.0) * washK * (0.10 + 0.06 * chop);

        // —— 浮台边缘泡沫/浪花（P29）：贴平台外缘的洗浪泡沫带 ——
        // 平台是圆形混凝土台（deck r≈6.8），外缘受浪拍打起沫是物理事实。
        // 反"霓虹环"四重设计（用户多次实测对"规整圆环"极敏感）：
        //   ① 沫圈内外半径按低频方位谐波抖动 ±0.85u——环宽沿圈起伏，不是几何圆；
        //   ② 亮度走"方位噪声 × 拍浪节律（纯方位相位，禁径向频率——那会出放射刷痕）"；
        //   ③ 颗粒用交叉耦合频率（sin·sin 可分离积会排成网点阵，必须 x/y 混频）；
        //   ④ 峰值 mix 0.50 封顶、外沿拖到 8.3u 缓消——湿沫晕染不是描线。
        // 纯着色器实现，零新增 draw。夜间被雾/曝光自然压暗。
        float fe = 0.55 * sin(ang * 2.0 + 0.9) + 0.35 * sin(ang * 4.0 - 1.6);
        float fa = ang * 6.0 + uTime * 0.6;
        float fnz = 0.60 + 0.40 * sin(fa) * (0.62 + 0.38 * sin(fa * 2.7 + 1.3));
        float fband = smoothstep(6.74, 7.04 + fe, r)
                    * (1.0 - smoothstep(7.14 + fe, 8.3, r));
        float lap = 0.66 + 0.34 * sin(uTime * 1.9 + ang * 3.0 + sin(ang * 7.0) * 0.8);
        float fgrain = 0.80 + 0.20 * sin(p.x * 23.7 + p.y * 17.3 + uTime * 0.4)
                              * sin(p.x * 11.3 - p.y * 29.1 - uTime * 0.3);
        float foam = fband * fnz * lap * fgrain * (0.55 + 0.45 * washK + 0.15 * chop);
        col = mix(col, vec3(0.72, 0.80, 0.82), clamp(foam, 0.0, 0.50));

        // 水面本身不再画固定半径的发光圆环；局部下洗波前由 WaterRipples 负责。
        // 这里仅保留极轻的随机镜面破碎，避免水面变成一整圈白线。

        float fog = 1.0 - exp(-uFogD * uFogD * vDepth * vDepth);
        col = mix(col, uFogCol, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(max(col, 0.0), uAlpha);
      }`,
  });
  function updateWater(time, wash, alt, hx, hz) {
    waterUniforms.uTime.value = time;
    // P29 断点修复：70-app loop 每帧传 (time, strength, alt, hx, hz)，旧签名
    // 只收 time——uWash/uHeli 从未被赋值，"下洗吹平+白沫"整段着色器是死
    // 代码（P8 targets.update 同款断点链）。现在接通：低空下洗真的会把
    // 平台四周的小波吹平、刮出白沫。alt 不用于着色（washfx.strength 已含
    // 离地衰减），签名保持与调用点一致。
    waterUniforms.uWash.value = wash || 0;
    if (hx !== undefined) waterUniforms.uHeli.value.set(hx, hz);
    waterUniforms.uSunDir.value.copy(sun.position).normalize();
    waterUniforms.uSunCol.value.copy(sun.color);
    waterUniforms.uSunI.value = sun.intensity;
    waterUniforms.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
    // 夜度系数（P29）：月光碎金光路驱动，沿用预设 stars（night 1 / dusk 0.25）
    waterUniforms.uNight.value = (ENV_PRESETS[envKeyRef.v] || ENV_PRESETS.day).stars;
    if (scene.fog) {
      waterUniforms.uFogCol.value.copy(scene.fog.color);
      waterUniforms.uFogD.value = scene.fog.density;
    }
    lake.material = waterMat;
  }

  // 水体连续铺到远景：不能只把 15u 近景圆盘切成水材质，否则边缘会像一个圆形水池。
  const lake = new THREE.Mesh(new THREE.CircleGeometry(600, 128), waterMat);
  lake.rotation.x = -PI / 2;
  lake.position.y = WATER_Y;
  lake.receiveShadow = false;
  lake.visible = false;
  scene.add(lake);

  // ---- 远景地面 ----
  const farBase = makeFarGround(512);
  const farMat = new THREE.MeshStandardMaterial({
    map: farBase, roughness: 0.96, metalness: 0.0,
  });
  const far = new THREE.Mesh(new THREE.CircleGeometry(600, 64), farMat);
  far.rotation.x = -PI / 2;
  far.position.y = GROUND_Y - 0.012;
  scene.add(far);

  // ---- 远景巨型沙丘（仅沙漠显示，2026-09-02）：独立网格，不动共享远景盘 ----
  // 复用 farMat（同贴图同色调同雾）；沙丘环外移后只剩 16.5u 环带，
  // 网格 220 段（间距 2.1u）+ 平滑法线——自然风积沙丘是平滑的，
  // flatShading 逐面明暗会读成"大理石堆砌"（用户实测），已弃用
  const duneFarGeo = new THREE.PlaneGeometry(470, 470, 220, 220);
  duneFarGeo.rotateX(-PI / 2);
  {
    const pos = duneFarGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, duneFarH(pos.getX(i), pos.getZ(i)) - 0.004);
    }
    duneFarGeo.computeVertexNormals();
  }
  // 独立材质（farMat 的深一档副本）：与沙原的反照率差是起伏可读性的根
  const duneFarMat = farMat.clone();
  duneFarMat.color.multiplyScalar(0.78);
  const duneFar = new THREE.Mesh(duneFarGeo, duneFarMat);
  duneFar.position.y = GROUND_Y;
  duneFar.visible = false;
  scene.add(duneFar);

  // ---- 场地切换缓存：程序化贴图只生成一次，避免反复切换造成 CPU/GPU 资源增长 ----
  const terrainMaps = new Map();
  terrainMaps.set('pad', { map: padMaps.map, normalMap: padMaps.normalMap, roughnessMap: padMaps.roughnessMap, farTex: farBase });

  // ---- 场地切换：近景地面材质 / 远景色调 / 雾 ----
  let terrainKey = 'pad';

  // 沙漠沙丘：near 盘面几何按低频噪声起伏（setTerrain 时重建高度）
  let dune = null;                     // 引用 pad 的几何（沙漠时变形，离开时复原）
  let duneOrigZ = null;                // 原始平整 z 值（首次变形前缓存）。
                                       // 旧实现是空数组导致 set() 复制 0 个元素——
                                       // 切出沙漠后沙丘永久残留（湖面/草地出现"丘陵"的根因）

  // 水上浮筒平台（湖面场景）：混凝土圆台 + 4 支撑浮筒，直升机停其上
  let padPlatform = null;
  function buildPadPlatform() {
    const g = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ color: 0x45585d, roughness: 0.94, metalness: 0.22 });
    const floatMat = new THREE.MeshStandardMaterial({ color: 0x1d3037, roughness: 0.76, metalness: 0.48 });
    // 2026-10-19 PC 复查：原甲板与水面齐平且中心挖空，截图里像一张浮在水上的玻璃圆片，
    // 且直升机停在"洞"上不合理。改为实心甲板 + 0.5u 干舷（WATER_Y 同步下沉到 -0.5），
    // 侧壁伸入水下，读起来是一座有厚度的浮台。
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 6.95, 0.75, 48, 1, true), conc);
    deck.position.y = -0.36;
    deck.receiveShadow = true;
    g.add(deck);
    const deckTop = new THREE.Mesh(new THREE.CircleGeometry(6.82, 48), conc);
    deckTop.rotation.x = -PI / 2;
    deckTop.position.y = 0.005;
    deckTop.receiveShadow = true;
    g.add(deckTop);
    // 甲板边缘警示环（黄色防滑漆），给出尺度和边界
    const edge = new THREE.Mesh(new THREE.RingGeometry(6.35, 6.6, 48), new THREE.MeshStandardMaterial({ color: 0x9a8a3a, roughness: 0.9 }));
    edge.rotation.x = -PI / 2;
    edge.position.y = 0.012;
    g.add(edge);
    // 中心 H 标使用暗灰防滑漆，不再用白色高亮材质
    // 平台只承担停机逻辑，标识不做高亮白块；水面反射和边缘泡沫负责尺度感。
    const hMat = new THREE.MeshStandardMaterial({ color: 0x8a9699, roughness: 0.88, metalness: 0.16 });
    // H 标是甲板上的一层漆（贴地薄片），不是凸起的木条；尺寸按真实停机坪比例放大
    for (const hx of [-1.25, 1.25]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 3.6), hMat);
      leg.position.set(hx, 0.012, 0);
      g.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.012, 0.5), hMat);
    bar.position.y = 0.012;
    g.add(bar);
    // 四角浮筒（封闭圆柱横置）
    for (const [fx, fz] of [[-4.6, -4.6], [4.6, -4.6], [-4.6, 4.6], [4.6, 4.6]]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 4.6, 12), floatMat);
      f.rotation.z = PI / 2;
      f.rotation.y = Math.atan2(fx, fz);
      f.position.set(fx * 0.92, -0.62, fz * 0.92);
      g.add(f);
    }
    // 浮筒之间的钢制连接梁：平台有结构重量，不是漂在水面的一张圆片
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x31464b, roughness: 0.62, metalness: 0.58 });
    for (const z of [-5.0, 5.0]) addBox(g, new THREE.BoxGeometry(9.5, 0.12, 0.14), beamMat, [0, -0.32, z]);
    for (const x of [-5.0, 5.0]) addBox(g, new THREE.BoxGeometry(0.14, 0.12, 9.5), beamMat, [x, -0.32, 0]);
    g.position.y = 0;                  // 台面与地面 y=0 对齐
    g.visible = false;
    scene.add(g);
    return g;
  }
  padPlatform = buildPadPlatform();

  function setTerrain(key) {
    const T = TERRAINS[key];
    if (!T || key === terrainKey) return false;
    terrainKey = key;

    if (T.make) {
      let maps = terrainMaps.get(key);
      if (!maps) {
        const made = T.make();
        // farTex 独立一份 repeat，避免修改近景 map 的采样状态。
        const farTex = made.map.clone();
        farTex.needsUpdate = true;
        farTex.repeat.setScalar(made.map.repeat.x * 40);
        // —— P30：r=15 盘界"固定纹路"根治（消融定案见下）——
        // RingGeometry(0,15) 与 CircleGeometry(600) 的 UV 都把各自直径映到
        // 0..1，repeat×40 恰使盘内外 texel 密度一致（同 tile 尺寸），但常数
        // 项差 (F−P)/2 个 tile → far 相对 pad 错开半 tile，贴图内容在 r=15
        // 圆周跳变；更关键的是 pad 有 normalMap 微凹凸而 far 没有——两侧
        // 光照响应不同，远距俯瞰就是一圈"浅黄绿色带"（用户实测：草地上
        // 明显一个固定位置的纹路；偏移悬停消融证明它钉在停机坪原点）。
        // 修复 = far 的 map 与 normalMap 都成为 pad 的【解析延拓】：
        // offset=−(F−P)/2 使采样坐标逐点相等，farNormal 同图 clone 同式对齐，
        // 接缝两侧内容与微凹凸光照严格连续。同图 clone 非新增资产、零 draw。
        const P = made.map.repeat.x;
        farTex.offset.set(-(P * 40 - P) / 2, -(P * 40 - P) / 2);
        let farNormal = null;
        if (made.normalMap) {
          const PN = made.normalMap.repeat.x;
          farNormal = made.normalMap.clone();
          farNormal.needsUpdate = true;
          farNormal.repeat.setScalar(PN * 40);
          farNormal.offset.set(-(PN * 40 - PN) / 2, -(PN * 40 - PN) / 2);
        }
        maps = { ...made, farTex, farNormal };
        terrainMaps.set(key, maps);
      }
      padMat.map = maps.map;
      padMat.normalMap = maps.normalMap;
      padMat.roughnessMap = null;
      padMat.roughness = T.water ? 0.16 : 0.95;
      padMat.metalness = T.water ? 0.3 : 0.0;
      padMat.normalScale.set(T.water ? 0.45 : 1.0, T.water ? 0.45 : 1.0);
      padMat.envMapIntensity = T.water ? 1.6 : 1.0;
      // 远景铺同一张贴图（克隆一份改 repeat）：否则近景圆盘与远景色调不同，
      // 会在 pad 边缘拍出一道硬边圆环，像贴了块地毯。
      // P30：normalMap 同步铺到 far（解析延拓）——只统一 repeat 时两侧
      // 微凹凸光照不一致，r=15 处仍是一道色调体制断层。
      farMat.map = maps.farTex;
      farMat.normalMap = maps.farNormal || null;
      farMat.roughness = T.water ? 0.2 : 0.96;
      farMat.metalness = T.water ? 0.25 : 0.0;
      farMat.color.setHex(0xffffff);
    } else {
      // 回到默认停机坪
      padMat.map = padMaps.map;
      padMat.normalMap = padMaps.normalMap;
      padMat.roughnessMap = padMaps.roughnessMap;
      padMat.roughness = 1.0;
      padMat.metalness = 0.0;
      padMat.normalScale.set(0.7, 0.7);
      padMat.envMapIntensity = 1.0;
      farMat.map = farBase;
      farMat.normalMap = null;          // 停机坪远景本无凹凸，复原
      farMat.roughness = 0.96;
      farMat.metalness = 0.0;
      farMat.color.setHex(T.farTint);
    }
    padMat.needsUpdate = true;
    farMat.needsUpdate = true;
    duneFar.visible = (key === 'desert'); // 远景巨型沙丘只在沙漠显示
    // 同步远景贴图/粗糙度并保持"深一档"反照率差（沙丘可读性的根）；
    // P5-A(D)→P5-B(B)：色基固定沙漠 farTint（沙色系），随环境预设只调明暗——
    // 夜间切进沙漠不再是日间白沙丘、也不再是停机坪色调蓝紫断层（P5-B 实测
    // night duneFar 曾 (150,168,193) vs 环外沙地 → 色相断层）；envDim 只压明度。
    duneFar.material.copy(farMat);
    const DIM = desertEnvDim(ENV_PRESETS[envKeyRef.v] || ENV_PRESETS.day);
    duneFar.material.color.setHex(DUNE_BASE).multiplyScalar(DIM * 0.78);
    pad.material = T.water ? waterMat : padMat;

    // 湖面用连续水体承载画面；浮台是局部停机结构，不再叠一张近景水圆盘。
    pad.visible = !T.water;
    lake.visible = T.water;
    padPlatform.visible = T.water;

    // 湖面动态材质与环境/时间同步；非湖面不做额外计算
    updateWater(HOST.S.time);   // Phase 1-A：经宿主取用（01-host.js）
    // 湖面倒影（P3-⑦）：水面下沉与半透明让镜像体透出，远景盘沉为深水底。
    // 离开水面时全部复原。
    if (T.water) {
      pad.position.y = WATER_Y;
      padMat.transparent = true;
      padMat.opacity = 0.62;
      far.position.y = WATER_Y - 18;
      farMat.color.setHex(0x76848c);      // 兼容旧状态，far 在上面已隐藏
    } else {
      pad.position.y = GROUND_Y;
      padMat.transparent = false;
      padMat.opacity = 1;
      far.position.y = GROUND_Y - 0.012;
    }

    // 环境球里的地面也跟着换（影响 PMREM 反射底色）
    envGround.material.color.setHex(T.water ? 0x24444e : T.farTint);
    envGround.material.color.multiplyScalar(T.water ? 0.8 : 0.55);

    // 雾：场地雾优先，颜色经 terrainFog 与环境预设协调（P5-A(D)：密度保持场地值）
    const fg = terrainFog(T, ENV_PRESETS[envKeyRef.v] || ENV_PRESETS.day);
    scene.fog = new THREE.FogExp2(fg[0], fg[1]);
    fogBase.c = fg[0];
    fogBase.d = fg[1];

    // 水面时接地阴影贴片改半透明"水中暗影"效果
    csMat.opacity = T.water ? 0.45 : 0.75;

    // 沙漠沙丘：几何顶点按 duneH 高度场变形；非沙漠时用缓存的原始平面复原
    if (!dune) {
      dune = pad.geometry;
      // 首次变形前缓存原始 z（全 0 平面），复原才有数据可写
      duneOrigZ = dune.attributes.position.array.slice();
    }
    const posA = dune.attributes.position;
    if (key === 'desert') {
      for (let i = 0; i < posA.count; i++) {
        const x = posA.getX(i), y = posA.getY(i);   // 盘面局部 xy（局部 y = -世界 z）
        posA.setZ(i, duneH(x, -y));
      }
    } else {
      posA.array.set(duneOrigZ);                    // 还原平面（真数据，非空数组）
    }
    posA.needsUpdate = true;
    dune.computeVertexNormals();

    // 湖面半透明（P3-⑦）：far 盘保持显示——水面分支把它沉到 WATER_Y-18u
    // 当深水湖床，倒影与湖床从 0.62 不透明度的水体下透出；陆地场地它就是
    // 远景地面。contact 阴影仍按水面隐藏（水下阴影由 csMat 0.45 承担）。
    far.visible = true;
    contact.visible = !T.water;
    pad.visible = !T.water;
    lake.visible = T.water;

    bakeEnv();
    return true;
  }

  // ---- 接地阴影贴片（起落架 3 点 + 机腹）----
  const csTex = makeContactShadow(256);
  const contact = new THREE.Group();
  const csMat = new THREE.MeshBasicMaterial({
    map: csTex, transparent: true, depthWrite: false,
    opacity: 0.75, blending: THREE.NormalBlending, color: 0x000000,
  });
  // [x, z, 半径]，取自实测轮胎与机腹位置
  const CS = [[1.02, 1.72, 0.85], [-1.02, 1.72, 0.85], [0.13, -4.8, 0.55], [0, 0.4, 2.4]];
  for (const [x, z, r] of CS) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), csMat);
    m.rotation.x = -PI / 2;
    m.position.set(x, GROUND_Y + 0.006, z);
    m.renderOrder = 2;
    contact.add(m);
  }
  scene.add(contact);

  // ---- 环境贴图：把天空 + 三块补光板烘成 PMREM ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 20), skyMat);
  envScene.add(envSky);
  const panels = [];
  for (const [px, py, pz, w, h, col, inten] of [
    [-7, 5, 4, 9, 6, 0xffffff, 1.0],
    [8, 4, -3, 8, 5, 0xdce8ff, 0.55],
    [0, 6.5, -8, 10, 4, 0xfff0dd, 0.7],
  ]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    p.position.set(px, py, pz);
    p.lookAt(0, 1, 0);
    p.userData.baseColor = new THREE.Color(col);
    p.userData.baseI = inten;
    envScene.add(p);
    panels.push(p);
  }
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(40, 32),
    new THREE.MeshBasicMaterial({ color: 0x4a4d50 }));
  envGround.rotation.x = -PI / 2;
  envGround.position.y = GROUND_Y;
  envScene.add(envGround);

  let envRT = null;
  function bakeEnv() {
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.02, 0.5, 200);
    scene.environment = envRT.texture;
  }

  // 环境预设键的引用（setTerrain 恢复雾时需要知道当前环境）
  const envKeyRef = { v: 'day' };
  // 雾的基准密度：WashFX 的 brownout 在此之上叠加，避免逐帧累积漂移
  const fogBase = { c: 0, d: 0 };

  return {
    scene, camera, sky, skyMat, sun, fill, rim, hemi,
    pad, lake, padMat, far, farMat, duneFar, contact, csMat,
    envScene, envGround, panels, bakeEnv, updateWater,
    setTerrain, envKeyRef, fogBase, padPlatform,
    // 阴影质量分级（闭包捕获 buildWorld 内部的 sun，确保能正确访问）
    setShadowQuality(mapSize, radius) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.radius = radius;
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
    get terrainKey() { return terrainKey; },
    get envRT() { return envRT; },
  };
}

