// ============================================================
// 34-routes.js — P4b 飞行展示航线：纯数据 + 轨迹采样（无 DOM / 无 three）
// ============================================================
// 6 条 40–60 秒的自动驾驶航线（设计文档 §4.2），运行时在 75-routes.js。
//   pts   [t, x, z, alt]：航点（世界坐标，alt=离地高度 u）。按时间做
//         Catmull-Rom 插值，航向取速度方向（低速时保持上一航向）。
//   shots [t, kind, opts]：电影机位，kind ∈ chase/side/front/orbit/high/fixed。
//   caps  [t, 文案]：字幕。
//   start 'ground' = 从地面启旋起飞（仅晨间出勤）；auto = 自动驾驶接管时刻。
//   scene 'town' / 'canyon'：临时展示城镇 / 峡谷地图（70-mission 每帧派生）。
// 峡谷航线直接取 16-valley 的 CANYON_PATH 中线（本文件排在其后，可读）。
// ============================================================

function _canyonRoutePts() {
  // 中线累计长度按 ~3.6u/s 分配时间，t=3 开始进谷；出口后拉起露头
  const P = CANYON_PATH;
  const out = [[0, P[0][0], P[0][1] - 4, 6.5], [3, P[0][0], P[0][1], 4.6]];
  let t = 3;
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    t += d / 3.6;
    out.push([+t.toFixed(2), P[i][0], P[i][1], i === P.length - 1 ? 6 : 4.4]);
  }
  out.push([+(t + 4).toFixed(2), 0, 4, 13]);
  out.push([+(t + 8).toFixed(2), 0, 10, 15]);
  return out;
}

const ROUTES = [
  {
    id: 'dawn', name: '晨间出勤', terrain: 'pad', env: 'day', dur: 58, start: 'ground', auto: 17,
    desc: '停机坪 · 正午｜启旋、下洗、起飞、绕场',
    pts: [[17, 0, 0, 14], [22, 0, 12, 13], [28, 18, 26, 12], [34, 36, 8, 11], [40, 26, -22, 11],
          [45, -6, -32, 12], [50, -30, -12, 12], [54, -18, 10, 13], [58, 0, 4, 14]],
    shots: [[0, 'orbit', { dist: 15, phi: 1.22, rate: 0.10 }], [7, 'fixed', { x: 7, y: 1.2, z: 9 }],
            [12, 'orbit', { dist: 20, phi: 1.30, rate: 0.12 }], [19, 'chase', { dist: 17, phi: 1.20 }],
            [28, 'side', { dist: 15, phi: 1.30, sign: 1 }], [38, 'high', { dist: 34 }],
            [46, 'front', { dist: 18, phi: 1.25 }], [53, 'orbit', { dist: 18, phi: 1.20, rate: 0.15 }]],
    caps: [[0.5, '晨间出勤 · 停机坪'], [2, '启动 APU → 两台 T700 发动机，旋翼开始加速'],
           [9, '转速爬升到 92%，下洗气流压出地面涟漪'], [12, '起飞：垂直离地，进入悬停'],
           [19, '自动驾驶接管：绕场一周'], [38, '高空俯视：四片主桨 + 交错尾桨'],
           [53, '回到停机坪上空悬停｜任意键接管驾驶']],
  },
  {
    id: 'grass', name: '草原低空', terrain: 'grass', env: 'day', dur: 48,
    desc: '草地 · 白天｜草浪压痕、贴地高速通场',
    pts: [[0, -48, -48, 12], [5, -40, -36, 6], [10, -28, -18, 2.4], [16, -10, 6, 2.2], [21, 6, 26, 2.2],
          [26, 24, 40, 4], [31, 40, 30, 8], [36, 42, 8, 6], [41, 30, -12, 2.6], [45, 10, -20, 2.4],
          [48, -4, -24, 3]],
    shots: [[0, 'chase', { dist: 18, phi: 1.10 }], [8, 'fixed', { x: -14, y: 0.8, z: 2 }],
            [19, 'side', { dist: 12, phi: 1.40, sign: -1 }], [27, 'high', { dist: 30 }],
            [35, 'front', { dist: 16, phi: 1.38 }], [42, 'fixed', { x: 4, y: 0.7, z: -16 }]],
    caps: [[0.5, '草原低空 · 白天'], [6, '压低到 5 米以下：贴地高速通场'],
           [11, '下洗把草压出一圈草浪'], [27, '拉起转弯，准备第二次通场'],
           [42, '低机位：旋翼从头顶掠过']],
  },
  {
    id: 'desert', name: '沙漠黄昏', terrain: 'desert', env: 'dusk', dur: 50,
    desc: '沙漠 · 黄昏｜brownout、侧光剪影',
    pts: [[0, 0, -30, 2.2], [7, 0, -29, 2.0], [12, 4, -18, 2.5], [18, 16, -2, 3], [24, 30, 14, 4],
          [30, 34, 34, 5], [36, 18, 44, 4], [42, -6, 36, 3], [47, -18, 20, 2.4], [50, -20, 14, 2.2]],
    shots: [[0, 'orbit', { dist: 16, phi: 1.32, rate: 0.18 }], [9, 'chase', { dist: 15, phi: 1.30 }],
            [18, 'side', { dist: 16, phi: 1.46, sign: 1 }], [30, 'fixed', { x: 10, y: 0.9, z: 50 }],
            [38, 'side', { dist: 14, phi: 1.44, sign: -1 }], [46, 'orbit', { dist: 15, phi: 1.30, rate: -0.14 }]],
    caps: [[0.5, '沙漠黄昏'], [2, '低空悬停：下洗卷起沙尘——brownout'],
           [10, '前飞脱离沙幕'], [18, '低角度侧光：夕阳下的剪影'],
           [38, '贴沙丘飞行'], [46, '收尾悬停｜任意键接管驾驶']],
  },
  {
    id: 'lake', name: '湖面掠水', terrain: 'water', env: 'dusk', dur: 46,
    desc: '湖面 · 黄昏｜倒影、涟漪、水花',
    pts: [[0, -40, -40, 8], [5, -34, -30, 3], [10, -24, -14, 1.6], [16, -8, 8, 1.5], [22, 10, 28, 1.5],
          [27, 28, 38, 2.5], [32, 40, 22, 3.5], [37, 30, 0, 1.8], [42, 12, -14, 1.5], [46, 0, -20, 2]],
    shots: [[0, 'chase', { dist: 16, phi: 1.20 }], [9, 'side', { dist: 13, phi: 1.47, sign: 1 }],
            [17, 'fixed', { x: 2, y: 0.6, z: 22 }], [24, 'high', { dist: 28 }],
            [32, 'front', { dist: 15, phi: 1.44 }], [40, 'side', { dist: 12, phi: 1.48, sign: -1 }]],
    caps: [[0.5, '湖面掠水 · 黄昏'], [6, '降到 3 米：水面开始出现下洗涟漪'],
           [10, '镜面倒影 + 碎金光路'], [24, '俯视：身后拖出一道水痕'],
           [40, '贴水面侧飞｜任意键接管驾驶']],
  },
  {
    id: 'town', name: '城镇巡逻', terrain: 'grass', env: 'day', dur: 52, scene: 'town', scan: true,
    desc: '城镇 · 白天｜楼间穿行、长弓雷达扫描',
    pts: [[0, 0, 10, 12], [6, 0, 30, 8], [11, 0, 44, 6.5], [17, 0, 56, 6.5], [21, 0, 63, 6.5],
          [26, 1, 64, 6.5], [31, 12, 63, 6.8], [35, 22, 62, 8], [40, 24, 78, 9], [45, 8, 84, 9],
          [49, -10, 74, 8], [52, -14, 64, 8]],
    shots: [[0, 'chase', { dist: 18, phi: 1.18 }], [10, 'front', { dist: 14, phi: 1.30 }],
            [17, 'fixed', { x: 3, y: 1.2, z: 68 }], [24, 'orbit', { dist: 14, phi: 1.10, rate: 0.25 }],
            [31, 'side', { dist: 15, phi: 1.25, sign: 1 }], [38, 'high', { dist: 32 }],
            [45, 'chase', { dist: 17, phi: 1.15 }]],
    caps: [[0.5, '城镇巡逻 · 白天'], [6, '沿主街低空进入城镇'],
           [17, '贴着屋顶穿行'], [22, '十字路口悬停：桅顶长弓雷达往复扫描'],
           [31, '转入横街'], [38, '绕城一周｜任意键接管驾驶']],
  },
  {
    id: 'canyon', name: '峡谷穿越', terrain: 'desert', env: 'dusk', dur: 0, scene: 'canyon',
    desc: '峡谷 · 黄昏｜贴谷底蛇行、崖顶露头',
    pts: _canyonRoutePts(),
    shots: [[0, 'chase', { dist: 14, phi: 1.12 }], [12, 'high', { dist: 26 }],
            [22, 'chase', { dist: 12, phi: 1.05 }], [32, 'high', { dist: 24 }], [41, 'front', { dist: 14, phi: 1.10 }],
            [999, 'orbit', { dist: 18, phi: 1.20, rate: 0.15 }]],
    caps: [[0.5, '峡谷穿越 · 黄昏'], [3, '压到崖顶以下：贴谷底蛇行，雷达看不见'],
           [20, '岩壁擦身而过'], [999, '出谷口拉起：崖顶露头｜任意键接管驾驶']],
  },
];
// 峡谷航线：时长由中线长度决定；尾段机位/字幕挂到出谷时刻
(function () {
  const r = ROUTES[5];
  r.dur = r.pts[r.pts.length - 1][0];
  const exitT = r.pts[r.pts.length - 3][0];
  r.shots[r.shots.length - 1][0] = +exitT.toFixed(2);
  r.caps[r.caps.length - 1][0] = +exitT.toFixed(2);
})();

// Catmull-Rom（均匀参数，段内按时间线性映射）
function _cr(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

// 采样：返回 {x, z, alt}；t 在首末航点外钳位
function routeSample(route, t) {
  const P = route.pts;
  if (t <= P[0][0]) return { x: P[0][1], z: P[0][2], alt: P[0][3] };
  const n = P.length - 1;
  if (t >= P[n][0]) return { x: P[n][1], z: P[n][2], alt: P[n][3] };
  let i = 0;
  while (i < n - 1 && t > P[i + 1][0]) i++;
  const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n, i + 2)];
  const u = (t - b[0]) / Math.max(1e-6, c[0] - b[0]);
  return { x: _cr(a[1], b[1], c[1], d[1], u), z: _cr(a[2], b[2], c[2], d[2], u), alt: _cr(a[3], b[3], c[3], d[3], u) };
}

// 速度（u/s，有限差分）：航向 = atan2(vx, vz)（机头 +Z，x = sin yaw）
function routeVel(route, t) {
  const h = 0.05, a = routeSample(route, t - h), b = routeSample(route, t + h);
  return { vx: (b.x - a.x) / (2 * h), vz: (b.z - a.z) / (2 * h), vy: (b.alt - a.alt) / (2 * h) };
}

// 当前机位：最后一个 t ≤ 当前时间的 shot
function routeShot(route, t) {
  let s = route.shots[0];
  for (const x of route.shots) if (x[0] <= t) s = x;
  return s;
}
