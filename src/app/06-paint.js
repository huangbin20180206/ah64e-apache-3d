// ============================================================
// 06-paint.js — 美军绿（US Army）史实涂装：FS 34031 + subdued 徽标
// 依据：TM 55-1500-345-23 陆军涂装手册、Cybermodeler AH-64 配色指南、
// DVIDS 2013 阿富汗实照——底色为极暗橄榄褐绿（暗部近黑、哑光）；
// 星徽/U.S. ARMY 字样/尾号一律深灰低可视（subdued），绝非全彩。
// ============================================================

// FS 34031 Helicopter Drab 的 sRGB 近似（暗室色卡 #3D3936 的受光观感修正，
// 偏暗橄榄褐，各蒙皮件带轻微色差模拟 CARC 喷涂不均）
const ARMY_OVERRIDE = {
  // —— 蒙皮大件（贴 army 蒙皮贴图的，颜色做乘法基调）——
  'USMC_LowVis_Body':  { color: [0.300, 0.310, 0.272], metal: 0.05, rough: 0.88, skin: true },
  'USMC_LowVis_Front': { color: [0.290, 0.302, 0.265], metal: 0.05, rough: 0.88, skin: true },
  'USMC_LowVis_Tail':  { color: [0.296, 0.306, 0.268], metal: 0.05, rough: 0.88, skin: true },
  'USMC_LowVis_Wing':  { color: [0.288, 0.300, 0.262], metal: 0.05, rough: 0.88, skin: true },
  'USMC_LowVis_Back':  { color: [0.262, 0.272, 0.238], metal: 0.05, rough: 0.88, skin: true },
  'USMC_LowVis_LegPaint': { color: [0.294, 0.304, 0.266], metal: 0.05, rough: 0.88, skin: true },
  // —— 非蒙皮件（不贴图，直接给 FS 34031 系深色）——
  'USMC_LowVis_Gun':          { color: [0.178, 0.186, 0.164], metal: 0.25, rough: 0.7, skin: false },
  'USMC_LowVis_MissileWhite': { color: [0.172, 0.180, 0.158], metal: 0.15, rough: 0.7, skin: false },
  'USMC_LowVis_WeaponDark':   { color: [0.172, 0.180, 0.158], metal: 0.15, rough: 0.7, skin: false },
  'USMC_LowVis_Bolts':        { color: [0.190, 0.198, 0.176], metal: 0.3,  rough: 0.6, skin: false },
  'USMC_LowVis_Rim':          { color: [0.180, 0.188, 0.168], metal: 0.3,  rough: 0.62, skin: false },
  'USMC_LowVis_Rotor':        { color: [0.130, 0.137, 0.122], metal: 0.2,  rough: 0.72, skin: false },
  'USMC_LowVis_RotorHub':     { color: [0.200, 0.210, 0.186], metal: 0.2,  rough: 0.68, skin: false },
  'USMC_LowVis_RotorLink':    { color: [0.206, 0.216, 0.190], metal: 0.2,  rough: 0.68, skin: false },
  'USMC_LowVis_Metal':        { color: [0.196, 0.206, 0.184], metal: 0.4,  rough: 0.55, skin: false },
  'USMC_LowVis_Exhaust':      { color: [0.150, 0.128, 0.110], metal: 0.35, rough: 0.58, skin: false },
  'USMC_LowVis_CanopyFrame':  { color: [0.132, 0.140, 0.126], metal: 0.2,  rough: 0.62, skin: false },
  'USMC_LowVis_Glass':        { color: [0.030, 0.038, 0.042], metal: 0.2,  rough: 0.35, skin: false },
  // —— Blender 默认名材质（挂架/炮体等，低可视下为浅灰/亮绿，美军绿须统一压暗）——
  'Material.001':  { color: [0.150, 0.158, 0.140], metal: 0.25, rough: 0.62, skin: false },
  'Material.002':  { color: [0.172, 0.180, 0.158], metal: 0.2,  rough: 0.66, skin: false },
  'Material.003':  { color: [0.172, 0.180, 0.158], metal: 0.2,  rough: 0.66, skin: false },
  'Material.004':  { color: [0.160, 0.168, 0.148], metal: 0.2,  rough: 0.66, skin: false },
  'Material':      { color: [0.130, 0.138, 0.122], metal: 0.25, rough: 0.6,  skin: false },
};
// 注：粗调亮度后视觉若偏暗可整体上浮；rough 0.88 体现 CARC 哑光。

  // —— subdued 徽标（基于 GLB 原贴图自适应处理，保证 UV 完全对位）——

  // 把原全彩贴图灰度化并压入暗灰区：形状/位置/UV 一律不动，只有颜色变为
  // subdued 单色系。分段映射拉开对比：背景融入机身暗色，白星/白条提为可辨浅灰，
  // 红条落中间调（实测原贴图：绿底 lum≈0.26、蓝描边≈0.19、红条≈0.37、白≈0.9）
  function subduedFromTexture(origTex) {
    const img = origTex && origTex.image;
    if (!img) return null;
    const W = img.width || 512, H = img.height || 512;
    const { c, x } = canvas2d(W, H);
    try { x.drawImage(img, 0, 0); } catch (e) { return null; }
    const id = x.getImageData(0, 0, W, H), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.30 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      let g;
      if (lum > 0.60) g = 0.42;        // 白星/白条 → 浅灰（低调但清晰可辨）
      else if (lum > 0.32) g = 0.33;   // 红条 → 中灰
      else g = 0;                      // 绿底/描边 → 透明（2026-10-20：旧值暗灰 0.235 在绿机身上是一块灰方牌）
      const v = g * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      if (g === 0) d[i + 3] = 0;
    }
    x.putImageData(id, 0, 0);
    return c;
  }

  // 在贴花上画文字——【不镜像】。此前反复回归的根：每次靠"看一侧截图"决定翻不翻，
  // 翻完这侧读正、另一侧又反，来回横跳。2026-09-19 用运行时 UV 探针 + 星徽管线双证
  // 终结此循环，结论确定：两侧都不镜像才对。
  //   ① UV 探针（tools/tests/_probe_decal_uv 同法）：机头朝 +Z、机尾朝 -Z。
  //      左舷(-X)观众屏幕右=+Z，Decal_Text_L 的 U:0→1 走 Z−2.1→−0.93（朝+Z=屏幕右）；
  //      右舷(+X)观众屏幕右=−Z，Decal_Text_R 的 U:0→1 走 Z−0.93→−2.1（朝−Z=屏幕右）。
  //      两侧 U 增大方向都指向各自观众的屏幕右 → 画布正向绘制即读正，无需镜像。
  //   ② 星徽铁证：subduedFromTexture 走同一条 applyDecalTex(flipY=false) 管线、从不镜像，
  //      方向一直正常；文字若多翻一次，就相对正确的星徽成了反的。同管线=同规约=不翻。
  function makeDecalText(mesh, text, opts = {}) {
    const W = opts.w || 512, H = opts.h || 128;
    const { c, x } = canvas2d(W, H);
    x.fillStyle = opts.color || '#4a4d47';
    const px = H * 0.62;
    x.font = `600 ${px}px ${opts.font || '"Segoe UI", Arial, sans-serif'}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, W / 2, H / 2);
    return c;
  }

  // 把 Canvas 换成材质贴到贴花 mesh 上（GLB UV 约定：flipY 必须 false）
  function applyDecalTex(mesh, canvas) {
    if (!mesh || !mesh.material || !canvas) return;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;                 // 与 GLB 内嵌贴图的 UV 约定一致！
    t.anisotropy = 8;
    t.needsUpdate = true;
    mesh.material.map = t;
    mesh.material.color.setRGB(1, 1, 1);
    mesh.material.needsUpdate = true;
  }

  // ---- P9 补强批：机身材质可见细节（接缝/铆钉/磨损/污渍/镜片/积碳） ----
  // 设计基线：GLB 蒙皮贴图（img0/1/2，2048²）是近乎纯色的底漆烘焙——
  // 首轮只做材质数值微调，正常第三人称距离看不出结构；本批在贴图空间
  // 叠加细节层。关键约束（运行时 UV 探针实证）：
  //   · Body 系列 UV 展开在大区 [0.05,0.95]×[0.45,0.95] → 细节画这里肉眼可读；
  //   · Glass/Exhaust/Front/Tail/Wing/LegPaint 的 UV 折叠在贴图右上角微小条带
  //     （<0.02 UV 宽，2048 贴图仅 ~40px）→ 贴图细节几乎不可见，这类部件靠
  //     独立贴图做整体色差（排气积碳）或材质对比（玻璃反射）表达；
  //   · 所有细节用固定种子 rnd()，同参数刷新可复现；一次性生成、缓存复用，
  //     零运行时增长（指令 §6）。

  // 把 GLB 内嵌贴图（ImageBitmap/HTMLImageElement/Canvas）画进 canvas。
  // 返回 null 表示取不到像素（不挂细节，保持原样）。
  function grabSource(img, W, H) {
    if (!img) return null;
    const { c, x } = canvas2d(W, H);
    try { x.drawImage(img, 0, 0, W, H); } catch (e) { return null; }
    return c;
  }

  // 蒙皮细节合成：原底漆贴图 + 面板接缝网格 + 铆钉点阵 + 边缘磨损 + 局部污渍。
  // 强度校准依据（hero 视角 dist≈12.6、机身投影约 340px 高、Body UV v 0.45→0.95
  // 覆盖机身高度 → 2048 贴图 1px ≈ 0.33px 屏幕）：
  //   10px 接缝线 → 3.3px 屏幕 / 28px 铆钉 → 9px 屏幕 / 磨损污渍斑 80-220px →
  //   26-73px。对比度校准（JPEG 1280 截图）：接缝 α0.5、磨损 α0.4、污渍 α0.45
  //   ——叠加后与底色差 12-15%，肉眼可读；间距保持克制（上限约束非下限）。
  function makeSkinDetail(srcCanvas, size) {
    const { c, x } = canvas2d(size);
    if (srcCanvas) x.drawImage(srcCanvas, 0, 0, size, size);
    else { x.fillStyle = '#8a8d90'; x.fillRect(0, 0, size, size); }
    const U = size;                       // 1.0 UV = size px
    // ---- 面板接缝（垂直线）：面板宽 0.085-0.13 UV + 抖动 ----
    x.strokeStyle = 'rgba(18,20,22,0.52)';
    x.lineWidth = Math.max(4, U * 0.005);
    let v = 0.05 + rnd() * 0.03;
    while (v < 0.96) {
      const jx = rnd(-0.014, 0.014);
      x.beginPath();
      x.moveTo((v + jx) * U, 0.40 * U);
      x.lineTo((v + jx) * U, 0.99 * U);
      x.stroke();
      v += 0.085 + rnd(0.0, 0.045);
    }
    // ---- 面板接缝（水平线）：面板高 0.075-0.115 UV + 抖动 ----
    let h = 0.45 + rnd() * 0.02;
    while (h < 0.95) {
      const jy = rnd(-0.014, 0.014);
      x.beginPath();
      x.moveTo(0.02 * U, (h + jy) * U);
      x.lineTo(0.99 * U, (h + jy) * U);
      x.stroke();
      h += 0.075 + rnd(0.0, 0.04);
    }
    // ---- 铆钉：沿接缝线两侧排布 + 独立检修口铆钉（成排阵列、高光边）----
    const rivet = (px, py, r) => {
      const g = x.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
      g.addColorStop(0, 'rgba(230,234,238,0.85)');   // 顶部高光（强）
      g.addColorStop(0.45, 'rgba(108,112,116,0.85)');
      g.addColorStop(1, 'rgba(8,10,12,0.95)');       // 外缘暗
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
    };
    const R = Math.max(5, U * 0.0085);      // ~17px @2048 → 5.6px 屏幕（hero）
    // 垂直线两侧各一列
    for (let vv = 0.085; vv < 0.95; vv += 0.10) {
      for (let hh = 0.46; hh < 0.95; hh += 0.052) {
        rivet((vv - 0.013) * U, hh * U, R);
        rivet((vv + 0.013) * U, hh * U, R);
      }
    }
    // 水平线下方一列（略稀疏）
    for (let hh = 0.46; hh < 0.94; hh += 0.085) {
      for (let vv = 0.10; vv < 0.94; vv += 0.060) {
        rivet(vv * U, (hh - 0.015) * U, R);
      }
    }
    // 独立检修口铆钉：面板中部成组（模拟维护舱门锁扣点阵）
    for (let i = 0; i < 16; i++) {
      const px = (0.09 + rnd() * 0.82) * U, py = (0.47 + rnd() * 0.46) * U;
      rivet(px, py, R * 0.85);
      if (rnd() < 0.5) rivet(px + 0.018 * U, py, R * 0.85);
    }
    // ---- 边缘磨损：随机亮斑（漆面磨损露浅色底），半径 70-180px、α0.4 ----
    for (let i = 0; i < 12; i++) {
      const wx = (0.10 + rnd() * 0.80) * U, wy = (0.47 + rnd() * 0.46) * U;
      const wr = U * (0.035 + rnd() * 0.055);
      const g = x.createRadialGradient(wx, wy, 0, wx, wy, wr);
      g.addColorStop(0, 'rgba(192,196,200,0.40)');
      g.addColorStop(0.5, 'rgba(192,196,200,0.18)');
      g.addColorStop(1, 'rgba(192,196,200,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(wx, wy, wr, 0, TAU); x.fill();
    }
    // ---- 局部污渍（油渍/泥渍），半径 60-200px、α0.45 内克制 ----
    for (let i = 0; i < 9; i++) {
      const sx = (0.08 + rnd() * 0.84) * U, sy = (0.46 + rnd() * 0.48) * U;
      const sr = U * (0.030 + rnd() * 0.070);
      const g = x.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(22,18,14,${(0.38 + rnd() * 0.14).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(22,18,14,${(0.16 + rnd() * 0.10).toFixed(3)})`);
      g.addColorStop(1, 'rgba(22,18,14,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(sx, sy, sr, 0, TAU); x.fill();
    }
    return c;
  }

  // 排气口积碳/烧蚀贴图（平铺安全）：亮暖灰烧蚀底 + fbm 噪声 + 深积碳斑 +
  // 氧化亮纹。挂在 Exhaust 材质上（UV 折叠→整体色差）。albedo=color×map
  // 在线性域相乘：color(0.16,0.13,0.11)×map 亮底(#b3a294→linear 0.46/0.37/0.30)
  // = sRGB 深棕(≈#4D3D31)可见；积碳斑→近黑炭、氧化亮纹→亮棕，三层层次。
  // 底色不能太暗（第一版 #8a7664 仍被乘成近黑，第二版实测调整）。
  function makeExhaustCrust(size) {
    const { c, x } = canvas2d(size);
    x.fillStyle = '#b3a294';                 // 亮烧蚀暖灰底
    x.fillRect(0, 0, size, size);
    fbmInto(x, size, size, { octaves: 5, base: 4, alpha: 0.6, mode: 'overlay' });
    // 积碳斑：深炭斑（燃油不完全燃烧沉积），alpha 高些形成层次
    for (let i = 0; i < 32; i++) {
      const sx = rnd(size), sy = rnd(size);
      const sr = rnd(size * 0.02, size * 0.11);
      const g = x.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(22,16,12,${(0.42 + rnd() * 0.32).toFixed(3)})`);
      g.addColorStop(1, 'rgba(22,16,12,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(sx, sy, sr, 0, TAU); x.fill();
    }
    // 烧蚀亮纹：高温区边缘的金属氧化浅斑
    for (let i = 0; i < 16; i++) {
      const sx = rnd(size), sy = rnd(size);
      const sr = rnd(size * 0.015, size * 0.06);
      const g = x.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(216,192,168,${(0.18 + rnd() * 0.20).toFixed(3)})`);
      g.addColorStop(1, 'rgba(216,192,168,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(sx, sy, sr, 0, TAU); x.fill();
    }
    return c;
  }

  // 光电塔镜片贴图：上半亮（天光反射）下半暗（镜面本色）的水平渐变 + 微噪声
  // + 左上方高光弧。挂在 lens 材质上——该部件 UV 集中在
  // [0.467,0.542]×[0.528,0.612] 小区域，贴图呈现为"镜片有明暗反射梯度"
  // 而非平板色块，与机框形成可读边界；夜间无 emissive 不发光。
  function makeLensFace(size) {
    const { c, x } = canvas2d(size);
    const g = x.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, 'rgba(150,162,184,1)');     // 上缘天光反射（亮）
    g.addColorStop(0.35, 'rgba(64,72,92,1)');
    g.addColorStop(1, 'rgba(12,16,24,1)');        // 下缘镜面深色
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    // 微噪声破坏纯渐变（不是平板）
    const n = noiseCanvas(128);
    x.globalAlpha = 0.20;
    x.globalCompositeOperation = 'overlay';
    x.drawImage(n, 0, 0, size, size);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    // 左上高光弧：模拟球面镜片反光点（增强，近距可读）
    const hx = size * 0.30, hy = size * 0.28, hr = size * 0.24;
    const hg = x.createRadialGradient(hx, hy, 0, hx, hy, hr);
    hg.addColorStop(0, 'rgba(205,215,235,0.55)');
    hg.addColorStop(1, 'rgba(205,215,235,0)');
    x.fillStyle = hg;
    x.beginPath(); x.arc(hx, hy, hr, 0, TAU); x.fill();
    return c;
  }
