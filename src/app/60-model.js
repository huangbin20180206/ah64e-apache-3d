// ============================================================
// 60-model.js — 载入 GLB、绑定动画部件、涂装切换、爆炸视图、线框
// ============================================================

// three.js 的 GLTFLoader 用 PropertyBinding.sanitizeNodeName 处理节点名：
// 空白变下划线，. : / [ ] 直接删掉。配置表里写的是 Blender 原名，两种写法都试
const saneName = n => n.replace(/\s/g, '_').replace(/[\.\:\/\[\]]/g, '');

// P9 补强批：挂"面板接缝/铆钉/磨损/污渍"合成细节贴图的蒙皮材质。
// 运行时 UV 探针实证：Body 系列 UV 展开在大区（细节肉眼可读）；Glass/
// Exhaust/Front/Tail/Wing/LegPaint 的 UV 折叠在贴图右上角微小条带——
// 这些部件不在此表（靠独立贴图整体色差/材质对比表达，见 _applyVisualDetail）。
// 补强批实测校准：img0（Body+Tail+短翼 BODY.001 共用）是唯一大 UV 展开贴图
// （[0.05,0.95]×[0.45,0.95]），细节肉眼可读；img1/img2（Front/Back/Wing/
// LegPaint 共用）的 UV 退化到 <0.02 条带，画了也采样不到——只合成 img0 系
// 既保证主表面细节又最小化纹理上传（1×2048² vs 3×2048²，减小启动扰动）。
const SKIN_DETAIL_MATS = {
  'USMC_LowVis_Body': 1, 'USMC_LowVis_Tail': 1,
};

class Apache {
  constructor() {
    this.root = new THREE.Group();
    this.byName = new Map();
    this.mats = new Map();          // 材质名 -> 材质
    this.mainRotor = null;
    this.tailRotor = null;
    this.radar = null;
    this.armyDecals = [];
    this.usmcDecals = [];
    this.hellfire = [];
    this.gunParts = [];
    this.scheme = 'lowvis';
    this.armySkin = null;
    this.origin = new Map();        // 爆炸视图用：节点 -> 原始位置
    this.explodeDir = new Map();    // 节点 -> 单位外扩方向
    this._wire = false;
    // P9：高反射件 envI 倍率——座舱玻璃/传感器镜片/热端在统一 envI 之上再乘倍率，
    // 随环境联动（白天读出结构、夜间减弱），Body/Metal 等 boost=1 不破坏 P5-A/C 语义。
    this._envBoost = {
      'USMC_LowVis_Glass': 2.4,
      'USMC_LowVis_Radome_v2': 2.0,
      'USMC_LowVis_RadarHousing_v2': 1.6,
      'USMC_LowVis_Exhaust': 1.3,
    };
    // P9：分区 PBR 微调（克制：哑光军用而非塑料高光）——粗糙度/金属度差异化。
    // 同步写入 userData.lv 使涂装切换恢复 lowvis 时保留 P9 值（而非 GLB 原值）。
    this._visualTokens = {
      'USMC_LowVis_Glass':        { roughness: 0.14 },
      'USMC_LowVis_MissileWhite': { metalness: 0.2, roughness: 0.5 },
      'USMC_LowVis_Body':         { roughness: 0.70 },
      'USMC_LowVis_Front':        { roughness: 0.70 },
      'USMC_LowVis_Tail':         { roughness: 0.70 },
      'USMC_LowVis_Wing':         { roughness: 0.70 },
      'USMC_LowVis_Back':         { roughness: 0.70 },
      'USMC_LowVis_LegPaint':     { roughness: 0.70 },
      'USMC_LowVis_Exhaust':      { roughness: 0.35 },
    };
  }

  // 从 GLTF 结果里建立索引与层级绑定
  bind(gltf) {
    const src = gltf.scene;
    // 整机上抬，让轮胎正好落在 y=0
    src.position.y = MODEL_LIFT;
    this.root.add(src);
    this.src = src;

    src.traverse(o => {
      if (o.name) this.byName.set(o.name, o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = true;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          if (!m) continue;
          // 注意：GLTFLoader 拆多原语时会克隆材质，同名材质可能存在多份实例。
          // 按名 Map 存"首份"会导致涂装切换漏改其余份（表现为部分网格不变色）。
          // 改为按实例收集：同名的每份材质都存。
          if (!this.mats.has(m.name)) this.mats.set(m.name, []);
          const arr = this.mats.get(m.name);
          if (!arr.includes(m)) arr.push(m);
          // 备份低可视原始参数，切回来时恢复
          if (!m.userData.lv) {
            m.userData.lv = {
              color: m.color ? m.color.clone() : null,
              metalness: m.metalness,
              roughness: m.roughness,
              map: m.map || null,
            };
          }
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.envMapIntensity = 1.0;
        }
      }
    });

    this.mainRotor = this.get('MainRotor_Pivot');
    this.tailRotor = this.get('TailRotor_Pivot');
    this.radar = this.get('Radar_Pivot');

    const pick = names => names.map(n => this.get(n)).filter(Boolean);
    this.armyDecals = pick(PART_GROUPS.armyDecals);
    this.usmcDecals = pick(PART_GROUPS.usmcDecals);
    // 手动反馈第 2 批：GLB 原始 USMC 低可视贴花观感修正——必须在爆炸视图
    // 记录 origin 之前调用（Serial 位移进 origin，爆炸时不会跳回原位）
    this._fixLowvisMarking();
    this.hellfire = pick(PART_GROUPS.hellfire);
    this.rocketPods = pick(PART_GROUPS.rocketPod);
    this.gunParts = pick(PART_GROUPS.gun);

    // 爆炸视图：以机体中心为原点，各零件沿自身质心方向外扩。
    // 上层部件向天上散开，下层部件贴着地面散开，任何部件不得埋入地下
    // 注意：先刷新矩阵！否则包围盒取到未加 MODEL_LIFT 的原始坐标，
    // 贴地部件的 clamp 会被错误数值抬高。
    this.root.updateMatrixWorld(true);
    const center = new THREE.Vector3(0, 1.0, 0);
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    for (const [name, o] of this.byName) {
      if (!o.isMesh) continue;
      this.origin.set(o, o.position.clone());
      box.setFromObject(o);
      if (box.isEmpty()) { this.explodeDir.set(o, new THREE.Vector3()); continue; }
      box.getCenter(c);
      const d = c.clone().sub(center);
      if (d.lengthSq() < 1e-6) d.set(0, 0.5, 0);
      // 上方部件(质心高于机体中线)斜向上，下方部件贴地水平散开
      const up = c.y > 1.0 ? (c.y - 1.0) * 0.55 : 0;
      d.y = up;
      // 前后方向拉得更开，视觉上更像结构分解图
      if (d.lengthSq() < 1e-9) d.set(0, 1, 0);
      d.normalize().multiply(new THREE.Vector3(1.15, up > 0 ? 1.1 : 0.9, 1.35));
      // 硬约束：该部件包围盒最低点不得低于地面一分毫
      const bottom = box.min.y;
      if (d.y < 0.03 - bottom) d.y = 0.03 - bottom;
      this.explodeDir.set(o, d);
    }

    // 旋翼桨叶运动模糊：高速旋转时桨叶半透明（模拟视觉暂留）
    // 真实 289 RPM 下人眼无法分辨单片桨叶（只能看到模糊盘面），
    // 3D 渲染无运动模糊导致桨叶呈现离散位置（马车轮效应）。
    // 收集主旋翼全部网格材质（克隆避免影响共享同材质的其他部件），
    // loop() 里按转速 s 渐变透明度：满转速时降至 ~0.12
    this.bladeMats = [];
    if (this.mainRotor) {
      this.mainRotor.traverse(o => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 1;
          this.bladeMats.push(o.material);
        }
      });
    }

    // 默认低可视灰：force 一次，否则 scheme 初值相同会被短路，标识显隐不会生效
    this.setScheme('lowvis', true);
    // P9：分区 PBR 微调（在 setScheme 后应用，同步 lv 基线使涂装切换保留）
    this._applyVisualTokens();
    // P9 补强批：机身材质可见细节（接缝/铆钉/磨损/污渍/积碳/镜片）——
    // 延迟到加载关键路径之后（setTimeout 0）：合成 2048² 画布 + CanvasTexture
    // 上传是同步大块工作，若在 bind() 同步执行会整体后移页面启动时序，
    // 放大既有测试的时序竞态（A/B 实测：基线 edge_cases B2 toast 断言本身
    // 有 1/3 概率失败，本批同步合成使其变为必现——延迟后回到基线水平）。
    // 合成贴图存 userData.detailMap，涂装切换 lowvis 恢复时优先（见 setScheme）。
    this._detailTimer = setTimeout(() => { try { this._applyVisualDetail(); } catch (e) { console.error('detail map failed', e); } }, 0);
    return this;
  }

  // P9 补强批：给机身蒙皮材质合成"面板接缝/铆钉/磨损/污渍"细节贴图，
  // 排气口挂积碳贴图、光电塔镜片挂镜片渐变贴图。一次性生成（同名贴图
  // 只合成一次），零运行时增长；不改 GLB 几何、不新增外部资产。
  _applyVisualDetail() {
    // 蒙皮细节：Body/Tail 共享 img0（唯一大 UV 展开贴图），按原图缓存合成一次
    const skinCache = new Map();
    const SIZE = 2048;
    for (const [name, matList] of this.mats) {
      if (!SKIN_DETAIL_MATS[name]) continue;
      for (const m of matList) {
        const src = m.map && m.map.image;
        if (!src) continue;
        let detail = skinCache.get(src);
        if (!detail) {
          const base = grabSource(src, SIZE, SIZE);
          detail = makeSkinDetail(base, SIZE);
          skinCache.set(src, detail);
        }
        const t = new THREE.CanvasTexture(detail);
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false;              // glTF UV 约定（与 applyDecalTex 一致）
        t.anisotropy = 8;
        t.needsUpdate = true;
        m.map = t;
        m.userData.detailMap = t;     // 涂装恢复 lowvis 时优先（细节不丢）
        m.needsUpdate = true;
      }
    }
    // 排气口积碳：Exhaust UV 折叠（贴图整体色差），平铺贴图安全。
    // 同时提亮 lowvis 下的 Exhaust 基色（GLB 原色近黑 0.031，×亮烧蚀贴图
    // 仍被压成近黑，积碳层次丢失）→ 提至深棕 0.12 并同步 lv.color，
    // 涂装切换恢复 lowvis 时保留（首轮 rough 0.35/metal 0.72 不动）。
    const exMat = this.mats.get('USMC_LowVis_Exhaust');
    if (exMat) {
      const exTex = new THREE.CanvasTexture(makeExhaustCrust(512));
      exTex.colorSpace = THREE.SRGBColorSpace;
      exTex.wrapS = exTex.wrapT = THREE.RepeatWrapping;
      exTex.flipY = false;
      exTex.needsUpdate = true;
      for (const m of exMat) {
        m.map = exTex;
        m.userData.detailMap = exTex;
        if (m.color) {
          m.color.setRGB(0.16, 0.13, 0.11);          // 深棕烧蚀基色（×亮烧蚀贴图）
          if (m.userData.lv && m.userData.lv.color) m.userData.lv.color.setRGB(0.16, 0.13, 0.11);
        }
        m.needsUpdate = true;
      }
    }
    // 光电塔镜片：lens UV 小区域，镜片渐变贴图（明暗反射梯度）
    const lensMat = this.mats.get('lens');
    if (lensMat) {
      const lensTex = new THREE.CanvasTexture(makeLensFace(512));
      lensTex.colorSpace = THREE.SRGBColorSpace;
      lensTex.flipY = false;
      lensTex.needsUpdate = true;
      for (const m of lensMat) {
        m.map = lensTex;
        m.userData.detailMap = lensTex;
        m.needsUpdate = true;
      }
    }
    // 诊断值（供 visualTokens()/__dbg/测试——只读数值，不解析渲染截图）：
    // 画布哈希=采样 8 个固定像素点合成 16 位摘要，证明细节层真实生成；
    // 同参数刷新可复现（固定种子）。
    let hash = '';
    const first = skinCache.values().next().value;
    if (first) {
      const x2 = first.getContext('2d');
      const pts = [[64, 64], [1024, 1024], [1800, 400], [900, 1600],
                   [300, 1400], [1500, 700], [512, 512], [1600, 1700]];
      for (const [px, py] of pts) {
        const d = x2.getImageData(px, py, 1, 1).data;
        hash += ((d[0] * 31 + d[1] * 17 + d[2] * 7) % 251).toString(16).padStart(2, '0');
      }
    }
    this._detailStats = {
      enabled: skinCache.size > 0,
      skins: skinCache.size,
      skinSize: SIZE,
      exhaust: !!exMat,
      lens: !!lensMat,
      hash,
    };
  }

  // P9：分区 PBR 微调——粗糙度/金属度差异化（克制哑光军用，非塑料高光）。
  // 同步写入 userData.lv：涂装切换恢复 lowvis 时用 P9 值而非 GLB 原值；
  // army 涂装走 ARMY_OVERRIDE 独立表，不受影响。
  _applyVisualTokens() {
    for (const [name, arr] of this.mats) {
      const tok = this._visualTokens[name];
      if (!tok) continue;
      for (const m of arr) {
        if (tok.metalness !== undefined) m.metalness = tok.metalness;
        if (tok.roughness !== undefined) m.roughness = tok.roughness;
        if (m.userData.lv) {
          if (tok.metalness !== undefined) m.userData.lv.metalness = tok.metalness;
          if (tok.roughness !== undefined) m.userData.lv.roughness = tok.roughness;
        }
        m.needsUpdate = true;
      }
    }
  }

  // P9：材质诊断值（供 __dbg 与测试——只读数值，不解析渲染截图）
  visualTokens() {
    const g = n => {
      const l = this.mats.get(n);
      return l && l[0] ? { envI: +l[0].envMapIntensity.toFixed(3),
                           rough: +l[0].roughness.toFixed(2),
                           metal: +l[0].metalness.toFixed(2) } : null;
    };
    // P9 补强批：可见细节诊断——开关/尺寸/哈希/合成数，供测试数值断言
    // （不解析渲染截图）。_detailStats 由 _applyVisualDetail 填充；合成
    // 延迟到加载后执行，未完成时返回 enabled:false（不崩、不抛）。
    const ds = this._detailStats || { enabled: false, skins: 0, skinSize: 0, exhaust: false, lens: false, hash: '' };
    return { glass: g('USMC_LowVis_Glass'), missile: g('USMC_LowVis_MissileWhite'),
             body: g('USMC_LowVis_Body'), exhaust: g('USMC_LowVis_Exhaust'),
             boost: this._envBoost,
             detail: ds };
  }

  // 按 Blender 原名取节点，自动兼容 loader 的字符替换
  get(name) {
    return this.byName.get(name) || this.byName.get(saneName(name)) || null;
  }

  // 手动反馈第 2 批：GLB 原始 USMC 低可视贴花观感修正（用户实测"两种涂装串
  // 一起、相互覆盖"——诊断结论：非状态串扰（切换经像素验证 0.033% 无残留），
  // 而是模型贴花设计缺陷——MARINES 与尾号间隙仅 0.15u 视觉粘连 + Marking
  // 材质 0x303635（灰绿）与浅灰机身形成"绿色标志贴灰机身"混搭感）。
  // 修正：① Marking 颜色压到纯深灰（low-vis gray-on-gray 史实）；
  // ② 尾号组整体后移 0.15u，MARINES/尾号 间隙 0.15→0.30u。
  _fixLowvisMarking() {
    const arr = this.mats.get('USMC_LowVis_Marking');
    if (arr) for (const m of arr) {
      if (!m.color || !m.userData.lv) continue;
      m.color.setHex(0x1e2121);                                  // (30,33,33) 低可视深灰
      if (m.userData.lv.color) m.userData.lv.color.setHex(0x1e2121);   // 切换保留
      m.needsUpdate = true;
    }
    for (const o of this.usmcDecals) {
      if (o.name && o.name.indexOf('USMC_Serial') === 0) o.position.z -= 0.15;
    }
  }

  setArmySkin(t) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;                   // 与 glTF 的 UV 约定一致
    t.anisotropy = 8;
    t.needsUpdate = true;
    this.armySkin = t;
    if (this.scheme === 'army') this.setScheme('army', true);
  }

  setScheme(key, force = false) {
    if (key === this.scheme && !force) return;
    this.scheme = key;
    const army = key === 'army';

    for (const [name, matList] of this.mats) {
      const ov = ARMY_OVERRIDE[name];
      for (const m of matList) {
        const lv = m.userData.lv;
        if (!lv) continue;
        if (army && ov) {
          if (m.color) m.color.setRGB(...ov.color);
          m.metalness = ov.metal;
          m.roughness = ov.rough;
          if (ov.skin && this.armySkin) m.map = this.armySkin;
        } else {
          if (m.color && lv.color) m.color.copy(lv.color);
          if (lv.metalness !== undefined) m.metalness = lv.metalness;
          if (lv.roughness !== undefined) m.roughness = lv.roughness;
          // P9 补强批：lowvis 恢复优先 detailMap（合成细节贴图）——
          // 若仅恢复 lv.map（GLB 原纯色底漆）会丢掉接缝/铆钉/积碳细节。
          m.map = m.userData.detailMap || lv.map;
        }
        m.needsUpdate = true;
      }
    }
    for (const o of this.armyDecals) o.visible = army;
    for (const o of this.usmcDecals) o.visible = !army;

    // 美军绿：GLB 内嵌的 Army 贴花是全彩/点阵风格，换成史实 subdued 贴图；
    // 星徽 = 原贴图灰度化（形状/UV 原样保留）；
    // 文字 = 按 UV 包围盒自适应绘制（两侧自动判镜像，实心圆角字）
    if (army && !this._subduedDone) {
      for (const n of ['Decal_Star_L', 'Decal_Star_R', 'Decal_Text_L', 'Decal_Text_R', 'TailNum_L', 'TailNum_R']) {
        const mesh = this.get(n);
        if (!mesh) continue;
        if (n.startsWith('Decal_Star')) {
          const cv = subduedFromTexture(mesh.material.map);
          if (cv) applyDecalTex(mesh, cv);
        } else if (n.startsWith('Decal_Text')) {
          applyDecalTex(mesh, makeDecalText(mesh, 'U.S. ARMY'));
        } else {
          applyDecalTex(mesh, makeDecalText(mesh, '03-05377'));
        }
      }
      this._subduedDone = true;
    }
  }

  setExplode(t) {
    // 批 E 阴影代理：分解态各节点外移，烘焙代理不再贴合 → 退回逐 mesh 投影
    if (this._shadowProxy) this._setProxyActive(!(t > 0.01));
    for (const [o, p0] of this.origin) {
      const d = this.explodeDir.get(o);
      if (!d) continue;
      o.position.copy(p0).addScaledVector(d, t * 2.4);
    }
  }

  setWireframe(on) {
    this._wire = on;
    for (const matList of this.mats.values()) {
      for (const m of matList) {
        m.wireframe = on;
        m.needsUpdate = true;
      }
    }
  }

  setWeapons({ hellfire, rockets, gun, radar }) {
    if (hellfire !== undefined) for (const o of this.hellfire) o.visible = hellfire;
    if (rockets !== undefined) for (const o of this.rocketPods) o.visible = rockets;
    if (gun !== undefined) for (const o of this.gunParts) o.visible = gun;
    if (radar !== undefined && this.radar) this.radar.visible = radar;
  }

  setShadows(on) {
    this._shadowOn = on;
    this.src.traverse(o => { if (o.isMesh) o.castShadow = on; });
    if (this._shadowProxy) this._setProxyActive(this._proxyActive);
  }

  // ---------- 批 E（PERF C 项补漏）：机体阴影代理 ----------
  // 整机 ~80 mesh 每个都进阴影 pass（每帧 ~79 draw，四场地 draw 的大头）。
  // 阴影深度 pass 只要位置：同一宿主下的 mesh 烘焙成只投影的合并体（只在阴影
  // pass 里画，主 pass drawRange=0 不出 draw），原 mesh 关掉 castShadow。
  // 会动/会显隐的子树（旋翼/雷达/挂架/贴花）各自一个代理挂在子树根下，跟随
  // 转动与显隐；夜航灯组不碰。分解视图时整体退回逐 mesh 投影。
  // 须在 refl.bind 之后调用（倒影深拷贝 root，不能把代理也拷进去）。
  buildShadowProxy(dynRoots) {
    if (this._shadowProxy) return 0;
    // 宿主节点：null = 机体静态部分（代理挂 root）；其余为会自己动/会显隐的
    // 子树根（旋翼/尾桨/雷达/每枚地狱火/火箭巢/机炮/涂装贴花）——代理挂在
    // 该节点下、用其局部坐标烘焙，于是跟着它转、跟着它隐藏（发射/卸挂/换涂装）。
    const hosts = new Set();
    const add = o => { if (o) hosts.add(o); };
    add(this.mainRotor); add(this.tailRotor); add(this.radar);
    for (const nm of [].concat(PART_GROUPS.armyDecals, PART_GROUPS.usmcDecals,
                               PART_GROUPS.hellfire, PART_GROUPS.rocketPod, PART_GROUPS.gun)) add(this.get(nm));
    for (const list of [this.hellfire, this.rocketPods, this.gunParts]) for (const o of (list || [])) add(o);
    // 夜航灯组等外部子树完全不碰（自发光材质/逐帧闪烁，保持逐 mesh）
    const skip = new Set();
    if (dynRoots) for (const r of dynRoots) if (r && r.traverse) r.traverse(c => skip.add(c));
    const hostOf = o => { for (let p = o; p && p !== this.root; p = p.parent) if (hosts.has(p)) return p; return null; };
    // 可见性只看宿主以下那一段：宿主自身的显隐由代理挂载关系自动跟随
    const visTo = (o, h) => { for (let p = o; p && p !== h && p !== this.root; p = p.parent) if (!p.visible) return false; return true; };
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
    // 分桶：宿主 × 索引有无（mergeGeos 要求一致）× 材质面向（双面材质投影两面，
    // 单面只投背面——与 three 阴影 pass 对原材质的 shadowSide 推导一致）
    const buckets = new Map();
    this.src.traverse(o => {
      if (!o.isMesh || skip.has(o) || !o.castShadow || o.userData.noRefl) return;
      if (o.isSkinnedMesh || o.isInstancedMesh || o.morphTargetInfluences) return;
      const src = o.geometry;
      if (!src || !src.attributes.position) return;
      const h = hostOf(o);
      if (!visTo(o, h || this.root)) return;
      const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
      const side = m0 && m0.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide;
      const key = (h ? h.uuid : 'root') + (src.index ? 'i' : 'n') + side;
      let b = buckets.get(key);
      if (!b) { b = { host: h, geos: [], nodes: [], side }; buckets.set(key, b); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      if (src.index) g.setIndex(src.index.clone());
      inv.copy((h || this.root).matrixWorld).invert();
      rel.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(rel);
      b.geos.push(g); b.nodes.push(o);
    });
    this._shadowProxy = [];
    this._shadowStatic = [];
    for (const b of buckets.values()) {
      if (b.geos.length < 2) continue;      // 单个 mesh 合了也省不下 draw
      const mg = mergeGeos(b.geos);
      if (!mg) continue;                      // 保底：该桶保持逐 mesh 投影
      mg.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: b.side });
      mat.name = 'shadowProxy';
      const m = new THREE.Mesh(mg, mat);
      m.name = 'ShadowProxy';
      m.castShadow = true; m.receiveShadow = false;
      m.userData.noRefl = true;
      m.raycast = () => {};                   // 不参与拾取（部件点选/射线贴附）
      // 平时 drawRange 为 0：主 pass / 景深等后处理 pass 都不画它（零顶点开销）；
      // 只在阴影 pass 前后打开（three r16x 的 onBeforeShadow/onAfterShadow 钩子）
      mg.setDrawRange(0, 0);
      m.onBeforeShadow = () => { mg.drawRange.count = Infinity; };
      m.onAfterShadow = () => { mg.drawRange.count = 0; };
      (b.host || this.root).add(m);
      this._shadowProxy.push(m);
      this._shadowStatic.push(...b.nodes);
    }
    if (this._shadowOn === undefined) this._shadowOn = true;
    this._setProxyActive(true);
    return this._shadowStatic.length;
  }

  _setProxyActive(on) {
    this._proxyActive = on;
    const sh = this._shadowOn !== false;
    for (const m of this._shadowProxy) { m.visible = on && sh; m.castShadow = sh; }
    for (const o of this._shadowStatic) o.castShadow = sh && !on;
  }

  // P5-A(C)+P5-B(C)：机体环境反射强度随环境预设联动——夜间降低、黄昏中间值。
  // P5-B 调优：0.25+hemi×1.4 → 0.12+hemi×1.6（clamp 0.15,1.0）——night 反射
  // 0.418→0.312（夜 PMREM 面板亮度 ~0.67 下旧值仍偏亮，易读成"机体反射发白"），
  // dusk 0.698→0.632；day/studio 仍收敛 1.0 与原值一致。仅切换事件调用，
  // 不进 loop、零逐帧材质扫描；无 envMapIntensity 属性的材质（如 MeshBasic）
  // 自动跳过不报错；不触碰 color/metal/rough/map——涂装备份恢复语义零影响。
  setEnvIntensity(P) {
    const v = clamp(0.12 + P.hemi * 1.6, 0.15, 1.0);
    for (const [name, matList] of this.mats) {
      // P9：高反射件（座舱玻璃/传感器/热端）乘 _envBoost 倍率——随环境联动
      //（白天强/夜间弱，读出结构）；Body/Metal boost=1 保持 P5-A/C 语义。
      const boost = this._envBoost[name] || 1;
      for (const m of matList) {
        if (m && ('envMapIntensity' in m)) m.envMapIntensity = v * boost;
      }
    }
  }
}

// 旋翼盘：转速高时用一张半透明圆盘掩盖桨叶闪频
// inner 中心孔比例（2026-09-19 0.18→0.30）：近黑残影环 depthWrite:false+renderOrder:5，
// 满转速会盖在中央"桅杆→桨毂→长弓雷达罩"竖轴的屏幕投影上，把它们混暗（用户实测
// "机翼轴变透明、雷达罩与机身脱节"）。扩孔让环只覆盖桨叶张开的外圈——真实旋翼运动
// 模糊本就集中在高线速度的外段，中央桨毂相对清晰可见，物理正确且中央竖轴不再被压暗。
function makeRotorDisc(radius, inner = 0.30) {
  const g = new THREE.RingGeometry(radius * inner, radius, 96, 1);
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(0x0d1113) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying float vR;
      void main(){
        vUv = uv;
        vR = length(position.xy);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      varying float vR;
      uniform float uOpacity, uTime;
      uniform vec3 uTint;
      void main(){
        // 沿周向的低频条纹，模拟桨叶残影
        float a = atan(vUv.y - 0.5, vUv.x - 0.5);
        float band = 0.55 + 0.45 * sin(a * 4.0 + uTime * 6.0);
        // 外缘更实（线速度高），内缘透出桨毂
        float rad = smoothstep(0.10, 0.62, vUv.y);
        float al = uOpacity * (0.28 + 0.72 * band) * (0.35 + 0.65 * rad);
        gl_FragColor = vec4(uTint, clamp(al, 0.0, 1.0));
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -PI / 2;
  mesh.renderOrder = 5;
  mesh.visible = false;
  return mesh;
}
