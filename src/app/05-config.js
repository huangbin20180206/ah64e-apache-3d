// ============================================================
// 05-config.js — 模型实测常量与部件绑定表
// 所有数值来自 tools/exact_bounds.py 对 assets/apache_v2.glb 的实测
// ============================================================

// glTF 已转成 Y-up：X = 左右（+X 右），Y = 上，Z = 前后（+Z 机头方向）
// 原始包围盒 min(-3.2459, -1.2944, -4.5179) max(3.2125, 2.0409, 4.7848)
const MODEL_MIN_Y = -1.2944;      // 轮胎最低点
const MODEL_LIFT = -MODEL_MIN_Y;  // 整机上抬，让轮胎落在 y=0
const GROUND_Y = 0;

// 地面停放俯仰角：模型尾轮支柱偏短（尾轮最低点比主轮高 0.686u，相距 6.18u），
// 按 DVIDS 实照 AH-64 为后三点布局、停放时三点全部接地（机身近水平）。
// 绕主轮轴上仰 atan(0.686/6.18)=6.33° 使尾轮同时触地；起飞后姿态渐变回水平。
const GROUND_PITCH = -0.1107;     // rad（rotation.x 负值 = 机头上仰）
const GROUND_PITCH_COMP = -0.2444; // root 沿 y 补偿，保证主轮仍在 y=0

const AC = {
  length: 9.3027,     // Z 向总长（含旋翼投影）
  width: 6.4583,      // X 向总宽（旋翼直径）
  height: 3.3353,
  rotorRadius: 3.23,  // 主旋翼半径
  // 枢轴（已加 MODEL_LIFT 后的世界坐标）
  mainRotorPivot: [-0.0167, 0.9531 + MODEL_LIFT, 1.5556],
  tailRotorPivot: [0.3621, 1.1404 + MODEL_LIFT, -3.6174],
  radarPivot: [-0.0167, 1.1389 + MODEL_LIFT, 1.5556],
};

// 节点名 -> 逻辑部件。仅保留 60-model.js 实际消费的键（涂装标识/挂载武器/链炮）。
// 旋翼/雷达经 this.get('MainRotor_Pivot'/'TailRotor_Pivot'/'Radar_Pivot') 直绑；
// 轮组/短翼/尾梁/机身等其余部件不在分组表（爆炸视图遍历全部网格，标签走 LABELS）。
// 2026-09 维护：清理无消费者死键（mainRotor/tailRotor/radar/wheels/wing/
// tailWheel/tailBoom/body——经全仓搜索确认零引用）。
const PART_GROUPS = {
  // 美军（US Army 绿）标识
  armyDecals: ['Decal_Star_L', 'Decal_Star_R', 'Decal_Text_L', 'Decal_Text_R',
               'TailNum_L', 'TailNum_R'],
  // 陆战队（低可视灰）标识
  usmcDecals: ['USMC_Insignia_L', 'USMC_Insignia_R', 'USMC_MARINES_L', 'USMC_MARINES_R',
               'USMC_Serial_L', 'USMC_Serial_R'],
  // 挂架武器：AGM-114 地狱火 8 枚（模型实测，每侧 2×2 挂架）
  hellfire: ['Cylinder', 'Cylinder.001', 'Cylinder.002', 'Cylinder.003',
             'Cylinder.004', 'Cylinder.005', 'Cylinder.006', 'Cylinder.007'],
  // M261 火箭巢 ×2（左右各一）：烘焙在短翼 BODY.001 里的第二原语子网格，
  // 材质 USMC_LowVis_Gun，X ±1.15~1.556，Y -0.647~-0.356，Z 1.08~2.06
  rocketPod: ['Cube007_1'],
  // 机头腹部 M230 30mm 链炮：炮管 + 炮体 + 供弹/支架
  gun: ['Cylinder.014', 'Cylinder.019', 'BezierCurve'],
};

// M230 链炮实弹参数（AH-64A 型 625 发/分，备弹 1200 发）
const GUN = { RPM: 625, AMMO: 1200 };

// Hydra 70 火箭参数（M261 火箭巢 ×2，每巢 19 管 = 38 发；
// 实弹出巢 45m/s、燃尽 739m/s，此处取视觉观感值：慢起步、快速加速、轻微弹道下坠）
const ROCKET = { AMMO: 38, RIPPLE_SEC: 0.14, V0: 12, VMAX: 58, ACC: 90 };

// 主旋翼额定转速（AH-64 为 289 RPM）
const RPM_NOMINAL = 289;
const SPIN_UP_SEC = 8.5;     // 0 -> 100% 用时
const SPIN_DOWN_SEC = 14.0;  // 100% -> 0 用时（惯性大，停得慢）
// 尾桨与主旋翼的转速比（AH-64 传动比约 4.9:1，反向）
const TAIL_RATIO = -4.9;

// 渲染质量统一配置：低档位同时降低像素、后处理和高密度特效成本。
// 高清档不直接把设备 DPR 再乘两倍，避免高分屏上出现平方级像素开销。
// P0 扩展：shadow=阴影贴图尺寸 / shadowRadius=PCF 半径 / reflect=倒影更新模式
//   （0=关 1=低频每3帧 2=实时每帧）/ particles=粒子池上限系数 / aniso=各向异性
const QUALITY_PRESETS = {
  '0.75': { scale: 0.75, levels: 2, effects: 0.55, shadow: 1024, shadowRadius: 1.0, reflect: 0, particles: 0.45, aniso: 4 },
  '1':    { scale: 1.00, levels: 4, effects: 1.00, shadow: 2048, shadowRadius: 1.4, reflect: 1, particles: 0.75, aniso: 6 },
  '1.5':  { scale: 1.25, levels: 4, effects: 1.00, shadow: 4096, shadowRadius: 1.6, reflect: 2, particles: 1.00, aniso: 8 },
  '2':    { scale: 1.50, levels: 4, effects: 1.00, shadow: 4096, shadowRadius: 1.6, reflect: 2, particles: 1.00, aniso: 16 },
};
function qualityPreset(q) {
  return QUALITY_PRESETS[String(q)] || QUALITY_PRESETS['1'];
}

// ---------- P3-⑦ 湖面倒影 ----------
// 水面相对地平面的下沉量：与浮筒平台台面（y=0）错层避免共面闪烁，
// 同时也是倒影镜像平面高度（19-reflect.js / 30-world.js 引用）
const WATER_Y = -0.015;

// ---------- P3-⑧ 环境风 ----------
// 展示页用一条缓变的定向风：风向缓慢摆动、风速低频起伏（纯正弦，可复现）。
// 下洗云团/贴花/草浪/水沫整体被吹向下风向，悬停越高偏移越大。
const WIND = {
  dir: 2.30,        // 平均风向（XZ 平面弧度）
  speed: 1.15,      // 平均风速 u/s（1u≈2m → 约 2.3 m/s，二级微风）
  sway: 0.22,       // 风向摆动幅度（弧度）
  swayT: 21,        // 风向摆动周期 s
  gustT: 13,        // 阵风起伏周期 s
};
// 返回 t 时刻风向量 [x, z]（u/s）
function windVec(t) {
  const a = WIND.dir + Math.sin(t / WIND.swayT) * WIND.sway;
  const s = WIND.speed * (0.72 + 0.28 * Math.sin(t * TAU / WIND.gustT + 1.7));
  return [Math.sin(a) * s, Math.cos(a) * s];
}
