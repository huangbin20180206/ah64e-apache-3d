// ============================================================
// 16-targetprops.js — 布景道具真模型（2026-10-18 ASSETS2）
// 基地/城镇的不可破坏装饰件：储油罐、道闸检查站、油桶、弹药箱、加油站、
// 沙漠村落、废弃轿车、旧货车、越野摩托。全部 Sketchfab CC BY 4.0（作者见 CREDITS.md）。
// 只是背景装饰：不进 targets、不参与命中/伤害，弹药直接穿过。
// 异步加载：GLB 到位后挂到传入的父组（基地挂 range.scenery、城镇挂 town.group），
// 显隐跟随父组；加载失败静默跳过（场景照常，只是少几件道具）。
// 尺寸：按 PROP_DEFS 的 len（水平最长边）或 h（高度）等比缩放到真实尺寸（1u≈2.27m），
// 底面贴地 y=0、水平中心对齐摆放点。每件按材质合批（mergeTargetStatics）。
// ============================================================

const PROP_DEFS = {
  fueltank: { url: 'assets/targets/prop_fueltank.glb', h: 2.4, opaque: true },   // 立式储油罐 ≈5.5m 高（原贴图带镂空透明，强制实心）
  barrier:  { url: 'assets/targets/prop_barrier.glb', len: 2.6 },    // 道闸栏杆 ≈6m
  booth:    { url: 'assets/targets/prop_booth.glb', h: 1.15 },       // 岗亭 ≈2.6m 高
  drums:    { url: 'assets/targets/prop_drums.glb', len: 0.85 },     // 油桶 3 只一组 ≈1.9m
  ammo:     { url: 'assets/targets/prop_ammo.glb', len: 0.55 },      // 弹药箱 ≈1.25m
  gas:      { url: 'assets/targets/prop_gas.glb', len: 6.2 },        // 小加油站（带棚）≈14m
  // 沙漠平顶民房套件：一个文件里叠放了 6 栋（展示用堆叠摆法），按节点名逐栋取出、
  // 各自贴地摆成村落（three 加载时节点名空格变下划线）；模型单位=米 → k=1/2.27 即真实尺寸（2 层楼 ≈6.8m 高）
  house1:   { url: 'assets/targets/prop_village.glb', pick: 'Concrete_House_001', k: 1 / 2.27 },
  house2:   { url: 'assets/targets/prop_village.glb', pick: 'Concrete_House_002', k: 1 / 2.27 },
  house3:   { url: 'assets/targets/prop_village.glb', pick: 'Concrete_House_003', k: 1 / 2.27 },
  house4:   { url: 'assets/targets/prop_village.glb', pick: 'Concrete_House_004', k: 1 / 2.27 },
  house5:   { url: 'assets/targets/prop_village.glb', pick: 'Concrete_House_005', k: 1 / 2.27 },
  house6:   { url: 'assets/targets/prop_village.glb', pick: 'Concrete_House_006', k: 1 / 2.27 },
  sedan:    { url: 'assets/targets/prop_sedanwreck.glb', len: 2.0 }, // 废弃轿车 ≈4.5m
  van:      { url: 'assets/targets/prop_van.glb', len: 2.15 },       // 旧厢式货车 ≈4.9m
  // 越野摩托：文件里 7 辆一排（不同颜色），按节点名取两辆停在街边；车长 ≈2.1m
  motoK:    { url: 'assets/targets/prop_moto.glb', pick: 'dirt_bike_black', len: 0.93 },
  motoR:    { url: 'assets/targets/prop_moto.glb', pick: 'dirt_bike_red', len: 0.93 },
  // 2026-10-18 ASSETS4（团结 AI 生成，AIGC，见 CREDITS.md）：城镇可摧毁楼的外壳——
  // 不走 placeProps，由 skinTownBuilding 套到 16-town 的程序化楼上（命中盒/塌方不变）
  warehouse: { url: 'assets/targets/warehouse.glb' },   // 铁皮仓库（卷帘门朝模型 +Z）
  house2f:   { url: 'assets/targets/house_2f.glb' },    // 两层民房（阳台/外楼梯朝模型 +Z）
  // 2026-10-19 ASSETS5（团结 AI 生成，AIGC）：真实尺寸 ÷2.27 → len（水平最长边）或 h（高）
  house1f:   { url: 'assets/targets/house_1f.glb' },      // 一层平顶院落房（skin 用，院门朝 +Z）
  watertower:{ url: 'assets/targets/water_tower.glb' },   // 混凝土高架水塔（skin 用）
  mosque:    { url: 'assets/targets/mosque.glb', len: 6.3 },          // 小清真寺 14m（门朝 +Z）
  shoprow:   { url: 'assets/targets/shop_row.glb', len: 5.3 },        // 三间临街铺面 12m（铺面朝 +X）
  stall:     { url: 'assets/targets/market_stall.glb', len: 1.3 },    // 集市果蔬摊 2.9m
  // 椰枣树 8.2m（ASSETS6 换镂空细叶版）。cutout：叶片改"镂空裁切"不走半透明排序（远近叠放不再闪），
  // 叶色压成带灰土的橄榄绿（原贴图偏鲜绿，和沙漠色调不搭）
  palm:      { url: 'assets/targets/palm_tree_v2.glb', h: 3.6, cutout: [0.74, 0.72, 0.56] },
  tent:      { url: 'assets/targets/tent_military.glb', len: 2.64 },  // 军用帐篷 6m（门帘朝 +Z）
  generator: { url: 'assets/targets/generator.glb', len: 0.97 },      // 柴油发电机 + 油桶 2.2m
  container: { url: 'assets/targets/container.glb', len: 2.67 },      // 集装箱（按 20 尺 6.06m 摆）
  zu23:      { url: 'assets/targets/zu23_emplacement.glb', len: 1.71 },   // ZU-23-2 高炮阵地 3.9m（炮口朝 +Z）
  dshk:      { url: 'assets/targets/dshk_nest.glb', len: 1.3 },       // DShK 重机枪掩体 3m
  mortar:    { url: 'assets/targets/mortar_pit.glb', len: 1.06 },     // 82mm 迫击炮阵地 2.4m
  bunker:    { url: 'assets/targets/bunker.glb', h: 1.1 },            // 混凝土碉堡 2.5m 高（射击孔朝 +Z）
  wreck:     { url: 'assets/targets/car_wreck.glb', len: 1.94 },      // 烧毁轿车 4.4m
  commtower: { url: 'assets/targets/comms_tower.glb', h: 11.0 },      // 通信铁塔 25m
  // 2026-10-19 ASSETS6（团结 AI 生成，AIGC）
  heliwreck: { url: 'assets/targets/heli_wreck.glb', len: 6.6 },      // 侧翻烧毁的黑鹰 15m（尾梁折断）
  rubble:    { url: 'assets/targets/rubble_pile.glb', len: 2.7 },     // 瓦砾堆 6m（碎水泥+钢筋）
  // 抽油机 8m：beam 游梁点头、crank 曲柄配重旋转（节点原点在各自转轴，绕模型 X 轴）
  pumpjack:  { url: 'assets/targets/oil_pumpjack.glb', len: 3.5, anim: 'pump' },
  // ZU-23-2 牵引高炮 4.6m（不带沙袋）：turret 上座缓慢左右搜索、barrels 双管上扬
  zu23t:     { url: 'assets/targets/zu23_towed.glb', len: 2.03, anim: 'scan' },
};
// 道具小动画（ASSETS6）：活动件不进合批，挂在其网格的 onBeforeRender 上按时钟摆动——
// 只在画面里看得到时才算，不进主循环；纯装饰，不影响玩法。
const PROP_ANIM = {
  pump: { pump: ['beam', 'crank'] },
  scan: { scan: ['turret', 'barrels'] },
};
const _paQ = new THREE.Quaternion(), _paX = new THREE.Vector3(1, 0, 0), _paY = new THREE.Vector3(0, 1, 0);
function _rigPropAnim(inst, kind) {
  const names = Object.values(PROP_ANIM[kind])[0];
  let a = inst.getObjectByName(names[0]), b = inst.getObjectByName(names[1]);
  if (!a || !b) return;
  if (kind === 'scan') a.attach(b);                 // 炮管跟着上座转
  if (kind === 'pump') {
    // 生成模型的曲柄节点原点不在配重转轴上（偏到上方 ~3m，转起来会甩飞）→ 套一层转轴组，
    // 轴心放在配重包围盒中心（只绕自己转）；游梁原点在支点上，可直接转
    inst.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3());
    const pv = new THREE.Group();
    b.parent.add(pv);
    pv.position.copy(b.parent.worldToLocal(c));
    pv.updateMatrixWorld(true);
    pv.attach(b);
    b = pv;
  }
  for (const n of [a, b]) { n.userData.q0 = n.quaternion.clone(); n.traverse(o => { if (o.isMesh) o.userData.noMerge = true; }); }
  const ph = (inst.id % 7) * 0.9;
  let last = -1;
  const tick = () => {
    const t = performance.now() / 1000 + ph;
    if (t === last) return; last = t;
    if (kind === 'pump') {
      // 约 6 秒一冲程：曲柄匀速转，游梁随之点头 ±14°
      const w = TAU / 6;
      a.quaternion.copy(a.userData.q0).multiply(_paQ.setFromAxisAngle(_paX, Math.sin(t * w) * 0.25));
      b.quaternion.copy(b.userData.q0).multiply(_paQ.setFromAxisAngle(_paX, t * w));
    } else {
      // 上座左右搜索 ±50°（约 14 秒一个来回），双管保持上扬 35°
      a.quaternion.copy(a.userData.q0).multiply(_paQ.setFromAxisAngle(_paY, Math.sin(t * 0.45) * 0.87));
      b.quaternion.copy(b.userData.q0).multiply(_paQ.setFromAxisAngle(_paX, -0.6));
    }
  };
  for (const n of [a, b]) n.traverse(o => { if (o.isMesh) o.onBeforeRender = tick; });
}
let _propCache = null;
function _loadPropModels() {
  if (_propCache) return _propCache;
  const loader = new THREE.GLTFLoader();
  _propCache = {};
  const byUrl = {};   // 同一文件只下载一次（村落 6 栋共用一个 GLB）
  for (const [k, d] of Object.entries(PROP_DEFS)) {
    _propCache[k] = byUrl[d.url] || (byUrl[d.url] = new Promise((res) => loader.load(d.url, (g) => res(g.scene), undefined, () => res(null))));
  }
  return _propCache;
}

// list: [[key, x, z, ry], ...]（世界坐标）
function placeProps(parent, list) {
  const cache = _loadPropModels();
  for (const [key, x, z, ry = 0] of list) {
    const def = PROP_DEFS[key];
    if (!def) continue;
    cache[key].then((src) => {
      if (!src || !parent) return;
      let inst;
      if (def.pick) {
        // 按节点名取单栋：带上它在原文件里的完整世界变换（Sketchfab 根节点含 -90°X 等旋转）
        const node = src.getObjectByName(def.pick);
        if (!node) return;
        src.updateMatrixWorld(true);
        inst = node.clone(true);
        node.matrixWorld.decompose(inst.position, inst.quaternion, inst.scale);
      } else inst = src.clone(true);
      const box = new THREE.Box3().setFromObject(inst, true), sz = box.getSize(new THREE.Vector3());
      const k = def.k || (def.h ? def.h / Math.max(sz.y, 1e-4) : def.len / Math.max(sz.x, sz.z, 1e-4));
      const c = box.getCenter(new THREE.Vector3());
      // 先缩放再平移：包围盒是在 inst 现有变换下量的，缩放绕原点 ⇒ 新位置 = (旧位置-中心)·k
      inst.scale.multiplyScalar(k);
      inst.position.set((inst.position.x - c.x) * k, (inst.position.y - box.min.y) * k, (inst.position.z - c.z) * k);
      if (def.anim) _rigPropAnim(inst, def.anim);
      const g = new THREE.Group();
      g.add(inst);
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      g.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        if (def.opaque) { o.material = o.material.clone(); o.material.transparent = false; o.material.alphaTest = 0; o.material.opacity = 1; }
        if (def.cutout && o.material.transparent) {
          const m = o.material.userData.cut || (o.material.userData.cut = o.material.clone());
          m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; m.color.setRGB(...def.cutout); m.side = THREE.DoubleSide;
          o.material = m;
        }
      });
      parent.add(g);
      g.updateMatrixWorld(true);
      mergeTargetStatics({ group: g });
    });
  }
}

// 城镇楼换真模型外壳（2026-10-18 ASSETS4）：b = 16-town 的 building 记录。
// 模型旋转 ry 后，按包围盒分轴缩放到楼的 w×h×d（≤ ±12% 形变），挂进 b.group
// （塌方下沉/倾斜自动跟随），隐藏程序化墙体与屋顶；材质克隆一份进 b.skinMats，
// 半毁变暗/重置还原由 16-town 同步。加载失败 → 保持程序化楼。
function skinTownBuilding(b, key, ry) {
  _loadPropModels()[key].then((src) => {
    if (!src || !b.group) return;
    const inst = src.clone(true);
    const pivot = new THREE.Group();
    pivot.add(inst);
    pivot.rotation.y = ry;
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot, true), sz = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(pivot);
    pivot.position.set(-c.x, -box.min.y, -c.z);
    holder.scale.set(b.w / Math.max(sz.x, 1e-4), b.h / Math.max(sz.y, 1e-4), b.d / Math.max(sz.z, 1e-4));
    b.skinMats = [];
    holder.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.material = o.material.clone();
      b.skinMats.push(o.material);
    });
    for (const ch of b.group.children) ch.visible = false;   // 程序化墙体 + 屋顶
    b.group.add(holder);
    b.skin = holder;
    if (b._dmgLook) for (const m of b.skinMats) m.color.setScalar(0.62);
  });
}

// 基地（BC=基地中心）：油料区储油罐 + 油桶、营区弹药箱、进场土路道闸检查站
function placeRangeProps(parent, BC) {
  placeProps(parent, [
    ['fueltank', BC.x - 21.0, BC.z - 9.5, 0],
    ['fueltank', BC.x - 21.0, BC.z - 5.8, 1.1],
    ['drums', BC.x - 18.6, BC.z - 7.6, 0.4],
    ['drums', BC.x - 13.0, BC.z - 1.2, 2.0],
    ['ammo', BC.x - 12.4, BC.z + 9.2, 0.2],
    ['ammo', BC.x - 11.7, BC.z + 9.3, -0.1],
    ['ammo', BC.x + 9.4, BC.z + 11.0, 1.5],
    ['barrier', BC.x, BC.z - 21.0, 0],           // 土路南段（沿 z 走向）横拦
    ['booth', BC.x + 2.1, BC.z - 21.6, -PI / 2],
    // 2026-10-19 ASSETS5：营区真帐篷（替换 16-targetscenery 程序化帐篷，长边沿 x、门朝东）+ 发电机
    ['tent', BC.x - 21, BC.z + 12, PI / 2],
    ['tent', BC.x - 15.5, BC.z + 12, PI / 2],
    ['tent', BC.x - 10, BC.z + 12, PI / 2],
    ['generator', BC.x - 18.3, BC.z + 9.6, 0.3],
    // 防御工事：南门两侧重机枪掩体、门外碉堡、东侧高炮阵地、西侧迫击炮阵地（均朝南来袭方向）
    ['dshk', BC.x - 5.2, BC.z - 14.2, PI],
    ['dshk', BC.x + 5.2, BC.z - 14.2, PI],
    ['bunker', BC.x - 6.0, BC.z - 19.2, PI],
    ['zu23', BC.x + 21.2, BC.z + 2.2, PI * 0.9],
    ['mortar', BC.x - 22.0, BC.z + 4.0, PI],
    ['container', BC.x + 22.6, BC.z + 7.2, 0],
    // 墙外：西侧通信铁塔、进场土路边烧毁轿车、门口椰枣树
    ['commtower', BC.x - 30.0, BC.z + 4.0, 0.4],
    ['wreck', BC.x - 20.0, BC.z - 30.6, 0.35],
    ['palm', BC.x - 4.4, BC.z - 18.0, 0],
    ['palm', BC.x + 4.6, BC.z - 18.4, 1.7],
    // 2026-10-19 ASSETS6：东南荒地一架坠毁烧黑的黑鹰（背景故事件）
    ['heliwreck', BC.x + 32.0, BC.z - 28.0, 0.8],
  ]);
}

// 城镇（C=TOWN_CENTER）：东口加油站、西侧村落、街边废车与货车
function placeTownProps(parent, C) {
  placeProps(parent, [
    ['gas', C.x + 22.0, C.z + 0.5, -PI / 2],
    ['house1', C.x - 22.5, C.z - 4.5, 0],     // 西郊村落：两排 6 栋，留出 ~2u 巷道
    ['house3', C.x - 27.5, C.z - 4.5, PI / 2],
    ['house6', C.x - 32.0, C.z - 4.8, 0],
    ['house2', C.x - 22.5, C.z + 4.8, PI],
    ['house5', C.x - 27.0, C.z + 5.0, -PI / 2],
    ['house4', C.x - 32.0, C.z + 5.0, PI],
    ['sedan', C.x + 2.6, C.z - 9.6, 0.25],
    ['van', C.x - 2.7, C.z + 11.8, PI + 0.1],
    ['drums', C.x - 15.2, C.z + 1.8, 0.7],
    ['motoK', C.x + 2.1, C.z + 2.4, 0.2],
    ['motoR', C.x - 2.2, C.z - 2.9, 2.9],
    // 2026-10-19 ASSETS5：北巷以北的清真寺（地标，门朝南）、三间铺面（铺面朝南）、集市摊、椰枣树、废车
    ['mosque', C.x - 7.0, C.z + 15.6, PI],
    ['shoprow', C.x + 8.0, C.z + 14.4, PI / 2],
    ['stall', C.x - 13.6, C.z + 12.4, PI],
    ['stall', C.x - 11.8, C.z + 12.5, PI + 0.15],
    ['stall', C.x + 13.4, C.z + 12.3, PI - 0.1],
    ['container', C.x + 15.8, C.z - 9.0, 0.3],
    ['wreck', C.x - 17.6, C.z - 2.6, 1.2],
    ['palm', C.x - 16.5, C.z + 13.5, 0], ['palm', C.x + 16.8, C.z + 13.8, 2.0],
    ['palm', C.x - 19.0, C.z - 8.5, 1.0], ['palm', C.x + 19.2, C.z - 8.2, 3.0],
    ['palm', C.x + 25.6, C.z - 4.2, 0.5], ['palm', C.x + 25.8, C.z + 5.4, 2.4],
    ['palm', C.x - 2.6, C.z + 19.6, 1.3], ['palm', C.x + 3.4, C.z + 18.8, 4.0],
    // 2026-10-19 ASSETS6：南街瓦砾、东郊两台抽油机、东北角牵引高炮
    ['rubble', C.x - 8.0, C.z - 11.6, 0.4], ['rubble', C.x + 9.0, C.z - 12.0, 2.2],
    ['pumpjack', C.x + 32.0, C.z + 9.0, 0.2], ['pumpjack', C.x + 33.5, C.z - 8.5, -0.3],
    ['zu23t', C.x + 21.0, C.z + 13.5, -0.6],
  ]);
}
