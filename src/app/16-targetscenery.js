// ============================================================
// 16-targetscenery.js — 靶场阵地布景（掩体土墙/沙袋/围堰/警戒桩/车辙）
// ============================================================
// 2026-10-12 批 E 自 16-targets.js 的 TargetRange.buildScenery 拆出（纯搬移：
// this → range，行为不变）。TargetRange.buildScenery 仍是唯一入口，转调这里。
// 字典序排在 16-targets.js 之后（"." < "c"）；函数声明在 IIFE 内提升，调用发生在
// 运行期，顺序无影响。
// ============================================================

// ---------- P31-B 军事场景布景 ----------
// 阵地感四件：掩体土墙（B1）/沙袋工事（B2）/油料围堰（B3）/警戒桩（B5）
// 同走沙色材质 bake 后 mergeGeos 成 1 mesh；车辙地贴（B4）独立半透材质
// 1 mesh——合计 +2 draw（靶场禁用/湖面时整体隐藏，恒 0）。沙袋/围堰
// 与 81-narrative strikes[].pos（radar=-16,46 / ammo=-11,40，BC 相对）
// 保持硬编码同步——若移设施须两处同改（总指挥配合项）。
function buildRangeScenery(range, BC, layout) {
  if (range.scenery) { range.scene.remove(range.scenery); disposeObject3D(range.scenery); }
  const sandGeos = [], trackGeos = [];
  const push = (arr, geo, x, y, z, ry = 0) => {
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    arr.push(geo);
  };
  const bag = (cx, cz, w, rows) => {
    // 沙袋墙：交错小盒若干行（真实沙袋 0.5×0.3×0.25 折算 0.24×0.15×0.2）
    for (let row = 0; row < rows; row++) {
      const n = Math.max(2, Math.round(w / 0.26));
      for (let i = 0; i < n; i++) {
        push(sandGeos, new THREE.BoxGeometry(0.24, 0.15, 0.20),
          cx - w / 2 + (i + 0.5 + (row % 2) * 0.5) * (w / n), 0.08 + row * 0.15, cz, 0);
      }
    }
  };
  // B1 车辆掩体：每辆【静止】坦克车后 U 形低土墙（开口朝敌/原点方向）。
  // 动目标（首车折返巡逻 ±2.4u）会倒车撞墙，跳过；back 3.0 让开 4.3u 新车长
  for (const t of range.targets) {
    if (t.type !== 'tank' || t.mov) continue;
    const face = t.group.rotation.y;                 // 与车体同朝向（+Z 前指敌）
    const F = { x: Math.sin(face), z: Math.cos(face) };   // 前向（朝原点）
    const P = { x: Math.cos(face), z: -Math.sin(face) };  // 侧向（垂直车轴）
    const bx = t.group.position.x, bz = t.group.position.z;
    const back = 3.0;
    const rx = bx - F.x * back, rz = bz - F.z * back;
    // 后墙（长轴沿侧向 P：rotateY(face) 把局部 +X 转到 (cos face, -sin face)=P）
    push(sandGeos, new THREE.BoxGeometry(3.0, 0.55, 0.5), rx, 0.26, rz, face);
    // 两翼墙（长轴沿前向 F，从后墙向车体方向伸——U 开口朝敌）
    for (const sx of [-1.45, 1.45]) {
      push(sandGeos, new THREE.BoxGeometry(0.5, 0.5, 1.6),
        rx + P.x * sx - F.x * 0.85, 0.24, rz + P.z * sx - F.z * 0.85, face);
    }
  }
  // B2 沙袋工事：雷达站 / 弹药库周边（坐标与 81-narrative strikes[].pos 同步：
  // radar=BC+(-16,+4)、ammo=BC+(-11,-2)——若移设施须两处同改，总指挥配合项）
  const radarP = { x: BC.x - 16, z: BC.z + 4 };
  const ammoP = { x: BC.x - 11, z: BC.z - 2 };
  for (const dz of [-1.9, 1.9]) bag(radarP.x + dz, radarP.z + 1.8, 3.2, 2);
  bag(radarP.x - 2.2, radarP.z + 0.2, 2.6, 2);
  for (const dz of [-1.7, 1.7]) bag(ammoP.x + dz, ammoP.z - 1.6, 2.6, 2);
  bag(ammoP.x + 1.9, ammoP.z + 0.1, 2.2, 2);
  // B3 油料围堰：油桶区外圈低矮环形围堰（4 段低墙围成隔离区）
  const bp = { x: BC.x - 9, z: BC.z };
  const bw = 3.4, bd = 3.0;
  push(sandGeos, new THREE.BoxGeometry(bw + 0.8, 0.34, 0.4), bp.x, 0.17, bp.z - bd / 2);
  push(sandGeos, new THREE.BoxGeometry(bw + 0.8, 0.34, 0.4), bp.x, 0.17, bp.z + bd / 2);
  push(sandGeos, new THREE.BoxGeometry(0.4, 0.34, bd), bp.x - bw / 2, 0.17, bp.z);
  push(sandGeos, new THREE.BoxGeometry(0.4, 0.34, bd), bp.x + bw / 2, 0.17, bp.z);
  // B5 警戒线：基地外缘一圈 HESCO 挡墙块（0.55×0.95×0.55，40u 俯瞰可辨；
  // 细桩方案 0.1u 在远景亚像素不可读，弃）。
  // 2026-10-12 修正：旧坐标是绝对值却又加了一次 BC，整圈墙被推到基地后方
  // z=74~92（离车辆 30u）。现改为 BC 相对矩形 x∈[-19,19]、z∈[-14.6,+12]：
  //   · 包住防空车(12,-6)/探照灯(14,8)/雷达(-16,4)/弹药库(-11,-2) 与全部靶标；
  //   · 包住 B2 疏散环路（x∈[-3,17]、z∈[-13,+8.5]，墙块边缘到车道中线 ≥1.3u，卡车半宽 0.55）；
  //   · 西南角块外缘 (-19.3,27.1) 方位角 0.618 <0.62——整圈在 duneFarH 平地走廊内；
  //   · 南墙正中留 5.2u 正门（进场主路），北墙正中留门通往城镇（16-town）。
  const per = [[-19, -14.6], [19, -14.6], [19, 12], [-19, 12]];
  const GATE = 2.6;                                  // 门洞半宽（|x|<GATE 不放块）
  for (let s = 0; s < 4; s++) {
    const [ax, az] = per[s], [bx2, bz2] = per[(s + 1) % 4];
    const len = Math.hypot(bx2 - ax, bz2 - az);
    const n = Math.max(3, Math.round(len / 3.4));
    for (let i = 0; i <= n; i++) {                   // 含角点：四角各放一块
      if (i === n) continue;                         // 终点 = 下一段起点，避免重复
      const px = ax + (bx2 - ax) * i / n, pz = az + (bz2 - az) * i / n;
      if (az === bz2 && Math.abs(px) < GATE) continue;   // 南/北墙门洞
      push(sandGeos, new THREE.BoxGeometry(0.55, 0.95, 0.55), BC.x + px, 0.47, BC.z + pz);
    }
  }
  // B4 车辙：停放线与迎敌弧的深色半透地贴（成对轮迹 + 一条进场路辙）
  const rut = (x, z, ang, w, l) => {
    const g = new THREE.PlaneGeometry(w, l);
    g.rotateX(-PI / 2);
    g.rotateY(ang);
    g.translate(x, 0.014, z);
    trackGeos.push(g);
  };
  for (const t of range.targets) {
    const face = t.group.rotation.y;
    const cw = Math.cos(face), sw = Math.sin(face);
    if (t.mov) continue;                             // 动目标不留固定辙
    if (t.type === 'tank') {
      // 坦克：加长双履带印（5.4u，两端探出车体前后——驶入/离场可读）
      for (const side of [-0.62, 0.62]) {
        rut(t.group.position.x + cw * side, t.group.position.z - sw * side, face, 0.40, 5.4);
      }
    } else {
      // 卡车：车身会盖住正下方辙（3.1u 车身 vs 3.0u 辙）——改为从车位
      // 横向通向中央主路的"进场连接辙"，40u 俯瞰读得出停放区被道路喂给
      const dx = t.group.position.x - 0.6 > 0 ? -1 : 1;   // 朝主路一侧
      rut(t.group.position.x + dx * 1.7, t.group.position.z, dx > 0 ? -1.57 : 1.57, 0.26, 3.4);
    }
  }
  // 进场路辙：双辙主路纵贯——南接停放线（z≈47）、北到迎敌弧后方（z≈37）
  rut(BC.x - 1.1, BC.z, 0, 0.22, 10);
  rut(BC.x + 0.5, BC.z, 0, 0.22, 10);
  // —— 合批：沙色件 1 mesh + 车辙半透 1 mesh ——
  const g = new THREE.Group();
  const sandMesh = new THREE.Mesh(mergeGeos(sandGeos),
    targetMat(0xb9a284, 0.95, 0.02));
  sandMesh.castShadow = false; sandMesh.receiveShadow = true;
  g.add(sandMesh);
  const trackMesh = new THREE.Mesh(mergeGeos(trackGeos),
    new THREE.MeshBasicMaterial({ color: 0x241d14, transparent: true, opacity: 0.30, depthWrite: false }));
  trackMesh.renderOrder = 2;
  g.add(trackMesh);
  g.visible = range.enabled;
  range.scenery = g;
  range.scene.add(g);
}
