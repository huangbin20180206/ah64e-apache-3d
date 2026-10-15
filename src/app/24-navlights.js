// ============================================================
// 24-navlights.js — 机体夜间灯光系统
//（航行灯 / 防撞信标 / 尾部频闪 / 机腹搜索灯 / 编队灯条 / 座舱仪表绿光）
// ============================================================
// 真实 AH-64E 夜航灯组：
//   航行灯    左红右绿，恒亮（电池汇流条供电，引擎未启动也亮）
//   尾航行灯  白色恒亮（尾梁末端）
//   防撞信标  红色脉冲闪，机身顶 + 腹部各一（约 50 次/分，随引擎工作）
//   频闪灯    白色双闪（垂尾顶，随引擎工作）
//   搜索灯    机腹 SpotLight 前下照地（夜间/黄昏开——地面暖白光池）
//   编队灯条  暗绿"黏液灯"，机身两侧 ×3 + 尾梁两侧 ×2 + 垂尾两侧 ×2（恒亮）
//   仪表绿光  座舱玻璃是不透明材质（USMC_LowVis_Glass 无透射），
//             用挡风玻璃外侧的加法混合柔光斑模拟仪表光透出
// 贴附：灯珠锚节点包围盒即可（浮在特征点边缘无碍），编队灯条必须贴真实
// 机身表面——节点包围盒常比该处机身宽（尾梁 bbox 还不对称），包盒比例
// 偏移会把灯条埋进机体或悬空。这里从外侧向机体中轴打 Raycaster 取
// 首个命中面，沿外法线抬 0.02 贴附；未命中回退包围盒位置。
// 灯体 = 自发光小球：MeshBasicMaterial 且色值 >1（bloom 亮度门限 1.42，
// 见 40-post.js——夜里场景整体亮度极低，灯珠自动进入辉光链发亮）；
// 材质关雾，夜间浓雾不吞灯亮。
// 遥测：beacon/strobe 维护峰值保持（1.2/s 线性衰减）——闪烁脉冲 ~100ms，
// 外部轮询单点采样必然错过，读 state().peak 任意时刻都能取到上一闪峰值。
// 湖面倒影：19-reflect.js 的 bind() 会把克隆体全部网格换成水色着色器，
// bindMirror() 在其后把灯珠镜像材质恢复为自发光——夜水面上能看到
// 信标闪烁的倒影；克隆体里的 SpotLight 必须摘除（镜像灯会从水下朝上照）。
// visible 每帧由 refl.update 按 pairs 同步，无需自理。
// ============================================================

// 三角形脉冲（中心 c、半宽 w，0..1），用于灯闪包络
function nlPulse(f, c, w) {
  const d = Math.abs(f - c);
  const k = Math.max(0, 1 - d / w);
  return k * k * (3 - 2 * k);        // smoothstep 造型，边缘柔和
}

// 柔光斑贴图：径向渐变（Sprite 加法混合用）
function nlGlowTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.32)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class NightLights {
  constructor(apache) {
    this.apache = apache;
    this.g = new THREE.Group();
    this.g.name = 'NavLights';
    this.targetI = 0;               // 目标亮度（由环境预设驱动）
    this.I = 0;                     // 当前亮度（平滑趋近）
    this._pkB = 0; this._pkS = 0;   // 信标/频闪峰值保持（遥测用）
    this.items = [];
    this._mirrorN = 0;
    this._mirrorLights = 0;

    apache.root.updateMatrixWorld(true);
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const box = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3();

    // [键, 锚节点, 包围盒比例偏移(x,y,z), 自发光色(线性RGB,>1 进bloom), 半径, 类别]
    const defs = [
      ['navL',        'Cube001_2',    [-0.50, -0.20,  0.30], [2.8, 0.05, 0.07], 0.045, 'nav'],
      ['navR',        'Cube001_2',    [ 0.50, -0.20,  0.30], [0.05, 2.8, 0.10], 0.045, 'nav'],
      ['tailNav',     'Cylinder.011', [ 0.00,  0.12, -0.48], [2.6, 2.5, 2.3],   0.040, 'nav'],
      ['beaconTop',   'Cylinder.011', [ 0.00,  0.55,  0.10], [4.6, 0.08, 0.10], 0.060, 'beacon'],
      ['beaconBelly', 'BODY',         [ 0.00, -0.50, -0.05], [4.6, 0.08, 0.10], 0.060, 'beacon'],
      ['strobe',      'Cube001_8',    [ 0.00,  0.55,  0.00], [6.0, 5.9, 5.6],   0.060, 'strobe'],
    ];
    const anchorPos = (nodeName, off) => {
      const node = apache.get(nodeName);
      if (!node) return null;
      box.setFromObject(node);
      if (box.isEmpty()) return null;
      box.getCenter(c); box.getSize(s);
      const p = new THREE.Vector3(c.x + off[0] * s.x, c.y + off[1] * s.y, c.z + off[2] * s.z);
      apache.root.worldToLocal(p);
      return p;
    };
    for (const [key, nodeName, off, rgb, r, kind] of defs) {
      const p = anchorPos(nodeName, off);
      if (!p) continue;
      const mat = new THREE.MeshBasicMaterial({ fog: false });
      mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p);
      mesh.scale.setScalar(r);
      this.g.add(mesh);
      this.items.push({ key, kind, mesh, mat, base: mat.color.clone() });
    }

    // —— 编队灯条：暗绿恒亮；位置 = 从外侧向中轴射线贴附真实蒙皮 ——
    // 构造时 root 尚无停放补偿（恒等变换），世界系即 root 局部系。
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const rc = new THREE.Raycaster();
    const o3 = new THREE.Vector3(), d3 = new THREE.Vector3();
    // 从 x=side*far 处朝中轴打射线，取首个命中点，沿入射反方向抬 0.02
    const skin = (side, y, z, far = 3.2) => {
      o3.set(side * far, y, z);
      d3.set(-side, 0, 0);
      rc.set(o3, d3);
      const hits = rc.intersectObject(apache.src, true);
      if (!hits.length) return null;
      const p = hits[0].point.clone();
      p.x += side * 0.02;
      return apache.root.worldToLocal(p);
    };
    const fmtGreen = [0.10, 1.50, 0.20];
    // [键, side, y, z, 条尺寸(x,y,z)]
    const fmtDefs = [
      // 机身两侧各三条（驾驶舱侧→后机身，避开短翼/武器挂载高度）
      ['fmtBodyL1', -1, 1.30, 2.60, [0.016, 0.050, 0.30]],
      ['fmtBodyL2', -1, 1.28, 1.40, [0.016, 0.050, 0.30]],
      ['fmtBodyL3', -1, 1.26, 0.20, [0.016, 0.045, 0.28]],
      ['fmtBodyR1',  1, 1.30, 2.60, [0.016, 0.050, 0.30]],
      ['fmtBodyR2',  1, 1.28, 1.40, [0.016, 0.050, 0.30]],
      ['fmtBodyR3',  1, 1.26, 0.20, [0.016, 0.045, 0.28]],
      // 尾梁两侧各两条（z ≤ −4.05 已越过梁端，射线落空会退回机身中心）
      ['fmtBoomL1', -1, 2.00, -3.75, [0.014, 0.038, 0.22]],
      ['fmtBoomL2', -1, 2.00, -4.00, [0.014, 0.038, 0.22]],
      ['fmtBoomR1',  1, 2.00, -3.75, [0.014, 0.038, 0.22]],
      ['fmtBoomR2',  1, 2.00, -4.00, [0.014, 0.038, 0.22]],
      // 垂尾两侧各一条
      ['fmtFinL',   -1, 2.35, -3.70, [0.014, 0.18, 0.016]],
      ['fmtFinR',    1, 2.35, -3.70, [0.014, 0.18, 0.016]],
    ];
    const fb = anchorPos('BODY', [0, 0, 0]) || new THREE.Vector3(0, 1.2, 0);
    for (const [key, side, y, z, dim] of fmtDefs) {
      const p = skin(side, y, z) || fb.clone();   // 未命中回退机身中心
      const mat = new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide });
      mat.color.setRGB(fmtGreen[0], fmtGreen[1], fmtGreen[2]);
      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.position.copy(p);
      mesh.scale.set(dim[0], dim[1], dim[2]);
      this.g.add(mesh);
      this.items.push({ key, kind: 'fmt', mesh, mat, base: mat.color.clone() });
    }
    apache.root.add(this.g);

    // —— 机腹搜索灯：SpotLight 前下 35° 照地，夜间地面暖白光池 ——
    // 物理光照单位（坎德拉）；恒可见只调强度，避免灯数变化触发全场景着色器重编译
    const sp = anchorPos('BODY', [0, -0.40, 0.28]) || new THREE.Vector3(0, 0.4, 2.4);
    this.search = new THREE.SpotLight(0xfff0d6, 0, 55, 0.50, 0.45, 1.6);
    this.search.castShadow = false;
    this.search.position.copy(sp);
    this.search.target.position.copy(sp).add(new THREE.Vector3(0, -7.2, 10.2));
    apache.root.add(this.search, this.search.target);
    this.searchBase = 3000;

    // —— 座舱仪表绿光：挡风玻璃外侧柔光斑（玻璃不透射，只能"透出来"做）——
    const dp = anchorPos('Cube001_2', [0, 0.26, 0.42]);
    if (dp) {
      dp.addScaledVector(new THREE.Vector3(0, 0.5, 0.85).normalize(), 0.05); // 抬出玻璃面防 z-fighting
      this.dashMat = new THREE.SpriteMaterial({
        map: nlGlowTex(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      });
      this.dashMat.color.setRGB(0.22, 1.0, 0.38);
      this.dash = new THREE.Sprite(this.dashMat);
      this.dash.position.copy(dp);
      this.dash.scale.set(0.7, 0.42, 1);
      apache.root.add(this.dash);
    }
  }

  // 环境预设联动：夜间全开 / 黄昏 85% / 正午·棚拍关闭
  syncEnv(key) {
    this.targetI = key === 'night' ? 1.0 : key === 'dusk' ? 0.85 : key === 'dawn' ? 0.5 : 0.0;
    this.envKey = key;
  }

  // 湖面倒影配对：灯珠镜像材质换回自发光；克隆体里的灯（SpotLight）摘除
  bindMirror(refl) {
    if (!refl || !refl._pairs) return;
    const mine = new Set(this.items.map(it => it.mesh));
    for (const [src, dst] of refl._pairs) {
      if (!src.isMesh || !mine.has(src)) continue;
      dst.material = src.material.clone();
      const it = this.items.find(i => i.mesh === src);
      it.mirror = dst; it.mirrorMat = dst.material;
      this._mirrorN++;
    }
    // 镜像组里的真实光源必须移除：scale.y=-1 的容器会让 SpotLight 从水下朝上照，
    // 且多一盏灯触发全场景着色器重编译。仪表光斑共享材质，镜像自动跟随，保留。
    if (refl._clone) {
      const drop = [];
      refl._clone.traverse(o => { if (o.isLight) drop.push(o); });
      for (const o of drop) o.parent && o.parent.remove(o);
      this._mirrorLights = drop.length;
    }
  }

  update(dt, time, spin) {
    // 亮度平滑趋近（换环境淡入淡出）
    this.I += (this.targetI - this.I) * Math.min(1, dt * 5);
    const I = this.I;
    this.g.visible = I > 0.02;

    // 搜索灯：恒可见只调强度（0 强度不触发重编译）；停放也亮（地面有光池）
    // P4c：沙地反照率高，黄昏/清晨天光仍亮——原 3000cd 在沙漠打出过曝光斑。
    // 按场地/时段压低（searchMul 由 70-loop 每帧写入场地；夜间草地/停机坪不变）
    const tMul = this.searchTerrainMul != null ? this.searchTerrainMul : 1;
    const eMul = this.envKey === 'night' ? 1 : 0.55;
    this.search.intensity = this.searchBase * Math.max(0, (I - 0.02) / 0.98) * (tMul < 1 ? tMul * eMul : tMul);

    // 仪表绿光：随整体亮度淡入淡出（Sprite 与原机共享材质，倒影自动跟随）
    if (this.dashMat) this.dashMat.opacity = 0.42 * I;

    // 信标/频闪只在引擎运转时闪（spin>2% 即视为工作）；航行灯/编队灯电池常亮
    const eng = spin > 0.02 ? 1 : 0;
    const fB = (time % 1.2) / 1.2;                       // 信标 ~50 次/分
    const beaconK = nlPulse(fB, 0.10, 0.10) * eng;
    const fS = (time % 1.5) / 1.5;                       // 频闪双闪周期 1.5s
    const strobeK = Math.min(1, nlPulse(fS, 0.03, 0.028) + nlPulse(fS, 0.14, 0.028)) * eng;
    // 峰值保持（1.2/s 线性衰减）：外部轮询任意时刻都能读到上一闪的峰值
    this._pkB = Math.max(beaconK, this._pkB - dt * 1.2);
    this._pkS = Math.max(strobeK, this._pkS - dt * 1.2);

    if (!this.g.visible) return;
    for (const it of this.items) {
      let k = 1;
      if (it.kind === 'beacon') k = beaconK;
      else if (it.kind === 'strobe') k = strobeK;
      const v = k * I;
      it.mesh.visible = v > 0.02;
      it.mat.color.copy(it.base).multiplyScalar(v);
      if (it.mirror) {
        it.mirror.visible = it.mesh.visible;
        it.mirrorMat.color.copy(it.mat.color);
      }
    }
  }

  // 调试出口：__dbg.nl.state() 一眼看全
  state() {
    const o = { intensity: this.I, target: this.targetI,
      mirror: this._mirrorN, mirrorLights: this._mirrorLights,
      search: Math.round(this.search.intensity),
      dash: this.dashMat ? +this.dashMat.opacity.toFixed(2) : 0,
      peak: { beacon: +this._pkB.toFixed(2), strobe: +this._pkS.toFixed(2) },
      lights: {} };
    for (const it of this.items) {
      o.lights[it.key] = { visible: it.mesh.visible, kind: it.kind,
        level: +(it.mat.color.r / it.base.r).toFixed(2) };
    }
    return o;
  }
}
