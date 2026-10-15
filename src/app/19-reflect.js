// ============================================================
// 19-reflect.js — 湖面倒影（P3-⑦）
// "镜像实体"近似平面镜反射：整机深拷贝放进一个 Y 翻转的容器组，
// 每帧同步原机全部节点的局部变换——旋翼旋转/雷达扫描/爆炸分解/
// 外挂离架全都跟得住。水面材质在 30-world.js 里切为半透明，
// 倒影透出水下；倒影本体用"深度吸收"着色（入水越深越暗越蓝），
// 再叠场景雾与微波光泽，远处自然消隐。
// 相比全场景渲染到 RT 的真平面反射，只多一份模型绘制，代价低一个量级。
// ============================================================

class WaterReflection {
  constructor(scene, planeY = 0) {
    this.scene = scene;
    this.planeY = planeY;
    this.enabled = false;
    this._rate = 2;              // 默认实时（高画质），applyQuality 会覆盖
    this._frame = 0;

    // 镜像容器：关于 y=planeY 翻转（scale.y=-1 再平移 2*planeY）
    this.group = new THREE.Group();
    this.group.scale.y = -1;
    this.group.position.y = 2 * planeY;
    this.group.visible = false;
    scene.add(this.group);

    // 每帧拷贝整机根变换的枢轴（root 的父级是 scene，局部变换即世界变换）
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    this._baseShallow = new THREE.Color(0x5d8f9b);   // P29：水色更青一分，透出的倒影带水感
    this.uniforms = {
      uWaterY: { value: planeY },
      uShallow: { value: this._baseShallow.clone() },
      uDeep: { value: new THREE.Color(0x0e1c22) },
      uFogCol: { value: new THREE.Color(0x8fb2bc) },
      // P29：吸收率 0.045→0.036——悬停镜像主体（水下 12~17u）少暗一档，
      // 倒影更清晰；更深处仍收敛到深水色，"入水越深越暗"的语义不变
      uAbsorb: { value: 0.036 },
      uFogD: { value: 0.006 },
      uTime: { value: 0 },
    };
    // DoubleSide：镜像缩放翻转了三角形绕向，FrontSide 会整模型消失
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        uniform float uWaterY;
        varying float vBelow;
        varying float vFogDepth;
        varying vec3 vWp;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWp = wp.xyz;
          vBelow = max(0.0, uWaterY - wp.y);    // 水面下深度（镜像后为正）
          vec4 mv = viewMatrix * wp;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform vec3 uShallow, uDeep, uFogCol;
        uniform float uAbsorb, uFogD, uTime;
        varying float vBelow;
        varying float vFogDepth;
        varying vec3 vWp;
        void main(){
          // 深度吸收：入水越深越暗越蓝（水对红橙光吸收最快）
          vec3 col = mix(uShallow, uDeep, clamp(vBelow * uAbsorb, 0.0, 0.94));
          // 微波光泽：轻微横向明暗条带，读得出"水面下"的质感
          //（P29：0.10→0.07 收敛——条带过强会让倒影像隔了层毛玻璃）
          float rip = sin(vWp.x * 8.0 + uTime * 1.4) * sin(vWp.z * 6.0 - uTime * 1.1);
          col *= 0.93 + 0.07 * rip;
          // 场景雾（FogExp2 同式），远处倒影融进雾色
          float f = 1.0 - exp(-uFogD * uFogD * vFogDepth * vFogDepth);
          col = mix(col, uFogCol, clamp(f, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    this._pairs = null;    // [源节点, 镜像节点] 平行表
    this._clone = null;
  }

  // 深拷贝整机并替换为统一倒影材质（GLB 载入完成后调用一次）。
  // dynRoots：额外必须保留逐节点同步的子树根（如夜航灯组——24-navlights
  // 的 bindMirror 靠 _pairs 找灯珠镜像恢复自发光材质，不能被烘焙吞掉）。
  bind(apache, dynRoots) {
    this._clone = apache.root.clone(true);
    // 根节点变换由 pivot 承担，克隆根自身归零，避免双重应用
    this._clone.position.set(0, 0, 0);
    this._clone.quaternion.identity();
    this._clone.scale.set(1, 1, 1);
    // 平行节点表：递归逐层配对（clone(true) 保持子节点顺序）
    this._pairs = [];
    const walk = (s, d) => {
      for (let i = 0; i < s.children.length; i++) {
        this._pairs.push([s.children[i], d.children[i]]);
        walk(s.children[i], d.children[i]);
      }
    };
    walk(apache.root, this._clone);
    this._clone.traverse(o => {
      if (o.isMesh) {
        o.material = this.mat;
        o.castShadow = false;      // 倒影不参与阴影投射
        o.receiveShadow = false;
        // 桨盘残影等特效网格（app 用 userData.noRefl 标记）不进倒影
        if (o.userData.noRefl) o.visible = false;
      }
    });
    this.pivot.add(this._clone);

    // ---------- PERF-AUDIT C1：镜像静态子树烘焙合并 ----------
    // 镜像材质是单一 ShaderMaterial，静态节点的逐 mesh draw 纯属浪费
    //（water 场景镜像贡献 ~85 draws）。把"构造后局部变换永不改变"的静态
    // 节点烘焙进合并体（每 attribute 集 1 个 mesh），动画节点（旋翼/尾桨/
    // 雷达/地狱火挂架/夜航灯）保留 pair 逐帧同步。合并失败（mergeGeos
    // 返回 null）的桶整体保底不合并——任何路径都不丢几何。
    this._dynPairs = [];
    this._mergedMeshes = [];
    {
      this.group.updateMatrixWorld(true);
      const dyn = new Set();
      const mark = o => { if (o && o.traverse) o.traverse(c => dyn.add(c)); };
      mark(apache.mainRotor); mark(apache.tailRotor); mark(apache.radar);
      // PART_GROUPS 全表入动态名单：涂装切换（army/usmc 贴花显隐）与武器
      // 挂载切换（地狱火/火箭巢/机炮显隐）都会翻转节点 visible——烘焙进
      // 合并体会让倒影"多显示"已卸挂的部件，必须保留逐节点同步
      for (const nm of [].concat(PART_GROUPS.armyDecals, PART_GROUPS.usmcDecals,
                                 PART_GROUPS.hellfire, PART_GROUPS.rocketPod, PART_GROUPS.gun)) {
        mark(apache.get(nm));
      }
      for (const h of (apache.hellfire || [])) mark(h);
      if (dynRoots) for (const r of dynRoots) mark(r);
      // pivot 相对矩阵：把克隆 mesh 的世界变换折算到 pivot 坐标系再烘焙
      const rel = new THREE.Matrix4();
      const buckets = new Map();   // attribute 签名 -> { geos, nodes }
      for (const [s, d] of this._pairs) {
        if (dyn.has(s)) { this._dynPairs.push([s, d]); continue; }
        if (!d.isMesh || !d.visible) continue;      // noRefl 件保持隐藏，不进合并体
        rel.copy(this.pivot.matrixWorld).invert().multiply(d.matrixWorld);
        const geo = d.geometry.clone().applyMatrix4(rel);
        const key = (geo.index ? 'i' : 'n') + '|' + Object.keys(geo.attributes).sort().join(',');
        let b = buckets.get(key);
        if (!b) { b = { geos: [], nodes: [] }; buckets.set(key, b); }
        b.geos.push(geo);
        b.nodes.push(d);
      }
      for (const b of buckets.values()) {
        const mg = mergeGeos(b.geos);
        if (!mg) continue;                          // 保底：属性集不齐放弃该桶
        for (const n of b.nodes) { if (n.parent) n.parent.remove(n); }
        const m = new THREE.Mesh(mg, this.mat);
        m.castShadow = false; m.receiveShadow = false;
        this.pivot.add(m);
        this._mergedMeshes.push(m);
      }
    }
  }

  // 爆炸视图组合态：合并体不参与逐节点分解（几何已烘焙），开启分解时由
  // 72-uibind 的 explode 回调显式隐藏整个镜像——视觉取舍见 PERF-AUDIT C1。
  setExplodeMode(on) {
    this._explodeHide = !!on;
    this._applyVis();
  }
  _applyVis() {
    this.group.visible = this.enabled && (this._rate === undefined || this._rate > 0) && !this._explodeHide;
  }

  setEnabled(on) {
    this.enabled = on;
    this._applyVis();
  }

  // 环境预设联动：近水色乘有效入射光（黄昏偏暖、夜间压暗、棚拍中性）
  syncLighting(P) {
    if (!P) return;
    const light = new THREE.Color(P.sunCol).multiplyScalar(Math.min(P.sunI, 4) * 0.16)
      .add(new THREE.Color(P.horizon).multiplyScalar(P.hemi * 0.5 + 0.18));
    this.uniforms.uShallow.value.copy(this._baseShallow).multiply(light);
  }

  // 更新频率控制（P0-③ 倒影可降级）：
  //   2=实时每帧（高画质）  1=每 3 帧更新一次（标准画质）  0=完全关闭（性能档）
  setUpdateRate(rate) {
    this._rate = rate;
    this._applyVis();
  }

  // 每帧：同步整机姿态 + 雾参数（环境切换/brownout 自动生效）。
  // C1 合并后只同步动态对（旋翼/尾桨/雷达/挂架/夜航灯）——静态子树已烘焙。
  update(apacheRoot, time) {
    if (!this.enabled || !this._pairs) return;
    // 降级模式：跳帧更新（低频模式下每 3 帧做一次完整同步，其余帧只做相机跟随）
    if (this._rate === 1 && (this._frame = (this._frame || 0) + 1) % 3 !== 0) return;
    if (this._rate === 0) return;
    this.uniforms.uTime.value = time;
    const fog = this.scene.fog;
    if (fog) {
      this.uniforms.uFogCol.value.copy(fog.color);
      this.uniforms.uFogD.value = fog.density;
    }
    const P = this.pivot;
    P.position.copy(apacheRoot.position);
    P.quaternion.copy(apacheRoot.quaternion);
    P.scale.copy(apacheRoot.scale);
    // 逐节点同步局部变换与可见性（旋翼/雷达/外挂离架/夜航灯闪）
    for (const [s, d] of this._dynPairs) {
      d.position.copy(s.position);
      d.quaternion.copy(s.quaternion);
      d.scale.copy(s.scale);
      d.visible = s.userData.noRefl ? false : s.visible;
    }
  }
}
