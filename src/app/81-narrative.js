// ============================================================
// 81-narrative.js — 环境叙事（Phase 13-M5）
// ============================================================
// 基地（baseCenter=05-config BASE_C）周围的环境动态：让玩家在自由飞行/任务中看到
// "有军事活动"的基地而非静态布景——
//   1) 旋转雷达天线：方舱车+桁架桅杆+抛物柱面天线，慢速旋转（~3.3°/s，约 108s/圈）
//   2) 防空导弹车：8×8 轮式发射车，4 联装发射筒起竖姿态（静止）
//   3) 探照灯：夜间扫掠光锥（ConeGeometry 半透明 + 灯头亮点，低频摆动）
//   4) 弹药堆：三垛托盘弹药箱（中垛盖篷布）
//   5) 巡逻编队：2 架察打无人机沿基地上空环形轨道（r=18u，h=12u）低速
//      巡航（~0.16 rad/s，2 机相位差 π——"有人看着这片天"）
//   6) 远交火烟柱：基地外 60-80u 处 2 处间歇烟柱（Sprite 缓慢升腾+呼吸）
// 所有对象随靶场显隐（syncEnabled）——湖面隐藏靶场时基地叙事一并隐藏。
// 性能：程序化一次性几何（2026-10-15 起各设施顶点色合批，约 16 mesh 规模），每帧仅转雷达/编队/灯摆/烟柱
// opacity（零创建销毁）；draws 增量 ≤ 8、fps ≥ 55（A2 新规）。
// ============================================================

class NarrativeFX {
  constructor(scene, W) {
    this.scene = scene;
    this.W = W;
    this.enabled = true;
    this.group = new THREE.Group();
    scene.add(this.group);

    const BC = { x: BASE_C.x, z: BASE_C.z };        // 基地中心（05-config BASE_C，与 16-targets build 同源）
    // —— 材质（共享实例，避免每件新建）——
    const dgrey = new THREE.MeshStandardMaterial({ color: 0x33382f, roughness: 0.85 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });

    // 1) 旋转雷达（2026-10-15 真实化，参照"平面"系列车载警戒雷达）：
    //    方舱车（6m×2.5m≈2.6u×1.1u，四轮+支腿）+ 舱顶桁架桅杆 + 顶部旋转天线
    //    （抛物柱面反射板 ≈7m 宽=3.2u + 馈源臂）。全高 ≈4.2u≈9.5m。
    //    名称保持：mast=静态整车（顶点色合批 1 mesh），dish=旋转天线（1 mesh）。
    const radar = new THREE.Group();
    radar.name = 'narrative-radar';
    const radarMat = vcMat(0.78, 0.18);
    const OL = 0x56604a, OD = 0x3d4436, DK = 0x1d201b, MT = 0x6b7262;
    const rk = vcKit();
    rk.box(0.92, 0.12, 2.3, DK, 0, 0.36, 0);                    // 底盘大梁
    rk.box(1.10, 1.02, 2.50, OL, 0, 0.94, 0);                   // 方舱
    rk.box(1.14, 0.05, 2.54, OD, 0, 1.47, 0);                   // 舱顶檐
    rk.box(0.02, 0.62, 0.48, OD, 0.56, 0.86, 0.55);             // 侧门
    rk.box(0.02, 0.16, 0.36, 0x2a3a3c, 0.56, 1.18, -0.55);      // 观察窗
    rk.box(0.30, 0.18, 0.40, OD, 0.30, 1.58, -0.85);            // 舱顶空调/设备箱
    rk.box(0.07, 0.07, 0.95, DK, 0, 0.34, 1.62);                // 牵引杆
    for (const sx of [-0.52, 0.52]) for (const sz of [-0.82, 0.82]) {
      rk.cyl(0.24, 0.24, 0.17, 12, DK, sx, 0.24, sz, 0, 0, Math.PI / 2);   // 车轮
      rk.cyl(0.10, 0.10, 0.18, 8, OD, sx * 1.01, 0.24, sz, 0, 0, Math.PI / 2);
    }
    for (const sx of [-0.62, 0.62]) for (const sz of [-1.18, 1.18]) {
      rk.box(0.06, 0.40, 0.06, DK, sx, 0.20, sz);               // 调平支腿
      rk.box(0.18, 0.03, 0.18, DK, sx, 0.015, sz);              // 支腿垫板
    }
    // 舱顶桁架桅杆（4 根立柱收分 + 斜撑）+ 转台
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      rk.box(0.05, 1.90, 0.05, MT, sx * 0.17, 2.43, sz * 0.17, sz * 0.05, 0, -sx * 0.05);
    }
    for (let k = 0; k < 3; k++) {
      const y = 1.75 + k * 0.6, w = 0.40 - k * 0.04;
      rk.box(w, 0.035, 0.035, MT, 0, y, 0.17 - k * 0.02);
      rk.box(w, 0.035, 0.035, MT, 0, y, -0.17 + k * 0.02);
      rk.box(0.035, 0.035, w, MT, 0.17 - k * 0.02, y, 0);
      rk.box(0.035, 0.035, w, MT, -0.17 + k * 0.02, y, 0);
    }
    rk.cyl(0.20, 0.24, 0.16, 12, OD, 0, 3.42, 0);               // 转台
    const mast = new THREE.Mesh(rk.build(), radarMat);
    mast.name = 'narrative-radar-mast';
    // 旋转天线：7 片拼成的抛物柱面反射板（凹面朝 +Z）+ 背桁 + 馈源臂/馈源
    const dk = vcKit();
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.13;
      dk.box(0.47, 0.70, 0.035, MT, Math.sin(a) * 1.8, 0.42, -Math.cos(a) * 1.8 + 1.8, 0, -a, 0);
    }
    dk.box(2.6, 0.06, 0.06, MT, 0, 0.42, -0.08);                // 背桁横梁
    dk.box(0.07, 0.62, 0.07, DK, 0, 0.42, -0.10);
    dk.box(0.16, 0.30, 0.16, OD, 0, 0.12, 0);                   // 转轴座
    dk.box(0.04, 0.04, 1.05, DK, 0.42, 0.42, 0.50, 0, -0.38, 0);    // 馈源撑臂 ×2
    dk.box(0.04, 0.04, 1.05, DK, -0.42, 0.42, 0.50, 0, 0.38, 0);
    dk.box(0.30, 0.12, 0.12, OD, 0, 0.42, 0.98);                // 馈源
    const dish = new THREE.Mesh(dk.build(), radarMat);
    dish.name = 'narrative-radar-dish';
    dish.position.y = 3.50;
    // Phase 25：雷达扫描波束——薄扇形挂 radarDish 子节点，随盘同转（复用既有
    // radarDish 旋转，不新开动画时钟）；雷达摧毁 = 组隐藏 + 停转 → 波束自动
    // "哑火"，天然表达 SEAD 致盲（视觉闭环）。加性半透/depthWrite:false，
    // 微下探让远端扫到地面；强度由 update 按 env 调（夜间亮/白天压淡）
    const beam = new THREE.Mesh(
      new THREE.CircleGeometry(7, 24, 0, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.name = 'narrative-beam';
    beam.rotation.x = -Math.PI / 2 - 0.3;           // 平铺 + 远端下探（扫地面）
    beam.position.y = 0.42;
    beam.renderOrder = 3;
    dish.add(beam);
    this._beam = beam;
    radar.add(mast, dish);
    radar.position.set(BC.x - 16, 0, BC.z + 4);
    this.group.add(radar);
    this.radarDish = dish;                          // 只转盘不转柱
    this._radarGroup = radar;                       // Phase 21：打击层引用（摧毁隐藏 + 停转）

    // 2) 防空导弹车（2026-10-15 真实化，参照 8×8 轮式远程防空发射车）：
    //    车长 10.5m≈4.6u、宽 3m≈1.3u；车头驾驶室在 +Z，4 联装发射筒（≈7m=3.0u，
    //    直径 ≈0.75m）铰接在车尾，起竖后筒口朝车头前倾 ~20°。
    //    名称保持：sam-body=整车（顶点色合批 1 mesh），sam-tube-0..3=四根发射筒。
    const sam = new THREE.Group();
    sam.name = 'narrative-sam';
    const samMat = vcMat(0.76, 0.2);
    const SO = 0x5a6248, SD = 0x3b4233, SK = 0x1c1f1a, GL = 0x22343a;
    const sk = vcKit();
    sk.box(1.05, 0.24, 4.40, SK, 0, 0.62, 0);                   // 大梁
    for (const z of [1.55, 0.92, -0.62, -1.25]) for (const sx of [-0.56, 0.56]) {
      sk.cyl(0.29, 0.29, 0.22, 14, SK, sx, 0.29, z, 0, 0, Math.PI / 2);   // 8 个大轮
      sk.cyl(0.12, 0.12, 0.23, 8, SD, sx * 1.01, 0.29, z, 0, 0, Math.PI / 2);
    }
    for (const z of [1.24, -0.94]) sk.box(1.32, 0.05, 1.05, SD, 0, 0.62, z);   // 挡泥板
    sk.box(1.30, 0.70, 0.95, SO, 0, 1.08, 1.72);                // 驾驶室
    sk.box(1.20, 0.26, 0.04, GL, 0, 1.24, 2.20, -0.18, 0, 0);   // 风挡
    for (const sx of [-0.66, 0.66]) sk.box(0.03, 0.22, 0.45, GL, sx, 1.22, 1.78);   // 侧窗
    sk.box(1.24, 0.06, 0.85, SD, 0, 1.45, 1.70);                // 驾驶室顶
    sk.box(1.20, 0.55, 0.85, SO, 0, 1.00, 0.80);                // 动力/电源舱
    sk.box(0.10, 0.10, 0.80, SK, 0.52, 1.30, 0.80);             // 排气管
    sk.box(1.28, 0.12, 2.65, SD, 0, 0.82, -0.85);               // 后部发射平台
    for (const sx of [-0.70, 0.70]) for (const z of [1.10, -2.05]) {
      sk.box(0.08, 0.68, 0.08, SK, sx, 0.40, z);                // 调平千斤顶
      sk.box(0.22, 0.03, 0.22, SK, sx, 0.015, z);
    }
    sk.box(1.10, 0.18, 0.22, SD, 0, 1.0, -2.05);                // 尾部铰接座
    sk.box(0.10, 1.45, 0.10, SD, 0.0, 1.55, -1.10, 0.42, 0, 0); // 起竖液压撑杆
    const body = new THREE.Mesh(sk.build(), samMat);
    body.name = 'narrative-sam-body';
    sam.add(body);
    // 发射筒：轴心在筒底（铰点，车尾），装在绕 Y 翻转 180° 的起竖架里——
    // rotation.x 基线 -0.35（Phase 28 损伤公式以此为基线）在这里表现为
    // "筒口朝车头方向前倾 ~20°"（半起竖姿态；探针实测筒顶在铰点与驾驶室之间）
    const erector = new THREE.Group();
    erector.position.set(0, 1.02, -2.0);
    erector.rotation.y = Math.PI;
    sam.add(erector);
    const tubeGeo = (() => {
      const tk = vcKit();
      tk.cyl(0.165, 0.165, 3.0, 14, 0x5f6650, 0, 1.5, 0);
      for (const y of [0.25, 1.5, 2.75]) tk.cyl(0.18, 0.18, 0.10, 14, 0x454c3c, 0, y, 0);   // 加强箍
      tk.cyl(0.17, 0.17, 0.04, 14, 0x2b2f28, 0, 3.0, 0);        // 筒口盖
      return tk.build();
    })();
    this._samTubes = [];                           // Phase 28：发射架引用（重创下垂微倾）
    for (let i = 0; i < 4; i++) {
      const tube = new THREE.Mesh(tubeGeo, samMat);
      tube.name = 'narrative-sam-tube-' + i;
      tube.position.set((i - 1.5) * 0.36, 0, 0);
      tube.rotation.x = -0.35;                      // 起竖微倾（Phase 28 基线）
      erector.add(tube);
      this._samTubes.push(tube);
    }
    sam.position.set(BC.x + 12, 0, BC.z - 6);
    sam.rotation.y = 0.9;
    this.group.add(sam);
    this._samGroup = sam;                           // Phase 21：打击层引用
    // 2026-10-18 ASSETS3：防空车换 SA-8"壁虎"真模型（Sketchfab "Osa-AKM SAM system"，CC BY 4.0，
    // 见 CREDITS.md）。程序化车体/发射筒只隐藏不删除（名称、损伤下垂、击毁压扁等逻辑与测试仍挂在它们上）；
    // 真模型挂在同一 sam 组里，压扁/隐藏随组。车头 = 模型 +Z（同程序化车体），车长 4.0u≈9.1m。
    new THREE.GLTFLoader().load('assets/targets/osa.glb', (gltf) => {
      const m = gltf.scene;
      const bb = new THREE.Box3().setFromObject(m, true), sz = bb.getSize(new THREE.Vector3());
      const k = 4.0 / Math.max(sz.z, 1e-4), c = bb.getCenter(new THREE.Vector3());
      m.scale.setScalar(k);
      m.position.set(-c.x * k, -bb.min.y * k, -c.z * k);
      m.name = 'narrative-sam-osa';
      // 原贴图是浅灰涂装，沙漠正午发白——整体压暗约三成更像落满尘土的旧车
      m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.color) o.material.color.multiplyScalar(0.7); } });
      body.visible = false;
      erector.visible = false;
      sam.add(m);
    }, undefined, () => {});

    // 3) 弹药堆（2026-10-15 真实化）：三垛托盘弹药箱（单箱 ≈1.0m×0.6m×0.7m），
    //    垛高 2/3/1 层，中垛盖篷布。名称保持 ammo-crate-0..2（每垛 1 mesh）。
    const ammo = new THREE.Group();
    ammo.name = 'narrative-ammo';
    const ammoMat = vcMat(0.88, 0.05);
    const layers = [2, 3, 1];
    for (let i = 0; i < 3; i++) {
      const ak = vcKit();
      ak.box(1.02, 0.07, 0.82, 0x6b5536, 0, 0.035, 0);         // 木托盘
      for (const sx of [-0.4, 0, 0.4]) ak.box(0.07, 0.06, 0.82, 0x4f3e27, sx, 0.035, 0);
      for (let l = 0; l < layers[i]; l++) for (const cx of [-0.25, 0.25]) for (const cz of [-0.2, 0.2]) {
        const y = 0.07 + 0.15 + l * 0.30;
        const col = ((l + (cx > 0) + (cz > 0)) % 2) ? 0x55603f : 0x4d5739;
        ak.box(0.46, 0.28, 0.36, col, cx, y, cz);              // 弹药箱
        ak.box(0.47, 0.04, 0.37, 0x3a412c, cx, y + 0.06, cz);  // 箱体加强带
        ak.box(0.10, 0.03, 0.02, 0xc9b25a, cx, y + 0.02, cz + 0.185);   // 黄色标识条
      }
      if (i === 1) {
        const top = 0.07 + layers[i] * 0.30;
        ak.box(1.06, 0.04, 0.86, 0x4a4e36, 0, top + 0.02, 0);  // 篷布
        for (const sx of [-0.54, 0.54]) ak.box(0.02, top - 0.1, 0.86, 0x4a4e36, sx, top / 2 + 0.05, 0);
      }
      const c = new THREE.Mesh(ak.build(), ammoMat);
      c.name = 'narrative-ammo-crate-' + i;
      c.position.set(i * 1.15 - 1.15, 0, (i % 2) * 0.35);
      c.rotation.y = i * 0.12;
      ammo.add(c);
    }
    ammo.position.set(BC.x - 11, 0, BC.z - 2);
    this.group.add(ammo);
    this._ammoGroup = ammo;                         // Phase 21：打击层引用

    // 4) 探照灯：灯头亮点 + 半透明光锥（夜间扫掠，低频摆动）
    const lamp = new THREE.Group();
    // P14-C+R5：稳定语义标记（测试/归档按 name 定位——不再用 children 数猜测）
    lamp.name = 'narrative-lamp';
    // P14-C：灯头 bbox 曾悬浮 1.22m 无支撑（SphereGeometry minY=1.218 悬空）——
    // 补一根灯柱（地面到灯头，dgrey 与灯架同色系），消除"悬浮异物"观感
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 1.4, 6), dgrey);
    pole.name = 'narrative-lamp-pole';
    pole.position.y = 0.7;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), lampMat);
    head.name = 'narrative-lamp-head';
    head.position.y = 1.4;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 3.4, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false }));
    cone.position.y = 1.6 + 1.7;
    cone.rotation.x = Math.PI;                      // 光锥向上扩散
    // P14-F：灯柱静态、灯头+光锥入扫掠子组——旧实现整组绕地面原点摆 z 轴，
    // 夜间 ±0.5rad 时柱底画弧离地 ~0.17u（"灯柱拔地"）；真实探照灯是柱固定、
    // 灯头摆动
    const headGroup = new THREE.Group();
    headGroup.name = 'narrative-lamp-head-group';
    headGroup.add(head, cone);
    headGroup.position.y = 1.4;                     // 摆动枢轴=灯头位置
    head.position.y = 0;                            // 相对枢轴
    cone.position.y = 1.9;                          // 相对枢轴（世界 3.3 = 1.4+1.9）
    lamp.add(pole, headGroup);
    lamp.position.set(BC.x + 14, 0, BC.z + 8);
    this.group.add(lamp);
    this.lampHeadGroup = headGroup;                 // 摆动只转头+光锥（P14-F：柱固定）
    this._lampCone = cone;                          // P4c：光锥强度按时段/场地（update）
    this.lamp = lamp;                               // update 中按环境摆动灯组
    this._lampSwing = 0;

    // 5) 巡逻编队（2026-10-15 真实化）：2 架中空长航时察打无人机——
    //    机长 6.5m≈2.9u、翼展 12m≈5.3u，倒 V 尾双尾撑、推进式螺旋桨、机头下光电球。
    //    名称保持 patrol-i-fus（整机顶点色合批 1 mesh）。机头局部 +Z。
    const patrolMat = vcMat(0.6, 0.25);
    const pk = vcKit();
    const PG = 0x8b9190, PD = 0x5d6363, PB = 0x2a2e2f;
    pk.cyl(0.19, 0.15, 2.1, 12, PG, 0, 0, 0.05, Math.PI / 2, 0, 0);  // 机身
    pk.cyl(0.0, 0.19, 0.55, 12, PG, 0, 0, 1.38, Math.PI / 2, 0, 0);  // 机头整流
    pk.sph(0.11, PB, 0, -0.17, 1.05);                           // 光电球
    pk.box(0.16, 0.10, 0.70, PD, 0, 0.18, 0.15);                // 背部卫通鼓包
    pk.box(2.65, 0.05, 0.42, PG, 1.33, 0.06, 0.05, 0, 0, 0.04); // 右翼（微上反）
    pk.box(2.65, 0.05, 0.42, PG, -1.33, 0.06, 0.05, 0, 0, -0.04);
    for (const sx of [-0.62, 0.62]) {
      pk.cyl(0.045, 0.04, 1.75, 6, PD, sx, 0.05, -0.85, Math.PI / 2, 0, 0);   // 尾撑
      pk.box(0.04, 0.50, 0.30, PG, sx * 0.80, -0.14, -1.68, 0, 0, sx > 0 ? 0.65 : -0.65);  // 倒 V 尾
      pk.box(0.10, 0.04, 0.08, PB, sx * 1.6, 0.06, 0.05);       // 翼下挂点
    }
    pk.box(0.85, 0.05, 0.03, PB, 0, 0, -0.98);                  // 推进桨（静态）
    pk.box(0.05, 0.85, 0.03, PB, 0, 0, -0.98);
    const patrolGeo = pk.build();
    this.patrol = [];
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Group();
      p.name = 'narrative-patrol-' + i;
      const fus = new THREE.Mesh(patrolGeo, patrolMat);
      fus.name = 'narrative-patrol-' + i + '-fus';
      p.add(fus);
      this.group.add(p);
      this.patrol.push({ g: p, phase: i * Math.PI, altv: (i % 2) * 0.5 });
    }

    // 6) 远交火烟柱：基地外 2 处，间歇升腾（Sprite + 径向渐变贴图）
    // P14-F：烟团中心基线从 6 降至 4.7——旧值下 Sprite 底部（中心-3.5）悬空
    // 1.3~3.7u，远处看是"悬浮烟团"而非从地面升起的烟柱；现底缘贴地（>=0）
    // 呼吸时从地面升起
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(32, 32, 3, 32, 32, 30);
    gr.addColorStop(0, 'rgba(60,58,54,0.85)');
    gr.addColorStop(1, 'rgba(60,58,54,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(cv);
    this.smokes = [];
    const spots = [[34, 82], [-30, 88]];
    let smokeIdx = 0;
    for (const [sx, sz] of spots) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.name = 'narrative-smoke-' + smokeIdx;
      s.scale.set(5, 7, 1);
      s.position.set(BC.x + sx, 4.7, BC.z + sz);
      this.group.add(s);
      this.smokes.push({ s, ph: rnd() * TAU, cyc: 2.4 + rnd() * 1.6 });
      smokeIdx++;
    }

    // Phase 21：打击层——雷达/防空车/弹药库变为可摧毁加分目标（探照灯民用、
    // 巡逻机已归 87-enemyair，均不列）。每项挂 {hp,hp0,alive,label,pos,radius}，
    // 仿 16-targets 统一战斗模式；坐标取各组世界位（组 position 即世界系，group
    // 未整体位移）。雷达是防空搜索/发射机——摧毁 = SEAD 致盲（radarAlive() 供
    // 70-app 断防空 env）。
    this.strikes = [
      { key: 'radar', group: this._radarGroup, hp: 2, hp0: 2, alive: true,
        label: '敌雷达站',   pos: { x: BC.x - 16, z: BC.z + 4 }, radius: 1.9 },
      { key: 'sam',   group: this._samGroup,   hp: 3, hp0: 3, alive: true,
        label: '防空发射车', pos: { x: BC.x + 12, z: BC.z - 6 }, radius: 2.4 },
      { key: 'ammo',  group: this._ammoGroup,  hp: 1, hp0: 1, alive: true,
        label: '弹药库',     pos: { x: BC.x - 11, z: BC.z - 2 }, radius: 1.4 },
    ];
    // opt1（2026-10-20）：killEvent 改为事件队列——同一帧连毁两个设施时第二个不再被覆盖丢分。
    // 对外语义不变：读 killEvent = 队首（无则 null）；消费方写 null = 出队一个；写对象 = 入队。
    this._kq = [];
    Object.defineProperty(this, 'killEvent', {
      get() { return this._kq.length ? this._kq[0] : null; },
      set(v) { if (v == null) this._kq.shift(); else this._kq.push(v); },
      configurable: true,
    });   // 事件：{key,type,label,x,z}
    this._radarStopped = false; // 雷达毁后停转标记
    this._waves = [];           // Phase 21.2：摧毁冲击波环（瞬时件，update 推进到期自毁）

    // Phase 25：设施信标灯——雷达桅杆顶 + 防空车车身各一枚软点信标（additive
    // Sprite，禁真 PointLight——真光源重编 shader 破 A2 预算），存活时低频呼吸
    // （相位错开）；挂对应设施组内——摧毁 visible=false 自动隐藏、复位自动回来，
    // 零动态生命周期/零清理负担。弹药堆不加（信标语义是"防空资产活着"，弹药堆
    // 无电子特征）。贴图共享 21.2 辉光的径向渐变缓存（颜色由材质 color 定红）
    this._beacons = [];
    for (const s of this.strikes) {
      if (s.key === 'ammo') continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTexGet(), color: 0xff5040, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.name = 'narrative-beacon-' + s.key;
      sp.position.set(0, s.key === 'radar' ? 4.05 : 1.62, s.key === 'radar' ? 0 : 1.72);   // 2026-10-15：雷达桅顶 / 防空车驾驶室顶
      sp.scale.set(0.34, 0.34, 1);
      sp.renderOrder = 4;
      s.group.add(sp);
      s._bcon = sp;
      this._beacons.push({ s, sp, ph: rnd() * TAU });
    }

    // Phase 28：渐进损伤视觉挂点——雷达/防空车（弹药堆 hp1 一击毁无中间态，跳过）：
    // 软烟 Sprite 挂设施组内（未受损 visible=false 零 draw；摧毁随组隐藏；update
    // 按 hp 纯派生点亮——复位 hp 复原即自动熄，零清理代码）+ 重创微倾基线记录
    // （发射架下垂/雷达盘侧倾，纯 transform 零 draw；userData 存基线俯仰与各管
    // 下垂系数，update 每帧绝对赋值——复原精确归位）。贴图共享辉光径向渐变缓存，
    // 暗灰走普通混合（NormalBlending——加性会把暗烟变成看不见的"负片"）
    for (const s of this.strikes) {
      if (s.key === 'ammo') continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTexGet(), color: 0x55514b, transparent: true, opacity: 0,
        depthWrite: false }));
      sp.name = 'narrative-dmgsmoke-' + s.key;
      sp.position.set(0, s.key === 'radar' ? 1.6 : 1.1, s.key === 'radar' ? 0 : -0.6);
      sp.scale.set(1.2, 1.2, 1);
      sp.renderOrder = 4;
      sp.visible = false;
      s.group.add(sp);
      s._dmg = { smoke: sp, ph: rnd() * TAU, tubes: [], dish: null };
      if (s.key === 'sam') {
        for (const t of this._samTubes) {
          t.userData._bx = t.rotation.x;             // 基线俯仰（-0.35）
          t.userData._dp = 0.5 + rnd() * 0.5;        // 各管下垂系数（非对称受创感）
          s._dmg.tubes.push(t);
        }
      } else {
        s._dmg.dish = this.radarDish;               // 雷达：盘侧倾（rotation.y 自转不碰）
      }
    }

    // 静态造型默认隐藏（syncEnabled 打开靶场时显示）
    this.group.visible = this.enabled;
  }

  // 与靶场显隐联动（湖面/禁用靶标时基地叙事一并隐藏）
  syncEnabled(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled;
    // Phase 21.2：禁靶场（切湖面）时瞬时视觉件（冲击波环/辉光/脉冲）一并移除+
    // dispose——禁跨场残留；残骸本体维持 21.1"隐藏不清"语义（复位才清）
    if (!this.enabled) this._purgeFx();
  }

  // ---------- Phase 21：打击层（仿 16-targets 统一战斗模式） ----------
  // 命中检测：武器世界坐标 → 距离最近存活设施；扣 hp、flashHit / _destroy。
  // 判定 y 压缩同 16-targets（近失破片语义）；难度抗打击读 HOST.arcade。
  // hitTest 内按 radius 限域，天然只在基地扇区生效（与 enemyAir 并列调用安全）。
  hitTest(worldPos, power) {
    if (!this.enabled) return null;
    let best = null, bestD = 1e9;
    for (const s of this.strikes) {
      if (!s.alive) continue;
      const d = Math.hypot(worldPos.x - s.pos.x, (worldPos.y - 1.0) * 0.6, worldPos.z - s.pos.z);
      if (d < s.radius + 0.9 && d < bestD) { best = s; bestD = d; }
    }
    if (!best) return null;
    const arcMod = HOST.arcade;
    const res = (arcMod && arcMod.targetResMul()) || 1;   // 难度抗打击（veteran 更耐打）
    best.hp -= (power || 0) / res;
    if (best.hp <= 0) this._destroy(best, power);
    else {
      this._flashHit(best);
      // Phase 21.2：命中脉冲——受击组瞬时下压再回弹（update 推进的 0.12s 计时器，
      // 不用 setTimeout 堆积）+ 命中点火花（复用 WeaponRig puff 池 additive 小亮点，
      // wfx 不可用则跳过——同 21.1 残骸烟守卫）。纯视觉，不碰扣血/事件链
      best._punch = 0.12;
      const wfx = window.__rigFx;
      if (wfx && wfx._puff) {
        wfx._puff(worldPos.x, worldPos.y, worldPos.z,
          { color: 0xffd27a, s0: 0.10, s1: 0.34, life: 0.2, base: 0.85, add: true });
      }
    }
    return best;
  }

  // 受击闪一下（未摧毁）——emissive 闪，仿 16-targets.flashHit
  _flashHit(s) {
    s.group.traverse(o => {
      if (o.isMesh && o.material && o.material.emissive) {
        const m = o.material;
        if (!m.userData._bk) m.userData._bk = m.emissive.getHex();
        m.emissive.setHex(0x442200);
        m.emissiveIntensity = 1;
        setTimeout(() => { m.emissive.setHex(m.userData._bk); m.needsUpdate = true; }, 110);
      }
    });
  }

  // 摧毁：隐藏该组 + 爆炸粒子 + 入 killEvent 队列（70-app 每帧消费一个）。
  // 弹药库殉爆（复用 barrel 语义：置延迟二次爆标记，update 触发）；雷达毁后停转。
  _destroy(s, power = 2) {
    s.alive = false;
    s.group.visible = false;
    if (window.__rigFx) window.__rigFx.explosion(s.pos.x, 0.8, s.pos.z, power);
    if (s.key === 'ammo') this._ammoBoom = { t: 0.5, x: s.pos.x, y: 0.8, z: s.pos.z };  // 弹药库殉爆
    if (s.key === 'radar') this._radarStopped = true;   // 雷达毁 → 停转 + SEAD 致盲
    // Phase 21.1：焦黑残骸 + 烧蚀地贴（纯视觉增量，不碰 killEvent/SEAD/计分）
    this._spawnWreck(s);
    // Phase 21.2：摧毁冲击波环（纯视觉"大事件感"，不碰 killEvent/SEAD/计分）
    this._spawnWave(s);
    this.killEvent = { key: s.key, type: s.key, label: s.label, x: s.pos.x, z: s.pos.z };
  }

  // Phase 21.1：摧毁残骸——焦黑箱体 + 烧蚀地贴 + 余烬计时，仿 16-targets.destroy
  // 先例（wreckMat 配色 / 箱体随机散布 / 地贴参数全同款）。差异：残骸挂 this.group
  // 而非 scene——随 syncEnabled 整组显隐（湖面切场自动隐藏，不像 16-targets 需要
  // P5-C 那套"禁用时停冒烟"特判，update 顶部 enabled 早退已覆盖）。体量匹配：
  // 防空车（车身+发射架最大）> 雷达（细桅杆中等）> 弹药堆（小箱体最小）。
  _spawnWreck(s) {
    const cfg = {
      radar: { r: 1.9, n: 3, s: [0.35, 0.85] },
      sam:   { r: 2.4, n: 4, s: [0.55, 1.15] },
      ammo:  { r: 1.6, n: 3, s: [0.28, 0.62] },
    }[s.key] || { r: 1.6, n: 3, s: [0.3, 0.8] };
    const wreck = new THREE.Group();
    wreck.name = 'narrative-wreck-' + s.key;
    const mat = new THREE.MeshStandardMaterial({ color: 0x181613, roughness: 0.95, metalness: 0.2 });
    for (let i = 0; i < cfg.n; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(rnd(cfg.s[0], cfg.s[1]), rnd(0.12, 0.35), rnd(cfg.s[0], cfg.s[1])), mat);
      b.position.set((rnd() - 0.5) * cfg.r * 1.2, 0.1 + rnd(0.12), (rnd() - 0.5) * cfg.r * 1.2);
      b.rotation.y = rnd(TAU);
      // PERF-AUDIT C3：残骸小件不投影——42u 外阴影不可辨（P10 细节件同款结论），
      // 每残骸省一整轮 shadow pass draw
      b.castShadow = false;
      wreck.add(b);
    }
    // 烧蚀地贴：深色半透圆盘平铺地面（y=0.012 防 z-fighting，参数同 16-targets）
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.r, 20),
      new THREE.MeshBasicMaterial({ color: 0x0c0b09, transparent: true, opacity: 0.55, depthWrite: false }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.012;
    scorch.renderOrder = 2;
    wreck.add(scorch);
    wreck.position.set(s.pos.x, 0, s.pos.z);
    this.group.add(wreck);
    s.wreck = wreck;
    s.burn = 7;      // 余烬燃烧 ~7s（16-targets 装甲车 5s / 卡车 9s 之间）
    s._smk = 0;      // 烟柱发射节流（同 16-targets）
  }

  // Phase 21.2：摧毁冲击波环——地面一圈向外扩散的亮环（RingGeometry 平铺，y=0.05
  // 略抬防与烧蚀地贴 z-fighting）。update 推进 ~0.5s：scale 小→大（ease-out）、
  // opacity 高→0，到期自动移除+dispose（几何/材质双清）。雷达是 SEAD 关键目标——
  // 环更大更亮（扩散半径 7u vs 4.5u / 初 opacity 0.95 vs 0.8 / 暖白色更亮）。
  // 挂点：残骸组内（_spawnWreck 先行、同帧创建）——随残骸显隐/清理，语义贴切；
  // 且不增 this.group 直接子数（21.1 存量断言按 group.children 差值数残骸组）。
  _spawnWave(s) {
    const big = s.key === 'radar';
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 1.0, 40),
      new THREE.MeshBasicMaterial({
        color: big ? 0xffe9b0 : 0xffc07a,
        transparent: true, opacity: big ? 0.95 : 0.8,
        side: THREE.DoubleSide, depthWrite: false }));
    m.name = 'narrative-wave-' + s.key;
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.05, 0);   // 残骸组原点=设施地面位，局部 y 略抬防 z-fighting
    m.renderOrder = 3;
    m.scale.set(0.7, 0.7, 1);      // 起始半径（首帧 update 前不闪全尺寸）
    s.wreck.add(m);
    this._waves.push({ m, t: 0, dur: 0.5, r0: 0.7, r1: big ? 7 : 4.5, o0: big ? 0.95 : 0.8 });
  }

  // Phase 21.2：辉光径向渐变贴图——共享缓存，整页只建一次（构造期 smokeTex 先例）
  _glowTexGet() {
    if (!this._glowTex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const cx = cv.getContext('2d');
      const gr = cx.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.38)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
      this._glowTex = new THREE.CanvasTexture(cv);
    }
    return this._glowTex;
  }

  // Phase 21.2：挂夜间辉光——additive Sprite"假辉光"（禁真 THREE.PointLight：真光源
  // 重编 shader + 逐片元成本，破 A2 draw 预算）。挂残骸组内随组显隐；depthWrite 关
  // 防遮挡排序问题；fog:false 防夜雾吞亮（夜航灯同款处理）
  _attachGlow(s) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTexGet(), color: 0xff8c3c,
      transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false }));
    sp.name = 'narrative-glow-' + s.key;
    sp.position.set(0, 0.55, 0);
    sp.scale.set(2.6, 2.6, 1);
    sp.renderOrder = 4;
    s.wreck.add(sp);
    s._glow = sp;
    s._gph = rnd() * TAU;           // 闪烁相位（可复现随机，同残骸散布先例）
  }

  // Phase 21.2：卸辉光并释放——只 dispose SpriteMaterial；贴图是本类共享缓存、几何
  // 是 Sprite 模块级共享件（实测两实例 geometry===），二者一律不动（会砸全场 Sprite）
  _killGlow(s) {
    if (!s._glow) return;
    if (s._glow.parent) s._glow.parent.remove(s._glow);
    s._glow.material.dispose();
    s._glow = null;
  }

  // Phase 21.2：瞬时视觉件统一清理（resetStrikes 与 syncEnabled(off) 共用）——
  // 冲击波环/夜间辉光/受击脉冲全部移除+dispose/归位，禁内存泄漏、禁跨局跨场残留。
  // 残骸本体不在此清（维持 21.1 语义：由 resetStrikes 单独清）
  _purgeFx() {
    for (const w of this._waves) {
      if (w.m.parent) w.m.parent.remove(w.m);   // 挂点=残骸组，parent 无关移除
      w.m.geometry.dispose();
      w.m.material.dispose();
    }
    this._waves.length = 0;
    for (const s of this.strikes) {
      this._killGlow(s);
      s._punch = 0;
      s.group.scale.set(1, 1, 1);
    }
  }

  // Phase 25：波束实际可见性——沿祖先链求积（雷达组随摧毁隐藏/叙事层随切场隐藏
  // 时，波束自身 visible 仍为 true 但实际不渲染；遥测必须报告有效可见性）
  _beamOn() {
    let v = !!this._beam, p = this._beam;
    while (p) { v = v && p.visible; p = p.parent; }
    return v;
  }

  // SEAD 门：雷达存活性（70-app 查此断防空 env——雷达毁则 samwar siteN=0 转 idle）
  radarAlive() {
    const r = this.strikes.find(s => s.key === 'radar');
    return !!(r && r.alive);
  }

  // 打击层复位（startMission / resetRange 调，避免跨局残留）
  resetStrikes() {
    this._ammoBoom = null;
    this._radarStopped = false;
    this._kq.length = 0;          // 清空摧毁事件队列
    // Phase 21.2：先清瞬时视觉件（辉光先从残骸组摘除并释放材质，再走残骸清理——
    // 残骸遍历只认 isMesh，Sprite 不在内，漏这步会漏释放 SpriteMaterial）
    this._purgeFx();
    for (const s of this.strikes) {
      // Phase 21.1：残骸清理铁律——从组移除 + dispose 几何/材质（禁内存泄漏），
      // 跨局不得残留残骸（16-targets.reset 同款语义；材质经 Set 去重后统一释放）
      if (s.wreck) {
        this.group.remove(s.wreck);
        const mats = new Set();
        s.wreck.traverse(o => {
          if (o.isMesh) { o.geometry.dispose(); mats.add(o.material); }
        });
        mats.forEach(m => m.dispose());
        s.wreck = null;
        s.burn = 0;
        s._smk = 0;
      }
      s.hp = s.hp0;
      s.alive = true;
      s.group.visible = true;
    }
  }

  // 每帧驱动：雷达旋转 / 探照灯扫掠 / 编队巡航 / 烟柱间歇
  update(dt, time, env) {
    if (!this.enabled) return;
    // Phase 21：弹药库延迟殉爆（复用 barrel 二次爆语义）
    if (this._ammoBoom) {
      this._ammoBoom.t -= dt;
      if (this._ammoBoom.t <= 0) {
        if (window.__rigFx) window.__rigFx.explosion(this._ammoBoom.x, this._ammoBoom.y, this._ammoBoom.z, 3);
        this._ammoBoom = null;
      }
    }
    // 雷达盘：慢速旋转（~3.3°/s）；Phase 21：摧毁后停转
    if (this.radarDish && !this._radarStopped) this.radarDish.rotation.y += 0.058 * dt;
    // 探照灯：夜间扫掠幅度大（夜间 ±0.5 rad / 白天 ±0.08 微摆）——P14-F 起
    // 摆动只转头+光锥子组（枢轴=灯头），灯柱固定贴地（旧整组摆会让柱底画弧离地）
    const swingAmp = env === 'night' ? 0.50 : 0.08;
    if (this.lampHeadGroup) {
      this._lampSwing += dt * 0.22;
      this.lampHeadGroup.rotation.z = Math.sin(this._lampSwing) * swingAmp;
    }
    // Phase 25：波束强度按环境——夜间更亮更明显、白天压淡（黄昏取中值）；
    // 信标低频呼吸（~2.6s 周期、相位错开）。二者均为常驻件随组显隐，无清理负担
    if (this._beam) {
      this._beam.material.opacity = env === 'night' ? 0.34 : (env === 'dusk' ? 0.22 : 0.1);
    }
    // P4c：探照灯光锥过曝修复——原恒定 0.16 白锥在白天/沙漠亮沙上读作一块白色
    // 实心三角。夜间保持原值；黄昏/清晨减半；白天几乎不可见（真实探照灯白天看不到
    // 光柱）；沙漠再 ×0.55（亮沙背景叠加更易过曝）
    if (this._lampCone) {
      const base = env === 'night' ? 0.16 : (env === 'dusk' || env === 'dawn') ? 0.08 : 0.025;
      const desert = this.W && this.W.terrainKey === 'desert';
      this._lampCone.material.opacity = base * (desert ? 0.55 : 1);
    }
    for (const b of this._beacons) {
      b.sp.material.opacity = 0.55 + 0.45 * Math.sin(time * 2.4 + b.ph);
    }
    // 巡逻编队：绕基地环形轨道（r=18, h=12），2 机相位差 π
    const bc = BASE_C;
    for (let i = 0; i < this.patrol.length; i++) {
      const p = this.patrol[i];
      const a = time * 0.16 + p.phase;
      p.g.position.set(bc.x + Math.cos(a) * 18, 12 + p.altv, bc.z + Math.sin(a) * 18);
      // P14-F：机头沿切线方向——位置 (cos a, sin a)·18 的速度向量为
      // (-sin a, cos a)，机头局部 +Z 在 yaw=θ 时指向 (sin θ, cos θ)，
      // 令 θ=-a 恰使机头=切向（旧值 -a+π/2 使机头径向朝外，像"侧着飞"）
      p.g.rotation.y = -a;
    }
    // 远交火烟柱：间歇呼吸（0.35 + 0.25 sin），缓慢升腾高度
    // P14-F：基线 4.7（Sprite 半高 3.5 → 底缘 0~2.4 贴地升起，不再悬空）
    for (const sm of this.smokes) {
      const o = 0.32 + 0.22 * Math.sin(time * (1 / sm.cyc) * TAU + sm.ph);
      sm.s.material.opacity = Math.max(0, o);
      sm.s.position.y = 4.7 + Math.sin(time * 0.5 + sm.ph) * 1.2;
    }
    // Phase 21.1：残骸余烬——黑烟柱 + 火舌窜出。复用 WeaponRig 的 puff 池发射
    // （单池 InstancedMesh，发射不新增常驻 draw call）；burn 归零后条件守卫自然
    // 平息。节奏同 16-targets：0.24s 一发烟、burn>1 时 60% 概率窜一发火舌。
    // 本段在顶部 enabled 早退之后——靶场禁用（湖面）时不冒烟（P5-C 同语义）。
    const wfx = window.__rigFx;
    if (wfx && wfx._puff) {
      for (const s of this.strikes) {
        if (s.alive || !(s.burn > 0) || !s.wreck) continue;
        s.burn -= dt;
        if (s.burn <= 0) s.burn = 0;   // 钳到 0 冻结——遥测/断言不出现 -0.0x 尾巴
        s._smk -= dt;
        if (s._smk > 0) continue;
        s._smk = 0.24;
        const wp = s.wreck.position;
        wfx._puff(wp.x + (rnd() - 0.5) * 0.6, 0.5, wp.z + (rnd() - 0.5) * 0.6,
          { color: 0x2b2620, s0: 0.35, s1: 1.6, life: 1.3, base: 0.42, rise: 0.9 });
        if (s.burn > 1 && rnd() < 0.6) {
          wfx._puff(wp.x + (rnd() - 0.5) * 0.9, 0.3, wp.z + (rnd() - 0.5) * 0.9,
            { color: 0xff8a3c, s0: 0.14, s1: 0.55, life: 0.22, base: 0.6, add: true });
        }
      }
    }
    // Phase 21.2-A：受击缩放脉冲——0.12s 内正弦下压再回弹（Y 压 12%、XZ 微胀 5%，
    // "打到实体"的顿挫感）。计时器由 update 推进（不用 setTimeout 堆积），结束精确
    // 归位 (1,1,1)；摧毁瞬间的在途脉冲也照常走完，不会卡在半压缩态
    for (const s of this.strikes) {
      if (!(s._punch > 0)) continue;
      s._punch -= dt;
      const u = Math.min(1, Math.max(0, 1 - s._punch / 0.12));
      const dip = Math.sin(Math.PI * u);
      s.group.scale.set(1 + 0.05 * dip, 1 - 0.12 * dip, 1 + 0.05 * dip);
      if (s._punch <= 0) { s._punch = 0; s.group.scale.set(1, 1, 1); }
    }
    // Phase 21.2-B：冲击波环推进——ease-out 扩散（起爆快收尾缓）+ 线性淡出，
    // ~0.5s 到期自动移除+dispose（几何/材质双清，零跨局残留）
    for (let i = this._waves.length - 1; i >= 0; i--) {
      const w = this._waves[i];
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      const e = 1 - (1 - k) * (1 - k);
      const sc = w.r0 + (w.r1 - w.r0) * e;
      w.m.scale.set(sc, sc, 1);
      w.m.material.opacity = w.o0 * (1 - k);
      if (k >= 1) {
        if (w.m.parent) w.m.parent.remove(w.m);   // parent 无关移除（挂点=残骸组）
        w.m.geometry.dispose();
        w.m.material.dispose();
        this._waves.splice(i, 1);
      }
    }
    // Phase 21.2-C：夜间残骸辉光——仅 env==='night' 挂载（白天不挂/已挂即卸），
    // 亮度随余烬双频闪烁、burn 末段 2s 渐暗；burn 归零随残骸一起清理（_killGlow）
    for (const s of this.strikes) {
      if (!s.alive && s.wreck && s.burn > 0 && env === 'night') {
        if (!s._glow) this._attachGlow(s);
        const fl = 0.75 + 0.25 * Math.sin(time * 11 + s._gph) + 0.08 * Math.sin(time * 27 + s._gph * 2);
        s._glow.material.opacity = 0.38 * fl * Math.min(1, s.burn / 2);
        const gs = 2.6 * (0.9 + 0.12 * fl);
        s._glow.scale.set(gs, gs, 1);
      } else {
        this._killGlow(s);
      }
    }
    // Phase 28：渐进损伤线索——存活且 hp<hp0 按受创程度 d=1-hp/hp0 驱动：软烟
    // Sprite 点亮（受创越重烟越浓/越大，呼吸调制防死板）+ 发射架下垂/雷达盘侧倾
    // （绝对赋值——复原精确归位）。纯派生零状态机：复位 hp 复原 → d=0 全自动清；
    // 摧毁 → alive=false 走 21.1 残骸链，损伤烟随 d 归零熄灭
    for (const s of this.strikes) {
      if (!s._dmg) continue;
      const d = (s.alive && s.hp < s.hp0 - 1e-9) ? Math.min(1, 1 - s.hp / s.hp0) : 0;
      const sm = s._dmg.smoke;
      sm.visible = d > 0;
      if (d > 0) {
        const br = 0.75 + 0.25 * Math.sin(time * 1.3 + s._dmg.ph);
        sm.material.opacity = (0.16 + 0.4 * d) * br;
        const sc = (1.2 + 0.9 * d) * (0.9 + 0.12 * br);
        sm.scale.set(sc, sc, 1);
      }
      for (const t of s._dmg.tubes) t.rotation.x = t.userData._bx + d * 0.55 * t.userData._dp;
      if (s._dmg.dish) s._dmg.dish.rotation.z = d * 0.18;
    }
  }

  // 只读遥测（测试/调试出口）
  state() {
    return {
      enabled: this.enabled,
      groupVisible: this.group.visible,
      radarR: this.radarDish ? +this.radarDish.rotation.y.toFixed(3) : 0,
      patrol: this.patrol.map(p => ({ x: +p.g.position.x.toFixed(1), z: +p.g.position.z.toFixed(1) })),
      smokeOpacity: this.smokes.map(sm => +sm.s.material.opacity.toFixed(3)),
      // Phase 21：打击层遥测（测试断言源）
      strikes: this.strikes.map(s => ({ key: s.key, alive: s.alive, hp: +s.hp.toFixed(2) })),
      // Phase 21.1：残骸遥测（测试断言源；burn 未生成时为 0）
      wrecks: this.strikes.map(s => ({ key: s.key, wreck: !!s.wreck, burn: +(s.burn || 0).toFixed(2) })),
      // Phase 21.2：打击反馈遥测（测试断言源）——冲击波环数 / 受击脉冲计时 / 夜间辉光
      waves: this._waves.length,
      fx: this.strikes.map(s => ({ key: s.key, punch: +(s._punch || 0).toFixed(3), glow: !!s._glow })),
      // Phase 25：存活状态遥测（纯增量键）——波束有效可见性/强度 + 信标呼吸值
      // （70-app _seadObjectiveDone 只读 strikes/radarAlive，不受新增键影响）
      radarBeam: this._beam ? { on: this._beamOn(), op: +this._beam.material.opacity.toFixed(3) } : null,
      beacons: this._beacons.map(b => ({ key: b.s.key, on: !!b.s.alive, o: +b.sp.material.opacity.toFixed(3) })),
      // Phase 28：渐进损伤遥测（纯增量键）——受创标记 hurt / 程度 d（0=完好，
      // 1=打空；摧毁后 hurt=false、d=0——走 21.1 残骸链语义）
      damaged: this.strikes.map(s => {
        const hurt = s.alive && s.hp < s.hp0 - 1e-9;
        return { key: s.key, hp: +s.hp.toFixed(2), hurt: !!hurt,
                 d: hurt ? +Math.min(1, 1 - s.hp / s.hp0).toFixed(3) : 0 };
      }),
      radarAlive: this.radarAlive(),
      killEvent: !!this.killEvent,
    };
  }
}

// 经 HOST 注册工厂（70-app 低编号不得反向引用 81——拓扑硬规则，HOST 槽位
// 与 HOST.makeWeather/makeMusic 同款；70-app finish 经 HOST.makeNarrative 取用）
HOST.makeNarrative = (scene, W) => new NarrativeFX(scene, W);