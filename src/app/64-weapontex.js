// ============================================================
// 64-weapontex.js — 武器贴图生成与静态配置常量
// ============================================================
// 2026-11-08 自 65-weapons.js 拆出（纯搬移，行为不变）。
// 这一层只有 Canvas 贴图工厂与不变的武器参数常量，和 WeaponRig 的
// 运行时状态机无关；放在 64 段保证 65 引用时已加载。
// ============================================================

// ============================================================
// 65-weapons.js — 武器系统：M230 机炮曳光 / 地狱火 / 火箭 / 弹药装填
// 地面下洗特效不在这里，统一由 17-washfx.js 的 WashFX 负责
// ============================================================

// 柔光径向渐变贴图（炮口焰 / 尾烟共用）
function makeGlowTex(N = 64) {
  const { c, x } = canvas2d(N);
  const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.30, 'rgba(255,255,255,.50)');
  g.addColorStop(0.65, 'rgba(255,255,255,.16)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

// 弹体几何长轴方向（弹身沿 +Z：body.rotation.x=PI/2 后的朝向）。
// 发射/飞行时用 setFromUnitVectors(HF_FWD, dir) 把弹体对齐飞行方向——
// 复用一个模块级向量，避免每帧 new（对象池纪律：逐帧短命对象会喂 GC）
const HF_FWD = new THREE.Vector3(0, 0, 1);
// Phase 19 性能审计 A2/A3/A4：发射与飞行热路径的 scratch 向量池——
// 曳光散布/炮口与巢口起点/导引目标点等全部复用模块级向量，单线程同步
// 顺序使用无重入（同一帧内后写覆盖前写，用完即弃）。
const _W_SPREAD = new THREE.Vector3();    // 曳光散布项
const _W_MZL = new THREE.Vector3();       // 机炮/火箭发射起点（局部→世界）
const _W_DIR = new THREE.Vector3();       // 机炮方向（机头四元数应用）
const _W_AIM = new THREE.Vector3();       // 瞄准点（发射时构造）
const _W_TUR = new THREE.Vector3(), _W_TUR2 = new THREE.Vector3();   // 炮塔射界 scratch
const _W_TO = new THREE.Vector3();       // 火箭半瞄准修正向量
const _HF_TO = new THREE.Vector3();       // 地狱火导引目标点（每弹每帧）

// Q3：各时段烟尘受光系数（乘到烟尘颜色上；与 32-envpreset 的环境键一致）
const SMOKE_TINT = { day: [1, 1, 1], afternoon: [1, 0.96, 0.9], dawn: [0.92, 0.8, 0.74],
  dusk: [0.9, 0.68, 0.5], night: [0.24, 0.26, 0.32], studio: [1, 1, 1] };
const _SMOKE_C = new THREE.Color();

// E3：团状烟贴图——固定种子的多个软圆叠加（不用 Math.random，不占视觉 PRNG 流）
function makeSmokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = mulberry32(0x5A0E3);
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, d = r() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, R = 26 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
