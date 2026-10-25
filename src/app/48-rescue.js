// ============================================================
// 48-rescue.js — 绞车救援任务（P2-3）
// 幸存者随场地生成（沙漠/草原各一处，水上/棚拍无），信标闪烁+信号烟
// P4g：幸存者 = 真人士兵 GLB（CC0，assets/targets/survivor.glb，骨骼摆姿挥手求救 / 吊起时双臂抱胸）；
// 吊钩总成、钢索（末端橙色警示段）、马项圈救援环按 Breeze-Eastern / LSC 实物照片与美海军救援规范建模。
// GLB 未到或加载失败时用程序化兜底身体。与 AH-64E 同比例（1u≈2.27m，身高 1.85m）。
// 辅助寻找。玩法闭环：悬停对位 → K 放绞车 → 吊钩落地自动挂接 →
// 收绞车救起 → 低空返回停机坪 → 救援完成。
// 吊钩跟随机腹，随悬停移动自然摆动；K 可中途收回（幸存者原地放下）。
// ============================================================
const _rsUp = new THREE.Vector3(0, 1, 0), _rsV = new THREE.Vector3();
class Rescue {
  constructor(scene) {
    this.scene = scene;
    this.ok = false;              // 本场地是否生成幸存者
    this.state = 'idle';          // idle | deploying | holding | lifting | aboard | delivered | retracting
    this.ropeLen = 0;
    this.attached = false;
    this._sway = 0;
    this.onToast = null;

    // 幸存者：被击落的机组成员（P4g 替换旧"胶囊+球"木头人）
    // 按米建模再整体缩放到模型单位（1u≈2.27m，身高约 1.85m≈0.81u，与 AH-64E 同比例）。
    // 4 个网格：躯干/腿/头盔合批 1 个 + 左右臂各 1 个（可动：地面挥手、吊起时抓吊带）+ 救援吊带 1 个。
    const SUIT = 0x6c7150, VEST = 0x45473a, BOOT = 0x2a2420, SKIN = 0xc79a74,
      HELM = 0x5a5e49, VISOR = 0x181b20, GLOVE = 0x2c2924, PATCH = 0xe0702c;
    const kb = vcKit();
    for (const sx of [-1, 1]) {
      kb.box(0.13, 0.12, 0.29, BOOT, sx * 0.11, 0.06, 0.03);            // 靴
      kb.cyl(0.066, 0.06, 0.44, 8, SUIT, sx * 0.11, 0.34, 0);           // 小腿
      kb.cyl(0.088, 0.07, 0.42, 8, SUIT, sx * 0.11, 0.76, 0);           // 大腿
      kb.box(0.07, 0.12, 0.05, VEST, sx * 0.19, 0.78, 0.04);            // 腿袋
    }
    kb.box(0.36, 0.2, 0.22, SUIT, 0, 0.99, 0);                          // 胯
    kb.box(0.38, 0.5, 0.23, SUIT, 0, 1.28, 0);                          // 躯干（飞行服）
    kb.box(0.41, 0.36, 0.27, VEST, 0, 1.33, 0);                         // 救生背心
    kb.box(0.1, 0.1, 0.04, VEST, -0.1, 1.27, 0.15);                     // 胸袋
    kb.box(0.1, 0.1, 0.04, VEST, 0.1, 1.27, 0.15);
    kb.box(0.08, 0.05, 0.02, PATCH, 0.12, 1.44, 0.145);                 // 臂章/反光片
    kb.box(0.3, 0.28, 0.1, VEST, 0, 1.3, -0.17);                        // 背后救生包
    kb.cyl(0.055, 0.06, 0.1, 8, SKIN, 0, 1.57, 0);                      // 颈
    kb.sph(0.105, SKIN, 0, 1.69, 0.01);                                 // 脸
    kb.sph(0.135, HELM, 0, 1.735, -0.015, 1, 0.92, 1.12);               // 飞行头盔
    kb.box(0.2, 0.06, 0.05, VISOR, 0, 1.71, 0.115);                     // 护目镜
    const mat = vcMat(0.85, 0.05);
    const fig = new THREE.Group();
    this._proc = new THREE.Mesh(mergeGeos(kb.list), mat);
    fig.add(this._proc);
    // 手臂：枢轴在肩部，零件沿 -Y 下垂
    const arm = (sx) => {
      const ka = vcKit();
      ka.sph(0.07, SUIT, 0, 0, 0);
      ka.cyl(0.056, 0.05, 0.3, 8, SUIT, 0, -0.16, 0);
      ka.cyl(0.048, 0.042, 0.28, 8, SUIT, 0, -0.45, 0);
      ka.sph(0.052, GLOVE, 0, -0.62, 0);
      const pv = new THREE.Group();
      pv.position.set(sx * 0.235, 1.5, 0);
      pv.add(new THREE.Mesh(mergeGeos(ka.list), mat));
      fig.add(pv);
      return pv;
    };
    this.armL = arm(-1); this.armR = arm(1);
    // 救援吊带（"马项圈"式救援环：黄橙色软垫环从腋下绕过后背，两端在胸前上方汇成 V 形环挂到吊钩；
    // 外加一根胸前收紧带）。挂接后才显示。尺寸单位：米（fig 统一缩放）
    const SV = [0, 1.9, 0.2];                                          // V 形环位置（头顶前上方）
    const stc = new THREE.CatmullRomCurve3([
      [0, 1.9, 0.2], [-0.12, 1.62, 0.19], [-0.23, 1.41, 0.08], [-0.22, 1.37, -0.12], [0, 1.35, -0.21],
      [0.22, 1.37, -0.12], [0.23, 1.41, 0.08], [0.12, 1.62, 0.19]].map(a => new THREE.Vector3(...a)), true);
    const ks = vcKit();
    ks.add(new THREE.TubeGeometry(stc, 48, 0.035, 6, true), 0xf0a020);
    ks.add(new THREE.TorusGeometry(0.035, 0.008, 5, 10), 0x9a9ea2, SV[0], SV[1], SV[2]);
    ks.box(0.42, 0.04, 0.02, 0x2e2e2a, 0, 1.3, 0.18);                  // 胸前收紧带
    this.strap = new THREE.Mesh(mergeGeos(ks.list), mat);
    this.strap.visible = false;
    fig.add(this.strap);
    fig.scale.setScalar(U2M_INV);
    // 吊钩总成（照 Breeze-Eastern / LSC 救援钩：钢索压头 → 橙色防撞缓冲块 → 旋转节 → 带弹簧锁舌的银色锻钩）
    const HK = 0.48;                                                    // 缆端到钩底（米）
    const kh = vcKit();
    kh.cyl(0.015, 0.015, 0.05, 8, 0x8a8d90, 0, -0.025, 0);              // 钢索压头
    kh.cyl(0.055, 0.05, 0.14, 12, 0xe5631a, 0, -0.12, 0);               // 防撞缓冲块
    kh.cyl(0.058, 0.058, 0.014, 12, 0x232323, 0, -0.06, 0);
    kh.cyl(0.052, 0.052, 0.014, 12, 0x232323, 0, -0.18, 0);
    kh.cyl(0.03, 0.024, 0.07, 10, 0xa9adb1, 0, -0.225, 0);             // 旋转节
    kh.prism([[-0.02, 0], [0.02, 0], [0.025, -0.06], [0.06, -0.12], [0.075, -0.17], [0.06, -0.205], [0.02, -0.225],
      [-0.03, -0.215], [-0.06, -0.185], [-0.07, -0.15], [-0.055, -0.12], [-0.035, -0.13], [-0.035, -0.165],
      [-0.015, -0.19], [0.02, -0.192], [0.042, -0.168], [0.036, -0.13], [0.004, -0.07], [-0.02, -0.06]],
      0.034, 0xb9bdc1, 0, -0.26, 0);                                    // 锻钩
    kh.box(0.012, 0.075, 0.02, 0xc9cdd1, -0.038, -0.35, 0, 0, 0, -0.5); // 锁舌
    kh.box(0.02, 0.02, 0.012, 0xf2c419, 0.005, -0.3, 0.022);            // 黄色解锁钮
    this._hookMesh = new THREE.Mesh(mergeGeos(kh.list), vcMat(0.35, 0.6));
    this._hookMesh.scale.setScalar(U2M_INV);
    this.HOOK_H = HK * U2M_INV;
    this.SV = SV.map(v => v * U2M_INV);                                    // V 形环（u，人物本地）
    this.HANG = (HK + SV[1]) * U2M_INV;                                    // 缆端到脚底（u）
    this._fig = fig;
    this.g = new THREE.Group();
    this.g.add(fig);
    // 真人模型（CC0 士兵，grab3d.com/models/characters/soldier，减面+压缩后 assets/targets/survivor.glb）。
    // 加载成功即替换上面的程序化兜底身体；失败则保持兜底（与 26-airtargets 靶机同一模式）。
    this._sk = null;
    new THREE.GLTFLoader().load('assets/targets/survivor.glb', (gltf) => this._useGlb(gltf), undefined, () => {});
    this.g.visible = false;
    scene.add(this.g);

    // 信号烟（远距离可见的白灰色烟柱）
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(210,195,170,0.8)');
    gr.addColorStop(1, 'rgba(210,195,170,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    this.smoke = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, opacity: 0.55 }));
    this.smoke.scale.set(2.4, 5, 1);
    this.smoke.visible = false;
    scene.add(this.smoke);

    // 信标灯（橙红闪烁，夜间/远处可见）
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7038 }));
    this.beacon.visible = false;
    scene.add(this.beacon);

    // 绞车钢索（银灰；末端 6m 为橙色警示段，与实装一致）+ 吊钩总成
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0x6a6d70 }));
    this.rope.visible = false;
    scene.add(this.rope);
    this.ropeEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.0088, 0.0088, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0xe5631a }));
    this.rope.add(this.ropeEnd);
    this.hook = new THREE.Group();
    this.hook.add(this._hookMesh);
    this.hook.visible = false;
    scene.add(this.hook);
  }

  // 接入真人模型：按身高 1.85m 缩放、面朝 +Z，预先算好"挥手 A/B""吊起抱胸"三套手臂骨骼姿态
  _useGlb(gltf) {
    const m = gltf.scene, B = {};
    m.traverse(o => { if (o.isBone) B[o.name] = o; });
    const ARM = ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
    if (['Head', 'headfront', 'LeftHand', 'RightHand'].concat(ARM).some(n => !B[n])) return;
    const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
    const wrap = new THREE.Group();
    wrap.add(m);
    m.updateMatrixWorld(true);
    const wp = n => V().setFromMatrixPosition(B[n].matrixWorld);
    const f = wp('headfront').sub(wp('Head'));
    wrap.rotation.y = -Math.atan2(f.x, f.z);           // 模型正面转到 +Z（与程序化身体一致）
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const sc = 1.85 / Math.max(0.1, box.max.y - box.min.y);
    wrap.scale.setScalar(sc);
    wrap.position.y = -box.min.y * sc;
    this._fig.add(wrap);
    this._fig.updateMatrixWorld(true);
    const wInv = wrap.matrixWorld.clone().invert();
    const loc = n => wp(n).applyMatrix4(wInv);
    const R = Math.sign(loc('RightArm').x) || -1, L = -R;     // 角色右手在本地 X 的哪一侧
    const rest = ARM.map(n => B[n].quaternion.clone());
    const wq = Q(), pq = Q(), bq = Q(), dq = Q();
    const aim = (bn, cn, d) => {
      const bone = B[bn];
      wrap.getWorldQuaternion(wq);
      const cur = wp(cn).sub(wp(bn)).normalize();
      const tgt = V().set(d[0], d[1], d[2]).normalize().applyQuaternion(wq);
      dq.setFromUnitVectors(cur, tgt);
      bone.getWorldQuaternion(bq);
      bone.parent.getWorldQuaternion(pq);
      bone.quaternion.copy(pq.invert().multiply(dq.multiply(bq)));
      bone.updateMatrixWorld(true);
    };
    const pose = (dirs) => {
      ARM.forEach((n, i) => B[n].quaternion.copy(rest[i]));
      wrap.updateMatrixWorld(true);
      aim('LeftArm', 'LeftForeArm', dirs[0]); aim('LeftForeArm', 'LeftHand', dirs[1]);
      aim('RightArm', 'RightForeArm', dirs[2]); aim('RightForeArm', 'RightHand', dirs[3]);
      return ARM.map(n => B[n].quaternion.clone());
    };
    const lDown = [[L * 0.22, -0.97, 0.06], [L * 0.08, -1, 0.18]];
    const P = {
      // 挥手：大臂向侧上方抬起，小臂竖直向上、在"靠头"与"略外摆"之间摆动——肘部始终向内弯，不反关节
      waveA: pose([...lDown, [R * 0.8, 0.55, 0.15], [R * -0.22, 0.96, 0.12]]),
      waveB: pose([...lDown, [R * 0.8, 0.55, 0.15], [R * 0.32, 0.94, 0.12]]),
      hoist: pose([[L * 0.12, -0.95, 0.3], [R * 0.85, 0.2, 0.5], [R * 0.12, -0.95, 0.3], [L * 0.85, 0.3, 0.5]]),   // 双臂抱胸（救援规范：不可举手，否则会从吊带滑脱）
    };
    // CPU 蒙皮：把骨骼网格换成普通网格，由 _skin() 按骨骼姿态改写顶点（软件渲染下骨骼着色器会失败，
    // 实测丢失整个画面；一个人约 1.8 万顶点，限频 15 次/秒，开销很小）
    let sm = null;
    m.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
    if (!sm) return;
    const sg = sm.geometry, pa = sg.attributes.position, na = sg.attributes.normal,
      ja = sg.attributes.skinIndex, wa = sg.attributes.skinWeight, n = pa.count;
    const P0 = new Float32Array(n * 3), N0 = new Float32Array(n * 3), J0 = new Uint16Array(n * 4), W0 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      P0[i * 3] = pa.getX(i); P0[i * 3 + 1] = pa.getY(i); P0[i * 3 + 2] = pa.getZ(i);
      N0[i * 3] = na.getX(i); N0[i * 3 + 1] = na.getY(i); N0[i * 3 + 2] = na.getZ(i);
      J0[i * 4] = ja.getX(i); J0[i * 4 + 1] = ja.getY(i); J0[i * 4 + 2] = ja.getZ(i); J0[i * 4 + 3] = ja.getW(i);
      W0[i * 4] = wa.getX(i); W0[i * 4 + 1] = wa.getY(i); W0[i * 4 + 2] = wa.getZ(i); W0[i * 4 + 3] = wa.getW(i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P0.slice(), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N0.slice(), 3));
    if (sg.attributes.uv) geo.setAttribute('uv', sg.attributes.uv);
    if (sg.index) geo.setIndex(sg.index);
    const st = new THREE.Mesh(geo, sm.material);
    st.position.copy(sm.position); st.quaternion.copy(sm.quaternion); st.scale.copy(sm.scale);
    st.frustumCulled = false; st.castShadow = true;
    sm.parent.add(st);
    sm.parent.remove(sm);
    this._sk = { bones: ARM.map(n => B[n]), P, sm, st, P0, N0, J0, W0, last: -1, M: new THREE.Matrix4(), BM: [] };
    this._proc.visible = this.armL.visible = this.armR.visible = false;
    this._setPose(P.waveA, true);
  }

  // 设定手臂骨骼姿态并（限频）重算顶点
  _setPose(qs, force) {
    const k = this._sk;
    k.bones.forEach((b, i) => b.quaternion.copy(qs[i]));
    const now = performance.now();
    if (!force && now - k.last < 66) return;
    k.last = now;
    this._skin();
  }

  _skin() {
    const k = this._sk, sk = k.sm.skeleton;
    k.st.updateMatrixWorld(true);
    for (const b of sk.bones) b.updateMatrixWorld(true);
    // 每根骨骼的合成矩阵：网格逆 × 骨骼世界 × 骨骼逆绑定 × 绑定矩阵（与 three 着色器公式一致）
    const inv = k.M.copy(k.st.matrixWorld).invert();
    for (let b = 0; b < sk.bones.length; b++) {
      const m = k.BM[b] || (k.BM[b] = new THREE.Matrix4());
      m.multiplyMatrices(inv, sk.bones[b].matrixWorld).multiply(sk.boneInverses[b]).multiply(k.sm.bindMatrix);
    }
    const P0 = k.P0, N0 = k.N0, J0 = k.J0, W0 = k.W0, pos = k.st.geometry.attributes.position, nor = k.st.geometry.attributes.normal;
    const PA = pos.array, NA = nor.array, n = pos.count;
    for (let i = 0; i < n; i++) {
      const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2], nx = N0[i * 3], ny = N0[i * 3 + 1], nz = N0[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0, qx = 0, qy = 0, qz = 0;
      for (let j = 0; j < 4; j++) {
        const w = W0[i * 4 + j];
        if (w === 0) continue;
        const e = k.BM[J0[i * 4 + j]].elements;
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
        qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
        qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
        qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
      }
      const l = Math.hypot(qx, qy, qz) || 1;
      PA[i * 3] = ox; PA[i * 3 + 1] = oy; PA[i * 3 + 2] = oz;
      NA[i * 3] = qx / l; NA[i * 3 + 1] = qy / l; NA[i * 3 + 2] = qz / l;
    }
    pos.needsUpdate = nor.needsUpdate = true;
  }

  // 场地切换（Phase 0-0.3 跨地形状态规则）：
  //   idle                     → 有效地形重新生成幸存者；无效地形隐藏
  //   deploying/holding/lifting/retracting → 安全取消（绳/钩隐藏，状态复位）；
  //           有效地形随即重新生成幸存者，无效地形保持隐藏
  //   aboard                   → 保留"已救起待送回"（任何场地——幸存者在机上
  //           不在地面，切换不可能把机内的人取消；返回停机坪低空悬停即可送达）
  //   delivered                → 保持隐藏，切任何场地都不复活（本局终态）
  //   water/pad                → 无地面幸存者；中止未完成的地面绞车操作
  setTerrain(key) {
    const has = (key === 'desert' || key === 'grass');
    this.ok = has;
    // aboard：幸存者已在机上——任何场地切换都不在地面重新生成幸存者/烟/信标
    if (this.state === 'aboard') {
      this.smoke.visible = this.beacon.visible = false;
      return;
    }
    // delivered：已送达——任何切换都不复活地面幸存者
    if (this.state === 'delivered') {
      this.g.visible = this.smoke.visible = this.beacon.visible = false;
      return;
    }
    if (!has) {
      // 无效地形（water/pad）：无地面幸存者，安全取消未完成的地面绞车操作
      this._forceIdle();
      this.g.visible = this.smoke.visible = this.beacon.visible = false;
      return;
    }
    // idle 或绞车进行中（有效地形）：安全取消绞车操作，在新地形重新生成幸存者
    const wasBusy = this.state !== 'idle';
    this.state = 'idle';
    this.attached = false;
    this.ropeLen = 0;
    this.hook.visible = this.rope.visible = false;
    const px = key === 'desert' ? 26 : 22, pz = key === 'desert' ? -14 : -10;
    this._home = { x: px, z: pz };
    this.g.position.set(px, 0, pz);
    this.smoke.position.set(px, 2.4, pz);
    this.beacon.position.set(px + 0.45, 0.07, pz + 0.3);   // 地面频闪灯放在人身旁，不挡人
    this.g.visible = this.smoke.visible = this.beacon.visible = true;
    if (wasBusy && this.onToast) this.onToast('场地切换——绞车操作已取消，幸存者已重新定位');
  }

  _forceIdle() {
    this.state = 'idle';
    this.ropeLen = 0;
    this.attached = false;
    this.hook.visible = this.rope.visible = false;
  }

  // 最终闭环修复（救援状态跨任务泄漏）：新任务轮次入口——与 setTerrain 的
  // 同局切地形语义不同，resetRound 无条件清除终态（delivered/aboard/绳索/
  // 附着）并按当前地形重新生成幸存者。startMission()/retry 调用；
  // setTerrain() 保持"同一局切换地形"的既有语义（aboard 保留、delivered 终态）。
  resetRound(key) {
    this.state = 'idle';
    this.attached = false;
    this.ropeLen = 0;
    this.hook.visible = this.rope.visible = false;
    const has = (key === 'desert' || key === 'grass');
    this.ok = has;
    if (!has) {
      this.g.visible = this.smoke.visible = this.beacon.visible = false;
      return;
    }
    const px = key === 'desert' ? 26 : 22, pz = key === 'desert' ? -14 : -10;
    this._home = { x: px, z: pz };
    this.g.position.set(px, 0, pz);
    this.smoke.position.set(px, 2.4, pz);
    this.beacon.position.set(px + 0.45, 0.07, pz + 0.3);   // 地面频闪灯放在人身旁，不挡人
    this.g.visible = this.smoke.visible = this.beacon.visible = true;
  }

  // K 键：放/收绞车（悬停 2~30u——绳长自动延伸到地面，悬停高度即标准悬停 14u 也可作业）
  // P7：速度受控作业窗口——直升机需低速悬停（speed ≤ 3u/s）才可放绞车，
  // 飞行/平移中放缆会让吊钩拖拽失效（战术决策：先减速悬停再作业）。
  toggle(heliPos) {
    if (!this.ok || !heliPos) return;
    if (this.state === 'idle') {
      if (heliPos.y < 2 || heliPos.y > 30) {
        if (this.onToast) this.onToast('绞车作业高度 2~30u，请调整悬停高度');
        return;
      }
      // speed 由 70-app loop 每帧派生（FPV 前向/侧飞合成；环绕平移 7u/s）
      if ((this.speed || 0) > 3) {
        if (this.onToast) this.onToast('飞行中无法放绞车——请减速悬停后再试');
        return;
      }
      this.state = 'deploying';
      this.ropeLen = 0.2;
      this.hook.visible = this.rope.visible = true;
      if (this.onToast) this.onToast('绞车放出——悬停于幸存者上方');
    } else if (this.state === 'deploying' || this.state === 'holding') {
      this.state = 'retracting';
      if (this.onToast) this.onToast('绞车收回');
    }
  }

  update(dt, heliPos) {
    if (!this.ok && this.state === 'idle') { this.hook.visible = this.rope.visible = false; return; }
    this._sway = (this._sway || 0) + dt;
    // 机腹吊点
    const bx = heliPos.x, by = heliPos.y - 0.9, bz = heliPos.z;

    if (this.state === 'deploying' || this.state === 'holding') {
      const target = Math.max(0.2, by - 0.25);          // 吊钩落至离地 ~0.25
      this.ropeLen = Math.min(this.ropeLen + 3 * dt, target);
      // 吊钩贴地后：幸存者在 2u 内 → 自动挂接
      const hx = bx + Math.sin(this._sway * 1.4) * Math.min(0.35, this.ropeLen * 0.05);
      const hz = bz + Math.cos(this._sway * 1.4) * Math.min(0.35, this.ropeLen * 0.05);
      const dx = hx - this._home.x, dz = hz - this._home.z;
      // 挂接两条件缺一不可：①绳放到底（钩贴地）②幸存者在 2u 内——
      // 否则部署第一帧（钩还在半空）就会因水平距离满足而瞬间挂接
      if (this.ropeLen >= target - 0.01 && Math.hypot(dx, dz) < 2.0 && this.attached === false) {
        this.attached = true;
        this.state = 'lifting';
        if (this.onToast) this.onToast('幸存者已挂接——收绞车');
      } else if (this.ropeLen >= target - 0.01) {
        this.state = 'holding';                         // 绳放到底，等待对位
      }
    } else if (this.state === 'lifting') {
      this.ropeLen = Math.max(this.ropeLen - 2.2 * dt, 0.35);
      if (this.ropeLen <= 0.36) {
        this.state = 'aboard';
        this.attached = false;
        this.g.visible = false;              // 幸存者进机内（不再显示地面模型）
        if (this.onToast) this.onToast('幸存者已救起——低空返回停机坪');
      }
      // 幸存者随吊钩移动
      const hx = bx + Math.sin(this._sway * 1.3) * Math.min(0.3, this.ropeLen * 0.04);
      const hz = bz + Math.cos(this._sway * 1.3) * Math.min(0.3, this.ropeLen * 0.04);
      this.g.position.set(hx, Math.max(by - this.ropeLen - this.HANG, 0), hz);
    } else if (this.state === 'retracting') {
      this.ropeLen = Math.max(this.ropeLen - 3 * dt, 0);
      if (this.ropeLen <= 0) { this._forceIdle(); }
    } else if (this.state === 'aboard') {
      // 送回停机坪：低空（<4u）悬停于坪心 8u 内 → 完成
      const d = Math.hypot(heliPos.x, heliPos.z);
      if (d < 8 && heliPos.y < 4) {
        this.state = 'delivered';
        this.g.visible = this.smoke.visible = this.beacon.visible = false;
        this.hook.visible = this.rope.visible = false;
        if (this.onToast) this.onToast('幸存者已送抵医疗点——救援任务完成');
      }
    } else if (this.state === 'delivered') {
      return;                                            // 本场救援已完成
    }

    // 绳/钩视觉跟随（deploying/holding/lifting/retracting）
    if (this.state !== 'idle' && this.state !== 'delivered') {
      this.rope.visible = this.hook.visible = true;
      const sw = Math.min(0.3, this.ropeLen * 0.04);
      const hx = bx + Math.sin(this._sway * 1.4) * sw, hz = bz + Math.cos(this._sway * 1.4) * sw;
      this.hook.position.set(hx, by - this.ropeLen, hz);
      // 钢索从机腹吊点直连钩头（随摆动倾斜，不再是竖直棍子）
      const dx = hx - bx, dy = -Math.max(this.ropeLen, 0.05), dz = hz - bz, len = Math.hypot(dx, dy, dz);
      this.rope.position.set(bx + dx / 2, by + dy / 2, bz + dz / 2);
      this.rope.quaternion.setFromUnitVectors(_rsUp, _rsV.set(-dx / len, -dy / len, -dz / len));
      this.rope.scale.set(1, len, 1);
      const el = Math.min(len, 6 * U2M_INV) / len;                         // 末端 6m 橙色段（局部坐标）
      this.ropeEnd.scale.set(1, el, 1);
      this.ropeEnd.position.y = -0.5 + el / 2;
      // 挂接后：人的 V 形环正好挂在钩底，绕钢索缓慢自转
      if (this.attached) {
        const yaw = this.g.rotation.y, v = this.SV;
        this.g.position.set(hx - Math.sin(yaw) * v[2], Math.max(by - this.ropeLen - this.HANG, 0), hz - Math.cos(yaw) * v[2]);
      }
    }
    // 姿态：地面上面朝直升机挥手求救；挂上吊带后双臂抱胸、吊带显示
    if (this.g.visible) {
      this.strap.visible = this.attached;
      const sk = this._sk;
      if (this.attached) {
        if (sk) this._setPose(sk.P.hoist);
        else { this.armL.rotation.set(-0.9, 0, -0.1); this.armR.rotation.set(-0.9, 0, 0.1); }
        this.g.rotation.y += dt * 0.6;       // 吊在绳上缓慢自转
      } else {
        this.g.rotation.y = Math.atan2(heliPos.x - this.g.position.x, heliPos.z - this.g.position.z);
        const t = 0.5 + 0.5 * Math.sin(this._sway * 5);
        if (sk) { sk.bones.forEach((b, i) => b.quaternion.slerpQuaternions(sk.P.waveA[i], sk.P.waveB[i], t)); this._setPose(sk.bones.map(b => b.quaternion)); }
        else { this.armL.rotation.set(0, 0, -0.12); this.armR.rotation.set(0, 0, 2.55 + 0.4 * Math.sin(this._sway * 5)); }
      }
    }
    // 信号烟上升 + 信标闪烁（幸存者在场且未救起时）
    if (this.smoke.visible) {
      this.smoke.position.y = 2.4 + Math.sin(this._sway * 0.8) * 0.5;
      this.smoke.material.opacity = 0.42 + 0.16 * Math.sin(this._sway * 1.1);
      this.beacon.material.color.setHex(Math.sin(this._sway * 4) > 0 ? 0xff7038 : 0x6b2c14);
    }
  }
}
