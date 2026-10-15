// ============================================================
// 20-scene.js — 天空 / 环境预设 / 灯光 / 地面 / PMREM 烘焙
// ============================================================

// 全屏三角，用于把着色器结果画进 RT
class FSQuad {
  constructor(mat) {
    this.mat = mat;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.cam);
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// 程序化物理天空：天顶/地平/地面三段渐变 + 太阳盘 + 米氏晕 + 条带云
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x1b3f76) },
      uHorizon: { value: new THREE.Color(0x9fb6cc) },
      uGround: { value: new THREE.Color(0x2b2f2c) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.6).normalize() },
      uSunCol: { value: new THREE.Color(0xfff2dd) },
      uSunI: { value: 1.0 },
      uHaze: { value: 0.35 },
      uCloud: { value: 0.35 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      // Phase 13-M4 天气联动（WeatherFX 驱动）：沙暴橙化 + 雷暴闪电白闪
      uSand: { value: 0 },
      uSandCol: { value: new THREE.Color(0xd8a24a) },
      uLflash: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vDir;
      uniform vec3 uZenith, uHorizon, uGround, uSunCol;
      uniform vec3 uSunDir;
      uniform float uSunI, uHaze, uCloud, uStars, uTime;
      uniform float uSand, uLflash;
      uniform vec3 uSandCol;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float a = 0.5, s = 0.0;
        for(int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return s;
      }

      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;

        // 天顶 -> 地平：用 pow 压缩让地平线附近过渡更快
        float up = clamp(h, 0.0, 1.0);
        vec3 sky = mix(uHorizon, uZenith, pow(up, 0.42));
        // 地平线以下：地面反照
        vec3 col = mix(sky, uGround, smoothstep(0.0, -0.13, h));

        float mu = max(dot(d, normalize(uSunDir)), 0.0);
        // 太阳盘 + 边缘柔化
        float disc = smoothstep(0.9987, 0.99955, mu);
        // 米氏散射晕
        float mie = pow(mu, 12.0) * 0.55 + pow(mu, 3.0) * 0.16;
        col += uSunCol * (disc * 22.0 + mie * uSunI * 1.5);
        // 地平线雾霭，靠近太阳方向更亮
        float hz = exp(-abs(h) * 9.0) * uHaze * (0.55 + 0.9 * pow(mu, 2.0));
        col = mix(col, uHorizon * 1.18 + uSunCol * 0.18, clamp(hz, 0.0, 0.85));

        // 条带云 → 立体云团（电影镜头包 M1）：两层 fbm（大团块+细节破形），
        // 高度带分布（低空积云带），向阳面染太阳色（银边/火烧云），随风漂移
        if (h > 0.015 && uCloud > 0.001) {
          vec2 cp = d.xz / max(h + 0.10, 0.05) * 1.1;
          vec2 drift = vec2(uTime * 0.008, uTime * 0.004);
          float base = fbm(cp * 0.9 + drift);
          float det  = fbm(cp * 2.6 + drift * 1.7 + 13.1);
          float cl = smoothstep(0.46, 0.78, base * 0.72 + det * 0.42);
          cl *= smoothstep(0.015, 0.10, h) * (1.0 - smoothstep(0.40, 0.92, h));
          // 向阳面亮、背阳面暗（云的体积感），太阳低角度时银边/火烧云
          vec3 lit = mix(uHorizon * 1.24, uSunCol * 1.18, 0.30 + 0.55 * pow(mu, 1.5));
          vec3 shade = mix(uHorizon * 0.70, uSunCol * 0.28, 0.22);
          vec3 cc = mix(shade, lit, clamp(0.32 + 0.68 * pow(mu, 2.0), 0.0, 1.0));
          col = mix(col, cc, cl * uCloud * 1.28);
        }

        // 夜空星星（电影镜头包 M1）：uStars 随预设（夜间 1 / 黄昏 0.25 / 其他 0），
        // 星点 = 高频 hash 阈值 + 慢闪烁，云多时被遮
        if (uStars > 0.001 && h > 0.0) {
          vec2 sp = d.xz / max(h + 0.35, 0.1) * 42.0;
          float st = hash(floor(sp));
          float tw = 0.60 + 0.40 * sin(uTime * 2.6 + st * 91.0);
          float star = smoothstep(0.9974, 1.0, st) * tw * smoothstep(0.02, 0.22, h);
          col += vec3(0.82, 0.90, 1.0) * star * uStars * (1.0 - uCloud * 0.55) * 1.6;
        }

        // 天气联动（Phase 13-M4，WeatherFX 驱动）：沙暴把天空整体推向沙橙
        //（与雾色、粒子同色系），强度 uSand 0→1 由天气状态缓变；雷暴闪电
        // 白闪叠加在最后（闪电瞬间天空/地平一起亮起）
        if (uSand > 0.001) {
          vec3 tint = mix(col, uSandCol, 0.45);
          col = mix(col, tint, uSand);
        }
        if (uLflash > 0.001) {
          col += vec3(0.92, 0.96, 1.08) * uLflash * 0.85;
        }
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  });
}

// 四套环境预设。sunEl/sunAz 为角度；exposure/bloom 交给 UI 作为初值
const ENV_PRESETS = {
  // P4c：时段 6 档（清晨 / 正午 / 午后 / 黄昏 / 夜间 / 棚拍）
  dawn: {
    label: '清晨',
    zenith: 0x24406e, horizon: 0xe3b9a0, ground: 0x2c2f2b,
    sunEl: 9, sunAz: 92, sunCol: 0xffc9a0, sunI: 2.4, skySunI: 1.25,
    haze: 0.55, cloud: 0.46, hemi: 0.40, fill: 0.26, stars: 0.08,
    exposure: 1.10, bloom: 0.80, fog: [0xc9b4a8, 0.0062],
    padTint: 0xf4e4da, padRough: 0.03,
  },
  day: {
    label: '正午',
    zenith: 0x1c447f, horizon: 0xa9bfd2, ground: 0x33372f,
    sunEl: 52, sunAz: 128, sunCol: 0xfff4e2, sunI: 3.3, skySunI: 1.0,
    haze: 0.30, cloud: 0.40, hemi: 0.55, fill: 0.30, stars: 0.0,
    exposure: 1.00, bloom: 0.55, fog: [0xa9bfd2, 0.0042],
    padTint: 0xffffff, padRough: 0.0,
  },
  afternoon: {
    label: '午后',
    zenith: 0x23508a, horizon: 0xc4c6c0, ground: 0x37382e,
    sunEl: 30, sunAz: 225, sunCol: 0xffe6c2, sunI: 3.1, skySunI: 1.15,
    haze: 0.38, cloud: 0.48, hemi: 0.50, fill: 0.28, stars: 0.0,
    exposure: 1.02, bloom: 0.62, fog: [0xbcc0b8, 0.0046],
    padTint: 0xfff4e6, padRough: 0.0,
  },
  dusk: {
    label: '黄昏',
    zenith: 0x1a2748, horizon: 0xd98b52, ground: 0x241f1c,
    sunEl: 7, sunAz: 258, sunCol: 0xffb26a, sunI: 2.6, skySunI: 1.5,
    haze: 0.62, cloud: 0.52, hemi: 0.32, fill: 0.20, stars: 0.25,
    exposure: 1.14, bloom: 0.95, fog: [0xc07a4c, 0.0070],
    padTint: 0xffd9b8, padRough: 0.04,
  },
  night: {
    label: '夜间',
    zenith: 0x04080f, horizon: 0x0d1a2a, ground: 0x070a09,
    sunEl: 34, sunAz: 300, sunCol: 0x9fc4ff, sunI: 0.55, skySunI: 0.35,
    haze: 0.16, cloud: 0.24, hemi: 0.12, fill: 0.42, stars: 1.0,
    exposure: 1.45, bloom: 1.35, fog: [0x0a141f, 0.0090],
    padTint: 0xa8bcd8, padRough: 0.06,
  },
  studio: {
    label: '棚拍',
    zenith: 0x2a2d33, horizon: 0x53585f, ground: 0x1a1c1e,
    sunEl: 44, sunAz: 152, sunCol: 0xffffff, sunI: 2.2, skySunI: 0.25,
    haze: 0.10, cloud: 0.00, hemi: 0.85, fill: 0.75, stars: 0.0,
    exposure: 1.02, bloom: 0.42, fog: [0x30343a, 0.0024],
    padTint: 0xe8ebee, padRough: -0.06,
  },
};

function sunVector(elDeg, azDeg) {
  const el = elDeg * DEG, az = azDeg * DEG;
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az)
  ).normalize();
}
