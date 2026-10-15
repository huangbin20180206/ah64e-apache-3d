// ============================================================
// 62-detailparts.js — P10 重点部件细节件（受控低模增量）
// ============================================================
// Phase 10（修正批后）：在 P9 材质细节基础上，为近景最薄弱区域补充"几何级"机械层次。
//   **修正批（2026-09-08，总指挥接管返修）**：首轮 turret.glb 因轴向错位（两枚直径 1 米的
//   环沿垂直方向叠放）导致世界包围盒高 2.17 单位（约 4m）、最低点低于地面 0.24 单位
//   （约 45cm），实拍为机首大铁环并插入地面——**已整件删除**；gun.glb 的供弹箱图元
//   （P10_MetalDark）悬于机腹下方 0.24 单位无接触面，**已从该 GLB 中剔除**，仅保留贴合
//   炮管的炮口箍（P10_Steel，包围盒 0.19³ 完全落在炮管 bbox 内）。
//   现役细节件两个：30mm 链炮炮口箍（gun.glb）、主轮毂/刹车盘（wheels.glb）。
//   **机首几何细节：受限未做（2026-09-09 重做批）**——宿主 Cylinder019 实测为复合件
//   （宽扁安装板 + 球 + 杆，原验收存档 docs/ai-reviews/phase-10-apache-nose-detail/ 见 tag archive/pre-cleanup-2026-10-12），
//   **无圆柱面可箍**：尝试的双箍环虽满足世界 bbox 约束（D2 全过），但内表面与宿主
//   实际几何零接触（B 环 y 向间隙 0.138、A 环 x 向间隙 0.055 单位），近景呈悬浮异物，
//   按指令"一次为限、不达标即弃"删除该件（assets/details/nose.glb 未入库）。
// 资产来源（可复现）：Blender 5.2 LTS CLI 以 apache_v2.glb 为背景参考程序化
// 生成（tools/blender_p10_gen.py），坐标与主 GLB 同 glTF 原始系，组内合并单
// mesh（每组 +1 draw call）。高模/源 .blend 绝不进入 dist——dist 只有这两个
// 轻量低模 GLB（gun 1408 顶点/56KB、wheels 696 顶点/27KB）。
//
// 挂载策略：直接 add 到 apache.src（与主 GLB 同层，src.position.y=MODEL_LIFT
// 已统一抬升）——细节件文件坐标即主模型文件坐标，零换算对齐；随 root 旋转/
// 起降整体运动。材质按名并入 apache.mats：自动继承 setScheme/_applyVisualTokens/
// setEnvIntensity/setWireframe 的 P9 语义（第三方涂装切换 natural）。
//
// 质量档（指令 §5）：低档（<1）加载路径明确降级——不加载细节件；运行时切档
// 低→高补加载、高→低隐藏（不假装降级）。加载失败回退：不影响场景，__dbg 报告。
// 生命周期：仅构造时加载一次；场地/任务切换不重建（细节件是机身静态附件）。

// P10 细节件清单（url -> 说明）。坐标与主 GLB 同系（已离线验证:_verify_p10_coords）
// 注：机首件在重做批中尝试后弃用（宿主无圆柱面，箍环悬浮）——不在此清单内。
const DETAIL_MANIFEST = [
  { url: 'assets/details/gun.glb',    label: '30mm 链炮炮口箍' },
  { url: 'assets/details/wheels.glb', label: '主轮毂/刹车盘' },
];

class DetailParts {
  constructor(apache) {
    this.apache = apache;
    this.scenes = [];               // 已加载并挂载的 scene（可见与否按质量档）
    this.state = {
      total: DETAIL_MANIFEST.length,
      loaded: 0,
      fallback: false,              // 任一加载失败 → true（保持主场景完整）
      error: '',
      tris: 0,                      // 实际挂载三角形数
      quality: 0,                   // 当前生效档（0=未决定）
    };
    this._loaders = null;           // 加载 Promise
  }

  // 画质档门控：q<1 不加载（加载路径降级）；1 档加载全部。
  setQuality(q) {
    this.state.quality = q;
    const on = q >= 1;
    for (const s of this.scenes) s.visible = on;
    if (on && !this._loaders) this._loaders = this._loadAll();
    return this.state;
  }

  // 加载并挂载全部细节件（异步，失败单件 skips 不破坏场景）
  async _loadAll() {
    const loader = new THREE.GLTFLoader();
    const cmpTris = o => {
      let t = 0;
      o.traverse(m => {
        if (!m.isMesh || !m.geometry) return;
        const g = m.geometry;
        t += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
      });
      return Math.round(t);
    };
    for (const item of DETAIL_MANIFEST) {
      try {
        const gltf = await new Promise((res, rej) => loader.load(item.url, res, undefined, rej));
        const scene = gltf.scene;
        // 材质并入 apache.mats：复用 P9 setScheme/_applyVisualTokens/env 语义
        scene.traverse(o => {
          if (!o.isMesh || !o.material) return;
          const list = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of list) {
            if (!m || !m.name) continue;
            if (!this.apache.mats.has(m.name)) this.apache.mats.set(m.name, []);
            const arr = this.apache.mats.get(m.name);
            if (!arr.includes(m)) arr.push(m);
            if (!m.userData.lv) {
              m.userData.lv = { color: m.color ? m.color.clone() : null,
                                metalness: m.metalness, roughness: m.roughness, map: m.map || null };
            }
          }
        });
        // 挂到整机容器（同 MODEL_LIFT 抬升系 → 文件坐标自动对齐）
        this.apache.src.add(scene);
        // 细节件是小件（护圈/支架/轮毂盘）：接收阴影但不投射——
        // 阴影 pass 会给每个 castShadow mesh 额外计 draw（实测 3 GLB 共 7 mesh
        // 在 q=1 pad 多出 ~14 draw call，超过性能预算 +8）；小件投影几乎不可见，
        // 且贴近机身时投影反而穿帮（悬空在轮侧/机腹的小件阴影）。receiveShadow
        // 保留让细节件被机身阴影正确覆盖。
        scene.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
        // P9 环境反射初始化（细节件并入 mats 后需手动同步一次；后续由 setEnv 事件驱动）
        this.apache.setEnvIntensity(ENV_PRESETS[HOST.S.env]);
        this.scenes.push(scene);
        this.state.loaded++;
        this.state.tris += cmpTris(scene);
      } catch (e) {
        this.state.fallback = true;
        this.state.error = (this.state.error ? this.state.error + '; ' : '') + item.url + ' -> ' + (e && e.message || e);
        // 预期回退路径：用 warn 级日志（fallback 是设计内行为，不污染 console.error 监控）
        console.warn('detail part load fallback (ok):', item.url, e && e.message || e);
      }
    }
    // 质量档门控再应用一次（防止加载期间被切低档）
    if (this.state.quality < 1) for (const s of this.scenes) s.visible = false;
    return this.state;
  }

  // __dbg 只读诊断（避开 this.state 数据属性，方法名用 stats）
  stats() {
    return { ...this.state, scenes: this.scenes.length, manifest: DETAIL_MANIFEST.map(m => m.url) };
  }
}