// ============================================================
// 15-terrain.js — 起降场地：停机坪（默认）/ 草地 / 湖面 / 沙漠
// 每套场地提供：近景地面材质（贴图+法线+粗糙度）+ 远景色调 + 雾色建议
//
// 贴图规则（踩过的坑）：地面贴图是 repeat 平铺的，任何"只该出现一次"的
// 大尺度特征（降落压痕圈、吹蚀坑）都不能烘进贴图 —— 会被复制成 N×N 份，
// 俯视立刻看出拼布。下洗痕迹一律交给 17-washfx.js 的 WashDecal 动态生成。
// 同理低频大斑块要压低对比，平铺缝才不明显；细节应以高频为主。
// ============================================================

// ---------- 草地：绿底 + 多色调软斑层 + 高频草丛噪声（P29 分层升级） ----------
function makeGrassGround(N = 1024) {
  const { c, x } = canvas2d(N);
  // 底色：中橄榄绿（略暖于旧版纯绿，给枯黄斑留融合空间）
  x.fillStyle = '#495630';
  x.fillRect(0, 0, N, N);

  // 软斑九宫格回绕（P29）：贴图是 repeat 平铺的，软斑跨边界被裁切会留
  // 直边硬缝——在 8 个邻位各补画一份，四个方向平铺都无缝。只回绕"大斑"
  //（划线/微粒太碎，裁切不可读，不值得 9 倍绘制量）。
  const wrapBlob = (px, py, rr, mid, comp) => {
    x.globalCompositeOperation = comp;
    for (let dx = -N; dx <= N; dx += N) {
      for (let dy = -N; dy <= N; dy += N) {
        const cx = px + dx, cy = py + dy;
        if (cx + rr < 0 || cx - rr > N || cy + rr < 0 || cy - rr > N) continue;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, mid);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill();
      }
    }
    x.globalCompositeOperation = 'source-over';
  };

  // —— 大尺度色层（P29：破"死板均匀绿"）：亮草甸 / 枯黄干草 / 冷深绿 ——
  // 对比度刻意压低（alpha≤0.18）且多层叠压：单斑不可辨认，合成后是
  // "整片草场有明暗有杂色"的读感，repeat 拼布感不出现。
  for (let i = 0; i < 26; i++) {         // 亮草甸：长势旺的浅色大块
    wrapBlob(rnd(N), rnd(N), rnd(N * 0.030, N * 0.065), 'rgba(116,138,64,0.16)', 'source-over');
  }
  for (let i = 0; i < 22; i++) {         // 枯黄斑：晒黄的干草杂色
    wrapBlob(rnd(N), rnd(N), rnd(N * 0.024, N * 0.052), 'rgba(164,142,74,0.18)', 'source-over');
  }
  for (let i = 0; i < 24; i++) {         // 冷深绿斑：背阴/湿润草丛
    wrapBlob(rnd(N), rnd(N), rnd(N * 0.026, N * 0.056), 'rgba(44,62,38,0.16)', 'multiply');
  }

  // 高频草色斑驳。base 大 = 频率高；alpha 必须小，否则低频八度会糊成
  // 大团亮斑（俯视像发霉的绿毯），细节感全靠后面的草叶划线
  fbmInto(x, N, N, { octaves: 4, base: 26, alpha: 0.14 });
  // 深绿斑块：数量多、单块小、透明度低，避免出现可辨认的大团
  x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 220; i++) {
    const px = rnd(N), py = rnd(N), rr = rnd(N * 0.010, N * 0.032);
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, 'rgba(58,74,40,0.20)');
    g.addColorStop(1, 'rgba(58,74,40,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  // 草叶短划线：密而细，这是抵抗平铺感的主力（P29：三档色扩五档 + 加量）
  for (let i = 0; i < 33000; i++) {
    const px = rnd(N), py = rnd(N), ln = rnd(N * 0.002, N * 0.008), a = rnd(TAU);
    // 五档色：亮干草 / 黄绿 / 中绿 / 深绿 / 冷青绿，混出杂色层次
    const k = rnd();
    x.strokeStyle = k < 0.20 ? 'rgba(158,150,94,0.26)'
                  : k < 0.42 ? 'rgba(128,140,70,0.26)'
                  : k < 0.72 ? 'rgba(92,116,56,0.26)'
                  : k < 0.90 ? 'rgba(52,72,36,0.26)'
                             : 'rgba(58,86,60,0.22)';
    x.lineWidth = Math.max(1, N / 1100);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * ln, py + Math.sin(a) * ln);
    x.stroke();
  }
  // 枯草秆（P29）：少量更长的浅黄划线，近看有麦秆类杂物点缀
  for (let i = 0; i < 2600; i++) {
    const px = rnd(N), py = rnd(N), ln = rnd(N * 0.006, N * 0.014), a = rnd(TAU);
    x.strokeStyle = rnd() < 0.6 ? 'rgba(172,156,96,0.22)' : 'rgba(150,132,80,0.18)';
    x.lineWidth = Math.max(1, N / 1400);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * ln, py + Math.sin(a) * ln);
    x.stroke();
  }
  // 裸土小块（草不是铁板一块；P29：两种土色）
  for (let i = 0; i < 420; i++) {
    const px = rnd(N), py = rnd(N), rr = rnd(N * 0.003, N * 0.010);
    x.fillStyle = rnd() < 0.6 ? `rgba(104,92,66,${rnd(0.08, 0.20).toFixed(3)})`
                              : `rgba(122,106,78,${rnd(0.06, 0.16).toFixed(3)})`;
    x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill();
  }

  // 法线：草皮细颗粒
  const hcv = fbmCanvas(512, { octaves: 6, base: 10, alpha: 0.55 });
  const nrm = heightToNormal(hcv, 1.5);

  return {
    map: tex(c, { srgb: true, repeat: 5, aniso: 8 }),
    normalMap: tex(nrm, { repeat: 14 }),
  };
}

// ---------- 沙漠：高频风纹 + 迎风/落沙坡色差 + 微粒 ----------
// 大尺度起伏只由 duneH（下面、一次性作用在近景盘面的几何）承担，严禁烘进
// repeat 贴图；否则同一座沙丘会被复制成 N×N 个"印花丘"。这里的职责是近景：
// 以厘米级风纹、砂粒和微弱坡向色差让平整的吹蚀区也能读出沙面材质。
function makeDesertGround(N = 1024) {
  const { c, x } = canvas2d(N);
  x.fillStyle = '#c2a878';
  x.fillRect(0, 0, N, N);
  // 低对比底噪只做矿物色泽，不做可辨认的大色块，避免 repeat 变拼布。
  fbmInto(x, N, N, { octaves: 5, base: 34, alpha: 0.075 });

  // 风纹必须是【高频、准平行、轻微蛇行】的。整齐正弦线会像程序网格；
  // 因此每条只用小的双频相位扰动，并让每条纹的明暗/宽度略有差异。
  // 频率为整数周期，保证四边能无缝重复。
  const CY = 42;
  const wav = N / CY;
  const traceRipple = (off, color, width, alpha) => {
    x.strokeStyle = color;
    x.lineWidth = width;
    x.globalAlpha = alpha;
    for (let k = -1; k <= CY + 1; k++) {
      x.beginPath();
      for (let i = 0; i <= N; i += N / 160) {
        // i/N 的频率均取整数，横向跨 repeat 边界时位置/斜率连续
        const bend = Math.sin(i / N * TAU * 5 + off) * wav * 0.26
          + Math.sin(i / N * TAU * 11 - off * 1.7) * wav * 0.075;
        const y = k * wav + off * wav * 0.18 + bend;
        if (i === 0) x.moveTo(i, y); else x.lineTo(i, y);
      }
      x.stroke();
    }
  };
  // 迎风坡受太阳与细沙覆盖更亮；低凹槽留下稍深的粗颗粒。两者均只在毫米级
  // 尺度读出来，不能替 duneH 制造第二套宏观条纹。
  traceRipple(0.0, 'rgb(226,202,157)', Math.max(0.75, N / 1450), 0.20);
  traceRipple(1.8, 'rgb(126,101,67)', Math.max(0.65, N / 1700), 0.17);
  traceRipple(3.3, 'rgb(245,224,180)', Math.max(0.55, N / 2050), 0.10);
  x.globalAlpha = 1;

  // 坡向色差的贴图代理：短、断续的亮沙舌只画在风纹迎风侧。它们不是地形阴影，
  // 而是风选分级（细粒富集/粗粒裸露）的微弱反照率差，接住低空掠视的光。
  x.lineCap = 'round';
  for (let i = 0; i < 3800; i++) {
    const px = rnd(N), py = rnd(N), len = rnd(N * 0.003, N * 0.013);
    const a = rnd(-0.12, 0.12);   // 基本沿风纹方向，允许少量自然偏摆
    x.strokeStyle = rnd() < 0.68 ? 'rgba(238,216,171,0.15)' : 'rgba(112,89,59,0.10)';
    x.lineWidth = rnd(N * 0.00045, N * 0.0012);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  x.lineCap = 'butt';

  // 粗砂与矿物点：尺寸非常小、数量高，近看有粒感，远看融合为粗糙度变化。
  for (let i = 0; i < 7200; i++) {
    const px = rnd(N), py = rnd(N), r = rnd(N * 0.00035, N * 0.00145);
    x.fillStyle = rnd() < 0.64 ? 'rgba(112,89,59,0.18)' : 'rgba(244,221,176,0.14)';
    x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
  }

  // 法线不再是无方向 fBm。先画一张同向高频风纹高度图，再叠颗粒 fBm；
  // 颜色图和法线共用同一风纹语言，掠视时不会出现"颜色在流、表面是塑料"的割裂。
  const { c: hc, x: hx } = canvas2d(512);
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, 512, 512);
  const HCY = 58, hwav = 512 / HCY;
  for (let k = -1; k <= HCY + 1; k++) {
    hx.strokeStyle = k % 2 ? 'rgba(204,204,204,0.28)' : 'rgba(68,68,68,0.24)';
    hx.lineWidth = 1.05;
    hx.beginPath();
    for (let i = 0; i <= 512; i += 3) {
      const bend = Math.sin(i / 512 * TAU * 5) * hwav * 0.26
        + Math.sin(i / 512 * TAU * 11 - 1.7) * hwav * 0.075;
      const y = k * hwav + bend;
      if (i === 0) hx.moveTo(i, y); else hx.lineTo(i, y);
    }
    hx.stroke();
  }
  fbmInto(hx, 512, 512, { octaves: 5, base: 18, alpha: 0.22, mode: 'overlay' });
  const nrm = heightToNormal(hc, 1.65);

  return {
    map: tex(c, { srgb: true, repeat: 4, aniso: 8 }),
    normalMap: tex(nrm, { repeat: 10, aniso: 8 }),
  };
}

// ---------- 湖面：深水底色 + 湖床沉积斑 + 高频波光（P29） ----------
// 本贴图在湖面场景实际承担"湖床"角色（30-world 把它以 repeat×40 铺在
// WATER_Y-18u 的远景盘上，从 0.62 半透明水面下透出）——死平色会放大
// "一整块蓝塑料"的假感，沉积斑给水下一点可读的层次。
function makeWaterGround(N = 1024) {
  const { c, x } = canvas2d(N);
  // 深水蓝绿基底
  x.fillStyle = '#1d3a42';
  x.fillRect(0, 0, N, N);
  // 湖床沉积斑（P29）：深色腐殖斑 + 浅色淤沙斑，九宫格回绕保平铺无缝
  //（软斑跨贴图边界被裁切会留直边硬缝；对比较大尺度渐变靠回绕解决）
  const wrapBlob = (px, py, rr, mid, comp) => {
    x.globalCompositeOperation = comp;
    for (let dx = -N; dx <= N; dx += N) {
      for (let dy = -N; dy <= N; dy += N) {
        const cx = px + dx, cy = py + dy;
        if (cx + rr < 0 || cx - rr > N || cy + rr < 0 || cy - rr > N) continue;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, mid);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill();
      }
    }
    x.globalCompositeOperation = 'source-over';
  };
  for (let i = 0; i < 30; i++) {         // 腐殖暗斑：湖底腐叶沉积
    wrapBlob(rnd(N), rnd(N), rnd(N * 0.02, N * 0.05), 'rgba(18,44,44,0.34)', 'multiply');
  }
  for (let i = 0; i < 22; i++) {         // 淤沙亮斑：浅处沉积的细沙
    wrapBlob(rnd(N), rnd(N), rnd(N * 0.016, N * 0.04), 'rgba(96,132,124,0.20)', 'source-over');
  }
  // 波光碎点（高频噪声提亮）
  fbmInto(x, N, N, { octaves: 4, base: 20, alpha: 0.14, mode: 'screen' });
  // 波纹法线：低频大浪 + 高频涟漪双层
  const big = fbmCanvas(256, { octaves: 3, base: 4, alpha: 0.7 });
  const nrmBig = heightToNormal(big, 0.8);
  const fine = fbmCanvas(256, { octaves: 4, base: 10, alpha: 0.6 });
  const nrmFine = heightToNormal(fine, 1.7);

  return {
    map: tex(c, { srgb: true, repeat: 4, aniso: 8 }),
    normalMap: tex(nrmFine, { repeat: 9 }),   // 主法线用细涟漪
    normalMap2: tex(nrmBig, { repeat: 3 }),   // 大浪层（叠加用）
  };
}

// 场地定义表：地面材质工厂 + 远景地面色调 + 雾色/密度 + 下洗特效类型
const TERRAINS = {
  pad: {
    label: '停机坪',
    // 默认场景：沿用 makeHelipad 混凝土贴图，不重建
    farTint: 0xffffff,
    fog: null,          // null = 沿用环境预设的雾
    wash: 'dust',       // 水泥地扬尘
    water: false,
  },
  grass: {
    label: '草地',
    make: makeGrassGround,
    farTint: 0x59683d,
    fog: [0x9db7a0, 0.0050],
    wash: 'grass',      // 草浪 + 碎草叶
    water: false,
  },
  desert: {
    label: '沙漠',
    make: makeDesertGround,
    farTint: 0xcbb287,
    fog: [0xd8c4a0, 0.0034],
    wash: 'sand',       // 沙尘暴式浓沙
    water: false,
  },
  water: {
    label: '湖面',
    make: makeWaterGround,
    farTint: 0x2c4a52,
    fog: [0x8fb2bc, 0.0060],
    wash: 'spray',      // 水雾环 + 浪花
    water: true,
  },
};

// ---------- P5-A(D)：场地雾色 × 环境预设 协调 ----------
// 场地雾保留自己的密度（距离语义不变），颜色按固定权重混入当前环境预设的
// 雾色：夜间沙漠雾自然转暗、黄昏转暖，不再恒为日间场地色。无场地雾（pad）
// 完全沿用环境预设雾——既有行为不变。供 30-world（切场地）与 32-envpreset
// （切环境）两个入口共用，保证任一切换路径下雾色结果一致、fogBase 不漂移。
// P5-B(A)：权重 0.35→0.6——基线实测 night desert fog 混 0.35 后仍为
// (178,162,133) 亮卡其、与夜空 horizon(13,26,42) 明显脱节；0.6 让环境色
// 主导（保留 0.4 场地底色），夜雾向预设深蓝收敛、黄昏更暖。
const TERRAIN_FOG_ENV_MIX = 0.6;
const _tfA = new THREE.Color(), _tfB = new THREE.Color();
function terrainFog(T, P) {
  if (!T || !T.fog) return P ? P.fog : null;
  if (!P) return T.fog;
  _tfA.setHex(T.fog[0]);
  _tfB.setHex(P.fog[0]);
  _tfA.lerp(_tfB, TERRAIN_FOG_ENV_MIX);
  return [_tfA.getHex(), T.fog[1]];
}

// ---------- P5-B(B)：沙漠远景沙丘/远景地面 颜色协调 ----------
// 基色固定用沙漠自身 farTint（沙色系），不再借停机坪 padTint——旧实现
// 夜间把沙丘染成 padTint 的蓝紫调，与环外沙色天空地形成色相断层。
// 环境预设只调节明暗（envDim），不引入预设的色相：day 全亮、dusk 略暗、
// night 压到 ~0.49，亮度随 PMREM 面板强度同步收缩，杜绝"夜景沙丘发光"。
const DUNE_BASE = 0xcbb287;                 // 沙漠 farTint：沙丘本体色
function desertEnvDim(P) {
  return clamp(0.35 + P.hemi * 1.2, 0.2, 1.0);
}

// ---------- 沙丘高度场（世界坐标输入）----------
// 抽出为共享函数供四处调用：
//   30-world.js    —— 盘面几何顶点变形/复原（修"切出沙漠后沙丘残留"的根因）
//   17-washfx.js   —— 刷痕贴花贴合沙丘起伏
//   21-washground  —— 沙脊吹沙的发射筛选与贴地钳位
//   26-airtargets  —— 击落残骸贴合沙面
//
// 【按物理重做——两轮，第二轮才真正解决同心环】
// 第一版（同心环的根因）：以原点为中心的径向渐入 × 关于原点对称的正弦积，
// 等高线必然是一圈套一圈，起降盘周围像铺了个靶心。
// 第二版改成风向系周期剖面，数值上角向对称性已经消失（逐半径角向 sd/mean
// 0.7~1.6），但离线山体阴影渲染显示【仍然看得见一圈环】。原因是环感不来自
// 高度场的角向对称，而来自【径向包络的拓扑】：一圈沙丘围着一个空的圆形盘，
// 无论内部多不规则，固定半径上的"起/止"边界本身就读作环。
// 所以第三版（本版）换包络拓扑，不再调常数：
//   ① 风向系 (u=顺风, v=横风)：高度是 u 的周期函数 → 脊线沿 v 延伸、垂直
//      主风向，这是横向沙丘（Bagnold 1941）的成因形态；
//   ② 剖面改三角波 + smin 圆角：真实沙丘坡面是直的（迎风坡沙粒跃移爬升约
//      10~15°，落沙坡崩落到松沙静止摩擦角 ~33°），只有脊线与坡脚是圆角。
//      旧的双段余弦把坡角摊在整个波长上，为了做出可见起伏就得抬高幅度，
//      结果最陡处反而冲到 47°（远超摩擦角，看着像布料褶皱）。现在实测
//      落沙坡 33.6°、全场最陡 33.9°，正好卡在摩擦角上；
//   ③ 吹蚀清空边界用【大幅角谐波（2/3/5 阶，合计 ±3.8u）+ 下风外推 +
//      脊线相位耦合（-RC*prof：沙先从槽里被掏走，脊被留下）】，边界因此是
//      随脊线进退的锯齿状缺口，描不出圆；
//   ④ 外缘不设锐利 fade 窗，而是从 T0 一路缓降到 14.4u，跨度 4.9u——没有
//      可辨认的外环线，且到盘缘（15u）严格归零（远景是 0.012u 下方的平盘，
//      任何残留都会拍出接缝圆环）；
//   ⑤ 叠长波沙原缓丘（swell，λ≈15u）与迎风坡风纹，避免"只有沙丘、其余
//      绝对平"的塑料感。
// 硬约束（都已离线实测）：吹蚀区内 5.5u 以内严格 0（旋翼盘下与接地阴影贴片
// 必须平），盘缘 <0.001u，峰值 0.56u → WashDecal 局部顶点 0.045（回归用例卡
// zmaxLocal < 0.25 / worldH < 4.0，余量充足），DuneSandFX 的 h>0.12 发射闸
// 命中率 57%（太低会没沙雾，太高会满场喷）。
// 注意盘面局部 y = -世界 z（pad 绕 x 轴 -90°），换算在各调用点完成。
const DUNE_WX = Math.sin(WIND.dir), DUNE_WZ = Math.cos(WIND.dir);  // 主风单位向量
const DUNE_LAM = 5.0;      // 脊距（u，1u≈2m → 约 10m，小型横向沙丘/巨型风纹）
const DUNE_STOSS = 0.80;   // 迎风坡占一个波长的比例（余下 0.2 为落沙坡）
const DUNE_H = 0.58;       // 脊高（u，约 1.1m；h/λ≈1/9）
const DUNE_KC = 0.38;      // smin 圆角宽度（脊线与坡脚的曲率半径）
const DUNE_SR = 7.0;       // 吹蚀清空基准半径
const DUNE_SW = 3.0;       // 清空边界到满幅沙丘的过渡宽度
const DUNE_T0 = 9.5;       // 外缘开始缓降（到 14.4u 归零，跨度大到看不出环线）
const DUNE_R2 = 14.4;
function duneH(wx, wz) {
  const rr = Math.hypot(wx, wz);
  if (rr >= DUNE_R2) return 0;
  const u = wx * DUNE_WX + wz * DUNE_WZ;      // 顺风距离
  const v = -wx * DUNE_WZ + wz * DUNE_WX;     // 横风距离（脊线延伸方向）
  const ang = Math.atan2(wz, wx);
  const dw = rr > 1e-4 ? u / rr : 0;          // 该方位与风向的余弦
  // 沙丘相位先算：吹蚀边界要与脊线耦合，所以 prof 必须在 sr 之前就绪
  let ph = u / DUNE_LAM + 0.24 * Math.sin(v * 0.26) + 0.11 * Math.sin(v * 0.61 + 1.9);
  ph -= Math.floor(ph);
  // 三角波 + 双重 smin：直坡面、圆角脊线、圆角坡脚
  let prof = smin(ph / DUNE_STOSS, (1 - ph) / (1 - DUNE_STOSS), DUNE_KC);
  prof = -smin(-prof, 0, DUNE_KC * 0.9);
  // 吹蚀清空半径：大幅角谐波 + 下风外推 + 脊线耦合（沙先从槽里被掏走）。
  // 下限 5.5u 保证旋翼盘下与接地阴影贴片所在区域严格平整。
  const sr = Math.max(5.5, DUNE_SR + 1.1 * dw
    + 1.9 * Math.sin(ang * 2 + 0.5) + 1.25 * Math.sin(ang * 3 - 1.1)
    + 0.7 * Math.sin(ang * 5 + 2.2) - 0.6 * prof);
  const k = smoothstep(sr, sr + DUNE_SW, rr) * (1 - smoothstep(DUNE_T0, DUNE_R2, rr));
  if (k <= 0) return 0;
  const amp = 0.58 + 0.42 * (0.5 + 0.5 * Math.sin(v * 0.30 + 0.6));    // 脊高不齐
  const swell = 0.5 + 0.5 * Math.sin(u / 15 * TAU + 0.7 * Math.sin(v * 0.13));
  const ripple = 0.02 * (ph < DUNE_STOSS ? 1 : 0) * (0.5 + 0.5 * Math.sin(u * 3.7 + v * 0.55));
  return (DUNE_H * amp * prof + 0.08 * swell + ripple) * k;
}

// ---------- 远景巨型沙丘（2026-09-02，用户需求"远景沙丘/沙脊背景"）----------
// 近景 duneH 只覆盖 r<14.4u。注意相机 far=2000（远景靠雾融合），沙丘环
// 必须整体落在裁剪面内：r 31.5~48u、波长 26u、峰 7.4u（约 15m 沙山）。
// **军事基地扇区（机头 +Z 方向 |方位角|<~36°，靶标 35~48u）保持平地**——
// 基地建在沙海间的平地走廊上；此前第一版把整圈靶标埋进沙里（用户实测）。
const DFAR_LAM = 26.0;
function duneFarH(wx, wz) {
  const r = Math.hypot(wx, wz);
  if (r < 31.5 || r > 48) return 0;
  const az = Math.abs(Math.atan2(wx, wz));
  if (az < 0.62) return 0;                       // 基地扇区：平地走廊
  const u = wx * DUNE_WX + wz * DUNE_WZ;
  const v = -wx * DUNE_WZ + wz * DUNE_WX;
  let ph = u / DFAR_LAM + 0.42 * Math.sin(v * 0.075 + 1.2) + 0.13 * Math.sin(v * 0.19 + 0.4);
  ph -= Math.floor(ph);
  // 三角波剖面 + smin 圆角（同 duneH，坡角卡在沙粒静止摩擦角附近）
  let prof = smin(ph / DUNE_STOSS, (1 - ph) / (1 - DUNE_STOSS), DUNE_KC);
  prof = -smin(-prof, 0, DUNE_KC * 0.9);
  // 手动反馈第 2 批：环形沙丘带的径向边界从"完美圆形"改为方位角调制——
  // 俯视时 31.5/48u 的纯圆 smoothstep 边界就是一道清晰的大同心圆（用户持续
  // 反馈"沙漠地面很多同心圆"）。真实沙丘群边缘不会收成几何圆：内外边界
  // 随方位角波动 ±3~4u，环带呈不规则"花瓣"轮廓；基地扇区（az<0.62）仍平地。
  const ang = Math.atan2(wx, wz);
  const edge = 1 + 0.30 * Math.sin(ang * 3 + 0.8) + 0.22 * Math.sin(ang * 5 - 1.3);
  const grow = smoothstep(31.5, 34.5 + 3.5 * edge, r)
             * (1.0 - smoothstep(44.5 + 3.0 * edge, 49.5, r));
  const amp = 3.2 + 4.2 * smoothstep(36, 44, r);
  const swell = 0.5 + 0.5 * Math.sin(u / 18 * TAU + 0.9 * Math.sin(v * 0.08));
  return (amp * prof + 0.4 * swell) * grow * smoothstep(0.62, 0.82, az);
}
