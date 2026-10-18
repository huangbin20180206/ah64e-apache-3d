// ============================================================
// 16-targetmodels.js — 靶标程序化建模 + AI 高模换壳 + 静态几何合批
// ============================================================
// 2026-10-12 批 E 自 16-targets.js 拆出（纯搬移，行为不变）。同前缀 16-* 在
// 拓扑检查里同级；文件名按字典序排在 16-targets.js 之前（"m" < "s"）。
// 提供：targetMat / addBox / makeTank|Truck|BarrelTarget / TARGET_TYPES /
//       TARGET_MODELS / targetModelKey / loadTargetModels / applyModelToTarget / mergeTargetStatics
//       makeWreck / wreckEmber / scorchTexture（P5-G1 真实残骸）
//       splitTurretGeo / wreckPop（Q3 坦克炮塔掀飞）
// ============================================================

// ---------- 靶标程序化建模 ----------

function targetMat(color, roughness = 0.75, metalness = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(g, geo, mat, pos, rot = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  g.add(m);
  return m;
}

// 装甲靶车：楔形车体 + 侧裙/履带轮 + 炮塔/炮管 + 光电头 + 靶板
// P31-A1 兜底同步真实化：GLB 是实机所见，这里是 GLB 加载失败时的兜底——
// 车体沿 Z×2（车体 3.30/履带 3.62），履带间距收窄到全宽≈1.6u：对齐真实
// M1（1u≈2.27m：3.66m 宽=1.6u × 车体 7.9m≈3.5u），长宽比≈2.26。
function makeTankTarget() {
  const g = new THREE.Group();
  const armor = targetMat(0x4f5947, 0.88, 0.22);
  const edge = targetMat(0x293029, 0.92, 0.28);
  const glass = targetMat(0x18292a, 0.28, 0.36);
  const target = targetMat(0xd0c8ad, 0.76, 0.05);
  const red = targetMat(0xa83228, 0.68, 0.18);

  // 楔形车体：上下两层形成装甲折面（宽 1.35→1.20，长 1.65→3.30）
  addBox(g, new THREE.BoxGeometry(1.20, 0.38, 3.30), armor, [0, 0.42, 0]);
  addBox(g, new THREE.BoxGeometry(0.95, 0.25, 2.70), armor, [0, 0.70, -0.16], [0.10, 0, 0]);
  // 侧裙板与前装甲斜板（裙板长 1.45→2.90；前板随新车头 0.82→1.60）
  for (const sx of [-0.62, 0.62]) addBox(g, new THREE.BoxGeometry(0.10, 0.34, 2.90), edge, [sx, 0.40, 0]);
  addBox(g, new THREE.BoxGeometry(1.00, 0.30, 0.10), edge, [0, 0.61, 1.60], [0.16, 0, 0]);

  // 两条履带 + 8 个路轮（履带长 1.78→3.62；轮距 ±0.62，全宽≈1.65）
  for (const sx of [-0.62, 0.62]) {
    addBox(g, new THREE.BoxGeometry(0.25, 0.46, 3.62), edge, [sx, 0.30, 0]);
    for (let iz = -1.38; iz <= 1.38; iz += 0.39) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.27, 12), armor);
      w.rotation.z = PI / 2; w.position.set(sx, 0.30, iz); g.add(w);
    }
  }

  // 炮塔、炮盾、炮管、顶部传感器（炮塔保持车体中前部；炮口前伸至新车头）
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.48, 0.34, 12), armor);
  turret.position.set(0, 0.93, 0.25); g.add(turret);
  addBox(g, new THREE.BoxGeometry(0.44, 0.28, 0.18), edge, [0, 0.96, 0.63], [0.05, 0, 0]);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 1.45, 10), edge);
  barrel.rotation.x = PI / 2; barrel.position.set(0, 0.96, 0.90); g.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.22), glass);
  sight.position.set(0.22, 1.16, 0.37); g.add(sight);

  // 前方靶板：立柱 + 白板 + 红色命中圈（随新车头前移）
  addBox(g, new THREE.BoxGeometry(0.07, 0.58, 0.07), edge, [0, 1.18, 1.62]);
  addBox(g, new THREE.BoxGeometry(0.80, 0.84, 0.06), target, [0, 1.12, 1.66]);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 24), red);
  ring.position.set(0, 1.12, 1.695); g.add(ring);
  return { group: g, hp: 2, hp0: 2, radius: 1.6, label: '装甲靶车' };
}

// 卡车靶：带驾驶室、挡风玻璃、后视镜、货箱骨架、保险杠、轮毂和底盘
// P31-A2 兜底同步真实化：总长≈3.15u/宽≈1.10u（真实军卡 2.5m×7m ≈ 1.1u×3.1u），
// 长宽比≈2.9——GLB 失败时兜底也不再矮胖。
function makeTruckTarget() {
  const g = new THREE.Group();
  const cargoMat = targetMat(0x706b55, 0.86, 0.12);
  const cabMat = targetMat(0x536772, 0.68, 0.24);
  const glass = targetMat(0x182a31, 0.22, 0.45);
  const dark = targetMat(0x1f2423, 0.94, 0.28);
  const metal = targetMat(0x68706d, 0.48, 0.55);
  const red = targetMat(0x9d3a2d, 0.72, 0.16);

  // 底盘与货箱：货箱边框留空，避免“一个实心盒子”
  addBox(g, new THREE.BoxGeometry(1.10, 0.16, 3.10), dark, [0, 0.46, 0]);
  addBox(g, new THREE.BoxGeometry(0.98, 0.68, 2.10), cargoMat, [0, 0.88, -0.45]);
  for (const sx of [-0.47, 0.47]) {
    addBox(g, new THREE.BoxGeometry(0.06, 0.78, 2.20), metal, [sx, 0.90, -0.45]);
  }
  for (const z of [-1.45, 0.40]) addBox(g, new THREE.BoxGeometry(0.95, 0.07, 0.07), metal, [0, 0.55, z]);

  // 驾驶室：下层车头 + 倾斜挡风玻璃 + 车顶（最前部 z≈1.12）
  addBox(g, new THREE.BoxGeometry(1.02, 0.42, 0.72), cabMat, [0, 0.72, 1.12]);
  addBox(g, new THREE.BoxGeometry(0.88, 0.25, 0.05), glass, [0, 0.98, 1.21], [0.30, 0, 0]);
  addBox(g, new THREE.BoxGeometry(0.98, 0.08, 0.62), cabMat, [0, 1.08, 1.06]);
  // 车窗侧面、后视镜、前保险杠与车灯
  for (const sx of [-0.53, 0.53]) {
    addBox(g, new THREE.BoxGeometry(0.035, 0.22, 0.36), glass, [sx, 0.91, 1.07]);
    addBox(g, new THREE.BoxGeometry(0.10, 0.06, 0.13), dark, [sx * 1.08, 0.98, 0.88]);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), targetMat(0xd7b85c, 0.35, 0.10));
    lamp.position.set(sx * 0.40, 0.77, 1.50); g.add(lamp);
  }
  addBox(g, new THREE.BoxGeometry(1.04, 0.12, 0.10), red, [0, 0.55, 1.52]);

  // 三轴车轮：轮胎 + 金属轮毂，轮轴方向沿 X——前 1 后 2 真实轴距
  const tire = new THREE.CylinderGeometry(0.27, 0.27, 0.22, 14);
  const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.235, 12);
  for (const [wx, wz] of [[-0.50, 1.10], [0.50, 1.10], [-0.50, -0.80], [0.50, -0.80], [-0.50, -1.38], [0.50, -1.38]]) {
    const w = new THREE.Mesh(tire, dark); w.rotation.z = PI / 2; w.position.set(wx, 0.27, wz); g.add(w);
    const h = new THREE.Mesh(hub, metal); h.rotation.z = PI / 2; h.position.set(wx, 0.27, wz); g.add(h);
  }
  return { group: g, hp: 1, hp0: 1, radius: 1.08, label: '卡车靶' };
}

// 油桶阵：带底座、桶盖、双箍和危险标识的小型燃料堆
// P31-A3 真实化：单桶从 φ0.46u/高0.66u（≈1.04m×1.5m）收到 φ0.34u/高0.50u
//（≈0.77m×1.14m——真实 0.58m 径在 FPV 交战距离难辨认，取可读性折中），
// 簇间距/底座同比例收小，保持双箍/桶盖/堆叠比例——读作"一堆小桶"非"大罐"。
function makeBarrelTarget() {
  const g = new THREE.Group();
  const red = targetMat(0x8d3329, 0.66, 0.22);
  const darkRed = targetMat(0x4c211d, 0.78, 0.18);
  const band = targetMat(0xb9a77d, 0.52, 0.45);
  const black = targetMat(0x171a18, 0.9, 0.12);
  const base = addBox(g, new THREE.BoxGeometry(1.00, 0.07, 0.95), black, [0, 0.05, 0]);
  base.rotation.y = 0.12;
  const bg = new THREE.CylinderGeometry(0.17, 0.17, 0.50, 14);
  const lid = new THREE.CylinderGeometry(0.150, 0.150, 0.028, 14);
  for (const [px, py, pz] of [[0, 0, 0], [0.36, 0, 0.07], [-0.36, 0, -0.07], [0.07, 0, -0.38], [-0.22, 0, 0.36],
                              [0, 0.50, 0], [0.36, 0.50, 0.07], [-0.36, 0.50, -0.07]]) {
    const b = new THREE.Mesh(bg, py ? darkRed : red);
    b.position.set(px, py + 0.29, pz); g.add(b);
    const cap = new THREE.Mesh(lid, band); cap.position.set(px, py + 0.555, pz); g.add(cap);
    for (const hy of [-0.13, 0.13]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.173, 0.016, 7, 18), band);
      r.rotation.x = PI / 2; r.position.set(px, py + 0.29 + hy, pz); g.add(r);
    }
  }
  // 一个高对比但不喧宾夺主的危险菱形
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), targetMat(0xe2c24f, 0.7, 0.05));
  sign.position.set(0, 0.34, 0.18); sign.rotation.x = PI / 2; sign.rotation.z = PI / 4; g.add(sign);
  addBox(g, new THREE.BoxGeometry(0.04, 0.06, 0.09), black, [0, 0.35, 0.21]);
  return { group: g, hp: 1, hp0: 1, radius: 0.7, label: '油桶阵' };
}

const TARGET_TYPES = {
  tank:   { make: makeTankTarget,   count: 3, hint: '地狱火 / 火箭' },
  truck:  { make: makeTruckTarget, count: 4, hint: '机炮 / 火箭' },
  barrel: { make: makeBarrelTarget, count: 3, hint: '火箭 / 机炮' },
};

// ---------- AI 生成高质量模型（Tripo/Rodin 文生 3D → Blender 归一化 GLB）----------
// 异步渐进替换：GLB 就位前用程序化模型兜底，不阻塞靶场构建。
// 命中/瞄准/动目标链路全部走 group/pos/radius，换壳零影响。
// P31-A 尺寸比例真实化（1u≈2.27m，基准=AC 旋翼直径 6.4583u=14.63m）：
// len 此前是死元数据（声明未消费）——现在激活为【唯一确定尺寸源】：
// applyModelToTarget 量 yaw 后水平长轴，等比 setScalar(len/curLen) 缩放，
// GLB 按真实车长上屏且换模型后不用手调。真实基准：
//   tank  M1 含炮 9.77m=4.3u（车体 7.9m≈3.5u）×宽 3.66m=1.6u
//   truck 军卡 7m=3.1u ×宽 2.5m=1.1u
// truck GLB 宽经 uniform 缩放≈1.55u（3.5m，比真实军卡宽）——C004 起用 wNarrow
// 做横向收窄（见 applyModelToTarget）。运行时探针实测（group 局部空间，GLB 换壳后）：
// truck 局部 X≈1.42~1.54=车宽、Z≈2.83~3.08=车长、Y≈1.39~1.52=车高 ⇒ 只压 X 即压车宽。
const TARGET_MODELS = {
  // wNarrow：横向收窄系数（只作用于实例局部 X，长/高不变）=目标宽/实测宽
  // 2.5m/3.5m≈0.714 → 车宽 1.55u×0.714≈1.11u≈2.5m
  truck: { url: 'assets/targets/truck.glb', yaw: 0,  len: 3.1, wNarrow: 2.5 / 3.5 },
  // T-80U（CC0）：模型长度/炮管沿自身 X 轴，yaw +90° 转到 +Z 前向（-90° 实测反向）
  // 2026-10-18 修正：实测 tank.glb 车长沿模型自身 Z、炮管朝 +X 侧——旧 yaw=π/2 让坦克横着开
  //（车身与履带印/行驶方向垂直）。改 0 后炮管朝 group +Z（车头前向，见 16-targets 动目标公式）。
  tank:  { url: 'assets/targets/tank.glb',  yaw: 0, len: 4.3 },
  // 2026-10-18 BMP-2 步战车（Sketchfab "IFV BMP-2 (DCS World)" by KojfDiscord，CC BY 4.0，
  // 见 assets/targets/bmp2-LICENSE.txt）：坦克池的"变体壳"——t.mdl='ifv' 的坦克换此壳，
  // 命中/血量/移动逻辑仍按 tank。真车长 6.72m≈2.96u。
  ifv:   { url: 'assets/targets/bmp2.glb',  yaw: 0, len: 2.96 },   // 模型车头已朝 +Z（截图核验：后舱门朝车尾）
  // 2026-10-18 ASSETS2：卡车池变体（CC BY 4.0，见 CREDITS.md）。车头均朝模型 +Z。
  ural:  { url: 'assets/targets/ural.glb',  yaw: 0, len: 3.26 },   // Ural-4320 真车长 7.4m
  fuel:  { url: 'assets/targets/fuel.glb',  yaw: 0, len: 4.2 },    // M978 HEMTT 油罐车（真车长 10.2m，略缩免挤占停车线）
  // 坦克池第 3 变体：BTR-80 装甲输送车（42manako，CC BY 4.0）。原模型车头朝 +X → yaw -90° 转到 +Z
  apc:   { url: 'assets/targets/btr80.glb', yaw: -Math.PI / 2, len: 3.37 },   // 真车长 7.65m
  // 2026-10-18 ASSETS4：武装皮卡（团结 AI 生成，AIGC；车斗 DShK 机枪，车头朝 +Z）。
  // 只给"叛军"伏兵池（城镇/峡谷），基地正规军停放线不用。真车长 5.3m≈2.33u
  // 生成模型偏宽（5.3m 长时宽 2.35m，真车 ≈1.9m）→ wNarrow 只压车宽（轮子圆在侧面，不变形）
  technical: { url: 'assets/targets/technical.glb', yaw: 0, len: 2.33, wNarrow: 1.9 / 2.35 },
};
// 变体轮换：同类目标按序号轮流换壳（只换外观与名称，命中/血量/移动仍按 type）
const TARGET_VARIANTS = { tank: [null, 'ifv', 'apc'], truck: [null, 'ural', 'fuel'] };
// 叛军伏兵池（城镇 16-town / 峡谷 16-valley）：卡车优先换武装皮卡
const INSURGENT_VARIANTS = { tank: [null, 'ifv', 'apc'], truck: ['technical', 'ural', 'technical'] };
const VARIANT_LABEL = { ifv: 'BMP-2 步战车', apc: 'BTR-80 装甲车', ural: '乌拉尔军卡', fuel: '油罐车', technical: '武装皮卡' };
function pickVariant(type, n, pool = TARGET_VARIANTS) { const v = pool[type]; return v ? v[n % v.length] : null; }
// 目标用哪个壳：变体优先（t.mdl），否则按类型
function targetModelKey(t) { return t.mdl && TARGET_MODELS[t.mdl] ? t.mdl : t.type; }
let _targetModelCache = null;
function loadTargetModels(scene) {
  if (_targetModelCache) return _targetModelCache;
  const loader = new THREE.GLTFLoader();
  const out = {};
  _targetModelCache = new Promise((resolve) => {
    let pending = Object.keys(TARGET_MODELS).length;
    for (const [key, def] of Object.entries(TARGET_MODELS)) {
      loader.load(def.url, (gltf) => {
        const m = gltf.scene;
        m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        out[key] = m;
        if (--pending === 0) resolve(out);
      }, undefined, () => { if (--pending === 0) resolve(out); });
    }
  });
  return _targetModelCache;
}

// 用 GLB 替换程序化模型：保留原 group 的位置/朝向，清空子节点换壳
function applyModelToTarget(t, model) {
  while (t.group.children.length) t.group.remove(t.group.children[0]);
  const inst = model.clone(true);
  const key = targetModelKey(t);
  inst.rotation.y = TARGET_MODELS[key].yaw;
  t.group.add(inst);
  // P31-A：激活 len——量 yaw 后水平长轴实际值，等比缩放到确定车长。
  // 等比（setScalar）保模型比例完整；缩放发生在合批烘焙之前，世界矩阵
  // 已含缩放，mergeTargetStatics 之后 draw/材质零变化。
  const defLen = TARGET_MODELS[key].len;
  if (defLen) {
    // C006：车长测量必须**与 group 的场景朝向 yaw 无关**。旧实现直接量世界 AABB，
    // 而 build() 给每个 group 一个朝向来袭方向的 yaw（绕圈巡逻卡车 :688 每帧还改
    // 朝向），旋转后的水平投影 max(sz.x,sz.z) 随 yaw 变大 ⇒ 缩放系数偏小且随 yaw /
    // 换壳时机浮动（实测修正前：truck 车长 2.827~3.081 漂移 8.98%、tank 4.193~4.259
    // 漂移 1.58%，均短于 defLen）。
    // 修法：量之前把 group 的**场景旋转临时归零**（保留模型自身固定的
    // TARGET_MODELS.yaw 与 inst 的全部变换），量完立即恢复原 rotation——量到的是
    // 模型自身长轴，任意 group yaw / 任意换壳时机都恒等 ⇒ 缩放系数稳定 ⇒
    // 车长精确等于 defLen。位置不参与 getSize（平移无关），故无需动 position。
    const rx = t.group.rotation.x, ry = t.group.rotation.y, rz = t.group.rotation.z;
    t.group.rotation.set(0, 0, 0);
    t.group.updateMatrixWorld(true);
    // precise=true：逐顶点求 AABB（默认实现是"各几何自身 AABB 的再包围盒"，
    // 对带自身旋转的模型会高估长轴——tank 的 yaw=π/2 实测高估 0.03%）。
    // 只换壳时跑一次（7 个目标），一次性开销可忽略。
    const bb = new THREE.Box3().setFromObject(t.group, true);
    t.group.rotation.set(rx, ry, rz);
    t.group.updateMatrixWorld(true);
    const sz = bb.getSize(new THREE.Vector3());
    const curLen = Math.max(sz.x, sz.z);
    if (curLen > 1e-4) inst.scale.setScalar(defLen / curLen);
  }
  // C004：横向收窄（仅 truck）。inst.scale 在实例自身旋转之前生效
  // （Object3D 矩阵 = T·R·S），而 truck 的 yaw=0 且模型车长沿自身 Z 轴
  // ⇒ 压局部 X 即压车宽，车长/车高不受影响。必须放在上面等比缩放之后：
  // 长轴测量读的是世界包围盒，先收窄会把"长轴"量成收窄后的值。
  // 非均匀缩放的着色影响：法线由 normalMatrix（inverse-transpose）处理，
  // 合批烘焙走 BufferGeometry.applyMatrix4 亦同样变换法线 ⇒ 光照正常。
  const wNarrow = TARGET_MODELS[key].wNarrow;
  if (wNarrow) inst.scale.x *= wNarrow;
  // 观感提示：系数为"只压 X"的横向收窄，轮胎在侧视面（Y-Z）仍为正圆、
  // 仅胎宽变窄；若模型正面存在 X-Y 平面内的圆形件（圆形车灯/侧挂备胎）
  // 会被压成椭圆——交付前已按俯视+斜视截图核验（见 C004 回执）。
  // PERF-AUDIT C2：换壳后立即按材质合批（tank GLB 多原语收敛）；
  // 合并体打 noMerge 防重复合并，幂等
  mergeTargetStatics(t);
  attachTurretPivot(t);
}

// ---------- 2026-10-18 ASSETS3：坦克炮塔跟踪 ----------
// 原版 T-80U 壳（key='tank'，阈值按它实测）合批后，按 Q3 的连通块规则把炮塔件
// （最低点 ≥ TURRET_MIN_Y）切成独立网格，挂进以 TURRET_PIVOT 为轴心的子组
// t.turret；16-targets update 每帧把它转向直升机（看得见的"炮口跟着你转"）。
// 只新建索引、共享顶点（同 splitTurretGeo）；残骸 makeWreck 读 matrixWorld，炮塔转角原样带入。
function attachTurretPivot(t) {
  if (t.turret || targetModelKey(t) !== 'tank') return;
  const id = new THREE.Matrix4();
  const pivot = new THREE.Group();
  pivot.name = 'turret-pivot';
  pivot.position.set(...TURRET_PIVOT);
  const meshes = t.group.children.filter(o => o.isMesh && o.userData.noMerge);
  for (const m of meshes) {
    const parts = splitTurretGeo(m.geometry, id);
    if (!parts.hi) continue;
    const hm = new THREE.Mesh(parts.hi, m.material);
    hm.position.set(-TURRET_PIVOT[0], -TURRET_PIVOT[1], -TURRET_PIVOT[2]);
    hm.castShadow = true; hm.receiveShadow = true;
    hm.userData.noMerge = true;
    pivot.add(hm);
    if (parts.lo) m.geometry = parts.lo; else t.group.remove(m);
  }
  if (!pivot.children.length) return;
  t.group.add(pivot);
  t.turret = pivot;
}
// 每帧：活着且直升机在 70u 内 → 炮塔以 0.9 rad/s 转向直升机；否则缓慢回正
function aimTurret(t, heliPos, dt) {
  const p = t.turret;
  let want = 0;
  if (t.alive && heliPos) {
    const dx = heliPos.x - t.group.position.x, dz = heliPos.z - t.group.position.z;
    if (dx * dx + dz * dz < 70 * 70) want = Math.atan2(dx, dz) - t.group.rotation.y;
  }
  let da = want - p.rotation.y;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const mx = (want ? 0.9 : 0.4) * dt;
  p.rotation.y += Math.max(-mx, Math.min(mx, da));
}

// ---------- PERF-AUDIT C2：靶标静态几何按材质合批 ----------
// 靶标组内所有 mesh 的局部变换构造后不变（mov 目标只动 group 层），
// 同材质烘焙合并为每材质 1 个 mesh——barrel 程序化模型 35 mesh/个 → ~4，
// tank GLB 多原语同样收敛。合并失败保底不合并（几何零丢失）；命中闪烁
// flashHit 按材质实例操作，合并体材质引用不变，闪烁语义不受影响。
function mergeTargetStatics(t) {
  const g = t.group;
  g.updateMatrixWorld(true);
  const rel = new THREE.Matrix4();
  const buckets = new Map();   // 材质实例 -> { geos, nodes }
  g.traverse(m => {
    if (!m.isMesh || !m.visible || m.userData.noMerge) return;
    rel.copy(g.matrixWorld).invert().multiply(m.matrixWorld);
    const geo = m.geometry.clone().applyMatrix4(rel);
    let b = buckets.get(m.material);
    if (!b) { b = { geos: [], nodes: [] }; buckets.set(m.material, b); }
    b.geos.push(geo);
    b.nodes.push(m);
  });
  let merged = 0;
  for (const [mk, b] of buckets) {
    const mg = mergeGeos(b.geos);
    if (!mg) continue;                    // 保底：属性集不齐放弃该桶
    for (const n of b.nodes) { if (n.parent) n.parent.remove(n); }
    const m = new THREE.Mesh(mg, mk);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.noMerge = true;             // 防重复合并（重复调用幂等）
    g.add(m);
    merged++;
  }
  return merged;
}

// ---------- P5-G1 真实残骸（2026-10-16）----------
// 旧版残骸是 4 个随机黑方块。现在：沿用被毁车辆本身的模型几何（共享，不复制顶点），
// 换成烧焦材质（保留原贴图细节、整体压暗、余烬自发光随燃烧时间熄灭），车体随机
// 倾斜下沉；再散落几块扭曲碎片 + 径向渐变焦痕贴地。油桶炸开后留 2 只翻倒开口桶。
// 残骸组 position = 爆点（燃烧烟火以此为中心）；几何标 noDispose，复位时不释放原车几何。
let _scorchTex = null;
function scorchTexture() {
  if (_scorchTex) return _scorchTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(8,7,6,0.95)'); gr.addColorStop(0.45, 'rgba(14,12,10,0.75)');
  gr.addColorStop(0.8, 'rgba(30,26,20,0.25)'); gr.addColorStop(1, 'rgba(30,26,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // 放射状溅痕（固定种子，不用 Math.random）
  let s = 7;
  const r1 = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.strokeStyle = 'rgba(10,9,8,0.5)';
  for (let i = 0; i < 26; i++) {
    const a = r1() * TAU, l0 = 18 + r1() * 14, l1 = l0 + 12 + r1() * 30;
    g.lineWidth = 1 + r1() * 3;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * l0, 64 + Math.sin(a) * l0);
    g.lineTo(64 + Math.cos(a) * l1, 64 + Math.sin(a) * l1); g.stroke();
  }
  _scorchTex = new THREE.CanvasTexture(c);
  _scorchTex.colorSpace = THREE.SRGBColorSpace;
  return _scorchTex;
}
function charMaterial(src) {
  return new THREE.MeshStandardMaterial({
    map: (src && src.map) || null, color: (src && src.map) ? 0x3a3936 : 0x252321, roughness: 1, metalness: 0.15,
    emissive: 0xff4a12, emissiveIntensity: 0.0,
  });
}
function makeWreck(t) {
  const g = new THREE.Group();
  t.group.updateMatrixWorld(true);
  const wp = new THREE.Vector3().setFromMatrixPosition(t.group.matrixWorld);
  g.position.copy(wp);
  const mats = [];
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x231f1b, roughness: 1, metalness: 0.3,
    emissive: 0xff4a12, emissiveIntensity: 0, side: THREE.DoubleSide });
  mats.push(debrisMat);
  // 余烬碎片单独一份材质（红热），桶壳/车壳用暗材质
  const emberMat = debrisMat.clone(); emberMat.userData.ember = true; mats.push(emberMat);
  if (t.type === 'barrel') {
    const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.85, 12, 1, true);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, debrisMat);
      m.rotation.order = 'YXZ';
      m.rotation.set(PI / 2, rnd(TAU), 0);         // 横躺 + 随机朝向
      m.position.set((rnd() - 0.5) * 1.6, 0.27, (rnd() - 0.5) * 1.6);
      m.scale.set(1, 1, 0.8 + rnd() * 0.25);    // 压瘪
      g.add(m);
    }
  } else {
    // 车体：原模型可见网格 → 烧焦壳（倾斜 + 下沉）
    const hull = new THREE.Group();
    const turret = new THREE.Group();
    // Q3：约七成坦克殉爆时炮塔被掀飞（弹药舱殉爆的标志性画面）；种子随机，可复现
    const popTurret = t.type === 'tank' && rnd() < 0.7;
    const inv = new THREE.Matrix4().copy(t.group.matrixWorld).invert();
    const cache = new Map();
    t.group.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const srcMat = Array.isArray(o.material) ? o.material[0] : o.material;
      let cm = cache.get(srcMat);
      if (!cm) { cm = charMaterial(srcMat); cache.set(srcMat, cm); mats.push(cm); }
      const mtx = new THREE.Matrix4().copy(inv).multiply(o.matrixWorld);
      // Q3 炮塔掀飞：坦克按高度把网格切成车体/炮塔两份（切分几何按源几何缓存复用）
      const parts = popTurret ? splitTurretGeo(o.geometry, mtx) : null;
      const add = (geo, parent) => {
        const m = new THREE.Mesh(geo, cm);
        m.userData.noDispose = true;             // 几何属于原车（或与原车共享顶点缓冲），复位时不释放
        m.matrixAutoUpdate = false;
        m.matrix.copy(mtx);
        m.castShadow = true; m.receiveShadow = true;
        parent.add(m);
      };
      if (!parts) add(o.geometry, hull);
      else { if (parts.lo) add(parts.lo, hull); if (parts.hi) add(parts.hi, turret); }
    });
    if (popTurret) {
      // 炮塔绕自身中心转：把切下来的网格挂在以炮塔环为原点的子组里
      turret.position.set(...TURRET_PIVOT);
      const back = new THREE.Matrix4().makeTranslation(-TURRET_PIVOT[0], -TURRET_PIVOT[1], -TURRET_PIVOT[2]);
      for (const m of turret.children) m.matrix.premultiply(back);
      hull.add(turret);
      const a = rnd(TAU), hv = rnd(0.6, 1.6);
      g.userData.pop = { obj: turret, t: 0, vx: Math.cos(a) * hv, vz: Math.sin(a) * hv, vy: rnd(4.2, 5.6),
        sx: rnd(-3, 3), sy: rnd(-4, 4), sz: rnd(-3, 3), land: false };
    }
    hull.rotation.y = t.group.rotation.y;
    hull.scale.copy(t.group.scale);
    const tilt = new THREE.Group();
    tilt.rotation.set((rnd() - 0.5) * 0.16, 0, (rnd() - 0.5) * 0.2);
    tilt.position.y = -0.07;
    tilt.add(hull);
    g.add(tilt);
  }
  // 扭曲碎片
  const chunkGeo = new THREE.IcosahedronGeometry(0.2, 0);
  const n = t.type === 'tank' ? 6 : t.type === 'truck' ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(chunkGeo, i % 2 ? emberMat : debrisMat);
    const a = rnd(TAU), r = rnd(1.4, 3.2);
    m.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
    m.scale.set(rnd(0.6, 1.8), rnd(0.25, 0.5), rnd(0.5, 1.4));
    m.rotation.set(rnd(0.5), rnd(TAU), rnd(0.5));
    m.castShadow = false;
    g.add(m);
  }
  // 焦痕
  const sz = t.type === 'tank' ? 6.2 : t.type === 'truck' ? 5.4 : 4.6;
  const scMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mats.push(scMat);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), scMat);
  sc.rotation.x = -PI / 2; sc.rotation.z = rnd(TAU);
  sc.position.y = 0.02; sc.renderOrder = 2;
  g.add(sc);
  g.userData.charMats = mats;
  g.userData.ember0 = t.type === 'barrel' ? 1.1 : 0.85;
  return g;
}
// Q3 炮塔掀飞：按「连通块」切分——同一块零件（顶点相连，或位置重合的接缝顶点）
// 整块归属，不切三角形（按高度切三角形会在车体上留下尖刺）。连通块最低点
// 高于 TURRET_MIN_Y（车体局部坐标）的算炮塔（炮塔本体/炮管/观瞄等）。
// 共享原几何顶点属性、只新建索引——零顶点复制；按源几何缓存，所有坦克复用。
// 实测（T-80U GLB 车体局部）：车体 0.07~0.96、炮塔 0.76~1.10、炮管 0.88~1.03。
const TURRET_MIN_Y = 0.74;
const TURRET_PIVOT = [0, 0.9, 0.25];   // 炮塔转轴（车体局部；GLB 与兜底模型炮塔都在 z≈0.25）
const _turretSplit = new Map();
function splitTurretGeo(geo, mtx) {
  if (_turretSplit.has(geo)) return _turretSplit.get(geo);
  const pos = geo.attributes.position, n = pos.count;
  const idx = geo.index ? geo.index.array : null;
  const tri = idx ? idx.length : n;
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const f = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const seam = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 1e3) + ',' + Math.round(pos.getY(i) * 1e3) + ',' + Math.round(pos.getZ(i) * 1e3);
    if (seam.has(k)) par[f(i)] = f(seam.get(k)); else seam.set(k, i);
  }
  for (let k = 0; k < tri; k += 3) {
    const a = idx ? idx[k] : k;
    par[f(idx ? idx[k + 1] : k + 1)] = f(a); par[f(idx ? idx[k + 2] : k + 2)] = f(a);
  }
  const e = mtx.elements, low = new Map();
  for (let i = 0; i < n; i++) {
    const y = e[1] * pos.getX(i) + e[5] * pos.getY(i) + e[9] * pos.getZ(i) + e[13];
    const r = f(i); if (!(low.get(r) <= y)) low.set(r, y);
  }
  const lo = [], hi = [];
  for (let k = 0; k < tri; k += 3) {
    const a = idx ? idx[k] : k;
    (low.get(f(a)) >= TURRET_MIN_Y ? hi : lo).push(a, idx ? idx[k + 1] : k + 1, idx ? idx[k + 2] : k + 2);
  }
  const mk = arr => {
    if (!arr.length) return null;
    const g2 = new THREE.BufferGeometry();
    for (const k in geo.attributes) g2.setAttribute(k, geo.attributes[k]);
    g2.setIndex(arr);
    return g2;
  };
  const r = { lo: mk(lo), hi: mk(hi) };
  _turretSplit.set(geo, r);
  return r;
}
// 炮塔飞行：抛物线 + 翻滚，落地后歪斜停住（16-targets 残骸循环每帧调用）
const POP_G = 4.3;             // 重力（u/s²；1u≈2.27m）
function wreckPop(wreck, dt) {
  const P = wreck.userData.pop;
  if (!P || P.land) return;
  const o = P.obj;
  P.t += dt;
  P.vy -= POP_G * dt;
  o.position.x += P.vx * dt; o.position.z += P.vz * dt; o.position.y += P.vy * dt;
  o.rotation.x += P.sx * dt; o.rotation.y += P.sy * dt; o.rotation.z += P.sz * dt;
  if (P.vy < 0 && o.position.y <= 0.2) {
    // 落地：贴地并压成侧翻姿态（不穿地即可，不做物理）
    o.position.y = 0.2;
    o.rotation.x = Math.max(-0.5, Math.min(0.5, o.rotation.x));
    o.rotation.z = Math.max(-0.6, Math.min(0.6, o.rotation.z));
    P.land = true;
  }
}
// 余烬：燃烧剩余比例 → 自发光强度（越烧越暗，熄灭后归零）
function wreckEmber(wreck, frac, flick) {
  const ms = wreck.userData.charMats;
  if (!ms) return;
  const k = Math.max(0, frac) * (wreck.userData.ember0 || 0.8) * flick;
  // 车壳只透一点暗红（整车发光像塑料），小碎片才是明显的红热余烬
  for (const m of ms) if (m.emissive) m.emissiveIntensity = m.userData.ember ? k * 0.55 : 0;
}
