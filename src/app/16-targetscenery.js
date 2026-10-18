// ============================================================
// 16-targetscenery.js — 靶场阵地布景（掩体土墙/沙袋/围堰/警戒桩/车辙；P5-G2 步兵工事/进场土路/电线杆）
// ============================================================
// 2026-10-12 批 E 自 16-targets.js 的 TargetRange.buildScenery 拆出（纯搬移：
// this → range，行为不变）。TargetRange.buildScenery 仍是唯一入口，转调这里。
// 字典序排在 16-targets.js 之后（"." < "c"）；函数声明在 IIFE 内提升，调用发生在
// 运行期，顺序无影响。
// ============================================================

// ---------- P31-B 军事场景布景 ----------
// 阵地感：掩体土墙（B1）/沙袋工事（B2）/油料围堰（B3）同走沙色材质 bake 后
// mergeGeos 成 1 mesh；B5 围墙+门禁+哨塔+营区建筑（2026-10-15）顶点色 1 mesh；
// 车辙地贴（B4）独立半透材质 1 mesh——合计 +3 draw（靶场禁用/湖面时整体隐藏，恒 0）。
// 沙袋/围堰与 81-narrative strikes[].pos（radar=BC+(-16,4) / ammo=BC+(-11,-2)）
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
  // B5 基地围墙（2026-10-15 真实化：旧版是间隔 3.4u 的孤立白方块，像墓碑）——
  // 连续的 HESCO 防爆墙（军用土工布石笼，单格 ≈2.1m 宽 × 2.2m 高 ≈0.93u × 0.95u），
  // 每格带深色顶框与竖向接缝，颜色逐格微差。BC 相对矩形 x∈[-25,25]、z∈[-16,+15]：
  //   · 包住全部靶标、雷达/防空车/弹药库/探照灯、B2 疏散环路（x∈[-3,17]、z∈[-13,8.5]）
  //     与 3-1 关的补给车环线（x 4~20 / -8~-12，见 91-levels）；
  //   · 南墙正中留 6u 正门（进场主路），北墙正中留门通往城镇（16-town）；
  //   · 基地已整体位于远景沙丘环（r 31.5~48u）之外的平地，不受 duneFarH 影响。
  // 围墙 + 门禁 + 哨塔 + 营区建筑全部烘进 1 个顶点色 mesh（+1 draw）。
  const K = vcKit();
  const HX = 25, HZ0 = -16, HZ1 = 15, GATE = 3.0, CELL = 0.93, HH = 0.95;
  const per = [[-HX, HZ0], [HX, HZ0], [HX, HZ1], [-HX, HZ1]];
  let cellN = 0;
  for (let sgi = 0; sgi < 4; sgi++) {
    const [ax, az] = per[sgi], [bx2, bz2] = per[(sgi + 1) % 4];
    const len = Math.hypot(bx2 - ax, bz2 - az);
    const n = Math.round(len / CELL);
    const alongX = az === bz2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = ax + (bx2 - ax) * t, pz = az + (bz2 - az) * t;
      if (alongX && Math.abs(px) < GATE) continue;           // 南/北门洞
      const w = len / n;
      const sx = alongX ? w - 0.02 : CELL, sz = alongX ? CELL : w - 0.02;
      const tone = (cellN++ * 7919 % 13) / 13;              // 逐格微差（确定性，非随机）
      const col = new THREE.Color(0xb3a07a).offsetHSL(0, 0, (tone - 0.5) * 0.06).getHex();
      K.box(sx, HH, sz, col, BC.x + px, HH / 2, BC.z + pz);
      K.box(sx + 0.03, 0.06, sz + 0.03, 0x6e6a5e, BC.x + px, HH - 0.02, BC.z + pz);   // 顶部钢丝框
      K.box(alongX ? 0.03 : sz + 0.02, HH, alongX ? sz + 0.02 : 0.03, 0x7c776a,
        BC.x + px + (alongX ? w / 2 : 0), HH / 2, BC.z + pz + (alongX ? 0 : w / 2));   // 竖向接缝
    }
  }
  // 门禁：南门两侧混凝土防撞墩（错位迷宫）+ 红白道闸
  for (const sx of [-1, 1]) {
    K.box(1.4, 0.36, 0.30, 0xa8a59c, BC.x + sx * 1.6, 0.18, BC.z + HZ0 - 1.6);
    K.box(0.30, 0.55, 0.30, 0x55574f, BC.x + sx * (GATE - 0.1), 0.275, BC.z + HZ0);
  }
  K.box(1.4, 0.36, 0.30, 0xa8a59c, BC.x, 0.18, BC.z + HZ0 - 3.0);
  for (let i = 0; i < 6; i++) {
    K.box(0.86, 0.07, 0.07, i % 2 ? 0xd8d8d0 : 0xb02a22, BC.x - GATE + 0.45 + i * 0.86, 0.55, BC.z + HZ0);
  }
  // 四角哨塔：4 腿 + 平台 + 沙袋胸墙 + 顶棚（台高 ≈2.6u≈6m）
  const tower = (cx, cz) => {
    for (const ox of [-0.55, 0.55]) for (const oz of [-0.55, 0.55]) {
      K.box(0.09, 3.6, 0.09, 0x4a3f2e, cx + ox, 1.8, cz + oz);
    }
    K.box(1.5, 0.10, 1.5, 0x5a4c36, cx, 2.6, cz);
    for (const [ox, oz, w, d] of [[0, 0.7, 1.5, 0.12], [0, -0.7, 1.5, 0.12], [0.7, 0, 0.12, 1.5], [-0.7, 0, 0.12, 1.5]]) {
      K.box(w, 0.42, d, 0x9c8b67, cx + ox, 2.86, cz + oz);
    }
    K.box(1.75, 0.07, 1.75, 0x3f4636, cx, 3.62, cz);
    K.box(0.06, 2.6, 0.06, 0x3a3226, cx + 0.62, 1.3, cz + 0.85, 0.25, 0, 0);   // 梯子
  };
  for (const [ox, oz] of per) tower(BC.x + ox - Math.sign(ox) * 1.0, BC.z + oz - Math.sign(oz) * 1.0);
  // 营区（北侧 z∈[+10,+14]）：3 顶班用帐篷（8m×5m≈3.6u×2.2u）+ 指挥方舱 + 卫星天线
  const tent = (cx, cz) => {
    K.prism([[-1.1, 0], [1.1, 0], [1.1, 0.72], [0, 1.30], [-1.1, 0.72]], 3.6, 0x5d6644, cx, 0, cz, 0, Math.PI / 2, 0);
    K.prism([[-1.16, 0.70], [0, 1.34], [1.16, 0.70], [1.16, 0.76], [0, 1.40], [-1.16, 0.76]], 3.7, 0x4b5337, cx, 0, cz, 0, Math.PI / 2, 0);
    K.box(0.02, 0.55, 0.60, 0x2c3022, cx + 1.81, 0.30, cz);   // 门帘
    K.box(0.30, 0.50, 0.30, 0x3a3f2e, cx - 1.2, 0.25, cz - 1.25);   // 发电机/箱
  };
  // 2026-10-19 ASSETS5：帐篷改真模型（16-targetprops placeRangeProps 'tent'），程序化版本停用（保留函数作兜底参考）
  void tent;
  // 指挥所：两只 20 尺集装箱（6.1m≈2.7u）并排 + 沙袋 + 天线
  K.box(2.68, 1.13, 1.07, 0x5b6147, BC.x + 7.0, 0.565, BC.z + 11.6);
  K.box(2.68, 1.13, 1.07, 0x666b52, BC.x + 7.0, 0.565, BC.z + 12.8);
  for (let i = 0; i < 5; i++) K.box(0.03, 1.15, 0.03, 0x4c513c, BC.x + 5.75 + i * 0.62, 0.575, BC.z + 11.06);
  K.box(0.36, 0.62, 0.03, 0x2b2e24, BC.x + 6.0, 0.36, BC.z + 11.05);   // 门
  K.cyl(0.025, 0.035, 3.2, 6, 0x2a2c26, BC.x + 8.1, 2.73, BC.z + 12.8);   // 鞭状天线
  K.cyl(0.025, 0.035, 2.6, 6, 0x2a2c26, BC.x + 5.9, 2.43, BC.z + 12.3);
  K.cyl(0.38, 0.10, 0.10, 14, 0xb8bcb4, BC.x + 7.0, 1.42, BC.z + 12.8, -0.7, 0, 0);   // 卫星锅
  // 油料区：两只卧式储油罐（Φ2.5m×6m）+ 鞍座
  for (const oz of [11.3, 13.2]) {
    K.cyl(0.55, 0.55, 2.7, 16, 0x6a7058, BC.x + 19.5, 0.85, BC.z + oz, 0, 0, Math.PI / 2);
    for (const ox of [-0.9, 0.9]) K.box(0.18, 0.40, 0.95, 0x3d3f36, BC.x + 19.5 + ox, 0.20, BC.z + oz);
    K.box(0.2, 0.18, 0.2, 0x3d3f36, BC.x + 19.5, 1.46, BC.z + oz);
  }
  // 东侧车棚（开放式：6 柱 + 顶棚），给疏散车道留 ≥4u
  for (const oz of [-9, -6, -3]) for (const ox of [21.8, 24.0]) K.box(0.1, 1.55, 0.1, 0x44463c, BC.x + ox, 0.78, BC.z + oz);
  K.box(2.7, 0.07, 6.6, 0x575b4c, BC.x + 22.9, 1.58, BC.z - 6, 0, 0, 0.06);
  // 西侧通信塔（三角桁架，高 ≈6u≈14m）+ 设备方舱
  {
    const tx = BC.x - 22.3, tz = BC.z - 9.5, H = 6.0;
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const r0 = 0.62, r1 = 0.14;
      const x0 = Math.sin(a) * r0, z0 = Math.cos(a) * r0, x1 = Math.sin(a) * r1, z1 = Math.cos(a) * r1;
      const tilt = Math.atan2(r0 - r1, H);
      K.box(0.05, H, 0.05, 0x8d8f86, tx + (x0 + x1) / 2, H / 2, tz + (z0 + z1) / 2, Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
    }
    for (let k = 1; k < 6; k++) {
      const r = 0.62 - (0.62 - 0.14) * k / 6;
      K.cyl(r, r, 0.03, 3, 0x8d8f86, tx, H * k / 6, tz);
    }
    K.box(0.30, 0.45, 0.06, 0xd0d0c8, tx, H - 0.5, tz + 0.2);   // 定向天线板
    K.box(0.22, 0.09, 0.22, 0xb02a22, tx, H + 0.02, tz);        // 航空警示顶
    K.box(1.6, 0.95, 1.0, 0x5d6346, tx + 1.6, 0.475, tz + 0.4);
  }
  // P5-G2 步兵沙袋工事：三个步兵小队（27-infantry _layout，BC 相对坐标须同步）前方
  // 弧形沙袋胸墙，两层交错，开口朝向小队背后
  {
    const nests = [[-3, -12.5, PI], [15, 11.5, PI * 0.75], [-19, -6, PI * 1.15]];
    for (const [nx, nz, face] of nests) {
      const fx = Math.sin(face), fz = Math.cos(face);
      const cx = BC.x + nx + fx * 0.9, cz = BC.z + nz + fz * 0.9;
      for (let row = 0; row < 2; row++) {
        const n = 11;
        for (let i = 0; i < n; i++) {
          const a = face + (-1.15 + (i + (row % 2) * 0.5) / (n - 1) * 2.3);
          if (row % 2 && i === n - 1) continue;
          const r = 1.9;
          const bx = cx + Math.sin(a) * r - fx * 1.2, bz = cz + Math.cos(a) * r - fz * 1.2;
          K.box(0.30, 0.15, 0.20, (i + row) % 3 ? 0x8f7c58 : 0x847252, bx, 0.08 + row * 0.15, bz, 0, a, 0);
        }
      }
    }
  }
  // P5-G2 进场土路 + 电线杆：南门 → 南 9u → 西折远去（沙漠时走在沙丘环外的平地扇区）
  const roadPts = [[0, -16], [0, -24], [-4, -27], [-12, -28.5], [-75, -29]].map(([x, z]) => [BC.x + x, BC.z + z]);
  {
    // 电线杆：沿路北侧 1.8u，间距约 9u；横担 + 3 根导线（每档 4 段下垂）
    const poles = [];
    let acc = 4;
    for (let i = 1; i < roadPts.length; i++) {
      const [ax, az] = roadPts[i - 1], [bx, bz] = roadPts[i];
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      for (; acc < L; acc += 9) poles.push([ax + ux * acc - uz * 1.8, az + uz * acc + ux * 1.8, Math.atan2(ux, uz)]);
      acc -= L;
    }
    const PH = 3.0;
    for (const [px, pz, a] of poles) {
      K.cyl(0.05, 0.065, PH, 6, 0x4f3f2e, px, PH / 2, pz);
      K.box(1.0, 0.06, 0.07, 0x4a3b2b, px, PH - 0.25, pz, 0, a + PI / 2, 0);
    }
    const wire = (x0, y0, z0, x1, y1, z1) => {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
      const g = new THREE.BoxGeometry(0.018, 0.018, L);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / L, dy / L, dz / L)));
      K.add(g, 0x22211f, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    };
    for (let i = 1; i < poles.length; i++) {
      const [ax, az, aa] = poles[i - 1], [bx, bz, ba] = poles[i];
      for (const off of [-0.42, 0, 0.42]) {
        const x0 = ax + Math.cos(aa) * off, z0 = az - Math.sin(aa) * off;
        const x1 = bx + Math.cos(ba) * off, z1 = bz - Math.sin(ba) * off;
        const yA = PH - 0.22, seg = 4;
        let px0 = x0, py0 = yA, pz0 = z0;
        for (let k = 1; k <= seg; k++) {
          const t = k / seg, sag = 4 * t * (1 - t) * 0.35;
          const qx = x0 + (x1 - x0) * t, qz = z0 + (z1 - z0) * t, qy = yA - sag;
          wire(px0, py0, pz0, qx, qy, qz);
          px0 = qx; py0 = qy; pz0 = qz;
        }
      }
    }
  }
  const compound = new THREE.Mesh(K.build(), vcMat(0.92, 0.05));
  compound.name = 'base-compound';
  compound.castShadow = true; compound.receiveShadow = true;
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
  // —— 合批：沙色件 1 mesh + 围墙营区 1 mesh + 车辙半透 1 mesh ——
  const g = new THREE.Group();
  const sandMesh = new THREE.Mesh(mergeGeos(sandGeos),
    targetMat(0x9c8964, 0.95, 0.02));   // 2026-10-15 压暗：旧 0xb9a284 在沙漠日光下发白像石膏
  sandMesh.castShadow = false; sandMesh.receiveShadow = true;
  g.add(sandMesh);
  g.add(compound);
  const trackMesh = new THREE.Mesh(mergeGeos(trackGeos),
    new THREE.MeshBasicMaterial({ color: 0x241d14, transparent: true, opacity: 0.30, depthWrite: false }));
  trackMesh.renderOrder = 2;
  g.add(trackMesh);
  // P5-G2 土路带：沿 roadPts 生成 2.4u 宽条带，贴图为夯土 + 两道车辙 + 边缘渐隐
  {
    const W2 = 1.2, P = [], U = [], idx = [];
    let v = 0;
    const pts = [];
    for (let i = 1; i < roadPts.length; i++) {
      const [ax, az] = roadPts[i - 1], [bx, bz] = roadPts[i];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 1.5));
      for (let k = (i === 1 ? 0 : 1); k <= n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      P.push(pts[i][0] + nx * W2, 0.016, pts[i][1] + nz * W2, pts[i][0] - nx * W2, 0.016, pts[i][1] - nz * W2);
      U.push(0, v / 6, 1, v / 6);
      if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(120,98,70,0)'); gr.addColorStop(0.18, 'rgba(120,98,70,0.85)');
    gr.addColorStop(0.82, 'rgba(120,98,70,0.85)'); gr.addColorStop(1, 'rgba(120,98,70,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 256);
    let sd = 11;
    const r1 = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 260; i++) {                                // 碎石/土块斑点（固定种子）
      x.fillStyle = r1() < 0.5 ? 'rgba(80,64,44,0.35)' : 'rgba(160,140,110,0.3)';
      x.fillRect(8 + r1() * 48, r1() * 256, 1 + r1() * 2, 1 + r1() * 2);
    }
    x.fillStyle = 'rgba(60,46,30,0.45)';                           // 两道车辙
    x.fillRect(17, 0, 6, 256); x.fillRect(41, 0, 6, 256);
    const tx = new THREE.CanvasTexture(c);
    tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace;
    const road = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: tx, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    road.renderOrder = 1; road.receiveShadow = true;
    road.name = 'base-road';
    g.add(road);
  }
  g.visible = range.enabled;
  placeRangeProps(g, BC);   // 2026-10-18 ASSETS2：真模型布景道具（16-targetprops，异步挂入）
  range.scenery = g;
  range.scene.add(g);
}
