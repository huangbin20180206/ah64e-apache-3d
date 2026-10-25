// ============================================================
// 00-utils.js — 数学 / 随机 / 画布 / 噪声 / 贴图 工具
// ============================================================
const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (v - a) / (b - a);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// 多项式 smooth-min：把两条直线在 k 宽度内圆角地相交。用于沙丘剖面——
// 三角波（真实沙丘的直坡）取 min 会得到尖脊尖谷，smin 给出圆角脊线与坡脚，
// 同时保持坡面本身是直线（余弦剖面做不到：它把坡角摊在整个波长上）。
// 取 smooth-max 用 -smin(-a, -b, k)。
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b * (1 - h) + a * h - k * h * (1 - h); };
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
// 与帧率无关的指数阻尼：每帧衰减率按 60fps 基准换算
// 审核 2026-10-25：clamp rate 到 [0, 0.999]——rate ≥ 1 会得负底数的非整数次幂 = NaN，
// 曾靠注释口头约定（70-loop.js 明确警告过），现在改成代码层硬守卫。
const damp = (rate, dt) => 1 - Math.pow(1 - clamp(rate, 0, 0.999), dt * 60);

// 固定种子的 PRNG，保证每次刷新贴图完全一致
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const _rnd = mulberry32(20260827);
const rnd = (a = 1, b) => b === undefined ? _rnd() * a : a + _rnd() * (b - a);
const rsign = () => _rnd() < 0.5 ? -1 : 1;
const rpick = arr => arr[Math.floor(_rnd() * arr.length) % arr.length];

function canvas2d(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  return { c, x };
}

// 低分辨率白噪声，放大后叠加即得廉价 fBm
function noiseCanvas(n, mono = true) {
  const { c, x } = canvas2d(n);
  const d = x.createImageData(n, n), p = d.data;
  for (let i = 0; i < n * n; i++) {
    const v = _rnd() * 255 | 0;
    const g = mono ? v : _rnd() * 255 | 0, b = mono ? v : _rnd() * 255 | 0;
    p[i * 4] = v; p[i * 4 + 1] = g; p[i * 4 + 2] = b; p[i * 4 + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

// 把多个八度的噪声用 overlay 混合进目标画布。
// 必须走 createPattern 而不是 drawImage 拉伸：drawImage 把小噪声图放大后，
// 图块四边无法与自身接续，贴图 repeat 平铺时每块边界都会露出方格接缝
// （地面俯视像一张拼布）。pattern 天然无限平铺，缩放后跨界采样也连续。
function fbmInto(x, W, H, { octaves = 5, base = 4, alpha = 0.5, mode = 'overlay' } = {}) {
  x.save();
  for (let o = 0; o < octaves; o++) {
    const n = base << o;
    const cell = Math.min(n, 256);
    const src = noiseCanvas(cell);
    const pat = x.createPattern(src, 'repeat');
    // 让 cell 个噪声像素铺满 W：缩放因子 = W / (n * cell) * cell = W / n
    const k = W / n;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    x.globalAlpha = alpha / (o + 1);
    x.globalCompositeOperation = o === 0 ? 'source-over' : mode;
    x.imageSmoothingEnabled = true;
    x.fillStyle = pat;
    x.fillRect(0, 0, W, H);
  }
  x.restore();
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
}

function fbmCanvas(N, opt) {
  const { c, x } = canvas2d(N);
  x.fillStyle = '#808080'; x.fillRect(0, 0, N, N);
  fbmInto(x, N, N, opt);
  return c;
}

// Sobel 算子：灰度高度图 -> 切空间法线贴图（环绕采样，可无缝平铺）
function heightToNormal(hcv, strength = 2.0) {
  const N = hcv.width, wm = N - 1;
  const hx = hcv.getContext('2d').getImageData(0, 0, N, N).data;
  const { c, x } = canvas2d(N);
  const out = x.createImageData(N, N), p = out.data;
  const H = (i, j) => hx[(((j & wm) * N) + (i & wm)) * 4] / 255;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (H(i + 1, j - 1) + 2 * H(i + 1, j) + H(i + 1, j + 1))
               - (H(i - 1, j - 1) + 2 * H(i - 1, j) + H(i - 1, j + 1));
      const dy = (H(i - 1, j + 1) + 2 * H(i, j + 1) + H(i + 1, j + 1))
               - (H(i - 1, j - 1) + 2 * H(i, j - 1) + H(i + 1, j - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const k = (j * N + i) * 4;
      p[k] = (nx * 0.5 + 0.5) * 255;
      p[k + 1] = (ny * 0.5 + 0.5) * 255;
      p[k + 2] = (nz * 0.5 + 0.5) * 255;
      p[k + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
  return c;
}

function tex(canvas, { srgb = false, repeat = 1, aniso = 8, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// 圆角矩形路径
function rrect(x, X, Y, w, h, r) {
  r = Math.min(r, w * 0.5, h * 0.5);
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

// 释放动态特效对象的几何与材质；仅用于不再复用的运行时对象。
function disposeObject3D(root) {
  const geos = new Set(), mats = new Set();
  root.traverse(o => {
    // P5-G1：noDispose 网格共享他处几何（残骸借用原车几何），只释放材质
    if (o.geometry && !(o.userData && o.userData.noDispose)) geos.add(o.geometry);
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m) mats.add(m);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

const STATS = { tris: 0, meshes: 0 };
function countScene(root) {
  let tris = 0, meshes = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    meshes++;
    const g = o.geometry;
    const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
    tris += n / 3;
  });
  STATS.tris = Math.round(tris);
  STATS.meshes = meshes;
  return STATS;
}

// ---------- 顶点色零件拼装（2026-10-15 敌方模型真实化）----------
// 每个零件一种颜色，摆好位置后烘进同一个几何：配 vertexColors 材质 = 整件只画 1 次。
// 全部零件先转非索引（ExtrudeGeometry 本身非索引，统一后 mergeGeos 才能拼）。
// 用法：const K = vcKit(); K.box(w,h,d,0x556b2f, x,y,z, rx,ry,rz); ... K.build()
// scratch 懒创建：00-utils 会被 tests_pure 用桩 THREE 求值，模块顶层不能 new THREE 对象
let _vcT = null;
function vcKit() {
  if (!_vcT) _vcT = { M: new THREE.Matrix4(), Q: new THREE.Quaternion(), E: new THREE.Euler(),
    P: new THREE.Vector3(), S: new THREE.Vector3(1, 1, 1), C: new THREE.Color() };
  const { M: _vcM, Q: _vcQ, E: _vcE, P: _vcP, S: _vcS, C: _vcC } = _vcT;
  const list = [];
  const add = (geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _vcE.set(rx, ry, rz); _vcQ.setFromEuler(_vcE); _vcP.set(x, y, z);
    g.applyMatrix4(_vcM.compose(_vcP, _vcQ, _vcS));
    _vcC.set(color);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = _vcC.r; c[i * 3 + 1] = _vcC.g; c[i * 3 + 2] = _vcC.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    list.push(g);
    return g;
  };
  return {
    list, add,
    box: (w, h, d, col, x, y, z, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), col, x, y, z, rx, ry, rz),
    cyl: (rt, rb, h, seg, col, x, y, z, rx, ry, rz) => add(new THREE.CylinderGeometry(rt, rb, h, seg), col, x, y, z, rx, ry, rz),
    sph: (r, col, x, y, z, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 10, 7); g.scale(sx, sy, sz); return add(g, col, x, y, z); },
    // 侧面轮廓挤出：pts=[[a,b],...] 为 X-Y 平面闭合轮廓，沿 Z 挤出 depth（居中）
    prism: (pts, depth, col, x, y, z, rx, ry, rz) => {
      const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
      g.translate(0, 0, -depth / 2);
      return add(g, col, x, y, z, rx, ry, rz);
    },
    build: () => { const g = mergeGeos(list); return g; },
  };
}
function vcMat(roughness = 0.8, metalness = 0.15) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
}

const fmtK = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);

// ---------- 静态几何合并（draw call 合批；PERF-AUDIT C1/C2 的工具底座） ----------
// 把同一 attribute 集的静态几何拼成一个 BufferGeometry（烘焙的局部矩阵已由
// 调用方 applyMatrix4 进顶点）。vendor 的 BufferGeometryUtils 被内联进
// loader IIFE 是局部符号，app 侧不可达——这里是专用轻量版，只做拼接不做
// 属性运算；attribute 集不一致 / index 有无不一致时返回 null，调用方保底
// 放弃合并（任何失败路径都退回"不合并"——几何零丢失）。
function mergeGeos(list) {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const first = list[0];
  const keys = Object.keys(first.attributes);
  const hasIndex = !!first.index;
  for (const g of list) {
    if (Object.keys(g.attributes).length !== keys.length) return null;
    for (const k of keys) if (!g.attributes[k]) return null;
    if (!!g.index !== hasIndex) return null;
  }
  const out = new THREE.BufferGeometry();
  // 顶点总数与索引总数
  let vTot = 0, iTot = 0;
  for (const g of list) { vTot += g.attributes.position.count; if (hasIndex) iTot += g.index.count; }
  if (vTot > 65535 * 4) return null;   // 超大保护（4×Uint16 上限），不合也不损
  const idxArr = new Uint32Array(iTot);
  let iOff = 0;
  for (const key of keys) {
    const src0 = first.attributes[key];
    // 拼接为 Float32（tangent 等四分量/颜色三分量统一按 itemSize 拷贝）
    const itemSize = src0.itemSize;
    const arr = new Float32Array(vTot * itemSize);
    let off = 0;
    for (const g of list) {
      const a = g.attributes[key];
      if (a.itemSize !== itemSize) { return null; }
      // 2026-10-18：交错存储（Sketchfab 导出的 GLB 常见）/ 量化整数属性的 array 不是
      // "紧排 Float32"，整块 set 会越界或读错 → 逐分量取值（getX..getW 自带反量化）
      if (!a.isInterleavedBufferAttribute && !a.normalized && a.array.length === a.count * itemSize) {
        arr.set(a.array, off);
      } else {
        const gs = [a.getX, a.getY, a.getZ, a.getW];
        for (let i = 0; i < a.count; i++) {
          for (let c = 0; c < itemSize; c++) arr[off + i * itemSize + c] = gs[c].call(a, i);
        }
      }
      off += a.count * itemSize;
    }
    out.setAttribute(key, new THREE.BufferAttribute(arr, itemSize));
  }
  if (hasIndex) {
    let vBase = 0;
    for (const g of list) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) idxArr[iOff + i] = idx[i] + vBase;
      iOff += idx.length;
      vBase += g.attributes.position.count;
    }
    out.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }
  // 归一化 bounding（合并后手算，避免逐个 computeBoundingSphere）
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
