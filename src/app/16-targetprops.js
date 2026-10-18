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
};
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
      const g = new THREE.Group();
      g.add(inst);
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      g.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        if (def.opaque) { o.material = o.material.clone(); o.material.transparent = false; o.material.alphaTest = 0; o.material.opacity = 1; }
      });
      parent.add(g);
      g.updateMatrixWorld(true);
      mergeTargetStatics({ group: g });
    });
  }
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
  ]);
}
